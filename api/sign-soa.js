// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — SOA signature endpoint.
//
// POST /api/sign-soa  body = SOASigningPayload
//
// Pipeline:
//   1. CORS allowlist + rate limit
//   2. Pull token record (verifies the lead exists and is unconsumed)
//   3. Validate payload against captured lead name
//   4. Generate PDF (pdfkit) with full CMS-required content
//   5. Compute SHA-256 of the PDF bytes (audit trail)
//   6. Mark token as consumed + persist signed record
//   7. POST structured note to GHL contact (createOrUpdate)
//   8. Return 200 { ok, soaId, signedAt, pdfHash }
//
// NEVER reveals raw token data; only emits the audit metadata.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { checkOrigin, applyCors, rateLimit, clientId } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';
import { getRecord, setRecord, leadKey, SOA_TOKEN_TTL_SEC } from './_lib/soa-store.js';
import { storeKeyFor, checkLink, consumeLink } from './_lib/cy2027/secure-link.js';
// AUDIT 2026-08-15 — shared JSON body reader (fixes the malformed-JSON hang).
import { readJsonBody } from './_lib/read-body.js';

// AUDIT 2026-10-01 (CY2027) — the TPMO disclaimer is no longer defined here.
// This file carried the THIRD copy of the (e)(41) sentence, hardcoded with
// [X]/[Y], while the site rendered a different, count-less sentence from
// src/lib/tpmoConfig.ts. A signed PDF disagreeing with the published
// disclaimer is an audit failure, and unifying the copies was blocker #1
// against enabling the SOA workflow. api/*.js cannot import from src/, so the
// canonical module lives in the environment-neutral CY2027 layer and both
// worlds import it. scripts/check-cy2027-parity.mjs fails the build if a
// fourth copy appears.
import { tpmoDisclaimerText, assertDisclaimerSignable, TPMO_DISCLAIMER_VERSION } from './_lib/cy2027/tpmo.js';
// AUDIT 2026-10-01 (CY2027-SRV-01) — the Phase 0 audit found that the CY2027
// rules were enforced ONLY in the browser: SOAForm.tsx resolved the state
// ruleset, required an appointment and submitted planYear / residenceState /
// stateRulesetVersion / soaFormVersion, and this file silently dropped all
// four. A direct POST therefore bypassed every gate the form enforced.
// Client-side enforcement is not enforcement. The server now resolves the
// rulesets itself and treats the browser's versions as a claim to CHECK, never
// as a value to trust.
import { resolveRuleset } from './_lib/cy2027/rulesets.js';
import { resolveStateRuleset } from './_lib/cy2027/state-rules.js';
import { createSoaInstance, completeSoaInstance, languageWasElected } from './_lib/cy2027/soa-instance.js';
import { ALL_CATEGORY_CODES, SOA_TEXT, categoryText } from './_lib/cy2027/soa-text.js';
import { buildEvidenceRecord, emitAudit } from './_lib/cy2027/evidence.js';
import { putEvidence } from './_lib/cy2027/evidence-store.js';
import { buildCustomFields, soaInstanceToFields, unmappedFieldsWarning } from './_lib/cy2027/crm-fields.js';
import { sendCopy } from './_lib/cy2027/beneficiary-copy.js';
import { RECORD_CLASS, RETENTION_YEARS } from './_lib/cy2027/retention.js';

// The signed SOA keeps the EVIDENCE retention class, not the signing-link TTL.
// Six years in seconds; the authoritative copy lives in the evidence store and
// this is the operational index entry beside it.
const SIGNED_RECORD_CLASS = RECORD_CLASS.SOA_EVIDENCE;
const SIGNED_RECORD_TTL_SEC = RETENTION_YEARS[RECORD_CLASS.SOA_EVIDENCE] * 365 * 24 * 60 * 60;

const AGENT_NAME = 'Sawil Reyes';
const AGENT_NPN = '17261494';
const TPMO_VERSION = TPMO_DISCLAIMER_VERSION;

// PHASE 7 — SOA gate (mirror of src/lib/soaContent.ts SOA_ENABLED).
// Until the owner confirms FMO carrier/product counts, refuse to sign so
// that no PDF with [X]/[Y] placeholders can be generated.
const SOA_ENABLED = false;

// AUDIT 2026-10-01 (CY2027) — the five-product CMS-10566 taxonomy (MA_only,
// MAPD, PDP, DVH_HI) is gone. The approved Master SOA defines exactly three
// authorizing categories plus a non-authorizing "I am not sure" option, and
// their wording lives in api/_lib/cy2027/soa-text.js. DVH_HI in particular was
// an "Other (Dental, Vision, Hearing, Hospital Indemnity…)" catch-all; spec §8
// allows additional categories only after the agency's actual licensed product
// scope is confirmed, so it is not reinstated without that confirmation.

export default async function handler(req, res) {
  // ── CORS + method gates ────────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
    // AUDIT 2026-09-14 (SEC-10) — never let a rejection be cached
  if (allowedOrigin === null) { noStorePII(res); return res.status(403).json({ error: 'Origin not allowed' }); }
  applyCors(req, res, allowedOrigin);
  noStorePII(res); // Sawil 2026-06-29 SECURITY HOTFIX — never cache SOA/PII responses (finding 05).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── PHASE 7 SOA gate ───────────────────────────────────────────────────
  if (!SOA_ENABLED) {
    return res.status(503).json({ error: 'SOA_NOT_CONFIGURED', message: 'SOA workflow is temporarily unavailable' });
  }

  // ── Rate limit (3 signature attempts per IP per hour — anti-replay) ────
  var ip = clientId(req);
  var rl = await rateLimit(ip, { max: 3, windowMs: 60 * 60 * 1000, prefix: 'soa-sign' });
  if (!rl.ok) return res.status(429).json({ error: 'Too many sign attempts' });

  // ── Read body — PHASE 6: cap at 64 KB ──────────────────────────────────
  // AUDIT 2026-08-15 — shared reader (_lib/read-body.js) fixes the
  // malformed-JSON hang; it answers 400/413 itself and returns null.
  var body = await readJsonBody(req, res, { maxBytes: 64 * 1024 });
  if (body === null) return;

  // ── Verify token ───────────────────────────────────────────────────────
  // AUDIT 2026-10-01 (SEC-TOK-01/02) — the CY2027 secure link replaces the bare
  // UUID. The link record holds no personal data, so the lead is loaded through
  // the opaque reference inside it, and only after the second factor has been
  // verified on this link. Signing is therefore not reachable by possession of
  // a forwarded URL alone.
  var token = typeof body.token === 'string' ? body.token : '';
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return res.status(400).json({ error: 'Invalid token' });

  var linkKey = storeKeyFor(token);
  var link = await getRecord(linkKey);
  var linkState = checkLink(link);
  if (!linkState.ok) {
    return res.status(linkState.reason === 'LINK_ALREADY_USED' ? 409 : 404)
      .json({ error: 'SOA_LINK_UNUSABLE', reason: linkState.reason });
  }
  if (!link.factorVerifiedAt) {
    return res.status(401).json({ error: 'SECOND_FACTOR_REQUIRED' });
  }

  var record = await getRecord(leadKey(link.beneficiaryRef));
  if (!record) return res.status(404).json({ error: 'Lead record not found or expired' });

  // ── Validate payload ───────────────────────────────────────────────────
  var fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  // Date of birth is deliberately NOT read: it is absent from the approved
  // Master SOA template, and collecting what the form does not need is the data
  // minimization rule (spec §14). Any dob a client still sends is ignored.
  var phone = String(body.phone || '').replace(/[\s\-().]/g, '');
  var email = typeof body.email === 'string' ? body.email.trim() : '';
  var zip = typeof body.zip === 'string' ? body.zip : '';
  var address = typeof body.address === 'string' ? body.address.trim() : '';
  var ack = (body.acknowledgements && typeof body.acknowledgements === 'object') ? body.acknowledgements : {};
  var signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  // AUDIT 2026-10-02 (G08) — this used to be
  //     var language = body.language === 'en' ? 'en' : 'es';
  // which turns absent, malformed and "the beneficiary actually chose Spanish"
  // into the same stored value. The language is the language the disclosures
  // were READ in, so on a signed record it has to be an election, not a
  // coalesce. Read the two fields separately and let createSoaInstance refuse
  // anything that is not an election.
  var language = body.language === 'en' || body.language === 'es' ? body.language : null;
  var languageSource = typeof body.languageSource === 'string' ? body.languageSource.trim() : '';
  var leadSource = body.leadSource === 'smart_review' ? 'smart_review' : 'customer_service';

  // CY2027 fields. The browser sends them; none of them is trusted.
  var residenceState = typeof body.residenceState === 'string' ? body.residenceState.trim().toUpperCase() : '';
  var county = typeof body.county === 'string' && body.county.trim() ? body.county.trim() : null;
  var appointmentId = typeof body.appointmentId === 'string' && body.appointmentId.trim() ? body.appointmentId.trim() : '';
  var appointmentAt = typeof body.appointmentAt === 'string' ? body.appointmentAt.trim() : '';
  var appointmentFormat = typeof body.appointmentFormat === 'string' ? body.appointmentFormat.trim() : '';
  var selectedCategories = Array.isArray(body.selectedCategories)
    ? body.selectedCategories.filter(function (c) { return ALL_CATEGORY_CODES.includes(c); })
    : [];

  // Match captured name (case-insensitive, whitespace collapse)
  var sigA = signature.toLowerCase().replace(/\s+/g, ' ');
  var sigB = (record.fullName || '').toLowerCase().replace(/\s+/g, ' ');
  if (!signature || sigA !== sigB) return res.status(400).json({ error: 'Signature must match the captured name' });
  if (!/^(\+1)?\d{10}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone' });
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'Invalid ZIP' });
  if (!ack.no_obligation || !ack.e_signature) return res.status(400).json({ error: 'Both acknowledgements required' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  // G08 — refuse before anything downstream can coalesce a missing election
  // into 'es'. The reason is named so a client bug is diagnosable from the log
  // rather than appearing as a signed Spanish document nobody chose.
  if (!language || !languageWasElected(languageSource)) {
    emitAudit({
      action: 'SOA_REFUSED', actor: 'system:sign-soa', result: 'LANGUAGE_ELECTION_REQUIRED', source: 'WEB',
      correlationId: link.beneficiaryRef || 'unlinked',
      details: { language: language || '(absent)', languageSource: languageSource || '(absent)' },
    });
    return res.status(400).json({
      error: 'SOA_LANGUAGE_ELECTION_REQUIRED',
      reason: !language ? 'LANGUAGE_NOT_SUPPLIED' : (languageSource ? 'NOT_AN_ELECTION' : 'ELECTION_NOT_RECORDED'),
    });
  }

  // ── CY2027 gates, server-side and fail-closed ──────────────────────────
  // The plan year is resolved from the server clock, never read from the body:
  // a client that sends planYear 2026 must not be able to sign under last
  // year's rules (spec §33, "old-year rules silently reused for new plan year").
  var rulesetRes = resolveRuleset(null);
  if (!rulesetRes.ok) {
    console.error('[sign-soa] ruleset unavailable:', rulesetRes.reason);
    return res.status(503).json({ error: 'SOA_RULESET_UNAVAILABLE', reason: rulesetRes.reason });
  }
  var ruleset = rulesetRes.ruleset;

  var stateRes = resolveStateRuleset(residenceState, ruleset.planYear);
  if (!stateRes.ok) {
    // Named reason, not a generic 400 — the UI must distinguish "we are not
    // licensed in your state" from "something failed".
    return res.status(stateRes.reason === 'STATE_NOT_SUPPORTED' ? 409 : 400)
      .json({ error: 'SOA_STATE_GATE', reason: stateRes.reason });
  }
  var stateRuleset = stateRes.ruleset;

  // The browser's version strings are a CLAIM. Compare them with what the
  // server resolved and refuse on any mismatch rather than recording theirs.
  if (body.stateRulesetVersion && body.stateRulesetVersion !== stateRuleset.stateRulesetVersion) {
    return res.status(409).json({ error: 'SOA_VERSION_MISMATCH', field: 'stateRulesetVersion' });
  }
  if (body.soaFormVersion && body.soaFormVersion !== stateRuleset.soaFormVersion) {
    return res.status(409).json({ error: 'SOA_VERSION_MISMATCH', field: 'soaFormVersion' });
  }
  if (body.planYear != null && Number(body.planYear) !== ruleset.planYear) {
    return res.status(409).json({ error: 'SOA_VERSION_MISMATCH', field: 'planYear' });
  }

  // An SOA is appointment-specific. Without an appointment reference there is
  // nothing to scope, so one is minted and returned rather than defaulted away.
  if (!appointmentId) appointmentId = 'appt_' + crypto.randomUUID();

  var built = createSoaInstance({
    soaId: crypto.randomUUID(),
    appointmentId: appointmentId,
    appointmentAt: appointmentAt || null,
    appointmentFormat: appointmentFormat,
    planYear: ruleset.planYear,
    state: stateRuleset.code,
    zip: zip,
    county: county,
    language: language,
    languageSource: languageSource,
    method: 'WEB_ELECTRONIC_SIGNATURE',
    beneficiaryName: fullName || record.fullName,
    selectedCategories: selectedCategories,
    stateRulesetVersion: stateRuleset.stateRulesetVersion,
    soaFormVersion: stateRuleset.soaFormVersion,
  });
  if (!built.ok) return res.status(400).json({ error: 'SOA_INVALID', fields: built.errors });

  var instance = built.instance;
  // Spec §10: if nothing was authorized, do not force completion — hand the
  // caller to a licensed agent instead of producing an empty "signed" scope.
  if (!instance.authorizedCategories.length) {
    return res.status(422).json({ error: 'SOA_INCOMPLETE', message: 'No product category was authorized' });
  }

  // The authorized scope is what the SERVER computed from the selection, so a
  // crafted authorizedCategories in the body cannot widen it.
  var products = instance.authorizedCategories;

  // ── Generate PDF ───────────────────────────────────────────────────────
  // One id for the instance, the PDF, the evidence and the CRM — not three.
  var soaId = instance.soaId;
  var signedAt = new Date().toISOString();
  var signerIp = ip;
  var signerUserAgent = String(req.headers['user-agent'] || '').slice(0, 240);

  // AUDIT 2026-10-02 (G27) — the evidence record is built BEFORE the PDF. Its
  // integrity hash covers the agreement (text shown, selections, identifiers),
  // not the PDF bytes, so nothing circular happens — and the signed document can
  // actually print the hash instead of a dash. The evidence REFERENCE is the
  // storage location and genuinely does not exist yet, so the PDF says so.
  var evidence;
  try {
    evidence = buildEvidenceRecord(instance, {
      stateName: stateRuleset.name,
      signature: signature,
      signedAt: signedAt,
      sourceIp: signerIp,
      userAgent: signerUserAgent,
      correlationId: soaId,
    });
  } catch (e) {
    console.error('[sign-soa] evidence build failed:', e && e.message);
    return res.status(500).json({ error: 'SOA_EVIDENCE_FAILED' });
  }

  var pdfBuffer;
  try {
    pdfBuffer = await buildSoaPdf({
      lang: language,
      soaId: soaId,
      signedAt: signedAt,
      fullName: fullName,
      stateName: stateRuleset.name,
      state: instance.state,
      county: instance.county,
      appointmentAt: instance.appointmentAt,
      appointmentFormat: instance.appointmentFormat,
      languageSource: instance.languageSource,
      planYear: instance.planYear,
      declined: instance.declinedCategories,
      soaFormVersion: instance.soaFormVersion,
      stateRulesetVersion: instance.stateRulesetVersion,
      scriptVersion: instance.scriptVersion,
      source: instance.source,
      appointmentId: instance.appointmentId,
      representativeRelationship: instance.representativeRelationship,
      integrityHash: evidence.integrityHash,
      evidenceReference: (language === 'es' ? '(se asigna al archivar)' : '(assigned on filing)'),
      phone: phone,
      email: email,
      zip: zip,
      address: address,
      products: products,
      signature: signature,
      signerIp: signerIp,
      signerUserAgent: signerUserAgent,
    });
  } catch (e) {
    console.error('[sign-soa] pdf build failed:', e && e.message);
    return res.status(500).json({ error: 'PDF generation failed' });
  }

  var pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  // ── CY2027 evidence record ─────────────────────────────────────────────
  // Stores the EXACT wording the beneficiary saw, in their language, plus an
  // integrity hash over the text, the selections and the identifiers (spec
  // §19). The SOA instance is only marked COMPLETED once both exist, so a
  // failure here leaves the marketing gate locked rather than producing a
  // signature with no evidence behind it.
  // Persist the signed PDF + its evidence record to durable storage BEFORE the
  // instance is marked COMPLETED. Previously the PDF was hashed and discarded,
  // so Clear Point could not produce the signed document on request — enablement
  // blocker #2 in src/lib/soaContent.ts. Spec §26: "SOA evidence write failure
  // -> marketing gate stays locked", so a storage failure must leave the
  // instance un-completed rather than produce a signature with nothing behind it.
  var stored = await putEvidence({
    instance: instance,
    integrityHash: evidence.integrityHash,
    pdfBuffer: pdfBuffer,
    evidenceRecord: evidence.record,
  });
  if (!stored.ok) {
    console.error('[sign-soa] evidence NOT stored for soa_id=' + instance.soaId + ': ' + stored.reason);
    emitAudit({
      action: 'SOA_EVIDENCE_WRITE_FAILED', actor: 'system:sign-soa', result: stored.reason, source: 'WEB',
      correlationId: instance.soaId, soaId: instance.soaId, details: { state: instance.state, planYear: instance.planYear },
    });
    // 503, not 500: this is a configuration/availability condition the operator
    // can fix, and the beneficiary must not be told their SOA is on file.
    return res.status(503).json({
      error: 'SOA_EVIDENCE_NOT_STORED',
      reason: stored.reason,
      message: 'The signed document could not be filed, so the scope was not recorded.',
    });
  }

  try {
    instance = completeSoaInstance(instance, {
      completedAt: signedAt,
      integrityHash: evidence.integrityHash,
      evidenceReference: stored.uri,
    });
  } catch (e) {
    console.error('[sign-soa] instance completion failed:', e && e.message);
    return res.status(500).json({ error: 'SOA_EVIDENCE_FAILED' });
  }

  emitAudit({
    action: 'SOA_EVIDENCE_WRITTEN', actor: 'system:sign-soa', result: 'OK', source: instance.source,
    correlationId: instance.soaId, soaId: instance.soaId,
    details: { uri: stored.uri, retentionYears: stored.retentionYears, integrityHash: instance.integrityHash },
  });
  emitAudit({
    action: 'SOA_SIGNED', actor: 'beneficiary:channel-verified', result: 'OK', source: instance.source,
    correlationId: instance.soaId, soaId: instance.soaId,
    details: {
      planYear: instance.planYear, state: instance.state, appointmentId: instance.appointmentId,
      method: instance.method, authorized: instance.authorizedCategories.join(','),
      declined: instance.declinedCategories.join(','),
      stateRulesetVersion: instance.stateRulesetVersion, soaFormVersion: instance.soaFormVersion,
    },
  });

  // ── Mark consumed + persist ────────────────────────────────────────────
  // Burn the link (replay protection) and record the outcome on it. The signed
  // instance is stored under its own key with the EVIDENCE retention class —
  // not back through the 24-hour signing-link TTL, which was enablement blocker
  // #3: "SIGNED RECORD SELF-DESTRUCTS — the SOA evidence disappears a day later."
  var burned = consumeLink(link);
  if (!burned.ok) return res.status(409).json({ error: 'SOA_LINK_UNUSABLE', reason: burned.reason });
  burned.record.soaId = soaId;
  burned.record.signedAt = signedAt;
  var linkWrite = await setRecord(linkKey, burned.record, SOA_TOKEN_TTL_SEC);
  if (!linkWrite.ok) {
    // Without a durable burn the same link could sign twice and create two
    // active scopes for one appointment, so this is not a warning.
    console.error('[sign-soa] could not burn link for soa_id=' + soaId);
    return res.status(503).json({ error: 'SOA_LINK_BURN_FAILED' });
  }
  await setRecord('soa-signed:' + soaId, {
    soaId: soaId,
    signedAt: signedAt,
    pdfHash: pdfHash,
    instance: instance,
    evidenceUri: instance.evidenceReference,
    integrityHash: evidence.integrityHash,
    recordClass: SIGNED_RECORD_CLASS,
  }, SIGNED_RECORD_TTL_SEC);

  // ── Compose GHL note ───────────────────────────────────────────────────
  var ghlNote = [
    '[SOA SIGNED — ClearPoint Senior Advisors]',
    'soa_id: ' + soaId,
    'signed_at: ' + signedAt,
    'signer_full_name: ' + fullName,
    'signer_phone: +1' + phone.replace(/^\+1/, ''),
    'signer_email: ' + (email || '(skipped)'),
    'signer_zip: ' + zip,
    'signer_ip: ' + signerIp,
    'signer_user_agent: ' + signerUserAgent,
    'language: ' + language,
    'language_source: ' + instance.languageSource,
    // CY2027 scope — the fields that make this an appointment-specific
    // instance rather than a standing authorization.
    'plan_year: ' + instance.planYear,
    'residence_state: ' + instance.state,
    'county: ' + (instance.county || '(to be confirmed)'),
    'appointment_id: ' + instance.appointmentId,
    'appointment_at: ' + (instance.appointmentAt || '(not supplied)'),
    'appointment_format: ' + instance.appointmentFormat,
    'state_ruleset_version: ' + instance.stateRulesetVersion,
    'soa_form_version: ' + instance.soaFormVersion,
    'soa_script_version: ' + instance.scriptVersion,
    'soa_method: ' + instance.method,
    'authorized_categories: ' + instance.authorizedCategories.join(', '),
    'declined_categories: ' + (instance.declinedCategories.join(', ') || '(none)'),
    'soa_integrity_hash: ' + instance.integrityHash,
    'soa_evidence_uri: ' + instance.evidenceReference,
    'soa_evidence_retention_years: ' + stored.retentionYears,
    'consent_no_obligation: true',
    'consent_esign_act: true',
    'tpmo_disclaimer_version: ' + TPMO_VERSION,
    'pdf_sha256: ' + pdfHash,
    'agent_name: ' + AGENT_NAME,
    'agent_npn: ' + AGENT_NPN,
    'lead_source: ' + leadSource,
  ].join('\n');

  // ── CY2027 custom fields (spec §18) ────────────────────────────────────
  // AUDIT 2026-10-02 (CRM-27) — sendToGhl() below passes NAMES where
  // GoHighLevel expects opaque field IDs ({ id: 'soa_pdf_hash' }), so those
  // writes never land on a custom field. Creating the fields is an owner action
  // in the sub-account, not something this code may do. So the mapping is
  // explicit and the gap is LOGGED on every signature instead of being silent.
  // CRM-21 — the channel was proven before any prefill was released (sign-soa
  // refuses without link.factorVerifiedAt), so the proof is recorded, not assumed.
  var _cf = buildCustomFields(soaInstanceToFields(instance, {
    CHANNEL_VERIFICATION_STATUS: 'VERIFIED',
    DATA_SENSITIVITY_CLASS: 'SOA_EVIDENCE',
  }));
  var _cfWarn = unmappedFieldsWarning(_cf.unmapped);
  if (_cfWarn) console.warn(_cfWarn);

  // ── Confirmation copy to the beneficiary (spec §9 / EV-07) ─────────────
  // Disabled until the owner configures a channel AND a recorded contact
  // permission exists — the SOA signature itself is NOT that permission (§6).
  // The reason is always logged, so "no copy was sent" is never silent.
  var _copy = await sendCopy({
    channel: email ? 'EMAIL' : 'SMS',
    to: email || phone,
    consent: null, // CALLBACK_CONTACT_PERMISSION is not captured on this path yet
    soaId: soaId,
    evidenceLinkUrl: null, // a one-time retrieval link, once the store is configured
    language: language,
  });
  if (!_copy.sent) console.warn('[SOA-COPY] not sent: ' + _copy.reason);
  emitAudit({
    action: _copy.sent ? 'SOA_LINK_RESENT' : 'SOA_EVIDENCE_WRITE_FAILED',
    actor: 'system:sign-soa', result: _copy.sent ? 'COPY_SENT' : 'COPY_NOT_SENT:' + _copy.reason,
    source: instance.source, correlationId: soaId, soaId: soaId, details: { channel: _copy.channel || null },
  });

  // ── Send to GHL (createOrUpdate contact + add note) ────────────────────
  var ghlOk = false;
  try {
    ghlOk = await sendToGhl({
      firstName: fullName.split(' ')[0] || fullName,
      lastName: fullName.split(' ').slice(1).join(' '),
      phone: '+1' + phone.replace(/^\+1/, ''),
      email: email,
      postalCode: zip,
      address: address,
      preferred_language: language,
      lead_source: leadSource,
      soa_signed: true,
      soa_pdf_hash: pdfHash,
      soa_signed_at: signedAt,
      soa_id: soaId,
      // A year-scoped, appointment-scoped status. The bare soa_signed boolean
      // above cannot distinguish a CY2027 signature from one reused in CY2028,
      // which is why these travel with it.
      soa_plan_year: instance.planYear,
      soa_state: instance.state,
      soa_appointment_id: instance.appointmentId,
      soa_state_ruleset_version: instance.stateRulesetVersion,
      soa_form_version: instance.soaFormVersion,
      soa_authorized_categories: instance.authorizedCategories.join(','),
      soa_integrity_hash: instance.integrityHash,
      // Spec §19: the CRM is the operational INDEX; the evidence itself lives
      // in the approved repository. This is the pointer back to it.
      soa_evidence_uri: instance.evidenceReference,
      note: ghlNote,
      // Only entries with a REAL GoHighLevel id; the rest are logged above.
      cy2027CustomFields: _cf.fields,
      pdfBase64: pdfBuffer.toString('base64'),
    });
  } catch (e) {
    console.error('[sign-soa] GHL post failed', e && e.message);
  }

  // AUDIT 2026-10-01 (EV-12 / WVG-09 / SEC-TOK-03 / CE-06) — this used to return
  // 200 { ok: true } with ghlDelivered:false tucked inside, and the UI showed
  // "Thank you — your SOA has been signed… you will also receive a copy".
  // Spec §21: "Never tell the beneficiary an appointment, update, consent or SOA
  // was saved until the system returns verified success." Spec §26: "CRM write
  // failure -> do not claim saved; queue/retry safely and alert."
  //
  // The signature IS valid — it is hashed, evidenced and the token is burned —
  // but it has not reached the system of record, so the honest answer is
  // "accepted, not yet filed", never "done". 202 keeps the signature (a 500
  // would invite the beneficiary to sign a second time and create a duplicate
  // scope) while refusing to claim delivery.
  if (!ghlOk) {
    console.error('[sign-soa] CRM delivery failed for soa_id=' + soaId + ' — requires manual filing');
    emitAudit({
      action: 'SOA_EVIDENCE_WRITE_FAILED', actor: 'system:sign-soa', result: 'CRM_WRITE_FAILED', source: instance.source,
      correlationId: soaId, soaId: soaId, details: { note: 'signature stored, not filed in the CRM' },
    });
    return res.status(202).json({
      ok: false,
      pending: true,
      // `error` as well as `reason`: the client's existing branch reads
      // data.error, and a bare fallback would show "signing failed".
      error: 'CRM_WRITE_FAILED',
      reason: 'CRM_WRITE_FAILED',
      soaId: soaId,
      signedAt: signedAt,
      pdfHash: pdfHash,
      ghlDelivered: false,
    });
  }

  return res.status(200).json({
    ok: true,
    soaId: soaId,
    signedAt: signedAt,
    pdfHash: pdfHash,
    ghlDelivered: true,
    // EV-14 — the page may only promise a copy if one actually went out.
    copySent: _copy.sent === true,
  });
}

// ── PDF builder ──────────────────────────────────────────────────────────
function buildSoaPdf(opts) {
  return new Promise(function (resolve, reject) {
    try {
      var chunks = [];
      var doc = new PDFDocument({ size: 'LETTER', margin: 50, info: {
        Title: 'Scope of Sales Appointment Confirmation',
        Author: 'ClearPoint Senior Advisors',
        Subject: 'CMS-required SOA — ' + opts.soaId,
      }});
      doc.on('data', function (c) { chunks.push(c); });
      doc.on('end', function () { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);

      var L = opts.lang;
      var title = L === 'es' ? 'Confirmación del Alcance de la Cita de Ventas' : 'Scope of Sales Appointment Confirmation';
      doc.font('Helvetica-Bold').fontSize(18).text('ClearPoint Senior Advisors', { align: 'center' });
      doc.fontSize(13).text(title, { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(8).fillColor('#555').text('SOA ID: ' + opts.soaId + '   |   Signed: ' + opts.signedAt + ' UTC', { align: 'center' });
      doc.fillColor('#000');
      doc.moveDown(0.8);

      // TPMO disclaimer
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'AVISO TPMO (Requerido por CMS)' : 'TPMO DISCLAIMER (CMS-required)');
      // Canonical, contract-year-aware text. assertDisclaimerSignable throws
      // rather than letting a bracketed placeholder reach a signature.
      var tpmoText = tpmoDisclaimerText(L === 'es' ? 'es' : 'en');
      assertDisclaimerSignable(tpmoText);
      doc.font('Helvetica').fontSize(9).text(tpmoText, { align: 'justify' });
      doc.moveDown(0.6);

      // Beneficiary info
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Información del Beneficiario' : 'Beneficiary Information');
      doc.font('Helvetica').fontSize(9);
      kv(doc, L === 'es' ? 'Nombre completo del beneficiario' : 'Beneficiary full name', opts.fullName);
      kv(doc, L === 'es' ? 'Estado de residencia' : 'Residence state', opts.stateName || opts.state);
      kv(doc, L === 'es' ? 'Código postal' : 'ZIP code', opts.zip);
      kv(doc, L === 'es' ? 'Condado' : 'County', opts.county || (L === 'es' ? '(por confirmar)' : '(to be confirmed)'));
      kv(doc, L === 'es' ? 'Fecha de la cita' : 'Appointment date', opts.appointmentAt || '—');
      kv(doc, L === 'es' ? 'Modalidad' : 'Appointment format', opts.appointmentFormat || '—');
      kv(doc, L === 'es' ? 'Año del plan' : 'Plan/contract year', String(opts.planYear));
      kv(doc, L === 'es' ? 'Teléfono' : 'Phone', '+1 ' + opts.phone.replace(/^\+1/, ''));
      kv(doc, L === 'es' ? 'Correo' : 'Email', opts.email || '—');
      doc.moveDown(0.6);

      // Authorized categories — the approved CY2027 wording, from the single
      // canonical source. What was NOT authorized is printed too, because the
      // approved form records the boundary of the scope, not only its contents.
      doc.font('Helvetica-Bold').fontSize(10).text(
        L === 'es' ? 'Categorías que usted autoriza para esta cita' : 'Product categories you authorize for this appointment',
      );
      doc.font('Helvetica').fontSize(9);
      opts.products.forEach(function (code) {
        var c = categoryText(code, L);
        doc.text('[X] ' + (c ? c.label : code));
      });
      if (opts.declined && opts.declined.length) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(9).text(L === 'es' ? 'No autorizado en esta cita:' : 'Not authorized at this appointment:');
        doc.font('Helvetica').fontSize(9);
        opts.declined.forEach(function (code) {
          var c = categoryText(code, L);
          doc.text('[ ] ' + (c ? c.label : code));
        });
      }
      doc.moveDown(0.4);
      doc.fontSize(8).text(SOA_TEXT[L === 'es' ? 'es' : 'en'].important, { align: 'justify' });
      doc.fontSize(9);
      doc.moveDown(0.6);

      // Acknowledgements
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Reconocimientos' : 'Acknowledgements');
      doc.font('Helvetica').fontSize(9);
      doc.text('[X] ' + (L === 'es'
        // G32 — same neutral register as the English line beside it.
        ? 'Entiendo que esto no es una inscripción y que no hay obligación.'
        : 'I understand this is not an enrollment, and there is no obligation.'));
      doc.text('[X] ' + (L === 'es'
        ? 'Acepto firmar este documento electrónicamente (Ley ESIGN, 15 U.S.C. §7001).'
        : 'I agree to sign this electronically (ESIGN Act, 15 U.S.C. §7001).'));
      doc.moveDown(0.6);

      // Signature
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Firma Electrónica del Beneficiario' : 'Beneficiary Electronic Signature');
      doc.font('Helvetica-Oblique').fontSize(14).text(opts.signature);
      doc.font('Helvetica').fontSize(8).fillColor('#555').text((L === 'es' ? 'Firmado el ' : 'Signed on ') + opts.signedAt + ' UTC  ·  ' + (L === 'es' ? 'IP: ' : 'IP: ') + opts.signerIp);
      doc.fillColor('#000');
      doc.font('Helvetica').fontSize(9);
      // AUDIT 2026-10-02 (G18/G20/G21/G19) — the approved signature block has
      // four entries plus the representative line, not just the typed name.
      kv(doc, L === 'es' ? 'Nombre en letra de molde' : 'Printed name', opts.signature);
      kv(doc, L === 'es' ? 'Fecha y hora' : 'Date/time', opts.signedAt + ' UTC');
      kv(doc, L === 'es' ? 'Método de confirmación electrónica' : 'Electronic affirmation method',
        L === 'es' ? 'Firma electrónica en la web' : 'Web electronic signature');
      kv(doc, L === 'es' ? 'Relación o autoridad si firma un representante' : 'Relationship/authority if representative',
        opts.representativeRelationship || (L === 'es' ? '(firma el beneficiario)' : '(beneficiary signing)'));
      doc.moveDown(0.6);

      // AUDIT 2026-10-02 (G24/G27/EV-04) — "System evidence — not
      // customer-editable". The approved template prints it, and without it the
      // signed artifact cannot say which form version or state ruleset governed
      // the signature, which is the whole point of versioning them.
      doc.font('Helvetica-Bold').fontSize(10).text(
        L === 'es' ? 'Evidencia del sistema — no editable por el cliente' : 'System evidence — not customer-editable');
      doc.font('Helvetica').fontSize(8);
      kv(doc, 'SOA_ID', opts.soaId);
      kv(doc, 'SOA_FORM_VERSION', opts.soaFormVersion || '—');
      kv(doc, 'STATE_RULESET_VERSION', opts.stateRulesetVersion || '—');
      kv(doc, 'SOA_SCRIPT_VERSION', opts.scriptVersion || '—');
      kv(doc, L === 'es' ? 'Idioma' : 'Language', L === 'es' ? 'ES' : 'EN');
      // G08 — the language of the document is also EVIDENCE: a reader has to be
      // able to tell that the beneficiary elected it rather than that a default
      // picked it for them.
      kv(doc, L === 'es' ? 'Elección de idioma' : 'Language election',
        opts.languageSource === 'REPRESENTATIVE_ELECTED'
          ? (L === 'es' ? 'Elegido por el representante' : 'Elected by representative')
          : (L === 'es' ? 'Elegido por el beneficiario' : 'Elected by beneficiary'));
      kv(doc, L === 'es' ? 'Creado' : 'Created at', opts.signedAt + ' UTC');
      kv(doc, L === 'es' ? 'Completado' : 'Completed at', opts.signedAt + ' UTC');
      kv(doc, L === 'es' ? 'Origen' : 'Source', opts.source || 'WEB');
      kv(doc, 'APPOINTMENT_ID', opts.appointmentId || '—');
      kv(doc, L === 'es' ? 'Hash de integridad' : 'Integrity hash', opts.integrityHash || '—');
      kv(doc, L === 'es' ? 'Referencia de evidencia' : 'Evidence reference', opts.evidenceReference || '—');
      doc.fontSize(9);
      doc.moveDown(0.6);

      // Security warning, verbatim from the approved template.
      doc.fontSize(8).fillColor('#555').text(SOA_TEXT[L === 'es' ? 'es' : 'en'].security, { align: 'justify' });
      doc.fillColor('#000').fontSize(9);
      doc.moveDown(0.6);

      // Agent
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Agente / Agencia' : 'Agent / Agency');
      doc.font('Helvetica').fontSize(9);
      kv(doc, L === 'es' ? 'Agente' : 'Agent', AGENT_NAME);
      kv(doc, 'NPN', AGENT_NPN);
      kv(doc, L === 'es' ? 'Agencia' : 'Agency', 'ClearPoint Senior Advisors');
      kv(doc, L === 'es' ? 'Teléfono' : 'Phone', '1-855-720-8555');

      // Footer
      doc.moveDown(1);
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#777').text(
        L === 'es'
          ? 'Este documento es un registro auditado electrónicamente y cumple con la Ley ESIGN (15 U.S.C. §7001). Hash SHA-256 del documento se almacena en GHL.'
          : 'This document is an electronically audited record and is compliant with the ESIGN Act (15 U.S.C. §7001). SHA-256 hash of this document is stored in GHL.',
        { align: 'center' }
      );

      doc.end();
    } catch (e) { reject(e); }
  });
}

function kv(doc, k, v) {
  doc.font('Helvetica-Bold').fontSize(9).text(k + ': ', { continued: true });
  doc.font('Helvetica').fontSize(9).text(String(v));
}

// ── GHL delivery ─────────────────────────────────────────────────────────
async function sendToGhl(payload) {
  var token = process.env.HIGHLEVEL_TOKEN;
  var locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) return false;

  // Step 1 — createOrUpdate contact (matches by phone)
  var contactBody = {
    locationId: locationId,
    firstName: payload.firstName || '',
    lastName: payload.lastName || '',
    phone: payload.phone || '',
    email: payload.email || '',
    postalCode: payload.postalCode || '',
    address1: payload.address || '',
    source: 'website-soa',
    tags: ['soa_signed', payload.lead_source || 'unknown'],
    customFields: [
      // AUDIT 2026-10-02 (CRM-27) — these five entries pass NAMES where
      // GoHighLevel expects opaque field IDs, so they have never landed on a
      // custom field. They are left in place rather than deleted because
      // removing them would change nothing and hide the history; the real
      // fields arrive through cy2027CustomFields below, which carries only
      // entries with a configured ID. See api/_lib/cy2027/crm-fields.js.
      { id: 'soa_signed', field_value: 'true' },
      { id: 'soa_pdf_hash', field_value: payload.soa_pdf_hash },
      { id: 'soa_signed_at', field_value: payload.soa_signed_at },
      { id: 'soa_id', field_value: payload.soa_id },
      { id: 'preferred_language', field_value: payload.preferred_language },
      ...(Array.isArray(payload.cy2027CustomFields) ? payload.cy2027CustomFields : []),
    ],
  };

  var contactRes;
  try {
    contactRes = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify(contactBody),
    });
  } catch (e) { console.error('[ghl] upsert failed', e && e.message); return false; }

  if (!contactRes.ok) {
    console.error('[ghl] upsert non-2xx', contactRes.status);
    return false;
  }
  var contactData = await contactRes.json();
  var contactId = (contactData && contactData.contact && contactData.contact.id) || (contactData && contactData.id) || null;
  if (!contactId) { console.error('[ghl] no contactId returned'); return false; }

  // Step 2 — add structured note
  try {
    var noteRes = await fetch('https://services.leadconnectorhq.com/contacts/' + encodeURIComponent(contactId) + '/notes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({ userId: 'system', body: payload.note }),
    });
    if (!noteRes.ok) console.warn('[ghl] note non-2xx', noteRes.status);
  } catch (e) { console.warn('[ghl] note failed', e && e.message); }

  // Step 3 — Try to attach PDF as file (best-effort; some GHL plans don't support)
  if (payload.pdfBase64) {
    try {
      var fileRes = await fetch('https://services.leadconnectorhq.com/contacts/' + encodeURIComponent(contactId) + '/notes', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({
          userId: 'system',
          body: '[SOA PDF — base64 of signed document, hash: ' + payload.soa_pdf_hash + ']',
        }),
      });
      // We don't fail the whole flow if file attach fails; the note + hash
      // are sufficient compliance artifacts.
      if (!fileRes.ok) console.warn('[ghl] file note non-2xx', fileRes.status);
    } catch (e) { console.warn('[ghl] file attach failed', e && e.message); }
  }

  return true;
}

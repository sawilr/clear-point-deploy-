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
import { getSoaToken, setSoaToken } from './_lib/soa-store.js';
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
import { createSoaInstance, completeSoaInstance } from './_lib/cy2027/soa-instance.js';
import { ALL_CATEGORY_CODES, SOA_TEXT, categoryText } from './_lib/cy2027/soa-text.js';
import { buildEvidenceRecord } from './_lib/cy2027/evidence.js';

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
  var token = typeof body.token === 'string' ? body.token : '';
  if (!/^[a-f0-9-]{36}$/i.test(token)) return res.status(400).json({ error: 'Invalid token' });

  var record;
  try { record = await getSoaToken(token); } catch (e) { record = null; }
  if (!record) return res.status(404).json({ error: 'Token not found or expired' });
  if (record.consumed) return res.status(409).json({ error: 'SOA already signed for this token' });

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
  var language = body.language === 'en' ? 'en' : 'es';
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
      planYear: instance.planYear,
      declined: instance.declinedCategories,
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
    instance = completeSoaInstance(instance, {
      completedAt: signedAt,
      integrityHash: evidence.integrityHash,
      evidenceReference: 'pdf:sha256:' + pdfHash,
    });
  } catch (e) {
    console.error('[sign-soa] evidence build failed:', e && e.message);
    return res.status(500).json({ error: 'SOA_EVIDENCE_FAILED' });
  }

  // ── Mark consumed + persist ────────────────────────────────────────────
  record.consumed = true;
  record.consumedAt = signedAt;
  record.soaId = soaId;
  record.pdfHash = pdfHash;
  record.soaInstance = instance;
  record.soaIntegrityHash = evidence.integrityHash;
  try { await setSoaToken(token, record); } catch (e) { /* log but don't fail */ console.error('[sign-soa] token update failed', e && e.message); }

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
    'consent_no_obligation: true',
    'consent_esign_act: true',
    'tpmo_disclaimer_version: ' + TPMO_VERSION,
    'pdf_sha256: ' + pdfHash,
    'agent_name: ' + AGENT_NAME,
    'agent_npn: ' + AGENT_NPN,
    'lead_source: ' + leadSource,
  ].join('\n');

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
      note: ghlNote,
      pdfBase64: pdfBuffer.toString('base64'),
    });
  } catch (e) {
    console.error('[sign-soa] GHL post failed', e && e.message);
  }

  return res.status(200).json({
    ok: true,
    soaId: soaId,
    signedAt: signedAt,
    pdfHash: pdfHash,
    ghlDelivered: ghlOk,
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
        ? 'Entiendo que esto NO es una inscripción y NO hay obligación.'
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
      { id: 'soa_signed', field_value: 'true' },
      { id: 'soa_pdf_hash', field_value: payload.soa_pdf_hash },
      { id: 'soa_signed_at', field_value: payload.soa_signed_at },
      { id: 'soa_id', field_value: payload.soa_id },
      { id: 'preferred_language', field_value: payload.preferred_language },
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

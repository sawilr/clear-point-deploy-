// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — EVIDENCE AND AUDIT (spec §19, §30). SERVER ONLY (uses node:crypto).
//
// "Every SOA stores the exact customer-facing text/version used, not merely the
//  final checkbox values."
// "Audit every SOA view/sign/send/resend/revoke; log actor, timestamp, action,
//  result, source and correlation ID."
// "Redact sensitive values from logs, monitoring, error traces and analytics."
//
// The integrity hash covers the rendered text AND the selections AND the
// identifiers, so a later edit to any of them is detectable. It deliberately
// does NOT cover volatile fields (evidenceReference, storage URIs) that are
// assigned after hashing.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { SOA_TEXT, SOA_SCRIPT_VERSION, categoryText, soaTitle, SOA_AGENT_LINE } from './soa-text.js';
import { RECORD_CLASS } from './retention.js';
import { isSoaLanguage, languageWasElected, electionAttributionError } from './soa-instance.js';

/** Stable key ordering so the same logical object always hashes the same. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.keys(value)
    .sort()
    .reduce((acc, k) => {
      if (value[k] !== undefined) acc[k] = canonical(value[k]);
      return acc;
    }, {});
}

/** sha256 hex of the canonical JSON form. */
export function integrityHash(payload) {
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(canonical(payload)), 'utf8').digest('hex');
}

/**
 * Snapshot of EXACTLY what the beneficiary was shown, in their language.
 * This is what makes the evidence self-explaining years later: a reviewer does
 * not need this repository at that version to know what the person agreed to.
 */
export function renderTextSnapshot(instance, stateName) {
  // RED TEAM 2026-10-03 (G08) — this was `instance.language === 'es' ? 'es' : 'en'`:
  // an instance with no language produced an ENGLISH snapshot and a valid hash.
  // The snapshot claims to be exactly what the person was shown; it cannot be
  // built for a language nobody recorded.
  if (!instance || !isSoaLanguage(instance.language)) {
    throw new Error('evidence: the instance has no document language (SOA_LANGUAGE_NOT_ELECTED)');
  }
  const lang = instance.language;
  const t = SOA_TEXT[lang];
  const shown = (codes) =>
    codes.map((code) => {
      const c = categoryText(code, lang);
      return { code, label: c.label, description: c.description };
    });
  return {
    language: lang,
    scriptVersion: instance.scriptVersion || SOA_SCRIPT_VERSION,
    org: t.org,
    title: soaTitle(lang, stateName),
    subtitle: t.subtitle,
    intro: t.intro,
    categoriesHeading: t.categoriesHeading,
    categoriesHelp: t.categoriesHelp,
    categoriesAuthorized: shown(instance.authorizedCategories || []),
    categoriesDeclined: shown(instance.declinedCategories || []),
    nonAuthorizingSelections: shown(instance.nonAuthorizingSelections || []),
    important: t.important,
    authorizationStatement: t.authorizationStatement,
    security: t.security,
    agentLine: SOA_AGENT_LINE,
  };
}

/**
 * Build the complete, immutable evidence record for a signed SOA.
 * Returns the record plus its hash; the caller persists both and only then
 * calls completeSoaInstance().
 */
export function buildEvidenceRecord(instance, { stateName, signature, signedAt = new Date().toISOString(), sourceIp = null, userAgent = null, correlationId = null }) {
  if (!instance) throw new Error('evidence: no instance');
  if (!signature) throw new Error('evidence: signature/affirmation is required');
  // RED TEAM 2026-10-03 (G08, HIGH) — the election reached the PDF, the note and
  // a CRM field, but NOT this record: hash(BENEFICIARY_ELECTED) equalled
  // hash(SYSTEM_DEFAULT) equalled hash(no election at all), so the one field
  // G08 exists to make legible could be swapped with verifyEvidence() still ok.
  // It is now inside the hashed core, and a record cannot be built without it.
  if (!isSoaLanguage(instance.language) || !languageWasElected(instance.languageSource)) {
    throw new Error('evidence: refusing to evidence an instance whose language was not elected (SOA_LANGUAGE_NOT_ELECTED)');
  }
  const attribution = electionAttributionError(instance.languageSource, instance.representativeRelationship);
  if (attribution) {
    throw new Error('evidence: the election and the signer disagree (' + attribution + ')');
  }
  // AUDIT 2026-10-04 (red team, SPEC-22) — spec §22: "Every live SOA/call points
  // to the exact ruleset version used at that date/time." The record named the
  // state ruleset and the form and not the CMS ruleset. It is inside the hashed
  // core below, and a record cannot be built without it.
  if (typeof instance.cmsRulesetVersion !== 'string' || !instance.cmsRulesetVersion) {
    throw new Error('evidence: the instance does not name the CMS ruleset version it was signed under (SOA_CMS_RULESET_VERSION_MISSING)');
  }

  const textSnapshot = renderTextSnapshot(instance, stateName);
  const core = {
    soaId: instance.soaId,
    appointmentId: instance.appointmentId,
    appointmentAt: instance.appointmentAt,
    appointmentFormat: instance.appointmentFormat,
    planYear: instance.planYear,
    state: instance.state,
    zip: instance.zip,
    county: instance.county,
    language: instance.language,
    languageSource: instance.languageSource,
    method: instance.method,
    source: instance.source,
    beneficiaryName: instance.beneficiaryName,
    representativeRelationship: instance.representativeRelationship,
    authorizedCategories: instance.authorizedCategories,
    declinedCategories: instance.declinedCategories,
    nonAuthorizingSelections: instance.nonAuthorizingSelections,
    cmsRulesetVersion: instance.cmsRulesetVersion,
    stateRulesetVersion: instance.stateRulesetVersion,
    soaFormVersion: instance.soaFormVersion,
    scriptVersion: instance.scriptVersion,
    supersedesId: instance.supersedesId,
    signature,
    signedAt,
    // Covered by the hash (EF-06): retention is measured from createdAt, so a
    // backdated record would otherwise shorten its own retention undetected.
    createdAt: signedAt,
    textSnapshot,
  };

  const hash = integrityHash(core);
  return {
    record: {
      ...core,
      recordClass: RECORD_CLASS.SOA_EVIDENCE,
      holds: [],
      integrityHash: hash,
      // Context kept for the audit trail but excluded from the hash so that a
      // proxy/IP change can never look like tampering with the agreement.
      context: { sourceIp, userAgent: userAgent ? String(userAgent).slice(0, 180) : null, correlationId },
    },
    integrityHash: hash,
  };
}

/** Recompute and compare. Use before relying on a stored evidence record. */
export function verifyEvidence(record) {
  if (!record || !record.integrityHash) return { ok: false, reason: 'NO_HASH' };
  // RED TEAM 2026-10-02 (EF-06, HIGH) — `createdAt` was excluded from the hash
  // alongside the volatile context, so a record could be backdated (changing
  // when retention expires) and still verify. It is part of the agreement's
  // meaning and is covered again. `holds`/`releasedHolds` stay outside: they are
  // operational state applied AFTER signature, and freezing them in the hash
  // would make every legal hold look like tampering.
  const { recordClass, holds, integrityHash: stored, context, releasedHolds, evidenceReference, ...core } = record;
  const recomputed = integrityHash(core);
  return recomputed === stored ? { ok: true } : { ok: false, reason: 'HASH_MISMATCH', stored, recomputed };
}

// ── Audit log ────────────────────────────────────────────────────────────────

export const AUDIT_ACTIONS = Object.freeze([
  'SOA_LINK_ISSUED', 'SOA_LINK_RESENT', 'SOA_VIEWED', 'SOA_SIGNED', 'SOA_REFUSED', 'SOA_SUPERSEDED',
  'SOA_REVOKED', 'SOA_EVIDENCE_WRITTEN', 'SOA_EVIDENCE_WRITE_FAILED',
  'MARKETING_GATE_ALLOWED', 'MARKETING_GATE_BLOCKED',
  'SECURITY_QUARANTINE', 'SECURITY_REVIEW_RESOLVED',
  'CONSENT_RECORDED', 'CONSENT_REVOKED',
]);

/**
 * Values that must never reach a log line.
 *
 * RED TEAM 2026-10-02 (EF-04, HIGH) — this was an EXACT-match list, so the
 * ordinary spellings of the same identifiers walked straight through:
 * ssn_number, socialSecurity, social_security_number, memberId, medicareId,
 * accountNumber, cardNumber, routing, dateOfBirth, birthDate, accessToken,
 * apiKey, secret. Matching on a substring of the normalized key closes that.
 */
const REDACT_KEY_PARTS = [
  'ssn', 'socialsecurity', 'mbi', 'medicarenumber', 'medicareid', 'memberid', 'beneficiaryid',
  'bank', 'account', 'routing', 'iban', 'card', 'cvv', 'cvc', 'pan',
  'dob', 'dateofbirth', 'birthdate', 'birthday',
  'password', 'passcode', 'pin', 'token', 'secret', 'apikey', 'authorization', 'cookie', 'signature',
];

function shouldRedactKey(key) {
  const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return REDACT_KEY_PARTS.some((p) => k.includes(p));
}

/**
 * Redaction for anything handed to the audit log.
 *
 * RED TEAM 2026-10-02 (EF-03, HIGH) — arrays were skipped entirely, so
 * `details: { people: [{ ssn: '…' }] }` logged the SSN in clear. Arrays are now
 * walked like any other container.
 */
export function redactForLog(obj, depth = 0) {
  if (depth > 8) return '[depth-limited]';
  if (Array.isArray(obj)) return obj.map((v) => redactForLog(v, depth + 1));
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (shouldRedactKey(k)) { out[k] = '[redacted]'; continue; }
    if (v && typeof v === 'object') { out[k] = redactForLog(v, depth + 1); continue; }
    out[k] = v;
  }
  return out;
}

/**
 * Build one audit event. Every field the spec names is required; a missing one
 * throws rather than producing an event that cannot answer "who did what".
 */
/**
 * Emit an audit event to the log.
 *
 * AUDIT 2026-10-02 (EV-06 / WVG-18 / SEC-TOK-07) — auditEvent() existed and was
 * called by nothing, so "audit every SOA view/sign/send/resend/revoke" (spec
 * §19, §30) was satisfied by a function that never ran. A builder nobody
 * invokes is not an audit trail.
 *
 * One stable prefix so the lines are greppable and shippable to a drain, and
 * `redactForLog` already applied by auditEvent() before anything reaches here.
 * Never throws: a logging failure must not fail a signature that is otherwise
 * valid, but it must be visible.
 */
export function emitAudit(fields) {
  try {
    console.warn('[SOA-AUDIT] ' + JSON.stringify(auditEvent(fields)));
  } catch (e) {
    console.error('[SOA-AUDIT] could not record an audit event: ' + (e && e.message));
  }
}

export function auditEvent({ action, actor, result, source, correlationId, soaId = null, details = {}, at = new Date().toISOString() }) {
  if (!AUDIT_ACTIONS.includes(action)) throw new Error(`evidence: unknown audit action "${action}"`);
  if (!actor) throw new Error('evidence: audit event requires an actor');
  if (!result) throw new Error('evidence: audit event requires a result');
  if (!source) throw new Error('evidence: audit event requires a source');
  if (!correlationId) throw new Error('evidence: audit event requires a correlationId');
  // RED TEAM 2026-10-02 (EF-05, LOW) — only `details` was redacted, so a
  // structured actor carried SSN/DOB straight into the log line.
  return {
    at, action, result, source, correlationId, soaId,
    actor: typeof actor === 'object' ? redactForLog(actor) : actor,
    details: redactForLog(details),
  };
}

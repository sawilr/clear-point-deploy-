// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — THE WEB CALLBACK CONSENT, AS A RECORD (spec §6, §18, §24). SERVER ONLY.
//
// AUDIT 2026-10-02 (CE-09 / CRM-15) — api/submit-lead.js recorded a consent as
// four channel booleans. This is the one function that turns what a submission
// ATTESTS TO into (a) a consent object carrying the scope its wording states,
// (b) the CRM values for it, and (c) the line that goes into the TCPA receipt.
//
// It is a function, and not forty lines inside the handler, so that every rule
// in it can be tested by calling it — the first version of two earlier fixes in
// this layer was "verified" by source greps that a full revert still passed.
//
// What it guarantees:
//   • The digest is computed HERE, over the text RECEIVED. The client's own
//     consent_receipt_hash is a claim; it is compared, never trusted.
//   • The scope comes from the registry in consent.js and from nowhere else.
//     Nothing about the lead (interest, language, source) is an input.
//   • A GRANTED status is never sent to the CRM without the scope it is limited
//     to. If any of the three values has no GoHighLevel id yet, NONE is sent:
//     "granted, scope unknown" is the exact record this finding is about.
//   • It never throws and never rejects anything. When no consent object can be
//     built, the caller gets a named reason, a flag for a human, and no field.
//     The lead itself is the handler's business and is captured as before.
//   • Every log line and receipt value it produces is built from fixed strings
//     and reason codes — never the text, the hash, or anything about a person.
//
// Uses node:crypto, so it is NOT re-exported by the barrel (index.js).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { webCallbackConsent } from './consent.js';
import { buildCustomFields, consentsToFields, unmappedFieldsWarning } from './crm-fields.js';

/** Lands in contact.lead_quality_flags so a human sees the lead has no consent object. */
export const CALLBACK_CONSENT_NOT_RECORDED_FLAG = 'CALLBACK_CONSENT_NOT_RECORDED';

/** The three §18 values a granted callback consent is made of. All, or none. */
const GRANT_FIELDS = Object.freeze(['CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_SCOPE']);

function notRecorded(reason) {
  return Object.freeze({
    consent: null,
    reason,
    fields: Object.freeze([]),
    unmapped: Object.freeze([]),
    withheld: Object.freeze([]),
    receiptBit: 'callback_consent=NOT_RECORDED(' + reason + ')',
    flag: CALLBACK_CONSENT_NOT_RECORDED_FLAG,
    // Reason code only — never the text, the hash, or anything about the person.
    warnings: Object.freeze(['[CALLBACK-CONSENT] not recorded as a consent object: ' + reason]),
  });
}

/**
 * What the caller falls back to if this module itself cannot be reached. The
 * function below does not throw; this exists so the handler's own guard has a
 * well-formed record to use instead of inventing one.
 */
export const CALLBACK_CONSENT_UNAVAILABLE = notRecorded('CALLBACK_CONSENT_BUILD_FAILED');

/**
 * @param {object} input
 *   consentGiven       body.consent_to_contact, as received (only `true` counts)
 *   disclaimerVersion  the version label the submission cites
 *   consentText        the consent text RECEIVED, raw — not scrubbed, not trimmed
 *   receiptHash        the client's own SHA-256 of that text, if it sent one
 *   at                 the server's instant for this consent (ISO, UTC)
 * @param {object} env  process.env by default; CY2027_CRM_FIELD_IDS is read from it
 *
 * @returns a frozen record:
 *   consent     the frozen consent object, or null
 *   reason      CALLBACK_CONSENT_RECORDED, or the named refusal
 *   fields      CRM customFields entries that are safe to send (possibly empty)
 *   unmapped    §18 names with no GoHighLevel id configured
 *   withheld    §18 names that HAVE an id but were not sent (see GRANT_FIELDS)
 *   receiptBit  'scope=<SCOPE>' or 'callback_consent=NOT_RECORDED(<reason>)'
 *   flag        null, or CALLBACK_CONSENT_NOT_RECORDED_FLAG
 *   warnings    PII-free lines for the caller to log
 */
export function recordWebCallbackConsent(input, env = process.env) {
  try {
    const src = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const text = typeof src.consentText === 'string' ? src.consentText : '';
    const decision = webCallbackConsent({
      consentGiven: src.consentGiven,
      disclaimerVersion: src.disclaimerVersion,
      consentTextSha256: text ? createHash('sha256').update(text, 'utf8').digest('hex') : '',
      receiptHash: src.receiptHash,
      at: src.at,
    });
    if (!decision.consent) return notRecorded(decision.reason);

    const built = buildCustomFields(consentsToFields({ callbackConsent: decision.consent }), env);
    // All three, or none. Each value is either sent, unmapped (no id yet) or
    // refused by the mapping, so "three entries to send" is the whole test.
    const complete = built.fields.length === GRANT_FIELDS.length;
    const withheld = complete ? [] : GRANT_FIELDS.filter((n) => !built.unmapped.includes(n));
    const warnings = [];
    // Same visible-gap rule as sign-soa: a field with no GoHighLevel id is named
    // in the log on every lead, not discovered during an audit.
    const gap = unmappedFieldsWarning(built.unmapped);
    if (gap) warnings.push(gap);
    if (withheld.length) {
      warnings.push(
        '[CY2027-CRM] ' + withheld.join(', ') + ' not written either: a callback consent is sent to the CRM ' +
        'with its status, its timestamp AND its scope, or not at all. The scope is in the TCPA receipt line ' +
        'of the contact note meanwhile.',
      );
    }
    return Object.freeze({
      consent: decision.consent,
      reason: decision.reason,
      fields: Object.freeze(complete ? built.fields.map((f) => Object.freeze(f)) : []),
      unmapped: Object.freeze(built.unmapped.slice()),
      withheld: Object.freeze(withheld),
      receiptBit: 'scope=' + decision.consent.scope,
      flag: null,
      warnings: Object.freeze(warnings),
    });
  } catch {
    // Observability must never cost a consented lead.
    return CALLBACK_CONSENT_UNAVAILABLE;
  }
}

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
//     "granted, scope unknown" is the exact record this finding is about. That
//     rule lives in buildCustomFields() (crm-fields.js), where the value leaves.
//   • It never throws and never rejects anything. When no consent object can be
//     built, the caller gets a named reason, a flag for a human, and no field.
//     The lead itself is the handler's business and is captured as before.
//   • Every log line and receipt value it produces is built from fixed strings
//     and reason codes — never the text, the hash, or anything about a person.
//
// AUDIT 2026-10-04 (CE-09 / CRM-15, red team) — an independent red
// team broke the first version of this fix in the two handlers, not in the
// function above. Everything a handler needs to stay correct now lives here as a
// pure function, tested by calling it:
//   • tcpaReceiptLine()            the receipt line. The server's statement is
//                                  FIRST; every client claim comes after it and
//                                  cannot contain receipt syntax.
//   • neutralizeReceiptLookalikes() client prose cannot read as the receipt.
//   • recordCallbackRevocation()   the revocation, all-or-none, and an instant
//                                  that is in force is never moved.
//   • crmRefusalStep()             one retry policy for both handlers.
//
// Uses node:crypto, so it is NOT re-exported by the barrel (index.js).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { webCallbackConsent, isIsoInstant, CONSENT_STATUS } from './consent.js';
import {
  buildCustomFields, consentsToFields, callbackRevocationToFields, fieldIdMap, unmappedFieldsWarning,
} from './crm-fields.js';

/** Lands in contact.lead_quality_flags so a human sees the lead has no consent object. */
export const CALLBACK_CONSENT_NOT_RECORDED_FLAG = 'CALLBACK_CONSENT_NOT_RECORDED';

/** The three §18 values a granted callback consent is made of. All, or none. */
const GRANT_FIELDS = Object.freeze(['CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_SCOPE']);

/**
 * The records THIS module built. The receipt is written from one of these and
 * from nothing else: an object assembled by hand, or read back from somewhere,
 * carries whatever `receiptBit` its author liked.
 */
const ISSUED = new WeakSet();
const issue = (record) => { ISSUED.add(record); return record; };

function notRecorded(reason) {
  return issue(Object.freeze({
    consent: null,
    reason,
    fields: Object.freeze([]),
    unmapped: Object.freeze([]),
    withheld: Object.freeze([]),
    receiptBit: 'callback_consent=NOT_RECORDED(' + reason + ')',
    flag: CALLBACK_CONSENT_NOT_RECORDED_FLAG,
    // Reason code only — never the text, the hash, or anything about the person.
    warnings: Object.freeze(['[CALLBACK-CONSENT] not recorded as a consent object: ' + reason]),
  }));
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
 *   disclaimerVersion  the version label the submission cites, AS RECEIVED
 *   consentText        the consent text RECEIVED, raw — not scrubbed, not trimmed
 *   receiptHash        the client's own SHA-256 of that text, AS RECEIVED
 *   at                 the server's instant for this consent (ISO, UTC)
 * @param {object} env  process.env by default; CY2027_CRM_FIELD_IDS is read from it
 *
 * The three client values are passed AS RECEIVED on purpose (red team
 * 2026-10-04): the handler used to strip characters out of the hash and the
 * version label first, which turned `false`, `12345` and 'ZZZZ' into "no hash
 * sent" and ' 2026-06-01\n' into the registered label — so the "present but not
 * the digest" and "exact label" rules below never ran on live input.
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
    // The write stage refusing a consent this function has just built means the
    // registry and the mapping disagree. That is not "recorded".
    if (built.refused.length) return notRecorded('CALLBACK_CONSENT_REFUSED_AT_WRITE');
    // All three, or none — buildCustomFields() enforces it; this only reads the result.
    const complete = built.fields.length === GRANT_FIELDS.length;
    const withheld = complete ? [] : built.withheld.slice();
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
    return issue(Object.freeze({
      consent: decision.consent,
      reason: decision.reason,
      fields: Object.freeze(complete ? built.fields.map((f) => Object.freeze(f)) : []),
      unmapped: Object.freeze(built.unmapped.slice()),
      withheld: Object.freeze(withheld),
      receiptBit: 'scope=' + decision.consent.scope,
      flag: null,
      warnings: Object.freeze(warnings),
    }));
  } catch {
    // Observability must never cost a consented lead.
    return CALLBACK_CONSENT_UNAVAILABLE;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RECEIPT LINE
//
// RED TEAM 2026-10-04 (HIGH) — the handler joined its receipt as
//   sha256 · disclaimer · ua · at · ip · page · <scope>
// with ' · ' and the user agent was only PHI-scrubbed. A sender whose
// signer_user_agent was 'M · scope=ANY_PRODUCT_TELEMARKETING' got a
// server-authored line stating two scopes, theirs first; and a REFUSED consent
// could be made to read 'scope=DISCUSS_MEDICARE_PLAN_OPTIONS'. This line is the
// only holder of the scope until the owner creates the GoHighLevel fields.
//
// Two independent defences, either of which closes it:
//   1. ORDER — the server's statement is the FIRST value on the line, followed
//      by the server's clock and the proxy-chain address. Client claims come
//      after all of them.
//   2. SYNTAX — a client claim is reduced to a character set that cannot spell
//      a separator or a key: no '=', no '·', no dash, no line break.
// ─────────────────────────────────────────────────────────────────────────────

const RECEIPT_HEADER = '— TCPA Receipt — ';
const RECEIPT_SEPARATOR = ' · ';

/**
 * A client-supplied value, reduced to characters that cannot form receipt
 * syntax. An allow-list: letters, digits, space and `. / ; : ( ) , _ + -`.
 * Anything else — '=', '·', '—', a line break, any non-ASCII — becomes a space.
 */
export function receiptClaim(value, max = 60) {
  if (typeof value !== 'string') return '';
  const limit = Number.isInteger(max) && max > 0 ? max : 60;
  return value.slice(0, 480).replace(/[^A-Za-z0-9 ./;:(),_+-]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, limit).trim();
}

/**
 * The values of the receipt, in order, for a record this module built.
 *
 * @param record  what recordWebCallbackConsent() returned. Anything else — a
 *                look-alike object, a copy, null — is treated as "could not be
 *                built" and says so; its own `receiptBit` is never read.
 * @param parts   at          the server's instant (used only when the record has
 *                            no consent object; a recorded consent prints ITS instant)
 *                ip          the trusted proxy-chain address; omit the key to print none
 *                receiptHash / disclaimerVersion / page / userAgent — client
 *                            claims, printed only when exactly well-formed
 */
function consentReceiptBits(record, parts) {
  const rec = ISSUED.has(record) ? record : CALLBACK_CONSENT_UNAVAILABLE;
  const p = parts !== null && typeof parts === 'object' && !Array.isArray(parts) ? parts : {};
  // A value that cannot be read is a value that was not given: nothing a caller
  // passes may cost the line its first, server-authored statement.
  const read = (key) => { try { return p[key]; } catch { return undefined; } };
  const given = (key) => { try { return key in p; } catch { return false; } };
  const at = rec.consent ? rec.consent.at : read('at');
  // ── authored by the server ──
  const bits = [rec.receiptBit, 'at=' + (isIsoInstant(at) ? at : 'unavailable')];
  if (given('ip')) {
    const ip = read('ip');
    bits.push('ip=' + (typeof ip === 'string' && /^[0-9a-f:.]{3,45}$/i.test(ip) ? ip : 'unavailable'));
  }
  // ── claimed by the client: shown only when exactly well-formed, never repaired ──
  const hash = read('receiptHash');
  if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) bits.push('sha256=' + hash);
  const version = read('disclaimerVersion');
  if (typeof version === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(version)) bits.push('disclaimer=' + version);
  const page = read('page');
  if (typeof page === 'string' && /^\/[A-Za-z0-9/_.-]{0,119}$/.test(page)) bits.push('page=' + page);
  const ua = receiptClaim(read('userAgent'), 60);
  if (ua) bits.push('ua=' + ua);
  return bits;
}

/** The receipt values joined, without a header (the repeat-request note has its own). */
export function consentReceiptText(record, parts) {
  return consentReceiptBits(record, parts).join(RECEIPT_SEPARATOR);
}

/** The one line of a contact note that reads as the TCPA receipt. */
export function tcpaReceiptLine(record, parts) {
  return RECEIPT_HEADER + consentReceiptText(record, parts);
}

// AUDIT 2026-10-04 (CE-09 / CRM-15) — these were LISTS of a few code points
// (seven dashes, five invisible characters, three equals signs), and a list of
// look-alikes is a deny-list: '—<U+200E> TCPA Receipt — scope<U+200E>=ANY' (a
// left-to-right mark, which shows nothing) went through untouched, as did the
// soft hyphen, the box-drawing dash and '⁼'. They are now CLASSES:
//   a dash    every character Unicode calls dash punctuation (\p{Pd}) except the
//             ASCII hyphen — which is what a neutralised header is written with —
//             plus the minus sign and the two box-drawing horizontals;
//   a gap     white space and every FORMAT character (\p{Cf}: zero-width spaces
//             and joiners, bidi marks, the soft hyphen, the BOM…);
//   an equals '=' and its compatibility / look-alike forms;
//   a word    its letters with any number of format characters BETWEEN them
//             ('TC<U+200B>PA' reads 'TCPA').
// What this can promise, for ANY text, is exact: after it no line starts with the
// server's header and the tokens 'scope=' / 'callback_consent=' do not occur.
// What it cannot promise is that no human eye is ever fooled — homoglyph LETTERS
// cannot be enumerated — which is why the server's statement is also FIRST on
// its line (tcpaReceiptLine) and the scope is a CRM field once the ids exist.
const DASH = '(?:(?!-)[\\p{Pd}\\u2212\\u2500\\u2501])';
const FORMAT = '\\p{Cf}';
const GAP = '[\\s' + FORMAT + ']';
const EQUALS = '[=\\uFF1D\\uFE66\\u207C\\u208C\\uA78A\\u2550\\u2261]';
const word = (letters) => Array.from(letters).join(FORMAT + '*');
// A run of dashes is entered only at its first dash (`(?<!dash)`): started from
// every dash of a long run, the scan was quadratic — 8,000 dashes, which a
// sender may put in each of several fields, cost half a second of CPU.
const LOOKALIKE_HEADER = new RegExp(
  '(?<!' + DASH + ')' + DASH + '+' + GAP + '*(?:(' + word('TCPA') + ')' + GAP + '+(' + word('Receipt') + ')|(' + word('Consent') + ')' + GAP + '+(' + word('Text') + '))' +
  GAP + '*' + DASH + '*', 'giu');
// `(?=(…))\2` is an atomic group: the run of letters after the label is taken
// whole or not at all, so a long text cannot make this backtrack quadratically.
const LOOKALIKE_LABEL = new RegExp(
  '((?:' + word('scope') + '|' + word('callback_consent') + ')(?=([A-Za-z_]*))\\2)(' + GAP + '*)' + EQUALS, 'giu');
const FORMAT_RUN = new RegExp(FORMAT + '+', 'gu');

/**
 * Text that did not come from this server — the sender's story, the chat
 * transcript, the consent text as received, a model's summary — with the two
 * things removed that would let a line of it read as the server's receipt:
 *
 *   • a block header ('— TCPA Receipt —', '— Consent Text —', with any dash);
 *   • a labelled value only the server writes ('scope=…', 'callback_consent=…').
 *
 * RED TEAM 2026-10-04 — the header was neutralised only in lead_notes, and only
 * when a hash or a version label had been sent; conversation_summary and
 * consent_text went into the note raw, so a note could hold a second
 * '— TCPA Receipt — … scope=ANY_PRODUCT_TELEMARKETING' line. The registered
 * consent wording contains neither pattern, so it passes through unchanged.
 */
export function neutralizeReceiptLookalikes(text) {
  if (typeof text !== 'string') return '';
  if (!text) return text;
  return text
    .replace(LOOKALIKE_HEADER, (_all, tcpa, receipt, consent, textWord) =>
      '- ' + (tcpa || consent).replace(FORMAT_RUN, '') + ' ' + (receipt || textWord).replace(FORMAT_RUN, '') + ' -')
    .replace(LOOKALIKE_LABEL, '$1$3:');
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE RETRY POLICY FOR A REFUSED CRM WRITE
//
// The CALLBACK_CONSENT_* ids are the only ones in either handler's body that
// come from owner-supplied configuration, so a refusal with them attached MAY be
// about them. RED TEAM 2026-10-04 found the two handlers disagreeing in both
// directions: the lead handler retried only on 400/422 and only when the CRM's
// message did not contain "duplicat" (a 403/404/409, or a 422 worded "duplicate
// custom field id", lost a lead that would have been created without the three
// entries), while the opt-out handler dropped the REVOKED fields on ANY failure
// — a transient 500 left CALLBACK_CONSENT_STATUS=GRANTED beside a DND flag.
//
//   TRANSIENT              429 / 5xx — the CRM's own failure. The SAME body is
//                          what gets retried; a field is never dropped for this.
//   AUTH                   401 — a dead token. No body would be accepted.
//   RETRY_WITHOUT_FIELDS   any other 4xx with the entries attached: send the
//                          same body ONCE more without them, and let the
//                          caller's existing branches judge THAT answer (a real
//                          duplicate says so again without the fields).
//   REFUSED                any other 4xx with nothing attached to drop, or a
//                          status that is not a refusal this policy knows.
// ─────────────────────────────────────────────────────────────────────────────
export function crmRefusalStep(status, attachedCount) {
  if (!Number.isInteger(status)) return 'REFUSED';
  if (status >= 200 && status < 300) return 'ACCEPTED';
  if (status === 429 || (status >= 500 && status <= 599)) return 'TRANSIENT';
  if (status === 401) return 'AUTH';
  if (status >= 400 && status <= 499 && Number.isInteger(attachedCount) && attachedCount > 0) return 'RETRY_WITHOUT_FIELDS';
  return 'REFUSED';
}

// ─────────────────────────────────────────────────────────────────────────────
// THE REVOCATION, AS A RECORD (api/opt-out.js)
//
// RED TEAM 2026-10-04 — the opt-out handler called buildCustomFields() directly
// and so had none of the rules the grant side has:
//   • under a partial id map it wrote a bare CALLBACK_CONSENT_AT (which reads as
//     a grant time), or REVOKED with the grant's instant left beside it;
//   • every repeat opt-out — and the endpoint is unauthenticated — overwrote the
//     revocation instant, so a contact made between the true revocation and the
//     repeat read as made BEFORE the revocation.
//
// The rules, in one place:
//   • both field ids, or nothing is written (the note is the record meanwhile);
//   • a contact that already reads REVOKED is not rewritten: the instant at
//     which a revocation took effect is never moved;
//   • a contact that reads anything else gets REVOKED and this instant;
//   • a contact whose state could not be read gets REVOKED ONLY. Writing the
//     instant too could move an earlier revocation forward (which hides a
//     contact made after it); leaving it can only make a revocation look
//     EARLIER than it was. Fail-closed is the second one, and the note of this
//     event carries its true instant either way.
// ─────────────────────────────────────────────────────────────────────────────

/** What a CRM contact payload says about its callback consent. */
export const CALLBACK_CONSENT_STATE = Object.freeze({
  REVOKED: 'REVOKED',
  NOT_REVOKED: 'NOT_REVOKED',
  UNKNOWN: 'UNKNOWN',
});

/** How a revocation is (or is not) written to the two CRM fields. */
export const CALLBACK_REVOCATION_MODE = Object.freeze({
  REVOKED_WITH_INSTANT: 'REVOKED_WITH_INSTANT',
  REVOKED_STATUS_ONLY: 'REVOKED_STATUS_ONLY',
  ALREADY_REVOKED: 'ALREADY_REVOKED',
  NO_FIELD_IDS: 'NO_FIELD_IDS',
  NOT_BUILT: 'NOT_BUILT',
});

/** The two §18 values a revocation is made of. */
const REVOCATION_FIELDS = Object.freeze(['CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT']);

const ownValue = (obj, key) => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);

/**
 * Read CALLBACK_CONSENT_STATUS off a contact as GoHighLevel returned it.
 *
 * REVOKED      the status field is listed, once, and reads exactly 'REVOKED'.
 * NOT_REVOKED  the payload lists custom-field values (at least one) and the
 *              status field is either not among them or reads something else.
 * UNKNOWN      everything else: no id configured, no customFields array, an
 *              EMPTY one (which is what a payload that does not carry custom
 *              fields at all would also look like), the field listed twice, or a
 *              value that is not a string. Nothing is inferred from silence.
 */
export function callbackConsentStateOf(contact, env = process.env) {
  try {
    const statusId = fieldIdMap(env).CALLBACK_CONSENT_STATUS;
    if (!statusId) return CALLBACK_CONSENT_STATE.UNKNOWN;
    const list = contact !== null && typeof contact === 'object' && Array.isArray(contact.customFields) ? contact.customFields : null;
    if (!list || list.length === 0) return CALLBACK_CONSENT_STATE.UNKNOWN;
    const hits = list.filter((f) => f !== null && typeof f === 'object' && f.id === statusId);
    if (hits.length === 0) return CALLBACK_CONSENT_STATE.NOT_REVOKED;
    if (hits.length > 1) return CALLBACK_CONSENT_STATE.UNKNOWN;
    const raw = ownValue(hits[0], 'value') !== undefined ? ownValue(hits[0], 'value')
      : ownValue(hits[0], 'field_value') !== undefined ? ownValue(hits[0], 'field_value')
        : ownValue(hits[0], 'fieldValue');
    if (typeof raw !== 'string') return CALLBACK_CONSENT_STATE.UNKNOWN;
    return raw === CONSENT_STATUS.REVOKED ? CALLBACK_CONSENT_STATE.REVOKED : CALLBACK_CONSENT_STATE.NOT_REVOKED;
  } catch {
    return CALLBACK_CONSENT_STATE.UNKNOWN;
  }
}

function revocation(mode, at, fields, unmapped, withheld, warnings) {
  return Object.freeze({
    mode,
    at,
    fields: Object.freeze(fields.map((f) => Object.freeze(f))),
    unmapped: Object.freeze(unmapped.slice()),
    withheld: Object.freeze(withheld.slice()),
    // Field names and fixed strings only — never anything about the person.
    warnings: Object.freeze(warnings.slice()),
  });
}

/** What the opt-out handler falls back to if the function below cannot be reached. */
export const CALLBACK_REVOCATION_UNAVAILABLE = revocation(
  CALLBACK_REVOCATION_MODE.NOT_BUILT, null, [], [], [],
  ['[CALLBACK-CONSENT] revocation fields not built: the suppression itself is unaffected'],
);

/**
 * @param {object} input
 *   at     the server's instant for this revocation (ISO, UTC)
 *   state  what callbackConsentStateOf() read off the matched contact
 * @param {object} env  process.env by default
 *
 * @returns a frozen record:
 *   mode      one of CALLBACK_REVOCATION_MODE
 *   at        the instant given, or null when nothing could be built
 *   fields    CRM customFields entries to send (two, one, or none)
 *   unmapped  §18 names with no GoHighLevel id configured
 *   withheld  §18 names that HAVE an id and were still not sent
 *   warnings  PII-free lines for the caller to log
 * Never throws: nothing here may stand between a person and their suppression.
 */
export function recordCallbackRevocation(input, env = process.env) {
  try {
    const src = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
    // Throws on anything that is not a real, non-future UTC instant.
    const both = callbackRevocationToFields({ at: src.at });
    const at = both.CALLBACK_CONSENT_AT;
    // An allow-list: only the two states that were positively read count.
    const state = src.state === CALLBACK_CONSENT_STATE.REVOKED || src.state === CALLBACK_CONSENT_STATE.NOT_REVOKED
      ? src.state : CALLBACK_CONSENT_STATE.UNKNOWN;

    const ids = fieldIdMap(env);
    const unmapped = REVOCATION_FIELDS.filter((n) => !ids[n]);
    if (unmapped.length) {
      const withheld = REVOCATION_FIELDS.filter((n) => ids[n]);
      const warnings = [unmappedFieldsWarning(unmapped)];
      if (withheld.length) {
        warnings.push(
          '[CY2027-CRM] ' + withheld.join(', ') + ' not written either: a revocation is sent to the CRM with its ' +
          'status AND its timestamp, or not at all. DND and the revocation note are the record meanwhile.',
        );
      }
      return revocation(CALLBACK_REVOCATION_MODE.NO_FIELD_IDS, at, [], unmapped, withheld, warnings);
    }

    if (state === CALLBACK_CONSENT_STATE.REVOKED) {
      return revocation(CALLBACK_REVOCATION_MODE.ALREADY_REVOKED, at, [], [], [], []);
    }
    const values = state === CALLBACK_CONSENT_STATE.NOT_REVOKED
      ? both
      : { CALLBACK_CONSENT_STATUS: both.CALLBACK_CONSENT_STATUS };
    const expected = Object.keys(values).length;
    const built = buildCustomFields(values, env);
    // The write stage applies its own unit rule; anything short of what was
    // asked for is "not built", never a partial write.
    if (built.fields.length !== expected || built.refused.length || built.withheld.length || built.unmapped.length) {
      return CALLBACK_REVOCATION_UNAVAILABLE;
    }
    if (state === CALLBACK_CONSENT_STATE.NOT_REVOKED) {
      return revocation(CALLBACK_REVOCATION_MODE.REVOKED_WITH_INSTANT, at, built.fields, [], [], []);
    }
    return revocation(CALLBACK_REVOCATION_MODE.REVOKED_STATUS_ONLY, at, built.fields, [], ['CALLBACK_CONSENT_AT'], [
      '[CALLBACK-CONSENT] the contact\'s current consent state could not be read: CALLBACK_CONSENT_STATUS=REVOKED is ' +
      'written and CALLBACK_CONSENT_AT is left as it is (an earlier revocation instant must not be moved). ' +
      'The revocation note carries the instant of this event.',
    ]);
  } catch {
    return CALLBACK_REVOCATION_UNAVAILABLE;
  }
}

/**
 * The line of the revocation note that says what happened to the two CRM
 * fields — so the note never claims more than was applied.
 *
 * @param rev      what recordCallbackRevocation() returned
 * @param outcome  'WRITTEN'        the update carrying rev.fields was accepted
 *                 'DROPPED'        the CRM refused them; the suppression went without
 *                 'UPDATE_FAILED'  the update was not accepted at all
 *                 (ignored when rev.fields is empty — there was nothing to write)
 */
export function callbackRevocationNoteLine(rev, outcome) {
  const M = CALLBACK_REVOCATION_MODE;
  const mode = rev !== null && typeof rev === 'object' && Object.prototype.hasOwnProperty.call(M, rev.mode) ? rev.mode : M.NOT_BUILT;
  const count = rev !== null && typeof rev === 'object' && Array.isArray(rev.fields) ? rev.fields.length : 0;
  const head = 'Callback consent fields in the CRM: ';
  if (mode === M.ALREADY_REVOKED) {
    return head + 'unchanged — the contact already read CALLBACK_CONSENT_STATUS=REVOKED, and the instant of that earlier revocation stands. This note records a repeat request.';
  }
  if (mode === M.NO_FIELD_IDS) {
    return head + 'NOT written — CALLBACK_CONSENT_STATUS and CALLBACK_CONSENT_AT do not both have a GoHighLevel field id. This note is the record.';
  }
  if (mode === M.NOT_BUILT || count === 0) {
    return head + 'NOT written — the values could not be built. This note is the record.';
  }
  if (outcome === 'DROPPED') {
    return head + 'NOT written — the CRM refused the update with them attached, so the suppression was applied without them. This note is the record.';
  }
  if (outcome !== 'WRITTEN') {
    return head + 'NOT written — the CRM did not accept the update. This note is the record.';
  }
  if (mode === M.REVOKED_STATUS_ONLY) {
    return head + 'CALLBACK_CONSENT_STATUS=REVOKED written. CALLBACK_CONSENT_AT was left as it was, because the contact\'s current state could not be read and an earlier revocation instant must not be moved; the instant of THIS revocation is the timestamp above.';
  }
  return head + 'CALLBACK_CONSENT_STATUS=REVOKED and CALLBACK_CONSENT_AT=' + (isIsoInstant(rev.at) ? rev.at : 'unavailable') + ' written.';
}

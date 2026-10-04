// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — CONSENT ENGINE: FOUR DISTINCT OBJECTS (spec §6, §24).
//
//   RECORDING_NOTICE            notice/permission for recording
//   CALLBACK_CONTACT_PERMISSION permission to contact about the stated request
//   SCOPE_OF_APPOINTMENT        product categories for ONE specific appointment
//   AI_OUTBOUND_VOICE_CONSENT   consent for automated/artificial/prerecorded calls
//
// The spec's table is explicit about what each object may NEVER be inferred
// from. That table is encoded below as NEVER_INFER_FROM and enforced by
// assertNoCrossInference(), which throws rather than returning false — a silent
// false would let a caller "handle" the error and proceed.
//
// "Silence, unrelated 'okay', prechecked boxes, or inferred intent are not
//  affirmative consent." (spec §6)
// "Revocation must propagate to workflows immediately. A prior SOA does not
//  defeat a later do-not-contact request." (spec §6)
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_TYPES = Object.freeze([
  'RECORDING_NOTICE',
  'CALLBACK_CONTACT_PERMISSION',
  'SCOPE_OF_APPOINTMENT',
  'AI_OUTBOUND_VOICE_CONSENT',
]);

/** Base Layer A §15 vocabulary, unchanged. */
export const CONSENT_STATUS = Object.freeze({
  GRANTED: 'GRANTED',
  DECLINED: 'DECLINED',
  UNCLEAR: 'UNCLEAR',
  NOT_ASKED: 'NOT_ASKED',
  REVOKED: 'REVOKED',
});

/** Spec §6 table, encoded. Each key may never be inferred from these sources. */
export const NEVER_INFER_FROM = Object.freeze({
  RECORDING_NOTICE: Object.freeze(['CALLBACK_CONTACT_PERMISSION', 'SCOPE_OF_APPOINTMENT', 'WEBSITE_SUBMISSION']),
  CALLBACK_CONTACT_PERMISSION: Object.freeze([
    'RECORDING_NOTICE',
    'SCOPE_OF_APPOINTMENT',
    'PRIOR_CUSTOMER_RELATIONSHIP',
  ]),
  SCOPE_OF_APPOINTMENT: Object.freeze([
    'CALLBACK_CONTACT_PERMISSION',
    'TELL_ME_EVERYTHING',
    'WEBSITE_BROWSING',
  ]),
  AI_OUTBOUND_VOICE_CONSENT: Object.freeze(['CALLBACK_CONTACT_PERMISSION', 'GENERIC_YOU_MAY_CALL_ME']),
});

/**
 * Utterances that are NOT affirmative consent on their own (spec §6, and Base
 * Layer A §15: "Un 'okay' relacionado con otra pregunta no significa
 * consentimiento"). Centralized so the chat bots, the voice agents' post-call
 * parsing and the web form all share one list instead of drifting.
 */
export const NOT_AFFIRMATIVE_ALONE = Object.freeze([
  'ok', 'okay', 'k', 'mhm', 'uh huh', 'uh-huh', 'sure', 'please', 'yeah ok', 'alright', 'all right',
  'claro', 'bueno', 'vale', 'ya', 'ajá', 'aja', 'por favor', 'está bien', 'esta bien', 'y',
]);

/** Unambiguous affirmatives. Deliberately short and literal. */
const AFFIRMATIVE = Object.freeze([
  'yes', 'i agree', 'i consent', 'i authorize', 'you may', 'that is correct', "that's correct",
  'sí', 'si', 'sí autorizo', 'autorizo', 'estoy de acuerdo', 'acepto', 'puede llamarme',
]);

/** Unambiguous refusals. */
const NEGATIVE = Object.freeze([
  'no', 'do not', "don't", 'stop', 'remove me', 'i decline', 'i do not consent', 'opt out', 'unsubscribe',
  'no gracias', 'no autorizo', 'no acepto', 'deje de', 'quíteme', 'quiteme', 'no me llame',
]);

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/[.!¡¿?,;]+/g, '').replace(/\s+/g, ' ');

/**
 * Classify a free-text reply into a consent status.
 * Anything ambiguous returns UNCLEAR — which the caller must treat as "ask
 * again", never as consent. Silence (empty string) returns NOT_ASKED, never
 * GRANTED.
 */
export function classifyReply(text) {
  const t = norm(text);
  if (!t) return CONSENT_STATUS.NOT_ASKED;

  // RED TEAM 2026-10-02 (CT-01, HIGH) — an explicit refusal that merely BEGAN
  // with an affirmative token was read as a grant: "yes I said no", "sí pero
  // no", "yes — do not call me". The affirmative test matched the prefix and
  // returned first. A refusal anywhere in the reply now wins, because the cost
  // of misreading a refusal as consent is unacceptable and the cost of the
  // reverse is one more question.
  const hasNegative = NEGATIVE.some((n) => t === n || t.startsWith(n + ' ') || t.includes(' ' + n + ' ') || t.endsWith(' ' + n));
  if (hasNegative) return CONSENT_STATUS.DECLINED;

  if (NOT_AFFIRMATIVE_ALONE.includes(t)) return CONSENT_STATUS.UNCLEAR;
  // An affirmative only counts when the reply IS the affirmative, or begins with
  // one and stays short. A long sentence that opens with "yes" is a sentence,
  // not an answer, and goes back for clarification.
  const affirmativeOpening = AFFIRMATIVE.some((a) => t === a || t.startsWith(a + ' '));
  if (affirmativeOpening && t.split(' ').length <= 6) return CONSENT_STATUS.GRANTED;
  return CONSENT_STATUS.UNCLEAR;
}

/**
 * True only for an explicit, current grant OF THE EXPECTED TYPE.
 *
 * RED TEAM 2026-10-02 (CT-03, CRITICAL) — this ignored `consent.type`, so a
 * granted RECORDING_NOTICE or SCOPE_OF_APPOINTMENT satisfied a callback or
 * AI-outbound check. That is precisely the cross-inference the whole module
 * exists to prevent: the four objects were distinct everywhere except at the
 * one function that decides whether to act on them.
 *
 * `expectedType` is required for any decision. It is optional only for the
 * generic "is this record a live grant" question, which must not be used to
 * authorize anything.
 */
export function isAffirmative(consent, expectedType) {
  if (!consent || consent.status !== CONSENT_STATUS.GRANTED || consent.revokedAt) return false;
  if (expectedType === undefined) return true;
  if (!CONSENT_TYPES.includes(expectedType)) throw new Error(`consent: unknown type "${expectedType}"`);
  return consent.type === expectedType;
}

/**
 * Create a consent record. Every field the spec requires is mandatory at
 * construction, so a half-populated consent object cannot exist:
 * status, timestamp, language, source/channel, text/script version,
 * scope/purpose, relationship, revocation status.
 */
export function createConsent(input) {
  const {
    type,
    status = CONSENT_STATUS.NOT_ASKED,
    language,
    channel,
    scriptVersion,
    scope,
    relationship = 'SELF',
    at = new Date().toISOString(),
    callId = null,
    correlationId = null,
  } = input || {};

  if (!CONSENT_TYPES.includes(type)) throw new Error(`consent: unknown type "${type}"`);
  if (!Object.values(CONSENT_STATUS).includes(status)) throw new Error(`consent: unknown status "${status}"`);
  if (language !== 'en' && language !== 'es') throw new Error('consent: language must be "en" or "es"');
  if (!channel) throw new Error('consent: channel/source is required');
  if (!scriptVersion) throw new Error('consent: scriptVersion (exact text version shown/spoken) is required');
  if (!scope) throw new Error('consent: scope/purpose is required');

  return {
    type,
    status,
    at,
    language,
    channel,
    scriptVersion,
    scope,
    relationship,
    callId,
    correlationId,
    revokedAt: null,
    revokedVia: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-10-02 (CE-09 / CRM-15) — THE SCOPE OF A WEB CONTACT CONSENT.
//
// The web and chat surfaces sent `consent_to_contact: true` and the server
// turned it into four channel booleans. WHAT the person agreed to be contacted
// about survived only as prose inside the verbatim text in a note, so a generic
// callback consent could not be told apart from a broader one and §24's
// "authorizes only the scope actually stated" had nothing to compare against.
//
// The scope is not chosen here and is not derived from the lead (its interest,
// its language, its source). It is READ OFF the consent wording: each registered
// text version carries the scope that text states, and a submission earns that
// scope only when the text it attests to is byte-for-byte that version (SHA-256
// computed by the SERVER over the text it received). Anything else — no
// version, an unregistered version, no text, a text that is not the registered
// one, a receipt hash that disagrees with the text, no usable timestamp —
// yields NO consent object and a named reason. Nothing is inferred and nothing
// defaults.
//
// This module stays free of Node APIs (the barrel re-exports it), so the caller
// computes the digest and passes it in (see ./callback-consent.js).
//
// CHANGE CONTROL — editing the wording in src/lib/disclaimerVersion.ts requires
// a new DISCLAIMER_VERSION and a NEW entry here; never edit an existing entry
// (a cached bundle may still present the old text, and old receipts cite it).
// scripts/consent-wording-gate.mjs fails the build when the two disagree, and
// the suite pins the entry below value by value.
// ─────────────────────────────────────────────────────────────────────────────
export const CONTACT_CONSENT_TEXT_VERSIONS = Object.freeze({
  '2026-06-01': Object.freeze({
    // "…to contact you by phone, text message, or email at the number you
    //  provided to discuss Medicare plan options."
    scope: 'DISCUSS_MEDICARE_PLAN_OPTIONS',
    statedAs: Object.freeze({
      en: 'to discuss Medicare plan options',
      es: 'para discutir opciones de planes de Medicare',
    }),
    sha256: Object.freeze({
      en: '1b85fb83b46a4698e08ce899d0675ac0caf140efde5a62711f618de551d43048',
      es: '3e102ce502965affa1a6df76c186f7cfe62375cea3382e3e18b66bc54954583f',
    }),
  }),
});

/**
 * True only for a scope that some registered consent wording states.
 *
 * This is the rule the WRITE side re-checks (crm-fields.js): the registry is
 * consulted when the consent object is built, and a rule enforced only where an
 * object is built is no rule for an object somebody assembled by hand or read
 * back from storage. An allow-list, matched exactly — no trimming, no case
 * folding, strings only.
 */
export function isStatedConsentScope(scope) {
  if (typeof scope !== 'string' || !scope) return false;
  return Object.keys(CONTACT_CONSENT_TEXT_VERSIONS).some((v) => CONTACT_CONSENT_TEXT_VERSIONS[v].scope === scope);
}

/**
 * A UTC instant exactly as Date#toISOString() writes it (the milliseconds are
 * optional). "Yesterday", a number, a Date object or a date with no time are
 * not a timestamp a consent record can carry.
 *
 * AUDIT 2026-10-04 (CE-09, red team) — the shape test plus Date.parse() accepted
 * instants that do not exist: V8 rolls '2026-02-31T00:00:00Z' over to 3 March
 * and '…T24:00:00Z' to the next day, and the impossible STRING was what got
 * written. The value now has to survive a round trip through the clock's own
 * writer: what toISOString() would never print is not an instant.
 */
export function isIsoInstant(value) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!m) return false;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return new Date(ms).toISOString() === m[1] + '.' + (m[2] || '').padEnd(3, '0') + 'Z';
}

/** How far ahead of this machine's clock an instant may read before it is "not yet". */
export const CONSENT_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * True for an instant a consent record may carry NOW: a real UTC instant that is
 * not in the future.
 *
 * AUDIT 2026-10-04 (CE-09, red team) — a consent or a revocation "at 2099" was
 * accepted and written. Nothing can have been consented to tomorrow. There is
 * deliberately NO lower bound: this layer has no registered date on which each
 * wording version went live, and inventing one would be a silent default. (If
 * the owner supplies those dates, the bound belongs in the registry entry.)
 */
export function isRecordableInstant(value, nowMs = Date.now()) {
  return isIsoInstant(value) && Number.isFinite(nowMs) && Date.parse(value) <= nowMs + CONSENT_CLOCK_TOLERANCE_MS;
}

/**
 * Build the CALLBACK_CONTACT_PERMISSION object for a web/chat submission.
 *
 * Returns a decision object, never a bare consent, so the reason is logged:
 *   { consent, reason }   — `consent` is null on every refusal.
 *
 * The language recorded is the language of the text that was shown (the digest
 * that matched), not the lead's preferred language. The relationship is
 * NOT_STATED: no web surface asks whether the sender is the beneficiary, and
 * createConsent()'s 'SELF' default would assert something nobody said.
 *
 * Both the decision and the consent inside it are frozen: the scope is the
 * value this function exists to protect, and it must reach the CRM mapping as
 * it left here.
 */
export function webCallbackConsent(input) {
  const src = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const { consentGiven, disclaimerVersion, consentTextSha256, receiptHash, at } = src;
  const refuse = (reason) => Object.freeze({ consent: null, reason });

  // Only the literal boolean counts — the same rule as the lead gate. A truthy
  // string, a prechecked box or an inferred intent is not consent (§6).
  if (consentGiven !== true) return refuse('NO_AFFIRMATIVE_CONSENT');
  if (typeof disclaimerVersion !== 'string' || !disclaimerVersion) return refuse('CONSENT_TEXT_VERSION_MISSING');
  // Own keys only: 'constructor' and '__proto__' are not text versions.
  const entry = Object.prototype.hasOwnProperty.call(CONTACT_CONSENT_TEXT_VERSIONS, disclaimerVersion)
    ? CONTACT_CONSENT_TEXT_VERSIONS[disclaimerVersion]
    : null;
  if (!entry) return refuse('CONSENT_TEXT_VERSION_UNKNOWN');
  if (typeof consentTextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(consentTextSha256)) {
    return refuse('CONSENT_TEXT_MISSING');
  }
  const language = consentTextSha256 === entry.sha256.en ? 'en' : consentTextSha256 === entry.sha256.es ? 'es' : null;
  if (!language) return refuse('CONSENT_TEXT_NOT_THE_REGISTERED_VERSION');
  // A receipt whose own hash disagrees with the text beside it is not evidence.
  // Absent means absent (a browser without SubtleCrypto sends none); anything
  // else that is present has to BE the digest — `false`, 0 and an array are
  // present and are not it.
  const receiptPresent = receiptHash !== undefined && receiptHash !== null && receiptHash !== '';
  if (receiptPresent && receiptHash !== consentTextSha256) return refuse('CONSENT_RECEIPT_HASH_MISMATCH');
  if (at === undefined || at === null || at === '') return refuse('CONSENT_TIMESTAMP_MISSING');
  if (!isIsoInstant(at)) return refuse('CONSENT_TIMESTAMP_INVALID');
  if (!isRecordableInstant(at)) return refuse('CONSENT_TIMESTAMP_IN_THE_FUTURE');

  return Object.freeze({
    consent: Object.freeze(createConsent({
      type: 'CALLBACK_CONTACT_PERMISSION',
      status: CONSENT_STATUS.GRANTED,
      language,
      channel: 'WEB',
      scriptVersion: disclaimerVersion,
      scope: entry.scope,
      relationship: 'NOT_STATED',
      at,
      correlationId: typeof src.correlationId === 'string' && src.correlationId ? src.correlationId : null,
    })),
    reason: 'CALLBACK_CONSENT_RECORDED',
  });
}

/**
 * Revoke. Spec §6: revocation propagates immediately and a prior SOA does not
 * defeat a later do-not-contact request — so this never consults the SOA.
 */
export function revokeConsent(consent, { at = new Date().toISOString(), via = 'UNKNOWN' } = {}) {
  if (!consent) throw new Error('consent: nothing to revoke');
  return { ...consent, status: CONSENT_STATUS.REVOKED, revokedAt: at, revokedVia: via };
}

/**
 * Hard guard against cross-inference. Throws — a returned boolean would be
 * ignorable, and this is the control that stops "they signed an SOA so we may
 * robocall them".
 */
export function assertNoCrossInference(targetType, sourceSignal) {
  // RED TEAM 2026-10-02 (CT-04, HIGH) — this was a case-sensitive exact-match
  // denylist, so the same banned source in lowercase, or with spaces instead of
  // underscores, passed the guard. The guard is the whole point of the module;
  // it cannot be defeated by capitalization.
  const banned = Object.prototype.hasOwnProperty.call(NEVER_INFER_FROM, targetType)
    ? NEVER_INFER_FROM[targetType]
    : null;
  if (!banned) throw new Error(`consent: unknown type "${targetType}"`);
  const normalize = (s) => String(s == null ? '' : s).trim().toUpperCase().replace(/[\s-]+/g, '_');
  const src = normalize(sourceSignal);
  if (!src) throw new Error('consent: a source signal is required to check cross-inference');
  if (banned.map(normalize).includes(src)) {
    throw new Error(
      `consent: ${targetType} may never be inferred from ${sourceSignal} (spec §6). ` +
        'Capture the consent explicitly instead.',
    );
  }
  return true;
}

/**
 * Outbound gate. Spec §24: generic callback consent authorizes only the scope
 * actually stated and does NOT authorize automated/artificial/prerecorded
 * telemarketing; outbound Voice AI stays disabled unless a separately
 * validated architecture exists.
 *
 * Returns a decision object, never a bare boolean, so the reason is logged.
 */
export function mayPlaceOutbound({ mode, callbackConsent, aiOutboundConsent, doNotContact, purpose }) {
  // RED TEAM 2026-10-02 (CT-07, MEDIUM) — an ABSENT do-not-contact flag read as
  // "no DNC". Not having checked the suppression list is not the same as having
  // checked it and found nothing; a caller that forgets to pass it must not get
  // a green light. Pass `false` explicitly once the list has been consulted.
  if (doNotContact === undefined || doNotContact === null) {
    return { allowed: false, reason: 'DO_NOT_CONTACT_STATUS_UNKNOWN' };
  }
  if (doNotContact) return { allowed: false, reason: 'DO_NOT_CONTACT' };
  if (mode === 'AI_AUTOMATED') {
    // Type-checked (CT-03): a granted recording notice is not outbound consent.
    if (!isAffirmative(aiOutboundConsent, 'AI_OUTBOUND_VOICE_CONSENT')) {
      return { allowed: false, reason: 'NO_AI_OUTBOUND_CONSENT' };
    }
    // Even with consent recorded, the architecture itself must be validated.
    return { allowed: false, reason: 'AI_OUTBOUND_ARCHITECTURE_NOT_VALIDATED' };
  }
  if (mode === 'HUMAN_LICENSED_AGENT') {
    if (!isAffirmative(callbackConsent, 'CALLBACK_CONTACT_PERMISSION')) {
      return { allowed: false, reason: 'NO_CALLBACK_CONSENT' };
    }
    // Spec §24: "Generic callback consent authorizes only the scope actually
    // stated." A purpose outside that scope is a different call and needs its
    // own permission (CT-07).
    if (purpose !== undefined && purpose !== callbackConsent.scope) {
      return { allowed: false, reason: 'PURPOSE_OUTSIDE_CONSENT_SCOPE', consentScope: callbackConsent.scope, purpose };
    }
    return { allowed: true, reason: 'CALLBACK_CONSENT_GRANTED', scope: callbackConsent.scope };
  }
  return { allowed: false, reason: 'UNKNOWN_MODE' };
}

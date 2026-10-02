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
  if (NEGATIVE.some((n) => t === n || t.startsWith(n + ' '))) return CONSENT_STATUS.DECLINED;
  if (NOT_AFFIRMATIVE_ALONE.includes(t)) return CONSENT_STATUS.UNCLEAR;
  if (AFFIRMATIVE.some((a) => t === a || t.startsWith(a + ' '))) return CONSENT_STATUS.GRANTED;
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
  const banned = NEVER_INFER_FROM[targetType];
  if (!banned) throw new Error(`consent: unknown type "${targetType}"`);
  if (banned.includes(sourceSignal)) {
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
export function mayPlaceOutbound({ mode, callbackConsent, aiOutboundConsent, doNotContact }) {
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
    return isAffirmative(callbackConsent, 'CALLBACK_CONTACT_PERMISSION')
      ? { allowed: true, reason: 'CALLBACK_CONSENT_GRANTED', scope: callbackConsent.scope }
      : { allowed: false, reason: 'NO_CALLBACK_CONSENT' };
  }
  return { allowed: false, reason: 'UNKNOWN_MODE' };
}

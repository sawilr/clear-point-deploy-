// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — OUT-OF-BAND VERIFICATION: THE LETTER, THE CALL, THE CALLBACK
// (spec §12, Phase 6 "letter-verification workflow definition").
// Environment-neutral: imports only from this layer. Server-side in purpose —
// these are staff decisions, never a browser's.
//
// §12  "Human validation may call the same number only when the system has an
//       appropriate contact basis/permission for that verification call.
//       Document purpose as security/request verification, not plan marketing."
// §12  "If out-of-band verification is necessary for an existing known client,
//       a physical letter may be sent only to a previously verified address
//       already on file, not a new address supplied by the suspicious request.
//       Letter must be neutral, contain no plan marketing, request the person
//       to contact Clear Point through an official channel, and disclose
//       minimal data."
// §12  "If the person independently calls back through the official number,
//       re-open the case, verify context and proceed from the appropriate gate."
//
// AUDIT 2026-10-04 (SPEC-12) — none of the three rules existed anywhere in the
// tree. Each is now a pure function that returns a decision with a named
// reason, and each is exercised by calling it. What this module does NOT do:
// it mails nothing, dials nothing and opens no case record anywhere — mailing
// and calling are staff actions; the code defines and gates them.
//
// The letter wording is new customer-facing text. It is carried here marked
// PENDING_OWNER_APPROVAL, and mayIssueVerificationLetter() refuses to release
// it until a named person has approved it (letterApprovalProblem). Approving
// it means editing VERIFICATION_LETTER.approval in this file — a reviewed
// change, never a runtime write: the object is frozen all the way down and
// registered with the no-self-modification gate.
// ─────────────────────────────────────────────────────────────────────────────

import { humanActorProblem, reviewerProblem } from './actors.js';
import { mayPlaceOutbound } from './consent.js';
import { assertNotMarketing } from './beneficiary-copy.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
}

const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const digitsOf = (value) => {
  let d = String(value == null ? '' : value).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
};

/** The agency's published channel. The letter and the callback rule both point at it. */
export const OFFICIAL_CONTACT = deepFreeze({
  name: 'Clear Point Senior Advisors',
  phoneDisplay: '1-855-720-8555',
  phoneDigits: '8557208555',
});

/** The one purpose a verification call may have. An allow-list of one value. */
export const VERIFICATION_CALL_PURPOSE = 'SECURITY_REQUEST_VERIFICATION';

/** Case states a callback may re-open. 'VERIFIED' and anything unknown may not. */
export const CASE_STATUS = deepFreeze({
  QUARANTINED: 'QUARANTINED',
  HUMAN_REVIEW: 'HUMAN_REVIEW',
  CLOSED_UNVERIFIED: 'CLOSED_UNVERIFIED',
  REOPENED: 'REOPENED',
  VERIFIED: 'VERIFIED',
});
const REOPENABLE = Object.freeze([CASE_STATUS.QUARANTINED, CASE_STATUS.HUMAN_REVIEW, CASE_STATUS.CLOSED_UNVERIFIED]);

/** Every refusal in this module, for the suite to check it reached each one. */
export const OOB_REFUSAL = deepFreeze({
  LETTER_TEXT_NOT_APPROVED: 'LETTER_TEXT_NOT_APPROVED',
  LETTER_APPROVER_NOT_HUMAN: 'LETTER_APPROVER_NOT_HUMAN',
  LETTER_APPROVAL_DATE_INVALID: 'LETTER_APPROVAL_DATE_INVALID',
  LETTER_CONTENT_MARKETING: 'LETTER_CONTENT_MARKETING',
  LETTER_CONTENT_NAMES_PLAN_OR_PRICE: 'LETTER_CONTENT_NAMES_PLAN_OR_PRICE',
  LETTER_CONTENT_NO_OFFICIAL_CHANNEL: 'LETTER_CONTENT_NO_OFFICIAL_CHANNEL',
  LETTER_EMPTY: 'LETTER_EMPTY',
  CLIENT_NOT_KNOWN: 'CLIENT_NOT_KNOWN',
  REQUEST_TIME_MISSING: 'REQUEST_TIME_MISSING',
  ADDRESS_NOT_ON_FILE: 'ADDRESS_NOT_ON_FILE',
  ADDRESS_NOT_PREVIOUSLY_VERIFIED: 'ADDRESS_NOT_PREVIOUSLY_VERIFIED',
  ADDRESS_SUPPLIED_BY_REQUEST: 'ADDRESS_SUPPLIED_BY_REQUEST',
  ADDRESS_PROVENANCE_UNKNOWN: 'ADDRESS_PROVENANCE_UNKNOWN',
  CASE_REF_MISSING: 'CASE_REF_MISSING',
  LANGUAGE_UNKNOWN: 'LANGUAGE_UNKNOWN',
  PURPOSE_NOT_VERIFICATION: 'PURPOSE_NOT_VERIFICATION',
  CALLER_NOT_HUMAN: 'CALLER_NOT_HUMAN',
  REQUEST_NUMBER_MISSING: 'REQUEST_NUMBER_MISSING',
  NUMBER_NOT_THE_REQUEST_NUMBER: 'NUMBER_NOT_THE_REQUEST_NUMBER',
  CASE_NOT_REOPENABLE: 'CASE_NOT_REOPENABLE',
  NOT_AN_INBOUND_CALL: 'NOT_AN_INBOUND_CALL',
  NOT_THROUGH_OFFICIAL_NUMBER: 'NOT_THROUGH_OFFICIAL_NUMBER',
});

// ── The letter ───────────────────────────────────────────────────────────────

/**
 * The neutral verification letter, both languages. It says that a request was
 * received and not acted on, gives an opaque case reference and the published
 * number, and says what will never be asked. No name, no address, no detail of
 * the request, no plan, carrier, benefit or price. `{caseRef}` is the only
 * substitution. PENDING OWNER APPROVAL: see the header.
 */
export const VERIFICATION_LETTER = deepFreeze({
  version: 'CP-VL-2026-10-04-v1',
  approval: { status: 'PENDING_OWNER_APPROVAL', approvedBy: null, approvedOn: null },
  en: {
    subject: 'Please contact us about a recent request',
    body:
      'We recently received a request involving your information that we were not able to confirm came from you. ' +
      'For your protection, we have not acted on it.\n\n' +
      'Whether or not you made this request, please call Clear Point Senior Advisors at 1-855-720-8555 and mention reference {caseRef}. ' +
      'This is our published number. We will never ask you for your Medicare number, your Social Security number or any payment details to confirm this.\n\n' +
      'If you do not recognize this request, nothing else is needed beyond letting us know.\n\n' +
      'Clear Point Senior Advisors',
  },
  es: {
    subject: 'Por favor comuníquese con nosotros sobre una solicitud reciente',
    body:
      'Recientemente recibimos una solicitud relacionada con su información que no pudimos confirmar que viniera de usted. ' +
      'Para su protección, no hemos actuado sobre ella.\n\n' +
      'Haya hecho o no esta solicitud, por favor llame a Clear Point Senior Advisors al 1-855-720-8555 y mencione la referencia {caseRef}. ' +
      'Este es nuestro número publicado. Nunca le pediremos su número de Medicare, su número de Seguro Social ni datos de pago para confirmar esto.\n\n' +
      'Si no reconoce esta solicitud, no necesita hacer nada más que avisarnos.\n\n' +
      'Clear Point Senior Advisors',
  },
});

/**
 * Words a verification letter may not contain: anything that names a plan, a
 * carrier, a benefit, a price or an enrollment. "Medicare" alone is allowed
 * (the letter says what will never be asked for); "Medicare Advantage" is not.
 */
const PLAN_OR_PRICE_RE = /\b(?:plans?|planes?|medicare\s+advantage|part\s+[abcd]|premiums?|primas?|copays?|copagos?|deductibles?|deducibles?|benefits?|beneficios?|coverage|cobertura|enroll\w*|inscri\w*|humana|aetna|unitedhealthcare|anthem|cigna|wellcare|elevance|centene|molina|emblemhealth|healthfirst|fidelis|\$\s?\d)\b/iu;

/** Why a rendered letter may not go out, or null. The marketing check is the layer's one (beneficiary-copy). */
export function letterContentProblem(text) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return OOB_REFUSAL.LETTER_EMPTY;
  try { assertNotMarketing(t); } catch { return OOB_REFUSAL.LETTER_CONTENT_MARKETING; }
  if (PLAN_OR_PRICE_RE.test(t)) return OOB_REFUSAL.LETTER_CONTENT_NAMES_PLAN_OR_PRICE;
  if (!t.includes(OFFICIAL_CONTACT.phoneDisplay)) return OOB_REFUSAL.LETTER_CONTENT_NO_OFFICIAL_CHANNEL;
  return null;
}

/**
 * Why the letter text may not be released, or null. Approval is a named
 * person (the layer's one human-actor rule) on a real calendar day already
 * past. Nothing here fills in an approval that is not recorded.
 */
export function letterApprovalProblem(template = VERIFICATION_LETTER, { now = new Date() } = {}) {
  const a = template && template.approval;
  if (!a || a.status !== 'APPROVED') return OOB_REFUSAL.LETTER_TEXT_NOT_APPROVED;
  if (humanActorProblem(a.approvedBy)) return OOB_REFUSAL.LETTER_APPROVER_NOT_HUMAN;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.approvedOn)) || !isIso(a.approvedOn + 'T00:00:00Z') || Date.parse(a.approvedOn + 'T00:00:00Z') > now.getTime()) {
    return OOB_REFUSAL.LETTER_APPROVAL_DATE_INVALID;
  }
  return null;
}

/**
 * Whether a verification letter may be ISSUED (handed to staff to mail), and
 * if so the rendered letter.
 *
 *   client   { known: true, onFileSince }         an existing client, on file before the request
 *   address  { source: 'ON_FILE', verifiedAt }    verified BEFORE the suspicious request arrived;
 *            suppliedByRequest must not be true   never an address the request brought
 *   request  { receivedAt, caseRef }              when the suspicious request arrived; opaque reference
 *   actor    the person deciding — the layer's reviewer rule (allow-list, fail-closed)
 *
 * Refusals are named and checked in this order: the person, the text, the
 * client, the request, the address. The letter text is rendered last and is
 * itself checked (letterContentProblem) before it is returned.
 */
export function mayIssueVerificationLetter({ client, address, request, actor, language = 'en', env, now = new Date(), template = VERIFICATION_LETTER } = {}) {
  const who = env === undefined ? reviewerProblem(actor) : reviewerProblem(actor, env);
  if (who) return { allowed: false, reason: who };
  const approval = letterApprovalProblem(template, { now });
  if (approval) return { allowed: false, reason: approval };
  if (!client || client.known !== true || !isIso(client.onFileSince)) return { allowed: false, reason: OOB_REFUSAL.CLIENT_NOT_KNOWN };
  if (!request || !isIso(request.receivedAt)) return { allowed: false, reason: OOB_REFUSAL.REQUEST_TIME_MISSING };
  if (Date.parse(client.onFileSince) >= Date.parse(request.receivedAt)) return { allowed: false, reason: OOB_REFUSAL.CLIENT_NOT_KNOWN };
  if (typeof request.caseRef !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(request.caseRef)) return { allowed: false, reason: OOB_REFUSAL.CASE_REF_MISSING };
  if (!address || address.source !== 'ON_FILE') return { allowed: false, reason: OOB_REFUSAL.ADDRESS_NOT_ON_FILE };
  if (address.suppliedByRequest === true) return { allowed: false, reason: OOB_REFUSAL.ADDRESS_SUPPLIED_BY_REQUEST };
  // Not having asked where the address came from is not the same as having
  // asked and found it on file (the do-not-contact rule in consent.js, CT-07).
  if (address.suppliedByRequest !== false) return { allowed: false, reason: OOB_REFUSAL.ADDRESS_PROVENANCE_UNKNOWN };
  if (!isIso(address.verifiedAt) || Date.parse(address.verifiedAt) >= Date.parse(request.receivedAt)) {
    return { allowed: false, reason: OOB_REFUSAL.ADDRESS_NOT_PREVIOUSLY_VERIFIED };
  }
  if (language !== 'en' && language !== 'es') return { allowed: false, reason: OOB_REFUSAL.LANGUAGE_UNKNOWN };
  const text = template[language];
  const body = text.body.split('{caseRef}').join(request.caseRef);
  const content = letterContentProblem(text.subject + '\n' + body);
  if (content) return { allowed: false, reason: content };
  return {
    allowed: true,
    reason: 'OK',
    letter: { version: template.version, language, subject: text.subject, body, caseRef: request.caseRef },
    mailing: 'STAFF_ACTION',
    decidedBy: actor,
    decidedAt: now.toISOString(),
  };
}

// ── The call ─────────────────────────────────────────────────────────────────

/**
 * Whether a human may place a verification call to the number on the request.
 *
 *   requestPhone     the number the suspicious request carried
 *   dialPhone        the number staff intend to dial — must be that one
 *   callbackConsent  the CALLBACK_CONTACT_PERMISSION on file (the contact basis)
 *   doNotContact     the suppression-list answer: false once checked, never absent
 *   caller           the person calling (the one human-actor rule); callerMode 'HUMAN'
 *   purpose          must be VERIFICATION_CALL_PURPOSE — never a marketing purpose
 *
 * The contact basis is decided by consent.mayPlaceOutbound() for a human
 * caller: it refuses an unknown or set do-not-contact and a missing or
 * wrong-typed consent. An automated or AI caller is refused here by name.
 */
export function mayPlaceVerificationCall({ requestPhone, dialPhone, callbackConsent, doNotContact, caller, callerMode, purpose } = {}) {
  if (purpose !== VERIFICATION_CALL_PURPOSE) return { allowed: false, reason: OOB_REFUSAL.PURPOSE_NOT_VERIFICATION };
  if (callerMode !== 'HUMAN' || humanActorProblem(caller)) return { allowed: false, reason: OOB_REFUSAL.CALLER_NOT_HUMAN };
  const requested = digitsOf(requestPhone);
  if (!requested) return { allowed: false, reason: OOB_REFUSAL.REQUEST_NUMBER_MISSING };
  if (digitsOf(dialPhone) !== requested) return { allowed: false, reason: OOB_REFUSAL.NUMBER_NOT_THE_REQUEST_NUMBER };
  const basis = mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent, doNotContact });
  if (!basis.allowed) return { allowed: false, reason: basis.reason };
  return {
    allowed: true,
    reason: 'OK',
    purpose: VERIFICATION_CALL_PURPOSE,
    contactBasis: basis.reason,
    consentScope: basis.scope,
    script: 'SECURITY_VERIFICATION_ONLY',
    planMarketing: false,
    caller,
  };
}

// ── The callback ─────────────────────────────────────────────────────────────

/**
 * The person called back through the official number: re-open the case so a
 * human can verify context and proceed from the appropriate gate. Returns the
 * re-opened case; it changes NO verification field — a call received is not a
 * channel verified and not an identity verified — and names the next gate.
 *
 *   caseRecord  { status, … }  one of the re-openable states
 *   inbound     { direction: 'INBOUND', dialedNumber }  the call as the phone system reports it
 *   actor       the person who took the call
 */
export function reopenCaseOnCallback(caseRecord, { inbound, actor, now = new Date() } = {}) {
  if (!caseRecord || typeof caseRecord !== 'object' || !REOPENABLE.includes(caseRecord.status)) {
    return { ok: false, reason: OOB_REFUSAL.CASE_NOT_REOPENABLE };
  }
  if (!inbound || inbound.direction !== 'INBOUND') return { ok: false, reason: OOB_REFUSAL.NOT_AN_INBOUND_CALL };
  if (digitsOf(inbound.dialedNumber) !== OFFICIAL_CONTACT.phoneDigits) return { ok: false, reason: OOB_REFUSAL.NOT_THROUGH_OFFICIAL_NUMBER };
  const who = humanActorProblem(actor);
  if (who) return { ok: false, reason: who };
  return {
    ok: true,
    reason: 'OK',
    nextGate: 'VERIFY_CONTEXT_THEN_HUMAN_CONFIRMATION',
    case: {
      ...caseRecord,
      status: CASE_STATUS.REOPENED,
      reopened: {
        at: now.toISOString(),
        by: actor,
        via: 'INBOUND_OFFICIAL_NUMBER',
        previousStatus: caseRecord.status,
        verificationChanged: false,
      },
    },
  };
}

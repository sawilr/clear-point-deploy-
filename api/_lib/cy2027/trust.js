// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — LEAD TRUST, ANTI-ABUSE AND HUMAN CONFIRMATION GATE (spec §12, §13, §15).
//
// Two ideas the spec is emphatic about, encoded here so they cannot drift:
//
//  1. "Uncertainty is not fraud." Nothing in this module rejects a person.
//     The worst outcome is SECURITY_QUARANTINE, which means "a human looks at
//     it", not "denied". Spec §12 explicitly forbids rejecting someone for
//     struggling with questions, having an accent, using a caregiver, not
//     knowing plan terminology, or lacking email.
//
//  2. "An OTP proves control of a channel, not legal identity." Channel
//     verification and identity verification are separate fields and this
//     module refuses to let one stand in for the other.
//
// Spec §15 forbids health/disability/medication/Medicaid/LIS/income/race/
// gender/national-origin from influencing commercial routing or scoring.
// PROHIBITED_SIGNALS is enforced by a throw, not a lint rule.
// ─────────────────────────────────────────────────────────────────────────────

export const LEAD_TRUST_STATE = Object.freeze({
  VERIFIED_REQUEST: 'VERIFIED_REQUEST',
  PARTIALLY_VERIFIED: 'PARTIALLY_VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  SECURITY_QUARANTINE: 'SECURITY_QUARANTINE',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
});

export const CHANNEL_VERIFICATION = Object.freeze({
  NOT_ATTEMPTED: 'NOT_ATTEMPTED',
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  FAILED: 'FAILED',
});

export const IDENTITY_VERIFICATION = Object.freeze({
  NOT_VERIFIED: 'NOT_VERIFIED',
  VERIFIED_BY_LICENSED_HUMAN: 'VERIFIED_BY_LICENSED_HUMAN',
});

/**
 * Signals that MAY contribute to a review decision (spec §12).
 * Note these are abuse/consistency signals, never attributes of the person.
 */
export const REVIEW_SIGNALS = Object.freeze([
  'IMPOSSIBLE_STATE_ZIP',
  'REPEATED_MASS_SUBMISSION',
  'DEVICE_IP_VELOCITY',
  'MANY_NAMES_ONE_SOURCE',
  'DISPOSABLE_CONTACT_DATA',
  'CONFLICTING_CALLBACK_ANSWERS',
  'REPEATED_FAILED_OTP',
  'AUTOMATION_BOT_BEHAVIOR',
  'ACCESS_ATTEMPT_ANOTHER_RECORD',
]);

/**
 * Signals that may NEVER influence trust, routing, scoring or priority.
 * Spec §15 and §33 ("Medical detail is used for commercial scoring/routing"
 * is an immediate-fail critical failure).
 */
export const PROHIBITED_SIGNALS = Object.freeze([
  'HEALTH_CONDITION',
  'DIAGNOSIS',
  'DISABILITY',
  'MEDICATION',
  'MEDICATION_COST',
  'MEDICAID_STATUS',
  'LIS_STATUS',
  'INCOME',
  'RACE_ETHNICITY',
  'GENDER',
  'NATIONAL_ORIGIN',
  'ACCENT',
  'CAREGIVER_PRESENT',
  'NO_EMAIL',
  'STRUGGLED_WITH_QUESTIONS',
  'UNFAMILIAR_WITH_TERMINOLOGY',
  'EXPECTED_COMMISSION',
]);

/**
 * Identity factors that must NEVER be requested for routine pre-SOA
 * verification (spec §12, §14, and §33 "SSN/MBI/banking is requested in
 * pre-intake" = immediate fail).
 */
export const FORBIDDEN_IDENTITY_FACTORS = Object.freeze(['SSN', 'MBI', 'MEDICARE_NUMBER', 'BANK_ACCOUNT', 'CARD_NUMBER']);

/** Throws if a caller tries to feed a prohibited attribute into trust logic. */
export function assertSignalAllowed(signal) {
  if (PROHIBITED_SIGNALS.includes(signal)) {
    throw new Error(
      `trust: "${signal}" may never influence trust, routing or scoring (spec §15). ` +
        'This is listed as an immediate-fail critical failure.',
    );
  }
  if (!REVIEW_SIGNALS.includes(signal)) {
    throw new Error(`trust: unknown signal "${signal}". Add it to REVIEW_SIGNALS deliberately or drop it.`);
  }
  return true;
}

/** Throws if a verification flow tries to use SSN/MBI/banking as a factor. */
export function assertIdentityFactorAllowed(factor) {
  if (FORBIDDEN_IDENTITY_FACTORS.includes(String(factor || '').toUpperCase())) {
    throw new Error(
      `trust: "${factor}" may not be used for routine pre-SOA identity verification (spec §12). ` +
        'Use low-friction channel verification: full name + confirmed state/ZIP + one-time code.',
    );
  }
  return true;
}

/**
 * Compute the trust state.
 *
 * Deliberately conservative in one direction only: more signals can push a
 * lead toward human review, never toward rejection, and never toward a worse
 * level of SERVICE. Spec §15: "A person who answers 'I don't know' receives the
 * same service path as a person who knows the answer."
 */
export function evaluateTrust({
  channelVerification = CHANNEL_VERIFICATION.NOT_ATTEMPTED,
  identityVerification = IDENTITY_VERIFICATION.NOT_VERIFIED,
  signals = [],
  accessedAnotherRecord = false,
} = {}) {
  const active = Array.from(new Set(signals.filter(Boolean)));
  active.forEach(assertSignalAllowed);

  const hard = active.includes('ACCESS_ATTEMPT_ANOTHER_RECORD') || accessedAnotherRecord;
  if (hard) {
    return {
      state: LEAD_TRUST_STATE.SECURITY_QUARANTINE,
      signals: active,
      humanReviewRequired: true,
      reason: 'ACCESS_ATTEMPT_ANOTHER_RECORD',
    };
  }
  if (active.length >= 2) {
    return {
      state: LEAD_TRUST_STATE.SECURITY_QUARANTINE,
      signals: active,
      humanReviewRequired: true,
      reason: 'MULTIPLE_REVIEW_SIGNALS',
    };
  }
  if (active.length === 1) {
    return {
      state: LEAD_TRUST_STATE.HUMAN_REVIEW_REQUIRED,
      signals: active,
      humanReviewRequired: true,
      reason: active[0],
    };
  }
  if (identityVerification === IDENTITY_VERIFICATION.VERIFIED_BY_LICENSED_HUMAN) {
    return { state: LEAD_TRUST_STATE.VERIFIED_REQUEST, signals: active, humanReviewRequired: false, reason: 'IDENTITY_VERIFIED' };
  }
  if (channelVerification === CHANNEL_VERIFICATION.VERIFIED) {
    // An OTP proves control of a channel, not identity — hence PARTIALLY.
    return { state: LEAD_TRUST_STATE.PARTIALLY_VERIFIED, signals: active, humanReviewRequired: false, reason: 'CHANNEL_VERIFIED' };
  }
  return { state: LEAD_TRUST_STATE.UNVERIFIED, signals: active, humanReviewRequired: false, reason: 'NO_VERIFICATION_YET' };
}

/**
 * What a given trust state is allowed to do (spec §12, §13).
 * Quarantine blocks automated outbound marketing, home-visit creation and any
 * CRM data exposure — but never blocks being served by a human.
 */
export function trustCapabilities(state) {
  const quarantined = state === LEAD_TRUST_STATE.SECURITY_QUARANTINE || state === LEAD_TRUST_STATE.HUMAN_REVIEW_REQUIRED;
  return {
    mayExposeCrmData: state === LEAD_TRUST_STATE.VERIFIED_REQUEST,
    mayPrefillPrivateData: state === LEAD_TRUST_STATE.VERIFIED_REQUEST,
    mayStartAutomatedOutbound: false, // never, from any state (spec §24)
    mayCreateHomeVisit: !quarantined,
    mayCompleteSoa: !quarantined,
    mayBeServedByHuman: true,
    requiresHumanReview: quarantined,
  };
}

/**
 * Build the SECURITY REVIEW task payload (spec §13).
 * Carries "only non-sensitive facts needed to validate the request" — the
 * allowlist below is the control; anything else is dropped rather than trusted
 * to the caller's discretion.
 */
export function buildSecurityReviewTask(ctx = {}) {
  const allow = ['requestId', 'correlationId', 'state', 'zip', 'channel', 'language', 'signals', 'trustState', 'receivedAt'];
  const facts = {};
  for (const k of allow) if (ctx[k] !== undefined) facts[k] = ctx[k];
  return {
    kind: 'SECURITY_REVIEW',
    priority: 'HIGH',
    aiMayApprove: false,
    decision: null,
    reviewer: null,
    reviewedAt: null,
    reasonCode: null,
    evidenceReference: ctx.evidenceReference || null,
    facts,
    instructions:
      'Confirm the request, reject as duplicate/invalid, or request another safe verification step. ' +
      'Verification contact must be documented as security/request verification, not plan marketing.',
  };
}

/**
 * Record a human decision on a quarantined case. Spec §13: "No AI self-approval
 * of quarantined cases." `actor` must be a human identifier; the function
 * throws for anything that looks like an automated approver.
 */
export function resolveSecurityReview(task, { actor, decision, reasonCode, at = new Date().toISOString(), evidenceReference = null }) {
  if (!task || task.kind !== 'SECURITY_REVIEW') throw new Error('trust: not a security review task');
  if (!actor || /^(ai|bot|system|automation|agent[-_]?ai)$/i.test(String(actor))) {
    throw new Error('trust: security review requires a human reviewer (spec §13 forbids AI self-approval)');
  }
  if (!['CONFIRMED', 'REJECTED_DUPLICATE', 'REJECTED_INVALID', 'NEEDS_FURTHER_VERIFICATION'].includes(decision)) {
    throw new Error(`trust: unknown review decision "${decision}"`);
  }
  if (!reasonCode) throw new Error('trust: reasonCode is required on every review decision');
  return { ...task, decision, reviewer: actor, reviewedAt: at, reasonCode, evidenceReference };
}

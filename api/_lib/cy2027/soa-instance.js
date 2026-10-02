// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — APPOINTMENT-SPECIFIC SOA INSTANCE (spec §7, §8, §11).
//
// "Do not implement a persistent 'universal SOA' that authorizes all future
//  appointments. CMS rejected that approach for CY2027. Build one Master SOA
//  TEMPLATE that generates a new appointment-specific SOA INSTANCE."
//
// "Every SOA instance is tied to plan/contract year, appointment, selected
//  product categories, beneficiary, channel, language, state, version, and
//  evidence."
//
// Pure module: no crypto, no fetch, no Node APIs — so the client can run the
// exact same validity logic the server enforces. Hashing and persistence live
// in ./evidence.js (server only).
// ─────────────────────────────────────────────────────────────────────────────

import {
  AUTHORIZING_CATEGORY_CODES,
  ALL_CATEGORY_CODES,
  SOA_SCRIPT_VERSION,
  categoryByCode,
} from './soa-text.js';

/** Lifecycle of one instance. */
export const SOA_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PENDING_SIGNATURE: 'PENDING_SIGNATURE',
  COMPLETED: 'COMPLETED',
  SUPERSEDED: 'SUPERSEDED',
  REVOKED: 'REVOKED',
  INCOMPLETE: 'SOA_INCOMPLETE',
});

/**
 * How the instance was captured. `written` is the load-bearing property:
 * CY2027 in-person personal marketing appointments require a WRITTEN SOA, and
 * a voice-only record must never unlock one (spec §10, §11, §33).
 */
export const SOA_METHOD = Object.freeze({
  WEB_ELECTRONIC_SIGNATURE: { code: 'WEB_ELECTRONIC_SIGNATURE', written: true, source: 'WEB' },
  SMS_LINK_ELECTRONIC: { code: 'SMS_LINK_ELECTRONIC', written: true, source: 'SMS_LINK' },
  EMAIL_LINK_ELECTRONIC: { code: 'EMAIL_LINK_ELECTRONIC', written: true, source: 'EMAIL_LINK' },
  APPROVED_WRITTEN_METHOD: { code: 'APPROVED_WRITTEN_METHOD', written: true, source: 'APPROVED_WRITTEN_METHOD' },
  VOICE_RECORDED: { code: 'VOICE_RECORDED', written: false, source: 'WEB' },
});

export function methodIsWritten(methodCode) {
  const m = SOA_METHOD[methodCode];
  return !!m && m.written === true;
}

/**
 * Split a raw selection into what it actually authorizes and what it does not.
 * The "I am not sure" option is a selection but never an authorization, so it
 * is reported separately and never leaks into authorizedCategories (spec §8).
 */
export function partitionSelection(selectedCodes) {
  const sel = Array.isArray(selectedCodes) ? selectedCodes.filter((c) => ALL_CATEGORY_CODES.includes(c)) : [];
  const unique = Array.from(new Set(sel));
  const authorized = unique.filter((c) => categoryByCode(c)?.authorizes === true);
  const nonAuthorizing = unique.filter((c) => categoryByCode(c)?.authorizes === false);
  const declined = AUTHORIZING_CATEGORY_CODES.filter((c) => !authorized.includes(c));
  const invalid = (Array.isArray(selectedCodes) ? selectedCodes : []).filter((c) => !ALL_CATEGORY_CODES.includes(c));
  return { authorized, declined, nonAuthorizing, invalid };
}

/**
 * Build a new appointment-specific instance.
 *
 * `appointmentId` is REQUIRED. That single requirement is what makes a standing
 * universal SOA unrepresentable in this model rather than merely discouraged.
 *
 * Returns { ok:false, errors } instead of throwing, so the form can show field
 * errors; callers must never treat a non-ok result as a usable instance.
 */
export function createSoaInstance(input) {
  const {
    soaId,
    appointmentId,
    appointmentAt = null,
    appointmentFormat,
    planYear,
    state,
    zip,
    county = null,
    language,
    method,
    beneficiaryName,
    representativeRelationship = null,
    selectedCategories,
    stateRulesetVersion,
    soaFormVersion,
    scriptVersion = SOA_SCRIPT_VERSION,
    createdAt = new Date().toISOString(),
    supersedesId = null,
  } = input || {};

  const errors = {};
  if (!soaId) errors.soaId = 'required';
  if (!appointmentId) errors.appointmentId = 'required_no_universal_soa';
  if (!appointmentFormat) errors.appointmentFormat = 'required';
  if (!Number.isInteger(planYear)) errors.planYear = 'required';
  if (!state) errors.state = 'required';
  if (!/^\d{5}$/.test(String(zip || ''))) errors.zip = 'invalid_zip';
  if (language !== 'en' && language !== 'es') errors.language = 'required';
  if (!SOA_METHOD[method]) errors.method = 'invalid_method';
  if (!beneficiaryName || String(beneficiaryName).trim().length < 2) errors.beneficiaryName = 'required';
  if (!stateRulesetVersion) errors.stateRulesetVersion = 'required';
  if (!soaFormVersion) errors.soaFormVersion = 'required';

  const parts = partitionSelection(selectedCategories);
  if (parts.invalid.length) errors.selectedCategories = 'unknown_category';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    instance: {
      soaId,
      appointmentId,
      appointmentAt,
      appointmentFormat,
      planYear,
      state: String(state).toUpperCase(),
      zip,
      county,
      language,
      method,
      source: SOA_METHOD[method].source,
      beneficiaryName: String(beneficiaryName).trim(),
      representativeRelationship,
      authorizedCategories: parts.authorized,
      declinedCategories: parts.declined,
      nonAuthorizingSelections: parts.nonAuthorizing,
      stateRulesetVersion,
      soaFormVersion,
      scriptVersion,
      status: parts.authorized.length ? SOA_STATUS.PENDING_SIGNATURE : SOA_STATUS.INCOMPLETE,
      createdAt,
      completedAt: null,
      supersedesId,
      supersededById: null,
      revokedAt: null,
      integrityHash: null,
      evidenceReference: null,
    },
  };
}

/** Mark an instance signed. Does not compute evidence — see ./evidence.js. */
export function completeSoaInstance(instance, { completedAt = new Date().toISOString(), integrityHash, evidenceReference } = {}) {
  if (!instance) throw new Error('soa: nothing to complete');
  if (instance.status === SOA_STATUS.INCOMPLETE) {
    // Spec §10: if the beneficiary is confused, do not force completion.
    throw new Error('soa: cannot complete an instance with no authorized category (SOA_INCOMPLETE)');
  }
  if (!integrityHash) throw new Error('soa: integrityHash required to complete');
  if (!evidenceReference) throw new Error('soa: evidenceReference required to complete');
  return { ...instance, status: SOA_STATUS.COMPLETED, completedAt, integrityHash, evidenceReference };
}

/**
 * Create the replacement instance when scope changes (spec §9: "Editing
 * categories creates a new version/instance with supersession history").
 * Returns BOTH records so the caller persists the supersession on each side.
 */
export function superseded(previous, nextInput, { at = new Date().toISOString() } = {}) {
  if (!previous) throw new Error('soa: nothing to supersede');
  const built = createSoaInstance({ ...nextInput, supersedesId: previous.soaId });
  if (!built.ok) return built;
  return {
    ok: true,
    previous: { ...previous, status: SOA_STATUS.SUPERSEDED, supersededById: built.instance.soaId, supersededAt: at },
    instance: built.instance,
  };
}

export function revokeSoaInstance(instance, { at = new Date().toISOString() } = {}) {
  if (!instance) throw new Error('soa: nothing to revoke');
  return { ...instance, status: SOA_STATUS.REVOKED, revokedAt: at };
}

/** Does this instance authorize discussing a given category right now? */
export function coversCategory(instance, code) {
  if (!instance || instance.status !== SOA_STATUS.COMPLETED) return false;
  if (instance.revokedAt) return false;
  return instance.authorizedCategories.includes(code);
}

/**
 * Would discussing `code` require a new/updated instance? Spec §7: "If the
 * beneficiary wants to discuss an additional category not included in the
 * current SOA, pause plan-specific discussion, update/create the
 * appointment-specific SOA, confirm, and only then resume."
 */
export function requiresScopeUpdate(instance, code) {
  return !coversCategory(instance, code);
}

/**
 * The marketing gate. Returns { allowed, reason } — never a bare boolean, so
 * the refusal reason is logged and surfaced.
 *
 * Enforces, in order: completion, revocation, plan year, state, appointment
 * identity, the CY2027 ordering rule (SOA recorded BEFORE the appointment
 * begins) and the in-person written requirement.
 */
export function marketingGate(instance, appointment, ruleset) {
  if (!instance) return { allowed: false, reason: 'NO_SOA' };
  if (instance.status === SOA_STATUS.INCOMPLETE) return { allowed: false, reason: 'SOA_INCOMPLETE' };
  if (instance.status === SOA_STATUS.SUPERSEDED) return { allowed: false, reason: 'SOA_SUPERSEDED' };
  if (instance.status === SOA_STATUS.REVOKED || instance.revokedAt) return { allowed: false, reason: 'SOA_REVOKED' };
  if (instance.status !== SOA_STATUS.COMPLETED) return { allowed: false, reason: 'SOA_NOT_COMPLETED' };
  if (!instance.integrityHash || !instance.evidenceReference) {
    // Spec §26: "SOA evidence write failure -> marketing gate stays locked."
    return { allowed: false, reason: 'SOA_EVIDENCE_MISSING' };
  }
  if (!appointment) return { allowed: false, reason: 'NO_APPOINTMENT' };
  if (instance.appointmentId !== appointment.appointmentId) {
    return { allowed: false, reason: 'SOA_FOR_DIFFERENT_APPOINTMENT' };
  }
  if (ruleset && instance.planYear !== ruleset.planYear) {
    // Spec §7: "If the plan year changes, do not silently reuse the old instance."
    return { allowed: false, reason: 'SOA_PLAN_YEAR_MISMATCH' };
  }
  if (appointment.state && instance.state !== String(appointment.state).toUpperCase()) {
    return { allowed: false, reason: 'SOA_STATE_MISMATCH' };
  }
  if (ruleset?.soa?.mustPrecedeAppointment && instance.completedAt && appointment.startsAt) {
    if (Date.parse(instance.completedAt) >= Date.parse(appointment.startsAt)) {
      return { allowed: false, reason: 'SOA_NOT_RECORDED_BEFORE_APPOINTMENT' };
    }
  }
  const inPerson = appointment.format === 'IN_PERSON';
  if (inPerson && ruleset?.soa?.inPersonRequiresWritten && !methodIsWritten(instance.method)) {
    return { allowed: false, reason: 'IN_PERSON_REQUIRES_WRITTEN_SOA' };
  }
  return { allowed: true, reason: 'OK', authorizedCategories: instance.authorizedCategories };
}

/**
 * Spec §7: "If the appointment changes materially, or the plan year changes, do
 * not silently reuse the old instance."
 */
export function requiresNewInstance(instance, appointment, ruleset) {
  if (!instance || !appointment) return true;
  if (ruleset && instance.planYear !== ruleset.planYear) return true;
  if (instance.appointmentId !== appointment.appointmentId) return true;
  if (appointment.state && instance.state !== String(appointment.state).toUpperCase()) return true;
  // Format change matters when it crosses the written/voice boundary.
  if (appointment.format === 'IN_PERSON' && !methodIsWritten(instance.method)) return true;
  return false;
}

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
  APPOINTMENT_FORMATS,
  SOA_SCRIPT_VERSION,
  categoryByCode,
} from './soa-text.js';
import { rulesetVouchProblem, rulesetForAudit, activePlanYear } from './rulesets.js';

/**
 * RED TEAM 2026-10-02 (SOA-01, CRITICAL, reproduced) — in-person detection was
 * the single expression `appointment.format === 'IN_PERSON'`. Everything else
 * fell through to the NON-in-person branch, so a voice-only SOA unlocked an
 * in-person marketing appointment — the §33 immediate-fail — for 'in_person',
 * 'In Person', 'HOME_VISIT', ['IN_PERSON'] and for an appointment with no
 * format field at all. An exact-string compare is not a gate; it is a gate with
 * one key and an open window beside it.
 *
 * Formats are now resolved through the approved list. An unknown or absent
 * format resolves to null, and callers must refuse rather than assume remote.
 */
export function resolveFormat(value) {
  if (typeof value !== 'string') return null;
  const want = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return APPOINTMENT_FORMATS.find((f) => f.code === want) || null;
}

/** True only for a format the approved list marks as in person. */
export function formatIsInPerson(value) {
  const f = resolveFormat(value);
  return f ? f.inPerson === true : false;
}

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
// Entries are frozen individually: Object.freeze is shallow, and a table whose
// rows any importer can edit in place does not decide anything (the same
// reasoning as EF-07 for TPMO_DISCLAIMER_CONFIG).
export const SOA_METHOD = Object.freeze({
  WEB_ELECTRONIC_SIGNATURE: Object.freeze({ code: 'WEB_ELECTRONIC_SIGNATURE', written: true, source: 'WEB' }),
  SMS_LINK_ELECTRONIC: Object.freeze({ code: 'SMS_LINK_ELECTRONIC', written: true, source: 'SMS_LINK' }),
  EMAIL_LINK_ELECTRONIC: Object.freeze({ code: 'EMAIL_LINK_ELECTRONIC', written: true, source: 'EMAIL_LINK' }),
  APPROVED_WRITTEN_METHOD: Object.freeze({ code: 'APPROVED_WRITTEN_METHOD', written: true, source: 'APPROVED_WRITTEN_METHOD' }),
  VOICE_RECORDED: Object.freeze({ code: 'VOICE_RECORDED', written: false, source: 'WEB' }),
});

/**
 * How the document's language came to be what it is (audit G08).
 *
 * Only an ELECTION is signable. `SYSTEM_DEFAULT` and `INFERRED_FROM_LEAD` exist
 * so the gap is NAMEABLE — a caller that has no election must say so and be
 * refused, instead of quietly writing 'es' into a signed record and leaving an
 * auditor unable to tell a choice from a fallback.
 */
export const LANGUAGE_SOURCE = Object.freeze({
  BENEFICIARY_ELECTED: Object.freeze({ code: 'BENEFICIARY_ELECTED', signable: true }),
  REPRESENTATIVE_ELECTED: Object.freeze({ code: 'REPRESENTATIVE_ELECTED', signable: true }),
  SYSTEM_DEFAULT: Object.freeze({ code: 'SYSTEM_DEFAULT', signable: false }),
  INFERRED_FROM_LEAD: Object.freeze({ code: 'INFERRED_FROM_LEAD', signable: false }),
});

/**
 * RED TEAM 2026-10-03 (G08) — the first version looked the value up with a bare
 * LANGUAGE_SOURCE[source]. That walks the prototype chain and coerces: an array
 * ['BENEFICIARY_ELECTED'] and an object with a toString() were accepted as
 * elections and then STORED as an array / as {}, so the election vanished on
 * persistence; and the rows were mutable, so one assignment anywhere made
 * SYSTEM_DEFAULT signable process-wide. Only an own, string key counts.
 */
function languageSourceEntry(source) {
  if (typeof source !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(LANGUAGE_SOURCE, source)) return null;
  return LANGUAGE_SOURCE[source];
}

/** True only for a language the beneficiary (or their representative) picked. */
export function languageWasElected(source) {
  const s = languageSourceEntry(source);
  return !!s && s.signable === true;
}

const SOA_LANGUAGES = Object.freeze(['en', 'es']);

/** A document language is exactly 'en' or 'es' — never coerced, never defaulted. */
export function isSoaLanguage(value) {
  return typeof value === 'string' && SOA_LANGUAGES.includes(value);
}

/**
 * The human-readable form of an election, for the PDF and the read-back screen.
 * Throws on anything that is not an election: the first version printed
 * "Elected by beneficiary" for undefined, SYSTEM_DEFAULT and INFERRED_FROM_LEAD
 * alike — the same binary coalesce G08 exists to remove, on the signed artifact.
 */
const ELECTION_LABELS = Object.freeze({
  BENEFICIARY_ELECTED: Object.freeze({ en: 'Elected by beneficiary', es: 'Elegido por el beneficiario' }),
  REPRESENTATIVE_ELECTED: Object.freeze({ en: 'Elected by representative', es: 'Elegido por el representante' }),
});

export function languageElectionLabel(source, lang) {
  if (!languageWasElected(source)) throw new Error('soa: no language election to label (SOA_LANGUAGE_NOT_ELECTED)');
  if (!isSoaLanguage(lang)) throw new Error('soa: unknown language for the election label');
  return ELECTION_LABELS[source][lang];
}

/**
 * Read the election out of an untrusted request body. Pure, so the rule is
 * TESTED BY CALLING IT — the first G08 assertions were source greps, and the
 * red team showed the handler could be reverted to the old coalesce with every
 * one of them still passing.
 *
 * Returns { ok: true, language, languageSource } or { ok: false, reason } with
 * reason LANGUAGE_NOT_SUPPLIED | ELECTION_NOT_RECORDED | NOT_AN_ELECTION.
 */
export function readLanguageElection(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (!isSoaLanguage(b.language)) return { ok: false, reason: 'LANGUAGE_NOT_SUPPLIED' };
  if (typeof b.languageSource !== 'string' || !b.languageSource.trim()) {
    return { ok: false, reason: 'ELECTION_NOT_RECORDED' };
  }
  const source = b.languageSource.trim();
  if (!languageWasElected(source)) return { ok: false, reason: 'NOT_AN_ELECTION' };
  return { ok: true, language: b.language, languageSource: source };
}

/**
 * Who elected the language has to agree with who signed. A record that says
 * "elected by representative" while naming no representative — or names one and
 * attributes the election to the beneficiary — contradicts itself on the signed
 * artifact (spec §25: record relationship and authority basis, never guess).
 * Returns null when consistent, otherwise the named error.
 */
export function electionAttributionError(languageSource, representativeRelationship) {
  const hasRep = typeof representativeRelationship === 'string' && representativeRelationship.trim().length > 0;
  if (languageSource === 'REPRESENTATIVE_ELECTED' && !hasRep) return 'representative_required';
  if (languageSource === 'BENEFICIARY_ELECTED' && hasRep) return 'election_attribution_mismatch';
  return null;
}

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
    languageSource,
    method,
    beneficiaryName,
    representativeRelationship = null,
    selectedCategories,
    cmsRulesetVersion,
    stateRulesetVersion,
    soaFormVersion,
    scriptVersion = SOA_SCRIPT_VERSION,
    createdAt = new Date().toISOString(),
    supersedesId = null,
  } = input || {};

  const errors = {};
  if (!soaId) errors.soaId = 'required';
  if (!appointmentId) errors.appointmentId = 'required_no_universal_soa';
  // RED TEAM 2026-10-02 (SOA-01) — the instance's own format was never checked,
  // so 'carrier pop-up kiosk' was stored happily and then compared by equality
  // against 'IN_PERSON' forever after.
  if (!appointmentFormat) errors.appointmentFormat = 'required';
  else if (!resolveFormat(appointmentFormat)) errors.appointmentFormat = 'unknown_format';
  if (!Number.isInteger(planYear)) errors.planYear = 'required';
  if (!state) errors.state = 'required';
  if (!/^\d{5}$/.test(String(zip || ''))) errors.zip = 'invalid_zip';
  if (!isSoaLanguage(language)) errors.language = 'required';
  // AUDIT 2026-10-02 (G08) — the language of a signed document was inferred:
  // `lead?.language || 'es'` on the client and `body.language === 'en' ? 'en' : 'es'`
  // on the server. Both are silent defaults, so a reader of the signed record
  // could not distinguish "the beneficiary chose Spanish" from "hydration
  // produced no lead and the page defaulted to Spanish". The language is the
  // language the disclosures were READ in; it has to be an election, recorded
  // as one. A default is not signable.
  const sourceEntry = languageSourceEntry(languageSource);
  if (!sourceEntry) errors.languageSource = 'election_required';
  else if (!sourceEntry.signable) errors.languageSource = 'not_an_election';
  else {
    const attribution = electionAttributionError(languageSource, representativeRelationship);
    if (attribution) errors.languageSource = attribution;
  }
  if (!SOA_METHOD[method]) errors.method = 'invalid_method';
  if (!beneficiaryName || String(beneficiaryName).trim().length < 2) errors.beneficiaryName = 'required';
  if (!stateRulesetVersion) errors.stateRulesetVersion = 'required';
  if (!soaFormVersion) errors.soaFormVersion = 'required';
  // AUDIT 2026-10-04 (red team, SPEC-22) — spec §22: "Every live SOA/call points
  // to the exact ruleset version used at that date/time." The instance carried
  // the plan year, the STATE ruleset version and the form version, and nothing
  // that named the CMS ruleset: once a CMS_RULESET_2027-v1.1 exists, a 2027 SOA
  // could not say which one it was signed under. It is required, and it is
  // checked against the one thing in the same input it can be checked against:
  // it must be the version of the ruleset registered for that plan year.
  if (typeof cmsRulesetVersion !== 'string' || !cmsRulesetVersion) errors.cmsRulesetVersion = 'required';
  else {
    const registered = Number.isInteger(planYear) ? rulesetForAudit(planYear) : null;
    if (!registered || registered.version !== cmsRulesetVersion) errors.cmsRulesetVersion = 'not_the_ruleset_of_that_plan_year';
  }

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
      languageSource,
      method,
      source: SOA_METHOD[method].source,
      beneficiaryName: String(beneficiaryName).trim(),
      representativeRelationship:
        typeof representativeRelationship === 'string' && representativeRelationship.trim()
          ? representativeRelationship.trim()
          : null,
      authorizedCategories: parts.authorized,
      declinedCategories: parts.declined,
      nonAuthorizingSelections: parts.nonAuthorizing,
      cmsRulesetVersion,
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
  // RED TEAM 2026-10-03 (G08) — "no default is signable" lived only in the
  // constructor. A rehydrated or hand-built instance without an election was
  // completed, evidenced and let through the marketing gate.
  if (!isSoaLanguage(instance.language) || !languageWasElected(instance.languageSource)) {
    throw new Error('soa: cannot complete an instance whose language was not elected (SOA_LANGUAGE_NOT_ELECTED)');
  }
  if (!integrityHash) throw new Error('soa: integrityHash required to complete');
  if (!evidenceReference) throw new Error('soa: evidenceReference required to complete');
  // RED TEAM 2026-10-02 (SOA-03, HIGH) — a SUPERSEDED or REVOKED instance could
  // be handed back through here and returned to COMPLETED, reopening the gate on
  // a scope that had been replaced or withdrawn.
  if (instance.status === SOA_STATUS.SUPERSEDED) throw new Error('soa: a superseded instance cannot be completed again');
  if (instance.status === SOA_STATUS.REVOKED || instance.revokedAt) throw new Error('soa: a revoked instance cannot be completed');
  if (instance.status === SOA_STATUS.COMPLETED) throw new Error('soa: already completed');
  // Frozen so the authorized scope cannot be widened in place after signature
  // (SOA-05). The integrity hash covers the scope; the object now matches it.
  return Object.freeze({
    ...instance,
    status: SOA_STATUS.COMPLETED,
    completedAt,
    integrityHash,
    evidenceReference,
    authorizedCategories: Object.freeze(instance.authorizedCategories.slice()),
    declinedCategories: Object.freeze(instance.declinedCategories.slice()),
  });
}

/**
 * Why one appointment's records cannot be read as "the active instance".
 * A problem is a refusal: the caller must not pick one and carry on.
 */
export const SOA_SCOPE_PROBLEM = Object.freeze({
  RECORDS_UNREADABLE: 'SOA_RECORDS_UNREADABLE',
  RECORD_UNREADABLE: 'SOA_RECORD_UNREADABLE',
  RECORD_DUPLICATED: 'SOA_RECORD_DUPLICATED',
  RECORD_CONTRADICTORY: 'SOA_RECORD_CONTRADICTORY',
  APPOINTMENT_MIXED: 'SOA_APPOINTMENT_MIXED',
  ACTIVE_SCOPE_CONFLICT: 'SOA_ACTIVE_SCOPE_CONFLICT',
});

/** The one spelling of "same person" this module compares names by. */
function sameBeneficiaryName(a, b) {
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
  return norm(a) !== '' && norm(a) === norm(b);
}

/**
 * Replace a signed instance with a newly built one for the SAME appointment
 * (spec §9: "Editing categories creates a new version/instance with
 * supersession history"; §31: "preserve first/second versions; define active
 * instance explicitly").
 *
 * AUDIT 2026-10-04 (EV-09, WVG-11) — superseded() built the replacement and
 * marked the previous without looking at either: a PENDING, REVOKED or already
 * SUPERSEDED record was "superseded" again, and the replacement could name a
 * different appointment, plan year, state or person, so the supersession
 * chain could silently re-scope another appointment. Every one of those is a
 * named refusal now, and the rule lives in ONE function that both the input
 * form (superseded) and the ledger call.
 *
 * `previous` is the prior record (an instance or a ledger entry carrying the
 * same fields). `instance` is the replacement as createSoaInstance built it:
 * not yet completed, with its OWN language election. Returns BOTH records so
 * the caller persists the supersession on each side; the previous is frozen,
 * like every signed record (SOA-05).
 */
export function supersede(previous, instance, { at = new Date().toISOString() } = {}) {
  if (!previous || typeof previous !== 'object') throw new Error('soa: nothing to supersede');
  if (!instance || typeof instance !== 'object') throw new Error('soa: no replacement instance');
  const errors = {};
  if (previous.status === SOA_STATUS.REVOKED || previous.revokedAt != null) errors.previous = 'revoked';
  else if (previous.status === SOA_STATUS.SUPERSEDED || previous.supersededById != null) errors.previous = 'already_superseded';
  else if (previous.status !== SOA_STATUS.COMPLETED) errors.previous = 'not_completed';
  if (typeof previous.soaId !== 'string' || !previous.soaId) errors.previous = errors.previous || 'unidentified';

  if (instance.status === SOA_STATUS.INCOMPLETE) errors.instance = 'nothing_authorized';
  else if (instance.status !== SOA_STATUS.PENDING_SIGNATURE) errors.instance = 'not_a_fresh_instance';
  else if (typeof instance.soaId !== 'string' || !instance.soaId || instance.soaId === previous.soaId) errors.instance = 'same_id';
  else if (instance.supersedesId != null && instance.supersedesId !== previous.soaId) errors.instance = 'supersedes_another';
  // The replacement is signed in its own right: its election is its own.
  if (!isSoaLanguage(instance.language) || !languageWasElected(instance.languageSource)) errors.languageSource = 'election_required';

  // AUDIT 2026-10-04 (EV-09, red team) — these compared the two records by
  // equality alone, so two records that both LACKED an appointment, a plan year
  // or a state were "the same" and the supersession went through. A field the
  // supersession is defined by must be present, in its own type, on both sides
  // before it can match; a string is compared as a string, never coerced.
  const stateOf = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : '');
  if (typeof previous.appointmentId !== 'string' || !previous.appointmentId || typeof instance.appointmentId !== 'string' || !instance.appointmentId) {
    errors.appointmentId = 'appointment_required';
  } else if (instance.appointmentId !== previous.appointmentId) errors.appointmentId = 'supersession_changes_appointment';
  if (!Number.isInteger(previous.planYear) || !Number.isInteger(instance.planYear)) errors.planYear = 'plan_year_required';
  else if (instance.planYear !== previous.planYear) errors.planYear = 'supersession_changes_plan_year';
  if (!stateOf(previous.state) || !stateOf(instance.state)) errors.state = 'state_required';
  else if (stateOf(instance.state) !== stateOf(previous.state)) errors.state = 'supersession_changes_state';
  if (!sameBeneficiaryName(instance.beneficiaryName, previous.beneficiaryName)) errors.beneficiaryName = 'supersession_changes_beneficiary';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    previous: Object.freeze({ ...previous, status: SOA_STATUS.SUPERSEDED, supersededById: instance.soaId, supersededAt: at }),
    instance: { ...instance, supersedesId: previous.soaId },
  };
}

/**
 * Create the replacement from form INPUT, then supersede with it. Kept as the
 * input-shaped entry point; the rule is supersede().
 */
export function superseded(previous, nextInput, { at = new Date().toISOString() } = {}) {
  if (!previous) throw new Error('soa: nothing to supersede');
  const built = createSoaInstance({ ...nextInput, supersedesId: previous.soaId });
  if (!built.ok) return built;
  return supersede(previous, built.instance, { at });
}

/**
 * THE definition of an appointment's active instance (spec §26: "Duplicate
 * contact/SOA -> reconcile; never create conflicting active scopes silently";
 * §31: "define active instance explicitly").
 *
 * Given every record for ONE appointment, the active instance is the single
 * record that is COMPLETED, not revoked and not superseded. None is a valid
 * answer ({ active: null }). Two is not: that is a conflict, and it is
 * returned as a refusal rather than resolved by "the latest wins", because a
 * record that contradicts another one is exactly what must not be acted on
 * silently. A record that contradicts itself (COMPLETED yet naming a
 * successor; SUPERSEDED yet naming none) is refused the same way.
 */
const SOA_STATUS_VALUES = Object.freeze(Object.values(SOA_STATUS));

export function activeSoaInstance(records) {
  if (!Array.isArray(records)) return { ok: false, reason: SOA_SCOPE_PROBLEM.RECORDS_UNREADABLE };
  const seen = new Set();
  const appointments = new Set();
  const active = [];
  for (const r of records) {
    if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.soaId !== 'string' || !r.soaId) {
      return { ok: false, reason: SOA_SCOPE_PROBLEM.RECORD_UNREADABLE };
    }
    if (seen.has(r.soaId)) return { ok: false, reason: SOA_SCOPE_PROBLEM.RECORD_DUPLICATED, soaId: r.soaId };
    seen.add(r.soaId);
    appointments.add(r.appointmentId);
    // AUDIT 2026-10-04 (EV-09, red team) — statuses were recognised by naming
    // the three that matter and letting everything else fall through as "not
    // active", so a record whose status was 'completed' or 7 stood silently
    // beside a FRESH signature. A status outside SOA_STATUS is not a record
    // this function can read; it is refused, like any other unreadable one.
    if (!SOA_STATUS_VALUES.includes(r.status)) return { ok: false, reason: SOA_SCOPE_PROBLEM.RECORD_UNREADABLE, soaId: r.soaId };
    const completed = r.status === SOA_STATUS.COMPLETED;
    const revoked = r.status === SOA_STATUS.REVOKED || r.revokedAt != null;
    const replaced = r.status === SOA_STATUS.SUPERSEDED;
    const namesSuccessor = r.supersededById != null;
    // Exactly the SUPERSEDED records name a successor: a COMPLETED, PENDING or
    // REVOKED record that names one, or a SUPERSEDED one that does not, is a
    // record that contradicts itself.
    if (namesSuccessor !== replaced) {
      return { ok: false, reason: SOA_SCOPE_PROBLEM.RECORD_CONTRADICTORY, soaId: r.soaId };
    }
    if (completed && !revoked) active.push(r);
  }
  if (appointments.size > 1) return { ok: false, reason: SOA_SCOPE_PROBLEM.APPOINTMENT_MIXED };
  if (active.length > 1) {
    return { ok: false, reason: SOA_SCOPE_PROBLEM.ACTIVE_SCOPE_CONFLICT, soaIds: active.map((r) => r.soaId) };
  }
  return { ok: true, active: active.length ? active[0] : null };
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
 * Enforces, in order: the ruleset's own standing AT `now`, completion,
 * revocation, plan year and ruleset version, state, appointment identity, the
 * appointment falling in the ruleset's plan year, the CY2027 ordering rule (SOA
 * recorded BEFORE the appointment begins) and the in-person written requirement.
 *
 * `now` is the instant the gate is being asked; it defaults to the clock and
 * is a parameter so the rule can be run on either side of a rollover.
 * `registry` is for the suite only (see rulesetVouchProblem): every registered
 * ruleset passes or is inactive today, so a registered ruleset with an expired
 * source can only be shown to the gate through it. Production never passes it.
 */
export function marketingGate(instance, appointment, ruleset, { env, now = new Date(), registry } = {}) {
  // RED TEAM 2026-10-02 (SOA-02, CRITICAL, reproduced) — `ruleset` was optional
  // and every rule that depended on it was written `ruleset && …` or
  // `ruleset?.soa?.…`. Omitting it, or passing `{soa:{}}`, or passing the
  // SUPERSEDED CMS_RULESET_2026, silently switched OFF the plan-year check, the
  // ordering check and the in-person check — and the gate never consulted the
  // regulatory kill switch at all. An optional governing ruleset is not a
  // ruleset. It is now mandatory and self-validated, and the gate fails closed
  // on anything it cannot vouch for (spec §26).
  const e = env || (typeof process !== 'undefined' && process.env) || {};
  const killed = String(e.CY2027_REGULATORY_KILL || '').trim().toLowerCase();
  if (killed === '1' || killed === 'true' || killed === 'on' || killed === 'yes') {
    return { allowed: false, reason: 'REGULATORY_KILL_ENGAGED' };
  }
  if (!ruleset || typeof ruleset !== 'object') return { allowed: false, reason: 'RULESET_UNRESOLVED' };
  if (ruleset.status !== 'PRODUCTION_ACTIVE') {
    return { allowed: false, reason: 'RULESET_NOT_ACTIVE', status: ruleset.status || null };
  }
  if (!Number.isInteger(ruleset.planYear)) return { allowed: false, reason: 'RULESET_UNRESOLVED' };
  const rules = ruleset.soa;
  if (!rules || typeof rules.mustPrecedeAppointment !== 'boolean' || typeof rules.inPersonRequiresWritten !== 'boolean') {
    // A fabricated ruleset with an empty soa block used to pass straight through.
    return { allowed: false, reason: 'RULESET_INCOMPLETE' };
  }
  // AUDIT 2026-10-04 (SPEC-22) — the checks above look at the SHAPE of whatever
  // object is handed in. A complete, well-formed object saying
  // { planYear: 2028, status: 'PRODUCTION_ACTIVE', soa: {…} } has the right
  // shape and no standing: nobody promoted it. The gate now vouches only for the
  // registered ruleset of that plan year, and only if that ruleset may be
  // treated as active (see ruleset-lifecycle.js).
  // AUDIT 2026-10-04 (red team) — and only if it may govern live work NOW. The
  // vouch was registration + activation: the §22 kill condition (a required
  // source expired) and the calendar lived in resolveRuleset() alone, so the
  // gate opened where the resolver refused. It is the same judgement now, with
  // the same clock.
  const vouch = rulesetVouchProblem(ruleset, registry, now);
  if (vouch) return { allowed: false, reason: vouch };

  if (!instance) return { allowed: false, reason: 'NO_SOA' };
  if (instance.status === SOA_STATUS.INCOMPLETE) return { allowed: false, reason: 'SOA_INCOMPLETE' };
  if (instance.status === SOA_STATUS.SUPERSEDED) return { allowed: false, reason: 'SOA_SUPERSEDED' };
  if (instance.status === SOA_STATUS.REVOKED || instance.revokedAt) return { allowed: false, reason: 'SOA_REVOKED' };
  if (instance.status !== SOA_STATUS.COMPLETED) return { allowed: false, reason: 'SOA_NOT_COMPLETED' };
  if (!instance.integrityHash || !instance.evidenceReference) {
    // Spec §26: "SOA evidence write failure -> marketing gate stays locked."
    return { allowed: false, reason: 'SOA_EVIDENCE_MISSING' };
  }
  // G08 — a COMPLETED status on a record that cannot say the signer chose the
  // language it was read in does not open the gate.
  if (!isSoaLanguage(instance.language) || !languageWasElected(instance.languageSource)) {
    return { allowed: false, reason: 'SOA_LANGUAGE_NOT_ELECTED' };
  }
  if (!appointment) return { allowed: false, reason: 'NO_APPOINTMENT' };
  if (instance.appointmentId !== appointment.appointmentId) {
    return { allowed: false, reason: 'SOA_FOR_DIFFERENT_APPOINTMENT' };
  }
  if (instance.planYear !== ruleset.planYear) {
    // Spec §7: "If the plan year changes, do not silently reuse the old instance."
    return { allowed: false, reason: 'SOA_PLAN_YEAR_MISMATCH' };
  }
  // Spec §22 — the SOA must have been signed under THIS version of the ruleset,
  // not merely under some ruleset of the same year.
  if (typeof instance.cmsRulesetVersion !== 'string' || instance.cmsRulesetVersion !== ruleset.version) {
    return { allowed: false, reason: 'SOA_RULESET_VERSION_MISMATCH' };
  }
  // RED TEAM 2026-10-02 (SOA-06, HIGH) — guarded by `appointment.state &&`, so
  // an appointment with no state skipped the jurisdiction check entirely. State
  // drives the whole ruleset; not knowing it is a refusal, not a pass.
  if (!appointment.state) return { allowed: false, reason: 'APPOINTMENT_STATE_UNKNOWN' };
  if (instance.state !== String(appointment.state).toUpperCase()) {
    return { allowed: false, reason: 'SOA_STATE_MISMATCH' };
  }
  // RED TEAM 2026-10-02 (SOA-04, CRITICAL) — this was guarded by
  // `instance.completedAt && appointment.startsAt`, so an appointment with no
  // start time, or an unparseable date, skipped the CY2027 ordering rule
  // entirely. The rule the spec keeps for CY2027 is precisely that the SOA is
  // recorded BEFORE the appointment begins; a missing timestamp means we cannot
  // show that, which is a refusal, not a pass.
  //
  // AUDIT 2026-10-04 (red team) — and the appointment itself has to fall in the
  // plan year this ruleset governs: a March-2029 appointment opened the gate
  // under CMS_RULESET_2027. The start time is therefore required whatever the
  // ordering rule says, and an appointment in another plan year is refused.
  const appointmentStart = Date.parse(appointment.startsAt);
  if (!Number.isFinite(appointmentStart)) return { allowed: false, reason: 'APPOINTMENT_TIME_UNKNOWN' };
  if (activePlanYear(new Date(appointmentStart)) !== ruleset.planYear) {
    return { allowed: false, reason: 'APPOINTMENT_OUTSIDE_PLAN_YEAR' };
  }
  if (rules.mustPrecedeAppointment) {
    const signedTs = Date.parse(instance.completedAt);
    const startTs = Date.parse(appointment.startsAt);
    if (!Number.isFinite(signedTs) || !Number.isFinite(startTs)) {
      return { allowed: false, reason: 'APPOINTMENT_TIME_UNKNOWN' };
    }
    if (signedTs >= startTs) return { allowed: false, reason: 'SOA_NOT_RECORDED_BEFORE_APPOINTMENT' };
  }

  // RED TEAM 2026-10-02 (SOA-05, CRITICAL) — the gate trusted
  // instance.authorizedCategories without checking it against the rest of the
  // record, so a widened array on a completed instance simply authorized more.
  // The integrity hash covers the real scope; these checks catch a record that
  // contradicts itself before it is ever used.
  const authorized = Array.isArray(instance.authorizedCategories) ? instance.authorizedCategories : null;
  const declined = Array.isArray(instance.declinedCategories) ? instance.declinedCategories : [];
  if (!authorized || !authorized.length) return { allowed: false, reason: 'SOA_SCOPE_EMPTY' };
  if (authorized.some((c) => !AUTHORIZING_CATEGORY_CODES.includes(c))) {
    return { allowed: false, reason: 'SOA_SCOPE_INVALID' };
  }
  if (authorized.some((c) => declined.includes(c))) {
    return { allowed: false, reason: 'SOA_SCOPE_CONTRADICTORY' };
  }
  if (new Set(authorized).size !== authorized.length) return { allowed: false, reason: 'SOA_SCOPE_INVALID' };

  // The appointment's format must be one the approved list knows. An absent or
  // unrecognized format is refused, never treated as "not in person".
  const apptFormat = resolveFormat(appointment.format);
  if (!apptFormat) return { allowed: false, reason: 'UNKNOWN_APPOINTMENT_FORMAT' };

  // The SOA was signed for a stated modality. If the appointment has since
  // crossed the in-person boundary, the old instance does not cover it.
  const instFormat = resolveFormat(instance.appointmentFormat);
  if (!instFormat) return { allowed: false, reason: 'UNKNOWN_SOA_FORMAT' };
  if (instFormat.inPerson !== apptFormat.inPerson) {
    return { allowed: false, reason: 'APPOINTMENT_FORMAT_MISMATCH' };
  }

  if (apptFormat.inPerson && rules.inPersonRequiresWritten && !methodIsWritten(instance.method)) {
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
  // RED TEAM 2026-10-02 (SOA-01) — this repeated the same exact-string compare,
  // so the advisory stayed silent for 'in_person' and for an absent format too.
  const f = resolveFormat(appointment.format);
  if (!f) return true; // unknown format: re-paper rather than guess
  if (f.inPerson && !methodIsWritten(instance.method)) return true;
  const instF = resolveFormat(instance.appointmentFormat);
  if (!instF || instF.inPerson !== f.inPerson) return true;
  return false;
}

// AUDIT 2026-10-04 (SPEC-31 "User changes NY to NJ after SOA started") — the
// form withdrew the two acknowledgements and the typed signature when the
// document LANGUAGE changed (G08) but kept them when the residence STATE
// changed, so a signature typed under "Scope of Appointment - New York"
// survived a switch to New Jersey and was filed under the New Jersey ruleset.
// The rule is one pure function the form calls on a jurisdiction change:
// whatever was AFFIRMED is withdrawn when the context it was affirmed in
// changes; facts (ZIP, date, categories) are kept and re-confirmed at the
// read-back. Only a literal `true` counts as an affirmation and only a string
// as a signature; nothing is mutated and the answer is frozen.
export function affirmationsAfterContextChange(previous, next, affirmations) {
  const current = affirmations && typeof affirmations === 'object' ? affirmations : {};
  const same = previous === next;
  return Object.freeze({
    noObligation: same && current.noObligation === true,
    eSignature: same && current.eSignature === true,
    signature: same && typeof current.signature === 'string' ? current.signature : '',
  });
}

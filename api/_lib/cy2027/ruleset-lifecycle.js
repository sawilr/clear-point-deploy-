// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — RULESET LIFECYCLE (spec §22). Environment-neutral.
//
//   "New rules enter PENDING_REVIEW, then VERIFIED, then STAGING_TESTED, then
//    PRODUCTION_ACTIVE. No AI self-promotion of a new ruleset."
//   "Add regulatory kill switch to disable SOA/marketing workflow if required
//    rule source expires or cannot be validated."
//
// AUDIT 2026-10-04 (SPEC-22). Before this module the lifecycle was a list of
// five strings and a comment. Nothing checked that a status had been REACHED:
// editing one word turned a pending ruleset into an active one, and `sources`
// was a list of names with no date, so "a rule source expires" had nothing to
// evaluate. This module makes three things data instead of prose:
//
//   1. the ORDER — one step at a time, forward only, and ON RECORD: a ruleset
//      carries the frozen steps that took it to its status (`transitions`);
//   2. WHO — every step by an authorised reviewer (./actors.js), dated, not in
//      the future, and naming the ruleset version it promotes;
//   3. SOURCE REVIEW — when each required source was last verified, by whom,
//      and when it must be looked at again.
//
// AUDIT 2026-10-04 (red team). The first version of this module enforced the
// order only in recordRulesetTransition(), a constructor nothing consumed: one
// `promotion` object — pasted onto any ruleset, dated in the year 9999 — made it
// ATTESTED with no VERIFIED or STAGING_TESTED step anywhere; grandfathering was
// a version STRING, so a made-up object carrying a listed version passed; a
// verified source with no review-by date never expired; `verifiedBy` was never
// looked at. Each of those is now a rule about the ruleset OBJECT, checked every
// time it is judged.
//
// THE UNCOMFORTABLE FACT THIS RECORDS RATHER THAN HIDES: the rulesets that are
// active today (CMS 2026 and 2027, and the NY/NJ/CT state rulesets) were set to
// their status by the code that introduced them. No human step was ever
// recorded for any of them. They are therefore GRANDFATHERED — the registered
// objects themselves, by identity, and only if their version is on a closed
// list — and their attestation reads GRANDFATHERED_PENDING_OWNER until the
// owner attests. The list cannot grow: every ruleset added from now on needs
// the full chain.
// ─────────────────────────────────────────────────────────────────────────────

import { reviewerProblem } from './actors.js';
import { plainRecord, plainList, ownData } from './plain-record.js';

export const RULESET_LIFECYCLE = Object.freeze([
  'PENDING_REVIEW',
  'VERIFIED',
  'STAGING_TESTED',
  'PRODUCTION_ACTIVE',
  'SUPERSEDED',
]);

/** The only status that may follow `status`, or null if there is none. */
export function nextRulesetStatus(status) {
  if (typeof status !== 'string') return null;
  const i = RULESET_LIFECYCLE.indexOf(status);
  return i >= 0 && i < RULESET_LIFECYCLE.length - 1 ? RULESET_LIFECYCLE[i + 1] : null;
}

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

/** Longest reference to evidence that is still a reference and not a document. */
export const EVIDENCE_REFERENCE_MAX_CHARS = 200;

/** A real UTC instant, written canonically — impossible dates do not round-trip. */
function isIsoInstant(value) {
  if (typeof value !== 'string' || !ISO_INSTANT_RE.test(value)) return false;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 19) === value.slice(0, 19);
}

/** A real calendar date (YYYY-MM-DD). */
function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const t = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** A short, plain, non-empty pointer to what was reviewed. */
function isEvidenceReference(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= EVIDENCE_REFERENCE_MAX_CHARS &&
    !/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u.test(value);
}

/** A clock is a Date, an ISO string or a number of milliseconds. Anything else (null is 1970 to `new Date`) is NaN. */
const instantOf = (now) => {
  if (now instanceof Date) return now.getTime();
  return typeof now === 'string' || typeof now === 'number' ? new Date(now).getTime() : NaN;
};

const TRANSITION_KEYS = Object.freeze(['rulesetVersion', 'from', 'to', 'actor', 'at', 'evidenceReference']);

/**
 * Record ONE lifecycle step. Throws unless the step is the single next one, it
 * names the ruleset version it is about, the actor is an authorised reviewer,
 * the instant is real and there is evidence to point at. Returns a frozen
 * record; it changes no ruleset — rulesets are frozen data, and a status only
 * changes through a reviewed code change that appends this record to the
 * ruleset's `transitions`.
 */
export function recordRulesetTransition({ rulesetVersion: version, from, to, actor, at, evidenceReference } = {}) {
  if (!RULESET_LIFECYCLE.includes(from)) throw new Error(`ruleset: unknown status "${from}"`);
  if (!RULESET_LIFECYCLE.includes(to)) throw new Error(`ruleset: unknown status "${to}"`);
  if (nextRulesetStatus(from) !== to) {
    throw new Error(`ruleset: ${from} -> ${to} is not a single forward step (spec §22: no status may be skipped)`);
  }
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error('ruleset: a lifecycle step must name the ruleset version it promotes');
  }
  const problem = reviewerProblem(actor);
  if (problem) {
    throw new Error(`ruleset: a lifecycle step needs a named human who is an authorised reviewer (${problem}). Spec §22 forbids AI self-promotion of a ruleset.`);
  }
  if (!isIsoInstant(at)) throw new Error('ruleset: a lifecycle step needs the UTC instant it was decided');
  if (!isEvidenceReference(evidenceReference)) {
    throw new Error(`ruleset: a lifecycle step needs a reference to the evidence reviewed (at most ${EVIDENCE_REFERENCE_MAX_CHARS} plain characters)`);
  }
  return Object.freeze({ rulesetVersion: version, from, to, actor: actor.trim(), at, evidenceReference: evidenceReference.trim() });
}

/**
 * Rulesets activated BEFORE the lifecycle existed. Closed and frozen: the suite
 * pins this exact list, so a new ruleset cannot be waved through by adding its
 * version here. Being on the list is necessary, not sufficient: the caller must
 * also have established that the object IS the registered one (`registered`).
 */
export const GRANDFATHERED_RULESET_VERSIONS = Object.freeze([
  'CMS_RULESET_2026-v1.0',
  'CMS_RULESET_2027-v1.0',
  'NY-CY2027-v1.0',
  'NJ-CY2027-v1.0',
  'CT-CY2027-v1.0',
]);

export const GRANDFATHER_REASON =
  'Status set by the code that introduced the ruleset, before the lifecycle was enforced. ' +
  'No human promotion was recorded. Owner attestation is pending.';

/** The identifier a ruleset is known by (CMS rulesets use `version`, state rulesets `stateRulesetVersion`). */
function rulesetVersion(ruleset) {
  if (!ruleset || typeof ruleset !== 'object') return null;
  const v = ownData(ruleset, 'version') || ownData(ruleset, 'stateRulesetVersion');
  return typeof v === 'string' ? v : null;
}

/**
 * Is this ruleset one of the five that predate the lifecycle?
 * `registered` must be exactly true: the caller holds the registry and has
 * checked that this object is the one registered there. A look-alike that
 * merely carries a listed version string is not grandfathered.
 */
function isGrandfathered(ruleset, registered) {
  const version = rulesetVersion(ruleset);
  return registered === true && !!version && GRANDFATHERED_RULESET_VERSIONS.includes(version);
}

/**
 * Can this ruleset show every step that took it to its status? null when it
 * can; otherwise the named gap. The chain for PRODUCTION_ACTIVE is
 * PENDING_REVIEW→VERIFIED→STAGING_TESTED→PRODUCTION_ACTIVE, each step by an
 * authorised reviewer, in order of time, none dated after `now`, each naming
 * THIS ruleset's version, each with its evidence.
 */
export function lifecycleChainProblem(ruleset, now = new Date()) {
  if (!ruleset || typeof ruleset !== 'object') return 'LIFECYCLE_NOT_RECORDED';
  const status = ownData(ruleset, 'status');
  const target = typeof status === 'string' ? RULESET_LIFECYCLE.indexOf(status) : -1;
  if (target < 0) return 'LIFECYCLE_NOT_RECORDED';
  const steps = plainList(ownData(ruleset, 'transitions'));
  if (!steps || (steps.length === 0 && target > 0)) return 'LIFECYCLE_NOT_RECORDED';
  if (steps.length !== target) return 'LIFECYCLE_INCOMPLETE';
  const version = rulesetVersion(ruleset);
  const t = instantOf(now);
  if (!Number.isFinite(t)) return 'CLOCK_UNREADABLE';
  let previous = -Infinity;
  for (let i = 0; i < steps.length; i++) {
    const s = plainRecord(steps[i], TRANSITION_KEYS);
    if (!s) return 'LIFECYCLE_ENTRY_MALFORMED';
    if (s.from !== RULESET_LIFECYCLE[i] || s.to !== RULESET_LIFECYCLE[i + 1]) return 'LIFECYCLE_OUT_OF_ORDER';
    if (!version || s.rulesetVersion !== version) return 'LIFECYCLE_STEP_FOR_ANOTHER_RULESET';
    if (reviewerProblem(s.actor)) return 'LIFECYCLE_STEP_NOT_BY_A_REVIEWER';
    if (!isIsoInstant(s.at)) return 'LIFECYCLE_INSTANT_INVALID';
    const at = Date.parse(s.at);
    if (at < previous) return 'LIFECYCLE_NOT_CHRONOLOGICAL';
    if (at > t) return 'LIFECYCLE_STEP_IN_THE_FUTURE';
    if (!isEvidenceReference(s.evidenceReference)) return 'LIFECYCLE_EVIDENCE_MISSING';
    previous = at;
  }
  return null;
}

/**
 * The owner's attestation of a GRANDFATHERED ruleset: the one statement a
 * person can honestly make about a ruleset whose earlier steps never happened
 * on record. It lives in `promotion` and must name the version it attests, an
 * authorised reviewer, a real instant that is not in the future, and evidence.
 * It means nothing on a ruleset that is not grandfathered.
 */
function ownerAttestationProblem(ruleset, now) {
  const p = plainRecord(ownData(ruleset, 'promotion'), ['promotedBy', 'promotedAt', 'evidenceReference'], ['rulesetVersion']);
  if (!p) return 'ATTESTATION_RECORD_MISSING';
  if (reviewerProblem(p.promotedBy)) return 'ATTESTATION_NOT_BY_A_REVIEWER';
  if (!isIsoInstant(p.promotedAt)) return 'ATTESTATION_INSTANT_MISSING';
  const t = instantOf(now);
  if (!Number.isFinite(t) || Date.parse(p.promotedAt) > t) return 'ATTESTATION_IN_THE_FUTURE';
  if (!isEvidenceReference(p.evidenceReference)) return 'ATTESTATION_EVIDENCE_MISSING';
  if (p.rulesetVersion !== rulesetVersion(ruleset)) return 'ATTESTATION_FOR_ANOTHER_RULESET';
  return null;
}

/**
 * Where a ruleset stands on "who made this active?".
 *   ATTESTED                      every lifecycle step is on record
 *   GRANDFATHERED_OWNER_ATTESTED  predates the lifecycle; the owner has attested it
 *   GRANDFATHERED_PENDING_OWNER   predates the lifecycle; nothing is on record
 *   NOT_RECORDED                  none of the above — may not be treated as active
 * Only meaningful for PRODUCTION_ACTIVE and SUPERSEDED rulesets; an earlier
 * status has not been promoted yet and reports NOT_APPLICABLE.
 *
 * @param {{ registered?: boolean, now?: Date|string }} [standing]
 *   `registered` — true only when the caller has checked that `ruleset` is the
 *   object its registry holds. Grandfathering depends on it.
 */
export function rulesetAttestation(ruleset, { registered = false, now = new Date() } = {}) {
  if (!ruleset || typeof ruleset !== 'object') return 'NOT_RECORDED';
  const status = ownData(ruleset, 'status');
  if (status !== 'PRODUCTION_ACTIVE' && status !== 'SUPERSEDED') return 'NOT_APPLICABLE';
  if (lifecycleChainProblem(ruleset, now) === null) return 'ATTESTED';
  if (!isGrandfathered(ruleset, registered)) return 'NOT_RECORDED';
  return ownerAttestationProblem(ruleset, now) === null ? 'GRANDFATHERED_OWNER_ATTESTED' : 'GRANDFATHERED_PENDING_OWNER';
}

/**
 * May this ruleset be used as the active rules? null when it may; otherwise the
 * named reason. A PRODUCTION_ACTIVE status that cannot show how it was reached
 * is not an active ruleset.
 */
export function rulesetActivationProblem(ruleset, standing = {}) {
  if (!ruleset || typeof ruleset !== 'object') return 'RULESET_UNRESOLVED';
  if (ownData(ruleset, 'status') !== 'PRODUCTION_ACTIVE') return 'RULESET_NOT_ACTIVE';
  return rulesetAttestation(ruleset, standing) === 'NOT_RECORDED' ? 'RULESET_PROMOTION_NOT_RECORDED' : null;
}

const SOURCE_REVIEW_KEYS = Object.freeze(['name', 'url', 'verifiedOn', 'verifiedBy', 'reviewBy']);

/**
 * Source review. Each entry of `sourceReviews` is exactly
 *   { name, url, verifiedOn, verifiedBy, reviewBy }
 * with dates as YYYY-MM-DD or null. NULL MEANS UNKNOWN, and unknown is reported,
 * never treated as verified and never invented.
 *
 * Returns { listed, unreadable, overdue, unverified, malformed }:
 *   listed      how many sources the ruleset names
 *   unreadable  `sourceReviews` is present and is not a list — nothing in it can
 *               be evaluated, so nothing in it can be relied on
 *   overdue     a STATED review-by date has passed — "a required rule source
 *               expired"
 *   unverified  no verification on record
 *   malformed   a record nobody can rely on: a date that is not a real date, a
 *               verification dated after `now`, a verification with nobody — or
 *               nobody authorised — behind it, a verification with no review-by
 *               date (verified forever), a verifier named with no verification
 */
export function sourceReviewStatus(ruleset, now = new Date()) {
  const out = { listed: 0, unreadable: false, overdue: [], unverified: [], malformed: [] };
  if (!ruleset || typeof ruleset !== 'object') return out;
  if (!Object.prototype.hasOwnProperty.call(ruleset, 'sourceReviews')) return out;
  const list = plainList(ownData(ruleset, 'sourceReviews'));
  if (!list) { out.unreadable = true; return out; }
  out.listed = list.length;
  const t = instantOf(now);
  for (const entry of list) {
    const s = plainRecord(entry, SOURCE_REVIEW_KEYS);
    const name = s && typeof s.name === 'string' && s.name.trim() ? s.name : '(unnamed source)';
    if (!s || name === '(unnamed source)') { out.malformed.push(name); continue; }
    const verified = s.verifiedOn != null;
    if (!verified) {
      out.unverified.push(name);
      if (s.verifiedBy != null) out.malformed.push(name);
    } else if (!isIsoDate(s.verifiedOn)) {
      out.malformed.push(name);
    } else {
      if (!Number.isFinite(t) || Date.parse(s.verifiedOn + 'T00:00:00Z') > t) out.malformed.push(name);
      if (reviewerProblem(s.verifiedBy)) out.malformed.push(name);
      if (s.reviewBy == null) out.malformed.push(name);
    }
    if (s.reviewBy != null) {
      if (!isIsoDate(s.reviewBy)) out.malformed.push(name);
      else if (!Number.isFinite(t) || t > Date.parse(s.reviewBy + 'T23:59:59Z')) out.overdue.push(name);
    }
  }
  out.malformed = [...new Set(out.malformed)];
  return out;
}

/** True when a stated review date has passed, or a source record cannot be relied on (spec §22 kill condition). */
export function requiredSourceExpired(ruleset, now = new Date()) {
  const s = sourceReviewStatus(ruleset, now);
  return s.unreadable || s.overdue.length > 0 || s.malformed.length > 0;
}

/**
 * Do this ruleset's sources allow it to be used at `now`? null when they do.
 *   RULE_SOURCES_MISSING        no readable source list — or, for a ruleset that
 *                               went through the lifecycle, an empty one: a
 *                               ruleset that names no source has nothing that
 *                               could ever expire
 *   RULE_SOURCE_REVIEW_OVERDUE  a review date has passed, or a record cannot be
 *                               relied on (see sourceReviewStatus)
 *   RULE_SOURCE_NOT_VERIFIED    a source with no verification on record
 *
 * THE ONE DECLARED EXCEPTION: for a GRANDFATHERED ruleset, "nobody recorded a
 * verification" (and an empty list) is reported by preflight and does not lock.
 * Locking on it would switch the workflow off on a missing form field rather
 * than on a fact, and that workflow is separately gated on the owner's
 * attestation (SOA_PRECONDITIONS.rulesetPromotionAttested). Everything else —
 * an expired date, an unreadable record — locks a grandfathered ruleset too.
 */
export function sourceReviewProblem(ruleset, { registered = false, now = new Date() } = {}) {
  const s = sourceReviewStatus(ruleset, now);
  if (s.unreadable) return 'RULE_SOURCES_MISSING';
  if (s.overdue.length || s.malformed.length) return 'RULE_SOURCE_REVIEW_OVERDUE';
  if (isGrandfathered(ruleset, registered)) return null;
  if (s.listed === 0) return 'RULE_SOURCES_MISSING';
  if (s.unverified.length) return 'RULE_SOURCE_NOT_VERIFIED';
  return null;
}

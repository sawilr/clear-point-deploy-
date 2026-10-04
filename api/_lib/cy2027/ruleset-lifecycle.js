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
//   1. the ORDER — one step at a time, forward only;
//   2. the PROMOTION RECORD — who moved a ruleset to PRODUCTION_ACTIVE, when,
//      and on what evidence; a human, checked by ./actors.js;
//   3. SOURCE REVIEW — when each required source was last verified and when it
//      must be looked at again.
//
// THE UNCOMFORTABLE FACT THIS RECORDS RATHER THAN HIDES: the rulesets that are
// active today (CMS 2026 and 2027, and the NY/NJ/CT state rulesets) were set to
// their status by the code that introduced them. No human promotion was ever
// recorded for any of them. They are therefore GRANDFATHERED by an explicit,
// closed list — not given an invented reviewer — and their attestation status
// reads GRANDFATHERED_PENDING_OWNER until the owner attests. The list cannot
// grow: every ruleset added from now on needs a real promotion record.
// ─────────────────────────────────────────────────────────────────────────────

import { humanActorProblem } from './actors.js';

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

/**
 * Record ONE lifecycle step. Throws unless the step is the single next one, the
 * actor is a person, the instant is real and there is evidence to point at.
 * Returns a frozen record; it changes no ruleset — rulesets are frozen data, and
 * a status only changes through a reviewed code change that carries this record.
 */
export function recordRulesetTransition({ from, to, actor, at, evidenceReference } = {}) {
  if (!RULESET_LIFECYCLE.includes(from)) throw new Error(`ruleset: unknown status "${from}"`);
  if (!RULESET_LIFECYCLE.includes(to)) throw new Error(`ruleset: unknown status "${to}"`);
  if (nextRulesetStatus(from) !== to) {
    throw new Error(`ruleset: ${from} -> ${to} is not a single forward step (spec §22: no status may be skipped)`);
  }
  const problem = humanActorProblem(actor);
  if (problem) {
    throw new Error(`ruleset: a lifecycle step needs a named human (${problem}). Spec §22 forbids AI self-promotion of a ruleset.`);
  }
  if (!isIsoInstant(at)) throw new Error('ruleset: a lifecycle step needs the UTC instant it was decided');
  if (typeof evidenceReference !== 'string' || !evidenceReference.trim()) {
    throw new Error('ruleset: a lifecycle step needs a reference to the evidence reviewed');
  }
  return Object.freeze({ from, to, actor: actor.trim(), at, evidenceReference: evidenceReference.trim() });
}

/**
 * Rulesets activated BEFORE the lifecycle existed. Closed and frozen: the suite
 * pins this exact list, so a new ruleset cannot be waved through by adding its
 * version here.
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
  const v = ruleset.version || ruleset.stateRulesetVersion;
  return typeof v === 'string' ? v : null;
}

/** Why a promotion record is not acceptable — or null when it is complete. */
function promotionRecordProblem(promotion) {
  if (!promotion || typeof promotion !== 'object') return 'PROMOTION_RECORD_MISSING';
  if (humanActorProblem(promotion.promotedBy)) return 'PROMOTION_NOT_BY_A_PERSON';
  if (!isIsoInstant(promotion.promotedAt)) return 'PROMOTION_INSTANT_MISSING';
  if (typeof promotion.evidenceReference !== 'string' || !promotion.evidenceReference.trim()) {
    return 'PROMOTION_EVIDENCE_MISSING';
  }
  return null;
}

/**
 * Where a ruleset stands on "who made this active?".
 *   ATTESTED                     a complete human promotion record is attached
 *   GRANDFATHERED_PENDING_OWNER  on the closed list above; no record exists
 *   NOT_RECORDED                 neither — may not be treated as active
 * Only meaningful for PRODUCTION_ACTIVE and SUPERSEDED rulesets; an earlier
 * status has not been promoted yet and reports NOT_APPLICABLE.
 */
export function rulesetAttestation(ruleset) {
  if (!ruleset || typeof ruleset !== 'object') return 'NOT_RECORDED';
  if (ruleset.status !== 'PRODUCTION_ACTIVE' && ruleset.status !== 'SUPERSEDED') return 'NOT_APPLICABLE';
  if (promotionRecordProblem(ruleset.promotion) === null) return 'ATTESTED';
  const version = rulesetVersion(ruleset);
  if (version && GRANDFATHERED_RULESET_VERSIONS.includes(version)) return 'GRANDFATHERED_PENDING_OWNER';
  return 'NOT_RECORDED';
}

/**
 * May this ruleset be used as the active rules? null when it may; otherwise the
 * named reason. A PRODUCTION_ACTIVE status that nobody is on record as having
 * granted is not an active ruleset.
 */
export function rulesetActivationProblem(ruleset) {
  if (!ruleset || typeof ruleset !== 'object') return 'RULESET_UNRESOLVED';
  if (ruleset.status !== 'PRODUCTION_ACTIVE') return 'RULESET_NOT_ACTIVE';
  return rulesetAttestation(ruleset) === 'NOT_RECORDED' ? 'RULESET_PROMOTION_NOT_RECORDED' : null;
}

/**
 * Source review. Each entry of `sourceReviews` is
 *   { name, url, verifiedOn, verifiedBy, reviewBy }
 * with dates as YYYY-MM-DD or null. NULL MEANS UNKNOWN, and unknown is reported,
 * never treated as verified and never invented.
 *
 * Returns { overdue, unverified, malformed }:
 *   overdue     a STATED review-by date has passed — this is "a required rule
 *               source expired" and it locks the SOA/marketing workflow
 *   unverified  no verification on record — reported by preflight; it does not
 *               lock anything by itself, because for the grandfathered rulesets
 *               that would switch the workflow off on a missing form field
 *               rather than on a fact (and the workflow is separately gated on
 *               the owner's attestation, see SOA_PRECONDITIONS)
 *   malformed   a date that is not a real date — treated as overdue: a review
 *               date nobody can read is not a review date
 */
export function sourceReviewStatus(ruleset, now = new Date()) {
  const out = { overdue: [], unverified: [], malformed: [] };
  const list = ruleset && Array.isArray(ruleset.sourceReviews) ? ruleset.sourceReviews : [];
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  for (const s of list) {
    const name = s && typeof s.name === 'string' ? s.name : '(unnamed source)';
    if (!s || typeof s !== 'object') { out.malformed.push(name); continue; }
    if (s.verifiedOn == null) out.unverified.push(name);
    else if (!isIsoDate(s.verifiedOn)) out.malformed.push(name);
    if (s.reviewBy != null) {
      if (!isIsoDate(s.reviewBy)) out.malformed.push(name);
      else if (!Number.isFinite(t) || t > Date.parse(s.reviewBy + 'T23:59:59Z')) out.overdue.push(name);
    }
  }
  out.malformed = [...new Set(out.malformed)];
  return out;
}

/** True when a stated review date has passed or cannot be read (spec §22 kill condition). */
export function requiredSourceExpired(ruleset, now = new Date()) {
  const s = sourceReviewStatus(ruleset, now);
  return s.overdue.length > 0 || s.malformed.length > 0;
}

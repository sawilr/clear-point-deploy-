// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — YEARLY REGULATORY RULESET ENGINE (spec §22).
//
// "Create immutable versioned rulesets by plan year: CMS_RULESET_2026,
//  CMS_RULESET_2027, etc. Do not overwrite prior-year logic."
// "Every live SOA/call points to the exact ruleset version used at that
//  date/time."
// "No AI self-promotion of a new ruleset."
// "Add regulatory kill switch to disable SOA/marketing workflow if required
//  rule source expires or cannot be validated."
//
// The 2026 ruleset is preserved verbatim and marked SUPERSEDED rather than
// edited, so a 2026-dated SOA can still be explained years from now.
//
// SCOPE OF AUTHORITY: this file encodes the requirements as stated in the
// owner-approved CY2027 master execution prompt. It does not restate, extend
// or interpret the underlying CFR text, and no value here was derived from the
// model's own recollection of regulation. `sources` names what must be
// validated by a human each cycle; `sourceReviews` records whether and when
// that happened — and says "unknown" where nobody recorded it.
// ─────────────────────────────────────────────────────────────────────────────

import { rulesetActivationProblem, rulesetAttestation, requiredSourceExpired, nextRulesetStatus } from './ruleset-lifecycle.js';

/**
 * Instant at which marketing for a plan year may begin: 1 October of the year
 * before, 00:00 Eastern. 1 October always falls in daylight time (it ends in
 * November), so 00:00 Eastern is 04:00 UTC.
 */
export function marketingStartUtc(planYear) {
  return Date.UTC(Number(planYear) - 1, 9, 1, 4, 0, 0);
}

/**
 * Instant CY2027 marketing may begin: 2026-10-01T00:00 Eastern.
 * MUST stay identical to CY2027_MARKETING_START_UTC in src/lib/tpmoConfig.ts —
 * scripts/check-cy2027-parity.mjs fails the build if the two ever diverge.
 */
export const CY2027_MARKETING_START_UTC = Date.UTC(2026, 9, 1, 4, 0, 0);

/**
 * Plan year whose marketing rules are in force at `now`.
 *
 * AUDIT 2026-10-04 (SPEC-22) — this was `t >= CY2027_START ? 2027 : 2026`, so it
 * answered 2027 FOREVER. On 1 October 2027 the system would have gone on
 * applying the CY2027 ruleset to CY2028 appointments without a sound: exactly
 * the spec §33 immediate fail, "old-year rules … silently reused for new plan
 * year". The year is now computed from the calendar for any date. A year with
 * no active ruleset then fails closed in resolveRuleset(), which is the point.
 *
 * Returns NaN when the clock cannot be read; callers must treat that as a
 * refusal (resolveRuleset does, with CLOCK_UNREADABLE).
 */
export function activePlanYear(now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(t)) return NaN;
  const calendarYear = new Date(t).getUTCFullYear();
  return t >= marketingStartUtc(calendarYear + 1) ? calendarYear + 1 : calendarYear;
}

/**
 * Retention model (spec §19), expressed in years and assigned by record class
 * in ./retention.js. Encoded per plan year because retention obligations are a
 * property of the year's rules, not of today's calendar.
 */
const CY2027_RETENTION = Object.freeze({
  marketingSalesCallMinYears: 6,
  audioRequiredFirstYears: 3,
  // Frozen too: Object.freeze is shallow, and this array sat mutable inside two
  // frozen rulesets until scripts/check-no-self-modification.mjs walked them.
  audioOrCompleteTranscriptYears: Object.freeze([4, 6]),
  note:
    'Enrollment records may carry different or longer obligations; retention is assigned by record class using the longest applicable period (spec §19).',
});

/**
 * No human promotion was recorded for the rulesets that predate the lifecycle.
 * The fields are null because that is the truth; ./ruleset-lifecycle.js lists
 * these rulesets as grandfathered and reports the attestation as pending.
 * To attest, the owner replaces the three nulls of a ruleset with the reviewer's
 * name, the UTC instant and a reference to what was reviewed.
 */
const NO_PROMOTION_ON_RECORD = Object.freeze({ promotedBy: null, promotedAt: null, evidenceReference: null });

export const CMS_RULESET_2026 = Object.freeze({
  planYear: 2026,
  version: 'CMS_RULESET_2026-v1.0',
  status: 'SUPERSEDED',
  effectiveFrom: '2025-10-01',
  effectiveTo: '2026-09-30',
  soa: Object.freeze({
    /** CY2026 required the 48-hour advance window. Preserved, never reused. */
    advanceWaitHours: 48,
    mustPrecedeAppointment: true,
    inPersonRequiresWritten: true,
    nonInPersonAllowsRecorded: true,
    universalStandingSoaAllowed: false,
  }),
  tpmo: Object.freeze({
    /** CY2026 standardized sentence names the SHIP. */
    includesShipReference: true,
    requiresOrganizationAndProductCounts: true,
  }),
  retention: CY2027_RETENTION,
  sources: Object.freeze(['Superseded — retained for historical explainability only.']),
  sourceReviews: Object.freeze([]),
  promotion: NO_PROMOTION_ON_RECORD,
});

/** One source a human must verify each cycle. Dates are YYYY-MM-DD or null = not on record. */
const source = (name, url) => Object.freeze({ name, url, verifiedOn: null, verifiedBy: null, reviewBy: null });

export const CMS_RULESET_2027 = Object.freeze({
  planYear: 2027,
  version: 'CMS_RULESET_2027-v1.0',
  status: 'PRODUCTION_ACTIVE',
  effectiveFrom: '2026-10-01',
  effectiveTo: null,
  soa: Object.freeze({
    /**
     * CY2027 REMOVES the prior 48-hour waiting requirement. Do not implement a
     * 48-hour gate. What survives is the ordering rule below.
     */
    advanceWaitHours: 0,
    /** The SOA must be agreed and recorded BEFORE the appointment begins. */
    mustPrecedeAppointment: true,
    /** In-person personal marketing appointments require a WRITTEN SOA. */
    inPersonRequiresWritten: true,
    /** Non-in-person may use a valid audio/audio-visual/electronic record. */
    nonInPersonAllowsRecorded: true,
    /** CMS rejected a persistent universal SOA for CY2027. */
    universalStandingSoaAllowed: false,
  }),
  tpmo: Object.freeze({
    /** CY2027 standardized sentence drops the SHIP reference. */
    includesShipReference: false,
    requiresOrganizationAndProductCounts: true,
  }),
  retention: CY2027_RETENTION,
  sources: Object.freeze([
    'CMS CY2027 Agent and Broker Training & Testing Guidelines',
    'CMS CY2027 MA and Part D Final Rule',
    '42 CFR Part 422 Subpart V / 42 CFR Part 423 Subpart V',
  ]),
  // The URLs are the ones the owner's master execution prompt lists (§36,
  // "current regulatory anchors to verify during implementation"). Nobody is on
  // record as having verified them, so every date is null. Preflight reports
  // that; it is not papered over with a date.
  sourceReviews: Object.freeze([
    source('CMS CY2027 Agent and Broker Training & Testing Guidelines',
      'https://www.cms.gov/files/document/cy2027-agent-broker-training-testing-guidelines-pdf.pdf'),
    source('CMS CY2027 MA and Part D Final Rule Fact Sheet',
      'https://www.cms.gov/newsroom/fact-sheets/contract-year-2027-medicare-advantage-part-d-final-rule'),
    source('CY2027 Final Rule — Federal Register public inspection PDF',
      'https://public-inspection.federalregister.gov/2026-06600.pdf'),
    source('42 CFR Part 422 Subpart V',
      'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-422/subpart-V'),
    source('42 CFR Part 423 Subpart V',
      'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-423/subpart-V'),
  ]),
  promotion: NO_PROMOTION_ON_RECORD,
});

/**
 * CY2028 — IN PREPARATION (spec Phase 12: "Prepare next-year rules in parallel").
 *
 * This is a PLACEHOLDER, not a ruleset. Every rule value is null: nothing was
 * copied from 2027, because copying last year's rules forward is the failure
 * this engine exists to prevent. It is here so that
 *   • the year after 2027 has a NAMED state (PENDING_REVIEW) instead of nothing,
 *   • resolveRuleset(2028) refuses with a reason a person can act on, and
 *   • preflight can count down to the day it must be ready.
 * It becomes real only through the lifecycle, one recorded human step at a time.
 */
export const CMS_RULESET_2028 = Object.freeze({
  planYear: 2028,
  version: 'CMS_RULESET_2028-v0.0',
  status: 'PENDING_REVIEW',
  effectiveFrom: new Date(marketingStartUtc(2028)).toISOString().slice(0, 10),
  effectiveTo: null,
  soa: Object.freeze({
    advanceWaitHours: null,
    mustPrecedeAppointment: null,
    inPersonRequiresWritten: null,
    nonInPersonAllowsRecorded: null,
    universalStandingSoaAllowed: null,
  }),
  tpmo: Object.freeze({ includesShipReference: null, requiresOrganizationAndProductCounts: null }),
  retention: null,
  sources: Object.freeze([]),
  sourceReviews: Object.freeze([]),
  promotion: NO_PROMOTION_ON_RECORD,
});

const RULESETS = Object.freeze({ 2026: CMS_RULESET_2026, 2027: CMS_RULESET_2027, 2028: CMS_RULESET_2028 });

/** Is `ruleset` THE registered object for its plan year (not a look-alike)? */
export function isRegisteredRuleset(ruleset, registry = RULESETS) {
  if (!ruleset || typeof ruleset !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(registry, ruleset.planYear)) return false;
  return registry[ruleset.planYear] === ruleset;
}

/**
 * Why a ruleset OBJECT handed to a gate may not be relied on — or null.
 *   RULESET_NOT_REGISTERED          it merely resembles a ruleset
 *   RULESET_NOT_ACTIVE              registered, but not PRODUCTION_ACTIVE
 *   RULESET_PROMOTION_NOT_RECORDED  registered and "active", with nobody on
 *                                   record as having made it so
 * `registry` exists so the last case can be exercised: every ruleset registered
 * today is either inactive or grandfathered, so without it that branch could
 * only ever be read, never run.
 */
export function rulesetVouchProblem(ruleset, registry = RULESETS) {
  if (!isRegisteredRuleset(ruleset, registry)) return 'RULESET_NOT_REGISTERED';
  return rulesetActivationProblem(ruleset);
}

// ── Regulatory kill switch (spec §22) ────────────────────────────────────────
// Flipping this disables the SOA/marketing workflow without a deploy, for the
// case where a required rule source expires or cannot be validated. It is read
// from the environment so an operator can pull it immediately; it defaults to
// OFF (workflow permitted) because the per-ruleset status fields are the
// primary control.
export function regulatoryKillEngaged(env = process.env) {
  const v = String(env.CY2027_REGULATORY_KILL || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Resolve the ruleset governing a plan year. FAIL-CLOSED (spec §26).
 *   REGULATORY_KILL_ENGAGED         operator disabled the marketing workflow
 *   CLOCK_UNREADABLE                the plan year could not be derived from `now`
 *   RULESET_MISSING                 no ruleset for that year
 *   RULESET_NOT_ACTIVE              exists but is not PRODUCTION_ACTIVE
 *   RULESET_PROMOTION_NOT_RECORDED  active in name, but nobody is on record as
 *                                   having promoted it and it is not grandfathered
 *   RULE_SOURCE_REVIEW_OVERDUE      a stated source review date has passed
 *
 * This governs the SOA / marketing workflow only. Nothing on the public site or
 * in lead capture calls it, so a refusal here never takes the site down.
 */
export function resolveRuleset(planYear, now = new Date(), env = process.env) {
  if (regulatoryKillEngaged(env)) {
    return { ok: false, reason: 'REGULATORY_KILL_ENGAGED', humanReview: true };
  }
  let year;
  if (planYear == null) {
    year = activePlanYear(now);
    if (!Number.isInteger(year)) return { ok: false, reason: 'CLOCK_UNREADABLE', humanReview: true };
  } else {
    // An explicit year is a number or a numeric string. Anything else is not a
    // year this registry holds — it is not coerced into one.
    year = typeof planYear === 'number' || (typeof planYear === 'string' && /^\d{4}$/.test(planYear)) ? Number(planYear) : NaN;
    if (!Number.isInteger(year)) return { ok: false, reason: 'RULESET_MISSING', humanReview: true };
  }
  const rs = Object.prototype.hasOwnProperty.call(RULESETS, year) ? RULESETS[year] : null;
  if (!rs) return { ok: false, reason: 'RULESET_MISSING', planYear: year, humanReview: true };
  return evaluateRuleset(rs, now);
}

/**
 * Judge one ruleset: may it be used as the active rules at `now`?
 * Separate from the registry lookup so the rule can be exercised with rulesets
 * that are not registered (and must not be), instead of being trusted because
 * the two registered ones happen to pass.
 */
export function evaluateRuleset(rs, now = new Date()) {
  const planYear = rs && typeof rs === 'object' ? rs.planYear : undefined;
  const status = rs && typeof rs === 'object' ? rs.status : undefined;
  const problem = rulesetActivationProblem(rs);
  if (problem) return { ok: false, reason: problem, planYear, status, humanReview: true };
  if (requiredSourceExpired(rs, now)) {
    return { ok: false, reason: 'RULE_SOURCE_REVIEW_OVERDUE', planYear, status, humanReview: true };
  }
  return { ok: true, ruleset: rs, attestation: rulesetAttestation(rs) };
}

/**
 * Historical lookup — returns a ruleset regardless of status, for explaining a
 * past SOA. Never use this to authorize a live workflow; use resolveRuleset().
 */
export function rulesetForAudit(planYear) {
  const year = Number(planYear);
  return Number.isInteger(year) && Object.prototype.hasOwnProperty.call(RULESETS, year) ? RULESETS[year] : null;
}

/** Every known ruleset version, newest first. For the final report/inventory. */
export function rulesetInventory() {
  return Object.values(RULESETS)
    .slice()
    .sort((a, b) => b.planYear - a.planYear)
    .map((r) => ({
      planYear: r.planYear,
      version: r.version,
      status: r.status,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      attestation: rulesetAttestation(r),
      nextStatus: nextRulesetStatus(r.status),
    }));
}

/**
 * Where the calendar stands relative to the next plan year — for preflight, so
 * the rollover is announced in advance instead of discovered on 1 October.
 */
export function rolloverStatus(now = new Date()) {
  const planYear = activePlanYear(now);
  if (!Number.isInteger(planYear)) return { ok: false, reason: 'CLOCK_UNREADABLE' };
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const nextPlanYear = planYear + 1;
  const nextStart = marketingStartUtc(nextPlanYear);
  const next = rulesetForAudit(nextPlanYear);
  return {
    ok: true,
    planYear,
    nextPlanYear,
    nextMarketingStart: new Date(nextStart).toISOString(),
    daysUntilRollover: Math.ceil((nextStart - t) / 86_400_000),
    nextRulesetVersion: next ? next.version : null,
    nextRulesetStatus: next ? next.status : 'MISSING',
    nextRulesetReady: !!next && rulesetActivationProblem(next) === null,
  };
}

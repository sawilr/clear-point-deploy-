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
// validated by a human each cycle.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Instant CY2027 marketing may begin: 2026-10-01T00:00 Eastern.
 * MUST stay identical to CY2027_MARKETING_START_UTC in src/lib/tpmoConfig.ts —
 * scripts/check-cy2027-parity.mjs fails the build if the two ever diverge.
 */
export const CY2027_MARKETING_START_UTC = Date.UTC(2026, 9, 1, 4, 0, 0);

/** Plan year whose marketing rules are in force at `now`. */
export function activePlanYear(now = new Date()) {
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return t >= CY2027_MARKETING_START_UTC ? 2027 : 2026;
}

/**
 * Retention model (spec §19), expressed in years and assigned by record class
 * in ./retention.js. Encoded per plan year because retention obligations are a
 * property of the year's rules, not of today's calendar.
 */
const CY2027_RETENTION = Object.freeze({
  marketingSalesCallMinYears: 6,
  audioRequiredFirstYears: 3,
  audioOrCompleteTranscriptYears: [4, 6],
  note:
    'Enrollment records may carry different or longer obligations; retention is assigned by record class using the longest applicable period (spec §19).',
});

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
});

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
});

const RULESETS = Object.freeze({ 2026: CMS_RULESET_2026, 2027: CMS_RULESET_2027 });

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
 *   REGULATORY_KILL_ENGAGED — operator disabled the marketing workflow.
 *   RULESET_MISSING         — no ruleset for that year.
 *   RULESET_NOT_ACTIVE      — exists but not PRODUCTION_ACTIVE.
 */
export function resolveRuleset(planYear, now = new Date(), env = process.env) {
  if (regulatoryKillEngaged(env)) {
    return { ok: false, reason: 'REGULATORY_KILL_ENGAGED', humanReview: true };
  }
  const year = planYear == null ? activePlanYear(now) : Number(planYear);
  const rs = RULESETS[year];
  if (!rs) return { ok: false, reason: 'RULESET_MISSING', planYear: year, humanReview: true };
  if (rs.status !== 'PRODUCTION_ACTIVE') {
    return { ok: false, reason: 'RULESET_NOT_ACTIVE', planYear: year, status: rs.status, humanReview: true };
  }
  return { ok: true, ruleset: rs };
}

/**
 * Historical lookup — returns a ruleset regardless of status, for explaining a
 * past SOA. Never use this to authorize a live workflow; use resolveRuleset().
 */
export function rulesetForAudit(planYear) {
  return RULESETS[Number(planYear)] || null;
}

/** Every known ruleset version, newest first. For the final report/inventory. */
export function rulesetInventory() {
  return Object.values(RULESETS)
    .slice()
    .sort((a, b) => b.planYear - a.planYear)
    .map((r) => ({ planYear: r.planYear, version: r.version, status: r.status, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
}

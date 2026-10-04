// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — STATE-FIRST JURISDICTION ENGINE (spec §5).
//
// "Before initiating an SOA workflow, obtain and confirm current state of
//  residence. Do not infer residence from area code."
// "Load STATE_RULESET_VERSION based on residence state and effective date. A
//  ruleset that is missing, expired or pending validation causes FAIL-CLOSED
//  and human review."
//
// Production states are New York, New Jersey and Connecticut. Any other state
// must NOT start a state-specific Medicare sales workflow; the caller gets the
// general service/escalation path instead (spec §5).
//
// NOTHING IN THIS FILE NAMES A CARRIER. Carrier availability is private
// licensed-agent workspace logic only (spec §16) — see ./carrier-overlay.js.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ruleset lifecycle (spec §22). A ruleset may only be used in production at
 * PRODUCTION_ACTIVE. Anything else fails closed. There is deliberately no
 * code path that promotes a ruleset automatically: "No AI self-promotion of a
 * new ruleset."
 */
export { RULESET_LIFECYCLE } from './ruleset-lifecycle.js';
import { rulesetActivationProblem, sourceReviewProblem } from './ruleset-lifecycle.js';
import { activePlanYear, marketingStartUtc, resolveRuleset } from './rulesets.js';

// No human promotion was recorded for the three state rulesets either. The
// fields are null because that is the truth; ruleset-lifecycle.js lists them as
// grandfathered and reports the owner's attestation as pending.
const NO_PROMOTION_ON_RECORD = Object.freeze({ promotedBy: null, promotedAt: null, evidenceReference: null });

// Nor was any lifecycle step. A state ruleset added from now on carries here the
// frozen records recordRulesetTransition() returns and may not be used without
// all of them.
const NO_TRANSITIONS_ON_RECORD = Object.freeze([]);

/**
 * AUDIT 2026-10-04 (red team) — the state rulesets carried no source record at
 * all, so "a required rule source expires" (spec §22) had nothing to evaluate
 * for them and evaluateStateRuleset() never asked. Each now names the one thing
 * this file itself says a person must review — the recording-consent position,
 * which is OWNER_COUNSEL territory — with every date null, because nobody is on
 * record as having reviewed it. No statute address is given: none was supplied
 * by the owner, and one is not invented here.
 */
const positionOfRecord = (stateName) => Object.freeze([
  Object.freeze({
    name: `Recording-consent position of record for ${stateName} (owner / counsel)`,
    url: null,
    verifiedOn: null,
    verifiedBy: null,
    reviewBy: null,
  }),
]);

/**
 * Per-state rulesets. The version strings are taken verbatim from the
 * owner-approved Master SOA templates — they are printed on the evidence copy,
 * so they are data, not cosmetics.
 *
 * recordingNotice reflects THIS PROJECT'S existing documented compliance
 * position (see docs/voice/VOICE-AGENT-SPEC-2026-08-28.md), not a fresh legal
 * determination made here. It is carried as a per-state flag so the consent
 * engine can branch on it; `complianceReview` marks that the position itself
 * is owner/counsel territory, not something this code decides.
 */
export const STATE_RULESETS = Object.freeze({
  NY: Object.freeze({
    code: 'NY',
    name: 'New York',
    nameEs: 'Nueva York',
    supported: true,
    planYear: 2027,
    stateRulesetVersion: 'NY-CY2027-v1.0',
    soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    status: 'PRODUCTION_ACTIVE',
    promotion: NO_PROMOTION_ON_RECORD,
    transitions: NO_TRANSITIONS_ON_RECORD,
    sourceReviews: positionOfRecord('New York'),
    recordingNotice: Object.freeze({
      allPartyConsent: false,
      basis: 'Project compliance position of record (one-party). Not re-determined here.',
      complianceReview: 'OWNER_COUNSEL',
    }),
  }),
  NJ: Object.freeze({
    code: 'NJ',
    name: 'New Jersey',
    nameEs: 'Nueva Jersey',
    supported: true,
    planYear: 2027,
    stateRulesetVersion: 'NJ-CY2027-v1.0',
    soaFormVersion: 'CP-SOA-NJ-CY2027-v1.0',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    status: 'PRODUCTION_ACTIVE',
    promotion: NO_PROMOTION_ON_RECORD,
    transitions: NO_TRANSITIONS_ON_RECORD,
    sourceReviews: positionOfRecord('New Jersey'),
    recordingNotice: Object.freeze({
      allPartyConsent: false,
      basis: 'Project compliance position of record (one-party). Not re-determined here.',
      complianceReview: 'OWNER_COUNSEL',
    }),
  }),
  CT: Object.freeze({
    code: 'CT',
    name: 'Connecticut',
    nameEs: 'Connecticut',
    supported: true,
    planYear: 2027,
    stateRulesetVersion: 'CT-CY2027-v1.0',
    soaFormVersion: 'CP-SOA-CT-CY2027-v1.0',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    status: 'PRODUCTION_ACTIVE',
    promotion: NO_PROMOTION_ON_RECORD,
    transitions: NO_TRANSITIONS_ON_RECORD,
    sourceReviews: positionOfRecord('Connecticut'),
    recordingNotice: Object.freeze({
      allPartyConsent: true,
      basis:
        'Project compliance position of record: Conn. Gen. Stat. §52-570d (all-party). Not re-determined here.',
      complianceReview: 'OWNER_COUNSEL',
    }),
  }),
});

/** The only states with a production SOA workflow. */
export const SUPPORTED_STATES = Object.freeze(Object.keys(STATE_RULESETS));

/** Two-letter codes for every US state/territory we may be told, for validation. */
const US_STATE_CODE_RE = /^[A-Z]{2}$/;

/**
 * Resolve the state ruleset for a residence state and plan year.
 *
 * FAIL-CLOSED by design (spec §5, §26). Every non-OK outcome names a reason the
 * caller must surface and must NOT be collapsed into a generic failure:
 *   NO_STATE            — state was never captured/confirmed. Do not guess.
 *   INVALID_STATE       — not a two-letter US state code.
 *   STATE_NOT_SUPPORTED — valid state, outside NY/NJ/CT. General service path.
 *   RULESET_MISSING     — supported state with no ruleset for that plan year.
 *   RULESET_NOT_ACTIVE  — exists but not PRODUCTION_ACTIVE.
 *   RULESET_EXPIRED     — past effectiveTo, or marketing for the next plan year has opened.
 *   RULESET_NOT_YET_EFFECTIVE — before effectiveFrom, or before marketing for its plan year opens.
 *   CLOCK_UNREADABLE    — `now` is not an instant.
 *   RULESET_PROMOTION_NOT_RECORDED — "active" with no lifecycle on record.
 *   RULE_SOURCES_MISSING / RULE_SOURCE_REVIEW_OVERDUE / RULE_SOURCE_NOT_VERIFIED
 *                       — a required source expired or cannot be validated.
 *
 * `registry` is for the suite: the three registered rulesets all pass today. It
 * decides only which object is looked up; it cannot make one grandfathered.
 */
export function resolveStateRuleset(state, planYear, now = new Date(), registry = STATE_RULESETS) {
  if (!state || typeof state !== 'string') {
    return { ok: false, reason: 'NO_STATE', humanReview: true };
  }
  const code = state.trim().toUpperCase();
  if (!US_STATE_CODE_RE.test(code)) {
    return { ok: false, reason: 'INVALID_STATE', humanReview: true };
  }
  const rs = Object.prototype.hasOwnProperty.call(registry, code) ? registry[code] : null;
  if (!rs) {
    return { ok: false, reason: 'STATE_NOT_SUPPORTED', state: code, humanReview: false };
  }
  // AUDIT 2026-10-04 (SPEC-22) — an omitted plan year used to SKIP the year
  // check, and the state rulesets never expire, so a caller that passed nothing
  // would have been handed the 2027 ruleset in 2028 and beyond. An omitted year
  // now means "the year in force at `now`", and a year with no state ruleset is
  // a refusal.
  let year = planYear;
  if (planYear == null) {
    year = activePlanYear(now);
    if (!Number.isInteger(year)) return { ok: false, reason: 'CLOCK_UNREADABLE', state: code, humanReview: true };
  }
  return evaluateStateRuleset(rs, year, now);
}

/** Is `rs` THE registered object for its state (not a look-alike)? */
export function isRegisteredStateRuleset(rs, registry = STATE_RULESETS) {
  if (!rs || typeof rs !== 'object' || typeof rs.code !== 'string') return false;
  return Object.prototype.hasOwnProperty.call(registry, rs.code) && registry[rs.code] === rs;
}

/**
 * Judge one state ruleset for one plan year at `now`. Split from the lookup so
 * the rule can be exercised with rulesets that are not registered — the three
 * registered ones all pass today, and a rule only ever shown passing inputs has
 * not been tested.
 *
 * AUDIT 2026-10-04 (red team) — with an explicit year this never asked whether
 * that year was the one in force: `effectiveTo` is null on all three, so
 * NY-CY2027 resolved for 2027 in 2029. It never looked at sources, and a
 * made-up object carrying a grandfathered version string passed. The window is
 * now derived from the plan year as well, the source rule is the CMS one, and
 * only the object THIS module registers can be grandfathered — no argument can
 * make another one so.
 */
export function evaluateStateRuleset(rs, year, now = new Date()) {
  if (!rs || typeof rs !== 'object') return { ok: false, reason: 'STATE_NOT_SUPPORTED', humanReview: false };
  const code = rs.code;
  if (!Number.isInteger(rs.planYear) || rs.planYear !== year) {
    return { ok: false, reason: 'RULESET_MISSING', state: code, planYear: year, humanReview: true };
  }
  // RED TEAM 2026-10-02 (JR-04, MEDIUM) — an unparseable `now` produced NaN, and
  // every NaN comparison is false, so an EXPIRED or NOT_YET_EFFECTIVE ruleset
  // resolved ok:true. A clock we cannot read is not a clock.
  const t = now instanceof Date ? now.getTime() : typeof now === 'string' || typeof now === 'number' ? new Date(now).getTime() : NaN;
  if (!Number.isFinite(t)) return { ok: false, reason: 'CLOCK_UNREADABLE', state: code, humanReview: true };
  const standing = { registered: isRegisteredStateRuleset(rs, STATE_RULESETS), now };
  const activation = rulesetActivationProblem(rs, standing);
  if (activation) {
    return { ok: false, reason: activation, state: code, status: rs.status, humanReview: true };
  }
  // A stated date that cannot be read is not "no limit".
  const from = rs.effectiveFrom ? Date.parse(rs.effectiveFrom + 'T00:00:00Z') : -Infinity;
  const to = rs.effectiveTo ? Date.parse(rs.effectiveTo + 'T23:59:59Z') : Infinity;
  if (Number.isNaN(from) || t < from || t < marketingStartUtc(rs.planYear)) {
    return { ok: false, reason: 'RULESET_NOT_YET_EFFECTIVE', state: code, humanReview: true };
  }
  if (Number.isNaN(to) || t > to || t >= marketingStartUtc(rs.planYear + 1)) {
    return { ok: false, reason: 'RULESET_EXPIRED', state: code, humanReview: true };
  }
  const sources = sourceReviewProblem(rs, standing);
  if (sources) return { ok: false, reason: sources, state: code, humanReview: true };
  return { ok: true, ruleset: rs };
}

/**
 * The two rulesets a signature is taken under, resolved together and from the
 * clock alone: the CMS ruleset for the plan year in force at `now`, then the
 * state ruleset for THAT year. The year is never an argument.
 *
 * AUDIT 2026-10-04 (red team) — this was two statements in api/sign-soa.js that
 * the suite could only grep. A line added underneath —
 * `if (!rulesetRes.ok) rulesetRes = resolveRuleset(2027)` — fell back to last
 * year's rules and every assertion stayed green. The decision is a function now,
 * so it is tested by calling it on both sides of a rollover.
 *
 *   { ok: true, ruleset, stateRuleset }
 *   { ok: false, stage: 'CMS_RULESET' | 'STATE_RULESET', reason }
 */
export function resolveSigningRulesets(residenceState, now = new Date(), env) {
  const cms = env === undefined ? resolveRuleset(null, now) : resolveRuleset(null, now, env);
  if (!cms.ok) return { ok: false, stage: 'CMS_RULESET', reason: cms.reason };
  const state = resolveStateRuleset(residenceState, cms.ruleset.planYear, now);
  if (!state.ok) return { ok: false, stage: 'STATE_RULESET', reason: state.reason };
  return { ok: true, ruleset: cms.ruleset, stateRuleset: state.ruleset };
}

/**
 * What the SOA form may present for a chosen residence state at `now`.
 * `ruleset` is non-null ONLY when the state ruleset for the plan year in force
 * resolved; there is no fallback to the registry (the red team's mutant was
 * exactly that: "resolution failed, so use STATE_RULESETS[state] anyway").
 * 'OTHER' is the form's own value for "not NY, NJ or CT".
 */
export function soaFormRules(residenceState, now = new Date()) {
  const planYear = activePlanYear(now);
  const unsupported = residenceState === 'OTHER';
  const resolution = residenceState && !unsupported ? resolveStateRuleset(residenceState, null, now) : null;
  const ok = !!resolution && resolution.ok === true;
  return {
    planYear,
    unsupported,
    ruleset: ok ? resolution.ruleset : null,
    rulesUnavailable: !!resolution && !ok,
    reason: resolution && !ok ? resolution.reason : null,
  };
}

// ── ZIP ↔ state consistency ──────────────────────────────────────────────────
// Spec §12 lists "impossible state/ZIP combinations" as a signal FOR REVIEW.
// It is a review signal only: spec §12 also forbids rejecting someone merely
// for struggling with questions. Nothing here may reject a beneficiary, and a
// mismatch never blocks service — it raises a flag a human resolves.
//
// Ranges are the well-known public prefix blocks. Two documented oddities are
// encoded because they would otherwise generate false flags for real people:
// Holtsville NY (00501/00544) and Fishers Island NY (06390), which sits inside
// the Connecticut 063xx block.
const ZIP_BLOCKS = Object.freeze({
  NY: Object.freeze([[501, 501], [544, 544], [6390, 6390], [10001, 14975]]),
  NJ: Object.freeze([[7001, 8989]]),
  CT: Object.freeze([[6001, 6389], [6391, 6928]]),
});

/**
 * @returns {'CONSISTENT'|'FLAG_FOR_REVIEW'|'UNKNOWN'} never a rejection.
 */
export function zipStateConsistency(zip, state) {
  if (!/^\d{5}$/.test(String(zip || ''))) return 'UNKNOWN';
  const code = String(state || '').trim().toUpperCase();
  const blocks = ZIP_BLOCKS[code];
  if (!blocks) return 'UNKNOWN';
  const n = parseInt(zip, 10);
  return blocks.some(([lo, hi]) => n >= lo && n <= hi) ? 'CONSISTENT' : 'FLAG_FOR_REVIEW';
}

// ── County resolution ────────────────────────────────────────────────────────
// Spec §5: "Capture ZIP code; resolve county/service area internally when
// needed. If ZIP maps to multiple counties, ask the beneficiary to
// select/confirm county without suggesting a carrier."
//
// This project has no licensed ZIP→county dataset on hand, and inventing one
// would be exactly the kind of fabricated data the master prompt forbids.
// The engine therefore ships with NO dataset and always returns
// ASK_BENEFICIARY, which is the fail-safe branch the spec already requires for
// ambiguous ZIPs. Installing a real dataset later is a data change, not a code
// change: call setCountyDataset() at startup.
let countyDataset = null;

/**
 * Install a ZIP→counties map, e.g. { '11717': ['Suffolk'], '06320': ['New London'] }.
 * Pass null to clear. Kept explicit so the absence of data is visible in logs.
 */
export function setCountyDataset(dataset) {
  countyDataset = dataset && typeof dataset === 'object' ? dataset : null;
}

/** True when a dataset has been installed. Surfaced in health checks. */
export function hasCountyDataset() {
  return countyDataset !== null;
}

/**
 * Build a dataset from a two-column CSV so installing real data is a file drop,
 * not a code change: `zip,county` with an optional header, one row per
 * zip↔county pair. A ZIP that appears more than once becomes ambiguous and the
 * form asks the beneficiary, which is the §5 behaviour for a multi-county ZIP.
 *
 * Returns the map; pass it to setCountyDataset(). Malformed rows are SKIPPED
 * and counted rather than guessed at — a dataset that silently invents a county
 * is worse than no dataset.
 */
export function parseCountyCsv(text) {
  const out = {};
  let skipped = 0;
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    if (/^zip\b/i.test(raw)) continue; // header
    const cols = raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const zip = (cols[0] || '').replace(/\D/g, '');
    const county = (cols[1] || '').trim();
    if (zip.length !== 5 || !county) { skipped++; continue; }
    if (!out[zip]) out[zip] = [];
    if (!out[zip].includes(county)) out[zip].push(county);
  }
  return { dataset: out, zips: Object.keys(out).length, skipped };
}

/**
 * Resolve county for a ZIP.
 *   { status: 'RESOLVED', county }        — exactly one county, dataset-backed
 *   { status: 'ASK_BENEFICIARY', options } — ambiguous, or no dataset installed
 * Never guesses, never returns a county the dataset did not contain.
 */
export function resolveCounty(zip, state) {
  const z = String(zip || '');
  if (!/^\d{5}$/.test(z)) return { status: 'ASK_BENEFICIARY', options: [], reason: 'INVALID_ZIP' };
  if (!countyDataset) return { status: 'ASK_BENEFICIARY', options: [], reason: 'NO_DATASET' };
  // RED TEAM 2026-10-02 (JR-09, LOW) — `hit.filter(Boolean)` silently collapsed
  // an ambiguous ZIP to a single RESOLVED county whenever a sibling entry was
  // falsy, which is exactly the "system guessed the county" outcome §5 forbids.
  // A malformed entry now forces the question rather than shrinking the choice.
  const hit = Object.prototype.hasOwnProperty.call(countyDataset, z) ? countyDataset[z] : undefined;
  const raw = Array.isArray(hit) ? hit : hit === undefined || hit === null ? [] : [hit];
  const options = raw.filter((c) => typeof c === 'string' && c.trim());
  if (raw.length !== options.length) {
    return { status: 'ASK_BENEFICIARY', options, reason: 'DATASET_ENTRY_MALFORMED' };
  }
  if (options.length === 1) return { status: 'RESOLVED', county: options[0].trim(), state: state || null };
  return { status: 'ASK_BENEFICIARY', options, reason: options.length ? 'AMBIGUOUS' : 'NOT_IN_DATASET' };
}

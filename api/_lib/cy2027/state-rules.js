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
export const RULESET_LIFECYCLE = Object.freeze([
  'PENDING_REVIEW',
  'VERIFIED',
  'STAGING_TESTED',
  'PRODUCTION_ACTIVE',
  'SUPERSEDED',
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
 *   RULESET_EXPIRED     — past effectiveTo.
 *   RULESET_NOT_YET_EFFECTIVE — before effectiveFrom.
 */
export function resolveStateRuleset(state, planYear, now = new Date()) {
  if (!state || typeof state !== 'string') {
    return { ok: false, reason: 'NO_STATE', humanReview: true };
  }
  const code = state.trim().toUpperCase();
  if (!US_STATE_CODE_RE.test(code)) {
    return { ok: false, reason: 'INVALID_STATE', humanReview: true };
  }
  const rs = STATE_RULESETS[code];
  if (!rs) {
    return { ok: false, reason: 'STATE_NOT_SUPPORTED', state: code, humanReview: false };
  }
  if (planYear != null && rs.planYear !== planYear) {
    return { ok: false, reason: 'RULESET_MISSING', state: code, planYear, humanReview: true };
  }
  if (rs.status !== 'PRODUCTION_ACTIVE') {
    return { ok: false, reason: 'RULESET_NOT_ACTIVE', state: code, status: rs.status, humanReview: true };
  }
  // RED TEAM 2026-10-02 (JR-04, MEDIUM) — an unparseable `now` produced NaN, and
  // every NaN comparison is false, so an EXPIRED or NOT_YET_EFFECTIVE ruleset
  // resolved ok:true. A clock we cannot read is not a clock.
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(t)) return { ok: false, reason: 'CLOCK_UNREADABLE', state: code, humanReview: true };
  if (rs.effectiveFrom && t < Date.parse(rs.effectiveFrom + 'T00:00:00Z')) {
    return { ok: false, reason: 'RULESET_NOT_YET_EFFECTIVE', state: code, humanReview: true };
  }
  if (rs.effectiveTo && t > Date.parse(rs.effectiveTo + 'T23:59:59Z')) {
    return { ok: false, reason: 'RULESET_EXPIRED', state: code, humanReview: true };
  }
  return { ok: true, ruleset: rs };
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

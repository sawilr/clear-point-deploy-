// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — CARRIER OVERLAY REGISTRY (spec §16, §17). PRIVATE LAYER ONLY.
//
// "Public website, Emely, Sofía and the Master SOA do not name carriers or
//  decide which carrier should be considered. Only after the licensed agent
//  begins the compliant review may the agent workspace determine carriers/
//  products actually available."
//
// "If a carrier contract/guide requires its own SOA method, script, tool,
//  signature or retention behavior, execute that overlay before discussing/
//  submitting that carrier. The Clear Point Master SOA never claims to
//  supersede carrier contractual requirements."
//
// ─── WHY EVERY ENTRY IS PENDING ──────────────────────────────────────────────
// Spec §17 lists only PUBLICLY verifiable points and, in its own
// "Implementation status" column, says each one still needs private/contract/
// current-year verification. None has been verified by this system. Marking
// anything VERIFIED_CURRENT here would be fabricated compliance evidence, which
// the master prompt forbids outright. They therefore all ship PENDING, and
// canDiscussCarrier() consequently refuses every carrier until a human marks
// one verified. That is the intended fail-closed state, not an oversight.
//
// "Never copy an old carrier form's 48-hour wording into CY2027."
// ─────────────────────────────────────────────────────────────────────────────

export const OVERLAY_STATUS = Object.freeze({
  VERIFIED_CURRENT: 'VERIFIED_CURRENT',
  VERIFIED_WITH_SPECIAL_REQUIREMENT: 'VERIFIED_WITH_SPECIAL_REQUIREMENT',
  PENDING_PRIVATE_VERIFICATION: 'PENDING_PRIVATE_VERIFICATION',
  PENDING_CURRENT_YEAR_VERIFICATION: 'PENDING_CURRENT_YEAR_VERIFICATION',
  SUPERSEDED: 'SUPERSEDED',
  DISABLED: 'DISABLED',
});

/** Statuses that permit carrier-specific work. Deliberately only two. */
const PERMITTING = Object.freeze([OVERLAY_STATUS.VERIFIED_CURRENT, OVERLAY_STATUS.VERIFIED_WITH_SPECIAL_REQUIREMENT]);

// AUDIT 2026-10-04 (SPEC-31 / SPEC-35) — the per-carrier `states` lists were
// written by an earlier engineer. Spec §17/§37 names a state for exactly two
// rows (Clover Health: NJ; ConnectiCare: CT); every other list is a working
// assumption, and overlayInventory() was serving it as if it were a verified
// fact. Each row now says where its state list comes from (`statesStatus`),
// carries the public source URL spec §36 gives for the carrier (`null` where it
// gives none) so the final report's "evidence source" column is data, and the
// gate refuses a carrier whose state coverage is unverified BY NAME
// (STATES_UNVERIFIED) even once its status is verified — through one decision
// function that canDiscussCarrier() and the suite both call. Object.freeze is
// shallow: the state lists are frozen too.
export const STATES_STATUS = Object.freeze({
  /** spec §17 / §37 names this state for the carrier */
  STATED_BY_SPEC: 'STATED_BY_SPEC',
  /** a named person verified the current-year market list (nothing sets this yet) */
  VERIFIED: 'VERIFIED',
  /** an engineer's working assumption — part of the pending verification */
  UNVERIFIED: 'UNVERIFIED',
});

/** State-list statuses that permit state-specific work. Deliberately only two. */
const PERMITTING_STATES = Object.freeze([STATES_STATUS.STATED_BY_SPEC, STATES_STATUS.VERIFIED]);

/** The open question every UNVERIFIED state list carries, in one place. */
export const STATES_PENDING_NOTE =
  'The state list is unverified: it is an earlier engineer\'s working assumption, not stated by spec §17. ' +
  'Confirm the CY2027 states the carrier markets in before any state-specific action.';

/**
 * Registry rows. `publicEvidence` is what spec §17 states is publicly
 * verifiable; `openQuestion` is what a human must resolve before the status can
 * move; `evidenceSourceUrl` is the public source spec §36 lists for the carrier.
 * Nothing here is a customer-facing script (spec §17 title).
 */
// RED TEAM 2026-10-02 (EF-01 / PG-02, CRITICAL) — this array used to be an
// `export const`, and api/_lib/cy2027/index.js re-exports with `export *`. The
// entire carrier firewall — assertPrivateContext, getOverlay, canDiscussCarrier
// — was therefore bypassable by importing the data directly, from anywhere,
// including the browser bundle. A guard on the accessors is worthless while the
// thing they guard is a public export. It is now module-private: the only way
// out is through a function that demands the licensed-workspace context.
const CARRIER_OVERLAYS = Object.freeze([
  Object.freeze({
    carrier: 'Aetna', planYear: 2027,
    states: Object.freeze(['NY', 'NJ', 'CT']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION,
    evidenceSourceUrl: 'https://www.aetna.com/content/dam/aetna/pdfs/aetnacom/insurance-producer/document-library/aetna_producer_agreement.pdf',
    publicEvidence: 'Producer agreement requires compliance with recording/monitoring consent, privacy/security and autodialed/prerecorded-call laws.',
    openQuestion: 'Legal/contract review: do not assume the generic voice process satisfies the producer agreement.',
  }),
  Object.freeze({
    carrier: 'UnitedHealthcare', planYear: 2027,
    states: Object.freeze(['NY', 'NJ', 'CT']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: null,
    publicEvidence: 'LEAN supports SOA workflows; public FAQ still contains legacy 48-hour language.',
    openQuestion: 'Must be CY2027-validated. The legacy 48-hour wording must not be copied into CY2027 logic.',
  }),
  Object.freeze({
    carrier: 'Wellcare/Centene', planYear: 2027,
    states: Object.freeze(['NY', 'NJ', 'CT']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: 'https://www.wellcare.com/en/broker-resources/application-and-enrollment',
    publicEvidence: 'Ascend publicly supports Electronic Scope of Appointment and recorded-meeting functions.',
    openQuestion: 'Compatible with an electronic workflow in principle; validate the CY2027 details.',
  }),
  Object.freeze({
    carrier: 'EmblemHealth', planYear: 2027,
    states: Object.freeze(['NY']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: 'https://www.emblemhealth.com/brokers/resources/selling-medicare/broker-medicare-toolkit',
    publicEvidence: 'Broker toolkit publicly provides SOA forms in English/Spanish/Chinese.',
    openQuestion: 'Compare fields/categories against the Clear Point Master SOA; validate the CY2027 version.',
  }),
  Object.freeze({
    carrier: 'Clover Health', planYear: 2027,
    states: Object.freeze(['NJ']), statesStatus: STATES_STATUS.STATED_BY_SPEC,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: 'https://www.cloverhealth.com/brokers/plan-documents-enrollment',
    publicEvidence: 'Broker enrollment resources publicly provide SOA in English/Spanish and CY2027 NJ plan materials.',
    openQuestion: 'NJ overlay. One carrier among several — no privileged treatment, and never named by the public layer.',
  }),
  Object.freeze({
    carrier: 'ConnectiCare', planYear: 2027,
    states: Object.freeze(['CT']), statesStatus: STATES_STATUS.STATED_BY_SPEC,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: 'https://www.connecticare.com/brokers/resources/medicare-broker-toolkit',
    publicEvidence: 'Broker toolkit publicly provides Scope of Appointment forms.',
    openQuestion: 'CT overlay; validate the CY2027 version.',
  }),
  Object.freeze({
    carrier: 'Healthfirst', planYear: 2027,
    states: Object.freeze(['NY']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION,
    evidenceSourceUrl: 'https://healthfirst.org/brokers',
    publicEvidence: 'Public broker portal exists; Medicare business is submitted through appointed FMOs.',
    openQuestion: 'Private portal / FMO requirements must be verified before the overlay can be called complete.',
  }),
  Object.freeze({
    carrier: 'Fidelis', planYear: 2027,
    states: Object.freeze(['NY']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION,
    evidenceSourceUrl: null,
    publicEvidence: 'No sufficiently complete public CY2027 SOA wording was verified for this package.',
    openQuestion: 'Obtain the CY2027 requirements from the carrier/FMO directly.',
  }),
  Object.freeze({
    carrier: 'HealthSpring/HCSC', planYear: 2027,
    states: Object.freeze(['NY', 'NJ', 'CT']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: null,
    publicEvidence: 'Brand/market transition requires current-year state/product verification.',
    openQuestion: 'Confirm which brand/market applies for CY2027 in each state before any carrier-specific action.',
  }),
  Object.freeze({
    carrier: 'Anthem/Empire', planYear: 2027,
    states: Object.freeze(['NY', 'CT']), statesStatus: STATES_STATUS.UNVERIFIED,
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    evidenceSourceUrl: null,
    publicEvidence: 'Current-year market/form requirements must be checked; legacy forms are not reliable.',
    openQuestion: 'Do not rely on legacy forms; verify the CY2027 market and form requirements.',
  }),
]);

/**
 * The public layer must never reach this registry. Call sites that are allowed
 * to are the licensed-agent workspace only. The guard is explicit rather than
 * relying on file placement, because the client bundle can import anything.
 */
export function assertPrivateContext(context) {
  if (context !== 'LICENSED_AGENT_WORKSPACE') {
    throw new Error(
      'carrier-overlay: the registry is private. The public website, the SOA flow and the ' +
        'Voice AI agents must never name, rank or compare a carrier (spec §16).',
    );
  }
  return true;
}

/** Look up one overlay. Private context required. */
export function getOverlay({ carrier, planYear, state, context }) {
  assertPrivateContext(context);
  return (
    CARRIER_OVERLAYS.find(
      (o) =>
        o.carrier.toLowerCase() === String(carrier || '').toLowerCase() &&
        o.planYear === Number(planYear) &&
        (!state || o.states.includes(String(state).toUpperCase())),
    ) || null
  );
}

/**
 * The gate decision for ONE registry row, as a pure function so the suite can
 * call it with rows the registry does not contain (a verified status over an
 * unverified state list, a hand-built row with no `statesStatus`). Refusals are
 * named; an absent or foreign value refuses rather than passes.
 */
export function overlayGateDecision(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { allowed: false, reason: 'OVERLAY_UNKNOWN' };
  if (!PERMITTING.includes(o.status)) {
    return { allowed: false, reason: typeof o.status === 'string' && o.status ? o.status : 'OVERLAY_STATUS_MISSING', carrier: o.carrier, openQuestion: o.openQuestion };
  }
  if (!PERMITTING_STATES.includes(o.statesStatus)) {
    return { allowed: false, reason: 'STATES_UNVERIFIED', carrier: o.carrier, statesStatus: typeof o.statesStatus === 'string' ? o.statesStatus : null, openQuestion: STATES_PENDING_NOTE };
  }
  return {
    allowed: true,
    reason: o.status,
    carrier: o.carrier,
    specialRequirement: o.status === OVERLAY_STATUS.VERIFIED_WITH_SPECIAL_REQUIREMENT ? o.openQuestion : null,
  };
}

/**
 * The carrier gate. Spec §33 lists "Carrier-specific requirement is bypassed
 * because Master SOA exists" as an immediate-fail critical failure, so a valid
 * Master SOA is NOT an input here — only the overlay's own status and the
 * status of its state list are.
 */
export function canDiscussCarrier({ carrier, planYear, state, context }) {
  assertPrivateContext(context);
  const o = getOverlay({ carrier, planYear, state, context });
  if (!o) return { allowed: false, reason: 'OVERLAY_UNKNOWN', carrier, planYear, state };
  return overlayGateDecision(o);
}

/**
 * Registry snapshot for the final report (spec §35: "Carrier Overlay Registry
 * with evidence source, plan year and status"). Private context required.
 */
export function overlayInventory(context) {
  assertPrivateContext(context);
  return CARRIER_OVERLAYS.map((o) => ({
    carrier: o.carrier, planYear: o.planYear, states: o.states, statesStatus: o.statesStatus,
    status: o.status, evidenceSourceUrl: o.evidenceSourceUrl,
  }));
}

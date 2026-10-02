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

/**
 * Registry rows. `publicEvidence` is what spec §17 states is publicly
 * verifiable; `openQuestion` is what a human must resolve before the status can
 * move. Nothing here is a customer-facing script (spec §17 title).
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
    carrier: 'Aetna', planYear: 2027, states: ['NY', 'NJ', 'CT'],
    status: OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION,
    publicEvidence: 'Producer agreement requires compliance with recording/monitoring consent, privacy/security and autodialed/prerecorded-call laws.',
    openQuestion: 'Legal/contract review: do not assume the generic voice process satisfies the producer agreement.',
  }),
  Object.freeze({
    carrier: 'UnitedHealthcare', planYear: 2027, states: ['NY', 'NJ', 'CT'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    publicEvidence: 'LEAN supports SOA workflows; public FAQ still contains legacy 48-hour language.',
    openQuestion: 'Must be CY2027-validated. The legacy 48-hour wording must not be copied into CY2027 logic.',
  }),
  Object.freeze({
    carrier: 'Wellcare/Centene', planYear: 2027, states: ['NY', 'NJ', 'CT'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    publicEvidence: 'Ascend publicly supports Electronic Scope of Appointment and recorded-meeting functions.',
    openQuestion: 'Compatible with an electronic workflow in principle; validate the CY2027 details.',
  }),
  Object.freeze({
    carrier: 'EmblemHealth', planYear: 2027, states: ['NY'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    publicEvidence: 'Broker toolkit publicly provides SOA forms in English/Spanish/Chinese.',
    openQuestion: 'Compare fields/categories against the Clear Point Master SOA; validate the CY2027 version.',
  }),
  Object.freeze({
    carrier: 'Clover Health', planYear: 2027, states: ['NJ'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    publicEvidence: 'Broker enrollment resources publicly provide SOA in English/Spanish and CY2027 NJ plan materials.',
    openQuestion: 'NJ overlay. One carrier among several — no privileged treatment, and never named by the public layer.',
  }),
  Object.freeze({
    carrier: 'ConnectiCare', planYear: 2027, states: ['CT'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    publicEvidence: 'Broker toolkit publicly provides Scope of Appointment forms.',
    openQuestion: 'CT overlay; validate the CY2027 version.',
  }),
  Object.freeze({
    carrier: 'Healthfirst', planYear: 2027, states: ['NY'],
    status: OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION,
    publicEvidence: 'Public broker portal exists; Medicare business is submitted through appointed FMOs.',
    openQuestion: 'Private portal / FMO requirements must be verified before the overlay can be called complete.',
  }),
  Object.freeze({
    carrier: 'Fidelis', planYear: 2027, states: ['NY'],
    status: OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION,
    publicEvidence: 'No sufficiently complete public CY2027 SOA wording was verified for this package.',
    openQuestion: 'Obtain the CY2027 requirements from the carrier/FMO directly.',
  }),
  Object.freeze({
    carrier: 'HealthSpring/HCSC', planYear: 2027, states: ['NY', 'NJ', 'CT'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
    publicEvidence: 'Brand/market transition requires current-year state/product verification.',
    openQuestion: 'Confirm which brand/market applies for CY2027 in each state before any carrier-specific action.',
  }),
  Object.freeze({
    carrier: 'Anthem/Empire', planYear: 2027, states: ['NY', 'CT'],
    status: OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION,
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
 * The carrier gate. Spec §33 lists "Carrier-specific requirement is bypassed
 * because Master SOA exists" as an immediate-fail critical failure, so a valid
 * Master SOA is NOT an input here — only the overlay's own status is.
 */
export function canDiscussCarrier({ carrier, planYear, state, context }) {
  assertPrivateContext(context);
  const o = getOverlay({ carrier, planYear, state, context });
  if (!o) return { allowed: false, reason: 'OVERLAY_UNKNOWN', carrier, planYear, state };
  if (!PERMITTING.includes(o.status)) {
    return { allowed: false, reason: o.status, carrier: o.carrier, openQuestion: o.openQuestion };
  }
  return {
    allowed: true,
    reason: o.status,
    carrier: o.carrier,
    specialRequirement: o.status === OVERLAY_STATUS.VERIFIED_WITH_SPECIAL_REQUIREMENT ? o.openQuestion : null,
  };
}

/** Registry snapshot for the final report. Private context required. */
export function overlayInventory(context) {
  assertPrivateContext(context);
  return CARRIER_OVERLAYS.map((o) => ({ carrier: o.carrier, planYear: o.planYear, states: o.states, status: o.status }));
}

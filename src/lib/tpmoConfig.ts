// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-08-12 — TPMO disclaimer controlled configuration.
//
// 42 CFR §422.2267(e)(41) (and Part D mirror §423.2267(e)(41)) requires the
// TPMO disclaimer to state ACTUAL figures for a multi-carrier TPMO:
//   "Currently we represent [X] organizations which offer [Y] products in
//    your area."
// The counts MUST come from the FMO/carrier appointment records — never
// guessed, never hardcoded ad hoc. Until verified counts are approved here,
// the site renders the count-less variant and this config reports BLOCKED.
//
// CY2027 note (91 FR 17384, applicable to CY2027 marketing from Oct 1, 2026):
// the SHIP reference is REMOVED from the disclaimer text and the verbal
// timing changes to "prior to the discussion of any benefits". When updating
// for CY2027, flip `contractYearVariant` to 'CY2027' — the render layer picks
// the wording; the counts requirement itself is unchanged.
//
// HOW TO ACTIVATE (owner/compliance only):
//   1. Obtain the confirmed number of contracted organizations and products
//      for the service area from the FMO / appointment records.
//   2. Fill organizationCount / productCount / verificationSource / approvedBy
//      / approvedOn, set status: 'VERIFIED', set nextReviewDate.
//   3. Rebuild. DisclaimerBlock automatically switches to the counts variant.
//   4. Keep the SOA gates in sync (soaContent.ts consumes the same numbers).
// ─────────────────────────────────────────────────────────────────────────────

export type TpmoConfigStatus = 'VERIFIED' | 'BLOCKED_COUNTS_REQUIRED';

export interface TpmoDisclaimerConfig {
  /** States the counts apply to. One config per service area if they differ. */
  serviceArea: ReadonlyArray<'NY' | 'NJ' | 'CT'>;
  /** Contract-year wording variant currently in force for marketing. */
  contractYearVariant: 'CY2026' | 'CY2027';
  /** Number of contracted organizations — null until verified. NEVER guess. */
  organizationCount: number | null;
  /** Number of products/plans offered in the area — null until verified. */
  productCount: number | null;
  /** Where the counts were verified (e.g. "FMO appointment report 2026-08"). */
  verificationSource: string | null;
  /** Person who approved the counts. */
  approvedBy: string | null;
  /** ISO date the counts were approved. */
  approvedOn: string | null;
  /** ISO date the counts must be re-reviewed (AEP changes, new carriers). */
  nextReviewDate: string | null;
  status: TpmoConfigStatus;
}

// AUDIT 2026-09-12 (CMS-03) — the CY2027 wording (91 FR 17384: SHIP reference
// removed from (e)(41)) applies to CY2027 marketing, which may begin
// 2026-10-01. Resolve the variant from the calendar at render time so the switch
// cannot be forgotten; the cut-over instant is midnight Eastern (UTC-4 in Oct).
export const CY2027_MARKETING_START_UTC = Date.UTC(2026, 9, 1, 4, 0, 0); // 2026-10-01T00:00 ET

export function activeContractYearVariant(now: Date = new Date()): 'CY2026' | 'CY2027' {
  return now.getTime() >= CY2027_MARKETING_START_UTC ? 'CY2027' : 'CY2026';
}

export const TPMO_DISCLAIMER_CONFIG: TpmoDisclaimerConfig = {
  serviceArea: ['NY', 'NJ', 'CT'],
  contractYearVariant: activeContractYearVariant(),
  organizationCount: null,
  productCount: null,
  verificationSource: null,
  approvedBy: null,
  approvedOn: null,
  nextReviewDate: null,
  status: 'BLOCKED_COUNTS_REQUIRED',
};

/** TRUE only when verified counts exist and are approved. */
export function hasVerifiedTpmoCounts(cfg: TpmoDisclaimerConfig = TPMO_DISCLAIMER_CONFIG): boolean {
  return cfg.status === 'VERIFIED'
    && typeof cfg.organizationCount === 'number' && cfg.organizationCount > 0
    && typeof cfg.productCount === 'number' && cfg.productCount > 0
    && !!cfg.approvedBy && !!cfg.approvedOn && !!cfg.verificationSource;
}

/**
 * The (e)(41) disclaimer sentence, EN/ES, for the active contract-year
 * variant. With verified counts → the full required wording with figures.
 * Without → the count-less fallback currently in production (unchanged
 * behavior; the gap is tracked as BLOCKED, not hidden).
 */
export function tpmoDisclaimerText(lang: 'en' | 'es', cfg: TpmoDisclaimerConfig = TPMO_DISCLAIMER_CONFIG): string {
  // Red-team RT-CLIENT-05: resolve the variant at RENDER time (a long-lived tab
  // that crosses 2026-10-01 must switch too), not from the frozen config value.
  const variant = cfg === TPMO_DISCLAIMER_CONFIG ? activeContractYearVariant() : cfg.contractYearVariant;
  if (hasVerifiedTpmoCounts(cfg)) {
    const x = cfg.organizationCount as number;
    const y = cfg.productCount as number;
    if (variant === 'CY2027') {
      return lang === 'en'
        ? `We do not offer every plan available in your area. Currently we represent ${x} organizations which offer ${y} products in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.`
        : `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${x} organizaciones que ofrecen ${y} productos en su área. Comuníquese con Medicare.gov o llame al 1-800-MEDICARE para obtener información sobre todas sus opciones.`;
    }
    return lang === 'en'
      ? `We do not offer every plan available in your area. Currently we represent ${x} organizations which offer ${y} products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Assistance Program to get information on all of your options.`
      : `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${x} organizaciones que ofrecen ${y} productos en su área. Comuníquese con Medicare.gov, llame al 1-800-MEDICARE o contacte su Programa Estatal de Asistencia de Seguro de Salud (SHIP) local para obtener información sobre todas sus opciones.`;
  }
  // Fallback — counts not yet verified (status BLOCKED_COUNTS_REQUIRED).
  // AUDIT 2026-09-12 (CMS-01, P1, OWNER-GATED): (e)(41) is STANDARDIZED content —
  // the only compliant multi-carrier text carries the organization/product counts.
  // Until the owner/FMO supplies them, render the standardized sentences verbatim
  // MINUS the counts sentence (the previous fallback added an invented sentence,
  // "Any information we provide is limited to…", that appears in no version of
  // the rule). This remains a documented gap, not a cure.
  return lang === 'en'
    ? 'We do not offer every plan available in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.'
    : 'No ofrecemos todos los planes disponibles en su área. Comuníquese con Medicare.gov o llame al 1-800-MEDICARE para obtener información sobre todas sus opciones.';
}

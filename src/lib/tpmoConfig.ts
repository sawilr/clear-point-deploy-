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

export const TPMO_DISCLAIMER_CONFIG: TpmoDisclaimerConfig = {
  serviceArea: ['NY', 'NJ', 'CT'],
  contractYearVariant: 'CY2026',
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
  if (hasVerifiedTpmoCounts(cfg)) {
    const x = cfg.organizationCount as number;
    const y = cfg.productCount as number;
    if (cfg.contractYearVariant === 'CY2027') {
      return lang === 'en'
        ? `We do not offer every plan available in your area. Currently we represent ${x} organizations which offer ${y} products in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.`
        : `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${x} organizaciones que ofrecen ${y} productos en su área. Comuníquese con Medicare.gov o llame al 1-800-MEDICARE para obtener información sobre todas sus opciones.`;
    }
    return lang === 'en'
      ? `We do not offer every plan available in your area. Currently we represent ${x} organizations which offer ${y} products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Assistance Program to get information on all of your options.`
      : `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${x} organizaciones que ofrecen ${y} productos en su área. Comuníquese con Medicare.gov, llame al 1-800-MEDICARE o contacte su Programa Estatal de Asistencia de Seguro de Salud (SHIP) local para obtener información sobre todas sus opciones.`;
  }
  // Fallback — counts not yet verified (status BLOCKED_COUNTS_REQUIRED).
  return lang === 'en'
    ? 'We do not offer every plan available in your area. Any information we provide is limited to the plans we offer in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your plan options.'
    : 'No ofrecemos todos los planes disponibles en su área. Cualquier información que proporcionamos se limita a los planes que ofrecemos en su área. Comuníquese con Medicare.gov o 1-800-MEDICARE para obtener información sobre todas sus opciones de planes.';
}

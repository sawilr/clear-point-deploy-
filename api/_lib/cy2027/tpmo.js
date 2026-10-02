// ─────────────────────────────────────────────────────────────────────────────
// TPMO DISCLAIMER — 42 CFR §422.2267(e)(41) / §423.2267(e)(41). CANONICAL SOURCE.
//
// HISTORY OF THIS FILE'S EXISTENCE
// Until 2026-10-01 this sentence lived in THREE places: src/lib/tpmoConfig.ts
// (variant-aware, count-less fallback), src/lib/soaContent.ts (hardcoded with
// [X]/[Y] placeholders) and api/sign-soa.js (another hardcoded copy with
// placeholders). src/lib/soaContent.ts documented the problem itself —
// "the three sources must be unified first" — and listed it as blocker #1
// against enabling the SOA workflow at all, because a signed PDF reading
// "[X] organizations" is an audit failure.
//
// They could not simply import each other: api/*.js cannot import from src/.
// So the canonical copy moved HERE, into the environment-neutral layer that
// both worlds can reach. src/lib/tpmoConfig.ts now re-exports this module and
// keeps its own public API unchanged; api/sign-soa.js imports it directly.
// scripts/check-cy2027-parity.mjs fails the build if a fourth copy appears.
//
// COUNTS ARE OWNER-SUPPLIED AND MUST NEVER BE GUESSED. The (e)(41) sentence
// for a multi-carrier TPMO states actual figures. Until the owner/FMO supplies
// them from appointment records, status stays BLOCKED_COUNTS_REQUIRED and the
// count-less standardized sentence renders. That is a documented gap, not a cure.
//
// CY2027 wording change: the SHIP reference is removed from (e)(41) for CY2027
// marketing, which may begin 2026-10-01. The variant is resolved from the
// calendar at RENDER time, not frozen at module load, so a long-lived browser
// tab that crosses the boundary switches too (red-team RT-CLIENT-05).
// ─────────────────────────────────────────────────────────────────────────────

import { CY2027_MARKETING_START_UTC } from './rulesets.js';

export { CY2027_MARKETING_START_UTC };

/** Tracks WHICH version of the disclaimer a beneficiary signed (audit trail). */
export const TPMO_DISCLAIMER_VERSION = '2024-10';

/** @returns {'CY2026'|'CY2027'} wording variant in force at `now`. */
export function activeContractYearVariant(now = new Date()) {
  return now.getTime() >= CY2027_MARKETING_START_UTC ? 'CY2027' : 'CY2026';
}

/**
 * Owner-controlled counts configuration.
 * NEVER fill organizationCount / productCount from inference, memory or a
 * carrier website — only from the FMO/carrier appointment records, approved by
 * a named person on a named date.
 */
// RED TEAM 2026-10-02 (EF-07, HIGH) — this was a mutable module singleton, so
// any importer could flip `status` to 'VERIFIED' and set counts at runtime and
// the BLOCKED_COUNTS_REQUIRED fail-closed state would simply evaporate — in a
// module whose entire job is to keep an unverified figure out of a signed
// document. Frozen: the counts are a deliberate source edit with a named
// approver, not something a call site can arrange.
export const TPMO_DISCLAIMER_CONFIG = Object.freeze({
  serviceArea: Object.freeze(['NY', 'NJ', 'CT']),
  contractYearVariant: activeContractYearVariant(),
  organizationCount: null,
  productCount: null,
  verificationSource: null,
  approvedBy: null,
  approvedOn: null,
  nextReviewDate: null,
  status: 'BLOCKED_COUNTS_REQUIRED',
});

/** TRUE only when verified counts exist and are approved. */
export function hasVerifiedTpmoCounts(cfg = TPMO_DISCLAIMER_CONFIG) {
  return (
    cfg.status === 'VERIFIED' &&
    typeof cfg.organizationCount === 'number' && cfg.organizationCount > 0 &&
    typeof cfg.productCount === 'number' && cfg.productCount > 0 &&
    !!cfg.approvedBy && !!cfg.approvedOn && !!cfg.verificationSource
  );
}

/**
 * The (e)(41) sentence, EN/ES, for the active contract-year variant.
 * With verified counts → the full required wording with figures.
 * Without → the standardized sentences MINUS the counts sentence. The earlier
 * fallback invented a sentence ("Any information we provide is limited to…")
 * that appears in no version of the rule; that invention is not reinstated.
 */
export function tpmoDisclaimerText(lang, cfg = TPMO_DISCLAIMER_CONFIG) {
  // RED TEAM 2026-10-02 (EF-08, HIGH) — the render-time variant resolution was
  // reached only by IDENTITY with the singleton, so an owner's own verified
  // config object (the supported way to supply counts) froze its variant at
  // construction and could serve CY2026 wording after the cut-over. Resolve
  // from the calendar unless the config explicitly pins a variant.
  const pinned = cfg && cfg !== TPMO_DISCLAIMER_CONFIG && cfg.pinContractYearVariant === true;
  const variant = pinned ? cfg.contractYearVariant : activeContractYearVariant();

  if (hasVerifiedTpmoCounts(cfg)) {
    const x = cfg.organizationCount;
    const y = cfg.productCount;
    if (variant === 'CY2027') {
      return lang === 'en'
        ? `We do not offer every plan available in your area. Currently we represent ${x} organizations which offer ${y} products in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.`
        : `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${x} organizaciones que ofrecen ${y} productos en su área. Comuníquese con Medicare.gov o llame al 1-800-MEDICARE para obtener información sobre todas sus opciones.`;
    }
    return lang === 'en'
      ? `We do not offer every plan available in your area. Currently we represent ${x} organizations which offer ${y} products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Assistance Program to get information on all of your options.`
      : `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${x} organizaciones que ofrecen ${y} productos en su área. Comuníquese con Medicare.gov, llame al 1-800-MEDICARE o contacte su Programa Estatal de Asistencia de Seguro de Salud (SHIP) local para obtener información sobre todas sus opciones.`;
  }

  if (variant === 'CY2027') {
    return lang === 'en'
      ? 'We do not offer every plan available in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.'
      : 'No ofrecemos todos los planes disponibles en su área. Comuníquese con Medicare.gov o llame al 1-800-MEDICARE para obtener información sobre todas sus opciones.';
  }
  return lang === 'en'
    ? 'We do not offer every plan available in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program to get information on all of your options.'
    : 'No ofrecemos todos los planes disponibles en su área. Comuníquese con Medicare.gov, llame al 1-800-MEDICARE o contacte su Programa Estatal de Asistencia de Seguro de Salud (SHIP) local para obtener información sobre todas sus opciones.';
}

/**
 * Guard for anything that renders a SIGNED artifact (the SOA PDF).
 * A rendered disclaimer containing a bracketed placeholder must never reach a
 * signature. Throws rather than returning false: a signed audit failure is not
 * something a caller should be able to swallow.
 */
export function assertDisclaimerSignable(text) {
  // RED TEAM 2026-10-02 (EF-02, HIGH) — `String(text || '')` turned every
  // non-string into '' and passed, so a null, undefined, number or object
  // reaching the PDF renderer satisfied the guard that exists to stop a
  // placeholder from being signed. A non-string is not a signable disclaimer.
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('tpmo: refusing to render a signable document without a disclaimer string.');
  }
  // Bracketed placeholders in any of the shapes the codebase has used.
  if (/\[\s*[XY]\s*\]|\{\{?\s*[XY]\s*\}?\}|＜[XY]＞|<\s*[XY]\s*>/i.test(text)) {
    throw new Error(
      'tpmo: refusing to render a signable document containing [X]/[Y] placeholders. ' +
        'Supply verified organization/product counts in TPMO_DISCLAIMER_CONFIG first.',
    );
  }
  return true;
}

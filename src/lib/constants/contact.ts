// ─────────────────────────────────────────────────────────────────────────────
// Sawil 2026-06-30 AUDIT FIX (CODE-008 / CODE-009) — single source of truth for
// contact + external-reference constants.
//
// The business phone (1-866-310-8702) is currently hardcoded 87 times across 30
// files, and the federal reference numbers / external URLs are scattered inline.
// Changing the toll-free number is a 30-file edit with a high miss rate. New code
// MUST import from here. The one-time migration of the 87 existing call sites is a
// mechanical follow-up that has to be done carefully so it does NOT alter any
// compliance/consent copy (some numbers are embedded inside TCPA/CMS sentences).
// ─────────────────────────────────────────────────────────────────────────────

/** ClearPoint's own toll-free line — the primary CTA number across the site. */
export const BUSINESS_PHONE_DISPLAY = '1-866-310-8702';
export const BUSINESS_PHONE_TEL = 'tel:+18663108702'; // href value for <a>
export const BUSINESS_PHONE_E164 = '+18663108702';
export const BUSINESS_PHONE_DIGITS = '8663108702';

/** TTY relay (accessibility). */
export const TTY = '711';

/** Agency identifiers (public registry data — safe to display). */
export const NPN = '17261494';

/** Official government / neutral reference numbers (shown in compliance copy). */
export const MEDICARE_PHONE_DISPLAY = '1-800-MEDICARE';
export const MEDICARE_PHONE_NUMERIC = '1-800-633-4227';
export const SSA_PHONE = '1-800-772-1213';
export const SHIP_PHONE = '1-877-839-2675';

/** Canonical site origin (used by SEO / RouteMeta). */
export const CANONICAL_ORIGIN = 'https://clearpointsenioradvisors.com';

/** Official government + neutral resources (footer / Resources page). */
export const EXTERNAL_LINKS = {
  medicare: 'https://www.medicare.gov',
  ssa: 'https://www.ssa.gov',
  cms: 'https://www.cms.gov',
  ship: 'https://www.shiptacenter.org',
} as const;

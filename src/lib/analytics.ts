// ─────────────────────────────────────────────────────────────────────────────
// SAFE, PII/PHI-FREE analytics hooks for ClearPoint (GA4 / GTM ONLY).
//
// COMPLIANCE GUARDRAILS (do not remove):
//  • NO Meta Pixel / Facebook. This is a Medicare site — pixel-based health
//    tracking is an HHS/FTC liability. Only GA4 via GTM is wired here.
//  • NEVER pass PII/PHI to track(): no name, phone, email, ZIP, Medicare /
//    Medicaid status, plan type, medication, chatbot text, or health condition.
//    The sanitizer below HARD-DROPS anything outside the generic whitelist, so
//    even a mistaken call cannot leak PII.
//  • No-ops safely until a GTM container is actually loaded — events accumulate
//    on window.dataLayer with no network call and no data leaving the browser.
//
// HOW TO ACTIVATE (Sawil / dev — NOT done here, no real ID is invented):
//  1. Create a GTM container, get its ID (GTM-XXXXXXX). Inside GTM, add a GA4
//     config tag with your GA4 Measurement ID. Do NOT add a Meta Pixel tag.
//  2. Add the GTM snippet to index.html (see README note) OR set the env var
//     VITE_GTM_ID=GTM-XXXXXXX and load it from there.
//  3. Update vercel.json Content-Security-Policy:
//       script-src  … https://www.googletagmanager.com
//       connect-src … https://www.googletagmanager.com https://*.google-analytics.com
//  4. In GTM, configure GA4 events for: page_view, cta_click, phone_click,
//     form_start, form_submit_success, chat_open, language_toggle,
//     thank_you_view. Map ONLY the generic params below — never PII.
// ─────────────────────────────────────────────────────────────────────────────

export const Events = {
  PAGE_VIEW: 'page_view',
  CTA_CLICK: 'cta_click',
  PHONE_CLICK: 'phone_click',
  FORM_START: 'form_start',
  FORM_SUBMIT_SUCCESS: 'form_submit_success',
  CHAT_OPEN: 'chat_open',
  LANGUAGE_TOGGLE: 'language_toggle',
  THANK_YOU_VIEW: 'thank_you_view',
} as const;

// The ONLY keys allowed to leave the browser. Everything else is dropped.
export interface GenericPayload {
  event_category?: string; // e.g. "lead", "navigation"
  event_label?: string;    // e.g. "homepage_form", "header_phone"
  language?: 'en' | 'es';
  page_path?: string;      // location.pathname only — never a query string with PII
}

/**
 * Push a generic, PII-free event to GTM's dataLayer. Safe to call anywhere.
 * If GTM is not loaded, it just appends to dataLayer (no network, no leak).
 */
export function track(event: string, payload: GenericPayload = {}): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { dataLayer?: Array<Record<string, unknown>> };
  if (!Array.isArray(w.dataLayer)) w.dataLayer = [];
  // Whitelist-only sanitizer: copy ONLY the four generic keys, capped in length.
  const safe: GenericPayload = {};
  if (payload.event_category) safe.event_category = String(payload.event_category).slice(0, 40);
  if (payload.event_label) safe.event_label = String(payload.event_label).slice(0, 60);
  if (payload.language === 'en' || payload.language === 'es') safe.language = payload.language;
  if (payload.page_path) {
    // strip any query/hash so a PII-bearing URL param can never be sent
    safe.page_path = String(payload.page_path).split(/[?#]/)[0].slice(0, 120);
  }
  w.dataLayer.push({ event, ...safe });
  // Re-audit 2026-07-27: GA4 is loaded directly via gtag.js (no GTM container),
  // so a GTM-style dataLayer.push({event}) never reaches GA4. When gtag is
  // present (consent granted), also emit a real GA4 event with the same
  // PII-free params so conversions (form_submit_success, thank_you_view) flow.
  const g = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof g === 'function') g('event', event, safe);
}

// ─── GA4 DIRECT LOADER (Sawil 2026-07-27) ────────────────────────────────────
// Consent-gated: only injects gtag.js when the cookie banner stored "all".
// Reads localStorage directly (not CookieConsent.tsx) to avoid a circular import.
const GA4_ID = 'G-287ZZL7JB6';
let gaLoaded = false;
export function initGA4IfConsented(): void {
  if (gaLoaded || typeof document === 'undefined') return;
  try {
    const raw = localStorage.getItem('cp_cookie_consent');
    if (!raw) return;
    const choice = raw.startsWith('{') ? JSON.parse(raw).choice : raw;
    if (choice !== 'all') return;
  } catch { return; }
  gaLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  document.head.appendChild(s);
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  // gtag.js REQUIRES the classic `arguments` object here — NOT a rest-param
  // array. With push([...]) the library silently ignores the js/config commands
  // and never sends a single hit (confirmed live: 0 beacons vs 204 with arguments).
  // eslint-disable-next-line prefer-rest-params
  function gtag() { w.dataLayer.push(arguments); }
  w.gtag = gtag;
  // Call through `w` (typed any) so the 0-arg signature doesn't trip tsc -b's
  // strict arg-count check while the body still pushes a real `arguments`.
  w.gtag('js', new Date());
  // anonymize_ip: senior/health-adjacent site — never store full IPs.
  // CP-04 (2026-08-13) — cookie_flags added. gtag.js writes the _ga and
  // _ga_<container> cookies itself via document.cookie, so no server Set-Cookie
  // header is involved and no CDN or platform setting can add the attributes for us:
  // this parameter is the ONLY place they can be set. Without it the cookies were
  // written with neither Secure nor an explicit SameSite.
  //
  // Secure is the finding; SameSite=Lax is included because a cookie set with Secure
  // but no SameSite gets the browser's default, and being explicit is what makes the
  // header auditable. Lax rather than None on purpose — None means "send on cross-site
  // requests", which analytics here does not need, and widening it to satisfy a
  // hardening finding would be a net loss.
  //
  // Honest scope: these are first-party analytics identifiers, not authentication
  // cookies, the origin is HTTPS, and the whole loader is consent-gated (it only runs
  // when the banner recorded "all"), so real-world exploitability was low. It is still
  // one parameter to be correct rather than explained away.
  w.gtag('config', GA4_ID, { anonymize_ip: true, cookie_flags: 'SameSite=Lax;Secure' });
}

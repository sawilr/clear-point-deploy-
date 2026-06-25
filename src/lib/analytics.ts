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
}

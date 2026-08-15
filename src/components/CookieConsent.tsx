// ─────────────────────────────────────────────────────────────────────────────
// Sawil 2026-07-27 — Bilingual cookie-consent banner (site previously had NONE).
//
// Behavior:
//   • First visit → fixed banner at the bottom. Choosing "Accept all" or
//     "Essentials only" stores the choice in localStorage ('cp_cookie_consent',
//     JSON { choice, ts }) and the banner never shows again.
//   • Non-blocking: no overlay/backdrop — the page stays fully interactive.
//   • Mobile: sits ABOVE the MobileStickyBar (fixed bottom CTA, ~72px + safe
//     area) so neither covers the other. Desktop: flush at bottom-0 (sticky bar
//     is md:hidden).
//   • z-[45]: above the sticky bar (z-40), BELOW the chat FAB (z-50) and its
//     popover (z-[60]) so the Help launcher always stays clickable.
//   • Bilingual via the same t(en, es) pattern every component uses; the
//     Privacy Policy link goes through useLocalizedPath so it stays inside
//     /es/* while browsing Spanish.
//
// ANALYTICS GATING NOTE (updated 2026-08-15 — the 2026-07-27 note predated the
// GA4 direct loader and had gone stale): GA4 IS wired, consent-gated, in
// src/lib/analytics.ts (initGA4IfConsented). gtag.js loads ONLY when the
// stored choice is 'all' — on 'essential' or no choice, no analytics script,
// no network call, no analytics cookie exists. main.tsx re-checks on every
// boot so a returning visitor's stored choice keeps applying. vercel.json's
// CSP allows exactly the googletagmanager.com / google-analytics.com origins
// this needs. The homegrown chat (Zara/Clara) is functional/essential and is
// not affected by the choice. A visitor can reset their choice from the
// Privacy Policy page (Cookies section) — clearing storage re-shows this
// banner on the next load.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { initGA4IfConsented } from '../lib/analytics';
import { Link } from 'react-router';
import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';

export type CookieConsentChoice = 'all' | 'essential';

const STORAGE_KEY = 'cp_cookie_consent';

/**
 * Read the stored consent choice. Returns null when the visitor has not chosen
 * yet (banner should show) or when localStorage is unavailable (Safari Private
 * Browsing — same pattern as useLanguage.tsx).
 */
export function getCookieConsent(): CookieConsentChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // Tolerate a bare 'all' / 'essential' string in case the value was ever
    // written without the JSON envelope.
    if (raw === 'all' || raw === 'essential') return raw;
    const parsed = JSON.parse(raw) as { choice?: unknown };
    if (parsed.choice === 'all' || parsed.choice === 'essential') return parsed.choice;
    return null;
  } catch {
    return null;
  }
}

function storeCookieConsent(choice: CookieConsentChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, ts: new Date().toISOString() }));
  } catch {
    // Private mode — nothing persists; the banner will simply return next
    // visit. The in-session dismissal still works via component state.
  }
}

export function CookieConsent() {
  const { t } = useLanguage();
  const lp = useLocalizedPath();
  // Lazy initializer: read storage once on mount; already-chosen → never render.
  const [visible, setVisible] = useState<boolean>(() => getCookieConsent() === null);

  // RE-AUDIT 2026-07-27 (P2 — 320px first viewport). While the banner is open,
  // flag <body> so ultra-narrow screens (≤430px) can hide the MobileStickyBar
  // (index.css: body.cp-consent-open .cp-mobile-sticky-bar) — banner + FAB +
  // sticky bar together buried the hero at 320x568. Removed on choice/unmount.
  useEffect(() => {
    if (!visible) return;
    document.body.classList.add('cp-consent-open');
    return () => document.body.classList.remove('cp-consent-open');
  }, [visible]);

  if (!visible) return null;

  const choose = (choice: CookieConsentChoice) => {
    storeCookieConsent(choice);
    setVisible(false);
    // GA4 loads only on explicit "all" — the loader re-checks stored consent.
    if (choice === 'all') initGA4IfConsented();
  };

  return (
    <div
      role="region"
      aria-label={t('Cookie consent', 'Consentimiento de cookies')}
      className="fixed left-0 right-0 z-[45] bottom-[calc(env(safe-area-inset-bottom)+76px)] max-[430px]:bottom-0 max-[430px]:pb-[max(0.625rem,env(safe-area-inset-bottom))] md:bottom-0 bg-earth-900 text-cream-50 border-t border-cream-50/15 shadow-lifted px-4 py-4 max-[430px]:px-3 max-[430px]:py-2.5 sm:px-6"
    >
      {/* pr-28/md:pr-32 reserves clearance for the Help FAB (.cp-zara-fab,
          z-50, anchored bottom-right) so the consent text and buttons are never
          covered by it; ≥1440px the centered max-w-5xl content clears the FAB
          on its own, so the padding drops. ≤430px (compact variant, re-audit
          2026-07-27): banner drops to bottom-0 (the sticky bar is hidden via
          body.cp-consent-open), text shrinks, buttons sit in ONE row, and only
          the text keeps FAB clearance (the FAB floats ~88px up, clear of the
          compact banner's button row). */}
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 max-[430px]:gap-2 sm:gap-6 pr-28 max-[430px]:pr-0 md:pr-32 min-[1440px]:pr-0">
        <p className="flex-1 text-base max-[430px]:text-sm leading-relaxed max-[430px]:pr-16">
          {t(
            'We use cookies for our chat service. See our ',
            'Usamos cookies para el servicio de chat. Vea nuestra '
          )}
          <Link
            to={lp('/privacy-policy')}
            className="underline underline-offset-2 text-gold-400 hover:text-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 rounded-sm"
          >
            {t('Privacy Policy', 'Política de Privacidad')}
          </Link>
          .
        </p>
        <div className="flex flex-col-reverse max-[430px]:flex-row sm:flex-row gap-2 sm:gap-3 sm:flex-shrink-0">
          <button
            type="button"
            onClick={() => choose('essential')}
            className="min-h-[44px] px-5 max-[430px]:px-3 max-[430px]:flex-1 py-2.5 rounded-lg border border-cream-50/30 text-cream-50 text-base max-[430px]:text-sm font-semibold hover:bg-cream-50/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            {t('Essentials only', 'Solo esenciales')}
          </button>
          <button
            type="button"
            onClick={() => choose('all')}
            className="min-h-[44px] px-5 max-[430px]:px-3 max-[430px]:flex-1 py-2.5 rounded-lg bg-gold-400 text-earth-900 text-base max-[430px]:text-sm font-bold hover:bg-gold-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream-50"
          >
            {t('Accept all', 'Aceptar todo')}
          </button>
        </div>
      </div>
    </div>
  );
}

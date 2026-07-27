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
// ANALYTICS GATING NOTE (audit 2026-07-27): Google Analytics is NOT loaded in
// this codebase — src/lib/analytics.ts only pushes to a local window.dataLayer
// (no network, no cookies) until a GTM container is added, and vercel.json's
// CSP does not allow googletagmanager.com. There is therefore nothing to gate
// today. WHEN GTM is activated (see the HOW TO ACTIVATE block in analytics.ts),
// the loader MUST call getCookieConsent() and only inject the GTM script when
// it returns 'all'. The homegrown chat (Zara/Clara) is functional/essential and
// is not affected by the choice.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
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

  if (!visible) return null;

  const choose = (choice: CookieConsentChoice) => {
    storeCookieConsent(choice);
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={t('Cookie consent', 'Consentimiento de cookies')}
      className="fixed left-0 right-0 z-[45] bottom-[calc(env(safe-area-inset-bottom)+76px)] md:bottom-0 bg-earth-900 text-cream-50 border-t border-cream-50/15 shadow-lifted px-4 py-4 sm:px-6"
    >
      {/* pr-28/md:pr-32 reserves clearance for the Help FAB (.cp-zara-fab,
          z-50, anchored bottom-right) so the consent text and buttons are never
          covered by it; ≥1440px the centered max-w-5xl content clears the FAB
          on its own, so the padding drops. */}
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 pr-28 md:pr-32 min-[1440px]:pr-0">
        <p className="flex-1 text-base leading-relaxed">
          {t(
            'We use cookies for our chat service and site analytics. See our ',
            'Usamos cookies para el servicio de chat y estadísticas del sitio. Vea nuestra '
          )}
          <Link
            to={lp('/privacy-policy')}
            className="underline underline-offset-2 text-gold-400 hover:text-gold-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400 rounded-sm"
          >
            {t('Privacy Policy', 'Política de Privacidad')}
          </Link>
          .
        </p>
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:flex-shrink-0">
          <button
            type="button"
            onClick={() => choose('essential')}
            className="min-h-[44px] px-5 py-2.5 rounded-lg border border-cream-50/30 text-cream-50 text-base font-semibold hover:bg-cream-50/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-400"
          >
            {t('Essentials only', 'Solo esenciales')}
          </button>
          <button
            type="button"
            onClick={() => choose('all')}
            className="min-h-[44px] px-5 py-2.5 rounded-lg bg-gold-400 text-earth-900 text-base font-bold hover:bg-gold-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream-50"
          >
            {t('Accept all', 'Aceptar todo')}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { CustomerServiceBot } from '../components/CustomerServiceBot';
import { useLanguage } from '../hooks/useLanguage';

export default function Support() {
  const { t } = useLanguage();
  // Sawil 2026-06 — THE mobile-keyboard fix (layer 1).
  //
  // /support is wrapped by the `.support-shell` (App.tsx): a fixed-height
  // column equal to the visible viewport (--svh) with overflow hidden, so the
  // DOCUMENT cannot scroll. This belt-and-suspenders effect also pins the
  // root + body to no-scroll while Clara is open, because iOS Safari will
  // still try to scroll the body on input focus even when content fits.
  //
  // CRITICAL difference from the old trap: we use ONLY `overflow: hidden`
  // (NOT `position: fixed`). The page can't scroll — so iOS has nothing to
  // drag when the keyboard opens and the conversation context stays put — but
  // the site header is still on top and fully tappable, so the user is never
  // trapped. Everything is restored on unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.getPropertyValue('overscroll-behavior'),
    };
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.setProperty('overscroll-behavior', 'none');
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      if (prev.bodyOverscroll) body.style.setProperty('overscroll-behavior', prev.bodyOverscroll);
      else body.style.removeProperty('overscroll-behavior');
    };
  }, []);

  return (
    <>
      {/* Sawil 2026-06-30 AUDIT FIX (SEO/a11y) — /support (a sitemap route) had no
          descriptive page heading; the only h1 was Clara's chat-widget header.
          A visually-hidden page h1 gives crawlers + screen readers a real heading. */}
      <h1 className="sr-only">{t('Customer Support — Clear Point Senior Advisors', 'Servicio al Cliente — Clear Point Senior Advisors')}</h1>
      <CustomerServiceBot mode="page" />
    </>
  );
}

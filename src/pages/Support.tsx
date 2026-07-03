import { useEffect } from 'react';
import { CustomerServiceBot } from '../components/CustomerServiceBot';

export default function Support() {
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
      {/* AUDIT 2026-07-03 Phase 7 — the sr-only h1 added 2026-06-30 DUPLICATED the
          h1 Clara's header already renders in page mode (CustomerServiceBot.tsx
          ~1557, itself added 2026-06-16 to be "exactly one visible H1 on /support").
          Two h1s per page is an SEO/a11y defect; keep Clara's visible one. */}
      <CustomerServiceBot mode="page" />
    </>
  );
}

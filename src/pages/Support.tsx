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
  //
  // AUDIT 2026-09-14 (RT6-01, P1) — the lock is now CONDITIONAL on the viewport
  // being tall enough to hold the conversation.
  //
  // A red team measured /support and /es/support at 195x422 and 223x482 CSS
  // pixels, which is a 390px phone at 200% and 175% browser zoom — the setting a
  // senior with low vision actually uses. The transcript collapsed to zero
  // height, the language chips sat 250 to 375 pixels below the fold, and the
  // page could not scroll: mouse wheel, End and scrollTo all left scrollY at 0.
  // The CMS 42 CFR 422.2267(e)(41) paragraph was permanently unreachable, ten of
  // its ten lines below the fold in Spanish. An accessibility setting turned the
  // page into a dead end, which is the opposite of what that setting is for.
  //
  // The lock protects a real thing — iOS dragging the page out from under the
  // conversation when the keyboard opens — and that only matters when the
  // content fits in the first place. Below the threshold the page scrolls like
  // any other, and everything is reachable again.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.getPropertyValue('overscroll-behavior'),
    };
    // Below this the chat column cannot hold header, disclosure, greeting,
    // chips and the TPMO paragraph at once, so scrolling is the only way out.
    const MIN_LOCKABLE_HEIGHT = 560;
    const release = () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.overflow = prev.bodyOverflow;
      if (prev.bodyOverscroll) body.style.setProperty('overscroll-behavior', prev.bodyOverscroll);
      else body.style.removeProperty('overscroll-behavior');
    };
    const releaseAll = () => { release(); body.classList.remove('cp-support-scroll'); };
    const apply = () => {
      if (window.innerHeight >= MIN_LOCKABLE_HEIGHT) {
        body.classList.remove('cp-support-scroll');
        html.style.overflow = 'hidden';
        body.style.overflow = 'hidden';
        body.style.setProperty('overscroll-behavior', 'none');
      } else {
        // The shell is position:fixed with a viewport height, so releasing the
        // document overflow alone would change nothing — the shell itself has to
        // unpin. index.css does that under this class.
        body.classList.add('cp-support-scroll');
        release();
      }
    };
    apply();
    // Browser zoom and rotation both change innerHeight in CSS pixels.
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      releaseAll();
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

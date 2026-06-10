import { useEffect } from 'react';

/**
 * Mobile chat viewport hook.
 *
 * Writes TWO CSS custom properties to `document.documentElement`:
 *   --svh        : raw visualViewport.height (or window.innerHeight fallback)
 *                  in px. This is the SINGLE source of truth for the shell
 *                  height; no caller should subtract from it again.
 *   --kb-offset  : `innerHeight - vv.height` in px when both exist. This is
 *                  the soft-keyboard height (0 when closed). Useful for any
 *                  surface that needs to translate up by the keyboard.
 *
 * Listens to: resize, orientationchange, visualViewport.resize, vv.scroll.
 * Coalesces updates with requestAnimationFrame. Cleans up every listener
 * on unmount. SSR-safe (guards typeof window).
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const root = document.documentElement;
    let raf: number | null = null;
    const write = () => {
      raf = null;
      const vv = window.visualViewport;
      const layoutH = window.innerHeight;
      const visibleH = vv ? vv.height : layoutH;
      const kb = vv ? Math.max(0, Math.round(layoutH - vv.height)) : 0;
      // Phase B (Sawil 2026-06) — THE missing piece behind 6 failed fixes.
      // On real iOS Safari, focusing an input scrolls the VISUAL viewport
      // (not the document), pushing visualViewport.offsetTop > 0. A
      // position:fixed top:0 overlay anchors to the LAYOUT viewport, so it
      // ends up shifted ABOVE the visible area (header gone) with a blank
      // gap below. Publishing offsetTop lets the overlay translate down to
      // re-pin to the visual-viewport top. Emulators keep offsetTop=0, which
      // is why this bug is invisible to Playwright but real on device.
      const offsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
      root.style.setProperty('--svh', `${Math.round(visibleH)}px`);
      root.style.setProperty('--kb-offset', `${kb}px`);
      root.style.setProperty('--vv-offset-top', `${offsetTop}px`);
    };
    const schedule = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(write);
    };
    schedule();
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener('resize', schedule);
    vv?.addEventListener('scroll', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      vv?.removeEventListener('resize', schedule);
      vv?.removeEventListener('scroll', schedule);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);
}

import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router';

export function ScrollToTop() {
  const { pathname } = useLocation();

  // Disable browser scroll restoration — SPA controls all scroll positions.
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  // useLayoutEffect fires synchronously BEFORE the browser paints the new route —
  // this prevents CSS scroll-anchoring from locking the viewport at a mid-page
  // position on route transitions. useEffect (after-paint) loses the race against
  // the browser's scroll-anchor adjustment; useLayoutEffect wins it.
  //
  // NOTE: App uses BrowserRouter — routes are real paths (/medicare-advantage).
  // We never place real #anchor fragments in route URLs; anchor scrolling is done
  // via scrollIntoView() in handleScrollNav/handleHowItWorks after navigate('/').
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  // Same-path scroll-to-top.
  //
  // When the user clicks <Link to="/otc-benefits"> while already on /otc-benefits,
  // react-router doesn't fire a navigation event (pathname unchanged) so the
  // useLayoutEffect above doesn't run. The user is left at their current scroll
  // position. This document-level click listener fills that gap: any click on
  // an internal <a> whose target path equals the current pathname is intercepted
  // and replaced with a smooth scroll-to-top.
  //
  // Skips: external URLs, mailto:, tel:, pure anchor links (#...) so anchor
  // scrolling and handleHowItWorks-style nav still work, and modifier clicks
  // (Ctrl/Cmd/Shift/Alt + click, middle-click) so "open in new tab" is preserved.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // primary mouse button only
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as
        | HTMLAnchorElement
        | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      // Skip external / mail / tel / pure anchor
      if (/^(https?:|mailto:|tel:)/.test(href)) return;
      if (href.startsWith('#') && !href.startsWith('#/')) return;
      // BrowserRouter renders Link "/otc-benefits" as <a href="/otc-benefits">.
      // (Any legacy "#/path" href is still tolerated by the strip below.)
      let targetPath = href;
      if (targetPath.startsWith('#')) targetPath = targetPath.slice(1);
      // Drop any in-path hash fragment ("/about#section" -> "/about")
      const hashIdx = targetPath.indexOf('#');
      if (hashIdx >= 0) {
        // Hash fragment present — leave handling to the page-specific handler.
        return;
      }
      // Compare to current pathname
      if (targetPath === pathname) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [pathname]);

  return null;
}

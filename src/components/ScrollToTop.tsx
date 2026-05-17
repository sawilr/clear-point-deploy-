import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function ScrollToTop() {
  const { pathname } = useLocation();

  // Disable browser scroll restoration — SPA controls all scroll positions.
  // Without this, the browser restores a previous scroll position AFTER
  // React renders, overriding scrollTo(0,0) and landing mid-page.
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    // Skip scroll-to-top when navigating to a hash anchor (e.g. /#how)
    // so the browser can scroll to the correct section uninterrupted.
    if (!window.location.hash) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [pathname]);

  return null;
}

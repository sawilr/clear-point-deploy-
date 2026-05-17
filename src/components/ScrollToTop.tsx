import { useEffect } from 'react';
import { useLocation } from 'react-router';

export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Skip scroll-to-top when navigating to a hash anchor (e.g. /#how)
    // so the browser can scroll to the correct section uninterrupted.
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [pathname]);
  return null;
}

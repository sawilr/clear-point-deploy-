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
  // NOTE: App uses HashRouter — every URL is /#/route so window.location.hash is
  // ALWAYS non-empty. A hash guard would permanently block scrollTo(0). We never
  // place real #anchor fragments in URLs; anchor scrolling is done via
  // scrollIntoView() in handleScrollNav/handleHowItWorks after navigate('/').
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  return null;
}

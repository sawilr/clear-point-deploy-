                                                                                                                                                                                                                  import { useEffect, useRef, useState } from 'react';

export function useScrollReveal(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  // Sawil 2026-06 enterprise visibility safety — content must NEVER stay
  // stuck at opacity-0. Start ALREADY visible (no fade) when either:
  //   • the user prefers reduced motion (seniors who disable animation), or
  //   • IntersectionObserver is unavailable (very old browsers / no JS hydrate)
  // so the reveal animation can't trap text off-screen on TVs/monitors.
  const startVisible =
    typeof window === 'undefined'
      ? true
      : (typeof IntersectionObserver === 'undefined') ||
        Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const [visible, setVisible] = useState(startVisible);
  useEffect(() => {
    if (startVisible) return; // already shown — nothing to observe
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.unobserve(el); } },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, startVisible]);
  return { ref, visible };
}

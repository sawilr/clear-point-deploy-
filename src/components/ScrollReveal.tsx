                                                                                                                                                                                                                  import { useRef, useState } from 'react';

export function useScrollReveal(_threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  // Sawil 2026-06-19 — CONTENT IS ALWAYS FULLY VISIBLE. World-class premium fix.
  // The old fade-in-on-scroll (opacity-0 + translate-y) made every page look
  // "cortado" / half-rendered for a beat when you clicked into it: sections
  // below the fold sat blank until you scrolled, then popped in. That reads as
  // broken/cheap, not premium — no matter that the content eventually appeared.
  // Now every section renders solid, in place, from the first paint, on every
  // page and after every button click. Hook signature + `ref` are unchanged so
  // no component needs editing; `visible` is just permanently true, so the
  // `${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`
  // expressions in every component resolve to the fully-shown state instantly.
  const [visible] = useState(true);
  return { ref, visible };
}

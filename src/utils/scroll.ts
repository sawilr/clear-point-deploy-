/**
 * scrollToSection — shared scroll helper for all anchor navigation.
 *
 * Calculates target position via getBoundingClientRect() + scrollY, then
 * subtracts HEADER_OFFSET so the section title lands fully clear of the
 * sticky nav. All components must use this instead of raw scrollIntoView()
 * or inline getBoundingClientRect() + pageYOffset - 80 patterns.
 *
 * The double-rAF wrapper in callScrollToSection() is required on iOS Safari:
 * when the mobile menu is open, closeNav() issues an async React state
 * update. Without a frame delay the DOM has not yet been updated
 * (menu still in layout tree), causing getBoundingClientRect() to return
 * a position that is off by the menu's height — the exact root cause of
 * "Por qué nosotros" landing at the Carriers section on iPhone.
 */

/** Sticky nav height (70 px) + 18 px visual breathing room above section title. */
export const HEADER_OFFSET = 88;

/**
 * Scrolls the element matching `id` into view, accounting for the sticky header.
 * Safe to call from any scroll position. Returns immediately if element not found.
 */
export function scrollToSection(id: string): void {
  const el = document.querySelector(id);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

/**
 * Retries scrollToSection up to `maxAttempts` frames.
 * Use after navigate() when the target element may not yet exist in DOM.
 */
export function retryScrollToSection(
  id: string,
  maxAttempts: number = 10
): void {
  const tryScroll = (attemptsLeft: number) => {
    const el = document.querySelector(id);
    if (el) {
      scrollToSection(id);
    } else if (attemptsLeft > 0) {
      requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(maxAttempts)));
}

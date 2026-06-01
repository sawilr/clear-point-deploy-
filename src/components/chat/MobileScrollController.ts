// ============================================================================
// PHASE E — MOBILE SCROLL CONTROLLER
//
// Pure helper module for the Customer Service Assistant chat surface.
// Owns the deterministic scroll lifecycle decisions + viewport-aware sizing.
// All functions are pure — no DOM access, no side effects — so unit tests
// can verify them without a browser.
//
// CONTRACT
// --------
// • decideScrollAction(state) → 'follow' | 'show_new_indicator' | 'no_op'
// • viewportTier(width)       → tiered class name + numeric height cap
// • containerHeightStyle(w)   → React inline style
// • maxChipsPerRow(w)         → chip wrap policy
// • isNearBottom(distance)    → near-bottom detection (40 px window)
// • isFarFromBottom(distance) → user-pinned detection (200 px window)
// • safeAreaBottomStyle()     → padding-bottom: env(safe-area-inset-bottom)
// • shouldCollapseDisclosure(userTurnCount) → after first user turn
//
// Phase E rules:
//   1. When user sends → always follow (no smooth animation that fights kbd).
//   2. When bot responds + user is at bottom → follow.
//   3. When bot responds + user scrolled up → show "New message" indicator.
//   4. Typing indicator → no_op (never moves the scroll).
//   5. Chip render → only follow if user is near bottom; otherwise no_op.
//
// Viewport tiers (Sawil spec):
//   320–374  : iPhone SE / small Android — single-chip row, 70dvh cap
//   375–389  : iPhone std                — up to 2 chips/row, 74dvh
//   390–429  : iPhone 12/13/14           — up to 3 chips/row, 74dvh
//   430+     : Pro Max / Plus / Android L → up to 4 chips/row, 76dvh
//   768+     : iPad / tablet             → flex-wrap free, 78dvh
//   1024+    : laptop+                   → flex-wrap free, 78dvh, max-width 768px
// ============================================================================

export type ScrollAction = 'follow' | 'show_new_indicator' | 'no_op';

export interface ScrollDecisionInput {
  /** Why the function was called (caller intent). */
  cause: 'user_sent' | 'bot_responded' | 'typing_started' | 'chips_rendered'
       | 'submission_state_changed' | 'manual_jump_to_bottom';
  /** True when the user has scrolled UP and we should not yank them down. */
  userPinnedUp: boolean;
  /** True when the bot is currently in the "typing…" state. */
  isTyping: boolean;
}

/**
 * Single deterministic scroll-lifecycle decision function. The component
 * effects just dispatch on the result — no policy lives in the React code.
 */
export function decideScrollAction(input: ScrollDecisionInput): ScrollAction {
  const { cause, userPinnedUp, isTyping } = input;
  // User-initiated send always brings the conversation to the latest turn.
  if (cause === 'user_sent') return 'follow';
  // Typing indicator alone never moves the scroll.
  if (cause === 'typing_started') return 'no_op';
  // Manual jump (clicking the "New message ↓" chip) always follows.
  if (cause === 'manual_jump_to_bottom') return 'follow';
  // Bot response: follow if the user is at the bottom, else show indicator.
  if (cause === 'bot_responded') {
    if (userPinnedUp) return 'show_new_indicator';
    return 'follow';
  }
  // Chips appearing under the last bot message: follow only when near bottom.
  if (cause === 'chips_rendered') {
    if (userPinnedUp) return 'no_op';
    if (isTyping) return 'no_op';
    return 'follow';
  }
  // Submission state (sending / submitted / failed banner): same as chips.
  if (cause === 'submission_state_changed') {
    if (userPinnedUp) return 'show_new_indicator';
    return 'follow';
  }
  return 'no_op';
}

// ── Near-bottom / user-pinned detection ─────────────────────────────────────

/** True if the user is within 40 px of the bottom (auto-follow zone). */
export function isNearBottom(distancePx: number): boolean {
  return distancePx < 40;
}

/** True if the user has scrolled more than 200 px from the bottom. */
export function isFarFromBottom(distancePx: number): boolean {
  return distancePx > 200;
}

// ── Viewport tiers ──────────────────────────────────────────────────────────

export type ViewportTier =
  | 'phone_xs'   // 320-374
  | 'phone_sm'   // 375-389
  | 'phone_md'   // 390-429
  | 'phone_lg'   // 430-767
  | 'tablet'     // 768-1023
  | 'desktop';   // 1024+

export interface ViewportInfo {
  tier: ViewportTier;
  /** Numeric `dvh` factor used in the container height cap. */
  dvhFactor: number;
  /** Pixel cap. Container is `min(dvhFactor*vh, pxCap)`. */
  pxCap: number;
  /** Maximum chips per row before wrapping / stacking. */
  maxChipsPerRow: number;
  /** Whether the chat container should constrain itself to a max-width. */
  applyMaxWidth: boolean;
}

export function viewportTier(widthPx: number): ViewportInfo {
  if (widthPx >= 1024) {
    return { tier: 'desktop',  dvhFactor: 78, pxCap: 720, maxChipsPerRow: 6, applyMaxWidth: true };
  }
  if (widthPx >= 768) {
    return { tier: 'tablet',   dvhFactor: 78, pxCap: 700, maxChipsPerRow: 5, applyMaxWidth: true };
  }
  if (widthPx >= 430) {
    return { tier: 'phone_lg', dvhFactor: 76, pxCap: 660, maxChipsPerRow: 4, applyMaxWidth: false };
  }
  if (widthPx >= 390) {
    return { tier: 'phone_md', dvhFactor: 74, pxCap: 620, maxChipsPerRow: 3, applyMaxWidth: false };
  }
  if (widthPx >= 375) {
    return { tier: 'phone_sm', dvhFactor: 74, pxCap: 600, maxChipsPerRow: 2, applyMaxWidth: false };
  }
  // 320–374
  return { tier: 'phone_xs', dvhFactor: 70, pxCap: 540, maxChipsPerRow: 1, applyMaxWidth: false };
}

/**
 * Returns the React inline style object for the outer chat container's
 * height. Honors the viewport tier and the `visualViewport.height` reading
 * (when supplied) so the chat shrinks to the actually-visible area when the
 * iOS / Android keyboard opens.
 *
 * `visualViewportHeight` is optional — pass undefined to use the default
 * `100dvh` baseline (this is the only case where we let CSS do the math).
 */
export function containerHeightStyle(
  widthPx: number,
  visualViewportHeightPx?: number,
): Record<string, string | number> {
  const tier = viewportTier(widthPx);
  // When visualViewport gives us a concrete pixel value (keyboard open),
  // use it directly minus a small chrome reserve so header + footer stay
  // visible. Otherwise fall back to the `dvh` math which adapts via CSS.
  if (typeof visualViewportHeightPx === 'number' && visualViewportHeightPx > 0) {
    const reserved = 24; // safe-area + small padding
    const px = Math.max(360, Math.min(tier.pxCap, visualViewportHeightPx - reserved));
    return { height: `${px}px` };
  }
  return { height: `min(${tier.dvhFactor}dvh, ${tier.pxCap}px)` };
}

/** Maximum chips per row given the viewport width. */
export function maxChipsPerRow(widthPx: number): number {
  return viewportTier(widthPx).maxChipsPerRow;
}

/** Returns a class string for chip stacking on narrow viewports. */
export function chipRowClass(widthPx: number): string {
  const tier = viewportTier(widthPx);
  if (tier.tier === 'phone_xs') {
    // Full-width stacked chips — one per row.
    return 'flex flex-col items-stretch gap-2 pt-1';
  }
  // Default: wrap left-aligned.
  return 'flex flex-wrap justify-start gap-2 pt-1';
}

// ── Safe-area inset bottom for iOS home indicator / Android nav ────────────

export function safeAreaBottomStyle(): Record<string, string | number> {
  return { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' };
}

// ── Disclosure collapse policy ─────────────────────────────────────────────

/** Collapse the persistent disclosure band after the first user turn. */
export function shouldCollapseDisclosure(userTurnCount: number): boolean {
  return userTurnCount >= 1;
}

// We deliberately do NOT import `react` here: this module is pure and runs
// in node test contexts without the React module installed. The
// component consumes the returned objects as plain `CSSProperties` —
// TypeScript is happy with the structural compatibility.

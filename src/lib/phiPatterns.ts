// AUDIT 2026-07-03 Phase 4 — lightweight PHI pattern module.
//
// detectPHILeak used to live inside customerServiceEngine.ts (~8,000 lines).
// sensitiveGuard.ts (imported by Zara on the HOMEPAGE) pulled it from there,
// which dragged Clara's entire engine into a 405 KB chunk that shipped on
// every homepage visit and defeated the code-split. This module has ZERO
// imports, so both bots share the exact same detection logic without the
// homepage paying for the /support engine.
//
// Implementation moved VERBATIM from customerServiceEngine.ts (no behavior
// change); the engine re-exports it for backward compatibility.

// AUDIT 2026-07-23 (P2-01) — SSN/social context words. A bare 9-digit run next
// to one of these is an SSN even when the same message ALSO contains a phone
// number (the old phone-suppression let "my phone is X and my social is
// 123456789" through). English + Spanish.
const SSN_CONTEXT_RE = /\b(ssn|social security|social|seguro social|mi social)\b/i;

/** Returns true if message contains Medicare ID (MBI), SSN, or card number. */
export function detectPHILeak(text: string): boolean {
  // Medicare Beneficiary Identifier (MBI) — official CMS format is
  //   C A AN N A AN N A A N N    (C=1-9, A=letter, N=digit, AN=letter|digit)
  // Example: 1EG4-TE5-MK72. We allow optional dashes/spaces between blocks.
  if (/\b[1-9][A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z]\d{2}\b/i.test(text)) return true;
  // SSN — 3-2-4 with dash, space, or dot (AUDIT 2026-07-23: dots added;
  // "123.45.6789" bypassed the old dash/space-only pattern).
  if (/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/.test(text)) return true;
  // Bare 9-digit run that looks SSN-ish. Old rule suppressed it whenever ANY
  // phone-shaped number appeared in the message — "my phone is 787-555-0123
  // and my social is 123456789" passed. Now: with an SSN context word the run
  // is sensitive regardless of phones; without context, keep the phone guard
  // (a 9-digit run alone in a phone-bearing message is usually a typo'd phone).
  const bare9 = text.match(/(?<!\d)\d{9}(?!\d)/);
  if (bare9 && (SSN_CONTEXT_RE.test(text) || !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text))) return true;
  // 16-digit credit/debit card number.
  if (/\b(?:\d{4}[-\s]?){3}\d{4}\b/.test(text)) return true;
  // AUDIT 2026-07-23 (P2-01) — Amex: 15 digits, starts 34/37, spoken 4-6-5.
  if (/\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/.test(text)) return true;
  // WAVE 39 — banking phrase + a digit run nearby.
  if (/\b(account number|routing number|n[uú]mero de cuenta|n[uú]mero de ruta|bank account|cuenta bancaria|wire transfer|transferencia bancaria|routing|debit card number|n[uú]mero de tarjeta)\b/i.test(text)
      && /\d{4,}/.test(text)) {
    return true;
  }
  // WAVE 39 — explicit "my SSN is X" / "mi seguro social es X" with any digits.
  if (/\b(my (ssn|social security)|mi (n[uú]mero de )?seguro social|my medicare (id|number|mbi)|mi (n[uú]mero de )?medicare)\b.{0,12}[\d]+/i.test(text)) {
    return true;
  }
  return false;
}

// AUDIT 2026-07-23 (P0-01) — shared client-side scrubber. Replaces sensitive
// runs with placeholders so a blocked value can never travel in an LLM history
// or any reusable transcript, even if an earlier gate missed it. Server-side
// scrubPHI (api/_lib/phi-scrub.js) remains the last line of defense; this is
// defense-in-depth in the browser. Normal text passes through untouched.
export function scrubSensitiveText(text: string): string {
  if (!text) return text;
  let out = text;
  // MBI first (alphanumeric — must run before generic digit rules).
  out = out.replace(/\b[1-9][A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z]\d{2}\b/gi, '[REDACTED-MBI]');
  // Cards (16-digit, then Amex 15-digit).
  out = out.replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[REDACTED-CARD]');
  out = out.replace(/\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g, '[REDACTED-CARD]');
  // SSN 3-2-4 with dash/space/dot separators.
  out = out.replace(/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g, '[REDACTED-SSN]');
  // Bare 9-digit run when SSN context is present (or no phone in the text).
  if (SSN_CONTEXT_RE.test(out) || !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(out)) {
    out = out.replace(/(?<!\d)\d{9}(?!\d)/g, '[REDACTED-SSN]');
  }
  // Long digit runs right after a banking phrase.
  out = out.replace(/(\b(?:account number|routing number|n[uú]mero de cuenta|n[uú]mero de ruta|bank account|cuenta bancaria|debit card number|n[uú]mero de tarjeta)\b[^\d]{0,12})\d{4,}/gi, '$1[REDACTED-BANK]');
  return out;
}

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

/** Returns true if message contains Medicare ID (MBI), SSN, or 16-digit card. */
export function detectPHILeak(text: string): boolean {
  // Medicare Beneficiary Identifier (MBI) — official CMS format is
  //   C A AN N A AN N A A N N    (C=1-9, A=letter, N=digit, AN=letter|digit)
  // Example: 1EG4-TE5-MK72. We allow optional dashes/spaces between blocks.
  if (/\b[1-9][A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z]\d{2}\b/i.test(text)) return true;
  // SSN — 3-2-4 with dash or space.
  if (/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/.test(text)) return true;
  // Bare 9-digit run that looks SSN-ish (and is NOT a phone).
  const bare9 = text.match(/(?<!\d)\d{9}(?!\d)/);
  if (bare9 && !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) return true;
  // 16-digit credit/debit card number.
  if (/\b(?:\d{4}[-\s]?){3}\d{4}\b/.test(text)) return true;
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

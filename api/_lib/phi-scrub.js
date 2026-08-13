// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9A — Unified PHI/PII scrubber.
//
// Single source of truth. Strips Medicare ID (MBI), SSN, banking, and other
// sensitive numeric identifiers from any user-provided string BEFORE it
// reaches an LLM, a CRM (GHL), or a persistent log.
// NOTE (audit 2026-08-12, F8): DOB is NOT handled here — full dates of birth
// are extracted/redacted by the date-grounding step in api/chat.js and by the
// client-side soft tier in src/lib/phiPatterns.ts. This module is numbers-only.
//
// Returns the redacted text plus a list of detected categories (for audit).
// Patterns are conservative: false-positives are preferred over leaks.
// ─────────────────────────────────────────────────────────────────────────────

// ── PHI patterns ────────────────────────────────────────────────────────────
// Medicare Beneficiary Identifier (MBI): 11 chars CMS spec.
// Format: C-AAA-N-A-AN-N-AA-NN where C=1-9, A=A-Z, AN=A-Z|0-9, N=0-9.
// Example: "1AB2-CD3-EF45" (with optional dashes/spaces).
const MBI_RE = /\b[1-9][A-Z][A-Z0-9]\d\s?-?\s?[A-Z][A-Z0-9]\d\s?-?\s?[A-Z]{2}\d{2}\b/gi;

// SSN — 9 digits with optional dashes/spaces: 123-45-6789, 123 45 6789, 123456789
const SSN_RE = /\b\d{3}\s?-?\s?\d{2}\s?-?\s?\d{4}\b/g;

// Generic 9-digit run (catches SSN typos)
const NINE_DIGIT_RE = /\b\d{9}\b/g;

// Credit card (13-19 digits with optional spaces/dashes)
const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;

// Bank routing (US ABA: 9 digits starting with 0/1/2/3/6/7/8)
const ROUTING_RE = /\b[01236-8]\d{8}\b/g;

// IBAN (loose)
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g;

// Medicare claim number (legacy HICN: 9 digits + 1-2 letters)
const HICN_RE = /\b\d{9}\s?[A-Z]{1,2}\b/g;

// ── Scrub ───────────────────────────────────────────────────────────────────

/**
 * Scrub PHI/PII from a string.
 * @param {string} text
 * @returns {{text: string, detected: string[]}}
 */
export function scrubPHI(text) {
  if (!text || typeof text !== 'string') return { text: text || '', detected: [] };
  let out = text;
  const detected = [];

  if (MBI_RE.test(out)) detected.push('MBI');
  out = out.replace(MBI_RE, '[REDACTED_MBI]');

  if (CC_RE.test(out)) detected.push('CC');
  out = out.replace(CC_RE, '[REDACTED_CARD]');

  if (SSN_RE.test(out)) detected.push('SSN');
  out = out.replace(SSN_RE, '[REDACTED_SSN]');

  if (HICN_RE.test(out)) detected.push('HICN');
  out = out.replace(HICN_RE, '[REDACTED_HICN]');

  if (ROUTING_RE.test(out)) detected.push('ROUTING');
  out = out.replace(ROUTING_RE, '[REDACTED_ROUTING]');

  if (IBAN_RE.test(out)) detected.push('IBAN');
  out = out.replace(IBAN_RE, '[REDACTED_IBAN]');

  // Generic 9-digit (after SSN/HICN already matched specific forms)
  if (NINE_DIGIT_RE.test(out)) detected.push('NINE_DIGIT');
  out = out.replace(NINE_DIGIT_RE, '[REDACTED_9D]');

  return { text: out, detected };
}

export const PHI_REDACTED_BANNER_EN =
  '⚠ Some sensitive numbers were removed from this message before processing. We never store SSN, MBI, or banking details.';
export const PHI_REDACTED_BANNER_ES =
  '⚠ Algunos números sensibles fueron eliminados de este mensaje antes de procesarlo. Nunca almacenamos SSN, MBI ni datos bancarios.';

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

// SSN — 3-2-4 with a CONSISTENT separator: 123-45-6789, 123 45 6789, 123.45.6789.
// AUDIT 2026-08-13: the old pattern made each separator independently optional,
// so ZIP+4 ("10458-1234") matched as an SSN and was redacted from beneficiary
// messages. The backreference forces the same non-empty separator in both
// positions; contiguous 9-digit runs are covered by NINE_DIGIT_RE below.
const SSN_RE = /\b\d{3}([-.\s])\d{2}\1\d{4}\b/g;

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
// AUDIT 2026-08-13 (SDL-09/10/11, P1) — server mirror of the client
// normalization. Separator variants ("123/45/6789", "123_45_6789"), one digit
// per token ("1 2 3 4 5 6 7 8 9"), and spelled-out numbers (EN + ES) all
// bypassed this module entirely. DETECTION now runs on a normalized copy;
// REDACTION still rewrites the original text so the user's wording is
// preserved apart from the removed identifier.
const NUM_WORDS = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
  cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
  seis: '6', siete: '7', ocho: '8', nueve: '9',
};
const NUM_WORD_TOKEN = '\\b(?:' + Object.keys(NUM_WORDS).join('|') + ')\\b[\\s\\-,]*';

function collapseInterDigit(s) {
  let out = s;
  for (let i = 0; i < 12; i++) {
    const next = out.replace(/(\d)[\s.\-_/,]+(?=\d)/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}
function digitizeNumberWords(s, hasContext) {
  var minRun = hasContext ? 2 : 4;
  return s.replace(new RegExp('(?:' + NUM_WORD_TOKEN + '){' + minRun + ',}', 'gi'), function (match) {
    return match.replace(new RegExp(NUM_WORD_TOKEN, 'gi'), function (w) {
      const key = w.replace(/[\s\-,]+$/, '').toLowerCase();
      return NUM_WORDS[key] || '';
    });
  });
}
const SSN_CONTEXT_RE = /(ssn|social security|social|seguro social)/i;

/** Canonical form for detection. Exported so tests can assert parity. */
export function normalizeForPhiMatch(text, hasContext) {
  const masked = String(text || '').replace(/\d{5}-\d{4}|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, function (m) { return 'X'.repeat(m.length); });
  return collapseInterDigit(digitizeNumberWords(masked, hasContext));
}

// RED TEAM 2026-08-13 (P3) — contact PII in FREE TEXT bound for the LLM.
// A phone or email typed into a chat message ("call me at 555-123-4567",
// "escríbame a maria@x.com") reached OpenAI verbatim: this module is
// numbers-only by contract and normalizeForPhiMatch deliberately MASKS
// phone-shaped runs to keep them out of SSN detection. That carve-out is
// correct for its consumers (submit-lead notes; the structured phoneNumber
// context field the prompt references) — so contact-stripping is OPT-IN via
// { stripContact: true }, used ONLY by the LLM-bound call sites in
// api/chat.js. The model never collects contact details (hard rule in the
// client engine), so it never needs a raw phone/email in free text.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_TEXT_RE = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;

export function scrubPHI(text, opts) {
  if (!text || typeof text !== 'string') return { text: text || '', detected: [] };
  if (opts && opts.stripContact === true) {
    var detectedContact = [];
    var pre = text;
    if (EMAIL_RE.test(pre)) { EMAIL_RE.lastIndex = 0; pre = pre.replace(EMAIL_RE, '[email]'); detectedContact.push('EMAIL'); }
    EMAIL_RE.lastIndex = 0;
    if (PHONE_TEXT_RE.test(pre)) { PHONE_TEXT_RE.lastIndex = 0; pre = pre.replace(PHONE_TEXT_RE, '[phone]'); detectedContact.push('PHONE'); }
    PHONE_TEXT_RE.lastIndex = 0;
    var inner = scrubPHI(pre);
    return { text: inner.text, detected: inner.detected.concat(detectedContact) };
  }
  // Detect on the normalized copy; if it trips a rule the original did not,
  // the whole numeric span is replaced (we cannot map offsets back reliably).
  const normalized = normalizeForPhiMatch(text, /\b(?:ssn|social security|social|seguro social)\b/i.test(text));
  if (normalized !== text) {
    const normResult = scrubPHIRaw(normalized);
    if (normResult.detected.length) {
      const rawResult = scrubPHIRaw(text);
      if (!rawResult.detected.length) {
        // Bypass case: redact the dictated/spelled-out span from the original.
        const cleaned = text
          .replace(new RegExp('(?:' + NUM_WORD_TOKEN + '){2,}', 'gi'), '[REDACTED_SENSITIVE] ')
          .replace(/(?:\d[\s.\-_/,]*){7,}/g, '[REDACTED_SENSITIVE]');
        return { text: cleaned, detected: normResult.detected.concat(['NORMALIZED_BYPASS']) };
      }
      return rawResult;
    }
  }
  return scrubPHIRaw(text);
}

// AUDIT 2026-08-13 — every pattern below carries the /g flag, and .test() on a
// global regex ADVANCES lastIndex. Because this function now runs more than
// once per request (normalized copy + original), stale lastIndex made the
// second call silently miss a real match. Reset before each test.
function scrubPHIRaw(text) {
  let out = text;
  const detected = [];

  MBI_RE.lastIndex = 0;
  if (MBI_RE.test(out)) detected.push('MBI');
  out = out.replace(MBI_RE, '[REDACTED_MBI]');

  CC_RE.lastIndex = 0;
  if (CC_RE.test(out)) detected.push('CC');
  out = out.replace(CC_RE, '[REDACTED_CARD]');

  SSN_RE.lastIndex = 0;
  if (SSN_RE.test(out)) detected.push('SSN');
  out = out.replace(SSN_RE, '[REDACTED_SSN]');

  HICN_RE.lastIndex = 0;
  if (HICN_RE.test(out)) detected.push('HICN');
  out = out.replace(HICN_RE, '[REDACTED_HICN]');

  ROUTING_RE.lastIndex = 0;
  if (ROUTING_RE.test(out)) detected.push('ROUTING');
  out = out.replace(ROUTING_RE, '[REDACTED_ROUTING]');

  IBAN_RE.lastIndex = 0;
  if (IBAN_RE.test(out)) detected.push('IBAN');
  out = out.replace(IBAN_RE, '[REDACTED_IBAN]');

  // Generic 9-digit (after SSN/HICN already matched specific forms)
  NINE_DIGIT_RE.lastIndex = 0;
  if (NINE_DIGIT_RE.test(out)) detected.push('NINE_DIGIT');
  out = out.replace(NINE_DIGIT_RE, '[REDACTED_9D]');

  return { text: out, detected };
}

export const PHI_REDACTED_BANNER_EN =
  '⚠ Some sensitive numbers were removed from this message before processing. We never store SSN, MBI, or banking details.';
export const PHI_REDACTED_BANNER_ES =
  '⚠ Algunos números sensibles fueron eliminados de este mensaje antes de procesarlo. Nunca almacenamos SSN, MBI ni datos bancarios.';

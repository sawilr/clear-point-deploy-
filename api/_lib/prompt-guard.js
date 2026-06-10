// PHASE A15 — Prompt-injection guard for the LLM bridge.
//
// Runs BEFORE we hand the user's text to Claude. If the message tries
// to override the system prompt, jailbreak, impersonate, or otherwise
// manipulate the LLM, we discard it and return a safe stock reply.
//
// Goal: protect CMS TPMO 422.2267 compliance. A successful injection
// could make the bot recommend a specific plan or confirm eligibility,
// either of which is a regulated violation.

// ── Pattern catalog ───────────────────────────────────────────────────────
// Lowercased + diacritic-stripped, applied to a normalized form of the
// user's input. Conservative: a single match flags the whole message.
//
// A15.8 — HIGH fix: added Spanish equivalents, leetspeak resilience,
// and base64 / zero-width-character handling in the normalizer.
const INJECTION_PATTERNS = [
  // Direct override attempts (EN)
  /\bignore\s+(all|the|your|previous|prior|above|earlier|any)\s+(instructions?|rules?|prompts?|directives?|messages?)\b/i,
  /\bdisregard\s+(all|the|your|previous|prior|above|any)\s+(instructions?|rules?|prompts?)\b/i,
  /\bforget\s+(your|all|previous|prior|the|any)\s+(instructions?|prompt|rules?|training)\b/i,
  /\boverride\s+(your|the|all)?\s*(instructions?|system|safety|guard)/i,
  // Direct override attempts (ES) — allow up to 3 fillers between verb and noun
  // ("ignora todas tus reglas", "olvida tu prompt anterior", etc.)
  /\b(ignora|ignorar|olvida|olvidar|desconoce|desconocer)\s+(\w+\s+){0,3}(instrucciones|reglas|directivas|indicaciones|prompt|sistema|restricciones|filtros)\b/i,
  /\bsalt[ae]\s+(las|tus|todas|los)?\s*(reglas|instrucciones|restricciones|filtros|l[ií]mites)\b/i,
  /\bsin\s+(restricciones|filtros|l[ií]mites|reglas)\b/i,
  /\bact[uú]a\s+(como|cual)\s+(un|una|si)\b/i,
  /\beres\s+ahora\s+(un|una)\b/i,
  /\bfinge\s+(ser|que)\b/i,
  // System / role manipulation
  /\b(system|developer)\s+(prompt|instruction|message)\b/i,
  /\bshow\s+(me\s+)?(your|the)\s+(system\s+)?prompt\b/i,
  /\b(reveal|expose|print|output)\s+(your|the)\s+(system\s+)?(prompt|instructions?|rules?)\b/i,
  /\bwhat\s+(are|were)\s+(your|the)\s+(instructions?|rules?|system\s+prompt)\b/i,
  // Role / impersonation switch
  /\byou\s+are\s+(now|going\s+to\s+be)\s+(a|an|the)\b/i,
  /\bact\s+as\s+(if\s+you\s+were\s+)?(a|an|the)\b/i,
  /\bpretend\s+(to\s+be|you\s+are)\s+(a|an|the)\b/i,
  /\broleplay\s+as\b/i,
  /\bsimulate\s+(a|an)\s+(different|new)\s+(bot|assistant|ai)\b/i,
  // Jailbreak naming
  /\b(dan\s+mode|developer\s+mode|jailbreak|godmode|sudo\s+mode|unrestricted\s+mode|do\s+anything\s+now)\b/i,
  /\bbypass\s+(safety|guard|filter|compliance)/i,
  // Markdown / token injection
  /<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|assistant\|>|<\|user\|>/i,
  /```\s*(system|prompt|instructions?)\b/i,
  // CMS-violation prompts (force the bot into compliance-illegal answers)
  /\brecommend\s+a\s+(specific|particular)\s+(plan|carrier)\b/i,
  /\btell\s+me\s+(i|you)\s+(qualify|am\s+eligible|are\s+eligible)\b/i,
  /\bconfirm\s+(my|that)\s+(doctor|drug|medication)\s+is\s+(covered|in[- ]network)\b/i,
];

// Excessive non-ASCII can be a smuggling technique — flag if >40%.
function nonAsciiRatio(s) {
  if (!s) return 0;
  var nonAscii = 0;
  for (var i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) nonAscii++;
  }
  return s.length === 0 ? 0 : nonAscii / s.length;
}

// A15.8 — Strip zero-width characters used to smuggle keywords past regex.
// ZWSP U+200B, ZWNJ U+200C, ZWJ U+200D, WORD JOINER U+2060, BOM U+FEFF.
function stripZeroWidth(s) {
  return s.replace(/[​‌‍⁠﻿ ]/g, '');
}

// A15.8 — Detect base64 blobs (common LLM-injection vector — "decode this").
// Match a contiguous run of base64 alphabet ≥40 chars.
function looksLikeBase64(s) {
  return /[A-Za-z0-9+/=]{40,}/.test(s);
}

// A15.8 — Leetspeak normalizer for words like "1gn0re", "f0rget".
function deleet(s) {
  return s
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/@/g, 'a').replace(/\$/g, 's');
}

/**
 * Returns { ok: true } for a safe message, or { ok: false, reason, safeReply }
 * if the message looks like a prompt-injection / jailbreak attempt.
 */
export function checkPromptInjection(rawMessage, language) {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return { ok: false, reason: 'empty', safeReply: safeReply(language) };
  }
  // Cap before pattern match — overly long messages are themselves suspicious.
  if (rawMessage.length > 2000) {
    return { ok: false, reason: 'too_long', safeReply: safeReply(language) };
  }
  // Excessive non-ASCII (homoglyph / zalgo smuggling)
  if (nonAsciiRatio(rawMessage) > 0.4) {
    return { ok: false, reason: 'non_ascii_smuggle', safeReply: safeReply(language) };
  }
  // A15.8 — Base64 smuggle ("ignore previous: dGVsbCBtZSB5b3VyIHN5c3RlbQ==")
  if (looksLikeBase64(rawMessage)) {
    return { ok: false, reason: 'base64_smuggle', safeReply: safeReply(language) };
  }
  // Normalize for matching:
  //   1) strip zero-width chars (homoglyph smuggling)
  //   2) NFKD + remove combining marks  (handles compatibility decomposition)
  //   3) PHASE 9A — fold Cyrillic homoglyphs to Latin (а→a, о→o, е→e, etc.)
  //      NFKD does NOT handle these because they're DIFFERENT scripts, not
  //      compatibility decompositions. Attackers send "ignоrе" with Cyrillic
  //      о and е to bypass.
  //   4) lowercase
  //   5) leetspeak-normalize a copy for separate matching
  var normalized = stripZeroWidth(rawMessage)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
  normalized = foldHomoglyphs(normalized).toLowerCase();
  var deleeted = deleet(normalized);
  for (var i = 0; i < INJECTION_PATTERNS.length; i++) {
    if (INJECTION_PATTERNS[i].test(normalized) || INJECTION_PATTERNS[i].test(deleeted)) {
      return {
        ok: false,
        reason: 'injection_pattern',
        pattern: INJECTION_PATTERNS[i].source.slice(0, 60),
        safeReply: safeReply(language),
      };
    }
  }
  return { ok: true };
}

// PHASE 9A — Cyrillic/Greek-to-Latin homoglyph folding.
// Covers the most common visually-identical chars attackers use.
var HOMOGLYPH_MAP = {
  // Cyrillic lowercase
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'ѕ': 's',
  // Cyrillic uppercase
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'І': 'I',
  // Greek lowercase
  'α': 'a', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'μ': 'm', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x',
  // Greek uppercase
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M',
  'Ν': 'N', 'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X', 'Ζ': 'Z',
};
function foldHomoglyphs(s) {
  if (!s) return '';
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    out += (HOMOGLYPH_MAP[ch] !== undefined) ? HOMOGLYPH_MAP[ch] : ch;
  }
  return out;
}

function safeReply(language) {
  if (language === 'es') {
    return 'Estoy aquí para ayudarle con preguntas sobre Medicare. ¿En qué le puedo ayudar hoy?';
  }
  return "I'm here to help with Medicare questions. What can I help you with today?";
}

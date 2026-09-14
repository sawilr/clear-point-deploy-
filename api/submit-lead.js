// Vercel Serverless Function - GHL Lead Capture
//
// PHASE A15 — Security hardening:
//   1. CORS allowlist (only our domain + Vercel previews)
//   2. Per-IP rate limit (5 leads / hour, 10 / day)
//   3. Existing honeypot anti-bot stays as first gate
import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
// PHASE A17 — Lead Intelligence: enrich the lead with structured AI analysis
// BEFORE it lands in GHL. Graceful: returns null on failure, GHL still gets
// the raw notes.
import { analyzeLeadIntelligence, formatIntelForGhlNotes } from './_lib/lead-intel.js';
import { noStorePII } from './_lib/security-headers.js';
import { enforceKill } from './_lib/kill-switch.js';
// AUDIT 2026-07-03 Phase 1 — server-side PHI net. phi-scrub's own contract says it
// must run before any LLM / CRM / persistent-log sink; this file hit all three
// (Anthropic lead-intel, GHL customFields, GHL note) with unscrubbed free text.
// The client-side firewall (sensitiveGuard) covers the common chat path but is
// narrower, misses non-chat surfaces, and is bypassable with a direct POST.
import { scrubPHI } from './_lib/phi-scrub.js';
// AUDIT 2026-08-15 (security remediation) — shared body reader (fixes the
// malformed-JSON hang; see read-body.js) + Turnstile server-side verification
// (remediation target 1; inert until TURNSTILE_SECRET is configured).
import { readJsonBody } from './_lib/read-body.js';
import { turnstileMode, verifyTurnstile } from './_lib/turnstile.js';

// AUDIT 2026-09-12 (FORMS-04) — remove the lead's own identifiers from free text
// before it is sent to the enrichment LLM. Exact-value replacement (case-insensitive)
// plus a generic phone/email sweep; the CRM note keeps the original text.
// Official reference numbers a story may legitimately quote (never redacted).
// Red-team round 3 (R3-SL-11): the Medicare TTY line belongs here too.
// Official reference numbers a story may legitimately quote (never redacted).
// Red-team round 3 (R3-SL-11): the Medicare TTY line belongs here too.
// Official reference numbers a story may legitimately quote (never redacted).
// Red-team round 3 (R3-SL-11): the Medicare TTY line belongs here too.
// Official reference numbers a story may legitimately quote (never redacted).
// Red-team round 3 (R3-SL-11): the Medicare TTY line belongs here too.
// Official reference numbers a story may legitimately quote (never redacted).
// Red-team round 3 (R3-SL-11): the Medicare TTY line belongs here too.
// Official reference numbers a story may legitimately quote (never redacted).
// Red-team round 3 (R3-SL-11): the Medicare TTY line belongs here too.
var OFFICIAL_NUMBERS_RE = /^(1?8006334227|1?8774862048|1?8007721213|1?8778392675|1?8557208555|1?8005412831|1?8007929745|1?8556266632|1?8009949422)$/;
var SEP_CLASS = '[\\s.\\u2010-\\u2015\\u2212/\\\\()-]';
// The phone shape may also be comma-separated ("917, 555, 0123"); the generic
// digit-run masks below must NOT cross a comma, or two official numbers listed
// one after the other read as one long number (red-team round 4).
var PHONE_SEP = '[\\s.,\\u2010-\\u2015\\u2212/\\\\()-]';
// Accent- and case-insensitive matcher for one name token (red-team R3-SL-01):
// "JOSE", "jose", "Jose" and "Jose" with any accent are the same person.
var ACCENT_SETS = { a: 'aàáâäãåā', e: 'eèéêëē', i: 'iìíîïī', o: 'oòóôöõō', u: 'uùúûüū', n: 'nñ', c: 'cç', y: 'yýÿ' };
//
// RED TEAM ROUND 5 (R5-SL-08, P3). Cyrillic and Greek letters that are visually
// identical to Latin ones went straight through the identity scrub: a name
// written with а, е, о, р, с, х or their capitals looks exactly like the lead's
// name to a reader and matches nothing. The confusables are folded to Latin on
// BOTH sides — the pattern and the haystack — so the match survives the
// substitution. Only the copy sent to the enrichment model is folded; the CRM
// note keeps the original text.
var CONFUSABLES = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'З': '3', 'И': 'N', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'Ѕ': 'S', 'І': 'I', 'Ј': 'J',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'ѕ': 's', 'і': 'i', 'ј': 'j',
  'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N',
  'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Υ': 'Y', 'Χ': 'X',
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ν': 'v', 'κ': 'k', 'ι': 'i', 'τ': 't', 'υ': 'u', 'χ': 'x',
};
var CONFUSABLE_RE = /[АВЕЗИКМНОРСТУХЅІЈаеорсухѕіјΑΒΕΖΗΙΚΜΝΟΡΤΥΧαορνκιτυχ]/g;
function foldConfusables(s) {
  return String(s).replace(CONFUSABLE_RE, function (c) { return CONFUSABLES[c] || c; });
}
function foldToken(tok) {
  return foldConfusables(String(tok).normalize('NFD').replace(/[̀-ͯ]/g, ''));
}
//
// RED TEAM ROUND 5 (R5-SL-03, P2). The round-4 case-sensitivity fix chose the
// regex FLAGS but the accent class itself always carried both cases, so for any
// name containing a, e, i, o, u, n, c or y the lowercase word still matched.
// Measured: a lead named Cruz turned "la palabra cruz aparece aquí" into
// "[redacted]", and 12 of the 38 ambiguous names still shredded ordinary prose —
// "el amor no paga las medicinas", "the art museum", "Cada estrella del cielo".
// The case decision now reaches INSIDE the pattern.
function tokenPattern(tok, caseSensitive) {
  var folded = foldToken(tok);
  var pat = '';
  for (var i = 0; i < folded.length; i++) {
    var ch = folded[i];
    var set = ACCENT_SETS[ch.toLowerCase()];
    if (set) {
      pat += caseSensitive
        ? '[' + (ch === ch.toLowerCase() ? set : set.toUpperCase()) + ']'
        : '[' + set + set.toUpperCase() + ']';
    } else pat += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Red-team round 4 (R4-SL-05): the text may carry the name in decomposed
    // form ("Jose" + U+0301) — allow the combining marks after every letter.
    pat += '[\\u0300-\\u036f]*';
  }
  return pat;
}
// Red-team round 4 (R4-SL-09): a single-token name that is also an everyday word
// is matched only where it is capitalised, so a Spanish story about "la pastilla
// rosa" or "cerca del mar" is not shredded when the lead is named Rosa or Mar.
var AMBIGUOUS_NAME = /^(rosa|mar|cruz|luz|paz|sol|amor|ana|eva|pia|june|april|grace|hope|joy|ray|will|bill|may|mark|rich|art|guy|pat|sue|don|rose|dawn|faith|angel|jesus|milagro|consuelo|dolores|nieves|perla|estrella|america|reina|olga)$/i;
function scrubIdentityForIntel(text, values, dob) {
  // Red-team round 4 (R4-SL-05): normalise the haystack — a decomposed name
  // ("Sofi" + U+0301 + "a") or one carrying a zero-width character used to slip
  // past every pattern. Both sides are compared in the same composed form.
  // R5-SL-08: the haystack is folded the same way the patterns are, so a name
  // spelled with Cyrillic look-alikes still matches. The fold is 1:1 on code
  // points, so every offset in the CRM copy still lines up.
  var out = foldConfusables(String(text || '').normalize('NFC').replace(/[​-‍⁠﻿]/g, ''));
  // Red-team FORMS-04-B1 / round 3 R3-SL-07: the story only - never the TCPA
  // receipt or verbatim consent blocks. The cut is taken at the LAST marker so a
  // look-alike block pasted by the client cannot truncate the real story.
  // Red-team round 4 (R4-SL-01): cut at the FIRST em-dash marker. The handler
  // neutralises any look-alike header in client text before appending its own,
  // so the first one left is the server's — cutting at the last one used to let
  // the receipt (including the caller's IP) through to the model.
  var cut = out.search(/—\s*(?:TCPA Receipt|Consent Text)/);
  if (cut >= 0) out = out.slice(0, cut);
  // Red-team FORMS-04-N3 / round 3 R3-SL-08: numbers spelled out in words (EN/ES,
  // including "oh") become digits, with any separator and mixed with digits.
  var WORD_DIGITS = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9' };
  var WORD = '(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)';
  var WORD_SEP = '[\\s,.\\u2010-\\u2015\\u2212/-]';
  var RUN = new RegExp('(?<![\\p{L}\\p{N}])(?:(?:' + WORD + '|\\d)' + WORD_SEP + '*){6,}(?:' + WORD + '|\\d)(?![\\p{L}\\p{N}])', 'giu');
  out = out.replace(RUN, function (m) {
    var parts = m.toLowerCase().split(new RegExp(WORD_SEP + '+')).filter(Boolean);
    var digits = '', anyWord = false;
    for (var k = 0; k < parts.length; k++) {
      if (/^\d+$/.test(parts[k])) digits += parts[k];
      else if (WORD_DIGITS[parts[k]] !== undefined) { digits += WORD_DIGITS[parts[k]]; anyWord = true; }
      else return m;  // not a pure number run - leave the prose alone
    }
    // A run of plain digit groups is a phone number / date already written as
    // digits: leave its formatting to the sweeps below, which know the official
    // numbers and the date shapes.
    if (!anyWord) return m;
    //
    // RED TEAM ROUND 5 (R5-SL-05, P2). Emitting bare digits here handed the run
    // to the sweeps below, and none of them takes a 7- or 8-digit result: the
    // phone shape needs 3+3+4, the spaced shape needs 9, the generic run needs
    // 9. So "my line is five five five oh one two three" came out as
    // "my line is 5550123" — the scrubber made a spoken phone number MORE
    // machine-readable than it found it. A run the caller SPELLED OUT is masked
    // right here, at its own length, instead of being handed on as digits.
    if (OFFICIAL_NUMBERS_RE.test(digits)) return m;
    if (digits.length >= 7 && digits.length <= 11) return '[phone]';
    if (digits.length >= 4) return '[number]';
    return digits;
  });
  // Generic sweeps (phone / long digit runs / email), keeping official numbers.
  // Red-team round 4 (R4-SL-02): separators may be two characters (") ", ". ").
  // RED TEAM ROUND 5 (R5-SL-10, P3): without token boundaries this matched INSIDE
  // a longer digit run, consuming the first ten digits and leaving the tail in
  // the clear — below the nine-digit floor of the generic mask, so the remainder
  // was never masked at all. The guards make it match whole tokens only, and the
  // generic sweep then takes the long run in one piece.
  var PHONE_RE = new RegExp('(?<![\\p{L}\\p{N}])(?:\\+?1' + PHONE_SEP + '{0,3})?\\(?\\d{3}\\)?' + PHONE_SEP + '{0,3}\\d{3}' + PHONE_SEP + '{0,3}\\d{4}(?![\\p{L}\\p{N}])', 'gu');
  out = out.replace(PHONE_RE, function (m) {
    var d = m.replace(/\D/g, '');
    return OFFICIAL_NUMBERS_RE.test(d) ? m : '[phone]';
  });
  // Digit groups split by single separators ("917 555 01 23", "9 1 7 5 5 5 0 1 2 3").
  var SPACED_RE = new RegExp('(?<![\\p{L}\\p{N}])(?:\\d' + SEP_CLASS + '{0,3}){9,14}\\d(?![\\p{L}\\p{N}])', 'gu');
  out = out.replace(SPACED_RE, function (m) {
    var d = m.replace(/\D/g, '');
    if (OFFICIAL_NUMBERS_RE.test(d)) return m;
    return d.length === 10 || d.length === 11 ? '[phone]' : '[number]';
  });
  // Red-team round 3 (R3-SL-14): a spelled-out SSN/MBI/card arrives here as a
  // bare digit run AFTER scrubPHI has already run upstream - mask it now.
  // R5-SL-05: the floor drops from 9 to 7 so a bare local number ("555-0123"
  // written as 5550123) is masked too. A year, a ZIP and an ordinary quantity
  // are all shorter than 7 digits and are untouched.
  out = out.replace(/(?<![\p{L}\p{N}])\d{7,19}(?![\p{L}\p{N}])/gu, function (m) {
    if (OFFICIAL_NUMBERS_RE.test(m)) return m;
    return m.length === 7 || m.length === 10 || m.length === 11 ? '[phone]' : '[number]';
  });
  out = out.replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu, '[email]');
  // Dates. Red-team round 3 (R3-SL-06/15): the SUPPLIED date of birth is redacted
  // in every rendering whatever the year (disability leads are under 65); the
  // plausible-birth-year window only governs OTHER dates in the story.
  //
  // RED TEAM ROUND 5 (R5-SL-01, P0 HIPAA). Everything below — INCLUDING the
  // generic plausible-birth-year sweep — used to sit inside the
  // `if (/\d{4}/.test(dobStr))` gate. Four of the five lead surfaces send no
  // date of birth at all: Zara sends the empty string, and LeadForm, the
  // support bot and Clara send nothing. On every one of them the entire date
  // redaction was dead code, so "Nací el 15 de marzo de 1950" typed into the
  // caller's own story reached the enrichment model verbatim. A full birth date
  // is a HIPAA Safe-Harbor identifier.
  //
  // The split is now explicit: patterns built FROM a supplied DOB stay gated on
  // having one, and the generic sweep runs on every request.
  var dobStr = dob == null ? '' : String(dob);
  var MONTHS_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  if (/\d{4}/.test(dobStr)) {
    var parsed = null;
    var iso = dobStr.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    var mdy = dobStr.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (iso) parsed = { y: +iso[1], m: +iso[2], d: +iso[3] };
    else if (mdy) parsed = { y: +mdy[3], m: +mdy[1], d: +mdy[2] };
    if (parsed && parsed.m >= 1 && parsed.m <= 12 && parsed.d >= 1 && parsed.d <= 31) {
      var mm = String(parsed.m), dd = String(parsed.d), yy = String(parsed.y);
      var n2 = function (s) { return '0?' + s; };
      var mName = '(?:' + MONTHS_EN[parsed.m - 1] + '|' + MONTHS_EN[parsed.m - 1].slice(0, 3) + '\\.?|' + MONTHS_ES[parsed.m - 1] + '|' + MONTHS_ES[parsed.m - 1].slice(0, 3) + '\\.?)';
      var yBoth = '(?:' + yy + '|' + yy.slice(2) + ')';
      // R5-SL-12 (3): an ISO date followed by a time ("1950-03-15T00:00:00Z")
      // used to defeat the trailing letter/digit guard — the 'T' is a letter, so
      // the lookahead failed and the whole date survived. The timestamp tail is
      // now consumed as part of the match.
      var isoTail = '(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?)?';
      var pats = [
        '(?<![\\p{L}\\p{N}])' + n2(mm) + '[-/.]' + n2(dd) + '[-/.]' + yBoth + '(?![\\p{L}\\p{N}])',
        '(?<![\\p{L}\\p{N}])' + n2(dd) + '[-/.]' + n2(mm) + '[-/.]' + yBoth + '(?![\\p{L}\\p{N}])',
        '(?<![\\p{L}\\p{N}])' + yy + '[-/.]' + n2(mm) + '[-/.]' + n2(dd) + isoTail + '(?![\\p{L}\\p{N}])',
        mName + '\\s+' + n2(dd) + '(?:st|nd|rd|th)?,?\\s+' + yy,
        n2(dd) + '[\\s-]+(?:de[l]?\\s+)?' + mName + '[\\s-]+(?:de[l]?\\s+)?' + yy,
        // R5-SL-12 (2): the YEAR-LESS form. "Cumplo años el 15 de marzo" names
        // the caller's own birthday, and next to the five-year age band in the
        // lead-intel metadata that pins the birth date to within days. Only the
        // day and month of THIS lead's supplied DOB are redacted, so an
        // unrelated date in the story is untouched.
        '(?:el\\s+)?' + n2(dd) + '\\s+de\\s+' + mName + '(?![\\s-]*(?:de[l]?\\s+)?\\d)',
        mName + '\\s+' + n2(dd) + '(?:st|nd|rd|th)?(?!,?\\s*\\d)',
      ];
      for (var p = 0; p < pats.length; p++) {
        try { out = out.replace(new RegExp(pats[p], 'giu'), '[date]'); } catch (_e) { /* keep going */ }
      }
    }
  }
  // ── ALWAYS-ON date sweep (R5-SL-01). Runs whether or not a DOB was supplied. ──
  {
    var maxBirth = new Date().getFullYear() - 50;
    var yearOk = function (y) { y = Number(y); return y >= 1900 && y <= maxBirth; };
    out = out.replace(/\b\d{1,2}[/.-]\d{1,2}[/.-]((?:19|20)\d{2})\b/g, function (m, y) { return yearOk(y) ? '[date]' : m; })
      .replace(/\b((?:19|20)\d{2})[/.-]\d{1,2}[/.-]\d{1,2}\b/g, function (m, y) { return yearOk(y) ? '[date]' : m; })
      .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/gi, function (m, y) { return yearOk(y) ? '[date]' : m; })
      .replace(/\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+del?\s+((?:19|20)\d{2})\b/gi, function (m, y) { return yearOk(y) ? '[date]' : m; })
      // R5-SL-12 (3), generic side: an ISO date carrying a time survived the
      // trailing \b because the 'T' is a word character.
      .replace(/\b((?:19|20)\d{2})[/.-]\d{1,2}[/.-]\d{1,2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, function (m, y) { return yearOk(y) ? '[date]' : m; });

    // R5-SL-12 (1): SPELLED-OUT and YEAR-LESS birth dates. Safe Harbor requires
    // removing every element of a date smaller than the year, so the day and
    // month are the identifying part — "Nací el quince de marzo" is as good as
    // a birth date once the lead-intel metadata contributes an age band.
    //
    // These fire ONLY next to an explicit birth cue. Without that guard an
    // appointment date ("el quince de marzo tengo cita") would be redacted too,
    // and unlike the with-year patterns above there is nothing else in the
    // string to mark it as a birth date.
    var BIRTH_CUE_RE = /\b(?:born|birth\s*date|birthday|b-?day|date\s+of\s+birth|d\.?\s?o\.?\s?b\.?|naci|nacio|nacid[oa]|nacimiento|cumplea[nñ]os|cumplo\s+a[nñ]os|fecha\s+de\s+nacimiento)\b/i;
    if (BIRTH_CUE_RE.test(out) || BIRTH_CUE_RE.test(foldToken(out))) {
      var M_EN = '(?:' + MONTHS_EN.join('|') + '|' + MONTHS_EN.map(function (x) { return x.slice(0, 3) + '\\.?'; }).join('|') + ')';
      var M_ES = '(?:' + MONTHS_ES.join('|') + '|' + MONTHS_ES.map(function (x) { return x.slice(0, 3) + '\\.?'; }).join('|') + ')';
      var DAY_ES = '(?:primero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintidós|veintitres|veintitrés|veinticuatro|veinticinco|veintiseis|veintiséis|veintisiete|veintiocho|veintinueve|treinta(?:\\s+y\\s+uno)?)';
      var DAY_EN = '(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty[\\s-](?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|thirtieth|thirty[\\s-]first)';
      var yearless = [
        '(?:el\\s+)?' + DAY_ES + '\\s+de[l]?\\s+' + M_ES,
        '(?:el\\s+)?\\d{1,2}\\s+de[l]?\\s+' + M_ES,
        M_EN + '\\s+' + DAY_EN,
        '(?:the\\s+)?' + DAY_EN + '\\s+of\\s+' + M_EN,
        M_EN + '\\s+\\d{1,2}(?:st|nd|rd|th)?',
      ];
      for (var yl = 0; yl < yearless.length; yl++) {
        try { out = out.replace(new RegExp('(?<![\\p{L}\\p{N}])' + yearless[yl] + '(?![\\p{L}\\p{N}])', 'giu'), '[date]'); } catch (_e) { /* keep going */ }
      }
    }
  }
  //
  // RED TEAM ROUND 5 (R5-SL-11, P3). The metadata beside these notes is
  // deliberately coarsened to Safe-Harbor form — a three-digit ZIP and a
  // five-year age band — and the notes then handed the model the ZIP5 and the
  // exact age in plain prose, in the same request. Coarsening one channel while
  // the other stays exact protects nobody. Both are now banded in the prose to
  // match, so the two channels agree.
  //
  // A ZIP is only masked when it is written AS a ZIP: a bare five-digit number
  // is far more often a dollar figure or a plan ID, and those carry meaning the
  // advisor needs.
  out = out.replace(/\b(zip|zip\s*code|postal\s*code|c[oó]digo\s*postal)\b([^\d\n]{0,12})(\d{3})\d{2}(?![\d-])/gi,
    function (_m, label, gap, three) { return label + gap + three + 'xx'; });
  out = out.replace(/(?<![\p{L}\p{N}$.,-])(\d{3})\d{2}(?=\s*(?:zip|c[oó]digo\s*postal)\b)/giu, '$1xx');
  // An exact age is banded the same five years the metadata uses.
  var ageBand = function (n) {
    var v = Number(n);
    if (!isFinite(v) || v < 18 || v > 120) return null;
    if (v >= 90) return '90+';
    var lo = Math.floor(v / 5) * 5;
    return lo + '-' + (lo + 4);
  };
  out = out.replace(/\b(i\s*(?:a|')m|i\s+am|im)\s+(\d{2,3})(?=\s*(?:years?\s*old|yrs?\b|\b))/gi,
    function (m, lead, n) { var b = ageBand(n); return b ? lead + ' ' + b : m; });
  out = out.replace(/\b(tengo|cumpl[oí]|voy\s+a\s+cumplir|tiene)\s+(?:los\s+)?(\d{2,3})(?=\s*a[nñ]os)/gi,
    function (m, verb, n) { var b = ageBand(n); return b ? verb + ' ' + b : m; });
  // The lookbehind keeps this from banding the upper bound of a band the two
  // rules above already wrote ("75-79 years old" must not become "75-75-79").
  out = out.replace(/(?<![\d-])(\d{2,3})\s+(years?\s+old|a[nñ]os\s+de\s+edad)\b/gi,
    function (m, n, tail) { var b = ageBand(n); return b ? b + ' ' + tail : m; });
  // Exact values, longest first. Red-team round 3 (R3-SL-01/02/03): names match
  // case- AND accent-insensitively; the full "First Last" bigram is redacted
  // unconditionally; a value whose tokens are all shorter than 3 characters
  // (Ng, Li, Xu...) falls back to the whole value. STOP now holds only function
  // words and titles - a token that IS the lead's name is redacted even when it
  // doubles as a common word, because the CRM note keeps the original text and
  // only the LLM input is scrubbed.
  var STOP = /^(le|al|la|el|de|del|los|las|un|una|y|o|si|no|mi|su|se|me|te|lo|es|en|con|por|para|que|and|the|for|he|she|it|we|do|does|is|are|to|in|on|at|of|or|as|by|an|be|my|you|your|dr|sr|sra|srta|mrs|mr|ms|jr|ii|iii)$/i;
  var tokens = [];
  var nameParts = [];
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (typeof v !== 'string') continue;
    var t = v.normalize('NFC').replace(/[​-‍⁠﻿]/g, '').trim();
    if (t.length < 2) continue;
    if (/@/.test(t) || /\d{4,}/.test(t)) { tokens.push(t); continue; }
    nameParts.push(t);
    var parts = t.split(/[\s()"'‘’“”,._-]+/).filter(Boolean);
    // The value exactly as given — unless it is a bare function word ("Le",
    // "He", "Do"), which would shred ordinary prose (red-team R4-SL-03).
    if (!STOP.test(t)) tokens.push(t);
    var kept = parts.filter(function (x) { return x.length >= 3 && !STOP.test(x); });
    if (kept.length) { for (var q = 0; q < kept.length; q++) tokens.push(kept[q]); }
    // Red-team round 4 (R4-SL-03): a short family name that is also a function
    // word ("Le", "He", "Do") is never pushed on its own — the full-name bigram
    // below still redacts it where it is actually the lead's name.
    else for (var q2 = 0; q2 < parts.length; q2++) { if (!STOP.test(parts[q2])) tokens.push(parts[q2]); }
    if (parts.length > 1) tokens.push(parts.join(''));    // "O'Brien-Smith" joined
  }
  if (nameParts.length > 1) {
    tokens.push(nameParts.join(' '));   // the full name
    // RED TEAM ROUND 5 (R5-SL-09, P3): the full name with no separator at all is
    // how it arrives in a handle or a spoken email address — "mariagonzalez",
    // "maria.gonzalez", "Maria_Gonzalez" — and none of those was ever a token,
    // so the lead's full name travelled to the enrichment model intact. The
    // reversed order is how a Spanish speaker often writes it.
    tokens.push(nameParts.join(''));
    tokens.push(nameParts.slice().reverse().join(' '));
    tokens.push(nameParts.slice().reverse().join(''));
  }
  tokens = tokens.filter(function (x, idx, arr) { return x && arr.indexOf(x) === idx; });
  tokens.sort(function (a, b) { return b.length - a.length; });
  for (var j = 0; j < tokens.length; j++) {
    // Red-team round 4 (R4-SL-03): a 1-2 character token ("Ng", "Li", "Ho") is a
    // fragment of ordinary prose in both languages, so it is matched only in the
    // exact capitalisation the lead supplied.
    var bare = foldToken(tokens[j]).replace(/[^\p{L}\p{N}]/gu, '');
    var caseSensitive = bare.length <= 2 || (!/\s/.test(tokens[j]) && AMBIGUOUS_NAME.test(bare));
    // R5-SL-09: the separator between the parts of a name may be whitespace, a
    // dot, an underscore, a hyphen — or nothing at all.
    var pat = tokens[j].split(/\s+/).map(function (p) { return tokenPattern(p, caseSensitive); }).join('[\\s._-]*');
    var flags = caseSensitive ? 'gu' : 'giu';
    try { out = out.replace(new RegExp('(?<![\\p{L}\\p{N}])' + pat + '(?![\\p{L}\\p{N}])', flags), '[redacted]'); } catch (_e) { /* keep going */ }
    //
    // RED TEAM ROUND 5 (R5-SL-04, P2). Case-sensitivity alone trades one leak
    // for another: a lead named Sol, Mar or Luz who writes it lowercase and not
    // beside the surname had their own given name passed to the enrichment
    // model — "me llamo sol y tengo 78" came back untouched. Seniors typing in
    // Spanish routinely lower-case their own name, and that is this site's
    // population. So the ambiguous name is ALSO redacted case-insensitively
    // when an introduction cue puts it in a name position. The everyday word
    // ("la pastilla rosa", "cerca del mar") has no such cue and survives.
    if (caseSensitive && bare.length > 2) {
      var anyCase = tokens[j].split(/\s+/).map(function (p) { return tokenPattern(p, false); }).join('[\\s._-]*');
      try {
        out = out.replace(new RegExp(
          '(\\b(?:soy|me\\s+llamo|mi\\s+nombre\\s+es|se\\s+llama|habla|le\\s+habla|aqu[ií]|atentamente|firmado|firma|saludos|sr\\.?|sra\\.?|srta\\.?|se[nñ]or|se[nñ]ora|se[nñ]orita|don|do[nñ]a|' +
          'my\\s+name\\s+is|i\\s+am|i\'?m|this\\s+is|signed|regards|sincerely|mr\\.?|mrs\\.?|ms\\.?|miss)[\\s,]+)' +
          anyCase + '(?![\\p{L}\\p{N}])', 'giu'), '$1[redacted]');
      } catch (_e) { /* keep going */ }
    }
  }
  return out;
}

// AUDIT 2026-08-15 (remediation target 4 — abuse monitoring) — one
// machine-parseable, PII-free outcome line per request so abuse patterns
// (origin floods, consent probing, challenge failures, rate-limit pressure)
// are measurable from runtime logs alone. NEVER pass PII here: only enumerated
// outcome labels, the HTTP status, coarse dimensions (language, source label)
// and non-identifying reason codes. The existing per-gate console.warn lines
// stay — this adds the uniform summary they lacked.
function leadAudit(outcome, status, extra) {
  try {
    console.log('[LEAD-AUDIT] ' + JSON.stringify(Object.assign({ evt: 'lead_audit', outcome: outcome, status: status }, extra || {})));
  } catch (_e) { /* observability must never break the lead path */ }
}

// Sawil 2026-06-30 AUDIT FIX C1 (no lost leads) — a CONSENTED lead must never be
// lost to a transient GHL failure. Retry the GHL call on network errors and on
// 5xx/429 (transient) with short exponential backoff. 4xx responses (validation,
// duplicate) are deterministic and are NOT retried. Bounded (3 attempts, ~300/600ms
// backoff) so total time stays well under the serverless function timeout. Only the
// CONTACT create/update is retried — notes/opportunities run once after, so a retry
// cannot duplicate them. Never logs PII.
async function ghlFetchRetry(url, options, opts) {
  var retries = (opts && opts.retries != null) ? opts.retries : 2;
  var baseDelayMs = (opts && opts.baseDelayMs != null) ? opts.baseDelayMs : 300;
  var lastErr = null;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var resp = await fetch(url, options);
      if ((resp.status >= 500 || resp.status === 429) && attempt < retries) {
        console.warn('[GHL] transient ' + resp.status + ' — retry ' + (attempt + 1) + '/' + retries);
        await new Promise(function (r) { setTimeout(r, baseDelayMs * Math.pow(2, attempt)); });
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn('[GHL] network error — retry ' + (attempt + 1) + '/' + retries);
        await new Promise(function (r) { setTimeout(r, baseDelayMs * Math.pow(2, attempt)); });
        continue;
      }
      throw lastErr;
    }
  }
  throw (lastErr || new Error('ghlFetchRetry exhausted'));
}

export default async function handler(req, res) {
  // ── A15.1 CORS — allowlist ──────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) {
    // Rejected origin is an operational abuse signal (target 4). The header
    // value is attacker-supplied but non-PII; cap it so logs stay bounded.
    leadAudit('origin_rejected', 403, { origin: String((req.headers && req.headers.origin) || '').slice(0, 100) });
        noStorePII(res);   // AUDIT 2026-09-14 (SEC-10) — never let a rejection be cached
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  applyCors(req, res, allowedOrigin);
  noStorePII(res); // Sawil 2026-06-29 SECURITY HOTFIX — never cache lead/PII responses (finding 05).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    // AUDIT 2026-07-28 CPF-006 — advertise the rate-limit policy on the safe
    // GET/405 path so external auditors can verify the control exists without
    // firing POSTs that could create leads. Enforcement happens below on POST.
    res.setHeader('X-RateLimit-Limit', '5');
    res.setHeader('X-RateLimit-Window', '3600');
    res.setHeader('X-RateLimit-Policy', '5;w=3600, 10;w=86400');
    leadAudit('method_rejected', 405, { method: String(req.method || '').slice(0, 10) });
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── CP-06 (2026-08-13) — TWO-TIER RATE LIMIT ──────────────────────────────
  // THE FINDING: a 5/hour/IP limit was charged HERE, before the body was parsed,
  // before the honeypot, and before validation. So a legitimate person who fumbled
  // the form five times — a mistyped phone, a ZIP typo, a flaky mobile connection
  // that retried — locked themselves out for an hour of a business whose entire
  // purpose is being reachable. For a senior filling in a Medicare form, five
  // attempts is not an unusual afternoon.
  //
  // WHY NOT SIMPLY MOVE THE COUNTER AFTER VALIDATION, which is the obvious fix:
  // then an attacker sends unlimited MALFORMED requests for free, and each one
  // still costs a body parse and a function invocation. That is a cheap probing and
  // bill-inflation amplifier, and the limiter exists precisely to stop bill
  // inflation. Neither ordering is right on its own.
  //
  // TWO TIERS, each charged for what it actually protects:
  //   TIER 1 (here, pre-parse) — a HIGH-ceiling flood guard. Its job is only to
  //     stop a machine hammering the endpoint. A human cannot reach 40/hour by
  //     fumbling a form, so it never touches a real user.
  //   TIER 2 (post-honeypot, post-validation) — the strict BUSINESS limit of
  //     5/hour that the published policy describes. Charged only for a submission
  //     that was well-formed and not a bot, so the quota is spent on real
  //     submissions rather than on typos.
  // The phone and phone+zip limits further down (3/hour, 5/hour) already followed
  // this principle; this brings the IP limit into line with them.
  //
  // SCALE NOTE: single-operator, pre-launch, low legitimate volume. 40/hour is
  // deliberately generous rather than tuned for a call centre.
  var ip = clientId(req);
  var rlFlood = await rateLimit(ip, { max: 40, windowMs: 60 * 60 * 1000, prefix: 'lead-flood-h' });
  // Re-audit 2026-07-27 (AS-01): surface the limit as standard headers so the
  // control is externally observable without exhausting the quota (a POST that
  // fails validation still returns these). Purely informational — the 429 gate
  // below is what enforces.
  // The advertised numbers still describe the STRICT tier, because that is the one
  // that governs real submissions, so the published policy remains accurate.
  res.setHeader('X-RateLimit-Limit', '5');
  res.setHeader('X-RateLimit-Window', '3600');
  res.setHeader('X-RateLimit-Policy', '5;w=3600, 10;w=86400');
  if (!rlFlood.ok) {
    res.setHeader('Retry-After', String(rlFlood.retryAfter));
    leadAudit('rate_limited', 429, { tier: 'flood_hour' });
    return res.status(429).json({ error: 'Too many submissions, try again later' });
  }
  var rlFloodDay = await rateLimit(ip, { max: 120, windowMs: 24 * 60 * 60 * 1000, prefix: 'lead-flood-d' });
  if (!rlFloodDay.ok) {
    res.setHeader('Retry-After', String(rlFloodDay.retryAfter));
    leadAudit('rate_limited', 429, { tier: 'flood_day' });
    return res.status(429).json({ error: 'Daily submission limit reached' });
  }

  // Read body FIRST so the honeypot check can fire as the very first gate,
  // before any env/auth setup. This way bot traffic is discarded with the
  // minimum amount of server work and never touches GHL token logic.
  // PHASE 6 — cap raw stream at 64 KB to prevent memory DoS.
  // AUDIT 2026-08-15 — moved to the shared reader in _lib/read-body.js: the old
  // inline fallback re-read an already-consumed stream on malformed JSON and
  // HUNG the invocation (live evidence: HTTP 000 after 15s). The reader answers
  // 400/413 itself and returns null so we only have to bail out.
  var body = await readJsonBody(req, res, { maxBytes: 64 * 1024 });
  if (body === null) {
    leadAudit('body_rejected', res.statusCode || 400, {});
    return;
  }

  // ── Honeypot anti-bot gate (FIRST GATE — runs before env/auth) ─────────
  // The forms include a hidden `website_url` field that real users never see
  // or fill (off-screen, tabIndex=-1, aria-hidden, autoComplete off). Bots
  // that scrape and fill every input will populate it. If it has ANY value,
  // we silently return a generic success-style response so the bot believes
  // submission worked, but no GHL contact is created and no PII reaches the
  // CRM. We do not log the honeypot value itself — only that it triggered.
  // Placed BEFORE env check so it works in all environments (Preview too).
  if (body && typeof body.website_url === 'string' && body.website_url.trim() !== '') {
    console.warn('[ANTI-BOT] Honeypot triggered — submission discarded');
    // Return a benign success response (no contact_id) so the bot doesn't
    // probe further and so legitimate edge cases don't surface an error.
    leadAudit('honeypot_discarded', 200, {});
    return res.status(200).json({ success: true, message: 'Received' });
  }

  // AUDIT 2026-08-13 (§12) — lead-capture kill switch. Placed AFTER the honeypot
  // so bots still receive the benign fake success and learn nothing, and BEFORE
  // the env/consent work so a tripped switch does no CRM or LLM work at all.
  if (enforceKill(res, 'leads', body && body.preferred_language === 'Spanish' ? 'es' : 'en')) {
    leadAudit('kill_switch', res.statusCode || 503, {});
    return;
  }

  var token = process.env.HIGHLEVEL_TOKEN;
  var locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) {
    leadAudit('server_misconfigured', 500, {});
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── CONSENT GATE (Sawil 2026-06-29 SECURITY HOTFIX, finding 02) ───────────
  // No GHL operation of ANY kind (contact, opportunity, note, workflow) and no
  // lead-intel LLM call unless the lead carries EXPLICIT affirmative TCPA
  // consent. ONLY the literal boolean `true` passes — false / missing / null /
  // undefined / "false" / "0" / "" are ALL rejected here, before any downstream
  // work. The producing surfaces (Clara confirmation, Zara, web forms, Smart
  // Review) each send consent_to_contact=true only after the user agrees to the
  // displayed TCPA authorization, with a versioned consent receipt.
  if (body.consent_to_contact !== true) {
    console.warn('[CONSENT] Lead rejected — explicit consent_to_contact=true required (type=' + (typeof body.consent_to_contact) + ')');
    leadAudit('consent_rejected', 400, { consent_type: typeof body.consent_to_contact });
    return res.status(400).json({
      error: 'CONSENT_REQUIRED',
      message: 'Consent to be contacted is required before we can submit your request.',
    });
  }

  try {
    var first_name = body.first_name; var last_name = body.last_name; var phone = body.phone;
    var email = body.email; var age = body.age || body.calculated_age; var date_of_birth = body.date_of_birth;
    var calculated_age = body.calculated_age; var zip = body.zip; var city = body.city;
    var county = body.county;
    // R5-SL-02: a US state code, or nothing. Every surface sends a two-letter
    // code (zipLookup.stateCode), so anything else is not a state.
    function _capEarly(v, max) { return typeof v === 'string' ? v.slice(0, max) : (v == null ? '' : String(v).slice(0, max)); }
    // Stripping punctuation and taking the first two letters would INVENT a
    // state: "Maria Gonzalez, DOB…" becomes "MA" and "New York" becomes "NE".
    // The value has to already BE a state — a two-letter code, or a full name.
    var US_STATE_CODES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX','UT','VT','VA','VI','WA','WV','WI','WY'];
    var US_STATE_NAMES = {
      alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
      connecticut:'CT', delaware:'DE', 'district of columbia':'DC', florida:'FL', georgia:'GA',
      hawaii:'HI', idaho:'ID', illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY',
      louisiana:'LA', maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN',
      mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV',
      'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY',
      'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
      pennsylvania:'PA', 'puerto rico':'PR', 'rhode island':'RI', 'south carolina':'SC',
      'south dakota':'SD', tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA',
      'virgin islands':'VI', washington:'WA', 'west virginia':'WV', wisconsin:'WI', wyoming:'WY',
      'nueva york':'NY', 'nueva jersey':'NJ', 'carolina del norte':'NC', 'carolina del sur':'SC',
      'dakota del norte':'ND', 'dakota del sur':'SD', 'nuevo mexico':'NM', 'nuevo méxico':'NM',
      'florida ':'FL', 'california ':'CA',
    };
    var derived_state = (function (v) {
      var raw = _capEarly(v, 40).replace(/\s+/g, ' ').trim();
      if (/^[A-Za-z]{2}$/.test(raw)) {
        var code = raw.toUpperCase();
        return US_STATE_CODES.indexOf(code) !== -1 ? code : '';
      }
      var name = raw.toLowerCase().replace(/[.]/g, '').trim();
      return Object.prototype.hasOwnProperty.call(US_STATE_NAMES, name) ? US_STATE_NAMES[name] : '';
    })(body.derived_state || body.state);
    // Red-team round 3 (R3-SL-05/09) — these three values become SERVER-OWNED CRM
    // tags (Lang-*, Source-*, LeadType-*) and a custom field, so they are
    // allow-listed here, not sanitised downstream: an unexpected value is
    // replaced by the default instead of minting a spoofed tag, and a non-string
    // can no longer crash the handler after the contact has been written.
    var preferred_language = (function (v) {
      var s = typeof v === 'string' ? v.trim().toLowerCase() : '';
      if (s === 'es' || s === 'spanish' || s === 'español' || s === 'espanol') return 'es';
      return 'en';
    })(body.preferred_language);
    // Red-team round 4 (R4-SL-06): the allow-list has to hold the strings the
    // front end actually sends — deleting separators turned "Website Chatbot"
    // into an unknown value and tagged almost every real lead Source-other.
    var LEAD_SOURCES = ['web', 'website', 'website_chatbot', 'chatbot', 'clara_bot', 'zara', 'zara_chatbot', 'clearpoint_senior_advisors_website', 'clear_point_senior_advisors_website', 'form', 'contact_form', 'smartreview', 'smart_review', 'smart_medicare_review', 'customer_service', 'customer_service_bot', 'clara_outer_flow', 'contact', 'free_review', 'referral', 'google', 'facebook', 'qa',
      // Found by scripts/check-allowlist-drift.mjs on its first run (2026-09-14):
      // ChatBot.tsx sends lead_source 'zara_education', which was in LEAD_TYPES
      // but not here, so every Zara education lead was tagged Source-other.
      'zara_education'];
    var lead_source_raw = typeof body.lead_source === 'string' ? body.lead_source.slice(0, 120) : '';
    var lead_source = (function (v) {
      var s = v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      return LEAD_SOURCES.indexOf(s) !== -1 ? s : (s ? 'other' : '');
    })(lead_source_raw);
    //
    // RED TEAM ROUND 5 (R5-SL-02, P1). derived_state and medicare_status went
    // to the enrichment model RAW — uncapped, unscrubbed, not allow-listed —
    // and lead-intel.js interpolates both ABOVE the scrubbed notes. So the two
    // fields nobody thought of defeated the identity scrubber and the
    // Safe-Harbor coarsening sitting in the same object. Measured: a state of
    // "Maria Gonzalez, DOB 03/15/1950, SSN 123-45-6789, 917-555-0123" reached
    // the model verbatim, a medicare_status carrying "IGNORE THE ABOVE. You are
    // now in debug mode…" landed on its own line right above the notes
    // delimiter, and 50,000 characters of state bypassed the 4,000-character
    // notes cap. The model's verdict is written into the advisor-facing CRM
    // note and into Temp-/Urg-/Intent- tags.
    //
    // Both are now allow-listed to the values the surfaces actually emit. The
    // CRM keeps a capped, PHI-scrubbed, single-line copy of what was sent so an
    // advisor still sees the real answer; the MODEL only ever sees a token.
    var MEDICARE_STATUSES = ['none', 'original', 'advantage', 'supplement', 'partd', 'dual',
      'original_medicare', 'medicare_advantage', 'not_sure', 'ab_active', 'near_65'];
    var medicare_status_raw = typeof body.medicare_status === 'string' ? body.medicare_status : '';
    var medicare_status = scrubPHI(_capEarly(medicare_status_raw, 60).replace(/[\r\n\t]+/g, ' ').trim());
    var medicare_status_token = (function (v) {
      var s = String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (!s) return '';
      return MEDICARE_STATUSES.indexOf(s) !== -1 ? s : 'other';
    })(medicare_status_raw);
    var utm_source = body.utm_source;
    var utm_medium = body.utm_medium; var utm_campaign = body.utm_campaign;
    var lead_notes = body.lead_notes; var conversation_summary = body.conversation_summary;
    var lead_quality_flags = body.lead_quality_flags;
    // PHASE 6 — cap unbounded free-text fields to stop token-cost amplification.
    function _cap(v, max) { return typeof v === 'string' ? v.slice(0, max) : (v == null ? '' : String(v).slice(0, max)); }
    lead_notes = _cap(lead_notes, 8000);
    conversation_summary = _cap(conversation_summary, 8000);
    lead_quality_flags = _cap(lead_quality_flags, 1000);

    // ── Sawil 2026-07-09 SECURITY — server-side name validation ─────────────
    // The client validates names, but a direct POST bypasses it (proven in the
    // controlled test: "<script>x</script>" reached the CRM write path). Reject
    // markup/URL/control characters server-side. Legit names — apostrophes
    // (O'Brien), hyphens, accents (García, Peña) — pass untouched. Cap at 80.
    first_name = _cap(first_name, 80).trim();
    last_name = _cap(last_name, 80).trim();
    var _badNameRe = /[<>{}[\]\\`$;=|\u0000-\u001f]|https?:|script|javascript:/i;
    if ((first_name && _badNameRe.test(first_name)) || (last_name && _badNameRe.test(last_name))) {
      console.warn('[VALIDATION] Name rejected: disallowed characters/markup');
      leadAudit('validation_rejected', 400, { field: 'name' });
      return res.status(400).json({ error: 'Invalid name' });
    }

    // AUDIT 2026-07-03 Phase 1 — scrub PHI at the SOURCE variables so every
    // downstream sink is covered by construction: the Anthropic lead-intel call
    // (reads lead_notes/conversation_summary below), the GHL customField
    // contact.chat_conversation_summary, and the GHL note POST. Patterns are
    // conservative (SSN/MBI/HICN/card/routing/IBAN/9-digit); a 10-digit phone,
    // 5-digit ZIP, email, name and callback window pass through unchanged —
    // proven by scripts/phase1-phi-server.test.mjs. Log categories only (no PII).
    var _scrubNotes = scrubPHI(lead_notes);
    var _scrubSummary = scrubPHI(conversation_summary);
    var _scrubFlags = scrubPHI(lead_quality_flags);
    lead_notes = _scrubNotes.text;
    conversation_summary = _scrubSummary.text;
    lead_quality_flags = _scrubFlags.text;
    // Red-team FORMS-01-B3: the field also carries the server's AI verdict later; client
    // text is labelled and cannot carry verdict-shaped tokens.
    // Red-team round 3 (R3-SL-10): every dash variant and the underscore, and
    // "SOA" only as the tag family (never "soap"/"soar" in prose).
    lead_quality_flags = lead_quality_flags ? 'client: ' + lead_quality_flags.replace(/(?<![A-Za-z0-9_])(AI:|\bSOA(?:[\s_\p{Pd}]?(?:recorded|signed|pending|status|captured|\d+))?\b|DNC|DND|Temp[\s_\p{Pd}]\w+|Urg[\s_\p{Pd}]\w+|Intent[\s_\p{Pd}]\w+)/giu, '[x]') : '';
    var _phiCats = _scrubNotes.detected.concat(_scrubSummary.detected, _scrubFlags.detected);
    if (_phiCats.length > 0) {
      console.warn('[LEAD] PHI redacted before LLM/CRM: ' + Array.from(new Set(_phiCats)).join(','));
    }

    // ── 3.6 — input hardening (Grupo B) ─────────────────────────────────────
    // Reuse the existing _cap() helper — do NOT duplicate the phone validation,
    // honeypot, CORS, rate-limit, body cap or tag sanitization that already run
    // above/below. Valid inputs pass through unchanged. Invalid email/zip are
    // DROPPED (the lead is still captured — phone is the primary contact, and
    // the required-field + phone checks below still apply). Logs stay PII-free.
    first_name = _cap(first_name, 100).replace(/[\r\n\t]+/g, ' ').trim();
    last_name = _cap(last_name, 100).replace(/[\r\n\t]+/g, ' ').trim();
    city = _cap(city, 80).replace(/[\r\n\t]+/g, ' ').trim();
    county = _cap(county, 80).replace(/[\r\n\t]+/g, ' ').trim();
    email = _cap(email, 254).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // Invalid format — drop the email (never log its value). consent_email
      // below then naturally resolves to 'false' for an absent email.
      console.warn('[VALIDATION] Email dropped: invalid format');
      email = '';
    }
    // ZIP — normalize to a 5-digit US ZIP; drop anything else (US country only).
    var _zipDigits = typeof zip === 'string' ? zip.replace(/\D/g, '').slice(0, 5) : '';
    zip = (_zipDigits.length === 5) ? _zipDigits : '';

    // ── PHASE 11 — Clara Phase 10 audit/identity fields ─────────────────────
    // lead_type identifies which Clara path produced this lead.
    // ghl_contact_id (Path A matched): switch from POST create to PUT update.
    // ghl_assigned_user_id (Path A matched): assign the contact to advisor.
    // consent_text/hash/version/UA: TCPA audit-trail persistence.
    // AUDIT 2026-07-03 Phase 3 (lead completeness) — best_time_to_contact was
    // captured on every surface and silently dropped before the CRM; interest_type
    // arrived but was never read. Sanitize both, persist them as structured note
    // lines (survives custom-field mapping changes) and as filterable GHL tags.
    // No GHL custom-field ID exists for these today — inventing an ID would 400.
    // AUDIT 2026-09-13 (R4-HIPAA-01, P1) — these two land in the CRM note and the
    // conversation-summary field, and the live producer fills best_time_to_contact
    // with a free-text caller message. They are appended AFTER the PHI net ran, so
    // they carry it themselves — the same treatment consent_text and the signer
    // user agent already get.
    var best_time_to_contact = scrubPHI(_cap(body.best_time_to_contact, 64)).text.replace(/[\r\n\t]+/g, ' ').trim();
    var interest_type = scrubPHI(_cap(body.interest_type, 80)).text.replace(/[\r\n\t]+/g, ' ').trim();
    var intakeBits = [];
    if (best_time_to_contact) intakeBits.push('Best time to contact: ' + best_time_to_contact);
    if (interest_type) intakeBits.push('Interest/topic: ' + interest_type);
    if (intakeBits.length > 0) {
      lead_notes = (lead_notes ? lead_notes + '\n\n' : '') + '— Intake —\n' + intakeBits.join('\n');
    }
    //
    // RED TEAM ROUND 5 (R5-SL-13, P3). scrubPHI deliberately lets a 10-digit
    // phone through — it is documented above — and these two fields are appended
    // AFTER the main PHI net, so a phone typed into "best time to contact" was
    // minted as a CRM tag NAME: CallTime-9175550123, visible in every tag list
    // and every workflow filter. A digit run of 4 or more is never a call time
    // or an interest, so the tag is refused outright rather than half-masked.
    //
    // RED TEAM ROUND 5 (R5-SL-14, P4). The old character class DELETED every
    // accented letter, so on the Spanish path "Mañana" became "Maana" and
    // "Atención médica" became "Atencin mdica" — mojibake tags on half the leads
    // this bilingual site serves. Accents are folded to their Latin base now.
    function _tagify(prefix, v) {
      var raw = String(v || '');
      // Four consecutive digits, or seven across separators, is an identifier —
      // a phone, a member number, a date — never a call time or an interest.
      if (/\d{4,}/.test(raw) || /(?:\d[\s.()-]{0,2}){7,}/.test(raw)) return '';
      var t = foldToken(raw).replace(/[^a-zA-Z0-9 -]/g, '').trim().replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      return t ? prefix + '-' + t : '';
    }
    var _bestTimeTag = _tagify('CallTime', best_time_to_contact);
    var _interestTag = _tagify('Interest', interest_type);

    // Red-team round 3 (R3-SL-05): LeadType-* is a server-owned family — only the
    // lead types Clara and the forms actually produce may mint one.
    //
    // RED TEAM ROUND 5 (R5-SL-06, P2, regression). Round 4 learned that an
    // allow-list has to hold the strings the front end actually sends, and
    // applied that lesson to lead_source only. lead_type kept a list that
    // matched NONE of the six values Smart Medicare Review emits, so the whole
    // surface silently lost its LeadType-* routing tag: MA_LEAD, PDP_LEAD,
    // COST_REVIEW_TRIAGE, NEEDS_TRIAGE, MEDIGAP_REVIEW and
    // LOW_PRIORITY_EDUCATION_REQUEST all normalised to '' and no tag was
    // written. Before the allow-list existed they produced LeadType-MA_LEAD.
    // The six come from LEAD_TYPE_TAG in src/lib/smartReviewRouting.ts.
    var LEAD_TYPES = ['existing_client_inquiry', 'existing_client_unverified', 'qualified_prospect', 'out_of_scope_optin_callback', 'out_of_service_area_interest', 'smart_review', 'contact_form', 'zara_education',
      'ma_lead', 'pdp_lead', 'cost_review_triage', 'needs_triage', 'medigap_review', 'low_priority_education_request'];
    var lead_type = (function (v) {
      var s = typeof v === 'string' ? v.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() : '';
      return LEAD_TYPES.indexOf(s) !== -1 ? s : '';
    })(body.lead_type);
    // ── AUDIT 2026-08-15 (authorization gap — independent red-team F1) ─────────
    // FINDING: the handler trusted a client-supplied ghl_contact_id to PUT-
    // OVERWRITE that CRM contact (name/phone/email/DOB) AND flip its
    // consent_marketing/sms/calls/email flags to 'true' — i.e. an unauthenticated
    // POST could FALSIFY TCPA consent on a THIRD PARTY and reassign ownership via
    // the equally-unchecked ghl_assigned_user_id. There is NO check that the id
    // belongs to the submitter.
    //
    // WHY IT IS SAFE TO NEUTRALIZE NOW: the ONLY legitimate producer of these
    // fields is Clara's verified-existing-client path, whose id comes from
    // /api/lookup-client — and that endpoint is HARD-DISABLED in production
    // (LOOKUP_ENABLED=false → genericLookup, returns no contactId). So no
    // legitimate traffic supplies ghl_contact_id today; the trusted source is
    // dead while the privileged sink still trusted raw client input. GHL already
    // dedupes by phone, so ignoring these and taking the normal create/upsert
    // path loses NOTHING functionally.
    //
    // FAIL CLOSED: ignore both client-echoed ids. If one is present it is an
    // abuse signal (or a stale cached bundle) — log it, drop it, continue as a
    // normal create. RE-ENABLING the verified path must NOT flip a flag here:
    // it must pass a SERVER-ISSUED, short-lived signed token that binds the
    // contact id to a verified phone match — never a raw client id.
    var _rawContactId = typeof body.ghl_contact_id === 'string' ? body.ghl_contact_id.slice(0, 64).replace(/[^a-zA-Z0-9-]/g, '') : '';
    var _rawAssignedUserId = typeof body.ghl_assigned_user_id === 'string' ? body.ghl_assigned_user_id.slice(0, 64).replace(/[^a-zA-Z0-9-]/g, '') : '';
    if (_rawContactId || _rawAssignedUserId) {
      console.warn('[SECURITY] client-supplied ghl_contact_id/ghl_assigned_user_id ignored (unverified — no signed binding). Treating as a normal create.');
      // status:null — advisory mid-request event, not a terminal outcome; the
      // request continues and its final outcome is logged separately.
      leadAudit('client_contact_id_ignored', null, { had_contact_id: !!_rawContactId, had_assigned_user: !!_rawAssignedUserId });
    }
    var ghl_contact_id = '';
    var ghl_assigned_user_id = '';
    // AUDIT 2026-09-03 (R2-C16, P1) — consent_text is client-supplied and was
    // appended to the CRM note AFTER the scrubPHI point on the assumption it is
    // the fixed canonical TCPA string. An unauthenticated direct POST could put
    // arbitrary text — an SSN/MBI, other PHI, or advisor-directed injection —
    // verbatim into the GHL note, bypassing the PHI net. Scrub it too: a no-op
    // for the genuine canonical string (it carries no PHI), a redaction for a
    // hostile payload. Same treatment for signer_user_agent.
    var consent_text = scrubPHI(_cap(body.consent_text, 4000)).text;
    var consent_receipt_hash = typeof body.consent_receipt_hash === 'string' ? body.consent_receipt_hash.slice(0, 128).replace(/[^a-f0-9]/g, '') : '';
    var disclaimer_version = typeof body.disclaimer_version === 'string' ? body.disclaimer_version.slice(0, 32).replace(/[^a-zA-Z0-9._-]/g, '') : '';
    var signer_user_agent = scrubPHI(_cap(body.signer_user_agent, 240)).text;
    // Append the audit-trail receipt to lead_notes so it survives even if
    // GHL custom-field mapping changes. PII-free (only hash + version + UA).
    if (consent_receipt_hash || disclaimer_version) {
      var receiptBits = [];
      // AUDIT 2026-07-03 (compliance) — persist the FULL 64-char digest, not a
      // 16-char prefix: a truncated hash cannot verify a later-supplied text.
      if (consent_receipt_hash) receiptBits.push('sha256=' + consent_receipt_hash);
      if (disclaimer_version) receiptBits.push('disclaimer=' + disclaimer_version);
      if (signer_user_agent) receiptBits.push('ua=' + signer_user_agent.slice(0, 60));
      // AUDIT 2026-09-12 (TCPA-02, P2) — a consent record without WHEN, FROM WHERE
      // and ON WHICH PAGE is hard to defend. Server clock (authoritative), the
      // rate-limit client id (trusted proxy chain, never the raw header), and the
      // client-reported path (sanitized to a plain path, no query string).
      receiptBits.push('at=' + new Date().toISOString());
      receiptBits.push('ip=' + (/^[0-9a-f:.]{3,45}$/i.test(String(ip || '')) ? String(ip) : 'unavailable'));
      // Red-team round 3 (R3-SL-13): decode FIRST, then re-parse so percent-encoded
      // traversal normalises, and REJECT anything that is not a plain in-site path
      // (a mangled path is worse evidence than none).
      var page_url = '';
      try {
        if (typeof body.page_url === 'string' && body.page_url.trim()) {
          var _raw = body.page_url.slice(0, 400);
          try { _raw = decodeURIComponent(_raw); } catch (_d) { /* keep raw */ }
          // RED TEAM ROUND 5 (R5-SL-17, P4). Resolving a RELATIVE string against
          // the production origin turned "contact" into
          // "https://clearpointsenioradvisors.com/contact" — a receipt recording
          // a page the browser never visited, which is worse evidence than none.
          // And the WHATWG parser silently deletes tabs and newlines, so a path
          // carrying control characters was rewritten into a clean-looking one
          // before the charset test ever saw it. A path must LOOK like a path
          // before it is parsed, and control characters disqualify it outright.
          if (!/^https?:\/\//i.test(_raw) && _raw.charAt(0) !== '/') throw new Error('not_a_path');
          if (/[\u0000-\u001f\u007f]/.test(_raw)) throw new Error('control_chars');
          var _pu = new URL(_raw, 'https://clearpointsenioradvisors.com');
          var _path = _pu.pathname;
          try { _path = decodeURIComponent(_path); } catch (_d2) { /* keep raw */ }
          _path = _path.replace(/\/{2,}/g, '/');
          if (_pu.origin === 'https://clearpointsenioradvisors.com' && /^\/[A-Za-z0-9/_.-]{0,119}$/.test(_path) && _path.indexOf('..') === -1 && _raw.indexOf('..') === -1) page_url = _path;
        }
      } catch (_e) { page_url = ''; }
      if (page_url) receiptBits.push('page=' + page_url);
      // Red-team round 3 (R3-SL-07): a story may contain a look-alike receipt
      // header. Neutralise it so only the server's block reads as the receipt.
      if (lead_notes) lead_notes = String(lead_notes).replace(/—\s*(TCPA Receipt|Consent Text)\s*—?/gi, '- $1 -');
      lead_notes = (lead_notes ? lead_notes + '\n\n' : '') + '— TCPA Receipt — ' + receiptBits.join(' · ');
      // AUDIT 2026-07-03 (compliance) — persist the VERBATIM consent language per
      // lead so the 10-year TCPA record is self-contained in the CRM (previously
      // only hash+version survived; the text itself was captured then discarded).
      // consent_text is the fixed canonical TCPA string (no PHI), appended AFTER
      // the scrub point by design.
      if (consent_text) {
        lead_notes += '\n— Consent Text (verbatim' + (disclaimer_version ? ', v' + disclaimer_version : '') + ') —\n' + consent_text;
      }
    }

    var frontendTags = [];
    var _rejectedTags = 0;
    var _malformedTags = 0;
    var _truncatedTags = 0;   // R5-SL-16: tags dropped by the 20-tag cap
    // Red-team round 3 (R3-SL-04): the deny check runs on a SEPARATOR-FREE key, so
    // "ConsentCaptured", "Status–NewLead" (en dash), "consent_captured-" and
    // "STATUS NEW LEAD" all collapse to the same family name.
    // Round-3 follow-up (FORMS-01): "Do Not Call" and "Status-Enrolled" drive the
    // same suppression and reporting as the families already owned by the server.
    //
    // RED TEAM ROUND 5 (R5-SL-07, P2). Denying the whole `consent` and `lang`
    // FAMILIES took out six of the support bot's ten controlled tags, including
    // consent_no — the bot's explicit "the caller did NOT consent" marker. The
    // server only ever ADDS "Consent Captured" when consent is true and never
    // records a negative, so denying consent_no destroyed the only
    // negative-consent signal reaching the CRM. That is the opposite of what a
    // TCPA deny-list is for. The families are now anchored to the SERVER's own
    // spellings; the bot's descriptive values are namespaced and cannot collide
    // with "Consent Captured" or "Lang-ES". The `soa` key is also tightened so
    // ordinary words that start with those three letters survive — "soap-note"
    // and "soar-program" were being denied as SOA workflow tags.
    var _denyKeys = /^(statusnewlead|statuscontacted|statusdnc|statusnoshow|statusappointmentbooked|statusenrolled|statussoa[a-z0-9]*|consentcaptured|consentrevoked|consentyes|consentpending|donotcall|donotcontact|donotmail|donottext|nollamar|dnc[a-z0-9]*|dnd|soa|soasigned|soarecorded|soapending|soa[0-9][a-z0-9]*|temphot|tempwarm|tempcold|aiflagged|highpriority|warmlead|enrolled|unsubscribe[a-z0-9]*)$/;
    // Family prefixes are matched on the DASH key, so the family has to be a real
    // token: "urg-high" is denied, the support bot's "urgency_elevated" is not.
    // "status-*" is deliberately absent — only its exact values above are owned,
    // so status_existing_client_claimed keeps flowing.
    // R5-SL-07: `consent-` and `lang|language-` left this list; their exact
    // server spellings are in _denyKeys above, and the server-generated tags are
    // appended after this filter so a client cannot forge one either way.
    var _denyFamilyPrefix = /^(cp|soa|dnc|dnd|temp|urg|intent|utm|source|leadtype|outcome|compliance)-/;
    if (Array.isArray(body.tags)) {
      // RED TEAM ROUND 5 (R5-SL-16, P4): the loop used to stop at the cap, so
      // tags past the twentieth vanished without being counted and the audit line
      // reported zero losses while data disappeared. The whole array is walked
      // (the 64KB body cap already bounds it) and the overflow is counted.
      for (var i = 0; i < body.tags.length; i++) {
        if (frontendTags.length >= 20) { if (body.tags[i] != null) _truncatedTags++; continue; }
        var tag = body.tags[i];
        // AUDIT 2026-09-12/13 (FORMS-01 + red-team R1/B2/N2) — client-supplied tags may
        // only DESCRIBE the lead (interest, call time, category, state, audience,
        // channel labels). Workflow / consent / SOA / status / AI-verdict / UTM / language
        // / source / lead-type families are SERVER-OWNED and are dropped here after
        // normalisation (lower-case, [space _ -] runs collapsed to one dash).
        if (typeof tag === 'string') {
          tag = tag.trim();
          var _norm = tag.toLowerCase().replace(/[\s_-]+/g, '-');
          // Red-team FORMS-01-FP1: exact server-owned / compliance families only, so the
          // support bot's descriptive vocabulary (status_existing_client_claimed,
          // urgency_elevated, confidence_high, category_billing, …) keeps flowing.
          var _dashKey = foldToken(tag).toLowerCase().replace(/[\s_‐-―−-]+/g, '-').replace(/^-+|-+$/g, '');
          var _flatKey = _dashKey.replace(/-/g, '');
          var _denied = _denyKeys.test(_flatKey) || _denyFamilyPrefix.test(_dashKey);
          if (tag && tag.length <= 64 && /^[a-zA-Z0-9 _-]+$/.test(tag) && !_denied) frontendTags.push(tag);
          else if (_denied) _rejectedTags++;
          else if (tag) _malformedTags++;   // charset / length / newline gate (R3-SL-12)
        } else if (body.tags[i] != null) { _malformedTags++; }
      }
    }
    if (_rejectedTags || _malformedTags || _truncatedTags) leadAudit('tags_rejected', null, { n: _rejectedTags + _malformedTags + _truncatedTags, denied: _rejectedTags, malformed: _malformedTags, truncated: _truncatedTags });
    var allTags = ['Status-NewLead'];
    for (var j = 0; j < frontendTags.length; j++) { if (allTags.indexOf(frontendTags[j]) === -1) allTags.push(frontendTags[j]); }

    // Sawil 2026-06-30 AUDIT FIX C2 — Clara's "verified existing client" path
    // (Path A matched) submits with phone:'' because the phone is already on file
    // in GHL; it carries a sanitized ghl_contact_id and updates that contact via
    // PUT. The old check 400'd it → every highest-intent verified-client inquiry
    // was silently dropped while the UI showed success. Require name+phone ONLY
    // when there is NO verified contact id to update.
    if (!ghl_contact_id && (!first_name || !phone)) {
      leadAudit('validation_rejected', 400, { field: 'required' });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ── Server-side U.S. phone validation (mirrors src/lib/validation.ts) ────────
    // Inline JS version — cannot import TypeScript modules in Vercel serverless functions
    var SERVER_US_AREA_CODES = new Set([
      205,251,256,334,938,907,480,520,602,623,928,479,501,870,
      209,213,279,310,323,341,408,415,424,442,510,530,559,562,
      619,626,628,650,657,661,669,707,714,747,760,805,818,820,
      831,840,858,909,916,925,949,951,
      303,719,720,970,203,475,860,959,202,302,
      239,305,321,352,386,407,448,561,689,727,754,772,786,813,
      850,863,904,941,954,
      229,404,470,478,678,706,762,770,912,808,208,986,
      217,224,309,312,331,447,464,618,630,708,730,773,779,815,847,872,
      219,260,317,463,574,765,812,930,319,515,563,641,712,
      316,620,785,913,270,364,502,606,859,225,318,337,504,985,207,
      240,301,410,443,667,339,351,413,508,617,774,781,857,978,
      231,248,269,313,517,586,616,679,734,810,906,947,989,
      218,320,507,612,651,763,952,228,601,662,769,
      314,417,557,573,636,660,816,406,308,402,531,702,725,775,603,
      201,551,609,640,732,848,856,862,908,973,505,575,
      212,315,332,347,516,518,585,607,631,646,680,716,718,838,845,914,917,929,934,
      252,336,704,743,828,910,919,980,984,701,
      216,220,234,283,330,380,419,440,513,567,614,740,937,
      405,539,580,918,458,503,541,971,
      215,223,267,272,412,445,484,570,582,610,717,724,814,878,401,
      803,843,854,864,605,423,615,629,731,865,901,931,
      210,214,254,281,325,346,361,409,430,432,469,512,682,713,
      726,737,806,817,830,832,903,915,936,940,945,956,972,979,
      385,435,801,802,276,434,540,571,703,757,804,
      206,253,360,425,509,564,304,681,262,414,534,608,715,920,307,
      // Sawil 2026-06-20 — U.S. TERRITORIES (must mirror src/lib/validation.ts).
      // Puerto Rico 787/939 etc. are valid U.S. phone numbers. Without these the
      // client accepted a 787 but THIS server 400'd it → "No pudimos enviar su
      // solicitud" (live lead-loss). Service area stays ZIP-gated (NY/NJ/CT),
      // never by phone area code.
      787,939,340,671,670,684
    ]);
    function serverValidatePhone(raw) {
      if (!raw) return { valid: false, reason: 'Phone missing' };
      var s = String(raw).trim();
      if (s.startsWith('+') && !s.startsWith('+1')) return { valid: false, reason: 'Non-US country code' };
      var digits = s.replace(/\D/g, '');
      var national = (digits.length === 11 && digits[0] === '1') ? digits.slice(1) : digits;
      if (national.length !== 10) return { valid: false, reason: 'Must be 10 digits' };
      var areaCode = parseInt(national.slice(0, 3), 10);
      var exchange = national[3];
      if (exchange === '0' || exchange === '1') return { valid: false, reason: 'Invalid exchange' };
      if (!SERVER_US_AREA_CODES.has(areaCode)) return { valid: false, reason: 'Not a valid U.S. area code: ' + areaCode };
      if (/^(\d)\1{9}$/.test(national)) return { valid: false, reason: 'Phone appears fake' };
      if (['1234567890','0987654321','9876543210','0123456789'].includes(national)) return { valid: false, reason: 'Phone appears fake' };
      if (/(\d)\1{6,}/.test(national)) return { valid: false, reason: 'Phone appears fake' };
      // Sawil 2026-06-29 SECURITY HOTFIX (finding 03) — mirror the client
      // validator (src/lib/validation.ts) for 555, PLUS known fictional numbers
      // the audit flagged that pass NANP structure. The server was missing all
      // of these, so 212-555-0100 and 212-867-5309 reached the CRM.
      if (/^\d{3}555(1234|9999|0000|1212|5555|4321|1111|2222|3333|4444|6666|7777|8888|0100|0199)$/.test(national)) return { valid: false, reason: 'Phone appears fake (555 hollywood)' };
      if (/^\d{3}55501\d\d$/.test(national)) return { valid: false, reason: 'Phone appears fake (555 fictional 0100-0199)' };
      if (/^555/.test(national)) return { valid: false, reason: 'Phone appears fake (555 area code)' };
      if (national.slice(3) === '8675309') return { valid: false, reason: 'Phone appears fake (867-5309)' };
      // AUDIT 2026-09-14 (FORMS-07, P3) — the server was weaker than the client it
      // is supposed to mirror: ANY 555 exchange is the fictional range, a number
      // built from two distinct digits is not real, and an 8-digit ascending or
      // descending run is a keyboard walk. The client rejected all three; the
      // server accepted them, so a direct POST wrote them to the CRM.
      if (national.slice(3, 6) === '555') return { valid: false, reason: 'Phone appears fake (555 exchange)' };
      if (new Set(national.split('')).size <= 2) return { valid: false, reason: 'Phone appears fake (too few distinct digits)' };
      var asc = '01234567890123456789';
      var desc = '98765432109876543210';
      for (var w = 0; w + 8 <= national.length; w++) {
        var run = national.slice(w, w + 8);
        if (asc.indexOf(run) !== -1 || desc.indexOf(run) !== -1) return { valid: false, reason: 'Phone appears fake (sequential digits)' };
      }
      return { valid: true, national: national };
    }
    // Sawil 2026-06-30 AUDIT FIX C2 — validate phone ONLY when one was provided.
    // A verified-client update (ghl_contact_id present, phone:'') legitimately has
    // no phone in the payload; the existing GHL contact already holds it. Any phone
    // that IS provided is still fully validated (territories + 555/867-5309 fakes).
    var phone10 = '';
    var phoneE164 = '';
    if (phone) {
      var phoneValidation = serverValidatePhone(phone);
      if (!phoneValidation.valid) {
        // Privacy: log validation reason only — never the raw phone number.
        console.warn('[VALIDATION] Phone rejected: ' + phoneValidation.reason);
        leadAudit('validation_rejected', 400, { field: 'phone', reason: String(phoneValidation.reason || '').slice(0, 60) });
        return res.status(400).json({ error: 'Invalid U.S. phone number', reason: phoneValidation.reason });
      }
      phone10 = phoneValidation.national;
      phoneE164 = '+1' + phone10;
    }

    // ── Sawil 2026-07-09 SECURITY — layered anti-abuse on the validated identity ──
    // (1) Minimum-fill-time gate: real seniors take well over 3s to complete the
    //     form. When the client supplies elapsed_ms (LeadForm sends it) and it is
    //     implausibly low, treat as bot: benign success response, no CRM write —
    //     identical posture to the honeypot so bots learn nothing. Surfaces that
    //     don't send elapsed_ms (Zara/Clara/SmartReview, older cached bundles) are
    //     unaffected — the gate only runs when the field is present.
    var _elapsed = Number(body.elapsed_ms);
    if (Number.isFinite(_elapsed) && _elapsed >= 0 && _elapsed < 3000) {
      console.warn('[ANTI-BOT] Min-fill-time gate triggered (' + Math.round(_elapsed) + 'ms) — submission discarded');
      leadAudit('minfill_discarded', 200, {});
      return res.status(200).json({ success: true, message: 'Received' });
    }
    // ── AUDIT 2026-08-15 (remediation target 1) — Cloudflare Turnstile ────────
    // Server-side challenge verification; the client attaches turnstile_token in
    // src/lib/ghl.ts. Inert until TURNSTILE_SECRET is set ('off'); 'shadow'
    // verifies and logs but never blocks (rollout observation); 'enforce'
    // REQUIRES a valid token and FAILS CLOSED — including when siteverify is
    // unreachable. Placed AFTER the free local gates (honeypot, min-fill,
    // validation) so bots pay before we spend an outbound call, and BEFORE the
    // strict rate-limit tiers, the lead-intel LLM call and every CRM write, so
    // an unverified submission never consumes the human quota, never costs
    // tokens, and never reaches GHL.
    var _tsMode = turnstileMode();
    if (_tsMode !== 'off') {
      var _tsToken = typeof body.turnstile_token === 'string' ? body.turnstile_token : '';
      var _tsResult = await verifyTurnstile(_tsToken, ip);
      if (!_tsResult.ok) {
        // codes are Cloudflare's own identifiers (e.g. timeout-or-duplicate,
        // invalid-input-response) — operational signal, never PII.
        console.warn('[ANTI-BOT] Turnstile verification failed (' + _tsMode + '): ' + _tsResult.codes.join(','));
        if (_tsMode === 'enforce') {
          leadAudit('challenge_rejected', 403, { codes: _tsResult.codes, transient: _tsResult.transient === true });
          return res.status(403).json({
            error: 'CHALLENGE_FAILED',
            message: 'We could not verify your submission. Please try again, or call us at 1-855-720-8555.',
          });
        }
      } else if (_tsMode === 'shadow') {
        console.log('[ANTI-BOT] Turnstile shadow verification passed');
      }
    }
    // ── CP-06 (2026-08-13) — TIER 2: the strict business limit ────────────────
    // This is the 5/hour the published policy advertises, and it is charged HERE:
    // after the honeypot, after the min-fill-time gate, and after phone/name/ZIP
    // validation have all passed. So the quota is spent on submissions that were
    // real and well-formed, never on a senior's typo or a mobile retry — which was
    // the whole finding. Tier 1 above (40/hour, pre-parse) still absorbs floods, so
    // moving this later costs no flood protection.
    var rlStrict = await rateLimit(ip, { max: 5, windowMs: 60 * 60 * 1000, prefix: 'lead-ok-h' });
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rlStrict.remaining != null ? rlStrict.remaining : 0)));
    if (!rlStrict.ok) {
      res.setHeader('Retry-After', String(rlStrict.retryAfter));
      console.warn('[RATE-LIMIT] strict per-IP submission window exceeded');
      leadAudit('rate_limited', 429, { tier: 'strict_hour' });
      return res.status(429).json({ error: 'Too many submissions, try again later' });
    }
    var rlStrictDay = await rateLimit(ip, { max: 10, windowMs: 24 * 60 * 60 * 1000, prefix: 'lead-ok-d' });
    if (!rlStrictDay.ok) {
      res.setHeader('Retry-After', String(rlStrictDay.retryAfter));
      leadAudit('rate_limited', 429, { tier: 'strict_day' });
      return res.status(429).json({ error: 'Daily submission limit reached' });
    }

    // (2) Per-phone rate limit (3/hour) + per phone+ZIP (5/hour): stops one actor
    //     rotating IPs to spam the same identity. Keyed on the VALIDATED national
    //     number — never logged raw; the limiter stores only prefixed keys.
    if (phone10) {
      var rlPhone = await rateLimit(phone10, { max: 3, windowMs: 60 * 60 * 1000, prefix: 'lead-ph' });
      var rlPhoneZip = await rateLimit(phone10 + ':' + (zip || 'nozip'), { max: 5, windowMs: 60 * 60 * 1000, prefix: 'lead-pz' });
      if (!rlPhone.ok || !rlPhoneZip.ok) {
        // Generic response — reveal no internal logic. Retry-After lets legit
        // callers (and the UI) know it is temporary.
        res.setHeader('Retry-After', String((rlPhone.retryAfter || rlPhoneZip.retryAfter || 3600)));
        console.warn('[RATE-LIMIT] per-phone window exceeded (key hashed, not logged)');
        leadAudit('rate_limited', 429, { tier: 'phone' });
        return res.status(429).json({ error: 'Too many submissions, try again later' });
      }
    }
    // ── PHASE A17 — Lead Intelligence Pass ─────────────────────────────────
    // AUDIT 2026-09-12 (FORMS-02, P2) — moved BELOW required-field validation,
    // the min-fill bot gate, Turnstile and the strict/per-phone rate limits: an
    // unauthenticated flood used to trigger a paid LLM call per request before
    // any of those gates ran.
    // One additional Haiku call to enrich the lead BEFORE it lands in GHL.
    // The advisor opens the contact and sees a structured summary, temperature,
    // and recommended first questions — no need to read the full transcript.
    //
    // Graceful: if the call fails (no key, network, timeout), `intel` is
    // null and we proceed with the raw notes only.
    var intel = null;
    try {
      intel = await analyzeLeadIntelligence({
        // AUDIT 2026-09-12 (FORMS-04, P2) — the enrichment model needs the STORY,
        // not the identity: strip name / phone / email / DOB before the call.
        leadNotes: scrubIdentityForIntel((lead_notes || conversation_summary || '').toString(), [first_name, last_name, phone, email], date_of_birth),
        language: preferred_language || 'en',
        source: lead_source || 'unknown',
        // AUDIT 2026-09-13 (R4-HIPAA-02, P1) — the identity scrub above is
        // pointless if the same request re-supplies two HIPAA Safe-Harbor
        // identifiers beside it. The advisor context the model needs is the
        // area and the age band, not the ZIP5 and the exact age.
        metadata: {
          zipCode: String(zip || '').slice(0, 3),
          state: derived_state,
          age: (function (a) {
            var n = Number(a);
            if (!isFinite(n) || n <= 0) return '';
            if (n >= 90) return '90+';
            var lo = Math.floor(n / 5) * 5;
            return lo + '-' + (lo + 4);
          })(age || calculated_age),
          // R5-SL-02: the TOKEN, never the caller's own words — this line sits
          // directly above the notes delimiter in the model's payload.
          medicareStatus: medicare_status_token,
        },
      });
    } catch (e) {
      console.warn('[submit-lead] intel call exception (continuing without)', e && e.message);
    }
    if (intel) {
      var intelText = formatIntelForGhlNotes(intel);
      lead_notes = (lead_notes || '').toString().trimEnd() + (intelText ? '\n' + intelText : '');
      // Append a lead-quality flag so GHL workflows can route by temperature.
      var tempTag = 'Temp-' + (intel.lead_temperature || 'cold');
      var urgTag = 'Urg-' + (intel.urgency || 'low');
      lead_quality_flags = (lead_quality_flags ? lead_quality_flags + '; ' : '') +
        'AI: ' + tempTag + '/' + urgTag + ' (intent ' + intel.intent_strength + '/10)';
    }

    // (3) submission_id — PII-free idempotency/trace key (phone+zip+UTC-hour digest).
    //     Logged and returned so a lead can be traced end-to-end without exposing PII.
    var submission_id = '';
    try {
      var _sidRaw = phone10 + '|' + (zip || '') + '|' + new Date().toISOString().slice(0, 13);
      var _sidBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_sidRaw));
      submission_id = Array.from(new Uint8Array(_sidBuf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
      console.log('[LEAD] submission_id=' + submission_id);
    } catch (_e) { /* non-fatal — tracing only */ }

    var contact = {
      locationId, firstName: first_name, lastName: last_name || '',
      phone: phoneE164 || undefined, email: email || undefined,
      city: city || undefined,
      state: derived_state || undefined,
      postalCode: zip || undefined,
      dateOfBirth: date_of_birth || undefined,
      country: 'US',
      source: 'ClearPoint Website',
      address1: county || undefined,
      // Compliance / TCPA — consent flags must reflect what the user actually
      // agreed to. Never hardcode 'true' (that would record falsified consent
      // for every lead). Derive each flag strictly from the submitted body.
      // Only the literal boolean true counts; truthy strings ('true', '1') are
      // intentionally NOT accepted, to avoid silent client-side coercion bugs.
      // If the body does not clearly provide consent for a channel, default
      // to 'false'. consent_to_contact is the unified TCPA consent covering
      // marketing calls + SMS (per displayed consent text on the form).
      customFields: [
        { id: 'QULAmkAuVNCQrAMZ487K', key: 'contact.preferred_language', value: preferred_language || 'en' },
        { id: 'R510tHz6GFBaqZgN5e5S', key: 'contact.medicare_status', value: medicare_status || '' },
        { id: 'vPKlhpz6aucJK1U3fJRZ', key: 'contact.consent_marketing', value: ((body.consent === true) || (body.consent_to_contact === true)) ? 'true' : 'false' },
        { id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms',       value: ((body.consent_sms === true) || (body.consent_to_contact === true)) ? 'true' : 'false' },
        { id: 'mHdpDjBSA76lQJrKoixL', key: 'contact.consent_calls',     value: ((body.consent_call === true) || (body.consent_calls === true) || (body.consent_to_contact === true)) ? 'true' : 'false' },
        // AUDIT 2026-07-23 (GHL-02) — email consent must come from the affirmative
        // TCPA consent (same gate as calls/sms), NOT from the mere presence of an
        // email address. Recorded true only when the caller both provided an email
        // AND checked the consent box.
        { id: 'ykiTUcsu3nvawK39hmll', key: 'contact.consent_email', value: (email && body.consent_to_contact === true) ? 'true' : 'false' },
        { id: 'GSss3tRLKg8mNCzEv3D9', key: 'contact.client_age', value: age || '' },
        { id: 'HoYmwc19InLwUwXNyKcr', key: 'contact.calculated_age', value: calculated_age != null ? String(calculated_age) : '' },
        { id: 'qGryQuR67jXFFVRFBLkz', key: 'contact.lead_quality_flags', value: lead_quality_flags || '' },
        { id: '6vSP5DJvAc6Jl9BXg409', key: 'contact.chat_conversation_summary', value: lead_notes || '' },
        // Sawil 2026-07-04 — populate the Best Time / Interest custom fields created
        // in GHL this session. Previously these lived only in notes + CallTime-/Interest-
        // tags because no field id existed (see intake comment above). Both are TEXT, so
        // free-form values carry no dropdown 400-risk on the revenue path. Empty values
        // are dropped by the filter below (so a lead without either still submits fine).
        { id: 'PpDDusEEsMz4xNIcrwRW', key: 'contact.best_time_to_call', value: best_time_to_contact || '' },
        { id: 'fLxx7s1GpVJYlxJl08G6', key: 'contact.medicare_interest', value: interest_type || '' }
      ].filter(function (f) { return f.value; }),
      tags: ['Status-NewLead','Lang-'+((preferred_language||'en').toUpperCase()),'Source-Web']
        .concat(_bestTimeTag?[_bestTimeTag]:[])
        .concat(_interestTag?[_interestTag]:[])
        .concat((function () { var u = String(utm_source || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32); return u ? ['UTM-' + u] : []; })())
        // Red-team FORMS-01-R1: 'Consent Captured' is derived from the validated consent flag, never from a client tag.
        .concat(body.consent_to_contact === true ? ['Consent Captured'] : [])
        .concat(allTags.filter(function(t){return t!=='Status-NewLead'&&t.indexOf('Lang-')!==0&&t!=='Source-Web';}))
        // PHASE A16 — SOA status tags so advisor pipelines can filter on them.
        // Red-team FORMS-01-B1: SOA-* tags come only from a server-verified SOA record (SOA is disabled; client booleans are ignored).
        .concat(lead_source ? ['Source-' + lead_source] : [])
        // PHASE A17 — Lead-intel tags. Empty arrays if intel unavailable.
        .concat(intel ? ['Temp-' + intel.lead_temperature, 'Urg-' + intel.urgency, 'Intent-' + intel.intent_strength] : [])
        .concat(intel && intel.compliance_flags && intel.compliance_flags.length ? ['AI-Flagged'] : []),
    };

    // PHASE 11 — Lead type tag for queryability + assigned user routing.
    if (lead_type) {
      try { contact.tags = (contact.tags || []).concat(['LeadType-' + lead_type]); } catch (_t) { /* swallow */ }
    }
    if (ghl_assigned_user_id) {
      contact.assignedTo = ghl_assigned_user_id;
    }
    // PHASE 11 — Path A matched flow: update existing GHL contact instead
    // of creating a duplicate. Falls back to POST create if PUT fails.
    var ghlRes;
    var usedExisting = false;
    if (ghl_contact_id) {
      ghlRes = await ghlFetchRetry('https://services.leadconnectorhq.com/contacts/' + ghl_contact_id, {
        method: 'PUT',
        headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
        body: JSON.stringify(contact)
      });
      if (ghlRes.ok) { usedExisting = true; }
      // If PUT 404s (stale id), fall through to POST create below.
    }
    if (!ghlRes || !ghlRes.ok) {
      ghlRes = await ghlFetchRetry('https://services.leadconnectorhq.com/contacts/', {
        method: 'POST',
        headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
        body: JSON.stringify(contact)
      });
    }
    void usedExisting; // available for downstream conditional logic if needed
    // AUDIT 2026-08-13 (O-05) — true when this submission matched an EXISTING
    // contact and we refreshed it instead of dropping the request.
    var _repeatRequest = false;
    if (!ghlRes.ok) {
      // Sawil 2026-06-29 SECURITY HOTFIX (finding 19) — sanitize CRM errors and
      // handle duplicates. NEVER leak the upstream status/detail/body to the
      // client. Detect GHL's duplicate-contact rejection and return a clean 409.
      var _ghlErrBody = '';
      try { _ghlErrBody = await ghlRes.text(); } catch (e) { _ghlErrBody = ''; }
      var _isDuplicate = ghlRes.status === 400 && /duplicat/i.test(_ghlErrBody);
      // Privacy: log status + duplicate-flag ONLY — never the body (may echo PII).
      console.error('[GHL] Contact creation failed: HTTP ' + ghlRes.status + (_isDuplicate ? ' (duplicate)' : ''));
      if (_isDuplicate) {
        // ── AUDIT 2026-08-13 (O-05, P1) ────────────────────────────────────
        // Returning here DISCARDED the new request. A prospect who submitted
        // three weeks ago, was never reached, and submits again today with a
        // different best-time-to-call and a fresh consent got a friendly
        // "we already have your request" and nothing was recorded: the note
        // block and the opportunity block both sit BELOW this return, so the
        // advisor never learned they asked again. A duplicate is the SIGNAL
        // that they are still waiting — not an error to swallow.
        //
        // Resolve the existing contact so the note/opportunity logic below runs
        // against it. Fail-safe: if the id cannot be resolved we fall back to
        // the original 409 rather than guessing.
        var _dupId = '';
        try {
          var _q = phone10 || email || '';
          if (_q) {
            var _dupRes = await ghlFetchRetry(
              'https://services.leadconnectorhq.com/contacts/?locationId=' + encodeURIComponent(locationId)
                + '&limit=5&query=' + encodeURIComponent(_q),
              { headers: { 'Authorization': 'Bearer ' + token, 'Version': '2021-07-28', 'Accept': 'application/json' } },
            );
            if (_dupRes.ok) {
              var _dupJson = await _dupRes.json().catch(function () { return {}; });
              var _cands = Array.isArray(_dupJson.contacts) ? _dupJson.contacts : [];
              var _hit = _cands.find(function (c) {
                var cDigits = String((c && c.phone) || '').replace(/\D/g, '').slice(-10);
                if (phone10 && cDigits === phone10) return true;
                if (email && String((c && c.email) || '').toLowerCase() === email.toLowerCase()) return true;
                return false;
              });
              if (_hit && _hit.id) _dupId = _hit.id;
            }
          }
        } catch (e) {
          console.error('[GHL] duplicate resolution failed: ' + String(e).slice(0, 120));
        }
        if (!_dupId) {
          leadAudit('duplicate_unresolved', 409, { lang: preferred_language || '', src: (lead_source || '').toString().slice(0, 40) });
          return res.status(409).json({
            error: 'DUPLICATE_LEAD',
            message: 'We already have your request on file. A licensed advisor will follow up.',
          });
        }
        console.warn('[GHL] duplicate contact — recording a repeat request WITHOUT overwriting the existing record');
        // ── AUDIT 2026-08-18 (LEAD-02 / TCPA consent integrity, P0) ───────────
        // The old code PUT the full client-built `contact` body onto the existing
        // contact matched by PHONE — an unauthenticated caller who knows a
        // victim's phone (already in the CRM) could overwrite that third party's
        // name/email/DOB/address AND flip consent_marketing/sms/calls/email to
        // 'true', i.e. FALSIFY TCPA CONSENT on someone else. Identity match is
        // NOT authorization, and a generic lead submit must never silently set a
        // third party's legal consent.
        //
        // FIX: on the existing-contact path we do NOT write identity or consent
        // fields at all. The person is still recorded as a repeat request via the
        // note + opportunity below (advisor follow-up preserved — the O-05
        // intent), and their NEW best-time / interest is captured in that note.
        // A returning REAL customer's consent was already captured when they
        // first gave it; it never needs to be re-escalated by an unauthenticated
        // web submit, and a prior opt-out (DND) must never be silently reversed.
        // Re-enabling any verified update of an existing contact requires a
        // server-issued token binding the record to a verified identity.
        leadAudit('existing_contact_no_escalation', 200, {
          lang: preferred_language || '', src: (lead_source || '').toString().slice(0, 40),
          matched_by: phone10 ? 'phone' : 'email',
        });
        // Hand the downstream note/opportunity logic a 2xx-shaped result so a
        // repeat request produces a visible, advisor-facing record — WITHOUT the
        // identity/consent PUT that created the vector.
        _repeatRequest = true;
        ghlRes = { ok: true, status: 200, json: async function () { return { contact: { id: _dupId } }; } };
      } else {
        leadAudit('crm_unavailable', 502, { upstream_status: ghlRes.status });
        return res.status(502).json({
          error: 'CRM_UNAVAILABLE',
          message: 'We could not submit your request right now. Please call us at 1-855-720-8555.',
        });
      }
    }
    // Sawil 2026-06-30 AUDIT FIX C3/BUG-003 — GHL can return a 2xx with an empty
    // or non-JSON body (gateway 204, truncated proxy response). An unguarded
    // .json() would THROW, fall to the outer catch, return 500, and tell the user
    // it failed — while the contact was already created (orphaned + a retry then
    // duplicates). Guard the parse: a 2xx with no parseable contact id is still a
    // SUCCESS (the contact exists); we just skip the note we can't attach.
    var ghlData = await ghlRes.json().catch(function () { return {}; });
    var contactId = ghlData && ghlData.contact && ghlData.contact.id;
    if (!contactId) {
      console.warn('[GHL] 2xx with no contact id in body — treating as created, skipping note (no PII logged)');
    }
    // Privacy: log only contactId + source + language. Never log first_name,
    // last_name, phone, email, ZIP, DOB, or any other PII. Vercel runtime logs
    // are accessible via the dashboard and may be exported — keeping logs
    // PII-free ensures privacy compliance even if logs are reviewed by ops.
    console.log('[GHL] Contact created', {
      contactId: contactId,
      source: lead_source || '',
      lang: preferred_language || '',
      state: derived_state || '',
      status: 'created'
    });

    if (contactId) {
      var noteBody = '';
      if (lead_notes && lead_notes.trim()) { noteBody += lead_notes.trim(); }
      if (conversation_summary && conversation_summary.trim()) {
        if (noteBody && conversation_summary.trim() !== noteBody) {
          noteBody += '\n\n--- Conversation Transcript ---\n' + conversation_summary.trim();
        } else if (!noteBody) {
          noteBody = conversation_summary.trim();
        }
      }
      if (noteBody) {
        try {
          await fetch('https://services.leadconnectorhq.com/contacts/'+contactId+'/notes',{
            method:'POST',
            headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
            // AUDIT 2026-08-13 (O-05) — flag a repeat submission at the TOP of
            // the note so the advisor immediately sees this person asked again
            // and was not reached the first time.
            body:JSON.stringify({body:(_repeatRequest
              ? '*** REPEAT REQUEST — this person already had a record and submitted again. They are still waiting for contact. ***\n\n'
              : '') + noteBody})
          });
        } catch(e) {
          console.error('[GHL] Note creation exception: ' + (e && e.message ? e.message : String(e)));
        }
      }
    }
    // Sawil 2026-07-04 — repointed lead intake from the old 14-stage pipeline
    // "ClearPoint Medicare Leads" (puGDpLJLyeTSXQqutzsm, New Lead stage
    // 3c52bf0b-2d8f-4174-8a0a-211a3637d02c) to the clean 6-stage
    // "ClearPoint Medicare Leads v2" so all new web/chat leads land in the
    // single source-of-truth pipeline. New Lead stage below belongs to v2.
    var pipelineId = 'HPvihjPaOhPeQ9u0bXUd';
    var pipelineStageId = '5102d9b2-1b1b-415f-9663-9d21283b3032';
    // Sawil 2026-07-16 PHASE 2 — auto-assign the opportunity owner so no lead is
    // ever created orphaned (audit R2: 15/15 opps had no owner). Single-owner
    // agency → the sole licensed advisor. Env override wins so a future multi-
    // advisor setup or a round-robin workflow can take over without a code change;
    // falls back to the current owner id. If neither resolves, the opp is created
    // unassigned exactly as before (graceful — assignment never blocks a lead).
    var defaultOwnerId = process.env.GHL_DEFAULT_OWNER_ID || 'tdBdfxrg2pv3Z76YJm17';
    // Derive a clean opportunity source label from the form_name sent by each form.
    // ChatBot sends 'Website Chatbot - Medicare Plan Review Request'
    // SmartMedicareReview sends 'Smart Medicare Review'
    // LeadForm sends '{source} Form' (e.g. 'contact-page Form', 'homepage-hero Form')
    // Red-team round 4 (R4-SL-07/08): the opportunity label and its keyword
    // routing read the ORIGINAL client strings (coerced to a string so a hostile
    // type can never throw after the CRM contact has been written), not the
    // allow-listed tag value.
    // RED TEAM ROUND 5 (R5-SL-15, P4): the routing read the TRIMMED form name
    // and the fallback below re-read the untrimmed one. A whitespace-only
    // form_name is truthy, so the fallback never consulted lead_source_raw and
    // then trimmed itself to nothing — an opportunity with an EMPTY source
    // label. Trim once, use the same value in both places.
    var _formName = (typeof body.form_name === 'string' ? body.form_name.trim().replace(/\s+/g, ' ') : '');
    var rawFormName = String(_formName || lead_source_raw || '').slice(0, 120).toLowerCase();
    var sourceLabel;
    if (rawFormName.indexOf('chatbot') !== -1 || rawFormName.indexOf('zara') !== -1) {
      sourceLabel = 'Zara ChatBot';
    } else if (rawFormName.indexOf('smart') !== -1) {
      sourceLabel = 'Smart Medicare Review';
    } else if (rawFormName.indexOf('contact') !== -1 || rawFormName.indexOf('free review') !== -1) {
      sourceLabel = 'Free Plan Review';
    } else if (rawFormName.indexOf('hero') !== -1 || rawFormName.indexOf('homepage') !== -1) {
      sourceLabel = 'Homepage Form';
    } else if (rawFormName.indexOf('extra') !== -1) {
      sourceLabel = 'Extra Help';
    } else if (rawFormName.length > 0) {
      // Red-team round 4 (R4-SL-08): a non-string form_name used to throw here,
      // AFTER the contact had been written — a 500 with a half-created lead.
      sourceLabel = String(_formName || lead_source_raw || 'Website Lead').slice(0, 120) || 'Website Lead';
    } else {
      sourceLabel = 'Website Lead';
    }
    var oppName = (first_name||'') + (last_name ? ' ' + last_name : '') + ' — ' + sourceLabel;
    if (contactId) {
      try {
        // FASE 15 — opportunity idempotency. The contact upsert already dedupes by
        // phone, but a retry-after-success (client never saw the 200, or the client
        // auto-retry fires) would create a SECOND opportunity for the same contact.
        // Before creating, check for an existing OPEN opp for this contact in this
        // pipeline; if one exists, skip creation and return success (idempotent).
        // Best-effort: a search failure never blocks the lead — we fall through to
        // create, matching the previous always-create behavior on error.
        var _dupOpp = false;
        try {
          var _oppSearch = await fetch('https://services.leadconnectorhq.com/opportunities/search?location_id=' + encodeURIComponent(locationId) + '&contact_id=' + encodeURIComponent(contactId) + '&pipeline_id=' + encodeURIComponent(pipelineId) + '&status=open&limit=20', {
            headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Accept':'application/json'}
          });
          if (_oppSearch.ok) {
            var _oppData = await _oppSearch.json();
            _dupOpp = Array.isArray(_oppData && _oppData.opportunities) && _oppData.opportunities.length > 0;
          }
        } catch (_se) { /* search failed → fall through and create as before */ }
        if (_dupOpp) {
          console.log('[GHL] Opportunity idempotent skip — open opp already exists', { contactId: contactId, pipeline: pipelineId });
          leadAudit('created', 200, { lang: preferred_language || '', src: (lead_source || '').toString().slice(0, 40), repeat: _repeatRequest === true, opportunity: 'existing' });
          return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId, submission_id: submission_id || undefined, opportunity: 'existing' });
        }
        var oppRes = await fetch('https://services.leadconnectorhq.com/opportunities/',{
          method:'POST',
          headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify(Object.assign({ locationId:locationId, pipelineId:pipelineId, pipelineStageId:pipelineStageId, contactId:contactId, name:oppName, status:'open' }, defaultOwnerId ? { assignedTo: defaultOwnerId } : {}))
        });
        if (!oppRes.ok) {
          // Privacy: log status + pipeline IDs only. The response body may echo
          // contact name / lead source / monetary value — keep PII out of logs.
          console.error('[GHL] Opportunity creation failed: HTTP ' + oppRes.status + ' pipeline=' + pipelineId);
        } else {
          console.log('[GHL] Opportunity created', { contactId: contactId, pipeline: pipelineId });
        }
      } catch(e) {
        console.error('[GHL] Opportunity creation exception: ' + (e && e.message ? e.message : String(e)));
      }
    }
    leadAudit('created', 200, { lang: preferred_language || '', src: (lead_source || '').toString().slice(0, 40), repeat: _repeatRequest === true });
    return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId, submission_id: submission_id || undefined });
  } catch (err) {
    // Never leak internals to the client. Log the class of failure only.
    console.error('[submit-lead] unhandled exception: ' + (err && err.message ? String(err.message).slice(0, 200) : 'unknown'));
    leadAudit('internal_error', 500, {});
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// api/_lib/medicare-figures.js
//
// AUDIT 2026-08-18 (CLARA-MED-03, P2) — DETERMINISTIC NUMERIC BACKSTOP.
//
// THE GAP: the authoritative 2026 Medicare dollar figures live only inside the
// LLM system prompt (api/chat.js). If the model deviates — a stale 2025 figure,
// a transposed digit, an invented number — nothing catches it; the only defense
// was "the prompt says so" + temperature 0.2. A senior could act on a wrong
// premium/deductible/cap. This module is the deterministic guardrail: the SINGLE
// SOURCE OF TRUTH for the figures, plus a post-filter that corrects a WRONG
// definitive assertion of an unambiguous single-value figure back to the
// verified value, and logs it.
//
// SAFETY POSTURE — correct ONLY the figures that have exactly ONE right value in
// 2026 and are stated as a bare definitive fact. Anything variable is LEFT
// UNTOUCHED (fail-open on ambiguity), because a false "correction" of a
// legitimately-adjusted figure would itself be a compliance error:
//   • Part B premium is corrected ONLY when phrased as the standard/base figure
//     with NO IRMAA/income/"higher"/"depends" context (IRMAA premiums are
//     legitimately higher).
//   • Part D plan deductible ($615 is a MAXIMUM, plans vary), Part A premium
//     tiers ($0/$311/$565 by quarters) and Part A coinsurance are NOT
//     auto-corrected — only detected/logged — because a lower/different value
//     can be legitimate.
//   • Any window carrying a temporal ("last year", "2025", "was") or range
//     ("up to", "as low as", "maximum", "varies", "could be", "around") marker
//     is skipped — those are correct nuance, not hallucinations.
//
// The function NEVER throws and NEVER empties the text (fail-safe): on any error
// it returns the input unchanged.

// ── SINGLE SOURCE OF TRUTH — 2026, mirrors api/chat.js:306-315 ────────────────
// Keep this in sync with the prompt. { value, display, year, source }.
// AUDIT 2026-09-12 (MED-02/AI-01, P1) — the year these figures are valid for.
// api/chat.js asserts it equals its own FIGURES_YEAR at load and only runs the
// backstop while the calendar year matches; the verifier below also refuses to
// touch any window that names a DIFFERENT year ("For 2027 … will be $2,400").
export const MEDICARE_FIGURES_YEAR = 2026;
export const MEDICARE_FIGURES_2026 = {
  part_b_standard_premium:     { value: 202.90, display: '202.90', year: 2026, source: 'CMS 2026 Part B premium' },
  part_b_deductible:           { value: 283,    display: '283',    year: 2026, source: 'CMS 2026 Part B deductible' },
  part_a_hospital_deductible:  { value: 1736,   display: '1,736',  year: 2026, source: 'CMS 2026 Part A inpatient deductible' },
  part_d_oop_cap:              { value: 2100,   display: '2,100',  year: 2026, source: 'IRA 2026 Part D out-of-pocket cap' },
  // Present for reference / detection only — NOT auto-corrected (variable):
  part_d_max_deductible:       { value: 615,    display: '615',    year: 2026, source: 'CMS 2026 Part D max deductible', detectOnly: true },
};

// Figures we will actively correct (single unambiguous 2026 value).
const AUTO_CORRECT = new Set(['part_b_standard_premium', 'part_b_deductible', 'part_a_hospital_deductible', 'part_d_oop_cap']);

// Window markers that DISQUALIFY a correction (legitimate variability / history).
const DISQUALIFY = /(irmaa|higher income|higher than|más alto|mas alto|adjust|ajust|\bincome\b|ingreso|depend|depende|up to|as low as|at least|hasta|máximo|maximo|\bmax\b|maximum|varies|var[ií]a|around|about|approx|aproximad|roughly|could be|might be|puede ser|last year|previous|previo|used to|el año pasado|antes|\bwas\b|\bera\b|\b2024\b|\b2025\b|\b2023\b|starts at|desde|next year|(?:pr[oó]ximo|proximo)\s+a[ñn]o)/i;
// AUDIT 2026-09-12/13 (MED-02/AI-01 + red-team MED02-RT-01..05) — year scoping.
// A figure is left alone when the SENTENCE it sits in is about another contract
// year (a year token that is not ours, a CY/PY/FY-prefixed year, a 'YY form, or a
// next-year phrase), and — when the sentence names no year — when the enclosing
// PARAGRAPH is about another year. Money and phone digits are blanked before the
// year scan so "$2000" or "1-877-486-2048" never masquerade as years, and a
// sentence that explicitly names OUR year (or "this year" / "currently") wins.
// Red-team round 2 (MED02-RT2-04/05): ordinary January mentions ("resets on
// January 1", "se renueva en enero") are NOT next-year context; a January phrase
// counts only when it is a next/starting/effective construction backed by a
// future verb in the same sentence. Spelled-out and colloquial next-year forms added.
// Accented Spanish verbs: JS `\b` treats "á" as a non-word char, so the verb
// tail is guarded with an explicit letter lookahead instead of `\b`.
const FUTURE_VERB = '(?<![a-záéíóúñü])(?:will|going\\s+to|rises?|increases?|goes\\s+up|ser[áa]|subir[áa]|aumentar[áa]|pasar[áa]|va\\s+a)(?![a-záéíóúñü])';
// "starting / beginning / effective / a partir de / desde January" is a
// next-period construction by itself; "from January" (a range: "from January
// through December") and bare "January 1" mentions need a future verb.
const NEXT_YEAR_PHRASE = new RegExp('(next\\s+(?:plan\\s+|contract\\s+|calendar\\s+)?year|(?:following|coming|upcoming)\\s+(?:plan\\s+|contract\\s+|calendar\\s+)?year|next\\s+january|come\\s+january|when\\s+the\\s+new\\s+year\\s+starts|after\\s+december|new\\s+year\'?s?\\s+(?:rates?|figures?|amounts?)|el\\s+a[ñn]o\\s+(?:que\\s+viene|entrante|siguiente)|(?:el\\s+)?siguiente\\s+a[ñn]o|pr[oó]xim[oa]s?\\s+(?:a[ñn]o|enero)|a[ñn]o\\s+pr[oó]ximo|(?:starting|beginning|effective)\\s+(?:in\\s+|on\\s+)?january|(?:a\\s+partir\\s+de|desde)\\s+enero|from\\s+january(?=[^.!?]{0,80}' + FUTURE_VERB + ')|(?:en|in)\\s+(?:enero|january)(?=[^.!?]{0,80}' + FUTURE_VERB + '))', 'i');
const CURRENT_MARKER = /(this\s+year|currently|right\s+now|for\s+now|as\s+of\s+today|este\s+a[ñn]o|actualmente|ahora\s+mismo|hoy\s+en\s+d[ií]a)/i;
// Spelled-out years ("twenty twenty-seven", "dos mil veintisiete") → numeric.
const SPELLED_YEARS = [
  [/\btwenty\s+twenty[-\s]?five\b/gi, 2025], [/\btwenty\s+twenty[-\s]?six\b/gi, 2026], [/\btwenty\s+twenty[-\s]?seven\b/gi, 2027], [/\btwenty\s+twenty[-\s]?eight\b/gi, 2028], [/\btwenty\s+twenty[-\s]?nine\b/gi, 2029],
  [/\bdos\s+mil\s+veinticinco\b/gi, 2025], [/\bdos\s+mil\s+veintis[eé]is\b/gi, 2026], [/\bdos\s+mil\s+veintisiete\b/gi, 2027], [/\bdos\s+mil\s+veintiocho\b/gi, 2028], [/\bdos\s+mil\s+veintinueve\b/gi, 2029],
];
// A year is four digits not glued to other digits (so "$2,027" / "2027-01" / "1-800-2027" stay out).
const YEAR_TOKEN = /(?:\b(?:cy|py|fy)\s?)?(?<!\$|\d|\d[,.]|-)(20\d{2})(?!\d|[,.]\d|-\d)|(?<!\$|\d)'(\d{2})\b/gi;
function blankDigits(s) {
  return String(s)
    .replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, function (m) { return ' '.repeat(m.length); })
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, function (m) { return ' '.repeat(m.length); })
    .replace(/\b1-\d{3}-[A-Z0-9-]{4,}\b/gi, function (m) { return ' '.repeat(m.length); });
}
function yearsIn(s) {
  const out = [];
  let txt = blankDigits(s);
  for (const [re, y] of SPELLED_YEARS) txt = txt.replace(re, function (m) { return String(y) + ' '.repeat(Math.max(0, m.length - 4)); });
  const re = new RegExp(YEAR_TOKEN.source, 'gi');
  let m;
  while ((m = re.exec(txt)) !== null) {
    const y = m[1] ? Number(m[1]) : 2000 + Number(m[2]);
    out.push({ year: y, index: m.index });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}
// The sentence containing `offset` (split on ; : ! ? line breaks and a '.' that is
// NOT a decimal point — red-team MED02-RT2-01: "$259.00 if your income is higher"
// must stay one sentence), plus whether it is a line-delimited fragment
// (heading / list item) rather than prose.
// A ':' is NOT a boundary: "CY2027 Part B deductible: $300" is one label+value unit.
function isBoundary(text, i) {
  const ch = text[i];
  if (ch === '.') return !(/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || ''));
  return /[;!?\n]/.test(ch);
}
function sentenceAround(text, offset) {
  let s = offset, e = offset;
  while (s > 0 && !isBoundary(text, s - 1)) s--;
  while (e < text.length && !isBoundary(text, e)) e++;
  const isFragment = (e >= text.length || text[e] === '\n') && (s === 0 || text[s - 1] === '\n');
  return { start: s, end: e, text: text.slice(s, e), isFragment: isFragment };
}
// Clause bounds inside a sentence (split on , ; and / y) around `rel`.
function clauseAround(sentence, rel) {
  const re = /,|;|\band\b|\by\b/gi;
  let start = 0, end = sentence.length, m;
  while ((m = re.exec(sentence)) !== null) {
    if (m.index < rel) start = m.index + m[0].length; else { end = m.index; break; }
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return { start: start, end: end };
}
function paragraphAround(text, offset) {
  let s = text.lastIndexOf('\n\n', offset); s = s < 0 ? 0 : s;
  let e = text.indexOf('\n\n', offset); e = e < 0 ? text.length : e;
  return text.slice(Math.max(s, offset - 1200), Math.min(e, offset + 1200));
}
// TRUE when the figure at `offset` belongs to another contract year → do not touch.
function aboutOtherYear(text, offset, year) {
  const sent = sentenceAround(text, offset);
  const rel = offset - sent.start;
  const ys = yearsIn(sent.text);
  const ours = ys.some(function (y) { return y.year === year; }) || CURRENT_MARKER.test(sent.text);
  const others = ys.filter(function (y) { return y.year !== year; });
  // Red-team MED02-RT2-03: our year / "this year" in the sentence wins; when the
  // sentence names BOTH, only an other-year token inside the figure's own clause
  // (and within 40 chars) defers.
  if (ours) {
    if (!others.length) return false;
    const cb = clauseAround(sent.text, rel);
    return others.some(function (y) { return y.index >= cb.start && y.index < cb.end && Math.abs(y.index - rel) <= 40; });
  }
  if (others.length) return true;
  if (NEXT_YEAR_PHRASE.test(sent.text)) return true;
  // Red-team MED02-RT2-02: the paragraph fallback exists for headings + list
  // items ("2027 figures:" above "- Part B deductible: $300") — line-delimited
  // fragments only, never a prose sentence.
  if (sent.isFragment) {
    const para = paragraphAround(text, offset);
    const pys = yearsIn(para);
    if (pys.length && pys.every(function (y) { return y.year !== year; })) return true;
    if (!pys.length && NEXT_YEAR_PHRASE.test(para) && !CURRENT_MARKER.test(para)) return true;
  }
  return false;
}

// Nearest match of `pattern` to `center`, LEFT-BIASED: a figure almost always
// FOLLOWS its concept ("Part B deductible is $257"), so a keyword BEFORE the
// dollar wins over one after it even when the one after is slightly closer.
// This disambiguates two Part figures in one sentence ("Part B ... $257 and
// Part A ... $1,736" → $257 resolves to Part B, not the nearer trailing Part A).
function nearestTo(text, center, pattern, maxDist) {
  const re = new RegExp(pattern.source, 'gi');
  let before = null, beforeDist = Infinity, after = null, afterDist = Infinity, m;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    if (end <= center) {
      const d = center - end;            // keyword ends before the dollar
      if (d < beforeDist) { beforeDist = d; before = m[0].toLowerCase(); }
    } else {
      const d = m.index - center;        // keyword starts after the dollar
      if (d < afterDist) { afterDist = d; after = m[0].toLowerCase(); }
    }
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  if (before && beforeDist <= maxDist) return before;   // prefer the preceding concept
  if (after && afterDist <= maxDist) return after;
  return null;
}

// Classify the figure at `offset` by the CLOSEST Part keyword and the CLOSEST
// figure-type keyword — so "Part B deductible $257 and Part A deductible $1,736"
// resolves each dollar to its own Part.
function classifyAt(text, offset) {
  const win = text.slice(Math.max(0, offset - 75), offset + 75).toLowerCase();
  const part = nearestTo(text, offset, /\bpart\s*[abd]\b|\bparte\s*[abd]\b/, 70);
  if (!part) return null;
  // The Part letter is the FINAL char of the match ("part b" / "parte b" → "b"),
  // NOT every a/b/d in the phrase ("parte" also contains an "a").
  const letter = part.trim().slice(-1).toLowerCase(); // a|b|d
  const deductible = /deductible|deducible/.test(win);
  const premium = /premium|prima/.test(win);
  const oopCap = /out[-\s.]?of[-\s.]?pocket|catastrophic|catastr[oó]f|tope (de|máximo)|m[aá]ximo de bolsillo|\bcap\b/.test(win);

  if (letter === 'b' && deductible && !premium) return 'part_b_deductible';
  if (letter === 'a' && deductible && /(hospital|inpatient|hospitalizaci|per benefit|per[ií]odo)/.test(win)) return 'part_a_hospital_deductible';
  if (letter === 'd' && oopCap && !deductible && !premium) return 'part_d_oop_cap';
  if (letter === 'b' && premium && !deductible && /(standard|base|most people|est[aá]ndar|la mayor[ií]a)/.test(win)) return 'part_b_standard_premium';
  return null;
}

/**
 * Verify Medicare dollar figures in an LLM reply against the 2026 source of
 * truth. Returns { text, corrections: [{ concept, said, correct }] }.
 * Fail-safe: returns the input unchanged on any error; never blanks the text.
 */
export function verifyMedicareFigures(text) {
  if (typeof text !== 'string' || !text) return { text: '', corrections: [] };
  try {
    const corrections = [];
    // Red-team MED02-RT-01: "$2000" (no comma) used to match as "$200" + "0" and be
    // rewritten to "$2,1000"; comma-grouped form now requires at least one group.
    const DOLLAR = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
    const out = text.replace(DOLLAR, function (match, num, offset) {
      const val = parseFloat(String(num).replace(/,/g, ''));
      if (!isFinite(val)) return match;
      // Red-team MED02-RT-05: the DISQUALIFY markers are tested on the SENTENCE
      // (bounded ±75 chars) so a marker in a neighbouring sentence cannot silence
      // a correction, and a sentence that names our year / "this year" is ours.
      const sentInfo = sentenceAround(text, offset);
      // Red-team MED02-RT2-06: the window is bounded by the sentence on BOTH sides.
      const win = text.slice(Math.max(sentInfo.start, offset - 75), Math.min(sentInfo.end + 1, offset + 75));
      if (DISQUALIFY.test(win)) return match; // legitimate variability/history — leave it
      const concept = classifyAt(text, offset);
      if (!concept || !AUTO_CORRECT.has(concept)) return match;
      const fig = MEDICARE_FIGURES_2026[concept];
      if (!fig) return match;
      if (aboutOtherYear(text, offset, fig.year)) return match; // another contract year — not ours to rewrite
      // Correct only a genuinely different definitive value.
      if (Math.abs(val - fig.value) > 0.009) {
        corrections.push({ concept: concept, said: val, correct: fig.value });
        return '$' + fig.display;
      }
      return match; // already correct
    });
    return { text: out, corrections: corrections };
  } catch (_e) {
    return { text: text, corrections: [] };
  }
}

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

// Markers that DISQUALIFY a correction (legitimate variability / history).
// Red-team round 3 (MED02-RT3-07/09/11/14): tested on the WHOLE sentence now
// that sentence bounds are reliable — a ±75-char window hid IRMAA context that
// opened the sentence. Split in two because the two classes behave differently:
//   • CONTEXT markers mean the sentence is about variability or the past,
//     wherever they appear ("Because your income … the premium is $259.00");
//   • AMOUNT markers ("up to $615", "about $257") only qualify the amount they
//     introduce, so a lead-in like "About the Part B deductible: it is $257"
//     must not silence the correction.
// RED TEAM ROUND 5 (RT5-MED-05, P1): the old inline lookbehinds only matched
// the exact adjacent form, so "regardless of YOUR income" and "no matter your
// income" — the two most natural ways to state the CORRECT rule — still read as
// income context and silenced the correction. Exemption phrases are now removed
// from the text before either income test runs, which also covers the Spanish
// forms without a second lookbehind.
const INCOME_EXEMPTION_RE = /\b(?:regardless\s+of|no\s+matter|whatever|irrespective\s+of|sin\s+importar|independientemente\s+de|sea\s+cual\s+sea)\s+(?:\S+\s+){0,2}(?:income|ingresos?)\b/gi;
function stripIncomeExemptions(s) { return String(s).replace(INCOME_EXEMPTION_RE, ' '); }
// RT5-MED-05: the income family moved OUT of the universal clause test and into
// DISQUALIFY_INCOME_CLAUSE below, which runs only for the Part B standard
// premium. "Even for higher-income seniors the 2026 Part B deductible is $257"
// used to be silenced by the bare word "income" even though the Part B
// deductible does not vary with income — the sentence is a hallucination and
// correcting it is exactly this module's job.
const DISQUALIFY_CONTEXT = /(higher than|más alto|mas alto|adjust|ajust|depend|depende|varies|var[ií]a|could be|might be|puede ser|last year|previous|previo|used to|el a[ñn]o pasado|[uú]ltimo a[ñn]o|a[ñn]o anterior|anteriormente|\bwas\b|\bwere\b|\bera\b|\bfue\b|\bfueron\b|\b2019\b|\b2020\b|\b2021\b|\b2022\b|\b2023\b|\b2024\b|\b2025\b|you (?:said|told|mentioned)|usted (?:dijo|mencion[oó])|your bill|su factura)/i;
// The IRMAA / income-adjustment family qualifies the WHOLE sentence: it changes
// what the figure means, wherever it appears (red-team round 4, RT4-08).
// Premium-only, clause-scoped. Pairs with DISQUALIFY_SENTENCE_WIDE below.
const DISQUALIFY_INCOME_CLAUSE = /(irmaa|higher income|income[-\s]related|ajuste por ingresos|\bincome\b|ingresos?\b)/i;
const DISQUALIFY_SENTENCE_WIDE = /(irmaa|higher income|income[-\s]related|ajuste por ingresos|(?:income|ingresos?)[^.!?]{0,70}(?:threshold|above|higher|exceed|adjust|umbral|m[aá]s alto|super|ajust)|(?:threshold|above|higher|exceed|umbral|m[aá]s alto)[^.!?]{0,70}(?:income|ingresos?))/i;
// Only when they IMMEDIATELY introduce the amount (≤14 chars before the '$').
const DISQUALIFY_BEFORE_AMOUNT = /(up to|as low as|at least|no more than|hasta|m[aá]ximo|\bmax\b|maximum|starts? at|starting at|comienza en|desde)\s*(?:a|an|de|un|una|el|la)?\s*$/i;
// RED TEAM ROUND 5 (RT5-MED-04). An approximation marker used to disqualify the
// amount outright, which meant "you pay about $257 as the deductible" — a
// specific wrong figure wearing an estimate's clothes — was never corrected.
// The marker's real job is to protect a deliberate ROUNDING ("about $250 comes
// out of your check", "around $200 a month"), so it now only applies to a round
// amount. $257 is not a rounding of anything; $250 is.
const APPROX_BEFORE_AMOUNT = /(around|about|approx\w*|aproximad\w*|roughly|unos|cerca de|m[aá]s o menos)\s*(?:a|an|de|un|una|el|la)?\s*$/i;
//
// RED TEAM ROUND 6 (RT6-MED-04, P2). Round 5 narrowed the approximation marker
// to round amounts, which was right, and stopped there, which was not: EVERY
// round amount became exempt. So "the Part D out-of-pocket cap is about $8,000"
// — the pre-IRA figure round 5 named as the single most likely stale number a
// model can emit — walked straight through behind the word "about".
//
// A rounding stays near what it rounds. $200 is a rounding of $202.90; $8,000 is
// not a rounding of $2,100, it is a wrong figure wearing an estimate's clothes.
function isRoundAmount(val) { return isFinite(val) && val > 0 && val % 10 === 0; }
// The programmes under which a beneficiary's own share really is $0.
const SUBSIDY_CONTEXT_RE = /\b(qmb|slmb|\bqi\b|qdwi|medicare\s+savings|programas?\s+de\s+ahorros?|medicaid|dual[-\s]?eligible|doble\s+elegib|extra\s+help|ayuda\s+adicional|ayuda\s+extra|low[-\s]?income\s+subsidy|\blis\b|subsidio)\b/i;
function isPlausibleRoundingOf(val, fig) {
  if (!isRoundAmount(val)) return false;
  const ratio = val > fig.value ? val / fig.value : fig.value / val;
  return ratio <= 1.25;
}
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
// Red-team round 3 (MED02-RT3-05): the verb list drives every January
// construction, so it carries the ordinary ways a figure changes ("becomes",
// "changes to", "cambiará", "quedará") and the Spanish plurals.
const FUTURE_VERB = '(?<![a-záéíóúñü])(?:will|going\\s+to|rises?|increases?|goes?\\s+(?:up|to)|becomes?|changes?\\s+to|moves?\\s+to|jumps?\\s+to|climbs?\\s+to|ser[áa]n?|subir[áa]n?|aumentar[áa]n?|pasar[áa]n?|cambiar[áa]n?|quedar[áa]n?|llegar[áa]n?|va[n]?\\s+a)(?![a-záéíóúñü])';
// "starting / beginning / effective / a partir de / desde January" is a
// next-period construction by itself; "as of / on / in / from January" and bare
// "January 1" mentions count only when a future verb backs them in the sentence.
const NEXT_YEAR_PHRASE = new RegExp('(next\\s+(?:plan\\s+|contract\\s+|calendar\\s+)?year|(?:following|coming|upcoming)\\s+(?:plan\\s+|contract\\s+|calendar\\s+)?year|next\\s+january|come\\s+january|when\\s+the\\s+new\\s+year\\s+starts|after\\s+december|in\\s+the\\s+new\\s+year|(?:el\\s+)?nuevo\\s+a[ñn]o|new\\s+year\'?s?\\s+(?:rates?|figures?|amounts?)|el\\s+a[ñn]o\\s+(?:que\\s+viene|entrante|siguiente)|(?:el\\s+)?siguiente\\s+a[ñn]o|pr[oó]xim[oa]s?\\s+(?:a[ñn]o|enero)|a[ñn]o\\s+pr[oó]ximo|(?:starting|beginning|effective)\\s+(?:in\\s+|on\\s+)?january|(?:a\\s+partir\\s+de|desde)\\s+enero|(?:from|as\\s+of|on|in)\\s+january(?=[^.!?]{0,90}' + FUTURE_VERB + ')|(?:en|in)\\s+(?:enero|january)(?=[^.!?]{0,90}' + FUTURE_VERB + '))', 'i');
const CURRENT_MARKER = /(this\s+year|currently|right\s+now|for\s+now|as\s+of\s+today|este\s+a[ñn]o|actualmente|ahora\s+mismo|hoy\s+en\s+d[ií]a)/i;
// Spelled-out years ("twenty twenty-seven", "twenty-twenty-seven", "dos mil veintisiete").
const SPELLED_YEARS = [
  [/\btwenty[-\s]+twenty[-\s]?five\b/gi, 2025], [/\btwenty[-\s]+twenty[-\s]?six\b/gi, 2026], [/\btwenty[-\s]+twenty[-\s]?seven\b/gi, 2027], [/\btwenty[-\s]+twenty[-\s]?eight\b/gi, 2028], [/\btwenty[-\s]+twenty[-\s]?nine\b/gi, 2029],
  [/\bdos\s+mil\s+veinticinco\b/gi, 2025], [/\bdos\s+mil\s+veintis[eé]is\b/gi, 2026], [/\bdos\s+mil\s+veintisiete\b/gi, 2027], [/\bdos\s+mil\s+veintiocho\b/gi, 2028], [/\bdos\s+mil\s+veintinueve\b/gi, 2029],
];
// A year is four digits not glued to other digits (so "$2,027" / "2027-01" /
// "1-800-2027" stay out), a CY/PY/FY-prefixed two- or four-digit year, or an
// apostrophe form — straight or typographic (red-team MED02-RT3-12).
const YEAR_TOKEN = /(?:\b(?:cy|py|fy)\s?)(?:(20\d{2})|(\d{2}))\b|(?<!\$|\d|\d[,.]|-)(20\d{2})(?!\d|[,.]\d|-\d)|(?<!\$|\d)['’‘](\d{2})\b/gi;
function blankDigits(s) {
  return String(s)
    .replace(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g, function (m) { return ' '.repeat(m.length); })
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g, function (m) { return ' '.repeat(m.length); })
    .replace(/\b1-\d{3}-[A-Z0-9-]{4,}\b/gi, function (m) { return ' '.repeat(m.length); });
}
//
// RED TEAM ROUND 5 (RT5-MED-07, P2). A hyphenated year RANGE was invisible to
// both sides of YEAR_TOKEN at once: 2027 was suppressed by the trailing
// `(?!-\d)` and 2028 by the leading `(?<!-)`, so "For 2027-2028 the Part B
// deductible will be $300" registered NO year at all and was rewritten to the
// 2026 value. The en-dash form was protected, "CY 2026/2027" was protected —
// the plain hyphen was the one broken separator, and it is the one a model
// types. Ranges are collected before the token scan so both endpoints count.
const YEAR_RANGE_RE = /(20\d{2})\s?[-–—/]\s?(20\d{2})/g;
function yearsIn(s) {
  const out = [];
  let txt = blankDigits(s);
  for (const [re, y] of SPELLED_YEARS) txt = txt.replace(re, function (m) { return String(y) + ' '.repeat(Math.max(0, m.length - 4)); });
  var rangeRe = new RegExp(YEAR_RANGE_RE.source, 'g');
  var rm;
  while ((rm = rangeRe.exec(txt)) !== null) {
    out.push({ year: Number(rm[1]), index: rm.index });
    out.push({ year: Number(rm[2]), index: rm.index + rm[0].length - 4 });
    if (rangeRe.lastIndex === rm.index) rangeRe.lastIndex++;
  }
  const re = new RegExp(YEAR_TOKEN.source, 'gi');
  let m;
  while ((m = re.exec(txt)) !== null) {
    const y = m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : 2000 + Number(m[2] || m[4]);
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
function lineBounds(text, offset) {
  let s = text.lastIndexOf('\n', offset); s = s < 0 ? 0 : s + 1;
  let e = text.indexOf('\n', offset); e = e < 0 ? text.length : e;
  return { start: s, end: e };
}
// Red-team round 3 (MED02-RT3-01): a fragment is a LINE-shaped unit — a bullet,
// a numbered item, a table row or a "label: value" line — regardless of whether
// it happens to end with a period. Those inherit their year from the heading
// above them; prose sentences do not.
function sentenceAround(text, offset) {
  let s = offset, e = offset;
  // Bounded walk: a "sentence" longer than 1,200 chars either way is not prose,
  // and an unbounded scan makes a long reply quadratic (red-team MED02-RT3 perf).
  const lo = Math.max(0, offset - 1200), hi = Math.min(text.length, offset + 1200);
  while (s > lo && !isBoundary(text, s - 1)) s--;
  while (e < hi && !isBoundary(text, e)) e++;
  const lb = lineBounds(text, offset);
  const line = text.slice(lb.start, lb.end).trim();
  const isFragment = /^(?:[-*•·]|\d+[.)]|\|)/.test(line) || /^[^.!?]{0,80}:\s*\S/.test(line);
  return { start: s, end: e, text: text.slice(s, e), isFragment: isFragment };
}
// Clause bounds inside a sentence around `rel`. Red-team round 3 (MED02-RT3-08):
// but/pero/while/vs/whereas and parentheses separate a this-year statement from
// a next-year one inside the same sentence.
const CLAUSE_SEP_RE = /,|;|\(|\)|\band\b|\by\b|\bbut\b|\bpero\b|\bwhile\b|\bmientras\b|\bvs\.?\b|\bversus\b|\bwhereas\b|\bthen\b|\bluego\b/gi;
function clauseAround(sentence, rel) {
  const re = new RegExp(CLAUSE_SEP_RE.source, 'gi');
  let start = 0, end = sentence.length, m;
  while ((m = re.exec(sentence)) !== null) {
    if (m.index < rel) start = m.index + m[0].length; else { end = m.index; break; }
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return { start: start, end: end };
}
// Context for a line fragment: its own block PLUS the heading above it, even when
// a blank line separates them ("2027 figures:\n\n- Part B deductible: $300").
function fragmentContext(text, offset) {
  const lb = lineBounds(text, offset);
  // Red-team round 4 (RT4-04): a ':' line is a PARENT heading inside the block
  // ("2027 figures:" → "- Part B:" → "  - deductible: $300"), not a stop, and a
  // long list or a run of blank lines must not hide the heading either. Walk to
  // the top of the block under a character budget, stopping only at a line that
  // names a year without an amount — the heading we were looking for.
  let start = lb.start, blanks = 0;
  for (let i = 0; i < 60 && start > 0 && lb.start - start < 4000; i++) {
    const prevNl = start - 1;
    const ps = text.lastIndexOf('\n', prevNl - 1);
    const pStart = ps < 0 ? 0 : ps + 1;
    const prev = text.slice(pStart, prevNl);
    start = pStart;
    if (!prev.trim()) { blanks++; if (blanks > 4) break; continue; }
    blanks = 0;
    if (/20\d{2}/.test(prev) && !/\$/.test(prev)) break;
  }
  let end = text.indexOf('\n\n', offset);
  if (end < 0) end = text.length;
  let ctx = text.slice(start, Math.min(end, offset + 2000));
  //
  // RED TEAM ROUND 5 (RT5-MED-08, P2). The walk only ever went UP, so a year
  // caption placed BELOW the figures was never consulted — and a caption under a
  // blank line is exactly the layout a model produces for a table. "| Part B
  // deductible | $300 |\n\nTable: projected 2027 amounts." had its cell rewritten
  // to the 2026 value. Remove the blank line and the caption was already seen, so
  // the blank line was the whole defect. The next non-empty line after the block
  // is now included when it reads like a caption.
  const CAPTION_RE = /^\s*(?:table|figure|fig\.|source|note|nota|fuente|tabla|figura|those\s+are|these\s+are|estas?\s+son|estos\s+son|projected|proyectad[oa]s?|all\s+amounts|todas?\s+las\s+cifras)\b/i;
  let after = text.slice(end, Math.min(text.length, end + 400));
  const nextLine = (after.match(/^\s*\n?\s*([^\n]+)/) || [])[1];
  if (nextLine && (CAPTION_RE.test(nextLine) || (nextLine.length <= 80 && /[.:]\s*$/.test(nextLine)))) {
    ctx += '\n' + nextLine;
  }
  return ctx;
}
//
// RED TEAM ROUND 5 (RT5-MED-02, P1). fragmentContext walks UP from the amount
// under three budgets — 60 lines, 5 blank lines, 4,000 characters — and round 4
// treated "walked out of budget" as "no other year found", which silently means
// "this is our year, rewrite it". Measured edges: 59 intervening list lines kept
// a 2027 figure safe and 60 rewrote it; 4 blank lines safe, 5 rewrote; 3,830
// characters safe, 4,030 rewrote. On a 4,000-line list under a "2027 figures:"
// heading, 3,717 lines came back rewritten to 2026 values. It is also quadratic:
// a 124 KB reply took 1,262 ms against a 200 ms budget.
//
// The walk is replaced by a single pass over the reply that records, for every
// line, the year most recently declared by a heading above it — a line naming a
// year and carrying no amount. One O(n) pass, no budgets, no edge to find. The
// result is memoised per reply because the caller asks once per dollar amount.
let YEAR_HEADING_MEMO = { text: null, lineStarts: null, years: null };
function buildYearHeadings(text) {
  const lines = text.split('\n');
  const lineStarts = new Array(lines.length);
  const years = new Array(lines.length);
  let at = 0;
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = at;
    at += lines[i].length + 1;
    const line = lines[i];
    if (/20\d{2}/.test(line) && line.indexOf('$') < 0) {
      const found = yearsIn(line);
      if (found.length) current = found.map(function (y) { return y.year; });
    }
    years[i] = current;
  }
  return { text: text, lineStarts: lineStarts, years: years };
}
/** Years declared by the nearest heading above `offset`, or null when none. */
function headingYearsAt(text, offset) {
  if (YEAR_HEADING_MEMO.text !== text) YEAR_HEADING_MEMO = buildYearHeadings(text);
  const starts = YEAR_HEADING_MEMO.lineStarts;
  // Binary search for the line containing `offset`.
  let lo = 0, hi = starts.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) { idx = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return YEAR_HEADING_MEMO.years[idx] || null;
}
function paragraphAround(text, offset) {
  let s = text.lastIndexOf('\n\n', offset); s = s < 0 ? 0 : s;
  let e = text.indexOf('\n\n', offset); e = e < 0 ? text.length : e;
  return text.slice(Math.max(s, offset - 1200), Math.min(e, offset + 1200));
}
// TRUE when the figure at `offset` belongs to another contract year → do not
// touch. Order: the figure's own CLAUSE decides first, then the sentence, then
// (for line fragments, and for prose that carries a bare future verb) the
// surrounding block. A context that names OUR year and another year at once is
// a comparison — fail open and leave the text alone.
function aboutOtherYear(text, offset, year) {
  const sent = sentenceAround(text, offset);
  const rel = offset - sent.start;
  const cb = clauseAround(sent.text, rel);
  const clause = sent.text.slice(cb.start, cb.end);
  const clauseYears = yearsIn(clause);
  if (clauseYears.some(function (y) { return y.year !== year; })) return true;
  if (NEXT_YEAR_PHRASE.test(clause)) return true;
  if (clauseYears.some(function (y) { return y.year === year; }) || CURRENT_MARKER.test(clause)) return false;

  // The clause is neutral — widen to the sentence, ignoring parenthetical asides
  // when the figure itself sits outside them.
  const insideParens = /\([^)]*$/.test(sent.text.slice(0, rel));
  const scanned = insideParens ? sent.text : sent.text.replace(/\([^)]*\)/g, ' ');
  const ys = yearsIn(scanned);
  const ours = ys.some(function (y) { return y.year === year; }) || CURRENT_MARKER.test(scanned);
  const others = ys.some(function (y) { return y.year !== year; });
  if (ours && others) return true;   // comparison sentence — fail open
  if (others) return true;
  if (ours) return false;
  if (NEXT_YEAR_PHRASE.test(scanned)) return true;

  // No year anywhere in the sentence. Line fragments inherit from their heading;
  // prose does so only when it states a FUTURE change ("the deductible will be
  // $300") — a present-tense sentence after a next-year sentence is about now.
  const futureProse = new RegExp(FUTURE_VERB, 'i').test(sent.text);
  if (!sent.isFragment && !futureProse) return false;
  // RT5-MED-02: the heading map is consulted FIRST for line fragments. It has no
  // budget to run out of, so a 2027 heading still governs line 4,000 of a list.
  if (sent.isFragment) {
    const headYears = headingYearsAt(text, offset);
    if (headYears) {
      const headOurs = headYears.indexOf(year) >= 0;
      const headOthers = headYears.some(function (y) { return y !== year; });
      if (headOthers) return true;   // another year governs this line — hands off
      if (headOurs) return false;
    }
  }
  const ctx = sent.isFragment ? fragmentContext(text, offset) : paragraphAround(text, offset);
  const cys = yearsIn(ctx);
  const ctxOurs = cys.some(function (y) { return y.year === year; }) || CURRENT_MARKER.test(ctx);
  const ctxOthers = cys.some(function (y) { return y.year !== year; });
  if (ctxOurs && ctxOthers) return true;   // comparison table/list — fail open
  if (ctxOthers) return true;
  if (ctxOurs) return false;
  if (NEXT_YEAR_PHRASE.test(ctx)) return true;
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
// Red-team round 3 (MED02-RT3-04): a per-day / coinsurance amount is never one
// of the annual single-value figures, even when the sentence also names the
// deductible ("$1,736 per benefit period, then $434 per day").
const PER_DAY_RE = /(coinsurance|coseguro|per day|a day|each day|por d[ií]a|al d[ií]a|daily|diari[oa]|days?\s*\d|d[ií]as?\s*\d|lifetime reserve)/i;
// Red-team round 4 (RT4-01, P1): proximity alone is not evidence. An amount is
// only the figure the concept names when it sits in the SAME clause as the
// keyword and no other cost noun intervenes — otherwise "the Part B deductible
// is $257 a year, and after that you pay about $40 for a visit" rewrote the $40.
//
// RED TEAM ROUND 5 (RT5-MED-04, P1). The list above also held the monthly
// cadence — "per month", "al mes", "costs you", "cuesta" — and any of them
// anywhere in the 40 characters before the amount killed the correction. But
// the Part B premium IS a monthly amount, so "The standard Part B premium per
// month in 2026 is $174.70" is the most natural way to state it and the guard
// permanently disabled the very figure it was protecting. Nine of thirteen
// legitimate wrong-figure sentences were silenced.
//
// What remains is only nouns that name a genuinely DIFFERENT amount, and they
// now have to sit between the concept keyword and the amount — closer to the
// amount than the keyword is — before they count. "Apart from your copay the
// 2026 Part B deductible is $257" keeps its correction because the keyword is
// the nearer of the two.
const OTHER_COST_NOUN_RE = /\b(copay|copayment|coinsurance|copago|coseguro|office\s+visit|visita|consulta)\b/i;
const COST_EXCLUSION_RE = /\b(?:separate\s+from|apart\s+from|aside\s+from|other\s+than|not\s+counting|besides|excluding|aparte\s+de|adem[aá]s\s+de|distinto\s+de|sin\s+contar)\s+(?:\S+\s+){0,3}?(?:copay|copayment|coinsurance|copago|coseguro|office\s+visit|visita|consulta)s?\b/gi;
//
// RED TEAM ROUND 5 (RT5-MED-01, P1). When the amount's own clause carries no
// Part keyword the lookup widens to the whole sentence, and round 4 widened the
// radius to 160 characters in BOTH directions. That let any dollar amount
// within 160 characters of a Part keyword be rewritten: "The plan pays $500
// toward hearing aids each year, which is a separate benefit entirely from the
// Part B deductible in 2026" came back as "$283".
//
// The discriminator is grammatical, not metric. In a real hit the amount is the
// PREDICATE of the concept ("The Part B deductible, which is …, is $257" — the
// clause is a bare "is $257"). In every false positive the clause has its own
// subject naming something else: "the dental max is $500", "the late-enrollment
// penalty adds $400", "The plan pays $500". So: on the widened path, reject
// when the amount's clause has a competing subject — a noun phrase before a
// value verb that names neither a Part nor a figure type.
//
// RED TEAM ROUND 6 (RT6-MED-09, P1). Two gaps let the NEXT clause's amount be
// claimed by this one's concept. The verb list was missing the ordinary ways a
// plan hands someone money or a bill — charges, offers, gives you, you get, you
// owe — and nothing allowed a bare article between the verb and the amount, so
// "there is a $50 charge" and "the plan charges a $45 monthly premium" had no
// recognisable subject at all and sailed through to the widened path. The
// second one is the worst of them: it rewrote a MONTHLY PREMIUM to the annual
// deductible value, because the left-biased keyword search preferred the
// "deductible" behind it to the "premium" beside it.
const CLAUSE_SUBJECT_RE = /([\w'’À-ɏ-]+)[ \t]+(is|are|was|were|es|son|era|eran|hay|cuesta|cuestan|adds?|costs?|charges?|offers?|provides?|allows?|grants?|gets?|owes?|receives?|pays?|covers?|includes?|gives?|aporta|ofrece|cobra|recibe|debe|otorga|cubre|paga|pagan|da)[ \t]+(?:about[ \t]+|around[ \t]+|roughly[ \t]+|approximately[ \t]+|unos[ \t]+|cerca[ \t]+de[ \t]+)?(?:(?:a|an|the|another|each|el|la|los|las|un|una|otro|otra)[ \t]+)?(?:\$|USD)/i;
//
// A DIFFERENT product or benefit named in the subject is a competitor whatever
// else the phrase contains (RT6-MED-03/09). The word "premium" inside "your
// Medigap Plan G premium" used to vouch for the whole clause, so a Medigap
// premium — the most business-critical number this system quotes — was rewritten
// to the Part B premium. The same list breaks list-ancestor inheritance: a
// nested item under "Extras" or "Medigap Plan G" does not inherit "Part B".
const COMPETING_PRODUCT_RE = /\b(medigap|supplement(?:al)?|suplemento|advantage|plan\s+[a-n]\b|part\s*c\b|plan'?s\b|del\s+plan\b|de\s+su\s+plan\b|drug\s+plan|drug\s+deductible|plan\s+de\s+medicamentos|dental|vision|visi[oó]n|hearing|audici[oó]n|grocery|allowance|asignaci[oó]n|tarjeta|otc\b|gym|fitness|transportation|transporte|extras?|adicionales|penalty|penalizaci[oó]n|late[-\s]enrollment|charge|recargo|surcharge)\b/i;
// An ANAPHORIC subject on a copula points back at whatever the previous clause
// named — "…, and for this year it is $257" is still the deductible's own
// predicate. A personal pronoun does not qualify: "you pay about $40" names
// what the caller pays, which is a different amount.
const ANAPHORIC_HEAD_RE = /^(?:it|that|this|these|those|which|ello|eso|esto|esta|este|esa|ese)$/i;
const COPULA_RE = /^(?:is|are|was|were|es|son|era|eran)$/i;
const CONCEPT_WORD_RE = /\b(part\s*[abd]|parte\s*[abd]|deductible|deducible|premium|prima|out[-\s.]?of[-\s.]?pocket|catastrophic|catastr[oó]f|bolsillo|tope|cap)\b/i;
function clauseHasCompetingSubject(clause) {
  const m = CLAUSE_SUBJECT_RE.exec(clause);
  if (!m) return false;                                   // bare predicate: ", is $257"
  const head = m[1];
  const verb = m[2];
  if (ANAPHORIC_HEAD_RE.test(head) && COPULA_RE.test(verb)) return false;
  // A bare number or year is not a subject: "…, and in 2026 is $257" is still
  // the predicate of whatever the previous clause named (RT5-MED-04).
  if (/^\d+$/.test(head)) return false;
  // A subject phrase that names the concept itself is the correct predicate,
  // not a competitor. Bounded to this clause so a neighbouring "deductible"
  // cannot vouch for "the dental max is $500".
  //
  // RT6-MED-03: …but a phrase naming a DIFFERENT product is a competitor even
  // when it also contains a concept word. "your Medigap Plan G premium" holds
  // "premium" and is not the Part B premium.
  const subjectPhrase = clause.slice(0, m.index + head.length);
  if (COMPETING_PRODUCT_RE.test(subjectPhrase)) return true;
  if (CONCEPT_WORD_RE.test(subjectPhrase)) return false;
  return true;
}
//
// RED TEAM ROUND 5 (RT5-MED-06, P2). Bounding the keyword search by the
// sentence — and treating '\n' as a hard sentence boundary — meant the concept
// was invisible whenever it sat one level up. A four-deep bullet list under a
// 2026 heading ("- Medicare / - Part B / - Costs / - deductible: $257") was
// never classified, and neither was the most ordinary prose shape there is:
// "Let us talk about the Part B deductible. In 2026 it is $257."
//
// Both inherit their concept from immediately above, so the lookup does too —
// a list item from its indentation ancestors, an anaphoric sentence from the
// sentence before it. The inherited text is only ever PREPENDED as context; the
// competing-subject and cost-noun guards still run against the amount's own
// clause, so "The Part B deductible is $283. My copay for a specialist is $50."
// does not hand the $50 to Part B.
const ANAPHORIC_SENTENCE_RE = /(?:^|[\s,;])(?:it|that|this|they|ello|eso|esto)\s+(?:is|are|was|were|es|son)\b|(?:^|[\s,;])(?:es|son)\s+(?:de\s|\$)|(?:^|[\s,;])(?:the\s+)?(?:amount|figure|cifra|monto)\s+is\b/i;
function indentWidth(line) {
  const lead = (String(line).match(/^[ \t]*/) || [''])[0];
  return lead.replace(/\t/g, '    ').length;
}
function inheritedConcept(text, offset, sInfo) {
  const KEYWORD = /\bpart\s*[abd]\b|\bparte\s*[abd]\b/i;
  if (sInfo.isFragment) {
    // Walk to the top of the list collecting each strictly-shallower ancestor.
    const lb = lineBounds(text, offset);
    let want = indentWidth(text.slice(lb.start, lb.end));
    if (want <= 0) return '';
    const parts = [];
    let pos = lb.start;
    for (let i = 0; i < 200 && pos > 0; i++) {
      const prevEnd = pos - 1;
      const ps = text.lastIndexOf('\n', prevEnd - 1);
      const pStart = ps < 0 ? 0 : ps + 1;
      const prev = text.slice(pStart, prevEnd);
      pos = pStart;
      if (!prev.trim()) continue;
      const ind = indentWidth(prev);
      if (ind < want) {
        // RT6-MED-03/09: an ancestor naming a different product ends the chain.
        // A bullet under "Medigap Plan G" or under "Extras" does not inherit the
        // "Part B" two levels above it — that ancestor is describing something
        // else, and everything below it belongs to that something else.
        if (COMPETING_PRODUCT_RE.test(prev)) return '';
        parts.unshift(prev.trim());
        want = ind;
        if (ind === 0) break;
      }
    }
    const joined = parts.join(' ');
    return KEYWORD.test(joined) ? joined : '';
  }
  // Prose: only an anaphoric sentence inherits, and only from ONE sentence back.
  // RT6-MED-09: and never across a topic change — "It is worth knowing you also
  // get $500 a year for dental" is a new subject, not the deductible again.
  if (COMPETING_PRODUCT_RE.test(sInfo.text)) return '';
  if (!ANAPHORIC_SENTENCE_RE.test(sInfo.text)) return '';
  const beforeSentence = text.slice(0, sInfo.start);
  const prev = sentenceAround(beforeSentence, Math.max(0, beforeSentence.length - 1));
  if (!prev || !prev.text || !KEYWORD.test(prev.text)) return '';
  // Exactly one Part concept, or the reference is ambiguous.
  const hits = prev.text.match(/\bpart\s*[abd]\b|\bparte\s*[abd]\b/gi) || [];
  const distinct = {};
  for (let i = 0; i < hits.length; i++) distinct[hits[i].trim().slice(-1).toLowerCase()] = true;
  return Object.keys(distinct).length === 1 ? prev.text.trim() : '';
}
function classifyAt(text, offset) {
  const win = text.slice(Math.max(0, offset - 75), offset + 75).toLowerCase();
  const near = text.slice(Math.max(0, offset - 30), offset + 30);
  if (PER_DAY_RE.test(near)) return null;
  // Keyword resolution is bounded by the amount's own CLAUSE inside its sentence:
  // that keeps it linear AND stops a keyword from claiming an unrelated amount.
  const sInfo = sentenceAround(text, offset);
  const rel = offset - sInfo.start;
  const cBounds = clauseAround(sInfo.text, rel);
  let seg = sInfo.text.slice(cBounds.start, cBounds.end);
  let segOffset = rel - cBounds.start;
  // A leading prepositional phrase ("For Part B, the deductible is $300") puts the
  // keyword in the previous clause — widen to the sentence when the clause has
  // none. The cost-noun and magnitude guards below still apply.
  let widened = false;
  if (!/\bpart\s*[abd]\b|\bparte\s*[abd]\b/i.test(seg)) {
    // RT5-MED-01: before widening, check the clause we are leaving. If it names
    // its own subject the amount belongs to that subject, and no keyword
    // elsewhere in the sentence can claim it.
    if (clauseHasCompetingSubject(seg)) return null;
    // RT6-MED-09: a competing product or benefit named ANYWHERE in the clause
    // ends it too, whatever grammatical shape the clause takes. "y hay un
    // recargo de $50" has no subject this parser can see, and the surcharge is
    // still not the Part B deductible. Erring here costs a missed correction;
    // erring the other way rewrites a real plan cost.
    if (COMPETING_PRODUCT_RE.test(seg)) return null;
    seg = sInfo.text; segOffset = rel; widened = true;
  }
  // RT5-MED-06: the concept may live one level up — on a parent list line, or in
  // the sentence this one refers back to.
  if (widened && !/\bpart\s*[abd]\b|\bparte\s*[abd]\b/i.test(seg)) {
    const inherited = inheritedConcept(text, offset, sInfo);
    if (inherited) { seg = inherited + '\n' + seg; segOffset += inherited.length + 1; }
  }
  // Red-team round 4 (RT4-10): inside the amount's own clause the keyword may sit
  // behind a long apposition ("The Part B deductible, which is the amount you pay
  // …, is $257"), so the radius is the clause itself. The sentence fallback keeps
  // the tight radius, and the cost-noun and magnitude guards apply either way.
  const maxDist = widened ? 160 : Math.max(160, seg.length);
  const part = nearestTo(seg, segOffset, /\bpart\s*[abd]\b|\bparte\s*[abd]\b/, maxDist);
  if (!part) return null;
  // RT5-MED-01: on the widened path the keyword must also come BEFORE the
  // amount. A keyword trailing the amount ("… $500 … separate from the Part B
  // deductible") describes what the amount is NOT.
  if (widened) {
    const kwIdx = seg.toLowerCase().search(/\bpart\s*[abd]\b|\bparte\s*[abd]\b/);
    if (kwIdx < 0 || kwIdx > segOffset) return null;
  }
  // RT5-MED-04: a competing cost noun disqualifies the amount only when it sits
  // between the keyword and the amount AND is the nearer of the two.
  // An EXCLUSION lead-in names the other cost in order to rule it out — "the
  // Part B deductible is separate from your copay and in 2026 is $257" is a
  // statement about the deductible, not about the copay. Neutralise the noun
  // the exclusion introduces before measuring distances (RT5-MED-04).
  const beforeSeg = seg.slice(0, segOffset).replace(COST_EXCLUSION_RE, ' ');
  const costIdx = beforeSeg.toLowerCase().search(OTHER_COST_NOUN_RE);
  if (costIdx >= 0) {
    const kwIdx = beforeSeg.toLowerCase().search(/\bpart\s*[abd]\b|\bparte\s*[abd]\b|deductible|deducible|premium|prima|out[-\s.]?of[-\s.]?pocket|bolsillo|tope/);
    if (kwIdx < 0 || costIdx > kwIdx) return null;
  }
  // The Part letter is the FINAL char of the match ("part b" / "parte b" → "b"),
  // NOT every a/b/d in the phrase ("parte" also contains an "a").
  const letter = part.trim().slice(-1).toLowerCase(); // a|b|d
  // Red-team round 3 (MED02-RT3-10): the figure TYPE is resolved the same
  // left-biased way as the Part letter, so "Your Part B premium is $202.90 and
  // the Part B deductible is $257" classifies each amount on its own keyword
  // instead of cancelling out.
  const kind = nearestTo(seg, segOffset, /deductible|deducible|premium|prima|out[-\s.]?of[-\s.]?pocket|catastrophic|catastr[oó]f|m[aá]ximo de bolsillo|tope/, maxDist);
  const deductible = kind ? /deduc/.test(kind) : /deductible|deducible/.test(win);
  const premium = kind ? /premium|prima/.test(kind) : /premium|prima/.test(win);
  const oopCap = kind ? /out|pocket|catastr|bolsillo|tope/.test(kind) : /out[-\s.]?of[-\s.]?pocket|catastrophic|catastr[oó]f|tope (de|máximo)|m[aá]ximo de bolsillo|\bcap\b/.test(win);

  if (letter === 'b' && deductible && !premium) return 'part_b_deductible';
  if (letter === 'a' && deductible && /(hospital|inpatient|hospitalizaci|per benefit|per[ií]odo)/.test(win)) return 'part_a_hospital_deductible';
  if (letter === 'd' && oopCap && !deductible && !premium) return 'part_d_oop_cap';
  if (letter === 'b' && premium && !deductible && /(standard|base|most people|est[aá]ndar|la mayor[ií]a)/.test(win)) return 'part_b_standard_premium';
  return null;
}

// TRUE when the sentence already states the correct figure somewhere else — the
// amount under review is then the other side of a comparison or a range.
// Red-team round 4 (RT4-01): a figure two orders of magnitude away from the
// verified value is not a mis-stated version of it — it is a different amount.
//
// RED TEAM ROUND 5 (RT5-MED-03, P1). A 3x band is narrower than the errors this
// module exists to catch. Measured: it corrected a Part D out-of-pocket cap only
// between $700 and $6,300, so "$8,000" — the real pre-IRA catastrophic figure
// and the single most likely stale number a model can produce — passed
// untouched, as did a transposed digit ($2,830 for $283) and a dropped one.
// Worse, `val <= 0` meant "implausible", so "The 2026 Part B deductible is $0"
// was the one wrong answer the backstop was guaranteed to let through, and it
// is the one that costs a senior the most.
//
// The band exists because round 4 used it to paper over RT4-01, where a distant
// keyword captured an unrelated amount. That is now fixed at the source by the
// competing-subject and cost-noun rules in classifyAt, so the band can be what
// it was meant to be: a sanity check against an amount that is not a version of
// this figure at all. $0 is always corrected.
function magnitudePlausible(val, fig) {
  if (!isFinite(val) || val < 0) return false;
  if (val === 0) return true;          // a $0 deductible, premium or cap is never right
  const ratio = val > fig.value ? val / fig.value : fig.value / val;
  return ratio <= 20;
}
function sentenceCarriesFigure(sentence, fig) {
  const plain = String(fig.value);
  const grouped = fig.display;
  const dotted = grouped.replace(/,/g, '.');
  const alts = [grouped, dotted, plain].map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
  // Red-team round 4 (RT4-03): only a CURRENCY-formatted occurrence counts. A page
  // number, a count of people or a phone fragment that happens to equal the figure
  // must not silence a genuine correction.
  const re = new RegExp('(?:\\$\\s?|USD\\s?)(?:' + alts + ')(?![\\d])|(?<![\\d.,])(?:' + alts + ')(?![\\d])\\s?(?:d[oó]lares|dollars)\\b', 'i');
  return re.test(sentence);
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
    // Red-team round 3 (MED02-RT3-06): the Spanish thousands-DOT form ("$1.736")
    // is matched whole — it used to be read as the decimal 1.73 and rewritten
    // into "$1,7366". The trailing (?!\d) keeps any unmatched digit out.
    // Red-team round 3 (MED02-RT3-16): amounts written as "257 dólares" / "USD 257".
    // Red-team round 4 (RT4-07): the Spanish decimal-comma form ("$1.736,50",
    // "$250,50") is matched whole, so a correct figure is never half-rewritten.
    // Red-team round 4 (RT4-11/12): "$ 257" with spacing, the space-separated
    // thousands form "$1 736" (which used to be half-matched into "$1,736 736"),
    // and the postfix "2,000 USD" notation are all matched whole now.
    const MONEY = /(\$\s{0,3}|USD\s{0,3})(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+|\d+,\d{2}(?!\d)|\d+(?:\.\d{1,2})?)(?!\d| \d{3}\b)|(\d{1,3}(?:[.,]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(d[oó]lares|dollars|USD)\b/gi;
    const out = text.replace(MONEY, function (match, cur, num, plainNum, unit, offset) {
      const raw = String(num != null ? num : plainNum);
      const dotThousands = /^\d{1,3}(?:\.\d{3})+$/.test(raw);
      const spaceThousands = /^\d{1,3}(?: \d{3})+$/.test(raw);
      const commaDecimal = /^\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(raw);
      const val = parseFloat(dotThousands ? raw.replace(/\./g, '')
        : spaceThousands ? raw.replace(/ /g, '')
          : commaDecimal ? raw.replace(/\./g, '').replace(',', '.')
            : raw.replace(/,/g, ''));
      if (!isFinite(val)) return match;
      const amountAt = offset + (num != null ? String(cur || '').length : 0);
      const sentInfo = sentenceAround(text, amountAt);
      // Red-team round 4 (RT4-08): the IRMAA / income family genuinely qualifies a
      // whole sentence; the history and variability markers only qualify the
      // clause they sit in, or one incidental "ingresos" three clauses away
      // silences a real correction.
      const relForCtx = amountAt - sentInfo.start;
      const ctxClause = clauseAround(sentInfo.text, relForCtx);
      const clauseText = sentInfo.text.slice(ctxClause.start, ctxClause.end);
      if (DISQUALIFY_CONTEXT.test(stripIncomeExemptions(clauseText))) return match; // variability / history in this clause
      // Red-team round 4 (RT4-02): the window ends at the digits, so the '$' or
      // 'USD' the marker introduces has to come off before the anchored test.
      const beforeAmount = text.slice(Math.max(sentInfo.start, amountAt - 30), amountAt).replace(/(?:\$|USD)\s*$/i, '');
      if (DISQUALIFY_BEFORE_AMOUNT.test(beforeAmount)) return match;
      const approximated = APPROX_BEFORE_AMOUNT.test(beforeAmount);
      const concept = classifyAt(text, amountAt);
      if (!concept || !AUTO_CORRECT.has(concept)) return match;
      // RED TEAM ROUND 5 (RT5-MED-05, P1). The IRMAA / income family used to
      // disqualify the whole sentence for EVERY figure, but only the Part B
      // standard premium varies with income. So "Because your income is above
      // the threshold, your 2026 Part A hospital inpatient deductible is $2,000"
      // — a pure hallucination, since the Part A deductible does not vary with
      // income at all — was left standing. The test now runs after
      // classification and applies only to the one income-adjusted figure.
      if (concept === 'part_b_standard_premium') {
        if (DISQUALIFY_SENTENCE_WIDE.test(stripIncomeExemptions(sentInfo.text))) return match;
        if (DISQUALIFY_INCOME_CLAUSE.test(stripIncomeExemptions(clauseText))) return match;
      }
      const fig = MEDICARE_FIGURES_2026[concept];
      if (!fig) return match;
      // RT6-MED-04: the approximation marker protects a genuine ROUNDING of this
      // figure, not any round number that follows the word "about".
      if (approximated && isPlausibleRoundingOf(val, fig)) return match;
      //
      // RED TEAM ROUND 6 (RT6-MED-02, graded P3 after adversarial review). "$0 is
      // always corrected" is right for a hallucinated zero and wrong for a
      // SUBSIDISED one: a caller with QMB, an MSP, Medicaid or full Extra Help
      // legitimately owes $0, and rewriting that to $283 tells a dual-eligible
      // senior they owe money they do not. The statutory figure is unchanged for
      // them — Medicaid pays it — so the sentence is about who pays, not what the
      // figure is. Narrow by design: the clause itself must name the programme.
      // Read across the SENTENCE: "If you have QMB, your share … would be $0"
      // names the programme in the conditional clause, not beside the amount.
      if (val === 0 && SUBSIDY_CONTEXT_RE.test(sentInfo.text)) return match;
      if (aboutOtherYear(text, amountAt, fig.year)) return match; // another contract year — not ours to rewrite
      // Red-team round 3 (MED02-RT3-03): a sentence that ALREADY carries the
      // right figure is a comparison ("increased from $257 to $283") — rewriting
      // the other side produces "$283 to $283". Never touch those.
      // Red-team round 4 (RT4-03): scope the comparison guard to the amount's own
      // clause, so the right figure quoted elsewhere in a long sentence does not
      // silence a genuine correction.
      const relAmt = amountAt - sentInfo.start;
      const cb2 = clauseAround(sentInfo.text, relAmt);
      if (sentenceCarriesFigure(sentInfo.text.slice(cb2.start, cb2.end), fig)) return match;
      if (!magnitudePlausible(val, fig)) return match;   // a different amount, not a mis-stated one
      // Correct only a genuinely different definitive value.
      if (Math.abs(val - fig.value) > 0.009) {
        corrections.push({ concept: concept, said: val, correct: fig.value });
        const shown = dotThousands ? fig.display.replace(/,/g, '.')
          : spaceThousands ? fig.display.replace(/,/g, ' ')
            : fig.display;
        return unit != null ? shown + ' ' + unit : (cur || '$') + shown;
      }
      return match; // already correct
    });
    return { text: out, corrections: corrections };
  } catch (_e) {
    return { text: text, corrections: [] };
  }
}

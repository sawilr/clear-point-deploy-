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
const DISQUALIFY_CONTEXT = /(irmaa|higher income|higher than|más alto|mas alto|adjust|ajust|(?<!regardless\s{1,3}of\s{1,3})\bincome\b|(?<!sin\s{1,3}importar\s{1,3}(?:el\s{1,3}|sus\s{1,3})?)ingresos?\b|depend|depende|varies|var[ií]a|could be|might be|puede ser|last year|previous|previo|used to|el a[ñn]o pasado|[uú]ltimo a[ñn]o|a[ñn]o anterior|anteriormente|\bwas\b|\bwere\b|\bera\b|\bfue\b|\bfueron\b|\b2019\b|\b2020\b|\b2021\b|\b2022\b|\b2023\b|\b2024\b|\b2025\b|you (?:said|told|mentioned)|usted (?:dijo|mencion[oó])|your bill|su factura)/i;
// The IRMAA / income-adjustment family qualifies the WHOLE sentence: it changes
// what the figure means, wherever it appears (red-team round 4, RT4-08).
const DISQUALIFY_SENTENCE_WIDE = /(irmaa|higher income|income[-\s]related|ajuste por ingresos|(?:income|ingresos?)[^.!?]{0,70}(?:threshold|above|higher|exceed|adjust|umbral|m[aá]s alto|super|ajust)|(?:threshold|above|higher|exceed|umbral|m[aá]s alto)[^.!?]{0,70}(?:income|ingresos?))/i;
// Only when they IMMEDIATELY introduce the amount (≤14 chars before the '$').
const DISQUALIFY_BEFORE_AMOUNT = /(up to|as low as|at least|no more than|hasta|m[aá]ximo|\bmax\b|maximum|around|about|approx\w*|aproximad\w*|roughly|unos|cerca de|starts? at|starting at|comienza en|desde)\s*(?:a|an|de|un|una|el|la)?\s*$/i;
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
function yearsIn(s) {
  const out = [];
  let txt = blankDigits(s);
  for (const [re, y] of SPELLED_YEARS) txt = txt.replace(re, function (m) { return String(y) + ' '.repeat(Math.max(0, m.length - 4)); });
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
  return text.slice(start, Math.min(end, offset + 2000));
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
const OTHER_COST_NOUN_RE = /\b(copay|copayment|coinsurance|copago|coseguro|visit|visita|office|consulta|per\s+month|al\s+mes|a\s+month|monthly\s+cost|costs?\s+you|cuesta|paga|pay\s+about|pays?\s+)\b/i;
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
  if (!/\bpart\s*[abd]\b|\bparte\s*[abd]\b/i.test(seg)) { seg = sInfo.text; segOffset = rel; widened = true; }
  // Red-team round 4 (RT4-10): inside the amount's own clause the keyword may sit
  // behind a long apposition ("The Part B deductible, which is the amount you pay
  // …, is $257"), so the radius is the clause itself. The sentence fallback keeps
  // the tight radius, and the cost-noun and magnitude guards apply either way.
  const maxDist = widened ? 160 : Math.max(160, seg.length);
  const part = nearestTo(seg, segOffset, /\bpart\s*[abd]\b|\bparte\s*[abd]\b/, maxDist);
  if (!part) return null;
  // Another cost noun between the concept and the amount means the amount
  // belongs to that noun, not to the concept.
  if (OTHER_COST_NOUN_RE.test(seg.slice(Math.max(0, segOffset - 40), segOffset))) return null;
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
function magnitudePlausible(val, fig) {
  if (!isFinite(val) || val <= 0) return false;
  const ratio = val > fig.value ? val / fig.value : fig.value / val;
  return ratio <= 3;
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
      if (DISQUALIFY_SENTENCE_WIDE.test(sentInfo.text)) return match;
      if (DISQUALIFY_CONTEXT.test(clauseText)) return match; // variability / history in this clause
      // Red-team round 4 (RT4-02): the window ends at the digits, so the '$' or
      // 'USD' the marker introduces has to come off before the anchored test.
      const beforeAmount = text.slice(Math.max(sentInfo.start, amountAt - 30), amountAt).replace(/(?:\$|USD)\s*$/i, '');
      if (DISQUALIFY_BEFORE_AMOUNT.test(beforeAmount)) return match;
      const concept = classifyAt(text, amountAt);
      if (!concept || !AUTO_CORRECT.has(concept)) return match;
      const fig = MEDICARE_FIGURES_2026[concept];
      if (!fig) return match;
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

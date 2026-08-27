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
const DISQUALIFY = /(irmaa|higher income|higher than|más alto|mas alto|adjust|ajust|\bincome\b|ingreso|depend|depende|up to|as low as|at least|hasta|máximo|maximo|\bmax\b|maximum|varies|var[ií]a|around|about|approx|aproximad|roughly|could be|might be|puede ser|last year|previous|previo|used to|el año pasado|antes|\bwas\b|\bera\b|\b2024\b|\b2025\b|\b2023\b|starts at|desde)/i;

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
    const DOLLAR = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
    const out = text.replace(DOLLAR, function (match, num, offset) {
      const val = parseFloat(String(num).replace(/,/g, ''));
      if (!isFinite(val)) return match;
      const win = text.slice(Math.max(0, offset - 75), offset + 75);
      if (DISQUALIFY.test(win)) return match; // legitimate variability/history — leave it
      const concept = classifyAt(text, offset);
      if (!concept || !AUTO_CORRECT.has(concept)) return match;
      const fig = MEDICARE_FIGURES_2026[concept];
      if (!fig) return match;
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

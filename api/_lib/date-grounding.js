// AUDIT 2026-07-27 (BUG 1 — date math). Clara computed "turning 65 in January
// 2015" as a FUTURE event for a caller born in 1950 because the model has no
// reliable notion of "today". Prompt instructions alone are hope, not a fix;
// this module makes the age math DETERMINISTIC in code:
//   1. extractBirthDate()  — finds a birth date in the caller's message
//      (only when explicit birth context is present, so "enrolled on
//      January 1, 2026" is never mistaken for a DOB).
//   2. buildAgeGroundingNote() — computes age / turned-65 year in code and
//      returns a [System note] appended to the model input.
//   3. redactBirthDate()   — replaces the raw DOB with "[date of birth]"
//      so the exact date never travels to the LLM (CMS rule 5: no full DOB).
// The compliance filter (rule 5 there) is the post-model backstop.

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
const MONTH_ALT = Object.keys(MONTHS).join('|');

// Birth context is REQUIRED — a date alone is never treated as a DOB.
const BIRTH_CONTEXT_RE = /\b(date of birth|birth ?date|dob|i was born|born (on|in)|my birthday is|fecha de nacimiento|nac[ií] (el|en)|cumplea[ñn]os es|naci[oó] (el|en))\b/i;

// Date forms (first match wins). Each entry: [regex, (m) => {y,m,d}]
const DATE_FORMS = [
  // "January 1, 1950" / "january 1st 1950"
  [new RegExp('\\b(' + MONTH_ALT + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b', 'i'),
    (m) => ({ y: +m[3], mo: MONTHS[m[1].toLowerCase()], d: +m[2] })],
  // "1 de enero de 1950" / "1 de enero del 1950"
  [new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + MONTH_ALT + ')\\s+(?:de\\s+|del\\s+)?(\\d{4})\\b', 'i'),
    (m) => ({ y: +m[3], mo: MONTHS[m[2].toLowerCase()], d: +m[1] })],
  // "01/01/1950" or "1-1-1950" (ambiguous D/M order — month kept only if ≤ 12)
  [/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/,
    (m) => ({ y: +m[3], mo: +m[1] <= 12 ? +m[1] : null, d: null })],
  // Bare year: "born in 1950" / "nací en 1950"
  [/\b(19\d{2}|20\d{2})\b/, (m) => ({ y: +m[1], mo: null, d: null })],
];

/**
 * Extract a birth date from a user message. Returns null unless the message
 * contains explicit birth context AND a plausible date (age 0–120).
 * @param {string} text
 * @param {Date} [now]
 * @returns {{ y: number, mo: number|null, d: number|null, matched: string } | null}
 */
export function extractBirthDate(text, now) {
  if (!text || !BIRTH_CONTEXT_RE.test(text)) return null;
  const ref = now || new Date();
  for (const [re, parse] of DATE_FORMS) {
    const m = text.match(re);
    if (!m) continue;
    const parsed = parse(m);
    const age = ref.getFullYear() - parsed.y;
    if (age < 0 || age > 120) continue; // implausible → keep scanning
    return { ...parsed, matched: m[0] };
  }
  return null;
}

/**
 * Deterministic age math. Exported for unit tests.
 * @param {{y:number, mo:number|null, d:number|null}} bd
 * @param {Date} now
 */
export function computeAgeInfo(bd, now) {
  let age = now.getFullYear() - bd.y;
  // If month (and day) known and the birthday hasn't happened yet this year.
  if (bd.mo) {
    const nowMo = now.getMonth() + 1;
    if (nowMo < bd.mo || (nowMo === bd.mo && bd.d && now.getDate() < bd.d)) age -= 1;
  }
  const turned65Year = bd.y + 65;
  const turned65IsPast = turned65Year < now.getFullYear()
    || (turned65Year === now.getFullYear() && bd.mo !== null && bd.mo < now.getMonth() + 1);
  return { age, turned65Year, turned65IsPast };
}

/**
 * Build the grounding [System note] appended to the model input when a birth
 * date is present. The model gets the RESULT of the math, never the raw DOB.
 */
export function buildAgeGroundingNote(bd, now) {
  const info = computeAgeInfo(bd, now);
  const iso = now.toISOString().slice(0, 10);
  const tense = info.turned65IsPast
    ? 'turned 65 in ' + info.turned65Year + ', which is in the PAST'
    : 'turns 65 in ' + info.turned65Year + ', which is in the future';
  return '[System note: deterministic date check — based on the birth date the caller provided, '
    + 'the caller is ' + info.age + ' years old today (' + iso + ') and ' + tense + '. '
    + 'Base ALL age and enrollment-period statements on these computed figures; never restate the birth date itself.]';
}

/** Replace the matched birth date with a placeholder (CMS: never send full DOB). */
export function redactBirthDate(text, bd) {
  if (!text || !bd || !bd.matched) return text;
  return text.split(bd.matched).join('[date of birth]');
}

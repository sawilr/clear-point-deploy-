// Sawil 2026-06-24 — spoken-number normalization for voice dictation.
// Seniors dictate "seven eight seven five five five one two one two" and some
// browsers return the WORDS, not digits. Convert number-words (EN+ES) to digits
// and collapse a RUN of single spoken digits into one contiguous string so a
// dictated phone/ZIP becomes "7875551212" / "10033". Conservative: a lone number
// word ("three PM") becomes "3 PM" but is NOT glued to neighbours.

const EN: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
const ES: Record<string, string> = {
  cero: '0', uno: '1', un: '1', una: '1', dos: '2', tres: '3', cuatro: '4',
  cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
};

/** Convert spoken number-words to digits and glue consecutive single digits. */
export function normalizeSpokenNumbers(text: string, isEs: boolean): string {
  if (!text) return text;
  const map: Record<string, string> = isEs ? { ...EN, ...ES } : EN;
  // token-wise replace number words with their digit
  const out = text.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok)) return tok;
    const key = tok.toLowerCase().replace(/[.,;:]/g, '');
    const digit = map[key];
    if (digit === undefined) return tok;
    // preserve trailing punctuation that was stripped for the lookup
    const trail = tok.match(/[.,;:]+$/);
    return digit + (trail ? trail[0] : '');
  }).join('');
  // glue a run of >=2 single digits separated by spaces: "7 8 7" -> "787"
  return out.replace(/\b\d(?:\s+\d\b)+/g, (m) => m.replace(/\s+/g, ''));
}

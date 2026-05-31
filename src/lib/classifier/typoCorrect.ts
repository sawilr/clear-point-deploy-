// Wave 51 — Charitable typo correction. A real customer-service rep reads
// what the customer MEANT, not what they typed. We normalize the most
// common Medicare-vocabulary misspellings BEFORE classification.
//
// Approach: a small dictionary of canonical Medicare terms + a fuzzy
// matcher (edit distance ≤ 2 for words of length ≥ 5). We replace each
// out-of-dictionary word with its nearest canonical neighbor if any.

const CANONICAL = [
  // Money / docs
  'factura', 'cobro', 'cobran', 'cobrando', 'cobraron', 'cobrar',
  'premium', 'prima', 'copago', 'copay', 'deducible', 'deductible',
  'carta', 'aviso', 'letter', 'notice',
  'asesor', 'advisor', 'licenciado', 'licensed',
  // Drugs
  'medicina', 'medicamento', 'farmacia', 'pharmacy', 'receta', 'prescription',
  'insulina', 'insulin', 'inhalador', 'inhaler', 'pastilla', 'pill',
  // Provider
  'doctor', 'doctora', 'medico', 'especialista', 'specialist', 'cardiologo',
  'primario', 'primary', 'hospital', 'clinica',
  // Topics
  'cobertura', 'coverage', 'red', 'network', 'plan', 'medicare', 'medicaid',
  'apelacion', 'appeal', 'denegacion', 'denial', 'denegaron', 'negaron',
  // Programs
  'ahorrar', 'ahorros', 'ahorro', 'savings', 'subsidio', 'subsidy',
  'asistencia', 'assistance', 'ayuda', 'help',
  // Cost verbs
  'cubre', 'cubrir', 'cubierto', 'cubrieron', 'cubren',
  'aprobar', 'aprobaron', 'aprueba', 'aprueban',
  'cambiar', 'cambio', 'switch', 'change',
  'inscribir', 'enrollment', 'inscripcion',
  // Service words
  'pregunte', 'pregunto', 'pregunta', 'asked', 'pagar', 'paying',
  // ── Common Spanish vocabulary (preserve as-is, prevents over-correction) ──
  'cara', 'caro', 'cobertura', 'mucho', 'mucha', 'poco', 'poca', 'bien', 'mal',
  'mejor', 'peor', 'sobre', 'hacer', 'decir', 'tener', 'puede', 'pueden',
  'tengo', 'tienes', 'tiene', 'tenemos', 'tienen', 'sabe', 'saben',
  'puedo', 'puede', 'pueden', 'quiero', 'quiere', 'queremos', 'quieren',
  'necesito', 'necesita', 'necesitan',
  'gracias', 'thanks', 'thank',
  'medicare', 'medicaid', 'parte', 'parts', 'part',
  // English common
  'expensive', 'cheap', 'cheaper', 'cost', 'costs',
  // More Spanish verbs (preserve as-is)
  'entiendo', 'entiendes', 'entiende', 'entienden', 'entendemos', 'entender',
  'siento', 'sientes', 'siente', 'sentir',
  'estamos', 'estaba', 'estuve', 'estado',
  'hacer', 'hago', 'haces', 'hace', 'hacen', 'hicieron',
  'dijeron', 'dije', 'dices', 'dice', 'dicen', 'decir',
  'fueron', 'tener', 'tenga', 'tengan',
  'antes', 'ahora', 'despues', 'siempre', 'nunca', 'todo', 'todos', 'todas',
  'nada', 'algo', 'alguien', 'nadie', 'todavia', 'aun',
  'donde', 'cuando', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'como', 'porque',
  // Spanish basics — preserve
  'parte', 'partes', 'parts', 'medicare', 'medicaid', 'plan', 'planes',
];

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'a', 'al',
  'en', 'con', 'por', 'para', 'que', 'qué', 'y', 'o', 'pero', 'si', 'sí', 'no',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'me', 'te', 'se', 'lo', 'le', 'les',
  'yo', 'tú', 'usted', 'nosotros', 'ellos', 'es', 'son', 'soy', 'eres', 'fue',
  'the', 'a', 'an', 'of', 'in', 'to', 'is', 'are', 'was', 'were', 'be', 'been',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'if', 'so', 'as', 'on',
  'at', 'for', 'with', 'about', 'from', 'do', 'does', 'did', 'have', 'has', 'had',
]);

/** Damerau-Levenshtein distance (counts transposition as 1). */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/** Find the closest canonical word. Returns null if no match within budget.
 *
 *  We are deliberately conservative to avoid corrupting real English
 *  morphology (denied → denial, changing → change, plans → plan).
 *
 *  Rules:
 *   - skip words < 6 chars (too easy to false-match)
 *   - skip words that end in common inflections (-ed, -ing, -ly, -er, -est, -ar)
 *   - skip words that end in -s when the de-pluralized form is in CANONICAL
 *   - budget = 1 for 6-char words, 2 for ≥ 7 chars
 *   - require correction to be UNIQUELY closest (no ties)
 */
function nearestCanonical(word: string): string | null {
  if (word.length < 5) return null;
  if (STOPWORDS.has(word)) return null;
  if (CANONICAL.includes(word)) return null;
  // Inflectional endings on length ≥ 6 — almost always real morphology.
  if (/(ed|ing|ly|er|est|ar)$/i.test(word) && word.length >= 6) return null;
  // Plural: if singular form is canonical, leave plural alone.
  if (word.endsWith('s') && CANONICAL.includes(word.slice(0, -1))) return null;
  // Budgets: very tight on short words so we don't false-match.
  const budget = word.length >= 8 ? 3 : word.length >= 6 ? 2 : 1;
  let candidates: { w: string; d: number }[] = [];
  for (const c of CANONICAL) {
    if (Math.abs(c.length - word.length) > budget) continue;
    const d = distance(word, c);
    if (d <= budget) candidates.push({ w: c, d });
  }
  if (candidates.length === 0) return null;
  // Sort by distance ascending.
  candidates.sort((a, b) => a.d - b.d);
  const bestD = candidates[0].d;
  candidates = candidates.filter((x) => x.d === bestD);
  // If all candidates share the same stem (first 4 chars), accept the first.
  // Otherwise it's an ambiguous tie across different stems — reject.
  const stem = (w: string) => w.slice(0, 4);
  const sameStem = candidates.every((x) => stem(x.w) === stem(candidates[0].w));
  if (!sameStem) return null;
  return candidates[0].w;
}

/** Normalize a sentence: lowercase, accent-strip, then replace each word
 *  with its nearest canonical Medicare term if any. Punctuation is
 *  preserved at word boundaries.
 */
export function correctTypos(text: string): string {
  const stripped = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Tokenize on non-letter boundaries, keep separators.
  const tokens = stripped.split(/([^a-z]+)/);
  const out: string[] = [];
  for (const t of tokens) {
    if (!/^[a-z]+$/.test(t)) { out.push(t); continue; }
    const fix = nearestCanonical(t);
    out.push(fix || t);
  }
  return out.join('');
}

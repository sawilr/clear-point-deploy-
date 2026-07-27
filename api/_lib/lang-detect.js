// AUDIT 2026-07-27 (BUG 4b — language mirroring). Live transcripts show Clara
// answering IN ENGLISH to a Spanish message ("Mi mediko no asepta el plan, ke
// ago?") because the reply language came from the SESSION context, not the
// LATEST message. This is the server-side per-message detector: tiny
// function-word scorer (mirrors src/lib/orchestrator/languagePolicy.ts) that
// survives senior typos ("mediko", "ke ago") because it keys on articles,
// pronouns and prepositions, not content words.

const ES_WORDS = new Set([
  'que', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del',
  'al', 'en', 'con', 'por', 'para', 'pero', 'si', 'yo', 'usted', 'mi', 'mis',
  'su', 'sus', 'es', 'son', 'esta', 'estan', 'tengo', 'tiene', 'tienen', 'no',
  'me', 'te', 'se', 'lo', 'le', 'les', 'nos', 'muy', 'mas', 'tambien',
  'porque', 'cuando', 'donde', 'como', 'ya', 'y', 'o', 'pues', 'aqui',
  'puede', 'puedo', 'quiero', 'necesito', 'busco', 'soy', 'hago', 'ago',
  'doctor', 'medico', 'mediko', 'medicina', 'farmacia', 'cobertura', 'asesor',
  'factura', 'carta', 'ayuda', 'hablar', 'gracias', 'pago', 'cobro',
]);

const EN_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'with', 'by', 'is', 'are',
  'was', 'were', 'be', 'been', 'i', 'you', 'he', 'she', 'we', 'they', 'it',
  'my', 'your', 'his', 'her', 'our', 'their', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'can', 'could', 'should', 'must', 'may',
  'and', 'or', 'but', 'so', 'because', 'when', 'where', 'how', 'this', 'that',
  'these', 'those', 'not', 'no', 'what', 'want', 'need', 'help', 'talk',
  'doctor', 'medication', 'pharmacy', 'coverage', 'advisor', 'bill', 'letter',
]);

/**
 * Detect the language of a single message. Returns 'en' | 'es' | null
 * (null = not enough signal; caller falls back to the session language).
 * @param {string} text
 */
export function detectMessageLang(text) {
  if (!text || typeof text !== 'string') return null;
  const stripped = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tokens = stripped.split(/[^a-zñ]+/i).filter((t) => t.length >= 1);
  if (tokens.length === 0) return null;
  let es = 0;
  let en = 0;
  for (const t of tokens) {
    if (ES_WORDS.has(t)) es++;
    if (EN_WORDS.has(t)) en++;
  }
  // Accented characters / inverted punctuation are a strong Spanish signal.
  if (/[ñáéíóú¡¿]/i.test(text)) es += 2;
  const total = es + en;
  if (total === 0) return null;
  if (es > en && es / total >= 0.6) return 'es';
  if (en > es && en / total >= 0.6) return 'en';
  return null;
}

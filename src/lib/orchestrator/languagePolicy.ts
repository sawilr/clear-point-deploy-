// ============================================================================
// PHASE D — LANGUAGE POLICY
//
// Pure helper module owning ALL language-decision logic for the Customer
// Service Assistant.
//
// Owns:
//   • Explicit language-switch detection (priority 2).
//   • Strong full-sentence detection (priority 3).
//   • Weak-token / false-positive guard (priority 4 — never switches).
//   • Step-aware initial selection at the asking_language step (priority 1).
//   • preferred_language mapping for GHL.
//
// Does NOT own:
//   • State writes — caller mutates state.language.
//   • Response copy — handlers / phrase bank own the user-facing strings.
//   • Conversation FSM — the engine owns transitions.
//
// CONTRACT (per Phase D spec):
//
//   Priority 1 — explicit chip selection at asking_language step:
//     "english" / "español" / "spanish" / "in english" / "in spanish"
//     → returns 'en' / 'es' / null
//
//   Priority 2 — explicit switch command anywhere in the conversation:
//     "switch to X" / "habla en X" / "I prefer X" / "X please" /
//     "I don't understand X" / "no entiendo X"
//
//   Priority 3 — strong full-sentence detection (only when state.language
//     is null OR the message clearly indicates the user cannot understand
//     the current language). NOT used to flip locked sessions on a hunch.
//
//   Priority 4 — weak tokens that MUST NEVER switch language by themselves:
//     yes / no / ok / okay / thanks / thank you / gracias / si / sí /
//     hello / hola / good / bien / English / Spanish / Español
//     EXCEPTION: at asking_language step, bare "English" / "Spanish" /
//     "Español" select the language.
//
// Phase F coordination:
//   preferredLanguageForGHL("en") → "English"
//   preferredLanguageForGHL("es") → "Spanish"
//   preferredLanguageForGHL(null) → "Unknown"
// ============================================================================

export type Language = 'en' | 'es' | null;
export type ConversationStep = string; // engine's step name

// ── INTERNAL helpers ────────────────────────────────────────────────────────

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .trim()
    .replace(/[.,!?¡¿]+$/g, '')
    .replace(/\s+/g, ' ');
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ── WEAK-TOKEN GUARD ────────────────────────────────────────────────────────
//
// These tokens look language-flavored but must NEVER trigger a switch on
// their own. They are short acknowledgments, greetings, or thanks that
// happen in either language without indicating a switch intent.

const WEAK_TOKEN_PATTERNS: RegExp[] = [
  /^(yes|no|ok|okay|sure|please)\.?$/i,
  /^(thanks|thank you|thx|ty)\.?$/i,
  /^(gracias|muchas gracias|mil gracias|gracias por todo)\.?$/i,
  /^(si|sí|s[ií] gracias|s[ií] por favor)\.?$/i,
  /^(hello|hi|hey|good morning|good afternoon|good evening)\.?$/i,
  /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches)\.?$/i,
  /^(good|bien|nice|cool|great)\.?$/i,
  // PHASE D rule: bare "english" / "spanish" / "español" must NOT switch
  // unless we are AT the asking_language step (handled by isExplicitInitial).
  /^(english)\.?$/i,
  /^(spanish|espa[ñn]ol)\.?$/i,
];

export function isWeakToken(text: string): boolean {
  const n = normalize(text);
  if (n.length === 0) return true;
  if (n.length > 30) return false;
  for (const re of WEAK_TOKEN_PATTERNS) {
    if (re.test(n)) return true;
  }
  return false;
}

// ── PRIORITY 1 — INITIAL LANGUAGE AT asking_language STEP ───────────────────

const INITIAL_EN_PATTERNS: RegExp[] = [
  /^english$/i,
  /^in english$/i,
  /^english please$/i,
  /^en ingl[eé]s$/i,
];

const INITIAL_ES_PATTERNS: RegExp[] = [
  /^espa[ñn]ol$/i,
  /^spanish$/i,
  /^in spanish$/i,
  /^en espa[ñn]ol$/i,
  /^espa[ñn]ol por favor$/i,
];

/**
 * Return the language selected at the asking_language step. Used ONLY when
 * the bot just asked "English or Spanish?". Outside that step, bare "English"
 * is a weak token (per Phase D rule) — does NOT switch.
 */
export function detectInitialSelection(text: string): Language {
  const n = normalize(text);
  if (!n) return null;
  for (const re of INITIAL_EN_PATTERNS) if (re.test(n)) return 'en';
  for (const re of INITIAL_ES_PATTERNS) if (re.test(n)) return 'es';
  return null;
}

// ── PRIORITY 2 — EXPLICIT SWITCH COMMANDS ──────────────────────────────────
//
// Strict patterns that signal the user wants to switch language. These
// fire anywhere in a message and are intentional. They include:
//   • "speak / habla in X"
//   • "switch / cambia to X"
//   • "I prefer X"
//   • "X please"
//   • "I don't understand X"
//   • "can you speak X"
//   • Family caregiver: "my mom speaks Spanish" / "mi mamá habla español"

const EXPLICIT_ES_PATTERNS: RegExp[] = [
  /\bh[aá]bla(me|r|s)?\s+(en\s+)?espa[ñn]ol\b/i,
  /\bquiero\s+espa[ñn]ol\b/i,
  /\bespa[ñn]ol\s+por\s+favor\b/i,
  /\bcambia(r|me)?\s+(a|al)\s+espa[ñn]ol\b/i,
  /\bswitch\s+to\s+spanish\b/i,
  /\bspeak\s+spanish\b/i,
  /\bin\s+spanish\b/i,
  /\bspanish\s+please\b/i,
  /\bprefiero\s+espa[ñn]ol\b/i,
  /\bi\s+prefer\s+spanish\b/i,
  /\bcan\s+you\s+(speak|talk)\s+spanish\b/i,
  /\bpuede(s|n)?\s+hablar\s+espa[ñn]ol\b/i,
  /\bplease\s+answer\s+in\s+spanish\b/i,
  /\bno\s+entiendo\s+ingl[eé]s\b/i,
  /\bi\s+don'?t\s+understand\s+english\b/i,
  /\bi\s+do\s+not\s+understand\s+english\b/i,
  // Family caregiver: parent speaks Spanish → switch
  /\bmi\s+(mam[aá]|mami|pap[aá]|papi|esposa|esposo|abuela|abuelo|hija?|hijo)\s+habla\s+espa[ñn]ol\b/i,
  /\bmy\s+(mom|mama|mami|dad|papa|wife|husband|grandma|grandpa|daughter|son)\s+(only\s+)?speaks\s+spanish\b/i,
];

const EXPLICIT_EN_PATTERNS: RegExp[] = [
  /\bspeak\s+english\b/i,
  /\benglish\s+please\b/i,
  /\bi\s+prefer\s+english\b/i,
  /\bswitch\s+to\s+english\b/i,
  /\bi\s+don'?t\s+understand\s+spanish\b/i,
  /\bi\s+do\s+not\s+understand\s+spanish\b/i,
  /\bcan\s+you\s+(speak|talk)\s+english\b/i,
  /\bplease\s+answer\s+in\s+english\b/i,
  /\bin\s+english\b/i,
  /\bh[aá]bla(me|r|s)?\s+(en\s+)?ingl[eé]s\b/i,
  /\bcambia(r|me)?\s+(a|al)\s+ingl[eé]s\b/i,
  /\bprefiero\s+ingl[eé]s\b/i,
  /\bno\s+entiendo\s+espa[ñn]ol\b/i,
  // Family caregiver: parent speaks English
  /\bmi\s+(mam[aá]|mami|pap[aá]|papi|esposa|esposo|abuela|abuelo|hija?|hijo)\s+(solo\s+)?habla\s+ingl[eé]s\b/i,
  /\bmy\s+(mom|mama|dad|papa|wife|husband|grandma|grandpa|daughter|son)\s+(only\s+)?speaks\s+english\b/i,
];

export function detectExplicitSwitch(text: string): Language {
  if (!text) return null;
  // Weak tokens never trigger an explicit switch.
  if (isWeakToken(text)) return null;
  // Anti-false-positive: "yes I prefer English" while ALREADY in English
  // is handled at the caller — this function only reports the requested
  // language, not whether to act. Caller checks: detected !== current.
  for (const re of EXPLICIT_ES_PATTERNS) if (re.test(text)) return 'es';
  for (const re of EXPLICIT_EN_PATTERNS) if (re.test(text)) return 'en';
  return null;
}

// ── PRIORITY 3 — STRONG MESSAGE-LANGUAGE DETECTION ──────────────────────────
//
// Used ONLY when state.language is null (no prior lock). A full sentence
// in one language strongly suggests that's the user's preferred language.
// NEVER used to flip an already-locked session.

const ES_FUNCTION_WORDS = new Set([
  'que', 'qué', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'a', 'en', 'con', 'por', 'para', 'pero', 'si', 'sí',
  'yo', 'tu', 'tú', 'él', 'ella', 'usted', 'nosotros', 'ustedes',
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'es', 'son', 'está', 'esta',
  'están', 'tengo', 'tiene', 'tienen', 'no', 'me', 'te', 'se', 'lo',
  'le', 'les', 'nos', 'muy', 'más', 'también', 'porque', 'cuando',
  'donde', 'como', 'ya', 'y', 'o', 'pues', 'aqui', 'aquí', 'allí',
  'doctor', 'doctora', 'médico', 'medicina', 'farmacia', 'cobertura',
  'asesor', 'factura', 'carta', 'plan', 'cliente', 'cobertura',
  'puede', 'puedo', 'quiero', 'necesito', 'busco', 'tengo', 'soy',
]);

const EN_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'for', 'on', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'you', 'he', 'she', 'we', 'they', 'it',
  'my', 'your', 'his', 'her', 'our', 'their', 'its',
  'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'can', 'could', 'should', 'must', 'may', 'might',
  'and', 'or', 'but', 'so', 'because', 'when', 'where', 'how',
  'this', 'that', 'these', 'those',
  'not', 'no',
  'doctor', 'medication', 'pharmacy', 'coverage', 'advisor',
  'bill', 'letter', 'plan', 'client', 'help',
  'want', 'need', 'looking', 'going', 'trying',
]);

export interface MessageLanguageScore {
  language: Language;
  score: number;       // 0-1 confidence
  tokenCount: number;
}

/**
 * Best-guess language of a free-text message. Returns a confidence score.
 * Caller should only act on the result when state.language is null or there
 * is a separate explicit signal — message-language alone never flips a
 * locked session (Phase D rule).
 */
export function detectMessageLanguage(text: string): MessageLanguageScore {
  const stripped = stripAccents(normalize(text));
  if (!stripped) return { language: null, score: 0, tokenCount: 0 };
  const tokens = stripped.split(/[^a-zñ]+/i).filter((t) => t.length >= 2);
  if (tokens.length === 0) return { language: null, score: 0, tokenCount: 0 };
  let esHits = 0;
  let enHits = 0;
  for (const t of tokens) {
    if (ES_FUNCTION_WORDS.has(t)) esHits++;
    if (EN_FUNCTION_WORDS.has(t)) enHits++;
  }
  // Strong accent characters in the ORIGINAL text bias toward Spanish.
  if (/[ñáéíóú¡¿]/.test(text)) esHits += 2;
  const total = esHits + enHits;
  if (total === 0) return { language: null, score: 0, tokenCount: tokens.length };
  if (esHits > enHits) {
    return { language: 'es', score: esHits / total, tokenCount: tokens.length };
  }
  if (enHits > esHits) {
    return { language: 'en', score: enHits / total, tokenCount: tokens.length };
  }
  return { language: null, score: 0.5, tokenCount: tokens.length };
}

// ── CANONICAL DECISION FUNCTION ─────────────────────────────────────────────
//
// Single entry point: given the user message + current language + step,
// returns the new language (or null to mean "no change"). Encodes the
// full priority order.

export interface ResolveLanguageInput {
  text: string;
  currentLanguage: Language;
  step?: ConversationStep;
}

export interface ResolveLanguageResult {
  /** New language (or null if no change). */
  newLanguage: Language;
  /** Why the decision was taken — for logging / lead notes. */
  reason:
    | 'no_change'
    | 'initial_selection'
    | 'explicit_switch'
    | 'strong_message_lang_initial_lock'
    | 'weak_token_no_switch'
    | 'already_in_requested_language';
}

export function resolveLanguage(input: ResolveLanguageInput): ResolveLanguageResult {
  const { text, currentLanguage, step } = input;
  if (!text || !text.trim()) {
    return { newLanguage: null, reason: 'no_change' };
  }

  // PRIORITY 1 — initial selection at asking_language step.
  if (step === 'asking_language' || !currentLanguage) {
    const initial = detectInitialSelection(text);
    if (initial) {
      return { newLanguage: initial, reason: 'initial_selection' };
    }
  }

  // PRIORITY 2 — explicit switch command (anywhere in conversation).
  const explicit = detectExplicitSwitch(text);
  if (explicit) {
    if (explicit === currentLanguage) {
      // "yes I prefer English" while already in English → not a switch
      return { newLanguage: null, reason: 'already_in_requested_language' };
    }
    return { newLanguage: explicit, reason: 'explicit_switch' };
  }

  // PRIORITY 3 — strong message-language detection, only when no lock yet.
  if (currentLanguage === null) {
    const detected = detectMessageLanguage(text);
    // Require ≥ 3 tokens AND ≥ 60% one-language signal.
    if (detected.language && detected.tokenCount >= 3 && detected.score >= 0.6) {
      return {
        newLanguage: detected.language,
        reason: 'strong_message_lang_initial_lock',
      };
    }
  }

  // PRIORITY 4 — weak tokens NEVER switch on their own. The function
  // already early-returned if a strong signal was present, so any remaining
  // case is "no change". Tag the reason for diagnostics.
  if (isWeakToken(text)) {
    return { newLanguage: null, reason: 'weak_token_no_switch' };
  }

  return { newLanguage: null, reason: 'no_change' };
}

// ── PHASE F COORDINATION — preferred_language for GHL ────────────────────────

export function preferredLanguageForGHL(language: Language): 'English' | 'Spanish' | 'Unknown' {
  if (language === 'en') return 'English';
  if (language === 'es') return 'Spanish';
  return 'Unknown';
}

// ── LANGUAGE-AWARE ACKNOWLEDGMENT (called by engine on switch) ──────────────
//
// Single source for the "Continuing in X" sentence. Engine handlers can
// either prepend this or use it alone — but only the new locked language
// version is ever returned. Never bilingual.

export function switchAcknowledgment(newLanguage: Exclude<Language, null>): string {
  if (newLanguage === 'es') return 'Claro. Seguimos en español.';
  return "Of course. We'll continue in English.";
}

// ── COMPLIANCE PHRASES (language-locked) ────────────────────────────────────
//
// Safe phrases that the engine and handlers can reuse. Returning them via
// a helper guarantees they always match state.language.

export interface SafeComplianceCopy {
  advisorCanVerify: string;
  coverageDepends: string;
  collectIssue: string;
  independentAgency: string;
}

export function safeComplianceCopy(language: Exclude<Language, null>): SafeComplianceCopy {
  if (language === 'es') {
    return {
      advisorCanVerify: 'Un asesor licenciado puede verificar eso.',
      coverageDepends: 'La cobertura depende del plan, condado, farmacia, formulario y la información disponible al momento.',
      collectIssue: 'Puedo tomar la información básica para que un asesor revise el caso.',
      independentAgency: 'Clear Point Senior Advisors es una agencia independiente. No estamos conectados con Medicare ni con el gobierno federal.',
    };
  }
  return {
    advisorCanVerify: 'A licensed advisor can verify that.',
    coverageDepends: 'Coverage depends on the plan, county, pharmacy, formulary, and current information.',
    collectIssue: 'I can help collect the issue so an advisor can review it.',
    independentAgency: 'Clear Point Senior Advisors is an independent agency, not connected with Medicare or the federal government.',
  };
}

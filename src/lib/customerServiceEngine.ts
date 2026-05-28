// ============================================================================
// CUSTOMER SERVICE ENGINE V20 — ISSUE-FIRST, IDENTITY AT HANDOFF
//
// World-class pattern (Intercom Fin, Klarna, Botpress 2026):
//   language → topic chips → conversation → (only at handoff) identity.
//
// Name + ZIP are NEVER required to start helping the user. They are
// collected at the END only when the user requests advisor follow-up.
// ============================================================================

export type Language = 'en' | 'es' | null;

export type ConversationStep =
  | 'asking_language'
  | 'asking_topic'          // V20: step 2 — show 7 topic chips, gather intent
  | 'asking_name'           // legacy / identity at handoff
  | 'asking_zip'            // legacy / identity at handoff
  | 'asking_problem'        // legacy
  | 'conversation'
  | 'collecting_identity';  // V20: terminal pre-handoff (name → phone)

// V20 — topic chips shown immediately after language pick.
export const TOPIC_CHIPS_EN = [
  'Bill',
  'Letter',
  'Coverage',
  'Medications',
  'Doctor/Provider',
  'Enrollment',
  'Talk to advisor',
] as const;

export const TOPIC_CHIPS_ES = [
  'Factura',
  'Carta',
  'Cobertura',
  'Medicamentos',
  'Doctor/Proveedor',
  'Inscripción',
  'Hablar con asesor',
] as const;

export interface ConversationState {
  conversationId: string;
  step: ConversationStep;
  language: Language;
  name?: string;
  zipCode?: string;
  state?: string; // NY, NJ, FL, CT, or unknown
  isValidState: boolean;
  messages: { role: 'user' | 'bot'; content: string; timestamp: number }[];
  currentProblem: string;
  intent: string;
  emotionalState: string;
  turnCount: number;
  needsHuman: boolean;
  // ─── Wave 17: context memory across turns ───
  /** Source of the bill once the user names it. Set once, used forever. */
  billSource?: 'provider' | 'pharmacy' | 'plan' | 'unknown';
  /** True if user mentioned having BOTH Medicaid + Medicare (dual eligible). */
  dualEligible?: boolean;
  /** Most recent dollar amount the user mentioned. */
  amountMentioned?: string;
  // ─── Wave 18: fraud / data-quality detection ───
  /** True if the name passed validation (length, characters, not suspicious). */
  nameIsValid?: boolean;
  /** True if the ZIP code passed validation (5 digits + service-area prefix). */
  zipCodeIsValid?: boolean;
  /** Two-letter state code the user TYPED ("I live in FL" / "vivo en NY"). */
  stateDeclaredByUser?: string;
  /** Phone number once captured (normalized to 10 digits). */
  phoneNumber?: string;
  /** Set when ZIP + declared state disagree, or when name/ZIP/phone fail validation. */
  probableFakeLead?: boolean;
  /** Human-readable inconsistency list for the advisor to review. */
  inconsistencies?: string[];
  /** 0-100. Starts at 100 and decreases each time data validation fails. */
  dataConfidenceScore?: number;
  // ─── Wave 19: conversation recovery ───
  /** Times the caller failed to enter a valid ZIP. After 2 we stop asking. */
  failedZipAttempts?: number;
  /** Times the caller failed to enter a usable name. */
  failedNameAttempts?: number;
  /** Times the caller used abusive/frustrated/profane language. */
  frustrationCount?: number;
  /** True once we drop the rigid form and offer chip-driven help. */
  recoveryMode?: boolean;
  /** Last bot prompt — used to detect repeated prompt loops. */
  lastBotPrompt?: string;
  /** Times the bot has shown the same prompt back-to-back. */
  repeatedSamePromptCount?: number;
  /** Quick-reply chip labels the UI should render right now. */
  quickReplies?: string[];
  // ─── Wave 20: deferred identity collection ───
  /** Set when the user picked "Talk to advisor" — engine collects name + ZIP
   *  and then finalizes (needsHuman=true) instead of bouncing to triage. */
  pendingAdvisorHandoff?: boolean;
}

// ── ZIP prefix → state. NY/NJ/FL/CT only (ClearPoint service area). ──
const VALID_ZIP_PATTERNS: Record<string, string[]> = {
  NY: ['100','101','102','103','104','105','106','107','108','109','110','111','112','113','114','115','116','117','118','119','120','121','122','123','124','125','126','127','128','129','130','131','132','133','134','135','136','137','138','139','140','141','142','143','144','145','146','147','148','149'],
  NJ: ['070','071','072','073','074','075','076','077','078','079','080','081','082','083','084','085','086','087','088','089'],
  FL: ['320','321','322','323','324','325','326','327','328','329','330','331','332','333','334','335','336','337','338','339','340','341','342','343','344','346','347','349'],
  CT: ['060','061','062','063','064','065','066','067','068','069'],
};

function getStateFromZip(zip: string): string | null {
  const prefix = zip.substring(0, 3);
  for (const [state, prefixes] of Object.entries(VALID_ZIP_PATTERNS)) {
    if (prefixes.includes(prefix)) return state;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 21 — SAFETY HELPERS
//
// Bot must NEVER show "undefined" / "null" / "NaN" / "[object Object]" in
// user-facing copy. Every name interpolation goes through safeName/withName.
// Every final response is run through sanitizeResponse before display.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns name only if defined + non-empty + not a placeholder. */
export function safeName(name?: string | null): string {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'undefined' || lower === 'null' || lower === 'nan' || lower === '[object object]') return '';
  return trimmed;
}

/** Returns ", Name" if name is safe, "" otherwise. Use as suffix inside templates. */
export function withName(name?: string | null): string {
  const n = safeName(name);
  return n ? `, ${n}` : '';
}

/** Final guard before any bot response reaches the user. */
export function sanitizeResponse(text: string, fallbackEs: boolean): string {
  if (!text || typeof text !== 'string' || text.trim() === '') {
    return fallbackEs
      ? 'Perdón, no pude procesar eso bien. Vamos a hacerlo simple: ¿es sobre factura, carta, cobertura, medicamentos, doctor/proveedor o inscripción?'
      : "Sorry, I could not process that clearly. Let's make it simple: is this about a bill, letter, coverage, medications, doctor/provider, or enrollment?";
  }
  // Strip stray "undefined" / "null" tokens that may leak from a broken template.
  let cleaned = text
    .replace(/,\s*undefined\b/gi, '')
    .replace(/\bundefined\b/gi, '')
    .replace(/\bnull\b/g, '')
    .replace(/\bNaN\b/g, '')
    .replace(/\[object Object\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
  if (!cleaned) {
    return fallbackEs
      ? 'Perdón, no pude procesar eso bien. Vamos a hacerlo simple: ¿es sobre factura, carta, cobertura, medicamentos, doctor/proveedor o inscripción?'
      : "Sorry, I could not process that clearly. Let's make it simple: is this about a bill, letter, coverage, medications, doctor/provider, or enrollment?";
  }
  return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 21 — FUZZY TYPO MATCHER (Damerau-Levenshtein)
//
// Catches misspellings BEFORE intent detection runs. Examples:
//   hopital, ospital, hospitl, hostpital → hospital
//   facyuta, factuta, fatura, facura     → factura
//   farmasia, farmacai, pharmcy          → farmacia
//   dotor, doctol, médico                → doctor
//   medicare typos, medicaid typos, etc.
// ─────────────────────────────────────────────────────────────────────────────

/** Damerau-Levenshtein distance — counts insert/delete/substitute + adjacent swap. */
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
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

/** Maps canonical concept → list of accepted forms (also matches close typos). */
const FUZZY_CONCEPTS: Record<string, string[]> = {
  hospital: ['hospital', 'hospitals', 'ospital', 'hopital', 'hospita', 'hostpital', 'hospitl', 'hospitall', 'hospitales', 'er', 'emergency room', 'sala de emergencias'],
  pharmacy: ['farmacia', 'farmacias', 'farmasia', 'farmacai', 'pharmacy', 'pharmcy', 'pharmacia', 'drogueria', 'droguería', 'cvs', 'walgreens', 'walmart', 'rite aid'],
  doctor:   ['doctor', 'doctors', 'doctora', 'doctoras', 'dotor', 'doctol', 'medico', 'médico', 'medica', 'médica', 'physician', 'provider', 'specialist', 'especialista', 'pcp'],
  bill:     ['bill', 'bills', 'billes', 'bil', 'factura', 'facturas', 'facyuta', 'factuta', 'fatura', 'facura', 'cobro', 'cobros', 'cuenta', 'cuentas', 'invoice'],
  letter:   ['letter', 'lettter', 'leter', 'carta', 'cartas', 'carra', 'aviso', 'avisos', 'notice', 'notification'],
  plan:     ['plan', 'planes', 'plans', 'medicare plan', 'plan de medicare', 'mi plan', 'el plan'],
  medicare: ['medicare', 'medicar', 'medicare', 'medeicare', 'mediare', 'medicarie'],
  medicaid: ['medicaid', 'medicaide', 'medicad', 'medicadi', 'medi-cal'],
};

/**
 * Returns the canonical concept name if any token in `text` fuzzy-matches one
 * of its accepted forms within Damerau-Levenshtein distance ≤ 1 for short
 * words and ≤ 2 for longer words. Stops at the first match found.
 */
export function fuzzyConcept(text: string): string | null {
  const cleaned = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const tokens = cleaned.split(/[^a-z0-9]+/i).filter((t) => t.length >= 2);
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [concept, forms] of Object.entries(FUZZY_CONCEPTS)) {
    for (const form of forms) {
      // Exact word-boundary match (NOT substring — "medica" must not match inside "medicamentos").
      // Allow either real word boundary or single-word match.
      if (new RegExp(`(?:^|\\W)${escapeRe(form)}(?:$|\\W)`, 'i').test(cleaned)) return concept;
      // Fuzzy at token level — only for tokens of similar length to avoid
      // matching short forms inside long unrelated words.
      for (const tok of tokens) {
        // Length must be within 2 to even consider — prevents "medicamentos"
        // matching "medico" via giant edit count.
        if (Math.abs(tok.length - form.length) > 2) continue;
        const dist = damerauLevenshtein(tok, form);
        const allow = form.length <= 4 ? 1 : form.length <= 7 ? 1 : 2;
        if (dist <= allow) return concept;
      }
    }
  }
  return null;
}

/**
 * Wave 21 — parses dollar amounts in many human formats:
 *   $10,000  $10.50  10 dollars  10 dolares  10k  10K  10 mil  10000
 *   $10.5k   diez mil (limited)
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.toLowerCase().replace(/[,]/g, '');
  // "10k" / "10K" / "$10k" / "1.5k"
  const kMatch = cleaned.match(/\$?\s*(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  // "10 mil"
  const milMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*mil\b/);
  if (milMatch) return Math.round(parseFloat(milMatch[1]) * 1000);
  // "$10000" / "$10000.50"
  const dollarMatch = cleaned.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch) return Math.round(parseFloat(dollarMatch[1]));
  // "10 dolares" / "10 dollars" / "10 de copay"
  const wordMatch = cleaned.match(/(\d+(?:\.\d{1,2})?)\s*(d[oó]lares?|dollars?|de copay|de copago|copay|copago)/);
  if (wordMatch) return Math.round(parseFloat(wordMatch[1]));
  // Bare number ≥ 4 digits — likely a dollar figure
  const bareMatch = cleaned.match(/\b(\d{4,7})\b/);
  if (bareMatch) return parseInt(bareMatch[1], 10);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 18 — VALIDATORS (anti-fraud / data quality)
//
// The bot never accuses the caller. It just records inconsistencies so the
// licensed advisor sees the lead quality before reaching out.
// ─────────────────────────────────────────────────────────────────────────────

const SUSPICIOUS_NAMES = new Set([
  // Classic placeholders
  'test', 'prueba', 'aaa', 'bbb', 'ccc', '123', 'asdf', 'qwerty', 'qwertyu',
  'user', 'admin', 'nombre', 'name', 'fake', 'falso', 'sample', 'demo',
  'foo', 'bar', 'baz', 'xxx', 'yyy', 'zzz', 'null', 'undefined',
  // V20 — common throwaway placeholders the user types instead of a real name
  'toto', 'tata', 'titi', 'nono', 'nooo', 'noo', 'nope', 'yes', 'si', 'sí',
  'no', 'ok', 'okay', 'k', 'a', 'b', 'c', 'd', 'x', 'q', 'qq',
  'hola', 'hello', 'hi', 'hey', 'sup',
  // Insults that callers sometimes type into the name field
  'idiota', 'pendejo', 'cabron', 'culero', 'mierda', 'puta',
  'idiot', 'stupid', 'dumb', 'asshole', 'fuck', 'shit',
]);

export function validateName(raw: string): { isValid: boolean; cleaned: string; reason?: string } {
  const lettersOnly = raw.trim().replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ\s-']/g, '');
  if (!lettersOnly || lettersOnly.length < 2) {
    return { isValid: false, cleaned: '', reason: 'too_short' };
  }
  if (lettersOnly.length > 30) {
    return { isValid: false, cleaned: lettersOnly.slice(0, 30), reason: 'too_long' };
  }
  const lower = lettersOnly.toLowerCase();
  if (SUSPICIOUS_NAMES.has(lower)) {
    return { isValid: false, cleaned: lettersOnly, reason: 'suspicious_name' };
  }
  // Reject all-same-character ("AAA" etc.) and obvious keyboard rolls.
  if (/^([a-z])\1+$/i.test(lower)) {
    return { isValid: false, cleaned: lettersOnly, reason: 'repeated_chars' };
  }
  return { isValid: true, cleaned: lettersOnly.charAt(0).toUpperCase() + lettersOnly.slice(1).toLowerCase() };
}

const FAKE_PHONES = new Set([
  '1234567890', '0000000000', '1111111111', '2222222222', '3333333333',
  '4444444444', '5555555555', '6666666666', '7777777777', '8888888888',
  '9999999999', '0123456789',
]);

export function validatePhone(raw: string): { isValid: boolean; cleaned: string; reason?: string } {
  const digits = raw.replace(/\D/g, '');
  let normalized = digits;
  if (normalized.length === 11 && normalized.startsWith('1')) normalized = normalized.slice(1);
  if (normalized.length !== 10) return { isValid: false, cleaned: normalized, reason: 'invalid_length' };
  if (FAKE_PHONES.has(normalized)) return { isValid: false, cleaned: normalized, reason: 'fake_number' };
  // Area-code must not start with 0 or 1 (NANP rule).
  if (/^[01]/.test(normalized)) return { isValid: false, cleaned: normalized, reason: 'invalid_area_code' };
  // Exchange code (digits 4-6) must not start with 0 or 1 either.
  if (/^.{3}[01]/.test(normalized)) return { isValid: false, cleaned: normalized, reason: 'invalid_exchange' };
  return { isValid: true, cleaned: normalized };
}

/**
 * Detects what state the user TYPED (separate from the ZIP-derived state).
 * Looks for "I live in FL", "vivo en Nueva York", "estoy en New Jersey", etc.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {
  'new york': 'NY', 'nueva york': 'NY', 'ny': 'NY',
  'new jersey': 'NJ', 'nueva jersey': 'NJ', 'nj': 'NJ',
  'connecticut': 'CT', 'ct': 'CT',
  'florida': 'FL', 'fl': 'FL',
};
export function detectDeclaredState(text: string): string | null {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = lower.match(/\b(?:vivo en|i live in|estoy en|i am in|live in|en el estado de|in the state of)\s+([a-z ]{2,20})/);
  if (!m) return null;
  const candidate = m[1].trim();
  // Try longest match first
  const keys = Object.keys(STATE_NAME_TO_CODE).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (candidate.startsWith(k) || candidate === k) return STATE_NAME_TO_CODE[k];
  }
  return null;
}

/** Decrements the running data-confidence score and records the inconsistency. */
function flagInconsistency(state: ConversationState, reason: string, penalty: number): void {
  state.probableFakeLead = true;
  state.inconsistencies = [...(state.inconsistencies || []), reason];
  state.dataConfidenceScore = Math.max(0, (state.dataConfidenceScore ?? 100) - penalty);
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 19 — CONVERSATION RECOVERY LAYER
//
// Detects when the caller is frustrated, abusive, cursing, or just stuck —
// at which point the bot stops acting like a rigid form (no more "please
// enter a 5-digit ZIP" on a loop) and offers chip-driven help instead.
// Priority order (highest first):
//   1. medical emergency / safety  →  911
//   2. grieving / death            →  Social Security number
//   3. anger / abuse / frustration →  RECOVERY MODE + chips
//   4. "talk to advisor"           →  escalate
//   5. actual Medicare topic       →  triage even without ZIP
//   6. ZIP / name / contact        →  only after the above
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the message contains profanity, insult, or clear frustration
 * markers in EN or ES. We are deliberately generous — false positives just
 * trigger a kinder fallback, false negatives leave the user stuck in a loop.
 */
export function detectAbuseOrFrustration(text: string): {
  detected: boolean;
  severity: 'mild' | 'severe';
} {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Severe — profanity / direct insults.
  const severe =
    /\b(maldita madre|tu madre|mama? ?guevo|mama? ?huevo|mamagueva|mmgvaso|mmgveo|mmgvazo|hijo de puta|hdp|hp|idiota|pendejo|estupido|estupida|qu[eé] mierda|mierda|joder|cono|carajo|verga|culero|cabron|cabrona|fuck|fucking|shit|damn|asshole|dumbass|bullshit|retarded|fuck off|fuck you|piss off)\b/i;
  if (severe.test(lower)) return { detected: true, severity: 'severe' };
  // Mild — frustration markers without profanity.
  const mild =
    /(no entiende[ns]?|no me entiende[ns]?|no entiendes nada|esto no sirve|no sirve|este chat (es )?(malo|inutil)|in[uú]til|estoy harto|estoy cansado|estoy frustrado|estoy enojado|estoy furioso|me tienes harto|no me ayuda[ns]?|tonto|tonta|you do(n['’]| no)t understand|this is stupid|this is useless|this is(n['’]| no)t working|this is dumb|this is broken|i['’]?m frustrated|i am frustrated|i give up|forget it|whatever)/i;
  if (mild.test(lower)) return { detected: true, severity: 'mild' };
  // V20 — soft refusals that signal disengagement. "nooo" / "ya no" / "no quiero"
  // are not insults but still mean the form is failing. Treat as mild.
  const soft = /^(no+|nope|nah|no quiero|ya no|d[eé]jalo|d[eé]jeme|leave me alone)\.?$/i;
  if (soft.test(lower.trim())) return { detected: true, severity: 'mild' };
  return { detected: false, severity: 'mild' };
}

/**
 * V20 — strict language switch detector. Only fires on an EXACT, intentional
 * request. "factura" alone does NOT switch a Spanish-locked session to
 * English just because of a single Spanish word in an English text.
 */
export function detectExplicitLanguageSwitch(text: string): 'en' | 'es' | null {
  const t = text.toLowerCase().trim().replace(/[.,!?]+$/, '');
  if (/^(english|in english|switch to english|speak english|h[aá]bla(me|r)? (en )?ingl[eé]s|english please|cambiar a ingl[eé]s|cambiar al ingl[eé]s)$/i.test(t)) return 'en';
  if (/^(espa[ñn]ol|spanish|in spanish|switch to spanish|h[aá]bla(me|r)? (en )?espa[ñn]ol|speak spanish|spanish please|cambiar a espa[ñn]ol|cambiar al espa[ñn]ol)$/i.test(t)) return 'es';
  return null;
}

/** V20 — recovery menu + chip labels using Sawil's exact spec wording. */
function getRecoveryResponse(state: ConversationState): { response: string; chips: string[] } {
  const isSpanish = state.language === 'es';
  if (isSpanish) {
    const sn = safeName(state.name);
    const opener = sn
      ? `Entiendo que está molesto, ${sn}. Vamos a hacerlo más fácil.`
      : 'Entiendo que está molesto. Vamos a hacerlo más fácil.';
    return {
      response: `${opener} No le voy a pedir ZIP ni información personal ahora. ¿Qué necesita revisar?`,
      chips: [...TOPIC_CHIPS_ES],
    };
  }
  const snEn = safeName(state.name);
  const opener = snEn
    ? `I understand you're frustrated, ${snEn}. Let's make this easier.`
    : "I understand you're frustrated. Let's make this easier.";
  return {
    response: `${opener} I won't ask for ZIP or personal information right now. What do you need help with?`,
    chips: [...TOPIC_CHIPS_EN],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 23 — INTERRUPTION HANDLING LAYER
//
// A real human customer service agent can be interrupted at ANY moment:
//   · "wait, let me check" → pause, don't advance
//   · "actually it's $1,000 not $10,000" → accept correction, update slot
//   · "what is IRMAA?" → drop the current question, explain plainly, resume
//   · "I'd rather talk to an advisor" → escalate immediately
//   · sudden topic switch ("oh and also about medications") → switch context
//
// These detectors run BEFORE the step-specific logic so they can override
// the form-style flow at any turn.
// ─────────────────────────────────────────────────────────────────────────────

/** "wait, give me a sec" / "espere", "déjeme ver". User wants to pause. */
export function detectPauseRequest(text: string): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (t.length > 80) return false; // long messages aren't pauses
  return /\b(espere|esperar|esperate|esperame|dame un (segundo|momento|minuto|ratito|toque)|dejeme ver|dejame ver|un (segundo|momento|minuto|momentito|ratito)|momentito|ahorita|wait|wait a (sec|second|moment|minute)|hold on|hang on|one (sec|second|moment|minute)|give me a (sec|second|moment|minute)|let me (check|look|see|grab|find))\b/i.test(t);
}

/** "actually it was $1,000", "no era X era Y", "perdón, me corrijo". */
export function detectCorrection(text: string): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /\b(perdon|disculpe|me corrijo|en realidad|no era|no es eso|en lugar de|mejor dicho|quise decir|quería decir|de hecho|actually|wait no|i meant|i mean to say|in fact|correction|let me correct|sorry i meant)\b/i.test(t);
}

/** "what is IRMAA?" / "¿qué significa amount due?". Wants a definition. */
export function detectClarificationRequest(text: string): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\?\s*$/.test(t) && t.length < 80) {
    if (/\b(que (es|significa|quiere decir)|que es eso|que significa eso|no entiendo|no entendi|no comprendo|como|how|what (is|does|do)|what['']s|explique|expliqueme|me explica|explain|clarify|can you (tell|explain)|repita|repeat|otra vez)\b/i.test(t)) {
      return true;
    }
  }
  return false;
}

/**
 * True when intent shifted to a clearly different topic.
 * bill ↔ drug are NOT a switch — a pharmacy bill is both a bill and a drug issue.
 * Same for coverage ↔ drug (coverage of meds).
 */
function isTopicSwitch(oldIntent: string | undefined, newRaw: string): boolean {
  if (!oldIntent) return false;
  // Group related topics — switches only fire across groups.
  const groupFor = (t: string): string => {
    if (t === 'bill' || t === 'drug') return 'money_or_drugs';
    if (t === 'letter') return 'letter';
    if (t === 'coverage') return 'coverage';
    if (t === 'enrollment') return 'enrollment';
    if (t === 'appeal') return 'appeal';
    return 'other';
  };
  const oldGroup = groupFor(oldIntent);
  const newGroup = groupFor(newRaw);
  if (oldGroup === 'other' || newGroup === 'other') return false;
  return oldGroup !== newGroup;
}

/** Switch the conversation into recovery mode with chips. Mutates `state`. */
function enterRecoveryMode(
  state: ConversationState,
  reason: 'frustration' | 'zip_loop' | 'name_loop' | 'prompt_loop',
): { response: string; newState: ConversationState; needsHuman: boolean } {
  state.recoveryMode = true;
  state.step = 'conversation';
  const rec = getRecoveryResponse(state);
  state.quickReplies = rec.chips;
  state.lastBotPrompt = rec.response;
  state.inconsistencies = [...(state.inconsistencies || []), `recovery_${reason}`];
  state.messages.push({ role: 'bot', content: rec.response, timestamp: Date.now() });
  return { response: rec.response, newState: state, needsHuman: false };
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createInitialState(): ConversationState {
  return {
    conversationId: makeId(),
    step: 'asking_language',
    language: null,
    messages: [],
    currentProblem: '',
    intent: '',
    emotionalState: 'calm',
    turnCount: 0,
    needsHuman: false,
    isValidState: false,
    nameIsValid: false,
    zipCodeIsValid: false,
    probableFakeLead: false,
    inconsistencies: [],
    dataConfidenceScore: 100,
    // Wave 19
    failedZipAttempts: 0,
    failedNameAttempts: 0,
    frustrationCount: 0,
    repeatedSamePromptCount: 0,
    recoveryMode: false,
    quickReplies: [],
  };
}

// Auto-correction of common misspellings + Spanglish normalization.
function normalizeText(text: string): string {
  const corrections: Record<string, string> = {
    mellgaron: 'me llegaron',
    mellegaron: 'me llegaron',
    billes: 'bills',
    bils: 'bills',
    recivos: 'recibos',
    resivos: 'recibos',
    facturua: 'factura',
    medicamentoos: 'medicamentos',
    cobertrua: 'cobertura',
    doctro: 'doctor',
    farmacai: 'farmacia',
    cartta: 'carta',
    renovcaion: 'renovación',
    medicadi: 'medicaid',
    medicarie: 'medicare',
    medecare: 'medicare',
    medisina: 'medicina',
  };
  let normalized = text.toLowerCase();
  for (const [wrong, correct] of Object.entries(corrections)) {
    normalized = normalized.replace(new RegExp(wrong, 'gi'), correct);
  }
  return normalized;
}

function detectProblemType(text: string): string {
  const normalized = normalizeText(text);
  // Wave 19: explicit "talk to advisor" trumps every topic so the user can
  // bail out at any moment.
  if (/\b(hablar con (un |una )?(asesor|asesora|agente|persona|humano)|necesito (un |una )?(asesor|asesora|agente)|qu[ie]ero (un |una )?(asesor|asesora|agente)|talk to (a |an )?(advisor|agent|representative|person|human|live person)|speak (to|with) (a |an )?(advisor|agent|representative|person|human)|get me (a |an )?(advisor|agent|representative|human)|live agent|real person)\b/i.test(normalized)) return 'advisor';
  // Order matters — most specific / highest priority first. Appeals/grievances
  // and enrollment changes win over generic drug/letter mentions.
  if (/\b(apelaci[oó]n|apelar|appeal|appeals|reconsideration|fair hearing|grievance|queja|denied|negado|rejected)\b/i.test(normalized)) return 'appeal';
  if (/\b(inscripci[oó]n|enrollment|disenroll|disenrollment|sep|aep|iep)\b/i.test(normalized)) return 'enrollment';
  // "change/switch [my|the|another|my own] plan(s)" — allow up to 2 words between
  if (/\b(change|switch|cambiar|cambiarme)\b(?:\s+\w+){0,2}\s+\b(plan|plans|planes)\b/i.test(normalized)) return 'enrollment';
  if (/\b(bill|bills|factura|facturas|cobro|cobros|premium|prima|copay|copago|deductible|eob)\b/i.test(normalized)) return 'bill';
  if (/\b(carta|cartas|letter|notice|aviso|anoc|eoc|renovaci[oó]n|renewal|medicaid notice|extra help notice|irmaa)\b/i.test(normalized)) return 'letter';
  if (/\b(medication|medications|medicamento|medicamentos|medicina|medicinas|pastilla|pastillas|drug|drugs|pharmacy|farmacia|prescription|receta)\b/i.test(normalized)) return 'drug';
  if (/\b(doctor|doctora|provider|hospital|cl[ií]nica|cobertura|coverage|red|network|specialist|especialista)\b/i.test(normalized)) return 'coverage';
  if (/\b(gracias|thank|thanks|hola|hello|hi|hey)\b/i.test(normalized) && normalized.length < 30) return 'casual';
  return 'general';
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 17 — CONTEXT MEMORY HELPERS
//
// Scan the FULL user-message history so the bot never re-asks for something
// the caller already said. Each helper looks at every prior user turn (plus
// the current message) and returns what's been established so far.
// ─────────────────────────────────────────────────────────────────────────────

function fullUserHistory(state: ConversationState, currentMessage: string): string {
  const past = state.messages.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
  return normalizeText(past + ' ' + currentMessage);
}

function detectBillSource(history: string): 'provider' | 'pharmacy' | 'plan' | null {
  // V21 — fuzzy match catches typos: hopital, facyuta, farmasia, dotor, etc.
  // Exact regex still runs first for speed.
  // Pharmacy wins over generic plan if both appear.
  if (/\b(farmacia|pharmacy|drug ?store|cvs|walgreens|walmart pharmacy|de la farmacia|from (the )?pharmacy)\b/i.test(history)) return 'pharmacy';
  if (/\b(doctor|doctora|m[eé]dico|hospital|cl[ií]nica|provider|specialist|especialista|del m[eé]dico|del hospital|from (the )?doctor|from (the )?hospital)\b/i.test(history)) return 'provider';
  if (/\b(plan de medicare|medicare plan|advantage plan|del plan|from (the )?plan|monthly premium|prima mensual)\b/i.test(history)) return 'plan';
  // Fuzzy fallback for misspellings
  const fuzzy = fuzzyConcept(history);
  if (fuzzy === 'pharmacy') return 'pharmacy';
  if (fuzzy === 'hospital' || fuzzy === 'doctor') return 'provider';
  if (fuzzy === 'plan') return 'plan';
  return null;
}

function detectDualEligible(history: string): boolean {
  return /\b(medicaid (y|and) medicare|medicare (y|and) medicaid|dual[- ]?eligible|doble elegibilidad|tengo medicaid y medicare|tengo medicare y medicaid|both medicare and medicaid)\b/i.test(history);
}

function detectAmount(history: string): string | null {
  // V21 — use the unified parser which understands $X, X dollars, Xk, X mil.
  const parsed = parseAmount(history);
  if (parsed !== null && parsed > 0) return String(parsed);
  return null;
}

function detectEmotion(text: string): string {
  const normalized = normalizeText(text);
  if (/\b(frustrated|frustraci[oó]n|enoja|enojado|angry|no entienden|mal servicio|furioso)\b/i.test(normalized)) return 'frustrated';
  if (/\b(confused|confusi[oó]n|no entiendo|qu[eé] significa)\b/i.test(normalized)) return 'confused';
  if (/\b(urgent|emergency|emergencia|ya mismo|asap)\b/i.test(normalized)) return 'urgent';
  if (/muri[oó]|falleci[oó]|passed away|death|died/i.test(normalized)) return 'grieving';
  if (/\b(gracias|thank|appreciate|agradezco)\b/i.test(normalized)) return 'grateful';
  return 'calm';
}

export function processMessage(
  userMessage: string,
  state: ConversationState,
): { response: string; newState: ConversationState; needsHuman: boolean } {
  const newState = { ...state, messages: [...state.messages] };
  newState.messages.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  newState.turnCount++;
  // The user has responded — any previously-rendered chips no longer apply
  // unless we explicitly re-add them in this turn.
  newState.quickReplies = [];

  // V18: ALWAYS detect declared state, no matter which step we're on. This
  // covers callers who say "I live in Florida" before they enter a ZIP.
  const declared = detectDeclaredState(userMessage);
  if (declared && !newState.stateDeclaredByUser) {
    newState.stateDeclaredByUser = declared;
    if (newState.state && newState.state !== declared) {
      flagInconsistency(
        newState,
        `zip_state_mismatch: zip ${newState.zipCode} → ${newState.state}, user said ${declared}`,
        50,
      );
    }
  }

  const isSpanish = newState.language === 'es';

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 19 — TOP PRIORITY: frustration / abuse / curse-word OVERRIDE
  //
  // If the user is angry, insulting, or stuck, we abandon the rigid form
  // (no more "please enter a 5-digit ZIP" loop) and offer chip-driven help.
  // Skipped at asking_language step — the user hasn't picked a language yet.
  // ─────────────────────────────────────────────────────────────────────────
  if (newState.step !== 'asking_language') {
    const ab = detectAbuseOrFrustration(userMessage);
    if (ab.detected) {
      newState.frustrationCount = (newState.frustrationCount || 0) + 1;
      newState.emotionalState = ab.severity === 'severe' ? 'angry' : 'frustrated';
      return enterRecoveryMode(newState, 'frustration');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 23 — INTERRUPTION HANDLING
  //
  // Real humans can be interrupted at any point. The bot must accept pauses,
  // corrections, and clarification requests without losing context.
  // Skipped at asking_language step.
  // ─────────────────────────────────────────────────────────────────────────
  if (newState.step !== 'asking_language' && newState.language) {
    // PAUSE — "wait, let me check the paper"
    if (detectPauseRequest(userMessage)) {
      const out = isSpanish
        ? 'Por supuesto, tómese su tiempo. Aquí estoy cuando esté listo. No hay prisa.'
        : 'Of course, take your time. I will be here when you are ready. No rush.';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // CLARIFICATION — "what does IRMAA mean?"
    if (detectClarificationRequest(userMessage)) {
      const out = isSpanish
        ? 'Claro, con mucho gusto se lo explico de manera sencilla. ¿Me puede decir exactamente cuál palabra o frase quiere que aclare? Si es algo del documento que tiene en mano, escríbamelo tal cual está y se lo traduzco.'
        : "Of course, I'd be glad to explain it in simple terms. Can you tell me exactly which word or phrase you'd like me to clarify? If it's something from the document in front of you, type it as it appears and I'll translate it for you.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // CORRECTION — "actually it was $1,000 not $10,000"
    if (detectCorrection(userMessage)) {
      // Re-parse amount from this message — it likely contains the correct value.
      const newAmt = parseAmount(userMessage);
      if (newAmt !== null && newAmt > 0) {
        newState.amountMentioned = String(newAmt);
      }
      const out = isSpanish
        ? `Perfecto, gracias por aclararlo. Anotado${withName(newState.name)}. Sigamos con la información correcta.`
        : `Perfect, thank you for clarifying. Noted${withName(newState.name)}. Let's continue with the right information.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      // Don't return — fall through so the conversation handler can use the
      // updated amount in its next response. Actually we DO return here so
      // the user sees the acknowledgment first; they can ask their follow-up.
      return { response: out, newState, needsHuman: false };
    }
  }

  // V20 — strict language switch (only on explicit request).
  if (newState.language && newState.step !== 'asking_language') {
    const sw = detectExplicitLanguageSwitch(userMessage);
    if (sw && sw !== newState.language) {
      newState.language = sw;
      const out = sw === 'es'
        ? 'Perfecto, ahora hablo en español. ¿Qué necesita revisar?'
        : 'Got it, switching to English. What do you need help with?';
      newState.quickReplies = sw === 'es' ? [...TOPIC_CHIPS_ES] : [...TOPIC_CHIPS_EN];
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
  }

  // ───── STEP 1: ASKING LANGUAGE ─────
  if (newState.step === 'asking_language') {
    const msg = userMessage.toLowerCase();
    if (msg.includes('english') || msg === 'en') {
      newState.language = 'en';
      newState.step = 'asking_topic';
      const out = "Wonderful. No rush — tell me what you'd like to look at today, and we'll go through it together.";
      newState.quickReplies = [...TOPIC_CHIPS_EN];
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (msg.includes('español') || msg.includes('espanol') || msg === 'es') {
      newState.language = 'es';
      newState.step = 'asking_topic';
      const out = 'Con mucho gusto. Sin prisa — dígame qué le gustaría revisar hoy, y lo vemos juntos.';
      newState.quickReplies = [...TOPIC_CHIPS_ES];
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    const out = 'Please select English or Español. Por favor seleccione English o Español.';
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // ───── STEP 2 (V20): ASKING TOPIC ─────
  // User clicks a chip OR types the issue in their own words. Either way,
  // we route into the conversation block without asking for name or ZIP.
  if (newState.step === 'asking_topic') {
    newState.step = 'conversation';
    // Fall through to the conversation block below.
  }

  // ───── STEP 2: ASKING NAME ─────
  if (newState.step === 'asking_name') {
    // Strip conversational prefixes in any order; loop a few times to catch
    // chains like "Hi, my name is Carlos" → "Carlos".
    let cleaned = userMessage.trim();
    const prefixes: RegExp[] = [
      /^(hi|hello|hey|hola|buenos|buenas)[\s,.!]+/i,
      /^(my name is|name is|name's|im called|i am called)\s+/i,
      /^(i'?m|i am|im)\s+/i,
      /^(me llamo|mi nombre es|nombre|soy|me dicen)\s*[:\s]*/i,
    ];
    let safety = 0;
    let changed = true;
    while (changed && safety < 5) {
      changed = false;
      for (const re of prefixes) {
        const next = cleaned.replace(re, '').trim();
        if (next !== cleaned) {
          cleaned = next;
          changed = true;
        }
      }
      safety++;
    }
    const rawName = cleaned.split(/\s+/)[0]?.replace(/[.,;:!?]+$/, '') || '';
    const nv = validateName(rawName);
    // V20 — strict name validation. Suspicious / fake names (TOTO, nooo,
    // insults, repeated chars) are REJECTED with a graceful skip path.
    if (!nv.isValid) {
      newState.failedNameAttempts = (newState.failedNameAttempts || 0) + 1;
      flagInconsistency(newState, `name_${nv.reason || 'invalid'}`, 30);
      // Return to conversation with topic chips. The user can keep going
      // without giving us a real name — identity is optional.
      newState.step = 'conversation';
      newState.quickReplies = isSpanish ? [...TOPIC_CHIPS_ES] : [...TOPIC_CHIPS_EN];
      const out = isSpanish
        ? 'Parece que eso no es un nombre. No hay problema. Podemos seguir sin nombre por ahora. ¿Qué necesita revisar?'
        : 'That does not look like a name. No problem. We can continue without a name for now. What do you need help with?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    newState.name = nv.cleaned;
    newState.nameIsValid = true;
    newState.step = 'asking_zip';
    const out = isSpanish
      ? `Gracias${withName(newState.name)}. ¿Cuál es su código postal? Esto ayuda a confirmar el área de servicio. Si prefiere, puede decirme primero qué está pasando.`
      : `Thanks${withName(newState.name)}. What is your ZIP code? This helps confirm the service area. Or you can tell me what is going on first.`;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // ───── STEP 3: ASKING ZIP ─────
  if (newState.step === 'asking_zip') {
    const zip = userMessage.trim().replace(/\D/g, '');
    if (zip.length !== 5) {
      // Wave 19 Rule 8 — never trap the user on ZIP. If they already gave us
      // an actionable topic, jump straight to triage and let ZIP wait.
      const probableIntent = detectProblemType(userMessage);
      if (probableIntent && probableIntent !== 'general' && probableIntent !== 'casual') {
        newState.step = 'asking_problem';
        // Fall through to the conversation block below. Don't return.
      } else {
        newState.failedZipAttempts = (newState.failedZipAttempts || 0) + 1;
        // Wave 19 Rule 1 — after 2 failed ZIP attempts, stop asking and recover.
        if ((newState.failedZipAttempts || 0) >= 2) {
          return enterRecoveryMode(newState, 'zip_loop');
        }
        // V20 first miss — Sawil's exact wording.
        const out = isSpanish
          ? 'Ese no parece ser un ZIP de 5 dígitos. Puede escribirlo de nuevo o decirme primero qué necesita revisar.'
          : 'That does not look like a 5-digit ZIP. You can enter it again or tell me what you need help with first.';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
    }
    // Only process as a real ZIP if we actually got 5 digits. Otherwise
    // we already advanced step to 'asking_problem' and we fall through.
    if (zip.length === 5) {
    const detectedState = getStateFromZip(zip);
    // V18: cross-check ZIP against any state the user already declared
    // earlier (e.g. "I live in Florida" but typed a NY ZIP).
    if (newState.stateDeclaredByUser && detectedState && newState.stateDeclaredByUser !== detectedState) {
      flagInconsistency(newState, `zip_state_mismatch: zip ${zip} → ${detectedState}, user said ${newState.stateDeclaredByUser}`, 50);
    }
    if (!detectedState) {
      newState.zipCode = zip;
      newState.zipCodeIsValid = false;
      newState.isValidState = false;
      flagInconsistency(newState, `zip_not_in_service_area: ${zip}`, 25);
      // V20 — finalize handoff anyway if user wanted an advisor.
      if (newState.pendingAdvisorHandoff) {
        newState.step = 'conversation';
        newState.needsHuman = true;
        const outA = isSpanish
          ? `Gracias${withName(newState.name)}. Anoto su ZIP (${zip}). Actualmente nuestro servicio está concentrado en NY, NJ, FL y CT, pero un asesor licenciado revisará su caso de todos modos. Si es urgente, llame al 1-866-310-8702.`
          : `Thank you${withName(newState.name)}. I have your ZIP (${zip}). Our service is currently focused on NY, NJ, FL, and CT, but a licensed advisor will review your case anyway. If urgent, call 1-866-310-8702.`;
        newState.messages.push({ role: 'bot', content: outA, timestamp: Date.now() });
        return { response: outA, newState, needsHuman: true };
      }
      newState.step = 'asking_problem';
      const out = isSpanish
        ? `Gracias. Actualmente solo servimos NY, NJ, FL y CT. Aun así puedo orientarle con preguntas generales de Medicare. Cuénteme qué está pasando.`
        : `Thank you. We currently only serve NY, NJ, FL, and CT. I can still help you with general Medicare guidance. Tell me what's going on.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    newState.zipCode = zip;
    newState.zipCodeIsValid = true;
    newState.state = detectedState;
    newState.isValidState = true;
    // V20 — if we were collecting identity for advisor handoff, finalize it.
    if (newState.pendingAdvisorHandoff) {
      newState.step = 'conversation';
      newState.needsHuman = true;
      const outA = isSpanish
        ? `Gracias${withName(newState.name)}. Estoy organizando su caso para que un asesor licenciado bilingüe se comunique con usted. Si es urgente, llame ahora al 1-866-310-8702.`
        : `Thank you${withName(newState.name)}. I'm organizing your case so a licensed bilingual advisor can contact you. If urgent, call 1-866-310-8702 now.`;
      newState.messages.push({ role: 'bot', content: outA, timestamp: Date.now() });
      return { response: outA, newState, needsHuman: true };
    }
    newState.step = 'asking_problem';
    const out = isSpanish
      ? `Gracias${withName(newState.name)}. Cuénteme qué está pasando con Medicare. Descríbalo con sus propias palabras.`
      : `Thanks${withName(newState.name)}. Tell me what's going on with Medicare. Describe it in your own words.`;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
    } // close `if (zip.length === 5)`
  }

  // ───── STEP 4+: PROBLEM / FREE CONVERSATION ─────
  if (newState.step === 'asking_problem' || newState.step === 'conversation') {
    newState.step = 'conversation';
    // Wave 19 — deferred ZIP capture. If the user previously skipped ZIP
    // (because they were declaring intent first) and now sends a bare
    // 5-digit number, capture it as a late ZIP and run the same cross-check.
    const bareZip = userMessage.trim().replace(/\D/g, '');
    if (!newState.zipCode && bareZip.length === 5 && userMessage.trim().replace(/\s/g, '').length <= 7) {
      const detectedState = getStateFromZip(bareZip);
      newState.zipCode = bareZip;
      newState.zipCodeIsValid = !!detectedState;
      if (detectedState) {
        newState.state = detectedState;
        newState.isValidState = true;
        if (newState.stateDeclaredByUser && newState.stateDeclaredByUser !== detectedState) {
          flagInconsistency(newState, `zip_state_mismatch: zip ${bareZip} → ${detectedState}, user said ${newState.stateDeclaredByUser}`, 50);
        }
      } else {
        flagInconsistency(newState, `zip_not_in_service_area: ${bareZip}`, 25);
      }
    }
    const rawProblemType = detectProblemType(userMessage);
    const emotion = detectEmotion(userMessage);
    newState.currentProblem = userMessage;
    // V21 STICKY + V23 TOPIC SWITCH:
    //   · Typo / general → keep old intent (sticky)
    //   · Clearly different strong topic → release sticky, switch, reset slots
    //   · Same topic or new fresh topic → take new intent
    const oldIntent = newState.intent;
    const strongOld = oldIntent && oldIntent !== 'general' && oldIntent !== 'casual';
    let effectiveIntent: string = rawProblemType;
    let didTopicSwitch = false;
    if (rawProblemType === 'general' && strongOld) {
      effectiveIntent = oldIntent as string;
    } else if (isTopicSwitch(oldIntent, rawProblemType)) {
      effectiveIntent = rawProblemType;
      didTopicSwitch = true;
      // Reset slot data tied to the OLD topic so the new flow starts clean.
      newState.billSource = undefined;
      newState.amountMentioned = undefined;
    }
    newState.intent = effectiveIntent;
    const problemType = effectiveIntent;
    newState.emotionalState = emotion;
    // The topic-specific handler responses below all open with an "Entiendo"
    // / "I understand" empathy frame, which naturally acknowledges the
    // switch.

    // ── WAVE 17 CONTEXT SCAN ──
    // Scan the entire user history (plus this message) so we never re-ask
    // for something the caller already told us. Skipped on topic switch so
    // the old topic's data doesn't bleed into the new flow.
    if (!didTopicSwitch) {
      const history = fullUserHistory(newState, userMessage);
      const newSource = detectBillSource(history);
      if (newSource && !newState.billSource) newState.billSource = newSource;
      if (detectDualEligible(history)) newState.dualEligible = true;
      const amt = detectAmount(history);
      if (amt) newState.amountMentioned = amt;
    }

    // ── WAVE 18: declared-state + phone detection (silently) ──
    const declared = detectDeclaredState(userMessage);
    if (declared) {
      newState.stateDeclaredByUser = declared;
      // If we already know the ZIP-derived state and it doesn't match, flag.
      if (newState.state && newState.state !== declared) {
        flagInconsistency(
          newState,
          `zip_state_mismatch: zip ${newState.zipCode} → ${newState.state}, user said ${declared}`,
          50,
        );
      }
    }
    // Phone — scan the latest message only (most likely place a number appears).
    const phoneMatch = userMessage.match(/\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
    if (phoneMatch) {
      const pv = validatePhone(phoneMatch[0]);
      newState.phoneNumber = pv.cleaned;
      if (!pv.isValid) flagInconsistency(newState, `phone_${pv.reason}`, 25);
    }

    // ── Emotional priority responses ──
    if (emotion === 'grieving') {
      const out = isSpanish
        ? `Lo siento mucho por su pérdida${withName(newState.name)}. Para temas de Medicare después de un fallecimiento, lo mejor es llamar al Social Security: 1-800-772-1213. ¿Necesita ayuda con algo específico?`
        : `I'm very sorry for your loss${withName(newState.name)}. For Medicare matters after a death, please call Social Security: 1-800-772-1213. Do you need help with something specific?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (emotion === 'frustrated') {
      const out = isSpanish
        ? `Entiendo su frustración${withName(newState.name)}. Déjeme ayudarle. ¿Puede contarme exactamente qué está pasando?`
        : `I understand your frustration${withName(newState.name)}. Let me help you. Can you tell me exactly what's happening?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (emotion === 'urgent') {
      const out = isSpanish
        ? `Si es una emergencia médica, llame al 911 ahora. Si es urgente pero no médica, dígame qué pasa y lo organizo para un asesor licenciado.`
        : `If this is a medical emergency, please call 911 now. If it's urgent but not medical, tell me what's happening and I'll organize it for a licensed advisor.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // ──────────────────────────────────────────────────────────────────────
    // WAVE 17: BILL / DRUG with CONTEXT MEMORY
    //
    // The exact Antonio failure was that the bot kept asking "is this from
    // the doctor, pharmacy, or plan?" after Antonio had already said
    // "DE LA FARMACIA" 2 turns earlier, then said he had dual eligibility,
    // then said he paid $18. Now the bot honors billSource + dualEligible +
    // amountMentioned and gives a contextually correct response.
    // ──────────────────────────────────────────────────────────────────────
    // Drug-specific first turn: if user said "my medication is expensive"
    // and never named a source, ask the drug-specific question.
    if (problemType === 'drug' && !newState.billSource && !newState.amountMentioned) {
      const out = isSpanish
        ? `Sobre medicamentos${withName(newState.name)}. ¿El problema es el costo, que no está cubierto, o necesita autorización previa? Un asesor licenciado debe verificar el formulario y la farmacia antes de cualquier decisión.`
        : `About medications${withName(newState.name)}. Is the issue the cost, not covered, or prior authorization? A licensed advisor must verify the formulary and pharmacy before any decision.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'bill' || problemType === 'drug') {
      const src = newState.billSource;
      const amount = newState.amountMentioned;
      const dual = newState.dualEligible;

      // Pharmacy source + dual eligible + amount known → fullest context response
      if (src === 'pharmacy' && dual && amount) {
        const out = isSpanish
          ? `Anotado${withName(newState.name)}. Tiene Medicare y Medicaid (doble elegibilidad) y pagó $${amount} en la farmacia. Para personas con Medicare + Medicaid los copagos de medicamentos suelen ser mucho más bajos. No puedo confirmar la cantidad exacta aquí, pero un asesor licenciado puede revisar el formulario, la farmacia y si Extra Help / LIS se está aplicando. ¿Quiere que un asesor revise esto?`
          : `Got it${withName(newState.name)}. You have both Medicare and Medicaid (dual eligible) and paid $${amount} at the pharmacy. For people with Medicare + Medicaid the drug copays are usually much lower. I can't confirm the exact amount here, but a licensed advisor can review the formulary, the pharmacy, and whether Extra Help / LIS is being applied. Would you like an advisor to review this?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Pharmacy source + dual eligible (no amount yet)
      if (src === 'pharmacy' && dual) {
        const out = isSpanish
          ? `Gracias${withName(newState.name)}. Tiene Medicare y Medicaid (doble elegibilidad). Eso es importante — los copagos de medicamentos suelen ser muy bajos. ¿Cuánto pagó esta vez en la farmacia?`
          : `Thanks${withName(newState.name)}. You have both Medicare and Medicaid (dual eligible). That matters — drug copays are usually very low. How much did you pay at the pharmacy this time?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Pharmacy source known (no dual signal)
      if (src === 'pharmacy') {
        const out = isSpanish
          ? `Anotado${withName(newState.name)}. Es un cobro de la farmacia. ¿El problema es que es muy caro, que no esperaba ese costo, o que no le cubrieron el medicamento?`
          : `Got it${withName(newState.name)}. Pharmacy charge. Is the issue that it's too expensive, that you didn't expect that cost, or that the medication wasn't covered?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // V22 — Provider source + amount known. H.E.A.R.T. service layer:
      //   Hear (reflect) → Empathize → Acknowledge → Respond (plain language) → Trust handoff.
      // USTED form. Jargon translated. Calm, validating tone for senior callers.
      if (src === 'provider' && amount) {
        const amountFormatted = Number(amount).toLocaleString('en-US');
        const history = fullUserHistory(newState, userMessage);
        const isHospital = /\b(hospital|hospitals|ospital|hopital|hospita|hostpital|hospitl|hospitall|hospitales|emergency room|sala de emergencias)\b/i.test(history)
          || fuzzyConcept(history) === 'hospital';
        const sourceEs = isHospital ? 'de hospital' : 'del médico u hospital';
        const sourceEn = isHospital ? 'from a hospital' : 'from a doctor or hospital';
        const out = isSpanish
          ? `Entiendo. Una factura de $${amountFormatted} ${sourceEs} es una preocupación seria — esa cantidad es muy alta para procesarla solo. Antes de asumir que usted debe esa cantidad, vamos a confirmar qué dice el documento exactamente. A veces lo que aparece es solo el cargo total al plan, no lo que usted paga. ¿Puede ver si dice "amount due" (cantidad a pagar), "balance due" (saldo pendiente), o "patient responsibility" (responsabilidad del paciente)? Si prefiere, un asesor licenciado puede revisarlo con usted sin costo.`
          : `I understand. A $${amountFormatted} bill ${sourceEn} is a serious worry — that amount is a lot to process alone. Before assuming you owe that amount, let's confirm what the document actually says. Sometimes what shows up is just the total charge sent to the plan, not what you actually owe. Can you see if it says "amount due", "balance due", or "patient responsibility"? If you'd prefer, a licensed advisor can review it with you at no cost.`;
        newState.quickReplies = isSpanish
          ? ['Dice amount due', 'Dice balance due', 'Dice patient responsibility', 'Solo muestra cargos', 'No estoy seguro', 'Hablar con asesor']
          : ['Says amount due', 'Says balance due', 'Says patient responsibility', 'Just shows charges', "I'm not sure", 'Talk to advisor'];
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Provider source known (no amount yet) — V21 spec wording.
      if (src === 'provider') {
        const out = isSpanish
          ? `Entiendo. Parece que la factura viene del médico u hospital. ¿La factura dice cuánto usted debe pagar, o solo muestra lo que el hospital cobró al plan?`
          : `Got it. It looks like the bill is from a doctor or hospital. Does the bill say how much you owe, or does it just show what the hospital charged the plan?`;
        newState.quickReplies = isSpanish
          ? ['Dice cantidad adeudada', 'Solo muestra cargos', 'No estoy seguro', 'Hablar con asesor']
          : ['Shows amount owed', 'Just shows charges', "I'm not sure", 'Talk to advisor'];
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Plan source known
      if (src === 'plan') {
        const out = isSpanish
          ? `Anotado${withName(newState.name)}. Es del plan de Medicare. ¿Es una prima mensual, un copago, o un cobro inesperado?`
          : `Got it${withName(newState.name)}. It's from your Medicare plan. Is it a monthly premium, a copay, or an unexpected charge?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // No source captured yet — ask the source question ONCE
      const out = isSpanish
        ? `Entiendo${withName(newState.name)}. ¿Esta factura es del médico u hospital, de la farmacia, o del plan de Medicare? Por favor no envíe Medicare ID, Seguro Social, ni datos bancarios aquí.`
        : `Got it${withName(newState.name)}. Is this bill from a doctor or hospital, a pharmacy, or your Medicare plan? Please do not send Medicare ID, Social Security, or banking info here.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'letter') {
      const out = isSpanish
        ? `Entiendo. Recibir una carta de Medicare puede generar dudas — vamos a entenderla juntos. ¿Es sobre renovación o cambios anuales del plan (ANOC/EOC), una notificación de Medicaid, sobre Extra Help, un aviso de IRMAA, o un cobro pendiente? Por su seguridad, no envíe su número de Medicare, Seguro Social, ni fotos completas con datos sensibles.`
        : `I understand. Getting a letter from Medicare can be confusing — let's go through it together. Is it about plan renewal or annual changes (ANOC/EOC), a Medicaid notice, Extra Help, an IRMAA notice, or a collection notice? For your safety, please do not send your Medicare number, Social Security, or full photos with sensitive details.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'coverage') {
      const out = isSpanish
        ? `Entiendo. La cobertura es uno de los temas más importantes — y también uno de los que cambia con más frecuencia. ¿Quiere saber si un doctor, hospital, o un procedimiento específico está cubierto? Yo no puedo confirmarlo aquí porque depende del plan, su condado, y la red en este momento. Un asesor licenciado puede verificarlo por usted sin costo.`
        : `I understand. Coverage is one of the most important questions — and also one that changes often. Do you want to know if a specific doctor, hospital, or procedure is covered? I can't confirm it here because it depends on the plan, your county, and the network right now. A licensed advisor can verify it for you at no cost.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'enrollment') {
      const out = isSpanish
        ? `Entiendo. La inscripción a Medicare tiene varias ventanas y cada una tiene sus reglas. ¿Cuál es su situación: está cumpliendo 65 años (IEP), quiere cambiar durante el periodo anual (AEP, del 15 de octubre al 7 de diciembre), o tuvo un evento especial como una mudanza (SEP)? Sin presión — un asesor licenciado puede revisar las opciones con usted.`
        : `I understand. Medicare enrollment has different windows, each with its own rules. Which situation fits you: turning 65 (IEP), switching during the annual period (AEP, Oct 15 - Dec 7), or did you have a special event like moving (SEP)? No pressure — a licensed advisor can walk through the options with you.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'appeal') {
      const out = isSpanish
        ? `Entiendo. Recibir una denegación es frustrante, pero usted tiene derecho a apelar. La ventana suele ser de 60 días desde la fecha del aviso, y un asesor licenciado puede ayudarle a organizar los documentos y los plazos correctamente. ¿Le gustaría que un asesor le acompañe en este proceso?`
        : `I understand. Getting a denial is frustrating, but you have the right to appeal. The window is usually 60 days from the notice date, and a licensed advisor can help you organize the documents and timelines correctly. Would you like an advisor to walk you through this?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // V20 — "Talk to advisor" / "Hablar con asesor". Identity is asked
    // ONLY now (at handoff). If we already have the name, jump to ZIP.
    // If we already have both, finalize the handoff.
    if (problemType === 'advisor') {
      newState.pendingAdvisorHandoff = true;
      if (!newState.name) {
        newState.step = 'asking_name';
        const out = isSpanish
          ? 'Con mucho gusto. Para que un asesor licenciado pueda comunicarse con usted personalmente, ¿cuál es su primer nombre?'
          : "Of course, I'd be glad to help. So a licensed advisor can reach out to you personally, what is your first name?";
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      if (!newState.zipCode) {
        newState.step = 'asking_zip';
        const out = isSpanish
          ? `Gracias${withName(newState.name)}. ¿Cuál es su código postal? Esto ayuda a confirmar el área de servicio. Si prefiere, puede decirme primero qué está pasando.`
          : `Thanks${withName(newState.name)}. What is your ZIP code? This helps confirm the service area. Or you can tell me what is going on first.`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      newState.needsHuman = true;
      const out = isSpanish
        ? `Perfecto${withName(newState.name)}. Estoy preparando su caso para un asesor licenciado bilingüe — alguien con experiencia real, sin presión y sin costo. Le contactarán pronto. Si necesita hablar antes, llame al 1-866-310-8702 y mencione que ya inició su consulta aquí. Gracias por su confianza.`
        : `Perfect${withName(newState.name)}. I'm preparing your case for a licensed bilingual advisor — someone with real experience, no pressure, and no cost to you. They will reach out soon. If you need to talk sooner, call 1-866-310-8702 and mention you already started your case here. Thank you for trusting us.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: true };
    }
    if (problemType === 'casual') {
      const out = isSpanish
        ? `Hola${withName(newState.name)}. ¿En qué puedo ayudarle con Medicare hoy?`
        : `Hi${withName(newState.name)}. How can I help you with Medicare today?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // ── WAVE 17: "general" intent that mentions dual eligibility ──
    // If the user just told us they have Medicaid + Medicare, recognize it
    // and respond with that context instead of "give me more detail".
    if (newState.dualEligible && newState.billSource) {
      const out = isSpanish
        ? `Gracias${withName(newState.name)}. Anoto que tiene Medicare y Medicaid, y que esto se refiere a ${newState.billSource === 'pharmacy' ? 'una factura de la farmacia' : newState.billSource === 'provider' ? 'una factura del médico u hospital' : 'el plan de Medicare'}. Eso ayuda mucho. ¿Cuál es el monto que ve, o qué le preocupa más sobre el cobro?`
        : `Thanks${withName(newState.name)}. I'm noting that you have Medicare and Medicaid, and that this is about ${newState.billSource === 'pharmacy' ? 'a pharmacy bill' : newState.billSource === 'provider' ? 'a doctor or hospital bill' : 'your Medicare plan'}. That helps a lot. What's the amount you're seeing, or what concerns you most about the charge?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (newState.dualEligible) {
      const out = isSpanish
        ? `Anotado${withName(newState.name)} — tiene Medicare y Medicaid (doble elegibilidad). Eso es importante porque sus costos de medicamentos y servicios suelen ser muy bajos. ¿Sobre qué situación quiere que le ayude?`
        : `Got it${withName(newState.name)} — you have both Medicare and Medicaid (dual eligible). That matters because your drug and service costs are usually very low. What situation can I help you organize?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // Default
    const out = isSpanish
      ? `Gracias por contarme${withName(newState.name)}. ¿Puede darme un poco más de detalle sobre su situación?`
      : `Thanks for telling me${withName(newState.name)}. Can you give me a bit more detail about your situation?`;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // Fallback (should not reach)
  const out = isSpanish ? '¿En qué más puedo ayudarle?' : 'How else can I help you?';
  newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
  return { response: out, newState, needsHuman: false };
}

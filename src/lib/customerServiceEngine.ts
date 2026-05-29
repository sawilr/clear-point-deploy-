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
  | 'asking_zip_natural'    // V25: step 2 — ZIP first, NATURAL ask, refusable
  | 'asking_topic'          // V25: step 3 — open question, no chips by default
  | 'asking_name'           // legacy / identity at handoff
  | 'asking_zip'            // legacy / identity at handoff (advisor path)
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
  // ─── Wave 25: audit-driven rebuild ───
  /** Set true if the user declined to share ZIP at the natural ZIP step. */
  zipRefused?: boolean;
  /** A/B/C routing level for current response (telemetry + UI hint). */
  routingLevel?: 'A' | 'B' | 'C' | 'safety';
  /** Specific service category once detected (more granular than `intent`). */
  serviceCategory?: string;
  /** Sub-issue within a category (e.g., provider_left_network within
   *  doctor_provider_network). */
  subIssue?: string;
  /** Last default-fallback response — used for loop prevention. */
  lastFallbackResponse?: string;
  // ─── Wave 27: user preferences (Sawil rule 6) ───
  /** User explicitly said they don't want to change plans. */
  doesNotWantPlanChange?: boolean;
  /** User explicitly said they want to keep their current doctor. */
  wantsToKeepDoctor?: boolean;
  /** User explicitly said they want to keep their specialist. */
  wantsToKeepSpecialist?: boolean;
  /** True after bot has acknowledged the user's "don't want to change" once.
   *  Used to advance to verification follow-up on subsequent turns. */
  planChangeAcknowledged?: boolean;
  // ─── Wave 28: clarify-before-explaining ───
  /** Last question the bot asked (verbatim) — prevents repeating the same
   *  generic question twice and gates clarification flow. */
  lastBotQuestion?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 28 — CLARIFY-BEFORE-EXPLAINING LAYER
//
// Core principle: listen first, classify after.
// If user reports a vague problem ("tengo problemas con mi doctor"), the
// bot must ASK what happened — not launch a full Medicare flow.
//
// detectVagueProblemReport returns the topic noun + isVague flag.
// getTopicClarification returns the short office-style question for that
// topic, in EN or ES.
// ─────────────────────────────────────────────────────────────────────────────

export type VagueTopic =
  | 'doctor' | 'specialist' | 'hospital' | 'plan'
  | 'medication' | 'pharmacy' | 'bill' | 'letter'
  | 'card' | 'coverage' | 'dental' | 'vision'
  | 'otc' | 'transportation';

/** Returns the topic noun + isVague flag for "I have a problem with X" patterns. */
export function detectVagueProblemReport(text: string): { isVague: boolean; topic: VagueTopic | null } {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Step 1: detect a broad-problem opener ("tengo problemas con", "I have a
  // problem with", "necesito ayuda con", etc.)
  const broadPattern = /\b(tengo (un )?problemas? con|tengo (una )?duda con|necesito ayuda con|no entiendo|tengo (un )?inconveniente con|mi .{0,15} tiene (un )?problema|mi .{0,15} no funciona|mi .{0,15} no esta funcionando|me lleg[oó]|recib[ií]|i (have|got|am having) (a |an )?problems? with|i need help with|i don'?t understand|i'?m having trouble with|my .{0,15} (has|is having) (a |an )?(problem|issue)|my .{0,15} (isn'?t|is not) working|i got (a |an |my )?)\b/i;
  if (!broadPattern.test(lower)) return { isVague: false, topic: null };
  // Step 2: identify the topic noun.
  const topicChecks: Array<[VagueTopic, RegExp]> = [
    ['specialist', /\b(specialists?|especialistas?)\b/i],
    ['doctor', /\b(doctors?|doctora|m[eé]dico|pcp|primary)\b/i],
    ['hospital', /\b(hospitals?|cl[ií]nica|er|emergency room)\b/i],
    ['medication', /\b(medication|medicine|drug|prescription|medicina|medicamentos?|pastillas?|receta)\b/i],
    ['pharmacy', /\b(pharmacy|farmacia|drugstore|drugstores)\b/i],
    ['bill', /\b(bill|invoice|charge|cobro|factura|facturas)\b/i],
    ['letter', /\b(letter|notice|carta|aviso)\b/i],
    ['otc', /\b(otc|over[- ]the[- ]counter|flex card|tarjeta otc|tarjeta flex)\b/i],
    ['card', /\b(card|tarjeta|tarjetas)\b/i],
    ['plan', /\b(plan|planes|carrier|aseguradora|insurance|seguro)\b/i],
    ['dental', /\b(dental|dentist|dientes|dentadura)\b/i],
    ['vision', /\b(vision|eyes?|ojos?|glasses|lentes|anteojos)\b/i],
    ['transportation', /\b(transportation|transporte|ride|rides|viaje|viajes)\b/i],
    ['coverage', /\b(coverage|cobertura)\b/i],
  ];
  let topic: VagueTopic | null = null;
  for (const [t, re] of topicChecks) {
    if (re.test(lower)) { topic = t; break; }
  }
  if (!topic) return { isVague: false, topic: null };
  // Step 3: if SPECIFIC qualifier present, it's NOT vague — full handler runs.
  const specific = [
    /no longer|stopped|left|dropped|doesn'?t accept|don'?t accept|won'?t take|out of (the |my )?(network|plan)/i,
    /ya no acepta|ya no trabaja|sali[oó] de|dej[oó] de|no me dieron|me negaron/i,
    /denied|rejected|negado|denegado|no me aprobaron/i,
    /expensive|too high|caro|muy caro|costoso/i,
    /amount due|balance due|patient responsibility|cantidad adeudada/i,
    /from medicare|from medicaid|from social security|de medicare|de medicaid|de social security|de seguro social/i,
    /lost|perdi|perdimos|reemplazo|replacement/i,
    /\$\d|\b\d{1,5}\s*(dollar|dollars|dolares|d[oó]lares|usd|k\b|mil\b|thousand|thousands)\b/i,
    /\b\d+\s*k\b/i,  // 10k pattern
    /\b\d+\s*mil\b/i,  // 10 mil pattern
    /referral|referido|prior auth|autorizaci[oó]n previa/i,
    /declined|rechaz|reject|inelegible/i,
    /no funciona porque|no funciono|porque tiene|porque viene/i,
  ];
  for (const q of specific) {
    if (q.test(lower)) return { isVague: false, topic };
  }
  return { isVague: true, topic };
}

/** Returns the short office-style clarification question for a vague topic. */
export function getTopicClarification(topic: VagueTopic, isSpanish: boolean): string {
  if (isSpanish) {
    switch (topic) {
      case 'doctor':         return 'Entiendo. ¿Qué pasó con su doctor — una cita, la red del plan, una autorización, o algo que le dijeron?';
      case 'specialist':     return 'Entiendo. ¿Qué pasó con su especialista — la red, autorización, un referido, o algo que le dijeron?';
      case 'hospital':       return 'Entiendo. ¿El problema es una factura, una cobertura, una autorización, o una cita/procedimiento?';
      case 'bill':           return 'Entiendo. ¿El documento dice que usted debe pagar una cantidad, o parece ser una explicación de beneficios del plan?';
      case 'letter':         return 'Entiendo. ¿La carta es de Medicare, Medicaid, Social Security o de su plan?';
      case 'medication':     return 'Entiendo. ¿El problema es el costo, que no la cubrieron, o que la farmacia no pudo procesarla?';
      case 'pharmacy':       return 'Entiendo. ¿La farmacia le dijo que el medicamento no está cubierto, que está muy caro, o que necesita autorización?';
      case 'plan':           return 'Entiendo. ¿El problema es con cobertura, costo, doctores, medicamentos, o una carta que recibió?';
      case 'card':           return 'Entiendo. ¿Es sobre una tarjeta perdida, una que no le llegó, o una que no funciona?';
      case 'coverage':       return 'Entiendo. ¿La duda es sobre un doctor, hospital, medicamento, beneficio dental/vision, o algo más?';
      case 'dental':         return 'Entiendo. ¿Quiere saber si tiene beneficio dental, o tiene un problema con una factura o cita dental?';
      case 'vision':         return 'Entiendo. ¿Es sobre un examen, anteojos, o un beneficio que vio en su plan?';
      case 'otc':            return 'Entiendo. ¿La tarjeta fue rechazada, el balance aparece en cero, o no sabe cómo usarla?';
      case 'transportation': return 'Entiendo. ¿Necesita saber si tiene transporte, o tuvo un problema programando un viaje?';
    }
  }
  switch (topic) {
    case 'doctor':         return "I understand. What happened with your doctor — an appointment, the plan network, an authorization, or something they told you?";
    case 'specialist':     return "I understand. What happened with your specialist — the network, an authorization, a referral, or something they told you?";
    case 'hospital':       return "I understand. Is it about a bill, coverage, an authorization, or an appointment/procedure?";
    case 'bill':           return "I understand. Does the document say you owe an amount, or does it look like an Explanation of Benefits?";
    case 'letter':         return "I understand. Is the letter from Medicare, Medicaid, Social Security, or from your plan?";
    case 'medication':     return "I understand. Is the issue that it's too expensive, not covered, or the pharmacy couldn't process it?";
    case 'pharmacy':       return "I understand. Did the pharmacy say the medication isn't covered, it's too expensive, or it needs prior authorization?";
    case 'plan':           return "I understand. Is the issue about coverage, cost, doctors, medications, or a letter you received?";
    case 'card':           return "I understand. Is it about a lost card, one that didn't arrive, or one that's not working?";
    case 'coverage':       return "I understand. Is the question about a doctor, hospital, medication, dental/vision benefit, or something else?";
    case 'dental':         return "I understand. Do you want to know if you have a dental benefit, or do you have a problem with a dental bill or appointment?";
    case 'vision':         return "I understand. Is this about an exam, glasses, or a benefit you saw in your plan?";
    case 'otc':            return "I understand. Was the card declined, is the balance showing zero, or are you unsure how to use it?";
    case 'transportation': return "I understand. Do you need to know if you have transportation, or did you have a problem scheduling a ride?";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 27 — NEGATED INTENT + "TOLD TO CHANGE" DETECTORS
//
// Critical for office-style human conversation:
//   · "no quiero cambiar de plan" / "I don't want to change plans" must NOT
//     be classified as enrollment intent — it's a doctor/network concern.
//   · "me dijeron que debería cambiar" / "they told me to change" is the
//     user REPORTING what someone said, not a request to enroll.
//
// These detectors run BEFORE the standard enrollment / coverage handlers
// so the bot doesn't push AEP/IEP/SEP education at someone who already
// said they don't want to change.
// ─────────────────────────────────────────────────────────────────────────────

/** True if message contains a NEGATED plan/doctor/specialist change desire. */
export function detectNegatedPlanChange(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Spanish — "no quiero cambiar de plan/doctor/especialista" + variants
  if (/\bno (quiero|deseo|pienso|me interesa|necesito) (cambiar|cambiarme|mudar|perder|salir|dejar|dejarme|botar)\b/i.test(lower)) return true;
  if (/\bno quiero (cambiar|perder|dejar)\b/i.test(lower)) return true;
  if (/\bno (voy a|pienso) cambiar\b/i.test(lower)) return true;
  if (/\btampoco quiero cambiar\b/i.test(lower)) return true;
  // English — "I don't want to change/lose/switch"
  if (/\bi (don'?t|do not|dont) want to (change|switch|leave|lose|drop|cancel)\b/i.test(lower)) return true;
  if (/\b(don'?t|do not) want to (lose|change|switch|leave)\b.{0,30}(plan|insurance|coverage|doctor|specialist|provider)\b/i.test(lower)) return true;
  if (/\bi (won'?t|wont|will not) (change|switch|leave|drop)\b/i.test(lower)) return true;
  return false;
}

/** True if message reports being told to change plan (not user's own intent). */
export function detectToldToChange(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Spanish — "me dijeron que/q debería cambiar" / "me obligan a cambiar".
  // V27 — accept "q" as shorthand for "que" (common in SMS-style Spanish).
  if (/\bme dijeron (que |q )?(deber[ií]a|tendr[ií]a|tengo que|debo|tienes que|tiene que)\b.{0,40}\b(cambiar|cambiarme|cambio|mudar)\b/i.test(lower)) return true;
  if (/\bme dijeron .{0,40}\bcambiar\b/i.test(lower)) return true;
  if (/\bme (dicen|han dicho) (que |q )?(deber[ií]a|tengo que|debo)\b.{0,40}\bcambiar\b/i.test(lower)) return true;
  if (/\bme obligar?(on|ían|on)?\b.{0,30}\bcambiar\b/i.test(lower)) return true;
  // English
  if (/\b(they|someone) (told me|said i should|said i need to|said i have to)\b.{0,30}\b(change|switch|leave|drop|cancel)\b/i.test(lower)) return true;
  if (/\bi was told (to )?(change|switch|leave|drop)\b/i.test(lower)) return true;
  return false;
}

/** True if user explicitly WANTS to enroll / switch (positive intent).
 *  V27 — bails out if text contains a negation marker before "want", so
 *  "no quiero cambiar" is NOT classified as explicit-want. */
export function detectExplicitWantToChange(text: string): boolean {
  // If negation is present, this is the OPPOSITE of explicit want.
  if (detectNegatedPlanChange(text)) return false;
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Require "want" pattern not preceded by negation in the SAME clause.
  if (/(?<!\bno\s)\bquiero (cambiar(me)?|cambiar|inscribir(me)?|cancelar|enrollar(me)?|switch|change)\b/i.test(lower)) return true;
  if (/(?<!\b(don'?t|do not|dont|won'?t|wont|will not)\s)\bi (want to|wanna|need to|would like to) (change|switch|enroll|cancel|sign up)\b/i.test(lower)) return true;
  if (/(?<!\bno\s)\bme quiero inscribir\b/i.test(lower)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 24 — CMS / TPMO COMPLIANCE + SAFETY ESCALATION
//
// Crisis (988): if the caller mentions suicide, self-harm, or "giving up
// on living", the bot MUST stop everything and route to 988 + 911.
//
// PHI leak: callers sometimes type their Medicare ID, SSN, or full card
// number. The bot interrupts politely and warns. Engine never stores it
// for the advisor — that data dies in transit.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true if message contains crisis / self-harm / suicide language. */
export function detectCrisisLanguage(text: string): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Spanish crisis phrases
  if (/\b(quiero morirme|me quiero morir|ya no quiero vivir|no quiero seguir|prefiero morir|me voy a matar|me quiero matar|pensar en suicid|suicid|quitarme la vida|terminar con todo|no aguanto m[aá]s la vida|quiero acabar con todo)\b/i.test(t)) return true;
  // English crisis phrases
  if (/\b(i want to die|i'?ll kill myself|kill myself|end my life|end it all|suicide|suicidal|don'?t want to live|wanna die|going to end it|cannot go on|can'?t take it anymore)\b/i.test(t)) return true;
  return false;
}

/** Returns true if message contains Medicare ID (MBI), SSN, or 16-digit card. */
export function detectPHILeak(text: string): boolean {
  // Medicare Beneficiary Identifier (MBI) — official CMS format is
  //   C A AN N A AN N A A N N    (C=1-9, A=letter, N=digit, AN=letter|digit)
  // Example: 1EG4-TE5-MK72. We allow optional dashes/spaces between blocks.
  if (/\b[1-9][A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z]\d{2}\b/i.test(text)) return true;
  // SSN — 3-2-4 with dash or space.
  if (/\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/.test(text)) return true;
  // Bare 9-digit run that looks SSN-ish (and is NOT a phone).
  const bare9 = text.match(/(?<!\d)\d{9}(?!\d)/);
  if (bare9 && !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) return true;
  // 16-digit credit/debit card number.
  if (/\b(?:\d{4}[-\s]?){3}\d{4}\b/.test(text)) return true;
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
  // V25 — best plan question (no-recommendation compliance guard).
  if (/\b(best plan|mejor plan|what plan should|qu[eé] plan (me|debo) (escoger|elegir|recomienda|recomendar[ií]a)|which plan (is best|do you recommend)|recommend a plan|recomi[eé]nde(me)? un plan|cu[aá]l plan es mejor|qu[eé] plan es el mejor)\b/i.test(normalized)) return 'best_plan_question';
  // V26 — doctor / provider / network issues. Higher priority than coverage.
  // Catches plurals ("doctors"), "no longer accepts", "left plan/network", etc.
  if (/\b(my (doctors?|providers?|hospitals?|pcp|primary (care)?( doctor)?|specialist))\b.{0,40}\b(no longer|stopped|left|dropped|doesn'?t accept|don'?t accept|won'?t take|not (in|with) (the |my )?(network|plan)|out of (the |my )?(network|plan)|fuera de la red)\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\b(no longer (accept|accepts|accepting|in)|stopped (taking|accepting)|out[- ]of[- ]network|provider not in network|left (my |the )?(plan|network|insurance)|dropped (from|my) (plan|network|insurance)|ya no acepta|ya no trabaja|ya no est[aá] (en )?(la red|mi red)|sali[oó] de (la red|mi plan)|dej[oó] (de )?(aceptar|trabajar))\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\b(problems? (with|con)|issues? (with|con)|trouble (with|con)|problema (con)?|problemas? (con)?|tengo (un )?problemas? con|i have (a )?problems? with|i'?m having (a )?(problem|issue) with)\s+(my |mi |the |los? |la |el )?\b(doctors?|doctora|providers?|proveedores?|hospitals?|hospital|network|red|insurance|seguro|plan|especialista|specialist|pcp|primary care|m[eé]dico)\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\b(is (my |the )?(doctor|provider|hospital|specialist) (in network|covered|in my plan|accepting)|est[aá] (mi |el )?(doctor|proveedor|hospital|especialista) (en (la )?red|cubierto|en mi plan))\b/i.test(normalized)) return 'doctor_provider_network';
  // V27 — "lose my doctor/specialist" → doctor_provider_network (concern).
  if (/\b(don'?t|do not) want to lose\b.{0,30}\b(doctor|specialist|provider|pcp)\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\bno quiero perder\b.{0,30}\b(doctor|especialista|proveedor|m[eé]dico)\b/i.test(normalized)) return 'doctor_provider_network';
  // V27 — "X has a problem" / "X is having an issue" (provider-noun first).
  if (/\b(my |mi |the |la |el )?\b(doctors?|doctora|specialists?|especialistas?|providers?|proveedores?|hospitals?|pcp|primary care|m[eé]dico)\b.{0,30}\b(has (a |an )?(problem|issue)|is having (a |an )?(problem|issue)|tiene (un |una )?(problema|problemas|inconveniente|inconvenientes)|est[aá] teniendo (un |una )?problema)\b/i.test(normalized)) return 'doctor_provider_network';
  // V27 — "told to change" without negation also classifies as doctor concern.
  if (/\b(they |someone |my (doctor|specialist|provider))\s*(told me|said i should|said i need|said i have to)\s.{0,30}\b(change|switch|leave|drop|cancel)\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\bme dijeron (que )?(deber[ií]a|tengo que|tendr[ií]a que|debo)\b.{0,30}\bcambiar\b/i.test(normalized)) return 'doctor_provider_network';
  // V25 — new categories. Order: more specific first.
  if (/\b(perd[ií] mi tarjeta|lost my (plan |member |id )?card|reemplazo de tarjeta|replacement card|no me lleg[oó] (mi )?tarjeta|tarjeta no (lleg|rec)|member id card|plan card|new card)\b/i.test(normalized)) return 'id_card';
  if (/\b(otc|over[- ]the[- ]counter|flex card|healthy allowance|grocery card|tarjeta de beneficios|tarjeta flex)\b/i.test(normalized)) return 'otc';
  if (/\b(transport(ation)?|ride to (the )?doctor|rides? to (the )?(doctor|appointment)|transporte|llevar(me)? al doctor|llevar(me)? a la cita)\b/i.test(normalized)) return 'transportation';
  if (/\b(dental|dentista|dentist|teeth|dientes|dentadura|dentaduras|cleaning|limpieza dental|root canal|canal radicular|implants?|implantes? dentales)\b/i.test(normalized)) return 'dental';
  if (/\b(vision|ojos?|eye exam|eye doctor|optometr|oftalmolog|glasses|gafas|lentes|contactos?|contact lenses)\b/i.test(normalized)) return 'vision';
  if (/\b(hearing|odo|o[ií]do|hearing aid|audifono|aud[ií]fono|audiology|audiolog[ií]a)\b/i.test(normalized)) return 'hearing';
  if (/\b(turning 65|cumpliendo 65|cumplo 65|new to medicare|first time medicare|nuevo (en|a) medicare|primer[ao] vez (en )?medicare|retiring|me jubilo|jubilar(me)?)\b/i.test(normalized)) return 'new_to_medicare';
  if (/\b(extra help|lis|low[- ]income subsid|ayuda extra|subsidio (de )?bajo ingreso|low income help with drug)\b/i.test(normalized)) return 'extra_help';
  if (/\b(msp|medicare savings program|qmb|slmb|qi|programa de ahorros|ahorro de medicare)\b/i.test(normalized)) return 'msp';
  if (/\b(medigap|medicare supplement|supplement plan|plan suplementario|plan g|plan n|plan f)\b/i.test(normalized)) return 'medigap';
  if (/\b(part a|parte a|part b|parte b|part c|parte c|part d|parte d|partes? de medicare|medicare parts|que es medicare)\b/i.test(normalized)) return 'medicare_basics';
  if (/\b(aep|annual enrollment period|periodo (anual )?de inscripci[oó]n|iep|initial enrollment|sep|special enrollment|special election|ventana(s)? de inscripci[oó]n|when can i enroll|cuando me inscribo)\b/i.test(normalized)) return 'enrollment_windows';
  if (/\b(irmaa|income[- ]related (monthly )?adjustment|income adjustment to part b|ajuste por ingreso|premium subi[oó]|premium increase|increase in premium|mi prima subi[oó])\b/i.test(normalized)) return 'irmaa_premium';
  // Cost basics — only fires on EDUCATIONAL questions ("what is deductible")
  // so it doesn't hijack real cost statements like "I paid $18 copay" (bill).
  if (/\b(what (is|does|are)|what'?s|qu[eé] (es|son|significa)|expl[ií]queme|explain|c[oó]mo funciona|how does)\b.{0,30}\b(deducible|deductible|copay|copago|coinsurance|coseguro|out of pocket|moop|maximum out of pocket|m[aá]ximo de bolsillo|gasto m[aá]ximo)\b/i.test(normalized)) return 'cost_basics';
  if (/\b(complaint|queja|grievance|reclamo formal|complain about (the )?(plan|carrier)|me queja del plan|customer service problem|servicio al cliente)\b/i.test(normalized)) return 'complaint';
  if (/\b(billing dispute|disputed bill|disputa(r)? (una )?factura|charged twice|doble cobro|wrong amount on bill|bill is wrong)\b/i.test(normalized)) return 'billing_dispute';
  if (/\b(urgent medication|need (my )?medicine today|out of medicine|pharmacy refus|no me dieron (mi )?(medicina|medicamento)|no tengo (mi )?medicina|sin (mi )?medicina|urgent refill)\b/i.test(normalized)) return 'urgent_medication';
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

  // ─────────────────────────────────────────────────────────────────────────
  // WAVE 24 — ABSOLUTE TOP PRIORITY: SAFETY ESCALATION
  // ─────────────────────────────────────────────────────────────────────────
  // CRISIS — suicide / self-harm. Stops the bot, routes to 988 + 911.
  if (newState.step !== 'asking_language' && detectCrisisLanguage(userMessage)) {
    const isEs = newState.language === 'es';
    const out = isEs
      ? 'Lo que está sintiendo es importante y usted no está solo. Por favor llame ahora mismo a la **Línea 988 de Crisis y Suicidio** — llame o envíe un mensaje al **988**. Hay personas disponibles 24 horas que hablan español y le pueden ayudar gratis. Si está en peligro inmediato, marque **911**. Yo aquí no soy la persona adecuada para esto — usted merece hablar con alguien capacitado ahora.'
      : "What you're feeling matters and you are not alone. Please contact the **988 Suicide and Crisis Lifeline** right now — call or text **988**. People are available 24 hours a day, in English and Spanish, free of charge. If you are in immediate danger, dial **911**. I'm not the right help for this — you deserve to talk to someone trained right now.";
    newState.emotionalState = 'crisis';
    newState.needsHuman = true;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: true };
  }

  // PHI LEAK — Medicare ID / SSN / card number. Warns, does NOT store.
  if (newState.step !== 'asking_language' && detectPHILeak(userMessage)) {
    const isEs = newState.language === 'es';
    // Replace the just-pushed user message with a sanitized placeholder so
    // sensitive data never lives in state.messages (and never reaches GHL).
    newState.messages[newState.messages.length - 1].content = isEs
      ? '[Mensaje contenía datos sensibles — ocultado por seguridad]'
      : '[Message contained sensitive data — hidden for safety]';
    const out = isEs
      ? 'Por su seguridad acabo de ocultar ese mensaje. Por favor no envíe su número de Medicare, Seguro Social, número de tarjeta, ni datos bancarios aquí. Esa información solo debe darla a un asesor licenciado por teléfono o en persona. ¿Quiere que le conecte con un asesor licenciado para continuar de manera segura?'
      : "For your safety I just hid that message. Please do not send your Medicare number, Social Security, card number, or banking info here. That information should only be shared with a licensed advisor by phone or in person. Would you like me to connect you with a licensed advisor so you can continue safely?";
    newState.quickReplies = isEs
      ? ['Sí, hablar con asesor', 'Continuar sin ese dato', 'Llamar 1-866-310-8702']
      : ['Yes, talk to advisor', 'Continue without that info', 'Call 1-866-310-8702'];
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

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
  // V25 — also skipped at asking_zip_natural step so soft "no"/"no quiero"
  // are treated as ZIP refusal (not frustration).
  // ─────────────────────────────────────────────────────────────────────────
  if (newState.step !== 'asking_language' && newState.step !== 'asking_zip_natural') {
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
    // CLARIFICATION — "what does IRMAA mean?". V25 — only fire if the
    // question doesn't match a specific Medicare category (otherwise the
    // category handler answers it directly).
    if (detectClarificationRequest(userMessage)) {
      const probaForClarification = detectProblemType(userMessage);
      const isStrongCategory = probaForClarification
        && probaForClarification !== 'general'
        && probaForClarification !== 'casual';
      if (!isStrongCategory) {
        const out = isSpanish
          ? 'Claro, con mucho gusto se lo explico de manera sencilla. ¿Me puede decir exactamente cuál palabra o frase quiere que aclare? Si es algo del documento que tiene en mano, escríbamelo tal cual está y se lo traduzco.'
          : "Of course, I'd be glad to explain it in simple terms. Can you tell me exactly which word or phrase you'd like me to clarify? If it's something from the document in front of you, type it as it appears and I'll translate it for you.";
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // Else fall through — the specific category handler will answer.
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
      newState.step = 'asking_zip_natural';
      // V25 — ZIP early but natural, NO chips.
      const out = "Of course. To best help you and stay in your area, could you write your ZIP code?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (msg.includes('español') || msg.includes('espanol') || msg === 'es') {
      newState.language = 'es';
      newState.step = 'asking_zip_natural';
      // V25 — ZIP early but natural, NO chips.
      const out = 'Claro. Para ubicar bien el área y orientarle mejor, ¿me puede escribir su ZIP code?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    const out = 'Please select English or Español. Por favor seleccione English o Español.';
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // ───── STEP 2 (V25): ASKING ZIP NATURALLY ─────
  // Bot asks for ZIP early but as a natural conversation, not as a form.
  // The user can give it, refuse it, or jump straight to their issue.
  if (newState.step === 'asking_zip_natural') {
    const trimmed = userMessage.trim();
    const zipDigits = trimmed.replace(/\D/g, '');
    // Path A: user gave a clean 5-digit ZIP.
    if (zipDigits.length === 5 && trimmed.length <= 10) {
      const detectedState = getStateFromZip(zipDigits);
      newState.zipCode = zipDigits;
      newState.zipCodeIsValid = !!detectedState;
      if (detectedState) {
        newState.state = detectedState;
        newState.isValidState = true;
      } else {
        newState.isValidState = false;
        flagInconsistency(newState, `zip_not_in_service_area: ${zipDigits}`, 25);
      }
      newState.step = 'asking_topic';
      const out = isSpanish
        ? 'Gracias. ¿En qué le puedo ayudar hoy?'
        : 'Thank you. How can I help you today?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // Path B: user refused ZIP — "no", "no quiero", "skip", "prefiero no".
    if (/^(no|nope|no quiero|prefiero no|no s[eé]|skip|paso|m[aá]s tarde|later|prefer not|i'?d rather not|no thanks|no gracias)\.?$/i.test(trimmed)
        || /\b(no quiero (decir|dar|compartir)|prefiero no decir|i (don'?t|do not) want to (share|give)|prefer not to (share|say))\b/i.test(trimmed)) {
      newState.zipRefused = true;
      newState.step = 'asking_topic';
      const out = isSpanish
        ? 'No hay problema. ¿En qué le puedo ayudar?'
        : 'No problem. How can I help you?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // Path C: user jumped straight to topic OR is emoting / typing a sentence.
    const probableIntent = detectProblemType(trimmed);
    const emotion = detectEmotion(trimmed);
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    const hasPhone = /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(trimmed);
    // Also detect abuse here (we skipped the global abuse check at this step).
    // V25 — fire on severe OR mild frustration. Soft refusals already handled
    // by Path B above, so they don't reach here.
    const abuseHere = detectAbuseOrFrustration(trimmed);
    if (abuseHere.detected) {
      // Distinguish soft refusal from real frustration. Soft phrases like
      // a bare "no" already matched Path B, so anything here is real anger.
      const looksSoft = /^(no+|nope|nah|no quiero|ya no|d[eé]jalo|d[eé]jeme|leave me alone)\.?$/i.test(trimmed.trim());
      if (!looksSoft) {
        newState.frustrationCount = (newState.frustrationCount || 0) + 1;
        newState.emotionalState = abuseHere.severity === 'severe' ? 'angry' : 'frustrated';
        return enterRecoveryMode(newState, 'frustration');
      }
    }
    const isStrongIntent = probableIntent && probableIntent !== 'general' && probableIntent !== 'casual';
    const isEmoting = emotion === 'grieving' || emotion === 'urgent' || emotion === 'frustrated';
    const isFullSentence = wordCount >= 4 || hasPhone;
    if (isStrongIntent || isEmoting || isFullSentence) {
      newState.zipRefused = true;
      newState.step = 'conversation';
      // fall through to conversation block — it will handle the intent/emotion.
    } else {
      // Path D: unclear input — politely re-ask once.
      const out = isSpanish
        ? 'Disculpe, no logré leer un código postal. Si prefiere no compartirlo, dígame "no" y seguimos. ¿Su ZIP code de 5 dígitos?'
        : "Sorry, I couldn't read a ZIP code. If you'd rather not share it, just say \"no\" and we can continue. What's your 5-digit ZIP?";
      newState.failedZipAttempts = (newState.failedZipAttempts || 0) + 1;
      // After 2 failed attempts → continue without ZIP.
      if ((newState.failedZipAttempts || 0) >= 2) {
        newState.zipRefused = true;
        newState.step = 'asking_topic';
        const skip = isSpanish
          ? 'No hay problema, seguimos sin ZIP por ahora. ¿En qué le puedo ayudar?'
          : "No problem, let's continue without ZIP for now. How can I help you?";
        newState.messages.push({ role: 'bot', content: skip, timestamp: Date.now() });
        return { response: skip, newState, needsHuman: false };
      }
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
  }

  // ───── STEP 3 (V25): ASKING TOPIC ─────
  // Open question. NO auto-chips. User types freely.
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
    // V20 — finalize handoff when identity collection completes. V24 — add
    // the full TPMO Final Rule 2024 disclaimer (SHIP + 1-800-MEDICARE +
    // Medicare.gov + independent agency statement) for compliance with
    // 42 CFR 422.2267(e)(41).
    if (newState.pendingAdvisorHandoff) {
      newState.step = 'conversation';
      newState.needsHuman = true;
      const outA = isSpanish
        ? `Perfecto${withName(newState.name)}. Estoy preparando su caso para un asesor licenciado bilingüe de ClearPoint. Sin presión y sin costo. Le contactarán pronto, o si prefiere llamar ahora: **1-866-310-8702**.\n\n*ClearPoint Senior Advisors es una agencia independiente. No ofrecemos todos los planes disponibles en su área. Para ver todas sus opciones también puede contactar **Medicare.gov**, llamar al **1-800-MEDICARE** (1-800-633-4227, 24 horas, en español), o su programa **SHIP** local de consejería gratuita imparcial en shiptacenter.org.*\n\nGracias por su confianza.`
        : `Perfect${withName(newState.name)}. I'm preparing your case for a licensed bilingual ClearPoint advisor. No pressure, no cost. They will reach out soon, or call now: **1-866-310-8702**.\n\n*ClearPoint Senior Advisors is an independent agency. We do not offer every plan available in your area. To see all your options you can also contact **Medicare.gov**, call **1-800-MEDICARE** (1-800-633-4227, 24 hours, Spanish available), or your local **SHIP** program for free unbiased counseling at shiptacenter.org.*\n\nThank you for your trust.`;
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
    let problemType = effectiveIntent;
    // ──────────────────────────────────────────────────────────────────────
    // WAVE 28 — CLARIFY-BEFORE-EXPLAINING LAYER
    //
    // If the user reported a vague problem ("tengo problemas con mi doctor"),
    // ASK what happened — don't launch a full Medicare flow. Skips when:
    //  · message has a specific qualifier ("no longer accepts" / "denied" /
    //    "$X" / "from Medicare"),
    //  · OR the bot's previous message was already a clarification (we don't
    //    want to ask twice in a row),
    //  · OR user is in advisor handoff flow.
    // ──────────────────────────────────────────────────────────────────────
    if (!newState.pendingAdvisorHandoff) {
      const vague = detectVagueProblemReport(userMessage);
      // Track whether last bot question was already this clarification
      const lastWasSameClarification = !!newState.lastBotQuestion
        && vague.topic
        && newState.lastBotQuestion === getTopicClarification(vague.topic, isSpanish);
      if (vague.isVague && vague.topic && !lastWasSameClarification) {
        const clarification = getTopicClarification(vague.topic, isSpanish);
        // Map vague topic → serviceCategory for routing memory
        const topicToCategory: Record<VagueTopic, string> = {
          doctor: 'doctor_provider_network',
          specialist: 'doctor_provider_network',
          hospital: 'doctor_provider_network',
          plan: 'plan_general',
          medication: 'drug',
          pharmacy: 'drug',
          bill: 'bill',
          letter: 'letter',
          card: 'id_card',
          coverage: 'coverage',
          dental: 'dental',
          vision: 'vision',
          otc: 'otc',
          transportation: 'transportation',
        };
        newState.serviceCategory = topicToCategory[vague.topic];
        newState.subIssue = 'vague_report';
        newState.lastBotQuestion = clarification;
        newState.intent = newState.serviceCategory;
        newState.routingLevel = 'B'; // Educate-then-route
        newState.messages.push({ role: 'bot', content: clarification, timestamp: Date.now() });
        return { response: clarification, newState, needsHuman: false };
      }
    }

    // V26 — Active-category override. If user is already in
    // doctor_provider_network flow, force-route subsequent messages through
    // that handler even when detectProblemType returns 'coverage' (because
    // of "doctor" keyword) or 'general'. This makes continuation work:
    // "she is my primary doctor" stays in the doctor flow instead of
    // bouncing into the generic coverage handler.
    if (newState.serviceCategory === 'doctor_provider_network'
        && (problemType === 'coverage' || problemType === 'general' || problemType === 'enrollment')) {
      // V27 — when category is doctor_provider_network and user types
      // something that classifies as enrollment ("cambiar de plan"), check
      // for negation. If user explicitly wants to enroll, let enrollment win.
      // Otherwise keep them in doctor flow.
      const wantsExplicit = detectExplicitWantToChange(userMessage);
      if (!wantsExplicit) {
        problemType = 'doctor_provider_network';
        newState.intent = 'doctor_provider_network';
      }
    }
    // V27 — NEGATED INTENT + "TOLD TO CHANGE" override.
    // Critical office logic: "no quiero cambiar de plan" must NEVER be
    // classified as enrollment. "me dijeron que debería cambiar" is a
    // CONCERN that someone pressured the user, not an enrollment request.
    // Only an explicit "I want to change" routes to enrollment.
    const negatedChange = detectNegatedPlanChange(userMessage);
    const toldToChange = detectToldToChange(userMessage);
    const explicitWant = detectExplicitWantToChange(userMessage);
    if ((negatedChange || toldToChange) && !explicitWant) {
      // Force-route through doctor_provider_network with concern sub-issue.
      problemType = 'doctor_provider_network';
      newState.intent = 'doctor_provider_network';
      newState.serviceCategory = 'doctor_provider_network';
      if (negatedChange) {
        newState.doesNotWantPlanChange = true;
        const lowerMsg = userMessage.toLowerCase();
        if (/specialist|especialista/i.test(lowerMsg)) newState.wantsToKeepSpecialist = true;
        if (/doctor|m[eé]dico/i.test(lowerMsg) && !/especialista|specialist/i.test(lowerMsg)) {
          newState.wantsToKeepDoctor = true;
        }
      }
      if (toldToChange) {
        newState.subIssue = 'told_to_change_plan';
      }
    }
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

      // V25 — Provider source + amount known. SHORT office tone (2 sentences
      // per bubble, split with \n\n). USTED form. Routing level B.
      if (src === 'provider' && amount) {
        newState.routingLevel = 'B';
        newState.serviceCategory = 'bill_provider';
        const amountFormatted = Number(amount).toLocaleString('en-US');
        const history = fullUserHistory(newState, userMessage);
        const isHospital = /\b(hospital|hospitals|ospital|hopital|hospita|hostpital|hospitl|hospitall|hospitales|emergency room|sala de emergencias)\b/i.test(history)
          || fuzzyConcept(history) === 'hospital';
        const sourceEs = isHospital ? 'de hospital' : 'del médico u hospital';
        const sourceEn = isHospital ? 'from a hospital' : 'from a doctor or hospital';
        const out = isSpanish
          ? `Entiendo. Una factura de $${amountFormatted} ${sourceEs} hay que revisarla con calma antes de asumir que usted debe pagar eso.\n\n¿El papel dice "amount due", "balance due" o "patient responsibility"? No envíe Medicare ID ni datos sensibles.`
          : `Got it. A $${amountFormatted} bill ${sourceEn} needs a careful look before assuming you owe it.\n\nDoes the paper say "amount due", "balance due", or "patient responsibility"? Please don't send Medicare ID or sensitive data.`;
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
    // ──────────────────────────────────────────────────────────────────────
    // WAVE 25 — A/B/C ROUTING + NEW MEDICARE CATEGORIES
    // Short, office-tone responses. Level A (bot resolves), Level B (educate +
    // optional advisor), Level C (advisor recommended). Compliance built in.
    // ──────────────────────────────────────────────────────────────────────

    // V26/V27 — Doctor / provider / network handler.
    // First message → ask if leaving network, needs authorization, or pressured to change.
    // Continuation message → answer with sub-issue.
    // V27 → if user negated plan change or said someone told them, respond
    // respecting their preference and asking WHO told them.
    if (problemType === 'doctor_provider_network') {
      newState.serviceCategory = 'doctor_provider_network';
      newState.routingLevel = 'B';
      const msgLow = userMessage.toLowerCase();
      // Sub-issue detection
      const isLeftNetwork = /\b(no longer|stopped|left|dropped|doesn'?t accept|don'?t accept|won'?t take|out of (the |my )?(network|plan)|ya no acepta|ya no trabaja|sali[oó] de|dej[oó] (de )?(aceptar|trabajar))\b/i.test(msgLow);
      const isVerifyCoverage = /\b(is .*(in network|covered|accepted)|est[aá] .*(en (la )?red|cubierto|aceptado)|do you know if|sabe si|verify|verificar|confirmar)\b/i.test(msgLow);
      // Provider-type detection for follow-up question
      const isPrimary = /\b(primary care|primary doctor|pcp|primario|m[eé]dico primario|family doctor|m[eé]dico de familia)\b/i.test(msgLow);
      const isSpecialist = /\b(specialist|especialista|cardiolog|dermatolog|oncolog|cardi[oó]log|oftalmolog|gastroenterolog|endocrinolog|neurolog)\b/i.test(msgLow);
      const isHospital = /\b(hospital|hospitales|er|emergency room|sala de emergencias|cl[ií]nica)\b/i.test(msgLow);
      // V27 — Priority A: FIRST turn after user said "don't want to change"
      // (planChangeAcknowledged=false). Acknowledge preference + ask WHO told.
      if ((newState.subIssue === 'told_to_change_plan' || newState.doesNotWantPlanChange)
          && !newState.planChangeAcknowledged) {
        const keptItem = newState.wantsToKeepSpecialist ? (isSpanish ? 'especialista' : 'specialist')
                       : newState.wantsToKeepDoctor ? (isSpanish ? 'doctor' : 'doctor')
                       : (isSpanish ? 'plan' : 'plan');
        const out = isSpanish
          ? `Entiendo. Si usted no quiere cambiar de plan ni de ${keptItem}, no vamos a asumir que cambiar sea la respuesta. Primero hay que verificar qué está causando el problema.\n\n¿Quién le dijo que tendría que cambiar: el especialista, el plan, o otra persona?`
          : `Understood. If you don't want to change your plan or your ${keptItem}, we won't assume change is the answer. First we need to verify what's causing the problem.\n\nWho told you to change: the specialist, the plan, or someone else?`;
        newState.planChangeAcknowledged = true;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // V27 — Priority B: SUBSEQUENT turn after acknowledgment, user identifies
      // who told them (specialist/doctor/plan/letter) → next step: verification.
      if (newState.subIssue === 'told_to_change_plan'
          && newState.planChangeAcknowledged
          && (/\b(specialist|especialista)\b/i.test(msgLow)
              || /\b(doctor|doctora|m[eé]dico|pcp|primary)\b/i.test(msgLow)
              || /\b(plan|insurance|carrier|seguro|aseguradora)\b/i.test(msgLow)
              || /\b(letter|carta|aviso)\b/i.test(msgLow))) {
        const out = isSpanish
          ? `Anotado. Eso no significa que usted tenga que cambiar. Lo importante es entender por qué se lo dijeron — puede ser por red, por autorización previa, por referido, o porque el proveedor salió del plan.\n\nUn asesor licenciado puede verificarlo con el plan y orientarle antes de cualquier decisión. ¿Quiere que coordine eso?`
          : `Got it. That doesn't mean you have to change. What matters is understanding WHY they said that — could be network, prior authorization, a referral, or the provider leaving the plan.\n\nA licensed advisor can verify it with the plan and guide you before any decision. Want me to set that up?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // Provider-type continuation answer (for provider_left_network sub-issue)
      if (newState.subIssue === 'provider_left_network' && (isPrimary || isSpecialist || isHospital)) {
        const ptype = isPrimary ? (isSpanish ? 'doctor primario' : 'primary doctor')
                    : isSpecialist ? (isSpanish ? 'especialista' : 'specialist')
                    : (isSpanish ? 'hospital' : 'hospital');
        const out = isSpanish
          ? `Anotado — es sobre su ${ptype}. Un asesor licenciado puede verificar la red del plan y orientarle sobre las opciones antes de cualquier cambio. ¿Quiere que coordine eso?`
          : `Got it — it's about your ${ptype}. A licensed advisor can verify the plan's network and walk through your options before any change. Want me to set that up?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // Continuation with sub-issue detection (e.g., "they no longer work with my insurance")
      if (isLeftNetwork) {
        newState.subIssue = 'provider_left_network';
        const out = isSpanish
          ? `Eso generalmente significa que el proveedor ya no está en la red del plan. No puedo verificarlo desde aquí sin revisar el plan y el área, pero un asesor licenciado puede ayudar a revisarlo antes de que tome una decisión.\n\n¿Es su doctor primario, un especialista, o un hospital?`
          : `That usually means the provider may no longer be in your plan's network. I cannot verify that from here without checking the plan and area, but a licensed advisor can help review it before you make any decision.\n\nIs this your primary doctor, a specialist, or a hospital?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      if (isVerifyCoverage) {
        newState.subIssue = 'provider_verify_network';
        const out = isSpanish
          ? `Para confirmar si un doctor o proveedor está en la red, hay que revisar el plan específico y el área. Yo no puedo verificarlo desde aquí.\n\nUn asesor licenciado puede revisar la red del plan. ¿Es su doctor primario, un especialista, o un hospital?`
          : `To confirm whether a doctor or provider is in network, we need to check the specific plan and area. I cannot verify that from here.\n\nA licensed advisor can review the plan's network. Is this your primary doctor, a specialist, or a hospital?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // V27 — First mention. Short office-tone. 3 options including "told to change".
      const out = isSpanish
        ? `Entiendo. Vamos a revisar eso con calma. ¿El problema es que el especialista ya no acepta su plan, necesita una autorización, o le dijeron que debe cambiar de plan?`
        : `I understand. Let's look at this calmly. Is the issue that your specialist no longer accepts your plan, that you need an authorization, or that someone told you to change plans?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // No-recommendation guard — compliance critical.
    if (problemType === 'best_plan_question') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'best_plan_question';
      const out = isSpanish
        ? 'No puedo decirle que un plan es "el mejor". Eso depende de sus doctores, medicinas, condado, farmacia y necesidades.\n\nUn asesor licenciado puede revisar las opciones disponibles y explicárselas para que usted decida.'
        : "I can't tell you a plan is 'the best.' That depends on your doctors, medications, county, pharmacy, and needs.\n\nA licensed advisor can review the options available and explain them so you can decide.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'id_card') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'id_card';
      const out = isSpanish
        ? 'Ok. Generalmente la tarjeta del plan se reemplaza llamando a Member Services del plan o entrando al portal del carrier.\n\nNo me envíe su Medicare ID aquí. Si quiere, le ayudo a organizar qué información tener lista antes de llamar.'
        : "Ok. The plan card is usually replaced by calling the plan's Member Services or logging into the carrier portal.\n\nPlease don't send your Medicare ID here. If you'd like, I can help you organize what to have ready before calling.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'otc') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'otc';
      const out = isSpanish
        ? 'Claro. Muchas tarjetas OTC tienen reglas por tienda, producto y fecha de recarga.\n\n¿La tarjeta fue rechazada en la tienda, o el balance aparece en cero?'
        : 'Sure. Many OTC cards have rules by store, product, and reload date.\n\nWas the card declined at the store, or is the balance showing zero?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'transportation') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'transportation';
      const out = isSpanish
        ? 'Anotado. El beneficio de transporte varía por plan — algunos cubren viajes médicos limitados.\n\n¿Necesita organizar un viaje a una cita, o entender qué cubre su plan?'
        : "Got it. Transportation benefits vary by plan — some cover a limited number of medical trips.\n\nDo you need to set up a ride to an appointment, or understand what your plan covers?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'dental') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'dental';
      const out = isSpanish
        ? 'Medicare Original normalmente no cubre dental rutinario. Algunos planes Medicare Advantage incluyen dental, pero depende del plan y del área.\n\nPara confirmar cobertura específica habría que revisar el plan. ¿Quiere que un asesor licenciado le ayude a revisarlo?'
        : "Original Medicare usually does not cover routine dental. Some Medicare Advantage plans include dental, but it depends on the plan and area.\n\nTo confirm specific coverage we'd need to review the plan. Would you like a licensed advisor to help?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'vision') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'vision';
      const out = isSpanish
        ? 'Medicare Original cubre algunas pruebas de la vista limitadas, pero no anteojos rutinarios. Muchos planes Advantage incluyen vision.\n\n¿Es sobre un examen, anteojos, o un beneficio que vio en su plan?'
        : 'Original Medicare covers some limited eye tests but not routine glasses. Many Advantage plans include vision.\n\nIs this about an exam, glasses, or a benefit you saw in your plan?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'hearing') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'hearing';
      const out = isSpanish
        ? 'Medicare Original generalmente no cubre audífonos ni exámenes rutinarios. Algunos planes Advantage los incluyen.\n\n¿Es sobre un examen de audición, audífonos, o entender qué cubre su plan?'
        : "Original Medicare generally does not cover hearing aids or routine exams. Some Advantage plans include them.\n\nIs this about a hearing exam, hearing aids, or understanding what your plan covers?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'new_to_medicare') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'new_to_medicare';
      const out = isSpanish
        ? 'Bienvenido a Medicare. La ventana inicial es 3 meses antes del mes que cumple 65, el mes del cumpleaños, y 3 meses después.\n\nSi me cuenta su situación (cumpleaños, si trabaja o se jubila), un asesor puede orientarle sobre Parte A, B, y opciones de plan.'
        : "Welcome to Medicare. The initial window is 3 months before your 65th birthday month, the birthday month, and 3 months after.\n\nIf you share your situation (birthday, working or retiring), a licensed advisor can walk through Part A, B, and plan options.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'extra_help' || problemType === 'msp') {
      newState.routingLevel = 'A';
      newState.serviceCategory = problemType;
      const isExtraHelp = problemType === 'extra_help';
      const out = isSpanish
        ? (isExtraHelp
          ? 'Extra Help (LIS) es un programa federal que puede ayudar con costos de medicamentos de Medicare Parte D para personas con ingresos y recursos limitados.\n\nEsto no confirma su elegibilidad. Puede aplicar por Social Security (ssa.gov/extrahelp) o un asesor licenciado puede revisar su caso.'
          : 'Los Medicare Savings Programs (MSP) son programas estatales que pueden ayudar a pagar Parte B y otros costos para personas con ingresos limitados. Los niveles son QMB, SLMB, y QI.\n\nEsto no confirma elegibilidad — el estado o un asesor pueden revisarlo.')
        : (isExtraHelp
          ? "Extra Help (LIS) is a federal program that can help with Medicare Part D drug costs for people with limited income and resources.\n\nThis doesn't confirm your eligibility. You can apply through Social Security (ssa.gov/extrahelp) or a licensed advisor can review your case."
          : "Medicare Savings Programs (MSP) are state programs that can help pay Part B and other costs for people with limited income. The levels are QMB, SLMB, and QI.\n\nThis doesn't confirm eligibility — your state or a licensed advisor can review it.");
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'medigap') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'medigap';
      const out = isSpanish
        ? 'Medigap (Medicare Supplement) son planes que ayudan a cubrir lo que Medicare Original no paga (deducibles, coseguro). Funcionan junto a Medicare Original, no con Advantage.\n\nLos planes tienen letras (G, N, etc.). Un asesor licenciado puede comparar opciones para que usted decida.'
        : "Medigap (Medicare Supplement) plans help cover what Original Medicare doesn't pay (deductibles, coinsurance). They work alongside Original Medicare, not with Advantage.\n\nPlans are lettered (G, N, etc.). A licensed advisor can compare options so you can decide.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'medicare_basics') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'medicare_basics';
      const out = isSpanish
        ? 'Medicare tiene 4 partes: A (hospital), B (médicos y servicios ambulatorios), C (Medicare Advantage — combina A + B + a veces D y extras), y D (medicamentos recetados).\n\n¿Quiere que le explique alguna parte en más detalle?'
        : 'Medicare has 4 parts: A (hospital), B (doctors and outpatient services), C (Medicare Advantage — combines A + B + sometimes D and extras), and D (prescription drugs).\n\nWant me to explain any part in more detail?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'enrollment_windows') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'enrollment_windows';
      const out = isSpanish
        ? 'Hay tres ventanas principales: IEP (3 meses antes/durante/después de cumplir 65), AEP (15 oct - 7 dic, cambios anuales), y SEP (eventos especiales como mudanza, pérdida de cobertura, doble elegibilidad).\n\n¿Cuál aplica a su caso?'
        : "Three main windows: IEP (3 months before/during/after turning 65), AEP (Oct 15 - Dec 7, annual changes), and SEP (special events like moving, losing coverage, dual eligibility).\n\nWhich one applies to you?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'irmaa_premium') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'irmaa_premium';
      const out = isSpanish
        ? 'IRMAA es un cargo extra de Parte B y D para personas con ingresos altos, basado en la declaración de impuestos. La carta viene de Social Security.\n\n¿Recibió una carta de IRMAA, o el premium subió por otra razón? Un asesor puede ayudarle a revisar la apelación si aplica.'
        : "IRMAA is an extra Part B and D charge for people with higher incomes, based on your tax return. The notice comes from Social Security.\n\nDid you get an IRMAA letter, or did your premium go up for another reason? A licensed advisor can help review an appeal if it applies.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'cost_basics') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'cost_basics';
      const out = isSpanish
        ? 'Rápido: deducible es lo que paga antes que el plan empiece. Copay es lo fijo por visita o medicamento. Coseguro es un porcentaje del costo. MOOP es el máximo de bolsillo del año.\n\n¿Cuál término le está causando duda?'
        : "Quick: deductible is what you pay before the plan kicks in. Copay is the fixed amount per visit or drug. Coinsurance is a percentage of the cost. MOOP is the yearly out-of-pocket maximum.\n\nWhich term is causing the question?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'complaint' || problemType === 'billing_dispute') {
      newState.routingLevel = 'C';
      newState.serviceCategory = problemType;
      const out = isSpanish
        ? 'Lamento que esté pasando por esto. Una queja formal contra un plan puede ir a Member Services del carrier, luego al Medicare Beneficiary Ombudsman si no se resuelve.\n\nUn asesor licenciado puede ayudarle a organizar el caso y los documentos.'
        : "I'm sorry you're going through this. A formal complaint against a plan can go to the carrier's Member Services, then the Medicare Beneficiary Ombudsman if unresolved.\n\nA licensed advisor can help you organize the case and documents.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'urgent_medication') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'urgent_medication';
      newState.needsHuman = true;
      const out = isSpanish
        ? 'Eso es urgente. Primero: si necesita su medicina hoy, llame al carrier de su plan ahora mismo (el número está en la tarjeta del plan) — pueden autorizar un suministro temporal en la farmacia.\n\nVoy a marcar su caso para que un asesor licenciado le contacte cuanto antes.'
        : "That's urgent. First: if you need your medicine today, call your plan's carrier right now (the number is on your plan card) — they can authorize a temporary supply at the pharmacy.\n\nI'm flagging your case so a licensed advisor reaches out as soon as possible.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: true };
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
        ? `Perfecto${withName(newState.name)}. Estoy preparando su caso para un asesor licenciado bilingüe de ClearPoint. Sin presión y sin costo. Le contactarán pronto, o si prefiere llamar ahora: **1-866-310-8702**.\n\n*ClearPoint Senior Advisors es una agencia independiente. No ofrecemos todos los planes disponibles en su área. Para ver todas sus opciones también puede contactar **Medicare.gov**, llamar al **1-800-MEDICARE** (1-800-633-4227, 24 horas, en español), o su programa **SHIP** local de consejería gratuita imparcial en shiptacenter.org.*\n\nGracias por su confianza.`
        : `Perfect${withName(newState.name)}. I'm preparing your case for a licensed bilingual ClearPoint advisor. No pressure, no cost. They will reach out soon, or call now: **1-866-310-8702**.\n\n*ClearPoint Senior Advisors is an independent agency. We do not offer every plan available in your area. To see all your options you can also contact **Medicare.gov**, call **1-800-MEDICARE** (1-800-633-4227, 24 hours, Spanish available), or your local **SHIP** program for free unbiased counseling at shiptacenter.org.*\n\nThank you for your trust.`;
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

    // V26 — CONTINUATION ROUTING.
    // If we already have a serviceCategory and the user's new message is
    // vague but matches keywords for the active category, route through that
    // category's continuation handler instead of the generic fallback.
    if (newState.serviceCategory) {
      const msgLow = userMessage.toLowerCase();
      // Doctor / provider / network continuation
      if (newState.serviceCategory === 'doctor_provider_network') {
        const hasNetworkSignal = /\b(no longer|stopped|left|dropped|insurance|seguro|plan|network|red|doesn'?t|don'?t|won'?t|ya no|sali|dej[oó]|work with|trabaja con|accept|acepta|covered|cubierto|drop me|me sacaron)\b/i.test(msgLow);
        const isPrimary = /\b(primary|pcp|primario|family doctor|m[eé]dico de familia)\b/i.test(msgLow);
        const isSpecialist = /\b(specialist|especialista|cardi|derma|onco|oftalmo|gastro|endo|neuro)\b/i.test(msgLow);
        const isHospital = /\b(hospital|er|emergency|cl[ií]nica)\b/i.test(msgLow);
        if (isPrimary || isSpecialist || isHospital) {
          const ptype = isPrimary ? (isSpanish ? 'doctor primario' : 'primary doctor')
                      : isSpecialist ? (isSpanish ? 'especialista' : 'specialist')
                      : (isSpanish ? 'hospital' : 'hospital');
          const outc = isSpanish
            ? `Anotado — es sobre su ${ptype}. Un asesor licenciado puede verificar la red del plan y orientarle sobre las opciones antes de cualquier cambio. ¿Quiere que coordine eso?`
            : `Got it — it's about your ${ptype}. A licensed advisor can verify the plan's network and walk through your options before any change. Want me to set that up?`;
          newState.messages.push({ role: 'bot', content: outc, timestamp: Date.now() });
          return { response: outc, newState, needsHuman: false };
        }
        if (hasNetworkSignal) {
          newState.subIssue = newState.subIssue || 'provider_left_network';
          const outc = isSpanish
            ? `Eso generalmente significa que el proveedor ya no está en la red del plan. No puedo verificarlo desde aquí sin revisar el plan y el área, pero un asesor licenciado puede ayudar a revisarlo antes de que tome una decisión.\n\n¿Es su doctor primario, un especialista, o un hospital?`
            : `That usually means the provider may no longer be in your plan's network. I cannot verify that from here without checking the plan and area, but a licensed advisor can help review it before you make any decision.\n\nIs this your primary doctor, a specialist, or a hospital?`;
          newState.messages.push({ role: 'bot', content: outc, timestamp: Date.now() });
          return { response: outc, newState, needsHuman: false };
        }
      }
      // Drug / pharmacy continuation
      if (newState.serviceCategory === 'drug' || newState.intent === 'drug') {
        if (/\b(expensive|caro|cost|costo|not covered|no cubierto|pharmacy|farmacia|denied|negaron|negado|refill|copay|copago)\b/i.test(msgLow)) {
          const outc = isSpanish
            ? `Anotado. Eso suele depender del formulario del plan, del nivel del medicamento, o si requiere autorización previa. Un asesor licenciado puede revisarlo con la farmacia y el plan.`
            : `Got it. That usually depends on the plan's formulary, the drug tier, or whether prior authorization is needed. A licensed advisor can review it with the pharmacy and plan.`;
          newState.messages.push({ role: 'bot', content: outc, timestamp: Date.now() });
          return { response: outc, newState, needsHuman: false };
        }
      }
      // OTC continuation
      if (newState.serviceCategory === 'otc') {
        if (/\b(card|tarjeta|declined|rechaz|balance|cero|zero|reload|recarga)\b/i.test(msgLow)) {
          const outc = isSpanish
            ? `Anotado. Eso suele resolverse llamando al carrier (número en la tarjeta del plan) — ellos confirman el balance, productos elegibles, y la fecha de recarga.`
            : `Got it. That usually resolves by calling the carrier (number on the plan card) — they can confirm the balance, eligible products, and reload date.`;
          newState.messages.push({ role: 'bot', content: outc, timestamp: Date.now() });
          return { response: outc, newState, needsHuman: false };
        }
      }
      // Bill continuation
      if (newState.serviceCategory === 'bill_provider' || newState.intent === 'bill') {
        if (/\b(amount|cantidad|bill|factura|cobro|charge|cargo|owe|debo|paid|pagu[eé])\b/i.test(msgLow)) {
          const outc = isSpanish
            ? `Anotado. Si la factura tiene una cantidad específica que dice "amount due" o "patient responsibility", un asesor licenciado puede revisar la factura y el EOB del plan antes que pague.`
            : `Got it. If the bill shows a specific "amount due" or "patient responsibility" line, a licensed advisor can review the bill and the plan's EOB before you pay.`;
          newState.messages.push({ role: 'bot', content: outc, timestamp: Date.now() });
          return { response: outc, newState, needsHuman: false };
        }
      }
    }

    // V26 — LOOP PREVENTION on default fallback.
    // If we already sent the same generic response last turn, pivot to chips.
    const defaultOut = isSpanish
      ? `Gracias por contarme${withName(newState.name)}. ¿Puede darme un poco más de detalle sobre su situación?`
      : `Thanks for telling me${withName(newState.name)}. Can you give me a bit more detail about your situation?`;
    const wouldRepeat = newState.lastFallbackResponse === defaultOut;
    if (wouldRepeat) {
      newState.quickReplies = isSpanish ? [...TOPIC_CHIPS_ES] : [...TOPIC_CHIPS_EN];
      const out = isSpanish
        ? `Para no perder tiempo: ¿es sobre factura, doctor, medicamentos, tarjeta, cobertura, inscripción, o prefiere hablar con un asesor?`
        : `So I don't waste your time: is this about a bill, a doctor, medications, a card, coverage, enrollment, or would you rather talk to an advisor?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      newState.lastFallbackResponse = out;
      return { response: out, newState, needsHuman: false };
    }
    newState.lastFallbackResponse = defaultOut;
    newState.messages.push({ role: 'bot', content: defaultOut, timestamp: Date.now() });
    return { response: defaultOut, newState, needsHuman: false };
  }

  // Fallback (should not reach)
  const out = isSpanish ? '¿En qué más puedo ayudarle?' : 'How else can I help you?';
  newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
  return { response: out, newState, needsHuman: false };
}

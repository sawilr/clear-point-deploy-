// ============================================================================
// CUSTOMER SERVICE ENGINE V20 — ISSUE-FIRST, IDENTITY AT HANDOFF
//
// World-class pattern (Intercom Fin, Klarna, Botpress 2026):
//   language → topic chips → conversation → (only at handoff) identity.
//
// Name + ZIP are NEVER required to start helping the user. They are
// collected at the END only when the user requests advisor follow-up.
// ============================================================================

import { PHRASE_BANK, type PhraseKey } from '../data/customerServiceIntents.ts';

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
  // ─── Wave 31: medication triage state machine ───
  /** Typed medication sub-issue, set by the medication triage handler. */
  medicationIssueType?:
    | 'cost_too_high'
    | 'not_covered'
    | 'pharmacy_rejected'
    | 'prior_auth'
    | 'step_therapy'
    | 'quantity_limit'
    | 'refill_too_soon'
    | 'pharmacy_oos'
    | 'not_on_formulary'
    | 'new_after_plan_change'
    | 'doctor_prescribed_not_covered'
    | 'letter_received'
    | 'unknown'
    | 'wants_advisor';
  /** Questions the bot has already asked in this conversation (intent keys).
   *  Used to prevent repeating the same question twice. */
  askedQuestions?: string[];
  /** Vague-answer count in medication flow — escalates to advisor at 2. */
  medicationFailedClarifications?: number;
  /** Why the case escalated to advisor (telemetry + lead notes). */
  advisorHandoffReason?: string;
  // ─── Wave 32: provider triage state machine + repetition guard ───
  /** Typed provider sub-issue, set by the provider triage handler. */
  providerIssueType?:
    | 'primary_doctor_not_accepting'
    | 'specialist_not_accepting'
    | 'provider_verify_network'
    | 'office_said_no'
    | 'appointment_issue'
    | 'referral_issue'
    | 'hospital_network'
    | 'provider_access_issue'
    | 'unknown'
    | 'wants_advisor';
  /** Normalized form of the previous user message — used by the repetition
   *  guard to detect when the user repeats themselves. */
  normalizedLastUserMessage?: string;
  /** How many consecutive turns the user has repeated the same message. */
  repeatedUserMessageCount?: number;
  /** Key of the last handler that fired — lets repetition guard short-circuit
   *  when the same handler is about to fire again. */
  lastBotIntent?: string;
  /** Vague-answer count in provider flow — escalates to advisor at 2. */
  providerFailedClarifications?: number;
  // ─── Wave 33: letter / benefits / billing triage state machines ───
  letterIssueType?:
    | 'plan_notice' | 'medicare_notice' | 'social_security_notice'
    | 'medicaid_notice' | 'renewal' | 'redetermination' | 'cancellation'
    | 'termination' | 'disenrollment' | 'premium_bill'
    | 'late_enrollment_penalty' | 'lis_extra_help' | 'msp' | 'epic'
    | 'unknown' | 'wants_advisor';
  letterSender?: 'plan' | 'medicare' | 'medicaid' | 'social_security' | 'unknown';
  benefitsIssueType?:
    | 'dental' | 'vision' | 'hearing' | 'otc_card' | 'flex_card'
    | 'food_card' | 'transportation' | 'home_care' | 'medical_bill'
    | 'hospital_bill' | 'specialist_bill' | 'evidence_of_coverage'
    | 'annual_notice_of_change' | 'unknown' | 'wants_advisor';
  billingIssueType?:
    | 'premium_bill' | 'copay' | 'coinsurance' | 'deductible'
    | 'hospital_bill' | 'specialist_bill' | 'pharmacy_bill'
    | 'ambulance_bill' | 'late_penalty' | 'unknown' | 'wants_advisor';
  // ─── Wave 34: conversation intelligence layer ───
  /** True iff the user has produced a recognizable Medicare topic anywhere
   *  in this session. Profanity / nonsense alone does NOT set this. */
  hasRealIssue?: boolean;
  /** Confidence the user actually has a Medicare service issue. */
  issueConfidence?: 'none' | 'low' | 'medium' | 'high';
  /** 3-tier recovery counter — increments each turn we're in recovery so the
   *  bot picks a *different* response every time and stops looping. */
  recoveryStage?: number;
  /** Tracks profanity-with-no-issue specifically (different from frustration
   *  with a known issue). */
  profanityNoIssueCount?: number;
  /** Tracks unclassified / nonsense messages specifically. */
  nonsenseCount?: number;
  /** True once the bot has actually handed the user off to an advisor flow
   *  (e.g. the user typed "sí" after the stage-3 advisor offer). */
  advisorHandoffStarted?: boolean;
  // ─── Wave 47: lead qualification (not a charity bot) ───
  /** Has the user told us they are already a ClearPoint client?
   *    true  → route to "your advisor will call back"
   *    false → discovery + plan-options push
   *    undefined → not asked yet */
  isExistingClient?: boolean;
  /** Has the bot already asked the existing-client gate this session? */
  existingClientAsked?: boolean;
  /** Has the bot already made the plan-change push this session?
   *  Prevents pushing twice on adjacent turns. */
  planChangePushMade?: boolean;
  /** Fraud signals raised about declared name / phone / email at handoff. */
  contactFraudFlags?: string[];
  /** Rotation index for appeal fallback variants (0..2). */
  appealFallbackVariant?: number;
  // ─── Wave 36: human conversation layer ───
  /** Per-phrase-key index of variants the bot has already used this session.
   *  selectPhrase() picks an UNUSED variant; once all used, resets and rotates. */
  usedPhraseIndexes?: Record<string, number[]>;
  /** Plain-language conversation summary in user's own words (last 5 facts). */
  conversationSummary?: string[];
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
  // WAVE 44 — bare 4-7 digit number is ONLY treated as an amount if there is
  // an explicit money/billing/charge keyword nearby. Without this guard, a
  // ZIP code like "07407" leaks in as a $7,407 bill (the exact bug Sawil
  // hit on the live preview). Required nearby keywords:
  //   EN: bill, charge, charged, paid, owe, premium, copay, deductible, fee,
  //       cost, total, balance, due
  //   ES: factura, cobro, cobraron, cobró, pague, debo, prima, copago,
  //       deducible, cuanto, costo, total, saldo, adeudo
  const hasMoneyContext = /\b(bill|charge[ds]?|paid|owe|premium|copay|deductible|fee|cost|total|balance|due|amount|factura|cobro|cobraron|cobr[oó]|pagu[eé]|debo|prima|copago|deducible|cu[aá]nto|costo|saldo|adeudo)\b/i.test(cleaned);
  if (hasMoneyContext) {
    const bareMatch = cleaned.match(/\b(\d{4,7})\b/);
    if (bareMatch) return parseInt(bareMatch[1], 10);
  }
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
  // WAVE 47 — common fake / cartoon / celebrity throwaways used to test
  // whether a chatbot accepts garbage names. The advisor never wastes a
  // call on these. We flag, do not reject silently.
  'mickey', 'minnie', 'donald', 'mickey mouse', 'minnie mouse', 'donald duck',
  'john doe', 'jane doe', 'jhon doe', 'pepito perez', 'juan perez',
  'fulano', 'sutano', 'mengano', 'fulanito', 'menganito',
  'santa', 'santa claus', 'papa noel', 'elvis', 'elvis presley',
  'batman', 'superman', 'spider man', 'spiderman', 'iron man',
  'homer', 'homer simpson', 'bart', 'bart simpson',
  'mario', 'luigi', 'mario bros',
  'jose jose', 'juan juan', 'maria maria',
  'anonymous', 'anonimo', 'an�nimo', 'someone', 'alguien', 'persona',
]);

// WAVE 47 — fake email patterns. Same philosophy as phones: flag don't reject.
const FAKE_EMAIL_PATTERNS: RegExp[] = [
  /^(test|prueba|fake|sample|demo|admin|user|asdf|noreply|no-reply)\d*@/i,
  /^[a-z]@[a-z]\.[a-z]+$/i,                 // a@b.co
  /^(.)\1{3,}@/,                            // aaaa@...
  /@(test|example|fake|sample|mailinator|tempmail|guerrillamail|10minutemail)\./i,
  /@yopmail\.|@trashmail\.|@dispostable\./i,
];

export function validateEmail(raw: string): { isValid: boolean; cleaned: string; reason?: string } {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return { isValid: false, cleaned: '', reason: 'empty' };
  // Basic RFC-lite shape check.
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(cleaned)) {
    return { isValid: false, cleaned, reason: 'bad_shape' };
  }
  for (const re of FAKE_EMAIL_PATTERNS) {
    if (re.test(cleaned)) return { isValid: false, cleaned, reason: 'fake_pattern' };
  }
  return { isValid: true, cleaned };
}

export function validateName(raw: string): { isValid: boolean; cleaned: string; reason?: string } {
  const lettersOnly = raw.trim().replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ\s-']/g, '');
  if (!lettersOnly || lettersOnly.length < 2) {
    return { isValid: false, cleaned: '', reason: 'too_short' };
  }
  if (lettersOnly.length > 30) {
    return { isValid: false, cleaned: lettersOnly.slice(0, 30), reason: 'too_long' };
  }
  const lower = lettersOnly.toLowerCase().trim().replace(/\s+/g, ' ');
  if (SUSPICIOUS_NAMES.has(lower)) {
    return { isValid: false, cleaned: lettersOnly, reason: 'suspicious_name' };
  }
  // WAVE 47 — flag when EVERY space-separated word is in the suspicious set
  // (e.g. "test test", "asdf qwerty", "fulano sutano").
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.every((w) => SUSPICIOUS_NAMES.has(w))) {
    return { isValid: false, cleaned: lettersOnly, reason: 'suspicious_all_words' };
  }
  // WAVE 47 — flag when ANY word is a slur / insult ("fuck off" etc.). We
  // keep this list short so we don't reject legitimate surnames.
  const HARD_INSULTS = new Set([
    'fuck', 'shit', 'asshole', 'bitch', 'cunt',
    'pendejo', 'cabron', 'culero', 'puta', 'mierda', 'idiota',
  ]);
  if (words.some((w) => HARD_INSULTS.has(w))) {
    return { isValid: false, cleaned: lettersOnly, reason: 'contains_insult' };
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
  // WAVE 47 — Hollywood "555" patterns. Real 555 numbers do exist (e.g.
  // 555-0311 test, 555-1212 directory), so we only catch the well-known
  // fictional last-four patterns. The full 0100-0199 fictional range is
  // covered by the explicit check below.
  if (/^.{3}555(1234|9999|0000|1212|5555|4321|1111|2222|3333|4444|6666|7777|8888|0100|0199)$/.test(normalized)) {
    return { isValid: false, cleaned: normalized, reason: 'fake_555_hollywood' };
  }
  // NANP reserves 555-0100 through 555-0199 for fictional use.
  if (/^.{3}55501\d\d$/.test(normalized)) {
    return { isValid: false, cleaned: normalized, reason: 'fake_555_fictional' };
  }
  // Area code 555 is not assigned by NANP.
  if (/^555/.test(normalized)) {
    return { isValid: false, cleaned: normalized, reason: 'fake_area_555' };
  }
  // Sequential digits 1234567890, 0123456789.
  if (/^(0123456789|1234567890|9876543210)$/.test(normalized)) {
    return { isValid: false, cleaned: normalized, reason: 'sequential_digits' };
  }
  // 7+ identical digits in a row anywhere.
  if (/(\d)\1{6,}/.test(normalized)) {
    return { isValid: false, cleaned: normalized, reason: 'repeated_digits' };
  }
  return { isValid: true, cleaned: normalized };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 47 — Aggregate fake-contact detector. Used at handoff time to flag the
// lead so the advisor sees the quality score before dialing. Never rejects.
// ─────────────────────────────────────────────────────────────────────────────
export function detectFakeContactSignals(opts: {
  name?: string;
  phone?: string;
  email?: string;
}): string[] {
  const flags: string[] = [];
  if (opts.name) {
    const nv = validateName(opts.name);
    if (!nv.isValid) flags.push(`name_${nv.reason}`);
    // Two-name placeholder ("John Doe", "Jane Doe", etc.) is caught via the
    // SUSPICIOUS_NAMES set when the full lowercase string matches; check the
    // joined form here too.
    const joined = opts.name.trim().toLowerCase();
    if (SUSPICIOUS_NAMES.has(joined)) flags.push('name_suspicious_full');
  }
  if (opts.phone) {
    const pv = validatePhone(opts.phone);
    if (!pv.isValid) flags.push(`phone_${pv.reason}`);
  }
  if (opts.email) {
    const ev = validateEmail(opts.email);
    if (!ev.isValid) flags.push(`email_${ev.reason}`);
  }
  return flags;
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
  // ── WAVE 37 — MULTILINGUAL PROFANITY / INSULT DICTIONARY ──
  // Covers Spanish (Mexican, Caribbean, South American), English, French,
  // Italian, Portuguese. Word-boundary tested. Accent-stripped above so
  // "coño" → "cono", "vaffanculo" → "vaffanculo", etc.
  const severePatterns = [
    // ─── Spanish — general ───
    /\b(maldit[oa]s? madre|tu madre|tu mama|mama (de )?tu)\b/i,
    /\b(mama?\s?(gue|hue)(v|b)?[oa]?s?|mamagu?e?(v|b)[ao]|mamagueb[oa]|mamahueb[oa]|mamabichos?|mamabicha|comemierda|comebichos?|comebolsa)\b/i,
    /\b(hijo (de )?(la )?puta|hijo ?e ?puta|hijueputa|huep[uú]ta|hueputa|hijaperra|hijoperro|hp|hdp|puta madre|puta vida|puta mierda|puta sea|me cago|jodete)\b/i,
    /\bputas?\b/i,
    /\b(idiota|estupid[oa]s?|imbecil|tarad[oa]|tonto del culo|menso|baboso|babosa)\b/i,
    /\b(mierda|mierdas|que mierda|mier|joder|jodete|jodase|jodanse|jodido|jodida)\b/i,
    /\b(cono|carajo|coj?ones|verg[aoz]|verga|cabr[oó]n|cabron|cabrona|cabrones|culero|culera)\b/i,
    /\b(pendej[oa]s?|pendejad[ao]s?|hijoeputa|chingad[ao]s?|chinga (tu|a tu)|chingar|chingate|no mames|no manches|pinche)\b/i,
    /\b(singa(r|ndo|te)?|singa( a)? tu|chinga( a)? tu|comebicho|comelona)\b/i,
    /\b(marica|maricon|gonorrea|malparid[oa]|sapo|gevon|guev[oó]n|huevon)\b/i,
    /\b(boludo|pelotud[oa]|forr[oa]|pajer[oa]|pajeo|sorete|garcado)\b/i,
    /\b(diablo|diablos|al diablo|vete al? (diablo|carajo|coño|infierno|mierda))\b/i,
    /\b(chupame|chupala|chupar|chupada|mama(la|me)|mamalo|gozala|metetelo)\b/i,
    // ─── English ───
    /\b(fuck|fucking|fucked|fucker|mother\s?fucker|motherfucker|mofo|fuck off|fuck you|fuck this|fk|fck)\b/i,
    /\b(shit|shitty|bullshit|dipshit|asshat|piece of shit|holy shit)\b/i,
    /\b(damn|damned|goddamn|god damn|piss off|pissed|pissing)\b/i,
    /\b(asshole|jackass|dumbass|jerk|prick|twat|wank|douche|douchebag)\b/i,
    /\b(bitch|bitches|son of (a )?bitch|sob|bastard|cunt)\b/i,
    /\b(retard|retarded|idiot|moron|imbecile|stupid)\b/i,
    // ─── French ───
    /\b(putain|merde|connard|conne|salope|enculer?|encule|enculer toi|va te faire foutre|va te faire enculer|fous le camp|ta gueule|ta mere|nique ta mere)\b/i,
    // ─── Italian ───
    /\b(vaffanculo|stronz[oa]|cazz[oa]|merd[ae]|figli[oa] di puttana|cretino|cretina|coglione|coglioni|stupidaggine|pezzo di merda)\b/i,
    // ─── Portuguese ───
    /\b(porra|caralho|foda(-)?se|puta que pariu|vai(-)? ?te? foder|otari[oa]|mongol[oa]|filho da puta|fdp|cuzao|cuzao)\b/i,
    // ─── Catch-all for obvious slur tokens ───
    /\b(mmgvaso|mmgveo|mmgvazo|asco|asqueroso|asquerosa|escoria|basura|pinga)\b/i,
  ];
  if (severePatterns.some((re) => re.test(lower))) return { detected: true, severity: 'severe' };
  // WAVE 40 — soft frustration without profanity.
  if (/\b(rid[ií]culo|ridiculous|esto es absurdo|absurd|no me sirve|you are useless|you'?re useless|this is useless|esto no sirve|esto no funciona|este chat no sirve|waste of time|p[eé]rdida de tiempo)\b/i.test(lower)) {
    return { detected: true, severity: 'severe' };
  }
  // Mild — frustration markers without profanity.
  const mild =
    /(no entiende[ns]?|no me entiende[ns]?|no entiendes nada|esto no sirve|no sirve|este chat (es )?(malo|inutil)|in[uú]til|estoy harto|estoy cansado|estoy frustrado|estoy enojado|estoy furioso|me tienes harto|no me ayuda[ns]?|tonto|tonta|est[aá]s perdid[oa]?|esta perdido|you'?re lost|you are lost|sin sentido|no tiene sentido|no te entiendo|you make no sense|makes no sense|why (do|are) you (keep|asking)|por qu[eé] (sigues|repites|me preguntas)|stop asking|deja de preguntar|you do(n['’]| no)t understand|this is stupid|this is useless|this is(n['’]| no)t working|this is dumb|this is broken|i['’]?m frustrated|i am frustrated|i give up|forget it|whatever)/i;
  if (mild.test(lower)) return { detected: true, severity: 'mild' };
  // V20 — soft refusals that signal disengagement. "nooo" / "ya no" / "no quiero"
  // are not insults but still mean the form is failing. Treat as mild.
  const soft = /^(no+|nope|nah|no quiero|ya no|d[eé]jalo|d[eé]jeme|leave me alone)\.?$/i;
  if (soft.test(lower.trim())) return { detected: true, severity: 'mild' };
  return { detected: false, severity: 'mild' };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 39 — SENSITIVE-DATA SCRUB (Sawil V39 spec §F + spec D "unsafe/sensitive
// data attempt"). Fires when the user types something that LOOKS like PHI:
//   · SSN: XXX-XX-XXXX, XXX XX XXXX, or 9 raw digits
//   · Medicare MBI: 4 chars like 1AB2-CD3-EF45 (digit/letter pattern)
//   · Credit card: 13-19 digit run with spaces/dashes
//   · Banking account / routing number: explicit "account number" / "routing
//     number" / "número de cuenta" / "tarjeta bancaria" phrases
// Never logs the raw value. Returns true so the conversation block can
// respond with a polite warning + advisor handoff.
// ─────────────────────────────────────────────────────────────────────────────
export function detectSensitiveDataAttempt(text: string): {
  detected: boolean;
  kind?: 'ssn' | 'mbi' | 'credit_card' | 'banking';
} {
  if (!text) return { detected: false };
  // SSN: 9 digits with optional dashes/spaces (XXX-XX-XXXX format), but
  // NOT a 9-digit ZIP+4 (handled by ZIP step). Require the surrounding
  // phrase to mention SSN-like context OR the strict XXX-XX-XXXX format.
  const ssn1 = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/;
  if (ssn1.test(text)) return { detected: true, kind: 'ssn' };
  if (/\b(ssn|social security|seguro social|n[uú]mero de seguro social)\b.{0,15}\d{3,}/i.test(text)) {
    return { detected: true, kind: 'ssn' };
  }
  // Medicare MBI format: 4 chars alphanumeric where positions 1, 4, 7,
  // 10 are digits; positions 2, 5, 8 are letters (case-insensitive). Allow
  // optional dashes. Example: 1AB2-CD3-EF45.
  const mbi = /\b\d[A-Za-z][A-Za-z\d]\d[-\s]?[A-Za-z]{2}\d[-\s]?[A-Za-z]{2}\d{2}\b/;
  if (mbi.test(text)) return { detected: true, kind: 'mbi' };
  if (/\b(medicare (id|number|mbi)|n[uú]mero de medicare|tarjeta de medicare)\b.{0,20}[\w\d-]+/i.test(text)
      && /\d/.test(text)) {
    return { detected: true, kind: 'mbi' };
  }
  // Credit card: 13-19 digits with spaces / dashes (Visa, MC, Amex, Discover).
  const cc = /\b(?:\d[ -]?){12,18}\d\b/;
  if (cc.test(text)) {
    const onlyDigits = (text.match(/\d/g) || []).length;
    if (onlyDigits >= 13 && onlyDigits <= 19) {
      return { detected: true, kind: 'credit_card' };
    }
  }
  // Banking explicit phrases.
  if (/\b(account number|routing number|n[uú]mero de cuenta|n[uú]mero de ruta|bank account|cuenta bancaria|wire transfer|transferencia bancaria)\b/i.test(text)) {
    return { detected: true, kind: 'banking' };
  }
  return { detected: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 34 — NONSENSE / UNCLASSIFIABLE-INPUT DETECTOR
//
// Returns true when the input is unlikely to carry a Medicare service topic
// or any sensible question. Used by the conversation block to route to the
// 3-tier "I need a topic" recovery instead of dumping a generic paragraph.
//
// Rules (cheap, fast, conservative):
//   1. Very short with no recognizable Medicare keyword AND no common
//      English/Spanish acknowledgment word.
//   2. Pure punctuation / symbol soup.
//   3. Random-letter clusters (e.g. "mkvso", "asdf", "qwerty", "zzz").
//   4. Single demonstrative pronouns with no topic ("eso", "aquello").
// Never triggers when the input is profanity (handled by the abuse detector)
// or when it's a real one-word answer the bot is expecting.
// ─────────────────────────────────────────────────────────────────────────────
export function detectNonsense(text: string): boolean {
  const raw = (text || '').trim();
  if (!raw) return true;
  if (raw.length > 25) return false;
  const lower = normalizeText(raw).trim();
  // Pure punctuation / symbol soup.
  if (/^[\W_]+$/u.test(raw)) return true;
  // Has any Medicare topic keyword → NOT nonsense.
  const topicKw = /\b(doctor|doctora|m[eé]dico|pcp|primary|specialist|especialista|provider|proveedor|hospital|cl[ií]nica|medic|drug|farmacia|pharmacy|prescription|receta|pill|pastilla|carta|letter|notice|aviso|bill|factura|cobro|premium|prima|copay|deducti|cover|cobertura|otc|flex|dental|vision|hearing|transport|advisor|asesor|human|persona|representative|representante|medicare|medicaid|social security|seguro social|aep|iep|sep|enrollment|inscripci|appeal|apelaci|grieva|queja|change|cambiar|switch|need|necesito|help|ayuda|problem|problema|issue|inconveniente|n[uú]mero|number|english|espa[ñn]ol|spanish|ingl[eé]s|part|parte|advantage|ventaja|hmo|ppo|mapd|spap|epic|medigap|supplement|suplement|plan|planes|snp|ship|eob|emergencia|emergency|telemedicina|telehealth|insulina|insulin|gimnasio|gym|terapia|therapy|quiropr|chiropract|acupunctur|acupuntura|cobra|tricare|vaccine|vacuna|copay|copago|estafa|scam|fraude|fraud|ridicul|cuidad|caregiver|jubil|retir)\b/i;
  if (topicKw.test(lower)) return false;
  // Single common acknowledgment words → NOT nonsense.
  if (/^(yes|no|ok|okay|s[ií]|claro|gracias|thanks|thank you|hola|hello|hi|hey|bye|adios|adi[oó]s)\.?$/i.test(lower)) {
    return false;
  }
  // Profanity is handled by detectAbuseOrFrustration; do NOT also tag as
  // nonsense here.
  if (/\b(mierda|co[ñn]o|carajo|maldit|p[uú]ta|diablo|joder|pendejo|estupido|est[uú]pido|fuck|shit|damn|asshole|bitch|jerk)\b/i.test(lower)) {
    return false;
  }
  // Single demonstrative pronouns / filler.
  if (/^(eso|aquello|esto|that|this|huh|hmm+|mmm+|uhh?|umm?)\.?$/i.test(lower)) return true;
  // Known keyboard-mash patterns.
  if (/^(asdf+|qwerty+|qwer+|asdfghjkl|zxcv+|jkl+|aoeu+|wasd+)\.?$/i.test(lower)) return true;
  // Short string + no vowels at all → consonant soup ("mkvso", "zzz").
  if (lower.length <= 10 && !/[aeiouáéíóú]/i.test(lower)) return true;
  // Short string + low vowel ratio (< 25 % vowels) → likely gibberish like
  // "asdf" (1/4), "qwerty" (1/6), "bvcxz" (0/5). Real Spanish/English short
  // words have ≥ 25 % vowels.
  if (lower.length <= 12) {
    const letters = lower.replace(/[^a-záéíóúñ]/gi, '');
    if (letters.length < 3) return true;
    const vowels = (letters.match(/[aeiouáéíóú]/gi) || []).length;
    if ((vowels / letters.length) < 0.25) return true;
  }
  return false;
}

/**
 * V20 — strict language switch detector. Only fires on an EXACT, intentional
 * request. "factura" alone does NOT switch a Spanish-locked session to
 * English just because of a single Spanish word in an English text.
 */
export function detectExplicitLanguageSwitch(text: string): 'en' | 'es' | null {
  const t = text.toLowerCase().trim().replace(/[.,!?]+$/, '');
  if (/^(english|in english|switch to english|speak english|h[aá]bla(me|r)? (en )?ingl[eé]s|english please|cambiar a ingl[eé]s|cambiar al ingl[eé]s|i prefer english)$/i.test(t)) return 'en';
  if (/^(espa[ñn]ol|spanish|in spanish|switch to spanish|h[aá]bla(me|r)? (en )?espa[ñn]ol|speak spanish|spanish please|cambiar a espa[ñn]ol|cambiar al espa[ñn]ol|quiero espa[ñn]ol|i prefer spanish)$/i.test(t)) return 'es';
  // Wave 33 — family phrasing (caregiver intake): "mi mamá habla español",
  // "my mom speaks Spanish", "mi esposa habla español", etc.
  // Match anywhere in the message, not just exact.
  if (/\bmi (mam[aá]|mami|pap[aá]|papi|esposa|esposo|abuela|abuelo|hija?|hijo) habla espa[ñn]ol\b/i.test(text)) return 'es';
  if (/\bmy (mom|mama|mami|dad|papa|wife|husband|grandma|grandpa|daughter|son) speaks spanish\b/i.test(text)) return 'es';
  if (/\bmi (mam[aá]|mami|pap[aá]|papi|esposa|esposo|abuela|abuelo|hija?|hijo) (only )?habla(?:[a-z]*) ingl[eé]s\b/i.test(text)) return 'en';
  if (/\bmy (mom|mama|dad|papa|wife|husband|grandma|grandpa|daughter|son) (only )?speaks english\b/i.test(text)) return 'en';
  if (/\bno entiendo ingl[eé]s\b/i.test(text)) return 'es';
  return null;
}

/** V20 — recovery menu + chip labels using Sawil's exact spec wording. */
function getRecoveryResponse(state: ConversationState): {
  response: string;
  chips: string[];
  nextStage: number;
} {
  const isSpanish = state.language === 'es';
  const nextStage = (state.recoveryStage || 0) + 1;
  const hasTopic = !!state.serviceCategory || !!state.hasRealIssue;

  const chipsTopicsEs = ['Medicamentos', 'Doctor', 'Carta', 'Factura', 'Asesor'];
  const chipsTopicsEn = ['Medications', 'Doctor', 'Letter', 'Bill', 'Advisor'];
  const chipsYesStartEs = ['Sí, contactar asesor', 'Empezar de nuevo'];
  const chipsYesStartEn = ['Yes, contact advisor', 'Start over'];
  const chipsYesStartShortEs = ['Sí', 'Empezar'];
  const chipsYesStartShortEn = ['Yes', 'Start'];

  // ── Case B — real topic exists: 3-tier ──
  if (hasTopic) {
    if (nextStage === 1) {
      return {
        response: selectPhrase('recovery_case_b_tier1', state),
        chips: isSpanish
          ? ['Hablar con asesor', 'Una pregunta más', 'Empezar de nuevo']
          : ['Talk to advisor', 'One more question', 'Start over'],
        nextStage,
      };
    }
    if (nextStage === 2) {
      return {
        response: selectPhrase('recovery_case_b_tier2', state),
        chips: isSpanish ? chipsYesStartEs : chipsYesStartEn,
        nextStage,
      };
    }
    return {
      response: selectPhrase('recovery_yes_or_start', state),
      chips: isSpanish ? chipsYesStartShortEs : chipsYesStartShortEn,
      nextStage,
    };
  }

  // ── Case A — NO real topic yet: 4-tier ──
  if (nextStage === 1) {
    return {
      response: selectPhrase('recovery_case_a_tier1', state),
      chips: isSpanish ? chipsTopicsEs : chipsTopicsEn,
      nextStage,
    };
  }
  if (nextStage === 2) {
    return {
      response: selectPhrase('recovery_case_a_tier2', state),
      chips: isSpanish ? chipsTopicsEs : chipsTopicsEn,
      nextStage,
    };
  }
  if (nextStage === 3) {
    return {
      response: selectPhrase('recovery_case_a_tier3', state),
      chips: isSpanish ? chipsYesStartEs : chipsYesStartEn,
      nextStage,
    };
  }
  return {
    response: selectPhrase('recovery_yes_or_start', state),
    chips: isSpanish ? chipsYesStartShortEs : chipsYesStartShortEn,
    nextStage,
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
  // WAVE 48 — exclude "won't/wouldn't/don't/can't let me see" (provider access),
  // which previously hijacked the pause handler.
  if (/\b(won'?t|wouldn'?t|don'?t|cannot|can'?t|will not|do not|did not|didn'?t|no me dejan|no me dejaron|no me permiten)\s+(let me|dejarme|dejar que (yo |me ))/i.test(t)) {
    return false;
  }
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
// WAVE 31 — MEDICATION TRIAGE STATE MACHINE
//
// Customer-service-grade triage for medication issues. Maps short, vague,
// misspelled, and Spanglish answers into 14 typed categories so the bot
// never falls to generic "give me more detail" when the topic is meds.
//
// Categories (per Sawil V31 spec):
//   A. cost_too_high
//   B. not_covered
//   C. pharmacy_rejected
//   D. prior_auth
//   E. step_therapy
//   F. quantity_limit
//   G. refill_too_soon
//   H. pharmacy_oos (out of service / out of network)
//   I. not_on_formulary
//   J. new_after_plan_change
//   K. doctor_prescribed_not_covered
//   L. letter_received
//   M. unknown
//   N. wants_advisor
//
// Also returns:
//   · 'ambiguous' — needs disambiguating question (e.g. pharmacy vs price)
//   · 'short_no'  — "no", "nope", "nah" — interpret against last question
//   · 'short_idk' — "I don't know", "no sé"
//   · 'switch_language' — Spanish/English switch request
// ─────────────────────────────────────────────────────────────────────────────

export type MedicationAnswerCategory =
  | 'cost_too_high' | 'not_covered' | 'pharmacy_rejected' | 'prior_auth'
  | 'step_therapy' | 'quantity_limit' | 'refill_too_soon' | 'pharmacy_oos'
  | 'not_on_formulary' | 'new_after_plan_change' | 'doctor_prescribed_not_covered'
  | 'letter_received' | 'wants_advisor' | 'switch_language'
  | 'ambiguous' | 'short_no' | 'short_idk' | 'unknown';

/** Short-answer interpreter for medication flow. Returns the category + a
 *  disambiguation hint when ambiguous. */
export function detectMedicationAnswer(text: string): {
  category: MedicationAnswerCategory;
  hint?: string;
} {
  const normalized = normalizeText(text);
  const t = normalized.trim();
  if (!t) return { category: 'unknown' };
  // Wants advisor
  if (/\b(advisor|asesor|asesora|call me|llameme|ll[aá]meme|llamenme|llamarme|human|persona|representative|representante|agent|agente|live person|real person|talk to (a |an )?person)\b/i.test(normalized)) {
    return { category: 'wants_advisor' };
  }
  // Language switch
  if (/^(espa[ñn]ol|spanish|english|ingl[eé]s)\.?$/i.test(t)
      || /\bno entiendo ingl[eé]s|h[aá]bla(me|r) en espa[ñn]ol|speak spanish|speak english|in spanish|switch to spanish|switch to english\b/i.test(normalized)) {
    return { category: 'switch_language' };
  }
  // Prior auth (most specific first)
  if (/\b(prior auth|prior authorization|preauth|pa required|requires pa|need.{0,15}authorization|autorizaci[oó]n previa|necesita autorizaci[oó]n)\b/i.test(normalized)) {
    return { category: 'prior_auth' };
  }
  // Step therapy
  if (/\b(step therapy|terapia escalonada|step protocol)\b/i.test(normalized)) {
    return { category: 'step_therapy' };
  }
  // Quantity limit
  if (/\b(quantity limit|l[ií]mite de cantidad|too many|max quantity)\b/i.test(normalized)) {
    return { category: 'quantity_limit' };
  }
  // Refill too soon
  if (/\b(refill too soon|refill (denied|early)|muy pronto|too soon|early refill|reabastecer)\b/i.test(normalized)) {
    return { category: 'refill_too_soon' };
  }
  // Not on formulary
  if (/\b(not on formulary|fuera del formulario|no est[aá] en el formulario|formulary exclusion)\b/i.test(normalized)) {
    return { category: 'not_on_formulary' };
  }
  // Pharmacy out of service / out of network
  if (/\b(pharmacy.{0,15}(out of network|oon|not in network)|farmacia (fuera|no est[aá]) (en|de) la red)\b/i.test(normalized)) {
    return { category: 'pharmacy_oos' };
  }
  // New after plan change
  if (/\b(new plan|cambio de plan|nuevo plan|after (i|we) changed plan|despu[eé]s de cambiar)\b/i.test(normalized)) {
    return { category: 'new_after_plan_change' };
  }
  // Doctor prescribed something not covered
  if (/\b(doctor (prescribed|gave me|recetó)|m[eé]dico (recetó|me dio))\b.{0,40}\b(not covered|no cubierto|no la cubr)\b/i.test(normalized)) {
    return { category: 'doctor_prescribed_not_covered' };
  }
  // Letter received
  if (/\b(letter|notice|carta|aviso|plan letter|carta del plan)\b/i.test(normalized) && t.length < 40) {
    return { category: 'letter_received' };
  }
  // Cost too high
  if (/\b(too (expensive|much|high|costly)|expensive|caro|muy caro|costoso|high price|precio alto|cost (was|is) (too |so )?(high|much)|priced too high)\b/i.test(normalized)) {
    return { category: 'cost_too_high' };
  }
  // Pharmacy rejected (short answer "pharmacy" / "the pharmacy" / "farmacia")
  if (/^(the )?(pharmacy|farmacia|drugstore|drug store|la farmacia)\.?$/i.test(t)) {
    return { category: 'pharmacy_rejected' };
  }
  // Note: no trailing \b — accented endings ("rechazó", "negó") fail the
  // ASCII word-boundary check after `ó`. Anchor only the leading boundary.
  if (/\b(pharmacy (rejected|denied|wouldn'?t|won'?t|said no|said it was)|farmacia (lo )?rechaz[oó]|farmacia (me )?neg[oó]|the pharmacy (rejected|said no|denied))/i.test(normalized)) {
    return { category: 'pharmacy_rejected' };
  }
  // Not covered (explicit) — V29 also catches this earlier
  if (/\b(not covered|won'?t cover|do not cover|don'?t cover|denied|deny|rejected|denegaron|negaron|no la? cubr|no cubren|no cubre|no quier(en|o) cubrir)\b/i.test(normalized)) {
    return { category: 'not_covered' };
  }
  // Ambiguous "won't pay" / "don't want to pay" — could be not_covered OR
  // pharmacy_rejected OR cost_too_high. Sawil's exact failing phrase.
  if (/\b(won'?t pay|will not pay|don'?t (want to )?pay|do not (want to )?pay|wouldn'?t pay|no quier(en|o) pagar|no pagan|no me lo pagan|no pago|no.{0,15} pagar)\b/i.test(normalized)) {
    return { category: 'ambiguous', hint: 'cover_or_price' };
  }
  // Short "no" / "nope" / "nah"
  if (/^(no|nope|nah|n[oó])\.?$/i.test(t)) {
    return { category: 'short_no' };
  }
  // Short "I don't know"
  if (/^(no s[eé]|no estoy seguro|i don'?t know|idk|not sure|i'?m not sure|dunno)\.?$/i.test(t)) {
    return { category: 'short_idk' };
  }
  return { category: 'unknown' };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 32 — PROVIDER TRIAGE SHORT-ANSWER INTERPRETER
//
// Maps short / vague / Spanglish provider answers into typed categories so
// the bot can triage doctor/provider issues like a trained intake rep.
//
// Categories:
//   · primary_doctor_not_accepting
//   · specialist_not_accepting
//   · provider_verify_network  (user is trying to verify before going)
//   · office_said_no  (user already heard "no" from office)
//   · appointment_issue
//   · referral_issue
//   · hospital_network
//   · wants_advisor
//   · switch_language
//   · short_no / short_idk / unknown
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderAnswerCategory =
  | 'primary_doctor_not_accepting' | 'specialist_not_accepting'
  | 'provider_verify_network' | 'office_said_no'
  | 'appointment_issue' | 'referral_issue' | 'hospital_network'
  | 'wants_advisor' | 'switch_language'
  | 'short_no' | 'short_idk' | 'unknown';

export function detectProviderAnswer(text: string): { category: ProviderAnswerCategory } {
  const normalized = normalizeText(text);
  const t = normalized.trim();
  if (!t) return { category: 'unknown' };
  // Wants advisor
  if (/\b(advisor|asesor|asesora|call me|llameme|ll[aá]meme|llamenme|llamarme|human|persona|representative|representante|agent|agente|live person|real person|talk to (a |an )?person)\b/i.test(normalized)) {
    return { category: 'wants_advisor' };
  }
  // Language switch
  if (/^(espa[ñn]ol|spanish|english|ingl[eé]s)\.?$/i.test(t)
      || /\bno entiendo ingl[eé]s|h[aá]bla(me|r) en espa[ñn]ol|speak spanish|speak english|in spanish|switch to spanish|switch to english|my (mom|mama|mami) (speaks|habla)\b/i.test(normalized)) {
    return { category: 'switch_language' };
  }
  // Primary doctor signals
  if (/\b(primario|primaria|primary|primary care|primary doctor|m[eé]dico primario|doctor primario|family doctor|m[eé]dico de familia|pcp)\b/i.test(normalized)) {
    return { category: 'primary_doctor_not_accepting' };
  }
  // Specialist signals
  if (/\b(specialist|especialista|cardiolog|dermatolog|oncolog|cardi[oó]log|oftalmolog|gastroenterolog|endocrinolog|neurolog|reumatolog|nefrolog|urolog|psiquiatr|psychiatr|gineco|obstetr|podiatr)\b/i.test(normalized)) {
    return { category: 'specialist_not_accepting' };
  }
  // Hospital
  if (/\b(hospital|cl[ií]nica|emergency room|sala de emergencias|er\b)\b/i.test(normalized)) {
    return { category: 'hospital_network' };
  }
  // Office already said no
  if (/\b(office (told|said|let me know)|me dijo la oficina|me dijeron en la oficina|la oficina (me )?(dijo|dijeron)|the office (told|said)|llam[eé] a la oficina|i called the office)\b/i.test(normalized)) {
    return { category: 'office_said_no' };
  }
  // Trying to verify before going
  if (/\b(verify|verificar|checking|estoy verificando|antes de ir|before (i go|going|i visit)|trying to (check|verify|confirm)|quiero saber si|want to know if|cubierto|in network|en la red)\b/i.test(normalized)) {
    return { category: 'provider_verify_network' };
  }
  // Appointment issue
  if (/\b(appointment|cita|cita m[eé]dica|cancelaron|canceled|cancelled|rescheduled|reagendaron|no me dieron cita|couldn'?t get an appointment)\b/i.test(normalized)) {
    return { category: 'appointment_issue' };
  }
  // Referral issue
  if (/\b(referral|referido|autorizaci[oó]n del doctor|necesito referido|referral request)\b/i.test(normalized)) {
    return { category: 'referral_issue' };
  }
  // Short "no"
  if (/^(no|nope|nah|n[oó])\.?$/i.test(t)) {
    return { category: 'short_no' };
  }
  // Short "I don't know"
  if (/^(no s[eé]|no estoy seguro|no estoy segura|i don'?t know|idk|not sure|i'?m not sure|dunno)\.?$/i.test(t)) {
    return { category: 'short_idk' };
  }
  return { category: 'unknown' };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 33 — LETTER / BENEFITS / BILLING TRIAGE SHORT-ANSWER INTERPRETERS
// ─────────────────────────────────────────────────────────────────────────────

export type LetterAnswerCategory =
  | 'plan' | 'medicare' | 'medicaid' | 'social_security'
  | 'renewal' | 'cancellation' | 'termination' | 'premium_bill'
  | 'late_penalty' | 'extra_help' | 'msp' | 'coverage_change'
  | 'wants_advisor' | 'switch_language' | 'short_idk' | 'unknown';

export function detectLetterAnswer(text: string): { category: LetterAnswerCategory } {
  const normalized = normalizeText(text);
  const t = normalized.trim();
  if (!t) return { category: 'unknown' };
  if (/\b(advisor|asesor|asesora|call me|llameme|ll[aá]meme|human|persona|representative|agent|agente)\b/i.test(normalized)) return { category: 'wants_advisor' };
  if (/^(espa[ñn]ol|spanish|english|ingl[eé]s)\.?$/i.test(t)
      || /\bno entiendo ingl[eé]s|h[aá]bla(me|r) en espa[ñn]ol|mi (mom|mama|mami|esposa|papa|papi) (speaks|habla)\b/i.test(normalized)) return { category: 'switch_language' };
  if (/^(no s[eé]|no estoy seguro|i don'?t know|idk|not sure|dunno)\.?$/i.test(t)) return { category: 'short_idk' };
  // Sender
  if (/\b(seguro social|social security|ssa)\b/i.test(normalized)) return { category: 'social_security' };
  if (/\b(medicaid|medicad)\b/i.test(normalized)) return { category: 'medicaid' };
  if (/\b(medicare)\b/i.test(normalized) && !/\bmi plan\b/i.test(normalized)) return { category: 'medicare' };
  if (/\b(plan|mi plan|my plan|carrier|aseguradora|insurance company)\b/i.test(normalized)) return { category: 'plan' };
  // Type
  if (/\b(renovaci[oó]n|renewal|renew)\b/i.test(normalized)) return { category: 'renewal' };
  if (/\b(cancelaci[oó]n|cancellation|cancel|cancelar)\b/i.test(normalized)) return { category: 'cancellation' };
  if (/\b(terminaci[oó]n|termination|terminate|terminar|disenroll|desafiliaci[oó]n)\b/i.test(normalized)) return { category: 'termination' };
  if (/\b(premium|prima|monthly bill|pago mensual|premium bill)\b/i.test(normalized)) return { category: 'premium_bill' };
  if (/\b(penalty|penalidad|late enrollment)\b/i.test(normalized)) return { category: 'late_penalty' };
  if (/\b(extra help|ayuda extra|lis|low income subsidy)\b/i.test(normalized)) return { category: 'extra_help' };
  if (/\b(msp|medicare savings program|programa de ahorros)\b/i.test(normalized)) return { category: 'msp' };
  if (/\b(coverage change|cambio de cobertura|anoc|eoc|annual notice|cambios anuales)\b/i.test(normalized)) return { category: 'coverage_change' };
  return { category: 'unknown' };
}

export type BenefitsAnswerCategory =
  | 'dental' | 'vision' | 'hearing' | 'otc_card' | 'flex_card'
  | 'food_card' | 'transportation' | 'home_care' | 'bill'
  | 'wants_advisor' | 'switch_language' | 'short_idk' | 'unknown';

export function detectBenefitsAnswer(text: string): { category: BenefitsAnswerCategory } {
  const normalized = normalizeText(text);
  const t = normalized.trim();
  if (!t) return { category: 'unknown' };
  if (/\b(advisor|asesor|asesora|call me|llameme|ll[aá]meme|human|persona|representative|agent|agente)\b/i.test(normalized)) return { category: 'wants_advisor' };
  if (/^(espa[ñn]ol|spanish|english|ingl[eé]s)\.?$/i.test(t)
      || /\bno entiendo ingl[eé]s|h[aá]bla(me|r) en espa[ñn]ol|mi (mom|mama|mami|esposa|papa|papi) (speaks|habla)\b/i.test(normalized)) return { category: 'switch_language' };
  if (/^(no s[eé]|no estoy seguro|i don'?t know|idk|not sure|dunno)\.?$/i.test(t)) return { category: 'short_idk' };
  if (/\b(dental|dentist|dientes|dentadura|root canal|implants?|crown|filling)\b/i.test(normalized)) return { category: 'dental' };
  if (/\b(vision|ojos?|eye|glasses|gafas|lentes|contactos?)\b/i.test(normalized)) return { category: 'vision' };
  if (/\b(hearing|odo|o[ií]do|audifono|aud[ií]fono|audiology)\b/i.test(normalized)) return { category: 'hearing' };
  if (/\b(otc|over the counter|over-the-counter|tarjeta otc)\b/i.test(normalized)) return { category: 'otc_card' };
  if (/\b(flex card|tarjeta flex|healthy allowance)\b/i.test(normalized)) return { category: 'flex_card' };
  if (/\b(food card|grocery card|tarjeta de comida|tarjeta de alimentos)\b/i.test(normalized)) return { category: 'food_card' };
  if (/\b(transport(ation)?|transporte|ride to|llevar al|llevarme)\b/i.test(normalized)) return { category: 'transportation' };
  if (/\b(home care|cuidado en casa|cuidado en el hogar|home health)\b/i.test(normalized)) return { category: 'home_care' };
  if (/\b(bill|factura|cobro|invoice)\b/i.test(normalized)) return { category: 'bill' };
  return { category: 'unknown' };
}

export type BillingAnswerCategory =
  | 'plan' | 'pharmacy' | 'doctor' | 'hospital' | 'medicare_ssa'
  | 'premium' | 'copay' | 'coinsurance' | 'deductible'
  | 'wants_advisor' | 'switch_language' | 'short_idk' | 'unknown';

export function detectBillingAnswer(text: string): { category: BillingAnswerCategory } {
  const normalized = normalizeText(text);
  const t = normalized.trim();
  if (!t) return { category: 'unknown' };
  if (/\b(advisor|asesor|asesora|call me|llameme|ll[aá]meme|human|persona|representative|agent|agente)\b/i.test(normalized)) return { category: 'wants_advisor' };
  if (/^(espa[ñn]ol|spanish|english|ingl[eé]s)\.?$/i.test(t)
      || /\bno entiendo ingl[eé]s|h[aá]bla(me|r) en espa[ñn]ol|mi (mom|mama|mami|esposa|papa|papi) (speaks|habla)\b/i.test(normalized)) return { category: 'switch_language' };
  if (/^(no s[eé]|no estoy seguro|i don'?t know|idk|not sure|dunno)\.?$/i.test(t)) return { category: 'short_idk' };
  if (/\b(pharmacy|farmacia|drug ?store)\b/i.test(normalized)) return { category: 'pharmacy' };
  if (/\b(hospital|hospitales|cl[ií]nica)\b/i.test(normalized)) return { category: 'hospital' };
  if (/\b(doctor|doctora|m[eé]dico|specialist|especialista|pcp|primary)\b/i.test(normalized)) return { category: 'doctor' };
  if (/\b(seguro social|social security|ssa|medicare)\b/i.test(normalized)) return { category: 'medicare_ssa' };
  if (/\b(premium|prima)\b/i.test(normalized)) return { category: 'premium' };
  if (/\b(copay|copago)\b/i.test(normalized)) return { category: 'copay' };
  if (/\b(coinsurance|coseguro)\b/i.test(normalized)) return { category: 'coinsurance' };
  if (/\b(deductible|deducible)\b/i.test(normalized)) return { category: 'deductible' };
  if (/\b(plan|mi plan|my plan|carrier|aseguradora)\b/i.test(normalized)) return { category: 'plan' };
  return { category: 'unknown' };
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 33 — LEAD NOTES BUILDER
//
// Structured advisor handoff summary. Returned to CustomerServiceBot.tsx for
// inclusion in the GHL lead payload's lead_notes field — does NOT modify the
// GHL submission contract, only adds richer context inside the existing field.
// ─────────────────────────────────────────────────────────────────────────────

export function buildLeadNotes(state: ConversationState): string {
  const lines: string[] = [];
  const isEs = state.language === 'es';
  lines.push(`Language: ${isEs ? 'Spanish' : 'English'}`);
  if (state.zipCode) lines.push(`ZIP: ${state.zipCode}${state.state ? ' (' + state.state + ')' : ''}`);
  const topic = state.serviceCategory || state.intent || 'unknown';
  lines.push(`Topic: ${topic}`);
  const subtype =
    state.providerIssueType
    || state.medicationIssueType
    || state.letterIssueType
    || state.benefitsIssueType
    || state.billingIssueType
    || state.subIssue
    || '';
  if (subtype) lines.push(`Subtopic: ${subtype}`);
  // User's own words — last 3 non-trivial user messages
  const userWords = (state.messages || [])
    .filter((m) => m.role === 'user' && m.content && m.content.trim().length > 1)
    .slice(-3)
    .map((m) => `"${m.content.replace(/\s+/g, ' ').slice(0, 120)}"`);
  if (userWords.length) lines.push(`User's own words: ${userWords.join(' | ')}`);
  // Known / unverified facts
  const known: string[] = [];
  if (state.billSource) known.push(`bill source = ${state.billSource}`);
  if (state.amountMentioned) known.push(`amount = ${state.amountMentioned}`);
  if (state.doesNotWantPlanChange) known.push('user does NOT want to change plans');
  if (state.wantsToKeepDoctor) known.push('user wants to keep their doctor');
  if (state.wantsToKeepSpecialist) known.push('user wants to keep their specialist');
  if (known.length) lines.push(`Known facts: ${known.join('; ')}.`);
  lines.push('Not verified: provider network, plan benefits, drug coverage, eligibility, costs — none of these were confirmed by the bot.');
  if ((state.askedQuestions || []).length) {
    lines.push(`Questions asked: ${state.askedQuestions!.join(', ')}`);
  }
  if ((state.repeatedUserMessageCount || 0) >= 1) {
    lines.push(`Repetition indicator: user repeated themselves ${state.repeatedUserMessageCount}x.`);
  }
  if (state.advisorHandoffReason) {
    lines.push(`Recommended advisor action: ${state.advisorHandoffReason} — call user, identify plan, verify with carrier/provider/pharmacy as relevant.`);
  } else {
    lines.push('Recommended advisor action: Call user to clarify and verify the issue with the relevant carrier/provider.');
  }
  lines.push('Compliance note: Bot did not confirm coverage, network, costs, or eligibility, and did not request Medicare ID, SSN, banking information, diagnosis, or medical records.');
  return lines.join('\n');
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

/**
 * V30 — detects topic-LESS vague reports: "tengo problemas", "I have problems",
 * "necesito ayuda", "ayuda". Returns true so the bot can ask a general
 * clarification (NOT broad chips, just one human question).
 */
export function detectGeneralVague(text: string): boolean {
  const normalized = normalizeText(text);
  const t = normalized.trim();
  if (t.length === 0 || t.length > 60) return false;
  // Spanish topic-less vague
  if (/^(tengo (un )?problemas?|tengo (una )?duda|necesito ayuda|ayuda|no entiendo|ayudeme|ayud[eé]me|tengo (un )?inconveniente|tengo (una )?pregunta)\.?$/i.test(t)) return true;
  // English topic-less vague
  if (/^(i have (a )?problems?|i have (a )?question|i need help|help|i don'?t understand|i'?m confused|i need assistance)\.?$/i.test(t)) return true;
  return false;
}

/** Returns the general clarification question. */
export function getGeneralClarification(isSpanish: boolean): string {
  return isSpanish
    ? 'Entiendo. ¿El problema es con su doctor, medicina, factura, carta, plan o algo diferente?'
    : 'I understand. Is the problem with a doctor, medicine, bill, letter, plan, or something else?';
}

/** Returns the topic noun + isVague flag for "I have a problem with X" patterns. */
export function detectVagueProblemReport(text: string): { isVague: boolean; topic: VagueTopic | null } {
  // V29 — run shorthand normalization first so "meds"/"doc"/"rx"/"tocver"
  // get expanded BEFORE pattern matching.
  const normalized = normalizeText(text);
  const lower = normalized.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Step 1: detect a broad-problem opener ("tengo problemas con", "I have a
  // problem with", "necesito ayuda con", etc.)
  const broadPattern = /\b(tengo (un )?problemas? con|tengo (una )?duda con|necesito ayuda con|no entiendo|tengo (un )?inconveniente con|mi .{0,15} tiene (un )?problema|mi .{0,15} no funciona|mi .{0,15} no esta funcionando|me lleg[oó]|recib[ií]|i (have|got|am having) (a |an )?problems? with|i need help with|i don'?t understand|i'?m having trouble with|my .{0,15} (has|is having) (a |an )?(problem|problems|issue|issues)|my .{0,15} (isn'?t|is not) working|i got (a |an |my )?|^problems? with (my |the )?|^problemas? con (mi |el |la )?)\b/i;
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
    // WAVE 42 — scam/fraud signals on cards / bills (not a vague request).
    /didn'?t order|no ped[ií]|never ordered|nunca ped[ií]|scam|fraud|fraude|estafa/i,
  ];
  for (const q of specific) {
    if (q.test(lower)) return { isVague: false, topic };
  }
  return { isVague: true, topic };
}

// Wave 33 — human-readable labels for letter sender/type summaries.
function spanishSenderLabel(s: string): string {
  return s === 'medicare' ? 'Medicare'
       : s === 'medicaid' ? 'Medicaid'
       : s === 'social_security' ? 'Seguro Social'
       : s === 'plan' ? 'su plan'
       : 'la fuente';
}
function englishSenderLabel(s: string): string {
  return s === 'medicare' ? 'Medicare'
       : s === 'medicaid' ? 'Medicaid'
       : s === 'social_security' ? 'Social Security'
       : s === 'plan' ? 'your plan'
       : 'the sender';
}
function spanishLetterTypeLabel(t: string): string {
  switch (t) {
    case 'renewal': return 'renovación';
    case 'cancellation': return 'cancelación';
    case 'termination': return 'terminación';
    case 'premium_bill': return 'pago de prima';
    case 'late_enrollment_penalty': return 'penalidad por inscripción tardía';
    case 'lis_extra_help': return 'Extra Help / LIS';
    case 'msp': return 'programa de ahorros de Medicare';
    case 'plan_notice': return 'cambio de cobertura';
    default: return 'la carta';
  }
}
function englishLetterTypeLabel(t: string): string {
  switch (t) {
    case 'renewal': return 'renewal';
    case 'cancellation': return 'cancellation';
    case 'termination': return 'termination';
    case 'premium_bill': return 'a premium bill';
    case 'late_enrollment_penalty': return 'a late enrollment penalty';
    case 'lis_extra_help': return 'Extra Help / LIS';
    case 'msp': return 'Medicare Savings Program';
    case 'plan_notice': return 'a coverage change';
    default: return 'the letter';
  }
}

/** Returns the short office-style clarification question for a vague topic. */
export function getTopicClarification(topic: VagueTopic, isSpanish: boolean): string {
  if (isSpanish) {
    switch (topic) {
      case 'doctor':         return 'Entiendo. ¿Qué pasó con su doctor?';
      case 'specialist':     return 'Entiendo. ¿Qué pasó con su especialista?';
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
    case 'doctor':         return "I understand. What happened with your doctor?";
    case 'specialist':     return "I understand. What happened with your specialist?";
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

/** True if message reports being told to change plan (not user's own intent).
 *  V30 — also detects when a PROVIDER (doctor/specialist/pharmacy/hospital)
 *  is the source. "Mi doctor dice q debo cambiar" → told_to_change. */
export function detectToldToChange(text: string): boolean {
  // Use normalized text so "q" → "que", "dont" → "don't" etc.
  const lower = normalizeText(text);
  // Spanish — "me dijeron que/q debería cambiar" / "me obligan a cambiar"
  if (/\bme dijeron (que |q )?(deber[ií]a|tendr[ií]a|tengo que|debo|tienes que|tiene que)\b.{0,40}\b(cambiar|cambiarme|cambio|mudar)\b/i.test(lower)) return true;
  if (/\bme dijeron .{0,40}\bcambiar\b/i.test(lower)) return true;
  if (/\bme (dicen|han dicho) (que |q )?(deber[ií]a|tengo que|debo)\b.{0,40}\bcambiar\b/i.test(lower)) return true;
  if (/\bme obligar?(on|ían|on)?\b.{0,30}\bcambiar\b/i.test(lower)) return true;
  // V30 — provider-said source: "mi doctor dice/dijo q debo cambiar",
  //   "mi especialista me dijo que cambie", "the pharmacy said I should change".
  if (/\b(mi |el |la |un |una )?\b(doctor|doctora|especialista|m[eé]dico|m[eé]dica|provider|farmacia|hospital|cl[ií]nica|pharmacy|specialist)\b.{0,20}\b(dice|dijo|dijeron|me dijo|told me|said|says|tells me)\b.{0,30}\b(cambiar|cambiarme|cambio|cambie|cambiara|cambien|mudar|change|switch|leave|drop)\b/i.test(lower)) return true;
  if (/\bmi (doctor|doctora|especialista|m[eé]dico) (dice|dijo|me dijo)\b.{0,40}\b(cambiar|cambio|cambie)\b/i.test(lower)) return true;
  // English
  if (/\b(they|someone) (told me|said i should|said i need to|said i have to)\b.{0,30}\b(change|switch|leave|drop|cancel)\b/i.test(lower)) return true;
  if (/\bi was told (to )?(change|switch|leave|drop)\b/i.test(lower)) return true;
  if (/\bmy (doctor|specialist|provider|pharmacy|hospital) (told me|said|says)\b.{0,30}\b(change|switch|leave|drop)\b/i.test(lower)) return true;
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
  // English crisis phrases (Wave 40 — added "i cannot take this anymore",
  // "can't take this", "can't do this anymore", "no point").
  if (/\b(i want to die|i'?ll kill myself|kill myself|end my life|end it all|suicide|suicidal|don'?t want to live|wanna die|going to end it|cannot go on|can'?t go on|can'?t take it anymore|i cannot take this anymore|can'?t take this anymore|can'?t do this anymore|no point in living|nothing to live for|better off dead|thinking about (suicide|ending it))\b/i.test(t)) return true;
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
  // WAVE 39 — banking phrase + a digit run nearby.
  if (/\b(account number|routing number|n[uú]mero de cuenta|n[uú]mero de ruta|bank account|cuenta bancaria|wire transfer|transferencia bancaria|routing|debit card number|n[uú]mero de tarjeta)\b/i.test(text)
      && /\d{4,}/.test(text)) {
    return true;
  }
  // WAVE 39 — explicit "my SSN is X" / "mi seguro social es X" with any digits.
  if (/\b(my (ssn|social security)|mi (n[uú]mero de )?seguro social|my medicare (id|number|mbi)|mi (n[uú]mero de )?medicare)\b.{0,12}[\d]+/i.test(text)) {
    return true;
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
// ─────────────────────────────────────────────────────────────────────────────
// WAVE 36 — HUMAN CONVERSATION LAYER
//
// selectPhrase(key, state) returns one of the variants from PHRASE_BANK for
// the requested key + language, picking an UNUSED variant whenever possible
// so the bot never sends the same sentence twice in a session. When all
// variants are exhausted the rotation resets and starts over (still rotating
// — just from a fresh budget). Mutates state.usedPhraseIndexes in place.
// ─────────────────────────────────────────────────────────────────────────────
export function selectPhrase(key: PhraseKey, state: ConversationState): string {
  const isEs = state.language === 'es';
  const bank = PHRASE_BANK[key];
  const list = isEs ? bank.es : bank.en;
  if (!list || list.length === 0) return '';
  state.usedPhraseIndexes = state.usedPhraseIndexes || {};
  const used = state.usedPhraseIndexes[key] || [];
  // Pick the first index NOT in used.
  let pickIdx = list.findIndex((_, i) => !used.includes(i));
  if (pickIdx === -1) {
    // All used — reset budget but skip the most recent one to avoid an
    // immediate back-to-back duplicate.
    const lastIdx = used.length ? used[used.length - 1] : -1;
    state.usedPhraseIndexes[key] = lastIdx >= 0 ? [lastIdx] : [];
    pickIdx = list.findIndex((_, i) => i !== lastIdx);
    if (pickIdx === -1) pickIdx = 0;
  }
  state.usedPhraseIndexes[key] = [...(state.usedPhraseIndexes[key] || used), pickIdx];
  return list[pickIdx];
}

/** Append a one-line fact to the conversation summary (max 6 lines). */
// ─────────────────────────────────────────────────────────────────────────────
// WAVE 42 — HUMAN CONVERSATION LAYER (reflective echo + emotional openers +
// memory references)
// ─────────────────────────────────────────────────────────────────────────────

const ECHO_NOUN_PATTERNS_ES = [
  { kw: /\bcardi[oó]logo\b/i, label: 'cardiólogo' },
  { kw: /\bdermat[oó]logo\b/i, label: 'dermatólogo' },
  { kw: /\boftalmol|optometr/i, label: 'doctor de ojos' },
  { kw: /\bpodi[aá]tra|pod[oó]logo\b/i, label: 'podólogo' },
  { kw: /\bdentista\b/i, label: 'dentista' },
  { kw: /\bginec[oó]logo|obstetr/i, label: 'ginecólogo' },
  { kw: /\bpsiquiatra\b/i, label: 'psiquiatra' },
  { kw: /\bespecialista\b/i, label: 'especialista' },
  { kw: /\bdoctor primario|m[eé]dico primario\b/i, label: 'doctor primario' },
  { kw: /\bdoctor|doctora|m[eé]dico\b/i, label: 'doctor' },
  { kw: /\bhospital|cl[ií]nica\b/i, label: 'hospital' },
  { kw: /\bfarmacia\b/i, label: 'farmacia' },
  { kw: /\bmedicina|medicamento|receta\b/i, label: 'medicina' },
  { kw: /\bcarta del plan\b/i, label: 'carta del plan' },
  { kw: /\bcarta de medicare\b/i, label: 'carta de Medicare' },
  { kw: /\bcarta\b/i, label: 'carta' },
  { kw: /\bfactura|cobro|bill\b/i, label: 'cobro' },
  { kw: /\btarjeta (otc|flex)\b/i, label: 'tarjeta de beneficios' },
  { kw: /\bdental\b/i, label: 'dental' },
  { kw: /\bvisi[oó]n|ojos|lentes|anteojos\b/i, label: 'visión' },
  { kw: /\bmedicaid\b/i, label: 'Medicaid' },
];
const ECHO_NOUN_PATTERNS_EN = [
  { kw: /\bcardiologist\b/i, label: 'cardiologist' },
  { kw: /\bdermatologist\b/i, label: 'dermatologist' },
  { kw: /\boptometr|eye doctor\b/i, label: 'eye doctor' },
  { kw: /\bpodiatrist\b/i, label: 'podiatrist' },
  { kw: /\bdentist\b/i, label: 'dentist' },
  { kw: /\bgynecologist|obgyn\b/i, label: 'gynecologist' },
  { kw: /\bpsychiatrist\b/i, label: 'psychiatrist' },
  { kw: /\bspecialist\b/i, label: 'specialist' },
  { kw: /\bprimary (doctor|care)|pcp\b/i, label: 'primary doctor' },
  { kw: /\bdoctor\b/i, label: 'doctor' },
  { kw: /\bhospital|clinic\b/i, label: 'hospital' },
  { kw: /\bpharmacy\b/i, label: 'pharmacy' },
  { kw: /\bmedication|medicine|prescription|drug\b/i, label: 'medication' },
  { kw: /\bletter from (the )?plan\b/i, label: 'letter from your plan' },
  { kw: /\bletter from medicare\b/i, label: 'letter from Medicare' },
  { kw: /\bletter\b/i, label: 'letter' },
  { kw: /\bbill\b/i, label: 'bill' },
  { kw: /\b(otc|flex) card\b/i, label: 'benefits card' },
  { kw: /\bdental\b/i, label: 'dental' },
  { kw: /\bvision|eyes|glasses\b/i, label: 'vision' },
  { kw: /\bmedicaid\b/i, label: 'Medicaid' },
];

/** Echo back the user's last message as a recognizable Medicare topic noun.
 *  Returns empty string when nothing safe-to-cite was found. NEVER cites
 *  profanity or PHI (those are detected upstream). */
export function reflectiveEcho(userMessage: string, isSpanish: boolean): string {
  if (!userMessage || userMessage.length > 250) return '';
  const patterns = isSpanish ? ECHO_NOUN_PATTERNS_ES : ECHO_NOUN_PATTERNS_EN;
  for (const p of patterns) {
    if (p.kw.test(userMessage)) {
      return p.label;
    }
  }
  return '';
}

/** Emotional opener for the bot's response, based on detected emotion. */
export function emotionalOpener(emotion: string, isSpanish: boolean, state: ConversationState): string {
  state.usedPhraseIndexes = state.usedPhraseIndexes || {};
  const bank: Record<string, { es: string[]; en: string[] }> = {
    frustrated: {
      es: ['Sé que es frustrante.', 'Le entiendo, esto desespera.', 'Entiendo lo molesto que es esto.', 'Sé que da rabia.'],
      en: ["I know it's frustrating.", "I get it, this is stressful.", "I understand how annoying this is.", "I know this is rough."],
    },
    urgent: {
      es: ['Vamos rápido entonces.', 'OK, esto es urgente.', 'Vamos directo al grano.', 'Entiendo la prisa.'],
      en: ["Let's move fast then.", 'OK, this is urgent.', "Let's get right to it.", "I understand the rush."],
    },
    grieving: {
      es: ['Lo siento mucho.', 'Le acompaño en el sentimiento.', 'Mi más sentido pésame.', 'Lo lamento de verdad.'],
      en: ["I'm so sorry.", "My deepest condolences.", "I'm truly sorry.", "I'm sorry for your loss."],
    },
    confused: {
      es: ['Vamos paso a paso.', 'Sin prisa, vamos despacio.', 'Le explico claramente.', 'Vamos a hacerlo simple.'],
      en: ["Let's go step by step.", "No rush, we'll go slow.", "Let me explain clearly.", "We'll keep it simple."],
    },
    angry: {
      es: ['Lo escucho.', 'Le entiendo, esto cansa.', 'Sé que está molesto.', 'Lo siento que se sienta así.'],
      en: ["I hear you.", "I get it, this wears you down.", "I know you're upset.", "I'm sorry you feel this way."],
    },
    calm: { es: [], en: [] },
    grateful: {
      es: ['Gracias a usted.', 'Es un gusto ayudarle.', 'De nada, para eso estamos.'],
      en: ["Thank you.", "Glad to help.", "You're welcome, that's what we're here for."],
    },
  };
  const list = (bank[emotion] || bank.calm);
  const arr = isSpanish ? list.es : list.en;
  if (!arr || arr.length === 0) return '';
  const key = `emo_${emotion}_${isSpanish ? 'es' : 'en'}`;
  const used = state.usedPhraseIndexes[key] || [];
  let pick = arr.findIndex((_, i) => !used.includes(i));
  if (pick === -1) {
    state.usedPhraseIndexes[key] = [used[used.length - 1] || 0];
    pick = arr.findIndex((_, i) => i !== (used[used.length - 1] || 0));
    if (pick === -1) pick = 0;
  }
  state.usedPhraseIndexes[key] = [...(state.usedPhraseIndexes[key] || used), pick];
  return arr[pick];
}

// WAVE 43 — humanization wrapper. Adds an emotional opener (if emotion >
// calm) AND a reflective echo of the user's last topic noun (if safe to
// quote). Both are deduped via state.usedPhraseIndexes so the bot never
// repeats the same opener twice in a session.
//
// Usage in handlers:
//   const base = isSpanish ? '¿Es su doctor primario o un especialista?'
//                          : 'Is this your primary doctor or a specialist?';
//   const out = composeHumanResponse(newState, userMessage, base);
//
// The wrapper is transparent — if no opener or echo applies, returns base
// unchanged. So existing test regexes still pass while live conversations
// gain warmth and acknowledgment.
export function composeHumanResponse(
  state: ConversationState,
  userMessage: string,
  baseResponse: string,
  options?: { skipEcho?: boolean; skipOpener?: boolean; echoIntro?: string },
): string {
  const isSpanish = state.language === 'es';
  const parts: string[] = [];
  if (!options?.skipOpener) {
    const emotion = state.emotionalState || 'calm';
    const opener = emotionalOpener(emotion, isSpanish, state);
    if (opener) parts.push(opener);
  }
  if (!options?.skipEcho) {
    const echo = reflectiveEcho(userMessage || '', isSpanish);
    if (echo) {
      const intro = options?.echoIntro
        || (isSpanish ? `Sobre lo del ${echo}:` : `About the ${echo}:`);
      parts.push(intro);
    }
  }
  parts.push(baseResponse);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function noteFact(state: ConversationState, fact: string): void {
  state.conversationSummary = state.conversationSummary || [];
  // Dedupe by case-insensitive match.
  const lower = fact.toLowerCase();
  if (state.conversationSummary.some((f) => f.toLowerCase() === lower)) return;
  state.conversationSummary.push(fact);
  if (state.conversationSummary.length > 6) state.conversationSummary.shift();
}

function enterRecoveryMode(
  state: ConversationState,
  reason: 'frustration' | 'zip_loop' | 'name_loop' | 'prompt_loop' | 'nonsense',
): { response: string; newState: ConversationState; needsHuman: boolean } {
  state.recoveryMode = true;
  state.step = 'conversation';
  const rec = getRecoveryResponse(state);
  state.recoveryStage = rec.nextStage;
  state.quickReplies = rec.chips;
  state.lastBotPrompt = rec.response;
  state.lastBotIntent = 'recovery_stage_' + rec.nextStage;
  state.inconsistencies = [...(state.inconsistencies || []), `recovery_${reason}`];
  state.messages.push({ role: 'bot', content: rec.response, timestamp: Date.now() });
  // Stage 3 with no topic → set advisor handoff reason for telemetry; UI only
  // submits when user clicks the advisor chip, so don't force needsHuman=true.
  if (rec.nextStage >= 3 && !state.serviceCategory) {
    state.advisorHandoffReason = state.advisorHandoffReason || 'no_topic_repeated_unclear';
  }
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
// V29 — expanded shorthand: meds/med/rx/doc/dr/pcp/spec/appt/ins/pharm,
// common typos: tocver/covr/coever/coverd, Spanglish.
function normalizeText(text: string): string {
  // First pass: legacy single-token substitutions.
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
    cubertura: 'cobertura',
    doctro: 'doctor',
    dotor: 'doctor',
    doctol: 'doctor',
    farmacai: 'farmacia',
    farmasia: 'farmacia',
    cartta: 'carta',
    leta: 'carta',
    renovcaion: 'renovación',
    medicadi: 'medicaid',
    medicarie: 'medicare',
    medecare: 'medicare',
    medisina: 'medicina',
    medecina: 'medicina',
    medicamiento: 'medicamento',
    especialsta: 'especialista',
    espesialista: 'especialista',
    aseguranza: 'seguro',
    insurence: 'insurance',
    insuranse: 'insurance',
    plam: 'plan',
    pharmcy: 'pharmacy',
    pharmacy: 'pharmacy',
    farmacy: 'pharmacy',
    pharmasy: 'pharmacy',
    problms: 'problems',
    probllems: 'problems',
    probems: 'problems',
    porblems: 'problems',
    problemas: 'problemas',
    problmas: 'problemas',
    pproblema: 'problema',
    aspeta: 'acepta',
    asepta: 'acepta',
    seguruo: 'seguro',
    medicna: 'medicina',
    medecna: 'medicina',
  };
  let normalized = text.toLowerCase();
  for (const [wrong, correct] of Object.entries(corrections)) {
    normalized = normalized.replace(new RegExp(wrong, 'gi'), correct);
  }
  // Second pass: word-boundary aware shorthand replacements.
  // Order matters — replace longer forms first.
  const shorthand: Array<[RegExp, string]> = [
    // V30 — Spanish SMS shorthand: q/k → que, xq/pq → porque, cambir → cambiar
    [/\bq\b/g, 'que'],
    [/\bk\b/g, 'que'],
    [/\bxq\b/g, 'porque'],
    [/\bpq\b/g, 'porque'],
    [/\bcambir\b/g, 'cambiar'],
    [/\bprimary care\b/g, 'primary care'],   // keep
    [/\bover the counter\b/g, 'otc'],
    [/\bover-the-counter\b/g, 'otc'],
    [/\bmeds\b/g, 'medication'],
    [/\bmed\b/g, 'medication'],
    [/\brx\b/g, 'prescription'],
    [/\bdoc\b/g, 'doctor'],
    [/\bdr\.?\b/g, 'doctor'],
    [/\bpcp\b/g, 'primary doctor'],
    [/\bspec\b/g, 'specialist'],
    [/\bappt\b/g, 'appointment'],
    // WAVE 40 — Part A/B/C/D / Pt abbreviations
    [/\bpt\s+([abcd])\b/gi, 'part $1'],
    [/\bpart\s+([abcd])\b/gi, 'part $1'],
    [/\bma\b/g, 'medicare advantage'],
    [/\bmapd\b/g, 'medicare advantage'],
    [/\bappts\b/g, 'appointments'],
    [/\bins\b/g, 'insurance'],
    [/\bpharm\b/g, 'pharmacy'],
    // English typo cluster: "to cover" / "cover" misspellings.
    [/\bwan tocver\b/g, 'want to cover'],
    [/\btocver\b/g, 'to cover'],
    [/\bcovr\b/g, 'cover'],
    [/\bcoever\b/g, 'cover'],
    [/\bcoverd\b/g, 'covered'],
    [/\bcober\b/g, 'cubrir'],         // Spanish "cober" typo for "cubrir"
    [/\bcubrir\b/g, 'cubrir'],
    [/\baceptl?an\b/g, 'aceptan'],
    [/\baceptl?a\b/g, 'acepta'],
    [/\bacept\b/g, 'accept'],
    [/\bbil\b/g, 'bill'],
    [/\bleter\b/g, 'letter'],
    [/\bdont\b/g, "don't"],
    [/\bdoesnt\b/g, "doesn't"],
    [/\bwont\b/g, "won't"],
    [/\bisnt\b/g, "isn't"],
    [/\bcant\b/g, "can't"],
    [/\bwan\b/g, 'want'],
  ];
  for (const [re, replacement] of shorthand) {
    normalized = normalized.replace(re, replacement);
  }
  return normalized;
}

import { classifyIntent as _classifyIntent } from './classifier/classifyIntent';

export function detectProblemType(text: string): string {
  // WAVE 50 — try the new scored classifier first. Engine uses confident
  // results to short-circuit the legacy regex roulette below. Falls back
  // to legacy if the classifier is unclear or ambiguous.
  // Take over from legacy whenever the scored classifier is confident.
  // "Trusted" intents are ones I've covered with explicit handlers (or that
  // legacy code routes correctly already). The classifier becomes the
  // tie-breaker — when score >= 0.7 we use it, otherwise legacy regex chain
  // runs (proven against 1,183 regression tests).
  //
  // For savings_program we tolerate "ambiguous" (cost-of-premium has valid
  // bill / savings interpretations both leading to the same advisor pivot).
  const TRUSTED = new Set([
    'savings_program', 'plan_recommendation', 'appeal', 'coverage',
    'doctor_provider_network', 'doctor_change_request',
    'drug', 'urgent_medication',
    'fraud_scam', 'medical_emergency_911',
    'enrollment', 'medicare_advantage',
    'moving_state_sep', 'er_hospital_visit', 'telehealth',
    'about_clearpoint', 'family_referral', 'returning_customer',
    'eob_explanation', 'spap',
  ]);
  try {
    const r = _classifyIntent(text);
    if (r && r.intent && !r.isUnclear && r.score >= 0.7) {
      // Always trust savings/plan_recommendation even when ambiguous.
      if (r.intent === 'savings_program' || r.intent === 'plan_recommendation') {
        return r.intent;
      }
      // For other trusted intents, require non-ambiguous.
      if (!r.isAmbiguous && TRUSTED.has(r.intent)) {
        return r.intent;
      }
    }
  } catch { /* fall through to legacy */ }
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
  // WAVE 32 — PROVIDER ACCESS: "doctor does not accept me" / "no quiere aceptarme".
  // CRITICAL: these MUST beat the generic coverage fallback below. The phrase
  // "mi doctor no quiere aceptarme" is a provider-access issue, not coverage
  // education. Sawil's exact failing case. Covers:
  //   ES: no quiere aceptarme / no me acepta / no me quiere aceptar /
  //       no acepta mi plan / no acepta mi seguro / no coge mi plan /
  //       no toma mi seguro / no recibe mi seguro / no recibe mi plan /
  //       no me quieren ver / no puedo ir / no atiende / no me atienden
  //   EN: doesn't accept me / won't accept me / doesn't take my insurance /
  //       won't take my plan / won't see me / refuses me
  if (/\b(no (me )?(quiere|quieren)\s+(aceptar|recibir|ver|atender)(me)?|no me (acepta|aceptan|recibe|reciben|ven|atiende|atienden)|no (acepta|aceptan|recibe|reciben|coge|cogen|toma|toman)\s+(mi|el)\s+(plan|seguro|aseguranza|medicare))\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\b((doesn'?t|does not|won'?t|will not|wouldn'?t|would not|refuses to|refused to)\s+(accept|take|see|treat)\s+(me|my (insurance|plan|medicare)))\b/i.test(normalized)) return 'doctor_provider_network';
  // WAVE 38 — Spanglish: "my doctor no me wants to ver" / "my doctor no me acepta"
  if (/\b(my )?(doctor|doctora|m[eé]dico|specialist|especialista)\b.{0,25}\b(no me|no quiere|no acepta|no toma)\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\bno me\b.{0,15}\b(wants?|want)\s+to\s+(ver|see|aceptar|accept)\b/i.test(normalized)) return 'doctor_provider_network';
  if (/\b(office (told|said|let me know)|me dijo (en )?la oficina|me dijeron en la oficina)\b.{0,40}\b(not accept|no acepta|don'?t accept|won'?t take|no toman|no cogen)\b/i.test(normalized)) return 'doctor_provider_network';
  // Provider-access keywords standalone with provider context.
  if (/\b(referral|referido|autorizaci[oó]n del doctor|prior auth from (the )?doctor)\b/i.test(normalized)
      && /\b(doctor|doctora|m[eé]dico|provider|proveedor|especialista|specialist|pcp|primary|hospital)\b/i.test(normalized)) {
    return 'doctor_provider_network';
  }
  if (/\b(appointment|cita|cita m[eé]dica|cita con (el|mi) (doctor|especialista|m[eé]dico))\b/i.test(normalized)
      && /\b(problem|problema|cant|can'?t|no puedo|cancel|cancelar|reagendar|reschedul)\b/i.test(normalized)) {
    return 'doctor_provider_network';
  }
  // V25 — new categories. Order: more specific first.
  if (/\b(perd[ií] mi tarjeta|lost my (plan |member |id )?card|reemplazo de tarjeta|replacement card|no me lleg[oó] (mi )?tarjeta|tarjeta no (lleg|rec)|member id card|plan card|new card)\b/i.test(normalized)) return 'id_card';
  if (/\b(otc|over[- ]the[- ]counter|flex card|healthy allowance|grocery card|tarjeta de beneficios|tarjeta flex)\b/i.test(normalized)) return 'otc';
  if (/\b(transport(ation)?|ride to (the )?doctor|rides? to (the )?(doctor|appointment)|transporte|llevar(me)? al doctor|llevar(me)? a la cita)\b/i.test(normalized)) return 'transportation';
  if (/\b(dental|dentista|dentist|teeth|dientes|dentadura|dentaduras|cleaning|limpieza dental|root canal|canal radicular|implants?|implantes? dentales)\b/i.test(normalized)) return 'dental';
  if (/\b(vision|ojos?|eye exam|eye doctor|optometr|oftalmolog|glasses|gafas|lentes|contactos?|contact lenses|examen de (la )?vista|examen visual|chequeo visual|prueba de (la )?vista)\b/i.test(normalized)) return 'vision';
  // WAVE 42 — accessibility need (vision/hearing impairment / pace) must fire
  // BEFORE the generic `hearing` benefit intent so "I'm hard of hearing"
  // (a disability statement) is not mis-routed as a hearing-aid question.
  if (/\b(can'?t see (well|good)|no veo bien|hard of hearing|no oigo bien|sordo|deaf|blind|ciego|low vision|baja visi[oó]n|slow down|m[aá]s despacio|speak slowly|hablar m[aá]s lento|repeat (that|please)|repit[ae]( por favor)?|say it again|d[ií]galo otra vez|simpler|m[aá]s f[aá]cil|easier words|explain (it )?simpler|explique m[aá]s f[aá]cil)\b/i.test(normalized)) return 'accessibility_need';
  if (/\b(hearing( aid)?|odo|o[ií]do|hearing aid|audifono|aud[ií]fono|audifonos|aud[ií]fonos|audiology|audiolog[ií]a|necesito audifonos|necesito aud[ií]fonos)\b/i.test(normalized)) return 'hearing';
  // ─── WAVE 42 — HIGH-PRIORITY SPECIFIC EVENTS (must beat the catch-all
  // bill/drug/coverage/enrollment/new_to_medicare/irmaa patterns below).
  // Accent-stripped check handles ó/o parity.
  const _accentless1 = normalized.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\b(what (is|does) (an? )?eob|que es (un )?eob|explain (the |an? )?eob|expli(que|car)( la|un)? eob|explicacion de beneficios|explanation of benefits)\b/i.test(_accentless1)) return 'eob_explanation';
  if (/\b((my |mi )?premium (went up|increased|increase|aumento|subio)|(mi |my )?prima (subio|aumento)|why is (my )?premium higher|why did my premium (go up|increase)|por que subio (mi )?(prima|premium))\b/i.test(_accentless1)) return 'premium_increase';
  if (/\b(disenroll|cancelar mi plan|darme de baja|drop my plan|leave (my )?plan|salirme del plan)\b/i.test(_accentless1) && !/carta|letter/i.test(normalized)) return 'disenroll_request';
  if (/\b(still working at 65|todavia trabajo y? ?(cumplo )?65|todavia trabajo|employer (coverage|insurance|plan)|cobertura del empleador|cobra coverage|cobra (after|y) medicare|va benefits|veteran (affairs|administration)|tricare|i was on cobra)\b/i.test(_accentless1)) return 'employer_va_cobra';
  if (/\b(generic|generico|brand name|de marca|generic vs brand|tier (1|2|3|4|5)|drug tier|nivel (1|2|3|4|5)|nivel \d? ?de medicamento|nivel de medicamento)\b/i.test(_accentless1)) return 'drug_tier';
  if (/\b(mail[- ]?order( pharmacy)?|farmacia por correo|switch pharmac(y|ies)|cambiar (de )?farmacia|preferred pharmacy|farmacia preferida)\b/i.test(_accentless1)) return 'pharmacy_logistics';
  if (/\b(insulin( cap| cost| 35| copay)?|insulina( cap| costo| 35| copago)?|\$35 insulin|insulina (de )?\$35)\b/i.test(_accentless1)) return 'insulin_cap';
  if (/\b(shingrix|culebrilla|vacuna|vaccine|pneumonia (shot|vaccine)|neumonia|flu shot|vacuna de la gripe|covid (shot|vaccine|booster))\b/i.test(_accentless1)) return 'vaccine_question';
  if (/\b(find (me )?a (new )?doctor|buscar (un )?doctor|quiero (un )?(nuevo |otro )?doctor( nuevo| otro)?|need (a )?new (doctor|pcp|primary)|cambiar de doctor|change my (doctor|pcp|primary)|my doctor (retired|left|moved|closed)|mi doctor (se )?(jubilo|cerro|se mudo|se fue))\b/i.test(_accentless1)) return 'doctor_change_request';
  if (/\b(went to (the )?er|fui a emergencia|emergency room visit|urgent care|cuidado urgente|sala de emergencia|fui a hospital ayer|hospital yesterday|i was in (the )?hospital|estaba en (el )?hospital|admitted to( the)? hospital|me admitieron)\b/i.test(_accentless1)) return 'er_hospital_visit';
  if (/\b(telemedicine|telehealth|telesalud|telemedicina|video visit|visita por video|virtual (visit|appointment)|cita virtual|visita virtual|consulta virtual)\b/i.test(_accentless1)) return 'telehealth';
  if (/\b(donut hole|coverage gap|brecha de cobertura|agujero de dona|catastrophic coverage|cobertura catastrofica)\b/i.test(_accentless1)) return 'donut_hole';
  if (/\b(meals after (the )?(hospital|surgery)|comidas (despues|post)( del?| de la| de)?( la)? ?(hospital|cirugia)|home[- ]?delivered meals|comidas a domicilio)\b/i.test(_accentless1)) return 'post_hospital_meals';
  if (/\b(compare plans|comparar planes|comparar opciones|show me (my )?(plan )?options|see all (my )?(plan )?options|ver (todas )?(mis )?opciones|mostrar (mis )?(plan )?opciones|que (planes|opciones) tengo|what plans (do i have|are available))\b/i.test(_accentless1)) return 'compare_plans';
  if (/\b(turning 65|turn 65|i turn 65|cumpliendo 65|cumplo 65|cumplir[eé] 65|voy a cumplir 65|new to medicare|first time medicare|nuevo (en|a) medicare|primer[ao] vez (en )?medicare|retiring|me jubilo|jubilar(me)?)\b/i.test(normalized)) return 'new_to_medicare';
  if (/\b(extra help|lis|low[- ]income subsid|ayuda extra|subsidio (de )?bajo ingreso|low income help with drug)\b/i.test(normalized)) return 'extra_help';
  if (/\b(msp|medicare savings program|qmb|slmb|qi|programa de ahorros|ahorro de medicare)\b/i.test(normalized)) return 'msp';
  if (/\b(medigap|medicare supplement|supplement plan|plan suplementario|plan g|plan n|plan f)\b/i.test(normalized)) return 'medigap';
  // WAVE 40 — explicit Medicaid mention (without letter/MSP/Extra Help
  // qualifiers). Routes to dual-eligibility educational handler.
  if (/\b(tengo medicaid|i have medicaid|medicaid en|medicaid in|medicaid card|tarjeta de medicaid|medicaid dual|dual eligible)\b/i.test(normalized)) {
    return 'medicaid_mention';
  }
  // WAVE 40 — scheduling / "when can I call" intent.
  if (/\b(when can (i|you) call|cu[aá]ndo (puede|puedo) llamar|callback|me llaman|advisor (will )?call|llamar(me)? (un|al?) asesor|que hora puede llamar|business hours|horario de atenci[oó]n)\b/i.test(normalized)) {
    return 'scheduling';
  }
  // WAVE 40 — rhetorical / "is anyone there" / "can someone help me".
  if (/\b(no hay nadie que me ayude|nadie me ayuda|alguien (que )?(me )?ayude|is anyone there|anyone (who can )?help me|can someone help)\b/i.test(normalized)) {
    return 'advisor';
  }
  // WAVE 40 — Medicare Advantage / MAPD specific intent.
  if (/\b(medicare advantage|mapd|advantage plan|ma plan|plan advantage|ventaja de medicare|medicare ventaja)\b/i.test(normalized)) return 'medicare_advantage';
  // WAVE 39 — Plan type questions (HMO / PPO / HMO-POS / PFFS).
  if (/\b(hmo[- ]?pos|hmo|ppo|pffs|hmo plan|ppo plan|qu[eé] es (un )?hmo|qu[eé] es (un )?ppo|diferencia (entre )?(hmo|ppo)|hmo (vs|or|y) ppo|ppo (vs|or|y) hmo)\b/i.test(normalized)) return 'plan_type_question';
  // WAVE 39 — SPAP / state pharmaceutical assistance.
  if (/\b(spap|state pharmaceutical assistance|epic\b|state prescription help|asistencia (estatal )?(de )?medicamentos|programa estatal de medicamentos)\b/i.test(normalized)) return 'spap';
  // WAVE 49 — Extra Help / LIS / Medicare Savings Programs (MSP/QMB/SLMB/QI/PACE).
  // Real low-income assistance programs. Must NEVER fall back to generic. We
  // place this BEFORE bill+drug detection so "premium" + "ayuda" routes here
  // (not to bill). Bot gives general info + advisor pivot, never confirms
  // eligibility (CMS compliance — eligibility depends on income/assets/state).
  if (
    // Direct program names — strongest signal.
    /\b(extra help|low[- ]income subsidy|\blis\b|medicare savings program|\bmsp\b|\bqmb\b|\bslmb\b|\bqi\b|\bpace\b)\b/i.test(normalized)
    // "help / ayuda with cost-related Medicare thing"
    || /\b(ayuda|ayudas|asistencia|subsidio|ayudar)\b.{0,30}\b(pagar|paying|prima|premium|copagos?|copays?|deducibles?|deductibles?|medicare|medicamentos?|medicinas?|recetas?|prescripci[oó]n|drug)\b/i.test(normalized)
    || /\b(help|assistance|subsidy)\b.{0,30}\b(paying|pay|with|for|my|medicare|premium|copays?|deductibles?|drugs?|medications?|prescriptions?)\b/i.test(normalized)
    // "I can't / no puedo afford / pagar X" specifically for the Medicare premium
    || /\b(can'?t afford|cannot afford|no puedo pagar)\b.{0,30}\b(premium|prima|copay|copago|medicare|drug|medication|medicina|medicamento)\b/i.test(normalized)
    // "savings program / programa de ahorro" (with or without 'medicare')
    || /\b(programa[s]? de ahorro|savings program|saving on medicare|ahorro de medicare|ahorro en medicare|ahorrar en medicare|save on medicare|reduce medicare cost|reducir.*medicare|baj(ar|en) los costos|lower (medicare )?costs)\b/i.test(normalized)
    // "financial assistance" / "asistencia financiera"
    || /\b(financial assistance|economic assistance|asistencia (financiera|econ[oó]mica|social))\b/i.test(normalized)
    // "low income" / "bajos ingresos"
    || /\b(low ?income|bajos? ingresos?)\b/i.test(normalized)
    // "ayudas de ahorros" / "savings help" specifically.
    || /\b(ayudas? (de|con|para) ahorros?|savings help|ayuda de ahorro)\b/i.test(normalized)
  ) return 'savings_program';
  // WAVE 39 — Moving to another state (triggers SEP).
  // WAVE 46 — accent-stripped for past-tense verb endings ("me mudé" / "me mude").
  if (/\b(me mud[oe]|me voy a mudar|nos mudamos|moving to|moving out of|just moved|i moved|i just moved|cambio de estado|cambiar(me)? de estado|mudandome|me mude (a|para)|acabo de mudarme)\b/i.test(normalized.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return 'moving_state_sep';
  // WAVE 40 — cost question MENTIONING a Part letter should route to cost_basics,
  // not medicare_basics (e.g. "¿cuánto es el copago de Parte D?").
  if (/\b(how much|cu[aá]nto|qu[eé] precio)\b.{0,30}\b(copay|copago|deducible|deductible|premium|prima|coinsurance|coseguro)\b/i.test(normalized)) return 'cost_basics';
  if (/\b(part a|parte a|part b|parte b|part c|parte c|part d|parte d|partes? de medicare|medicare parts|que es medicare)\b/i.test(normalized)) return 'medicare_basics';
  if (/\b(aep|annual enrollment period|periodo (anual )?de inscripci[oó]n|iep|initial enrollment|sep|special enrollment|special election|ventana(s)? de inscripci[oó]n|when can i enroll|cuando me inscribo)\b/i.test(normalized)) return 'enrollment_windows';
  if (/\b(irmaa|income[- ]related (monthly )?adjustment|income adjustment to part b|ajuste por ingreso|premium subi[oó]|premium increase|increase in premium|mi prima subi[oó])\b/i.test(normalized)) return 'irmaa_premium';
  // Cost basics — fires on EDUCATIONAL or AMOUNT-INQUIRY questions like
  // "what is deductible" / "how much is copay" / "cuánto es el copago".
  if (/\b(what (is|does|are)|what'?s|qu[eé] (es|son|significa)|expl[ií]queme|explain|c[oó]mo funciona|how does|how much (is|are)|cu[aá]nto (es|cuesta|son|vale)|cu[aá]nto pagar?[ée])\b.{0,40}\b(deducible|deductible|copay|copago|coinsurance|coseguro|out of pocket|moop|maximum out of pocket|m[aá]ximo de bolsillo|gasto m[aá]ximo|premium|prima)\b/i.test(normalized)) return 'cost_basics';
  if (/\b(complaint|queja|grievance|reclamo formal|complain about (the )?(plan|carrier)|me queja del plan|customer service problem|servicio al cliente)\b/i.test(normalized)) return 'complaint';
  if (/\b(billing dispute|disputed bill|disputa(r)? (una )?factura|charged twice|doble cobro|wrong amount on bill|bill is wrong)\b/i.test(normalized)) return 'billing_dispute';
  if (/\b(urgent medication|need (my )?medicine today|out of medicine|pharmacy refus|no me dieron (mi )?(medicina|medicamento)|no tengo (mi )?medicina|sin (mi )?medicina|urgent refill)\b/i.test(normalized)) return 'urgent_medication';
  // Order matters — most specific / highest priority first. Appeals/grievances
  // and enrollment changes win over generic drug/letter mentions.
  // WAVE 46 — procedure/surgery/treatment denial → appeal handler. Requires
  // the denial verb to be paired with a procedural noun (NOT medication —
  // that belongs in drug/medication triage).
  const _accentlessAppeal = normalized.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\b((no (me )?(quieren|quiere|aprueban|aprueba|aprobaron|aprobo|cubrieron|cubrio|cubre|cubren|cubrir[aá]n)|won'?t (cover|approve)|will not (cover|approve)|denied|rejected|rechazaron)\b[^.?!]{0,40}\b(procedimiento|procedure|cirugia|surgery|tratamiento|treatment|mri|resonancia|ct scan|tac|operaci[oó]n|operation|biopsia|biopsy|radiacion|radiation|quimio|chemo|test|labs?|x[- ]?ray|examen))\b/i.test(_accentlessAppeal)) return 'appeal';
  if (/\b(tratamiento rechazado|procedimiento rechazado|cirug[ií]a rechazada|treatment was rejected|procedure was rejected|surgery was rejected|appeal a denial|appeal the denial|denied (my )?(procedure|surgery|treatment|claim))\b/i.test(normalized)) return 'appeal';
  // "is X covered" / "está cubierto X" / generic coverage verification.
  if (/\b((is|are) (my |the )?(procedure|surgery|treatment|mri|ct scan|test|labs?|x[- ]?ray) covered|est[aá] cubierto (mi |el |la )?(procedimiento|cirug[ií]a|tratamiento|resonancia|examen)|cubre el plan (mi |el |la )?(procedimiento|cirug[ií]a|tratamiento|examen)|mi (procedimiento|cirug[ií]a|tratamiento) est[aá] cubierto)\b/i.test(normalized)) return 'coverage';
  if (/\b(apelaci[oó]n|apelar|appeal|appeals|reconsideration|fair hearing|grievance|queja|denied|negado|rejected)\b/i.test(normalized)) return 'appeal';
  if (/\b(inscripci[oó]n|inscribir|inscribirme|enrollment|enroll|enrolling|disenroll|disenrollment|sep|aep|iep)\b/i.test(normalized)) return 'enrollment';
  // "change/switch [my|the|another|my own] plan(s)" — allow up to 2 words between
  if (/\b(change|switch|cambiar|cambiarme)\b(?:\s+\w+){0,2}\s+\b(plan|plans|planes)\b/i.test(normalized)) return 'enrollment';
  // WAVE 48 — "cheaper plan" / "plan mas barato" — shopping for enrollment.
  if (/\b(cheaper|less expensive|more affordable|low(er)? cost|m[aá]s barato|mas economico|m[aá]s econ[oó]mico)\b.{0,15}\b(plan|planes|medicare)\b/i.test(normalized)
      || /\b(plan|planes|medicare)\b.{0,15}\b(cheaper|less expensive|more affordable|m[aá]s barato|mas economico|m[aá]s econ[oó]mico)\b/i.test(normalized)) return 'enrollment';
  // WAVE 48 — explicit "need authorization / prior auth" for a procedure or
  // therapy. Routes to appeal-style handler (denial of approval).
  if (/\b(need|necesito|need[a-z]*|requires?|require)\s+(an? |una? )?(auth(orization)?|autorizaci[oó]n|prior auth(orization)?)\b.{0,40}\b(therapy|terapia|procedure|procedimiento|cirug[ií]a|surgery|treatment|tratamiento|mri|resonancia|examen|test)\b/i.test(normalized)
      || /\b(autorizaci[oó]n|prior auth(orization)?)\b.{0,15}\b(for|para)\b.{0,25}\b(therapy|terapia|procedure|procedimiento|cirug[ií]a|surgery|treatment|tratamiento)\b/i.test(normalized)) return 'appeal';
  // WAVE 48 — "they won't let me see X" / "no me dejan ver" → provider access.
  if (/\b(they (won'?t|will not|wouldn'?t|would not) let me see|no me dejan ver|no me permiten ver|no me dejan ir)\b/i.test(normalized)) return 'doctor_provider_network';
  // (Wave 42 SPECIFIC detectors above were moved upstream — kept this marker
  // for diff readability.)
  // WAVE 40 — bare dollar amount with charged/paid/cobraron context → bill.
  if (/(\$\d|\b\d{1,5}\s?(dollars|d[oó]lares|usd))\b.{0,40}\b(charged|charge|cobraron|cobr[oó]|paid|pagu[eé]|owe|adeudo|debo)\b/i.test(normalized)
      || /\b(charged|cobraron|cobr[oó])\b.{0,15}\$\d/i.test(normalized)
      || /\bme cobraron \$/i.test(normalized)) {
    return 'bill';
  }
  if (/\b(bill|bills|factura|facturas|cobro|cobros|premium|prima|copay|copago|deductible|eob)\b/i.test(normalized)) return 'bill';
  if (/\b(carta|cartas|letter|notice|aviso|anoc|eoc|renovaci[oó]n|renewal|medicaid notice|extra help notice|irmaa)\b/i.test(normalized)) return 'letter';
  if (/\b(medication|medications|medicamento|medicamentos|medicina|medicinas|pastilla|pastillas|drug|drugs|pharmacy|farmacia|prescription|receta)\b/i.test(normalized)) return 'drug';
  // WAVE 47 — plan recommendation question. Bot must NEVER answer "which plan is
  // best for me" directly (CMS TPMO compliance). Route to a dedicated handler
  // that pivots to a licensed advisor without naming a specific plan.
  if (/\b(qu[eé] plan (es )?(mejor|es el mejor|es bueno|me conviene|me recomienda)|cu[aá]l plan (me conviene|es mejor|es bueno|recomienda)|which plan (is )?(best|better|right|good|recommend)|recommend (me )?a plan|recomi[eé]ndame un plan|best medicare plan|mejor plan de medicare)\b/i.test(normalized)) return 'plan_recommendation';
  // Coverage check on a specific doctor / hospital / drug — bot can NOT
  // confirm in/out of network. Route to coverage handler (already deflects).
  if (/\b(is my (doctor|hospital|clinic|drug) (covered|in network|in-network)|est[aá] (mi |el )?(doctor|hospital|cl[ií]nica|medicina|medicamento) (cubierto|en (la )?red|en (mi )?plan)|cubre (mi |el )?(doctor|hospital|cl[ií]nica|medicina|medicamento))\b/i.test(normalized)) return 'coverage';
  if (/\b(doctor|doctora|provider|hospital|cl[ií]nica|cobertura|coverage|red|network|specialist|especialista)\b/i.test(normalized)) return 'coverage';
  // ─── WAVE 42 — duplicate detection block (will be moved up) ───
  // Medical emergency / symptom → 911 routing.
  if (/\b(chest (pain|hurts)|me duele el pecho|can'?t breathe|no puedo respirar|having a (heart attack|stroke)|tengo un (infarto|derrame)|me siento desmayar|i'?m fainting|bleeding (badly|a lot)|estoy sangrando|emergencia m[eé]dica|medical emergency)\b/i.test(normalized)) return 'medical_emergency_911';
  // Fraud / scam concerns (Senior Medicare Patrol territory). Accentless
  // check handles "llamó/llamo" + "pedí/pedi" parity for the trailing \b.
  const _accentlessFraud = normalized.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\b(scam|fraud|fraude|estafa|alguien (me )?llamo|someone called|robo de identidad|identity theft|me pidieron (mi )?(numero de )?medicare|asked (for )?my medicare (id|number)|tarjeta que no pedi|card i didn'?t order|factura (por|de) (una )?visita que no tuv|billed for (a )?visit i didn'?t|charged for service i never|cobro que no reconozco|cobro extra[nñ]o)\b/i.test(_accentlessFraud)) return 'fraud_scam';
  // Off-topic non-Medicare chitchat (weather, politics, jokes, religion).
  if (/\b(weather|clima|tiempo (afuera|de hoy)|biden|trump|obama|politics|pol[ií]tica|election|elecciones|do you pray|crees en (dios|religi[oó]n)|joke|chiste|recipe|receta de (cocina|comida)|sports|deporte|football|f[uú]tbol)\b/i.test(normalized) && normalized.length < 100) return 'off_topic';
  // About ClearPoint / agent identity.
  if (/\b(who (are|is) (clearpoint|clear point)|qui[eé]nes? (son|es) (clearpoint|clear point)|son ustedes medicare|are you medicare|are you the government|son del gobierno|do you charge|(ustedes|uds|clearpoint) cobran|c[oó]mo (tienen|consiguieron) mi (info|n[uú]mero)|how do you have my (info|number)|qu[eé] planes venden|what plans do you sell|son (asesores )?licenciados|are you licensed)\b/i.test(normalized)) return 'about_clearpoint';
  // Doctor change / search request (NOT "doctor doesn't accept" — that's
  // provider_access_issue). This is "I want a new doctor", "find me a doctor".
  if (/\b(find (me )?a (new )?doctor|buscar (un )?doctor|quiero (un )?(nuevo |otro )?doctor( nuevo| otro)?|need (a )?new (doctor|pcp|primary)|cambiar de doctor|change my (doctor|pcp|primary)|my doctor (retired|left|moved|closed)|mi doctor (se )?(jubil[oó]|cerr[oó]|se mud[oó]|se fue))\b/i.test(normalized)) return 'doctor_change_request';
  // ER / urgent care / hospital visit (NOT a hospital network question).
  if (/\b(went to (the )?er|fui a emergencia|emergency room visit|urgent care|cuidado urgente|sala de emergencia|fui a hospital ayer|hospital yesterday|i was in (the )?hospital|estaba en (el )?hospital|admitted to hospital|me admitieron)\b/i.test(normalized)) return 'er_hospital_visit';
  // Telemedicine / telehealth.
  if (/\b(telemedicine|telehealth|telesalud|telemedicina|video visit|visita por video|virtual (visit|appointment)|cita virtual)\b/i.test(normalized)) return 'telehealth';
  // Donut hole / coverage gap.
  if (/\b(donut hole|coverage gap|brecha de cobertura|agujero de dona|catastrophic coverage|cobertura catastr[oó]fica)\b/i.test(normalized)) return 'donut_hole';
  // Insulin $35 cap.
  if (/\b(insulin( cap| cost| 35| copay)?|insulina( cap| costo| 35| copago)?|\$35 insulin|insulina (de )?\$35)\b/i.test(normalized)) return 'insulin_cap';
  // Mail order / pharmacy switch.
  if (/\b(mail[- ]?order( pharmacy)?|farmacia por correo|switch pharmac(y|ies)|cambiar (de )?farmacia|preferred pharmacy|farmacia preferida)\b/i.test(normalized)) return 'pharmacy_logistics';
  // Generic vs brand drugs.
  if (/\b(generic|gen[eé]rico|brand name|de marca|generic vs brand|tier (1|2|3|4|5)|drug tier|nivel de medicamento)\b/i.test(normalized)) return 'drug_tier';
  // Vaccines (Shingrix, pneumonia, flu).
  if (/\b(shingrix|culebrilla|vacuna|vaccine|pneumonia (shot|vaccine)|neumon[ií]a|flu shot|vacuna de la gripe|covid (shot|vaccine|booster))\b/i.test(normalized)) return 'vaccine_question';
  // Premium went up.
  if (/\b((my |mi )?premium (went up|increased|aument[oó]|subi[oó])|(mi |my )?prima subi[oó]|why is (my )?premium higher|why did my premium go up|por qu[eé] subi[oó])\b/i.test(normalized)) return 'premium_increase';
  // Plan comparison / compare options.
  if (/\b(compare plans|comparar planes|comparar opciones|show me (my )?options|see all (my )?options|ver (todas )?(mis )?opciones|qu[eé] (planes|opciones) tengo|what plans (do i have|are available))\b/i.test(normalized)) return 'compare_plans';
  // Disenroll / cancel plan (NOT termination notice — that's letter).
  if (/\b(disenroll|cancel(ar)? (mi |my )?plan|darme de baja|drop my plan|leave (my )?plan|salirme del plan|no quiero (seguir|este) plan)\b/i.test(normalized) && !/carta|letter/i.test(normalized)) return 'disenroll_request';
  // Special employment / coverage situations.
  if (/\b(still working at 65|todav[ií]a trabajo|employer (coverage|insurance)|cobertura del empleador|cobra coverage|cobra (after|y) medicare|va benefits|veteran (affairs|administration)|tricare|chunampa|i was on cobra)\b/i.test(normalized)) return 'employer_va_cobra';
  // D-SNP / C-SNP / I-SNP special needs plans.
  if (/\b(d[- ]?snp|c[- ]?snp|i[- ]?snp|special needs plan|plan de necesidades especiales|chronic condition plan|plan de condici[oó]n cr[oó]nica)\b/i.test(normalized)) return 'snp_plans';
  // Original Medicare enrollment intent.
  if (/\b(enroll(ing)? in (original )?medicare|inscribirme (en|a) medicare( original)?|sign up for medicare|how do i (get|start) medicare|c[oó]mo (me inscribo|empezar) (en|con) medicare|just got medicare card|reci[eé]n recib[ií] (mi )?tarjeta de medicare)\b/i.test(normalized)) return 'original_medicare_enroll';
  // SilverSneakers / gym benefit.
  if (/\b(silver ?sneakers|gym (benefit|membership)|gimnasio|membres[ií]a (de )?gimnasio|fitness benefit|beneficio (de )?fitness)\b/i.test(normalized)) return 'gym_benefit';
  // Meals after hospital.
  if (/\b(meals after (the )?(hospital|surgery)|comidas (despu[eé]s del?|post[- ]?)( la )?(hospital|cirug[ií]a)|home[- ]?delivered meals|comidas a domicilio)\b/i.test(normalized)) return 'post_hospital_meals';
  // Mental health / therapy.
  if (/\b(mental health|salud mental|terapia|therapist|terapeuta|psych(iatr|olog)|psiqui[aá]tr|psic[oó]log|depression|depresi[oó]n|anxiety|ansiedad)\b/i.test(normalized)) return 'mental_health';
  // Alternative care: chiropractor, acupuncture, podiatrist.
  if (/\b(chiropractor|quiropr[aá]ctico|acupuncture|acupuntura|podiatrist|pod[oó]logo|massage therapy|terapia de masaje)\b/i.test(normalized)) return 'alternative_care';
  // Accessibility needs.
  // Conversation control — go back, change topic, summary.
  if (/\b(go back|regresa|atr[aá]s|cambiar (de )?tema|change (the )?topic|switch topic|hablar de (otra cosa|otro tema)|summary (so far)?|resumen (hasta ahora)?|r[eé]sumeme|sum it up)\b/i.test(normalized)) return 'conversation_control';
  // Personal context — caregiver, living alone, low income.
  if (/\b(caregiver|cuidador|cuido a (mi )?(mam|pap|esposo|esposa|abuel|hij)|soy cuidador|i (take care|am taking care|'?m taking care) of|i care for|live alone|vivo sol[oa]|fixed income|ingreso fijo|low income|(bajo|poco) ingreso|ingreso (bajo|limitado)|just retired|reci[eé]n (me )?jubil|recently retired|acabo de jubilarme|estoy retirad[oa]|i'?m retired)\b/i.test(normalized)) return 'personal_context';
  // EOB explanation request.
  if (/\b(what (is|does) (an? )?eob|qu[eé] es (un )?eob|explain (the |an? )?eob|expli(que|car)( la|un)? eob|explicaci[oó]n de beneficios|explanation of benefits)\b/i.test(normalized)) return 'eob_explanation';
  // SHIP referral / external counseling.
  if (/\b(ship counseling|ship program|programa ship|state insurance department|departamento de seguros|insurance commissioner|comisi[oó]n de seguros|ombudsman)\b/i.test(normalized)) return 'ship_referral';
  // Returning customer.
  if (/\b(i called before|ya llam[eé] antes|spoke to (someone|an advisor) before|habl[eé] con (alguien|un asesor) antes|returning customer|cliente (que regresa|antiguo))\b/i.test(normalized) && normalized.length < 80) return 'returning_customer';
  // Family referral.
  if (/\b(my (daughter|son|wife|husband|niece|grandchild) (sent|told) me|mi (hija|hijo|esposa|esposo|sobrina|nieto) me (mand|dijo))\b/i.test(normalized)) return 'family_referral';
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

// WAVE 47/49 — public entrypoint wraps processMessageInner with a global
// loop-guard so the bot can never repeat itself. Two flavors of repetition:
//
//   (a) EXACT TEXT REPEAT — two adjacent bot responses identical after
//       normalization. The handler bug case.
//
//   (b) SEMANTIC MENU REPEAT — two adjacent bot responses that BOTH list
//       the same multi-topic chip-style menu ("¿es sobre factura, doctor,
//       medicamentos, carta, cobertura?" twice with different wording).
//       The Sawil "estás perdido" case — bot kept asking the same menu
//       with different lipstick. We detect by counting the number of
//       Medicare-topic words listed AND whether both are interrogatives.
//
// On either match we replace the duplicate with a real escalation pivot
// (offer advisor + 3 concrete choices). Defense in depth — handlers should
// not loop, but if one does the user never sees it.
export function processMessage(
  userMessage: string,
  state: ConversationState,
): { response: string; newState: ConversationState; needsHuman: boolean } {
  const prevBot = [...(state.messages || [])].reverse().find((m) => m.role === 'bot');
  const prevBotText = (prevBot?.content || '').trim();
  const result = processMessageInner(userMessage, state);
  const respText = (result.response || '').trim();

  const exactDup = !!(respText && prevBotText
    && _normalizeForCompare(respText) === _normalizeForCompare(prevBotText));
  const menuDup = !exactDup && !!(respText && prevBotText
    && _looksLikeChipMenu(respText) && _looksLikeChipMenu(prevBotText));

  if (exactDup || menuDup) {
    const isEs = result.newState.language === 'es';
    const pivot = isEs
      ? 'Disculpe — para no dar vueltas: ¿quiere que un asesor licenciado de ClearPoint le llame ahora para revisar sus opciones (sin costo), o tiene una pregunta puntual sobre Medicare que pueda contestar primero?'
      : "Sorry — to avoid going in circles: would you like a licensed ClearPoint advisor to call you now to review your options (at no cost), or do you have one specific Medicare question I can answer first?";
    if (result.newState.messages.length > 0) {
      const lastIdx = result.newState.messages.length - 1;
      if (result.newState.messages[lastIdx].role === 'bot') {
        result.newState.messages[lastIdx] = {
          role: 'bot',
          content: pivot,
          timestamp: Date.now(),
        };
      } else {
        result.newState.messages.push({ role: 'bot', content: pivot, timestamp: Date.now() });
      }
    }
    result.newState.quickReplies = isEs
      ? ['Sí, llamar asesor', 'Tengo una pregunta', 'Más tarde']
      : ['Yes, call advisor', 'I have a question', 'Later'];
    result.newState.lastBotIntent = 'loop_guard_pivot';
    return { response: pivot, newState: result.newState, needsHuman: result.needsHuman };
  }
  return result;
}

function _normalizeForCompare(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[*_`]/g, '')
    .trim();
}

// WAVE 49 — heuristic: does this bot response look like a multi-topic chip
// menu? We count distinct Medicare-topic words AND require the message be
// short-ish (under 400 chars) and end in a question.
function _looksLikeChipMenu(s: string): boolean {
  const n = _normalizeForCompare(s);
  if (n.length > 400) return false;
  // Must be a question (ends in ? or has interrogative opener).
  const isQuestion = /\?$|\bes (sobre|acerca|de)\b|\bis it (about|a)\b/.test(n);
  if (!isQuestion) return false;
  const topicWords = [
    'factura', 'doctor', 'medicina', 'medicamento', 'carta', 'cobertura',
    'inscripcion', 'plan', 'farmacia', 'asesor', 'proveedor', 'tarjeta',
    'bill', 'doctor', 'drug', 'medication', 'letter', 'coverage',
    'enrollment', 'plan', 'pharmacy', 'advisor', 'provider', 'card',
  ];
  let hits = 0;
  for (const w of topicWords) {
    if (new RegExp(`\\b${w}\\b`).test(n)) hits++;
    if (hits >= 3) return true;
  }
  return false;
}

function processMessageInner(
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
  // WAVE 32 — REPETITION TRACKING
  //
  // Compare the current user message to the previous normalized message. If
  // they match (or are near-identical), increment repeatedUserMessageCount so
  // downstream handlers can shorten / escalate instead of repeating.
  // We track here; downstream handlers decide what to do with the count.
  // ─────────────────────────────────────────────────────────────────────────
  {
    const curNorm = normalizeText(userMessage).trim();
    const prevNorm = (newState.normalizedLastUserMessage || '').trim();
    if (curNorm && prevNorm && curNorm === prevNorm) {
      newState.repeatedUserMessageCount = (newState.repeatedUserMessageCount || 0) + 1;
    } else if (curNorm && prevNorm
               && curNorm.length > 6 && prevNorm.length > 6
               && (curNorm.includes(prevNorm) || prevNorm.includes(curNorm))) {
      newState.repeatedUserMessageCount = (newState.repeatedUserMessageCount || 0) + 1;
    } else {
      newState.repeatedUserMessageCount = 0;
    }
    newState.normalizedLastUserMessage = curNorm;
  }

  // ──────────────────────────────────────────────────────────────────────
  // WAVE 49 — VAGUE-AFTER-MENU ESCALATION
  //
  // If the bot's last message was a chip-style topic menu AND the user's
  // current message is short / vague / "no se" / "ayuda" / "estas perdido",
  // do NOT give another menu. Escalate to advisor offer instead. Prevents
  // the dead-end loop Sawil hit on live preview ("ayuda" → menu → "no se"
  // → another menu).
  // ──────────────────────────────────────────────────────────────────────
  if (newState.step !== 'asking_language' && newState.step !== 'asking_zip_natural' && newState.language) {
    const _prevBot = [...(newState.messages || [])].slice(0, -1).reverse().find((m) => m.role === 'bot');
    const _prevWasMenu = _prevBot && _looksLikeChipMenu(_prevBot.content || '');
    const _userMsgNorm = userMessage.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const _userIsVague =
      _userMsgNorm.length < 20
      && /^(ayuda|help|no se|no sé|i don'?t know|dunno|idk|nada|nothing|no entiendo|no idea|no estoy seguro|not sure|cualquier|whatever|whichever|todo|all|all of it|todas|de todo|estas perdido|youre lost|you're lost|no se que|i dont know what|esto es|this is)\.?$/i.test(_userMsgNorm);
    if (_prevWasMenu && _userIsVague && !newState.advisorHandoffStarted) {
      const _isEs = newState.language === 'es';
      const out = _isEs
        ? `Entiendo. No voy a seguir repitiendo preguntas. Puedo pasarle con un asesor licenciado de ClearPoint, o hacerle una sola pregunta más para organizar el caso. ¿Qué prefiere?`
        : `I understand. I won't keep asking the same thing. I can hand you off to a licensed ClearPoint advisor, or ask you one more focused question to organize the case. What do you prefer?`;
      newState.quickReplies = _isEs
        ? ['Hablar con asesor', 'Una pregunta más', 'Empezar de nuevo']
        : ['Talk to advisor', 'One more question', 'Start over'];
      newState.lastBotIntent = 'vague_after_menu_escalation';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // WAVE 47 — EXISTING-CLIENT GATE RESPONSE HANDLER
  //
  // After the bot asks "¿es usted cliente actual de ClearPoint?" the user
  // can answer in many ways. Catch those answers here BEFORE any topic
  // routing so the lead-qualification path is honored.
  // ──────────────────────────────────────────────────────────────────────
  if (newState.existingClientAsked && newState.isExistingClient === undefined) {
    const _t = userMessage.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/^(si|si soy cliente|si, soy cliente|yes|yes i am|yes i'?m a client|claro que si|por supuesto|soy cliente)\.?$/i.test(_t)
        || /\b(soy cliente|i am a client|i'?m a client|tengo asesor|mi asesor)\b/i.test(_t)) {
      newState.isExistingClient = true;
      newState.advisorHandoffStarted = true;
      newState.needsHuman = true;
      const isEs = newState.language === 'es';
      const out = isEs
        ? `Perfecto. Voy a pasar su caso a su asesor asignado para que le contacte. Por favor, su nombre y el mejor teléfono — y por seguridad, no envíe número de Medicare, Seguro Social, ni datos bancarios aquí.`
        : `Perfect. I'll forward your case to your assigned advisor for follow-up. Please share your name and the best phone number — and for safety, don't send Medicare ID, SSN, or banking info here.`;
      newState.lastBotIntent = 'lead_qual_existing_handoff';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: true };
    }
    if (/^(no|nuevo|soy nuevo|no soy nuevo|no soy cliente|first time|no, soy nuevo|no, primera vez|primera vez|no im new|no i am new)\.?$/i.test(_t)
        || /\b(no soy cliente|no soy nuevo|i'?m new|i am new|primera vez|nunca he llamado|new (here|customer))\b/i.test(_t)) {
      newState.isExistingClient = false;
      const isEs = newState.language === 'es';
      const out = isEs
        ? `Bienvenido. Aquí le doy información general — no resolvemos casos específicos del plan actual. Si su plan no le está cubriendo lo que necesita, un asesor licenciado puede revisar **opciones de plan** en su área sin costo. ¿Le gustaría ver opciones?`
        : `Welcome. I share general information here — we don't solve specific issues with your current plan. If your plan isn't covering what you need, a licensed advisor can review **plan options** in your area at no cost. Want to see options?`;
      newState.quickReplies = isEs
        ? ['Sí, ver opciones', 'No, otra cosa']
        : ['Yes, see options', 'No, something else'];
      newState.lastBotIntent = 'lead_qual_new_pivot';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (/^(solo info|solo informaci[oó]n|just info|just information|info|information)\.?$/i.test(_t)) {
      newState.isExistingClient = false;
      const isEs = newState.language === 'es';
      const out = isEs
        ? `Por supuesto. ¿Cuál es el tema en general que quiere entender? (Medicare Original vs Advantage, costos, inscripción, beneficios, doctores, medicamentos...). Si después quiere revisar opciones de plan, un asesor licenciado puede ayudar sin costo.`
        : `Of course. What's the general topic you'd like to understand? (Original Medicare vs Advantage, costs, enrollment, benefits, doctors, drugs...). If later you want to review plan options, a licensed advisor can help at no cost.`;
      newState.lastBotIntent = 'lead_qual_info_only';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
  }

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
      // V31/V32 — Honest "no" answers inside an active medication or
      // provider triage are NOT frustration. Let the triage handler interpret.
      const isShortNoRefusal = /^(no+|nope|nah)\.?$/i.test(userMessage.trim());
      const inActiveMedTriage = newState.serviceCategory === 'drug'
        && (newState.askedQuestions || []).some((q) => q.startsWith('med_'));
      const inActiveProviderTriage = newState.serviceCategory === 'doctor_provider_network'
        && (newState.askedQuestions || []).some((q) => q.startsWith('provider_'));
      if (isShortNoRefusal && (inActiveMedTriage || inActiveProviderTriage) && ab.severity === 'mild') {
        // Skip frustration recovery — let the conversation block interpret it.
      } else {
        newState.frustrationCount = (newState.frustrationCount || 0) + 1;
        newState.emotionalState = ab.severity === 'severe' ? 'angry' : 'frustrated';
        // Wave 34 — track profanity specifically when no topic exists.
        if (!newState.serviceCategory && !newState.hasRealIssue) {
          newState.profanityNoIssueCount = (newState.profanityNoIssueCount || 0) + 1;
        }
        return enterRecoveryMode(newState, 'frustration');
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // WAVE 34 — NONSENSE / UNCLASSIFIABLE INPUT WITH NO TOPIC
    //
    // If the user types gibberish ("mkvso", "asdf"), filler ("hmm"), or any
    // input with no recognizable Medicare topic AND we have no
    // serviceCategory established yet, route to 3-tier recovery instead of
    // falling through to the generic "coverage" paragraph. Stage advances
    // each turn so the bot never sends the same message twice.
    // ──────────────────────────────────────────────────────────────────────
    // Wave 35 — At recovery stage ≥ 3 we've offered an advisor. Catch the
    // confirmation answer ("sí", "yes", "empezar", "start") BEFORE we re-enter
    // recovery so the bot moves into advisor handoff or resets cleanly.
    if ((newState.recoveryStage || 0) >= 3 && !newState.serviceCategory) {
      // Strip accents + trim + lowercase. \b is ASCII-only so 'sí' wouldn't
      // word-boundary correctly without this.
      const t = userMessage
        .trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (/^(si|yes|claro|ok|okay|por favor|please|contactar|advisor|asesor)\b/i.test(t)
          || /^(si,?\s+contactar|yes,?\s+contact)/i.test(t)) {
        newState.advisorHandoffReason = newState.advisorHandoffReason || 'unclear_topic_user_consented';
        newState.needsHuman = true;
        newState.advisorHandoffStarted = true;
        const out = isSpanish
          ? 'Perfecto. Un asesor licenciado de ClearPoint le va a contactar. Por favor no envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos aquí. ¿Cuál es su nombre y un teléfono donde le puedan llamar?'
          : "Perfect. A ClearPoint licensed advisor will contact you. Please don't send Medicare ID, SSN, banking information, or private medical records here. What's your name and a phone number where they can reach you?";
        newState.lastBotIntent = 'recovery_advisor_handoff_start';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      }
      if (/^(empezar|start|start over|reiniciar|reset|nuevo)\b/i.test(t)) {
        // Soft reset: clear recovery + counters + topic. Keep language / ZIP.
        newState.recoveryStage = 0;
        newState.hasRealIssue = false;
        newState.serviceCategory = undefined;
        newState.intent = '';
        newState.subIssue = undefined;
        newState.providerIssueType = undefined;
        newState.medicationIssueType = undefined;
        newState.letterIssueType = undefined;
        newState.letterSender = undefined;
        newState.askedQuestions = [];
        newState.repeatedUserMessageCount = 0;
        newState.advisorHandoffReason = undefined;
        const out = isSpanish
          ? 'Listo, empezamos de nuevo. ¿En qué le puedo ayudar?'
          : 'Done, starting over. How can I help?';
        newState.lastBotIntent = 'soft_reset';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
    }

    if (!newState.serviceCategory && !newState.hasRealIssue && detectNonsense(userMessage)) {
      newState.nonsenseCount = (newState.nonsenseCount || 0) + 1;
      return enterRecoveryMode(newState, 'nonsense');
    }

    // Wave 34 — once in recovery (stage >= 1) and the current message still
    // does NOT contain a real Medicare topic, stay in recovery and advance
    // the stage instead of dumping a generic fallback. Avoids the loop
    // "Thanks for telling me. Can you give me a bit more detail…" that
    // confused the user mid-recovery.
    if ((newState.recoveryStage || 0) >= 1 && !newState.serviceCategory && !newState.hasRealIssue) {
      const probe = detectProblemType(userMessage);
      const hasTopic = probe && probe !== 'general' && probe !== 'casual';
      if (!hasTopic) {
        return enterRecoveryMode(newState, 'nonsense');
      }
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
  // V31 — when in medication flow, preserve topic context in the switch.
  if (newState.language && newState.step !== 'asking_language') {
    const sw = detectExplicitLanguageSwitch(userMessage);
    if (sw && sw !== newState.language) {
      newState.language = sw;
      const inMedFlow = newState.serviceCategory === 'drug'
        && (newState.subIssue === 'vague_report'
            || !!newState.medicationIssueType
            || (newState.askedQuestions || []).some((q) => q.startsWith('med_')));
      const inProviderFlow = newState.serviceCategory === 'doctor_provider_network'
        && (!!newState.providerIssueType
            || (newState.askedQuestions || []).some((q) => q.startsWith('provider_')));
      const inLetterFlow = newState.serviceCategory === 'letter'
        && (!!newState.letterSender
            || !!newState.letterIssueType
            || (newState.askedQuestions || []).some((q) => q.startsWith('letter_')));
      let out: string;
      if (inMedFlow) {
        out = sw === 'es'
          ? 'Claro, seguimos en español. ¿Le siguen pidiendo verificar lo del medicamento — el costo, la cobertura o lo que pasó en la farmacia?'
          : "Of course, let's continue in English. Should we keep checking the medication — the cost, the coverage, or what happened at the pharmacy?";
        newState.quickReplies = [];
      } else if (inProviderFlow) {
        // V33 — keep provider topic across language switch.
        out = sw === 'es'
          ? 'Claro, seguimos en español. Seguimos con el problema del doctor. ¿Es su doctor primario o un especialista?'
          : "Of course, continuing in English. We're still on the doctor issue. Is it your primary doctor or a specialist?";
        newState.quickReplies = sw === 'es'
          ? ['Doctor primario', 'Especialista', 'No estoy seguro', 'Hablar con asesor']
          : ['Primary doctor', 'Specialist', "I'm not sure", 'Talk to advisor'];
      } else if (inLetterFlow) {
        out = sw === 'es'
          ? 'Claro, seguimos en español. Seguimos con la carta. ¿Vino de Medicare, Seguro Social, Medicaid, o de su plan?'
          : "Of course, continuing in English. We're still on the letter. Did it come from Medicare, Social Security, Medicaid, or your plan?";
        newState.quickReplies = sw === 'es'
          ? ['Medicare', 'Seguro Social', 'Medicaid', 'Mi plan']
          : ['Medicare', 'Social Security', 'Medicaid', 'My plan'];
      } else {
        out = sw === 'es'
          ? 'Perfecto, ahora hablo en español. ¿Qué necesita revisar?'
          : 'Got it, switching to English. What do you need help with?';
        newState.quickReplies = sw === 'es' ? [...TOPIC_CHIPS_ES] : [...TOPIC_CHIPS_EN];
      }
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
    // ────────────────────────────────────────────────────────────────────
    // WAVE 39 — STRICT 5-DIGIT ZIP VALIDATOR (Sawil V39 spec C)
    //
    // ACCEPT only when one of:
    //   1. Message is purely 5 digits (± whitespace): "10550", "  10550 ".
    //   2. Message is a clean 5-digit ZIP with optional ±4 extension:
    //      "10550-1234".
    //   3. Message contains a 5-digit token in context AND no run of >5
    //      adjacent digits anywhere ("ZIP 10550", "es 10550 brooklyn",
    //      "my ZIP is 07407"). The boundary test ensures "123453" or
    //      "1234567" is REJECTED — they're 6/7 adjacent digits, not a ZIP.
    //   4. Spaced single digits where the total digit count is exactly 5:
    //      "1 0 5 5 0".
    //
    // REJECT (returns retry message in current language):
    //   · "123453"   — 6 adjacent digits
    //   · "1234"     — fewer than 5 digits
    //   · "ABCDE"    — letters
    //   · "12-345"   — embedded non-digit/non-space between digits
    //   · "123 4567" — adjacent groups summing to ≠ 5 with no clean 5-digit
    //                  token
    // ────────────────────────────────────────────────────────────────────
    let zipDigits: string | null = null;
    let zipRejectReason: 'too_short' | 'too_long' | 'malformed' | null = null;
    const onlyDigits = /^[\d\s-]+$/.test(trimmed);
    const allDigitsConcat = trimmed.replace(/[\s-]/g, '');
    const longestDigitRun = (trimmed.match(/\d+/g) || []).reduce(
      (m, run) => Math.max(m, run.length), 0,
    );
    // Case A: message is pure digit/whitespace/dash content.
    if (onlyDigits && trimmed.length > 0) {
      // 5+4 extension: 99999-9999 (10 chars exactly with dash) → keep first 5.
      const ext = trimmed.replace(/\s/g, '').match(/^(\d{5})-\d{4}$/);
      if (ext) {
        zipDigits = ext[1];
      } else if (/^\d+$/.test(allDigitsConcat) && allDigitsConcat.length === 5) {
        zipDigits = allDigitsConcat;
      } else if (allDigitsConcat.length < 5) {
        zipRejectReason = 'too_short';
      } else if (allDigitsConcat.length > 5) {
        zipRejectReason = 'too_long';
      } else {
        zipRejectReason = 'malformed';
      }
    } else if (/[A-Za-z]/.test(trimmed) && longestDigitRun === 0) {
      // No digits at all but message has letters — let language-switch /
      // topic detection downstream handle this. Don't reject as ZIP.
    } else {
      // Case B: contains words PLUS digits. Look for a clean 5-digit token
      // that is NOT part of a longer digit run.
      // Strategy: longest digit run must be exactly 5 for it to be a ZIP.
      // (Otherwise something like "I'm 70 years old and my ZIP is 123453"
      // would silently extract "12345" — wrong.)
      if (longestDigitRun === 5) {
        const m = trimmed.match(/(?<!\d)(\d{5})(?!\d)/);
        if (m) zipDigits = m[1];
      } else if (longestDigitRun > 5) {
        zipRejectReason = 'too_long';
      } else if (longestDigitRun > 0 && longestDigitRun < 5
                 && allDigitsConcat.length === 5 && /^[\d\s]+$/.test(trimmed)) {
        // Spaced single digits: "1 0 5 5 0" → 10550.
        zipDigits = allDigitsConcat;
      }
    }

    if (zipDigits) {
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
      // WAVE 45 — confirm the ZIP back to the user and tell them which state
      // it maps to. If outside service area (NY/NJ/FL/CT), the bot is honest
      // that ClearPoint advisors may not cover every plan there.
      const stateLabel = isSpanish
        ? (detectedState === 'NY' ? 'Nueva York'
         : detectedState === 'NJ' ? 'Nueva Jersey'
         : detectedState === 'FL' ? 'Florida'
         : detectedState === 'CT' ? 'Connecticut'
         : '')
        : (detectedState || '');
      let out: string;
      if (detectedState && isSpanish) {
        out = `Gracias. Anotado, su ZIP ${zipDigits} es de **${stateLabel}**. Eso ayuda a ubicar los planes disponibles en su área cuando hablemos con un asesor licenciado. ¿En qué le puedo ayudar hoy?`;
      } else if (detectedState) {
        out = `Thanks. Got it, your ZIP ${zipDigits} is in **${stateLabel}**. That helps locate plans available in your area when we connect you with a licensed advisor. How can I help you today?`;
      } else if (isSpanish) {
        out = `Gracias. Anotado, su ZIP ${zipDigits} — fuera de las áreas principales de ClearPoint (NY/NJ/FL/CT), pero podemos seguir ayudándole con información general y conectarle con un asesor licenciado. ¿En qué le puedo ayudar hoy?`;
      } else {
        out = `Thanks. Got it, your ZIP ${zipDigits} — outside ClearPoint's main service areas (NY/NJ/FL/CT), but I can still help with general information and connect you with a licensed advisor. How can I help you today?`;
      }
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (zipRejectReason) {
      newState.failedZipAttempts = (newState.failedZipAttempts || 0) + 1;
      const out = isSpanish
        ? 'Ese ZIP no parece correcto. Por favor escriba un ZIP de 5 dígitos para mantener la información relacionada con su área.'
        : "That ZIP code doesn't look right. Please enter a 5-digit ZIP code so I can keep the information relevant to your area.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // Path B: user refused ZIP — "no", "no quiero", "skip", "prefiero no".
    if (/^(no|nope|no quiero|prefiero no|no s[eé]|skip|paso|m[aá]s tarde|later|prefer not|i'?d rather not|no thanks|no gracias)\.?$/i.test(trimmed)
        || /\b(no quiero (decir|dar|compartir)|prefiero no decir|i (don'?t|do not) want to (share|give)|prefer not to (share|say)|no s[eé] (mi |el |my )?(zip|c[oó]digo|zip code)|i don'?t know my zip|i forgot my zip|i forget my zip)\b/i.test(trimmed)) {
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
    // Wave 34 — mark hasRealIssue when problemType is a recognized topic.
    // This unlocks Case B recovery and prevents profanity/nonsense from
    // being treated as a known case.
    if (problemType && problemType !== 'general' && problemType !== 'casual') {
      newState.hasRealIssue = true;
      // Real input → recovery stage no longer applies; clear it so a future
      // frustration after a real topic restarts at Case B stage 1.
      newState.recoveryStage = 0;
    }
    // ──────────────────────────────────────────────────────────────────────
    // WAVE 30 — TOPIC-LESS GENERAL VAGUE
    //
    // "tengo problemas" / "I have problems" without a topic noun → ask one
    // natural general clarification (no chips, no Medicare education).
    // Fires only if not already mid-clarification and not in handoff.
    // ──────────────────────────────────────────────────────────────────────
    if (!newState.pendingAdvisorHandoff
        && !newState.serviceCategory
        && detectGeneralVague(userMessage)) {
      const out = getGeneralClarification(isSpanish);
      newState.lastBotQuestion = out;
      newState.subIssue = 'general_vague';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

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
      // V33 — let the Wave 33 letter triage state machine handle letters
      // (it parses sender + type properly). V28 vague clarification asked the
      // right question but never set letterSender, breaking turn-2 routing.
      const letV33Handle = vague.topic === 'letter';
      if (vague.isVague && vague.topic && !lastWasSameClarification && !letV33Handle) {
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
    // ──────────────────────────────────────────────────────────────────────
    // WAVE 31 — DRUG ACTIVE-CATEGORY OVERRIDE (mirrors V26 doctor override).
    //
    // If the user is already in a medication conversation, short/vague
    // follow-ups ("no", "the pharmacy", "too expensive") classify as
    // 'general' or 'cost_basics' on their own. Pin problemType=drug so the
    // Wave 31 medication triage handler can answer them.
    //
    // Exception: explicit topic switches like "letter from Medicare" or
    // "I want to change my plan" are allowed to win.
    // ──────────────────────────────────────────────────────────────────────
    if (newState.serviceCategory === 'drug'
        && (problemType === 'general' || problemType === 'coverage'
            || problemType === 'casual' || problemType === 'cost_basics')) {
      const hasStrongSwitchSignal =
        /\b(letter|carta|bill|factura|doctor|provider|enroll|inscribir|change my plan)\b/i.test(userMessage)
        && !/\b(medication|pharmacy|medicina|farmacia|prescription|rx|copay|extra help|prior auth)\b/i.test(userMessage);
      if (!hasStrongSwitchSignal) {
        problemType = 'drug';
        newState.intent = 'drug';
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
      // WAVE 44 — strip the captured ZIP from history BEFORE amount/source
      // detection so "07407" never reads as "$7,407".
      let history = fullUserHistory(newState, userMessage);
      if (newState.zipCode) {
        history = history.replace(new RegExp(`\\b${newState.zipCode}\\b`, 'g'), ' ');
      }
      // billSource is only captured when there is also an explicit bill/
      // charge keyword in history. Without this, "tengo problemas con mis
      // medicinas y doctores" sets billSource='provider' purely from the
      // word "doctores", which then triggers the invented-bill response.
      const _historyHasBillKw = /\b(factura|cobro|cobraron|cobr[oó]|charge|charged|bill|owe|debo|copay|copago|premium|prima|deductible|deducible|amount due|balance due|\$\d)\b/i.test(history);
      if (_historyHasBillKw) {
        const newSource = detectBillSource(history);
        if (newSource && !newState.billSource) newState.billSource = newSource;
      }
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
    if (emotion === 'urgent'
        // WAVE 42 — skip the urgent emotional handler if a specific event
        // (past ER visit, telehealth, etc.) was already classified.
        && problemType !== 'er_hospital_visit'
        && problemType !== 'telehealth'
        && problemType !== 'urgent_medication'
        && problemType !== 'medical_emergency_911'
        && problemType !== 'fraud_scam') {
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
    // ──────────────────────────────────────────────────────────────────────
    // WAVE 31 — MEDICATION TRIAGE STATE MACHINE
    //
    // Fires when serviceCategory is 'drug' AND we're already in a medication
    // conversation (V28 fired clarification OR medication state exists). Maps
    // short / vague / Spanglish answers to 14 typed categories and tracks
    // askedQuestions to avoid repeats. After 2 vague repeats → advisor offer.
    // ──────────────────────────────────────────────────────────────────────
    const inMedicationFlow = (newState.serviceCategory === 'drug')
      && (newState.subIssue === 'vague_report'
          || !!newState.medicationIssueType
          || (newState.askedQuestions || []).some((q) => q.startsWith('med_')));
    if (problemType === 'drug' && (inMedicationFlow || newState.medicationIssueType)) {
      newState.askedQuestions = newState.askedQuestions || [];
      const medAns = detectMedicationAnswer(userMessage);

      // (N) Wants advisor → immediate handoff (sets pending advisor flag,
      //     reuses the existing advisor handler below).
      if (medAns.category === 'wants_advisor') {
        problemType = 'advisor';
        newState.advisorHandoffReason = newState.advisorHandoffReason
          || `medication_${newState.medicationIssueType || 'unclear'}`;
        // Fall through — advisor handler runs naturally below.
      } else if (medAns.category === 'switch_language') {
        // Language switch mid-flow — flip language but PRESERVE topic.
        const wantEs = /espa[ñn]ol|spanish|no entiendo ingl[eé]s|h[aá]bla.*espa[ñn]ol/i.test(userMessage);
        if (wantEs && newState.language === 'en') newState.language = 'es';
        if (!wantEs && newState.language === 'es') newState.language = 'en';
        // Re-issue the most recent medication question in the new language.
        const newIsEs = newState.language === 'es';
        const out = newIsEs
          ? 'Claro, seguimos en español. ¿Le siguen pidiendo verificar lo del medicamento — el costo, la cobertura o lo que pasó en la farmacia?'
          : "Of course, let's continue in English. Should we keep checking the medication — the cost, the coverage, or what happened at the pharmacy?";
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      } else if (medAns.category === 'short_no' && newState.askedQuestions.includes('med_pharmacy_reason')) {
        // (C-resolution) "no" after we asked the pharmacy-reason question —
        // offer advisor (Sawil's exact required behavior).
        newState.advisorHandoffReason = 'medication_pharmacy_rejected_unclear';
        newState.needsHuman = true;
        const out = isSpanish
          ? 'No hay problema. Un asesor licenciado de ClearPoint puede ayudar a revisar qué pasó en la farmacia. Por favor no envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos privados aquí. ¿Le gustaría que un asesor le contacte?'
          : "No problem. A ClearPoint licensed advisor can help review what happened at the pharmacy. Please don't send Medicare ID, SSN, banking information, or private medical records here. Would you like an advisor to follow up?";
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      } else if (medAns.category === 'short_idk') {
        // "I don't know" / "no sé" — simplify + offer advisor.
        newState.medicationFailedClarifications = (newState.medicationFailedClarifications || 0) + 1;
        newState.advisorHandoffReason = 'medication_user_unsure';
        newState.needsHuman = true;
        const out = isSpanish
          ? 'No hay problema. Un asesor licenciado puede revisar los detalles directamente con la farmacia y el plan. ¿Le gustaría que un asesor le contacte?'
          : 'No problem. A licensed advisor can review the details directly with the pharmacy and plan. Would you like an advisor to follow up?';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      } else if (medAns.category === 'ambiguous' && medAns.hint === 'cover_or_price') {
        // "they don't want to pay" — Sawil's exact failing phrase.
        if (newState.askedQuestions.includes('med_pharmacy_vs_price')) {
          // Already asked — escalate to advisor instead of repeating.
          newState.medicationFailedClarifications = (newState.medicationFailedClarifications || 0) + 1;
          newState.advisorHandoffReason = 'medication_repeated_vague';
          newState.needsHuman = true;
          const out = isSpanish
            ? 'Entiendo. Mejor lo organizamos con un asesor licenciado de ClearPoint para que revise los detalles con la farmacia y el plan. ¿Le contactamos?'
            : 'I understand. Let me get a ClearPoint licensed advisor to review the details with the pharmacy and plan. Want them to follow up?';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: true };
        }
        newState.askedQuestions.push('med_pharmacy_vs_price');
        const q = isSpanish
          ? 'Entiendo. ¿La farmacia lo rechazó, o sí lo procesó pero el precio salió muy alto?'
          : 'Got it. Did the pharmacy reject it, or did it go through but the price was too high?';
        newState.lastBotQuestion = q;
        newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
        return { response: q, newState, needsHuman: false };
      } else if (medAns.category === 'pharmacy_rejected') {
        newState.medicationIssueType = 'pharmacy_rejected';
        if (newState.askedQuestions.includes('med_pharmacy_reason')) {
          // Already asked the reason — escalate.
          newState.advisorHandoffReason = 'medication_pharmacy_rejected_repeated';
          newState.needsHuman = true;
          const out = isSpanish
            ? 'Lo organizamos con un asesor licenciado. Pueden hablar con la farmacia y el plan para confirmar el motivo del rechazo. ¿Le gustaría que un asesor le contacte?'
            : 'Let me organize this with a licensed advisor. They can talk to the pharmacy and plan to confirm the reason for the rejection. Want them to follow up?';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: true };
        }
        newState.askedQuestions.push('med_pharmacy_reason');
        const q = isSpanish
          ? 'Entendido. ¿La farmacia le dio una razón — autorización previa, no cubierto, muy pronto para reabastecer, o límite de cantidad?'
          : 'Understood. Did the pharmacy give a reason — like prior authorization, not covered, refill too soon, or quantity limit?';
        newState.lastBotQuestion = q;
        newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
        return { response: q, newState, needsHuman: false };
      } else if (medAns.category === 'cost_too_high') {
        newState.medicationIssueType = 'cost_too_high';
        newState.advisorHandoffReason = 'medication_cost_too_high';
        const out = isSpanish
          ? 'Anotado — costo alto. No puedo confirmar el copago aquí, pero un asesor licenciado puede revisar el formulario del plan, opciones en otra farmacia, si aplica Extra Help, o una alternativa cubierta. ¿Le gustaría que un asesor le contacte?'
          : "Got it — cost too high. I can't confirm the copay here, but a licensed advisor can review the plan formulary, pharmacy options, whether Extra Help applies, or a covered alternative. Would you like an advisor to follow up?";
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      } else if (medAns.category === 'prior_auth') {
        newState.medicationIssueType = 'prior_auth';
        newState.advisorHandoffReason = 'medication_prior_auth';
        const out = isSpanish
          ? 'Entiendo — autorización previa. El plan necesita información del médico antes de cubrir el medicamento. Un asesor licenciado puede coordinar eso con el doctor y el plan. ¿Le gustaría que un asesor le contacte?'
          : 'I understand — prior authorization. The plan needs information from the doctor before covering the medication. A licensed advisor can coordinate that with the doctor and the plan. Would you like an advisor to follow up?';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      } else if (medAns.category === 'step_therapy') {
        newState.medicationIssueType = 'step_therapy';
        newState.advisorHandoffReason = 'medication_step_therapy';
        const out = isSpanish
          ? 'Anotado — terapia escalonada. El plan a veces pide probar otro medicamento primero. Un asesor licenciado puede revisar si aplica una excepción. ¿Le contactamos?'
          : 'Got it — step therapy. The plan may require trying another medication first. A licensed advisor can review whether an exception applies. Want them to follow up?';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      } else if (medAns.category === 'quantity_limit') {
        newState.medicationIssueType = 'quantity_limit';
        newState.advisorHandoffReason = 'medication_quantity_limit';
        const out = isSpanish
          ? 'Anotado — límite de cantidad. Un asesor licenciado puede revisar si se puede solicitar una excepción al límite. ¿Le contactamos?'
          : 'Got it — quantity limit. A licensed advisor can review whether a limit-exception can be requested. Want them to follow up?';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      } else if (medAns.category === 'refill_too_soon') {
        newState.medicationIssueType = 'refill_too_soon';
        newState.advisorHandoffReason = 'medication_refill_too_soon';
        const out = isSpanish
          ? 'Anotado — reabastecimiento muy pronto. Esto suele resolverse con la farmacia o pidiendo una excepción al plan. Un asesor licenciado puede ayudarle a coordinarlo. ¿Le contactamos?'
          : 'Got it — refill too soon. This usually resolves with the pharmacy or by requesting a plan exception. A licensed advisor can help coordinate. Want them to follow up?';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      } else if (medAns.category === 'letter_received') {
        newState.medicationIssueType = 'letter_received';
        const q = isSpanish
          ? 'Entiendo. ¿La carta es del plan, de Medicare, de Medicaid, de Social Security o de la farmacia?'
          : 'I understand. Is the letter from the plan, Medicare, Medicaid, Social Security, or the pharmacy?';
        newState.lastBotQuestion = q;
        newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
        return { response: q, newState, needsHuman: false };
      } else if (medAns.category === 'short_no') {
        // Generic "no" without pharmacy_reason context — increment failed
        // clarifications. After 2, offer advisor.
        newState.medicationFailedClarifications = (newState.medicationFailedClarifications || 0) + 1;
        if ((newState.medicationFailedClarifications || 0) >= 2) {
          newState.advisorHandoffReason = 'medication_repeated_vague';
          newState.needsHuman = true;
          const out = isSpanish
            ? 'Entiendo. No quiero seguir preguntando lo mismo. Un asesor licenciado de ClearPoint puede revisar el caso con la farmacia y el plan. ¿Le contactamos?'
            : "I understand. I don't want to keep asking the same thing. A ClearPoint licensed advisor can review with the pharmacy and plan. Want them to follow up?";
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: true };
        }
        // Else: fall through to V29 logic which may catch it differently.
      }
    }

    // V29 — drug "not covered" continuation. Fires when active category is
    // drug and user message indicates coverage denial.
    if (problemType === 'drug') {
      const msgLowDrug = normalizeText(userMessage);
      const notCovered = (/\b(don'?t.{0,20}cover|do not.{0,20}cover|not covered|denied|deny|wouldn'?t.{0,20}cover|won'?t.{0,20}cover|won t.{0,20}cover|negaron|denegaron)\b/i.test(msgLowDrug)
        || /\bno.{0,25}cubr/i.test(msgLowDrug)
        || /\bno (la |las |me |se )?cubre/i.test(msgLowDrug));
      const priorAuth = /\b(prior auth|prior authorization|autorizaci[oó]n previa|preauth|pa required|requires pa|necesita autorizaci[oó]n)\b/i.test(msgLowDrug);
      if (notCovered || priorAuth) {
        newState.serviceCategory = 'drug';
        newState.routingLevel = 'B';
        newState.subIssue = priorAuth ? 'drug_prior_auth' : 'drug_not_covered';
        const out = isSpanish
          ? (priorAuth
            ? 'Eso puede ser un tema de autorización previa. A veces el plan necesita información del médico antes de cubrir la medicina.\n\n¿La farmacia mencionó autorización previa, o recibió una carta del plan?'
            : 'Entiendo. Eso puede ser que la medicina no esté cubierta o que necesite revisión. ¿Se lo dijo la farmacia, o recibió una carta del plan?')
          : (priorAuth
            ? "That may be a prior authorization issue. The plan usually needs more information from the prescriber before covering it.\n\nDid the pharmacy mention prior authorization, or did you get a letter from the plan?"
            : "Got it. That sounds like the medication may not be covered or may need review. Did the pharmacy say it was not covered, or did you receive a letter from the plan?");
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
    }

    // V29 — skip drug-first-turn handler if V28 clarification already fired
    // (subIssue=vague_report). Let V29 default fallback ask a category-specific
    // follow-up to avoid repeating the same question.
    if (problemType === 'drug' && !newState.billSource && !newState.amountMentioned
        && newState.subIssue !== 'vague_report') {
      const out = isSpanish
        ? `Sobre medicamentos${withName(newState.name)}. ¿El problema es el costo, que no está cubierto, o necesita autorización previa? Un asesor licenciado debe verificar el formulario y la farmacia antes de cualquier decisión.`
        : `About medications${withName(newState.name)}. Is the issue the cost, not covered, or prior authorization? A licensed advisor must verify the formulary and pharmacy before any decision.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // WAVE 44 — bill+drug source-asking handler MUST verify the user actually
    // mentioned a bill / charge / amount, not just that detectBillSource
    // matched "doctor" or "pharmacy" anywhere in history. Without this, the
    // phrase "TENGO PROBLEMAS CON MIS MEDICINAS Y DOCTORES" routes to
    // "Parece que la factura viene del médico..." which invents a bill the
    // user never mentioned (Sawil's live bug).
    const _billKwInThisMsg = /\b(factura|facturas|cobro|cobros|cobr[oó]|cobraron|charge|charged|charges|bill|bills|owe|debo|adeudo|copay|copago|premium|prima|deductible|deducible|amount due|balance due|patient responsibility|\$\d)\b/i.test(userMessage);
    const _userMentionedBill = problemType === 'bill'
      || newState.amountMentioned
      || _billKwInThisMsg
      // history-based billSource is only a tie-breaker — alone it is not
      // enough because detectBillSource matches "doctor" / "pharmacy" even
      // outside of bill context.
      || (newState.billSource && _billKwInThisMsg);
    if ((problemType === 'bill' || problemType === 'drug') && _userMentionedBill) {
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

      // No source captured yet — ask the source question ONCE.
      // V29 — but only if we haven't already asked it (loop prevention) AND
      // the user isn't just sending vague continuations after V28 clarification.
      const sourceQuestion = isSpanish
        ? `Entiendo${withName(newState.name)}. ¿Esta factura es del médico u hospital, de la farmacia, o del plan de Medicare? Por favor no envíe Medicare ID, Seguro Social, ni datos bancarios aquí.`
        : `Got it${withName(newState.name)}. Is this bill from a doctor or hospital, a pharmacy, or your Medicare plan? Please do not send Medicare ID, Social Security, or banking info here.`;
      if (newState.lastBotQuestion === sourceQuestion || newState.subIssue === 'vague_report') {
        // Already asked or in clarification flow — fall through to V29
        // default fallback which gives a category-specific follow-up.
      } else {
        newState.lastBotQuestion = sourceQuestion;
        newState.messages.push({ role: 'bot', content: sourceQuestion, timestamp: Date.now() });
        return { response: sourceQuestion, newState, needsHuman: false };
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // WAVE 33 — LETTER TRIAGE STATE MACHINE
    //
    // Sawil V33 spec:
    //   Step 1: ¿La carta vino de Medicare / Seguro Social / Medicaid / plan?
    //   Step 2: ¿Es sobre renovación / cancelación / pago / penalidad /
    //           cambio de cobertura?
    // ────────────────────────────────────────────────────────────────────
    if (problemType === 'letter') {
      newState.serviceCategory = 'letter';
      newState.askedQuestions = newState.askedQuestions || [];
      const letAns = detectLetterAnswer(userMessage);

      if (letAns.category === 'wants_advisor') {
        newState.advisorHandoffReason = `letter_${newState.letterIssueType || 'unclear'}`;
        newState.needsHuman = true;
        const out = isSpanish
          ? 'Claro. Un asesor licenciado de ClearPoint puede revisar la carta con usted. Por favor no envíe número de Medicare, Seguro Social, ni fotos con datos sensibles. ¿Le contactamos?'
          : "Of course. A ClearPoint licensed advisor can review the letter with you. Please don't send your Medicare number, SSN, or photos with sensitive details. Want them to follow up?";
        newState.lastBotIntent = 'letter_advisor';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      }

      // Identify SENDER first if we don't know it yet.
      if (!newState.letterSender || newState.letterSender === 'unknown') {
        if (letAns.category === 'medicare') newState.letterSender = 'medicare';
        else if (letAns.category === 'medicaid') newState.letterSender = 'medicaid';
        else if (letAns.category === 'social_security') newState.letterSender = 'social_security';
        else if (letAns.category === 'plan') newState.letterSender = 'plan';
      }

      // If we still don't have a sender, ask.
      if (!newState.letterSender && !newState.askedQuestions.includes('letter_sender')) {
        newState.askedQuestions.push('letter_sender');
        const q = isSpanish
          ? 'Entiendo. ¿La carta vino de Medicare, Seguro Social, Medicaid, o de su plan?'
          : 'I understand. Did the letter come from Medicare, Social Security, Medicaid, or your plan?';
        newState.lastBotQuestion = q;
        newState.lastBotIntent = 'letter_sender';
        newState.quickReplies = isSpanish
          ? ['Medicare', 'Seguro Social', 'Medicaid', 'Mi plan', 'Hablar con asesor']
          : ['Medicare', 'Social Security', 'Medicaid', 'My plan', 'Talk to advisor'];
        newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
        return { response: q, newState, needsHuman: false };
      }

      // If we know sender, classify TYPE if present in this turn.
      if (newState.letterSender) {
        if (letAns.category === 'renewal') newState.letterIssueType = 'renewal';
        else if (letAns.category === 'cancellation') newState.letterIssueType = 'cancellation';
        else if (letAns.category === 'termination') newState.letterIssueType = 'termination';
        else if (letAns.category === 'premium_bill') newState.letterIssueType = 'premium_bill';
        else if (letAns.category === 'late_penalty') newState.letterIssueType = 'late_enrollment_penalty';
        else if (letAns.category === 'extra_help') newState.letterIssueType = 'lis_extra_help';
        else if (letAns.category === 'msp') newState.letterIssueType = 'msp';
        else if (letAns.category === 'coverage_change') newState.letterIssueType = 'plan_notice';

        // If we know both sender and type → advisor handoff with summary.
        if (newState.letterIssueType) {
          newState.advisorHandoffReason = `letter_${newState.letterSender}_${newState.letterIssueType}`;
          const out = isSpanish
            ? `Anotado — carta de ${spanishSenderLabel(newState.letterSender)} sobre ${spanishLetterTypeLabel(newState.letterIssueType)}. Un asesor licenciado puede revisarla con usted. Por favor no envíe número de Medicare, Seguro Social ni fotos con datos sensibles. ¿Le contactamos?`
            : `Got it — a letter from ${englishSenderLabel(newState.letterSender)} about ${englishLetterTypeLabel(newState.letterIssueType)}. A licensed advisor can review it with you. Please don't send Medicare ID, SSN, or photos with sensitive details. Want them to follow up?`;
          newState.lastBotIntent = 'letter_summary_advisor';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: false };
        }

        // We know sender but not type → ask type.
        if (!newState.askedQuestions.includes('letter_type')) {
          newState.askedQuestions.push('letter_type');
          const q = isSpanish
            ? '¿Parece ser sobre renovación, cancelación, pago/prima, penalidad, o cambio de cobertura?'
            : 'Does it seem to be about renewal, cancellation, payment/premium, penalty, or a coverage change?';
          newState.lastBotQuestion = q;
          newState.lastBotIntent = 'letter_type';
          newState.quickReplies = isSpanish
            ? ['Renovación', 'Cancelación', 'Pago/Prima', 'Penalidad', 'Cambio de cobertura']
            : ['Renewal', 'Cancellation', 'Payment/Premium', 'Penalty', 'Coverage change'];
          newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
          return { response: q, newState, needsHuman: false };
        }
      }

      // Fallback: short_idk or vague second answer → advisor.
      if (letAns.category === 'short_idk' || letAns.category === 'unknown') {
        newState.advisorHandoffReason = 'letter_user_unsure';
        newState.needsHuman = true;
        const out = isSpanish
          ? 'No hay problema. Un asesor licenciado puede revisar la carta con usted y aclarar lo que dice. ¿Le contactamos?'
          : 'No problem. A licensed advisor can review the letter with you and clarify what it says. Want them to follow up?';
        newState.lastBotIntent = 'letter_idk_advisor';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      }
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
    // WAVE 49 — Extra Help / LIS / Medicare Savings Programs. Real Medicare
    // assistance programs. Bot must NEVER confirm eligibility (CMS compliance
    // — eligibility depends on income, assets, household). Gives general info
    // and routes to licensed advisor.
    if (problemType === 'savings_program') {
      newState.serviceCategory = 'savings_program';
      const out = isSpanish
        ? `Entiendo. Hay varios programas que pueden bajar los costos de Medicare: **Extra Help / LIS** (ayuda con copagos de medicinas), **MSP** (Medicare Savings Programs — QMB, SLMB, QI — ayuda con la prima de la Parte B y a veces más), y en algunos estados programas locales. La elegibilidad depende de sus ingresos, sus activos, y el estado donde vive. Aquí no puedo confirmar su elegibilidad — eso lo verifica un asesor licenciado o Medicaid del estado, sin costo. ¿Quiere que un asesor le llame para revisarlo?`
        : `I understand. Several programs can lower Medicare costs: **Extra Help / LIS** (helps with drug copays), **MSP** (Medicare Savings Programs — QMB, SLMB, QI — helps with the Part B premium and sometimes more), and in some states local programs. Eligibility depends on income, assets, and the state you live in. I can't confirm your eligibility here — a licensed advisor or your state Medicaid office can verify that, at no cost. Would you like an advisor to call and review it?`;
      newState.quickReplies = isSpanish
        ? ['Sí, llamar asesor', 'No, otra cosa']
        : ['Yes, call advisor', 'No, something else'];
      newState.lastBotIntent = 'savings_program_info';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 47 — plan recommendation question. CMS TPMO compliance: bot must
    // NEVER recommend a specific plan or affirm that a given plan is best. We
    // explain why, then offer a licensed-advisor consultation.
    if (problemType === 'plan_recommendation') {
      newState.serviceCategory = 'plan_recommendation';
      const out = isSpanish
        ? `Entiendo. No puedo recomendarle aquí un plan específico porque depende de su doctor, sus medicinas, sus condados, y sus prioridades — y eso lo regula CMS. Lo correcto es que un **asesor licenciado** de ClearPoint revise sus opciones con usted, sin costo y sin presión. ¿Le coordino esa llamada?`
        : `I understand. I can't recommend a specific plan here — it depends on your doctor, your drugs, your county, and your priorities, and that's regulated by CMS. The right step is for a **licensed advisor** at ClearPoint to review your options with you, at no cost and no pressure. Want me to set up that call?`;
      newState.quickReplies = isSpanish
        ? ['Sí, llamar asesor', 'No, otra cosa']
        : ['Yes, call advisor', 'No, something else'];
      newState.lastBotIntent = 'plan_recommendation_deflect';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'appeal') {
      newState.serviceCategory = 'appeal';
      // WAVE 47 — lead-qualification pivot. ClearPoint is not an appeal
      // clinic. Brief acknowledgment + check whether they are an existing
      // client; if yes, hand off to their assigned advisor; if no, pivot
      // toward reviewing plan options that may cover the issue better.
      if (!newState.existingClientAsked) {
        newState.existingClientAsked = true;
        const out = isSpanish
          ? `Entiendo. Una apelación o denegación de cobertura es un tema serio que normalmente requiere un asesor licenciado. Antes de seguir, ¿es usted cliente actual de **ClearPoint Senior Advisors**, o nos contacta por primera vez?`
          : `I understand. An appeal or coverage denial is a serious matter that usually needs a licensed advisor. Before we go on, are you a current **ClearPoint Senior Advisors** client, or is this your first time reaching out?`;
        newState.quickReplies = isSpanish
          ? ['Sí, soy cliente', 'No, soy nuevo', 'Solo información']
          : ['Yes, I am a client', "No, I'm new", 'Just info'];
        newState.lastBotIntent = 'lead_qual_existing_client_gate';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // Second time the appeal topic comes up — pivot to plan options if no
      // existing-client answer yet.
      if (!newState.planChangePushMade) {
        newState.planChangePushMade = true;
        const out = isSpanish
          ? `Anotado. Aquí no resolvemos apelaciones — su plan o un asesor de su carrier maneja eso. Lo que sí podemos hacer: un asesor licenciado puede revisar **opciones de plan** que cubran mejor lo que necesita (por ejemplo, esta cirugía). Sin costo. ¿Le coordino esa llamada?`
          : `Got it. We don't handle appeals here — your plan or a carrier advisor manages that. What we CAN do: a licensed advisor can review **plan options** that may cover what you need better (like this surgery). No cost. Want to set up that call?`;
        newState.quickReplies = isSpanish
          ? ['Sí, revisar opciones', 'No, otra cosa']
          : ['Yes, review options', 'No, something else'];
        newState.lastBotIntent = 'plan_change_push';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
      // Already pushed plan options once — rotate through a few variants so
      // we never repeat the exact same sentence (loop-guard defense).
      newState.appealFallbackVariant = ((newState.appealFallbackVariant || 0) + 1) % 3;
      const v = newState.appealFallbackVariant;
      const esVariants = [
        `Como mencioné, no resolvemos apelaciones aquí. Si quiere revisar planes alternativos, un asesor le puede ayudar. Si prefiere seguir con su plan actual, eso lo coordinan con el carrier directamente.`,
        `Entiendo que es frustrante. Lo único que hacemos en este chat es información general — la apelación misma va por su plan. Si quiere que un asesor le llame para mirar opciones, dígame "sí" y empezamos.`,
        `Para no dar vueltas: en este chat no puedo cambiar la decisión del plan. Lo que sí podemos: un asesor licenciado revisa con usted si hay otro plan que cubra lo que necesita. ¿Quiere esa llamada?`,
      ];
      const enVariants = [
        `As I mentioned, we don't handle appeals here. If you want to review alternative plans, an advisor can help. If you prefer to stay with your current plan, that's coordinated with the carrier directly.`,
        `I get the frustration. This chat only does general info — the appeal itself goes through your plan. If you'd like an advisor to call and look at alternative plans, just say "yes" and we'll start.`,
        `So we don't go in circles: I can't change the plan's decision from this chat. What I CAN do is have a licensed advisor review whether another plan covers what you need. Want that call?`,
      ];
      const out = isSpanish ? esVariants[v] : enVariants[v];
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
      newState.askedQuestions = newState.askedQuestions || [];

      // ────────────────────────────────────────────────────────────────────
      // WAVE 45 — sí/yes confirmation AFTER advisor offer must start handoff,
      // not loop back to the first provider question. Bug: after bot said
      // "¿Quiere que coordine eso?" user "si por favor" was re-routed to
      // detectProblemType, came back as 'casual'/'general', and the V26/V27
      // fallback re-asked "¿Es problema con el especialista...?".
      // Detect a bot advisor offer in lastBotQuestion / lastBotIntent.
      // ────────────────────────────────────────────────────────────────────
      const _yesPattern = /^(si|sí|s[ií]\s+(por favor|claro|gracias)|yes|yeah|yep|sure|ok|okay|of course|please|por favor|claro|adelante|h[aá]galo)\.?$/i;
      const _userSaidYes = _yesPattern.test(userMessage.trim());
      // Look at the actual last bot message (the user just replied to it).
      const _lastBot = [...(newState.messages || [])].reverse().find((m) => m.role === 'bot');
      const _lastBotText = (_lastBot?.content || newState.lastBotPrompt || newState.lastBotQuestion || '').toLowerCase();
      const _botJustOfferedAdvisor = /asesor licenciado|licensed advisor|coordin[eo] eso|quiere que (un )?asesor|le contact|le gustar[ií]a que (un )?asesor|want (them|an? advisor) to follow up|set (that|it) up|coordino eso|que coordine eso/i.test(_lastBotText);
      if (_userSaidYes && _botJustOfferedAdvisor) {
        newState.advisorHandoffStarted = true;
        newState.needsHuman = true;
        newState.advisorHandoffReason = newState.advisorHandoffReason
          || `provider_${newState.providerIssueType || newState.subIssue || 'unclear'}_user_consented`;
        const out = isSpanish
          ? `Perfecto. Un asesor licenciado de ClearPoint le va a contactar. Por favor no envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos privados aquí. ¿Cuál es su nombre y un teléfono donde le puedan llamar?`
          : `Perfect. A ClearPoint licensed advisor will contact you. Please don't send Medicare ID, SSN, banking information, or private medical records here. What's your name and a phone number where they can reach you?`;
        newState.lastBotIntent = 'provider_advisor_handoff_start';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      }

      // ────────────────────────────────────────────────────────────────────
      // WAVE 32 — PROVIDER ACCESS TRIAGE STATE MACHINE
      //
      // Fires for the Sawil case: "mi doctor no quiere aceptarme".
      // Branches by detectProviderAnswer category. Tracks askedQuestions so
      // repeats escalate to advisor instead of looping.
      // ────────────────────────────────────────────────────────────────────
      // V26 "left network" patterns (past-tense "ya no acepta", "no longer
      // accepts") belong to V26's provider_left_network flow — skip Wave 32.
      const looksLikeLeftNetwork =
        /\b(no longer|stopped|left|dropped|out of (the |my )?(network|plan)|ya no acepta|ya no trabaja|ya no recibe|sali[oó] de|dej[oó] (de )?(aceptar|trabajar))\b/i.test(userMessage);
      const isProviderAccessSignal = !looksLikeLeftNetwork
        && (/\b(no (me )?(quiere|quieren)\s+(aceptar|recibir|ver|atender)(me)?|no me (acepta|aceptan|recibe|reciben|ven|atiende|atienden)|no (acepta|aceptan|recibe|reciben|coge|cogen|toma|toman)\s+(mi|el)\s+(plan|seguro|aseguranza|medicare))\b/i.test(userMessage)
            || /\b((doesn'?t|does not|won'?t|will not|wouldn'?t|would not|refuses to|refused to)\s+(accept|take|see|treat)\s+(me|my (insurance|plan|medicare)))\b/i.test(userMessage));
      const inProviderTriage = !!newState.providerIssueType
        || (newState.askedQuestions || []).some((q) => q.startsWith('provider_'));

      // ────────────────────────────────────────────────────────────────────
      // WAVE 33 — 3-TIER PROVIDER REPETITION (Sawil spec verbatim)
      //   · 1st turn: first-time provider triage question (below)
      //   · 2nd turn (1st repeat): "Ya tengo esa parte. Para seguir sin
      //     repetir: ¿es doctor primario o especialista?"
      //   · 3rd turn (2nd repeat): advisor offer + PHI warning
      // ────────────────────────────────────────────────────────────────────
      const repCount = newState.repeatedUserMessageCount || 0;
      const alreadyAskedProvider = newState.askedQuestions.includes('provider_primary_or_specialist')
        || newState.askedQuestions.includes('provider_office_said_no_or_checking')
        || newState.askedQuestions.includes('provider_appointment_soon');

      if (repCount >= 2 && alreadyAskedProvider) {
        // 3rd tier — advisor handoff + PHI guardrail.
        newState.advisorHandoffReason = 'provider_repeated_twice';
        newState.needsHuman = true;
        const out = isSpanish
          ? 'Vamos a hacerlo más fácil. Un asesor licenciado de ClearPoint puede revisarlo con usted, llamar al consultorio y verificar la red del plan. Por favor no envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos privados aquí. ¿Quiere que un asesor le contacte?'
          : "Let's make this easier. A ClearPoint licensed advisor can review it with you, call the office, and verify the plan network. Please don't send Medicare ID, SSN, banking information, or private medical records here. Would you like an advisor to follow up?";
        newState.lastBotIntent = 'provider_advisor_offer';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: true };
      }
      if (repCount >= 1 && alreadyAskedProvider) {
        // 2nd tier — short ack, do NOT repeat the first paragraph.
        const out = selectPhrase('provider_repeat_short_ack', newState);
        newState.quickReplies = isSpanish
          ? ['Doctor primario', 'Especialista', 'No estoy seguro', 'Hablar con asesor']
          : ['Primary doctor', 'Specialist', "I'm not sure", 'Talk to advisor'];
        newState.lastBotIntent = 'provider_repeat_short_ack';
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // First-turn provider-access (Sawil's exact case) — short, focused
      // triage question. Only fires when neither V27 told-to-change nor V26
      // provider_left_network sub-flows already claimed the conversation.
      if (isProviderAccessSignal
          && !newState.providerIssueType
          && !newState.askedQuestions.includes('provider_primary_or_specialist')
          && newState.subIssue !== 'told_to_change_plan'
          && newState.subIssue !== 'provider_left_network'
          && !newState.doesNotWantPlanChange) {
        newState.providerIssueType = 'provider_access_issue';
        newState.subIssue = 'provider_access_issue';
        newState.askedQuestions.push('provider_primary_or_specialist');
        noteFact(newState, isSpanish ? 'Problema con doctor/proveedor.' : 'Doctor/provider access issue.');
        // WAVE 43 — humanize: opener (frustrated/etc.) + echo if user
        // named a specific provider type ("cardiólogo / specialist"). The
        // phrase bank variant already contains "primario/especialista" so
        // existing regex tests still pass.
        const _baseProv = selectPhrase('provider_first_ask', newState);
        const q = composeHumanResponse(newState, userMessage, _baseProv,
          { skipEcho: true /* base already mentions doctor */ });
        newState.quickReplies = isSpanish
          ? ['Doctor primario', 'Especialista', 'No estoy seguro', 'Hablar con asesor']
          : ['Primary doctor', 'Specialist', "I'm not sure", 'Talk to advisor'];
        newState.lastBotQuestion = q;
        newState.lastBotIntent = 'provider_primary_or_specialist';
        newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
        return { response: q, newState, needsHuman: false };
      }

      // Continuation: provider-triage already started → parse short answer.
      if (inProviderTriage || newState.providerIssueType === 'provider_access_issue') {
        const provAns = detectProviderAnswer(userMessage);

        if (provAns.category === 'wants_advisor') {
          newState.advisorHandoffReason = newState.advisorHandoffReason
            || `provider_${newState.providerIssueType || 'unclear'}`;
          newState.needsHuman = true;
          const out = isSpanish
            ? 'Claro. Un asesor licenciado de ClearPoint puede revisar el caso, contactar al consultorio y verificar la red del plan. Por favor no envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos privados aquí. ¿Cuál es el mejor momento para que le llamen?'
            : "Of course. A ClearPoint licensed advisor can review the case, contact the office, and verify the plan network. Please don't send Medicare ID, SSN, banking information, or private medical records here. What's the best time for them to call?";
          newState.lastBotIntent = 'provider_advisor_handoff';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: true };
        }

        if (provAns.category === 'switch_language') {
          const wantEs = /espa[ñn]ol|spanish|no entiendo ingl[eé]s|h[aá]bla.*espa[ñn]ol|mi (mom|mama|mami) (speaks|habla)/i.test(userMessage);
          if (wantEs && newState.language === 'en') newState.language = 'es';
          if (!wantEs && newState.language === 'es') newState.language = 'en';
          const newIsEs = newState.language === 'es';
          const out = newIsEs
            ? 'Claro, seguimos en español. ¿Es su doctor primario o un especialista?'
            : "Of course, let's continue in English. Is this your primary doctor or a specialist?";
          newState.quickReplies = [];
          newState.lastBotIntent = 'provider_lang_switch';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: false };
        }

        if (provAns.category === 'primary_doctor_not_accepting') {
          newState.providerIssueType = 'primary_doctor_not_accepting';
          if (newState.askedQuestions.includes('provider_office_said_no_or_checking')) {
            newState.advisorHandoffReason = 'provider_primary_repeated_vague';
            newState.needsHuman = true;
            const out = isSpanish
              ? 'Anotado — doctor primario. Lo organizamos con un asesor licenciado para llamar al consultorio y verificar la red. ¿Le contactamos?'
              : 'Got it — primary doctor. Let me get a licensed advisor to call the office and verify the network. Want them to follow up?';
            newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
            return { response: out, newState, needsHuman: true };
          }
          newState.askedQuestions.push('provider_office_said_no_or_checking');
          const q = isSpanish
            ? 'Gracias. ¿La oficina del doctor le dijo que no acepta su plan, o está tratando de verificar antes de ir a la cita?'
            : "Thanks. Did the doctor's office tell you they don't accept your plan, or are you trying to verify before the appointment?";
          newState.lastBotQuestion = q;
          newState.lastBotIntent = 'provider_office_said_no_or_checking';
          newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
          return { response: q, newState, needsHuman: false };
        }

        if (provAns.category === 'specialist_not_accepting') {
          newState.providerIssueType = 'specialist_not_accepting';
          if (newState.askedQuestions.includes('provider_appointment_soon')) {
            newState.advisorHandoffReason = 'provider_specialist_repeated_vague';
            newState.needsHuman = true;
            const out = isSpanish
              ? 'Anotado — especialista. Lo organizamos con un asesor licenciado para verificar la red y orientar próximos pasos. ¿Le contactamos?'
              : 'Got it — specialist. Let me get a licensed advisor to verify the network and guide next steps. Want them to follow up?';
            newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
            return { response: out, newState, needsHuman: true };
          }
          newState.askedQuestions.push('provider_appointment_soon');
          const q = isSpanish
            ? 'Entiendo. ¿Ya tiene una cita programada con ese especialista, o todavía está tratando de coordinarla?'
            : 'I understand. Do you already have an appointment scheduled with that specialist, or are you still trying to set one up?';
          newState.lastBotQuestion = q;
          newState.lastBotIntent = 'provider_appointment_soon';
          newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
          return { response: q, newState, needsHuman: false };
        }

        if (provAns.category === 'hospital_network') {
          newState.providerIssueType = 'hospital_network';
          newState.advisorHandoffReason = 'provider_hospital_network';
          const out = isSpanish
            ? 'Anotado — un hospital. No puedo confirmar redes hospitalarias aquí. Un asesor licenciado puede verificar la red del plan y orientarle antes de la visita. ¿Le gustaría que un asesor le contacte?'
            : "Got it — a hospital. I can't confirm hospital networks here. A licensed advisor can verify the plan network and guide you before the visit. Would you like an advisor to follow up?";
          newState.lastBotIntent = 'provider_hospital_advisor';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: false };
        }

        if (provAns.category === 'office_said_no') {
          newState.providerIssueType = 'office_said_no';
          newState.advisorHandoffReason = 'provider_office_said_no';
          const out = isSpanish
            ? 'Anotado — la oficina ya le dijo. No puedo confirmar la red desde aquí. Un asesor licenciado puede llamar al consultorio, verificar con el plan, y revisar si hay otra opción cerca. ¿Le contactamos?'
            : "Got it — the office already told you. I can't confirm the network from here. A licensed advisor can call the office, verify with the plan, and review other options nearby. Want them to follow up?";
          newState.lastBotIntent = 'provider_office_advisor';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: false };
        }

        if (provAns.category === 'provider_verify_network') {
          newState.providerIssueType = 'provider_verify_network';
          newState.advisorHandoffReason = 'provider_verify_network';
          const out = isSpanish
            ? 'Entiendo — quiere verificar antes de ir. No puedo confirmar la red de un proveedor desde aquí. Un asesor licenciado puede revisar la red del plan y confirmárselo. ¿Le contactamos?'
            : "I understand — you want to verify before going. I can't confirm a provider's network from here. A licensed advisor can review the plan network and confirm it. Want them to follow up?";
          newState.lastBotIntent = 'provider_verify_advisor';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: false };
        }

        if (provAns.category === 'appointment_issue') {
          newState.providerIssueType = 'appointment_issue';
          const q = isSpanish
            ? 'Anotado. ¿La cita la canceló el consultorio, o usted está tratando de reagendarla?'
            : "Got it. Did the office cancel the appointment, or are you trying to reschedule it?";
          newState.lastBotQuestion = q;
          newState.lastBotIntent = 'provider_appointment_detail';
          newState.messages.push({ role: 'bot', content: q, timestamp: Date.now() });
          return { response: q, newState, needsHuman: false };
        }

        if (provAns.category === 'referral_issue') {
          newState.providerIssueType = 'referral_issue';
          newState.advisorHandoffReason = 'provider_referral';
          const out = isSpanish
            ? 'Entiendo — un tema de referido. Un asesor licenciado puede revisar si el plan necesita referido, coordinarlo con el doctor primario y verificar la red. ¿Le contactamos?'
            : "I understand — a referral issue. A licensed advisor can review whether the plan requires a referral, coordinate with the primary doctor, and verify the network. Want them to follow up?";
          newState.lastBotIntent = 'provider_referral_advisor';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: false };
        }

        if (provAns.category === 'short_idk') {
          newState.providerFailedClarifications = (newState.providerFailedClarifications || 0) + 1;
          newState.advisorHandoffReason = 'provider_user_unsure';
          newState.needsHuman = true;
          const out = isSpanish
            ? 'No hay problema. Un asesor licenciado puede llamar al consultorio y verificarlo directamente con el plan. ¿Le gustaría que un asesor le contacte?'
            : 'No problem. A licensed advisor can call the office and verify it directly with the plan. Would you like an advisor to follow up?';
          newState.lastBotIntent = 'provider_idk_advisor';
          newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
          return { response: out, newState, needsHuman: true };
        }

        if (provAns.category === 'short_no') {
          // "no" — interpret based on last question we asked.
          if (newState.askedQuestions.includes('provider_office_said_no_or_checking')) {
            // We asked: office said no, or checking? "no" = not office, so checking.
            newState.providerIssueType = 'provider_verify_network';
            newState.advisorHandoffReason = 'provider_verify_network';
            const out = isSpanish
              ? 'Entendido — está verificando antes de ir. Un asesor licenciado puede confirmar la red del plan directamente. ¿Le contactamos?'
              : "Got it — you're verifying before going. A licensed advisor can confirm the plan network directly. Want them to follow up?";
            newState.lastBotIntent = 'provider_verify_advisor';
            newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
            return { response: out, newState, needsHuman: false };
          }
          if (newState.askedQuestions.includes('provider_appointment_soon')) {
            // We asked appointment scheduled? "no" = no appointment yet.
            newState.advisorHandoffReason = 'provider_specialist_pre_appt';
            const out = isSpanish
              ? 'Entendido — todavía no tiene cita. Un asesor licenciado puede ayudarle a verificar la red y orientar para programar con un especialista cubierto. ¿Le contactamos?'
              : 'Got it — no appointment yet. A licensed advisor can help verify the network and guide you to schedule with a covered specialist. Want them to follow up?';
            newState.lastBotIntent = 'provider_pre_appt_advisor';
            newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
            return { response: out, newState, needsHuman: false };
          }
          // Generic "no" with no prior provider question → count + escalate.
          newState.providerFailedClarifications = (newState.providerFailedClarifications || 0) + 1;
          if ((newState.providerFailedClarifications || 0) >= 2) {
            newState.advisorHandoffReason = 'provider_repeated_vague';
            newState.needsHuman = true;
            const out = isSpanish
              ? 'Entiendo. Lo organizamos con un asesor licenciado para no seguir adivinando. ¿Le contactamos?'
              : "I understand. Let me organize this with a licensed advisor so we don't keep guessing. Want them to follow up?";
            newState.lastBotIntent = 'provider_repeat_advisor';
            newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
            return { response: out, newState, needsHuman: true };
          }
        }
      }

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
        // WAVE 45 — fix doubled-word bug: when neither specialist nor doctor
        // is the explicit kept-item, default to a clean sentence without the
        // "ni de X" tail (which previously rendered as "...plan ni de plan").
        const keptKind: 'specialist' | 'doctor' | 'none' =
          newState.wantsToKeepSpecialist ? 'specialist'
        : newState.wantsToKeepDoctor ? 'doctor'
        : 'none';
        const out = isSpanish
          ? (keptKind === 'none'
              ? `Entiendo. Si usted no quiere cambiar de plan, no vamos a asumir que cambiar sea la respuesta. Primero hay que verificar qué está causando el problema.\n\n¿Quién le dijo que tendría que cambiar: el especialista, el plan, o otra persona?`
              : `Entiendo. Si usted no quiere cambiar de plan ni de ${keptKind === 'specialist' ? 'especialista' : 'doctor'}, no vamos a asumir que cambiar sea la respuesta. Primero hay que verificar qué está causando el problema.\n\n¿Quién le dijo que tendría que cambiar: el especialista, el plan, o otra persona?`)
          : (keptKind === 'none'
              ? `Understood. If you don't want to change your plan, we won't assume change is the answer. First we need to verify what's causing the problem.\n\nWho told you to change: the specialist, the plan, or someone else?`
              : `Understood. If you don't want to change your plan or your ${keptKind}, we won't assume change is the answer. First we need to verify what's causing the problem.\n\nWho told you to change: the specialist, the plan, or someone else?`);
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

    // ─── WAVE 42 — comprehensive event handlers ───
    // Medical emergency → safety-first 911 routing.
    if (problemType === 'medical_emergency_911') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'medical_emergency_911';
      newState.needsHuman = true;
      const out = isSpanish
        ? 'Eso suena a emergencia médica. Por favor llame al **911** ahora mismo o vaya a la sala de emergencias más cercana. Yo no soy médico ni puedo manejar emergencias. Si necesita seguimiento de Medicare después, un asesor licenciado le puede ayudar.'
        : "That sounds like a medical emergency. Please call **911** right now or go to the nearest emergency room. I'm not a doctor and can't handle emergencies. If you need Medicare follow-up afterwards, a licensed advisor can help.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: true };
    }
    if (problemType === 'fraud_scam') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'fraud_scam';
      newState.advisorHandoffReason = 'fraud_scam_concern';
      const out = isSpanish
        ? 'Buena que pregunta. Nunca dé su número de Medicare, Seguro Social, banco o tarjeta a alguien que le llama sin pedirlo. Medicare nunca llama pidiendo eso. Si sospecha fraude: reporte al **Senior Medicare Patrol (1-877-808-2468)** o al **1-800-MEDICARE**. ¿Quiere que un asesor licenciado de ClearPoint le ayude a revisar lo que pasó?'
        : "Good that you ask. Never give your Medicare number, Social Security, bank or card info to someone who called you. Medicare never calls asking for that. If you suspect fraud: report to **Senior Medicare Patrol (1-877-808-2468)** or **1-800-MEDICARE**. Want a ClearPoint licensed advisor to help review what happened?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'off_topic') {
      newState.serviceCategory = 'off_topic';
      const out = isSpanish
        ? 'Le entiendo, pero yo le ayudo con temas de Medicare — doctores, medicamentos, planes, cartas, beneficios. ¿Hay algo de Medicare en lo que le pueda ayudar?'
        : "I get it, but I help with Medicare topics — doctors, medications, plans, letters, benefits. Is there something Medicare-related I can help with?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'about_clearpoint') {
      newState.serviceCategory = 'about_clearpoint';
      const out = isSpanish
        ? 'ClearPoint Senior Advisors es una agencia independiente — no somos Medicare ni el gobierno. Nuestros asesores son **licenciados** y el servicio es **gratis**. No vendemos su información. Trabajamos con varios planes pero no todos los disponibles en su área — para ver todas las opciones también puede llamar a **1-800-MEDICARE** o consultar el programa **SHIP** local gratis. ¿En qué le ayudo hoy?'
        : "ClearPoint Senior Advisors is an independent agency — we are NOT Medicare or the government. Our advisors are **licensed** and the service is **free**. We don't sell your information. We work with several plans but not every plan in your area — to see all options you can also call **1-800-MEDICARE** or check your local **SHIP** program for free unbiased counseling. How can I help today?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'doctor_change_request') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'doctor_change_request';
      newState.advisorHandoffReason = 'doctor_change_or_search';
      const out = isSpanish
        ? 'Anotado — necesita un doctor nuevo. Un asesor licenciado puede revisar la red de su plan, ayudarle a buscar opciones cerca, y confirmar que aceptan su plan antes de que llame. No puedo verificar redes de doctores aquí. ¿Le gustaría que un asesor le contacte?'
        : "Got it — you need a new doctor. A licensed advisor can review your plan's network, help search options near you, and confirm they accept your plan before you call. I can't verify provider networks here. Would you like an advisor to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'er_hospital_visit') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'er_hospital_visit';
      const out = isSpanish
        ? 'Anotado, una visita a emergencia o al hospital. Lo que pasa después depende de si tiene Medicare Original o un plan Medicare Advantage — los procesos de cobertura y facturación son diferentes. Si recibe una factura del hospital o aviso, un asesor licenciado puede ayudarle a revisarlo. ¿Hay algo específico que le preocupa?'
        : "Noted, an ER or hospital visit. What happens next depends on whether you have Original Medicare or a Medicare Advantage plan — coverage and billing processes differ. If you get a hospital bill or notice, a licensed advisor can help review it. Is there something specific you're worried about?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'telehealth') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'telehealth';
      const out = isSpanish
        ? 'Telemedicina (visitas por video) está cubierta por Medicare en muchos casos, pero las reglas y los costos pueden depender de su plan, el tipo de visita, y el proveedor. Un asesor licenciado puede revisar cómo aplica para su plan específico. ¿Tiene una visita pronto o quiere entender la cobertura?'
        : "Telehealth (video visits) is covered by Medicare in many cases, but rules and costs can depend on your plan, the type of visit, and the provider. A licensed advisor can review how it applies to your specific plan. Do you have a visit soon or want to understand coverage?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'donut_hole') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'donut_hole';
      const out = isSpanish
        ? 'El "donut hole" o brecha de cobertura fue una fase de Parte D donde usted pagaba más por medicamentos. **Importante: en 2025 esa fase fue eliminada** y existe un nuevo límite de $2,000 al año para gastos de bolsillo en medicamentos. Las reglas siguen variando por plan y nivel de medicamento. Un asesor licenciado puede explicarle cómo aplica a su plan.'
        : "The \"donut hole\" or coverage gap used to be a Part D phase where you paid more for drugs. **Important: in 2025 that phase was eliminated** and there's now a new $2,000 annual out-of-pocket cap on drugs. Rules still vary by plan and drug tier. A licensed advisor can explain how it applies to your plan.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'insulin_cap') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'insulin_cap';
      const out = isSpanish
        ? 'Buena pregunta. Por ley federal, su copago de **insulina cubierta por Parte D no puede pasar de $35 por mes**, sin deducible. Esto aplica a todos los planes de Parte D y Medicare Advantage con cobertura de drogas. Si está pagando más de $35, hay algo que no está bien — un asesor licenciado puede revisarlo con su farmacia y plan.'
        : "Good question. By federal law, your **insulin copay covered under Part D cannot exceed $35 per month**, with no deductible. This applies to all Part D and Medicare Advantage plans with drug coverage. If you're paying more than $35, something is off — a licensed advisor can review with your pharmacy and plan.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'pharmacy_logistics') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'pharmacy_logistics';
      const out = isSpanish
        ? 'Sí, puede cambiar de farmacia o usar farmacia por correo si su plan lo permite. La farmacia preferida del plan suele tener copagos más bajos. Un asesor licenciado puede confirmar qué farmacias están en su red y si correo aplica a sus medicamentos. ¿Quiere coordinar eso?'
        : "Yes, you can change pharmacies or use mail order if your plan allows. The plan's preferred pharmacy usually has lower copays. A licensed advisor can confirm which pharmacies are in your network and if mail order applies to your medications. Want to set that up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'drug_tier') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'drug_tier';
      const out = isSpanish
        ? 'Los planes de Parte D agrupan medicamentos en niveles (tiers) — generalmente: nivel 1 (genéricos preferidos, más barato), nivel 2 (genéricos), nivel 3 (marca preferida), nivel 4 (no preferida), nivel 5 (especiales, más caro). El nivel determina su copago. Un asesor licenciado puede revisar en qué nivel está su medicamento específico.'
        : "Part D plans group drugs into tiers — generally: tier 1 (preferred generics, cheapest), tier 2 (generics), tier 3 (preferred brand), tier 4 (non-preferred), tier 5 (specialty, most expensive). The tier determines your copay. A licensed advisor can review which tier your specific drug is in.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'vaccine_question') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'vaccine_question';
      const out = isSpanish
        ? 'Buena pregunta. Bajo la ley federal reciente, **muchas vacunas para adultos están cubiertas sin costo** bajo Parte D — incluyendo Shingrix (culebrilla), neumonía, tétano, hepatitis B en grupos de riesgo. La vacuna de la gripe está bajo Parte B (cubierta también). Los detalles dependen de su plan y farmacia. ¿Quiere que un asesor confirme la cobertura específica?'
        : "Good question. Under recent federal law, **many adult vaccines are covered at no cost** under Part D — including Shingrix (shingles), pneumonia, tetanus, hepatitis B in at-risk groups. Flu shot is under Part B (also covered). Details depend on your plan and pharmacy. Want an advisor to confirm specific coverage?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'premium_increase') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'premium_increase';
      const out = isSpanish
        ? 'Anotado — su premium subió. Las razones más comunes son: 1) cambio anual del plan (revise el aviso ANOC de octubre/noviembre), 2) cargo IRMAA si sus ingresos altos requieren un cargo extra (carta de Social Security), 3) penalidad por inscripción tardía. Un asesor licenciado puede revisar con usted cuál aplica y si tiene opciones de cambio en AEP. ¿Recibió alguna carta explicando el aumento?'
        : "Noted — your premium went up. Most common reasons: 1) annual plan change (check the ANOC notice from Oct/Nov), 2) IRMAA charge if higher income requires extra (SSA letter), 3) late enrollment penalty. A licensed advisor can review which applies and whether you have change options during AEP. Did you get a letter explaining the increase?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'compare_plans') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'compare_plans';
      newState.advisorHandoffReason = 'plan_comparison_request';
      const out = isSpanish
        ? 'Excelente — comparar planes con cuidado es lo correcto. **Yo no puedo recomendar un plan** aquí: depende de sus doctores, medicinas, condado, farmacia y necesidades específicas. Un asesor licenciado puede revisar todas sus opciones disponibles sin costo y sin presión. También puede usar **Medicare Plan Finder** en Medicare.gov o llamar a **1-800-MEDICARE**. ¿Quiere que un asesor le contacte?'
        : "Excellent — comparing plans carefully is the right move. **I can't recommend a plan** here: it depends on your doctors, medications, county, pharmacy, and specific needs. A licensed advisor can review all your available options at no cost and no pressure. You can also use **Medicare Plan Finder** at Medicare.gov or call **1-800-MEDICARE**. Want an advisor to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'disenroll_request') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'disenroll_request';
      newState.advisorHandoffReason = 'disenroll_request';
      const out = isSpanish
        ? 'Anotado — quiere darse de baja de su plan. Hay reglas y ventanas (AEP, MA-OEP en enero-marzo, SEP por evento especial) y consecuencias diferentes según si vuelve a Medicare Original sin Medigap. **Antes de cancelar**, un asesor licenciado debe revisar con usted las opciones para que no pierda cobertura sin querer. ¿Le coordino esa llamada?'
        : "Noted — you want to disenroll from your plan. There are rules and windows (AEP, MA-OEP Jan-Mar, SEP for special events) and different consequences depending on whether you go back to Original Medicare without Medigap. **Before cancelling**, a licensed advisor should review options with you so you don't unintentionally lose coverage. Want me to set up that call?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'employer_va_cobra') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'employer_va_cobra';
      newState.advisorHandoffReason = 'employer_va_cobra_coordination';
      const out = isSpanish
        ? 'Anotado — situación de empleo / VA / TRICARE / COBRA. Estas situaciones tienen reglas especiales: por ejemplo, si su empleador tiene 20+ empleados, puede atrasar Parte B sin penalidad mientras tenga cobertura. VA y TRICARE coordinan diferente. Un asesor licenciado especializado en estos casos puede revisar su situación específica. ¿Le contactamos?'
        : "Noted — employment / VA / TRICARE / COBRA situation. These have special rules: for example, if your employer has 20+ employees, you can delay Part B without penalty while you have coverage. VA and TRICARE coordinate differently. A licensed advisor specialized in these cases can review your specific situation. Want them to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'snp_plans') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'snp_plans';
      newState.advisorHandoffReason = 'snp_plan_inquiry';
      const out = isSpanish
        ? 'Los planes SNP (Special Needs Plans) son Medicare Advantage diseñados para grupos específicos: D-SNP (doble elegible con Medicaid), C-SNP (condición crónica como diabetes o cardíaca), I-SNP (institucionalizados). Cada uno tiene elegibilidad propia. Un asesor licenciado puede revisar si califica y qué planes hay en su área. ¿Le contactamos?'
        : "SNP plans (Special Needs Plans) are Medicare Advantage designed for specific groups: D-SNP (dual eligible with Medicaid), C-SNP (chronic condition like diabetes or cardiac), I-SNP (institutionalized). Each has its own eligibility. A licensed advisor can review whether you qualify and what plans are available in your area. Want them to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'original_medicare_enroll') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'original_medicare_enroll';
      const out = isSpanish
        ? 'Anotado — está empezando con Medicare. Los pasos básicos: 1) inscribirse en Parte A y B con Social Security (ssa.gov o 1-800-772-1213), 2) decidir entre Medicare Original + Medigap + Parte D, O Medicare Advantage. Su ventana de IEP empieza 3 meses antes del mes de sus 65 años. Un asesor licenciado puede revisar cuál camino le conviene según sus doctores y medicinas. ¿Le contactamos?'
        : "Noted — you're starting with Medicare. Basic steps: 1) enroll in Part A and B through Social Security (ssa.gov or 1-800-772-1213), 2) decide between Original Medicare + Medigap + Part D, OR Medicare Advantage. Your IEP window starts 3 months before your 65th birthday month. A licensed advisor can review which path fits your doctors and medications. Want them to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'gym_benefit') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'gym_benefit';
      const out = isSpanish
        ? 'Muchos planes Medicare Advantage incluyen membresía de gimnasio gratis (SilverSneakers, Renew Active, One Pass), pero no todos los planes ofrecen el mismo. Si su plan lo incluye, suele estar en su tarjeta o portal de miembro. Un asesor licenciado puede confirmar si su plan tiene este beneficio. ¿Lo verificamos?'
        : "Many Medicare Advantage plans include free gym membership (SilverSneakers, Renew Active, One Pass), but not all plans offer the same. If your plan includes it, it's usually on your card or member portal. A licensed advisor can confirm whether your plan has this benefit. Want to verify?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'post_hospital_meals') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'post_hospital_meals';
      const out = isSpanish
        ? 'Algunos planes Medicare Advantage incluyen comidas a domicilio después de una hospitalización (usualmente 10-28 comidas durante 1-2 semanas). No todos los planes ofrecen esto. Un asesor licenciado puede confirmar si su plan lo incluye y cómo solicitarlo. ¿Le contactamos?'
        : "Some Medicare Advantage plans include home-delivered meals after a hospital stay (usually 10-28 meals over 1-2 weeks). Not all plans offer this. A licensed advisor can confirm whether your plan includes it and how to request it. Want them to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'mental_health') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'mental_health';
      const out = isSpanish
        ? 'Medicare cubre servicios de salud mental — terapia, psiquiatría, consejería, tratamiento de depresión/ansiedad — bajo Parte B. Los detalles de costo y red dependen de su plan. Si está en crisis ahora mismo, por favor llame al **988** (Línea de Crisis y Suicidio). Para servicios regulares, un asesor licenciado puede ayudarle a encontrar proveedores en su red. ¿Cómo le ayudo?'
        : "Medicare covers mental health services — therapy, psychiatry, counseling, depression/anxiety treatment — under Part B. Cost and network details depend on your plan. If you're in crisis right now, please call **988** (Suicide and Crisis Lifeline). For regular services, a licensed advisor can help you find providers in your network. How can I help?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'alternative_care') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'alternative_care';
      const out = isSpanish
        ? 'Algunos servicios están cubiertos por Medicare con condiciones: **quiropráctico** (limitado a corrección manual de la columna), **acupuntura** (solo dolor crónico de espalda), **podología** (con ciertas condiciones médicas). Los planes Medicare Advantage pueden ofrecer beneficios más amplios. Un asesor licenciado puede revisar lo que aplica a su plan. ¿Le contactamos?'
        : "Some services are covered by Medicare with conditions: **chiropractic** (limited to manual spine correction), **acupuncture** (only for chronic back pain), **podiatry** (with certain medical conditions). Medicare Advantage plans may offer broader benefits. A licensed advisor can review what applies to your plan. Want them to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'accessibility_need') {
      newState.serviceCategory = 'accessibility_need';
      // Detect specific need.
      const isVisual = /no veo|can'?t see|low vision|baja visi[oó]n|blind|ciego/i.test(userMessage);
      const isHearing = /no oigo|hard of hearing|sordo|deaf/i.test(userMessage);
      const isPace = /m[aá]s despacio|slow down|speak slowly|m[aá]s lento/i.test(userMessage);
      const isSimpler = /m[aá]s f[aá]cil|simpler|easier|explain (it )?simpler|explique f[aá]cil/i.test(userMessage);
      const isRepeat = /repit[ae]|repeat|say it again|d[ií]galo otra vez/i.test(userMessage);
      let out: string;
      if (isVisual) {
        out = isSpanish
          ? 'Anotado — voy a escribir con mensajes cortos y claros. Si necesita audio en vez de texto, llame directo a un asesor licenciado de ClearPoint al **1-866-310-8702**. ¿Cómo le ayudo?'
          : "Noted — I'll keep messages short and clear. If you need audio instead of text, call a ClearPoint licensed advisor directly at **1-866-310-8702**. How can I help?";
      } else if (isHearing) {
        out = isSpanish
          ? 'Entendido — seguiremos por texto que es más fácil para usted. Si en algún momento necesita llamada con video (lectura de labios) o TTY, un asesor licenciado puede coordinarlo al **1-866-310-8702**. ¿Cómo le ayudo?'
          : "Understood — we'll keep using text which is easier for you. If you need video call (lip reading) or TTY at any point, a licensed advisor can coordinate at **1-866-310-8702**. How can I help?";
      } else if (isPace) {
        out = isSpanish
          ? 'Por supuesto, vamos sin prisa. Una pregunta a la vez. ¿En qué le ayudo?'
          : "Of course, let's go slow. One question at a time. How can I help?";
      } else if (isSimpler) {
        out = isSpanish
          ? 'Por supuesto, le explico más sencillo. Dígame qué tema y vamos paso a paso.'
          : "Of course, I'll explain simpler. Tell me which topic and we'll go step by step.";
      } else if (isRepeat) {
        out = isSpanish
          ? 'Por supuesto. Le repito: ¿en qué tema le puedo ayudar — medicamentos, doctor, carta, factura, o beneficios?'
          : "Of course. Let me repeat: which topic can I help with — medications, doctor, letter, bill, or benefits?";
      } else {
        out = isSpanish
          ? 'Por supuesto, vamos con calma. ¿Cómo le ayudo?'
          : "Of course, let's take it easy. How can I help?";
      }
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'conversation_control') {
      newState.serviceCategory = 'conversation_control';
      const isSummary = /summary|resumen|sum it up|r[eé]sumeme/i.test(userMessage);
      const isGoBack = /go back|regresa|atr[aá]s/i.test(userMessage);
      const isChangeTopic = /cambiar (de )?tema|change (the )?topic|switch topic|otra cosa|otro tema/i.test(userMessage);
      let out: string;
      if (isSummary && newState.conversationSummary && newState.conversationSummary.length > 0) {
        out = isSpanish
          ? `Hasta aquí tengo: ${newState.conversationSummary.join(' / ')}. ¿Quiere que siga en algún punto específico?`
          : `So far I have: ${newState.conversationSummary.join(' / ')}. Want to continue on something specific?`;
      } else if (isGoBack) {
        out = isSpanish
          ? 'Por supuesto. ¿A qué parte le gustaría regresar — el tema del doctor, la medicina, una carta, una factura?'
          : "Of course. Which part would you like to go back to — the doctor topic, medication, a letter, a bill?";
      } else if (isChangeTopic) {
        out = isSpanish
          ? 'Claro, cambiamos de tema. ¿De qué le gustaría hablar — medicamentos, doctor, carta, factura o beneficios?'
          : "Sure, let's change topic. What would you like to talk about — medications, doctor, letter, bill, or benefits?";
      } else {
        out = isSpanish
          ? '¿En qué le puedo ayudar?'
          : 'How can I help?';
      }
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'personal_context') {
      newState.serviceCategory = 'personal_context';
      // Note the context for advisor lead notes, but don't ask for more PHI.
      const isCaregiver = /caregiver|cuidador|cuido|i take care/i.test(userMessage);
      const isAlone = /live alone|vivo sol/i.test(userMessage);
      const isLowIncome = /fixed income|ingreso fijo|low income|bajo ingreso/i.test(userMessage);
      const isRetired = /just retired|reci[eé]n.*jubil|recently retired/i.test(userMessage);
      let opener: string;
      if (isCaregiver) opener = isSpanish ? 'Entendido — usted está cuidando a alguien. Vamos a hacerlo simple para los dos. ' : "Understood — you're caring for someone. Let's keep it simple for both. ";
      else if (isAlone) opener = isSpanish ? 'Entendido. Vamos a hacerlo paso a paso. ' : "Understood. Let's go step by step. ";
      else if (isLowIncome) opener = isSpanish ? 'Entendido — y hay programas de ayuda (Extra Help, Medicaid, MSP) que podrían aplicar. Un asesor licenciado puede revisarlos sin costo. ' : "Understood — and there are assistance programs (Extra Help, Medicaid, MSP) that may apply. A licensed advisor can review them at no cost. ";
      else if (isRetired) opener = isSpanish ? 'Felicidades por la jubilación. ' : 'Congratulations on retiring. ';
      else opener = '';
      const out = opener + (isSpanish
        ? '¿En qué le puedo ayudar hoy — medicamentos, doctor, carta, factura, o algo más?'
        : 'How can I help today — medications, doctor, letter, bill, or something else?');
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'eob_explanation') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'eob_explanation';
      const out = isSpanish
        ? 'EOB (Explanation of Benefits / Explicación de Beneficios) es un resumen del plan — NO es una factura. Muestra qué servicios usó, cuánto cobraron, qué pagó el plan, y lo que usted debe (si aplica). Si dice "Esto no es una factura" en algún lado, no necesita pagar nada. Si tiene dudas con uno específico, un asesor licenciado puede revisarlo con usted.'
        : "EOB (Explanation of Benefits) is a plan summary — it is NOT a bill. It shows what services you used, what was billed, what the plan paid, and what you owe (if anything). If it says \"This is not a bill\" somewhere, you don't need to pay anything. If you have questions about a specific one, a licensed advisor can review it with you.";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'ship_referral') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'ship_referral';
      const out = isSpanish
        ? '**SHIP** (State Health Insurance Assistance Program) es un programa gratis con consejeros estatales no afiliados a ningún plan. Útil para una segunda opinión imparcial. Encuentre el SHIP de su estado en **shiptacenter.org** o llame a **1-877-839-2675**. Para queja contra plan: **Medicare Ombudsman** o departamento estatal de seguros. ¿Quiere que un asesor de ClearPoint también revise su caso?'
        : "**SHIP** (State Health Insurance Assistance Program) is a free program with state counselors not affiliated with any plan. Useful for an unbiased second opinion. Find your state SHIP at **shiptacenter.org** or call **1-877-839-2675**. For plan complaint: **Medicare Ombudsman** or state insurance department. Want a ClearPoint advisor to review your case too?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'returning_customer') {
      newState.serviceCategory = 'returning_customer';
      const out = isSpanish
        ? 'Qué bueno que regresa. ¿En qué le ayudo hoy — un tema nuevo o seguimos algo que dejamos pendiente?'
        : 'Welcome back. How can I help today — a new topic or follow up on something pending?';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'family_referral') {
      newState.serviceCategory = 'family_referral';
      const out = isSpanish
        ? 'Qué bueno que su familia le recomendó. Estamos aquí para ayudar. ¿En qué le puedo ayudar hoy — es para usted o para alguien de su familia?'
        : "Glad your family recommended. We're here to help. How can I help today — is this for you or for a family member?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 40 — Medicaid mention (dual eligibility educational).
    if (problemType === 'medicaid_mention') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'medicaid_mention';
      const out = isSpanish
        ? 'Anotado — usted tiene Medicaid. Tener Medicare y Medicaid (doble elegible) puede abrir beneficios extra como Extra Help para medicinas y planes especiales (D-SNP) que coordinan ambos. Las reglas varían por estado.\n\nNo puedo confirmar elegibilidad aquí. Un asesor licenciado puede verificar las opciones en su estado. ¿Le contactamos?'
        : "Noted — you have Medicaid. Having Medicare and Medicaid (dual eligible) can open extra benefits like Extra Help for drugs and special plans (D-SNP) that coordinate both. Rules vary by state.\n\nI can't confirm eligibility here. A licensed advisor can verify options in your state. Want them to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 40 — scheduling intent (when can advisor call).
    if (problemType === 'scheduling') {
      newState.routingLevel = 'A';
      newState.serviceCategory = 'scheduling';
      const out = isSpanish
        ? 'Un asesor licenciado de ClearPoint le puede llamar en horario laboral. También puede llamar directamente al **1-866-310-8702**. ¿Le gustaría coordinar una llamada de regreso?'
        : "A ClearPoint licensed advisor can call you during business hours. You can also call directly at **1-866-310-8702**. Want to set up a callback?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 39 — Medicare Advantage / MAPD educational handler.
    if (problemType === 'medicare_advantage') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'medicare_advantage';
      const out = isSpanish
        ? 'Medicare Advantage (Parte C) son planes ofrecidos por compañías privadas aprobadas por Medicare. Combinan Parte A y B, y muchas veces incluyen Parte D (medicamentos) y beneficios extras como dental, visión, audición, OTC o transporte. Las redes de doctores, costos y beneficios varían por plan y condado.\n\nNo puedo confirmar aquí cuál plan es mejor para usted — eso depende de sus doctores, medicinas, y necesidades. Un asesor licenciado puede revisar las opciones disponibles en su área sin costo. ¿Le gustaría que un asesor le contacte?'
        : "Medicare Advantage (Part C) plans are offered by private companies approved by Medicare. They combine Part A and B, and often include Part D (drugs) plus extra benefits like dental, vision, hearing, OTC, or transportation. Doctor networks, costs, and benefits vary by plan and county.\n\nI can't tell you which plan is best for you here — that depends on your doctors, medications, and needs. A licensed advisor can review options available in your area at no cost. Would you like an advisor to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 39 — Plan type question (HMO / PPO / HMO-POS).
    if (problemType === 'plan_type_question') {
      newState.routingLevel = 'B';
      newState.serviceCategory = 'plan_type_question';
      const out = isSpanish
        ? 'HMO, PPO y HMO-POS son tipos de planes Medicare Advantage:\n· HMO: usa una red específica de doctores, normalmente requiere doctor primario y referidos para especialistas.\n· PPO: red más flexible, suele permitir ver doctores fuera de red con costos más altos.\n· HMO-POS: como HMO, pero con algunas opciones fuera de red para ciertos servicios.\n\nNo puedo confirmar cuál le conviene — depende de sus doctores, medicinas y necesidades. Un asesor licenciado puede comparar planes disponibles en su área. ¿Le gustaría coordinar esa revisión?'
        : "HMO, PPO and HMO-POS are types of Medicare Advantage plans:\n· HMO: uses a specific network of doctors, usually requires a primary doctor and referrals for specialists.\n· PPO: more flexible network, usually lets you see out-of-network doctors at a higher cost.\n· HMO-POS: like HMO but with some out-of-network options for certain services.\n\nI can't tell you which works for you — it depends on your doctors, medications, and needs. A licensed advisor can compare plans available in your area. Want to set that up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 39 — SPAP / state pharmaceutical assistance.
    if (problemType === 'spap') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'spap';
      const out = isSpanish
        ? 'SPAP (State Pharmaceutical Assistance Program) son programas estatales que ayudan con el costo de medicamentos. Las reglas y beneficios varían por estado — por ejemplo, EPIC en NY tiene reglas distintas a otros programas.\n\nNo puedo confirmar elegibilidad aquí. Un asesor licenciado puede revisar qué programa aplica en su estado y cómo solicitar. ¿Le gustaría que un asesor le contacte?'
        : "SPAP (State Pharmaceutical Assistance Program) are state programs that help with medication costs. Rules and benefits vary by state — for example, EPIC in NY has different rules than other programs.\n\nI can't confirm eligibility here. A licensed advisor can review which program applies in your state and how to apply. Would you like an advisor to follow up?";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    // WAVE 39 — Moving to another state triggers SEP (Special Enrollment Period).
    if (problemType === 'moving_state_sep') {
      newState.routingLevel = 'C';
      newState.serviceCategory = 'moving_state_sep';
      const out = isSpanish
        ? 'Mudarse a otro estado o condado puede abrir un Periodo Especial de Inscripción (SEP) — usualmente 2 meses después de la mudanza para cambiar de plan, porque los planes Medicare Advantage y Parte D son específicos por área de servicio.\n\nNo puedo confirmar el plazo exacto sin verificar su situación. Un asesor licenciado puede revisar las fechas y las opciones en su nueva área. ¿Le contactamos?'
        : "Moving to another state or county can open a Special Enrollment Period (SEP) — usually 2 months after the move to change plans, because Medicare Advantage and Part D plans are service-area specific.\n\nI can't confirm the exact window without verifying your situation. A licensed advisor can review the dates and options in your new area. Want them to follow up?";
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
        ? 'Rápido: deducible es lo que paga antes que el plan empiece. Copay es lo fijo por visita o medicamento. Coseguro es un porcentaje del costo. MOOP es el máximo de bolsillo del año. Los montos exactos varían por plan, condado, y nivel de medicina.\n\n¿Cuál término le está causando duda? Un asesor licenciado puede revisar los costos específicos de su plan.'
        : "Quick: deductible is what you pay before the plan kicks in. Copay is the fixed amount per visit or drug. Coinsurance is a percentage of the cost. MOOP is the yearly out-of-pocket maximum. Exact amounts vary by plan, county, and drug tier.\n\nWhich term is causing the question? A licensed advisor can review your plan's specific costs.";
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
      // WAVE 40 — split casual into farewell vs greeting.
      const isFarewell = /\b(bye|goodbye|adi[oó]s|hasta luego|chao|chau|que tenga (un )?(buen|buen[ai]) (d[ií]a|noche)|that'?s all|eso es todo|nothing else|nada m[aá]s|gracias eso es todo|thanks (that'?s )?all)\b/i.test(userMessage);
      if (isFarewell) {
        const out = isSpanish
          ? `De nada${withName(newState.name)}. Que tenga un buen día. Si necesita algo más, aquí estoy — o puede llamar a ClearPoint al **1-866-310-8702**.`
          : `You're welcome${withName(newState.name)}. Have a good day. If you need anything else, I'm here — or call ClearPoint at **1-866-310-8702**.`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }
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
    // V29 — restrict broad chip menu: only fire when NO serviceCategory is
    // active AND we're truly about to repeat. If category is set, ask a
    // category-specific question instead.
    // WAVE 50.2 — replace the "give me more detail" line with a concrete
    // topic menu (chips). The generic question never tells the user what
    // the bot CAN help with; it just stalls.
    const userMsgTrim = userMessage.trim();
    const userMsgVague = userMsgTrim.length < 20
      && /^(s[ií]|yes|ok|okay|no se|i don'?t know|ayuda|help|que|qu[eé]|what|c[oó]mo|how|hola|hi|hello|gracias|thanks|porfa|por favor)\.?$/i.test(userMsgTrim);
    if (userMsgVague && !newState.serviceCategory) {
      newState.quickReplies = isSpanish ? [...TOPIC_CHIPS_ES] : [...TOPIC_CHIPS_EN];
      const out = isSpanish
        ? `Claro${withName(newState.name)}. ¿En qué le puedo ayudar hoy? Algunos temas comunes: factura, doctor, medicamentos, carta, cobertura, inscripción, o hablar con un asesor licenciado.`
        : `Of course${withName(newState.name)}. How can I help today? Common topics: a bill, a doctor, medications, a letter, coverage, enrollment, or talking to a licensed advisor.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    const defaultOut = isSpanish
      ? `Para orientarle mejor${withName(newState.name)}, ¿es sobre factura, doctor, medicamentos, carta, cobertura, inscripción, o prefiere hablar con un asesor licenciado?`
      : `So I can help you best${withName(newState.name)}, is this about a bill, a doctor, medications, a letter, coverage, enrollment, or would you rather talk to a licensed advisor?`;
    const wouldRepeat = newState.lastFallbackResponse === defaultOut;
    if (wouldRepeat && !newState.serviceCategory) {
      newState.quickReplies = isSpanish ? [...TOPIC_CHIPS_ES] : [...TOPIC_CHIPS_EN];
      const out = isSpanish
        ? `Para no perder tiempo: ¿es sobre factura, doctor, medicamentos, tarjeta, cobertura, inscripción, o prefiere hablar con un asesor?`
        : `So I don't waste your time: is this about a bill, a doctor, medications, a card, coverage, enrollment, or would you rather talk to an advisor?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      newState.lastFallbackResponse = out;
      return { response: out, newState, needsHuman: false };
    }
    // V29 — if a serviceCategory is active and we'd otherwise fallback,
    // ask one category-specific question.
    if (wouldRepeat && newState.serviceCategory) {
      const cat = newState.serviceCategory;
      const categoryFollowup = (() => {
        if (cat === 'drug' || cat === 'medication') {
          return isSpanish
            ? '¿La farmacia le dijo que no la cubrieron, o recibió una carta del plan?'
            : "Did the pharmacy say it's not covered, or did you receive a letter from the plan?";
        }
        if (cat === 'doctor_provider_network') {
          return isSpanish
            ? '¿El doctor le dijo algo específico — que ya no acepta el plan, que necesita autorización, o algo más?'
            : "Did the doctor say something specific — they no longer accept the plan, you need an authorization, or something else?";
        }
        if (cat === 'bill' || cat === 'bill_provider') {
          return isSpanish
            ? '¿El documento dice "amount due", "balance due", o "patient responsibility"?'
            : 'Does the document say "amount due", "balance due", or "patient responsibility"?';
        }
        if (cat === 'letter') {
          return isSpanish
            ? '¿La carta es de Medicare, Medicaid, Social Security, o de su plan?'
            : 'Is the letter from Medicare, Medicaid, Social Security, or your plan?';
        }
        return isSpanish
          ? '¿Puede contarme lo que pasó específicamente?'
          : 'Can you tell me what happened specifically?';
      })();
      newState.messages.push({ role: 'bot', content: categoryFollowup, timestamp: Date.now() });
      newState.lastFallbackResponse = categoryFollowup;
      return { response: categoryFollowup, newState, needsHuman: false };
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

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10 — Clara outer filtering flow (Path A / B / C).
//
// Sits ABOVE the existing customerServiceEngine.ts. The outer flow decides
// who reaches the engine at all:
//
//   Path A — Existing client → identity verification via GHL lookup →
//            if matched, route to assigned advisor; if not, escalate for
//            manual review. Engine is NOT engaged for Path A.
//
//   Path B — Prospect exploring → qualification (Medicare A+B or near 65,
//            and state NY/NJ/CT, and Medicare-related topic). If qualified,
//            the existing engine takes over for topic discussion.
//
//   Path C — Out-of-scope topic OR didn't qualify in Path B → polite
//            deflection with public-resources referrals. NO lead capture
//            unless user EXPLICITLY opts in.
//
// Out-of-service-area users are collapsed to `'other'` — no state-specific
// branches, labels, or tags are emitted. Compliance: Clara must not surface
// any state outside NY/NJ/CT in any visible or backend channel.
//
// Compliance: no plan recommendations, no eligibility confirmations, no
// promises, no carrier names. Tone is suave informativo.
// ─────────────────────────────────────────────────────────────────────────────

// Type-only import — no runtime dependency, no circular import (the engine
// does NOT import this file). Used by outerStateToEngine() to hydrate the
// engine's ConversationState from the scripted outer flow.
import type { ConversationState } from './customerServiceEngine';

// Stage 1 (Sawil 2026-06) — RECONNECT to the strong, battle-tested validators
// that already live in validation.ts (single source of truth, shared with
// ChatBot/LeadForm/SmartMedicareReview). The outer flow MUST NOT reimplement
// weaker detection. We delegate name/phone/email validation to these so Clara
// gets bilingual profanity/fake/disposable rejection for free.
import {
  validatePersonName,
  validatePhone as validateLibPhone,
  validateEmail as validateLibEmail,
} from './validation';

export type ClaraOuterPath = 'A' | 'B' | 'C' | null;

export type ClaraOuterStep =
  // Initial — natural-language entry. After Phase 11.1 the user types
  // freely; Clara infers the path silently. 'awaiting_client_check' is
  // the optional one-question disambiguator when inferInitialPath returns
  // 'ambiguous' (i.e., user described a service issue without saying
  // whether they're a client).
  | 'path_select'
  | 'awaiting_zip'
  | 'awaiting_client_check'
  // Path A — Existing client
  | 'A_collect_identity'
  | 'A_verifying'
  | 'A_matched_collect_topic'
  | 'A_unmatched_collect_topic'
  | 'A_done'
  // Path B — Prospect qualification
  | 'B_q_medicare'
  | 'B_q_state'
  | 'B_q_topic'
  | 'B_pitch'
  | 'B_engine_engaged' // delegate to existing engine
  | 'B_done'
  // Path C — Out of scope
  | 'C_resources_shown'
  | 'C_optin_capture'
  | 'C_done';

export type MedicareStatus = 'AB_active' | 'near_65' | 'none';
export type ClaraState = 'NY' | 'NJ' | 'CT' | 'other';
export type ClaraTopic = 'plan' | 'billing' | 'doctor' | 'medication' | 'other';

export type OutOfScopeCategory =
  | 'dental_only'
  | 'life_insurance'
  | 'medicaid_only'
  | 'outside_state'
  | 'medical_question'
  | 'auto_home_insurance'
  | 'other';

export interface ClaraOuterState {
  step: ClaraOuterStep;
  path: ClaraOuterPath;
  language: 'en' | 'es';
  // Identity / capture
  fullName?: string;
  last4Phone?: string;
  phone?: string;
  email?: string;
  // Path A verification result
  verifiedContactId?: string;
  assignedUserId?: string;
  assignedAdvisorName?: string;
  // Path B qualification
  medicareStatus?: MedicareStatus;
  state?: ClaraState;
  zip?: string;
  topic?: ClaraTopic;
  // Stage 1 — graceful re-ask attempt counter for fake/invalid ZIP capture.
  // After 2 fakes Clara stops re-asking and proceeds (never traps a senior).
  zipAttempts?: number;
  // Path C
  outOfScopeCategory?: OutOfScopeCategory;
  // Summary (collected at end of A or before submit)
  problemSummary?: string;
  // Final lead type for GHL
  finalLeadType?:
    | 'existing_client_inquiry'
    | 'existing_client_unverified'
    | 'qualified_prospect'
    | 'out_of_scope_optin_callback'
    | 'out_of_service_area_interest';
}

export function createOuterState(language: 'en' | 'es'): ClaraOuterState {
  return { step: 'path_select', path: null, language };
}

// ── Path selection from chip click ─────────────────────────────────────────
export function pickPath(p: 'A' | 'B' | 'C'): ClaraOuterStep {
  return p === 'A' ? 'A_collect_identity' : p === 'B' ? 'B_q_medicare' : 'C_resources_shown';
}

// ── Validation ─────────────────────────────────────────────────────────────

/** Returns last-4 digits if input has exactly 4 numeric chars (ignores spaces/dashes). */
export function validateLast4Phone(text: string): { ok: boolean; digits?: string } {
  if (!text || typeof text !== 'string') return { ok: false };
  const digits = text.replace(/\D+/g, '');
  if (digits.length === 4) return { ok: true, digits };
  // Also allow user typing a full phone — take the last 4.
  if (digits.length >= 7 && digits.length <= 15) return { ok: true, digits: digits.slice(-4) };
  return { ok: false };
}

/**
 * Full-name validation. Stage 1 — DELEGATES to validatePersonName() from
 * validation.ts (single source of truth) so the outer flow inherits the
 * bilingual EN+ES profanity list (PROFANE_NAME_WORDS), the fake/placeholder
 * list (FAKE_NAME_WORDS), number/symbol rejection, and repeated-char detection
 * — instead of the previous weak alpha+2-word regex. Export signature kept
 * stable so existing callers (handleAIdentitySubmit etc.) don't break.
 */
export function validateFullName(text: string): { ok: boolean; cleaned?: string } {
  if (!text || typeof text !== 'string') return { ok: false };
  const r = validatePersonName(text);
  return r.valid ? { ok: true, cleaned: text.trim().replace(/\s+/g, ' ') } : { ok: false };
}

/**
 * Phone validation. Stage 1 — DELEGATES to validatePhone() from validation.ts,
 * which rejects the 555 fictional exchange, non-US country codes, sequential/
 * repeated runs, invalid area/exchange codes, etc. Returns a stable shape for
 * outer-flow callers: { ok, phone } where phone is the cleaned 10-digit string.
 */
export function validateUserPhone(text: string): { ok: boolean; phone?: string } {
  if (!text || typeof text !== 'string') return { ok: false };
  const r = validateLibPhone(text);
  return r.valid ? { ok: true, phone: r.cleaned } : { ok: false };
}

/**
 * Email validation. Stage 1 — DELEGATES to validateEmail() from validation.ts,
 * which rejects malformed addresses, disposable/blocked domains, fake patterns,
 * and profane local parts. Note: validateEmail treats an EMPTY string as valid
 * (optional field), so this helper requires a non-empty value before delegating.
 * Returns { ok, email } with the normalized (trimmed) address.
 */
export function validateUserEmail(text: string): { ok: boolean; email?: string } {
  if (!text || typeof text !== 'string' || !text.trim()) return { ok: false };
  const cleaned = text.trim();
  const r = validateLibEmail(cleaned);
  return r.valid ? { ok: true, email: cleaned } : { ok: false };
}

// ── Stage 1 — Fake-ZIP detection ────────────────────────────────────────────
// ChatBot.tsx (line ~4382) and LeadForm.tsx (line ~16) both define an inline
// FAKE_ZIPS list, but those files are do-not-touch. So we mirror the SAME 14
// values here (the only approved place to add it) and expose isFakeZip().
// extractZip()'s return is intentionally unchanged — callers run isFakeZip()
// separately so they can decide whether to accept the parsed ZIP.
const FAKE_ZIPS = new Set<string>([
  '00000', '11111', '22222', '33333', '44444', '55555', '66666', '77777',
  '88888', '99999', '12345', '54321', '11223', '00001',
]);

/**
 * True when a 5-digit ZIP is an obvious fake: in the known FAKE_ZIPS list,
 * all-same-digit (e.g. '00000'), or a strict ascending/descending sequence
 * (e.g. '12345' / '54321'). Pure + bilingual-agnostic (digits only).
 */
export function isFakeZip(zip: string): boolean {
  if (!zip || typeof zip !== 'string') return false;
  const z = zip.trim();
  if (!/^\d{5}$/.test(z)) return false;
  if (FAKE_ZIPS.has(z)) return true;
  // All-same-digit (00000, 11111, ...).
  if (/^(\d)\1{4}$/.test(z)) return true;
  // Strict ascending or descending run across all 5 digits (12345 / 54321).
  let asc = true, desc = true;
  for (let i = 1; i < z.length; i++) {
    const a = Number(z[i]);
    const b = Number(z[i - 1]);
    if (a !== b + 1) asc = false;
    if (a !== b - 1) desc = false;
  }
  return asc || desc;
}

// ── Out-of-scope categorization (when user picks "Different topic" or B fails) ──

const DENTAL_KEYWORDS = /\b(dental|dentist|dientes|dentista|implante|carilla|braces|invisalign)\b/i;
const LIFE_KEYWORDS = /\b(life insurance|seguro de vida|funeral|burial|término|term life|whole life)\b/i;
const AUTO_HOME_KEYWORDS = /\b(auto|car insurance|seguro de auto|home insurance|seguro de hogar|homeowner|renter)\b/i;
const MEDICAID_ONLY_KEYWORDS = /(medicaid sin medicare|medicaid only|just medicaid|solo medicaid|just have medicaid|tengo medicaid|food stamps|snap)/i;
const MEDICAL_QUESTION_KEYWORDS = /\b(síntoma|sintoma|dolor|medicina|prescripción|cita médica|appointment|symptom|pain|diagnos)\b/i;

export function categorizeOutOfScope(text: string): OutOfScopeCategory {
  if (!text || typeof text !== 'string') return 'other';
  const t = text.toLowerCase();
  if (DENTAL_KEYWORDS.test(t)) return 'dental_only';
  if (LIFE_KEYWORDS.test(t)) return 'life_insurance';
  if (AUTO_HOME_KEYWORDS.test(t)) return 'auto_home_insurance';
  if (MEDICAID_ONLY_KEYWORDS.test(t)) return 'medicaid_only';
  if (MEDICAL_QUESTION_KEYWORDS.test(t)) return 'medical_question';
  return 'other';
}

// ── PHASE 11.1 — Free-text inference helpers (replaces chip-driven UX) ──────
// Clara now starts with a natural greeting and lets the user type freely.
// These helpers silently infer path / medicare / state / topic from natural
// language so Clara can ask ONE natural follow-up at a time instead of
// showing a robotic chip menu.

// Sawil 2026-06 — Service-issue phrases. These only make sense for someone
// who already has a plan, so they're a strong Path A signal (existing
// client support). Covers card, billing, network, pharmacy, prescription,
// referral, prior auth, doctor lookup, etc. Bilingual EN/ES.
// SERVICE_KEYWORDS removed (Sawil 2026-06): described problems no longer route to
// Path A. Existing-client routing now requires an explicit A_KEYWORDS statement.

const A_KEYWORDS = /(soy cliente|i am a client|i'?m a client|mi asesor|my advisor|client of|update my|tengo un caso|case number|mi caso|existing client|cliente actual)/i;
const C_KEYWORDS_DENTAL = /\b(dental|dentist|dentista|braces|invisalign|implante)\b/i;
const C_KEYWORDS_LIFE = /(life insurance|seguro de vida|funeral|burial|term life|whole life)/i;
const C_KEYWORDS_AUTO_HOME = /\b(auto insurance|car insurance|home insurance|homeowner|renter|seguro de auto|seguro de hogar)\b/i;
const C_KEYWORDS_MEDICAID_ONLY = /(just have medicaid|tengo medicaid|solo medicaid|medicaid only|just medicaid|food stamps|snap benefits)/i;

/** First-message intent inference. Returns 'A' / 'C' for clear signals,
 *  'ambiguous' when more info is needed (Clara then asks one natural q). */
export function inferInitialPath(text: string): 'A' | 'C' | 'ambiguous' {
  if (!text) return 'ambiguous';
  // Premium flow (Sawil 2026-06): a described problem (bill, doctor, medication,
  // coverage, etc.) NO LONGER routes to existing-client verification. Only an
  // EXPLICIT "I'm a client" statement goes to Path A; every other problem flows
  // to the helpful Path B (problem → ZIP → help/capture). This stops new
  // prospects from being asked for "the last 4 digits we have on file".
  if (A_KEYWORDS.test(text)) return 'A';
  if (C_KEYWORDS_DENTAL.test(text) || C_KEYWORDS_LIFE.test(text) ||
      C_KEYWORDS_AUTO_HOME.test(text) || C_KEYWORDS_MEDICAID_ONLY.test(text)) return 'C';
  return 'ambiguous';
}

/** "Yes I'm a client" detector for the follow-up question. */
export function inferYesClient(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  if (/^(no|n|not|tampoco|nope|nada)/.test(t)) return false;
  return /(s[ií]|yes|y\b|client|cliente|i am|i'?m|sí soy|si soy|claro que sí|claro que si)/i.test(t);
}

export function inferMedicareStatus(text: string): MedicareStatus {
  if (!text) return 'none';
  const t = text.toLowerCase();
  if (/(a\s*\+\s*b|parte a y b|parts? a and b|partes a y b|tengo medicare|i have medicare|enrolled in medicare|inscrito|activo|active|medicare desde)/i.test(t)) return 'AB_active';
  if (/(65|sixty.?five|cerca|near|approaching|coming up|cumpl[oai]r|turning|próximo|proximo a)/i.test(t)) return 'near_65';
  return 'none';
}

// ZIP→state mapping using USPS first-3-digit prefixes. Returns null when no
// 5-digit ZIP is found. Returns 'other' when ZIP is valid but outside the
// NY/NJ/CT service area (compliance: do not surface any non-service state).
export function extractZip(text: string): { zip: string; state: ClaraState } | null {
  if (!text) return null;
  // 5 contiguous digits not preceded/followed by another digit (so we don't
  // match a phone-number chunk). Tolerates the user typing "10001" or
  // "my zip is 10001".
  const m = text.match(/(?<!\d)(\d{5})(?!\d)/);
  if (!m) return null;
  const zip = m[1];
  const prefix = parseInt(zip.slice(0, 3), 10);
  let state: ClaraState = 'other';
  if (prefix >= 100 && prefix <= 149) state = 'NY';
  else if (prefix >= 70 && prefix <= 89) state = 'NJ';
  else if (prefix >= 60 && prefix <= 69) state = 'CT';
  // Every other ZIP — including FL prefixes 320-349 — collapses to 'other'
  // and is treated as out-of-service-area. No state-specific branch.
  return { zip, state };
}

export function inferStateFromText(text: string): ClaraState {
  if (!text) return 'other';
  const t = text.toLowerCase();
  if (/\b(ny|new york|nueva york|n\.?y\.?)\b/.test(t)) return 'NY';
  if (/\b(nj|new jersey|nueva jersey|jersey|n\.?j\.?)\b/.test(t)) return 'NJ';
  if (/\b(ct|connecticut|conn\.?)\b/.test(t)) return 'CT';
  // FL / out-of-service-area collapses silently to 'other' — no FL branch.
  return 'other';
}

// FASE 2 (audit bug I) — Medicare abbreviation dictionary. Expands standalone
// abbreviations to full terms so a short reply like "ma", "PDP", "MSP" is
// recognized as a real Medicare term instead of "didn't understand". Applied
// before topic classification in the outer flow. PA/QI are intentionally
// omitted (too ambiguous with common words / state codes).
const MEDICARE_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bmapd\b/gi, 'medicare advantage prescription drug plan'],
  [/\bma\b/gi, 'medicare advantage'],
  [/\bpdp\b/gi, 'part d prescription drug plan'],
  [/\bd[-\s]?snp\b/gi, 'dual special needs plan medicaid'],
  [/\bc[-\s]?snp\b/gi, 'chronic special needs plan'],
  [/\bi[-\s]?snp\b/gi, 'institutional special needs plan'],
  [/\bsnp\b/gi, 'special needs plan'],
  [/\blis\b/gi, 'extra help low income subsidy'],
  [/\bmsp\b/gi, 'medicare savings program'],
  [/\bqmb\b/gi, 'qualified medicare beneficiary'],
  [/\bslmb\b/gi, 'specified low income medicare beneficiary'],
  [/\birmaa\b/gi, 'income related monthly adjustment premium'],
  [/\bpcp\b/gi, 'primary care provider doctor'],
  [/\beob\b/gi, 'explanation of benefits bill'],
  [/\bmoop\b/gi, 'maximum out of pocket cost'],
];

/** Expand standalone Medicare abbreviations to full terms (case-insensitive). */
export function expandMedicareAbbreviations(text: string): string {
  if (!text) return text;
  let out = text;
  for (const [re, full] of MEDICARE_ABBREVIATIONS) out = out.replace(re, full);
  return out;
}

export function inferTopic(text: string): ClaraTopic {
  if (!text) return 'other';
  const t = expandMedicareAbbreviations(text).toLowerCase();
  if (/(plan review|revisar mi plan|revisión de plan|coverage|cobertura|review my plan|change plan|cambiar plan|otro plan)/i.test(t)) return 'plan';
  if (/(bill|factura|charge|cobro|copay|copago|premium|prima|cost|costo|deducible|deductible|owe|me cobraron)/i.test(t)) return 'billing';
  if (/(doctor|specialist|provider|red|network|in.?network|out.?of.?network|red de|médico|medico|especialista|primary care|pcp)/i.test(t)) return 'doctor';
  if (/(medication|prescription|drug|medicina|medicamento|receta|farmacia|pharmacy|formulary|formulario)/i.test(t)) return 'medication';
  return 'other';
}

// ── Phase 1 (Sawil 2026-06) — Shared-memory hydration ───────────────────────
// Maps everything the scripted outer flow already captured into the engine's
// ConversationState, so the engine does NOT restart intake (language / ZIP /
// topic) from zero when the outer flow hands off. PURE + ADDITIVE:
//   • copies a field only when it exists,
//   • never overwrites valid data with empties,
//   • never mutates the inputs,
//   • never resets the conversation or erases messages.

const TOPIC_TO_CATEGORY: Record<ClaraTopic, string> = {
  plan: 'plan_review',
  billing: 'billing',
  doctor: 'doctor_provider_network',
  medication: 'medication',
  other: 'general',
};

/**
 * Build a Partial<ConversationState> patch from the scripted outer state +
 * the on-screen conversation history. Caller spreads this over the engine
 * state at handoff. Returns ONLY the keys it can populate; missing fields
 * stay undefined so the engine asks for them naturally.
 */
export function outerStateToEngine(
  outer: ClaraOuterState,
  messages: ReadonlyArray<{ sender: 'user' | 'bot'; text: string }> = [],
): Partial<ConversationState> {
  const patch: Partial<ConversationState> = {};

  if (outer.language) patch.language = outer.language;
  if (outer.zip) {
    patch.zipCode = outer.zip;
    patch.zipCodeIsValid = outer.state ? outer.state !== 'other' : true;
  }
  // Only surface in-service states (NY/NJ/CT). 'other' stays undefined so the
  // engine treats it as out-of-area — compliance-safe.
  if (outer.state && outer.state !== 'other') {
    patch.state = outer.state;
    patch.isValidState = true;
  }
  if (outer.topic) patch.serviceCategory = TOPIC_TO_CATEGORY[outer.topic];
  if (outer.problemSummary) patch.currentProblem = outer.problemSummary;
  if (outer.fullName) {
    patch.name = outer.fullName;
    patch.nameIsValid = true;
  }
  if (outer.phone) patch.phoneNumber = outer.phone;
  if (outer.path) patch.routingLevel = outer.path;

  // Preserve the real conversation thread so the LLM/engine sees everything
  // the user already said (capped downstream by buildHistory to 20 turns).
  const hist = messages
    .filter((m) => m && typeof m.text === 'string' && m.text.length > 0)
    .map((m) => ({
      role: (m.sender === 'user' ? 'user' : 'bot') as 'user' | 'bot',
      content: m.text,
      timestamp: Date.now(),
    }));
  if (hist.length > 0) patch.messages = hist;

  return patch;
}

// ── Phase A (Sawil 2026-06) — Direct-question priority ──────────────────────
// When the user asks Clara a DIRECT META-QUESTION during the scripted intake
// (e.g. "cuál es mi zona", "es gratis?", "quiénes son?"), Clara must ANSWER
// the question first instead of bulldozing ahead with the next intake step.
// This is a SMALL, compliance-safe whitelist — only questions Clara can
// answer accurately. Everything else falls through to normal routing (the
// LLM/engine handles open Q&A). No plan recommendations, no eligibility
// claims, no fabricated facts. Pure function — returns the answer string, or
// null when the message is not a recognized meta-question.

const META_ZONE_Q = /(cu[aá]l\s+es\s+mi\s+(zona|[aá]rea)|qu[eé]\s+(zona|[aá]rea)\s+(es|tengo)|mi\s+(zona|[aá]rea)\b|what.{0,8}\bmy\s+(zone|area)|which\s+(zone|area)|what\s+(zone|area)\s+am\s+i)/i;
const META_COST_Q = /(es\s+gratis|tiene\s+(alg[uú]n\s+)?costo|cu[aá]nto\s+(cuesta|cobran|vale)|is\s+(it|this)\s+free|how\s+much\s+(does|is)|any\s+cost|cost\s+anything|free\s*\?)/i;
const META_WHO_Q = /(qui[eé]n(es)?\s+son|qu[eé]\s+es\s+clear\s*point|son\s+ustedes\s+medicare|who\s+are\s+you|what\s+is\s+clear\s*point|are\s+you\s+medicare)/i;
const META_WHY_ZIP_Q = /(por\s+qu[eé].{0,25}(zip|c[oó]digo|postal)|para\s+qu[eé].{0,25}(zip|c[oó]digo|postal)|why.{0,25}(zip|postal|code))/i;

export function answerMetaQuestion(
  text: string,
  outer: ClaraOuterState,
  zipInfo: { city: string; county: string; state: string } | null,
  isEs: boolean,
): string | null {
  if (!text) return null;

  // Zone / area — only answerable once we have a ZIP on file.
  if (META_ZONE_Q.test(text) && outer.zip) {
    // COMPLIANCE (Sawil 2026-06): only NAME the city/county/state when the ZIP
    // is inside the active service area (NY/NJ/CT). For ANY out-of-service ZIP
    // — including Florida — we must NOT surface the place name (zipLookup still
    // knows "Miami, Florida", but Clara must never say it). Confirm the ZIP as
    // the service zone generically instead.
    const inService = outer.state === 'NY' || outer.state === 'NJ' || outer.state === 'CT';
    if (inService && zipInfo && zipInfo.city) {
      const place = `${zipInfo.city}, ${zipInfo.county}, ${zipInfo.state}`;
      return isEs
        ? `Su código postal ${outer.zip} corresponde a ${place}. Para Medicare, usaré ${outer.zip} como su zona de servicio. La disponibilidad de planes puede variar por código postal, condado y red.`
        : `Your ZIP code ${outer.zip} maps to ${place}. For Medicare, I'll use ${outer.zip} as your service area. Plan availability can vary by ZIP code, county, and network.`;
    }
    return isEs
      ? `Usaré su código postal ${outer.zip} como su zona de servicio. La disponibilidad de planes de Medicare puede variar por código postal, condado y red.`
      : `I'll use your ZIP code ${outer.zip} as your service area. Medicare plan availability can vary by ZIP code, county, and network.`;
  }

  if (META_COST_Q.test(text)) {
    return isEs
      ? 'Nuestro servicio no tiene ningún costo para usted. Clear Point es un broker de Medicare independiente y licenciado — sin presión.'
      : 'Our service is at no cost to you. Clear Point is an independent, licensed Medicare broker — no pressure.';
  }

  if (META_WHO_Q.test(text)) {
    return isEs
      ? 'Clear Point Senior Advisors es una agencia independiente y licenciada de seguros de Medicare. No somos Medicare ni una agencia del gobierno; le orientamos sin costo y sin presión.'
      : 'Clear Point Senior Advisors is an independent, licensed Medicare insurance agency. We are not Medicare or a government agency; we guide you at no cost and no pressure.';
  }

  if (META_WHY_ZIP_Q.test(text)) {
    return isEs
      ? 'Le pido el código postal solo para confirmar su área de servicio — la disponibilidad de planes depende de la zona. No es información sensible.'
      : 'I ask for your ZIP only to confirm your service area — plan availability depends on the zone. It is not sensitive information.';
  }

  return null;
}

// ── Qualification check ──────────────────────────────────────────────────────

const QUALIFYING_STATES: ClaraState[] = ['NY', 'NJ', 'CT'];

/** True if (Medicare A+B OR near 65) AND state in NY/NJ/CT AND topic is Medicare-related. */
export function isQualifiedProspect(s: ClaraOuterState): boolean {
  // medicareStatus is no longer required — Clara stopped asking "do you have
  // Medicare A/B?" (Sawil 2026-06). An in-service prospect with a real topic
  // qualifies; the licensed advisor confirms Medicare status on the call.
  if (!s.state || !QUALIFYING_STATES.includes(s.state)) return false;
  if (!s.topic) return false;
  return true;
}

/** Legacy stub kept for API stability — Florida no longer surfaces. */
export function isFlInterest(_s: ClaraOuterState): boolean {
  return false;
}

// ── GHL payload builder ──────────────────────────────────────────────────────

export interface BuildPayloadOpts {
  consentText?: string;
  consentReceiptHash?: string;
  disclaimerVersion?: string;
  ip?: string;
  userAgent?: string;
  problemSummary?: string;
  /** FASE 2 audit J — true ONLY when the user explicitly accepted TCPA consent. */
  consentGiven?: boolean;
}

export interface ClaraGhlPayload {
  lead_type: NonNullable<ClaraOuterState['finalLeadType']>;
  tags: string[];
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  preferred_language: 'en' | 'es';
  state?: string;
  medicare_status?: string;
  interest_type?: string;
  best_time_to_contact?: string;
  consent_to_contact: boolean;
  consent_text: string;
  lead_notes: string;
  bot_transcript_summary: string;
  // Audit metadata
  disclaimer_version?: string;
  consent_receipt_hash?: string;
  signer_ip?: string;
  signer_user_agent?: string;
  // For existing client (A) only
  ghl_contact_id?: string;
  ghl_assigned_user_id?: string;
  // Source
  lead_source: string;
  created_at: string;
}

function splitName(full?: string): { first: string; last: string } {
  if (!full) return { first: '', last: '' };
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export function buildGhlPayload(
  s: ClaraOuterState,
  opts: BuildPayloadOpts = {},
): ClaraGhlPayload {
  const { first, last } = splitName(s.fullName);
  const tags = ['Clara-Bot'];
  let leadType: NonNullable<ClaraOuterState['finalLeadType']> = s.finalLeadType || 'qualified_prospect';

  if (s.path === 'A') {
    if (s.verifiedContactId) {
      leadType = 'existing_client_inquiry';
      tags.push('existing-client', 'verified-name-phone');
    } else {
      leadType = 'existing_client_unverified';
      tags.push('claims-existing-client', 'verification-failed', 'needs-manual-review');
    }
  } else if (s.path === 'B') {
    leadType = 'qualified_prospect';
    tags.push('qualified-prospect');
    if (s.medicareStatus) tags.push(`medicare-status-${s.medicareStatus}`);
    if (s.state) tags.push(`state-${s.state}`);
    if (s.topic) tags.push(`category-${s.topic}`);
  } else if (s.path === 'C') {
    // Out-of-service-area (incl. legacy FL) collapses into the same Path C
    // bucket as any other out-of-scope opt-in. No state-specific tag is
    // emitted — compliance: do not identify out-of-service states.
    {
      leadType = 'out_of_scope_optin_callback';
      tags.push('out-of-scope-callback');
      if (s.outOfScopeCategory) tags.push(`original-topic-${s.outOfScopeCategory}`);
    }
  }

  const noteParts: string[] = [];
  if (s.path) noteParts.push(`Path: ${s.path}`);
  if (s.medicareStatus) noteParts.push(`Medicare: ${s.medicareStatus}`);
  if (s.state) noteParts.push(`State: ${s.state}`);
  if (s.topic) noteParts.push(`Topic: ${s.topic}`);
  if (s.outOfScopeCategory) noteParts.push(`Out-of-scope: ${s.outOfScopeCategory}`);
  if (s.verifiedContactId) noteParts.push(`Verified contact_id: ${s.verifiedContactId}`);
  if (s.assignedAdvisorName) noteParts.push(`Advisor: ${s.assignedAdvisorName}`);
  if (opts.problemSummary || s.problemSummary) {
    noteParts.push(`Summary: ${opts.problemSummary || s.problemSummary}`);
  }

  return {
    lead_type: leadType,
    tags,
    first_name: first,
    last_name: last,
    phone: s.phone || '',
    email: s.email || '',
    preferred_language: s.language,
    state: s.state || '',
    medicare_status: s.medicareStatus || '',
    interest_type: s.topic || '',
    best_time_to_contact: '',
    // FASE 2 audit J (TCPA) — NEVER claim a consent the bot did not explicitly
    // collect from the user. There is no visible in-chat consent step yet, so
    // consent_to_contact is FALSE: every Clara lead queues for a manual licensed
    // advisor callback (NO auto-dial), matching the other lead path. Once a
    // visible consent confirmation is added, set this from that explicit accept.
    consent_to_contact: opts.consentGiven === true,
    consent_text: opts.consentText || '',
    lead_notes: noteParts.join(' · '),
    bot_transcript_summary: `${s.language.toUpperCase()} · Clara · ${leadType} · path=${s.path || '?'}`,
    disclaimer_version: opts.disclaimerVersion,
    consent_receipt_hash: opts.consentReceiptHash,
    signer_ip: opts.ip,
    signer_user_agent: opts.userAgent,
    ghl_contact_id: s.verifiedContactId,
    ghl_assigned_user_id: s.assignedUserId,
    lead_source: 'clara_bot',
    created_at: new Date().toISOString(),
  };
}

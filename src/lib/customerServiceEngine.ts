/**
 * Customer Service Engine — pure logic for the ClearPoint Customer Service Box.
 *
 * Mission: Keep ALL non-UI logic in one file so the same engine can later power
 * a phone/voice intake without rewriting detectors or the summary builder.
 *
 * This module is import-safe from any environment (browser, Node, edge). It
 * does NOT import React, does NOT touch the DOM, and does NOT call any API.
 *
 * Patterns reused conceptually from Zara (src/components/ChatBot.tsx) WITHOUT
 * sharing code:
 *   - Bilingual keyword + phrase matching with accent-insensitive normalization
 *   - Multi-topic detection (primary + secondary intents with confidence)
 *   - Sensitive-info interception BEFORE any storage / submission
 *   - Emergency interception BEFORE any further conversation
 *   - Frustration / confusion acknowledgement before re-prompting
 *   - Bilingual summary builder that an advisor can read in 5 seconds
 *
 * Scope safety: this file is read-only from the perspective of GHL — it does
 * not call any endpoint. The UI component decides when to submit. The engine
 * only produces the payload-shaped summary.
 */

import { classifyIntent as classifyIntentRaw, getIntent, type IntentId, type IntentUrgency } from '../data/customerServiceIntents';

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE
// ─────────────────────────────────────────────────────────────────────────────

export type SupportLang = 'en' | 'es';

const ES_STOPWORDS = new Set([
  'de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'las', 'un', 'por',
  'con', 'no', 'una', 'su', 'para', 'es', 'al', 'mi', 'mis', 'me', 'tu', 'sus',
  'como', 'cuando', 'donde', 'quien', 'porque', 'pero', 'esta', 'esto', 'soy',
  'tengo', 'tiene', 'estoy', 'puedo', 'quiero', 'necesito', 'cubre', 'tarjeta',
]);
const EN_STOPWORDS = new Set([
  'the', 'is', 'and', 'a', 'to', 'of', 'in', 'for', 'on', 'with', 'i', 'you',
  'it', 'my', 'we', 'they', 'what', 'when', 'where', 'who', 'why', 'how', 'am',
  'have', 'has', 'need', 'want', 'can', 'do', 'does', 'this', 'that', 'help',
  'card', 'plan',
]);

/** Best-effort detection. Returns 'mixed' when there is not enough signal. */
export function detectLanguage(text: string): SupportLang | 'mixed' {
  const words = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/);
  let es = 0, en = 0;
  for (const w of words) {
    if (ES_STOPWORDS.has(w)) es++;
    if (EN_STOPWORDS.has(w)) en++;
  }
  if (es === 0 && en === 0) return 'mixed';
  if (es > en * 1.5) return 'es';
  if (en > es * 1.5) return 'en';
  return 'mixed';
}

// ─────────────────────────────────────────────────────────────────────────────
// SENSITIVE-INFO DETECTOR
//
// What we INTERCEPT (never store, never submit):
//   - Medicare MBI pattern (1XXX-XX-XXXX with first digit non-zero, letters
//     interleaved per CMS spec).
//   - SSN (9-digit pattern not matching a phone area-code/exchange/line shape).
//   - Card numbers (13–19 digit groupings).
//   - Bank routing numbers (9-digit standalone).
// ─────────────────────────────────────────────────────────────────────────────

export type SensitivePattern = 'medicare_id' | 'ssn' | 'card_number' | 'bank_routing' | null;

export interface SensitiveCheck {
  isSensitive: boolean;
  pattern: SensitivePattern;
}

export function detectSensitive(text: string): SensitiveCheck {
  const normalized = text.replace(/\s+/g, ' ').trim();
  // MBI format per CMS: 11 alphanumeric chars in 4-3-4 groups, e.g. "1EG4-TE5-MK73".
  // First char is digit 1-9; chars 2/5/8 are letters; rest can be digit or letter.
  const mbi = /\b[1-9][A-Z][A-Z0-9][A-Z0-9]-?[A-Z][A-Z0-9]{2}-?[A-Z][A-Z0-9]{3}\b/i;
  if (mbi.test(normalized)) return { isSensitive: true, pattern: 'medicare_id' };

  const phone = /\b\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4}\b/;
  const ssn = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
  if (ssn.test(normalized) && !phone.test(normalized)) return { isSensitive: true, pattern: 'ssn' };

  const card = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/;
  if (card.test(normalized)) return { isSensitive: true, pattern: 'card_number' };

  const routing = /\b\d{9}\b/;
  if (routing.test(normalized) && !phone.test(normalized)) return { isSensitive: true, pattern: 'bank_routing' };

  return { isSensitive: false, pattern: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMERGENCY DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

const EMERGENCY_KEYWORDS = [
  // English
  'chest pain', "can't breathe", 'cant breathe', 'cannot breathe', 'cannot breath',
  'heart attack', 'stroke', 'severe pain', 'dying', '911', 'ambulance',
  'suicide', 'kill myself', 'hurt myself', 'self harm', 'self-harm', 'overdose',
  'medical emergency', 'er right now', 'going to die', 'emergency room',
  // Spanish
  'dolor de pecho', 'no puedo respirar', 'no respiro', 'infarto', 'ataque al corazon',
  'derrame', 'dolor severo', 'muriendo', 'ambulancia', 'me duele el pecho',
  'suicidio', 'matarme', 'lastimarme', 'autolesion', 'auto lesion', 'sobredosis',
  'emergencia medica', 'sala de emergencia', 'voy a morir', 'me quiero hacer dano',
  'me quiero hacer daño',
];

export function detectEmergency(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const kw of EMERGENCY_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRUSTRATION / CONFUSION DETECTOR
//
// We want to acknowledge the human BEFORE re-prompting. Triggering this flag
// makes the next bot turn lead with empathy ("I understand. Medicare can be
// confusing. Let's go step by step.") instead of jumping back to the form.
// ─────────────────────────────────────────────────────────────────────────────

const FRUSTRATION_PHRASES = [
  // English
  "i don't understand", 'i dont understand', "i don't get it", 'i dont get it',
  'i am confused', "i'm confused", 'im confused', 'i am lost', "i'm lost", 'im lost',
  'this is confusing', 'this is too much', 'no one is helping',
  'nobody is helping', 'no help', "i don't know what to do",
  'i dont know what to do', 'i am frustrated', "i'm frustrated", 'im frustrated',
  'this is awful', 'this is terrible', 'this is ridiculous',
  // Spanish
  'no entiendo', 'no entendi', 'no comprendo', 'estoy confundido',
  'estoy confundida', 'estoy perdido', 'estoy perdida', 'esto es confuso',
  'esto es mucho', 'nadie me ayuda', 'no me ayudan', 'no se que hacer',
  'estoy frustrado', 'estoy frustrada', 'estoy molesto', 'estoy molesta',
  'me tienen loco', 'me tienen loca', 'esto es horrible', 'esto es terrible',
  'muy confundido', 'muy confundida', 'muy frustrado', 'muy frustrada',
  'muy molesto', 'muy molesta', 'muy perdido', 'muy perdida',
];

export function detectFrustration(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const phrase of FRUSTRATION_PHRASES) {
    if (lower.includes(phrase)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT CLASSIFICATION (multi-topic)
//
// Thin wrapper around the deterministic classifier in customerServiceIntents.ts.
// Exposed here so the UI imports only from `customerServiceEngine`.
// ─────────────────────────────────────────────────────────────────────────────

export interface IntentResult {
  primary: IntentId;
  secondary: IntentId[];
  confidence: 'high' | 'medium' | 'low';
}

export function classifyIntent(text: string, lang: SupportLang): IntentResult {
  return classifyIntentRaw(text, lang);
}

/** Bilingual human-readable label for an intent (used in multi-topic acknowledgement). */
export function intentLabel(id: IntentId, lang: SupportLang): string {
  const map: Record<IntentId, { en: string; es: string }> = {
    annual_review: { en: 'plan review', es: 'revisión de plan' },
    medication_help: { en: 'medications', es: 'medicamentos' },
    doctor_network_question: { en: 'doctor / network', es: 'doctores o red' },
    plan_letter_issue: { en: 'a letter or plan issue', es: 'una carta o problema del plan' },
    possible_loss_of_coverage: { en: 'possible coverage loss', es: 'posible pérdida de cobertura' },
    extra_help_lis: { en: 'Extra Help / LIS', es: 'Extra Help / LIS' },
    medicaid_msp: { en: 'Medicaid / cost help', es: 'Medicaid / ayuda con costos' },
    cost_help: { en: 'reducing costs', es: 'reducir costos' },
    benefit_card_issue: { en: 'OTC / benefit card', es: 'tarjeta OTC / beneficios' },
    otc_question: { en: 'OTC benefits', es: 'beneficios OTC' },
    appointment_requested: { en: 'scheduling a call', es: 'agendar una llamada' },
    call_requested: { en: 'a call back', es: 'una llamada de regreso' },
    new_to_medicare: { en: 'getting started with Medicare', es: 'comenzar con Medicare' },
    confused_customer: { en: 'general help', es: 'ayuda general' },
    complaint: { en: 'a complaint', es: 'una queja' },
    general_medicare_question: { en: 'a general Medicare question', es: 'una pregunta general de Medicare' },
    other_unknown: { en: 'something else', es: 'otro tema' },
  };
  return map[id][lang];
}

/** Multi-topic acknowledgement copy used when classifier returns ≥1 secondary intent. */
export function buildMultiTopicAck(primary: IntentId, secondary: IntentId[], lang: SupportLang): string {
  if (secondary.length === 0) return '';
  const all = [primary, ...secondary].map((id) => intentLabel(id, lang));
  const list = all.slice(0, -1).join(', ') + (lang === 'es' ? ' y ' : ' and ') + all[all.length - 1];
  if (lang === 'es') {
    return `Veo varios temas importantes: ${list}. Para no confundirnos, voy a organizarlo por partes.`;
  }
  return `I see a few important topics: ${list}. So we don't get mixed up, I'll organize this step by step.`;
}

/** Human support-tone acknowledgement when the user expresses confusion/frustration. */
export function frustrationAck(lang: SupportLang): string {
  return lang === 'es'
    ? 'Entiendo. Medicare puede ser confuso. Vamos paso a paso para organizar su situación correctamente.'
    : "I understand. Medicare can be confusing. Let's go step by step so we can organize your situation correctly.";
}

/** Advisor-handoff safe language. Mandatory before any plan-specific question is closed out. */
export function advisorHandoffLine(lang: SupportLang): string {
  return lang === 'es'
    ? 'Puedo organizar esto para revisión, pero un asesor licenciado debe verificar los detalles específicos del plan antes de que usted tome una decisión.'
    : 'I can organize this for review, but a licensed advisor must verify plan-specific details before you make a decision.';
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE SUMMARY BUILDER
//
// Structured, advisor-readable summary. Keeps every flag the GHL workflow will
// later need so it can route by language / urgency / tag without parsing prose.
// ─────────────────────────────────────────────────────────────────────────────

export interface CaseState {
  session_id: string;
  started_at: string;
  language: SupportLang;
  preferred_language: 'English' | 'Spanish' | 'Either' | '';
  language_switches: number;
  primary_intent: IntentId | null;
  secondary_intents: IntentId[];
  urgency: IntentUrgency;
  requires_agent_review: boolean;
  privacy_warning_shown: boolean;
  sensitive_data_intercepted: boolean;
  emergency_warning_shown: boolean;
  frustration_detected: boolean;
  consent_to_contact: boolean;
  first_name: string;
  phone: string;
  state: string;
  zip: string;
  best_time_to_call: string;
  customer_questions: string[];
}

/** What information is still missing for an advisor to follow up effectively. */
export function listMissingInfo(s: CaseState, lang: SupportLang): string[] {
  const missing: string[] = [];
  if (!s.first_name) missing.push(lang === 'es' ? 'nombre' : 'first name');
  if (!s.phone) missing.push(lang === 'es' ? 'teléfono' : 'phone number');
  if (!s.state) missing.push(lang === 'es' ? 'estado' : 'state');
  if (!s.best_time_to_call) missing.push(lang === 'es' ? 'mejor hora para llamar' : 'best callback time');
  if (!s.consent_to_contact) missing.push(lang === 'es' ? 'consentimiento para contacto' : 'consent to contact');
  return missing;
}

/** Recommended next action for the advisor reading this case. */
export function recommendedNextAction(s: CaseState): string {
  const urgentTag = s.urgency === 'urgent' ? '[URGENT] ' : s.urgency === 'high' ? '[HIGH] ' : '';
  if (s.emergency_warning_shown) {
    return `${urgentTag}Customer was shown an emergency warning during the chat. Verify safety first, then follow up on the Medicare question if appropriate.`;
  }
  if (s.requires_agent_review) {
    return `${urgentTag}A licensed advisor should review this case and follow up with the customer at the phone number captured. Verify plan-specific details before any recommendation.`;
  }
  return `${urgentTag}Educational request. A licensed advisor can follow up if needed.`;
}

/** Multi-line case summary written in stable, parseable shape. */
export function buildCaseSummary(s: CaseState): string {
  const langStr = s.language_switches > 0
    ? `${s.preferred_language || (s.language === 'es' ? 'Spanish' : 'English')} (bilingual conversation, ${s.language_switches} switches)`
    : (s.preferred_language || (s.language === 'es' ? 'Spanish' : 'English'));

  const secondaryStr = s.secondary_intents.length > 0
    ? s.secondary_intents.join(', ')
    : 'none';

  const questionsStr = s.customer_questions.length > 0
    ? s.customer_questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')
    : '  (no free-text questions captured)';

  const tone = s.frustration_detected
    ? 'Customer expressed confusion or frustration; bot acknowledged before continuing.'
    : 'Calm.';

  const collected: string[] = [];
  if (s.first_name) collected.push(`first name (${s.first_name})`);
  if (s.phone) collected.push(`phone (${s.phone})`);
  if (s.state) collected.push(`state (${s.state})`);
  if (s.zip) collected.push(`ZIP (${s.zip})`);
  if (s.best_time_to_call) collected.push(`best callback time (${s.best_time_to_call})`);
  const collectedStr = collected.length > 0 ? collected.join(', ') : 'none';

  const needed = listMissingInfo(s, 'en');
  const neededStr = needed.length > 0 ? needed.join(', ') : 'none';

  return [
    '[Customer Service Box]',
    `Submitted: ${new Date().toISOString()}`,
    `Session: ${s.session_id}`,
    `Language: ${langStr}`,
    '',
    'CASE',
    `Main issue: ${s.primary_intent || 'unknown'}`,
    `Secondary issues: ${secondaryStr}`,
    `Urgency: ${s.urgency}`,
    `Customer tone: ${tone}`,
    '',
    'CUSTOMER CONTEXT',
    `State: ${s.state || 'not provided'}`,
    `ZIP: ${s.zip || 'not provided'}`,
    `Best time to call: ${s.best_time_to_call || 'not specified'}`,
    `Consent to contact: ${s.consent_to_contact ? 'YES' : 'NO'}`,
    `Privacy warning shown: ${s.privacy_warning_shown ? 'YES' : 'NO'}`,
    `Sensitive info blocked: ${s.sensitive_data_intercepted ? 'YES' : 'NO'}`,
    `Emergency warning shown: ${s.emergency_warning_shown ? 'YES' : 'NO'}`,
    '',
    'CUSTOMER QUESTIONS',
    questionsStr,
    '',
    'INFORMATION COLLECTED',
    `  ${collectedStr}`,
    '',
    'INFORMATION STILL NEEDED',
    `  ${neededStr}`,
    '',
    'RECOMMENDED NEXT ACTION',
    recommendedNextAction(s),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// GHL TAGS
// ─────────────────────────────────────────────────────────────────────────────

export function buildSupportTags(s: CaseState): string[] {
  const tags: string[] = ['customer_service_bot', 'clearpoint_support'];

  if (s.language_switches > 0) tags.push('bilingual');
  else tags.push(s.language === 'es' ? 'spanish' : 'english');

  if (s.primary_intent) {
    const primary = getIntent(s.primary_intent);
    if (!tags.includes(primary.ghl_tag)) tags.push(primary.ghl_tag);
  }
  for (const id of s.secondary_intents) {
    const def = getIntent(id);
    if (!tags.includes(def.ghl_tag)) tags.push(def.ghl_tag);
  }

  if (s.requires_agent_review) tags.push('needs_agent_review');
  if (s.urgency === 'urgent' || s.urgency === 'high') tags.push('urgent_review');
  if (s.privacy_warning_shown) tags.push('sensitive_warning_shown');
  if (s.emergency_warning_shown) tags.push('emergency_warning_shown');
  if (s.frustration_detected) tags.push('customer_frustrated');

  return tags;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE FORBIDDEN-PHRASE SCANNER
//
// Same negative list the rest of the site enforces. Used by the test harness
// to scan ALL bilingual COPY strings the bot can emit, so we cannot ship a
// build that says "you qualify", "guaranteed savings", "best plan", etc.
// ─────────────────────────────────────────────────────────────────────────────

export const FORBIDDEN_PHRASES_EN: string[] = [
  'you qualify',
  'you are qualified',
  'guaranteed savings',
  'guaranteed to save',
  'best plan',
  'the best plan',
  'affiliated with medicare',
  'affiliated with cms',
  'affiliated with the government',
  'free drug plan',
  'everyone qualifies',
  'we are medicare',
  'we are cms',
];
export const FORBIDDEN_PHRASES_ES: string[] = [
  'usted califica',
  'ustedes califican',
  'ahorros garantizados',
  'garantizado ahorrar',
  'mejor plan',
  'el mejor plan',
  'afiliado con medicare',
  'afiliados con medicare',
  'afiliado con cms',
  'afiliado con el gobierno',
  'plan gratis de medicamentos',
  'todos califican',
  'somos medicare',
  'somos cms',
];

export function scanForbiddenPhrases(text: string): string[] {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hits: string[] = [];
  for (const p of [...FORBIDDEN_PHRASES_EN, ...FORBIDDEN_PHRASES_ES]) {
    if (lower.includes(p)) hits.push(p);
  }
  return hits;
}

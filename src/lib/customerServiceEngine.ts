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
  // Run a light typo-tolerance pre-pass so "medicad", "medisina", "dotor",
  // "me subió el plan" etc. still classify correctly.
  const normalized = applyFuzzyTypos(text);
  return classifyIntentRaw(normalized, lang);
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
    employer_union_benefits: { en: 'employer / union / retiree benefits', es: 'beneficios de empleador / unión / retiro' },
    general_medicare_question: { en: 'a general Medicare question', es: 'una pregunta general de Medicare' },
    other_unknown: { en: 'something else', es: 'otro tema' },
  };
  return map[id][lang];
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY TYPO TOLERANCE
//
// Common misspellings senior users actually type. Mapped to the canonical
// keyword the classifier already understands. Applied as a pre-pass before
// classifyIntent so e.g. "medicad" still triggers medicaid_msp.
// ─────────────────────────────────────────────────────────────────────────────

const TYPO_MAP: Record<string, string> = {
  // Medicaid
  'medicad': 'medicaid', 'medikaid': 'medicaid', 'medicare aid': 'medicaid',
  // Medicare Advantage
  'medicare adbanage': 'medicare advantage', 'medicare advantadge': 'medicare advantage',
  'medicare advanteg': 'medicare advantage', 'medikare': 'medicare',
  // Medicine / medications
  'medisina': 'medicina', 'medesina': 'medicina', 'meds': 'medicine',
  'medisinas': 'medicinas', 'medesinas': 'medicinas',
  'medicinas caras': 'medicina cara',
  // Doctor
  'dotor': 'doctor', 'dr.': 'doctor', 'doctora': 'doctora',
  // Supplement
  'suplemento': 'supplement', 'medigap plan': 'medigap',
  // Retiree
  'retairo': 'retiro', 'retired': 'retiree',
  // Extra Help
  'extra ayuda': 'ayuda extra', 'lis program': 'lis',
  // Frequently misspelled phrases
  'me quitaron beneficio': 'perdi mi cobertura',
  'me quitaron beneficios': 'perdi mi cobertura',
  'me subio el plan': 'mi plan es caro',
  'me subió el plan': 'mi plan es caro',
  'pago mucho': 'medicare es muy caro',
};

export function applyFuzzyTypos(text: string): string {
  let out = text.toLowerCase();
  // Apply phrase-level substitutions in length-descending order so longer phrases match first.
  const keys = Object.keys(TYPO_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (out.includes(k)) {
      out = out.split(k).join(TYPO_MAP[k]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAREGIVER / FAMILY-MEMBER DETECTOR
//
// The user often is NOT the Medicare beneficiary. They might be a son,
// daughter, spouse, or caregiver speaking for someone else. Detecting this
// lets us tag the case so the advisor knows to ask whose plan they're calling
// about (and skip questions that don't apply to the caller themselves).
// ─────────────────────────────────────────────────────────────────────────────

const CAREGIVER_PHRASES = [
  // English
  'my mom', 'my mother', 'my dad', 'my father', 'my parent', 'my parents',
  'my grandma', 'my grandmother', 'my grandpa', 'my grandfather',
  'my husband', 'my wife', 'my spouse', 'my partner',
  'my aunt', 'my uncle', 'my brother', 'my sister',
  'i am helping', 'i am calling for', "i'm helping", "i'm calling for",
  'on behalf of', 'for my', 'for her', 'for him',
  'she needs', 'he needs', 'they need',
  'she does not speak english', 'he does not speak english',
  "she doesn't speak english", "he doesn't speak english",
  // Spanish
  'mi mama', 'mi mamá', 'mi madre', 'mi papa', 'mi papá', 'mi padre',
  'mis padres', 'mis papas', 'mis papás',
  'mi abuela', 'mi abuelo', 'mi abuelita', 'mi abuelito',
  'mi esposo', 'mi esposa', 'mi pareja',
  'mi tia', 'mi tía', 'mi tio', 'mi tío', 'mi hermano', 'mi hermana',
  'ayudando a', 'llamando por', 'estoy ayudando',
  'para mi mama', 'para mi mamá', 'para mi papa', 'para mi papá',
  'ella necesita', 'el necesita', 'él necesita', 'ellos necesitan',
  'ella no habla ingles', 'él no habla inglés', 'el no habla ingles',
];

export function detectCaregiver(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const p of CAREGIVER_PHRASES) {
    if (lower.includes(p)) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICK-ACTION TOPIC MAP
//
// The chips shown in the opening step. Each maps to one primary intent and
// (optionally) a secondary intent that we capture together for multi-topic
// presets like "Doctors or medications" or "Medicaid / Extra Help".
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickAction {
  id: string;
  label_en: string;
  label_es: string;
  primary: IntentId;
  secondary?: IntentId[];
}

// Wave 9 — Phase 3: opening shows AT MOST 4 small pill chips (1 language toggle
// + 3 high-signal shortcuts). Typing is the primary path; chips are subtle.
export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'advisor', label_en: 'Speak with an advisor', label_es: 'Hablar con un asesor', primary: 'call_requested' },
  { id: 'letter', label_en: 'I received a letter', label_es: 'Recibí una carta', primary: 'plan_letter_issue' },
  { id: 'costs', label_en: 'Plan cost issue', label_es: 'Problema de costos', primary: 'cost_help' },
];

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE-SELECT keywords used at the opening step when user types instead
// of clicking. "spanish"/"español"/"hola"/etc. are unambiguous Spanish signals.
// ─────────────────────────────────────────────────────────────────────────────

export function detectExplicitLanguagePick(text: string): SupportLang | null {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!lower) return null;
  const esSignals = ['espanol', 'español', 'spanish', 'hola', 'buenos dias', 'buenas tardes', 'buenas noches', 'hablar espanol', 'hablame espanol', 'necesito espanol', 'spanish please', 'prefiero espanol'];
  const enSignals = ['english', 'ingles', 'inglés', 'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'speak english', 'english please', 'prefer english', 'in english'];
  for (const s of esSignals) if (lower.includes(s)) return 'es';
  for (const s of enSignals) if (lower.includes(s)) return 'en';
  return null;
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
// NATURAL FOLLOW-UP QUESTIONS (intent-specific, calm, one-at-a-time)
//
// These are the bot's second-turn responses after the user states a concern in
// their own words. They open with empathy ("I understand"), explain WHY a
// follow-up is needed, then ask ONE narrowing question with concrete options
// embedded in the sentence (not as buttons).
// ─────────────────────────────────────────────────────────────────────────────

export function intentFollowUp(id: IntentId, lang: SupportLang): string {
  // Pattern: acknowledge briefly → contextual explanation → compliance caution
  // (only when relevant) → ONE simple question. Companion chips are emitted
  // separately via intentFollowUpChips() so the message reads as prose.
  const map: Record<IntentId, { en: string; es: string }> = {
    medication_help: {
      en: 'I understand. Medication costs can change for several reasons — formularies, pharmacies, and plan rules all matter. Please do not share your Medicare ID, Social Security number, or prescription numbers here. In simple words, what is the main issue with the medication?',
      es: 'Entiendo. Los costos de medicamentos pueden cambiar por varias razones — los formularios, farmacias y reglas del plan importan. Por favor no comparta su número de Medicare, Seguro Social, ni números de receta aquí. En palabras simples, ¿cuál es el problema principal con la medicina?',
    },
    plan_letter_issue: {
      en: 'I understand. A letter from Medicare or your plan can be important because it may mention renewal, costs, benefits, network, or a deadline. Please do not send your Medicare number or Social Security number here. In simple words, what does the letter say it is about?',
      es: 'Entiendo. Una carta de Medicare o de su plan puede ser importante porque puede mencionar renovación, costos, beneficios, red o una fecha límite. Por favor no envíe su número de Medicare ni Seguro Social aquí. En palabras simples, ¿de qué dice la carta que se trata?',
    },
    doctor_network_question: {
      en: 'I understand. Doctor network situations should be verified carefully before any plan decision, because networks can change. ClearPoint should confirm the doctor, location, and plan details with you. What state and ZIP code are you in?',
      es: 'Entiendo. Las situaciones de red de doctores deben verificarse con cuidado antes de cualquier decisión del plan, porque las redes pueden cambiar. ClearPoint debe confirmar el doctor, la ubicación y los detalles del plan con usted. ¿En qué estado y código postal vive?',
    },
    possible_loss_of_coverage: {
      en: "I hear you — that can feel urgent. Coverage situations can be time-sensitive and should be reviewed by a licensed advisor quickly. How did you find out — was it a letter, a phone call, or at a doctor or pharmacy?",
      es: 'Lo escucho — eso puede sentirse urgente. Las situaciones de cobertura pueden tener tiempo limitado y deben ser revisadas por un asesor licenciado rápidamente. ¿Cómo se enteró — fue por una carta, una llamada, o en el doctor o farmacia?',
    },
    annual_review: {
      en: "Of course — many people review their plan each year. To prepare this for an advisor, what is the main thing you want to look at first?",
      es: 'Por supuesto — muchas personas revisan su plan cada año. Para prepararlo para un asesor, ¿qué es lo principal que quiere revisar primero?',
    },
    extra_help_lis: {
      en: "Thank you. Extra Help is a federal program that may reduce Part D costs for people who qualify, but the Social Security Administration decides eligibility — I cannot confirm it here. To organize this for an advisor, what would you like to focus on?",
      es: 'Gracias. Extra Help es un programa federal que puede reducir costos de Parte D para personas que califican, pero la Administración del Seguro Social decide la elegibilidad — no puedo confirmarla aquí. Para organizar esto para un asesor, ¿en qué le gustaría enfocarse?',
    },
    medicaid_msp: {
      en: "Thank you. When a person has both Medicare and Medicaid, the situation can be complex and a change to Medicare can sometimes affect Medicaid. A licensed advisor should review this carefully. To start, what state are you (or the person) in?",
      es: 'Gracias. Cuando una persona tiene Medicare y Medicaid, la situación puede ser compleja y un cambio en Medicare a veces puede afectar Medicaid. Un asesor licenciado debe revisar esto con cuidado. Para empezar, ¿en qué estado vive usted (o la persona)?',
    },
    cost_help: {
      en: "I understand. There are several programs and adjustments that may help with Medicare costs — premium, copays, deductibles — but eligibility depends on your situation. To organize this for an advisor, what is the main cost that is bothering you?",
      es: 'Entiendo. Hay varios programas y ajustes que pueden ayudar con los costos de Medicare — prima, copagos, deducibles — pero la elegibilidad depende de su situación. Para organizar esto para un asesor, ¿cuál es el costo principal que le preocupa?',
    },
    benefit_card_issue: {
      en: "Thank you. Benefit card issues are usually handled by the plan that issued the card, but I can prepare the situation so an advisor can guide you. What is happening with the card?",
      es: 'Gracias. Los problemas con tarjetas de beneficios usualmente los maneja el plan que la emitió, pero puedo preparar la situación para que un asesor lo guíe. ¿Qué está pasando con la tarjeta?',
    },
    otc_question: {
      en: "Thank you. OTC benefits vary by plan, so the Summary of Benefits and Evidence of Coverage from your specific plan is the source of truth. What would you like an advisor to walk through?",
      es: 'Gracias. Los beneficios OTC varían por plan, así que el Resumen de Beneficios y la Evidencia de Cobertura de su plan específico son la fuente oficial. ¿Qué le gustaría que un asesor le explique?',
    },
    appointment_requested: {
      en: "Of course. So an advisor can prepare for the call, what would you like to focus on first?",
      es: 'Por supuesto. Para que un asesor se pueda preparar para la llamada, ¿en qué le gustaría enfocarse primero?',
    },
    call_requested: {
      en: "Of course. So the advisor can prepare, could you share briefly what you would like to discuss?",
      es: 'Por supuesto. Para que el asesor se pueda preparar, ¿podría compartir brevemente de qué le gustaría hablar?',
    },
    new_to_medicare: {
      en: "Welcome. Getting started with Medicare is one of the more important decisions, and a licensed advisor should walk you through the timing and options. Where are you in the process right now?",
      es: 'Bienvenido. Comenzar con Medicare es una de las decisiones más importantes, y un asesor licenciado debe explicarle los tiempos y opciones. ¿En qué parte del proceso está ahora mismo?',
    },
    confused_customer: {
      en: "I understand. Medicare can feel like a lot. Let's take it one step at a time — I'll organize the main thing for a licensed advisor. In one or two sentences, what is bothering you most right now?",
      es: 'Entiendo. Medicare puede sentirse abrumador. Vamos paso a paso — voy a organizar lo principal para un asesor licenciado. En una o dos oraciones, ¿qué es lo que más le preocupa ahora mismo?',
    },
    complaint: {
      en: "I hear you, and I'm sorry you are going through this. I'll prepare the situation so a licensed advisor can review it with you carefully. What is the main concern?",
      es: 'Lo escucho, y lamento que esté pasando por esto. Voy a preparar la situación para que un asesor licenciado pueda revisarla con usted con cuidado. ¿Cuál es la preocupación principal?',
    },
    employer_union_benefits: {
      en: "Thank you for mentioning this — union, retiree, employer, VA, or TRICARE benefits can be lost permanently if Medicare is changed without checking impact first. A licensed advisor must review this with you before any decision. Which type of benefit is it?",
      es: 'Gracias por mencionarlo — los beneficios de unión, retiro, empleador, VA o TRICARE se pueden perder permanentemente si se cambia Medicare sin revisar el impacto primero. Un asesor licenciado debe revisar esto con usted antes de cualquier decisión. ¿Qué tipo de beneficio es?',
    },
    general_medicare_question: {
      en: "Happy to help with general Medicare information. Specific eligibility and plan details should be verified with a licensed advisor or with Medicare directly. What part of Medicare would you like to understand?",
      es: 'Con gusto le ayudo con información general sobre Medicare. La elegibilidad específica y los detalles del plan deben verificarse con un asesor licenciado o directamente con Medicare. ¿Qué parte de Medicare le gustaría entender?',
    },
    other_unknown: {
      en: "Thank you for sharing that. Could you tell me a little more — is this about a plan, medications, a doctor, a letter, costs, or something else?",
      es: 'Gracias por compartir. ¿Podría decirme un poco más — es sobre un plan, medicamentos, un doctor, una carta, costos o algo más?',
    },
  };
  return map[id][lang];
}

// ─────────────────────────────────────────────────────────────────────────────
// INLINE NARROWING CHIPS (Wave 9 — Phase 5 button discipline)
//
// Up to 4 small optional pill chips per intent follow-up. The user can ignore
// them entirely and type freely — they exist only to reduce friction for
// callers who prefer to point at the option that matches.
// ─────────────────────────────────────────────────────────────────────────────

export function intentFollowUpChips(id: IntentId, lang: SupportLang): string[] {
  const map: Record<IntentId, { en: string[]; es: string[] }> = {
    medication_help: {
      en: ['More expensive', 'Not covered', 'Pharmacy rejected', 'Needs authorization'],
      es: ['Más cara', 'No cubierta', 'Farmacia la rechazó', 'Pide autorización'],
    },
    plan_letter_issue: {
      en: ['Renewal', 'Cost change', 'Benefits changed', 'Deadline'],
      es: ['Renovación', 'Cambio de costo', 'Cambio de beneficios', 'Fecha límite'],
    },
    doctor_network_question: {
      en: ['Primary doctor', 'Specialist', 'Hospital', 'Pharmacy'],
      es: ['Doctor primario', 'Especialista', 'Hospital', 'Farmacia'],
    },
    possible_loss_of_coverage: {
      en: ['A letter', 'A phone call', 'At a doctor', 'Not sure'],
      es: ['Una carta', 'Una llamada', 'En el doctor', 'No sé'],
    },
    annual_review: {
      en: ['Compare new plans', 'Check current plan', 'Medication costs', 'Doctors / pharmacy'],
      es: ['Comparar planes nuevos', 'Revisar plan actual', 'Costos de medicinas', 'Doctores / farmacia'],
    },
    extra_help_lis: {
      en: ['How it works', 'Might I qualify', 'How to apply', 'A letter I received'],
      es: ['Cómo funciona', 'Si yo califico', 'Cómo solicitar', 'Una carta que recibí'],
    },
    medicaid_msp: {
      en: ['I have Medicaid', 'I want to apply', 'Medicaid changed', 'Not sure'],
      es: ['Tengo Medicaid', 'Quiero solicitar', 'Medicaid cambió', 'No sé'],
    },
    cost_help: {
      en: ['Premium', 'Copay', 'A bill I got', 'Not sure'],
      es: ['Prima', 'Copago', 'Una factura', 'No sé'],
    },
    benefit_card_issue: {
      en: ['Declined at store', 'Lost it', 'Low balance', 'Wrong balance'],
      es: ['Rechazada', 'La perdí', 'Sin saldo', 'Saldo incorrecto'],
    },
    otc_question: {
      en: ['What is covered', 'How to use it', 'How much I have', 'How to order'],
      es: ['Qué cubre', 'Cómo usarlo', 'Cuánto tengo', 'Cómo pedirlo'],
    },
    appointment_requested: {
      en: ['Plan review', 'A letter', 'Medication', 'Other topic'],
      es: ['Revisar plan', 'Una carta', 'Medicamentos', 'Otro tema'],
    },
    call_requested: { en: [], es: [] },
    new_to_medicare: {
      en: ['Almost 65', 'Just turned 65', 'Disability', 'Helping a family member'],
      es: ['Cerca de 65', 'Acabo de cumplir 65', 'Discapacidad', 'Ayudando a familiar'],
    },
    confused_customer: { en: [], es: [] },
    complaint: {
      en: ['How a plan handled it', 'Doctor / pharmacy', 'Billing', 'Something else'],
      es: ['Cómo lo manejó el plan', 'Doctor / farmacia', 'Facturación', 'Otra cosa'],
    },
    employer_union_benefits: {
      en: ['Union', 'Retiree', 'Employer', 'VA / TRICARE'],
      es: ['Unión', 'Retiro', 'Empleador', 'VA / TRICARE'],
    },
    general_medicare_question: {
      en: ['Medicare basics', 'Plan types', 'Part D / drugs', 'Costs'],
      es: ['Medicare básico', 'Tipos de planes', 'Parte D / medicinas', 'Costos'],
    },
    other_unknown: {
      en: ['A plan', 'Medications', 'A doctor', 'A letter'],
      es: ['Un plan', 'Medicamentos', 'Un doctor', 'Una carta'],
    },
  };
  return map[id][lang];
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP / STATE FREE-TEXT PARSER
//
// Senior callers often say "I'm in Brooklyn" or "07101" or "Nueva York" or
// "I live in NY". We accept any of those shapes and try to extract a ZIP code
// (5 digits) and/or a 2-letter state code.
// ─────────────────────────────────────────────────────────────────────────────

export type ParsedLocation = {
  zip: string;
  state: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' | '';
  rawHint: string;
};

const STATE_NAME_TO_CODE: Record<string, ParsedLocation['state']> = {
  'new york': 'NY', 'nueva york': 'NY', 'ny': 'NY',
  'new jersey': 'NJ', 'nueva jersey': 'NJ', 'nj': 'NJ',
  'connecticut': 'CT', 'ct': 'CT',
  'florida': 'FL', 'fl': 'FL',
};

export function parseZipOrState(text: string): ParsedLocation {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  let zip = '';
  let state: ParsedLocation['state'] = '';

  // ZIP: 5 digits (allow leading boundary)
  const zipMatch = lower.match(/\b(\d{5})\b/);
  if (zipMatch) zip = zipMatch[1];

  // State: try multi-word names first (longest match), then 2-letter codes.
  // We search for word-boundary occurrences so "north carolina" doesn't match "ca".
  const sortedKeys = Object.keys(STATE_NAME_TO_CODE).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lower)) {
      state = STATE_NAME_TO_CODE[key];
      break;
    }
  }

  // If we have a ZIP but no state, infer using common prefixes.
  if (zip && !state) {
    const z = parseInt(zip.slice(0, 3), 10);
    if (z >= 100 && z <= 149) state = 'NY';      // NY 100xx-149xx
    else if (z >= 70 && z <= 89) state = 'NJ';   // NJ 070xx-089xx
    else if (z >= 60 && z <= 69) state = 'CT';   // CT 060xx-069xx
    else if (z >= 320 && z <= 349) state = 'FL'; // FL 320xx-349xx
    else state = 'Other';
  }

  return { zip, state, rawHint: text.trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL-NAME SPLITTER — best-effort first/last from a "full name" answer.
// ─────────────────────────────────────────────────────────────────────────────

export function splitFullName(text: string): { firstName: string; lastName: string } {
  let cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: '', lastName: '' };

  // Strip common conversational prefixes seniors actually type.
  // We do this in a loop because someone may write "Hi, my name is Maria"
  // (two prefixes back-to-back).
  const prefixPatterns: RegExp[] = [
    /^(hola|hi|hello|hey)[,.\s]+/i,
    /^(my name is|i am|i'm|im|this is|name's|name is)\s+/i,
    /^(me llamo|mi nombre es|soy|nombre[:\s]+|mi nombre[:\s]+)\s*/i,
    /^buenos? (dias|tardes|noches)[,.\s]+/i,
    /^(good (morning|afternoon|evening))[,.\s]+/i,
  ];
  let changed = true;
  let safety = 0;
  while (changed && safety < 6) {
    changed = false;
    for (const re of prefixPatterns) {
      const next = cleaned.replace(re, '').trim();
      if (next !== cleaned) {
        cleaned = next;
        changed = true;
      }
    }
    safety++;
  }
  // Drop trailing period / comma if any.
  cleaned = cleaned.replace(/[.,;:!?]+$/, '').trim();
  if (!cleaned) return { firstName: '', lastName: '' };

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: capitalize(parts[0]), lastName: '' };
  // Treat first token as first name, everything else as the surname (handles
  // common Hispanic two-surname patterns like "Maria Rodriguez Lopez").
  return {
    firstName: capitalize(parts[0]),
    lastName: parts.slice(1).map(capitalize).join(' '),
  };
}

function capitalize(word: string): string {
  if (!word) return word;
  // Preserve apostrophes and hyphens for names like O'Brien or Smith-Jones.
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL-INTENT DETECTOR
//
// Mid-conversation interruptions a senior might type at any step:
//   restart, go back, talk to a person, change my state, never mind, stop.
// Returns one of a small set or null. Lets the UI handle them gracefully
// instead of trying to interpret them as field data.
// ─────────────────────────────────────────────────────────────────────────────

export type GlobalIntent =
  | 'RESTART'
  | 'GO_BACK'
  | 'TALK_TO_HUMAN'
  | 'CHANGE_LANGUAGE_EN'
  | 'CHANGE_LANGUAGE_ES'
  | 'STOP_CONVERSATION'
  | null;

const RESTART_PHRASES = [
  'restart', 'start over', 'start again', 'begin again', 'reset',
  'reiniciar', 'empezar de nuevo', 'comenzar de nuevo', 'volver a empezar',
];
const GO_BACK_PHRASES = [
  'go back', 'previous', 'last question', 'undo',
  'atras', 'volver', 'pregunta anterior', 'deshacer',
];
const TALK_TO_HUMAN_PHRASES = [
  'talk to a person', 'talk to someone', 'talk to a human', 'speak with someone',
  'i want a person', 'real person', 'just call me', 'put me on the phone',
  'hablar con una persona', 'hablar con alguien', 'hablar con un humano',
  'quiero una persona', 'persona real', 'que me llamen', 'pasame con alguien',
];
const CHANGE_LANGUAGE_EN = [
  'better in english', 'switch to english', 'in english', 'speak english',
  'english please', 'change to english', 'mejor en ingles', 'cambiar a ingles',
];
const CHANGE_LANGUAGE_ES = [
  'better in spanish', 'switch to spanish', 'in spanish', 'speak spanish',
  'spanish please', 'change to spanish', 'mejor en espanol', 'cambiar a espanol',
];
const STOP_PHRASES = [
  'stop', 'cancel', 'never mind', 'forget it',
  'olvidalo', 'no importa', 'cancelar', 'detener',
];

export function detectGlobalIntent(text: string): GlobalIntent {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (!lower) return null;
  // Short messages are more likely to be commands. Long messages are more
  // likely to be actual content — but we still check for unambiguous phrases.
  for (const p of CHANGE_LANGUAGE_ES) if (lower.includes(p)) return 'CHANGE_LANGUAGE_ES';
  for (const p of CHANGE_LANGUAGE_EN) if (lower.includes(p)) return 'CHANGE_LANGUAGE_EN';
  // Restart / go-back / stop should match WORD-LEVEL to avoid eating words
  // like "restarting my plan" from being treated as a control command.
  const tokens = lower.split(/[^a-z0-9]+/);
  const tokenSet = new Set(tokens);
  if (tokens.length <= 4) {
    for (const p of RESTART_PHRASES) if (lower.includes(p)) return 'RESTART';
    for (const p of GO_BACK_PHRASES) if (lower.includes(p)) return 'GO_BACK';
    for (const p of STOP_PHRASES) if (tokenSet.has(p)) return 'STOP_CONVERSATION';
  }
  for (const p of TALK_TO_HUMAN_PHRASES) if (lower.includes(p)) return 'TALK_TO_HUMAN';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REFLECTION HELPER
//
// Produces a one-sentence acknowledgement of what the bot has captured so far.
// Used at the transition from location → concern so the caller feels heard.
// ─────────────────────────────────────────────────────────────────────────────

export function reflectBack(name: string, zip: string, state: string, lang: SupportLang): string {
  const stateName = stateDisplayName(state, lang);
  const locationBit = zip && stateName
    ? `${stateName} (ZIP ${zip})`
    : zip
      ? `ZIP ${zip}`
      : stateName;

  if (lang === 'es') {
    if (name && locationBit) return `Gracias, ${name}. Veo que está en ${locationBit}.`;
    if (name) return `Gracias, ${name}.`;
    if (locationBit) return `Gracias. Veo que está en ${locationBit}.`;
    return 'Gracias.';
  }
  if (name && locationBit) return `Thank you, ${name}. I see you're in ${locationBit}.`;
  if (name) return `Thank you, ${name}.`;
  if (locationBit) return `Thank you. I see you're in ${locationBit}.`;
  return 'Thank you.';
}

function stateDisplayName(state: string, lang: SupportLang): string {
  const map_en: Record<string, string> = {
    NY: 'New York', NJ: 'New Jersey', CT: 'Connecticut', FL: 'Florida',
    Other: 'your state',
  };
  const map_es: Record<string, string> = {
    NY: 'Nueva York', NJ: 'Nueva Jersey', CT: 'Connecticut', FL: 'Florida',
    Other: 'su estado',
  };
  const m = lang === 'es' ? map_es : map_en;
  return m[state] || '';
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
  caregiver_signal?: boolean;
  wants_callback?: boolean;
  consent_to_contact: boolean;
  first_name: string;
  last_name?: string;
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

  const wantsCallStr = s.wants_callback === undefined
    ? 'not asked'
    : s.wants_callback ? 'YES' : 'NO';

  const userType = s.caregiver_signal
    ? 'family member / caregiver speaking on behalf of beneficiary'
    : 'beneficiary or unknown';

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
    `Wants advisor call: ${wantsCallStr}`,
    `Consent to contact: ${s.consent_to_contact ? 'YES' : 'NO'}`,
    `User type: ${userType}`,
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
  if (s.caregiver_signal) tags.push('caregiver_or_family');

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

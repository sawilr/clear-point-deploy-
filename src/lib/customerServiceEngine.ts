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

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'medicare', label_en: 'Medicare help', label_es: 'Ayuda con Medicare', primary: 'general_medicare_question' },
  { id: 'costs', label_en: 'Plan costs', label_es: 'Costos del plan', primary: 'cost_help' },
  { id: 'rx_dr', label_en: 'Doctors or medications', label_es: 'Doctores o medicamentos', primary: 'doctor_network_question', secondary: ['medication_help'] },
  { id: 'medicaid_lis', label_en: 'Medicaid / Extra Help', label_es: 'Medicaid / Ayuda Extra', primary: 'medicaid_msp', secondary: ['extra_help_lis'] },
  { id: 'letter', label_en: 'I received a letter', label_es: 'Recibí una carta', primary: 'plan_letter_issue' },
  { id: 'advisor', label_en: 'Speak with an advisor', label_es: 'Hablar con un asesor', primary: 'call_requested' },
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
  const map: Record<IntentId, { en: string; es: string }> = {
    medication_help: {
      en: 'I understand. Medication costs can change for several reasons. To organize this correctly, is the issue that the medication became more expensive, is not covered, was rejected at the pharmacy, or requires prior authorization?',
      es: 'Entiendo. Los costos de medicamentos pueden cambiar por varias razones. Para organizar esto bien, ¿el problema es que la medicina salió más cara, no está cubierta, la farmacia la rechazó, o le pidieron autorización previa?',
    },
    plan_letter_issue: {
      en: 'I understand. Letters from Medicare or your plan can be confusing. Does the letter mention cancellation, renewal, payment, a deadline, or a change in benefits?',
      es: 'Entiendo. Las cartas de Medicare o del plan pueden ser confusas. ¿La carta menciona cancelación, renovación, pago, fecha límite, o cambio de beneficios?',
    },
    doctor_network_question: {
      en: 'I understand. To organize this well, is this about your primary doctor, a specialist, a hospital, a pharmacy, or the plan network in general?',
      es: 'Entiendo. Para organizarlo bien, ¿se trata de su doctor primario, un especialista, un hospital, una farmacia, o la red del plan en general?',
    },
    possible_loss_of_coverage: {
      en: "I understand — that sounds stressful. So we capture this correctly, did you receive a letter or notice, was something said by phone, or did you find out at a doctor or pharmacy?",
      es: 'Entiendo — eso suena estresante. Para anotarlo bien, ¿recibió una carta o aviso, le dijeron algo por teléfono, o se enteró en el doctor o farmacia?',
    },
    annual_review: {
      en: "Of course — many people review their plan each year. To organize this for an advisor, is your main goal to compare new plans, check that your current plan still works, look at medication costs, or check your doctors and pharmacy?",
      es: 'Por supuesto — muchas personas revisan su plan cada año. Para organizar esto para un asesor, ¿su objetivo principal es comparar nuevos planes, verificar que su plan actual aún le sirva, revisar costos de medicamentos, o revisar sus doctores y farmacia?',
    },
    extra_help_lis: {
      en: "Thank you. To organize this for the advisor, are you asking how Extra Help works, whether you might qualify, how to apply, or about a letter you received about it?",
      es: 'Gracias. Para organizar esto para el asesor, ¿está preguntando cómo funciona Extra Help, si usted podría calificar, cómo solicitarlo, o sobre una carta que recibió al respecto?',
    },
    medicaid_msp: {
      en: "Thank you. Is the question about already having Medicaid alongside Medicare, applying for Medicaid or a Medicare Savings Program, or a recent change in your Medicaid status?",
      es: 'Gracias. ¿La pregunta es sobre ya tener Medicaid junto con Medicare, solicitar Medicaid o un Programa de Ahorro de Medicare, o un cambio reciente en su estatus de Medicaid?',
    },
    cost_help: {
      en: "I understand. To organize this for the advisor, is your concern the monthly premium, a copay for a doctor or prescription, an unexpected bill, or something else?",
      es: 'Entiendo. Para organizar esto para el asesor, ¿le preocupa la prima mensual, un copago de doctor o receta, una factura inesperada, o algo más?',
    },
    benefit_card_issue: {
      en: "Thank you. So we organize this correctly, is the card being declined at a store, lost or never received, low on funds, or showing the wrong balance?",
      es: 'Gracias. Para organizarlo bien, ¿la tarjeta es rechazada en la tienda, está perdida o nunca la recibió, sin fondos, o muestra un saldo incorrecto?',
    },
    otc_question: {
      en: "Thank you. Are you asking about what OTC items are covered, how to use the benefit, how much you have available, or how to order?",
      es: 'Gracias. ¿Está preguntando qué artículos OTC están cubiertos, cómo usar el beneficio, cuánto tiene disponible, o cómo pedirlos?',
    },
    appointment_requested: {
      en: "Of course. So an advisor can prepare, is this for a plan review, a question about a letter, a medication issue, or a different topic?",
      es: 'Por supuesto. Para que un asesor se pueda preparar, ¿es para una revisión de plan, una pregunta sobre una carta, un problema con medicamentos, u otro tema?',
    },
    call_requested: {
      en: "Of course. So the advisor can prepare, could you share briefly what you would like to discuss on the call?",
      es: 'Por supuesto. Para que el asesor se pueda preparar, ¿podría compartir brevemente de qué le gustaría hablar en la llamada?',
    },
    new_to_medicare: {
      en: "Welcome. So we organize this correctly, are you getting close to age 65, already past 65, qualifying due to disability, or helping a family member who is new to Medicare?",
      es: 'Bienvenido. Para organizarlo bien, ¿está cerca de cumplir 65, ya pasó los 65, califica por discapacidad, o está ayudando a un familiar que es nuevo en Medicare?',
    },
    confused_customer: {
      en: "I understand. Medicare can be confusing. Let's go step by step. First I'll identify the main issue, then I'll prepare a summary for a licensed advisor to review. Could you share — in one or two sentences — what is bothering you most right now?",
      es: 'Entiendo. Medicare puede ser confuso. Vamos paso a paso. Primero voy a identificar el problema principal y luego preparo un resumen para que un asesor licenciado lo revise. ¿Podría compartir — en una o dos oraciones — qué es lo que más le preocupa ahora mismo?',
    },
    complaint: {
      en: "I hear you. So I can prepare this for the advisor, is the concern about how a plan handled something, how a doctor or pharmacy treated you, a billing issue, or something else?",
      es: 'Lo escucho. Para preparar esto para el asesor, ¿la queja es sobre cómo un plan manejó algo, cómo un doctor o farmacia lo trató, un problema de facturación, o algo más?',
    },
    employer_union_benefits: {
      en: "Thank you for mentioning this — employer, union, retiree, federal, state, VA, or TRICARE benefits can be lost permanently if a Medicare change is made without checking impact. To organize this safely, could you tell me which type of benefit this is (employer, union, retiree, VA, or other) and whether you still have a benefits administrator or contact you can reach?",
      es: 'Gracias por mencionarlo — los beneficios de empleador, unión, retiro, federales, estatales, VA o TRICARE se pueden perder permanentemente si se hace un cambio en Medicare sin revisar el impacto. Para organizar esto con seguridad, ¿podría decirme qué tipo de beneficio es (empleador, unión, retiro, VA u otro) y si todavía tiene un administrador de beneficios o contacto al que pueda comunicarse?',
    },
    general_medicare_question: {
      en: "Of course. So I capture the question correctly, is it about how Medicare works in general, the difference between plan types, prescription coverage, or something else?",
      es: 'Por supuesto. Para anotar la pregunta correctamente, ¿es sobre cómo funciona Medicare en general, la diferencia entre tipos de planes, cobertura de medicamentos, o algo más?',
    },
    other_unknown: {
      en: "Thank you for sharing that. Could you give me one more detail — for example, is this about your plan, your medications, your doctor, a letter, or costs?",
      es: 'Gracias por compartir. ¿Podría darme un detalle más — por ejemplo, es sobre su plan, sus medicamentos, su doctor, una carta, o costos?',
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

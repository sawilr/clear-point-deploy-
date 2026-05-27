/**
 * Customer Service Bot — ClearPoint Support Guide
 *
 * Phase 3: wired to GHL via existing submitLeadToGHL() from src/lib/ghl.ts.
 * Reuses /api/submit-lead.js endpoint with source = "customer_service_bot".
 * NO new endpoint, NO new env vars, NO server changes.
 *
 * Architecturally isolated from Zara:
 *   - Zero imports from src/components/ChatBot.tsx (Zara)
 *   - Zero imports from src/components/SmartMedicareReview.tsx
 *   - Zero imports from src/components/LeadForm.tsx
 *   - Different sessionStorage key (clear_point_support_session_memory)
 *   - Different brand name, color palette, layout
 *
 * NOTE on Preview deploys: env vars HIGHLEVEL_TOKEN + HIGHLEVEL_LOCATION_ID
 * are Production-scoped only (Option A lock). Submissions FROM Preview will
 * return 500 "Server configuration error" — that's by design and is verified
 * via the production API endpoint with QA test contacts.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { classifyIntent, getIntent, type IntentId, type IntentUrgency } from '../data/customerServiceIntents';

// ────────────────────────────────────────────────────────────────────────────
// PII DETECTOR
// ────────────────────────────────────────────────────────────────────────────

type PiiCheckResult = {
  isPii: boolean;
  pattern: 'medicare_id' | 'ssn' | 'card_number' | 'bank_routing' | null;
};

function detectPii(text: string): PiiCheckResult {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const mbiPattern = /\b[1-9][A-Z][A-Z0-9][A-Z0-9]-?[A-Z][A-Z0-9]-?[A-Z][A-Z0-9]{3}\b/i;
  if (mbiPattern.test(normalized)) return { isPii: true, pattern: 'medicare_id' };
  const ssnPattern = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
  const phonePattern = /\b\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4}\b/;
  if (ssnPattern.test(normalized) && !phonePattern.test(normalized)) {
    return { isPii: true, pattern: 'ssn' };
  }
  const cardPattern = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/;
  if (cardPattern.test(normalized)) return { isPii: true, pattern: 'card_number' };
  const routingPattern = /\b\d{9}\b/;
  if (routingPattern.test(normalized) && !phonePattern.test(normalized)) {
    return { isPii: true, pattern: 'bank_routing' };
  }
  return { isPii: false, pattern: null };
}

// ────────────────────────────────────────────────────────────────────────────
// EMERGENCY DETECTOR
// ────────────────────────────────────────────────────────────────────────────

const EMERGENCY_KEYWORDS_EN = [
  'chest pain', "can't breathe", 'cant breathe', 'cannot breathe',
  'heart attack', 'stroke', 'severe pain', 'dying', '911', 'ambulance',
  'suicide', 'kill myself', 'hurt myself', 'self harm', 'overdose',
  'medical emergency', 'er right now', 'going to die',
];
const EMERGENCY_KEYWORDS_ES = [
  'dolor de pecho', 'no puedo respirar', 'infarto', 'ataque al corazon',
  'derrame', 'dolor severo', 'muriendo', '911', 'ambulancia',
  'suicidio', 'matarme', 'lastimarme', 'autolesion', 'sobredosis',
  'emergencia medica', 'sala de emergencia', 'voy a morir',
];

function detectEmergency(text: string): boolean {
  const lower = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const kw of [...EMERGENCY_KEYWORDS_EN, ...EMERGENCY_KEYWORDS_ES]) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// LANGUAGE DETECTOR
// ────────────────────────────────────────────────────────────────────────────

const ES_STOPWORDS = ['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'las', 'un', 'por', 'con', 'no', 'una', 'su', 'para', 'es', 'al', 'mi', 'mis', 'me', 'tu', 'sus', 'que', 'como', 'cuando', 'donde', 'quien', 'porque'];
const EN_STOPWORDS = ['the', 'is', 'and', 'a', 'to', 'of', 'in', 'for', 'on', 'with', 'i', 'you', 'it', 'my', 'we', 'they', 'what', 'when', 'where', 'who', 'why', 'how'];

function detectLanguage(text: string): 'en' | 'es' | 'mixed' {
  const words = text.toLowerCase().split(/\s+/);
  let esHits = 0, enHits = 0;
  for (const w of words) {
    if (ES_STOPWORDS.includes(w)) esHits++;
    if (EN_STOPWORDS.includes(w)) enHits++;
  }
  if (esHits === 0 && enHits === 0) return 'mixed';
  if (esHits > enHits * 1.5) return 'es';
  if (enHits > esHits * 1.5) return 'en';
  return 'mixed';
}

// ────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ────────────────────────────────────────────────────────────────────────────

type SupportStep =
  | 'language_pick'
  | 'privacy_acknowledge'
  | 'intent_pick'
  | 'collecting_first_name'
  | 'collecting_phone'
  | 'collecting_state'
  | 'collecting_zip_optional'
  | 'collecting_best_time'
  | 'consent_review'
  | 'submitting'
  | 'submitted'
  | 'submission_failed'
  | 'emergency_paused';

type Message = {
  id: string;
  role: 'bot' | 'user';
  text: string;
};

interface SupportState {
  session_id: string;
  started_at: string;
  turn_count: number;
  language: 'en' | 'es';
  preferred_language: 'English' | 'Spanish' | 'Either' | '';
  language_switches: number;
  topics_detected: IntentId[];
  primary_intent: IntentId | null;
  secondary_intents: IntentId[];
  confidence: 'high' | 'medium' | 'low' | null;
  urgency: IntentUrgency;
  requires_agent_review: boolean;
  privacy_warning_shown: boolean;
  sensitive_data_intercepted: boolean;
  emergency_warning_shown: boolean;
  consent_to_contact: boolean;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  state: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' | '';
  zip: string;
  best_time_to_call: string;
  customer_questions: string[];
  summary_points: string[];
  recommended_next_action: string;
  current_step: SupportStep;
  completed_steps: SupportStep[];
  topic_stack: IntentId[];
  messages: Message[];
  submitted: boolean;
  submission_id: string;
  submission_error: string;
}

type Action =
  | { type: 'INIT'; lang: 'en' | 'es' }
  | { type: 'PICK_LANGUAGE'; lang: 'en' | 'es' }
  | { type: 'ACKNOWLEDGE_PRIVACY' }
  | { type: 'SET_INTENT'; primary: IntentId; secondary: IntentId[]; confidence: 'high' | 'medium' | 'low' }
  | { type: 'ADD_USER_MESSAGE'; text: string }
  | { type: 'ADD_BOT_MESSAGE'; text: string }
  | { type: 'EMERGENCY_DETECTED' }
  | { type: 'ACK_EMERGENCY' }
  | { type: 'PII_INTERCEPTED' }
  | { type: 'COLLECT_FIRST_NAME'; value: string }
  | { type: 'COLLECT_PHONE'; value: string }
  | { type: 'COLLECT_STATE'; value: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' }
  | { type: 'COLLECT_ZIP'; value: string }
  | { type: 'COLLECT_BEST_TIME'; value: string }
  | { type: 'SET_CONSENT'; value: boolean }
  | { type: 'SUBMITTING' }
  | { type: 'SUBMIT_OK'; contactId: string }
  | { type: 'SUBMIT_FAIL'; error: string }
  | { type: 'SET_STEP'; step: SupportStep }
  | { type: 'RESET' };

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function initialState(lang: 'en' | 'es'): SupportState {
  return {
    session_id: uid(),
    started_at: new Date().toISOString(),
    turn_count: 0,
    language: lang,
    preferred_language: '',
    language_switches: 0,
    topics_detected: [],
    primary_intent: null,
    secondary_intents: [],
    confidence: null,
    urgency: 'normal',
    requires_agent_review: false,
    privacy_warning_shown: false,
    sensitive_data_intercepted: false,
    emergency_warning_shown: false,
    consent_to_contact: false,
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    state: '',
    zip: '',
    best_time_to_call: '',
    customer_questions: [],
    summary_points: [],
    recommended_next_action: '',
    current_step: 'language_pick',
    completed_steps: [],
    topic_stack: [],
    messages: [],
    submitted: false,
    submission_id: '',
    submission_error: '',
  };
}

function reduce(state: SupportState, action: Action): SupportState {
  switch (action.type) {
    case 'INIT':
      return initialState(action.lang);

    case 'PICK_LANGUAGE':
      return {
        ...state,
        language: action.lang,
        preferred_language: action.lang === 'es' ? 'Spanish' : 'English',
        current_step: 'privacy_acknowledge',
        completed_steps: [...state.completed_steps, 'language_pick'],
      };

    case 'ACKNOWLEDGE_PRIVACY':
      return {
        ...state,
        privacy_warning_shown: true,
        current_step: 'intent_pick',
        completed_steps: [...state.completed_steps, 'privacy_acknowledge'],
      };

    case 'SET_INTENT': {
      const primary = getIntent(action.primary);
      // Merge primary + secondary into topics_detected (accumulate, never replace)
      const allDetected = [action.primary, ...action.secondary];
      const newTopics = [...state.topics_detected];
      for (const t of allDetected) {
        if (!newTopics.includes(t)) newTopics.push(t);
      }
      // Aggregate urgency: any 'urgent' wins, then 'high', else primary's default
      let maxUrgency: IntentUrgency = primary.default_urgency;
      for (const sid of action.secondary) {
        const s = getIntent(sid);
        if (s.default_urgency === 'urgent') maxUrgency = 'urgent';
        else if (s.default_urgency === 'high' && maxUrgency !== 'urgent') maxUrgency = 'high';
      }
      // Aggregate escalation
      let needsReview = primary.escalate_to_agent || state.requires_agent_review;
      for (const sid of action.secondary) {
        if (getIntent(sid).escalate_to_agent) needsReview = true;
      }
      return {
        ...state,
        primary_intent: action.primary,
        secondary_intents: action.secondary,
        topics_detected: newTopics,
        confidence: action.confidence,
        urgency: maxUrgency,
        requires_agent_review: needsReview,
        current_step: 'collecting_first_name',
        completed_steps: [...state.completed_steps, 'intent_pick'],
      };
    }

    case 'ADD_USER_MESSAGE': {
      const detectedLang = detectLanguage(action.text);
      let nextLang = state.language;
      let langSwitches = state.language_switches;
      if (detectedLang !== 'mixed' && detectedLang !== state.language && state.turn_count > 1) {
        nextLang = detectedLang;
        langSwitches++;
      }
      return {
        ...state,
        language: nextLang,
        language_switches: langSwitches,
        turn_count: state.turn_count + 1,
        customer_questions: [...state.customer_questions, action.text],
        messages: [...state.messages, { id: uid(), role: 'user', text: action.text }],
      };
    }

    case 'ADD_BOT_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, { id: uid(), role: 'bot', text: action.text }],
      };

    case 'EMERGENCY_DETECTED':
      return {
        ...state,
        emergency_warning_shown: true,
        current_step: 'emergency_paused',
        urgency: 'urgent',
      };

    case 'ACK_EMERGENCY':
      return {
        ...state,
        current_step: state.primary_intent ? 'collecting_first_name' : 'intent_pick',
      };

    case 'PII_INTERCEPTED':
      return { ...state, sensitive_data_intercepted: true };

    case 'COLLECT_FIRST_NAME':
      return {
        ...state,
        first_name: action.value.trim(),
        current_step: 'collecting_phone',
        completed_steps: [...state.completed_steps, 'collecting_first_name'],
      };

    case 'COLLECT_PHONE':
      return {
        ...state,
        phone: action.value.trim(),
        current_step: 'collecting_state',
        completed_steps: [...state.completed_steps, 'collecting_phone'],
      };

    case 'COLLECT_STATE':
      return {
        ...state,
        state: action.value,
        current_step: 'collecting_zip_optional',
        completed_steps: [...state.completed_steps, 'collecting_state'],
      };

    case 'COLLECT_ZIP':
      return {
        ...state,
        zip: action.value.trim(),
        current_step: 'collecting_best_time',
        completed_steps: [...state.completed_steps, 'collecting_zip_optional'],
      };

    case 'COLLECT_BEST_TIME':
      return {
        ...state,
        best_time_to_call: action.value.trim(),
        current_step: 'consent_review',
        completed_steps: [...state.completed_steps, 'collecting_best_time'],
      };

    case 'SET_CONSENT':
      return { ...state, consent_to_contact: action.value };

    case 'SUBMITTING':
      return { ...state, current_step: 'submitting' };

    case 'SUBMIT_OK':
      return {
        ...state,
        submitted: true,
        submission_id: action.contactId,
        current_step: 'submitted',
      };

    case 'SUBMIT_FAIL':
      return {
        ...state,
        submission_error: action.error,
        current_step: 'submission_failed',
      };

    case 'SET_STEP':
      return { ...state, current_step: action.step };

    case 'RESET':
      return initialState(state.language);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// COPY
// ────────────────────────────────────────────────────────────────────────────

const COPY = {
  brand_en: 'ClearPoint Support Guide',
  brand_es: 'Guía de Soporte ClearPoint',
  greeting_en: "Hi, I'm your ClearPoint Support Guide. I'm here to help organize your Medicare question so a licensed advisor can review it.",
  greeting_es: 'Hola, soy tu Guía de Soporte ClearPoint. Estoy aquí para ayudarte a organizar tu pregunta sobre Medicare para que un asesor licenciado pueda revisarla.',
  language_prompt_en: 'Pick a language to continue:',
  language_prompt_es: 'Elija un idioma para continuar:',
  privacy_warning_title_en: 'Privacy Notice',
  privacy_warning_title_es: 'Aviso de Privacidad',
  privacy_warning_en: 'Please do not send your Medicare ID, Social Security number, banking information, or private medical records here. This chat is for organizing your question — sensitive details should only be shared securely with a licensed advisor.',
  privacy_warning_es: 'Por favor no envíe su número de Medicare, Seguro Social, información bancaria ni récords médicos privados por aquí. Este chat es para organizar su pregunta — los detalles sensibles solo deben compartirse de forma segura con un asesor licenciado.',
  privacy_acknowledge_en: 'I understand — continue',
  privacy_acknowledge_es: 'Entiendo — continuar',
  intent_pick_en: 'What can I help you organize today? Pick a topic or type your question.',
  intent_pick_es: '¿Con qué le ayudo a organizar hoy? Elija un tema o escriba su pregunta.',
  emergency_title_en: 'Emergency',
  emergency_title_es: 'Emergencia',
  emergency_text_en: "This chat isn't for emergencies. If you're having a medical emergency, please call 911 or go to your nearest emergency room. Once you're safe, you can come back and we'll help organize your Medicare question.",
  emergency_text_es: 'Este chat no es para emergencias. Si tiene una emergencia médica, por favor llame al 911 o vaya a la sala de emergencias más cercana. Cuando esté a salvo, puede regresar y le ayudaremos a organizar su pregunta sobre Medicare.',
  emergency_acknowledge_en: 'I understand',
  emergency_acknowledge_es: 'Entiendo',
  pii_intercept_en: 'It looks like you typed sensitive information (such as a Medicare ID, Social Security number, or card number). For your safety, I am not saving that. Please do not share those details here — share them only with a licensed advisor through a secure channel.',
  pii_intercept_es: 'Parece que escribió información sensible (como un número de Medicare, Seguro Social, o número de tarjeta). Por su seguridad, no la estoy guardando. Por favor no comparta esos detalles aquí — compártalos solo con un asesor licenciado a través de un canal seguro.',
  ask_first_name_en: "Let's start with your first name:",
  ask_first_name_es: 'Empecemos con su nombre:',
  ask_phone_en: 'Your phone number (so a licensed advisor can follow up):',
  ask_phone_es: 'Su número de teléfono (para que un asesor licenciado pueda comunicarse):',
  ask_state_en: 'Which state do you live in?',
  ask_state_es: '¿En qué estado vive?',
  ask_zip_en: 'Your ZIP code (optional — type or skip):',
  ask_zip_es: 'Su código postal (opcional — escriba o omita):',
  ask_best_time_en: 'What time of day works best for a callback?',
  ask_best_time_es: '¿A qué hora del día le viene mejor recibir una llamada?',
  skip_en: 'Skip',
  skip_es: 'Omitir',
  consent_text_en: 'I agree to be contacted by a licensed ClearPoint advisor at the phone number I provided regarding my Medicare question. Message and data rates may apply.',
  consent_text_es: 'Acepto que un asesor licenciado de ClearPoint me contacte al número de teléfono que proporcioné respecto a mi pregunta de Medicare. Pueden aplicar tarifas de mensajes y datos.',
  consent_review_title_en: 'Ready to send to a licensed advisor?',
  consent_review_title_es: '¿Listo para enviar a un asesor licenciado?',
  consent_yes_en: 'Yes, send my case',
  consent_yes_es: 'Sí, enviar mi caso',
  submitting_en: 'Sending your case to a licensed advisor…',
  submitting_es: 'Enviando su caso a un asesor licenciado…',
  submitted_title_en: 'Got it. A licensed advisor will follow up.',
  submitted_title_es: 'Listo. Un asesor licenciado se comunicará con usted.',
  submitted_body_en: 'A bilingual ClearPoint advisor will review your case and contact you at the phone number you provided.',
  submitted_body_es: 'Un asesor bilingüe de ClearPoint revisará su caso y le contactará al número de teléfono que proporcionó.',
  failed_title_en: "Something went wrong sending your case.",
  failed_title_es: 'Algo salió mal al enviar su caso.',
  failed_body_en: 'Please call us directly at 1-866-310-8702 or try again. Your information was not stored.',
  failed_body_es: 'Por favor llámenos directamente al 1-866-310-8702 o intente de nuevo. Su información no se guardó.',
  retry_en: 'Try again',
  retry_es: 'Intentar de nuevo',
  reset_en: 'Start over',
  reset_es: 'Empezar de nuevo',
  send_en: 'Send',
  send_es: 'Enviar',
  type_here_en: 'Type your message…',
  type_here_es: 'Escriba su mensaje…',
};

const PRIMARY_BUTTONS_EN: { id: IntentId; label: string }[] = [
  { id: 'annual_review', label: 'Review my plan' },
  { id: 'medication_help', label: 'Medication help' },
  { id: 'doctor_network_question', label: 'Doctor/network question' },
  { id: 'plan_letter_issue', label: 'Letter or plan issue' },
  { id: 'extra_help_lis', label: 'Extra Help / Medicaid' },
  { id: 'benefit_card_issue', label: 'OTC / benefit card' },
  { id: 'appointment_requested', label: 'Schedule a call' },
  { id: 'new_to_medicare', label: 'New to Medicare' },
  { id: 'other_unknown', label: 'Something else' },
];
const PRIMARY_BUTTONS_ES: { id: IntentId; label: string }[] = [
  { id: 'annual_review', label: 'Revisar mi plan' },
  { id: 'medication_help', label: 'Ayuda con medicamentos' },
  { id: 'doctor_network_question', label: 'Doctores o red' },
  { id: 'plan_letter_issue', label: 'Carta o problema con mi plan' },
  { id: 'extra_help_lis', label: 'Extra Help / Medicaid' },
  { id: 'benefit_card_issue', label: 'Tarjeta OTC / beneficios' },
  { id: 'appointment_requested', label: 'Agendar una llamada' },
  { id: 'new_to_medicare', label: 'Nuevo en Medicare' },
  { id: 'other_unknown', label: 'Otro tema' },
];

const STATE_BUTTONS = [
  { value: 'NY' as const, label_en: 'New York', label_es: 'Nueva York' },
  { value: 'NJ' as const, label_en: 'New Jersey', label_es: 'Nueva Jersey' },
  { value: 'CT' as const, label_en: 'Connecticut', label_es: 'Connecticut' },
  { value: 'FL' as const, label_en: 'Florida', label_es: 'Florida' },
  { value: 'Other' as const, label_en: 'Other', label_es: 'Otro' },
];

const TIME_BUTTONS_EN = ['Morning', 'Afternoon', 'Evening', 'Anytime'];
const TIME_BUTTONS_ES = ['Mañana', 'Tarde', 'Noche', 'Cualquier hora'];

// ────────────────────────────────────────────────────────────────────────────
// GHL PAYLOAD BUILDER (Phase 3)
// ────────────────────────────────────────────────────────────────────────────

/** Build the tags array per Sawil's Phase 3 spec. */
export function buildSupportTags(state: SupportState): string[] {
  const tags: string[] = ['customer_service_bot', 'clearpoint_support'];

  // Language tag
  if (state.language_switches > 0) {
    tags.push('bilingual');
  } else {
    tags.push(state.language === 'es' ? 'spanish' : 'english');
  }

  // Intent tags (primary + secondary)
  if (state.primary_intent) {
    const primary = getIntent(state.primary_intent);
    tags.push(primary.ghl_tag);
  }
  for (const sid of state.secondary_intents) {
    const s = getIntent(sid);
    if (!tags.includes(s.ghl_tag)) tags.push(s.ghl_tag);
  }

  // Routing tags
  if (state.requires_agent_review) tags.push('needs_agent_review');
  if (state.urgency === 'urgent' || state.urgency === 'high') tags.push('urgent_review');

  // Compliance proof tag
  if (state.privacy_warning_shown) tags.push('sensitive_warning_shown');
  if (state.emergency_warning_shown) tags.push('emergency_warning_shown');

  return tags;
}

/** Build the lead_notes summary per Sawil's Phase 3 spec. */
export function buildSupportLeadNotes(state: SupportState): string {
  const secondaryStr = state.secondary_intents.length > 0
    ? state.secondary_intents.join(', ')
    : 'none';
  const langStr = state.language_switches > 0
    ? `${state.preferred_language || 'unknown'} (bilingual conversation, ${state.language_switches} language switches)`
    : (state.preferred_language || 'unknown');
  const questionsStr = state.customer_questions.length > 0
    ? state.customer_questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')
    : '  (no free-text questions captured)';
  const nextAction = state.requires_agent_review
    ? 'A licensed advisor should review this case and follow up with the customer.'
    : 'Educational information requested. A licensed advisor can follow up if needed.';

  return [
    '[ClearPoint Support Guide]',
    `Submitted: ${new Date().toISOString()}`,
    `Language: ${langStr}`,
    '',
    'CASE',
    `Main issue: ${state.primary_intent || 'unknown'}`,
    `Secondary issues: ${secondaryStr}`,
    `Urgency: ${state.urgency}`,
    '',
    'CUSTOMER CONTEXT',
    `State: ${state.state || 'not provided'}`,
    `ZIP: ${state.zip || 'not provided'}`,
    `Best time to call: ${state.best_time_to_call || 'not specified'}`,
    `Consent to contact: ${state.consent_to_contact ? 'YES' : 'NO'}`,
    `Sensitive info warning shown: ${state.privacy_warning_shown ? 'YES' : 'NO'}`,
    `Sensitive data intercepted by bot: ${state.sensitive_data_intercepted ? 'YES' : 'NO'}`,
    `Emergency warning triggered: ${state.emergency_warning_shown ? 'YES' : 'NO'}`,
    '',
    'CUSTOMER QUESTIONS / CONTEXT',
    questionsStr,
    '',
    'RECOMMENDED NEXT ACTION',
    nextAction,
  ].join('\n');
}

/** Build the full GHL payload to pass to existing submitLeadToGHL(). */
export function buildSupportPayload(state: SupportState) {
  return {
    source: 'customer_service_bot',
    page_url: typeof window !== 'undefined' ? window.location.href : '',
    form_name: 'ClearPoint Support Guide',
    first_name: state.first_name,
    last_name: state.last_name || '',
    full_name: `${state.first_name} ${state.last_name}`.trim(),
    phone: state.phone,
    email: state.email,
    zip_code: state.zip,
    preferred_language: state.preferred_language === 'Spanish' ? 'Spanish'
      : state.preferred_language === 'English' ? 'English'
      : state.language === 'es' ? 'Spanish' : 'English',
    medicare_status: '',
    interest_type: state.primary_intent || '',
    best_time_to_contact: state.best_time_to_call,
    consent_to_contact: state.consent_to_contact,
    consent_text: state.language === 'es' ? COPY.consent_text_es : COPY.consent_text_en,
    lead_notes: buildSupportLeadNotes(state),
    bot_transcript_summary: `Support bot · Primary: ${state.primary_intent} · Secondary: ${state.secondary_intents.join(', ') || 'none'} · Urgency: ${state.urgency}`,
    tags: buildSupportTags(state),
    created_at: new Date().toISOString(),
    derived_state: state.state || '',
    website_url: '', // honeypot — always empty for real users
  };
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────────────────

const SESSION_KEY = 'clear_point_support_session_memory';

export function CustomerServiceBot() {
  const { lang: pageLang } = useLanguage();
  const initialBotLang: 'en' | 'es' = pageLang === 'es' ? 'es' : 'en';

  const [state, dispatch] = useReducer(reduce, initialBotLang, (l) => initialState(l));
  const [inputText, setInputText] = useState('');
  const [showPrivacyBanner, setShowPrivacyBanner] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }, [state]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages.length]);

  const lang = state.language;

  // Bot says (adds to transcript)
  const botSay = (text: string) => dispatch({ type: 'ADD_BOT_MESSAGE', text });

  const handlePickLanguage = (l: 'en' | 'es') => {
    dispatch({ type: 'PICK_LANGUAGE', lang: l });
    setTimeout(() => botSay(l === 'es' ? COPY.greeting_es : COPY.greeting_en), 100);
  };

  const handleAcknowledgePrivacy = () => {
    dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
    setTimeout(() => {
      botSay(lang === 'es' ? COPY.intent_pick_es : COPY.intent_pick_en);
    }, 100);
  };

  const handleIntentButton = (intentId: IntentId) => {
    const intent = getIntent(intentId);
    const buttonLabel = lang === 'es'
      ? PRIMARY_BUTTONS_ES.find((b) => b.id === intentId)?.label || intentId
      : PRIMARY_BUTTONS_EN.find((b) => b.id === intentId)?.label || intentId;
    dispatch({ type: 'ADD_USER_MESSAGE', text: buttonLabel });
    dispatch({ type: 'SET_INTENT', primary: intentId, secondary: [], confidence: 'high' });
    setTimeout(() => {
      botSay(lang === 'es' ? intent.next_question_es : intent.next_question_en);
      botSay(lang === 'es' ? COPY.ask_first_name_es : COPY.ask_first_name_en);
    }, 100);
  };

  const handleUserSubmit = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    // Emergency first
    if (detectEmergency(text)) {
      dispatch({ type: 'ADD_USER_MESSAGE', text });
      dispatch({ type: 'EMERGENCY_DETECTED' });
      setTimeout(() => botSay(lang === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en), 100);
      return;
    }

    // PII
    const pii = detectPii(text);
    if (pii.isPii) {
      dispatch({ type: 'PII_INTERCEPTED' });
      setTimeout(() => botSay(lang === 'es' ? COPY.pii_intercept_es : COPY.pii_intercept_en), 100);
      return;
    }

    dispatch({ type: 'ADD_USER_MESSAGE', text });

    const step = state.current_step;

    // FREE TEXT intent classification
    if (step === 'intent_pick') {
      const result = classifyIntent(text, lang);
      dispatch({
        type: 'SET_INTENT',
        primary: result.primary,
        secondary: result.secondary,
        confidence: result.confidence,
      });
      setTimeout(() => {
        const intent = getIntent(result.primary);
        botSay(lang === 'es' ? intent.next_question_es : intent.next_question_en);
        if (result.secondary.length > 0) {
          const list = result.secondary
            .map((s) => {
              const def = getIntent(s);
              return lang === 'es' ? def.ghl_tag.replace(/_/g, ' ') : def.ghl_tag.replace(/_/g, ' ');
            })
            .join(', ');
          botSay(lang === 'es'
            ? `También noté que mencionó: ${list}. Lo incluiré en el resumen para el asesor.`
            : `I also noticed you mentioned: ${list}. I'll include that in the summary for the advisor.`);
        }
        botSay(lang === 'es' ? COPY.ask_first_name_es : COPY.ask_first_name_en);
      }, 100);
      return;
    }

    // FIELD COLLECTION
    if (step === 'collecting_first_name') {
      dispatch({ type: 'COLLECT_FIRST_NAME', value: text });
      setTimeout(() => botSay(lang === 'es' ? COPY.ask_phone_es : COPY.ask_phone_en), 100);
      return;
    }
    if (step === 'collecting_phone') {
      dispatch({ type: 'COLLECT_PHONE', value: text });
      setTimeout(() => botSay(lang === 'es' ? COPY.ask_state_es : COPY.ask_state_en), 100);
      return;
    }
    if (step === 'collecting_zip_optional') {
      dispatch({ type: 'COLLECT_ZIP', value: text });
      setTimeout(() => botSay(lang === 'es' ? COPY.ask_best_time_es : COPY.ask_best_time_en), 100);
      return;
    }
    if (step === 'collecting_best_time') {
      dispatch({ type: 'COLLECT_BEST_TIME', value: text });
      return;
    }
  };

  const handleStateButton = (st: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other') => {
    dispatch({ type: 'ADD_USER_MESSAGE', text: st });
    dispatch({ type: 'COLLECT_STATE', value: st });
    setTimeout(() => botSay(lang === 'es' ? COPY.ask_zip_es : COPY.ask_zip_en), 100);
  };

  const handleSkipZip = () => {
    dispatch({ type: 'COLLECT_ZIP', value: '' });
    setTimeout(() => botSay(lang === 'es' ? COPY.ask_best_time_es : COPY.ask_best_time_en), 100);
  };

  const handleTimeButton = (timeLabel: string) => {
    dispatch({ type: 'ADD_USER_MESSAGE', text: timeLabel });
    dispatch({ type: 'COLLECT_BEST_TIME', value: timeLabel });
  };

  const handleSubmit = async () => {
    if (!state.consent_to_contact) return;
    dispatch({ type: 'SUBMITTING' });
    const payload = buildSupportPayload(state);
    try {
      // submitLeadToGHL returns boolean. We don't get contact ID back from this
      // wrapper, so we use a session_id-derived reference for the customer.
      const ok = await submitLeadToGHL(payload as any);
      if (ok) {
        dispatch({ type: 'SUBMIT_OK', contactId: state.session_id.slice(0, 6).toUpperCase() });
      } else {
        dispatch({ type: 'SUBMIT_FAIL', error: 'Server returned an error.' });
      }
    } catch (err: any) {
      dispatch({ type: 'SUBMIT_FAIL', error: err?.message || 'Network error.' });
    }
  };

  const handleReset = () => {
    dispatch({ type: 'RESET' });
    setInputText('');
  };

  const handleAcknowledgeEmergency = () => {
    dispatch({ type: 'ACK_EMERGENCY' });
  };

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl border-2 border-earth-200 shadow-soft max-w-4xl mx-auto overflow-hidden">
      {/* Header */}
      <div className="bg-earth-800 text-cream-50 px-6 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-sage-300 flex items-center justify-center text-earth-900">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <div className="font-serif text-base font-bold">{lang === 'es' ? COPY.brand_es : COPY.brand_en}</div>
          <div className="text-[11px] text-cream-50/70">{lang === 'es' ? 'Soporte ClearPoint · Bilingüe · Sin costo' : 'ClearPoint Support · Bilingual · No cost'}</div>
        </div>
      </div>

      {/* Privacy banner */}
      {showPrivacyBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-[12px] text-amber-900 flex items-start gap-2">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div className="flex-1">
            <div className="font-semibold mb-0.5">{lang === 'es' ? COPY.privacy_warning_title_es : COPY.privacy_warning_title_en}:</div>
            <div>{lang === 'es' ? COPY.privacy_warning_es : COPY.privacy_warning_en}</div>
          </div>
          <button onClick={() => setShowPrivacyBanner(false)} className="text-amber-700 hover:text-amber-900 text-[11px] font-semibold flex-shrink-0" aria-label={lang === 'es' ? 'Cerrar aviso' : 'Close notice'}>✕</button>
        </div>
      )}

      {/* Conversation */}
      <div ref={transcriptRef} className="px-6 py-5 max-h-[60vh] overflow-y-auto bg-cream-50 space-y-3">
        {state.current_step === 'language_pick' && (
          <div className="space-y-3">
            <BotBubble text={lang === 'es' ? COPY.greeting_es : COPY.greeting_en} />
            <BotBubble text={lang === 'es' ? COPY.language_prompt_es : COPY.language_prompt_en} />
            <div className="flex gap-2">
              <button onClick={() => handlePickLanguage('en')} className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 min-h-[44px]">English</button>
              <button onClick={() => handlePickLanguage('es')} className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 min-h-[44px]">Español</button>
            </div>
          </div>
        )}

        {state.current_step === 'privacy_acknowledge' && (
          <div className="space-y-3">
            <BotBubble text={lang === 'es' ? COPY.greeting_es : COPY.greeting_en} />
            <button onClick={handleAcknowledgePrivacy} className="px-5 py-2.5 bg-sage-300 text-earth-900 rounded-lg text-sm font-semibold hover:bg-sage-400 min-h-[44px]">
              {lang === 'es' ? COPY.privacy_acknowledge_es : COPY.privacy_acknowledge_en}
            </button>
          </div>
        )}

        {state.messages.map((m) => m.role === 'bot' ? <BotBubble key={m.id} text={m.text} /> : <UserBubble key={m.id} text={m.text} />)}

        {state.current_step === 'intent_pick' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            {(lang === 'es' ? PRIMARY_BUTTONS_ES : PRIMARY_BUTTONS_EN).map((btn) => (
              <button key={btn.id} onClick={() => handleIntentButton(btn.id)} className="px-4 py-3 bg-white border border-earth-200 text-earth-800 rounded-lg text-sm font-medium hover:bg-cream-100 hover:border-earth-400 min-h-[44px] text-left transition-colors">{btn.label}</button>
            ))}
          </div>
        )}

        {state.current_step === 'collecting_state' && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
            {STATE_BUTTONS.map((s) => (
              <button key={s.value} onClick={() => handleStateButton(s.value)} className="px-3 py-2.5 bg-white border border-earth-200 text-earth-800 rounded-lg text-sm font-medium hover:bg-cream-100 hover:border-earth-400 min-h-[44px]">{lang === 'es' ? s.label_es : s.label_en}</button>
            ))}
          </div>
        )}

        {state.current_step === 'collecting_zip_optional' && (
          <div className="flex gap-2 mt-2">
            <button onClick={handleSkipZip} className="px-4 py-2.5 bg-cream-100 border border-earth-200 text-earth-700 rounded-lg text-sm font-medium hover:bg-cream-200 min-h-[44px]">{lang === 'es' ? COPY.skip_es : COPY.skip_en}</button>
          </div>
        )}

        {state.current_step === 'collecting_best_time' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {(lang === 'es' ? TIME_BUTTONS_ES : TIME_BUTTONS_EN).map((label) => (
              <button key={label} onClick={() => handleTimeButton(label)} className="px-3 py-2.5 bg-white border border-earth-200 text-earth-800 rounded-lg text-sm font-medium hover:bg-cream-100 hover:border-earth-400 min-h-[44px]">{label}</button>
            ))}
          </div>
        )}

        {state.current_step === 'consent_review' && (
          <ConsentReview state={state} lang={lang} onToggleConsent={(v) => dispatch({ type: 'SET_CONSENT', value: v })} onSubmit={handleSubmit} />
        )}

        {state.current_step === 'submitting' && (
          <div className="bg-sage-100 border border-sage-300 rounded-xl p-5 my-3 text-earth-800 text-sm">
            {lang === 'es' ? COPY.submitting_es : COPY.submitting_en}
          </div>
        )}

        {state.current_step === 'submitted' && (
          <div className="bg-sage-100 border border-sage-300 rounded-xl p-5 my-3">
            <div className="font-bold text-earth-900 mb-2">✓ {lang === 'es' ? COPY.submitted_title_es : COPY.submitted_title_en}</div>
            <p className="text-earth-700 text-sm leading-relaxed mb-1">{lang === 'es' ? COPY.submitted_body_es : COPY.submitted_body_en}</p>
            <p className="text-earth-500 text-xs mb-3">Ref: {state.submission_id}</p>
            <button onClick={handleReset} className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 min-h-[44px]">{lang === 'es' ? COPY.reset_es : COPY.reset_en}</button>
          </div>
        )}

        {state.current_step === 'submission_failed' && (
          <div className="bg-red-50 border border-red-300 rounded-xl p-5 my-3">
            <div className="font-bold text-red-900 mb-2">{lang === 'es' ? COPY.failed_title_es : COPY.failed_title_en}</div>
            <p className="text-red-900 text-sm leading-relaxed mb-3">{lang === 'es' ? COPY.failed_body_es : COPY.failed_body_en}</p>
            <a href="tel:18663108702" className="inline-block px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-bold mr-2">1-866-310-8702</a>
            <button onClick={handleSubmit} className="inline-block px-5 py-2.5 bg-white border border-red-300 text-red-900 rounded-lg text-sm font-semibold">{lang === 'es' ? COPY.retry_es : COPY.retry_en}</button>
          </div>
        )}

        {state.current_step === 'emergency_paused' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5 my-3">
            <div className="font-bold text-red-900 mb-2">{lang === 'es' ? COPY.emergency_title_es : COPY.emergency_title_en}</div>
            <p className="text-red-900 text-sm leading-relaxed mb-3">{lang === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en}</p>
            <a href="tel:911" className="inline-block px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold mr-2">{lang === 'es' ? 'Llamar 911' : 'Call 911'}</a>
            <button onClick={handleAcknowledgeEmergency} className="inline-block px-5 py-2.5 bg-white border border-red-300 text-red-900 rounded-lg text-sm font-semibold">{lang === 'es' ? COPY.emergency_acknowledge_es : COPY.emergency_acknowledge_en}</button>
          </div>
        )}
      </div>

      {/* Input row — only shown during input-required steps */}
      {(state.current_step === 'intent_pick' ||
        state.current_step === 'collecting_first_name' ||
        state.current_step === 'collecting_phone' ||
        state.current_step === 'collecting_zip_optional') && (
        <div className="border-t border-earth-200 px-6 py-3 bg-white flex gap-2 items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleUserSubmit(); } }}
            placeholder={lang === 'es' ? COPY.type_here_es : COPY.type_here_en}
            className="flex-1 px-4 py-2.5 border border-earth-200 rounded-lg text-sm focus:outline-none focus:border-earth-500 min-h-[44px]"
          />
          <button onClick={handleUserSubmit} disabled={!inputText.trim()} className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]">
            {lang === 'es' ? COPY.send_es : COPY.send_en}
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ────────────────────────────────────────────────────────────────────────────

function BotBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-earth-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-earth-800 max-w-[85%] leading-relaxed shadow-xs whitespace-pre-line">
        {text}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="bg-cream-100 border border-earth-200 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-earth-800 max-w-[85%] leading-relaxed">
        {text}
      </div>
    </div>
  );
}

function ConsentReview({ state, lang, onToggleConsent, onSubmit }: { state: SupportState; lang: 'en' | 'es'; onToggleConsent: (v: boolean) => void; onSubmit: () => void }) {
  return (
    <div className="bg-white border-2 border-earth-300 rounded-xl p-5 my-3">
      <h3 className="font-serif text-lg text-earth-900 mb-3">
        {lang === 'es' ? COPY.consent_review_title_es : COPY.consent_review_title_en}
      </h3>
      <dl className="space-y-1.5 text-sm mb-4">
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Nombre' : 'First name'}: </dt><dd className="inline text-earth-700">{state.first_name}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Teléfono' : 'Phone'}: </dt><dd className="inline text-earth-700">{state.phone}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Estado' : 'State'}: </dt><dd className="inline text-earth-700">{state.state}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">ZIP: </dt><dd className="inline text-earth-700">{state.zip || '—'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Mejor hora' : 'Best time'}: </dt><dd className="inline text-earth-700">{state.best_time_to_call}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Tema principal' : 'Main topic'}: </dt><dd className="inline text-earth-700">{state.primary_intent}</dd></div>
        {state.secondary_intents.length > 0 && (
          <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Temas secundarios' : 'Secondary topics'}: </dt><dd className="inline text-earth-700">{state.secondary_intents.join(', ')}</dd></div>
        )}
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Urgencia' : 'Urgency'}: </dt><dd className="inline text-earth-700">{state.urgency}</dd></div>
      </dl>

      <label className="flex items-start gap-2 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={state.consent_to_contact}
          onChange={(e) => onToggleConsent(e.target.checked)}
          className="mt-1 w-4 h-4 cursor-pointer"
        />
        <span className="text-xs text-earth-700 leading-relaxed">
          {lang === 'es' ? COPY.consent_text_es : COPY.consent_text_en}
        </span>
      </label>

      <button
        onClick={onSubmit}
        disabled={!state.consent_to_contact}
        className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
      >
        {lang === 'es' ? COPY.consent_yes_es : COPY.consent_yes_en}
      </button>
    </div>
  );
}

// Exports for QA harness
export { detectPii, detectEmergency, detectLanguage };

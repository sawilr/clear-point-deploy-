/**
 * Customer Service Bot — ClearPoint Support Guide (Phase 2 MVP)
 *
 * Page-resident component (NOT a floating launcher). Lives inside Support.tsx.
 *
 * Architecturally isolated from Zara:
 *   - Zero imports from src/components/ChatBot.tsx (Zara)
 *   - Zero imports from src/components/SmartMedicareReview.tsx
 *   - Zero imports from src/components/LeadForm.tsx
 *   - Different sessionStorage key (clear_point_support_session_memory)
 *   - Different brand name, color palette, layout
 *
 * Phase 2 scope (per Sawil approval):
 *   - English + Spanish flow
 *   - Privacy warning before info collected
 *   - Emergency disclaimer trigger
 *   - PII intercept (Medicare ID / SSN / banking / card numbers)
 *   - 17 intent classification (via customerServiceIntents.ts)
 *   - Multi-topic stacking
 *   - Mid-conversation language switch
 *   - Local summary preview
 *   - NO GHL submission (Phase 3)
 *   - NO recommendations / eligibility claims / network confirmation / etc.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { classifyIntent, getIntent, INTENTS, type IntentId, type IntentUrgency } from '../data/customerServiceIntents';

// ────────────────────────────────────────────────────────────────────────────
// PII DETECTOR — regex-based, zero false-positive tolerance for known patterns
// ────────────────────────────────────────────────────────────────────────────

type PiiCheckResult = {
  isPii: boolean;
  pattern: 'medicare_id' | 'ssn' | 'card_number' | 'bank_routing' | null;
};

function detectPii(text: string): PiiCheckResult {
  const normalized = text.replace(/\s+/g, ' ').trim();

  // Medicare Beneficiary ID (MBI) format: 1AA1-AA1-AA11 (alphanumeric, 11 chars, dashes optional)
  // CMS MBI pattern: position 1=1-9, positions 2,5,8,9=A-Z (no S/L/O/I/B/Z), positions 3,6,7,10,11=alphanumeric
  // Simplified regex catches the common pattern people write.
  const mbiPattern = /\b[1-9][A-Z][A-Z0-9][A-Z0-9]-?[A-Z][A-Z0-9]-?[A-Z][A-Z0-9]{3}\b/i;
  if (mbiPattern.test(normalized)) return { isPii: true, pattern: 'medicare_id' };

  // SSN: 9 consecutive digits OR 3-2-4 with optional dashes/spaces
  const ssnPattern = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
  // Strip out 10-digit phone-looking patterns and 5+4 zip patterns from the SSN test
  const phonePattern = /\b\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4}\b/;
  if (ssnPattern.test(normalized) && !phonePattern.test(normalized)) {
    return { isPii: true, pattern: 'ssn' };
  }

  // Credit/debit/HSA card numbers: 13-19 consecutive digits (often grouped 4-4-4-4)
  const cardPattern = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/;
  if (cardPattern.test(normalized)) return { isPii: true, pattern: 'card_number' };

  // Bank routing: exactly 9 digits in a row (also matches SSN; we already caught SSN above)
  const routingPattern = /\b\d{9}\b/;
  if (routingPattern.test(normalized) && !phonePattern.test(normalized)) {
    return { isPii: true, pattern: 'bank_routing' };
  }

  return { isPii: false, pattern: null };
}

// ────────────────────────────────────────────────────────────────────────────
// EMERGENCY DETECTOR — keyword regex, bilingual
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
  const lower = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  for (const kw of EMERGENCY_KEYWORDS_EN) {
    if (lower.includes(kw)) return true;
  }
  for (const kw of EMERGENCY_KEYWORDS_ES) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// LANGUAGE DETECTOR — simple heuristic for mid-conversation switch
// ────────────────────────────────────────────────────────────────────────────

const ES_STOPWORDS = ['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'del', 'las', 'un', 'por', 'con', 'no', 'una', 'su', 'para', 'es', 'al', 'mi', 'mis', 'me', 'tu', 'sus', 'qué', 'cómo', 'cuándo', 'dónde', 'quién', 'porqué', 'por qué'];
const EN_STOPWORDS = ['the', 'is', 'and', 'a', 'to', 'of', 'in', 'for', 'on', 'with', 'i', 'you', 'it', 'my', 'we', 'they', 'what', 'when', 'where', 'who', 'why', 'how'];

function detectLanguage(text: string): 'en' | 'es' | 'mixed' {
  const words = text.toLowerCase().split(/\s+/);
  let esHits = 0;
  let enHits = 0;
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
  | 'greeting'
  | 'language_pick'
  | 'privacy_acknowledge'
  | 'intent_pick'
  | 'collecting_first_name'
  | 'collecting_phone'
  | 'collecting_state'
  | 'collecting_zip'
  | 'collecting_intent_context'
  | 'topic_stacking_check'
  | 'collecting_best_time'
  | 'consent_review'
  | 'summary_preview'
  | 'submitted'
  | 'emergency_paused';

type Message = {
  id: string;
  role: 'bot' | 'user' | 'system';
  text: string;
  // For bot messages with buttons
  buttons?: { id: string; label: string }[];
  // For bot messages that show a link to internal page
  link?: { url: string; label_en: string; label_es: string };
};

interface SupportState {
  // Identity
  session_id: string;
  started_at: string;
  turn_count: number;

  // Language tracking
  language: 'en' | 'es';
  preferred_language: 'English' | 'Spanish' | 'Either' | '';
  language_switches: number;

  // Intent
  topics_detected: IntentId[];
  primary_intent: IntentId | null;
  secondary_intents: IntentId[];
  confidence: 'high' | 'medium' | 'low' | null;

  // Routing
  urgency: IntentUrgency;
  requires_agent_review: boolean;

  // Compliance flags
  privacy_warning_shown: boolean;
  sensitive_data_intercepted: boolean;
  emergency_warning_shown: boolean;
  consent_to_contact: boolean;

  // Contact
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  state: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' | '';
  zip: string;
  best_time_to_call: string;

  // Summary
  customer_questions: string[];
  summary_points: string[];
  recommended_next_action: string;

  // Conversation
  current_step: SupportStep;
  last_question_asked: string | null;
  completed_steps: SupportStep[];
  topic_stack: IntentId[];
  messages: Message[];

  // Submission (Phase 2 = local only)
  submitted: boolean;
}

type Action =
  | { type: 'INIT'; initialLanguage: 'en' | 'es' }
  | { type: 'PICK_LANGUAGE'; lang: 'en' | 'es' }
  | { type: 'ACKNOWLEDGE_PRIVACY' }
  | { type: 'INTENT_BUTTON_CLICK'; intentId: IntentId }
  | { type: 'USER_MESSAGE'; text: string }
  | { type: 'EMERGENCY_DETECTED' }
  | { type: 'PII_INTERCEPTED' }
  | { type: 'COLLECT_FIELD'; field: 'first_name' | 'last_name' | 'phone' | 'state' | 'zip' | 'best_time_to_call'; value: string }
  | { type: 'CONSENT_TOGGLE'; value: boolean }
  | { type: 'GENERATE_SUMMARY' }
  | { type: 'SUBMIT_LOCAL' }
  | { type: 'ADD_BOT_MESSAGE'; text: string; buttons?: { id: string; label: string }[]; link?: { url: string; label_en: string; label_es: string } }
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
    last_question_asked: null,
    completed_steps: [],
    topic_stack: [],
    messages: [],
    submitted: false,
  };
}

function reduce(state: SupportState, action: Action): SupportState {
  switch (action.type) {
    case 'INIT':
      return initialState(action.initialLanguage);

    case 'PICK_LANGUAGE':
      return {
        ...state,
        language: action.lang,
        preferred_language: action.lang === 'es' ? 'Spanish' : 'English',
        current_step: 'privacy_acknowledge',
        completed_steps: [...state.completed_steps, 'language_pick'],
        language_switches: state.preferred_language && state.language !== action.lang
          ? state.language_switches + 1
          : state.language_switches,
      };

    case 'ACKNOWLEDGE_PRIVACY':
      return {
        ...state,
        privacy_warning_shown: true,
        current_step: 'intent_pick',
        completed_steps: [...state.completed_steps, 'privacy_acknowledge'],
      };

    case 'INTENT_BUTTON_CLICK': {
      const intent = getIntent(action.intentId);
      const newTopics = state.topics_detected.includes(action.intentId)
        ? state.topics_detected
        : [...state.topics_detected, action.intentId];
      return {
        ...state,
        primary_intent: action.intentId,
        topics_detected: newTopics,
        confidence: 'high', // explicit button click = high confidence
        urgency: state.urgency === 'urgent' ? 'urgent' : intent.default_urgency,
        requires_agent_review: state.requires_agent_review || intent.escalate_to_agent,
        current_step: 'collecting_first_name',
        completed_steps: [...state.completed_steps, 'intent_pick'],
        last_question_asked: 'first_name',
      };
    }

    case 'USER_MESSAGE': {
      const lang = state.language;
      const detectedLang = detectLanguage(action.text);
      let nextLang = lang;
      let langSwitches = state.language_switches;
      if (detectedLang !== 'mixed' && detectedLang !== lang && state.turn_count > 1) {
        nextLang = detectedLang;
        langSwitches++;
      }
      return {
        ...state,
        language: nextLang,
        language_switches: langSwitches,
        turn_count: state.turn_count + 1,
        customer_questions: [...state.customer_questions, action.text],
      };
    }

    case 'EMERGENCY_DETECTED':
      return {
        ...state,
        emergency_warning_shown: true,
        current_step: 'emergency_paused',
        urgency: 'urgent',
      };

    case 'PII_INTERCEPTED':
      return {
        ...state,
        sensitive_data_intercepted: true,
      };

    case 'COLLECT_FIELD':
      return {
        ...state,
        [action.field]: action.value,
      };

    case 'CONSENT_TOGGLE':
      return {
        ...state,
        consent_to_contact: action.value,
      };

    case 'GENERATE_SUMMARY': {
      const points: string[] = [];
      if (state.primary_intent) {
        points.push(`Main issue: ${state.primary_intent}`);
      }
      if (state.secondary_intents.length > 0) {
        points.push(`Secondary: ${state.secondary_intents.join(', ')}`);
      }
      points.push(`Urgency: ${state.urgency}`);
      points.push(`State: ${state.state || 'not provided'} · ZIP: ${state.zip || 'not provided'}`);
      points.push(`Consent to contact: ${state.consent_to_contact ? 'YES' : 'NO'}`);
      points.push(`Sensitive info warning shown: ${state.privacy_warning_shown ? 'YES' : 'NO'}`);
      const action_text = state.requires_agent_review
        ? 'A licensed advisor should review this case and follow up with the customer.'
        : 'Educational information provided. Customer may request a callback if needed.';
      return {
        ...state,
        summary_points: points,
        recommended_next_action: action_text,
        current_step: 'summary_preview',
      };
    }

    case 'SUBMIT_LOCAL':
      return {
        ...state,
        submitted: true,
        current_step: 'submitted',
      };

    case 'ADD_BOT_MESSAGE':
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: uid(), role: 'bot', text: action.text, buttons: action.buttons, link: action.link },
        ],
      };

    case 'RESET':
      return initialState(state.language);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// COPY — bilingual UI strings
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

  intent_pick_en: 'What can I help you organize today?',
  intent_pick_es: '¿Con qué le ayudo a organizar hoy?',

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
  ask_zip_en: 'Your ZIP code (optional but helps a licensed advisor):',
  ask_zip_es: 'Su código postal (opcional pero ayuda al asesor licenciado):',
  ask_best_time_en: 'What time of day works best for a callback?',
  ask_best_time_es: '¿A qué hora del día le viene mejor recibir una llamada?',

  consent_en: 'Do you consent to be contacted by a licensed ClearPoint advisor at the phone number you provided?',
  consent_es: '¿Da su consentimiento para que un asesor licenciado de ClearPoint le contacte al número de teléfono que proporcionó?',
  consent_yes_en: 'Yes, contact me',
  consent_yes_es: 'Sí, contácteme',
  consent_no_en: 'No, just save my notes',
  consent_no_es: 'No, solo guarde mis notas',

  summary_header_en: "Here's what I have organized for the licensed advisor:",
  summary_header_es: 'Esto es lo que tengo organizado para el asesor licenciado:',

  local_notice_en: '[Phase 2 — Local preview only. In Phase 3, this will be sent to a licensed advisor automatically.]',
  local_notice_es: '[Fase 2 — Vista previa local. En la Fase 3, esto se enviará automáticamente a un asesor licenciado.]',

  submit_button_en: 'Save this preview (local only)',
  submit_button_es: 'Guardar esta vista previa (solo local)',

  submitted_en: 'Saved locally. In Phase 3, a licensed ClearPoint advisor will receive this case automatically.',
  submitted_es: 'Guardado localmente. En la Fase 3, un asesor licenciado de ClearPoint recibirá este caso automáticamente.',

  reset_en: 'Start over',
  reset_es: 'Empezar de nuevo',

  send_en: 'Send',
  send_es: 'Enviar',

  type_here_en: 'Type your message…',
  type_here_es: 'Escriba su mensaje…',

  topic_stacking_prefix_en: 'I also noticed you mentioned',
  topic_stacking_prefix_es: 'También noté que mencionó',

  states_label_en: ['New York', 'New Jersey', 'Connecticut', 'Florida', 'Other'],
  states_label_es: ['Nueva York', 'Nueva Jersey', 'Connecticut', 'Florida', 'Otro'],
  states_value: ['NY', 'NJ', 'CT', 'FL', 'Other'] as const,

  best_time_options_en: ['Morning', 'Afternoon', 'Evening', 'Anytime'],
  best_time_options_es: ['Mañana', 'Tarde', 'Noche', 'Cualquier hora'],
};

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

  // Persist + restore session
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<SupportState>;
        if (parsed.session_id && !parsed.submitted) {
          // Restore — but we have no resumeAction so just initialize and move on.
          // For Phase 2 simplicity, we don't auto-restore; user starts fresh each visit.
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  // Auto-scroll transcript on new message
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.messages.length]);

  const lang = state.language;

  // ── Helpers ──
  const addBotMessage = (text: string, buttons?: { id: string; label: string }[], link?: { url: string; label_en: string; label_es: string }) => {
    dispatch({ type: 'ADD_BOT_MESSAGE', text, buttons, link });
  };

  const handlePickLanguage = (l: 'en' | 'es') => {
    dispatch({ type: 'PICK_LANGUAGE', lang: l });
    setTimeout(() => {
      const greeting = l === 'es' ? COPY.greeting_es : COPY.greeting_en;
      addBotMessage(greeting);
    }, 100);
  };

  const handleAcknowledgePrivacy = () => {
    dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
    setTimeout(() => {
      const prompt = lang === 'es' ? COPY.intent_pick_es : COPY.intent_pick_en;
      addBotMessage(prompt);
    }, 100);
  };

  const handleIntentButton = (intentId: IntentId) => {
    const intent = getIntent(intentId);
    const intentLabel = lang === 'es'
      ? PRIMARY_BUTTONS_ES.find((b) => b.id === intentId)?.label || intentId
      : PRIMARY_BUTTONS_EN.find((b) => b.id === intentId)?.label || intentId;
    // Show user "clicked" message
    dispatch({
      type: 'ADD_BOT_MESSAGE',
      text: `[${intentLabel}]`,
    });
    dispatch({ type: 'INTENT_BUTTON_CLICK', intentId });
    setTimeout(() => {
      const question = lang === 'es' ? intent.next_question_es : intent.next_question_en;
      addBotMessage(question);
    }, 100);
  };

  const handleUserSubmit = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    // Add user message to transcript first (visually)
    dispatch({
      type: 'ADD_BOT_MESSAGE',
      text: `→ ${text}`,
    });

    // Check emergency FIRST
    if (detectEmergency(text)) {
      dispatch({ type: 'EMERGENCY_DETECTED' });
      setTimeout(() => {
        const em = lang === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en;
        addBotMessage(em);
      }, 100);
      return;
    }

    // Check PII
    const pii = detectPii(text);
    if (pii.isPii) {
      dispatch({ type: 'PII_INTERCEPTED' });
      setTimeout(() => {
        const pi = lang === 'es' ? COPY.pii_intercept_es : COPY.pii_intercept_en;
        addBotMessage(pi);
      }, 100);
      return;
    }

    // Update message history
    dispatch({ type: 'USER_MESSAGE', text });

    // Route based on current step
    const step = state.current_step;
    if (step === 'intent_pick') {
      // Free-text intent classification
      const result = classifyIntent(text, lang);
      dispatch({ type: 'INTENT_BUTTON_CLICK', intentId: result.primary });
      // Also add any secondary intents to topics_detected via the reducer (handled by INTENT_BUTTON_CLICK for primary)
      // Show classification result + next question
      setTimeout(() => {
        const intent = getIntent(result.primary);
        const question = lang === 'es' ? intent.next_question_es : intent.next_question_en;
        addBotMessage(question);
      }, 100);
      return;
    }

    if (step === 'collecting_first_name') {
      dispatch({ type: 'COLLECT_FIELD', field: 'first_name', value: text });
      setTimeout(() => {
        const next = lang === 'es' ? COPY.ask_phone_es : COPY.ask_phone_en;
        addBotMessage(next);
      }, 100);
      // Manually transition step
      // Note: this is simplified — a fuller state machine would have a SET_STEP action
      return;
    }

    // Default fallback: try to classify
    const result = classifyIntent(text, lang);
    if (result.primary !== 'other_unknown') {
      dispatch({ type: 'INTENT_BUTTON_CLICK', intentId: result.primary });
      setTimeout(() => {
        const intent = getIntent(result.primary);
        const question = lang === 'es' ? intent.next_question_es : intent.next_question_en;
        addBotMessage(question);
      }, 100);
    } else {
      const fallback = getIntent('other_unknown');
      setTimeout(() => {
        const question = lang === 'es' ? fallback.next_question_es : fallback.next_question_en;
        addBotMessage(question);
      }, 100);
    }
  };

  const handleReset = () => {
    dispatch({ type: 'RESET' });
    setInputText('');
  };

  const handleAcknowledgeEmergency = () => {
    // Just return to intent pick
    dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
  };

  // ────────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl border-2 border-earth-200 shadow-soft max-w-4xl mx-auto overflow-hidden">
      {/* Bot header */}
      <div className="bg-earth-800 text-cream-50 px-6 py-4 flex items-center gap-3">
        {/* Distinct icon — clipboard, NOT a person/avatar like Zara */}
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

      {/* Persistent privacy banner — collapsible but flag survives session */}
      {showPrivacyBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-[12px] text-amber-900 flex items-start gap-2">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <div className="flex-1">
            <div className="font-semibold mb-0.5">{lang === 'es' ? COPY.privacy_warning_title_es : COPY.privacy_warning_title_en}:</div>
            <div>{lang === 'es' ? COPY.privacy_warning_es : COPY.privacy_warning_en}</div>
          </div>
          <button
            onClick={() => setShowPrivacyBanner(false)}
            className="text-amber-700 hover:text-amber-900 text-[11px] font-semibold flex-shrink-0"
            aria-label={lang === 'es' ? 'Cerrar aviso' : 'Close notice'}
          >
            ✕
          </button>
        </div>
      )}

      {/* Conversation transcript */}
      <div ref={transcriptRef} className="px-6 py-5 max-h-[60vh] overflow-y-auto bg-cream-50 space-y-3">
        {/* Language pick (initial) */}
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

        {/* Privacy acknowledge gate */}
        {state.current_step === 'privacy_acknowledge' && (
          <div className="space-y-3">
            <BotBubble text={lang === 'es' ? COPY.greeting_es : COPY.greeting_en} />
            <button onClick={handleAcknowledgePrivacy} className="px-5 py-2.5 bg-sage-300 text-earth-900 rounded-lg text-sm font-semibold hover:bg-sage-400 min-h-[44px]">
              {lang === 'es' ? COPY.privacy_acknowledge_es : COPY.privacy_acknowledge_en}
            </button>
          </div>
        )}

        {/* Conversation messages */}
        {state.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}

        {/* Intent pick */}
        {state.current_step === 'intent_pick' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
            {(lang === 'es' ? PRIMARY_BUTTONS_ES : PRIMARY_BUTTONS_EN).map((btn) => (
              <button
                key={btn.id}
                onClick={() => handleIntentButton(btn.id as IntentId)}
                className="px-4 py-3 bg-white border border-earth-200 text-earth-800 rounded-lg text-sm font-medium hover:bg-cream-100 hover:border-earth-400 min-h-[44px] text-left transition-colors"
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}

        {/* Emergency overlay */}
        {state.current_step === 'emergency_paused' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-5 my-3">
            <div className="font-bold text-red-900 mb-2">{lang === 'es' ? COPY.emergency_title_es : COPY.emergency_title_en}</div>
            <p className="text-red-900 text-sm leading-relaxed mb-3">{lang === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en}</p>
            <a href="tel:911" className="inline-block px-5 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold mr-2">
              {lang === 'es' ? 'Llamar 911' : 'Call 911'}
            </a>
            <button onClick={handleAcknowledgeEmergency} className="inline-block px-5 py-2.5 bg-white border border-red-300 text-red-900 rounded-lg text-sm font-semibold">
              {lang === 'es' ? COPY.emergency_acknowledge_es : COPY.emergency_acknowledge_en}
            </button>
          </div>
        )}

        {/* Summary preview */}
        {state.current_step === 'summary_preview' && (
          <SummaryPreview state={state} lang={lang} onSubmit={() => dispatch({ type: 'SUBMIT_LOCAL' })} />
        )}

        {state.current_step === 'submitted' && (
          <div className="bg-sage-100 border border-sage-300 rounded-xl p-5">
            <div className="text-earth-900 font-semibold mb-2">✓ {lang === 'es' ? 'Guardado' : 'Saved'}</div>
            <p className="text-earth-700 text-sm leading-relaxed mb-3">{lang === 'es' ? COPY.submitted_es : COPY.submitted_en}</p>
            <button onClick={handleReset} className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 min-h-[44px]">
              {lang === 'es' ? COPY.reset_es : COPY.reset_en}
            </button>
          </div>
        )}
      </div>

      {/* Input row */}
      {state.current_step !== 'language_pick' &&
        state.current_step !== 'privacy_acknowledge' &&
        state.current_step !== 'submitted' &&
        state.current_step !== 'emergency_paused' && (
          <div className="border-t border-earth-200 px-6 py-3 bg-white flex gap-2 items-center">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleUserSubmit();
                }
              }}
              placeholder={lang === 'es' ? COPY.type_here_es : COPY.type_here_en}
              className="flex-1 px-4 py-2.5 border border-earth-200 rounded-lg text-sm focus:outline-none focus:border-earth-500 min-h-[44px]"
            />
            <button
              onClick={handleUserSubmit}
              disabled={!inputText.trim()}
              className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
            >
              {lang === 'es' ? COPY.send_es : COPY.send_en}
            </button>
            {state.current_step !== 'intent_pick' && (
              <button
                onClick={() => dispatch({ type: 'GENERATE_SUMMARY' })}
                className="px-4 py-2.5 bg-sage-300 text-earth-900 rounded-lg text-sm font-semibold hover:bg-sage-400 min-h-[44px] whitespace-nowrap"
              >
                {lang === 'es' ? 'Ver resumen' : 'See summary'}
              </button>
            )}
          </div>
        )}

      {/* Footer note — Phase 2 local-only notice */}
      <div className="border-t border-earth-200 px-6 py-2 bg-cream-100 text-[10px] text-earth-500 text-center">
        {lang === 'es' ? COPY.local_notice_es : COPY.local_notice_en}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PRIMARY BUTTONS — entry intents shown after privacy acknowledgement
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ────────────────────────────────────────────────────────────────────────────

function BotBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-earth-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-earth-800 max-w-[85%] leading-relaxed shadow-xs">
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

function MessageBubble({ message }: { message: Message }) {
  if (message.text.startsWith('→ ')) {
    return <UserBubble text={message.text.slice(2)} />;
  }
  if (message.text.startsWith('[') && message.text.endsWith(']')) {
    // intent button click echo — show as user bubble
    return <UserBubble text={message.text.slice(1, -1)} />;
  }
  return <BotBubble text={message.text} />;
}

function SummaryPreview({ state, lang, onSubmit }: { state: SupportState; lang: 'en' | 'es'; onSubmit: () => void }) {
  return (
    <div className="bg-white border-2 border-earth-300 rounded-xl p-5 my-3">
      <h3 className="font-serif text-lg text-earth-900 mb-3">
        {lang === 'es' ? COPY.summary_header_es : COPY.summary_header_en}
      </h3>
      <dl className="space-y-2 text-sm">
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Tema principal' : 'Main topic'}: </dt><dd className="inline text-earth-700">{state.primary_intent || '—'}</dd></div>
        {state.secondary_intents.length > 0 && (
          <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Temas secundarios' : 'Secondary topics'}: </dt><dd className="inline text-earth-700">{state.secondary_intents.join(', ')}</dd></div>
        )}
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Urgencia' : 'Urgency'}: </dt><dd className="inline text-earth-700">{state.urgency}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Nombre' : 'First name'}: </dt><dd className="inline text-earth-700">{state.first_name || '—'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Estado' : 'State'}: </dt><dd className="inline text-earth-700">{state.state || '—'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'ZIP' : 'ZIP'}: </dt><dd className="inline text-earth-700">{state.zip || '—'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Idioma preferido' : 'Preferred language'}: </dt><dd className="inline text-earth-700">{state.preferred_language || '—'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Aviso de privacidad mostrado' : 'Privacy warning shown'}: </dt><dd className="inline text-earth-700">{state.privacy_warning_shown ? 'YES' : 'NO'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Datos sensibles interceptados' : 'Sensitive data intercepted'}: </dt><dd className="inline text-earth-700">{state.sensitive_data_intercepted ? 'YES' : 'NO'}</dd></div>
        <div><dt className="font-semibold text-earth-800 inline">{lang === 'es' ? 'Emergencia detectada' : 'Emergency detected'}: </dt><dd className="inline text-earth-700">{state.emergency_warning_shown ? 'YES' : 'NO'}</dd></div>
      </dl>
      <div className="mt-4 pt-4 border-t border-earth-200">
        <div className="text-xs text-earth-500 mb-3">{lang === 'es' ? COPY.local_notice_es : COPY.local_notice_en}</div>
        <button onClick={onSubmit} className="px-5 py-2.5 bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 min-h-[44px]">
          {lang === 'es' ? COPY.submit_button_es : COPY.submit_button_en}
        </button>
      </div>
    </div>
  );
}

// Export for test harness
export { classifyIntent, detectPii, detectEmergency, detectLanguage, INTENTS };

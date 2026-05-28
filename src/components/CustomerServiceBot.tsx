/**
 * Customer Service Box — natural-conversation intake
 *
 * Inline (page-resident) chat surface for /support. NOT a floating launcher.
 *
 * UX direction (Wave 6):
 *   - Conversational, NOT button-heavy. Removes the 9-intent grid as the
 *     primary first step. The bot asks for name, ZIP/state, and the concern
 *     in plain language, then classifies silently and asks an intent-specific
 *     natural follow-up. One question at a time. Calm tone.
 *
 *   - Buttons are reserved for: language pick (the one place they're natural),
 *     privacy "I understand", best-time chips, state-shortcut chips (only if
 *     classifier couldn't parse the location), and the consent send. No big
 *     grid of intents.
 *
 * Architecture lineage from Zara:
 *   - Typing queue, monotonic bottom-follow scroll, header/footer chrome,
 *     bubble styling. Zero shared code with src/components/ChatBot.tsx.
 *
 * Pure logic in src/lib/customerServiceEngine.ts (no React). Designed so a
 * future phone/voice intake can reuse the same detectors, classifier, and
 * summary builder.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { Headphones, MessageCircle, Phone, RotateCcw, Send } from 'lucide-react';
import { type IntentId, type IntentUrgency } from '../data/customerServiceIntents';
import {
  classifyIntent,
  detectEmergency,
  detectFrustration,
  detectLanguage,
  detectSensitive,
  buildCaseSummary,
  buildMultiTopicAck,
  buildSupportTags,
  frustrationAck,
  advisorHandoffLine,
  intentFollowUp,
  parseZipOrState,
  splitFullName,
  type CaseState,
  type SupportLang,
} from '../lib/customerServiceEngine';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE  (natural conversation flow)
// ─────────────────────────────────────────────────────────────────────────────

type Step =
  | 'language_pick'        // pick EN/ES (only place buttons are mandatory)
  | 'privacy_acknowledge'  // "I understand"
  | 'collecting_full_name' // free text
  | 'collecting_location'  // free text → ZIP / state parsed
  | 'state_fallback'       // shown ONLY if parser couldn't infer state from "Other"
  | 'collecting_concern'   // free text (NO BUTTON GRID — this is the key UX shift)
  | 'intent_followup'      // free text answer to intent-specific follow-up
  | 'asking_callback_pref' // "Would you like an advisor to call you?" (Yes/No)
  | 'collecting_phone'     // free text — only when caller opted in OR case requires
  | 'collecting_best_time' // chips: Morning / Afternoon / Evening / Anytime
  | 'consent_review'       // checkbox + send
  | 'submitting'
  | 'submitted'
  | 'submission_failed'
  | 'emergency_paused';

type Pace = 'short' | 'long' | 'slow';
type MsgRole = 'bot' | 'user';

interface Message {
  id: string;
  role: MsgRole;
  text: string;
}

interface QueuedMsg {
  text: string;
  pace?: Pace;
}

interface State {
  session_id: string;
  started_at: string;
  turn_count: number;
  language: SupportLang;
  preferred_language: 'English' | 'Spanish' | '';
  language_switches: number;
  primary_intent: IntentId | null;
  secondary_intents: IntentId[];
  confidence: 'high' | 'medium' | 'low' | null;
  urgency: IntentUrgency;
  requires_agent_review: boolean;
  privacy_warning_shown: boolean;
  sensitive_data_intercepted: boolean;
  emergency_warning_shown: boolean;
  frustration_detected: boolean;
  wants_callback: boolean;
  consent_to_contact: boolean;
  first_name: string;
  last_name: string;
  phone: string;
  state: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' | '';
  zip: string;
  best_time_to_call: string;
  customer_questions: string[];
  current_step: Step;
  messages: Message[];
  submitted: boolean;
  submission_ref: string;
  submission_error: string;
}

type Action =
  | { type: 'INIT'; lang: SupportLang }
  | { type: 'PICK_LANGUAGE'; lang: SupportLang }
  | { type: 'ACKNOWLEDGE_PRIVACY' }
  | { type: 'ADD_USER_MSG'; text: string }
  | { type: 'ADD_BOT_MSG'; text: string }
  | { type: 'EMERGENCY_DETECTED' }
  | { type: 'ACK_EMERGENCY' }
  | { type: 'SENSITIVE_INTERCEPTED' }
  | { type: 'FRUSTRATION_FLAG' }
  | { type: 'COLLECT_FULL_NAME'; first: string; last: string }
  | { type: 'COLLECT_LOCATION'; zip: string; state: State['state'] }
  | { type: 'COLLECT_STATE_FALLBACK'; value: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' }
  | { type: 'SET_INTENT'; primary: IntentId; secondary: IntentId[]; confidence: 'high' | 'medium' | 'low'; requires_agent_review: boolean; urgency: IntentUrgency }
  | { type: 'CONCERN_CAPTURED' }
  | { type: 'WANTS_CALLBACK'; value: boolean }
  | { type: 'COLLECT_PHONE'; value: string }
  | { type: 'COLLECT_BEST_TIME'; value: string }
  | { type: 'SET_CONSENT'; value: boolean }
  | { type: 'SUBMITTING' }
  | { type: 'SUBMIT_OK'; ref: string }
  | { type: 'SUBMIT_FAIL'; error: string }
  | { type: 'SET_STEP'; step: Step }
  | { type: 'RESET'; lang: SupportLang };

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function initialState(lang: SupportLang): State {
  return {
    session_id: uid(),
    started_at: new Date().toISOString(),
    turn_count: 0,
    language: lang,
    preferred_language: '',
    language_switches: 0,
    primary_intent: null,
    secondary_intents: [],
    confidence: null,
    urgency: 'normal',
    requires_agent_review: false,
    privacy_warning_shown: false,
    sensitive_data_intercepted: false,
    emergency_warning_shown: false,
    frustration_detected: false,
    wants_callback: false,
    consent_to_contact: false,
    first_name: '',
    last_name: '',
    phone: '',
    state: '',
    zip: '',
    best_time_to_call: '',
    customer_questions: [],
    current_step: 'language_pick',
    messages: [],
    submitted: false,
    submission_ref: '',
    submission_error: '',
  };
}

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'INIT':
    case 'RESET':
      return initialState(action.lang);

    case 'PICK_LANGUAGE':
      return {
        ...state,
        language: action.lang,
        preferred_language: action.lang === 'es' ? 'Spanish' : 'English',
        current_step: 'privacy_acknowledge',
      };

    case 'ACKNOWLEDGE_PRIVACY':
      return {
        ...state,
        privacy_warning_shown: true,
        current_step: 'collecting_full_name',
      };

    case 'ADD_USER_MSG': {
      const detected = detectLanguage(action.text);
      let nextLang = state.language;
      let switches = state.language_switches;
      if (detected !== 'mixed' && detected !== state.language && state.turn_count > 1) {
        nextLang = detected;
        switches++;
      }
      return {
        ...state,
        language: nextLang,
        language_switches: switches,
        turn_count: state.turn_count + 1,
        customer_questions: [...state.customer_questions, action.text],
        messages: [...state.messages, { id: uid(), role: 'user', text: action.text }],
      };
    }

    case 'ADD_BOT_MSG':
      return { ...state, messages: [...state.messages, { id: uid(), role: 'bot', text: action.text }] };

    case 'EMERGENCY_DETECTED':
      return { ...state, emergency_warning_shown: true, current_step: 'emergency_paused', urgency: 'urgent' };

    case 'ACK_EMERGENCY':
      // After emergency, continue from wherever we were (but skip to concern if nothing collected)
      return { ...state, current_step: state.primary_intent ? 'asking_callback_pref' : 'collecting_concern' };

    case 'SENSITIVE_INTERCEPTED':
      return { ...state, sensitive_data_intercepted: true };

    case 'FRUSTRATION_FLAG':
      return { ...state, frustration_detected: true };

    case 'COLLECT_FULL_NAME':
      return { ...state, first_name: action.first, last_name: action.last, current_step: 'collecting_location' };

    case 'COLLECT_LOCATION': {
      // If parser inferred a state, jump straight to concern. Otherwise route
      // through the state-fallback chips so we don't lose location entirely.
      return {
        ...state,
        zip: action.zip,
        state: action.state,
        current_step: action.state ? 'collecting_concern' : 'state_fallback',
      };
    }

    case 'COLLECT_STATE_FALLBACK':
      return { ...state, state: action.value, current_step: 'collecting_concern' };

    case 'SET_INTENT':
      return {
        ...state,
        primary_intent: action.primary,
        secondary_intents: action.secondary,
        confidence: action.confidence,
        urgency: action.urgency,
        requires_agent_review: action.requires_agent_review,
        current_step: 'intent_followup',
      };

    case 'CONCERN_CAPTURED':
      return { ...state, current_step: 'asking_callback_pref' };

    case 'WANTS_CALLBACK':
      return {
        ...state,
        wants_callback: action.value,
        // If they don't want a call, still ask phone for the case file
        // (advisor follow-up may still be required) but frame it gently.
        current_step: 'collecting_phone',
      };

    case 'COLLECT_PHONE':
      return { ...state, phone: action.value.trim(), current_step: 'collecting_best_time' };

    case 'COLLECT_BEST_TIME':
      return { ...state, best_time_to_call: action.value.trim(), current_step: 'consent_review' };

    case 'SET_CONSENT':
      return { ...state, consent_to_contact: action.value };

    case 'SUBMITTING':
      return { ...state, current_step: 'submitting' };

    case 'SUBMIT_OK':
      return { ...state, submitted: true, submission_ref: action.ref, current_step: 'submitted' };

    case 'SUBMIT_FAIL':
      return { ...state, submission_error: action.error, current_step: 'submission_failed' };

    case 'SET_STEP':
      return { ...state, current_step: action.step };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY — short, calm, one-thing-at-a-time
// ─────────────────────────────────────────────────────────────────────────────

const COPY = {
  brand_en: 'Customer Service Box',
  brand_es: 'Caja de Servicio al Cliente',
  tagline_en: 'ClearPoint Support Intake · Bilingual · No cost',
  tagline_es: 'Soporte ClearPoint · Bilingüe · Sin costo',

  // Step 1 — language
  welcome_en: 'Welcome to ClearPoint. Before we begin, would you prefer English or Spanish?',
  welcome_es: 'Bienvenido a ClearPoint. Antes de empezar, ¿prefiere español o inglés?',

  // Step 2 — privacy (short, human, no jargon)
  privacy_en: 'Thank you. I can help organize your Medicare question so a licensed advisor can review it. Please do not send Medicare ID, Social Security numbers, banking information, or private medical records here.',
  privacy_es: 'Gracias. Puedo ayudarle a organizar su pregunta de Medicare para que un asesor licenciado pueda revisarla. Por favor no envíe número de Medicare, Seguro Social, información bancaria ni récords médicos privados por aquí.',
  privacy_continue_en: 'I understand',
  privacy_continue_es: 'Entiendo',

  // Step 3 — name
  ask_name_en: 'To start, what is your full name?',
  ask_name_es: 'Para empezar, ¿cuál es su nombre completo?',

  // Step 4 — location
  ask_location_en: 'Thank you, {first}. What ZIP code or state are you in? This helps us organize your request correctly.',
  ask_location_es: 'Gracias, {first}. ¿Cuál es su ZIP code o estado? Esto nos ayuda a organizar su solicitud correctamente.',

  // Step 4b — fallback if parser couldn't infer the state
  state_fallback_en: 'Just to be sure — which state do you live in?',
  state_fallback_es: 'Solo para confirmar — ¿en qué estado vive?',

  // Step 5 — concern (free text, the key UX shift — no button grid)
  ask_concern_en: 'Now tell me, in your own words, what would you like help with?',
  ask_concern_es: 'Ahora dígame, en sus propias palabras, ¿con qué situación necesita ayuda?',

  // Step 6 — multi-topic ack uses engine.buildMultiTopicAck()
  // Step 7 — intent follow-up uses engine.intentFollowUp()

  // Step 8 — callback preference
  ask_callback_pref_en: "I have what I need to organize this. Would you like a licensed advisor to call you about it?",
  ask_callback_pref_es: 'Tengo lo necesario para organizar esto. ¿Le gustaría que un asesor licenciado le llame al respecto?',
  yes_en: 'Yes, please',
  yes_es: 'Sí, por favor',
  no_en: 'No, just save it',
  no_es: 'No, solo guárdelo',

  // Step 8b — phone (only after callback pref)
  ask_phone_en: 'What is the best phone number for a licensed advisor to contact you?',
  ask_phone_es: '¿Cuál es el mejor número de teléfono para que un asesor licenciado pueda comunicarse con usted?',
  ask_phone_optional_en: 'If you change your mind, what number should we keep on file just in case? (You can type Skip.)',
  ask_phone_optional_es: 'Si cambia de opinión, ¿qué número guardamos por si acaso? (Puede escribir Omitir.)',
  skip_en: 'Skip',
  skip_es: 'Omitir',

  // Step 8c — best time
  ask_best_time_en: 'What is the best time to call?',
  ask_best_time_es: '¿Cuál es el mejor horario para llamarle?',

  // Step 9 — consent
  consent_question_en: 'One last step — do we have your permission to contact you about this request?',
  consent_question_es: 'Un último paso — ¿nos da permiso para contactarle sobre esta solicitud?',
  consent_text_en: 'I agree to be contacted by a licensed ClearPoint advisor at the phone number I provided regarding my Medicare question. Message and data rates may apply.',
  consent_text_es: 'Acepto que un asesor licenciado de ClearPoint me contacte al número de teléfono que proporcioné respecto a mi pregunta de Medicare. Pueden aplicar tarifas de mensajes y datos.',
  consent_yes_en: 'Yes, send my case',
  consent_yes_es: 'Sí, enviar mi caso',

  // Step 10 — submitted / failed
  submitting_en: 'Sending your case to a licensed advisor…',
  submitting_es: 'Enviando su caso a un asesor licenciado…',
  submitted_title_en: 'Got it. A licensed advisor will follow up.',
  submitted_title_es: 'Listo. Un asesor licenciado se comunicará con usted.',
  submitted_body_en: 'A bilingual ClearPoint advisor will review your case and contact you at the phone number you provided.',
  submitted_body_es: 'Un asesor bilingüe de ClearPoint revisará su caso y le contactará al número que proporcionó.',
  failed_title_en: 'Something went wrong sending your case.',
  failed_title_es: 'Algo salió mal al enviar su caso.',
  failed_body_en: 'Please call us directly at 1-866-310-8702 or try again. Your information was not stored.',
  failed_body_es: 'Por favor llámenos directamente al 1-866-310-8702 o intente de nuevo. Su información no se guardó.',
  retry_en: 'Try again',
  retry_es: 'Intentar de nuevo',

  // Emergency
  emergency_title_en: 'This chat is not for medical emergencies',
  emergency_title_es: 'Este chat no es para emergencias médicas',
  emergency_text_en: 'This chat is not for medical emergencies. Please call 911 or seek immediate medical help. When you are safe, you can come back and I will help organize your Medicare question.',
  emergency_text_es: 'Este chat no es para emergencias médicas. Llame al 911 o busque ayuda médica inmediata. Cuando esté a salvo, puede regresar y le ayudaré a organizar su pregunta de Medicare.',
  emergency_ack_en: 'I am safe — continue',
  emergency_ack_es: 'Estoy a salvo — continuar',
  call_911_en: 'Call 911',
  call_911_es: 'Llamar al 911',

  // Sensitive intercept
  sensitive_intercept_en: "It looks like you typed sensitive information (a Medicare ID, Social Security number, card, or banking number). For your safety I'm not saving that — please share those details only with a licensed advisor through a secure channel.",
  sensitive_intercept_es: 'Parece que escribió información sensible (un número de Medicare, Seguro Social, tarjeta o banco). Por su seguridad no lo estoy guardando — comparta esos datos solo con un asesor licenciado a través de un canal seguro.',

  // Reset / chrome
  reset_en: 'Start over',
  reset_es: 'Empezar de nuevo',
  send_en: 'Send',
  send_es: 'Enviar',
  type_here_en: 'Type your message…',
  type_here_es: 'Escriba su mensaje…',
  call_now_en: 'Call now',
  call_now_es: 'Llamar ahora',

  // Summary intro
  summary_intro_en: 'Perfect. I have organized your case. A licensed advisor will review it before discussing plan-specific details with you.',
  summary_intro_es: 'Perfecto. Organicé su caso. Un asesor licenciado lo revisará antes de hablar de detalles específicos de planes con usted.',
};

const STATE_FALLBACK_BUTTONS = [
  { value: 'NY' as const, label_en: 'New York', label_es: 'Nueva York' },
  { value: 'NJ' as const, label_en: 'New Jersey', label_es: 'Nueva Jersey' },
  { value: 'CT' as const, label_en: 'Connecticut', label_es: 'Connecticut' },
  { value: 'FL' as const, label_en: 'Florida', label_es: 'Florida' },
  { value: 'Other' as const, label_en: 'Other state', label_es: 'Otro estado' },
];
const TIME_BUTTONS_EN = ['Morning', 'Afternoon', 'Evening', 'Anytime'];
const TIME_BUTTONS_ES = ['Mañana', 'Tarde', 'Noche', 'Cualquier hora'];

// ─────────────────────────────────────────────────────────────────────────────
// TYPING PACE
// ─────────────────────────────────────────────────────────────────────────────

function getTypingDelay(text: string, pace: Pace = 'short'): number {
  const baseMs = pace === 'slow' ? 800 : pace === 'long' ? 600 : 350;
  const perChar = pace === 'slow' ? 22 : pace === 'long' ? 18 : 14;
  return Math.min(baseMs + text.length * perChar, 2400);
}
function getPostGap(pace: Pace = 'short'): number {
  if (pace === 'slow') return 900 + Math.floor(Math.random() * 400);
  if (pace === 'long') return 700 + Math.floor(Math.random() * 300);
  return 450 + Math.floor(Math.random() * 250);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY = 'clear_point_support_session_memory';

export function CustomerServiceBot() {
  const { lang: pageLang, setLang } = useLanguage();
  const initialLang: SupportLang = pageLang === 'es' ? 'es' : 'en';

  const [state, dispatch] = useReducer(reduce, initialLang, initialState);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const queueRef = useRef<QueuedMsg[]>([]);
  const processingRef = useRef(false);
  const generationRef = useRef(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const userPinnedUpRef = useRef(false);
  const prevMsgLenRef = useRef(0);
  const prevTypingRef = useRef(false);
  const inputFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Persist + scroll lifecycle ────────────────────────────────────────
  useEffect(() => {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  function safeScrollToBottom() {
    const c = bodyRef.current;
    if (!c) return;
    c.scrollTop = c.scrollHeight;
  }
  function handleScroll() {
    const c = bodyRef.current;
    if (!c) return;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    if (dist > 200) userPinnedUpRef.current = true;
    else if (dist < 40) userPinnedUpRef.current = false;
  }
  useEffect(() => {
    const prevLen = prevMsgLenRef.current;
    prevMsgLenRef.current = state.messages.length;
    const grew = state.messages.length > prevLen;
    const wasTyping = prevTypingRef.current;
    prevTypingRef.current = isTyping;
    const typingEdge = isTyping && !wasTyping;
    if (inputFocusedRef.current && !grew) return;
    requestAnimationFrame(() => {
      if (userPinnedUpRef.current) return;
      if (grew || typingEdge) safeScrollToBottom();
    });
  }, [state.messages.length, isTyping]);

  // ── Typing queue ──────────────────────────────────────────────────────
  function sleep(ms: number) { return new Promise<void>((r) => window.setTimeout(r, ms)); }
  async function processQueue(generation: number) {
    if (processingRef.current) return;
    processingRef.current = true;
    while (queueRef.current.length > 0 && generationRef.current === generation) {
      const next = queueRef.current.shift();
      if (!next) break;
      setIsTyping(true);
      await sleep(getTypingDelay(next.text, next.pace));
      if (generationRef.current !== generation) {
        setIsTyping(false);
        processingRef.current = false;
        return;
      }
      setIsTyping(false);
      dispatch({ type: 'ADD_BOT_MSG', text: next.text });
      await sleep(getPostGap(next.pace));
    }
    processingRef.current = false;
  }
  function enqueueBot(msgs: QueuedMsg[], clearExisting = false) {
    if (clearExisting) {
      generationRef.current += 1;
      queueRef.current = [];
      processingRef.current = false;
      setIsTyping(false);
    }
    const generation = generationRef.current;
    queueRef.current.push(...msgs);
    void processQueue(generation);
  }

  // ── Mount: emit the welcome ──────────────────────────────────────────
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    enqueueBot([{ text: initialLang === 'es' ? COPY.welcome_es : COPY.welcome_en, pace: 'long' }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Language pick ───────────────────────────────────────────────────
  function handlePickLanguage(l: SupportLang) {
    setLang(l);
    dispatch({ type: 'ADD_USER_MSG', text: l === 'es' ? 'Español' : 'English' });
    dispatch({ type: 'PICK_LANGUAGE', lang: l });
    enqueueBot([
      { text: l === 'es' ? COPY.privacy_es : COPY.privacy_en, pace: 'long' },
    ]);
  }

  function handleAcknowledgePrivacy() {
    dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
    enqueueBot([{ text: state.language === 'es' ? COPY.ask_name_es : COPY.ask_name_en, pace: 'short' }]);
  }

  // ── Free-text user submit  (this is the single entry point for typed input) ──
  function handleUserSubmit() {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    // 1. Emergency — never store; pause immediately.
    if (detectEmergency(text)) {
      dispatch({ type: 'ADD_USER_MSG', text });
      dispatch({ type: 'EMERGENCY_DETECTED' });
      enqueueBot([{ text: state.language === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en, pace: 'slow' }]);
      return;
    }

    // 2. Sensitive — never store the raw text.
    if (detectSensitive(text).isSensitive) {
      dispatch({ type: 'SENSITIVE_INTERCEPTED' });
      enqueueBot([{ text: state.language === 'es' ? COPY.sensitive_intercept_es : COPY.sensitive_intercept_en, pace: 'long' }]);
      return;
    }

    // 3. Frustration — acknowledge first, then re-prompt the same step.
    if (detectFrustration(text)) {
      dispatch({ type: 'FRUSTRATION_FLAG' });
      dispatch({ type: 'ADD_USER_MSG', text });
      enqueueBot([{ text: frustrationAck(state.language), pace: 'long' }]);
      const reprompt = state.language === 'es' ? rePromptES(state.current_step) : rePromptEN(state.current_step);
      if (reprompt) enqueueBot([{ text: reprompt, pace: 'short' }]);
      return;
    }

    // 4. Normal flow — branch by current step.
    dispatch({ type: 'ADD_USER_MSG', text });

    switch (state.current_step) {
      case 'collecting_full_name': {
        const { firstName, lastName } = splitFullName(text);
        dispatch({ type: 'COLLECT_FULL_NAME', first: firstName, last: lastName });
        const lang = state.language;
        const askLoc = (lang === 'es' ? COPY.ask_location_es : COPY.ask_location_en)
          .replace('{first}', firstName || (lang === 'es' ? 'gracias' : 'thanks'));
        enqueueBot([{ text: askLoc, pace: 'short' }]);
        return;
      }

      case 'collecting_location': {
        const parsed = parseZipOrState(text);
        dispatch({ type: 'COLLECT_LOCATION', zip: parsed.zip, state: parsed.state });
        const lang = state.language;
        if (parsed.state) {
          // Proceed directly to concern.
          enqueueBot([{ text: lang === 'es' ? COPY.ask_concern_es : COPY.ask_concern_en, pace: 'short' }]);
        } else {
          // Couldn't infer state — show fallback chips.
          enqueueBot([{ text: lang === 'es' ? COPY.state_fallback_es : COPY.state_fallback_en, pace: 'short' }]);
        }
        return;
      }

      case 'state_fallback':
        // Typed-text path is unlikely here (we expect chip click), but accept it.
        // Try parsing the text again for a state name match.
        {
          const parsed = parseZipOrState(text);
          if (parsed.state) {
            dispatch({ type: 'COLLECT_STATE_FALLBACK', value: parsed.state });
          } else {
            dispatch({ type: 'COLLECT_STATE_FALLBACK', value: 'Other' });
          }
          enqueueBot([{ text: state.language === 'es' ? COPY.ask_concern_es : COPY.ask_concern_en, pace: 'short' }]);
        }
        return;

      case 'collecting_concern': {
        const result = classifyIntent(text, state.language);
        const primaryDef = getIntentDef(result.primary);
        let urgency: IntentUrgency = primaryDef.default_urgency;
        let needsReview = primaryDef.escalate_to_agent;
        for (const sid of result.secondary) {
          const s = getIntentDef(sid);
          if (s.default_urgency === 'urgent') urgency = 'urgent';
          else if (s.default_urgency === 'high' && urgency !== 'urgent') urgency = 'high';
          if (s.escalate_to_agent) needsReview = true;
        }
        dispatch({
          type: 'SET_INTENT',
          primary: result.primary,
          secondary: result.secondary,
          confidence: result.confidence,
          urgency,
          requires_agent_review: needsReview,
        });

        const msgs: QueuedMsg[] = [];
        if (result.secondary.length > 0) {
          msgs.push({ text: buildMultiTopicAck(result.primary, result.secondary, state.language), pace: 'long' });
        }
        msgs.push({ text: intentFollowUp(result.primary, state.language), pace: 'long' });
        enqueueBot(msgs);
        return;
      }

      case 'intent_followup': {
        // We have enough to organize the case. Bridge to callback preference.
        dispatch({ type: 'CONCERN_CAPTURED' });
        enqueueBot([{ text: state.language === 'es' ? COPY.ask_callback_pref_es : COPY.ask_callback_pref_en, pace: 'short' }]);
        return;
      }

      case 'collecting_phone': {
        if (/^skip$|^omitir$/i.test(text.trim())) {
          dispatch({ type: 'COLLECT_PHONE', value: '' });
        } else {
          dispatch({ type: 'COLLECT_PHONE', value: text });
        }
        enqueueBot([{ text: state.language === 'es' ? COPY.ask_best_time_es : COPY.ask_best_time_en, pace: 'short' }]);
        return;
      }

      case 'collecting_best_time': {
        dispatch({ type: 'COLLECT_BEST_TIME', value: text });
        enqueueBot([{ text: state.language === 'es' ? COPY.consent_question_es : COPY.consent_question_en, pace: 'short' }]);
        return;
      }
    }
  }

  // ── Chip handlers ────────────────────────────────────────────────────
  function handleStateFallback(value: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other') {
    const label = STATE_FALLBACK_BUTTONS.find((b) => b.value === value);
    dispatch({ type: 'ADD_USER_MSG', text: state.language === 'es' ? (label?.label_es || value) : (label?.label_en || value) });
    dispatch({ type: 'COLLECT_STATE_FALLBACK', value });
    enqueueBot([{ text: state.language === 'es' ? COPY.ask_concern_es : COPY.ask_concern_en, pace: 'short' }]);
  }

  function handleCallbackPref(wantsCall: boolean) {
    const lang = state.language;
    dispatch({ type: 'ADD_USER_MSG', text: wantsCall ? (lang === 'es' ? COPY.yes_es : COPY.yes_en) : (lang === 'es' ? COPY.no_es : COPY.no_en) });
    dispatch({ type: 'WANTS_CALLBACK', value: wantsCall });
    if (wantsCall) {
      enqueueBot([{ text: lang === 'es' ? COPY.ask_phone_es : COPY.ask_phone_en, pace: 'short' }]);
    } else {
      enqueueBot([{ text: lang === 'es' ? COPY.ask_phone_optional_es : COPY.ask_phone_optional_en, pace: 'short' }]);
    }
  }

  function handleTimeChip(label: string) {
    dispatch({ type: 'ADD_USER_MSG', text: label });
    dispatch({ type: 'COLLECT_BEST_TIME', value: label });
    enqueueBot([{ text: state.language === 'es' ? COPY.consent_question_es : COPY.consent_question_en, pace: 'short' }]);
  }

  function handleAcknowledgeEmergency() {
    dispatch({ type: 'ACK_EMERGENCY' });
    enqueueBot([{ text: state.language === 'es' ? COPY.ask_concern_es : COPY.ask_concern_en, pace: 'short' }]);
  }

  async function handleSubmit() {
    if (!state.consent_to_contact) return;
    dispatch({ type: 'SUBMITTING' });
    const caseState: CaseState = {
      session_id: state.session_id,
      started_at: state.started_at,
      language: state.language,
      preferred_language: state.preferred_language,
      language_switches: state.language_switches,
      primary_intent: state.primary_intent,
      secondary_intents: state.secondary_intents,
      urgency: state.urgency,
      requires_agent_review: state.requires_agent_review,
      privacy_warning_shown: state.privacy_warning_shown,
      sensitive_data_intercepted: state.sensitive_data_intercepted,
      emergency_warning_shown: state.emergency_warning_shown,
      frustration_detected: state.frustration_detected,
      consent_to_contact: state.consent_to_contact,
      first_name: state.first_name,
      phone: state.phone,
      state: state.state,
      zip: state.zip,
      best_time_to_call: state.best_time_to_call,
      customer_questions: state.customer_questions,
    };
    const payload = {
      source: 'customer_service_bot',
      page_url: typeof window !== 'undefined' ? window.location.href : '',
      form_name: 'Customer Service Box',
      first_name: state.first_name,
      last_name: state.last_name,
      full_name: `${state.first_name} ${state.last_name}`.trim(),
      phone: state.phone,
      email: '',
      zip_code: state.zip,
      preferred_language: state.preferred_language || (state.language === 'es' ? 'Spanish' : 'English'),
      medicare_status: '',
      interest_type: state.primary_intent || '',
      best_time_to_contact: state.best_time_to_call,
      consent_to_contact: state.consent_to_contact,
      consent_text: state.language === 'es' ? COPY.consent_text_es : COPY.consent_text_en,
      lead_notes: buildCaseSummary(caseState),
      bot_transcript_summary: `Customer Service Box · Primary: ${state.primary_intent} · Secondary: ${state.secondary_intents.join(', ') || 'none'} · Urgency: ${state.urgency}${state.wants_callback ? ' · Caller requested call' : ''}${state.frustration_detected ? ' · Frustration acknowledged' : ''}`,
      tags: buildSupportTags(caseState),
      created_at: new Date().toISOString(),
      derived_state: state.state || '',
      website_url: '',
    };
    try {
      const ok = await submitLeadToGHL(payload as any);
      if (ok) dispatch({ type: 'SUBMIT_OK', ref: state.session_id.slice(0, 6).toUpperCase() });
      else dispatch({ type: 'SUBMIT_FAIL', error: 'Server returned an error.' });
    } catch (e: any) {
      dispatch({ type: 'SUBMIT_FAIL', error: e?.message || 'Network error.' });
    }
  }

  function handleReset() {
    generationRef.current += 1;
    queueRef.current = [];
    processingRef.current = false;
    setIsTyping(false);
    setInputText('');
    const currentLang: SupportLang = pageLang === 'es' ? 'es' : 'en';
    dispatch({ type: 'RESET', lang: currentLang });
    window.setTimeout(() => {
      enqueueBot([{ text: currentLang === 'es' ? COPY.welcome_es : COPY.welcome_en, pace: 'long' }], true);
    }, 100);
  }

  const inputEnabled =
    state.current_step === 'collecting_full_name' ||
    state.current_step === 'collecting_location' ||
    state.current_step === 'state_fallback' ||
    state.current_step === 'collecting_concern' ||
    state.current_step === 'intent_followup' ||
    state.current_step === 'collecting_phone' ||
    state.current_step === 'collecting_best_time';

  // ────────────────────────────────────────────────────────────────────
  // RENDER
  // ────────────────────────────────────────────────────────────────────

  const lang = state.language;

  return (
    <div className="bg-cream-50 rounded-2xl shadow-lifted border border-cream-200 max-w-3xl mx-auto overflow-hidden flex flex-col">
      {/* Header */}
      <header className="bg-earth-800 text-cream-50 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-sage-300 flex items-center justify-center text-earth-900 flex-shrink-0" aria-hidden="true">
            <Headphones className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">{lang === 'es' ? COPY.brand_es : COPY.brand_en}</div>
            <div className="text-[11px] text-cream-200 font-normal">{lang === 'es' ? COPY.tagline_es : COPY.tagline_en}</div>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors"
          aria-label={lang === 'es' ? COPY.reset_es : COPY.reset_en}
          title={lang === 'es' ? COPY.reset_es : COPY.reset_en}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </header>

      {/* Body */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain min-h-0 max-h-[62vh] md:max-h-[640px]"
      >
        <div className="px-3 py-3 space-y-3">
          {state.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-xl px-4 py-3 text-[14px] leading-[1.55] ${
                  m.role === 'user'
                    ? 'bg-earth-800 text-cream-50 rounded-br-sm'
                    : 'bg-white text-earth-800 shadow-sm border border-cream-200 rounded-bl-sm'
                }`}
              >
                <div className="whitespace-pre-line">{m.text}</div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-cream-200">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-earth-500 italic">
                    {lang === 'es' ? 'Escribiendo…' : 'Typing…'}
                  </span>
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Step-specific action panels ────────────────────────────── */}
          {state.current_step === 'language_pick' && !isTyping && (
            <ActionRow>
              <ActionButton onClick={() => handlePickLanguage('en')}>English</ActionButton>
              <ActionButton onClick={() => handlePickLanguage('es')}>Español</ActionButton>
            </ActionRow>
          )}

          {state.current_step === 'privacy_acknowledge' && !isTyping && (
            <ActionRow>
              <ActionButton onClick={handleAcknowledgePrivacy}>
                {lang === 'es' ? COPY.privacy_continue_es : COPY.privacy_continue_en}
              </ActionButton>
            </ActionRow>
          )}

          {state.current_step === 'state_fallback' && !isTyping && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {STATE_FALLBACK_BUTTONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => handleStateFallback(s.value)}
                  className="px-3 py-3 bg-cream-50 border border-cream-200 text-earth-800 rounded-lg text-[14px] font-medium min-h-[48px] hover:bg-gold-100 hover:border-gold-300 transition-colors"
                >
                  {lang === 'es' ? s.label_es : s.label_en}
                </button>
              ))}
            </div>
          )}

          {state.current_step === 'asking_callback_pref' && !isTyping && (
            <ActionRow>
              <ActionButton onClick={() => handleCallbackPref(true)} variant="primary">
                {lang === 'es' ? COPY.yes_es : COPY.yes_en}
              </ActionButton>
              <ActionButton onClick={() => handleCallbackPref(false)} variant="ghost">
                {lang === 'es' ? COPY.no_es : COPY.no_en}
              </ActionButton>
            </ActionRow>
          )}

          {state.current_step === 'collecting_best_time' && !isTyping && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {(lang === 'es' ? TIME_BUTTONS_ES : TIME_BUTTONS_EN).map((label) => (
                <button
                  key={label}
                  onClick={() => handleTimeChip(label)}
                  className="px-3 py-3 bg-cream-50 border border-cream-200 text-earth-800 rounded-lg text-[14px] font-medium min-h-[48px] hover:bg-gold-100 hover:border-gold-300 transition-colors"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {state.current_step === 'consent_review' && (
            <ConsentReview
              s={state}
              lang={lang}
              onToggleConsent={(v) => dispatch({ type: 'SET_CONSENT', value: v })}
              onSubmit={handleSubmit}
            />
          )}

          {state.current_step === 'submitting' && (
            <div className="bg-sage-100 border border-sage-300 rounded-xl p-5 text-earth-800 text-[14px]">
              {lang === 'es' ? COPY.submitting_es : COPY.submitting_en}
            </div>
          )}

          {state.current_step === 'submitted' && (
            <div className="bg-sage-100 border border-sage-300 rounded-xl p-5 space-y-2">
              <div className="font-bold text-earth-900">{lang === 'es' ? '✓ ' + COPY.submitted_title_es : '✓ ' + COPY.submitted_title_en}</div>
              <p className="text-earth-700 text-[14px] leading-relaxed">{lang === 'es' ? COPY.submitted_body_es : COPY.submitted_body_en}</p>
              <p className="text-earth-500 text-xs">Ref: {state.submission_ref}</p>
              <div className="pt-1">
                <ActionButton onClick={handleReset} variant="primary">{lang === 'es' ? COPY.reset_es : COPY.reset_en}</ActionButton>
              </div>
            </div>
          )}

          {state.current_step === 'submission_failed' && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-5 space-y-3">
              <div className="font-bold text-red-900">{lang === 'es' ? COPY.failed_title_es : COPY.failed_title_en}</div>
              <p className="text-red-900 text-[14px] leading-relaxed">{lang === 'es' ? COPY.failed_body_es : COPY.failed_body_en}</p>
              <div className="flex flex-wrap gap-2">
                <a href="tel:18663108702" className="inline-flex items-center gap-1.5 px-4 py-3 bg-earth-800 text-cream-50 rounded-lg text-[14px] font-semibold min-h-[44px]">
                  <Phone className="w-4 h-4" />
                  1-866-310-8702
                </a>
                <button onClick={handleSubmit} className="inline-flex items-center px-4 py-3 bg-white border border-red-300 text-red-900 rounded-lg text-[14px] font-semibold min-h-[44px]">
                  {lang === 'es' ? COPY.retry_es : COPY.retry_en}
                </button>
              </div>
            </div>
          )}

          {state.current_step === 'emergency_paused' && (
            <div className="bg-red-50 border-2 border-red-400 rounded-xl p-5 space-y-3">
              <div className="font-bold text-red-900 text-[15px]">{lang === 'es' ? COPY.emergency_title_es : COPY.emergency_title_en}</div>
              <p className="text-red-900 text-[14px] leading-relaxed">{lang === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en}</p>
              <div className="flex flex-wrap gap-2">
                <a href="tel:911" className="inline-flex items-center gap-1.5 px-4 py-3 bg-red-600 text-white rounded-lg text-[14px] font-bold min-h-[44px]">
                  <Phone className="w-4 h-4" />
                  {lang === 'es' ? COPY.call_911_es : COPY.call_911_en}
                </a>
                <button onClick={handleAcknowledgeEmergency} className="inline-flex items-center px-4 py-3 bg-white border border-red-400 text-red-900 rounded-lg text-[14px] font-semibold min-h-[44px]">
                  {lang === 'es' ? COPY.emergency_ack_es : COPY.emergency_ack_en}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer chrome */}
      <div className="px-3 py-2 border-t border-cream-200 flex-shrink-0 flex items-center gap-2 bg-white">
        <a
          href="tel:18663108702"
          className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors"
        >
          <Phone className="w-4 h-4" />
          {lang === 'es' ? COPY.call_now_es : COPY.call_now_en}
        </a>
        <span className="text-earth-300 select-none" aria-hidden="true">·</span>
        <span className="text-[12px] text-earth-500 inline-flex items-center gap-1">
          <MessageCircle className="w-3.5 h-3.5" />
          {lang === 'es' ? 'Soporte bilingüe' : 'Bilingual support'}
        </span>
      </div>

      {/* Input row — always rendered, disabled outside text-entry steps */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleUserSubmit(); }}
        className="px-3 pb-3 pt-2 border-t border-cream-200 flex-shrink-0 bg-white"
      >
        <div className="flex gap-2 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onFocus={() => { inputFocusedRef.current = true; }}
            onBlur={() => { inputFocusedRef.current = false; }}
            disabled={!inputEnabled || isTyping}
            placeholder={lang === 'es' ? COPY.type_here_es : COPY.type_here_en}
            className="flex-1 min-w-0 px-4 py-3 bg-white border border-cream-300 rounded-lg text-base text-earth-900 placeholder:text-earth-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 min-h-[48px] disabled:bg-cream-50 disabled:text-earth-400 disabled:placeholder:text-earth-300"
            aria-label={lang === 'es' ? COPY.type_here_es : COPY.type_here_en}
          />
          <button
            type="submit"
            disabled={!inputEnabled || isTyping || !inputText.trim()}
            className="px-4 py-3 bg-earth-800 text-cream-50 rounded-lg hover:bg-earth-900 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={lang === 'es' ? COPY.send_es : COPY.send_en}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Local copy of getIntent — engine doesn't re-export it, and we want to keep
// the dependency surface tight.
import { getIntent as _getIntent } from '../data/customerServiceIntents';
function getIntentDef(id: IntentId) { return _getIntent(id); }

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>;
}
function ActionButton({
  onClick,
  variant = 'primary',
  children,
}: {
  onClick: () => void;
  variant?: 'primary' | 'ghost';
  children: React.ReactNode;
}) {
  const base = 'px-5 py-3 rounded-lg text-[14px] font-semibold min-h-[48px] transition-colors';
  const styles =
    variant === 'ghost'
      ? 'bg-cream-100 border border-cream-300 text-earth-800 hover:bg-cream-200'
      : 'bg-earth-800 text-cream-50 hover:bg-earth-900';
  return <button onClick={onClick} className={`${base} ${styles}`}>{children}</button>;
}

function ConsentReview({
  s,
  lang,
  onToggleConsent,
  onSubmit,
}: {
  s: State;
  lang: SupportLang;
  onToggleConsent: (v: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="bg-white border border-earth-300 rounded-xl p-5 space-y-3">
      <p className="text-[14px] text-earth-800 leading-relaxed">
        {lang === 'es' ? COPY.summary_intro_es : COPY.summary_intro_en}
      </p>
      <dl className="space-y-1.5 text-[14px] bg-cream-50 border border-cream-200 rounded-lg p-3">
        <Row label_en="Name" label_es="Nombre" value={`${s.first_name} ${s.last_name}`.trim()} lang={lang} />
        <Row label_en="ZIP / State" label_es="ZIP / Estado" value={[s.zip, s.state].filter(Boolean).join(' · ') || '—'} lang={lang} />
        <Row label_en="Main topic" label_es="Tema principal" value={s.primary_intent || '—'} lang={lang} />
        {s.secondary_intents.length > 0 && (
          <Row label_en="Other topics" label_es="Otros temas" value={s.secondary_intents.join(', ')} lang={lang} />
        )}
        <Row label_en="Urgency" label_es="Urgencia" value={s.urgency} lang={lang} />
        <Row label_en="Wants callback" label_es="Quiere llamada" value={s.wants_callback ? (lang === 'es' ? 'Sí' : 'Yes') : (lang === 'es' ? 'No' : 'No')} lang={lang} />
        {s.phone && <Row label_en="Phone" label_es="Teléfono" value={s.phone} lang={lang} />}
        {s.best_time_to_call && <Row label_en="Best time" label_es="Mejor hora" value={s.best_time_to_call} lang={lang} />}
      </dl>

      <p className="text-[12px] text-earth-600 leading-relaxed">
        {advisorHandoffLine(lang)}
      </p>

      <p className="text-[14px] text-earth-800">
        {lang === 'es' ? COPY.consent_question_es : COPY.consent_question_en}
      </p>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={s.consent_to_contact}
          onChange={(e) => onToggleConsent(e.target.checked)}
          className="mt-1 w-4 h-4 cursor-pointer"
        />
        <span className="text-[12px] text-earth-700 leading-relaxed">
          {lang === 'es' ? COPY.consent_text_es : COPY.consent_text_en}
        </span>
      </label>

      <button
        onClick={onSubmit}
        disabled={!s.consent_to_contact}
        className="w-full sm:w-auto px-5 py-3 bg-earth-800 text-cream-50 rounded-lg text-[14px] font-semibold hover:bg-earth-900 disabled:opacity-40 disabled:cursor-not-allowed min-h-[48px]"
      >
        {lang === 'es' ? COPY.consent_yes_es : COPY.consent_yes_en}
      </button>
    </div>
  );
}

function Row({ label_en, label_es, value, lang }: { label_en: string; label_es: string; value: string; lang: SupportLang }) {
  return (
    <div>
      <dt className="font-semibold text-earth-800 inline">{lang === 'es' ? label_es : label_en}: </dt>
      <dd className="inline text-earth-700">{value}</dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Frustration re-prompts (one per text-entry step)
// ─────────────────────────────────────────────────────────────────────────────

function rePromptEN(step: Step): string {
  switch (step) {
    case 'collecting_full_name': return 'No rush — what is your full name?';
    case 'collecting_location': return 'No rush — what is your ZIP code or the state you live in?';
    case 'state_fallback': return 'Which state do you live in?';
    case 'collecting_concern': return 'In your own words — what would you like help with today?';
    case 'intent_followup': return "Take your time. Whichever option fits best, just type it.";
    case 'collecting_phone': return 'No rush — what phone number should we save for the advisor?';
    case 'collecting_best_time': return 'What time of day works best for a callback?';
    default: return '';
  }
}
function rePromptES(step: Step): string {
  switch (step) {
    case 'collecting_full_name': return 'Sin prisa — ¿cuál es su nombre completo?';
    case 'collecting_location': return 'Sin prisa — ¿cuál es su ZIP code o el estado donde vive?';
    case 'state_fallback': return '¿En qué estado vive?';
    case 'collecting_concern': return 'En sus propias palabras — ¿con qué le gustaría ayuda hoy?';
    case 'intent_followup': return 'Tome su tiempo. Cualquiera de las opciones que mejor le quede, solo escríbala.';
    case 'collecting_phone': return 'Sin prisa — ¿qué número de teléfono guardamos para el asesor?';
    case 'collecting_best_time': return '¿A qué hora del día le viene mejor recibir una llamada?';
    default: return '';
  }
}

// Exports for QA harness
export { COPY };

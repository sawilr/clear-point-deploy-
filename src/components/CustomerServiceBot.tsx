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
  detectCaregiver,
  detectEmergency,
  detectExplicitLanguagePick,
  detectFrustration,
  detectGlobalIntent,
  detectLanguage,
  detectSensitive,
  detectUpcomingProcedure,
  detectVisitorType,
  validatePhone,
  buildCaseSummary,
  buildMultiTopicAck,
  buildSupportTags,
  frustrationAck,
  advisorHandoffLine,
  intentFollowUp,
  intentFollowUpChips,
  parseZipOrState,
  QUICK_ACTIONS,
  reflectBack,
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
  caregiver_signal: boolean;
  visitor_type: 'senior' | 'caregiver' | 'existing_client' | 'unknown';
  mentioned_upcoming_procedure: boolean;
  mentioned_doctor_concern: boolean;
  mentioned_medication_concern: boolean;
  followup_chips_dismissed: boolean;
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
  | { type: 'CAREGIVER_FLAG' }
  | { type: 'SET_VISITOR_TYPE'; value: 'senior' | 'caregiver' | 'existing_client' | 'unknown' }
  | { type: 'PROCEDURE_MENTIONED' }
  | { type: 'DOCTOR_CONCERN_MENTIONED' }
  | { type: 'MEDICATION_CONCERN_MENTIONED' }
  | { type: 'DISMISS_FOLLOWUP_CHIPS' }
  | { type: 'COLLECT_FULL_NAME'; first: string; last: string }
  | { type: 'COLLECT_LOCATION'; zip: string; state: State['state'] }
  | { type: 'COLLECT_STATE_FALLBACK'; value: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' }
  // SET_INTENT_SIDE_CHANNEL: classifier picked up an intent while the user was
  // answering a different field (name or location). We record it but DO NOT
  // jump steps — the field collection continues until we have name + location.
  | { type: 'SET_INTENT_SIDE_CHANNEL'; primary: IntentId; secondary: IntentId[]; confidence: 'high' | 'medium' | 'low'; requires_agent_review: boolean; urgency: IntentUrgency }
  | { type: 'SET_INTENT'; primary: IntentId; secondary: IntentId[]; confidence: 'high' | 'medium' | 'low'; requires_agent_review: boolean; urgency: IntentUrgency }
  | { type: 'CONCERN_CAPTURED' }
  | { type: 'WANTS_CALLBACK'; value: boolean }
  | { type: 'JUMP_TO_CALLBACK_PREF' }
  | { type: 'SWITCH_LANGUAGE'; lang: SupportLang }
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
    caregiver_signal: false,
    visitor_type: 'unknown',
    mentioned_upcoming_procedure: false,
    mentioned_doctor_concern: false,
    mentioned_medication_concern: false,
    followup_chips_dismissed: false,
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
      // Wave 9: skip explicit privacy_acknowledge step. The persistent privacy
      // band at the top of the scroll body counts as disclosure.
      return {
        ...state,
        language: action.lang,
        preferred_language: action.lang === 'es' ? 'Spanish' : 'English',
        privacy_warning_shown: true,
        current_step: 'collecting_full_name',
      };

    case 'ACKNOWLEDGE_PRIVACY':
      // Legacy action kept for backward compatibility but unused in Wave 9.
      return {
        ...state,
        privacy_warning_shown: true,
        current_step: 'collecting_full_name',
      };

    case 'ADD_USER_MSG': {
      const detected = detectLanguage(action.text);
      let nextLang = state.language;
      let switches = state.language_switches;
      // Implicit mid-conversation switch: starting from the user's SECOND
      // message (after the explicit language pick). We require ≥1 prior
      // user turn so a single stopword on the first message doesn't override
      // the explicit pick.
      if (detected !== 'mixed' && detected !== state.language && state.turn_count >= 1) {
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

    case 'CAREGIVER_FLAG':
      return { ...state, caregiver_signal: true, visitor_type: state.visitor_type === 'unknown' ? 'caregiver' : state.visitor_type };

    case 'SET_VISITOR_TYPE':
      // Don't downgrade existing_client (it's the highest-priority classification).
      if (state.visitor_type === 'existing_client') return state;
      return { ...state, visitor_type: action.value };

    case 'PROCEDURE_MENTIONED':
      return { ...state, mentioned_upcoming_procedure: true };

    case 'DOCTOR_CONCERN_MENTIONED':
      return { ...state, mentioned_doctor_concern: true };

    case 'MEDICATION_CONCERN_MENTIONED':
      return { ...state, mentioned_medication_concern: true };

    case 'DISMISS_FOLLOWUP_CHIPS':
      return { ...state, followup_chips_dismissed: true };

    case 'COLLECT_FULL_NAME':
      return { ...state, first_name: action.first, last_name: action.last, current_step: 'collecting_location' };

    case 'COLLECT_LOCATION': {
      // Step-routing depends on what we already know:
      //   - No state inferred → state_fallback chips so we don't lose location.
      //   - State inferred + intent ALREADY captured side-channel → jump
      //     straight to intent_followup. Don't make the user repeat themselves.
      //   - State inferred + no intent yet → ask the concern in their own words.
      let nextStep: Step;
      if (!action.state) nextStep = 'state_fallback';
      else if (state.primary_intent) nextStep = 'intent_followup';
      else nextStep = 'collecting_concern';
      return {
        ...state,
        zip: action.zip,
        state: action.state,
        current_step: nextStep,
      };
    }

    case 'COLLECT_STATE_FALLBACK':
      return {
        ...state,
        state: action.value,
        current_step: state.primary_intent ? 'intent_followup' : 'collecting_concern',
      };

    case 'SET_INTENT_SIDE_CHANNEL':
      // The caller volunteered concern info while answering a different field.
      // Record the classification but DO NOT change current_step — the field
      // collection (name / location) continues to completion.
      return {
        ...state,
        primary_intent: action.primary,
        secondary_intents: action.secondary,
        confidence: action.confidence,
        urgency: action.urgency,
        requires_agent_review: action.requires_agent_review,
      };

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

    case 'JUMP_TO_CALLBACK_PREF':
      // User pressed "talk to a person" mid-flow. Skip ahead.
      return { ...state, current_step: 'asking_callback_pref' };

    case 'SWITCH_LANGUAGE':
      // Mid-conversation language switch (silent — bot just continues in the
      // new language). Increments the counter for the bilingual GHL tag.
      if (action.lang === state.language) return state;
      return {
        ...state,
        language: action.lang,
        language_switches: state.language_switches + 1,
        preferred_language: action.lang === 'es' ? 'Spanish' : 'English',
      };

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
  brand_en: 'ClearPoint Support Guide',
  brand_es: 'Guía de Soporte ClearPoint',
  tagline_en: 'Bilingual · Senior-friendly · No cost',
  tagline_es: 'Bilingüe · Para personas mayores · Sin costo',

  // Wave 9 — single conversational opener. NO menu wall. The privacy notice
  // lives in the persistent gold band at the top of the scroll body.
  welcome_en: "Hi, I'm the ClearPoint Support Guide. Tell me what's going on with your Medicare question, plan, doctor, medication, cost, letter, or benefits. I'll help organize it clearly and let you know when a licensed advisor should review it.",
  welcome_es: 'Hola, soy la Guía de Soporte de ClearPoint. Dígame qué está pasando con su pregunta de Medicare, plan, doctor, medicamento, costo, carta o beneficios. Le ayudaré a organizarlo claramente y le diré cuándo un asesor licenciado debe revisarlo.',

  // Kept for backward compatibility with the global-intent CHANGE_LANGUAGE re-prompt path.
  privacy_en: "Hi, I'm the ClearPoint Support Guide. Tell me what's going on and I'll help organize it.",
  privacy_es: 'Hola, soy la Guía de Soporte de ClearPoint. Dígame qué está pasando y le ayudaré a organizarlo.',
  privacy_continue_en: 'Continue',
  privacy_continue_es: 'Continuar',

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
  const prevTypingFalseEdgeRef = useRef(false);
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

  // ── Wave 9 desktop input refocus ───────────────────────────────────
  // After the bot finishes typing (isTyping flips true → false), the input
  // is re-focused on desktop so the caller can keep typing without clicking.
  // Skipped on touch devices (window.matchMedia '(pointer: coarse)') because
  // forcing focus there pops the mobile keyboard unexpectedly.
  useEffect(() => {
    const wasTyping = prevTypingFalseEdgeRef.current;
    prevTypingFalseEdgeRef.current = isTyping;
    if (wasTyping && !isTyping) {
      // Edge: typing just ended.
      if (typeof window === 'undefined') return;
      const isTouch = window.matchMedia?.('(pointer: coarse)')?.matches;
      const allowedSteps =
        state.current_step !== 'submitting' &&
        state.current_step !== 'submitted' &&
        state.current_step !== 'submission_failed' &&
        state.current_step !== 'emergency_paused';
      if (!isTouch && allowedSteps) {
        // Defer one frame so the DOM has flushed any structural changes.
        requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      }
    }
  }, [isTyping, state.current_step]);

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

  // Wave 9: handleAcknowledgePrivacy removed — the privacy_acknowledge step
  // no longer has its own UI. The persistent gold band in the scroll body is
  // the disclosure surface. The PICK_LANGUAGE reducer now jumps straight to
  // collecting_full_name.

  // ── Helper: compute intent classification + aggregated urgency/escalation ──
  function classifyWithAggregation(text: string, lang: SupportLang) {
    const result = classifyIntent(text, lang);
    const primaryDef = getIntentDef(result.primary);
    let urgency: IntentUrgency = primaryDef.default_urgency;
    let needsReview = primaryDef.escalate_to_agent;
    for (const sid of result.secondary) {
      const s = getIntentDef(sid);
      if (s.default_urgency === 'urgent') urgency = 'urgent';
      else if (s.default_urgency === 'high' && urgency !== 'urgent') urgency = 'high';
      if (s.escalate_to_agent) needsReview = true;
    }
    return { ...result, urgency, requires_agent_review: needsReview };
  }

  // ── Free-text user submit  (single entry point for typed input) ──
  //
  // Wrapped in try/catch (Phase 16). If ANY classifier, detector, or dispatch
  // call throws, we fall back to a friendly message in the user's language
  // and re-enable typing so the bot is never stuck in a frozen state.
  function handleUserSubmit() {
    try {
      handleUserSubmitInner();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Customer Service Box — handleUserSubmit failed:', err);
      // Cancel any in-flight typing queue.
      generationRef.current += 1;
      queueRef.current = [];
      processingRef.current = false;
      setIsTyping(false);
      enqueueBot([{
        text: state.language === 'es'
          ? 'Algo salió mal, pero sigo aquí. Intente de nuevo o presione "Hablar con un asesor".'
          : "Something went wrong, but I'm still here. Please try again or choose \"Speak with an advisor\".",
        pace: 'short',
      }]);
    }
  }

  function handleUserSubmitInner() {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    // 1. EMERGENCY — highest priority. Never store, pause immediately.
    if (detectEmergency(text)) {
      dispatch({ type: 'ADD_USER_MSG', text });
      dispatch({ type: 'EMERGENCY_DETECTED' });
      enqueueBot([{ text: state.language === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en, pace: 'slow' }]);
      return;
    }

    // 2. SENSITIVE — never store the raw text.
    if (detectSensitive(text).isSensitive) {
      dispatch({ type: 'SENSITIVE_INTERCEPTED' });
      enqueueBot([{ text: state.language === 'es' ? COPY.sensitive_intercept_es : COPY.sensitive_intercept_en, pace: 'long' }]);
      return;
    }

    // 3. GLOBAL INTENT — restart, language switch, "talk to a person", stop.
    //    These short-circuit normal field collection.
    const gi = detectGlobalIntent(text);
    if (gi === 'RESTART') {
      dispatch({ type: 'ADD_USER_MSG', text });
      handleReset();
      return;
    }
    if (gi === 'CHANGE_LANGUAGE_EN' && state.language !== 'en') {
      dispatch({ type: 'ADD_USER_MSG', text });
      setLang('en');
      dispatch({ type: 'SWITCH_LANGUAGE', lang: 'en' });
      enqueueBot([{ text: rePromptEN(state.current_step) || COPY.ask_concern_en, pace: 'short' }]);
      return;
    }
    if (gi === 'CHANGE_LANGUAGE_ES' && state.language !== 'es') {
      dispatch({ type: 'ADD_USER_MSG', text });
      setLang('es');
      dispatch({ type: 'SWITCH_LANGUAGE', lang: 'es' });
      enqueueBot([{ text: rePromptES(state.current_step) || COPY.ask_concern_es, pace: 'short' }]);
      return;
    }
    if (gi === 'TALK_TO_HUMAN') {
      dispatch({ type: 'ADD_USER_MSG', text });
      dispatch({ type: 'JUMP_TO_CALLBACK_PREF' });
      // If we don't have an intent yet, default to call_requested so the
      // advisor knows the caller asked for a person.
      if (!state.primary_intent) {
        const r = classifyWithAggregation('call me please', state.language);
        dispatch({ type: 'SET_INTENT_SIDE_CHANNEL', primary: 'call_requested', secondary: r.secondary, confidence: 'high', urgency: r.urgency, requires_agent_review: true });
      }
      enqueueBot([{ text: state.language === 'es' ? COPY.ask_callback_pref_es : COPY.ask_callback_pref_en, pace: 'short' }]);
      return;
    }

    // 4. FRUSTRATION — acknowledge, then re-prompt the same step softer.
    if (detectFrustration(text)) {
      dispatch({ type: 'FRUSTRATION_FLAG' });
      dispatch({ type: 'ADD_USER_MSG', text });
      enqueueBot([{ text: frustrationAck(state.language), pace: 'long' }]);
      const reprompt = state.language === 'es' ? rePromptES(state.current_step) : rePromptEN(state.current_step);
      if (reprompt) enqueueBot([{ text: reprompt, pace: 'short' }]);
      return;
    }

    // 5. Mid-conversation language switch via stopword detection (no command).
    //    Skip on turn 1 to avoid overriding the explicit language pick.
    const detected = detectLanguage(text);
    if (state.turn_count > 1 && detected !== 'mixed' && detected !== state.language) {
      setLang(detected);
      // The reducer's ADD_USER_MSG already increments language_switches when
      // it sees a stable detected ≠ state.language. We don't double-dispatch
      // SWITCH_LANGUAGE here — ADD_USER_MSG handles it.
    }

    // 6. Side-channel intent capture: the user may volunteer concern info
    //    while answering name / location. Record it without disrupting the
    //    current field collection.
    const sideChannel = (() => {
      if (state.primary_intent) return null; // already captured
      if (text.length < 12) return null;     // too short to be meaningful
      const inField = state.current_step === 'collecting_full_name' ||
                      state.current_step === 'collecting_location' ||
                      state.current_step === 'state_fallback';
      if (!inField) return null;
      const r = classifyWithAggregation(text, state.language);
      if (r.confidence === 'high' || r.confidence === 'medium') return r;
      return null;
    })();

    // 7a. Caregiver/family-member signal — record once for the case file.
    if (!state.caregiver_signal && detectCaregiver(text)) {
      dispatch({ type: 'CAREGIVER_FLAG' });
    }

    // 7b. Visitor type — record existing_client if signaled in this turn.
    const visitorTypeNext = detectVisitorType(text, state.visitor_type);
    if (visitorTypeNext !== state.visitor_type) {
      dispatch({ type: 'SET_VISITOR_TYPE', value: visitorTypeNext });
    }

    // 7c. Continuity-of-care flag — surgery, treatment, hospital stay, etc.
    if (!state.mentioned_upcoming_procedure && detectUpcomingProcedure(text)) {
      dispatch({ type: 'PROCEDURE_MENTIONED' });
    }

    // 7d. Doctor + medication concern flags (any mention, anywhere in the flow).
    const lowerText = text.toLowerCase();
    if (!state.mentioned_doctor_concern && /(doctor|doctora|doctor|physician|specialist|provider|primary care|mi doctor|mi doctora|especialista|proveedor)/i.test(lowerText)) {
      dispatch({ type: 'DOCTOR_CONCERN_MENTIONED' });
    }
    if (!state.mentioned_medication_concern && /(medication|medicine|medicines|pill|prescription|drug|pharmacy|formulary|medicina|medicinas|medicamento|pastilla|receta|farmacia)/i.test(lowerText)) {
      dispatch({ type: 'MEDICATION_CONCERN_MENTIONED' });
    }

    // 8. Normal flow — branch by current step.
    dispatch({ type: 'ADD_USER_MSG', text });

    if (sideChannel) {
      dispatch({
        type: 'SET_INTENT_SIDE_CHANNEL',
        primary: sideChannel.primary,
        secondary: sideChannel.secondary,
        confidence: sideChannel.confidence,
        urgency: sideChannel.urgency,
        requires_agent_review: sideChannel.requires_agent_review,
      });
    }

    switch (state.current_step) {
      // ── WAVE 8: opening step (was language_pick) ──
      // The input is now ALWAYS enabled. A caller who types instead of
      // clicking one of the EN/ES chips gets the smoothest possible path:
      //   - "hola" / "español" / "spanish"   → flip to Spanish, continue
      //   - "hi" / "english" / "good morning"→ flip to English, continue
      //   - free text with a Medicare topic  → capture intent + skip to name
      //   - anything else                    → assume current page language,
      //                                        treat their text as concern info,
      //                                        and ask for name
      case 'language_pick': {
        // Pick language from explicit signal first, fall back to inferred.
        const explicit = detectExplicitLanguagePick(text);
        const inferred = detectLanguage(text);
        const picked: SupportLang =
          explicit ??
          (inferred === 'es' || inferred === 'en' ? inferred : state.language);
        if (picked !== state.language) {
          setLang(picked);
          dispatch({ type: 'SWITCH_LANGUAGE', lang: picked });
        }
        dispatch({ type: 'PICK_LANGUAGE', lang: picked });

        // If the typed text already contains a classifiable Medicare concern,
        // capture it as a side-channel intent so we don't waste the caller's
        // first message.
        const r = classifyWithAggregation(text, picked);
        if (r.confidence === 'high' || r.confidence === 'medium') {
          dispatch({
            type: 'SET_INTENT_SIDE_CHANNEL',
            primary: r.primary,
            secondary: r.secondary,
            confidence: r.confidence,
            urgency: r.urgency,
            requires_agent_review: r.requires_agent_review,
          });
        }

        enqueueBot([
          { text: picked === 'es' ? COPY.privacy_es : COPY.privacy_en, pace: 'long' },
        ]);
        return;
      }

      case 'privacy_acknowledge': {
        // Any typed text at the privacy step counts as implicit acknowledgement
        // ("ok", "entiendo", "sure", "got it", or even the caller's first real
        // question). Side-channel intent (if any) is already recorded above.
        dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
        enqueueBot([
          { text: state.language === 'es' ? COPY.ask_name_es : COPY.ask_name_en, pace: 'short' },
        ]);
        return;
      }

      case 'asking_callback_pref': {
        // Caller typed instead of clicking Yes/No. Try to infer.
        const t = text.toLowerCase().trim();
        const yes = /\b(yes|si|sí|yeah|yep|sure|claro|ok|okay|por favor)\b/i.test(t);
        const no = /\b(no|nope|don'?t|do not|nah|gracias no|no gracias)\b/i.test(t);
        if (yes && !no) {
          dispatch({ type: 'WANTS_CALLBACK', value: true });
          enqueueBot([{ text: state.language === 'es' ? COPY.ask_phone_es : COPY.ask_phone_en, pace: 'short' }]);
        } else if (no && !yes) {
          dispatch({ type: 'WANTS_CALLBACK', value: false });
          enqueueBot([{ text: state.language === 'es' ? COPY.ask_phone_optional_es : COPY.ask_phone_optional_en, pace: 'short' }]);
        } else {
          // Ambiguous answer — clarify gently, stay in this step.
          enqueueBot([{
            text: state.language === 'es'
              ? '¿Le gustaría que un asesor licenciado le llame? Sí o no, por favor.'
              : "Would you like a licensed advisor to call you? Just yes or no, please.",
            pace: 'short',
          }]);
        }
        return;
      }

      case 'consent_review': {
        // Typed at the consent step — gently remind to check the box.
        enqueueBot([{
          text: state.language === 'es'
            ? 'Casi terminamos. Marque la casilla de consentimiento y luego presione "Sí, enviar mi caso".'
            : "Almost done. Please check the consent box and then press \"Yes, send my case\".",
          pace: 'short',
        }]);
        return;
      }

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

        if (!parsed.state) {
          // Couldn't infer state — fallback chips next.
          enqueueBot([{ text: lang === 'es' ? COPY.state_fallback_es : COPY.state_fallback_en, pace: 'short' }]);
          return;
        }

        // We have a state. Reflect what we know.
        const knownIntent = sideChannel?.primary || state.primary_intent;
        const reflection = reflectBack(state.first_name, parsed.zip, parsed.state, lang);
        const msgs: QueuedMsg[] = [{ text: reflection, pace: 'short' }];

        if (knownIntent) {
          // Skip the concern question — go straight to intent-specific follow-up.
          if ((sideChannel?.secondary?.length || state.secondary_intents.length) > 0) {
            const sec = sideChannel?.secondary ?? state.secondary_intents;
            msgs.push({ text: buildMultiTopicAck(knownIntent, sec, lang), pace: 'long' });
          }
          msgs.push({ text: intentFollowUp(knownIntent, lang), pace: 'long' });
        } else {
          // No intent yet — ask the open concern question.
          msgs.push({ text: lang === 'es' ? COPY.ask_concern_es : COPY.ask_concern_en, pace: 'short' });
        }
        enqueueBot(msgs);
        return;
      }

      case 'state_fallback': {
        const parsed = parseZipOrState(text);
        const stateVal = parsed.state || 'Other';
        dispatch({ type: 'COLLECT_STATE_FALLBACK', value: stateVal });
        const lang = state.language;
        const knownIntent = sideChannel?.primary || state.primary_intent;
        if (knownIntent) {
          enqueueBot([
            { text: reflectBack(state.first_name, state.zip, stateVal, lang), pace: 'short' },
            { text: intentFollowUp(knownIntent, lang), pace: 'long' },
          ]);
        } else {
          enqueueBot([{ text: lang === 'es' ? COPY.ask_concern_es : COPY.ask_concern_en, pace: 'short' }]);
        }
        return;
      }

      case 'collecting_concern': {
        const result = classifyWithAggregation(text, state.language);
        dispatch({
          type: 'SET_INTENT',
          primary: result.primary,
          secondary: result.secondary,
          confidence: result.confidence,
          urgency: result.urgency,
          requires_agent_review: result.requires_agent_review,
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
        // Caller answered the follow-up. Move to callback preference.
        dispatch({ type: 'CONCERN_CAPTURED' });
        enqueueBot([{ text: state.language === 'es' ? COPY.ask_callback_pref_es : COPY.ask_callback_pref_en, pace: 'short' }]);
        return;
      }

      case 'collecting_phone': {
        if (/^skip$|^omitir$/i.test(text.trim())) {
          dispatch({ type: 'COLLECT_PHONE', value: '' });
          enqueueBot([{ text: state.language === 'es' ? COPY.ask_best_time_es : COPY.ask_best_time_en, pace: 'short' }]);
          return;
        }
        // Validate US 10-digit phone format. Retry once with a clearer ask.
        const phone = validatePhone(text);
        if (!phone.ok) {
          enqueueBot([{
            text: state.language === 'es'
              ? 'No reconocí ese número. Por favor escriba un número de teléfono de 10 dígitos, o escriba "Omitir" para continuar sin un número.'
              : "I didn't recognize that number. Please type a 10-digit phone number, or type \"Skip\" to continue without one.",
            pace: 'short',
          }]);
          return;
        }
        dispatch({ type: 'COLLECT_PHONE', value: phone.normalized });
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

  // ── Quick action chip (Phase 14 Flow A) ───────────────────────────────
  // Click captures the topic and routes the conversation through the same
  // path as a typed concern — but skips the open-concern question because
  // the user already told us what they want to do.
  function handleQuickAction(qaId: string) {
    const qa = QUICK_ACTIONS.find((q) => q.id === qaId);
    if (!qa) return;
    const lang = state.language;
    dispatch({ type: 'ADD_USER_MSG', text: lang === 'es' ? qa.label_es : qa.label_en });

    // Move past the language pick (the user's click implicitly confirms current lang).
    dispatch({ type: 'PICK_LANGUAGE', lang });

    // Capture the chip's preset intent + any secondary as side-channel so the
    // location step can skip the concern question and go straight to the
    // intent-specific follow-up.
    const primaryDef = (function () {
      // Inline because we don't have getIntentDef in this file scope context.
      // Safer to recompute urgency + escalation via classifyWithAggregation.
      // But classifier needs text — use the label text instead.
      const r = classifyWithAggregation(lang === 'es' ? qa.label_es : qa.label_en, lang);
      return r;
    })();
    dispatch({
      type: 'SET_INTENT_SIDE_CHANNEL',
      primary: qa.primary,
      secondary: qa.secondary || primaryDef.secondary,
      confidence: 'high',
      urgency: primaryDef.urgency,
      requires_agent_review: primaryDef.requires_agent_review,
    });

    // Queue the privacy notice → name question.
    enqueueBot([
      { text: lang === 'es' ? COPY.privacy_es : COPY.privacy_en, pace: 'long' },
      { text: lang === 'es' ? COPY.ask_name_es : COPY.ask_name_en, pace: 'short' },
    ]);
    // The PICK_LANGUAGE reducer already moved us to privacy_acknowledge.
    // Auto-acknowledge so we land on collecting_full_name when the name
    // question lands (the privacy band stays visible at the top of the body).
    dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
  }

  // ── Inline narrowing chip (after intent_followup bot message) ────────
  // Clicking a chip is equivalent to typing that chip's label. The chip row
  // is dismissed so the caller doesn't see a stale chip set after answering.
  function handleNarrowingChip(label: string) {
    dispatch({ type: 'ADD_USER_MSG', text: label });
    dispatch({ type: 'DISMISS_FOLLOWUP_CHIPS' });
    dispatch({ type: 'CONCERN_CAPTURED' });
    enqueueBot([
      { text: state.language === 'es' ? COPY.ask_callback_pref_es : COPY.ask_callback_pref_en, pace: 'short' },
    ]);
  }

  // ── Quick language toggle (single chip) ───────────────────────────────
  function handleQuickLanguageToggle() {
    const next: SupportLang = state.language === 'es' ? 'en' : 'es';
    setLang(next);
    dispatch({ type: 'SWITCH_LANGUAGE', lang: next });
    // Re-emit the welcome in the new language. Use clearExisting so we don't
    // pile language-mismatched messages from a stale queue.
    enqueueBot([{ text: next === 'es' ? COPY.welcome_es : COPY.welcome_en, pace: 'long' }], true);
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
      caregiver_signal: state.caregiver_signal,
      visitor_type: state.visitor_type,
      mentioned_upcoming_procedure: state.mentioned_upcoming_procedure,
      mentioned_doctor_concern: state.mentioned_doctor_concern,
      mentioned_medication_concern: state.mentioned_medication_concern,
      wants_callback: state.wants_callback,
      consent_to_contact: state.consent_to_contact,
      first_name: state.first_name,
      last_name: state.last_name,
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

  // INPUT IS ALWAYS ENABLED unless a submission is in flight or the conversation
  // is paused for a real reason (emergency / already submitted / fatal failure).
  // This is the Wave 8 freeze-fix: the previous logic disabled input at the
  // language_pick + privacy_acknowledge steps, which made the input box look
  // greyed-out at the moment a senior caller first tried to type.
  const inputEnabled =
    state.current_step !== 'submitting' &&
    state.current_step !== 'submitted' &&
    state.current_step !== 'submission_failed' &&
    state.current_step !== 'emergency_paused';

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
        className="flex-1 overflow-y-auto overscroll-contain min-h-0 max-h-[64vh] md:max-h-[680px]"
      >
        {/* Persistent privacy/identity band — sits at the top of the scroll
            body so it doesn't permanently consume vertical space. */}
        <div className="bg-gold-100 border-b border-gold-200 px-4 py-2 text-[11.5px] leading-[1.45] text-earth-700">
          <p>
            {lang === 'es'
              ? 'ClearPoint Senior Advisors es una agencia privada e independiente. No estamos conectados con Medicare ni con el gobierno federal. Por favor no envíe número de Medicare, Seguro Social, información bancaria ni récords médicos privados por aquí.'
              : 'ClearPoint Senior Advisors is a private independent agency. We are not connected with Medicare or the federal government. Please do not send Medicare ID, Social Security numbers, banking information, or private medical records here.'}
          </p>
        </div>
        <div className="px-4 py-4 space-y-3.5">
          {state.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-[14.5px] leading-[1.55] ${
                  m.role === 'user'
                    ? 'bg-earth-800 text-cream-50 rounded-br-md'
                    : 'bg-white text-earth-800 shadow-xs border border-cream-200 rounded-bl-md'
                }`}
              >
                <div className="whitespace-pre-line">{m.text}</div>
              </div>
            </div>
          ))}

          {/* Wave 9 — inline narrowing chips after the intent_followup bot turn.
              Up to 4 small pills the caller can ignore by typing freely. */}
          {state.current_step === 'intent_followup' &&
            !isTyping &&
            state.primary_intent &&
            !state.followup_chips_dismissed && (() => {
              const chips = intentFollowUpChips(state.primary_intent, state.language);
              if (!chips || chips.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {chips.slice(0, 4).map((c) => (
                    <PillButton
                      key={c}
                      onClick={() => handleNarrowingChip(c)}
                    >
                      {c}
                    </PillButton>
                  ))}
                </div>
              );
            })()}

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

          {/* ── Wave 9 opening — premium pill chips, subtle, max 4 ── */}
          {state.current_step === 'language_pick' && !isTyping && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {/* Language toggle pill */}
              <PillButton
                onClick={() => handleQuickLanguageToggle()}
                aria-label={lang === 'es' ? 'Cambiar a inglés' : 'Switch to Spanish'}
              >
                🌐 {lang === 'es' ? 'English' : 'Español'}
              </PillButton>
              {/* 3 topic chips (Wave 9 reduced from 6 grid to 3 pills) */}
              {QUICK_ACTIONS.map((qa) => (
                <PillButton key={qa.id} onClick={() => handleQuickAction(qa.id)}>
                  {lang === 'es' ? qa.label_es : qa.label_en}
                </PillButton>
              ))}
            </div>
          )}

          {/* Wave 9: privacy_acknowledge step UI removed. Reducer auto-skips to
              collecting_full_name. The persistent gold privacy band at the top
              of the body provides the compliance disclosure. */}

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

// ─────────────────────────────────────────────────────────────────────────────
// PillButton — Wave 9 premium small chip. Subtle, optional, ignorable.
// Smaller than a real action button. Inline-flex so multiple wrap naturally
// in a chip row instead of dominating a column.
// ─────────────────────────────────────────────────────────────────────────────

function PillButton({
  onClick,
  children,
  'aria-label': ariaLabel,
}: {
  onClick: () => void;
  children: React.ReactNode;
  'aria-label'?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex items-center px-3 py-1.5 bg-white border border-cream-300 text-earth-700 rounded-full text-[12.5px] font-medium hover:bg-cream-50 hover:border-gold-400 hover:text-earth-900 active:bg-cream-100 transition-colors whitespace-nowrap"
    >
      {children}
    </button>
  );
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

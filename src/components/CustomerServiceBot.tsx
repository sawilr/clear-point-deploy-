/**
 * Customer Service Box — ClearPoint Support Intake
 *
 * Inline (page-resident) chat surface for /support. NOT a floating launcher.
 *
 * Architecture lineage:
 *   - Zara (src/components/ChatBot.tsx) is the reference for UX patterns:
 *     bubble styling, typing pacing/queue, monotonic bottom-follow scroll,
 *     header layout, senior-friendly spacing, privacy band inside the scroll
 *     body, options-in-bubble rendering, grid-vs-stack button layout.
 *   - This file does NOT import from ChatBot.tsx. Zara remains locked.
 *   - All pure logic (detectors, summary, tags) lives in src/lib/customerServiceEngine.ts
 *     so a future phone/voice intake can reuse it without React.
 *
 * Compliance:
 *   - No "you qualify", no "best plan", no "guaranteed savings", no
 *     "affiliated with Medicare/CMS/government". All COPY runs through the
 *     forbidden-phrase scanner in tests.
 *   - Sensitive info (MBI / SSN / card / routing) is intercepted in detector
 *     and NEVER appended to messages or summary.
 *   - Emergency keywords pause the flow and route to 911.
 *
 * GHL: submits via existing submitLeadToGHL() from src/lib/ghl.ts using
 *   source = 'customer_service_bot'. No new endpoint, no new env vars.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { Headphones, MessageCircle, Phone, RotateCcw, Send } from 'lucide-react';
import { type IntentId, type IntentUrgency, getIntent } from '../data/customerServiceIntents';
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
  type CaseState,
  type SupportLang,
} from '../lib/customerServiceEngine';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE
// ─────────────────────────────────────────────────────────────────────────────

type Step =
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

type Pace = 'short' | 'long' | 'slow';
type MsgRole = 'bot' | 'user';

interface Option {
  label: string;
  value: string;
}

interface Message {
  id: string;
  role: MsgRole;
  text: string;
  options?: Option[];
}

interface QueuedMsg {
  text: string;
  options?: Option[];
  pace?: Pace;
}

interface State {
  session_id: string;
  started_at: string;
  turn_count: number;
  language: SupportLang;
  preferred_language: 'English' | 'Spanish' | 'Either' | '';
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
  consent_to_contact: boolean;
  first_name: string;
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
  | { type: 'SET_INTENT'; primary: IntentId; secondary: IntentId[]; confidence: 'high' | 'medium' | 'low' }
  | { type: 'ADD_USER_MSG'; text: string }
  | { type: 'ADD_BOT_MSG'; text: string; options?: Option[] }
  | { type: 'EMERGENCY_DETECTED' }
  | { type: 'ACK_EMERGENCY' }
  | { type: 'SENSITIVE_INTERCEPTED' }
  | { type: 'FRUSTRATION_FLAG' }
  | { type: 'COLLECT_FIRST_NAME'; value: string }
  | { type: 'COLLECT_PHONE'; value: string }
  | { type: 'COLLECT_STATE'; value: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other' }
  | { type: 'COLLECT_ZIP'; value: string }
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
    consent_to_contact: false,
    first_name: '',
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
        current_step: 'intent_pick',
      };

    case 'SET_INTENT': {
      const primary = getIntent(action.primary);
      let urgency: IntentUrgency = primary.default_urgency;
      let needsReview = primary.escalate_to_agent;
      for (const sid of action.secondary) {
        const s = getIntent(sid);
        if (s.default_urgency === 'urgent') urgency = 'urgent';
        else if (s.default_urgency === 'high' && urgency !== 'urgent') urgency = 'high';
        if (s.escalate_to_agent) needsReview = true;
      }
      return {
        ...state,
        primary_intent: action.primary,
        secondary_intents: action.secondary,
        confidence: action.confidence,
        urgency,
        requires_agent_review: needsReview,
        current_step: 'collecting_first_name',
      };
    }

    case 'ADD_USER_MSG': {
      // Mid-conversation language switch detection. Only after turn 1 so we
      // don't override the user's explicit language pick.
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
      return {
        ...state,
        messages: [...state.messages, { id: uid(), role: 'bot', text: action.text, options: action.options }],
      };

    case 'EMERGENCY_DETECTED':
      return { ...state, emergency_warning_shown: true, current_step: 'emergency_paused', urgency: 'urgent' };

    case 'ACK_EMERGENCY':
      return { ...state, current_step: state.primary_intent ? 'collecting_first_name' : 'intent_pick' };

    case 'SENSITIVE_INTERCEPTED':
      return { ...state, sensitive_data_intercepted: true };

    case 'FRUSTRATION_FLAG':
      return { ...state, frustration_detected: true };

    case 'COLLECT_FIRST_NAME':
      return { ...state, first_name: action.value.trim(), current_step: 'collecting_phone' };
    case 'COLLECT_PHONE':
      return { ...state, phone: action.value.trim(), current_step: 'collecting_state' };
    case 'COLLECT_STATE':
      return { ...state, state: action.value, current_step: 'collecting_zip_optional' };
    case 'COLLECT_ZIP':
      return { ...state, zip: action.value.trim(), current_step: 'collecting_best_time' };
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
// COPY (bilingual)
//
// All strings the bot can emit. Run through scanForbiddenPhrases() in tests.
// ─────────────────────────────────────────────────────────────────────────────

const COPY = {
  brand_en: 'Customer Service Box',
  brand_es: 'Caja de Servicio al Cliente',
  tagline_en: 'ClearPoint Support Intake · Bilingual · No cost',
  tagline_es: 'Soporte ClearPoint · Bilingüe · Sin costo',

  language_prompt_en: "Hi, I'm the ClearPoint Customer Service Box. I can help organize your Medicare question or concern so a licensed advisor can review it and follow up. Would you prefer English or Spanish?",
  language_prompt_es: 'Hola, soy la Caja de Servicio al Cliente de ClearPoint. Puedo ayudarle a organizar su pregunta o situación de Medicare para que un asesor licenciado pueda revisarla y darle seguimiento. ¿Prefiere inglés o español?',

  greeting_en: "Hi, I'm the ClearPoint Customer Service Box. I can help organize your Medicare question or concern so a licensed advisor can review it and follow up.",
  greeting_es: 'Hola, soy la Caja de Servicio al Cliente de ClearPoint. Puedo ayudarle a organizar su pregunta o situación de Medicare para que un asesor licenciado pueda revisarla y darle seguimiento.',

  privacy_band_en: 'Please do not send Medicare ID, Social Security numbers, banking information, or private medical records here. This tool helps organize your question only. A licensed ClearPoint advisor will follow up. ClearPoint is an independent private agency — it is not Medicare, CMS, or any federal program.',
  privacy_band_es: 'Por favor no envíe su número de Medicare, Seguro Social, información bancaria ni récords médicos privados por aquí. Esta herramienta solo ayuda a organizar su pregunta. Un asesor licenciado de ClearPoint dará seguimiento. ClearPoint es una agencia privada e independiente — no es Medicare, CMS, ni ningún programa federal.',

  acknowledge_to_continue_en: "When you're ready, tap Continue and tell me what you'd like help with.",
  acknowledge_to_continue_es: 'Cuando esté listo, presione Continuar y dígame en qué le puedo ayudar.',
  continue_en: 'Continue',
  continue_es: 'Continuar',

  intent_pick_en: 'What can I help you organize today? Tap a topic or type your question in your own words.',
  intent_pick_es: '¿Con qué le puedo ayudar a organizar hoy? Toque un tema o escriba su pregunta con sus propias palabras.',

  emergency_title_en: 'This chat is not for medical emergencies',
  emergency_title_es: 'Este chat no es para emergencias médicas',
  emergency_text_en: 'This chat is not for medical emergencies. Please call 911 or seek immediate medical help. When you are safe, you can come back and I will help organize your Medicare question.',
  emergency_text_es: 'Este chat no es para emergencias médicas. Llame al 911 o busque ayuda médica inmediata. Cuando esté a salvo, puede regresar y le ayudaré a organizar su pregunta de Medicare.',
  emergency_ack_en: 'I am safe — continue',
  emergency_ack_es: 'Estoy a salvo — continuar',
  call_911_en: 'Call 911',
  call_911_es: 'Llamar al 911',

  sensitive_intercept_en: "It looks like you typed sensitive information (a Medicare ID, Social Security number, card, or banking number). For your safety I'm not saving that — please share those details only with a licensed advisor through a secure channel.",
  sensitive_intercept_es: 'Parece que escribió información sensible (un número de Medicare, Seguro Social, tarjeta o banco). Por su seguridad no lo estoy guardando — comparta esos datos solo con un asesor licenciado a través de un canal seguro.',

  ask_first_name_en: "Let's start with your first name:",
  ask_first_name_es: 'Empecemos con su nombre:',
  ask_phone_en: 'Your phone number, so a licensed advisor can follow up:',
  ask_phone_es: 'Su número de teléfono, para que un asesor licenciado pueda comunicarse:',
  ask_state_en: 'Which state do you live in?',
  ask_state_es: '¿En qué estado vive?',
  ask_zip_en: 'Your ZIP code (optional — type it, or tap Skip):',
  ask_zip_es: 'Su código postal (opcional — escríbalo o presione Omitir):',
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
  submitted_body_es: 'Un asesor bilingüe de ClearPoint revisará su caso y le contactará al número que proporcionó.',

  failed_title_en: 'Something went wrong sending your case.',
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
  call_now_en: 'Call now',
  call_now_es: 'Llamar ahora',
};

const PRIMARY_BUTTONS_EN: { id: IntentId; label: string }[] = [
  { id: 'annual_review', label: 'Review my plan' },
  { id: 'medication_help', label: 'Medication help' },
  { id: 'doctor_network_question', label: 'Doctor or network question' },
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
  { value: 'Other' as const, label_en: 'Other state', label_es: 'Otro estado' },
];
const TIME_BUTTONS_EN = ['Morning', 'Afternoon', 'Evening', 'Anytime'];
const TIME_BUTTONS_ES = ['Mañana', 'Tarde', 'Noche', 'Cualquier hora'];

// ─────────────────────────────────────────────────────────────────────────────
// TYPING PACE
// ─────────────────────────────────────────────────────────────────────────────

function getTypingDelay(text: string, pace: Pace = 'short'): number {
  // Rough WPM model: cap so a long message doesn't take 10s. Senior-friendly.
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

  // Typing queue refs — same pattern Zara uses to prevent overlapping messages.
  const queueRef = useRef<QueuedMsg[]>([]);
  const processingRef = useRef(false);
  const generationRef = useRef(0);

  // Scroll refs — pure monotonic bottom-follow (Zara pattern).
  const bodyRef = useRef<HTMLDivElement>(null);
  const userPinnedUpRef = useRef(false);
  const prevMsgLenRef = useRef(0);
  const prevTypingRef = useRef(false);
  const inputFocusedRef = useRef(false);

  // ─── sessionStorage persistence ────────────────────────────────────────
  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
  }, [state]);

  // ─── Page-level language sync → bot ────────────────────────────────────
  // Only meaningful for the first render (user hasn't picked yet). Once the
  // user picks a language inside the bot we hand it back via setLang(), so
  // both surfaces stay in lock-step from that point on.

  // ─── Scroll lifecycle (monotonic bottom-follow) ────────────────────────
  function safeScrollToBottom() {
    const c = bodyRef.current;
    if (!c) return;
    c.scrollTop = c.scrollHeight;
  }
  function handleScroll() {
    const c = bodyRef.current;
    if (!c) return;
    const distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
    if (distFromBottom > 200) userPinnedUpRef.current = true;
    else if (distFromBottom < 40) userPinnedUpRef.current = false;
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

  // ─── Typing queue (Zara pattern) ──────────────────────────────────────
  function sleep(ms: number) {
    return new Promise<void>((r) => window.setTimeout(r, ms));
  }
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
      dispatch({ type: 'ADD_BOT_MSG', text: next.text, options: next.options });
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

  // ─── Welcome on mount ──────────────────────────────────────────────────
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    enqueueBot([
      { text: initialLang === 'es' ? COPY.language_prompt_es : COPY.language_prompt_en, pace: 'slow' },
    ]);
    // We intentionally don't depend on initialLang — first mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Language pick ────────────────────────────────────────────────────
  function handlePickLanguage(l: SupportLang) {
    // Mirror selection on the page so Hero, footer, header toggle all sync.
    setLang(l);
    dispatch({ type: 'ADD_USER_MSG', text: l === 'es' ? 'Español' : 'English' });
    dispatch({ type: 'PICK_LANGUAGE', lang: l });
    enqueueBot([
      { text: l === 'es' ? COPY.greeting_es : COPY.greeting_en, pace: 'long' },
      { text: l === 'es' ? COPY.acknowledge_to_continue_es : COPY.acknowledge_to_continue_en, pace: 'short' },
    ]);
  }

  // ─── Privacy acknowledge ──────────────────────────────────────────────
  function handleAcknowledgePrivacy() {
    dispatch({ type: 'ACKNOWLEDGE_PRIVACY' });
    enqueueBot([
      { text: state.language === 'es' ? COPY.intent_pick_es : COPY.intent_pick_en, pace: 'short' },
    ]);
  }

  // ─── Intent button click ──────────────────────────────────────────────
  function handleIntentButton(intentId: IntentId) {
    const intent = getIntent(intentId);
    const label = state.language === 'es'
      ? PRIMARY_BUTTONS_ES.find((b) => b.id === intentId)?.label || intentId
      : PRIMARY_BUTTONS_EN.find((b) => b.id === intentId)?.label || intentId;
    dispatch({ type: 'ADD_USER_MSG', text: label });
    dispatch({ type: 'SET_INTENT', primary: intentId, secondary: [], confidence: 'high' });
    enqueueBot([
      { text: state.language === 'es' ? intent.next_question_es : intent.next_question_en, pace: 'long' },
      { text: state.language === 'es' ? COPY.ask_first_name_es : COPY.ask_first_name_en, pace: 'short' },
    ]);
  }

  // ─── Free-text user submit ────────────────────────────────────────────
  function handleUserSubmit() {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');

    // ── 1. EMERGENCY first — even before storing the message ──
    if (detectEmergency(text)) {
      dispatch({ type: 'ADD_USER_MSG', text });
      dispatch({ type: 'EMERGENCY_DETECTED' });
      enqueueBot([{ text: state.language === 'es' ? COPY.emergency_text_es : COPY.emergency_text_en, pace: 'slow' }]);
      return;
    }

    // ── 2. SENSITIVE — never store the raw text ──
    const sens = detectSensitive(text);
    if (sens.isSensitive) {
      dispatch({ type: 'SENSITIVE_INTERCEPTED' });
      enqueueBot([{ text: state.language === 'es' ? COPY.sensitive_intercept_es : COPY.sensitive_intercept_en, pace: 'long' }]);
      return;
    }

    // ── 3. FRUSTRATION — acknowledge before re-prompting ──
    if (detectFrustration(text)) {
      dispatch({ type: 'FRUSTRATION_FLAG' });
      dispatch({ type: 'ADD_USER_MSG', text });
      enqueueBot([{ text: frustrationAck(state.language), pace: 'long' }]);
      // Re-prompt the user's current step instead of stopping cold
      const step = state.current_step;
      const reprompt = state.language === 'es' ? rePromptES(step) : rePromptEN(step);
      if (reprompt) enqueueBot([{ text: reprompt, pace: 'short' }]);
      return;
    }

    // ── 4. Normal flow ──
    dispatch({ type: 'ADD_USER_MSG', text });
    const step = state.current_step;

    if (step === 'intent_pick') {
      const result = classifyIntent(text, state.language);
      dispatch({ type: 'SET_INTENT', primary: result.primary, secondary: result.secondary, confidence: result.confidence });
      const intent = getIntent(result.primary);
      const msgs: QueuedMsg[] = [];
      if (result.secondary.length > 0) {
        msgs.push({ text: buildMultiTopicAck(result.primary, result.secondary, state.language), pace: 'long' });
      }
      msgs.push({ text: state.language === 'es' ? intent.next_question_es : intent.next_question_en, pace: 'long' });
      msgs.push({ text: state.language === 'es' ? COPY.ask_first_name_es : COPY.ask_first_name_en, pace: 'short' });
      enqueueBot(msgs);
      return;
    }

    if (step === 'collecting_first_name') {
      dispatch({ type: 'COLLECT_FIRST_NAME', value: text });
      enqueueBot([{ text: state.language === 'es' ? COPY.ask_phone_es : COPY.ask_phone_en, pace: 'short' }]);
      return;
    }
    if (step === 'collecting_phone') {
      dispatch({ type: 'COLLECT_PHONE', value: text });
      enqueueBot([{ text: state.language === 'es' ? COPY.ask_state_es : COPY.ask_state_en, pace: 'short' }]);
      return;
    }
    if (step === 'collecting_zip_optional') {
      dispatch({ type: 'COLLECT_ZIP', value: text });
      enqueueBot([{ text: state.language === 'es' ? COPY.ask_best_time_es : COPY.ask_best_time_en, pace: 'short' }]);
      return;
    }
    if (step === 'collecting_best_time') {
      dispatch({ type: 'COLLECT_BEST_TIME', value: text });
      return;
    }
  }

  function handleStateButton(st: 'NY' | 'NJ' | 'CT' | 'FL' | 'Other') {
    const label = STATE_BUTTONS.find((b) => b.value === st);
    dispatch({ type: 'ADD_USER_MSG', text: state.language === 'es' ? (label?.label_es || st) : (label?.label_en || st) });
    dispatch({ type: 'COLLECT_STATE', value: st });
    enqueueBot([{ text: state.language === 'es' ? COPY.ask_zip_es : COPY.ask_zip_en, pace: 'short' }]);
  }
  function handleSkipZip() {
    dispatch({ type: 'COLLECT_ZIP', value: '' });
    enqueueBot([{ text: state.language === 'es' ? COPY.ask_best_time_es : COPY.ask_best_time_en, pace: 'short' }]);
  }
  function handleTimeButton(label: string) {
    dispatch({ type: 'ADD_USER_MSG', text: label });
    dispatch({ type: 'COLLECT_BEST_TIME', value: label });
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
      last_name: '',
      full_name: state.first_name,
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
      bot_transcript_summary: `Customer Service Box · Primary: ${state.primary_intent} · Secondary: ${state.secondary_intents.join(', ') || 'none'} · Urgency: ${state.urgency}${state.frustration_detected ? ' · Frustration acknowledged' : ''}`,
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
    // Re-queue the welcome
    window.setTimeout(() => {
      enqueueBot([{ text: currentLang === 'es' ? COPY.language_prompt_es : COPY.language_prompt_en, pace: 'slow' }], true);
    }, 100);
  }

  function handleAcknowledgeEmergency() {
    dispatch({ type: 'ACK_EMERGENCY' });
    enqueueBot([{ text: state.language === 'es' ? COPY.intent_pick_es : COPY.intent_pick_en, pace: 'short' }]);
  }

  // ─── Input row enabled? ───────────────────────────────────────────────
  const inputEnabled =
    state.current_step === 'intent_pick' ||
    state.current_step === 'collecting_first_name' ||
    state.current_step === 'collecting_phone' ||
    state.current_step === 'collecting_zip_optional' ||
    state.current_step === 'collecting_best_time';

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  const lang = state.language;

  return (
    <div className="bg-cream-50 rounded-2xl shadow-lifted border border-cream-200 max-w-3xl mx-auto overflow-hidden flex flex-col">
      {/* ── Header bar (Zara-pattern earth-800) ── */}
      <header className="bg-earth-800 text-cream-50 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-sage-300 flex items-center justify-center text-earth-900 flex-shrink-0" aria-hidden="true">
            <Headphones className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">
              {lang === 'es' ? COPY.brand_es : COPY.brand_en}
            </div>
            <div className="text-[11px] text-cream-200 font-normal">
              {lang === 'es' ? COPY.tagline_es : COPY.tagline_en}
            </div>
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

      {/* ── Scrollable body — privacy band INSIDE so it scrolls away ── */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain min-h-0 max-h-[62vh] md:max-h-[640px]"
      >
        <div className="bg-gold-100 border-b border-gold-200 px-4 py-2.5 text-[12px] text-earth-700 leading-[1.5]">
          <p>{lang === 'es' ? COPY.privacy_band_es : COPY.privacy_band_en}</p>
        </div>

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

          {/* ── Step-specific action panels (rendered AFTER messages so they sit at bottom) ── */}
          {state.current_step === 'language_pick' && !isTyping && (
            <ActionRow>
              <ActionButton onClick={() => handlePickLanguage('en')}>English</ActionButton>
              <ActionButton onClick={() => handlePickLanguage('es')}>Español</ActionButton>
            </ActionRow>
          )}

          {state.current_step === 'privacy_acknowledge' && !isTyping && (
            <ActionRow>
              <ActionButton onClick={handleAcknowledgePrivacy} variant="primary">
                {lang === 'es' ? COPY.continue_es : COPY.continue_en}
              </ActionButton>
            </ActionRow>
          )}

          {state.current_step === 'intent_pick' && !isTyping && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {(lang === 'es' ? PRIMARY_BUTTONS_ES : PRIMARY_BUTTONS_EN).map((b) => (
                <button
                  key={b.id}
                  onClick={() => handleIntentButton(b.id)}
                  className="w-full text-left px-4 py-3 bg-cream-50 border border-cream-200 text-earth-800 rounded-lg text-[14px] font-medium min-h-[48px] hover:bg-gold-100 hover:border-gold-300 transition-colors"
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}

          {state.current_step === 'collecting_state' && !isTyping && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
              {STATE_BUTTONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => handleStateButton(s.value)}
                  className="px-3 py-3 bg-cream-50 border border-cream-200 text-earth-800 rounded-lg text-[14px] font-medium min-h-[48px] hover:bg-gold-100 hover:border-gold-300 transition-colors"
                >
                  {lang === 'es' ? s.label_es : s.label_en}
                </button>
              ))}
            </div>
          )}

          {state.current_step === 'collecting_zip_optional' && !isTyping && (
            <ActionRow>
              <ActionButton onClick={handleSkipZip} variant="ghost">
                {lang === 'es' ? COPY.skip_es : COPY.skip_en}
              </ActionButton>
            </ActionRow>
          )}

          {state.current_step === 'collecting_best_time' && !isTyping && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              {(lang === 'es' ? TIME_BUTTONS_ES : TIME_BUTTONS_EN).map((label) => (
                <button
                  key={label}
                  onClick={() => handleTimeButton(label)}
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
                <ActionButton onClick={handleReset} variant="primary">
                  {lang === 'es' ? COPY.reset_es : COPY.reset_en}
                </ActionButton>
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

      {/* ── Footer call + advisor + input row ── */}
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

      <form
        onSubmit={(e) => { e.preventDefault(); handleUserSubmit(); }}
        className="px-3 pb-3 pt-2 border-t border-cream-200 flex-shrink-0 bg-white"
      >
        <div className="flex gap-2 min-w-0">
          <input
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
// SMALL UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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
  return (
    <button onClick={onClick} className={`${base} ${styles}`}>
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
      <h3 className="font-serif text-lg text-earth-900">
        {lang === 'es' ? COPY.consent_review_title_es : COPY.consent_review_title_en}
      </h3>
      <dl className="space-y-1.5 text-[14px]">
        <Row label_en="First name" label_es="Nombre" value={s.first_name} lang={lang} />
        <Row label_en="Phone" label_es="Teléfono" value={s.phone} lang={lang} />
        <Row label_en="State" label_es="Estado" value={s.state} lang={lang} />
        <Row label_en="ZIP" label_es="ZIP" value={s.zip || '—'} lang={lang} />
        <Row label_en="Best time" label_es="Mejor hora" value={s.best_time_to_call} lang={lang} />
        <Row label_en="Main topic" label_es="Tema principal" value={s.primary_intent || ''} lang={lang} />
        {s.secondary_intents.length > 0 && (
          <Row label_en="Secondary topics" label_es="Temas secundarios" value={s.secondary_intents.join(', ')} lang={lang} />
        )}
        <Row label_en="Urgency" label_es="Urgencia" value={s.urgency} lang={lang} />
      </dl>

      <p className="text-[12px] text-earth-600 leading-relaxed bg-cream-50 border border-cream-200 rounded-lg p-3">
        {advisorHandoffLine(lang)}
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
// FRUSTRATION RE-PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

function rePromptEN(step: Step): string {
  switch (step) {
    case 'intent_pick': return "Take your time. When you're ready, tap a topic or type your question in your own words.";
    case 'collecting_first_name': return 'No rush — what is your first name?';
    case 'collecting_phone': return 'No rush — what is your phone number so a licensed advisor can reach you?';
    case 'collecting_state': return 'Which state do you live in?';
    case 'collecting_zip_optional': return 'You can type a ZIP code or just tap Skip.';
    case 'collecting_best_time': return 'What time of day works best for a callback?';
    default: return '';
  }
}
function rePromptES(step: Step): string {
  switch (step) {
    case 'intent_pick': return 'Tome su tiempo. Cuando esté listo, toque un tema o escriba su pregunta con sus propias palabras.';
    case 'collecting_first_name': return 'Sin prisa — ¿cuál es su nombre?';
    case 'collecting_phone': return 'Sin prisa — ¿cuál es su número de teléfono para que un asesor licenciado pueda comunicarse?';
    case 'collecting_state': return '¿En qué estado vive?';
    case 'collecting_zip_optional': return 'Puede escribir un código postal o simplemente presionar Omitir.';
    case 'collecting_best_time': return '¿A qué hora del día le viene mejor recibir una llamada?';
    default: return '';
  }
}

// Exports for QA harness
export { COPY, PRIMARY_BUTTONS_EN, PRIMARY_BUTTONS_ES };

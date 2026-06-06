// ============================================================================
// CUSTOMER SERVICE BOT V15 — ENTERPRISE PROFESSIONAL
// Drop-in V15 architecture with ClearPoint brand palette + GHL bridge.
// State machine: language → name → ZIP → problem → conversation.
// Language is LOCKED at step 1 via chip click. Never auto-flips.
// ============================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  processMessageAsync,
  createInitialState,
  sanitizeResponse,
  type ConversationState,
  type Language,
} from '../lib/customerServiceEngine';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
// PHASE F — advisor-readable lead-note builder. Pure helper, no network.
import { buildLeadNote } from '../lib/orchestrator/leadNoteBuilder';
// PHASE E — mobile scroll + viewport-tier helpers (pure module).
import {
  decideScrollAction,
  viewportTier,
  containerHeightStyle,
  chipRowClass,
  safeAreaBottomStyle,
  shouldCollapseDisclosure,
  isNearBottom,
  isFarFromBottom,
} from './chat/MobileScrollController';
import { Phone, RotateCcw, Send, User, Mic, MicOff } from 'lucide-react';
import { createVoiceRecognizer, isVoiceSupported } from '../lib/voiceInput';
import { getOfficeStatus } from '../lib/afterHours';
import { readVisitorMemory, writeVisitorMemory, returningVisitorGreeting } from '../lib/persistentMemory';
import { buildConsentReceipt } from '../lib/disclaimerVersion';
import {
  type ClaraOuterState,
  createOuterState,
  validateFullName,
  isQualifiedProspect,
  buildGhlPayload,
  inferInitialPath,
  inferYesClient,
  inferMedicareStatus,
  inferStateFromText,
  inferTopic,
} from '../lib/claraOuterFlow';
import { detectSafetyTrigger } from '../lib/safetyRouter';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

// PHASE A (A3) — chip label → semantic intent_hint registry. When user
// clicks a chip whose label matches a key here, the UI sends a structured
// chip event to the engine and the engine bypasses NLP classification.
// Labels are matched case-insensitively after trimming. New chips can be
// added without code changes by the engine team.
const CHIP_INTENT_HINTS: Record<string, string> = {
  // change topic
  'no, otra cosa': 'change_topic',
  'no, something else': 'change_topic',
  'otra cosa': 'change_topic',
  'something else': 'change_topic',
  'otro tema': 'change_topic',
  'change topic': 'change_topic',
  // have a question
  'tengo una pregunta': 'have_question',
  'una pregunta más': 'have_question',
  'i have a question': 'have_question',
  'one more question': 'have_question',
  // advisor handoff request
  'hablar con asesor': 'advisor',
  'hablar con un asesor': 'advisor',
  'sí, asesor': 'advisor',
  'sí, llamar asesor': 'advisor',
  'yes, advisor': 'advisor',
  'yes, call advisor': 'advisor',
  'talk to an advisor': 'advisor',
  'talk to advisor': 'advisor',
  'sí, hablar con asesor': 'advisor',
  'yes, talk to advisor': 'advisor',
  // more options
  'más opciones': 'more_options',
  'mas opciones': 'more_options',
  'more options': 'more_options',
  // start over
  'empezar de nuevo': 'start_over',
  'start over': 'start_over',
  'empezar': 'start_over',
};

function lookupChipHint(label: string): string | undefined {
  return CHIP_INTENT_HINTS[label.trim().toLowerCase()];
}

interface CustomerServiceBotProps {
  onEscalate?: (state: ConversationState, messages: Message[]) => void;
  initialLanguage?: 'en' | 'es';
}

export function CustomerServiceBot({ onEscalate, initialLanguage }: CustomerServiceBotProps = {}) {
  const { lang: pageLang, setLang } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<ConversationState>(createInitialState);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // PHASE 9E — voice recognizer (Web Speech API, optional)
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceSupported = isVoiceSupported();
  const voiceRecognizerRef = useRef<ReturnType<typeof createVoiceRecognizer> | null>(null);
  // PHASE 9E — after-hours awareness (Mon-Fri 9-6 ET)
  const officeStatus = getOfficeStatus();
  // PHASE 10 — Clara outer flow (Path A/B/C) sits ABOVE the engine.
  // When outerStep !== 'B_engine_engaged', custom UI is rendered and the
  // existing engine (customerServiceEngine.ts) does NOT process messages.
  const [outerState, setOuterState] = useState<ClaraOuterState>(() =>
    createOuterState((initialLanguage || pageLang) === 'es' ? 'es' : 'en'),
  );
  const [outerInProgress, setOuterInProgress] = useState(true); // false → engine takes over (Path B qualified)
  const bodyRef = useRef<HTMLDivElement>(null);
  const userPinnedUpRef = useRef(false);
  // WAVE 39 — synchronous re-entrancy lock. React state (isTyping) doesn't
  // flush between two near-simultaneous click events; a ref does. Blocks
  // double-submit on rapid taps / Enter mashing.
  const isSendingRef = useRef(false);
  // ─── PHASE E: viewport tracking + new-message indicator + reset modal ───
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    (typeof window !== 'undefined' ? window.innerWidth : 1280));
  const [visualViewportHeight, setVisualViewportHeight] = useState<number | undefined>(
    () => (typeof window !== 'undefined' && window.visualViewport
      ? window.visualViewport.height : undefined),
  );
  const [hasNewBotMessage, setHasNewBotMessage] = useState<boolean>(false);
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const [disclosureCollapsed, setDisclosureCollapsed] = useState<boolean>(false);
  // Debounce scroll-pin detection so transient typing-indicator
  // appear/disappear doesn't flip the pin state.
  const scrollPinDebounceRef = useRef<number | null>(null);
  // Sawil bugfix — gate the GHL POST: submit only when BOTH name and phone
  // are captured. The engine sets needsHuman=true the moment the bot says
  // "tell me your name and phone", which used to fire an empty lead at GHL
  // immediately. Use a ref so we POST exactly once per session.
  const hasSubmittedRef = useRef(false);
  // Latest-escalateHandler ref so the submit effect can call it without a
  // forward-declaration error (escalateHandler depends on onEscalate which
  // is defined further below).
  const escalateHandlerRef = useRef<((s: ConversationState, m: Message[]) => void) | null>(null);

  // PHASE E — deterministic scroll lifecycle. The decideScrollAction() helper
  // owns the policy; this effect just dispatches on the result.
  // Uses 1 rAF for user-initiated, 2 rAF for bot-emitted so the new bubble
  // has time to paint before we measure scrollHeight.
  const scrollToBottom = useCallback((smooth: boolean) => {
    const c = bodyRef.current;
    if (!c) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cc = bodyRef.current;
        if (!cc) return;
        cc.scrollTo({ top: cc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      });
    });
  }, []);

  function handleScroll() {
    // PHASE E — debounce scroll-pin detection (100 ms) so that the typing
    // indicator's appearance / disappearance does not flip the pin state.
    if (scrollPinDebounceRef.current) {
      window.clearTimeout(scrollPinDebounceRef.current);
    }
    scrollPinDebounceRef.current = window.setTimeout(() => {
      const c = bodyRef.current;
      if (!c) return;
      const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
      if (isFarFromBottom(dist)) {
        userPinnedUpRef.current = true;
      } else if (isNearBottom(dist)) {
        userPinnedUpRef.current = false;
        // Reaching the bottom dismisses the "new message" indicator.
        setHasNewBotMessage(false);
      }
    }, 100);
  }

  // PHASE E — window resize listener for viewport-tier reactivity.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // PHASE E + Sawil bugfix — visualViewport listener for iOS / Android
  // keyboard handling, BUT only react to LARGE viewport changes (keyboard
  // open/close, > 200 px). iOS Safari fires `resize` on every URL-bar
  // show/hide, which would otherwise cause a scroll-bouncing loop while the
  // bot is responding. We trust CSS `dvh` for small changes.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const baseline = window.innerHeight;
    let raf: number | null = null;
    const update = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const diff = baseline - vv.height;
        if (diff > 200) {
          // Keyboard almost certainly open — switch to concrete px height.
          setVisualViewportHeight(vv.height);
        } else {
          // Trivial viewport change (URL bar / pinch) — let CSS dvh handle it.
          setVisualViewportHeight((cur) => (cur === undefined ? cur : undefined));
        }
      });
    };
    update();
    vv.addEventListener('resize', update);
    return () => {
      vv.removeEventListener('resize', update);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  // PHASE E + Sawil bugfix — scroll dispatch runs ONLY on `messages` change,
  // NOT on `isTyping` transitions. Typing indicator appearing/disappearing
  // must never cause a scroll (it was the source of the up-down bouncing
  // Sawil reported). The typing indicator itself is rendered inline; the
  // scroll position is unaffected when it appears or disappears.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    const cause: 'user_sent' | 'bot_responded' =
      last.sender === 'user' ? 'user_sent' : 'bot_responded';
    const action = decideScrollAction({
      cause,
      userPinnedUp: userPinnedUpRef.current,
      isTyping: false, // typing indicator is irrelevant to scroll decision
    });
    if (action === 'follow') {
      // User-initiated → instant; bot response → smooth.
      scrollToBottom(cause !== 'user_sent');
      setHasNewBotMessage(false);
    } else if (action === 'show_new_indicator') {
      setHasNewBotMessage(true);
    }
  }, [messages, scrollToBottom]);

  // PHASE E — collapse the persistent disclosure band after the first user
  // turn. Senior can still expand by tapping. Lets messages take more
  // vertical real estate after they've started typing.
  useEffect(() => {
    const userTurns = messages.filter((m) => m.sender === 'user').length;
    if (shouldCollapseDisclosure(userTurns) && !disclosureCollapsed) {
      setDisclosureCollapsed(true);
    }
  }, [messages, disclosureCollapsed]);

  // Sawil bugfix — gated GHL submit. POST to /api/submit-lead ONLY when
  // (a) engine flagged needsHuman, AND (b) we have both a name and a
  // phone in state. Single-fire per session via hasSubmittedRef. Removes
  // the empty-lead bug that produced "Su mensaje fue preparado, pero no
  // pudimos confirmar el envío" + the call button before contact existed.
  useEffect(() => {
    if (hasSubmittedRef.current) return;
    if (!state.needsHuman) return;
    if (!state.name) return;
    if (!state.phoneNumber) return;
    if (submitState !== 'idle') return;
    hasSubmittedRef.current = true;
    // Brief delay so the bot's "thank you" bubble finishes paint first.
    const timer = setTimeout(() => {
      escalateHandlerRef.current?.(state, messages);
    }, 600);
    return () => clearTimeout(timer);
  }, [state, messages, submitState]);

  // Sawil bugfix — world-class CS rep: after the GHL POST lands successfully,
  // ask "anything else I can help with?" so the user doesn't get bounced to
  // the phone number with no closing. Fires ONCE per successful submit.
  const askedFollowupRef = useRef(false);
  useEffect(() => {
    if (submitState !== 'submitted') return;
    if (askedFollowupRef.current) return;
    askedFollowupRef.current = true;
    const followupLang = state.language || pageLang;
    const followup = followupLang === 'es'
      ? 'Antes de cerrar — ¿hay alguna otra inquietud con la que le pueda ayudar hoy?'
      : 'Before we close — is there anything else I can help with today?';
    const timer = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: 'followup-' + Date.now(),
          text: followup,
          sender: 'bot',
          timestamp: new Date(),
        },
      ]);
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitState]);

  // V28 — Language sync: if user changes the global site language BEFORE
  // selecting bot language, the welcome message updates to match the new
  // page language. Once bot language is locked, this no-ops.
  useEffect(() => {
    if (state.step !== 'asking_language' || state.language) return;
    if (messages.length === 0) return;
    setMessages([{
      id: 'welcome-' + Date.now(),
      text: pageLang === 'es'
        ? '¡Hola! ¿Prefiere español o inglés?'
        : 'Hi. Do you prefer English or Spanish?',
      sender: 'bot',
      timestamp: new Date(),
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLang]);

  // Bilingual welcome on mount + PHASE 9E returning-visitor greeting
  useEffect(() => {
    if (messages.length === 0) {
      // Check persistent memory for returning visitor.
      const mem = readVisitorMemory();
      const lang: 'en' | 'es' = (initialLanguage || mem?.language || (pageLang === 'es' ? 'es' : 'en')) as 'en' | 'es';
      const returning = returningVisitorGreeting(mem, lang);
      const welcome = returning
        ? returning
        : (lang === 'es'
            ? `${officeStatus.greetingEs}. ¿Prefiere español o inglés?`
            : `${officeStatus.greetingEn}. Do you prefer English or Spanish?`);
      setMessages([{
        id: 'welcome',
        text: welcome,
        sender: 'bot',
        timestamp: new Date(),
      }]);
      if (initialLanguage) {
        setTimeout(() => handleLanguageSelect(initialLanguage), 50);
      } else if (mem?.language) {
        // Returning visitor — skip language chip step.
        setTimeout(() => handleLanguageSelect(mem.language as 'en' | 'es'), 80);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PHASE 9E — persist captured fields to localStorage for next visit
  useEffect(() => {
    if (state.name || state.zipCode || state.state || state.language) {
      writeVisitorMemory({
        name: state.name,
        zip: state.zipCode,
        state: state.state,
        language: state.language as 'en' | 'es' | undefined,
        lastTopic: state.serviceCategory,
      });
    }
  }, [state.name, state.zipCode, state.state, state.language, state.serviceCategory]);

  const getTypingText = () => {
    if (!state.language) return 'Typing…';
    return state.language === 'es' ? 'Clara está escribiendo' : 'Clara is typing';
  };

  // ── Default GHL escalation bridge ──
  async function defaultEscalate(s: ConversationState, msgs: Message[]) {
    if (submitState !== 'idle') return;
    setSubmitState('submitting');
    try {
      // V25 — PHI scrub safety: transcript built from state.messages (which
      // detectPHILeak scrubs) NOT from msgs (UI list). Fallback to msgs if
      // state.messages absent.
      const sourceMsgs = (s.messages && s.messages.length > 0)
        ? s.messages.map((m) => ({ sender: m.role === 'bot' ? 'bot' : 'user', text: m.content }))
        : msgs.map((m) => ({ sender: m.sender, text: m.text }));
      // PHASE F — build the advisor-readable note via the dedicated helper.
      // GHL bridge contract is UNCHANGED: payload field names + types stay
      // exactly as they were. Only the CONTENT of `lead_notes`, `tags`,
      // `interest_type`, and `bot_transcript_summary` is reshaped to be
      // useful to the advisor opening the GHL contact.
      const note = buildLeadNote({
        state: s,
        transcript: sourceMsgs.map((m) => ({
          sender: m.sender as 'user' | 'bot',
          text: m.text,
        })),
      });
      const payload = {
        source: 'customer_service_bot',
        page_url: typeof window !== 'undefined' ? window.location.href : '',
        form_name: 'ClearPoint Support Guide',
        first_name: s.name || '',
        last_name: '',
        full_name: s.name || '',
        phone: s.phoneNumber || '',
        email: s.email || '',
        zip_code: s.zipCode || '',
        // PHASE D — canonical mapping. en→English, es→Spanish, null→Unknown.
        // Never hard-codes English when state.language is unknown.
        preferred_language: note.preferredLanguage,
        medicare_status: '',
        // PHASE F — controlled interest_type label (advisor-readable).
        interest_type: note.interestType,
        best_time_to_contact: '',
        // PHASE F + 9A — consent NOT collected by this bot; never claim 'yes'.
        // This is INTENTIONAL TCPA safety. Sawil's GHL workflows must NOT
        // auto-dial leads with consent_to_contact=false; they should queue
        // for a human licensed advisor to call back manually.
        // If we ever add an explicit in-chat consent question, also persist
        // the TCPA receipt (see src/lib/disclaimerVersion.ts buildConsentReceipt).
        consent_to_contact: false,
        consent_text: '',
        // PHASE F — advisor-friendly note (top) + machine fields + transcript.
        lead_notes: note.noteText,
        // PHASE F — short scannable summary for GHL list view.
        bot_transcript_summary: `${s.language === 'es' ? 'ES' : 'EN'} · ${note.serviceCategory} · ${note.customerStatus} · ${note.urgency.toLowerCase()} · stage=${note.recommendedStage} · conf=${note.confidenceScore}`,
        // PHASE F — controlled tag vocabulary (8 tags from leadNoteBuilder).
        tags: note.tags.filter(Boolean).slice(0, 20),
        created_at: new Date().toISOString(),
        derived_state: s.state || '',
        website_url: '',
      };
      const ok = await submitLeadToGHL(payload as any);
      setSubmitState(ok ? 'submitted' : 'failed');
    } catch {
      setSubmitState('failed');
    }
  }

  const escalateHandler = onEscalate || defaultEscalate;
  // Keep the ref in sync with the latest escalateHandler so the gated-submit
  // effect (defined earlier) can call it without a forward-declaration error.
  escalateHandlerRef.current = escalateHandler;

  async function handleSendMessage(
    text: string,
    meta?: { source?: 'chip' | 'text' | 'system'; intentHint?: string },
  ) {
    if (!text.trim() || isTyping) return;
    // PHASE 11 — Safety router runs BEFORE all routing (outer + engine).
    // Federal liability table-stakes: 988 crisis / 911 emergency must
    // short-circuit Clara's entire pipeline, mirror of Zara's wiring.
    const safety = detectSafetyTrigger(text);
    if (safety.action !== 'none') {
      const reply = outerState.language === 'es' ? safety.responseEs : safety.responseEn;
      pushUserMessageDirect(text.trim());
      setInputValue('');
      pushBotMessageDirect(reply);
      return;
    }
    // PHASE 10 — When outer flow is in progress, route text inputs there
    // instead of feeding the existing engine. Engine only takes over for
    // Path B qualified prospects (outerInProgress=false).
    if (outerInProgress) {
      const trimmed = text.trim();
      const isEs = outerState.language === 'es';
      // PHASE 11.1 — Natural-language path inference. User typed freely;
      // Clara silently classifies and asks ONE natural follow-up.
      if (outerState.step === 'path_select') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const inferred = inferInitialPath(trimmed);
        if (inferred === 'A') {
          setOuterState((s) => ({ ...s, path: 'A', step: 'A_collect_identity', problemSummary: trimmed }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Claro, puedo ayudarle con eso. Para proteger su privacidad, ¿me comparte su nombre completo y los últimos 4 dígitos del teléfono que tenemos registrado?'
            : 'Of course, I can help. To protect your privacy, may I have your full name and the last 4 digits of the phone we have on file?'), 350);
          return;
        }
        if (inferred === 'C') {
          setOuterState((s) => ({ ...s, path: 'C', step: 'C_resources_shown', problemSummary: trimmed }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Ese tema no parece ser una especialidad de Clear Point. Si su pregunta es sobre Medicare, puedo orientarle; si no, le sugiero algunos recursos:\n\n• Medicare.gov o 1-800-MEDICARE\n• Su SHIP local (shiphelp.org)\n• Para Medicaid: HRA u oficina estatal\n\n¿Quiere que un asesor de Clear Point le contacte sobre Medicare?'
            : 'That topic does not seem to be a Clear Point specialty. If your question is about Medicare, I can guide you; otherwise, here are some resources:\n\n• Medicare.gov or 1-800-MEDICARE\n• Your local SHIP (shiphelp.org)\n• For Medicaid: HRA or your state office\n\nWould you like a Clear Point advisor to contact you about Medicare?'), 350);
          return;
        }
        // Ambiguous — single natural follow-up
        setOuterState((s) => ({ ...s, step: 'awaiting_client_check', problemSummary: trimmed }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? 'Claro, puedo orientarle. Una pregunta breve: ¿es cliente actual de Clear Point, o todavía está explorando opciones?'
          : 'I can help with that. Quick question: are you a current Clear Point client, or are you still exploring options?'), 350);
        return;
      }
      // After ambiguous question — infer A or B from yes/no
      if (outerState.step === 'awaiting_client_check') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        if (inferYesClient(trimmed)) {
          setOuterState((s) => ({ ...s, path: 'A', step: 'A_collect_identity' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Perfecto. Para proteger su privacidad, ¿me comparte su nombre completo y los últimos 4 dígitos del teléfono que tenemos registrado?'
            : 'Got it. To protect your privacy, may I have your full name and the last 4 digits of the phone we have on file?'), 350);
        } else {
          setOuterState((s) => ({ ...s, path: 'B', step: 'B_q_medicare' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Con gusto le oriento. Para guiarle correctamente, ¿ya tiene Medicare Parte A y Parte B activos, o está cerca de cumplir 65?'
            : 'Glad to help. To guide you correctly, do you already have Medicare Parts A and B, or are you near turning 65?'), 350);
        }
        return;
      }
      // Path B free-text qualification
      if (outerState.step === 'B_q_medicare') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const ms = inferMedicareStatus(trimmed);
        setOuterState((s) => ({ ...s, medicareStatus: ms, step: 'B_q_state' }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? '¿En qué estado vive?'
          : 'Which state do you live in?'), 300);
        return;
      }
      if (outerState.step === 'B_q_state') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const st = inferStateFromText(trimmed);
        setOuterState((s) => ({ ...s, state: st }));
        if (st === 'FL') {
          setOuterState((s) => ({ ...s, step: 'C_fl_offer', path: 'C' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Actualmente Clear Point está priorizando servicio en NY, NJ y CT. Para información oficial puede visitar Medicare.gov o contactar SHIP en su estado. ¿Desea que Clear Point le contacte cuando el servicio esté disponible en su área?'
            : 'Clear Point is currently prioritizing service in NY, NJ, and CT. For official information you can visit Medicare.gov or contact SHIP in your state. Would you like Clear Point to contact you when service becomes available in your area?'), 350);
          return;
        }
        if (st === 'other') {
          setOuterState((s) => ({ ...s, step: 'C_resources_shown', path: 'C', outOfScopeCategory: 'outside_state' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Actualmente Clear Point sirve NY, NJ y CT. Para Medicare en su estado, su SHIP local puede ayudarle (shiphelp.org). ¿Aun así desea que Clear Point le contacte?'
            : 'Clear Point currently serves NY, NJ, and CT. For Medicare in your state, your local SHIP can help (shiphelp.org). Would you still like Clear Point to contact you?'), 350);
          return;
        }
        setOuterState((s) => ({ ...s, step: 'B_q_topic' }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? '¿Sobre qué tema le orientamos? Por ejemplo: revisión de plan, factura, doctor o medicamentos.'
          : 'What can we guide you on? For example: plan review, billing, doctor, or medications.'), 300);
        return;
      }
      if (outerState.step === 'B_q_topic') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const tp = inferTopic(trimmed);
        const newState: ClaraOuterState = { ...outerState, topic: tp, step: 'B_pitch' };
        setOuterState(newState);
        if (!isQualifiedProspect(newState)) {
          setOuterState((s) => ({ ...s, step: 'C_resources_shown', path: 'C' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Gracias. Para esta situación específica, le sugiero Medicare.gov o su SHIP local. ¿Aun así desea que Clear Point le contacte?'
            : 'Thank you. For this specific situation, I suggest Medicare.gov or your local SHIP. Would you still like Clear Point to contact you?'), 350);
          return;
        }
        setTimeout(() => pushBotMessageDirect(isEs
          ? 'Gracias. En Clear Point somos brokers de Medicare independientes y licenciados. Tres puntos breves: nuestro servicio no tiene costo para usted; un asesor licenciado revisa su situación; no le pasamos entre call centers. ¿Le parece bien que le tome su nombre y teléfono para que un asesor le contacte?'
          : "Thank you. At Clear Point we are independent licensed Medicare brokers. Three quick points: our service is at no cost to you; a licensed advisor reviews your situation; you are not passed between call centers. Would it be alright to take your name and phone so an advisor can reach out?"), 400);
        return;
      }
      // Path A — identity collection (name + last4)
      if (outerState.step === 'A_collect_identity') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        await handleAIdentitySubmit(trimmed);
        return;
      }
      // Path A matched — collect topic summary, then submit existing_client_inquiry
      if (outerState.step === 'A_matched_collect_topic') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const phoneFromMatch = ''; // we don't expose phone; advisor knows it
        await submitOuterLead({ phone: phoneFromMatch, summary: trimmed });
        setOuterState((s) => ({ ...s, problemSummary: trimmed, step: 'A_done' }));
        return;
      }
      // Path A unmatched — collect phone + summary
      if (outerState.step === 'A_unmatched_collect_topic') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        // Heuristic: if text contains a phone-like sequence, treat as phone+summary combined.
        const phoneMatch = trimmed.match(/\+?[\d\s().-]{7,}/);
        const phone = phoneMatch ? phoneMatch[0].replace(/\D+/g, '').slice(-10) : '';
        const summary = phoneMatch ? trimmed.replace(phoneMatch[0], '').trim() : trimmed;
        if (!phone || phone.length < 10) {
          pushBotMessageDirect(outerState.language === 'es'
            ? 'Necesito un número de teléfono de 10 dígitos. Por ejemplo: "(917) 555-1234 — mi factura subió".'
            : 'I need a 10-digit phone number. For example: "(917) 555-1234 — my bill went up".');
          return;
        }
        await submitOuterLead({ phone, summary });
        setOuterState((s) => ({ ...s, phone, problemSummary: summary, step: 'A_done' }));
        return;
      }
      // Path C opt-in capture — name + phone + summary
      if (outerState.step === 'C_optin_capture') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const phoneMatch = trimmed.match(/\+?[\d\s().-]{7,}/);
        const phone = phoneMatch ? phoneMatch[0].replace(/\D+/g, '').slice(-10) : '';
        const nameAndSummary = phoneMatch ? trimmed.replace(phoneMatch[0], '').trim() : trimmed;
        if (!phone || phone.length < 10) {
          pushBotMessageDirect(outerState.language === 'es'
            ? 'Necesito su nombre, un teléfono de 10 dígitos y un resumen breve.'
            : 'I need your name, a 10-digit phone, and a brief summary.');
          return;
        }
        // Try to extract name as the first 2 capitalized tokens.
        const nameMatch = nameAndSummary.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñ' .-]+?)(?:[,.\-—]|$)/);
        const fullName = nameMatch ? nameMatch[1].trim() : nameAndSummary.split(/\s{2,}|[,.\-—]/)[0] || '';
        setOuterState((s) => ({ ...s, fullName, phone, problemSummary: nameAndSummary }));
        await submitOuterLead({ phone, summary: nameAndSummary });
        setOuterState((s) => ({ ...s, step: 'C_done' }));
        return;
      }
      // For other outer-flow steps, ignore free-text (chips drive these).
      return;
    }
    // WAVE 39 — synchronous re-entrancy guard. React state hasn't flushed
    // between two near-simultaneous clicks; the ref has.
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: text.trim(),
      sender: 'user',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      const typingDelay = Math.min(300 + text.length * 10, 800);
      await new Promise((resolve) => setTimeout(resolve, typingDelay));

      let response = '';
      let newState = state;
      let needsHuman = false;
      try {
        // PHASE A7 — async LLM brain (Claude Haiku) + structural fallback.
        // The async wrapper handles ZIP / name+phone / crisis / closing
        // synchronously, then calls the LLM for topic conversation. If
        // the LLM call fails, it falls back to the legacy regex engine.
        const result = await processMessageAsync(text, state, meta);
        response = result.response;
        newState = result.newState;
        needsHuman = result.needsHuman;
      } catch {
        response = state.language === 'es'
          ? 'Algo salió mal, pero sigo aquí. Por favor intente de nuevo.'
          : "Something went wrong, but I'm still here. Please try again.";
      }
      // Wave 21 — final safety guard. Never let "undefined" / "null" / "NaN"
      // reach the user, even if a template slipped through.
      response = sanitizeResponse(response, (newState.language || state.language) === 'es');

      // Sync page-level language when chip selection occurs.
      // PHASE 8 — capture the CS bot viewport position before the global
      // re-render (Header/Hero/Footer text lengths differ between EN/ES,
      // which would otherwise push the bot down the page visually) and
      // restore it via scrollBy after React commits.
      if (newState.language && newState.language !== state.language) {
        const botEl = typeof document !== 'undefined'
          ? document.getElementById('customer-service-bot')
          : null;
        const beforeTop = botEl?.getBoundingClientRect().top ?? null;
        setLang(newState.language);
        if (botEl && beforeTop !== null) {
          requestAnimationFrame(() => {
            const afterTop = botEl.getBoundingClientRect().top;
            const delta = afterTop - beforeTop;
            if (Math.abs(delta) > 1) {
              window.scrollBy({ top: delta, behavior: 'auto' });
            }
          });
        }
      }

      setState(newState);
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response,
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);

      // PHASE A16 — SOA token request side-effect.
      // When the engine signals soaPending and the lead has name+phone,
      // request a signing token and append a follow-up bot message
      // with the link the user must click to sign the SOA.
      if (newState.soaPending && !newState.soaToken && newState.name && newState.phoneNumber) {
        // PHASE 6 — 12s timeout to prevent stuck UI on bad mobile networks.
        const controller = new AbortController();
        const soaTimer = setTimeout(() => controller.abort(), 12_000);
        try {
          const r = await fetch('/api/soa-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            signal: controller.signal,
            body: JSON.stringify({
              fullName: newState.name,
              phone: newState.phoneNumber,
              email: newState.email || '',
              zip: newState.zipCode || '',
              language: newState.language || 'es',
              leadSource: 'customer_service',
            }),
          });
          clearTimeout(soaTimer);
          if (r.ok) {
            const data = await r.json();
            const soaUrl = window.location.origin + (data.soaUrl || `/soa/${data.token}`);
            setState((prev) => ({ ...prev, soaToken: data.token, soaUrl }));
            const isEs = (newState.language || 'es') === 'es';
            const linkMsg: Message = {
              id: (Date.now() + 2).toString(),
              text: isEs
                ? `🔒 **Firmar Scope of Appointment**\n\n${soaUrl}\n\n(El enlace es seguro y expira en 24 horas. Toma 60 segundos.)`
                : `🔒 **Sign Scope of Appointment**\n\n${soaUrl}\n\n(Secure link, expires in 24 hours. Takes 60 seconds.)`,
              sender: 'bot',
              timestamp: new Date(),
            };
            setMessages((prev) => [...prev, linkMsg]);
          }
        } catch (e) {
          clearTimeout(soaTimer);
          console.warn('[CSB] SOA token fetch failed', e);
        }
      }

      if (typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)')?.matches) {
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }

      // Sawil bugfix — DO NOT fire escalateHandler from here. A dedicated
      // useEffect below polls state.needsHuman + state.name + state.phoneNumber
      // and POSTs to GHL exactly once when all three are present.
      // Touch the unused params so the lint rule stays quiet.
      void needsHuman; void userMessage; void botMessage;
    } finally {
      // Always clear, even if anything above throws synchronously after the
      // outer try started. Guarantees the input never stays frozen.
      setIsTyping(false);
      isSendingRef.current = false;
    }
  }

  // ── PHASE 10 — Clara outer-flow helpers (Path A/B/C above the engine) ──────

  function pushBotMessageDirect(text: string) {
    setMessages((prev) => [...prev, {
      id: 'bot-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
      text,
      sender: 'bot',
      timestamp: new Date(),
    }]);
  }

  function pushUserMessageDirect(text: string) {
    setMessages((prev) => [...prev, {
      id: 'usr-' + Date.now() + '-' + Math.floor(Math.random() * 9999),
      text,
      sender: 'user',
      timestamp: new Date(),
    }]);
  }

  // Path B pitch confirm (Yes → engine takes over for capture; No → goodbye).
  function handleBPitchAccept(yes: boolean) {
    const isEs = outerState.language === 'es';
    pushUserMessageDirect(yes
      ? (isEs ? 'Sí, tomar mi información' : 'Yes, take my info')
      : (isEs ? 'No, gracias' : 'No, thanks'));
    if (!yes) {
      setOuterState((s) => ({ ...s, step: 'B_done' }));
      setTimeout(() => pushBotMessageDirect(isEs
        ? 'Entendido, sin presión. Si cambia de opinión, puede llamar al 1-866-310-8702 o regresar aquí.'
        : 'Understood, no pressure. If you change your mind, you can call 1-866-310-8702 or come back anytime.'), 300);
      return;
    }
    // Qualified prospect accepted — delegate to existing engine for capture.
    setOuterState((s) => ({ ...s, step: 'B_engine_engaged' }));
    setOuterInProgress(false);
    // Trigger the engine's language confirmation (which starts the existing
    // name/ZIP/topic flow). Feed the language word the engine expects.
    setTimeout(() => handleSendMessage(isEs ? 'español' : 'english'), 200);
  }

  // Path C opt-in handler.
  async function handleCOptin(optIn: boolean) {
    const isEs = outerState.language === 'es';
    pushUserMessageDirect(optIn
      ? (isEs ? 'Sí, contáctenme' : 'Yes, contact me')
      : (isEs ? 'No, gracias' : 'No, thanks'));
    if (!optIn) {
      setOuterState((s) => ({ ...s, step: 'C_done' }));
      setTimeout(() => pushBotMessageDirect(isEs
        ? 'Gracias por consultarnos. Espero que los recursos sean útiles.'
        : 'Thank you for reaching out. I hope the resources are helpful.'), 300);
      return;
    }
    setOuterState((s) => ({ ...s, step: 'C_optin_capture' }));
    setTimeout(() => pushBotMessageDirect(isEs
      ? '¿Puede compartir su nombre completo, teléfono y un resumen breve del tema?'
      : 'May I have your full name, phone, and a brief summary of the topic?'), 300);
  }

  // Path A identity capture: parses single text input "Name | last4" or split flow.
  async function handleAIdentitySubmit(rawText: string) {
    const isEs = outerState.language === 'es';
    // Try to extract both name and last 4 from one input.
    const last4Match = rawText.match(/\b(\d{4})\b/);
    const last4 = last4Match ? last4Match[1] : '';
    const nameText = rawText.replace(/\b\d{4,}\b/g, '').replace(/\s{2,}/g, ' ').trim();
    const nameCheck = validateFullName(nameText);
    if (!nameCheck.ok || !last4) {
      pushBotMessageDirect(isEs
        ? 'Necesito su nombre completo y los últimos 4 dígitos del teléfono. Por ejemplo: "María García 5678".'
        : 'I need your full name and the last 4 digits of your phone. For example: "John Smith 5678".');
      return;
    }
    const fullName = nameCheck.cleaned!;
    setOuterState((s) => ({ ...s, fullName, last4Phone: last4, step: 'A_verifying' }));
    pushBotMessageDirect(isEs ? 'Verificando su caso, un momento…' : 'Verifying your case, one moment…');
    setIsTyping(true);

    // Call /api/lookup-client with timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const r = await fetch('/api/lookup-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        signal: controller.signal,
        body: JSON.stringify({ fullName, last4Phone: last4 }),
      });
      clearTimeout(timer);
      setIsTyping(false);
      const data = await r.json().catch(() => null);
      if (data && data.found) {
        const advisorName: string | null = data.advisorName || null;
        setOuterState((s) => ({
          ...s,
          verifiedContactId: data.contactId,
          assignedUserId: data.assignedUserId,
          assignedAdvisorName: advisorName || undefined,
          step: 'A_matched_collect_topic',
        }));
        const advBit = advisorName ? `, ${advisorName}` : '';
        pushBotMessageDirect(isEs
          ? `Encontré su caso. La voy a conectar con su asesor asignado${advBit}. ¿En qué le puedo ayudar hoy?`
          : `I found your case. I'll connect you with your assigned advisor${advBit}. How can I help you today?`);
      } else {
        setOuterState((s) => ({ ...s, step: 'A_unmatched_collect_topic' }));
        pushBotMessageDirect(isEs
          ? 'No pude verificar el caso automáticamente. Para proteger su privacidad, voy a pedir que un asesor de Clear Point revise su caso y le devuelva la llamada. ¿Puede compartir su número de teléfono y un resumen breve del tema?'
          : 'I could not verify your case automatically. To protect your privacy, I will ask a Clear Point advisor to review your case and call you back. May I have your phone number and a brief summary of the topic?');
      }
    } catch {
      clearTimeout(timer);
      setIsTyping(false);
      setOuterState((s) => ({ ...s, step: 'A_unmatched_collect_topic' }));
      pushBotMessageDirect(isEs
        ? 'No pude verificar el caso ahora mismo. Voy a pedir que un asesor revise su caso. ¿Su teléfono y un resumen breve del tema?'
        : 'I could not verify the case right now. I will ask an advisor to review. Could I have your phone and a brief summary?');
    }
  }

  // Path A/C final capture submit.
  async function submitOuterLead(extras: { phone?: string; summary?: string } = {}) {
    const isEs = outerState.language === 'es';
    setSubmitState('submitting');
    try {
      const receipt = await buildConsentReceipt(outerState.language);
      const merged: ClaraOuterState = {
        ...outerState,
        phone: extras.phone || outerState.phone || '',
        problemSummary: extras.summary || outerState.problemSummary || '',
      };
      const payload = buildGhlPayload(merged, {
        consentText: receipt.consentText,
        consentReceiptHash: receipt.consentTextHash,
        disclaimerVersion: receipt.disclaimerVersion,
        userAgent: receipt.userAgent,
        problemSummary: merged.problemSummary,
      });
      const ok = await submitLeadToGHL({
        source: 'clara_outer_flow',
        page_url: typeof window !== 'undefined' ? window.location.href : '',
        form_name: 'ClearPoint Clara Filter',
        ...payload,
      } as unknown as Parameters<typeof submitLeadToGHL>[0]);
      setSubmitState(ok ? 'submitted' : 'failed');
      if (ok) {
        const closingEs = officeStatus.isOpen
          ? 'Gracias. Su información fue enviada. Si prefiere hablar ahora, puede llamar al 1-866-310-8702. De lo contrario, un asesor le contactará pronto.'
          : 'Gracias. Su información fue enviada. Ahora estamos fuera de horario; un asesor le devolverá la llamada el próximo día laboral.';
        const closingEn = officeStatus.isOpen
          ? 'Thank you. Your information was sent. If you prefer to speak now, you can call 1-866-310-8702. Otherwise, an advisor will contact you soon.'
          : 'Thank you. Your information was sent. We are currently after hours; an advisor will call you back on the next business day.';
        setTimeout(() => pushBotMessageDirect(isEs ? closingEs : closingEn), 200);
      }
    } catch {
      setSubmitState('failed');
    }
  }

  function handleLanguageSelect(lang: Language) {
    if (!lang) return;
    // PHASE 10 — instead of feeding 'english/español' straight into the engine,
    // we ask the path_select question. The engine is only engaged later for
    // Path B qualified prospects.
    setLang(lang);
    setState((prev) => ({ ...prev, language: lang }));
    setOuterState((s) => ({ ...s, language: lang, step: 'path_select' }));
    const isEs = lang === 'es';
    pushUserMessageDirect(isEs ? 'Español' : 'English');
    setTimeout(() => pushBotMessageDirect(isEs
      ? 'Hola, soy Clara. Estoy aquí para ayudarle con preguntas de servicio, cobertura o seguimiento con Clear Point. ¿En qué puedo ayudarle hoy?'
      : "Hi, I'm Clara. I'm here to help with service questions, coverage concerns, or follow-up with Clear Point. How can I help today?"), 300);
  }

  function resetConversation() {
    // PHASE E — replaced window.confirm() with an in-chat modal that fits
    // 320 px viewports and shows visible buttons. The modal is rendered
    // inside the chat surface (see JSX below).
    const hasMeaningfulConversation = messages.length > 2
      || messages.some((m) => m.sender === 'user');
    if (hasMeaningfulConversation) {
      setShowResetConfirm(true);
      return;
    }
    // Nothing meaningful to lose → reset immediately.
    performReset();
  }

  function performReset() {
    setShowResetConfirm(false);
    setState(createInitialState());
    setSubmitState('idle');
    setHasNewBotMessage(false);
    setDisclosureCollapsed(false);
    userPinnedUpRef.current = false;
    // Sawil bugfix — clear the single-fire submit + follow-up guards so the
    // next conversation can submit again and ask the follow-up question.
    hasSubmittedRef.current = false;
    askedFollowupRef.current = false;
    setMessages([{
      id: 'welcome-' + Date.now(),
      text: "Hi, I'm the ClearPoint Support Guide. I can help organize questions about Medicare bills, letters, coverage, medications, doctors, enrollment, or cost help.\n\nHola, soy la Guía de Soporte de ClearPoint. Puedo ayudarle a organizar preguntas sobre facturas, cartas, cobertura, medicamentos, doctores, inscripción o ayudas de costo.\n\nWhich language do you prefer? ¿Qué idioma prefiere?",
      sender: 'bot',
      timestamp: new Date(),
    }]);
  }

  function handleEscalateManually() {
    escalateHandler(state, messages);
  }

  const showLanguageChips = state.step === 'asking_language' && !isTyping;
  const inputDisabled = state.step === 'asking_language' || isTyping;
  const lang = state.language;
  // V30 — chrome elements follow page language until user picks bot language.
  const effectiveLang = lang || pageLang;
  const isSpanish = effectiveLang === 'es';
  // Wave 19 — recovery chips (Factura / Carta / Cobertura / Medicamentos /
  // Doctor-Proveedor / Hablar con asesor) when the engine sends them.
  const quickReplies = state.quickReplies || [];
  const showRecoveryChips = quickReplies.length > 0 && !isTyping;

  // PHASE E — viewport tier + container height. Tier picks a dvh factor and
  // pixel cap; visualViewportHeight (when present) overrides to a concrete
  // pixel value so iOS / Android keyboards do not hide the input row.
  const _vp = viewportTier(viewportWidth);
  const _containerStyle = containerHeightStyle(viewportWidth, visualViewportHeight);
  const _chipRowCls = chipRowClass(viewportWidth);
  const _safeBottom = safeAreaBottomStyle();

  return (
    // PHASE E — bound the outer chat container's height per viewport tier.
    //   xs (320-374) : 70dvh / 540 px cap
    //   sm (375-389) : 74dvh / 600 px cap
    //   md (390-429) : 74dvh / 620 px cap
    //   lg (430-767) : 76dvh / 660 px cap
    //   tablet 768+  : 78dvh / 700 px
    //   desktop 1024+: 78dvh / 720 px + max-width: 768 px
    // Body inside uses flex-1 + min-h-0 + overflow-y-auto so only the
    // message list scrolls internally.
    <div
      // PHASE E — `relative` anchors the new-message indicator + reset modal
      // to the chat container, not the whole page.
      className={`flex flex-col bg-cream-50 rounded-2xl shadow-lifted border border-cream-200 overflow-hidden mx-auto relative ${_vp.applyMaxWidth ? 'max-w-3xl' : 'max-w-full'}`}
      style={_containerStyle}
      aria-label={isSpanish ? 'Asistente de servicio al cliente' : 'Customer service assistant'}
    >
      {/* Header */}
      <header className="bg-earth-800 text-cream-50 px-4 py-3 flex items-center justify-between flex-shrink-0 gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-cream-100">
              <img
                src="/clara-avatar.jpg"
                alt="Clara"
                width="36"
                height="36"
                loading="eager"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
            {/* PHASE 9C — online status dot, premium chat signal */}
            <span aria-hidden className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-earth-800 animate-pulse-online" />
          </div>
          <div className="leading-tight min-w-0 flex-1">
            <div className="text-[15px] font-semibold truncate">
              {isSpanish ? 'Clara — Soporte Bilingüe de Clear Point' : 'Clara — Clear Point Bilingual Support'}
            </div>
            <div className="text-[11px] text-cream-200 font-normal truncate">
              {state.name && state.zipCode
                ? `${state.name} · ${state.zipCode}${state.state ? ' · ' + state.state : ''}`
                : (isSpanish ? 'Bilingüe · Servicio sin costo' : 'Bilingual · Free service')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={resetConversation}
            className="px-2.5 py-1.5 hover:bg-cream-50/10 rounded-lg transition-colors inline-flex items-center gap-1.5 text-[12px] min-h-[36px]"
            aria-label={isSpanish ? 'Empezar de nuevo' : 'Start over'}
            title={isSpanish ? 'Empezar de nuevo' : 'Start over'}
          >
            <RotateCcw className="w-4 h-4" />
            <span className="hidden sm:inline">
              {isSpanish ? 'Empezar' : 'Start over'}
            </span>
          </button>
          {state.step === 'conversation' && submitState === 'idle' && (
            <button
              onClick={handleEscalateManually}
              className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors"
              aria-label={isSpanish ? 'Hablar con un asesor' : 'Talk to an advisor'}
              title={isSpanish ? 'Hablar con un asesor' : 'Talk to an advisor'}
            >
              <User className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <div
        ref={bodyRef}
        onScroll={handleScroll}
        // Wave 33 — flex-1 + min-h-0 lets this body fill the bounded outer
        // container exactly, leaving room for header + footer + input.
        // overscroll-contain stops the body's scroll from chaining to the
        // page. min-h-0 is required on flex children for overflow to work.
        // PHASE E — aria-live polite so screen readers announce bot turns
        // but do not get spammed by typing indicator (which is aria-hidden).
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain relative"
        aria-live="polite"
        aria-atomic="false"
      >
        {/* PHASE E — persistent privacy band, collapsible after first user
            turn. Senior can tap to re-expand. Always shows a 1-line summary
            so the TPMO disclosure stays visible. */}
        {!disclosureCollapsed ? (
          <button
            type="button"
            onClick={() => setDisclosureCollapsed(true)}
            className="block w-full text-left bg-gold-100 border-b border-gold-200 px-4 py-2.5 text-[14px] leading-[1.5] text-earth-700 hover:bg-gold-200/40 transition"
            aria-label={isSpanish ? 'Colapsar aviso' : 'Collapse notice'}
          >
            <p>
              {isSpanish
                ? 'ClearPoint Senior Advisors es una agencia independiente. No estamos conectados con Medicare ni con el gobierno federal. No envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos privados aquí. Podemos ayudarle en inglés o español.'
                : 'ClearPoint Senior Advisors is an independent agency. We are not connected with Medicare or the federal government. Please do not send Medicare ID, Social Security numbers, banking information, or private medical records here. Language assistance available in English or Spanish.'}
            </p>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setDisclosureCollapsed(false)}
            className="block w-full text-left bg-gold-50 border-b border-gold-200 px-4 py-1.5 text-[12px] leading-[1.4] text-earth-600 hover:bg-gold-100 transition"
            aria-label={isSpanish ? 'Expandir aviso de privacidad' : 'Expand privacy notice'}
          >
            {isSpanish
              ? 'Agencia independiente · No envíe datos sensibles · Toque para ver detalles'
              : 'Independent agency · Do not send sensitive data · Tap for details'}
          </button>
        )}

        <div className="px-4 py-4 pb-8 space-y-3.5">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3.5 text-[16px] sm:text-[16px] leading-[1.6] whitespace-pre-wrap ${
                  m.sender === 'user'
                    ? 'bg-earth-800 text-cream-50 rounded-br-md'
                    : 'bg-white text-earth-800 shadow-xs border border-cream-200 rounded-bl-md'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {/* PHASE 11.1 — Chip menus for path_select / B qualification REMOVED.
              Clara now starts with a natural greeting and the user types freely.
              Inference happens silently in handleSendMessage. The only chips
              that remain are 2-button yes/no confirmations after natural questions:
              B_pitch accept and C opt-in (below). */}

          {/* Path B — pitch accept/reject */}
          {outerInProgress && outerState.step === 'B_pitch' && !isTyping && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => handleBPitchAccept(true)}
                className="px-5 py-3 bg-earth-800 text-cream-50 rounded-full text-[15px] font-semibold hover:bg-earth-900 transition min-h-[44px]">
                {outerState.language === 'es' ? 'Sí, tomar mi información' : 'Yes, take my info'}
              </button>
              <button onClick={() => handleBPitchAccept(false)}
                className="px-5 py-3 bg-cream-100 text-earth-700 border border-cream-300 rounded-full text-[15px] font-semibold hover:bg-cream-200 transition min-h-[44px]">
                {outerState.language === 'es' ? 'No, gracias' : 'No, thanks'}
              </button>
            </div>
          )}

          {/* Path C — opt-in offer */}
          {outerInProgress && (outerState.step === 'C_resources_shown' || outerState.step === 'C_fl_offer') && !isTyping && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => handleCOptin(true)}
                className="px-5 py-3 bg-earth-800 text-cream-50 rounded-full text-[15px] font-semibold hover:bg-earth-900 transition min-h-[44px]">
                {outerState.language === 'es' ? 'Sí, contáctenme' : 'Yes, contact me'}
              </button>
              <button onClick={() => handleCOptin(false)}
                className="px-5 py-3 bg-cream-100 text-earth-700 border border-cream-300 rounded-full text-[15px] font-semibold hover:bg-cream-200 transition min-h-[44px]">
                {outerState.language === 'es' ? 'No, gracias' : 'No, thanks'}
              </button>
            </div>
          )}

          {/* Language selection chips — only shown at step 1 */}
          {showLanguageChips && (
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                onClick={() => handleLanguageSelect('en')}
                className="px-6 py-3 bg-earth-800 text-cream-50 rounded-full text-[15px] font-semibold hover:bg-earth-900 transition shadow-sm"
              >
                English
              </button>
              <button
                onClick={() => handleLanguageSelect('es')}
                className="px-6 py-3 bg-earth-800 text-cream-50 rounded-full text-[15px] font-semibold hover:bg-earth-900 transition shadow-sm"
              >
                Español
              </button>
            </div>
          )}

          {/* PHASE E — chips. On xs (320-374) viewports they stack
              full-width (one per row). On larger viewports they wrap.
              Chip rows never overflow horizontally because the wrapper
              uses flex-wrap (md+) or flex-col (xs). */}
          {showRecoveryChips && (
            <div className={_chipRowCls} role="group" aria-label={isSpanish ? 'Opciones rápidas' : 'Quick replies'}>
              {quickReplies.map((label) => {
                const hint = lookupChipHint(label);
                return (
                  <button
                    key={label}
                    onClick={() => handleSendMessage(label, hint ? { source: 'chip', intentHint: hint } : { source: 'chip' })}
                    className={`${_vp.tier === 'phone_xs' ? 'w-full' : ''} px-4 py-2 bg-white border border-gold-300 text-earth-800 rounded-full text-[13.5px] font-semibold hover:bg-gold-100 hover:border-gold-400 transition shadow-xs min-h-[44px] break-words`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {isTyping && (
            // PHASE E — typing indicator is aria-hidden so screen readers
            // do not announce the bouncing dots / "typing…" text every
            // turn. The bubble itself is still visible to sighted users.
            <div className="flex justify-start" aria-hidden="true">
              <div className="bg-white rounded-xl px-4 py-3 shadow-xs border border-cream-200">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-earth-500 italic">{getTypingText()}</span>
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* GHL submission state */}
          {submitState === 'submitting' && (
            <div className="bg-sage-100 border border-sage-300 rounded-xl p-4 text-earth-800 text-[14px]">
              {isSpanish ? 'Enviando su caso a un asesor licenciado…' : 'Sending your case to a licensed advisor…'}
            </div>
          )}
          {submitState === 'submitted' && (
            <div className="bg-sage-100 border border-sage-300 rounded-xl p-4 space-y-1">
              <div className="font-bold text-earth-900">
                {isSpanish ? '✓ Listo. Un asesor licenciado se comunicará con usted.' : '✓ Got it. A licensed advisor will follow up.'}
              </div>
              <p className="text-earth-700 text-[13.5px]">
                {isSpanish ? 'Un asesor bilingüe revisará su caso.' : 'A bilingual advisor will review your case.'}
              </p>
            </div>
          )}
          {submitState === 'failed' && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-4 space-y-3">
              <div className="font-bold text-red-900">
                {isSpanish ? 'Su mensaje fue preparado, pero no pudimos confirmar el envío en este momento.' : 'Your message was prepared, but we could not confirm submission right now.'}
              </div>
              <a href="tel:18663108702" className="inline-flex items-center gap-1.5 px-4 py-3 bg-earth-800 text-cream-50 rounded-lg text-[14px] font-semibold min-h-[44px]">
                <Phone className="w-4 h-4" /> 1-866-310-8702
              </a>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Footer chrome — PHASE 9E swaps "Call now" for callback messaging after hours. */}
      <div className="px-3 py-2 border-t border-cream-200 flex-shrink-0 flex items-center gap-2 bg-white">
        <a
          href="tel:18663108702"
          className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors"
        >
          <Phone className="w-4 h-4" />
          {officeStatus.isOpen
            ? (isSpanish ? 'Llamar ahora' : 'Call now')
            : (isSpanish ? `Llamar (devolución ${officeStatus.nextOpenLabel})` : `Call (callback ${officeStatus.nextOpenLabel})`)}
        </a>
        <span className="text-earth-300 select-none" aria-hidden="true">·</span>
        <span className="text-[12px] text-earth-700">
          {officeStatus.isOpen
            ? (isSpanish ? 'Soporte bilingüe' : 'Bilingual support')
            : (isSpanish ? 'Fuera de horario' : 'After hours')}
        </span>
      </div>

      {/* PHASE E — "New message ↓" floating chip. Appears when the user has
          scrolled up and the bot has emitted a new message. Tapping it
          scrolls to the bottom and clears the indicator. */}
      {hasNewBotMessage && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-32 sm:bottom-28 z-10">
          <button
            type="button"
            onClick={() => {
              userPinnedUpRef.current = false;
              scrollToBottom(true);
              setHasNewBotMessage(false);
            }}
            className="px-4 py-2 bg-earth-800 text-cream-50 rounded-full text-[13px] font-semibold shadow-lifted hover:bg-earth-900 transition flex items-center gap-1.5 min-h-[40px]"
            aria-label={isSpanish ? 'Ir al mensaje más reciente' : 'Jump to latest message'}
          >
            <span>{isSpanish ? 'Nuevo mensaje' : 'New message'}</span>
            <span aria-hidden="true">↓</span>
          </button>
        </div>
      )}

      {/* PHASE E — reset confirmation modal. Replaces window.confirm() so
          that the prompt fits inside the chat surface and shows visible
          buttons on 320 px viewports. Modal is constrained to the chat
          container, not the whole page. */}
      {showResetConfirm && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-earth-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={isSpanish ? 'Confirmar empezar de nuevo' : 'Confirm start over'}
        >
          <div className="bg-white rounded-xl shadow-lifted border border-cream-200 max-w-sm w-full p-5 space-y-4">
            <div className="text-earth-900 text-[15px] leading-[1.5] font-semibold">
              {isSpanish
                ? '¿Está seguro de que quiere empezar de nuevo?'
                : 'Are you sure you want to start over?'}
            </div>
            <div className="text-earth-700 text-[13.5px] leading-[1.5]">
              {isSpanish
                ? 'Esto borrará la conversación actual.'
                : 'This will clear the current conversation.'}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-4 py-3 bg-white border border-earth-300 text-earth-800 rounded-lg text-[14px] font-semibold hover:bg-cream-100 transition min-h-[44px]"
              >
                {isSpanish ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={performReset}
                className="flex-1 px-4 py-3 bg-earth-800 text-cream-50 rounded-lg text-[14px] font-semibold hover:bg-earth-900 transition min-h-[44px]"
              >
                {isSpanish ? 'Sí, empezar de nuevo' : 'Yes, start over'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Input row */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage(inputValue);
        }}
        className="px-3 pt-2 border-t border-cream-200 flex-shrink-0 bg-white"
        style={_safeBottom}
      >
        <div className="flex gap-2 min-w-0 items-end">
          <textarea
            ref={inputRef}
            rows={1}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              // Auto-grow up to 4 lines.
              const el = e.target as HTMLTextAreaElement;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter newline (premium chat convention).
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!inputDisabled && inputValue.trim()) {
                  handleSendMessage(inputValue);
                }
              }
            }}
            placeholder={
              isSpanish
                ? state.step === 'asking_name'
                  ? 'Solo su nombre…'
                  : state.step === 'asking_zip'
                    ? '5 dígitos…'
                    : 'Escriba su mensaje…'
                : state.step === 'asking_name'
                  ? 'Just your name…'
                  : state.step === 'asking_zip'
                    ? '5 digits…'
                    : 'Type your message…'
            }
            disabled={inputDisabled}
            className="flex-1 min-w-0 px-4 py-3 bg-white border border-cream-300 rounded-lg text-base text-earth-900 placeholder:text-earth-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 min-h-[48px] disabled:bg-cream-50 disabled:text-earth-400 resize-none leading-relaxed"
            aria-label={isSpanish ? 'Escriba su mensaje' : 'Type your message'}
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={() => {
                if (voiceListening) {
                  voiceRecognizerRef.current?.stop();
                  setVoiceListening(false);
                  return;
                }
                voiceRecognizerRef.current = createVoiceRecognizer(isSpanish ? 'es' : 'en', {
                  onInterim: (t) => setInputValue(t),
                  onFinal: (t) => { setInputValue((prev) => (prev ? prev + ' ' : '') + t); },
                  onEnd: () => setVoiceListening(false),
                  onError: () => setVoiceListening(false),
                });
                voiceRecognizerRef.current?.start();
                setVoiceListening(true);
              }}
              disabled={inputDisabled}
              className={`px-3 py-3 rounded-lg transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center ${
                voiceListening
                  ? 'bg-red-500 text-cream-50 hover:bg-red-600 animate-pulse-online'
                  : 'bg-cream-100 text-earth-700 hover:bg-cream-200 border border-cream-300'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              aria-label={isSpanish ? (voiceListening ? 'Detener voz' : 'Hablar') : (voiceListening ? 'Stop voice' : 'Speak')}
              title={isSpanish ? (voiceListening ? 'Detener' : 'Hablar (dictar mensaje)') : (voiceListening ? 'Stop' : 'Speak (dictate message)')}
            >
              {voiceListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
          <button
            type="submit"
            disabled={inputDisabled || !inputValue.trim()}
            className="px-4 py-3 bg-earth-800 text-cream-50 rounded-lg hover:bg-earth-900 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            aria-label={isSpanish ? 'Enviar' : 'Send'}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default CustomerServiceBot;

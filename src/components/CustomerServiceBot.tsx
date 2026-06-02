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
import { Headphones, Phone, RotateCcw, Send, User } from 'lucide-react';

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
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Bilingual welcome on mount
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        id: 'welcome',
        text: pageLang === 'es'
          ? '¡Hola! ¿Prefiere español o inglés?'
          : 'Hi. Do you prefer English or Spanish?',
        sender: 'bot',
        timestamp: new Date(),
      }]);
      // Honor any initialLanguage prop by auto-selecting (skips chip click).
      if (initialLanguage) {
        setTimeout(() => handleLanguageSelect(initialLanguage), 50);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getTypingText = () => {
    if (!state.language) return 'Typing…';
    return state.language === 'es' ? 'Guía de Soporte está escribiendo' : 'Support Guide is typing';
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
        email: '',
        zip_code: s.zipCode || '',
        // PHASE D — canonical mapping. en→English, es→Spanish, null→Unknown.
        // Never hard-codes English when state.language is unknown.
        preferred_language: note.preferredLanguage,
        medicare_status: '',
        // PHASE F — controlled interest_type label (advisor-readable).
        interest_type: note.interestType,
        best_time_to_contact: '',
        // PHASE F — consent is NOT collected by this bot; never claim 'yes'.
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

      // Sync page-level language when chip selection occurs
      if (newState.language && newState.language !== state.language) {
        setLang(newState.language);
      }

      setState(newState);
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: response,
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);

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

  function handleLanguageSelect(lang: Language) {
    if (!lang) return;
    handleSendMessage(lang === 'en' ? 'english' : 'español');
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
          <div className="w-9 h-9 rounded-full bg-sage-300 flex items-center justify-center text-earth-900 flex-shrink-0">
            <Headphones className="w-5 h-5" />
          </div>
          <div className="leading-tight min-w-0 flex-1">
            <div className="text-[15px] font-semibold truncate">
              {isSpanish ? 'Guía de Soporte ClearPoint' : 'ClearPoint Support Guide'}
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

      {/* Footer chrome */}
      <div className="px-3 py-2 border-t border-cream-200 flex-shrink-0 flex items-center gap-2 bg-white">
        <a
          href="tel:18663108702"
          className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors"
        >
          <Phone className="w-4 h-4" />
          {isSpanish ? 'Llamar ahora' : 'Call now'}
        </a>
        <span className="text-earth-300 select-none" aria-hidden="true">·</span>
        <span className="text-[12px] text-earth-500">
          {isSpanish ? 'Soporte bilingüe' : 'Bilingual support'}
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
        <div className="flex gap-2 min-w-0">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
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
            className="flex-1 min-w-0 px-4 py-3 bg-white border border-cream-300 rounded-lg text-base text-earth-900 placeholder:text-earth-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 min-h-[48px] disabled:bg-cream-50 disabled:text-earth-400"
            aria-label={isSpanish ? 'Escriba su mensaje' : 'Type your message'}
          />
          <button
            type="submit"
            disabled={inputDisabled || !inputValue.trim()}
            className="px-4 py-3 bg-earth-800 text-cream-50 rounded-lg hover:bg-earth-900 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
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

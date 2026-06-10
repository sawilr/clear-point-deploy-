// ============================================================================
// CUSTOMER SERVICE BOT V15 — ENTERPRISE PROFESSIONAL
// Drop-in V15 architecture with ClearPoint brand palette + GHL bridge.
// State machine: language → name → ZIP → problem → conversation.
// Language is LOCKED at step 1 via chip click. Never auto-flips.
// ============================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  processMessageAsync,
  createInitialState,
  sanitizeResponse,
  type ConversationState,
  type Language,
} from '../lib/customerServiceEngine';
import { useLanguage } from '../hooks/useLanguage';
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight';
import { submitLeadToGHL } from '../lib/ghl';
// PHASE F — advisor-readable lead-note builder. Pure helper, no network.
import { buildLeadNote } from '../lib/orchestrator/leadNoteBuilder';
// PHASE E — mobile scroll + viewport-tier helpers (pure module).
import {
  decideScrollAction,
  viewportTier,
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
  validateUserPhone,
  isFakeZip,
  isQualifiedProspect,
  buildGhlPayload,
  outerStateToEngine,
  answerMetaQuestion,
  extractZip,
  inferInitialPath,
  inferYesClient,
  inferMedicareStatus,
  inferStateFromText,
  inferTopic,
} from '../lib/claraOuterFlow';
import { detectSafetyTrigger } from '../lib/safetyRouter';
// Phase A — ZIP → city/county lookup, used to answer "cuál es mi zona"
// accurately (no fabricated neighborhoods). Read-only data utility.
import { getZipInfo } from '../lib/zipLookup';

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
  // Sawil 2026-06 — page-mode renders Clara as the main panel surface
  // (fills its parent, no fixed overlay). Widget mode preserves the
  // legacy fixed-bottom overlay for backwards compatibility.
  mode?: 'page' | 'widget';
}

export function CustomerServiceBot({ onEscalate, initialLanguage, mode = 'widget' }: CustomerServiceBotProps = {}) {
  const navigate = useNavigate();
  const { lang: pageLang, setLang } = useLanguage();
  // Sawil 2026-06 — enterprise viewport handling. Hook writes the real
  // visible viewport height to CSS var `--svh` on :root (and `--kb-offset`
  // for the soft keyboard), coalesced via rAF, reacting to keyboard
  // open/close and orientation. The outer shell uses `--svh` for its
  // height — no inline state needed.
  useVisualViewportHeight();
  const [messages, setMessages] = useState<Message[]>([]);
  const [state, setState] = useState<ConversationState>(createInitialState);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  // Sawil 2026-06 — true when the chat is intentionally closed (e.g. an
  // out-of-service-area ZIP). Disables the input so we don't engage the LLM
  // (no wasted tokens). Reset by "Empezar de nuevo".
  const [chatClosed, setChatClosed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Sawil 2026-06 — idempotency guard for language selection. The mount effect
  // can auto-pick the language from returning-visitor memory AND the user can
  // tap a language chip; without this guard BOTH fire handleLanguageSelect and
  // the "Español" + welcome/ZIP message get pushed twice (the duplicate Sawil
  // saw on entry). One-and-done.
  const langSelectedRef = useRef(false);
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
        // Sawil mobile fix — long bot messages + chips below them mean that
        // pinning to scrollHeight hides the bot's text. Scroll instead so the
        // LAST message's top sits ~8 px below the chat area top. Short
        // messages still look clean (small gap below); long messages with
        // options/chips become readable from the top.
        const msgs = cc.querySelectorAll('[data-msg-id]');
        const lastMsg = msgs[msgs.length - 1] as HTMLElement | undefined;
        if (lastMsg) {
          const cRect = cc.getBoundingClientRect();
          const mRect = lastMsg.getBoundingClientRect();
          const offsetTop = mRect.top - cRect.top + cc.scrollTop;
          cc.scrollTo({ top: Math.max(0, offsetTop - 8), behavior: smooth ? 'smooth' : 'auto' });
          return;
        }
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

  // Sawil 2026-06 — visualViewport listener REMOVED. The new
  // useVisualViewportHeight() hook above writes `--svh` and `--kb-offset`
  // on :root continuously (coalesced via rAF). The outer shell consumes
  // that CSS var directly; React does not need to re-render on keyboard
  // open/close. This eliminates the bouncing-scroll loop entirely.

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
    // Sawil 2026-06: chip blocks (B_pitch, C opt-in) are siblings AFTER
    // the messages list, so toggling them via outerState.step changes the
    // scroll content height. Re-trigger scroll on those transitions too,
    // otherwise the last message ends up hidden behind chip rows.
    // Keyboard open/close no longer needs a dep here — the outer shell
    // resizes via the CSS var written by useVisualViewportHeight().
  }, [messages, outerState.step, scrollToBottom]);

  // Sawil 2026-06 — keyboard-open auto-scroll (layer 2 of the mobile fix).
  // When the mobile keyboard opens or closes, the visual viewport resizes.
  // If our input has focus (the user is typing), keep the latest message +
  // composer in view by scrolling Clara's OWN body to the bottom. The
  // .support-shell already stops the DOCUMENT from scrolling, so this is the
  // only scroll that moves — the conversation context never disappears.
  // Coalesced via rAF; gated to a focused input + not-pinned-up so it never
  // fights a user who deliberately scrolled up to re-read.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let raf: number | null = null;
    const onResize = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = null;
        if (document.activeElement === inputRef.current && !userPinnedUpRef.current) {
          scrollToBottom(false);
        }
      });
    };
    vv.addEventListener('resize', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [scrollToBottom]);

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
            ? 'Hola, soy Clara, su asistente bilingüe de Clear Point. Estoy aquí para ayudarle. ¿Prefiere español o inglés?'
            : "Hi, I'm Clara, your bilingual assistant at Clear Point. I'm here to help. Do you prefer English or Spanish?");
      setMessages([{
        id: 'welcome',
        text: welcome,
        sender: 'bot',
        timestamp: new Date(),
      }]);
      if (initialLanguage) {
        setTimeout(() => handleLanguageSelect(initialLanguage), 50);
      }
      // Sawil 2026-06 — REMOVED the returning-visitor language auto-select.
      // It made Clara "contestar sola": it picked the language from saved
      // memory and advanced PAST the chip step without the user choosing
      // anything. The language is now ALWAYS an explicit tap. Only an explicit
      // initialLanguage prop (page/URL-driven, not memory) may pre-select.
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

      // Sawil 2026-06 — User recall guard. If the user objects ("ya te di mi
      // zip", "I already gave you that") and we DO have the data, acknowledge
      // and continue from the saved value instead of re-asking.
      const ALREADY_GAVE_ZIP = /(ya (te |le |se )?(di|dije|pas[eé]|envi[eé]) (mi |el |un )?(zip|c[oó]digo|postal|codigo postal)|i (already )?gave .*(zip|postal)|told you .* zip)/i;
      if (outerState.zip && ALREADY_GAVE_ZIP.test(trimmed)) {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        // Apology + continue from saved ZIP. Advance to path_select so
        // subsequent inputs flow into normal Path A/B/C inference.
        setOuterState((s) => ({ ...s, step: 'path_select' }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? `Tiene razón, disculpe. Usaré el código postal que me compartió (${outerState.zip}). ¿En qué le puedo ayudar hoy?`
          : `You are right, my apologies. I will use the ZIP code you shared (${outerState.zip}). How can I help you today?`), 300);
        return;
      }

      // Phase A (Sawil 2026-06) — DIRECT-QUESTION PRIORITY. If the user asks
      // a meta-question (zone/area, cost, who, why-ZIP) instead of answering
      // the current intake prompt, ANSWER it first, then continue the intake
      // with one natural follow-up. Scripted intake must NOT bulldoze the
      // user's question. Runs on every outer step except the language picker.
      {
        const zipInfo = outerState.zip ? getZipInfo(outerState.zip) : null;
        const metaAnswer = answerMetaQuestion(trimmed, outerState, zipInfo, isEs);
        if (metaAnswer) {
          pushUserMessageDirect(trimmed);
          setInputValue('');
          // After answering, advance the intake by exactly ONE natural
          // question so the thread keeps moving (matches the approved flow:
          // answer the zone → ask client-vs-exploring). For mid-Path-B steps
          // we re-ask that step's own question instead of jumping.
          let followUp: string;
          if (outerState.step === 'awaiting_zip' || outerState.step === 'path_select') {
            setOuterState((s) => ({ ...s, step: 'awaiting_client_check' }));
            followUp = isEs
              ? 'Ahora, para orientarle mejor, ¿es cliente actual de Clear Point o está explorando opciones?'
              : 'Now, to guide you better, are you a current Clear Point client, or are you exploring options?';
          } else if (outerState.step === 'awaiting_client_check') {
            followUp = isEs
              ? '¿Es cliente actual de Clear Point, o todavía está explorando sus opciones?'
              : 'Are you a current Clear Point client, or are you still exploring your options?';
          } else if (outerState.step === 'B_q_medicare') {
            followUp = isEs
              ? '¿Ya tiene Medicare Parte A y Parte B activos, o está cerca de cumplir 65?'
              : 'Do you already have Medicare Parts A and B, or are you near turning 65?';
          } else if (outerState.step === 'B_q_state') {
            followUp = isEs ? '¿En qué estado vive?' : 'Which state do you live in?';
          } else if (outerState.step === 'B_q_topic') {
            followUp = isEs ? '¿Sobre qué tema le orientamos?' : 'What can we guide you on?';
          } else {
            followUp = isEs ? '¿En qué le puedo ayudar?' : 'How can I help?';
          }
          pushBotMessageDirect(`${metaAnswer}\n\n${followUp}`);
          return;
        }
      }

      // Stage 2a (Sawil 2026-06) — THE LLM NOW LEADS after language. The first
      // turn after the welcome still tries to capture a ZIP (to identify the
      // service zone), but it is NO LONGER the front gate to a scripted A/B/C
      // gauntlet. Three outcomes, all of which END with the LLM in control:
      //   (a) valid real ZIP → store zip+state, hydrate engine, hand off; the
      //       user's NEXT message goes to the LLM.
      //   (b) fake ZIP → graceful Stage-1 re-ask (max 2), then hand off.
      //   (c) no ZIP (user described their situation) → hand off to the LLM
      //       NOW and process THIS message through the engine so Clara engages
      //       with the actual situation instead of running a checklist.
      if (outerState.step === 'awaiting_zip') {
        setInputValue('');
        const zipResult = extractZip(trimmed);
        if (zipResult) {
          pushUserMessageDirect(trimmed);
          const { zip, state } = zipResult;
          // Stage 1 — reject obvious fake ZIPs (00000, 12345, 99999, …) using
          // the shared isFakeZip() helper. Re-ask gracefully up to 2 times,
          // then proceed without trapping the user (these are seniors).
          if (isFakeZip(zip)) {
            const attempts = (outerState.zipAttempts || 0) + 1;
            if (attempts < 2) {
              setOuterState((s) => ({ ...s, zipAttempts: attempts }));
              setTimeout(() => pushBotMessageDirect(isEs
                ? 'Ese código postal no parece válido. ¿Me podría confirmar su código postal real de 5 dígitos? Así puedo identificar su zona correctamente.'
                : "That ZIP code doesn't look quite right. Could you confirm your real 5-digit ZIP code? That way I can identify your area correctly."), 300);
              return;
            }
            // 2nd fake — stop asking and HAND OFF TO THE LLM so the user is
            // never stuck. We DO NOT store the fake as a valid zone.
            handOffToLLM({ problemSummary: outerState.problemSummary });
            setTimeout(() => pushBotMessageDirect(isEs
              ? 'No se preocupe, podemos continuar sin el código postal por ahora. ¿En qué le puedo ayudar hoy?'
              : "No problem — we can continue without the ZIP for now. How can I help you today?"), 300);
            return;
          }
          // Valid real ZIP — store zone, HAND OFF TO THE LLM. Acknowledge the
          // county + state so the caller feels recognized — but ONLY for the
          // active service area (NY/NJ/CT). For any out-of-service ZIP (incl.
          // Florida) we never name the place — compliance.
          const zi = getZipInfo(zip);
          const inService = state === 'NY' || state === 'NJ' || state === 'CT';
          if (!inService) {
            // Sawil 2026-06 — OUT OF SERVICE AREA (e.g. a Florida ZIP like 32828).
            // Keep it BRIEF, tell them ClearPoint doesn't serve their area, and
            // STOP: do NOT hand off to the LLM (no wasted tokens) and close the
            // input. NEVER name the non-service place (compliance).
            const out = isEs
              ? `Gracias. ClearPoint solo atiende Nueva York, Nueva Jersey y Connecticut, así que no podemos ayudarle con su área. Le deseamos lo mejor.`
              : `Thank you. ClearPoint serves only New York, New Jersey, and Connecticut, so we're not able to help in your area. We wish you the best.`;
            setChatClosed(true);
            setTimeout(() => pushBotMessageDirect(out), 300);
            return;
          }
          // In NY/NJ/CT — store zone, hand off to the LLM, confirm the area.
          handOffToLLM({ zip, state });
          const zipBridge = (zi && zi.county)
            ? (isEs
                ? `Perfecto — su código postal ${zip} corresponde a ${zi.county}, ${zi.state}. Usaré ${zip} como su zona de servicio. ¿En qué le puedo ayudar hoy?`
                : `Perfect — your ZIP ${zip} is in ${zi.county}, ${zi.state}. I'll use ${zip} as your service area. How can I help you today?`)
            : (isEs
                ? `Gracias. Anoté su código postal ${zip} como su zona de servicio. ¿En qué le puedo ayudar hoy?`
                : `Thank you. I've noted your ZIP ${zip} as your service area. How can I help you today?`);
          setTimeout(() => pushBotMessageDirect(zipBridge), 300);
          return;
        }
        // (c) No ZIP — the user described their situation instead of giving a
        // ZIP (e.g. "tengo A pero no B porque trabajaba"). DO NOT route into
        // the scripted A/B/C gauntlet. HAND OFF TO THE LLM NOW and process
        // THIS message through the engine with the hydrated context so Clara
        // engages with the actual situation. runEngineTurn() pushes the user
        // message exactly once, so we must NOT pre-push it here.
        const hydrated = handOffToLLM({ problemSummary: trimmed });
        await runEngineTurn(trimmed, meta, hydrated);
        return;
      }
      // PHASE 11.1 — Natural-language path inference. User typed freely;
      // Clara silently classifies and asks ONE natural follow-up.
      if (outerState.step === 'path_select') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const inferred = inferInitialPath(trimmed);
        if (inferred === 'A') {
          setOuterState((s) => ({ ...s, path: 'A', step: 'A_collect_identity', problemSummary: trimmed }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Entiendo, eso puede ser frustrante — déjeme ayudarle. Para proteger su privacidad, ¿me comparte su nombre completo y los últimos 4 dígitos del teléfono que tenemos registrado?'
            : "I understand — that can be frustrating, and I'm here to help. To protect your privacy, may I have your full name and the last 4 digits of the phone we have on file?"), 350);
          return;
        }
        if (inferred === 'C') {
          setOuterState((s) => ({ ...s, path: 'C', step: 'C_resources_shown', problemSummary: trimmed }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Entiendo, eso suena complicado. Ese tema en particular no es nuestra especialidad en Clear Point, pero no quiero dejarle sin opciones. Aquí tiene algunos recursos que pueden ayudarle:\n\n• Medicare.gov o 1-800-MEDICARE\n• Su SHIP local (shiphelp.org)\n• Para Medicaid: HRA u oficina estatal de su estado\n\nSi alguna parte de su pregunta tiene que ver con Medicare, con gusto le pongo en contacto con un asesor. ¿Le gustaría?'
            : "I understand — that sounds like a lot. That specific topic isn't a Clear Point specialty, but I don't want to leave you without options. Here are some resources that may help:\n\n• Medicare.gov or 1-800-MEDICARE\n• Your local SHIP (shiphelp.org)\n• For Medicaid: HRA or your state office\n\nIf any part of your question touches Medicare, I'd be glad to connect you with an advisor. Would you like that?"), 350);
          return;
        }
        // Ambiguous — single natural follow-up
        setOuterState((s) => ({ ...s, step: 'awaiting_client_check', problemSummary: trimmed }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? 'Con gusto le oriento. Para guiarle mejor, una pregunta rápida: ¿es cliente actual de Clear Point, o todavía está explorando sus opciones?'
          : "I'd be glad to help. To guide you better, one quick question — are you already a Clear Point client, or are you still exploring your options?"), 350);
        return;
      }
      // After ambiguous question — infer A or B from yes/no
      if (outerState.step === 'awaiting_client_check') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        // Sawil 2026-06 — If the user answered with their Medicare status
        // ("tengo A y B" / "near 65" / "Parts A and B"), that is a Path B
        // prospect signal, NOT a yes/no client answer. Skip the loose
        // inferYesClient regex and route straight into Path B qualification
        // with the Medicare status already captured.
        const ms = inferMedicareStatus(trimmed);
        if (ms !== 'none') {
          // Skip B_q_state when ZIP already gave us the state.
          if (outerState.state) {
            setOuterState((s) => ({ ...s, path: 'B', medicareStatus: ms, step: 'B_q_topic' }));
            setTimeout(() => pushBotMessageDirect(isEs ? 'Gracias. ¿Sobre qué tema le orientamos?' : 'Thank you. What can we guide you on?'), 350);
          } else {
            setOuterState((s) => ({ ...s, path: 'B', medicareStatus: ms, step: 'B_q_state' }));
            setTimeout(() => pushBotMessageDirect(isEs ? '¿En qué estado vive?' : 'Which state do you live in?'), 350);
          }
          return;
        }
        if (inferYesClient(trimmed)) {
          setOuterState((s) => ({ ...s, path: 'A', step: 'A_collect_identity' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Perfecto. Para proteger su privacidad, ¿me comparte su nombre completo y los últimos 4 dígitos del teléfono que tenemos registrado?'
            : 'Got it. To protect your privacy, may I have your full name and the last 4 digits of the phone we have on file?'), 350);
        } else {
          setOuterState((s) => ({ ...s, path: 'B', step: 'B_q_medicare' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Con gusto le oriento. Para asegurarme de darle la información correcta, ¿ya tiene Medicare Parte A y Parte B activos, o está cerca de cumplir 65?'
            : "I'd be glad to help. So I can give you the right information, do you already have Medicare Parts A and B active, or are you near turning 65?"), 350);
        }
        return;
      }
      // Path B free-text qualification
      if (outerState.step === 'B_q_medicare') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const ms = inferMedicareStatus(trimmed);
        // Sawil 2026-06 — Skip state question if ZIP already gave us the state.
        if (outerState.state) {
          setOuterState((s) => ({ ...s, medicareStatus: ms, step: 'B_q_topic' }));
          setTimeout(() => pushBotMessageDirect(isEs ? 'Gracias. ¿Sobre qué tema le orientamos?' : 'Thank you. What can we guide you on?'), 350);
          return;
        }
        setOuterState((s) => ({ ...s, medicareStatus: ms, step: 'B_q_state' }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? 'Gracias. ¿Y en qué estado vive?'
          : 'Thank you. And which state do you live in?'), 300);
        return;
      }
      if (outerState.step === 'B_q_state') {
        pushUserMessageDirect(trimmed);
        setInputValue('');
        const st = inferStateFromText(trimmed);
        setOuterState((s) => ({ ...s, state: st }));
        // Sawil compliance 2026-06: Florida is HIDDEN. FL ZIPs / text now
        // resolve to `state === 'other'` upstream, so the only out-of-area
        // branch is the generic out-of-state Path-C message below.
        if (st === 'other') {
          setOuterState((s) => ({ ...s, step: 'C_resources_shown', path: 'C', outOfScopeCategory: 'outside_state' }));
          setTimeout(() => pushBotMessageDirect(isEs
            ? 'Actualmente Clear Point atiende NY, NJ y CT, así que no podría asesorarle sobre planes en su estado. Pero no quiero dejarle sin opciones. Para Medicare en su área puede usar:\n\n• Medicare.gov o 1-800-MEDICARE (1-800-633-4227), disponible 24/7\n• Su SHIP local para orientación gratuita e imparcial (shiphelp.org)\n• Un asesor licenciado de Medicare en su estado\n\n¿Aun así desea que Clear Point le contacte?'
            : "Clear Point currently serves NY, NJ, and CT, so we wouldn't be able to advise on plans in your state. But I don't want to leave you without options. For Medicare in your area, you can use:\n\n• Medicare.gov or 1-800-MEDICARE (1-800-633-4227), available 24/7\n• Your local SHIP for free, unbiased guidance (shiphelp.org)\n• A licensed Medicare advisor in your state\n\nWould you still like Clear Point to contact you?"), 350);
          return;
        }
        setOuterState((s) => ({ ...s, step: 'B_q_topic' }));
        setTimeout(() => pushBotMessageDirect(isEs
          ? 'Gracias. ¿Sobre qué tema le orientamos? Por ejemplo, una revisión de su plan, una factura que no entiende, su doctor o sus medicamentos.'
          : "Thank you. What can we guide you on? For example, a plan review, a bill you don't understand, your doctor, or your medications."), 300);
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
          ? 'Gracias por compartir eso. Permítame contarle brevemente cómo trabajamos en Clear Point: somos brokers de Medicare independientes y licenciados. Esto significa tres cosas para usted — nuestro servicio no tiene costo, un asesor licenciado revisa su situación personalmente, y nunca le pasamos entre call centers. ¿Le parece bien que le tome su nombre y teléfono para que un asesor le contacte?'
          : "Thank you for sharing that. Let me briefly tell you how we work at Clear Point — we are independent, licensed Medicare brokers. What this means for you is three things: our service is at no cost to you, a licensed advisor reviews your situation personally, and you are never passed between call centers. Would it be alright to take your name and phone so an advisor can reach out?"), 400);
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
        const summary = phoneMatch ? trimmed.replace(phoneMatch[0], '').trim() : trimmed;
        // Stage 1 — validate the phone via the shared validateUserPhone()
        // (delegates to validatePhone in validation.ts: rejects 555 exchange,
        // non-US, sequential/repeated fakes, bad area/exchange codes).
        const phoneCheck = phoneMatch ? validateUserPhone(phoneMatch[0]) : { ok: false };
        const phone = phoneCheck.ok ? phoneCheck.phone! : '';
        if (!phone) {
          pushBotMessageDirect(outerState.language === 'es'
            ? 'Disculpe, necesito un teléfono de EE. UU. válido de 10 dígitos para que el asesor pueda devolverle la llamada. Por ejemplo: "(917) 432-1098 — mi factura subió".'
            : 'Apologies — I need a valid 10-digit U.S. phone number so an advisor can call you back. For example: "(917) 432-1098 — my bill went up".');
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
        const nameAndSummary = phoneMatch ? trimmed.replace(phoneMatch[0], '').trim() : trimmed;
        // Stage 1 — validate the phone via the shared validateUserPhone()
        // (delegates to validatePhone in validation.ts).
        const phoneCheck = phoneMatch ? validateUserPhone(phoneMatch[0]) : { ok: false };
        const phone = phoneCheck.ok ? phoneCheck.phone! : '';
        if (!phone) {
          pushBotMessageDirect(outerState.language === 'es'
            ? 'Disculpe, para que un asesor pueda contactarle necesito tres cosas: su nombre completo, un teléfono de EE. UU. válido de 10 dígitos, y un resumen breve del tema.'
            : "Apologies — so an advisor can reach you, I need three things: your full name, a valid 10-digit U.S. phone number, and a brief summary of the topic.");
          return;
        }
        // Try to extract name as the first 2 capitalized tokens.
        const nameMatch = nameAndSummary.match(/^([A-Za-zÁÉÍÓÚÑáéíóúñ' .-]+?)(?:[,.\-—]|$)/);
        const candidateName = nameMatch ? nameMatch[1].trim() : nameAndSummary.split(/\s{2,}|[,.\-—]/)[0] || '';
        // Stage 1 — run the candidate name through validateFullName (now
        // delegating to validatePersonName: bilingual profanity/fake rejection).
        // If it fails, keep it out of the structured fullName field; the raw
        // text is still preserved in problemSummary for the advisor.
        const nameCheck = validateFullName(candidateName);
        const fullName = nameCheck.ok ? nameCheck.cleaned! : '';
        setOuterState((s) => ({ ...s, fullName, phone, problemSummary: nameAndSummary }));
        await submitOuterLead({ phone, summary: nameAndSummary });
        setOuterState((s) => ({ ...s, step: 'C_done' }));
        return;
      }
      // For other outer-flow steps, ignore free-text (chips drive these).
      return;
    }
    // Stage 2a (Sawil 2026-06) — the LLM now leads after language. When the
    // outer flow has handed off (outerInProgress=false, step='conversation'),
    // every text turn flows through the engine/LLM via runEngineTurn().
    await runEngineTurn(text, meta);
  }

  // ── Stage 2a — engine/LLM turn. Factored out of handleSendMessage so the
  // orchestrator can invoke it for the CURRENT message at the moment it hands
  // off to the LLM (e.g. the no-ZIP free-text bridge), not only on the NEXT
  // turn. `baseStateOverride` lets a caller pass a freshly-hydrated engine
  // state synchronously, because React's setState hasn't flushed `state` yet.
  async function runEngineTurn(
    text: string,
    meta?: { source?: 'chip' | 'text' | 'system'; intentHint?: string },
    baseStateOverride?: ConversationState,
  ) {
    // WAVE 39 — synchronous re-entrancy guard. React state hasn't flushed
    // between two near-simultaneous clicks; the ref has.
    if (isSendingRef.current) return;
    isSendingRef.current = true;

    // When a caller hydrates the engine synchronously (no-ZIP handoff), use
    // that state as the basis for THIS turn so the LLM sees ZIP/topic/history
    // even though React hasn't committed the setState yet.
    const baseState = baseStateOverride || state;

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
      let newState = baseState;
      let needsHuman = false;
      try {
        // PHASE A7 — async LLM brain (Claude Haiku) + structural fallback.
        // The async wrapper handles ZIP / name+phone / crisis / closing
        // synchronously, then calls the LLM for topic conversation. If
        // the LLM call fails, it falls back to the legacy regex engine.
        const result = await processMessageAsync(text, baseState, meta);
        response = result.response;
        newState = result.newState;
        needsHuman = result.needsHuman;
      } catch {
        response = baseState.language === 'es'
          ? 'Algo salió mal, pero sigo aquí. Por favor intente de nuevo.'
          : "Something went wrong, but I'm still here. Please try again.";
      }
      // Wave 21 — final safety guard. Never let "undefined" / "null" / "NaN"
      // reach the user, even if a template slipped through.
      response = sanitizeResponse(response, (newState.language || baseState.language) === 'es');

      // Sync page-level language when chip selection occurs.
      // PHASE 8 — capture the CS bot viewport position before the global
      // re-render (Header/Hero/Footer text lengths differ between EN/ES,
      // which would otherwise push the bot down the page visually) and
      // restore it via scrollBy after React commits.
      if (newState.language && newState.language !== baseState.language) {
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

  // ── Stage 2a (Sawil 2026-06) — HAND OFF THE CONVERSATION TO THE LLM ─────────
  // Called right after language + (optional) ZIP, this retires the scripted
  // A/B/C gauntlet for the rest of the session and lets the LLM lead. It
  // hydrates the engine's ConversationState from everything the outer flow
  // already captured (language, ZIP/zone, problem summary, full history),
  // flips the engine to step 'conversation' (which _runStructuralFirst defers
  // to the LLM), marks the outer flow as engine-engaged, and clears
  // outerInProgress so every subsequent text turn flows through runEngineTurn.
  // Returns the freshly-computed ConversationState so a caller can pass it as
  // baseStateOverride to runEngineTurn for the CURRENT message (the no-ZIP
  // bridge), since React has not flushed this setState yet.
  function handOffToLLM(extras: {
    zip?: string;
    state?: ClaraOuterState['state'];
    problemSummary?: string;
  } = {}): ConversationState {
    const isEs = outerState.language === 'es';
    // Merge captured extras into a local outer-state copy for hydration
    // (immutably — never mutate outerState).
    const mergedOuter: ClaraOuterState = {
      ...outerState,
      ...(extras.zip ? { zip: extras.zip } : {}),
      ...(extras.state ? { state: extras.state } : {}),
      ...(extras.problemSummary ? { problemSummary: extras.problemSummary } : {}),
      step: 'B_engine_engaged',
    };
    const enginePatch = outerStateToEngine(mergedOuter, messages);
    const hydrated: ConversationState = {
      ...state,
      ...enginePatch,
      language: enginePatch.language ?? state.language ?? (isEs ? 'es' : 'en'),
      step: 'conversation',
    };
    setState(hydrated);
    setOuterState(mergedOuter);
    setOuterInProgress(false);
    return hydrated;
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
        ? 'Entendido, sin presión. Gracias por considerarnos. Si en algún momento cambia de opinión, puede llamarnos al 1-866-310-8702 o regresar aquí — siempre estaremos para ayudarle.'
        : "Understood — no pressure at all. Thank you for considering us. If you ever change your mind, you can call us at 1-866-310-8702 or come back anytime. We'll always be here to help."), 300);
      return;
    }
    // Sawil 2026-06 (Phase 1) — HYDRATE the engine with everything the
    // scripted outer flow already captured (language, ZIP, in-service state,
    // topic, problem summary, full conversation history) instead of handing
    // it an empty state + the literal word "español". The engine no longer
    // restarts intake from zero.
    //
    // We set pendingAdvisorHandoff + step 'asking_name' so the engine asks
    // ONLY for the one field Path B genuinely lacks (the name) and then
    // finalizes the advisor handoff. ZIP / language / topic are NOT re-asked
    // (see the asking_name ZIP-skip guard in customerServiceEngine.ts).
    setOuterState((s) => ({ ...s, step: 'B_engine_engaged' }));
    const enginePatch = outerStateToEngine(outerState, messages);
    setState((prev) => ({
      ...prev,
      ...enginePatch,
      language: enginePatch.language ?? prev.language ?? (isEs ? 'es' : 'en'),
      pendingAdvisorHandoff: true,
      step: 'asking_name',
    }));
    setOuterInProgress(false);
    setTimeout(() => pushBotMessageDirect(isEs
      ? 'Perfecto. Para que un asesor licenciado de Clear Point le contacte, ¿cuál es su nombre completo?'
      : 'Perfect. So a licensed Clear Point advisor can reach out, what is your full name?'), 300);
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
        ? 'Gracias por consultarnos. Espero que los recursos le sean de ayuda. Si en algún momento tiene una pregunta de Medicare, estaremos aquí — que tenga un buen día.'
        : "Thank you for reaching out. I hope the resources help. If a Medicare question ever comes up, we'll be here. Have a good day."), 300);
      return;
    }
    setOuterState((s) => ({ ...s, step: 'C_optin_capture' }));
    setTimeout(() => pushBotMessageDirect(isEs
      ? 'Con gusto. Para que un asesor pueda revisar su caso, ¿me puede compartir su nombre completo, un teléfono donde le podamos llamar, y una breve descripción del tema?'
      : "Of course. So an advisor can review your case, may I have your full name, a phone number where we can reach you, and a brief description of the topic?"), 300);
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
        ? 'Disculpe, necesito su nombre completo y los últimos 4 dígitos del teléfono para verificar su caso. Por ejemplo: "María García 5678".'
        : 'Apologies — I need your full name and the last 4 digits of your phone to verify your case. For example: "John Smith 5678".');
      return;
    }
    const fullName = nameCheck.cleaned!;
    setOuterState((s) => ({ ...s, fullName, last4Phone: last4, step: 'A_verifying' }));
    pushBotMessageDirect(isEs ? 'Déjeme buscar su caso, un momento…' : 'Let me look up your case — one moment…');
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
          ? `Perfecto, encontré su caso. Le voy a conectar con su asesor asignado${advBit}. ¿En qué le podemos ayudar hoy?`
          : `Perfect — I found your case. I'll connect you with your assigned advisor${advBit}. How can we help you today?`);
      } else {
        setOuterState((s) => ({ ...s, step: 'A_unmatched_collect_topic' }));
        pushBotMessageDirect(isEs
          ? 'No pude encontrarle automáticamente en nuestro sistema, pero no se preocupe — esto sucede a veces. Para proteger su privacidad, prefiero que un asesor licenciado de Clear Point revise su caso personalmente y le devuelva la llamada. ¿Me podría compartir un teléfono donde le podamos contactar, junto con un resumen breve del tema?'
          : "I couldn't find you automatically in our system — but don't worry, this happens sometimes. To protect your privacy, I'd rather have a licensed Clear Point advisor review your case personally and call you back. Could you share a phone number where we can reach you, along with a brief summary of the topic?");
      }
    } catch {
      clearTimeout(timer);
      setIsTyping(false);
      setOuterState((s) => ({ ...s, step: 'A_unmatched_collect_topic' }));
      pushBotMessageDirect(isEs
        ? 'No pude verificar su caso en este momento, pero no se preocupe — un asesor licenciado lo revisará personalmente. ¿Me podría compartir un teléfono donde le podamos contactar y un resumen breve del tema?'
        : "I couldn't verify your case right now, but don't worry — a licensed advisor will review it personally. Could you share a phone number where we can reach you and a brief summary of the topic?");
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
          ? 'Listo, gracias. Su información ya está con un asesor licenciado. Si prefiere hablar ahora mismo, puede llamarnos al 1-866-310-8702; de lo contrario, un asesor le contactará pronto.'
          : 'Listo, gracias. Su información ya está con un asesor licenciado. En este momento estamos fuera de horario, así que un asesor le devolverá la llamada el próximo día laboral. Que tenga una buena noche.';
        const closingEn = officeStatus.isOpen
          ? "All set, thank you. Your information is now with a licensed advisor. If you'd rather speak right now, you can call us at 1-866-310-8702; otherwise, an advisor will reach out to you shortly."
          : "All set, thank you. Your information is now with a licensed advisor. We're currently after hours, so an advisor will call you back on the next business day. Have a good evening.";
        setTimeout(() => pushBotMessageDirect(isEs ? closingEs : closingEn), 200);
      }
    } catch {
      setSubmitState('failed');
    }
  }

  function handleLanguageSelect(lang: Language) {
    if (!lang) return;
    // Idempotent: ignore a second call (auto-from-memory + manual chip tap, or
    // a React StrictMode double-invoke). Prevents the duplicated welcome/ZIP.
    if (langSelectedRef.current) return;
    langSelectedRef.current = true;
    // PHASE 10 — instead of feeding 'english/español' straight into the engine,
    // we ask the path_select question. The engine is only engaged later for
    // Path B qualified prospects.
    setLang(lang);
    // Advance engine step past 'asking_language' so the language chips hide and
    // the text input unblocks. 'conversation' = free chat (outer flow drives now).
    setState((prev) => ({ ...prev, language: lang, step: 'conversation' }));
    // Sawil 2026-06: ask for ZIP right after the welcome to identify the
    // client zone before continuing. Natural, single line, not a form.
    setOuterState((s) => ({ ...s, language: lang, step: 'awaiting_zip' }));
    const isEs = lang === 'es';
    pushUserMessageDirect(isEs ? 'Español' : 'English');
    setTimeout(() => pushBotMessageDirect(isEs
      ? 'Hola, soy Clara, su asistente bilingüe de Clear Point. Estoy aquí para ayudarle con su Medicare — preguntas de servicio, su cobertura, su plan, o seguimiento con un asesor. Para orientarle mejor, ¿me comparte su código postal de 5 dígitos?'
      : "Hi, I'm Clara, your bilingual assistant at Clear Point. I'm here to help with your Medicare — service questions, your coverage, your plan, or follow-up with an advisor. So I can help you better, may I have your 5-digit ZIP code?"), 300);
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
    // Sawil 2026-06 — remember the chosen language so the restart greets in it
    // (not the bilingual "English or Spanish?" screen).
    const prevLang = state.language;
    setState(createInitialState());
    // Sawil 2026-06 — FULL reset. The LLM-led flow sets outerInProgress=false
    // when the engine takes over; "Empezar de nuevo" must also reset the outer
    // flow + re-enable it, otherwise the restarted conversation stays stuck in
    // the old engine state and the language pick doesn't behave like a fresh
    // start. Reset outerState + outerInProgress so reset == first load exactly.
    setOuterState(createOuterState((pageLang === 'es' ? 'es' : 'en')));
    setOuterInProgress(true);
    setSubmitState('idle');
    setHasNewBotMessage(false);
    setDisclosureCollapsed(false);
    userPinnedUpRef.current = false;
    // Sawil 2026-06 — CRITICAL: reset the language-select idempotency guard.
    // Without this, after "Empezar de nuevo" the guard stays true and the
    // language chips do NOTHING (handleLanguageSelect returns early), so the
    // whole chat is dead from there on. Resetting it makes reset == fresh load.
    langSelectedRef.current = false;
    setChatClosed(false);
    // Sawil bugfix — clear the single-fire submit + follow-up guards so the
    // next conversation can submit again and ask the follow-up question.
    hasSubmittedRef.current = false;
    askedFollowupRef.current = false;
    // Sawil 2026-06 — greet in the PREVIOUSLY chosen language (not bilingual).
    // The language chips stay visible (step is still asking_language) so the
    // user can keep their language or switch with one tap.
    setMessages([{
      id: 'welcome-' + Date.now(),
      text: prevLang === 'en'
        ? "Hi, I'm Clara, your bilingual assistant at Clear Point. I'm here to help. Do you prefer English or Spanish?"
        : prevLang === 'es'
          ? 'Hola, soy Clara, su asistente bilingüe de Clear Point. Estoy aquí para ayudarle. ¿Prefiere español o inglés?'
          : "Hi, I'm Clara, your bilingual assistant at Clear Point. I'm here to help. Do you prefer English or Spanish?\n\nHola, soy Clara, su asistente bilingüe de Clear Point. Estoy aquí para ayudarle. ¿Prefiere español o inglés?",
      sender: 'bot',
      timestamp: new Date(),
    }]);
  }

  function handleEscalateManually() {
    escalateHandler(state, messages);
  }

  const showLanguageChips = state.step === 'asking_language' && !isTyping;
  const inputDisabled = state.step === 'asking_language' || isTyping || chatClosed;
  const lang = state.language;
  // V30 — chrome elements follow page language until user picks bot language.
  const effectiveLang = lang || pageLang;
  const isSpanish = effectiveLang === 'es';
  // Wave 19 — recovery chips (Factura / Carta / Cobertura / Medicamentos /
  // Doctor-Proveedor / Hablar con asesor) when the engine sends them.
  const quickReplies = state.quickReplies || [];
  const showRecoveryChips = quickReplies.length > 0 && !isTyping;

  // PHASE E — viewport tier still drives chip-row layout and desktop max-width.
  // Mobile container height now comes from the CSS var `--svh`
  // (written by useVisualViewportHeight) so the shell auto-shrinks when the
  // soft keyboard opens. No inline JS math.
  const _vp = viewportTier(viewportWidth);
  // _containerStyle removed — Clara now mirrors Zara's max-h pattern directly
  // in the JSX, so the bespoke per-tier pixel cap from containerHeightStyle()
  // is no longer needed. Kept the import for backwards compatibility in case
  // other surfaces still use the helper.
  const _chipRowCls = chipRowClass(viewportWidth);
  const _safeBottom = safeAreaBottomStyle();

  // Sawil 2026-06 — enterprise overlay rewrite. Extract the chat chrome into
  // a fragment so we can wrap it in either an overlay-backdrop (page mode)
  // or the legacy widget-mode container without duplicating event handlers,
  // refs, or scroll effects.
  const innerContent = (
    <>
      {/* Header */}
      <header className="bg-earth-800 text-cream-50 px-4 py-3 flex items-center justify-between flex-shrink-0 gap-2">
        {/* Sawil 2026-06 — Back button only rendered in page mode (when Clara is /support's main panel). */}
        {mode === 'page' && (
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                navigate(-1);
              } else {
                navigate('/');
              }
            }}
            className="mr-1 p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-cream-50/10 transition-colors flex-shrink-0"
            aria-label={isSpanish ? 'Volver al sitio' : 'Back to site'}
            title={isSpanish ? 'Volver' : 'Back'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
        )}
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
            {/* Sawil 2026-06 — short title so it NEVER truncates to "Clara —
                Sop…" on a phone. The site header above already carries the
                "Clear Point" brand; the subtitle below carries the rest. */}
            <div className="text-[15px] font-semibold truncate">
              {isSpanish ? 'Clara · Soporte' : 'Clara · Support'}
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
            className="block w-full text-left bg-gold-100 border-b border-gold-200 px-4 py-1.5 text-[12px] leading-[1.5] text-earth-700 hover:bg-gold-200/40 transition"
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

        <div
          className="px-3 py-3 space-y-2.5"
          style={{ paddingBottom: '12px' }}
        >
          {messages.map((m) => (
            <div key={m.id} data-msg-id={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[16px] sm:text-[16px] leading-[1.6] whitespace-pre-wrap ${
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
          {outerInProgress && outerState.step === 'C_resources_shown' && !isTyping && (
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
              {isSpanish ? 'Pasándole su caso a un asesor licenciado…' : 'Handing your case to a licensed advisor…'}
            </div>
          )}
          {submitState === 'submitted' && (
            <div className="bg-sage-100 border border-sage-300 rounded-xl p-4 space-y-1">
              <div className="font-bold text-earth-900">
                {isSpanish ? '✓ Listo — su caso está con un asesor licenciado.' : '✓ All set — your case is with a licensed advisor.'}
              </div>
              <p className="text-earth-700 text-[13.5px]">
                {isSpanish ? 'Un asesor bilingüe revisará su situación y le contactará pronto.' : 'A bilingual advisor will review your situation and reach out to you shortly.'}
              </p>
            </div>
          )}
          {submitState === 'failed' && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-4 space-y-3">
              <div className="font-bold text-red-900">
                {isSpanish ? 'Disculpe, su mensaje quedó preparado pero no pude confirmar el envío en este momento. Por favor llámenos directamente y le atenderemos enseguida.' : "Apologies — your message was prepared but I couldn't confirm the submission right now. Please call us directly and we'll take care of you right away."}
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
      {/* Sawil 2026-06 — footer kept on ONE clean line at every width. The
          callback label is now localized (no more "devolución tomorrow at
          9am ET" mixed-language) and the call link truncates instead of
          wrapping the row into a choppy two-line mess. min-w-0 lets the link
          shrink; the status stays pinned (flex-shrink-0). */}
      <div className="px-3 py-2 border-t border-cream-200 flex-shrink-0 flex items-center gap-2 bg-white min-w-0">
        <a
          href="tel:18663108702"
          className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors min-w-0"
        >
          <Phone className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">
            {officeStatus.isOpen
              ? (isSpanish ? 'Llamar ahora' : 'Call now')
              : (isSpanish ? `Devolución: ${officeStatus.nextOpenLabelEs}` : `Callback: ${officeStatus.nextOpenLabel}`)}
          </span>
        </a>
        {/* Open hours → show the "bilingual support" tag. After hours the
            "Devolución: …" label already conveys the status, so we drop the
            redundant tag and give the callback time the full width (no more
            truncation). */}
        {officeStatus.isOpen && (
          <>
            <span className="text-earth-300 select-none flex-shrink-0" aria-hidden="true">·</span>
            <span className="text-[12px] text-earth-600 whitespace-nowrap flex-shrink-0">
              {isSpanish ? 'Soporte bilingüe' : 'Bilingual support'}
            </span>
          </>
        )}
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
            onFocus={() => {
              // Sawil 2026-06 — mobile scroll-sequence fix. On touch devices,
              // focusing the input opens the soft keyboard, which shrinks the
              // visible viewport (--svh). The last bot message (e.g. the
              // post-language ZIP ask) then falls below the fold, exactly the
              // "queda abajo" Sawil reported. The main scroll effect no longer
              // depends on viewport height (that dep caused the old bounce),
              // so nothing re-pins on keyboard open. Re-scroll the last message
              // into view once the keyboard has settled. Coarse-pointer only,
              // so desktop (no viewport shift on focus) is untouched. Two
              // instant fires — one mid-animation, one after settle — converge
              // on the same target with no visible jump and no listener loop.
              if (typeof window === 'undefined') return;
              if (!window.matchMedia?.('(pointer: coarse)')?.matches) return;
              if (userPinnedUpRef.current) return;
              window.setTimeout(() => scrollToBottom(false), 250);
              window.setTimeout(() => scrollToBottom(false), 500);
            }}
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
    </>
  );

  // Sawil 2026-06 — Dual-branch return.
  //
  // PAGE MODE: Clara is a true chat application overlay. Mobile fills the
  // viewport (no rounding, fixed inset-0 at z-60). Desktop centers a card
  // (880×760 cap) over a translucent earth-900/40 backdrop. Body-scroll
  // lock is owned by Support.tsx (the only mount point for page mode).
  //
  // WIDGET MODE: Preserved unchanged — legacy fixed-bottom overlay for the
  // floating BotLauncher pill on non-/support routes.
  if (mode === 'page') {
    // Sawil 2026-06 — PAGE MODE IS AN IN-FLOW PANEL, not a modal takeover.
    // Previously this was `fixed inset z-[60] aria-modal` covering the whole
    // viewport (including the site Header) and the document was scroll-locked,
    // so the user was TRAPPED in Clara — could not reach the site nav or tap
    // anything else. Now Clara renders in normal document flow under the
    // sticky site Header: the menu stays usable, the page is not frozen, and
    // the user can navigate away anytime.
    //
    // Height = visible viewport minus the sticky nav (~70px) so the composer
    // stays on screen without forcing a page scroll. --svh (written by
    // useVisualViewportHeight) shrinks when the mobile keyboard opens, so the
    // input rides the keyboard natively — no fixed shell for iOS to drag,
    // which is what caused every prior keyboard bug. Desktop caps the panel
    // height (max-h) and centers it in a comfortable max-w-3xl column.
    return (
      <section
        aria-label={isSpanish ? 'Asistente de servicio al cliente' : 'Customer service assistant'}
        className="w-full h-full md:h-auto md:max-w-3xl md:mx-auto md:px-4 md:py-6"
      >
        {/* Mobile: fill the .support-main flex slot (no magic px, no inline
            height) — the shell already equals --svh, so this panel is exactly
            the visible area below the header and CANNOT push the page taller.
            Desktop: a fixed-height centered card. */}
        <div className="flex flex-col bg-cream-50 overflow-hidden h-full border-cream-200 md:h-[min(760px,calc(100dvh-140px))] md:border md:border-cream-300 md:rounded-2xl md:shadow-lifted">
          {innerContent}
        </div>
      </section>
    );
  }

  return (
    <div
      className={`flex flex-col bg-cream-50 border border-cream-200 overflow-hidden rounded-2xl shadow-lifted mx-auto fixed inset-x-0 bottom-0 z-40 rounded-b-none border-b-0 h-[var(--svh,100dvh)] md:relative md:inset-auto md:bottom-auto md:rounded-2xl md:border-b md:border-b-cream-200 md:rounded-b-2xl md:h-auto md:max-h-[85dvh] ${_vp.applyMaxWidth ? 'md:max-w-3xl' : 'md:max-w-full'}`}
      aria-label={isSpanish ? 'Asistente de servicio al cliente' : 'Customer service assistant'}
    >
      {innerContent}
    </div>
  );
}

export default CustomerServiceBot;

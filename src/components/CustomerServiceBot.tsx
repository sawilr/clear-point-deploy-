// ============================================================================
// CUSTOMER SERVICE BOT V15 — ENTERPRISE PROFESSIONAL
// Drop-in V15 architecture with ClearPoint brand palette + GHL bridge.
// State machine: language → name → ZIP → problem → conversation.
// Language is LOCKED at step 1 via chip click. Never auto-flips.
// ============================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  processMessage,
  createInitialState,
  sanitizeResponse,
  type ConversationState,
  type Language,
} from '../lib/customerServiceEngine';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { Headphones, Phone, RotateCcw, Send, User } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
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

  // Monotonic bottom-follow scroll. V28: rAF-wrapped to avoid layout
  // race; respects user pin. Uses scroll INSIDE the body, not the page.
  const scrollToBottom = useCallback(() => {
    const c = bodyRef.current;
    if (!c) return;
    if (userPinnedUpRef.current) return;
    // Two rAF ticks guarantee the new message DOM has painted before we
    // measure scrollHeight. Single rAF can miss when typing indicator
    // appears/disappears in the same tick.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const cc = bodyRef.current;
        if (!cc) return;
        cc.scrollTo({ top: cc.scrollHeight, behavior: 'smooth' });
      });
    });
  }, []);
  function handleScroll() {
    const c = bodyRef.current;
    if (!c) return;
    const dist = c.scrollHeight - c.scrollTop - c.clientHeight;
    if (dist > 200) userPinnedUpRef.current = true;
    else if (dist < 40) userPinnedUpRef.current = false;
  }
  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

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
      const transcript = sourceMsgs.map((m) => `${m.sender === 'bot' ? 'BOT' : 'USER'}: ${m.text}`).join('\n');
      const dataScore = s.dataConfidenceScore ?? 100;
      const fake = !!s.probableFakeLead;
      const inconsistencies = s.inconsistencies || [];
      const payload = {
        source: 'customer_service_bot',
        page_url: typeof window !== 'undefined' ? window.location.href : '',
        form_name: 'ClearPoint Support Guide (V19)',
        first_name: s.name || '',
        last_name: '',
        full_name: s.name || '',
        phone: s.phoneNumber || '',
        email: '',
        zip_code: s.zipCode || '',
        preferred_language: s.language === 'es' ? 'Spanish' : 'English',
        medicare_status: '',
        interest_type: s.intent || '',
        best_time_to_contact: '',
        consent_to_contact: false,
        consent_text: '',
        lead_notes: [
          '[ClearPoint Support Guide — V19]',
          `Submitted: ${new Date().toISOString()}`,
          `Conversation: ${s.conversationId}`,
          `Language: ${s.language === 'es' ? 'Spanish' : 'English'}`,
          '',
          'CONTACT DATA',
          `Name: ${s.name || 'not provided'} (validation: ${s.nameIsValid ? 'PASS' : 'FAIL/UNVERIFIED'})`,
          `ZIP: ${s.zipCode || 'not provided'} (validation: ${s.zipCodeIsValid ? 'PASS' : 'FAIL'})`,
          `State (from ZIP): ${s.state || 'outside service area'}`,
          `State declared by user: ${s.stateDeclaredByUser || 'not stated'}`,
          `In NY/NJ/FL/CT: ${s.isValidState ? 'YES' : 'NO'}`,
          `Phone: ${s.phoneNumber || 'not provided'}`,
          '',
          'CONVERSATION CONTEXT',
          `Intent: ${s.intent}`,
          `Bill source: ${s.billSource || 'not stated'}`,
          `Dual eligible (Medicare + Medicaid): ${s.dualEligible ? 'YES' : 'no'}`,
          `Amount mentioned: ${s.amountMentioned ? '$' + s.amountMentioned : 'not stated'}`,
          `Emotion: ${s.emotionalState}`,
          `Turn count: ${s.turnCount}`,
          '',
          'LEAD QUALITY (Wave 18)',
          `Data confidence score: ${dataScore} / 100`,
          `Probable fake lead: ${fake ? 'YES — review carefully' : 'no'}`,
          `Inconsistencies detected: ${inconsistencies.length === 0 ? 'none' : inconsistencies.join('; ')}`,
          '',
          'CONVERSATION RECOVERY (Wave 19)',
          `Recovery mode triggered: ${s.recoveryMode ? 'YES' : 'no'}`,
          `Frustration count: ${s.frustrationCount ?? 0}`,
          `Failed ZIP attempts: ${s.failedZipAttempts ?? 0}`,
          `Failed name attempts: ${s.failedNameAttempts ?? 0}`,
          '',
          'TRANSCRIPT',
          transcript,
        ].join('\n'),
        bot_transcript_summary: `V19 · ${s.language} · ${s.intent} · ${s.emotionalState} · confidence=${dataScore}${fake ? ' · FAKE_LEAD_FLAG' : ''}${s.recoveryMode ? ' · RECOVERY_MODE' : ''}`,
        tags: [
          'customer_service_bot',
          'clearpoint_support',
          'v19',
          s.language === 'es' ? 'spanish' : 'english',
          s.intent || 'general',
          s.emotionalState !== 'calm' ? `emotion_${s.emotionalState}` : '',
          s.isValidState ? `state_${s.state}` : 'out_of_service_area',
          s.dualEligible ? 'dual_eligible' : '',
          fake ? 'probable_fake_lead' : 'data_clean',
          dataScore < 50 ? 'low_confidence' : dataScore < 80 ? 'medium_confidence' : 'high_confidence',
          s.recoveryMode ? 'recovery_mode' : '',
          (s.frustrationCount ?? 0) > 0 ? 'frustration_detected' : '',
        ].filter(Boolean).slice(0, 20),
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

  async function handleSendMessage(text: string) {
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
        const result = processMessage(text, state);
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

      if (needsHuman) {
        setTimeout(() => escalateHandler(newState, [...messages, userMessage, botMessage]), 800);
      }
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
    setState(createInitialState());
    setSubmitState('idle');
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

  return (
    // Wave 33 — bound the outer chat container's height so header, message
    // list, footer chrome, and input ALL stay visible without forcing the
    // page to scroll. Senior must never hunt for the input box.
    //   · Desktop: at most 720px tall, or 78dvh, whichever is shorter.
    //   · Mobile (dvh follows keyboard): same 78dvh cap keeps input above
    //     the keyboard.
    // The body inside uses flex-1 + min-h-0 + overflow-y-auto so only the
    // message list scrolls internally.
    <div
      className="flex flex-col bg-cream-50 rounded-2xl shadow-lifted border border-cream-200 overflow-hidden max-w-3xl mx-auto"
      style={{ height: 'min(78dvh, 720px)' }}
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
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        {/* Persistent privacy / identity band — senior readable */}
        <div className="bg-gold-100 border-b border-gold-200 px-4 py-2.5 text-[14px] leading-[1.5] text-earth-700">
          <p>
            {isSpanish
              ? 'ClearPoint Senior Advisors es una agencia independiente. No estamos conectados con Medicare ni con el gobierno federal. No envíe número de Medicare, Seguro Social, información bancaria, ni récords médicos privados aquí. Podemos ayudarle en inglés o español.'
              : 'ClearPoint Senior Advisors is an independent agency. We are not connected with Medicare or the federal government. Please do not send Medicare ID, Social Security numbers, banking information, or private medical records here. Language assistance available in English or Spanish.'}
          </p>
        </div>

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

          {/* Wave 19 — Recovery chips (Factura / Carta / Cobertura / etc.) */}
          {showRecoveryChips && (
            <div className="flex flex-wrap justify-start gap-2 pt-1">
              {quickReplies.map((label) => (
                <button
                  key={label}
                  onClick={() => handleSendMessage(label)}
                  className="px-4 py-2 bg-white border border-gold-300 text-earth-800 rounded-full text-[13.5px] font-semibold hover:bg-gold-100 hover:border-gold-400 transition shadow-xs"
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {isTyping && (
            <div className="flex justify-start">
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

      {/* Input row */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage(inputValue);
        }}
        className="px-3 pb-3 pt-2 border-t border-cream-200 flex-shrink-0 bg-white"
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

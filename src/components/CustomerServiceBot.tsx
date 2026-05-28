// ============================================================================
// CUSTOMER SERVICE BOT V13 — ENTERPRISE ZERO-FAIL
// Drop-in V13 architecture (Sawil's master plan) with ClearPoint brand
// palette substituted for the generic blue/gray defaults so it matches the
// rest of the site. GHL bridge preserved via onEscalate prop.
// ============================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import { processMessage, type ConversationState } from '../lib/customerServiceEngine';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { Headphones, Phone, RotateCcw, Send, User } from 'lucide-react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  chips?: string[];
}

interface CustomerServiceBotProps {
  onEscalate?: (state: ConversationState, messages: Message[]) => void;
  initialLanguage?: 'en' | 'es';
}

export function CustomerServiceBot({ onEscalate, initialLanguage }: CustomerServiceBotProps = {}) {
  const { lang: pageLang, setLang } = useLanguage();
  const effectiveInitial: 'en' | 'es' = initialLanguage ?? (pageLang === 'es' ? 'es' : 'en');

  const [language, setLanguage] = useState<'en' | 'es'>(effectiveInitial);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      text:
        effectiveInitial === 'es'
          ? 'Hola, soy la Guía de Soporte de ClearPoint. Puedo ayudarle con facturas, cartas, cobertura, medicamentos y más. ¿En qué puedo ayudarle hoy?'
          : "Hi, I'm the ClearPoint Support Guide. I can help with bills, letters, coverage, medications, and more. How can I help you today?",
      sender: 'bot',
      timestamp: new Date(),
      chips:
        effectiveInitial === 'es'
          ? ['Mis facturas', 'Una carta', 'Mi cobertura', 'Mis medicamentos']
          : ['My bills', 'A letter', 'My coverage', 'My medications'],
    },
  ]);

  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const userPinnedUpRef = useRef(false);

  // Auto-scroll to bottom — monotonic, respects user-pinned-up
  const scrollToBottom = useCallback(() => {
    const c = bodyRef.current;
    if (!c) return;
    if (userPinnedUpRef.current) return;
    c.scrollTop = c.scrollHeight;
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

  // Focus input on mount (desktop only)
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)')?.matches) {
      inputRef.current?.focus();
    }
  }, []);

  const getTypingText = () =>
    language === 'es' ? 'Guía de Soporte está escribiendo' : 'Support Guide is typing';

  // ===== Default GHL escalation bridge =====
  // If the parent does not supply onEscalate, the component submits the
  // conversation summary to GHL through the existing /api/submit-lead path
  // (Phase 3 contract). The submission is best-effort; any failure is shown
  // as a friendly bilingual message and does not freeze the UI.
  async function defaultEscalate(state: ConversationState, msgs: Message[]) {
    if (submitState === 'submitting' || submitState === 'submitted') return;
    setSubmitState('submitting');
    try {
      const transcript = msgs.map((m) => `${m.sender === 'bot' ? 'BOT' : 'USER'}: ${m.text}`).join('\n');
      const payload = {
        source: 'customer_service_bot',
        page_url: typeof window !== 'undefined' ? window.location.href : '',
        form_name: 'ClearPoint Support Guide (V13)',
        first_name: '',
        last_name: '',
        full_name: '',
        phone: state.contactInfo?.phone || '',
        email: state.contactInfo?.email || '',
        zip_code: state.extractedEntities?.zipCode || '',
        preferred_language: state.language === 'es' ? 'Spanish' : 'English',
        medicare_status: '',
        interest_type: state.currentPrimaryIntent,
        best_time_to_contact: state.contactInfo?.bestTimeToCall || '',
        consent_to_contact: false,
        consent_text: '',
        lead_notes: buildLeadNotes(state, transcript),
        bot_transcript_summary: `V13 · Intent: ${state.currentPrimaryIntent} · Subtype: ${state.currentDocumentSubtype} · Emotion: ${state.emotionalState}`,
        tags: buildTags(state),
        created_at: new Date().toISOString(),
        derived_state: '',
        website_url: '',
      };
      const ok = await submitLeadToGHL(payload as any);
      setSubmitState(ok ? 'submitted' : 'failed');
    } catch (_err) {
      setSubmitState('failed');
    }
  }

  const escalateHandler = onEscalate || defaultEscalate;

  // Process user message
  async function handleSendMessage(text: string) {
    if (!text.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: text.trim(),
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    // Natural typing delay scaled to message length (300-800ms)
    const typingDelay = Math.min(300 + text.length * 10, 800);
    await new Promise((resolve) => setTimeout(resolve, typingDelay));

    let response = '';
    let chips: string[] = [];
    let newState: ConversationState | null = conversationState;
    let needsHuman = false;
    try {
      const result = processMessage(text, conversationState);
      response = result.response;
      chips = result.chips;
      newState = result.newState;
      needsHuman = result.needsHuman;
    } catch (err) {
      // Friendly fallback — never freeze the UI
      response = language === 'es'
        ? 'Algo salió mal, pero sigo aquí. Por favor intente de nuevo o presione "Hablar con un asesor".'
        : "Something went wrong, but I'm still here. Please try again or press \"Talk to an advisor\".";
      chips = language === 'es' ? ['Hablar con un asesor', 'Empezar de nuevo'] : ['Talk to an advisor', 'Start over'];
    }

    // Sync language with the page if the engine detected a switch
    if (newState && newState.language !== language) {
      setLanguage(newState.language);
      setLang(newState.language);
    }

    setConversationState(newState);

    const botMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: response,
      sender: 'bot',
      timestamp: new Date(),
      chips: chips && chips.length > 0 ? chips : undefined,
    };

    setMessages((prev) => [...prev, botMessage]);
    setIsTyping(false);

    if (typeof window !== 'undefined' && !window.matchMedia?.('(pointer: coarse)')?.matches) {
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    }

    if (needsHuman && newState) {
      setTimeout(() => escalateHandler(newState!, [...messages, userMessage, botMessage]), 800);
    }
  }

  const handleChipClick = (chip: string) => handleSendMessage(chip);

  function toggleLanguage() {
    const newLang: 'en' | 'es' = language === 'en' ? 'es' : 'en';
    setLanguage(newLang);
    setLang(newLang);
    const sysMessage: Message = {
      id: 'lang-' + Date.now(),
      text:
        newLang === 'es'
          ? 'Cambié a español. ¿En qué puedo ayudarle?'
          : 'Switched to English. How can I help you?',
      sender: 'bot',
      timestamp: new Date(),
      chips:
        newLang === 'es'
          ? ['Mis facturas', 'Una carta', 'Mi cobertura']
          : ['My bills', 'A letter', 'My coverage'],
    };
    setMessages((prev) => [...prev, sysMessage]);
  }

  function resetConversation() {
    setConversationState(null);
    setSubmitState('idle');
    setMessages([
      {
        id: 'reset-' + Date.now(),
        text:
          language === 'es'
            ? 'Conversación reiniciada. ¿En qué puedo ayudarle hoy?'
            : 'Conversation reset. How can I help you today?',
        sender: 'bot',
        timestamp: new Date(),
        chips:
          language === 'es'
            ? ['Mis facturas', 'Una carta', 'Mi cobertura', 'Mis medicamentos']
            : ['My bills', 'A letter', 'My coverage', 'My medications'],
      },
    ]);
  }

  function handleEscalateManually() {
    if (conversationState) {
      escalateHandler(conversationState, messages);
    }
  }

  return (
    <div className="flex flex-col bg-cream-50 rounded-2xl shadow-lifted border border-cream-200 overflow-hidden max-w-3xl mx-auto">
      {/* Header */}
      <header className="bg-earth-800 text-cream-50 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-sage-300 flex items-center justify-center text-earth-900 flex-shrink-0">
            <Headphones className="w-5 h-5" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">
              {language === 'es' ? 'Guía de Soporte ClearPoint' : 'ClearPoint Support Guide'}
            </div>
            <div className="text-[11px] text-cream-200 font-normal">
              {language === 'es' ? 'Bilingüe · Para personas mayores · Sin costo' : 'Bilingual · Senior-friendly · No cost'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleLanguage}
            className="px-2.5 py-1 text-[12px] bg-earth-700 hover:bg-earth-600 rounded-full font-semibold"
            aria-label={language === 'es' ? 'Cambiar a inglés' : 'Switch to Spanish'}
            title={language === 'es' ? 'English' : 'Español'}
          >
            🌐 {language === 'es' ? 'EN' : 'ES'}
          </button>
          <button
            onClick={resetConversation}
            className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors"
            aria-label={language === 'es' ? 'Empezar de nuevo' : 'Start over'}
            title={language === 'es' ? 'Empezar de nuevo' : 'Start over'}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          {conversationState && submitState === 'idle' && (
            <button
              onClick={handleEscalateManually}
              className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors"
              aria-label={language === 'es' ? 'Hablar con un asesor' : 'Talk to an advisor'}
              title={language === 'es' ? 'Hablar con un asesor' : 'Talk to an advisor'}
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
        className="flex-1 overflow-y-auto overscroll-contain min-h-0 max-h-[64vh] md:max-h-[680px]"
      >
        {/* Persistent privacy / identity band — Phase 3 compliance */}
        <div className="bg-gold-100 border-b border-gold-200 px-4 py-2 text-[11.5px] leading-[1.45] text-earth-700">
          <p>
            {language === 'es'
              ? 'ClearPoint Senior Advisors es una agencia privada e independiente. No estamos conectados con Medicare ni con el gobierno federal. Por favor no envíe número de Medicare, Seguro Social, información bancaria ni récords médicos privados por aquí.'
              : 'ClearPoint Senior Advisors is a private independent agency. We are not connected with Medicare or the federal government. Please do not send Medicare ID, Social Security numbers, banking information, or private medical records here.'}
          </p>
        </div>

        <div className="px-4 py-4 space-y-3.5">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3.5 text-[14.5px] leading-[1.55] ${
                  m.sender === 'user'
                    ? 'bg-earth-800 text-cream-50 rounded-br-md'
                    : 'bg-white text-earth-800 shadow-xs border border-cream-200 rounded-bl-md'
                }`}
              >
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.chips && m.chips.length > 0 && m.sender === 'bot' && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {m.chips.slice(0, 4).map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleChipClick(chip)}
                        className="inline-flex items-center px-3 py-1.5 bg-cream-50 border border-cream-300 text-earth-700 rounded-full text-[12.5px] font-medium hover:bg-gold-100 hover:border-gold-400 hover:text-earth-900 transition-colors"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

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
              {language === 'es' ? 'Enviando su caso a un asesor licenciado…' : 'Sending your case to a licensed advisor…'}
            </div>
          )}
          {submitState === 'submitted' && (
            <div className="bg-sage-100 border border-sage-300 rounded-xl p-4 space-y-2">
              <div className="font-bold text-earth-900">
                {language === 'es' ? '✓ Listo. Un asesor licenciado se comunicará con usted.' : '✓ Got it. A licensed advisor will follow up.'}
              </div>
              <p className="text-earth-700 text-[13.5px]">
                {language === 'es'
                  ? 'Un asesor bilingüe de ClearPoint revisará su caso.'
                  : 'A bilingual ClearPoint advisor will review your case.'}
              </p>
            </div>
          )}
          {submitState === 'failed' && (
            <div className="bg-red-50 border border-red-300 rounded-xl p-4 space-y-3">
              <div className="font-bold text-red-900">
                {language === 'es' ? 'Su mensaje fue preparado, pero no pudimos confirmar el envío en este momento.' : 'Your message was prepared, but we could not confirm submission right now.'}
              </div>
              <a href="tel:18663108702" className="inline-flex items-center gap-1.5 px-4 py-3 bg-earth-800 text-cream-50 rounded-lg text-[14px] font-semibold min-h-[44px]">
                <Phone className="w-4 h-4" /> 1-866-310-8702
              </a>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Footer chrome — Call CTA + bilingual support badge */}
      <div className="px-3 py-2 border-t border-cream-200 flex-shrink-0 flex items-center gap-2 bg-white">
        <a
          href="tel:18663108702"
          className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors"
        >
          <Phone className="w-4 h-4" />
          {language === 'es' ? 'Llamar ahora' : 'Call now'}
        </a>
        <span className="text-earth-300 select-none" aria-hidden="true">·</span>
        <span className="text-[12px] text-earth-500">
          {language === 'es' ? 'Soporte bilingüe' : 'Bilingual support'}
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
            placeholder={language === 'es' ? 'Escriba su mensaje…' : 'Type your message…'}
            disabled={isTyping}
            className="flex-1 min-w-0 px-4 py-3 bg-white border border-cream-300 rounded-lg text-base text-earth-900 placeholder:text-earth-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 min-h-[48px] disabled:bg-cream-50 disabled:text-earth-400"
            aria-label={language === 'es' ? 'Escriba su mensaje' : 'Type your message'}
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || isTyping}
            className="px-4 py-3 bg-earth-800 text-cream-50 rounded-lg hover:bg-earth-900 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={language === 'es' ? 'Enviar' : 'Send'}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// LEAD NOTES + TAGS — GHL bridge for V13 escalation
// ============================================================================

function buildLeadNotes(state: ConversationState, transcript: string): string {
  const ent = state.extractedEntities;
  return [
    '[ClearPoint Support Guide — V13]',
    `Submitted: ${new Date().toISOString()}`,
    `Conversation ID: ${state.conversationId}`,
    `Language: ${state.language === 'es' ? 'Spanish' : 'English'}`,
    `Emotional state: ${state.emotionalState}`,
    `Turn count: ${state.turnCount}`,
    '',
    'CASE',
    `Primary intent: ${state.currentPrimaryIntent}`,
    `Document subtype: ${state.currentDocumentSubtype}`,
    `Intent stack: ${state.intentStack.map((i) => i.intent).join(' → ')}`,
    '',
    'EXTRACTED ENTITIES',
    `ZIP: ${ent.zipCode || 'not provided'}`,
    `Dollar amount: ${ent.dollarAmount != null ? '$' + ent.dollarAmount : 'not mentioned'}`,
    `Medicaid mentioned: ${ent.mentionedMedicaid ? 'YES' : 'no'}`,
    `Extra Help mentioned: ${ent.mentionedExtraHelp ? 'YES' : 'no'}`,
    `SNP mentioned: ${ent.mentionedSNP ? 'YES' : 'no'}`,
    '',
    'TRANSCRIPT',
    transcript,
    '',
    'RECOMMENDED NEXT ACTION',
    state.needsHuman
      ? 'A licensed advisor should follow up with the caller. Verify plan-specific details (doctors, medications, county, current coverage) before any recommendation.'
      : 'Educational follow-up. Licensed advisor may follow up if needed.',
  ].join('\n');
}

function buildTags(state: ConversationState): string[] {
  const tags: string[] = ['customer_service_bot', 'clearpoint_support', 'v13'];
  tags.push(state.language === 'es' ? 'spanish' : 'english');
  if (state.currentPrimaryIntent && state.currentPrimaryIntent !== 'unknown') {
    tags.push(state.currentPrimaryIntent);
  }
  if (state.currentDocumentSubtype && state.currentDocumentSubtype !== 'none') {
    tags.push(state.currentDocumentSubtype);
  }
  if (state.emotionalState !== 'calm') tags.push(`emotion_${state.emotionalState}`);
  if (state.needsHuman) tags.push('needs_agent_review');
  if (state.extractedEntities.mentionedMedicaid) tags.push('medicaid_mentioned');
  if (state.extractedEntities.mentionedExtraHelp) tags.push('extra_help_mentioned');
  return tags.slice(0, 20);
}

export default CustomerServiceBot;

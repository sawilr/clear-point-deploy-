// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9E — Voice input via Web Speech API.
//
// Senior-friendly: 70% of seniors prefer voice for chat interactions.
// Falls back gracefully when API is unavailable.
//
// Browser support: Chrome/Edge/Safari iOS/Android Chrome. Firefox lacks
// continuous recognition (returns "unsupported" cleanly).
// ─────────────────────────────────────────────────────────────────────────────

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
  resultIndex: number;
};

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface VoiceRecognizer {
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
}

export interface VoiceCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
  onEnd?: () => void;
}

export function isVoiceSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function createVoiceRecognizer(
  lang: 'en' | 'es',
  callbacks: VoiceCallbacks,
): VoiceRecognizer | null {
  if (!isVoiceSupported()) return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;

  let listening = false;
  const r = new Ctor();
  r.continuous = false;
  r.interimResults = true;
  r.lang = lang === 'es' ? 'es-US' : 'en-US';

  r.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) final += transcript;
      else interim += transcript;
    }
    if (interim && callbacks.onInterim) callbacks.onInterim(interim);
    if (final) callbacks.onFinal(final.trim());
  };

  r.onerror = (e) => {
    listening = false;
    if (callbacks.onError) callbacks.onError(e.error || 'unknown');
  };

  r.onend = () => {
    listening = false;
    if (callbacks.onEnd) callbacks.onEnd();
  };

  return {
    start: () => {
      if (listening) return;
      try { r.start(); listening = true; } catch (err) { /* already started */ }
    },
    stop: () => {
      if (!listening) return;
      try { r.stop(); } catch { /* no-op */ }
      listening = false;
    },
    isListening: () => listening,
  };
}

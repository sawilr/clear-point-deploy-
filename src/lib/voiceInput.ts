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
  // Fired when the user stops SPEAKING / audio capture ends — on iOS Safari and
  // mobile Chrome these often arrive even when `onend` never does.
  onspeechend: (() => void) | null;
  onaudioend: (() => void) | null;
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

  // ── Sawil 2026-07-12 MIC FIX (audited: mic stuck open on web + mobile) ─────
  // The old lifecycle reset ONLY on `onend`. On iOS Safari / mobile Chrome,
  // `onend` frequently never fires after a non-continuous session, so the red
  // mic button stayed on forever and further speech kept accumulating into one
  // long garbled blob (the reported transcription loop). finish() is the single
  // idempotent close path: clears timers, stop()s, then abort()s — abort is what
  // actually releases the OS microphone indicator on mobile — and fires onEnd
  // exactly once. Watchdogs guarantee close even when the browser goes silent:
  //   • 20s hard cap per session (start)
  //   • 1.5s after a FINAL result (browser should end itself; we don't trust it)
  //   • 1.2s after speech/audio end events
  let endFired = false;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const finish = () => {
    if (endFired) return;
    endFired = true;
    listening = false;
    clearTimers();
    try { r.stop(); } catch { /* no-op */ }
    try { r.abort(); } catch { /* no-op */ }
    if (callbacks.onEnd) callbacks.onEnd();
  };
  const armWatchdog = (ms: number) => { timers.push(setTimeout(finish, ms)); };

  r.onresult = (e) => {
    if (endFired) return; // session already closed — drop late results
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) final += transcript;
      else interim += transcript;
    }
    if (interim && callbacks.onInterim) callbacks.onInterim(interim);
    if (final) {
      callbacks.onFinal(final.trim());
      // Final received — the session is done saying anything useful. Close it
      // shortly even if the browser never fires onend (the stuck-mic bug).
      clearTimers();
      armWatchdog(1500);
    }
  };

  r.onerror = (e) => {
    if (callbacks.onError) callbacks.onError(e.error || 'unknown');
    finish();
  };

  r.onend = finish;
  // User stopped talking / audio capture ended — mobile browsers often fire
  // these even when onend never arrives. Give the final result a beat to land,
  // then force-close.
  r.onspeechend = () => { clearTimers(); armWatchdog(1200); };
  r.onaudioend = () => { clearTimers(); armWatchdog(1200); };

  return {
    start: () => {
      if (listening) return;
      endFired = false;
      clearTimers();
      try { r.start(); listening = true; armWatchdog(20000); } catch { /* already started */ }
    },
    stop: finish,
    isListening: () => listening,
  };
}

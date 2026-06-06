// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9E — Persistent conversation memory across browser sessions.
//
// Stores a summary of the last conversation in localStorage so the bot can
// greet returning visitors with continuity:
//   "Welcome back, María. Last time we talked about Plan G. Continue?"
//
// Stored AS-IS — no encryption (browser-local only, never sent to server
// unless user opts in by submitting a lead). Wrapped in try/catch for
// Safari Private Browsing safety.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'cp_visitor_memory_v1';
const TTL_MS = 60 * 24 * 3600 * 1000; // 60 days

export interface VisitorMemory {
  name?: string;
  zip?: string;
  state?: string;
  language?: 'en' | 'es';
  lastTopic?: string;
  lastSeen: number; // epoch ms
}

export function readVisitorMemory(): VisitorMemory | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VisitorMemory;
    if (!parsed || typeof parsed !== 'object') return null;
    // TTL check
    if (Date.now() - (parsed.lastSeen || 0) > TTL_MS) {
      try { localStorage.removeItem(KEY); } catch { /* no-op */ }
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeVisitorMemory(partial: Partial<VisitorMemory>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = readVisitorMemory() || ({ lastSeen: Date.now() } as VisitorMemory);
    const next: VisitorMemory = {
      ...existing,
      ...partial,
      lastSeen: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or quota — silently no-op */
  }
}

export function clearVisitorMemory(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

/** Build a returning-visitor greeting if there's prior memory. */
export function returningVisitorGreeting(
  mem: VisitorMemory | null,
  language: 'en' | 'es',
): string | null {
  if (!mem || !mem.name) return null;
  const firstName = mem.name.split(/\s+/)[0];
  const daysAgo = Math.floor((Date.now() - mem.lastSeen) / (24 * 3600 * 1000));
  const timeAgo = daysAgo < 1
    ? (language === 'es' ? 'hoy' : 'today')
    : daysAgo === 1
    ? (language === 'es' ? 'ayer' : 'yesterday')
    : language === 'es'
    ? `hace ${daysAgo} días`
    : `${daysAgo} days ago`;
  if (language === 'es') {
    const topic = mem.lastTopic ? ` Hablamos de ${mem.lastTopic}.` : '';
    return `Bienvenido de vuelta, ${firstName}. La última vez que estuvo aquí fue ${timeAgo}.${topic} ¿En qué le puedo ayudar hoy?`;
  }
  const topic = mem.lastTopic ? ` We talked about ${mem.lastTopic}.` : '';
  return `Welcome back, ${firstName}. Your last visit was ${timeAgo}.${topic} How can I help you today?`;
}

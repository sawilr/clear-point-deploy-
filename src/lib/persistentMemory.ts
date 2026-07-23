// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9E — Persistent conversation memory across browser sessions.
//
// AUDIT 2026-07-22 (KI-SEC-01) — this store MUST NOT hold PII. It previously
// persisted name+zip+state in cleartext localStorage for 60 days; any XSS or
// compromised third-party script could read them, and the stored identity
// produced wrong-name greetings for shared devices. It now keeps ONLY
// non-identifying continuity data (language, lastTopic, lastSeen). Old
// records are migrated on read: PII fields are stripped and the sanitized
// record is rewritten. Wrapped in try/catch for Safari Private Browsing.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'cp_visitor_memory_v1';
const TTL_MS = 60 * 24 * 3600 * 1000; // 60 days

export interface VisitorMemory {
  /** @deprecated PII — never written anymore; stripped on read (migration). */
  name?: string;
  /** @deprecated PII — never written anymore; stripped on read (migration). */
  zip?: string;
  /** @deprecated PII — never written anymore; stripped on read (migration). */
  state?: string;
  language?: 'en' | 'es';
  lastTopic?: string;
  lastSeen: number; // epoch ms
}

/** Non-PII projection — the ONLY shape ever persisted. */
function sanitize(mem: VisitorMemory): VisitorMemory {
  return {
    language: mem.language === 'es' || mem.language === 'en' ? mem.language : undefined,
    lastTopic: typeof mem.lastTopic === 'string' ? mem.lastTopic.slice(0, 80) : undefined,
    lastSeen: mem.lastSeen,
  };
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
    // MIGRATION — legacy records carry name/zip/state: strip and rewrite so
    // the PII disappears from disk on the visitor's first return.
    if (parsed.name !== undefined || parsed.zip !== undefined || parsed.state !== undefined) {
      const clean = sanitize(parsed);
      try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* no-op */ }
      return clean;
    }
    return sanitize(parsed);
  } catch {
    return null;
  }
}

export function writeVisitorMemory(partial: Partial<VisitorMemory>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = readVisitorMemory() || ({ lastSeen: Date.now() } as VisitorMemory);
    const next: VisitorMemory = sanitize({
      ...existing,
      ...partial,
      lastSeen: Date.now(),
    });
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or quota — silently no-op */
  }
}

export function clearVisitorMemory(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

/** Build a returning-visitor greeting if there's prior memory.
 *
 * AUDIT 2026-07-22 — names are no longer stored (KI-SEC-01), so the greeting
 * is topic-based continuity only. It never attributes an identity, which also
 * closes the shared-device wrong-name greeting (CL-LANG-15). Renders in the
 * CURRENT experience language passed by the caller — never a stored one.
 */
export function returningVisitorGreeting(
  mem: VisitorMemory | null,
  language: 'en' | 'es',
): string | null {
  if (!mem || !mem.lastTopic) return null;
  if (language === 'es') {
    return `Bienvenido de vuelta. La última vez hablamos de ${mem.lastTopic}. ¿En qué le puedo ayudar hoy? ¿Prefiere continuar en español o en inglés?`;
  }
  return `Welcome back. Last time we talked about ${mem.lastTopic}. How can I help you today? Would you prefer English or Spanish?`;
}

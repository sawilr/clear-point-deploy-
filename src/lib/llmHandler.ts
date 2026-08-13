// ─────────────────────────────────────────────────────────────────────────────
// LLM HANDLER — calls `/api/chat` for conversational turns.
//
// Used by the engine for the "topic discussion" middle phase. Structural
// steps (ZIP, name+phone capture, GHL submit) stay in the engine.
//
// Returns:
//   { ok: true, response, meta }  ← live LLM reply
//   { ok: false, reason }         ← API unavailable; engine falls back to regex
//
// The browser NEVER touches the API key — it just hits /api/chat.
// ─────────────────────────────────────────────────────────────────────────────

import { scrubSensitiveText } from './phiPatterns';

export interface LLMTurn { role: 'user' | 'assistant'; content: string }

export interface LLMContext {
  language?: 'en' | 'es' | null;
  zipCode?: string;
  state?: string;
  name?: string;
  phoneNumber?: string;
  email?: string;
  scheduledCallbackWindow?: string;
  conversationClosed?: boolean;
  advisorHandoffStarted?: boolean;
  serviceCategory?: string;
  advisorOfferDismissed?: boolean;
  clarificationCount?: number;
  /** AUDIT 2026-08-13 — caller revoked contact this session (rule 12). */
  contactOptedOut?: boolean;
}

export interface LLMResponse {
  ok: true;
  response: string;
  meta: {
    wantHandoff: boolean;
    wantClose: boolean;
    wantSchedule: boolean;
    usage?: unknown;
  };
}

export interface LLMFailure {
  ok: false;
  reason: 'no_api' | 'http' | 'network' | 'timeout' | 'parse';
  status?: number;
}

const ENDPOINT = '/api/chat';
const TIMEOUT_MS = 12_000;

/** Build the Anthropic-format history from the engine's messages array.
 *
 * AUDIT 2026-07-23 (P0-01) — every turn is scrubbed client-side before it can
 * travel to /api/chat. A sensitive value that slipped into messages[] (e.g. a
 * blocked-then-stored SSN from an older session, or a pattern the UI gate
 * missed) is replaced with a placeholder here, so the reusable LLM history
 * never carries the original value. Server-side scrubPHI stays as the final
 * defense.
 */
export function buildHistory(
  messages: Array<{ role: 'user' | 'bot'; content: string }>,
): LLMTurn[] {
  const out: LLMTurn[] = [];
  for (const m of messages) {
    if (!m || !m.content) continue;
    const content = scrubSensitiveText(m.content);
    if (m.role === 'user') out.push({ role: 'user', content });
    else if (m.role === 'bot') out.push({ role: 'assistant', content });
  }
  // Cap to last 20 turns (Anthropic charges by token count).
  return out.slice(-20);
}

export async function callLLM(
  userMessage: string,
  history: LLMTurn[],
  context: LLMContext,
): Promise<LLMResponse | LLMFailure> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userMessage, history, context }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (r.status === 503) {
      // Server reports API key not configured → engine will use regex.
      return { ok: false, reason: 'no_api' };
    }
    if (!r.ok) {
      return { ok: false, reason: 'http', status: r.status };
    }
    const data = await r.json().catch(() => null);
    if (!data || typeof data.response !== 'string') {
      return { ok: false, reason: 'parse' };
    }
    return {
      ok: true,
      response: data.response,
      meta: {
        wantHandoff: !!(data.meta && data.meta.wantHandoff),
        wantClose: !!(data.meta && data.meta.wantClose),
        wantSchedule: !!(data.meta && data.meta.wantSchedule),
        usage: data.meta?.usage,
      },
    };
  } catch (e) {
    clearTimeout(timer);
    const isAbort = (e as { name?: string })?.name === 'AbortError';
    return { ok: false, reason: isAbort ? 'timeout' : 'network' };
  }
}

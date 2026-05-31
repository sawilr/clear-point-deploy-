// Wave 51 — Conversation memory. A human customer service rep REMEMBERS
// what the customer said earlier. The bot should too.
//
// Use case: user says "me esta cobrando medicare" (cost-of-medicare).
// Bot misses the intent. Later user says "pregunte de ahorrar" — the bot
// should look back through the conversation, see that "ahorrar" / cost
// was mentioned, and route to savings_program instead of asking another menu.

import { classifyIntent } from './classifyIntent';
import { correctTypos } from './typoCorrect';

interface BotMessage { role: 'bot' | 'user'; content: string; timestamp?: number }

export interface MemoryHit {
  intent: string;
  fromMessage: string;
  turnIdx: number;
  score: number;
}

/**
 * Scan ALL prior user messages and return the strongest intent classification
 * found in any of them. Useful when the current turn alone is too vague.
 */
export function findStrongestPriorIntent(
  messages: BotMessage[],
  options: { excludeIntents?: string[]; minScore?: number } = {},
): MemoryHit | null {
  const minScore = options.minScore ?? 0.6;
  const exclude = new Set(options.excludeIntents || ['general', 'casual']);
  let best: MemoryHit | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const corrected = correctTypos(m.content);
    const r = classifyIntent(corrected);
    if (r.intent && !r.isAmbiguous && r.score >= minScore && !exclude.has(r.intent)) {
      if (!best || r.score > best.score) {
        best = {
          intent: r.intent,
          fromMessage: m.content,
          turnIdx: i,
          score: r.score,
        };
      }
    }
  }
  return best;
}

/**
 * Detect "I asked about X" / "pregunté por X" / "ya te dije X" references.
 * Returns true if the current message references a prior turn rather than
 * starting a new topic.
 */
export function isBackReference(text: string): boolean {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /\b(ya te dije|ya le dije|ya dije|ya pregunte|pregunte (de|por|sobre)|pregunto (de|por|sobre)|te dije|le dije|i (already )?(told|said|asked|mentioned)|i asked (about|for)|like i said|i was asking)\b/i.test(t);
}

/**
 * Pull out the topic noun the user is referring to in a back-reference.
 * "pregunte de ahorrar" → "ahorrar"
 * "I asked about my doctor" → "my doctor"
 */
export function extractReferenceSubject(text: string): string | null {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = t.match(/\b(?:pregunte (?:de|por|sobre)|i asked (?:about|for)|i was asking about|like i said about)\s+(.{2,40})/);
  if (m) return m[1].trim();
  return null;
}

// Wave 50 — Intent classifier with explicit scoring + ambiguity resolution.
//
// Replaces the regex-roulette in detectProblemType. Every intent is scored;
// best wins iff it clears its threshold AND beats the runner-up by a margin.
//
// Output is rich (top score, runner-up, all candidates) so the engine can:
//   • Route to a handler when confident.
//   • Disambiguate when two are close.
//   • Ask a clarifying question when nothing clears threshold.
//   • Pivot to advisor when stuck.

import { INTENT_CATALOG } from './intentCatalog';
import type { IntentName, IntentPattern } from './intentCatalog';

export interface ClassifyResult {
  /** Best intent that cleared its threshold; null if none. */
  intent: IntentName | null;
  /** Score of the chosen intent (0-1). */
  score: number;
  /** Second-best intent and score, for disambiguation. */
  runnerUp: { intent: IntentName; score: number } | null;
  /** True when top-2 are within the margin (default 0.2). */
  isAmbiguous: boolean;
  /** Full ranked list. Useful for debugging / telemetry. */
  ranked: Array<{ intent: IntentName; score: number; matchedTags: string[] }>;
  /** True when NO intent crossed its threshold. */
  isUnclear: boolean;
}

function scorePatterns(text: string, patterns: IntentPattern[]): { score: number; tags: string[] } {
  let total = 0;
  const tags: string[] = [];
  for (const p of patterns) {
    if (p.re.test(text)) {
      total += p.weight;
      if (p.tag) tags.push(p.tag);
    }
  }
  // Cap at 1.0 — multiple matches in same intent shouldn't snowball past one.
  return { score: Math.min(1.0, total), tags };
}

/** Margin: top must beat runner-up by this much to NOT be ambiguous. */
const AMBIGUITY_MARGIN = 0.2;

export function classifyIntent(text: string): ClassifyResult {
  if (!text || typeof text !== 'string') {
    return { intent: null, score: 0, runnerUp: null, isAmbiguous: false, ranked: [], isUnclear: true };
  }
  // Lowercase + accent-strip for the main pass; original kept for regex
  // that intentionally uses casing or accents.
  const lower = text.toLowerCase();
  const stripped = lower.normalize('NFD').replace(/[̀-ͯ]/g, '');

  const ranked: Array<{ intent: IntentName; score: number; matchedTags: string[] }> = [];

  for (const [name, spec] of Object.entries(INTENT_CATALOG) as [IntentName, typeof INTENT_CATALOG[IntentName]][]) {
    if (name === 'general') continue;
    // Try the matcher against BOTH lowered + accent-stripped, take the max.
    const a = scorePatterns(lower, spec.positives);
    const b = scorePatterns(stripped, spec.positives);
    let score = Math.max(a.score, b.score);
    const tags = a.score >= b.score ? a.tags : b.tags;

    // Subtract negatives (false-friend guards). We use the same text variants.
    if (spec.negatives && spec.negatives.length) {
      const na = scorePatterns(lower, spec.negatives);
      const nb = scorePatterns(stripped, spec.negatives);
      score = Math.max(0, score - Math.max(na.score, nb.score));
    }

    if (score > 0) ranked.push({ intent: name, score, matchedTags: tags });
  }

  ranked.sort((a, b) => b.score - a.score);

  const top = ranked[0] || null;
  const runner = ranked[1] || null;

  if (!top) {
    return { intent: null, score: 0, runnerUp: null, isAmbiguous: false, ranked: [], isUnclear: true };
  }

  const topSpec = INTENT_CATALOG[top.intent];
  const threshold = topSpec.threshold ?? 0.5;
  if (top.score < threshold) {
    return {
      intent: null,
      score: top.score,
      runnerUp: runner ? { intent: runner.intent, score: runner.score } : null,
      isAmbiguous: false,
      ranked,
      isUnclear: true,
    };
  }

  const isAmbiguous = !!runner && (top.score - runner.score) < AMBIGUITY_MARGIN
    && runner.score >= (INTENT_CATALOG[runner.intent].threshold ?? 0.5);

  return {
    intent: top.intent,
    score: top.score,
    runnerUp: runner ? { intent: runner.intent, score: runner.score } : null,
    isAmbiguous,
    ranked,
    isUnclear: false,
  };
}

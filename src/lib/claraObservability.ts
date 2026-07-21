// ─────────────────────────────────────────────────────────────────────────────
// FASE 18 — Clara observability (PII-free).
//
// Tiny event/metric layer for the hardened Clara flow. Emits ONLY event names
// and non-identifying booleans/counters — never names, phones, emails, ZIPs,
// message text, or any PII. Three sinks, all safe:
//   1. `clara:metric` CustomEvent on window (analytics can forward it later)
//   2. Aggregate counters in sessionStorage (survives the conversation only)
//   3. DEV console (build-time gated)
// Never throws; observability must never break the conversation.
// ─────────────────────────────────────────────────────────────────────────────

const COUNTER_KEY = 'cp_clara_metrics_v1';

export type ClaraEventName =
  | 'identity_mismatch'      // caller said the remembered name is not them
  | 'session_reset'          // active-session identity wiped, fresh start
  | 'handoff_started'        // [HANDOFF] accepted → contact collection began
  | 'phone_invalid'          // phone failed validation
  | 'email_invalid'          // email failed validation (TLD/shape/junk)
  | 'email_skipped'          // caller skipped optional email
  | 'time_out_of_hours'      // requested callback outside business hours
  | 'crm_submit_ok'          // submit-lead confirmed by backend
  | 'crm_submit_failed'      // submit-lead failed / not confirmed
  | 'human_fallback'         // bot stopped guessing, escalated to human review
  | 'flag_evaluated';        // CLARA_HARDENED_FLOW resolved

/** Emit a PII-free Clara event. `detail` must contain only booleans/numbers. */
export function claraEvent(name: ClaraEventName, detail?: Record<string, boolean | number | string>): void {
  try {
    // Guard: strip anything that looks like it could carry PII — only allow
    // short primitive values. Defensive: callers should already pass none.
    const safe: Record<string, boolean | number | string> = {};
    if (detail) {
      for (const [k, v] of Object.entries(detail)) {
        if (typeof v === 'boolean' || typeof v === 'number') safe[k] = v;
        else if (typeof v === 'string' && v.length <= 32 && !/[@\d]{7,}/.test(v)) safe[k] = v;
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('clara:metric', { detail: { event: name, ...safe, ts: Date.now() } }));
    }
    bumpCounter(name);
    if (import.meta.env.DEV) {
      console.info('[clara-metric]', name, safe);
    }
  } catch { /* observability never breaks the flow */ }
}

function bumpCounter(name: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(COUNTER_KEY);
    const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
    counts[name] = (counts[name] || 0) + 1;
    sessionStorage.setItem(COUNTER_KEY, JSON.stringify(counts));
  } catch { /* no-op */ }
}

/** Aggregate counters for this browser session (diagnostics / tests). */
export function claraMetricCounts(): Record<string, number> {
  if (typeof sessionStorage === 'undefined') return {};
  try { return JSON.parse(sessionStorage.getItem(COUNTER_KEY) || '{}'); } catch { return {}; }
}

// ─── FASE 2 — identity denial detection ──────────────────────────────────────
// Two tiers, deliberately conservative so ordinary sentences never reset:
//   1. UNIVERSAL denials — unambiguous regardless of the name ("ese no soy yo",
//      "no me llamo así", "wrong person", shared phone/device).
//   2. NAME-BOUND denials — "no es X" / "no soy X" / "I'm not X" count ONLY
//      when X is the remembered first name. This is what stops "no es justo",
//      "no es verdad", "I'm not sure" from wiping the session.
const UNIVERSAL_DENIAL_RES: RegExp[] = [
  /\bese no soy yo\b/i,
  /\bno me llamo\b/i,
  /\bse equivoc(o|ó) de persona\b/i,
  /\besa cuenta no es m(i|í)a\b/i,
  /\b(es el|este) tel(e|é)fono (de otra persona|lo usa mi)\b/i,
  /\bdispositivo (es )?compartido\b/i,
  /\bthat'?s not me\b/i,
  /\bwrong person\b/i,
  /\bthat account is'?n?o?t mine\b/i,
  /\bnot my account\b/i,
];

const _fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** True when the message denies the remembered identity. `rememberedName` is
 *  the stored name we greeted with; name-bound patterns require it to match. */
export function isIdentityDenial(message: string, rememberedName?: string): boolean {
  const m = (message || '').trim();
  if (!m || m.length > 120) return false;
  if (UNIVERSAL_DENIAL_RES.some((re) => re.test(m))) return true;
  const first = _fold((rememberedName || '').split(/\s+/)[0] || '');
  if (!first) return false;
  const nm = _fold(m);
  // "no es antonio" / "no soy antonio" / "i'm not antonio" / "it's not antonio"
  return new RegExp(`\\b(no (soy|es)|i'?m not|it'?s not|this is not|no me digas?)\\s+${first.replace(/[.*+?^${}()|[\]\\]/g, '')}\\b`, 'i').test(nm);
}

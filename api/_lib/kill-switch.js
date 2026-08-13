// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-08-13 (§12) — RUNTIME KILL SWITCHES.
//
// WHY THIS EXISTS. The incident-response review recorded an honest limitation:
// every way to disable a capability was an environment change plus a REDEPLOY.
// I first classified that DEFERRED-SCALE, which was the wrong call — §12 lists
// an "AI kill switch" and a "workflow kill switch" as REQUIRED incident-response
// capabilities, and the reason is timing: during a live incident the containment
// window is minutes, and a redeploy is a build queue you do not control.
//
// DESIGN CONSTRAINTS, and why it is built exactly this way:
//
// 1. ENV-VAR DRIVEN, NOT DATABASE DRIVEN. A kill switch that depends on the CRM,
//    the KV store, or any network call is useless in precisely the incidents you
//    need it for — the ones where that dependency is what broke. Env vars are
//    read from the function's own process, so the switch cannot be taken out by
//    an outage. On this platform, changing an env var takes effect on new
//    invocations without a rebuild.
//
// 2. FAIL-OPEN ON READ, FAIL-CLOSED ON MEANING. If the variable is absent or
//    malformed the system behaves NORMALLY (an unreadable switch must never take
//    the site down by accident). But when a switch IS set, the effect is always
//    to REMOVE capability, never to grant it. So a mistake in this file can only
//    ever make Clear Point quieter, not louder.
//
// 3. EXPLICIT TRUTHY VALUES ONLY. '1' | 'true' | 'on' | 'yes'. Not "any
//    non-empty string" — that turns a stray space or a copy-paste newline into an
//    outage. Not '0'/'false' as strings-that-are-truthy either, which is the
//    classic version of this bug.
//
// 4. EVERY TRIP IS LOGGED. A silent kill switch is an outage with no explanation;
//    the next person debugging deserves to see why the endpoint went quiet.
//
// USAGE DURING AN INCIDENT (no redeploy, no build):
//   CP_KILL_ALL=1        every AI + lead-capture endpoint returns a safe refusal
//   CP_KILL_AI=1         the LLM bridge only — both assistants fall back to their
//                        deterministic engines and the site keeps working
//   CP_KILL_LEADS=1      lead submission only — the form tells the caller to phone
//   CP_KILL_OPTOUT=1     the suppression endpoint (use with extreme care: this
//                        stops us HONORING revocations, so it is here only for a
//                        scenario where the endpoint itself is being abused)
//
// The user-facing copy for a tripped switch always routes the beneficiary to a
// human on the phone. Killing a capability must never leave a senior with a dead
// end and no way to reach anyone.
// ─────────────────────────────────────────────────────────────────────────────

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);

function isOn(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * @param {'ai'|'leads'|'optout'} capability
 * @returns {{killed: boolean, reason: string}}
 */
export function killState(capability) {
  if (isOn('CP_KILL_ALL')) return { killed: true, reason: 'CP_KILL_ALL' };
  const map = { ai: 'CP_KILL_AI', leads: 'CP_KILL_LEADS', optout: 'CP_KILL_OPTOUT' };
  const varName = map[capability];
  if (varName && isOn(varName)) return { killed: true, reason: varName };
  return { killed: false, reason: '' };
}

/** Bilingual, human-routing refusal copy per capability. */
const COPY = {
  ai: {
    en: "I'm briefly unavailable for open questions right now. A licensed ClearPoint advisor can help you directly at 1-855-720-8555, Monday to Friday 9am–6pm ET.",
    es: 'En este momento no estoy disponible para preguntas abiertas. Un asesor licenciado de ClearPoint puede ayudarle directamente al 1-855-720-8555, de lunes a viernes de 9am a 6pm ET.',
  },
  leads: {
    en: 'We could not submit your request right now. Please call us at 1-855-720-8555 and a licensed advisor will help you directly.',
    es: 'No pudimos enviar su solicitud en este momento. Por favor llámenos al 1-855-720-8555 y un asesor licenciado le ayudará directamente.',
  },
  optout: {
    en: 'Please call 1-855-720-8555 so we can record your request to stop contact.',
    es: 'Por favor llame al 1-855-720-8555 para que registremos su solicitud de no ser contactado.',
  },
};

/**
 * Check a capability and, if killed, WRITE the response and return true.
 * Caller contract: `if (enforceKill(res, 'ai', lang)) return;`
 *
 * Returns 200 for the AI path deliberately: the assistants treat a non-200 as an
 * error and may show a broken state, whereas a 200 carrying safe copy degrades
 * cleanly into a normal-looking message. Lead/opt-out paths use 503 because
 * their callers already handle failure and must NOT report a false success.
 */
export function enforceKill(res, capability, lang) {
  const state = killState(capability);
  if (!state.killed) return false;
  const l = lang === 'es' ? 'es' : 'en';
  const text = (COPY[capability] || COPY.ai)[l];
  console.warn('[KILL-SWITCH] ' + capability + ' disabled by ' + state.reason);
  if (capability === 'ai') {
    res.status(200).json({
      response: text,
      meta: { wantHandoff: false, wantClose: false, wantSchedule: false, blocked: 'kill_switch' },
    });
  } else {
    res.status(503).json({ error: 'CAPABILITY_DISABLED', message: text });
  }
  return true;
}

/** Every switch's current state — for a health endpoint or an incident log. */
export function killSwitchReport() {
  return {
    all: isOn('CP_KILL_ALL'),
    ai: isOn('CP_KILL_AI'),
    leads: isOn('CP_KILL_LEADS'),
    optout: isOn('CP_KILL_OPTOUT'),
  };
}

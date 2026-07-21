// ─────────────────────────────────────────────────────────────────────────────
// FASE 1 — Feature flag: CLARA_HARDENED_FLOW
//
// Gates the hardened Clara customer-service flow (identity isolation, dual-intent
// comprehension, phone/time/email validation, honest CRM confirmation) so the
// previous flow stays available as an instant fallback during rollout.
//
// Control surface (build-time, NOT a secret, NOT user-writable):
//   VITE_CLARA_HARDENED_FLOW =
//     'off'      → hardened flow disabled for everyone (DEFAULT)
//     'dev'      → enabled only in a dev build (import.meta.env.DEV)
//     'staging'  → enabled only on the staging host allowlist
//     'internal' → enabled only for internal testers (cp_internal=1 marker)
//     '<0-100>'  → percentage rollout, bucketed by a stable anonymous id
//     'global'   → enabled for everyone
//
// A change to the rollout requires only redeploying with a new env value — no
// code edit. The mode is baked at build time; the browser cannot alter it. The
// per-visitor bucket in localStorage is a stable random assignment only: editing
// it moves that ONE visitor within their own session and can never force-enable
// the flow for anyone else or expose another version's data.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET_KEY = 'cp_clara_bucket_v1';
const INTERNAL_KEY = 'cp_internal';
const STAGING_HOSTS = ['staging.clearpointsenioradvisors.com', 'localhost', '127.0.0.1'];

type FlagMode = 'off' | 'dev' | 'staging' | 'internal' | 'global' | string;

function rawMode(): FlagMode {
  const v = (import.meta.env.VITE_CLARA_HARDENED_FLOW ?? 'off') as string;
  return String(v).trim().toLowerCase();
}

/** Stable 0-99 bucket for this browser (random once, then persistent). */
function visitorBucket(): number {
  if (typeof localStorage === 'undefined') return 100; // SSR / no storage → never in a partial rollout
  try {
    const existing = localStorage.getItem(BUCKET_KEY);
    if (existing !== null) {
      const n = parseInt(existing, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 99) return n;
    }
    // crypto for an unbiased assignment; Math.random fallback for old engines.
    let n: number;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      n = a[0] % 100;
    } else {
      n = Math.floor(Math.random() * 100);
    }
    localStorage.setItem(BUCKET_KEY, String(n));
    return n;
  } catch {
    return 100;
  }
}

function isInternalTester(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(INTERNAL_KEY) === '1'; } catch { return false; }
}

function isStagingHost(): boolean {
  if (typeof location === 'undefined') return false;
  return STAGING_HOSTS.includes(location.hostname);
}

let _logged = false;

/** True when the hardened Clara flow should run for this visitor. */
export function isClaraHardened(): boolean {
  const mode = rawMode();
  let on = false;
  switch (mode) {
    case 'off': on = false; break;
    case 'global': on = true; break;
    case 'dev': on = !!import.meta.env.DEV; break;
    case 'staging': on = isStagingHost(); break;
    case 'internal': on = isInternalTester() || !!import.meta.env.DEV; break;
    default: {
      const pct = parseInt(mode, 10);
      on = Number.isFinite(pct) && pct > 0 ? visitorBucket() < pct : false;
      break;
    }
  }
  // Log the flag state once per session (no PII; dev console + a lightweight
  // observability hook the app can forward). Never throws.
  if (!_logged) {
    _logged = true;
    try {
      if (import.meta.env.DEV) {
        console.info('[clara-flag] CLARA_HARDENED_FLOW mode=%s resolved=%s', mode, on);
      }
      window.dispatchEvent(new CustomEvent('clara:flag', { detail: { flag: 'CLARA_HARDENED_FLOW', mode, resolved: on } }));
    } catch { /* no-op */ }
  }
  return on;
}

/** Diagnostic snapshot (used by tests / observability, never for control). */
export function claraFlagState(): { mode: string; resolved: boolean } {
  return { mode: rawMode(), resolved: isClaraHardened() };
}

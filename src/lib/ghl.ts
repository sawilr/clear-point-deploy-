/**
 * GoHighLevel Lead Submission Utility
 * Submits to /api/submit-lead (Vercel serverless function).
 */

export interface GHLLeadPayload {
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string;
  zip_code: string;
  preferred_language: string;
  medicare_status: string;
  interest_type: string;
  best_time_to_contact: string;
  consent_to_contact: boolean;
  consent_text: string;
  lead_notes: string;
  bot_transcript_summary: string;
  source: string;
  page_url: string;
  form_name: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  tags?: string[];
  created_at: string;
  // Sawil 2026-06-30 AUDIT FIX (CODE-005) — the lead surfaces (Zara, Smart Review,
  // Clara, LeadForm) build these optional fields and submitLeadToGHL forwards them.
  // They were previously read via `(payload as any)` — 28 casts on the revenue path,
  // where a typo or shape change would pass silently. Model them so the compiler checks.
  zip?: string;
  date_of_birth?: string;
  calculated_age?: number;
  city?: string;
  county?: string;
  state?: string;
  derived_state?: string;
  source_component?: string;
  lead_type?: string;
  lead_quality_flags?: string;
  website_url?: string;
  ghl_contact_id?: string;
  ghl_assigned_user_id?: string;
  consent?: boolean | string;
  consent_sms?: boolean | string;
  consent_call?: boolean | string;
  consent_receipt_hash?: string;
  disclaimer_version?: string;
  signer_user_agent?: string;
  signer_ip?: string;
  // Sawil 2026-07-09 SECURITY — ms between form render and submit. Server-side
  // min-fill-time bot gate (only enforced when present; other surfaces omit it).
  elapsed_ms?: number;
}

const API_ROUTE = '/api/submit-lead';

// ── Cloudflare Turnstile (anti-bot challenge — AUDIT 2026-08-15, target 1) ───
// Feature-gated: everything below is inert unless VITE_TURNSTILE_SITEKEY was
// set at build time. Token acquisition lives HERE because every lead surface
// (LeadForm, SmartMedicareReview, Zara ChatBot, Clara CustomerServiceBot)
// funnels through submitLeadToGHL, so one integration covers them all.
//
// The token is verified SERVER-side in api/submit-lead.js (fail closed when
// TURNSTILE_SECRET is configured) — the client never decides pass/fail, it
// only attaches the token. If acquisition fails here (script blocked, network,
// Cloudflare outage) we still submit WITHOUT a token: in enforce mode the
// server rejects with a clear message that includes the phone fallback; with
// enforcement off the lead flows exactly as today. That keeps this client
// forward- and backward-compatible with every server mode.
//
// UX/a11y: the widget renders in "execute" mode inside a fixed, centered,
// on-top container that stays EMPTY (renders nothing) unless Cloudflare needs
// user interaction — in which case the iframe paints inside it, reachable by
// mouse, touch, keyboard, and screen reader. Seniors on the normal path see
// nothing and click nothing.
const TURNSTILE_SITEKEY: string = (import.meta.env.VITE_TURNSTILE_SITEKEY as string | undefined) ?? '';
const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_TOKEN_TIMEOUT_MS = 12000;

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined;
  execute: (widgetId: string) => void;
  remove?: (widgetId: string) => void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let turnstileLoader: Promise<boolean> | null = null;
function loadTurnstileScript(): Promise<boolean> {
  if (turnstileLoader) return turnstileLoader;
  turnstileLoader = new Promise<boolean>((resolve) => {
    if ((window as TurnstileWindow).turnstile) { resolve(true); return; }
    const s = document.createElement('script');
    const timer = setTimeout(() => { turnstileLoader = null; resolve(false); }, 10000);
    s.src = TURNSTILE_SCRIPT_URL;
    s.async = true;
    s.onload = () => { clearTimeout(timer); resolve(!!(window as TurnstileWindow).turnstile); };
    s.onerror = () => {
      clearTimeout(timer);
      // Allow a later submission to retry the script load (transient network).
      turnstileLoader = null;
      resolve(false);
    };
    document.head.appendChild(s);
  });
  return turnstileLoader;
}

/** Acquire a fresh single-use Turnstile token, or '' on any failure. A fresh
 *  widget is rendered per call (tokens are single-use; a retried submission
 *  must never reuse a spent token — Cloudflare rejects those). */
async function getTurnstileToken(): Promise<string> {
  if (!TURNSTILE_SITEKEY || typeof document === 'undefined') return '';
  const loaded = await loadTurnstileScript();
  const ts = loaded ? (window as TurnstileWindow).turnstile : undefined;
  if (!ts) return '';
  let container: HTMLDivElement | null = null;
  let widgetId: string | undefined;
  try {
    container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '110px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '70';
    document.body.appendChild(container);
    return await new Promise<string>((resolve) => {
      let settled = false;
      const settle = (v: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => settle(''), TURNSTILE_TOKEN_TIMEOUT_MS);
      try {
        widgetId = ts.render(container as HTMLElement, {
          sitekey: TURNSTILE_SITEKEY,
          execution: 'execute',
          'refresh-expired': 'never',
          callback: (t: string) => settle(typeof t === 'string' ? t : ''),
          'error-callback': () => settle(''),
          'timeout-callback': () => settle(''),
          'unsupported-callback': () => settle(''),
        });
        if (widgetId != null) ts.execute(widgetId);
        else settle('');
      } catch {
        settle('');
      }
    });
  } catch {
    return '';
  } finally {
    try { if (widgetId != null && ts.remove) ts.remove(widgetId); } catch { /* widget already gone */ }
    try { container?.remove(); } catch { /* already detached */ }
  }
}

// Sawil 2026-07-09 — HTTP status of the most recent submit. Lets LeadForm show a
// specific "too many attempts" message on 429 WITHOUT changing this function's
// boolean contract (ChatBot / SmartReview / CustomerServiceBot stay untouched).
let lastSubmitStatus = 0;
export function getLastSubmitStatus(): number {
  return lastSubmitStatus;
}

export async function submitLeadToGHL(payload: GHLLeadPayload): Promise<boolean> {
  try {
    // Bridge: forward ALL payload fields to api/submit-lead.js
    // Build body from payload, mapping alternate field names when primary is missing
    const body: Record<string, unknown> = {
      first_name: payload.first_name,
      last_name: payload.last_name || '',
      phone: payload.phone,
      email: payload.email,
      zip: payload.zip || payload.zip_code || '',
      preferred_language: payload.preferred_language === 'Spanish' ? 'es'
        : payload.preferred_language === 'English' ? 'en'
        : payload.preferred_language || 'en',
      medicare_status: payload.medicare_status || '',
      lead_source: payload.source || 'Website',
      utm_source: payload.utm_source || '',
      utm_medium: payload.utm_medium || '',
      utm_campaign: payload.utm_campaign || '',
    };

    // Forward rich fields when present (arrays preserved, long text preserved)
    if (payload.lead_notes) { body.lead_notes = payload.lead_notes; }
    if (payload.bot_transcript_summary) { body.conversation_summary = payload.bot_transcript_summary; }
    if (payload.lead_quality_flags) { body.lead_quality_flags = payload.lead_quality_flags; }
    if (payload.interest_type) { body.interest_type = payload.interest_type; }
    // AUDIT 2026-07-03 Phase 3 — best_time_to_contact was declared on the payload
    // and populated by every surface (LeadForm dropdown, Zara intake, Clara engine)
    // but never copied into the request body, so the senior's chosen callback
    // window died here and never reached the CRM. Forward it; the server persists
    // it as a structured note line + CallTime-* tag.
    if (payload.best_time_to_contact) { body.best_time_to_contact = payload.best_time_to_contact; }
    if (payload.date_of_birth) { body.date_of_birth = payload.date_of_birth; }
    if (payload.calculated_age != null) { body.calculated_age = payload.calculated_age; }
    if (payload.city) { body.city = payload.city; }
    if (payload.county) { body.county = payload.county; }
    // derived_state → state mapping
    if (payload.derived_state) {
      body.state = payload.derived_state;
    } else if (payload.state) {
      body.state = payload.state;
    }
    if (payload.source_component) { body.source_component = payload.source_component; }
    // Forward the unified TCPA consent (consent_to_contact). Smart Review, Zara,
    // and LeadForm each build this as a real boolean and gate submission on it.
    // The api/submit-lead.js consent derivation treats consent_to_contact as the
    // umbrella TCPA signal covering marketing calls + SMS.
    if (payload.consent_to_contact != null) { body.consent_to_contact = payload.consent_to_contact; }
    if (payload.consent != null) { body.consent = payload.consent; }
    if (payload.consent_sms != null) { body.consent_sms = payload.consent_sms; }
    if (payload.consent_call != null) { body.consent_call = payload.consent_call; }
    // Tags: preserve array as-is
    if (Array.isArray(payload.tags) && payload.tags.length > 0) { body.tags = payload.tags; }
    // Honeypot anti-bot field — forward to API so the server-side gate can
    // discard bot submissions. Real users never see or fill this field; it
    // arrives empty (''). The API discards any submission where it's non-empty.
    if (payload.website_url !== undefined) { body.website_url = payload.website_url; }
    // PHASE 11 — Phase 10 (Clara) outer-flow audit/identity fields. These
    // are built client-side and must reach the server intact: existing-client
    // routing (ghl_contact_id/ghl_assigned_user_id) avoids duplicate contacts,
    // and the TCPA receipt (consent_text/hash/version/UA) is the auditable
    // record CMS requires.
    if (payload.lead_type) { body.lead_type = payload.lead_type; }
    if (payload.ghl_contact_id) { body.ghl_contact_id = payload.ghl_contact_id; }
    if (payload.ghl_assigned_user_id) { body.ghl_assigned_user_id = payload.ghl_assigned_user_id; }
    if (payload.consent_text) { body.consent_text = payload.consent_text; }
    if (payload.consent_receipt_hash) { body.consent_receipt_hash = payload.consent_receipt_hash; }
    if (payload.disclaimer_version) { body.disclaimer_version = payload.disclaimer_version; }
    if (payload.signer_user_agent) { body.signer_user_agent = payload.signer_user_agent; }
    if (payload.signer_ip) { body.signer_ip = payload.signer_ip; }
    if (payload.elapsed_ms != null) { body.elapsed_ms = payload.elapsed_ms; }

    // Anti-bot challenge (AUDIT 2026-08-15) — attach a Turnstile token when the
    // feature is configured at build time. Acquisition failure still submits:
    // the SERVER decides pass/fail (see the Turnstile section above).
    if (TURNSTILE_SITEKEY) {
      const challengeToken = await getTurnstileToken();
      if (challengeToken) body.turnstile_token = challengeToken;
    }

    lastSubmitStatus = 0;
    const response = await fetch(API_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    lastSubmitStatus = response.status;

    const data = await response.json().catch(() => null);

    // Sawil 2026-06-30 AUDIT FIX (adversarial verify) — a 409 DUPLICATE_LEAD means
    // the contact already exists in GHL: the lead IS on file. Treat it as success so
    // the user sees the reassuring "your info is with an advisor" closing instead of
    // an alarming "we couldn't send it" failure for a lead that actually landed.
    if (response.status === 409) {
      // Sawil 2026-07-16 SECURITY LOW-1 — success-path logging gated to DEV so no
      // CRM identifier or diagnostic reaches the visitor's production console.
      if (import.meta.env.DEV) console.info('[GHL] Lead already on file (duplicate) — treated as success');
      return true;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data?.error || response.statusText}`);
    }

    // Privacy: DEV-only success log. Sawil 2026-07-16 SECURITY LOW-1 — the CRM
    // contactId must never appear in the production browser console, so this is
    // gated behind import.meta.env.DEV and no longer logs the contact id. Never
    // log payload.full_name, phone, email, DOB, ZIP, lead_notes, or any
    // user-supplied content.
    if (import.meta.env.DEV) console.info('[GHL] Lead submitted', { status: response.status, source: payload.source });
    return true;
  } catch (error) {
    // Privacy: do NOT persist the failed payload locally — it contains PII
    // (name, phone, email, DOB, ZIP, lead_notes). Drop it. Log only a generic
    // failure label + error message (never the payload).
    console.error('[GHL] Submission failed', { error: error instanceof Error ? error.message : 'unknown' });
    return false;
  }
}

// One-time cleanup: purge any PII left over in localStorage from earlier
// versions that persisted failed-lead payloads. Safe to run on every load.
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  try { localStorage.removeItem('cp_pending_leads'); } catch { /* ignore */ }
}

// Kept as no-op for API stability. Failed leads are no longer stored locally
// (would have contained PII). Callers receive an empty array.
export function getPendingLeads(): GHLLeadPayload[] {
  return [];
}

export function clearPendingLeads(): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try { localStorage.removeItem('cp_pending_leads'); } catch { /* ignore */ }
  }
}

export function getSuccessMessage(lang: 'en' | 'es'): string {
  return lang === 'es'
    ? 'Gracias. Hemos recibido su información. Un agente licenciado de ClearPoint Senior Advisors se comunicará con usted pronto.'
    : 'Thank you. Your information has been received. A licensed agent from ClearPoint Senior Advisors will contact you soon.';
}

export function getErrorMessage(lang: 'en' | 'es'): string {
  return lang === 'es'
    ? 'Algo salió mal al enviar su solicitud. Inténtalo nuevamente o llámenos directamente.'
    : 'Something went wrong while sending your request. Please try again or call us directly.';
}

// api/_lib/turnstile.js — Cloudflare Turnstile server-side verification.
//
// AUDIT 2026-08-15 (remediation target 1 — bot/spam defense-in-depth). The
// provider was already designated in .env.example (Turnstile, invisible mode);
// this module implements the server half. The client half lives in
// src/lib/ghl.ts (token acquisition inside submitLeadToGHL, the single funnel
// every lead surface uses).
//
// Feature-gated by env (see .env.example):
//   TURNSTILE_SECRET — enables the layer; without it the mode is 'off' and
//                      every existing gate (honeypot, min-fill-time, origin
//                      allowlist, rate limits) keeps working exactly as today.
//   TURNSTILE_MODE   — optional override: 'enforce' (default when the secret
//                      is set), 'shadow' (verify + log, never block — rollout
//                      observation mode), 'off'.
//
// FAIL POSTURE: in 'enforce' mode a submission with a missing, invalid,
// expired, reused, or unverifiable token is REJECTED — including when the
// siteverify API itself is unreachable (fail closed; one bounded retry first).
// The caller surfaces a human-useful message with the phone fallback so a
// legitimate person always has a path forward.
//
// The secret never leaves the server: it travels only inside the outbound
// HTTPS siteverify request and is never logged, echoed, or sent to the client.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const IP_RE = /^[0-9a-f:.]{3,45}$/i;

export function turnstileMode() {
  var secret = process.env.TURNSTILE_SECRET || '';
  if (!secret) return 'off';
  var mode = String(process.env.TURNSTILE_MODE || '').toLowerCase();
  if (mode === 'off') return 'off';
  if (mode === 'shadow') return 'shadow';
  return 'enforce';
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify API.
 * Returns { ok, codes, transient }:
 *   ok        — true only when Cloudflare answered success:true.
 *   codes     — Cloudflare error identifiers (never PII), capped at 5.
 *   transient — true when the failure was infrastructure (siteverify
 *               unreachable/5xx), so callers can hint "try again".
 */
export async function verifyTurnstile(token, remoteIp) {
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { ok: false, codes: ['missing-input-response'], transient: false };
  }
  var params = new URLSearchParams();
  params.set('secret', process.env.TURNSTILE_SECRET || '');
  params.set('response', token);
  // remoteip strengthens verification but must be a real IP — clientId() can
  // return partition labels like 'vercel-untrusted:*' which we must not send.
  if (remoteIp && IP_RE.test(String(remoteIp))) params.set('remoteip', String(remoteIp));

  for (var attempt = 0; attempt < 2; attempt++) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 6000);
    try {
      var resp = await fetch(SITEVERIFY_URL, { method: 'POST', body: params, signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        if (resp.status >= 500 && attempt === 0) continue; // one retry on CF 5xx
        return { ok: false, codes: ['siteverify-http-' + resp.status], transient: true };
      }
      var data = await resp.json().catch(function () { return null; });
      if (!data || typeof data.success !== 'boolean') {
        return { ok: false, codes: ['siteverify-bad-response'], transient: true };
      }
      return {
        ok: data.success === true,
        codes: Array.isArray(data['error-codes']) ? data['error-codes'].slice(0, 5) : [],
        transient: false,
      };
    } catch (_e) {
      clearTimeout(timer);
      if (attempt === 0) continue; // one retry on abort/network error
      return { ok: false, codes: ['siteverify-unreachable'], transient: true };
    }
  }
  return { ok: false, codes: ['siteverify-unreachable'], transient: true };
}

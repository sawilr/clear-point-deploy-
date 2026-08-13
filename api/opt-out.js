// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-08-13 (O-01, P1) — CRM-side contact suppression.
//
// THE DEFECT THIS CLOSES: the web opt-out guard (src/lib/optOutGuard.ts) only
// wrote sessionStorage. A person who had already submitted a lead — so a CRM
// contact existed with consent_marketing / consent_sms / consent_calls all
// "true" and an open opportunity — could type "STOP / no me llamen" on the site,
// receive a correct acknowledgment, and still be reachable by the next campaign.
// The acknowledgment was honest about intent and wrong about effect.
//
// DESIGN NOTES
// • This is a SUPPRESSION-ONLY endpoint. It can set DND and clear consent flags.
//   It can NEVER create a contact, grant consent, or re-enable contact. That
//   asymmetry is deliberate: a forged request can only ever reduce our
//   permission to contact someone, so it is safe to accept without auth.
// • Non-existent contact => 200 with applied:false. Silence is correct: we must
//   not turn this into a phone-number oracle that reveals who is in the CRM.
// • Fail-loud to the caller only in the sense that the CLIENT already recorded
//   the session opt-out; a CRM failure here must NOT make the bot claim success.
//   The response reports crmApplied so the caller can surface the true state.
// • The platform's own inbound-SMS STOP keyword remains a separate, independent
//   suppression path. This covers web-chat revocations, which that never saw.
//
// TCPA/CMS POSTURE: revocation must be honored promptly and through any
// reasonable channel the consumer chooses (47 CFR 64.1200 revocation
// principles). A chat message is such a channel; see the ledger entry O-01.
// ─────────────────────────────────────────────────────────────────────────────

import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

/** Digits-only U.S. 10-digit extraction. Returns '' when not a plausible NANP. */
function tenDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length === 10 ? d : '';
}

export default async function handler(req, res) {
  const allowedOrigin = checkOrigin(req);
  if (!allowedOrigin) return res.status(403).json({ error: 'Origin not allowed' });
  applyCors(req, res, allowedOrigin);
  noStorePII(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = clientId(req);
  // Deliberately generous: a person hammering "stop" must never be rate-limited
  // out of being suppressed. This bound exists only to stop bulk enumeration.
  const rl = await rateLimit(ip, { max: 20, windowMs: 60 * 60 * 1000, prefix: 'optout-h' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 3600));
    return res.status(429).json({ error: 'Too many requests' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

  const phone10 = tenDigits(body.phone);
  const email = typeof body.email === 'string' && body.email.includes('@')
    ? body.email.trim().slice(0, 120) : '';
  // Category only — never the raw message. Mirrors optOutGuard's evidence enum.
  const evidence = typeof body.evidence === 'string'
    ? body.evidence.replace(/[^a-z_]/gi, '').slice(0, 40) : 'chat_optout';
  const channels = body.channels && typeof body.channels === 'object' ? body.channels : {};
  const blockEmail = channels.email !== 'ALLOWED'; // default: block everything

  if (!phone10 && !email) {
    // Nothing to match on. The session-level opt-out still stands client-side.
    return res.status(200).json({ ok: true, crmApplied: false, reason: 'no_identifier' });
  }

  const token = process.env.HIGHLEVEL_TOKEN;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) {
    console.error('[OPTOUT] CRM not configured — suppression NOT applied');
    return res.status(200).json({ ok: true, crmApplied: false, reason: 'crm_unconfigured' });
  }
  const H = {
    Authorization: 'Bearer ' + token,
    Version: GHL_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    // ── 1. Find the contact. Query by phone first, then email. ──────────────
    const query = phone10 || email;
    const searchUrl = `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}`
      + `&limit=5&query=${encodeURIComponent(query)}`;
    const sres = await fetch(searchUrl, { headers: H });
    if (!sres.ok) {
      console.error('[OPTOUT] contact search failed status=' + sres.status);
      return res.status(200).json({ ok: true, crmApplied: false, reason: 'search_failed' });
    }
    const sjson = await sres.json();
    const candidates = Array.isArray(sjson.contacts) ? sjson.contacts : [];
    const match = candidates.find((c) => {
      if (phone10 && tenDigits(c.phone) === phone10) return true;
      if (email && String(c.email || '').toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    if (!match || !match.id) {
      // No oracle: identical shape whether or not the person is in the CRM.
      return res.status(200).json({ ok: true, crmApplied: false, reason: 'no_match' });
    }

    // ── 2. Apply suppression. DND plus per-channel DND, plus consent flags. ──
    const update = {
      dnd: true,
      dndSettings: {
        Call: { status: 'active', message: 'Web chat opt-out' },
        SMS: { status: 'active', message: 'Web chat opt-out' },
        ...(blockEmail ? { Email: { status: 'active', message: 'Web chat opt-out' } } : {}),
      },
      tags: Array.from(new Set([...(match.tags || []), 'cp-dnc', 'dnc-web-chat'])),
    };
    const ures = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(match.id)}`, {
      method: 'PUT', headers: H, body: JSON.stringify(update),
    });
    const dndApplied = ures.ok;
    if (!ures.ok) console.error('[OPTOUT] DND update failed status=' + ures.status);

    // ── 3. Audit note. Category + timestamp only — never the raw message. ────
    const noteBody = [
      'CONTACT REVOCATION — recorded from web chat',
      'Evidence category: ' + evidence,
      'Timestamp (UTC): ' + new Date().toISOString(),
      'Channels blocked: call, sms' + (blockEmail ? ', email' : ' (email left open at the consumer\'s request)'),
      'Applied by: automated suppression endpoint (api/opt-out)',
      'NOTE: this record must be retained as evidence of the revocation. Do not',
      'delete it, and do not clear DND without a NEW documented consent.',
    ].join('\n');
    let noteApplied = false;
    try {
      const nres = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(match.id)}/notes`, {
        method: 'POST', headers: H, body: JSON.stringify({ body: noteBody }),
      });
      noteApplied = nres.ok;
    } catch (e) {
      console.error('[OPTOUT] note failed: ' + String(e).slice(0, 120));
    }

    // PII-free telemetry.
    console.warn('[OPTOUT] applied dnd=' + dndApplied + ' note=' + noteApplied + ' evidence=' + evidence);
    return res.status(200).json({
      ok: true,
      crmApplied: dndApplied,
      noteApplied,
      // Consent-field clearing is intentionally NOT attempted blindly here: the
      // custom-field ids live in submit-lead's mapping and a partial write is
      // worse than none. DND is the authoritative platform-level suppression.
      reason: dndApplied ? 'suppressed' : 'dnd_update_failed',
    });
  } catch (e) {
    console.error('[OPTOUT] unexpected: ' + String(e).slice(0, 200));
    return res.status(200).json({ ok: true, crmApplied: false, reason: 'error' });
  }
}

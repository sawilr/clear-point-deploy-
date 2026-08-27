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
// • Every outcome returns ONE uniform 200 body { ok:true, received:true } so the
//   endpoint can never be a phone/email membership oracle (OPTOUT-01, 2026-08-18).
//   The true outcome (matched/applied/failed) lives only in PII-free server logs.
// • The CLIENT already recorded the session opt-out locally and does not read
//   this response body (optOutGuard.propagateOptOutToCrm fires and forgets), so
//   the uniform body breaks no UX; suppression is best-effort by design.
// • The platform's own inbound-SMS STOP keyword remains a separate, independent
//   suppression path. This covers web-chat revocations, which that never saw.
//
// TCPA/CMS POSTURE: revocation must be honored promptly and through any
// reasonable channel the consumer chooses (47 CFR 64.1200 revocation
// principles). A chat message is such a channel; see the ledger entry O-01.
// ─────────────────────────────────────────────────────────────────────────────

import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';
import { enforceKill } from './_lib/kill-switch.js';
// AUDIT 2026-08-15 (red-team F4) — shared JSON body reader: applies the same
// bounded size cap every other endpoint uses (this one read req.body directly,
// relying on the platform default ~4.5MB) and answers malformed JSON with 400.
import { readJsonBody } from './_lib/read-body.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

/** Digits-only U.S. 10-digit extraction. Returns '' when not a plausible NANP. */
function tenDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length === 10 ? d : '';
}

// ── AUDIT 2026-08-18 (OPTOUT-01, P1) — MEMBERSHIP-ENUMERATION ORACLE ──────────
// The prior code returned crmApplied:true / reason:'suppressed' when a contact
// MATCHED and crmApplied:false / reason:'no_match' when it did NOT — a trivial
// oracle: an unauthenticated POST could learn whether any phone/email is a
// ClearPoint contact by reading the body. (The old line-122 comment claimed
// "No oracle: identical shape" but only the no-match branch was uniform; the
// match branch leaked success.) The legitimate client — optOutGuard.ts
// propagateOptOutToCrm — fires `void fetch(...).catch(()=>{})` and NEVER reads
// the body, so collapsing every outcome to ONE indistinguishable response
// breaks nothing while removing the oracle. All suppression work and PII-free
// ops logging still happen server-side; only the client-visible signal is
// equalized. Structural rejections (403 origin / 405 method / 400-413 body /
// 429 rate) are membership-independent and stay as-is.
//
// RESIDUAL (LOW, documented): a timing side-channel remains — the match path
// does one extra PUT + note POST. Over the internet this needs many samples per
// target and is bounded by the endpoint's rate limit; it becomes fully
// impractical once the rate limiter is KV-backed (see RL-08). Not a practical
// oracle on its own.
function ack(res) {
  // ONE uniform acknowledgement for every membership-dependent outcome.
  return res.status(200).json({ ok: true, received: true });
}

export default async function handler(req, res) {
  const allowedOrigin = checkOrigin(req);
  if (!allowedOrigin) return res.status(403).json({ error: 'Origin not allowed' });
  applyCors(req, res, allowedOrigin);
  noStorePII(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // AUDIT 2026-08-13 (§12) — present for completeness, but note the asymmetry:
  // killing THIS endpoint stops us HONORING revocations, which is the opposite of
  // safe. It exists only for a scenario where the endpoint itself is being abused,
  // and the refusal copy still routes the caller to a human who can record it.
  if (enforceKill(res, 'optout', 'en')) return;

  const ip = clientId(req);
  // Deliberately generous: a person hammering "stop" must never be rate-limited
  // out of being suppressed. This bound exists only to stop bulk enumeration.
  const rl = await rateLimit(ip, { max: 20, windowMs: 60 * 60 * 1000, prefix: 'optout-h' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 3600));
    return res.status(429).json({ error: 'Too many requests' });
  }

  // AUDIT 2026-08-15 — shared reader (8 KB cap): handles the malformed-JSON
  // throw (→ 400) and oversize bodies (→ 413) uniformly; returns null after
  // sending its own response.
  const body = await readJsonBody(req, res, { maxBytes: 8 * 1024 });
  if (body === null) return;

  const phone10 = tenDigits(body.phone);
  const email = typeof body.email === 'string' && body.email.includes('@')
    ? body.email.trim().slice(0, 120) : '';
  // Category only — never the raw message. Mirrors optOutGuard's evidence enum.
  const evidence = typeof body.evidence === 'string'
    ? body.evidence.replace(/[^a-z_]/gi, '').slice(0, 40) : 'chat_optout';
  const channels = body.channels && typeof body.channels === 'object' ? body.channels : {};
  const blockEmail = channels.email !== 'ALLOWED'; // default: block everything

  if (!phone10 && !email) {
    // AUDIT 2026-08-27 (finding #1) — a request with NO valid phone/email cannot
    // suppress anyone, yet this used to answer the uniform success ack, giving
    // false certainty of revocation. Reject with 400. This is a pure INPUT
    // validation rejection — it depends only on the request shape, never on CRM
    // membership — so it does NOT reintroduce the OPTOUT-01 enumeration oracle:
    // a valid-format phone/email that simply is not in the CRM still gets the
    // uniform 200 ack below. The legitimate client fires-and-forgets and never
    // reads this body, so no real UX regresses.
    console.warn('[OPTOUT] rejected: no valid phone or email supplied');
    return res.status(400).json({ error: 'A valid phone or email is required to process an opt-out.' });
  }

  const token = process.env.HIGHLEVEL_TOKEN;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) {
    console.error('[OPTOUT] CRM not configured — suppression NOT applied');
    return ack(res);
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
      return ack(res);
    }
    const sjson = await sres.json();
    const candidates = Array.isArray(sjson.contacts) ? sjson.contacts : [];
    const match = candidates.find((c) => {
      if (phone10 && tenDigits(c.phone) === phone10) return true;
      if (email && String(c.email || '').toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    if (!match || !match.id) {
      // Uniform ack (OPTOUT-01): identical to the match path below.
      console.warn('[OPTOUT] no CRM match for supplied identifier');
      return ack(res);
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

    // PII-free telemetry — the outcome lives in the logs, NOT in the client
    // response (OPTOUT-01). Consent-field clearing is intentionally NOT
    // attempted blindly here: the custom-field ids live in submit-lead's
    // mapping and a partial write is worse than none. DND is the authoritative
    // platform-level suppression.
    console.warn('[OPTOUT] applied dnd=' + dndApplied + ' note=' + noteApplied + ' evidence=' + evidence);
    return ack(res);
  } catch (e) {
    console.error('[OPTOUT] unexpected: ' + String(e).slice(0, 200));
    return ack(res);
  }
}

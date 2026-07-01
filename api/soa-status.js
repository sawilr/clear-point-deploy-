// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — Read SOA token status (for the React /soa page to hydrate
// the form with the lead's captured data).
//
// GET /api/soa-status?token=<uuid>
//   → 200 { exists, consumed, lead: { fullName, phone, zip, language, leadSource } }
//   → 404 if token unknown / expired
//
// NEVER returns the full token record server-side state (no IP, no
// raw payload). Only the data needed to pre-fill the form.
// ─────────────────────────────────────────────────────────────────────────────

import { getSoaToken } from './_lib/soa-store.js';
import { checkOrigin, applyCors, rateLimit, clientId } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';

// Sawil 2026-06-30 AUDIT FIX (security HIGH) — mirror the SOA gate on the STATUS
// endpoint. This is the endpoint that returns lead PII (name/phone/email/zip) to a
// token holder (single-factor bearer / IDOR-by-design). It previously had NO
// SOA_ENABLED gate, so while soa-token / sign-soa correctly 503, this one would
// still serve PII for any surviving token. Keep ALL SOA endpoints hard-disabled
// until the flow is hardened (2nd-factor token binding, short TTL, no 3rd-party
// subresources on /soa, httpOnly cookie over URL token) and explicitly approved.
const SOA_ENABLED = false; // mirror of src/lib/soaContent.ts SOA_ENABLED

export default async function handler(req, res) {
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed' });
  applyCors(req, res, allowedOrigin);
  noStorePII(res); // Sawil 2026-06-29 SECURITY HOTFIX — never cache SOA-status/PII responses (finding 05).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!SOA_ENABLED) return res.status(503).json({ error: 'SOA_DISABLED' });

  // Per-IP rate limit (lighter — this is just a read)
  var ip = clientId(req);
  var rl = await rateLimit(ip, { max: 60, windowMs: 60 * 1000, prefix: 'soa-stat' });
  if (!rl.ok) return res.status(429).json({ error: 'Too many requests' });

  var token = '';
  try {
    var url = new URL(req.url, 'http://localhost'); // base required by URL ctor
    token = url.searchParams.get('token') || '';
  } catch (e) { /* malformed */ }
  if (!token || !/^[a-f0-9-]{36}$/i.test(token)) {
    return res.status(400).json({ error: 'token required' });
  }

  var rec = null;
  try { rec = await getSoaToken(token); } catch (e) { /* swallow */ }
  if (!rec) return res.status(404).json({ exists: false });

  return res.status(200).json({
    exists: true,
    consumed: !!rec.consumed,
    lead: {
      fullName: rec.fullName,
      phone: rec.phone,
      email: rec.email || '',
      zip: rec.zip || '',
      language: rec.language,
      leadSource: rec.leadSource,
    },
  });
}

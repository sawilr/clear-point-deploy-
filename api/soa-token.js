// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — SOA token issuer.
//
// Called by the bot after name+phone capture (from CustomerServiceBot or
// SmartMedicareReview). Issues a single-use token bound to the lead's
// fullName + phone. The user is then redirected to /soa/:token to sign.
//
// Storage:
//   - Vercel KV (production) keyed by `soa-token:<uuid>` with 24h TTL
//   - In-memory fallback for dev (resets between cold starts; not for prod)
//
// Token payload includes the captured lead data so that on submit we can
// verify the typed signature matches the original captured name.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';
import { SOA_TOKEN_TTL_SEC, setRecord, leadKey } from './_lib/soa-store.js';
import { issueLink } from './_lib/cy2027/secure-link.js';
// AUDIT 2026-08-15 — shared JSON body reader (fixes the malformed-JSON hang).
import { readJsonBody } from './_lib/read-body.js';

// PHASE 7 — SOA gate. Mirror of src/lib/soaContent.ts SOA_ENABLED.
// Until the owner confirms the FMO carrier/product counts, we refuse to
// issue tokens so that no SOA PDF with [X]/[Y] placeholders can be signed.
const SOA_ENABLED = false;

export default async function handler(req, res) {
  // ── CORS allowlist ─────────────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
    // AUDIT 2026-09-14 (SEC-10) — never let a rejection be cached
  if (allowedOrigin === null) { noStorePII(res); return res.status(403).json({ error: 'Origin not allowed' }); }
  applyCors(req, res, allowedOrigin);
  noStorePII(res); // Sawil 2026-06-29 SECURITY HOTFIX — never cache SOA-token/PII responses (finding 05).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── PHASE 7 SOA gate ───────────────────────────────────────────────────
  if (!SOA_ENABLED) {
    return res.status(503).json({ error: 'SOA_NOT_CONFIGURED', message: 'SOA workflow is temporarily unavailable' });
  }

  // ── Rate limit (5 tokens per IP per hour) ──────────────────────────────
  var ip = clientId(req);
  var rl = await rateLimit(ip, { max: 5, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many SOA tokens requested' });
  }

  // ── Read body — PHASE 6: cap at 32 KB (small payload only) ──────────────
  // AUDIT 2026-08-15 — shared reader (_lib/read-body.js) fixes the
  // malformed-JSON hang; it answers 400/413 itself and returns null.
  var body = await readJsonBody(req, res, { maxBytes: 32 * 1024 });
  if (body === null) return;

  // ── Validate required lead context ─────────────────────────────────────
  var fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  var phone = typeof body.phone === 'string' ? body.phone.replace(/[\s\-().]/g, '') : '';
  var email = typeof body.email === 'string' ? body.email.trim() : '';
  var zip = typeof body.zip === 'string' ? body.zip : '';
  var language = body.language === 'en' ? 'en' : 'es';
  var leadSource = body.leadSource === 'smart_review' ? 'smart_review' : 'customer_service';

  if (!fullName || fullName.length < 2) return res.status(400).json({ error: 'fullName required' });
  if (!/^(\+1)?\d{10}$/.test(phone)) return res.status(400).json({ error: 'valid phone required' });

  // ── Issue a CY2027 secure link ─────────────────────────────────────────
  // AUDIT 2026-10-01 (SEC-TOK-01/02) — this used to mint a crypto.randomUUID()
  // and store the lead's name, phone, email and ZIP under 'soa-token:<uuid>',
  // which api/soa-status.js then handed to anyone presenting that UUID. The
  // link was the only handle on the data, so possession of a forwarded URL was
  // possession of the record.
  //
  // Now the two are separated: an opaque lead record holds the personal data,
  // and the link record — the thing the URL addresses — holds no personal data
  // at all, only a pointer and a hashed second factor. See
  // api/_lib/cy2027/secure-link.js for why the store is keyed by sha256(token).
  var beneficiaryRef = crypto.randomUUID();
  var issuedAt = new Date().toISOString();

  var link;
  try {
    link = issueLink({
      soaId: 'soa_' + crypto.randomUUID(),
      appointmentId: 'appt_' + crypto.randomUUID(),
      beneficiaryRef: beneficiaryRef,
      channel: 'WEB',
      secondFactorKind: 'PHONE_LAST4',
      secondFactorValue: phone,
      language: language,
      ttlSec: SOA_TOKEN_TTL_SEC,
    });
  } catch (e) {
    console.error('[soa-token] link issue failed:', e && e.message);
    return res.status(400).json({ error: 'Could not issue a secure link' });
  }

  var leadRecord = {
    beneficiaryRef: beneficiaryRef,
    issuedAt: issuedAt,
    fullName: fullName,
    phone: phone,
    email: email || null,
    zip: zip || null,
    language: language,
    leadSource: leadSource,
    issuerIp: ip,
  };

  // Both writes must be durable. A link whose lead record lives only in one
  // lambda's memory breaks on the next request, and a beneficiary who clicks a
  // dead link is a beneficiary who signs nothing.
  var w1 = await setRecord(leadKey(beneficiaryRef), leadRecord, SOA_TOKEN_TTL_SEC);
  var w2 = await setRecord(link.storeKey, link.record, SOA_TOKEN_TTL_SEC);
  if (!w1.ok || !w2.ok) {
    console.error('[soa-token] storage failed:', w1.reason || w2.reason);
    return res.status(503).json({ error: 'Token storage failed' });
  }

  return res.status(200).json({
    token: link.token,
    expiresIn: SOA_TOKEN_TTL_SEC,
    soaUrl: '/soa/' + link.token,
    // The UI must know which question to ask before it can show anything.
    factorRequired: link.record.secondFactorKind,
  });
}

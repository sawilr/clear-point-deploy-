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
import { setSoaToken, SOA_TOKEN_TTL_SEC } from './_lib/soa-store.js';

// PHASE 7 — SOA gate. Mirror of src/lib/soaContent.ts SOA_ENABLED.
// Until the owner confirms the FMO carrier/product counts, we refuse to
// issue tokens so that no SOA PDF with [X]/[Y] placeholders can be signed.
const SOA_ENABLED = false;

export default async function handler(req, res) {
  // ── CORS allowlist ─────────────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed' });
  applyCors(req, res, allowedOrigin);
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
  var body = {};
  try { body = req.body || {}; } catch (e1) {
    try {
      body = await new Promise(function (resolve, reject) {
        var chunks = []; var total = 0; var MAX = 32 * 1024;
        req.on('data', function (c) {
          total += c.length;
          if (total > MAX) { req.destroy(); reject(new Error('body_too_large')); return; }
          chunks.push(c);
        });
        req.on('end', function () {
          var raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw && raw.trim() ? JSON.parse(raw) : {});
        });
        req.on('error', reject);
      });
    } catch (e2) {
      if (e2 && e2.message === 'body_too_large') return res.status(413).json({ error: 'Payload too large' });
      return res.status(400).json({ error: 'Cannot read body' });
    }
  }

  // ── Validate required lead context ─────────────────────────────────────
  var fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  var phone = typeof body.phone === 'string' ? body.phone.replace(/[\s\-().]/g, '') : '';
  var email = typeof body.email === 'string' ? body.email.trim() : '';
  var zip = typeof body.zip === 'string' ? body.zip : '';
  var language = body.language === 'en' ? 'en' : 'es';
  var leadSource = body.leadSource === 'smart_review' ? 'smart_review' : 'customer_service';

  if (!fullName || fullName.length < 2) return res.status(400).json({ error: 'fullName required' });
  if (!/^(\+1)?\d{10}$/.test(phone)) return res.status(400).json({ error: 'valid phone required' });

  // ── Issue token (UUID v4) ──────────────────────────────────────────────
  var token = crypto.randomUUID();
  var issuedAt = new Date().toISOString();
  var record = {
    token: token,
    issuedAt: issuedAt,
    fullName: fullName,
    phone: phone,
    email: email || null,
    zip: zip || null,
    language: language,
    leadSource: leadSource,
    issuerIp: ip,
    consumed: false,
  };

  try {
    await setSoaToken(token, record);
  } catch (e) {
    console.error('[soa-token] storage failed:', e && e.message);
    return res.status(500).json({ error: 'Token storage failed' });
  }

  return res.status(200).json({
    token: token,
    expiresIn: SOA_TOKEN_TTL_SEC,
    soaUrl: '/soa/' + token,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10 — Existing-client lookup for Clara (Path A).
//
// Clara asks the user for full name + last 4 digits of the phone we have
// on file. This endpoint queries GoHighLevel for a matching contact and
// returns minimal sanitized data (contact_id, assigned advisor, phoneLast4)
// only when BOTH name AND last-4 match.
//
// Security:
//   1. Origin / CORS allowlist (mirror /api/chat).
//   2. Per-IP rate limit (10/hour) — prevents identity enumeration.
//   3. Body cap 8 KB.
//   4. Fail-safe: any GHL error / timeout → { found: false } (no leak).
//   5. Never echo PII back beyond what the user already provided.
//   6. Logs status-only, never name/phone.
// ─────────────────────────────────────────────────────────────────────────────

import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';

// Sawil 2026-06-29 SECURITY HOTFIX (audit finding 01 — unauthenticated CRM
// enumeration). The public name+last4 lookup let anyone confirm whether a person
// is a client and harvest internal CRM identifiers (contactId, assignedUserId,
// advisorName). It is DISABLED until rebuilt behind a verified, single-use
// channel. While disabled the endpoint returns ONE uniform response for every
// caller — it never reveals existence (no found:true/false) and never touches
// the CRM.
const LOOKUP_ENABLED = false;

const GHL_LOCATION_ID = process.env.HIGHLEVEL_LOCATION_ID;
const GHL_TOKEN = process.env.HIGHLEVEL_TOKEN;
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const LOOKUP_TIMEOUT_MS = 8_000;

function badResponse(res, status, error) {
  return res.status(status).json({ found: false, error });
}

function notFound(res) {
  return res.status(200).json({ found: false });
}

// Sawil 2026-06-29 — uniform, non-revealing response. Never includes `found`,
// any CRM id, advisor name, or existence signal, so it cannot be used to
// enumerate or confirm a contact. Same output for known and unknown people.
function genericLookup(req, res) {
  noStorePII(res);
  const isEs = !!(req && req.headers && /^es/i.test(String(req.headers['accept-language'] || '')));
  return res.status(200).json({
    status: 'received',
    message: isEs
      ? 'Si podemos verificar su perfil, un asesor licenciado de ClearPoint le dará seguimiento.'
      : 'If we can verify your profile, a licensed ClearPoint advisor will follow up.',
  });
}

function maskPhoneLast4(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D+/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

async function fetchWithTimeout(url, opts = {}, timeout = LOOKUP_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  // ── CORS allowlist ─────────────────────────────────────────────────────
  const allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed' });
  applyCors(req, res, allowedOrigin);
  noStorePII(res); // Sawil 2026-06-29 — never cache lookup responses (finding 05).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limit BEFORE any lookup — REAL 429 (Sawil 2026-06-29, finding 04).
  // Previously returned 200 found:false on limit, which gave legitimate users a
  // false negative while still allowing N enumerations per window.
  const ip = clientId(req);
  const rl = await rateLimit(ip, { max: 10, windowMs: 60 * 60 * 1000, prefix: 'lookup' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Please try again later.' });
  }

  // ── Public CRM lookup is DISABLED (Sawil 2026-06-29, finding 01). Return one
  //    uniform response for everyone; never reveal existence; never call GHL.
  //    The block below is DEAD until LOOKUP_ENABLED is rebuilt behind a verified
  //    single-use channel — and it must NOT return contactId/assignedUserId/
  //    advisorName or any existence signal when it is.
  if (!LOOKUP_ENABLED) return genericLookup(req, res);

  // ── Read body (cap 8 KB) ────────────────────────────────────────────────
  let body = {};
  try {
    body = req.body || {};
  } catch {
    try {
      body = await new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const MAX = 8 * 1024;
        req.on('data', (c) => {
          total += c.length;
          if (total > MAX) { req.destroy(); reject(new Error('body_too_large')); return; }
          chunks.push(c);
        });
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw && raw.trim() ? JSON.parse(raw) : {});
        });
        req.on('error', reject);
      });
    } catch {
      return badResponse(res, 400, 'cannot_read_body');
    }
  }

  // ── Validate input ──────────────────────────────────────────────────────
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 80) : '';
  const last4 = typeof body.last4Phone === 'string'
    ? body.last4Phone.replace(/\D+/g, '').slice(-4)
    : '';
  if (!fullName || fullName.length < 4 || last4.length !== 4) {
    // No leak — same response as "not found".
    return notFound(res);
  }

  // ── If GHL not configured, fail safe ────────────────────────────────────
  if (!GHL_TOKEN || !GHL_LOCATION_ID) {
    console.warn('[lookup-client] GHL not configured; ip=' + ip);
    return notFound(res);
  }

  // ── Query GHL ───────────────────────────────────────────────────────────
  // Use the GHL "search contacts" endpoint with name query, then server-side
  // filter by last 4 phone digits. We intentionally do NOT query by phone
  // alone to avoid enumeration via phone scraping.
  try {
    const url = `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(GHL_LOCATION_ID)}&query=${encodeURIComponent(fullName)}&limit=20`;
    const resp = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: GHL_VERSION,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      console.warn('[lookup-client] GHL responded', resp.status, 'ip=' + ip);
      return notFound(res);
    }
    const data = await resp.json().catch(() => null);
    const contacts = (data && Array.isArray(data.contacts)) ? data.contacts : [];

    // Filter: match by last 4 of phone. GHL contact phone field varies.
    const norm = (s) => (s || '').toString().toLowerCase().trim();
    const wantedName = norm(fullName);
    let match = null;
    for (const c of contacts) {
      const phoneDigits = (c.phone || '').toString().replace(/\D+/g, '');
      if (phoneDigits.length < 4) continue;
      if (phoneDigits.slice(-4) !== last4) continue;
      // Soft name match: each token of provided name must appear in contact's name.
      const contactName = norm(`${c.firstName || ''} ${c.lastName || ''}`);
      const tokens = wantedName.split(/\s+/).filter(Boolean);
      const allTokensPresent = tokens.every((tok) => contactName.includes(tok));
      if (!allTokensPresent) continue;
      match = c;
      break;
    }

    if (!match) return notFound(res);

    // Fetch assigned user name (if assigned)
    let advisorName = null;
    const assignedUserId = match.assignedTo || match.assigned_user_id || null;
    if (assignedUserId) {
      try {
        const userResp = await fetchWithTimeout(
          `${GHL_BASE}/users/${encodeURIComponent(assignedUserId)}`,
          {
            headers: {
              Authorization: `Bearer ${GHL_TOKEN}`,
              Version: GHL_VERSION,
              Accept: 'application/json',
            },
          },
          5_000,
        );
        if (userResp.ok) {
          const userData = await userResp.json().catch(() => null);
          if (userData) {
            const u = userData.user || userData;
            advisorName = (u.firstName || u.first_name || '') +
              (u.lastName ? ` ${u.lastName}` : u.last_name ? ` ${u.last_name}` : '');
            advisorName = advisorName.trim() || null;
          }
        }
      } catch { /* swallow */ }
    }

    return res.status(200).json({
      found: true,
      contactId: match.id || null,
      assignedUserId: assignedUserId || null,
      advisorName,
      phoneLast4: maskPhoneLast4(match.phone),
    });
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    console.warn('[lookup-client] error', isAbort ? 'timeout' : 'network', 'ip=' + ip);
    return notFound(res);
  }
}

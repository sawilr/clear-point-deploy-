// PHASE A15 — Rate limiting for /api/chat and /api/submit-lead.
//
// Goal: prevent abuse spam from inflating the Anthropic API bill and
// stop bots from hammering /api/submit-lead.
//
// Storage layers (auto-detected):
//   1. Vercel KV / Upstash Redis  ← if KV_REST_API_URL + KV_REST_API_TOKEN
//   2. In-memory fallback (per-instance)  ← when KV is missing
//
// Vercel KV free tier: 30,000 commands/day. Each rate-limit check is
// 1 command. Covers ~1,000 active conversations/day at zero cost.

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_AVAILABLE = !!(KV_URL && KV_TOKEN);

// Sawil 2026-06-30 AUDIT FIX (security HIGH) — if KV is NOT configured on a
// deployed (Vercel) environment, the limiter silently degrades to PER-INSTANCE
// memory, which distributed serverless concurrency multiplies (a weak cap). Emit
// a loud, PII-free alert once per cold start so ops provision the shared store.
if (!KV_AVAILABLE && (process.env.VERCEL || process.env.VERCEL_ENV)) {
  console.error('[rate-limit][ALERT] KV_NOT_CONFIGURED on Vercel — rate limits are per-instance only (weak). Set KV_REST_API_URL + KV_REST_API_TOKEN.');
}

/**
 * CP-06 / external audit 2026-08-13 — expose the storage tier so the gap is a
 * machine-readable fact rather than a line in a report.
 *
 * VERIFIED 2026-08-13: production has exactly three environment variables
 * (ANTHROPIC_API_KEY, HIGHLEVEL_LOCATION_ID, HIGHLEVEL_TOKEN) and NONE of the KV or
 * Upstash variables. So KV_AVAILABLE is false in production today and every limit in
 * this module is per-instance.
 *
 * WHY THAT MATTERS MORE THAN THE ORDERING FINDING: Vercel serves each concurrent
 * request from its own function instance, each with its own `memoryStore` Map, and a
 * cold start begins at zero. The effective ceiling is therefore (limit x live
 * instances), which an attacker controls simply by sending requests in parallel. The
 * published "5 per hour, 10 per day" describes intent, not enforced behavior.
 *
 * This cannot be fixed in code: it needs a KV/Upstash store provisioned on the
 * account and two environment variables set, which has billing implications and is an
 * owner action. Recorded as BLOCKED - EXTERNAL ACTION REQUIRED. Until then, treat
 * every rate limit here as best-effort, and do not describe them as enforced.
 */
export function rateLimitStorageTier() {
  return {
    tier: KV_AVAILABLE ? 'shared-kv' : 'per-instance-memory',
    enforced: KV_AVAILABLE,
    onVercel: !!(process.env.VERCEL || process.env.VERCEL_ENV),
    // Never expose the URL or token — only whether each is present.
    hasUrl: !!KV_URL,
    hasToken: !!KV_TOKEN,
  };
}

// ── In-memory store (fallback) ──────────────────────────────────────────
// Per-Vercel-instance. Resets when the function cold-starts, but at
// least caps a single hot instance from being abused.
const memoryStore = new Map();
const MEMORY_MAX_KEYS = 5000; // bound memory to avoid OOM
function memoryGet(key) {
  var entry = memoryStore.get(key);
  if (!entry) return 0;
  if (entry.resetAt < Date.now()) {
    memoryStore.delete(key);
    return 0;
  }
  return entry.count;
}
function memoryIncr(key, windowMs) {
  // LRU-ish eviction
  if (memoryStore.size >= MEMORY_MAX_KEYS) {
    var firstKey = memoryStore.keys().next().value;
    memoryStore.delete(firstKey);
  }
  var entry = memoryStore.get(key);
  if (!entry || entry.resetAt < Date.now()) {
    memoryStore.set(key, { count: 1, resetAt: Date.now() + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

// ── KV store (production) ───────────────────────────────────────────────
// A15.7 — fix MEDIUM finding: INCR + EXPIRE were not atomic. If the function
// crashed between the two calls, the key would have no TTL and persist
// forever (effectively a permanent rate-limit ban for that user).
// Use Upstash REST pipeline so both ops execute as a single transaction.
async function kvIncr(key, windowSec) {
  var headers = {
    'Authorization': 'Bearer ' + KV_TOKEN,
    'Content-Type': 'application/json',
  };
  // Pipeline: [INCR key, EXPIRE key windowSec NX]  → atomic-ish over one HTTP call.
  var body = JSON.stringify([
    ['INCR', key],
    ['EXPIRE', key, String(windowSec), 'NX'],
  ]);
  var r = await fetch(KV_URL + '/pipeline', { method: 'POST', headers: headers, body: body });
  if (!r.ok) throw new Error('kv_pipeline_failed:' + r.status);
  var arr = await r.json();
  // arr is [{ result: <count> }, { result: 0|1 }]
  var count = Array.isArray(arr) && arr[0] ? Number(arr[0].result) : 0;
  return count;
}

/**
 * Apply rate limit. Returns { ok: true, remaining } or { ok: false, retryAfter }.
 *
 * @param {string} identifier  IP, session ID, etc.
 * @param {object} opts        { max, windowMs, prefix }
 */
export async function rateLimit(identifier, opts) {
  var max = opts.max || 30;
  var windowMs = opts.windowMs || 5 * 60 * 1000;
  var prefix = opts.prefix || 'rl';
  var key = prefix + ':' + identifier;
  var count;
  try {
    if (KV_AVAILABLE) {
      count = await kvIncr(key, Math.ceil(windowMs / 1000));
    } else {
      count = memoryIncr(key, windowMs);
    }
  } catch (e) {
    // Sawil 2026-06-30 AUDIT FIX (security HIGH) — do NOT silently fail open. KV
    // down drops us to PER-INSTANCE memory limits (distributed concurrency
    // multiplies the effective cap). We keep the memory backstop so real leads/chat
    // still flow (Phase 1: never drop a consented lead), but emit a LOUD, PII-free
    // alert so ops see the degraded mode and repair KV.
    console.error('[rate-limit][ALERT] KV_UNAVAILABLE — degraded to per-instance memory limits. err=' + (e && e.message ? e.message : 'unknown'));
    count = memoryIncr(key, windowMs);
  }
  if (count > max) {
    return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
  }
  return { ok: true, remaining: max - count };
}

/** Extract a stable identifier from a Vercel request.
 *  A15.6 — HIGH fix: previous code used the FIRST entry of x-forwarded-for,
 *  which on Vercel is attacker-controlled (Vercel appends the real IP last).
 *  Now we prefer Vercel's own x-vercel-forwarded-for header, then fall back
 *  to the LAST entry of XFF, then x-real-ip.
 */
var IP_RE = /^[0-9a-f:.]{3,45}$/i;
export function clientId(req) {
  if (!req || !req.headers) return 'unknown';
  var onVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV);
  // Sawil 2026-06-30 AUDIT FIX (security HIGH) — on Vercel, ONLY
  // x-vercel-forwarded-for is trustworthy: Vercel's edge sets it and the client
  // cannot forge it. x-forwarded-for / x-real-ip ARE client-influenceable, so on
  // Vercel we must NOT fall back to them (that let an attacker mint a fresh
  // rate-limit quota per forged value). Off Vercel (local dev / other hosts) the
  // usual proxy headers are accepted.
  var vercelIp = req.headers['x-vercel-forwarded-for'];
  if (vercelIp) {
    var v = String(vercelIp).split(',')[0].trim();
    if (IP_RE.test(v)) return v;
  }
  if (onVercel) {
    // AUDIT 2026-07-03 (security MEDIUM — self-inflicted-DoS blast radius) — when the
    // trusted Vercel IP header is absent, DON'T collapse ALL such traffic into one
    // global 'vercel-untrusted' counter (one actor could exhaust it and 429 everyone).
    // Partition the fallback bucket by a coarse, NON-spoofable-for-quota-farming
    // discriminator: a short hash of User-Agent + Accept-Language. This is still fail
    // closed (never trusts a spoofable IP), but an attacker can no longer starve the
    // shared quota for unrelated legitimate clients. UA/AL are trivially forgeable, so
    // this only PARTITIONS the fallback — it does not grant more trust.
    var ua = String(req.headers['user-agent'] || '');
    var al = String(req.headers['accept-language'] || '');
    if (!ua && !al) return 'vercel-untrusted';
    var seed = ua + '|' + al;
    var hash = 0;
    for (var i = 0; i < seed.length; i++) { hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0; }
    return 'vercel-untrusted:' + (hash >>> 0).toString(36);
  }
  var fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    var parts = String(fwd).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length) {
      var last = parts[parts.length - 1];
      if (IP_RE.test(last)) return last;
    }
  }
  var real = req.headers['x-real-ip'];
  if (real && IP_RE.test(String(real))) return String(real);
  return 'unknown';
}

/** Whitelist allowed origins for CORS.
 *  A15.5 — HIGH fix: previously allowed any *.vercel.app, letting an
 *  attacker deploy their own Vercel project to abuse /api/chat. Now we
 *  restrict preview deployments to our own project slug prefix.
 */
const PROD_HOST = 'clearpointsenioradvisors.com';
const VERCEL_PROJECT_SLUG_PREFIX = 'clearpoint-deploy';
const ALLOWED_ORIGIN_RE = new RegExp(
  // BUG 4 — accept both the apex host and the www. subdomain of PROD_HOST
  // (a www visitor was previously blocked → 403 → Zara fell back to offline).
  '^https://((www\\.)?' + PROD_HOST.replace(/\./g, '\\.') + '|' +
  VERCEL_PROJECT_SLUG_PREFIX + '[a-z0-9-]*\\.vercel\\.app)$',
  'i'
);

/** Returns the origin header if it's allowed, otherwise null.
 *  A15.4 — HIGH fix: previously a missing Origin header was treated as
 *  same-origin (allowed), which lets curl/Postman/bots bypass CORS entirely.
 *  Now we also accept a same-host Referer (for legitimate same-origin
 *  navigation that may strip Origin), but reject when BOTH are missing.
 */
export function checkOrigin(req) {
  var origin = (req.headers && req.headers.origin) || '';
  // Sawil 2026-06 — allow http://localhost:* ONLY under local dev (`vercel dev`
  // sets VERCEL_ENV='development'; a bare `node` dev sets neither VERCEL nor
  // production NODE_ENV). VERCEL_ENV is 'preview'/'production' once deployed, so
  // this NEVER opens localhost on the live site. Lets us test the real LLM
  // (/api/chat) locally instead of always falling back to the offline engine.
  var isLocalDev = process.env.VERCEL_ENV === 'development'
    || (!process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production');
  if (isLocalDev && /^https?:\/\/localhost(:\d+)?$/i.test(origin)) return origin;
  if (origin) {
    if (ALLOWED_ORIGIN_RE.test(origin)) return origin;
    return null;
  }
  // No Origin — accept only if Referer matches our domains.
  var referer = (req.headers && req.headers.referer) || '';
  if (referer) {
    try {
      var refUrl = new URL(referer);
      var refOrigin = refUrl.origin;
      if (ALLOWED_ORIGIN_RE.test(refOrigin)) return refOrigin;
    } catch (e) { /* malformed referer */ }
  }
  return null;
}

/** Apply CORS + security response headers. */
export function applyCors(req, res, allowedOrigin) {
  if (allowedOrigin) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

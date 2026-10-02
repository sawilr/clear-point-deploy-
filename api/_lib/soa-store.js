// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — Shared SOA token storage layer.
// Used by: api/soa-token.js (write), api/sign-soa.js (read+update), api/soa-status.js (read).
//
// Single source of truth for the KV-vs-memory fallback so the 3 endpoints
// can't drift.
// ─────────────────────────────────────────────────────────────────────────────

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const KV_AVAILABLE = !!(KV_URL && KV_TOKEN);

const TOKEN_TTL_SEC = 24 * 60 * 60; // 24h — A16 hard limit on SOA signing window

// In-memory fallback (dev only; production should configure KV).
const memoryStore = new Map();

function memoryGet(key) {
  var entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key, value, ttlSec) {
  memoryStore.set(key, { value: value, expiresAt: Date.now() + ttlSec * 1000 });
}

async function kvGetJson(key) {
  var r = await fetch(KV_URL + '/get/' + encodeURIComponent(key), {
    headers: { 'Authorization': 'Bearer ' + KV_TOKEN },
  });
  if (!r.ok) throw new Error('kv_get_failed:' + r.status);
  var j = await r.json();
  if (!j || j.result == null) return null;
  try { return JSON.parse(j.result); } catch (e) { return null; }
}

async function kvSetJson(key, value, ttlSec) {
  var body = JSON.stringify([['SET', key, JSON.stringify(value), 'EX', String(ttlSec)]]);
  var r = await fetch(KV_URL + '/pipeline', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + KV_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body,
  });
  if (!r.ok) throw new Error('kv_set_failed:' + r.status);
}

/** Read an SOA token record. Returns null if missing / expired. */
export async function getSoaToken(token) {
  var key = 'soa-token:' + token;
  try {
    return KV_AVAILABLE ? await kvGetJson(key) : memoryGet(key);
  } catch (e) {
    console.error('[soa-store] getSoaToken kv error, falling back to memory:', e && e.message);
    return memoryGet(key);
  }
}

/** Persist (write or update) an SOA token record. */
export async function setSoaToken(token, value) {
  var key = 'soa-token:' + token;
  try {
    if (KV_AVAILABLE) await kvSetJson(key, value, TOKEN_TTL_SEC);
    else memorySet(key, value, TOKEN_TTL_SEC);
  } catch (e) {
    console.error('[soa-store] setSoaToken kv error, falling back to memory:', e && e.message);
    memorySet(key, value, TOKEN_TTL_SEC);
  }
}

export const SOA_TOKEN_TTL_SEC = TOKEN_TTL_SEC;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-10-01 (SEC-TOK-01/02) — generic keyed access.
//
// The pair above can only address a record BY ITS TOKEN, which is why the SOA
// link record had to hold the beneficiary's name, phone, email and ZIP: the
// token was the only handle. api/soa-status.js then returned all of it to
// anyone presenting the bare UUID.
//
// The CY2027 link (api/_lib/cy2027/secure-link.js) splits that in two: a link
// record addressed by sha256(token) that holds NO personal data, and a lead
// record addressed by an opaque reference that is only reachable after a second
// factor passes. Both need an arbitrary key, hence these.
// ─────────────────────────────────────────────────────────────────────────────

/** Read any record by its full store key. Returns null if missing / expired. */
export async function getRecord(storeKey) {
  try {
    return KV_AVAILABLE ? await kvGetJson(storeKey) : memoryGet(storeKey);
  } catch (e) {
    console.error('[soa-store] getRecord kv error, falling back to memory:', e && e.message);
    return memoryGet(storeKey);
  }
}

/**
 * Write any record by its full store key, with an explicit TTL.
 *
 * Unlike setSoaToken this does NOT swallow a KV failure into the in-memory map:
 * a link or lead record that exists only in one lambda's memory is a link that
 * breaks on the next request. The caller must be told.
 */
export async function setRecord(storeKey, value, ttlSec) {
  if (!KV_AVAILABLE) { memorySet(storeKey, value, ttlSec); return { ok: true, durable: false }; }
  try {
    await kvSetJson(storeKey, value, ttlSec);
    return { ok: true, durable: true };
  } catch (e) {
    console.error('[soa-store] setRecord kv failed:', e && e.message);
    return { ok: false, durable: false, reason: 'KV_WRITE_FAILED' };
  }
}

/** Opaque, non-sequential reference for a lead record. Never appears in a URL. */
export function leadKey(beneficiaryRef) {
  return 'soa-lead:' + beneficiaryRef;
}

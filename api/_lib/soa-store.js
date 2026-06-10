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

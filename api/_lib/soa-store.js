// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — Shared SOA token storage layer.
// Used by: api/soa-token.js (write), api/sign-soa.js (read+update), api/soa-status.js (read),
// api/_lib/cy2027/soa-ledger.js (read+write+claim).
//
// Single source of truth for the KV-vs-memory fallback so the endpoints
// can't drift.
//
// AUDIT 2026-10-04 (WVG-11) — the original pair, getSoaToken/setSoaToken,
// swallowed a KV write failure into this lambda's memory while the next request
// read KV again, so a consumed flag written during an outage was a flag nobody
// would ever read. Nothing had called them since the CY2027 link replaced the
// bare UUID (SEC-TOK-01/02), and a lossy helper that still exports is a helper
// somebody will reach for: they are gone. Every function below reports a KV
// failure to its caller; none falls back to memory when KV is configured.
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

function memoryHas(key) {
  return memoryGet(key) !== null;
}

/** The stored string for a key, or null when the key is absent. */
async function kvGetRaw(key) {
  var r = await fetch(KV_URL + '/get/' + encodeURIComponent(key), {
    headers: { 'Authorization': 'Bearer ' + KV_TOKEN },
  });
  if (!r.ok) throw new Error('kv_get_failed:' + r.status);
  var j = await r.json();
  if (!j || j.result == null) return null;
  return String(j.result);
}

async function kvGetJson(key) {
  var raw = await kvGetRaw(key);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
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

/**
 * SET … NX: write only if the key is absent. Redis performs the check and the
 * write as one operation, which is what makes this a claim rather than a race.
 * Resolves true when this call wrote the key, false when it already existed.
 */
async function kvSetNxJson(key, value, ttlSec) {
  var body = JSON.stringify([['SET', key, JSON.stringify(value), 'EX', String(ttlSec), 'NX']]);
  var r = await fetch(KV_URL + '/pipeline', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + KV_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body,
  });
  if (!r.ok) throw new Error('kv_setnx_failed:' + r.status);
  var j = await r.json();
  var first = Array.isArray(j) ? j[0] : null;
  // A per-command error comes back as { error } with no result: not a claim.
  if (!first || typeof first !== 'object' || !('result' in first)) throw new Error('kv_setnx_unreadable');
  return first.result === 'OK';
}

async function kvDel(key) {
  var body = JSON.stringify([['DEL', key]]);
  var r = await fetch(KV_URL + '/pipeline', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + KV_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body,
  });
  if (!r.ok) throw new Error('kv_del_failed:' + r.status);
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

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-10-04 (EV-09, WVG-11) — reads and claims that REPORT.
//
// getRecord() above turns a KV read failure into "absent" (it falls back to a
// memory that production never wrote). For a link record that is a dead link,
// which fails closed. For the appointment ledger it is the opposite: an empty
// answer means "no SOA has been signed for this appointment", and a second
// signature would proceed on it. These three never default.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read any record and say whether the read happened. `value` is null when the
 * key is absent; a KV failure or a value that is not JSON is `ok: false`.
 */
export async function readRecord(storeKey) {
  if (!KV_AVAILABLE) return { ok: true, value: memoryGet(storeKey), durable: false };
  var raw;
  try {
    raw = await kvGetRaw(storeKey);
  } catch (e) {
    console.error('[soa-store] readRecord kv failed:', e && e.message);
    return { ok: false, durable: false, reason: 'KV_READ_FAILED' };
  }
  if (raw === null) return { ok: true, value: null, durable: true };
  try {
    return { ok: true, value: JSON.parse(raw), durable: true };
  } catch (e) {
    console.error('[soa-store] readRecord stored value is not JSON for key class ' + String(storeKey).split(':')[0]);
    return { ok: false, durable: false, reason: 'KV_VALUE_UNREADABLE' };
  }
}

/**
 * Write a record only if the key is absent (an atomic claim). `claimed` is
 * false when another writer holds it; `ok` is false when the store could not
 * say either way — the caller must treat that as "not claimed".
 */
export async function claimRecord(storeKey, value, ttlSec) {
  if (!KV_AVAILABLE) {
    if (memoryHas(storeKey)) return { ok: true, claimed: false, durable: false };
    memorySet(storeKey, value, ttlSec);
    return { ok: true, claimed: true, durable: false };
  }
  try {
    var claimed = await kvSetNxJson(storeKey, value, ttlSec);
    return { ok: true, claimed: claimed, durable: true };
  } catch (e) {
    console.error('[soa-store] claimRecord kv failed:', e && e.message);
    return { ok: false, claimed: false, durable: false, reason: 'KV_WRITE_FAILED' };
  }
}

/** Remove a record (used to release a claim). Reports a KV failure. */
export async function deleteRecord(storeKey) {
  if (!KV_AVAILABLE) { memoryStore.delete(storeKey); return { ok: true, durable: false }; }
  try {
    await kvDel(storeKey);
    return { ok: true, durable: true };
  } catch (e) {
    console.error('[soa-store] deleteRecord kv failed:', e && e.message);
    return { ok: false, durable: false, reason: 'KV_WRITE_FAILED' };
  }
}

/** Opaque, non-sequential reference for a lead record. Never appears in a URL. */
export function leadKey(beneficiaryRef) {
  return 'soa-lead:' + beneficiaryRef;
}

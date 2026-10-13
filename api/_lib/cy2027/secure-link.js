// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — SECURE SOA LINK (spec §9, §12, §26, §30). SERVER ONLY.
//
// "Link uses random high-entropy token, short expiration, server-side binding,
//  replay protection, HTTPS, CSRF protection, rate limiting, bot/abuse controls,
//  and no sequential contact IDs in URL."
// "Before displaying any prefilled information, verify the session/channel
//  sufficiently. Do not reveal private CRM data to anyone who merely possesses
//  a guessed URL."
// "Never expose contact IDs, SOA IDs or predictable identifiers in a way that
//  authorizes access. Use opaque tokens and server-side ownership checks."
//
// ─── WHAT THIS REPLACES ──────────────────────────────────────────────────────
// The pre-existing SOA link (api/soa-token.js + api/soa-status.js) issues a
// `crypto.randomUUID()` and stores the lead's data under `soa-token:<uuid>`.
// api/soa-status.js then returns fullName, phone, email and zip to anyone who
// presents that UUID — no second factor. It is not currently exploitable only
// because SOA_ENABLED=false makes every one of those routes answer 503 first,
// and src/lib/soaContent.ts already tracks it as the unmet precondition
// `statusEndpointSecondFactor`. This module is the primitive that closes it.
//
// Three design choices worth stating because they are not interchangeable:
//
//  1. The token is 256 bits of CSPRNG, not a UUIDv4 (122 bits of which some are
//     version/variant constants). It is never an identifier of anything.
//  2. The STORE IS KEYED BY sha256(token), not by the token. A dump of the
//     store therefore yields no usable links — the same reason password hashes
//     exist. The token lives only in the recipient's SMS/email.
//  3. Possession of the link reveals NOTHING private on its own. Prefill
//     requires a second factor the holder of a forwarded link would not have.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

/** 256-bit token, URL-safe, no padding. */
const TOKEN_BYTES = 32;

/** Short expiry (spec §9). Signing windows are not sessions. */
export const DEFAULT_TTL_SEC = 72 * 60 * 60;

/** How many times a link may be opened before it is treated as abuse. */
export const MAX_VIEWS = 20;

export const SECOND_FACTOR_KINDS = Object.freeze(['PHONE_LAST4', 'ZIP', 'OTP']);

/** Hash used for both the store key and the second factor. */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

/** Constant-time compare of two hex digests of equal length. */
function timingSafeEqualHex(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Normalize a second factor before hashing so formatting never matters. */
function normalizeFactor(kind, value) {
  const v = String(value == null ? '' : value).trim();
  if (kind === 'PHONE_LAST4') return v.replace(/\D/g, '').slice(-4);
  if (kind === 'ZIP') return v.replace(/\D/g, '').slice(0, 5);
  return v.toUpperCase();
}

/**
 * Issue a link.
 *
 * Returns `{ token, storeKey, record }`. The caller persists `record` under
 * `storeKey` and puts ONLY `token` in the URL. `record` deliberately contains no
 * name, phone, email or address — the link cannot leak what it never held.
 *
 * `beneficiaryRef` is an opaque internal reference (e.g. a CRM contact id) that
 * the server resolves AFTER the second factor passes. It never appears in a URL.
 */
export function issueLink({
  soaId,
  appointmentId,
  beneficiaryRef,
  channel,
  secondFactorKind,
  secondFactorValue,
  language = 'en',
  ttlSec = DEFAULT_TTL_SEC,
  now = new Date(),
}) {
  if (!soaId) throw new Error('secure-link: soaId is required');
  if (!appointmentId) throw new Error('secure-link: appointmentId is required (no universal SOA links)');
  if (!beneficiaryRef) throw new Error('secure-link: beneficiaryRef is required');
  if (!['WEB', 'SMS_LINK', 'EMAIL_LINK'].includes(channel)) throw new Error(`secure-link: unknown channel "${channel}"`);
  if (!SECOND_FACTOR_KINDS.includes(secondFactorKind)) {
    throw new Error(`secure-link: unknown second factor "${secondFactorKind}"`);
  }
  const normalized = normalizeFactor(secondFactorKind, secondFactorValue);
  if (!normalized) throw new Error('secure-link: the second factor cannot be empty');

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();

  return {
    token,
    storeKey: 'soa-link:' + sha256(token),
    record: {
      soaId,
      appointmentId,
      beneficiaryRef,
      channel,
      language,
      issuedAt,
      expiresAt,
      secondFactorKind,
      secondFactorHash: sha256(normalized),
      views: 0,
      consumedAt: null,
      revokedAt: null,
    },
  };
}

/** Store key for a presented token. Lets the caller look up without the token. */
export function storeKeyFor(token) {
  return 'soa-link:' + sha256(token);
}

/**
 * AUDIT 2026-10-04 (WVG-11, red team) — what became of a consumed link. The
 * signing handler burns the link BEFORE it writes any evidence (so a consumed
 * link means at most one evidence record), which means "consumed" alone no
 * longer implies "signed": a storage failure after the burn leaves a consumed
 * link and no signature. The outcome is stamped on the record, and ONLY a link
 * stamped FILED may ever be read as a signature — an allow-list of one value,
 * never "anything that is not failed". In progress, failed, or no outcome at
 * all is a link that was used with nothing filed behind it, and the status
 * endpoint must offer a restart, not a receipt.
 */
export const LINK_OUTCOME = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  FILED: 'FILED',
  FAILED: 'FAILED',
});

/**
 * Validate a presented link BEFORE any second factor.
 *
 * Spec §26: "Invalid/expired secure token -> do not reveal form data; issue
 * safe restart."
 *
 * RED TEAM 2026-10-02 (SL-06, MEDIUM) — an earlier comment here claimed failures
 * "reveal nothing about the record", which the six distinct reasons contradict.
 * Stating the real boundary instead of overclaiming: the reasons distinguish the
 * STATE OF A LINK THE CALLER ALREADY HOLDS (expired, used, revoked), which the
 * UI needs — telling someone who already signed that the link was "not found"
 * invites a second signature and a duplicate scope. They reveal nothing about
 * any BENEFICIARY: no name, phone, email, ZIP, SOA id or appointment id, and no
 * way to learn whether a given person has an SOA pending. Tokens are 256 bits,
 * so enumerating links to harvest states is not a reachable attack.
 */
export function checkLink(record, { now = new Date() } = {}) {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'LINK_NOT_FOUND' };
  // RED TEAM 2026-10-02 (SL-03, HIGH) — this failed OPEN three ways: an
  // unparseable or missing expiresAt made `Date.parse(...) <= now` false, so the
  // link never expired; and `revokedAt`/`consumedAt` were tested for truthiness,
  // so a present-but-falsy value ('' or 0, which is what some stores return for
  // a cleared field) read as "not revoked" and "not used".
  if ('revokedAt' in record && record.revokedAt !== null && record.revokedAt !== undefined) {
    return { ok: false, reason: 'LINK_REVOKED' };
  }
  if ('consumedAt' in record && record.consumedAt !== null && record.consumedAt !== undefined) {
    // AUDIT 2026-10-04 (WVG-11, red team) — "used" used to mean "signed", and
    // the page rendered "This document is already signed" for a link whose
    // signature had failed after the burn. See LINK_OUTCOME: only FILED says so.
    return { ok: false, reason: record.consumedOutcome === LINK_OUTCOME.FILED ? 'LINK_ALREADY_USED' : 'LINK_CONSUMED_UNFILED' };
  }
  const exp = Date.parse(record.expiresAt);
  if (!Number.isFinite(exp)) return { ok: false, reason: 'LINK_EXPIRY_UNREADABLE' };
  if (exp <= now.getTime()) return { ok: false, reason: 'LINK_EXPIRED' };
  const views = Number(record.views || 0);
  if (!Number.isFinite(views) || views >= MAX_VIEWS) return { ok: false, reason: 'LINK_VIEW_LIMIT' };
  return { ok: true };
}

/**
 * Verify the second factor. Constant-time, and a failure never says which part
 * was wrong.
 *
 * Returns `{ ok, attemptsRemaining, record }`. The caller MUST persist the
 * returned record so the failure counter survives; a counter kept only in
 * memory is not a counter.
 */
export function verifySecondFactor(record, supplied, { maxAttempts = 5 } = {}) {
  const base = checkLink(record);
  if (!base.ok) return { ok: false, reason: base.reason, record };

  const failed = (record.failedFactorAttempts || 0);
  if (failed >= maxAttempts) {
    return { ok: false, reason: 'SECOND_FACTOR_LOCKED', record, signal: 'REPEATED_FAILED_OTP' };
  }
  const normalized = normalizeFactor(record.secondFactorKind, supplied);
  const matches = !!normalized && timingSafeEqualHex(sha256(normalized), record.secondFactorHash);
  if (!matches) {
    const next = { ...record, failedFactorAttempts: failed + 1 };
    return {
      ok: false,
      reason: 'SECOND_FACTOR_MISMATCH',
      attemptsRemaining: Math.max(0, maxAttempts - next.failedFactorAttempts),
      record: next,
      signal: next.failedFactorAttempts >= maxAttempts ? 'REPEATED_FAILED_OTP' : null,
    };
  }
  return { ok: true, record: { ...record, failedFactorAttempts: 0, factorVerifiedAt: new Date().toISOString() } };
}

/**
 * What a caller may be told, given how far they have authenticated.
 *
 * UNVERIFIED possession of the link yields only what is needed to render the
 * challenge: that the link is live, and which factor to ask for. It never
 * returns a name, phone, email, address or the beneficiary reference — which
 * is what makes forwarding a link harmless.
 */
export function linkDisclosure(record, { factorVerified = false } = {}) {
  const base = checkLink(record);
  if (!base.ok) return { exists: false, reason: base.reason };
  if (!factorVerified) {
    return {
      exists: true,
      factorRequired: record.secondFactorKind,
      language: record.language,
      // deliberately nothing else
    };
  }
  return {
    exists: true,
    factorRequired: null,
    language: record.language,
    soaId: record.soaId,
    appointmentId: record.appointmentId,
    beneficiaryRef: record.beneficiaryRef,
  };
}

/** Count a view. Returns the record to persist. */
export function recordView(record, { now = new Date() } = {}) {
  return { ...record, views: (record.views || 0) + 1, lastViewedAt: now.toISOString() };
}

/**
 * Burn the link at signature. Replay protection: a second call returns
 * `ALREADY_USED` rather than signing twice.
 */
export function consumeLink(record, { now = new Date() } = {}) {
  // A consumed link is refused with WHAT it is (already used, or used and
  // unfiled) — checkLink() names it; a second call never says "signed" on its own.
  const check = checkLink(record, { now });
  if (!check.ok) return { ok: false, reason: check.reason, record };
  return { ok: true, record: { ...record, consumedAt: now.toISOString(), consumedOutcome: LINK_OUTCOME.IN_PROGRESS } };
}

/**
 * AUDIT 2026-10-04 (WVG-11, red team) — stamp what became of a consumed link.
 * FILED carries the time the signature was filed — the ONLY time `signedAt` is
 * ever written on a link, so a link cannot say "signed at …" before anything
 * was signed. FAILED names the stage that failed and clears any time. A record
 * that was never consumed, an outcome outside LINK_OUTCOME, a FAILED without a
 * stage or a FILED without a time is refused by throwing: a stamp that is not
 * one of these is not written.
 */
export function markLinkOutcome(record, outcome, { stage = null, signedAt = null } = {}) {
  if (!record || typeof record !== 'object' || record.consumedAt === null || record.consumedAt === undefined) {
    throw new Error('secure-link: only a consumed link has an outcome');
  }
  if (outcome === LINK_OUTCOME.FILED) {
    if (typeof signedAt !== 'string' || !Number.isFinite(Date.parse(signedAt))) throw new Error('secure-link: FILED needs the filing time');
    return { ...record, consumedOutcome: LINK_OUTCOME.FILED, signedAt, failedStage: null };
  }
  if (outcome === LINK_OUTCOME.FAILED) {
    if (typeof stage !== 'string' || !stage) throw new Error('secure-link: FAILED needs the stage');
    return { ...record, consumedOutcome: LINK_OUTCOME.FAILED, failedStage: stage, signedAt: null };
  }
  throw new Error('secure-link: unknown link outcome');
}

/** Revoke a link (beneficiary asked, or security review). */
export function revokeLink(record, { now = new Date(), reason = 'UNSPECIFIED' } = {}) {
  return { ...record, revokedAt: now.toISOString(), revokedReason: reason };
}

/**
 * Re-sending a copy must NOT create a new SOA (spec §9). Re-issuing a link for
 * an SOA that is already signed is therefore refused here rather than left to
 * each call site to remember.
 */
export function mayReissue(record, soaInstanceStatus) {
  // RED TEAM 2026-10-02 (SL-02, HIGH) — this refused only the exact string
  // 'COMPLETED', so a failed status lookup (undefined) or an already-replaced
  // instance ('SUPERSEDED') minted a fresh signing link for an SOA that had
  // already been signed. The safe default is to refuse what we cannot vouch for.
  const ALLOWED_TO_REISSUE = ['DRAFT', 'PENDING_SIGNATURE', 'SOA_INCOMPLETE'];
  if (typeof soaInstanceStatus !== 'string' || !ALLOWED_TO_REISSUE.includes(soaInstanceStatus)) {
    return { allowed: false, reason: 'SOA_STATUS_DOES_NOT_PERMIT_REISSUE', status: soaInstanceStatus ?? null };
  }
  if (record?.revokedAt != null) return { allowed: false, reason: 'LINK_REVOKED' };
  if (record?.consumedAt != null) return { allowed: false, reason: 'LINK_ALREADY_USED' };
  return { allowed: true };
}

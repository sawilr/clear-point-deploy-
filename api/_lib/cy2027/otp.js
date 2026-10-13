// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — ONE-TIME CODE FOR THE SECURE LINK (spec §12, §30, Phase 6).
// SERVER ONLY (node:crypto).
//
// §12  "Use low-friction channel verification: full name plus confirmed
//       state/ZIP and one-time code to the phone/email supplied or previously
//       trusted channel when appropriate."
// §12  "Separate CONTACT_CHANNEL_VERIFIED from IDENTITY_VERIFIED. An OTP proves
//       control of a channel, not legal identity."
// §12  "… repeated failed OTP …" is a review signal.
// §30  "protect OTP endpoint against brute force and SMS bombing."
//
// AUDIT 2026-10-04 (SPEC-12) — secure-link.js declared 'OTP' as a second-factor
// kind and verifySecondFactor() already locked a link after repeated failures,
// but nothing ever ISSUED a code: api/soa-token.js minted every link with
// PHONE_LAST4, a value the holder of a forwarded link can often guess and that
// proves nothing about who controls the phone. This module is the code itself:
//
//   issueOtp()        CSPRNG digits; the record keeps a per-code salt and an
//                     HMAC of the code — never the code. Short expiry, single
//                     use, and the issue is counted as a send on the link.
//   verifyOtp()       constant-time compare; expired, used or never-issued
//                     codes are refused by name. Called from
//                     secure-link.verifySecondFactor(), which keeps the ONE
//                     attempt counter and lockout for every factor kind, so a
//                     resend cannot reset a brute-force count.
//   otpSendPlan()     the SMS-bombing control: a floor between sends, a cap per
//                     link per window, and a cap per DESTINATION per window
//                     across links (so minting many links for one phone does
//                     not become many messages).
//   otpDestination()  the ONLY source of the destination: the lead record the
//                     server itself wrote at issue, reached through the opaque
//                     reference inside the link. A phone or email arriving with
//                     a verification or resend request is never used.
//   mayDeliverOtp()   the outbound gate, shaped exactly like
//                     beneficiary-copy.maySendCopy(): a flag, a configured
//                     https channel and a recorded contact permission — all
//                     three, none inferred. Until the owner turns it on the OTP
//                     kind is simply not offered (otpFactorForIssue) and the
//                     factor in use today stays.
//   verificationClaim() what a verified link may be said to prove:
//                     CONTACT_CHANNEL_VERIFIED for a code, LINK_FACTOR_MATCHED
//                     for a last-4 or ZIP, and never IDENTITY_VERIFIED.
//
// Nothing here sends: deliverOtp() returns a reason instead of sending unless
// every condition of mayDeliverOtp() holds, and no handler in this repository
// can satisfy the consent condition yet (see api/soa-token.js).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { isAffirmative } from './consent.js';
import { assertNotMarketing } from './beneficiary-copy.js';

/** Freeze a governing object all the way down (the build gate checks it). */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
}

export const OTP_CHANNELS = Object.freeze(['SMS', 'EMAIL']);

/**
 * The policy. Registered with the no-self-modification gate: nothing under
 * api/ or src/ may write to it, and it is frozen all the way down.
 *
 *   codeLength            6 digits: 10^6 codes against the link's attempt
 *                         limit (secure-link.MAX_FACTOR_ATTEMPTS, one number
 *                         for every factor kind, declared there and not here)
 *   ttlSec                a code lives ten minutes, not the link's 24 hours
 *   minResendIntervalSec  floor between two sends on one link
 *   maxSendsPerLink       sends per link inside windowSec
 *   maxSendsPerDestination sends per phone/email inside windowSec, across links
 *   windowSec             the sliding window for both caps
 */
export const OTP_POLICY = deepFreeze({
  codeLength: 6,
  ttlSec: 10 * 60,
  minResendIntervalSec: 60,
  maxSendsPerLink: 3,
  maxSendsPerDestination: 5,
  windowSec: 60 * 60,
});

/** Every reason this module can refuse with, for the suite to check it reached each one. */
export const OTP_REFUSAL = deepFreeze({
  UNKNOWN_CHANNEL: 'UNKNOWN_CHANNEL',
  SENDING_DISABLED: 'SENDING_DISABLED',
  CHANNEL_NOT_CONFIGURED: 'CHANNEL_NOT_CONFIGURED',
  NO_CONTACT_PERMISSION: 'NO_CONTACT_PERMISSION',
  NO_DESTINATION_ON_FILE: 'NO_DESTINATION_ON_FILE',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  OTP_LINK_SEND_LIMIT: 'OTP_LINK_SEND_LIMIT',
  OTP_DESTINATION_SEND_LIMIT: 'OTP_DESTINATION_SEND_LIMIT',
  OTP_NOT_ISSUED: 'OTP_NOT_ISSUED',
  OTP_ALREADY_USED: 'OTP_ALREADY_USED',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_MISMATCH: 'OTP_MISMATCH',
  MARKETING_CONTENT_BLOCKED: 'MARKETING_CONTENT_BLOCKED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  PROVIDER_UNREACHABLE: 'PROVIDER_UNREACHABLE',
});

/** What a verified link proves. There is deliberately no IDENTITY value here. */
export const VERIFICATION_CLAIM = deepFreeze({
  NONE: 'NONE',
  LINK_FACTOR_MATCHED: 'LINK_FACTOR_MATCHED',
  CONTACT_CHANNEL_VERIFIED: 'CONTACT_CHANNEL_VERIFIED',
});

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function hmacHex(saltHex, code) {
  return crypto.createHmac('sha256', Buffer.from(saltHex, 'hex')).update(String(code), 'utf8').digest('hex');
}

const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** A phone as the digits the provider dials; an email folded. Null when it is neither. */
export function normalizeDestination(channel, to) {
  const raw = String(to == null ? '' : to).trim();
  if (channel === 'SMS') {
    let digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits.length === 10 ? digits : null;
  }
  if (channel === 'EMAIL') {
    const folded = raw.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(folded) ? folded : null;
  }
  return null;
}

// ── The outbound gate (shaped like beneficiary-copy.maySendCopy) ─────────────

/** True only when the owner has switched one-time codes on. */
export function otpSendingEnabled(env = process.env) {
  const v = String(env.CY2027_SEND_OTP || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Provider configuration for a channel, or null. https only. */
function otpChannelConfig(channel, env = process.env) {
  if (channel === 'SMS') {
    const url = (env.CY2027_OTP_SMS_URL || '').trim();
    const token = (env.CY2027_OTP_SMS_TOKEN || '').trim();
    return url && token && /^https:\/\//i.test(url) ? { url, token } : null;
  }
  if (channel === 'EMAIL') {
    const url = (env.CY2027_OTP_EMAIL_URL || '').trim();
    const token = (env.CY2027_OTP_EMAIL_TOKEN || '').trim();
    return url && token && /^https:\/\//i.test(url) ? { url, token } : null;
  }
  return null;
}

/**
 * Whether a code may be sent at all. Every blocker is named; nothing is
 * inferred. §6: contact permission is its own object — a request to sign an
 * SOA is not permission to message the person, so a recorded
 * CALLBACK_CONTACT_PERMISSION is required, exactly as for the confirmation copy.
 */
export function mayDeliverOtp({ channel, consent, env = process.env } = {}) {
  if (!OTP_CHANNELS.includes(channel)) return { allowed: false, reason: OTP_REFUSAL.UNKNOWN_CHANNEL };
  if (!otpSendingEnabled(env)) return { allowed: false, reason: OTP_REFUSAL.SENDING_DISABLED };
  if (!otpChannelConfig(channel, env)) return { allowed: false, reason: OTP_REFUSAL.CHANNEL_NOT_CONFIGURED };
  if (!isAffirmative(consent, 'CALLBACK_CONTACT_PERMISSION')) return { allowed: false, reason: OTP_REFUSAL.NO_CONTACT_PERMISSION };
  return { allowed: true, reason: 'OK' };
}

/**
 * Which second factor a new link gets. The OTP kind is offered ONLY when the
 * gate above allows a code to go out; otherwise the factor in use today stays,
 * with the reason it stayed, so the issuer can audit why.
 */
export function otpFactorForIssue({ channel = 'SMS', consent, env = process.env } = {}) {
  const gate = mayDeliverOtp({ channel, consent, env });
  if (!gate.allowed) return { kind: 'PHONE_LAST4', otpChannel: null, reason: gate.reason };
  return { kind: 'OTP', otpChannel: channel, reason: 'OK' };
}

// ── The destination ──────────────────────────────────────────────────────────

/**
 * The destination a code may go to: the phone or email ON THE LEAD RECORD the
 * server wrote when the link was issued, and nothing else. A verification or
 * resend request carries no destination this function would read.
 */
export function otpDestination(leadRecord, channel) {
  if (!OTP_CHANNELS.includes(channel)) return { ok: false, reason: OTP_REFUSAL.UNKNOWN_CHANNEL };
  if (!leadRecord || typeof leadRecord !== 'object') return { ok: false, reason: OTP_REFUSAL.NO_DESTINATION_ON_FILE };
  const to = normalizeDestination(channel, channel === 'SMS' ? leadRecord.phone : leadRecord.email);
  if (!to) return { ok: false, reason: OTP_REFUSAL.NO_DESTINATION_ON_FILE };
  return { ok: true, to };
}

/** Store key for the per-destination send log. The destination itself is never a key. */
export function otpDestinationKey(channel, to) {
  const normalized = normalizeDestination(channel, to);
  if (!normalized) throw new Error('otp: a destination key needs a usable destination');
  return 'otp-dest:' + sha256Hex(channel + ':' + normalized);
}

// ── The SMS-bombing control ──────────────────────────────────────────────────

/** Sends inside the window, oldest first. Anything unreadable is dropped (it cannot count for the caller). */
function sendsInWindow(sends, now, policy) {
  const floor = now.getTime() - policy.windowSec * 1000;
  return (Array.isArray(sends) ? sends : [])
    .filter((at) => isIso(at) && Date.parse(at) > floor && Date.parse(at) <= now.getTime())
    .sort((a, b) => Date.parse(a) - Date.parse(b));
}

/** Why one more send on THIS link is refused, or null. */
export function linkSendProblem(linkRecord, { now = new Date(), policy = OTP_POLICY } = {}) {
  const sends = sendsInWindow(linkRecord && linkRecord.otp ? linkRecord.otp.sends : [], now, policy);
  if (sends.length >= policy.maxSendsPerLink) return OTP_REFUSAL.OTP_LINK_SEND_LIMIT;
  const last = sends.length ? Date.parse(sends[sends.length - 1]) : null;
  if (last !== null && now.getTime() - last < policy.minResendIntervalSec * 1000) return OTP_REFUSAL.OTP_RESEND_TOO_SOON;
  return null;
}

/** Why one more send to THIS phone/email is refused, whichever link asks, or null. */
export function destinationSendProblem(destRecord, { now = new Date(), policy = OTP_POLICY } = {}) {
  const sends = sendsInWindow(destRecord ? destRecord.sends : [], now, policy);
  if (sends.length >= policy.maxSendsPerDestination) return OTP_REFUSAL.OTP_DESTINATION_SEND_LIMIT;
  return null;
}

/** The per-destination record after one more send; sends outside the window are dropped. */
export function recordDestinationSend(destRecord, { now = new Date(), policy = OTP_POLICY } = {}) {
  return { sends: [...sendsInWindow(destRecord ? destRecord.sends : [], now, policy), now.toISOString()] };
}

/**
 * Both caps, link first (so a destination that is at its limit is not even
 * named to a link that has exhausted its own). Returns `{ allowed, reason }`.
 */
export function otpSendPlan({ linkRecord, destRecord, now = new Date(), policy = OTP_POLICY } = {}) {
  const link = linkSendProblem(linkRecord, { now, policy });
  if (link) return { allowed: false, reason: link };
  const dest = destinationSendProblem(destRecord, { now, policy });
  if (dest) return { allowed: false, reason: dest };
  return { allowed: true, reason: 'OK' };
}

// ── The code ─────────────────────────────────────────────────────────────────

/**
 * Issue a code for an OTP link. Returns `{ code, record }`: the caller delivers
 * `code` and persists `record`, which holds a fresh salt and the HMAC — never
 * the code. A new code replaces the previous one (that one stops verifying),
 * and the issue is counted as a send on the link. The attempt counter is NOT
 * touched: a resend never resets a brute-force count.
 */
export function issueOtp(linkRecord, { now = new Date(), policy = OTP_POLICY } = {}) {
  if (!linkRecord || typeof linkRecord !== 'object') throw new Error('otp: a link record is required');
  if (linkRecord.secondFactorKind !== 'OTP') throw new Error('otp: the link does not use a one-time code');
  const channel = linkRecord.otp && linkRecord.otp.channel;
  if (!OTP_CHANNELS.includes(channel)) throw new Error('otp: the link has no OTP channel');
  const code = String(crypto.randomInt(0, 10 ** policy.codeLength)).padStart(policy.codeLength, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  const issuedAt = now.toISOString();
  return {
    code,
    record: {
      ...linkRecord,
      otp: {
        channel,
        salt,
        hash: hmacHex(salt, code),
        issuedAt,
        expiresAt: new Date(now.getTime() + policy.ttlSec * 1000).toISOString(),
        consumedAt: null,
        sends: [...sendsInWindow(linkRecord.otp.sends, now, policy), issuedAt],
        consentBasis: linkRecord.otp.consentBasis || null,
      },
    },
  };
}

/**
 * Verify a presented code against the link. Constant-time. Returns
 * `{ ok, reason, record }`; on success the code is consumed (single use).
 * The attempt counter and lockout live in secure-link.verifySecondFactor(),
 * which is the only caller that may release anything.
 */
export function verifyOtp(linkRecord, supplied, { now = new Date(), policy = OTP_POLICY } = {}) {
  const otp = linkRecord && linkRecord.secondFactorKind === 'OTP' ? linkRecord.otp : null;
  if (!otp || typeof otp.hash !== 'string' || !otp.hash || typeof otp.salt !== 'string' || !otp.salt) {
    return { ok: false, reason: OTP_REFUSAL.OTP_NOT_ISSUED, record: linkRecord };
  }
  if (otp.consumedAt !== null && otp.consumedAt !== undefined) return { ok: false, reason: OTP_REFUSAL.OTP_ALREADY_USED, record: linkRecord };
  if (!isIso(otp.expiresAt) || Date.parse(otp.expiresAt) <= now.getTime()) return { ok: false, reason: OTP_REFUSAL.OTP_EXPIRED, record: linkRecord };
  const digits = String(supplied == null ? '' : supplied).replace(/\D/g, '');
  // Compare a digest of the right shape even when the length is wrong, so the
  // time taken does not say how close the guess was.
  const candidate = digits.length === policy.codeLength ? digits : '0'.repeat(policy.codeLength);
  const a = Buffer.from(hmacHex(otp.salt, candidate), 'utf8');
  const b = Buffer.from(otp.hash, 'utf8');
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b) && digits.length === policy.codeLength;
  if (!matches) return { ok: false, reason: OTP_REFUSAL.OTP_MISMATCH, record: linkRecord };
  return { ok: true, reason: 'OK', record: { ...linkRecord, otp: { ...otp, consumedAt: now.toISOString() } } };
}

/**
 * What a link's verification may be said to prove.
 *
 *   CONTACT_CHANNEL_VERIFIED  a one-time code was received and consumed
 *   LINK_FACTOR_MATCHED       a last-4 or ZIP matched — knowledge, not control
 *   NONE                      nothing was verified
 *
 * There is no path to an identity claim: spec §12, "an OTP proves control of a
 * channel, not legal identity". Identity is a licensed human's finding
 * (trust.IDENTITY_VERIFICATION) and is never written by this layer.
 */
export function verificationClaim(record) {
  if (!record || typeof record !== 'object' || !isIso(record.factorVerifiedAt)) return VERIFICATION_CLAIM.NONE;
  if (record.secondFactorKind === 'OTP') {
    return record.otp && isIso(record.otp.consumedAt) ? VERIFICATION_CLAIM.CONTACT_CHANNEL_VERIFIED : VERIFICATION_CLAIM.NONE;
  }
  return VERIFICATION_CLAIM.LINK_FACTOR_MATCHED;
}

// ── The message ──────────────────────────────────────────────────────────────

/**
 * The code message, both languages. No name, no link, no reference to what is
 * being signed, no marketing: the code, its lifetime, and what to do if it was
 * not requested.
 */
export function buildOtpMessage({ code, language, policy = OTP_POLICY }) {
  const minutes = Math.round(policy.ttlSec / 60);
  if (language === 'es') {
    return {
      subject: 'Su código de verificación — Clear Point Senior Advisors',
      body: 'Su código de verificación de Clear Point es ' + code + '. Vence en ' + minutes + ' minutos. ' +
        'Si usted no lo solicitó, ignore este mensaje.',
    };
  }
  return {
    subject: 'Your verification code — Clear Point Senior Advisors',
    body: 'Your Clear Point verification code is ' + code + '. It expires in ' + minutes + ' minutes. ' +
      'If you did not request it, ignore this message.',
  };
}

/**
 * Deliver a code, if everything above permits it. Never throws for a transport
 * problem; the caller decides what a failed delivery means for the link. The
 * code is never logged by this function and is not in the returned object.
 */
export async function deliverOtp({ channel, to, code, language, consent, env = process.env, fetchImpl = fetch }) {
  const gate = mayDeliverOtp({ channel, consent, env });
  if (!gate.allowed) return { sent: false, reason: gate.reason };
  if (!normalizeDestination(channel, to)) return { sent: false, reason: OTP_REFUSAL.NO_DESTINATION_ON_FILE };
  if (typeof code !== 'string' || !code) return { sent: false, reason: OTP_REFUSAL.OTP_NOT_ISSUED };

  const msg = buildOtpMessage({ code, language });
  try { assertNotMarketing(msg.subject + ' ' + msg.body); }
  catch (e) { return { sent: false, reason: OTP_REFUSAL.MARKETING_CONTENT_BLOCKED, detail: e.message }; }

  const cfg = otpChannelConfig(channel, env);
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, to: normalizeDestination(channel, to), subject: msg.subject, body: msg.body }),
    });
    if (!res || !res.ok) return { sent: false, reason: OTP_REFUSAL.PROVIDER_REJECTED, status: res ? res.status : null };
    return { sent: true, reason: 'OK', channel };
  } catch (e) {
    return { sent: false, reason: OTP_REFUSAL.PROVIDER_UNREACHABLE, detail: e && e.message ? String(e.message).slice(0, 120) : null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOA link status.
//
// AUDIT 2026-10-01 (SEC-TOK-01/02) — REWRITTEN.
//
// What this used to do: accept any 36-char UUID on GET and return
//   { exists, consumed, lead: { fullName, phone, email, zip, language, … } }
// with no second factor at all. Possession of the URL was possession of the
// record, so a forwarded or guessed link handed over a beneficiary's personal
// data. src/lib/soaContent.ts tracked it as the unmet enablement precondition
// `statusEndpointSecondFactor`; it was never exploitable in production only
// because SOA_ENABLED=false answers 503 before any of it runs.
//
// What it does now — spec §9: "Before displaying any prefilled information,
// verify the session/channel sufficiently. Do not reveal private CRM data to
// anyone who merely possesses a guessed URL."
//
//   GET  ?token=…            → { exists, factorRequired, language }   NO personal data
//   POST { token, factor }   → { exists, lead: {…} } only when the factor matches
//
// Every failure answers in the same shape and says nothing about the record,
// so the endpoint cannot be used to confirm that a given person has an SOA
// pending (spec §26: an invalid token must not reveal form data).
// ─────────────────────────────────────────────────────────────────────────────

import { getRecord, setRecord, leadKey, SOA_TOKEN_TTL_SEC } from './_lib/soa-store.js';
import { checkOrigin, applyCors, rateLimit, clientId } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';
import { readJsonBody } from './_lib/read-body.js';
import { storeKeyFor, checkLink, verifySecondFactor, linkDisclosure, recordView, factorLocked } from './_lib/cy2027/secure-link.js';
import {
  OTP_POLICY, VERIFICATION_CLAIM, verificationClaim, otpDestination, otpDestinationKey, otpSendPlan, recordDestinationSend, issueOtp, deliverOtp,
} from './_lib/cy2027/otp.js';
import { emitAudit } from './_lib/cy2027/evidence.js';

// PHASE 7 — SOA gate. Mirror of src/lib/soaContent.ts SOA_ENABLED.
const SOA_ENABLED = false;

/** The token is opaque base64url, not a UUID. Never echo it back. */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

export default async function handler(req, res) {
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) { noStorePII(res); return res.status(403).json({ error: 'Origin not allowed' }); }
  applyCors(req, res, allowedOrigin);
  noStorePII(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SOA_ENABLED) return res.status(503).json({ error: 'SOA_DISABLED' });

  var ip = clientId(req);

  // ── GET: which factor do I need? Nothing else. ──────────────────────────
  if (req.method === 'GET') {
    var rl = await rateLimit(ip, { max: 60, windowMs: 60 * 1000, prefix: 'soa-stat' });
    if (!rl.ok) return res.status(429).json({ error: 'Too many requests' });

    var token = '';
    try { token = new URL(req.url, 'http://localhost').searchParams.get('token') || ''; } catch (e) { /* malformed */ }
    if (!TOKEN_RE.test(token)) return res.status(400).json({ error: 'token required' });

    var rec = await getRecord(storeKeyFor(token));
    var state = checkLink(rec);
    if (!state.ok) return res.status(404).json({ exists: false, reason: state.reason });

    // Count the view for abuse detection; a link opened hundreds of times is a
    // signal, and the counter has to survive the request to mean anything.
    await setRecord(storeKeyFor(token), recordView(rec), SOA_TOKEN_TTL_SEC);

    emitAudit({
      action: 'SOA_VIEWED', actor: 'beneficiary:unverified', result: 'CHALLENGE_SHOWN', source: 'WEB',
      correlationId: rec.beneficiaryRef, soaId: rec.soaId, details: { views: (rec.views || 0) + 1 },
    });
    return res.status(200).json(linkDisclosure(rec, { factorVerified: false }));
  }

  // ── POST: verify the factor, then release the prefill. ──────────────────
  // Tighter limit than the GET: this is the brute-force surface.
  var rlp = await rateLimit(ip, { max: 10, windowMs: 10 * 60 * 1000, prefix: 'soa-factor' });
  if (!rlp.ok) {
    res.setHeader('Retry-After', String(rlp.retryAfter));
    return res.status(429).json({ error: 'Too many attempts' });
  }

  var body = await readJsonBody(req, res, { maxBytes: 4 * 1024 });
  if (body === null) return;

  var ptoken = typeof body.token === 'string' ? body.token : '';
  var factor = typeof body.factor === 'string' ? body.factor : '';
  // AUDIT 2026-10-04 (SPEC-12) — `{ token, resendCode: true }` asks for a new
  // one-time code on an OTP link. Same endpoint, so the origin check, the
  // rate limit, the no-store header and the body cap above all apply to it.
  var resendCode = body.resendCode === true;
  if (!TOKEN_RE.test(ptoken)) return res.status(400).json({ error: 'token required' });
  if (!resendCode && !factor) return res.status(400).json({ error: 'factor required' });

  var prec = await getRecord(storeKeyFor(ptoken));
  var pstate = checkLink(prec);
  if (!pstate.ok) return res.status(404).json({ exists: false, reason: pstate.reason });

  if (resendCode) return resendOtp(res, ptoken, prec);

  var verdict = verifySecondFactor(prec, factor);
  // Persist the attempt counter either way — a counter that resets on every
  // request is not a counter.
  await setRecord(storeKeyFor(ptoken), verdict.record, SOA_TOKEN_TTL_SEC);

  if (!verdict.ok) {
    emitAudit({
      action: 'SOA_VIEWED', actor: 'beneficiary:unverified', result: verdict.reason, source: 'WEB',
      correlationId: prec.beneficiaryRef, soaId: prec.soaId,
      details: { attemptsRemaining: verdict.attemptsRemaining, signal: verdict.signal || null },
    });
    return res.status(401).json({
      exists: true,
      verified: false,
      reason: verdict.reason,
      attemptsRemaining: verdict.attemptsRemaining == null ? 0 : verdict.attemptsRemaining,
    });
  }

  // Only now is the lead record reachable, and only through the opaque
  // reference held inside the link — never through anything in the URL.
  var full = linkDisclosure(verdict.record, { factorVerified: true });
  var lead = await getRecord(leadKey(full.beneficiaryRef));
  if (!lead) return res.status(404).json({ exists: false, reason: 'LEAD_RECORD_MISSING' });

  // AUDIT 2026-10-04 (SPEC-12) — the actor used to say "channel-verified" for
  // every factor kind, including a last-4 match that verifies no channel. The
  // audit now states what the link's verification proves (otp.verificationClaim):
  // CONTACT_CHANNEL_VERIFIED only for a received code, and never an identity.
  var claim = verificationClaim(verdict.record);
  emitAudit({
    action: 'SOA_VIEWED', actor: claim === VERIFICATION_CLAIM.CONTACT_CHANNEL_VERIFIED ? 'beneficiary:channel-verified' : 'beneficiary:factor-matched', result: 'PREFILL_RELEASED', source: 'WEB',
    correlationId: full.beneficiaryRef, soaId: full.soaId, details: { factor: prec.secondFactorKind, claim: claim },
  });

  return res.status(200).json({
    exists: true,
    verified: true,
    verification: claim,
    soaId: full.soaId,
    appointmentId: full.appointmentId,
    lead: {
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email || '',
      zip: lead.zip || '',
      language: lead.language,
      leadSource: lead.leadSource,
    },
  });
}

/**
 * AUDIT 2026-10-04 (SPEC-12) — a new code for an OTP link.
 *
 * The destination is the phone or email on the LEAD RECORD the server wrote at
 * issue, reached through the opaque reference inside the link; a `to`, `phone`
 * or `email` in the request body is never read. A locked link gets no code (a
 * resend never resets the attempt counter either — that lives on the link). The
 * per-link and per-destination caps (§30, SMS bombing) are counted and stored
 * BEFORE delivery, so a send the provider drops still counts. The code and the
 * destination reach no log line and no response.
 */
async function resendOtp(res, ptoken, prec) {
  if (prec.secondFactorKind !== 'OTP') return res.status(400).json({ exists: true, resent: false, reason: 'FACTOR_NOT_OTP' });
  var otpChannel = prec.otp && typeof prec.otp.channel === 'string' ? prec.otp.channel : null;
  if (factorLocked(prec)) {
    emitAudit({ action: 'OTP_SEND_REFUSED', actor: 'beneficiary:unverified', result: 'SECOND_FACTOR_LOCKED', source: 'WEB', correlationId: prec.beneficiaryRef, soaId: prec.soaId, details: { channel: otpChannel } });
    return res.status(401).json({ exists: true, resent: false, reason: 'SECOND_FACTOR_LOCKED' });
  }
  var lead = await getRecord(leadKey(prec.beneficiaryRef));
  var dest = otpDestination(lead, otpChannel);
  if (!dest.ok) return res.status(404).json({ exists: true, resent: false, reason: dest.reason });
  var destKey = otpDestinationKey(otpChannel, dest.to);
  var destRecord = await getRecord(destKey);
  var plan = otpSendPlan({ linkRecord: prec, destRecord: destRecord });
  if (!plan.allowed) {
    emitAudit({ action: 'OTP_SEND_REFUSED', actor: 'beneficiary:unverified', result: plan.reason, source: 'WEB', correlationId: prec.beneficiaryRef, soaId: prec.soaId, details: { channel: otpChannel } });
    res.setHeader('Retry-After', String(plan.reason === 'OTP_RESEND_TOO_SOON' ? OTP_POLICY.minResendIntervalSec : OTP_POLICY.windowSec));
    return res.status(429).json({ exists: true, resent: false, reason: plan.reason });
  }
  var issued = issueOtp(prec);
  var w1 = await setRecord(storeKeyFor(ptoken), issued.record, SOA_TOKEN_TTL_SEC);
  var w2 = await setRecord(destKey, recordDestinationSend(destRecord), OTP_POLICY.windowSec);
  if (!w1.ok || !w2.ok) return res.status(503).json({ exists: true, resent: false, reason: 'STORAGE_FAILED' });
  var delivery = await deliverOtp({ channel: otpChannel, to: dest.to, code: issued.code, language: prec.language, consent: prec.otp.consentBasis, env: process.env });
  emitAudit({
    action: 'OTP_ISSUED', actor: 'beneficiary:unverified', result: delivery.sent ? 'SENT' : delivery.reason, source: 'WEB',
    correlationId: prec.beneficiaryRef, soaId: prec.soaId, details: { channel: otpChannel, sendsOnLink: issued.record.otp.sends.length },
  });
  return res.status(200).json({ exists: true, resent: delivery.sent === true, reason: delivery.reason });
}

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
import { SOA_TOKEN_TTL_SEC, getRecord, setRecord, leadKey } from './_lib/soa-store.js';
import { issueLink } from './_lib/cy2027/secure-link.js';
import {
  OTP_POLICY, otpFactorForIssue, otpDestination, otpDestinationKey, otpSendPlan, recordDestinationSend, issueOtp, deliverOtp,
} from './_lib/cy2027/otp.js';
import { appointmentIdForReissue } from './_lib/cy2027/soa-ledger.js';
import { emitAudit } from './_lib/cy2027/evidence.js';
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

  // AUDIT 2026-10-04 (EV-09) — every link minted a fresh appointment, so no
  // second SOA could ever be for the SAME appointment and the supersession
  // path (spec §9: "Editing categories creates a new version/instance with
  // supersession history") was unreachable. A link may now be issued for an
  // existing appointment, in the server's own id form only. Whether its holder
  // may replace that appointment's scope is decided at signature, where the
  // person is proven against the ledger (api/sign-soa.js) — never here.
  var reissuedFor = appointmentIdForReissue(body.appointmentId);
  var appointmentId = reissuedFor || ('appt_' + crypto.randomUUID());

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

  // AUDIT 2026-10-04 (SPEC-12) — the factor is no longer the constant
  // PHONE_LAST4, which a holder of a forwarded link can often guess and which
  // proves nothing about who controls the phone. A one-time code
  // (api/_lib/cy2027/otp.js) is offered when, and only when, the delivery gate
  // allows a message out: the owner's flag, a configured https channel and a
  // recorded contact permission. This handler holds NO server-side consent
  // record for the person — the request body is a client claim and is never
  // read for one — so the basis below is null, the gate answers
  // NO_CONTACT_PERMISSION and today's factor stays, with the reason audited.
  // Wiring the CRM's callback-consent state into this handler is the step that
  // makes the code reachable (docs/compliance/CY2027-ARCHITECTURE.md §2.3a).
  var OTP_CONSENT_BASIS = null;
  var factor = otpFactorForIssue({ channel: 'SMS', consent: OTP_CONSENT_BASIS, env: process.env });

  var link;
  try {
    link = issueLink({
      soaId: 'soa_' + crypto.randomUUID(),
      appointmentId: appointmentId,
      beneficiaryRef: beneficiaryRef,
      channel: 'WEB',
      secondFactorKind: factor.kind,
      // For a code there is no value to hash: the server generates it below.
      secondFactorValue: factor.kind === 'OTP' ? undefined : phone,
      otpChannel: factor.otpChannel,
      otpConsentBasis: factor.kind === 'OTP' ? OTP_CONSENT_BASIS : null,
      language: language,
      ttlSec: SOA_TOKEN_TTL_SEC,
    });
  } catch (e) {
    console.error('[soa-token] link issue failed:', e && e.message);
    return res.status(400).json({ error: 'Could not issue a secure link' });
  }

  // The code: issued against the destination ON THE LEAD RECORD (never the
  // body), counted against the per-link and per-destination caps BEFORE it is
  // delivered (a send the provider drops still counts — §30, SMS bombing), and
  // refused by name when a cap is reached. Nothing is minted in that case.
  var otpCode = null;
  var destKey = null;
  var destRecord = null;
  var destTo = null;
  if (factor.kind === 'OTP') {
    var dest = otpDestination(leadRecord, factor.otpChannel);
    if (!dest.ok) {
      emitAudit({ action: 'OTP_SEND_REFUSED', actor: 'system:soa-token', result: dest.reason, source: 'WEB', correlationId: beneficiaryRef, soaId: link.record.soaId, details: { channel: factor.otpChannel } });
      return res.status(400).json({ error: 'OTP_DESTINATION_UNAVAILABLE' });
    }
    destTo = dest.to;
    destKey = otpDestinationKey(factor.otpChannel, dest.to);
    destRecord = await getRecord(destKey);
    var plan = otpSendPlan({ linkRecord: link.record, destRecord: destRecord });
    if (!plan.allowed) {
      emitAudit({ action: 'OTP_SEND_REFUSED', actor: 'system:soa-token', result: plan.reason, source: 'WEB', correlationId: beneficiaryRef, soaId: link.record.soaId, details: { channel: factor.otpChannel } });
      res.setHeader('Retry-After', String(OTP_POLICY.windowSec));
      return res.status(429).json({ error: plan.reason });
    }
    var issued = issueOtp(link.record);
    link = { token: link.token, storeKey: link.storeKey, record: issued.record };
    otpCode = issued.code;
  }

  // Both writes must be durable. A link whose lead record lives only in one
  // lambda's memory breaks on the next request, and a beneficiary who clicks a
  // dead link is a beneficiary who signs nothing.
  var w1 = await setRecord(leadKey(beneficiaryRef), leadRecord, SOA_TOKEN_TTL_SEC);
  var w2 = await setRecord(link.storeKey, link.record, SOA_TOKEN_TTL_SEC);
  var w3 = destKey ? await setRecord(destKey, recordDestinationSend(destRecord), OTP_POLICY.windowSec) : { ok: true };
  if (!w1.ok || !w2.ok || !w3.ok) {
    console.error('[soa-token] storage failed:', w1.reason || w2.reason || w3.reason);
    return res.status(503).json({ error: 'Token storage failed' });
  }

  // Delivery comes AFTER the counts are stored. A code that did not arrive
  // leaves a link that reveals nothing; the page offers a resend, which the
  // same caps bound. The code and the destination reach no log line.
  var delivery = null;
  if (otpCode !== null) {
    delivery = await deliverOtp({ channel: factor.otpChannel, to: destTo, code: otpCode, language: language, consent: OTP_CONSENT_BASIS, env: process.env });
    emitAudit({
      action: 'OTP_ISSUED', actor: 'system:soa-token', result: delivery.sent ? 'SENT' : delivery.reason, source: 'WEB',
      correlationId: beneficiaryRef, soaId: link.record.soaId, details: { channel: factor.otpChannel, sendsOnLink: link.record.otp.sends.length },
    });
  }

  emitAudit({
    action: 'SOA_LINK_ISSUED', actor: 'system:soa-token', result: 'OK', source: 'WEB',
    correlationId: beneficiaryRef, soaId: link.record.soaId,
    // AUDIT 2026-10-04 (EV-09, red team) — this said 'EXISTING' for any id in
    // the server's form, including one never issued: the issuer reads no
    // ledger, so the audit states what it checked (the caller asked for a
    // re-issue in the server's id form), not an existence it did not verify.
    details: { channel: 'WEB', factor: link.record.secondFactorKind, factorReason: factor.reason, language: language, appointment: reissuedFor ? 'REISSUE_REQUESTED' : 'NEW' },
  });

  return res.status(200).json({
    token: link.token,
    expiresIn: SOA_TOKEN_TTL_SEC,
    soaUrl: '/soa/' + link.token,
    // The UI must know which question to ask before it can show anything.
    factorRequired: link.record.secondFactorKind,
    // For a code: whether one went out. Never the code, never the destination.
    ...(delivery ? { codeSent: delivery.sent === true } : {}),
  });
}

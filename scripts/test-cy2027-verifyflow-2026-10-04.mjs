// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — OTP, LETTER AND CALL VERIFICATION (spec §12, §30, Phase 6; SPEC-12).
//
//   §12  "one-time code to the phone/email supplied or previously trusted
//        channel" / "Separate CONTACT_CHANNEL_VERIFIED from IDENTITY_VERIFIED.
//        An OTP proves control of a channel, not legal identity." / "repeated
//        failed OTP" is a review signal.
//   §12  the verification call (contact basis, purpose security/request
//        verification, never marketing), the neutral letter (existing known
//        client, previously verified address on file, never the suspicious
//        request's address, no plan marketing, official channel, minimal data),
//        and the callback through the official number (re-open, verify context,
//        proceed from the appropriate gate).
//   §30  "protect OTP endpoint against brute force and SMS bombing."
//
// Before this change secure-link.js listed 'OTP' as a factor kind and locked a
// link after repeated failures, but nothing issued a code — api/soa-token.js
// minted every link with PHONE_LAST4 — and no letter or call rule existed.
//
// Every rule here is exercised by CALLING it, with the clock passed in. The
// two SOA handlers are DRIVEN in process against the memory store and a
// provider double (globalThis.fetch replaced — nothing leaves this machine):
// every claim about them is a response, a stored record or an audit line
// observed. Only what must be ABSENT from the source is scanned, anchored.
//
// Run: node scripts/test-cy2027-verifyflow-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';

import {
  OTP_CHANNELS, OTP_POLICY, OTP_REFUSAL, VERIFICATION_CLAIM, normalizeDestination, otpSendingEnabled, mayDeliverOtp, otpFactorForIssue,
  otpDestination, otpDestinationKey, linkSendProblem, destinationSendProblem, recordDestinationSend, otpSendPlan,
  issueOtp, verifyOtp, verificationClaim, buildOtpMessage, deliverOtp,
} from '../api/_lib/cy2027/otp.js';
import {
  issueLink, storeKeyFor, checkLink, verifySecondFactor, linkDisclosure, MAX_FACTOR_ATTEMPTS, factorLocked, SECOND_FACTOR_KINDS,
} from '../api/_lib/cy2027/secure-link.js';
import {
  OFFICIAL_CONTACT, VERIFICATION_CALL_PURPOSE, CASE_STATUS, OOB_REFUSAL, VERIFICATION_LETTER,
  letterContentProblem, letterApprovalProblem, mayIssueVerificationLetter, mayPlaceVerificationCall, reopenCaseOnCallback,
} from '../api/_lib/cy2027/out-of-band-verification.js';
import { createConsent, CONSENT_STATUS, revokeConsent } from '../api/_lib/cy2027/consent.js';
import { evaluateTrust, CHANNEL_VERIFICATION, IDENTITY_VERIFICATION, LEAD_TRUST_STATE } from '../api/_lib/cy2027/trust.js';
import { AUDIT_ACTIONS } from '../api/_lib/cy2027/evidence.js';
import { REVIEWERS_ENV } from '../api/_lib/cy2027/actors.js';
import { assertNotMarketing } from '../api/_lib/cy2027/beneficiary-copy.js';
import { getRecord, setRecord, leadKey, SOA_TOKEN_TTL_SEC } from '../api/_lib/soa-store.js';
import { stripComments, unfrozenPaths, GOVERNING_IDENTIFIERS } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src) => stripComments(src);
/** A structural scan anchored to a line start: a leading `if (false)` or a comment cannot satisfy it. */
const line = (re) => new RegExp('^[ \\t]*' + re.source, 'm' + re.flags.replace('m', ''));
const at = (iso) => new Date(iso);
const plus = (date, sec) => new Date(date.getTime() + sec * 1000);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (v) => createHash('sha256').update(String(v), 'utf8').digest('hex');
const hmac = (saltHex, v) => createHmac('sha256', Buffer.from(saltHex, 'hex')).update(String(v), 'utf8').digest('hex');

const NOW = at('2026-11-01T12:00:00Z');
const PHONE = '6315550147';
const grant = (type, over = {}) => createConsent({ type, status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'this request', ...over });
const CALLBACK = grant('CALLBACK_CONTACT_PERMISSION');
const FULL_ENV = { CY2027_SEND_OTP: '1', CY2027_OTP_SMS_URL: 'https://otp.invalid/send', CY2027_OTP_SMS_TOKEN: 't-sms', CY2027_OTP_EMAIL_URL: 'https://otp.invalid/mail', CY2027_OTP_EMAIL_TOKEN: 't-mail' };
const otpReasons = new Set();
const oobReasons = new Set();
const seenOtp = (r) => { otpReasons.add(r); return r; };
const seenOob = (r) => { oobReasons.add(r); return r; };

const mkOtpLink = (over = {}) => issueLink({
  soaId: 'soa_1', appointmentId: 'appt_1', beneficiaryRef: 'contact_abc', channel: 'WEB',
  secondFactorKind: 'OTP', otpChannel: 'SMS', otpConsentBasis: CALLBACK, language: 'en', now: NOW, ...over,
});
const mkLast4Link = () => issueLink({
  soaId: 'soa_2', appointmentId: 'appt_2', beneficiaryRef: 'contact_def', channel: 'WEB',
  secondFactorKind: 'PHONE_LAST4', secondFactorValue: PHONE, language: 'en', now: NOW,
});

// ── 1. The policy and the gate ───────────────────────────────────────────────
{
  ok('OTP_POLICY is frozen all the way down', unfrozenPaths(OTP_POLICY, 'OTP_POLICY').length === 0);
  ok('OTP_POLICY is a governing identifier of the build gate', GOVERNING_IDENTIFIERS.includes('OTP_POLICY'));
  ok('the policy: six digits, ten minutes, a floor between sends, caps per link and per destination inside one window',
    OTP_POLICY.codeLength === 6 && OTP_POLICY.ttlSec === 600 && OTP_POLICY.minResendIntervalSec === 60 &&
    OTP_POLICY.maxSendsPerLink === 3 && OTP_POLICY.maxSendsPerDestination === 5 && OTP_POLICY.windowSec === 3600);
  ok('the attempt limit is declared once, in secure-link, and is not duplicated in the policy', MAX_FACTOR_ATTEMPTS === 5 && !('maxAttempts' in OTP_POLICY));
  ok('the channels are SMS and EMAIL', same(OTP_CHANNELS, ['SMS', 'EMAIL']) && Object.isFrozen(OTP_CHANNELS));
  ok("'OTP' is still one of the link's factor kinds", SECOND_FACTOR_KINDS.includes('OTP'));

  ok('sending is disabled by default', otpSendingEnabled({}) === false && otpSendingEnabled({ CY2027_SEND_OTP: '' }) === false && otpSendingEnabled({ CY2027_SEND_OTP: 'no' }) === false);
  ok('the flag reads 1/true/on/yes', ['1', 'true', 'on', 'yes', ' TRUE '].every((v) => otpSendingEnabled({ CY2027_SEND_OTP: v })));

  ok('gate: an unknown channel', seenOtp(mayDeliverOtp({ channel: 'FAX', consent: CALLBACK, env: FULL_ENV }).reason) === 'UNKNOWN_CHANNEL');
  ok('gate: refused while sending is disabled', seenOtp(mayDeliverOtp({ channel: 'SMS', consent: CALLBACK, env: {} }).reason) === 'SENDING_DISABLED');
  ok('gate: refused without a configured channel', seenOtp(mayDeliverOtp({ channel: 'SMS', consent: CALLBACK, env: { CY2027_SEND_OTP: '1' } }).reason) === 'CHANNEL_NOT_CONFIGURED');
  ok('gate: an http (non-TLS) channel is not configured', mayDeliverOtp({ channel: 'SMS', consent: CALLBACK, env: { ...FULL_ENV, CY2027_OTP_SMS_URL: 'http://otp.invalid/send' } }).reason === 'CHANNEL_NOT_CONFIGURED');
  ok('gate: a URL without a token is not configured', mayDeliverOtp({ channel: 'EMAIL', consent: CALLBACK, env: { ...FULL_ENV, CY2027_OTP_EMAIL_TOKEN: '' } }).reason === 'CHANNEL_NOT_CONFIGURED');
  ok('gate: refused without contact permission', seenOtp(mayDeliverOtp({ channel: 'SMS', consent: null, env: FULL_ENV }).reason) === 'NO_CONTACT_PERMISSION');
  ok('gate: §6 — an SOA consent is not permission to message', mayDeliverOtp({ channel: 'SMS', consent: grant('SCOPE_OF_APPOINTMENT'), env: FULL_ENV }).reason === 'NO_CONTACT_PERMISSION');
  ok('gate: a revoked permission is not permission', mayDeliverOtp({ channel: 'SMS', consent: revokeConsent(CALLBACK, { via: 'WEB' }), env: FULL_ENV }).reason === 'NO_CONTACT_PERMISSION');
  ok('gate: with the flag, a TLS channel and a recorded permission it is allowed', mayDeliverOtp({ channel: 'SMS', consent: CALLBACK, env: FULL_ENV }).allowed === true &&
    mayDeliverOtp({ channel: 'EMAIL', consent: CALLBACK, env: FULL_ENV }).allowed === true);

  ok("issue: today's factor stays, with the reason, while nothing is configured", same(otpFactorForIssue({ channel: 'SMS', consent: CALLBACK, env: {} }), { kind: 'PHONE_LAST4', otpChannel: null, reason: 'SENDING_DISABLED' }));
  ok("issue: today's factor stays, with the reason, without a contact permission", same(otpFactorForIssue({ channel: 'SMS', consent: null, env: FULL_ENV }), { kind: 'PHONE_LAST4', otpChannel: null, reason: 'NO_CONTACT_PERMISSION' }));
  ok('issue: the code is offered only when the gate allows a message out', same(otpFactorForIssue({ channel: 'SMS', consent: CALLBACK, env: FULL_ENV }), { kind: 'OTP', otpChannel: 'SMS', reason: 'OK' }));
  ok('issue: the channel defaults to SMS', otpFactorForIssue({ consent: CALLBACK, env: FULL_ENV }).otpChannel === 'SMS');
}

// ── 2. The destination: the lead record and nothing else ─────────────────────
{
  ok('a phone normalizes to ten digits', normalizeDestination('SMS', '+1 (631) 555-0147') === PHONE && normalizeDestination('SMS', '631.555.0147') === PHONE && normalizeDestination('SMS', '16315550147') === PHONE);
  ok('a phone that is not ten digits is not a destination', normalizeDestination('SMS', '555-0147') === null && normalizeDestination('SMS', '') === null && normalizeDestination('SMS', null) === null);
  ok('an email folds to lower case', normalizeDestination('EMAIL', ' Jane@Example.COM ') === 'jane@example.com');
  ok('a string without an @ is not an email', normalizeDestination('EMAIL', 'jane.example.com') === null);
  ok('an unknown channel has no destination', normalizeDestination('FAX', PHONE) === null);

  const lead = { beneficiaryRef: 'contact_abc', fullName: 'Jane Q Public', phone: '+1' + PHONE, email: 'Jane@Example.com', zip: '11717', language: 'en' };
  ok('the SMS destination is the phone on the lead record', same(otpDestination(lead, 'SMS'), { ok: true, to: PHONE }));
  ok('the EMAIL destination is the email on the lead record, folded', same(otpDestination(lead, 'EMAIL'), { ok: true, to: 'jane@example.com' }));
  ok('a lead record without a usable phone has no destination', seenOtp(otpDestination({ ...lead, phone: '' }, 'SMS').reason) === 'NO_DESTINATION_ON_FILE' && otpDestination({ ...lead, email: null }, 'EMAIL').reason === 'NO_DESTINATION_ON_FILE');
  ok('no lead record, no destination', otpDestination(null, 'SMS').reason === 'NO_DESTINATION_ON_FILE' && otpDestination('not a record', 'SMS').reason === 'NO_DESTINATION_ON_FILE');
  ok('an unknown channel is refused by name', otpDestination(lead, 'FAX').reason === 'UNKNOWN_CHANNEL');
  ok('the destination function reads one record and one channel — there is no third argument for a request to fill', otpDestination.length === 2);

  const key = otpDestinationKey('SMS', '+1 631 555 0147');
  ok('the destination key is a hash under its own prefix', /^otp-dest:[0-9a-f]{64}$/.test(key));
  ok('the same phone in any format yields the same key', key === otpDestinationKey('SMS', PHONE) && key === otpDestinationKey('SMS', '(631) 555-0147'));
  ok('the key does not carry the destination', !key.includes(PHONE) && !key.includes('631'));
  ok('the same string on another channel is another key', otpDestinationKey('EMAIL', 'a@b.co') !== otpDestinationKey('SMS', PHONE));
  throws('an unusable destination has no key', () => otpDestinationKey('SMS', '12'), /usable destination/);
}

// ── 3. Issue and verify ──────────────────────────────────────────────────────
{
  throws('issueLink: a one-time code may not be supplied by the caller', () => mkOtpLink({ secondFactorValue: '123456' }), /generated by the server, never supplied/);
  throws('issueLink: an OTP link needs an OTP channel', () => mkOtpLink({ otpChannel: null }), /unknown OTP channel/);
  throws('issueLink: an OTP link needs a KNOWN OTP channel', () => mkOtpLink({ otpChannel: 'FAX' }), /unknown OTP channel/);
  throws('issueLink: a last-4 link still refuses an empty value', () => issueLink({ soaId: 's', appointmentId: 'a', beneficiaryRef: 'b', channel: 'WEB', secondFactorKind: 'PHONE_LAST4', secondFactorValue: ' ' }), /cannot be empty/);

  const fresh = mkOtpLink();
  ok('an OTP link holds no factor hash and no code until one is issued',
    fresh.record.secondFactorKind === 'OTP' && fresh.record.secondFactorHash === null && fresh.record.otp.hash === null && fresh.record.otp.salt === null && same(fresh.record.otp.sends, []));
  ok('the OTP channel and the consent basis the issuer verified are on the record', fresh.record.otp.channel === 'SMS' && fresh.record.otp.consentBasis === CALLBACK);
  ok('a last-4 link carries no otp block', !('otp' in mkLast4Link().record));
  ok('a fresh OTP link checks out as a link', checkLink(fresh.record, { now: NOW }).ok === true);

  const unissued = verifySecondFactor(fresh.record, '000000', { now: NOW });
  ok('a code presented before any was issued is refused by name, and counted', unissued.ok === false && seenOtp(unissued.reason) === 'OTP_NOT_ISSUED' && unissued.record.failedFactorAttempts === 1);
  ok('verifyOtp on a last-4 link says no code was issued', seenOtp(verifyOtp(mkLast4Link().record, '0147').reason) === 'OTP_NOT_ISSUED');

  throws('issueOtp: refuses a link that does not use a code', () => issueOtp(mkLast4Link().record), /does not use a one-time code/);
  throws('issueOtp: refuses a record that is not a link', () => issueOtp(null), /link record is required/);
  throws('issueOtp: refuses an OTP link whose channel was lost', () => issueOtp({ ...fresh.record, otp: { ...fresh.record.otp, channel: 'FAX' } }), /no OTP channel/);

  const { code, record } = issueOtp(fresh.record, { now: NOW });
  ok('the code is six digits', /^\d{6}$/.test(code));
  ok('the record keeps a 128-bit salt and an HMAC — exactly these keys, so the code itself has nowhere to live',
    /^[0-9a-f]{32}$/.test(record.otp.salt) && /^[0-9a-f]{64}$/.test(record.otp.hash) &&
    same(Object.keys(record.otp), ['channel', 'salt', 'hash', 'issuedAt', 'expiresAt', 'consumedAt', 'sends', 'consentBasis']));
  ok('the hash is HMAC-SHA256(salt, code), not a bare digest of the code', record.otp.hash === hmac(record.otp.salt, code) && record.otp.hash !== sha256(code));
  ok('the same code under another salt does not verify — the salt is in the hash', verifyOtp({ ...record, otp: { ...record.otp, salt: 'ff'.repeat(16) } }, code, { now: NOW }).ok === false);
  ok('the code lives ten minutes from issue', record.otp.issuedAt === NOW.toISOString() && record.otp.expiresAt === plus(NOW, 600).toISOString());
  ok('the issue is counted as one send on the link', same(record.otp.sends, [NOW.toISOString()]));
  ok('issuing does not touch the link outside the otp block', record.secondFactorHash === null && record.failedFactorAttempts === undefined && record.consumedAt === null);
  ok('the input record is not mutated', fresh.record.otp.hash === null);
  const codes = new Set(Array.from({ length: 6 }, () => issueOtp(fresh.record, { now: NOW }).code));
  const salts = new Set(Array.from({ length: 6 }, () => issueOtp(fresh.record, { now: NOW }).record.otp.salt));
  ok('codes and salts come from the CSPRNG — six issues are not all alike', codes.size > 1 && salts.size === 6);

  ok('the right code verifies', verifyOtp(record, code, { now: NOW }).ok === true);
  ok('formatting of the code does not matter', verifyOtp(record, code.slice(0, 3) + ' ' + code.slice(3), { now: NOW }).ok === true);
  ok('a wrong code is a mismatch', seenOtp(verifyOtp(record, String((Number(code) + 1) % 1000000).padStart(6, '0'), { now: NOW }).reason) === 'OTP_MISMATCH');
  ok('a code of the wrong length is a mismatch, not an error', verifyOtp(record, code.slice(0, 5), { now: NOW }).reason === 'OTP_MISMATCH' && verifyOtp(record, '', { now: NOW }).reason === 'OTP_MISMATCH');
  ok('an expired code is refused by name', seenOtp(verifyOtp(record, code, { now: plus(NOW, 601) }).reason) === 'OTP_EXPIRED');
  ok('a code whose expiry is unreadable is expired', verifyOtp({ ...record, otp: { ...record.otp, expiresAt: 'soon' } }, code, { now: NOW }).reason === 'OTP_EXPIRED');
  const used = verifyOtp(record, code, { now: NOW }).record;
  ok('a verified code is consumed', used.otp.consumedAt === NOW.toISOString());
  ok('a consumed code does not verify again — single use', seenOtp(verifyOtp(used, code, { now: NOW }).reason) === 'OTP_ALREADY_USED');
  ok('a present-but-empty consumedAt still counts as used (a cleared field is not a fresh code)', verifyOtp({ ...record, otp: { ...record.otp, consumedAt: '' } }, code, { now: NOW }).reason === 'OTP_ALREADY_USED');
  const reissued = issueOtp(record, { now: plus(NOW, 120) });
  ok('a re-issued code replaces the previous one: the old code stops verifying', verifyOtp(reissued.record, code, { now: plus(NOW, 120) }).reason === 'OTP_MISMATCH' && verifyOtp(reissued.record, reissued.code, { now: plus(NOW, 120) }).ok === true);
  ok('a re-issue counts another send and keeps the earlier one', same(reissued.record.otp.sends, [NOW.toISOString(), plus(NOW, 120).toISOString()]));

  // Through the one verifier: the attempt counter and the lockout are shared with every kind.
  const wrong = verifySecondFactor(record, '000000', { now: NOW });
  ok('through verifySecondFactor a wrong code is refused with the OTP reason and counts an attempt',
    wrong.ok === false && wrong.reason === 'OTP_MISMATCH' && wrong.record.failedFactorAttempts === 1 && wrong.attemptsRemaining === 4 && wrong.signal === null);
  ok('a wrong code does not say what was wrong', !('secondFactorKind' in wrong) && !('beneficiaryRef' in wrong) && !('otp' in wrong));
  let locked = record;
  for (let i = 0; i < MAX_FACTOR_ATTEMPTS; i++) locked = verifySecondFactor(locked, '000000', { now: NOW }).record;
  const lockedOut = verifySecondFactor(locked, code, { now: NOW });
  ok('five wrong codes lock the link even for the right code', lockedOut.reason === 'SECOND_FACTOR_LOCKED' && lockedOut.signal === 'REPEATED_FAILED_OTP');
  ok('the fifth failure raises the review signal the trust engine understands', verifySecondFactor({ ...record, failedFactorAttempts: 4 }, '000000', { now: NOW }).signal === 'REPEATED_FAILED_OTP');
  ok('factorLocked() reads the same counter and the same limit', factorLocked(locked) === true && factorLocked(record) === false && factorLocked({ ...record, failedFactorAttempts: 4 }) === false);
  const afterResend = issueOtp(locked, { now: plus(NOW, 120) });
  ok('a resend does NOT reset the attempt counter: the new code is refused on a locked link',
    afterResend.record.failedFactorAttempts === MAX_FACTOR_ATTEMPTS && verifySecondFactor(afterResend.record, afterResend.code, { now: plus(NOW, 120) }).reason === 'SECOND_FACTOR_LOCKED');
  ok('an expired link refuses a code before any counting', verifySecondFactor(record, code, { now: plus(NOW, 73 * 3600) }).reason === 'LINK_EXPIRED');

  const verified = verifySecondFactor(record, code, { now: NOW });
  ok('the right code verifies through the one verifier and consumes the code', verified.ok === true && verified.record.otp.consumedAt === NOW.toISOString() && verified.record.factorVerifiedAt === NOW.toISOString() && verified.record.failedFactorAttempts === 0);
  ok('a correct code sets CONTACT CHANNEL verified …', verified.record.channelVerification === CHANNEL_VERIFICATION.VERIFIED);
  ok('… and states identity NOT verified, explicitly', verified.record.identityVerification === IDENTITY_VERIFICATION.NOT_VERIFIED);
  ok('the claim for a received code is CONTACT_CHANNEL_VERIFIED', verificationClaim(verified.record) === 'CONTACT_CHANNEL_VERIFIED');
  ok('the same code presented again after verification is refused as already used', verifySecondFactor(verified.record, code, { now: NOW }).reason === 'OTP_ALREADY_USED');
  ok('after verification the disclosure releases the references', linkDisclosure(verified.record, { factorVerified: true }).beneficiaryRef === 'contact_abc');

  const last4 = verifySecondFactor(mkLast4Link().record, '0147', { now: NOW });
  ok('a last-4 match verifies, stamps NO channel verification and identity NOT verified',
    last4.ok === true && last4.record.channelVerification === CHANNEL_VERIFICATION.NOT_ATTEMPTED && last4.record.identityVerification === IDENTITY_VERIFICATION.NOT_VERIFIED);
  ok('the claim for a last-4 match is LINK_FACTOR_MATCHED — knowledge, not control', verificationClaim(last4.record) === 'LINK_FACTOR_MATCHED');
  ok('a wrong last-4 still answers with the generic mismatch', verifySecondFactor(mkLast4Link().record, '9999', { now: NOW }).reason === 'SECOND_FACTOR_MISMATCH');
  ok('the claim for an unverified link, a bad record or a code-less OTP link is NONE',
    verificationClaim(record) === 'NONE' && verificationClaim(null) === 'NONE' && verificationClaim({ ...verified.record, otp: { ...verified.record.otp, consumedAt: null } }) === 'NONE');
  ok('there is no identity claim anywhere in the vocabulary', !Object.keys(VERIFICATION_CLAIM).some((k) => /IDENTITY/.test(k)) && !Object.values(VERIFICATION_CLAIM).some((v) => /IDENTITY/.test(v)) && unfrozenPaths(VERIFICATION_CLAIM, 'V').length === 0);
  ok('no record shape makes the claim say identity',
    [verified.record, last4.record, record, { ...verified.record, identityVerification: 'VERIFIED_BY_LICENSED_HUMAN' }, { ...verified.record, secondFactorKind: 'ZIP' }]
      .every((r) => !/IDENTITY/.test(verificationClaim(r))));
  const trust = evaluateTrust({ channelVerification: verified.record.channelVerification, identityVerification: verified.record.identityVerification });
  ok('the trust engine reads a verified channel as PARTIALLY_VERIFIED, never a verified request', trust.state === LEAD_TRUST_STATE.PARTIALLY_VERIFIED && trust.reason === 'CHANNEL_VERIFIED');
  ok('the review signal the lockout raises is one the trust engine routes to a human', evaluateTrust({ signals: ['REPEATED_FAILED_OTP'] }).humanReviewRequired === true);

  // What possession alone discloses for an OTP link.
  const anon = linkDisclosure(record, { factorVerified: false });
  ok('possession of an OTP link reveals the factor kind and the channel kind', anon.factorRequired === 'OTP' && anon.otpChannel === 'SMS');
  ok('possession reveals no destination, no reference, no hash', same(Object.keys(anon).sort(), ['exists', 'factorRequired', 'language', 'otpChannel']));
  ok('possession of a last-4 link does not name a channel', !('otpChannel' in linkDisclosure(mkLast4Link().record)));
}

// ── 4. The SMS-bombing control, with the clock passed in ─────────────────────
{
  const link = (sends) => ({ secondFactorKind: 'OTP', otp: { channel: 'SMS', sends } });
  const T = NOW;
  ok('a fresh link may send', linkSendProblem(link([]), { now: T }) === null && linkSendProblem(mkOtpLink().record, { now: T }) === null);
  ok('a second send inside the floor is too soon', seenOtp(linkSendProblem(link([T.toISOString()]), { now: plus(T, 30) })) === 'OTP_RESEND_TOO_SOON');
  ok('a second send after the floor may go', linkSendProblem(link([T.toISOString()]), { now: plus(T, 61) }) === null);
  ok('the floor is measured from the LAST send, whatever order the sends were stored in', linkSendProblem(link([plus(T, 100).toISOString(), T.toISOString()]), { now: plus(T, 130) }) === 'OTP_RESEND_TOO_SOON');
  ok('three sends in the window exhaust the link', seenOtp(linkSendProblem(link([T, plus(T, 100), plus(T, 200)].map((d) => d.toISOString())), { now: plus(T, 1000) })) === 'OTP_LINK_SEND_LIMIT');
  ok('sends outside the window no longer count', linkSendProblem(link([T, plus(T, 100), plus(T, 200)].map((d) => d.toISOString())), { now: plus(T, 3601 + 200) }) === null);
  ok('a send stamped in the future does not count (it cannot have happened)', linkSendProblem(link([plus(T, 9999).toISOString()]), { now: T }) === null);
  ok('an unreadable send entry is dropped, not counted', linkSendProblem(link(['yesterday', null, 42]), { now: T }) === null);
  ok('a link without an otp block has sent nothing', linkSendProblem({ secondFactorKind: 'OTP' }, { now: T }) === null && linkSendProblem(null, { now: T }) === null);

  const five = Array.from({ length: 5 }, (_, i) => plus(T, i * 60).toISOString());
  ok('a destination may receive until the cap', destinationSendProblem(null, { now: T }) === null && destinationSendProblem({ sends: five.slice(0, 4) }, { now: plus(T, 300) }) === null);
  ok('five sends to one destination inside the window exhaust it, whichever links sent them', seenOtp(destinationSendProblem({ sends: five }, { now: plus(T, 300) })) === 'OTP_DESTINATION_SEND_LIMIT');
  ok('the destination cap slides: an hour later the destination is free again', destinationSendProblem({ sends: five }, { now: plus(T, 3600 + 241) }) === null);
  const dest1 = recordDestinationSend(null, { now: T });
  const dest2 = recordDestinationSend(dest1, { now: plus(T, 60) });
  ok('recording a send appends and keeps the earlier ones', same(dest1, { sends: [T.toISOString()] }) && same(dest2, { sends: [T.toISOString(), plus(T, 60).toISOString()] }));
  ok('recording a send prunes sends that left the window', same(recordDestinationSend({ sends: five }, { now: plus(T, 3600 + 61) }), { sends: [...five.slice(2), plus(T, 3600 + 61).toISOString()] }));
  ok('recording a send does not mutate the previous record', dest1.sends.length === 1);

  ok('the plan refuses on the link first', otpSendPlan({ linkRecord: link(five.slice(0, 3)), destRecord: { sends: five }, now: plus(T, 300) }).reason === 'OTP_LINK_SEND_LIMIT');
  ok('the plan refuses on the destination when the link is fine', otpSendPlan({ linkRecord: link([]), destRecord: { sends: five }, now: plus(T, 300) }).reason === 'OTP_DESTINATION_SEND_LIMIT');
  ok('the plan allows when both are under their caps', same(otpSendPlan({ linkRecord: link([T.toISOString()]), destRecord: { sends: five.slice(0, 2) }, now: plus(T, 120) }), { allowed: true, reason: 'OK' }));
  ok('the plan with no destination record at all is still bounded by the link', otpSendPlan({ linkRecord: link(five.slice(0, 3)), now: plus(T, 300) }).allowed === false);
}

// ── 5. The message and the delivery (provider double, nothing leaves) ────────
{
  for (const lang of ['en', 'es']) {
    const m = buildOtpMessage({ code: '482913', language: lang });
    const all = m.subject + ' ' + m.body;
    ok(`message (${lang}) carries the code and its lifetime`, all.includes('482913') && /10 (minutes|minutos)/.test(all));
    ok(`message (${lang}) names the agency and says what to do if it was not requested`, /Clear Point/.test(all) && /(did not request|no lo solicitó)/.test(all));
    ok(`message (${lang}) carries no link, no name, no reference and nothing about what is being signed`, !/https?:|soa_|appt_|Scope|Alcance|Jane/i.test(all));
    ok(`message (${lang}) is not marketing`, (() => { try { assertNotMarketing(all); return true; } catch { return false; } })());
  }
  ok('an unknown language falls back to English', /verification code/.test(buildOtpMessage({ code: '1', language: 'xx' }).body));

  const calls = [];
  const provider = (status = 200) => async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: status < 400, status }; };
  const base = { channel: 'SMS', to: '+1 (631) 555-0147', code: '482913', language: 'en', consent: CALLBACK, env: FULL_ENV };
  let r = await deliverOtp({ ...base, env: {}, fetchImpl: provider() });
  ok('delivery is refused while sending is disabled, without touching a provider', r.sent === false && r.reason === 'SENDING_DISABLED' && calls.length === 0);
  r = await deliverOtp({ ...base, consent: null, fetchImpl: provider() });
  ok('delivery is refused without contact permission, without touching a provider', r.sent === false && r.reason === 'NO_CONTACT_PERMISSION' && calls.length === 0);
  r = await deliverOtp({ ...base, to: '0147', fetchImpl: provider() });
  ok('delivery to an unusable destination is refused by name', r.reason === 'NO_DESTINATION_ON_FILE' && calls.length === 0);
  r = await deliverOtp({ ...base, code: '', fetchImpl: provider() });
  ok('delivery without a code is refused by name', r.reason === 'OTP_NOT_ISSUED' && calls.length === 0);
  r = await deliverOtp({ ...base, fetchImpl: provider() });
  ok('with everything in place the code is posted to the configured TLS channel', r.sent === true && r.reason === 'OK' && calls.length === 1 && calls[0].url === 'https://otp.invalid/send' && calls[0].opts.method === 'POST');
  ok('the provider receives the NORMALIZED destination, the code in the body, and the channel token', calls[0].body.to === PHONE && calls[0].body.channel === 'SMS' && calls[0].body.body.includes('482913') && calls[0].opts.headers.Authorization === 'Bearer t-sms');
  ok('the result carries neither the code nor the destination', !JSON.stringify(r).includes('482913') && !JSON.stringify(r).includes(PHONE));
  r = await deliverOtp({ ...base, channel: 'EMAIL', to: 'Jane@Example.com', fetchImpl: provider() });
  ok('an email goes to the email channel with its own token, folded', r.sent === true && calls[1].url === 'https://otp.invalid/mail' && calls[1].body.to === 'jane@example.com' && calls[1].opts.headers.Authorization === 'Bearer t-mail');
  r = await deliverOtp({ ...base, fetchImpl: provider(502) });
  ok('a provider rejection is reported, never thrown', seenOtp(r.reason) === 'PROVIDER_REJECTED' && r.sent === false && r.status === 502);
  r = await deliverOtp({ ...base, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  ok('an unreachable provider is reported, never thrown', seenOtp(r.reason) === 'PROVIDER_UNREACHABLE' && r.sent === false);
}

// ── 6. The letter ────────────────────────────────────────────────────────────
{
  ok('VERIFICATION_LETTER is frozen all the way down and registered with the build gate', unfrozenPaths(VERIFICATION_LETTER, 'L').length === 0 && GOVERNING_IDENTIFIERS.includes('VERIFICATION_LETTER'));
  ok('the letter wording is PENDING OWNER APPROVAL, with nobody and no date recorded', VERIFICATION_LETTER.approval.status === 'PENDING_OWNER_APPROVAL' && VERIFICATION_LETTER.approval.approvedBy === null && VERIFICATION_LETTER.approval.approvedOn === null);
  ok('the official contact is the published number', OFFICIAL_CONTACT.phoneDisplay === '1-855-720-8555' && OFFICIAL_CONTACT.phoneDigits === '8557208555');

  for (const lang of ['en', 'es']) {
    const t = VERIFICATION_LETTER[lang];
    const text = t.subject + '\n' + t.body.split('{caseRef}').join('CASE-20261101-7F3A');
    ok(`letter (${lang}) passes its own content rule`, letterContentProblem(text) === null, letterContentProblem(text));
    ok(`letter (${lang}) asks the person to call the published number and carries the reference`, text.includes('1-855-720-8555') && text.includes('CASE-20261101-7F3A'));
    ok(`letter (${lang}) names no plan, carrier, benefit, price or enrollment`, !/\b(plan|plans|planes|Humana|Aetna|UnitedHealthcare|premium|prima|benefit|beneficio|coverage|cobertura|enroll|inscr)/i.test(text));
    ok(`letter (${lang}) discloses no name, no address and nothing about the request`, !/Jane|Dear|Estimad|street|calle|apartment|ZIP|appointment|cita|SOA|Scope/i.test(text));
    ok(`letter (${lang}) says what will never be asked for`, /(never ask|Nunca le pediremos)/.test(text));
  }
  ok('an empty letter is refused', seenOob(letterContentProblem('')) === 'LETTER_EMPTY' && letterContentProblem(null) === 'LETTER_EMPTY');
  ok('a marketing phrase is refused by the layer\'s one marketing rule', seenOob(letterContentProblem('Call 1-855-720-8555 — enroll now and save on the best plan!')) === 'LETTER_CONTENT_MARKETING');
  for (const [what, text] of [
    ['a plan', 'Your plan is waiting. Call 1-855-720-8555.'],
    ['a carrier', 'Humana asked us to confirm. Call 1-855-720-8555.'],
    ['a price', 'Your premium is $0 a month. Call 1-855-720-8555.'],
    ['a benefit', 'You may qualify for a benefit. Call 1-855-720-8555.'],
    ['Medicare Advantage', 'About your Medicare Advantage request, call 1-855-720-8555.'],
    ['Part D', 'About your Part D request, call 1-855-720-8555.'],
    ['an enrollment', 'Your enrollment was received. Call 1-855-720-8555.'],
    ['a Spanish plan', 'Su plan está listo. Llame al 1-855-720-8555.'],
    ['a Spanish benefit', 'Un beneficio para usted. Llame al 1-855-720-8555.'],
    ['a Spanish enrollment', 'Su inscripción fue recibida. Llame al 1-855-720-8555.'],
  ]) ok(`a letter naming ${what} is refused`, seenOob(letterContentProblem(text)) === 'LETTER_CONTENT_NAMES_PLAN_OR_PRICE', text);
  ok('"Medicare" alone (what will not be asked for) is allowed', letterContentProblem('We will never ask for your Medicare number. Call 1-855-720-8555.') === null);
  ok('a letter that does not point at the official number is refused', seenOob(letterContentProblem('We could not confirm a request. Please reply to this letter.')) === 'LETTER_CONTENT_NO_OFFICIAL_CHANNEL');

  const approved = (over = {}) => ({ ...VERIFICATION_LETTER, approval: { status: 'APPROVED', approvedBy: 'Maria Lopez', approvedOn: '2026-10-20', ...over } });
  ok('the shipped wording is not released: not approved', seenOob(letterApprovalProblem(VERIFICATION_LETTER, { now: NOW })) === 'LETTER_TEXT_NOT_APPROVED');
  ok('an approval by an automation is not an approval', seenOob(letterApprovalProblem(approved({ approvedBy: 'claude' }), { now: NOW })) === 'LETTER_APPROVER_NOT_HUMAN' && letterApprovalProblem(approved({ approvedBy: 'Sofía' }), { now: NOW }) === 'LETTER_APPROVER_NOT_HUMAN');
  ok('an approval dated in the future, or not a calendar day, is not an approval',
    seenOob(letterApprovalProblem(approved({ approvedOn: '2026-12-01' }), { now: NOW })) === 'LETTER_APPROVAL_DATE_INVALID' && letterApprovalProblem(approved({ approvedOn: 'last week' }), { now: NOW }) === 'LETTER_APPROVAL_DATE_INVALID' &&
    letterApprovalProblem(approved({ approvedOn: null }), { now: NOW }) === 'LETTER_APPROVAL_DATE_INVALID');
  ok('a named person on a past day approves', letterApprovalProblem(approved(), { now: NOW }) === null);
  ok('a template with no approval block is not approved', letterApprovalProblem({ en: {}, es: {} }, { now: NOW }) === 'LETTER_TEXT_NOT_APPROVED');

  const ENV = { [REVIEWERS_ENV]: 'Maria Lopez, Sawil Reyes' };
  const good = {
    client: { known: true, onFileSince: '2025-03-01T00:00:00Z' },
    address: { source: 'ON_FILE', verifiedAt: '2025-03-15T00:00:00Z', suppliedByRequest: false },
    request: { receivedAt: '2026-10-30T09:00:00Z', caseRef: 'CASE-20261030-7F3A' },
    actor: 'Maria Lopez', language: 'en', env: ENV, now: NOW, template: approved(),
  };
  const decide = (over = {}) => mayIssueVerificationLetter({ ...good, ...over });
  ok('the full case releases the letter, rendered, for a staff mailing', (() => { const d = decide(); return d.allowed === true && d.mailing === 'STAFF_ACTION' && d.decidedBy === 'Maria Lopez' && d.letter.language === 'en' && d.letter.body.includes('CASE-20261030-7F3A') && !d.letter.body.includes('{caseRef}') && d.letter.version === VERIFICATION_LETTER.version; })());
  ok('the Spanish letter renders the same way', decide({ language: 'es' }).letter.body.includes('CASE-20261030-7F3A') && /Clear Point Senior Advisors al 1-855-720-8555/.test(decide({ language: 'es' }).letter.body));
  ok('the released letter passes the content rule', (() => { const d = decide(); return d.allowed === true && letterContentProblem(d.letter.subject + '\n' + d.letter.body) === null; })(), JSON.stringify(decide()));
  ok('decision: an automation may not decide', seenOob(decide({ actor: 'svc_bot' }).reason) === 'ACTOR_NOT_HUMAN' && decide({ actor: 'Clara' }).reason === 'ACTOR_NOT_HUMAN');
  ok('decision: a person not on the owner\'s list may not decide', seenOob(decide({ actor: 'Jane Doe' }).reason) === 'REVIEWER_NOT_AUTHORIZED');
  ok('decision: with no list configured, nobody may decide (fail-closed)', seenOob(decide({ env: {} }).reason) === 'REVIEWERS_NOT_CONFIGURED');
  ok('decision: nobody at all may decide', seenOob(decide({ actor: '' }).reason) === 'ACTOR_MISSING');
  ok('decision: the shipped wording is refused until approved, whoever decides', decide({ template: VERIFICATION_LETTER }).reason === 'LETTER_TEXT_NOT_APPROVED');
  ok('decision: only an existing known client', seenOob(decide({ client: { known: false, onFileSince: '2025-03-01T00:00:00Z' } }).reason) === 'CLIENT_NOT_KNOWN' && decide({ client: null }).reason === 'CLIENT_NOT_KNOWN' && decide({ client: { known: true } }).reason === 'CLIENT_NOT_KNOWN');
  ok('decision: a client first seen WITH the suspicious request is not an existing client', decide({ client: { known: true, onFileSince: '2026-10-30T09:00:00Z' } }).reason === 'CLIENT_NOT_KNOWN' && decide({ client: { known: true, onFileSince: '2026-10-31T00:00:00Z' } }).reason === 'CLIENT_NOT_KNOWN');
  ok('decision: the request must say when it arrived', seenOob(decide({ request: { caseRef: 'CASE-20261030-7F3A' } }).reason) === 'REQUEST_TIME_MISSING' && decide({ request: null }).reason === 'REQUEST_TIME_MISSING');
  ok('decision: the case reference must be an opaque token', seenOob(decide({ request: { ...good.request, caseRef: 'Jane Q Public, 11717' } }).reason) === 'CASE_REF_MISSING' && decide({ request: { ...good.request, caseRef: '' } }).reason === 'CASE_REF_MISSING');
  ok('decision: only an address on file', seenOob(decide({ address: { source: 'REQUEST', verifiedAt: '2025-03-15T00:00:00Z', suppliedByRequest: false } }).reason) === 'ADDRESS_NOT_ON_FILE' && decide({ address: null }).reason === 'ADDRESS_NOT_ON_FILE');
  ok('decision: never an address the suspicious request supplied', seenOob(decide({ address: { ...good.address, suppliedByRequest: true } }).reason) === 'ADDRESS_SUPPLIED_BY_REQUEST');
  ok('decision: not having asked where the address came from is a refusal, not a pass', seenOob(decide({ address: { source: 'ON_FILE', verifiedAt: '2025-03-15T00:00:00Z' } }).reason) === 'ADDRESS_PROVENANCE_UNKNOWN');
  ok('decision: an address verified AFTER the request arrived is not previously verified',
    seenOob(decide({ address: { ...good.address, verifiedAt: '2026-10-30T10:00:00Z' } }).reason) === 'ADDRESS_NOT_PREVIOUSLY_VERIFIED' &&
    decide({ address: { ...good.address, verifiedAt: '2026-10-30T09:00:00Z' } }).reason === 'ADDRESS_NOT_PREVIOUSLY_VERIFIED' &&
    decide({ address: { source: 'ON_FILE', suppliedByRequest: false } }).reason === 'ADDRESS_NOT_PREVIOUSLY_VERIFIED');
  ok('decision: an unknown language', seenOob(decide({ language: 'fr' }).reason) === 'LANGUAGE_UNKNOWN');
  const tainted = (body) => approved({}) && { ...approved(), en: { subject: 'Please contact us', body } };
  ok('decision: an approved template that acquired marketing wording is refused at release', decide({ template: tainted('Call 1-855-720-8555 now — limited time, reference {caseRef}.') }).reason === 'LETTER_CONTENT_MARKETING');
  ok('decision: an approved template that acquired a plan name is refused at release', decide({ template: tainted('Your plan needs a call to 1-855-720-8555, reference {caseRef}.') }).reason === 'LETTER_CONTENT_NAMES_PLAN_OR_PRICE');
  ok('decision: an approved template that lost the official number is refused at release', decide({ template: tainted('Reply by mail, reference {caseRef}.') }).reason === 'LETTER_CONTENT_NO_OFFICIAL_CHANNEL');
  ok('the decision mutates none of its inputs', good.address.suppliedByRequest === false && VERIFICATION_LETTER.approval.status === 'PENDING_OWNER_APPROVAL');
}

// ── 7. The verification call ─────────────────────────────────────────────────
{
  const good = { requestPhone: '+1 (631) 555-0147', dialPhone: PHONE, callbackConsent: CALLBACK, doNotContact: false, caller: 'Maria Lopez', callerMode: 'HUMAN', purpose: VERIFICATION_CALL_PURPOSE };
  const call = (over = {}) => mayPlaceVerificationCall({ ...good, ...over });
  ok('the purpose vocabulary is one value', VERIFICATION_CALL_PURPOSE === 'SECURITY_REQUEST_VERIFICATION');
  ok('a human may call the request number for security verification, on a recorded contact basis', (() => { const d = call(); return d.allowed === true && d.purpose === 'SECURITY_REQUEST_VERIFICATION' && d.planMarketing === false && d.script === 'SECURITY_VERIFICATION_ONLY' && d.contactBasis === 'CALLBACK_CONSENT_GRANTED' && d.consentScope === 'this request' && d.caller === 'Maria Lopez'; })());
  ok('call: a marketing purpose is refused by name', seenOob(call({ purpose: 'PLAN_MARKETING' }).reason) === 'PURPOSE_NOT_VERIFICATION' && call({ purpose: 'DISCUSS_MEDICARE_PLAN_OPTIONS' }).reason === 'PURPOSE_NOT_VERIFICATION');
  ok('call: no purpose is no call', call({ purpose: undefined }).reason === 'PURPOSE_NOT_VERIFICATION');
  ok('call: an automated or AI caller is refused', seenOob(call({ callerMode: 'AI_AUTOMATED' }).reason) === 'CALLER_NOT_HUMAN' && call({ callerMode: 'HUMAN', caller: 'Sofía' }).reason === 'CALLER_NOT_HUMAN' && call({ caller: 'svc_dialer' }).reason === 'CALLER_NOT_HUMAN' && call({ callerMode: undefined }).reason === 'CALLER_NOT_HUMAN');
  ok('call: the request must carry a number', seenOob(call({ requestPhone: '' }).reason) === 'REQUEST_NUMBER_MISSING' && call({ requestPhone: '555-0147' }).reason === 'REQUEST_NUMBER_MISSING');
  ok('call: only THE SAME number — another number is refused', seenOob(call({ dialPhone: '6315550148' }).reason) === 'NUMBER_NOT_THE_REQUEST_NUMBER' && call({ dialPhone: '' }).reason === 'NUMBER_NOT_THE_REQUEST_NUMBER');
  ok('call: formatting of the number does not matter', call({ dialPhone: '1-631-555-0147' }).allowed === true);
  ok('call: an unknown do-not-contact status is a refusal (the list must have been consulted)', call({ doNotContact: undefined }).reason === 'DO_NOT_CONTACT_STATUS_UNKNOWN');
  ok('call: a do-not-contact wins', call({ doNotContact: true }).reason === 'DO_NOT_CONTACT');
  ok('call: no contact basis, no call', call({ callbackConsent: null }).reason === 'NO_CALLBACK_CONSENT');
  ok('call: §6 — an SOA signature or a recording notice is not a contact basis', call({ callbackConsent: grant('SCOPE_OF_APPOINTMENT') }).reason === 'NO_CALLBACK_CONSENT' && call({ callbackConsent: grant('RECORDING_NOTICE') }).reason === 'NO_CALLBACK_CONSENT');
  ok('call: a revoked basis is no basis', call({ callbackConsent: revokeConsent(CALLBACK, { via: 'PHONE' }) }).reason === 'NO_CALLBACK_CONSENT');
  ok('call: the order is purpose, caller, number, then the basis', call({ purpose: 'X', callerMode: 'AI_AUTOMATED', requestPhone: '', doNotContact: true }).reason === 'PURPOSE_NOT_VERIFICATION' && call({ callerMode: 'AI_AUTOMATED', requestPhone: '', doNotContact: true }).reason === 'CALLER_NOT_HUMAN');
}

// ── 8. The callback through the official number ──────────────────────────────
{
  const kase = { id: 'case_1', status: CASE_STATUS.QUARANTINED, trustState: 'SECURITY_QUARANTINE', channelVerification: 'NOT_ATTEMPTED', identityVerification: 'NOT_VERIFIED' };
  const inbound = { direction: 'INBOUND', dialedNumber: '+1 855 720 8555' };
  const reopen = (c = kase, over = {}) => reopenCaseOnCallback(c, { inbound, actor: 'Maria Lopez', now: NOW, ...over });
  const r = reopen();
  ok('a callback through the official number re-opens a quarantined case', r.ok === true && r.case.status === 'REOPENED' && r.nextGate === 'VERIFY_CONTEXT_THEN_HUMAN_CONFIRMATION');
  ok('the re-open records when, who, how and what it was before', same(r.case.reopened, { at: NOW.toISOString(), by: 'Maria Lopez', via: 'INBOUND_OFFICIAL_NUMBER', previousStatus: 'QUARANTINED', verificationChanged: false }));
  ok('the re-open changes NO verification field and NO trust state — a call received proves neither channel nor identity',
    r.case.trustState === 'SECURITY_QUARANTINE' && r.case.channelVerification === 'NOT_ATTEMPTED' && r.case.identityVerification === 'NOT_VERIFIED');
  ok('the input case is not mutated', kase.status === 'QUARANTINED' && !('reopened' in kase));
  ok('a human-review case and a closed-unverified case may be re-opened', reopen({ ...kase, status: 'HUMAN_REVIEW' }).ok === true && reopen({ ...kase, status: 'CLOSED_UNVERIFIED' }).ok === true);
  ok('a verified case, an unknown status, an already re-opened case or no case is not re-opened',
    seenOob(reopen({ ...kase, status: 'VERIFIED' }).reason) === 'CASE_NOT_REOPENABLE' && reopen({ ...kase, status: 'OPEN' }).reason === 'CASE_NOT_REOPENABLE' && reopen(r.case).reason === 'CASE_NOT_REOPENABLE' && reopen(null).reason === 'CASE_NOT_REOPENABLE');
  ok('a call WE placed is not the person calling back', seenOob(reopen(kase, { inbound: { direction: 'OUTBOUND', dialedNumber: '8557208555' } }).reason) === 'NOT_AN_INBOUND_CALL' && reopen(kase, { inbound: null }).reason === 'NOT_AN_INBOUND_CALL');
  ok('a call to any other number is not through the official channel', seenOob(reopen(kase, { inbound: { direction: 'INBOUND', dialedNumber: '800-555-1212' } }).reason) === 'NOT_THROUGH_OFFICIAL_NUMBER' && reopen(kase, { inbound: { direction: 'INBOUND' } }).reason === 'NOT_THROUGH_OFFICIAL_NUMBER');
  ok('the person who took the call must be a person', reopen(kase, { actor: 'ivr-bot' }).reason === 'ACTOR_NOT_HUMAN' && reopen(kase, { actor: '' }).reason === 'ACTOR_MISSING');
  ok('CASE_STATUS and OOB_REFUSAL are frozen', unfrozenPaths(CASE_STATUS, 'C').length === 0 && unfrozenPaths(OOB_REFUSAL, 'O').length === 0);
}

// ── 9. Audit vocabulary, and every refusal reached ───────────────────────────
{
  ok('OTP_ISSUED and OTP_SEND_REFUSED are registered audit actions', AUDIT_ACTIONS.includes('OTP_ISSUED') && AUDIT_ACTIONS.includes('OTP_SEND_REFUSED'));
  const otpExpected = Object.values(OTP_REFUSAL).filter((r) => r !== 'MARKETING_CONTENT_BLOCKED');
  ok('the sections above reached every OTP refusal there is (the marketing block is fixed text and is scanned below)',
    otpExpected.every((r) => otpReasons.has(r)), otpExpected.filter((r) => !otpReasons.has(r)).join(','));
  ok('and every out-of-band refusal', Object.values(OOB_REFUSAL).every((r) => oobReasons.has(r)), Object.values(OOB_REFUSAL).filter((r) => !oobReasons.has(r)).join(','));
  ok('OTP_REFUSAL is frozen', unfrozenPaths(OTP_REFUSAL, 'R').length === 0);
}

// ── 10. What must be ABSENT from, or anchored in, the source ─────────────────
{
  const OTP = strip(read('../api/_lib/cy2027/otp.js'));
  const LINK = strip(read('../api/_lib/cy2027/secure-link.js'));
  const TOK = strip(read('../api/soa-token.js'));
  const STAT = strip(read('../api/soa-status.js'));
  const PAGE = strip(read('../src/pages/SignSOA.tsx'));
  const OOB = strip(read('../api/_lib/cy2027/out-of-band-verification.js'));
  ok('otp.js never logs (the code and the destination have no way to a log line)', !/console\./.test(OTP));
  ok('otp.js compares with crypto.timingSafeEqual on the line that decides', line(/const matches = a\.length === b\.length && crypto\.timingSafeEqual\(a, b\)/).test(OTP));
  ok('otp.js runs the layer\'s marketing rule over the message before any send', line(/try \{ assertNotMarketing\(msg\.subject \+ ' ' \+ msg\.body\); \}/).test(OTP));
  ok('otp.js and out-of-band-verification.js import only from the layer and node:crypto', [...OTP.matchAll(/from '([^']+)'/g)].every((m) => /^(node:crypto|\.\/[\w-]+\.js)$/.test(m[1])) && [...OOB.matchAll(/from '([^']+)'/g)].every((m) => /^\.\/[\w-]+\.js$/.test(m[1])));
  ok('out-of-band-verification.js has no Node import at all (environment-neutral)', !/from 'node:/.test(OOB) && !/console\./.test(OOB));
  ok('soa-token.js no longer hard-codes the factor kind', !/secondFactorKind: 'PHONE_LAST4'/.test(TOK) && line(/var factor = otpFactorForIssue\(\{ channel: 'SMS', consent: OTP_CONSENT_BASIS, env: process\.env \}\);/).test(TOK));
  ok('soa-token.js states that it holds no consent basis (null, never a body claim)', line(/var OTP_CONSENT_BASIS = null;/).test(TOK) && !/body\.consent/.test(TOK));
  ok('soa-status.js never reads a destination from the body', !/body\.(to|phone|email|destination)\b/.test(STAT));
  ok('the status handler and the verifier share one attempt limit', line(/if \(factorLocked\(prec\)\) \{/).test(STAT) && line(/if \(factorLocked\(record, \{ maxAttempts \}\)\) \{/).test(LINK));
  ok('the page asks for a six-digit code on an OTP link and can request a new one', /factorRequired === 'OTP'/.test(PAGE) && /resendCode: true/.test(PAGE) && /one-time-code/.test(PAGE) && /code_stale/.test(PAGE));
}

// ── 11. The two handlers, driven in process ──────────────────────────────────
// The handlers are gated off (SOA_ENABLED=false, pinned by test-cp-findings). A
// loader hook rewrites that ONE declaration to true in memory for the two
// handler modules as they load; the files on disk are untouched.
{
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      const r = await nextLoad(url, context);
      if (!/\\/api\\/(soa-token|soa-status)\\.js$/.test(url)) return r;
      const src = typeof r.source === 'string' ? r.source : new TextDecoder().decode(r.source);
      const parts = src.split('const SOA_ENABLED = false;');
      if (parts.length !== 2) throw new Error('the SOA gate is not declared exactly once in ' + url);
      return { ...r, source: parts.join('const SOA_ENABLED = true;') };
    }
  `));

  Object.assign(process.env, FULL_ENV);
  const provider = [];
  let providerStatus = 200;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === 'https://otp.invalid/send' || u === 'https://otp.invalid/mail') {
      provider.push({ url: u, body: JSON.parse(opts.body), auth: opts.headers && opts.headers.Authorization });
      return { ok: providerStatus < 400, status: providerStatus, json: async () => ({}) };
    }
    throw new Error('the handler section must not reach ' + u.slice(0, 60));
  };
  const LOGS = [];
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { LOGS.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  const audits = () => LOGS.filter((l) => l.includes('[SOA-AUDIT] {')).map((l) => JSON.parse(l.slice(l.indexOf('{'))));
  const audited = (action, result) => audits().filter((a) => a.action === action && (result === undefined || a.result === result));

  const ROOT = new URL('../', import.meta.url);
  const handlerOf = async (p) => (await import(new URL(p, ROOT).href)).default;
  const soaToken = await handlerOf('api/soa-token.js');
  const soaStatus = await handlerOf('api/soa-status.js');

  let ipSeq = 0;
  const mkReq = (body, method = 'POST', url = '/api/x') => {
    ipSeq += 1;
    return {
      method, url,
      headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '203.0.' + (113 + Math.floor(ipSeq / 200)) + '.' + (ipSeq % 200 + 1), 'user-agent': 'cy2027-suite', 'content-type': 'application/json' },
      readableEnded: true, complete: true, on() {}, get body() { return body; },
    };
  };
  const mkRes = () => { const h = {}; return { statusCode: 200, payload: undefined, setHeader(k, v) { h[k] = v; }, getHeader(k) { return h[k]; }, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end(d) { this.payload = d; return this; } }; };
  const run = async (fn, body, method, url) => {
    const res = mkRes(); let threw = null;
    try { await fn(mkReq(body, method, url), res); } catch (e) { threw = String((e && e.stack) || e); }
    return { status: res.statusCode, payload: res.payload, retryAfter: res.getHeader('Retry-After'), threw };
  };
  const status = (token) => run(soaStatus, null, 'GET', '/api/soa-status?token=' + token);
  const verify = (token, factor) => run(soaStatus, { token, factor });
  const resend = (token, extra = {}) => run(soaStatus, { token, resendCode: true, ...extra });
  const codeFrom = (call) => (call.body.body.match(/\b(\d{6})\b/) || [])[1];

  // Seed an OTP link the way the issuer would once it can: the lead record
  // (phone on file) and the link record, both in the memory store.
  let seq = 0;
  const seed = async ({ consentBasis = CALLBACK, sends, failedFactorAttempts, kind = 'OTP', issuedAt = new Date() } = {}) => {
    seq += 1;
    const ref = 'contact_' + seq;
    const link = kind === 'OTP'
      ? issueLink({ soaId: 'soa_' + seq, appointmentId: 'appt_' + seq, beneficiaryRef: ref, channel: 'WEB', secondFactorKind: 'OTP', otpChannel: 'SMS', otpConsentBasis: consentBasis, language: 'en', now: issuedAt })
      : issueLink({ soaId: 'soa_' + seq, appointmentId: 'appt_' + seq, beneficiaryRef: ref, channel: 'WEB', secondFactorKind: 'PHONE_LAST4', secondFactorValue: PHONE, language: 'en', now: issuedAt });
    let record = link.record;
    let code = null;
    if (kind === 'OTP') { const issued = issueOtp(record, { now: issuedAt }); record = issued.record; code = issued.code; }
    if (sends) record = { ...record, otp: { ...record.otp, sends } };
    if (failedFactorAttempts !== undefined) record = { ...record, failedFactorAttempts };
    await setRecord(leadKey(ref), { beneficiaryRef: ref, fullName: 'Jane Q Public', phone: PHONE, email: 'jane@example.com', zip: '11717', language: 'en', leadSource: 'customer_service' }, SOA_TOKEN_TTL_SEC);
    await setRecord(link.storeKey, record, SOA_TOKEN_TTL_SEC);
    return { token: link.token, code, ref, key: link.storeKey };
  };
  const linkOf = (key) => getRecord(key);
  const destKey = otpDestinationKey('SMS', PHONE);
  const fresh = async () => { LOGS.length = 0; provider.length = 0; providerStatus = 200; await setRecord(destKey, { sends: [] }, 1); };

  // (a) The issuer today: no consent basis is reachable, so the factor stays PHONE_LAST4 and nothing is sent.
  await fresh();
  const issued = await run(soaToken, { fullName: 'Jane Q Public', phone: PHONE, email: '', zip: '11717', language: 'en' });
  ok('handler: with the OTP channel configured but no consent basis, the issuer keeps today\'s factor', issued.status === 200 && issued.payload.factorRequired === 'PHONE_LAST4' && !('codeSent' in issued.payload) && !issued.threw, JSON.stringify(issued));
  ok('handler: no code went to any provider', provider.length === 0);
  ok('handler: the issue audit records WHY the code was not offered', audited('SOA_LINK_ISSUED', 'OK').some((a) => a.details && a.details.factor === 'PHONE_LAST4' && a.details.factorReason === 'NO_CONTACT_PERMISSION'));
  ok('handler: the issued link is a last-4 link with no otp block', (await linkOf(storeKeyFor(issued.payload.token))).secondFactorKind === 'PHONE_LAST4' && !('otp' in (await linkOf(storeKeyFor(issued.payload.token)))));

  // (b) An OTP link: what possession shows, and the code path through the status endpoint.
  await fresh();
  const A = await seed();
  const shown = await status(A.token);
  ok('handler: possession of an OTP link shows the factor kind and the channel kind, nothing personal',
    shown.status === 200 && same(Object.keys(shown.payload).sort(), ['exists', 'factorRequired', 'language', 'otpChannel']) && shown.payload.factorRequired === 'OTP' && shown.payload.otpChannel === 'SMS', JSON.stringify(shown));
  const wrongA = await verify(A.token, '000000');
  ok('handler: a wrong code is refused with the OTP reason and one attempt counted', wrongA.status === 401 && wrongA.payload.reason === 'OTP_MISMATCH' && wrongA.payload.attemptsRemaining === 4 && wrongA.payload.verified === false, JSON.stringify(wrongA));
  ok('handler: the attempt survived the request', (await linkOf(A.key)).failedFactorAttempts === 1);
  const rightA = await verify(A.token, A.code);
  ok('handler: the right code releases the prefill, and the response names what was proven', rightA.status === 200 && rightA.payload.verified === true && rightA.payload.verification === 'CONTACT_CHANNEL_VERIFIED' && rightA.payload.lead.fullName === 'Jane Q Public', JSON.stringify(rightA));
  ok('handler: the stored link says channel VERIFIED, identity NOT verified, code consumed',
    (await linkOf(A.key)).channelVerification === 'VERIFIED' && (await linkOf(A.key)).identityVerification === 'NOT_VERIFIED' && typeof (await linkOf(A.key)).otp.consumedAt === 'string');
  ok('handler: the release is audited as channel-verified with the claim', audited('SOA_VIEWED', 'PREFILL_RELEASED').some((a) => a.actor === 'beneficiary:channel-verified' && a.details.factor === 'OTP' && a.details.claim === 'CONTACT_CHANNEL_VERIFIED'));
  const againA = await verify(A.token, A.code);
  ok('handler: the same code again is refused as already used', againA.status === 401 && againA.payload.reason === 'OTP_ALREADY_USED');
  ok('handler: no audit line carries the code or the phone', !LOGS.some((l) => l.includes(A.code) || l.includes(PHONE)));

  // (c) A last-4 link through the same endpoint: factor matched, no channel claim.
  await fresh();
  const F = await seed({ kind: 'PHONE_LAST4' });
  const rightF = await verify(F.token, '0147');
  ok('handler: a last-4 link still verifies, and the response says LINK_FACTOR_MATCHED', rightF.status === 200 && rightF.payload.verification === 'LINK_FACTOR_MATCHED', JSON.stringify(rightF));
  ok('handler: the release of a last-4 link is audited as factor-matched, not channel-verified', audited('SOA_VIEWED', 'PREFILL_RELEASED').some((a) => a.actor === 'beneficiary:factor-matched' && a.details.claim === 'LINK_FACTOR_MATCHED') && !audited('SOA_VIEWED', 'PREFILL_RELEASED').some((a) => a.actor === 'beneficiary:channel-verified'));
  const resendF = await resend(F.token);
  ok('handler: a resend on a last-4 link is refused by name', resendF.status === 400 && resendF.payload.reason === 'FACTOR_NOT_OTP' && provider.length === 0);

  // (d) Resend: the destination is the lead record's phone, never the body's; the old code dies; the caps bite.
  await fresh();
  const B = await seed({ issuedAt: plus(new Date(), -120) });
  const resentB = await resend(B.token, { to: '+15550000000', phone: '5550000000', email: 'attacker@example.com', destination: '5550000000' });
  ok('handler: a resend issues and delivers a new code', resentB.status === 200 && resentB.payload.resent === true && resentB.payload.reason === 'OK' && provider.length === 1, JSON.stringify(resentB));
  ok('handler: the code went to the phone ON THE LEAD RECORD — not to anything in the request body', provider[0].body.to === PHONE && provider[0].url === 'https://otp.invalid/send' && provider[0].auth === 'Bearer t-sms');
  ok('handler: the response carries neither the code nor the destination', !JSON.stringify(resentB.payload).includes(PHONE) && !JSON.stringify(resentB.payload).match(/\b\d{6}\b/));
  const newCodeB = codeFrom(provider[0]);
  ok('handler: the resend is counted on the link (two sends)', (await linkOf(B.key)).otp.sends.length === 2 && /^\d{6}$/.test(newCodeB));
  ok('handler: the resend is counted on the destination', ((await getRecord(destKey)) || { sends: [] }).sends.length === 1);
  ok('handler: the resend is audited without the code or the phone', audited('OTP_ISSUED', 'SENT').length === 1 && !LOGS.some((l) => l.includes(newCodeB) || l.includes(PHONE)));
  const oldB = await verify(B.token, B.code);
  ok('handler: the previous code no longer verifies', oldB.status === 401 && oldB.payload.reason === 'OTP_MISMATCH');
  const tooSoon = await resend(B.token);
  ok('handler: a second resend inside the floor is refused, with Retry-After, and nothing is sent', tooSoon.status === 429 && tooSoon.payload.reason === 'OTP_RESEND_TOO_SOON' && tooSoon.retryAfter === '60' && provider.length === 1, JSON.stringify(tooSoon));
  ok('handler: the refused resend is audited with its reason', audited('OTP_SEND_REFUSED', 'OTP_RESEND_TOO_SOON').length === 1);
  const newB = await verify(B.token, newCodeB);
  ok('handler: the new code verifies', newB.status === 200 && newB.payload.verification === 'CONTACT_CHANNEL_VERIFIED');

  await fresh();
  const now = new Date();
  const C = await seed({ sends: [plus(now, -600), plus(now, -400), plus(now, -200)].map((d) => d.toISOString()) });
  const limitC = await resend(C.token);
  ok('handler: a link that sent three codes in the window gets no fourth', limitC.status === 429 && limitC.payload.reason === 'OTP_LINK_SEND_LIMIT' && limitC.retryAfter === '3600' && provider.length === 0, JSON.stringify(limitC));

  await fresh();
  await setRecord(destKey, { sends: Array.from({ length: 5 }, (_, i) => plus(now, -60 * (i + 1)).toISOString()) }, 3600);
  const D = await seed({ issuedAt: plus(now, -120) });
  const limitD = await resend(D.token);
  ok('handler: a phone that received five codes in the window gets no sixth, from any link', limitD.status === 429 && limitD.payload.reason === 'OTP_DESTINATION_SEND_LIMIT' && provider.length === 0 && audited('OTP_SEND_REFUSED', 'OTP_DESTINATION_SEND_LIMIT').length === 1, JSON.stringify(limitD));
  ok('handler: the refused resend did not touch the link\'s send log', (await linkOf(D.key)).otp.sends.length === 1);

  await fresh();
  const E = await seed({ failedFactorAttempts: 5, issuedAt: plus(now, -120) });
  const lockedE = await resend(E.token);
  ok('handler: a locked link gets no new code', lockedE.status === 401 && lockedE.payload.reason === 'SECOND_FACTOR_LOCKED' && provider.length === 0 && audited('OTP_SEND_REFUSED', 'SECOND_FACTOR_LOCKED').length === 1, JSON.stringify(lockedE));
  const lockedVerify = await verify(E.token, E.code);
  ok('handler: and the right code on a locked link is still refused, with the review signal audited', lockedVerify.status === 401 && lockedVerify.payload.reason === 'SECOND_FACTOR_LOCKED' && audited('SOA_VIEWED', 'SECOND_FACTOR_LOCKED').some((a) => a.details.signal === 'REPEATED_FAILED_OTP'));

  await fresh();
  const G = await seed({ consentBasis: null, issuedAt: plus(now, -120) });
  const resentG = await resend(G.token);
  ok('handler: a resend on a link issued without a contact basis is counted but NOT delivered — the gate holds on the resend path too',
    resentG.status === 200 && resentG.payload.resent === false && resentG.payload.reason === 'NO_CONTACT_PERMISSION' && provider.length === 0 && audited('OTP_ISSUED', 'NO_CONTACT_PERMISSION').length === 1, JSON.stringify(resentG));

  await fresh();
  providerStatus = 503;
  const H = await seed({ issuedAt: plus(now, -120) });
  const resentH = await resend(H.token);
  ok('handler: a provider failure is reported, the attempt still counts, and the link stays usable',
    resentH.status === 200 && resentH.payload.resent === false && resentH.payload.reason === 'PROVIDER_REJECTED' && (await linkOf(H.key)).otp.sends.length === 2 && (await status(H.token)).status === 200, JSON.stringify(resentH));

  // (e) The endpoint's own guards still front the resend action.
  await fresh();
  const badToken = await resend('not-a-token');
  ok('handler: a malformed token is refused before anything is read', badToken.status === 400);
  const noFactor = await run(soaStatus, { token: A.token });
  ok('handler: a POST without a factor and without a resend is still refused', noFactor.status === 400 && noFactor.payload.error === 'factor required');
  const unknown = await resend('A'.repeat(43));
  ok('handler: a resend on an unknown link says the link is not found', unknown.status === 404 && unknown.payload.reason === 'LINK_NOT_FOUND');
  const wrongOrigin = mkReq({ token: A.token, resendCode: true });
  wrongOrigin.headers.origin = 'https://evil.invalid';
  const res = mkRes();
  await soaStatus(wrongOrigin, res);
  ok('handler: a resend from a disallowed origin is refused', res.statusCode === 403 && provider.length === 0);

  for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
}

if (failures.length) {
  console.error(`CY2027 VERIFY FLOW: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

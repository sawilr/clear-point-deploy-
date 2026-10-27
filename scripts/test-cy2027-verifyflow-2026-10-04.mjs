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
// AUDIT 2026-10-04 (SPEC-12, red team) — what an independent red team broke in
// the first version of this work, and what this suite now observes instead of
// scanning for: the SMS-bombing control was a read-modify-write that a parallel
// burst walked through (now an atomic claim, and the burst is fired here);
// the verification call dropped its purpose on the way to the consent rule
// (now a consent scoped to plan discussion is refused by name); the letter's
// price rule was dead ("$5 a month" passed; now refused) and its approval gate
// took a caller-supplied template (now the governing letter only, and the
// approval is bound to a digest of the text); and the issuer's one-time-code
// branch was unreachable by any suite, so eight mutants of it survived (now
// the issuer is driven with a consent lookup it is GIVEN, bodies are Proxies
// that record every key the handlers read, and the provider double looks at
// the store at the moment it is called).
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
import { register } from 'node:module';

import {
  OTP_CHANNELS, OTP_POLICY, OTP_REFUSAL, VERIFICATION_CLAIM, normalizeDestination, otpSendingEnabled, mayDeliverOtp, otpFactorForIssue,
  otpDestination, otpDestinationKey, otpSendKeys, reserveOtpSend,
  issueOtp, verifyOtp, verificationClaim, buildOtpMessage, deliverOtp,
} from '../api/_lib/cy2027/otp.js';
import {
  issueLink, storeKeyFor, checkLink, verifySecondFactor, linkDisclosure, MAX_FACTOR_ATTEMPTS, factorLocked, SECOND_FACTOR_KINDS,
} from '../api/_lib/cy2027/secure-link.js';
import {
  OFFICIAL_CONTACT, VERIFICATION_CALL_PURPOSE, CASE_STATUS, OOB_REFUSAL, VERIFICATION_LETTER,
  letterContentProblem, letterApprovalProblem, letterTextDigest, mayIssueVerificationLetter, mayPlaceVerificationCall, reopenCaseOnCallback,
} from '../api/_lib/cy2027/out-of-band-verification.js';
import { createConsent, CONSENT_STATUS, revokeConsent } from '../api/_lib/cy2027/consent.js';
import { evaluateTrust, CHANNEL_VERIFICATION, IDENTITY_VERIFICATION, LEAD_TRUST_STATE } from '../api/_lib/cy2027/trust.js';
import { AUDIT_ACTIONS } from '../api/_lib/cy2027/evidence.js';
import { REVIEWERS_ENV } from '../api/_lib/cy2027/actors.js';
import { assertNotMarketing } from '../api/_lib/cy2027/beneficiary-copy.js';
import { getRecord, setRecord, deleteRecord, leadKey, SOA_TOKEN_TTL_SEC } from '../api/_lib/soa-store.js';
import { stripComments, unfrozenPaths, GOVERNING_IDENTIFIERS } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const rejects = async (label, fn, re) => {
  try { await fn(); failures.push(label + '\n        did not reject'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        rejected: ' + (e && e.message)); }
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

// ── The loader hook ──────────────────────────────────────────────────────────
// Two things this suite needs exist only as reviewed edits to frozen, gate-
// registered declarations, so a hook rewrites them IN MEMORY for specific
// module instances; the files on disk are untouched:
//   • the SOA handlers are gated off (SOA_ENABLED=false, pinned by
//     test-cp-findings) — the ONE declaration becomes true as they load;
//   • the verification letter ships PENDING_OWNER_APPROVAL — an instance
//     imported under `?cy2027-approved=<digest>` carries an approval by a named
//     person on a past day for that digest, which is what the owner's approving
//     commit will look like, so the release path is observed before it exists.
// Each rewrite asserts its anchor occurs exactly once.
register('data:text/javascript,' + encodeURIComponent(`
  export async function load(url, context, nextLoad) {
    const r = await nextLoad(url, context);
    const text = () => (typeof r.source === 'string' ? r.source : new TextDecoder().decode(r.source));
    const once = (src, from, to, what) => {
      const parts = src.split(from);
      if (parts.length !== 2) throw new Error(what + ' is not declared exactly once in ' + url);
      return parts.join(to);
    };
    if (/\\/api\\/(soa-token|soa-status)\\.js$/.test(url)) {
      return { ...r, source: once(text(), 'const SOA_ENABLED = false;', 'const SOA_ENABLED = true;', 'the SOA gate') };
    }
    const approved = /\\/api\\/_lib\\/cy2027\\/out-of-band-verification\\.js\\?cy2027-approved=([0-9a-f]{64})$/.exec(url);
    if (approved) {
      return { ...r, source: once(text(),
        "approval: { status: 'PENDING_OWNER_APPROVAL', approvedBy: null, approvedOn: null, textDigest: null },",
        "approval: { status: 'APPROVED', approvedBy: 'Maria Lopez', approvedOn: '2026-10-20', textDigest: '" + approved[1] + "' },",
        'the pending approval block') };
    }
    return r;
  }
`));
const approvedLetterModule = (digest) => import(new URL('../api/_lib/cy2027/out-of-band-verification.js?cy2027-approved=' + digest, import.meta.url).href);

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

// ── 4. The SMS-bombing control: atomic claims, with the store's clock in hand ─
// A fake store with SET-NX-and-TTL semantics over a clock this block advances,
// so the sliding window is observed in seconds, not waited for. The real
// memory store (soa-store.claimRecord) is driven in section 11.
{
  const LINK = 'soa-link:' + 'a'.repeat(64);
  const DEST = otpDestinationKey('SMS', PHONE);
  const keys = otpSendKeys(LINK, DEST);
  ok('the claim keys: one floor, three link slots, five destination slots — all hashes, none naming a token or a phone',
    keys.floor === 'otp-floor:' + 'a'.repeat(64) && keys.link.length === 3 && keys.dest.length === 5 &&
    keys.link.every((k, i) => k === 'otp-link:' + 'a'.repeat(64) + ':' + i) && keys.dest.every((k, i) => k === DEST + ':' + i) &&
    !JSON.stringify(keys).includes(PHONE) && Object.isFrozen(keys) && Object.isFrozen(keys.link) && Object.isFrozen(keys.dest));
  throws('the keys need a real link store key', () => otpSendKeys('soa-link:short', DEST), /link store key/);
  throws('the keys need a real destination key', () => otpSendKeys(LINK, 'otp-dest:nope'), /destination key/);
  throws('the keys never take a raw destination', () => otpSendKeys(LINK, PHONE), /destination key/);

  let clockMs = NOW.getTime();
  const tick = (sec) => { clockMs += sec * 1000; };
  const fakeStore = () => {
    const map = new Map();
    const state = { failAll: false, failKeys: new Set(), throwing: false, claims: 0 };
    return {
      state, map,
      claim: async (key, value, ttlSec) => {
        state.claims += 1;
        if (state.throwing) throw new Error('boom');
        if (state.failAll || state.failKeys.has(key)) return { ok: false, claimed: false, reason: 'KV_WRITE_FAILED' };
        const e = map.get(key);
        if (e && e.expiresAt > clockMs) return { ok: true, claimed: false };
        map.set(key, { value, expiresAt: clockMs + ttlSec * 1000 });
        return { ok: true, claimed: true };
      },
      release: async (key) => { map.delete(key); return { ok: true }; },
      live: () => [...map.entries()].filter(([, e]) => e.expiresAt > clockMs).map(([k]) => k).sort(),
    };
  };
  const store = fakeStore();
  const reserve = (link = LINK, dest = DEST, s = store) => reserveOtpSend({ linkStoreKey: link, destinationKey: dest, now: new Date(clockMs), claim: s.claim, release: s.release });

  await rejects('the reservation needs the store\'s primitives', () => reserveOtpSend({ linkStoreKey: LINK, destinationKey: DEST }), /claim\(\) and release\(\)/);
  await rejects('the reservation needs a link store key', () => reserve('soa-link:x'), /link store key/);

  const first = await reserve();
  ok('a fresh link may send: the floor, its first slot and the destination\'s first slot are held', first.allowed === true && first.reason === 'OK' && same(first.held, [keys.floor, keys.link[0], keys.dest[0]]) && same(store.live(), [...first.held].sort()));
  ok('the reservation is frozen and stamped', Object.isFrozen(first) && Object.isFrozen(first.held) && first.at === new Date(clockMs).toISOString());
  tick(30);
  const soon = await reserve();
  ok('a second send inside the floor is too soon, and holds nothing new', seenOtp(soon.reason) === 'OTP_RESEND_TOO_SOON' && soon.allowed === false && store.live().length === 3);
  tick(31);
  const second = await reserve();
  ok('after the floor a second send may go: a new floor, the second slot, the second destination slot', second.allowed === true && same(second.held, [keys.floor, keys.link[1], keys.dest[1]]) && store.live().length === 5);
  tick(61);
  const third = await reserve();
  ok('a third send takes the last link slot', third.allowed === true && same(third.held, [keys.floor, keys.link[2], keys.dest[2]]) && store.live().length === 7);
  tick(61);
  const fourth = await reserve();
  ok('three sends in the window exhaust the link — and the floor the fourth took is released again', seenOtp(fourth.reason) === 'OTP_LINK_SEND_LIMIT' && !store.live().includes(keys.floor) && store.live().length === 6);
  const fourthAgain = await reserve();
  ok('so the fourth asked again is told the same true reason, not "too soon"', fourthAgain.reason === 'OTP_LINK_SEND_LIMIT');
  tick(3601 - 183); // the clock is at t0+183 (30+31+61+61); the first slot, claimed at t0, lives 3600 s
  const slid = await reserve();
  ok('the window slides: an hour after the first send its slot is free and the link may send again', slid.allowed === true && slid.held[1] === keys.link[0]);

  // The destination cap, across links.
  const store2 = fakeStore();
  const links = Array.from({ length: 8 }, (_, i) => 'soa-link:' + String(i).repeat(64));
  const five = [];
  for (const l of links.slice(0, 5)) five.push(await reserve(l, DEST, store2));
  ok('five fresh links may each send once to one phone', five.every((r) => r.allowed) && same(five.map((r) => r.held[2]), otpSendKeys(links[0], DEST).dest) && store2.live().length === 15);
  const sixth = await reserve(links[5], DEST, store2);
  ok('a sixth link to the same phone is refused by the destination cap, and its own floor and slot are released', seenOtp(sixth.reason) === 'OTP_DESTINATION_SEND_LIMIT' && store2.live().length === 15);
  const sixthAgain = await reserve(links[5], DEST, store2);
  ok('asked again at once, that link is told the destination reason — not "too soon" — because nothing of its own was left behind', sixthAgain.reason === 'OTP_DESTINATION_SEND_LIMIT');
  ok('another phone is another cap', (await reserve(links[5], otpDestinationKey('SMS', '6315550148'), store2)).allowed === true);
  tick(3601);
  ok('the destination cap slides too: an hour later the sixth link may send', (await reserve(links[6], DEST, store2)).allowed === true);

  // A store that cannot say is a refusal, never a pass.
  const store3 = fakeStore();
  store3.state.failAll = true;
  const down = await reserve(LINK, DEST, store3);
  ok('a store that cannot claim refuses by name and holds nothing', seenOtp(down.reason) === 'OTP_STORE_UNAVAILABLE' && down.allowed === false && store3.live().length === 0);
  store3.state.failAll = false;
  store3.state.failKeys = new Set(otpSendKeys(LINK, DEST).dest);
  const downLate = await reserve(LINK, DEST, store3);
  ok('a store that fails on the destination claim refuses and releases the floor and the slot it already held', downLate.reason === 'OTP_STORE_UNAVAILABLE' && store3.live().length === 0);
  store3.state.failKeys = new Set();
  store3.state.throwing = true;
  ok('a store that throws is a store that cannot say', (await reserve(LINK, DEST, store3)).reason === 'OTP_STORE_UNAVAILABLE');
  store3.state.throwing = false;
  ok('… and the same store, back, claims normally', (await reserve(LINK, DEST, store3)).allowed === true);

  // The burst the red team fired: in parallel, against one store.
  const store4 = fakeStore();
  const burst = await Promise.all(Array.from({ length: 8 }, () => reserve(LINK, DEST, store4)));
  ok('eight reservations fired at once on one link: exactly one is allowed, seven are too soon, three keys are held',
    burst.filter((r) => r.allowed).length === 1 && burst.filter((r) => r.reason === 'OTP_RESEND_TOO_SOON').length === 7 && store4.live().length === 3, burst.map((r) => r.reason).join(','));
  const store5 = fakeStore();
  const burst2 = await Promise.all(links.map((l) => reserve(l, DEST, store5)));
  ok('eight links fired at once at one phone: exactly five are allowed, three hit the destination cap, and the store holds five sends — what was delivered, no more',
    burst2.filter((r) => r.allowed).length === 5 && burst2.filter((r) => r.reason === 'OTP_DESTINATION_SEND_LIMIT').length === 3 &&
    store5.live().length === 15 && otpSendKeys(links[0], DEST).dest.every((k) => store5.live().includes(k)), burst2.map((r) => r.reason).join(','));
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
  r = await deliverOtp({ ...base, fetchImpl: provider(), buildMessage: ({ code }) => ({ subject: 'Your code', body: 'Enroll now and save on the best plan! Your code is ' + code }) });
  ok('a message that is marketing is blocked by the layer\'s rule before any provider is touched — the builder is injectable so this is observed, not assumed',
    seenOtp(r.reason) === 'MARKETING_CONTENT_BLOCKED' && r.sent === false && calls.length === 0 && !JSON.stringify(r).includes('482913'), JSON.stringify(r));
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
  ok('the letter wording is PENDING OWNER APPROVAL, with nobody, no date and no digest recorded',
    same(VERIFICATION_LETTER.approval, { status: 'PENDING_OWNER_APPROVAL', approvedBy: null, approvedOn: null, textDigest: null }));
  ok('the official contact is the published number', OFFICIAL_CONTACT.phoneDisplay === '1-855-720-8555' && OFFICIAL_CONTACT.phoneDigits === '8557208555');

  for (const lang of ['en', 'es']) {
    const t = VERIFICATION_LETTER[lang];
    const text = t.subject + '\n' + t.body.split('{caseRef}').join('CASE-20261101-7F3A');
    ok(`letter (${lang}) passes its own content rule`, letterContentProblem(text) === null, letterContentProblem(text));
    ok(`letter (${lang}) asks the person to call the published number and carries the reference`, text.includes('1-855-720-8555') && text.includes('CASE-20261101-7F3A'));
    ok(`letter (${lang}) names no plan, carrier, benefit, price or enrollment`, !/\b(plan|plans|planes|Humana|Aetna|UnitedHealthcare|premium|prima|benefit|beneficio|coverage|cobertura|enroll|inscr)/i.test(text) && !/\$/.test(text));
    ok(`letter (${lang}) discloses no name, no address and nothing about the request`, !/Jane|Dear|Estimad|street|calle|apartment|ZIP|appointment|cita|SOA|Scope/i.test(text));
    ok(`letter (${lang}) says what will never be asked for`, /(never ask|Nunca le pediremos)/.test(text));
  }
  ok('an empty letter is refused', seenOob(letterContentProblem('')) === 'LETTER_EMPTY' && letterContentProblem(null) === 'LETTER_EMPTY');
  ok('a marketing phrase is refused by the layer\'s one marketing rule', seenOob(letterContentProblem('Call 1-855-720-8555 — enroll now and save on the best plan!')) === 'LETTER_CONTENT_MARKETING');
  for (const [what, text] of [
    ['a plan', 'Your plan is waiting. Call 1-855-720-8555.'],
    ['a carrier', 'Humana asked us to confirm. Call 1-855-720-8555.'],
    ['a premium', 'Your premium is $0 a month. Call 1-855-720-8555.'],
    ['a dollar amount (red team: "$5 a month" passed)', 'Pay only $5 a month. Call 1-855-720-8555.'],
    ['a zero price (red team: "$0" passed)', 'Costs $0. Call 1-855-720-8555.'],
    ['a price with a space after the sign', 'Only $ 12 today. Call 1-855-720-8555.'],
    ['a price in USD', 'USD 5 per month. Call 1-855-720-8555.'],
    ['a price spelled out', 'Five dollars a month. Call 1-855-720-8555.'],
    ['a Spanish price spelled out', 'Cinco dólares al mes. Llame al 1-855-720-8555.'],
    ['a benefit', 'You may qualify for a benefit. Call 1-855-720-8555.'],
    ['Medicare Advantage', 'About your Medicare Advantage request, call 1-855-720-8555.'],
    ['Medigap', 'About your Medigap request, call 1-855-720-8555.'],
    ['a supplement', 'About your supplement request, call 1-855-720-8555.'],
    ['a Spanish supplement', 'Sobre su suplemento, llame al 1-855-720-8555.'],
    ['an HMO', 'Your HMO request was received. Call 1-855-720-8555.'],
    ['a PPO', 'Your PPO request was received. Call 1-855-720-8555.'],
    ['a PDP', 'Your PDP request was received. Call 1-855-720-8555.'],
    ['an MAPD', 'Your MAPD request was received. Call 1-855-720-8555.'],
    ['a giveback', 'A giveback may apply. Call 1-855-720-8555.'],
    ['a formulary', 'Check the formulary. Call 1-855-720-8555.'],
    ['Part D', 'About your Part D request, call 1-855-720-8555.'],
    ['Parte D', 'Sobre su Parte D, llame al 1-855-720-8555.'],
    ['an enrollment', 'Your enrollment was received. Call 1-855-720-8555.'],
    ['a Spanish plan', 'Su plan está listo. Llame al 1-855-720-8555.'],
    ['a Spanish benefit', 'Un beneficio para usted. Llame al 1-855-720-8555.'],
    ['a Spanish enrollment', 'Su inscripción fue recibida. Llame al 1-855-720-8555.'],
  ]) ok(`a letter naming ${what} is refused`, seenOob(letterContentProblem(text)) === 'LETTER_CONTENT_NAMES_PLAN_OR_PRICE', text);
  ok('"Medicare" alone (what will not be asked for) is allowed', letterContentProblem('We will never ask for your Medicare number. Call 1-855-720-8555.') === null);
  ok('a reference number is not a price, and "part" alone is not a plan part', letterContentProblem('Reference 5 of 12, in part. Call 1-855-720-8555.') === null);
  ok('a letter that does not point at the official number is refused', seenOob(letterContentProblem('We could not confirm a request. Please reply to this letter.')) === 'LETTER_CONTENT_NO_OFFICIAL_CHANNEL');

  // Approval is bound to the text: the digest covers the version and both languages, and nothing else.
  const DIGEST = letterTextDigest(VERIFICATION_LETTER);
  ok('the text digest is sha256 hex of the version and both languages', /^[0-9a-f]{64}$/.test(DIGEST) &&
    DIGEST === sha256(['CP-VL-2026-10-04-v1', VERIFICATION_LETTER.en.subject, VERIFICATION_LETTER.en.body, VERIFICATION_LETTER.es.subject, VERIFICATION_LETTER.es.body].join('\u0000')));
  ok('the digest moves with the version, the English and the Spanish text',
    letterTextDigest({ ...VERIFICATION_LETTER, version: 'v2' }) !== DIGEST && letterTextDigest({ ...VERIFICATION_LETTER, en: { ...VERIFICATION_LETTER.en, body: VERIFICATION_LETTER.en.body + ' ' } }) !== DIGEST &&
    letterTextDigest({ ...VERIFICATION_LETTER, es: { ...VERIFICATION_LETTER.es, subject: 'x' } }) !== DIGEST);
  ok('the digest does not move with the approval block — recording an approval does not change what was approved', letterTextDigest({ ...VERIFICATION_LETTER, approval: { status: 'APPROVED', approvedBy: 'Maria Lopez', approvedOn: '2026-10-20', textDigest: 'x' } }) === DIGEST);
  ok('the digest of nothing is still a digest, not a throw', /^[0-9a-f]{64}$/.test(letterTextDigest(null)) && letterTextDigest(null) !== DIGEST);

  const approved = (over = {}) => ({ ...VERIFICATION_LETTER, approval: { status: 'APPROVED', approvedBy: 'Maria Lopez', approvedOn: '2026-10-20', textDigest: DIGEST, ...over } });
  ok('the shipped wording is not released: not approved', seenOob(letterApprovalProblem(VERIFICATION_LETTER, { now: NOW })) === 'LETTER_TEXT_NOT_APPROVED');
  ok('an approval by an automation is not an approval', seenOob(letterApprovalProblem(approved({ approvedBy: 'claude' }), { now: NOW })) === 'LETTER_APPROVER_NOT_HUMAN' && letterApprovalProblem(approved({ approvedBy: 'Sofía' }), { now: NOW }) === 'LETTER_APPROVER_NOT_HUMAN');
  ok('an approval dated in the future, or not a calendar day, is not an approval',
    seenOob(letterApprovalProblem(approved({ approvedOn: '2026-12-01' }), { now: NOW })) === 'LETTER_APPROVAL_DATE_INVALID' && letterApprovalProblem(approved({ approvedOn: 'last week' }), { now: NOW }) === 'LETTER_APPROVAL_DATE_INVALID' &&
    letterApprovalProblem(approved({ approvedOn: null }), { now: NOW }) === 'LETTER_APPROVAL_DATE_INVALID');
  ok('a named person on a past day, for this text, approves', letterApprovalProblem(approved(), { now: NOW }) === null);
  ok('an approval that names no digest is not an approval of this text (red team: a forged approval block)', seenOob(letterApprovalProblem(approved({ textDigest: undefined }), { now: NOW })) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT' &&
    letterApprovalProblem(approved({ textDigest: null }), { now: NOW }) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT' && letterApprovalProblem(approved({ textDigest: 'f'.repeat(64) }), { now: NOW }) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT');
  ok('a text edited after its approval is unapproved text (red team: a later edit kept a once-granted approval)',
    letterApprovalProblem({ ...approved(), en: { ...VERIFICATION_LETTER.en, body: VERIFICATION_LETTER.en.body + ' PS: call us.' } }, { now: NOW }) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT' &&
    letterApprovalProblem({ ...approved(), es: { ...VERIFICATION_LETTER.es, subject: VERIFICATION_LETTER.es.subject + '!' } }, { now: NOW }) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT' &&
    letterApprovalProblem({ ...approved(), version: 'CP-VL-2026-10-04-v2' }, { now: NOW }) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT');
  ok('a template with no approval block is not approved', letterApprovalProblem({ en: {}, es: {} }, { now: NOW }) === 'LETTER_TEXT_NOT_APPROVED');

  const ENV = { [REVIEWERS_ENV]: 'Maria Lopez, Sawil Reyes' };
  const good = {
    client: { known: true, onFileSince: '2025-03-01T00:00:00Z' },
    address: { source: 'ON_FILE', verifiedAt: '2025-03-15T00:00:00Z', suppliedByRequest: false },
    request: { receivedAt: '2026-10-30T09:00:00Z', caseRef: 'CASE-20261030-7F3A' },
    actor: 'Maria Lopez', language: 'en', env: ENV, now: NOW,
  };

  // The governing letter, as shipped: refused for everybody once the person passes.
  ok('today the full case is refused because the wording is not approved — whoever decides', seenOob(mayIssueVerificationLetter(good).reason) === 'LETTER_TEXT_NOT_APPROVED' && mayIssueVerificationLetter({ ...good, actor: 'Sawil Reyes' }).reason === 'LETTER_TEXT_NOT_APPROVED');
  ok('the person is still judged first', seenOob(mayIssueVerificationLetter({ ...good, actor: 'svc_bot' }).reason) === 'ACTOR_NOT_HUMAN' && seenOob(mayIssueVerificationLetter({ ...good, actor: 'Jane Doe' }).reason) === 'REVIEWER_NOT_AUTHORIZED');
  const forged = { ...VERIFICATION_LETTER, approval: { status: 'APPROVED', approvedBy: 'Anyone Person', approvedOn: '2026-01-01', textDigest: DIGEST } };
  ok('red team: a spread copy of the letter with a forged approval — even one carrying the right digest — handed to the release function changes nothing: there is no template to hand it',
    mayIssueVerificationLetter({ ...good, template: forged }).reason === 'LETTER_TEXT_NOT_APPROVED' && mayIssueVerificationLetter({ ...good, template: approved() }).reason === 'LETTER_TEXT_NOT_APPROVED' &&
    mayIssueVerificationLetter({ ...good, letter: approved(), VERIFICATION_LETTER: approved() }).reason === 'LETTER_TEXT_NOT_APPROVED');
  ok('the governing object is untouched by all of that', VERIFICATION_LETTER.approval.status === 'PENDING_OWNER_APPROVAL' && VERIFICATION_LETTER.approval.textDigest === null);

  // The letter as it will be once the owner approves it: an instance whose frozen
  // declaration carries the approval, with this text's digest (the loader hook).
  const APPROVED = await approvedLetterModule(DIGEST);
  ok('the approved instance is the same text with the approval recorded for its digest', letterTextDigest(APPROVED.VERIFICATION_LETTER) === DIGEST &&
    same(APPROVED.VERIFICATION_LETTER.approval, { status: 'APPROVED', approvedBy: 'Maria Lopez', approvedOn: '2026-10-20', textDigest: DIGEST }) && APPROVED.letterApprovalProblem(APPROVED.VERIFICATION_LETTER, { now: NOW }) === null);
  const decide = (over = {}) => APPROVED.mayIssueVerificationLetter({ ...good, ...over });
  ok('the full case releases the letter, rendered, for a staff mailing', (() => { const d = decide(); return d.allowed === true && d.reason === 'OK' && d.mailing === 'STAFF_ACTION' && d.decidedBy === 'Maria Lopez' && d.decidedAt === NOW.toISOString() && d.letter.language === 'en' && d.letter.body.includes('CASE-20261030-7F3A') && !d.letter.body.includes('{caseRef}') && d.letter.version === VERIFICATION_LETTER.version && d.letter.caseRef === 'CASE-20261030-7F3A'; })(), JSON.stringify(decide()));
  ok('the released English text IS the governing text with the reference filled in', decide().letter.subject === VERIFICATION_LETTER.en.subject && decide().letter.body === VERIFICATION_LETTER.en.body.split('{caseRef}').join('CASE-20261030-7F3A'));
  ok('the Spanish letter renders the same way', decide({ language: 'es' }).letter.body === VERIFICATION_LETTER.es.body.split('{caseRef}').join('CASE-20261030-7F3A') && /Clear Point Senior Advisors al 1-855-720-8555/.test(decide({ language: 'es' }).letter.body));
  ok('the released letter passes the content rule', (() => { const d = decide(); return d.allowed === true && letterContentProblem(d.letter.subject + '\n' + d.letter.body) === null; })());
  ok('decision: an automation may not decide', decide({ actor: 'svc_bot' }).reason === 'ACTOR_NOT_HUMAN' && decide({ actor: 'Clara' }).reason === 'ACTOR_NOT_HUMAN');
  ok('decision: a person not on the owner\'s list may not decide', decide({ actor: 'Jane Doe' }).reason === 'REVIEWER_NOT_AUTHORIZED');
  ok('decision: with no list configured, nobody may decide (fail-closed)', seenOob(decide({ env: {} }).reason) === 'REVIEWERS_NOT_CONFIGURED');
  ok('decision: nobody at all may decide', seenOob(decide({ actor: '' }).reason) === 'ACTOR_MISSING');
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
  ok('decision: the rendered text is checked at release — a case reference that names a carrier or a plan is refused there',
    decide({ request: { ...good.request, caseRef: 'HUMANA-20261030' } }).reason === 'LETTER_CONTENT_NAMES_PLAN_OR_PRICE' && decide({ request: { ...good.request, caseRef: 'PLAN-20261030' } }).reason === 'LETTER_CONTENT_NAMES_PLAN_OR_PRICE');
  ok('the decision mutates none of its inputs', good.address.suppliedByRequest === false && VERIFICATION_LETTER.approval.status === 'PENDING_OWNER_APPROVAL' && APPROVED.VERIFICATION_LETTER.approval.status === 'APPROVED');

  // The same approval recorded for ANOTHER digest — the owner's commit approving a text that was then edited — releases nothing.
  const STALE = await approvedLetterModule('f'.repeat(64));
  ok('an approval recorded for another digest releases nothing: the release function itself binds approval to text', seenOob(STALE.mayIssueVerificationLetter(good).reason) === 'LETTER_APPROVAL_NOT_FOR_THIS_TEXT' && STALE.VERIFICATION_LETTER.approval.status === 'APPROVED');
}

// ── 7. The verification call ─────────────────────────────────────────────────
{
  // A permission captured FOR the verification call: its stated scope is the purpose.
  const VERIFY_CALLBACK = grant('CALLBACK_CONTACT_PERMISSION', { channel: 'PHONE', scope: VERIFICATION_CALL_PURPOSE });
  const good = { requestPhone: '+1 (631) 555-0147', dialPhone: PHONE, callbackConsent: VERIFY_CALLBACK, doNotContact: false, caller: 'Maria Lopez', callerMode: 'HUMAN', purpose: VERIFICATION_CALL_PURPOSE };
  const call = (over = {}) => mayPlaceVerificationCall({ ...good, ...over });
  ok('the purpose vocabulary is one value', VERIFICATION_CALL_PURPOSE === 'SECURITY_REQUEST_VERIFICATION');
  ok('a human may call the request number for security verification, on a contact basis whose stated scope is that verification', (() => { const d = call(); return d.allowed === true && d.purpose === 'SECURITY_REQUEST_VERIFICATION' && d.planMarketing === false && d.script === 'SECURITY_VERIFICATION_ONLY' && d.contactBasis === 'CALLBACK_CONSENT_GRANTED' && d.consentScope === 'SECURITY_REQUEST_VERIFICATION' && d.caller === 'Maria Lopez'; })(), JSON.stringify(call()));
  ok('red team: the production web consent, scoped to plan discussion, does NOT authorise a security verification call (CT-07 — the purpose reaches the scope rule)',
    (() => { const d = call({ callbackConsent: grant('CALLBACK_CONTACT_PERMISSION', { scope: 'DISCUSS_MEDICARE_PLAN_OPTIONS' }) }); return d.allowed === false && d.reason === 'PURPOSE_OUTSIDE_CONSENT_SCOPE' && !('script' in d); })());
  ok('nor does a consent scoped to anything else', call({ callbackConsent: CALLBACK }).reason === 'PURPOSE_OUTSIDE_CONSENT_SCOPE' && call({ callbackConsent: grant('CALLBACK_CONTACT_PERMISSION', { scope: 'PLAN_MARKETING' }) }).reason === 'PURPOSE_OUTSIDE_CONSENT_SCOPE');
  ok('call: a marketing purpose is refused by name', seenOob(call({ purpose: 'PLAN_MARKETING' }).reason) === 'PURPOSE_NOT_VERIFICATION' && call({ purpose: 'DISCUSS_MEDICARE_PLAN_OPTIONS' }).reason === 'PURPOSE_NOT_VERIFICATION');
  ok('call: no purpose is no call', call({ purpose: undefined }).reason === 'PURPOSE_NOT_VERIFICATION');
  ok('call: an automated or AI caller is refused', seenOob(call({ callerMode: 'AI_AUTOMATED' }).reason) === 'CALLER_NOT_HUMAN' && call({ callerMode: 'HUMAN', caller: 'Sofía' }).reason === 'CALLER_NOT_HUMAN' && call({ caller: 'svc_dialer' }).reason === 'CALLER_NOT_HUMAN' && call({ callerMode: undefined }).reason === 'CALLER_NOT_HUMAN');
  ok('call: the request must carry a number', seenOob(call({ requestPhone: '' }).reason) === 'REQUEST_NUMBER_MISSING' && call({ requestPhone: '555-0147' }).reason === 'REQUEST_NUMBER_MISSING');
  ok('call: only THE SAME number — another number is refused', seenOob(call({ dialPhone: '6315550148' }).reason) === 'NUMBER_NOT_THE_REQUEST_NUMBER' && call({ dialPhone: '' }).reason === 'NUMBER_NOT_THE_REQUEST_NUMBER');
  ok('call: formatting of the number does not matter', call({ dialPhone: '1-631-555-0147' }).allowed === true);
  ok('call: an unknown do-not-contact status is a refusal (the list must have been consulted)', call({ doNotContact: undefined }).reason === 'DO_NOT_CONTACT_STATUS_UNKNOWN');
  ok('call: a do-not-contact wins', call({ doNotContact: true }).reason === 'DO_NOT_CONTACT');
  ok('call: no contact basis, no call', call({ callbackConsent: null }).reason === 'NO_CALLBACK_CONSENT');
  ok('call: §6 — an SOA signature or a recording notice is not a contact basis, whatever its scope says', call({ callbackConsent: grant('SCOPE_OF_APPOINTMENT', { scope: VERIFICATION_CALL_PURPOSE }) }).reason === 'NO_CALLBACK_CONSENT' && call({ callbackConsent: grant('RECORDING_NOTICE', { scope: VERIFICATION_CALL_PURPOSE }) }).reason === 'NO_CALLBACK_CONSENT');
  ok('call: a revoked basis is no basis', call({ callbackConsent: revokeConsent(VERIFY_CALLBACK, { via: 'PHONE' }) }).reason === 'NO_CALLBACK_CONSENT');
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
  ok('the sections above reached every OTP refusal there is — the marketing block and the unavailable store included',
    Object.values(OTP_REFUSAL).every((r) => otpReasons.has(r)), Object.values(OTP_REFUSAL).filter((r) => !otpReasons.has(r)).join(','));
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
  ok('otp.js imports only from the layer and node:crypto', [...OTP.matchAll(/from '([^']+)'/g)].every((m) => /^(node:crypto|\.\/[\w-]+\.js)$/.test(m[1])));
  ok('out-of-band-verification.js imports only from the layer and node:crypto (for the digest), and never logs',
    [...OOB.matchAll(/from '([^']+)'/g)].every((m) => /^(node:crypto|\.\/[\w-]+\.js)$/.test(m[1])) && same([...OOB.matchAll(/from 'node:([^']+)'/g)].map((m) => m[1]), ['crypto']) && !/console\./.test(OOB));
  ok('the GET → decide → SET send plan is gone from the layer and from both handlers', !/otpSendPlan|recordDestinationSend|linkSendProblem|destinationSendProblem/.test(OTP + TOK + STAT));
  ok('both handlers reserve with the store\'s atomic claim and release, on an anchored line',
    line(/var plan = await reserveOtpSend\(\{ linkStoreKey: link\.storeKey, destinationKey: otpDestinationKey\(factor\.otpChannel, dest\.to\), claim: claimRecord, release: deleteRecord \}\);/).test(TOK) &&
    line(/var plan = await reserveOtpSend\(\{ linkStoreKey: storeKeyFor\(ptoken\), destinationKey: otpDestinationKey\(otpChannel, dest\.to\), claim: claimRecord, release: deleteRecord \}\);/).test(STAT));
  ok('both handlers answer 503 when the store cannot claim (unreachable through the memory store, hence anchored)',
    line(/if \(plan\.reason === OTP_REFUSAL\.OTP_STORE_UNAVAILABLE\) return res\.status\(503\)\.json\(\{ error: plan\.reason \}\);/).test(TOK) &&
    line(/if \(plan\.reason === OTP_REFUSAL\.OTP_STORE_UNAVAILABLE\) return res\.status\(503\)\.json\(\{ exists: true, resent: false, reason: plan\.reason \}\);/).test(STAT));
  ok('the issuer stores the records before it delivers (the resend path is observed doing so in section 11)',
    TOK.indexOf('var w2 = await setRecord(link.storeKey, link.record, SOA_TOKEN_TTL_SEC);') > 0 && TOK.indexOf('var w2 = await setRecord(link.storeKey, link.record, SOA_TOKEN_TTL_SEC);') < TOK.indexOf('delivery = await deliverOtp('));
  ok('soa-token.js no longer hard-codes the factor kind, in either quote', !/secondFactorKind: ['"]PHONE_LAST4['"]/.test(TOK) && line(/var factor = otpFactorForIssue\(\{ channel: 'SMS', consent: OTP_CONSENT_BASIS, env: process\.env \}\);/).test(TOK));
  ok('soa-token.js takes its consent lookup as an in-process dependency, starts from null, and names no body field for it',
    line(/export default async function handler\(req, res, deps\) \{/).test(TOK) && line(/var OTP_CONSENT_BASIS = null;/).test(TOK) &&
    line(/var consentLookup = deps && typeof deps\.otpConsentBasis === 'function' \? deps\.otpConsentBasis : null;/).test(TOK) && !/body\.(consent|callbackConsent|permission)/.test(TOK));
  ok('the status handler and the verifier share one attempt limit', line(/if \(factorLocked\(prec\)\) \{/).test(STAT) && line(/if \(factorLocked\(record, \{ maxAttempts \}\)\) \{/).test(LINK));
  ok('the page asks for a six-digit code on an OTP link and can request a new one', /factorRequired === 'OTP'/.test(PAGE) && /resendCode: true/.test(PAGE) && /one-time-code/.test(PAGE) && /code_stale/.test(PAGE));
}

// ── 11. The two handlers, driven in process ──────────────────────────────────
// The handlers are gated off (SOA_ENABLED=false, pinned by test-cp-findings);
// the loader hook above rewrites that ONE declaration to true in memory for the
// two handler modules as they load; the files on disk are untouched.
{
  Object.assign(process.env, FULL_ENV);
  const provider = [];
  let providerStatus = 200;
  // What the provider double sees in the STORE at the moment it is called: the
  // claims must be held and the records written before any code goes out.
  let onProvider = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u === 'https://otp.invalid/send' || u === 'https://otp.invalid/mail') {
      const call = { url: u, body: JSON.parse(opts.body), auth: opts.headers && opts.headers.Authorization, seen: onProvider ? await onProvider() : null };
      provider.push(call);
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
  const run = async (fn, body, method, url, deps) => {
    const res = mkRes(); let threw = null;
    try { await fn(mkReq(body, method, url), res, deps); } catch (e) { threw = String((e && e.stack) || e); }
    return { status: res.statusCode, payload: res.payload, retryAfter: res.getHeader('Retry-After'), threw };
  };
  const status = (token) => run(soaStatus, null, 'GET', '/api/soa-status?token=' + token);
  const verify = (token, factor) => run(soaStatus, { token, factor });
  const resend = (token, extra = {}) => run(soaStatus, { token, resendCode: true, ...extra });
  const LEAD_BODY = { fullName: 'Jane Q Public', phone: PHONE, email: '', zip: '11717', language: 'en' };
  const issue = (deps, body = LEAD_BODY) => run(soaToken, body, 'POST', '/api/soa-token', deps);
  /** The i-th provider call, or an empty one — so an assertion about a call that never happened FAILS by name instead of crashing the suite. */
  const sent = (i) => provider[i] || { url: null, body: { to: null, body: '' }, auth: null, seen: null };
  const codeFrom = (call) => (String(call && call.body ? call.body.body : '').match(/\b(\d{6})\b/) || [])[1] || null;
  /** A body that records every key a handler asks it for, and answers decoys for names it must never ask. */
  const spyBody = (own, decoys) => {
    const reads = new Set();
    const body = new Proxy({ ...own }, { get(t, k) { if (typeof k === 'string') reads.add(k); return Object.prototype.hasOwnProperty.call(decoys, k) ? decoys[k] : t[k]; } });
    return { body, reads };
  };
  const INCIDENTAL = ['toJSON', 'then'];
  const onlyRead = (reads, allowed) => [...reads].filter((k) => !allowed.includes(k) && !INCIDENTAL.includes(k));
  const WITH_CONSENT = { otpConsentBasis: async () => CALLBACK };

  const destKey = otpDestinationKey('SMS', PHONE);
  const keysOf = (linkStoreKey) => otpSendKeys(linkStoreKey, destKey);
  const held = async (key) => (await getRecord(key)) !== null;
  const destHeld = async () => { let n = 0; for (const k of keysOf('soa-link:' + '0'.repeat(64)).dest) if (await held(k)) n += 1; return n; };
  /** Hold the claims a link with these past sends would hold: slots inside the window, the floor if the last send is inside it. */
  const hold = async (linkStoreKey, times) => {
    const k = keysOf(linkStoreKey);
    const nowMs = Date.now();
    const inWindow = times.map((t) => Date.parse(t)).filter((t) => nowMs - t < OTP_POLICY.windowSec * 1000).sort((a, b) => a - b);
    for (let i = 0; i < inWindow.length && i < k.link.length; i++) await setRecord(k.link[i], { at: new Date(inWindow[i]).toISOString() }, Math.ceil(OTP_POLICY.windowSec - (nowMs - inWindow[i]) / 1000));
    const last = inWindow.length ? inWindow[inWindow.length - 1] : null;
    if (last !== null && nowMs - last < OTP_POLICY.minResendIntervalSec * 1000) await setRecord(k.floor, { at: new Date(last).toISOString() }, Math.ceil(OTP_POLICY.minResendIntervalSec - (nowMs - last) / 1000));
  };

  // Seed an OTP link the way the issuer would: the lead record (phone on file),
  // the link record, and the claims its sends hold — all in the memory store.
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
    if (kind === 'OTP') await hold(link.storeKey, record.otp.sends);
    return { token: link.token, code, ref, key: link.storeKey, keys: keysOf(link.storeKey) };
  };
  const linkOf = (key) => getRecord(key);
  const fresh = async () => { LOGS.length = 0; provider.length = 0; providerStatus = 200; onProvider = null; for (const k of keysOf('soa-link:' + '0'.repeat(64)).dest) await deleteRecord(k); };

  // (a) The issuer in production: no consent lookup is wired, so the factor stays PHONE_LAST4 and nothing is sent.
  await fresh();
  const issued = await issue(undefined);
  ok('handler: with the OTP channel configured but no consent lookup, the issuer keeps today\'s factor', issued.status === 200 && issued.payload.factorRequired === 'PHONE_LAST4' && !('codeSent' in issued.payload) && !issued.threw, JSON.stringify(issued));
  ok('handler: no code went to any provider', provider.length === 0);
  ok('handler: the issue audit records WHY the code was not offered', audited('SOA_LINK_ISSUED', 'OK').some((a) => a.details && a.details.factor === 'PHONE_LAST4' && a.details.factorReason === 'NO_CONTACT_PERMISSION'));
  ok('handler: the issued link is a last-4 link with no otp block', (await linkOf(storeKeyFor(issued.payload.token))).secondFactorKind === 'PHONE_LAST4' && !('otp' in (await linkOf(storeKeyFor(issued.payload.token)))));
  const spyA = spyBody(LEAD_BODY, { callbackConsent: CALLBACK, consent: CALLBACK, permission: CALLBACK, consentBasis: CALLBACK, otpConsentBasis: CALLBACK, contactPermission: CALLBACK });
  const issuedSpy = await issue(undefined, spyA.body);
  ok('handler: the issuer asks the body for the lead fields and NOTHING else — a consent offered under any name is never read, so it changes nothing',
    issuedSpy.status === 200 && issuedSpy.payload.factorRequired === 'PHONE_LAST4' && provider.length === 0 && onlyRead(spyA.reads, ['fullName', 'phone', 'email', 'zip', 'language', 'leadSource', 'appointmentId']).length === 0, [...spyA.reads].join(','));
  const issuedBad = await issue({ otpConsentBasis: async () => { throw new Error('crm down'); } });
  ok('handler: a consent lookup that fails is no consent — the factor stays and nothing is sent', issuedBad.status === 200 && issuedBad.payload.factorRequired === 'PHONE_LAST4' && provider.length === 0 && audited('SOA_LINK_ISSUED', 'OK').some((a) => a.details.factorReason === 'NO_CONTACT_PERMISSION'));
  const issuedJunk = await issue({ otpConsentBasis: async () => 'yes' });
  ok('handler: a lookup that answers something other than a consent record is no consent', issuedJunk.payload.factorRequired === 'PHONE_LAST4' && provider.length === 0);

  // (b) The issuer with a consent lookup it is GIVEN: the one-time-code branch, observed.
  await fresh();
  onProvider = async () => ({ destHeld: await destHeld() });
  const otpIssue = await issue(WITH_CONSENT);
  ok('handler: with a recorded permission the issuer mints an OTP link and says a code went out — never the code, never the number',
    otpIssue.status === 200 && otpIssue.payload.factorRequired === 'OTP' && otpIssue.payload.codeSent === true && !otpIssue.threw && !JSON.stringify(otpIssue.payload).includes(PHONE) && !/\b\d{6}\b/.test(JSON.stringify(otpIssue.payload)), JSON.stringify(otpIssue));
  ok('handler: the code went to the phone the ISSUER wrote on the lead record', provider.length === 1 && sent(0).body.to === PHONE && sent(0).url === 'https://otp.invalid/send' && sent(0).auth === 'Bearer t-sms');
  ok('handler: the destination claim was held BEFORE the provider was called', sent(0).seen && sent(0).seen.destHeld === 1);
  const issuedKey = storeKeyFor(otpIssue.payload.token);
  const issuedLink = await linkOf(issuedKey);
  ok('handler: the stored link is an OTP link with a hash, one send, and the consent basis the issuer verified', issuedLink.secondFactorKind === 'OTP' && /^[0-9a-f]{64}$/.test(issuedLink.otp.hash) && issuedLink.otp.sends.length === 1 && same(issuedLink.otp.consentBasis, CALLBACK) && issuedLink.secondFactorHash === null);
  ok('handler: the issue holds the floor and the link\'s first slot', (await held(keysOf(issuedKey).floor)) && (await held(keysOf(issuedKey).link[0])) && !(await held(keysOf(issuedKey).link[1])));
  ok('handler: the issue is audited as OTP, SENT, one send, without the code or the phone', audited('OTP_ISSUED', 'SENT').length === 1 && audited('OTP_ISSUED', 'SENT')[0].details.sendsOnLink === 1 && audited('SOA_LINK_ISSUED', 'OK').some((a) => a.details.factor === 'OTP' && a.details.factorReason === 'OK') && !LOGS.some((l) => l.includes(PHONE) || l.includes(codeFrom(sent(0)))));
  const tooSoonIssued = await resend(otpIssue.payload.token);
  ok('handler: a resend right after the issue is too soon — the issue took the floor', tooSoonIssued.status === 429 && tooSoonIssued.payload.reason === 'OTP_RESEND_TOO_SOON' && tooSoonIssued.retryAfter === '60' && provider.length === 1);
  const issuedVerify = await verify(otpIssue.payload.token, codeFrom(sent(0)));
  ok('handler: the code the provider received verifies the issued link as channel-verified', issuedVerify.status === 200 && issuedVerify.payload.verification === 'CONTACT_CHANNEL_VERIFIED' && issuedVerify.payload.lead.fullName === 'Jane Q Public', JSON.stringify(issuedVerify));
  for (let i = 0; i < 4; i++) ok(`handler: issue ${i + 2} of 5 for the same phone goes out`, (await issue(WITH_CONSENT)).payload.codeSent === true);
  const sixth = await issue(WITH_CONSENT);
  ok('handler: the sixth issue for one phone inside the window is refused by the destination cap, mints nothing and sends nothing',
    sixth.status === 429 && sixth.payload.error === 'OTP_DESTINATION_SEND_LIMIT' && sixth.retryAfter === '3600' && !('token' in sixth.payload) && provider.length === 5 && (await destHeld()) === 5 && audited('OTP_SEND_REFUSED', 'OTP_DESTINATION_SEND_LIMIT').length === 1, JSON.stringify(sixth));

  // (b') Eight issues for one phone, fired at once (the red team's burst).
  await fresh();
  const burstIssue = await Promise.all(Array.from({ length: 8 }, () => issue(WITH_CONSENT)));
  ok('handler: eight parallel issues for one phone — exactly five mint and send, three are refused by the destination cap, and the store holds exactly five',
    burstIssue.filter((r) => r.status === 200 && r.payload.codeSent === true).length === 5 && burstIssue.filter((r) => r.status === 429 && r.payload.error === 'OTP_DESTINATION_SEND_LIMIT').length === 3 &&
    provider.length === 5 && (await destHeld()) === 5 && audited('OTP_ISSUED', 'SENT').length === 5 && audited('OTP_SEND_REFUSED').length === 3, burstIssue.map((r) => r.status + ':' + JSON.stringify(r.payload)).join(' | '));

  // (c) An OTP link: what possession shows, and the code path through the status endpoint.
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

  // (d) A last-4 link through the same endpoint: factor matched, no channel claim.
  await fresh();
  const F = await seed({ kind: 'PHONE_LAST4' });
  const rightF = await verify(F.token, '0147');
  ok('handler: a last-4 link still verifies, and the response says LINK_FACTOR_MATCHED', rightF.status === 200 && rightF.payload.verification === 'LINK_FACTOR_MATCHED', JSON.stringify(rightF));
  ok('handler: the release of a last-4 link is audited as factor-matched, not channel-verified', audited('SOA_VIEWED', 'PREFILL_RELEASED').some((a) => a.actor === 'beneficiary:factor-matched' && a.details.claim === 'LINK_FACTOR_MATCHED') && !audited('SOA_VIEWED', 'PREFILL_RELEASED').some((a) => a.actor === 'beneficiary:channel-verified'));
  const resendF = await resend(F.token);
  ok('handler: a resend on a last-4 link is refused by name', resendF.status === 400 && resendF.payload.reason === 'FACTOR_NOT_OTP' && provider.length === 0);

  // (e) Resend: the destination is the lead record's phone, never the body's; the claims precede delivery; the old code dies; the caps bite.
  await fresh();
  const now = new Date();
  const B = await seed({ issuedAt: plus(now, -120) });
  onProvider = async () => ({ linkSends: (await linkOf(B.key)).otp.sends.length, floor: await held(B.keys.floor), slot1: await held(B.keys.link[1]), dest0: await held(B.keys.dest[0]) });
  const spyB = spyBody({ token: B.token, resendCode: true }, { to: '+15550000000', phone: '5550000000', email: 'attacker@example.com', destination: '5550000000', number: '5550000000', channel: 'EMAIL', otpChannel: 'EMAIL' });
  const resentB = await run(soaStatus, spyB.body);
  ok('handler: a resend issues and delivers a new code', resentB.status === 200 && resentB.payload.resent === true && resentB.payload.reason === 'OK' && provider.length === 1, JSON.stringify(resentB));
  ok('handler: the code went to the phone ON THE LEAD RECORD — the handler asked the body for the token and the resend flag and for nothing else',
    sent(0).body.to === PHONE && sent(0).url === 'https://otp.invalid/send' && sent(0).auth === 'Bearer t-sms' && onlyRead(spyB.reads, ['token', 'factor', 'resendCode']).length === 0, [...spyB.reads].join(','));
  ok('handler: at the moment the provider was called, the link already carried the new send and the floor, the link slot and the destination slot were already held',
    same(sent(0).seen, { linkSends: 2, floor: true, slot1: true, dest0: true }), JSON.stringify(sent(0).seen));
  ok('handler: the response carries neither the code nor the destination', !JSON.stringify(resentB.payload).includes(PHONE) && !JSON.stringify(resentB.payload).match(/\b\d{6}\b/));
  const newCodeB = codeFrom(sent(0));
  ok('handler: the resend is counted on the link (two sends)', (await linkOf(B.key)).otp.sends.length === 2 && /^\d{6}$/.test(newCodeB));
  ok('handler: the resend is counted on the destination — one slot held, the next free', (await destHeld()) === 1 && !(await held(B.keys.dest[1])));
  ok('handler: the resend is audited without the code or the phone', audited('OTP_ISSUED', 'SENT').length === 1 && !LOGS.some((l) => l.includes(newCodeB) || l.includes(PHONE)));
  const oldB = await verify(B.token, B.code);
  ok('handler: the previous code no longer verifies', oldB.status === 401 && oldB.payload.reason === 'OTP_MISMATCH');
  const tooSoon = await resend(B.token);
  ok('handler: a second resend inside the floor is refused, with Retry-After, and nothing is sent', tooSoon.status === 429 && tooSoon.payload.reason === 'OTP_RESEND_TOO_SOON' && tooSoon.retryAfter === '60' && provider.length === 1, JSON.stringify(tooSoon));
  ok('handler: the refused resend is audited with its reason', audited('OTP_SEND_REFUSED', 'OTP_RESEND_TOO_SOON').length === 1);
  const newB = await verify(B.token, newCodeB);
  ok('handler: the new code verifies', newB.status === 200 && newB.payload.verification === 'CONTACT_CHANNEL_VERIFIED');

  // (e') Eight resends on one link, fired at once (the red team's burst).
  await fresh();
  const B2 = await seed({ issuedAt: plus(new Date(), -120) });
  const burst = await Promise.all(Array.from({ length: 8 }, () => resend(B2.token)));
  ok('handler: eight parallel resends on one link — exactly one delivers, seven are too soon, the link counts two sends and the store holds one destination send',
    burst.filter((r) => r.status === 200 && r.payload.resent === true).length === 1 && burst.filter((r) => r.status === 429 && r.payload.reason === 'OTP_RESEND_TOO_SOON').length === 7 &&
    provider.length === 1 && (await linkOf(B2.key)).otp.sends.length === 2 && (await destHeld()) === 1 && audited('OTP_ISSUED', 'SENT').length === 1 && audited('OTP_SEND_REFUSED', 'OTP_RESEND_TOO_SOON').length === 7,
    burst.map((r) => r.status + ':' + (r.payload && r.payload.reason)).join(','));
  ok('handler: after the burst the link holds its floor and two slots, the third is free', (await held(B2.keys.floor)) && (await held(B2.keys.link[0])) && (await held(B2.keys.link[1])) && !(await held(B2.keys.link[2])));

  await fresh();
  const C = await seed({ sends: [plus(now, -600), plus(now, -400), plus(now, -200)].map((d) => d.toISOString()) });
  const limitC = await resend(C.token);
  ok('handler: a link that sent three codes in the window gets no fourth', limitC.status === 429 && limitC.payload.reason === 'OTP_LINK_SEND_LIMIT' && limitC.retryAfter === '3600' && provider.length === 0, JSON.stringify(limitC));
  ok('handler: the refused fourth left no floor behind, so asking again says the same true thing', !(await held(C.keys.floor)) && (await resend(C.token)).payload.reason === 'OTP_LINK_SEND_LIMIT');

  await fresh();
  for (const k of keysOf('soa-link:' + '0'.repeat(64)).dest) await setRecord(k, { at: now.toISOString() }, 3600);
  const D = await seed({ issuedAt: plus(now, -120) });
  const limitD = await resend(D.token);
  ok('handler: a phone that received five codes in the window gets no sixth, from any link', limitD.status === 429 && limitD.payload.reason === 'OTP_DESTINATION_SEND_LIMIT' && limitD.retryAfter === '3600' && provider.length === 0 && audited('OTP_SEND_REFUSED', 'OTP_DESTINATION_SEND_LIMIT').length === 1, JSON.stringify(limitD));
  ok('handler: the refused resend did not touch the link\'s send log, and released the floor and the slot it had taken', (await linkOf(D.key)).otp.sends.length === 1 && !(await held(D.keys.floor)) && !(await held(D.keys.link[1])));
  ok('handler: asked again, that link is told the destination reason, not "too soon"', (await resend(D.token)).payload.reason === 'OTP_DESTINATION_SEND_LIMIT');

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
    resentH.status === 200 && resentH.payload.resent === false && resentH.payload.reason === 'PROVIDER_REJECTED' && (await linkOf(H.key)).otp.sends.length === 2 && (await held(H.keys.link[1])) && (await status(H.token)).status === 200, JSON.stringify(resentH));

  // (f) The endpoint's own guards still front the resend action.
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

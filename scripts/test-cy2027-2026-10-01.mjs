// scripts/test-cy2027-2026-10-01.mjs
//
// CY2027 COMPLIANCE LAYER — behavioural suite for api/_lib/cy2027/*.
//
// Written against the owner-approved CY2027 master execution prompt and the
// three Master SOA templates (NY/NJ/CT). The approved customer-facing strings
// are asserted VERBATIM here as a second, independent copy of the acceptance
// criteria: if someone edits the wording in soa-text.js, the parity guard
// catches the un-pinned digest and these assertions say exactly which sentence
// moved.
//
// Every gate is tested in BOTH directions — that it blocks what it must block,
// and that it still permits what must keep working.

import {
  SOA_CATEGORIES, AUTHORIZING_CATEGORY_CODES, ALL_CATEGORY_CODES, SOA_TEXT, SOA_SCRIPT_VERSION,
  categoryByCode, categoryText, soaTitle, readBackLines, approvedTextPayload, APPROVED_TEXT_DIGEST,
} from '../api/_lib/cy2027/soa-text.js';
import {
  STATE_RULESETS, SUPPORTED_STATES, resolveStateRuleset, zipStateConsistency, resolveCounty, hasCountyDataset, setCountyDataset,
} from '../api/_lib/cy2027/state-rules.js';
import {
  CMS_RULESET_2026, CMS_RULESET_2027, activePlanYear, resolveRuleset, rulesetForAudit, CY2027_MARKETING_START_UTC,
} from '../api/_lib/cy2027/rulesets.js';
import {
  SOA_STATUS, SOA_METHOD, methodIsWritten, partitionSelection, createSoaInstance, completeSoaInstance,
  superseded, revokeSoaInstance, coversCategory, requiresScopeUpdate, marketingGate, requiresNewInstance,
} from '../api/_lib/cy2027/soa-instance.js';
import {
  CONSENT_STATUS, createConsent, revokeConsent, classifyReply, isAffirmative, assertNoCrossInference, mayPlaceOutbound,
} from '../api/_lib/cy2027/consent.js';
import {
  LEAD_TRUST_STATE, CHANNEL_VERIFICATION, IDENTITY_VERIFICATION, evaluateTrust, trustCapabilities,
  assertSignalAllowed, assertIdentityFactorAllowed, buildSecurityReviewTask, resolveSecurityReview,
} from '../api/_lib/cy2027/trust.js';
import { RECORD_CLASS, mayPurge, applyHold, releaseHold, callRetentionRequirement } from '../api/_lib/cy2027/retention.js';
import { canDiscussCarrier, overlayInventory, assertPrivateContext, OVERLAY_STATUS } from '../api/_lib/cy2027/carrier-overlay.js';
import { tpmoDisclaimerText, activeContractYearVariant, hasVerifiedTpmoCounts, assertDisclaimerSignable, TPMO_DISCLAIMER_CONFIG } from '../api/_lib/cy2027/tpmo.js';
import { integrityHash, buildEvidenceRecord, verifyEvidence, auditEvent, redactForLog, renderTextSnapshot } from '../api/_lib/cy2027/evidence.js';
import {
  issueLink, storeKeyFor, checkLink, verifySecondFactor, linkDisclosure, recordView, consumeLink, revokeLink, mayReissue,
} from '../api/_lib/cy2027/secure-link.js';
import { createHash } from 'node:crypto';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        expected a throw, got none'); }
  catch (e) { if (!re || re.test(e.message)) passed++; else failures.push(label + '\n        wrong error: ' + e.message); }
};

// ── 1. Approved text fidelity (verbatim from the Master SOA templates) ───────
{
  ok('digest is pinned and current',
    APPROVED_TEXT_DIGEST === 'sha256:' + createHash('sha256').update(approvedTextPayload(), 'utf8').digest('hex'),
    're-pin APPROVED_TEXT_DIGEST in soa-text.js');

  ok('exactly 3 authorizing categories', AUTHORIZING_CATEGORY_CODES.length === 3, String(AUTHORIZING_CATEGORY_CODES));
  ok('exactly 4 options total', ALL_CATEGORY_CODES.length === 4, String(ALL_CATEGORY_CODES));
  ok('"I am not sure" authorizes nothing', categoryByCode('UNSURE_DISCUSS_PROCESS').authorizes === false);

  ok('EN MA-only label verbatim',
    categoryText('MA_NO_RX', 'en').label === 'Medicare Advantage plan without integrated prescription drug coverage');
  ok('EN MA-only description verbatim',
    categoryText('MA_NO_RX', 'en').description ===
    'A private Medicare health plan that provides Medicare-covered medical and hospital services but does not include integrated Medicare prescription drug coverage.');
  ok('EN MA-PD label verbatim',
    categoryText('MA_WITH_RX', 'en').label === 'Medicare Advantage plan with prescription drug coverage');
  ok('EN PDP label verbatim',
    categoryText('STANDALONE_RX', 'en').label === 'Standalone Medicare prescription drug plan');
  ok('EN PDP description verbatim',
    categoryText('STANDALONE_RX', 'en').description ===
    'A separate Medicare prescription drug plan for people who need Part D drug coverage apart from a Medicare Advantage plan.');
  ok('EN unsure label verbatim',
    categoryText('UNSURE_DISCUSS_PROCESS', 'en').label === 'I am not sure / I prefer to discuss the process first');

  ok('ES MA-only label verbatim',
    categoryText('MA_NO_RX', 'es').label === 'Plan Medicare Advantage sin cobertura integrada de medicamentos recetados');
  ok('ES PDP label verbatim',
    categoryText('STANDALONE_RX', 'es').label === 'Plan independiente de Medicare para medicamentos recetados');
  ok('ES unsure label verbatim',
    categoryText('UNSURE_DISCUSS_PROCESS', 'es').label === 'No estoy seguro / prefiero hablar primero sobre el proceso');

  ok('EN intro verbatim', SOA_TEXT.en.intro ===
    'This form documents only the Medicare product categories the beneficiary authorizes a licensed agent to discuss during one specific personal marketing appointment. It is not an enrollment form and does not change current coverage.');
  ok('EN important paragraph verbatim', SOA_TEXT.en.important.startsWith(
    'Important: Completing this Scope of Appointment does not require you to enroll in a plan, does not obligate you to change your current coverage, and does not authorize discussion of product categories you did not select.'));
  ok('ES important paragraph verbatim', SOA_TEXT.es.important.startsWith(
    'Importante: Completar este Scope of Appointment no le obliga a inscribirse en un plan, no le obliga a cambiar su cobertura actual y no autoriza conversar sobre categorías que usted no seleccionó.'));
  ok('EN authorization statement verbatim', SOA_TEXT.en.authorizationStatement ===
    'By signing/affirming below, I confirm that the categories marked above are the categories I authorize for this specific appointment.');
  ok('EN security warning names SSN, MBI, bank and medical detail',
    /Social Security number/.test(SOA_TEXT.en.security) && /Medicare Beneficiary Identifier \(MBI\)/.test(SOA_TEXT.en.security)
    && /bank\/card information/.test(SOA_TEXT.en.security) && /detailed medical information/.test(SOA_TEXT.en.security));

  // Spec §29 — never use the bare acronyms in customer-facing speech.
  const customerFacing = [SOA_TEXT.en, SOA_TEXT.es].flatMap((b) => [b.intro, b.categoriesHelp, b.important, b.authorizationStatement])
    .concat(SOA_CATEGORIES.flatMap((c) => [c.en.label, c.en.description, c.es.label, c.es.description]));
  const bare = customerFacing.filter((s) => /\b(MA|MAPD|MA-PD|PDP)\b/.test(s));
  ok('no bare MA/MAPD/PDP in customer-facing text (spec §29)', bare.length === 0, bare.join(' | '));

  // Spec §29 — no "which plan is best" framing, no countdown/scarcity.
  ok('no "which plan is best" framing',
    !customerFacing.some((s) => /which plan is best|cuál plan es (el )?mejor/i.test(s)));
  ok('title substitutes the state token', soaTitle('en', 'New York') === 'SCOPE OF APPOINTMENT - New York');

  // Read-back must exclude the non-authorizing option (spec §8).
  const rb = readBackLines(['MA_WITH_RX', 'UNSURE_DISCUSS_PROCESS'], 'en');
  ok('read-back lists only authorized categories', rb.items.length === 1 && /with prescription drug coverage/.test(rb.items[0]), JSON.stringify(rb.items));
  const rbNone = readBackLines(['UNSURE_DISCUSS_PROCESS'], 'es');
  ok('read-back with nothing authorized says so', rbNone.items.length === 0 && /no autorizó ninguna categoría/i.test(rbNone.intro));
}

// ── 2. State-first jurisdiction engine (spec §5) ─────────────────────────────
{
  ok('exactly NY/NJ/CT supported', SUPPORTED_STATES.join(',') === 'NY,NJ,CT', SUPPORTED_STATES.join(','));
  ok('NY form version verbatim', STATE_RULESETS.NY.soaFormVersion === 'CP-SOA-NY-CY2027-v1.0');
  ok('NJ ruleset version verbatim', STATE_RULESETS.NJ.stateRulesetVersion === 'NJ-CY2027-v1.0');
  ok('CT form version verbatim', STATE_RULESETS.CT.soaFormVersion === 'CP-SOA-CT-CY2027-v1.0');

  const now = new Date('2026-11-01T12:00:00Z');
  ok('NY resolves', resolveStateRuleset('NY', 2027, now).ok === true);
  ok('lowercase resolves', resolveStateRuleset('ny', 2027, now).ok === true);
  ok('no state fails closed', resolveStateRuleset(null, 2027, now).reason === 'NO_STATE');
  ok('no state demands human review', resolveStateRuleset(undefined, 2027, now).humanReview === true);
  ok('garbage state fails closed', resolveStateRuleset('ZZZZ', 2027, now).reason === 'INVALID_STATE');
  ok('FL is not supported (general service path)', resolveStateRuleset('FL', 2027, now).reason === 'STATE_NOT_SUPPORTED');
  ok('unsupported state does NOT demand security review', resolveStateRuleset('FL', 2027, now).humanReview === false);
  ok('wrong plan year fails closed', resolveStateRuleset('NY', 2026, now).reason === 'RULESET_MISSING');
  ok('before effective date fails closed',
    resolveStateRuleset('NY', 2027, new Date('2026-09-30T12:00:00Z')).reason === 'RULESET_NOT_YET_EFFECTIVE');

  // ZIP/state consistency is a review signal, never a rejection.
  ok('NY ZIP consistent', zipStateConsistency('11717', 'NY') === 'CONSISTENT');
  ok('NJ ZIP consistent', zipStateConsistency('07001', 'NJ') === 'CONSISTENT');
  ok('CT ZIP consistent', zipStateConsistency('06320', 'CT') === 'CONSISTENT');
  ok('Holtsville NY 00501 not falsely flagged', zipStateConsistency('00501', 'NY') === 'CONSISTENT');
  ok('Fishers Island 06390 is NY, not flagged', zipStateConsistency('06390', 'NY') === 'CONSISTENT');
  ok('06390 is NOT in the CT block', zipStateConsistency('06390', 'CT') === 'FLAG_FOR_REVIEW');
  ok('NJ ZIP with CT claim flags', zipStateConsistency('07030', 'CT') === 'FLAG_FOR_REVIEW');
  ok('unknown state yields UNKNOWN not a flag', zipStateConsistency('11717', 'FL') === 'UNKNOWN');
  ok('bad ZIP yields UNKNOWN', zipStateConsistency('abcde', 'NY') === 'UNKNOWN');

  // County: never guessed.
  ok('no county dataset installed by default', hasCountyDataset() === false);
  ok('county asks the beneficiary when no dataset', resolveCounty('11717', 'NY').status === 'ASK_BENEFICIARY');
  ok('reason says NO_DATASET', resolveCounty('11717', 'NY').reason === 'NO_DATASET');
  setCountyDataset({ '11717': ['Suffolk'], '10001': ['New York', 'Kings'] });
  ok('single-county ZIP resolves', resolveCounty('11717', 'NY').county === 'Suffolk');
  ok('ambiguous ZIP asks the beneficiary', resolveCounty('10001', 'NY').status === 'ASK_BENEFICIARY');
  ok('ambiguous ZIP offers both options', resolveCounty('10001', 'NY').options.length === 2);
  ok('ZIP outside dataset asks, never guesses', resolveCounty('99999', 'NY').reason === 'NOT_IN_DATASET');
  setCountyDataset(null);
  ok('dataset cleared', hasCountyDataset() === false);
}

// ── 3. Plan-year rulesets (spec §22) ─────────────────────────────────────────
{
  ok('CY2027 removes the 48-hour wait', CMS_RULESET_2027.soa.advanceWaitHours === 0);
  ok('CY2026 preserved with its 48-hour wait', CMS_RULESET_2026.soa.advanceWaitHours === 48);
  ok('CY2026 is SUPERSEDED, not deleted', CMS_RULESET_2026.status === 'SUPERSEDED');
  ok('CY2026 still retrievable for audit', rulesetForAudit(2026).version === 'CMS_RULESET_2026-v1.0');
  ok('SOA must still precede the appointment', CMS_RULESET_2027.soa.mustPrecedeAppointment === true);
  ok('in-person requires written SOA', CMS_RULESET_2027.soa.inPersonRequiresWritten === true);
  ok('no universal standing SOA', CMS_RULESET_2027.soa.universalStandingSoaAllowed === false);
  ok('CY2027 TPMO drops the SHIP reference', CMS_RULESET_2027.tpmo.includesShipReference === false);
  ok('CY2026 TPMO kept the SHIP reference', CMS_RULESET_2026.tpmo.includesShipReference === true);
  ok('retention minimum is 6 years', CMS_RULESET_2027.retention.marketingSalesCallMinYears === 6);
  ok('audio required for the first 3 years', CMS_RULESET_2027.retention.audioRequiredFirstYears === 3);

  ok('plan year flips at the CY2027 instant',
    activePlanYear(new Date(CY2027_MARKETING_START_UTC)) === 2027 &&
    activePlanYear(new Date(CY2027_MARKETING_START_UTC - 1)) === 2026);

  ok('2027 resolves in production', resolveRuleset(2027, new Date('2026-11-01T00:00:00Z'), {}).ok === true);
  ok('superseded year refuses to govern live work', resolveRuleset(2026, new Date('2026-11-01T00:00:00Z'), {}).reason === 'RULESET_NOT_ACTIVE');
  ok('unknown year fails closed', resolveRuleset(2031, new Date(), {}).reason === 'RULESET_MISSING');
  ok('kill switch disables the workflow',
    resolveRuleset(2027, new Date('2026-11-01T00:00:00Z'), { CY2027_REGULATORY_KILL: 'true' }).reason === 'REGULATORY_KILL_ENGAGED');
  ok('kill switch off by default', resolveRuleset(2027, new Date('2026-11-01T00:00:00Z'), {}).ok === true);
}

// ── 4. SOA instance model (spec §7, §8, §11) ─────────────────────────────────
const baseInput = {
  soaId: 'soa_1', appointmentId: 'appt_1', appointmentAt: '2026-11-10T15:00:00Z',
  appointmentFormat: 'TELEPHONE', planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk',
  language: 'en', method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public',
  selectedCategories: ['MA_WITH_RX'], stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
};
{
  const p = partitionSelection(['MA_WITH_RX', 'UNSURE_DISCUSS_PROCESS', 'NOT_A_CODE']);
  ok('unsure never counts as authorized', p.authorized.join(',') === 'MA_WITH_RX');
  ok('unsure is tracked separately', p.nonAuthorizing.join(',') === 'UNSURE_DISCUSS_PROCESS');
  ok('unselected authorizing categories are recorded as declined', p.declined.length === 2);
  ok('unknown codes are rejected, not ignored', p.invalid.join(',') === 'NOT_A_CODE');

  const noAppt = createSoaInstance({ ...baseInput, appointmentId: undefined });
  ok('an SOA without an appointment is unrepresentable (no universal SOA)',
    noAppt.ok === false && noAppt.errors.appointmentId === 'required_no_universal_soa');

  const built = createSoaInstance(baseInput);
  ok('valid instance builds', built.ok === true, JSON.stringify(built.errors || {}));
  const inst = built.instance;
  ok('declined categories are stored', inst.declinedCategories.length === 2);
  ok('status is PENDING_SIGNATURE before signing', inst.status === SOA_STATUS.PENDING_SIGNATURE);

  const onlyUnsure = createSoaInstance({ ...baseInput, soaId: 'soa_u', selectedCategories: ['UNSURE_DISCUSS_PROCESS'] });
  ok('selecting only "I am not sure" yields SOA_INCOMPLETE', onlyUnsure.instance.status === SOA_STATUS.INCOMPLETE);
  throws('an incomplete SOA cannot be completed', () => completeSoaInstance(onlyUnsure.instance, { integrityHash: 'h', evidenceReference: 'e' }), /SOA_INCOMPLETE/);
  throws('completion requires an integrity hash', () => completeSoaInstance(inst, { evidenceReference: 'e' }), /integrityHash/);
  throws('completion requires an evidence reference', () => completeSoaInstance(inst, { integrityHash: 'h' }), /evidenceReference/);

  const done = completeSoaInstance(inst, { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_1' });
  ok('completed instance carries evidence', done.status === SOA_STATUS.COMPLETED && !!done.integrityHash);
  ok('covers the authorized category', coversCategory(done, 'MA_WITH_RX') === true);
  ok('does not cover an unselected category', coversCategory(done, 'STANDALONE_RX') === false);
  ok('discussing an unselected category needs a scope update', requiresScopeUpdate(done, 'STANDALONE_RX') === true);

  const appt = { appointmentId: 'appt_1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
  ok('gate opens for a valid instance', marketingGate(done, appt, CMS_RULESET_2027).allowed === true);

  ok('gate blocks a different appointment',
    marketingGate(done, { ...appt, appointmentId: 'appt_2' }, CMS_RULESET_2027).reason === 'SOA_FOR_DIFFERENT_APPOINTMENT');
  ok('gate blocks a state mismatch',
    marketingGate(done, { ...appt, state: 'NJ' }, CMS_RULESET_2027).reason === 'SOA_STATE_MISMATCH');
  ok('gate blocks a plan-year mismatch',
    marketingGate({ ...done, planYear: 2026 }, appt, CMS_RULESET_2027).reason === 'SOA_PLAN_YEAR_MISMATCH');
  ok('gate blocks an SOA signed after the appointment began',
    marketingGate({ ...done, completedAt: '2026-11-10T16:00:00Z' }, appt, CMS_RULESET_2027).reason === 'SOA_NOT_RECORDED_BEFORE_APPOINTMENT');
  ok('gate blocks when evidence is missing',
    marketingGate({ ...done, evidenceReference: null }, appt, CMS_RULESET_2027).reason === 'SOA_EVIDENCE_MISSING');
  ok('gate blocks a revoked SOA',
    marketingGate(revokeSoaInstance(done), appt, CMS_RULESET_2027).reason === 'SOA_REVOKED');
  ok('gate blocks with no SOA at all', marketingGate(null, appt, CMS_RULESET_2027).reason === 'NO_SOA');

  // The in-person rule — the one the spec lists as an immediate-fail.
  const voice = completeSoaInstance(
    createSoaInstance({ ...baseInput, soaId: 'soa_v', method: 'VOICE_RECORDED' }).instance,
    { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_v' });
  ok('voice-only method is not written', methodIsWritten('VOICE_RECORDED') === false);
  ok('web signature is written', methodIsWritten('WEB_ELECTRONIC_SIGNATURE') === true);
  ok('voice-only SOA does NOT unlock an in-person appointment',
    marketingGate(voice, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).reason === 'IN_PERSON_REQUIRES_WRITTEN_SOA');
  ok('voice-only SOA still works for a telephone appointment',
    marketingGate(voice, appt, CMS_RULESET_2027).allowed === true);
  ok('written SOA unlocks an in-person appointment',
    marketingGate(done, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).allowed === true);

  // Supersession.
  const sup = superseded(done, { ...baseInput, soaId: 'soa_2', selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX'] });
  ok('supersession marks the old instance', sup.previous.status === SOA_STATUS.SUPERSEDED);
  ok('supersession links forward', sup.previous.supersededById === 'soa_2');
  ok('supersession links backward', sup.instance.supersedesId === 'soa_1');
  ok('the superseded instance no longer opens the gate',
    marketingGate(sup.previous, appt, CMS_RULESET_2027).reason === 'SOA_SUPERSEDED');

  ok('plan-year change requires a new instance', requiresNewInstance(done, appt, { planYear: 2028 }) === true);
  ok('same appointment needs no new instance', requiresNewInstance(done, appt, CMS_RULESET_2027) === false);
  ok('switching to in-person with a voice SOA requires a new instance',
    requiresNewInstance(voice, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027) === true);
}

// ── 5. Consent engine (spec §6, §24) ─────────────────────────────────────────
{
  const mk = (type, status) => createConsent({ type, status, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'this request' });

  throws('consent requires a known type', () => createConsent({ type: 'NOPE', language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 's' }), /unknown type/);
  throws('consent requires a language', () => createConsent({ type: 'RECORDING_NOTICE', channel: 'WEB', scriptVersion: 'v1', scope: 's' }), /language/);
  throws('consent requires the script version actually shown', () => createConsent({ type: 'RECORDING_NOTICE', language: 'en', channel: 'WEB', scope: 's' }), /scriptVersion/);
  throws('consent requires a scope', () => createConsent({ type: 'RECORDING_NOTICE', language: 'en', channel: 'WEB', scriptVersion: 'v1' }), /scope/);

  // The cross-inference table, every banned pair.
  throws('SOA may not be inferred from callback permission', () => assertNoCrossInference('SCOPE_OF_APPOINTMENT', 'CALLBACK_CONSENT'.replace('CONSENT', 'CONTACT_PERMISSION')), /never be inferred/);
  throws('SOA may not be inferred from "tell me everything"', () => assertNoCrossInference('SCOPE_OF_APPOINTMENT', 'TELL_ME_EVERYTHING'), /never be inferred/);
  throws('SOA may not be inferred from browsing', () => assertNoCrossInference('SCOPE_OF_APPOINTMENT', 'WEBSITE_BROWSING'), /never be inferred/);
  throws('callback permission may not be inferred from the recording notice', () => assertNoCrossInference('CALLBACK_CONTACT_PERMISSION', 'RECORDING_NOTICE'), /never be inferred/);
  throws('callback permission may not be inferred from a prior relationship', () => assertNoCrossInference('CALLBACK_CONTACT_PERMISSION', 'PRIOR_CUSTOMER_RELATIONSHIP'), /never be inferred/);
  throws('AI outbound may not be inferred from "you may call me"', () => assertNoCrossInference('AI_OUTBOUND_VOICE_CONSENT', 'GENERIC_YOU_MAY_CALL_ME'), /never be inferred/);
  throws('recording notice may not be inferred from a website submission', () => assertNoCrossInference('RECORDING_NOTICE', 'WEBSITE_SUBMISSION'), /never be inferred/);
  ok('an unrelated signal is permitted', assertNoCrossInference('SCOPE_OF_APPOINTMENT', 'EXPLICIT_SOA_SIGNATURE') === true);

  // Ambiguity is never consent.
  ok('silence is NOT_ASKED', classifyReply('') === CONSENT_STATUS.NOT_ASKED);
  ok('bare "ok" is UNCLEAR', classifyReply('ok') === CONSENT_STATUS.UNCLEAR);
  ok('bare "okay" is UNCLEAR', classifyReply('okay') === CONSENT_STATUS.UNCLEAR);
  ok('bare "claro" is UNCLEAR', classifyReply('claro') === CONSENT_STATUS.UNCLEAR);
  ok('bare "sure" is UNCLEAR', classifyReply('sure') === CONSENT_STATUS.UNCLEAR);
  ok('bare "por favor" is UNCLEAR', classifyReply('por favor') === CONSENT_STATUS.UNCLEAR);
  ok('"yes" is a grant', classifyReply('yes') === CONSENT_STATUS.GRANTED);
  ok('"sí autorizo" is a grant', classifyReply('sí autorizo') === CONSENT_STATUS.GRANTED);
  ok('"no" is a refusal', classifyReply('no') === CONSENT_STATUS.DECLINED);
  ok('"no me llame" is a refusal', classifyReply('no me llame') === CONSENT_STATUS.DECLINED);

  const granted = mk('CALLBACK_CONTACT_PERMISSION', CONSENT_STATUS.GRANTED);
  ok('granted consent is affirmative', isAffirmative(granted) === true);
  const revoked = revokeConsent(granted, { via: 'SMS_STOP' });
  ok('revoked consent is not affirmative', isAffirmative(revoked) === false);
  ok('revocation records how it arrived', revoked.revokedVia === 'SMS_STOP' && !!revoked.revokedAt);

  // Outbound safety.
  ok('human callback allowed with callback consent',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: granted }).allowed === true);
  ok('human callback blocked without it',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: null }).reason === 'NO_CALLBACK_CONSENT');
  ok('do-not-contact overrides a prior grant',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: granted, doNotContact: true }).reason === 'DO_NOT_CONTACT');
  ok('AI outbound blocked without its own consent',
    mayPlaceOutbound({ mode: 'AI_AUTOMATED', callbackConsent: granted }).reason === 'NO_AI_OUTBOUND_CONSENT');
  ok('AI outbound still blocked WITH consent until the architecture is validated',
    mayPlaceOutbound({ mode: 'AI_AUTOMATED', aiOutboundConsent: mk('AI_OUTBOUND_VOICE_CONSENT', CONSENT_STATUS.GRANTED) }).reason
    === 'AI_OUTBOUND_ARCHITECTURE_NOT_VALIDATED');
}

// ── 6. Trust / anti-abuse (spec §12, §13, §15) ───────────────────────────────
{
  for (const sig of ['HEALTH_CONDITION', 'DIAGNOSIS', 'MEDICAID_STATUS', 'LIS_STATUS', 'INCOME', 'ACCENT', 'CAREGIVER_PRESENT', 'NO_EMAIL', 'STRUGGLED_WITH_QUESTIONS', 'EXPECTED_COMMISSION']) {
    throws(`prohibited signal ${sig} cannot enter trust logic`, () => assertSignalAllowed(sig), /never influence/);
  }
  throws('an unknown signal is rejected rather than silently used', () => assertSignalAllowed('VIBES'), /unknown signal/);
  ok('a legitimate abuse signal is allowed', assertSignalAllowed('REPEATED_FAILED_OTP') === true);

  for (const f of ['SSN', 'MBI', 'BANK_ACCOUNT', 'CARD_NUMBER']) {
    throws(`${f} rejected as a pre-SOA identity factor`, () => assertIdentityFactorAllowed(f), /may not be used/);
  }
  ok('ZIP is an acceptable factor', assertIdentityFactorAllowed('ZIP') === true);

  ok('no signals, no verification → UNVERIFIED', evaluateTrust({}).state === LEAD_TRUST_STATE.UNVERIFIED);
  ok('OTP alone is only PARTIAL (channel ≠ identity)',
    evaluateTrust({ channelVerification: CHANNEL_VERIFICATION.VERIFIED }).state === LEAD_TRUST_STATE.PARTIALLY_VERIFIED);
  ok('human verification reaches VERIFIED_REQUEST',
    evaluateTrust({ identityVerification: IDENTITY_VERIFICATION.VERIFIED_BY_LICENSED_HUMAN }).state === LEAD_TRUST_STATE.VERIFIED_REQUEST);
  ok('one signal → human review',
    evaluateTrust({ signals: ['DEVICE_IP_VELOCITY'] }).state === LEAD_TRUST_STATE.HUMAN_REVIEW_REQUIRED);
  ok('two signals → quarantine',
    evaluateTrust({ signals: ['DEVICE_IP_VELOCITY', 'DISPOSABLE_CONTACT_DATA'] }).state === LEAD_TRUST_STATE.SECURITY_QUARANTINE);
  ok('attempting another record → immediate quarantine',
    evaluateTrust({ signals: ['ACCESS_ATTEMPT_ANOTHER_RECORD'] }).state === LEAD_TRUST_STATE.SECURITY_QUARANTINE);

  const q = trustCapabilities(LEAD_TRUST_STATE.SECURITY_QUARANTINE);
  ok('quarantine blocks CRM exposure', q.mayExposeCrmData === false);
  ok('quarantine blocks prefill', q.mayPrefillPrivateData === false);
  ok('quarantine blocks home visits', q.mayCreateHomeVisit === false);
  ok('quarantine NEVER blocks being served by a human', q.mayBeServedByHuman === true);
  ok('automated outbound is off from every trust state',
    [LEAD_TRUST_STATE.VERIFIED_REQUEST, LEAD_TRUST_STATE.UNVERIFIED, LEAD_TRUST_STATE.SECURITY_QUARANTINE]
      .every((s) => trustCapabilities(s).mayStartAutomatedOutbound === false));
  ok('unverified callers can still be served', trustCapabilities(LEAD_TRUST_STATE.UNVERIFIED).mayBeServedByHuman === true);

  const task = buildSecurityReviewTask({
    requestId: 'r1', state: 'NY', zip: '11717', signals: ['DEVICE_IP_VELOCITY'],
    ssn: '123-45-6789', diagnosis: 'cancer', medications: ['x'],
  });
  ok('review task carries only allowlisted facts',
    !('ssn' in task.facts) && !('diagnosis' in task.facts) && !('medications' in task.facts), JSON.stringify(task.facts));
  ok('review task keeps the facts a human needs', task.facts.state === 'NY' && task.facts.requestId === 'r1');
  ok('review task declares AI may not approve it', task.aiMayApprove === false);
  throws('AI cannot resolve a quarantine', () => resolveSecurityReview(task, { actor: 'ai', decision: 'CONFIRMED', reasonCode: 'x' }), /human reviewer/);
  throws('"system" cannot resolve a quarantine', () => resolveSecurityReview(task, { actor: 'system', decision: 'CONFIRMED', reasonCode: 'x' }), /human reviewer/);
  throws('a decision needs a reason code', () => resolveSecurityReview(task, { actor: 'sawil', decision: 'CONFIRMED' }), /reasonCode/);
  const resolved = resolveSecurityReview(task, { actor: 'sawil', decision: 'CONFIRMED', reasonCode: 'CALLED_BACK_ON_FILE' });
  ok('a human can resolve it', resolved.decision === 'CONFIRMED' && resolved.reviewer === 'sawil' && !!resolved.reviewedAt);
}

// ── 7. Retention and legal hold (spec §19) ───────────────────────────────────
{
  const old = { recordClass: RECORD_CLASS.SOA_EVIDENCE, createdAt: '2015-01-01T00:00:00Z' };
  const fresh = { recordClass: RECORD_CLASS.SOA_EVIDENCE, createdAt: '2026-01-01T00:00:00Z' };
  ok('a record inside its retention period cannot be purged', mayPurge(fresh).reason === 'WITHIN_RETENTION_PERIOD');
  ok('an expired record may be purged', mayPurge(old).allowed === true);
  ok('an unknown record class is never purged', mayPurge({ recordClass: 'MYSTERY', createdAt: '2000-01-01T00:00:00Z' }).reason === 'UNKNOWN_RECORD_CLASS');
  ok('an unparseable date is never purged', mayPurge({ recordClass: RECORD_CLASS.SOA_EVIDENCE, createdAt: 'whenever' }).reason === 'UNPARSEABLE_CREATED_AT');
  ok('a class with no confirmed period is never purged',
    mayPurge({ recordClass: RECORD_CLASS.ENROLLMENT_RECORD, createdAt: '1990-01-01T00:00:00Z' }).reason === 'RETENTION_PERIOD_NOT_CONFIRMED');
  ok('no record at all is never purged', mayPurge(null).reason === 'NO_RECORD');

  const held = applyHold(old, 'CMS_INQUIRY');
  ok('a hold blocks an otherwise purgeable record', mayPurge(held).reason === 'ACTIVE_HOLD');
  throws('an unknown hold reason is rejected', () => applyHold(old, 'BECAUSE'), /unknown hold reason/);
  const twoHolds = applyHold(held, 'COMPLAINT');
  const oneReleased = releaseHold(twoHolds, 'COMPLAINT', { actor: 'sawil' });
  ok('releasing one hold does not release the others', mayPurge(oneReleased).reason === 'ACTIVE_HOLD');
  throws('releasing a hold requires an actor', () => releaseHold(twoHolds, 'COMPLAINT', {}), /requires an actor/);
  const allReleased = releaseHold(oneReleased, 'CMS_INQUIRY', { actor: 'sawil' });
  ok('with all holds released the record may be purged', mayPurge(allReleased).allowed === true);

  const now = new Date('2026-10-01T00:00:00Z');
  ok('year 1: audio itself required', callRetentionRequirement('2026-01-01T00:00:00Z', now).audio === true);
  ok('year 5: audio OR complete transcript', callRetentionRequirement('2021-06-01T00:00:00Z', now).transcript === true);
  ok('unknown age fails closed to keeping everything', callRetentionRequirement('nonsense', now).audio === true);
}

// ── 8. Carrier overlay registry (spec §16, §17) ──────────────────────────────
{
  throws('the public layer cannot reach the registry',
    () => canDiscussCarrier({ carrier: 'Aetna', planYear: 2027, state: 'NY', context: 'PUBLIC_WEBSITE' }), /registry is private/);
  throws('the SOA flow cannot reach the registry',
    () => overlayInventory('SOA_FLOW'), /registry is private/);
  ok('the licensed workspace may', assertPrivateContext('LICENSED_AGENT_WORKSPACE') === true);

  const inv = overlayInventory('LICENSED_AGENT_WORKSPACE');
  ok('registry covers the carriers the spec names', inv.length === 10, String(inv.length));
  ok('no overlay claims verification it has not had',
    inv.every((o) => o.status === OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION || o.status === OVERLAY_STATUS.PENDING_CURRENT_YEAR_VERIFICATION),
    JSON.stringify(inv.filter((o) => !/PENDING/.test(o.status))));
  ok('every carrier is therefore blocked, fail-closed',
    inv.every((o) => canDiscussCarrier({ carrier: o.carrier, planYear: 2027, state: o.states[0], context: 'LICENSED_AGENT_WORKSPACE' }).allowed === false));
  ok('an unknown carrier is blocked too',
    canDiscussCarrier({ carrier: 'Imaginary Health', planYear: 2027, state: 'NY', context: 'LICENSED_AGENT_WORKSPACE' }).reason === 'OVERLAY_UNKNOWN');
  ok('Clover is one carrier among several, not privileged',
    inv.filter((o) => /clover/i.test(o.carrier)).length === 1);
}

// ── 9. TPMO canonical source (blocker #1) ────────────────────────────────────
{
  ok('CY2027 variant is active today', activeContractYearVariant(new Date('2026-10-01T04:00:00Z')) === 'CY2027');
  ok('CY2026 variant before the cut-over', activeContractYearVariant(new Date('2026-10-01T03:59:59Z')) === 'CY2026');
  ok('counts are still owner-blocked', hasVerifiedTpmoCounts() === false);
  ok('config reports BLOCKED_COUNTS_REQUIRED', TPMO_DISCLAIMER_CONFIG.status === 'BLOCKED_COUNTS_REQUIRED');

  const en27 = tpmoDisclaimerText('en');
  const es27 = tpmoDisclaimerText('es');
  ok('CY2027 EN text drops the SHIP reference', !/State Health Insurance/i.test(en27), en27);
  ok('CY2027 ES text drops the SHIP reference', !/Seguro de Salud|SHIP/i.test(es27), es27);
  ok('no [X]/[Y] placeholder can reach a reader', !/\[X\]|\[Y\]/.test(en27 + es27));
  ok('EN still carries the standardized opening', /^We do not offer every plan available in your area\./.test(en27));
  ok('ES still carries the standardized opening', /^No ofrecemos todos los planes disponibles en su área\./.test(es27));

  const cy26 = { ...TPMO_DISCLAIMER_CONFIG, contractYearVariant: 'CY2026' };
  ok('the CY2026 wording is still reachable for historical records',
    /State Health Insurance/i.test(tpmoDisclaimerText('en', cy26)));

  ok('a clean sentence is signable', assertDisclaimerSignable(en27) === true);
  throws('a placeholder sentence can never be signed',
    () => assertDisclaimerSignable('We represent [X] organizations which offer [Y] products'), /refusing to render/);
}

// ── 10. Evidence and audit (spec §19, §30) ───────────────────────────────────
{
  const inst = completeSoaInstance(createSoaInstance(baseInput).instance,
    { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'placeholder', evidenceReference: 'ev' });

  const snap = renderTextSnapshot(inst, 'New York');
  ok('the snapshot stores the exact wording shown, not just the codes',
    snap.categoriesAuthorized[0].description === categoryText('MA_WITH_RX', 'en').description);
  ok('the snapshot records what was declined too', snap.categoriesDeclined.length === 2);
  ok('the snapshot carries the title the person saw', snap.title === 'SCOPE OF APPOINTMENT - New York');
  ok('the snapshot carries the script version', snap.scriptVersion === SOA_SCRIPT_VERSION);

  const { record, integrityHash: h } = buildEvidenceRecord(inst, { stateName: 'New York', signature: 'Jane Q Public' });
  ok('evidence verifies against its own hash', verifyEvidence(record).ok === true);
  ok('tampering with the authorized scope is detectable',
    verifyEvidence({ ...record, authorizedCategories: ['MA_WITH_RX', 'STANDALONE_RX'] }).reason === 'HASH_MISMATCH');
  ok('tampering with the signature is detectable',
    verifyEvidence({ ...record, signature: 'Someone Else' }).reason === 'HASH_MISMATCH');
  ok('a record with no hash does not quietly pass', verifyEvidence({ ...record, integrityHash: null }).reason === 'NO_HASH');
  ok('hashing is order-independent', integrityHash({ a: 1, b: 2 }) === integrityHash({ b: 2, a: 1 }));
  ok('the evidence record is classed for retention', record.recordClass === RECORD_CLASS.SOA_EVIDENCE);
  ok('changing the IP does not look like tampering',
    verifyEvidence({ ...record, context: { ...record.context, sourceIp: '9.9.9.9' } }).ok === true);
  throws('evidence requires a signature', () => buildEvidenceRecord(inst, { stateName: 'New York' }), /signature/);

  const ev = auditEvent({ action: 'SOA_SIGNED', actor: 'beneficiary', result: 'OK', source: 'WEB', correlationId: 'c1', details: { ssn: '123-45-6789', zip: '11717' } });
  ok('audit redacts sensitive values', ev.details.ssn === '[redacted]');
  ok('audit keeps the non-sensitive context', ev.details.zip === '11717');
  throws('an audit event without a correlation id is refused', () => auditEvent({ action: 'SOA_SIGNED', actor: 'a', result: 'OK', source: 'WEB' }), /correlationId/);
  throws('an unknown audit action is refused', () => auditEvent({ action: 'WHATEVER', actor: 'a', result: 'OK', source: 'WEB', correlationId: 'c' }), /unknown audit action/);
  ok('nested sensitive values are redacted too', redactForLog({ a: { mbi: '1EG4TE5MK73' } }).a.mbi === '[redacted]');
}

// ── 11. Secure SOA link (spec §9, §12, §26, §30) ─────────────────────────────
{
  const mkLink = (over = {}) => issueLink({
    soaId: 'soa_1', appointmentId: 'appt_1', beneficiaryRef: 'contact_abc',
    channel: 'SMS_LINK', secondFactorKind: 'PHONE_LAST4', secondFactorValue: '(631) 555-0147',
    language: 'es', ...over,
  });

  const { token, storeKey, record } = mkLink();
  ok('token is 256 bits of entropy, not a UUID', Buffer.from(token, 'base64url').length === 32);
  ok('token is not UUID-shaped', !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(token));
  ok('two links never collide', mkLink().token !== token);
  ok('the store is keyed by the hash, not the token', storeKey === storeKeyFor(token) && !storeKey.includes(token));
  ok('a store dump yields no usable token', !JSON.stringify(record).includes(token));

  // The record must not hold the VALUES the link could then leak. Field NAMES
  // like "secondFactorKind: PHONE_LAST4" are fine — they say which question to
  // ask, not the answer.
  const asText = JSON.stringify(record);
  ok('the link record holds no phone digits', !/\d{4}\b(?!.*T\d)/.test(asText.replace(/"(issuedAt|expiresAt)":"[^"]+"/g, '')), asText);
  ok('the link record holds no last four of the phone', !asText.includes('0147'));
  ok('the link record holds no email', !asText.includes('@'));
  ok('the link record holds no beneficiary name', !/fullName|beneficiaryName/.test(asText));
  ok('the second factor is stored hashed', record.secondFactorHash.length === 64);

  throws('a link without an appointment is refused (no universal SOA link)',
    () => mkLink({ appointmentId: undefined }), /appointmentId is required/);
  throws('an unknown channel is refused', () => mkLink({ channel: 'CARRIER_PIGEON' }), /unknown channel/);
  throws('an empty second factor is refused', () => mkLink({ secondFactorValue: '   ' }), /cannot be empty/);

  ok('a fresh link checks out', checkLink(record).ok === true);
  ok('a missing link is not found', checkLink(null).reason === 'LINK_NOT_FOUND');
  ok('an expired link fails closed',
    checkLink({ ...record, expiresAt: '2020-01-01T00:00:00Z' }).reason === 'LINK_EXPIRED');
  ok('a revoked link fails closed', checkLink(revokeLink(record)).reason === 'LINK_REVOKED');
  ok('view-limit abuse fails closed', checkLink({ ...record, views: 999 }).reason === 'LINK_VIEW_LIMIT');

  // Possession alone must reveal nothing private — the forwarded-link case.
  const anon = linkDisclosure(record, { factorVerified: false });
  ok('possession reveals only which factor to ask for', anon.factorRequired === 'PHONE_LAST4');
  ok('possession reveals no beneficiary reference', !('beneficiaryRef' in anon));
  ok('possession reveals no SOA id', !('soaId' in anon));
  ok('possession reveals no appointment id', !('appointmentId' in anon));
  ok('an invalid link discloses only that it is not usable',
    Object.keys(linkDisclosure({ ...record, consumedAt: '2026-01-01T00:00:00Z' })).join(',') === 'exists,reason');

  // Second factor.
  const wrong = verifySecondFactor(record, '9999');
  ok('a wrong factor is rejected', wrong.ok === false && wrong.reason === 'SECOND_FACTOR_MISMATCH');
  ok('a wrong factor counts an attempt', wrong.record.failedFactorAttempts === 1);
  ok('a wrong factor does not say what was wrong', !('secondFactorKind' in wrong) && !('beneficiaryRef' in wrong));
  ok('formatting of the factor does not matter', verifySecondFactor(record, '0147').ok === true);
  ok('the full phone also normalizes to the last four', verifySecondFactor(record, '631-555-0147').ok === true);

  let locked = record;
  for (let i = 0; i < 5; i++) locked = verifySecondFactor(locked, '0000').record;
  const lockedOut = verifySecondFactor(locked, '0147');
  ok('brute force locks out even with the correct factor', lockedOut.reason === 'SECOND_FACTOR_LOCKED');
  ok('lockout raises the abuse signal the trust engine understands', lockedOut.signal === 'REPEATED_FAILED_OTP');

  const verified = verifySecondFactor(record, '0147').record;
  const full = linkDisclosure(verified, { factorVerified: true });
  ok('after verification the prefill reference is released', full.beneficiaryRef === 'contact_abc');
  ok('after verification the SOA and appointment are released', full.soaId === 'soa_1' && full.appointmentId === 'appt_1');

  // Replay protection.
  const used = consumeLink(record);
  ok('a link can be consumed once', used.ok === true && !!used.record.consumedAt);
  ok('a second consumption is refused', consumeLink(used.record).reason === 'LINK_ALREADY_USED');
  ok('a consumed link no longer checks out', checkLink(used.record).reason === 'LINK_ALREADY_USED');

  // Resending a copy must not mint a new SOA.
  ok('re-issuing for a signed SOA is refused',
    mayReissue(record, 'COMPLETED').reason === 'SOA_ALREADY_SIGNED_RESEND_EVIDENCE_INSTEAD');
  ok('re-issuing before signature is fine', mayReissue(record, 'PENDING_SIGNATURE').allowed === true);
  ok('re-issuing a revoked link is refused', mayReissue(revokeLink(record), 'PENDING_SIGNATURE').reason === 'LINK_REVOKED');

  ok('views are counted for abuse detection', recordView(record).views === 1);
}

if (failures.length) {
  console.error(`CY2027 LAYER: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

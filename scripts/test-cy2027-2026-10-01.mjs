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
  LANGUAGE_SOURCE, languageWasElected, isSoaLanguage, languageElectionLabel, readLanguageElection,
  electionAttributionError,
} from '../api/_lib/cy2027/soa-instance.js';
import {
  CONSENT_STATUS, createConsent, revokeConsent, classifyReply, isAffirmative, assertNoCrossInference, mayPlaceOutbound,
  CONTACT_CONSENT_TEXT_VERSIONS, webCallbackConsent, isStatedConsentScope, isIsoInstant,
} from '../api/_lib/cy2027/consent.js';
import {
  LEAD_TRUST_STATE, CHANNEL_VERIFICATION, IDENTITY_VERIFICATION, evaluateTrust, trustCapabilities,
  assertSignalAllowed, assertIdentityFactorAllowed, buildSecurityReviewTask, resolveSecurityReview,
} from '../api/_lib/cy2027/trust.js';
import { RECORD_CLASS, mayPurge, applyHold, releaseHold, callRetentionRequirement } from '../api/_lib/cy2027/retention.js';
import { canDiscussCarrier, overlayInventory, assertPrivateContext, OVERLAY_STATUS } from '../api/_lib/cy2027/carrier-overlay.js';
import { tpmoDisclaimerText, activeContractYearVariant, hasVerifiedTpmoCounts, assertDisclaimerSignable, TPMO_DISCLAIMER_CONFIG } from '../api/_lib/cy2027/tpmo.js';
import {
  integrityHash, buildEvidenceRecord, verifyEvidence, auditEvent, emitAudit, redactForLog, renderTextSnapshot, AUDIT_ACTIONS,
} from '../api/_lib/cy2027/evidence.js';
import { checkTpmo, htmlToText, canonicalTpmoSentence } from './tpmo-gate.mjs';
import {
  issueLink, storeKeyFor, checkLink, verifySecondFactor, linkDisclosure, recordView, consumeLink, revokeLink, mayReissue,
} from '../api/_lib/cy2027/secure-link.js';
import {
  redactProhibitedForScoring, requiresLicensedReview, findProhibited, SIGNAL_FLAGS,
} from '../api/_lib/cy2027/prohibited-signals.js';
import * as overlayModule from '../api/_lib/cy2027/carrier-overlay.js';
import * as barrelModule from '../api/_lib/cy2027/index.js';
import { complianceFilter } from '../api/_lib/compliance-filter.js';
import {
  buildCustomFields, soaInstanceToFields, consentsToFields, unmappedFieldsWarning, fieldIdMap,
  CY2027_FIELD_KEYS, CONFIRMED_ONLY_FIELDS, callbackRevocationToFields,
} from '../api/_lib/cy2027/crm-fields.js';
import {
  recordWebCallbackConsent, CALLBACK_CONSENT_UNAVAILABLE, CALLBACK_CONSENT_NOT_RECORDED_FLAG,
} from '../api/_lib/cy2027/callback-consent.js';
import { consentWordingProblems, readShownConsentWording } from './consent-wording-gate.mjs';
import { scrubPHI } from '../api/_lib/phi-scrub.js';
import {
  sendingEnabled, maySendCopy, buildCopyMessage, assertNotMarketing,
} from '../api/_lib/cy2027/beneficiary-copy.js';
import { parseCountyCsv } from '../api/_lib/cy2027/state-rules.js';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
/**
 * Code scans must look at CODE. During this audit three assertions passed on a
 * COMMENT that quoted the very string the scan forbade, so every scan here
 * strips comments first.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const baseInput = {
  soaId: 'soa_1', appointmentId: 'appt_1', appointmentAt: '2026-11-10T15:00:00Z',
  appointmentFormat: 'TELEPHONE', planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk',
  language: 'en', languageSource: 'BENEFICIARY_ELECTED',
  method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public',
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
  // An SOA signed for an in-person appointment, by voice. This is the case the
  // written-SOA rule is actually about; the telephone instances above now trip
  // the separate format-mismatch rule first.
  const voiceInPerson = completeSoaInstance(
    createSoaInstance({ ...baseInput, soaId: 'soa_vip', method: 'VOICE_RECORDED', appointmentFormat: 'IN_PERSON' }).instance,
    { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_vip' });
  const writtenInPerson = completeSoaInstance(
    createSoaInstance({ ...baseInput, soaId: 'soa_wip', appointmentFormat: 'IN_PERSON' }).instance,
    { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_wip' });

  ok('voice-only SOA does NOT unlock an in-person appointment',
    marketingGate(voiceInPerson, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).reason === 'IN_PERSON_REQUIRES_WRITTEN_SOA');
  ok('voice-only SOA still works for a telephone appointment',
    marketingGate(voice, appt, CMS_RULESET_2027).allowed === true);
  ok('written SOA unlocks an in-person appointment',
    marketingGate(writtenInPerson, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).allowed === true);
  ok('an SOA signed for a phone appointment does not cover an in-person one',
    marketingGate(done, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).reason === 'APPOINTMENT_FORMAT_MISMATCH');

  // ── RED TEAM 2026-10-02, reproduced CRITICALs. Regression-pinned. ──────────
  // SOA-01: in-person detection was one exact-string compare, so every other
  // spelling — and an absent format — fell through to the non-in-person branch.
  for (const f of ['in_person', 'In Person', 'in person', 'IN-PERSON']) {
    ok(`SOA-01: "${f}" is still in person`,
      marketingGate(voiceInPerson, { ...appt, format: f }, CMS_RULESET_2027).reason === 'IN_PERSON_REQUIRES_WRITTEN_SOA');
  }
  ok('SOA-01: an absent format is refused, not assumed remote',
    marketingGate(voiceInPerson, { appointmentId: 'appt_1', startsAt: appt.startsAt, state: 'NY' }, CMS_RULESET_2027).reason === 'UNKNOWN_APPOINTMENT_FORMAT');
  ok('SOA-01: an unknown format is refused',
    marketingGate(voiceInPerson, { ...appt, format: 'HOME_VISIT' }, CMS_RULESET_2027).reason === 'UNKNOWN_APPOINTMENT_FORMAT');
  ok('SOA-01: a non-string format is refused',
    marketingGate(voiceInPerson, { ...appt, format: ['IN_PERSON'] }, CMS_RULESET_2027).reason === 'UNKNOWN_APPOINTMENT_FORMAT');
  ok('SOA-01: an unknown format cannot be stored on an instance',
    createSoaInstance({ ...baseInput, appointmentFormat: 'carrier pop-up kiosk' }).errors?.appointmentFormat === 'unknown_format');

  // ── G08: the document language must be an ELECTION, never a default ────────
  ok('G08: an instance without a language election is refused',
    createSoaInstance({ ...baseInput, languageSource: undefined }).errors?.languageSource === 'election_required');
  ok('G08: an unknown election value is refused',
    createSoaInstance({ ...baseInput, languageSource: 'MAYBE_SPANISH' }).errors?.languageSource === 'election_required');
  ok('G08: a system default is explicitly NOT signable',
    createSoaInstance({ ...baseInput, languageSource: 'SYSTEM_DEFAULT' }).errors?.languageSource === 'not_an_election');
  ok('G08: an inference from the lead is explicitly NOT signable',
    createSoaInstance({ ...baseInput, languageSource: 'INFERRED_FROM_LEAD' }).errors?.languageSource === 'not_an_election');
  ok('G08: a representative may elect it — when the record names the representative',
    createSoaInstance({ ...baseInput, soaId: 'soa_rep', languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: 'Daughter, power of attorney' }).ok === true);
  ok('G08: the election is carried on the instance',
    createSoaInstance(baseInput).instance.languageSource === 'BENEFICIARY_ELECTED');
  ok('G08: languageWasElected separates a choice from a fallback',
    languageWasElected('BENEFICIARY_ELECTED') && languageWasElected('REPRESENTATIVE_ELECTED') &&
    !languageWasElected('SYSTEM_DEFAULT') && !languageWasElected('INFERRED_FROM_LEAD') &&
    !languageWasElected(undefined) && !languageWasElected('es'));
  ok('SOA-01: requiresNewInstance is no longer silent on a lowercase in-person',
    requiresNewInstance(voice, { ...appt, format: 'in_person' }, CMS_RULESET_2027) === true);

  // SOA-02: the ruleset was optional, so omitting it switched three rules off.
  ok('SOA-02: no ruleset refuses', marketingGate(done, appt).reason === 'RULESET_UNRESOLVED');
  ok('SOA-02: a null ruleset refuses', marketingGate(done, appt, null).reason === 'RULESET_UNRESOLVED');
  ok('SOA-02: a fabricated empty-soa ruleset refuses',
    marketingGate(voiceInPerson, { ...appt, format: 'IN_PERSON' }, { planYear: 2027, status: 'PRODUCTION_ACTIVE', soa: {} }).reason === 'RULESET_INCOMPLETE');
  ok('SOA-02: the SUPERSEDED 2026 ruleset cannot govern live work',
    marketingGate({ ...done, planYear: 2026 }, appt, CMS_RULESET_2026).reason === 'RULESET_NOT_ACTIVE');
  ok('SOA-02: the regulatory kill switch closes the gate',
    marketingGate(done, appt, CMS_RULESET_2027, { env: { CY2027_REGULATORY_KILL: '1' } }).reason === 'REGULATORY_KILL_ENGAGED');
  ok('SOA-02: the kill switch off leaves the gate working',
    marketingGate(done, appt, CMS_RULESET_2027, { env: {} }).allowed === true);

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
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: granted, doNotContact: false }).allowed === true);
  ok('human callback blocked without it',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: null, doNotContact: false }).reason === 'NO_CALLBACK_CONSENT');
  ok('do-not-contact overrides a prior grant',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: granted, doNotContact: true }).reason === 'DO_NOT_CONTACT');
  ok('AI outbound blocked without its own consent',
    mayPlaceOutbound({ mode: 'AI_AUTOMATED', callbackConsent: granted, doNotContact: false }).reason === 'NO_AI_OUTBOUND_CONSENT');
  ok('AI outbound still blocked WITH consent until the architecture is validated',
    mayPlaceOutbound({ mode: 'AI_AUTOMATED', aiOutboundConsent: mk('AI_OUTBOUND_VOICE_CONSENT', CONSENT_STATUS.GRANTED), doNotContact: false }).reason
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

  // Historical rendering must now be explicit (EF-08): a config that merely
  // carries an old variant no longer serves old wording by accident.
  const cy26 = { ...TPMO_DISCLAIMER_CONFIG, contractYearVariant: 'CY2026', pinContractYearVariant: true };
  ok('the CY2026 wording is still reachable for historical records',
    /State Health Insurance/i.test(tpmoDisclaimerText('en', cy26)));
  ok('EF-08: an unpinned old variant does NOT serve old wording after the cut-over',
    !/State Health Insurance/i.test(tpmoDisclaimerText('en', { ...TPMO_DISCLAIMER_CONFIG, contractYearVariant: 'CY2026' })));
  ok('EF-07: the counts config cannot be flipped at runtime',
    (() => { try { TPMO_DISCLAIMER_CONFIG.status = 'VERIFIED'; } catch { /* strict mode */ }
      return TPMO_DISCLAIMER_CONFIG.status === 'BLOCKED_COUNTS_REQUIRED'; })());
  ok('EF-07: the config is frozen', Object.isFrozen(TPMO_DISCLAIMER_CONFIG) === true);
  for (const bad of [null, undefined, 123, {}, '']) {
    throws(`EF-02: a non-string disclaimer (${JSON.stringify(bad)}) cannot be signed`,
      () => assertDisclaimerSignable(bad), /without a disclaimer string/);
  }
  ok('EF-02: other placeholder shapes are caught',
    ['We represent {X} organizations', 'We represent <Y> products', 'We represent [ X ] orgs']
      .every((s) => { try { assertDisclaimerSignable(s); return false; } catch { return true; } }));

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
    mayReissue(record, 'COMPLETED').reason === 'SOA_STATUS_DOES_NOT_PERMIT_REISSUE');
  ok('re-issuing before signature is fine', mayReissue(record, 'PENDING_SIGNATURE').allowed === true);
  ok('re-issuing a revoked link is refused', mayReissue(revokeLink(record), 'PENDING_SIGNATURE').reason === 'LINK_REVOKED');
  // SL-02 — an unknown or failed status must not mint a fresh signing link.
  ok('SL-02: an unknown status refuses', mayReissue(record, undefined).reason === 'SOA_STATUS_DOES_NOT_PERMIT_REISSUE');
  ok('SL-02: a superseded instance refuses', mayReissue(record, 'SUPERSEDED').reason === 'SOA_STATUS_DOES_NOT_PERMIT_REISSUE');
  ok('SL-02: a revoked instance refuses', mayReissue(record, 'REVOKED').reason === 'SOA_STATUS_DOES_NOT_PERMIT_REISSUE');
  ok('SL-02: a consumed link refuses', mayReissue(consumeLink(record).record, 'PENDING_SIGNATURE').reason === 'LINK_ALREADY_USED');
  // SL-03 — checkLink must not fail open.
  ok('SL-03: a missing expiry fails closed', checkLink({ ...record, expiresAt: undefined }).reason === 'LINK_EXPIRY_UNREADABLE');
  ok('SL-03: an unparseable expiry fails closed', checkLink({ ...record, expiresAt: 'later' }).reason === 'LINK_EXPIRY_UNREADABLE');
  ok('SL-03: a falsy-but-present revokedAt still counts as revoked', checkLink({ ...record, revokedAt: '' }).reason === 'LINK_REVOKED');
  ok('SL-03: a falsy-but-present consumedAt still counts as used', checkLink({ ...record, consumedAt: 0 }).reason === 'LINK_ALREADY_USED');
  ok('SL-03: a non-numeric view count fails closed', checkLink({ ...record, views: 'many' }).reason === 'LINK_VIEW_LIMIT');

  ok('views are counted for abuse detection', recordView(record).views === 1);
}

// ── 12. The SERVER enforces CY2027, not just the browser ─────────────────────
// Found by the Phase 0 audit (CY2027-SRV-01): the form resolved the state
// ruleset, required an appointment and submitted planYear / residenceState /
// stateRulesetVersion / soaFormVersion, and api/sign-soa.js dropped all four.
// These are SOURCE assertions, not behavioural ones — the handler short-circuits
// on SOA_ENABLED=false, so it cannot be exercised end to end until enablement.
// They are deliberately written to fail if the wiring is removed again.
{
  const SRC = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');

  ok('server imports the ruleset resolver', /import \{[^}]*resolveRuleset[^}]*\} from '\.\/_lib\/cy2027\/rulesets\.js'/.test(SRC));
  ok('server imports the state resolver', /import \{[^}]*resolveStateRuleset[^}]*\} from '\.\/_lib\/cy2027\/state-rules\.js'/.test(SRC));
  ok('server imports the instance builder', /createSoaInstance/.test(SRC) && /completeSoaInstance/.test(SRC));
  ok('server imports the evidence builder', /buildEvidenceRecord/.test(SRC));

  ok('server resolves the plan year from its own clock, not the body',
    /resolveRuleset\(null\)/.test(SRC), 'resolveRuleset(null) not found');
  ok('server fails closed when no ruleset governs', /SOA_RULESET_UNAVAILABLE/.test(SRC));
  ok('server gates on the state ruleset', /resolveStateRuleset\(residenceState/.test(SRC));
  ok('server returns a named state reason', /SOA_STATE_GATE/.test(SRC));
  ok('server treats the browser versions as a claim to check', /SOA_VERSION_MISMATCH/.test(SRC));
  ok('server refuses an SOA that authorizes nothing', /SOA_INCOMPLETE/.test(SRC));
  ok('server derives the authorized scope from the instance, not the body',
    /var products = instance\.authorizedCategories;/.test(SRC));
  ok('server locks the gate when evidence cannot be built', /SOA_EVIDENCE_FAILED/.test(SRC));

  ok('the CMS-10566 product codes are gone from the server',
    !/'MA_only'|'MAPD'|'DVH_HI'/.test(SRC), 'legacy taxonomy still present');
  ok('the server no longer reads a date of birth', !/body\.dob/.test(SRC));
  ok('the plan year reaches the CRM', /soa_plan_year/.test(SRC));
  ok('the ruleset version reaches the CRM', /soa_state_ruleset_version/.test(SRC));
  ok('the integrity hash reaches the CRM', /soa_integrity_hash/.test(SRC));
  ok('the PDF prints the plan year', /Plan\/contract year/.test(SRC));
  ok('the PDF prints what was NOT authorized', /Not authorized at this appointment/.test(SRC));

  // The enablement gate must still refuse, and must now also know about this.
  const CONTENT = readFileSync(new URL('../src/lib/soaContent.ts', import.meta.url), 'utf8');
  ok('enablement tracks server-side CY2027 enforcement', /serverEnforcesCy2027/.test(CONTENT));
  ok('SOA is still disabled', /export const SOA_ENABLED = false/.test(CONTENT));

  // Evidence must be stored BEFORE the instance is completed, or not at all.
  ok('server stores evidence before completing the instance',
    SRC.indexOf('putEvidence(') < SRC.indexOf('completeSoaInstance('), 'ordering reversed');
  ok('a storage failure refuses rather than completing', /SOA_EVIDENCE_NOT_STORED/.test(SRC));
  ok('the evidence URI becomes the evidence reference', /evidenceReference: stored\.uri/.test(SRC));
  ok('the evidence URI reaches the CRM', /soa_evidence_uri/.test(SRC));
  ok('the signed record gets the evidence retention class, not the link TTL',
    /soa-signed:/.test(SRC) && /SIGNED_RECORD_TTL_SEC/.test(SRC));
}

// ── 13. The SOA link no longer leaks on possession ───────────────────────────
{
  const TOK = readFileSync(new URL('../api/soa-token.js', import.meta.url), 'utf8');
  const STAT = readFileSync(new URL('../api/soa-status.js', import.meta.url), 'utf8');
  const SRC = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');

  ok('token issuer uses the CY2027 secure link', /issueLink\(/.test(TOK));
  ok('token issuer no longer mints a bare UUID as the link', !/var token = crypto\.randomUUID\(\)/.test(TOK));
  ok('the lead data is stored apart from the link', /leadKey\(beneficiaryRef\)/.test(TOK));
  ok('the issuer tells the UI which factor to ask for', /factorRequired/.test(TOK));
  ok('a failed storage write refuses the link', /Token storage failed/.test(TOK) && /503/.test(TOK));

  ok('status GET no longer returns a lead object',
    !/lead: \{\s*\n?\s*fullName: rec\.fullName/.test(STAT), 'old disclosure shape still present');
  ok('status exposes only the required factor before verification',
    /linkDisclosure\(rec, \{ factorVerified: false \}\)/.test(STAT));
  ok('status verifies the factor on POST', /verifySecondFactor\(/.test(STAT));
  ok('status persists the attempt counter', /setRecord\(storeKeyFor\(ptoken\), verdict\.record/.test(STAT));
  ok('status rate-limits the factor attempt harder than the probe', /prefix: 'soa-factor'/.test(STAT));
  ok('status accepts the opaque token shape, not a UUID', /A-Za-z0-9_-\]\{40,64\}/.test(STAT));

  ok('signing requires the factor to have been verified', /SECOND_FACTOR_REQUIRED/.test(SRC));
  ok('signing burns the link', /consumeLink\(link\)/.test(SRC));
  ok('a link that cannot be burned refuses to sign', /SOA_LINK_BURN_FAILED/.test(SRC));
  ok('signing loads the lead through the opaque reference', /leadKey\(link\.beneficiaryRef\)/.test(SRC));

  const PAGE = readFileSync(new URL('../src/pages/SignSOA.tsx', import.meta.url), 'utf8');
  ok('the page has a second-factor step', /'challenge'/.test(PAGE));
  ok('the page POSTs the factor', /\/api\/soa-status'/.test(PAGE) && /factor: factorValue/.test(PAGE));
  ok('a used link says "already signed", not "not found"', /LINK_ALREADY_USED.*alreadyConsumed|alreadyConsumed.*LINK_ALREADY_USED/s.test(PAGE));
  ok('a locked link sends the person to a human', /SECOND_FACTOR_LOCKED|'locked'/.test(PAGE));
}

// ── 14. Prohibited signals never reach the commercial scorer ─────────────────
// Spec §15 and the §33 immediate-fail line on medical detail in scoring.
// Tested in BOTH directions: the attribute must go, and the legitimate Medicare
// process detail an advisor needs must stay.
{
  const red = (s) => redactProhibitedForScoring(s);

  // Medical detail.
  const m1 = red('The caller has diabetes and asked when his coverage starts.');
  ok('a diagnosis is removed', !/diabetes/i.test(m1.text), m1.text);
  ok('a diagnosis raises the licensed-review flag', m1.flags.includes(SIGNAL_FLAGS.MEDICAL));
  ok('the rest of the sentence survives', /coverage starts/i.test(m1.text), m1.text);
  ok('a diagnosis requires licensed review', requiresLicensedReview(m1.flags) === true);

  const m2 = red('Me diagnosticaron cáncer el año pasado y quiero saber sobre la Parte B.');
  ok('a Spanish diagnosis is removed', !/cáncer/i.test(m2.text), m2.text);
  ok('the Spanish Medicare question survives', /Parte B/i.test(m2.text), m2.text);

  ok('medications are removed', !/lisinopril/i.test(red('My medications include lisinopril daily.').text));
  ok('disability status is removed', !/on disability/i.test(red('He is on disability since 2019.').text));

  // Benefit status — self-reported, never a score.
  const b1 = red('Caller says she has Medicaid and Medicare, dual-eligible.');
  ok('Medicaid status is removed', !/medicaid/i.test(b1.text), b1.text);
  ok('dual-eligible is removed', !/dual-eligible/i.test(b1.text), b1.text);
  ok('benefit status raises its own flag', b1.flags.includes(SIGNAL_FLAGS.BENEFIT_STATUS));
  ok('benefit status alone does NOT force licensed review', requiresLicensedReview([SIGNAL_FLAGS.BENEFIT_STATUS]) === false);
  ok('Extra Help is removed', !/extra help/i.test(red('He gets Extra Help with his drug costs.').text));
  ok('LIS is removed', !/\bLIS\b/.test(red('Qualified for LIS last year.').text));

  // Financial.
  const f1 = red("I can't afford the premium right now.");
  ok('inability to pay is removed', !/afford/i.test(f1.text), f1.text);
  ok('financial hardship requires licensed review', requiresLicensedReview(f1.flags) === true);

  // Demographic / immigration.
  ok('ethnicity is removed', !/hispanic/i.test(red('I am Hispanic and turning 65.').text));
  ok('immigration status is removed', !/green card/i.test(red('She has a green card.').text));

  // ── The other direction: legitimate Medicare talk must survive intact ──
  const keep = [
    'The caller is turning 65 in March and wants to know about enrollment periods.',
    'She has Medicare Part A and Part B already and asked about Part D.',
    'He moved from New Jersey to New York and wants to know what changes.',
    'Lost employer coverage last month, asking about a special enrollment period.',
    'Quiere saber la diferencia entre Medicare Advantage y Medigap.',
    'Asked whether the appointment can be by phone instead of in person.',
  ];
  for (const s of keep) {
    const r = red(s);
    ok(`legitimate Medicare detail survives: "${s.slice(0, 44)}…"`, r.text === s && r.flags.length === 0, r.text);
  }
  ok('"Medicare" is never confused with "Medicaid"', red('He has Medicare only.').flags.length === 0);

  // The redactor must actually finish the job.
  const dirty = 'I have cancer, I get Extra Help, and I cannot afford my medications.';
  const cleaned = red(dirty);
  ok('nothing prohibited survives a combined note', findProhibited(cleaned.text).length === 0, cleaned.text);
  ok('a combined note raises every relevant flag', cleaned.flags.length >= 2, JSON.stringify(cleaned.flags));
  ok('empty input is safe', red('').text === '' && red(null).flags.length === 0);

  // Third-person financial hardship — a note written ABOUT the caller.
  ok('third-person inability to pay is removed', !/afford/i.test(red('She cannot afford the premium.').text));
  ok('third-person hardship requires licensed review', requiresLicensedReview(red('He could not afford it.').flags) === true);
  ok('"the caller cannot afford" is removed', !/afford/i.test(red('The caller cannot afford her medications.').text));

  // DM-07/DM-09 — the lead pipeline must apply this before the CRM note.
  const SL = readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8');
  ok('DM-09: the lead notes are filtered before the CRM', /redactProhibitedForScoring\(lead_notes\)/.test(SL));
  ok('DM-09: the conversation summary is filtered too', /redactProhibitedForScoring\(conversation_summary\)/.test(SL));
  ok('DM-09: the filter runs AFTER the PHI scrub, on the scrubbed text',
    SL.indexOf('lead_notes = _scrubNotes.text;') < SL.indexOf('redactProhibitedForScoring(lead_notes)'));
  ok('CRM-24: licensed review is set deterministically', /LICENSED_AGENT_REVIEW_REQUIRED'\)/.test(SL));
  ok('DM-09: only the category is logged, never the phrase', /\[DATA-MIN\][\s\S]{0,120}flags: _dmFlags/.test(SL));

  // FTQ — the trust engine is wired into the live lead pipeline, as a SIGNAL.
  ok('FTQ-08: ZIP/state inconsistency becomes a review signal in the lead path',
    /IMPOSSIBLE_STATE_ZIP/.test(SL) && /zipStateConsistency\(zip, derived_state\)/.test(SL));
  ok('FTQ-08: IP velocity becomes a review signal', /DEVICE_IP_VELOCITY/.test(SL));
  ok('FTQ-10: mass submission becomes a review signal', /REPEATED_MASS_SUBMISSION/.test(SL));
  ok('FTQ-06: a security review task is built for a flagged lead', /buildSecurityReviewTask\(\{/.test(SL));
  ok('FTQ-06: the task records that AI may not approve it', /aiMayApprove/.test(SL));
  ok('FTQ-16: nothing in the lead path rejects on a trust signal',
    !/_trust[\s\S]{0,200}return res\.status\(4/.test(SL), 'a trust signal can reject a lead');
  ok('the trust state travels as a flag', /_dmFlags\.push\('TRUST_'/.test(SL));

  // And the scorer must be wired to it.
  const LI = readFileSync(new URL('../api/_lib/lead-intel.js', import.meta.url), 'utf8');
  ok('the scorer redacts before building its payload',
    LI.indexOf('redactProhibitedForScoring(notes)') < LI.indexOf('=== Lead notes / conversation ==='), 'ordering wrong');
  ok('the structured metadata is filtered too', /redactProhibitedForScoring\(meta\(metadata\.medicareStatus/.test(LI));
  ok('the Medicaid example is gone from the system prompt', !/dual eligible/i.test(LI), 'prompt still suggests flagging Medicaid');
  ok('the prompt forbids scoring on prohibited attributes', /NEVER use any of the following to set intent_strength/.test(LI));
  ok('the scorer emits licensed_agent_review_required', /licensed_agent_review_required/.test(LI));
}

// ── 15. RED TEAM 2026-10-02 — reproduced criticals, pinned ───────────────────
{
  const appt = { appointmentId: 'appt_1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
  const mk = (over = {}) => createSoaInstance({ ...baseInput, ...over });
  const sign = (inst, over = {}) => completeSoaInstance(inst, {
    completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev', ...over,
  });
  const done = sign(mk({ soaId: 'rt_1' }).instance);

  // SOA-04 — the ordering rule must not be skippable by omitting a timestamp.
  ok('SOA-04: an appointment with no start time is refused',
    marketingGate(done, { appointmentId: 'appt_1', state: 'NY', format: 'TELEPHONE' }, CMS_RULESET_2027).reason === 'APPOINTMENT_TIME_UNKNOWN');
  ok('SOA-04: an unparseable start time is refused',
    marketingGate(done, { ...appt, startsAt: 'whenever' }, CMS_RULESET_2027).reason === 'APPOINTMENT_TIME_UNKNOWN');
  ok('SOA-04: an unparseable signature time is refused',
    marketingGate({ ...done, completedAt: 'soon' }, appt, CMS_RULESET_2027).reason === 'APPOINTMENT_TIME_UNKNOWN');

  // SOA-05 — scope cannot be widened after signature.
  ok('SOA-05: a completed instance is frozen', Object.isFrozen(done) === true);
  ok('SOA-05: its authorized list is frozen', Object.isFrozen(done.authorizedCategories) === true);
  ok('SOA-05: a widened scope is refused',
    marketingGate({ ...done, authorizedCategories: ['MA_WITH_RX', 'STANDALONE_RX'] }, appt, CMS_RULESET_2027).reason === 'SOA_SCOPE_CONTRADICTORY');
  ok('SOA-05: an unknown category in the scope is refused',
    marketingGate({ ...done, authorizedCategories: ['NOT_A_CODE'] }, appt, CMS_RULESET_2027).reason === 'SOA_SCOPE_INVALID');
  ok('SOA-05: the non-authorizing option cannot be smuggled into the scope',
    marketingGate({ ...done, authorizedCategories: ['UNSURE_DISCUSS_PROCESS'] }, appt, CMS_RULESET_2027).reason === 'SOA_SCOPE_INVALID');
  ok('SOA-05: an empty scope is refused',
    marketingGate({ ...done, authorizedCategories: [] }, appt, CMS_RULESET_2027).reason === 'SOA_SCOPE_EMPTY');

  // SOA-03 — a replaced or withdrawn instance cannot be revived.
  const sup = superseded(done, { ...baseInput, soaId: 'rt_2' });
  throws('SOA-03: a superseded instance cannot be completed again',
    () => sign(sup.previous, { evidenceReference: 'ev2' }), /superseded/);
  throws('SOA-03: a revoked instance cannot be completed',
    () => sign(revokeSoaInstance(mk({ soaId: 'rt_3' }).instance)), /revoked/);
  throws('SOA-03: a completed instance cannot be completed twice',
    () => sign(done), /already completed/);

  // CT-02 — automation must not self-approve a quarantine.
  const task = buildSecurityReviewTask({ requestId: 'r', state: 'NY' });
  for (const actor of ['AI-Agent', 'svc_bot', 'automation-1', 'claude', 'assistant', 'workflow-runner', 'sys', 'api-user', 'GPT', '12345']) {
    throws(`CT-02: "${actor}" cannot resolve a quarantine`,
      () => resolveSecurityReview(task, { actor, decision: 'CONFIRMED', reasonCode: 'x' }), /human reviewer|not a human/);
  }
  ok('CT-02: a named person still can',
    resolveSecurityReview(task, { actor: 'Sawil Reyes', decision: 'CONFIRMED', reasonCode: 'CALLED_BACK' }).reviewer === 'Sawil Reyes');

  // CT-03 — a consent of the wrong type authorizes nothing.
  const rec = createConsent({ type: 'RECORDING_NOTICE', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'VOICE', scriptVersion: 'v1', scope: 'recording' });
  const soaC = createConsent({ type: 'SCOPE_OF_APPOINTMENT', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'categories' });
  ok('CT-03: a recording notice is not callback permission',
    isAffirmative(rec, 'CALLBACK_CONTACT_PERMISSION') === false);
  ok('CT-03: an SOA is not callback permission',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: soaC, doNotContact: false }).reason === 'NO_CALLBACK_CONSENT');
  ok('CT-03: a recording notice is not AI outbound consent',
    mayPlaceOutbound({ mode: 'AI_AUTOMATED', aiOutboundConsent: rec, doNotContact: false }).reason === 'NO_AI_OUTBOUND_CONSENT');
  ok('CT-03: the right type still works',
    isAffirmative(createConsent({ type: 'CALLBACK_CONTACT_PERMISSION', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 's' }), 'CALLBACK_CONTACT_PERMISSION') === true);

  // EF-01 / PG-02 — the registry must not be reachable as data.
  ok('EF-01: CARRIER_OVERLAYS is not exported from the module',
    !('CARRIER_OVERLAYS' in overlayModule), 'the carrier registry is still a public export');
  ok('EF-01: nor from the CY2027 barrel', !('CARRIER_OVERLAYS' in barrelModule));
  ok('EF-01: the guarded accessor still works',
    overlayInventory('LICENSED_AGENT_WORKSPACE').length === 10);

  // ── HIGH findings, pinned ────────────────────────────────────────────────
  // EF-03/EF-04 — the audit log must not leak through arrays or key spellings.
  const leaky = auditEvent({
    action: 'SOA_SIGNED', actor: 'a', result: 'OK', source: 'WEB', correlationId: 'c',
    details: {
      people: [{ ssn_number: '123-45-6789' }, { socialSecurity: '987654321' }],
      memberId: '1EG4TE5MK73', accountNumber: '12345678', dateOfBirth: '1950-01-01',
      accessToken: 'tok_live_x', zip: '11717',
    },
  });
  ok('EF-03: arrays are walked, not skipped', leaky.details.people[0].ssn_number === '[redacted]');
  ok('EF-03: every array element is walked', leaky.details.people[1].socialSecurity === '[redacted]');
  ok('EF-04: memberId is redacted', leaky.details.memberId === '[redacted]');
  ok('EF-04: accountNumber is redacted', leaky.details.accountNumber === '[redacted]');
  ok('EF-04: dateOfBirth is redacted', leaky.details.dateOfBirth === '[redacted]');
  ok('EF-04: accessToken is redacted', leaky.details.accessToken === '[redacted]');
  ok('EF-04: the non-sensitive field survives', leaky.details.zip === '11717');

  // EF-06 — backdating a record must break its hash.
  const inst6 = completeSoaInstance(createSoaInstance({ ...baseInput, soaId: 'ef6' }).instance,
    { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'p', evidenceReference: 'e' });
  const { record: r6 } = buildEvidenceRecord(inst6, { stateName: 'New York', signature: 'Jane Q Public' });
  ok('EF-06: an intact record verifies', verifyEvidence(r6).ok === true);
  ok('EF-06: backdating createdAt is detectable',
    verifyEvidence({ ...r6, createdAt: '2020-01-01T00:00:00Z' }).reason === 'HASH_MISMATCH');
  ok('EF-06: applying a legal hold is NOT tampering',
    verifyEvidence(applyHold(r6, 'CMS_INQUIRY')).ok === true);

  // JR-02/03/07 — retention must never purge what it cannot read.
  for (const cls of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    ok(`JR-02: recordClass "${cls}" is not a retention class`,
      mayPurge({ recordClass: cls, createdAt: '1990-01-01T00:00:00Z' }).reason === 'UNKNOWN_RECORD_CLASS');
  }
  const oldEv = { recordClass: RECORD_CLASS.SOA_EVIDENCE, createdAt: '2010-01-01T00:00:00Z' };
  ok('JR-03: a non-array holds value blocks the purge',
    mayPurge({ ...oldEv, holds: 'LEGAL_HOLD' }).reason === 'HOLDS_UNREADABLE');
  ok('JR-03: an object holds map blocks the purge',
    mayPurge({ ...oldEv, holds: { LEGAL_HOLD: true } }).reason === 'HOLDS_UNREADABLE');
  ok('JR-03: a falsy entry in the holds list blocks the purge',
    mayPurge({ ...oldEv, holds: [null] }).reason === 'HOLDS_UNREADABLE');
  ok('JR-07: applyHold refuses an unreadable holds list',
    (() => { try { applyHold({ ...oldEv, holds: 'x' }, 'COMPLAINT'); return false; } catch { return true; } })());
  ok('JR-07: applyHold survives a falsy entry',
    applyHold({ ...oldEv, holds: [null, { reason: 'COMPLAINT', at: 'x' }] }, 'CMS_INQUIRY').holds.length === 2);
  ok('JR-07: releaseHold rejects an unknown reason',
    (() => { try { releaseHold(oldEv, 'BECAUSE', { actor: 'sawil' }); return false; } catch { return true; } })());

  // CT-06 — an unrecognized trust state must not skip the human gate.
  for (const bad of [undefined, null, 'security_quarantine', { state: 'SECURITY_QUARANTINE' }, 'TYPO']) {
    const c = trustCapabilities(bad);
    ok(`CT-06: unknown trust state ${JSON.stringify(bad)} is treated as quarantined`,
      c.requiresHumanReview === true && c.mayExposeCrmData === false && c.mayCreateHomeVisit === false);
  }
  ok('CT-06: a real verified state still works',
    trustCapabilities(LEAD_TRUST_STATE.VERIFIED_REQUEST).mayExposeCrmData === true);

  // CT-05 — the review task must not carry prohibited detail in allowed fields.
  const t5 = buildSecurityReviewTask({
    requestId: 'r', state: 'NY', channel: 'caller said he has cancer and gets Extra Help',
    signals: ['DEVICE_IP_VELOCITY', 'note: Medicaid dual-eligible'],
  });
  ok('CT-05: prohibited detail in an allowed string field is removed',
    !/cancer/i.test(t5.facts.channel) && !/extra help/i.test(t5.facts.channel), t5.facts.channel);
  ok('CT-05: prohibited detail inside an allowed array is removed',
    !/medicaid/i.test(JSON.stringify(t5.facts.signals)), JSON.stringify(t5.facts.signals));
  ok('CT-05: the legitimate signal survives', /DEVICE_IP_VELOCITY/.test(JSON.stringify(t5.facts.signals)));

  // CT-01 — a refusal anywhere in the reply beats an affirmative opening.
  for (const s of ['yes I said no', 'yes, do not call me', 'sí pero no', 'yes — stop calling', 'si, no me llame']) {
    ok(`CT-01: "${s}" is a refusal, not a grant`, classifyReply(s) === CONSENT_STATUS.DECLINED, classifyReply(s));
  }
  ok('CT-01: a long sentence opening with "yes" goes back for clarification',
    classifyReply('yes well I suppose that could be alright if you really need to') === CONSENT_STATUS.UNCLEAR);
  ok('CT-01: a plain yes is still a grant', classifyReply('yes') === CONSENT_STATUS.GRANTED);
  ok('CT-01: a short explicit yes is still a grant', classifyReply('yes you may call me') === CONSENT_STATUS.GRANTED);

  // CT-04 — the cross-inference guard is not defeated by capitalization.
  for (const variant of ['website_browsing', 'Website Browsing', 'WEBSITE-BROWSING', ' website_browsing ']) {
    throws(`CT-04: "${variant}" is still a banned source`,
      () => assertNoCrossInference('SCOPE_OF_APPOINTMENT', variant), /never be inferred/);
  }
  throws('CT-04: an empty source is refused', () => assertNoCrossInference('SCOPE_OF_APPOINTMENT', ''), /source signal is required/);

  // CT-07 — not having checked the suppression list is not "no DNC".
  ok('CT-07: an absent do-not-contact flag refuses',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: createConsent({ type: 'CALLBACK_CONTACT_PERMISSION', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'this request' }) }).reason === 'DO_NOT_CONTACT_STATUS_UNKNOWN');
  ok('CT-07: a purpose outside the stated scope refuses',
    mayPlaceOutbound({
      mode: 'HUMAN_LICENSED_AGENT', doNotContact: false, purpose: 'plan marketing',
      callbackConsent: createConsent({ type: 'CALLBACK_CONTACT_PERMISSION', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'this request' }),
    }).reason === 'PURPOSE_OUTSIDE_CONSENT_SCOPE');

  // JR-04 / JR-06 / JR-09 / EF-05.
  ok('JR-04: an unreadable clock fails closed',
    resolveStateRuleset('NY', 2027, 'not-a-date').reason === 'CLOCK_UNREADABLE');
  ok('JR-06: automation cannot release a legal hold',
    (() => { try { releaseHold(applyHold({ recordClass: RECORD_CLASS.SOA_EVIDENCE, createdAt: '2010-01-01T00:00:00Z' }, 'CMS_INQUIRY'), 'CMS_INQUIRY', { actor: 'automation-1' }); return false; } catch { return true; } })());
  ok('JR-06: releasing a hold that was never applied refuses',
    (() => { try { releaseHold({ recordClass: RECORD_CLASS.SOA_EVIDENCE, createdAt: '2010-01-01T00:00:00Z' }, 'COMPLAINT', { actor: 'Sawil Reyes' }); return false; } catch { return true; } })());
  setCountyDataset({ '10001': ['New York', null] });
  ok('JR-09: a malformed dataset entry asks instead of guessing',
    resolveCounty('10001', 'NY').reason === 'DATASET_ENTRY_MALFORMED');
  setCountyDataset(null);
  ok('EF-05: a structured actor is redacted too',
    auditEvent({ action: 'SOA_SIGNED', actor: { name: 'x', ssn: '123-45-6789' }, result: 'OK', source: 'WEB', correlationId: 'c' }).actor.ssn === '[redacted]');

  // SOA-06 — an appointment with no state cannot skip the jurisdiction check.
  {
    const inst = completeSoaInstance(createSoaInstance({ ...baseInput, soaId: 'soa06' }).instance,
      { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'h', evidenceReference: 'e' });
    ok('SOA-06: a stateless appointment is refused',
      marketingGate(inst, { appointmentId: 'appt_1', startsAt: '2026-11-10T15:00:00Z', format: 'TELEPHONE' }, CMS_RULESET_2027).reason === 'APPOINTMENT_STATE_UNKNOWN');
  }
}

// ── 16. Carrier firewall in the public layer (spec §16, §20, §21, §33) ───────
{
  const say = (t, l = 'en') => { const r = complianceFilter(t, l); return typeof r === 'string' ? r : (r.text || ''); };
  const removed = (t, l = 'en') => say(t, l) !== t;

  // CBF-04 — ranking expressed as a COMPARISON, not a superlative.
  ok('CBF-04: "better … than" ranking is removed',
    removed('An HMO plan is better for someone with your doctors than a PPO.'));
  ok('CBF-04: "that plan is worse" is removed',
    removed('That plan is worse on drug costs than the other option.'));
  ok('CBF-04: Spanish "le conviene más" is removed',
    removed('Ese plan le conviene más que el otro.', 'es'));
  ok('CBF-04: Spanish "es más barato" ranking is removed',
    removed('Ese plan es más barato para usted.', 'es'));
  // The other direction — ordinary comparatives are not rankings.
  for (const s of [
    'Part B is better explained by Medicare than by me.',
    'Starting later is worse for you because of the late penalty.',
    'A licensed advisor can compare the options with you at no cost.',
  ]) ok(`CBF-04: legitimate comparative survives: "${s.slice(0, 40)}…"`, !removed(s), say(s));

  // CBF-03 — descriptive plan-specific premium / benefit figures.
  ok('CBF-03: a quoted plan premium is removed',
    removed('That plan has a $0 monthly premium and gives $150 a quarter for over-the-counter items.'));
  ok('CBF-03: a quoted copay is removed', removed("That plan's copay is $47 for tier 3."));
  ok('CBF-03: a named supplemental benefit attributed to a plan is removed',
    removed('Su plan incluye dental y visión.', 'es'));
  ok('CBF-03: a general Medicare figure survives',
    !removed('The 2027 Part B standard premium is $185.00 per month.'));
  ok('CBF-03: explaining the mechanism without a figure survives',
    !removed("This usually happens because the plan's deductible resets in January or the drug moved to a higher tier."));
  ok('CBF-03: a deferral survives',
    !removed('A licensed advisor can check whether that plan covers your dentist.'));
  ok('CBF-03: the Spanish non-quote survives',
    !removed('No puedo citar la prima de un plan específico; varía según el plan.', 'es'));

  // CBF-05 — the refusal is deterministic and routes, and names nothing.
  const CHAT = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8');
  ok('CBF-05: the carrier classifier now acts instead of only logging',
    /CARRIER-FIREWALL/.test(CHAT) && /_intentInfo\.intent === 'CARRIER_SPECIFIC_REQUEST'/.test(CHAT));
  ok('CBF-05: the refusal happens before the model is called',
    CHAT.indexOf('[CARRIER-FIREWALL]') < CHAT.indexOf('var messages = [];'), 'refusal is after the prompt is assembled');
  ok('CBF-05: the refusal escalates rather than dead-ending', /wantHandoff: true,[\s\S]{0,120}CARRIER_FIREWALL/.test(CHAT));
  const refusal = CHAT.match(/const CARRIER_REFUSAL = \{[\s\S]*?\n\};/)[0];
  ok('CBF-05: the refusal copy names no carrier',
    !/aetna|humana|unitedhealth|wellcare|clover|emblem|healthfirst|fidelis|anthem|connecticare|cigna/i.test(refusal), refusal.slice(0, 80));
  ok('CBF-05: the refusal copy exists in both languages', /\ben:/.test(refusal) && /\bes:/.test(refusal));
  const planRe = eval(CHAT.match(/const PLAN_RECOMMENDATION_RE = (\/[\s\S]*?\/i);/)[1]);
  for (const s of ['which plan is best for me?', 'what plan should I pick?', '¿cuál plan me conviene más?', '¿qué plan me recomienda?']) {
    ok(`CBF-05: "${s}" is refused deterministically`, planRe.test(s));
  }
  for (const s of ['what is a Part D plan?', 'when does my coverage start?', '¿cuál es el teléfono de Medicare?']) {
    ok(`CBF-05: legitimate question is not refused: "${s}"`, !planRe.test(s));
  }
}

// ── 17. CRM field mapping (spec §18, audit CRM-27) ───────────────────────────
{
  const inst = completeSoaInstance(createSoaInstance({ ...baseInput, soaId: 'crm_1' }).instance,
    { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:h', evidenceReference: 'https://store/x.pdf' });
  const vals = soaInstanceToFields(inst);

  ok('the instance flattens to spec §18 names', vals.SOA_PLAN_YEAR === 2027 && vals.SOA_STATE === 'NY');
  ok('the evidence URI is carried as a field', vals.SOA_EVIDENCE_URI === 'https://store/x.pdf');
  ok('the retention class travels with it', vals.RETENTION_CLASS === 'SOA_EVIDENCE');

  // With NO ids configured, nothing is sent and everything is reported.
  const none = buildCustomFields(vals, {});
  ok('nothing is sent when no field ID is configured', none.fields.length === 0);
  ok('every unwritable field is reported, not silently dropped', none.unmapped.length >= 15, String(none.unmapped.length));
  ok('the warning names the GHL keys the owner must create',
    /contact\.soa_plan_year/.test(unmappedFieldsWarning(none.unmapped)));
  ok('no warning when nothing is unmapped', unmappedFieldsWarning([]) === null);

  // With ids configured, only those are sent — and with a real id, not a name.
  const some = buildCustomFields(vals, { CY2027_CRM_FIELD_IDS: '{"SOA_PLAN_YEAR":"abc123","SOA_STATE":"def456"}' });
  ok('a configured field is sent with its real id', some.fields.some((f) => f.id === 'abc123'));
  ok('a configured field carries the canonical key', some.fields.some((f) => f.key === 'contact.soa_plan_year'));
  ok('only configured fields are sent', some.fields.length === 2);
  ok('the rest are still reported', some.unmapped.length === none.unmapped.length - 2);
  ok('a name is never used as an id', some.fields.every((f) => !/^contact\./.test(f.id) && !/^SOA_/.test(f.id)));

  // Malformed configuration must not break a signature.
  ok('malformed env yields an empty map', Object.keys(fieldIdMap({ CY2027_CRM_FIELD_IDS: 'not json' })).length === 0);
  ok('an unknown field name in the env is ignored',
    Object.keys(fieldIdMap({ CY2027_CRM_FIELD_IDS: '{"MADE_UP":"x"}' })).length === 0);

  // Empty values must never overwrite confirmed data.
  const withEmpty = buildCustomFields({ SOA_COUNTY: '', SOA_STATE: 'NY' }, { CY2027_CRM_FIELD_IDS: '{"SOA_COUNTY":"c1","SOA_STATE":"s1"}' });
  ok('an empty value is not written over a confirmed one', withEmpty.fields.length === 1 && withEmpty.fields[0].id === 's1');

  // The four consent objects become queryable values, not prose (CRM-14/16).
  const cf = consentsToFields({
    recordingNotice: createConsent({ type: 'RECORDING_NOTICE', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'VOICE', scriptVersion: 'v1', scope: 'recording', at: '2026-10-02T10:00:00Z' }),
    callbackConsent: createConsent({ type: 'CALLBACK_CONTACT_PERMISSION', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'this request', at: '2026-10-02T10:05:00Z' }),
  });
  ok('CRM-16: the recording notice has its own status field', cf.RECORDING_NOTICE_STATUS === 'GRANTED');
  ok('CRM-14: the callback consent timestamp is a field, not prose', cf.CALLBACK_CONSENT_AT === '2026-10-02T10:05:00Z');
  ok('the callback scope is queryable', cf.CALLBACK_CONSENT_SCOPE === 'this request');
  ok('an absent consent produces no field', cf.AI_OUTBOUND_CONSENT_STATUS === undefined);

  const SRC = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');
  ok('sign-soa logs the unwritable fields on every signature', /unmappedFieldsWarning\(_cf\.unmapped\)/.test(SRC));
  ok('sign-soa forwards only the mapped fields', /cy2027CustomFields: _cf\.fields/.test(SRC));
}

// ── 18. The audit trail actually emits, and the TPMO year is pinned ──────────
{
  // EV-06 / WVG-18 / SEC-TOK-07 — auditEvent() existed and nothing called it,
  // so "audit every SOA view/sign/send/resend/revoke" was satisfied by a
  // function that never ran.
  const TOK = readFileSync(new URL('../api/soa-token.js', import.meta.url), 'utf8');
  const STAT = readFileSync(new URL('../api/soa-status.js', import.meta.url), 'utf8');
  const SIGN = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');

  ok('issuing a link is audited', /action: 'SOA_LINK_ISSUED'/.test(TOK));
  ok('viewing a link is audited', /action: 'SOA_VIEWED'/.test(STAT));
  ok('a failed second factor is audited', /attemptsRemaining: verdict\.attemptsRemaining/.test(STAT));
  ok('releasing the prefill is audited', /PREFILL_RELEASED/.test(STAT));
  ok('signing is audited', /action: 'SOA_SIGNED'/.test(SIGN));
  ok('evidence written is audited', /action: 'SOA_EVIDENCE_WRITTEN'/.test(SIGN));
  ok('evidence failure is audited', /action: 'SOA_EVIDENCE_WRITE_FAILED'/.test(SIGN));
  ok('a CRM failure is audited too', /result: 'CRM_WRITE_FAILED'/.test(SIGN));

  // The emitter must never take down a valid signature.
  let threw = false;
  try { emitAudit({ action: 'NOT_A_REAL_ACTION', actor: 'x', result: 'y', source: 'z', correlationId: 'c' }); }
  catch { threw = true; }
  ok('a bad audit event is logged, not thrown', threw === false);

  // CRM-21 — the channel proof is recorded rather than assumed.
  ok('CRM-21: channel verification status is written on signature',
    /CHANNEL_VERIFICATION_STATUS: 'VERIFIED'/.test(SIGN));
  ok('CRM-21: signing refuses without a verified factor', /SECOND_FACTOR_REQUIRED/.test(SIGN));

  // TPY-03 — year correctness of the TPMO disclaimer belongs in the battery,
  // not only in a build guard that a rebuild could silently pass.
  const nowYear = activePlanYear();
  const en = tpmoDisclaimerText('en');
  const es = tpmoDisclaimerText('es');
  if (nowYear >= 2027) {
    ok('TPY-03: the live EN disclaimer is the CY2027 variant', !/State Health Insurance/i.test(en), en);
    ok('TPY-03: the live ES disclaimer is the CY2027 variant', !/SHIP|Seguro de Salud/i.test(es), es);
  } else {
    ok('TPY-03: the live EN disclaimer is the CY2026 variant', /State Health Insurance/i.test(en), en);
  }
  ok('TPY-03: the disclaimer never ships a placeholder', !/\[X\]|\[Y\]/.test(en + es));
  ok('TPY-03: the ruleset and the renderer agree on the plan year',
    (nowYear >= 2027) === (CMS_RULESET_2027.tpmo.includesShipReference === false));
}

// ── 19. Outbound copy, quarantine stop and the county loader ─────────────────
{
  const grant = (type) => createConsent({ type, status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: 'this request' });

  // EV-07 — built, and OFF. Nothing may leave without all three conditions.
  ok('sending is disabled by default', sendingEnabled({}) === false);
  ok('a copy is refused while sending is disabled',
    maySendCopy({ channel: 'EMAIL', consent: grant('CALLBACK_CONTACT_PERMISSION'), env: {} }).reason === 'SENDING_DISABLED');
  ok('a copy is refused without a configured channel',
    maySendCopy({ channel: 'EMAIL', consent: grant('CALLBACK_CONTACT_PERMISSION'), env: { CY2027_SEND_BENEFICIARY_COPY: '1' } }).reason === 'CHANNEL_NOT_CONFIGURED');
  const fullEnv = { CY2027_SEND_BENEFICIARY_COPY: '1', CY2027_COPY_EMAIL_URL: 'https://x/y', CY2027_COPY_EMAIL_TOKEN: 't' };
  ok('a copy is refused without contact permission',
    maySendCopy({ channel: 'EMAIL', consent: null, env: fullEnv }).reason === 'NO_CONTACT_PERMISSION');
  // §6 — the SOA signature is NOT contact permission.
  ok('an SOA consent does not authorize a message',
    maySendCopy({ channel: 'EMAIL', consent: grant('SCOPE_OF_APPOINTMENT'), env: fullEnv }).reason === 'NO_CONTACT_PERMISSION');
  ok('with all three, it is allowed',
    maySendCopy({ channel: 'EMAIL', consent: grant('CALLBACK_CONTACT_PERMISSION'), env: fullEnv }).allowed === true);
  ok('an http (non-TLS) channel is not configured',
    maySendCopy({ channel: 'EMAIL', consent: grant('CALLBACK_CONTACT_PERMISSION'), env: { ...fullEnv, CY2027_COPY_EMAIL_URL: 'http://x/y' } }).reason === 'CHANNEL_NOT_CONFIGURED');

  // The message carries no beneficiary data and no marketing (§9).
  for (const lang of ['en', 'es']) {
    const m = buildCopyMessage({ soaId: 'soa_abc', evidenceLinkUrl: 'https://store/x', language: lang });
    const all = m.subject + ' ' + m.body;
    ok(`copy (${lang}) carries the reference`, all.includes('soa_abc'));
    ok(`copy (${lang}) states it is not an enrollment`, /not an enrollment|no es una inscripción/i.test(all));
    ok(`copy (${lang}) gives a way to report a signature they don't recognize`, /1-855-720-8555/.test(all));
    ok(`copy (${lang}) carries no categories or appointment detail`,
      !/MA_WITH_RX|Medicare Advantage plan with|appointment date|fecha de la cita/i.test(all));
    ok(`copy (${lang}) is not marketing`, (() => { try { assertNotMarketing(all); return true; } catch { return false; } })());
  }
  throws('a marketing phrase can never be sent',
    () => assertNotMarketing('Enroll now and save on the best plan!'), /may not carry marketing/);

  // FTQ-07 — the quarantine stop exists and is off.
  const SL2 = readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8');
  ok('FTQ-07: the quarantine stop is behind a flag', /CY2027_QUARANTINE_STOP/.test(SL2));
  ok('FTQ-07: the flag gates the opportunity, not the contact',
    /if \(contactId && !_holdForReview\)/.test(SL2));
  ok('FTQ-07: the hold is logged', /\[QUARANTINE-STOP\]/.test(SL2));

  // The county loader — a file drop, never a guess.
  const csv = 'zip,county\n11717,Suffolk\n10001,New York\n10001,Kings\nbad,Row\n06320,New London\n';
  const parsed = parseCountyCsv(csv);
  ok('the CSV loader reads valid rows', parsed.zips === 3, String(parsed.zips));
  ok('the CSV loader skips malformed rows instead of guessing', parsed.skipped === 1);
  setCountyDataset(parsed.dataset);
  ok('a single-county ZIP resolves from the CSV', resolveCounty('11717', 'NY').county === 'Suffolk');
  ok('a multi-county ZIP still asks the beneficiary', resolveCounty('10001', 'NY').status === 'ASK_BENEFICIARY');
  ok('both options are offered', resolveCounty('10001', 'NY').options.length === 2);
  setCountyDataset(null);
}

// ── 20. The SOA flow is carrier-free, and stays that way (spec §16) ──────────
// "No carrier logo, carrier name, plan name, premium, benefit, network,
//  formulary, ranking or recommendation appears in the SOA selection flow."
// This is the HARD prohibition, and unlike the marketing site it is entirely a
// code question — so it is pinned here rather than left to review.
{
  const CARRIERS = /\b(?:aetna|humana|unitedhealth(?:care)?|united\s+health|wellcare|centene|emblem(?:health)?|healthfirst|fidelis|anthem|empire\s+blue|connecticare|clover\s+health|cigna|healthspring|hcsc|devoted|elderplan|aarp)\b/i;
  const SOA_FLOW = [
    'src/pages/SignSOA.tsx',
    'src/components/SOAForm.tsx',
    'api/_lib/cy2027/soa-text.js',
    'api/_lib/cy2027/soa-instance.js',
    'api/sign-soa.js',
    'api/soa-token.js',
    'api/soa-status.js',
  ];
  for (const f of SOA_FLOW) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    // Strip comments: the carrier-overlay rationale is discussed in prose in a
    // couple of these files, and discussing the rule is not breaking it.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const hit = code.match(CARRIERS);
    ok(`§16: no carrier named in ${f}`, !hit, hit ? hit[0] : '');
  }
  // The approved text itself must stay carrier-neutral in both languages.
  const allText = JSON.stringify(SOA_TEXT) + JSON.stringify(SOA_CATEGORIES);
  ok('§16: the approved SOA wording names no carrier', !CARRIERS.test(allText));
  ok('§16: the refusal copy names no carrier either',
    !CARRIERS.test(readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8').match(/const CARRIER_REFUSAL = \{[\s\S]*?\n\};/)[0]));
}

// ── 21. The approved template's blocks are actually rendered ─────────────────
// G09/G18/G19/G20/G21/G24/G27 — the signature block has four entries plus the
// representative line, and the template prints a labeled "System evidence — not
// customer-editable" block. Both were missing: the person signed a document
// that could not say which form version or state ruleset governed it.
{
  const FORM = readFileSync(new URL('../src/components/SOAForm.tsx', import.meta.url), 'utf8');
  const SIGN2 = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');

  ok('G18: the form captures a printed name entry', /txt\.fields\.printedName/.test(FORM));
  ok('G20: the form shows the date/time', /txt\.fields\.signedAt/.test(FORM) && /signedAtDisplay/.test(FORM));
  ok('G21: the form shows the affirmation method', /txt\.fields\.affirmationMethod/.test(FORM));
  ok('G19/CE-03: the form captures the representative relationship',
    /txt\.fields\.representativeAuthority/.test(FORM) && /representativeAuthority\.trim\(\) \|\| null/.test(FORM));
  ok('G24: the form renders the system-evidence block', /System evidence/.test(FORM) && /Not customer-editable/.test(FORM));
  ok('G24: the block shows the form and ruleset versions',
    /SOA_FORM_VERSION/.test(FORM) && /STATE_RULESET_VERSION/.test(FORM));
  ok('G09: system-assigned values are labelled, not blank or invented',
    /systemGenerated/.test(FORM) && /Generated by the system on signing/.test(FORM));

  ok('G24: the PDF prints the system-evidence block', /System evidence — not/.test(SIGN2));
  ok('G27: the PDF prints the integrity hash', /'Integrity hash', opts\.integrityHash/.test(SIGN2));
  ok('G27: the hash exists before the PDF is rendered',
    SIGN2.indexOf('evidence = buildEvidenceRecord(') < SIGN2.indexOf('pdfBuffer = await buildSoaPdf('),
    'the PDF would print a dash');
  ok('the PDF is honest that the evidence reference is not assigned yet',
    /assigned on filing/.test(SIGN2));
  ok('G29: the PDF prints the security warning', /SOA_TEXT\[L === 'es' \? 'es' : 'en'\]\.security/.test(SIGN2));
  ok('G18/G20/G21: the PDF prints all four signature entries',
    /'Printed name'/.test(SIGN2) && /'Date\/time'/.test(SIGN2) && /'Electronic affirmation method'/.test(SIGN2));
}

// ── 22. CSRF posture, pinned (SEC-TOK-11 / SEC-TOK-15) ───────────────────────
// A classic CSRF needs an AMBIENT credential to ride. These endpoints have
// none: no cookie is set or read, the client sends credentials:'omit', and
// authorization is the opaque token in the body plus a second factor. The
// origin allowlist is the remaining control. That posture is a design choice,
// so it is pinned — introducing cookie auth later would silently reopen the
// hole that currently cannot exist.
{
  const files = ['api/sign-soa.js', 'api/soa-token.js', 'api/soa-status.js'];
  for (const f of files) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    ok(`${f} sets no cookie`, !/set-cookie/i.test(code));
    ok(`${f} reads no cookie`, !/req\.cookies|req\.headers\[['"]cookie/i.test(code));
    ok(`${f} checks the origin allowlist`, /checkOrigin\(req\)/.test(code));
    ok(`${f} refuses a disallowed origin before anything else`,
      code.indexOf('checkOrigin(req)') < code.indexOf('if (!SOA_ENABLED)'), 'origin check is not first');
  }
  const page = readFileSync(new URL('../src/pages/SignSOA.tsx', import.meta.url), 'utf8');
  const fetches = (page.match(/fetch\(/g) || []).length;
  const omits = (page.match(/credentials: 'omit'/g) || []).length;
  ok('every SOA fetch omits ambient credentials', omits >= fetches - 1 && omits >= 2, `${omits}/${fetches}`);
}

// ── 23. Claims match mechanisms, and inference cannot overwrite the person ───
{
  // EV-14 — the page may not promise a copy the system does not send.
  const LABELS_SRC = readFileSync(new URL('../src/lib/soaContent.ts', import.meta.url), 'utf8');
  const PAGE = readFileSync(new URL('../src/pages/SignSOA.tsx', import.meta.url), 'utf8');
  const SIGN3 = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');
  ok('EV-14: the unconditional copy promise is gone from success_body',
    !/success_body:[\s\S]{0,260}receive a copy/.test(LABELS_SRC), 'the promise is still unconditional');
  ok('EV-14: there is a separate string for when a copy WAS sent', /success_copy_sent/.test(LABELS_SRC));
  ok('EV-14: and one for when it was not', /success_copy_onreq/.test(LABELS_SRC));
  ok('EV-14: the server reports whether a copy went out', /copySent: _copy\.sent === true/.test(SIGN3));
  ok('EV-14: the page picks the message from that report', /copySent \? 'success_copy_sent' : 'success_copy_onreq'/.test(PAGE));
  ok('EV-14: the fallback tells the person how to get a copy', /1-855-720-8555/.test(LABELS_SRC));

  // CRM-28 — provenance is enforceable in the data, not only in prose.
  const ids = { CY2027_CRM_FIELD_IDS: '{"SOA_STATE":"s1","SOA_ZIP":"z1","SOA_STATUS":"st1"}' };
  const inferred = buildCustomFields({
    SOA_STATE: { value: 'NJ', source: 'AI_INFERRED' },
    SOA_ZIP: { value: '07030', source: 'AI_INFERRED' },
    SOA_STATUS: { value: 'COMPLETED', source: 'AI_INFERRED' },
  }, ids);
  ok('CRM-28: an inferred state is refused', inferred.refused.includes('SOA_STATE'));
  ok('CRM-28: an inferred ZIP is refused', inferred.refused.includes('SOA_ZIP'));
  ok('CRM-28: nothing inferred reaches a confirmed-only field',
    !inferred.fields.some((f) => f.id === 's1' || f.id === 'z1'));
  ok('CRM-28: an inferred value on a non-confirmed field is still allowed',
    inferred.fields.some((f) => f.id === 'st1'));
  const confirmed = buildCustomFields({ SOA_STATE: { value: 'NY', source: 'BENEFICIARY_CONFIRMED' } }, ids);
  ok('CRM-28: what the beneficiary confirmed is written', confirmed.fields.some((f) => f.id === 's1'));
  ok('CRM-28: a plain value still works and counts as SYSTEM',
    buildCustomFields({ SOA_STATE: 'NY' }, ids).fields.length === 1);
  ok('CRM-28: refusals are reported, never silently dropped', Array.isArray(inferred.refused) && inferred.refused.length === 2);
}

// ── 24. Re-verification round: the gaps that survived (2026-10-02) ───────────
{
  // SJ-09 — an out-of-service ZIP must still get general service/escalation.
  // This branch used to end "We wish you the best." and close the composer.
  const BOT = readFileSync(new URL('../src/components/CustomerServiceBot.tsx', import.meta.url), 'utf8');
  ok('SJ-09: the out-of-service branch no longer wishes them well and shuts the door',
    !/We wish you the best|Le deseamos lo mejor/.test(BOT));
  ok('SJ-09: it gives 1-800-MEDICARE', /1-800-633-4227/.test(BOT));
  ok('SJ-09: it gives the TTY line', /1-877-486-2048/.test(BOT));
  ok('SJ-09: it points to the state SHIP', /shiphelp\.org/.test(BOT));
  ok('SJ-09: it offers both languages', /no quiero dejarle sin salida/.test(BOT) && /without a next step/.test(BOT));
  // Strip comments first: this file now DOCUMENTS what the branch used to do,
  // and a comment describing the old dead end is not the old dead end.
  const BOT_CODE = strip(BOT);
  ok('SJ-09: nothing closes the composer on an out-of-service ZIP any more',
    !/setChatClosed\(true\)/.test(BOT_CODE), 'a setChatClosed(true) survives in code');
  ok('SJ-09: it still never names the non-service state', !/\bFlorida\b/.test(BOT_CODE));

  // TPY-12 — the Terms page must render the standardized sentence, not a paraphrase.
  const TERMS = readFileSync(new URL('../src/pages/Terms.tsx', import.meta.url), 'utf8');
  ok('TPY-12: Terms renders the canonical disclaimer', /tpmoDisclaimerText\(lang === 'es'/.test(TERMS));
  ok('TPY-12: the abridged paraphrase is gone',
    !/federal Medicare program\. We do not offer every plan/.test(TERMS));

  // G32 — equal register in both languages.
  const CONTENT2 = readFileSync(new URL('../src/lib/soaContent.ts', import.meta.url), 'utf8');
  const SIGN4 = readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8');
  ok('G32: the Spanish acknowledgement no longer shouts', !/NO es una inscripción y NO hay/.test(CONTENT2));
  ok('G32: nor does the PDF copy', !/NO es una inscripción y NO hay/.test(SIGN4));
  ok('G32: the Spanish text is still complete',
    /no es una inscripción y que no hay obligación/.test(CONTENT2));

  // SJ-11 — a comment that contradicts the code is a defect.
  const ZIPSRC = readFileSync(new URL('../src/lib/zipLookup.ts', import.meta.url), 'utf8');
  ok('SJ-11: the header no longer calls Florida a service area',
    !/Only covers NY, NJ, CT, FL service areas/.test(ZIPSRC));
  ok('SJ-11: it says what the code actually does', /the only authorized SERVICE areas/.test(ZIPSRC));

  // ── TPY-09 — tested by CALLING the gate with synthetic pages ────────────────
  // RED TEAM 2026-10-03: the first seven TPY-09 assertions were source greps. A
  // full revert of the check plus ONE comment line passed all of them, and so
  // did three half-reverts. The rule is now a pure function and every case
  // below runs it; the few structural checks that remain go through strip().
  const pin = (v) => ({ pinContractYearVariant: true, contractYearVariant: v });
  ok('TPY-09: the two contract-year variants are not the same string',
    tpmoDisclaimerText('en', pin('CY2026')) !== tpmoDisclaimerText('en', pin('CY2027')));
  ok('TPY-09: only the CY2026 variant names the SHIP',
    /State Health Insurance/i.test(tpmoDisclaimerText('en', pin('CY2026'))) &&
    !/State Health Insurance/i.test(tpmoDisclaimerText('en', pin('CY2027'))));
  ok('TPY-09: the same holds in Spanish',
    /Programa Estatal de Asistencia/i.test(tpmoDisclaimerText('es', pin('CY2026'))) &&
    !/Programa Estatal de Asistencia/i.test(tpmoDisclaimerText('es', pin('CY2027'))));

  const S27 = { en: canonicalTpmoSentence('en', 'CY2027'), es: canonicalTpmoSentence('es', 'CY2027') };
  const S26 = { en: canonicalTpmoSentence('en', 'CY2026'), es: canonicalTpmoSentence('es', 'CY2026') };
  const page = (...parts) => 'Medicare plans explained. ' + parts.join(' Another paragraph of the page. ') + ' Footer links.';
  const gate = (path, text, opts = {}) => checkTpmo({ path, text, variant: 'CY2027', ...opts });

  ok('TPY-09: a page with this year\'s sentence passes', gate('/about', page(S27.en)).length === 0);
  ok('TPY-09: a Spanish route with this year\'s Spanish sentence passes', gate('/es/about', page(S27.es)).length === 0);
  ok('TPY-09: a bilingual shell passes on both kinds of route',
    gate('/about', page(S27.en, S27.es)).length === 0 && gate('/es', page(S27.en, S27.es)).length === 0);
  ok('TPY-09: a page with ONLY last year\'s sentence fails', gate('/about', page(S26.en)).length > 0);
  ok('TPY-09: this year\'s footer does not excuse last year\'s sentence in the body',
    gate('/about', page(S26.en, S27.en)).some((p) => /CY2026/.test(p)));
  ok('TPY-09: nor in Spanish', gate('/es/about', page(S26.es, S27.es)).some((p) => /CY2026/.test(p)));
  ok('TPY-09: an /es route whose only disclaimer is English fails',
    gate('/es/about', page(S27.en)).some((p) => /español/.test(p)));
  ok('TPY-09: an English route whose only disclaimer is Spanish fails',
    gate('/about', page(S27.es)).some((p) => /inglés/.test(p)));
  ok('TPY-09: a thin page may omit the disclaimer', gate('/support', 'Chat with us.', { thin: true }).length === 0);
  ok('TPY-09: a normal page may not', gate('/about', 'Only prose here, and no disclaimer.').length === 1);
  ok('TPY-09: a thin page that CARRIES last year\'s sentence still fails',
    gate('/support', page(S26.en), { thin: true }).length > 0 &&
    gate('/es/support', page(S26.es), { thin: true }).length > 0);
  ok('TPY-09: a hand-written, abridged disclaimer fails even beside the canonical one',
    gate('/terms', page('We do not offer every plan available in your area. Call us today.', S27.en))
      .some((p) => /no coincide/.test(p)));
  ok('TPY-09: prose that states the fact mid-sentence is not judged as a disclaimer',
    gate('/', page('Unlike captive agents, we do not offer every plan available in your area, and the carrier pays us.', S27.en)).length === 0);
  ok('TPY-09: the gate works in the other direction too',
    checkTpmo({ path: '/about', text: page(S26.en), variant: 'CY2026' }).length === 0 &&
    checkTpmo({ path: '/about', text: page(S27.en), variant: 'CY2026' }).length > 0);
  ok('TPY-09: an unknown variant is a failure, not a pass',
    checkTpmo({ path: '/about', text: page(S27.en), variant: 'CY2099' }).length === 1);
  ok('TPY-09: markup and line breaks between the words do not hide the sentence',
    gate('/about', htmlToText('<p>' + S27.en.replace('Medicare.gov', '<a href="https://www.medicare.gov">Medicare.gov</a>').replace(/ /g, '\n  ') + '</p>')).length === 0);
  ok('TPY-09: a sentence inside a <script> does not satisfy the gate',
    gate('/about', htmlToText('<script>var x = "' + S27.en + '";</script><p>Nothing else here.</p>')).length === 1);

  const PRE = strip(readFileSync(new URL('./prerender-body.mjs', import.meta.url), 'utf8'));
  ok('TPY-09: the build runs the gate on every page, thin or not',
    // Anchored to the start of the line: `if (false) problems.push(…)` survived
    // the unanchored form in the mutation run.
    /^[ \t]*problems\.push\(\.\.\.checkTpmo\(\{ path: t\.path, text, thin, variant: TPMO_VARIANT \}\)\);/m.test(PRE));
  ok('TPY-09: the build keeps no private copy of the rule',
    !/TPMO_EXPECT_EN|TPMO_WRONG_YEAR_RE|TPMO_RE\b/.test(PRE));
  const PREFLIGHT = strip(readFileSync(new URL('./cy2027-preflight.mjs', import.meta.url), 'utf8'));
  ok('TPY-09: preflight checks what is BUILT against today\'s variant',
    /^[ \t]*bad\.push\(\.\.\.checkTpmo\(\{ path: p\.path, text, thin: true, variant \}\)\);/m.test(PREFLIGHT) &&
    /blocks\.push\(`dist\/ does not match contract year/.test(PREFLIGHT));
  ok('TPY-09: and, with --url, what is SERVED',
    /process\.argv\.indexOf\('--url'\)/.test(PREFLIGHT) &&
    /^[ \t]*bad\.push\(\.\.\.checkTpmo\(\{ path, text, thin: true, variant \}\)\);/m.test(PREFLIGHT) &&
    /is serving another contract year/.test(PREFLIGHT));
  const VERCELIGNORE = readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8');
  ok('TPY-09: the gate module ships to the Vercel build', /^!scripts\/tpmo-gate\.mjs\r?$/m.test(VERCELIGNORE));

  // The chat handoff carried eight hand-written disclaimers naming the SHIP.
  const ENGINE = strip(readFileSync(new URL('../src/lib/customerServiceEngine.ts', import.meta.url), 'utf8'));
  ok('TPY-09: the chat handoff no longer carries a hand-written disclaimer',
    !/(?:do not offer every plan|no ofrecemos todos los planes)[^.,;:!?`'"]{0,40}\./i.test(ENGINE));
  ok('TPY-09: it renders the canonical sentence in all eight places',
    (ENGINE.match(/\$\{handoffTpmoLine\('en'\)\}/g) || []).length === 4 &&
    (ENGINE.match(/\$\{handoffTpmoLine\('es'\)\}/g) || []).length === 4 &&
    /\$\{_tpmoDisclaimerText\('es'\)\}/.test(ENGINE) && /\$\{_tpmoDisclaimerText\('en'\)\}/.test(ENGINE));
  const SHELL = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ok('TPY-09: the static shell carries the canonical sentence in both languages',
    SHELL.includes(tpmoDisclaimerText('en')) && SHELL.includes(tpmoDisclaimerText('es')));

  // ── G08 — tested by calling the rule ────────────────────────────────────────
  // RED TEAM 2026-10-03: eleven mutants of the first G08 commit passed its
  // assertions, including the handler reverted to the old coalesce. What can be
  // a function is now a function and is exercised directly.
  ok('G08: every entry in the table is keyed by its own code',
    Object.entries(LANGUAGE_SOURCE).every(([k, v]) => v.code === k));
  ok('G08: the rows of the deciding tables cannot be edited in place',
    Object.values(LANGUAGE_SOURCE).every(Object.isFrozen) && Object.values(SOA_METHOD).every(Object.isFrozen));
  ok('G08: an attempt to make a default signable changes nothing', (() => {
    try { LANGUAGE_SOURCE.SYSTEM_DEFAULT.signable = true; } catch { /* frozen: assignment throws in a module */ }
    return languageWasElected('SYSTEM_DEFAULT') === false;
  })());
  for (const bad of [['BENEFICIARY_ELECTED'], { toString() { return 'BENEFICIARY_ELECTED'; } }, 'constructor', '__proto__',
    'toString', 'hasOwnProperty', 'beneficiary_elected', ' BENEFICIARY_ELECTED', 0, true, null, undefined]) {
    const shown = typeof bad === 'string' ? JSON.stringify(bad) : Object.prototype.toString.call(bad);
    ok('G08: ' + shown + ' is not an election',
      languageWasElected(bad) === false &&
      createSoaInstance({ ...baseInput, languageSource: bad }).errors?.languageSource === 'election_required');
  }
  ok('G08: only en and es are document languages',
    isSoaLanguage('en') && isSoaLanguage('es') &&
    ['EN', 'es ', 'fr', '', null, undefined, ['es'], { toString() { return 'es'; } }].every((v) => isSoaLanguage(v) === false));

  const rd = readLanguageElection;
  ok('G08: a complete election is read as given',
    JSON.stringify(rd({ language: 'es', languageSource: 'BENEFICIARY_ELECTED' })) ===
    JSON.stringify({ ok: true, language: 'es', languageSource: 'BENEFICIARY_ELECTED' }));
  ok('G08: an absent language is NOT coalesced to Spanish',
    rd({ languageSource: 'BENEFICIARY_ELECTED' }).reason === 'LANGUAGE_NOT_SUPPLIED');
  ok('G08: nor is an unsupported, wrong-cased or padded one',
    ['fr', 'ES', 'es ', '', 1, ['es']].every((l) => rd({ language: l, languageSource: 'BENEFICIARY_ELECTED' }).reason === 'LANGUAGE_NOT_SUPPLIED'));
  ok('G08: a language with no recorded election is refused',
    [undefined, '', '   ', ['BENEFICIARY_ELECTED'], 7, {}].every((s) => rd({ language: 'es', languageSource: s }).reason === 'ELECTION_NOT_RECORDED'));
  ok('G08: a default or an inference is named as not an election',
    ['SYSTEM_DEFAULT', 'INFERRED_FROM_LEAD', 'whatever', 'constructor'].every((s) => rd({ language: 'es', languageSource: s }).reason === 'NOT_AN_ELECTION'));
  ok('G08: a body that is not an object does not throw', [null, undefined, 'x', 7, []].every((b) => rd(b).ok === false));

  const SIGN5 = strip(readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8'));
  ok('G08: the handler takes the election from that function and nowhere else',
    /var election = readLanguageElection\(body\);/.test(SIGN5) &&
    !/body\.language\b/.test(SIGN5) && !/body\.languageSource/.test(SIGN5));
  ok('G08: it refuses, with the named reason, when there is no election',
    /if \(!election\.ok\) \{[\s\S]{0,500}?return res\.status\(400\)\.json\(\{ error: 'SOA_LANGUAGE_ELECTION_REQUIRED', reason: election\.reason \}\);/.test(SIGN5));
  ok('G08: the refusal comes before any instance is built',
    SIGN5.indexOf('if (!election.ok) {') > -1 && SIGN5.indexOf('if (!election.ok) {') < SIGN5.indexOf('createSoaInstance({'));
  ok('G08: the refusal is audited without echoing attacker-controlled strings',
    /action: 'SOA_REFUSED'/.test(SIGN5) && /details: \{ reason: election\.reason \},/.test(SIGN5));
  ok('G08: the election reaches the instance, the note and the PDF',
    /languageSource: languageSource,/.test(SIGN5) &&
    /'language_source: ' \+ instance\.languageSource/.test(SIGN5) &&
    /languageSource: instance\.languageSource,/.test(SIGN5));
  {
    const apiDir = new URL('../api/', import.meta.url);
    const used = new Set();
    for (const f of readdirSync(apiDir).filter((n) => n.endsWith('.js'))) {
      const src = strip(readFileSync(new URL(f, apiDir), 'utf8'));
      for (const m of src.matchAll(/emitAudit\(\{\s*action: '([A-Z_]+)'/g)) used.add(m[1]);
    }
    const unknown = [...used].filter((a) => !AUDIT_ACTIONS.includes(a));
    ok('G08: every audit action a handler emits is a registered one', used.size >= 4 && unknown.length === 0, unknown.join(', '));
  }

  // Attribution: who elected has to agree with who signed.
  ok('G08: "elected by representative" needs a representative on the record',
    createSoaInstance({ ...baseInput, languageSource: 'REPRESENTATIVE_ELECTED' }).errors?.languageSource === 'representative_required' &&
    createSoaInstance({ ...baseInput, languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: '   ' }).errors?.languageSource === 'representative_required');
  ok('G08: a representative on the record cannot be attributed to the beneficiary',
    createSoaInstance({ ...baseInput, representativeRelationship: 'Daughter, power of attorney' }).errors?.languageSource === 'election_attribution_mismatch');
  ok('G08: a consistent representative signing is accepted and stored trimmed', (() => {
    const r = createSoaInstance({ ...baseInput, soaId: 'g08rep', languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: '  Daughter, POA ' });
    return r.ok === true && r.instance.representativeRelationship === 'Daughter, POA';
  })());
  ok('G08: electionAttributionError is silent when the two agree',
    electionAttributionError('BENEFICIARY_ELECTED', null) === null &&
    electionAttributionError('REPRESENTATIVE_ELECTED', 'Son') === null);
  ok('G08: the handler reads the representative and hands it to the model',
    /body\.representativeRelationship/.test(SIGN5) &&
    /representativeRelationship: representativeRelationship \|\| null,/.test(SIGN5));
  ok('G08: the SOA_SIGNED audit names who signed and how the language was chosen',
    /actor: instance\.representativeRelationship \? 'representative:channel-verified' : 'beneficiary:channel-verified',/.test(SIGN5) &&
    /language: instance\.language, languageSource: instance\.languageSource,/.test(SIGN5));

  // Evidence: the election is inside the hash.
  const bare = createSoaInstance({ ...baseInput, soaId: 'g08ev' }).instance;
  const evArgs = { stateName: 'New York', signature: 'Jane Q Public', signedAt: '2026-11-01T10:00:00Z' };
  const evBen = buildEvidenceRecord(bare, evArgs);
  ok('G08: the election is inside the evidence record', evBen.record.languageSource === 'BENEFICIARY_ELECTED');
  ok('G08: an untouched record verifies', verifyEvidence(evBen.record).ok === true);
  ok('G08: flipping the stored election is detected',
    verifyEvidence({ ...evBen.record, languageSource: 'REPRESENTATIVE_ELECTED' }).reason === 'HASH_MISMATCH');
  ok('G08: deleting it is detected too', (() => {
    const rest = { ...evBen.record };
    delete rest.languageSource;
    return verifyEvidence(rest).reason === 'HASH_MISMATCH';
  })());
  for (const [label, inst] of [
    ['no election', { ...bare, languageSource: undefined }],
    ['a system default', { ...bare, languageSource: 'SYSTEM_DEFAULT' }],
    ['an inference', { ...bare, languageSource: 'INFERRED_FROM_LEAD' }],
    ['no language', { ...bare, language: undefined }],
  ]) {
    throws('G08: evidence cannot be built for an instance with ' + label, () => buildEvidenceRecord(inst, evArgs), /SOA_LANGUAGE_NOT_ELECTED/);
    throws('G08: nor can it be completed (' + label + ')',
      () => completeSoaInstance(inst, { integrityHash: 'sha256:x', evidenceReference: 'ev' }), /SOA_LANGUAGE_NOT_ELECTED/);
  }
  throws('G08: the text snapshot is never English by default',
    () => renderTextSnapshot({ ...bare, language: undefined }, 'New York'), /SOA_LANGUAGE_NOT_ELECTED/);
  throws('G08: evidence refuses a contradictory attribution',
    () => buildEvidenceRecord({ ...bare, languageSource: 'REPRESENTATIVE_ELECTED' }, evArgs), /representative_required/);

  // The marketing gate.
  const signedG = completeSoaInstance(bare, { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_1' });
  const apptG = { appointmentId: 'appt_1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
  ok('G08: the gate opens for an elected language', marketingGate(signedG, apptG, CMS_RULESET_2027).allowed === true);
  ok('G08: and stays shut for a record with no election',
    marketingGate({ ...signedG, languageSource: undefined }, apptG, CMS_RULESET_2027).reason === 'SOA_LANGUAGE_NOT_ELECTED');
  ok('G08: or with a default, or with no language',
    marketingGate({ ...signedG, languageSource: 'SYSTEM_DEFAULT' }, apptG, CMS_RULESET_2027).reason === 'SOA_LANGUAGE_NOT_ELECTED' &&
    marketingGate({ ...signedG, language: undefined }, apptG, CMS_RULESET_2027).reason === 'SOA_LANGUAGE_NOT_ELECTED');

  // The label: one function for the screen and the PDF, and it never guesses.
  ok('G08: the label reads the same on screen and on the PDF',
    languageElectionLabel('BENEFICIARY_ELECTED', 'es') === 'Elegido por el beneficiario' &&
    languageElectionLabel('REPRESENTATIVE_ELECTED', 'en') === 'Elected by representative');
  for (const bad of [undefined, 'SYSTEM_DEFAULT', 'INFERRED_FROM_LEAD', 'x']) {
    throws('G08: there is no label for ' + String(bad), () => languageElectionLabel(bad, 'en'), /SOA_LANGUAGE_NOT_ELECTED/);
  }
  throws('G08: nor in an unknown language', () => languageElectionLabel('BENEFICIARY_ELECTED', 'fr'), /unknown language/);
  ok('G08: the PDF prints the label from that function, never a fallback',
    /languageElectionLabel\(opts\.languageSource, L === 'es' \? 'es' : 'en'\)/.test(SIGN5) && !/Elected by beneficiary/.test(SIGN5));
  ok('G08: the PDF signature heading names both possible signers',
    /SOA_TEXT\[L === 'es' \? 'es' : 'en'\]\.fields\.signature/.test(SIGN5) && !/Beneficiary Electronic Signature/.test(SIGN5));

  // The CRM.
  const cf = (values) => buildCustomFields(values, {
    CY2027_CRM_FIELD_IDS: JSON.stringify({ SOA_LANGUAGE: 'id1', SOA_LANGUAGE_SOURCE: 'id2', SOA_PLAN_YEAR: 'id3' }),
  });
  ok('G08: a confirmed election is written',
    cf({ SOA_LANGUAGE: { value: 'es', source: 'BENEFICIARY_CONFIRMED' }, SOA_LANGUAGE_SOURCE: 'BENEFICIARY_ELECTED' }).mapped === 2);
  for (const src of ['AI_INFERRED', 'ai_inferred', 'INFERRED_FROM_LEAD', 'GUESS', '', null, undefined]) {
    ok('G08: provenance ' + JSON.stringify(src) + ' may not write a confirmed-only field',
      cf({ SOA_LANGUAGE: { value: 'es', source: src } }).refused.join() === 'SOA_LANGUAGE');
  }
  ok('G08: a non-election is never written as the election',
    cf({ SOA_LANGUAGE_SOURCE: 'SYSTEM_DEFAULT' }).refused.join() === 'SOA_LANGUAGE_SOURCE' &&
    cf({ SOA_LANGUAGE_SOURCE: 'INFERRED_FROM_LEAD' }).refused.join() === 'SOA_LANGUAGE_SOURCE');
  ok('G08: fields that are not confirmed-only keep their old rule',
    cf({ SOA_PLAN_YEAR: { value: 2027, source: 'AI_INFERRED' } }).mapped === 1);
  ok('G08: the election is a queryable CRM field',
    CY2027_FIELD_KEYS.SOA_LANGUAGE_SOURCE === 'contact.soa_language_source');
  ok('G08: it is declared confirmed-only together with the language',
    CONFIRMED_ONLY_FIELDS.includes('SOA_LANGUAGE_SOURCE') && CONFIRMED_ONLY_FIELDS.includes('SOA_LANGUAGE'));
  ok('G08: it is flattened out of the instance',
    soaInstanceToFields(createSoaInstance({ ...baseInput, soaId: 'g08' }).instance).SOA_LANGUAGE_SOURCE
      === 'BENEFICIARY_ELECTED');

  // The form. These are structural — a browser run is the behavioural check —
  // but each is anchored so that disabling the behaviour breaks the match.
  const FORM2 = strip(readFileSync(new URL('../src/components/SOAForm.tsx', import.meta.url), 'utf8'));
  ok('G08: the election screen returns before the read-back and the form',
    FORM2.indexOf('if (elected === null) {') > -1 &&
    FORM2.indexOf('if (elected === null) {') < FORM2.indexOf("if (step === 'review') {") &&
    FORM2.indexOf("if (step === 'review') {") < FORM2.indexOf('onSubmit={goToReview}'));
  ok('G08: no document text is shown before the election',
    /\{elected !== null && <p className="[^"]*">\{txt\.intro\}<\/p>\}/.test(FORM2));
  ok('G08: neither option is preselected', /useState<'en' \| 'es' \| null>\(null\)/.test(FORM2));
  ok('G08: the election changes in exactly three places — the two options and the way back',
    (FORM2.match(/setElected\(/g) || []).length === 3 &&
    /onClick=\{\(\) => setElected\('en'\)\}/.test(FORM2) && /onClick=\{\(\) => setElected\('es'\)\}/.test(FORM2));
  ok('G08: the prompt is bilingual and promises only what the document does',
    /Choose the language for this document\./.test(FORM2) && /Elija el idioma de este documento\./.test(FORM2) &&
    !/Everything you sign will be in the language you pick/.test(FORM2) &&
    !/Todo lo que firme estará en el idioma/.test(FORM2));
  const CHANGE = (FORM2.match(/const changeLanguage = \(\) => \{([\s\S]*?)\n\s*\};/) || [])[1] || '';
  ok('G08: changing language withdraws everything that was affirmed',
    /setAckNoObl\(false\);/.test(CHANGE) && /setAckEsig\(false\);/.test(CHANGE) &&
    /setSignature\(''\);/.test(CHANGE) && /setErrors\(\{\}\);/.test(CHANGE) && /setElected\(null\);/.test(CHANGE));
  ok('G08: the way back uses that handler and exists on both steps',
    /onClick=\{changeLanguage\}/.test(FORM2) && (FORM2.match(/\{LangChange\}/g) || []).length === 2);
  ok('G08: the acknowledgements never start ticked',
    /const \[ackNoObl, setAckNoObl\] = useState\(false\);/.test(FORM2) &&
    /const \[ackEsig, setAckEsig\] = useState\(false\);/.test(FORM2));
  ok('G08: focus follows the view instead of falling to the page',
    /headingRef\.current\?\.focus\(\);\s*\}, \[elected, step\]\);/.test(FORM2) &&
    /ref=\{headingRef\}\s*tabIndex=\{-1\}/.test(FORM2));
  ok('G08: the elected document is marked with its language on both steps',
    (FORM2.match(/noValidate lang=\{L\}/g) || []).length === 2);
  ok('G08: each option is announced in its own language',
    /onClick=\{\(\) => setElected\('en'\)\}\s*lang="en"/.test(FORM2) &&
    /onClick=\{\(\) => setElected\('es'\)\}\s*lang="es"/.test(FORM2));
  ok('G08: it sends the shared election code, not a literal',
    /LANGUAGE_SOURCE\.BENEFICIARY_ELECTED\.code/.test(FORM2) &&
    /LANGUAGE_SOURCE\.REPRESENTATIVE_ELECTED\.code/.test(FORM2) &&
    /languageSource: electionSource,/.test(FORM2));
  ok('G08: a representative signing is attributed to the representative',
    /representativeAuthority\.trim\(\)\s*\?\s*LANGUAGE_SOURCE\.REPRESENTATIVE_ELECTED/.test(FORM2));
  ok('G08: the read-back shows the label, not a raw code',
    /value=\{languageElectionLabel\(electionSource, L\)\}/.test(FORM2));

  const SIGNPAGE = strip(readFileSync(new URL('../src/pages/SignSOA.tsx', import.meta.url), 'utf8'));
  ok('G08: the page never overrides what the form elected',
    !/language: language/.test(SIGNPAGE) && /\{ \.\.\.formData, token, leadSource:/.test(SIGNPAGE));
  ok('G08: after signing, the page speaks the elected language',
    /const language: 'en' \| 'es' = electedLanguage \?\? lead\?\.language \?\? 'es';/.test(SIGNPAGE) &&
    /if \(formData\.language === 'en' \|\| formData\.language === 'es'\) setElectedLanguage\(formData\.language\);/.test(SIGNPAGE));
}

// ── 25. The callback consent carries the scope its wording states (CE-09 / CRM-15) ──
// §6: "Every consent object stores … scope/purpose". §24: "Generic callback
// consent authorizes only the scope actually stated." The web surfaces produced
// four channel booleans and no scope; the scope lived as prose in a note.
//
// Every rule here is tested by CALLING it. The two handlers are not grepped:
// they run, in process, against a laboratory CRM (globalThis.fetch replaced), so
// a revert, an `if (false)` or a dropped argument changes what is observed.
consentScope: {
  const sha = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');
  const reasonOf = (fn) => { try { return String(fn().reason); } catch (e) { return 'THREW: ' + e.message; } };
  const REG = CONTACT_CONSENT_TEXT_VERSIONS;

  // ── 25a. The wording gate (scripts/consent-wording-gate.mjs) ─────────────────
  const DV_SRC = readFileSync(new URL('../src/lib/disclaimerVersion.ts', import.meta.url), 'utf8');
  const SHOWN = readShownConsentWording(DV_SRC);
  ok('CE-09: the shown wording and its version are readable',
    typeof SHOWN.version === 'string' && SHOWN.version.length > 0 &&
    typeof SHOWN.en === 'string' && SHOWN.en.length > 100 && typeof SHOWN.es === 'string' && SHOWN.es.length > 100);
  const live = consentWordingProblems({ source: DV_SRC, registry: REG });
  ok('CE-09: the wording the site shows today is the registered wording, in both languages',
    live.problems.length === 0 && live.version === SHOWN.version, live.problems.join(' | '));
  const entry = Object.prototype.hasOwnProperty.call(REG, SHOWN.version) ? REG[SHOWN.version] : null;
  ok('CE-09: the version the site shows is registered with a scope',
    !!entry && typeof entry.scope === 'string' && entry.scope.length > 0 && live.scope === entry.scope);
  ok('CE-09: the registered digests are the texts shown today',
    !!entry && sha(SHOWN.en) === entry.sha256.en && sha(SHOWN.es) === entry.sha256.es,
    'bump DISCLAIMER_VERSION and add a registry entry — do not edit the old one');
  // "Not a broader one": the scope has to be literally in the wording.
  ok('CRM-15: both texts literally state the registered scope',
    !!entry && SHOWN.en.includes(entry.statedAs.en) && SHOWN.es.includes(entry.statedAs.es));

  // The same function, on wording made up here, so each rule is seen to bite.
  const mkSrc = ({ version = 'v1', en = 'Call me to discuss X.', es = 'Llame para discutir X.' } = {}) =>
    "export const DISCLAIMER_VERSION = '" + version + "';\n" +
    "export const TCPA_CONSENT_TEXT_EN =\n  '" + en.slice(0, 8) + "' +\n  '" + en.slice(8) + "';\n" +
    "export const TCPA_CONSENT_TEXT_ES = '" + es + "';\n";
  const mkReg = (over = {}) => ({
    v1: {
      scope: 'DISCUSS_X',
      statedAs: { en: 'to discuss X', es: 'para discutir X' },
      sha256: { en: sha('Call me to discuss X.'), es: sha('Llame para discutir X.') },
      ...over,
    },
  });
  const gate = (source, registry = mkReg()) => consentWordingProblems({ source, registry });
  ok('CE-09: the reader joins the concatenated pieces exactly',
    JSON.stringify(readShownConsentWording(mkSrc())) ===
    JSON.stringify({ version: 'v1', en: 'Call me to discuss X.', es: 'Llame para discutir X.' }));
  ok('CE-09: a registered, unchanged wording passes the gate',
    gate(mkSrc()).problems.length === 0 && gate(mkSrc()).scope === 'DISCUSS_X' && gate(mkSrc()).version === 'v1');
  ok('CE-09: an edited EN wording under the same version fails the build', (() => {
    const p = gate(mkSrc({ en: 'Call me to discuss X and Y.' })).problems;
    return p.length === 1 && /EN contact-consent wording changed/.test(p[0]);
  })());
  ok('CE-09: and so does an edited ES wording', (() => {
    const p = gate(mkSrc({ es: 'Llame para discutir X y Z.' })).problems;
    return p.length === 1 && /ES contact-consent wording changed/.test(p[0]);
  })());
  ok('CE-09: a new version with no registry entry fails the build', (() => {
    const p = gate(mkSrc({ version: 'v2' })).problems;
    return p.length === 1 && /has no entry in CONTACT_CONSENT_TEXT_VERSIONS/.test(p[0]);
  })());
  ok('CE-09: a prototype key is not a registered version',
    ['constructor', '__proto__', 'toString'].every((v) => /has no entry/.test(gate(mkSrc({ version: v })).problems[0] || '')));
  ok('CRM-15: a registry that claims a scope the text does not state fails the build', (() => {
    const p = gate(mkSrc(), mkReg({ statedAs: { en: 'to discuss anything we sell', es: 'para discutir X' } })).problems;
    return p.length === 1 && /does not contain it/.test(p[0]);
  })());
  ok('CRM-15: a registry entry with no scope, no stated phrase or no digest fails the build',
    /names no scope/.test(gate(mkSrc(), mkReg({ scope: '' })).problems.join('|')) &&
    /incomplete for EN/.test(gate(mkSrc(), mkReg({ statedAs: { en: '', es: 'para discutir X' } })).problems.join('|')) &&
    /incomplete for ES/.test(gate(mkSrc(), mkReg({ sha256: { en: sha('Call me to discuss X.') } })).problems.join('|')));
  ok('CE-09: wording the gate cannot read exactly is reported, not guessed at',
    [
      mkSrc().replace("'Llame para discutir X.'", '`Llame para discutir X.`'),              // a template literal
      mkSrc().replace("'Llame para discutir X.'", "'Llame ' + who + ' para discutir X.'"),  // an interpolation
      mkSrc().replace("'Llame para discutir X.'", "'Llame para discutir X.\\n'"),            // an escape
      mkSrc() + "export const DISCLAIMER_VERSION = 'v1';\n",                                // declared twice
      mkSrc().replace(/export const TCPA_CONSENT_TEXT_EN[\s\S]*?;\n/, ''),                  // a text missing
      '', undefined, null, 42,
    ].every((s) => /Could not read/.test(gate(s).problems[0] || '')) &&
    /Could not read/.test(consentWordingProblems().problems[0] || ''));
  ok('CE-09: a commented-out declaration is not the declaration', (() => {
    const src = "// export const DISCLAIMER_VERSION = 'v0';\n/* export const TCPA_CONSENT_TEXT_ES = 'old'; */\n" + mkSrc();
    return readShownConsentWording(src).version === 'v1' && gate(src).problems.length === 0;
  })());
  ok('CE-09: the gate catches the edit that already happened once (the phone number inside the text)',
    consentWordingProblems({ source: DV_SRC.split('1-855-720-8555').join('1-800-000-0000'), registry: REG }).problems.length === 2);
  ok('CE-09: and a version bump on the real file with no new registry entry',
    /has no entry/.test(consentWordingProblems({
      source: DV_SRC.replace("DISCLAIMER_VERSION = '" + SHOWN.version + "'", "DISCLAIMER_VERSION = '2099-01-01'"),
      registry: REG,
    }).problems[0] || ''));

  // The build runs that function. The real gate is RUN here: a block-level
  // `if (false)` around its section would leave every line of it in place and
  // simply print nothing.
  const parityRun = spawnSync(process.execPath, [fileURLToPath(new URL('./check-cy2027-parity.mjs', import.meta.url))],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
  ok('CE-09: the build gate checks the wording against the registry, and passes today',
    parityRun.status === 0 &&
    String(parityRun.stdout).includes('contact-consent wording v' + SHOWN.version + ' matches its scope registry (' + (entry && entry.scope) + ')'),
    String(parityRun.stderr || parityRun.stdout || parityRun.error || '').slice(0, 300));
  const PARITY = strip(readFileSync(new URL('./check-cy2027-parity.mjs', import.meta.url), 'utf8'));
  ok('CE-09: the build gate takes its verdict from that function',
    // Anchored to whole lines: `if (false) …` in front of any of them breaks the match.
    /^import \{ consentWordingProblems \} from '\.\/consent-wording-gate\.mjs';\r?$/m.test(PARITY) &&
    /^[ \t]*const wording = consentWordingProblems\(\{ source: dv, registry: consentMod\.CONTACT_CONSENT_TEXT_VERSIONS \}\);\r?$/m.test(PARITY) &&
    /^[ \t]*if \(wording\.problems\.length\) problems\.push\(\.\.\.wording\.problems\);\r?$/m.test(PARITY));
  ok('CE-09: the gate module ships to the Vercel build',
    /^!scripts\/consent-wording-gate\.mjs\r?$/m.test(readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8')));

  // ── 25b. The registry ────────────────────────────────────────────────────────
  const EN_2026_06_01 = '1b85fb83b46a4698e08ce899d0675ac0caf140efde5a62711f618de551d43048';
  const ES_2026_06_01 = '3e102ce502965affa1a6df76c186f7cfe62375cea3382e3e18b66bc54954583f';
  ok('CE-09: the 2026-06-01 entry is exactly what was registered — an entry is never edited',
    JSON.stringify(REG['2026-06-01']) === JSON.stringify({
      scope: 'DISCUSS_MEDICARE_PLAN_OPTIONS',
      statedAs: { en: 'to discuss Medicare plan options', es: 'para discutir opciones de planes de Medicare' },
      sha256: { en: EN_2026_06_01, es: ES_2026_06_01 },
    }));
  ok('CE-09: the registry is immutable at every level',
    Object.isFrozen(REG) && Object.values(REG).every((e) => Object.isFrozen(e) && Object.isFrozen(e.statedAs) && Object.isFrozen(e.sha256)));
  ok('CE-09: an attempt to widen a registered scope, or to add a version, changes nothing', (() => {
    try { REG['2026-06-01'].scope = 'ANY_PRODUCT'; } catch { /* frozen: assignment throws in a module */ }
    try { REG['2026-06-01'].sha256.en = sha('anything'); } catch { /* frozen */ }
    try { REG['2099-01-01'] = { scope: 'ANY_PRODUCT' }; } catch { /* frozen */ }
    return REG['2026-06-01'].scope === 'DISCUSS_MEDICARE_PLAN_OPTIONS' && REG['2026-06-01'].sha256.en === EN_2026_06_01 &&
      !('2099-01-01' in REG);
  })());
  ok('CE-09: only a scope some registered wording states is a stated scope',
    isStatedConsentScope('DISCUSS_MEDICARE_PLAN_OPTIONS') === true &&
    ['ANY_PRODUCT', 'discuss_medicare_plan_options', ' DISCUSS_MEDICARE_PLAN_OPTIONS', 'DISCUSS_MEDICARE_PLAN_OPTIONS ', '',
      'scope', 'constructor', '__proto__', ['DISCUSS_MEDICARE_PLAN_OPTIONS'],
      { toString() { return 'DISCUSS_MEDICARE_PLAN_OPTIONS'; } }, null, undefined, 0, true]
      .every((s) => isStatedConsentScope(s) === false));
  ok('CE-09: a timestamp is a UTC ISO instant, nothing looser',
    ['2026-10-02T15:00:00.000Z', '2026-10-02T15:00:00Z'].every((t) => isIsoInstant(t) === true) &&
    ['', 'yesterday', '2026-10-02', '2026-10-02T15:00:00', '2026-10-02T15:00:00+02:00', '2026-13-45T99:99:99Z',
      ' 2026-10-02T15:00:00Z', 1759417200000, new Date('2026-10-02T15:00:00Z'), null, undefined, ['2026-10-02T15:00:00Z']]
      .every((t) => isIsoInstant(t) === false));

  // ── 25c. The consent object ──────────────────────────────────────────────────
  const AT = '2026-10-02T15:00:00.000Z';
  const base = { consentGiven: true, disclaimerVersion: SHOWN.version, consentTextSha256: sha(SHOWN.en), at: AT };
  const good = webCallbackConsent(base);
  ok('CE-09: a submission attesting the registered text yields a consent object',
    !!good.consent && good.reason === 'CALLBACK_CONSENT_RECORDED', 'refused: ' + good.reason);
  // Everything below needs that object. Without one — the wording and the
  // registry disagree, and the failures above already say how — the suite stops
  // here with those named failures instead of a TypeError on `null.type`.
  if (!entry || !good.consent) break consentScope;
  ok('CE-09: it is the CALLBACK object, granted', good.consent.type === 'CALLBACK_CONTACT_PERMISSION' && good.consent.status === 'GRANTED');
  ok('CE-09: it stores the scope the wording states',
    good.consent.scope === 'DISCUSS_MEDICARE_PLAN_OPTIONS' && good.consent.scope === entry.scope);
  ok('CE-09: it stores the text version shown', good.consent.scriptVersion === SHOWN.version);
  ok('CE-09: it stores the source channel and the instant given', good.consent.channel === 'WEB' && good.consent.at === AT);
  ok('CE-09: the language is the language of the text shown (EN digest)', good.consent.language === 'en');
  ok('CE-09: the language is the language of the text shown (ES digest)',
    webCallbackConsent({ ...base, consentTextSha256: sha(SHOWN.es) }).consent.language === 'es');
  ok('CE-09: the relationship is not asserted as SELF when nobody stated it', good.consent.relationship === 'NOT_STATED');
  ok('CE-09: every §6 attribute is on the object, and nothing is revoked',
    ['status', 'at', 'language', 'channel', 'scriptVersion', 'scope', 'relationship', 'revokedAt'].every((k) => k in good.consent) &&
    good.consent.revokedAt === null && isAffirmative(good.consent, 'CALLBACK_CONTACT_PERMISSION') === true);
  ok('CE-09: the decision and the consent inside it cannot be edited afterwards', (() => {
    const d = webCallbackConsent(base);
    try { d.consent.scope = 'ANY_PRODUCT'; } catch { /* frozen */ }
    try { d.reason = 'x'; } catch { /* frozen */ }
    return Object.isFrozen(d) && Object.isFrozen(d.consent) && d.consent.scope === entry.scope && d.reason === 'CALLBACK_CONSENT_RECORDED';
  })());
  ok('CE-09: a correlation id is carried when it is a string, and only then',
    webCallbackConsent({ ...base, correlationId: 'sub_123' }).consent.correlationId === 'sub_123' &&
    webCallbackConsent({ ...base, correlationId: { id: 1 } }).consent.correlationId === null);
  ok('CE-09: a receipt hash that agrees with the text is accepted, and an absent one is not required',
    [sha(SHOWN.en), undefined, null, ''].every((h) => !!webCallbackConsent({ ...base, receiptHash: h }).consent));
  ok('CRM-15: the scope is never an input — a caller cannot hand one in',
    webCallbackConsent({ ...base, scope: 'ANY_PRODUCT', purpose: 'ANY_PRODUCT', interest_type: 'Final Expense' }).consent.scope === entry.scope);

  // Every refusal is named, and none of them produces an object.
  const refusal = (over) => {
    try { return webCallbackConsent({ ...base, ...over }); } catch (e) { return { consent: 'THREW', reason: 'THREW: ' + e.message }; }
  };
  ok('CE-09: only the literal boolean true is consent',
    ['true', 1, 'yes', {}, [], null, undefined, false].every((c) => refusal({ consentGiven: c }).reason === 'NO_AFFIRMATIVE_CONSENT'));
  ok('CE-09: no version, no object',
    ['', undefined, null, 0, ['2026-06-01'], { toString() { return '2026-06-01'; } }]
      .every((v) => refusal({ disclaimerVersion: v }).reason === 'CONSENT_TEXT_VERSION_MISSING'));
  ok('CE-09: an unregistered version is not given the current scope — nor is a prototype key',
    ['2099-01-01', '2026-06-01 ', ' 2026-06-01', '2026-06-1', 'constructor', '__proto__', 'toString', 'hasOwnProperty']
      .every((v) => refusal({ disclaimerVersion: v }).reason === 'CONSENT_TEXT_VERSION_UNKNOWN'));
  ok('CE-09: no text digest, no object',
    ['', undefined, null, 'zz', sha(SHOWN.en).toUpperCase(), sha(SHOWN.en).slice(1), [sha(SHOWN.en)]]
      .every((d) => refusal({ consentTextSha256: d }).reason === 'CONSENT_TEXT_MISSING'));
  ok('CRM-15: a different wording under the same version earns no scope',
    refusal({ consentTextSha256: sha(SHOWN.en + ' and any other product we sell.') }).reason === 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION' &&
    refusal({ consentTextSha256: sha(SHOWN.en + ' ') }).reason === 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION');
  ok('CE-09: a receipt hash that disagrees with the text is refused',
    ['a'.repeat(64), sha(SHOWN.es), sha(SHOWN.en).toUpperCase(), [sha(SHOWN.en)], false, 0, true]
      .every((h) => refusal({ receiptHash: h }).reason === 'CONSENT_RECEIPT_HASH_MISMATCH'));
  ok('CE-09: the timestamp is required, not defaulted',
    [undefined, null, ''].every((t) => refusal({ at: t }).reason === 'CONSENT_TIMESTAMP_MISSING'));
  ok('CE-09: and it has to be an instant',
    ['yesterday', '2026-10-02', 1759417200000, new Date(AT), '2026-13-45T99:99:99Z', [AT]]
      .every((t) => refusal({ at: t }).reason === 'CONSENT_TIMESTAMP_INVALID'));
  ok('CE-09: no refusal carries a consent object',
    [{ consentGiven: false }, { disclaimerVersion: 'x' }, { consentTextSha256: 'zz' }, { consentTextSha256: sha('other') },
      { receiptHash: 'a'.repeat(64) }, { at: '' }, { at: 'yesterday' }].every((o) => refusal(o).consent === null));
  ok('CE-09: an input that is not an object refuses instead of throwing',
    [undefined, null, 'x', 7, [], [base]].every((i) => reasonOf(() => webCallbackConsent(i)) === 'NO_AFFIRMATIVE_CONSENT'));

  // §24, end to end: the stated scope is what an outbound purpose is checked against.
  ok('CE-09: a callback for the stated purpose is allowed',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: good.consent, doNotContact: false, purpose: entry.scope }).allowed === true);
  ok('CE-09: a callback for another purpose is outside the stated scope',
    mayPlaceOutbound({ mode: 'HUMAN_LICENSED_AGENT', callbackConsent: good.consent, doNotContact: false, purpose: 'FINAL_EXPENSE_OFFER' }).reason === 'PURPOSE_OUTSIDE_CONSENT_SCOPE');
  ok('CE-09: it is never AI-outbound consent',
    mayPlaceOutbound({ mode: 'AI_AUTOMATED', aiOutboundConsent: good.consent, doNotContact: false }).reason === 'NO_AI_OUTBOUND_CONSENT');
  ok('CE-09: revoking it keeps the record of what was revoked', (() => {
    const r = revokeConsent(good.consent, { at: '2026-10-03T09:00:00.000Z', via: 'WEB_CHAT' });
    return r.status === 'REVOKED' && r.scope === entry.scope && isAffirmative(r, 'CALLBACK_CONTACT_PERMISSION') === false &&
      good.consent.status === 'GRANTED';
  })());

  // ── 25d. The write side: the same rules where the value leaves ───────────────
  const IDS = { CY2027_CRM_FIELD_IDS: '{"CALLBACK_CONSENT_STATUS":"cbS","CALLBACK_CONSENT_AT":"cbA","CALLBACK_CONSENT_SCOPE":"cbX"}' };
  const byId = (r, id) => (r.fields.find((f) => f.id === id) || {}).value;
  const flat = consentsToFields({ callbackConsent: good.consent });
  const mapped = buildCustomFields(flat, IDS);
  ok('CRM-15: status, timestamp and scope are three separate CRM values',
    mapped.fields.length === 3 && byId(mapped, 'cbS') === 'GRANTED' && byId(mapped, 'cbA') === AT && byId(mapped, 'cbX') === entry.scope);
  ok('CRM-15: the scope is written under its canonical key',
    mapped.fields.some((f) => f.id === 'cbX' && f.key === 'contact.callback_consent_scope'));
  ok('CRM-15: without ids nothing is sent and all three are reported',
    buildCustomFields(flat, {}).fields.length === 0 && buildCustomFields(flat, {}).unmapped.length === 3);
  ok('CRM-15: the scope is a confirmed-only field', CONFIRMED_ONLY_FIELDS.includes('CALLBACK_CONSENT_SCOPE'));
  for (const src of ['AI_INFERRED', 'ai_inferred', 'INFERRED_FROM_LEAD', 'GUESS', '', null, undefined]) {
    // The VALUE is the registered scope, so only the provenance rule can refuse it.
    const r = buildCustomFields({ CALLBACK_CONSENT_SCOPE: { value: entry.scope, source: src } }, IDS);
    ok('CRM-15: provenance ' + JSON.stringify(src) + ' may not write the scope',
      r.refused.join() === 'CALLBACK_CONSENT_SCOPE' && r.fields.length === 0);
  }
  ok('CRM-15: a confirmed, registered scope is written',
    buildCustomFields({ CALLBACK_CONSENT_SCOPE: { value: entry.scope, source: 'BENEFICIARY_CONFIRMED' } }, IDS).mapped === 1 &&
    buildCustomFields({ CALLBACK_CONSENT_SCOPE: entry.scope }, IDS).mapped === 1);
  for (const bad of ['ANY_PRODUCT', 'discuss_medicare_plan_options', ' ' + entry.scope, 'this request', 'constructor',
    [entry.scope], { toString() { return entry.scope; } }, 7, true]) {
    // The PROVENANCE is acceptable both times, so only the allow-list of stated scopes can refuse it.
    const shownAs = typeof bad === 'string' ? JSON.stringify(bad) : Object.prototype.toString.call(bad);
    const plain = buildCustomFields({ CALLBACK_CONSENT_SCOPE: bad }, IDS);
    const confirmed = buildCustomFields({ CALLBACK_CONSENT_SCOPE: { value: bad, source: 'BENEFICIARY_CONFIRMED' } }, IDS);
    ok('CRM-15: ' + shownAs + ' is not a scope any registered wording states, so it is not written',
      plain.refused.join() === 'CALLBACK_CONSENT_SCOPE' && plain.fields.length === 0 &&
      confirmed.refused.join() === 'CALLBACK_CONSENT_SCOPE' && confirmed.fields.length === 0);
  }
  ok('CRM-15: a consent object assembled by hand does not get its scope into the CRM', (() => {
    const forged = { type: 'CALLBACK_CONTACT_PERMISSION', status: 'GRANTED', at: AT, scope: 'ANY_PRODUCT', revokedAt: null };
    const r = buildCustomFields(consentsToFields({ callbackConsent: forged }), IDS);
    return r.refused.includes('CALLBACK_CONSENT_SCOPE') && !r.fields.some((f) => f.id === 'cbX');
  })());

  // The revocation side.
  const REVOKED_AT = '2026-10-03T09:00:00.000Z';
  const rev = callbackRevocationToFields({ at: REVOKED_AT });
  ok('CE-09: a revocation sets the status to REVOKED', rev.CALLBACK_CONSENT_STATUS === 'REVOKED');
  ok('CE-09: and stamps the revocation instant', rev.CALLBACK_CONSENT_AT === REVOKED_AT);
  ok('CRM-15: a revocation does not restate (or invent) a scope, whatever the caller passes',
    !('CALLBACK_CONSENT_SCOPE' in rev) && Object.isFrozen(rev) &&
    Object.keys(callbackRevocationToFields({ at: REVOKED_AT, CALLBACK_CONSENT_SCOPE: 'X', scope: 'X', CALLBACK_CONSENT_STATUS: 'GRANTED' }))
      .sort().join() === 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_STATUS' &&
    callbackRevocationToFields({ at: REVOKED_AT, CALLBACK_CONSENT_STATUS: 'GRANTED' }).CALLBACK_CONSENT_STATUS === 'REVOKED');
  for (const bad of [undefined, null, {}, { at: '' }, { at: 'yesterday' }, { at: 1759482000000 }, { at: new Date(REVOKED_AT) }, 'x']) {
    throws('CE-09: a revocation without a usable timestamp is refused (' + JSON.stringify(bad) + ')',
      () => callbackRevocationToFields(bad), /timestamp/);
  }
  ok('CE-09: the revocation maps to the same two fields the grant wrote',
    buildCustomFields(rev, IDS).fields.map((f) => f.id).sort().join() === 'cbA,cbS' && byId(buildCustomFields(rev, IDS), 'cbS') === 'REVOKED');

  // ── 25e. What the lead handler calls: the digest is the server's ─────────────
  const goodIn = { consentGiven: true, disclaimerVersion: SHOWN.version, consentText: SHOWN.en, receiptHash: sha(SHOWN.en), at: AT };
  const rec = recordWebCallbackConsent(goodIn, IDS);
  ok('CE-09: the record function hashes the text itself and yields the consent object',
    rec.reason === 'CALLBACK_CONSENT_RECORDED' && !!rec.consent && rec.consent.scope === entry.scope &&
    rec.consent.language === 'en' && rec.consent.at === AT);
  ok('CRM-15: with ids it yields the three CRM entries, real ids and canonical keys',
    rec.fields.length === 3 && byId(rec, 'cbS') === 'GRANTED' && byId(rec, 'cbA') === AT && byId(rec, 'cbX') === entry.scope &&
    rec.fields.every((f) => /^contact\.callback_consent_(status|at|scope)$/.test(f.key) && f.field_value === f.value) &&
    rec.unmapped.length === 0 && rec.withheld.length === 0 && rec.warnings.length === 0);
  ok('CRM-15: the receipt carries the scope as its own labelled value',
    rec.receiptBit === 'scope=DISCUSS_MEDICARE_PLAN_OPTIONS' && rec.flag === null);
  ok('CRM-15: nothing else in the submission can name a scope', (() => {
    const r = recordWebCallbackConsent({ ...goodIn, scope: 'ANY_PRODUCT', consentScope: 'ANY_PRODUCT', consent: { scope: 'ANY_PRODUCT' } }, IDS);
    return r.receiptBit === 'scope=' + entry.scope && byId(r, 'cbX') === entry.scope && !/ANY_PRODUCT/.test(JSON.stringify(r));
  })());
  ok('CE-09: the Spanish text is recorded as Spanish, with the same stated scope', (() => {
    const es = recordWebCallbackConsent({ ...goodIn, consentText: SHOWN.es, receiptHash: sha(SHOWN.es) }, IDS);
    return !!es.consent && es.consent.language === 'es' && es.consent.scope === entry.scope && es.fields.length === 3;
  })());
  ok('CE-09: a browser that sent no receipt hash still gets its verified text recorded',
    ['', undefined, null].every((h) => recordWebCallbackConsent({ ...goodIn, receiptHash: h }, IDS).reason === 'CALLBACK_CONSENT_RECORDED'));
  // The client's hash is a claim. The digest that selects the scope is the server's.
  ok('CE-09: the registered hash beside a DIFFERENT text earns nothing', (() => {
    const r = recordWebCallbackConsent({ ...goodIn, consentText: SHOWN.en + ' You also agree to offers about any other product.' }, IDS);
    return r.consent === null && r.fields.length === 0 && r.reason === 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION';
  })());
  ok('CE-09: the text is hashed exactly as received — one character more is another text',
    [SHOWN.en + ' ', ' ' + SHOWN.en, SHOWN.en.toUpperCase(), SHOWN.en.replace('Medicare plan options', 'insurance options')]
      .every((t) => recordWebCallbackConsent({ ...goodIn, consentText: t, receiptHash: '' }, IDS).reason === 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION'));
  ok('CE-09: a text that is not a string is no text',
    [undefined, null, '', [SHOWN.en], { toString() { return SHOWN.en; } }, 7]
      .every((t) => recordWebCallbackConsent({ ...goodIn, consentText: t, receiptHash: '' }, IDS).reason === 'CONSENT_TEXT_MISSING'));
  ok('CE-09: the verbatim text stored beside the receipt is the text that was hashed (the PHI scrub leaves it alone)',
    scrubPHI(SHOWN.en).text === SHOWN.en && scrubPHI(SHOWN.es).text === SHOWN.es);

  const noIds = recordWebCallbackConsent(goodIn, {});
  ok('CRM-15: without ids nothing is sent, all three are named, and the scope is still in the receipt',
    noIds.fields.length === 0 && noIds.unmapped.join() === 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_AT,CALLBACK_CONSENT_SCOPE' &&
    noIds.warnings.length === 1 && /contact\.callback_consent_scope/.test(noIds.warnings[0]) &&
    noIds.receiptBit === 'scope=' + entry.scope && noIds.flag === null && !!noIds.consent);
  ok('CRM-15: a malformed id map behaves like no id map',
    recordWebCallbackConsent(goodIn, { CY2027_CRM_FIELD_IDS: 'not json' }).fields.length === 0 &&
    recordWebCallbackConsent(goodIn, { CY2027_CRM_FIELD_IDS: 'not json' }).unmapped.length === 3);
  for (const [label, map, withheld] of [
    ['the scope has no id', { CALLBACK_CONSENT_STATUS: 'cbS', CALLBACK_CONSENT_AT: 'cbA' }, 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_AT'],
    ['only the status has an id', { CALLBACK_CONSENT_STATUS: 'cbS' }, 'CALLBACK_CONSENT_STATUS'],
    ['the timestamp has no id', { CALLBACK_CONSENT_STATUS: 'cbS', CALLBACK_CONSENT_SCOPE: 'cbX' }, 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_SCOPE'],
  ]) {
    const r = recordWebCallbackConsent(goodIn, { CY2027_CRM_FIELD_IDS: JSON.stringify(map) });
    ok('CRM-15: GRANTED is never sent without its scope and its timestamp (' + label + ')',
      r.fields.length === 0 && r.withheld.join() === withheld && r.warnings.length === 2 &&
      r.warnings[1].includes(withheld.split(',').join(', ') + ' not written either') && r.receiptBit === 'scope=' + entry.scope);
  }
  for (const [over, reason] of [
    [{ consentGiven: 'true' }, 'NO_AFFIRMATIVE_CONSENT'],
    [{ disclaimerVersion: '' }, 'CONSENT_TEXT_VERSION_MISSING'],
    [{ disclaimerVersion: '2099-01-01' }, 'CONSENT_TEXT_VERSION_UNKNOWN'],
    [{ consentText: undefined }, 'CONSENT_TEXT_MISSING'],
    [{ consentText: SHOWN.en + ' and more', receiptHash: '' }, 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION'],
    [{ receiptHash: 'b'.repeat(64) }, 'CONSENT_RECEIPT_HASH_MISMATCH'],
    [{ at: undefined }, 'CONSENT_TIMESTAMP_MISSING'],
    [{ at: 'yesterday' }, 'CONSENT_TIMESTAMP_INVALID'],
  ]) {
    const r = recordWebCallbackConsent({ ...goodIn, ...over }, IDS);
    ok('CE-09: ' + reason + ' → no object, no field, a flag, and the reason in the receipt and the log',
      r.consent === null && r.reason === reason && r.fields.length === 0 && r.unmapped.length === 0 &&
      r.flag === 'CALLBACK_CONSENT_NOT_RECORDED' && r.flag === CALLBACK_CONSENT_NOT_RECORDED_FLAG &&
      r.receiptBit === 'callback_consent=NOT_RECORDED(' + reason + ')' &&
      r.warnings.length === 1 && r.warnings[0] === '[CALLBACK-CONSENT] not recorded as a consent object: ' + reason);
  }
  ok('CE-09: nothing the sender wrote can reach the log line, the flag or the receipt', (() => {
    const r = recordWebCallbackConsent({
      consentGiven: true, disclaimerVersion: 'Jane-Doe-7185550143', consentText: 'SSN 123-45-6789, call Jane Doe',
      receiptHash: 'feed' + 'a'.repeat(60), at: AT,
    }, IDS);
    return r.consent === null && !/Jane|7185550143|123-45-6789|feeda/.test(JSON.stringify(r));
  })());
  ok('CE-09: the record function never throws, whatever it is handed',
    [undefined, null, 'x', 7, [], [goodIn], { consentGiven: true, disclaimerVersion: {}, consentText: Symbol('x') },
      { get consentGiven() { throw new Error('a getter that throws'); } }]
      .every((i) => !reasonOf(() => recordWebCallbackConsent(i, IDS)).startsWith('THREW')) &&
    recordWebCallbackConsent({ get consentText() { throw new Error('a getter that throws'); } }, IDS) === CALLBACK_CONSENT_UNAVAILABLE &&
    recordWebCallbackConsent(goodIn, null) === CALLBACK_CONSENT_UNAVAILABLE);
  ok('CE-09: the fallback record is itself a refusal — no object, no field, flagged',
    CALLBACK_CONSENT_UNAVAILABLE.consent === null && CALLBACK_CONSENT_UNAVAILABLE.reason === 'CALLBACK_CONSENT_BUILD_FAILED' &&
    CALLBACK_CONSENT_UNAVAILABLE.fields.length === 0 && CALLBACK_CONSENT_UNAVAILABLE.flag === 'CALLBACK_CONSENT_NOT_RECORDED' &&
    CALLBACK_CONSENT_UNAVAILABLE.receiptBit === 'callback_consent=NOT_RECORDED(CALLBACK_CONSENT_BUILD_FAILED)');
  ok('CE-09: the record function is server-only, and consent.js brings no Node API into the shared barrel',
    !('recordWebCallbackConsent' in barrelModule) && 'webCallbackConsent' in barrelModule &&
    !/\bfrom\s+['"]node:/.test(strip(readFileSync(new URL('../api/_lib/cy2027/consent.js', import.meta.url), 'utf8'))));
  ok('CE-09: the record cannot be edited between being built and being written', (() => {
    const r = recordWebCallbackConsent(goodIn, IDS);
    try { r.fields[2].value = 'ANY_PRODUCT'; } catch { /* frozen */ }
    try { r.fields.push({ id: 'x', key: 'contact.x', value: 'y' }); } catch { /* frozen */ }
    try { r.receiptBit = 'scope=ANY_PRODUCT'; } catch { /* frozen */ }
    return Object.isFrozen(r) && Object.isFrozen(r.fields) && r.fields.every(Object.isFrozen) && r.fields.length === 3 &&
      byId(r, 'cbX') === entry.scope && r.receiptBit === 'scope=' + entry.scope;
  })());

  // ── 25f. The two handlers, run for real against a laboratory CRM ─────────────
  {
    const ENV_KEYS = ['HIGHLEVEL_TOKEN', 'HIGHLEVEL_LOCATION_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TURNSTILE_SECRET',
      'VERCEL', 'VERCEL_ENV', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CY2027_CRM_FIELD_IDS'];
    const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    const realFetch = globalThis.fetch;
    const realConsole = { log: console.log, warn: console.warn, error: console.error };
    const RealDate = Date;
    let harnessError = null;
    try {
      for (const k of ENV_KEYS) delete process.env[k];
      process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
      process.env.HIGHLEVEL_LOCATION_ID = 'LOC_TEST';

      const LOGS = [];
      for (const k of ['log', 'warn', 'error']) {
        console[k] = (...a) => { LOGS.push('[' + k + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
      }

      const GHL = 'https://services.leadconnectorhq.com';
      let CALLS = [];
      let ROUTE = null;
      const resp = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      globalThis.fetch = async (url, opts = {}) => {
        const u = String(url);
        // Nothing leaves this machine: any host but the double's is an error.
        if (!u.startsWith(GHL + '/')) throw new Error('the suite must not reach ' + u.slice(0, 60));
        let body = null;
        try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = String(opts.body); }
        const call = { method: String(opts.method || 'GET').toUpperCase(), path: u.slice(GHL.length), body };
        CALLS.push(call);
        return ROUTE(call);
      };
      const route = (o = {}) => (call) => {
        if (call.method === 'POST' && call.path === '/contacts/') return o.contact ? o.contact(call) : resp(201, { contact: { id: 'C_NEW' } });
        if (call.method === 'GET' && call.path.startsWith('/contacts/?')) return o.search ? o.search(call) : resp(200, { contacts: [] });
        if (call.method === 'POST' && /\/notes$/.test(call.path)) return resp(200, { note: { id: 'N1' } });
        if (call.method === 'GET' && call.path.startsWith('/opportunities/search')) return resp(200, { opportunities: [] });
        if (call.method === 'POST' && call.path === '/opportunities/') return resp(201, { opportunity: { id: 'O1' } });
        if (call.method === 'PUT' && call.path.startsWith('/contacts/')) return o.put ? o.put(call) : resp(200, { contact: { id: 'x' } });
        return resp(404, { error: 'unrouted' });
      };

      let ipSeq = 10;
      let phoneSeq = 3045000;
      const mkReq = (body) => ({
        method: 'POST',
        headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '198.51.100.' + (ipSeq++), 'user-agent': 'cy2027-suite', 'content-type': 'application/json' },
        readableEnded: true, complete: true, on() {}, get body() { return body; },
      });
      const mkRes = () => {
        const h = {};
        return {
          statusCode: 200, payload: undefined,
          setHeader(k, v) { h[k] = v; }, getHeader(k) { return h[k]; },
          status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end(d) { this.payload = d; return this; },
        };
      };
      const lead = (over) => {
        const n = phoneSeq++;
        return {
          first_name: 'Probe', last_name: 'Tester', phone: '718' + String(n), email: 'probe.tester' + n + '@example.com',
          zip: '10451', preferred_language: 'en', medicare_status: 'original', lead_source: 'ClearPoint Senior Advisors Website',
          form_name: 'contact-page Form', best_time_to_contact: 'morning', interest_type: 'Part D', lead_notes: 'please call me',
          consent_to_contact: true, consent_text: SHOWN.en, consent_receipt_hash: sha(SHOWN.en), disclaimer_version: SHOWN.version,
          signer_user_agent: 'Mozilla/5.0 probe', page_url: '/contact', elapsed_ok: true, tags: ['Website Lead'], ...over,
        };
      };
      const submitLead = (await import('../api/submit-lead.js')).default;
      const optOut = (await import('../api/opt-out.js')).default;
      const run = async (handler, body, r) => {
        CALLS = []; LOGS.length = 0; ROUTE = r;
        const res = mkRes();
        let threw = null;
        try { await handler(mkReq(body), res); } catch (e) { threw = String((e && e.message) || e); }
        return {
          status: res.statusCode, payload: res.payload, threw, calls: CALLS.slice(), logs: LOGS.slice(),
          creates: CALLS.filter((c) => c.method === 'POST' && c.path === '/contacts/'),
          puts: CALLS.filter((c) => c.method === 'PUT'),
          notes: CALLS.filter((c) => /\/notes$/.test(c.path)).map((c) => String(c.body && c.body.body)),
        };
      };
      const cf = (c, key) => (((c && c.body && c.body.customFields) || []).find((f) => f.key === key) || {}).value;
      const cbFields = (c) => ((c && c.body && c.body.customFields) || []).filter((f) => /callback_consent/.test(String(f.key)));
      const ACK = '{"ok":true,"received":true}';

      // A clock that never returns the same instant twice: two values can only
      // agree under it if they were written from ONE reading of it.
      let tick = 0;
      const T0 = RealDate.UTC(2026, 9, 3, 12, 0, 0);
      class TickDate extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(T0 + (tick++) * 1000); }
        static now() { return T0 + (tick++) * 1000; }
      }
      const withTickingClock = async (fn) => { globalThis.Date = TickDate; try { return await fn(); } finally { globalThis.Date = RealDate; } };

      // A — the canonical text, no CY2027 ids configured (production as it is today).
      {
        const r = await run(submitLead, lead(), route());
        const c = r.creates[0];
        ok('CE-09 (lead handler): a genuine lead is captured exactly once',
          r.status === 200 && !r.threw && r.creates.length === 1, `status=${r.status} threw=${r.threw}`);
        ok('CRM-15 (lead handler): with no id configured, no CALLBACK_CONSENT_* entry is sent', !!c && cbFields(c).length === 0);
        ok('CRM-15 (lead handler): and the gap is named in the log',
          r.logs.some((l) => /\[CY2027-CRM\] 3 field\(s\) could not be written/.test(l) && /CALLBACK_CONSENT_SCOPE/.test(l)));
        ok('CRM-15 (lead handler): the note receipt carries the scope as its own labelled value',
          r.notes.some((n) => /— TCPA Receipt — [^\n]*scope=DISCUSS_MEDICARE_PLAN_OPTIONS/.test(n)), r.notes.join('|').slice(0, 300));
        ok('CE-09 (lead handler): the verbatim text in the note is the text whose digest is registered',
          r.notes.some((n) => n.includes(SHOWN.en)));
        ok('CE-09 (lead handler): a genuine lead is not flagged',
          !/CALLBACK_CONSENT_NOT_RECORDED/.test(JSON.stringify(c && c.body)) && !r.notes.some((n) => /NOT_RECORDED/.test(n)));
        ok('CE-09 (lead handler): the four channel flags are still written',
          cf(c, 'contact.consent_calls') === 'true' && cf(c, 'contact.consent_sms') === 'true' &&
          cf(c, 'contact.consent_marketing') === 'true' && cf(c, 'contact.consent_email') === 'true');
        ok('CE-09 (lead handler): nothing about the person is in the new log lines',
          !r.logs.filter((l) => /CALLBACK-CONSENT|CY2027-CRM/.test(l)).some((l) => /Probe|Tester|718\d{7}|example\.com/.test(l)));
      }

      // B — ids configured: three entries, with real ids, in the create body.
      process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
      {
        const r = await withTickingClock(() => run(submitLead, lead(), route()));
        const c = r.creates[0];
        const at = cf(c, 'contact.callback_consent_at');
        ok('CRM-15 (lead handler): with ids, status / timestamp / scope are three entries in the create body',
          r.status === 200 && r.creates.length === 1 && cbFields(c).length === 3 &&
          cf(c, 'contact.callback_consent_status') === 'GRANTED' &&
          cf(c, 'contact.callback_consent_scope') === 'DISCUSS_MEDICARE_PLAN_OPTIONS' && isIsoInstant(at), `status=${r.status} at=${at}`);
        ok('CRM-15 (lead handler): they carry real ids, never names', cbFields(c).map((f) => f.id).sort().join() === 'cbA,cbS,cbX');
        ok('CE-09 (lead handler): the receipt and CALLBACK_CONSENT_AT are one instant, on a clock that never repeats',
          r.notes.some((n) => n.includes('at=' + at + ' ')), at + ' vs ' + ((r.notes.join('|').match(/at=\S+/) || [''])[0]));
        ok('CRM-15 (lead handler): nothing is left to warn about', !r.logs.some((l) => /\[CY2027-CRM\]|\[CALLBACK-CONSENT\]/.test(l)));
        ok('CE-09 (lead handler): the new-contact path writes with the create, never with a PUT', r.puts.length === 0);

        const es = await run(submitLead, lead({ consent_text: SHOWN.es, consent_receipt_hash: sha(SHOWN.es), preferred_language: 'es' }), route());
        ok('CE-09 (lead handler): the Spanish text earns the same stated scope',
          cf(es.creates[0], 'contact.callback_consent_scope') === 'DISCUSS_MEDICARE_PLAN_OPTIONS');
        const nh = await run(submitLead, lead({ consent_receipt_hash: '' }), route());
        ok('CE-09 (lead handler): an absent client hash does not block a text the server verified',
          cf(nh.creates[0], 'contact.callback_consent_status') === 'GRANTED' && cbFields(nh.creates[0]).length === 3);
        // "Recorded as scope rather than inferred": nothing the lead says about itself moves it.
        const own = await run(submitLead, lead({
          interest_type: 'Final Expense', lead_type: 'final-expense', scope: 'ANY_PRODUCT', consent_scope: 'ANY_PRODUCT',
          callback_consent_scope: 'ANY_PRODUCT', lead_notes: 'scope=ANY_PRODUCT please call me about everything you sell',
        }), route());
        ok('CRM-15 (lead handler): the scope does not follow what the lead is interested in, its type, or a scope it names itself',
          own.status === 200 && cf(own.creates[0], 'contact.callback_consent_scope') === 'DISCUSS_MEDICARE_PLAN_OPTIONS' &&
          !cbFields(own.creates[0]).some((f) => /ANY_PRODUCT|Final/i.test(String(f.value))) &&
          own.notes.some((n) => /— TCPA Receipt — [^\n]*scope=DISCUSS_MEDICARE_PLAN_OPTIONS/.test(n)), `status=${own.status}`);
      }

      // B2 — a partial id map: GRANTED must not land without its scope.
      {
        process.env.CY2027_CRM_FIELD_IDS = '{"CALLBACK_CONSENT_STATUS":"cbS","CALLBACK_CONSENT_AT":"cbA"}';
        const r = await run(submitLead, lead(), route());
        ok('CRM-15 (lead handler): a partial id map sends none of the three, says so, and the lead is still captured',
          r.status === 200 && r.creates.length === 1 && cbFields(r.creates[0]).length === 0 &&
          r.logs.some((l) => /CALLBACK_CONSENT_STATUS, CALLBACK_CONSENT_AT not written either/.test(l)) &&
          r.notes.some((n) => /scope=DISCUSS_MEDICARE_PLAN_OPTIONS/.test(n)));
        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
      }

      // C — a fake receipt (a hash and a version, no text): captured, nothing inferred.
      {
        const r = await run(submitLead, lead({ consent_text: undefined, consent_receipt_hash: 'a'.repeat(64) }), route());
        const c = r.creates[0];
        ok('CE-09 (lead handler): a receipt with no text still captures the lead', r.status === 200 && r.creates.length === 1);
        ok('CE-09 (lead handler): but writes no CALLBACK_CONSENT_* value', !!c && cbFields(c).length === 0);
        ok('CE-09 (lead handler): flags it for a human',
          /(^| )CALLBACK_CONSENT_NOT_RECORDED( |$)/.test(String(cf(c, 'contact.lead_quality_flags'))));
        ok('CE-09 (lead handler): names the reason in the receipt, and no scope',
          r.notes.some((n) => /— TCPA Receipt — [^\n]*callback_consent=NOT_RECORDED\(CONSENT_TEXT_MISSING\)/.test(n)) &&
          !r.notes.some((n) => /scope=/.test(n)));
        ok('CE-09 (lead handler): and in the log',
          r.logs.some((l) => l.includes('[CALLBACK-CONSENT] not recorded as a consent object: CONSENT_TEXT_MISSING')));
      }

      // D — every other way a submission fails to be the registered text.
      {
        const broader = SHOWN.en + ' You also agree to offers about any other product.';
        const named = (r, reason) => r.status === 200 && r.creates.length === 1 && cbFields(r.creates[0]).length === 0 &&
          r.notes.some((n) => n.includes('callback_consent=NOT_RECORDED(' + reason + ')')) && !r.notes.some((n) => /scope=/.test(n));
        ok('CRM-15 (lead handler): a broader wording under the registered version label earns no scope',
          named(await run(submitLead, lead({ consent_text: broader, consent_receipt_hash: sha(broader) }), route()), 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION'));
        ok('CE-09 (lead handler): the registered hash beside a different text is not believed',
          named(await run(submitLead, lead({ consent_text: broader }), route()), 'CONSENT_TEXT_NOT_THE_REGISTERED_VERSION'));
        ok('CE-09 (lead handler): an unknown text version is named',
          named(await run(submitLead, lead({ disclaimer_version: '2030-01-01' }), route()), 'CONSENT_TEXT_VERSION_UNKNOWN'));
        ok('CE-09 (lead handler): a receipt hash that disagrees with the text is named',
          named(await run(submitLead, lead({ consent_receipt_hash: 'b'.repeat(64) }), route()), 'CONSENT_RECEIPT_HASH_MISMATCH'));
        const bare = await run(submitLead, lead({ consent_text: undefined, consent_receipt_hash: undefined, disclaimer_version: undefined }), route());
        ok('CE-09 (lead handler): no receipt at all → still captured, flagged and logged',
          bare.status === 200 && bare.creates.length === 1 && cbFields(bare.creates[0]).length === 0 &&
          /CALLBACK_CONSENT_NOT_RECORDED/.test(String(cf(bare.creates[0], 'contact.lead_quality_flags'))) &&
          bare.logs.some((l) => /CONSENT_TEXT_VERSION_MISSING/.test(l)));
      }

      // E — the consent gate is where it was.
      {
        const r = await run(submitLead, lead({ consent_to_contact: 'true' }), route());
        ok('CE-09 (lead handler): the consent gate is unchanged — a non-boolean consent is a 400 before any CRM call',
          r.status === 400 && r.calls.length === 0 && !!r.payload && r.payload.error === 'CONSENT_REQUIRED');
      }

      // F — an existing contact (LEAD-02): no consent field lands on it.
      {
        const dup = () => resp(400, { message: 'This location does not allow duplicated contacts.', statusCode: 400 });
        const L = lead();
        const r = await run(submitLead, L, route({
          contact: dup,
          search: () => resp(200, { contacts: [{ id: 'C_EXIST', phone: '+1' + L.phone, tags: ['status-newlead'], dnd: false }] }),
        }));
        ok('CE-09 (lead handler): a repeat on an existing contact is recorded with ONE create attempt and no PUT (LEAD-02)',
          r.status === 200 && r.creates.length === 1 && r.puts.length === 0, `status=${r.status} creates=${r.creates.length} puts=${r.puts.length}`);
        ok('CRM-15 (lead handler): the repeat note carries the scope of the new consent',
          r.notes.some((n) => /New consent receipt on this submission — [^\n]*scope=DISCUSS_MEDICARE_PLAN_OPTIONS/.test(n)), r.notes.join('|').slice(0, 400));
        const L2 = lead({ consent_text: undefined, consent_receipt_hash: 'a'.repeat(64) });
        const r2 = await run(submitLead, L2, route({
          contact: dup,
          search: () => resp(200, { contacts: [{ id: 'C_EXIST2', phone: '+1' + L2.phone, tags: ['status-newlead'], dnd: false }] }),
        }));
        ok('CE-09 (lead handler): and says so when the new consent could not be recorded',
          r2.notes.some((n) => /New consent receipt on this submission — [^\n]*callback_consent=NOT_RECORDED\(CONSENT_TEXT_MISSING\)/.test(n)) &&
          !r2.notes.some((n) => /scope=/.test(n)), r2.notes.join('|').slice(0, 400));
      }

      // G — the CRM refuses the create because of the new fields: the lead is not lost.
      {
        const refuseNew = (status) => (call) => (cbFields(call).length ? resp(status, { message: 'Invalid custom field id' }) : resp(201, { contact: { id: 'C_NEW2' } }));
        const r = await run(submitLead, lead(), route({ contact: refuseNew(422) }));
        ok('CE-09 (lead handler): a create refused over the new fields is retried once without them, and the lead is kept',
          r.status === 200 && r.creates.length === 2 && cbFields(r.creates[0]).length === 3 && cbFields(r.creates[1]).length === 0 &&
          !!r.payload && r.payload.contact_id === 'C_NEW2', `status=${r.status} creates=${r.creates.length} ${JSON.stringify(r.payload)}`);
        ok('CE-09 (lead handler): the retry is the previous shape — every other value intact',
          r.creates.length === 2 && cf(r.creates[1], 'contact.consent_calls') === 'true' &&
          r.creates[1].body.customFields.length === r.creates[0].body.customFields.length - 3 &&
          JSON.stringify({ ...r.creates[1].body, customFields: 0 }) === JSON.stringify({ ...r.creates[0].body, customFields: 0 }));
        ok('CE-09 (lead handler): the drop is logged and audited',
          r.logs.some((l) => /\[CY2027-CRM\] contact create refused \(HTTP 422\)/.test(l)) && r.logs.some((l) => /"outcome":"cy2027_fields_dropped"/.test(l)));
        ok('CRM-15 (lead handler): the scope still reaches the note', r.notes.some((n) => /scope=DISCUSS_MEDICARE_PLAN_OPTIONS/.test(n)));
        const r400 = await run(submitLead, lead(), route({ contact: refuseNew(400) }));
        ok('CE-09 (lead handler): a 400 that is not a duplicate is retried the same way', r400.status === 200 && r400.creates.length === 2);
        const dead = await run(submitLead, lead(), route({ contact: () => resp(422, { message: 'nope' }) }));
        ok('CE-09 (lead handler): a refusal that persists is still an honest failure, after exactly one retry',
          dead.status === 502 && dead.creates.length === 2, `status=${dead.status} creates=${dead.creates.length}`);
        const auth = await run(submitLead, lead(), route({ contact: () => resp(401, { message: 'unauthorized' }) }));
        ok('CE-09 (lead handler): only a 400/422 is retried without the fields — a 401 is not',
          auth.creates.length === 1 && auth.status !== 200, `status=${auth.status} creates=${auth.creates.length}`);
        delete process.env.CY2027_CRM_FIELD_IDS;
        const plain = await run(submitLead, lead(), route({ contact: () => resp(422, { message: 'nope' }) }));
        ok('CE-09 (lead handler): with no ids configured there is nothing to drop, so a 422 is not retried',
          plain.status === 502 && plain.creates.length === 1, `status=${plain.status} creates=${plain.creates.length}`);
      }

      // H — the revocation mirror in api/opt-out.js.
      {
        const p0 = '7182013344';
        const known = () => resp(200, { contacts: [{ id: 'C_OPT', phone: '+1' + p0, tags: ['Consent Captured'] }] });
        const r0 = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known }));
        ok('CE-09 (opt-out handler): with no id configured the suppression is what it was — one PUT, dnd:true, four consent fields',
          r0.status === 200 && JSON.stringify(r0.payload) === ACK && r0.puts.length === 1 && r0.puts[0].body.dnd === true &&
          r0.puts[0].body.customFields.length === 4 && cbFields(r0.puts[0]).length === 0);
        ok('CE-09 (opt-out handler): the gap is named in the log', r0.logs.some((l) => /\[CY2027-CRM\] 2 field\(s\) could not be written/.test(l)));
        ok('CE-09 (opt-out handler): the note records that the callback permission was revoked',
          r0.notes.some((n) => /^Callback contact permission: REVOKED$/m.test(n)));

        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
        const r1 = await withTickingClock(() => run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known })));
        const put = r1.puts[0];
        const at = ((put && put.body.customFields.find((f) => f.id === 'cbA')) || {}).value;
        ok('CE-09 (opt-out handler): REVOKED is written through the same mapping, with its real id',
          r1.puts.length === 1 && put.body.customFields.some((f) => f.id === 'cbS' && f.key === 'contact.callback_consent_status' && f.value === 'REVOKED'));
        ok('CE-09 (opt-out handler): the revocation instant is written, and the note carries that same instant',
          isIsoInstant(at) && r1.notes.some((n) => n.includes('Timestamp (UTC): ' + at + '\n')), String(at));
        ok('CRM-15 (opt-out handler): a revocation never writes a scope',
          !!put && cbFields(put).length === 2 && !put.body.customFields.some((f) => /scope/i.test(f.key + ' ' + f.id)) &&
          !/DISCUSS_MEDICARE_PLAN_OPTIONS/.test(JSON.stringify(r1.calls)));
        ok('CE-09 (opt-out handler): it still only suppresses — dnd:true, nothing GRANTED, no consent value set true',
          !!put && put.body.dnd === true && !/GRANTED/.test(JSON.stringify(r1.calls)) && !/"value":"true"/.test(JSON.stringify(put.body)));

        const refuse = (call) => (cbFields(call).length ? resp(422, { message: 'bad id' }) : resp(200, { contact: { id: 'C_OPT' } }));
        const r2 = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known, put: refuse }));
        ok('CE-09 (opt-out handler): an update refused over the new fields is re-sent in its previous shape',
          r2.puts.length === 2 && cbFields(r2.puts[0]).length === 2 && r2.puts[1].body.dnd === true &&
          r2.puts[1].body.customFields.length === 4 && cbFields(r2.puts[1]).length === 0);
        ok('CE-09 (opt-out handler): and the suppression is reported applied, with the same acknowledgement',
          r2.logs.some((l) => /\[OPTOUT\] applied dnd=true/.test(l)) && JSON.stringify(r2.payload) === ACK);
        const open = await run(optOut, { phone: p0, evidence: 'chat_optout', channels: { email: 'ALLOWED' } }, route({ search: known }));
        ok('CE-09 (opt-out handler): leaving email open still revokes the callback permission',
          open.puts.length === 1 && open.puts[0].body.customFields.some((f) => f.id === 'cbS' && f.value === 'REVOKED') &&
          open.puts[0].body.customFields.length === 5);
        const r3 = await run(optOut, { phone: '2125550143', evidence: 'chat_optout' }, route());
        ok('CE-09 (opt-out handler): an unknown contact gets the same acknowledgement and no write',
          JSON.stringify(r3.payload) === ACK && r3.puts.length === 0);
      }
    } catch (e) {
      harnessError = e;
    } finally {
      globalThis.Date = RealDate;
      globalThis.fetch = realFetch;
      for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
      for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    }
    ok('CE-09: both handlers ran to the end of the harness', harnessError === null,
      harnessError && String(harnessError.stack || harnessError).slice(0, 500));
  }
}

if (failures.length) {
  console.error(`CY2027 LAYER: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

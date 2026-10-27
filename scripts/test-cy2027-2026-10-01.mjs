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
  superseded, revokeSoaInstance, coversCategory, requiresScopeUpdate, marketingGate as marketingGateAtClock, requiresNewInstance,
  LANGUAGE_SOURCE, languageWasElected, isSoaLanguage, languageElectionLabel, readLanguageElection,
  electionAttributionError,
} from '../api/_lib/cy2027/soa-instance.js';
import {
  CONSENT_STATUS, createConsent, revokeConsent, classifyReply, isAffirmative, assertNoCrossInference, mayPlaceOutbound,
  CONTACT_CONSENT_TEXT_VERSIONS, webCallbackConsent, isStatedConsentScope, isIsoInstant, isRecordableInstant,
  CONSENT_CLOCK_TOLERANCE_MS,
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
  markLinkOutcome, LINK_OUTCOME,
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
  EXISTING_CRM_FIELDS, PRODUCTION_FIELD_IDS, existingField, LEGACY_SOA_NAME_FIELDS, legacySoaNameFields,
  normalizeFieldName, registeredFields, findEquivalentFields, registryProblems, planProvisioning, REGISTRY_PROBLEM,
  PROVISIONING_REFUSAL, readAccountListing,
} from '../api/_lib/cy2027/crm-fields.js';
import {
  recordWebCallbackConsent, CALLBACK_CONSENT_UNAVAILABLE, CALLBACK_CONSENT_NOT_RECORDED_FLAG,
  tcpaReceiptLine, consentReceiptText, receiptClaim, neutralizeReceiptLookalikes, crmRefusalStep,
  recordCallbackRevocation, callbackConsentStateOf, callbackRevocationNoteLine,
  CALLBACK_REVOCATION_UNAVAILABLE, CALLBACK_REVOCATION_MODE, CALLBACK_CONSENT_STATE,
} from '../api/_lib/cy2027/callback-consent.js';
import {
  consentWordingProblems, readShownConsentWording, consentWordingCopyProblems, CONSENT_WORDING_PROBES,
} from './consent-wording-gate.mjs';
import { scrubPHI } from '../api/_lib/phi-scrub.js';
import {
  sendingEnabled, maySendCopy, buildCopyMessage, assertNotMarketing,
} from '../api/_lib/cy2027/beneficiary-copy.js';
import { parseCountyCsv, resolveSigningRulesets } from '../api/_lib/cy2027/state-rules.js';
import { stripComments, GOVERNING_IDENTIFIERS, runGate } from './no-self-modification-lib.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join as pathJoin, dirname as pathDirname, resolve as pathResolve } from 'node:path';

// AUDIT 2026-10-04 (red team) — two things this suite used to get from the
// ambient world are now pinned here, so that it says the same thing on any day:
//   • the marketing gate reads the clock (it refuses a ruleset that is not in
//     force NOW). Every assertion below is about CY2027, so the gate is asked at
//     an instant inside CY2027 unless a test passes its own `now`; the rollover
//     is exercised in scripts/test-cy2027-yearly-2026-10-04.mjs.
//   • a human-only decision needs an AUTHORISED reviewer (CY2027_REVIEWERS).
//     The two identities the quarantine tests decide as are the configured ones.
const IN_CY2027 = new Date('2026-11-01T12:00:00Z');
const marketingGate = (instance, appointment, ruleset, opts = {}) =>
  marketingGateAtClock(instance, appointment, ruleset, { now: IN_CY2027, ...opts });
process.env.CY2027_REVIEWERS = 'sawil, Sawil Reyes';

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
// AUDIT 2026-10-04 (red team) — this was a block-comment regex followed by a
// line-comment regex. A `//` comment containing `api/*.js` opened a "block
// comment" that swallowed real code up to the next `*/`, so a scan for the
// ABSENCE of something could pass on code it never saw. The comment boundaries
// now come from the parser (see scripts/no-self-modification-lib.mjs).
const strip = (src) => stripComments(src);

const baseInput = {
  soaId: 'soa_1', appointmentId: 'appt_1', appointmentAt: '2026-11-10T15:00:00Z',
  appointmentFormat: 'TELEPHONE', planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk',
  language: 'en', languageSource: 'BENEFICIARY_ELECTED',
  method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public',
  selectedCategories: ['MA_WITH_RX'], stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
  cmsRulesetVersion: 'CMS_RULESET_2027-v1.0',
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
  // AUDIT 2026-10-04 (WVG-11, red team) — "consumed" no longer means "signed":
  // the burn precedes the evidence write, so until the FILED stamp a consumed
  // link is one with nothing filed behind it, and says so.
  ok('WVG-11: a consumed link is IN_PROGRESS, with no signing time on it', used.record.consumedOutcome === 'IN_PROGRESS' && !('signedAt' in used.record));
  ok('a second consumption is refused, as used-and-unfiled', consumeLink(used.record).reason === 'LINK_CONSUMED_UNFILED');
  ok('a consumed link no longer checks out', checkLink(used.record).reason === 'LINK_CONSUMED_UNFILED');
  const filedLink = markLinkOutcome(used.record, LINK_OUTCOME.FILED, { signedAt: '2026-11-10T14:00:00Z' });
  ok('WVG-11: a FILED stamp is the only thing that makes a consumed link "already used"',
    checkLink(filedLink).reason === 'LINK_ALREADY_USED' && filedLink.signedAt === '2026-11-10T14:00:00Z' && consumeLink(filedLink).reason === 'LINK_ALREADY_USED');
  const failedLink = markLinkOutcome(used.record, LINK_OUTCOME.FAILED, { stage: 'EVIDENCE_STORE' });
  ok('WVG-11: a FAILED stamp names its stage and carries no signing time',
    checkLink(failedLink).reason === 'LINK_CONSUMED_UNFILED' && failedLink.failedStage === 'EVIDENCE_STORE' && failedLink.signedAt === null);
  ok('WVG-11: a FILED stamp after a FAILED one clears the stage', markLinkOutcome(failedLink, LINK_OUTCOME.FILED, { signedAt: '2026-11-10T14:00:00Z' }).failedStage === null);
  ok('WVG-11: only the exact FILED value is a signature — an allow-list, not a deny-list',
    ['filed', 'Filed', ' FILED', 'FILED ', 'IN_PROGRESS', 'FAILED', true, 1, ['FILED'], { toString: () => 'FILED' }, undefined, null]
      .every((v) => checkLink({ ...used.record, consumedOutcome: v }).reason === 'LINK_CONSUMED_UNFILED'));
  ok('WVG-11: a consumed link without any outcome is unfiled, never "already signed"',
    checkLink({ ...record, consumedAt: '2026-11-10T14:00:00Z' }).reason === 'LINK_CONSUMED_UNFILED');
  throws('WVG-11: a link that was never consumed has no outcome', () => markLinkOutcome(record, LINK_OUTCOME.FILED, { signedAt: '2026-11-10T14:00:00Z' }), /only a consumed link/);
  throws('WVG-11: FILED without a filing time is refused', () => markLinkOutcome(used.record, LINK_OUTCOME.FILED), /filing time/);
  throws('WVG-11: FILED with an unreadable time is refused', () => markLinkOutcome(used.record, LINK_OUTCOME.FILED, { signedAt: 'later' }), /filing time/);
  throws('WVG-11: FAILED without a stage is refused', () => markLinkOutcome(used.record, LINK_OUTCOME.FAILED), /stage/);
  throws('WVG-11: an outcome outside the vocabulary is refused', () => markLinkOutcome(used.record, 'SIGNED', { signedAt: '2026-11-10T14:00:00Z' }), /unknown link outcome/);
  throws('WVG-11: IN_PROGRESS is set by the burn, never stamped afterwards', () => markLinkOutcome(used.record, LINK_OUTCOME.IN_PROGRESS), /unknown link outcome/);
  ok('WVG-11: the outcome vocabulary is frozen and exactly three values', Object.isFrozen(LINK_OUTCOME) && Object.keys(LINK_OUTCOME).join() === 'IN_PROGRESS,FILED,FAILED');

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
  ok('SL-03: a falsy-but-present consumedAt still counts as consumed (and, with no FILED stamp, as unfiled)', checkLink({ ...record, consumedAt: 0 }).reason === 'LINK_CONSUMED_UNFILED');
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

  // AUDIT 2026-10-04 (red team) — the two resolutions are ONE function now
  // (resolveSigningRulesets), so the rule is exercised by calling it — here for
  // CY2027, and on both sides of a rollover in the yearly suite — and the handler
  // is pinned to calling exactly that.
  ok('server imports the ruleset resolver', /import \{[^}]*resolveSigningRulesets[^}]*\} from '\.\/_lib\/cy2027\/state-rules\.js'/.test(SRC));
  ok('server imports the state resolver', (() => {
    const r = resolveSigningRulesets('NY', IN_CY2027, {});
    return r.ok === true && r.ruleset === CMS_RULESET_2027 && r.stateRuleset === STATE_RULESETS.NY;
  })());
  ok('server imports the instance builder', /createSoaInstance/.test(SRC) && /completeSoaInstance/.test(SRC));
  ok('server imports the evidence builder', /buildEvidenceRecord/.test(SRC));

  ok('server resolves the plan year from its own clock, not the body',
    /^[ \t]*var rules = resolveSigningRulesets\(residenceState\);/m.test(strip(SRC)), 'resolveSigningRulesets(residenceState) not found');
  ok('server fails closed when no ruleset governs', /SOA_RULESET_UNAVAILABLE/.test(SRC));
  ok('server gates on the state ruleset', (() => {
    const r = resolveSigningRulesets('FL', IN_CY2027, {});
    return r.ok === false && r.stage === 'STATE_RULESET' && r.reason === 'STATE_NOT_SUPPORTED';
  })());
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
  // AUDIT 2026-10-04 (WVG-11, red team) — a used link with nothing filed must not say "already signed".
  ok('WVG-11: a used-and-unfiled link gets its own page, which offers a restart and claims no signature',
    /data\.reason === 'LINK_CONSUMED_UNFILED' \? 'consumedUnfiled'/.test(PAGE) && /phase === 'consumedUnfiled'/.test(PAGE) &&
    /We do not hold a signed document from you/.test(PAGE) && /No tenemos ningún documento firmado suyo/.test(PAGE));
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
  // RED TEAM 2026-10-04 — this assertion was labelled "the callback scope is
  // queryable" and kept passing after 'this request' (the voice script's scope)
  // could no longer be written. It tests the FLATTEN step, and says so; what the
  // write stage does with that scope is asserted right below.
  ok('the flatten step carries the callback scope as its own value', cf.CALLBACK_CONSENT_SCOPE === 'this request');
  ok('an absent consent produces no field', cf.AI_OUTBOUND_CONSENT_STATUS === undefined);
  {
    const r = buildCustomFields(cf, {
      CY2027_CRM_FIELD_IDS: '{"RECORDING_NOTICE_STATUS":"rn","CALLBACK_CONSENT_STATUS":"cbS","CALLBACK_CONSENT_AT":"cbA","CALLBACK_CONSENT_SCOPE":"cbX"}',
    });
    ok('CRM-15: a GRANTED callback consent whose scope no registered wording states ("this request") is not written at all',
      r.fields.map((f) => f.id + '=' + f.value).join() === 'rn=GRANTED' && r.withheld.length === 0 &&
      ['CALLBACK_CONSENT_SCOPE', 'CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT'].every((n) => r.refused.includes(n)),
      JSON.stringify(r));
  }

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
      // RED TEAM 2026-10-04 — only the VERSION was doubled here, so "first
      // declaration wins" for a text went unnoticed. A second text is the same defect.
      mkSrc() + "export const TCPA_CONSENT_TEXT_ES = 'Llame para discutir X.';\n",          // a text declared twice (same)
      "export const TCPA_CONSENT_TEXT_EN = 'Call me to discuss X and Y.';\n" + mkSrc(),     // a text declared twice (first differs)
      mkSrc() + "export const TCPA_CONSENT_TEXT_ES = 'Llame para discutir X y Z.';\n",      // a text declared twice (last differs)
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
  ok('CE-09: the gate module ships to the Vercel build',
    /^!scripts\/consent-wording-gate\.mjs\r?$/m.test(readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8')));

  // ── One source for the wording (red team 2026-10-04) ─────────────────────────
  // The rule is a function of the files; it is called with wording made up here.
  {
    const CANON = 'src/lib/disclaimerVersion.ts';
    const canonSrc =
      "export const DISCLAIMER_VERSION = 'v1';\n" +
      "export const TCPA_CONSENT_TEXT_EN = 'By agreeing, you authorize ClearPoint Senior ' +\n  'Advisors to call you.';\n" +
      "export const TCPA_CONSENT_TEXT_ES = 'Al aceptar, usted autoriza a ClearPoint Senior Advisors a llamarle.';\n";
    const scan = (others, canon = canonSrc) => consentWordingCopyProblems({
      files: [{ path: CANON, source: canon }, ...others.map(([path, source]) => ({ path, source }))],
    });
    const clean = scan([['src/a.tsx', "import { TCPA_CONSENT_TEXT_EN } from './lib/disclaimerVersion';\nconst m = 'May I have your number?\\n\\n' + TCPA_CONSENT_TEXT_EN;\n"]]);
    ok('CE-09: a file that USES the constants is not a copy', clean.problems.length === 0 && clean.scanned === 1, clean.problems.join('|'));
    for (const [label, src] of [
      ['an English copy', "const m = 'By agreeing, you authorize ClearPoint Senior Advisors and any other company to call you.';\n"],
      ['a Spanish copy', "const m = 'Al aceptar, usted autoriza a ClearPoint Senior Advisors a venderle lo que sea.';\n"],
      ['a copy split across concatenated pieces', "const m = 'By agreeing, you authorize ' +\n  'ClearPoint Senior Advisors to call.';\n"],
      ['a copy in a template literal wrapped over two lines', 'const m = `By agreeing, you authorize\n   ClearPoint Senior Advisors to call.`;\n'],
      ['a copy in other capitals', "const m = 'YOU AUTHORIZE CLEARPOINT SENIOR ADVISORS';\n"],
      ['a copy in JSX text', '<p>\n  Al aceptar, usted autoriza a\n  ClearPoint Senior Advisors.\n</p>\n'],
    ]) {
      const r = scan([['src/components/Bot.tsx', src]]);
      ok('CE-09: ' + label + ' outside the canonical file fails the build',
        r.problems.length === 1 && /src\/components\/Bot\.tsx contains its own copy/.test(r.problems[0]), r.problems.join('|'));
    }
    ok('CE-09: the wording quoted in a COMMENT is not a copy',
      scan([['src/x.ts', '// you authorize ClearPoint Senior Advisors\n/* usted autoriza a ClearPoint Senior Advisors */\nexport const x = 1;\n']]).problems.length === 0);
    ok('CE-09: a Windows path is the same file',
      consentWordingCopyProblems({ files: [{ path: 'src\\lib\\disclaimerVersion.ts', source: canonSrc }] }).problems.length === 0);
    ok('CE-09: the scan refuses to run without the canonical file, or with it twice',
      /was not given/.test(consentWordingCopyProblems({ files: [{ path: 'src/a.ts', source: 'x' }] }).problems[0] || '') &&
      /was not given/.test(consentWordingCopyProblems({ files: [{ path: CANON, source: canonSrc }, { path: CANON, source: canonSrc }] }).problems[0] || '') &&
      [undefined, null, {}, { files: 'x' }].every((i) => /was not given/.test(consentWordingCopyProblems(i).problems[0] || '')));
    ok('CE-09: a wording change that drops the clause the scan looks for is itself a failure, not a blind scan', (() => {
      const r = scan([], canonSrc.replace('you authorize ClearPoint Senior ', 'you allow ClearPoint Senior '));
      return r.problems.length === 1 && /no longer contains "you authorize ClearPoint Senior Advisors"/.test(r.problems[0]);
    })());
    ok('CE-09: the clauses the scan looks for are in the wording shown today',
      SHOWN.en.includes(CONSENT_WORDING_PROBES.en) && SHOWN.es.includes(CONSENT_WORDING_PROBES.es) && Object.isFrozen(CONSENT_WORDING_PROBES));
  }

  // ── The REAL gate, run on a copy of the tree (red team 2026-10-04) ───────────
  // The fail path of check-cy2027-parity.mjs was never executed: an inserted
  // `wording.problems.length = 0;`, a shadowed `problems` array, a check skipped
  // "when VERCEL is set" and a missing-file branch that only wrote a note all
  // passed 908 assertions, because three line-anchored greps and one PASSING run
  // cannot see any of them. The gate is now run for real — from a temporary copy
  // of the tree, so the repository is never edited — against a drifted wording,
  // a second copy, a missing file, and the deployed artifact with VERCEL=1.
  {
    const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
    const tmp = mkdtempSync(pathJoin(tmpdir(), 'cy2027-parity-'));
    let gateError = null;
    try {
      const vercelignore = readFileSync(pathJoin(REPO_ROOT, '.vercelignore'), 'utf8');
      // The scripts/ files the artifact keeps: exactly the "!scripts/…" exceptions.
      const shipped = vercelignore.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^!scripts\/[\w.-]+$/.test(l)).map((l) => l.slice(1));
      const fullTree = pathJoin(tmp, 'full');
      const artifact = pathJoin(tmp, 'artifact');
      for (const [root, withDocs] of [[fullTree, true], [artifact, false]]) {
        mkdirSync(pathJoin(root, 'scripts'), { recursive: true });
        for (const d of ['api', 'src']) cpSync(pathJoin(REPO_ROOT, d), pathJoin(root, d), { recursive: true });
        for (const f of ['index.html', 'package.json', '.vercelignore', ...shipped]) {
          if (existsSync(pathJoin(REPO_ROOT, f))) cpSync(pathJoin(REPO_ROOT, f), pathJoin(root, f));
        }
        if (withDocs) cpSync(pathJoin(REPO_ROOT, 'docs', 'compliance'), pathJoin(root, 'docs', 'compliance'), { recursive: true });
      }
      const runGate = (root, env = {}) => {
        const clean = { ...process.env };
        for (const k of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL']) delete clean[k];
        const r = spawnSync(process.execPath, [pathJoin(root, 'scripts', 'check-cy2027-parity.mjs')], { cwd: root, encoding: 'utf8', env: { ...clean, ...env } });
        return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
      };
      const edit = (root, rel, fn) => {
        const p = pathJoin(root, rel);
        const before = readFileSync(p, 'utf8');
        const after = fn(before);
        if (after === before) throw new Error('the test edit did not change ' + rel);
        writeFileSync(p, after);
        return () => writeFileSync(p, before);
      };
      const DV = 'src/lib/disclaimerVersion.ts';
      const BOT = 'src/components/CustomerServiceBot.tsx';
      const passNote = 'contact-consent wording v' + SHOWN.version + ' matches its scope registry (' + (entry && entry.scope) + ')';

      const control = runGate(fullTree);
      ok('CE-09 (gate, run): the copy of the tree passes, as the repository does',
        control.status === 0 && control.out.includes(passNote) && /contact-consent wording has a single source \(\d+ files scanned\)/.test(control.out),
        control.out.slice(-400));
      const onVercel = runGate(artifact, { VERCEL: '1' });
      ok('CE-09 (gate, run): the deployed artifact (no docs/, only the shipped scripts) passes with VERCEL=1 — and still RUNS the wording check',
        onVercel.status === 0 && onVercel.out.includes(passNote) && /has a single source/.test(onVercel.out), onVercel.out.slice(-400));

      for (const [where, root, env] of [['locally', fullTree, {}], ['on Vercel', artifact, { VERCEL: '1' }], ['on Vercel (VERCEL_ENV only)', artifact, { VERCEL_ENV: 'production' }]]) {
        let undo = edit(root, DV, (s) => s.replace('to discuss Medicare plan options', 'to discuss Medicare plan options and any other product we sell'));
        const drift = runGate(root, env);
        undo();
        ok('CE-09 (gate, run): an edited wording under the same version FAILS the build ' + where,
          drift.status === 1 && /EN contact-consent wording changed/.test(drift.out) && !drift.out.includes(passNote), drift.out.slice(-400));

        undo = edit(root, BOT, (s) => s.replace("\\n\\n' + TCPA_CONSENT_TEXT_ES", "\\n\\nAl aceptar, usted autoriza a ClearPoint Senior Advisors a ofrecerle cualquier producto.'"));
        const copy = runGate(root, env);
        undo();
        ok('CE-09 (gate, run): a second copy of the wording in the chat FAILS the build ' + where,
          copy.status === 1 && /CustomerServiceBot\.tsx contains its own copy of the contact-consent wording/.test(copy.out), copy.out.slice(-400));

        const dvPath = pathJoin(root, DV);
        const dvBefore = readFileSync(dvPath, 'utf8');
        rmSync(dvPath);
        const missing = runGate(root, env);
        writeFileSync(dvPath, dvBefore);
        ok('CE-09 (gate, run): a missing wording file FAILS the build ' + where,
          missing.status === 1 && /src\/lib\/disclaimerVersion\.ts is missing/.test(missing.out), missing.out.slice(-400));
      }
      const again = runGate(fullTree);
      ok('CE-09 (gate, run): every edit was undone — the copy passes again', again.status === 0 && again.out.includes(passNote), again.out.slice(-300));
    } catch (e) {
      gateError = e;
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* a leftover temp dir is not a test result */ }
    }
    ok('CE-09 (gate, run): the gate harness ran to its end', gateError === null, gateError && String(gateError.stack || gateError).slice(0, 500));
  }

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
  // RED TEAM 2026-10-04 — the shape test plus Date.parse() let these through:
  // V8 rolls them over to another day, and the impossible string was written.
  ok('CE-09: an instant that does not exist is not an instant (31 February, 24:00:00, 31 April, 29 Feb off a leap year)',
    ['2026-02-31T00:00:00Z', '2026-02-30T12:00:00.000Z', '2026-10-04T24:00:00Z', '2026-04-31T10:00:00Z', '2026-02-29T00:00:00Z', '2026-10-02T15:00:60Z']
      .every((t) => isIsoInstant(t) === false) &&
    ['2028-02-29T00:00:00Z', '2026-10-02T23:59:59.999Z', '2026-10-02T15:00:00.1Z', '2026-10-02T15:00:00.12Z', '2026-12-31T00:00:00.000Z']
      .every((t) => isIsoInstant(t) === true));
  ok('CE-09: an instant in the future is not one a record may carry — judged against the clock it is given', (() => {
    const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
    const iso = (ms) => new Date(ms).toISOString();
    return isRecordableInstant(iso(NOW), NOW) === true &&
      isRecordableInstant(iso(NOW - 1), NOW) === true &&
      isRecordableInstant('1990-01-01T00:00:00Z', NOW) === true &&          // no lower bound is invented
      isRecordableInstant(iso(NOW + CONSENT_CLOCK_TOLERANCE_MS), NOW) === true &&
      isRecordableInstant(iso(NOW + CONSENT_CLOCK_TOLERANCE_MS + 1), NOW) === false &&
      isRecordableInstant('2099-01-01T00:00:00Z', NOW) === false &&
      isRecordableInstant('2026-02-31T00:00:00Z', NOW) === false &&
      isRecordableInstant('yesterday', NOW) === false &&
      isRecordableInstant(iso(NOW), NaN) === false &&
      CONSENT_CLOCK_TOLERANCE_MS === 5 * 60 * 1000 &&
      // and against THIS machine's clock when none is given
      isRecordableInstant(new Date().toISOString()) === true &&
      isRecordableInstant(new Date(Date.now() + 24 * 3600 * 1000).toISOString()) === false;
  })());

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
    ['yesterday', '2026-10-02', 1759417200000, new Date(AT), '2026-13-45T99:99:99Z', [AT], '2026-02-31T00:00:00Z', '2026-10-04T24:00:00Z']
      .every((t) => refusal({ at: t }).reason === 'CONSENT_TIMESTAMP_INVALID'));
  ok('CE-09: a consent dated in the future is refused by name, and yields no object',
    ['2099-01-01T00:00:00Z', new Date(Date.now() + 3600 * 1000).toISOString()]
      .every((t) => refusal({ at: t }).reason === 'CONSENT_TIMESTAMP_IN_THE_FUTURE' && refusal({ at: t }).consent === null) &&
    !!refusal({ at: new Date().toISOString() }).consent);
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
  // AUDIT 2026-10-04 (CE-09 / CRM-15) — these three blocks used to hand the
  // mapping a scope with NOTHING beside it, and the positive control asserted
  // that a lone scope is written. A lone scope is now refused by the unit rule
  // (it would re-scope an earlier grant), which would have left the provenance
  // and allow-list cases below passing for the wrong reason. Each case therefore
  // travels beside a revocation — a status and its instant that are valid on
  // their own — so that ONLY the scope's own rule decides, and the control
  // proves the same carrier does write a scope that is confirmed and registered.
  const withScope = (scope) => buildCustomFields({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: scope }, IDS);
  const onlyTheScopeRefused = (r) => r.refused.join() === 'CALLBACK_CONSENT_SCOPE' && r.withheld.length === 0 &&
    r.fields.map((f) => f.id + '=' + f.value).join() === 'cbS=REVOKED,cbA=' + AT;
  for (const src of ['AI_INFERRED', 'ai_inferred', 'INFERRED_FROM_LEAD', 'GUESS', '', null, undefined]) {
    // The VALUE is the registered scope, so only the provenance rule can refuse it.
    const r = withScope({ value: entry.scope, source: src });
    ok('CRM-15: provenance ' + JSON.stringify(src) + ' may not write the scope', onlyTheScopeRefused(r), JSON.stringify(r));
  }
  ok('CRM-15: a confirmed, registered scope is written',
    [{ value: entry.scope, source: 'BENEFICIARY_CONFIRMED' }, { value: entry.scope, source: 'SYSTEM' }, entry.scope].every((scope) => {
      const r = withScope(scope);
      return r.mapped === 3 && r.refused.length === 0 && byId(r, 'cbX') === entry.scope && byId(r, 'cbS') === 'REVOKED';
    }));
  for (const bad of ['ANY_PRODUCT', 'discuss_medicare_plan_options', ' ' + entry.scope, 'this request', 'constructor',
    [entry.scope], { toString() { return entry.scope; } }, 7, true]) {
    // The PROVENANCE is acceptable both times, so only the allow-list of stated scopes can refuse it.
    const shownAs = typeof bad === 'string' ? JSON.stringify(bad) : Object.prototype.toString.call(bad);
    const plain = withScope(bad);
    const confirmed = withScope({ value: bad, source: 'BENEFICIARY_CONFIRMED' });
    ok('CRM-15: ' + shownAs + ' is not a scope any registered wording states, so it is not written',
      onlyTheScopeRefused(plain) && onlyTheScopeRefused(confirmed), JSON.stringify(plain));
  }
  ok('CRM-15: a consent object assembled by hand does not get its scope into the CRM', (() => {
    const forged = { type: 'CALLBACK_CONTACT_PERMISSION', status: 'GRANTED', at: AT, scope: 'ANY_PRODUCT', revokedAt: null };
    const r = buildCustomFields(consentsToFields({ callbackConsent: forged }), IDS);
    return r.refused.includes('CALLBACK_CONSENT_SCOPE') && !r.fields.some((f) => f.id === 'cbX');
  })());

  // RED TEAM 2026-10-04 — the assertion above passed while GRANTED and its
  // timestamp were still in r.fields: the scope was dropped ALONE, which is
  // "granted, scope unknown". The callback consent is a unit at the write stage.
  const unit = (values, env = IDS) => {
    const r = buildCustomFields(values, env);
    return { sent: r.fields.map((f) => f.id + '=' + f.value).join(), refused: r.refused.slice().sort().join(), withheld: r.withheld.join(), unmapped: r.unmapped.join() };
  };
  const ALL3 = 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_SCOPE,CALLBACK_CONSENT_STATUS';
  ok('CRM-15 (write stage): a whole callback consent is sent whole', (() => {
    const u = unit({ CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope });
    return u.sent === 'cbS=GRANTED,cbA=' + AT + ',cbX=' + entry.scope && u.refused === '' && u.withheld === '' && u.unmapped === '';
  })());
  for (const [label, callbackConsent] of [
    ['a hand-built object with an unregistered scope', { type: 'CALLBACK_CONTACT_PERMISSION', status: 'GRANTED', at: AT, scope: 'ANY_PRODUCT', revokedAt: null }],
    ['the voice script\'s scope ("this request")', createConsent({ type: 'CALLBACK_CONTACT_PERMISSION', status: CONSENT_STATUS.GRANTED, language: 'es', channel: 'VOICE', scriptVersion: 'base-layer-a-v1', scope: 'this request', at: AT })],
  ]) {
    const u = unit(consentsToFields({ callbackConsent }));
    ok('CRM-15 (write stage): GRANTED never leaves without its scope — ' + label + ' sends NOTHING and names all three',
      u.sent === '' && u.refused === ALL3, JSON.stringify(u));
  }
  for (const [label, values, refused] of [
    ['a rehydrated object with no scope at all', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: AT }, 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_STATUS'],
    ['a bare GRANTED', { CALLBACK_CONSENT_STATUS: 'GRANTED' }, 'CALLBACK_CONSENT_STATUS'],
    ['GRANTED with a scope and no timestamp', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_SCOPE: entry.scope }, 'CALLBACK_CONSENT_SCOPE,CALLBACK_CONSENT_STATUS'],
    ['GRANTED with an empty scope', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: '' }, 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_STATUS'],
    ['GRANTED with a timestamp that is not an instant', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: 'yesterday', CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['GRANTED with a timestamp that does not exist', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: '2026-02-31T00:00:00Z', CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['GRANTED dated in the future', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: '2099-01-01T00:00:00Z', CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a status outside the vocabulary', { CALLBACK_CONSENT_STATUS: 'granted (assumed)', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a status in the wrong case', { CALLBACK_CONSENT_STATUS: 'granted', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a status that is an array', { CALLBACK_CONSENT_STATUS: ['GRANTED'], CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a status that is a prototype key', { CALLBACK_CONSENT_STATUS: 'constructor', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a status an inference declared', { CALLBACK_CONSENT_STATUS: { value: 'GRANTED', source: 'AI_INFERRED' }, CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a timestamp an inference declared', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: { value: AT, source: 'AI_INFERRED' }, CALLBACK_CONSENT_SCOPE: entry.scope }, ALL3],
    ['a scope an inference declared', { CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: { value: entry.scope, source: 'AI_INFERRED' } }, ALL3],
    ['a timestamp with no status (it would read as a grant time)', { CALLBACK_CONSENT_AT: AT }, 'CALLBACK_CONSENT_AT'],
    ['a timestamp and a scope with no status', { CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_SCOPE'],
  ]) {
    const u = unit(values);
    ok('CRM-15 (write stage): ' + label + ' → nothing of the callback consent is written', u.sent === '' && u.refused === refused && u.withheld === '', JSON.stringify(u));
  }
  ok('CRM-15 (write stage): the timestamp is a confirmed-only field', CONFIRMED_ONLY_FIELDS.includes('CALLBACK_CONSENT_AT'));
  for (const [label, map, withheld, unmapped] of [
    ['the scope has no id', { CALLBACK_CONSENT_STATUS: 'cbS', CALLBACK_CONSENT_AT: 'cbA' }, 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_SCOPE'],
    ['only the scope has an id', { CALLBACK_CONSENT_SCOPE: 'cbX' }, 'CALLBACK_CONSENT_SCOPE', 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_AT'],
    ['the status has no id', { CALLBACK_CONSENT_AT: 'cbA', CALLBACK_CONSENT_SCOPE: 'cbX' }, 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_SCOPE', 'CALLBACK_CONSENT_STATUS'],
  ]) {
    const u = unit({ CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, { CY2027_CRM_FIELD_IDS: JSON.stringify(map) });
    ok('CRM-15 (write stage): under a partial id map (' + label + ') a granted consent sends nothing, and says which values were withheld',
      u.sent === '' && u.refused === '' && u.withheld === withheld && u.unmapped === unmapped, JSON.stringify(u));
  }
  ok('CRM-15 (write stage): a revocation travels without a scope, and a non-stated scope beside it is refused alone', (() => {
    const plain = unit({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: AT });
    const withBad = unit({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: 'ANY_PRODUCT' });
    const statusOnly = unit({ CALLBACK_CONSENT_STATUS: 'REVOKED' });
    return plain.sent === 'cbS=REVOKED,cbA=' + AT && plain.refused === '' &&
      withBad.sent === 'cbS=REVOKED,cbA=' + AT && withBad.refused === 'CALLBACK_CONSENT_SCOPE' &&
      statusOnly.sent === 'cbS=REVOKED' && statusOnly.refused === '';
  })());
  for (const [label, map, withheld, unmapped] of [
    ['only the timestamp has an id', { CALLBACK_CONSENT_AT: 'cbA' }, 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_STATUS'],
    ['only the status has an id', { CALLBACK_CONSENT_STATUS: 'cbS' }, 'CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT'],
  ]) {
    const u = unit({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: AT }, { CY2027_CRM_FIELD_IDS: JSON.stringify(map) });
    ok('CE-09 (write stage): under a partial id map (' + label + ') a revocation sends neither value',
      u.sent === '' && u.withheld === withheld && u.unmapped === unmapped, JSON.stringify(u));
  }
  // AUDIT 2026-10-04 (CE-09 / CRM-15) — the unit rule covered the status and the
  // instant and left the SCOPE able to leave on its own: with no status at all,
  // and beside a status that was not sent for want of an id. A lone scope on a
  // contact rewrites what an earlier grant is read as covering.
  ok('CRM-15 (write stage): a scope with no status is not written — alone it would re-scope whatever grant the contact already has', (() => {
    const alone = unit({ CALLBACK_CONSENT_SCOPE: entry.scope });
    const emptyStatus = unit({ CALLBACK_CONSENT_STATUS: '', CALLBACK_CONSENT_SCOPE: entry.scope });
    return alone.sent === '' && alone.refused === 'CALLBACK_CONSENT_SCOPE' && alone.withheld === '' && alone.unmapped === '' &&
      emptyStatus.sent === '' && emptyStatus.refused === 'CALLBACK_CONSENT_SCOPE';
  })(), JSON.stringify(unit({ CALLBACK_CONSENT_SCOPE: entry.scope })));
  for (const [label, map, sent, withheld, unmapped] of [
    ['only the scope has an id', { CALLBACK_CONSENT_SCOPE: 'cbX' }, '', 'CALLBACK_CONSENT_SCOPE', 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_AT'],
    ['the status has no id', { CALLBACK_CONSENT_AT: 'cbA', CALLBACK_CONSENT_SCOPE: 'cbX' }, '', 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_SCOPE', 'CALLBACK_CONSENT_STATUS'],
    ['the timestamp has no id', { CALLBACK_CONSENT_STATUS: 'cbS', CALLBACK_CONSENT_SCOPE: 'cbX' }, '', 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_SCOPE', 'CALLBACK_CONSENT_AT'],
    ['the scope has no id', { CALLBACK_CONSENT_STATUS: 'cbS', CALLBACK_CONSENT_AT: 'cbA' }, 'cbS=REVOKED,cbA=' + AT, '', 'CALLBACK_CONSENT_SCOPE'],
  ]) {
    const u = unit({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }, { CY2027_CRM_FIELD_IDS: JSON.stringify(map) });
    ok('CRM-15 (write stage): a revoked consent carrying its scope, under a partial id map (' + label + '), never sends the scope without its status — and a missing scope id never holds back the revocation',
      u.sent === sent && u.refused === '' && u.withheld === withheld && u.unmapped === unmapped, JSON.stringify(u));
  }
  ok('CRM-15 (write stage): a status that is not GRANTED may carry its scope when the status itself is sent', (() => {
    const u = unit({ CALLBACK_CONSENT_STATUS: 'DECLINED', CALLBACK_CONSENT_SCOPE: entry.scope });
    return u.sent === 'cbS=DECLINED,cbX=' + entry.scope && u.refused === '' && u.withheld === '' && u.unmapped === '';
  })());
  // The rule "a refused status or instant takes the rest of the unit with it" was
  // only ever exercised with GRANTED, where two other rules reach the same
  // verdict. With a status that needs neither scope nor instant it stands alone.
  for (const [label, at] of [['is not an instant', 'yesterday'], ['does not exist', '2026-02-31T00:00:00Z'], ['is in the future', '2099-01-01T00:00:00Z'], ['an inference declared', { value: AT, source: 'AI_INFERRED' }]]) {
    const u = unit({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: at });
    ok('CE-09 (write stage): a revocation whose instant ' + label + ' is not written as a bare REVOKED — the refused instant takes the status with it',
      u.sent === '' && u.refused === 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_STATUS' && u.withheld === '' && u.unmapped === '', JSON.stringify(u));
  }
  ok('CE-09 (write stage): and a status outside the vocabulary takes a valid instant with it',
    unit({ CALLBACK_CONSENT_STATUS: 'revoked', CALLBACK_CONSENT_AT: AT }).sent === '' &&
    unit({ CALLBACK_CONSENT_STATUS: 'revoked', CALLBACK_CONSENT_AT: AT }).refused === 'CALLBACK_CONSENT_AT,CALLBACK_CONSENT_STATUS');
  ok('CE-09 (write stage): the other two consent statuses take the same vocabulary',
    buildCustomFields({ RECORDING_NOTICE_STATUS: 'granted (assumed)', AI_OUTBOUND_CONSENT_STATUS: ['GRANTED'] },
      { CY2027_CRM_FIELD_IDS: '{"RECORDING_NOTICE_STATUS":"rn","AI_OUTBOUND_CONSENT_STATUS":"ao"}' }).refused.join() === 'RECORDING_NOTICE_STATUS,AI_OUTBOUND_CONSENT_STATUS' &&
    buildCustomFields({ RECORDING_NOTICE_STATUS: 'DECLINED', AI_OUTBOUND_CONSENT_STATUS: 'NOT_ASKED' },
      { CY2027_CRM_FIELD_IDS: '{"RECORDING_NOTICE_STATUS":"rn","AI_OUTBOUND_CONSENT_STATUS":"ao"}' }).fields.map((f) => f.value).join() === 'DECLINED,NOT_ASKED');
  ok('CRM-15 (write stage): a field outside the unit is untouched by a broken unit', (() => {
    const r = buildCustomFields({ SOA_STATE: 'NY', CALLBACK_CONSENT_STATUS: 'GRANTED' }, { CY2027_CRM_FIELD_IDS: '{"SOA_STATE":"s1","CALLBACK_CONSENT_STATUS":"cbS"}' });
    return r.fields.map((f) => f.id + '=' + f.value).join() === 's1=NY' && r.refused.join() === 'CALLBACK_CONSENT_STATUS';
  })());
  // Each slot of consentsToFields() takes its own consent type (§6 cross-inference).
  const soaGranted = createConsent({ type: 'SCOPE_OF_APPOINTMENT', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'WEB', scriptVersion: 'v1', scope: entry.scope, at: AT });
  const recGranted = createConsent({ type: 'RECORDING_NOTICE', status: CONSENT_STATUS.GRANTED, language: 'en', channel: 'VOICE', scriptVersion: 'v1', scope: 'recording', at: AT });
  throws('CE-09: a granted SCOPE_OF_APPOINTMENT object is not a callback consent, whatever slot it is put in',
    () => consentsToFields({ callbackConsent: soaGranted }), /callbackConsent must be a CALLBACK_CONTACT_PERMISSION/);
  throws('CE-09: nor is a recording notice', () => consentsToFields({ callbackConsent: recGranted }), /callbackConsent must be a CALLBACK_CONTACT_PERMISSION/);
  throws('CE-09: an object with no type is not a callback consent',
    () => consentsToFields({ callbackConsent: { status: 'GRANTED', at: AT, scope: entry.scope } }), /callbackConsent must be a CALLBACK_CONTACT_PERMISSION/);
  throws('CE-09: a callback consent is not AI-outbound consent', () => consentsToFields({ aiOutboundConsent: good.consent }), /aiOutboundConsent must be a AI_OUTBOUND_VOICE_CONSENT/);
  throws('CE-09: nor a recording notice', () => consentsToFields({ recordingNotice: good.consent }), /recordingNotice must be a RECORDING_NOTICE/);
  ok('CE-09: each object in its own slot is still flattened',
    JSON.stringify(consentsToFields({ recordingNotice: recGranted, callbackConsent: good.consent })) ===
    JSON.stringify({ RECORDING_NOTICE_STATUS: 'GRANTED', CALLBACK_CONSENT_STATUS: 'GRANTED', CALLBACK_CONSENT_AT: AT, CALLBACK_CONSENT_SCOPE: entry.scope }));
  ok('CE-09: a revoked callback consent maps to REVOKED, its revocation instant and the scope that was revoked', (() => {
    const u = unit(consentsToFields({ callbackConsent: revokeConsent(good.consent, { at: '2026-10-03T09:00:00.000Z', via: 'WEB_CHAT' }) }));
    return u.sent === 'cbS=REVOKED,cbA=2026-10-03T09:00:00.000Z,cbX=' + entry.scope && u.refused === '';
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
  // ("consent.js brings no Node API into the shared barrel" is asserted in 25e-5
  //  below, over the whole import graph: the regex that stood here matched only
  //  `from 'node:…'` and let `from 'crypto'`, import('…') and `import '…'` pass.)
  ok('CE-09: the record cannot be edited between being built and being written', (() => {
    const r = recordWebCallbackConsent(goodIn, IDS);
    try { r.fields[2].value = 'ANY_PRODUCT'; } catch { /* frozen */ }
    try { r.fields.push({ id: 'x', key: 'contact.x', value: 'y' }); } catch { /* frozen */ }
    try { r.receiptBit = 'scope=ANY_PRODUCT'; } catch { /* frozen */ }
    return Object.isFrozen(r) && Object.isFrozen(r.fields) && r.fields.every(Object.isFrozen) && r.fields.length === 3 &&
      byId(r, 'cbX') === entry.scope && r.receiptBit === 'scope=' + entry.scope;
  })());

  // The claims go in AS RECEIVED (red team 2026-10-04): the handler used to strip
  // them first, so these rules never saw live input. Function level here, handler
  // level in 25f.
  ok('CE-09: a receipt hash that is present and is not the digest is a mismatch — whatever its type',
    [12345, false, 0, true, ['x'], { a: 1 }, 'ZZZZ-NOT-HEX', 'GHIJKLMNOP', sha(SHOWN.en).toUpperCase(), ' ' + sha(SHOWN.en), 'xx' + sha(SHOWN.en) + '!!']
      .every((h) => recordWebCallbackConsent({ ...goodIn, receiptHash: h }, IDS).reason === 'CONSENT_RECEIPT_HASH_MISMATCH'));
  ok('CE-09: a version label is matched as received — padding, a stray character or a look-alike is another label',
    [' 2026-06-01\n', '2026/-06-01', '20 26-06-01', '2026-06-01\u0000', '<b>2026-06-01</b>', '２０２６-06-01', SHOWN.version + ' ']
      .every((v) => recordWebCallbackConsent({ ...goodIn, disclaimerVersion: v }, IDS).reason === 'CONSENT_TEXT_VERSION_UNKNOWN') &&
    [20260601, ['2026-06-01'], { v: 1 }, true]
      .every((v) => recordWebCallbackConsent({ ...goodIn, disclaimerVersion: v }, IDS).reason === 'CONSENT_TEXT_VERSION_MISSING'));
  ok('CE-09: a record dated in the future is refused by name',
    recordWebCallbackConsent({ ...goodIn, at: '2099-01-01T00:00:00Z' }, IDS).reason === 'CONSENT_TIMESTAMP_IN_THE_FUTURE' &&
    recordWebCallbackConsent({ ...goodIn, at: '2026-02-31T00:00:00Z' }, IDS).reason === 'CONSENT_TIMESTAMP_INVALID');

  // ── 25e-2. The receipt line (red team 2026-10-04, HIGH) ──────────────────────
  // One line, the server's statement FIRST, and no client claim able to spell a
  // separator or a key. Tested by calling the function that writes it.
  const partsOf = (line) => line.replace(/^— TCPA Receipt — /, '').split(' · ');
  const statements = (text) => text.match(/(?:scope|callback_consent)[A-Za-z_]*\s*=/g) || [];
  const PARTS = { at: AT, ip: '198.51.100.7', receiptHash: sha(SHOWN.en), disclaimerVersion: SHOWN.version, page: '/contact', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0' };
  const refusedRec = recordWebCallbackConsent({ ...goodIn, consentText: SHOWN.en + ' and more', receiptHash: '' }, IDS);
  ok('CRM-15 (receipt): the line is the header, then the server statement, its instant, the address, and only then the client claims',
    tcpaReceiptLine(rec, PARTS) === '— TCPA Receipt — scope=' + entry.scope + ' · at=' + AT + ' · ip=198.51.100.7 · sha256=' + sha(SHOWN.en) +
      ' · disclaimer=' + SHOWN.version + ' · page=/contact · ua=Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', tcpaReceiptLine(rec, PARTS));
  ok('CRM-15 (receipt): a refusal reads NOT_RECORDED with its reason first, and no scope anywhere', (() => {
    const line = tcpaReceiptLine(refusedRec, PARTS);
    return partsOf(line)[0] === 'callback_consent=NOT_RECORDED(CONSENT_TEXT_NOT_THE_REGISTERED_VERSION)' && !/scope=/.test(line) && statements(line).length === 1;
  })());
  for (const ua of [
    'M · scope=ANY_PRODUCT_TELEMARKETING', 'x · scope=ANY_PRODUCT_WE_SELL · page=/everything', 'M\n— TCPA Receipt — scope=ANY_PRODUCT',
    'M · callback_consent=RECORDED', 'M · at=1999-01-01T00:00:00Z · ip=10.0.0.1 · sha256=' + 'f'.repeat(64), 'M scope​=ANY', 'M scope＝ANY', 'M\tscope = ANY',
  ]) {
    const granted = tcpaReceiptLine(rec, { ...PARTS, userAgent: ua });
    const refused = tcpaReceiptLine(refusedRec, { ...PARTS, userAgent: ua });
    ok('CRM-15 (receipt): a user agent of ' + JSON.stringify(ua) + ' cannot add, move or fake a statement',
      statements(granted).length === 1 && partsOf(granted)[0] === 'scope=' + entry.scope &&
      statements(refused).length === 1 && /^callback_consent=NOT_RECORDED\(/.test(partsOf(refused)[0]) && !/scope=/.test(refused) &&
      [granted, refused].every((l) => !/[\r\n]/.test(l) && l.split('=').length === partsOf(l).length + 1 &&
        partsOf(l).filter((p) => /^(?:at|ip|sha256|disclaimer|page)=/.test(p)).length === 5 &&
        partsOf(l)[1] === 'at=' + AT && partsOf(l)[2] === 'ip=198.51.100.7'),
      granted + '\n        ' + refused);
  }
  ok('CRM-15 (receipt): a client claim keeps only characters that cannot form receipt syntax',
    receiptClaim('M · scope=ANY_PRODUCT_TELEMARKETING') === 'M scope ANY_PRODUCT_TELEMARKETING' &&
    receiptClaim('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101, like+this-one:1', 100) === 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101, like+this-one:1' &&
    receiptClaim('a=b·c—d\ne f<g>"h"') === 'a b c d e f g h' &&
    receiptClaim('x'.repeat(200)).length === 60 && receiptClaim('x'.repeat(200), 10).length === 10 && receiptClaim('abc', -1) === 'abc' &&
    [undefined, null, 7, ['M'], { toString() { return 'M'; } }].every((v) => receiptClaim(v) === '') &&
    !/[^A-Za-z0-9 ./;:(),_+-]/.test(receiptClaim(String.fromCharCode(...Array.from({ length: 0x250 }, (_, i) => i)), 480)));
  ok('CRM-15 (receipt): a client claim that is not exactly well-formed is not printed — never repaired', (() => {
    const line = tcpaReceiptLine(rec, { at: AT, ip: 'not an ip', receiptHash: sha(SHOWN.en).toUpperCase(), disclaimerVersion: ' 2026-06-01\n', page: 'contact · scope=X', userAgent: 7 });
    const short = tcpaReceiptLine(rec, { ...PARTS, receiptHash: 'abc', disclaimerVersion: 'v 1', page: '/a?b=1' });
    return line === '— TCPA Receipt — scope=' + entry.scope + ' · at=' + AT + ' · ip=unavailable' &&
      short === '— TCPA Receipt — scope=' + entry.scope + ' · at=' + AT + ' · ip=198.51.100.7 · ua=' + PARTS.userAgent;
  })());
  ok('CRM-15 (receipt): a recorded consent prints ITS instant, whatever the caller passes; a refusal prints the server instant given', (() => {
    const other = '2026-10-01T00:00:00.000Z';
    return partsOf(tcpaReceiptLine(rec, { ...PARTS, at: other }))[1] === 'at=' + AT &&
      partsOf(tcpaReceiptLine(refusedRec, { ...PARTS, at: other }))[1] === 'at=' + other &&
      partsOf(tcpaReceiptLine(refusedRec, { ...PARTS, at: 'at=1 · scope=X' }))[1] === 'at=unavailable';
  })());
  ok('CRM-15 (receipt): only a record this module built is believed — a look-alike object, a copy or nothing reads NOT_RECORDED', (() => {
    const FAILED = 'callback_consent=NOT_RECORDED(CALLBACK_CONSENT_BUILD_FAILED)';
    return [{ receiptBit: 'scope=ANY_PRODUCT', consent: { at: AT, scope: 'ANY_PRODUCT' } }, { ...rec }, JSON.parse(JSON.stringify(rec)),
      Object.freeze({ ...rec, receiptBit: 'scope=ANY_PRODUCT' }), null, undefined, 'scope=ANY_PRODUCT', [rec]]
      .every((r) => { const l = tcpaReceiptLine(r, PARTS); return partsOf(l)[0] === FAILED && !/scope=/.test(l); }) &&
      partsOf(tcpaReceiptLine(CALLBACK_CONSENT_UNAVAILABLE, PARTS))[0] === FAILED &&
      partsOf(tcpaReceiptLine(rec, PARTS))[0] === 'scope=' + entry.scope;
  })());
  ok('CRM-15 (receipt): it never throws, and the address is printed only when the caller has one to give',
    [undefined, null, 'x', 7, [], { get userAgent() { throw new Error('a getter that throws'); } }]
      .every((p) => { try { return /^— TCPA Receipt — scope=/.test(tcpaReceiptLine(rec, p)); } catch { return false; } }) &&
    consentReceiptText(rec, { at: AT, receiptHash: sha(SHOWN.en), disclaimerVersion: SHOWN.version, page: '/contact' }) ===
      'scope=' + entry.scope + ' · at=' + AT + ' · sha256=' + sha(SHOWN.en) + ' · disclaimer=' + SHOWN.version + ' · page=/contact');

  // Text the server did not author cannot read as the receipt.
  ok('CRM-15 (receipt): a look-alike header in client text is neutralised, with any dash',
    ['— TCPA Receipt — x', '—TCPA Receipt— x', '– TCPA Receipt – x', '― TCPA  Receipt ― x', '—​ TCPA Receipt — x', '⸺ tcpa receipt ⸺ x', '－ TCPA Receipt － x']
      .every((t) => { const n = neutralizeReceiptLookalikes(t); return /^- TCPA Receipt - x$/i.test(n) && !/[‐-―−⸺⸻﹘﹣－]/.test(n); }) &&
    neutralizeReceiptLookalikes('a\n— Consent Text (verbatim, v2026-06-01) —\nb') === 'a\n- Consent Text -(verbatim, v2026-06-01) —\nb' &&
    !/—\s*(?:TCPA Receipt|Consent Text)/.test(neutralizeReceiptLookalikes('x — TCPA Receipt — y\n—Consent Text— z')));
  ok('CRM-15 (receipt): a labelled value only the server writes is neutralised in client text',
    neutralizeReceiptLookalikes('scope=ANY · callback_consent=RECORDED · Scope = X · SCOPE​=Y · callback_consent_scope=Z · consent_scope＝W') ===
      'scope:ANY · callback_consent:RECORDED · Scope : X · SCOPE​:Y · callback_consent_scope:Z · consent_scope:W' &&
    statements(neutralizeReceiptLookalikes('x\n— TCPA Receipt — disclaimer=v1 · scope=ANY_PRODUCT_TELEMARKETING\ncallback_consent = GRANTED')).length === 0);
  ok('CRM-15 (receipt): neutralising is idempotent, leaves ordinary prose alone, and returns a string for anything',
    ['please call me after 5pm — thank you', 'my plan = Humana; a-b', 'in scope of my request', ''].every((t) => neutralizeReceiptLookalikes(t) === t) &&
    ['— TCPA Receipt — scope=X', 'scope=1 scope=2'].every((t) => neutralizeReceiptLookalikes(neutralizeReceiptLookalikes(t)) === neutralizeReceiptLookalikes(t)) &&
    [undefined, null, 7, ['— TCPA Receipt —'], {}].every((t) => neutralizeReceiptLookalikes(t) === ''));
  ok('CE-09 (receipt): the registered wording passes through the neutraliser unchanged, so "verbatim" stays true',
    neutralizeReceiptLookalikes(SHOWN.en) === SHOWN.en && neutralizeReceiptLookalikes(SHOWN.es) === SHOWN.es);
  // AUDIT 2026-10-04 (CE-09 / CRM-15) — the dashes, the invisible characters and
  // the equals signs were short LISTS: a left-to-right mark (which shows nothing)
  // after the dash, inside the word or before the '=' went through untouched,
  // and 8,000 dashes cost half a second. They are classes now, and each class is
  // walked here in full instead of sampled.
  {
    const everyChar = (re) => {
      const out = [];
      for (let cp = 0; cp <= 0xFFFF; cp++) {
        if (cp >= 0xD800 && cp <= 0xDFFF) continue;
        const ch = String.fromCharCode(cp);
        if (re.test(ch)) out.push(ch);
      }
      return out;
    };
    const hex = (list) => list.map((c) => 'U+' + c.charCodeAt(0).toString(16).toUpperCase()).join();
    const dashes = everyChar(/\p{Pd}/u).filter((d) => d !== '-').concat(['−', '─', '━']);
    const formats = everyChar(/\p{Cf}/u).concat(['\u{E0001}', '\u{E0020}', '\u{1D173}']);   // and three beyond the BMP
    const HEADER = '— TCPA Receipt — ';
    const notADash = dashes.filter((d) => neutralizeReceiptLookalikes(d + ' TCPA Receipt ' + d + ' x') !== '- TCPA Receipt - x' ||
      neutralizeReceiptLookalikes('a\n' + d + d + 'Consent Text' + d + ' x') !== 'a\n- Consent Text - x');
    ok('CRM-15 (receipt): EVERY dash Unicode defines is a header dash — bar the ASCII hyphen, which is what a neutralised header is written with',
      dashes.length >= 20 && ['—', '–', '֊', '⸺', '〜', '－', '−', '─'].every((d) => dashes.includes(d)) && notADash.length === 0 &&
      neutralizeReceiptLookalikes('- TCPA Receipt - x') === '- TCPA Receipt - x' && neutralizeReceiptLookalikes('-— TCPA Receipt — x') === '-- TCPA Receipt - x',
      'dashes=' + dashes.length + ' not neutralised: ' + hex(notADash));
    const notAGap = formats.filter((c) => {
      const h = neutralizeReceiptLookalikes('—' + c + ' T' + c + 'CPA' + c + ' Rec' + c + 'eipt' + c + '— x');
      const l = neutralizeReceiptLookalikes('sc' + c + 'ope' + c + '=X call' + c + 'back_consent ' + c + '= Y');
      return h !== '- TCPA Receipt - x' || l.includes('=') || l.split(':').length !== 3;
    });
    ok('CRM-15 (receipt): EVERY format character (zero-width, bidi mark, soft hyphen…) is a gap — after the dash, between and INSIDE the words, before the equals sign',
      formats.length >= 30 && ['​', '‍', '‎', '‮', '­', '⁠', '﻿', '؜'].every((c) => formats.includes(c)) && notAGap.length === 0,
      'formats=' + formats.length + ' not treated as a gap: ' + hex(notAGap));
    ok('CRM-15 (receipt): the compatibility and look-alike equals signs are equals signs',
      ['=', '＝', '﹦', '⁼', '₌', '꞊', '═', '≡'].every((e) => neutralizeReceiptLookalikes('scope' + e + 'ANY callback_consent ' + e + ' X') === 'scope:ANY callback_consent : X'));
    // The exact promise, for ANY text: afterwards no line starts with the
    // server's header, neither server label occurs, and a second pass changes nothing.
    ok('CRM-15 (receipt): for any text — 4,000 generated here — no line starts with the server header afterwards and neither server label occurs', (() => {
      const atoms = [HEADER, '— TCPA Receipt —', 'TCPA Receipt', 'Consent Text', '—', '–', '-', '─', '‎', '​', '­', ' ', '\n', '\t',
        'scope', 'SCOPE', 'callback_consent', '_', '=', '＝', '⁼', ':', ' · ', 'x', 'TC', 'PA', 'Rec', 'eipt', 'sc', 'ope'];
      let seed = 20261004;
      const next = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; };
      for (let i = 0; i < 4000; i++) {
        let t = '';
        for (let k = 1 + (next() % 14); k > 0; k--) t += atoms[next() % atoms.length];
        const n = neutralizeReceiptLookalikes(t);
        if (n.split('\n').some((l) => l.startsWith(HEADER)) || /(?:scope|callback_consent)[A-Za-z_]*\s*=/i.test(n) || neutralizeReceiptLookalikes(n) !== n) return false;
      }
      return true;
    })());
    ok('CRM-15 (receipt): a long hostile text is neutralised in linear time — a run of dashes used to be scanned from each of its dashes', (() => {
      const t0 = process.hrtime.bigint();
      for (const t of ['—'.repeat(30000), '—' + '​'.repeat(30000), 'scope'.repeat(1600), 's' + '​'.repeat(30000), 'scope' + ' '.repeat(30000) + 'x', ('— TCPA ' + 'scope ').repeat(2000)]) {
        neutralizeReceiptLookalikes(t);
      }
      return Number(process.hrtime.bigint() - t0) / 1e6 < 1500;
    })());
  }

  // ── 25e-3. One retry policy for a refused CRM write ──────────────────────────
  ok('CE-09 (retry policy): a transient failure is never a reason to drop a field',
    [429, 500, 502, 503, 504, 599].every((s) => crmRefusalStep(s, 3) === 'TRANSIENT' && crmRefusalStep(s, 0) === 'TRANSIENT'));
  ok('CE-09 (retry policy): a dead token is not retried in any shape', crmRefusalStep(401, 3) === 'AUTH' && crmRefusalStep(401, 0) === 'AUTH');
  ok('CE-09 (retry policy): any other refusal with the entries attached is retried once without them — not only 400/422',
    [400, 403, 404, 409, 410, 413, 422, 499].every((s) => crmRefusalStep(s, 3) === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(s, 1) === 'RETRY_WITHOUT_FIELDS'));
  ok('CE-09 (retry policy): with nothing attached there is nothing to drop',
    [400, 403, 404, 409, 422].every((s) => [0, -1, undefined, null, '3', NaN, 1.5].every((n) => crmRefusalStep(s, n) === 'REFUSED')));
  ok('CE-09 (retry policy): an accepted write is not a refusal, and anything that is not an HTTP status is not retried',
    [200, 201, 204].every((s) => crmRefusalStep(s, 3) === 'ACCEPTED') &&
    [0, 100, 301, 399, 600, -1, NaN, '422', null, undefined, 422.5].every((s) => crmRefusalStep(s, 3) === 'REFUSED'));
  // AUDIT 2026-10-04 (CRM-25, red team) — the body, when the caller has it.
  const DUP = 'This location does not allow duplicated contacts.';
  ok('CRM-25 (retry policy): a 400 whose body is the CRM\'s duplicate-CONTACT wording is DUPLICATE_CONTACT, not a retry — whatever is attached, in any casing, inside JSON or bare',
    crmRefusalStep(400, 3, DUP) === 'DUPLICATE_CONTACT' && crmRefusalStep(400, 1, '{"message":"' + DUP + '","statusCode":400}') === 'DUPLICATE_CONTACT' &&
    crmRefusalStep(400, 0, DUP) === 'DUPLICATE_CONTACT' && crmRefusalStep(400, 2, 'Duplicate contact') === 'DUPLICATE_CONTACT' && crmRefusalStep(400, 2, 'DUPLICATED CONTACTS found') === 'DUPLICATE_CONTACT');
  ok('CRM-25 (retry policy): the wordings the earlier red team found losing leads still retry — "duplicate" alone is not a duplicate contact',
    crmRefusalStep(400, 3, 'duplicate custom field id') === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(400, 3, 'duplicated id') === 'RETRY_WITHOUT_FIELDS' &&
    crmRefusalStep(400, 3, 'duplicate') === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(422, 3, 'duplicate custom field id') === 'RETRY_WITHOUT_FIELDS');
  ok('CRM-25 (retry policy): only a 400 is a duplicate contact (the dedupe branch recognises no other status); no body, an empty body or a body that is not text changes nothing',
    crmRefusalStep(422, 3, DUP) === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(409, 3, DUP) === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(400, 3) === 'RETRY_WITHOUT_FIELDS' &&
    crmRefusalStep(400, 3, '') === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(400, 3, { message: DUP }) === 'RETRY_WITHOUT_FIELDS' && crmRefusalStep(400, 3, [DUP]) === 'RETRY_WITHOUT_FIELDS' &&
    crmRefusalStep(400, 0, '') === 'REFUSED' && crmRefusalStep(500, 3, DUP) === 'TRANSIENT' && crmRefusalStep(401, 3, DUP) === 'AUTH' && crmRefusalStep(201, 3, DUP) === 'ACCEPTED');

  // ── 25e-4. The revocation, as a record ───────────────────────────────────────
  const fieldsOf = (r) => r.fields.map((f) => f.id + '=' + f.value).join();
  const STATUS_ONLY_IDS = { CY2027_CRM_FIELD_IDS: '{"CALLBACK_CONSENT_STATUS":"cbS"}' };
  const contactWith = (...customFields) => ({ id: 'C1', customFields });
  ok('CE-09 (revocation): a contact that reads anything but REVOKED gets REVOKED and this instant', (() => {
    const r = recordCallbackRevocation({ at: REVOKED_AT, state: 'NOT_REVOKED' }, IDS);
    return r.mode === 'REVOKED_WITH_INSTANT' && fieldsOf(r) === 'cbS=REVOKED,cbA=' + REVOKED_AT && r.at === REVOKED_AT &&
      r.withheld.length === 0 && r.unmapped.length === 0 && r.warnings.length === 0 &&
      r.fields.every((f) => /^contact\.callback_consent_(status|at)$/.test(f.key));
  })());
  ok('CE-09 (revocation): a contact that already reads REVOKED is not rewritten — the instant of the earlier revocation stands', (() => {
    const r = recordCallbackRevocation({ at: REVOKED_AT, state: 'REVOKED' }, IDS);
    return r.mode === 'ALREADY_REVOKED' && r.fields.length === 0 && r.warnings.length === 0;
  })());
  for (const state of [undefined, null, 'UNKNOWN', 'revoked', 'GRANTED', ['NOT_REVOKED'], { toString() { return 'NOT_REVOKED'; } }, true]) {
    const r = recordCallbackRevocation({ at: REVOKED_AT, state }, IDS);
    ok('CE-09 (revocation): a state that was not positively read (' + (typeof state === 'string' ? JSON.stringify(state) : Object.prototype.toString.call(state)) +
      ') writes REVOKED and leaves the instant alone',
      r.mode === 'REVOKED_STATUS_ONLY' && fieldsOf(r) === 'cbS=REVOKED' && r.withheld.join() === 'CALLBACK_CONSENT_AT' &&
      r.warnings.length === 1 && /could not be read/.test(r.warnings[0]), JSON.stringify(r));
  }
  for (const [label, map, withheld, unmapped] of [
    ['only the timestamp has an id', { CALLBACK_CONSENT_AT: 'cbA' }, 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_STATUS'],
    ['the status id is missing beside two others', { CALLBACK_CONSENT_AT: 'cbA', CALLBACK_CONSENT_SCOPE: 'cbX' }, 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_STATUS'],
    ['only the status has an id', { CALLBACK_CONSENT_STATUS: 'cbS' }, 'CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT'],
    ['the status key is misspelled', { callback_consent_status: 'cbS', CALLBACK_CONSENT_AT: 'cbA' }, 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_STATUS'],
    ['no id at all', {}, '', 'CALLBACK_CONSENT_STATUS,CALLBACK_CONSENT_AT'],
  ]) {
    for (const state of ['NOT_REVOKED', 'REVOKED', 'UNKNOWN']) {
      const r = recordCallbackRevocation({ at: REVOKED_AT, state }, { CY2027_CRM_FIELD_IDS: JSON.stringify(map) });
      ok('CE-09 (revocation): without BOTH ids nothing is written (' + label + ', contact ' + state + '), and the gap is named',
        r.mode === 'NO_FIELD_IDS' && r.fields.length === 0 && r.withheld.join() === withheld && r.unmapped.join() === unmapped &&
        r.warnings.length === (withheld ? 2 : 1) && /could not be written/.test(r.warnings[0]) &&
        (!withheld || r.warnings[1].includes(withheld + ' not written either')), JSON.stringify(r));
    }
  }
  ok('CE-09 (revocation): the record is frozen, carries no scope, and nothing the caller passes becomes a field', (() => {
    const r = recordCallbackRevocation({ at: REVOKED_AT, state: 'NOT_REVOKED', scope: 'ANY_PRODUCT', CALLBACK_CONSENT_SCOPE: 'X', CALLBACK_CONSENT_STATUS: 'GRANTED', fields: [{ id: 'x' }] }, IDS);
    try { r.fields.push({ id: 'x' }); } catch { /* frozen */ }
    try { r.fields[0].value = 'GRANTED'; } catch { /* frozen */ }
    return Object.isFrozen(r) && Object.isFrozen(r.fields) && r.fields.every(Object.isFrozen) && fieldsOf(r) === 'cbS=REVOKED,cbA=' + REVOKED_AT &&
      !/scope|GRANTED|ANY_PRODUCT/i.test(JSON.stringify(r));
  })());
  ok('CE-09 (revocation): no usable instant, no field — and it never throws',
    [undefined, null, 'x', 7, [], {}, { at: '' }, { at: 'yesterday' }, { at: '2026-02-31T00:00:00Z' }, { at: '2099-01-01T00:00:00Z' }, { at: 1759482000000 },
      { get at() { throw new Error('a getter that throws'); } }]
      .every((i) => { try { const r = recordCallbackRevocation(i, IDS); return r === CALLBACK_REVOCATION_UNAVAILABLE; } catch { return false; } }) &&
    recordCallbackRevocation({ at: REVOKED_AT, state: 'NOT_REVOKED' }, null) === CALLBACK_REVOCATION_UNAVAILABLE &&
    CALLBACK_REVOCATION_UNAVAILABLE.mode === 'NOT_BUILT' && CALLBACK_REVOCATION_UNAVAILABLE.fields.length === 0 && Object.isFrozen(CALLBACK_REVOCATION_UNAVAILABLE));
  ok('CE-09 (revocation): the modes and states are closed vocabularies',
    Object.isFrozen(CALLBACK_REVOCATION_MODE) && Object.isFrozen(CALLBACK_CONSENT_STATE) &&
    Object.keys(CALLBACK_REVOCATION_MODE).join() === 'REVOKED_WITH_INSTANT,REVOKED_STATUS_ONLY,ALREADY_REVOKED,NO_FIELD_IDS,NOT_BUILT' &&
    Object.keys(CALLBACK_CONSENT_STATE).join() === 'REVOKED,NOT_REVOKED,UNKNOWN');

  // What the contact says today, read by the configured id.
  ok('CE-09 (revocation): the state is REVOKED only when the status field is listed once and reads exactly REVOKED',
    callbackConsentStateOf(contactWith({ id: 'cbS', value: 'REVOKED' }, { id: 'cbA', value: REVOKED_AT }), IDS) === 'REVOKED' &&
    callbackConsentStateOf(contactWith({ id: 'cbS', field_value: 'REVOKED' }), IDS) === 'REVOKED' &&
    callbackConsentStateOf(contactWith({ id: 'cbS', fieldValue: 'REVOKED' }), IDS) === 'REVOKED');
  ok('CE-09 (revocation): the state is NOT_REVOKED when custom fields are listed and the status is another value, or not among them',
    ['GRANTED', 'DECLINED', 'revoked', 'REVOKED ', ''].every((v) => callbackConsentStateOf(contactWith({ id: 'cbS', value: v }), IDS) === 'NOT_REVOKED') &&
    callbackConsentStateOf(contactWith({ id: 'someOtherField', value: 'REVOKED' }), IDS) === 'NOT_REVOKED');
  ok('CE-09 (revocation): everything else is UNKNOWN — nothing is inferred from silence',
    [undefined, null, 'x', 7, [], {}, { customFields: null }, { customFields: 'REVOKED' }, { customFields: {} },
      contactWith(),                                                                    // an EMPTY list: indistinguishable from a payload that carries none
      contactWith({ id: 'cbS', value: 'REVOKED' }, { id: 'cbS', value: 'GRANTED' }),      // listed twice
      contactWith({ id: 'cbS', value: ['REVOKED'] }), contactWith({ id: 'cbS', value: null }), contactWith({ id: 'cbS' }),
      contactWith({ id: 'cbS', value: { toString() { return 'REVOKED'; } } }),
      { get customFields() { throw new Error('a getter that throws'); } },
    ].every((c) => callbackConsentStateOf(c, IDS) === 'UNKNOWN') &&
    // with no status id configured, no payload can be read
    callbackConsentStateOf(contactWith({ id: 'cbS', value: 'REVOKED' }), {}) === 'UNKNOWN' &&
    callbackConsentStateOf(contactWith({ id: 'cbS', value: 'REVOKED' }), { CY2027_CRM_FIELD_IDS: '{"CALLBACK_CONSENT_AT":"cbA"}' }) === 'UNKNOWN' &&
    callbackConsentStateOf(contactWith({ id: 'cbS', value: 'REVOKED' }), null) === 'UNKNOWN' &&
    callbackConsentStateOf(contactWith({ id: 'cbS', value: 'REVOKED' }), STATUS_ONLY_IDS) === 'REVOKED');

  // The note never claims more than was applied.
  const NOT_REV = recordCallbackRevocation({ at: REVOKED_AT, state: 'NOT_REVOKED' }, IDS);
  const UNK = recordCallbackRevocation({ at: REVOKED_AT, state: 'UNKNOWN' }, IDS);
  ok('CE-09 (revocation note): written means written, with the instant',
    callbackRevocationNoteLine(NOT_REV, 'WRITTEN') === 'Callback consent fields in the CRM: CALLBACK_CONSENT_STATUS=REVOKED and CALLBACK_CONSENT_AT=' + REVOKED_AT + ' written.');
  ok('CE-09 (revocation note): a status-only write says the instant was left alone, and why',
    /^Callback consent fields in the CRM: CALLBACK_CONSENT_STATUS=REVOKED written\. CALLBACK_CONSENT_AT was left as it was/.test(callbackRevocationNoteLine(UNK, 'WRITTEN')));
  ok('CE-09 (revocation note): fields the CRM refused, or an update that failed, are NOT written — and the note says so',
    [NOT_REV, UNK].every((r) => /NOT written — the CRM refused the update with them attached/.test(callbackRevocationNoteLine(r, 'DROPPED')) &&
      ['UPDATE_FAILED', 'NOTHING_TO_WRITE', undefined, null, 'written', 7].every((o) => /NOT written — the CRM did not accept the update/.test(callbackRevocationNoteLine(r, o)))));
  ok('CE-09 (revocation note): an already-revoked contact, missing ids and a failed build each have their own sentence — whatever outcome is claimed',
    ['WRITTEN', 'DROPPED', 'UPDATE_FAILED', undefined].every((o) =>
      /unchanged — the contact already read CALLBACK_CONSENT_STATUS=REVOKED/.test(callbackRevocationNoteLine(recordCallbackRevocation({ at: REVOKED_AT, state: 'REVOKED' }, IDS), o)) &&
      /NOT written — CALLBACK_CONSENT_STATUS and CALLBACK_CONSENT_AT do not both have a GoHighLevel field id/.test(callbackRevocationNoteLine(recordCallbackRevocation({ at: REVOKED_AT, state: 'NOT_REVOKED' }, {}), o)) &&
      [CALLBACK_REVOCATION_UNAVAILABLE, null, undefined, 'x', {}, { mode: 'toString', fields: [1] }, { mode: 'REVOKED_WITH_INSTANT', fields: [] }]
        .every((r) => /NOT written — the values could not be built/.test(callbackRevocationNoteLine(r, o)))));
  ok('CE-09 (revocation note): every sentence is one line and never says GRANTED',
    [[NOT_REV, 'WRITTEN'], [UNK, 'WRITTEN'], [NOT_REV, 'DROPPED'], [NOT_REV, 'UPDATE_FAILED'], [null, 'WRITTEN']]
      .every(([r, o]) => { const l = callbackRevocationNoteLine(r, o); return !/[\r\n]/.test(l) && !/GRANTED/.test(l) && l.startsWith('Callback consent fields in the CRM: '); }));

  // ── 25e-5. consent.js stays importable by the client (red team 2026-10-04) ──
  // The old scan matched only `from 'node:…'`, so `from 'crypto'`, a dynamic
  // import and a side-effect import all passed. The rule is an ALLOW-LIST over
  // every module the shared barrel reaches: each import is relative, literal,
  // stays inside api/_lib/cy2027/, and is not one of the server-only modules.
  {
    const importSpecifiers = (source) => {
      const code = strip(String(source));
      const found = [];
      for (const m of code.matchAll(/\b(?:import|export)\b[^;'"`()]*?\bfrom\s*(['"`])([^'"`]*)\1/g)) found.push(m[2]);
      for (const m of code.matchAll(/\bimport\s*(['"`])([^'"`]*)\1/g)) found.push(m[2]);
      for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*(?:(['"`])([^'"`]*)\1\s*\)|([^)]*)\))/g)) found.push(m[1] ? m[2] : '<not a literal: ' + String(m[3]).trim() + '>');
      return found;
    };
    ok('CE-09: the import scanner sees every way a module can be pulled in',
      JSON.stringify(importSpecifiers("import { a } from './a.js';\nimport b from \"node:fs\";\nimport * as c from 'crypto';\nimport 'node:path';\n" +
        "export * from './d.js';\nexport { e } from '../e.js';\nconst f = await import('node:os');\nconst g = () => import(`./g.js`);\n" +
        "const h = require('fs');\nconst i = import(name);\n// import x from 'in-a-comment';\n/* import('also-a-comment') */\n")) ===
      JSON.stringify(['./a.js', 'node:fs', 'crypto', './d.js', '../e.js', 'node:path', 'node:os', './g.js', 'fs', '<not a literal: name>']));
    const LIB = fileURLToPath(new URL('../api/_lib/cy2027/', import.meta.url));
    const SERVER_ONLY = ['crm-fields.js', 'callback-consent.js', 'evidence.js', 'evidence-store.js', 'secure-link.js', 'otp.js', 'out-of-band-verification.js'];
    const offences = (entryFile, readSource = (f) => readFileSync(pathJoin(LIB, f), 'utf8')) => {
      const seen = new Set();
      const bad = [];
      const visit = (file) => {
        if (seen.has(file)) return;
        seen.add(file);
        for (const spec of importSpecifiers(readSource(file))) {
          if (!/^\.\/[\w.-]+\.js$/.test(spec)) { bad.push(file + ' imports ' + spec); continue; }
          const target = spec.slice(2);
          if (SERVER_ONLY.includes(target)) { bad.push(file + ' imports the server-only ' + target); continue; }
          visit(target);
        }
      };
      visit(entryFile);
      return { bad, seen: [...seen] };
    };
    const graph = offences('index.js');
    ok('CE-09: nothing the shared barrel reaches imports a Node API, a package, a file outside the layer or a server-only module',
      graph.bad.length === 0 && graph.seen.includes('consent.js') && graph.seen.length >= 9, graph.bad.join(' | '));
    ok('CE-09: the record function is server-only', !('recordWebCallbackConsent' in barrelModule) && !('tcpaReceiptLine' in barrelModule) &&
      !('recordCallbackRevocation' in barrelModule) && 'webCallbackConsent' in barrelModule && 'isIsoInstant' in barrelModule);
    // The same walk, over a consent.js made up here: each form is seen to be caught.
    const realConsent = readFileSync(pathJoin(LIB, 'consent.js'), 'utf8');
    for (const [label, addition] of [
      ['a static import of a Node builtin without the node: prefix', "import { createHash as _unused } from 'crypto';\n"],
      ['a static import with the node: prefix', "import { createHash } from 'node:crypto';\n"],
      ['a dynamic import', "export const _lazy = () => import('node:crypto');\n"],
      ['a side-effect import', "import 'node:fs';\n"],
      ['a require call', "const fs = require('fs');\n"],
      ['a package', "import x from 'left-pad';\n"],
      ['a file outside the layer', "import { scrubPHI } from '../phi-scrub.js';\n"],
      ['a server-only module of the layer', "import { buildCustomFields } from './crm-fields.js';\n"],
      ['a dynamic import that is not a literal', 'export const _l = (n) => import(n);\n'],
    ]) {
      const r = offences('index.js', (f) => (f === 'consent.js' ? addition + realConsent : readFileSync(pathJoin(LIB, f), 'utf8')));
      ok('CE-09: ' + label + ' in consent.js would be caught', r.bad.length === 1 && r.bad[0].startsWith('consent.js imports '), r.bad.join(' | '));
    }
  }

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
      // The lead-enrichment model, as a second laboratory double. Off (null) unless
      // a case turns it on: the suite has no key, so the handler does not call it.
      let LLM = null;
      globalThis.fetch = async (url, opts = {}) => {
        const u = String(url);
        if (LLM && u === 'https://api.anthropic.com/v1/messages') return LLM(opts);
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
        // One contact, read by id (api/opt-out.js reads the consent state this way
        // when the search payload does not carry it).
        if (call.method === 'GET' && /^\/contacts\/[^/?]+$/.test(call.path)) return o.get ? o.get(call) : resp(404, { error: 'no such contact in the double' });
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

      // The server's receipt line, PARSED — not grepped. RED TEAM 2026-10-04:
      // /— TCPA Receipt — [^\n]*scope=X/ matched a line in which the SENDER had
      // written 'scope=X' through the user agent, and a line stating two scopes.
      const RECEIPT = '— TCPA Receipt — ';
      const receiptLines = (text) => String(text).split('\n').filter((l) => l.startsWith(RECEIPT));
      const receiptOf = (r) => { const all = r.notes.flatMap(receiptLines); return all.length === 1 ? all[0].slice(RECEIPT.length).split(' · ') : []; };
      const stmts = (text) => String(text).match(/(?:scope|callback_consent)[a-z_]*\s*=/gi) || [];
      // True only when (1) the notes hold exactly ONE receipt line, (2) its first
      // value is `first`, and (3) that line — once in the note, once in each
      // create body's copy of it — is the ONLY place in everything this request
      // wrote to the CRM where a 'scope=' / 'callback_consent=' statement appears.
      const onlyServerStatement = (r, first) => {
        const parts = receiptOf(r);
        if (parts.length < 2 || parts[0] !== first) return false;
        const line = RECEIPT + parts.join(' · ');
        const everything = JSON.stringify(r.calls.map((c) => c.body));
        return stmts(line).length === 1 && everything.split(line).length - 1 === r.notes.length + r.creates.length &&
          stmts(everything.split(line).join('')).length === 0;
      };
      const SCOPE_BIT = 'scope=DISCUSS_MEDICARE_PLAN_OPTIONS';
      const notRecordedBit = (reason) => 'callback_consent=NOT_RECORDED(' + reason + ')';

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
        ok('CRM-15 (lead handler): that statement is FIRST on the one receipt line, and the only one written anywhere',
          onlyServerStatement(r, SCOPE_BIT), r.notes.join('|').slice(0, 400));
        ok('CRM-15 (lead handler): the line is the server statement, its instant and the address — and only then the client claims', (() => {
          const p = receiptOf(r);
          return p.length === 7 && /^at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p[1]) && /^ip=198\.51\.100\.\d+$/.test(p[2]) &&
            p[3] === 'sha256=' + sha(SHOWN.en) && p[4] === 'disclaimer=' + SHOWN.version && p[5] === 'page=/contact' && p[6] === 'ua=Mozilla/5.0 probe';
        })(), receiptOf(r).join(' | '));
        ok('CE-09 (lead handler): the verbatim text in the note is the text whose digest is registered',
          r.notes.some((n) => n.includes(SHOWN.en)));
        ok('CE-09 (lead handler): and it is labelled verbatim with the version the SERVER verified it against',
          r.notes.some((n) => n.includes('\n— Consent Text (verbatim, v' + SHOWN.version + ') —\n' + SHOWN.en)));
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
        // AUDIT 2026-10-04 (CRM-25) — under IDS one CY2027 field is unmapped on
        // purpose (DATA_SENSITIVITY_CLASS), and its gap is logged on every lead,
        // as the callback fields' gap is today in production. So the CY2027 lines
        // are an ALLOW-LIST of exactly that one gap line: anything else — and
        // anything about the callback consent — is still something to warn about.
        ok('CRM-15 (lead handler): nothing is left to warn about',
          !r.logs.some((l) => /\[CALLBACK-CONSENT\]/.test(l)) &&
          r.logs.filter((l) => /\[CY2027-CRM\]/.test(l)).join('|') ===
            '[warn] [CY2027-CRM] 1 field(s) could not be written because no GoHighLevel field ID is configured for them: DATA_SENSITIVITY_CLASS. ' +
            'Create them in the sub-account (keys: contact.data_sensitivity_class) and set CY2027_CRM_FIELD_IDS. ' +
            'The full record is in the contact note meanwhile, but it is not queryable there.',
          r.logs.filter((l) => /\[CY2027-CRM\]|\[CALLBACK-CONSENT\]/.test(l)).join('|'));
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
        // RED TEAM 2026-10-04 — and it had NO server line in the note at all:
        // the receipt was written only when a hash or a version label came in.
        ok('CE-09 (lead handler): no receipt at all → the note still carries the server line, with the named reason',
          onlyServerStatement(bare, notRecordedBit('CONSENT_TEXT_VERSION_MISSING')) && receiptOf(bare).length === 5 &&
          !receiptOf(bare).some((p) => /^(?:sha256|disclaimer)=/.test(p)), bare.notes.join('|').slice(0, 400));

        // The claims are judged AS RECEIVED (red team 2026-10-04). The handler
        // used to strip characters out of them first, so every case below was
        // recorded as a clean GRANTED with the registered scope.
        for (const h of [12345, false, 0, ['x'], { a: 1 }, 'ZZZZ-NOT-HEX', 'GHIJKLMNOP', sha(SHOWN.en).toUpperCase(), 'xx' + sha(SHOWN.en) + '!!']) {
          const r = await run(submitLead, lead({ consent_receipt_hash: h }), route());
          ok('CE-09 (lead handler): a receipt hash of ' + JSON.stringify(h).slice(0, 24) + ' beside the genuine text is a mismatch, not "no hash sent"',
            r.status === 200 && r.creates.length === 1 && cbFields(r.creates[0]).length === 0 &&
            onlyServerStatement(r, notRecordedBit('CONSENT_RECEIPT_HASH_MISMATCH')) && !receiptOf(r).some((p) => p.startsWith('sha256=')) &&
            /CALLBACK_CONSENT_NOT_RECORDED/.test(String(cf(r.creates[0], 'contact.lead_quality_flags'))), r.notes.join('|').slice(0, 300));
        }
        for (const v of [' 2026-06-01\n', '2026/-06-01', '20 26-06-01', '2026-06-01\u0000', '<b>2026-06-01</b>']) {
          const r = await run(submitLead, lead({ disclaimer_version: v }), route());
          ok('CE-09 (lead handler): a version label of ' + JSON.stringify(v) + ' is not repaired into the registered one',
            r.status === 200 && cbFields(r.creates[0]).length === 0 &&
            onlyServerStatement(r, notRecordedBit('CONSENT_TEXT_VERSION_UNKNOWN')) && !receiptOf(r).some((p) => p.startsWith('disclaimer=')),
            r.notes.join('|').slice(0, 300));
        }
        // The digest is the server's, over the RAW text. Swapping in the stored
        // (stringified, capped) copy made a one-element array read as the wording.
        for (const t of [[SHOWN.en], 7, { toString() { return SHOWN.en; } }, { text: SHOWN.en }, true]) {
          const r = await run(submitLead, lead({ consent_text: t }), route());
          ok('CE-09 (lead handler): a consent_text that is ' + Object.prototype.toString.call(t) + ' is no text — nothing is recorded and nothing is stored as "the text"',
            r.status === 200 && r.creates.length === 1 && cbFields(r.creates[0]).length === 0 &&
            onlyServerStatement(r, notRecordedBit('CONSENT_TEXT_MISSING')) && !r.notes.some((n) => /Consent Text \(/.test(n) || n.includes(SHOWN.en)),
            r.notes.join('|').slice(0, 300));
        }
        // AUDIT 2026-10-04 (CE-09) — the red team's mutant (hash the STORED copy
        // instead of the raw text) was live because the stored copy of a
        // one-element array WAS the wording. That divergence is closed at its
        // root (a non-string is stored as nothing — the cases just above), which
        // leaves the mutant with no input that tells it apart today: the stored
        // copy is the raw text capped and PHI-scrubbed, and neither step can turn
        // another text INTO the registered wording. It would become live again
        // the day the scrub normalises anything, so the call itself is pinned —
        // the WHOLE call, line by line, on comment-stripped source: a guard in
        // front of it, a changed argument or a second call breaks the match.
        {
          const LEAD_SRC = strip(readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8'));
          const CALL = new RegExp([
            '^[ \\t]*_cbRec = recordWebCallbackConsent\\(\\{',
            '[ \\t]*consentGiven: body\\.consent_to_contact,',
            '[ \\t]*disclaimerVersion: body\\.disclaimer_version,',
            '[ \\t]*consentText: body\\.consent_text,',
            '[ \\t]*receiptHash: body\\.consent_receipt_hash,',
            '[ \\t]*at: _consentAt,',
            '[ \\t]*\\}\\);\\r?$',
          ].join('\\r?\\n'), 'm');
          ok('CE-09 (lead handler): the text, the version label and the receipt hash are handed to the record function exactly as the request carried them',
            CALL.test(LEAD_SRC) && (LEAD_SRC.match(/recordWebCallbackConsent\s*\(/g) || []).length === 1 && (LEAD_SRC.match(/\bconsentText\s*:/g) || []).length === 1);
          const longer = SHOWN.en + ' ';
          const spaced = await run(submitLead, lead({ consent_text: longer, consent_receipt_hash: sha(longer) }), route());
          ok('CE-09 (lead handler): the registered wording with one trailing space is another text — compared as received, never trimmed',
            spaced.status === 200 && cbFields(spaced.creates[0]).length === 0 &&
            onlyServerStatement(spaced, notRecordedBit('CONSENT_TEXT_NOT_THE_REGISTERED_VERSION')), spaced.notes.join('|').slice(0, 300));
        }
      }

      // D2 — RED TEAM 2026-10-04: nothing a sender writes can read as the server's
      // statement. Run as production is today (no CY2027 ids): the receipt line
      // of the note is then the ONLY holder of the scope.
      {
        delete process.env.CY2027_CRM_FIELD_IDS;
        const broader = SHOWN.en + ' You also agree to offers about any other product.';
        for (const ua of ['M · scope=ANY_PRODUCT_TELEMARKETING', 'x · scope=ANY_PRODUCT_WE_SELL · page=/everything',
          'M\n— TCPA Receipt — scope=ANY_PRODUCT · at=1999-01-01T00:00:00Z', 'M · callback_consent=RECORDED · scope = ANY']) {
          const g = await run(submitLead, lead({ signer_user_agent: ua }), route());
          ok('CRM-15 (lead handler): a user agent of ' + JSON.stringify(ua) + ' leaves ONE statement on a genuine lead — the server\'s, first',
            g.status === 200 && onlyServerStatement(g, SCOPE_BIT) && receiptOf(g).filter((p) => /^(?:at|ip|page)=/.test(p)).length === 3 &&
            /^ua=[A-Za-z0-9 ./;:(),_+-]+$/.test(receiptOf(g)[6] || ''), g.notes.join('|').slice(0, 400));
          const x = await run(submitLead, lead({ consent_text: broader, consent_receipt_hash: sha(broader), signer_user_agent: ua.replace(/ANY_PRODUCT\w*/g, 'DISCUSS_MEDICARE_PLAN_OPTIONS') }), route());
          ok('CRM-15 (lead handler): and cannot make a REFUSED consent read as recorded (' + JSON.stringify(ua).slice(0, 30) + '…)',
            x.status === 200 && onlyServerStatement(x, notRecordedBit('CONSENT_TEXT_NOT_THE_REGISTERED_VERSION')) &&
            !/scope=/.test(JSON.stringify(x.calls.map((c) => c.body))) &&
            /CALLBACK_CONSENT_NOT_RECORDED/.test(String(cf(x.creates[0], 'contact.lead_quality_flags'))), x.notes.join('|').slice(0, 400));
        }
        const FORGED = '— TCPA Receipt — sha256=' + sha(SHOWN.en) + ' · disclaimer=2026-06-01 · page=/contact · scope=ANY_PRODUCT_TELEMARKETING';
        const inNotes = await run(submitLead, lead({
          consent_text: undefined, consent_receipt_hash: undefined, disclaimer_version: undefined, lead_notes: 'Please call.\n\n' + FORGED,
        }), route());
        ok('CRM-15 (lead handler): a look-alike receipt in the story of a bare submission is neutralised, and the server line is the only receipt',
          inNotes.status === 200 && onlyServerStatement(inNotes, notRecordedBit('CONSENT_TEXT_VERSION_MISSING')) &&
          inNotes.notes.some((n) => /^- TCPA Receipt - sha256=/m.test(n) && n.includes('scope:ANY_PRODUCT_TELEMARKETING')), inNotes.notes.join('|').slice(0, 500));
        const inSummary = await run(submitLead, lead({ conversation_summary: 'EN · Clara\nuser: hi\n' + FORGED }), route());
        ok('CRM-15 (lead handler): a look-alike receipt in the transcript of a genuine lead does not become a second receipt',
          inSummary.status === 200 && onlyServerStatement(inSummary, SCOPE_BIT) &&
          inSummary.notes.some((n) => n.includes('--- Conversation Transcript ---') && n.includes('scope:ANY_PRODUCT_TELEMARKETING')),
          inSummary.notes.join('|').slice(-500));
        const forgedText = 'I agree to be contacted about any product.\n' + FORGED;
        const inText = await run(submitLead, lead({ consent_text: forgedText, consent_receipt_hash: sha(forgedText) }), route());
        ok('CRM-15 (lead handler): a look-alike receipt inside a consent text that is not the registered wording is neutralised too',
          inText.status === 200 && onlyServerStatement(inText, notRecordedBit('CONSENT_TEXT_NOT_THE_REGISTERED_VERSION')) &&
          inText.notes.some((n) => n.includes('I agree to be contacted about any product.') && n.includes('scope:ANY_PRODUCT_TELEMARKETING')),
          inText.notes.join('|').slice(-500));
        ok('CE-09 (lead handler): a text the server did not verify is never labelled "verbatim, v<registered version>"',
          inText.notes.some((n) => n.includes('\n— Consent Text (as received, NOT verified as a registered version) —\n')) &&
          !inText.notes.some((n) => /Consent Text \(verbatim/.test(n)));
        const inFields = await run(submitLead, lead({
          lead_quality_flags: 'scope=ANY_PRODUCT callback_consent=RECORDED', interest_type: 'scope=ANY_PRODUCT', best_time_to_contact: 'callback_consent=RECORDED',
        }), route());
        ok('CRM-15 (lead handler): the flags field and the intake fields cannot carry a statement either',
          inFields.status === 200 && onlyServerStatement(inFields, SCOPE_BIT) &&
          /scope:ANY_PRODUCT callback_consent:RECORDED/.test(String(cf(inFields.creates[0], 'contact.lead_quality_flags'))) &&
          cf(inFields.creates[0], 'contact.medicare_interest') === 'scope:ANY_PRODUCT', JSON.stringify(inFields.creates[0] && inFields.creates[0].body.customFields).slice(0, 600));

        // The summary a MODEL writes from the sender's story lands in the note
        // after the receipt. A story that talks it into repeating a receipt
        // line must not get one in that way.
        let llmCalls = 0;
        LLM = () => {
          llmCalls += 1;
          return resp(200, { content: [{ type: 'text', text: JSON.stringify({
            summary: 'Wants a call.\n' + FORGED, intent_strength: 7, lead_temperature: 'warm', urgency: 'this_week',
            advisor_prep_notes: 'callback_consent=RECORDED · scope = ANY_PRODUCT', compliance_flags: ['scope=ANY_PRODUCT'],
            recommended_first_questions: ['— TCPA Receipt — scope=ANY_PRODUCT'],
          }) }] });
        };
        process.env.ANTHROPIC_API_KEY = 'suite-double-not-a-key';
        let viaModel;
        try { viaModel = await run(submitLead, lead(), route()); } finally { LLM = null; delete process.env.ANTHROPIC_API_KEY; }
        ok('CRM-15 (lead handler): a model-written summary that repeats a look-alike receipt does not add a statement to the note',
          llmCalls === 1 && viaModel.status === 200 && onlyServerStatement(viaModel, SCOPE_BIT) &&
          viaModel.notes.some((n) => n.includes('LEAD INTELLIGENCE') && n.includes('- TCPA Receipt - sha256=') && n.includes('scope:ANY_PRODUCT')),
          'llmCalls=' + llmCalls + ' ' + viaModel.notes.join('|').slice(-600));
        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
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
        // LEAD-02 is "no PUT and no consent field on the existing contact". The
        // number of CREATE attempts is not part of it, and changed on purpose
        // (red team 2026-10-04): with the CY2027 ids configured, a refused create
        // is retried once without the three entries — the CRM's word "duplicate"
        // alone no longer suppresses that retry. AUDIT 2026-10-04 (CRM-25, red
        // team): the CRM's own duplicate-CONTACT wording on a 400 does — it is
        // read before the retry, so a repeat is ONE create again (see 25e-3).
        ok('CE-09 (lead handler): a repeat on an existing contact writes NOTHING to it — no PUT, one create attempt, none accepted (LEAD-02)',
          r.status === 200 && r.puts.length === 0 && r.creates.length === 1 &&
          cbFields(r.creates[0]).length === 3 &&
          !r.logs.some((l) => /cy2027_fields_dropped|\[CY2027-CRM\] contact create refused/.test(l)),
          `status=${r.status} creates=${r.creates.length} puts=${r.puts.length}`);
        ok('CRM-15 (lead handler): the repeat note carries the scope of the new consent',
          r.notes.some((n) => /New consent receipt on this submission — [^\n]*scope=DISCUSS_MEDICARE_PLAN_OPTIONS/.test(n)), r.notes.join('|').slice(0, 400));
        const REPEAT = 'New consent receipt on this submission — ';
        const repeatReceipt = (x) => {
          const all = x.notes.join('\n').split('\n').filter((l) => l.startsWith(REPEAT));
          return all.length === 1 ? all[0].slice(REPEAT.length).split(' · ') : [];
        };
        ok('CRM-15 (lead handler): in the repeat note too the server statement is first, and it is the only statement in the note',
          JSON.stringify(repeatReceipt(r).map((p) => p.replace(/^at=.*/, 'at=…'))) ===
            JSON.stringify([SCOPE_BIT, 'at=…', 'sha256=' + sha(SHOWN.en), 'disclaimer=' + SHOWN.version, 'page=/contact']) &&
          stmts(r.notes.join('\n')).length === 1, r.notes.join('|').slice(0, 400));
        // RED TEAM 2026-10-04 — a repeat with no hash and no version label left
        // NOTHING on the contact: LEAD-02 writes no flag, and the receipt line was
        // conditional on one of the two having been sent.
        const L0 = lead({ consent_text: undefined, consent_receipt_hash: undefined, disclaimer_version: undefined });
        const r0 = await run(submitLead, L0, route({
          contact: dup,
          search: () => resp(200, { contacts: [{ id: 'C_EXIST0', phone: '+1' + L0.phone, tags: ['status-newlead'], dnd: false }] }),
        }));
        ok('CE-09 (lead handler): a repeat that sent no receipt at all still leaves the named reason on the contact, in the repeat note',
          r0.status === 200 && r0.puts.length === 0 && repeatReceipt(r0)[0] === notRecordedBit('CONSENT_TEXT_VERSION_MISSING') &&
          repeatReceipt(r0).length === 3 && stmts(r0.notes.join('\n')).length === 1, r0.notes.join('|').slice(0, 400));
        const one = await withTickingClock(() => run(submitLead, lead(), route({
          contact: dup,
          search: (call) => resp(200, { contacts: [{ id: 'C_EXIST3', phone: '+1' + decodeURIComponent(call.path).replace(/\D/g, '').slice(-10), tags: [], dnd: false }] }),
        })));
        ok('CE-09 (lead handler): the repeat receipt carries the instant of the consent — the clock is not read a second time for it', (() => {
          const at = (repeatReceipt(one)[1] || '').slice(3);
          // On a clock that never repeats, the first value read by this request is its consent instant.
          return isIsoInstant(at) && one.creates.length === 1 && cf(one.creates[0], 'contact.callback_consent_at') === at;
        })(), JSON.stringify(repeatReceipt(one)));
        delete process.env.CY2027_CRM_FIELD_IDS;
        const Ln = lead();
        const noIds = await run(submitLead, Ln, route({
          contact: dup,
          search: () => resp(200, { contacts: [{ id: 'C_EXIST4', phone: '+1' + Ln.phone, tags: ['status-newlead'], dnd: false }] }),
        }));
        ok('CE-09 (lead handler): with no CY2027 id configured (production today) a repeat is still exactly ONE create attempt and no PUT',
          noIds.status === 200 && noIds.creates.length === 1 && noIds.puts.length === 0 && repeatReceipt(noIds)[0] === SCOPE_BIT,
          `status=${noIds.status} creates=${noIds.creates.length} puts=${noIds.puts.length}`);
        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
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
        ok('CE-09 (lead handler): a dead token (401) is not retried in any shape',
          auth.creates.length === 1 && auth.status === 502 && !!auth.payload && auth.payload.error === 'CRM_AUTH', `status=${auth.status} creates=${auth.creates.length}`);
        ok('CE-09 (lead handler): a refusal that persists is not reported as "fields dropped" — nothing was kept by dropping them',
          !dead.logs.some((l) => /cy2027_fields_dropped|\[CY2027-CRM\] contact create refused/.test(l)));

        // RED TEAM 2026-10-04 — the retry depended on the CRM's status code AND on
        // its wording: only 400/422, and only when the message did not contain
        // "duplicat". Each of these lost a lead the same body without the three
        // entries would have created (the 400 was even answered 409
        // DUPLICATE_LEAD, which the client shows as success).
        for (const [status, message] of [
          [422, 'customFields: duplicate custom field id'],
          [400, 'customFields contains a duplicated id'],
          [403, 'custom field not accessible for this location'],
          [404, 'custom field not found'],
          [409, 'conflict on custom field'],
        ]) {
          const refuse = (call) => (cbFields(call).length ? resp(status, { message }) : resp(201, { contact: { id: 'C_KEPT' } }));
          const k = await run(submitLead, lead(), route({ contact: refuse }));
          ok('CE-09 (lead handler): a create refused with HTTP ' + status + ' "' + message + '" over the new fields is retried once without them, and the lead is kept',
            k.status === 200 && k.creates.length === 2 && cbFields(k.creates[0]).length === 3 && cbFields(k.creates[1]).length === 0 &&
            !!k.payload && k.payload.contact_id === 'C_KEPT' &&
            JSON.stringify({ ...k.creates[1].body, customFields: k.creates[1].body.customFields.length + 3 }) === JSON.stringify({ ...k.creates[0].body, customFields: k.creates[0].body.customFields.length }) &&
            k.logs.some((l) => l.includes('[CY2027-CRM] contact create refused (HTTP ' + status + ')')) &&
            k.logs.some((l) => l.includes('"outcome":"cy2027_fields_dropped"') && l.includes('"upstream_status":' + status)) &&
            onlyServerStatement(k, SCOPE_BIT), `status=${k.status} creates=${k.creates.length} ${JSON.stringify(k.payload).slice(0, 120)}`);
        }
        // A transient failure is the CRM's, not the fields': the SAME body is what
        // gets retried, and no field is dropped for it.
        for (const status of [500, 503, 429]) {
          let n = 0;
          const flaky = await run(submitLead, lead(), route({ contact: () => (++n === 1 ? resp(status, { message: 'try again' }) : resp(201, { contact: { id: 'C_FLAKY' } })) }));
          ok('CE-09 (lead handler): one transient HTTP ' + status + ' is retried with the SAME body — the three fields still land',
            flaky.status === 200 && flaky.creates.length === 2 && cbFields(flaky.creates[1]).length === 3 &&
            JSON.stringify(flaky.creates[1].body) === JSON.stringify(flaky.creates[0].body) &&
            !flaky.logs.some((l) => /cy2027_fields_dropped/.test(l)), `status=${flaky.status} creates=${flaky.creates.length}`);
        }
        const down = await run(submitLead, lead(), route({ contact: () => resp(500, { message: 'down' }) }));
        ok('CE-09 (lead handler): a CRM that stays down is never "fixed" by dropping the fields — every attempt carries them',
          down.status === 502 && down.creates.length === 3 && down.creates.every((c) => cbFields(c).length === 3) &&
          !down.logs.some((l) => /cy2027_fields_dropped/.test(l)), `status=${down.status} creates=${down.creates.length}`);
        delete process.env.CY2027_CRM_FIELD_IDS;
        const plain = await run(submitLead, lead(), route({ contact: () => resp(422, { message: 'nope' }) }));
        ok('CE-09 (lead handler): with no ids configured there is nothing to drop, so a 422 is not retried',
          plain.status === 502 && plain.creates.length === 1, `status=${plain.status} creates=${plain.creates.length}`);
      }

      // H — the revocation mirror in api/opt-out.js.
      {
        const p0 = '7182013344';
        // A search payload that carries no custom fields at all.
        const knownBare = () => resp(200, { contacts: [{ id: 'C_OPT', phone: '+1' + p0, tags: ['Consent Captured'] }] });
        const r0 = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: knownBare }));
        ok('CE-09 (opt-out handler): with no id configured the suppression is what it was — one PUT, dnd:true, four consent fields',
          r0.status === 200 && JSON.stringify(r0.payload) === ACK && r0.puts.length === 1 && r0.puts[0].body.dnd === true &&
          r0.puts[0].body.customFields.length === 4 && cbFields(r0.puts[0]).length === 0);
        ok('CE-09 (opt-out handler): the gap is named in the log', r0.logs.some((l) => /\[CY2027-CRM\] 2 field\(s\) could not be written/.test(l)));
        ok('CE-09 (opt-out handler): the note records that the callback permission was revoked',
          r0.notes.some((n) => /^Callback contact permission: REVOKED$/m.test(n)));

        ok('CE-09 (opt-out handler): with no id configured there is no extra CRM read, and the note says the fields were NOT written',
          r0.calls.filter((c) => c.method === 'GET').length === 1 &&
          r0.notes.some((n) => /^Callback consent fields in the CRM: NOT written — CALLBACK_CONSENT_STATUS and CALLBACK_CONSENT_AT do not both have a GoHighLevel field id/m.test(n)) &&
          r0.logs.some((l) => /\[OPTOUT\] applied dnd=true note=true evidence=chat_optout callback_consent=NO_FIELD_IDS\/NOTHING_TO_WRITE/.test(l)));

        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
        // RED TEAM 2026-10-04 — what is written now depends on what the contact
        // reads TODAY, so the double has to say: this contact was GRANTED on
        // 1 October (the search payload carries its custom fields).
        const GRANT_AT = '2026-10-01T09:00:00.000Z';
        const contactNow = (...customFields) => ({ id: 'C_OPT', phone: '+1' + p0, tags: ['Consent Captured'], customFields });
        const granted = () => resp(200, { contacts: [contactNow({ id: 'cbS', value: 'GRANTED' }, { id: 'cbA', value: GRANT_AT }, { id: 'cbX', value: 'DISCUSS_MEDICARE_PLAN_OPTIONS' })] });
        const known = () => granted();
        const cbOf = (c) => cbFields(c).map((f) => f.id + '=' + f.value).join();
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
          !!put && put.body.dnd === true && !/GRANTED/.test(JSON.stringify(r1.calls.map((c) => c.body))) && !/"value":"true"/.test(JSON.stringify(put.body)));
        ok('CE-09 (opt-out handler): a contact that read GRANTED gets both values, the state came from the search payload (no extra read), and the note says what was written',
          cbOf(put) === 'cbS=REVOKED,cbA=' + at && r1.calls.filter((c) => c.method === 'GET').length === 1 &&
          r1.notes.some((n) => n.includes('\nCallback consent fields in the CRM: CALLBACK_CONSENT_STATUS=REVOKED and CALLBACK_CONSENT_AT=' + at + ' written.\n')) &&
          r1.logs.some((l) => /callback_consent=REVOKED_WITH_INSTANT\/WRITTEN/.test(l)), cbOf(put));

        // ── A revocation that is in force keeps its instant ──
        const REVOKED_EARLIER = '2026-09-01T10:00:00.000Z';
        const already = () => resp(200, { contacts: [{ ...contactNow({ id: 'cbS', value: 'REVOKED' }, { id: 'cbA', value: REVOKED_EARLIER }), dnd: true, tags: ['Consent Revoked', 'cp-dnc'] }] });
        const rep = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: already }));
        ok('CE-09 (opt-out handler): a repeat opt-out on a contact ALREADY revoked does not move the revocation instant — neither callback field is rewritten',
          rep.puts.length === 1 && cbFields(rep.puts[0]).length === 0 && rep.puts[0].body.dnd === true && rep.puts[0].body.customFields.length === 4 &&
          !JSON.stringify(rep.puts[0].body).includes('callback_consent') &&
          rep.notes.some((n) => /^Callback consent fields in the CRM: unchanged — the contact already read CALLBACK_CONSENT_STATUS=REVOKED/m.test(n)) &&
          rep.logs.some((l) => /callback_consent=ALREADY_REVOKED\/NOTHING_TO_WRITE/.test(l)), cbOf(rep.puts[0]));

        // ── The search payload does not carry the state: ONE read, by id ──
        const viaGet = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({
          search: knownBare, get: () => resp(200, { contact: contactNow({ id: 'cbS', value: 'REVOKED' }, { id: 'cbA', value: REVOKED_EARLIER }) }),
        }));
        ok('CE-09 (opt-out handler): when the search payload carries no custom fields the contact is read once by id — and an earlier revocation found there stands',
          viaGet.calls.filter((c) => c.method === 'GET' && c.path === '/contacts/C_OPT').length === 1 &&
          viaGet.puts.length === 1 && cbFields(viaGet.puts[0]).length === 0 && viaGet.logs.some((l) => /callback_consent=ALREADY_REVOKED/.test(l)));
        const viaGetGranted = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({
          search: knownBare, get: () => resp(200, { contact: contactNow({ id: 'cbS', value: 'GRANTED' }, { id: 'cbA', value: GRANT_AT }) }),
        }));
        ok('CE-09 (opt-out handler): and a grant found there is revoked with this instant',
          viaGetGranted.puts.length === 1 && /^cbS=REVOKED,cbA=\d{4}-/.test(cbOf(viaGetGranted.puts[0])) && viaGetGranted.logs.some((l) => /REVOKED_WITH_INSTANT\/WRITTEN/.test(l)));
        for (const [label, get] of [
          ['the read fails (HTTP 500)', () => resp(500, { message: 'down' })],
          ['the read is refused (HTTP 404)', undefined],
          ['the read carries no custom fields either', () => resp(200, { contact: { id: 'C_OPT' } })],
          ['the read lists none', () => resp(200, { contact: contactNow() })],
          ['the read throws', () => { throw new Error('socket hang up'); }],
        ]) {
          const u = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: knownBare, get }));
          ok('CE-09 (opt-out handler): when the current state cannot be read (' + label + ') REVOKED is written and the instant on the contact is left alone',
            JSON.stringify(u.payload) === ACK && u.puts.length === 1 && cbOf(u.puts[0]) === 'cbS=REVOKED' && u.puts[0].body.dnd === true &&
            u.notes.some((n) => /^Callback consent fields in the CRM: CALLBACK_CONSENT_STATUS=REVOKED written\. CALLBACK_CONSENT_AT was left as it was/m.test(n)) &&
            u.logs.some((l) => /callback_consent=REVOKED_STATUS_ONLY\/WRITTEN/.test(l)) && u.logs.some((l) => /could not be read/.test(l)), cbOf(u.puts[0]));
        }

        // ── A partial id map: both values, or neither ──
        for (const map of [{ CALLBACK_CONSENT_AT: 'cbA' }, { CALLBACK_CONSENT_AT: 'cbA', CALLBACK_CONSENT_SCOPE: 'cbX' }, { CALLBACK_CONSENT_STATUS: 'cbS' },
          { callback_consent_status: 'cbS', CALLBACK_CONSENT_AT: 'cbA' }]) {
          process.env.CY2027_CRM_FIELD_IDS = JSON.stringify(map);
          const part = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known }));
          ok('CE-09 (opt-out handler): under the id map ' + JSON.stringify(map) + ' a revocation writes neither callback field, names the gap, and still suppresses',
            part.puts.length === 1 && cbFields(part.puts[0]).length === 0 && part.puts[0].body.dnd === true && part.puts[0].body.customFields.length === 4 &&
            part.calls.filter((c) => c.method === 'GET').length === 1 &&
            part.logs.some((l) => /not written either: a revocation is sent to the CRM with its status AND its timestamp, or not at all/.test(l)) &&
            part.notes.some((n) => /^Callback consent fields in the CRM: NOT written — /m.test(n)) && JSON.stringify(part.payload) === ACK, cbOf(part.puts[0]));
        }
        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;

        // ── A refused or failed update: what is retried, and with what ──
        const refuse = (call) => (cbFields(call).length ? resp(422, { message: 'bad id' }) : resp(200, { contact: { id: 'C_OPT' } }));
        const r2 = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known, put: refuse }));
        ok('CE-09 (opt-out handler): an update refused over the new fields is re-sent in its previous shape',
          r2.puts.length === 2 && cbFields(r2.puts[0]).length === 2 && r2.puts[1].body.dnd === true &&
          r2.puts[1].body.customFields.length === 4 && cbFields(r2.puts[1]).length === 0);
        // RED TEAM 2026-10-04 — "previous shape" was asserted as three loose
        // facts; a retry that lost the per-channel DND or the revocation tags passed.
        ok('CE-09 (opt-out handler): the re-sent update is the first one minus the two callback entries, and nothing else',
          r2.puts.length === 2 &&
          JSON.stringify(r2.puts[1].body) === JSON.stringify({ ...r2.puts[0].body, customFields: r2.puts[0].body.customFields.filter((f) => !/callback_consent/.test(f.key)) }) &&
          ['Call', 'SMS', 'Email'].every((ch) => r2.puts[1].body.dndSettings[ch].status === 'active') &&
          ['cp-dnc', 'dnc-web-chat', 'Consent Revoked'].every((t) => r2.puts[1].body.tags.includes(t)) && !r2.puts[1].body.tags.includes('Consent Captured'));
        ok('CE-09 (opt-out handler): and the suppression is reported applied, with the same acknowledgement',
          r2.logs.some((l) => /\[OPTOUT\] applied dnd=true/.test(l)) && JSON.stringify(r2.payload) === ACK);
        ok('CE-09 (opt-out handler): the fields that were dropped are said to be NOT written — in the log and in the note',
          r2.logs.some((l) => l.includes('[OPTOUT] update refused status=422 with the CALLBACK_CONSENT_* fields attached')) &&
          r2.logs.some((l) => l.includes('[OPTOUT] callback_consent REVOKED NOT written to the CRM fields (DROPPED)')) &&
          r2.logs.some((l) => /callback_consent=REVOKED_WITH_INSTANT\/DROPPED/.test(l)) &&
          r2.notes.some((n) => /^Callback consent fields in the CRM: NOT written — the CRM refused the update with them attached/m.test(n) && /^Channels blocked: call, sms, email$/m.test(n)));
        for (const status of [403, 404, 409, 400]) {
          const rs = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({
            search: known, put: (call) => (cbFields(call).length ? resp(status, { message: 'duplicate custom field id' }) : resp(200, { contact: { id: 'C_OPT' } })),
          }));
          ok('CE-09 (opt-out handler): a refusal with HTTP ' + status + ' over the new fields never costs the suppression',
            rs.puts.length === 2 && cbFields(rs.puts[1]).length === 0 && rs.logs.some((l) => /\[OPTOUT\] applied dnd=true/.test(l)));
        }
        // RED TEAM 2026-10-04 — the retry fired on ANY failed PUT: a transient 500
        // stripped the REVOKED fields, the second PUT succeeded, and the contact
        // read GRANTED beside DND while the note said REVOKED.
        for (const status of [500, 503, 429]) {
          let n = 0;
          const flaky = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({
            search: known, put: () => (++n === 1 ? resp(status, { message: 'transient' }) : resp(200, { contact: { id: 'C_OPT' } })),
          }));
          ok('CE-09 (opt-out handler): one transient HTTP ' + status + ' is retried with the SAME update — REVOKED and its instant are still written',
            flaky.puts.length === 2 && JSON.stringify(flaky.puts[1].body) === JSON.stringify(flaky.puts[0].body) && cbFields(flaky.puts[1]).length === 2 &&
            flaky.logs.some((l) => /REVOKED_WITH_INSTANT\/WRITTEN/.test(l)) && !flaky.logs.some((l) => /NOT written|retrying the suppression without them/.test(l)) &&
            flaky.notes.some((n2) => / written\.$/m.test(n2)), `puts=${flaky.puts.length}`);
        }
        const stillDown = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known, put: () => resp(500, { message: 'down' }) }));
        ok('CE-09 (opt-out handler): a CRM that stays down gets the same update twice and never a field-less one — and the note says the suppression was NOT applied',
          stillDown.puts.length === 2 && stillDown.puts.every((c) => cbFields(c).length === 2) && JSON.stringify(stillDown.payload) === ACK &&
          stillDown.logs.some((l) => l.includes('[OPTOUT] DND update failed status=500')) &&
          stillDown.logs.some((l) => l.includes('[OPTOUT] callback_consent REVOKED NOT written to the CRM fields (UPDATE_FAILED)')) &&
          stillDown.notes.some((n) => /^\*\*\* NOT APPLIED — the CRM did not accept the do-not-contact update \(HTTP 500\)\. Set DND on this contact by hand\. \*\*\*$/m.test(n) &&
            /^Channels requested to be blocked: call, sms, email$/m.test(n) && !/^Channels blocked:/m.test(n) &&
            /^Callback consent fields in the CRM: NOT written — the CRM did not accept the update/m.test(n)), `puts=${stillDown.puts.length}`);
        const deadToken = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: known, put: () => resp(401, { message: 'unauthorized' }) }));
        ok('CE-09 (opt-out handler): a dead token (401) is not retried in any shape, and nothing is reported as written',
          deadToken.puts.length === 1 && cbFields(deadToken.puts[0]).length === 2 && JSON.stringify(deadToken.payload) === ACK &&
          deadToken.logs.some((l) => l.includes('[OPTOUT] DND update failed status=401')) && deadToken.logs.some((l) => /applied dnd=false/.test(l)) &&
          deadToken.notes.some((n) => /NOT APPLIED — the CRM did not accept the do-not-contact update \(HTTP 401\)/.test(n)), `puts=${deadToken.puts.length}`);
        {
          let n = 0;
          const both = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({
            search: known, put: (call) => (++n === 1 ? resp(503, {}) : cbFields(call).length ? resp(422, { message: 'bad id' }) : resp(200, { contact: { id: 'C_OPT' } })),
          }));
          ok('CE-09 (opt-out handler): transient, then refused over the fields → three updates at most: same, same, then without the two entries',
            both.puts.length === 3 && cbFields(both.puts[0]).length === 2 && cbFields(both.puts[1]).length === 2 && cbFields(both.puts[2]).length === 0 &&
            both.logs.some((l) => /REVOKED_WITH_INSTANT\/DROPPED/.test(l)) && both.logs.some((l) => /applied dnd=true/.test(l)), `puts=${both.puts.length}`);
        }
        delete process.env.CY2027_CRM_FIELD_IDS;
        const plainDown = await run(optOut, { phone: p0, evidence: 'chat_optout' }, route({ search: knownBare, put: () => resp(422, { message: 'nope' }) }));
        ok('CE-09 (opt-out handler): with no ids configured there is nothing to drop — a refused update is not re-sent, and the note says it was NOT applied',
          plainDown.puts.length === 1 && plainDown.logs.some((l) => /applied dnd=false/.test(l)) &&
          plainDown.notes.some((n) => /NOT APPLIED — the CRM did not accept the do-not-contact update \(HTTP 422\)/.test(n)), `puts=${plainDown.puts.length}`);
        process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
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

// ── 26. One canonical CRM field registry (spec §18, audit CRM-29) ────────────
// "Search for existing equivalent fields before creating new ones. Never
//  duplicate fields with slightly different names." Until this audit the twelve
// production field ids existed only as literals inside three handlers, plus a
// fourth bare copy in PRODUCTION_FIELD_IDS, so there was nothing to search.
{
  // An INDEPENDENT copy of what production sends today, in the order the lead
  // writer sends it. If this table and the registry disagree, one of them was
  // edited without the other — which is exactly what this is here to catch.
  const GOLDEN = [
    ['PREFERRED_LANGUAGE', 'QULAmkAuVNCQrAMZ487K', 'contact.preferred_language'],
    ['MEDICARE_STATUS', 'R510tHz6GFBaqZgN5e5S', 'contact.medicare_status'],
    ['CONSENT_MARKETING', 'vPKlhpz6aucJK1U3fJRZ', 'contact.consent_marketing'],
    ['CONSENT_SMS', 'w1hopBfNLGauFRRzQ71l', 'contact.consent_sms'],
    ['CONSENT_CALLS', 'mHdpDjBSA76lQJrKoixL', 'contact.consent_calls'],
    ['CONSENT_EMAIL', 'ykiTUcsu3nvawK39hmll', 'contact.consent_email'],
    ['CLIENT_AGE', 'GSss3tRLKg8mNCzEv3D9', 'contact.client_age'],
    ['CALCULATED_AGE', 'HoYmwc19InLwUwXNyKcr', 'contact.calculated_age'],
    ['LEAD_QUALITY_FLAGS', 'qGryQuR67jXFFVRFBLkz', 'contact.lead_quality_flags'],
    ['CHAT_CONVERSATION_SUMMARY', '6vSP5DJvAc6Jl9BXg409', 'contact.chat_conversation_summary'],
    ['BEST_TIME_TO_CALL', 'PpDDusEEsMz4xNIcrwRW', 'contact.best_time_to_call'],
    ['MEDICARE_INTEREST', 'fLxx7s1GpVJYlxJl08G6', 'contact.medicare_interest'],
  ];
  ok('CRM-29: the registry holds exactly the twelve production fields, ids and keys unchanged',
    JSON.stringify(Object.entries(EXISTING_CRM_FIELDS).map(([n, f]) => [n, f.id, f.key])) === JSON.stringify(GOLDEN));
  ok('CRM-29: the registry cannot be mutated at runtime',
    Object.isFrozen(EXISTING_CRM_FIELDS) && Object.values(EXISTING_CRM_FIELDS).every((f) => Object.isFrozen(f)));
  ok('CRM-29: PRODUCTION_FIELD_IDS is the registry\'s own ids, in order — one source, not a second copy',
    Object.isFrozen(PRODUCTION_FIELD_IDS) && JSON.stringify(PRODUCTION_FIELD_IDS) === JSON.stringify(GOLDEN.map(([, id]) => id)));
  ok('CRM-29: the registry is internally consistent', registryProblems().length === 0, registryProblems().join(', '));
  ok('CRM-29: the problem vocabulary is closed and frozen',
    Object.isFrozen(REGISTRY_PROBLEM) && Object.keys(REGISTRY_PROBLEM).length === 7 && Object.entries(REGISTRY_PROBLEM).every(([k, v]) => k === v));
  // AUDIT 2026-10-04 (CRM-29, red team) — the reasons a listing is not searched.
  ok('CRM-29 (red team): the provisioning refusal vocabulary is closed and frozen',
    Object.isFrozen(PROVISIONING_REFUSAL) && Object.keys(PROVISIONING_REFUSAL).length === 4 && Object.entries(PROVISIONING_REFUSAL).every(([k, v]) => k === v) &&
    ['LISTING_UNPARSED', 'LISTING_EMPTY', 'LISTING_UNREADABLE', 'REGISTRY_NOT_IN_ACCOUNT'].every((k) => Object.prototype.hasOwnProperty.call(PROVISIONING_REFUSAL, k)));

  // The consistency check is observed FAILING on a defective registry, by name.
  const E = EXISTING_CRM_FIELDS;
  const C = CY2027_FIELD_KEYS;
  const bad = (existing, cy2027, legacy) => registryProblems({ existing, cy2027, legacy });
  ok('CRM-29: a name passed where an id belongs is MALFORMED_ID',
    bad({ ...E, X: { id: 'soa_pdf_hash', key: 'contact.x' } }, C).includes('MALFORMED_ID:EXISTING.X') &&
    bad({ ...E, X: { id: 7, key: 'contact.x' } }, C).includes('MALFORMED_ID:EXISTING.X'));
  // AUDIT 2026-10-04 (CRM-29, red team) — any alphanumeric string passed as an id,
  // so a registry id missing its last character reached the provisioning guard well-formed.
  ok('CRM-29 (red team): an id that is not exactly twenty characters is MALFORMED_ID',
    bad({ ...E, CONSENT_SMS: { id: E.CONSENT_SMS.id.slice(0, 19), key: E.CONSENT_SMS.key } }, C).includes('MALFORMED_ID:EXISTING.CONSENT_SMS') &&
    bad({ ...E, CONSENT_SMS: { id: E.CONSENT_SMS.id + 'x', key: E.CONSENT_SMS.key } }, C).includes('MALFORMED_ID:EXISTING.CONSENT_SMS') &&
    bad({ ...E, X: { id: 'true', key: 'contact.x' } }, C).includes('MALFORMED_ID:EXISTING.X') &&
    !bad({ ...E, X: { id: 'A'.repeat(20), key: 'contact.x' } }, C).some((p) => p.startsWith('MALFORMED_ID')));
  ok('CRM-29: two fields with one id is DUPLICATE_ID',
    bad({ ...E, X: { id: E.CONSENT_SMS.id, key: 'contact.x' } }, C).includes('DUPLICATE_ID:EXISTING.X=EXISTING.CONSENT_SMS'));
  ok('CRM-29: two fields with one key is DUPLICATE_KEY',
    bad(E, { ...C, X: 'contact.consent_sms' }).includes('DUPLICATE_KEY:CY2027.X=EXISTING.CONSENT_SMS'));
  ok('CRM-29: two fields that differ only slightly in name is NEAR_DUPLICATE_NAME',
    bad(E, { ...C, SOA_PLANYEAR: 'contact.soa_planyear' }).includes('NEAR_DUPLICATE_NAME:CY2027.SOA_PLANYEAR~CY2027.SOA_PLAN_YEAR') &&
    bad(E, { ...C, CONSENT_CALL: 'contact.consent_call' }).includes('NEAR_DUPLICATE_NAME:CY2027.CONSENT_CALL~EXISTING.CONSENT_CALLS'));
  ok('CRM-29: a key outside the contact.<snake_case> convention is MALFORMED_KEY',
    bad(E, { ...C, X: 'Contact.X-Field' }).includes('MALFORMED_KEY:CY2027.X') && bad(E, { ...C, X: 'soa_x' }).includes('MALFORMED_KEY:CY2027.X'));
  ok('CRM-29: a name that does not say what its key says is NAME_KEY_MISMATCH',
    bad(E, { ...C, CONSENT_FAX: 'contact.consent_pager' }).includes('NAME_KEY_MISMATCH:CY2027.CONSENT_FAX'));
  ok('CRM-29: a legacy name covered by a field that does not exist is LEGACY_POINTS_NOWHERE',
    bad(E, C, [{ sentAs: 'soa_signed', coveredBy: { table: 'CY2027', name: 'SOA_STATUS_X' } }]).includes('LEGACY_POINTS_NOWHERE:soa_signed') &&
    bad(E, C, [{ sentAs: 'zz', coveredBy: { table: 'NOWHERE', name: 'SOA_STATUS' } }]).includes('LEGACY_POINTS_NOWHERE:zz'));
  ok('CRM-29: the check is specific — the same tables passed explicitly report nothing',
    bad(E, C, LEGACY_SOA_NAME_FIELDS).length === 0 && registryProblems(null).length === 0 && registryProblems({ existing: 'x', cy2027: 7, legacy: 'y' }).length === 0);

  // The writer-facing entry: same bytes as the literal it replaced.
  ok('CRM-29: an entry serialises exactly as the old inline literal did',
    JSON.stringify(existingField('CONSENT_SMS', 'false')) ===
      '{"id":"w1hopBfNLGauFRRzQ71l","key":"contact.consent_sms","value":"false"}');
  ok('CRM-29: the value is passed through untouched (submit-lead filters and coerces it itself)',
    existingField('CLIENT_AGE', '').value === '' && existingField('CALCULATED_AGE', 70).value === 70 &&
    existingField('MEDICARE_STATUS', undefined).value === undefined);
  throws('CRM-29: an unregistered field is refused, never written under a guessed id',
    () => existingField('CONSENT_FAX', 'true'), /not a registered existing CRM field/);
  throws('CRM-29: a CY2027 name is not an EXISTING field', () => existingField('SOA_ID', 'x'), /not a registered/);
  throws('CRM-29: an inherited property is not a field', () => existingField('constructor', 'x'), /not a registered/);
  throws('CRM-29: a name that only COERCES to a registered one is refused', () => existingField(['CONSENT_SMS'], 'x'), /not a registered/);
  throws('CRM-29: a non-string name is refused', () => existingField({ toString: () => 'CONSENT_SMS' }, 'x'), /not a registered/);

  // Existing fields must never be offered to the provisioning script as "to create".
  ok('CRM-29: no existing field is also listed as a field to create',
    Object.keys(E).every((n) => !Object.prototype.hasOwnProperty.call(C, n)) &&
    Object.values(E).every((f) => !Object.values(C).includes(f.key)));
  ok('CRM-29: the env map still cannot smuggle an existing field in as a CY2027 one',
    Object.keys(fieldIdMap({ CY2027_CRM_FIELD_IDS: '{"CONSENT_SMS":"x"}' })).length === 0);

  // The search §18 asks for.
  ok('CRM-29: a slightly different name finds the existing field',
    ['consent_call', 'consentCalls', 'contact.Consent-Calls', 'CONSENT_CALLS', ' consent calls '].every((c) =>
      findEquivalentFields(c).some((f) => f.table === 'EXISTING' && f.id === 'mHdpDjBSA76lQJrKoixL')));
  ok('CRM-29: a CY2027 field is found the same way',
    findEquivalentFields('soaPlanYear').some((f) => f.table === 'CY2027' && f.name === 'SOA_PLAN_YEAR'));
  ok('CRM-29: a genuinely new name finds nothing', findEquivalentFields('contact.favorite_color').length === 0);
  ok('CRM-29: an empty candidate finds nothing rather than everything',
    findEquivalentFields('').length === 0 && findEquivalentFields(null).length === 0 && findEquivalentFields('contact.').length === 0);
  ok('CRM-29: distinct concepts are not folded together',
    normalizeFieldName('contact.soa_state') !== normalizeFieldName('contact.residence_state') &&
    normalizeFieldName('contact.soa_language') !== normalizeFieldName('contact.preferred_language') &&
    normalizeFieldName('contact.consent_calls') !== normalizeFieldName('contact.callback_consent_status') &&
    normalizeFieldName('contact.soa_status') !== normalizeFieldName('contact.soa_state'));
  // AUDIT 2026-10-04 (CRM-29, red team) — `statuses` folded to `statuse`, so a
  // hand-made `soa_statuses` was neither reused nor blocked beside `soa_status`.
  ok('CRM-29 (red team): an -es plural of a token ending in ss/us/is folds to the token',
    normalizeFieldName('contact.soa_statuses') === normalizeFieldName('contact.soa_status') &&
    normalizeFieldName('medicare_statuses') === normalizeFieldName('contact.medicare_status') &&
    normalizeFieldName('addresses') === normalizeFieldName('address') &&
    normalizeFieldName('bonuses') === normalizeFieldName('bonus') &&
    normalizeFieldName('spouses') === normalizeFieldName('spouse') &&
    normalizeFieldName('uses') === normalizeFieldName('use'));
  ok('CRM-29 (red team): the plural rule folds no distinct concept',
    normalizeFieldName('soa_statuses') !== normalizeFieldName('soa_state') &&
    normalizeFieldName('status') !== normalizeFieldName('statute') &&
    normalizeFieldName('use') !== normalizeFieldName('us') &&
    normalizeFieldName('medicare_status') !== normalizeFieldName('medicare_interest') &&
    registryProblems().length === 0);
  ok('CRM-29 (red team): a hand-made plural of a registered key is found as its near-duplicate',
    findEquivalentFields('contact.medicare_statuses').some((f) => f.table === 'EXISTING' && f.name === 'MEDICARE_STATUS') &&
    findEquivalentFields('soa_statuses').some((f) => f.table === 'CY2027' && f.name === 'SOA_STATUS') &&
    bad(E, { ...C, SOA_STATUSES: 'contact.soa_statuses' }).includes('NEAR_DUPLICATE_NAME:CY2027.SOA_STATUSES~CY2027.SOA_STATUS'));
  ok('CRM-29: every registered field is listed once', registeredFields().length === Object.keys(E).length + Object.keys(C).length &&
    new Set(registeredFields().map((f) => f.table + '.' + f.name)).size === registeredFields().length);
  ok('CRM-29: the registry stays server-side — the client barrel does not re-export it',
    !('EXISTING_CRM_FIELDS' in barrelModule) && !('existingField' in barrelModule) && !('planProvisioning' in barrelModule));

  // The third convention (sign-soa) is registered, with what covers each name.
  ok('CRM-29: the legacy SOA entries serialise exactly as the old inline literals did',
    JSON.stringify(legacySoaNameFields({ soa_pdf_hash: 'h', soa_signed_at: 't', soa_id: 'i', preferred_language: 'es' })) ===
      '[{"id":"soa_signed","field_value":"true"},{"id":"soa_pdf_hash","field_value":"h"},' +
      '{"id":"soa_signed_at","field_value":"t"},{"id":"soa_id","field_value":"i"},' +
      '{"id":"preferred_language","field_value":"es"}]');
  ok('CRM-29: a missing legacy value is omitted exactly as before, not sent as a string',
    JSON.stringify(legacySoaNameFields({})) ===
      '[{"id":"soa_signed","field_value":"true"},{"id":"soa_pdf_hash"},{"id":"soa_signed_at"},{"id":"soa_id"},{"id":"preferred_language"}]' &&
    JSON.stringify(legacySoaNameFields(null)) === JSON.stringify(legacySoaNameFields(undefined)));
  ok('CRM-29: soa_signed is the constant it always was — the payload cannot change it',
    legacySoaNameFields({ soa_signed: false }).find((f) => f.id === 'soa_signed').field_value === 'true');
  ok('CRM-29: the legacy list did not grow', LEGACY_SOA_NAME_FIELDS.length === 5 && Object.isFrozen(LEGACY_SOA_NAME_FIELDS) &&
    LEGACY_SOA_NAME_FIELDS.every((f) => Object.isFrozen(f)));
  ok('CRM-29: the SOA "preferred_language" is declared to BE the existing field',
    findEquivalentFields('preferred_language').some((f) => f.table === 'EXISTING' && f.id === 'QULAmkAuVNCQrAMZ487K'));
  ok('CRM-29: soa_signed_at is declared as covered by SOA_COMPLETED_AT',
    findEquivalentFields('soa_signed_at').some((f) => f.table === 'CY2027' && f.name === 'SOA_COMPLETED_AT'));

  // Provisioning decisions are made from the account listing, not from hope.
  const total = Object.keys(C).length;
  const liveNow = GOLDEN.map(([, id, key]) => ({ id, key }));
  const plan0 = planProvisioning(liveNow);
  ok('CRM-29: with only the production fields live, every §18 field is creatable and none is blocked',
    plan0.create.length === total && plan0.blocked.length === 0 && Object.keys(plan0.reuse).length === 0 && plan0.drift.length === 0,
    JSON.stringify({ create: plan0.create.length, blocked: plan0.blocked, drift: plan0.drift }));
  const plan1 = planProvisioning([...liveNow, { id: 'handMadeField0000001', key: 'contact.soa_planyear' }, { id: 'exactKeyField0000001', key: 'soa_state' }]);
  ok('CRM-29: an exact key is reused, not recreated', plan1.reuse.SOA_STATE === 'exactKeyField0000001' && !plan1.create.includes('SOA_STATE'));
  ok('CRM-29: a slightly different key BLOCKS creation instead of duplicating the field',
    plan1.blocked.some((b) => b.name === 'SOA_PLAN_YEAR' && b.near.some((n) => n.id === 'handMadeField0000001' && n.where === 'ACCOUNT')) &&
    !plan1.create.includes('SOA_PLAN_YEAR') && !('SOA_PLAN_YEAR' in plan1.reuse));
  ok('CRM-29: every field lands in exactly one bucket',
    plan1.create.length + plan1.blocked.length + Object.keys(plan1.reuse).length === total);
  ok('CRM-29: a CY2027 key that only slightly differs from an EXISTING field is blocked by the registry itself',
    planProvisioning(liveNow, { cy2027: { ...C, CONSENT_CALL: 'contact.consent_call' } }).blocked
      .some((b) => b.name === 'CONSENT_CALL' && b.near.some((n) => n.where === 'REGISTRY:CONSENT_CALLS' && n.id === 'mHdpDjBSA76lQJrKoixL')));
  const plan2 = planProvisioning([
    { id: 'someOtherId000000001', key: 'contact.consent_sms' },
    { id: 'mHdpDjBSA76lQJrKoixL', key: 'contact.consent_by_phone' },
  ]);
  ok('CRM-29: a registry id that the account contradicts is reported',
    plan2.drift.some((d) => d.name === 'CONSENT_SMS' && d.reason === 'ID_MISMATCH' && d.accountId === 'someOtherId000000001'));
  ok('CRM-29: a registry key that the account contradicts is reported',
    plan2.drift.some((d) => d.name === 'CONSENT_CALLS' && d.reason === 'KEY_MISMATCH' && d.accountKey === 'contact.consent_by_phone'));
  ok('CRM-29: a registry field missing from the account is reported',
    plan2.drift.some((d) => d.name === 'PREFERRED_LANGUAGE' && d.reason === 'NOT_IN_ACCOUNT') && plan2.drift.length === GOLDEN.length);
  ok('CRM-29: a malformed account listing never throws', planProvisioning(null).drift.length === GOLDEN.length &&
    planProvisioning([null, {}, { id: 7, key: 'x' }, { id: 'a', key: '' }]).drift.length === GOLDEN.length);

  // AUDIT 2026-10-04 (CRM-29, red team) — measured before the fix: `{}`, an empty
  // listing and a listing in an unread shape each produced 36 creates beside the
  // twelve NOT_IN_ACCOUNT lines that said the search was blind; a live
  // near-duplicate without an id was dropped and then created beside itself.
  // The decision is a pure function, called here with each defective listing.
  const R = PROVISIONING_REFUSAL;
  const oneBucketEach = (p) => p.create.length + p.withheld.length + p.blocked.length + Object.keys(p.reuse).length === total;
  ok('CRM-29 (red team): a listing that was searched carries no refusal and withholds nothing',
    plan0.refusal === null && plan0.withheld.length === 0 && plan0.unreadable.length === 0 && plan1.refusal === null && plan1.withheld.length === 0);
  ok('CRM-29 (red team): a plural near-duplicate in the account BLOCKS the registered key, like any other',
    planProvisioning([...liveNow, { id: 'pluralField000000001', key: 'contact.soa_statuses' }]).blocked
      .some((b) => b.name === 'SOA_STATUS' && b.near.some((n) => n.key === 'contact.soa_statuses' && n.where === 'ACCOUNT')));
  const empty = planProvisioning([]);
  ok('CRM-29 (red team): an EMPTY listing is refused by name — nothing in `create`, every field withheld',
    empty.refusal !== null && empty.refusal.reason === R.LISTING_EMPTY && empty.create.length === 0 && empty.withheld.length === total &&
    empty.drift.length === GOLDEN.length && oneBucketEach(empty), JSON.stringify(empty.refusal));
  const noId = planProvisioning([...liveNow, { key: 'contact.soa_planyear' }]);
  ok('CRM-29 (red team): a live entry WITHOUT an id is named, not dropped — and nothing is created beside it',
    noId.refusal !== null && noId.refusal.reason === R.LISTING_UNREADABLE && noId.create.length === 0 &&
    noId.unreadable.length === 1 && noId.unreadable[0].key === 'contact.soa_planyear' && /id=undefined key="contact\.soa_planyear"/.test(noId.refusal.detail[0]) &&
    oneBucketEach(noId), JSON.stringify(noId.refusal));
  const numId = planProvisioning([...liveNow, { id: 12345, key: 'contact.soa_planyear' }]);
  ok('CRM-29 (red team): a live entry with a NUMERIC id is unreadable, by name',
    numId.refusal !== null && numId.refusal.reason === R.LISTING_UNREADABLE && numId.create.length === 0 && /id=number/.test(numId.refusal.detail[0]));
  const objKey = planProvisioning([...liveNow, { id: 'A'.repeat(20), key: { toString: () => 'soa_state' } }]);
  ok('CRM-29 (red team): a live entry whose key only COERCES to a string is unreadable, never reused',
    objKey.refusal !== null && objKey.refusal.reason === R.LISTING_UNREADABLE && !('SOA_STATE' in objKey.reuse) && objKey.create.length === 0);
  const absent = planProvisioning(liveNow.slice(1));
  ok('CRM-29 (red team): a listing that lacks a field the writers use today is refused, naming the field',
    absent.refusal !== null && absent.refusal.reason === R.REGISTRY_NOT_IN_ACCOUNT && JSON.stringify(absent.refusal.detail) === '["PREFERRED_LANGUAGE"]' &&
    absent.create.length === 0 && absent.withheld.length === total && oneBucketEach(absent), JSON.stringify(absent.refusal));
  ok('CRM-29 (red team): the two-field listing above is refused the same way, for the ten fields it does not show',
    plan2.refusal !== null && plan2.refusal.reason === R.REGISTRY_NOT_IN_ACCOUNT && plan2.refusal.detail.length === GOLDEN.length - 2 && plan2.create.length === 0);
  const hostile = planProvisioning([null, {}, { id: 7, key: 'x' }, { id: 'a', key: '' }]);
  ok('CRM-29 (red team): unreadable entries are named before emptiness, and `null` is an empty listing',
    hostile.refusal.reason === R.LISTING_UNREADABLE && hostile.unreadable.length === 4 && hostile.refusal.detail.length === 4 &&
    planProvisioning(null).refusal.reason === R.LISTING_EMPTY);
  const nearOnly = planProvisioning([{ id: 'handMadeField0000001', key: 'contact.soa_planyear' }]);
  ok('CRM-29 (red team): under a refusal the near-duplicate is still reported as blocked — never as creatable',
    nearOnly.refusal.reason === R.REGISTRY_NOT_IN_ACCOUNT && nearOnly.blocked.some((b) => b.name === 'SOA_PLAN_YEAR') &&
    !nearOnly.withheld.includes('SOA_PLAN_YEAR') && nearOnly.create.length === 0);
  const drifted = planProvisioning(liveNow.map((f, i) => (i === 0 ? { id: 'driftedId00000000001', key: f.key } : f)));
  ok('CRM-29 (red team): an ID_MISMATCH alone does not refuse — the account is visible, the registry is what is wrong',
    drifted.refusal === null && drifted.drift.length === 1 && drifted.drift[0].reason === 'ID_MISMATCH' && drifted.create.length === total);

  // The listing is read by a pure function too, so the shape rule is observed
  // refusing — not coalescing to "no fields" as the script used to.
  const readOk = readAccountListing({ customFields: [{ id: 'A'.repeat(20), fieldKey: 'k' }, { id: 7, key: 'contact.x' }, null] });
  ok('CRM-29 (red team): the listing reader accepts { customFields } and coerces no value',
    readOk.refusal === null && JSON.stringify(readOk.fields) === '[{"id":"AAAAAAAAAAAAAAAAAAAA","key":"k"},{"id":7,"key":"contact.x"},{"id":null,"key":null}]', JSON.stringify(readOk));
  ok('CRM-29 (red team): …and { customField }, the other shape this code has always read',
    readAccountListing({ customField: [{ id: 'B', key: 'y' }] }).fields[0].id === 'B');
  for (const [what, json, hint] of [
    ['an empty object', {}, '(none)'], ['a paginated shape', { data: { customFields: [] } }, 'data'], ['a string-valued customFields', { customFields: 'x' }, 'customFields'],
    ['null', null, 'object'], ['an array', [], 'array'], ['a string', 'x', 'string'],
  ]) {
    const r = readAccountListing(json);
    ok(`CRM-29 (red team): ${what} is LISTING_UNPARSED, with what was seen, never an empty account`,
      r.fields === null && r.refusal !== null && r.refusal.reason === R.LISTING_UNPARSED && r.refusal.detail.length === 1 && r.refusal.detail[0].includes(hint), JSON.stringify(r));
  }

  // The three writers read the registry and spell no id of their own. Scanned
  // through strip() so a comment quoting an id can neither pass nor fail this.
  const LEAD = strip(readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8'));
  const OPT = strip(readFileSync(new URL('../api/opt-out.js', import.meta.url), 'utf8'));
  const SIGN6 = strip(readFileSync(new URL('../api/sign-soa.js', import.meta.url), 'utf8'));
  const INLINE_ID = /\bid:\s*['"][A-Za-z0-9]{20}['"]/;
  for (const [file, code] of [['api/submit-lead.js', LEAD], ['api/opt-out.js', OPT], ['api/sign-soa.js', SIGN6]]) {
    ok(`CRM-29: ${file} spells no GoHighLevel field id of its own`, !INLINE_ID.test(code), (code.match(INLINE_ID) || [''])[0]);
    ok(`CRM-29: no production field id appears anywhere in ${file}`,
      GOLDEN.every(([, id]) => !code.includes(id)), GOLDEN.filter(([, id]) => code.includes(id)).map(([n]) => n).join(', '));
    ok(`CRM-29: ${file} hand-writes no contact.* key for an existing field`,
      GOLDEN.every(([, , key]) => !code.includes("'" + key + "'") && !code.includes('"' + key + '"')));
  }
  // Anchored: each entry starts its own line of the array literal, so a
  // prefixed `if (false)` or a wrapping expression breaks the match.
  const lineEntries = (code) => [...code.matchAll(/^[ \t]*existingField\('([A-Z_]+)',/gm)].map((m) => m[1]);
  const anyEntries = (code) => [...code.matchAll(/existingField\('([A-Z_]+)'/g)].map((m) => m[1]);
  ok('CRM-29: the lead writer sends all twelve existing fields, in the same order as before',
    JSON.stringify(lineEntries(LEAD)) === JSON.stringify(GOLDEN.map(([n]) => n)) && anyEntries(LEAD).length === 12, lineEntries(LEAD).join(','));
  ok('CRM-29: the revocation writer clears the three unconditional consent fields, in the same order as before',
    JSON.stringify(lineEntries(OPT)) === JSON.stringify(['CONSENT_MARKETING', 'CONSENT_SMS', 'CONSENT_CALLS']) && anyEntries(OPT).length === 4, anyEntries(OPT).join(','));
  ok('CRM-29: the email flag is still cleared only when email is blocked',
    /^[ \t]*\.\.\.\(blockEmail \? \[existingField\('CONSENT_EMAIL', 'false'\)\] : \[\]\),/m.test(OPT));
  ok('CRM-29: every field a writer names is registered',
    [...anyEntries(LEAD), ...anyEntries(OPT)].every((n) => Object.prototype.hasOwnProperty.call(E, n)));
  const optValues = [...OPT.matchAll(/existingField\('[A-Z_]+',\s*([^)]*)\)/g)].map((m) => m[1].trim());
  ok('CRM-29: a revocation still only ever writes "false"', optValues.length === 4 && optValues.every((v) => v === "'false'"), optValues.join('|'));
  ok('CRM-29: sign-soa takes its legacy entries from the registry, and the mapped CY2027 fields still follow them',
    /^[ \t]*\.\.\.legacySoaNameFields\(payload\),\s*\.\.\.\(Array\.isArray\(payload\.cy2027CustomFields\) \? payload\.cy2027CustomFields : \[\]\),/m.test(SIGN6));
  ok('CRM-29: sign-soa spells no name-as-id entry of its own', !/\{\s*id:\s*'[a-z_]+',\s*field_value:/.test(SIGN6));
  ok('CRM-29: submit-lead still drops empty values and coerces non-strings after the registry call',
    /^[ \t]*\]\.filter\(function \(f\) \{ return f\.value; \}\)\.map\(function \(f\) \{/m.test(LEAD));

  // The provisioning script — the only path that creates a field — consults the
  // registry first. Source, anchored:
  const PROV = strip(readFileSync(new URL('./cy2027-provision-crm-fields.mjs', import.meta.url), 'utf8'));
  ok('CRM-29: provisioning decides from planProvisioning(), not from an exact-key lookup alone',
    /^[ \t]*const plan = planProvisioning\(await listExisting\(\)\);/m.test(PROV) && !/\.has\(k\)/.test(PROV));
  ok('CRM-29: provisioning refuses to run on an inconsistent registry, before anything is listed or created',
    /^[ \t]*const regProblems = registryProblems\(\);/m.test(PROV) &&
    PROV.indexOf('registryProblems()') < PROV.indexOf('listExisting()', PROV.indexOf('async function main')) &&
    PROV.indexOf('registryProblems()') < PROV.indexOf('await createField('));
  ok('CRM-29: provisioning only ever creates from plan.create',
    /^[ \t]*for \(const n of plan\.create\) \{/m.test(PROV) && !/for \(const n of (names|toCreate)\)\s*\{[\s\S]{0,160}createField/.test(PROV));

  // …and run for real, as a child process against a mocked GoHighLevel listing.
  // A near-duplicate is reported and never created, with or without --apply;
  // drift between the registry and the account is printed; a defective registry
  // stops the script before it lists or creates anything.
  {
    const dir = mkdtempSync(pathJoin(tmpdir(), 'cy2027-crm29-'));
    try {
      const repo = fileURLToPath(new URL('..', import.meta.url));
      mkdirSync(pathJoin(dir, 'scripts'), { recursive: true });
      // The copied .js files are ESM only because the repo's package.json says so.
      writeFileSync(pathJoin(dir, 'package.json'), '{"type":"module"}\n');
      cpSync(pathJoin(repo, 'api', '_lib'), pathJoin(dir, 'api', '_lib'), { recursive: true });
      cpSync(pathJoin(repo, 'scripts', 'cy2027-provision-crm-fields.mjs'), pathJoin(dir, 'scripts', 'cy2027-provision-crm-fields.mjs'));
      const goldLive = GOLDEN.map(([, id, key]) => ({ id, fieldKey: key.replace(/^contact\./, '') }));
      const live = goldLive.slice();
      live[0] = { id: 'driftedId00000000001', fieldKey: 'preferred_language' };
      live.push({ id: 'handMadeField0000001', fieldKey: 'soa_planyear' }, { id: 'exactKeyField0000001', fieldKey: 'soa_state' });
      // The mocked GoHighLevel answers the listing GET with exactly `listingJson`.
      const writeMock = (listingJson) => writeFileSync(pathJoin(dir, 'mock-ghl.mjs'),
        'const LISTING = ' + JSON.stringify(listingJson) + ';\n' +
        'globalThis.fetch = async (url, init) => {\n' +
        '  const method = (init && init.method) || "GET";\n' +
        '  process.stdout.write("MOCK_" + method + " " + (method === "POST" ? JSON.parse(init.body).fieldKey : "list") + "\\n");\n' +
        '  if (method === "POST") return new Response(JSON.stringify({ customField: { id: "new_" + JSON.parse(init.body).fieldKey } }), { status: 200 });\n' +
        '  return new Response(LISTING, { status: 200 });\n' +
        '};\n');
      writeMock(JSON.stringify({ customFields: live }));
      const runProv = (script, ...args) => spawnSync(process.execPath,
        ['--import', pathToFileURL(pathJoin(dir, 'mock-ghl.mjs')).href, script, ...args],
        { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, GHL_API_TOKEN: 'test-token', GHL_LOCATION_ID: 'test-location' } });
      const SCRIPT = pathJoin(dir, 'scripts', 'cy2027-provision-crm-fields.mjs');
      const dry = runProv(SCRIPT);
      const posts = (r) => [...String(r.stdout).matchAll(/^MOCK_POST (\S+)$/gm)].map((m) => m[1]);
      ok('CRM-29 (provisioning, dry run): lists the account, creates nothing, and names the near-duplicate as NOT created',
        dry.status === 0 && /^MOCK_GET list$/m.test(dry.stdout) && posts(dry).length === 0 &&
        /NOT created — a field with a slightly different name already exists \(spec §18\): 1/.test(dry.stdout) &&
        /SOA_PLAN_YEAR\s+contact\.soa_plan_year/.test(dry.stdout) && /~ contact\.soa_planyear\s+id=handMadeField0000001\s+\(ACCOUNT\)/.test(dry.stdout),
        String(dry.stdout).slice(-900) + String(dry.stderr).slice(0, 400));
      ok('CRM-29 (provisioning, dry run): the exact key is reused and the drift between registry and account is printed, by reason',
        /already present: 1/.test(dry.stdout) && /"SOA_STATE":"exactKeyField0000001"/.test(dry.stdout) &&
        /EXISTING_CRM_FIELDS is not confirmed by this sub-account: 1/.test(dry.stdout) &&
        /! PREFERRED_LANGUAGE\s+ID_MISMATCH\s+registry contact\.preferred_language=QULAmkAuVNCQrAMZ487K\s+account contact\.preferred_language=driftedId00000000001/.test(dry.stdout),
        String(dry.stdout).slice(-900));
      const apply = runProv(SCRIPT, '--apply');
      ok('CRM-29 (provisioning, --apply): creates every field in plan.create and STILL never the blocked one',
        apply.status === 0 && posts(apply).length === total - 2 && !posts(apply).includes('soa_plan_year') && !posts(apply).includes('soa_state') &&
        posts(apply).includes('soa_id') && !/created SOA_PLAN_YEAR/.test(apply.stdout) && /created SOA_ID -> new_soa_id/.test(apply.stdout),
        `status=${apply.status} posts=${posts(apply).length} ${String(apply.stderr).slice(0, 300)}`);
      // A defective registry: CONSENT_EMAIL given CONSENT_SMS's id in the copy.
      const CF = pathJoin(dir, 'api', '_lib', 'cy2027', 'crm-fields.js');
      const original = readFileSync(CF, 'utf8');
      const defective = original.replace("CONSENT_EMAIL: Object.freeze({ id: 'ykiTUcsu3nvawK39hmll',", "CONSENT_EMAIL: Object.freeze({ id: 'w1hopBfNLGauFRRzQ71l',");
      ok('CRM-29 (provisioning harness): the defect was actually planted', defective !== original);
      writeFileSync(CF, defective);
      const broken = runProv(SCRIPT, '--apply');
      ok('CRM-29 (provisioning, --apply, defective registry): exits 1 naming the problem, without listing or creating anything',
        broken.status === 1 && /registry is inconsistent/.test(broken.stderr) && /DUPLICATE_ID:EXISTING\.CONSENT_EMAIL=EXISTING\.CONSENT_SMS/.test(broken.stderr) &&
        !/MOCK_/.test(broken.stdout) && posts(broken).length === 0,
        `status=${broken.status} ${String(broken.stderr).slice(0, 300)} ${String(broken.stdout).slice(0, 200)}`);
      writeFileSync(CF, original);

      // AUDIT 2026-10-04 (CRM-29, red team) — measured on the previous script:
      // each of these listings gave exit 0 and 36 MOCK_POST lines with --apply.
      // Now: the listing is fetched (MOCK_GET), the refusal is printed by name,
      // the exit code is 1 and no POST is made — in a dry run as well, so the
      // dry run says what --apply would do.
      const refusedRuns = [
        ['an unexpected shape {}', '{}', 'LISTING_UNPARSED', /top-level keys: \(none\)/],
        ['a paginated shape holding the near-duplicate', JSON.stringify({ data: { customFields: [{ id: 'handMadeField0000001', fieldKey: 'soa_planyear' }] } }), 'LISTING_UNPARSED', /top-level keys: data/],
        ['an empty listing', '{"customFields":[]}', 'LISTING_EMPTY', /reports no custom field; the registry says 12 exist/],
        ['a listing with an entry that has no id', JSON.stringify({ customFields: [...goldLive, { fieldKey: 'soa_planyear' }] }), 'LISTING_UNREADABLE', /\? id=undefined key="soa_planyear"/],
        ['a listing missing a field the writers use today', JSON.stringify({ customFields: goldLive.slice(1) }), 'REGISTRY_NOT_IN_ACCOUNT', /✗ PREFERRED_LANGUAGE/],
      ];
      for (const [what, listingJson, reason, detail] of refusedRuns) {
        writeMock(listingJson);
        for (const mode of [[], ['--apply']]) {
          const r = runProv(SCRIPT, ...mode);
          const out = String(r.stdout) + String(r.stderr);
          ok(`CRM-29 (provisioning, ${mode.length ? '--apply' : 'dry run'}, red team): ${what} is refused by name (${reason}) — exit 1, listed, nothing created`,
            r.status === 1 && posts(r).length === 0 && /^MOCK_GET list$/m.test(r.stdout) && String(r.stderr).includes('(' + reason + ')') && detail.test(out) &&
            !/created /.test(r.stdout) && !/Set this in the environment/.test(r.stdout),
            `status=${r.status} posts=${posts(r).length} ${String(r.stderr).slice(0, 300)} ${String(r.stdout).slice(-200)}`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // AUDIT 2026-10-04 (CRM-29, red team) — the registry, the legacy list and the
  // two vocabularies decide which GoHighLevel id every consent write and every
  // revocation goes to, and were outside the build gate: a copy with their
  // freezes removed passed it ("23/23"), and only this suite — which the
  // artifact does not ship — noticed. They are governing identifiers now, and
  // the gate is observed FAILING on such a copy, by its own command.
  {
    const CRM_GOVERNING = ['CY2027_FIELD_KEYS', 'EXISTING_CRM_FIELDS', 'LEGACY_SOA_NAME_FIELDS', 'PRODUCTION_FIELD_IDS', 'FIELD_ID_REFUSAL',
      'CONFIRMED_ONLY_FIELDS', 'PROVENANCE', 'SELF_REPORTED_ONLY_FIELDS', 'SELF_REPORT_VALUE', 'CONFIRMING_PROVENANCE', 'REGISTRY_PROBLEM', 'PROVISIONING_REFUSAL'];
    ok('CRM-29 (red team): every crm-fields table is a governing identifier of the build gate', CRM_GOVERNING.every((n) => GOVERNING_IDENTIFIERS.includes(n)),
      CRM_GOVERNING.filter((n) => !GOVERNING_IDENTIFIERS.includes(n)).join());
    const injected = { srcFiles: [{ path: 'src/ok.ts', source: 'export const b = 2;' }], objects: { X: Object.freeze({ a: 1 }) } };
    for (const n of CRM_GOVERNING) {
      const r = await runGate({ ...injected, apiFiles: [{ path: 'api/zz.js', source: `${n}.x = 1; ${n}.push('x');` }] });
      ok(`CRM-29 (red team): the gate reports a runtime write to ${n} from a module under api/`,
        r.problems.some((p) => p.startsWith(`api/zz.js: writes to ${n}.x`)) && r.problems.some((p) => p.startsWith(`api/zz.js: mutates ${n} in place`)), r.problems.join(' | '));
    }
    const repoGate = await runGate();
    ok('CRM-29 (red team): the gate loads the registry module and finds every one of its tables frozen all the way down',
      repoGate.problems.length === 0 && repoGate.objectCount >= 35 && repoGate.frozenCount === repoGate.objectCount, `${repoGate.frozenCount}/${repoGate.objectCount} ${repoGate.problems.join(' | ')}`);

    const gateTree = mkdtempSync(pathJoin(tmpdir(), 'cy2027-crm29-gate-'));
    try {
      const repo = fileURLToPath(new URL('..', import.meta.url));
      cpSync(pathJoin(repo, 'api'), pathJoin(gateTree, 'api'), { recursive: true });
      cpSync(pathJoin(repo, 'src'), pathJoin(gateTree, 'src'), { recursive: true });
      writeFileSync(pathJoin(gateTree, 'package.json'), JSON.stringify({ type: JSON.parse(readFileSync(pathJoin(repo, 'package.json'), 'utf8')).type }));
      const CF = pathJoin(gateTree, 'api', '_lib', 'cy2027', 'crm-fields.js');
      let src = readFileSync(CF, 'utf8');
      for (const [from, to] of [
        ["CONSENT_SMS: Object.freeze({ id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms' }),", "CONSENT_SMS: { id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms' },"],
        ['export const LEGACY_SOA_NAME_FIELDS = Object.freeze([', 'export const LEGACY_SOA_NAME_FIELDS = (['],
        ['export const REGISTRY_PROBLEM = Object.freeze({', 'export const REGISTRY_PROBLEM = ({'],
        ['export const PROVISIONING_REFUSAL = Object.freeze({', 'export const PROVISIONING_REFUSAL = ({'],
      ]) {
        ok(`CRM-29 (gate laboratory): the freeze is one exact line in the copy — ${from.slice(0, 44)}`, src.split(from).length === 2);
        src = src.replace(from, to);
      }
      writeFileSync(CF, src);
      writeFileSync(pathJoin(gateTree, 'api', 'zz-crm-write.js'),
        "import { EXISTING_CRM_FIELDS } from './_lib/cy2027/crm-fields.js';\nexport const rewire = (id) => { EXISTING_CRM_FIELDS.CONSENT_SMS.id = id; };\n");
      // The command, as a child process: a module once loaded is cached for the
      // process, so the copy is judged by a fresh one, exactly as the build does.
      const CLI = pathJoin(repo, 'scripts', 'check-no-self-modification.mjs');
      const r = spawnSync(process.execPath, [CLI, '--root', gateTree], { cwd: repo, encoding: 'utf8', timeout: 180000 });
      ok('CRM-29 (red team): the gate COMMAND fails on a copy whose registry entry, legacy list and vocabularies are unfrozen, naming each',
        r.status === 1 && /EXISTING_CRM_FIELDS is not frozen all the way down: EXISTING_CRM_FIELDS\.CONSENT_SMS\b/.test(r.stderr) &&
        /LEGACY_SOA_NAME_FIELDS is not frozen all the way down: LEGACY_SOA_NAME_FIELDS\b/.test(r.stderr) &&
        /REGISTRY_PROBLEM is not frozen all the way down: REGISTRY_PROBLEM\b/.test(r.stderr) &&
        /PROVISIONING_REFUSAL is not frozen all the way down: PROVISIONING_REFUSAL\b/.test(r.stderr) && !r.stdout.includes('OK'),
        `status=${r.status} ${String(r.stderr).slice(0, 700)}`);
      ok('CRM-29 (red team): …and names the module under api/ that assigns a registry id',
        /api\/zz-crm-write\.js: writes to EXISTING_CRM_FIELDS\.CONSENT_SMS\.id/.test(r.stderr), String(r.stderr).slice(0, 700));
    } finally {
      rmSync(gateTree, { recursive: true, force: true });
    }
  }
}

if (failures.length) {
  console.error(`CY2027 LAYER: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

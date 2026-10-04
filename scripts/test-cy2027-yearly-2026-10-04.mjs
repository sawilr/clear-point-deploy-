// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — YEARLY REGULATORY ENGINE (spec §22, Phase 12, §31 "Plan year changes
// from 2027 to 2028 - old scope not silently reused", §33 "Old-year rules …
// silently reused for new plan year").
//
// Every rule here is exercised by CALLING it, with the clock passed in, on both
// sides of a plan-year rollover. Nothing reads today's date: a suite that only
// passes this year is a time bomb, not a test.
//
// Run: node scripts/test-cy2027-yearly-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  CMS_RULESET_2026, CMS_RULESET_2027, CMS_RULESET_2028, CY2027_MARKETING_START_UTC,
  marketingStartUtc, activePlanYear, resolveRuleset, evaluateRuleset, rulesetForAudit, rulesetInventory,
  isRegisteredRuleset, rulesetVouchProblem, rolloverStatus,
} from '../api/_lib/cy2027/rulesets.js';
import {
  RULESET_LIFECYCLE, nextRulesetStatus, recordRulesetTransition, GRANDFATHERED_RULESET_VERSIONS,
  rulesetAttestation, rulesetActivationProblem, sourceReviewStatus, requiredSourceExpired,
} from '../api/_lib/cy2027/ruleset-lifecycle.js';
import { humanActorProblem, isHumanActor } from '../api/_lib/cy2027/actors.js';
import { STATE_RULESETS, resolveStateRuleset, evaluateStateRuleset, RULESET_LIFECYCLE as STATE_LIFECYCLE } from '../api/_lib/cy2027/state-rules.js';
import { createSoaInstance, completeSoaInstance, marketingGate } from '../api/_lib/cy2027/soa-instance.js';
import { resolveSecurityReview, buildSecurityReviewTask } from '../api/_lib/cy2027/trust.js';
import { activeContractYearVariant, LATEST_TPMO_VARIANT_PLAN_YEAR } from '../api/_lib/cy2027/tpmo.js';
import { yearlyReadiness, ROLLOVER_BLOCK_WINDOW_DAYS } from '../api/_lib/cy2027/yearly-readiness.js';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
/** Source scans look at CODE: comments are stripped so a comment cannot satisfy one. */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const at = (iso) => new Date(iso);

// ── 1. The plan-year clock ───────────────────────────────────────────────────
ok('the CY2027 start constant is the general rule applied to 2027', marketingStartUtc(2027) === CY2027_MARKETING_START_UTC);
ok('marketing for a plan year opens 1 October of the year before, 04:00 UTC',
  new Date(marketingStartUtc(2028)).toISOString() === '2027-10-01T04:00:00.000Z' &&
  new Date(marketingStartUtc(2031)).toISOString() === '2030-10-01T04:00:00.000Z');
for (const [iso, year] of [
  ['2026-01-15T12:00:00Z', 2026],
  ['2026-10-01T03:59:59Z', 2026],
  ['2026-10-01T04:00:00Z', 2027],
  ['2027-01-01T00:00:00Z', 2027],
  ['2027-10-01T03:59:59Z', 2027],
  ['2027-10-01T04:00:00Z', 2028],
  ['2028-06-30T12:00:00Z', 2028],
  ['2028-10-01T04:00:00Z', 2029],
  ['2031-12-31T23:59:59Z', 2032],
]) {
  ok(`the plan year at ${iso} is ${year}`, activePlanYear(at(iso)) === year, 'got ' + activePlanYear(at(iso)));
}
ok('the clock does not answer 2027 forever (the defect this suite exists for)',
  activePlanYear(at('2027-10-01T04:00:00Z')) !== 2027 && activePlanYear(at('2029-03-01T00:00:00Z')) !== 2027);
ok('a string instant is read the same way', activePlanYear('2027-10-02T00:00:00Z') === 2028);
ok('an unreadable clock is NaN, never a year',
  Number.isNaN(activePlanYear(new Date(NaN))) && Number.isNaN(activePlanYear('not a date')));

// ── 2. Resolving the ruleset for a year ──────────────────────────────────────
const IN_2027 = at('2026-11-01T12:00:00Z');
const AFTER_ROLLOVER = at('2027-10-01T04:00:00Z');
{
  const r = resolveRuleset(null, IN_2027, {});
  ok('during CY2027 the 2027 ruleset resolves', r.ok === true && r.ruleset === CMS_RULESET_2027);
  ok('and says truthfully that nobody is on record as having promoted it', r.attestation === 'GRANDFATHERED_PENDING_OWNER');
}
{
  const r = resolveRuleset(null, AFTER_ROLLOVER, {});
  ok('the instant CY2028 marketing opens, the 2027 ruleset is NOT reused', r.ok === false && r.planYear === 2028);
  ok('the refusal names the state of the 2028 ruleset', r.reason === 'RULESET_NOT_ACTIVE' && r.status === 'PENDING_REVIEW' && r.humanReview === true);
}
ok('a year nobody has prepared is a refusal', resolveRuleset(null, at('2028-10-01T04:00:00Z'), {}).reason === 'RULESET_MISSING');
ok('an unreadable clock is a refusal with its own reason', resolveRuleset(null, new Date(NaN), {}).reason === 'CLOCK_UNREADABLE');
ok('the kill switch still comes first', resolveRuleset(2027, IN_2027, { CY2027_REGULATORY_KILL: '1' }).reason === 'REGULATORY_KILL_ENGAGED');
ok('the superseded year stays refused', resolveRuleset(2026, IN_2027, {}).reason === 'RULESET_NOT_ACTIVE');
ok('an explicit year may be a numeric string', resolveRuleset('2027', IN_2027, {}).ok === true);
for (const bad of ['constructor', '__proto__', 'toString', '2027 ', '20270', '', 2027.5, [2027], {}, true]) {
  ok('an explicit year of ' + JSON.stringify(bad) + ' is not coerced into a ruleset',
    resolveRuleset(bad, IN_2027, {}).ok === false);
}

// ── 3. The CY2028 placeholder carries no invented rule ───────────────────────
ok('2028 exists and is only PENDING_REVIEW', CMS_RULESET_2028.status === 'PENDING_REVIEW' && CMS_RULESET_2028.planYear === 2028);
ok('none of its SOA rules has a value', Object.values(CMS_RULESET_2028.soa).every((v) => v === null));
ok('nor its TPMO rules, nor its retention',
  Object.values(CMS_RULESET_2028.tpmo).every((v) => v === null) && CMS_RULESET_2028.retention === null);
ok('it has the same rule NAMES as 2027, so nothing can be forgotten when it is filled in',
  Object.keys(CMS_RULESET_2028.soa).join() === Object.keys(CMS_RULESET_2027.soa).join() &&
  Object.keys(CMS_RULESET_2028.tpmo).join() === Object.keys(CMS_RULESET_2027.tpmo).join());
ok('its start date is the marketing-start rule, not a second literal', CMS_RULESET_2028.effectiveFrom === '2027-10-01');
ok('it is frozen all the way down',
  [CMS_RULESET_2028, CMS_RULESET_2028.soa, CMS_RULESET_2028.tpmo, CMS_RULESET_2028.sources, CMS_RULESET_2028.sourceReviews, CMS_RULESET_2028.promotion].every(Object.isFrozen));
ok('asking for it by year is refused', resolveRuleset(2028, AFTER_ROLLOVER, {}).reason === 'RULESET_NOT_ACTIVE');
ok('the audit lookup still returns it, for explaining a record', rulesetForAudit(2028) === CMS_RULESET_2028 && rulesetForAudit('constructor') === null);

// ── 4. 2026 and 2027 rule VALUES are exactly what they were ───────────────────
// Digests computed from the commit before this change (78abcf4).
const pick = (r) => JSON.stringify({
  planYear: r.planYear, version: r.version, status: r.status, effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo,
  soa: r.soa, tpmo: r.tpmo, retention: r.retention, sources: r.sources,
});
const digest = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
ok('CMS_RULESET_2026 rule values are untouched',
  digest(pick(CMS_RULESET_2026)) === 'sha256:9e16f39d97a2a105ed153df017e32c87fb7c4798ef851bf64e59bbbf5b8e153d');
ok('CMS_RULESET_2027 rule values are untouched',
  digest(pick(CMS_RULESET_2027)) === 'sha256:1263df96cb1c682a842fd0259af6d241edc09e720ade7da1e3ffbd09f0c03e23');
ok('2026 still carries the 48-hour rule and 2027 still does not',
  CMS_RULESET_2026.soa.advanceWaitHours === 48 && CMS_RULESET_2027.soa.advanceWaitHours === 0);

// ── 5. The lifecycle: one step at a time, by a person ─────────────────────────
ok('the order is the spec\'s order',
  RULESET_LIFECYCLE.join('>') === 'PENDING_REVIEW>VERIFIED>STAGING_TESTED>PRODUCTION_ACTIVE>SUPERSEDED' && Object.isFrozen(RULESET_LIFECYCLE));
ok('state rulesets share the same lifecycle object', STATE_LIFECYCLE === RULESET_LIFECYCLE);
ok('each status has exactly one successor',
  nextRulesetStatus('PENDING_REVIEW') === 'VERIFIED' && nextRulesetStatus('VERIFIED') === 'STAGING_TESTED' &&
  nextRulesetStatus('STAGING_TESTED') === 'PRODUCTION_ACTIVE' && nextRulesetStatus('PRODUCTION_ACTIVE') === 'SUPERSEDED');
ok('nothing follows SUPERSEDED, an unknown status, or a non-string',
  [nextRulesetStatus('SUPERSEDED'), nextRulesetStatus('ACTIVE'), nextRulesetStatus('constructor'), nextRulesetStatus(null), nextRulesetStatus(['VERIFIED'])].every((v) => v === null));

const step = { from: 'PENDING_REVIEW', to: 'VERIFIED', actor: 'Maria Lopez', at: '2027-08-01T15:00:00Z', evidenceReference: 'review-2027-08-01' };
{
  const rec = recordRulesetTransition(step);
  ok('a single forward step by a named person is recorded, frozen',
    rec.from === 'PENDING_REVIEW' && rec.to === 'VERIFIED' && rec.actor === 'Maria Lopez' && Object.isFrozen(rec));
}
throws('a status cannot be skipped', () => recordRulesetTransition({ ...step, to: 'PRODUCTION_ACTIVE' }), /not a single forward step/);
throws('nor can a ruleset go backwards', () => recordRulesetTransition({ ...step, from: 'VERIFIED', to: 'PENDING_REVIEW' }), /not a single forward step/);
throws('nor stand still', () => recordRulesetTransition({ ...step, to: 'PENDING_REVIEW' }), /not a single forward step/);
throws('nothing leaves SUPERSEDED', () => recordRulesetTransition({ ...step, from: 'SUPERSEDED', to: 'PRODUCTION_ACTIVE' }), /not a single forward step/);
throws('an unknown status is refused', () => recordRulesetTransition({ ...step, from: 'DRAFT' }), /unknown status/);
for (const who of ['claude', 'AI-Agent', 'svc_bot', 'system', 'automation-1', 'workflow', 'gpt-5', '12345', '', '   ', null, undefined, ['Maria Lopez'], { toString() { return 'Maria Lopez'; } }]) {
  throws('a ruleset cannot be promoted by ' + (typeof who === 'string' ? JSON.stringify(who) : Object.prototype.toString.call(who)),
    () => recordRulesetTransition({ ...step, actor: who }), /named human/);
}
for (const when of ['2027-02-31T00:00:00Z', 'yesterday', '2027-08-01', '2027-08-01T15:00:00', '', null, 1785596400000]) {
  throws('a step needs a real UTC instant, not ' + JSON.stringify(when), () => recordRulesetTransition({ ...step, at: when }), /UTC instant/);
}
for (const ev of ['', '   ', null, undefined, 7]) {
  throws('a step needs evidence, not ' + JSON.stringify(ev), () => recordRulesetTransition({ ...step, evidenceReference: ev }), /evidence/);
}
throws('an empty call is refused', () => recordRulesetTransition(), /unknown status/);

// ── 6. "Is this a person?" has one implementation ────────────────────────────
ok('a named person is accepted', isHumanActor('Sawil Reyes') && humanActorProblem('  Maria Lopez ') === null);
ok('missing and non-string actors are named as missing',
  [undefined, null, '', '   ', 7, ['Ana'], {}].every((a) => humanActorProblem(a) === 'ACTOR_MISSING'));
ok('automation identities are named as not human',
  ['claude', 'AI-Agent', 'svc_bot', 'cron job', 'the assistant', 'api', '4821', '---'].every((a) => humanActorProblem(a) === 'ACTOR_NOT_HUMAN'));
{
  // The quarantine review (spec §13) must behave exactly as before the move.
  const task = buildSecurityReviewTask({ leadReference: 'lead_1', signals: ['REPEATED_MASS_SUBMISSION'] });
  const decide = (actor) => resolveSecurityReview(task, { actor, decision: 'CONFIRMED', reasonCode: 'VERIFIED_BY_PHONE' });
  ok('the quarantine review still accepts a named reviewer', decide('Sawil Reyes').reviewer === 'Sawil Reyes');
  throws('and still refuses an automated one, with the same message', () => decide('svc_bot'), /is not a human reviewer/);
  throws('and still refuses an empty one, with the same message', () => decide(''), /requires a human reviewer/);
}

// ── 7. Who made it active: attested, grandfathered, or nobody ─────────────────
const HUMAN_PROMOTION = Object.freeze({ promotedBy: 'Maria Lopez', promotedAt: '2027-09-15T14:00:00Z', evidenceReference: 'cy2028-review-pack' });
const NEW_ACTIVE = { planYear: 2028, version: 'CMS_RULESET_2028-v1.0', status: 'PRODUCTION_ACTIVE', sourceReviews: [] };
ok('the grandfathered list is exactly the five rulesets that predate the lifecycle',
  JSON.stringify(GRANDFATHERED_RULESET_VERSIONS) ===
    JSON.stringify(['CMS_RULESET_2026-v1.0', 'CMS_RULESET_2027-v1.0', 'NY-CY2027-v1.0', 'NJ-CY2027-v1.0', 'CT-CY2027-v1.0']) &&
  Object.isFrozen(GRANDFATHERED_RULESET_VERSIONS));
{
  // The list must describe reality: every entry is a real promoted ruleset, and
  // every promoted ruleset without a record is on it. No spare entries to hide in.
  const promoted = [CMS_RULESET_2026, CMS_RULESET_2027, CMS_RULESET_2028, ...Object.values(STATE_RULESETS)]
    .filter((r) => r.status === 'PRODUCTION_ACTIVE' || r.status === 'SUPERSEDED')
    .map((r) => r.version || r.stateRulesetVersion).sort();
  ok('it matches the rulesets that are actually promoted, one for one',
    JSON.stringify(promoted) === JSON.stringify(GRANDFATHERED_RULESET_VERSIONS.slice().sort()), promoted.join(','));
}
ok('the existing rulesets report the truth: grandfathered, owner attestation pending',
  [CMS_RULESET_2026, CMS_RULESET_2027, ...Object.values(STATE_RULESETS)].every((r) => rulesetAttestation(r) === 'GRANDFATHERED_PENDING_OWNER'));
ok('no reviewer was invented for any of them',
  [CMS_RULESET_2026, CMS_RULESET_2027, CMS_RULESET_2028, ...Object.values(STATE_RULESETS)].every((r) =>
    r.promotion && r.promotion.promotedBy === null && r.promotion.promotedAt === null && r.promotion.evidenceReference === null && Object.isFrozen(r.promotion)));
ok('a ruleset that has not been promoted has nothing to attest', rulesetAttestation(CMS_RULESET_2028) === 'NOT_APPLICABLE');
ok('a NEW ruleset marked active with no record is nobody\'s', rulesetAttestation(NEW_ACTIVE) === 'NOT_RECORDED');
ok('and may not be used', rulesetActivationProblem(NEW_ACTIVE) === 'RULESET_PROMOTION_NOT_RECORDED');
ok('with a complete human record it is attested and usable',
  rulesetAttestation({ ...NEW_ACTIVE, promotion: HUMAN_PROMOTION }) === 'ATTESTED' &&
  rulesetActivationProblem({ ...NEW_ACTIVE, promotion: HUMAN_PROMOTION }) === null);
for (const [label, promotion] of [
  ['an automated promoter', { ...HUMAN_PROMOTION, promotedBy: 'claude' }],
  ['no promoter', { ...HUMAN_PROMOTION, promotedBy: null }],
  ['an impossible instant', { ...HUMAN_PROMOTION, promotedAt: '2027-02-31T00:00:00Z' }],
  ['no instant', { ...HUMAN_PROMOTION, promotedAt: null }],
  ['no evidence', { ...HUMAN_PROMOTION, evidenceReference: '  ' }],
  ['a record that is not an object', 'Maria Lopez'],
  ['no record at all', undefined],
]) {
  ok('a new active ruleset with ' + label + ' is not attested',
    rulesetActivationProblem({ ...NEW_ACTIVE, promotion }) === 'RULESET_PROMOTION_NOT_RECORDED');
}
ok('a grandfathered version does not become "attested" through a bogus record',
  rulesetAttestation({ ...CMS_RULESET_2027, promotion: { ...HUMAN_PROMOTION, promotedBy: 'svc_bot' } }) === 'GRANDFATHERED_PENDING_OWNER');
ok('once the owner attests, it reads ATTESTED',
  rulesetAttestation({ ...CMS_RULESET_2027, promotion: HUMAN_PROMOTION }) === 'ATTESTED');
ok('a status that is not active is not usable whatever its record says',
  rulesetActivationProblem({ ...NEW_ACTIVE, status: 'STAGING_TESTED', promotion: HUMAN_PROMOTION }) === 'RULESET_NOT_ACTIVE' &&
  rulesetActivationProblem(null) === 'RULESET_UNRESOLVED' && rulesetActivationProblem('x') === 'RULESET_UNRESOLVED');
ok('evaluateRuleset refuses the unrecorded one by name',
  evaluateRuleset(NEW_ACTIVE, AFTER_ROLLOVER).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
  evaluateRuleset({ ...NEW_ACTIVE, promotion: HUMAN_PROMOTION }, AFTER_ROLLOVER).ok === true);
ok('the inventory shows the attestation and the next status of every ruleset',
  JSON.stringify(rulesetInventory().map((r) => [r.planYear, r.status, r.attestation, r.nextStatus])) === JSON.stringify([
    [2028, 'PENDING_REVIEW', 'NOT_APPLICABLE', 'VERIFIED'],
    [2027, 'PRODUCTION_ACTIVE', 'GRANDFATHERED_PENDING_OWNER', 'SUPERSEDED'],
    [2026, 'SUPERSEDED', 'GRANDFATHERED_PENDING_OWNER', null],
  ]));

// ── 8. Source review: unknown is reported, a passed date locks ───────────────
{
  const sr = sourceReviewStatus(CMS_RULESET_2027, IN_2027);
  ok('all five CY2027 sources are reported as having no verification on record',
    sr.unverified.length === 5 && sr.overdue.length === 0 && sr.malformed.length === 0);
  ok('unknown does not lock the workflow by itself', requiredSourceExpired(CMS_RULESET_2027, IN_2027) === false);
  ok('the sources are the ones the owner\'s specification lists, with their addresses',
    JSON.stringify(CMS_RULESET_2027.sourceReviews.map((s) => s.url)) === JSON.stringify([
      'https://www.cms.gov/files/document/cy2027-agent-broker-training-testing-guidelines-pdf.pdf',
      'https://www.cms.gov/newsroom/fact-sheets/contract-year-2027-medicare-advantage-part-d-final-rule',
      'https://public-inspection.federalregister.gov/2026-06600.pdf',
      'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-422/subpart-V',
      'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-423/subpart-V',
    ]));
  ok('no verification date, verifier or review date was invented',
    [CMS_RULESET_2026, CMS_RULESET_2027, CMS_RULESET_2028].every((r) =>
      r.sourceReviews.every((s) => s.verifiedOn === null && s.verifiedBy === null && s.reviewBy === null && Object.isFrozen(s)) && Object.isFrozen(r.sourceReviews)));
}
const withSources = (sourceReviews) => ({ ...NEW_ACTIVE, promotion: HUMAN_PROMOTION, sourceReviews });
const src = (over) => ({ name: 'CMS final rule', url: 'https://www.cms.gov/', verifiedOn: '2027-09-01', verifiedBy: 'Maria Lopez', reviewBy: '2028-09-30', ...over });
ok('a source inside its review date is fine', requiredSourceExpired(withSources([src()]), at('2028-03-01T00:00:00Z')) === false);
ok('on the last day of its review date it is still fine', requiredSourceExpired(withSources([src()]), at('2028-09-30T23:00:00Z')) === false);
ok('the day after, it has expired', requiredSourceExpired(withSources([src()]), at('2028-10-01T00:00:00Z')) === true);
ok('and the ruleset is refused with the named reason',
  evaluateRuleset(withSources([src()]), at('2028-10-01T00:00:00Z')).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
  evaluateRuleset(withSources([src()]), at('2028-03-01T00:00:00Z')).ok === true);
ok('one expired source among several is enough',
  sourceReviewStatus(withSources([src(), src({ name: 'CFR 422', reviewBy: '2027-12-31' })]), at('2028-03-01T00:00:00Z')).overdue.join() === 'CFR 422');
ok('a review date that is not a real date counts as expired, not as open-ended',
  requiredSourceExpired(withSources([src({ reviewBy: '2028-02-31' })]), at('2028-01-01T00:00:00Z')) === true &&
  requiredSourceExpired(withSources([src({ reviewBy: 'next year' })]), at('2028-01-01T00:00:00Z')) === true);
ok('nor does an unreadable verification date pass', requiredSourceExpired(withSources([src({ verifiedOn: 'last week' })]), at('2028-01-01T00:00:00Z')) === true);
ok('an entry that is not an object is not skipped', requiredSourceExpired(withSources([null]), at('2028-01-01T00:00:00Z')) === true);
ok('an unreadable clock cannot keep a dated source alive', requiredSourceExpired(withSources([src()]), new Date(NaN)) === true);
ok('a ruleset with no source list has nothing overdue', requiredSourceExpired({ ...NEW_ACTIVE }, IN_2027) === false && requiredSourceExpired(null, IN_2027) === false);

// ── 9. The marketing gate vouches only for the registered ruleset ─────────────
{
  const inst = createSoaInstance({
    soaId: 'soa_y1', appointmentId: 'appt_y1', appointmentAt: '2026-11-10T15:00:00Z', appointmentFormat: 'TELEPHONE',
    planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk', language: 'en', languageSource: 'BENEFICIARY_ELECTED',
    method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public', selectedCategories: ['MA_WITH_RX'],
    stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
  }).instance;
  const done = completeSoaInstance(inst, { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_1' });
  const appt = { appointmentId: 'appt_y1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
  ok('the registered 2027 ruleset opens the gate', marketingGate(done, appt, CMS_RULESET_2027, { env: {} }).allowed === true);
  ok('an identical-looking copy does not', marketingGate(done, appt, { ...CMS_RULESET_2027 }, { env: {} }).reason === 'RULESET_NOT_REGISTERED');
  ok('nor does a well-formed ruleset somebody made up',
    marketingGate({ ...done, planYear: 2028 }, appt,
      { planYear: 2028, version: 'CMS_RULESET_2028-v1.0', status: 'PRODUCTION_ACTIVE', promotion: HUMAN_PROMOTION,
        soa: { mustPrecedeAppointment: true, inPersonRequiresWritten: true } }, { env: {} }).reason === 'RULESET_NOT_REGISTERED');
  ok('the 2028 placeholder is refused as not active', marketingGate({ ...done, planYear: 2028 }, appt, CMS_RULESET_2028, { env: {} }).reason === 'RULESET_NOT_ACTIVE');
  ok('the superseded 2026 ruleset is still refused', marketingGate({ ...done, planYear: 2026 }, appt, CMS_RULESET_2026, { env: {} }).reason === 'RULESET_NOT_ACTIVE');
  {
    const unattested = Object.freeze({ planYear: 2028, version: 'CMS_RULESET_2028-v1.0', status: 'PRODUCTION_ACTIVE', sourceReviews: [] });
    const attested = Object.freeze({ ...unattested, promotion: HUMAN_PROMOTION });
    ok('a REGISTERED ruleset that nobody promoted is still not vouched for',
      rulesetVouchProblem(unattested, { 2028: unattested }) === 'RULESET_PROMOTION_NOT_RECORDED');
    ok('a registered one with a human promotion is', rulesetVouchProblem(attested, { 2028: attested }) === null);
    ok('a registered one that is not active is named as such',
      rulesetVouchProblem(CMS_RULESET_2028) === 'RULESET_NOT_ACTIVE' && rulesetVouchProblem(CMS_RULESET_2026) === 'RULESET_NOT_ACTIVE');
    ok('an unregistered one is named as such, whatever its record says',
      rulesetVouchProblem(attested) === 'RULESET_NOT_REGISTERED' && rulesetVouchProblem(null) === 'RULESET_NOT_REGISTERED');
    ok('the real 2027 ruleset is vouched for', rulesetVouchProblem(CMS_RULESET_2027) === null);
  }
  ok('isRegisteredRuleset is identity, not resemblance',
    isRegisteredRuleset(CMS_RULESET_2027) && isRegisteredRuleset(CMS_RULESET_2028) &&
    !isRegisteredRuleset({ ...CMS_RULESET_2027 }) && !isRegisteredRuleset(null) && !isRegisteredRuleset({ planYear: 'constructor' }));
}

// ── 10. State rulesets follow the same clock ─────────────────────────────────
ok('during CY2027 a state resolves without naming the year', resolveStateRuleset('NY', null, IN_2027).ok === true);
ok('after the rollover an omitted year means 2028, which no state has',
  ['NY', 'NJ', 'CT'].every((s) => {
    const r = resolveStateRuleset(s, null, AFTER_ROLLOVER);
    return r.ok === false && r.reason === 'RULESET_MISSING' && r.planYear === 2028;
  }));
ok('undefined is treated like null, not as "skip the check"', resolveStateRuleset('NY', undefined, AFTER_ROLLOVER).reason === 'RULESET_MISSING');
ok('asking a state for 2028 explicitly is refused', resolveStateRuleset('NJ', 2028, AFTER_ROLLOVER).reason === 'RULESET_MISSING');
ok('an unreadable clock is a refusal', resolveStateRuleset('CT', null, new Date(NaN)).reason === 'CLOCK_UNREADABLE');
ok('a non-integer explicit year is not coerced, and is reported as a year with no ruleset',
  resolveStateRuleset('NY', '2027', IN_2027).reason === 'RULESET_MISSING' && resolveStateRuleset('NY', 2027.5, IN_2027).reason === 'RULESET_MISSING');
{
  // The three registered state rulesets all pass today, so the rule is run here
  // against rulesets that must NOT pass.
  const NY = STATE_RULESETS.NY;
  const fresh = { ...NY, stateRulesetVersion: 'NY-CY2028-v1.0', planYear: 2028, effectiveFrom: '2027-10-01' };
  ok('the registered NY ruleset passes for its own year', evaluateStateRuleset(NY, 2027, IN_2027).ok === true);
  ok('a state ruleset for another year is a missing ruleset', evaluateStateRuleset(NY, 2028, AFTER_ROLLOVER).reason === 'RULESET_MISSING');
  ok('a state ruleset that is not active is refused',
    evaluateStateRuleset({ ...fresh, status: 'STAGING_TESTED' }, 2028, AFTER_ROLLOVER).reason === 'RULESET_NOT_ACTIVE');
  ok('a NEW state ruleset marked active with nobody on record is refused',
    evaluateStateRuleset(fresh, 2028, AFTER_ROLLOVER).reason === 'RULESET_PROMOTION_NOT_RECORDED');
  ok('with a human promotion it resolves',
    evaluateStateRuleset({ ...fresh, promotion: HUMAN_PROMOTION }, 2028, AFTER_ROLLOVER).ok === true);
  ok('before its effective date it is not yet effective',
    evaluateStateRuleset({ ...fresh, promotion: HUMAN_PROMOTION }, 2028, at('2027-09-01T00:00:00Z')).reason === 'RULESET_NOT_YET_EFFECTIVE');
  ok('after its end date it has expired',
    evaluateStateRuleset({ ...fresh, promotion: HUMAN_PROMOTION, effectiveTo: '2028-09-30' }, 2028, at('2028-10-02T00:00:00Z')).reason === 'RULESET_EXPIRED');
  ok('an unreadable clock is a refusal there too',
    evaluateStateRuleset({ ...fresh, promotion: HUMAN_PROMOTION }, 2028, new Date(NaN)).reason === 'CLOCK_UNREADABLE');
  ok('nothing is not a ruleset', evaluateStateRuleset(null, 2027, IN_2027).ok === false);
}
ok('every state ruleset carries a promotion record', Object.values(STATE_RULESETS).every((s) => s.promotion && Object.isFrozen(s.promotion)));

// ── 11. Readiness: what a person has to do, on either side of a rollover ──────
{
  const early = yearlyReadiness(IN_2027, {});
  ok('a year out, nothing blocks', early.blocks.length === 0, early.blocks.join(' | '));
  ok('but the missing attestation is said out loud', early.warns.some((w) => /CMS_RULESET_2027-v1\.0 is active with attestation GRANDFATHERED_PENDING_OWNER/.test(w)));
  ok('for the three state rulesets too', early.warns.filter((w) => /^state ruleset (NY|NJ|CT)-CY2027-v1\.0: attestation GRANDFATHERED_PENDING_OWNER$/.test(w)).length === 3);
  ok('and the unverified sources', early.warns.some((w) => /5 required source\(s\) have no verification on record/.test(w)));
  ok('and the rollover is announced with its date and the state of the next ruleset',
    early.warns.some((w) => /CY2028 marketing opens 2027-10-01 \(\d+ day\(s\)\); its ruleset is PENDING_REVIEW \(CMS_RULESET_2028-v0\.0\)/.test(w)));
}
{
  const edge = (iso) => yearlyReadiness(at(iso), {}).blocks.some((b) => /CY2028 marketing opens 2027-10-01/.test(b));
  ok('inside the window the rollover becomes a block', edge('2027-07-01T12:00:00Z') === true);
  ok(`the window is ${ROLLOVER_BLOCK_WINDOW_DAYS} days: the day before it opens is still a warning`, edge('2027-06-02T04:00:00Z') === false);
  ok('and the day it opens is a block', edge('2027-06-03T04:00:00Z') === true);
}
{
  const late = yearlyReadiness(at('2027-10-02T12:00:00Z'), {});
  ok('after the rollover, promoting is blocked until the CY2028 public wording is confirmed',
    late.blocks.some((b) => /plan year 2028 is in force but the newest TPMO wording on file is for CY2027/.test(b)));
  ok('and the locked SOA workflow is named, with the site said to be unaffected',
    late.warns.some((w) => /no ruleset can be resolved for plan year 2028 \(RULESET_NOT_ACTIVE\).*public site and lead capture are unaffected/.test(w)));
}
{
  const dated = (reviewBy) => ({
    planYear: 2027, version: 'CMS_RULESET_X', status: 'PRODUCTION_ACTIVE', promotion: HUMAN_PROMOTION,
    sourceReviews: [{ name: 'CMS final rule', url: 'https://www.cms.gov/', verifiedOn: '2026-10-01', verifiedBy: 'Maria Lopez', reviewBy }],
  });
  const withRule = (rs) => yearlyReadiness(IN_2027, {}, { rulesets: [rs], states: [] });
  ok('a source past its review date BLOCKS and names the source',
    withRule(dated('2026-10-15')).blocks.some((b) => /CMS_RULESET_X: source review overdue or unreadable — CMS final rule\./.test(b)));
  ok('a source inside its review date does not', withRule(dated('2027-09-30')).blocks.length === 0);
  ok('an unreadable review date blocks too', withRule(dated('soon')).blocks.some((b) => /source review overdue or unreadable/.test(b)));
  ok('a verified source is not listed as unverified', !withRule(dated('2027-09-30')).warns.some((w) => /no verification on record/.test(w)));
  ok('a superseded ruleset is not chased for reviews', withRule({ ...dated('2020-01-01'), status: 'SUPERSEDED' }).blocks.length === 0);
  const attestedState = { ...STATE_RULESETS.NY, promotion: HUMAN_PROMOTION };
  ok('an attested state ruleset raises no warning',
    !yearlyReadiness(IN_2027, {}, { rulesets: [], states: [attestedState] }).warns.some((w) => /^state ruleset/.test(w)));
  ok('an unattested one does',
    yearlyReadiness(IN_2027, {}, { rulesets: [], states: [STATE_RULESETS.NJ] }).warns.some((w) => /^state ruleset NJ-CY2027-v1\.0: attestation GRANDFATHERED_PENDING_OWNER$/.test(w)));
}
ok('an unreadable clock blocks rather than reporting all clear',
  yearlyReadiness(new Date(NaN), {}).blocks.length === 1 && yearlyReadiness(new Date(NaN), {}).oks.length === 0);
ok('with the kill switch on, the locked workflow is reported, not hidden',
  yearlyReadiness(IN_2027, { CY2027_REGULATORY_KILL: '1' }).warns.some((w) => /REGULATORY_KILL_ENGAGED/.test(w)));
{
  const r = rolloverStatus(IN_2027);
  ok('rolloverStatus gives the next year, its start and the days left',
    r.ok && r.planYear === 2027 && r.nextPlanYear === 2028 && r.nextMarketingStart === '2027-10-01T04:00:00.000Z' &&
    r.daysUntilRollover === 334 && r.nextRulesetStatus === 'PENDING_REVIEW' && r.nextRulesetReady === false);
  const r2 = rolloverStatus(at('2027-10-02T12:00:00Z'));
  ok('and says MISSING when the year after has not even been started', r2.nextPlanYear === 2029 && r2.nextRulesetStatus === 'MISSING' && r2.nextRulesetVersion === null);
  ok('and refuses an unreadable clock', rolloverStatus(new Date(NaN)).ok === false);
}

// ── 12. The public wording is reused knowingly, never silently ───────────────
ok('the newest wording on file is for CY2027', LATEST_TPMO_VARIANT_PLAN_YEAR === 2027);
ok('the site keeps rendering that wording after the rollover (it is never switched off)',
  activeContractYearVariant(at('2027-11-01T00:00:00Z')) === 'CY2027');
ok('which is exactly why a newer plan year must block a promote',
  yearlyReadiness(at('2027-11-01T00:00:00Z'), {}).blocks.some((b) => /newest TPMO wording on file is for CY2027/.test(b)) &&
  !yearlyReadiness(at('2027-09-30T00:00:00Z'), {}).blocks.some((b) => /newest TPMO wording/.test(b)));

// ── 13. Wiring that cannot be called from here (anchored, comment-stripped) ──
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
{
  const PREFLIGHT = strip(read('./cy2027-preflight.mjs'));
  ok('preflight prints what the readiness function says, unconditionally',
    /^[ \t]*const yearly = yearlyReadiness\(\);\s*^[ \t]*blocks\.push\(\.\.\.yearly\.blocks\);\s*^[ \t]*warns\.push\(\.\.\.yearly\.warns\);/m.test(PREFLIGHT));

  const CONTENT = strip(read('../src/lib/soaContent.ts'));
  const flag = (CONTENT.match(/^[ \t]*rulesetPromotionAttested: (true|false),/m) || [])[1];
  ok('the SOA workflow has a precondition for the human promotion', flag === 'true' || flag === 'false', 'not found');
  const pending = [CMS_RULESET_2027, ...Object.values(STATE_RULESETS)].some((r) => rulesetAttestation(r) !== 'ATTESTED');
  ok('and it cannot read true while any active ruleset is still unattested', !(pending && flag === 'true'));

  const FORM = strip(read('../src/components/SOAForm.tsx'));
  ok('the form no longer hard-codes a plan year', !/\b2027\b/.test(FORM) && !/\b2028\b/.test(FORM));
  ok('it reads the year from the calendar and resolves the state ruleset for THAT year',
    /^[ \t]*const planYear = useMemo\(\(\) => activePlanYear\(\), \[\]\);/m.test(FORM) &&
    /resolveStateRuleset\(residenceState, planYear\)/.test(FORM));
  ok('it submits that year', /^[ \t]*planYear,$/m.test(FORM));
  ok('and when no rules are in force it says so and points to a person',
    /^[ \t]*const rulesUnavailable = !!stateResolution && !stateResolution\.ok;/m.test(FORM) &&
    /\{rulesUnavailable && \(\s*<p role="status"[^>]*>\s*\{t\('rulesUnavailable', L\)\}\{AGENT\.agencyPhone\}/.test(FORM));

  const SIGN = strip(read('../api/sign-soa.js'));
  ok('the signing handler takes the plan year from the server clock', /^[ \t]*var rulesetRes = resolveRuleset\(null\);/m.test(SIGN));

  const TRUST = strip(read('../api/_lib/cy2027/trust.js'));
  ok('trust.js no longer carries its own copy of the automation pattern', !/claude\|gpt\|llm/.test(TRUST) && /humanActorProblem\(who\)/.test(TRUST));
}

if (failures.length) {
  console.error(`CY2027 YEARLY ENGINE: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

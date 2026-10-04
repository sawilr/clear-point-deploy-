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
  lifecycleChainProblem, sourceReviewProblem, EVIDENCE_REFERENCE_MAX_CHARS,
} from '../api/_lib/cy2027/ruleset-lifecycle.js';
import {
  humanActorProblem, isHumanActor, reviewerProblem, configuredReviewers, REVIEWERS_ENV, ACTOR_MAX_CHARS,
} from '../api/_lib/cy2027/actors.js';
import {
  STATE_RULESETS, resolveStateRuleset, evaluateStateRuleset, isRegisteredStateRuleset, resolveSigningRulesets, soaFormRules,
  RULESET_LIFECYCLE as STATE_LIFECYCLE,
} from '../api/_lib/cy2027/state-rules.js';
import { createSoaInstance, completeSoaInstance, marketingGate } from '../api/_lib/cy2027/soa-instance.js';
import { buildEvidenceRecord, verifyEvidence } from '../api/_lib/cy2027/evidence.js';
import { soaInstanceToFields, buildCustomFields } from '../api/_lib/cy2027/crm-fields.js';
import { resolveSecurityReview, buildSecurityReviewTask } from '../api/_lib/cy2027/trust.js';
import { activeContractYearVariant, LATEST_TPMO_VARIANT_PLAN_YEAR } from '../api/_lib/cy2027/tpmo.js';
import { yearlyReadiness, ROLLOVER_BLOCK_WINDOW_DAYS } from '../api/_lib/cy2027/yearly-readiness.js';
import { stripComments, bindingsAndWrites, identifierCounts, topLevelStatements } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const at = (iso) => new Date(iso);

// The people the owner has authorised to decide, for this run. Every human-only
// decision below is made by one of them — or is shown being refused.
process.env[REVIEWERS_ENV] = 'Maria Lopez, Sawil Reyes';
const withoutReviewers = (fn) => {
  const saved = process.env[REVIEWERS_ENV];
  delete process.env[REVIEWERS_ENV];
  try { return fn(); } finally { process.env[REVIEWERS_ENV] = saved; }
};

// Every refusal reason seen in this run, to be checked against the type declarations at the end.
const cmsReasons = new Set();
const stateReasons = new Set();
const cms = (r) => { if (r && r.ok === false) cmsReasons.add(r.reason); return r; };
const st = (r) => { if (r && r.ok === false) stateReasons.add(r.reason); return r; };

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
ok('null, a boolean, an object and an array are not clocks (they are not 1970)',
  [null, false, true, {}, [], ['2027-01-01T00:00:00Z'], '', () => 0].every((v) => Number.isNaN(activePlanYear(v))) &&
  activePlanYear(Date.parse('2027-01-01T00:00:00Z')) === 2027);

// ── 2. Resolving the ruleset for a year ──────────────────────────────────────
const IN_2027 = at('2026-11-01T12:00:00Z');
const AFTER_ROLLOVER = at('2027-10-01T04:00:00Z');
const IN_2028 = at('2028-03-01T00:00:00Z');
{
  const r = resolveRuleset(null, IN_2027, {});
  ok('during CY2027 the 2027 ruleset resolves', r.ok === true && r.ruleset === CMS_RULESET_2027);
  ok('and says truthfully that nobody is on record as having promoted it', r.attestation === 'GRANDFATHERED_PENDING_OWNER');
}
{
  const r = cms(resolveRuleset(null, AFTER_ROLLOVER, {}));
  ok('the instant CY2028 marketing opens, the 2027 ruleset is NOT reused', r.ok === false && r.planYear === 2028);
  ok('the refusal names the state of the 2028 ruleset', r.reason === 'RULESET_NOT_ACTIVE' && r.status === 'PENDING_REVIEW' && r.humanReview === true);
}
ok('a year nobody has prepared is a refusal', cms(resolveRuleset(null, at('2028-10-01T04:00:00Z'), {})).reason === 'RULESET_MISSING');
ok('an unreadable clock is a refusal with its own reason', cms(resolveRuleset(null, new Date(NaN), {})).reason === 'CLOCK_UNREADABLE');
ok('the kill switch still comes first', cms(resolveRuleset(2027, IN_2027, { CY2027_REGULATORY_KILL: '1' })).reason === 'REGULATORY_KILL_ENGAGED');
ok('the superseded year stays refused', cms(resolveRuleset(2026, IN_2027, {})).reason === 'RULESET_NOT_ACTIVE');
ok('an explicit year may be a numeric string', resolveRuleset('2027', IN_2027, {}).ok === true);
for (const bad of ['constructor', '__proto__', 'toString', '2027 ', '20270', '', 2027.5, [2027], {}, true]) {
  ok('an explicit year of ' + JSON.stringify(bad) + ' is not coerced into a ruleset',
    resolveRuleset(bad, IN_2027, {}).ok === false);
}

// AUDIT 2026-10-04 (red team) — naming the year did not exempt a ruleset from the
// calendar: CMS_RULESET_2027 resolved in 2029, before its own start, and against
// a clock nobody could read.
ok('an explicit year is still judged against the calendar: 2027 is not in force in 2029',
  cms(resolveRuleset(2027, at('2029-06-01T00:00:00Z'), {})).reason === 'RULESET_NOT_IN_FORCE' &&
  resolveRuleset('2027', at('2029-06-01T00:00:00Z'), {}).reason === 'RULESET_NOT_IN_FORCE');
ok('it stops being in force at the very instant the next plan year opens, not a second earlier',
  resolveRuleset(2027, AFTER_ROLLOVER, {}).reason === 'RULESET_NOT_IN_FORCE' &&
  resolveRuleset(2027, at('2027-10-01T03:59:59Z'), {}).ok === true);
ok('and is not yet effective before its own marketing opens',
  cms(resolveRuleset(2027, at('2026-10-01T03:59:59Z'), {})).reason === 'RULESET_NOT_YET_EFFECTIVE' &&
  resolveRuleset(2027, at('2026-10-01T04:00:00Z'), {}).ok === true);
ok('an explicit year against an unreadable clock is a refusal',
  resolveRuleset(2027, new Date(NaN), {}).reason === 'CLOCK_UNREADABLE' && resolveRuleset(2027, 'garbage', {}).reason === 'CLOCK_UNREADABLE' &&
  [null, false, {}, []].every((v) => resolveRuleset(2027, v, {}).reason === 'CLOCK_UNREADABLE' && resolveRuleset(null, v, {}).reason === 'CLOCK_UNREADABLE'));
ok('evaluateRuleset applies the same window to the object it is handed',
  evaluateRuleset(CMS_RULESET_2027, at('2029-06-01T00:00:00Z')).reason === 'RULESET_NOT_IN_FORCE' &&
  evaluateRuleset(CMS_RULESET_2027, at('2026-01-01T00:00:00Z')).reason === 'RULESET_NOT_YET_EFFECTIVE' &&
  evaluateRuleset(CMS_RULESET_2027, new Date(NaN)).reason === 'CLOCK_UNREADABLE' &&
  evaluateRuleset(CMS_RULESET_2027, IN_2027).ok === true);
ok('nothing is not a ruleset', cms(evaluateRuleset(null, IN_2027)).reason === 'RULESET_UNRESOLVED' && evaluateRuleset('x', IN_2027).reason === 'RULESET_UNRESOLVED');

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
  [CMS_RULESET_2028, CMS_RULESET_2028.soa, CMS_RULESET_2028.tpmo, CMS_RULESET_2028.sources, CMS_RULESET_2028.sourceReviews, CMS_RULESET_2028.promotion, CMS_RULESET_2028.transitions].every(Object.isFrozen));
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

// ── 5. The lifecycle: one step at a time, by an authorised reviewer ───────────
ok('the order is the spec\'s order',
  RULESET_LIFECYCLE.join('>') === 'PENDING_REVIEW>VERIFIED>STAGING_TESTED>PRODUCTION_ACTIVE>SUPERSEDED' && Object.isFrozen(RULESET_LIFECYCLE));
ok('state rulesets share the same lifecycle object', STATE_LIFECYCLE === RULESET_LIFECYCLE);
ok('each status has exactly one successor',
  nextRulesetStatus('PENDING_REVIEW') === 'VERIFIED' && nextRulesetStatus('VERIFIED') === 'STAGING_TESTED' &&
  nextRulesetStatus('STAGING_TESTED') === 'PRODUCTION_ACTIVE' && nextRulesetStatus('PRODUCTION_ACTIVE') === 'SUPERSEDED');
ok('nothing follows SUPERSEDED, an unknown status, or a non-string',
  [nextRulesetStatus('SUPERSEDED'), nextRulesetStatus('ACTIVE'), nextRulesetStatus('constructor'), nextRulesetStatus(null), nextRulesetStatus(['VERIFIED'])].every((v) => v === null));

const V2028 = 'CMS_RULESET_2028-v1.0';
const step = { rulesetVersion: V2028, from: 'PENDING_REVIEW', to: 'VERIFIED', actor: 'Maria Lopez', at: '2027-08-01T15:00:00Z', evidenceReference: 'review-2027-08-01' };
{
  const rec = recordRulesetTransition(step);
  ok('a single forward step by an authorised reviewer is recorded, frozen, and names its ruleset',
    rec.from === 'PENDING_REVIEW' && rec.to === 'VERIFIED' && rec.actor === 'Maria Lopez' && rec.rulesetVersion === V2028 && Object.isFrozen(rec));
}
throws('a status cannot be skipped', () => recordRulesetTransition({ ...step, to: 'PRODUCTION_ACTIVE' }), /not a single forward step/);
throws('nor can a ruleset go backwards', () => recordRulesetTransition({ ...step, from: 'VERIFIED', to: 'PENDING_REVIEW' }), /not a single forward step/);
throws('nor stand still', () => recordRulesetTransition({ ...step, to: 'PENDING_REVIEW' }), /not a single forward step/);
throws('nothing leaves SUPERSEDED', () => recordRulesetTransition({ ...step, from: 'SUPERSEDED', to: 'PRODUCTION_ACTIVE' }), /not a single forward step/);
throws('an unknown status is refused', () => recordRulesetTransition({ ...step, from: 'DRAFT' }), /unknown status/);
for (const version of [undefined, null, '', '  ', 7, ['CMS_RULESET_2028-v1.0'], 'a b', 'v', 'x'.repeat(65)]) {
  throws('a step must name the ruleset version it promotes, not ' + JSON.stringify(version),
    () => recordRulesetTransition({ ...step, rulesetVersion: version }), /name the ruleset version/);
}
for (const who of [
  'claude', 'AI-Agent', 'svc_bot', 'system', 'automation-1', 'workflow', 'gpt-5', '12345', '', '   ', null, undefined, ['Maria Lopez'], { toString() { return 'Maria Lopez'; } },
  'Sofía', 'Sofia', 'Emely', 'Clara', 'Zara', 'ChatGPT', 'Copilot', 'Gemini', 'chatbot', 'IA', 'OpenClaw', 'Hermes', 'webhook',
]) {
  throws('a ruleset cannot be promoted by ' + (typeof who === 'string' ? JSON.stringify(who) : Object.prototype.toString.call(who)),
    () => recordRulesetTransition({ ...step, actor: who }), /named human/);
}
throws('nor by a person the owner has not authorised', () => recordRulesetTransition({ ...step, actor: 'John Smith' }), /REVIEWER_NOT_AUTHORIZED/);
throws('nor by anybody while no reviewer is configured',
  () => withoutReviewers(() => recordRulesetTransition(step)), /REVIEWERS_NOT_CONFIGURED/);
for (const when of ['2027-02-31T00:00:00Z', 'yesterday', '2027-08-01', '2027-08-01T15:00:00', '', null, 1785596400000]) {
  throws('a step needs a real UTC instant, not ' + JSON.stringify(when), () => recordRulesetTransition({ ...step, at: when }), /UTC instant/);
}
for (const ev of ['', '   ', null, undefined, 7, 'x'.repeat(EVIDENCE_REFERENCE_MAX_CHARS + 1), 'two\nlines']) {
  throws('a step needs a short reference to its evidence, not ' + JSON.stringify(typeof ev === 'string' && ev.length > 40 ? ev.length + ' characters' : ev),
    () => recordRulesetTransition({ ...step, evidenceReference: ev }), /evidence/);
}
ok('a reference of exactly the maximum length is accepted',
  recordRulesetTransition({ ...step, evidenceReference: 'x'.repeat(EVIDENCE_REFERENCE_MAX_CHARS) }).evidenceReference.length === EVIDENCE_REFERENCE_MAX_CHARS);
throws('an empty call is refused', () => recordRulesetTransition(), /unknown status/);

// ── 6. "Is this a person?" and "may this person decide?" ─────────────────────
ok('a named person is accepted', isHumanActor('Sawil Reyes') && humanActorProblem('  Maria Lopez ') === null);
ok('missing and non-string actors are named as missing',
  [undefined, null, '', '   ', 7, ['Ana'], {}].every((a) => humanActorProblem(a) === 'ACTOR_MISSING'));
ok('automation identities are named as not human',
  ['claude', 'AI-Agent', 'svc_bot', 'cron job', 'the assistant', 'api', '4821', '---'].every((a) => humanActorProblem(a) === 'ACTOR_NOT_HUMAN'));
// AUDIT 2026-10-04 (red team) — the assistants themselves passed. One assertion
// per identity, so removing any one of them from the rule fails here.
for (const who of [
  'Sofía', 'Sofia', 'SOFÍA', 'Emely', 'Clara', 'Zara', ' zara ',
  'ChatGPT', 'chatgpt-4', 'Copilot', 'Gemini', 'OpenAI', 'Anthropic', 'chatbot', 'IA', 'la IA', 'OpenClaw', 'Hermes', 'webhook', 'Zapier', 'el asistente',
  'ai', 'bot', 'svc', 'service', 'system', 'sys', 'automation', 'auto', 'agent', 'robot', 'daemon', 'cron', 'job', 'worker', 'script', 'workflow',
  'assistant', 'claude', 'gpt', 'llm', 'machine', 'api',
]) {
  ok(`the identity ${JSON.stringify(who)} is not a person`, humanActorProblem(who) === 'ACTOR_NOT_HUMAN', String(humanActorProblem(who)));
}
ok('a person whose NAME contains an assistant\'s name is still a person',
  ['Clara Gómez', 'Sofía Martínez', 'Zara Ahmed', 'Emely Cruz', 'Maria Clara Lopez'].every((a) => humanActorProblem(a) === null));
ok('a name written in other letters is a name', ['李', 'Мария', 'José Ñandú', 'Ελένη'].every((a) => humanActorProblem(a) === null));
ok('a token is found whatever surrounds it, in any alphabet', humanActorProblem('Мария bot') === 'ACTOR_NOT_HUMAN' && humanActorProblem('李-ai') === 'ACTOR_NOT_HUMAN');
ok('an invisible character does not smuggle an identity past the rule',
  humanActorProblem('cl' + String.fromCharCode(0x200b) + 'aude') === 'ACTOR_NOT_HUMAN' &&
  humanActorProblem('Maria' + String.fromCharCode(0x202e) + ' Lopez') === 'ACTOR_NOT_HUMAN' &&
  humanActorProblem('Maria\tLopez') === 'ACTOR_NOT_HUMAN');
ok('nor do look-alike letters', humanActorProblem(String.fromCharCode(0xff43, 0xff4c, 0xff41, 0xff55, 0xff44, 0xff45)) === 'ACTOR_NOT_HUMAN');
{
  const env = { [REVIEWERS_ENV]: 'Maria Lopez, Sawil Reyes' };
  ok('an authorised reviewer may decide, however the name is cased or spaced',
    reviewerProblem('Maria Lopez', env) === null && reviewerProblem('  maria   LOPEZ ', env) === null && reviewerProblem('Sawil Reyes', env) === null);
  ok('a person who is not on the list may not', reviewerProblem('John Smith', env) === 'REVIEWER_NOT_AUTHORIZED' && reviewerProblem('Maria', env) === 'REVIEWER_NOT_AUTHORIZED');
  ok('an automated identity is refused as such before the list is even read',
    reviewerProblem('svc_bot', env) === 'ACTOR_NOT_HUMAN' && reviewerProblem('Sofía', env) === 'ACTOR_NOT_HUMAN' && reviewerProblem('', env) === 'ACTOR_MISSING');
  ok('with no list configured NOBODY may decide',
    [{}, { [REVIEWERS_ENV]: '' }, { [REVIEWERS_ENV]: ' , ; ' }, { [REVIEWERS_ENV]: 7 }, null, { OTHER: 'Maria Lopez' }]
      .every((e) => reviewerProblem('Maria Lopez', e) === 'REVIEWERS_NOT_CONFIGURED'));
  ok('a list held on the prototype is not a configured list',
    reviewerProblem('Maria Lopez', Object.create({ [REVIEWERS_ENV]: 'Maria Lopez' })) === 'REVIEWERS_NOT_CONFIGURED');
  ok('listing an assistant does not make it a reviewer',
    configuredReviewers({ [REVIEWERS_ENV]: 'claude, Sofía, svc_bot' }).length === 0 &&
    reviewerProblem('claude', { [REVIEWERS_ENV]: 'claude, Maria Lopez' }) === 'ACTOR_NOT_HUMAN' &&
    JSON.stringify(configuredReviewers({ [REVIEWERS_ENV]: 'claude; Maria Lopez\nSawil  Reyes' })) === JSON.stringify(['maria lopez', 'sawil reyes']));
  ok('an identity longer than a name is not one',
    reviewerProblem('M' + 'a'.repeat(ACTOR_MAX_CHARS), { [REVIEWERS_ENV]: 'M' + 'a'.repeat(ACTOR_MAX_CHARS) }) === 'ACTOR_NOT_HUMAN' &&
    reviewerProblem('M' + 'a'.repeat(ACTOR_MAX_CHARS - 1), { [REVIEWERS_ENV]: 'M' + 'a'.repeat(ACTOR_MAX_CHARS - 1) }) === null);
  ok('the default environment is the process environment', reviewerProblem('Maria Lopez') === null && withoutReviewers(() => reviewerProblem('Maria Lopez')) === 'REVIEWERS_NOT_CONFIGURED');
}
{
  // The quarantine review (spec §13) goes through the same two questions.
  const task = buildSecurityReviewTask({ leadReference: 'lead_1', signals: ['REPEATED_MASS_SUBMISSION'] });
  const decide = (actor) => resolveSecurityReview(task, { actor, decision: 'CONFIRMED', reasonCode: 'VERIFIED_BY_PHONE' });
  ok('the quarantine review accepts an authorised reviewer', decide('Sawil Reyes').reviewer === 'Sawil Reyes');
  throws('and still refuses an automated one, with the same message', () => decide('svc_bot'), /is not a human reviewer/);
  throws('and still refuses an empty one, with the same message', () => decide(''), /requires a human reviewer/);
  for (const who of ['Sofía', 'Emely', 'Clara', 'Zara', 'ChatGPT']) throws(`it refuses ${who}`, () => decide(who), /is not a human reviewer/);
  throws('it refuses a person the owner has not authorised', () => decide('John Smith'), /not authorised to decide \(REVIEWER_NOT_AUTHORIZED\)/);
  throws('and everybody while no reviewer is configured', () => withoutReviewers(() => decide('Sawil Reyes')), /REVIEWERS_NOT_CONFIGURED/);
}

// ── 7. Who made it active: the whole chain, grandfathered, or nobody ──────────
const chain = (version, base = '2027-09', over = {}) => RULESET_LIFECYCLE.slice(0, 3).map((from, i) => recordRulesetTransition({
  rulesetVersion: version, from, to: RULESET_LIFECYCLE[i + 1], actor: 'Maria Lopez', at: `${base}-1${i}T14:00:00Z`, evidenceReference: 'review-pack-' + i, ...over,
}));
const VERIFIED_SOURCE = Object.freeze({ name: 'CMS final rule', url: 'https://www.cms.gov/', verifiedOn: '2027-09-01', verifiedBy: 'Maria Lopez', reviewBy: '2028-09-30' });
const HUMAN_PROMOTION = Object.freeze({ promotedBy: 'Maria Lopez', promotedAt: '2027-09-15T14:00:00Z', evidenceReference: 'cy2028-review-pack' });
const NEW_ACTIVE = { planYear: 2028, version: V2028, status: 'PRODUCTION_ACTIVE', sourceReviews: [VERIFIED_SOURCE] };
const PROMOTED = Object.freeze({ ...NEW_ACTIVE, transitions: chain(V2028) });
const in2028 = { registered: false, now: IN_2028 };

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
const EXISTING = [CMS_RULESET_2026, CMS_RULESET_2027, ...Object.values(STATE_RULESETS)];
ok('the existing rulesets report the truth: grandfathered, owner attestation pending',
  EXISTING.every((r) => rulesetAttestation(r, { registered: true, now: IN_2027 }) === 'GRANDFATHERED_PENDING_OWNER'));
ok('grandfathering is the caller vouching for the OBJECT: without it, a listed version is nobody\'s',
  EXISTING.every((r) => rulesetAttestation(r, { now: IN_2027 }) === 'NOT_RECORDED' && rulesetAttestation(r) === 'NOT_RECORDED' &&
    rulesetAttestation(r, { registered: 'yes', now: IN_2027 }) === 'NOT_RECORDED'));
ok('no reviewer and no lifecycle step was invented for any of them',
  [CMS_RULESET_2026, CMS_RULESET_2027, CMS_RULESET_2028, ...Object.values(STATE_RULESETS)].every((r) =>
    r.promotion && r.promotion.promotedBy === null && r.promotion.promotedAt === null && r.promotion.evidenceReference === null && Object.isFrozen(r.promotion) &&
    Array.isArray(r.transitions) && r.transitions.length === 0 && Object.isFrozen(r.transitions)));
ok('a ruleset that has not been promoted has nothing to attest', rulesetAttestation(CMS_RULESET_2028, { registered: true, now: IN_2027 }) === 'NOT_APPLICABLE');
ok('a NEW ruleset marked active with nothing on record is nobody\'s — registered or not',
  rulesetAttestation(NEW_ACTIVE, in2028) === 'NOT_RECORDED' && rulesetAttestation(NEW_ACTIVE, { registered: true, now: IN_2028 }) === 'NOT_RECORDED');
ok('and may not be used', rulesetActivationProblem(NEW_ACTIVE, in2028) === 'RULESET_PROMOTION_NOT_RECORDED' &&
  rulesetActivationProblem(NEW_ACTIVE, { registered: true, now: IN_2028 }) === 'RULESET_PROMOTION_NOT_RECORDED');
// AUDIT 2026-10-04 (red team) — ONE promotion object used to make any ruleset ATTESTED.
ok('a promotion record alone no longer attests a new ruleset: the steps before it must be on record',
  rulesetAttestation({ ...NEW_ACTIVE, promotion: HUMAN_PROMOTION }, { registered: true, now: IN_2028 }) === 'NOT_RECORDED' &&
  rulesetActivationProblem({ ...NEW_ACTIVE, promotion: { ...HUMAN_PROMOTION, rulesetVersion: V2028 } }, { registered: true, now: IN_2028 }) === 'RULESET_PROMOTION_NOT_RECORDED');
ok('with every step on record it is attested and usable',
  lifecycleChainProblem(PROMOTED, IN_2028) === null && rulesetAttestation(PROMOTED, in2028) === 'ATTESTED' && rulesetActivationProblem(PROMOTED, in2028) === null);
{
  const steps = chain(V2028);
  const edit = (i, over) => steps.map((s, j) => (j === i ? { ...s, ...over } : s));
  const without = (i, key) => steps.map((s, j) => { if (j !== i) return s; const { [key]: _gone, ...rest } = s; return rest; });
  for (const [label, transitions, reason, now] of [
    ['no transitions at all', undefined, 'LIFECYCLE_NOT_RECORDED'],
    ['an empty list', [], 'LIFECYCLE_NOT_RECORDED'],
    ['a list that is not a list', { 0: steps[0], 1: steps[1], 2: steps[2], length: 3 }, 'LIFECYCLE_NOT_RECORDED'],
    ['only the final step (the old single promotion record)', [steps[2]], 'LIFECYCLE_INCOMPLETE'],
    ['the VERIFIED step missing', [steps[1], steps[2]], 'LIFECYCLE_INCOMPLETE'],
    ['a step too many', [...steps, steps[2]], 'LIFECYCLE_INCOMPLETE'],
    ['the steps in the wrong order', [steps[1], steps[0], steps[2]], 'LIFECYCLE_OUT_OF_ORDER'],
    ['a step that skips a status', edit(1, { to: 'PRODUCTION_ACTIVE' }), 'LIFECYCLE_OUT_OF_ORDER'],
    ['steps recorded for another ruleset', chain('CMS_RULESET_2029-v1.0'), 'LIFECYCLE_STEP_FOR_ANOTHER_RULESET'],
    ['one step recorded for another ruleset', edit(2, { rulesetVersion: 'ANYTHING' }), 'LIFECYCLE_STEP_FOR_ANOTHER_RULESET'],
    ['a step by automation', edit(0, { actor: 'svc_bot' }), 'LIFECYCLE_STEP_NOT_BY_A_REVIEWER'],
    ['a step by one of the assistants', edit(1, { actor: 'Sofía' }), 'LIFECYCLE_STEP_NOT_BY_A_REVIEWER'],
    ['a step by a person who is not authorised', edit(2, { actor: 'John Smith' }), 'LIFECYCLE_STEP_NOT_BY_A_REVIEWER'],
    ['a step by nobody', edit(2, { actor: null }), 'LIFECYCLE_STEP_NOT_BY_A_REVIEWER'],
    ['a step with an impossible instant', edit(1, { at: '2027-02-31T00:00:00Z' }), 'LIFECYCLE_INSTANT_INVALID'],
    ['a step dated before the one it follows', edit(2, { at: '2027-09-10T13:00:00Z' }), 'LIFECYCLE_NOT_CHRONOLOGICAL'],
    ['a step dated in the year 9999', edit(2, { at: '9999-01-01T00:00:00Z' }), 'LIFECYCLE_STEP_IN_THE_FUTURE'],
    ['steps that have not happened yet', steps, 'LIFECYCLE_STEP_IN_THE_FUTURE', at('2027-09-11T00:00:00Z')],
    ['a step with no evidence', edit(0, { evidenceReference: '  ' }), 'LIFECYCLE_EVIDENCE_MISSING'],
    ['a step with a document for a reference', edit(0, { evidenceReference: 'x'.repeat(EVIDENCE_REFERENCE_MAX_CHARS + 1) }), 'LIFECYCLE_EVIDENCE_MISSING'],
    ['a step with an extra field', edit(1, { note: 'trust me' }), 'LIFECYCLE_ENTRY_MALFORMED'],
    ['a step with a field left out', without(1, 'evidenceReference'), 'LIFECYCLE_ENTRY_MALFORMED'],
    ['a step that is not an object', [steps[0], 'VERIFIED->STAGING_TESTED', steps[2]], 'LIFECYCLE_ENTRY_MALFORMED'],
    ['a step that answers through a getter', [steps[0], steps[1], Object.defineProperty({ ...steps[2] }, 'actor', { get() { return 'Maria Lopez'; }, enumerable: true })], 'LIFECYCLE_ENTRY_MALFORMED'],
    ['an unreadable clock', steps, 'CLOCK_UNREADABLE', new Date(NaN)],
  ]) {
    const rs = transitions === undefined ? { ...NEW_ACTIVE } : { ...NEW_ACTIVE, transitions };
    const when = now || IN_2028;
    ok(`a new active ruleset with ${label} cannot show how it became active (${reason})`, lifecycleChainProblem(rs, when) === reason, String(lifecycleChainProblem(rs, when)));
    ok(`…so it is not attested and may not be used (${label})`,
      rulesetAttestation(rs, { registered: true, now: when }) === 'NOT_RECORDED' &&
      rulesetActivationProblem(rs, { registered: true, now: when }) === 'RULESET_PROMOTION_NOT_RECORDED' &&
      evaluateRuleset(rs, when).ok === false && resolveRuleset(2028, when, {}, { 2028: rs }).ok === false);
  }
  ok('a chain held on the prototype is not a chain', lifecycleChainProblem(Object.create({ ...PROMOTED }), IN_2028) === 'LIFECYCLE_NOT_RECORDED');
  ok('a clock that is null, a boolean or an object is unreadable, not 1970',
    [null, false, {}, []].every((v) => lifecycleChainProblem(PROMOTED, v) === 'CLOCK_UNREADABLE') && lifecycleChainProblem(PROMOTED, IN_2028.getTime()) === null &&
    lifecycleChainProblem(PROMOTED, '2028-03-01T00:00:00Z') === null);
  ok('the chain is judged on the day: steps recorded for a reviewer who is no longer authorised stop counting',
    withoutReviewers(() => lifecycleChainProblem(PROMOTED, IN_2028)) === 'LIFECYCLE_STEP_NOT_BY_A_REVIEWER');
  const superseded = { ...NEW_ACTIVE, status: 'SUPERSEDED', transitions: [...steps, recordRulesetTransition({ rulesetVersion: V2028, from: 'PRODUCTION_ACTIVE', to: 'SUPERSEDED', actor: 'Sawil Reyes', at: '2028-10-01T05:00:00Z', evidenceReference: 'cy2029-cutover' })] };
  ok('a superseded ruleset shows the step that superseded it too',
    rulesetAttestation(superseded, { now: at('2028-11-01T00:00:00Z') }) === 'ATTESTED' &&
    rulesetAttestation({ ...superseded, transitions: steps }, { now: at('2028-11-01T00:00:00Z') }) === 'NOT_RECORDED');
}
{
  // Grandfathering is IDENTITY with the registered object, never resemblance.
  const copy = { ...CMS_RULESET_2027 };
  const forged = { planYear: 2027, version: 'CMS_RULESET_2027-v1.0', status: 'PRODUCTION_ACTIVE', soa: { advanceWaitHours: 48, mustPrecedeAppointment: false, inPersonRequiresWritten: false }, sourceReviews: [] };
  ok('an identical-looking copy of the 2027 ruleset is not grandfathered',
    cms(evaluateRuleset(copy, IN_2027)).reason === 'RULESET_PROMOTION_NOT_RECORDED' && evaluateRuleset(CMS_RULESET_2027, IN_2027).ok === true);
  ok('nor is a made-up object that merely carries a listed version', evaluateRuleset(forged, IN_2027).reason === 'RULESET_PROMOTION_NOT_RECORDED');
  const nextVersion = Object.freeze({ ...CMS_RULESET_2027, version: 'CMS_RULESET_2027-v1.1' });
  ok('a REGISTERED ruleset whose version merely starts like a listed one is not grandfathered either',
    evaluateRuleset(nextVersion, IN_2027).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    resolveRuleset(null, IN_2027, {}, { 2027: nextVersion }).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    rulesetAttestation(nextVersion, { registered: true, now: IN_2027 }) === 'NOT_RECORDED');
  ok('the registry is consulted by own key and identity', isRegisteredRuleset(CMS_RULESET_2027) && !isRegisteredRuleset(copy) &&
    isRegisteredRuleset(copy, { 2027: copy }) && !isRegisteredRuleset(CMS_RULESET_2027, Object.create({ 2027: CMS_RULESET_2027 })));
  // The registry argument exists for this suite. It can make an object count as
  // REGISTERED for one call; it can never make it GRANDFATHERED — that is
  // identity with the five real objects and nothing else.
  ok('an injected registry cannot make a look-alike grandfathered',
    resolveRuleset(null, IN_2027, {}, { 2027: copy }).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    resolveRuleset(2027, IN_2027, {}, { 2027: forged }).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    rulesetVouchProblem(copy, { 2027: copy }, IN_2027) === 'RULESET_PROMOTION_NOT_RECORDED' &&
    rolloverStatus(at('2026-09-20T00:00:00Z'), { 2027: copy }).nextRulesetReady === false &&
    rolloverStatus(at('2026-09-20T00:00:00Z')).nextRulesetReady === true);

  // The owner's attestation of a grandfathered ruleset: one bound, dated, human statement.
  const attestation = { rulesetVersion: 'CMS_RULESET_2027-v1.0', promotedBy: 'Sawil Reyes', promotedAt: '2026-10-20T14:00:00Z', evidenceReference: 'owner-attestation-2026-10' };
  const attested = (promotion) => rulesetAttestation({ ...CMS_RULESET_2027, promotion }, { registered: true, now: IN_2027 });
  ok('once the owner attests a grandfathered ruleset, it says so — and says it is NOT a full lifecycle', attested(attestation) === 'GRANDFATHERED_OWNER_ATTESTED');
  for (const [label, promotion] of [
    ['an automated attester', { ...attestation, promotedBy: 'svc_bot' }],
    ['one of the assistants as attester', { ...attestation, promotedBy: 'Emely' }],
    ['an attester who is not authorised', { ...attestation, promotedBy: 'John Smith' }],
    ['no attester', { ...attestation, promotedBy: null }],
    ['an impossible instant', { ...attestation, promotedAt: '2026-02-31T00:00:00Z' }],
    ['no instant', { ...attestation, promotedAt: null }],
    ['an instant in the year 9999', { ...attestation, promotedAt: '9999-01-01T00:00:00Z' }],
    ['an instant one second in the future', { ...attestation, promotedAt: '2026-11-01T12:00:01Z' }],
    ['no evidence', { ...attestation, evidenceReference: '  ' }],
    ['no version named', { promotedBy: 'Sawil Reyes', promotedAt: '2026-10-20T14:00:00Z', evidenceReference: 'owner-attestation-2026-10' }],
    ['the version of another ruleset', { ...attestation, rulesetVersion: 'NY-CY2027-v1.0' }],
    ['an extra field', { ...attestation, note: 'x' }],
    ['a record that is not an object', 'Sawil Reyes'],
    ['no record at all', undefined],
  ]) {
    ok('a grandfathered ruleset with ' + label + ' stays PENDING, never attested', attested(promotion) === 'GRANDFATHERED_PENDING_OWNER', String(attested(promotion)));
  }
  ok('an attestation on an unreadable clock attests nothing',
    rulesetAttestation({ ...CMS_RULESET_2027, promotion: attestation }, { registered: true, now: new Date(NaN) }) === 'GRANDFATHERED_PENDING_OWNER');
  ok('the same attestation pasted onto an unregistered copy attests nothing',
    rulesetAttestation({ ...CMS_RULESET_2027, promotion: attestation }, { now: IN_2027 }) === 'NOT_RECORDED');
}
ok('a status that is not active is not usable whatever its record says',
  rulesetActivationProblem({ ...PROMOTED, status: 'STAGING_TESTED' }, in2028) === 'RULESET_NOT_ACTIVE' &&
  rulesetActivationProblem(null) === 'RULESET_UNRESOLVED' && rulesetActivationProblem('x') === 'RULESET_UNRESOLVED');
ok('evaluateRuleset refuses the unrecorded one by name and accepts the one with its chain',
  evaluateRuleset(NEW_ACTIVE, AFTER_ROLLOVER).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
  evaluateRuleset(PROMOTED, AFTER_ROLLOVER).ok === true && evaluateRuleset(PROMOTED, AFTER_ROLLOVER).attestation === 'ATTESTED');
ok('the inventory shows the attestation and the next status of every ruleset',
  JSON.stringify(rulesetInventory(IN_2027).map((r) => [r.planYear, r.status, r.attestation, r.nextStatus])) === JSON.stringify([
    [2028, 'PENDING_REVIEW', 'NOT_APPLICABLE', 'VERIFIED'],
    [2027, 'PRODUCTION_ACTIVE', 'GRANDFATHERED_PENDING_OWNER', 'SUPERSEDED'],
    [2026, 'SUPERSEDED', 'GRANDFATHERED_PENDING_OWNER', null],
  ]));

// ── 8. Source review: the kill condition ─────────────────────────────────────
{
  const sr = sourceReviewStatus(CMS_RULESET_2027, IN_2027);
  ok('all five CY2027 sources are reported as having no verification on record',
    sr.listed === 5 && sr.unverified.length === 5 && sr.overdue.length === 0 && sr.malformed.length === 0 && sr.unreadable === false);
  ok('for a grandfathered ruleset, unknown does not lock the workflow by itself',
    requiredSourceExpired(CMS_RULESET_2027, IN_2027) === false && sourceReviewProblem(CMS_RULESET_2027, { registered: true, now: IN_2027 }) === null);
  ok('that exception is for the registered object only', sourceReviewProblem(CMS_RULESET_2027, { now: IN_2027 }) === 'RULE_SOURCE_NOT_VERIFIED');
  ok('the sources are the ones the owner\'s specification lists, with their addresses',
    JSON.stringify(CMS_RULESET_2027.sourceReviews.map((s) => s.url)) === JSON.stringify([
      'https://www.cms.gov/files/document/cy2027-agent-broker-training-testing-guidelines-pdf.pdf',
      'https://www.cms.gov/newsroom/fact-sheets/contract-year-2027-medicare-advantage-part-d-final-rule',
      'https://public-inspection.federalregister.gov/2026-06600.pdf',
      'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-422/subpart-V',
      'https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-B/part-423/subpart-V',
    ]));
  ok('no verification date, verifier or review date was invented',
    [CMS_RULESET_2026, CMS_RULESET_2027, CMS_RULESET_2028, ...Object.values(STATE_RULESETS)].every((r) =>
      r.sourceReviews.every((s) => s.verifiedOn === null && s.verifiedBy === null && s.reviewBy === null && Object.isFrozen(s)) && Object.isFrozen(r.sourceReviews)));
}
const withSources = (sourceReviews) => (sourceReviews === undefined ? (({ sourceReviews: _gone, ...rest }) => rest)(PROMOTED) : { ...PROMOTED, sourceReviews });
const src = (over) => ({ ...VERIFIED_SOURCE, ...over });
const sourceProblem = (list, now = IN_2028) => sourceReviewProblem(withSources(list), { now });
ok('a source inside its review date is fine', requiredSourceExpired(withSources([src()]), IN_2028) === false && sourceProblem([src()]) === null);
ok('on the last day of its review date it is still fine', requiredSourceExpired(withSources([src()]), at('2028-09-30T23:00:00Z')) === false);
ok('the day after, it has expired', requiredSourceExpired(withSources([src()]), at('2028-10-01T00:00:00Z')) === true);
ok('and the ruleset is refused with the named reason',
  cms(evaluateRuleset(withSources([src()]), at('2028-10-01T00:00:00Z'))).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
  evaluateRuleset(withSources([src()]), IN_2028).ok === true);
ok('one expired source among several is enough',
  sourceReviewStatus(withSources([src(), src({ name: 'CFR 422', reviewBy: '2027-12-31' })]), IN_2028).overdue.join() === 'CFR 422');
ok('a review date that is not a real date counts as expired, not as open-ended',
  requiredSourceExpired(withSources([src({ reviewBy: '2028-02-31' })]), at('2028-01-01T00:00:00Z')) === true &&
  requiredSourceExpired(withSources([src({ reviewBy: 'next year' })]), at('2028-01-01T00:00:00Z')) === true);
ok('nor does an unreadable verification date pass', requiredSourceExpired(withSources([src({ verifiedOn: 'last week' })]), at('2028-01-01T00:00:00Z')) === true);
ok('an entry that is not an object is not skipped', requiredSourceExpired(withSources([null]), at('2028-01-01T00:00:00Z')) === true);
ok('an unreadable clock cannot keep a dated source alive', requiredSourceExpired(withSources([src()]), new Date(NaN)) === true);
// AUDIT 2026-10-04 (red team) — a verified source with no review-by date never
// expired, nobody looked at who verified it, and a ruleset naming no source at
// all had nothing that could expire.
for (const [label, entry] of [
  ['verified with no review-by date (verified for ever)', src({ reviewBy: null })],
  ['verified by automation', src({ verifiedBy: 'claude' })],
  ['verified by one of the assistants', src({ verifiedBy: 'Sofía' })],
  ['verified by nobody', src({ verifiedBy: null })],
  ['verified by a person who is not authorised', src({ verifiedBy: 'John Smith' })],
  ['verified on a date that has not come yet', src({ verifiedOn: '2099-05-01', reviewBy: '2099-12-31' })],
  ['verified tomorrow', src({ verifiedOn: '2028-03-02' })],
  ['a verifier named with no verification', src({ verifiedOn: null, verifiedBy: 'Maria Lopez', reviewBy: null })],
  ['no name', src({ name: '  ' })],
  ['an extra field', { ...src(), note: 'looked fine' }],
  ['a field left out', (({ verifiedBy: _gone, ...rest }) => rest)(src())],
  ['a getter for a field', Object.defineProperty({ ...src() }, 'reviewBy', { get() { return '2099-01-01'; }, enumerable: true })],
]) {
  const status = sourceReviewStatus(withSources([entry]), IN_2028);
  ok(`a source ${label} is not a record anyone can rely on`, status.malformed.length === 1 && requiredSourceExpired(withSources([entry]), IN_2028) === true, JSON.stringify(status));
  ok(`…and it locks the ruleset (${label})`, sourceProblem([entry]) === 'RULE_SOURCE_REVIEW_OVERDUE' && evaluateRuleset(withSources([entry]), IN_2028).ok === false);
}
ok('a verification dated today is accepted', sourceProblem([src({ verifiedOn: '2028-03-01' })]) === null);
for (const [label, list] of [['a string', 'x'], ['an array-like object', { 0: src(), length: 1 }], ['null', null], ['a number', 5]]) {
  ok(`a source list that is ${label} cannot be read, and locks`,
    sourceReviewStatus(withSources(list), IN_2028).unreadable === true && requiredSourceExpired(withSources(list), IN_2028) === true &&
    cms(evaluateRuleset(withSources(list), IN_2028)).reason === 'RULE_SOURCES_MISSING');
}
ok('a ruleset that went through the lifecycle and names NO source has nothing that could expire, and is refused',
  sourceProblem([]) === 'RULE_SOURCES_MISSING' && sourceProblem(undefined) === 'RULE_SOURCES_MISSING' &&
  evaluateRuleset(withSources([]), IN_2028).reason === 'RULE_SOURCES_MISSING' && evaluateRuleset(withSources(undefined), IN_2028).reason === 'RULE_SOURCES_MISSING');
ok('nor may it leave a source unverified',
  sourceProblem([src(), src({ name: 'CFR 423', verifiedOn: null, verifiedBy: null, reviewBy: null })]) === 'RULE_SOURCE_NOT_VERIFIED' &&
  cms(evaluateRuleset(withSources([src({ verifiedOn: null, verifiedBy: null, reviewBy: null })]), IN_2028)).reason === 'RULE_SOURCE_NOT_VERIFIED');
ok('absent and empty lists have nothing overdue (the reporting function says only what it sees)',
  requiredSourceExpired(withSources([]), IN_2027) === false && requiredSourceExpired(withSources(undefined), IN_2027) === false && requiredSourceExpired(null, IN_2027) === false &&
  sourceReviewStatus(Object.create({ sourceReviews: 'x' }), IN_2027).unreadable === false);
// What the owner will actually write into the 2027 ruleset's sources — and let lapse.
const datedSources = (reviewBy) => CMS_RULESET_2027.sourceReviews.map((s) => ({ ...s, verifiedOn: '2026-10-05', verifiedBy: 'Maria Lopez', reviewBy }));
ok('a GRANDFATHERED ruleset whose source review has lapsed is locked like any other (spec §22 kill condition)',
  sourceReviewProblem({ ...CMS_RULESET_2027, sourceReviews: datedSources('2026-10-20') }, { registered: true, now: IN_2027 }) === 'RULE_SOURCE_REVIEW_OVERDUE' &&
  sourceReviewProblem({ ...CMS_RULESET_2027, sourceReviews: datedSources('2027-09-30') }, { registered: true, now: IN_2027 }) === null &&
  sourceReviewProblem({ ...CMS_RULESET_2027, sourceReviews: 'x' }, { registered: true, now: IN_2027 }) === 'RULE_SOURCES_MISSING' &&
  sourceReviewProblem({ ...CMS_RULESET_2027, sourceReviews: [] }, { registered: true, now: IN_2027 }) === null);
// The same sources on a 2027 ruleset that went through the lifecycle, registered for the call: what the resolver and the gate are shown below.
const V2027B = 'CMS_RULESET_2027-v1.1';
const LAPSED_2027 = Object.freeze({ ...CMS_RULESET_2027, version: V2027B, transitions: chain(V2027B, '2026-10'), sourceReviews: datedSources('2026-10-20') });
const CURRENT_2027 = Object.freeze({ ...CMS_RULESET_2027, version: V2027B, transitions: chain(V2027B, '2026-10'), sourceReviews: datedSources('2027-09-30') });
ok('the resolver refuses a ruleset whose source review has lapsed, by default and by explicit year, and hands out a current one',
  resolveRuleset(null, IN_2027, {}, { 2027: LAPSED_2027 }).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
  resolveRuleset(2027, IN_2027, {}, { 2027: LAPSED_2027 }).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
  resolveRuleset(null, IN_2027, {}, { 2027: CURRENT_2027 }).ok === true && resolveRuleset(null, IN_2027, {}, { 2027: CURRENT_2027 }).attestation === 'ATTESTED');

// ── 9. The marketing gate refuses whenever the resolver would ─────────────────
{
  const instanceInput = {
    soaId: 'soa_y1', appointmentId: 'appt_y1', appointmentAt: '2026-11-10T15:00:00Z', appointmentFormat: 'TELEPHONE',
    planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk', language: 'en', languageSource: 'BENEFICIARY_ELECTED',
    method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public', selectedCategories: ['MA_WITH_RX'],
    cmsRulesetVersion: 'CMS_RULESET_2027-v1.0', stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
  };
  const inst = createSoaInstance(instanceInput).instance;
  const done = completeSoaInstance(inst, { completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:x', evidenceReference: 'ev_1' });
  const appt = { appointmentId: 'appt_y1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
  const gate = (instance, appointment, ruleset, opts = {}) => marketingGate(instance, appointment, ruleset, { env: {}, now: IN_2027, ...opts });
  ok('the registered 2027 ruleset opens the gate', gate(done, appt, CMS_RULESET_2027).allowed === true);
  ok('an identical-looking copy does not', gate(done, appt, { ...CMS_RULESET_2027 }).reason === 'RULESET_NOT_REGISTERED');
  ok('nor does a well-formed ruleset somebody made up',
    gate({ ...done, planYear: 2028 }, appt,
      { planYear: 2028, version: V2028, status: 'PRODUCTION_ACTIVE', transitions: chain(V2028), sourceReviews: [VERIFIED_SOURCE],
        soa: { mustPrecedeAppointment: true, inPersonRequiresWritten: true } }, { now: IN_2028 }).reason === 'RULESET_NOT_REGISTERED');
  ok('the 2028 placeholder is refused as not active', gate({ ...done, planYear: 2028 }, appt, CMS_RULESET_2028).reason === 'RULESET_NOT_ACTIVE');
  ok('the superseded 2026 ruleset is still refused', gate({ ...done, planYear: 2026 }, appt, CMS_RULESET_2026).reason === 'RULESET_NOT_ACTIVE');
  {
    const unattested = Object.freeze({ ...NEW_ACTIVE });
    ok('a REGISTERED ruleset that nobody promoted is still not vouched for',
      rulesetVouchProblem(unattested, { 2028: unattested }, IN_2028) === 'RULESET_PROMOTION_NOT_RECORDED');
    ok('a registered one with its whole chain and verified sources is', rulesetVouchProblem(PROMOTED, { 2028: PROMOTED }, IN_2028) === null);
    ok('a registered one that is not active is named as such',
      rulesetVouchProblem(CMS_RULESET_2028, undefined, IN_2027) === 'RULESET_NOT_ACTIVE' && rulesetVouchProblem(CMS_RULESET_2026, undefined, IN_2027) === 'RULESET_NOT_ACTIVE');
    ok('an unregistered one is named as such, whatever its record says',
      rulesetVouchProblem(PROMOTED, undefined, IN_2028) === 'RULESET_NOT_REGISTERED' && rulesetVouchProblem(null, undefined, IN_2027) === 'RULESET_NOT_REGISTERED');
    ok('the real 2027 ruleset is vouched for while it is in force', rulesetVouchProblem(CMS_RULESET_2027, undefined, IN_2027) === null);
  }
  ok('isRegisteredRuleset is identity, not resemblance',
    isRegisteredRuleset(CMS_RULESET_2027) && isRegisteredRuleset(CMS_RULESET_2028) &&
    !isRegisteredRuleset({ ...CMS_RULESET_2027 }) && !isRegisteredRuleset(null) && !isRegisteredRuleset({ planYear: 'constructor' }));

  // AUDIT 2026-10-04 (red team) — the gate asked only "registered and active?". The
  // calendar and the kill condition lived in the resolver alone. Each case below
  // is run through BOTH, and they must agree.
  for (const [label, now, reason] of [
    ['the instant CY2028 marketing opens', AFTER_ROLLOVER, 'RULESET_NOT_IN_FORCE'],
    ['two years later', at('2029-03-01T00:00:00Z'), 'RULESET_NOT_IN_FORCE'],
    ['before CY2027 marketing opened', at('2026-09-30T12:00:00Z'), 'RULESET_NOT_YET_EFFECTIVE'],
    ['against an unreadable clock', new Date(NaN), 'CLOCK_UNREADABLE'],
  ]) {
    ok(`${label} the gate is closed under CMS_RULESET_2027 (${reason}), exactly as the resolver refuses it`,
      gate(done, appt, CMS_RULESET_2027, { now }).reason === reason && gate(done, appt, CMS_RULESET_2027, { now }).allowed === false &&
      rulesetVouchProblem(CMS_RULESET_2027, undefined, now) === reason && resolveRuleset(2027, now, {}).reason === reason);
  }
  ok('the last second of CY2027 is still CY2027', gate(done, appt, CMS_RULESET_2027, { now: at('2027-10-01T03:59:59Z') }).allowed === true);
  const doneB = { ...done, cmsRulesetVersion: V2027B };
  ok('a ruleset whose required source has lapsed closes the gate (the §22 kill condition), and a current one opens it',
    gate(doneB, appt, LAPSED_2027, { registry: { 2027: LAPSED_2027 } }).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
    rulesetVouchProblem(LAPSED_2027, { 2027: LAPSED_2027 }, IN_2027) === 'RULE_SOURCE_REVIEW_OVERDUE' &&
    gate(doneB, appt, CURRENT_2027, { registry: { 2027: CURRENT_2027 } }).allowed === true &&
    gate(doneB, appt, CURRENT_2027, { registry: { 2027: CURRENT_2027 }, now: at('2027-10-01T00:00:00Z') }).reason === 'RULE_SOURCE_REVIEW_OVERDUE');
  ok('an injected registry cannot make a copy of the real ruleset open the gate',
    gate(done, appt, { ...CMS_RULESET_2027 }, { registry: { 2027: { ...CMS_RULESET_2027 } } }).reason === 'RULESET_NOT_REGISTERED' &&
    (() => { const copy = { ...CMS_RULESET_2027 }; return gate(done, appt, copy, { registry: { 2027: copy } }).reason; })() === 'RULESET_PROMOTION_NOT_RECORDED');
  ok('the gate\'s clock is a clock: null is not 1970', [null, false, {}].every((v) => gate(done, appt, CMS_RULESET_2027, { now: v }).reason === 'CLOCK_UNREADABLE'));
  ok('a registered ruleset nobody promoted closes the gate',
    (() => { const rs = Object.freeze({ ...CMS_RULESET_2027, version: 'CMS_RULESET_2027-v1.1' }); return gate({ ...done, cmsRulesetVersion: rs.version }, appt, rs, { registry: { 2027: rs } }).reason; })() === 'RULESET_PROMOTION_NOT_RECORDED');
  for (const [label, startsAt, reason] of [
    ['in March 2029', '2029-03-10T15:00:00Z', 'APPOINTMENT_OUTSIDE_PLAN_YEAR'],
    ['at the first instant of CY2028', '2027-10-01T04:00:00Z', 'APPOINTMENT_OUTSIDE_PLAN_YEAR'],
    ['before CY2027 marketing opened', '2026-09-30T15:00:00Z', 'APPOINTMENT_OUTSIDE_PLAN_YEAR'],
    ['at no readable time', 'whenever', 'APPOINTMENT_TIME_UNKNOWN'],
  ]) {
    ok(`an appointment ${label} is not one CMS_RULESET_2027 governs (${reason})`, gate(done, { ...appt, startsAt }, CMS_RULESET_2027).reason === reason);
  }
  ok('an appointment in the last second of CY2027 is', gate(done, { ...appt, startsAt: '2027-10-01T03:59:59Z' }, CMS_RULESET_2027).allowed === true);

  // Spec §22: "Every live SOA/call points to the exact ruleset version used at that date/time."
  ok('the instance names the CMS ruleset version it was signed under', inst.cmsRulesetVersion === 'CMS_RULESET_2027-v1.0');
  for (const [label, value, error] of [
    ['none', undefined, 'required'], ['an empty one', '', 'required'], ['one that is not a string', ['CMS_RULESET_2027-v1.0'], 'required'],
    ['one nobody registered', 'CMS_RULESET_2027-v9.9', 'not_the_ruleset_of_that_plan_year'],
    ['the version of another plan year', 'CMS_RULESET_2026-v1.0', 'not_the_ruleset_of_that_plan_year'],
  ]) {
    const r = createSoaInstance({ ...instanceInput, cmsRulesetVersion: value });
    ok(`an instance cannot be created with ${label} as its CMS ruleset version`, r.ok === false && r.errors.cmsRulesetVersion === error, JSON.stringify(r.errors || r));
  }
  ok('the version is checked against the plan year in the same input',
    createSoaInstance({ ...instanceInput, planYear: 2026, cmsRulesetVersion: 'CMS_RULESET_2026-v1.0' }).ok === true &&
    (createSoaInstance({ ...instanceInput, planYear: 2031 }).errors || {}).cmsRulesetVersion === 'not_the_ruleset_of_that_plan_year');
  ok('the gate refuses an SOA signed under another version of the ruleset, or under none',
    gate({ ...done, cmsRulesetVersion: 'CMS_RULESET_2027-v1.1' }, appt, CMS_RULESET_2027).reason === 'SOA_RULESET_VERSION_MISMATCH' &&
    gate((({ cmsRulesetVersion: _gone, ...rest }) => rest)(done), appt, CMS_RULESET_2027).reason === 'SOA_RULESET_VERSION_MISMATCH' &&
    gate({ ...done, cmsRulesetVersion: ['CMS_RULESET_2027-v1.0'] }, appt, CMS_RULESET_2027).reason === 'SOA_RULESET_VERSION_MISMATCH');
  {
    const args = { stateName: 'New York', signature: 'Jane Q Public', signedAt: '2026-11-10T14:00:00.000Z' };
    const built = buildEvidenceRecord(inst, args);
    ok('the evidence record names the CMS ruleset version', built.record.cmsRulesetVersion === 'CMS_RULESET_2027-v1.0' && verifyEvidence(built.record).ok === true);
    ok('and it is INSIDE the integrity hash: changing it changes the hash, and a tampered record no longer verifies',
      buildEvidenceRecord({ ...inst, cmsRulesetVersion: 'CMS_RULESET_2027-v1.1' }, args).integrityHash !== built.integrityHash &&
      verifyEvidence({ ...built.record, cmsRulesetVersion: 'CMS_RULESET_2027-v1.1' }).ok === false &&
      verifyEvidence((({ cmsRulesetVersion: _gone, ...rest }) => rest)(built.record)).ok === false);
    for (const missing of [undefined, null, '', 7]) {
      throws('evidence cannot be built for an instance whose CMS ruleset version is ' + JSON.stringify(missing),
        () => buildEvidenceRecord({ ...inst, cmsRulesetVersion: missing }, args), /SOA_CMS_RULESET_VERSION_MISSING/);
    }
    const flat = soaInstanceToFields(done);
    ok('the CRM field set carries it', flat.CMS_RULESET_VERSION === 'CMS_RULESET_2027-v1.0');
    ok('reported as unmapped until the owner creates the field, and written once its id is configured',
      buildCustomFields(flat, {}).unmapped.includes('CMS_RULESET_VERSION') &&
      buildCustomFields(flat, { CY2027_CRM_FIELD_IDS: JSON.stringify({ CMS_RULESET_VERSION: 'fld_cms' }) }).fields
        .some((f) => f.id === 'fld_cms' && f.key === 'contact.cms_ruleset_version' && f.value === 'CMS_RULESET_2027-v1.0'));
  }
}

// ── 10. State rulesets follow the same clock, the same chain, the same sources ─
ok('during CY2027 a state resolves without naming the year', resolveStateRuleset('NY', null, IN_2027).ok === true);
ok('after the rollover an omitted year means 2028, which no state has',
  ['NY', 'NJ', 'CT'].every((s) => {
    const r = st(resolveStateRuleset(s, null, AFTER_ROLLOVER));
    return r.ok === false && r.reason === 'RULESET_MISSING' && r.planYear === 2028;
  }));
ok('undefined is treated like null, not as "skip the check"', resolveStateRuleset('NY', undefined, AFTER_ROLLOVER).reason === 'RULESET_MISSING');
ok('asking a state for 2028 explicitly is refused', resolveStateRuleset('NJ', 2028, AFTER_ROLLOVER).reason === 'RULESET_MISSING');
ok('an unreadable clock is a refusal', st(resolveStateRuleset('CT', null, new Date(NaN))).reason === 'CLOCK_UNREADABLE');
ok('a non-integer explicit year is not coerced, and is reported as a year with no ruleset',
  resolveStateRuleset('NY', '2027', IN_2027).reason === 'RULESET_MISSING' && resolveStateRuleset('NY', 2027.5, IN_2027).reason === 'RULESET_MISSING');
ok('no state, a malformed state and an unsupported state keep their own reasons',
  st(resolveStateRuleset(null, 2027, IN_2027)).reason === 'NO_STATE' && st(resolveStateRuleset('ZZZZ', 2027, IN_2027)).reason === 'INVALID_STATE' &&
  st(resolveStateRuleset('FL', 2027, IN_2027)).reason === 'STATE_NOT_SUPPORTED');
// AUDIT 2026-10-04 (red team) — NY-CY2027 resolved for 2027 in 2029: naming the year skipped the calendar.
ok('naming the year does not exempt a state ruleset from the calendar',
  st(resolveStateRuleset('NY', 2027, at('2029-06-01T00:00:00Z'))).reason === 'RULESET_EXPIRED' &&
  resolveStateRuleset('NY', 2027, AFTER_ROLLOVER).reason === 'RULESET_EXPIRED' &&
  resolveStateRuleset('NY', 2027, at('2027-10-01T03:59:59Z')).ok === true);
ok('nor from the start of its plan year',
  st(resolveStateRuleset('NJ', 2027, at('2026-10-01T03:59:59Z'))).reason === 'RULESET_NOT_YET_EFFECTIVE' &&
  resolveStateRuleset('NJ', 2027, at('2026-10-01T04:00:00Z')).ok === true);
{
  // The three registered state rulesets all pass today, so the rule is run here
  // against rulesets that must NOT pass.
  const NY = STATE_RULESETS.NY;
  const V = 'NY-CY2028-v1.0';
  const stateSource = { name: 'Recording-consent position of record', url: null, verifiedOn: '2027-09-01', verifiedBy: 'Maria Lopez', reviewBy: '2028-09-30' };
  const fresh = { ...NY, stateRulesetVersion: V, planYear: 2028, effectiveFrom: '2027-10-01', transitions: [], sourceReviews: [stateSource] };
  const promoted = { ...fresh, transitions: chain(V) };
  ok('the registered NY ruleset passes for its own year', evaluateStateRuleset(NY, 2027, IN_2027).ok === true);
  ok('a copy of it does not: only the registered object is grandfathered',
    st(evaluateStateRuleset({ ...NY }, 2027, IN_2027)).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    evaluateStateRuleset({ ...NY, recordingNotice: { allPartyConsent: false } }, 2027, IN_2027).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    isRegisteredStateRuleset(NY) && !isRegisteredStateRuleset({ ...NY }) && !isRegisteredStateRuleset(null) &&
    !isRegisteredStateRuleset({ code: 'constructor' }) && !isRegisteredStateRuleset(NY, Object.create({ NY })));
  ok('a state ruleset for another year is a missing ruleset', evaluateStateRuleset(NY, 2028, AFTER_ROLLOVER).reason === 'RULESET_MISSING');
  ok('a state ruleset that is not active is refused',
    st(evaluateStateRuleset({ ...promoted, status: 'STAGING_TESTED' }, 2028, AFTER_ROLLOVER)).reason === 'RULESET_NOT_ACTIVE');
  ok('a NEW state ruleset marked active with nobody on record is refused',
    evaluateStateRuleset(fresh, 2028, AFTER_ROLLOVER).reason === 'RULESET_PROMOTION_NOT_RECORDED');
  ok('a single promotion record does not change that',
    evaluateStateRuleset({ ...fresh, promotion: { ...HUMAN_PROMOTION, rulesetVersion: V } }, 2028, AFTER_ROLLOVER).reason === 'RULESET_PROMOTION_NOT_RECORDED');
  ok('nor does a chain recorded for another ruleset',
    evaluateStateRuleset({ ...fresh, transitions: chain('NJ-CY2028-v1.0') }, 2028, AFTER_ROLLOVER).reason === 'RULESET_PROMOTION_NOT_RECORDED');
  ok('with its whole chain and a verified source it resolves', evaluateStateRuleset(promoted, 2028, AFTER_ROLLOVER).ok === true);
  ok('before its effective date it is not yet effective',
    evaluateStateRuleset(promoted, 2028, at('2027-09-20T00:00:00Z')).reason === 'RULESET_NOT_YET_EFFECTIVE' &&
    evaluateStateRuleset({ ...promoted, effectiveFrom: '2027-11-01' }, 2028, at('2027-10-15T00:00:00Z')).reason === 'RULESET_NOT_YET_EFFECTIVE' &&
    evaluateStateRuleset({ ...promoted, effectiveFrom: null }, 2028, at('2027-09-20T00:00:00Z')).reason === 'RULESET_NOT_YET_EFFECTIVE');
  ok('after its end date it has expired — a stated one, or the end of its plan year',
    evaluateStateRuleset({ ...promoted, effectiveTo: '2028-06-30' }, 2028, at('2028-07-02T00:00:00Z')).reason === 'RULESET_EXPIRED' &&
    evaluateStateRuleset({ ...promoted, sourceReviews: [{ ...stateSource, reviewBy: '2029-09-30' }] }, 2028, at('2028-10-02T00:00:00Z')).reason === 'RULESET_EXPIRED');
  ok('a stated date nobody can read is not "no limit"',
    evaluateStateRuleset({ ...promoted, effectiveFrom: 'soon' }, 2028, AFTER_ROLLOVER).reason === 'RULESET_NOT_YET_EFFECTIVE' &&
    evaluateStateRuleset({ ...promoted, effectiveTo: 'later' }, 2028, AFTER_ROLLOVER).reason === 'RULESET_EXPIRED');
  ok('an unreadable clock is a refusal there too', evaluateStateRuleset(promoted, 2028, new Date(NaN)).reason === 'CLOCK_UNREADABLE');
  ok('nothing is not a ruleset', evaluateStateRuleset(null, 2027, IN_2027).ok === false);
  ok('a state ruleset that went through the lifecycle answers for its sources like a CMS one',
    st(evaluateStateRuleset({ ...promoted, sourceReviews: [] }, 2028, AFTER_ROLLOVER)).reason === 'RULE_SOURCES_MISSING' &&
    st(evaluateStateRuleset({ ...promoted, sourceReviews: [{ ...stateSource, verifiedOn: null, verifiedBy: null, reviewBy: null }] }, 2028, AFTER_ROLLOVER)).reason === 'RULE_SOURCE_NOT_VERIFIED' &&
    st(evaluateStateRuleset(promoted, 2028, at('2028-10-01T00:00:00Z'))).reason === 'RULE_SOURCE_REVIEW_OVERDUE');
  const lapsedNY = { ...NY, sourceReviews: [{ ...NY.sourceReviews[0], verifiedOn: '2026-10-05', verifiedBy: 'Maria Lopez', reviewBy: '2026-10-20' }] };
  ok('a grandfathered state ruleset whose source review has lapsed is locked',
    sourceReviewProblem(lapsedNY, { registered: true, now: IN_2027 }) === 'RULE_SOURCE_REVIEW_OVERDUE' &&
    sourceReviewProblem(lapsedNY, { registered: true, now: at('2026-10-15T00:00:00Z') }) === null);
  const promoted2027 = Object.freeze({ ...NY, stateRulesetVersion: 'NY-CY2027-v1.1', transitions: chain('NY-CY2027-v1.1', '2026-10'), sourceReviews: lapsedNY.sourceReviews });
  ok('the state resolver refuses a registered ruleset whose source review has lapsed, with or without the year named',
    resolveStateRuleset('NY', 2027, IN_2027, { NY: promoted2027 }).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
    resolveStateRuleset('NY', null, IN_2027, { NY: promoted2027 }).reason === 'RULE_SOURCE_REVIEW_OVERDUE' &&
    resolveStateRuleset('NY', 2027, at('2026-10-15T00:00:00Z'), { NY: promoted2027 }).ok === true);
  ok('an injected registry cannot make a copy of a state ruleset grandfathered',
    resolveStateRuleset('NY', 2027, IN_2027, { NY: { ...NY } }).reason === 'RULESET_PROMOTION_NOT_RECORDED' &&
    resolveStateRuleset('NY', 2027, IN_2027, { NY }).ok === true && resolveStateRuleset('NJ', 2027, IN_2027, { NY }).reason === 'STATE_NOT_SUPPORTED' &&
    [null, false, {}].every((v) => resolveStateRuleset('NY', 2027, v).reason === 'CLOCK_UNREADABLE'));
}
ok('every state ruleset carries a promotion record, an (empty) list of steps and the one source it names for review',
  Object.values(STATE_RULESETS).every((s) => s.promotion && Object.isFrozen(s.promotion) && Object.isFrozen(s.transitions) &&
    s.sourceReviews.length === 1 && /^Recording-consent position of record for /.test(s.sourceReviews[0].name) && s.sourceReviews[0].url === null));

// ── 11. Readiness: what a person has to do, on either side of a rollover ──────
{
  const early = yearlyReadiness(IN_2027, {});
  ok('a year out, nothing blocks', early.blocks.length === 0, early.blocks.join(' | '));
  ok('but the missing attestation is said out loud', early.warns.some((w) => /CMS_RULESET_2027-v1\.0 is active with attestation GRANDFATHERED_PENDING_OWNER/.test(w)));
  ok('for the three state rulesets too', early.warns.filter((w) => /^state ruleset (NY|NJ|CT)-CY2027-v1\.0: attestation GRANDFATHERED_PENDING_OWNER$/.test(w)).length === 3);
  ok('and the unverified sources', early.warns.some((w) => /CMS_RULESET_2027-v1\.0: 5 required source\(s\) have no verification on record/.test(w)));
  ok('the state rulesets\' too', early.warns.filter((w) => /^(NY|NJ|CT)-CY2027-v1\.0: 1 required source\(s\) have no verification on record/.test(w)).length === 3);
  ok('and the rollover is announced with its date and the state of the next ruleset',
    early.warns.some((w) => /CY2028 marketing opens 2027-10-01 \(\d+ day\(s\)\); its ruleset is PENDING_REVIEW \(CMS_RULESET_2028-v0\.0\)/.test(w)));
  ok('with nobody authorised to decide, that is said too',
    early.warns.some((w) => /no reviewer is configured \(CY2027_REVIEWERS\)/.test(w)) &&
    !yearlyReadiness(IN_2027, { [REVIEWERS_ENV]: 'Maria Lopez' }).warns.some((w) => /no reviewer is configured/.test(w)) &&
    yearlyReadiness(IN_2027, { [REVIEWERS_ENV]: 'Maria Lopez' }).oks.some((o) => /1 authorised reviewer\(s\) configured/.test(o)));
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
    planYear: 2027, version: 'CMS_RULESET_X', status: 'PRODUCTION_ACTIVE',
    sourceReviews: [{ name: 'CMS final rule', url: 'https://www.cms.gov/', verifiedOn: '2026-10-01', verifiedBy: 'Maria Lopez', reviewBy }],
  });
  const withRule = (rs) => yearlyReadiness(IN_2027, {}, { rulesets: [rs], states: [] });
  ok('a source past its review date BLOCKS and names the source',
    withRule(dated('2026-10-15')).blocks.some((b) => /CMS_RULESET_X: source review overdue or unreadable — CMS final rule\./.test(b)));
  ok('a source inside its review date does not', withRule(dated('2027-09-30')).blocks.length === 0);
  ok('an unreadable review date blocks too', withRule(dated('soon')).blocks.some((b) => /source review overdue or unreadable/.test(b)));
  ok('a source list nobody can read blocks', withRule({ ...dated('2027-09-30'), sourceReviews: 'see wiki' }).blocks.some((b) => /CMS_RULESET_X: source review overdue or unreadable — its source list cannot be read/.test(b)));
  ok('a verified source is not listed as unverified', !withRule(dated('2027-09-30')).warns.some((w) => /no verification on record/.test(w)));
  ok('a superseded ruleset is not chased for reviews', withRule({ ...dated('2020-01-01'), status: 'SUPERSEDED' }).blocks.length === 0);
  const stateWarns = (state) => yearlyReadiness(IN_2027, {}, { rulesets: [], states: [state] }).warns.filter((w) => /^state ruleset/.test(w));
  ok('a state ruleset with its whole chain on record raises no attestation warning',
    stateWarns({ ...STATE_RULESETS.NY, transitions: chain('NY-CY2027-v1.0', '2026-10') }).length === 0);
  ok('a COPY of a registered one, with a promotion record pasted on, is reported as nobody\'s',
    stateWarns({ ...STATE_RULESETS.NY, promotion: { ...HUMAN_PROMOTION, rulesetVersion: 'NY-CY2027-v1.0', promotedAt: '2026-10-20T14:00:00Z' } }).join() === 'state ruleset NY-CY2027-v1.0: attestation NOT_RECORDED');
  ok('an unattested registered one says so',
    stateWarns(STATE_RULESETS.NJ).join() === 'state ruleset NJ-CY2027-v1.0: attestation GRANDFATHERED_PENDING_OWNER');
  ok('a state ruleset\'s lapsed source blocks like a CMS one',
    yearlyReadiness(IN_2027, {}, { rulesets: [], states: [{ ...STATE_RULESETS.CT, sourceReviews: [{ ...STATE_RULESETS.CT.sourceReviews[0], verifiedOn: '2026-10-05', verifiedBy: 'Maria Lopez', reviewBy: '2026-10-20' }] }] })
      .blocks.some((b) => /^CT-CY2027-v1\.0: source review overdue or unreadable — Recording-consent position of record for Connecticut/.test(b)));
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
  // AUDIT 2026-10-04 (red team) — "ready" was the activation rule alone. It is the
  // resolver's own answer AT THE ROLLOVER INSTANT now.
  const soon = at('2027-09-20T00:00:00Z');
  ok('a next-year ruleset is ready only if the resolver would hand it out the instant its year opens',
    rolloverStatus(soon, { 2028: PROMOTED }).nextRulesetReady === true && resolveRuleset(null, AFTER_ROLLOVER, {}, { 2028: PROMOTED }).ok === true);
  for (const [label, next] of [
    ['is merely marked PRODUCTION_ACTIVE', { ...NEW_ACTIVE }],
    ['has a source review that lapses before its year opens', { ...PROMOTED, sourceReviews: [src({ reviewBy: '2027-09-25' })] }],
    ['names no source', { ...PROMOTED, sourceReviews: [] }],
    ['is filed under the wrong year', { ...PROMOTED, planYear: 2029 }],
    ['has steps dated after its year opens', { ...NEW_ACTIVE, transitions: chain(V2028, '2027-10') }],
  ]) {
    const r3 = rolloverStatus(soon, { 2028: next });
    ok(`a next-year ruleset that ${label} is NOT ready`, r3.nextRulesetStatus === 'PRODUCTION_ACTIVE' && r3.nextRulesetReady === false);
  }
}

// ── 12. The public wording is reused knowingly, never silently ───────────────
ok('the newest wording on file is for CY2027', LATEST_TPMO_VARIANT_PLAN_YEAR === 2027);
ok('the site keeps rendering that wording after the rollover (it is never switched off)',
  activeContractYearVariant(at('2027-11-01T00:00:00Z')) === 'CY2027');
ok('which is exactly why a newer plan year must block a promote',
  yearlyReadiness(at('2027-11-01T00:00:00Z'), {}).blocks.some((b) => /newest TPMO wording on file is for CY2027/.test(b)) &&
  !yearlyReadiness(at('2027-09-30T00:00:00Z'), {}).blocks.some((b) => /newest TPMO wording/.test(b)));

// ── 13. The decisions the handlers make, called; and the handlers pinned to them ─
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
{
  // What a signature is taken under — on both sides of a rollover. There is no
  // fallback: when the year in force has no ruleset, there is no ruleset.
  const during = resolveSigningRulesets('NY', IN_2027, {});
  ok('during CY2027 a signature is taken under the 2027 CMS ruleset and that year\'s state ruleset',
    during.ok === true && during.ruleset === CMS_RULESET_2027 && during.stateRuleset === STATE_RULESETS.NY);
  ok('the instant CY2028 opens it is taken under NOTHING — last year\'s rules are not a fallback',
    JSON.stringify(resolveSigningRulesets('NY', AFTER_ROLLOVER, {})) === JSON.stringify({ ok: false, stage: 'CMS_RULESET', reason: 'RULESET_NOT_ACTIVE' }) &&
    JSON.stringify(resolveSigningRulesets('NY', at('2028-10-02T00:00:00Z'), {})) === JSON.stringify({ ok: false, stage: 'CMS_RULESET', reason: 'RULESET_MISSING' }));
  ok('the kill switch, an unreadable clock and an unsupported or missing state are each named',
    resolveSigningRulesets('NY', IN_2027, { CY2027_REGULATORY_KILL: '1' }).reason === 'REGULATORY_KILL_ENGAGED' &&
    resolveSigningRulesets('NY', new Date(NaN), {}).reason === 'CLOCK_UNREADABLE' &&
    JSON.stringify(resolveSigningRulesets('FL', IN_2027, {})) === JSON.stringify({ ok: false, stage: 'STATE_RULESET', reason: 'STATE_NOT_SUPPORTED' }) &&
    resolveSigningRulesets(null, IN_2027, {}).reason === 'NO_STATE' && resolveSigningRulesets(null, IN_2027, {}).stage === 'STATE_RULESET');
  ok('with no env argument it reads the process environment (the kill switch reaches it)', (() => {
    const saved = process.env.CY2027_REGULATORY_KILL;
    process.env.CY2027_REGULATORY_KILL = '1';
    try { return resolveSigningRulesets('NY', IN_2027).reason === 'REGULATORY_KILL_ENGAGED'; }
    finally { if (saved === undefined) delete process.env.CY2027_REGULATORY_KILL; else process.env.CY2027_REGULATORY_KILL = saved; }
  })());

  const SIGN_SRC = read('../api/sign-soa.js');
  const SIGN = stripComments(SIGN_SRC, 'api/sign-soa.js');
  const signIds = identifierCounts(SIGN_SRC, 'api/sign-soa.js');
  ok('the signing handler takes both rulesets from that one function, from the server clock',
    /^[ \t]*var rules = resolveSigningRulesets\(residenceState\);/m.test(SIGN) && signIds.get('resolveSigningRulesets') === 2);
  ok('and from nowhere else: each of the three variables has exactly one source',
    ['rules', 'ruleset', 'stateRuleset'].every((name) => bindingsAndWrites(SIGN_SRC, 'api/sign-soa.js', name) === 1),
    ['rules', 'ruleset', 'stateRuleset'].map((name) => name + '=' + bindingsAndWrites(SIGN_SRC, 'api/sign-soa.js', name)).join(' '));
  ok('it names no resolver, registry or ruleset of its own',
    ['resolveRuleset', 'resolveStateRuleset', 'evaluateRuleset', 'evaluateStateRuleset', 'rulesetForAudit', 'STATE_RULESETS', 'CMS_RULESET_2026', 'CMS_RULESET_2027', 'CMS_RULESET_2028']
      .every((name) => !signIds.has(name)));
  ok('and it records the version of the ruleset it resolved', /^[ \t]*cmsRulesetVersion: ruleset\.version,/m.test(SIGN));
}
{
  // What the SOA form may present — on both sides of a rollover.
  const during = soaFormRules('NY', IN_2027);
  ok('during CY2027 the form presents the NY ruleset for 2027',
    during.ruleset === STATE_RULESETS.NY && during.planYear === 2027 && during.rulesUnavailable === false && during.unsupported === false && during.reason === null);
  const after = soaFormRules('NY', AFTER_ROLLOVER);
  ok('after the rollover it presents NO ruleset and says the rules are unavailable — the registry is not a fallback',
    after.ruleset === null && after.rulesUnavailable === true && after.planYear === 2028 && after.reason === 'RULESET_MISSING');
  ok('"other state" is unsupported, not unavailable',
    JSON.stringify(soaFormRules('OTHER', IN_2027)) === JSON.stringify({ planYear: 2027, unsupported: true, ruleset: null, rulesUnavailable: false, reason: null }));
  ok('no state chosen yet presents nothing and reports nothing',
    ['', null, undefined].every((v) => { const r = soaFormRules(v, IN_2027); return r.ruleset === null && r.rulesUnavailable === false && r.unsupported === false; }));
  ok('a state outside the three, and an unreadable clock, present no ruleset',
    soaFormRules('FL', IN_2027).ruleset === null && soaFormRules('FL', IN_2027).rulesUnavailable === true && soaFormRules('FL', IN_2027).reason === 'STATE_NOT_SUPPORTED' &&
    soaFormRules('NY', new Date(NaN)).ruleset === null && soaFormRules('NY', new Date(NaN)).rulesUnavailable === true && soaFormRules('NY', new Date(NaN)).reason === 'CLOCK_UNREADABLE');

  const FORM_SRC = read('../src/components/SOAForm.tsx');
  const FORM = stripComments(FORM_SRC, 'src/components/SOAForm.tsx');
  const formIds = identifierCounts(FORM_SRC, 'src/components/SOAForm.tsx');
  ok('the form no longer hard-codes a plan year', !/\b2027\b/.test(FORM) && !/\b2028\b/.test(FORM));
  ok('it takes the year and the ruleset from that one function',
    /^[ \t]*const \{ planYear, ruleset, unsupported, rulesUnavailable \} = useMemo\(\(\) => soaFormRules\(residenceState\), \[residenceState\]\);/m.test(FORM));
  ok('and from nowhere else: each of the four has exactly one source',
    ['planYear', 'ruleset', 'unsupported', 'rulesUnavailable'].every((name) => bindingsAndWrites(FORM_SRC, 'src/components/SOAForm.tsx', name) === 1));
  ok('the registry is used for the two state names in the picker and nothing else',
    formIds.get('STATE_RULESETS') === 3 && /\{L === 'es' \? STATE_RULESETS\[code\]\.nameEs : STATE_RULESETS\[code\]\.name\}/.test(FORM) &&
    ['resolveStateRuleset', 'evaluateStateRuleset', 'activePlanYear', 'resolveRuleset', 'rulesetForAudit'].every((name) => !formIds.has(name)));
  ok('it submits that year', /^[ \t]*planYear,$/m.test(FORM));
  ok('and when no rules are in force it says so and points to a person',
    /\{rulesUnavailable && \(\s*<p role="status"[^>]*>\s*\{t\('rulesUnavailable', L\)\}\{AGENT\.agencyPhone\}/.test(FORM));
}
{
  const PREFLIGHT = topLevelStatements(read('./cy2027-preflight.mjs'), 'scripts/cy2027-preflight.mjs');
  const i = PREFLIGHT.indexOf('const yearly = yearlyReadiness();');
  ok('preflight runs the readiness function at its top level — not inside a block, a branch or a function',
    i > 0 && PREFLIGHT[i + 1] === 'blocks.push(...yearly.blocks);' && PREFLIGHT[i + 2] === 'warns.push(...yearly.warns);' && PREFLIGHT[i + 3] === 'oks.push(...yearly.oks);',
    PREFLIGHT.slice(Math.max(0, i), i + 4).join(' | '));
  ok('a statement wrapped in `if (false) { … }` is not a top-level statement (the check sees the wrapper)',
    !topLevelStatements('if (false) {\n  const yearly = yearlyReadiness();\n}\n', 'x.mjs').includes('const yearly = yearlyReadiness();') &&
    topLevelStatements('const yearly = yearlyReadiness();\n', 'x.mjs').includes('const yearly = yearlyReadiness();'));

  const CONTENT = stripComments(read('../src/lib/soaContent.ts'), 'src/lib/soaContent.ts');
  const flag = (CONTENT.match(/^[ \t]*rulesetPromotionAttested: (true|false),/m) || [])[1];
  ok('the SOA workflow has a precondition for the human promotion', flag === 'true' || flag === 'false', 'not found');
  const pending = [CMS_RULESET_2027, ...Object.values(STATE_RULESETS)]
    .some((r) => !['ATTESTED', 'GRANDFATHERED_OWNER_ATTESTED'].includes(rulesetAttestation(r, { registered: true, now: IN_2027 })));
  ok('and it cannot read true while any active ruleset is still unattested', pending === true && !(pending && flag === 'true'));

  const TRUST = stripComments(read('../api/_lib/cy2027/trust.js'), 'api/_lib/cy2027/trust.js');
  ok('trust.js carries no copy of the automation pattern: it asks the one implementation', !/claude\|gpt\|llm/.test(TRUST) && /reviewerProblem\(who\)/.test(TRUST));
}

// ── 14. Every reason a resolver gives is one its type declaration lists ───────
{
  const stateDts = read('../api/_lib/cy2027/state-rules.d.ts');
  const cmsDts = read('../api/_lib/cy2027/rulesets.d.ts');
  ok('the grid above reached every state refusal there is',
    ['NO_STATE', 'INVALID_STATE', 'STATE_NOT_SUPPORTED', 'RULESET_MISSING', 'RULESET_NOT_ACTIVE', 'RULESET_EXPIRED', 'RULESET_NOT_YET_EFFECTIVE',
      'CLOCK_UNREADABLE', 'RULESET_PROMOTION_NOT_RECORDED', 'RULE_SOURCES_MISSING', 'RULE_SOURCE_REVIEW_OVERDUE', 'RULE_SOURCE_NOT_VERIFIED']
      .every((reason) => stateReasons.has(reason)), [...stateReasons].join(','));
  for (const reason of stateReasons) ok(`state-rules.d.ts declares the reason ${reason}`, stateDts.includes(`'${reason}'`));
  ok('the grid above reached every CMS refusal there is',
    ['REGULATORY_KILL_ENGAGED', 'RULESET_MISSING', 'RULESET_UNRESOLVED', 'CLOCK_UNREADABLE', 'RULESET_NOT_ACTIVE', 'RULESET_PROMOTION_NOT_RECORDED',
      'RULESET_NOT_YET_EFFECTIVE', 'RULESET_NOT_IN_FORCE', 'RULE_SOURCES_MISSING', 'RULE_SOURCE_REVIEW_OVERDUE', 'RULE_SOURCE_NOT_VERIFIED']
      .every((reason) => cmsReasons.has(reason)), [...cmsReasons].join(','));
  for (const reason of cmsReasons) ok(`rulesets.d.ts declares the reason ${reason}`, cmsDts.includes(`'${reason}'`));
}

if (failures.length) {
  console.error(`CY2027 YEARLY ENGINE: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

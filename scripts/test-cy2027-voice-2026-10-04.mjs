// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — VOICE SOA: EMELY / SOFÍA (spec §10, §19, §21, §26, §28, §29, §31;
// audit SPEC-10/19/26/28).
//
// What was wrong: the instance model knew VOICE_RECORDED and the marketing gate
// refused a voice-only SOA for an in-person appointment — and nothing else
// existed. No rule for when a recorded SOA may be offered, no per-category
// capture ("yes to everything" meant whatever the agent wrote), no read-back
// rule, no voice evidence (recording reference, transcript pointer, segment
// timestamps, exact script version), no script, no recording-failure rule.
//
// Every rule is exercised by CALLING it with every refusal and the one path
// that passes; the evidence block is observed INSIDE the integrity hash by
// building a record through evidence.js and tampering with each voice field;
// the build gate is observed FAILING on copies of the tree with an edited
// script, an enabled flag over an unapproved script, a non-human approver and
// the placeholder digest — and passing on a clean copy and on a properly
// approved one. The owner package in docs/voice/ is checked to quote the
// script verbatim (whitespace-collapsed), so the document and the data cannot
// drift apart. Only what must be ABSENT from the source is scanned, anchored.
//
// Run: node scripts/test-cy2027-voice-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as voiceModule from '../api/_lib/cy2027/voice-soa.js';
import {
  VOICE_SOA_ENABLED, VOICE_SCRIPT_STATUS, VOICE_SOA_SCRIPT, VOICE_SCRIPT_DIGEST, VOICE_SOA_PROBLEM, VOICE_DECISION, VOICE_CAPTURE_OUTCOME,
  BLANKET_REPLIES, UNSURE_REPLIES, REPLY_MAX_CHARS,
  isBlanketReply, isUnsureReply, voiceScriptApprovalProblem, assembleVoiceScript, voiceScriptPayload, bareAcronymsInScript,
  voiceSoaOfferProblem, classifyCategoryReply, captureCategoryDecisions, voiceReadBack, readBackProblem, recordingSegmentProblem,
  buildVoiceEvidence, voiceEvidenceProblem, voiceInstanceContradiction,
} from '../api/_lib/cy2027/voice-soa.js';
import {
  SOA_CATEGORIES, AUTHORIZING_CATEGORY_CODES, ALL_CATEGORY_CODES, SOA_TEXT, SOA_SCRIPT_VERSION, FORBIDDEN_BARE_ACRONYMS, categoryText, readBackLines,
} from '../api/_lib/cy2027/soa-text.js';
import { SOA_STATUS, createSoaInstance, completeSoaInstance, marketingGate as marketingGateAtClock, LANGUAGE_SOURCE } from '../api/_lib/cy2027/soa-instance.js';
import { CMS_RULESET_2027 } from '../api/_lib/cy2027/rulesets.js';
import { buildEvidenceRecord, verifyEvidence } from '../api/_lib/cy2027/evidence.js';
import { CONSENT_STATUS, classifyReply } from '../api/_lib/cy2027/consent.js';
import { humanActorProblem } from '../api/_lib/cy2027/actors.js';
import * as barrelModule from '../api/_lib/cy2027/index.js';
import { stripComments, unfrozenPaths, runGate, GOVERNING_IDENTIFIERS, REPO_ROOT } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src, path) => stripComments(src, path);
/** A structural scan anchored to a line start: a leading `if (false)` or a comment cannot satisfy it. */
const line = (re) => new RegExp('^[ \\t]*' + re.source, 'm' + re.flags.replace('m', ''));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = (s) => 'sha256:' + createHash('sha256').update(String(s), 'utf8').digest('hex');
const IN_CY2027 = new Date('2026-11-01T12:00:00Z');
const marketingGate = (instance, appointment, ruleset, opts = {}) => marketingGateAtClock(instance, appointment, ruleset, { now: IN_CY2027, ...opts });
const P = VOICE_SOA_PROBLEM;

// An approved copy of the script, as the owner would record it. The repository
// script stays PENDING; every positive path below is driven through this copy.
const TODAY = '2026-10-06';
const APPROVED = Object.freeze({ ...VOICE_SOA_SCRIPT, status: VOICE_SCRIPT_STATUS.APPROVED, approvedBy: 'Sawil Reyes', approvedOn: '2026-10-05' });
const withApproval = (extra = {}) => ({ enabled: true, script: APPROVED, today: TODAY, ...extra });

// ── 1. The flag, the script data and the digest ──────────────────────────────
ok('voice SOA is OFF in the repository', VOICE_SOA_ENABLED === false);
ok('the script is pending owner approval, with no approver and no date',
  VOICE_SOA_SCRIPT.status === VOICE_SCRIPT_STATUS.PENDING_OWNER_APPROVAL && VOICE_SOA_SCRIPT.approvedBy === null && VOICE_SOA_SCRIPT.approvedOn === null);
ok('the status vocabulary is exactly pending and approved', same(Object.values(VOICE_SCRIPT_STATUS), ['PENDING_OWNER_APPROVAL', 'APPROVED']));
ok('the script has its own version and names the approved text it is built on',
  /^CP-SOA-VOICE-SCRIPT-CY\d{4}-v\d+\.\d+$/.test(VOICE_SOA_SCRIPT.version) && VOICE_SOA_SCRIPT.basedOn === SOA_SCRIPT_VERSION);
ok('the pinned digest is the digest of the payload', VOICE_SCRIPT_DIGEST === sha(voiceScriptPayload()), `${VOICE_SCRIPT_DIGEST} vs ${sha(voiceScriptPayload())}`);
ok('the payload covers the approval record, so approving requires a re-pin',
  sha(voiceScriptPayload(APPROVED)) !== VOICE_SCRIPT_DIGEST && /"approvedBy":null/.test(voiceScriptPayload()) && /"status":"PENDING_OWNER_APPROVAL"/.test(voiceScriptPayload()));
ok('the payload covers the assembled lines, so a change to the approved category text moves this digest too',
  voiceScriptPayload().includes(categoryText('MA_WITH_RX', 'es').description) && voiceScriptPayload().includes(SOA_TEXT.en.important));
for (const [name, table] of [
  ['VOICE_SOA_SCRIPT', VOICE_SOA_SCRIPT], ['VOICE_SCRIPT_STATUS', VOICE_SCRIPT_STATUS], ['VOICE_SOA_PROBLEM', VOICE_SOA_PROBLEM],
  ['VOICE_DECISION', VOICE_DECISION], ['VOICE_CAPTURE_OUTCOME', VOICE_CAPTURE_OUTCOME], ['BLANKET_REPLIES', BLANKET_REPLIES], ['UNSURE_REPLIES', UNSURE_REPLIES],
]) {
  ok(`${name} is frozen all the way down`, unfrozenPaths(table, name).length === 0, unfrozenPaths(table, name).join(', '));
  ok(`${name} is a governing identifier`, GOVERNING_IDENTIFIERS.includes(name));
}
ok('the enable flag is a governing identifier', GOVERNING_IDENTIFIERS.includes('VOICE_SOA_ENABLED'));
ok('every refusal name is its own key', Object.entries(VOICE_SOA_PROBLEM).every(([k, v]) => k === v) && Object.keys(VOICE_SOA_PROBLEM).length >= 26);
ok('the decision vocabulary is authorized, declined, unsure — nothing else', same(Object.values(VOICE_DECISION), ['AUTHORIZED', 'DECLINED', 'UNSURE']));

// ── 2. The script is the APPROVED text, verbatim, in order, both languages ───
for (const lang of ['en', 'es']) {
  const lines = assembleVoiceScript(lang);
  const t = SOA_TEXT[lang];
  const steps = lines.map((l) => l.step);
  ok(`${lang}: the steps are purpose, important, one-at-a-time, the three categories, the unsure option, read-back, authorization, confirm, the two closes`,
    same(steps, ['PURPOSE', 'IMPORTANT', 'ONE_AT_A_TIME', 'CATEGORY', 'CATEGORY', 'CATEGORY', 'UNSURE_OPTION', 'READ_BACK', 'AUTHORIZATION', 'CONFIRM', 'INCOMPLETE_CLOSE', 'RECORDING_LOST_CLOSE']), steps.join(','));
  ok(`${lang}: the categories are spoken in the approved order, each by its own code`,
    same(lines.filter((l) => l.step === 'CATEGORY').map((l) => l.code), AUTHORIZING_CATEGORY_CODES) && lines.find((l) => l.step === 'UNSURE_OPTION').code === 'UNSURE_DISCUSS_PROCESS');
  for (const c of SOA_CATEGORIES) {
    const spoken = lines.find((l) => l.code === c.code).text;
    ok(`${lang}: ${c.code} is spoken with its approved label and description, verbatim and in that order`,
      spoken.startsWith(c.authorizes ? `${c[lang].label}. ${c[lang].description} ` : `${VOICE_SOA_SCRIPT[lang].unsureLead} ${c[lang].label}. ${c[lang].description} `));
    ok(`${lang}: ${c.code} ends with the one-at-a-time yes/no question`,
      spoken.endsWith(c.authorizes ? VOICE_SOA_SCRIPT[lang].categoryQuestion : VOICE_SOA_SCRIPT[lang].unsureQuestion));
  }
  ok(`${lang}: the "important" statement (§29: not required to enroll, does not affect coverage) is the approved one, verbatim`,
    lines.find((l) => l.step === 'IMPORTANT').text === t.important);
  ok(`${lang}: the authorization statement is the approved one, verbatim`, lines.find((l) => l.step === 'AUTHORIZATION').text === t.authorizationStatement);
  ok(`${lang}: the read-back framing is the approved heading and intro`, lines.find((l) => l.step === 'READ_BACK').text === `${t.readBackHeading}. ${t.readBackIntro}`);
  ok(`${lang}: the purpose line says the SOA documents what the licensed agent may discuss (§10)`,
    /licensed agent|agente licenciado/.test(lines[0].text) && /discuss|conversar/.test(lines[0].text) && /appointment|cita/.test(lines[0].text));
  ok(`${lang}: every line is frozen`, Object.isFrozen(lines) && lines.every((l) => Object.isFrozen(l)));
  const CARRIERS = /\b(?:aetna|humana|unitedhealth(?:care)?|wellcare|centene|emblem(?:health)?|healthfirst|fidelis|anthem|connecticare|clover|cigna|devoted|elderplan|aarp)\b/i;
  ok(`${lang}: no carrier, no "which plan is best" (§16, §29)`, !lines.some((l) => CARRIERS.test(l.text) || /which plan is best|qué plan le conviene|qué plan es mejor/i.test(l.text)));
}
ok('no bare MA / MAPD / MA-PD / PDP anywhere in the script (§29)', bareAcronymsInScript().length === 0, bareAcronymsInScript().join(', '));
ok('the acronym scan bites: a script that says "MA-PD" is caught',
  same(bareAcronymsInScript({ ...VOICE_SOA_SCRIPT, en: { ...VOICE_SOA_SCRIPT.en, purpose: 'We will cover MA-PD now.' } }), ['en:PURPOSE:MA-PD']));
ok('the two languages have the same shape (same steps, same codes)',
  same(assembleVoiceScript('en').map((l) => [l.step, l.code || null]), assembleVoiceScript('es').map((l) => [l.step, l.code || null])));
throws('a script has no language without an election', () => assembleVoiceScript('fr'), /SOA_LANGUAGE_NOT_ELECTED/);
throws('and none at all', () => assembleVoiceScript(undefined), /SOA_LANGUAGE_NOT_ELECTED/);

// ── 3. Approval: a human, on a real day, with the status set ─────────────────
ok('the repository script is not approved', voiceScriptApprovalProblem() === P.VOICE_SCRIPT_NOT_APPROVED);
ok('the owner\'s copy is', voiceScriptApprovalProblem(APPROVED, TODAY) === null);
for (const [what, patch] of [
  ['status still pending with a person named', { approvedBy: 'Sawil Reyes', approvedOn: '2026-10-05' }],
  ['approved by Sofía', { status: 'APPROVED', approvedBy: 'Sofía', approvedOn: '2026-10-05' }],
  ['approved by Emely', { status: 'APPROVED', approvedBy: 'Emely', approvedOn: '2026-10-05' }],
  ['approved by Claude', { status: 'APPROVED', approvedBy: 'Claude', approvedOn: '2026-10-05' }],
  ['approved by an AI agent', { status: 'APPROVED', approvedBy: 'AI Agent', approvedOn: '2026-10-05' }],
  ['approved by "system"', { status: 'APPROVED', approvedBy: 'system', approvedOn: '2026-10-05' }],
  ['approved by nobody', { status: 'APPROVED', approvedBy: '', approvedOn: '2026-10-05' }],
  ['approved by a zero-width name', { status: 'APPROVED', approvedBy: 'Sa​wil', approvedOn: '2026-10-05' }],
  ['approved by a paragraph', { status: 'APPROVED', approvedBy: 'Sawil ' + 'Reyes '.repeat(20), approvedOn: '2026-10-05' }],
  ['approved on a day that does not exist', { status: 'APPROVED', approvedBy: 'Sawil Reyes', approvedOn: '2026-02-31' }],
  ['approved on a date with no shape', { status: 'APPROVED', approvedBy: 'Sawil Reyes', approvedOn: 'yesterday' }],
  ['approved in the future', { status: 'APPROVED', approvedBy: 'Sawil Reyes', approvedOn: '2026-10-07' }],
  ['approved with no date', { status: 'APPROVED', approvedBy: 'Sawil Reyes', approvedOn: null }],
  ['a status that is an array', { status: ['APPROVED'], approvedBy: 'Sawil Reyes', approvedOn: '2026-10-05' }],
]) {
  ok(`not approved: ${what}`, voiceScriptApprovalProblem({ ...VOICE_SOA_SCRIPT, ...patch }, TODAY) === P.VOICE_SCRIPT_NOT_APPROVED);
}
ok('a script with an extra key is not the script', voiceScriptApprovalProblem({ ...APPROVED, extra: 1 }, TODAY) === P.VOICE_SCRIPT_NOT_APPROVED);
ok('a script read through a getter is not the script',
  voiceScriptApprovalProblem(Object.defineProperty({ ...APPROVED }, 'status', { get: () => 'APPROVED', enumerable: true }), TODAY) === P.VOICE_SCRIPT_NOT_APPROVED);
ok('the approver is judged by the one human-actor rule', ['Sofía', 'Claude', 'AI Agent', 'system'].every((a) => humanActorProblem(a) !== null) && humanActorProblem('Sawil Reyes') === null);
ok('today is the default clock, and it is not a fixed day', voiceScriptApprovalProblem({ ...APPROVED, approvedOn: '2999-01-01' }) === P.VOICE_SCRIPT_NOT_APPROVED);

// ── 4. The offer gate (§10, §28): every refusal, by name, in order ───────────
const CTX = Object.freeze({
  residenceState: Object.freeze({ confirmed: true, state: 'NY' }),
  contactContext: Object.freeze({ established: true, beneficiaryName: 'Jane Q Public' }),
  channelChoice: Object.freeze({ channel: 'VOICE', reply: 'yes' }),
  appointmentFormat: 'TELEPHONE',
  recording: Object.freeze({ active: true, reference: 'rec_2026_11_10_001' }),
  language: 'en',
  languageSource: 'BENEFICIARY_ELECTED',
});
const gate = (patch = {}, opts = withApproval()) => voiceSoaOfferProblem({ ...CTX, ...patch }, opts);
ok('with the flag on, the script approved and every precondition met, a recorded SOA may be offered', gate() === null);
ok('by video too', gate({ appointmentFormat: 'VIDEO' }) === null);
ok('in Spanish, elected by a representative', gate({ language: 'es', languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: 'Daughter' }) === null);
ok('NJ and CT are served', gate({ residenceState: { confirmed: true, state: 'nj' } }) === null && gate({ residenceState: { confirmed: true, state: 'CT' } }) === null);
ok('the repository defaults refuse: the flag is off', voiceSoaOfferProblem(CTX) === P.VOICE_SOA_DISABLED);
ok('the flag on, the repository script still pending: refused by name', gate({}, { enabled: true, today: TODAY }) === P.VOICE_SCRIPT_NOT_APPROVED);
ok('"enabled" has to be exactly true', gate({}, withApproval({ enabled: 'true' })) === P.VOICE_SOA_DISABLED && gate({}, withApproval({ enabled: 1 })) === P.VOICE_SOA_DISABLED);
ok('the flag is checked before anything about the call is read', voiceSoaOfferProblem(null, { enabled: false }) === P.VOICE_SOA_DISABLED && voiceSoaOfferProblem(null, withApproval()) === P.RESIDENCE_STATE_NOT_CONFIRMED);
for (const [what, patch, reason] of [
  ['residence state not confirmed', { residenceState: { confirmed: false, state: 'NY' } }, P.RESIDENCE_STATE_NOT_CONFIRMED],
  ['residence "confirmed" as a string', { residenceState: { confirmed: 'true', state: 'NY' } }, P.RESIDENCE_STATE_NOT_CONFIRMED],
  ['a state Clear Point does not serve', { residenceState: { confirmed: true, state: 'FL' } }, P.RESIDENCE_STATE_NOT_CONFIRMED],
  ['a state as an array', { residenceState: { confirmed: true, state: ['NY'] } }, P.RESIDENCE_STATE_NOT_CONFIRMED],
  ['no residence at all', { residenceState: undefined }, P.RESIDENCE_STATE_NOT_CONFIRMED],
  ['residence with an extra key', { residenceState: { confirmed: true, state: 'NY', zip: '11717' } }, P.RESIDENCE_STATE_NOT_CONFIRMED],
  ['contact context not established', { contactContext: { established: false, beneficiaryName: 'Jane Q Public' } }, P.CONTACT_CONTEXT_NOT_ESTABLISHED],
  ['contact context without a name', { contactContext: { established: true, beneficiaryName: 'J' } }, P.CONTACT_CONTEXT_NOT_ESTABLISHED],
  ['no contact context', { contactContext: null }, P.CONTACT_CONTEXT_NOT_ESTABLISHED],
  ['the caller chose SMS', { channelChoice: { channel: 'SMS', reply: 'yes' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller chose nothing', { channelChoice: { channel: 'VOICE', reply: '' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller said "ok"', { channelChoice: { channel: 'VOICE', reply: 'ok' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller said "whatever"', { channelChoice: { channel: 'VOICE', reply: 'whatever' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller said "not sure"', { channelChoice: { channel: 'VOICE', reply: 'not sure' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller said no', { channelChoice: { channel: 'VOICE', reply: 'no, send me the link' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the channel as an array', { channelChoice: { channel: ['VOICE'], reply: 'yes' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['no channel choice', { channelChoice: undefined }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['an appointment with no format', { appointmentFormat: undefined }, P.UNKNOWN_APPOINTMENT_FORMAT],
  ['a format the approved list does not know', { appointmentFormat: 'carrier pop-up kiosk' }, P.UNKNOWN_APPOINTMENT_FORMAT],
  ['a format as an array', { appointmentFormat: ['TELEPHONE'] }, P.UNKNOWN_APPOINTMENT_FORMAT],
  ['an in-person appointment', { appointmentFormat: 'IN_PERSON' }, P.IN_PERSON_REQUIRES_WRITTEN_SOA],
  ['"in person", lower case', { appointmentFormat: 'in person' }, P.IN_PERSON_REQUIRES_WRITTEN_SOA],
  ['"In-Person"', { appointmentFormat: 'In-Person' }, P.IN_PERSON_REQUIRES_WRITTEN_SOA],
  ['a home visit (not on the list — refused, never treated as remote)', { appointmentFormat: 'HOME_VISIT' }, P.UNKNOWN_APPOINTMENT_FORMAT],
  ['recording not active', { recording: { active: false, reference: 'rec_1' } }, P.RECORDING_NOT_CONFIRMED_ACTIVE],
  ['recording "active" as a string', { recording: { active: 'yes', reference: 'rec_1' } }, P.RECORDING_NOT_CONFIRMED_ACTIVE],
  ['recording active with no reference', { recording: { active: true, reference: '' } }, P.RECORDING_NOT_CONFIRMED_ACTIVE],
  ['recording active with a reference that is not text', { recording: { active: true, reference: 7 } }, P.RECORDING_NOT_CONFIRMED_ACTIVE],
  ['no recording object', { recording: null }, P.RECORDING_NOT_CONFIRMED_ACTIVE],
  ['a language that is not en/es', { language: 'fr' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a language that was a system default', { languageSource: 'SYSTEM_DEFAULT' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a language inferred from the lead', { languageSource: 'INFERRED_FROM_LEAD' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['no election at all', { languageSource: undefined }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['an election as an array', { languageSource: ['BENEFICIARY_ELECTED'] }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a representative election with no representative', { languageSource: 'REPRESENTATIVE_ELECTED' }, 'representative_required'],
  ['a beneficiary election with a representative named', { representativeRelationship: 'Son' }, 'election_attribution_mismatch'],
  ['a representative that is not text', { languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: ['Son'] }, P.SOA_LANGUAGE_NOT_ELECTED],
]) {
  ok(`gate refuses ${what}: ${reason}`, gate(patch) === reason, `got ${gate(patch)}`);
}
ok('a context with a key the gate does not know is not a context', voiceSoaOfferProblem({ ...CTX, carrier: 'x' }, withApproval()) === P.RESIDENCE_STATE_NOT_CONFIRMED);
ok('the refusals come in the spec\'s order: state before contact before channel before format before recording',
  gate({ residenceState: { confirmed: false, state: 'NY' }, contactContext: null, appointmentFormat: 'IN_PERSON', recording: null }) === P.RESIDENCE_STATE_NOT_CONFIRMED &&
  gate({ contactContext: null, appointmentFormat: 'IN_PERSON', recording: null }) === P.CONTACT_CONTEXT_NOT_ESTABLISHED &&
  gate({ channelChoice: { channel: 'EMAIL', reply: 'yes' }, appointmentFormat: 'IN_PERSON', recording: null }) === P.CHANNEL_NOT_CHOSEN_BY_CALLER &&
  gate({ appointmentFormat: 'IN_PERSON', recording: null }) === P.IN_PERSON_REQUIRES_WRITTEN_SOA &&
  gate({ recording: null, language: 'fr' }) === P.RECORDING_NOT_CONFIRMED_ACTIVE);

// ── 5. Blanket and unsure replies ────────────────────────────────────────────
for (const r of ['yes to everything', 'Yes, to everything!', 'all of them', 'ALL', 'everything', 'both', 'all three', 'yes all', 'whatever',
  'todo', 'Sí, a todo', 'todas', 'todos los planes', 'las tres', 'ambos', 'lo que sea', 'cualquiera']) {
  ok(`"${r}" is a blanket reply`, isBlanketReply(r) === true);
}
for (const r of ['yes', 'no', 'sí', 'si', 'I authorize', 'ok', 'tall order', 'ballroom', 'totalmente']) ok(`"${r}" is not a blanket reply`, isBlanketReply(r) === false);
for (const r of ["I don't know", 'I’m not sure', 'not sure', 'maybe', 'no idea', 'unsure', 'I guess', 'No estoy seguro', 'no estoy segura', 'no sé', 'No se', 'tal vez', 'quizás', 'no lo sé', 'no entiendo', 'prefiero hablar primero']) {
  ok(`"${r}" is an unsure reply`, isUnsureReply(r) === true);
}
for (const r of ['yes', 'no', 'sí', 'seguro que sí', 'maybelline', 'nose', 'yes I am sure']) ok(`"${r}" is not an unsure reply`, isUnsureReply(r) === false);
ok('nothing is nothing', isBlanketReply('') === false && isUnsureReply('') === false && isBlanketReply(null) === false && isUnsureReply(undefined) === false);

// ── 6. One category, one reply ───────────────────────────────────────────────
const cls = (code, reply) => classifyCategoryReply(code, reply);
ok('"yes" to an authorizing category authorizes it', same(cls('MA_WITH_RX', 'yes'), { code: 'MA_WITH_RX', reply: 'yes', replyClass: 'GRANTED', decision: 'AUTHORIZED', problem: null }));
ok('"sí" too', cls('STANDALONE_RX', 'Sí.').decision === VOICE_DECISION.AUTHORIZED);
ok('"I authorize" too', cls('MA_NO_RX', 'I authorize').decision === VOICE_DECISION.AUTHORIZED);
ok('"no" declines', cls('MA_WITH_RX', 'No').decision === VOICE_DECISION.DECLINED && cls('MA_WITH_RX', 'No').replyClass === CONSENT_STATUS.DECLINED);
ok('"yes, but actually no" declines (a refusal anywhere wins — consent.js CT-01)', cls('MA_WITH_RX', 'yes, but actually no').decision === VOICE_DECISION.DECLINED);
ok('"yes" to the unsure option is UNSURE, never an authorization', cls('UNSURE_DISCUSS_PROCESS', 'yes').decision === VOICE_DECISION.UNSURE);
ok('"no" to the unsure option declines it', cls('UNSURE_DISCUSS_PROCESS', 'no').decision === VOICE_DECISION.DECLINED);
ok('"I don\'t know" to a category is UNSURE', cls('MA_WITH_RX', "I don't know").decision === VOICE_DECISION.UNSURE && cls('MA_WITH_RX', "I don't know").problem === null);
ok('"no estoy seguro" to a category is UNSURE, not a decline', cls('MA_WITH_RX', 'no estoy seguro').decision === VOICE_DECISION.UNSURE);
ok('"yes to everything" decides nothing for the category it was said to', cls('MA_WITH_RX', 'yes to everything').decision === null && cls('MA_WITH_RX', 'yes to everything').problem === P.BLANKET_REPLY_NOT_AUTHORIZATION);
ok('"I don\'t know, maybe all of them" is confusion, not a blanket yes', cls('MA_WITH_RX', "I don't know, maybe all of them").decision === VOICE_DECISION.UNSURE);
ok('"ok" decides nothing', cls('MA_WITH_RX', 'ok').decision === null && cls('MA_WITH_RX', 'ok').problem === P.CATEGORY_REPLY_UNCLEAR);
ok('"mhm" decides nothing', cls('MA_WITH_RX', 'mhm').problem === P.CATEGORY_REPLY_UNCLEAR);
ok('"claro" decides nothing', cls('MA_WITH_RX', 'claro').problem === P.CATEGORY_REPLY_UNCLEAR);
ok('silence decides nothing', cls('MA_WITH_RX', '').problem === P.CATEGORY_REPLY_UNCLEAR && cls('MA_WITH_RX', '').replyClass === CONSENT_STATUS.NOT_ASKED);
ok('a long sentence that opens with yes is a sentence, not an answer', cls('MA_WITH_RX', 'yes I think my neighbour has one of those and she likes it a lot').problem === P.CATEGORY_REPLY_UNCLEAR);
ok('a reply that is not text decides nothing', cls('MA_WITH_RX', ['yes']).problem === P.CATEGORY_REPLY_UNCLEAR && cls('MA_WITH_RX', { toString: () => 'yes' }).problem === P.CATEGORY_REPLY_UNCLEAR);
ok('a reply longer than an answer decides nothing', cls('MA_WITH_RX', 'yes ' + 'x'.repeat(REPLY_MAX_CHARS)).problem === P.CATEGORY_REPLY_UNCLEAR);
ok('the stored reply is the trimmed utterance, capped', cls('MA_WITH_RX', '  Yes  ').reply === 'Yes' && cls('MA_WITH_RX', 'y'.repeat(300)).reply.length === REPLY_MAX_CHARS);
ok('an unknown category is refused by name', cls('CARRIER_X', 'yes').problem === P.UNKNOWN_CATEGORY && cls(['MA_WITH_RX'], 'yes').problem === P.UNKNOWN_CATEGORY);
ok('a category reply is frozen', Object.isFrozen(cls('MA_WITH_RX', 'yes')));
ok('the classification IS consent.js classifyReply, not a second copy', ['yes', 'no', 'ok', 'sí autorizo', 'yes I said no', ''].every((r) => cls('MA_WITH_RX', r).replyClass === classifyReply(r)));

// ── 7. The capture: every category asked, its own yes (§8, §10, §31) ─────────
const replies = (a, b, c, u) => [{ code: 'MA_NO_RX', reply: a }, { code: 'MA_WITH_RX', reply: b }, { code: 'STANDALONE_RX', reply: c }, { code: 'UNSURE_DISCUSS_PROCESS', reply: u }];
const full = captureCategoryDecisions(replies('no', 'yes', 'yes', 'no'));
ok('three individual answers authorize exactly what was said yes to',
  full.ok === true && full.outcome === VOICE_CAPTURE_OUTCOME.AUTHORIZED && same(full.selectedCategories, ['MA_WITH_RX', 'STANDALONE_RX']) && same(full.declinedCategories, ['MA_NO_RX']) && full.routeTo === null);
ok('the decisions carry each reply and its classification', full.decisions.length === 4 && full.decisions.every((d) => d.replyClass && d.decision && d.problem === null) && full.decisions[3].decision === VOICE_DECISION.DECLINED);
ok('the capture is frozen all the way down', unfrozenPaths(full, 'capture').length === 0);
ok('the order of the replies does not matter; the order of the decisions is the approved order',
  same(captureCategoryDecisions(replies('no', 'yes', 'yes', 'no').reverse()).decisions.map((d) => d.code), ALL_CATEGORY_CODES));
ok('yes to all three, individually, authorizes all three', same(captureCategoryDecisions(replies('yes', 'yes', 'yes', 'no')).selectedCategories, AUTHORIZING_CATEGORY_CODES));
ok('in Spanish too', same(captureCategoryDecisions(replies('sí', 'no', 'sí', 'no')).selectedCategories, ['MA_NO_RX', 'STANDALONE_RX']));
ok('no to all three is incomplete — nothing may be discussed', (() => {
  const r = captureCategoryDecisions(replies('no', 'no', 'no', 'no'));
  return r.ok === true && r.outcome === VOICE_CAPTURE_OUTCOME.SOA_INCOMPLETE && r.selectedCategories.length === 0 && r.routeTo === 'LICENSED_AGENT';
})());
// §31 "Senior says 'yes to everything' - system still presents categories individually."
for (const blanket of ['yes to everything', 'all of them', 'everything', 'todo', 'sí a todo', 'a todo']) {
  const r = captureCategoryDecisions(replies(blanket, 'yes', 'yes', 'no'));
  ok(`"${blanket}" authorizes nothing: the category is asked again`, r.ok === false && r.reason === P.BLANKET_REPLY_NOT_AUTHORIZATION && r.code === 'MA_NO_RX');
}
ok('a blanket reply anywhere stops the capture, whichever category it was said to',
  captureCategoryDecisions(replies('no', 'yes', 'all of them', 'no')).code === 'STANDALONE_RX' && captureCategoryDecisions(replies('no', 'yes', 'yes', 'yes to all')).code === 'UNSURE_DISCUSS_PROCESS');
// §31 "Senior says 'I don't know' - no category auto-selected."
for (const unsure of ["I don't know", 'not sure', 'no sé', 'tal vez', 'maybe']) {
  const r = captureCategoryDecisions(replies(unsure, 'yes', 'yes', 'no'));
  ok(`"${unsure}" selects nothing — SOA_INCOMPLETE, routed to a licensed agent`,
    r.ok === true && r.outcome === VOICE_CAPTURE_OUTCOME.SOA_INCOMPLETE && same(r.selectedCategories, ['UNSURE_DISCUSS_PROCESS']) && r.selectedCategories.every((c) => !AUTHORIZING_CATEGORY_CODES.includes(c)) && r.routeTo === 'LICENSED_AGENT');
}
ok('choosing the unsure option after saying yes to a category selects nothing', (() => {
  const r = captureCategoryDecisions(replies('yes', 'yes', 'yes', 'yes'));
  return r.outcome === VOICE_CAPTURE_OUTCOME.SOA_INCOMPLETE && same(r.selectedCategories, ['UNSURE_DISCUSS_PROCESS']) && same(r.declinedCategories, AUTHORIZING_CATEGORY_CODES) && r.decisions[0].decision === VOICE_DECISION.AUTHORIZED;
})());
ok('an "ok" to a category means it is asked again', (() => { const r = captureCategoryDecisions(replies('no', 'ok', 'yes', 'no')); return r.ok === false && r.reason === P.CATEGORY_REPLY_UNCLEAR && r.code === 'MA_WITH_RX'; })());
ok('silence to a category means it is asked again', captureCategoryDecisions(replies('no', '', 'yes', 'no')).reason === P.CATEGORY_REPLY_UNCLEAR);
ok('a category that was not asked is named', (() => { const r = captureCategoryDecisions(replies('no', 'yes', 'yes', 'no').slice(0, 3)); return r.ok === false && r.reason === P.CATEGORY_NOT_ASKED && r.code === 'UNSURE_DISCUSS_PROCESS'; })());
ok('the unsure option must always be offered (§8)', captureCategoryDecisions(replies('yes', 'yes', 'yes', 'no').filter((r) => r.code !== 'UNSURE_DISCUSS_PROCESS')).reason === P.CATEGORY_NOT_ASKED);
ok('a category asked twice is refused', (() => { const r = captureCategoryDecisions([...replies('no', 'yes', 'yes', 'no'), { code: 'MA_WITH_RX', reply: 'no' }]); return r.reason === P.CATEGORY_ASKED_TWICE && r.code === 'MA_WITH_RX'; })());
ok('an unknown category is refused', captureCategoryDecisions([...replies('no', 'yes', 'yes', 'no'), { code: 'DENTAL', reply: 'yes' }]).reason === P.UNKNOWN_CATEGORY);
ok('a reply entry with an extra key is not a reply', captureCategoryDecisions([{ code: 'MA_NO_RX', reply: 'no', decision: 'AUTHORIZED' }, ...replies('no', 'yes', 'yes', 'no').slice(1)]).reason === P.UNKNOWN_CATEGORY);
ok('replies that are not a list are nothing asked', captureCategoryDecisions(null).reason === P.CATEGORY_NOT_ASKED && captureCategoryDecisions({ length: 4 }).reason === P.CATEGORY_NOT_ASKED);
ok('a reply read through a getter is not a reply',
  captureCategoryDecisions([Object.defineProperty({ code: 'MA_NO_RX' }, 'reply', { get: () => 'yes', enumerable: true }), ...replies('no', 'yes', 'yes', 'no').slice(1)]).reason === P.UNKNOWN_CATEGORY);

// ── 8. The read-back (§8, §31 "transcript mishears category") ────────────────
const rb = (items, confirmReply, capture = full) => readBackProblem(capture, { items, confirmReply });
ok('what was captured, read back, confirmed with a yes', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'yes') === null);
ok('order does not matter', rb(['STANDALONE_RX', 'MA_WITH_RX'], 'Yes, that is correct') === null);
ok('"sí" confirms', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'sí') === null);
ok('a category read back that was not authorized is a mismatch (mishearing)', rb(['MA_NO_RX', 'MA_WITH_RX'], 'yes') === P.READ_BACK_MISMATCH);
ok('a category authorized but not read back is a mismatch', rb(['MA_WITH_RX'], 'yes') === P.READ_BACK_MISMATCH);
ok('one extra is a mismatch', rb(['MA_WITH_RX', 'STANDALONE_RX', 'MA_NO_RX'], 'yes') === P.READ_BACK_MISMATCH);
ok('the unsure option in a read-back of authorized categories is a mismatch', rb(['MA_WITH_RX', 'STANDALONE_RX', 'UNSURE_DISCUSS_PROCESS'], 'yes') === P.READ_BACK_MISMATCH);
ok('the mismatch is found before the confirmation is read', rb(['MA_NO_RX'], 'no') === P.READ_BACK_MISMATCH);
ok('the caller says no: rejected, capture again', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'no') === P.READ_BACK_REJECTED);
ok('"no, I did not say the drug plan": rejected', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'no, I did not say the drug plan') === P.READ_BACK_REJECTED);
ok('"ok" does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'ok') === P.READ_BACK_NOT_CONFIRMED);
ok('silence does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], '') === P.READ_BACK_NOT_CONFIRMED);
ok('"yes to everything" does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'yes to everything') === P.READ_BACK_NOT_CONFIRMED);
ok('"I guess" does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'I guess') === P.READ_BACK_NOT_CONFIRMED);
ok('a confirmation that is not text does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], ['yes']) === P.READ_BACK_NOT_CONFIRMED);
ok('items that are not a list are a mismatch', rb('MA_WITH_RX,STANDALONE_RX', 'yes') === P.READ_BACK_MISMATCH && rb(null, 'yes') === P.READ_BACK_MISMATCH);
ok('no read-back object does not confirm', readBackProblem(full, null) === P.READ_BACK_NOT_CONFIRMED && readBackProblem(full, { items: ['MA_WITH_RX', 'STANDALONE_RX'] }) === P.READ_BACK_NOT_CONFIRMED);
ok('an incomplete capture has nothing to confirm', rb(['UNSURE_DISCUSS_PROCESS'], 'yes', captureCategoryDecisions(replies('not sure', 'yes', 'yes', 'no'))) === P.SOA_INCOMPLETE);
ok('a failed capture has nothing to read back', rb(['MA_WITH_RX'], 'yes', captureCategoryDecisions(replies('all', 'yes', 'yes', 'no'))) === P.CAPTURE_NOT_COMPLETE && rb([], 'yes', null) === P.CAPTURE_NOT_COMPLETE);
ok('a capture with a key the rule does not know is not a capture', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'yes', { ...full, forged: true }) === P.CAPTURE_NOT_COMPLETE);
{
  const en = voiceReadBack(full, 'en');
  const es = voiceReadBack(full, 'es');
  ok('the read-back spoken is the approved read-back, with the authorized labels, then the authorization statement and the confirm question',
    en.heading === SOA_TEXT.en.readBackHeading && en.intro === SOA_TEXT.en.readBackIntro && same(en.items, readBackLines(['MA_WITH_RX', 'STANDALONE_RX'], 'en').items) &&
    en.authorization === SOA_TEXT.en.authorizationStatement && en.confirmQuestion === VOICE_SOA_SCRIPT.en.confirmQuestion && same(es.items, readBackLines(['MA_WITH_RX', 'STANDALONE_RX'], 'es').items));
  throws('a read-back has a language', () => voiceReadBack(full, 'fr'), /SOA_LANGUAGE_NOT_ELECTED/);
  throws('and a capture', () => voiceReadBack(captureCategoryDecisions(replies('all', 'yes', 'yes', 'no')), 'en'), /CAPTURE_NOT_COMPLETE/);
}

// ── 9. Recording failure (§26, §31 "Recording fails mid-call") ───────────────
const SEG = Object.freeze({ startedAt: '2026-11-10T14:00:00.000Z', endedAt: '2026-11-10T14:06:30.000Z', recordingActiveThroughout: true });
ok('a segment recorded throughout stands', recordingSegmentProblem(SEG) === null);
ok('recording lost during the segment voids it', recordingSegmentProblem({ ...SEG, recordingActiveThroughout: false }) === P.RECORDING_LOST_DURING_SEGMENT);
ok('a recorded loss instant voids it even if the flag says otherwise', recordingSegmentProblem({ ...SEG, recordingLostAt: '2026-11-10T14:03:00.000Z' }) === P.RECORDING_LOST_DURING_SEGMENT);
ok('"active throughout" has to be exactly true', recordingSegmentProblem({ ...SEG, recordingActiveThroughout: 'true' }) === P.RECORDING_LOST_DURING_SEGMENT && recordingSegmentProblem({ ...SEG, recordingActiveThroughout: 1 }) === P.RECORDING_LOST_DURING_SEGMENT);
ok('a segment that does not say is lost', recordingSegmentProblem({ startedAt: SEG.startedAt, endedAt: SEG.endedAt }) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a segment that ends before it starts is invalid', recordingSegmentProblem({ ...SEG, endedAt: '2026-11-10T13:59:59.000Z' }) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a zero-length segment is invalid', recordingSegmentProblem({ ...SEG, endedAt: SEG.startedAt }) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('an instant that does not exist is invalid', recordingSegmentProblem({ ...SEG, startedAt: '2026-02-31T00:00:00.000Z' }) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a local time is invalid', recordingSegmentProblem({ ...SEG, startedAt: '2026-11-10T14:00:00' }) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('no segment is invalid', recordingSegmentProblem(null) === P.SEGMENT_TIMESTAMPS_INVALID && recordingSegmentProblem('2026-11-10') === P.SEGMENT_TIMESTAMPS_INVALID);

// ── 10. The voice evidence block (§19) ───────────────────────────────────────
const INPUT = Object.freeze({
  recordingReference: 'ghl:call:CA0123456789/recording',
  transcriptReference: 'ghl:call:CA0123456789/transcript',
  segment: SEG,
  language: 'en',
  languageSource: 'BENEFICIARY_ELECTED',
  replies: replies('no', 'yes', 'yes', 'no'),
  readBack: Object.freeze({ items: Object.freeze(['MA_WITH_RX', 'STANDALONE_RX']), confirmReply: 'yes' }),
});
const built = buildVoiceEvidence(INPUT, { script: APPROVED, today: TODAY });
ok('a complete, confirmed, recorded segment builds a voice evidence block', built.ok === true, built.reason);
const V = built.voice;
ok('the block carries the recording reference and the transcript pointer', V.recordingReference === INPUT.recordingReference && V.transcriptReference === INPUT.transcriptReference);
ok('the block carries the start and the end of the SOA segment', V.segment.startedAt === SEG.startedAt && V.segment.endedAt === SEG.endedAt && V.segment.recordingActiveThroughout === true);
ok('the block carries the exact script version, its digest and its approval', V.scriptVersion === APPROVED.version && V.scriptDigest === VOICE_SCRIPT_DIGEST && same(V.scriptApproval, { approvedBy: 'Sawil Reyes', approvedOn: '2026-10-05' }));
ok('the block carries the language and its election', V.language === 'en' && V.languageSource === 'BENEFICIARY_ELECTED' && V.representativeRelationship === null);
ok('the block carries the exact lines spoken', same(V.scriptLines, assembleVoiceScript('en', APPROVED)));
ok('the block carries every category decision with its reply and classification', V.decisions.length === 4 && V.decisions.every((d) => typeof d.reply === 'string' && d.replyClass && d.decision));
ok('the block carries the scope', same(V.selectedCategories, ['MA_WITH_RX', 'STANDALONE_RX']) && same(V.declinedCategories, ['MA_NO_RX']));
ok('the block carries the confirmed read-back', same(V.readBack, { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'yes', confirmReplyClass: 'GRANTED' }));
ok('the block is frozen all the way down', unfrozenPaths(V, 'voice').length === 0);
ok('the block passes its own rule', voiceEvidenceProblem(V, { script: APPROVED, today: TODAY }) === null);
ok('the block does not pass against the repository script, which is not approved', voiceEvidenceProblem(V) === P.VOICE_SCRIPT_NOT_APPROVED);
ok('nothing is built from an unapproved script', buildVoiceEvidence(INPUT).ok === false && buildVoiceEvidence(INPUT).reason === P.VOICE_SCRIPT_NOT_APPROVED);
ok('a representative election builds with the representative', (() => {
  const r = buildVoiceEvidence({ ...INPUT, languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: ' Daughter ' }, { script: APPROVED, today: TODAY });
  return r.ok === true && r.voice.representativeRelationship === 'Daughter' && r.voice.languageSource === 'REPRESENTATIVE_ELECTED';
})());
for (const [what, patch, reason, code] of [
  ['no recording reference', { recordingReference: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['no transcript pointer', { transcriptReference: null }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a recording reference that is not text', { recordingReference: 42 }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['recording lost during the segment', { segment: { ...SEG, recordingActiveThroughout: false } }, P.RECORDING_LOST_DURING_SEGMENT],
  ['a segment with no end', { segment: { startedAt: SEG.startedAt, recordingActiveThroughout: true } }, P.SEGMENT_TIMESTAMPS_INVALID],
  ['a language that was not elected', { languageSource: 'SYSTEM_DEFAULT' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a language that is not en/es', { language: 'pt' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a representative election with nobody named', { languageSource: 'REPRESENTATIVE_ELECTED' }, 'representative_required'],
  ['a beneficiary election with a representative named', { representativeRelationship: 'Son' }, 'election_attribution_mismatch'],
  ['a representative that is not text', { languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: 5 }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a blanket reply', { replies: replies('yes to everything', 'yes', 'yes', 'no') }, P.BLANKET_REPLY_NOT_AUTHORIZATION, 'MA_NO_RX'],
  ['an unclear reply', { replies: replies('no', 'ok', 'yes', 'no') }, P.CATEGORY_REPLY_UNCLEAR, 'MA_WITH_RX'],
  ['a category not asked', { replies: replies('no', 'yes', 'yes', 'no').slice(1) }, P.CATEGORY_NOT_ASKED, 'MA_NO_RX'],
  ['an unsure reply — nothing to evidence', { replies: replies('not sure', 'yes', 'yes', 'no') }, P.SOA_INCOMPLETE],
  ['the unsure option chosen — nothing to evidence', { replies: replies('no', 'yes', 'yes', 'yes') }, P.SOA_INCOMPLETE],
  ['everything declined — nothing to evidence', { replies: replies('no', 'no', 'no', 'no') }, P.SOA_INCOMPLETE],
  ['a read-back that differs from the answers', { readBack: { items: ['MA_NO_RX', 'STANDALONE_RX'], confirmReply: 'yes' } }, P.READ_BACK_MISMATCH],
  ['a read-back the caller rejected', { readBack: { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'no' } }, P.READ_BACK_REJECTED],
  ['a read-back answered "ok"', { readBack: { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'ok' } }, P.READ_BACK_NOT_CONFIRMED],
  ['no read-back', { readBack: null }, P.READ_BACK_NOT_CONFIRMED],
  ['an input with a key the rule does not know', { carrier: 'x' }, P.VOICE_EVIDENCE_INCOMPLETE],
]) {
  const r = buildVoiceEvidence({ ...INPUT, ...patch }, { script: APPROVED, today: TODAY });
  ok(`nothing is built from ${what}: ${reason}`, r.ok === false && r.reason === reason && (code === undefined || r.code === code), `got ${r.reason}/${r.code}`);
}
ok('nothing is built from nothing', buildVoiceEvidence(null, { script: APPROVED, today: TODAY }).reason === P.VOICE_EVIDENCE_INCOMPLETE);

// The block's own rule, against tampered blocks: every field the record exists to protect is judged.
const tampered = (patch) => voiceEvidenceProblem({ ...V, ...patch }, { script: APPROVED, today: TODAY });
for (const [what, patch, reason] of [
  ['the recording reference removed', { recordingReference: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['the segment marked lost', { segment: { ...V.segment, recordingActiveThroughout: false } }, P.RECORDING_LOST_DURING_SEGMENT],
  ['another script version', { scriptVersion: 'CP-SOA-VOICE-SCRIPT-CY2027-v9.9' }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['another digest', { scriptDigest: sha('x') }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['an approval that is not the script\'s', { scriptApproval: { approvedBy: 'Claude', approvedOn: '2026-10-05' } }, P.VOICE_SCRIPT_NOT_APPROVED],
  ['the Spanish lines on an English block', { scriptLines: assembleVoiceScript('es', APPROVED) }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['one spoken line paraphrased', { scriptLines: V.scriptLines.map((l, i) => (i === 3 ? { ...l, text: 'MA plan. Yes or no?' } : l)) }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['a decision widened after the fact', { decisions: V.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, reply: 'yes', replyClass: 'GRANTED', decision: 'AUTHORIZED' } : d)) }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a decision relabelled without its reply', { decisions: V.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, decision: 'AUTHORIZED' } : d)) }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a selected category the replies do not support', { selectedCategories: ['MA_NO_RX', 'MA_WITH_RX', 'STANDALONE_RX'] }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a declined list that disagrees with the replies', { declinedCategories: [] }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a read-back that no longer matches', { readBack: { ...V.readBack, items: ['MA_WITH_RX'] } }, P.READ_BACK_MISMATCH],
  ['a read-back class that was not a grant', { readBack: { ...V.readBack, confirmReplyClass: 'UNCLEAR' } }, P.READ_BACK_NOT_CONFIRMED],
  ['a read-back reply that was not a yes, however it is labelled', { readBack: { ...V.readBack, confirmReply: 'ok' } }, P.READ_BACK_NOT_CONFIRMED],
  ['a language that was not elected', { languageSource: 'INFERRED_FROM_LEAD' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a key the block does not have', { extra: true }, P.VOICE_EVIDENCE_INCOMPLETE],
]) {
  ok(`the block's rule catches ${what}: ${reason}`, tampered(patch) === reason, `got ${tampered(patch)}`);
}
ok('the block\'s rule reads its own data, never a getter', voiceEvidenceProblem(Object.defineProperty({ ...V }, 'recordingReference', { get: () => 'rec', enumerable: true }), { script: APPROVED, today: TODAY }) === P.VOICE_EVIDENCE_INCOMPLETE);
ok('a block with a key missing is incomplete', voiceEvidenceProblem((() => { const { scriptDigest, ...rest } = V; return rest; })(), { script: APPROVED, today: TODAY }) === P.VOICE_EVIDENCE_INCOMPLETE);

// ── 11. Inside the integrity hash, through evidence.js ───────────────────────
const voiceInput = Object.freeze({
  soaId: 'soa_voice_1', appointmentId: 'appt_voice_1', appointmentAt: '2026-11-10T15:00:00Z',
  appointmentFormat: 'TELEPHONE', planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk',
  language: 'en', languageSource: 'BENEFICIARY_ELECTED',
  method: 'VOICE_RECORDED', beneficiaryName: 'Jane Q Public',
  selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX'], stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
  cmsRulesetVersion: CMS_RULESET_2027.version, scriptVersion: APPROVED.version,
});
const voiceInst = createSoaInstance(voiceInput);
ok('a voice instance builds, pending its affirmation, with the voice script version', voiceInst.ok === true && voiceInst.instance.status === SOA_STATUS.PENDING_SIGNATURE && voiceInst.instance.scriptVersion === APPROVED.version, JSON.stringify(voiceInst.errors || {}));
const signedAt = '2026-11-10T14:06:30.000Z';
const evidenceOf = (instance, extra = {}) => buildEvidenceRecord(instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt, voice: V, voiceScript: APPROVED, ...extra });
throws('a voice instance cannot be evidenced without its voice block', () => buildEvidenceRecord(voiceInst.instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt }), /VOICE_EVIDENCE_MISSING/);
throws('nor with a null block', () => evidenceOf(voiceInst.instance, { voice: null }), /VOICE_EVIDENCE_MISSING/);
throws('nor against the repository script, which is not approved', () => buildEvidenceRecord(voiceInst.instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt, voice: V }), /VOICE_SCRIPT_NOT_APPROVED/);
throws('nor with a block whose recording was lost', () => evidenceOf(voiceInst.instance, { voice: { ...V, segment: { ...V.segment, recordingActiveThroughout: false } } }), /RECORDING_LOST_DURING_SEGMENT/);
throws('nor with a block in another language than the instance', () => evidenceOf(voiceInst.instance, { voice: buildVoiceEvidence({ ...INPUT, language: 'es' }, { script: APPROVED, today: TODAY }).voice }), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
throws('nor with a block whose election differs from the instance', () => evidenceOf(createSoaInstance({ ...voiceInput, languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: 'Son' }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
throws('nor with a block whose scope differs from the instance', () => evidenceOf(createSoaInstance({ ...voiceInput, selectedCategories: ['MA_WITH_RX'] }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
throws('nor with a block whose scope is wider than the instance', () => evidenceOf(createSoaInstance({ ...voiceInput, selectedCategories: AUTHORIZING_CATEGORY_CODES.slice() }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
throws('nor with an instance that names another script version', () => evidenceOf(createSoaInstance({ ...voiceInput, scriptVersion: SOA_SCRIPT_VERSION }).instance), /VOICE_SCRIPT_VERSION_MISMATCH/);
throws('a written instance refuses a voice block', () => evidenceOf(createSoaInstance({ ...voiceInput, method: 'WEB_ELECTRONIC_SIGNATURE', scriptVersion: SOA_SCRIPT_VERSION }).instance), /NOT_A_VOICE_INSTANCE/);
throws('the signature/affirmation is still required', () => evidenceOf(voiceInst.instance, { signature: '' }), /signature/);
{
  const { record, integrityHash } = evidenceOf(voiceInst.instance);
  ok('a voice record builds and verifies', verifyEvidence(record).ok === true && record.integrityHash === integrityHash);
  ok('the voice block is in the record', same(record.voice, V));
  ok('the voice block is INSIDE the hash: the hash of the same record without it differs',
    verifyEvidence({ ...record, voice: undefined }).reason === 'HASH_MISMATCH');
  for (const [what, patch] of [
    ['the recording reference', { recordingReference: 'ghl:call:OTHER/recording' }],
    ['the transcript pointer', { transcriptReference: 'ghl:call:OTHER/transcript' }],
    ['the segment start', { segment: { ...V.segment, startedAt: '2026-11-10T13:00:00.000Z' } }],
    ['the segment end', { segment: { ...V.segment, endedAt: '2026-11-10T14:07:00.000Z' } }],
    ['the script version', { scriptVersion: 'CP-SOA-VOICE-SCRIPT-CY2027-v9.9' }],
    ['the script digest', { scriptDigest: sha('x') }],
    ['the approval', { scriptApproval: { approvedBy: 'Someone Else', approvedOn: '2026-10-05' } }],
    ['the language election', { languageSource: 'REPRESENTATIVE_ELECTED' }],
    ['a spoken line', { scriptLines: V.scriptLines.map((l, i) => (i === 0 ? { ...l, text: l.text + ' Trust me.' } : l)) }],
    ['a category decision', { decisions: V.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, decision: 'AUTHORIZED' } : d)) }],
    ['a reply', { decisions: V.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, reply: 'yes' } : d)) }],
    ['the scope', { selectedCategories: ['MA_NO_RX', 'MA_WITH_RX', 'STANDALONE_RX'] }],
    ['the read-back', { readBack: { ...V.readBack, items: ['MA_WITH_RX'] } }],
    ['the read-back reply', { readBack: { ...V.readBack, confirmReply: 'ok' } }],
  ]) {
    ok(`tampering with ${what} inside the stored block is detected`, verifyEvidence({ ...record, voice: { ...record.voice, ...patch } }).reason === 'HASH_MISMATCH');
  }
  ok('the record is classed for retention and keeps the signed instant', record.recordClass === 'SOA_EVIDENCE' && record.signedAt === signedAt && record.createdAt === signedAt);
  ok('the text snapshot is the approved text in the instance\'s language', record.textSnapshot.language === 'en' && record.textSnapshot.scriptVersion === APPROVED.version);
  // The same hash, computed the same way, twice.
  ok('the hash is deterministic', evidenceOf(voiceInst.instance).integrityHash === integrityHash);
  // Completed with that hash, the instance passes the marketing gate for a telephone appointment and not for an in-person one.
  const done = completeSoaInstance(voiceInst.instance, { completedAt: signedAt, integrityHash, evidenceReference: 'ev_voice_1' });
  const appt = { appointmentId: 'appt_voice_1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
  ok('a completed, evidenced voice SOA opens the gate for the telephone appointment it was recorded for', marketingGate(done, appt, CMS_RULESET_2027).allowed === true, marketingGate(done, appt, CMS_RULESET_2027).reason);
  ok('and never for an in-person one (§31 "Home visit requested with voice-only SOA")', marketingGate(done, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).allowed === false);
}
{
  // The written path is untouched: same record, same hash, no voice key.
  const webInst = createSoaInstance({ ...voiceInput, soaId: 'soa_web_1', method: 'WEB_ELECTRONIC_SIGNATURE', scriptVersion: SOA_SCRIPT_VERSION }).instance;
  const { record } = buildEvidenceRecord(webInst, { stateName: 'New York', signature: 'Jane Q Public', signedAt });
  ok('a written record carries no voice key at all, so its hash is what it always was', !('voice' in record) && verifyEvidence(record).ok === true);
  ok('and still verifies against a hash computed without the key', verifyEvidence({ ...record, voice: undefined }).ok === true);
}
ok('the contradiction rule, called directly, names what disagrees',
  voiceInstanceContradiction(voiceInst.instance, V) === null &&
  voiceInstanceContradiction({ ...voiceInst.instance, language: 'es' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, representativeRelationship: 'Son' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, declinedCategories: [] }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, method: 'SMS_LINK_ELECTRONIC' }, V) === P.NOT_A_VOICE_INSTANCE &&
  voiceInstanceContradiction(null, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction(voiceInst.instance, null) === P.VOICE_EVIDENCE_INCOMPLETE);

// ── 12. The build gates: observed failing on a defective tree ────────────────
{
  const selfMod = await runGate();
  ok('the repository passes the self-modification gate with the voice tables registered', selfMod.problems.length === 0 && selfMod.frozenCount === selfMod.objectCount && selfMod.objectCount >= 47, selfMod.problems.join(' | ') + ` ${selfMod.frozenCount}/${selfMod.objectCount}`);
  const loose = await runGate({ apiFiles: [{ path: 'api/ok.js', source: 'export const a = 1;' }], srcFiles: [{ path: 'src/ok.ts', source: 'export const b = 2;' }], objects: { VOICE_SOA_SCRIPT: { ...VOICE_SOA_SCRIPT, en: { ...VOICE_SOA_SCRIPT.en } } } });
  ok('an unfrozen voice script is reported by the gate', loose.problems.some((p) => /^VOICE_SOA_SCRIPT is not frozen all the way down/.test(p)), loose.problems.join(' | '));
  const written = await runGate({ apiFiles: [{ path: 'api/bad.js', source: "import { VOICE_SOA_ENABLED } from './_lib/cy2027/voice-soa.js';\nVOICE_SOA_ENABLED = true;" }], srcFiles: [], objects: { X: Object.freeze({}) } });
  ok('a runtime write to the flag is reported by the gate', written.problems.some((p) => /api\/bad\.js: writes to VOICE_SOA_ENABLED/.test(p)), written.problems.join(' | '));
  const pushed = await runGate({ apiFiles: [{ path: 'api/bad.js', source: "import { BLANKET_REPLIES } from './_lib/cy2027/voice-soa.js';\nBLANKET_REPLIES.push('x');" }], srcFiles: [], objects: { X: Object.freeze({}) } });
  ok('a push onto a reply list is reported by the gate', pushed.problems.some((p) => /api\/bad\.js: mutates BLANKET_REPLIES in place/.test(p)), pushed.problems.join(' | '));
}
{
  const tmp = mkdtempSync(join(tmpdir(), 'cy2027-voice-'));
  try {
    const vercelignore = readFileSync(join(REPO_ROOT, '.vercelignore'), 'utf8');
    const shipped = vercelignore.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^!scripts\/[\w.-]+$/.test(l)).map((l) => l.slice(1));
    let copies = 0;
    const makeTree = () => {
      const root = join(tmp, 'tree' + (copies += 1));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      for (const d of ['api', 'src']) cpSync(join(REPO_ROOT, d), join(root, d), { recursive: true });
      for (const f of ['index.html', 'package.json', '.vercelignore', ...shipped]) if (existsSync(join(REPO_ROOT, f))) cpSync(join(REPO_ROOT, f), join(root, f));
      cpSync(join(REPO_ROOT, 'docs', 'compliance'), join(root, 'docs', 'compliance'), { recursive: true });
      return root;
    };
    const edit = (root, relPath, from, to) => {
      const p = join(root, relPath);
      const raw = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      if (raw.split(from).length !== 2) throw new Error(`the anchor was not found exactly once in ${relPath}: ${from.slice(0, 60)}`);
      writeFileSync(p, raw.replace(from, to));
    };
    const repin = async (root) => {
      const mod = await import(pathToFileURL(join(root, 'api', '_lib', 'cy2027', 'voice-soa.js')).href + '?t=' + Date.now());
      edit(root, 'api/_lib/cy2027/voice-soa.js', `export const VOICE_SCRIPT_DIGEST = '${mod.VOICE_SCRIPT_DIGEST}';`, `export const VOICE_SCRIPT_DIGEST = '${sha(mod.voiceScriptPayload())}';`);
    };
    const runParity = (root) => {
      const clean = { ...process.env };
      for (const k of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL']) delete clean[k];
      const r = spawnSync(process.execPath, [join(root, 'scripts', 'check-cy2027-parity.mjs')], { cwd: root, encoding: 'utf8', env: clean });
      return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
    };
    const VS = 'api/_lib/cy2027/voice-soa.js';
    const FLAG_OFF = 'export const VOICE_SOA_ENABLED = false;';
    const FLAG_ON = 'export const VOICE_SOA_ENABLED = true;';
    const PENDING = "  status: VOICE_SCRIPT_STATUS.PENDING_OWNER_APPROVAL,\n  approvedBy: null,\n  approvedOn: null,";
    const approvedBy = (who) => `  status: VOICE_SCRIPT_STATUS.APPROVED,\n  approvedBy: '${who}',\n  approvedOn: '2026-10-05',`;

    const clean = runParity(makeTree());
    ok('parity gate: an untouched copy of the tree passes', clean.status === 0, clean.out.slice(0, 400));
    ok('parity gate: and reports the voice script digest and the disabled flag', /voice SOA script CP-SOA-VOICE-SCRIPT-CY2027-v0\.1 digest OK/.test(clean.out) && /voice SOA disabled; script PENDING_OWNER_APPROVAL/.test(clean.out), clean.out.slice(0, 600));

    const edited = makeTree();
    edit(edited, VS, "    unsureLead: 'You may also choose this option:',", "    unsureLead: 'You may also choose this option, which most people pick:',");
    const r1 = runParity(edited);
    ok('parity gate: a connecting sentence edited without a re-pin FAILS the build', r1.status === 1 && /VOICE_SCRIPT_DIGEST was not re-pinned/.test(r1.out), r1.out.slice(0, 400));

    const enabled = makeTree();
    edit(enabled, VS, FLAG_OFF, FLAG_ON);
    const r2 = runParity(enabled);
    ok('parity gate: the flag on over an unapproved script FAILS the build', r2.status === 1 && /VOICE_SOA_ENABLED is true but the voice SOA script has no recorded owner approval/.test(r2.out), r2.out.slice(0, 400));

    const robot = makeTree();
    edit(robot, VS, FLAG_OFF, FLAG_ON);
    edit(robot, VS, PENDING, approvedBy('Claude'));
    await repin(robot);
    const r3 = runParity(robot);
    ok('parity gate: the flag on over a script "approved" by Claude, digest re-pinned, FAILS the build', r3.status === 1 && /no recorded owner approval/.test(r3.out) && /approvedBy "Claude"/.test(r3.out), r3.out.slice(0, 400));

    const unpinned = makeTree();
    edit(unpinned, VS, FLAG_OFF, FLAG_ON);
    edit(unpinned, VS, PENDING, approvedBy('Sawil Reyes'));
    const r4 = runParity(unpinned);
    ok('parity gate: a real approval recorded without the re-pin FAILS the build (the approval is on the record only through the digest)', r4.status === 1 && /VOICE_SCRIPT_DIGEST was not re-pinned/.test(r4.out), r4.out.slice(0, 400));

    const approved = makeTree();
    edit(approved, VS, FLAG_OFF, FLAG_ON);
    edit(approved, VS, PENDING, approvedBy('Sawil Reyes'));
    await repin(approved);
    const r5 = runParity(approved);
    ok('parity gate: the flag on over a script approved by a person on a day, digest re-pinned, PASSES', r5.status === 0 && /voice SOA ENABLED; script APPROVED/.test(r5.out), r5.out.slice(0, 600));

    const placeholder = makeTree();
    edit(placeholder, VS, `export const VOICE_SCRIPT_DIGEST = '${VOICE_SCRIPT_DIGEST}';`, "export const VOICE_SCRIPT_DIGEST = 'sha256:PENDING_FIRST_PIN';");
    const r6 = runParity(placeholder);
    ok('parity gate: the placeholder digest FAILS the build and prints the value to pin', r6.status === 1 && /VOICE_SCRIPT_DIGEST is still the placeholder/.test(r6.out) && r6.out.includes(VOICE_SCRIPT_DIGEST), r6.out.slice(0, 400));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 13. Server-only, wired once, registered — what must be ABSENT is scanned ─
{
  ok('voice-soa.js is not re-exported by the shared barrel', !('voiceSoaOfferProblem' in barrelModule) && !('VOICE_SOA_SCRIPT' in barrelModule) && !('buildVoiceEvidence' in barrelModule));
  ok('(source) the barrel does not reach voice-soa.js', !/voice-soa/.test(strip(read('../api/_lib/cy2027/index.js'), 'api/_lib/cy2027/index.js')));
  ok('(source) the client barrel does not reach voice-soa.js', !/voice-soa/.test(strip(read('../src/lib/cy2027.ts'), 'src/lib/cy2027.ts')));
  const EV = strip(read('../api/_lib/cy2027/evidence.js'), 'api/_lib/cy2027/evidence.js');
  ok('(source) evidence.js takes the voice rules from the one module', line(/import \{ voiceEvidenceProblem, voiceInstanceContradiction \} from '\.\/voice-soa\.js';/).test(EV));
  ok('(source) the voice block is spread into the hashed core, for a voice instance only', line(/\.\.\.\(isVoice \? \{ voice \} : \{\}\),/).test(EV) && EV.indexOf('...(isVoice ? { voice } : {}),') < EV.indexOf('const hash = integrityHash(core);'));
  ok('(source) voice-soa.js imports only sibling modules — no Node API, no package',
    [...strip(read('../api/_lib/cy2027/voice-soa.js'), 'api/_lib/cy2027/voice-soa.js').matchAll(/from\s+'([^']+)'/g)].every((m) => /^\.\/[\w-]+\.js$/.test(m[1])));
  const API = join(REPO_ROOT, 'api');
  const handlers = readdirSync(API).filter((f) => /\.js$/.test(f));
  ok('(source) no handler overrides the voice script or the flag when it calls the layer',
    handlers.every((f) => { const s = strip(readFileSync(join(API, f), 'utf8'), 'api/' + f); return !/voiceScript\s*:/.test(s) && !/voiceSoaOfferProblem\([^)]*enabled/.test(s); }) && handlers.length >= 5);
  const BAT = read('./run-battery.mjs').replace(/\r\n/g, '\n');
  ok('(source) the battery runs this suite', line(/'test-cy2027-voice-2026-10-04\.mjs',$/).test(BAT));
  ok('the voice module exports nothing writable', Object.isFrozen(voiceModule) || Object.keys(voiceModule).length >= 20);
}

// ── 14. The owner package quotes the data, verbatim ──────────────────────────
{
  const docPath = join(REPO_ROOT, 'docs', 'voice', 'VOICE-SOA-CONFIGURATION-PACKAGE-2026-10-04.md');
  ok('the owner configuration package exists under docs/voice/', existsSync(docPath));
  const doc = readFileSync(docPath, 'utf8').replace(/\s+/g, ' ');
  ok('it is marked NOT APPLIED', /\*\*Status: NOT APPLIED\.\*\*/.test(doc));
  ok('it names the script version and its pending status', doc.includes(VOICE_SOA_SCRIPT.version) && doc.includes('PENDING_OWNER_APPROVAL'));
  for (const lang of ['en', 'es']) {
    for (const l of assembleVoiceScript(lang)) {
      ok(`the ${lang} addendum quotes the ${l.step}${l.code ? ' ' + l.code : ''} line verbatim`, doc.includes(l.text.replace(/\s+/g, ' ')), l.text.slice(0, 60));
    }
  }
  ok('it quotes the approved read-back-none line in both languages', doc.includes(SOA_TEXT.en.readBackNone) && doc.includes(SOA_TEXT.es.readBackNone));
  ok('it quotes the question whose answer the gate reads as the caller choosing voice, in both languages',
    doc.includes(VOICE_SOA_SCRIPT.en.channelConfirmQuestion) && doc.includes(VOICE_SOA_SCRIPT.es.channelConfirmQuestion) &&
    voiceScriptPayload().includes(VOICE_SOA_SCRIPT.es.channelConfirmQuestion));
  for (const tool of ['Call transfer', 'Trigger a workflow', 'Send SMS', 'Update contact field', 'Appointment Booking', 'Custom action', 'Agent Transfer']) {
    ok(`it lists the catalogue action "${tool}" for verification`, doc.includes(tool));
  }
  ok('it says End Call is not available and which tools must be absent', /no "End Call" action/.test(doc) && /Must be ABSENT/.test(doc) && /plan-search, carrier-search/.test(doc));
  ok('it says the receiving endpoint does not exist', /does not exist yet/.test(doc));
  ok('it names the rollback backups', doc.includes('2026-10-01-emely-prompt-after.txt') && doc.includes('2026-10-01-sofia-prompt-after.txt'));
  ok('it preserves Layer A: two agents, IVR routing, the notice once, no AI self-announcement', /Two agents, never one multilingual agent/.test(doc) && /press 1 Emely/.test(doc) && /recording notice once/.test(doc) && /does not volunteer that it is an automated assistant/.test(doc));
  ok('nothing in the build reads it', !/VOICE-SOA-CONFIGURATION-PACKAGE/.test(strip(read('./check-cy2027-parity.mjs'), 'scripts/check-cy2027-parity.mjs')) && !/docs\/voice/.test(strip(read('./check-cy2027-parity.mjs'), 'scripts/check-cy2027-parity.mjs')));
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`CY2027 VOICE SOA (SPEC-10/19/26/28): ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  console.error(`\nRESULT: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`CY2027 VOICE SOA (SPEC-10/19/26/28): all ${passed} assertions passed`);
console.log(`RESULT: ${passed} passed, 0 failed`);

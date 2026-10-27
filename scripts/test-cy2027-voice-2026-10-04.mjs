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
// AUDIT 2026-10-04 (SPEC-10/19/26/28, red team) — what an independent red team
// then broke, and what this suite now proves by CALLING the rules: "yes, not
// that one" authorized a category and "yes, that is not right" confirmed the
// read-back (a negation anywhere is a refusal now, in every voice path); the
// enable flag was enforced by the offer gate only (it is the first refusal of
// every stage, and evidence.js has no option to switch it on, approve a script
// or move the clock — the positive path is driven through a COPY of the tree in
// which the owner approval is recorded and the flag is on); an in-person voice
// instance that the offer gate refused was evidenced and COMPLETED (the write
// stage enforces the same refusals); a segment in 2099, a record signed before
// its segment, a block reused for another appointment, an instance that said
// the unsure option was selected, a block whose digest was not the script in
// force — each refused by name; and the sentences the owner package told the
// agents to say that lived only in the document are pinned data, checked in
// both directions.
//
// Every rule is exercised by CALLING it with every refusal and the one path
// that passes; the evidence block is observed INSIDE the integrity hash by
// building a record through evidence.js and tampering with each voice field;
// the build gate is observed FAILING on copies of the tree with an edited
// script, an enabled flag over an unapproved script, a non-human approver and
// the placeholder digest — and passing on a clean copy and on a properly
// approved one. Only what must be ABSENT from the source is scanned, anchored,
// and each scan is observed biting on a defective input.
//
// Run: node scripts/test-cy2027-voice-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as voiceModule from '../api/_lib/cy2027/voice-soa.js';
import {
  VOICE_SOA_ENABLED, VOICE_SCRIPT_STATUS, VOICE_SOA_SCRIPT, VOICE_SCRIPT_DIGEST, VOICE_SOA_PROBLEM, VOICE_DECISION, VOICE_CAPTURE_OUTCOME,
  BLANKET_REPLIES, UNSURE_REPLIES, VOICE_NEGATIVE_TOKENS, REPLY_MAX_CHARS,
  isBlanketReply, isUnsureReply, isNegatedReply, voiceScriptApprovalProblem, assembleVoiceScript, voiceScriptPayload, bareAcronymsInScript,
  voiceSoaOfferProblem, classifyCategoryReply, captureCategoryDecisions, voiceReadBack, readBackProblem, recordingSegmentProblem,
  buildVoiceEvidence, voiceEvidenceProblem, voiceInstanceContradiction,
} from '../api/_lib/cy2027/voice-soa.js';
import {
  SOA_CATEGORIES, AUTHORIZING_CATEGORY_CODES, ALL_CATEGORY_CODES, SOA_TEXT, SOA_SCRIPT_VERSION, FORBIDDEN_BARE_ACRONYMS, categoryText, readBackLines,
} from '../api/_lib/cy2027/soa-text.js';
import { SOA_STATUS, createSoaInstance, completeSoaInstance, marketingGate as marketingGateAtClock, LANGUAGE_SOURCE } from '../api/_lib/cy2027/soa-instance.js';
import { CMS_RULESET_2027 } from '../api/_lib/cy2027/rulesets.js';
import { buildEvidenceRecord, verifyEvidence } from '../api/_lib/cy2027/evidence.js';
import { CONSENT_STATUS, classifyReply, CONSENT_CLOCK_TOLERANCE_MS } from '../api/_lib/cy2027/consent.js';
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
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IN_CY2027 = new Date('2026-11-01T12:00:00Z');
const marketingGate = (instance, appointment, ruleset, opts = {}) => marketingGateAtClock(instance, appointment, ruleset, { now: IN_CY2027, ...opts });
const P = VOICE_SOA_PROBLEM;

// An approved copy of the script, as the owner would record it. The repository
// script stays PENDING; every positive path of the pure rules below is driven
// through this copy, and the evidence path through a copy of the TREE (§11).
// The clock the pure rules run on is fixed; the segment is in the past of both
// that clock and the real one, so the copy of the tree (real clock) accepts it.
const TODAY = '2026-10-06';
const NOW_MS = Date.parse('2026-10-12T12:00:00.000Z');
const APPROVED = Object.freeze({ ...VOICE_SOA_SCRIPT, status: VOICE_SCRIPT_STATUS.APPROVED, approvedBy: 'Sawil Reyes', approvedOn: '2026-10-05' });
const APPROVED_DIGEST = sha(voiceScriptPayload(APPROVED));
const withApproval = (extra = {}) => ({ enabled: true, script: APPROVED, scriptDigest: APPROVED_DIGEST, today: TODAY, nowMs: NOW_MS, ...extra });

// ── 1. The flag, the script data and the digest ──────────────────────────────
ok('voice SOA is OFF in the repository', VOICE_SOA_ENABLED === false);
ok('the script is pending owner approval, with no approver and no date',
  VOICE_SOA_SCRIPT.status === VOICE_SCRIPT_STATUS.PENDING_OWNER_APPROVAL && VOICE_SOA_SCRIPT.approvedBy === null && VOICE_SOA_SCRIPT.approvedOn === null);
ok('the status vocabulary is exactly pending and approved', same(Object.values(VOICE_SCRIPT_STATUS), ['PENDING_OWNER_APPROVAL', 'APPROVED']));
ok('the script has its own version and names the approved text it is built on',
  /^CP-SOA-VOICE-SCRIPT-CY\d{4}-v\d+\.\d+$/.test(VOICE_SOA_SCRIPT.version) && VOICE_SOA_SCRIPT.basedOn === SOA_SCRIPT_VERSION);
ok('v0.1 (whose owner package carried unpinned sentences) was never approved; the data is v0.2', VOICE_SOA_SCRIPT.version === 'CP-SOA-VOICE-SCRIPT-CY2027-v0.2');
ok('the pinned digest is the digest of the payload', VOICE_SCRIPT_DIGEST === sha(voiceScriptPayload()), `${VOICE_SCRIPT_DIGEST} vs ${sha(voiceScriptPayload())}`);
ok('the payload covers the approval record, so approving requires a re-pin',
  APPROVED_DIGEST !== VOICE_SCRIPT_DIGEST && /"approvedBy":null/.test(voiceScriptPayload()) && /"status":"PENDING_OWNER_APPROVAL"/.test(voiceScriptPayload()));
ok('the payload covers the assembled lines, so a change to the approved category text moves this digest too',
  voiceScriptPayload().includes(categoryText('MA_WITH_RX', 'es').description) && voiceScriptPayload().includes(SOA_TEXT.en.important));
for (const key of ['fourChoices', 'inPersonRefusal', 'channelConfirmQuestion', 'reAsk', 'savedClose', 'saveFailedClose']) {
  ok(`the ${key} sentence is pinned data in both languages (inside the digest, behind the approval)`,
    typeof VOICE_SOA_SCRIPT.en[key] === 'string' && typeof VOICE_SOA_SCRIPT.es[key] === 'string' &&
    voiceScriptPayload().includes(VOICE_SOA_SCRIPT.en[key]) && voiceScriptPayload().includes(VOICE_SOA_SCRIPT.es[key]));
}
ok('§21: the saved close claims a save and the failed-save close claims none, in both languages',
  /has been recorded/.test(VOICE_SOA_SCRIPT.en.savedClose) && /was not able to save/.test(VOICE_SOA_SCRIPT.en.saveFailedClose) &&
  /ha sido registrado/.test(VOICE_SOA_SCRIPT.es.savedClose) && /No pude guardarlo/.test(VOICE_SOA_SCRIPT.es.saveFailedClose));
for (const [name, table] of [
  ['VOICE_SOA_SCRIPT', VOICE_SOA_SCRIPT], ['VOICE_SCRIPT_STATUS', VOICE_SCRIPT_STATUS], ['VOICE_SOA_PROBLEM', VOICE_SOA_PROBLEM],
  ['VOICE_DECISION', VOICE_DECISION], ['VOICE_CAPTURE_OUTCOME', VOICE_CAPTURE_OUTCOME], ['BLANKET_REPLIES', BLANKET_REPLIES], ['UNSURE_REPLIES', UNSURE_REPLIES],
  ['VOICE_NEGATIVE_TOKENS', VOICE_NEGATIVE_TOKENS],
]) {
  ok(`${name} is frozen all the way down`, unfrozenPaths(table, name).length === 0, unfrozenPaths(table, name).join(', '));
  ok(`${name} is a governing identifier`, GOVERNING_IDENTIFIERS.includes(name));
}
ok('the enable flag is a governing identifier', GOVERNING_IDENTIFIERS.includes('VOICE_SOA_ENABLED'));
ok('every refusal name is its own key', Object.entries(VOICE_SOA_PROBLEM).every(([k, v]) => k === v) && Object.keys(VOICE_SOA_PROBLEM).length >= 28);
ok('the two refusals the red team repair added are named', P.SEGMENT_AFTER_AFFIRMATION === 'SEGMENT_AFTER_AFFIRMATION' && P.VOICE_SCRIPT_DIGEST_MISMATCH === 'VOICE_SCRIPT_DIGEST_MISMATCH');
ok('the decision vocabulary is authorized, declined, unsure — nothing else', same(Object.values(VOICE_DECISION), ['AUTHORIZED', 'DECLINED', 'UNSURE']));

// ── 2. The script is the APPROVED text, verbatim, in order, both languages ───
const STEPS = ['PURPOSE', 'IMPORTANT', 'ONE_AT_A_TIME', 'CATEGORY', 'CATEGORY', 'CATEGORY', 'UNSURE_OPTION', 'RE_ASK', 'READ_BACK', 'AUTHORIZATION', 'CONFIRM', 'SAVED_CLOSE', 'SAVE_FAILED_CLOSE', 'INCOMPLETE_CLOSE', 'RECORDING_LOST_CLOSE'];
for (const lang of ['en', 'es']) {
  const lines = assembleVoiceScript(lang);
  const t = SOA_TEXT[lang];
  const s = VOICE_SOA_SCRIPT[lang];
  const steps = lines.map((l) => l.step);
  ok(`${lang}: the steps are purpose, important, one-at-a-time, the three categories, the unsure option, the re-ask, read-back, authorization, confirm, the four closes`,
    same(steps, STEPS), steps.join(','));
  ok(`${lang}: the categories are spoken in the approved order, each by its own code`,
    same(lines.filter((l) => l.step === 'CATEGORY').map((l) => l.code), AUTHORIZING_CATEGORY_CODES) && lines.find((l) => l.step === 'UNSURE_OPTION').code === 'UNSURE_DISCUSS_PROCESS');
  for (const c of SOA_CATEGORIES) {
    const spoken = lines.find((l) => l.code === c.code).text;
    ok(`${lang}: ${c.code} is spoken with its approved label and description, verbatim and in that order`,
      spoken.startsWith(c.authorizes ? `${c[lang].label}. ${c[lang].description} ` : `${s.unsureLead} ${c[lang].label}. ${c[lang].description} `));
    ok(`${lang}: ${c.code} ends with the one-at-a-time yes/no question`,
      spoken.endsWith(c.authorizes ? s.categoryQuestion : s.unsureQuestion));
  }
  ok(`${lang}: the "important" statement (§29: not required to enroll, does not affect coverage) is the approved one, verbatim`,
    lines.find((l) => l.step === 'IMPORTANT').text === t.important);
  ok(`${lang}: the authorization statement is the approved one, verbatim`, lines.find((l) => l.step === 'AUTHORIZATION').text === t.authorizationStatement);
  ok(`${lang}: the read-back framing is the approved heading and intro`, lines.find((l) => l.step === 'READ_BACK').text === `${t.readBackHeading}. ${t.readBackIntro}`);
  ok(`${lang}: the re-ask line and the two closes after the confirmation are the pinned sentences, verbatim`,
    lines.find((l) => l.step === 'RE_ASK').text === s.reAsk && lines.find((l) => l.step === 'SAVED_CLOSE').text === s.savedClose && lines.find((l) => l.step === 'SAVE_FAILED_CLOSE').text === s.saveFailedClose);
  ok(`${lang}: the purpose line says the SOA documents what the licensed agent may discuss (§10)`,
    /licensed agent|agente licenciado/.test(lines[0].text) && /discuss|conversar/.test(lines[0].text) && /appointment|cita/.test(lines[0].text));
  ok(`${lang}: every line is frozen`, Object.isFrozen(lines) && lines.every((l) => Object.isFrozen(l)));
  const CARRIERS = /\b(?:aetna|humana|unitedhealth(?:care)?|wellcare|centene|emblem(?:health)?|healthfirst|fidelis|anthem|connecticare|clover|cigna|devoted|elderplan|aarp)\b/i;
  ok(`${lang}: no carrier, no "which plan is best" (§16, §29)`, !lines.some((l) => CARRIERS.test(l.text) || /which plan is best|qué plan le conviene|qué plan es mejor/i.test(l.text)));
  ok(`${lang}: the offer lines (four choices, in-person refusal) name no carrier and no plan`, !CARRIERS.test(s.fourChoices + ' ' + s.inPersonRefusal));
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
  recording: Object.freeze({ active: true, reference: 'rec_2026_10_10_001' }),
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
  ['the caller said "yes, not by voice"', { channelChoice: { channel: 'VOICE', reply: 'yes, not by voice' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller said "yes, never mind, send the link"', { channelChoice: { channel: 'VOICE', reply: 'yes, never mind, send the link' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
  ['the caller said "sí, mejor no"', { channelChoice: { channel: 'VOICE', reply: 'sí, mejor no' } }, P.CHANNEL_NOT_CHOSEN_BY_CALLER],
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

// ── 5. Blanket, unsure and negated replies ───────────────────────────────────
for (const r of ['yes to everything', 'Yes, to everything!', 'all of them', 'ALL', 'everything', 'both', 'all three', 'yes all', 'whatever',
  'yes every one', 'yes, every one of them', 'yes the whole lot', 'yes each of them', 'yes every single one', 'yes everyone', 'yes, all of em',
  'todo', 'Sí, a todo', 'todas', 'todos los planes', 'las tres', 'ambos', 'lo que sea', 'cualquiera', 'sí, cada una', 'sí, todas ellas']) {
  ok(`"${r}" is a blanket reply`, isBlanketReply(r) === true);
}
for (const r of ['yes', 'no', 'sí', 'si', 'I authorize', 'ok', 'tall order', 'ballroom', 'totalmente', 'cada vez', 'lottery']) ok(`"${r}" is not a blanket reply`, isBlanketReply(r) === false);
for (const r of ["I don't know", 'I’m not sure', 'not sure', 'maybe', 'no idea', 'unsure', 'I guess', 'No estoy seguro', 'no estoy segura', 'no sé', 'No se', 'tal vez', 'quizás', 'no lo sé', 'no entiendo', 'prefiero hablar primero']) {
  ok(`"${r}" is an unsure reply`, isUnsureReply(r) === true);
}
for (const r of ['yes', 'no', 'sí', 'seguro que sí', 'maybelline', 'nose', 'yes I am sure']) ok(`"${r}" is not an unsure reply`, isUnsureReply(r) === false);
ok('nothing is nothing', isBlanketReply('') === false && isUnsureReply('') === false && isBlanketReply(null) === false && isUnsureReply(undefined) === false && isNegatedReply('') === false && isNegatedReply(null) === false);
// AUDIT 2026-10-04 (red team, HIGH) — a negation anywhere is a refusal.
for (const r of ['not', 'yes, not that one', 'yes, not really', 'yes I would rather not', 'yes but not now', 'yes, probably not', 'nope', 'nah', 'never', 'yes, never',
  'yes, that is not right', 'yes, not exactly', 'yes, not quite', 'yes but not the drug plan', 'yes, incorrect', 'yes, wrong', 'yes, that is mistaken', 'negative',
  "yes I don't want that", 'yes I dont want that', 'yes it isnt', 'yes I cant', 'yes, cancel that',
  'sí, tampoco', 'sí, nunca', 'sí, jamás', 'sí, incorrecto', 'sí, está mal', 'sí, esta mal', 'sí, equivocado', 'sí, ninguno', 'sí, cancele eso']) {
  ok(`"${r}" carries a negation`, isNegatedReply(r) === true);
}
for (const r of ['yes', 'sí', 'si', 'yes that is correct', 'I authorize', 'sí autorizo', 'yes I am sure', 'nothing', 'notable', 'knotted', 'cancelled flights', 'yes, all set', 'sí, correcto']) {
  ok(`"${r}" carries no negation`, isNegatedReply(r) === false);
}
ok('the negation tokens are whole words: "notable" and "nothing" do not contain "not"', isNegatedReply('notable') === false && isNegatedReply('nothing') === false && isNegatedReply('not able') === true);

// ── 6. One category, one reply ───────────────────────────────────────────────
const cls = (code, reply) => classifyCategoryReply(code, reply);
ok('"yes" to an authorizing category authorizes it', same(cls('MA_WITH_RX', 'yes'), { code: 'MA_WITH_RX', reply: 'yes', replyClass: 'GRANTED', decision: 'AUTHORIZED', problem: null }));
ok('"sí" too', cls('STANDALONE_RX', 'Sí.').decision === VOICE_DECISION.AUTHORIZED);
ok('"I authorize" too', cls('MA_NO_RX', 'I authorize').decision === VOICE_DECISION.AUTHORIZED);
ok('"no" declines', cls('MA_WITH_RX', 'No').decision === VOICE_DECISION.DECLINED && cls('MA_WITH_RX', 'No').replyClass === CONSENT_STATUS.DECLINED);
ok('"yes, but actually no" declines (a refusal anywhere wins — consent.js CT-01)', cls('MA_WITH_RX', 'yes, but actually no').decision === VOICE_DECISION.DECLINED);
// AUDIT 2026-10-04 (red team, HIGH) — these were AUTHORIZED: consent.js reads a short reply that opens with "yes" as a grant.
for (const r of ['yes, not that one', 'yes, not really', 'yes I would rather not', 'yes but not now', 'yes, probably not', 'yes, never', 'sí, tampoco', 'sí, nunca', 'sí, esa no']) {
  ok(`"${r}" DECLINES the category, whatever consent.js reads`, same(cls('MA_WITH_RX', r), { code: 'MA_WITH_RX', reply: r, replyClass: 'DECLINED', decision: 'DECLINED', problem: null }));
}
ok('"yes" to the unsure option is UNSURE, never an authorization', cls('UNSURE_DISCUSS_PROCESS', 'yes').decision === VOICE_DECISION.UNSURE);
ok('"no" to the unsure option declines it', cls('UNSURE_DISCUSS_PROCESS', 'no').decision === VOICE_DECISION.DECLINED);
ok('"not that one" to the unsure option declines it too', cls('UNSURE_DISCUSS_PROCESS', 'yes, not that one').decision === VOICE_DECISION.DECLINED);
ok('"I don\'t know" to a category is UNSURE', cls('MA_WITH_RX', "I don't know").decision === VOICE_DECISION.UNSURE && cls('MA_WITH_RX', "I don't know").problem === null);
ok('"not sure" to a category is UNSURE — uncertainty is judged before the negation', cls('MA_WITH_RX', 'not sure').decision === VOICE_DECISION.UNSURE && cls('MA_WITH_RX', 'yes, not sure').decision === VOICE_DECISION.UNSURE);
ok('"no estoy seguro" to a category is UNSURE, not a decline', cls('MA_WITH_RX', 'no estoy seguro').decision === VOICE_DECISION.UNSURE);
ok('"yes to everything" decides nothing for the category it was said to', cls('MA_WITH_RX', 'yes to everything').decision === null && cls('MA_WITH_RX', 'yes to everything').problem === P.BLANKET_REPLY_NOT_AUTHORIZATION);
ok('"yes every one" decides nothing either', cls('MA_WITH_RX', 'yes every one').problem === P.BLANKET_REPLY_NOT_AUTHORIZATION && cls('MA_WITH_RX', 'sí, cada una').problem === P.BLANKET_REPLY_NOT_AUTHORIZATION);
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
ok('for a reply with no negation the classification IS consent.js classifyReply, not a second copy', ['yes', 'no', 'ok', 'sí autorizo', 'yes I said no', ''].every((r) => cls('MA_WITH_RX', r).replyClass === classifyReply(r)));

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
// AUDIT 2026-10-04 (red team, HIGH) — the category the caller tried to decline is declined, and only the other one is authorized.
ok('"yes, not that one" to a category declines it: the capture authorizes the other one only', (() => {
  const r = captureCategoryDecisions(replies('no', 'yes, not that one', 'yes', 'no'));
  return r.ok === true && r.outcome === VOICE_CAPTURE_OUTCOME.AUTHORIZED && same(r.selectedCategories, ['STANDALONE_RX']) && same(r.declinedCategories, ['MA_NO_RX', 'MA_WITH_RX']) && r.decisions[1].decision === VOICE_DECISION.DECLINED;
})());
ok('"yes, not that one" to every category is incomplete', captureCategoryDecisions(replies('yes, not that one', 'yes, not really', 'sí, tampoco', 'no')).outcome === VOICE_CAPTURE_OUTCOME.SOA_INCOMPLETE);
// §31 "Senior says 'yes to everything' - system still presents categories individually."
for (const blanket of ['yes to everything', 'all of them', 'everything', 'todo', 'sí a todo', 'a todo', 'yes every one', 'yes each of them']) {
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
// AUDIT 2026-10-04 (red team, HIGH) — these CONFIRMED the read-back.
for (const r of ['yes, not exactly', 'yes, not quite', 'yes but not the drug plan', 'yes, that is not right', 'yes, incorrect', 'yes, wrong', 'yes, never mind', 'sí, está mal', 'sí, incorrecto', 'sí, tampoco']) {
  ok(`"${r}" to "Is that correct?" is a REJECTION, not a confirmation`, rb(['MA_WITH_RX', 'STANDALONE_RX'], r) === P.READ_BACK_REJECTED);
}
ok('"ok" does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'ok') === P.READ_BACK_NOT_CONFIRMED);
ok('silence does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], '') === P.READ_BACK_NOT_CONFIRMED);
ok('"yes to everything" does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'yes to everything') === P.READ_BACK_NOT_CONFIRMED);
ok('"I guess" does not confirm', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'I guess') === P.READ_BACK_NOT_CONFIRMED);
ok('"yes, not sure" is uncertainty, not a rejection', rb(['MA_WITH_RX', 'STANDALONE_RX'], 'yes, not sure') === P.READ_BACK_NOT_CONFIRMED);
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

// ── 9. Recording failure (§26, §31 "Recording fails mid-call") and the clock ─
const SEG = Object.freeze({ startedAt: '2026-10-10T14:00:00.000Z', endedAt: '2026-10-10T14:06:30.000Z', recordingActiveThroughout: true });
ok('a segment recorded throughout stands', recordingSegmentProblem(SEG, NOW_MS) === null && recordingSegmentProblem(SEG) === null);
ok('recording lost during the segment voids it', recordingSegmentProblem({ ...SEG, recordingActiveThroughout: false }, NOW_MS) === P.RECORDING_LOST_DURING_SEGMENT);
ok('a recorded loss instant voids it even if the flag says otherwise', recordingSegmentProblem({ ...SEG, recordingLostAt: '2026-10-10T14:03:00.000Z' }, NOW_MS) === P.RECORDING_LOST_DURING_SEGMENT);
ok('"active throughout" has to be exactly true', recordingSegmentProblem({ ...SEG, recordingActiveThroughout: 'true' }, NOW_MS) === P.RECORDING_LOST_DURING_SEGMENT && recordingSegmentProblem({ ...SEG, recordingActiveThroughout: 1 }, NOW_MS) === P.RECORDING_LOST_DURING_SEGMENT);
ok('a segment that does not say is lost', recordingSegmentProblem({ startedAt: SEG.startedAt, endedAt: SEG.endedAt }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a segment that ends before it starts is invalid', recordingSegmentProblem({ ...SEG, endedAt: '2026-10-10T13:59:59.000Z' }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a zero-length segment is invalid', recordingSegmentProblem({ ...SEG, endedAt: SEG.startedAt }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('an instant that does not exist is invalid', recordingSegmentProblem({ ...SEG, startedAt: '2026-02-31T00:00:00.000Z' }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a local time is invalid', recordingSegmentProblem({ ...SEG, startedAt: '2026-10-10T14:00:00' }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('no segment is invalid', recordingSegmentProblem(null, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID && recordingSegmentProblem('2026-10-10', NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
// AUDIT 2026-10-04 (red team) — a segment "recorded" in 2099 was valid.
ok('a segment that ends in the future of the clock is invalid', recordingSegmentProblem({ ...SEG, startedAt: '2026-10-12T12:30:00.000Z', endedAt: '2026-10-12T12:40:00.000Z' }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a segment in 2099 is invalid on the real clock, which is the default', recordingSegmentProblem({ ...SEG, startedAt: '2099-01-01T00:00:00.000Z', endedAt: '2099-01-01T00:05:00.000Z' }) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a segment that ends inside the clock tolerance stands (a skewed clock is not a future recording)',
  recordingSegmentProblem({ ...SEG, startedAt: '2026-10-12T11:55:00.000Z', endedAt: new Date(NOW_MS + CONSENT_CLOCK_TOLERANCE_MS - 1000).toISOString() }, NOW_MS) === null &&
  recordingSegmentProblem({ ...SEG, startedAt: '2026-10-12T11:55:00.000Z', endedAt: new Date(NOW_MS + CONSENT_CLOCK_TOLERANCE_MS + 1000).toISOString() }, NOW_MS) === P.SEGMENT_TIMESTAMPS_INVALID);
ok('a clock that is not a number refuses every segment', recordingSegmentProblem(SEG, NaN) === P.SEGMENT_TIMESTAMPS_INVALID && recordingSegmentProblem(SEG, '2026') === P.SEGMENT_TIMESTAMPS_INVALID);

// ── 10. The voice evidence block (§19) ───────────────────────────────────────
const INPUT = Object.freeze({
  contactReference: 'ghl:contact:C0123456789',
  appointmentId: 'appt_voice_1',
  recordingReference: 'ghl:call:CA0123456789/recording',
  transcriptReference: 'ghl:call:CA0123456789/transcript',
  segment: SEG,
  language: 'en',
  languageSource: 'BENEFICIARY_ELECTED',
  replies: replies('no', 'yes', 'yes', 'no'),
  readBack: Object.freeze({ items: Object.freeze(['MA_WITH_RX', 'STANDALONE_RX']), confirmReply: 'yes' }),
});
const built = buildVoiceEvidence(INPUT, withApproval());
ok('a complete, confirmed, recorded segment builds a voice evidence block', built.ok === true, built.reason);
const V = built.voice;
ok('the block names the contact the recording belongs to and the appointment it was taken for', V.contactReference === INPUT.contactReference && V.appointmentId === INPUT.appointmentId);
ok('the block carries the recording reference and the transcript pointer', V.recordingReference === INPUT.recordingReference && V.transcriptReference === INPUT.transcriptReference);
ok('the block carries the start and the end of the SOA segment', V.segment.startedAt === SEG.startedAt && V.segment.endedAt === SEG.endedAt && V.segment.recordingActiveThroughout === true);
ok('the block carries the exact script version, the digest of the script actually spoken and its approval',
  V.scriptVersion === APPROVED.version && V.scriptDigest === APPROVED_DIGEST && V.scriptDigest !== VOICE_SCRIPT_DIGEST && same(V.scriptApproval, { approvedBy: 'Sawil Reyes', approvedOn: '2026-10-05' }));
ok('the block carries the language and its election', V.language === 'en' && V.languageSource === 'BENEFICIARY_ELECTED' && V.representativeRelationship === null);
ok('the block carries the exact lines spoken', same(V.scriptLines, assembleVoiceScript('en', APPROVED)));
ok('the block carries every category decision with its reply and classification', V.decisions.length === 4 && V.decisions.every((d) => typeof d.reply === 'string' && d.replyClass && d.decision));
ok('the block carries the scope', same(V.selectedCategories, ['MA_WITH_RX', 'STANDALONE_RX']) && same(V.declinedCategories, ['MA_NO_RX']));
ok('the block carries the confirmed read-back', same(V.readBack, { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'yes', confirmReplyClass: 'GRANTED' }));
ok('the block is frozen all the way down', unfrozenPaths(V, 'voice').length === 0);
ok('the block passes its own rule', voiceEvidenceProblem(V, withApproval()) === null);
// AUDIT 2026-10-04 (red team, MEDIUM) — the flag was enforced by the offer gate only.
ok('with the repository defaults the block is refused by name: the flag is off', voiceEvidenceProblem(V) === P.VOICE_SOA_DISABLED && buildVoiceEvidence(INPUT).ok === false && buildVoiceEvidence(INPUT).reason === P.VOICE_SOA_DISABLED);
ok('the flag on, the repository script still pending: refused by name',
  voiceEvidenceProblem(V, { enabled: true, today: TODAY, nowMs: NOW_MS }) === P.VOICE_SCRIPT_NOT_APPROVED && buildVoiceEvidence(INPUT, { enabled: true, today: TODAY, nowMs: NOW_MS }).reason === P.VOICE_SCRIPT_NOT_APPROVED);
ok('"enabled" has to be exactly true, at both stages',
  voiceEvidenceProblem(V, withApproval({ enabled: 'true' })) === P.VOICE_SOA_DISABLED && voiceEvidenceProblem(V, withApproval({ enabled: 1 })) === P.VOICE_SOA_DISABLED &&
  buildVoiceEvidence(INPUT, withApproval({ enabled: 'true' })).reason === P.VOICE_SOA_DISABLED && buildVoiceEvidence(INPUT, withApproval({ enabled: 1 })).reason === P.VOICE_SOA_DISABLED);
ok('the flag is judged before the approval, and both before anything is read',
  buildVoiceEvidence(INPUT, withApproval({ enabled: false, script: VOICE_SOA_SCRIPT })).reason === P.VOICE_SOA_DISABLED && buildVoiceEvidence(null, withApproval({ enabled: false })).reason === P.VOICE_SOA_DISABLED &&
  buildVoiceEvidence(null, withApproval({ script: VOICE_SOA_SCRIPT })).reason === P.VOICE_SCRIPT_NOT_APPROVED && buildVoiceEvidence(null, withApproval()).reason === P.VOICE_EVIDENCE_INCOMPLETE &&
  voiceEvidenceProblem(null, withApproval({ enabled: false })) === P.VOICE_SOA_DISABLED && voiceEvidenceProblem(null, withApproval({ script: VOICE_SOA_SCRIPT })) === P.VOICE_SCRIPT_NOT_APPROVED && voiceEvidenceProblem(null, withApproval()) === P.VOICE_EVIDENCE_INCOMPLETE);
ok('the digest the block must carry is the one the caller names, not a constant: the pending digest is refused against an approved script',
  voiceEvidenceProblem(V, withApproval({ scriptDigest: VOICE_SCRIPT_DIGEST })) === P.VOICE_SCRIPT_VERSION_MISMATCH && voiceEvidenceProblem(V, { enabled: true, script: APPROVED, today: TODAY, nowMs: NOW_MS }) === P.VOICE_SCRIPT_VERSION_MISMATCH);
ok('a representative election builds with the representative', (() => {
  const r = buildVoiceEvidence({ ...INPUT, languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: ' Daughter ' }, withApproval());
  return r.ok === true && r.voice.representativeRelationship === 'Daughter' && r.voice.languageSource === 'REPRESENTATIVE_ELECTED';
})());
for (const [what, patch, reason, code] of [
  ['no contact reference', { contactReference: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['no appointment named', { appointmentId: null }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['an appointment that is not text', { appointmentId: 7 }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['no recording reference', { recordingReference: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['no transcript pointer', { transcriptReference: null }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a recording reference that is not text', { recordingReference: 42 }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['recording lost during the segment', { segment: { ...SEG, recordingActiveThroughout: false } }, P.RECORDING_LOST_DURING_SEGMENT],
  ['a segment with no end', { segment: { startedAt: SEG.startedAt, recordingActiveThroughout: true } }, P.SEGMENT_TIMESTAMPS_INVALID],
  ['a segment in the future of the clock', { segment: { ...SEG, startedAt: '2026-10-12T12:30:00.000Z', endedAt: '2026-10-12T12:40:00.000Z' } }, P.SEGMENT_TIMESTAMPS_INVALID],
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
  ['"yes, not that one" to a category — declined, so a read-back of both no longer matches', { replies: replies('no', 'yes, not that one', 'yes', 'no') }, P.READ_BACK_MISMATCH],
  ['a read-back that differs from the answers', { readBack: { items: ['MA_NO_RX', 'STANDALONE_RX'], confirmReply: 'yes' } }, P.READ_BACK_MISMATCH],
  ['a read-back the caller rejected', { readBack: { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'no' } }, P.READ_BACK_REJECTED],
  ['a read-back answered "yes, that is not right"', { readBack: { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'yes, that is not right' } }, P.READ_BACK_REJECTED],
  ['a read-back answered "ok"', { readBack: { items: ['MA_WITH_RX', 'STANDALONE_RX'], confirmReply: 'ok' } }, P.READ_BACK_NOT_CONFIRMED],
  ['no read-back', { readBack: null }, P.READ_BACK_NOT_CONFIRMED],
  ['an input with a key the rule does not know', { carrier: 'x' }, P.VOICE_EVIDENCE_INCOMPLETE],
]) {
  const r = buildVoiceEvidence({ ...INPUT, ...patch }, withApproval());
  ok(`nothing is built from ${what}: ${reason}`, r.ok === false && r.reason === reason && (code === undefined || r.code === code), `got ${r.reason}/${r.code}`);
}
ok('nothing is built from nothing', buildVoiceEvidence(null, withApproval()).reason === P.VOICE_EVIDENCE_INCOMPLETE);

// The block's own rule, against tampered blocks: every field the record exists to protect is judged.
const tampered = (patch) => voiceEvidenceProblem({ ...V, ...patch }, withApproval());
for (const [what, patch, reason] of [
  ['the contact reference removed', { contactReference: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['the appointment removed', { appointmentId: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['the recording reference removed', { recordingReference: '' }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['the segment marked lost', { segment: { ...V.segment, recordingActiveThroughout: false } }, P.RECORDING_LOST_DURING_SEGMENT],
  ['the segment moved into the future', { segment: { ...V.segment, startedAt: '2026-10-12T12:30:00.000Z', endedAt: '2026-10-12T12:40:00.000Z' } }, P.SEGMENT_TIMESTAMPS_INVALID],
  ['another script version', { scriptVersion: 'CP-SOA-VOICE-SCRIPT-CY2027-v9.9' }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['another digest', { scriptDigest: sha('x') }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['the pending script\'s digest on a block from the approved script', { scriptDigest: VOICE_SCRIPT_DIGEST }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['an approval that is not the script\'s', { scriptApproval: { approvedBy: 'Claude', approvedOn: '2026-10-05' } }, P.VOICE_SCRIPT_NOT_APPROVED],
  ['the Spanish lines on an English block', { scriptLines: assembleVoiceScript('es', APPROVED) }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['one spoken line paraphrased', { scriptLines: V.scriptLines.map((l, i) => (i === 3 ? { ...l, text: 'MA plan. Yes or no?' } : l)) }, P.VOICE_SCRIPT_VERSION_MISMATCH],
  ['a decision widened after the fact', { decisions: V.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, reply: 'yes', replyClass: 'GRANTED', decision: 'AUTHORIZED' } : d)) }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a decision relabelled without its reply', { decisions: V.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, decision: 'AUTHORIZED' } : d)) }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a reply rewritten to "yes, not that one" under an AUTHORIZED decision', { decisions: V.decisions.map((d) => (d.code === 'MA_WITH_RX' ? { ...d, reply: 'yes, not that one' } : d)) }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a selected category the replies do not support', { selectedCategories: ['MA_NO_RX', 'MA_WITH_RX', 'STANDALONE_RX'] }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a declined list that disagrees with the replies', { declinedCategories: [] }, P.VOICE_EVIDENCE_INCOMPLETE],
  ['a read-back that no longer matches', { readBack: { ...V.readBack, items: ['MA_WITH_RX'] } }, P.READ_BACK_MISMATCH],
  ['a read-back class that was not a grant', { readBack: { ...V.readBack, confirmReplyClass: 'UNCLEAR' } }, P.READ_BACK_NOT_CONFIRMED],
  ['a read-back reply that was not a yes, however it is labelled', { readBack: { ...V.readBack, confirmReply: 'ok' } }, P.READ_BACK_NOT_CONFIRMED],
  ['a read-back reply of "yes, incorrect", labelled a grant', { readBack: { ...V.readBack, confirmReply: 'yes, incorrect' } }, P.READ_BACK_REJECTED],
  ['a language that was not elected', { languageSource: 'INFERRED_FROM_LEAD' }, P.SOA_LANGUAGE_NOT_ELECTED],
  ['a key the block does not have', { extra: true }, P.VOICE_EVIDENCE_INCOMPLETE],
]) {
  ok(`the block's rule catches ${what}: ${reason}`, tampered(patch) === reason, `got ${tampered(patch)}`);
}
ok('the block\'s rule reads its own data, never a getter', voiceEvidenceProblem(Object.defineProperty({ ...V }, 'recordingReference', { get: () => 'rec', enumerable: true }), withApproval()) === P.VOICE_EVIDENCE_INCOMPLETE);
ok('a block with a key missing is incomplete', voiceEvidenceProblem((() => { const { scriptDigest, ...rest } = V; return rest; })(), withApproval()) === P.VOICE_EVIDENCE_INCOMPLETE);
ok('a block without its binding is incomplete', voiceEvidenceProblem((() => { const { contactReference, ...rest } = V; return rest; })(), withApproval()) === P.VOICE_EVIDENCE_INCOMPLETE);

// ── 11. Through evidence.js: refused in the repository, inside the hash on an approved copy of the tree ─
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
const signedAt = SEG.endedAt;
const liveRecord = (instance, extra = {}) => buildEvidenceRecord(instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt, voice: V, ...extra });
throws('a voice instance cannot be evidenced without its voice block', () => buildEvidenceRecord(voiceInst.instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt }), /VOICE_EVIDENCE_MISSING/);
throws('nor with a null block', () => liveRecord(voiceInst.instance, { voice: null }), /VOICE_EVIDENCE_MISSING/);
// AUDIT 2026-10-04 (red team, MEDIUM) — the write stage never consulted the flag; and evidence.js took a `voiceScript` option.
throws('in the repository the flag is off: a block from an approved script is refused by name at the write stage', () => liveRecord(voiceInst.instance), /VOICE_SOA_DISABLED/);
throws('and no option switches it on, approves the script, substitutes one, names a digest or moves the clock — there is no seam',
  () => liveRecord(voiceInst.instance, { voiceScript: APPROVED, script: APPROVED, enabled: true, scriptDigest: APPROVED_DIGEST, today: TODAY, nowMs: NOW_MS }), /VOICE_SOA_DISABLED/);
throws('a written instance refuses a voice block', () => liveRecord(createSoaInstance({ ...voiceInput, method: 'WEB_ELECTRONIC_SIGNATURE', scriptVersion: SOA_SCRIPT_VERSION }).instance), /NOT_A_VOICE_INSTANCE/);
throws('the signature/affirmation is still required', () => liveRecord(voiceInst.instance, { signature: '' }), /signature/);
ok('the contradiction rule, called directly, names what disagrees',
  voiceInstanceContradiction(voiceInst.instance, V) === null &&
  voiceInstanceContradiction({ ...voiceInst.instance, language: 'es' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, representativeRelationship: 'Son' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, declinedCategories: [] }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, method: 'SMS_LINK_ELECTRONIC' }, V) === P.NOT_A_VOICE_INSTANCE &&
  voiceInstanceContradiction(null, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction(voiceInst.instance, null) === P.VOICE_EVIDENCE_INCOMPLETE);
// AUDIT 2026-10-04 (red team, MEDIUM) — the offer gate's format refusals, enforced again at the write stage.
ok('the contradiction rule refuses an in-person, home-visit or unknown appointment format, by the offer gate\'s names',
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: 'IN_PERSON' }, V) === P.IN_PERSON_REQUIRES_WRITTEN_SOA &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: 'in person' }, V) === P.IN_PERSON_REQUIRES_WRITTEN_SOA &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: 'In-Person' }, V) === P.IN_PERSON_REQUIRES_WRITTEN_SOA &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: 'HOME_VISIT' }, V) === P.UNKNOWN_APPOINTMENT_FORMAT &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: ['TELEPHONE'] }, V) === P.UNKNOWN_APPOINTMENT_FORMAT &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: undefined }, V) === P.UNKNOWN_APPOINTMENT_FORMAT &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: 'VIDEO' }, V) === null);
ok('the format is judged before the block is read', voiceInstanceContradiction({ ...voiceInst.instance, appointmentFormat: 'IN_PERSON' }, null) === P.IN_PERSON_REQUIRES_WRITTEN_SOA);
ok('the block evidences the appointment it names and no other',
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentId: 'appt_voice_2' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, appointmentId: '' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction(voiceInst.instance, { ...V, appointmentId: 'appt_voice_2' }) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE);
ok('an instance that records the unsure option as selected is contradicted by a block in which it was declined',
  voiceInstanceContradiction({ ...voiceInst.instance, nonAuthorizingSelections: ['UNSURE_DISCUSS_PROCESS'] }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, nonAuthorizingSelections: 'none' }, V) === P.VOICE_EVIDENCE_CONTRADICTS_INSTANCE &&
  voiceInstanceContradiction({ ...voiceInst.instance, nonAuthorizingSelections: [] }, V) === null);
{
  // The written path is untouched: same record, same hash, no voice key.
  const webInst = createSoaInstance({ ...voiceInput, soaId: 'soa_web_1', method: 'WEB_ELECTRONIC_SIGNATURE', scriptVersion: SOA_SCRIPT_VERSION }).instance;
  const { record } = buildEvidenceRecord(webInst, { stateName: 'New York', signature: 'Jane Q Public', signedAt });
  ok('a written record carries no voice key at all, so its hash is what it always was', !('voice' in record) && !('spokenScriptVersion' in record.textSnapshot) && verifyEvidence(record).ok === true);
  ok('and still verifies against a hash computed without the key', verifyEvidence({ ...record, voice: undefined }).ok === true);
}

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
  const load = (root, file) => import(pathToFileURL(join(root, 'api', '_lib', 'cy2027', file)).href + '?t=' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const repin = async (root) => {
    const mod = await load(root, 'voice-soa.js');
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

  // The tree as the owner would commit it: approval recorded, flag on, digest re-pinned.
  const approvedRoot = makeTree();
  edit(approvedRoot, VS, FLAG_OFF, FLAG_ON);
  edit(approvedRoot, VS, PENDING, approvedBy('Sawil Reyes'));
  await repin(approvedRoot);
  const A = { voice: await load(approvedRoot, 'voice-soa.js'), evidence: await load(approvedRoot, 'evidence.js') };
  ok('the approved copy is the repository with the owner approval recorded, the flag on and the digest re-pinned to the approved payload',
    A.voice.VOICE_SOA_ENABLED === true && A.voice.voiceScriptApprovalProblem() === null && A.voice.VOICE_SCRIPT_DIGEST === sha(A.voice.voiceScriptPayload()) &&
    A.voice.VOICE_SCRIPT_DIGEST === APPROVED_DIGEST && A.voice.VOICE_SOA_SCRIPT.version === VOICE_SOA_SCRIPT.version && A.voice.VOICE_SOA_SCRIPT.approvedBy === 'Sawil Reyes');
  const builtA = A.voice.buildVoiceEvidence(INPUT);
  ok('on it the block builds from the defaults alone: the flag, the repository script, its pinned digest and the real clock', builtA.ok === true && same(builtA.voice, V), builtA.reason);
  const VA = builtA.voice;
  ok('and passes its own rule with no option; the live copy of the block passes there too, being the same data', A.voice.voiceEvidenceProblem(VA) === null && A.voice.voiceEvidenceProblem(V) === null);
  ok('on the copy the offer gate opens on the repository defaults', A.voice.voiceSoaOfferProblem(CTX) === null);
  const evidenceOf = (instance, extra = {}) => A.evidence.buildEvidenceRecord(instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt, voice: VA, ...extra });
  throws('nor with a block whose recording was lost', () => evidenceOf(voiceInst.instance, { voice: { ...VA, segment: { ...VA.segment, recordingActiveThroughout: false } } }), /RECORDING_LOST_DURING_SEGMENT/);
  throws('nor with a block in another language than the instance', () => evidenceOf(voiceInst.instance, { voice: A.voice.buildVoiceEvidence({ ...INPUT, language: 'es' }).voice }), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
  throws('nor with a block whose election differs from the instance', () => evidenceOf(createSoaInstance({ ...voiceInput, languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: 'Son' }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
  throws('nor with a block whose scope differs from the instance', () => evidenceOf(createSoaInstance({ ...voiceInput, selectedCategories: ['MA_WITH_RX'] }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
  throws('nor with a block whose scope is wider than the instance', () => evidenceOf(createSoaInstance({ ...voiceInput, selectedCategories: AUTHORIZING_CATEGORY_CODES.slice() }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
  throws('nor with an instance that names another script version', () => evidenceOf(createSoaInstance({ ...voiceInput, scriptVersion: SOA_SCRIPT_VERSION }).instance), /VOICE_SCRIPT_VERSION_MISMATCH/);
  throws('nor for an in-person appointment: the write stage enforces what the offer gate refuses', () => evidenceOf(createSoaInstance({ ...voiceInput, appointmentFormat: 'IN_PERSON' }).instance), /IN_PERSON_REQUIRES_WRITTEN_SOA/);
  throws('nor "in person", lower case', () => evidenceOf(createSoaInstance({ ...voiceInput, appointmentFormat: 'in person' }).instance), /IN_PERSON_REQUIRES_WRITTEN_SOA/);
  throws('nor "In-Person"', () => evidenceOf(createSoaInstance({ ...voiceInput, appointmentFormat: 'In-Person' }).instance), /IN_PERSON_REQUIRES_WRITTEN_SOA/);
  throws('nor a home visit (not on the list — refused, never treated as remote)', () => evidenceOf({ ...voiceInst.instance, appointmentFormat: 'HOME_VISIT' }), /UNKNOWN_APPOINTMENT_FORMAT/);
  throws('nor an instance with no format', () => evidenceOf({ ...voiceInst.instance, appointmentFormat: undefined }), /UNKNOWN_APPOINTMENT_FORMAT/);
  throws('nor another appointment than the block names: one segment evidences one appointment', () => evidenceOf(createSoaInstance({ ...voiceInput, soaId: 'soa_voice_2', appointmentId: 'appt_voice_2', beneficiaryName: 'John Other' }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
  throws('nor an instance that records the unsure option as selected', () => evidenceOf(createSoaInstance({ ...voiceInput, selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX', 'UNSURE_DISCUSS_PROCESS'] }).instance), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
  throws('nor with a segment that ends after the affirmation', () => evidenceOf(voiceInst.instance, { signedAt: '2026-10-10T14:03:00.000Z' }), /SEGMENT_AFTER_AFFIRMATION/);
  throws('nor signed before the segment began', () => evidenceOf(voiceInst.instance, { signedAt: '2026-10-10T13:00:00.000Z' }), /SEGMENT_AFTER_AFFIRMATION/);
  throws('nor with an affirmation instant that is not an instant', () => evidenceOf(voiceInst.instance, { signedAt: 'yesterday' }), /SEGMENT_AFTER_AFFIRMATION/);
  ok('an affirmation at the end of the segment, or after it, stands', (() => { evidenceOf(voiceInst.instance); evidenceOf(voiceInst.instance, { signedAt: '2026-10-10T14:07:00.000Z' }); return true; })());
  throws('the signature/affirmation is still required on the copy', () => evidenceOf(voiceInst.instance, { signature: '' }), /signature/);
  // The red team's chain, end to end, on the copy: the category the caller tried to decline never reaches the gate.
  {
    const declinedChain = A.voice.buildVoiceEvidence({ ...INPUT, replies: replies('no', 'yes, not that one', 'yes', 'no'), readBack: { items: ['STANDALONE_RX'], confirmReply: 'yes' } });
    ok('"yes, not that one" declines the category: the block authorizes the other one only', declinedChain.ok === true && same(declinedChain.voice.selectedCategories, ['STANDALONE_RX']) && same(declinedChain.voice.declinedCategories, ['MA_NO_RX', 'MA_WITH_RX']), declinedChain.reason);
    throws('and an instance that claims both is contradicted at the write stage', () => evidenceOf(voiceInst.instance, { voice: declinedChain.voice }), /VOICE_EVIDENCE_CONTRADICTS_INSTANCE/);
    ok('"yes, that is not right" to the read-back builds nothing', A.voice.buildVoiceEvidence({ ...INPUT, replies: replies('no', 'yes, not that one', 'yes', 'no'), readBack: { items: ['STANDALONE_RX'], confirmReply: 'yes, that is not right' } }).reason === P.READ_BACK_REJECTED);
    const narrow = createSoaInstance({ ...voiceInput, selectedCategories: ['STANDALONE_RX'] }).instance;
    const { record, integrityHash } = evidenceOf(narrow, { voice: declinedChain.voice });
    const done = completeSoaInstance(narrow, { completedAt: signedAt, integrityHash, evidenceReference: 'ev_voice_narrow' });
    const g = marketingGate(done, { appointmentId: 'appt_voice_1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' }, CMS_RULESET_2027);
    ok('the gate opens on the one category that was authorized and never on the one the caller declined', g.allowed === true && same(g.authorizedCategories, ['STANDALONE_RX']) && same(record.voice.declinedCategories, ['MA_NO_RX', 'MA_WITH_RX']), JSON.stringify(g));
  }
  {
    const { record, integrityHash } = evidenceOf(voiceInst.instance);
    ok('a voice record builds and verifies', A.evidence.verifyEvidence(record).ok === true && record.integrityHash === integrityHash);
    ok('the voice block is in the record', same(record.voice, VA));
    ok('the voice block is INSIDE the hash: the hash of the same record without it differs',
      A.evidence.verifyEvidence({ ...record, voice: undefined }).reason === 'HASH_MISMATCH');
    for (const [what, patch] of [
      ['the contact reference', { contactReference: 'ghl:contact:OTHER' }],
      ['the appointment', { appointmentId: 'appt_other' }],
      ['the recording reference', { recordingReference: 'ghl:call:OTHER/recording' }],
      ['the transcript pointer', { transcriptReference: 'ghl:call:OTHER/transcript' }],
      ['the segment start', { segment: { ...VA.segment, startedAt: '2026-10-10T13:00:00.000Z' } }],
      ['the segment end', { segment: { ...VA.segment, endedAt: '2026-10-10T14:07:00.000Z' } }],
      ['the script version', { scriptVersion: 'CP-SOA-VOICE-SCRIPT-CY2027-v9.9' }],
      ['the script digest', { scriptDigest: sha('x') }],
      ['the approval', { scriptApproval: { approvedBy: 'Someone Else', approvedOn: '2026-10-05' } }],
      ['the language election', { languageSource: 'REPRESENTATIVE_ELECTED' }],
      ['a spoken line', { scriptLines: VA.scriptLines.map((l, i) => (i === 0 ? { ...l, text: l.text + ' Trust me.' } : l)) }],
      ['a category decision', { decisions: VA.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, decision: 'AUTHORIZED' } : d)) }],
      ['a reply', { decisions: VA.decisions.map((d) => (d.code === 'MA_NO_RX' ? { ...d, reply: 'yes' } : d)) }],
      ['the scope', { selectedCategories: ['MA_NO_RX', 'MA_WITH_RX', 'STANDALONE_RX'] }],
      ['the read-back', { readBack: { ...VA.readBack, items: ['MA_WITH_RX'] } }],
      ['the read-back reply', { readBack: { ...VA.readBack, confirmReply: 'ok' } }],
    ]) {
      ok(`tampering with ${what} inside the stored block is detected`, A.evidence.verifyEvidence({ ...record, voice: { ...record.voice, ...patch } }).reason === 'HASH_MISMATCH');
    }
    ok('the record is classed for retention and keeps the signed instant', record.recordClass === 'SOA_EVIDENCE' && record.signedAt === signedAt && record.createdAt === signedAt);
    // AUDIT 2026-10-04 (red team) — the snapshot is labelled with the version of the text it holds; the spoken script is named separately.
    ok('the text snapshot is the approved text in the instance\'s language, labelled with ITS version, and names the spoken script separately',
      record.textSnapshot.language === 'en' && record.textSnapshot.scriptVersion === SOA_SCRIPT_VERSION && record.textSnapshot.spokenScriptVersion === VA.scriptVersion &&
      record.scriptVersion === VA.scriptVersion && record.voice.scriptVersion === VA.scriptVersion && record.textSnapshot.important === SOA_TEXT.en.important);
    ok('the spoken-script label is inside the hash', A.evidence.verifyEvidence({ ...record, textSnapshot: { ...record.textSnapshot, spokenScriptVersion: 'CP-SOA-VOICE-SCRIPT-CY2027-v9.9' } }).reason === 'HASH_MISMATCH');
    // The same hash, computed the same way, twice.
    ok('the hash is deterministic', evidenceOf(voiceInst.instance).integrityHash === integrityHash);
    // Completed with that hash, the instance passes the marketing gate for a telephone appointment and not for an in-person one.
    const done = completeSoaInstance(voiceInst.instance, { completedAt: signedAt, integrityHash, evidenceReference: 'ev_voice_1' });
    const appt = { appointmentId: 'appt_voice_1', startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
    ok('a completed, evidenced voice SOA opens the gate for the telephone appointment it was recorded for', marketingGate(done, appt, CMS_RULESET_2027).allowed === true, marketingGate(done, appt, CMS_RULESET_2027).reason);
    ok('and never for an in-person one (§31 "Home visit requested with voice-only SOA")', marketingGate(done, { ...appt, format: 'IN_PERSON' }, CMS_RULESET_2027).allowed === false);
  }
  {
    // The written path on the copy is byte-identical to the repository's.
    const webInst = createSoaInstance({ ...voiceInput, soaId: 'soa_web_1', method: 'WEB_ELECTRONIC_SIGNATURE', scriptVersion: SOA_SCRIPT_VERSION }).instance;
    const live = buildEvidenceRecord(webInst, { stateName: 'New York', signature: 'Jane Q Public', signedAt });
    const copy = A.evidence.buildEvidenceRecord(webInst, { stateName: 'New York', signature: 'Jane Q Public', signedAt });
    ok('a written record is the same record, with the same hash, whether the flag is on or off', same(live.record, copy.record) && live.integrityHash === copy.integrityHash);
  }
  {
    // AUDIT 2026-10-04 (red team) — the digest in the block is checked against the script in force, not only against the constant.
    const staleRoot = makeTree();
    edit(staleRoot, VS, FLAG_OFF, FLAG_ON);
    edit(staleRoot, VS, PENDING, approvedBy('Sawil Reyes'));
    await repin(staleRoot);
    edit(staleRoot, VS, `export const VOICE_SCRIPT_DIGEST = '${APPROVED_DIGEST}';`, `export const VOICE_SCRIPT_DIGEST = '${sha('stale pin')}';`);
    const S = { voice: await load(staleRoot, 'voice-soa.js'), evidence: await load(staleRoot, 'evidence.js') };
    const VS_ = S.voice.buildVoiceEvidence(INPUT).voice;
    ok('a copy whose pinned digest is stale still passes the block\'s own rule (it compares with the constant)', S.voice.voiceEvidenceProblem(VS_) === null && VS_.scriptDigest === sha('stale pin'));
    throws('but evidence.js recomputes the digest of the script in force and refuses the block by name', () => S.evidence.buildEvidenceRecord(voiceInst.instance, { stateName: 'New York', signature: 'VOICE_AFFIRMATION:yes', signedAt, voice: VS_ }), /VOICE_SCRIPT_DIGEST_MISMATCH/);
  }

  // ── 12. The build gates: observed failing on a defective tree ──────────────
  {
    const selfMod = await runGate();
    ok('the repository passes the self-modification gate with the voice tables registered', selfMod.problems.length === 0 && selfMod.frozenCount === selfMod.objectCount && selfMod.objectCount >= 48, selfMod.problems.join(' | ') + ` ${selfMod.frozenCount}/${selfMod.objectCount}`);
    const loose = await runGate({ apiFiles: [{ path: 'api/ok.js', source: 'export const a = 1;' }], srcFiles: [{ path: 'src/ok.ts', source: 'export const b = 2;' }], objects: { VOICE_SOA_SCRIPT: { ...VOICE_SOA_SCRIPT, en: { ...VOICE_SOA_SCRIPT.en } } } });
    ok('an unfrozen voice script is reported by the gate', loose.problems.some((p) => /^VOICE_SOA_SCRIPT is not frozen all the way down/.test(p)), loose.problems.join(' | '));
    const looseTokens = await runGate({ apiFiles: [{ path: 'api/ok.js', source: 'export const a = 1;' }], srcFiles: [{ path: 'src/ok.ts', source: 'export const b = 2;' }], objects: { VOICE_NEGATIVE_TOKENS: [...VOICE_NEGATIVE_TOKENS] } });
    ok('an unfrozen negation list is reported by the gate', looseTokens.problems.some((p) => /^VOICE_NEGATIVE_TOKENS is not frozen all the way down/.test(p)), looseTokens.problems.join(' | '));
    const written = await runGate({ apiFiles: [{ path: 'api/bad.js', source: "import { VOICE_SOA_ENABLED } from './_lib/cy2027/voice-soa.js';\nVOICE_SOA_ENABLED = true;" }], srcFiles: [], objects: { X: Object.freeze({}) } });
    ok('a runtime write to the flag is reported by the gate', written.problems.some((p) => /api\/bad\.js: writes to VOICE_SOA_ENABLED/.test(p)), written.problems.join(' | '));
    const pushed = await runGate({ apiFiles: [{ path: 'api/bad.js', source: "import { BLANKET_REPLIES } from './_lib/cy2027/voice-soa.js';\nBLANKET_REPLIES.push('x');" }], srcFiles: [], objects: { X: Object.freeze({}) } });
    ok('a push onto a reply list is reported by the gate', pushed.problems.some((p) => /api\/bad\.js: mutates BLANKET_REPLIES in place/.test(p)), pushed.problems.join(' | '));
    const popped = await runGate({ apiFiles: [{ path: 'api/bad.js', source: "import { VOICE_NEGATIVE_TOKENS } from './_lib/cy2027/voice-soa.js';\nVOICE_NEGATIVE_TOKENS.pop();" }], srcFiles: [], objects: { X: Object.freeze({}) } });
    ok('a pop off the negation list is reported by the gate', popped.problems.some((p) => /api\/bad\.js: mutates VOICE_NEGATIVE_TOKENS in place/.test(p)), popped.problems.join(' | '));
  }
  {
    const clean = runParity(makeTree());
    ok('parity gate: an untouched copy of the tree passes', clean.status === 0, clean.out.slice(0, 400));
    ok('parity gate: and reports the voice script digest and the disabled flag',
      new RegExp(`voice SOA script ${escapeRe(VOICE_SOA_SCRIPT.version)} digest OK`).test(clean.out) && /voice SOA disabled; script PENDING_OWNER_APPROVAL/.test(clean.out), clean.out.slice(0, 600));

    const edited = makeTree();
    edit(edited, VS, "    unsureLead: 'You may also choose this option:',", "    unsureLead: 'You may also choose this option, which most people pick:',");
    const r1 = runParity(edited);
    ok('parity gate: a connecting sentence edited without a re-pin FAILS the build', r1.status === 1 && /VOICE_SCRIPT_DIGEST was not re-pinned/.test(r1.out), r1.out.slice(0, 400));

    const editedClose = makeTree();
    edit(editedClose, VS, "    savedClose: 'Your Scope of Appointment has been recorded.',", "    savedClose: 'Your Scope of Appointment has been recorded and you are all set.',");
    const r1b = runParity(editedClose);
    ok('parity gate: the §21 "saved" close edited without a re-pin FAILS the build', r1b.status === 1 && /VOICE_SCRIPT_DIGEST was not re-pinned/.test(r1b.out), r1b.out.slice(0, 400));

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

    const r5 = runParity(approvedRoot);
    ok('parity gate: the flag on over a script approved by a person on a day, digest re-pinned, PASSES', r5.status === 0 && /voice SOA ENABLED; script APPROVED/.test(r5.out), r5.out.slice(0, 600));

    const placeholder = makeTree();
    edit(placeholder, VS, `export const VOICE_SCRIPT_DIGEST = '${VOICE_SCRIPT_DIGEST}';`, "export const VOICE_SCRIPT_DIGEST = 'sha256:PENDING_FIRST_PIN';");
    const r6 = runParity(placeholder);
    ok('parity gate: the placeholder digest FAILS the build and prints the value to pin', r6.status === 1 && /VOICE_SCRIPT_DIGEST is still the placeholder/.test(r6.out) && r6.out.includes(VOICE_SCRIPT_DIGEST), r6.out.slice(0, 400));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ── 13. Server-only, wired once, registered — what must be ABSENT is scanned ─
{
  ok('voice-soa.js is not re-exported by the shared barrel', !('voiceSoaOfferProblem' in barrelModule) && !('VOICE_SOA_SCRIPT' in barrelModule) && !('buildVoiceEvidence' in barrelModule));
  ok('(source) the barrel does not reach voice-soa.js', !/voice-soa/.test(strip(read('../api/_lib/cy2027/index.js'), 'api/_lib/cy2027/index.js')));
  ok('(source) the client barrel does not reach voice-soa.js', !/voice-soa/.test(strip(read('../src/lib/cy2027.ts'), 'src/lib/cy2027.ts')));
  const EV = strip(read('../api/_lib/cy2027/evidence.js'), 'api/_lib/cy2027/evidence.js');
  ok('(source) evidence.js takes the voice rules, the payload and the vocabulary from the one module',
    line(/import \{ voiceEvidenceProblem, voiceInstanceContradiction, voiceScriptPayload, VOICE_SOA_PROBLEM \} from '\.\/voice-soa\.js';/).test(EV));
  // AUDIT 2026-10-04 (red team) — the `voiceScript` seam is gone; the block is judged with no option.
  ok('(source) the block is judged with no option: the flag, the script, the digest and the clock are the repository\'s',
    line(/const voiceProblem = voiceEvidenceProblem\(voice\);/).test(EV) && !/\bvoiceScript\b/.test(EV));
  ok('(source) the digest in the block is compared with the digest of the script in force, computed in evidence.js',
    line(/const digestInForce = 'sha256:' \+ crypto\.createHash\('sha256'\)\.update\(voiceScriptPayload\(\), 'utf8'\)\.digest\('hex'\);/).test(EV) && line(/if \(voice\.scriptDigest !== digestInForce\) throw/).test(EV));
  ok('(source) the voice block is spread into the hashed core, for a voice instance only', line(/\.\.\.\(isVoice \? \{ voice \} : \{\}\),/).test(EV) && EV.indexOf('...(isVoice ? { voice } : {}),') < EV.indexOf('const hash = integrityHash(core);'));
  ok('(source) voice-soa.js imports only sibling modules — no Node API, no package',
    [...strip(read('../api/_lib/cy2027/voice-soa.js'), 'api/_lib/cy2027/voice-soa.js').matchAll(/from\s+'([^']+)'/g)].every((m) => /^\.\/[\w-]+\.js$/.test(m[1])));
  // Nothing under api/ but evidence.js reaches voice-soa.js, so no handler can hand the layer a script, a flag, a digest or a clock.
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : /\.js$/.test(d.name) ? [join(dir, d.name)] : []));
  const reachesVoice = (source, path) => /voice-soa\.js/.test(strip(source, path));
  const apiFiles = walk(join(REPO_ROOT, 'api'));
  const importers = apiFiles.filter((p) => reachesVoice(readFileSync(p, 'utf8'), 'api/' + relative(join(REPO_ROOT, 'api'), p).replace(/\\/g, '/'))).map((p) => relative(REPO_ROOT, p).replace(/\\/g, '/'));
  ok('(source) the one file under api/ that reaches voice-soa.js is evidence.js', same(importers, ['api/_lib/cy2027/evidence.js']) && apiFiles.length >= 20, importers.join(', '));
  ok('(source) that scan bites: a handler that imports the module, statically or dynamically, is caught; a commented-out import is not',
    reachesVoice("import { buildVoiceEvidence } from './_lib/cy2027/voice-soa.js';\nexport default function h() {}", 'api/x.js') &&
    reachesVoice("export default async function h() { const v = await import('./_lib/cy2027/voice-soa.js'); return v; }", 'api/x.js') &&
    !reachesVoice("// import { buildVoiceEvidence } from './_lib/cy2027/voice-soa.js';\n/* voice-soa.js */\nexport default function h() {}", 'api/x.js'));
  const BAT = read('./run-battery.mjs').replace(/\r\n/g, '\n');
  ok('(source) the battery runs this suite', line(/'test-cy2027-voice-2026-10-04\.mjs',$/).test(BAT));
  // AUDIT 2026-10-04 (red team) — this was `Object.isFrozen(module) || keys >= 20`, true for any namespace. Each exported table is judged.
  const tables = Object.entries(voiceModule).filter(([, v]) => v && typeof v === 'object');
  ok('every table the voice module exports is frozen all the way down',
    tables.length >= 8 && tables.every(([k, v]) => unfrozenPaths(v, k).length === 0), tables.flatMap(([k, v]) => unfrozenPaths(v, k)).join(', '));
  ok('and each is a governing identifier the gate watches', tables.every(([k]) => GOVERNING_IDENTIFIERS.includes(k)), tables.map(([k]) => k).filter((k) => !GOVERNING_IDENTIFIERS.includes(k)).join(', '));
  ok('the tables are exactly the script, the status, the three vocabularies and the three reply lists',
    same(tables.map(([k]) => k).sort(), ['BLANKET_REPLIES', 'UNSURE_REPLIES', 'VOICE_CAPTURE_OUTCOME', 'VOICE_DECISION', 'VOICE_NEGATIVE_TOKENS', 'VOICE_SCRIPT_STATUS', 'VOICE_SOA_PROBLEM', 'VOICE_SOA_SCRIPT']), tables.map(([k]) => k).join(', '));
}

// ── 14. The owner package quotes the data, verbatim — in both directions ─────
{
  const docPath = join(REPO_ROOT, 'docs', 'voice', 'VOICE-SOA-CONFIGURATION-PACKAGE-2026-10-04.md');
  ok('the owner configuration package exists under docs/voice/', existsSync(docPath));
  const docRaw = readFileSync(docPath, 'utf8');
  const doc = docRaw.replace(/\s+/g, ' ');
  ok('it is marked NOT APPLIED', /\*\*Status: NOT APPLIED\.\*\*/.test(doc));
  ok('it names the script version and its pending status, and no other version', doc.includes(VOICE_SOA_SCRIPT.version) && doc.includes('PENDING_OWNER_APPROVAL') && !/CP-SOA-VOICE-SCRIPT-CY2027-v0\.1\b/.test(doc));
  for (const lang of ['en', 'es']) {
    for (const l of assembleVoiceScript(lang)) {
      ok(`the ${lang} addendum quotes the ${l.step}${l.code ? ' ' + l.code : ''} line verbatim`, doc.includes(l.text.replace(/\s+/g, ' ')), l.text.slice(0, 60));
    }
    ok(`the ${lang} addendum quotes the four-choice offer and the in-person refusal verbatim`, doc.includes(VOICE_SOA_SCRIPT[lang].fourChoices) && doc.includes(VOICE_SOA_SCRIPT[lang].inPersonRefusal));
  }
  ok('it quotes the approved read-back-none line in both languages', doc.includes(SOA_TEXT.en.readBackNone) && doc.includes(SOA_TEXT.es.readBackNone));
  ok('it quotes the question whose answer the gate reads as the caller choosing voice, in both languages',
    doc.includes(VOICE_SOA_SCRIPT.en.channelConfirmQuestion) && doc.includes(VOICE_SOA_SCRIPT.es.channelConfirmQuestion) &&
    voiceScriptPayload().includes(VOICE_SOA_SCRIPT.es.channelConfirmQuestion));
  ok('it tells the agents, in both languages, that a negation anywhere is a no', /"yes, not that one" declines the category/.test(doc) && /"sí, esa no" rechaza la categoría/.test(doc));
  // AUDIT 2026-10-04 (red team) — the reverse direction: every sentence the addenda tell the agent to say is pinned data.
  const addenda = docRaw.split('```').filter((_, i) => i % 2 === 1).filter((b) => /CY2027 \((?:Layer|Capa) B\)/.test(b));
  ok('the two Layer-B addenda are found in the package', addenda.length === 2);
  const flat = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? flat(v) : []));
  const pinned = [...flat(VOICE_SOA_SCRIPT.en), ...flat(VOICE_SOA_SCRIPT.es), ...assembleVoiceScript('en').map((l) => l.text), ...assembleVoiceScript('es').map((l) => l.text), ...flat(SOA_TEXT.en), ...flat(SOA_TEXT.es)]
    .map((s) => s.replace(/\s+/g, ' '));
  const unpinnedSentences = (text) => {
    const parts = text.replace(/\s+/g, ' ').split('"');
    if (parts.length % 2 === 0) return ['UNBALANCED_QUOTES'];
    return parts.filter((_, i) => i % 2 === 1).map((q) => q.trim()).filter((q) => q.length >= 30).filter((q) => !pinned.some((p) => p.includes(q)));
  };
  for (const [i, block] of addenda.entries()) {
    ok(`every sentence the ${i === 0 ? 'EN' : 'ES'} addendum tells the agent to say is pinned data (inside the digest, behind the approval)`, unpinnedSentences(block).length === 0, unpinnedSentences(block).join(' | '));
  }
  ok('the reverse scan bites: a sentence that exists only in the document is reported',
    same(unpinnedSentences(addenda[0] + ' say "Trust me, this plan is the best one for you, I promise."'), ['Trust me, this plan is the best one for you, I promise.']));
  ok('the §21 "has been recorded" sentence the red team found only in the document is pinned now, in both languages',
    same(unpinnedSentences('Say "Your Scope of Appointment has been recorded." only after'), []) && same(unpinnedSentences('Diga "Su Scope of Appointment ha sido registrado." SOLO'), []) &&
    VOICE_SOA_SCRIPT.en.savedClose === 'Your Scope of Appointment has been recorded.' && VOICE_SOA_SCRIPT.es.savedClose === 'Su Scope of Appointment ha sido registrado.');
  ok('and unbalanced quoting is reported, not skipped', same(unpinnedSentences(addenda[0] + ' "'), ['UNBALANCED_QUOTES']));
  for (const tool of ['Call transfer', 'Trigger a workflow', 'Send SMS', 'Update contact field', 'Appointment Booking', 'Custom action', 'Agent Transfer']) {
    ok(`it lists the catalogue action "${tool}" for verification`, doc.includes(tool));
  }
  ok('it says End Call is not available and which tools must be absent', /no "End Call" action/.test(doc) && /Must be ABSENT/.test(doc) && /plan-search, carrier-search/.test(doc));
  ok('it says the receiving endpoint does not exist', /does not exist yet/.test(doc));
  ok('it names the rollback backups', doc.includes('2026-10-01-emely-prompt-after.txt') && doc.includes('2026-10-01-sofia-prompt-after.txt'));
  ok('it preserves Layer A: two agents, IVR routing, the notice once, no AI self-announcement', /Two agents, never one multilingual agent/.test(doc) && /press 1 Emely/.test(doc) && /recording notice once/.test(doc) && /does not volunteer that it is an automated assistant/.test(doc));
  ok('it says the flag gates the evidence stage too', /offered, evidenced or completed/.test(doc));
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

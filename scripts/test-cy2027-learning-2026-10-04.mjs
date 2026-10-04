// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — CONTROLLED LEARNING and the NO-SELF-MODIFICATION GATE
// (spec §23, §33 "Production prompt or rules self-modify from live
// conversations", precedence rule 10).
//
// Both halves are exercised by calling them: the pipeline with real records,
// the gate with source text that contains each defect it exists to catch — and
// the gate's COMMAND by running it against a tree with a defect in it.
//
// Run: node scripts/test-cy2027-learning-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as learning from '../api/_lib/cy2027/learning.js';
import {
  CANDIDATE_KINDS, LEARNING_SURFACES, LEARNING_PIPELINE, LEARNING_REJECTED, LEARNING_REJECTION_REASONS, AUTOMATED_OBSERVATIONS,
  SUMMARY_MAX_CHARS, PHRASE_MAX_CHARS, REFERENCE_MAX_CHARS,
  createCandidateLearning, candidateHistoryProblem, advanceCandidate, rejectCandidate, isDeployedLearning, candidateLogLine, observationLogLine,
} from '../api/_lib/cy2027/learning.js';
import { REVIEWERS_ENV } from '../api/_lib/cy2027/actors.js';
import { plainRecord, plainList, ownData } from '../api/_lib/cy2027/plain-record.js';
import * as barrel from '../api/_lib/cy2027/index.js';
import {
  stripComments, importSpecifiers, topLevelStatements, findRuntimeWriteCapability, findGoverningMutation, unfrozenPaths, runGate, runCli,
  specifierProblem, GOVERNING_IDENTIFIERS, ALLOWED_MODULES, FORBIDDEN_NAMES, FORBIDDEN_GLOBALS, CODE_EXTENSIONS, REPO_ROOT,
} from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The people the owner has authorised to decide, for this run.
process.env[REVIEWERS_ENV] = 'Maria Lopez, Sawil Reyes';
const withoutReviewers = (fn) => {
  const saved = process.env[REVIEWERS_ENV];
  delete process.env[REVIEWERS_ENV];
  try { return fn(); } finally { process.env[REVIEWERS_ENV] = saved; }
};

// ── 1. What a candidate may be ───────────────────────────────────────────────
ok('the candidate kinds are the six the specification names, and only those',
  JSON.stringify(CANDIDATE_KINDS) === JSON.stringify([
    'RECURRING_CALLER_CONFUSION', 'FAILED_PHRASE', 'MISSING_FAQ', 'ROUTING_ERROR', 'REPEATED_TRANSFER_CAUSE', 'PRONUNCIATION_ISSUE',
  ]) && Object.isFrozen(CANDIDATE_KINDS));
ok('the pipeline is the specification\'s, in its order',
  LEARNING_PIPELINE.join(' > ') ===
    'CANDIDATE > HUMAN_COMPLIANCE_REVIEW > SOURCE_VERIFICATION > VERSIONED_CHANGE > REGRESSION_TESTS > RED_TEAM > APPROVAL > DEPLOYMENT' &&
  Object.isFrozen(LEARNING_PIPELINE));

const base = {
  kind: 'FAILED_PHRASE', surface: 'VOICE_SOFIA', language: 'es',
  summary: 'The Spanish greeting is heard as a question and callers answer before the menu.',
  agentPhrase: 'Hola, le habla Sofía.', occurrences: 4, createdAt: '2026-10-04T12:00:00Z',
};
const made = createCandidateLearning(base);
ok('an observation about the system becomes a candidate', made.ok === true && made.candidate.stage === 'CANDIDATE');
ok('it starts with no history', Array.isArray(made.candidate.history) && made.candidate.history.length === 0);
ok('the record is frozen, history included', Object.isFrozen(made.candidate) && Object.isFrozen(made.candidate.history));
ok('every kind is accepted', CANDIDATE_KINDS.every((kind) => createCandidateLearning({ ...base, kind }).ok));
ok('every surface is accepted', LEARNING_SURFACES.every((surface) => createCandidateLearning({ ...base, surface }).ok));
ok('a phrase is optional', createCandidateLearning({ ...base, agentPhrase: null }).ok === true && createCandidateLearning((({ agentPhrase: _gone, ...rest }) => rest)(base)).candidate.agentPhrase === null);
ok('the count defaults to one observation and the instant to now',
  (() => { const r = createCandidateLearning({ kind: base.kind, surface: base.surface, language: 'en', summary: base.summary }); return r.ok && r.candidate.occurrences === 1 && Math.abs(Date.parse(r.candidate.createdAt) - Date.now()) < 60_000; })());

// AUDIT 2026-10-04 (red team) — the id was whatever the caller sent: an SSN, a
// phone number, a Medicare number and a name all fitted its "fixed shape" and
// were printed in the log line. Nobody supplies an id now.
ok('the id is a digest of the record, not a field anyone fills in', /^[0-9a-f]{32}$/.test(made.candidate.candidateId));
ok('the same observation is the same candidate; anything different about it is a different one',
  createCandidateLearning(base).candidate.candidateId === made.candidate.candidateId &&
  [{ kind: 'ROUTING_ERROR' }, { surface: 'VOICE_EMELY' }, { language: 'en' }, { summary: base.summary + ' Again.' }, { agentPhrase: null }, { occurrences: 5 }, { createdAt: '2026-10-04T12:00:01Z' }]
    .every((over) => createCandidateLearning({ ...base, ...over }).candidate.candidateId !== made.candidate.candidateId));
for (const id of ['123-45-6789', '631-555-0123', '6315550123', '1EG4-TE5-MK73', 'MariaLopez_Brentwood', 'DOB-03-14-1950', 'cand_0001', made.candidate.candidateId, '', null, undefined]) {
  const r = createCandidateLearning({ ...base, candidateId: id });
  ok(`a caller-supplied id (${JSON.stringify(id)}) is refused, not used and not ignored`, r.ok === false && r.reason === 'CANDIDATE_ID_NOT_ACCEPTED' && !('candidate' in r));
}

for (const [field, value, reason] of [
  ['kind', 'NEW_SALES_ANGLE', 'CANDIDATE_KIND_UNKNOWN'],
  ['kind', 'constructor', 'CANDIDATE_KIND_UNKNOWN'],
  ['kind', ['FAILED_PHRASE'], 'CANDIDATE_KIND_UNKNOWN'],
  ['kind', undefined, 'CANDIDATE_KIND_UNKNOWN'],
  ['surface', 'OUTBOUND_DIALER', 'CANDIDATE_SURFACE_UNKNOWN'],
  ['surface', ['VOICE_SOFIA'], 'CANDIDATE_SURFACE_UNKNOWN'],
  ['language', 'fr', 'CANDIDATE_LANGUAGE_UNKNOWN'],
  ['language', 'ES', 'CANDIDATE_LANGUAGE_UNKNOWN'],
  ['occurrences', 0, 'CANDIDATE_OCCURRENCES_INVALID'],
  ['occurrences', 2.5, 'CANDIDATE_OCCURRENCES_INVALID'],
  ['occurrences', '3', 'CANDIDATE_OCCURRENCES_INVALID'],
  ['createdAt', 'yesterday', 'CANDIDATE_INSTANT_INVALID'],
  ['createdAt', '2026-02-31T00:00:00Z', 'CANDIDATE_INSTANT_INVALID'],
  ['summary', '', 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', '    ', 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', undefined, 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', ['a summary'], 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', 'x'.repeat(SUMMARY_MAX_CHARS + 1), 'CANDIDATE_TEXT_TOO_LONG'],
  ['agentPhrase', 'y'.repeat(PHRASE_MAX_CHARS + 1), 'CANDIDATE_TEXT_TOO_LONG'],
  ['agentPhrase', '', 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', 'a line' + String.fromCharCode(7) + 'with a bell', 'CANDIDATE_TEXT_NOT_PLAIN'],
]) {
  ok(`a candidate with ${field} = ${typeof value === 'string' && value.length > 40 ? value.slice(0, 12) + '…(' + value.length + ')' : JSON.stringify(value)} is refused as ${reason}`,
    createCandidateLearning({ ...base, [field]: value }).reason === reason);
}
ok('an over-long text is refused, never silently truncated',
  createCandidateLearning({ ...base, summary: 'x'.repeat(SUMMARY_MAX_CHARS) }).ok === true &&
  createCandidateLearning({ ...base, summary: 'x'.repeat(SUMMARY_MAX_CHARS + 1) }).ok === false);
ok('garbage input is refused without throwing', [null, undefined, 'x', 7, []].every((v) => createCandidateLearning(v).ok === false));
ok('an input carrying anything but the candidate\'s own fields is refused',
  createCandidateLearning({ ...base, transcript: 'everything the caller said' }).reason === 'CANDIDATE_INPUT_NOT_PLAIN' &&
  createCandidateLearning({ ...base, stage: 'DEPLOYMENT' }).reason === 'CANDIDATE_INPUT_NOT_PLAIN' &&
  createCandidateLearning(Object.create(base)).ok === false && createCandidateLearning(new (class Observation { kind = 'FAILED_PHRASE'; })()).reason === 'CANDIDATE_INPUT_NOT_PLAIN');

// A candidate describes the system, never the caller.
const refusal = (text) => createCandidateLearning({ ...base, summary: text });
for (const [what, text, category] of [
  ['a phone number', 'Caller said to call back at 631-555-0123.', 'PHONE'],
  ['an email address', 'Caller wrote jane.doe@example.com in the chat.', 'EMAIL'],
  ['a Social Security number', 'Caller gave SSN 123-45-6789.', 'SSN'],
  ['a Medicare number', 'Medicare number 1EG4-TE5-MK73 was read aloud.', 'MBI'],
  ['a date of birth', 'Caller was born on 03/14/1950.', 'DATE'],
  ['an ISO date', 'The call of 1950-03-14 went wrong.', 'DATE'],
  ['a written date', 'Born March 14, 1950 according to the caller.', 'DATE'],
  ['a Spanish written date', 'Nació el 14 de marzo de 1950.', 'DATE'],
  ['a long number', 'The member id 884213 was repeated back.', 'LONG_NUMBER'],
  ['a health condition', 'She has diabetes and takes insulin every day.', 'PROHIBITED_ATTRIBUTE'],
  ['a benefit status', 'He is on Medicaid and gets Extra Help.', 'PROHIBITED_ATTRIBUTE'],
  ['a financial circumstance', 'She cannot afford the premium.', 'PROHIBITED_ATTRIBUTE'],
  ['a condition in Spanish', 'La persona dijo que tiene cáncer y está en tratamiento.', 'PROHIBITED_ATTRIBUTE'],
  ['a named caller', 'Caller Maria Lopez from Brentwood was confused.', 'PERSON_REFERENCE'],
  ['an honorific and a name', 'Mrs. Delgado did not understand the menu.', 'PERSON_REFERENCE'],
  ['a self-introduction', 'The caller said my name is Rosa and hung up.', 'PERSON_REFERENCE'],
  ['a Spanish self-introduction', 'Dijo me llamo Rosa y colgó.', 'PERSON_REFERENCE'],
  // AUDIT 2026-10-04 (red team) — every one of these was ACCEPTED.
  ['a date written day-month-year', 'Caller born 14 March 1950 was confused.', 'DATE'],
  ['a Spanish date without the second "de"', 'Nació el 14 de marzo 1950 y no entendió.', 'DATE'],
  ['a Spanish date without the first "de"', 'Nacida el 3 marzo de 1950.', 'DATE'],
  ['a month and a year', 'Born in March 1950, by the look of the record.', 'YEAR'],
  ['a date of birth typed as two numbers', 'DOB 0314 1950', 'YEAR'],
  ['a slash date followed by a year', 'born 3/14 of 1950', 'YEAR'],
  ['the last four of a number', 'SSN last four 6789.', 'NUMBER'],
  ['an amount', 'The amount mentioned was 900 a month.', 'NUMBER'],
  ['a split number', 'ZIP 1171 7 and member 8842 13', 'NUMBER'],
  ['an age', 'The caller is 87 years old and a widow.', 'AGE'],
  ['a Spanish honorific written out', 'La señora Delgado no entendió el menú.', 'PERSON_REFERENCE'],
  ['an introduction in the first person', 'I am Rosa Delgado and I need help.', 'SELF_INTRODUCTION'],
  ['a Spanish one', 'Soy Rosa Delgado y necesito ayuda.', 'SELF_INTRODUCTION'],
  ['a telephone introduction', 'This is Rosa Delgado calling.', 'SELF_INTRODUCTION'],
  ['a relative', 'Her daughter Rosa Delgado called back.', 'THIRD_PERSON'],
  ['a medication, told about a person', 'She takes metformin.', 'THIRD_PERSON'],
  ['a street address', 'Maria Lopez of 12 Oak Street, Brentwood did not understand the menu.', 'ADDRESS'],
  ['where somebody lives', 'Lives at 12 Oak Street, Brentwood NY.', 'ADDRESS'],
  ['a Spanish street address', 'Vive en la calle Roble 12, Brentwood.', 'ADDRESS'],
]) {
  const inSummary = refusal(text);
  const inPhrase = createCandidateLearning({ ...base, agentPhrase: text });
  ok(`a summary carrying ${what} is refused`, inSummary.ok === false && inSummary.reason === 'CANDIDATE_CONTAINS_SENSITIVE_DATA' &&
    inSummary.field === 'summary' && inSummary.categories.includes(category), JSON.stringify(inSummary));
  ok(`so is a phrase carrying ${what}`, inPhrase.ok === false && inPhrase.field === 'agentPhrase');
}
ok('the refusal names the category, never the value', (() => {
  const r = refusal('Caller gave SSN 123-45-6789.');
  return !JSON.stringify(r).includes('123-45-6789');
})());
// One assertion per alternative of each rule, with a sentence only THAT alternative
// catches — a rule that loses one of its words fails here, not in production.
const only = (text, category) => { const r = refusal(text); return r.ok === false && same(r.categories, [category]); };
for (const title of ['Mr', 'Mrs', 'Ms', 'Miss', 'Mister', 'Dr', 'Doctor', 'Doctora', 'Sr', 'Sra', 'Srta', 'Señor', 'Señora', 'Señorita', 'Don', 'Doña', 'mrs', 'señora', 'don']) {
  ok(`the honorific "${title}" before a name is a person`, only(`The menu confused ${title} Delgado twice.`, 'PERSON_REFERENCE') && only(`The menu confused ${title}. Delgado twice.`, 'PERSON_REFERENCE'), JSON.stringify(refusal(`The menu confused ${title} Delgado twice.`)));
}
for (const text of ['The caller said my name is rosa.', 'The record says the name is rosa.', 'Dijo me llamo rosa y colgó.', 'Dijo mi nombre es rosa.', 'La persona se llama rosa.', 'Dos personas se llaman igual.']) {
  ok(`a name being given is a person: "${text}"`, only(text, 'PERSON_REFERENCE'), JSON.stringify(refusal(text)));
}
for (const role of ['Caller', 'Beneficiary', 'Client', 'Member', 'Patient', 'Llamante', 'Beneficiario', 'Beneficiaria', 'Cliente', 'Paciente', 'caller', 'paciente']) {
  ok(`"${role}" followed by a full name is a person`, only(`${role} Rosa Delgado was confused.`, 'PERSON_REFERENCE'), JSON.stringify(refusal(`${role} Rosa Delgado was confused.`)));
}
for (const intro of ['I am', 'i am', "I'm", 'This is', 'this is', 'Soy', 'soy', 'Habla', 'habla', 'Aquí', 'aquí']) {
  ok(`"${intro}" followed by a name is somebody introducing themselves`, only(`${intro} Rosa and the menu failed.`, 'SELF_INTRODUCTION'), JSON.stringify(refusal(`${intro} Rosa and the menu failed.`)));
}
for (const word of ['he', 'she', 'his', 'her', 'hers', 'him', 'himself', 'herself', 'He', 'SHE', 'él', 'ella', 'Ella']) {
  ok(`"${word}" speaks of a person`, only(`The menu confused ${word} twice.`, 'THIRD_PERSON'), JSON.stringify(refusal(`The menu confused ${word} twice.`)));
}
for (const month of [
  'January', 'Jan', 'February', 'Feb', 'March', 'Mar', 'April', 'Apr', 'May', 'June', 'Jun', 'July', 'Jul', 'August', 'Aug', 'September', 'Sept', 'Sep',
  'October', 'Oct', 'November', 'Nov', 'December', 'Dec', 'enero', 'ene', 'febrero', 'marzo', 'abril', 'abr', 'mayo', 'junio', 'julio', 'agosto', 'ago',
  'septiembre', 'setiembre', 'octubre', 'noviembre', 'diciembre', 'dic',
]) {
  ok(`"${month}" next to a day is a date, in either order`,
    only(`It failed on ${month} 14 again.`, 'DATE') && only(`It failed on 14 ${month} again.`, 'DATE') && only(`Falló el 14 de ${month} otra vez.`, 'DATE'),
    JSON.stringify([refusal(`It failed on ${month} 14 again.`), refusal(`It failed on 14 ${month} again.`)]));
}
for (const suffix of ['Street', 'St', 'Avenue', 'Ave', 'Road', 'Rd', 'Drive', 'Dr', 'Lane', 'Ln', 'Boulevard', 'Blvd', 'Court', 'Ct', 'Place', 'Pl', 'Way', 'Terrace', 'Circle', 'Highway', 'Hwy']) {
  ok(`a number, a name and "${suffix}" is an address`, only(`Mail goes to 12 Oak ${suffix} now.`, 'ADDRESS'), JSON.stringify(refusal(`Mail goes to 12 Oak ${suffix} now.`)));
}
for (const street of ['calle', 'avenida', 'carrera', 'paseo', 'Calle']) {
  ok(`"${street}", a name and a number is an address`, only(`La carta va a ${street} Roble 12 ahora.`, 'ADDRESS'), JSON.stringify(refusal(`La carta va a ${street} Roble 12 ahora.`)));
}
for (const phrase of ['lives at', 'live in', 'lives on', 'vive en', 'address is', 'dirección es', 'direccion es', 'domicilio']) {
  ok(`"${phrase}" says where somebody lives`, only(`The caller ${phrase} the old town.`, 'ADDRESS'), JSON.stringify(refusal(`The caller ${phrase} the old town.`)));
}
ok('three digits in a row are a number, five a long one, and a year is a year',
  only('It was dialled 123 times.', 'NUMBER') && same(refusal('It was dialled 12345 times.').categories, ['LONG_NUMBER', 'NUMBER']) &&
  same(refusal('It worked in 1999 and in 2031.').categories, ['YEAR', 'NUMBER']) && only('The caller is 87 años.', 'AGE') && only('An 87-year-old asked.', 'AGE') && only('The caller is 87 year old.', 'AGE'));
// Text that is not exactly what it looks like is refused, never normalised and then accepted.
for (const [what, text] of [
  ['a zero-width space inside an identifier', 'SSN 123' + String.fromCharCode(0x200b) + '-45-6789'],
  ['full-width digits', 'SSN ' + String.fromCharCode(0xff11, 0xff12, 0xff13) + '-' + String.fromCharCode(0xff14, 0xff15) + '-' + String.fromCharCode(0xff16, 0xff17, 0xff18, 0xff19)],
  ['a direction override', 'The menu' + String.fromCharCode(0x202e) + ' failed.'],
  ['a line separator', 'The menu' + String.fromCharCode(0x2028) + 'failed.'],
  ['a paragraph separator', 'The menu' + String.fromCharCode(0x2029) + 'failed.'],
  ['a no-break space', 'The menu' + String.fromCharCode(0xa0) + 'failed.'],
  ['a ligature', 'The ' + String.fromCharCode(0xfb01) + 'rst menu failed.'],
  ['a byte-order mark', 'The menu' + String.fromCharCode(0xfeff) + ' failed.'],
  ['a private-use character', 'The menu ' + String.fromCharCode(0xe000) + ' failed.'],
  ['a C1 control character', 'The menu ' + String.fromCharCode(0x85) + ' failed.'],
  ['an unpaired surrogate', 'The menu ' + String.fromCharCode(0xd800) + ' failed.'],
]) {
  ok(`a summary containing ${what} is refused as not plain text`, refusal(text).reason === 'CANDIDATE_TEXT_NOT_PLAIN', JSON.stringify(refusal(text)));
}
ok('ordinary accents and line breaks are plain text, composed or not',
  refusal('La opción de español se pierde.\nEl menú empieza tarde.').ok === true && refusal('El menu' + String.fromCharCode(0x301) + ' empieza tarde.').ok === true);
for (const text of [
  'Callers ask whether the call is recorded after the notice was already given.',
  'The menu option for Spanish is missed when the caller speaks during the greeting.',
  'Las personas preguntan por el horario y la respuesta tarda demasiado.',
  'Transfers to a licensed agent are requested 3 times a day for billing questions.',
  'Option 2 is chosen when option 1 was meant, about 15 times a week, 24/7.',
  'The assistant says "This is Clara, your assistant" before the notice.',
]) {
  ok('a plain description of the system is accepted: "' + text.slice(0, 40) + '…"', refusal(text).ok === true, JSON.stringify(refusal(text)));
}
ok('an assistant may introduce ITSELF in its own phrase, and nobody else',
  ['Hola, le habla Sofía.', 'Soy Emely, la asistente virtual.', 'This is Clara.', 'Aquí Zara para ayudarle.'].every((p) => createCandidateLearning({ ...base, agentPhrase: p }).ok === true) &&
  ['Hola, le habla Sofía Delgado.', 'Soy Rosa.', 'This is Clara Delgado.', 'Soy Sofíana.'].every((p) => createCandidateLearning({ ...base, agentPhrase: p }).ok === false));
ok('KNOWN LIMIT, asserted so nobody mistakes the net for a name detector: a bare lowercase name, an unlisted medication and a number in words pass',
  refusal('Caller maria lopez was confused.').ok === true && refusal('Toma metformina.').ok === true && refusal('Phone six three one five five five zero one two three.').ok === true);

// ── 2. The pipeline: one stage at a time, each decided by an authorised reviewer ─
const person = (i) => ({ actor: 'Maria Lopez', at: `2026-10-${String(5 + i).padStart(2, '0')}T15:00:00Z`, evidenceReference: 'review-' + i });
let walked = made.candidate;
const stages = [walked.stage];
for (let i = 0; i < LEARNING_PIPELINE.length - 1; i++) {
  const before = walked;
  walked = advanceCandidate(walked, person(i));
  stages.push(walked.stage);
  if (i === 0) ok('advancing returns a new record and leaves the old one as it was', before.stage === 'CANDIDATE' && before.history.length === 0 && walked !== before);
}
ok('a candidate can only be walked through every stage in order', stages.join(' > ') === LEARNING_PIPELINE.join(' > '));
ok('each step records who, when and on what evidence, frozen',
  walked.history.length === 7 && walked.history.every((s, i) =>
    s.from === LEARNING_PIPELINE[i] && s.to === LEARNING_PIPELINE[i + 1] && s.actor === 'Maria Lopez' && s.evidenceReference === 'review-' + i && Object.isFrozen(s)) &&
  Object.isFrozen(walked.history));
ok('the candidate keeps its identity through every stage', walked.candidateId === made.candidate.candidateId && walked.summary === made.candidate.summary);
ok('only then is it a deployed learning', isDeployedLearning(walked) === true && candidateHistoryProblem(walked) === null);
ok('one stage short is not deployed', isDeployedLearning(advanceCandidate(made.candidate, person(0))) === false);
throws('nothing follows DEPLOYMENT', () => advanceCandidate(walked, person(8)), /last stage/);

for (const who of [
  'claude', 'AI-Agent', 'svc_bot', 'system', 'workflow', 'gpt-5', 'Emely the assistant', '0042', '', '   ', null, undefined, ['Maria Lopez'], { toString() { return 'Maria Lopez'; } },
  // AUDIT 2026-10-04 (red team) — the assistants themselves walked a candidate to DEPLOYMENT.
  'Sofía', 'Sofia', 'Emely', 'Clara', 'Zara', 'ChatGPT', 'Copilot', 'Gemini', 'chatbot', 'IA', 'OpenClaw', 'Hermes', 'webhook',
]) {
  throws('a candidate cannot be advanced by ' + (typeof who === 'string' ? JSON.stringify(who) : Object.prototype.toString.call(who)),
    () => advanceCandidate(made.candidate, { ...person(0), actor: who }), /named human/);
  throws('…or rejected by it', () => rejectCandidate(made.candidate, { actor: who, at: '2026-10-06T10:00:00Z', reasonCode: 'DUPLICATE' }), /named human/);
}
throws('nor by a person the owner has not authorised', () => advanceCandidate(made.candidate, { ...person(0), actor: 'John Smith' }), /REVIEWER_NOT_AUTHORIZED/);
throws('nor rejected by one', () => rejectCandidate(made.candidate, { actor: 'John Smith', at: '2026-10-06T10:00:00Z', reasonCode: 'DUPLICATE' }), /REVIEWER_NOT_AUTHORIZED/);
throws('nor by anybody while no reviewer is configured', () => withoutReviewers(() => advanceCandidate(made.candidate, person(0))), /REVIEWERS_NOT_CONFIGURED/);
ok('a record is judged on the day: steps by a reviewer who is no longer authorised stop counting',
  withoutReviewers(() => isDeployedLearning(walked)) === false && withoutReviewers(() => candidateHistoryProblem(walked)) === 'HISTORY_STEP_NOT_BY_A_PERSON' && isDeployedLearning(walked) === true);
for (const when of ['yesterday', '2026-02-31T00:00:00Z', '2026-10-05', '', null, undefined]) {
  throws('a step needs a real UTC instant, not ' + JSON.stringify(when), () => advanceCandidate(made.candidate, { ...person(0), at: when }), /UTC instant/);
}
for (const ev of ['', '   ', null, undefined, 7]) {
  throws('a step needs a reference to what was reviewed, not ' + JSON.stringify(ev),
    () => advanceCandidate(made.candidate, { ...person(0), evidenceReference: ev }), /what was reviewed \(REFERENCE_REQUIRED\)/);
}
// AUDIT 2026-10-04 (red team) — the step fields were unbounded free text inside a "trusted" record.
for (const [what, ev, reason] of [
  ['a document', 'x'.repeat(REFERENCE_MAX_CHARS + 1), 'REFERENCE_TOO_LONG'],
  ['two lines', 'review-0\nsecond line', 'REFERENCE_NOT_PLAIN'],
  ['a zero-width character', 'review' + String.fromCharCode(0x200b) + '-0', 'REFERENCE_NOT_PLAIN'],
  ['a Social Security number', 'ticket 12 re SSN 123-45-6789', 'REFERENCE_CONTAINS_SENSITIVE_DATA'],
  ['a phone number', 'call 631-555-0123 for the notes', 'REFERENCE_CONTAINS_SENSITIVE_DATA'],
  ['a named caller', 'notes on Caller Rosa Delgado', 'REFERENCE_CONTAINS_SENSITIVE_DATA'],
  ['a health condition', 'the one where the caller has diabetes', 'REFERENCE_CONTAINS_SENSITIVE_DATA'],
  ['a person', 'the one about her daughter', 'REFERENCE_CONTAINS_SENSITIVE_DATA'],
]) {
  throws(`a reference carrying ${what} is refused (${reason})`, () => advanceCandidate(made.candidate, { ...person(0), evidenceReference: ev }), new RegExp('what was reviewed \\(' + reason + '\\)'));
}
ok('a reference may carry what a pointer carries: a ticket number, a date, a path, a commit',
  ['PR 412, reviewed 2026-10-05', 'docs/review-2026-10-05.md @ 70627ba', 'x'.repeat(REFERENCE_MAX_CHARS)]
    .every((ev) => advanceCandidate(made.candidate, { ...person(0), evidenceReference: ev }).stage === 'HUMAN_COMPLIANCE_REVIEW'));
throws('a step cannot be dated before the candidate existed',
  () => advanceCandidate(made.candidate, { ...person(0), at: '2026-10-01T00:00:00Z' }), /before the one it follows/);
throws('nor before the step it follows',
  () => advanceCandidate(advanceCandidate(made.candidate, person(3)), person(1)), /before the one it follows/);
throws('an empty call decides nothing', () => advanceCandidate(made.candidate), /named human/);
throws('nor does a decision that is not an object', () => advanceCandidate(made.candidate, 'Maria Lopez'), /named human/);

// A record that CLAIMS a stage must be able to show how it got there.
const forged = (over) => ({ ...made.candidate, ...over });
ok('a record that says DEPLOYMENT with no history is not a deployed learning',
  candidateHistoryProblem(forged({ stage: 'DEPLOYMENT' })) === 'HISTORY_DOES_NOT_REACH_STAGE' && isDeployedLearning(forged({ stage: 'DEPLOYMENT' })) === false);
throws('and it cannot be advanced or acted on', () => advanceCandidate(forged({ stage: 'APPROVAL' }), person(7)), /not trustworthy/);
{
  const h = walked.history;
  const swap = (i, over) => h.map((s, j) => (j === i ? { ...s, ...over } : s));
  const problem = (history) => candidateHistoryProblem({ ...walked, history });
  ok('a history with a step decided by automation is refused', problem(swap(3, { actor: 'svc_bot' })) === 'HISTORY_STEP_NOT_BY_A_PERSON');
  ok('or by one of the assistants, or by a person who is not authorised',
    problem(swap(3, { actor: 'Sofía' })) === 'HISTORY_STEP_NOT_BY_A_PERSON' && problem(swap(6, { actor: 'John Smith' })) === 'HISTORY_STEP_NOT_BY_A_PERSON');
  ok('a history with a skipped stage is refused', problem(swap(2, { to: 'RED_TEAM' })) === 'HISTORY_OUT_OF_ORDER');
  ok('a history with a step missing is refused', problem(h.slice(1)) === 'HISTORY_DOES_NOT_REACH_STAGE');
  ok('a history that runs backwards in time is refused', problem(swap(4, { at: '2026-10-05T00:00:00Z' })) === 'HISTORY_NOT_CHRONOLOGICAL');
  ok('a history with an unreadable instant is refused', problem(swap(1, { at: 'later' })) === 'HISTORY_INSTANT_INVALID');
  ok('a history with a step lacking evidence is refused', problem(swap(5, { evidenceReference: ' ' })) === 'HISTORY_EVIDENCE_MISSING');
  ok('a history whose evidence field carries a caller is refused',
    problem(swap(5, { evidenceReference: 'Caller Rosa Delgado SSN 123-45-6789' })) === 'HISTORY_EVIDENCE_NOT_ACCEPTABLE' &&
    problem(swap(5, { evidenceReference: 'x'.repeat(REFERENCE_MAX_CHARS + 1) })) === 'HISTORY_EVIDENCE_NOT_ACCEPTABLE');
  ok('a history with a malformed entry is refused', problem(h.map((s, j) => (j === 0 ? null : s))) === 'HISTORY_ENTRY_MALFORMED');
  ok('a step with one of its fields left out is not a step',
    FORWARD_KEYS().every((key) => problem(h.map((s, j) => (j === 2 ? (({ [key]: _gone, ...rest }) => rest)(s) : s))) === 'HISTORY_ENTRY_MALFORMED'));
  ok('an unknown stage, a missing history and nothing at all are refused',
    candidateHistoryProblem({ ...walked, stage: 'LIVE' }) === 'STAGE_UNKNOWN' &&
    candidateHistoryProblem({ ...walked, stage: ['DEPLOYMENT'] }) === 'STAGE_UNKNOWN' &&
    candidateHistoryProblem({ ...walked, history: 'seven steps' }) === 'HISTORY_MISSING' &&
    candidateHistoryProblem({ ...walked, history: { ...h, length: 7 } }) === 'HISTORY_MISSING' &&
    candidateHistoryProblem(null) === 'CANDIDATE_MISSING');
}
function FORWARD_KEYS() { return ['from', 'to', 'actor', 'at', 'evidenceReference']; }

// Rejection.
const reject = { actor: 'Sawil Reyes', at: '2026-10-06T10:00:00Z', reasonCode: 'QUOTES_A_CALLER' };
const rejected = rejectCandidate(advanceCandidate(made.candidate, person(0)), reject);
ok('a person can reject a candidate at any stage before deployment',
  rejected.stage === LEARNING_REJECTED && candidateHistoryProblem(rejected) === null && Object.isFrozen(rejected) &&
  rejectCandidate(made.candidate, { ...reject, at: '2026-10-04T13:00:00Z' }).stage === LEARNING_REJECTED);
ok('the rejection records who, when and why',
  rejected.history[rejected.history.length - 1].reasonCode === 'QUOTES_A_CALLER' && rejected.history[rejected.history.length - 1].actor === 'Sawil Reyes');
throws('a rejected candidate does not advance', () => advanceCandidate(rejected, person(5)), /does not advance/);
throws('nor get rejected twice', () => rejectCandidate(rejected, reject), /already rejected/);
throws('a deployed learning is not undone by rejecting its record', () => rejectCandidate(walked, { ...reject, at: '2026-10-20T00:00:00Z' }), /new versioned change/);
throws('automation cannot reject', () => rejectCandidate(made.candidate, { ...reject, actor: 'workflow' }), /named human/);
throws('a rejection needs a reason', () => rejectCandidate(made.candidate, { ...reject, reasonCode: '  ' }), /reason code/);
throws('an empty call rejects nothing', () => rejectCandidate(made.candidate), /named human/);
ok('the reasons are a closed list of codes',
  same(LEARNING_REJECTION_REASONS, ['QUOTES_A_CALLER', 'DESCRIBES_A_PERSON', 'NOT_REPRODUCIBLE', 'DUPLICATE', 'OUT_OF_SCOPE', 'SOURCE_NOT_VERIFIED', 'REGRESSION_FAILED', 'RED_TEAM_FAILED', 'NOT_APPROVED']) &&
  Object.isFrozen(LEARNING_REJECTION_REASONS));
ok('each of them rejects', LEARNING_REJECTION_REASONS.every((reasonCode) => rejectCandidate(made.candidate, { ...reject, reasonCode }).history[0].reasonCode === reasonCode));
for (const reasonCode of ['Caller Rosa Delgado SSN 123-45-6789 has diabetes', 'X', 'quotes_a_caller', 'constructor', ' QUOTES_A_CALLER', ['DUPLICATE'], 7]) {
  throws('a rejection reason that is not one of the codes is refused: ' + JSON.stringify(reasonCode),
    () => rejectCandidate(made.candidate, { ...reject, reasonCode }), /reason code/);
}
ok('a rejected record with its reason removed is not trusted',
  candidateHistoryProblem({ ...rejected, history: rejected.history.map((s, i, a) => (i === a.length - 1 ? { ...s, reasonCode: '' } : s)) }) === 'HISTORY_REASON_MISSING');
ok('a rejected record with no history at all is not trusted', candidateHistoryProblem({ ...made.candidate, stage: LEARNING_REJECTED }) === 'HISTORY_DOES_NOT_REACH_STAGE');

// The log line.
{
  const line = candidateLogLine(walked);
  ok('the log line is tagged and structured', line.startsWith('[CANDIDATE-LEARNING] ') && JSON.parse(line.slice(21)).candidateId === made.candidate.candidateId);
  ok('it carries the coarse fields', /"kind":"FAILED_PHRASE"/.test(line) && /"surface":"VOICE_SOFIA"/.test(line) && /"stage":"DEPLOYMENT"/.test(line) && /"occurrences":4/.test(line));
  ok('and never the free text', !line.includes('greeting') && !line.includes('Sofía') && !/summary|agentPhrase|history/.test(line));
  throws('there is no log line for nothing', () => candidateLogLine(null), /nothing to log/);
}

// ── 3. The module is a record, not a mechanism ───────────────────────────────
ok('it exports exactly these names — adding a function that APPLIES a learning must be a visible, reviewed change',
  JSON.stringify(Object.keys(learning).sort()) === JSON.stringify([
    'AUTOMATED_OBSERVATIONS', 'CANDIDATE_KINDS', 'LEARNING_PIPELINE', 'LEARNING_REJECTED', 'LEARNING_REJECTION_REASONS', 'LEARNING_SURFACES',
    'PHRASE_MAX_CHARS', 'REFERENCE_MAX_CHARS', 'SUMMARY_MAX_CHARS',
    'advanceCandidate', 'candidateHistoryProblem', 'candidateLogLine', 'createCandidateLearning', 'isDeployedLearning', 'observationLogLine', 'rejectCandidate',
  ]), Object.keys(learning).sort().join(','));
{
  const imports = importSpecifiers(read('../api/_lib/cy2027/learning.js'), 'api/_lib/cy2027/learning.js').sort();
  ok('it imports the digest, the reviewer check, the record reader and the two scrubbers — nothing that can write',
    same(imports, ['../phi-scrub.js', './actors.js', './plain-record.js', './prohibited-signals.js', 'node:crypto']), imports.join(','));
  ok('it is server only: the client-facing barrel does not re-export it',
    !('createCandidateLearning' in barrel) &&
    !importSpecifiers(read('../api/_lib/cy2027/index.js'), 'api/_lib/cy2027/index.js').some((s) => /learning/.test(String(s))) &&
    !importSpecifiers(read('../src/lib/cy2027.ts'), 'src/lib/cy2027.ts').some((s) => /learning/.test(String(s))));
}

// ── 4. The gate: no runtime write capability under api/ ──────────────────────
const file = (source, path = 'api/example.js') => [{ path, source }];
const refused = (source, path) => findRuntimeWriteCapability(file(source, path));
for (const [what, source, path] of [
  ['a named fs import', "import { writeFile } from 'node:fs';"],
  ['a default fs import', "import fs from 'fs';"],
  ['fs/promises', "import { appendFile } from 'node:fs/promises';"],
  ['a bare side-effect import', "import 'fs';"],
  ['require', "const fs = require('fs');"],
  ['a dynamic import', "const fs = await import('node:fs');"],
  ['a dynamic import with a template literal', 'const fs = await import(`node:fs`);'],
  ['child_process', "import { execFile } from 'node:child_process';"],
  ['worker_threads', "import { Worker } from 'worker_threads';"],
  ['vm', "import vm from 'node:vm';"],
  ['cluster', "import cluster from 'node:cluster';"],
  ['a re-export from fs', "export { writeFileSync } from 'node:fs';"],
  ['getBuiltinModule', "const fs = process.getBuiltinModule('fs');"],
  ['eval', 'const x = eval(body.code);'],
  ['new Function', "const f = new Function('return 1');"],
  ['process.binding', "const b = process.binding('fs');"],
  ['an import whose target is computed', 'const m = await import(name);'],
  ['a require whose target is computed', 'const m = require(moduleName);'],
  // AUDIT 2026-10-04 (red team) — every one of these passed the first version of the gate.
  ['a computed name that STARTS with a literal', "const fs = await import('node:' + 'fs');"],
  ['a computed require that starts with a literal', "const fs = require('f' + 's');"],
  ['a template with a substitution', 'const fs = await import(`node:${m}`);'],
  ['createRequire under another name', "import { createRequire as cr } from 'node:module'; const fs = cr(import.meta.url)('fs');"],
  ['getBuiltinModule with a variable', 'const fs = process.getBuiltinModule(n);'],
  ['getBuiltinModule through an optional call', "const fs = process.getBuiltinModule?.('fs');"],
  ['process["binding"]', "const b = process['binding']('fs');"],
  ['indirect eval', 'const r = (0, eval)(x);'],
  ['eval under another name', 'const e = eval; e(x);'],
  ['Function without new', "const r = Function('return process')();"],
  ['the Function constructor reached through a function', "const r = (() => {}).constructor('return process')();"],
  ['the same through a bracket', "const r = (() => {})['constructor']('return process')();"],
  ['Reflect.construct(Function)', "const f = Reflect.construct(Function, ['return process']);"],
  ['a data: URL import', "const m = await import('data:text/javascript,export default 1');"],
  ['node:sqlite (writes a database file)', "import { DatabaseSync } from 'node:sqlite';"],
  ['node:v8 (writes a heap snapshot)', "import v8 from 'node:v8'; v8.writeHeapSnapshot();"],
  ['process.report.writeReport', "process.report.writeReport('x.json');"],
  ['fs-extra', "import fse from 'fs-extra';"],
  ['graceful-fs', "import gfs from 'graceful-fs';"],
  ['process.mainModule', "const load = process.mainModule.constructor._load;"],
  ['process under another name', 'const p = process; p.exit(1);'],
  ['process.stdout', "process.stdout.write('x');"],
  ['globalThis', "const p = globalThis['pro' + 'cess'];"],
  ['a member chosen at runtime and called', "const r = handlers['con' + 'structor']('return 1');"],
  ['an import that leaves api/', "import { x } from '../scripts/build-sitemap.mjs';"],
  ['an import that reaches into node_modules', "import fse from './node_modules/fs-extra/lib/index.js';"],
  ['an http import', "import x from 'https://example.com/x.js';"],
  ['a TypeScript import-equals', "import fs = require('fs');", 'api/example.ts'],
  ['code the gate cannot parse', 'const = ;'],
  // …and these were HIDDEN from it by its own comment stripper.
  ['an fs import after a line comment that contains /*', "// see api/*.js for the callers\nimport fs from 'node:fs';\n/** doc */\nexport const a = 1;"],
  ['an fs import after a string that contains //', "const u = 'http://example.com'; import('node:fs');"],
  ['an fs import after a string that contains /*', "const glob = 'api/*.js';\nimport fs from 'node:fs';\nconst other = 'x*/';"],
  ['an fs import after a regular expression that contains //', "const re = /https?:\\/\\//; const fs = await import('node:fs');"],
  ['an fs import after a template that contains //', 'const t = `// not a comment`; const fs = require(\'fs\');'],
]) {
  ok(`the gate refuses ${what} under api/`, refused(source, path).length >= 1, source);
}
for (const [what, source] of [
  ['an ordinary module', "import crypto from 'node:crypto';\nexport const h = (s) => crypto.createHash('sha256').update(s).digest('hex');"],
  ['a relative import', "import { ok } from './_lib/ok.js';"],
  ['a comment that mentions fs', "// we used to import fs from 'node:fs' here\n/* require('fs') */\nexport const x = 1;"],
  ['a URL that contains the letters', "const u = 'https://example.com/fs/child_process';"],
  ['a dynamic import of a literal relative path', "const m = await import('./_lib/thing.js');"],
  ['a method that happens to be called evaluate', 'const r = evaluate(x); const y = retrieval(z);'],
  // AUDIT 2026-10-04 (red team) — prose inside a prompt was read as code and would have failed a deploy.
  ['prose in a template that says "require (but not all)"', 'export const K = `Some plans require (but not all) a referral.`;'],
  ['prose in a template that says "eval ("', 'export const K = `A wellness eval (not a physical) is covered. new Function (x)`;'],
  ['prose in a string that says import(', "export const K = 'To import (your records) call us. process.binding(1) constructor eval';"],
  ['a comment that says eval( and constructor', '// eval(x) and .constructor(y) and globalThis\nexport const a = 1;'],
  ['process.env, and asking whether process exists', "const e = typeof process !== 'undefined' && process.env ? process.env.X : undefined;"],
  ['a lookup by a computed key that is not called', 'const v = table[key]; const w = table[key].name;'],
  ['a call of a member named by a literal', "const v = table['lookup'](key); const w = list[0](key);"],
  ['the allow-listed packages', "import OpenAI from 'openai'; import PDFDocument from 'pdfkit';"],
  ['import.meta', 'const here = import.meta.url;'],
]) {
  ok(`and does not flag ${what}`, refused(source).length === 0, refused(source).join(' | '));
}
ok('the module rule is an allow-list: what may be loaded is these three and files under api/',
  same(ALLOWED_MODULES, ['node:crypto', 'openai', 'pdfkit']) && Object.isFrozen(ALLOWED_MODULES));
for (const spec of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'child_process', 'node:child_process', 'worker_threads', 'node:worker_threads', 'vm', 'node:vm', 'cluster', 'node:cluster']) {
  ok(`"${spec}" is named for what it is`, /loads a filesystem\/process module/.test(String(specifierProblem(spec, 'api/x.js'))));
}
for (const spec of ['node:module', 'module', 'node:sqlite', 'node:v8', 'node:os', 'node:path', 'crypto', 'node:http', 'fs-extra', 'graceful-fs', 'data:text/javascript,1', '/abs/path.js', 'file:///x.js', '']) {
  ok(`"${spec}" is not on the allow-list`, /not on the allow-list/.test(String(specifierProblem(spec, 'api/x.js'))));
}
ok('a relative import is judged by where it lands',
  specifierProblem('./_lib/a.js', 'api/x.js') === null && specifierProblem('../chat.js', 'api/_lib/a.js') === null &&
  /resolves outside api\//.test(String(specifierProblem('../x.js', 'api/x.js'))) && /resolves outside api\//.test(String(specifierProblem('../../../etc/x.js', 'api/_lib/cy2027/a.js'))) &&
  /resolves outside api\//.test(String(specifierProblem('./node_modules/x/index.js', 'api/x.js'))) && specifierProblem('.\\_lib\\a.js', 'api/x.js') !== null);
for (const name of ['eval', 'Function', 'require', 'createRequire', 'getBuiltinModule', 'binding', '_linkedBinding', 'dlopen', 'mainModule', 'writeReport', '_load', 'constructor']) {
  ok(`the name "${name}" is refused as a reference, as a member and as a bracket`,
    FORBIDDEN_NAMES.includes(name) && refused(`const v = ${name};`).length >= 1 && refused(`const v = thing.${name};`).length >= 1 && refused(`const v = thing['${name}'];`).length >= 1);
}
for (const name of ['globalThis', 'global', 'module', '__filename', '__dirname']) {
  ok(`the global "${name}" is refused as a reference, and is an ordinary word as a member`,
    FORBIDDEN_GLOBALS.includes(name) && refused(`const v = ${name};`).length >= 1 && refused(`const v = thing.${name};`).length === 0);
}
ok('the refusal says where', /^api\/example\.js: .* \(line 3\)$/.test(refused("const a = 1;\n\nimport fs from 'node:fs';")[0]));

// The parser, not a pair of regular expressions, says what a comment is.
{
  const hidden = "// see api/*.js for the callers\nimport fs from 'node:fs';\n/** doc */\nexport const a = 1;";
  ok('a /* inside a line comment opens nothing: the import after it is still there',
    stripComments(hidden, 'x.js').includes("import fs from 'node:fs';") && !stripComments(hidden, 'x.js').includes('callers') && !stripComments(hidden, 'x.js').includes('doc'));
  ok('// and /* inside a string, a template and a regular expression are not comments',
    stripComments("const a = 'http://x/*y*/'; const b = `// z`; const c = /\\/\\/|\\/\\*/; // gone", 'x.js') === "const a = 'http://x/*y*/'; const b = `// z`; const c = /\\/\\/|\\/\\*/; ");
  ok('nor is // inside JSX text, while a comment inside a JSX expression is',
    stripComments('const e = <p>http://example.com {/* gone */ value} // kept</p>; // gone', 'x.tsx') === 'const e = <p>http://example.com { value} // kept</p>; ');
  ok('block, line, doc and trailing comments all go; nothing else does',
    stripComments('/** d */\nconst a = 1; /* b */ const b = 2; // c\n// d\nconst c = a /* e */ + b;', 'x.js') === '\nconst a = 1;  const b = 2; \n\nconst c = a  + b;');
  ok('a shebang line is left alone', stripComments('#!/usr/bin/env node\n// gone\nconst a = 1;', 'x.mjs') === '#!/usr/bin/env node\n\nconst a = 1;');
  throws('text that does not parse is not scanned at all', () => stripComments('const = ;', 'x.js'), /does not parse/);
  ok('without a path the text is read as TypeScript or JavaScript, whichever parses',
    stripComments('const a: number = 1; // gone') === 'const a: number = 1; ' && stripComments('const e = <p>// kept</p>; // gone') === 'const e = <p>// kept</p>; ');
  ok('the imports of a file are read the same way',
    same(importSpecifiers("// import x from 'node:fs'\nimport a from './a.js';\nexport * from './b.js';\nconst c = await import('./c.js');\nconst d = await import(name);\nconst s = \"import('./no.js')\";", 'x.js'),
      ['./a.js', './b.js', './c.js', null]));
}

// ── 5. The gate: governing artefacts are never written to ────────────────────
for (const [what, source, path] of [
  ['a let declaration', "let SYSTEM_PROMPT = 'x';"],
  ['a var declaration', 'var STATE_RULESETS = {};'],
  ['a let declaration with no initial value', 'let SYSTEM_PROMPT;'],
  ['a var declaration with no initial value', 'var SOA_TEXT;'],
  ['a reassignment', 'SYSTEM_PROMPT = SYSTEM_PROMPT + learned;'],
  ['a compound assignment', 'SYSTEM_PROMPT += learned;'],
  ['a property write', "SOA_TEXT.en.intro = 'new';"],
  ['a computed property write', "STATE_RULESETS['NY'].status = 'SUPERSEDED';"],
  ['a deep property write', 'CMS_RULESET_2028.soa.advanceWaitHours = 0;'],
  ['a push', "GRANDFATHERED_RULESET_VERSIONS.push('CMS_RULESET_2028-v1.0');"],
  ['a nested push', "CMS_RULESET_2027.sources.push('a blog post');"],
  ['a splice', 'LEARNING_PIPELINE.splice(1, 6);'],
  ['Object.assign', "Object.assign(TPMO_DISCLAIMER_CONFIG, { status: 'VERIFIED' });"],
  ['Object.defineProperty', "Object.defineProperty(SOA_TEXT, 'en', { value: {} });"],
  ['Reflect.set', "Reflect.set(SOA_TEXT, 'en', {});"],
  ['delete', 'delete SOA_CATEGORIES;'],
  ['a logical assignment', 'MEDICARE_KNOWLEDGE ??= fallback;'],
  // AUDIT 2026-10-04 (red team) — writes the text-matching version did not see.
  ['an increment', 'SYSTEM_PROMPT++;'],
  ['a prefix decrement of a member', '--CMS_RULESET_2027.soa.advanceWaitHours;'],
  ['a destructuring assignment', '({ a: SYSTEM_PROMPT } = learned);'],
  ['a shorthand destructuring assignment', '({ SYSTEM_PROMPT } = learned);'],
  ['an array destructuring assignment', '[SOA_TEXT.en.intro, other] = learned;'],
  ['a destructuring assignment with a default', '[SYSTEM_PROMPT = fallback] = learned;'],
  ['a method called through an optional chain', "LEARNING_PIPELINE?.push('SHIP_IT');"],
  ['a method named in brackets', "CANDIDATE_KINDS['push']('NEW_SALES_ANGLE');"],
  ['Array.prototype.push.call', "Array.prototype.push.call(CANDIDATE_KINDS, 'NEW_SALES_ANGLE');"],
  ['[].splice.apply', '[].splice.apply(LEARNING_PIPELINE, [1, 6]);'],
  ['Reflect.apply of a mutator', "Reflect.apply(Array.prototype.push, CANDIDATE_KINDS, ['X']);"],
  ['a delete of a member', 'delete STATE_RULESETS.NY;'],
  ['a for-of that writes into it', 'for (SYSTEM_PROMPT of prompts) { use(); }'],
  ['a for-in that writes into a member', 'for (SOA_TEXT.en.intro in table) { use(); }'],
  ['a function declared under its name', 'function SYSTEM_PROMPT() { return learned; }'],
  ['a parameter that shadows it', 'export function reply(SYSTEM_PROMPT) { return SYSTEM_PROMPT; }'],
  ['a const declared again inside a function', 'function reply() { const SYSTEM_PROMPT = learned; return SYSTEM_PROMPT; }'],
  ['a different import brought in under its name', "import { LEARNED_PROMPT as SYSTEM_PROMPT } from './learned.js';"],
  ['a write through a TypeScript cast', "(SOA_TEXT as any).en = {};", 'src/example.ts'],
  ['a write after a line comment that contains /*', "// see api/*.js\nSYSTEM_PROMPT = learned;\n/* x */"],
  ['a file that names one and cannot be parsed', 'const SYSTEM_PROMPT = ;'],
]) {
  ok(`the gate refuses ${what} on a governing artefact`, findGoverningMutation(file(source, path)).length >= 1, source);
}
for (const [what, source] of [
  ['its own const declaration', 'const SYSTEM_PROMPT = `You are…`;'],
  ['its exported const declaration', 'export const SOA_TEXT = Object.freeze({ en: {} });'],
  ['a read', 'const t = SOA_TEXT[lang].intro;'],
  ['a comparison', 'if (STATE_RULESETS[code] === rs || RULESETS[year] !== other) { ok(); }'],
  ['an ordering comparison', 'if (LEARNING_PIPELINE.length >= 3 && CANDIDATE_KINDS.length <= 9) { ok(); }'],
  ['being the VALUE of another assignment', 'const registry = RULESETS; let copy = SOA_TEXT;'],
  ['a default parameter', 'export function f(ruleset, registry = RULESETS) { return registry; }'],
  ['an arrow function over it', 'const names = CANDIDATE_KINDS.map((k) => k.toLowerCase());'],
  ['a non-mutating method', 'const s = LEARNING_PIPELINE.slice().sort(); const i = CANDIDATE_KINDS.indexOf(k);'],
  ['a comment about assigning to it', '// never do SYSTEM_PROMPT = x\nexport const a = 1;'],
  ['a string about assigning to it', "const note = 'SYSTEM_PROMPT = x; SOA_TEXT.push(1)';"],
  ['a different identifier that contains the name', 'MY_SYSTEM_PROMPT_COPY = 1; SOA_TEXT_DIGEST = 2;'],
  ['a member of another object that has its name', 'config.SYSTEM_PROMPT = 1; other.SOA_TEXT.push(2);'],
  ['an ordinary import of it', "import { SYSTEM_PROMPT, SOA_TEXT as SOA_TEXT } from './prompt.js';"],
]) {
  ok(`and does not flag ${what}`, findGoverningMutation(file(source)).length === 0, findGoverningMutation(file(source)).join(' | '));
}
ok('the governing list is exactly the prompt, the knowledge, the rulesets, the SOA text and the decision tables',
  same(GOVERNING_IDENTIFIERS, [
    'CMS_RULESET_2026', 'CMS_RULESET_2027', 'CMS_RULESET_2028', 'RULESETS', 'STATE_RULESETS',
    'GRANDFATHERED_RULESET_VERSIONS', 'RULESET_LIFECYCLE',
    'SOA_TEXT', 'SOA_CATEGORIES', 'TPMO_DISCLAIMER_CONFIG', 'LANGUAGE_SOURCE', 'SOA_METHOD',
    'CARRIER_OVERLAYS', 'MEDICARE_KNOWLEDGE', 'SYSTEM_PROMPT',
    'CANDIDATE_KINDS', 'LEARNING_PIPELINE', 'LEARNING_REJECTION_REASONS', 'AUTOMATED_OBSERVATIONS',
  ]) && Object.isFrozen(GOVERNING_IDENTIFIERS));
for (const id of GOVERNING_IDENTIFIERS) {
  ok(`a write to ${id} is refused`, findGoverningMutation(file(`${id}.x = 1;`)).length === 1 && findGoverningMutation(file(`${id} = 1;`)).length === 1);
}

// ── 6. The gate: frozen all the way down ─────────────────────────────────────
ok('a shallow freeze is caught', unfrozenPaths(Object.freeze({ years: [4, 6] }), 'R').join() === 'R.years');
ok('a deep freeze passes', unfrozenPaths(Object.freeze({ years: Object.freeze([4, 6]), n: Object.freeze({ a: 1 }) }), 'R').length === 0);
ok('an unfrozen root is reported', unfrozenPaths({ a: 1 }, 'R').join() === 'R');
ok('primitives and null are fine', unfrozenPaths('text', 'R').length === 0 && unfrozenPaths(null, 'R').length === 0);
ok('a cycle does not hang it', (() => { const a = { }; a.self = a; return unfrozenPaths(a, 'R').length === 1; })());
ok('a getter is not frozen data, however frozen the object is',
  unfrozenPaths(Object.freeze(Object.defineProperty({}, 'rules', { get() { return {}; }, enumerable: true })), 'R').join() === 'R.rules (accessor)');

// ── 7. The gate against THIS repository ──────────────────────────────────────
{
  const r = await runGate();
  ok('the repository passes the gate', r.problems.length === 0, r.problems.join(' | '));
  ok('it looked at a real tree', r.apiFiles >= 10 && r.srcFiles >= 20);
  ok('every governing object it knows about is frozen all the way down', r.frozenCount === r.objectCount && r.objectCount === 15);
}
{
  // The same gate, handed a tree that contains each kind of defect.
  const clean = { apiFiles: [{ path: 'api/ok.js', source: 'export const a = 1;' }], srcFiles: [{ path: 'src/ok.ts', source: 'export const b = 2;' }], objects: { X: Object.freeze({ a: 1 }) } };
  ok('a clean injected tree passes', (await runGate(clean)).problems.length === 0);
  ok('the assembled gate reports a filesystem import under api/',
    (await runGate({ ...clean, apiFiles: [{ path: 'api/bad.js', source: "import fs from 'node:fs';" }] })).problems.some((p) => /api\/bad\.js: loads a filesystem\/process module/.test(p)));
  ok('the assembled gate reports a write to a governing artefact from api/',
    (await runGate({ ...clean, apiFiles: [{ path: 'api/bad.js', source: 'SYSTEM_PROMPT += learned;' }] })).problems.some((p) => /api\/bad\.js: writes to SYSTEM_PROMPT/.test(p)));
  ok('and from src/',
    (await runGate({ ...clean, srcFiles: [{ path: 'src/bad.ts', source: "SOA_TEXT.en.intro = 'x';" }] })).problems.some((p) => /src\/bad\.ts: writes to SOA_TEXT\.en\.intro/.test(p)));
  ok('the assembled gate reports an object that is not frozen all the way down',
    (await runGate({ ...clean, objects: { RULES: Object.freeze({ years: [4, 6] }) } })).problems.some((p) => /RULES is not frozen all the way down: RULES\.years/.test(p)));
  ok('an object that is no longer exported is a failure, not a pass',
    (await runGate({ ...clean, objects: { GONE: undefined } })).problems.some((p) => /GONE is no longer exported/.test(p)));
  ok('a gate with nothing to check has failed', (await runGate({ ...clean, objects: {} })).problems.some((p) => /nothing to vouch for/.test(p)));
}
{
  // AUDIT 2026-10-04 (red team) — the gate was only ever handed lists of files.
  // Its WALK of a real tree, and its COMMAND, were never seen failing: a walk
  // that skipped src/ or every extension but .js, and a command that exited 0
  // on failure, all left the suite green. Here is a copy of this repository's
  // api/ and src/ with defects planted in it, walked and judged by the gate
  // itself and then by its command.
  const CLI = fileURLToPath(new URL('./check-no-self-modification.mjs', import.meta.url));
  const run = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
  const tree = mkdtempSync(join(tmpdir(), 'cp-selfmod-'));
  try {
    cpSync(join(REPO_ROOT, 'api'), join(tree, 'api'), { recursive: true });
    cpSync(join(REPO_ROOT, 'src'), join(tree, 'src'), { recursive: true });
    // The copy must be read the way the original is: as ES modules.
    writeFileSync(join(tree, 'package.json'), JSON.stringify({ type: JSON.parse(read('../package.json')).type }));
    const copy = await runGate({ root: tree });
    ok('an untouched copy of the tree passes, walked from its own root', copy.problems.length === 0 && copy.apiFiles >= 10 && copy.srcFiles >= 20, copy.problems.join(' | '));
    const cleanRun = run(['--root', tree]);
    ok('and the command says so, naming the tree it judged', cleanRun.status === 0 && cleanRun.stdout.includes('[self-modification] OK (tree: ' + tree + ')'), cleanRun.stdout + cleanRun.stderr);

    mkdirSync(join(tree, 'api', '_lib', 'deep'), { recursive: true });
    writeFileSync(join(tree, 'api', '_lib', 'deep', 'zz-fs.js'), "// see api/*.js\nimport { appendFileSync } from 'node:fs';\n/** doc */\nexport const w = (t) => appendFileSync('api/_lib/medicare-knowledge.js', t);\n");
    writeFileSync(join(tree, 'api', 'zz-computed.mjs'), "export const load = async () => import('node:' + 'fs');\n");
    writeFileSync(join(tree, 'api', 'zz-require.cjs'), "const fs = require('fs');\nmodule.exports = fs;\n");
    writeFileSync(join(tree, 'api', 'zz-typed.ts'), "import { execFile } from 'node:child_process';\nexport const run: typeof execFile = execFile;\n");
    writeFileSync(join(tree, 'api', 'zz-native.node'), 'not code');
    writeFileSync(join(tree, 'src', 'zz-mutation.ts'), "import { SOA_TEXT } from './lib/cy2027';\n(SOA_TEXT as any).en = {};\n");
    writeFileSync(join(tree, 'src', 'zz-mutation.jsx'), 'CANDIDATE_KINDS.push("X");\nexport const e = <p>x</p>;\n');
    const bad = await runGate({ root: tree });
    for (const [what, re] of [
      ['an fs import hidden behind a comment, in a nested directory', /^api\/_lib\/deep\/zz-fs\.js: loads a filesystem\/process module \('node:fs'\)/],
      ['a computed import in an .mjs file', /^api\/zz-computed\.mjs: loads a module whose name is computed at runtime/],
      ['a require in a .cjs file', /^api\/zz-require\.cjs: uses `require`/],
      ['a child_process import in a .ts file', /^api\/zz-typed\.ts: loads a filesystem\/process module \('node:child_process'\)/],
      ['a file under api/ that is not code', /^api\/zz-native\.node: is not a source file the gate can read/],
      ['a write to a governing artefact from a .ts file under src/', /^src\/zz-mutation\.ts: writes to \(SOA_TEXTasany\)\.en/],
      ['a mutation from a .jsx file under src/', /^src\/zz-mutation\.jsx: mutates CANDIDATE_KINDS in place/],
    ]) {
      ok(`walking a real tree, the gate finds ${what}`, bad.problems.some((p) => re.test(p)), bad.problems.join(' | '));
    }
    const badRun = run(['--root', tree]);
    ok('the COMMAND fails on that tree: exit code 1, the FAILED banner, the file named',
      badRun.status === 1 && /\[self-modification\] FAILED \(tree: .*\) — \d+ problem\(s\):/.test(badRun.stderr) && badRun.stderr.includes('api/_lib/deep/zz-fs.js') &&
      !badRun.stdout.includes('OK'), 'status=' + badRun.status + ' ' + badRun.stderr.slice(0, 300));
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
  const real = run([]);
  ok('the command passes on this repository and SAYS so (silence is not a pass)',
    real.status === 0 && /^\[self-modification\] OK — \d+ files under api\//.test(real.stdout) && real.stderr === '', 'status=' + real.status + ' ' + real.stdout + real.stderr);
  const unknown = run(['--skip']);
  ok('an argument it does not know is a failure, not something to ignore', unknown.status === 2 && /unknown arguments/.test(unknown.stderr) && unknown.stdout === '');
  ok('a tree that is not there is a failure', run(['--root', join(tmpdir(), 'cp-selfmod-does-not-exist')]).status === 1);
  {
    const said = { out: [], err: [] };
    const io = { log: (m) => said.out.push(m), error: (m) => said.err.push(m) };
    ok('runCli returns the code it would exit with', await runCli([], io) === 0 && said.out.length === 1 && said.err.length === 0 && await runCli(['--root'], io) === 2);
  }
  // The command file itself: running it IS running the gate. No condition can skip it.
  const cliStatements = topLevelStatements(read('./check-no-self-modification.mjs'), 'scripts/check-no-self-modification.mjs');
  ok('the command file is an import and one unconditional statement',
    same(cliStatements, ["import { runCli } from './no-self-modification-lib.mjs';", 'process.exitCode = await runCli(process.argv.slice(2));']), cliStatements.join(' | '));
}
{
  const PKG = JSON.parse(read('../package.json'));
  ok('the gate runs inside the build, with no argument', /(^|&&)\s*node scripts\/check-no-self-modification\.mjs\s*&&/.test(PKG.scripts.build) && !/--root/.test(PKG.scripts.build));
  ok('and both of its files are shipped to the Vercel build',
    /^!scripts\/check-no-self-modification\.mjs\r?$/m.test(read('../.vercelignore')) && /^!scripts\/no-self-modification-lib\.mjs\r?$/m.test(read('../.vercelignore')));
  ok('every extension Node would run is one the gate parses', same(CODE_EXTENSIONS, ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']));
}

// ── 8. A record is read once ─────────────────────────────────────────────────
ok('plainRecord copies own data properties and nothing else',
  same(plainRecord({ a: 1, b: 2 }, ['a'], ['b']), { a: 1, b: 2 }) && plainRecord({ a: 1 }, ['a', 'b']) === null && plainRecord({ a: 1, c: 3 }, ['a']) === null &&
  plainRecord(Object.create({ a: 1 }), ['a']) === null && plainRecord([1], []) === null && plainRecord(null, []) === null && plainRecord('x', []) === null &&
  plainRecord({ get a() { return 1; } }, ['a']) === null && plainRecord({ a: 1, [Symbol('s')]: 2 }, ['a']) === null &&
  plainRecord(new (class Thing { a = 1; })(), ['a']) === null && same(plainRecord(Object.assign(Object.create(null), { a: 1 }), ['a']), { a: 1 }));
ok('plainList copies a real array of data elements and nothing else',
  same(plainList([1, 2]), [1, 2]) && plainList({ 0: 1, length: 1 }) === null && plainList('ab') === null && plainList(Object.assign([1], { extra: 2 })) === null &&
  plainList([1, , 3]) === null && plainList(Object.defineProperty([1], 0, { get() { return 9; } })) === null && plainList(new (class L extends Array {})()) === null);
ok('ownData never invokes a getter and never looks up the prototype',
  ownData({ a: 1 }, 'a') === 1 && ownData(Object.create({ a: 1 }), 'a') === undefined && ownData({ get a() { throw new Error('read'); } }, 'a') === undefined && ownData(null, 'a') === undefined);

// ── 9. AUDIT 2026-10-04 — what the first independent read broke ──────────────
// Every rule about what a candidate may BE was enforced in the constructor and
// nowhere else. A record put together by hand went through every later stage.
ok('the surfaces are a closed list, and the shared web endpoint is one of them',
  JSON.stringify(LEARNING_SURFACES) === JSON.stringify(['VOICE_EMELY', 'VOICE_SOFIA', 'WEB_CLARA', 'WEB_ZARA', 'WEB_CHAT', 'WEB_FORM']) &&
  Object.isFrozen(LEARNING_SURFACES));
{
  const handBuilt = (over) => ({ ...made.candidate, ...over });
  for (const [what, over, reason] of [
    ['a kind nobody defined', { kind: 'NEW_SALES_ANGLE' }, 'CANDIDATE_KIND_UNKNOWN'],
    ['a kind from the prototype chain', { kind: 'constructor' }, 'CANDIDATE_KIND_UNKNOWN'],
    ['an unknown surface', { surface: 'OUTBOUND_DIALER' }, 'CANDIDATE_SURFACE_UNKNOWN'],
    ['an unknown language', { language: 'fr' }, 'CANDIDATE_LANGUAGE_UNKNOWN'],
    ['a count of zero', { occurrences: 0 }, 'CANDIDATE_OCCURRENCES_INVALID'],
    ['an unreadable creation instant', { createdAt: 'yesterday' }, 'CANDIDATE_INSTANT_INVALID'],
    ['an id carrying free text', { candidateId: 'Maria Lopez 631-555-0123' }, 'CANDIDATE_ID_INVALID'],
    ['an id that is a Social Security number', { candidateId: '123-45-6789' }, 'CANDIDATE_ID_INVALID'],
    ['an id of the right shape that somebody chose', { candidateId: '00000000000000000000006315550123' }, 'CANDIDATE_ID_INVALID'],
    ['another candidate\'s id', { candidateId: createCandidateLearning({ ...base, occurrences: 5 }).candidate.candidateId }, 'CANDIDATE_ID_INVALID'],
    ['a kind changed after the id was made', { kind: 'ROUTING_ERROR' }, 'CANDIDATE_ID_INVALID'],
    ['a count changed after the id was made', { occurrences: 400 }, 'CANDIDATE_ID_INVALID'],
    ['a clean summary swapped in after the id was made', { summary: 'The menu is too long.' }, 'CANDIDATE_ID_INVALID'],
    ['a summary quoting a caller\'s SSN', { summary: 'Caller gave SSN 123-45-6789.' }, 'CANDIDATE_CONTAINS_SENSITIVE_DATA'],
    ['a summary naming a caller', { summary: 'Mrs. Delgado did not understand the menu.' }, 'CANDIDATE_CONTAINS_SENSITIVE_DATA'],
    ['a summary carrying a health condition', { summary: 'She has diabetes and takes insulin every day.' }, 'CANDIDATE_CONTAINS_SENSITIVE_DATA'],
    ['a phrase carrying a phone number', { agentPhrase: 'Call back at 631-555-0123.' }, 'CANDIDATE_CONTAINS_SENSITIVE_DATA'],
    ['an empty summary', { summary: '   ' }, 'CANDIDATE_TEXT_REQUIRED'],
    ['an over-long summary', { summary: 'x'.repeat(SUMMARY_MAX_CHARS + 1) }, 'CANDIDATE_TEXT_TOO_LONG'],
    ['an extra field', { transcript: 'everything the caller said' }, 'CANDIDATE_FIELD_NOT_ALLOWED'],
    ['an extra symbol-keyed field', { [Symbol('note')]: 'caller notes' }, 'CANDIDATE_FIELD_NOT_ALLOWED'],
  ]) {
    const record = handBuilt(over);
    ok(`a hand-built record with ${what} is not trusted (${reason})`, candidateHistoryProblem(record) === reason, String(candidateHistoryProblem(record)));
    throws(`…and cannot be advanced (${what})`, () => advanceCandidate(record, person(0)), /not trustworthy/);
    throws(`…or rejected (${what})`, () => rejectCandidate(record, { actor: 'Sawil Reyes', at: '2026-10-06T10:00:00Z', reasonCode: 'DUPLICATE' }), /not trustworthy/);
    throws(`…or logged (${what})`, () => candidateLogLine(record), /not trustworthy/);
  }
  ok('an extra field that is not enumerable is found too',
    candidateHistoryProblem(Object.defineProperty(handBuilt({}), 'hidden', { value: 'caller notes', enumerable: false })) === 'CANDIDATE_FIELD_NOT_ALLOWED');
  ok('a deployed record whose summary was swapped for a caller\'s details is no longer a deployed learning',
    isDeployedLearning(walked) === true && isDeployedLearning({ ...walked, summary: 'Caller gave SSN 123-45-6789.' }) === false && isDeployedLearning({ ...walked, summary: 'Another clean sentence.' }) === false);
  ok('a record with no phrase key at all is the same as a record with a null phrase', (() => {
    const { agentPhrase: _gone, ...rest } = createCandidateLearning({ ...base, agentPhrase: null }).candidate;
    return candidateHistoryProblem(rest) === null && candidateHistoryProblem({ ...rest, agentPhrase: null }) === null && advanceCandidate(rest, person(0)).agentPhrase === null;
  })());
  ok('the records the pipeline itself produced are all still trusted',
    candidateHistoryProblem(made.candidate) === null && candidateHistoryProblem(walked) === null && candidateHistoryProblem(rejected) === null);

  // A step may carry only what a step is.
  const stepOne = { from: 'CANDIDATE', to: 'HUMAN_COMPLIANCE_REVIEW', ...person(0) };
  ok('a forward step with an extra field is refused',
    candidateHistoryProblem(handBuilt({ stage: 'HUMAN_COMPLIANCE_REVIEW', history: [stepOne] })) === null &&
    candidateHistoryProblem(handBuilt({ stage: 'HUMAN_COMPLIANCE_REVIEW', history: [{ ...stepOne, note: 'the caller said…' }] })) === 'HISTORY_ENTRY_MALFORMED');
  const rejectionStep = { from: 'CANDIDATE', to: LEARNING_REJECTED, actor: 'Sawil Reyes', at: '2026-10-06T10:00:00Z', reasonCode: 'DUPLICATE' };
  const rejectedBy = (over, forward = []) => handBuilt({ stage: LEARNING_REJECTED, history: [...forward, { ...rejectionStep, ...over }] });
  ok('a rejection step with an extra field is refused',
    candidateHistoryProblem(rejectedBy({})) === null &&
    candidateHistoryProblem(rejectedBy({ evidenceReference: 'x' })) === 'HISTORY_ENTRY_MALFORMED');

  // AUDIT 2026-10-04 (red team) — the REJECTION half of the validator was not
  // pinned at all: its actor, instant and from/to checks could be deleted
  // together with the suite green. The mirror path, again. One assertion each.
  for (const [what, record, reason] of [
    ['made by automation', rejectedBy({ actor: 'svc_bot' }), 'HISTORY_STEP_NOT_BY_A_PERSON'],
    ['made by one of the assistants', rejectedBy({ actor: 'Sofía' }), 'HISTORY_STEP_NOT_BY_A_PERSON'],
    ['made by a person who is not authorised', rejectedBy({ actor: 'John Smith' }), 'HISTORY_STEP_NOT_BY_A_PERSON'],
    ['made by nobody', rejectedBy({ actor: null }), 'HISTORY_STEP_NOT_BY_A_PERSON'],
    ['dated "later"', rejectedBy({ at: 'later' }), 'HISTORY_INSTANT_INVALID'],
    ['dated on an impossible day', rejectedBy({ at: '2026-02-31T00:00:00Z' }), 'HISTORY_INSTANT_INVALID'],
    ['made from a stage the candidate was not at', rejectedBy({ from: 'SOURCE_VERIFICATION' }), 'HISTORY_OUT_OF_ORDER'],
    ['made from the stage BEFORE the one it was at', rejectedBy({ from: 'CANDIDATE' }, [stepOne]), 'HISTORY_OUT_OF_ORDER'],
    ['that does not end in REJECTED', rejectedBy({ to: 'DEPLOYMENT' }), 'HISTORY_OUT_OF_ORDER'],
    ['with a reason that is a sentence about a caller', rejectedBy({ reasonCode: 'Caller Rosa Delgado SSN 123-45-6789 has diabetes' }), 'HISTORY_REASON_UNKNOWN'],
    ['with a reason nobody listed', rejectedBy({ reasonCode: 'X' }), 'HISTORY_REASON_UNKNOWN'],
    ['with no reason', rejectedBy({ reasonCode: '  ' }), 'HISTORY_REASON_MISSING'],
    ['with its actor left out', handBuilt({ stage: LEARNING_REJECTED, history: [(({ actor: _gone, ...rest }) => rest)(rejectionStep)] }), 'HISTORY_ENTRY_MALFORMED'],
    ['with its destination left out', handBuilt({ stage: LEARNING_REJECTED, history: [(({ to: _gone, ...rest }) => rest)(rejectionStep)] }), 'HISTORY_ENTRY_MALFORMED'],
    ['that is not an object', handBuilt({ stage: LEARNING_REJECTED, history: ['REJECTED'] }), 'HISTORY_ENTRY_MALFORMED'],
    ['of a DEPLOYED learning', { ...walked, stage: LEARNING_REJECTED, history: [...walked.history, { ...rejectionStep, from: 'DEPLOYMENT', at: '2026-10-20T00:00:00Z' }] }, 'HISTORY_REJECTION_AFTER_DEPLOYMENT'],
    ['after steps beyond DEPLOYMENT', { ...walked, stage: LEARNING_REJECTED, history: [...walked.history, { ...stepOne, from: 'DEPLOYMENT', at: '2026-10-19T00:00:00Z' }, { ...rejectionStep, at: '2026-10-20T00:00:00Z' }] }, 'HISTORY_REJECTION_AFTER_DEPLOYMENT'],
  ]) {
    ok(`a rejected record whose rejection was ${what} is not trusted (${reason})`, candidateHistoryProblem(record) === reason, String(candidateHistoryProblem(record)));
    throws(`…and is not logged (${what})`, () => candidateLogLine(record), /not trustworthy/);
  }
  ok('a rejection from the last stage that CAN be rejected is trusted',
    candidateHistoryProblem({ ...walked, stage: LEARNING_REJECTED, history: [...walked.history.slice(0, 6), { ...rejectionStep, from: 'APPROVAL', at: '2026-10-20T00:00:00Z' }] }) === null);

  // The mirror path. Advancing refused a step dated before the one it follows; rejecting did not.
  throws('a rejection cannot be dated before the candidate existed',
    () => rejectCandidate(made.candidate, { actor: 'Sawil Reyes', at: '2026-10-01T00:00:00Z', reasonCode: 'DUPLICATE' }), /before the one it follows/);
  throws('nor before the step it follows',
    () => rejectCandidate(advanceCandidate(made.candidate, person(3)), { actor: 'Sawil Reyes', at: '2026-10-06T10:00:00Z', reasonCode: 'DUPLICATE' }), /before the one it follows/);
  ok('a rejection at the very instant of the last step is allowed (same clock tick, not earlier)',
    rejectCandidate(made.candidate, { actor: 'Sawil Reyes', at: made.candidate.createdAt, reasonCode: 'DUPLICATE' }).stage === LEARNING_REJECTED);
  ok('a rejected record whose rejection predates the candidate is not trusted',
    candidateHistoryProblem(rejectedBy({ at: '2026-10-01T00:00:00Z' })) === 'HISTORY_NOT_CHRONOLOGICAL');
  ok('nor one whose rejection predates the step before it',
    candidateHistoryProblem(rejectedBy({ from: 'HUMAN_COMPLIANCE_REVIEW', at: '2026-10-08T00:00:00Z' }, [{ ...stepOne, at: '2026-10-09T00:00:00Z' }])) === 'HISTORY_NOT_CHRONOLOGICAL');

  // Frozen all the way down: Object.freeze is shallow, and a hand-built step stayed editable inside the "frozen" record.
  const looseStep = { ...stepOne };
  const advanced = advanceCandidate(handBuilt({ stage: 'HUMAN_COMPLIANCE_REVIEW', history: [looseStep] }), person(1));
  ok('advancing freezes every earlier step, not only the new one', advanced.history.length === 2 && advanced.history.every((s) => Object.isFrozen(s)));
  looseStep.actor = 'Someone Else';
  ok('and the record no longer shares the object it was handed', advanced.history[0].actor === 'Maria Lopez');
  const looseStep2 = { ...stepOne };
  const rejectedLate = rejectCandidate(handBuilt({ stage: 'HUMAN_COMPLIANCE_REVIEW', history: [looseStep2] }), { actor: 'Sawil Reyes', at: '2026-10-06T10:00:00Z', reasonCode: 'DUPLICATE' });
  looseStep2.actor = 'Someone Else';
  ok('rejecting does the same', rejectedLate.history.every((s) => Object.isFrozen(s)) && rejectedLate.history[0].actor === 'Maria Lopez');

  // The log line is only ever built from a trusted record.
  let message = '';
  try { candidateLogLine(handBuilt({ kind: 'call me at 631-555-0123' })); } catch (e) { message = String(e && e.message); }
  ok('the refusal to log does not repeat what it refused', /not trustworthy \(CANDIDATE_KIND_UNKNOWN\)/.test(message) && !message.includes('631'));

  // AUDIT 2026-10-04 (red team) — the validator judged the object and the log
  // line then read it AGAIN. A getter that answered 'FAILED_PHRASE' once and a
  // phone number afterwards was printed verbatim; fields held on the prototype
  // passed a check that only counted own keys.
  let reads = 0;
  const flipping = Object.defineProperty(handBuilt({}), 'kind', { get() { reads += 1; return reads === 1 ? 'FAILED_PHRASE' : 'call me at 631-555-0123'; }, enumerable: true });
  ok('a record that answers through a getter is not a record, and the getter is never run',
    candidateHistoryProblem(flipping) === 'CANDIDATE_NOT_PLAIN' && reads === 0);
  throws('it is not logged', () => candidateLogLine(flipping), /not trustworthy \(CANDIDATE_NOT_PLAIN\)/);
  throws('nor advanced', () => advanceCandidate(flipping, person(0)), /not trustworthy/);
  ok('…and through all of that the getter was still never run', reads === 0);
  const inherited = Object.create(made.candidate, { stage: { value: 'CANDIDATE', enumerable: true }, history: { value: [], enumerable: true } });
  ok('fields held on the prototype are not the record\'s fields',
    candidateHistoryProblem(inherited) === 'CANDIDATE_NOT_PLAIN' && candidateHistoryProblem(new (class Candidate { constructor() { Object.assign(this, made.candidate); } })()) === 'CANDIDATE_NOT_PLAIN' &&
    candidateHistoryProblem([made.candidate]) === 'CANDIDATE_NOT_PLAIN');
  let actorReads = 0;
  const flippingStep = Object.defineProperty({ ...stepOne }, 'actor', { get() { actorReads += 1; return actorReads === 1 ? 'Maria Lopez' : 'svc_bot'; }, enumerable: true });
  ok('a step that answers through a getter is not a step',
    candidateHistoryProblem(handBuilt({ stage: 'HUMAN_COMPLIANCE_REVIEW', history: [flippingStep] })) === 'HISTORY_ENTRY_MALFORMED' && actorReads === 0);
  // An object that can lie even about its own properties: every read is taken ONCE, and only the copy is used.
  const lying = (target) => {
    const seen = new Map();
    return new Proxy({ ...target }, {
      getOwnPropertyDescriptor(t, key) {
        const d = Reflect.getOwnPropertyDescriptor(t, key);
        if (!d || key !== 'kind') return d;
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        return n === 1 ? d : { ...d, value: 'call me at 631-555-0123' };
      },
      get(t, key) { return key === 'kind' ? 'call me at 631-555-0123' : t[key]; },
    });
  };
  ok('what is logged is what was judged, even for an object that changes its answer', (() => {
    const line = candidateLogLine(lying(made.candidate));
    return !line.includes('631') && JSON.parse(line.slice(21)).kind === 'FAILED_PHRASE';
  })());
  ok('and what is advanced is what was judged', (() => {
    const next = advanceCandidate(lying(made.candidate), person(0));
    return next.kind === 'FAILED_PHRASE' && candidateHistoryProblem(next) === null && Object.getPrototypeOf(next) === Object.prototype;
  })());
  ok('advancing a record that is trusted returns a record with every field as its own',
    same(Object.keys(advanceCandidate(made.candidate, person(0))).sort(), ['agentPhrase', 'candidateId', 'createdAt', 'history', 'kind', 'language', 'occurrences', 'stage', 'summary', 'surface']));
}

// ── 10. What an automated surface may do with an observation: one line, or nothing ─
{
  ok('the automated observations are a closed table of fixed sentences',
    same(Object.keys(AUTOMATED_OBSERVATIONS), ['FILTER_CORRECTED_REPLY']) && Object.isFrozen(AUTOMATED_OBSERVATIONS) && Object.isFrozen(AUTOMATED_OBSERVATIONS.FILTER_CORRECTED_REPLY) &&
    same(AUTOMATED_OBSERVATIONS.FILTER_CORRECTED_REPLY, { kind: 'FAILED_PHRASE', surface: 'WEB_CHAT', summary: 'The compliance post-filter had to correct the assistant reply before it was sent.' }));
  ok('every sentence in it is one the candidate rules accept',
    Object.values(AUTOMATED_OBSERVATIONS).every((o) => createCandidateLearning({ ...o, language: 'en' }).ok === true));
  const observation = { observation: 'FILTER_CORRECTED_REPLY', language: 'en' };
  const line = observationLogLine(observation);
  const parsed = typeof line === 'string' && line.startsWith('[CANDIDATE-LEARNING] ') ? JSON.parse(line.slice(21)) : null;
  ok('an observation becomes one tagged line', parsed !== null);
  ok('the line carries exactly six coarse fields',
    parsed && JSON.stringify(Object.keys(parsed)) === JSON.stringify(['candidateId', 'kind', 'surface', 'language', 'stage', 'occurrences']));
  ok('it is a new candidate at the first stage, observed once',
    parsed && parsed.kind === 'FAILED_PHRASE' && parsed.surface === 'WEB_CHAT' && parsed.language === 'en' && parsed.stage === 'CANDIDATE' && parsed.occurrences === 1);
  ok('its id is the digest of the candidate, never taken from the surface', parsed && /^[0-9a-f]{32}$/.test(parsed.candidateId));
  ok('the summary never reaches the line', typeof line === 'string' && !line.includes('corrected') && !line.includes('summary'));
  // AUDIT 2026-10-04 (red team) — an automated surface could hand over a kind, a
  // surface, a sentence and an id of its own. It can now hand over a code and a
  // language, and nothing else.
  for (const [what, input] of [
    ['a code nobody defined', { ...observation, observation: 'CALLER_SAID_SOMETHING' }],
    ['a code from the prototype chain', { ...observation, observation: 'constructor' }],
    ['a code that is not a string', { ...observation, observation: ['FILTER_CORRECTED_REPLY'] }],
    ['no code', { language: 'en' }],
    ['a language outside the two served', { ...observation, language: 'fr' }],
    ['no language', { observation: 'FILTER_CORRECTED_REPLY' }],
    ['a summary of its own', { ...observation, summary: 'The reply had to be corrected before it was sent.' }],
    ['a summary that quotes a caller', { ...observation, summary: 'Caller gave SSN 123-45-6789.' }],
    ['a phrase of its own', { ...observation, agentPhrase: 'Hola.' }],
    ['a kind of its own', { ...observation, kind: 'ROUTING_ERROR' }],
    ['a surface of its own', { ...observation, surface: 'VOICE_SOFIA' }],
    ['an id of its own', { ...observation, candidateId: 'c_10_88_0_1_1759560000000' }],
    ['a count of its own', { ...observation, occurrences: 99 }],
    ['the old free-text shape', { kind: 'FAILED_PHRASE', surface: 'WEB_CHAT', language: 'en', summary: 'The reply had to be corrected before it was sent.' }],
    ['a code held on the prototype', Object.create(observation)],
    ['nothing', undefined],
    ['null', null],
    ['a string', 'the bot got it wrong'],
    ['an array', [observation]],
  ]) {
    ok(`an observation with ${what} produces no line`, observationLogLine(input) === null);
  }
  let threw = false;
  let result;
  let getterRan = false;
  try { result = observationLogLine({ observation: 'FILTER_CORRECTED_REPLY', get language() { getterRan = true; throw new Error('boom'); } }); } catch { threw = true; }
  ok('an observation that would blow up while being read produces no line, no exception — and is never read', threw === false && result === null && getterRan === false);
  ok('with no reviewer configured an observation is still noted: observing is not deciding', withoutReviewers(() => observationLogLine(observation)) !== null);
}

// The one emission point: api/chat.js, when the deterministic filter had to
// correct a reply. Driven through the real handler with a model double.
{
  const saved = {};
  const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  setEnv({
    OPENAI_API_KEY: 'sk-test-dummy-learning-000', ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined, VERCEL_ENV: undefined,
    CP_KILL_ALL: undefined, CP_KILL_AI: undefined, KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined,
  });
  const { default: chatHandler } = await import('../api/chat.js');
  const { __setLLMTestFetch } = await import('../api/_lib/llm-provider.js');
  const modelSays = (text) => new Response(JSON.stringify({
    id: 'resp_learning', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  let turn = 0;
  const chat = async (userMessage, modelReply, context) => {
    turn += 1;
    const logs = [];
    const original = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = (...a) => { logs.push(a.join(' ')); };
    let modelCalls = 0;
    __setLLMTestFetch(async () => { modelCalls += 1; return modelSays(modelReply); });
    const res = {
      statusCode: null, jsonBody: null,
      setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.jsonBody = o; return this; }, end() { return this; },
    };
    try {
      await chatHandler({
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': `10.88.0.${turn}` },
        body: { userMessage, context, history: [] },
        on() {},
      }, res);
    } finally {
      [console.log, console.warn, console.error] = original;
    }
    return { res, logs, modelCalls, candidates: logs.filter((l) => l.includes('[CANDIDATE-LEARNING]')) };
  };
  try {
    const NY = { zipCode: '11375', state: 'NY' };
    const es = await chat('Quiero saber sobre la parte B de Medicare ZZUSERMARK', 'Le recomiendo Humana ZZMODELMARK, es el mejor plan para usted.', { ...NY, language: 'es' });
    ok('the reply the model wrote was corrected by the filter (the signal this hangs off)',
      es.res.statusCode === 200 && es.modelCalls === 1 && es.logs.some((l) => l.includes('compliance violations corrected')) &&
      !/humana/i.test(es.res.jsonBody.response), JSON.stringify(es.res.jsonBody));
    ok('a corrected reply emits exactly ONE candidate line', es.candidates.length === 1, es.candidates.join(' | '));
    const esLine = es.candidates[0] || '';
    const esParsed = esLine.startsWith('[CANDIDATE-LEARNING] ') ? JSON.parse(esLine.slice(21)) : {};
    ok('the line is the fixed observation: a failed phrase, seen on the shared web endpoint, as a new candidate',
      esParsed.kind === AUTOMATED_OBSERVATIONS.FILTER_CORRECTED_REPLY.kind && esParsed.surface === AUTOMATED_OBSERVATIONS.FILTER_CORRECTED_REPLY.surface &&
      esParsed.kind === 'FAILED_PHRASE' && esParsed.surface === 'WEB_CHAT' && esParsed.stage === 'CANDIDATE' && esParsed.occurrences === 1 &&
      JSON.stringify(Object.keys(esParsed)) === JSON.stringify(['candidateId', 'kind', 'surface', 'language', 'stage', 'occurrences']), esLine);
    ok('its id is a digest — thirty-two hex characters — and nothing the endpoint composed', /^[0-9a-f]{32}$/.test(String(esParsed.candidateId)), esLine);
    ok('in the language the correction was made in (Spanish turn)', esParsed.language === 'es');
    ok('the line carries nothing the caller typed, nothing the model wrote, no address and no rule tag',
      esLine.length > 0 && !/ZZUSERMARK|ZZMODELMARK|humana|parte B|10\.88\.|10_88|carrier_name|ip=/i.test(esLine), esLine);
    ok('nothing about the candidate reaches the caller',
      !/CANDIDATE|candidateId|FAILED_PHRASE|WEB_CHAT/.test(JSON.stringify(es.res.jsonBody)));

    const en = await chat('What does Medicare Part B cover?', 'I recommend Humana, it is the best plan for you.', { ...NY, language: 'en' });
    ok('an English turn is recorded as English', en.candidates.length === 1 && JSON.parse(en.candidates[0].slice(21)).language === 'en', en.candidates.join(' | '));

    const clean = await chat('Quiero saber sobre la parte B de Medicare', 'La Parte B cubre servicios médicos ambulatorios.', { ...NY, language: 'es' });
    ok('a reply the filter did not have to correct emits NO candidate',
      clean.res.statusCode === 200 && clean.modelCalls === 1 && clean.candidates.length === 0 &&
      !clean.logs.some((l) => l.includes('compliance violations corrected')), clean.candidates.join(' | '));
    ok('and is delivered as the model wrote it', /Parte B cubre servicios/.test(clean.res.jsonBody.response));

    // The session language is whatever the browser sent. It must not be able to
    // write itself into the line: the language is one of two values or the
    // default the filter itself used.
    const forgedLang = await chat('Medicare Part B?', 'I recommend Humana, it is the best plan for you.', { ...NY, language: 'fr", "kind":"ROUTING_ERROR' });
    const forgedParsed = forgedLang.candidates.length === 1 ? JSON.parse(forgedLang.candidates[0].slice(21)) : {};
    ok('a session language the browser made up cannot write itself into the line',
      forgedLang.candidates.length === 1 && forgedParsed.language === 'es' && forgedParsed.kind === 'FAILED_PHRASE' &&
      !forgedLang.candidates[0].includes('ROUTING_ERROR') && !forgedLang.candidates[0].includes('fr'), forgedLang.candidates.join(' | '));

    // The observation is built from NEITHER text. The handler scrubs numbers out
    // of the message before anything else, so the message here also introduces
    // the caller by name — which no scrubber removes and the candidate rules
    // refuse — and the reply that is delivered carries a phone number. A
    // candidate made from either text would be refused and there would be no line.
    const { scrubPHI } = await import('../api/_lib/phi-scrub.js');
    const personalMessage = 'Me llamo Rosa, mi teléfono es 631-555-0123 y quiero saber sobre la parte B de Medicare';
    const withNumbers = await chat(personalMessage,
      'La Parte B cubre servicios ambulatorios. Usted definitivamente califica para Extra Help. Puede llamar a Medicare al 1-800-633-4227.', { ...NY, language: 'es' });
    const numbersParsed = withNumbers.candidates.length === 1 ? JSON.parse(withNumbers.candidates[0].slice(21)) : {};
    const fixed = { kind: 'FAILED_PHRASE', surface: 'WEB_CHAT', language: 'es', summary: 'The reply had to be corrected before it was sent.' };
    ok('that turn was corrected in part, and the delivered reply still carries a phone number',
      withNumbers.res.statusCode === 200 && withNumbers.modelCalls === 1 && withNumbers.logs.some((l) => l.includes('compliance violations corrected')) &&
      /1-800-633-4227/.test(withNumbers.res.jsonBody.response) && !/definitivamente califica/.test(withNumbers.res.jsonBody.response), JSON.stringify(withNumbers.res.jsonBody));
    ok('a candidate made from that message — even after the handler\'s own scrub — or from that reply would have been refused',
      createCandidateLearning(fixed).ok === true &&
      createCandidateLearning({ ...fixed, summary: scrubPHI(personalMessage, { stripContact: true }).text }).ok === false &&
      createCandidateLearning({ ...fixed, agentPhrase: withNumbers.res.jsonBody.response.slice(0, PHRASE_MAX_CHARS) }).ok === false);
    ok('and the turn still emits its one line: the candidate is made from neither the message nor the reply',
      withNumbers.candidates.length === 1 && numbersParsed.kind === 'FAILED_PHRASE' && numbersParsed.surface === 'WEB_CHAT' &&
      numbersParsed.language === 'es' && numbersParsed.stage === 'CANDIDATE' && numbersParsed.occurrences === 1, withNumbers.candidates.join(' | '));

    // The corrected text is what the filter alone produces: the emission adds nothing to it.
    const { complianceFilter } = await import('../api/_lib/compliance-filter.js');
    const alone = complianceFilter('I recommend Humana, it is the best plan for you.', 'en', { userText: 'What does Medicare Part B cover?', latestUserText: 'What does Medicare Part B cover?', contactOptedOut: false });
    ok('the caller receives exactly the text the filter produced', alone.violations.length > 0 && en.res.jsonBody.response === alone.text, en.res.jsonBody.response);
  } finally {
    __setLLMTestFetch(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

if (failures.length) {
  console.error(`CY2027 LEARNING + SELF-MODIFICATION GATE: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

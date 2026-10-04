// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — CONTROLLED LEARNING and the NO-SELF-MODIFICATION GATE
// (spec §23, §33 "Production prompt or rules self-modify from live
// conversations", precedence rule 10).
//
// Both halves are exercised by calling them: the pipeline with real records,
// the gate with source text that contains each defect it exists to catch.
//
// Run: node scripts/test-cy2027-learning-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';

import * as learning from '../api/_lib/cy2027/learning.js';
import {
  CANDIDATE_KINDS, LEARNING_SURFACES, LEARNING_PIPELINE, LEARNING_REJECTED, SUMMARY_MAX_CHARS, PHRASE_MAX_CHARS,
  createCandidateLearning, candidateHistoryProblem, advanceCandidate, rejectCandidate, isDeployedLearning, candidateLogLine,
} from '../api/_lib/cy2027/learning.js';
import * as barrel from '../api/_lib/cy2027/index.js';
import {
  stripComments, findRuntimeWriteCapability, findGoverningMutation, unfrozenPaths, runGate, GOVERNING_IDENTIFIERS,
} from './check-no-self-modification.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

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
  agentPhrase: 'Hola, le habla Sofía.', occurrences: 4, createdAt: '2026-10-04T12:00:00Z', candidateId: 'cand_0001',
};
const made = createCandidateLearning(base);
ok('an observation about the system becomes a candidate', made.ok === true && made.candidate.stage === 'CANDIDATE');
ok('it starts with no history', Array.isArray(made.candidate.history) && made.candidate.history.length === 0);
ok('the record is frozen, history included', Object.isFrozen(made.candidate) && Object.isFrozen(made.candidate.history));
ok('every kind is accepted', CANDIDATE_KINDS.every((kind) => createCandidateLearning({ ...base, kind }).ok));
ok('every surface is accepted', LEARNING_SURFACES.every((surface) => createCandidateLearning({ ...base, surface }).ok));
ok('a phrase is optional', createCandidateLearning({ ...base, agentPhrase: null }).ok === true);
ok('an id is generated when none is supplied', (() => {
  const { candidateId: _unused, ...rest } = base;
  const r = createCandidateLearning(rest);
  return r.ok && /^[A-Za-z0-9_-]{8,64}$/.test(r.candidate.candidateId);
})());

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
  ['candidateId', 'short', 'CANDIDATE_ID_INVALID'],
  ['candidateId', 'has spaces in it', 'CANDIDATE_ID_INVALID'],
  ['summary', '', 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', '    ', 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', undefined, 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', ['a summary'], 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', 'x'.repeat(SUMMARY_MAX_CHARS + 1), 'CANDIDATE_TEXT_TOO_LONG'],
  ['agentPhrase', 'y'.repeat(PHRASE_MAX_CHARS + 1), 'CANDIDATE_TEXT_TOO_LONG'],
  ['agentPhrase', '', 'CANDIDATE_TEXT_REQUIRED'],
  ['summary', 'a line\u0007with a bell', 'CANDIDATE_TEXT_NOT_PLAIN'],
]) {
  ok(`a candidate with ${field} = ${typeof value === 'string' && value.length > 40 ? value.slice(0, 12) + '…(' + value.length + ')' : JSON.stringify(value)} is refused as ${reason}`,
    createCandidateLearning({ ...base, [field]: value }).reason === reason);
}
ok('an over-long text is refused, never silently truncated',
  createCandidateLearning({ ...base, summary: 'x'.repeat(SUMMARY_MAX_CHARS) }).ok === true &&
  createCandidateLearning({ ...base, summary: 'x'.repeat(SUMMARY_MAX_CHARS + 1) }).ok === false);
ok('garbage input is refused without throwing', [null, undefined, 'x', 7, []].every((v) => createCandidateLearning(v).ok === false));

// A candidate describes the system, never the caller.
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
]) {
  const inSummary = createCandidateLearning({ ...base, summary: text });
  const inPhrase = createCandidateLearning({ ...base, agentPhrase: text });
  ok(`a summary carrying ${what} is refused`, inSummary.ok === false && inSummary.reason === 'CANDIDATE_CONTAINS_SENSITIVE_DATA' &&
    inSummary.field === 'summary' && inSummary.categories.includes(category), JSON.stringify(inSummary));
  ok(`so is a phrase carrying ${what}`, inPhrase.ok === false && inPhrase.field === 'agentPhrase');
}
ok('the refusal names the category, never the value', (() => {
  const r = createCandidateLearning({ ...base, summary: 'Caller gave SSN 123-45-6789.' });
  return !JSON.stringify(r).includes('123-45-6789');
})());
for (const text of [
  'Callers ask whether the call is recorded after the notice was already given.',
  'The menu option for Spanish is missed when the caller speaks during the greeting.',
  'Las personas preguntan por el horario y la respuesta tarda demasiado.',
  'Transfers to a licensed agent are requested 3 times a day for billing questions.',
]) {
  ok('a plain description of the system is accepted: "' + text.slice(0, 40) + '…"', createCandidateLearning({ ...base, summary: text }).ok === true);
}

// ── 2. The pipeline: one stage at a time, each decided by a person ───────────
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
ok('only then is it a deployed learning', isDeployedLearning(walked) === true && candidateHistoryProblem(walked) === null);
ok('one stage short is not deployed', isDeployedLearning(advanceCandidate(made.candidate, person(0))) === false);
throws('nothing follows DEPLOYMENT', () => advanceCandidate(walked, person(8)), /last stage/);

for (const who of ['claude', 'AI-Agent', 'svc_bot', 'system', 'workflow', 'gpt-5', 'Emely the assistant', '0042', '', '   ', null, undefined, ['Maria Lopez'], { toString() { return 'Maria Lopez'; } }]) {
  throws('a candidate cannot be advanced by ' + (typeof who === 'string' ? JSON.stringify(who) : Object.prototype.toString.call(who)),
    () => advanceCandidate(made.candidate, { ...person(0), actor: who }), /named human/);
}
for (const when of ['yesterday', '2026-02-31T00:00:00Z', '2026-10-05', '', null, undefined]) {
  throws('a step needs a real UTC instant, not ' + JSON.stringify(when), () => advanceCandidate(made.candidate, { ...person(0), at: when }), /UTC instant/);
}
for (const ev of ['', '   ', null, undefined, 7]) {
  throws('a step needs a reference to what was reviewed, not ' + JSON.stringify(ev),
    () => advanceCandidate(made.candidate, { ...person(0), evidenceReference: ev }), /what was reviewed/);
}
throws('a step cannot be dated before the candidate existed',
  () => advanceCandidate(made.candidate, { ...person(0), at: '2026-10-01T00:00:00Z' }), /before the one it follows/);
throws('nor before the step it follows',
  () => advanceCandidate(advanceCandidate(made.candidate, person(3)), person(1)), /before the one it follows/);
throws('an empty call decides nothing', () => advanceCandidate(made.candidate), /named human/);

// A record that CLAIMS a stage must be able to show how it got there.
const forged = (over) => ({ ...made.candidate, ...over });
ok('a record that says DEPLOYMENT with no history is not a deployed learning',
  candidateHistoryProblem(forged({ stage: 'DEPLOYMENT' })) === 'HISTORY_DOES_NOT_REACH_STAGE' && isDeployedLearning(forged({ stage: 'DEPLOYMENT' })) === false);
throws('and it cannot be advanced or acted on', () => advanceCandidate(forged({ stage: 'APPROVAL' }), person(7)), /not trustworthy/);
{
  const h = walked.history;
  const swap = (i, over) => h.map((s, j) => (j === i ? { ...s, ...over } : s));
  ok('a history with a step decided by automation is refused', candidateHistoryProblem({ ...walked, history: swap(3, { actor: 'svc_bot' }) }) === 'HISTORY_STEP_NOT_BY_A_PERSON');
  ok('a history with a skipped stage is refused', candidateHistoryProblem({ ...walked, history: swap(2, { to: 'RED_TEAM' }) }) === 'HISTORY_OUT_OF_ORDER');
  ok('a history with a step missing is refused', candidateHistoryProblem({ ...walked, history: h.slice(1) }) === 'HISTORY_DOES_NOT_REACH_STAGE');
  ok('a history that runs backwards in time is refused', candidateHistoryProblem({ ...walked, history: swap(4, { at: '2026-10-05T00:00:00Z' }) }) === 'HISTORY_NOT_CHRONOLOGICAL');
  ok('a history with an unreadable instant is refused', candidateHistoryProblem({ ...walked, history: swap(1, { at: 'later' }) }) === 'HISTORY_INSTANT_INVALID');
  ok('a history with a step lacking evidence is refused', candidateHistoryProblem({ ...walked, history: swap(5, { evidenceReference: ' ' }) }) === 'HISTORY_EVIDENCE_MISSING');
  ok('a history with a malformed entry is refused', candidateHistoryProblem({ ...walked, history: swap(0, null).map((s, j) => (j === 0 ? null : s)) }) === 'HISTORY_ENTRY_MALFORMED');
  ok('an unknown stage, a missing history and nothing at all are refused',
    candidateHistoryProblem({ ...walked, stage: 'LIVE' }) === 'STAGE_UNKNOWN' &&
    candidateHistoryProblem({ ...walked, history: 'seven steps' }) === 'HISTORY_MISSING' &&
    candidateHistoryProblem(null) === 'CANDIDATE_MISSING');
}

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
ok('a rejected record with its reason removed is not trusted',
  candidateHistoryProblem({ ...rejected, history: rejected.history.map((s, i, a) => (i === a.length - 1 ? { ...s, reasonCode: '' } : s)) }) === 'HISTORY_REASON_MISSING');
ok('a rejected record with no history at all is not trusted', candidateHistoryProblem({ ...made.candidate, stage: LEARNING_REJECTED }) === 'HISTORY_DOES_NOT_REACH_STAGE');

// The log line.
{
  const line = candidateLogLine(walked);
  ok('the log line is tagged and structured', line.startsWith('[CANDIDATE-LEARNING] ') && JSON.parse(line.slice(21)).candidateId === 'cand_0001');
  ok('it carries the coarse fields', /"kind":"FAILED_PHRASE"/.test(line) && /"surface":"VOICE_SOFIA"/.test(line) && /"stage":"DEPLOYMENT"/.test(line) && /"occurrences":4/.test(line));
  ok('and never the free text', !line.includes('greeting') && !line.includes('Sofía') && !/summary|agentPhrase|history/.test(line));
  throws('there is no log line for nothing', () => candidateLogLine(null), /nothing to log/);
}

// ── 3. The module is a record, not a mechanism ───────────────────────────────
ok('it exports exactly these names — adding a function that APPLIES a learning must be a visible, reviewed change',
  JSON.stringify(Object.keys(learning).sort()) === JSON.stringify([
    'CANDIDATE_KINDS', 'LEARNING_PIPELINE', 'LEARNING_REJECTED', 'LEARNING_SURFACES', 'PHRASE_MAX_CHARS', 'SUMMARY_MAX_CHARS',
    'advanceCandidate', 'candidateHistoryProblem', 'candidateLogLine', 'createCandidateLearning', 'isDeployedLearning', 'rejectCandidate',
  ]), Object.keys(learning).sort().join(','));
{
  const SRC = stripComments(read('../api/_lib/cy2027/learning.js'));
  const imports = [...SRC.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
  ok('it imports the id generator, the human check and the two scrubbers — nothing that can write',
    JSON.stringify(imports) === JSON.stringify(['../phi-scrub.js', './actors.js', './prohibited-signals.js', 'node:crypto']), imports.join(','));
  ok('it is server only: the client-facing barrel does not re-export it',
    !('createCandidateLearning' in barrel) && !/learning/.test(stripComments(read('../api/_lib/cy2027/index.js'))) &&
    !/learning/.test(stripComments(read('../src/lib/cy2027.ts'))));
}

// ── 4. The gate: no runtime write capability under api/ ──────────────────────
const file = (source, path = 'api/example.js') => [{ path, source }];
for (const [what, source] of [
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
  ['getBuiltinModule', "const fs = process.getBuiltinModule('fs');"],
  ['eval', 'const x = eval(body.code);'],
  ['new Function', "const f = new Function('return 1');"],
  ['process.binding', "const b = process.binding('fs');"],
  ['an import whose target is computed', 'const m = await import(name);'],
  ['a require whose target is computed', 'const m = require(moduleName);'],
]) {
  ok(`the gate refuses ${what} under api/`, findRuntimeWriteCapability(file(source)).length >= 1, source);
}
for (const [what, source] of [
  ['an ordinary module', "import crypto from 'node:crypto';\nexport const h = (s) => crypto.createHash('sha256').update(s).digest('hex');"],
  ['a relative import', "import { ok } from './_lib/ok.js';"],
  ['a comment that mentions fs', "// we used to import fs from 'node:fs' here\n/* require('fs') */\nexport const x = 1;"],
  ['a URL that contains the letters', "const u = 'https://example.com/fs/child_process';"],
  ['a dynamic import of a literal relative path', "const m = await import('./_lib/thing.js');"],
  ['a method that happens to be called evaluate', 'const r = evaluate(x); const y = retrieval(z);'],
]) {
  ok(`and does not flag ${what}`, findRuntimeWriteCapability(file(source)).length === 0, findRuntimeWriteCapability(file(source)).join(' | '));
}

// ── 5. The gate: governing artefacts are never written to ────────────────────
for (const [what, source] of [
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
]) {
  ok(`the gate refuses ${what} on a governing artefact`, findGoverningMutation(file(source)).length >= 1, source);
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
  ['a different identifier that contains the name', 'MY_SYSTEM_PROMPT_COPY = 1; SOA_TEXT_DIGEST = 2;'],
]) {
  ok(`and does not flag ${what}`, findGoverningMutation(file(source)).length === 0, findGoverningMutation(file(source)).join(' | '));
}
ok('the governing list names the prompt, the knowledge, the rulesets and the SOA text',
  ['SYSTEM_PROMPT', 'MEDICARE_KNOWLEDGE', 'CMS_RULESET_2027', 'STATE_RULESETS', 'SOA_TEXT', 'TPMO_DISCLAIMER_CONFIG'].every((n) => GOVERNING_IDENTIFIERS.includes(n)) &&
  Object.isFrozen(GOVERNING_IDENTIFIERS));

// ── 6. The gate: frozen all the way down ─────────────────────────────────────
ok('a shallow freeze is caught', unfrozenPaths(Object.freeze({ years: [4, 6] }), 'R').join() === 'R.years');
ok('a deep freeze passes', unfrozenPaths(Object.freeze({ years: Object.freeze([4, 6]), n: Object.freeze({ a: 1 }) }), 'R').length === 0);
ok('an unfrozen root is reported', unfrozenPaths({ a: 1 }, 'R').join() === 'R');
ok('primitives and null are fine', unfrozenPaths('text', 'R').length === 0 && unfrozenPaths(null, 'R').length === 0);
ok('a cycle does not hang it', (() => { const a = { }; a.self = a; return unfrozenPaths(a, 'R').length === 1; })());

// ── 7. The gate against THIS repository ──────────────────────────────────────
{
  const r = await runGate();
  ok('the repository passes the gate', r.problems.length === 0, r.problems.join(' | '));
  ok('it looked at a real tree', r.apiFiles >= 10 && r.srcFiles >= 20);
  ok('every governing object it knows about is frozen all the way down', r.frozenCount === r.objectCount && r.objectCount >= 13);
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
  const PKG = JSON.parse(read('../package.json'));
  ok('the gate runs inside the build', /(^|&&)\s*node scripts\/check-no-self-modification\.mjs\s*&&/.test(PKG.scripts.build));
  ok('and its file is shipped to the Vercel build', /^!scripts\/check-no-self-modification\.mjs\r?$/m.test(read('../.vercelignore')));
}

if (failures.length) {
  console.error(`CY2027 LEARNING + SELF-MODIFICATION GATE: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

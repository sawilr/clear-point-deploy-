// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — KNOWLEDGE RELEASE LEDGER (spec §20 "GENERAL MEDICARE EDUCATION —
// approved and versioned"; §22 "Do not overwrite prior-year logic", "Every live
// SOA/call points to the exact ruleset version used"; audit CBF-10).
//
// The approved Medicare knowledge body every assistant answers from was ONE
// unversioned template string: no version identifier, no approval date, no
// plan-year tag. It now carries a release ledger beside the text, /api/chat
// stamps the release on every reply's audit record (and stamps NOTHING it cannot
// prove when the served body is not the pinned release), and the parity guard
// refuses a body that changed without a new release.
//
// Exercised by CALLING the rules, by driving the real handler against a model
// double (in-process, and from a tampered copy of the tree in a child process),
// and by running the real build gate against copies of the tree that contain
// each defect it exists to catch — so the gate is seen FAILING, not only passing.
//
// Run: node scripts/test-cy2027-knowledge-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  MEDICARE_KNOWLEDGE, KNOWLEDGE_STATUS, KNOWLEDGE_RELEASES, MEDICARE_KNOWLEDGE_RELEASE, MEDICARE_KNOWLEDGE_VERSION,
  MEDICARE_KNOWLEDGE_PLAN_YEAR, MEDICARE_KNOWLEDGE_DIGEST, hasRecordedKnowledgeApproval, knowledgeProvenance,
  knowledgeLoadWarning, knowledgeLedgerProblems, knowledgeReleaseReadiness,
} from '../api/_lib/medicare-knowledge.js';
import { activePlanYear } from '../api/_lib/cy2027/rulesets.js';
import {
  stripComments, topLevelStatements, findGoverningMutation, unfrozenPaths, walkTree, GOVERNING_IDENTIFIERS, REPO_ROOT,
} from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sha = (s) => 'sha256:' + createHash('sha256').update(String(s), 'utf8').digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const KB_FIELDS = ['kb_version', 'kb_plan_year', 'kb_digest', 'kb_integrity', 'kb_status', 'kb_approved_on'];

// Independent copy of the first release — exactly like the verbatim SOA strings
// in the main suite. APPEND a pair for a new release; never edit this one.
const V1 = 'CP-UMKE-CY2026-v1.0';
const V1_DIGEST = 'sha256:fe91877b42234ee61e8320829f33b2a390acb72e534a1f02827fd0515c1148ae';
const LIVE = sha(MEDICARE_KNOWLEDGE);

// ── 1. The body carries a release identity ───────────────────────────────────
ok('the knowledge body carries a version identifier',
  /^CP-UMKE-CY\d{4}-v\d+\.\d+$/.test(String(MEDICARE_KNOWLEDGE_VERSION)), String(MEDICARE_KNOWLEDGE_VERSION));
ok('it carries a plan-year tag that agrees with the identifier',
  MEDICARE_KNOWLEDGE_PLAN_YEAR === Number((/CY(\d{4})/.exec(String(MEDICARE_KNOWLEDGE_VERSION)) || [])[1]));
ok('it carries an issue date', /^\d{4}-\d{2}-\d{2}$/.test(String(MEDICARE_KNOWLEDGE_RELEASE.issuedOn)));
ok('it carries an approval record with an explicit state',
  'approvedBy' in MEDICARE_KNOWLEDGE_RELEASE && 'approvedOn' in MEDICARE_KNOWLEDGE_RELEASE &&
  Object.values(KNOWLEDGE_STATUS).includes(MEDICARE_KNOWLEDGE_RELEASE.status));
ok('the three states are the only states, each named by its own value',
  same(Object.keys(KNOWLEDGE_STATUS), ['APPROVAL_NOT_RECORDED', 'PRODUCTION_ACTIVE', 'SUPERSEDED']) &&
  Object.entries(KNOWLEDGE_STATUS).every(([k, v]) => k === v));
ok('the pinned digest is the digest of the body that ships',
  MEDICARE_KNOWLEDGE_DIGEST === LIVE, 'the body changed — APPEND a release; computed ' + LIVE);
ok('the body cannot change while the version stays the same',
  MEDICARE_KNOWLEDGE_VERSION !== V1 || LIVE === V1_DIGEST, 'the body was edited and re-pinned under ' + V1 + ' — it needs a new version');
ok('the first release stays in the ledger with its original digest, year and date',
  KNOWLEDGE_RELEASES.some((r) => r.version === V1 && r.digest === V1_DIGEST && r.planYear === 2026 && r.issuedOn === '2026-09-13'));
ok('the current release is the last ledger entry', MEDICARE_KNOWLEDGE_RELEASE === KNOWLEDGE_RELEASES[KNOWLEDGE_RELEASES.length - 1]);
ok('the ledger and its states are frozen all the way down',
  unfrozenPaths(KNOWLEDGE_RELEASES, 'KNOWLEDGE_RELEASES').length === 0 && unfrozenPaths(KNOWLEDGE_STATUS, 'KNOWLEDGE_STATUS').length === 0,
  unfrozenPaths(KNOWLEDGE_RELEASES, 'KNOWLEDGE_RELEASES').join(', '));

const archivedDigests = new Map();
for (const r of KNOWLEDGE_RELEASES.slice(0, -1)) {
  try {
    const mod = await import(new URL(`../api/_lib/knowledge-archive/${r.version}.js`, import.meta.url).href);
    archivedDigests.set(r.version, sha(mod.KNOWLEDGE_BODY));
  } catch { /* absent — the ledger rule names it */ }
}
const shipped = knowledgeLedgerProblems({ bodyDigest: LIVE, archiveDigest: (v) => archivedDigests.get(v) || null });
ok('the shipped ledger has no problems', shipped.length === 0, shipped.join(', '));
ok('a caller that forgot the body digest is refused, not passed',
  knowledgeLedgerProblems().includes('KNOWLEDGE_BODY_DIGEST_NOT_COMPUTED') && knowledgeLedgerProblems({}).includes('KNOWLEDGE_BODY_DIGEST_NOT_COMPUTED'));

// ── 2. The ledger rules, in both directions, on synthetic ledgers ─────────────
const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const rel = (o = {}) => ({
  version: 'CP-UMKE-CY2026-v1.0', planYear: 2026, issuedOn: '2026-09-13', digest: A,
  status: 'APPROVAL_NOT_RECORDED', approvedBy: null, approvedOn: null, ...o,
});
const next = rel({ version: 'CP-UMKE-CY2027-v1.0', planYear: 2027, issuedOn: '2026-10-10', digest: B });
const probs = (o) => knowledgeLedgerProblems(o);
const has = (o, reason) => probs(o).includes(reason);

ok('an unchanged body passes', probs({ releases: [rel()], bodyDigest: A }).length === 0);
ok('an edited body under an unchanged release is refused',
  has({ releases: [rel()], bodyDigest: B }, 'KNOWLEDGE_BODY_CHANGED_WITHOUT_NEW_RELEASE:CP-UMKE-CY2026-v1.0'));
ok('a yearly update that leaves the old release live is refused',
  has({ releases: [rel(), next], bodyDigest: B, archiveDigest: () => A }, 'KNOWLEDGE_PRIOR_RELEASE_NOT_SUPERSEDED:CP-UMKE-CY2026-v1.0'));
ok('a yearly update that overwrites the prior-year body is refused',
  has({ releases: [rel({ status: 'SUPERSEDED' }), next], bodyDigest: B }, 'KNOWLEDGE_PRIOR_BODY_NOT_ARCHIVED:CP-UMKE-CY2026-v1.0'));
ok('an archive that is not the original text is refused',
  has({ releases: [rel({ status: 'SUPERSEDED' }), next], bodyDigest: B, archiveDigest: () => B }, 'KNOWLEDGE_PRIOR_BODY_NOT_ARCHIVED:CP-UMKE-CY2026-v1.0'));
ok('an archive lookup that is not a function counts as no archive',
  has({ releases: [rel({ status: 'SUPERSEDED' }), next], bodyDigest: B, archiveDigest: A }, 'KNOWLEDGE_PRIOR_BODY_NOT_ARCHIVED:CP-UMKE-CY2026-v1.0'));
ok('a yearly update that archives the prior body verbatim passes',
  probs({ releases: [rel({ status: 'SUPERSEDED' }), next], bodyDigest: B, archiveDigest: (v) => (v === 'CP-UMKE-CY2026-v1.0' ? A : null) }).length === 0);
ok('the same text re-issued for a new year needs no archive copy',
  probs({ releases: [rel({ status: 'SUPERSEDED' }), rel({ version: 'CP-UMKE-CY2027-v1.0', planYear: 2027 })], bodyDigest: A }).length === 0);
ok('the current release cannot be marked superseded',
  has({ releases: [rel({ status: 'SUPERSEDED' })], bodyDigest: A }, 'KNOWLEDGE_CURRENT_RELEASE_SUPERSEDED:CP-UMKE-CY2026-v1.0'));
ok('PRODUCTION_ACTIVE cannot be claimed without a named approver AND a date',
  has({ releases: [rel({ status: 'PRODUCTION_ACTIVE' })], bodyDigest: A }, 'KNOWLEDGE_ACTIVE_WITHOUT_APPROVAL:CP-UMKE-CY2026-v1.0') &&
  has({ releases: [rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'Named Approver' })], bodyDigest: A }, 'KNOWLEDGE_ACTIVE_WITHOUT_APPROVAL:CP-UMKE-CY2026-v1.0') &&
  has({ releases: [rel({ status: 'PRODUCTION_ACTIVE', approvedOn: '2026-10-05' })], bodyDigest: A }, 'KNOWLEDGE_ACTIVE_WITHOUT_APPROVAL:CP-UMKE-CY2026-v1.0'));
ok('a recorded approval is accepted',
  probs({ releases: [rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'Named Approver', approvedOn: '2026-10-05' })], bodyDigest: A }).length === 0);
ok('an approval field on a release still marked not-recorded is refused',
  has({ releases: [rel({ approvedOn: '2026-10-05' })], bodyDigest: A }, 'KNOWLEDGE_APPROVAL_INCONSISTENT:CP-UMKE-CY2026-v1.0') &&
  has({ releases: [rel({ approvedBy: 'Someone' })], bodyDigest: A }, 'KNOWLEDGE_APPROVAL_INCONSISTENT:CP-UMKE-CY2026-v1.0'));
ok('"not recorded" means both fields present and null — a missing field is not the same thing',
  (() => { const r = rel(); delete r.approvedBy; return has({ releases: [r], bodyDigest: A }, 'KNOWLEDGE_APPROVAL_INCONSISTENT:CP-UMKE-CY2026-v1.0'); })());
ok('a plan-year tag that disagrees with the identifier is refused',
  has({ releases: [rel({ planYear: 2027 })], bodyDigest: A }, 'KNOWLEDGE_PLAN_YEAR_TAG_MISMATCH:CP-UMKE-CY2026-v1.0') &&
  has({ releases: [rel({ planYear: '2026' })], bodyDigest: A }, 'KNOWLEDGE_PLAN_YEAR_TAG_MISMATCH:CP-UMKE-CY2026-v1.0'));
ok('a reused version identifier is refused',
  has({ releases: [rel({ status: 'SUPERSEDED' }), rel()], bodyDigest: A }, 'KNOWLEDGE_VERSION_DUPLICATED:CP-UMKE-CY2026-v1.0'));
ok('an unknown status is refused — the states are an allow-list',
  ['APPROVED', 'production_active', 'PRODUCTION_ACTIVE ', '', null, undefined, 1]
    .every((s) => has({ releases: [rel({ status: s })], bodyDigest: A }, 'KNOWLEDGE_STATUS_UNKNOWN:CP-UMKE-CY2026-v1.0')));
ok('a malformed version is refused — including one that could name a path or a prototype key',
  ['UMKE-2026', 'CP-UMKE-CY2026-v1', 'CP-UMKE-CY26-v1.0', '../x', 'CP-UMKE-CY2026-v1.0/../x', '__proto__', 'constructor', '', null, 7]
    .every((v) => probs({ releases: [rel({ version: v })], bodyDigest: A }).some((p) => p.startsWith('KNOWLEDGE_VERSION_MALFORMED:'))));
ok('a malformed digest is refused',
  ['fe91877b', 'SHA256:' + 'a'.repeat(64), 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(63), null, 5]
    .every((d) => has({ releases: [rel({ digest: d })], bodyDigest: A }, 'KNOWLEDGE_DIGEST_MALFORMED:CP-UMKE-CY2026-v1.0')));
ok('a missing or malformed issue date is refused',
  ['2026-9-13', '13/09/2026', '2026-09-13T00:00:00Z', null, undefined]
    .every((d) => has({ releases: [rel({ issuedOn: d })], bodyDigest: A }, 'KNOWLEDGE_ISSUED_ON_MISSING:CP-UMKE-CY2026-v1.0')));
ok('an empty or missing ledger is refused',
  probs({ releases: [], bodyDigest: A })[0] === 'KNOWLEDGE_LEDGER_EMPTY' && probs({ releases: null, bodyDigest: A })[0] === 'KNOWLEDGE_LEDGER_EMPTY' &&
  probs({ releases: 'x', bodyDigest: A })[0] === 'KNOWLEDGE_LEDGER_EMPTY');
ok('an entry that is not a record is refused',
  probs({ releases: [null], bodyDigest: A }).some((p) => p.startsWith('KNOWLEDGE_VERSION_MALFORMED:')) &&
  probs({ releases: [['CP-UMKE-CY2026-v1.0']], bodyDigest: A }).some((p) => p.startsWith('KNOWLEDGE_VERSION_MALFORMED:')));
ok('a body digest that was not computed is a named refusal, never a pass',
  has({ releases: [rel()], bodyDigest: undefined }, 'KNOWLEDGE_BODY_DIGEST_NOT_COMPUTED') &&
  has({ releases: [rel()], bodyDigest: 'a'.repeat(64) }, 'KNOWLEDGE_BODY_DIGEST_NOT_COMPUTED'));

// ── 3. Approval is recorded by a person or it is not claimed ─────────────────
ok('approval needs the status AND the approver AND the date — nothing less, in no other state',
  hasRecordedKnowledgeApproval(rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'X', approvedOn: null })) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'PRODUCTION_ACTIVE', approvedBy: '  ', approvedOn: '2026-10-05' })) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'PRODUCTION_ACTIVE', approvedBy: null, approvedOn: '2026-10-05' })) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'APPROVAL_NOT_RECORDED', approvedBy: 'X', approvedOn: '2026-10-05' })) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'SUPERSEDED', approvedBy: 'X', approvedOn: '2026-10-05' })) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'X', approvedOn: '2026-10-5' })) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'X', approvedOn: '2026-10-05T00:00:00Z' })) === false &&
  hasRecordedKnowledgeApproval(null) === false && hasRecordedKnowledgeApproval([]) === false &&
  hasRecordedKnowledgeApproval(rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'X', approvedOn: '2026-10-05' })) === true);

// ── 4. What an audit record may say ──────────────────────────────────────────
const prov = knowledgeProvenance(LIVE);
ok('an intact body is traced to its release',
  prov.kb_integrity === 'OK' && prov.kb_version === MEDICARE_KNOWLEDGE_VERSION && prov.kb_plan_year === MEDICARE_KNOWLEDGE_PLAN_YEAR &&
  prov.kb_digest === LIVE && prov.kb_status === MEDICARE_KNOWLEDGE_RELEASE.status &&
  prov.kb_approved_on === (hasRecordedKnowledgeApproval() ? MEDICARE_KNOWLEDGE_RELEASE.approvedOn : null), JSON.stringify(prov));
ok('the record has exactly the six audit fields, frozen', same(Object.keys(prov), KB_FIELDS) && Object.isFrozen(prov));
const bad = knowledgeProvenance(B);
ok('a body that is not the pinned release is never given a version, year, status or approval',
  bad.kb_integrity === 'DIGEST_MISMATCH' && bad.kb_version === null && bad.kb_plan_year === null && bad.kb_status === null &&
  bad.kb_approved_on === null && bad.kb_digest === B && Object.isFrozen(bad) && same(Object.keys(bad), KB_FIELDS), JSON.stringify(bad));
ok('a missing or malformed digest claims nothing and keeps no digest',
  [undefined, null, '', 'fe91877b', 'SHA256:' + 'a'.repeat(64), LIVE.toUpperCase(), 42].every((d) => {
    const p = knowledgeProvenance(d);
    return p.kb_integrity === 'DIGEST_NOT_COMPUTED' && p.kb_version === null && p.kb_digest === null && p.kb_status === null && same(Object.keys(p), KB_FIELDS);
  }));
ok('a release that is not a record proves nothing',
  knowledgeProvenance(A, null).kb_integrity === 'DIGEST_MISMATCH' && knowledgeProvenance(A, 'x').kb_version === null &&
  knowledgeProvenance(A, [A]).kb_version === null);
ok('a matching digest on a malformed release is not given its label',
  (() => { const p = knowledgeProvenance(A, rel({ version: 'UMKE-2026' })); return p.kb_integrity === 'RELEASE_MALFORMED' && p.kb_version === null && p.kb_digest === A; })());
ok('an approval date is reported only when one was recorded',
  knowledgeProvenance(A, rel()).kb_approved_on === null &&
  knowledgeProvenance(A, rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'X', approvedOn: '2026-10-05' })).kb_approved_on === '2026-10-05' &&
  knowledgeProvenance(A, rel({ approvedOn: '2026-10-05' })).kb_approved_on === null);

// ── 5. Loud at load, silent when intact ──────────────────────────────────────
ok('an intact body prints nothing at load', knowledgeLoadWarning(prov) === null);
const warning = knowledgeLoadWarning(bad);
ok('a mismatch is loud at load and names the reason and the real digest — never the version it cannot prove',
  typeof warning === 'string' && warning.startsWith('[CHAT] KNOWLEDGE DIGEST_MISMATCH') && warning.includes(B) && !warning.includes(MEDICARE_KNOWLEDGE_VERSION), warning);
ok('a digest that was not computed is loud at load too', /^\[CHAT\] KNOWLEDGE DIGEST_NOT_COMPUTED/.test(knowledgeLoadWarning(knowledgeProvenance(null))));
ok('a missing provenance record is loud at load',
  /^\[CHAT\] KNOWLEDGE PROVENANCE_MISSING/.test(knowledgeLoadWarning(undefined)) && /PROVENANCE_MISSING/.test(knowledgeLoadWarning(null)));

// ── 6. What preflight reports: the two things only a person can settle ───────
{
  const unapproved = knowledgeReleaseReadiness(rel(), 2027);
  ok('an unapproved release tagged for another year is two warnings and no ok, and says it is not a closed gate',
    unapproved.oks.length === 0 && unapproved.warns.length === 2 && /APPROVAL_NOT_RECORDED/.test(unapproved.warns[0]) &&
    /not a closed gate/.test(unapproved.warns[0]) && /tagged plan year 2026 but plan year 2027 is in force/.test(unapproved.warns[1]) &&
    /CP-UMKE-CY2027/.test(unapproved.warns[1]), JSON.stringify(unapproved));
  const approvedRel = rel({ status: 'PRODUCTION_ACTIVE', approvedBy: 'Named Approver', approvedOn: '2026-10-05' });
  const approved = knowledgeReleaseReadiness(approvedRel, 2026);
  ok('an approved release for the year in force is one ok and no warning',
    approved.oks.length === 1 && approved.warns.length === 0 && /approved 2026-10-05 by Named Approver/.test(approved.oks[0]), JSON.stringify(approved));
  const approvedStale = knowledgeReleaseReadiness(approvedRel, 2027);
  ok('an approved release for a past year still warns about the year',
    approvedStale.oks.length === 1 && approvedStale.warns.length === 1 && /2027 is in force/.test(approvedStale.warns[0]));
  ok('an unknown plan year is a warning, not a silent pass',
    knowledgeReleaseReadiness(approvedRel, null).warns.some((x) => /plan year in force is unknown/.test(x)) &&
    knowledgeReleaseReadiness(approvedRel, '2026').warns.length === 1 && knowledgeReleaseReadiness(approvedRel, NaN).warns.length === 1);
  ok('a missing release record is a warning that names the file',
    knowledgeReleaseReadiness(null, 2027).warns.length === 1 && /medicare-knowledge\.js/.test(knowledgeReleaseReadiness(null, 2027).warns[0]) &&
    knowledgeReleaseReadiness([], 2027).warns.length === 1);
  ok('the readiness record is frozen', Object.isFrozen(unapproved) && Object.isFrozen(unapproved.warns) && Object.isFrozen(unapproved.oks));
  const year = activePlanYear();
  const today = knowledgeReleaseReadiness(MEDICARE_KNOWLEDGE_RELEASE, year);
  ok('what preflight says today agrees with the record: an approval warning exactly when none is recorded, a year warning exactly when the tag differs',
    today.warns.some((x) => /not a closed gate/.test(x)) === !hasRecordedKnowledgeApproval() &&
    today.warns.some((x) => /is in force/.test(x)) === (MEDICARE_KNOWLEDGE_PLAN_YEAR !== year), JSON.stringify({ year, today }));
}

// ── 7. The real handler, in-process, against a model double ──────────────────
{
  const saved = {};
  const setEnv = (vars) => { for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  setEnv({
    OPENAI_API_KEY: 'sk-test-dummy-knowledge-000', ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined, VERCEL_ENV: undefined,
    CP_KILL_ALL: undefined, CP_KILL_AI: undefined, KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined,
  });
  const loadLogs = [];
  const original = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a) => { loadLogs.push(a.join(' ')); };
  let chatHandler; let __setLLMTestFetch;
  try {
    ({ default: chatHandler } = await import('../api/chat.js'));
    ({ __setLLMTestFetch } = await import('../api/_lib/llm-provider.js'));
  } finally { [console.log, console.warn, console.error] = original; }
  ok('loading the handler against the intact body prints no knowledge warning',
    !loadLogs.some((l) => l.includes('[CHAT] KNOWLEDGE')), loadLogs.filter((l) => l.includes('KNOWLEDGE')).join(' | '));

  const modelSays = (text) => new Response(JSON.stringify({
    id: 'resp_kb', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  let turn = 0;
  const chat = async (userMessage, modelReply, context) => {
    turn += 1;
    const logs = [];
    let outbound = null;
    const orig = [console.log, console.warn, console.error];
    console.log = console.warn = console.error = (...a) => { logs.push(a.join(' ')); };
    __setLLMTestFetch(async (url, init) => { outbound = { url: String(url), body: JSON.parse(init.body) }; return modelSays(modelReply); });
    const res = {
      statusCode: null, jsonBody: null,
      setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.jsonBody = o; return this; }, end() { return this; },
    };
    try {
      await chatHandler({
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': `10.66.0.${turn}` },
        body: { userMessage, context, history: [] },
        on() {},
      }, res);
    } finally { [console.log, console.warn, console.error] = orig; __setLLMTestFetch(null); }
    const auditLine = logs.find((l) => l.startsWith('[AI-AUDIT] ')) || '';
    return { res, logs, outbound, auditLine, audit: auditLine ? JSON.parse(auditLine.slice('[AI-AUDIT] '.length)) : null };
  };
  try {
    const NY = { zipCode: '11375', state: 'NY' };
    const es = await chat('Quiero saber sobre la parte B de Medicare', 'La Parte B cubre servicios médicos ambulatorios.', { ...NY, language: 'es' });
    ok('the real handler answers and writes one audit record',
      es.res.statusCode === 200 && es.audit !== null && es.outbound !== null, JSON.stringify({ status: es.res.statusCode, line: es.auditLine.slice(0, 200) }));
    ok('the record names the knowledge release that produced the reply',
      es.audit && es.audit.kb_version === MEDICARE_KNOWLEDGE_VERSION && es.audit.kb_plan_year === MEDICARE_KNOWLEDGE_PLAN_YEAR && es.audit.kb_integrity === 'OK', es.auditLine);
    ok('the record carries the digest of the body that was served — and it is the body this module exports',
      es.audit && es.audit.kb_digest === LIVE && es.audit.kb_digest === MEDICARE_KNOWLEDGE_DIGEST, es.auditLine);
    ok('the record carries the approval state, never an approval that was not recorded',
      es.audit && es.audit.kb_status === MEDICARE_KNOWLEDGE_RELEASE.status &&
      es.audit.kb_approved_on === (hasRecordedKnowledgeApproval() ? MEDICARE_KNOWLEDGE_RELEASE.approvedOn : null) && ('kb_approved_on' in es.audit), es.auditLine);
    ok('all six knowledge fields are present on the record', es.audit && KB_FIELDS.every((k) => k in es.audit), es.auditLine);
    ok('the record still carries the fingerprint, figures year and prompt length that tie it to a reply',
      es.audit && typeof es.audit.reply_fingerprint === 'string' && typeof es.audit.figures_year === 'number' && typeof es.audit.prompt_len === 'number');
    const client = JSON.stringify(es.res.jsonBody);
    ok('nothing about the release reaches the caller',
      Object.keys(es.res.jsonBody.meta).every((k) => !/^kb_/.test(k)) && !client.includes(MEDICARE_KNOWLEDGE_VERSION) &&
      !client.includes(LIVE.slice(7, 27)) && !/kb_|KB_PROVENANCE|CP-UMKE/.test(client), client);
    const sent = JSON.stringify(es.outbound.body);
    const heading = MEDICARE_KNOWLEDGE.trim().split('\n')[0];
    ok('the prompt is built FROM the module — the body the release describes is what the model received',
      typeof es.outbound.body.instructions === 'string' && es.outbound.body.instructions.includes(heading), heading);
    ok('and the prompt carries no version id or digest — the model is never handed something to quote',
      !sent.includes(MEDICARE_KNOWLEDGE_VERSION) && !sent.includes(LIVE.slice(7, 27)) && !/CP-UMKE|kb_version/.test(sent));
    ok('no knowledge warning is printed on the reply path for an intact body', !es.logs.some((l) => l.includes('[CHAT] KNOWLEDGE')));
    const en = await chat('What does Medicare Part B cover?', 'Part B covers outpatient medical services.', { ...NY, language: 'en' });
    ok('every reply is stamped, whichever language',
      en.audit && en.audit.kb_version === MEDICARE_KNOWLEDGE_VERSION && en.audit.kb_integrity === 'OK' && en.audit.kb_digest === LIVE, en.auditLine);
  } finally {
    __setLLMTestFetch(null);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── 8. The REAL gate and the REAL handler, run on copies of the tree ─────────
// The repository is clean, so without this the gate would only ever be seen
// passing — and a gate nobody has seen fail is not a gate. Every scenario edits
// a temporary copy; the repository is never written to.
{
  const tmp = mkdtempSync(join(tmpdir(), 'cy2027-knowledge-'));
  try {
    const vercelignore = readFileSync(join(REPO_ROOT, '.vercelignore'), 'utf8');
    const shipped = vercelignore.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^!scripts\/[\w.-]+$/.test(l)).map((l) => l.slice(1));
    ok('the parity guard and the module it imports ship to the Vercel build',
      shipped.includes('scripts/check-cy2027-parity.mjs') && shipped.includes('scripts/consent-wording-gate.mjs'));
    let copies = 0;
    const makeTree = (withDocs) => {
      const root = join(tmp, 'tree' + (copies += 1));
      mkdirSync(join(root, 'scripts'), { recursive: true });
      for (const d of ['api', 'src']) cpSync(join(REPO_ROOT, d), join(root, d), { recursive: true });
      for (const f of ['index.html', 'package.json', '.vercelignore', ...shipped]) if (existsSync(join(REPO_ROOT, f))) cpSync(join(REPO_ROOT, f), join(root, f));
      if (withDocs) cpSync(join(REPO_ROOT, 'docs', 'compliance'), join(root, 'docs', 'compliance'), { recursive: true });
      return root;
    };
    const edit = (root, relPath, fn) => {
      const p = join(root, relPath);
      const raw = readFileSync(p, 'utf8');
      const before = raw.replace(/\r\n/g, '\n');
      const after = fn(before);
      if (after === before) throw new Error('the test edit did not change ' + relPath);
      writeFileSync(p, after);
      return () => writeFileSync(p, raw);
    };
    const scenario = (fn) => {
      const undos = [];
      try { return fn((u) => undos.push(u)); } finally { for (const u of undos.reverse()) u(); }
    };
    const runGate = (root, env = {}) => {
      const clean = { ...process.env };
      for (const k of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL']) delete clean[k];
      const r = spawnSync(process.execPath, [join(root, 'scripts', 'check-cy2027-parity.mjs')], { cwd: root, encoding: 'utf8', env: { ...clean, ...env } });
      return { status: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
    };
    const KB = 'api/_lib/medicare-knowledge.js';
    const PARITY = 'scripts/check-cy2027-parity.mjs';
    const ARCHIVE_DIR = join('api', '_lib', 'knowledge-archive');
    const BODY_EDIT = ['AEP: Oct 15 – Dec 7, changes effective Jan 1', 'AEP: Oct 15 – Dec 8, changes effective Jan 1'];
    const tamperBody = (s) => {
      if (s.split(BODY_EDIT[0]).length !== 2) throw new Error('the body anchor was not found exactly once');
      return s.replace(BODY_EDIT[0], BODY_EDIT[1]);
    };
    const TAMPERED_DIGEST = sha(tamperBody(MEDICARE_KNOWLEDGE));
    const passNote = `knowledge release ${V1} matches its pinned digest (1 release(s) in the ledger)`;
    const V2 = 'CP-UMKE-CY2027-v1.0';
    const LEDGER_TAIL = '    status: KNOWLEDGE_STATUS.APPROVAL_NOT_RECORDED,\n    approvedBy: null,\n    approvedOn: null,\n  }),\n]);\n';
    const appendRelease = (s) => {
      if (s.split(LEDGER_TAIL).length !== 2) throw new Error('the ledger tail was not found exactly once');
      return s.replace(LEDGER_TAIL,
        '    status: KNOWLEDGE_STATUS.SUPERSEDED,\n    approvedBy: null,\n    approvedOn: null,\n  }),\n' +
        '  Object.freeze({\n    version: \'' + V2 + '\',\n    planYear: 2027,\n    issuedOn: \'2026-10-10\',\n    digest: \'' + TAMPERED_DIGEST + '\',\n' +
        '    status: KNOWLEDGE_STATUS.APPROVAL_NOT_RECORDED,\n    approvedBy: null,\n    approvedOn: null,\n  }),\n]);\n');
    };
    const pinInGate = (s) => s.replace(`'${V1}': '${V1_DIGEST}',\n`, `'${V1}': '${V1_DIGEST}',\n    '${V2}': '${TAMPERED_DIGEST}',\n`);
    const archive = (root, body) => {
      mkdirSync(join(root, ARCHIVE_DIR), { recursive: true });
      writeFileSync(join(root, ARCHIVE_DIR, V1 + '.js'), 'export const KNOWLEDGE_BODY = ' + JSON.stringify(body) + ';\n');
      return () => rmSync(join(root, ARCHIVE_DIR), { recursive: true, force: true });
    };

    const full = makeTree(true);
    const control = runGate(full);
    ok('(gate) a faithful copy of the tree passes, and the gate reports the release it checked',
      control.status === 0 && control.out.includes(passNote), control.out.slice(-600));
    const artifact = makeTree(false);
    const onVercel = runGate(artifact, { VERCEL: '1' });
    ok('(gate) the deployed artifact — no docs/, VERCEL set — still runs the ledger check',
      onVercel.status === 0 && onVercel.out.includes(passNote), onVercel.out.slice(-600));

    scenario((keep) => {
      keep(edit(full, KB, tamperBody));
      const r = runGate(full);
      ok('(gate) an edited body with an unchanged ledger FAILS the build, by name, and prints the digest of the body as it is now',
        r.status !== 0 && r.out.includes('KNOWLEDGE_BODY_CHANGED_WITHOUT_NEW_RELEASE:' + V1) && r.out.includes(TAMPERED_DIGEST), r.out.slice(0, 900));
      ok('(gate) …and tells the maintainer the procedure, never to fill in the approval',
        /APPEND a release/.test(r.out) && /never fill them in/.test(r.out));
    });
    scenario((keep) => {
      keep(edit(full, KB, (s) => tamperBody(s).replace(V1_DIGEST, TAMPERED_DIGEST)));
      const r = runGate(full);
      ok('(gate) re-pinning the digest under the shipped version FAILS — the gate holds its own copy',
        r.status !== 0 && r.out.includes('KNOWLEDGE_RELEASE_DIGEST_REWRITTEN:' + V1) && !r.out.includes('KNOWLEDGE_BODY_CHANGED_WITHOUT_NEW_RELEASE'), r.out.slice(0, 900));
    });
    scenario((keep) => {
      keep(edit(full, KB, (s) => s.replace('status: KNOWLEDGE_STATUS.APPROVAL_NOT_RECORDED,', 'status: KNOWLEDGE_STATUS.PRODUCTION_ACTIVE,')));
      const r = runGate(full);
      ok('(gate) marking the release PRODUCTION_ACTIVE without a named approver FAILS',
        r.status !== 0 && r.out.includes('KNOWLEDGE_ACTIVE_WITHOUT_APPROVAL:' + V1), r.out.slice(0, 900));
    });
    scenario((keep) => {
      keep(edit(full, KB, (s) => s.slice(0, s.indexOf('export const KNOWLEDGE_STATUS'))));
      const r = runGate(full);
      ok('(gate) a module with the ledger removed FAILS — an absent ledger is not a pass',
        r.status !== 0 && /KNOWLEDGE_LEDGER_MISSING|KNOWLEDGE_RELEASE_REMOVED:/.test(r.out), r.out.slice(0, 900));
    });
    scenario((keep) => {
      keep(edit(full, 'api/chat.js', (s) => s + '\nexport const PASTED_COPY = `\n' + MEDICARE_KNOWLEDGE.trim().split('\n')[0] + '\n`;\n'));
      const r = runGate(full);
      ok('(gate) a second copy of the body pasted into the handler FAILS',
        r.status !== 0 && r.out.includes('KNOWLEDGE_BODY_DUPLICATED_IN:api/chat.js'), r.out.slice(0, 900));
    });
    // The yearly update, rehearsed the way the gate's message describes it.
    scenario((keep) => {
      keep(edit(full, KB, (s) => appendRelease(tamperBody(s))));
      keep(edit(full, PARITY, pinInGate));
      const r = runGate(full);
      ok('(gate) a yearly update that overwrites the prior body without archiving it FAILS',
        r.status !== 0 && r.out.includes('KNOWLEDGE_PRIOR_BODY_NOT_ARCHIVED:' + V1) && !r.out.includes('KNOWLEDGE_BODY_CHANGED_WITHOUT_NEW_RELEASE'), r.out.slice(0, 900));
      keep(archive(full, tamperBody(MEDICARE_KNOWLEDGE)));
      const wrong = runGate(full);
      ok('(gate) an archive that is not the original text FAILS',
        wrong.status !== 0 && wrong.out.includes('KNOWLEDGE_PRIOR_BODY_NOT_ARCHIVED:' + V1), wrong.out.slice(0, 900));
      archive(full, MEDICARE_KNOWLEDGE);
      const right = runGate(full);
      ok('(gate) the same update with the outgoing body archived verbatim PASSES and the gate reports two releases',
        right.status === 0 && right.out.includes(`knowledge release ${V2} matches its pinned digest (2 release(s) in the ledger)`), right.out.slice(-700));
    });
    scenario((keep) => {
      keep(edit(full, KB, (s) => appendRelease(tamperBody(s))));
      keep(archive(full, MEDICARE_KNOWLEDGE));
      const r = runGate(full);
      ok('(gate) a new release that was not pinned in the gate FAILS',
        r.status !== 0 && r.out.includes('KNOWLEDGE_RELEASE_NOT_PINNED:' + V2), r.out.slice(0, 900));
    });
    const restored = runGate(full);
    ok('(gate) every scenario restored the copy: it passes again', restored.status === 0 && restored.out.includes(passNote), restored.out.slice(-400));

    // The handler from a copy, in a child process: the copy lives outside the
    // repository, so its one bare import (openai) is resolved from the repository
    // by a resolve hook — nothing is linked, nothing is installed.
    writeFileSync(join(tmp, 'hooks.mjs'), [
      'let fromUrl = null; let copyUrl = null;',
      'export async function initialize(data) { fromUrl = data.fromUrl; copyUrl = data.copyUrl; }',
      'const isBare = (s) => !/^(\\.|\\/|node:|file:|data:)/.test(s);',
      'export async function resolve(specifier, context, next) {',
      '  if (fromUrl && copyUrl && isBare(specifier) && typeof context.parentURL === \'string\' && context.parentURL.startsWith(copyUrl)) {',
      '    return next(specifier, { ...context, parentURL: fromUrl });',
      '  }',
      '  return next(specifier, context);',
      '}',
    ].join('\n'));
    writeFileSync(join(tmp, 'driver.mjs'), [
      'import { register } from \'node:module\';',
      'import { pathToFileURL } from \'node:url\';',
      'const [root, hooks, fromUrl] = process.argv.slice(2);',
      'register(pathToFileURL(hooks).href, { data: { fromUrl, copyUrl: pathToFileURL(root).href } });',
      'const { default: handler } = await import(pathToFileURL(root + \'/api/chat.js\').href);',
      'const { __setLLMTestFetch } = await import(pathToFileURL(root + \'/api/_lib/llm-provider.js\').href);',
      '__setLLMTestFetch(async () => new Response(JSON.stringify({ id: \'resp_copy\', object: \'response\', status: \'completed\', model: \'gpt-5.6-luna\',',
      '  output: [{ type: \'message\', role: \'assistant\', content: [{ type: \'output_text\', text: \'La Parte B cubre servicios médicos ambulatorios.\' }] }],',
      '  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { \'content-type\': \'application/json\' } }));',
      'const res = { statusCode: null, jsonBody: null, setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, json(o) { this.jsonBody = o; return this; }, end() { return this; } };',
      'await handler({ method: \'POST\', headers: { origin: \'http://localhost:5173\', \'content-type\': \'application/json\', \'x-forwarded-for\': \'10.55.0.1\' },',
      '  body: { userMessage: \'Quiero saber sobre la parte B de Medicare\', context: { zipCode: \'11375\', state: \'NY\', language: \'es\' }, history: [] }, on() {} }, res);',
      'console.log(\'[DRIVER-RESULT] \' + JSON.stringify({ status: res.statusCode, body: res.jsonBody }));',
    ].join('\n'));
    const drive = (root) => {
      const env = { ...process.env, OPENAI_API_KEY: 'sk-test-dummy-knowledge-copy-000' };
      for (const k of ['ANTHROPIC_API_KEY', 'LLM_PROVIDER', 'VERCEL_ENV', 'CP_KILL_ALL', 'CP_KILL_AI', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) delete env[k];
      const r = spawnSync(process.execPath, [join(tmp, 'driver.mjs'), root, join(tmp, 'hooks.mjs'), pathToFileURL(join(REPO_ROOT, 'api', 'chat.js')).href],
        { cwd: tmp, encoding: 'utf8', env, timeout: 120000 });
      const stdout = String(r.stdout || ''); const stderr = String(r.stderr || '');
      const auditLine = stdout.split('\n').find((l) => l.startsWith('[AI-AUDIT] ')) || '';
      const resultLine = stdout.split('\n').find((l) => l.startsWith('[DRIVER-RESULT] ')) || '';
      return {
        status: r.status, stdout, stderr,
        audit: auditLine ? JSON.parse(auditLine.slice('[AI-AUDIT] '.length)) : null,
        result: resultLine ? JSON.parse(resultLine.slice('[DRIVER-RESULT] '.length)) : null,
      };
    };
    const intact = drive(full);
    ok('(copy, intact) the harness works: the handler from a faithful copy stamps the release and prints no warning',
      intact.status === 0 && intact.audit && intact.audit.kb_version === V1 && intact.audit.kb_integrity === 'OK' && intact.audit.kb_digest === LIVE &&
      !intact.stderr.includes('[CHAT] KNOWLEDGE'), (intact.stderr + intact.stdout).slice(0, 900));
    scenario((keep) => {
      keep(edit(full, KB, tamperBody));
      const tampered = drive(full);
      ok('(copy, tampered) the handler still answers — withholding the body is not the fail-safe',
        tampered.status === 0 && tampered.result && tampered.result.status === 200 && /Parte B/.test(String(tampered.result.body && tampered.result.body.response)),
        (tampered.stderr + tampered.stdout).slice(0, 900));
      ok('(copy, tampered) the audit record claims NO version, year, status or approval — only the real digest and the reason',
        tampered.audit && tampered.audit.kb_version === null && tampered.audit.kb_plan_year === null && tampered.audit.kb_status === null &&
        tampered.audit.kb_approved_on === null && tampered.audit.kb_integrity === 'DIGEST_MISMATCH' && tampered.audit.kb_digest === TAMPERED_DIGEST,
        JSON.stringify(tampered.audit));
      ok('(copy, tampered) the mismatch is loud at load, once, naming the digest that was served',
        tampered.stderr.split('\n').filter((l) => l.includes('[CHAT] KNOWLEDGE DIGEST_MISMATCH')).length === 1 && tampered.stderr.includes(TAMPERED_DIGEST),
        tampered.stderr.slice(0, 600));
      ok('(copy, tampered) nothing about the release reaches the caller either way',
        tampered.result && Object.keys((tampered.result.body && tampered.result.body.meta) || {}).every((k) => !/^kb_/.test(k)) &&
        intact.result && Object.keys((intact.result.body && intact.result.body.meta) || {}).every((k) => !/^kb_/.test(k)));
    });
  } catch (e) {
    // A rehearsal helper throws when the live tree no longer has the text it
    // edits (the body or the ledger already changed). That is a failure of this
    // suite, reported as one, never a crash that hides the report.
    ok('(copies) the gate and handler rehearsals ran to completion', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 9. Wiring, read as CODE (comments removed by the parser), anchored ───────
{
  const CHAT = stripComments(read('../api/chat.js'), 'api/chat.js');
  const CHAT_TOP = topLevelStatements(read('../api/chat.js'), 'api/chat.js');
  ok('(source) the provenance is computed at the top level of the handler module — not inside a branch or a function',
    CHAT_TOP.some((s) => s.startsWith('const KB_PROVENANCE = (() => {')) &&
    CHAT_TOP.includes('const KB_LOAD_WARNING = knowledgeLoadWarning(KB_PROVENANCE);') &&
    CHAT_TOP.includes('if (KB_LOAD_WARNING) console.error(KB_LOAD_WARNING);'),
    CHAT_TOP.filter((s) => /KB_/.test(s)).join(' | ').slice(0, 300));
  ok('(source) the digest is taken from MEDICARE_KNOWLEDGE itself',
    /^[ \t]*return knowledgeProvenance\('sha256:' \+ createHash\('sha256'\)\.update\(MEDICARE_KNOWLEDGE, 'utf8'\)\.digest\('hex'\)\);/m.test(CHAT));
  ok('(source) the body reaches the prompt by interpolation, exactly once', (CHAT.match(/\$\{MEDICARE_KNOWLEDGE\}/g) || []).length === 1);
  const auditRec = (CHAT.match(/console\.log\('\[AI-AUDIT\] ' \+ JSON\.stringify\(\{[\s\S]*?\}\)\);/) || [''])[0];
  ok('(source) the audit record takes each knowledge field from the provenance record, not from a literal',
    auditRec.length > 0 && KB_FIELDS.every((k) => new RegExp('^[ \\t]*' + k + ': KB_PROVENANCE\\.' + k + ',', 'm').test(auditRec)), auditRec.slice(0, 200));
  const clientReply = (CHAT.match(/response: cleanText,\s*meta: \{[^}]*\}/) || [''])[0];
  ok('(source) the version stays in the server log, not in the client response', clientReply.length > 0 && !/kb_|KB_PROVENANCE/.test(clientReply));
  ok('(source) the handler imports only node:crypto for this — a module the self-modification gate allows',
    /^import \{ createHash \} from 'node:crypto';/m.test(CHAT) && !/from 'node:fs'|from 'fs'/.test(CHAT));

  const PAR = stripComments(read('./check-cy2027-parity.mjs'), 'scripts/check-cy2027-parity.mjs');
  ok('(source) the build gate runs the ledger rules from the module — one implementation',
    /^[ \t]*\? kb\.knowledgeLedgerProblems\(\{ bodyDigest, archiveDigest: \(v\) => archived\.get\(v\) \|\| null \}\)/m.test(PAR));
  ok('(source) the build gate holds its own copy of the first release', PAR.includes(`'${V1}': '${V1_DIGEST}',`));
  ok('(source) the gate pushes ledger problems into the build\'s problem list', /^[ \t]*if \(kbProblems\.length\) \{\s*problems\.push\(/m.test(PAR));

  const PRE = topLevelStatements(read('./cy2027-preflight.mjs'), 'scripts/cy2027-preflight.mjs');
  const i = PRE.indexOf('const kbReadiness = knowledgeReleaseReadiness(MEDICARE_KNOWLEDGE_RELEASE, year);');
  ok('(source) preflight reports the release at its top level, after the plan year is known, and keeps both lists',
    i > PRE.indexOf('const year = activePlanYear();') && PRE[i + 1] === 'oks.push(...kbReadiness.oks);' && PRE[i + 2] === 'warns.push(...kbReadiness.warns);',
    PRE.filter((s) => /kbReadiness/.test(s)).join(' | '));
  ok('(source) the battery runs this suite', /^[ \t]*'test-cy2027-knowledge-2026-10-04\.mjs',$/m.test(read('./run-battery.mjs').replace(/\r\n/g, '\n')));

  // The ledger is governing data. The gate's own rule is applied here with the
  // ledger's names added, so a write to it anywhere under api/ or src/ is found.
  const EXTENDED = Object.freeze([...GOVERNING_IDENTIFIERS, 'KNOWLEDGE_RELEASES', 'KNOWLEDGE_STATUS', 'MEDICARE_KNOWLEDGE_RELEASE', 'KB_PROVENANCE']);
  const apiFiles = walkTree(REPO_ROOT, 'api').code;
  const srcFiles = walkTree(REPO_ROOT, 'src').code;
  const writes = findGoverningMutation([...apiFiles, ...srcFiles], EXTENDED);
  ok('(source) nothing under api/ or src/ writes to the ledger, its states or the provenance record', writes.length === 0 && apiFiles.length >= 10, writes.join(' | '));
  ok('(source) …and that rule bites: a write to any of them is refused',
    findGoverningMutation([{ path: 'api/x.js', source: 'KNOWLEDGE_RELEASES.push(1);' }], EXTENDED).length === 1 &&
    findGoverningMutation([{ path: 'api/x.js', source: 'KB_PROVENANCE.kb_version = "v";' }], EXTENDED).length === 1 &&
    findGoverningMutation([{ path: 'api/x.js', source: 'MEDICARE_KNOWLEDGE_RELEASE.status = "PRODUCTION_ACTIVE";' }], EXTENDED).length === 1);
  ok('(source) the body itself is already a governing identifier of the gate', GOVERNING_IDENTIFIERS.includes('MEDICARE_KNOWLEDGE'));
}

if (failures.length) {
  console.error(`CY2027 KNOWLEDGE RELEASE LEDGER: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

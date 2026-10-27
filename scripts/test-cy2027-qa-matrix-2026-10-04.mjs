// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — QA MATRIX, WEBSITE GATES AND CARRIER REGISTRY EVIDENCE (spec §17,
// §27, §30, §31, §35, §36; audit SPEC-27 / SPEC-30 / SPEC-31).
//
// What was wrong: spec §35 requires a QA report (test id, expected, actual,
// evidence, PASS/FAIL) and a Carrier Overlay Registry "with evidence source,
// plan year and status". Neither existed as a document; the registry served
// per-carrier state lists an earlier engineer wrote as if they were facts (spec
// §17 states a state for two carriers only) and carried no evidence source; and
// the SOA form kept the acknowledgements and the typed signature across a
// change of residence state (§31 "User changes NY to NJ after SOA started").
//
// What this suite proves, by CALLING the rules:
//   1. The matrix cannot rot. A parser and a checker (pure functions) read
//      docs/compliance/CY2027-QA-MATRIX.md and require: every status exactly
//      PASS / FAIL / NOT TESTABLE HERE; every PASS row citing at least one
//      `scripts/<suite>.mjs :: <label>`; every cited label present as a complete
//      string literal in the suite it names (comments stripped); every NOT
//      TESTABLE HERE row naming who can test it; all 25 §31 cases and all 12
//      website gates present, with the spec text verbatim and the id matching
//      the case. The checker is observed FAILING on defective matrices before
//      it is run on the real one. docs/ is not part of the deployed artifact,
//      so when it is absent the real run is skipped with a named note.
//   2. The §31 cases that had no behavioural test: a blanket answer in place of
//      a category list authorizes nothing (QA-01, web); the ruleset comes from
//      the stated residence state and never from a phone (QA-03); a state
//      change withdraws every affirmation and the form routes both radios
//      through that one rule (QA-04); the per-IP limiter admits exactly its cap
//      of a parallel burst and the three SOA endpoints keep their caps (QA-12);
//      the same selection yields the same codes in both languages (QA-24).
//   3. The carrier registry: each row's state-list status and spec §36 source
//      URL; the gate decision as a pure function with every refusal (a verified
//      status over an unverified state list is refused BY NAME); every row
//      still refused today through that one function; rows frozen all the way
//      down, observed through the guarded accessor; the registry still
//      unreachable from any public context.
//
// Run: node scripts/test-cy2027-qa-matrix-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import * as overlayModule from '../api/_lib/cy2027/carrier-overlay.js';
import {
  OVERLAY_STATUS, STATES_STATUS, STATES_PENDING_NOTE, overlayGateDecision, canDiscussCarrier, getOverlay, overlayInventory, assertPrivateContext,
} from '../api/_lib/cy2027/carrier-overlay.js';
import * as barrelModule from '../api/_lib/cy2027/index.js';
import { createSoaInstance, affirmationsAfterContextChange, SOA_STATUS } from '../api/_lib/cy2027/soa-instance.js';
import { resolveSigningRulesets } from '../api/_lib/cy2027/state-rules.js';
import { SOA_CATEGORIES, categoryText } from '../api/_lib/cy2027/soa-text.js';
import { stripComments, GOVERNING_IDENTIFIERS, REPO_ROOT, unfrozenPaths } from './no-self-modification-lib.mjs';

// The limiter reads its storage tier at load. This suite must never reach a
// shared store (no network), so the variables are removed before it loads and
// the tier is asserted below.
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
const { rateLimit, rateLimitStorageTier } = await import('../api/_lib/rate-limit.js');

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw something else: ' + (e && e.message)); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Builds a defective copy of a source. A missing anchor is a recorded failure
// (the thing the scan pins is no longer where the suite expects it), not a crash
// that would hide every assertion after it.
const once = (text, from, to, what) => {
  const n = text.split(from).length - 1;
  if (n !== 1) { failures.push(`${what}: anchor found ${n} time(s), expected exactly once`); return text; }
  return text.replace(from, to);
};
const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

// ── Pinned spec data (§31 cases, §37 website gates), verbatim ───────────────
const SPEC_31_CASES = Object.freeze([
  "Senior says 'yes to everything' - system still presents categories individually.",
  "Senior says 'I don't know' - no category auto-selected.",
  "User enters NJ phone but says CT residence - CT ruleset loads.",
  "User changes NY to NJ after SOA started - invalidate/restart jurisdiction-sensitive step.",
  "Home visit requested with voice-only SOA - blocked until written/electronic SOA.",
  "Plan year changes from 2027 to 2028 - old scope not silently reused.",
  "Customer asks 'Which United plan is best?' - AI refuses plan-specific recommendation and routes.",
  "Customer mentions cancer/surgery - AI does not probe.",
  "Customer says Medicaid - store self-reported, not eligible=true.",
  "Family member knows DOB/name - no private disclosure without authorization.",
  "Fake lead submits another person's name - OTP/channel check and anomaly monitoring; no CRM exposure.",
  "Bot floods SOA links - rate limit, abuse control, quarantine.",
  "Secure link forwarded to third party - no prefilled private data without verification.",
  "Expired link - fail closed.",
  "CRM unavailable after signature - preserve transaction safely; marketing gate remains locked until evidence sync confirmed.",
  "Recording fails mid-call - regulated continuation stops per fallback.",
  "Duplicate SOA submissions - preserve first/second versions; define active instance explicitly.",
  "Beneficiary revokes contact permission after SOA - outreach stops.",
  "Prompt injection requests carrier recommendation - tool unavailable and escalation.",
  "Carrier overlay pending - licensed workflow warns/blocks carrier-specific action.",
  "SMS resend requested - resend same evidence/link state without generating a fake new SOA.",
  "Incorrect county for ZIP - user confirms county rather than system guessing.",
  "Accessibility: screen reader + keyboard only + zoom + mobile.",
  "Spanish and English versions produce semantically equivalent scope selections.",
  "Transcript mishears category - read-back catches discrepancy before completion.",
]);
const WEBSITE_GATES = Object.freeze([
  Object.freeze(['W0', 'Language', 'English / Español']),
  Object.freeze(['W1', 'State', 'NY / NJ / CT / Other']),
  Object.freeze(['W2', 'ZIP + county resolver', 'Confirm residence/service area; carrier blind']),
  Object.freeze(['W3', 'Request context', 'What are you trying to accomplish?']),
  Object.freeze(['W4', 'Contact/channel permission', 'Separate from SOA']),
  Object.freeze(['W5', 'Security confidence', 'Channel check / risk score; no health scoring']),
  Object.freeze(['W6', 'SOA channel choice', 'Complete now on web / secure SMS / secure email / speak with agent first']),
  Object.freeze(['W7', 'Appointment-specific SOA', 'Plain-language categories, no prechecks']),
  Object.freeze(['W8', 'Signature/affirmation', 'Written electronic record']),
  Object.freeze(['W9', 'Receipt/evidence', 'SOA_ID + copy + audit record']),
  Object.freeze(['W10', 'Appointment', 'Schedule only after required gate; home visit requires written SOA']),
  Object.freeze(['W11', 'Licensed agent workspace', 'Private carrier universe + overlays + analysis']),
]);
// Spec §36 "SOURCES" — the public URL it gives per carrier; null where it gives none.
const SPEC_36_SOURCES = Object.freeze({
  'Aetna': 'https://www.aetna.com/content/dam/aetna/pdfs/aetnacom/insurance-producer/document-library/aetna_producer_agreement.pdf',
  'UnitedHealthcare': null,
  'Wellcare/Centene': 'https://www.wellcare.com/en/broker-resources/application-and-enrollment',
  'EmblemHealth': 'https://www.emblemhealth.com/brokers/resources/selling-medicare/broker-medicare-toolkit',
  'Clover Health': 'https://www.cloverhealth.com/brokers/plan-documents-enrollment',
  'ConnectiCare': 'https://www.connecticare.com/brokers/resources/medicare-broker-toolkit',
  'Healthfirst': 'https://healthfirst.org/brokers',
  'Fidelis': null,
  'HealthSpring/HCSC': null,
  'Anthem/Empire': null,
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. The matrix checker — pure functions, observed failing first
// ═════════════════════════════════════════════════════════════════════════════
const MATRIX_STATUSES = Object.freeze(['PASS', 'FAIL', 'NOT TESTABLE HERE']);
const CITATION = /^`?(scripts\/[\w.-]+\.mjs)`?\s*::\s*(.+?)\s*$/;

/** One Markdown table row → cells. `\|` inside a cell is a literal pipe. */
function splitCells(line) {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && body[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Every row of every table whose header has an Evidence and a Status column. */
function parseMatrixTables(md) {
  const lines = String(md).split(/\r?\n/);
  const rows = [];
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) { header = null; continue; }
    const cells = splitCells(line);
    if (cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c))) continue;
    if (header === null) {
      const lower = cells.map((c) => c.toLowerCase());
      header = lower.includes('evidence') && lower.includes('status') ? lower : false;
      continue;
    }
    if (header === false) continue;
    const row = { line: i + 1 };
    header.forEach((h, idx) => { row[h] = cells[idx] === undefined ? '' : cells[idx]; });
    rows.push(row);
  }
  return rows;
}

/** The three ways a suite can hold a label as ONE string literal. */
function literalForms(label) {
  return [
    "'" + label.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'",
    '"' + label.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
    '`' + label + '`',
  ];
}

/**
 * Everything that makes the matrix dishonest, by name. `readSource(file)`
 * answers the suite's source or null when the file does not exist.
 */
function matrixProblems(rows, readSource, spec = { cases: SPEC_31_CASES, gates: WEBSITE_GATES }) {
  const problems = [];
  const seenCases = new Set();
  const seenGates = new Set();
  const sources = new Map();
  const source = (file) => { if (!sources.has(file)) sources.set(file, readSource(file)); return sources.get(file); };
  for (const row of rows) {
    const id = row['test id'] || row.gate || `line ${row.line}`;
    if (!MATRIX_STATUSES.includes(row.status)) problems.push(`${id}: status "${row.status}" is not one of ${MATRIX_STATUSES.join(' / ')}`);
    const items = String(row.evidence || '').split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
    const cites = [];
    for (const item of items) {
      const m = CITATION.exec(item);
      if (m) cites.push({ file: m[1], label: m[2] });
      else if (/^`?scripts\//.test(item)) problems.push(`${id}: malformed citation "${item}" — expected scripts/<suite>.mjs :: <label>`);
    }
    if (row.status === 'PASS' && cites.length === 0) problems.push(`${id}: PASS without a single suite citation`);
    const actual = row.actual !== undefined ? row.actual : (row['actual flow'] !== undefined ? row['actual flow'] : '');
    if (row.status === 'NOT TESTABLE HERE' && !/who can test:/i.test(actual)) problems.push(`${id}: NOT TESTABLE HERE without "Who can test:" in the Actual cell`);
    for (const c of cites) {
      const src = source(c.file);
      if (src === null || src === undefined) { problems.push(`${id}: cites ${c.file}, which does not exist`); continue; }
      const stripped = stripComments(src);
      if (!literalForms(c.label).some((f) => stripped.includes(f))) problems.push(`${id}: ${c.file} has no string literal "${c.label}"`);
    }
    if (row['test id'] !== undefined) {
      const m = /^QA-(\d{2})[a-z]?$/.exec(row['test id']);
      const text = row['spec case (verbatim)'];
      if (!m) problems.push(`${id}: test id must be QA-NN or QA-NNa`);
      else if (spec.cases[Number(m[1]) - 1] !== text) problems.push(`${id}: spec case is not the verbatim text of §31 case ${Number(m[1])}: "${text}"`);
      else seenCases.add(Number(m[1]));
    }
    if (row.gate !== undefined) {
      const m = /^(W\d{1,2})[a-z]?$/.exec(row.gate);
      const g = m ? spec.gates.find((x) => x[0] === m[1]) : null;
      if (!g) problems.push(`${id}: gate id must be one of ${spec.gates.map((x) => x[0]).join(' ')}`);
      else if (row['gate name (verbatim)'] !== g[1] || row['requirement (verbatim)'] !== g[2]) problems.push(`${id}: gate name/requirement are not the verbatim §37 text`);
      else seenGates.add(g[0]);
    }
  }
  spec.cases.forEach((text, i) => { if (!seenCases.has(i + 1)) problems.push(`§31 case ${i + 1} is not in the matrix: "${text}"`); });
  for (const g of spec.gates) if (!seenGates.has(g[0])) problems.push(`website gate ${g[0]} (${g[1]}) is not in the matrix`);
  return problems;
}

// ── 1a. The checker observed on defective inputs ─────────────────────────────
{
  const FAKE_SUITE = [
    "ok('a real label', true);",
    "// ok('only in a line comment', true);",
    "/* throws('only in a block comment', () => {}) */",
    'ok(`template ${x} label`, true);',
    "ok('exactly five are allowed', true);",
    'ok("double \\"quoted\\" label", true);',
    "ok('it\\'s escaped', true);",
  ].join('\n');
  const fakeSources = { 'scripts/fake-suite.mjs': FAKE_SUITE };
  const readFake = (f) => (f in fakeSources ? fakeSources[f] : null);
  const H31 = '| Test ID | Spec case (verbatim) | Expected | Actual | Evidence | Status |\n|---|---|---|---|---|---|\n';
  const HW = '| Gate | Gate name (verbatim) | Requirement (verbatim) | Expected | Actual flow | Evidence | Status |\n|---|---|---|---|---|---|---|\n';
  const caseRow = (n, over = {}) => {
    const r = { id: `QA-${String(n).padStart(2, '0')}`, text: SPEC_31_CASES[n - 1], expected: 'e', actual: 'a', evidence: 'scripts/fake-suite.mjs :: a real label', status: 'PASS', ...over };
    return `| ${r.id} | ${r.text} | ${r.expected} | ${r.actual} | ${r.evidence} | ${r.status} |\n`;
  };
  const gateRow = (g, over = {}) => {
    const r = { id: g[0], name: g[1], req: g[2], expected: 'e', actual: 'a', evidence: 'scripts/fake-suite.mjs :: a real label', status: 'PASS', ...over };
    return `| ${r.id} | ${r.name} | ${r.req} | ${r.expected} | ${r.actual} | ${r.evidence} | ${r.status} |\n`;
  };
  const complete = (overrides = {}) =>
    '# fake\n\n' + H31 + SPEC_31_CASES.map((_, i) => caseRow(i + 1, overrides[i + 1] || {})).join('') + '\n\n' + HW + WEBSITE_GATES.map((g) => gateRow(g, overrides[g[0]] || {})).join('');

  const good = parseMatrixTables(complete());
  ok('checker: the parser reads both tables (25 cases + 12 gates)', good.length === 37, String(good.length));
  ok('checker: a complete, honest matrix has no problems', matrixProblems(good, readFake).length === 0, matrixProblems(good, readFake).join('; '));
  ok('checker: a `\\|` inside a cell is a pipe, not a column', same(splitCells('| a \\| b | c |'), ['a | b', 'c']));

  const probe = (overrides, re, label) => {
    const p = matrixProblems(parseMatrixTables(complete(overrides)), readFake);
    ok(label, p.some((x) => re.test(x)), p.join('; ') || 'no problem reported');
  };
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: only in a line comment' } }, /has no string literal "only in a line comment"/, 'checker bites: a label that exists only in a line comment is not evidence');
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: only in a block comment' } }, /has no string literal "only in a block comment"/, 'checker bites: nor one in a block comment');
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: exactly five' } }, /has no string literal "exactly five"/, 'checker bites: a substring of a real label is not the label');
  probe({ 1: { evidence: 'scripts/nowhere.mjs :: a real label' } }, /cites scripts\/nowhere\.mjs, which does not exist/, 'checker bites: a suite that does not exist');
  probe({ 1: { evidence: '' } }, /QA-01: PASS without a single suite citation/, 'checker bites: PASS with no citation');
  probe({ 1: { evidence: 'scripts/fake-suite.mjs — a real label' } }, /malformed citation/, 'checker bites: a citation in the wrong form');
  probe({ 1: { status: 'PARTIAL' } }, /status "PARTIAL" is not one of/, 'checker bites: a status outside PASS / FAIL / NOT TESTABLE HERE');
  probe({ 1: { status: 'pass' } }, /status "pass" is not one of/, 'checker bites: the status is exact, not case-folded');
  probe({ 1: { status: 'NOT TESTABLE HERE', evidence: '' } }, /without "Who can test:"/, 'checker bites: NOT TESTABLE HERE without naming who can test');
  probe({ 1: { text: 'Senior says yes to everything - categories individually.' } }, /spec case is not the verbatim text of §31 case 1/, 'checker bites: a paraphrased spec case');
  probe({ 3: { text: SPEC_31_CASES[0] } }, /QA-03: spec case is not the verbatim text of §31 case 3/, 'checker bites: an id attached to the wrong case');
  probe({ 2: { id: 'QA-2' } }, /test id must be QA-NN/, 'checker bites: a malformed id');
  probe({ W6: { req: 'Complete now on web' } }, /W6: gate name\/requirement are not the verbatim §37 text/, 'checker bites: a shortened gate requirement');
  probe({ W6: { id: 'W66' } }, /gate id must be one of/, 'checker bites: a gate that is not in the spec table');
  {
    const p = matrixProblems(parseMatrixTables(complete().replace(caseRow(14), '')), readFake);
    ok('checker bites: a missing §31 case is named', p.some((x) => /§31 case 14 is not in the matrix/.test(x)), p.join('; '));
    const q = matrixProblems(parseMatrixTables(complete().replace(gateRow(WEBSITE_GATES[11]), '')), readFake);
    ok('checker bites: a missing website gate is named', q.some((x) => /website gate W11 \(Licensed agent workspace\) is not in the matrix/.test(x)), q.join('; '));
  }
  {
    const okLabels = ['template ${x} label', 'double "quoted" label', "it's escaped", 'exactly five are allowed'];
    const p = matrixProblems(parseMatrixTables(complete({ 1: { evidence: okLabels.map((l) => 'scripts/fake-suite.mjs :: ' + l).join('<br>') } })), readFake);
    ok('checker: template, double-quoted and escaped-apostrophe labels are all found as literals', p.length === 0, p.join('; '));
    const multi = parseMatrixTables(complete({ 1: { evidence: 'scripts/fake-suite.mjs :: a real label<br>scripts/fake-suite.mjs :: only in a line comment', status: 'FAIL' } }));
    const q = matrixProblems(multi, readFake);
    ok('checker: every citation of a row is checked, whatever its status', q.some((x) => /has no string literal "only in a line comment"/.test(x)), q.join('; '));
  }
  ok('checker: a table without Evidence/Status columns is ignored, not misread',
    parseMatrixTables('| Gap | Options |\n|---|---|\n| g | o |\n').length === 0);
}

// ── 1b. The real matrix and the two companion documents ─────────────────────
const DOCS_PRESENT = existsSync(join(REPO_ROOT, 'docs', 'compliance'));
if (!DOCS_PRESENT) {
  console.log('NOTE: docs/compliance is absent (docs/ is excluded from the deployed artifact) — the QA matrix and companion-document checks are skipped here');
} else {
  const MATRIX = 'docs/compliance/CY2027-QA-MATRIX.md';
  const SECOPS = 'docs/compliance/CY2027-SECURITY-OPERATIONS.md';
  const ARCH = 'docs/compliance/CY2027-ARCHITECTURE.md';
  const readRepo = (f) => (existsSync(join(REPO_ROOT, f)) ? read(f) : null);
  ok('the QA matrix exists', readRepo(MATRIX) !== null);
  if (readRepo(MATRIX) !== null) {
    const rows = parseMatrixTables(readRepo(MATRIX));
    const problems = matrixProblems(rows, readRepo);
    ok('the QA matrix covers the 25 §31 cases and the 12 website gates with at least one row each', rows.length >= 37, String(rows.length));
    ok('the QA matrix is honest mechanically: every status is exact, every PASS is cited, every citation exists in the suite it names, every spec case is verbatim',
      problems.length === 0, problems.join('\n        '));
    ok('the QA matrix cites this suite for the cases it added', rows.some((r) => /scripts\/test-cy2027-qa-matrix-2026-10-04\.mjs ::/.test(r.evidence)));
    const outside = rows.filter((r) => /^— \((voice agents|GoHighLevel|model reply)/.test(r.evidence));
    ok('rows whose evidence is the voice agents, GoHighLevel or model reply behaviour are never PASS',
      outside.length >= 8 && outside.every((r) => r.status === 'NOT TESTABLE HERE'), JSON.stringify(outside.map((r) => [r['test id'] || r.gate, r.status])));
  }
  const secops = readRepo(SECOPS);
  ok('the security-operations document exists', secops !== null);
  if (secops !== null) {
    for (const h of ['## 1. Threat model', '## 2. Incident response and breach response', '## 3. What is stored where', '## 4. Rollback', '## 5. Cost items before activation', '## 6. Dependency scans, security scans and penetration tests', '## 7. Operational finding']) {
      ok(`security operations: section "${h}" is present`, secops.includes(h));
    }
    const restoreClaims = [...secops.matchAll(/Restore tested: ([A-Z]+(?: [A-Z]+)*)/g)].map((m) => m[1]);
    ok('security operations: every store reports restore as NOT DONE, none as a tested capability',
      restoreClaims.length >= 4 && restoreClaims.every((c) => c === 'NOT DONE'), JSON.stringify(restoreClaims));
    ok('security operations: the rollback matches how the project deploys (promote, never git push)', /vercel promote/.test(secops) && /git push/.test(secops) && /PREVIEW/.test(secops));
    ok('security operations: notification duties are flagged for counsel, not asserted', /counsel/i.test(secops));
  }
  const arch = readRepo(ARCH);
  ok('the architecture document exists', arch !== null);
  if (arch !== null) {
    const i21 = arch.indexOf('\n### 2.1 SOA instance');
    const i21a = arch.indexOf('\n### 2.1a The document language is an election (G08)');
    const i22 = arch.indexOf('\n### 2.2 Plan-year rulesets');
    ok('architecture: §2.1a sits directly after §2.1 and before §2.2', i21 > -1 && i21a > i21 && i22 > i21a, `${i21} ${i21a} ${i22}`);
    ok('architecture: §2.1a appears exactly once', arch.split('### 2.1a').length === 2);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. §31 cases that had no behavioural test — called, not grepped
// ═════════════════════════════════════════════════════════════════════════════
const baseInput = Object.freeze({
  soaId: 'soa_qa', appointmentId: 'appt_qa', appointmentAt: '2026-11-10T14:00:00Z', appointmentFormat: 'TELEPHONE',
  planYear: 2027, state: 'NY', zip: '10001', language: 'en', languageSource: 'BENEFICIARY_ELECTED',
  method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public', selectedCategories: Object.freeze(['MA_WITH_RX']),
  stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0', cmsRulesetVersion: 'CMS_RULESET_2027-v1.0',
});

// ── QA-01 (web): "yes to everything" ────────────────────────────────────────
{
  const blankets = ['ALL', true, 'yes to everything', { all: true }, 'MA_WITH_RX'];
  const results = blankets.map((b) => createSoaInstance({ ...baseInput, selectedCategories: b }));
  ok('QA-01 (web): a blanket value in place of the category list authorizes nothing — the instance is SOA_INCOMPLETE',
    results.every((r) => r.ok === true && r.instance.status === SOA_STATUS.INCOMPLETE && r.instance.authorizedCategories.length === 0),
    JSON.stringify(results.map((r) => (r.ok ? r.instance.status : r.errors))));
  const all = createSoaInstance({ ...baseInput, selectedCategories: ['ALL'] });
  ok('QA-01 (web): an "ALL" code is refused as unknown, never expanded to every category',
    all.ok === false && all.errors.selectedCategories === 'unknown_category', JSON.stringify(all.errors));
  const one = createSoaInstance(baseInput);
  ok('QA-01 (web): one category chosen individually authorizes exactly that category and declines the rest',
    one.ok === true && same(one.instance.authorizedCategories, ['MA_WITH_RX']) && one.instance.declinedCategories.length === 2);
}

// ── QA-03: the ruleset follows the stated residence, never the phone ────────
{
  const now = new Date('2026-10-20T12:00:00Z');
  const ct = resolveSigningRulesets('CT', now);
  const nj = resolveSigningRulesets('NJ', now);
  ok('QA-03: the signing rulesets are resolved from the stated residence state only — CT gives the CT ruleset, NJ the NJ ruleset',
    ct.ok === true && ct.stateRuleset.code === 'CT' && /^CT-/.test(ct.stateRuleset.stateRulesetVersion) &&
    nj.ok === true && nj.stateRuleset.code === 'NJ' && /^NJ-/.test(nj.stateRuleset.stateRulesetVersion),
    JSON.stringify([ct.reason, nj.reason]));
  const withPhone = resolveSigningRulesets({ state: 'CT', phone: '2015550123' }, now);
  const phoneAsState = resolveSigningRulesets('2015550123', now);
  ok('QA-03: a record carrying a phone in place of a state is refused, not read for an area code',
    withPhone.ok === false && withPhone.reason === 'NO_STATE' && phoneAsState.ok === false && phoneAsState.reason === 'INVALID_STATE',
    JSON.stringify([withPhone, phoneAsState]));
  const ny = resolveSigningRulesets('NY', now);
  ok('QA-03: two residents with the same phone but different stated states get different state rulesets',
    ny.ok === true && ct.ok === true && ny.stateRuleset.stateRulesetVersion !== ct.stateRuleset.stateRulesetVersion && ny.ruleset.version === ct.ruleset.version);
}

// ── QA-04: a jurisdiction change withdraws every affirmation ────────────────
{
  const affirmed = Object.freeze({ noObligation: true, eSignature: true, signature: 'Jane Q Public' });
  const withdrawn = affirmationsAfterContextChange('NY', 'NJ', affirmed);
  ok('QA-04: a state change withdraws the acknowledgements and the typed signature',
    withdrawn.noObligation === false && withdrawn.eSignature === false && withdrawn.signature === '', JSON.stringify(withdrawn));
  ok('QA-04: a change to "another state" withdraws them too',
    same(affirmationsAfterContextChange('NY', 'OTHER', affirmed), { noObligation: false, eSignature: false, signature: '' }));
  ok('QA-04: the same state keeps them exactly as given',
    same(affirmationsAfterContextChange('NY', 'NY', affirmed), affirmed));
  ok('QA-04: a first choice of state has nothing to keep',
    same(affirmationsAfterContextChange('', 'NY', affirmed), { noObligation: false, eSignature: false, signature: '' }));
  ok('QA-04: only a literal true is an affirmation and only a string is a signature',
    same(affirmationsAfterContextChange('NY', 'NY', { noObligation: 'yes', eSignature: 1, signature: 42 }), { noObligation: false, eSignature: false, signature: '' }));
  ok('QA-04: nothing affirmed is nothing kept, whatever the input shape',
    same(affirmationsAfterContextChange('NY', 'NY', null), { noObligation: false, eSignature: false, signature: '' }) &&
    same(affirmationsAfterContextChange('NY', 'NY', 'Jane'), { noObligation: false, eSignature: false, signature: '' }));
  ok('QA-04: the rule mutates nothing and answers a frozen object',
    same(affirmed, { noObligation: true, eSignature: true, signature: 'Jane Q Public' }) && Object.isFrozen(withdrawn) && Object.isFrozen(affirmationsAfterContextChange('NY', 'NY', affirmed)));

  // The form must route every state change through the rule. Anchored scans,
  // comments stripped, and observed biting on two defective copies.
  const FORM = read('src/components/SOAForm.tsx');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const anchored = (s, line) => new RegExp('^[ \\t]*' + esc(line), 'm').test(s);
  const formWiringProblems = (source) => {
    const s = stripComments(source);
    const p = [];
    if (!anchored(s, "onChange={() => changeResidenceState(code)}")) p.push('the supported-state radio does not call changeResidenceState(code)');
    if (!anchored(s, "onChange={() => changeResidenceState('OTHER')}")) p.push("the other-state radio does not call changeResidenceState('OTHER')");
    if (!anchored(s, 'const kept = affirmationsAfterContextChange(residenceState, code, { noObligation: ackNoObl, eSignature: ackEsig, signature });')) p.push('the handler does not ask affirmationsAfterContextChange() what survives');
    for (const line of ['setAckNoObl(kept.noObligation);', 'setAckEsig(kept.eSignature);', 'setSignature(kept.signature);']) {
      if (!anchored(s, line)) p.push(`the handler does not apply ${line}`);
    }
    const direct = (s.match(/setResidenceState\(/g) || []).length;
    if (direct !== 1) p.push(`setResidenceState( is called ${direct} time(s); only the handler may call it`);
    return p;
  };
  ok('QA-04: the form routes both state radios through the handler that applies the rule', formWiringProblems(FORM).length === 0, formWiringProblems(FORM).join('; '));
  const bypass = once(FORM, "onChange={() => changeResidenceState(code)}", "onChange={() => setResidenceState(code)}", 'radio bypass');
  ok('QA-04: the scan bites: a radio that sets the state directly is caught',
    formWiringProblems(bypass).some((x) => /does not call changeResidenceState\(code\)/.test(x)) && formWiringProblems(bypass).some((x) => /called 2 time/.test(x)));
  const noRule = once(FORM, 'const kept = affirmationsAfterContextChange(residenceState, code, { noObligation: ackNoObl, eSignature: ackEsig, signature });',
    'const kept = { noObligation: ackNoObl, eSignature: ackEsig, signature };', 'rule removal');
  ok('QA-04: the scan bites: a handler that does not apply the rule is caught', formWiringProblems(noRule).some((x) => /does not ask affirmationsAfterContextChange/.test(x)));
  const commented = once(FORM, "onChange={() => changeResidenceState('OTHER')}", "onChange={() => setResidenceState('OTHER')} /* onChange={() => changeResidenceState('OTHER')} */", 'comment decoy');
  ok('QA-04: the scan bites: the anchor inside a comment does not count', formWiringProblems(commented).some((x) => /other-state radio/.test(x)));
}

// ── QA-12: a flood of link requests ─────────────────────────────────────────
{
  ok('QA-12: the limiter under test is the in-process tier — no shared store is reached from this suite', rateLimitStorageTier().tier === 'per-instance-memory', JSON.stringify(rateLimitStorageTier()));
  const burst = await Promise.all(Array.from({ length: 8 }, () => rateLimit('qa-matrix-burst-source', { max: 5, windowMs: 60 * 60 * 1000, prefix: 'qa-tok' })));
  ok('QA-12: the per-IP limiter admits exactly the configured number of a parallel burst and refuses the rest',
    burst.filter((r) => r.ok === true).length === 5 && burst.filter((r) => r.ok === false && r.retryAfter > 0).length === 3, JSON.stringify(burst));
  const other = await rateLimit('qa-matrix-other-source', { max: 5, windowMs: 60 * 60 * 1000, prefix: 'qa-tok' });
  ok('QA-12: another source is not punished for the first one\'s flood', other.ok === true);

  // The three SOA endpoints keep their conservative caps: anchored lines in
  // the handlers, comments stripped, and observed biting on a loosened copy.
  const LIMITS = Object.freeze([
    ['api/soa-token.js', "var rl = await rateLimit(ip, { max: 5, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' });"],
    ['api/soa-status.js', "var rl = await rateLimit(ip, { max: 60, windowMs: 60 * 1000, prefix: 'soa-stat' });"],
    ['api/soa-status.js', "var rlp = await rateLimit(ip, { max: 10, windowMs: 10 * 60 * 1000, prefix: 'soa-factor' });"],
    ['api/sign-soa.js', "var rl = await rateLimit(ip, { max: 3, windowMs: 60 * 60 * 1000, prefix: 'soa-sign' });"],
  ]);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endpointLimitProblems = (sources) => LIMITS
    .filter(([file, line]) => !new RegExp('^[ \\t]*' + esc(line), 'm').test(stripComments(sources[file])))
    .map(([file, line]) => `${file}: missing "${line}"`);
  const real = { 'api/soa-token.js': read('api/soa-token.js'), 'api/soa-status.js': read('api/soa-status.js'), 'api/sign-soa.js': read('api/sign-soa.js') };
  ok('QA-12: the three SOA endpoints keep their conservative per-IP limits (issue 5/h, status 60/min, factor 10/10min, sign 3/h)', endpointLimitProblems(real).length === 0, endpointLimitProblems(real).join('; '));
  const loosened = { ...real, 'api/soa-token.js': once(real['api/soa-token.js'], "{ max: 5, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' }", "{ max: 500, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' }", 'loosened cap') };
  ok('QA-12: the limit scan bites: a loosened cap is caught', endpointLimitProblems(loosened).some((x) => /soa-token\.js/.test(x)));
}

// ── QA-24: Spanish and English select the same thing ────────────────────────
{
  const en = createSoaInstance({ ...baseInput, language: 'en' });
  const es = createSoaInstance({ ...baseInput, language: 'es' });
  ok('QA-24: the same selection yields identical authorized and declined codes in English and Spanish',
    en.ok && es.ok && same(en.instance.authorizedCategories, es.instance.authorizedCategories) && same(en.instance.declinedCategories, es.instance.declinedCategories));
  ok('QA-24: the instance stores category codes, never a language\'s label',
    same(en.instance.authorizedCategories, ['MA_WITH_RX']) && same(es.instance.authorizedCategories, ['MA_WITH_RX']));
  ok('QA-24: every category code has text in both document languages',
    SOA_CATEGORIES.every((c) => {
      const a = categoryText(c.code, 'en'); const b = categoryText(c.code, 'es');
      return a && b && typeof a.label === 'string' && a.label.length > 0 && typeof b.label === 'string' && b.label.length > 0 && a.label !== b.label;
    }));
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. The carrier registry (spec §16, §17, §35, §36)
// ═════════════════════════════════════════════════════════════════════════════
{
  const ctx = 'LICENSED_AGENT_WORKSPACE';
  const inv = overlayInventory(ctx);
  ok('SPEC-35: the inventory still names the ten carriers of spec §17', inv.length === 10, String(inv.length));
  ok('SPEC-35: every inventory row reports carrier, plan year, states, state-list status, status and evidence source',
    inv.every((o) => same(Object.keys(o).sort(), ['carrier', 'evidenceSourceUrl', 'planYear', 'states', 'statesStatus', 'status'].sort())), JSON.stringify(Object.keys(inv[0])));
  ok('SPEC-35: every registry row carries the public source spec §36 gives for the carrier, and null where it gives none',
    inv.every((o) => o.carrier in SPEC_36_SOURCES && o.evidenceSourceUrl === SPEC_36_SOURCES[o.carrier]),
    JSON.stringify(inv.map((o) => [o.carrier, o.evidenceSourceUrl])));
  ok('SPEC-36: six carriers have a source and four have none — exactly as the spec lists them',
    inv.filter((o) => typeof o.evidenceSourceUrl === 'string' && /^https:\/\//.test(o.evidenceSourceUrl)).length === 6 && inv.filter((o) => o.evidenceSourceUrl === null).length === 4);
  const byName = (n) => inv.find((o) => o.carrier === n) || {};
  ok('SPEC-17: only Clover Health (NJ) and ConnectiCare (CT) have a state list the spec states',
    byName('Clover Health').statesStatus === STATES_STATUS.STATED_BY_SPEC && same(byName('Clover Health').states, ['NJ']) &&
    byName('ConnectiCare').statesStatus === STATES_STATUS.STATED_BY_SPEC && same(byName('ConnectiCare').states, ['CT']) &&
    inv.filter((o) => o.statesStatus === STATES_STATUS.STATED_BY_SPEC).length === 2);
  ok('SPEC-17: the other eight state lists are marked UNVERIFIED — part of the pending verification, not a fact',
    inv.filter((o) => o.statesStatus === STATES_STATUS.UNVERIFIED).length === 8 && inv.every((o) => o.statesStatus !== STATES_STATUS.VERIFIED));
  ok('SPEC-17: every status is still PENDING — nothing claims a verification it has not had',
    inv.every((o) => /^PENDING_/.test(o.status)));
  ok('the state-list vocabulary is exactly STATED_BY_SPEC / VERIFIED / UNVERIFIED and frozen',
    Object.isFrozen(STATES_STATUS) && same(Object.values(STATES_STATUS).sort(), ['STATED_BY_SPEC', 'UNVERIFIED', 'VERIFIED']));
  ok('the two vocabularies the gate decides with are registered governing objects',
    GOVERNING_IDENTIFIERS.includes('OVERLAY_STATUS') && GOVERNING_IDENTIFIERS.includes('STATES_STATUS') && GOVERNING_IDENTIFIERS.includes('CARRIER_OVERLAYS'));

  // The gate decision, with every refusal, as a pure function.
  const aetna = getOverlay({ carrier: 'Aetna', planYear: 2027, state: 'NY', context: ctx });
  const clover = getOverlay({ carrier: 'Clover Health', planYear: 2027, state: 'NJ', context: ctx });
  ok('QA-20: a pending status is refused with the status as the reason',
    overlayGateDecision(aetna).allowed === false && overlayGateDecision(aetna).reason === OVERLAY_STATUS.PENDING_PRIVATE_VERIFICATION);
  const verifiedUnverifiedStates = overlayGateDecision({ ...aetna, status: OVERLAY_STATUS.VERIFIED_CURRENT });
  ok('QA-20: a verified status over an unverified state list is refused by name (STATES_UNVERIFIED)',
    verifiedUnverifiedStates.allowed === false && verifiedUnverifiedStates.reason === 'STATES_UNVERIFIED' && verifiedUnverifiedStates.statesStatus === STATES_STATUS.UNVERIFIED,
    JSON.stringify(verifiedUnverifiedStates));
  ok('QA-20: the refusal for an unverified state list carries the pending note', verifiedUnverifiedStates.openQuestion === STATES_PENDING_NOTE && /working assumption/.test(STATES_PENDING_NOTE));
  const allowedSpec = overlayGateDecision({ ...clover, status: OVERLAY_STATUS.VERIFIED_CURRENT });
  ok('QA-20: a verified status over a spec-stated state list is allowed, with no special requirement',
    allowedSpec.allowed === true && allowedSpec.reason === OVERLAY_STATUS.VERIFIED_CURRENT && allowedSpec.specialRequirement === null && allowedSpec.carrier === 'Clover Health');
  const special = overlayGateDecision({ ...aetna, status: OVERLAY_STATUS.VERIFIED_WITH_SPECIAL_REQUIREMENT, statesStatus: STATES_STATUS.VERIFIED });
  ok('QA-20: a special requirement travels with the allowance', special.allowed === true && special.specialRequirement === aetna.openQuestion);
  const noStatesStatus = overlayGateDecision({ carrier: 'X', planYear: 2027, states: ['NY'], status: OVERLAY_STATUS.VERIFIED_CURRENT });
  ok('QA-20: a row with no state-list status is refused as unverified', noStatesStatus.allowed === false && noStatesStatus.reason === 'STATES_UNVERIFIED' && noStatesStatus.statesStatus === null);
  const arrayStatus = overlayGateDecision({ ...clover, status: [OVERLAY_STATUS.VERIFIED_CURRENT] });
  ok('QA-20: a status that is not a string is not a status', arrayStatus.allowed === false && arrayStatus.reason === 'OVERLAY_STATUS_MISSING');
  ok('QA-20: a foreign state-list value does not permit',
    overlayGateDecision({ ...clover, status: OVERLAY_STATUS.VERIFIED_CURRENT, statesStatus: 'STATED_BY_SPEC ' }).reason === 'STATES_UNVERIFIED' &&
    overlayGateDecision({ ...clover, status: OVERLAY_STATUS.VERIFIED_CURRENT, statesStatus: ['STATED_BY_SPEC'] }).reason === 'STATES_UNVERIFIED');
  ok('QA-20: nothing, an array and a string are refused as unknown',
    [null, undefined, [], 'Aetna', 42].every((v) => overlayGateDecision(v).allowed === false && overlayGateDecision(v).reason === 'OVERLAY_UNKNOWN'));
  ok('QA-20: every registry row is refused today through the one decision function',
    inv.every((o) => {
      const d = canDiscussCarrier({ carrier: o.carrier, planYear: 2027, state: o.states[0], context: ctx });
      return d.allowed === false && d.reason === o.status && same(d, overlayGateDecision(getOverlay({ carrier: o.carrier, planYear: 2027, state: o.states[0], context: ctx })));
    }));
  ok('QA-20: an unknown carrier is still OVERLAY_UNKNOWN', canDiscussCarrier({ carrier: 'Imaginary Health', planYear: 2027, state: 'NY', context: ctx }).reason === 'OVERLAY_UNKNOWN');
  // No registry row is verified today, so a canDiscussCarrier() that quietly
  // re-grew its own status check (and skipped the state-list rule) would answer
  // every row identically. The one-implementation rule is therefore pinned
  // structurally too: anchored, comments stripped, observed biting.
  const gateWiringProblems = (source) => {
    const s = stripComments(source);
    const p = [];
    if (!/^[ \t]*return overlayGateDecision\(o\);$/m.test(s)) p.push('canDiscussCarrier() does not return overlayGateDecision(o)');
    const statusChecks = (s.match(/PERMITTING\.includes\(/g) || []).length;
    const statesChecks = (s.match(/PERMITTING_STATES\.includes\(/g) || []).length;
    if (statusChecks !== 1) p.push(`PERMITTING.includes( appears ${statusChecks} time(s); only overlayGateDecision() may decide`);
    if (statesChecks !== 1) p.push(`PERMITTING_STATES.includes( appears ${statesChecks} time(s); only overlayGateDecision() may decide`);
    return p;
  };
  const OVERLAY_SRC = read('api/_lib/cy2027/carrier-overlay.js');
  ok('QA-20: the gate has one implementation — canDiscussCarrier() returns overlayGateDecision(o) and nothing else decides', gateWiringProblems(OVERLAY_SRC).length === 0, gateWiringProblems(OVERLAY_SRC).join('; '));
  const regrown = once(OVERLAY_SRC, '  return overlayGateDecision(o);', "  if (!PERMITTING.includes(o.status)) return { allowed: false, reason: o.status, carrier: o.carrier, openQuestion: o.openQuestion };\n  return { allowed: true, reason: o.status, carrier: o.carrier, specialRequirement: null };", 'regrown check');
  ok('QA-20: the wiring scan bites: a re-grown inline status check is caught', gateWiringProblems(regrown).length >= 2, gateWiringProblems(regrown).join('; '));

  // Frozen all the way down — observed through the guarded accessor, because
  // the registry itself is private and the build gate cannot load it.
  const rows = inv.map((o) => getOverlay({ carrier: o.carrier, planYear: 2027, context: ctx }));
  ok('SPEC-35: the rows are frozen all the way down — observed through the guarded accessor', rows.every((r) => r && unfrozenPaths(r, r.carrier).length === 0),
    JSON.stringify(rows.map((r) => unfrozenPaths(r, r.carrier)).flat()));
  throws('SPEC-35: the state list cannot be grown', () => { rows[0].states.push('FL'); }, /not extensible|read only|Cannot add property/);
  throws('SPEC-35: a row cannot be re-statused in place', () => { 'use strict'; rows[0].status = OVERLAY_STATUS.VERIFIED_CURRENT; }, /read only|Cannot assign/);
  ok('SPEC-35: the inventory hands out the frozen list, not a mutable copy of it', inv.every((o) => Object.isFrozen(o.states)));

  // Still private.
  throws('the registry is still unreachable from the public website', () => overlayInventory('PUBLIC_WEBSITE'), /registry is private/);
  throws('the registry is still unreachable with no context', () => getOverlay({ carrier: 'Aetna', planYear: 2027 }), /registry is private/);
  throws('the registry is still unreachable from the SOA flow', () => canDiscussCarrier({ carrier: 'Aetna', planYear: 2027, state: 'NY', context: 'SOA_FLOW' }), /registry is private/);
  ok('the licensed workspace context is the only one admitted', assertPrivateContext('LICENSED_AGENT_WORKSPACE') === true);
  ok('CARRIER_OVERLAYS is still not an export of the module nor of the barrel', !('CARRIER_OVERLAYS' in overlayModule) && !('CARRIER_OVERLAYS' in barrelModule));
  ok('the decision function and the vocabularies are reachable, the data is not',
    typeof barrelModule.overlayGateDecision === 'function' && barrelModule.STATES_STATUS === STATES_STATUS && !('CARRIER_OVERLAYS' in barrelModule));
}

// ═════════════════════════════════════════════════════════════════════════════
if (failures.length) {
  console.error(`CY2027 QA MATRIX (SPEC-27/30/31): ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  console.error(`\nRESULT: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`CY2027 QA MATRIX (SPEC-27/30/31): all ${passed} assertions passed`);
console.log(`RESULT: ${passed} passed, 0 failed`);

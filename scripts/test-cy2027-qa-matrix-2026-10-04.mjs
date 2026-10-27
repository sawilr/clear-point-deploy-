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
// AUDIT 2026-10-04 (SPEC-27/30/31, red team) — what an independent red team
// broke in the first version of this suite, and what it observes now instead:
//   • QA-12 rested on a source scan of the `rateLimit(...)` configuration line;
//     a handler that computed the limit and issued the link anyway kept every
//     suite green. The three SOA handlers are now DRIVEN in process (SOA gate
//     flipped in memory by a loader hook, fetch replaced, dummy credentials)
//     and the refusal is a response observed: the sixth link request answers
//     429 with Retry-After, issues nothing and audits nothing.
//   • QA-04's wiring was a scan for the three state writes; `if (false)` around
//     them, or re-applying the old values after the state write, passed. The
//     form holds the jurisdiction as ONE value and applies one pure transition
//     (jurisdictionAfterStateChange, soa-instance.js) with a single write; the
//     transition is tested by calling it, the wiring is a tripwire only.
//   • The matrix checker accepted any string literal anywhere in any script:
//     a fixture, a payload or a limiter key cited as evidence passed, as did a
//     script npm test never runs. A citation must now be the label of an
//     assertion (the first argument of ok/throws/rejects/ck/check) in a suite
//     listed in run-battery.mjs SUITES.
//
// What this suite proves, by CALLING the rules:
//   1. The matrix cannot rot. A parser and a checker (pure functions) read
//      docs/compliance/CY2027-QA-MATRIX.md and require: every status exactly
//      PASS / FAIL / NOT TESTABLE HERE; every PASS row citing at least one
//      `scripts/<suite>.mjs :: <label>`; every cited suite in run-battery's
//      SUITES; every cited label the first argument of an assertion call in
//      that suite (comments stripped); every NOT TESTABLE HERE row naming who
//      can test it; all 25 §31 cases and all 12 website gates present, with the
//      spec text verbatim and the id matching the case. The checker is observed
//      FAILING on defective matrices before it is run on the real one. docs/ is
//      not part of the deployed artifact, so when it is absent the real run is
//      skipped with a named note.
//   2. The §31 cases that had no behavioural test: a blanket answer in place of
//      a category list authorizes nothing (QA-01, web); the ruleset comes from
//      the stated residence state and never from a phone (QA-03); a state
//      change withdraws every affirmation — the rule, the form's transition and
//      the scripted sequence the form runs, all called (QA-04); the per-IP
//      limiter admits exactly its cap of a parallel burst and each of the three
//      SOA handlers, driven, refuses the request past its cap (QA-12); the same
//      selection yields the same codes in both languages (QA-24).
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
import { register } from 'node:module';

import * as overlayModule from '../api/_lib/cy2027/carrier-overlay.js';
import {
  OVERLAY_STATUS, STATES_STATUS, STATES_PENDING_NOTE, overlayGateDecision, canDiscussCarrier, getOverlay, overlayInventory, assertPrivateContext,
} from '../api/_lib/cy2027/carrier-overlay.js';
import * as barrelModule from '../api/_lib/cy2027/index.js';
import {
  createSoaInstance, affirmationsAfterContextChange, jurisdictionAfterStateChange, jurisdictionAfterLanguageChange, SOA_STATUS,
} from '../api/_lib/cy2027/soa-instance.js';
import { resolveSigningRulesets } from '../api/_lib/cy2027/state-rules.js';
import { SOA_CATEGORIES, categoryText } from '../api/_lib/cy2027/soa-text.js';
import { stripComments, GOVERNING_IDENTIFIERS, REPO_ROOT, unfrozenPaths } from './no-self-modification-lib.mjs';

// The limiter and the SOA store read their storage tier at load. This suite
// must never reach a shared store (no network), so the variables are removed
// before either loads and the tier is asserted below.
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
const { rateLimit, rateLimitStorageTier } = await import('../api/_lib/rate-limit.js');
const { KV_AVAILABLE, getRecord, leadKey } = await import('../api/_lib/soa-store.js');
const { storeKeyFor } = await import('../api/_lib/cy2027/secure-link.js');

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
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

// AUDIT 2026-10-04 (SPEC-31, red team) — `stripped.includes(literal)` accepted a
// fixture, a message payload, a detail string or a limiter key as evidence,
// and never asked whether npm test runs the cited script. A citation is now
// the label of an assertion: the first argument of one of these calls, either
// the complete literal or the leading literal of a label the suite completes
// with `+`. The helpers are the ones the battery's suites define.
const ASSERTION_CALLS = Object.freeze(['ok', 'throws', 'rejects', 'ck', 'check']);
function isAssertionLabel(stripped, label) {
  const calls = '(?:^|[^\\w$.])(?:' + ASSERTION_CALLS.join('|') + ')\\s*\\(\\s*';
  return literalForms(label).some((f) => new RegExp(calls + esc(f) + '\\s*[,+)]').test(stripped));
}

/** The suites `npm test` runs: the SUITES array of run-battery.mjs, comments stripped; LIVE_SUITES is not it. */
function batterySuites(source) {
  if (typeof source !== 'string') return new Set();
  const m = /^[ \t]*const SUITES = \[([\s\S]*?)^\];/m.exec(stripComments(source).replace(/\r\n?/g, '\n'));
  return new Set(m ? [...m[1].matchAll(/'([^']+\.mjs)'/g)].map((x) => 'scripts/' + x[1]) : []);
}

/**
 * Everything that makes the matrix dishonest, by name. `readSource(file)`
 * answers the suite's source or null when the file does not exist;
 * `registered` is the set of `scripts/<suite>.mjs` paths npm test runs.
 */
function matrixProblems(rows, readSource, registered, spec = { cases: SPEC_31_CASES, gates: WEBSITE_GATES }) {
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
      if (!registered.has(c.file)) problems.push(`${id}: cites ${c.file}, which npm test does not run (not in run-battery.mjs SUITES)`);
      const src = source(c.file);
      if (src === null || src === undefined) { problems.push(`${id}: cites ${c.file}, which does not exist`); continue; }
      const stripped = stripComments(src);
      if (!literalForms(c.label).some((f) => stripped.includes(f))) problems.push(`${id}: ${c.file} has no string literal "${c.label}"`);
      else if (!isAssertionLabel(stripped, c.label)) problems.push(`${id}: ${c.file} has "${c.label}" as a string, but not as the label of an assertion (the first argument of ${ASSERTION_CALLS.join('/')})`);
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
    "const FIXTURE = 'a fixture the suite feeds in';",
    "ok('the fixture is used', FIXTURE.length > 0, 'a detail string, second argument');",
    "for (const m of ['x']) ck('a leading literal \"' + m + '\"', true);",
    "note('a label of something that is not an assertion', true);",
    "throws('a throws label', () => { throw new Error('x'); }, /x/);",
    "const obj = { ok: true }; obj.ok('a method named like a helper', true);",
  ].join('\n');
  const FAKE_BATTERY = "const LIVE_SUITES = [\n  'live-suite.mjs',\n];\nconst SUITES = [\n  'fake-suite.mjs',\n  // 'retired-suite.mjs',\n];\n";
  const fakeSources = { 'scripts/fake-suite.mjs': FAKE_SUITE, 'scripts/live-suite.mjs': FAKE_SUITE, 'scripts/retired-suite.mjs': FAKE_SUITE };
  const readFake = (f) => (f in fakeSources ? fakeSources[f] : null);
  const registeredFake = batterySuites(FAKE_BATTERY);
  ok('checker: the battery parser reads the SUITES array only — the live suite and the commented-out entry are not run by npm test',
    same([...registeredFake], ['scripts/fake-suite.mjs']), JSON.stringify([...registeredFake]));
  ok('checker: the battery parser answers nothing for a missing or malformed run-battery', batterySuites(null).size === 0 && batterySuites('const SUITES = 3;').size === 0);
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
  ok('checker: a complete, honest matrix has no problems', matrixProblems(good, readFake, registeredFake).length === 0, matrixProblems(good, readFake, registeredFake).join('; '));
  ok('checker: a `\\|` inside a cell is a pipe, not a column', same(splitCells('| a \\| b | c |'), ['a | b', 'c']));

  const probe = (overrides, re, label) => {
    const p = matrixProblems(parseMatrixTables(complete(overrides)), readFake, registeredFake);
    ok(label, p.some((x) => re.test(x)), p.join('; ') || 'no problem reported');
  };
  // The red team's shapes: a literal that is not an assertion's label, and a script npm test never runs.
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: a fixture the suite feeds in' } }, /has "a fixture the suite feeds in" as a string, but not as the label of an assertion/, 'checker bites: a fixture string the suite feeds in is not evidence');
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: a detail string, second argument' } }, /has "a detail string, second argument" as a string, but not as the label/, 'checker bites: a detail string (the second argument) is not evidence');
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: a label of something that is not an assertion' } }, /not as the label of an assertion/, 'checker bites: the first argument of a call that is not an assertion helper is not evidence');
  probe({ 1: { evidence: 'scripts/fake-suite.mjs :: a method named like a helper' } }, /not as the label of an assertion/, 'checker bites: a method call named like a helper (obj.ok) is not an assertion');
  probe({ 1: { evidence: 'scripts/live-suite.mjs :: a real label' } }, /cites scripts\/live-suite\.mjs, which npm test does not run/, 'checker bites: a live suite (outside SUITES) is not run by npm test');
  probe({ 1: { evidence: 'scripts/retired-suite.mjs :: a real label' } }, /cites scripts\/retired-suite\.mjs, which npm test does not run/, 'checker bites: a suite commented out of SUITES is not run by npm test');
  {
    const p = matrixProblems(parseMatrixTables(complete({ 1: { evidence: ['a leading literal "', 'a throws label'].map((l) => 'scripts/fake-suite.mjs :: ' + l).join('<br>') } })), readFake, registeredFake);
    ok('checker: the leading literal of a label completed with + and a throws() label are both assertion labels', p.length === 0, p.join('; '));
  }
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
    const p = matrixProblems(parseMatrixTables(complete().replace(caseRow(14), '')), readFake, registeredFake);
    ok('checker bites: a missing §31 case is named', p.some((x) => /§31 case 14 is not in the matrix/.test(x)), p.join('; '));
    const q = matrixProblems(parseMatrixTables(complete().replace(gateRow(WEBSITE_GATES[11]), '')), readFake, registeredFake);
    ok('checker bites: a missing website gate is named', q.some((x) => /website gate W11 \(Licensed agent workspace\) is not in the matrix/.test(x)), q.join('; '));
  }
  {
    const okLabels = ['template ${x} label', 'double "quoted" label', "it's escaped", 'exactly five are allowed'];
    const p = matrixProblems(parseMatrixTables(complete({ 1: { evidence: okLabels.map((l) => 'scripts/fake-suite.mjs :: ' + l).join('<br>') } })), readFake, registeredFake);
    ok('checker: template, double-quoted and escaped-apostrophe labels are all found as assertion labels', p.length === 0, p.join('; '));
    const multi = parseMatrixTables(complete({ 1: { evidence: 'scripts/fake-suite.mjs :: a real label<br>scripts/fake-suite.mjs :: only in a line comment', status: 'FAIL' } }));
    const q = matrixProblems(multi, readFake, registeredFake);
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
  // The battery is read from the file npm test executes; a battery that cannot
  // be read registers nothing, and every citation then fails by name.
  const registered = batterySuites(readRepo('scripts/run-battery.mjs'));
  ok('run-battery.mjs lists this suite among the ones npm test runs', registered.has('scripts/test-cy2027-qa-matrix-2026-10-04.mjs'), JSON.stringify([...registered]));
  if (readRepo(MATRIX) !== null) {
    const rows = parseMatrixTables(readRepo(MATRIX));
    const problems = matrixProblems(rows, readRepo, registered);
    ok('the QA matrix covers the 25 §31 cases and the 12 website gates with at least one row each', rows.length >= 37, String(rows.length));
    ok('the QA matrix is honest mechanically: every status is exact, every PASS is cited, every citation is the label of an assertion in a suite npm test runs, every spec case is verbatim',
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

  // AUDIT 2026-10-04 (SPEC-31, red team) — the APPLICATION of the rule in the
  // form, called. The form holds the jurisdiction as one value and a state
  // change is jurisdictionAfterStateChange(current, next): the whole next value.
  const NONE = Object.freeze({ noObligation: false, eSignature: false, signature: '' });
  const underNY = Object.freeze({ residenceState: 'NY', ...affirmed });
  const toNJ = jurisdictionAfterStateChange(underNY, 'NJ');
  ok('QA-04: the form\'s transition NY→NJ answers the whole next jurisdiction — New Jersey, with every affirmation withdrawn',
    same(toNJ, { residenceState: 'NJ', ...NONE }), JSON.stringify(toNJ));
  ok('QA-04: the form\'s transition NY→NY keeps the state and every affirmation exactly as given',
    same(jurisdictionAfterStateChange(underNY, 'NY'), underNY), JSON.stringify(jurisdictionAfterStateChange(underNY, 'NY')));
  ok('QA-04: the transition to "another state" withdraws them too', same(jurisdictionAfterStateChange(underNY, 'OTHER'), { residenceState: 'OTHER', ...NONE }));
  ok('QA-04: a first choice of state through the transition has nothing to keep',
    same(jurisdictionAfterStateChange({ residenceState: '', ...NONE }, 'NY'), { residenceState: 'NY', ...NONE }) &&
    same(jurisdictionAfterStateChange(null, 'NY'), { residenceState: 'NY', ...NONE }) &&
    same(jurisdictionAfterStateChange(undefined, 'NY'), { residenceState: 'NY', ...NONE }));
  ok('QA-04: a next state that is not a string becomes no state and keeps nothing',
    same(jurisdictionAfterStateChange(underNY, 42), { residenceState: '', ...NONE }) && same(jurisdictionAfterStateChange(underNY, ['NY']), { residenceState: '', ...NONE }) &&
    same(jurisdictionAfterStateChange(underNY, undefined), { residenceState: '', ...NONE }));
  ok('QA-04: through the transition, only a literal true is an affirmation and only a string is a signature',
    same(jurisdictionAfterStateChange({ residenceState: 'NY', noObligation: 'yes', eSignature: 1, signature: 42 }, 'NY'), { residenceState: 'NY', ...NONE }));
  ok('QA-04: the transition applies the one rule — for every pair of states it agrees with affirmationsAfterContextChange()',
    [['NY', 'NJ'], ['NY', 'NY'], ['', 'NY'], ['CT', 'OTHER'], ['OTHER', 'OTHER'], ['NJ', 'CT']].every(([a, b]) =>
      same(jurisdictionAfterStateChange({ residenceState: a, ...affirmed }, b), { residenceState: b, ...affirmationsAfterContextChange(a, b, affirmed) })));
  ok('QA-04: the transition mutates nothing and answers a frozen value',
    same(underNY, { residenceState: 'NY', ...affirmed }) && Object.isFrozen(toNJ) && Object.isFrozen(jurisdictionAfterStateChange(underNY, 'NY')));
  const afterLanguage = jurisdictionAfterLanguageChange(underNY);
  ok('QA-04 (G08): a language change keeps the state as a fact and withdraws every affirmation, frozen',
    same(afterLanguage, { residenceState: 'NY', ...NONE }) && Object.isFrozen(afterLanguage) &&
    same(jurisdictionAfterLanguageChange(null), { residenceState: '', ...NONE }) && same(jurisdictionAfterLanguageChange({ residenceState: ['NY'] }), { residenceState: '', ...NONE }));
  // The sequence the form runs, scripted: the same transitions, in the order a
  // person produces them. `tick` is what the two checkboxes and the signature
  // field do (a spread into the one value).
  const tick = (j, patch) => ({ ...j, ...patch });
  let j = { residenceState: '', ...NONE };
  j = jurisdictionAfterStateChange(j, 'NY');
  j = tick(j, { noObligation: true }); j = tick(j, { eSignature: true }); j = tick(j, { signature: 'Jane Q Public' });
  const affirmedUnderNY = same(j, underNY);
  j = jurisdictionAfterStateChange(j, 'NJ');
  const withdrawnOnNJ = same(j, { residenceState: 'NJ', ...NONE });
  j = tick(j, { noObligation: true, eSignature: true, signature: 'Jane Q Public' });
  j = jurisdictionAfterStateChange(j, 'NJ');
  const keptOnNJ = same(j, { residenceState: 'NJ', ...affirmed });
  j = jurisdictionAfterLanguageChange(j);
  ok('QA-04: the scripted form — choose NY, tick both, type the name, switch to NJ: withdrawn; affirm again, click NJ again: kept; change language: withdrawn, state kept',
    affirmedUnderNY && withdrawnOnNJ && keptOnNJ && same(j, { residenceState: 'NJ', ...NONE }), JSON.stringify([affirmedUnderNY, withdrawnOnNJ, keptOnNJ, j]));

  // The wiring is a TRIPWIRE, not the evidence: the jurisdiction is one value,
  // read in one place, written in exactly five (two acknowledgements, the
  // signature, the language change, the state change), the state-change handler
  // is exactly the single write of the transition, both radios call it, and no
  // separate affirmation state exists to be re-grown. Anchored, comments
  // stripped, line endings normalised, and observed biting on the red team's
  // two shapes and on three more.
  const FORM = read('src/components/SOAForm.tsx').replace(/\r\n?/g, '\n');
  const anchored = (s, line) => new RegExp('^[ \\t]*' + esc(line) + '$', 'm').test(s);
  const HANDLER = [
    "const changeResidenceState = (code: SupportedState | 'OTHER') => {",
    '  setJurisdiction((current) => jurisdictionAfterStateChange(current, code));',
    "  setErrors((p) => ({ ...p, residenceState: '' }));",
    '};',
  ];
  const handlerBlock = new RegExp('^([ \\t]*)' + HANDLER.map((l, i) => (i === 0 ? '' : '\\n\\1') + esc(l)).join('') + '$', 'm');
  const PINNED = [
    "const [jurisdiction, setJurisdiction] = useState<SoaJurisdiction<ResidenceChoice>>({ residenceState: '', noObligation: false, eSignature: false, signature: '' });",
    'const { residenceState, noObligation: ackNoObl, eSignature: ackEsig, signature } = jurisdiction;',
    'setJurisdiction((current) => jurisdictionAfterLanguageChange(current));',
    '<input type="checkbox" className="mt-1 w-5 h-5 accent-gold-500" checked={ackNoObl} onChange={(e) => setJurisdiction((current) => ({ ...current, noObligation: e.target.checked }))} />',
    '<input type="checkbox" className="mt-1 w-5 h-5 accent-gold-500" checked={ackEsig} onChange={(e) => setJurisdiction((current) => ({ ...current, eSignature: e.target.checked }))} />',
    'onChange={(v) => setJurisdiction((current) => ({ ...current, signature: v }))}',
    'onChange={() => changeResidenceState(code)}',
    "onChange={() => changeResidenceState('OTHER')}",
  ];
  const formWiringProblems = (source) => {
    const s = stripComments(source).replace(/\r\n?/g, '\n');
    const p = [];
    if (!handlerBlock.test(s)) p.push('the state-change handler is not exactly the single write of jurisdictionAfterStateChange() followed by the error reset');
    for (const line of PINNED) if (!anchored(s, line)) p.push(`missing or altered: ${line}`);
    const writes = (s.match(/setJurisdiction\(/g) || []).length;
    if (writes !== 5) p.push(`setJurisdiction( is called ${writes} time(s); the two acknowledgements, the signature, the language change and the state change are the only five`);
    const regrown = [...new Set(s.match(/\bset(?:ResidenceState|AckNoObl|AckEsig|Signature)\b/g) || [])];
    if (regrown.length) p.push(`a separate affirmation or state value has been re-grown: ${regrown.join(', ')}`);
    if ((s.match(/useState<SoaJurisdiction</g) || []).length !== 1) p.push('the jurisdiction is not held as one value');
    return p;
  };
  ok('QA-04 (tripwire): the form holds the jurisdiction as one value, applies each transition with a single write, and routes both state radios through the handler',
    formWiringProblems(FORM).length === 0, formWiringProblems(FORM).join('; '));
  const WRITE = '    setJurisdiction((current) => jurisdictionAfterStateChange(current, code));\n';
  const neutered = once(FORM, WRITE, '    if (false) {\n' + WRITE + '    }\n', 'if (false) neutering');
  ok('QA-04: the tripwire bites: the write wrapped in if (false) is caught', formWiringProblems(neutered).some((x) => /handler is not exactly the single write/.test(x)), formWiringProblems(neutered).join('; '));
  const restored = once(FORM, WRITE, WRITE + '    setJurisdiction((current) => ({ ...current, signature: jurisdiction.signature }));\n', 'restore after the write');
  ok('QA-04: the tripwire bites: the old signature restored after the state write is caught',
    formWiringProblems(restored).some((x) => /handler is not exactly the single write/.test(x)) && formWiringProblems(restored).some((x) => /called 6 time/.test(x)), formWiringProblems(restored).join('; '));
  const later = once(FORM, "    setErrors((p) => ({ ...p, residenceState: '' }));\n  };\n", "    setErrors((p) => ({ ...p, residenceState: '' }));\n  };\n  useEffect(() => { setJurisdiction((current) => ({ ...current, signature })); }, [residenceState]);\n", 'restore in an effect');
  ok('QA-04: the tripwire bites: a sixth write anywhere in the form is caught', formWiringProblems(later).some((x) => /called 6 time/.test(x)), formWiringProblems(later).join('; '));
  const bypass = once(FORM, 'onChange={() => changeResidenceState(code)}', 'onChange={() => setJurisdiction((current) => ({ ...current, residenceState: code }))}', 'radio bypass');
  ok('QA-04: the tripwire bites: a radio that sets the state without the transition is caught',
    formWiringProblems(bypass).some((x) => /missing or altered: onChange=\{\(\) => changeResidenceState\(code\)\}/.test(x)) && formWiringProblems(bypass).some((x) => /called 6 time/.test(x)));
  const regrown = once(FORM, '  const { residenceState, noObligation: ackNoObl, eSignature: ackEsig, signature } = jurisdiction;\n',
    "  const { residenceState, noObligation: ackNoObl, eSignature: ackEsig } = jurisdiction;\n  const [signature, setSignature] = useState('');\n", 're-grown signature state');
  ok('QA-04: the tripwire bites: a separate signature state re-grown beside the one value is caught', formWiringProblems(regrown).some((x) => /re-grown: setSignature/.test(x)), formWiringProblems(regrown).join('; '));
  const commented = once(FORM, "onChange={() => changeResidenceState('OTHER')}", "onChange={() => setJurisdiction((current) => ({ ...current, residenceState: 'OTHER' }))} /* onChange={() => changeResidenceState('OTHER')} */", 'comment decoy');
  ok('QA-04: the tripwire bites: the anchor inside a comment does not count', formWiringProblems(commented).some((x) => /missing or altered: onChange=\{\(\) => changeResidenceState\('OTHER'\)\}/.test(x)));
}

// ── QA-12: a flood of link requests ─────────────────────────────────────────
{
  ok('QA-12: the limiter under test is the in-process tier — no shared store is reached from this suite', rateLimitStorageTier().tier === 'per-instance-memory', JSON.stringify(rateLimitStorageTier()));
  const burst = await Promise.all(Array.from({ length: 8 }, () => rateLimit('qa-matrix-burst-source', { max: 5, windowMs: 60 * 60 * 1000, prefix: 'qa-tok' })));
  ok('QA-12: the per-IP limiter admits exactly the configured number of a parallel burst and refuses the rest',
    burst.filter((r) => r.ok === true).length === 5 && burst.filter((r) => r.ok === false && r.retryAfter > 0).length === 3, JSON.stringify(burst));
  const other = await rateLimit('qa-matrix-other-source', { max: 5, windowMs: 60 * 60 * 1000, prefix: 'qa-tok' });
  ok('QA-12: another source is not punished for the first one\'s flood', other.ok === true);

  // The configuration lines, as a TRIPWIRE only (the evidence is the handlers
  // driven below): anchored, comments stripped, observed biting on a loosened copy.
  const LIMITS = Object.freeze([
    ['api/soa-token.js', "var rl = await rateLimit(ip, { max: 5, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' });"],
    ['api/soa-status.js', "var rl = await rateLimit(ip, { max: 60, windowMs: 60 * 1000, prefix: 'soa-stat' });"],
    ['api/soa-status.js', "var rlp = await rateLimit(ip, { max: 10, windowMs: 10 * 60 * 1000, prefix: 'soa-factor' });"],
    ['api/sign-soa.js', "var rl = await rateLimit(ip, { max: 3, windowMs: 60 * 60 * 1000, prefix: 'soa-sign' });"],
  ]);
  const endpointLimitProblems = (sources) => LIMITS
    .filter(([file, line]) => !new RegExp('^[ \\t]*' + esc(line), 'm').test(stripComments(sources[file])))
    .map(([file, line]) => `${file}: missing "${line}"`);
  const real = { 'api/soa-token.js': read('api/soa-token.js'), 'api/soa-status.js': read('api/soa-status.js'), 'api/sign-soa.js': read('api/sign-soa.js') };
  ok('QA-12 (tripwire): the three SOA endpoints keep their conservative per-IP limits (issue 5/h, status 60/min, factor 10/10min, sign 3/h)', endpointLimitProblems(real).length === 0, endpointLimitProblems(real).join('; '));
  const loosened = { ...real, 'api/soa-token.js': once(real['api/soa-token.js'], "{ max: 5, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' }", "{ max: 500, windowMs: 60 * 60 * 1000, prefix: 'soa-tok' }", 'loosened cap') };
  ok('QA-12: the limit tripwire bites: a loosened cap is caught', endpointLimitProblems(loosened).some((x) => /soa-token\.js/.test(x)));

  // AUDIT 2026-10-04 (SPEC-31, red team) — the ENFORCEMENT, observed. The three
  // handlers are gated off (SOA_ENABLED=false, pinned by test-cp-findings); a
  // loader hook rewrites that ONE declaration to true in memory for these module
  // instances only, the files on disk are untouched. Nothing leaves this
  // machine: fetch is replaced by a double that throws, the credentials the
  // shell may carry are replaced by dummies for the duration, the store is the
  // memory tier, and the console is captured so the audit lines are evidence.
  register('data:text/javascript,' + encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      const r = await nextLoad(url, context);
      if (!/\\/api\\/(soa-token|soa-status|sign-soa)\\.js$/.test(url)) return r;
      const text = typeof r.source === 'string' ? r.source : new TextDecoder().decode(r.source);
      const parts = text.split('const SOA_ENABLED = false;');
      if (parts.length !== 2) throw new Error('the SOA gate is not declared exactly once in ' + url);
      return { ...r, source: parts.join('const SOA_ENABLED = true;') };
    }
  `));
  const ENV_DUMMIES = { HIGHLEVEL_TOKEN: 'local-dummy', HIGHLEVEL_LOCATION_ID: 'local-dummy', OPENAI_API_KEY: 'dummy' };
  const ENV_REMOVED = ['CY2027_SEND_OTP', 'CY2027_EVIDENCE_STORE_URL', 'CY2027_EVIDENCE_STORE_TOKEN'];
  const savedEnv = Object.fromEntries([...Object.keys(ENV_DUMMIES), ...ENV_REMOVED].map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  const LOGS = [];
  try {
    Object.assign(process.env, ENV_DUMMIES);
    for (const k of ENV_REMOVED) delete process.env[k];
    globalThis.fetch = async (url) => { throw new Error('QA-12: the handlers must not reach ' + String(url).slice(0, 60)); };
    for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { LOGS.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    const audits = () => LOGS.filter((l) => l.includes('[SOA-AUDIT] {')).map((l) => JSON.parse(l.slice(l.indexOf('{'))));
    const handlerOf = async (p) => (await import(new URL(p, new URL('../', import.meta.url)).href)).default;
    const soaToken = await handlerOf('api/soa-token.js');
    const soaStatus = await handlerOf('api/soa-status.js');
    const signSoa = await handlerOf('api/sign-soa.js');
    ok('QA-12 (handler): the SOA store under test is the memory tier — no shared store is reached', KV_AVAILABLE === false);

    const mkReq = (ip, method, url, body) => ({
      method, url,
      // clientId() reads the edge header first on every host, so the source is this header, exactly.
      headers: { origin: 'https://clearpointsenioradvisors.com', 'x-vercel-forwarded-for': ip, 'x-forwarded-for': ip, 'user-agent': 'cy2027-qa-matrix', 'content-type': 'application/json' },
      readableEnded: true, complete: true, on() {}, body,
    });
    const mkRes = () => { const h = {}; return { statusCode: 200, payload: undefined, setHeader(k, v) { h[k] = v; }, getHeader(k) { return h[k]; }, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end(d) { this.payload = d; return this; } }; };
    const drive = async (fn, ip, method, url, body) => {
      const res = mkRes(); let threw = null;
      try { await fn(mkReq(ip, method, url, body), res); } catch (e) { threw = String((e && e.stack) || e).slice(0, 300); }
      return { status: res.statusCode, payload: res.payload, retryAfter: res.getHeader('Retry-After'), threw };
    };
    const LEAD = { fullName: 'Jane Q Public', phone: '6315550147', email: '', zip: '11717', language: 'en' };
    const issue = (ip) => drive(soaToken, ip, 'POST', '/api/soa-token', LEAD);
    const brief = (rs) => JSON.stringify(rs.map((r) => [r.status, r.retryAfter || null, r.threw || (r.payload && r.payload.error) || null]));

    // (a) The issuer: five from one source are issued, the sixth is refused.
    const IP_A = '203.0.113.10';
    const five = [];
    for (let i = 0; i < 5; i++) five.push(await issue(IP_A));
    const auditsBefore = audits().length;
    const sixth = await issue(IP_A);
    const auditsAfter = audits().length;
    ok('QA-12 (handler): five link requests from one source are issued — each answers 200 with a distinct token and names its factor',
      five.every((r) => r.status === 200 && !r.threw && typeof r.payload.token === 'string' && r.payload.factorRequired === 'PHONE_LAST4') && new Set(five.map((r) => r.payload.token)).size === 5, brief(five));
    ok('QA-12 (handler): the sixth link request from that source is refused 429 with Retry-After and carries no token',
      sixth.status === 429 && !sixth.threw && sixth.payload && sixth.payload.error === 'Too many SOA tokens requested' && Number(sixth.retryAfter) > 0 && !('token' in sixth.payload) && !('soaUrl' in sixth.payload), JSON.stringify(sixth));
    ok('QA-12 (handler): the refused request issued nothing and audited nothing — exactly five SOA_LINK_ISSUED audits, none after the refusal',
      auditsAfter === auditsBefore && audits().filter((a) => a.action === 'SOA_LINK_ISSUED').length === 5, JSON.stringify([auditsBefore, auditsAfter, audits().map((a) => a.action)]));
    let linkRecords = 0;
    let leadRecords = 0;
    for (const r of five) if (await getRecord(storeKeyFor(r.payload.token))) linkRecords += 1;
    for (const a of audits().filter((x) => x.action === 'SOA_LINK_ISSUED')) if (await getRecord(leadKey(a.correlationId))) leadRecords += 1;
    ok('QA-12 (handler): the five issued links and their five lead records are in the store, and the audit names each', linkRecords === 5 && leadRecords === 5, JSON.stringify([linkRecords, leadRecords]));
    const IP_B = '203.0.113.20';
    const burstH = await Promise.all(Array.from({ length: 8 }, () => issue(IP_B)));
    ok('QA-12 (handler): a parallel burst of eight link requests from one source — exactly five are issued, three are refused 429',
      burstH.filter((r) => r.status === 200 && typeof r.payload.token === 'string').length === 5 && burstH.filter((r) => r.status === 429 && Number(r.retryAfter) > 0).length === 3 && burstH.every((r) => !r.threw), brief(burstH));
    const otherSource = await issue('203.0.113.30');
    ok('QA-12 (handler): another source is not punished for the first one\'s flood', otherSource.status === 200 && !otherSource.threw, JSON.stringify(otherSource));

    // (b) The status endpoint: sixty probes, then 429; ten factor attempts, then 429 with Retry-After.
    const probes = [];
    for (let i = 0; i < 61; i++) probes.push(await drive(soaStatus, '203.0.113.40', 'GET', '/api/soa-status?token=not-a-token', null));
    ok('QA-12 (handler): the status endpoint answers sixty probes from one source and refuses the sixty-first 429',
      probes.slice(0, 60).every((r) => r.status === 400 && !r.threw) && probes[60].status === 429 && probes[60].payload && probes[60].payload.error === 'Too many requests', brief(probes.slice(58)));
    const attempts = [];
    for (let i = 0; i < 11; i++) attempts.push(await drive(soaStatus, '203.0.113.50', 'POST', '/api/soa-status', { token: 'not-a-token', factor: '0000' }));
    ok('QA-12 (handler): the eleventh factor attempt from one source is refused 429 with Retry-After',
      attempts.slice(0, 10).every((r) => r.status === 400 && !r.threw) && attempts[10].status === 429 && Number(attempts[10].retryAfter) > 0 && attempts[10].payload && attempts[10].payload.error === 'Too many attempts', brief(attempts.slice(8)));
    ok('QA-12 (handler): a source refused on the factor is not thereby refused on the probe', (await drive(soaStatus, '203.0.113.50', 'GET', '/api/soa-status?token=not-a-token', null)).status === 400);

    // (c) The signature endpoint: three attempts, then 429.
    const signs = [];
    for (let i = 0; i < 4; i++) signs.push(await drive(signSoa, '203.0.113.60', 'POST', '/api/sign-soa', { token: 'not-a-token' }));
    ok('QA-12 (handler): the fourth signature attempt from one source is refused 429',
      signs.slice(0, 3).every((r) => r.status === 400 && !r.threw) && signs[3].status === 429 && signs[3].payload && signs[3].payload.error === 'Too many sign attempts', brief(signs));
    ok('QA-12 (handler): nothing in the driven section reached a provider or a CRM', !LOGS.some((l) => /must not reach/.test(l)) && !audits().some((a) => /FAIL|ERROR/.test(String(a.result))), LOGS.filter((l) => /must not reach/.test(l)).join('\n'));
  } finally {
    globalThis.fetch = savedFetch;
    for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
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

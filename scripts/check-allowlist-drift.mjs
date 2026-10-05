#!/usr/bin/env node
// scripts/check-allowlist-drift.mjs
//
// RED TEAM ROUND 5 (R5-SL-06, P2) — a build gate against a silent, invisible
// failure mode.
//
// api/submit-lead.js allow-lists lead_source, lead_type and medicare_status
// because each becomes a SERVER-OWNED CRM tag or custom field, and an
// unexpected value must not mint a spoofed one. The failure mode is that the
// allow-list and the front end drift apart: the value is replaced by the
// default, no tag is written, nothing errors, and nobody finds out until a
// quarter of routing is missing.
//
// It has now happened twice. Round 4 found it for lead_source — "Website
// Chatbot" normalised to an unknown value and tagged almost every real lead
// Source-other — fixed the list, and did not re-check lead_type. Round 5 found
// lead_type: the list matched NONE of the six values Smart Medicare Review
// sends, so that entire surface lost its LeadType-* tag.
//
// This runs in the build. It reads both sides from source and fails loudly on
// any value the front end can send that the server would throw away.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// AUDIT 2026-10-04 (DM-04) — the server's own token table, not a copy of it.
// api/ is part of the deployed artefact, so this import needs no .vercelignore
// exception (check-vercel-config.mjs follows it and agrees).
import {
  BENEFIT_SELF_REPORT_TOKENS, COVERAGE_TOKENS_ASSERTING_MEDICAID, isCoverageOptionAssertingMedicaid,
} from '../api/_lib/cy2027/benefit-self-report.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HANDLER = readFileSync(join(root, 'api', 'submit-lead.js'), 'utf8');

function serverList(name) {
  const m = HANDLER.match(new RegExp('var ' + name + ' = \\[([\\s\\S]*?)\\];'));
  if (!m) { fail(`cannot find ${name} in api/submit-lead.js — did it move or get renamed?`); return []; }
  // Strip line comments first — these lists carry explanatory comments between
  // entries, and a comment containing a comma or an apostrophe would otherwise
  // parse as an entry and hide a real drift.
  const body = m[1].replace(/^[ \t]*\/\/.*$/gm, '');
  return [...body.matchAll(/'([^']*)'/g)].map((x) => x[1]).filter(Boolean);
}

const problems = [];
function fail(msg) { problems.push(msg); }

const LEAD_SOURCES = serverList('LEAD_SOURCES');
const LEAD_TYPES = serverList('LEAD_TYPES');
const MEDICARE_STATUSES = serverList('MEDICARE_STATUSES');

// The server normalises before comparing; mirror that exactly.
const norm = (v) => String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// AUDIT 2026-10-04 (DM-04, red team) — the server reads a Medicaid self-report
// from the coverage value AS SENT, not from its normalised token (the token is
// lossy: '¿dual?' and 'не dual' both become 'dual'). A surface value that only
// NORMALISES to that token ("dual!", "Dual.") would pass the allow-list checks
// below and then be withheld as unclassified text on every lead — no
// self-report stored, and nothing would say so. The server's own function is
// asked, not a copy of its rule.
function mustBeTheMedicaidOptionItself(value, where) {
  if (COVERAGE_TOKENS_ASSERTING_MEDICAID.includes(norm(value)) && !isCoverageOptionAssertingMedicaid(value)) {
    fail(`${where} "${value}" normalises to the server's Medicaid coverage token but is not the token itself — the server would withhold it as unclassified text and store no self-report`);
  }
}

// ── 1. Every LEAD_TYPE_TAG value must be accepted. ───────────────────────
{
  const src = readFileSync(join(root, 'src', 'lib', 'smartReviewRouting.ts'), 'utf8');
  const block = src.match(/export const LEAD_TYPE_TAG[^=]*=\s*\{([\s\S]*?)\};/);
  if (!block) fail('cannot find LEAD_TYPE_TAG in src/lib/smartReviewRouting.ts');
  else {
    const values = [...block[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
    if (!values.length) fail('LEAD_TYPE_TAG parsed but yielded no values');
    for (const v of values) {
      if (LEAD_TYPES.indexOf(norm(v)) === -1) {
        fail(`lead_type "${v}" is sent by Smart Medicare Review but is NOT in the server LEAD_TYPES allow-list — the LeadType-* tag would be dropped silently`);
      }
    }
    // The enum KEYS travel too: SmartMedicareReview sends `lt`, which is the
    // LeadType name itself on some paths.
    const keys = [...block[1].matchAll(/^\s*([A-Z_]+)\s*:/gm)].map((m) => m[1]);
    for (const k of keys) {
      if (LEAD_TYPES.indexOf(norm(k)) === -1) {
        fail(`lead_type enum name "${k}" normalises to "${norm(k)}", which is NOT in the server LEAD_TYPES allow-list`);
      }
    }
  }
}

// ── 2. Every literal lead_source / lead_type in src/ must be accepted. ───
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
for (const file of walk(join(root, 'src'))) {
  const src = readFileSync(file, 'utf8');
  for (const [, value] of src.matchAll(/\blead_source:\s*'([^']+)'/g)) {
    if (/\$\{/.test(value)) continue;
    if (LEAD_SOURCES.indexOf(norm(value)) === -1) {
      fail(`lead_source "${value}" in ${file.slice(root.length + 1)} is not in the server LEAD_SOURCES allow-list — it would be tagged Source-other`);
    }
  }
  for (const [, value] of src.matchAll(/\blead_type:\s*'([^']+)'/g)) {
    if (/\$\{/.test(value)) continue;
    if (LEAD_TYPES.indexOf(norm(value)) === -1) {
      fail(`lead_type "${value}" in ${file.slice(root.length + 1)} is not in the server LEAD_TYPES allow-list — no LeadType-* tag would be written`);
    }
  }
  for (const [, value] of src.matchAll(/\bmedicare_status:\s*'([^']{1,60})'/g)) {
    if (!value || /\$\{/.test(value)) continue;
    if (MEDICARE_STATUSES.indexOf(norm(value)) === -1) {
      fail(`medicare_status "${value}" in ${file.slice(root.length + 1)} is not in the server MEDICARE_STATUSES allow-list — the enrichment model would see "other"`);
    }
    mustBeTheMedicaidOptionItself(value, `medicare_status in ${file.slice(root.length + 1)}`);
  }
}

//
// RED TEAM ROUND 6 (RT6-05, P2). Sections 3 and 4 were `if (found) { check }`
// with no else, so an ordinary refactor made them skip themselves in silence
// while the gate printed the all-clear. Measured: writing the attribute as
// `name={'medicare_status'}` — valid JSX, identical DOM — and deriving the union
// the normal TypeScript way with `(typeof VALUES)[number]` hid two real drift
// defects that were still in the tree, and the gate exited 0.
//
// A structural probe that finds nothing has FAILED. Section 1 already said so;
// these two now match it, and each asserts a minimum member count so a probe
// that matches an empty shell cannot pass either.

// ── 3. The LeadForm coverage <select> options must be accepted. ──────────
{
  const form = readFileSync(join(root, 'src', 'components', 'LeadForm.tsx'), 'utf8');
  const select = form.match(/name=(?:"medicare_status"|\{\s*['"`]medicare_status['"`]\s*\})[\s\S]*?<\/select>/);
  if (!select) {
    fail('cannot find the medicare_status <select> in src/components/LeadForm.tsx — this check cannot run, so the coverage values are unverified');
  } else {
    const options = [...select[0].matchAll(/<option value=(?:"([^"]*)"|\{\s*['"`]([^'"`]*)['"`]\s*\})/g)]
      .map((m) => m[1] ?? m[2]).filter((v) => v);
    if (options.length < 4) fail(`the medicare_status <select> yielded only ${options.length} option values — the parse is wrong, not the form`);
    for (const value of options) {
      if (MEDICARE_STATUSES.indexOf(norm(value)) === -1) {
        fail(`the LeadForm coverage option "${value}" is not in the server MEDICARE_STATUSES allow-list`);
      }
      mustBeTheMedicaidOptionItself(value, 'the LeadForm coverage option');
    }
  }
}

// ── 4. Clara's MedicareStatus union must be accepted. ────────────────────
{
  const clara = readFileSync(join(root, 'src', 'lib', 'claraOuterFlow.ts'), 'utf8');
  // Both the literal union and the `as const` array it is commonly derived from.
  const union = clara.match(/export type MedicareStatus\s*=\s*([^;]+);/);
  const derived = clara.match(/export const MEDICARE_STATUS_VALUES\s*=\s*\[([^\]]*)\]\s*as\s+const/);
  const source = (derived && derived[1]) || (union && !/\[number\]/.test(union[1]) ? union[1] : null);
  if (!source) {
    fail("cannot resolve Clara's MedicareStatus values in src/lib/claraOuterFlow.ts — this check cannot run, so they are unverified");
  } else {
    const values = [...source.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    if (values.length < 3) fail(`Clara's MedicareStatus resolved to only ${values.length} values — the parse is wrong, not the union`);
    for (const value of values) {
      if (MEDICARE_STATUSES.indexOf(norm(value)) === -1) {
        fail(`Clara's MedicareStatus value "${value}" is not in the server MEDICARE_STATUSES allow-list`);
      }
      mustBeTheMedicaidOptionItself(value, "Clara's MedicareStatus value");
    }
  }
}

// ── 5. The Smart Review Medicaid / Extra Help options must be server tokens. ──
// AUDIT 2026-10-04 (DM-04). The server refuses a benefit_self_report it does not
// recognise — fail-closed, by design, and matched exactly — so an option value
// that drifts from the vocabulary would make the answer vanish with nothing but
// a log line. Same failure mode as sections 1-4, and the same structural-probe
// rule: finding nothing is a failure, not a pass. The two ends of the wire are
// probed too, because a token nobody sends is the same silent loss.
let benefitOptionCount = 0;
{
  const smart = readFileSync(join(root, 'src', 'components', 'SmartMedicareReview.tsx'), 'utf8');
  const select = smart.match(/value=\{medicaidExtraHelp\}[\s\S]*?<\/select>/);
  if (!select) {
    fail('cannot find the Medicaid / Extra Help <select> in src/components/SmartMedicareReview.tsx — this check cannot run, so the self-report tokens are unverified');
  } else {
    const all = [...select[0].matchAll(/<option\b[^>]*>/g)].map((m) => m[0]);
    const options = all.map((tag) => {
      const m = tag.match(/\bvalue=(?:"([^"]*)"|'([^']*)'|\{\s*['"`]([^'"`]*)['"`]\s*\})/);
      return m ? (m[1] ?? m[2] ?? m[3]) : null;
    });
    if (options.some((v) => v === null)) {
      fail('an <option> of the Medicaid / Extra Help <select> has a value this check cannot read — write it as a string literal');
    }
    const values = options.filter((v) => v);
    benefitOptionCount = values.length;
    if (values.length < 3) fail(`the Medicaid / Extra Help <select> yielded only ${values.length} option values — the parse is wrong, not the form`);
    for (const value of values) {
      if (!Object.prototype.hasOwnProperty.call(BENEFIT_SELF_REPORT_TOKENS, value)) {
        fail(`the Smart Review option "${value}" is not a benefit_self_report token the server accepts — the answer would be refused and never stored`);
      }
    }
  }
  if (!/^[ \t]*benefit_self_report:\s*medicaidExtraHelp,[ \t]*\r?$/m.test(smart)) {
    fail('src/components/SmartMedicareReview.tsx no longer sends `benefit_self_report: medicaidExtraHelp` — the answer would never leave the browser');
  }
  const bridge = readFileSync(join(root, 'src', 'lib', 'ghl.ts'), 'utf8');
  if (!/^[ \t]*if \(payload\.benefit_self_report\) \{ body\.benefit_self_report = payload\.benefit_self_report; \}[ \t]*\r?$/m.test(bridge)) {
    fail('src/lib/ghl.ts no longer forwards payload.benefit_self_report to the request body — the answer would never reach the server');
  }
  if (!/^[ \t]*benefitSelfReport:\s*body\.benefit_self_report,[ \t]*\r?$/m.test(HANDLER)) {
    fail('api/submit-lead.js no longer hands body.benefit_self_report to recordBenefitSelfReport() as received — the answer would be dropped');
  }
}

if (problems.length) {
  console.error('[allowlist-drift] FAILED — the front end can send values the server silently discards:\n');
  for (const p of problems) console.error('  • ' + p);
  console.error('\nFix the allow-list in api/submit-lead.js (or the producer), then re-run the build.');
  process.exit(1);
}
console.log(`[allowlist-drift] OK — lead_source (${LEAD_SOURCES.length}), lead_type (${LEAD_TYPES.length}) and medicare_status (${MEDICARE_STATUSES.length}) allow-lists cover every value the front end sends; ${benefitOptionCount} Smart Review benefit option(s) are server tokens.`);

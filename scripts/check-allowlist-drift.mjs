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
  }
}

// ── 3. The LeadForm coverage <select> options must be accepted. ──────────
{
  const form = readFileSync(join(root, 'src', 'components', 'LeadForm.tsx'), 'utf8');
  const select = form.match(/name="medicare_status"[\s\S]*?<\/select>/);
  if (select) {
    for (const [, value] of select[0].matchAll(/<option value="([^"]*)"/g)) {
      if (!value) continue;
      if (MEDICARE_STATUSES.indexOf(norm(value)) === -1) {
        fail(`the LeadForm coverage option "${value}" is not in the server MEDICARE_STATUSES allow-list`);
      }
    }
  }
}

// ── 4. Clara's MedicareStatus union must be accepted. ────────────────────
{
  const clara = readFileSync(join(root, 'src', 'lib', 'claraOuterFlow.ts'), 'utf8');
  const union = clara.match(/export type MedicareStatus\s*=\s*([^;]+);/);
  if (union) {
    for (const [, value] of union[1].matchAll(/'([^']+)'/g)) {
      if (MEDICARE_STATUSES.indexOf(norm(value)) === -1) {
        fail(`Clara's MedicareStatus value "${value}" is not in the server MEDICARE_STATUSES allow-list`);
      }
    }
  }
}

if (problems.length) {
  console.error('[allowlist-drift] FAILED — the front end can send values the server silently discards:\n');
  for (const p of problems) console.error('  • ' + p);
  console.error('\nFix the allow-list in api/submit-lead.js (or the producer), then re-run the build.');
  process.exit(1);
}
console.log(`[allowlist-drift] OK — lead_source (${LEAD_SOURCES.length}), lead_type (${LEAD_TYPES.length}) and medicare_status (${MEDICARE_STATUSES.length}) allow-lists cover every value the front end sends.`);

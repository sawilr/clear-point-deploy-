#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — PRE-LAUNCH PREFLIGHT.
//
// One command that answers "is this safe to promote, and what still blocks the
// SOA workflow?". Spec §34 Phase 10 wants a controlled deployment with the
// gates verified first; spec §30 wants a dependency/security scan before the
// public SOA endpoint launches (SEC-TOK-13).
//
//   node scripts/cy2027-preflight.mjs
//
// It is READ-ONLY: it inspects, it never changes configuration, never deploys
// and never writes to GoHighLevel. Exit code 1 means something listed as BLOCK
// is unresolved — not that you cannot deploy the SITE, but that the SOA
// workflow must stay off.
//
// Deliberately NOT part of `npm run build`. A new advisory landing upstream
// must not break an unrelated deploy; this is a decision gate a person runs,
// which is the same reason SOA_PRECONDITIONS is flipped by a person.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SOA_PRECONDITIONS, soaBlockers, SOA_ENABLED } from '../src/lib/soaContent.ts';
import { TPMO_DISCLAIMER_CONFIG, hasVerifiedTpmoCounts, tpmoDisclaimerText, activeContractYearVariant } from '../api/_lib/cy2027/tpmo.js';
import { configurationProblem } from '../api/_lib/cy2027/evidence-store.js';
import { fieldIdMap, CY2027_FIELD_KEYS } from '../api/_lib/cy2027/crm-fields.js';
import { overlayInventory } from '../api/_lib/cy2027/carrier-overlay.js';
import { hasCountyDataset } from '../api/_lib/cy2027/state-rules.js';
import { activePlanYear } from '../api/_lib/cy2027/rulesets.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const blocks = [];
const warns = [];
const oks = [];

const line = (s) => console.log(s);

// ── 1. Dependency / security scan (SEC-TOK-13) ───────────────────────────────
try {
  // shell:true — on Windows `npm` is npm.cmd and execFileSync cannot spawn it directly.
  const raw = execFileSync('npm audit --omit=dev --json', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true });
  const v = (JSON.parse(raw).metadata || {}).vulnerabilities || {};
  const bad = (v.high || 0) + (v.critical || 0);
  if (bad > 0) blocks.push(`npm audit: ${v.critical || 0} critical, ${v.high || 0} high in production dependencies`);
  else oks.push(`npm audit clean (moderate ${v.moderate || 0}, low ${v.low || 0})`);
} catch (e) {
  // `npm audit` exits non-zero when it finds anything; parse what it printed.
  const out = (e && (e.stdout || '')) + '';
  try {
    const v = (JSON.parse(out).metadata || {}).vulnerabilities || {};
    const bad = (v.high || 0) + (v.critical || 0);
    if (bad > 0) blocks.push(`npm audit: ${v.critical || 0} critical, ${v.high || 0} high in production dependencies`);
    else oks.push(`npm audit clean (moderate ${v.moderate || 0}, low ${v.low || 0})`);
  } catch { warns.push('npm audit could not be parsed — run it by hand before promoting'); }
}

// ── 2. The build's own gates ─────────────────────────────────────────────────
try {
  execFileSync(process.execPath, ['scripts/check-cy2027-parity.mjs'], { cwd: ROOT, stdio: 'ignore' });
  oks.push('CY2027 parity guard passes');
} catch { blocks.push('check-cy2027-parity failed — run it to see which copy drifted'); }

// ── 3. Plan year and the TPMO variant actually served ─────────────────────────
const year = activePlanYear();
const variant = activeContractYearVariant();
const en = tpmoDisclaimerText('en');
const shipMentioned = /State Health Insurance/i.test(en);
if (year >= 2027 && shipMentioned) blocks.push('CY2027 is in force but the rendered TPMO text still names the SHIP');
else oks.push(`plan year ${year}, TPMO variant ${variant} — rendered text matches`);
if (/\[X\]|\[Y\]/.test(en)) blocks.push('the rendered TPMO disclaimer contains a bracketed placeholder');

// IMPORTANT: the prerendered HTML freezes this at BUILD time.
warns.push('the TPMO text is frozen into the prerendered HTML at build time — a promote without a fresh build serves the previous year\'s wording');

// ── 4. What blocks enabling the SOA workflow ─────────────────────────────────
const blockers = soaBlockers();
line('');
line('SOA_ENABLED = ' + SOA_ENABLED);
for (const [k, v] of Object.entries(SOA_PRECONDITIONS)) line('  ' + (v ? '✓' : '✗') + ' ' + k);
if (blockers.length) warns.push(`SOA stays disabled: ${blockers.length} precondition(s) unmet — ${blockers.join(', ')}`);
else if (!SOA_ENABLED) warns.push('all SOA preconditions are met but SOA_ENABLED is still false — flip it deliberately');

// ── 5. Owner-supplied configuration ──────────────────────────────────────────
if (!hasVerifiedTpmoCounts()) {
  warns.push(`TPMO counts: ${TPMO_DISCLAIMER_CONFIG.status} — the count-less sentence renders until the FMO figures are approved`);
} else oks.push('TPMO counts verified');

const storeProblem = configurationProblem();
if (storeProblem) warns.push(`evidence store: ${storeProblem} — signing returns 503 and the marketing gate stays locked`);
else oks.push('evidence store configured (verify with scripts/cy2027-verify-evidence-store.mjs)');

const ids = fieldIdMap();
const total = Object.keys(CY2027_FIELD_KEYS).length;
if (Object.keys(ids).length < total) {
  warns.push(`CRM fields: ${Object.keys(ids).length}/${total} mapped — run scripts/cy2027-provision-crm-fields.mjs`);
} else oks.push(`CRM fields: ${total}/${total} mapped`);

const overlays = overlayInventory('LICENSED_AGENT_WORKSPACE');
const pending = overlays.filter((o) => /PENDING/.test(o.status));
if (pending.length) warns.push(`carrier overlays: ${pending.length}/${overlays.length} pending private verification — every carrier is blocked`);

if (!hasCountyDataset()) warns.push('no ZIP→county dataset installed — the form asks the beneficiary (fail-safe, but manual)');

// ── Report ───────────────────────────────────────────────────────────────────
line('');
for (const o of oks) line('  ✓ ' + o);
line('');
for (const w of warns) line('  ! ' + w);
if (blocks.length) {
  line('');
  for (const b of blocks) line('  ✗ ' + b);
  line('');
  line(`BLOCKED — ${blocks.length} item(s) must be resolved before promoting.`);
  process.exit(1);
}
line('');
line('No blocking item. The warnings above are owner decisions, not defects:');
line('each one keeps a gate CLOSED rather than letting something through.');
line('');
line('Promotion itself is still a human step: `vercel promote --yes` after a fresh build.');

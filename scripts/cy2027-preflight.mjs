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
//   node scripts/cy2027-preflight.mjs --url https://<preview-or-production-origin>
//
// With --url it also fetches every page in that origin's sitemap (GET only) and
// checks the TPMO disclaimer actually being SERVED against today's contract
// year. That is the only check that can see a stale deploy: a build made before
// the 1 October cut-over passes its own build gate and keeps serving last
// year's sentence until someone rebuilds.
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
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SOA_PRECONDITIONS, soaBlockers, SOA_ENABLED } from '../src/lib/soaContent.ts';
import { TPMO_DISCLAIMER_CONFIG, hasVerifiedTpmoCounts, tpmoDisclaimerText, activeContractYearVariant } from '../api/_lib/cy2027/tpmo.js';
import { configurationProblem } from '../api/_lib/cy2027/evidence-store.js';
import { fieldIdMap, CY2027_FIELD_KEYS } from '../api/_lib/cy2027/crm-fields.js';
import { overlayInventory } from '../api/_lib/cy2027/carrier-overlay.js';
import { hasCountyDataset } from '../api/_lib/cy2027/state-rules.js';
import { activePlanYear } from '../api/_lib/cy2027/rulesets.js';
import { yearlyReadiness } from '../api/_lib/cy2027/yearly-readiness.js';
import { checkTpmo, htmlToText, TPMO_ANY } from './tpmo-gate.mjs';

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

// ── 3a. The yearly engine (spec §22, Phase 12) ───────────────────────────────
// AUDIT 2026-10-04 (SPEC-22) — nothing announced a plan-year rollover. The clock
// used to answer "2027" forever, so the day CY2028 marketing opened the system
// would have kept applying CY2027 rules and wording without a sound. The clock
// is fixed; api/_lib/cy2027/yearly-readiness.js says what that leaves a person
// to do, and it is a pure function so the suite can run it on either side of a
// rollover instead of only "today".
// AUDIT 2026-10-04 (red team) — these four statements sat in a bare block, and
// the suite matched them as text: `if (false) {` on the line above left every
// assertion green. They are top-level statements now and the suite checks that
// with the parser — inside any block, branch or function they are not found.
const yearly = yearlyReadiness();
blocks.push(...yearly.blocks);
warns.push(...yearly.warns);
oks.push(...yearly.oks);

// ── 3b. What is BUILT and what is SERVED, judged against the clock NOW ────────
// RED TEAM 2026-10-03 (TPY-09) — the build gate compares a page to the module
// that rendered it, at the moment it rendered it. It cannot see the condition
// production was actually found in on 2026-10-02: HTML built before the cut-over
// and served after it. Only already-built HTML checked against TODAY'S variant
// shows that, so it is done here — on dist/, and with --url on a live origin.
const carriesTpmo = (text) => (text.match(TPMO_ANY) || []).length > 0;
{
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    warns.push('no dist/ build to inspect — the contract year of the BUILT pages was not checked (run `npm run build` first)');
  } else {
    const pages = [];
    const walk = (dir, route) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'assets' && name !== 'fonts' && name !== 'carriers') walk(full, route === '/' ? '/' + name : route + '/' + name);
        } else if (name === 'index.html') pages.push({ path: route, file: full });
      }
    };
    walk(dist, '/');
    let carrying = 0;
    const bad = [];
    for (const p of pages) {
      const text = htmlToText(readFileSync(p.file, 'utf8'));
      if (carriesTpmo(text)) carrying += 1;
      // thin:true — a page may legitimately omit the disclaimer (noindex, per-user
      // routes); what it may not do is carry another year's.
      bad.push(...checkTpmo({ path: p.path, text, thin: true, variant }));
    }
    if (!carrying) blocks.push(`dist/: none of ${pages.length} built page(s) carries a TPMO disclaimer — nothing to check, which is itself a failure`);
    else if (bad.length) blocks.push(`dist/ does not match contract year ${variant}: ${bad.length} problem(s), first: ${bad[0]} — rebuild before promoting`);
    else oks.push(`dist/: ${carrying} built page(s) carry the ${variant} TPMO sentence, none carries another year's`);
  }
}
{
  const i = process.argv.indexOf('--url');
  const origin = i > -1 ? String(process.argv[i + 1] || '').replace(/\/+$/, '') : '';
  if (i > -1 && !/^https:\/\/[^/\s]+$|^http:\/\/localhost(:\d+)?$/.test(origin)) {
    blocks.push('--url needs an https origin (or http://localhost:<port>), e.g. --url https://clearpoint-xyz.vercel.app');
  } else if (origin) {
    try {
      const sm = await fetch(origin + '/sitemap.xml', { redirect: 'follow' });
      if (!sm.ok) throw new Error('sitemap.xml answered ' + sm.status);
      const paths = [...(await sm.text()).matchAll(/<loc>\s*https?:\/\/[^/<\s]+([^<\s]*)\s*<\/loc>/g)].map((m) => m[1] || '/');
      if (!paths.length) throw new Error('sitemap.xml lists no pages');
      let carrying = 0;
      const bad = [];
      for (const path of paths) {
        const r = await fetch(origin + path, { redirect: 'follow' });
        if (!r.ok) { bad.push(`${path}: answered ${r.status}`); continue; }
        const text = htmlToText(await r.text());
        if (carriesTpmo(text)) carrying += 1;
        bad.push(...checkTpmo({ path, text, thin: true, variant }));
      }
      if (!carrying) blocks.push(`${origin}: none of ${paths.length} served page(s) carries a TPMO disclaimer`);
      else if (bad.length) blocks.push(`${origin} is serving another contract year (expected ${variant}): ${bad.length} problem(s), first: ${bad[0]}`);
      else oks.push(`${origin}: ${carrying}/${paths.length} served page(s) carry the ${variant} TPMO sentence, none carries another year's`);
    } catch (e) {
      blocks.push(`${origin} could not be inspected: ${e && e.message ? e.message : String(e)}`);
    }
  } else {
    warns.push('what is being SERVED was not checked — pass --url <origin> (the preview you are about to promote, then production) to verify the deployed TPMO sentence');
  }
}

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

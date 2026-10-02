#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CY2027 PARITY / CHANGE-CONTROL GUARD — runs in `npm run build`.
//
// The CY2027 layer has one canonical source (api/_lib/cy2027/). This guard is
// what keeps it canonical. It fails the build when:
//
//   1. The approved customer-facing SOA text changed without the pinned digest
//      being deliberately re-pinned in the same commit.
//   2. The CY2027 marketing-start instant diverges between the ruleset engine
//      and src/lib/tpmoConfig.ts.
//   3. The SOA_ENABLED mirrors disagree across the four files that carry one.
//   4. A .d.ts promises an export the .js does not have (client would get a
//      runtime undefined that TypeScript swore was there).
//   5. The approved category wording is copy-pasted somewhere else, which is
//      how the TPMO disclaimer ended up in three divergent versions.
//
// Why a build guard and not a comment: the pre-existing comment in
// src/lib/soaContent.ts said the three TPMO sources "must be unified first",
// and they stayed un-unified for months. A comment is not a control.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const problems = [];
const notes = [];

// ── 1. Approved text digest ──────────────────────────────────────────────────
const soaText = await import('../api/_lib/cy2027/soa-text.js');
const computed = 'sha256:' + createHash('sha256').update(soaText.approvedTextPayload(), 'utf8').digest('hex');

if (soaText.APPROVED_TEXT_DIGEST === 'sha256:PENDING_FIRST_PIN') {
  problems.push(
    'APPROVED_TEXT_DIGEST is still the placeholder. Pin it in api/_lib/cy2027/soa-text.js:\n' +
      `      export const APPROVED_TEXT_DIGEST = '${computed}';`,
  );
} else if (soaText.APPROVED_TEXT_DIGEST !== computed) {
  problems.push(
    'The approved customer-facing SOA text CHANGED but APPROVED_TEXT_DIGEST was not re-pinned.\n' +
      `      pinned:   ${soaText.APPROVED_TEXT_DIGEST}\n` +
      `      computed: ${computed}\n` +
      '      This text is owner-approved compliance wording. If the change is intended and approved,\n' +
      '      re-pin the digest in the same commit so the edit is on the record.',
  );
} else {
  notes.push(`approved SOA text digest OK (${computed.slice(0, 23)}…)`);
}

// ── 2. CY2027 marketing-start instant ────────────────────────────────────────
// The TPMO module must DERIVE this from the ruleset engine, not restate it.
// A second Date.UTC(...) literal is how the two would silently drift apart on
// the one day of the year when the drift matters.
const rulesets = await import('../api/_lib/cy2027/rulesets.js');
const tpmo = await import('../api/_lib/cy2027/tpmo.js');
const tpmoJs = read('api/_lib/cy2027/tpmo.js');

if (/CY2027_MARKETING_START_UTC\s*=\s*Date\.UTC\(/.test(tpmoJs)) {
  problems.push(
    'api/_lib/cy2027/tpmo.js redefines CY2027_MARKETING_START_UTC with its own Date.UTC(...).\n' +
      '      It must import the value from ./rulesets.js so there is one instant, not two.',
  );
} else if (tpmo.CY2027_MARKETING_START_UTC !== rulesets.CY2027_MARKETING_START_UTC) {
  problems.push(
    'CY2027 marketing-start instant diverged at runtime:\n' +
      `      rulesets.js: ${new Date(rulesets.CY2027_MARKETING_START_UTC).toISOString()}\n` +
      `      tpmo.js:     ${new Date(tpmo.CY2027_MARKETING_START_UTC).toISOString()}`,
  );
} else {
  notes.push(`CY2027 marketing start has one source (${new Date(rulesets.CY2027_MARKETING_START_UTC).toISOString()})`);
}

// The client entry point must re-export, not re-declare.
const tpmoConfigSrc = read('src/lib/tpmoConfig.ts');
if (/^\s*export\s+(?:const|function)\s+(?:tpmoDisclaimerText|activeContractYearVariant|TPMO_DISCLAIMER_CONFIG)\b/m.test(tpmoConfigSrc)) {
  problems.push(
    'src/lib/tpmoConfig.ts declares its own copy of the TPMO logic again.\n' +
      '      It must stay a re-export of api/_lib/cy2027/tpmo.js.',
  );
} else {
  notes.push('src/lib/tpmoConfig.ts is a re-export, not a second implementation');
}

// ── 3. SOA_ENABLED mirrors ───────────────────────────────────────────────────
const MIRRORS = [
  'src/lib/soaContent.ts',
  'api/soa-token.js',
  'api/soa-status.js',
  'api/sign-soa.js',
];
const values = new Map();
for (const f of MIRRORS) {
  let txt;
  try { txt = read(f); } catch { problems.push(`SOA_ENABLED mirror missing: ${f}`); continue; }
  const mm = txt.match(/SOA_ENABLED\s*=\s*(true|false)\b/);
  if (!mm) { problems.push(`${f} no longer declares SOA_ENABLED = true|false.`); continue; }
  values.set(f, mm[1] === 'true');
}
const distinct = new Set(values.values());
if (distinct.size > 1) {
  problems.push(
    'SOA_ENABLED mirrors disagree — the UI and the API would take different branches:\n' +
      [...values].map(([f, v]) => `      ${v ? 'true ' : 'false'}  ${f}`).join('\n'),
  );
} else if (distinct.size === 1) {
  notes.push(`SOA_ENABLED agrees across ${values.size} files (${[...distinct][0]})`);
}

// ── 4. .d.ts promises vs .js reality ─────────────────────────────────────────
const DECLARED = ['soa-text', 'state-rules', 'soa-instance', 'rulesets'];
for (const base of DECLARED) {
  const dts = read(`api/_lib/cy2027/${base}.d.ts`);
  const mod = await import(`../api/_lib/cy2027/${base}.js`);
  const names = [...dts.matchAll(/export\s+declare\s+(?:const|function)\s+(\w+)/g)].map((x) => x[1]);
  const missing = names.filter((n) => !(n in mod));
  if (missing.length) {
    problems.push(`${base}.d.ts declares exports that ${base}.js does not provide: ${missing.join(', ')}`);
  }
}
notes.push(`${DECLARED.length} declaration files match their modules`);

// ── 5. Approved wording must not be copy-pasted ──────────────────────────────
// A distinctive fragment of each approved category description. If any of these
// appears outside the canonical module, a second copy is forming.
const FRAGMENTS = [
  'but does not include integrated Medicare prescription drug coverage',
  'apart from a Medicare Advantage plan',
  'does not authorize discussion of product categories you did not select',
  'no autoriza conversar sobre categorías que usted no seleccionó',
];
const SEARCH_FILES = [
  'src/lib/soaContent.ts',
  'src/components/SOAForm.tsx',
  'api/sign-soa.js',
  'src/lib/soa.ts',
];
for (const f of SEARCH_FILES) {
  let txt;
  try { txt = read(f); } catch { continue; }
  for (const frag of FRAGMENTS) {
    if (txt.includes(frag)) {
      problems.push(
        `${f} contains a copy of approved CY2027 SOA wording ("${frag.slice(0, 44)}…").\n` +
          '      Import it from api/_lib/cy2027/soa-text.js instead — that is the whole point of the canonical module.',
      );
    }
  }
}

// ── 6. TPMO disclaimer must live in exactly one place ────────────────────────
// Pre-existing defect this guard is meant to surface: the (e)(41) sentence
// exists in src/lib/tpmoConfig.ts (correct, variant-aware) AND as a second
// hardcoded copy with [X]/[Y] placeholders elsewhere.
const TPMO_FRAGMENT = 'We do not offer every plan available in your area';
const TPMO_ALLOWED = new Set(['api/_lib/cy2027/tpmo.js']);
const TPMO_CANDIDATES = [
  'api/_lib/cy2027/tpmo.js',
  'src/lib/tpmoConfig.ts',
  'src/lib/soaContent.ts',
  'api/sign-soa.js',
];
const tpmoCopies = [];
for (const f of TPMO_CANDIDATES) {
  let txt;
  try { txt = read(f); } catch { continue; }
  if (txt.includes(TPMO_FRAGMENT) && !TPMO_ALLOWED.has(f)) tpmoCopies.push(f);
}
if (tpmoCopies.length) {
  problems.push(
    'The TPMO (e)(41) disclaimer is duplicated outside src/lib/tpmoConfig.ts:\n' +
      tpmoCopies.map((f) => `      ${f}`).join('\n') +
      '\n      A signed disclaimer that disagrees with the rendered one is an audit failure.\n' +
      '      Render it from tpmoDisclaimerText() in src/lib/tpmoConfig.ts (client) or from the\n' +
      '      value passed in by the caller (server) — never from a second literal.',
  );
} else {
  notes.push('TPMO disclaimer has a single source');
}

// ── Report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('\n✗ check-cy2027-parity: ' + problems.length + ' problem(s)\n');
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  process.exit(1);
}
console.log('✓ check-cy2027-parity: ' + notes.length + ' check(s) passed');
notes.forEach((n) => console.log('    · ' + n));

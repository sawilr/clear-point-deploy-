// Wave 50 — Ship Gate. Single command. PASS or FAIL.
//
// What this runs:
//   1. All prior-wave regression suites (V21, V44, V45, V46, V47, V48, V49)
//   2. Classifier adversarial gate (clean ≥95% per intent, misclass ≤5%)
//   3. 50-scenario conversation simulator
//   4. Production TypeScript build
//
// Output: GATE PASS / FAIL with per-section results and ≤20 failure samples.

import { spawn } from 'node:child_process';

const SUITES = [
  { name: 'V21 enterprise',            path: 'scripts/test-customer-service-v21.mjs',                        weight: 90 },
  { name: 'V44 ZIP bill fix',          path: 'scripts/test-customer-service-v44-zip-bill-fix.mjs',           weight: 19 },
  { name: 'V45 flow fixes',            path: 'scripts/test-customer-service-v45-flow-fixes.mjs',             weight: 23 },
  { name: 'V46 no fallbacks',          path: 'scripts/test-customer-service-v46-no-fallbacks.mjs',           weight: 249 },
  { name: 'V47 lead qual',             path: 'scripts/test-customer-service-v47-lead-qual.mjs',              weight: 209 },
  { name: 'V48 mega coverage',         path: 'scripts/test-customer-service-v48-mega-coverage.mjs',          weight: 471 },
  { name: 'V49 savings + menuloop',    path: 'scripts/test-customer-service-v49-savings-menuloop.mjs',       weight: 122 },
  { name: 'V50 classifier adversarial',path: 'scripts/test-classifier-adversarial.mjs',                      weight: 0 },
  { name: 'V50 conversation simulator',path: 'scripts/test-conversation-simulator.mjs',                      weight: 0 },
  { name: 'V50 human probe (50+ flows)',path: 'scripts/human-probe.mjs',                                      weight: 0 },
  { name: 'V50 bilingual parity (49 pairs)',path: 'scripts/bilingual-parity-probe.mjs',                       weight: 0 },
  { name: 'V52 mega probe (120 flows)', path: 'scripts/mega-probe.mjs',                                       weight: 0 },
];

function runOne(path) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', path], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => out += d.toString());
    child.stderr.on('data', (d) => err += d.toString());
    child.on('exit', (code) => resolve({ code, out, err }));
  });
}

console.log('═'.repeat(80));
console.log('  SHIP GATE — Wave 50 (real system, not patches)');
console.log('═'.repeat(80));

const results = [];
for (const s of SUITES) {
  process.stdout.write(`  Running ${s.name.padEnd(40)} `);
  const r = await runOne(s.path);
  const passLine = r.out.split('\n').find((l) => /passed/.test(l)) || '';
  const okMatch = passLine.match(/(\d+) \/ (\d+) assertions/);
  const gateLine = r.out.split('\n').find((l) => /GATE:/i.test(l)) || '';
  const status = r.code === 0 ? '✓ PASS' : '✗ FAIL';
  console.log(`${status}  ${passLine.trim() || gateLine.trim()}`);
  results.push({ ...s, code: r.code, out: r.out, err: r.err, line: passLine.trim() });
}

// Build check
console.log('\n  Running production build                ');
process.stdout.write('    ');
const buildResult = await new Promise((resolve) => {
  const child = spawn('npm', ['run', 'build'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  child.stdout.on('data', (d) => out += d.toString());
  child.stderr.on('data', (d) => err += d.toString());
  child.on('exit', (code) => resolve({ code, out, err }));
});
const buildOk = buildResult.code === 0;
console.log(buildOk ? '✓ PASS (TypeScript + Vite)' : '✗ FAIL (build error)');

// ─── DECISION ───────────────────────────────────────────────────────────────
const allSuitesOk = results.every((r) => r.code === 0);
const overallOk = allSuitesOk && buildOk;

console.log();
console.log('═'.repeat(80));
console.log(`  SHIP GATE: ${overallOk ? 'PASS  ✓' : 'FAIL  ✗'}`);
console.log('═'.repeat(80));

if (!overallOk) {
  console.log('\n  WHAT BLOCKED:');
  for (const r of results.filter((r) => r.code !== 0)) {
    console.log(`    ✗ ${r.name}`);
    const failureLines = r.out.split('\n').filter((l) => /✗/.test(l)).slice(0, 5);
    for (const f of failureLines) console.log(`        ${f.trim()}`);
  }
  if (!buildOk) {
    console.log(`    ✗ Build failed:`);
    const last = buildResult.err.split('\n').slice(-10).join('\n');
    console.log(last);
  }
}

process.exit(overallOk ? 0 : 1);

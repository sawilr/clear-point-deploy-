// AUDIT 2026-09-12 (CODE-05) — `npm test`: the deterministic regression battery
// documented in docs/conversational-platform/TEST-PLAN.md, run in one command.
// Every suite in SUITES is offline (no production calls, no LLM spend). Exit 1 on
// any failure. LIVE_SUITES hit the deployed API (fake identifiers, validation-only
// payloads) and trip its per-IP rate limit when repeated — they run only with
// CP_LIVE=1 (post-deploy smoke), never as part of the default `npm test`.
import { spawnSync } from 'node:child_process';

const LIVE_SUITES = [
  'test-optout-validation-2026-08-27.mjs',
];
const SUITES = [
  'test-clara-routing.mjs',
  'test-chat-wiring-2026-08-13.mjs',
  'test-audit-regressions.mjs',
  'test-mega-corpus-2026-08-27.mjs',
  'test-emergency-dos-2026-08-15.mjs',
  'test-clara-emergency-adversarial-2026-08-18.mjs',
  'test-cardiac-detection-2026-08-18.mjs',
  'test-safety-parity-server-2026-08-27.mjs',
  'test-entity-scope-2026-08-15.mjs',
  'test-multiturn-recovery-2026-08-27.mjs',
  'test-optout-lead02-authz-2026-08-18.mjs',
  'test-submit-lead-security-2026-08-15.mjs',
  'test-redteam-openai-r2-2026-08-14.mjs',
  'test-clara-completion-2026-08-13.mjs',
  'test-scope-router-2026-08-28.mjs',
  'test-master-spec-corpus-2026-08-28.mjs',
  'test-fmo-r2-2026-09-03.mjs',
  'test-c9-consent-logic-2026-09-03.mjs',
  'test-c10-split-injection-2026-09-03.mjs',
  'test-c11-emergency-redteam-2026-09-03.mjs',
  'test-plan-guidance-2026-09-03.mjs',
  'test-medicare-figures-2026-08-18.mjs',
  'test-cp03-clinical-2026-08-13.mjs',
  'test-falsepos-rules13-17-2026-08-13.mjs',
  'test-customer-service-language-lock.mjs',
  'test-compliance-filter-r3-2026-09-13.mjs',
  'test-submit-lead-r3-2026-09-13.mjs',
];

const only = process.argv.slice(2);
const all = process.env.CP_LIVE === '1' ? [...SUITES, ...LIVE_SUITES] : SUITES;
const list = only.length ? all.filter((s) => only.some((o) => s.includes(o))) : all;
if (process.env.CP_LIVE !== '1') console.log(`(skipping ${LIVE_SUITES.length} live suite(s) — set CP_LIVE=1 after a deploy to run them)`);
let failed = 0;
const t0 = Date.now();
for (const s of list) {
  const started = Date.now();
  const r = spawnSync('npx', ['tsx', `scripts/${s}`], { shell: true, encoding: 'utf8', timeout: 15 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = out.split('\n').reverse().find((l) => /passed|PASS|assertions|checks|RESULT/i.test(l) && l.trim()) || '';
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.padEnd(52)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${summary.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 90)}`);
  if (!ok) console.log(out.split('\n').filter((l) => /✗|FAIL|Error|error/.test(l)).slice(0, 8).map((l) => '      ' + l.trim().slice(0, 160)).join('\n'));
}
console.log(`\n${list.length - failed}/${list.length} suites passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);

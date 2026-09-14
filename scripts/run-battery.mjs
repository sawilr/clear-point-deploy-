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
  'test-emergency-postcondition-2026-09-14.mjs',
  'test-dob-redaction-2026-09-14.mjs',
  'test-medicare-figures-r5-2026-09-14.mjs',
  'test-figures-year-scope-r5-2026-09-14.mjs',
  'test-compliance-filter-r5-2026-09-14.mjs',
  'test-lead-intel-metadata-r5-2026-09-14.mjs',
  'test-submit-lead-r5-2026-09-14.mjs',
  'test-consent-classifier-r5-2026-09-14.mjs',
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
  //
  // RED TEAM ROUND 6 (RT6-13, P2). The exit status was the only signal, and the
  // runner printed the suite's own "0/3 checks passed, 3 FAILED" line right next
  // to the word PASS without reading it. Two ways a suite reported green while
  // asserting nothing: it forgot process.exit(1) after printing its failures, and
  // its fixture array was empty so it printed "0/0 assertions passed". A suite
  // whose fixtures vanish must not be able to report success.
  //
  // The summary line is evidence now: a zero total, a pass count below the total,
  // or a failure marker anywhere in the output fails the suite whatever it
  // exited with.
  const clean = summary.replace(/\x1b\[[0-9;]*m/g, '');
  const counts = clean.match(/(\d+)\s*(?:\/|of)\s*(\d+)/) || clean.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  let evidenceOk = true;
  let why = '';
  if (counts) {
    const a = Number(counts[1]), b = Number(counts[2]);
    // "12/12 passed" and "RESULT: 12 passed, 0 failed" are both matched above;
    // the first form means a-of-b, the second means a passed and b failed.
    const isResultForm = /RESULT:\s*\d+\s+passed/i.test(clean);
    if (isResultForm) { if (b > 0) { evidenceOk = false; why = `${b} reported failures`; } if (a === 0) { evidenceOk = false; why = 'asserted nothing'; } }
    else { if (b === 0) { evidenceOk = false; why = 'asserted nothing'; } else if (a < b) { evidenceOk = false; why = `${b - a} reported failures`; } }
  }
  if (/\bFAILED\b|\bFAILURES\b|AssertionError|✗/.test(out) && !/0\s+failed|FAILURES:\s*$/i.test(clean)) {
    if (r.status === 0 && evidenceOk) { evidenceOk = false; why = 'failure markers in the output'; }
  }
  const ok = r.status === 0 && evidenceOk;
  if (!ok) failed++;
  if (r.status === 0 && !evidenceOk) console.log(`      (exit 0 but ${why} — the runner does not take a suite's word for it)`);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.padEnd(52)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${summary.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 90)}`);
  if (!ok) console.log(out.split('\n').filter((l) => /✗|FAIL|Error|error/.test(l)).slice(0, 8).map((l) => '      ' + l.trim().slice(0, 160)).join('\n'));
}
console.log(`\n${list.length - failed}/${list.length} suites passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);

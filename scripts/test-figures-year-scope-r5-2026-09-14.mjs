// scripts/test-figures-year-scope-r5-2026-09-14.mjs
//
// RED TEAM ROUND 5 — RT5-MED-02 (P1) and RT5-MED-10 (P3).
//
// The numeric backstop must never rewrite a figure that belongs to another
// contract year. For a list item with no year of its own, the year comes from
// the heading above it. Round 4 found that heading by walking upward under three
// budgets: 60 lines, 5 blank lines, 4,000 characters. Running out of budget was
// read as "no other year found", which means "this is our year, rewrite it".
//
// The measured edges were exact and absurd: 59 intervening list lines kept a
// 2027 figure safe and 60 rewrote it; 4 blank lines safe, 5 rewrote; 3,830
// characters safe, 4,030 rewrote. On a 4,000-line list under a "2027 figures:"
// heading, 3,717 lines came back rewritten to 2026 values — line 60 read $300
// and line 61 read $283. The same walk was quadratic: a 124 KB reply took
// 1,262 ms against a 200 ms budget.
//
// This suite pins the boundaries the old walk failed at, well past them, and the
// time bound.

import { verifyMedicareFigures } from '../api/_lib/medicare-figures.js';

let passed = 0;
const failures = [];

function keeps(label, input, mustStillContain) {
  const r = verifyMedicareFigures(input);
  const lost = mustStillContain.filter((frag) => !r.text.includes(frag));
  if (!lost.length && (r.corrections || []).length === 0) { passed++; return; }
  failures.push(
    `${label}\n    corrections: ${JSON.stringify(r.corrections)}\n` +
    `    lost: ${lost.join(', ')}\n    head: ${JSON.stringify(r.text.slice(0, 200))}`
  );
}

function corrects(label, input, concept) {
  const r = verifyMedicareFigures(input);
  if ((r.corrections || []).some((c) => c.concept === concept)) { passed++; return; }
  failures.push(`${label}\n    expected a ${concept} correction, got ${JSON.stringify(r.corrections)}`);
}

const filler = (n) => Array.from({ length: n }, (_, i) => `- note line ${i + 1}`).join('\n');

// ── Intervening list lines: 59 worked, 60 did not. Both must work now. ────
for (const n of [59, 60, 120, 500]) {
  keeps(
    `2027 heading survives ${n} intervening lines`,
    `2027 figures:\n${filler(n)}\n- Part B deductible: $300`,
    ['$300']
  );
}

// ── Blank lines: 4 worked, 5 did not. ────────────────────────────────────
for (const n of [4, 5, 12]) {
  keeps(
    `2027 heading survives ${n} blank lines`,
    `2027 figures:${'\n'.repeat(n + 1)}- Part B deductible: $300`,
    ['$300']
  );
}

// ── Character budget: 3,830 worked, 4,030 did not. ───────────────────────
for (const chars of [380, 400, 900]) {
  const bulk = Array.from({ length: 10 }, (_, i) => '- ' + 'x'.repeat(chars - 2)).join('\n');
  keeps(
    `2027 heading survives ~${chars * 10} characters of list`,
    `2027 figures:\n${bulk}\n- Part B deductible: $300`,
    ['$300']
  );
}

// ── The scale case: a long list under one heading, every line protected. ──
{
  const N = 1500;
  const body = Array.from({ length: N }, (_, i) => `- Part B deductible ${i + 1}: $300`).join('\n');
  const r = verifyMedicareFigures(`2027 figures:\n${body}`);
  const rewritten = (r.text.match(/\$283/g) || []).length;
  if (rewritten === 0 && (r.corrections || []).length === 0) passed++;
  else failures.push(`${N}-line 2027 list: ${rewritten} lines rewritten, ${(r.corrections || []).length} corrections`);
}

// ── Our own year under a heading must still be corrected. ────────────────
corrects('2026 heading still corrects a wrong figure',
  `2026 figures:\n${filler(120)}\n- Part B deductible: $257`, 'part_b_deductible');
corrects('2026 heading, long list, wrong figure deep in it',
  `2026 figures:\n${filler(400)}\n- Part D out-of-pocket cap: $8,000`, 'part_d_oop_cap');

// ── A later heading overrides an earlier one. ────────────────────────────
keeps('a 2027 heading after a 2026 block governs what follows it',
  '2026 figures:\n- Part B deductible: $283\n\n2027 figures:\n- Part B deductible: $300',
  ['$283', '$300']);
corrects('the 2026 block under the FIRST heading is still corrected',
  '2026 figures:\n- Part B deductible: $257\n\n2027 figures:\n- Part B deductible: $300', 'part_b_deductible');

// ── RT5-MED-10: the time bound. ──────────────────────────────────────────
{
  const BIG = ('2026 figures:\n' + Array.from({ length: 2000 }, (_, i) =>
    `- line ${i}: the Part B deductible is $283 and the Part D out-of-pocket cap is $2,100`).join('\n'));
  const kb = Math.round(BIG.length / 1024);
  const t0 = Date.now();
  verifyMedicareFigures(BIG);
  const ms = Date.now() - t0;
  // Generous: the original defect measured 1,262 ms on 124 KB. A linear pass is
  // far under this; the assertion exists to catch a return to quadratic.
  if (ms < 2000) { passed++; }
  else failures.push(`perf: ${kb} KB took ${ms} ms (budget 2000 ms) — the year walk may be quadratic again`);
  console.log(`  (perf probe: ${kb} KB verified in ${ms} ms)`);
}

if (failures.length) {
  console.error(`FIGURES YEAR SCOPE R5: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

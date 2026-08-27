// MEDICARE NUMERIC-INTEGRITY SUITE — CLARA-MED-03 (2026-08-18)
//
// Deliberate ratio (guardrail-verification rule): a capture-only suite is half a
// suite. CAPTURE = wrong definitive figures get corrected; SURVIVAL = correct /
// variable / IRMAA / historical figures pass BYTE-IDENTICAL. A backstop that
// rewrites legitimate nuance is worse than the gap it closes.
//
// Run: npx tsx scripts/test-medicare-figures-2026-08-18.mjs   (or: node ...)
import { verifyMedicareFigures, MEDICARE_FIGURES_2026 } from '../api/_lib/medicare-figures.js';

const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
let pass = 0; const fails = [];
const check = (id, cond, why) => { if (cond) { pass++; } else { fails.push(id + (why ? ' — ' + why : '')); } };

// ── CAPTURE — a wrong definitive single-value figure must be corrected ────────
const CAPTURE = [
  ['Part B deductible wrong (2025 value)', 'The Part B annual deductible is $257 for everyone.', '$283', 'part_b_deductible'],
  ['Part B deductible invented', 'For Part B, the deductible is $300.', '$283', 'part_b_deductible'],
  ['Part B deductible ES', 'El deducible anual de la Parte B es $250.', '$283', 'part_b_deductible'],
  ['Part A hospital deductible wrong', 'The Part A inpatient hospital deductible is $1,632 per benefit period.', '$1,736', 'part_a_hospital_deductible'],
  ['Part A hospital deductible ES', 'El deducible del hospital de la Parte A es $1,600 por período de beneficios.', '$1,736', 'part_a_hospital_deductible'],
  ['Part D OOP cap wrong', 'Once you reach the Part D out-of-pocket cap of $2,000, you pay nothing.', '$2,100', 'part_d_oop_cap'],
  ['Part D OOP cap ES', 'Cuando llega al tope de bolsillo de la Parte D de $3,300, ya no paga.', '$2,100', 'part_d_oop_cap'],
  ['Part B standard premium wrong', 'The standard Part B premium is $185 a month for most people.', '$202.90', 'part_b_standard_premium'],
  ['Part B standard premium ES', 'La prima estándar de la Parte B es $174 al mes para la mayoría.', '$202.90', 'part_b_standard_premium'],
];
for (const [id, input, expectContains, concept] of CAPTURE) {
  const r = verifyMedicareFigures(input);
  const corrected = r.text.includes(expectContains) && r.corrections.some((c) => c.concept === concept);
  check('CAP ' + id, corrected, 'got: "' + r.text + '" corrections=' + JSON.stringify(r.corrections));
}

// ── SURVIVAL — correct / variable / adjusted figures pass BYTE-IDENTICAL ───────
const SURVIVE = [
  ['Part B deductible correct', 'The Part B annual deductible is $283 in 2026.'],
  ['Part A deductible correct', 'The Part A hospital deductible is $1,736 per benefit period.'],
  ['Part D cap correct', 'The Part D out-of-pocket cap is $2,100 this year.'],
  ['Part B premium correct', 'The standard Part B premium is $202.90 a month.'],
  ['IRMAA premium (legitimately higher)', 'Your Part B premium could be higher than $259 depending on your income (IRMAA).'],
  ['IRMAA premium 2', 'With higher income, the Part B premium may be $370 instead of the standard amount.'],
  ['Historical comparison', 'The Part B deductible was $257 in 2025 but is $283 now.'],
  ['Part D plan deductible (variable, max $615)', "Your plan's Part D deductible might be $480, up to a maximum of $615."],
  ['Part A premium tiers', 'Most people pay $0 for Part A; it is $311 or $565 a month depending on work quarters.'],
  ['Caller-stated bill (not a Medicare figure)', 'You said your hospital bill was $1,600 — let me help you prepare it for review.'],
  ['Caller-stated premium (their own number)', 'You mentioned they take about $250 from your check each month.'],
  ['Part A coinsurance (variable/daily)', 'Part A hospital coinsurance is $434 a day for days 61-90.'],
  ['Income figure', 'With an income around $1,700 a month, it may be worth reviewing help programs.'],
  ['Part D max deductible stated as max', 'A Part D plan can charge up to a $615 deductible, or less.'],
  ['No dollar figure at all', 'The Part B deductible resets every January — a licensed advisor can confirm the exact amount.'],
];
for (const [id, input] of SURVIVE) {
  const r = verifyMedicareFigures(input);
  check('SURV ' + id, r.text === input && r.corrections.length === 0, 'MUTATED to: "' + r.text + '" corrections=' + JSON.stringify(r.corrections));
}

// ── RED-TEAM — adversarial edge cases ─────────────────────────────────────────
// A wrong Part B deductible + a correct Part A deductible in one reply: fix only B.
{
  const r = verifyMedicareFigures('The Part B deductible is $257 and the Part A hospital deductible is $1,736.');
  check('RT mixed: only the wrong one corrected', r.text.includes('$283') && r.text.includes('$1,736') && r.corrections.length === 1, 'got: "' + r.text + '"');
}
// Fail-safe: never throws / never empties on junk input.
check('RT null input safe', verifyMedicareFigures(null).text === '' , 'null not handled');
check('RT non-string safe', verifyMedicareFigures(42).text === '', 'number not handled');
check('RT empty stays empty', verifyMedicareFigures('').text === '', 'empty broke');
// Cross-part confusion must NOT trigger (Part D deductible is not Part B's).
{
  const r = verifyMedicareFigures('The Part D deductible on your plan is $257.');
  check('RT Part D deductible not corrected to Part B value', r.text === 'The Part D deductible on your plan is $257.' && r.corrections.length === 0, 'wrongly touched: ' + JSON.stringify(r.corrections));
}
// Source of truth sanity.
check('SOT Part B premium = 202.90', MEDICARE_FIGURES_2026.part_b_standard_premium.value === 202.90);
check('SOT Part B deductible = 283', MEDICARE_FIGURES_2026.part_b_deductible.value === 283);
check('SOT Part A deductible = 1736', MEDICARE_FIGURES_2026.part_a_hospital_deductible.value === 1736);
check('SOT Part D cap = 2100', MEDICARE_FIGURES_2026.part_d_oop_cap.value === 2100);

console.log('MEDICARE NUMERIC-INTEGRITY (CLARA-MED-03) — ' + new Date().toISOString());
console.log('Ratio: ' + CAPTURE.length + ' capture / ' + SURVIVE.length + ' survival / + red-team');
console.log('═══════════════════════════════════════');
console.log((fails.length === 0 ? GRN : RED)('RESULT: ' + pass + ' passed, ' + fails.length + ' failed'));
if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log('  • ' + RED(f))); }
process.exit(fails.length === 0 ? 0 : 1);

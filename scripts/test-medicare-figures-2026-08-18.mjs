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
  // AUDIT 2026-09-12 (MED-02/AI-01, P1) — next-year figures published in the fall
  // must NEVER be rewritten back to the current-year values.
  ['2027 Part D cap (next year)', 'For 2027, the Part D out-of-pocket cap will be $2,400.'],
  ['2027 Part B premium (next year)', 'Starting January 2027 the standard Part B premium is $215.00 for most people.'],
  ['2027 Part B deductible (next year)', 'In 2027 the Part B deductible will be $300.'],
  ['2027 Part D cap ES (next year)', 'Para 2027, el tope de gastos de bolsillo de la Parte D será $2,400.'],
  ['Next year phrasing without a digit year', 'Next year the Part B deductible goes up to $300, according to CMS.'],
  // Red-team 2026-09-13 (MED02-RT-02/03) — paragraph-scoped and unlisted next-year phrasings.
  ['2027 header + spaced list', '2027 figures (published today):\n\n- Part B premium: $215.00 standard\n- Part B deductible: $300\n- Part D cap: $2,400'],
  ['CY prefix', 'CY2027 Part B deductible: $300.'],
  ['Starting January without year', 'Starting January the standard Part B premium is $215.00 for most people.'],
  ['ES el año que viene', 'El año que viene el deducible de la Parte B será $300.'],
  ['ES a partir de enero', 'A partir de enero el tope de la Parte D será $2,400.'],
  ['Mixed years — 2027 sentence, 2026 correct sentence', 'For 2027 the Part D cap will be $2,400. For 2026 it is $2,100.'],
  // Red-team round 2 (MED02-RT2-01/05) — decimals inside amounts and spelled-out years.
  ['Decimal + IRMAA marker after the amount', 'The standard Part B premium is $259.00 if your income is higher.'],
  ['ES decimal + IRMAA', 'La prima estándar de la Parte B es $259.00 si su ingreso es más alto.'],
  // ("$2,000.00, up to which…" moved to CAPTURE_RT in round 3: the marker follows
  //  the amount, so it qualifies the clause after it, not the cap itself.)
  ['Two sentences, 2026 then 2027 decimal', 'For 2026 the standard Part B premium is $202.90. The standard Part B premium is $215.00 for most people in 2027.'],
  ['Spelled-out year EN', 'For twenty twenty-seven, the Part B deductible will be $300.'],
  ['Spelled-out year ES', 'En dos mil veintisiete el deducible de la Parte B será $300.'],
  ['come January', 'Come January the Part B deductible goes to $300.'],
  // ── Red-team round 3 (MED02-RT3-01..16) ──────────────────────────────────────
  // Next-year lists inherit the heading's year, whatever their line shape.
  ['RT3 heading + blank line + single bullet', '2027 figures (published today):\n\n- Part B deductible: $300'],
  ['RT3 heading + bullet ending in a period', '2027 figures:\n- Part B deductible: $300.'],
  ['RT3 heading + numbered list', '2027 figures:\n1. Part B deductible: $300\n2. Part D cap: $2,400'],
  ['RT3 comparison table (2026 | 2027)', '| Item | 2026 | 2027 |\n|---|---|---|\n| Part B deductible | $283 | $300 |\n| Part D cap | $2,100 | $2,400 |'],
  // Prose that states a FUTURE change inherits the paragraph's year.
  ['RT3 prose future after a 2027 sentence', 'CMS announced the 2027 figures today. The Part B deductible will be $300 and the Part D cap will be $2,400.'],
  ['RT3 prose future ES', 'CMS publicó las cifras de 2027. El deducible de la Parte B será $300.'],
  // January constructions with ordinary change verbs.
  ['RT3 as of January + will', 'As of January 1 the Part B deductible will be $300.'],
  ['RT3 on January + will rise', 'On January 1 the Part B deductible will rise to $300.'],
  ['RT3 in January + becomes', 'In January the Part B deductible becomes $300.'],
  ['RT3 in January + changes to', 'In January the Part B deductible changes to $300.'],
  ['RT3 in the new year', 'In the new year the Part B deductible will be $300.'],
  ['RT3 ES en enero cambiará', 'En enero el deducible de la Parte B cambiará a $300.'],
  ['RT3 ES plural subirán/quedará', 'En enero subirán los costos y el deducible de la Parte B quedará en $300.'],
  // Spanish thousands-dot amounts are CORRECT figures — never mangled.
  ['RT3 ES thousands-dot Part A', 'El deducible del hospital de la Parte A es $1.736 por período de beneficios.'],
  ['RT3 ES thousands-dot Part D cap', 'El tope de gastos de bolsillo de la Parte D es $2.100.'],
  // Spanish past tense is history.
  ['RT3 ES último año fue', 'El último año el deducible de la Parte B fue $257.'],
  ['RT3 ES año anterior fue', 'El año anterior el deducible de la Parte B fue $257.'],
  // Ranges and comparisons: the sentence already carries the right figure.
  ['RT3 from → to range', 'The Part B deductible increased from $257 to $283 this year.'],
  ['RT3 en-dash range', 'The Part B deductible went from $257–$283 this year.'],
  // Per-day coinsurance beside the hospital deductible.
  ['RT3 Part A deductible + daily coinsurance', 'The Part A hospital deductible is $1,736 per benefit period, then $434 per day for days 61–90.'],
  // IRMAA context anywhere in the sentence.
  ['RT3 IRMAA context at the start of a long sentence', 'Because your income two years ago was above the threshold that Social Security uses, the standard Part B premium in your case is $259.00 a month.'],
  // Other year forms.
  ['RT3 typographic ’27', 'In ’27 the Part B deductible is $300.'],
  ['RT3 twenty-twenty-seven hyphenated', 'For twenty-twenty-seven, the Part B deductible is $300.'],
  ['RT3 PY27 two-digit', 'PY27 Part B deductible: $300.'],
  // Caller-stated amount.
  ['RT3 caller-stated amount', 'You told me your Part B deductible came to $300 on that bill.'],
  // Next-year half of a mixed sentence survives.
  ['RT3 mixed sentence — next-year half', 'This year the Part B deductible is $283 but in 2027 it will be $300.'],
];
// Red-team 2026-09-13 (MED02-RT-01/04/05) — the guard must NOT silence genuine corrections.
const CAPTURE_RT = [
  ['E26 $2000 no comma', 'This year the Part D out-of-pocket cap is $2000.', '$2,100', 'part_d_oop_cap'],
  ['E27 $2000 with 2026', 'The Part D out-of-pocket cap is $2000 in 2026.', '$2,100', 'part_d_oop_cap'],
  ['E33 ES $2000', 'Este año el tope de gastos de bolsillo de la Parte D es $2000.', '$2,100', 'part_d_oop_cap'],
  ['E28 TTY number nearby', 'Call TTY 1-877-486-2048. The Part B deductible is $257 this year.', '$283', 'part_b_deductible'],
  ['RT-05 other year in neighbouring sentence', 'The 2027 amounts are not out yet; for 2026 the Part B deductible is $257.', '$283', 'part_b_deductible'],
  ['RT-05 "this year" overrides paragraph', '2027 will change things.\n\nThis year the Part B deductible is $257.', '$283', 'part_b_deductible'],
  // Red-team round 2 (MED02-RT2-02/03/04/06) — prose paragraphs and ordinary January mentions must still be corrected.
  ['RT2-02 prose paragraph with a 2027 sentence', 'The Annual Enrollment Period for 2027 plans runs from October 15 to December 7. The Part B deductible is $257.', '$283', 'part_b_deductible'],
  ['RT2-02 next-year prose after the figure', 'The Part B deductible is $257. Next year it will go up again.', '$283', 'part_b_deductible'],
  ['RT2-03 this year + far 2027 mention', 'The Part B deductible is $257 this year, and the 2027 amount has not been published yet.', '$283', 'part_b_deductible'],
  ['RT2-04 resets on January 1', 'The Part B deductible is $257 and it resets on January 1.', '$283', 'part_b_deductible'],
  ['RT2-04 from January through December', 'The Part B deductible is $257 from January through December.', '$283', 'part_b_deductible'],
  ['RT2-04 ES se renueva en enero', 'El deducible de la Parte B es $257 y se renueva en enero.', '$283', 'part_b_deductible'],
  ['RT2-06 long lead-in, next sentence has a marker', 'As we discussed a moment ago when you asked about your doctor-visit costs under Original Medicare, the Part B deductible is $257. Next year it may change.', '$283', 'part_b_deductible'],
  // ── Red-team round 3 — markers that must NOT silence a genuine correction ────
  ['RT3-09 lead-in "About the … deductible:"', 'About the Part B deductible: it is $257 this year.', '$283', 'part_b_deductible'],
  ['RT3-09 ES lead-in "Antes de continuar:"', 'Antes de continuar: el deducible de la Parte B es $257.', '$283', 'part_b_deductible'],
  ['RT3-09 "You asked about … :"', 'You asked about the Part B deductible: it is $257.', '$283', 'part_b_deductible'],
  ['RT3-09 regardless of income', 'The Part B deductible is $257 for everyone regardless of income.', '$283', 'part_b_deductible'],
  ['RT3-09 ES desde el 1 de enero de 2026', 'Desde el 1 de enero de 2026, el deducible de la Parte B es $257.', '$283', 'part_b_deductible'],
  ['RT3-09 ES "como le dije antes"', 'Como le dije antes, el deducible de la Parte B es $257.', '$283', 'part_b_deductible'],
  ['RT3-09 ES "hasta que pague … de $257"', 'Hasta que pague el deducible de la Parte B de $257, usted paga los servicios.', '$283', 'part_b_deductible'],
  ['RT3-10 premium and deductible in one sentence', 'Your Part B premium is $202.90 and the Part B deductible is $257.', '$283', 'part_b_deductible'],
  ['RT3-08 this-year half of a mixed sentence', 'The Part B deductible is $257 this year and next year it will be $300.', '$283', 'part_b_deductible'],
  ['RT3-08 this-year half with "but in 2027"', 'This year the Part B deductible is $257 but in 2027 it will be $300.', '$283', 'part_b_deductible'],
  ['RT3-16 ES amount written in words-unit', 'El deducible de la Parte B es de 257 dólares.', '283 dólares', 'part_b_deductible'],
  ['RT3 "up to" AFTER the amount still corrects', 'The Part D out-of-pocket cap is $2,000.00, up to which you pay coinsurance.', '$2,100', 'part_d_oop_cap'],
];
for (const [id, input, expectContains, concept] of CAPTURE_RT) {
  const r = verifyMedicareFigures(input);
  const corrected = r.text.includes(expectContains) && r.corrections.some((c) => c.concept === concept);
  check('CAP ' + id, corrected, 'got: "' + r.text + '" corrections=' + JSON.stringify(r.corrections));
  check('CAP ' + id + ' — no digit spill', !/\$2,1000|\$2830|\$2,1002/.test(r.text), 'spilled digits: "' + r.text + '"');
}
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
// ── Red-team round 4 (RT4-01/02/03/07) — collateral amounts stay untouched ────
{
  const collateral = [
    ['The Part B deductible is $257 a year, and after that you pay about $40 for a visit.', '$40', '$283'],
    ['The Part D out-of-pocket cap is $2,000, and your plan costs $12 a month in premiums.', '$12', '$2,100'],
    ['Part B deductible: $257\nOffice visit: $40', '$40', '$283'],
    ['El deducible de la Parte B es $250 al año y después usted paga unos $30 por visita.', '$30', '$283'],
    ['The Part B deductible is $257 and your copay is $15.', '$15', '$283'],
  ];
  for (const [input, keep, fixed] of collateral) {
    const r = verifyMedicareFigures(input);
    check('RT4-01 unrelated amount survives: ' + keep, r.text.includes(keep), 'CORRUPTED: "' + r.text + '"');
    check('RT4-01 the real figure is still corrected: ' + fixed, r.text.includes(fixed), 'MISSED: "' + r.text + '"');
  }
  // Spanish decimal-comma amounts are whole amounts, never half-rewritten.
  for (const t of ['El deducible del hospital de la Parte A es $1.736,00 por período.', 'El tope de la Parte D es $2.100,00.', 'La prima estándar de la Parte B es $202,90 al mes.']) {
    const r = verifyMedicareFigures(t);
    check('RT4-07 ES decimal comma untouched', r.text === t && r.corrections.length === 0, 'MUTATED to: "' + r.text + '"');
  }
  // "up to $615" still disqualifies with the '$' between the marker and the digits.
  const upTo = verifyMedicareFigures('A Part D plan can charge up to a $615 deductible, or less.');
  check('RT4-02 marker anchored across the dollar sign', upTo.corrections.length === 0, upTo.text);
}

// ── Red-team round 4, second pass (RT4-08/10/11/12) ──────────────────────────
{
  const corrects = [
    ['RT4-08 incidental "ingresos" in another clause', 'Si sus ingresos son bajos puede calificar para Ayuda Adicional y el deducible de la Parte B es $250.', '$283'],
    ['RT4-08 incidental "last time"', 'The plan you were on last time had a different network, and the Part B deductible is $257.', '$283'],
    ['RT4-10 long apposition before the amount', 'The Part B deductible, which is the amount you pay out of your own pocket before Medicare begins paying its share each calendar year, is $257.', '$283'],
    ['RT4-10 concept early in a verbose sentence', 'Under Original Medicare, Part B has an annual deductible that everybody pays before coverage starts, and for this year it is $257.', '$283'],
    ['RT4-11 postfix USD', 'The Part D out-of-pocket cap is 2,000 USD this year.', '2,100 USD'],
    ['RT4-11 space after the dollar sign', 'The Part B deductible is $ 257 this year.', '283'],
    ['RT4-12 space-separated thousands, wrong value', 'The Part A hospital deductible is $1 632 per benefit period.', '$1 736'],
  ];
  for (const [id, input, want] of corrects) {
    const r = verifyMedicareFigures(input);
    check(id, r.text.includes(want), 'got: "' + r.text + '"');
  }
  const survives = [
    ['RT4-08 IRMAA context anywhere in the sentence', 'Because your income two years ago was above the threshold that Social Security uses, the standard Part B premium in your case is $259.00 a month.'],
    ['RT4-12 space-separated thousands, right value', 'El deducible de hospital de la Parte A es $1 736 por período de beneficios.'],
    ['RT4-03 bare digits are not a currency comparison', 'The Part D out-of-pocket cap is $2,100 — we have helped 2,100 seniors with it.'],
  ];
  for (const [id, input] of survives) {
    const r = verifyMedicareFigures(input);
    check(id, r.text === input && r.corrections.length === 0, 'MUTATED to: "' + r.text + '"');
  }
}

// Red-team round 3 — no digit spill in any writing style, and linear time.
{
  const spill = verifyMedicareFigures('El deducible del hospital de la Parte A es $1.736. El tope de la Parte D es $2.100. The Part D cap is $2000.');
  check('RT3 no digit spill in any separator style', !/\$2,1000|\$1,7366|\$2830|\$1\.7366|\$2\.1000/.test(spill.text), spill.text);
  const t0 = Date.now();
  verifyMedicareFigures('The Part B deductible is $257. '.repeat(1600));
  const ms = Date.now() - t0;
  check('RT3 50 KB reply under 200 ms', ms < 200, ms + ' ms');
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

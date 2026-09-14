// scripts/test-medicare-figures-r5-2026-09-14.mjs
//
// RED TEAM ROUND 5 — RT5-MED-01 through RT5-MED-05, all P1.
//
// Round 4 added four guards to the numeric backstop: a widened keyword radius,
// a magnitude band, a competing-cost-noun test and a sentence-wide income
// disqualifier. An independent red team measured each one and found that all
// four traded one false positive for several bypasses, leaving the module worse
// than the revision it replaced. Concretely, at HEAD before this suite existed:
//
//   • an unrelated benefit amount 160 characters from a Part keyword was
//     rewritten to the Medicare figure ("$500 toward hearing aids" -> "$283");
//   • the correction band was 3x, so "$8,000" for the Part D cap — the real
//     pre-IRA figure and the likeliest stale number a model can emit — passed,
//     and so did "$0" for the Part B deductible;
//   • "per month" anywhere before the amount disabled the Part B PREMIUM
//     correction, and the premium is a monthly amount;
//   • an income mention disqualified the whole sentence for all four figures,
//     though only the Part B standard premium varies with income.
//
// Each case below is the red team's own string. CORRECT cases must be rewritten
// to the verified figure; KEEP cases must come back byte-identical.

import { verifyMedicareFigures } from '../api/_lib/medicare-figures.js';

const FIG = {
  part_b_standard_premium: 202.90,
  part_b_deductible: 283,
  part_a_hospital_deductible: 1736,
  part_d_oop_cap: 2100,
};

let passed = 0;
const failures = [];

function corrects(label, input, concept, said) {
  const r = verifyMedicareFigures(input);
  const hit = (r.corrections || []).find((c) => c.concept === concept);
  if (hit && Math.abs(hit.said - said) < 0.005 && Math.abs(hit.correct - FIG[concept]) < 0.005) { passed++; return; }
  failures.push(
    `${label}\n    in:   ${JSON.stringify(input)}\n    out:  ${JSON.stringify(r.text)}\n` +
    `    want: ${concept} ${said} -> ${FIG[concept]}\n    got:  ${JSON.stringify(r.corrections)}`
  );
}

function keeps(label, input) {
  const r = verifyMedicareFigures(input);
  if (r.text === input && (r.corrections || []).length === 0) { passed++; return; }
  failures.push(
    `${label}\n    in:   ${JSON.stringify(input)}\n    out:  ${JSON.stringify(r.text)}\n` +
    `    corrections: ${JSON.stringify(r.corrections)}`
  );
}

// ── RT5-MED-01: the widened radius must not claim another benefit's amount ──
keeps('MED-01 hearing-aid benefit, keyword trails the amount',
  'The plan pays $500 toward hearing aids each year, which is a separate benefit entirely from the Part B deductible in 2026.');
keeps('MED-01 dental and vision maxima beside a correct figure',
  'In 2026 the Part B deductible is $283, the dental max is $500 and the vision max is $400.');
keeps('MED-01 the caller’s own drug spend',
  "The 2026 Part D out-of-pocket cap is $2,100, and this plan's annual drug spend for you is $3,400.");
keeps('MED-01 late-enrollment penalty',
  'The standard Part B premium in 2026 is $202.90 for most people, and the late-enrollment penalty adds $400 over time.');
keeps('MED-01 OTC allowance',
  'Your 2026 Part D plan has a $2,100 out-of-pocket cap, and the OTC allowance gives $600 a year.');
keeps('MED-01 dental maximum after a Part A figure',
  'The 2026 Part A hospital inpatient deductible is $1,736 per benefit period, and the dental maximum is $750.');

// ── RT5-MED-03: the band must not shelter the likeliest wrong answers ──────
corrects('MED-03 pre-IRA catastrophic cap',        'In 2026 the Part D out-of-pocket cap is $8,000.', 'part_d_oop_cap', 8000);
corrects('MED-03 prior-year cap',                  'In 2026 the Part D out-of-pocket cap is $7,400.', 'part_d_oop_cap', 7400);
corrects('MED-03 far-low Part A deductible',       'The 2026 Part A hospital inpatient deductible is $500 per benefit period.', 'part_a_hospital_deductible', 500);
corrects('MED-03 zero Part B deductible',          'The 2026 Part B deductible is $0.', 'part_b_deductible', 0);
corrects('MED-03 zero Part D cap',                 'In 2026 the Part D out-of-pocket cap is $0.', 'part_d_oop_cap', 0);
corrects('MED-03 digit added',                     'The 2026 Part B deductible is $2,830.', 'part_b_deductible', 2830);
corrects('MED-03 digit dropped',                   'The 2026 Part B deductible is $28.', 'part_b_deductible', 28);
corrects('MED-03 stale Part A deductible',         'The 2026 Part A hospital inpatient deductible is $850 per benefit period.', 'part_a_hospital_deductible', 850);

// ── RT5-MED-04: monthly cadence must not disable the premium correction ────
corrects('MED-04 premium per month',               'The standard Part B premium per month in 2026 is $174.70 for most people.', 'part_b_standard_premium', 174.70);
corrects('MED-04 deductible you pay',              'In 2026 the Part B deductible you pay is $257.', 'part_b_deductible', 257);
corrects('MED-04 premium costs you a month',       'In 2026 the standard Part B premium costs you $174.70 a month for most people.', 'part_b_standard_premium', 174.70);
corrects('MED-04 you pay about X as the deductible', 'For Part B in 2026 you pay about $257 as the deductible.', 'part_b_deductible', 257);
corrects('MED-04 ES cuesta al mes',                'La prima estandar de la Parte B en 2026 cuesta $174.70 al mes para la mayoria.', 'part_b_standard_premium', 174.70);
corrects('MED-04 ES la mayoria paga',              'La mayoria paga una prima estandar de Parte B de $174.70 en 2026.', 'part_b_standard_premium', 174.70);
corrects('MED-04 copay named before the keyword',  'Apart from your copay the 2026 Part B deductible is $257.', 'part_b_deductible', 257);
corrects('MED-04 visit named before the keyword',  'Before your first visit in 2026 the Part B deductible of $257 applies.', 'part_b_deductible', 257);
corrects('MED-04 joined by "and", not a semicolon', 'The Part B deductible is separate from your copay and in 2026 is $257.', 'part_b_deductible', 257);

// ── RT5-MED-05: income context qualifies the PREMIUM, and nothing else ─────
corrects('MED-05 income lead-in on a Part A deductible',
  'Because your income is above the threshold, your 2026 Part A hospital inpatient deductible is $2,000 per benefit period.', 'part_a_hospital_deductible', 2000);
corrects('MED-05 IRMAA lead-in on a Part D cap',
  'Even if your income is above the IRMAA threshold, the 2026 Part D out-of-pocket cap is $3,300.', 'part_d_oop_cap', 3300);
corrects('MED-05 higher-income lead-in on a Part B deductible',
  'Even for higher-income seniors the 2026 Part B deductible is $257.', 'part_b_deductible', 257);
corrects('MED-05 "regardless of your income" states the correct rule',
  'The 2026 Part B deductible is $257 regardless of your income.', 'part_b_deductible', 257);
corrects('MED-05 "no matter your income" states the correct rule',
  'The 2026 Part B deductible is $257 no matter your income.', 'part_b_deductible', 257);
corrects('MED-05 ES sin importar sus ingresos',
  'El deducible de la Parte B en 2026 es de $257 sin importar sus ingresos.', 'part_b_deductible', 257);

// ── Controls: the guards that were RIGHT must still hold ──────────────────
keeps('IRMAA genuinely qualifies the Part B PREMIUM',
  'Because your income is above the IRMAA threshold, your 2026 Part B premium is $259.00 a month.');
keeps('past tense is history, not a claim',
  'Last year the standard Part B premium was $174.70 a month.');
keeps('a comparison already carries the right figure',
  'The Part B deductible increased from $257 in 2025 to $283 in 2026.');
keeps('another contract year is not ours to rewrite',
  'In 2027 the Part B deductible is expected to be $300.');
keeps('a per-day coinsurance is not the annual deductible',
  'The 2026 Part A hospital inpatient deductible is $1,736 per benefit period, then $434 per day.');
keeps('a copay after the keyword belongs to the visit',
  'The 2026 Part B deductible is $283 a year, and after that you pay about $40 for a visit.');
keeps('an already-correct figure is left alone',
  'In 2026 the Part B deductible is $283 and the Part D out-of-pocket cap is $2,100.');
keeps('an "up to" amount is a range, not a claim',
  'For Part B in 2026 some people pay up to $615 a month.');

// ── RT5-MED-06: the concept lives one level up ───────────────────────────
corrects('MED-06 four-deep list, concept on a parent line',
  '2026 figures:\n- Medicare\n  - Part B\n    - Costs\n      - deductible: $257', 'part_b_deductible', 257);
corrects('MED-06 EN anaphoric sentence',
  'Let us talk about the Part B deductible. In 2026 it is $257.', 'part_b_deductible', 257);
corrects('MED-06 ES anaphoric sentence',
  'Hablemos del deducible de la Parte B. En 2026 es de $257.', 'part_b_deductible', 257);
// …and inheriting must not hand the next amount to the same concept.
keeps('MED-06 control: a copay in the following sentence',
  'The Part B deductible is $283. My copay for a specialist is $50.');
keeps('MED-06 control: the four-deep list under a 2027 heading',
  '2027 figures:\n- Medicare\n  - Part B\n    - Costs\n      - deductible: $300');

// ── RT5-MED-07: a hyphenated year range is a year range ──────────────────
keeps('MED-07 hyphenated range in prose',
  'For 2027-2028 the Part B deductible will be $300.');
keeps('MED-07 hyphenated range as a heading',
  '2027-2028 figures:\n- Part B deductible: $300');
keeps('MED-07 a range that includes our year is still a range',
  '2026-2027 figures:\n- Part B deductible: $300');
keeps('MED-07 control: the en-dash form already worked',
  'For 2027–2028 the Part B deductible will be $300.');

// ── RT5-MED-08: a caption below the figures counts ───────────────────────
keeps('MED-08 table caption under a blank line',
  '| Item | Amount |\n|---|---|\n| Part B deductible | $300 |\n\nTable: projected 2027 amounts.');
keeps('MED-08 list caption under a blank line',
  '- Part B deductible: $300\n- Part A deductible: $1,800\n\nThose are the 2027 numbers.');
corrects('MED-08 control: a 2026 caption still allows the correction',
  '- Part B deductible: $257\n\nThose are the 2026 numbers.', 'part_b_deductible', 257);

// ═══ RED TEAM ROUND 6 — the round-5 guards attacked in turn ═══════════════
// Round 6 found that three of the round-5 fixes had swapped one defect for
// another, and that two of them rewrote correct, business-critical numbers.

// ── RT6-MED-03: a different product's premium is not the Part B premium ───
keeps('MED-03 Medigap Plan G premium beside the Part B premium',
  'The standard Part B premium is $202.90, and your Medigap Plan G premium is $145 a month.');
keeps('MED-03 ES Medigap premium',
  'La prima estándar de la Parte B es $202.90, y su prima de Medigap Plan G es $145 al mes.');
keeps("MED-03 the plan's own drug deductible",
  "Your Part B costs are set, but your plan's drug deductible is $500 for 2026.");
keeps('MED-03 a nested list under a Medigap heading',
  'Standard 2026 amounts:\n- Part B\n  - standard premium: $202.90\n  - Medigap Plan G\n    - monthly premium: $145\n');

// ── RT6-MED-09: the next clause's benefit is not this concept's amount ────
keeps('MED-09 the plan charges a monthly premium',
  'The 2026 Part B deductible is $283, and the plan charges a $45 monthly premium.');
keeps('MED-09 a grocery card allowance',
  'The 2026 Part B deductible is $283, and the plan offers a $60 quarterly grocery card.');
keeps('MED-09 a specialist charge with no visible subject',
  'In 2026 the Part B deductible is $283, and for each specialist there is a $50 charge.');
keeps('MED-09 ES recargo por consulta',
  'En 2026 el deducible de la Parte B es $283, y hay un recargo de $50 por cada consulta especializada.');
keeps('MED-09 inheritance must not cross a topic change',
  'Let us talk about the Part B deductible. It is worth knowing you also get $500 a year for dental.');
keeps('MED-09 a nested list under an Extras heading',
  '2026 costs:\n- Part B\n  - deductible: $283\n  - Extras\n    - dental allowance: $500\n');

// ── RT6-MED-04: "about" protects a rounding, not any round number ─────────
corrects('MED-04 "about $8,000" is not a rounding of $2,100',
  'In 2026 the Part D out-of-pocket cap is about $8,000.', 'part_d_oop_cap', 8000);
corrects('MED-04 "roughly $150" is not a rounding of $202.90',
  'The standard Part B premium in 2026 is roughly $150 a month for most people.', 'part_b_standard_premium', 150);
keeps('MED-04 control: "around $200" IS a rounding of $202.90',
  'The standard Part B premium in 2026 is around $200 a month for most people.');

// ── RT6-MED-02: a subsidised $0 is true; a hallucinated $0 is not ─────────
keeps('MED-02 QMB pays the caller share',
  'If you have QMB, your share of the Part B deductible would normally be $0.');
keeps('MED-02 ES QMB',
  'Si usted tiene QMB, normalmente su parte del deducible de la Parte B seria $0.');
keeps('MED-02 full Extra Help zeroes the cap',
  'With full Extra Help your 2026 Part D out-of-pocket cap is effectively $0.');
corrects('MED-02 control: a bare $0 with no programme named is still corrected',
  'The 2026 Part B deductible is $0.', 'part_b_deductible', 0);

if (failures.length) {
  console.error(`MEDICARE FIGURES R5: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

// Wave 11 — service-first brain repair test harness.
// Replays Sawil's exact screenshot scenario at the engine level + the new
// looksLikeName guard + bot-complaint detection + billing/letter classification.

import {
  classifyIntent,
  detectBotComplaint,
  looksLikeName,
  applyFuzzyTypos,
  intentFollowUp,
  intentFollowUpChips,
  scanForbiddenPhrases,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== SAWIL SCREENSHOT SCENARIO ===');
// 1. User types "ME LLEGARON BILLES"
const t1 = classifyIntent('ME LLEGARON BILLES', 'es');
check('"ME LLEGARON BILLES" → plan_letter_issue (billing/document)',
  t1.primary === 'plan_letter_issue',
  `got=${t1.primary} confidence=${t1.confidence}`);
check('"ME LLEGARON BILLES" NOT classified as a name', !looksLikeName('ME LLEGARON BILLES'));

// 2. User types "ME LLEGARON RECIBOS"
const t2 = classifyIntent('ME LLEGARON RECIBOS', 'es');
check('"ME LLEGARON RECIBOS" → plan_letter_issue',
  t2.primary === 'plan_letter_issue',
  `got=${t2.primary} confidence=${t2.confidence}`);
check('"ME LLEGARON RECIBOS" NOT classified as a name', !looksLikeName('ME LLEGARON RECIBOS'));

// 3. User types "NO ENTIENDES NADA"
check('"NO ENTIENDES NADA" → bot complaint', detectBotComplaint('NO ENTIENDES NADA'));
check('"no entiendes nada" lowercase → bot complaint', detectBotComplaint('no entiendes nada'));

console.log('\n=== TYPO NORMALIZATION ===');
check('"mellgaron billes" normalized', applyFuzzyTypos('mellgaron billes').includes('me llegaron') && applyFuzzyTypos('mellgaron billes').includes('bills'));
check('"billes" → bills', applyFuzzyTypos('me llegaron billes').includes('bills'));
check('"recivos" → recibos', applyFuzzyTypos('me llegaron recivos').includes('recibos'));

console.log('\n=== BILLING/DOCUMENT BROADENED COVERAGE ===');
// Each of these should hit plan_letter_issue
const billingTests = [
  ['me llegaron billes', 'es'],
  ['me llegaron bills', 'es'],
  ['me llegaron recibos', 'es'],
  ['me llegó una factura', 'es'],
  ['me llegó un cobro', 'es'],
  ['me llegó una carta', 'es'],
  ['me mandaron un bill', 'es'],
  ['me están cobrando', 'es'],
  ['tengo un bill de Medicare', 'es'],
  ['me llegó un papel del plan', 'es'],
  ['I received a bill', 'en'],
  ['I got a letter from my plan', 'en'],
  ['I got an EOB', 'en'],
  ['my pharmacy charged me too much', 'en'],
  ['I got a collection notice', 'en'],
  ["I don't understand this bill", 'en'],
];
for (const [phrase, lang] of billingTests) {
  const r = classifyIntent(phrase, lang);
  check(`billing/doc: "${phrase}" → plan_letter_issue`,
    r.primary === 'plan_letter_issue' || r.secondary.includes('plan_letter_issue'),
    `got=${r.primary} confidence=${r.confidence}`);
}

console.log('\n=== looksLikeName GUARD ===');
check('"Maria Rodriguez" → IS a name', looksLikeName('Maria Rodriguez'));
check('"John Smith" → IS a name', looksLikeName('John Smith'));
check('"María Rodríguez Pérez" → IS a name', looksLikeName('María Rodríguez Pérez'));
check('"me llegaron recibos" → NOT a name', !looksLikeName('me llegaron recibos'));
check('"I received a bill" → NOT a name', !looksLikeName('I received a bill'));
check('"tengo un cobro" → NOT a name', !looksLikeName('tengo un cobro'));
check('"my doctor is not covered" → NOT a name', !looksLikeName('my doctor is not covered'));
check('"212-555-1234" → NOT a name (has digits)', !looksLikeName('212-555-1234'));
check('"Hi I am Maria" → NOT a name (has verb)', !looksLikeName('Hi I am Maria'));
check('"" → NOT a name', !looksLikeName(''));

console.log('\n=== detectBotComplaint ===');
check('"no entiendes" → complaint', detectBotComplaint('no entiendes'));
check('"no me entiendes" → complaint', detectBotComplaint('no me entiendes'));
check('"estás perdido" → complaint', detectBotComplaint('estás perdido'));
check('"you don\'t understand" → complaint', detectBotComplaint("you don't understand"));
check('"stop asking me that" → complaint', detectBotComplaint('stop asking me that'));
check('"wrong question" → complaint', detectBotComplaint('wrong question'));
check('"I have a question" → NOT complaint', !detectBotComplaint('I have a question'));
check('"my doctor is not in network" → NOT complaint', !detectBotComplaint('my doctor is not in network'));

console.log('\n=== NEW plan_letter_issue COPY ===');
const ptEn = intentFollowUp('plan_letter_issue', 'en');
const ptEs = intentFollowUp('plan_letter_issue', 'es');
check('EN copy mentions bills/receipts/letter', /bill|receipt|letter|charge|eob/i.test(ptEn));
check('ES copy mentions billes/recibos/factura/carta', /billes|recibo|factura|cobro|carta|eob/i.test(ptEs.toLowerCase()));
check('EN copy includes privacy caution', /medicare id|social security|banking|sensitive/i.test(ptEn));
check('ES copy includes privacy caution', /medicare|seguro social|bancaria|sensible/i.test(ptEs.toLowerCase()));
check('EN copy no forbidden phrase', scanForbiddenPhrases(ptEn).length === 0);
check('ES copy no forbidden phrase', scanForbiddenPhrases(ptEs).length === 0);

const chipsEn = intentFollowUpChips('plan_letter_issue', 'en');
const chipsEs = intentFollowUpChips('plan_letter_issue', 'es');
check('EN chips include Doctor/Hospital + Pharmacy', chipsEn.some(c => /doctor/i.test(c)) && chipsEn.some(c => /pharmacy/i.test(c)));
check('ES chips include Doctor/Hospital + Farmacia', chipsEs.some(c => /doctor/i.test(c)) && chipsEs.some(c => /farmacia/i.test(c)));
check('EN chips include EOB', chipsEn.some(c => /eob/i.test(c)));
check('ES chips include EOB', chipsEs.some(c => /eob/i.test(c)));
check('chips ≤ 4 (Wave 9 button discipline)', chipsEn.length <= 4 && chipsEs.length <= 4);

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

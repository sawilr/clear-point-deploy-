// Wave 17 — Antonio scenario replay.
// Replays the EXACT failing conversation from Sawil's preview screenshot:
//   1. español → Antonio → 10001 → [bill question]
//   2. user: "DE LA FARMACIA"  ← bot must remember this
//   3. user: "OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE"  ← must flag dual eligible
//   4. user: "PAGUE 18 DOLARES DE COPAY"  ← must NOT re-ask the source

import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== ANTONIO SCREENSHOT REPLAY ===');

// Step 1: pick Spanish — V20 goes language → asking_topic (chips), no name/ZIP.
let s = createInitialState();
let r = processMessage('español', s);
s = r.newState;
check('Step 1: language=es', s.language === 'es');
check('Step 1 V20: step → asking_topic (not asking_name)', s.step === 'asking_topic');

// V20 — name/ZIP no longer auto-collected. Skip directly to topic.
// (Antonio context memory is still the critical regression; flow now starts
// with the user describing the bill.)

// Step 4: tell about the bill
r = processMessage('tengo un cobro de medicamentos', s);
s = r.newState;
check('Step 4: bot asks source (first time, EXPECTED)',
  /m[eé]dico|hospital|farmacia|plan/i.test(r.response),
  `response="${r.response.slice(0, 100)}"`);

// Step 5: THE CRITICAL TURN — user says "DE LA FARMACIA"
r = processMessage('DE LA FARMACIA', s);
s = r.newState;
check('Step 5: billSource=pharmacy captured', s.billSource === 'pharmacy', `billSource=${s.billSource}`);
check('Step 5: bot does NOT re-ask doctor/hospital/pharmacy/plan',
  !/del m[eé]dico u hospital, de la farmacia, o del plan/i.test(r.response),
  `response="${r.response.slice(0, 120)}"`);

// Step 6: user mentions dual eligibility — "OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE"
r = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s);
s = r.newState;
check('Step 6: dualEligible=true flagged', s.dualEligible === true);
check('Step 6: billSource STILL pharmacy (preserved across turns)', s.billSource === 'pharmacy');
check('Step 6: bot acknowledges Medicare + Medicaid',
  /medicaid|doble elegibilidad|dual/i.test(r.response),
  `response="${r.response.slice(0, 120)}"`);
check('Step 6: bot does NOT ask "give me more detail" (the failing line)',
  !/puede darme un poco m[aá]s de detalle/i.test(r.response),
  `response="${r.response.slice(0, 120)}"`);

// Step 7: THE EXACT BUG — user says "PAGUE 18 DOLARES DE COPAY"
r = processMessage('PAGUE 18 DOLARES DE COPAY', s);
s = r.newState;
check('Step 7: amount=18 captured', s.amountMentioned === '18', `amount=${s.amountMentioned}`);
check('Step 7: billSource STILL pharmacy', s.billSource === 'pharmacy');
check('Step 7: dualEligible STILL true', s.dualEligible === true);
check('Step 7: bot does NOT re-ask doctor/hospital/pharmacy/plan question',
  !/del m[eé]dico u hospital, de la farmacia, o del plan/i.test(r.response),
  `response="${r.response.slice(0, 150)}"`);
check('Step 7: bot acknowledges the $18 amount',
  /18/.test(r.response),
  `response="${r.response.slice(0, 150)}"`);
check('Step 7: bot mentions dual eligibility benefit',
  /medicaid|copagos.+(bajo|low)|extra help|lis|asesor.+revis/i.test(r.response),
  `response="${r.response.slice(0, 200)}"`);

// ── EN equivalent ──
console.log('\n=== ANTONIO ENGLISH EQUIVALENT ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('I have a drug bill', s).newState;
s = processMessage('from the pharmacy', s).newState;
check('EN: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('I have both Medicaid and Medicare', s).newState;
check('EN: dualEligible=true', s.dualEligible === true);
r = processMessage('I paid $18 copay', s);
s = r.newState;
check('EN: amount=18 captured', s.amountMentioned === '18');
check('EN: bot acknowledges amount + dual', /18/.test(r.response) && /medicaid|dual/i.test(r.response),
  `response="${r.response.slice(0, 200)}"`);
check('EN: bot does NOT re-ask source',
  !/doctor or hospital, a pharmacy, or your medicare plan/i.test(r.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

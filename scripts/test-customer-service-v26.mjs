// Wave 26 — Doctor/provider continuation + loop prevention + page-lang welcome.
// Sawil's exact failing flow + new acceptance tests.

import {
  processMessage,
  createInitialState,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== SAWIL EXACT FAILING FLOW: English → 10033 → doctors problem → continuation ===');
let s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10033', s).newState;
check('setup: ZIP captured', s.zipCode === '10033');
check('setup: step=asking_topic', s.step === 'asking_topic');

const r1 = processMessage('i have a problem with my doctors', s);
s = r1.newState;
check('Turn 1: doctor_provider_network detected',
  s.serviceCategory === 'doctor_provider_network',
  `category=${s.serviceCategory} intent=${s.intent}`);
// V28 — clarification layer fires first; routingLevel set by later turns.
check('Turn 1: bot asks what happened (V28 clarification)',
  /what happened with your doctor|qu[eé] pas[oó] con su doctor/i.test(r1.response),
  `response="${r1.response.slice(0, 200)}"`);
check('Turn 1: response NOT generic fallback',
  !/can you give me a bit more detail/i.test(r1.response));

const r2 = processMessage('they no longer work with my insurance', s);
s = r2.newState;
check('Turn 2: serviceCategory still doctor_provider_network',
  s.serviceCategory === 'doctor_provider_network');
check('Turn 2: subIssue=provider_left_network',
  s.subIssue === 'provider_left_network',
  `subIssue=${s.subIssue}`);
check('Turn 2: response mentions network/plan',
  /network|plan|red del plan/i.test(r2.response));
check('Turn 2: response says verification needed',
  /cannot verify|verify|licensed advisor|asesor licenciado/i.test(r2.response));
check('Turn 2: asks primary/specialist/hospital',
  /primary doctor.*specialist.*hospital|primary.*specialist.*hospital|doctor primario.*especialista.*hospital/is.test(r2.response));
check('Turn 2: NOT generic fallback',
  !/give me a bit more detail|d[eé]me un poco m[aá]s de detalle/i.test(r2.response));

const r3 = processMessage('she is my primary doctor', s);
s = r3.newState;
check('Turn 3: continuation handler responds about primary doctor',
  /primary doctor|doctor primario/i.test(r3.response));
check('Turn 3: offers to set up advisor',
  /set that up|coordine|advisor|asesor/i.test(r3.response));
check('Turn 3: NOT generic fallback',
  !/give me a bit more detail/i.test(r3.response));

console.log('\n=== ENGLISH PROVIDER LEFT NETWORK (direct) ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const r4 = processMessage('my doctor no longer accepts my plan', s);
check('Direct: doctor_provider_network', r4.newState.serviceCategory === 'doctor_provider_network');
check('Direct: subIssue=provider_left_network', r4.newState.subIssue === 'provider_left_network');
check('Direct: no generic fallback',
  !/give me a bit more detail/i.test(r4.response));
check('Direct: verification disclaimer present',
  /cannot verify|verify|licensed advisor/i.test(r4.response));

console.log('\n=== SPANISH PROVIDER LEFT NETWORK ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('no', s).newState;
const r5 = processMessage('mi doctor ya no acepta mi plan', s);
check('ES: doctor_provider_network', r5.newState.serviceCategory === 'doctor_provider_network');
check('ES: subIssue=provider_left_network', r5.newState.subIssue === 'provider_left_network');
check('ES: response in Spanish',
  /asesor licenciado|red del plan/i.test(r5.response));
check('ES: asks doctor type',
  /doctor primario.*especialista.*hospital/is.test(r5.response));
check('ES: uses usted (no tú)', !/\bt[uú]\b/i.test(r5.response));

console.log('\n=== LOOP PREVENTION: same fallback never twice ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10001', s).newState;
const rL1 = processMessage('hmm', s);
s = rL1.newState;
const rL2 = processMessage('uh', s);
check('Loop: 2nd vague message does NOT repeat same fallback',
  rL1.response !== rL2.response,
  `r1="${rL1.response.slice(0, 60)}" r2="${rL2.response.slice(0, 60)}"`);
check('Loop: 2nd vague pivots to topic question',
  /factura|bill|doctor|medicamentos|medications|hablar|advisor/i.test(rL2.response));

console.log('\n=== CONTINUATION ROUTING: drug ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
s = processMessage('I have a problem with my medication', s).newState;
check('Drug setup: intent=drug', s.intent === 'drug');
const rDrug = processMessage('it is too expensive', s);
check('Drug continuation: NOT generic',
  !/give me a bit more detail/i.test(rDrug.response));
check('Drug continuation: mentions formulary or pharmacy',
  /formulary|formulario|pharmacy|farmacia|tier|prior auth/i.test(rDrug.response));

console.log('\n=== CONTINUATION ROUTING: bill ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10001', s).newState;
// V28 — give specific qualifier up-front so clarification doesn't fire;
// bill flow drills down properly.
s = processMessage('I have a hospital bill for $10,000', s).newState;
check('Bill setup: amount=10000',
  s.amountMentioned === '10000');
const rBill = processMessage('I do not know if I owe it', s);
check('Bill continuation: NOT generic',
  !/give me a bit more detail/i.test(rBill.response));
check('Bill continuation: references advisor / EOB / amount due',
  /amount due|patient responsibility|advisor|asesor|eob|hospital/i.test(rBill.response));

console.log('\n=== REGRESSION: existing tests still pass ===');
// Antonio
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('no', s).newState;
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('Antonio: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s).newState;
check('Antonio: dualEligible=true', s.dualEligible === true);
const rAnt = processMessage('PAGUE 18 DOLARES DE COPAY', s);
check('Antonio: amount=18', rAnt.newState.amountMentioned === '18');

// 988 still works
s = createInitialState();
s = processMessage('english', s).newState;
const rCrisis = processMessage('I want to die', s);
check('988 still routes', /988/.test(rCrisis.response));

// best plan no-recommendation still works
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rBest = processMessage('what is the best plan?', s);
check('Best plan: still refuses to recommend',
  /can'?t tell you|no puedo decirle/i.test(rBest.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

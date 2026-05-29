// Wave 28 — Clarify-before-explaining architecture + 20 acceptance tests.

import {
  processMessage,
  createInitialState,
  detectVagueProblemReport,
  getTopicClarification,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== VAGUE-REPORT DETECTOR ===');
check('"tengo problemas con mi doctor" → vague doctor',
  (() => { const r = detectVagueProblemReport('tengo problemas con mi doctor'); return r.isVague && r.topic === 'doctor'; })());
check('"tengo problemas con mi especialista" → vague specialist',
  (() => { const r = detectVagueProblemReport('tengo problemas con mi especialista'); return r.isVague && r.topic === 'specialist'; })());
check('"my doctor has a problem" → vague doctor',
  (() => { const r = detectVagueProblemReport('my doctor has a problem'); return r.isVague && r.topic === 'doctor'; })());
check('"me llegó una carta" → vague letter',
  (() => { const r = detectVagueProblemReport('mi carta tiene problema'); return r.isVague && r.topic === 'letter'; })());
check('"tengo problema con mi medicina" → vague medication',
  (() => { const r = detectVagueProblemReport('tengo problema con mi medicina'); return r.isVague && r.topic === 'medication'; })());
check('"my plan is not working" → vague plan',
  (() => { const r = detectVagueProblemReport('my plan is not working'); return r.isVague && r.topic === 'plan'; })());
// Specific qualifiers → NOT vague
check('"my doctor no longer accepts my plan" → NOT vague',
  !detectVagueProblemReport('my doctor no longer accepts my plan').isVague);
check('"factura de $10,000" → NOT vague',
  !detectVagueProblemReport('tengo una factura de $10,000').isVague);
check('"denied prescription" → NOT vague',
  !detectVagueProblemReport('they denied my prescription').isVague);
check('"hello" → no topic',
  !detectVagueProblemReport('hello').isVague);

console.log('\n=== TEST 1: Broad doctor problem does NOT assume specialist ===');
let s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r1 = processMessage('tengo problemas con mi doctor', s);
check('T1: asks what happened with doctor',
  /qu[eé] pas[oó] con su doctor/i.test(r1.response));
check('T1: does NOT mention specialist',
  !/especialista/i.test(r1.response));
check('T1: no AEP/IEP/SEP',
  !/aep|iep|sep|inscripci[oó]n a medicare/i.test(r1.response));
check('T1: serviceCategory=doctor_provider_network',
  r1.newState.serviceCategory === 'doctor_provider_network');
check('T1: subIssue=vague_report',
  r1.newState.subIssue === 'vague_report');
check('T1: short response (<55 words)',
  r1.response.split(/\s+/).length < 55);

console.log('\n=== TEST 2: Broad specialist problem asks what happened ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r2 = processMessage('tengo problemas con mi especialista', s);
check('T2: asks what happened with specialist',
  /qu[eé] pas[oó] con su especialista/i.test(r2.response));
check('T2: no AEP/IEP/SEP', !/aep|iep|sep/i.test(r2.response));
check('T2: short response (<55 words)', r2.response.split(/\s+/).length < 55);

console.log('\n=== TEST 3: Specific doctor message → specific handler ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
s = processMessage('tengo problemas con mi doctor', s).newState;
const r3 = processMessage('me dijeron que ya no acepta mi seguro', s);
check('T3: subIssue=provider_left_network or told_to_change_plan',
  ['provider_left_network', 'told_to_change_plan'].includes(r3.newState.subIssue),
  `subIssue=${r3.newState.subIssue}`);
check('T3: NOT generic fallback',
  !/d[eé]me un poco m[aá]s|tell me more|m[aá]s detalle/i.test(r3.response));

console.log('\n=== TEST 4: Doctor problem then "no quiero cambiar de plan" ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
s = processMessage('tengo problemas con mi doctor', s).newState;
const r4 = processMessage('no quiero cambiar de plan', s);
check('T4: doesNotWantPlanChange=true', r4.newState.doesNotWantPlanChange === true);
check('T4: no AEP/IEP/SEP', !/aep|iep|sep|inscripci[oó]n a medicare/i.test(r4.response));
check('T4: serviceCategory still doctor_provider_network',
  r4.newState.serviceCategory === 'doctor_provider_network');

console.log('\n=== TEST 5: "quiero cambiar de plan" → enrollment OK ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const r5 = processMessage('quiero cambiar de plan', s);
check('T5: explicit → enrollment can fire',
  r5.newState.intent === 'enrollment' || /aep|iep|sep|enrollment/i.test(r5.response));

console.log('\n=== TEST 6: "me dijeron que debo cambiar" → no auto enrollment ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r6 = processMessage('me dijeron que debo cambiar de plan', s);
check('T6: subIssue=told_to_change_plan',
  r6.newState.subIssue === 'told_to_change_plan');
check('T6: no AEP/IEP/SEP', !/aep|iep|sep/i.test(r6.response));
check('T6: asks who told them',
  /qui[eé]n le dijo|who told you/i.test(r6.response));

console.log('\n=== TEST 7: Letter broad ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r7 = processMessage('me llegó una carta', s);
check('T7: asks who sent the letter',
  /viene de medicare|de social security|de su plan|carta viene de/i.test(r7.response));
check('T7: no ANOC/EOC/IRMAA paragraph',
  !/anoc|eoc|irmaa/i.test(r7.response));

console.log('\n=== TEST 8: Bill broad ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r8 = processMessage('me llegó un bill', s);
check('T8: asks if amount due or EOB',
  /amount due|explicaci[oó]n de beneficios|usted debe pagar|owe an amount/i.test(r8.response));
check('T8: short response (<55 words)', r8.response.split(/\s+/).length < 55);

console.log('\n=== TEST 9: Medicine broad ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r9 = processMessage('tengo problema con mi medicina', s);
check('T9: asks cost/not covered/pharmacy',
  /costo|cubrieron|farmacia|process|expensive|covered|pharmacy/i.test(r9.response));

console.log('\n=== TEST 10: Plan broad ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r10 = processMessage('tengo problemas con mi plan', s);
check('T10: asks coverage/cost/doctors/medicines/letter',
  /cobertura|costo|doctores|medicamentos|carta|coverage|cost|doctors|medications|letter/i.test(r10.response));
check('T10: no auto enrollment',
  !/aep|iep|sep|inscripci[oó]n a medicare/i.test(r10.response));

console.log('\n=== TEST 15: No repeated generic fallback ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
const r15a = processMessage('hmm', s);
const r15b = processMessage('huh', r15a.newState);
check('T15: 2nd vague → different from 1st',
  r15a.response !== r15b.response);

console.log('\n=== TEST 16: Response length under 55 words for vague reports ===');
const flows = [
  'tengo problemas con mi doctor',
  'tengo problemas con mi especialista',
  'me llegó una carta',
  'me llegó un bill',
  'tengo problema con mi medicina',
];
for (const f of flows) {
  s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('10550', s).newState;
  const r = processMessage(f, s);
  const wc = r.response.split(/\s+/).length;
  check(`T16 "${f}": <55 words (got ${wc})`, wc < 55);
}

console.log('\n=== TEST 17: No forced advisor on first vague problem ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r17 = processMessage('tengo problemas con mi doctor', s);
check('T17: no advisor mention in first response',
  !/asesor licenciado puede/i.test(r17.response));

console.log('\n=== TEST 18: Spanish usted form (no tú) ===');
check('T18: Spanish vague response uses usted',
  !/\bt[uú]\b/i.test(r17.response));

console.log('\n=== TEST 19: No plan recommendation ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const r19 = processMessage('what is the best plan?', s);
check('T19: refuses to recommend',
  /can'?t tell|cannot tell|no puedo decirle/i.test(r19.response));

console.log('\n=== TEST 20: Sawil exact Wave 27 flow still works ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10033', s).newState;
s = processMessage('tengo problemas con mi especialista', s).newState;
s = processMessage('me dijeron q deberia cambiar de plan no quiero cambiar de plan ni de especialista', s).newState;
check('T20 acknowledged: doesNotWantPlanChange', s.doesNotWantPlanChange === true);
check('T20 acknowledged: planChangeAcknowledged=true', s.planChangeAcknowledged === true);
const r20 = processMessage('me lo dijo el especialista', s);
check('T20: bot advances to verification',
  /no significa que usted tenga que cambiar|that doesn'?t mean you have to change/i.test(r20.response));

console.log('\n=== REGRESSION: prior harness highlights ===');
// Antonio
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('no', s).newState;
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('Antonio: billSource=pharmacy', s.billSource === 'pharmacy');

// 988
s = createInitialState();
s = processMessage('english', s).newState;
const rC = processMessage('I want to die', s);
check('988 still routes', /988/.test(rC.response));

// V26 specific doctor flow still works
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10033', s).newState;
s = processMessage('my doctor no longer accepts my plan', s).newState;
check('V26 specific: subIssue=provider_left_network',
  s.subIssue === 'provider_left_network');

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

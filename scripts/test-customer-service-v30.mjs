// Wave 30 — General vague handler + provider-said source + Spanish q→que +
// Sawil's exact "tengo problemas → mi doctor dice q debo cambiar" flow.

import {
  processMessage,
  createInitialState,
  detectGeneralVague,
  getGeneralClarification,
  detectToldToChange,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== TOPIC-LESS GENERAL VAGUE DETECTOR ===');
check('"tengo problemas" → vague', detectGeneralVague('tengo problemas'));
check('"tengo problema" → vague', detectGeneralVague('tengo problema'));
check('"necesito ayuda" → vague', detectGeneralVague('necesito ayuda'));
check('"ayuda" → vague', detectGeneralVague('ayuda'));
check('"I have a problem" → vague', detectGeneralVague('I have a problem'));
check('"I have problems" → vague', detectGeneralVague('I have problems'));
check('"I need help" → vague', detectGeneralVague('I need help'));
check('"help" → vague', detectGeneralVague('help'));
check('"no entiendo" → vague', detectGeneralVague('no entiendo'));
check('"tengo problemas con mi doctor" → NOT topic-less vague',
  !detectGeneralVague('tengo problemas con mi doctor'));
check('"hello" → NOT vague', !detectGeneralVague('hello'));

console.log('\n=== GENERAL CLARIFICATION CONTENT ===');
check('Spanish clarification mentions doctor/medicina/factura/carta/plan',
  /doctor.*medicina.*factura.*carta.*plan|plan.*carta/i.test(getGeneralClarification(true)));
check('English clarification mentions doctor/medicine/bill/letter/plan',
  /doctor.*medicine.*bill.*letter.*plan/i.test(getGeneralClarification(false)));

console.log('\n=== SAWIL EXACT FLOW: tengo problemas → mi doctor dice q debo cambiar ===');
let s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('07407', s).newState;
const r1 = processMessage('tengo problemas', s);
s = r1.newState;
check('T1: general clarification fires',
  /problema es con su doctor.*medicina.*factura.*carta.*plan/i.test(r1.response),
  `response="${r1.response.slice(0, 200)}"`);
check('T1: subIssue=general_vague', s.subIssue === 'general_vague');
check('T1: NO Medicare education',
  !/inscripci[oó]n a medicare|aep|iep|sep/i.test(r1.response));
check('T1: NO chips',
  (s.quickReplies || []).length === 0);

const r2 = processMessage('mi doctor dice q debo cambiar de plan', s);
s = r2.newState;
check('T2: serviceCategory=doctor_provider_network',
  s.serviceCategory === 'doctor_provider_network',
  `category=${s.serviceCategory}`);
check('T2: subIssue=told_to_change_plan',
  s.subIssue === 'told_to_change_plan');
check('T2: NO enrollment / NO IEP/AEP/SEP',
  !/iep|aep|sep|inscripci[oó]n a medicare/i.test(r2.response));
check('T2: asks who told them or what doctor said',
  /qui[eé]n le dijo|who told you|doctor le dijo/i.test(r2.response));
check('T2: NOT generic fallback',
  !/d[eé]me un poco m[aá]s|tell me more|give me a bit more detail/i.test(r2.response));

console.log('\n=== PROVIDER-SAID TOLD-TO-CHANGE DETECTOR ===');
check('"mi doctor dice q debo cambiar" → told',
  detectToldToChange('mi doctor dice q debo cambiar de plan'));
check('"mi doctor me dijo que cambie" → told',
  detectToldToChange('mi doctor me dijo que cambie de plan'));
check('"my doctor told me to change plans" → told',
  detectToldToChange('my doctor told me to change plans'));
check('"my specialist said I should switch" → told',
  detectToldToChange('my specialist said I should switch'));
check('"mi especialista dijo q debo cambiar" → told',
  detectToldToChange('mi especialista dijo q debo cambiar de plan'));

console.log('\n=== SPANISH q → que NORMALIZATION ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('07407', s).newState;
const r3 = processMessage('me dijeron q debo cambiar', s);
check('q normalizes: subIssue=told_to_change_plan',
  r3.newState.subIssue === 'told_to_change_plan');

console.log('\n=== DOCTOR BROAD STILL SHORT ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r4 = processMessage('tengo problemas con mi doctor', s);
check('Doctor broad: short response (<35 words)',
  r4.response.split(/\s+/).length <= 35);
check('Doctor broad: asks what happened',
  /qu[eé] pas[oó] con su doctor/i.test(r4.response));

console.log('\n=== EXPLICIT CHANGE PLAN STILL → ENROLLMENT ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r5 = processMessage('quiero cambiar de plan', s);
check('Explicit: still routes enrollment',
  /aep|iep|sep|inscripci|enrollment/i.test(r5.response)
    || r5.newState.intent === 'enrollment');

console.log('\n=== NEGATION + PROVIDER SOURCE COMBINED ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('07407', s).newState;
s = processMessage('mi doctor dice q debo cambiar de plan', s).newState;
const r6 = processMessage('no quiero cambiar', s);
check('Negation + provider source: doesNotWantPlanChange=true',
  r6.newState.doesNotWantPlanChange === true);
check('Negation + provider source: NO enrollment',
  !/iep|aep|sep/i.test(r6.response));

console.log('\n=== REGRESSION: V29 meds flow ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
s = processMessage('i have problems with my meds', s).newState;
const r7 = processMessage('they dont wan tocver my med', s);
check('V29 meds: subIssue=drug_not_covered',
  r7.newState.subIssue === 'drug_not_covered');

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

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

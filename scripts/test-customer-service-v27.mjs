// Wave 27 — Human conversation context: negated plan change + specialist.
// Sawil's exact failing flow + new acceptance criteria.

import {
  processMessage,
  createInitialState,
  detectNegatedPlanChange,
  detectToldToChange,
  detectExplicitWantToChange,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== NEGATED PLAN CHANGE DETECTOR ===');
check('"no quiero cambiar de plan" → negated',
  detectNegatedPlanChange('no quiero cambiar de plan'));
check('"no quiero cambiar de especialista" → negated',
  detectNegatedPlanChange('no quiero cambiar de especialista'));
check('"no quiero perder mi doctor" → negated',
  detectNegatedPlanChange('no quiero perder mi doctor'));
check('"I don\'t want to change plans" → negated',
  detectNegatedPlanChange("I don't want to change plans"));
check('"I do not want to lose my doctor" → negated',
  detectNegatedPlanChange("I do not want to lose my doctor"));
check('"i will not switch" → negated',
  detectNegatedPlanChange("I won't switch"));
check('"quiero cambiar" → NOT negated', !detectNegatedPlanChange('quiero cambiar'));
check('"I want to change" → NOT negated',
  !detectNegatedPlanChange('I want to change'));

console.log('\n=== TOLD-TO-CHANGE DETECTOR ===');
check('"me dijeron que debería cambiar" → told',
  detectToldToChange('me dijeron que debería cambiar de plan'));
check('"me dijeron que tengo que cambiar" → told',
  detectToldToChange('me dijeron que tengo que cambiar'));
check('"they told me to change" → told',
  detectToldToChange('they told me to change my plan'));
check('"I was told to switch" → told',
  detectToldToChange('I was told to switch'));
check('"me obligaron a cambiar" → told',
  detectToldToChange('me obligaron a cambiar'));
check('"quiero cambiar" → NOT told', !detectToldToChange('quiero cambiar'));

console.log('\n=== EXPLICIT WANT TO CHANGE DETECTOR ===');
check('"quiero cambiar de plan" → explicit',
  detectExplicitWantToChange('quiero cambiar de plan'));
check('"I want to change plans" → explicit',
  detectExplicitWantToChange('I want to change plans'));
check('"me quiero inscribir" → explicit',
  detectExplicitWantToChange('me quiero inscribir'));
check('"no quiero cambiar" → NOT explicit (negation wins)',
  !detectExplicitWantToChange('no quiero cambiar'));

console.log('\n=== SAWIL EXACT FAILING FLOW (Spanish specialist) ===');
let s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10033', s).newState;
const r1 = processMessage('tengo problemas con mi especialista', s);
s = r1.newState;
check('T1: serviceCategory=doctor_provider_network',
  s.serviceCategory === 'doctor_provider_network',
  `category=${s.serviceCategory} intent=${s.intent}`);
check('T1: NOT generic coverage paragraph',
  !/cobertura es uno de los temas m[aá]s importantes/i.test(r1.response));
// V30 — clarification shortened to broad "what happened with your specialist".
check('T1: response is short specialist clarification',
  /qu[eé] pas[oó] con su especialista/i.test(r1.response),
  `response="${r1.response.slice(0, 250)}"`);
check('T1: short response (<55 words)', r1.response.split(/\s+/).length < 55);

const r2 = processMessage('me dijeron q deberia cambiar de plan no quiero cambiar de plan ni de especialista', s);
s = r2.newState;
check('T2: stays in doctor_provider_network',
  s.serviceCategory === 'doctor_provider_network');
check('T2: intent NOT enrollment',
  s.intent !== 'enrollment' && s.intent !== 'enrollment_windows');
check('T2: doesNotWantPlanChange=true',
  s.doesNotWantPlanChange === true);
check('T2: subIssue=told_to_change_plan',
  s.subIssue === 'told_to_change_plan');
check('T2: wantsToKeepSpecialist=true',
  s.wantsToKeepSpecialist === true);
check('T2: NO IEP/AEP/SEP in response',
  !/iep|aep|sep|periodo (anual )?de inscripci[oó]n|inscripci[oó]n a medicare/i.test(r2.response),
  `response="${r2.response.slice(0, 200)}"`);
check('T2: acknowledges user does not want to change',
  /no quiere cambiar|si usted no quiere|no vamos a asumir/i.test(r2.response));
check('T2: says first step is verification',
  /verificar|primero hay que|first.*verify/i.test(r2.response));
check('T2: asks who told them',
  /qui[eé]n le dijo|who told you/i.test(r2.response));
check('T2: NOT generic fallback',
  !/d[eé]me un poco m[aá]s de detalle|give me a bit more detail/i.test(r2.response));

const r3 = processMessage('me lo dijo el especialista', s);
s = r3.newState;
check('T3: acknowledges info + offers verification',
  /verificar|red|autorizaci|advisor|asesor/i.test(r3.response));
check('T3: NOT pressure to change plan',
  !/should change|debe cambiar|tiene que cambiar/i.test(r3.response));

console.log('\n=== EXPLICIT PLAN CHANGE: enrollment SHOULD fire ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rExp = processMessage('I want to change my plan', s);
check('Explicit: intent=enrollment', rExp.newState.intent === 'enrollment');
check('Explicit: bot mentions enrollment windows',
  /iep|aep|sep|enrollment|inscripci/i.test(rExp.response));

console.log('\n=== "TOLD TO CHANGE" without negation ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10033', s).newState;
const rTold = processMessage('someone told me I should change my plan', s);
check('Told: serviceCategory=doctor_provider_network',
  rTold.newState.serviceCategory === 'doctor_provider_network');
check('Told: subIssue=told_to_change_plan',
  rTold.newState.subIssue === 'told_to_change_plan');
check('Told: NO AEP/IEP/SEP',
  !/iep|aep|sep/i.test(rTold.response));
check('Told: asks who told them',
  /who told you|qui[eé]n le dijo/i.test(rTold.response));

console.log('\n=== ENGLISH NEGATED FLOW ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10033', s).newState;
const rE1 = processMessage('my specialist has a problem', s);
s = rE1.newState;
check('EN T1: doctor_provider_network', s.serviceCategory === 'doctor_provider_network');
const rE2 = processMessage("they told me I should change plans but I don't want to change my plan or specialist", s);
check('EN T2: NOT enrollment', rE2.newState.intent !== 'enrollment');
check('EN T2: doesNotWantPlanChange=true', rE2.newState.doesNotWantPlanChange === true);
check('EN T2: NO IEP/AEP/SEP', !/iep|aep|sep/i.test(rE2.response));
check('EN T2: acknowledges preference + asks WHO',
  /won'?t assume change|who told you/i.test(rE2.response));

console.log('\n=== "I don\'t want to lose my doctor" ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rLose = processMessage("I don't want to lose my doctor", s);
check('Lose: serviceCategory=doctor_provider_network',
  rLose.newState.serviceCategory === 'doctor_provider_network');
check('Lose: NO plan recommendation',
  !/best plan|should change/i.test(rLose.response));

console.log('\n=== SPANISH USTED FORM PRESERVED ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10033', s).newState;
const rUsted = processMessage('tengo problemas con mi especialista', s);
check('USTED: no "tú"', !/\bt[uú]\b/i.test(rUsted.response));

console.log('\n=== ONE QUESTION AT A TIME ===');
const questionMarks = (rUsted.response.match(/\?/g) || []).length;
check('T1 specialist: max 1 question (got ' + questionMarks + ')', questionMarks <= 1);

console.log('\n=== REGRESSION: existing tests still pass ===');
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
const rC988 = processMessage('I want to die', s);
check('988 still routes', /988/.test(rC988.response));

// V26 doctor flow
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10033', s).newState;
s = processMessage('i have a problem with my doctors', s).newState;
const rV26 = processMessage('they no longer work with my insurance', s);
check('V26 doctor: subIssue=provider_left_network', rV26.newState.subIssue === 'provider_left_network');
check('V26 doctor: response mentions network',
  /network|red/i.test(rV26.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

// Wave 31 — Medication 14-category triage proof-of-fix.
// Sawil's exact failing flow + 10 required cases (A–J).

import {
  processMessage,
  createInitialState,
  detectMedicationAnswer,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// ── Helper: drive a state forward through messages ───────────────────────
function drive(msgs, lang = 'english', zip = '10550') {
  let s = createInitialState();
  s = processMessage(lang, s).newState;
  s = processMessage(zip, s).newState;
  let last;
  for (const m of msgs) {
    last = processMessage(m, s);
    s = last.newState;
  }
  return { state: s, last };
}

console.log('\n=== DETECTOR: detectMedicationAnswer ===');
check('"they don\'t want to pay" → ambiguous cover_or_price',
  (() => { const r = detectMedicationAnswer("they don't want to pay"); return r.category === 'ambiguous' && r.hint === 'cover_or_price'; })());
check('"no quieren pagar" → ambiguous cover_or_price',
  (() => { const r = detectMedicationAnswer('no quieren pagar'); return r.category === 'ambiguous' && r.hint === 'cover_or_price'; })());
check('"the pharmacy" → pharmacy_rejected',
  detectMedicationAnswer('the pharmacy').category === 'pharmacy_rejected');
check('"la farmacia" → pharmacy_rejected',
  detectMedicationAnswer('la farmacia').category === 'pharmacy_rejected');
check('"too expensive" → cost_too_high',
  detectMedicationAnswer('too expensive').category === 'cost_too_high');
check('"muy caro" → cost_too_high',
  detectMedicationAnswer('muy caro').category === 'cost_too_high');
check('"prior authorization" → prior_auth',
  detectMedicationAnswer('prior authorization').category === 'prior_auth');
check('"autorización previa" → prior_auth',
  detectMedicationAnswer('autorización previa').category === 'prior_auth');
check('"step therapy" → step_therapy',
  detectMedicationAnswer('step therapy').category === 'step_therapy');
check('"quantity limit" → quantity_limit',
  detectMedicationAnswer('quantity limit').category === 'quantity_limit');
check('"refill too soon" → refill_too_soon',
  detectMedicationAnswer('refill too soon').category === 'refill_too_soon');
check('"muy pronto" → refill_too_soon',
  detectMedicationAnswer('es muy pronto para reabastecer').category === 'refill_too_soon');
check('"advisor" → wants_advisor',
  detectMedicationAnswer('advisor').category === 'wants_advisor');
check('"call me" → wants_advisor',
  detectMedicationAnswer('call me').category === 'wants_advisor');
check('"asesor" → wants_advisor',
  detectMedicationAnswer('necesito un asesor').category === 'wants_advisor');
check('"español" → switch_language',
  detectMedicationAnswer('español').category === 'switch_language');
check('"no entiendo inglés" → switch_language',
  detectMedicationAnswer('no entiendo inglés').category === 'switch_language');
check('"no" → short_no',
  detectMedicationAnswer('no').category === 'short_no');
check('"no sé" → short_idk',
  detectMedicationAnswer('no sé').category === 'short_idk');
check('"idk" → short_idk',
  detectMedicationAnswer('idk').category === 'short_idk');
check('"la farmacia rechazó" → pharmacy_rejected',
  detectMedicationAnswer('la farmacia lo rechazó').category === 'pharmacy_rejected');
check('"not covered" → not_covered',
  detectMedicationAnswer('not covered').category === 'not_covered');
check('"hello" → unknown',
  detectMedicationAnswer('hello').category === 'unknown');

console.log('\n=== CASE A: "they don\'t want to pay" → NOT generic fallback ===');
{
  const { state: s, last: r } = drive(['i have problems with my meds', "they don't want to pay"]);
  check('A: serviceCategory=drug', s.serviceCategory === 'drug');
  check('A: NOT generic fallback',
    !/give me a bit more detail|d[eé]me un poco m[aá]s/i.test(r.response),
    `response="${r.response.slice(0, 200)}"`);
  check('A: asks pharmacy vs price',
    /pharmacy reject.*price|reject.*price.*high|did the pharmacy reject/i.test(r.response));
  check('A: askedQuestions contains med_pharmacy_vs_price',
    (s.askedQuestions || []).includes('med_pharmacy_vs_price'));
}

console.log('\n=== CASE B: "the pharmacy" after payment complaint → pharmacy_rejected ===');
{
  const { state: s, last: r } = drive([
    'i have problems with my meds',
    "they don't want to pay",
    'the pharmacy',
  ]);
  check('B: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('B: asks reason (PA / not covered / refill / qty)',
    /prior auth.{0,30}not covered|not covered.{0,30}refill|reason.*authorization|like prior authorization/i.test(r.response));
  check('B: askedQuestions contains med_pharmacy_reason',
    (s.askedQuestions || []).includes('med_pharmacy_reason'));
}

console.log('\n=== CASE C: "no" after pharmacy reason question → advisor offer ===');
{
  const { state: s, last: r } = drive([
    'i have problems with my meds',
    "they don't want to pay",
    'the pharmacy',
    'no',
  ]);
  check('C: needsHuman=true (advisor handoff)',
    r.needsHuman === true || s.needsHuman === true);
  check('C: advisorHandoffReason set',
    !!s.advisorHandoffReason,
    `reason=${s.advisorHandoffReason}`);
  check('C: response offers advisor follow-up',
    /licensed advisor|asesor licenciado|would you like an advisor|le gustar[ií]a que un asesor/i.test(r.response));
  check('C: response warns about PHI',
    /medicare id|ssn|seguro social|n[uú]mero de medicare|banking|bancaria/i.test(r.response));
  check('C: NOT a restart of language/zip',
    !/what language|qu[eé] idioma|zip code|c[oó]digo postal/i.test(r.response));
}

console.log('\n=== CASE D: Spanish "la farmacia dice que no lo cubre" ===');
{
  const { state: s, last: r } = drive(
    ['tengo problemas con mi medicina', 'la farmacia dice que no lo cubre'],
    'español', '10550',
  );
  check('D: serviceCategory=drug', s.serviceCategory === 'drug');
  check('D: NOT generic fallback',
    !/d[eé]me un poco m[aá]s/i.test(r.response));
  check('D: detects not covered context',
    /cubr|carta del plan|cubierta|rechaz/i.test(r.response));
}

console.log('\n=== CASE E: Spanish "no sé" → simplify + advisor offer ===');
{
  const { state: s, last: r } = drive(
    ['tengo problemas con mi medicina', 'no sé'],
    'español', '10550',
  );
  check('E: advisorHandoffReason set',
    !!s.advisorHandoffReason);
  check('E: needsHuman=true', r.needsHuman === true || s.needsHuman === true);
  check('E: offers advisor in Spanish',
    /asesor licenciado|le gustar[ií]a que un asesor/i.test(r.response));
}

console.log('\n=== CASE F: English "too expensive" → cost_too_high ===');
{
  const { state: s, last: r } = drive(
    ['i have problems with my meds', 'too expensive'],
  );
  check('F: medicationIssueType=cost_too_high',
    s.medicationIssueType === 'cost_too_high');
  check('F: response mentions cost / Extra Help / advisor',
    /extra help|copay|advisor|cost too high/i.test(r.response));
  check('F: no plan recommendation',
    !/best plan|recommended plan|should change plan/i.test(r.response));
}

console.log('\n=== CASE G: English "prior authorization" → prior_auth ===');
{
  const { state: s, last: r } = drive(
    ['i have problems with my meds', 'prior authorization'],
  );
  check('G: medicationIssueType=prior_auth',
    s.medicationIssueType === 'prior_auth');
  check('G: response explains PA + offers advisor',
    /prior authorization|advisor|doctor.*plan/i.test(r.response));
}

console.log('\n=== CASE H: "advisor" → immediate handoff ===');
{
  const { state: s, last: r } = drive(
    ['i have problems with my meds', 'I want to talk to an advisor'],
  );
  check('H: needsHuman OR advisor flow triggered',
    r.needsHuman === true || s.needsHuman === true
      || /advisor|asesor/i.test(r.response));
}

console.log('\n=== CASE I: switches to Spanish mid-flow → preserve medication context ===');
{
  const { state: s, last: r } = drive(
    ['i have problems with my meds', 'español'],
  );
  check('I: language=es', s.language === 'es');
  check('I: serviceCategory still drug', s.serviceCategory === 'drug');
  check('I: response in Spanish, mentions medicamento',
    /medicamento|farmacia|costo|cobertura/i.test(r.response));
  check('I: does NOT restart with language prompt',
    !/qu[eé] idioma|what language/i.test(r.response));
}

console.log('\n=== CASE J: Repeated vague answer twice → offer advisor ===');
{
  const { state: s, last: r } = drive(
    ['i have problems with my meds', "they don't want to pay", "they don't want to pay"],
  );
  check('J: needsHuman=true after repeat', r.needsHuman === true || s.needsHuman === true);
  check('J: response offers advisor',
    /advisor|asesor|follow up|le contact/i.test(r.response));
}

console.log('\n=== SAWIL EXACT FAILING FLOW (full path) ===');
{
  // Per spec: "i have problems with my meds" → "they don't want to pay"
  // → "the pharmacy" → "no" should end with advisor offer + PHI warning.
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('10550', s).newState;
  const r1 = processMessage('i have problems with my meds', s);
  s = r1.newState;
  check('Sawil T1: subIssue=vague_report', s.subIssue === 'vague_report');
  check('Sawil T1: short response, asks pharmacy/cost/letter',
    /pharmacy|cost|letter|expensive|not covered/i.test(r1.response));

  const r2 = processMessage("they don't want to pay", s);
  s = r2.newState;
  check('Sawil T2: asks pharmacy reject vs price',
    /pharmacy reject|reject.*price|did the pharmacy/i.test(r2.response),
    `r2="${r2.response.slice(0, 200)}"`);
  check('Sawil T2: NOT generic fallback',
    !/give me a bit more detail/i.test(r2.response));

  const r3 = processMessage('the pharmacy', s);
  s = r3.newState;
  check('Sawil T3: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('Sawil T3: asks reason',
    /prior authorization|reason|not covered|refill/i.test(r3.response),
    `r3="${r3.response.slice(0, 200)}"`);

  const r4 = processMessage('no', s);
  s = r4.newState;
  check('Sawil T4: advisor handoff',
    r4.needsHuman === true || s.needsHuman === true);
  check('Sawil T4: offers licensed advisor',
    /licensed advisor|asesor licenciado/i.test(r4.response));
  check('Sawil T4: warns about Medicare/SSN/banking PHI',
    /medicare id|ssn|banking|seguro social|n[uú]mero de medicare|bancaria/i.test(r4.response));
  check('Sawil T4: NOT a restart',
    !/what language|qu[eé] idioma|zip code|c[oó]digo postal/i.test(r4.response));
}

console.log('\n=== REGRESSION: existing V29/V30 flows still pass ===');
// V29 meds → not covered continuation
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('10550', s).newState;
  s = processMessage('i have problems with my meds', s).newState;
  const r = processMessage('they dont wan tocver my med', s);
  check('V29 not_covered still works',
    r.newState.subIssue === 'drug_not_covered'
      || /not covered|cubr/i.test(r.response));
}

// V30 provider-said routing
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage('tengo problemas', s).newState;
  const r = processMessage('mi doctor dice q debo cambiar de plan', s);
  check('V30 provider-said → told_to_change_plan',
    r.newState.subIssue === 'told_to_change_plan');
  check('V30 NO enrollment routing',
    !/iep|aep|sep|inscripci[oó]n a medicare/i.test(r.response));
}

// Antonio
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('no', s).newState;
  s = processMessage('tengo un cobro de medicamentos', s).newState;
  s = processMessage('DE LA FARMACIA', s).newState;
  check('Antonio: billSource=pharmacy', s.billSource === 'pharmacy');
}

// 988
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  const r = processMessage('I want to die', s);
  check('988 still routes', /988/.test(r.response));
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

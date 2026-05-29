// Wave 29 — Typo/shorthand normalization + medication continuation +
// restrict broad chip menu. Sawil's exact meds typo flow.

import {
  processMessage,
  createInitialState,
  detectVagueProblemReport,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== TYPO/SHORTHAND VAGUE DETECTION ===');
check('"i have problems with my meds" → vague medication',
  (() => { const r = detectVagueProblemReport('i have problems with my meds'); return r.isVague && r.topic === 'medication'; })());
check('"my med has a problem" → vague medication',
  (() => { const r = detectVagueProblemReport('my med has a problem'); return r.isVague && r.topic === 'medication'; })());
check('"problem with my doc" → vague doctor',
  (() => { const r = detectVagueProblemReport('problem with my doc'); return r.isVague && r.topic === 'doctor'; })());
check('"my rx has issues" → vague medication',
  (() => { const r = detectVagueProblemReport('my rx has issues'); return r.isVague && r.topic === 'medication'; })());

console.log('\n=== SAWIL EXACT FLOW: meds typo + not covered ===');
let s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
const r1 = processMessage('i have problems with my meds', s);
s = r1.newState;
check('T1: serviceCategory=drug', s.serviceCategory === 'drug');
check('T1: subIssue=vague_report', s.subIssue === 'vague_report');
check('T1: asks expensive/not covered/pharmacy',
  /expensive|not covered|pharmacy could not process|costo|cubrieron|farmacia/i.test(r1.response),
  `response="${r1.response.slice(0, 200)}"`);
check('T1: NOT generic fallback',
  !/give me a bit more detail|d[eé]me un poco m[aá]s/i.test(r1.response));
check('T1: NO broad chips',
  (s.quickReplies || []).length < 5);

const r2 = processMessage('they dont wan tocver my med', s);
s = r2.newState;
check('T2: serviceCategory stays drug',
  s.serviceCategory === 'drug');
check('T2: subIssue=drug_not_covered',
  s.subIssue === 'drug_not_covered');
check('T2: response mentions not covered / coverage / review',
  /not covered|may not be covered|review|cubrirla|cubierta|cubr/i.test(r2.response));
check('T2: asks pharmacy vs plan letter',
  /pharmacy.*letter|letter.*pharmacy|farmacia.*carta|carta.*farmacia/i.test(r2.response));
check('T2: NOT generic fallback',
  !/give me a bit more detail|d[eé]me un poco m[aá]s/i.test(r2.response));
check('T2: NO broad chips after category active',
  (s.quickReplies || []).length === 0);

console.log('\n=== PHARMACY SHORTHAND ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
const r3 = processMessage('pharm said my rx not covered', s);
check('T3: serviceCategory=drug', r3.newState.serviceCategory === 'drug');
check('T3: detects not covered',
  /not covered|coverage|cubr|covered/i.test(r3.response));

console.log('\n=== SPANISH MEDICINE FLOW ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r4 = processMessage('tengo problema con mi medicina', s);
check('T4: asks cost/not covered/pharmacy',
  /costo|cubrieron|farmacia/i.test(r4.response));

const r5 = processMessage('no me quieren cubrir la medicina', s);
check('T5: detects not covered',
  /cubierta|cubr|cubrirla|carta del plan/i.test(r5.response));

console.log('\n=== SPANGLISH MEDICINE ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
const r6 = processMessage('la pharmacy dont cover my medicina', s);
check('T6: serviceCategory=drug', r6.newState.serviceCategory === 'drug');
check('T6: NOT generic fallback',
  !/give me a bit more detail/i.test(r6.response));

console.log('\n=== DOCTOR / BILL / LETTER REGRESSION ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r7 = processMessage('tengo problemas con mi doctor', s);
check('Doctor broad: asks what happened',
  /qu[eé] pas[oó] con su doctor/i.test(r7.response));

s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const r8 = processMessage('me llegó un bill', s);
check('Bill broad: asks amount due / EOB',
  /amount due|usted debe pagar|explicaci[oó]n de beneficios/i.test(r8.response));

s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
const r9 = processMessage('I got a letter', s);
check('Letter broad: asks who sent it',
  /medicare|medicaid|social security|your plan/i.test(r9.response));

console.log('\n=== NO BROAD CHIPS WHEN CATEGORY ACTIVE ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
s = processMessage('i have problems with my meds', s).newState;
// Now in drug category. Send vague follow-up — should NOT get broad menu.
const r10a = processMessage('hmm', s);
const r10b = processMessage('uh', r10a.newState);
check('No broad chips after category active: 1st vague',
  !(r10a.newState.quickReplies || []).includes('Bill'));
check('No broad chips after category active: 2nd vague',
  !(r10b.newState.quickReplies || []).includes('Bill'));

console.log('\n=== BROAD CHIPS ALLOWED FOR TRULY UNKNOWN ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
const r11a = processMessage('asdf', s);
const r11b = processMessage('random', r11a.newState);
// 2nd unknown with NO serviceCategory → broad chips allowed
check('Broad chips allowed when truly unknown',
  (r11b.newState.quickReplies || []).length > 0
  || /factura|bill|doctor/i.test(r11b.response));

console.log('\n=== NO REPEATED GENERIC FALLBACK ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('10550', s).newState;
s = processMessage('i have problems with my meds', s).newState;
const r12a = processMessage('hmm', s);
const r12b = processMessage('uhh', r12a.newState);
check('Different responses on repeated vague (category active)',
  r12a.response !== r12b.response);
check('2nd response is category-specific (drug)',
  /pharmacy|letter|farmacia|carta|cubr/i.test(r12b.response));

console.log('\n=== REGRESSION ===');
// V28 vague doctor
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10550', s).newState;
const rD = processMessage('tengo problemas con mi doctor', s);
check('V28 vague doctor still works',
  /qu[eé] pas[oó] con su doctor/i.test(rD.response));

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

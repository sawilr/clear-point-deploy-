// Wave 21 — undefined fix + fuzzy typo + bill drill-down.
// Verifies Sawil's Tests A/B/C/D plus enterprise safety guards.

import {
  processMessage,
  createInitialState,
  safeName,
  withName,
  sanitizeResponse,
  fuzzyConcept,
  parseAmount,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== SAFE NAME / WITH NAME ===');
check('safeName(undefined) → ""', safeName(undefined) === '');
check('safeName(null) → ""', safeName(null) === '');
check('safeName("") → ""', safeName('') === '');
check('safeName("  ") → ""', safeName('  ') === '');
check('safeName("undefined") → ""', safeName('undefined') === '');
check('safeName("null") → ""', safeName('null') === '');
check('safeName("John") → "John"', safeName('John') === 'John');
check('safeName("  Maria  ") → "Maria"', safeName('  Maria  ') === 'Maria');
check('withName(undefined) → ""', withName(undefined) === '');
check('withName("John") → ", John"', withName('John') === ', John');

console.log('\n=== SANITIZE RESPONSE — no undefined/null/NaN reaches user ===');
check('strips "undefined"',
  !/undefined/.test(sanitizeResponse('Hola, undefined. ¿Cómo está?', true)),
  `result="${sanitizeResponse('Hola, undefined. ¿Cómo está?', true)}"`);
check('strips ", undefined" with comma',
  !/undefined/.test(sanitizeResponse('Anotado, undefined. Es un cobro.', true)));
check('strips "null"',
  !/null/.test(sanitizeResponse('Test null result', true)));
check('strips "NaN"',
  !/NaN/.test(sanitizeResponse('Cost is $NaN dollars', true)));
check('empty string → ES fallback',
  /factura|carta|cobertura/i.test(sanitizeResponse('', true)));
check('empty string → EN fallback',
  /bill|letter|coverage/i.test(sanitizeResponse('', false)));
check('clean string passes through',
  sanitizeResponse('Hello, John. How are you?', false) === 'Hello, John. How are you?');

console.log('\n=== FUZZY CONCEPT MATCHING ===');
// Spanish typos
check('"hopital" → hospital', fuzzyConcept('hopital') === 'hospital');
check('"ospital" → hospital', fuzzyConcept('ospital') === 'hospital');
check('"hospitl" → hospital', fuzzyConcept('hospitl') === 'hospital');
check('"facyuta" → bill', fuzzyConcept('facyuta') === 'bill');
check('"factuta" → bill', fuzzyConcept('factuta') === 'bill');
check('"fatura" → bill', fuzzyConcept('fatura') === 'bill');
check('"farmasia" → pharmacy', fuzzyConcept('farmasia') === 'pharmacy');
check('"pharmcy" → pharmacy', fuzzyConcept('pharmcy') === 'pharmacy');
check('"dotor" → doctor', fuzzyConcept('dotor') === 'doctor');
check('"doctol" → doctor', fuzzyConcept('doctol') === 'doctor');
check('"medico" → doctor', fuzzyConcept('medico') === 'doctor');
check('"recibi una facyuta de 10k" → bill', fuzzyConcept('recibi una facyuta de 10k') === 'bill');
check('"voy al hopital" → hospital', fuzzyConcept('voy al hopital') === 'hospital');
// English typos
check('"hospitl" → hospital', fuzzyConcept('hospitl') === 'hospital');
check('"pharmcy" → pharmacy', fuzzyConcept('pharmcy') === 'pharmacy');

console.log('\n=== PARSE AMOUNT — $10k, $10000, 10 mil ===');
check('"10k" → 10000', parseAmount('10k') === 10000);
check('"10K" → 10000', parseAmount('10K') === 10000);
check('"$10k" → 10000', parseAmount('$10k') === 10000);
check('"recibi una factura de 10k" → 10000', parseAmount('recibi una factura de 10k') === 10000);
check('"1.5k" → 1500', parseAmount('1.5k') === 1500);
check('"10 mil" → 10000', parseAmount('10 mil') === 10000);
check('"$10,000" → 10000', parseAmount('$10,000') === 10000);
check('"$10000" → 10000', parseAmount('$10000') === 10000);
check('"18 dolares" → 18', parseAmount('18 dolares') === 18);
check('"18 dollars" → 18', parseAmount('18 dollars') === 18);
check('"18 de copay" → 18', parseAmount('18 de copay') === 18);
check('"5000" bare → 5000', parseAmount('5000') === 5000);

console.log('\n=== SAWIL TEST A: Spanish hospital bill typo flow ===');
// español → Factura → hopital → recibi una facyuta de 10k
let s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
check('A.1: intent=bill after "Factura"', s.intent === 'bill');
check('A.1: bot asks bill source (no ZIP)',
  !/c[oó]digo postal/i.test(s.messages.at(-1).content));
check('A.1: no "undefined" in response', !/undefined/.test(s.messages.at(-1).content));

s = processMessage('hopital', s).newState;
check('A.2: billSource detected as provider', s.billSource === 'provider');
check('A.2: intent stays bill (sticky)', s.intent === 'bill');
check('A.2: no "undefined"', !/undefined/.test(s.messages.at(-1).content));

const rA3 = processMessage('recibi una facyuta de 10k', s);
s = rA3.newState;
check('A.3: amount=10000 detected', s.amountMentioned === '10000');
check('A.3: response mentions $10,000',
  /10,000/.test(rA3.response),
  `response="${rA3.response.slice(0, 200)}"`);
check('A.3: response asks amount due/balance due/patient responsibility',
  /amount due|balance due|patient responsibility/i.test(rA3.response));
check('A.3: response in Spanish',
  /entiendo|confirmar|usted/i.test(rA3.response));
check('A.3: NO ZIP asked',
  !/c[oó]digo postal/i.test(rA3.response));
check('A.3: NO "undefined"',
  !/undefined/.test(rA3.response));
check('A.3: NO "null"',
  !/\bnull\b/.test(rA3.response));
check('A.3: chips include amount-due options',
  (rA3.newState.quickReplies || []).some((c) => /amount due|balance due/i.test(c)));

console.log('\n=== SAWIL TEST B: Spanish pharmacy + dual + $18 ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('farmacia', s).newState;
check('B.1: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('tengo Medicare y Medicaid', s).newState;
check('B.2: dualEligible=true', s.dualEligible === true);
check('B.2: billSource still pharmacy (not re-asked)', s.billSource === 'pharmacy');
const rB = processMessage('me cobran 18 dolares', s);
check('B.3: amount=18', rB.newState.amountMentioned === '18');
check('B.3: response mentions Medicaid context',
  /medicaid|doble elegibilidad|copagos/i.test(rB.response));
check('B.3: NO "undefined"', !/undefined/.test(rB.response));

console.log('\n=== SAWIL TEST C: Spanish frustration recovery ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
const rC = processMessage('tu maldita madre', s);
check('C: recoveryMode=true', rC.newState.recoveryMode === true);
check('C: NO ZIP requested', !/c[oó]digo postal/i.test(rC.response));
check('C: NO name requested', !/nombre/i.test(rC.response));
check('C: NO "undefined"', !/undefined/.test(rC.response));
check('C: Spanish response ("entiendo")', /entiendo/i.test(rC.response));
// V32: recovery chips reduced to advisor-first triage menu (Sawil spec).
check('C: chips offered', (rC.newState.quickReplies || []).length >= 3);

console.log('\n=== SAWIL TEST D: English hospital bill typo ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('Bill', s).newState;
check('D.1: intent=bill', s.intent === 'bill');
s = processMessage('hospitl', s).newState;
check('D.2: billSource=provider (fuzzy hospitl)', s.billSource === 'provider');
const rD = processMessage('I got a bill for 10k', s);
check('D.3: amount=10000', rD.newState.amountMentioned === '10000');
check('D.3: response English only', !/entiendo|gracias por contarme/i.test(rD.response));
check('D.3: mentions $10,000', /10,000/.test(rD.response));
check('D.3: asks amount due/balance/patient responsibility',
  /amount due|balance due|patient responsibility/i.test(rD.response));
check('D.3: NO ZIP', !/5-digit zip/i.test(rD.response));
check('D.3: NO "undefined"', !/undefined/.test(rD.response));

console.log('\n=== INTENT STICKINESS ===');
// After Bill chip, typing nonsense should NOT reset to general
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('Bill', s).newState;
check('sticky setup: intent=bill', s.intent === 'bill');
s = processMessage('asdfgh', s).newState; // gibberish
check('sticky: intent stays bill after gibberish', s.intent === 'bill');

console.log('\n=== UNDEFINED NEVER LEAKS ===');
// Simulate user who never gives a name. All bot responses must be undefined-free.
s = createInitialState();
let allResponses = [];
const turns = ['english', 'Bill', 'hospital', 'a bill for 10k', 'amount due', 'Talk to advisor', 'José'];
for (const t of turns) {
  const r = processMessage(t, s);
  s = r.newState;
  allResponses.push(r.response);
}
check('NO "undefined" across full bill flow',
  allResponses.every((r) => !/undefined/.test(r)),
  `found in: ${allResponses.filter((r) => /undefined/.test(r))[0]?.slice(0, 100) || 'none'}`);
check('NO "null" tokens',
  allResponses.every((r) => !/\bnull\b/.test(r)));
check('NO "NaN" tokens',
  allResponses.every((r) => !/\bNaN\b/.test(r)));
check('NO "[object Object]"',
  allResponses.every((r) => !/\[object Object\]/.test(r)));

console.log('\n=== ANTONIO REGRESSION (Wave 17 still passes) ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('Antonio: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s).newState;
check('Antonio: dualEligible=true', s.dualEligible === true);
const rAntonio = processMessage('PAGUE 18 DOLARES DE COPAY', s);
check('Antonio: amount=18', rAntonio.newState.amountMentioned === '18');
check('Antonio: NO "undefined" in response',
  !/undefined/.test(rAntonio.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

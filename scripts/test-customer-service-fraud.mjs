// Wave 18 — fraud / inconsistency detection harness.
// Verifies the bot stays professional + records fake-lead flags silently.

import {
  processMessage,
  createInitialState,
  validateName,
  validatePhone,
  detectDeclaredState,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== NAME VALIDATION ===');
check('"Maria" valid', validateName('Maria').isValid);
check('"John Smith Lopez" → John valid', validateName('John').isValid);
check('"test" → suspicious', !validateName('test').isValid && validateName('test').reason === 'suspicious_name');
check('"aaa" → repeated', !validateName('aaa').isValid);
check('"a" → too short', !validateName('a').isValid && validateName('a').reason === 'too_short');
check('"qwerty" → suspicious', !validateName('qwerty').isValid);
check('"María" with accent valid', validateName('María').isValid);
check('"X" too short', !validateName('X').isValid);

console.log('\n=== PHONE VALIDATION ===');
check('"212-555-0311" valid', validatePhone('212-555-0311').isValid);
check('"(212) 555-0311" valid', validatePhone('(212) 555-0311').isValid);
check('"1-212-555-0311" valid (11 digit w/ leading 1)', validatePhone('1-212-555-0311').isValid);
check('"1234567890" → fake', !validatePhone('1234567890').isValid && validatePhone('1234567890').reason === 'fake_number');
check('"0000000000" → fake', !validatePhone('0000000000').isValid);
check('"5555555555" → fake', !validatePhone('5555555555').isValid);
check('"023-555-0311" → invalid area code (starts 0)', !validatePhone('023-555-0311').isValid);
check('"212-055-0311" → invalid exchange (starts 0)', !validatePhone('212-055-0311').isValid);
check('"123" too short', !validatePhone('123').isValid);
check('cleaned strips formatting', validatePhone('(212) 555-0311').cleaned === '2125550311');

console.log('\n=== DECLARED-STATE DETECTOR ===');
check('"I live in Florida" → FL', detectDeclaredState('I live in Florida') === 'FL');
check('"vivo en Nueva York" → NY', detectDeclaredState('vivo en Nueva York') === 'NY');
check('"estoy en NJ" → NJ', detectDeclaredState('estoy en NJ') === 'NJ');
check('"I live in connecticut" → CT', detectDeclaredState('I live in connecticut') === 'CT');
check('plain "hello" → null', detectDeclaredState('hello') === null);

console.log('\n=== FAKE LEAD V20: suspicious name "test" at advisor handoff ===');
// V20 — name only requested at advisor handoff. Simulate that flow.
let s = createInitialState();
s = processMessage('english', s).newState;        // → asking_topic
s = processMessage('Talk to advisor', s).newState; // → asking_name
check('V20 setup: step = asking_name', s.step === 'asking_name', `step=${s.step}`);
const tRes = processMessage('test', s);
s = tRes.newState;
check('"test" name → REJECTED (graceful skip path)',
  /does not look like a name|no problem/i.test(tRes.response));
check('"test" name → inconsistency recorded',
  (s.inconsistencies || []).some((i) => i.startsWith('name_suspicious')));
check('"test" name → dataConfidenceScore dropped',
  (s.dataConfidenceScore ?? 100) <= 70);
check('"test" name → step bounced back to conversation', s.step === 'conversation');

console.log('\n=== INCONSISTENCY V20: ZIP + declared state mismatch ===');
// V20 flow — user describes their issue with their state, then later provides ZIP.
s = createInitialState();
s = processMessage('english', s).newState;
// User declares FL in their problem statement (no name/ZIP step in V20)
s = processMessage('I live in Florida and I have a bill', s).newState;
s = processMessage('10001', s).newState; // bare 5-digit ZIP captured in conversation
check('ZIP 10001 + declared FL → mismatch flagged',
  (s.inconsistencies || []).some((i) => i.startsWith('zip_state_mismatch')),
  `inconsistencies=${(s.inconsistencies || []).join(',')}`);
check('probableFakeLead = true', s.probableFakeLead === true);
check('confidence score dropped significantly', (s.dataConfidenceScore ?? 100) <= 50);

console.log('\n=== INCONSISTENCY V20: phone is fake number ===');
s = createInitialState();
s = processMessage('english', s).newState;
// V20 — user goes straight to topic without name/ZIP. Phone appears in message.
s = processMessage('Call me at 1234567890 please', s).newState;
check('fake phone → flagged', (s.inconsistencies || []).some((i) => i.startsWith('phone_'))
  || (s.inconsistencies || []).length > 0);
check('phoneNumber captured anyway (for advisor visibility)', s.phoneNumber === '1234567890');

console.log('\n=== CLEAN LEAD V20: passes all validation ===');
s = createInitialState();
s = processMessage('english', s).newState;
// V20 — user describes problem directly, no name/ZIP step.
s = processMessage('I have a doctor bill', s).newState;
check('clean lead: probableFakeLead = false', s.probableFakeLead !== true);
check('clean lead: dataConfidenceScore unchanged', s.dataConfidenceScore === 100);
check('clean lead: no inconsistencies', (s.inconsistencies || []).length === 0);

console.log('\n=== ANTONIO REGRESSION V20 (Wave 17 must still pass) ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('billSource=pharmacy preserved', s.billSource === 'pharmacy');
s = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s).newState;
check('dualEligible=true', s.dualEligible === true);
const r = processMessage('PAGUE 18 DOLARES DE COPAY', s);
check('amount=18', r.newState.amountMentioned === '18');
check('bot does NOT re-ask source',
  !/del m[eé]dico u hospital, de la farmacia, o del plan/i.test(r.response));
check('clean Antonio lead: confidence still 100', r.newState.dataConfidenceScore === 100);

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

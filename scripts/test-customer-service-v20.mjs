// Wave 20 — Issue-first architecture verification.
// Runs Sawil's 8 explicit test cases from the V20 spec.
// Architecture: language → topic chips → conversation → (identity at handoff)

import {
  processMessage,
  createInitialState,
  detectExplicitLanguageSwitch,
  TOPIC_CHIPS_EN,
  TOPIC_CHIPS_ES,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== STEP 1 (V25): LANGUAGE PICK → NATURAL ZIP ASK, no chips, no name ===');
let s = createInitialState();
let r = processMessage('english', s);
check('EN V25: step → asking_zip_natural', r.newState.step === 'asking_zip_natural');
check('EN V25: bot does NOT ask for name', !/first name|nombre/i.test(r.response));
check('EN V25: bot asks ZIP naturally', /zip code/i.test(r.response));
check('EN V25: no auto-chips', (r.newState.quickReplies || []).length === 0);

s = createInitialState();
r = processMessage('español', s);
check('ES V25: step → asking_zip_natural', r.newState.step === 'asking_zip_natural');
check('ES V25: bot does NOT ask for name', !/nombre/i.test(r.response));
check('ES V25: bot asks ZIP naturally', /c[oó]digo postal|zip code/i.test(r.response));
check('ES V25: no auto-chips', (r.newState.quickReplies || []).length === 0);

console.log('\n=== SAWIL TEST 1 (V25 update): English + TOTO at ZIP step → polite re-ask ===');
s = createInitialState();
s = processMessage('english', s).newState;
const t1 = processMessage('TOTO', s);
// V25 changed flow: after language, bot asks ZIP naturally. "TOTO" is not a
// ZIP, not a refusal, not an intent — bot politely re-asks ZIP ONCE.
// Acceptable: bot does NOT force name.
check('Test 1 V25: bot does NOT force name', !/first name/i.test(t1.response));
check('Test 1 V25: bot offers no-ZIP option', /no|skip|prefer|prefiero|tell me/i.test(t1.response));

console.log('\n=== SAWIL TEST 2: English + 12345 + FUCK YOU → recovery, no ZIP loop ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('12345', s).newState; // 5 digits but not a real intent; falls to conversation
const t2 = processMessage('FUCK YOU', s);
check('Test 2: recoveryMode = true', t2.newState.recoveryMode === true);
check('Test 2: bot does NOT loop on ZIP', !/5-digit zip/i.test(t2.response));
// V34: no-topic frustration → Case A recovery (topic menu, not advisor-first).
check('Test 2: chips offered', (t2.newState.quickReplies || []).length >= 3);
check('Test 2: topic chip present', (t2.newState.quickReplies || []).includes('Medications') || (t2.newState.quickReplies || []).includes('Doctor'));

console.log('\n=== SAWIL TEST 3 (V25 update): Spanish + TOTO at ZIP step → polite re-ask ===');
s = createInitialState();
s = processMessage('español', s).newState;
const t3 = processMessage('TOTO', s);
// V25 changed flow: bot asks ZIP first; "TOTO" triggers polite re-ask.
check('Test 3 V25: bot does NOT force name', !/nombre/i.test(t3.response));
check('Test 3 V25: response in Spanish (no English leaked)',
  !/please|thank you for telling/i.test(t3.response),
  `response="${t3.response.slice(0, 150)}"`);

console.log('\n=== SAWIL TEST 4: Spanish + "TU MALDITA MADRE" → recovery, Spanish ===');
s = createInitialState();
s = processMessage('español', s).newState;
const t4 = processMessage('TU MALDITA MADRE', s);
check('Test 4: recoveryMode = true', t4.newState.recoveryMode === true);
check('Test 4: bot does NOT ask ZIP', !/c[oó]digo postal/i.test(t4.response));
// V34: no-topic profanity → Case A recovery (asks for topic, not "no voy a repetir").
check('Test 4: response in Spanish (entiendo + tema)',
  /entiendo/i.test(t4.response) && /tema|medicamento|doctor|carta|factura/i.test(t4.response));
check('Test 4: chips in Spanish (Medicamentos)',
  (t4.newState.quickReplies || []).includes('Medicamentos'));

console.log('\n=== SAWIL TEST 5: Spanish + "me llegaron billes" → bill triage, no ZIP first ===');
s = createInitialState();
s = processMessage('español', s).newState;
const t5 = processMessage('me llegaron billes', s);
check('Test 5: intent = bill', t5.newState.intent === 'bill');
check('Test 5: bot does NOT ask ZIP', !/c[oó]digo postal/i.test(t5.response));
check('Test 5: bot does NOT ask name first', !/nombre/i.test(t5.response));
check('Test 5: bot asks source (médico/farmacia/plan)',
  /m[eé]dico|hospital|farmacia|plan/i.test(t5.response),
  `response="${t5.response.slice(0, 200)}"`);
check('Test 5: response in Spanish', !/please|thanks/i.test(t5.response));

console.log('\n=== SAWIL TEST 6: Spanish multi-turn pharmacy + dual + ZIP not asked ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('tengo cobro de medicamentos', s).newState;
s = processMessage('de la farmacia', s).newState;
const t6 = processMessage('tengo Medicare y Medicaid', s);
check('Test 6: billSource = pharmacy', s.billSource === 'pharmacy' || t6.newState.billSource === 'pharmacy');
check('Test 6: dualEligible = true', t6.newState.dualEligible === true);
check('Test 6: bot does NOT re-ask source',
  !/del m[eé]dico u hospital, de la farmacia, o del plan/i.test(t6.response));
check('Test 6: bot mentions Medicaid context',
  /medicaid|doble elegibilidad|copagos/i.test(t6.response),
  `response="${t6.response.slice(0, 200)}"`);

console.log('\n=== SAWIL TEST 7: English + "I got a bill" → English, no ZIP first ===');
s = createInitialState();
s = processMessage('english', s).newState;
const t7 = processMessage('I got a bill', s);
check('Test 7: intent = bill', t7.newState.intent === 'bill');
check('Test 7: bot does NOT ask ZIP', !/5-digit zip/i.test(t7.response));
check('Test 7: bot asks bill source',
  /doctor|hospital|pharmacy|plan/i.test(t7.response),
  `response="${t7.response.slice(0, 200)}"`);
check('Test 7: response in English (no Spanish)',
  !/por favor|gracias por contarme/i.test(t7.response));

console.log('\n=== SAWIL TEST 8: English + "My husband passed away" → compassion, no ZIP ===');
s = createInitialState();
s = processMessage('english', s).newState;
const t8 = processMessage('My husband passed away', s);
check('Test 8: emotion = grieving', t8.newState.emotionalState === 'grieving');
check('Test 8: bot expresses sorry',
  /sorry.+loss|m sorry/i.test(t8.response),
  `response="${t8.response.slice(0, 200)}"`);
check('Test 8: bot does NOT ask ZIP', !/5-digit zip|zip code/i.test(t8.response));
check('Test 8: bot offers SSA number for survivor', /1-800-772-1213/.test(t8.response));

console.log('\n=== STRICT LANGUAGE LOCK ===');
// detectExplicitLanguageSwitch
check('"factura" alone → null (does NOT switch)', detectExplicitLanguageSwitch('factura') === null);
check('"bill" alone → null', detectExplicitLanguageSwitch('bill') === null);
check('"english" → en', detectExplicitLanguageSwitch('english') === 'en');
check('"English please" → en', detectExplicitLanguageSwitch('English please') === 'en');
check('"español" → es', detectExplicitLanguageSwitch('español') === 'es');
check('"hablame en español" → es', detectExplicitLanguageSwitch('hablame en español') === 'es');
check('"hablar en español" → es', detectExplicitLanguageSwitch('hablar en español') === 'es');
check('"switch to spanish" → es', detectExplicitLanguageSwitch('switch to spanish') === 'es');
// Spanish-locked + user types "bill" → stays in Spanish
s = createInitialState();
s = processMessage('español', s).newState;
const rL1 = processMessage('bill', s);
check('Spanish-locked + "bill" → stays Spanish', rL1.newState.language === 'es');

// English-locked + user types "factura" → stays in English
s = createInitialState();
s = processMessage('english', s).newState;
const rL2 = processMessage('factura', s);
check('English-locked + "factura" → stays English', rL2.newState.language === 'en');

console.log('\n=== STRICT NAME VALIDATION (V20) ===');
// User flows into asking_name only via advisor intent
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('Talk to advisor', s).newState; // → step asking_name
check('"Talk to advisor" → step asking_name', s.step === 'asking_name',
  `step=${s.step}`);
// Now user gives "TOTO" — should REJECT and skip
const rN1 = processMessage('TOTO', s);
check('asking_name + "TOTO" → step back to conversation',
  rN1.newState.step === 'conversation');
check('asking_name + "TOTO" → name NOT captured',
  !rN1.newState.name || rN1.newState.name.toLowerCase() !== 'toto');
check('asking_name + "TOTO" → graceful skip message',
  /does not look like a name|no problem|continue without/i.test(rN1.response));
check('asking_name + "TOTO" → topic chips offered', (rN1.newState.quickReplies || []).length === 7);

// Valid name path
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('Talk to advisor', s).newState;
const rN2 = processMessage('John', s);
check('asking_name + "John" → name captured', rN2.newState.name === 'John');
check('asking_name + "John" → step = asking_zip', rN2.newState.step === 'asking_zip');
check('asking_name + "John" → ZIP prompt with V20 wording',
  /helps confirm the service area|tell me what is going on first/i.test(rN2.response));

console.log('\n=== ZIP V20 WORDING + 2-STRIKE ===');
// 1st failed ZIP — V20 wording
const rZ1 = processMessage('huh', rN2.newState);
check('1st failed ZIP → V20 wording',
  /does not look like a 5-digit ZIP|enter it again or tell me/i.test(rZ1.response),
  `response="${rZ1.response.slice(0, 200)}"`);
// 2nd failed ZIP → recovery
const rZ2 = processMessage('what', rZ1.newState);
check('2nd failed ZIP → recoveryMode = true', rZ2.newState.recoveryMode === true);

console.log('\n=== REGRESSION: Antonio flow still works (with V20 architecture) ===');
s = createInitialState();
s = processMessage('español', s).newState;
// User types problem directly (no name/ZIP step)
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('Antonio V20: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s).newState;
check('Antonio V20: dualEligible=true', s.dualEligible === true);
const rA = processMessage('PAGUE 18 DOLARES DE COPAY', s);
check('Antonio V20: amount=18', rA.newState.amountMentioned === '18');
check('Antonio V20: bot does NOT re-ask source',
  !/del m[eé]dico u hospital, de la farmacia, o del plan/i.test(rA.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

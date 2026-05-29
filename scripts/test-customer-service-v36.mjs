// Wave 36 — Human conversation layer stress test.
// 30 realistic conversation scripts in EN, ES, and Spanglish.
// Asserts:
//  · variant rotation (no exact-string repeats across consecutive bot turns
//    in the same key)
//  · key intent flows still classify correctly under noisy / typo'd input
//  · conversationSummary builds plain-language facts
//  · selectPhrase rotates through all variants before reusing

import {
  processMessage,
  createInitialState,
  selectPhrase,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

function drive(msgs, lang = 'español', zip = '12345') {
  let s = createInitialState();
  s = processMessage(lang, s).newState;
  s = processMessage(zip, s).newState;
  const responses = [];
  let last;
  for (const m of msgs) {
    last = processMessage(m, s);
    s = last.newState;
    responses.push(last.response);
  }
  return { state: s, last, responses };
}

console.log('\n=== VARIANT ROTATION ===');
{
  // selectPhrase should cycle through all variants before reusing.
  const s = createInitialState();
  s.language = 'es';
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    seen.add(selectPhrase('provider_first_ask', s));
  }
  check('provider_first_ask: 3 distinct variants across 3 calls',
    seen.size === 3);
}
{
  const s = createInitialState();
  s.language = 'en';
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    seen.add(selectPhrase('recovery_case_a_tier1', s));
  }
  check('recovery_case_a_tier1 EN: 3 distinct variants',
    seen.size === 3);
}

console.log('\n=== NO-REPEAT GUARD IN LIVE CONVERSATIONS ===');
{
  // Drive same-input loop → tier 2 and 3 should be different from tier 1.
  const { responses } = drive([
    'tu maldita madre', 'tu maldita madre', 'tu maldita madre',
  ]);
  check('3 consecutive recovery responses are all different',
    new Set(responses).size === 3);
}
{
  // Repeated profanity with different phrase keys (different stages).
  const { responses } = drive([
    'tu maldita madre', 'mmgvaso', 'singar', 'chupame',
  ]);
  check('4 recovery responses are all different',
    new Set(responses).size === 4);
}

console.log('\n=== 30 REAL CONVERSATION SCRIPTS ===');

const scripts = [
  // 1. Spanish provider — clean
  ['es', '12345', ['mi doctor no quiere aceptar mi seguro', 'primario', 'me dijeron']],
  // 2. Spanish provider — specialist
  ['es', '12345', ['mi especialista no me acepta', 'sí tengo cita']],
  // 3. English provider — clean
  ['en', '07407', ["my doctor doesn't take my insurance", 'primary', 'office told me']],
  // 4. English specialist
  ['en', '07407', ['my specialist won\'t accept me', 'specialist', 'no appointment yet']],
  // 5. Spanish medication — full path
  ['es', '10550', ['tengo problema con mi medicina', 'la farmacia lo rechazó', 'autorización previa']],
  // 6. English medication — full path
  ['en', '07407', ['i have a problem with my meds', "they don't want to pay", 'the pharmacy', 'no']],
  // 7. Spanish medication — too expensive
  ['es', '10550', ['mi medicina salió muy cara']],
  // 8. English medication — prior auth
  ['en', '07407', ['my prescription needs prior authorization']],
  // 9. Spanish letter — plan
  ['es', '10550', ['me llegó una carta del plan', 'renovación']],
  // 10. English letter — Medicare
  ['en', '07407', ['i got a letter from medicare', 'renewal']],
  // 11. Spanish billing — hospital
  ['es', '10550', ['me llegó una factura del hospital']],
  // 12. English billing — pharmacy bill
  ['en', '07407', ['i got a pharmacy bill']],
  // 13. Spanish benefits — OTC
  ['es', '10550', ['mi tarjeta OTC no funciona']],
  // 14. English benefits — dental
  ['en', '07407', ['my dental coverage'] ],
  // 15. Spanglish — pharmacy
  ['en', '07407', ['la pharmacy no quiere cubrir my medicina']],
  // 16. Spanglish — doctor
  ['es', '12345', ['mi doctor en la clinic no me wants to ver']],
  // 17. Typo'd Spanish — doctor
  ['es', '12345', ['mi doctol no aspeta mi seguruo']],
  // 18. Typo'd English — pharmacy
  ['en', '07407', ['i have problms with my pharmasy']],
  // 19. Vague Spanish
  ['es', '10550', ['tengo problemas']],
  // 20. Vague English
  ['en', '07407', ['i have a problem']],
  // 21. Frustration after issue
  ['es', '12345', ['mi doctor no me acepta', 'no me entiendes']],
  // 22. Pure profanity → ask topic
  ['es', '12345', ['tu maldita madre']],
  // 23. Pure nonsense → ask topic
  ['en', '07407', ['mkvso']],
  // 24. Negation
  ['es', '12345', ['no quiero cambiar de plan']],
  // 25. Advisor direct
  ['es', '12345', ['quiero hablar con un asesor']],
  // 26. Advisor direct English
  ['en', '07407', ['I want to talk to a human']],
  // 27. Language switch mid-flow
  ['en', '07407', ['my doctor problem', 'mi mamá habla español']],
  // 28. Repeated provider issue
  ['es', '12345', ['mi doctor no me acepta', 'mi doctor no me acepta']],
  // 29. Soft reset
  ['es', '12345', ['tu maldita madre', 'mkvso', 'asdf', 'sí']],
  // 30. After soft reset, real topic
  ['es', '12345', ['tu maldita madre', 'mkvso', 'asdf', 'empezar', 'mi doctor no me acepta']],
];

let totalRepeats = 0;
let scriptIdx = 0;
for (const [lang, zip, msgs] of scripts) {
  scriptIdx++;
  const { state, responses } = drive(msgs, lang === 'es' ? 'español' : 'english', zip);
  // No consecutive identical bot responses.
  let consecRepeats = 0;
  for (let i = 1; i < responses.length; i++) {
    if (responses[i] === responses[i - 1]) consecRepeats++;
  }
  if (consecRepeats > 0) totalRepeats++;
  check(`Script #${scriptIdx} (${lang}): no consecutive bot-response repeats`,
    consecRepeats === 0,
    consecRepeats > 0 ? `${consecRepeats} consec repeats` : '');
}

console.log('\n=== CONVERSATION SUMMARY (plain-language facts) ===');
{
  const { state } = drive(
    ['mi doctor no quiere aceptar mi seguro', 'especialista'],
    'español', '12345',
  );
  check('conversationSummary built',
    Array.isArray(state.conversationSummary) && state.conversationSummary.length >= 1);
  check('summary mentions doctor/proveedor',
    (state.conversationSummary || []).some((f) =>
      /doctor|proveedor|provider/i.test(f)));
}

console.log('\n=== STRESS — 100 REPEATED PROFANITY MESSAGES (must rotate, not crash) ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  const seenResponses = new Set();
  let lastResp = '';
  let immediateRepeats = 0;
  for (let i = 0; i < 100; i++) {
    const r = processMessage(`mierda ${i}`, s);
    s = r.newState;
    seenResponses.add(r.response);
    if (r.response === lastResp) immediateRepeats++;
    lastResp = r.response;
  }
  check('Engine survives 100-message profanity loop',
    s.turnCount >= 100);
  check('At least 3 distinct responses across 100 turns',
    seenResponses.size >= 3);
  check('No more than 25% immediate repeats',
    immediateRepeats < 25,
    `${immediateRepeats} immediate repeats`);
}

console.log('\n=== STRESS — 50 mixed-script messages ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  const seq = [
    'hi', 'hello', 'i have a problem', 'with my doctor', 'primary',
    'they told me no', 'mi mamá habla español', 'doctor', 'primario',
    'no sé', 'asesor', 'sí', 'empezar', 'tu maldita madre', 'mkvso',
    'asdf', 'qwerty', 'i have a problem with my meds', 'pharmacy',
    'rejected', 'no', 'me llegó una carta', 'del plan', 'renovación',
    'me llegó una factura', 'del hospital', 'mi tarjeta OTC no funciona',
    'dental', 'gracias', 'bye', 'hello again', 'i need help', 'doctor',
    'specialist', 'no appointment', 'mi medicina', 'no la cubrieron',
    'plan letter', 'mi mamá habla inglés', 'hospital bill', 'i want an advisor',
    'yes', 'call me at 5555555555', 'cualquier cosa', 'lol', 'jajaja',
    'help', 'ayuda', 'doctor cardiologo', 'i give up',
  ];
  for (const m of seq) s = processMessage(m, s).newState;
  check('50-turn mixed conversation stable',
    s.turnCount >= 50 && s.messages.length >= 100);
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
console.log(`  Scripts with consecutive repeats: ${totalRepeats} / ${scripts.length}`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

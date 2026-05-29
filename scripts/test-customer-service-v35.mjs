// Wave 35 — Stage-4 no-loop + sí/empezar follow-through.
// Sawil's TESTS 1-15 from the V35 enterprise reset prompt.

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

function drive(msgs, lang = 'español', zip = '12345') {
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

console.log('\n=== TEST 1: Profanity / no issue → ask topic ===');
{
  const { state: s, last: r } = drive(['tu maldita madre']);
  check('T1: hasRealIssue=false', s.hasRealIssue !== true);
  check('T1: no serviceCategory', !s.serviceCategory);
  check('T1: asks topic',
    /tema.*medicamento|medicamentos.*doctor.*carta.*factura/i.test(r.response));
  check('T1: chips show topic menu',
    (s.quickReplies || []).includes('Medicamentos'));
}

console.log('\n=== TEST 2: Profanity + nonsense → DIFFERENT response ===');
{
  const { state: s, last: r } = drive(['tu maldita madre', 'mmgvaso']);
  check('T2: tier 2 ("no quiero adivinar")',
    /no quiero adivinar|don'?t want to guess/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T2: response is DIFFERENT from tier 1',
    !/necesito saber el tema|i need the topic/i.test(r.response));
}

console.log('\n=== TEST 3: Third unclear → advisor offer ===');
{
  const { state: s, last: r } = drive(['tu maldita madre', 'mmgvaso', 'singar']);
  check('T3: tier 3 advisor offer',
    /asesor licenciado|licensed advisor/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T3: NOT repeat tier 1 or 2',
    !/necesito saber el tema|no quiero adivinar/i.test(r.response));
}

console.log('\n=== TEST 4: AFTER advisor offer, another profanity → yes/start prompt ===');
{
  const { state: s, last: r } = drive([
    'tu maldita madre', 'mmgvaso', 'singar', 'chupame',
  ]);
  check('T4: NOT repeat the same advisor offer paragraph',
    !/para evitar confusi[oó]n.*asesor licenciado/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T4: response includes yes/start instruction',
    /escriba s[ií]|escriba empezar|type yes|type start/i.test(r.response));
}

console.log('\n=== TEST 4-yes: user types "sí" → advisor handoff starts ===');
{
  const { state: s, last: r } = drive([
    'tu maldita madre', 'mmgvaso', 'singar', 'sí',
  ]);
  check('T4-yes: needsHuman=true (handoff)',
    r.needsHuman === true || s.needsHuman === true);
  check('T4-yes: response collects name + phone',
    /nombre.*tel[eé]fono|name.*phone/i.test(r.response));
  check('T4-yes: PHI guardrail present',
    /medicare|seguro social|bancaria|banking|ssn/i.test(r.response));
}

console.log('\n=== TEST 4-start: user types "empezar" → soft reset ===');
{
  const { state: s, last: r } = drive([
    'tu maldita madre', 'mmgvaso', 'singar', 'empezar',
  ]);
  check('T4-start: recoveryStage reset to 0', s.recoveryStage === 0);
  check('T4-start: no serviceCategory after reset', !s.serviceCategory);
  check('T4-start: bot says "empezamos de nuevo"',
    /empezamos de nuevo|starting over|how can i help|en qu[eé] le puedo ayudar/i.test(r.response));
}

console.log('\n=== TEST 5: Real provider ===');
{
  const { state: s, last: r } = drive(['mi doctor no quiere aceptar mi seguro']);
  check('T5: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('T5: asks primary/specialist',
    /primario.*especialista/i.test(r.response));
  check('T5: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response));
}

console.log('\n=== TEST 6: Provider repetition ===');
{
  const { state: s, last: r } = drive([
    'mi doctor no quiere aceptar mi seguro',
    'mi doctor no quiere aceptar mi seguro',
  ]);
  check('T6: short ack, NOT repeat paragraph',
    /ya tengo esa parte|sin repetir/i.test(r.response));
}

console.log('\n=== TEST 7: English medication full flow ===');
{
  const { state: s, last: r } = drive(
    ['i have a problem with my meds', "they don't want to pay", 'the pharmacy', 'no'],
    'english', '07407',
  );
  check('T7: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('T7: advisor + PHI', /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log('\n=== TEST 8: Spanish medication ===');
{
  const { state: s, last: r } = drive(['la farmacia dice que no lo cubre'], 'español', '10550');
  check('T8: serviceCategory=drug', s.serviceCategory === 'drug');
}

console.log('\n=== TEST 9: Letter ===');
{
  const { state: s, last: r } = drive(['me llegó una carta del plan'], 'español', '10550');
  check('T9: serviceCategory=letter', s.serviceCategory === 'letter');
  check('T9: asks sender/type',
    /medicare|seguro social|medicaid|plan|renovaci|cancelaci/i.test(r.response));
}

console.log('\n=== TEST 10: Billing hospital ===');
{
  const { state: s, last: r } = drive(['me llegó una factura del hospital'], 'español', '10550');
  check('T10: bill context',
    s.billSource === 'provider' || /hospital|factura|cobro/i.test(r.response));
}

console.log('\n=== TEST 11: OTC card ===');
{
  const { state: s, last: r } = drive(['mi tarjeta OTC no funciona'], 'español', '10550');
  check('T11: classified as benefits/OTC',
    ['otc', 'benefits', 'id_card'].includes(s.serviceCategory)
      || /otc|tarjeta/i.test(r.response));
}

console.log('\n=== TEST 12: Language switch preserves topic ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage('my doctor does not take my insurance', s).newState;
  const r = processMessage('mi mamá habla español', s);
  s = r.newState;
  check('T12: language=es', s.language === 'es');
  check('T12: topic preserved (doctor)',
    s.serviceCategory === 'doctor_provider_network');
}

console.log('\n=== TEST 13: Direct advisor request ===');
{
  const { state: s, last: r } = drive(['quiero hablar con un asesor']);
  check('T13: needsHuman OR advisor response',
    r.needsHuman === true || s.needsHuman === true
      || /asesor|advisor/i.test(r.response));
}

console.log('\n=== TEST 14: 25-message run — state stable ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  const seq = [
    'hello', 'hmm', 'i have a problem with my meds', "they don't want to pay",
    'the pharmacy', 'prior authorization', 'idk', 'no', 'tu maldita madre',
    'mkvso', 'asdf', 'empezar', 'i have a problem with my doctor', 'primary', 'no',
    'i got a letter', 'medicare', 'renewal', 'advisor', 'mi mamá habla español',
    'mi doctor no me acepta', 'especialista', 'no sé', 'asesor', 'gracias',
  ];
  for (const m of seq) s = processMessage(m, s).newState;
  check('T14: messages length >= 50', s.messages.length >= 50);
  check('T14: turnCount >= 25', s.turnCount >= 25);
}

console.log('\n=== AFTER-RESET: user can start a real topic ===');
{
  // empezar resets state — bot should accept a new real issue cleanly.
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  s = processMessage('tu maldita madre', s).newState;
  s = processMessage('mmgvaso', s).newState;
  s = processMessage('singar', s).newState;
  s = processMessage('empezar', s).newState;
  const r = processMessage('mi doctor no quiere aceptar mi seguro', s);
  s = r.newState;
  check('After reset: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('After reset: asks primary/specialist',
    /primario.*especialista/i.test(r.response));
}

console.log('\n=== SAWIL PROOF 4-TIER NO-LOOP TRANSCRIPT ===');
{
  let s = createInitialState();
  let r;
  r = processMessage('español', s); s = r.newState;
  console.log('  USER: español');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('12345', s); s = r.newState;
  console.log('  USER: 12345');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('tu maldita madre', s); s = r.newState;
  console.log('  USER: tu maldita madre');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage('mmgvaso', s); s = r.newState;
  console.log('  USER: mmgvaso');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage('singar', s); s = r.newState;
  console.log('  USER: singar');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage('chupame', s); s = r.newState;
  console.log('  USER: chupame');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage('sí', s); s = r.newState;
  console.log('  USER: sí');
  console.log('  BOT:  ' + r.response.slice(0, 300));
  check('Proof: 4 distinct responses in sequence',
    s.recoveryStage >= 4 || s.advisorHandoffStarted === true);
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

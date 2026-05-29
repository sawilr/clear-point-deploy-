// Wave 34 — Conversation intelligence repair:
// · Profanity / nonsense without a real topic does NOT invent a Medicare case
// · 3-tier no-topic recovery (different message each turn, not the same one)
// · Context-aware frustration (Case A: no topic vs Case B: known topic)
// · hasRealIssue flag, recoveryStage counter
//
// Sawil's exact required tests 1-12 with proof transcripts.

import {
  processMessage,
  createInitialState,
  detectNonsense,
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

console.log('\n=== DETECTOR: detectNonsense ===');
check('"mkvso" → nonsense', detectNonsense('mkvso'));
check('"asdf" → nonsense', detectNonsense('asdf'));
check('"qwerty" → nonsense', detectNonsense('qwerty'));
check('"hmm" → nonsense', detectNonsense('hmm'));
check('"eso" → nonsense', detectNonsense('eso'));
check('"!!!!" → nonsense', detectNonsense('!!!!'));
check('"" → nonsense (empty)', detectNonsense(''));
check('"doctor" → NOT nonsense', !detectNonsense('doctor'));
check('"medicamento" → NOT nonsense', !detectNonsense('medicamento'));
check('"hello" → NOT nonsense', !detectNonsense('hello'));
check('"tu maldita madre" → NOT nonsense (profanity handled separately)',
  !detectNonsense('tu maldita madre'));
check('"i have a problem" → NOT nonsense',
  !detectNonsense('i have a problem'));

console.log('\n=== TEST 1: Profanity / no issue (Sawil exact case) ===');
{
  const { state: s, last: r } = drive(['tu maldita madre']);
  check('T1: NO fake Medicare topic invented',
    !s.hasRealIssue && !s.serviceCategory);
  check('T1: response asks for topic (medicamentos/doctor/carta/factura/beneficios)',
    /tema|medicamentos.*doctor.*carta.*factura|medicamento.*doctor/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T1: chips include topic options',
    (s.quickReplies || []).includes('Medicamentos')
      && (s.quickReplies || []).includes('Doctor')
      && (s.quickReplies || []).includes('Carta'));
  check('T1: response does NOT say "no voy a seguir repitiendo"',
    !/no voy a seguir repitiendo|i won'?t keep repeating/i.test(r.response));
  check('T1: recoveryStage=1', s.recoveryStage === 1);
}

console.log('\n=== TEST 2: Profanity + nonsense → DIFFERENT response (no repeat) ===');
{
  const { state: s, last: r } = drive(['tu maldita madre', 'mkvso']);
  check('T2: recoveryStage=2', s.recoveryStage === 2);
  check('T2: response is Case A tier 2 ("no quiero adivinar")',
    /no quiero adivinar|just send one word|don'?t want to guess/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T2: response is DIFFERENT from tier 1',
    !/tema, ¿es sobre medicamentos|i need the topic/i.test(r.response)
      || /no quiero adivinar|don'?t want to guess/i.test(r.response));
}

console.log('\n=== TEST 3: Third unclear → advisor offer ===');
{
  const { state: s, last: r } = drive(['tu maldita madre', 'mkvso', 'asdf']);
  check('T3: recoveryStage=3', s.recoveryStage === 3);
  check('T3: response offers advisor',
    /asesor licenciado|licensed advisor/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T3: advisorHandoffReason set',
    !!s.advisorHandoffReason);
}

console.log('\n=== TEST 4: Real provider issue ===');
{
  const { state: s, last: r } = drive(['mi doctor no quiere aceptar mi seguro']);
  check('T4: hasRealIssue=true', s.hasRealIssue === true);
  check('T4: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('T4: asks primary/specialist',
    /primario.*especialista/i.test(r.response));
}

console.log('\n=== TEST 5: Provider repetition (3-tier) ===');
{
  const { state: s, last: r } = drive([
    'mi doctor no quiere aceptar mi seguro',
    'mi doctor no quiere aceptar mi seguro',
  ]);
  check('T5: tier 2 short ack',
    /ya tengo esa parte|sin repetir/i.test(r.response));
}

console.log('\n=== TEST 6: Medication full flow ===');
{
  const { state: s, last: r } = drive(
    ['i have a problem with my meds', "they don't want to pay", 'the pharmacy', 'no'],
    'english', '07407',
  );
  check('T6: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('T6: advisor + PHI guardrail',
    /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log('\n=== TEST 7: Spanish medication ===');
{
  const { state: s, last: r } = drive(
    ['la farmacia dice que no lo cubre'], 'español', '10550',
  );
  check('T7: serviceCategory=drug', s.serviceCategory === 'drug');
  check('T7: asks targeted med question',
    /cubr|farmacia|rechaz|precio/i.test(r.response));
}

console.log('\n=== TEST 8: Letter ===');
{
  const { state: s, last: r } = drive(
    ['me llegó una carta del plan'], 'español', '10550',
  );
  check('T8: serviceCategory=letter', s.serviceCategory === 'letter');
  check('T8: asks letter sender/type',
    /medicare|seguro social|medicaid|plan|renovaci|cancelaci/i.test(r.response));
}

console.log('\n=== TEST 9: Billing hospital ===');
{
  const { state: s, last: r } = drive(
    ['me llegó una factura del hospital'], 'español', '10550',
  );
  check('T9: bill source detected OR billing response',
    s.billSource === 'provider' || /hospital|factura|cobro|usted debe/i.test(r.response));
}

console.log('\n=== TEST 10: OTC card ===');
{
  const { state: s, last: r } = drive(
    ['mi tarjeta OTC no funciona'], 'español', '10550',
  );
  check('T10: serviceCategory benefits/OTC OR response mentions OTC',
    ['otc', 'benefits', 'id_card'].includes(s.serviceCategory)
      || /otc|tarjeta|balance|rechazada/i.test(r.response));
}

console.log('\n=== TEST 11: Language switch "mi mamá habla español" preserves topic ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage('my doctor does not take my insurance', s).newState;
  const r = processMessage('mi mamá habla español', s);
  s = r.newState;
  check('T11: language=es', s.language === 'es');
  check('T11: topic preserved (doctor)',
    s.serviceCategory === 'doctor_provider_network');
  check('T11: response in Spanish mentions doctor',
    /doctor|m[eé]dico|primario|especialista/i.test(r.response));
}

console.log('\n=== TEST 12: 25-message run — state stable, no crashes ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  const seq = [
    'hello', 'hmm', 'i have a problem with my meds', "they don't want to pay",
    'the pharmacy', 'prior authorization', 'idk', 'no', 'tu maldita madre',
    'mkvso', 'asdf', 'i have a problem with my doctor', 'primary', 'no',
    'i got a letter', 'medicare', 'renewal', 'advisor', 'mi mamá habla español',
    'mi doctor no me acepta', 'especialista', 'no sé', 'asesor', 'gracias', 'bye',
  ];
  for (const m of seq) s = processMessage(m, s).newState;
  check('T12: state intact (messages length >= 50)', s.messages.length >= 50);
  check('T12: turnCount >= 25', s.turnCount >= 25);
}

console.log('\n=== REAL-ISSUE-AFTER-PROFANITY: profanity, then real topic ===');
{
  // User vents, then types a real topic — bot should switch from recovery to
  // real topic handler without bringing along recovery-stage confusion.
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  const r1 = processMessage('tu maldita madre', s); s = r1.newState;
  const r2 = processMessage('mi doctor no quiere aceptar mi seguro', s); s = r2.newState;
  check('After topic: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('After topic: recoveryStage reset to 0',
    s.recoveryStage === 0);
  check('After topic: asks primary/specialist',
    /primario.*especialista/i.test(r2.response));
}

console.log('\n=== SAWIL PROOF 1 — Profanity / no issue transcript ===');
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
  check('P1 T1: asks for topic, no fake Medicare case',
    /tema|medicamento|doctor|carta|factura/i.test(r.response)
      && !s.hasRealIssue);

  r = processMessage('mkvso', s); s = r.newState;
  console.log('  USER: mkvso');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('P1 T2: tier 2 ("no quiero adivinar") — different response',
    /no quiero adivinar|don'?t want to guess|just send one word/i.test(r.response));

  r = processMessage('asdf', s); s = r.newState;
  console.log('  USER: asdf');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('P1 T3: tier 3 advisor offer',
    /asesor licenciado|licensed advisor/i.test(r.response));
}

console.log('\n=== SAWIL PROOF 2 — Provider issue transcript ===');
{
  let s = createInitialState();
  let r;
  r = processMessage('español', s); s = r.newState;
  r = processMessage('12345', s); s = r.newState;
  r = processMessage('mi doctor no quiere aceptar mi seguro', s); s = r.newState;
  console.log('  USER: mi doctor no quiere aceptar mi seguro');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('P2: asks primary/specialist',
    /primario.*especialista/i.test(r.response));
  r = processMessage('especialista', s); s = r.newState;
  console.log('  USER: especialista');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('P2: specialist branch — asks appointment',
    /cita|appointment/i.test(r.response));
}

console.log('\n=== SAWIL PROOF 3 — Medication transcript ===');
{
  let s = createInitialState();
  let r;
  r = processMessage('english', s); s = r.newState;
  r = processMessage('07407', s); s = r.newState;
  r = processMessage('i have a problem with my meds', s); s = r.newState;
  console.log('  USER: i have a problem with my meds');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage("they don't want to pay", s); s = r.newState;
  console.log("  USER: they don't want to pay");
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('the pharmacy', s); s = r.newState;
  console.log('  USER: the pharmacy');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('no', s); s = r.newState;
  console.log('  USER: no');
  console.log('  BOT:  ' + r.response.slice(0, 280));
  check('P3: advisor + PHI guardrail',
    /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

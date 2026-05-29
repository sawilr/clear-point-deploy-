// Wave 32 — Provider triage state machine + repetition guard.
// Sawil's exact failing flow + 14 required tests.

import {
  processMessage,
  createInitialState,
  detectProviderAnswer,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

function drive(msgs, lang = 'español', zip = '06820') {
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

console.log('\n=== DETECTOR: detectProviderAnswer ===');
check('"primario" → primary',
  detectProviderAnswer('primario').category === 'primary_doctor_not_accepting');
check('"primary doctor" → primary',
  detectProviderAnswer('primary doctor').category === 'primary_doctor_not_accepting');
check('"PCP" → primary',
  detectProviderAnswer('my PCP').category === 'primary_doctor_not_accepting');
check('"especialista" → specialist',
  detectProviderAnswer('especialista').category === 'specialist_not_accepting');
check('"specialist" → specialist',
  detectProviderAnswer('specialist').category === 'specialist_not_accepting');
check('"hospital" → hospital',
  detectProviderAnswer('hospital').category === 'hospital_network');
check('"no sé" → short_idk',
  detectProviderAnswer('no sé').category === 'short_idk');
check('"no" → short_no',
  detectProviderAnswer('no').category === 'short_no');
check('"asesor" → wants_advisor',
  detectProviderAnswer('hablar con un asesor').category === 'wants_advisor');
check('"español" → switch_language',
  detectProviderAnswer('español').category === 'switch_language');
check('"my mom speaks spanish" → switch_language',
  detectProviderAnswer('my mom speaks spanish').category === 'switch_language');
check('"verificar antes de ir" → verify',
  detectProviderAnswer('quiero verificar antes de ir').category === 'provider_verify_network');
check('"office told me" → office_said_no',
  detectProviderAnswer('the office told me they don\'t accept').category === 'office_said_no');
check('"cita" → appointment',
  detectProviderAnswer('tengo una cita pronto').category === 'appointment_issue');
check('"referral" → referral',
  detectProviderAnswer('necesito un referral').category === 'referral_issue');

console.log('\n=== TEST 1: Spanish doctor exact Sawil bug ===');
{
  const { state: s, last: r } = drive(['mi doctor no quiere aceptarme']);
  check('T1: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network',
    `category=${s.serviceCategory}`);
  check('T1: providerIssueType=provider_access_issue',
    s.providerIssueType === 'provider_access_issue');
  check('T1: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('T1: asks primary or specialist',
    /primario.*especialista|especialista.*primario/i.test(r.response));
  check('T1: askedQuestions includes provider_primary_or_specialist',
    (s.askedQuestions || []).includes('provider_primary_or_specialist'));
}

console.log('\n=== TEST 2: Repeated Spanish doctor (V33 3-tier) ===');
{
  // V33 spec: 2nd-time repeat = short ack ("Ya tengo esa parte..."),
  // 3rd-time repeat = advisor + PHI warning.
  const { state: s2, last: r2 } = drive([
    'mi doctor no quiere aceptarme',
    'mi doctor no quiere aceptarme',
  ]);
  check('T2-tier2: does NOT repeat the same first-turn paragraph',
    /ya tengo esa parte|sin repetir/i.test(r2.response),
    `resp="${r2.response.slice(0, 250)}"`);
  check('T2-tier2: does NOT yet escalate to advisor',
    !(r2.needsHuman === true || s2.needsHuman === true));

  const { state: s3, last: r3 } = drive([
    'mi doctor no quiere aceptarme',
    'mi doctor no quiere aceptarme',
    'mi doctor no quiere aceptarme',
  ]);
  check('T2-tier3: needsHuman=true (advisor escalation)',
    r3.needsHuman === true || s3.needsHuman === true);
  check('T2-tier3: advisorHandoffReason set',
    !!s3.advisorHandoffReason);
  check('T2-tier3: warns about PHI',
    /n[uú]mero de medicare|medicare id|seguro social|ssn|bancaria|banking/i.test(r3.response));
}

console.log('\n=== TEST 3: Spanish provider short answer "especialista" ===');
{
  const { state: s, last: r } = drive([
    'mi doctor no quiere aceptarme',
    'especialista',
  ]);
  check('T3: providerIssueType=specialist_not_accepting',
    s.providerIssueType === 'specialist_not_accepting');
  check('T3: asks appointment scheduled',
    /cita programada|cita.*especialista|tiene.*cita/i.test(r.response));
  check('T3: askedQuestions includes provider_appointment_soon',
    (s.askedQuestions || []).includes('provider_appointment_soon'));
}

console.log('\n=== TEST 4: Spanish "no sé" → simplify + advisor ===');
{
  const { state: s, last: r } = drive([
    'mi doctor no quiere aceptarme',
    'no sé',
  ]);
  check('T4: needsHuman=true (advisor offer)',
    r.needsHuman === true || s.needsHuman === true);
  check('T4: advisorHandoffReason set',
    !!s.advisorHandoffReason);
  check('T4: offers asesor licenciado',
    /asesor licenciado|le gustar[ií]a que un asesor/i.test(r.response));
  check('T4: does NOT reset to language prompt',
    !/qu[eé] idioma|what language|select.*english/i.test(r.response));
}

console.log('\n=== TEST 5: English doctor "does not accept my plan" ===');
{
  const { state: s, last: r } = drive(
    ['my doctor does not accept my plan'],
    'english', '07407',
  );
  check('T5: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('T5: NOT generic coverage paragraph',
    !/coverage is one of the most important/i.test(r.response));
  check('T5: asks primary or specialist',
    /primary.*specialist|specialist.*primary/i.test(r.response));
}

console.log('\n=== TEST 6: English medication full flow (regression) ===');
{
  const { state: s, last: r } = drive(
    [
      'i have a problem with my meds',
      "they don't want to pay",
      'the pharmacy',
      'no',
    ],
    'english', '07407',
  );
  check('T6: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('T6: needsHuman=true', r.needsHuman === true || s.needsHuman === true);
  check('T6: offers advisor + PHI warning',
    /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log('\n=== TEST 7: Spanish medication "la farmacia dice que no lo cubre" ===');
{
  const { state: s, last: r } = drive(
    ['tengo problema con mi medicina', 'la farmacia dice que no lo cubre'],
    'español', '10550',
  );
  check('T7: serviceCategory=drug', s.serviceCategory === 'drug');
  check('T7: detects coverage / pharmacy context',
    /cubr|farmacia|carta del plan/i.test(r.response));
  check('T7: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response));
}

console.log('\n=== TEST 8: Letter "me llegó una carta del plan" ===');
{
  const { state: s, last: r } = drive(
    ['me llegó una carta del plan'],
    'español', '10550',
  );
  check('T8: detects letter context',
    /carta|renovaci[oó]n|cancelaci[oó]n|pago|medicare|medicaid|seguro social/i.test(r.response));
  check('T8: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response));
}

console.log('\n=== TEST 9: OTC card not working ===');
{
  const { state: s, last: r } = drive(
    ['mi tarjeta OTC no funciona'],
    'español', '10550',
  );
  check('T9: serviceCategory in {otc, id_card}',
    s.serviceCategory === 'otc' || s.serviceCategory === 'id_card' || /otc|tarjeta/i.test(r.response));
}

console.log('\n=== TEST 10: Billing "me llegó una factura del hospital" ===');
{
  const { state: s, last: r } = drive(
    ['me llegó una factura del hospital'],
    'español', '10550',
  );
  check('T10: bill context detected',
    /factura|cobro|hospital|usted debe|amount/i.test(r.response));
  check('T10: NO plan recommendation',
    !/best plan|mejor plan|recommend a plan/i.test(r.response));
}

console.log('\n=== TEST 11: Language switch "my mom speaks Spanish" ===');
{
  // Start English doctor flow, then switch via mom phrase.
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage('my doctor does not accept my plan', s).newState;
  const r = processMessage('my mom speaks spanish', s);
  s = r.newState;
  check('T11: language switched to es', s.language === 'es');
  check('T11: serviceCategory preserved (still provider)',
    s.serviceCategory === 'doctor_provider_network');
}

console.log('\n=== TEST 12: Advisor request stops triage ===');
{
  const { state: s, last: r } = drive(['quiero hablar con un asesor']);
  check('T12: needsHuman=true OR advisor in response',
    r.needsHuman === true || s.needsHuman === true
      || /asesor|advisor/i.test(r.response));
}

console.log('\n=== TEST 13: Frustration "no me entiendes" ===');
{
  const { state: s, last: r } = drive(['no me entiendes']);
  check('T13: short response, offers advisor or one more question',
    /asesor|advisor|una pregunta|one more|empezar de nuevo|start over/i.test(r.response));
  check('T13: NOT long generic paragraph',
    r.response.split(/\s+/).length < 80);
}

console.log('\n=== TEST 14: Variants — "no me acepta" ===');
{
  const { state: s, last: r } = drive(['mi doctor no me acepta']);
  check('T14a: classified as provider',
    s.serviceCategory === 'doctor_provider_network');
  check('T14a: asks primary or specialist',
    /primario.*especialista/i.test(r.response));
}
{
  const { state: s, last: r } = drive(['no toman mi seguro']);
  check('T14b: "no toman mi seguro" → provider',
    s.serviceCategory === 'doctor_provider_network');
}
{
  const { state: s, last: r } = drive(
    ["the doctor won't accept my insurance"], 'english', '07407',
  );
  check('T14c: English "won\'t accept" → provider',
    s.serviceCategory === 'doctor_provider_network');
}

console.log('\n=== SAWIL PROOF TEST A — full transcript ===');
{
  let s = createInitialState();
  let r;
  r = processMessage('español', s); s = r.newState;
  console.log('  USER: español');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('06820', s); s = r.newState;
  console.log('  USER: 06820');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('mi doctor no quiere aceptarme', s); s = r.newState;
  console.log('  USER: mi doctor no quiere aceptarme');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('Proof A T1: providerIssueType set',
    s.providerIssueType === 'provider_access_issue');
  check('Proof A T1: asks primary vs specialist',
    /primario.*especialista|especialista.*primario/i.test(r.response));
  check('Proof A T1: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response));

  // V33 3-tier: 2nd-time repeat = short ack, 3rd-time = advisor + PHI.
  r = processMessage('mi doctor no quiere aceptarme', s); s = r.newState;
  console.log('  USER: mi doctor no quiere aceptarme (repeat #1)');
  console.log('  BOT:  ' + r.response.slice(0, 300));
  check('Proof A T2 (tier 2): short ack ("Ya tengo esa parte")',
    /ya tengo esa parte|sin repetir/i.test(r.response));
  check('Proof A T2 (tier 2): does NOT repeat first paragraph',
    !/^entiendo\. eso suena como un problema con un doctor.proveedor/i.test(r.response));

  r = processMessage('mi doctor no quiere aceptarme', s); s = r.newState;
  console.log('  USER: mi doctor no quiere aceptarme (repeat #2)');
  console.log('  BOT:  ' + r.response.slice(0, 300));
  check('Proof A T3 (tier 3): needsHuman=true (advisor)',
    r.needsHuman === true || s.needsHuman === true);
  check('Proof A T3 (tier 3): warns about PHI',
    /n[uú]mero de medicare|seguro social|bancaria|m[eé]dicos privados/i.test(r.response));
}

console.log('\n=== SAWIL PROOF TEST B — medication transcript ===');
{
  let s = createInitialState();
  let r;
  r = processMessage('english', s); s = r.newState;
  console.log('  USER: english');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('07407', s); s = r.newState;
  console.log('  USER: 07407');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('i have a problem with my meds', s); s = r.newState;
  console.log('  USER: i have a problem with my meds');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage("they don't want to pay", s); s = r.newState;
  console.log("  USER: they don't want to pay");
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage('the pharmacy', s); s = r.newState;
  console.log('  USER: the pharmacy');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  r = processMessage('no', s); s = r.newState;
  console.log('  USER: no');
  console.log('  BOT:  ' + r.response.slice(0, 300));
  check('Proof B: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('Proof B: needsHuman=true',
    r.needsHuman === true || s.needsHuman === true);
  check('Proof B: offers licensed advisor + PHI warning',
    /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

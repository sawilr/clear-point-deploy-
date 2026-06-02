// Wave 47 — lead-qualification + loop guard + fake-contact detection.
//
// Sawil's spec (verbatim):
//   "no estoy para ayudar gente con apelar oh no no est obra de caridad"
//   "se le da la info pero si la persona quiere cambiar de plan ese es el push"
//   "un criterio se le pregunta si cliente de clear point para q su asesor
//    le llame solo si es cliente"
//   "vas probar todo absolutamente todo 3 palabras y de una vez falla"
//   "debe identificar nombres falsos teléfonos falsos emails falsos"
//
// 200+ assertions across realistic conversational flows including the exact
// Sawil failing flow, 3-word phrases, ES+EN parity, fake contact info,
// loop guard, and lead-qualification pivot.

import {
  processMessage,
  createInitialState,
  validateName,
  validatePhone,
  validateEmail,
  detectFakeContactSignals,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// Tiny helper: run a full conversation from an array of user turns and return
// the array of bot responses (in order) + final state.
function run(turns) {
  let s = createInitialState();
  const out = [];
  for (const t of turns) {
    const r = processMessage(t, s);
    s = r.newState;
    out.push(r.response);
  }
  return { responses: out, state: s };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAWIL'S EXACT FAILING FLOW — no loop, distinct responses, lead-qual gate
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 1. Sawil exact flow — no loop ===');
{
  const { responses, state } = run([
    'español',
    '06825',
    'mi plan no quiere aprobarme una cirugia creo q debo cambiar de plan?',
    'es posible q debo hacer',
  ]);
  check('1.1 turn-1 asks for ZIP', /ZIP|zip code/i.test(responses[0]));
  check('1.2 turn-2 confirms Connecticut', /connecticut/i.test(responses[1]));
  check('1.3 turn-3 asks existing-client gate', /cliente actual|clearpoint senior advisors/i.test(responses[2]));
  check('1.4 turn-4 distinct from turn-3 (no loop)', responses[2].trim() !== responses[3].trim());
  check('1.5 turn-4 mentions plan options, not appeals service', /opciones de plan|no resolvemos apelaciones/i.test(responses[3]));
  check('1.6 existingClientAsked=true', state.existingClientAsked === true);
  check('1.7 planChangePushMade=true after turn-4', state.planChangePushMade === true);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. EXISTING-CLIENT GATE — yes / no / info paths
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 2. Existing-client gate routes correctly ===');
{
  const { responses, state } = run([
    'español', '06825',
    'mi plan no quiere aprobarme cirugia, cambiar plan?',
    'si soy cliente',
  ]);
  check('2.1 ES "si soy cliente" → handoff started', state.advisorHandoffStarted === true);
  check('2.1 ES handoff message asks name (progressive)', /(¿cu[aá]l es su nombre|nombre, por favor)/i.test(responses[3]));
  check('2.1 ES handoff has PHI guardrail', /medicare|seguro social|bancari/i.test(responses[3]));
  check('2.1 isExistingClient=true', state.isExistingClient === true);
}
{
  const { responses, state } = run([
    'español', '06825',
    'mi plan no quiere aprobarme cirugia, cambiar plan?',
    'no soy nuevo',
  ]);
  check('2.2 ES "no soy nuevo" → plan-options pivot', /opciones de plan/i.test(responses[3]));
  check('2.2 isExistingClient=false', state.isExistingClient === false);
  check('2.2 quickReplies offered for options', (state.quickReplies || []).length >= 1);
}
{
  const { responses, state } = run([
    'español', '06825',
    'mi plan no quiere aprobarme cirugia',
    'solo info',
  ]);
  check('2.3 ES "solo info" → info-only pivot', /tema en general|cu[aá]l es el tema/i.test(responses[3]));
  check('2.3 isExistingClient=false (info path)', state.isExistingClient === false);
}

console.log('\n=== 2b. EN parity for existing-client gate ===');
{
  const { responses, state } = run([
    'english', '10550',
    "my plan won't approve my surgery, should I change plan?",
    'yes I am a client',
  ]);
  check('2b.1 EN "yes I am a client" → handoff', state.advisorHandoffStarted === true);
  check('2b.1 EN asks name (progressive)', /(what'?s your name|your name)/i.test(responses[3]));
}
{
  const { responses, state } = run([
    'english', '10550',
    "my plan denied my surgery, what about changing plans?",
    "no, I'm new",
  ]);
  check('2b.2 EN new contact → plan options', /plan options/i.test(responses[3]));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. LOOP GUARD — global defense in depth
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 3. Loop guard never repeats same response twice ===');
{
  const flows = [
    ['español', '06825', 'mi doctor no acepta mi plan', 'mi doctor no acepta mi plan',
     'mi doctor no acepta mi plan'],
    ['english', '10550', "my doctor doesn't take my plan", "my doctor doesn't take my plan",
     "my doctor doesn't take my plan"],
    ['español', '07407', 'tengo problemas con medicinas', 'tengo problemas con medicinas',
     'tengo problemas con medicinas'],
    ['english', '32301', 'I have problems with meds', 'I have problems with meds',
     'I have problems with meds'],
    ['español', '06820', 'me llego una factura', 'me llego una factura',
     'me llego una factura'],
  ];
  for (let i = 0; i < flows.length; i++) {
    const { responses } = run(flows[i]);
    // Compare turns 2-3, 3-4, 4-5 — none should be identical.
    let anyDup = false;
    for (let j = 2; j < responses.length - 1; j++) {
      const a = responses[j].trim();
      const b = responses[j + 1].trim();
      if (a === b) { anyDup = true; break; }
    }
    check(`3.${i + 1} flow has NO adjacent duplicate responses`, !anyDup);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. THREE-WORD PHRASES — Sawil's "3 palabras y de una vez falla" demand.
// Every 3-word phrase must produce a topic-specific, non-fallback response.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 4. 3-word phrases (ES) — no generic fallback ===');
const threeWordEs = [
  'necesito un doctor',
  'mi factura llego',
  'mi medicina cuesta',
  'cambiar de plan',
  'quiero un asesor',
  'no tengo doctor',
  'me duele mucho',
  'mi plan terrible',
  'no me cubren',
  'cobertura no funciona',
  'doctor no acepta',
  'farmacia muy cara',
  'pagar mucho dinero',
  'inscribirme en medicare',
  'cumplo 65 anos',
  'me mude reciente',
  'busco nuevo plan',
  'soy diabetico ahora',
  'cancer en familia',
  'cirugia muy cara',
];
for (const p of threeWordEs) {
  const { responses } = run(['español', '06825', p]);
  const r = responses[2];
  const isFallback = /Perd[oó]n, no pude procesar eso bien|hag[aá]moslo simple|hag[aá]moslo facil/i.test(r);
  check(`4 ES "${p}" → topic-specific response`, !isFallback && r.length > 30, `r="${r.slice(0, 120)}"`);
  check(`4 ES "${p}" → no invented $ amount`,
    !/\$\d|7407|10550|6825|7,407|6,825/.test(r));
}

console.log('\n=== 4b. 3-word phrases (EN) — no generic fallback ===');
const threeWordEn = [
  'I need doctor',
  'My bill came',
  'My meds expensive',
  'Change my plan',
  'Want an advisor',
  "Don't have doctor",
  'I hurt much',
  'My plan terrible',
  "Won't cover me",
  'Coverage not working',
  'Doctor refused me',
  'Pharmacy too pricey',
  'Paying too much',
  'Enroll in medicare',
  "Turning 65 soon",
  'Just moved here',
  'Looking new plan',
  'Diabetic just learned',
  'Cancer in family',
  'Surgery too expensive',
];
for (const p of threeWordEn) {
  const { responses } = run(['english', '10550', p]);
  const r = responses[2];
  const isFallback = /Sorry, I could not process|let'?s make it simple/i.test(r);
  check(`4b EN "${p}" → topic-specific`, !isFallback && r.length > 30, `r="${r.slice(0, 120)}"`);
  check(`4b EN "${p}" → no invented $`,
    !/\$\d|7407|10550|6825/.test(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. FAKE-NAME DETECTION — placeholder, cartoon, throwaway names
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 5. Fake name detection ===');
const fakeNames = [
  'mickey mouse', 'donald duck', 'john doe', 'jane doe',
  'test test', 'asdf qwerty', 'fulano sutano', 'santa claus',
  'batman', 'fuck off', 'aaaaa', 'a', 'no', 'si',
];
for (const n of fakeNames) {
  const flags = detectFakeContactSignals({ name: n });
  check(`5.fake-name "${n}" → flagged`, flags.length > 0, `flags=${JSON.stringify(flags)}`);
}
const realNames = ['Maria Rodriguez', 'John Smith', 'José García', 'Anne O\'Brien'];
for (const n of realNames) {
  const flags = detectFakeContactSignals({ name: n });
  check(`5.real-name "${n}" → not flagged`, flags.length === 0, `flags=${JSON.stringify(flags)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. FAKE-PHONE DETECTION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 6. Fake phone detection ===');
const fakePhones = [
  '1234567890', '0000000000', '1111111111', '5555551234',
  '212-555-1234', '(212) 555-9999', '5550001234',
  '9999999999', '0123456789',
];
for (const p of fakePhones) {
  const flags = detectFakeContactSignals({ phone: p });
  check(`6.fake-phone "${p}" → flagged`, flags.length > 0, `flags=${JSON.stringify(flags)}`);
}
const realPhones = ['212-555-1234'.replace('555', '683'), '(917) 555-1212'.replace('555', '683'),
  '914-825-9876', '7185551234'.replace('555', '683')];
for (const p of realPhones) {
  const flags = detectFakeContactSignals({ phone: p });
  check(`6.real-phone "${p}" → not flagged`, flags.length === 0, `flags=${JSON.stringify(flags)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. FAKE-EMAIL DETECTION
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 7. Fake email detection ===');
const fakeEmails = [
  'test@test.com', 'test@example.com', 'asdf@asdf.com',
  'a@b.co', 'aaaa@anything.com', 'admin@admin.com',
  'someone@mailinator.com', 'temp@yopmail.com',
  'fake1@fake.com', 'noreply@noreply.com', 'sample@sample.com',
];
for (const e of fakeEmails) {
  const flags = detectFakeContactSignals({ email: e });
  check(`7.fake-email "${e}" → flagged`, flags.length > 0, `flags=${JSON.stringify(flags)}`);
}
const realEmails = ['maria.rodriguez@gmail.com', 'jsmith@yahoo.com', 'jose.garcia@outlook.com'];
for (const e of realEmails) {
  const flags = detectFakeContactSignals({ email: e });
  check(`7.real-email "${e}" → not flagged`, flags.length === 0, `flags=${JSON.stringify(flags)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. NO FAKE DOLLAR AMOUNTS — Sawil's $7,407 from ZIP bug must stay dead.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 8. No invented $ amounts from ZIP ===');
{
  const flows = [
    ['español', '07407', 'TENGO PROBLEMAS CON MIS MEDICINAS Y DOCTORES'],
    ['español', '10550', 'mi doctor no me quiere atender'],
    ['english', '07407', 'I have problems with my meds and doctors'],
    ['english', '32301', "my doctor won't see me"],
    ['español', '06825', 'mi medicamento no esta cubierto'],
  ];
  for (let i = 0; i < flows.length; i++) {
    const { responses } = run(flows[i]);
    const last = responses[responses.length - 1];
    check(`8.${i + 1} no $ amount invented`, !/\$\d|7,?407|6,?825|10,?550|32,?301/.test(last),
      `r="${last.slice(0, 120)}"`);
    check(`8.${i + 1} no fake "factura de"`, !/factura de \$|bill of \$/i.test(last));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. ZIP STATE FEEDBACK — Wave 45 regression
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 9. ZIP feedback announces state ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  const r = processMessage('12345', s);
  check('9.1 ES NY ZIP mentions Nueva York', /nueva york/i.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  const r = processMessage('07407', s);
  check('9.2 EN NJ ZIP mentions NJ', /\bNJ\b|new jersey/i.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  const r = processMessage('90210', s);
  check('9.3 ES out-of-area notes outside service area',
    /fuera.*servicio|fuera.*ClearPoint|no.*servicio/i.test(r.response));
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. INTENT NEVER REPEATS THE EXACT APPEAL PARAGRAPH 2x
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 10. Appeal handler never repeats itself ===');
{
  const { responses } = run([
    'español', '06825',
    'mi plan no aprueba cirugia, cambiar plan?',
    'mi plan no aprueba cirugia, cambiar plan?',
    'mi plan no aprueba cirugia, cambiar plan?',
    'mi plan no aprueba cirugia, cambiar plan?',
  ]);
  // Each of responses[2..5] must be distinct from the others.
  const unique = new Set(responses.slice(2).map((r) => r.trim()));
  check('10.1 4 appeal turns → 4 distinct responses',
    unique.size === 4, `got ${unique.size} unique`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. SAFETY ESCALATION still works (regression)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 11. Crisis still routes to 988 ===');
{
  const { responses, state } = run([
    'español', '06825', 'me quiero matar',
  ]);
  check('11.1 ES crisis → 988', /988/.test(responses[2]) && state.needsHuman);
}
{
  const { responses, state } = run([
    'english', '10550', 'I want to kill myself',
  ]);
  check('11.2 EN crisis → 988', /988/.test(responses[2]) && state.needsHuman);
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. PHI LEAK still hidden
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 12. PHI leak is sanitized ===');
{
  const { responses } = run([
    'español', '06825', 'mi numero de medicare es 1AB2-CD3-EF45',
  ]);
  check('12.1 PHI warning shown', /seguridad|seguro|medicare/i.test(responses[2]));
  check('12.1 PHI not echoed back', !/1AB2-CD3-EF45/.test(responses[2]));
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. COMPLIANCE — never confirms eligibility, network, doctor coverage
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 13. Compliance — no specific plan recommendations ===');
{
  const phrases = [
    ['español', '06825', '¿qué plan es mejor para mí?'],
    ['english', '10550', 'which plan is best for me?'],
    ['español', '06825', '¿está mi doctor en la red?'],
    ['english', '10550', 'is my doctor in network?'],
    ['español', '06825', '¿está cubierta mi medicina?'],
    ['english', '10550', 'is my drug covered?'],
  ];
  for (let i = 0; i < phrases.length; i++) {
    const { responses } = run(phrases[i]);
    const r = responses[2];
    // Must never affirm "yes your doctor IS covered" etc.
    check(`13.${i + 1} no specific affirmation`,
      !/\b(s[ií],? su doctor (s[ií]|est[aá]) cubierto|yes,? your doctor is (covered|in-network))\b/i.test(r));
    check(`13.${i + 1} mentions advisor or "no puedo confirmar"`,
      /asesor|advisor|no puedo confirmar|can'?t confirm/i.test(r));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. SHORT YES-VARIANTS during advisor offer all trigger handoff
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 14. Yes-variants → handoff ===');
const yeses = ['sí', 'si', 'si por favor', 'yes', 'ok', 'claro', 'adelante', 'por favor'];
for (const y of yeses) {
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('06825', s).newState;
  s = processMessage('mi doctor no quiere mi plan', s).newState;
  s = processMessage('me dijeron q debo cambiar de plan', s).newState;
  s = processMessage('la muchacha de alante la oficina del doctor', s).newState;
  const r = processMessage(y, s);
  check(`14 "${y}" → handoff started`,
    (r.needsHuman || r.newState.advisorHandoffStarted) && /nombre|name/i.test(r.response));
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. ALL the previous-wave regressions still pass (smoke)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 15. Smoke from previous waves still green ===');
{
  // V44 — ZIP 07407 must not become $7,407
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('07407', s).newState;
  const r = processMessage('TENGO PROBLMAS CON MIS MEDICINAS Y DOCTORES', s);
  check('15.1 ZIP 07407 not invented as bill', !/7,?407|\$7/.test(r.response));
}
{
  // V21 — "10k" detected as $10,000 in the proven typo flow.
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('Factura', s).newState;
  s = processMessage('hopital', s).newState;
  const r = processMessage('recibi una facyuta de 10k', s);
  check('15.2 "10k" → $10,000 referenced (typo flow)', /10,000/.test(r.response));
}
{
  // V21 — fuzzy concept matching still works
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  const r = processMessage('voy al hopital', s);
  check('15.3 typo "hopital" still parsed (response not generic)',
    r.response.length > 40 && !/Perd[oó]n, no pude procesar/.test(r.response));
}

// ─────────────────────────────────────────────────────────────────────────────
// 16. VALIDATE EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 16. Validator helpers exported correctly ===');
check('16.1 validateName exists', typeof validateName === 'function');
check('16.2 validatePhone exists', typeof validatePhone === 'function');
check('16.3 validateEmail exists', typeof validateEmail === 'function');
check('16.4 detectFakeContactSignals exists', typeof detectFakeContactSignals === 'function');

// ─────────────────────────────────────────────────────────────────────────────
// 17. SUSTAINED CONVERSATION — 8 turns, no fallback, no loop
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 17. 8-turn conversation — no fallback, no loop ===');
{
  const { responses, state } = run([
    'español', '06825',
    'tengo problemas con mi cobertura',
    'mi doctor no acepta',
    'me duele la espalda',
    'no se que hacer',
    'quiero ver opciones',
    'soy nuevo',
  ]);
  for (let i = 1; i < responses.length; i++) {
    check(`17.${i} turn ${i + 1} not equal to turn ${i}`,
      responses[i - 1].trim() !== responses[i].trim());
    check(`17.${i} turn ${i + 1} not generic fallback`,
      !/Perd[oó]n, no pude procesar/i.test(responses[i]));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 18. NEW USER PIVOT FLOW — full lead-qual path
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 18. New-user lead-qual full flow ===');
{
  const { responses, state } = run([
    'español', '06825',
    'mi plan no aprueba cirugia',
    'no soy nuevo',
    'si ver opciones',
  ]);
  check('18.1 final pivot offers advisor or quickReplies',
    /asesor|opciones/i.test(responses[responses.length - 1])
    || (state.quickReplies || []).length >= 1);
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

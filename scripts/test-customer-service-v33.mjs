// Wave 33 — Enterprise repair: 3-tier provider repetition + letter triage
// + benefits/billing detectors + topic-aware language switch + lead notes.
// Sawil's exact required tests A–M, with full Proof 1 and Proof 2 transcripts.

import {
  processMessage,
  createInitialState,
  detectLetterAnswer,
  detectBenefitsAnswer,
  detectBillingAnswer,
  buildLeadNotes,
  detectExplicitLanguageSwitch,
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

console.log('\n=== DETECTORS ===');
check('detectLetterAnswer "Medicare" → medicare',
  detectLetterAnswer('Medicare').category === 'medicare');
check('detectLetterAnswer "Seguro Social" → social_security',
  detectLetterAnswer('Seguro Social').category === 'social_security');
check('detectLetterAnswer "renovación" → renewal',
  detectLetterAnswer('es sobre renovación').category === 'renewal');
check('detectLetterAnswer "cancelación" → cancellation',
  detectLetterAnswer('cancelación').category === 'cancellation');
check('detectBenefitsAnswer "dental" → dental',
  detectBenefitsAnswer('dental').category === 'dental');
check('detectBenefitsAnswer "OTC" → otc_card',
  detectBenefitsAnswer('tarjeta OTC').category === 'otc_card');
check('detectBenefitsAnswer "transporte" → transportation',
  detectBenefitsAnswer('transporte').category === 'transportation');
check('detectBillingAnswer "hospital" → hospital',
  detectBillingAnswer('hospital').category === 'hospital');
check('detectBillingAnswer "farmacia" → pharmacy',
  detectBillingAnswer('farmacia').category === 'pharmacy');

console.log('\n=== LANGUAGE-SWITCH DETECTOR (family phrasing) ===');
check('"my mom speaks spanish" → es',
  detectExplicitLanguageSwitch('my mom speaks spanish') === 'es');
check('"mi mamá habla español" → es',
  detectExplicitLanguageSwitch('mi mamá habla español') === 'es');
check('"my wife speaks spanish" → es',
  detectExplicitLanguageSwitch('my wife speaks spanish') === 'es');
check('"i prefer english" → en',
  detectExplicitLanguageSwitch('I prefer English') === 'en');

console.log('\n=== TEST A: Spanish provider (Sawil 12345) ===');
{
  const { state: s, last: r } = drive(
    ['mi doctor no quiere aceptar mi seguro'], 'español', '12345',
  );
  check('A: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('A: asks primary or specialist',
    /primario.*especialista|especialista.*primario/i.test(r.response));
  check('A: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response));
}

console.log('\n=== TEST B: Spanish provider 3-tier repetition ===');
{
  // Tier 1: ask
  // Tier 2: "Ya tengo esa parte. Para seguir sin repetir..."
  // Tier 3: advisor
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  const r1 = processMessage('mi doctor no quiere aceptar mi seguro', s);
  s = r1.newState;
  check('B1: first turn asks primary/specialist',
    /primario.*especialista/i.test(r1.response));

  const r2 = processMessage('mi doctor no quiere aceptar mi seguro', s);
  s = r2.newState;
  check('B2: 2nd turn — short ack ("Ya tengo esa parte")',
    /ya tengo esa parte|sin repetir/i.test(r2.response),
    `r2="${r2.response.slice(0, 200)}"`);
  check('B2: 2nd turn does NOT repeat full first paragraph',
    !/eso suena como un problema con un doctor.proveedor.*no una pregunta general/i.test(r2.response));
  check('B2: 2nd turn does NOT yet escalate to advisor',
    !(r2.needsHuman === true || s.needsHuman === true));

  const r3 = processMessage('mi doctor no quiere aceptar mi seguro', s);
  s = r3.newState;
  check('B3: 3rd turn — advisor offer with PHI guardrail',
    r3.needsHuman === true || s.needsHuman === true);
  check('B3: PHI guardrail present',
    /n[uú]mero de medicare|seguro social|bancaria|m[eé]dicos privados/i.test(r3.response));
  check('B3: NOT a restart',
    !/qu[eé] idioma|what language|c[oó]digo postal/i.test(r3.response));
}

console.log('\n=== TEST C: Spanish specialist short answer ===');
{
  const { state: s, last: r } = drive(
    ['mi doctor no quiere aceptar mi seguro', 'especialista'],
    'español', '12345',
  );
  check('C: providerIssueType=specialist_not_accepting',
    s.providerIssueType === 'specialist_not_accepting');
  check('C: asks appointment scheduled',
    /cita programada|tiene.*cita|appointment/i.test(r.response));
}

console.log('\n=== TEST D: Spanish provider "no sé" ===');
{
  const { state: s, last: r } = drive(
    ['mi doctor no quiere aceptar mi seguro', 'no sé'],
    'español', '12345',
  );
  check('D: provider context preserved',
    s.serviceCategory === 'doctor_provider_network');
  check('D: needsHuman=true (advisor offer)',
    r.needsHuman === true || s.needsHuman === true);
  check('D: does NOT reset to language/ZIP',
    !/qu[eé] idioma|c[oó]digo postal/i.test(r.response));
}

console.log('\n=== TEST E: English provider ===');
{
  const { state: s, last: r } = drive(
    ['my doctor does not take my insurance'], 'english', '07407',
  );
  check('E: serviceCategory=doctor_provider_network',
    s.serviceCategory === 'doctor_provider_network');
  check('E: asks primary/specialist',
    /primary.*specialist|specialist.*primary/i.test(r.response));
}

console.log('\n=== TEST F: English medication full flow ===');
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
  check('F: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('F: needsHuman=true', r.needsHuman === true || s.needsHuman === true);
  check('F: advisor + PHI guardrail',
    /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log('\n=== TEST G: Spanish medication ===');
{
  const { state: s, last: r } = drive(
    ['la farmacia dice que no lo cubre'], 'español', '10550',
  );
  check('G: serviceCategory=drug', s.serviceCategory === 'drug');
  check('G: asks targeted medication question',
    /cubr|farmacia|rechaz|carta del plan|precio/i.test(r.response));
  check('G: NOT generic coverage paragraph',
    !/cobertura es uno de los temas m[aá]s importantes/i.test(r.response));
}

console.log('\n=== TEST H: Letter triage state machine ===');
{
  // Step 1: detect letter, ask sender
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('10550', s).newState;
  const r1 = processMessage('me llegó una carta del plan', s);
  s = r1.newState;
  check('H1: serviceCategory=letter', s.serviceCategory === 'letter');
  // "del plan" already identifies the sender, so handler may skip sender question
  // and go straight to asking type. Both are acceptable.
  check('H1: response asks sender OR type',
    /medicare|seguro social|medicaid|plan|renovaci[oó]n|cancelaci[oó]n/i.test(r1.response),
    `r1="${r1.response.slice(0, 200)}"`);

  const r2 = processMessage('renovación', s);
  s = r2.newState;
  check('H2: letterIssueType=renewal', s.letterIssueType === 'renewal');
  check('H2: response summarizes sender + type or offers advisor',
    /renovaci[oó]n|asesor licenciado|le contact|carta de/i.test(r2.response));
}

console.log('\n=== TEST H-EN: English letter ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  const r = processMessage('I got a letter', s);
  s = r.newState;
  check('H-EN: asks letter sender',
    /Medicare.*Social Security|Social Security.*Medicaid/i.test(r.response));
}

console.log('\n=== TEST I: Benefits — OTC card ===');
{
  const { state: s, last: r } = drive(
    ['mi tarjeta OTC no funciona'], 'español', '10550',
  );
  check('I: serviceCategory in {otc, benefits, id_card}',
    ['otc', 'benefits', 'id_card'].includes(s.serviceCategory)
      || /otc|tarjeta|balance|rechazada/i.test(r.response));
}

console.log('\n=== TEST J: Billing hospital ===');
{
  const { state: s, last: r } = drive(
    ['me llegó una factura del hospital'], 'español', '10550',
  );
  check('J: bill source detected',
    s.billSource === 'provider' || /hospital|cobro|factura|usted debe/i.test(r.response));
  check('J: NO plan recommendation',
    !/best plan|mejor plan|recommend a plan/i.test(r.response));
}

console.log('\n=== TEST K: Language switch ("mi mamá habla español") — preserves topic ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage('my doctor does not take my insurance', s).newState;
  const r = processMessage('mi mamá habla español', s);
  s = r.newState;
  check('K: language switched to es', s.language === 'es');
  check('K: serviceCategory preserved (doctor)',
    s.serviceCategory === 'doctor_provider_network');
  check('K: response in Spanish + mentions doctor',
    /doctor|m[eé]dico|primario|especialista/i.test(r.response));
  check('K: does NOT restart ZIP or language prompt',
    !/qu[eé] idioma|c[oó]digo postal/i.test(r.response));
}

console.log('\n=== TEST L: Frustration (no topic → Case A) ===');
{
  // V34: with no topic established, frustration → Case A recovery asks the
  // user for the topic, with chips, not "no voy a repetir".
  const { state: s, last: r } = drive(['no me entiendes'], 'español', '10550');
  check('L: response asks for topic',
    /tema|medicamento|doctor|carta|factura/i.test(r.response));
  check('L: chips include Medicamentos',
    (s.quickReplies || []).includes('Medicamentos'));
  check('L: short response (<60 words)',
    r.response.split(/\s+/).length < 60);
}

console.log('\n=== TEST M: 20-message run — state stays stable ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  for (let i = 0; i < 18; i++) {
    const inputs = [
      'hello', 'hmm', 'i have a problem with my meds', "they don't want to pay",
      'the pharmacy', 'prior authorization', 'idk', 'no', 'maybe',
      'i have a problem with my doctor', 'primary', 'no', 'i got a letter',
      'medicare', 'renewal', 'asesor', 'thank you', 'bye',
    ];
    s = processMessage(inputs[i % inputs.length], s).newState;
  }
  check('M: state.messages length ≥ 30',
    s.messages.length >= 30);
  check('M: state never corrupted (turnCount > 18)',
    s.turnCount >= 18);
}

console.log('\n=== LEAD NOTES BUILDER ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  s = processMessage('mi doctor no quiere aceptar mi seguro', s).newState;
  s = processMessage('especialista', s).newState;
  const notes = buildLeadNotes(s);
  check('Notes: includes Language',
    /Language: Spanish/.test(notes));
  check('Notes: includes ZIP', /ZIP: 12345/.test(notes));
  check('Notes: includes Topic',
    /Topic: doctor_provider_network/.test(notes));
  check("Notes: includes User's own words",
    /User's own words.*especialista/i.test(notes));
  check('Notes: includes Compliance note',
    /Compliance note: Bot did not confirm/i.test(notes));
  check('Notes: includes Questions asked',
    /Questions asked.*provider_/i.test(notes));
}

console.log('\n=== SAWIL PROOF 1 (Spanish provider 3-tier) ===');
{
  let s = createInitialState();
  let r;
  r = processMessage('español', s); s = r.newState;
  console.log('  USER: español');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('12345', s); s = r.newState;
  console.log('  USER: 12345');
  console.log('  BOT:  ' + r.response.slice(0, 200));
  r = processMessage('mi doctor no quiere aceptar mi seguro', s); s = r.newState;
  console.log('  USER: mi doctor no quiere aceptar mi seguro');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('P1 T1: providerIssueType set',
    s.providerIssueType === 'provider_access_issue');
  check('P1 T1: asks primary vs specialist',
    /primario.*especialista/i.test(r.response));

  r = processMessage('mi doctor no quiere aceptar mi seguro', s); s = r.newState;
  console.log('  USER: mi doctor no quiere aceptar mi seguro (repeat)');
  console.log('  BOT:  ' + r.response.slice(0, 250));
  check('P1 T2: short ack — does NOT repeat full paragraph',
    /ya tengo|sin repetir/i.test(r.response));
}

console.log('\n=== SAWIL PROOF 2 (English medication full path) ===');
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
  check('P2: medicationIssueType=pharmacy_rejected',
    s.medicationIssueType === 'pharmacy_rejected');
  check('P2: advisor offer + PHI',
    /licensed advisor/i.test(r.response) && /medicare id|ssn|banking/i.test(r.response));
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

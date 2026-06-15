/* eslint-disable no-console */
// Sawil 2026-06-12 — Contact-flow regression harness (3 bugs).
// Drives the pure deterministic collector (processMessage) offline.
// Run: npx tsx _flowharness.ts
import { processMessage, _isMedicareCostComplaint, _looksLikeStatedProblem, _buildPostZipReaskReplacement } from '../src/lib/customerServiceEngine';

type Any = any;
let PASS = 0, FAIL = 0;
const lines: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  if (cond) { PASS++; lines.push(`  ✅ ${label}`); }
  else { FAIL++; lines.push(`  ❌ ${label}${detail ? '  — ' + detail : ''}`); }
}

function run(seed: Any, turns: string[]) {
  let st: Any = seed;
  const log: Any[] = [];
  for (const t of turns) {
    const r = processMessage(t, st);
    st = r.newState;
    log.push({ user: t, bot: r.response, intent: st.lastBotIntent, chips: st.quickReplies, name: st.name, phone: st.phoneNumber, email: st.email, closed: st.conversationClosed });
  }
  return { st, log };
}

const seedAskName = (): Any => ({
  language: 'es', zipCode: '11550', state: 'NY',
  advisorHandoffStarted: true, pendingAdvisorHandoff: true, conversationClosed: false,
  lastBotIntent: 'handoff_asking_name', turnCount: 6,
  messages: [{ role: 'bot', content: '¿cuál es su nombre completo?', timestamp: 0 }],
});

const seedPostContact = (): Any => ({
  language: 'es', zipCode: '11550', state: 'NY',
  advisorHandoffStarted: true, conversationClosed: false,
  name: 'Mario Rossi', phoneNumber: '6463125847', email: 'mario.t@gmail.com', emailAsked: true,
  lastBotIntent: 'anything_else', turnCount: 12,
  messages: [{ role: 'bot', content: 'Perfecto, un asesor le llamará. ¿Algo más en lo que pueda ayudarle?', timestamp: 0 }],
});

console.log('\n=== CONTACT-FLOW HARNESS ===\n');

// ---- A. Nombre simple: "Mario" → pide apellido, no acepta Mario como completo
lines.push('A. Nombre simple');
{
  const r1 = processMessage('Mario', seedAskName());
  check('A1 pide apellido tras "Mario"', /apellido|last name/i.test(r1.response), r1.response.slice(0, 70));
  check('A2 NO finaliza "Mario" como nombre completo', (r1.newState as Any).name === 'Mario' && (r1.newState as Any).lastBotIntent === 'handoff_asking_lastname', `name=${(r1.newState as Any).name} intent=${(r1.newState as Any).lastBotIntent}`);
  const r2 = processMessage('Rossi', r1.newState);
  check('A3 nombre completo = "Mario Rossi"', /Mario Rossi/i.test(String((r2.newState as Any).name)), `name=${(r2.newState as Any).name}`);
}

// ---- B. Email inválido vs válido, sin inventar punto
lines.push('B. Email inválido/válido');
{
  // walk to email step
  const w = run(seedAskName(), ['Mario', 'Rossi', '6463125847']);
  const atEmail = w.st;
  check('B0 llegó al paso de email', atEmail.lastBotIntent === 'handoff_asking_email', `intent=${atEmail.lastBotIntent}`);
  // user opts to give email
  const yes = processMessage('sí le doy mi correo', atEmail);
  // invalid: no @
  const bad = processMessage('mariogmail.com', yes.newState);
  check('B1 rechaza "mariogmail.com" (sin @)', !(bad.newState as Any).email && /correo|email/i.test(bad.response), `email=${(bad.newState as Any).email}`);
  // spaced email must NOT be stored mangled as mario.t@gmail.com
  const spaced = processMessage('mario t @gmail.com', yes.newState);
  check('B2 NO inventa punto en "mario t @gmail.com"', (spaced.newState as Any).email !== 'mario.t@gmail.com', `email=${(spaced.newState as Any).email}`);
  // valid email accepted as-is
  const good = processMessage('marioto@gmail.com', yes.newState);
  check('B3 acepta "marioto@gmail.com" tal cual', (good.newState as Any).email === 'marioto@gmail.com', `email=${(good.newState as Any).email}`);
}

// ---- C. Email opcional: skip / "no tengo email" continúa
lines.push('C. Email opcional');
{
  const w = run(seedAskName(), ['Mario', 'Rossi', '6463125847']);
  const skip = processMessage('no tengo email', w.st);
  check('C1 "no tengo email" continúa sin error', !!skip.response && !/error|undefined/i.test(skip.response), skip.response.slice(0, 60));
  check('C2 email queda vacío (opcional)', !(skip.newState as Any).email, `email=${(skip.newState as Any).email}`);
  const w2 = run(seedAskName(), ['Mario', 'Rossi', '6463125847']);
  const sk2 = processMessage('saltar', w2.st);
  check('C3 "saltar" continúa', !!sk2.response, sk2.response.slice(0, 60));
  // C4 — "salta" (typo, missing r) must be treated as skip, not loop
  const w4 = run(seedAskName(), ['Mario', 'Rossi', '6463125847']);
  const sk4 = processMessage('salta', w4.st);
  check('C4 "salta" (typo) NO re-pregunta email', !/escribe un correo v[aá]lido|puede decir "saltar"|type a valid email/i.test(sk4.response), sk4.response.slice(0, 70));
  // C5 — unrecognized input on the 2nd email attempt auto-skips (no infinite loop)
  const w5 = run(seedAskName(), ['Mario', 'Rossi', '6463125847']);
  const r5a = processMessage('xyz', w5.st);
  const r5b = processMessage('xyz', (r5a as Any).newState);
  check('C5 input raro repetido -> auto-skip (no loop)', !/escribe un correo v[aá]lido|type a valid email/i.test(r5b.response), r5b.response.slice(0, 70));
}

// ---- D. Consentimiento: el collector no auto-marca consentimiento
lines.push('D. Consentimiento (no auto-consent)');
{
  const w = run(seedAskName(), ['Mario', 'Rossi', '6463125847', 'marioto@gmail.com']);
  check('D1 collector NO setea consent_to_contact=true solo', (w.st as Any).consent_to_contact !== true, `consent_to_contact=${(w.st as Any).consent_to_contact}`);
}

// ---- E. Cierre sin chips
lines.push('E. Cierre sin chips');
{
  const r = processMessage('gracias, eso es todo', seedPostContact());
  check('E1 cierre sin chips', Array.isArray((r.newState as Any).quickReplies) ? (r.newState as Any).quickReplies.length === 0 : !(r.newState as Any).quickReplies, `chips=${JSON.stringify((r.newState as Any).quickReplies)}`);
  check('E2 conversación cerrada', (r.newState as Any).conversationClosed === true);
}

// ---- F. Flujo de recolección completo (porción en alcance)
lines.push('F. Recolección completa');
{
  const w = run(seedAskName(), ['Mario', 'Rossi', '6463125847', 'marioto@gmail.com']);
  check('F1 nombre completo capturado', /Mario Rossi/i.test(String((w.st as Any).name)));
  check('F2 teléfono capturado', String((w.st as Any).phoneNumber || '').replace(/\D/g, '').includes('6463125847'));
  check('F3 email capturado', (w.st as Any).email === 'marioto@gmail.com');
  const closeT = processMessage('gracias eso es todo', w.st);
  check('F4 cierra limpio sin chips', (closeT.newState as Any).conversationClosed === true && (((closeT.newState as Any).quickReplies || []).length === 0));
}

// ---- BUG 2 / Change 2: correction handler (re-ask only that field, no menu)
lines.push('Cambio 2 — corrección');
{
  const c1 = processMessage('el email está mal escrito', seedPostContact());
  check('Corr-email re-pregunta SOLO email', /correo|email/i.test(c1.response) && !/factura|doctor|cobertura|carta/i.test(c1.response), c1.response.slice(0, 80));
  check('Corr-email NO abre menú de temas', !Array.isArray((c1.newState as Any).quickReplies) || (c1.newState as Any).quickReplies.length === 0, `chips=${JSON.stringify((c1.newState as Any).quickReplies)}`);
  check('Corr-email NO cierra el caso', (c1.newState as Any).conversationClosed !== true);

  const c2 = processMessage('no tienes mi nombre completo', seedPostContact());
  check('Corr-nombre re-pregunta nombre', /nombre/i.test(c2.response) && !/factura|doctor|cobertura/i.test(c2.response), c2.response.slice(0, 80));
  check('Corr-nombre NO abre menú', !Array.isArray((c2.newState as Any).quickReplies) || (c2.newState as Any).quickReplies.length === 0);

  const c3 = processMessage('mi teléfono está equivocado', seedPostContact());
  check('Corr-teléfono re-pregunta teléfono', /tel[eé]fono|n[uú]mero/i.test(c3.response), c3.response.slice(0, 80));
}

// ---- Change 3: email-ask sin chips
lines.push('Cambio 3 — email sin chips');
{
  const w = run(seedAskName(), ['Mario', 'Rossi', '6463125847']);
  check('Email-ask sin chips', ((w.st as Any).quickReplies || []).length === 0, `chips=${JSON.stringify((w.st as Any).quickReplies)}`);
}

// ---- Change 1: detection regex matches the live LLM name-ask
lines.push('Cambio 1 — regex routing');
{
  const re = /\b(su nombre|cu[aá]l es su nombre|nombre completo|your name|your full name|what'?s your name)\b/i;
  check('Regex matchea name-ask en vivo', re.test('Excelente. Para que el asesor pueda contactarle, necesito su nombre y número de teléfono. ¿Cuál es su nombre?'));
  check('Regex NO matchea charla normal', !re.test('Medicare Advantage incluye cobertura dental y de la vista.'));
}

// ---- Crisis / medical emergency (Case 6A self-harm→988, 6B medical→911)
lines.push('Crisis / emergencia médica');
{
  const seedMid = (): Any => ({ language: 'es', zipCode: '11550', state: 'NY', step: 'chatting', advisorHandoffStarted: false, conversationClosed: false, turnCount: 3, messages: [{ role: 'bot', content: '¿En qué le puedo ayudar?', timestamp: 0 }] });
  const selfHarm = processMessage('Estoy desesperado y me quiero hacer daño', seedMid());
  check('6A self-harm → 988', /988/.test(selfHarm.response), selfHarm.response.slice(0, 90));
  check('6A self-harm needsHuman', (selfHarm as Any).needsHuman === true);
  const medical = processMessage('Me duele el pecho, creo que me está dando un infarto', seedMid());
  check('6B emergencia médica → 911 y NO 988', /911/.test(medical.response) && !/988/.test(medical.response), medical.response.slice(0, 100));
  check('6B médico needsHuman', (medical as Any).needsHuman === true);
  // self-harm must NOT be mislabeled as medical-only (must contain 988, the crisis line)
  check('6A NO se va a flujo Medicare normal', !/medicare advantage|parte b|inscripci/i.test(selfHarm.response), selfHarm.response.slice(0, 60));
}

// ---- G. Post-ZIP topic preservation (Clara support microfix 2026-06-14)
//      The async ZIP anti-re-ask guard must continue FROM the stated problem,
//      never reset to a generic ask and never parrot the ZIP back.
lines.push('G. Post-ZIP topic preservation');
{
  // G1 — cost complaint (ES): focused source-triage, no ZIP parrot, no generic reset
  const g1 = _buildPostZipReaskReplacement('me están cobrando mucho de medicare', true);
  check('G1 costo ES → pregunta la fuente (SS/farmacia/doctor/factura)',
    /seguro social/i.test(g1) && /farmacia/i.test(g1) && /doctor/i.test(g1) && /factura/i.test(g1), g1.slice(0, 80));
  check('G1b costo ES → NO repite "código postal" ni "cuénteme un poco más"',
    !/c[oó]digo postal/i.test(g1) && !/cu[ée]nteme un poco m[áa]s/i.test(g1), g1.slice(0, 80));
  // G2 — cost complaint (EN): English source-triage, no ZIP parrot
  const g2 = _buildPostZipReaskReplacement('they are charging me too much', false);
  check('G2 cost EN → asks the source (Social Security/pharmacy/doctor/bill)',
    /social security/i.test(g2) && /pharmacy/i.test(g2) && /doctor/i.test(g2) && /bill/i.test(g2), g2.slice(0, 80));
  check('G2b cost EN → does NOT repeat "ZIP"', !/\bzip\b/i.test(g2), g2.slice(0, 80));
  // G3 — non-cost statement: concrete clarifier with options, never the ZIP parrot
  const g3 = _buildPostZipReaskReplacement('necesito ayuda con una carta que recibí', true);
  check('G3 no-costo ES → clarificador concreto con opciones', /factura|medicamento|doctor|carta|costo/i.test(g3), g3.slice(0, 80));
  check('G3b no-costo ES → NO repite "código postal"', !/c[oó]digo postal/i.test(g3), g3.slice(0, 80));
  // G4 — cost-complaint classifier matches every mission example
  const costExamples = [
    'me están cobrando mucho de medicare', 'me sacan mucho', 'me llegó una factura',
    'los medicamentos están caros', 'el doctor me cobró', 'no entiendo lo que me descuentan',
    'me quitaron como 200',
  ];
  check('G4 clasificador detecta los 7 ejemplos de costo',
    costExamples.every((m) => _isMedicareCostComplaint(m)),
    costExamples.filter((m) => !_isMedicareCostComplaint(m)).join(' | '));
  // G5 — classifier does NOT fire on non-cost intents
  const nonCost = ['quiero cambiar mi doctor', 'necesito una cita', 'tengo una pregunta sobre inscripción', 'hola'];
  check('G5 clasificador NO dispara en no-costo',
    nonCost.every((m) => !_isMedicareCostComplaint(m)),
    nonCost.filter((m) => _isMedicareCostComplaint(m)).join(' | '));
  // G6 — lastUserProblem fill: substantive problem yes, pushback/yes-no no
  check('G6 recuerda problema sustantivo', _looksLikeStatedProblem('me están cobrando mucho de medicare'));
  check('G6b NO guarda pushback/yes-no como problema',
    !_looksLikeStatedProblem('ya te dije') && !_looksLikeStatedProblem('si') && !_looksLikeStatedProblem('no'));
}

console.log(lines.join('\n'));
console.log(`\n=== TOTAL: ${PASS} PASS / ${FAIL} FAIL ===\n`);
process.exit(FAIL > 0 ? 1 : 0);

// LIVE MULTI-TURN SCENARIOS (§24) — Scenarios A–H, 8+ turns where specified,
// against the REAL handler + REAL OpenAI. State is evaluated after every turn.
//
// Bounded (§11): sequential (concurrency 1), hard cap MAX_REQUESTS total, each
// request timeboxed. QA model is selected automatically outside production
// (VERCEL_ENV routing), so this corpus can never burn the production model.
//
//   local:   node scripts/dev-api-server.mjs   →  node scripts/live-clara-scenarios.mjs
//   preview: BASE=https://<preview>.vercel.app node scripts/live-clara-scenarios.mjs
const BASE = (process.env.BASE || 'http://localhost:3011').replace(/\/$/, '');
const URL_CHAT = BASE + '/api/chat';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = []; let requests = 0;
const MAX_REQUESTS = 80;
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? '\n      ' + why : ''}`); };

let _scenarioIp = 0;
async function turn(history, userMessage, ctx, ip) {
  if (requests >= MAX_REQUESTS) throw new Error('request budget exhausted');
  requests++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const r = await fetch(URL_CHAT, {
      // Per-scenario source IP (honored off-Vercel only): the production
      // 30-req/5-min per-IP rate limit correctly throttled this runner when
      // every scenario shared one IP — that control must stay ON, so the
      // runner identifies each scenario as its own caller instead.
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ userMessage, history, context: ctx }),
      signal: controller.signal,
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } finally { clearTimeout(timer); }
}

/** Drive a scenario: each step = [userMessage, perTurnAssert(reply, i)]. The
 *  history grows exactly the way llmHandler.ts builds it in the widget. */
async function scenario(name, ctx, steps) {
  console.log(`\n── ${name} ──`);
  const history = [];
  _scenarioIp++;
  const ip = `10.88.7.${_scenarioIp}`;
  for (let i = 0; i < steps.length; i++) {
    const [msg, assert, ctxPatch] = steps[i];
    const r = await turn(history.slice(-20), msg, ctxPatch ? { ...ctx, ...ctxPatch } : ctx, ip);
    const text = r.body && typeof r.body.response === 'string' ? r.body.response : '';
    check(`${name} t${i + 1} responds 200 with text`, r.status === 200 && text.length > 0, `status=${r.status}`);
    if (assert) {
      const verdictWhy = assert(text, r.body, i);
      check(`${name} t${i + 1} state assertion`, verdictWhy === true, typeof verdictWhy === 'string' ? `${verdictWhy}\n      got: ${text.slice(0, 140)}` : `got: ${text.slice(0, 140)}`);
    }
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: text });
  }
}

const ES = { language: 'es', zipCode: '11375', state: 'NY' };
const EN = { language: 'en', zipCode: '11375', state: 'NY' };
const noTuteo = (t) => !/\b(tienes|puedes|te llamar[aá]|contigo|quieres)\b/i.test(t) || 'tuteo (tú-form) in a senior-facing Spanish reply';
const noZipReask = (t) => !/c[oó]digo postal|zip code|what state do you live|en qu[eé] estado vive/i.test(t) || 're-asked the ZIP/state it already has';
const noCarrier = (t) => !/\b(aetna|humana|wellcare|unitedhealth|cigna)\b/i.test(t) || 'carrier name in reply';
const noEligPromise = (t) => !/usted califica para|you qualify for|guaranteed/i.test(t) || 'eligibility promised';

try {
  // A — Spanish, confused senior, Part B premium concern (8 turns)
  await scenario('A.es-part-b', ES, [
    ['Hola, me están cobrando mucho de Medicare y no entiendo', (t) => noTuteo(t)],
    ['como 200 dólares me quitan', (t) => noTuteo(t) && noZipReask(t)],
    ['sí, del cheque del seguro social cada mes', (t) => noTuteo(t)],
    ['¿y eso qué es exactamente?', (t) => noTuteo(t)],
    ['¿hay alguna ayuda para pagar menos?', (t) => noEligPromise(t)],
    ['no sé cuánto gano exactamente, mi hija maneja eso', (t) => noTuteo(t)],
    ['¿me pueden llamar para revisarlo?', () => true],
    ['gracias, muy amable', () => true],
  ]);
  // B — English, new-to-Medicare prospect (8 turns)
  await scenario('B.en-new-to-medicare', EN, [
    ['Hi, I turn 65 in three months, what do I need to do?', () => true],
    ['I am still working and have employer insurance', () => true],
    ['So do I need Part B right now or not?', (t) => noEligPromise(t)],
    ['What happens if I delay and there is a penalty?', () => true],
    ['OK and what is the difference between Advantage and a supplement?', (t) => noCarrier(t)],
    ['Which one is better for me?', (t) => noCarrier(t) && noEligPromise(t)],
    ['Can someone review this with me?', () => true],
    ['Yes please', () => true],
  ]);
  // C — Spanglish + correction mid-conversation (8 turns)
  await scenario('C.spanglish-correction', ES, [
    ['Hola, tengo un problema con my prescription drugs', () => true],
    ['la farmacia me cobró like 80 dollars por mis pastillas', () => true],
    ['no no, no es la parte B, es de las medicinas', (t) => !/parte b es|part b is/i.test(t) || 'kept pushing Part B after the correction'],
    ['eso no fue lo que pregunté, quiero saber por qué subió el precio', () => true],
    ['ya te dije que es de la farmacia', (t) => noZipReask(t)],
    ['¿el Extra Help me puede ayudar con eso?', (t) => noEligPromise(t)],
    ['ok how do I apply?', () => true],
    ['gracias', () => true],
  ]);
  // D — caregiver calling for her mother (8 turns)
  await scenario('D.caregiver', ES, [
    ['Buenas, no soy beneficiaria, soy la hija y llamo por mi mamá', (t) => !/est[aá] probando el sistema|testing the system/i.test(t) || 'caregiver treated as a tester'],
    ['mi mamá tiene 78 años y le llegó una carta del plan', () => true],
    ['dice que su doctor ya no está en la red', () => true],
    ['ella no puede cambiar de doctor, lleva 20 años con él', () => true],
    ['¿qué opciones tiene?', (t) => noCarrier(t)],
    ['¿puede cambiar de plan ahora o hay que esperar?', (t) => noEligPromise(t)],
    ['¿pueden llamarla a ella o me llaman a mí?', () => true],
    ['perfecto, gracias', () => true],
  ]);
  // E — affordability / MSP / Extra Help (8 turns)
  await scenario('E.affordability-msp', ES, [
    ['no me alcanza para pagar el Medicare, vivo solo de mi seguro social', () => true],
    ['recibo como 1400 al mes', (t) => noEligPromise(t)],
    ['¿qué es eso del MSP que mencionó?', () => true],
    ['¿y Extra Help es lo mismo?', () => true],
    ['¿dónde aplico para esos programas?', (t) => /ssa\.gov|social security|seguro social|medicaid|1-800/i.test(t) || 'no application path given'],
    ['¿ClearPoint me inscribe en eso?', (t) => !/nosotros le inscribimos en (msp|extra help)|we enroll you in (msp|extra help)/i.test(t) || 'claimed to be the MSP/LIS enrollment path'],
    ['ok ¿y ustedes en qué me ayudan entonces?', () => true],
    ['sí, que me llamen', () => true],
  ]);
  // F — service-area mismatch
  await scenario('F.out-of-area', { language: 'es', zipCode: '33101', state: 'FL' }, [
    ['Hola, vivo en Miami y quiero un plan de Medicare', (t) => /nueva york|new york|nueva jersey|connecticut/i.test(t) || 'did not state the NY/NJ/CT service area'],
    ['¿pero me pueden explicar cómo funciona el Medicare Advantage aunque sea?', () => true],
    ['gracias', () => true],
  ]);
  // G — confused elderly user, fragmented speech (8 turns)
  await scenario('G.confused-elderly', ES, [
    ['este eh me llego un papel algo de medicare no se', () => true],
    ['no entiendo', (t) => noTuteo(t)],
    ['es que dice algo de un monto no se cuanto', () => true],
    ['espere lo busco', () => true],
    ['dice 185 por mes', () => true],
    ['¿eso lo tengo que pagar yo?', (t) => noEligPromise(t)],
    // The REAL widget counts clarifications client-side and sends
    // clarificationCount, which arms the prompt's "offer advisor instead of
    // more re-explanation" note — the runner mirrors that here (fidelity to
    // production, not test-tuning).
    ['ay no entiendo nada de esto', (t) => /asesor|advisor|llame|call/i.test(t) || 'no human option offered to a repeatedly confused caller', { clarificationCount: 3 }],
    ['bueno que me llamen', () => true],
  ]);
  // H — crisis safety path (deterministic, must never reach the model)
  await scenario('H.crisis', EN, [
    ['I have been thinking about it and I want to kill myself', (t, body) => (/988/.test(t) && body.meta && body.meta.blocked === 'crisis_988') || 'crisis did not route to 988 deterministically'],
    ['I am sorry, I did not mean it, I have a Medicare question', () => true],
  ]);
} catch (e) {
  fail.push('SCENARIOS ABORTED: ' + (e && e.message));
}

console.log('');
console.log(`requests spent: ${requests}/${MAX_REQUESTS}`);
if (fail.length === 0) {
  console.log(GRN(`LIVE MULTI-TURN SCENARIOS: ${pass}/${pass} checks passed`));
} else {
  console.log(`LIVE MULTI-TURN SCENARIOS: ${pass}/${pass + fail.length} checks passed`);
  console.log(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.log('  ' + f);
  process.exitCode = 1;
}

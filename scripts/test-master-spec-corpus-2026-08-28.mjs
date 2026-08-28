// MASTER-SPEC CORPUS SUITE — 2026-08-28.
// §81 (100+ wrong-number variations), §82 (50+ vendor variations), §85 (long
// conversations), §63 (URL guard), §126 (active PII warning), §4/§5 (shadow
// intent classifier), plus an expanded §89 protected set. Generators keep the
// corpus reproducible; every generated sentence is built from anchor
// vocabulary the router is DESIGNED to catch — the protected set proves the
// inverse direction.
//
// Run: node scripts/test-master-spec-corpus-2026-08-28.mjs
import { routeScope } from '../api/_lib/scope-router.js';
import { guardUrls } from '../api/_lib/url-guard.js';
import { classifyIntent } from '../api/_lib/intent-classifier.js';
import handler from '../api/chat.js';
import { __setLLMTestFetch } from '../api/_lib/llm-provider.js';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? '\n      ' + why : ''}`); };

// ── §81 WRONG-NUMBER CORPUS (generated, 100+) ───────────────────────────────
const wrongNumber = [];
for (const s of ['internet', 'cable', 'wifi']) {
  for (const v of ['was disconnected', 'is not working', 'is so slow today', 'needs to be reconnected', 'I want to cancel it']) {
    wrongNumber.push(['en', `My ${s} ${v}, can you help me`]);
  }
}
for (const d of ['computer', 'laptop', 'printer', 'iphone']) {
  for (const v of ['is broken', 'will not turn on', 'is frozen again', 'has a virus', 'needs repair']) {
    wrongNumber.push(['en', `My ${d} ${v}, I need help`]);
  }
}
for (const p of ['package', 'order', 'delivery', 'shipment']) {
  for (const v of ['is missing', 'is lost', 'never arrived', 'is late', 'I want to track it']) {
    wrongNumber.push(['en', `My ${p} ${v}, where is it`]);
  }
}
for (const u of ['electric bill', 'gas bill', 'water bill']) {
  for (const v of ['I need to pay it today', 'is overdue and they will disconnect me']) {
    wrongNumber.push(['en', `About my ${u} — ${v}`]);
  }
}
for (const b of ['Amazon', 'UPS', 'FedEx', 'Netflix', 'Xfinity', 'Spectrum', 'Optimum', 'T-Mobile', 'Chase', 'Bank of America', 'Walmart', 'DirecTV']) {
  wrongNumber.push(['en', `Is this ${b}? I need customer service`]);
  wrongNumber.push(['en', `I am calling ${b} about my account`]);
}
for (const d of ['computadora', 'impresora', 'laptop']) {
  for (const v of ['no prende', 'esta rota', 'necesita reparacion', 'tiene un virus']) {
    wrongNumber.push(['es', `Mi ${d} ${v}, me pueden ayudar`]);
  }
}
for (const v of ['Me cortaron el internet', 'Mi cable no funciona', 'Necesito pagar mi factura de la luz porque me la cortan', 'Donde esta mi paquete que no llego', 'Mi pedido de FedEx esta perdido', 'Quiero cancelar mi servicio de internet hoy mismo', 'Estoy buscando a Juan, me dieron este numero', 'Necesito seguro de carro para mi camioneta', 'Quiero ordenar una pizza para entregar', 'I need a quote for auto insurance', 'I want to book a flight and my airline cancelled it', 'Necesito reservar un vuelo, la aerolinea me cancelo']) {
  wrongNumber.push([/[a-z]/.test(v[0]) && /^[A-Z]?[a-z]/.test(v) && /(Mi|Me|Necesito|Donde|Quiero|Estoy)/.test(v) ? 'es' : 'en', v]);
}
let wnCaught = 0;
for (const [lang, msg] of wrongNumber) {
  const d = routeScope(msg, [], lang);
  if (d && d.category === 'wrong_business') wnCaught++;
  else fail.push(`§81 missed [${lang}]: "${msg}" → ${d ? d.category : 'null'}`);
}
pass += wnCaught;
check(`§81 corpus size ≥ 100 (got ${wrongNumber.length})`, wrongNumber.length >= 100);

// ── §82 VENDOR CORPUS (generated, 50+) ──────────────────────────────────────
const vendors = [];
for (const seller of ['We offer', 'We provide', 'We sell', 'Our company specializes in', 'Our agency provides']) {
  for (const svc of ['SEO', 'lead generation', 'web design', 'digital marketing', 'merchant services', 'payment processing', 'AI automation', 'google ranking', 'social media marketing']) {
    vendors.push(['en', `${seller} ${svc} for your business, interested?`]);
  }
}
for (const seller of ['Ofrecemos', 'Nuestra empresa ofrece', 'Somos una agencia de']) {
  for (const svc of ['diseno web', 'generacion de leads', 'marketing digital']) {
    vendors.push(['es', `${seller} ${svc} para su negocio`]);
  }
}
vendors.push(['en', 'Can I speak with the owner? We do google ranking for agencies']);
vendors.push(['es', 'Quiero hablar con el dueno, ofrecemos generacion de leads']);
let vCaught = 0;
for (const [lang, msg] of vendors) {
  const d = routeScope(msg, [], lang);
  if (d && d.category === 'vendor') vCaught++;
  else fail.push(`§82 missed [${lang}]: "${msg}" → ${d ? d.category : 'null'}`);
}
pass += vCaught;
check(`§82 corpus size ≥ 50 (got ${vendors.length})`, vendors.length >= 50);

// ── §89 PROTECTED SET (expanded) — every one MUST pass through (null) ───────
const protectedSet = [
  ['en', 'my card stopped working at the pharmacy'],
  ['en', 'help me pay my bills, I heard there are programs for seniors'],
  ['en', "I can't afford my medications and my electric bill together"],
  ['en', "the pharmacy says my card was rejected, what do I do"],
  ['en', "my doctor's office phone is broken, how do I reach my plan"],
  ['en', 'I need help with my phone'],
  ['en', 'someone called me about my Medicare, was that you?'],
  ['en', 'I got a call from a company selling Medicare leads, is that a scam?'],
  ['es', 'quiero cancelar mi plan'],
  ['es', 'se me perdio la tarjeta y no puedo comprar mis medicinas'],
  ['es', 'necesito que me arreglen lo de mi plan'],
  ['es', 'me llamaron ofreciendo cambiarme el plan, es una estafa?'],
  ['es', 'no me alcanza para la luz y las medicinas, hay ayuda?'],
  ['es', 'mi hija me dijo que ustedes ayudan con el seguro'],
  ['es', 'hola necesito informacion'],
  ['en', 'I am so confused about all of this'],
];
for (const [lang, msg] of protectedSet) {
  const d = routeScope(msg, [], lang);
  check(`§89 protected [${lang}]: "${msg.slice(0, 42)}"`, d === null, d ? `WRONGLY ${d.category}/L${d.level}` : '');
}

// ── §63 URL GUARD (unit) ────────────────────────────────────────────────────
{
  const keep = guardUrls('Compare plans at https://www.medicare.gov/plan-compare or call 1-800-MEDICARE.', 'en');
  check('§63 allowlisted URL survives', keep.strippedCount === 0 && keep.text.includes('medicare.gov/plan-compare'));
  const keep2 = guardUrls('Su SHIP estatal: shiptacenter.org y tambien health.ny.gov para NY.', 'es');
  check('§63 bare allowlisted domains survive', keep2.strippedCount === 0);
  const strip = guardUrls('You can compare at https://best-medicare-deals.com/offers today.', 'en');
  check('§63 foreign URL stripped', strip.strippedCount === 1 && !strip.text.includes('best-medicare-deals') && strip.text.includes('[link removed for your safety]'));
  const strip2 = guardUrls('Visite www.planesbaratos.net o medicare.gov para mas.', 'es');
  check('§63 mixed keeps good, strips bad', strip2.strippedCount === 1 && strip2.text.includes('medicare.gov') && strip2.text.includes('[enlace removido'));
  const spoof = guardUrls('Go to fakemedicare.gov now', 'en');
  check('§63 lookalike .gov not fooled', spoof.strippedCount === 1);
  const never = guardUrls('https://bad.com', 'en');
  check('§63 never empties', never.text.trim().length > 0);
}

// ── §4/§5 INTENT CLASSIFIER (shadow) sanity ─────────────────────────────────
{
  const cases = [
    ['I want to schedule a call with an advisor', 'APPOINTMENT_REQUEST', 'high'],
    ['necesito cambiar mi cita', 'APPOINTMENT_CHANGE', 'high'],
    ['I got a bill I do not understand', 'CLAIMS_OR_BILLING', 'medium'],
    ['do I qualify for extra help', 'EXTRA_HELP_LIS', 'high'],
    ['I am turning 65 in March', 'NEW_LEAD', 'medium'],
    ['que es el deducible de la parte b', 'MEDICARE_GENERAL', 'medium'],
    ['me dijeron que llamara por lo mio', 'CONFUSED_USER', 'low'],
    ['asdf', 'UNCLEAR_INTENT', 'low'],
    ['is my doctor in network for this plan', 'PROVIDER_DIRECTORY_REQUEST', 'medium'],
    ['mi esposo necesita ayuda con su plan', 'THIRD_PARTY_REQUEST', 'medium'],
  ];
  for (const [msg, intent, band] of cases) {
    const r = classifyIntent(msg, 'en');
    check(`§4 intent "${msg.slice(0, 30)}" → ${intent}`, r.intent === intent && r.band === band, `got ${r.intent}/${r.band}`);
  }
}

// ── WIRING: real handler + mock model (§85, §63, §126, audit fields) ────────
let _ip = 0;
const makeReq = (body) => ({
  method: 'POST',
  headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': `10.88.${Math.floor(++_ip / 250)}.${_ip % 250}` },
  body, on() {},
});
const makeRes = () => ({
  statusCode: null, jsonBody: null,
  setHeader() { return this; }, status(c) { this.statusCode = c; return this; },
  json(o) { this.jsonBody = o; return this; }, end() { return this; },
});
const okResponse = (text) => new Response(JSON.stringify({
  id: 'resp_corpus', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

const saved = {};
for (const [k, v] of Object.entries({ OPENAI_API_KEY: 'sk-test-dummy-corpus-key-000', ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined, VERCEL_ENV: undefined })) {
  saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v;
}
const logs = [];
const ow = console.warn, ol = console.log, oe = console.error;
console.warn = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' '));

const benignHistory = (n) => Array.from({ length: n }, (_, i) => (
  i % 2 === 0 ? { role: 'user', content: `question number ${i} about my coverage` }
              : { role: 'assistant', content: `Answer number ${i} about the plan.` }
));

try {
  let outbound = null;
  __setLLMTestFetch(async (url, init) => { outbound = JSON.parse(init.body); return okResponse('Medicare Part B covers doctor visits.'); });

  // §85 — 30 / 50 / 100 turns: 200, capped context, cost signals logged.
  for (const n of [30, 50, 100]) {
    outbound = null; logs.length = 0;
    const res = makeRes();
    await handler(makeReq({ userMessage: 'Does Part B cover doctor visits?', context: { language: 'en' }, history: benignHistory(n) }), res);
    check(`§85 ${n}-turn conversation answers`, res.statusCode === 200 && !!res.jsonBody.response, `status=${res.statusCode}`);
    check(`§85 ${n}-turn model context capped ≤13`, outbound && outbound.input.length <= 13, `sent ${outbound && outbound.input.length}`);
    check(`§85 ${n}-turn audit has raw turn count`, logs.some((l) => l.includes(`"turn_count_raw":${n}`)));
    check(`§85 ${n}-turn cost alert fired`, logs.some((l) => l.includes('[COST-ALERT]')));
  }
  { // 101 turns → rejected outright (token-cost DoS guard).
    const res = makeRes();
    await handler(makeReq({ userMessage: 'hi there, question about my plan', context: { language: 'en' }, history: benignHistory(101) }), res);
    check('§85 101-turn history rejected 400', res.statusCode === 400);
  }

  // §63 wiring — invented URL in model output is stripped end-to-end.
  {
    __setLLMTestFetch(async () => okResponse('You can compare plans at https://cheap-medicare-hub.com/best or at medicare.gov.'));
    logs.length = 0;
    const res = makeRes();
    await handler(makeReq({ userMessage: 'where can I compare plans online?', context: { language: 'en' }, history: [] }), res);
    check('§63 wiring strips invented URL', res.jsonBody && !res.jsonBody.response.includes('cheap-medicare-hub') && res.jsonBody.response.includes('medicare.gov'),
      res.jsonBody && res.jsonBody.response.slice(0, 120));
    check('§63 wiring logs URL_STRIPPED', logs.some((l) => l.includes('URL_STRIPPED') && l.includes('cheap-medicare-hub.com')));
    check('§63 audit url_stripped=1', logs.some((l) => l.includes('"url_stripped":1')));
  }

  // §126 wiring — SSN in the message: redacted upstream AND caller warned.
  {
    __setLLMTestFetch(async (url, init) => { outbound = JSON.parse(init.body); return okResponse('I can explain general eligibility.'); });
    logs.length = 0;
    const res = makeRes();
    await handler(makeReq({ userMessage: 'My social is 123-45-6789, am I eligible for savings programs?', context: { language: 'en' }, history: [] }), res);
    const sentToModel = outbound ? JSON.stringify(outbound) : '';
    check('§126 SSN never reaches the model', !sentToModel.includes('123-45-6789'));
    check('§126 caller actively warned', res.jsonBody && /For your security/.test(res.jsonBody.response), res.jsonBody && res.jsonBody.response.slice(-140));
    check('§126 audit phi_warned', logs.some((l) => l.includes('"phi_warned":true')));
  }
  { // clean message → no warning appended.
    logs.length = 0;
    const res = makeRes();
    await handler(makeReq({ userMessage: 'does part b cover shots?', context: { language: 'en' }, history: [] }), res);
    check('§126 no warning on clean turns', res.jsonBody && !/For your security/.test(res.jsonBody.response));
  }

  // §4 shadow — intent rides in the audit record, changes nothing.
  {
    logs.length = 0;
    const res = makeRes();
    await handler(makeReq({ userMessage: 'I want to schedule a call with an advisor about part b', context: { language: 'en' }, history: [] }), res);
    check('§4 audit carries intent field', logs.some((l) => l.includes('"intent":"APPOINTMENT_REQUEST"')));
    check('§4 shadow: reply still flows normally', res.statusCode === 200 && !!res.jsonBody.response);
  }
} finally {
  __setLLMTestFetch(null);
  console.warn = ow; console.log = ol; console.error = oe;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

console.log('\n═══════════════════════════════════════');
console.log(`corpus: ${wrongNumber.length} wrong-number + ${vendors.length} vendor variations`);
if (fail.length === 0) {
  console.log(GRN(`MASTER-SPEC CORPUS: ${pass} passed, 0 failed`));
} else {
  console.log(RED(`MASTER-SPEC CORPUS: ${pass} passed, ${fail.length} FAILED`));
  for (const f of fail.slice(0, 25)) console.log(RED('  ✗ ' + f));
  if (fail.length > 25) console.log(RED(`  … and ${fail.length - 25} more`));
  process.exit(1);
}

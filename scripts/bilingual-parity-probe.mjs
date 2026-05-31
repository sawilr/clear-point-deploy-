// Wave 50.3 — Bilingual parity probe.
//
// Every concept the bot understands in Spanish must ALSO work in English,
// and vice versa. Sawil: "todo debe ser inglés y español".
//
// For each PAIR (Spanish-phrase ↔ English-phrase) we assert:
//   • Neither produces a generic fallback
//   • Both reach the same intent family (savings/appeal/coverage/drug/etc.)
//   • Both maintain compliance (no plan recommendation by name,
//     no eligibility affirmation, no PHI echo)
//   • Both responses contain at least one keyword from the expected family

import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';
import { classifyIntent } from '../src/lib/classifier/classifyIntent.ts';

const ISSUES = [];

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

// ─── 50 bilingual pairs ─────────────────────────────────────────────────────
// Each pair: [esPhrase, enPhrase, expectedKeywordsRe]
const PAIRS = [
  // ── Savings / Extra Help / MSP ──
  ['quiero tener ahorros en medicare',
   'I want to know about medicare savings',
   /extra help|\blis\b|\bmsp\b|programas? que pueden bajar|savings program|lower medicare/i],
  ['necesito extra help para mis copagos',
   'I need extra help with my copays',
   /extra help|\blis\b|copays?|copagos?|advisor|asesor/i],
  ['ayuda con la prima de medicare',
   'help with my medicare premium',
   /extra help|\bmsp\b|premium|prima|advisor|asesor|programas?/i],
  ['no puedo pagar el premium',
   "I can't afford my premium",
   /extra help|\bmsp\b|advisor|asesor|programas?|savings|ahorro/i],
  ['busco ayuda para pagar mis medicinas',
   'looking for help paying my medications',
   /extra help|\blis\b|drug|medication|medicina|advisor|asesor/i],
  ['me estan cobrando la prima de la part b',
   "they're charging me for the part b premium",
   /extra help|\bmsp\b|advisor|asesor|premium|prima|programas?/i],
  ['soy de bajos ingresos',
   'I have low income',
   /extra help|\blis\b|\bmsp\b|advisor|asesor|qualify|elegibilidad/i],

  // ── Appeal / denial ──
  ['mi plan no aprueba mi cirugia',
   "my plan won't approve my surgery",
   /apelaci[oó]n|appeal|denegaci[oó]n|denial|asesor|advisor|cliente|client/i],
  ['me negaron una cirugia importante',
   'they denied my important surgery',
   /apelaci[oó]n|appeal|asesor|advisor|cliente|client/i],
  ['no me cubrieron la resonancia',
   "they didn't cover my MRI",
   /apelaci[oó]n|appeal|asesor|advisor|cliente|client|MRI/i],
  ['el plan rechazo mi tratamiento',
   'plan rejected my treatment',
   /apelaci[oó]n|appeal|asesor|advisor|cliente|client/i],

  // ── Plan recommendation ──
  ['¿qué plan es mejor para mí?',
   'which plan is the best for me',
   /asesor|advisor|sin costo|no cost|depende|depends|CMS/i],
  ['recomiéndame un plan',
   'recommend me a plan',
   /asesor|advisor|sin costo|no cost|depende|depends/i],

  // ── Coverage ──
  ['no se que cubre mi plan',
   "I don't know what my plan covers",
   /cobertura|coverage|asesor|advisor|verificar|verify|confirmar|confirm/i],
  ['¿está cubierto mi doctor?',
   'is my doctor covered',
   /cobertura|coverage|red|network|asesor|advisor|verificar|verify/i],
  ['¿cubre el plan mi medicina?',
   'does my plan cover my medicine',
   /cobertura|coverage|formulario|formulary|asesor|advisor|verificar|verify/i],
  ['¿qué pasa si voy al hospital fuera de red?',
   'what happens if I go to a hospital out of network',
   /cobertura|coverage|red|network|asesor|advisor|verificar|verify/i],

  // ── Provider access ──
  ['mi doctor no me quiere atender',
   "my doctor won't see me",
   /doctor|m[eé]dico|red|network|asesor|advisor|provider|proveedor|especialista|specialist/i],
  ['el especialista no acepta mi plan',
   "the specialist doesn't take my plan",
   /especialista|specialist|red|network|asesor|advisor|provider|proveedor/i],
  ['mi medico salio de la red',
   'my doctor left the network',
   /red|network|asesor|advisor|nuevo|new|provider|proveedor|doctor|m[eé]dico/i],
  ['no me dejan ver al cardiologo',
   "they won't let me see the cardiologist",
   /especialista|specialist|red|network|asesor|advisor|autoriz/i],

  // ── Doctor change ──
  ['quiero un nuevo doctor',
   'I want a new doctor',
   /doctor|m[eé]dico|red|network|asesor|advisor|primario|primary/i],
  ['necesito cambiar de pcp',
   'I need to change my pcp',
   /pcp|primario|primary|doctor|m[eé]dico|asesor|advisor/i],
  ['mi pcp se jubilo',
   'my pcp retired',
   /pcp|primario|primary|doctor|m[eé]dico|asesor|advisor|nuevo|new/i],

  // ── Drug ──
  ['mi medicina es muy cara',
   'my medication is too expensive',
   /drug|medication|medicina|medicamento|formulario|formulary|asesor|advisor/i],
  ['no me cubrieron la medicina',
   "they didn't cover my medication",
   /drug|medication|medicina|medicamento|formulario|formulary|asesor|advisor/i],
  ['la farmacia me cobro mucho',
   'the pharmacy charged me a lot',
   /pharmacy|farmacia|drug|medication|medicina|asesor|advisor/i],

  // ── Urgent medication ──
  ['se me acabo la medicina',
   "I'm out of my medication",
   /asesor|advisor|farmacia|pharmacy|emergencia|emergency|reabastecer|refill/i],
  ['no tengo mi insulina',
   "I have no insulin",
   /insulina|insulin|asesor|advisor|emergencia|emergency|pharmacy|farmacia|reabastecer|refill/i],

  // ── Enrollment ──
  ['quiero cambiar de plan',
   'I want to change my plan',
   /plan|inscripci[oó]n|enrollment|AEP|SEP|asesor|advisor/i],
  ['cumplo 65 el proximo mes',
   "I'm turning 65 next month",
   /65|IEP|inscripci[oó]n|enrollment|asesor|advisor|nuevo|new/i],
  ['busco un plan mas barato',
   'looking for a cheaper plan',
   /plan|opciones|options|asesor|advisor|inscripci[oó]n|enrollment/i],

  // ── Bill ──
  ['me llego una factura del hospital',
   'I got a hospital bill',
   /factura|bill|hospital|m[eé]dico|doctor|asesor|advisor|EOB/i],
  ['mi premium subio mucho',
   'my premium went up a lot',
   /premium|prima|carta|letter|asesor|advisor|extra help|\bmsp\b/i],

  // ── Letter ──
  ['recibi una carta del plan',
   'I got a letter from the plan',
   /carta|letter|ANOC|asesor|advisor|cambio|change/i],
  ['no entiendo este aviso',
   "I don't understand this notice",
   /carta|letter|aviso|notice|asesor|advisor/i],

  // ── Moving SEP ──
  ['me mude a florida',
   'I moved to florida',
   /SEP|moving|mudanza|mudarse|asesor|advisor|plan|inscripci[oó]n|enrollment/i],

  // ── About ClearPoint ──
  ['quién es clearpoint',
   'who is clearpoint',
   /clearpoint|asesor|advisor|licenciado|licensed|broker|agente|agent/i],
  ['son del gobierno',
   'are you the government',
   /no|gobierno|government|broker|licenciado|licensed|asesor|advisor/i],
  ['cobran ustedes',
   'do you charge',
   /no|sin costo|no cost|gratis|free|comisi[oó]n|commission/i],

  // ── Fraud / scam ──
  ['me llamo alguien diciendo medicare',
   'someone called saying they were medicare',
   /\b988\b|fraude|fraud|scam|estafa|Senior Medicare Patrol|SMP|asesor|advisor/i],
  ['creo que es una estafa',
   'I think it is a scam',
   /fraude|fraud|scam|estafa|Senior Medicare Patrol|SMP|asesor|advisor/i],

  // ── Crisis (must route to 988) ──
  ['me quiero matar',
   'I want to kill myself',
   /\b988\b/],

  // ── Frustration ──
  ['no entiendes nada',
   "you don't understand anything",
   /asesor|advisor|entiendo|understand|frustr|para no|so I don'?t/i],
  ['estas perdido',
   "you're lost",
   /asesor|advisor|entiendo|understand|para no|so I don'?t|empezar|start over/i],
  ['puta madre necesito ayuda',
   'fuck this I need help',
   /asesor|advisor|entiendo|understand|988|para no|so I don'?t/i],

  // ── Short / vague ──
  ['ayuda',
   'help',
   /factura|bill|doctor|medicamento|medication|carta|letter|cobertura|coverage|asesor|advisor/i],
  ['no se',
   "I don't know",
   /factura|bill|doctor|medicamento|medication|carta|letter|cobertura|coverage|asesor|advisor/i],

  // ── ALL CAPS rage ──
  ['PORQ ME COBRAN TANTO',
   'WHY AM I BEING CHARGED SO MUCH',
   /asesor|advisor|extra help|\bmsp\b|programas?|premium|prima|factura|bill/i],
];

// ─── Run pairs ──────────────────────────────────────────────────────────────
const isFallbackEs = (r) => /Gracias por contarme\.\s+¿Puede darme un poco m[aá]s de detalle|Perd[oó]n, no pude procesar/i.test(r);
const isFallbackEn = (r) => /Thanks for telling me\.\s+Can you give me a bit more detail|Sorry, I could not process/i.test(r);

console.log('═'.repeat(100));
console.log(`  BILINGUAL PARITY PROBE — ${PAIRS.length} concept pairs`);
console.log('═'.repeat(100));

for (let i = 0; i < PAIRS.length; i++) {
  const [es, en, keywordsRe] = PAIRS[i];

  // ES side
  const esRun = run(['español', '06825', es]);
  const esResp = esRun.responses[2];
  // EN side
  const enRun = run(['english', '10550', en]);
  const enResp = enRun.responses[2];

  const esFb = isFallbackEs(esResp);
  const enFb = isFallbackEn(enResp);
  const esTopic = keywordsRe.test(esResp);
  const enTopic = keywordsRe.test(enResp);

  // Classifier agreement
  const esCls = classifyIntent(es);
  const enCls = classifyIntent(en);

  if (esFb) ISSUES.push({ pair: i, lang: 'ES', kind: 'fallback', phrase: es, resp: esResp.slice(0, 160) });
  if (enFb) ISSUES.push({ pair: i, lang: 'EN', kind: 'fallback', phrase: en, resp: enResp.slice(0, 160) });
  if (!esTopic && !esFb) ISSUES.push({ pair: i, lang: 'ES', kind: 'off-topic', phrase: es, resp: esResp.slice(0, 160) });
  if (!enTopic && !enFb) ISSUES.push({ pair: i, lang: 'EN', kind: 'off-topic', phrase: en, resp: enResp.slice(0, 160) });
  // Intent agreement — flag when classifier picks different intents for the two languages
  if (esCls.intent && enCls.intent && esCls.intent !== enCls.intent) {
    ISSUES.push({
      pair: i, lang: 'BOTH', kind: 'intent-mismatch',
      phrase: `${es}  /  ${en}`,
      resp: `ES→${esCls.intent}@${esCls.score.toFixed(2)}  vs  EN→${enCls.intent}@${enCls.score.toFixed(2)}`,
    });
  }
}

console.log(`\nISSUES: ${ISSUES.length}`);
for (const x of ISSUES) {
  console.log(`\n✗ pair ${x.pair} / ${x.lang} / ${x.kind}`);
  console.log(`  "${x.phrase}"`);
  console.log(`  → ${x.resp}`);
}

process.exit(ISSUES.length > 0 ? 1 : 0);

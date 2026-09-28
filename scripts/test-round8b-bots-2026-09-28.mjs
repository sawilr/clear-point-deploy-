// scripts/test-round8b-bots-2026-09-28.mjs
//
// AUDITORÍA INDEPENDIENTE 2026-09-28 (ronda 8 / 8b) — cierre de los hallazgos de
// los DOS asistentes. Cada bloque fija la corrección en AMBAS direcciones: que
// el defecto medido ya no ocurre, y que lo que funcionaba sigue funcionando. Un
// arreglo probado en una sola dirección es como se produjeron las regresiones de
// las rondas 4, 5 y 6.
//
// Cubre:
//   R8-AI-03  el lead con nombre+teléfono no se pierde al despedirse
//   BOT-09    "ok/claro/de acuerdo" tras la pregunta TCPA del MODELO no consiente
//   R8-AI-06  "are you a real person?" → divulgación, no intake (Clara y Zara)
//   BOT-07    "sí" no se guarda como nombre (Zara)
//   BOT-06    429/500/red de /api/chat: aviso honesto, nunca el glosario
//   R8-LEAD-01 Zara no registra consentimiento TCPA con un acuse de recibo
//   A11Y-03   Escape / X ocultan el panel; no borran la conversación
//   perf F1   los tres avatares de Zara no se precargan en el shell SSR
//
// Clara/motor: se ejecuta el TS real. Zara vive dentro de un componente React,
// así que sus reglas se verifican leyendo el código fuente y evaluando las
// expresiones REALES extraídas del archivo (misma técnica que
// scripts/test-p1-batch3-2026-08-13.mjs), no una copia que pueda desincronizarse.

import { readFileSync } from 'node:fs';
import {
  createInitialState,
  processMessage,
  processMessageAsync,
  _runStructuralFirst,
  detectAssistantIdentityQuestion,
  detectHumanEscalation,
  detectIdentityQuestion,
  __resetLlmCooldownForTests,
} from '../src/lib/customerServiceEngine.ts';

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail ? '\n        ' + detail : ''));
}

// Se normalizan los fines de línea para que los patrones multilínea de abajo no
// dependan de CRLF/LF.
const ZARA_SRC = readFileSync(new URL('../src/components/ChatBot.tsx', import.meta.url), 'utf8')
  .split('\r\n').join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// R8-AI-03 — una despedida cortés en un paso OPCIONAL no puede botar el lead
// ─────────────────────────────────────────────────────────────────────────────
// Medido: estado con "Mary Lopez" + teléfono y lastBotIntent
// 'handoff_asking_email'; "all good" → "Thank you! It was a pleasure helping…"
// [intent=warm_closing closed=true] y contactConfirmed nunca se fijaba, así que
// CustomerServiceBot.tsx:443 (`if (!contactConfirmed) return;`) no enviaba nada.
function leadState(lang, lastBotIntent, extra = {}) {
  return {
    ...createInitialState(),
    language: lang,
    step: 'conversation',
    advisorHandoffStarted: true,
    name: lang === 'es' ? 'María López' : 'Mary Lopez',
    nameIsValid: true,
    phoneNumber: '3475551234',
    bestTimeAsked: true,
    topicAsked: true,
    emailAsked: lastBotIntent.startsWith('handoff_asking_email'),
    lastBotIntent,
    messages: [{ role: 'bot', content: 'What is the best time for the advisor to call you?', timestamp: Date.now() }],
    ...extra,
  };
}

{
  const CASES = [
    ['en', 'handoff_asking_email', 'all good'],
    ['en', 'handoff_asking_email', "i'm good"],
    ['en', 'handoff_asking_email', "that's all"],
    ['en', 'handoff_asking_email', 'im all set'],
    ['es', 'handoff_asking_email', 'ya está'],
    ['es', 'handoff_asking_besttime', 'gracias'],
    ['es', 'handoff_asking_topic', 'eso es todo'],
    ['en', 'handoff_asking_besttime_retry', 'thanks'],
    ['en', 'handoff_asking_email_retry', 'nothing else'],
  ];
  for (const [lang, intent, msg] of CASES) {
    const r = processMessage(msg, leadState(lang, intent));
    const tag = `R8-AI-03 [${lang} ${intent}] ${JSON.stringify(msg)}`;
    ok(`${tag} llega al paso de confirmación`,
      r.newState.lastBotIntent === 'handoff_asking_confirm',
      `lastBotIntent=${r.newState.lastBotIntent} resp=${JSON.stringify(r.response.slice(0, 90))}`);
    ok(`${tag} NO cierra la conversación`, r.newState.conversationClosed !== true,
      `conversationClosed=${r.newState.conversationClosed}`);
    ok(`${tag} muestra el resumen con el texto TCPA`,
      /autoriza a ClearPoint Senior Advisors|authorize ClearPoint Senior Advisors/i.test(r.response)
      && /¿Está todo correcto\?|Is everything correct\?/.test(r.response),
      JSON.stringify(r.response.slice(0, 160)));
    ok(`${tag} no guarda la despedida como horario ni como tema`,
      (r.newState.bestTimeToCall || '') !== msg && (r.newState.advisorTopic || '') !== msg,
      `bestTime=${JSON.stringify(r.newState.bestTimeToCall)} topic=${JSON.stringify(r.newState.advisorTopic)}`);
    ok(`${tag} conserva nombre y teléfono`,
      !!r.newState.name && r.newState.phoneNumber === '3475551234',
      `name=${JSON.stringify(r.newState.name)} phone=${JSON.stringify(r.newState.phoneNumber)}`);
  }

  // Desde el resumen, un "sí/yes" explícito SÍ confirma y el lead se envía.
  for (const [lang, yes] of [['en', 'yes'], ['es', 'sí']]) {
    const s = leadState(lang, 'handoff_asking_email');
    const r1 = processMessage(lang === 'es' ? 'gracias' : 'all good', s);
    const r2 = processMessage(yes, r1.newState);
    ok(`R8-AI-03 [${lang}] el "${yes}" del resumen confirma el contacto`,
      r2.newState.contactConfirmed === true,
      `contactConfirmed=${r2.newState.contactConfirmed} resp=${JSON.stringify(r2.response.slice(0, 90))}`);
  }

  // El resumen no puede volverse un bucle: "gracias" en la confirmación re-pregunta
  // UNA vez y, si la persona se despide otra vez, se cierra sin enviar nada.
  {
    const s1 = processMessage('all good', leadState('en', 'handoff_asking_email'));
    ok('R8-AI-03 primer "gracias" en el paso opcional → resumen',
      /Is everything correct\?/.test(s1.response) && /authorize ClearPoint/i.test(s1.response));
    const s2 = processMessage('thanks', s1.newState);
    ok('R8-AI-03 despedida en la confirmación → re-pregunta corta, no el resumen otra vez',
      /Sorry — is everything correct\?/.test(s2.response) && !/authorize ClearPoint/i.test(s2.response)
      && s2.newState.conversationClosed !== true,
      JSON.stringify(s2.response.slice(0, 120)));
    const s3 = processMessage('thanks', s2.newState);
    ok('R8-AI-03 segunda despedida en la confirmación → cierre cálido, sin bucle y sin envío',
      s3.newState.conversationClosed === true && s3.newState.contactConfirmed !== true
      && /1-855-720-8555/.test(s3.response),
      `closed=${s3.newState.conversationClosed} confirmed=${s3.newState.contactConfirmed} resp=${JSON.stringify(s3.response.slice(0, 120))}`);
    // …y un "yes" tras la re-pregunta sigue confirmando.
    const s2b = processMessage('yes', s2.newState);
    ok('R8-AI-03 "yes" tras la re-pregunta corta confirma el contacto',
      s2b.newState.contactConfirmed === true, `confirmed=${s2b.newState.contactConfirmed}`);
  }

  // ── La otra dirección: una despedida REAL sigue cerrando ──────────────────
  const NEG = [
    ['sin lead', { ...createInitialState(), language: 'en', step: 'conversation' }, 'thanks for the info'],
    ['sin lead ES', { ...createInitialState(), language: 'es', step: 'conversation' }, 'gracias por la ayuda'],
    ['con nombre pero SIN teléfono', leadState('en', 'handoff_asking_phone', { phoneNumber: '' }), 'that is all'],
    ['lead ya confirmado', leadState('en', 'handoff_anything_else', { contactConfirmed: true, emailAsked: true, anythingElseAsked: true }), 'that is all'],
  ];
  for (const [label, st, msg] of NEG) {
    const r = processMessage(msg, st);
    ok(`R8-AI-03 despedida real sigue cerrando (${label})`,
      r.newState.conversationClosed === true && r.newState.lastBotIntent === 'warm_closing',
      `closed=${r.newState.conversationClosed} intent=${r.newState.lastBotIntent} resp=${JSON.stringify(r.response.slice(0, 90))}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R8-AI-03 en la VÍA DE PRODUCCIÓN (processMessageAsync con /api/chat ARRIBA)
// ─────────────────────────────────────────────────────────────────────────────
// El hallazgo se midió así: con el modelo respondiendo, "all good" en el paso del
// correo salía como despedida y el lead no llegaba nunca al envío.
{
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  globalThis.window = globalThis.window || {};
  globalThis.fetch = async () => new Response(JSON.stringify({ response: 'Sure, tell me more.', meta: {} }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  try {
    for (const [lang, intent, msg] of [['en', 'handoff_asking_email', 'all good'], ['es', 'handoff_asking_besttime', 'gracias']]) {
      const r = await processMessageAsync(msg, leadState(lang, intent));
      ok(`R8-AI-03 vía de producción [${lang}] ${JSON.stringify(msg)} llega al resumen`,
        r.newState.lastBotIntent === 'handoff_asking_confirm' && r.newState.conversationClosed !== true,
        `intent=${r.newState.lastBotIntent} closed=${r.newState.conversationClosed} resp=${JSON.stringify(r.response.slice(0, 100))}`);
    }
    // La otra dirección, también en producción: sin lead pendiente, cierra.
    const rClose = await processMessageAsync('thanks for the info', { ...createInitialState(), language: 'en', step: 'conversation' });
    ok('R8-AI-03 vía de producción sin lead pendiente sigue cerrando',
      rClose.newState.conversationClosed === true,
      `closed=${rClose.newState.conversationClosed} resp=${JSON.stringify(rClose.response.slice(0, 100))}`);
  } finally {
    if (prevFetch === undefined) delete globalThis.fetch; else globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT-09 — la vía del MODELO: un acuse de recibo no es consentimiento TCPA
// ─────────────────────────────────────────────────────────────────────────────
// La pregunta TCPA la hace el modelo; el motor leía la última frase del bot y
// aceptaba "ok/claro/de acuerdo/seguro/correcto" como autorización, fijando
// consent_to_contact=true. Es la misma regla del 26-sep (TCPA-03) que ya rige en
// el paso de confirmación: solo una afirmativa explícita.
{
  const consentAsk = (lang) => ({
    ...createInitialState(),
    language: lang,
    step: 'conversation',
    messages: [{
      role: 'bot',
      timestamp: Date.now(),
      content: lang === 'es'
        ? '¿Autoriza que un asesor licenciado de ClearPoint le contacte por teléfono o mensaje?'
        : 'Do you authorize a licensed ClearPoint advisor to contact you by phone or text?',
    }],
  });
  const ACKS = ['ok', 'okay', 'claro', 'de acuerdo', 'seguro', 'correcto', 'dale', 'por favor', 'please', 'esta bien', 'está bien', 'adelante', 'perfecto'];
  for (const a of ACKS) {
    for (const lang of ['es', 'en']) {
      const r = _runStructuralFirst(a, consentAsk(lang));
      const st = r ? r.newState : consentAsk(lang);
      ok(`BOT-09 [${lang}] acuse ${JSON.stringify(a)} NO fija consent_to_contact`,
        st.consent_to_contact !== true,
        `consent_to_contact=${st.consent_to_contact} resp=${JSON.stringify((r?.response || '').slice(0, 90))}`);
      ok(`BOT-09 [${lang}] acuse ${JSON.stringify(a)} no arranca la captura consentida`,
        st.lastBotIntent !== 'handoff_asking_name',
        `lastBotIntent=${st.lastBotIntent}`);
    }
  }
  // La otra dirección: una afirmativa EXPLÍCITA sí consiente y pide el nombre.
  const YES = ['sí', 'si', 'yes', 'yeah', 'yep', 'acepto', 'autorizo', 'sí, acepto', 'yes I agree', 'yes please', 'sí por favor'];
  for (const y of YES) {
    const r = _runStructuralFirst(y, consentAsk('es'));
    ok(`BOT-09 afirmativa explícita ${JSON.stringify(y)} consiente y pide el nombre`,
      !!r && r.newState.consent_to_contact === true && r.newState.lastBotIntent === 'handoff_asking_name',
      r ? `consent=${r.newState.consent_to_contact} intent=${r.newState.lastBotIntent}` : 'no hubo turno estructural');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R8-AI-06 — "¿es usted una persona real?" es identidad, no petición de asesor
// ─────────────────────────────────────────────────────────────────────────────
{
  const PREGUNTAS = [
    'are you a real person?',
    'am I talking to a robot?',
    'Are you a real person or a computer?',
    '¿eres un robot?',
    '¿hablo con una persona?',
    '¿es usted una máquina?',
    'is this a bot?',
  ];
  for (const q of PREGUNTAS) {
    ok(`R8-AI-06 detector reconoce ${JSON.stringify(q)}`, detectAssistantIdentityQuestion(q) === true);
    const r = processMessage(q, { ...createInitialState(), language: /[¿áéíóúñ]/i.test(q) ? 'es' : 'en', step: 'conversation' });
    ok(`R8-AI-06 ${JSON.stringify(q)} se divulga como asistente automatizada`,
      /automated|automatizada|no soy una persona|I'm not a person/i.test(r.response),
      JSON.stringify(r.response.slice(0, 140)));
    ok(`R8-AI-06 ${JSON.stringify(q)} NO empieza la captura de contacto`,
      !/what is your (first )?name|cuál es su (primer )?nombre|su nombre completo|your full name/i.test(r.response)
      && r.newState.advisorHandoffStarted !== true,
      `handoff=${r.newState.advisorHandoffStarted} resp=${JSON.stringify(r.response.slice(0, 140))}`);
    ok(`R8-AI-06 ${JSON.stringify(q)} ofrece un humano licenciado`,
      /1-855-720-8555/.test(r.response) && /licenciado|licensed/i.test(r.response),
      JSON.stringify(r.response.slice(0, 140)));
  }
  // Pro-drop ES de la identidad de la AGENCIA (antes no la reconocía nadie).
  for (const q of ['¿trabajan para Medicare?', 'trabajan con el gobierno?']) {
    ok(`R8-AI-06 identidad de agencia reconoce ${JSON.stringify(q)}`, detectIdentityQuestion(q) === true);
    const r = processMessage(q, { ...createInitialState(), language: 'es', step: 'conversation' });
    ok(`R8-AI-06 ${JSON.stringify(q)} responde que es independiente`,
      /no somos Medicare|agencia independiente/i.test(r.response), JSON.stringify(r.response.slice(0, 120)));
  }
  // La otra dirección: PEDIR una persona sigue siendo escalamiento.
  const PETICIONES = ['I need a real person', 'i want a real person now', 'quiero hablar con una persona real', 'give me a human'];
  for (const p of PETICIONES) {
    ok(`R8-AI-06 ${JSON.stringify(p)} NO es una pregunta de identidad`,
      detectAssistantIdentityQuestion(p) === false);
    ok(`R8-AI-06 ${JSON.stringify(p)} sigue siendo escalamiento a humano`,
      detectHumanEscalation(p) === true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT-06 — una pregunta de MONTO nunca se contesta con el glosario
// ─────────────────────────────────────────────────────────────────────────────
{
  const MONTOS = [
    ['en', 'How much is the Part B premium?', '$202.90'],
    ['es', '¿Cuánto es la prima de la Parte B?', '$202.90'],
    ['en', 'How much is the Part B deductible?', '$283'],
    ['es', '¿Cuánto es el deducible de la Parte A?', '$1,736'],
  ];
  for (const [lang, q, figure] of MONTOS) {
    const r = processMessage(q, { ...createInitialState(), language: lang, step: 'conversation' });
    ok(`BOT-06 ${JSON.stringify(q)} responde la cifra ${figure}`,
      r.response.includes(figure), JSON.stringify(r.response.slice(0, 160)));
    ok(`BOT-06 ${JSON.stringify(q)} no sale el glosario de copago/deducible`,
      !/MOOP|m[aá]ximo de bolsillo|Which term is causing|Cuál término le está causando/i.test(r.response),
      JSON.stringify(r.response.slice(0, 160)));
  }
  // La otra dirección: una pregunta DEFINICIONAL sigue recibiendo el glosario.
  for (const [lang, q] of [['en', 'What is a copay?'], ['es', '¿Qué es el coseguro?']]) {
    const r = processMessage(q, { ...createInitialState(), language: lang, step: 'conversation' });
    ok(`BOT-06 la pregunta definicional ${JSON.stringify(q)} sigue explicando el término`,
      /copay|copago|coinsurance|coseguro/i.test(r.response), JSON.stringify(r.response.slice(0, 120)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT-06 — 429 / 500 de /api/chat: el visitante se ENTERA de la degradación
// ─────────────────────────────────────────────────────────────────────────────
// El aviso solo tiene sentido con un visitante delante, así que el motor lo
// emite cuando existe `window` (el arnés offline y el SSR mantienen la vía
// determinística). Aquí se emula ese entorno con un fetch controlado.
{
  const prevWindow = globalThis.window;
  const prevFetch = globalThis.fetch;
  globalThis.window = globalThis.window || {};
  const midState = (lang) => ({ ...createInitialState(), language: lang, step: 'conversation' });
  const mockFetch = (status, body) => async () => new Response(JSON.stringify(body ?? { error: 'x' }), {
    status, headers: { 'content-type': 'application/json' },
  });
  try {
    // 429 → línea honesta, sin respuesta determinística de otro tema.
    for (const lang of ['en', 'es']) {
      __resetLlmCooldownForTests();
      globalThis.fetch = mockFetch(429, { error: 'Too many requests' });
      const q = lang === 'es' ? '¿Cuánto es la prima de la Parte B?' : 'How much is the Part B premium?';
      const r = await processMessageAsync(q, midState(lang));
      ok(`BOT-06 [${lang}] 429 avisa y da el teléfono`,
        /muchas preguntas|a lot of questions/i.test(r.response) && /1-855-720-8555/.test(r.response),
        JSON.stringify(r.response.slice(0, 160)));
      ok(`BOT-06 [${lang}] 429 no sirve el glosario`,
        !/MOOP|m[aá]ximo de bolsillo|Which term is causing/i.test(r.response),
        JSON.stringify(r.response.slice(0, 160)));
      // Enfriamiento: el turno siguiente no vuelve a pedir turno al API.
      let called = 0;
      globalThis.fetch = async () => { called++; return new Response('{}', { status: 200 }); };
      const r2 = await processMessageAsync('and what about Part D?', midState(lang));
      ok(`BOT-06 [${lang}] tras un 429 hay enfriamiento (no se vuelve a llamar al API)`,
        called === 0 && /muchas preguntas|a lot of questions/i.test(r2.response),
        `llamadas=${called} resp=${JSON.stringify(r2.response.slice(0, 120))}`);
    }
    // 500 → una línea de indisponibilidad; la respuesta determinística solo se
    // ofrece cuando el motor sí reconoció el tema.
    __resetLlmCooldownForTests();
    globalThis.fetch = mockFetch(500, { error: 'boom' });
    const r500 = await processMessageAsync('How much is the Part B premium?', midState('en'));
    ok('BOT-06 500 nombra la indisponibilidad',
      /temporarily unavailable/i.test(r500.response), JSON.stringify(r500.response.slice(0, 160)));
    ok('BOT-06 500 sí da la cifra correcta cuando el tema es claro',
      r500.response.includes('$202.90'), JSON.stringify(r500.response.slice(0, 200)));
    ok('BOT-06 500 no sirve el glosario de términos',
      !/Which term is causing/i.test(r500.response), JSON.stringify(r500.response.slice(0, 200)));
    // Fallo de red con un mensaje que el motor NO entiende → solo el aviso.
    __resetLlmCooldownForTests();
    globalThis.fetch = async () => { throw new TypeError('network down'); };
    const rNet = await processMessageAsync('ok', midState('en'));
    ok('BOT-06 red caída + mensaje vago → solo el aviso honesto',
      /temporarily unavailable/i.test(rNet.response) && !/Common topics|is this about a bill/i.test(rNet.response),
      JSON.stringify(rNet.response.slice(0, 200)));
    // La otra dirección: con el modelo ARRIBA la respuesta del modelo se usa.
    __resetLlmCooldownForTests();
    globalThis.fetch = async () => new Response(JSON.stringify({ response: 'The standard Part B premium in 2026 is $202.90 a month.', meta: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    const rUp = await processMessageAsync('How much is the Part B premium?', midState('en'));
    ok('BOT-06 con el modelo arriba no aparece ningún aviso de degradación',
      !/temporarily unavailable|a lot of questions/i.test(rUp.response) && rUp.response.includes('$202.90'),
      JSON.stringify(rUp.response.slice(0, 160)));
  } finally {
    __resetLlmCooldownForTests();
    if (prevFetch === undefined) delete globalThis.fetch; else globalThis.fetch = prevFetch;
    if (prevWindow === undefined) delete globalThis.window; else globalThis.window = prevWindow;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT-08 — el motor no puede inventar la situación de la persona
// ─────────────────────────────────────────────────────────────────────────────
// Medido: "What is a D-SNP?" → "Since you have both Medicare and Medicaid, you
// usually already have Extra Help automatically…". Era una pregunta educativa.
{
  for (const [lang, q] of [['en', 'What is a D-SNP?'], ['es', '¿Qué es un plan D-SNP?']]) {
    const r = processMessage(q, { ...createInitialState(), language: lang, step: 'conversation' });
    ok(`BOT-08 ${JSON.stringify(q)} no afirma que la persona tenga Medicaid`,
      !/(since|como) (you have|tiene) (both )?medicare (and|y) medicaid|ya tiene Ayuda Adicional autom/i.test(r.response),
      JSON.stringify(r.response.slice(0, 160)));
    ok(`BOT-08 ${JSON.stringify(q)} no marca dual_eligible en el estado`,
      r.newState.dualEligible !== true && r.newState.extraHelpInferred !== true,
      `dual=${r.newState.dualEligible} extraHelp=${r.newState.extraHelpInferred}`);
    ok(`BOT-08 ${JSON.stringify(q)} sí explica qué es un SNP`,
      /SNP/i.test(r.response), JSON.stringify(r.response.slice(0, 120)));
  }
  // La negación explícita ya no se contesta con "Correct. If you have both…".
  const rDeny = processMessage('I do not have Medicaid. What does Extra Help pay for?', {
    ...createInitialState(), language: 'en', step: 'conversation', dualEligible: true, hasMedicaid: true,
  });
  ok('BOT-08 una negación explícita no se refuerza como dual',
    !/If you have both Medicaid and Medicare/i.test(rDeny.response),
    JSON.stringify(rDeny.response.slice(0, 160)));
  // La otra dirección: una afirmación en primera persona SÍ infiere dual.
  for (const [lang, q] of [['es', 'tengo Medicare y Medicaid'], ['en', 'I have both Medicare and Medicaid']]) {
    const r = processMessage(q, { ...createInitialState(), language: lang, step: 'conversation' });
    ok(`BOT-08 ${JSON.stringify(q)} sigue infiriendo dual`, r.newState.dualEligible === true,
      `dual=${r.newState.dualEligible}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R8-LEAD-01 — Zara: un acuse de recibo no es consentimiento TCPA
// ─────────────────────────────────────────────────────────────────────────────
// Las tres expresiones del bloque lead_consent se EXTRAEN del archivo real, así
// que este bloque no puede quedar desincronizado con lo que se despliega.
{
  const consentBlock = ZARA_SRC.slice(ZARA_SRC.indexOf("if (currentStep === 'lead_consent')"));
  ok('R8-LEAD-01 se localiza el bloque lead_consent en ChatBot.tsx', consentBlock.length > 500);
  const yesAlt = /const yes = new RegExp\('(\^\(\?:[^']+)'/.exec(consentBlock);
  ok('R8-LEAD-01 se extrae la lista de afirmativas del fuente', !!yesAlt, 'no se pudo extraer `const yes = new RegExp(...)`');
  const yesStmt = consentBlock.slice(consentBlock.indexOf('const yes = new RegExp'), consentBlock.indexOf('const negNorm'));
  const extraYes = [...yesStmt.matchAll(/\|\| (\/\(\?:\^\|\\s\)[^\n]+?\/)\.test\(norm \+ ' '\)/g)].map((m) => m[1]);
  ok('R8-LEAD-01 se extraen las dos alternativas adicionales de afirmación', extraYes.length === 2, `extraYes=${extraYes.length}`);
  const negMatch = /const hasNegation = (\/[^\n]+?\/)\.test\(negNorm \+ ' '\)\s*\n\s*\|\| (\/[^\n]+?\/)\.test\(negNorm\)/.exec(consentBlock);
  ok('R8-LEAD-01 se extraen las expresiones de negación del fuente', !!negMatch);

  if (yesAlt && negMatch) {
    const TAIL = '(?:\\s|$|[.,;!?])';
    const yesRe = new RegExp(yesAlt[1] + TAIL);
    // eslint-disable-next-line no-new-func
    const extra = extraYes.map((src) => new Function('return ' + src)());
    // eslint-disable-next-line no-new-func
    const neg1 = new Function('return ' + negMatch[1])();
    // eslint-disable-next-line no-new-func
    const neg2 = new Function('return ' + negMatch[2])();
    const classify = (text) => {
      const norm = text.toLowerCase().trim().replace(/[.,!?;:]+$/, '');
      const yes = yesRe.test(norm + ' ') || extra.some((re) => re.test(norm + ' '));
      const negNorm = norm
        .replace(/\bno (?:problem|worries|biggie|big deal)\b/g, '')
        .replace(/\bno te preocupes?\b/g, '')
        .replace(/\bsin (?:problema|falta)\b/g, '');
      const hasNegation = neg1.test(negNorm + ' ') || neg2.test(negNorm);
      const endsQuestion = /\?\s*$/.test(text.trim());
      const hasQualifier = /\b(?:but|however|pero|sin embargo|aunque|whatever)\b/.test(norm);
      const ambiguous = endsQuestion || (yes && hasQualifier);
      if (hasNegation) return 'DECLINE';
      if (ambiguous || (!yes && norm.length > 0 && !/^(?:no|not now|ahora no)$/.test(norm))) return 'REPROMPT';
      if (yes) return 'CONSENT';
      return 'DECLINE';
    };
    const CASES = [
      // El defecto medido: seis acuses de recibo producían un recibo firmado.
      ['ok', 'REPROMPT'], ['okay', 'REPROMPT'], ['claro', 'REPROMPT'], ['sure', 'REPROMPT'],
      ['please', 'REPROMPT'], ['por favor', 'REPROMPT'], ['y', 'REPROMPT'], ['ok.', 'REPROMPT'],
      ['ok gracias', 'REPROMPT'],
      // Ya re-preguntaban y deben seguir igual.
      ['vale', 'REPROMPT'], ['está bien', 'REPROMPT'], ['de acuerdo', 'REPROMPT'],
      ['correcto', 'REPROMPT'], ['perfecto', 'REPROMPT'], ['ok?', 'REPROMPT'],
      // Rechazos.
      ['no', 'DECLINE'], ['claro que no', 'DECLINE'], ['no gracias', 'DECLINE'],
      ['ok, but do not call me', 'DECLINE'], ['stop', 'DECLINE'],
      // Afirmativas explícitas: siguen consintiendo.
      ['yes', 'CONSENT'], ['sí', 'CONSENT'], ['si', 'CONSENT'], ['acepto', 'CONSENT'],
      ['sí acepto', 'CONSENT'], ['i agree', 'CONSENT'], ['yes i agree', 'CONSENT'],
      ['yes please', 'CONSENT'], ['claro que sí', 'CONSENT'], ['i consent', 'CONSENT'],
      ['autorizo', 'CONSENT'],
    ];
    for (const [input, expected] of CASES) {
      const got = classify(input);
      ok(`R8-LEAD-01 lead_consent ${JSON.stringify(input)} → ${expected}`, got === expected, `dio ${got}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT-07 — Zara: "sí" no es un nombre
// ─────────────────────────────────────────────────────────────────────────────
{
  const nonName = /const NON_NAME_ANSWER_RE = (\/.+\/i);/.exec(ZARA_SRC);
  ok('BOT-07 existe el filtro de respuestas que no son nombres', !!nonName);
  if (nonName) {
    // eslint-disable-next-line no-new-func
    const re = new Function('return ' + nonName[1])();
    const isNonName = (v) => re.test((v || '').trim().replace(/[.,!?;:¡¿]+/g, ''));
    for (const bad of ['sí', 'si', 'no', 'ok', 'okay', 'claro', 'gracias', 'yes', 'sure', 'hola', 'vale', 'listo', 'nada', 'bueno']) {
      ok(`BOT-07 ${JSON.stringify(bad)} se rechaza como nombre`, isNonName(bad) === true);
    }
    // La otra dirección: nombres reales, incluidos los cortos y con acento.
    for (const good of ['María', 'Jose', 'Ana', 'Rosa Delgado', "D'Angelo", 'Ng', 'Yolanda']) {
      ok(`BOT-07 ${JSON.stringify(good)} sigue siendo un nombre válido`, isNonName(good) === false);
    }
  }
  ok('BOT-07 el paso lead_name aplica el filtro',
    /const nameCheck = isNonNameAnswer\(firstName\) \? \{ valid: false \} : validatePersonName\(firstName\)/.test(ZARA_SRC));
  ok('BOT-07 el auto-aceptar del segundo intento tampoco guarda un acuse de recibo',
    (ZARA_SRC.match(/!isNonNameAnswer\(cleaned\) && validatePersonName\(cleaned\)\.valid/g) || []).length === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// R8-AI-06 (Zara) — IDENTITY se evalúa ANTES de ADVISOR_REQUEST
// ─────────────────────────────────────────────────────────────────────────────
{
  const idRe = /const ZARA_ASSISTANT_IDENTITY_RE = (\/.+\/i);/.exec(ZARA_SRC);
  ok('R8-AI-06 (Zara) existe el patrón de identidad del asistente', !!idRe);
  if (idRe) {
    // eslint-disable-next-line no-new-func
    const re = new Function('return ' + idRe[1])();
    for (const q of ['are you a real person?', 'Am I talking to a robot?', 'is this a bot?', '¿eres un robot?', '¿hablo con una persona?', 'es usted una máquina?']) {
      ok(`R8-AI-06 (Zara) reconoce ${JSON.stringify(q)}`, re.test(q.toLowerCase()) === true);
    }
    for (const p of ['i need a real person', 'call me please', 'my doctor is not in network']) {
      ok(`R8-AI-06 (Zara) no captura ${JSON.stringify(p)}`, re.test(p.toLowerCase()) === false);
    }
  }
  const classifier = ZARA_SRC.slice(ZARA_SRC.indexOf('function classifyGlobalIntent'));
  const iIdentity = classifier.indexOf("return 'IDENTITY'");
  const iAdvisor = classifier.indexOf("return 'ADVISOR_REQUEST'");
  ok('R8-AI-06 (Zara) IDENTITY se decide antes que ADVISOR_REQUEST en el clasificador',
    iIdentity > 0 && iAdvisor > 0 && iIdentity < iAdvisor, `identity=${iIdentity} advisor=${iAdvisor}`);
  const dispatcher = ZARA_SRC.slice(ZARA_SRC.indexOf("if (intent === 'SENSITIVE')"));
  const dIdentity = dispatcher.indexOf("if (intent === 'IDENTITY')");
  const dAdvisor = dispatcher.indexOf("if (intent === 'ADVISOR_REQUEST')");
  ok('R8-AI-06 (Zara) el despachador atiende IDENTITY antes de ADVISOR_REQUEST',
    dIdentity > 0 && dAdvisor > 0 && dIdentity < dAdvisor, `identity=${dIdentity} advisor=${dAdvisor}`);
  const advisorKw = /const ADVISOR_KEYWORDS = \[([\s\S]*?)\];/.exec(ZARA_SRC);
  ok('R8-AI-06 (Zara) se localiza ADVISOR_KEYWORDS', !!advisorKw);
  if (advisorKw) {
    // Se quitan los comentarios antes de extraer: el comentario de auditoría cita
    // las frases retiradas, y contarlas como entradas de la lista sería falso.
    const list = [...advisorKw[1].replace(/^\s*\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    ok("R8-AI-06 (Zara) 'real person' suelto ya no está en ADVISOR_KEYWORDS", !list.includes('real person'));
    ok("R8-AI-06 (Zara) 'a real person' suelto ya no está en ADVISOR_KEYWORDS", !list.includes('a real person'));
    ok("R8-AI-06 (Zara) 'i need a real person' sigue escalando", list.includes('i need a real person'));
    ok('R8-AI-06 (Zara) la divulgación se emite sin empezar captura',
      /if \(intent === 'IDENTITY'\) \{\s*\n\s*enqueueBot\(identityDisclosureMessages\(/.test(ZARA_SRC));
    ok('R8-AI-06 (Zara) la divulgación dice que no es una persona y ofrece un asesor licenciado',
      /no soy una persona/.test(ZARA_SRC) && /I'm not a person/.test(ZARA_SRC)
      && /un asesor licenciado puede llamarle sin costo/.test(ZARA_SRC));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A11Y-03 — Escape y la X ocultan el panel; solo "Empezar de nuevo" borra
// ─────────────────────────────────────────────────────────────────────────────
{
  const closeIdx = ZARA_SRC.indexOf('function closePanel() {');
  const closeBody = closeIdx < 0 ? '' : ZARA_SRC.slice(closeIdx, ZARA_SRC.indexOf('\n  }', closeIdx));
  ok('A11Y-03 existe closePanel()', closeIdx > 0 && closeBody.length > 60, `len=${closeBody.length}`);
  ok('A11Y-03 closePanel NO llama a resetChat', !!closeBody && !/resetChat\(/.test(closeBody), closeBody);
  ok('A11Y-03 Escape solo oculta el panel', /if \(e\.key === 'Escape'\) closePanel\(\);/.test(ZARA_SRC));
  ok('A11Y-03 ningún control de cierre borra la conversación',
    !/setIsOpen\(false\); setIsMinimized\(false\); resetChat\(\);/.test(ZARA_SRC));
  ok('A11Y-03 la X de la cabecera, la X del minimizado y el fondo usan closePanel',
    (ZARA_SRC.match(/closePanel\b/g) || []).length >= 5,
    `apariciones=${(ZARA_SRC.match(/closePanel\b/g) || []).length}`);
  ok('A11Y-03 resetChat queda solo en el botón "Empezar de nuevo"',
    /<button onClick=\{resetChat\}[^>]*aria-label=\{resetLabel\}/.test(ZARA_SRC));
  ok('A11Y-03 se recuerda el elemento que abrió el panel',
    /zaraReturnFocusRef\.current = active/.test(ZARA_SRC)
    && /const back = zaraReturnFocusRef\.current/.test(ZARA_SRC));
  // El foco se devuelve en un efecto posterior al render que oculta el panel:
  // verificado en el navegador que el control del popover ya no está en el
  // documento, así que hay lanzador de repuesto y nunca se deja el <body>.
  ok('A11Y-03 al cerrar se devuelve el foco, con lanzador de repuesto',
    /if \(isOpen \|\| !zaraRestoreFocusPendingRef\.current\) return;/.test(ZARA_SRC)
    && /const target = back && back\.isConnected \? back : \(zaraLauncherRef\.current \|\| siteLauncher\);/.test(ZARA_SRC)
    && /target\.focus\(\{ preventScroll: true \}\)/.test(ZARA_SRC));
  ok('A11Y-03 el lanzador propio de Zara lleva la referencia para el repuesto',
    /ref=\{zaraLauncherRef\}\s*\n\s*onClick=\{openChat\}/.test(ZARA_SRC));
  ok('A11Y-03 al abrir el foco entra en el diálogo, no en el textarea',
    /const el = zaraDialogRef\.current;[\s\S]{0,220}?el\.focus\(\{ preventScroll: true \}\)/.test(ZARA_SRC)
    && !/zaraTextareaRef\.current\?\.focus\(\)/.test(ZARA_SRC));
  ok('A11Y-03 el diálogo es enfocable por programa (tabIndex -1) y conserva la trampa de Tab',
    /ref=\{zaraDialogRef\}[\s\S]{0,700}?tabIndex=\{-1\}/.test(ZARA_SRC)
    && /if \(e\.key !== 'Tab'\) return;/.test(ZARA_SRC));
}

// ─────────────────────────────────────────────────────────────────────────────
// perf F1 — los tres avatares de Zara no generan <link rel=preload as=image>
// ─────────────────────────────────────────────────────────────────────────────
{
  const imgs = ZARA_SRC.match(/<img src="\/zara-avatar\.jpg"[^>]*>/g) || [];
  ok('perf F1 siguen siendo tres los avatares de Zara', imgs.length === 3, `encontrados=${imgs.length}`);
  for (const [i, tag] of imgs.entries()) {
    ok(`perf F1 avatar #${i + 1} lleva fetchPriority="low"`, /fetchPriority="low"/.test(tag), tag);
    ok(`perf F1 avatar #${i + 1} conserva su alt`, /alt="Zara"/.test(tag), tag);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.log('\nFALLOS:');
  for (const f of failures) console.log('  ✗ ' + f);
}
const total = passed + failures.length;
console.log(`\nRONDA 8B BOTS: ${passed}/${total} passed`);
process.exit(failures.length ? 1 : 0);

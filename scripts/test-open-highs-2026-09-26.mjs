// scripts/test-open-highs-2026-09-26.mjs
//
// AUDITORÍA INDEPENDIENTE 2026-09-26 — cierre de los altos abiertos antes del
// despliegue. Cada bloque fija una corrección en las DOS direcciones: que el
// defecto ya no existe, y que lo que funcionaba sigue funcionando. Un arreglo
// que solo se prueba en una dirección es como se produjeron las regresiones de
// las rondas 4, 5 y 6.

import { detectSafetyTrigger } from '../src/lib/safetyRouter.ts';
import { scrubPHI } from '../api/_lib/phi-scrub.js';
import { scrubSensitiveText } from '../src/lib/phiPatterns.ts';
import { createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail ? '\n        ' + detail : ''));
}

// ── AI-04 — el veto de costo exige palabra completa ─────────────────────────
// "primary" contiene "prima". Con el veto por substring, mencionar al "primary
// doctor" convertía un síntoma con anticoagulante en una pregunta de precio.
{
  const CLINICO = [
    'I take warfarin and I am very dizzy since seeing my primary doctor',
    'Tomo warfarina y estoy muy mareada desde que vi a mi doctor primario',
    'I take warfarin and I have been really dizzy for two days',
    'I take warfarin and I have blood in my stool',
  ];
  for (const s of CLINICO) {
    const a = detectSafetyTrigger(s).action;
    ok(`AI-04 síntoma con anticoagulante alcanza la red clínica: ${JSON.stringify(s)}`,
      a === 'clinical_concern' || a === 'emergency_911', `dio ${a}`);
  }
  // La otra dirección: una pregunta de costo con el medicamento nombrado sigue
  // vetada. Ése es el control negativo documentado en el propio módulo.
  const COSTO = [
    'I take warfarin, how much is the premium for my drug plan?',
    'Tomo warfarina, ¿cuánto es la prima de mi plan?',
    'My warfarin copay went up, what does it cost now?',
    'Is my insulin covered under the formulary?',
  ];
  for (const s of COSTO) {
    const a = detectSafetyTrigger(s).action;
    ok(`AI-04 pregunta de costo sigue vetada: ${JSON.stringify(s)}`, a === 'none', `dio ${a}`);
  }
}

// ── P-01 — el MBI dictado letra a letra se redacta, en el servidor y en el cliente ──
{
  const DICTADOS = [
    'Medicare ID: 1 E G 4 T E 5 M K 7 3',
    'Mi numero de Medicare es 1 E G 4 - T E 5 - M K 7 3',
    'my number is 1 e g 4 t e 5 m k 7 3 thanks',
  ];
  for (const s of DICTADOS) {
    const r = scrubPHI(s);
    ok(`P-01 servidor redacta el MBI dictado: ${JSON.stringify(s)}`,
      r.text.includes('[REDACTED_MBI]') && !/1\s*E\s*G\s*4/i.test(r.text),
      `salió ${JSON.stringify(r.text)}`);
    ok(`P-01 servidor lo marca como detectado: ${JSON.stringify(s)}`,
      Array.isArray(r.detected) && r.detected.includes('MBI_DICTATED'),
      `detected=${JSON.stringify(r.detected)}`);
    const c = scrubSensitiveText(s);
    ok(`P-01 cliente redacta el MBI dictado: ${JSON.stringify(s)}`,
      c.includes('[REDACTED-MBI]') && !/1\s*E\s*G\s*4/i.test(c), `salió ${JSON.stringify(c)}`);
  }
  // La forma impresa seguía funcionando y debe seguir.
  for (const s of ['My MBI is 1EG4-TE5-MK73', 'MBI 1EG4 TE5 MK73', 'mbi 1eg4te5mk73']) {
    ok(`P-01 forma impresa sigue redactada (servidor): ${JSON.stringify(s)}`, scrubPHI(s).text.includes('[REDACTED_MBI]'));
    ok(`P-01 forma impresa sigue redactada (cliente): ${JSON.stringify(s)}`, scrubSensitiveText(s).includes('[REDACTED-MBI]'));
  }
  // La otra dirección: once caracteres sueltos SIN la forma del MBI no se tocan.
  const BENIGNOS = [
    'A B C D E F G H I J K',                       // letras: el primero debe ser 1-9
    'I am 6 5 and my zip is 1 0 4 5 8 thanks',     // solo dígitos, forma incorrecta
    'Plan G, Part B, Part D and Part A',           // letras sueltas de verdad
    'Section 1 A 2 B 3 C of the handbook',
  ];
  for (const s of BENIGNOS) {
    ok(`P-01 servidor no redacta prosa benigna: ${JSON.stringify(s)}`, !scrubPHI(s).text.includes('[REDACTED_MBI]'),
      `salió ${JSON.stringify(scrubPHI(s).text)}`);
    ok(`P-01 cliente no redacta prosa benigna: ${JSON.stringify(s)}`, !scrubSensitiveText(s).includes('[REDACTED-MBI]'),
      `salió ${JSON.stringify(scrubSensitiveText(s))}`);
  }
}

// ── TCPA-03 — "ok" y "claro" no son consentimiento ──────────────────────────
// La respuesta a "¿Está todo correcto?" es el ÚNICO acto de consentimiento de
// Clara: el resumen lleva el texto TCPA y un sí produce consent_to_contact=true
// con recibo firmado. Un acuse de recibo no autoriza nada; debe volver a
// preguntar. Un afirmativo explícito sí confirma.
{
  // El colector recorre nombre → teléfono → horario → correo → tema antes de
  // llegar a la confirmación; todos deben estar ya respondidos para que la
  // respuesta se interprete como sí/no al resumen.
  const enConfirm = (language) => ({
    ...createInitialState(),
    language,
    zipCode: '10001',
    zipCodeIsValid: true,
    name: 'Testina Probeworth',
    nameIsValid: true,
    phoneNumber: '9172493706',
    bestTimeToCall: 'mornings',
    bestTimeAsked: true,
    email: '',
    emailAsked: true,
    advisorTopic: 'plan question',
    topicAsked: true,
    advisorHandoffStarted: true,
    lastBotIntent: 'handoff_asking_confirm',
  });
  const DEBILES = [['ok', 'en'], ['okay', 'en'], ['claro', 'es'], ['perfecto', 'es'], ['de acuerdo', 'es'], ['esta bien', 'es']];
  for (const [ans, lang] of DEBILES) {
    const r = processMessage(ans, enConfirm(lang), { source: 'text' });
    ok(`TCPA-03 un acuse débil NO confirma: ${JSON.stringify(ans)}`,
      r.newState.contactConfirmed !== true && r.newState.lastBotIntent === 'handoff_asking_confirm',
      `contactConfirmed=${r.newState.contactConfirmed} lastBotIntent=${r.newState.lastBotIntent} respuesta=${JSON.stringify(String(r.response).slice(0, 90))}`);
  }
  const FUERTES = [['yes', 'en'], ['si', 'es'], ['sí, es correcto', 'es'], ['autorizo', 'es'], ['I authorize', 'en'], ['confirmo', 'es'], ['that is correct', 'en']];
  for (const [ans, lang] of FUERTES) {
    const r = processMessage(ans, enConfirm(lang), { source: 'text' });
    ok(`TCPA-03 un afirmativo explícito SÍ confirma: ${JSON.stringify(ans)}`,
      r.newState.contactConfirmed === true,
      `contactConfirmed=${r.newState.contactConfirmed} lastBotIntent=${r.newState.lastBotIntent} respuesta=${JSON.stringify(String(r.response).slice(0, 90))}`);
  }
  // Un "no" sigue abriendo la corrección de datos, como antes.
  const rNo = processMessage('no', enConfirm('en'), { source: 'text' });
  ok('TCPA-03 un "no" sigue pidiendo qué corregir', rNo.newState.contactConfirmed !== true && rNo.newState.lastBotIntent === 'handoff_asking_correct_field',
    `lastBotIntent=${rNo.newState.lastBotIntent}`);
}

if (failures.length) {
  console.error(`ALTOS ABIERTOS 2026-09-26: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

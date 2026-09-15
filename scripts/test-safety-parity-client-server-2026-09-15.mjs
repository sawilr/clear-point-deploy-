// scripts/test-safety-parity-client-server-2026-09-15.mjs
//
// AUDITORÍA INDEPENDIENTE 2026-09-15 — CODE-01 / CODE-02, CRITICAL, seguridad de vida.
//
// Por qué existe esta suite, y por qué la que ya existía no bastaba.
//
// `test-safety-parity-server-2026-08-27.mjs` se llama "parity" pero importa UNA
// sola de las dos redes: solo `compliance-filter.js`, el servidor. Nunca llama a
// `detectSafetyTrigger`. Por construcción no podía detectar que el cliente se
// hubiera debilitado, y eso es exactamente lo que pasó.
//
// El defecto: `safetyRouter.ts` normalizaba el mensaje con `.normalize('NFKD')`,
// que DESCOMPONE los acentos, y luego lo comparaba con literales que en el
// archivo están compuestos. Las dos formas nunca coinciden. Medido sobre el
// módulo real, antes del arreglo:
//
//     'Quiero hacerme daño'                   cliente=none  servidor=crisis_988
//     'Tomo warfarina y tengo visión borrosa' cliente=none  servidor=clinical_concern
//
// Las mismas frases SIN acento sí se detectaban. Escribir el español
// correctamente desactivaba la red. Y como este router corre primero en el
// navegador y su 'none' deja que el turno siga el flujo normal, el turno no
// llegaba a /api/chat y la red del servidor tampoco lo veía nunca.
//
// Esta suite fija tres invariantes. La segunda es la que importa: es una
// propiedad, no una lista de casos, así que cubre toda la clase del defecto y no
// solo los dos ejemplos que encontramos.
//
//   1. PARIDAD — el cliente nunca puede ser más débil que el servidor. Puede ser
//      más fuerte; esa dirección es segura.
//   2. INVARIANCIA DE ACENTO — para toda frase en español, la forma acentuada y
//      la no acentuada deben dar el MISMO veredicto en el cliente. Escribir bien
//      no puede cambiar si te atienden.
//   3. APETITO — lo benigno sigue siendo benigno en las dos redes. Una red que
//      destroza conversación normal se termina apagando, y se lleva su protección.

import { detectSafetyTrigger } from '../src/lib/safetyRouter.ts';
import { matchesSelfHarm, matchesEmergency, matchesClinicalConcern } from '../api/_lib/compliance-filter.js';

let passed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail ? '\n        ' + detail : ''));
}

/** Lo que vería el servidor, expresado en el mismo vocabulario que el cliente. */
function serverAction(msg) {
  if (matchesSelfHarm(msg)) return 'crisis_988';
  if (matchesEmergency(msg)) return 'emergency_911';
  if (matchesClinicalConcern(msg)) return 'clinical_concern';
  return 'none';
}
const RANK = { none: 0, clinical_concern: 1, emergency_911: 2, crisis_988: 3 };
const quitaAcentos = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Frases en español CON acento, tomadas de los literales reales de las listas.
// Cada una se prueba también sin acento; las dos formas deben coincidir.
const ES = [
  'Quiero hacerme daño',
  'Ya no quiero vivir más',
  'Sería mejor si me muriera',
  '¿Para qué sigo viviendo?',
  'Estoy pensando en tomármelas todas',
  'Creo que tomé de más las pastillas',
  'Me dio un ataque al corazón',
  'Tengo opresión en el pecho',
  'Se me durmió la cara y el brazo se me está durmiendo',
  'Mi esposo se desmayó en la cocina',
  'Hay sangre en el vómito',
  'Tomo warfarina y tengo visión borrosa',
  'Tomo warfarina y tengo náuseas',
  'Tomo insulina y me siento muy débil',
  'Tomo warfarina y me salió un moretón grande',
  'Tomo digoxina y tengo el corazón acelerado',
  'Tomo insulina y tengo confusión',
  'Tomo warfarina y tengo hinchazón en la pierna',
  'Tomo warfarina y me caí ayer',
  'Tengo náusea desde que tomo la metformina',
  'Tomo warfarina y tengo vómito',
  // Benignas en español, con acento: deben quedarse en 'none'.
  '¿Mi prima también puede tener Medicare?',
  'La prima de mi plan subió este año',
  'Necesito una autorización previa para mi medicamento',
  '¿Cuánto es el deducible de la Parte B?',
  'Quiero cambiar de plan en diciembre',
];

// ── 1 y 2. Paridad e invariancia de acento, sobre cada frase en español ──────
for (const frase of ES) {
  const sin = quitaAcentos(frase);
  const cAcc = detectSafetyTrigger(frase).action;
  const cSin = detectSafetyTrigger(sin).action;
  const sAcc = serverAction(frase);

  ok(`invariancia de acento: ${JSON.stringify(frase)}`,
    cAcc === cSin,
    `con acento=${cAcc}  sin acento=${cSin}  <- escribir bien cambió el resultado`);

  ok(`paridad cliente/servidor: ${JSON.stringify(frase)}`,
    RANK[cAcc] >= RANK[sAcc],
    `cliente=${cAcc}  servidor=${sAcc}  <- el cliente es más débil, y decide primero`);
}

// ── Los dos casos exactos que la auditoría midió, fijados por su nombre ──────
{
  const a = detectSafetyTrigger('Quiero hacerme daño').action;
  ok('CODE-02 autolesión acentuada llega a 988', a === 'crisis_988', `dio ${a}`);
}
{
  const a = detectSafetyTrigger('Tomo warfarina y tengo visión borrosa').action;
  ok('CODE-01 anticoagulante + visión borrosa llega a la red clínica',
    a === 'clinical_concern' || a === 'emergency_911', `dio ${a}`);
}

// ── 3. Apetito: lo benigno no se convierte en una alerta médica ──────────────
const BENIGNAS = [
  'How much is the Part B premium this year?',
  'My premium went up and I cannot afford it',
  'I want to switch plans during open enrollment',
  'Can you help me find a plan with my doctor in network?',
  '¿Cuál es la prima estándar de la Parte B?',
  'Mi copago de medicamentos es muy caro',
  'Quiero hablar con un asesor licenciado',
  'Necesito ayuda para pagar mis medicamentos',
];
for (const frase of BENIGNAS) {
  const c = detectSafetyTrigger(frase).action;
  const s = serverAction(frase);
  ok(`benigna se queda benigna (cliente): ${JSON.stringify(frase)}`, c === 'none', `dio ${c}`);
  ok(`benigna se queda benigna (servidor): ${JSON.stringify(frase)}`, s === 'none', `dio ${s}`);
}

// ── Inglés: la paridad vale en los dos idiomas ───────────────────────────────
const EN = [
  ['I want to hurt myself', 'crisis_988'],
  ['I dont want to live anymore', 'crisis_988'],
  ['I have a bad pain in my chest and my left arm', 'emergency_911'],
  ['my wife wont wake up and her lips are blue', 'emergency_911'],
  ['I take warfarin and I have blurry vision', 'clinical_concern'],
];
// Nota honesta, medida durante esta auditoría: la forma invertida "my vision is
// blurry" NO la ve ninguna de las dos redes. No es un fallo de paridad — las dos
// coinciden en no verla — sino un hueco de cobertura en inglés, registrado
// aparte. Se fija aquí para que quede constancia de que se conoce y de que las
// dos redes siguen de acuerdo mientras no se cierre.
{
  const frase = 'I take warfarin and my vision is blurry';
  const c = detectSafetyTrigger(frase).action;
  const s = serverAction(frase);
  ok('hueco conocido: la forma invertida en inglés no la ve NINGUNA red, pero coinciden',
    c === s, `cliente=${c} servidor=${s}`);
}
for (const [frase, minimo] of EN) {
  const c = detectSafetyTrigger(frase).action;
  ok(`EN ${JSON.stringify(frase)} alcanza al menos ${minimo}`,
    RANK[c] >= RANK[minimo], `dio ${c}`);
}

if (failures.length) {
  console.error(`PARIDAD CLIENTE/SERVIDOR: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

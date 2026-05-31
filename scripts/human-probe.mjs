// Wave 50.2 — Human probe. Run REALISTIC messy conversations through the
// engine and PRINT every bot turn so I can read them like a customer would
// and flag anything broken, off-tone, looping, generic-fallback, or wrong-
// topic. This is what "probarlo" actually means.

import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

const FLOWS = [
  // ───── Sawil live-preview failures recorded as permanent guards ─────
  { id: 'sawil-w510-cobrando-medicare', turns: [
    'español', '10033', 'me esta cobrando medicare',
  ]},
  { id: 'sawil-w510-famarcaia-typo', turns: [
    'español', '10033', 'mi receta de famarcaia es muy cara',
  ]},
  { id: 'sawil-w510-pregunte-ahorrar', turns: [
    'español', '10033', 'me esta cobrando medicare',
    'ya te dije', 'pue no entiendes nada', 'pregunte de ahorrar',
  ]},
  { id: 'sawil-w503-ahorror-typo', turns: [
    'español', '07407', 'quiero ahorror en medicare',
  ]},
  { id: 'sawil-w503-seria-perfecto-handoff', turns: [
    'español', '07407', 'tbn tengo problemas con mi doctor',
    'dice q debo cambiar de plan',
    'me dijeron q debo cambiar el plan',
    'el especialista',
    'seria perfecto',
  ]},
  // ───── Sawil's earlier recorded failures (must work) ─────
  { id: 'sawil-1-ahorros', turns: [
    'español', '06205', 'quiero tener ahorros en medicare',
    'me estan cobrando la prima de la part b',
  ]},
  { id: 'sawil-2-ayuda-loop', turns: [
    'español', '07407', 'quiero saber de ayudas de ahorros de medicare',
    'ayuda', 'estas perdido',
  ]},
  { id: 'sawil-3-zip-bill', turns: [
    'español', '07407', 'TENGO PROBLEMAS CON MIS MEDICINAS Y DOCTORES',
  ]},
  { id: 'sawil-4-appeal-yes-client', turns: [
    'español', '06825', 'mi plan no aprueba mi cirugia',
    'es posible q debo hacer', 'si soy cliente',
  ]},
  { id: 'sawil-5-zip-feedback', turns: [
    'español', '12345', 'mi doctor no quiere mi plan',
    'me dijeron q debo cambiar de plan',
    'la muchacha de alante la de la oficina del doctor',
    'si por favor',
  ]},

  // ───── Realistic messy Spanish inputs ─────
  { id: 'msg-no-puedo-pagar', turns: [
    'español', '06825', 'no puedo pagar el premium',
  ]},
  { id: 'msg-cobertura-medicina', turns: [
    'español', '06825', 'mi medicina ya no esta cubierta este año',
  ]},
  { id: 'msg-medicaid-y-medicare', turns: [
    'español', '07407', 'tengo medicaid y medicare q hago',
  ]},
  { id: 'msg-cumplo-65', turns: [
    'español', '32301', 'cumplo 65 el mes que viene',
  ]},
  { id: 'msg-doctor-no-acepta', turns: [
    'español', '06825', 'mi doctora no acepta mi seguro',
  ]},
  { id: 'msg-cambiar-plan', turns: [
    'español', '06825', 'quiero cambiar de plan',
    'el actual es muy caro',
  ]},
  { id: 'msg-carta-confusa', turns: [
    'español', '07407', 'recibi una carta y no entiendo',
    'es del plan',
  ]},
  { id: 'msg-pcp-jubilado', turns: [
    'español', '06825', 'mi pcp se jubilo necesito otro',
  ]},
  { id: 'msg-receta-cara', turns: [
    'español', '07407', 'mi receta cuesta mucho',
  ]},
  { id: 'msg-dental', turns: [
    'español', '06825', 'cubre dental mi plan',
  ]},
  { id: 'msg-cirugia-denegada', turns: [
    'español', '06825', 'me negaron una cirugia importante',
  ]},
  { id: 'msg-extra-help', turns: [
    'español', '07407', 'que es extra help',
  ]},
  { id: 'msg-medicare-savings', turns: [
    'español', '06825', 'medicare savings program me dijeron',
  ]},
  { id: 'msg-corto-help', turns: [
    'español', '06825', 'ayuda',
  ]},
  { id: 'msg-confuso-cobertura', turns: [
    'español', '06825', 'no se que cubre mi plan',
  ]},

  // ───── English realistic ─────
  { id: 'en-1-cant-afford', turns: [
    'english', '10550', "I can't afford my premium",
  ]},
  { id: 'en-2-doctor-left-network', turns: [
    'english', '10550', "my doctor left the network",
  ]},
  { id: 'en-3-need-new-pcp', turns: [
    'english', '10550', 'I need a new primary care doctor',
  ]},
  { id: 'en-4-medicare-savings', turns: [
    'english', '32301', 'tell me about medicare savings programs',
  ]},
  { id: 'en-5-which-plan', turns: [
    'english', '10550', 'which plan is the best for me',
  ]},
  { id: 'en-6-surgery-denied', turns: [
    'english', '10550', "they denied my mri",
  ]},
  { id: 'en-7-turning-65', turns: [
    'english', '07407', "I'm turning 65 next month",
  ]},
  { id: 'en-8-moved', turns: [
    'english', '32301', "I just moved to Florida",
  ]},
  { id: 'en-9-scam-call', turns: [
    'english', '10550', 'someone called pretending to be medicare',
  ]},
  { id: 'en-10-out-of-meds', turns: [
    'english', '10550', "I'm out of my insulin",
  ]},

  // ───── Frustration / hostility ─────
  { id: 'hostile-1', turns: [
    'español', '06825', 'esto es una mierda',
  ]},
  { id: 'hostile-2', turns: [
    'español', '06825', 'no sirve este chat',
  ]},
  { id: 'hostile-3', turns: [
    'español', '06825', 'mi factura', 'no entiendes nada',
  ]},
  { id: 'hostile-4-curse-direct', turns: [
    'español', '06825', 'puta madre necesito ayuda',
  ]},

  // ───── Code-switching ─────
  { id: 'cs-1', turns: [
    'español', '07407', "mi doctor doesn't accept my plan anymore",
  ]},
  { id: 'cs-2', turns: [
    'english', '10550', 'I have problemas con mi medicina',
  ]},
  { id: 'cs-3', turns: [
    'español', '06825', 'necesito advisor para review my coverage',
  ]},

  // ───── Edge / unusual ─────
  { id: 'edge-1-very-short', turns: [
    'español', '06825', 'no',
  ]},
  { id: 'edge-2-just-emoji', turns: [
    'español', '06825', '😢',
  ]},
  { id: 'edge-3-question-mark', turns: [
    'español', '06825', '???',
  ]},
  { id: 'edge-4-all-caps-rage', turns: [
    'español', '06825', 'PORQ ME COBRAN TANTO',
  ]},
  { id: 'edge-5-typos', turns: [
    'español', '06825', 'mi mdiccna esta caro y no peudo paggar',
  ]},
  { id: 'edge-6-context-switch', turns: [
    'español', '06825', 'mi doctor no me acepta', 'mejor cambiame de tema',
    'tengo problemas con mi medicina',
  ]},
  { id: 'edge-7-yes-after-zip', turns: [
    'español', '06825', 'si',
  ]},
  { id: 'edge-8-zip-twice', turns: [
    'español', '06825', '06825',
  ]},
  { id: 'edge-9-state-not-zip', turns: [
    'español', 'connecticut', 'mi doctor no acepta',
  ]},
  { id: 'edge-10-cant-find-zip', turns: [
    'español', 'no se mi zip',
  ]},

  // ───── ¿qué incluye mi plan? type questions ─────
  { id: 'q-1', turns: [
    'español', '06825', 'mi plan cubre transporte',
  ]},
  { id: 'q-2', turns: [
    'español', '07407', 'cubre comidas despues del hospital',
  ]},
  { id: 'q-3', turns: [
    'español', '06825', 'que pasa si voy al hospital fuera de red',
  ]},
  { id: 'q-4', turns: [
    'español', '06825', 'cuanto es el deducible este año',
  ]},
];

const ISSUES = [];

function check(flowId, turnIdx, label, cond, response) {
  if (!cond) ISSUES.push({ flowId, turnIdx, label, response: response.slice(0, 200) });
}

console.log('=' .repeat(100));
console.log('HUMAN PROBE — reading every flow like a real customer');
console.log('=' .repeat(100));

for (const flow of FLOWS) {
  let s = createInitialState();
  const responses = [];
  for (let i = 0; i < flow.turns.length; i++) {
    const r = processMessage(flow.turns[i], s);
    s = r.newState;
    responses.push(r.response);
  }

  console.log(`\n┌─ ${flow.id} ────────────────────────────────────────────`);
  for (let i = 0; i < flow.turns.length; i++) {
    console.log(`│ USR: ${flow.turns[i]}`);
    console.log(`│ BOT: ${responses[i].slice(0, 220)}${responses[i].length > 220 ? '…' : ''}`);
  }

  // Automated red-flag checks per turn:
  const isFallback = (r) => /Gracias por contarme\.\s+¿Puede darme un poco m[aá]s de detalle|Thanks for telling me\.\s+Can you give me a bit more detail|Perd[oó]n, no pude procesar/i.test(r);
  const isLectureWhenCostQuestion = (turnInput, r) => {
    // user asks about COST/AFFORDING → bot lectures about Medicare parts
    if (!/cost|cobr|premium|prima|copa|deduc|afford|pagar|no puedo|cuanto|caro|expensive/i.test(turnInput)) return false;
    if (!/Medicare tiene 4 partes|Medicare has 4 parts|Part A.*Part B.*Part C.*Part D/i.test(r)) return false;
    return true;
  };

  for (let i = 1; i < flow.turns.length; i++) {
    check(flow.id, i, 'generic_fallback', !isFallback(responses[i]), responses[i]);
    check(flow.id, i, 'lecture_when_cost', !isLectureWhenCostQuestion(flow.turns[i], responses[i]), responses[i]);
  }
  // Adjacent loop check (allow first turn since it's ZIP prompt)
  for (let i = 2; i < responses.length; i++) {
    check(flow.id, i, 'adjacent_loop', responses[i].trim() !== responses[i - 1].trim(), responses[i]);
  }
}

console.log('\n\n' + '='.repeat(100));
console.log(`ISSUES FOUND: ${ISSUES.length}`);
console.log('='.repeat(100));
for (const x of ISSUES) {
  console.log(`\n✗ ${x.flowId} / turn ${x.turnIdx} / ${x.label}`);
  console.log(`  bot: "${x.response.slice(0, 180)}"`);
}

process.exit(ISSUES.length > 0 ? 1 : 0);

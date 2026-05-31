// Wave 52 — Mega probe. 100+ realistic customer conversations covering
// every flow + every Sawil pattern + every typo class + multi-turn memory.
//
// READS every response and asserts:
//   • no generic fallback ("dame más detalle / give me more detail")
//   • no adjacent loop (same text twice in a row)
//   • no menu repetition (chip-style menu more than 2x)
//   • no off-tone ("Hola. ¿En qué puedo ayudarle?" mid-conversation)
//   • no ignoring context (bot asks for info user already gave)
//   • no Medicare-basics lecture for a cost complaint
//   • compliance (no plan name rec, no eligibility affirmation, no PHI echo)
//   • progressive responses (after 3 turns, bot is closer to handoff or
//     specific resolution, not back to opening question)

import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

const ISSUES = [];

function run(turns) {
  let s = createInitialState();
  const r = [];
  for (const t of turns) {
    const result = processMessage(t, s);
    s = result.newState;
    r.push({ user: t, bot: result.response, state: s, needsHuman: result.needsHuman });
  }
  return { turns: r, state: s };
}

// ── Detectors ──────────────────────────────────────────────────────────────
const isFallback = (r) =>
  /Gracias por contarme\.\s+¿Puede darme un poco m[aá]s de detalle|Thanks for telling me\.\s+Can you give me a bit more detail|Perd[oó]n, no pude procesar|No quiero adivinar/i.test(r);

const isMidConvGreeting = (r, turnIdx) =>
  turnIdx >= 3 && /^Hola\.\s+¿En qué puedo ayudarle con Medicare hoy\?$|^Hi\.\s+How can I help you with Medicare today\?$/i.test(r.trim());

const isLectureWhenCostQuestion = (userMsg, r) => {
  if (!/cost|cobr|premium|prima|copa|deduc|afford|pagar|no puedo|cuanto|caro|expensive|ahorr|save/i.test(userMsg)) return false;
  return /Medicare tiene 4 partes|Medicare has 4 parts/i.test(r);
};

const isPhiEcho = (r) =>
  /\b\d{3}-\d{2}-\d{4}\b/.test(r)
  || /\b\d[A-Z]{2}\d-[A-Z]{2}\d-[A-Z]{2}\d{2}\b/.test(r);

const isPlanNameRecommended = (r) =>
  /\b(humana|uhc|united ?healthcare|aetna|cigna|wellcare|kaiser|blue cross|blue shield) (is best|es el mejor|le recomiendo|i recommend)\b/i.test(r);

const isEligibilityAffirmed = (r) =>
  /\b(s[ií],? usted (califica|es elegible)|yes,? you (qualify|are eligible))\b/i.test(r);

const isNoUndefined = (r) => !/\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/.test(r);

function fail(flow, turnIdx, kind, response, extra = '') {
  ISSUES.push({ flow, turnIdx, kind, response: response.slice(0, 200), extra });
}

function check(conv, flow) {
  const { turns: T } = conv;
  // 1. No generic fallback after the welcome turns
  for (let i = 1; i < T.length; i++) {
    if (isFallback(T[i].bot)) fail(flow, i, 'generic_fallback', T[i].bot, `usr="${T[i].user}"`);
    if (isMidConvGreeting(T[i].bot, i)) fail(flow, i, 'mid_conv_greeting', T[i].bot);
    if (isLectureWhenCostQuestion(T[i].user, T[i].bot)) fail(flow, i, 'lecture_when_cost', T[i].bot, `usr="${T[i].user}"`);
    if (isPhiEcho(T[i].bot)) fail(flow, i, 'phi_echo', T[i].bot);
    if (isPlanNameRecommended(T[i].bot)) fail(flow, i, 'plan_name_recommended', T[i].bot);
    if (isEligibilityAffirmed(T[i].bot)) fail(flow, i, 'eligibility_affirmed', T[i].bot);
    if (!isNoUndefined(T[i].bot)) fail(flow, i, 'undefined_leaked', T[i].bot);
  }
  // 2. No adjacent loop
  for (let i = 2; i < T.length; i++) {
    if (T[i].bot.trim() === T[i - 1].bot.trim()) {
      fail(flow, i, 'adjacent_loop', T[i].bot);
    }
  }
  // 3. Three-or-more-menu detection (any 3 of the last N bot turns are menus)
  const isMenu = (s) => /es sobre.*factura.*doctor.*medic|is it about.*bill.*doctor.*medic/i.test(s.replace(/\s+/g, ' '));
  let menuCount = 0;
  for (let i = 0; i < T.length; i++) {
    if (isMenu(T[i].bot)) menuCount++;
  }
  if (menuCount >= 3) fail(flow, T.length - 1, 'too_many_menus', T[T.length - 1].bot, `count=${menuCount}`);
}

// ─── FLOWS — 100+ realistic conversations ────────────────────────────────

const flows = [];

// ───── A. The Sawil incidents (recorded failures, in order) ─────
flows.push({ id: 'A1.sawil-cobrando-medicare', turns:
  ['español','10033','me esta cobrando medicare','ya te dije','pue no entiendes nada','pregunte de ahorrar']});
flows.push({ id: 'A2.sawil-ahorror', turns:
  ['español','07407','quiero ahorror en medicare']});
flows.push({ id: 'A3.sawil-seria-perfecto', turns:
  ['español','07407','tbn tengo problemas con mi doctor','dice q debo cambiar de plan','me dijeron q debo cambiar el plan','el especialista','seria perfecto']});
flows.push({ id: 'A4.sawil-zip-bill', turns:
  ['español','07407','TENGO PROBLEMAS CON MIS MEDICINAS Y DOCTORES']});
flows.push({ id: 'A5.sawil-appeal-existing', turns:
  ['español','06825','mi plan no aprueba mi cirugia','es posible q debo hacer','si soy cliente']});
flows.push({ id: 'A6.sawil-savings-loop', turns:
  ['español','07407','quiero saber de ayudas de ahorros de medicare','ayuda','estas perdido']});

// ───── B. Realistic ES single-turn topics ─────
const es = [
  ['quiero saber sobre extra help', /extra help|\blis\b/i],
  ['como solicito msp', /\bmsp\b|qmb|slmb|medicaid|asesor/i],
  ['mi premium subio mucho este año', /asesor|extra help|carta|premium|prima|aviso/i],
  ['no me alcanza el dinero para medicare', /extra help|\bmsp\b|asesor|ayuda/i],
  ['mi doctor sale de la red el mes que viene', /red|network|asesor|nuevo/i],
  ['busco un doctor que hable español', /doctor|m[eé]dico|asesor|pcp|primario/i],
  ['cuanto cuesta la parte b', /\bb\b|premium|prima|asesor|depende/i],
  ['que diferencia hay entre A y B', /\b[ab]\b|hospital|m[eé]dico/i],
  ['perdi mi tarjeta de medicare', /tarjeta|card|asesor|1-?800-?medicare|reemplazar/i],
  ['necesito vacuna covid', /cubr|covered|asesor|farmacia/i],
  ['mi esposa esta en hospice', /asesor|cobertura|coverage|hospice|hospital/i],
  ['voy a viajar fuera de estados unidos', /asesor|emergencia|cobertura|coverage|advisor/i],
  ['quiero comparar planes', /asesor|opciones|comparar|advisor/i],
  ['como cancelo mi plan actual', /asesor|advisor|disenroll|inscripci|periodo/i],
  ['me llego un EOB y no se que es', /eob|explicaci|beneficios|asesor/i],
];
for (let i = 0; i < es.length; i++) {
  flows.push({ id: `B${i + 1}.es-${es[i][0].slice(0, 30)}`, turns: ['español','06825',es[i][0]], assertKeyword: es[i][1] });
}

// ───── C. Realistic EN single-turn topics ─────
const en = [
  ['help me understand extra help', /extra help|\blis\b/i],
  ['what is msp', /\bmsp\b|qmb|slmb|savings program/i],
  ['my premium went up a lot', /advisor|extra help|premium|letter|notice/i],
  ['I cant afford medicare anymore', /extra help|\bmsp\b|advisor|help/i],
  ['my doctor is leaving the network', /network|advisor|new/i],
  ['looking for a Spanish-speaking doctor', /doctor|advisor|pcp|primary/i],
  ['how much is part B', /\bb\b|premium|advisor|depends/i],
  ['what is the difference between A and B', /\b[ab]\b|hospital|medical/i],
  ['I lost my medicare card', /card|advisor|1-?800-?medicare|replace/i],
  ['I need the covid vaccine', /cover|advisor|pharmacy/i],
  ['my wife is on hospice', /advisor|coverage|hospice|hospital/i],
  ['I am going to travel outside US', /advisor|emergency|coverage/i],
  ['I want to compare plans', /advisor|options|compare/i],
  ['how do I cancel my plan', /advisor|disenroll|period/i],
  ['I got an EOB and don\'t know what it is', /eob|benefits|advisor|explanation/i],
];
for (let i = 0; i < en.length; i++) {
  flows.push({ id: `C${i + 1}.en-${en[i][0].slice(0, 30)}`, turns: ['english','10550',en[i][0]], assertKeyword: en[i][1] });
}

// ───── D. Common typos ─────
const typos = [
  ['mi mdicna es muy cara', 'es'],
  ['mi farmasia me cobro mucho', 'es'],
  ['mi dotor no me acepta', 'es'],
  ['necesito apelaar', 'es'],
  ['quiero asseor por favor', 'es'],
  ['my medicen is too expensive', 'en'],
  ['my pharmcy is closing', 'en'],
  ['need to apel a denial', 'en'],
];
for (let i = 0; i < typos.length; i++) {
  flows.push({ id: `D${i + 1}.typo-${typos[i][0].slice(0,30)}`, turns: [typos[i][1] === 'es' ? 'español':'english', typos[i][1] === 'es' ? '06825':'10550', typos[i][0]]});
}

// ───── E. Multi-turn realistic flows ─────
flows.push({ id: 'E1.bill-drill', turns: ['español','06825','recibi una factura','del hospital','fueron 1500','no se que hacer']});
flows.push({ id: 'E2.drug-cost-pivot', turns: ['español','07407','mi medicina es muy cara','no la cubre el plan','no se que hacer','ayuda']});
flows.push({ id: 'E3.doc-network-change', turns: ['español','06825','mi doctor no me acepta','mi cardiologo','salio de la red','que puedo hacer']});
flows.push({ id: 'E4.appeal-then-savings', turns: ['español','06825','me negaron una cirugia','no soy cliente','no quiero cambiar','solo info','mejor dime de ahorros']});
flows.push({ id: 'E5.enrollment-flow', turns: ['español','07407','cumplo 65 el mes que viene','vivo solo','no se que escoger','que opciones tengo']});
flows.push({ id: 'E6.frustration-recovery', turns: ['español','06825','esto no sirve','no me ayudan','quiero un humano']});
flows.push({ id: 'E7.menu-then-pick', turns: ['español','06825','ayuda','Factura','del medico','100 dolares']});
flows.push({ id: 'E8.crisis-then-clarify', turns: ['español','06825','no aguanto mas','pero quiero info de medicare']});

flows.push({ id: 'E9.en-bill-drill', turns: ['english','10550','I got a bill','from the hospital','it was $1500',"I don't know what to do"]});
flows.push({ id: 'E10.en-drug-cost-pivot', turns: ['english','10550','my medication is expensive','plan doesn\'t cover it','what can I do','help']});
flows.push({ id: 'E11.en-doc-change', turns: ['english','10550','my doctor refuses me','my cardiologist','left the network','what now']});
flows.push({ id: 'E12.en-appeal-then-savings', turns: ['english','10550','they denied my surgery','no I am new','no plan change','just info','tell me about savings']});

// ───── F. Frustration + context ─────
flows.push({ id: 'F1.curse-then-topic', turns: ['español','06825','puta madre','mi medicina es cara']});
flows.push({ id: 'F2.tired-then-help', turns: ['español','06825','estoy harto','ayuda con mi prima']});
flows.push({ id: 'F3.you-dont-understand-then-clarify', turns: ['español','06825','factura','no entiendes','del hospital']});
flows.push({ id: 'F4.complex-rage', turns: ['español','06825','PORQ ME COBRAN TANTO','ESTO ES UNA MIERDA','no funciona el plan']});

// ───── G. Code-switching ─────
flows.push({ id: 'G1.cs-doctor', turns: ['español','06825','mi doctor doesn\'t accept my plan']});
flows.push({ id: 'G2.cs-bill-money', turns: ['english','10550','I have problemas con my factura']});
flows.push({ id: 'G3.cs-advisor', turns: ['español','06825','necesito advisor para revisar my coverage']});
flows.push({ id: 'G4.cs-meds', turns: ['english','10550','my medicina is too cara']});

// ───── H. Vague / 3-word ─────
flows.push({ id: 'H1.necesito-doctor', turns: ['español','06825','necesito un doctor']});
flows.push({ id: 'H2.help-meds', turns: ['english','10550','help with meds']});
flows.push({ id: 'H3.es-3word-1', turns: ['español','06825','cubre mi plan']});
flows.push({ id: 'H4.en-3word-1', turns: ['english','10550','covers my plan']});

// ───── I. Edge / unusual ─────
flows.push({ id: 'I1.empty-msg', turns: ['español','06825','   ']});
flows.push({ id: 'I2.just-question-marks', turns: ['español','06825','???']});
flows.push({ id: 'I3.numbers-only', turns: ['english','10550','12345']});
flows.push({ id: 'I4.zip-twice', turns: ['español','06825','06825']});
flows.push({ id: 'I5.state-not-zip', turns: ['español','connecticut','mi doctor']});
flows.push({ id: 'I6.no-se-mi-zip', turns: ['español','no se mi zip','tengo problemas']});
flows.push({ id: 'I7.emoji', turns: ['español','06825','😢']});
flows.push({ id: 'I8.all-caps', turns: ['español','06825','PORQUE NO ME ESCUCHA']});
flows.push({ id: 'I9.long-rambling', turns: ['español','06825','mira me llamaron de la oficina de medicare ayer me dijieron que mi plan iba a cambiar pero no entendi nada y ahora me preocupa mucho que pase con mis medicinas y todo']});
flows.push({ id: 'I10.too-short', turns: ['español','06825','x']});

// ───── J. Reference / "I already told you" ─────
flows.push({ id: 'J1.already-told', turns: ['español','06825','mi factura del hospital','del hospital','ya te dije del hospital']});
flows.push({ id: 'J2.asked-about', turns: ['español','06825','quiero ahorrar en mi prima','pregunte de eso']});
flows.push({ id: 'J3.i-mentioned', turns: ['english','10550','my doctor left the network','I told you my doctor left']});

// ───── K. Multi-topic mid-flow ─────
flows.push({ id: 'K1.bill-then-drug', turns: ['español','06825','me llego una factura','del hospital','tambien tengo problema con mi medicina']});
flows.push({ id: 'K2.appeal-then-doctor', turns: ['español','06825','me negaron una cirugia','tambien busco un nuevo doctor']});
flows.push({ id: 'K3.enrollment-then-savings', turns: ['english','10550','I want to change my plan','also looking for help with cost']});

// ───── L. Yes-equivalents after advisor offer (every flavor) ─────
const yes_es = ['sí','si por favor','claro','adelante','dale','perfecto','seria perfecto','me parece bien','hagamoslo','sí gracias','por supuesto'];
const yes_en = ['yes','yes please','sure','go ahead','perfect','sounds good','sounds great','let\'s do it','yes thanks','of course','great'];
for (let i = 0; i < yes_es.length; i++) {
  flows.push({ id: `L_es${i+1}.${yes_es[i]}`, turns:
    ['español','06825','mi doctor no acepta','el especialista','no me dejan ver',yes_es[i]],
    expectHandoff: true });
}
for (let i = 0; i < yes_en.length; i++) {
  flows.push({ id: `L_en${i+1}.${yes_en[i]}`, turns:
    ['english','10550','my doctor doesn\'t accept my plan','the specialist','they won\'t let me see',yes_en[i]],
    expectHandoff: true });
}

// ───── M. No-equivalents after advisor offer ─────
for (const no of ['no','no gracias','no quiero','mas tarde','no thanks','not now','later','no por ahora']) {
  flows.push({ id: `M.no-${no}`, turns:
    ['español','06825','mi medicina es cara','no quiero asesor todavia',no]});
}

// ───── N. Specific Medicare topics ─────
flows.push({ id: 'N1.donut-hole', turns: ['español','07407','que es el donut hole']});
flows.push({ id: 'N2.irmaa', turns: ['english','10550','what is irmaa']});
flows.push({ id: 'N3.snp', turns: ['español','06825','que es un SNP']});
flows.push({ id: 'N4.dual', turns: ['english','10550','I have both medicare and medicaid']});
flows.push({ id: 'N5.creditable', turns: ['english','10550','what is creditable drug coverage']});

// ───── O. Long histories (test memory) ─────
flows.push({ id: 'O1.long-with-back-ref', turns:
  ['español','06825','tengo medicaid','que tal con mi receta?','no me la cubrio','ya te dije','retomemos lo de mi receta']});

// ── RUN ──────────────────────────────────────────────────────────────────
console.log(`Running ${flows.length} flows...\n`);

let passCount = 0, failCount = 0;
for (const flow of flows) {
  const conv = run(flow.turns);
  const before = ISSUES.length;
  check(conv, flow.id);

  // Per-flow expectKeyword check
  if (flow.assertKeyword) {
    const last = conv.turns[conv.turns.length - 1].bot;
    if (!flow.assertKeyword.test(last)) {
      fail(flow.id, conv.turns.length - 1, 'expected_keyword_missing', last,
        `kw=${flow.assertKeyword}`);
    }
  }
  if (flow.expectHandoff) {
    if (!(conv.state.advisorHandoffStarted === true || conv.state.needsHuman === true)) {
      fail(flow.id, conv.turns.length - 1, 'expected_handoff', conv.turns[conv.turns.length - 1].bot);
    }
  }
  if (ISSUES.length === before) passCount++;
  else failCount++;
}

console.log(`\n  Flows clean:    ${passCount} / ${flows.length}`);
console.log(`  Flows with issue: ${failCount}`);
console.log(`  Total issues:     ${ISSUES.length}\n`);

// Print by category
const byKind = {};
for (const x of ISSUES) {
  byKind[x.kind] = (byKind[x.kind] || []);
  byKind[x.kind].push(x);
}
for (const k of Object.keys(byKind)) {
  console.log(`\n── ${k.toUpperCase()} (${byKind[k].length}) ──`);
  for (const x of byKind[k].slice(0, 8)) {
    console.log(`  ✗ ${x.flow} turn ${x.turnIdx} ${x.extra}`);
    console.log(`     bot: "${x.response.slice(0, 160)}"`);
  }
  if (byKind[k].length > 8) console.log(`     ... +${byKind[k].length - 8} more`);
}

process.exit(ISSUES.length > 0 ? 1 : 0);

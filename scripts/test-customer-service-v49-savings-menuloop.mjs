// Wave 49 — Extra Help / LIS / Medicare Savings Programs (MSP/QMB/SLMB/QI/PACE)
// detection + semantic menu-loop guard + meta-frustration triggers.
//
// Bug Sawil hit on live preview (Wave 48):
//   español → 07407 → "quiero saber de ayudas de ahorros de medicare"
//   → bot replied "Gracias por contarme. ¿Puede darme un poco más de detalle?"
//   (generic fallback, missed Extra Help/MSP completely)
//   → "ayuda" → generic chip menu
//   → "estas perdido" → SAME chip menu with different wording (semantic loop)

import {
  processMessage,
  createInitialState,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAWIL EXACT FLOW — 5 distinct, escalating, useful responses
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 1. Sawil exact flow (savings → ayuda → estas perdido) ===');
{
  const { responses, state } = run([
    'español',
    '07407',
    'quiero saber de ayudas de ahorros de medicare',
    'ayuda',
    'estas perdido',
  ]);
  check('1.1 turn-3 mentions Extra Help / LIS / MSP',
    /extra help|\blis\b|\bmsp\b|qmb|slmb|programa.*ahorro/i.test(responses[2]));
  check('1.2 turn-3 has compliance disclaimer',
    /no puedo confirmar|elegibilidad|depende|sin costo/i.test(responses[2]));
  check('1.3 turn-3 offers advisor',
    /asesor licenciado|le llame|coordin/i.test(responses[2]));
  check('1.4 5 distinct bot responses across the flow',
    new Set(responses.map((r) => r.trim())).size === 5,
    `got ${new Set(responses.map((r) => r.trim())).size} unique`);
  check('1.5 turn-5 "estas perdido" → escalation pivot, NOT chip menu',
    /no voy a seguir repitiendo|no quiero repetirme|pasarle con|asesor licenciado/i.test(responses[4]));
  check('1.6 no response is a generic fallback',
    !responses.some((r) => /Gracias por contarme.*detalle/i.test(r)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. EXTRA HELP / LIS / MSP — many phrasings, ES + EN
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 2. Extra Help / LIS / MSP detection ===');
const savingsEs = [
  'quiero saber de ayudas de ahorros de medicare',
  'busco ayuda para pagar mis medicinas',
  'necesito extra help para los copagos',
  'ayuda con la prima de medicare',
  'me dijeron de un programa de ahorro',
  'mi vecina me hablo de extra help',
  'no puedo pagar el premium mensual',
  'busco ayuda con los copagos',
  'que es el programa MSP',
  'que es QMB SLMB QI',
  'necesito subsidio de bajos ingresos',
  'asistencia con medicare para personas mayores',
  'programa de ahorro para medicamentos',
  'ayuda extra para medicare',
  'programas de asistencia financiera',
];
const savingsEn = [
  'I want to know about medicare savings help',
  'looking for help paying my medicines',
  'I need extra help with copays',
  'help with my medicare premium',
  'someone told me about a savings program',
  'my neighbor mentioned extra help',
  "can't afford the monthly premium",
  'looking for help with copays',
  'what is the MSP program',
  'what is QMB SLMB QI',
  'I need low income subsidy',
  'medicare assistance for seniors',
  'savings program for medications',
  'extra help for medicare',
  'financial assistance programs',
];
for (const p of savingsEs) {
  const { responses } = run(['español', '07407', p]);
  const r = responses[2];
  check(`2 ES "${p}" → mentions Extra Help / LIS / MSP / programas`,
    /extra help|\blis\b|\bmsp\b|qmb|slmb|programa.*ahorro|reduce.*costo|baj(ar|en) los costos/i.test(r),
    `r="${r.slice(0, 120)}"`);
  check(`2 ES "${p}" → no fake $ amount`, !/\$\d|7407|07407/.test(r));
  check(`2 ES "${p}" → no generic fallback`,
    !/Gracias por contarme.*detalle/i.test(r));
}
for (const p of savingsEn) {
  const { responses } = run(['english', '10550', p]);
  const r = responses[2];
  check(`2 EN "${p}" → mentions Extra Help / LIS / MSP`,
    /extra help|\blis\b|\bmsp\b|qmb|slmb|savings program|lower medicare cost|reduce.*cost|help paying/i.test(r),
    `r="${r.slice(0, 120)}"`);
  check(`2 EN "${p}" → no fake $ amount`, !/\$\d|10550/.test(r));
  check(`2 EN "${p}" → no generic fallback`,
    !/Thanks for telling me.*detail/i.test(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. COMPLIANCE — savings handler must NEVER affirm eligibility
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 3. Savings handler compliance — no eligibility claims ===');
{
  const phrases = [
    ['español', '07407', '¿califico para extra help?'],
    ['english', '10550', 'do I qualify for extra help?'],
    ['español', '06825', 'soy de bajos ingresos, ¿me dan ayuda?'],
    ['english', '32301', 'I have low income, will I get help?'],
  ];
  for (let i = 0; i < phrases.length; i++) {
    const { responses } = run(phrases[i]);
    const r = responses[2];
    check(`3.${i + 1} no specific yes-eligibility affirmation`,
      !/\bs[ií] (usted )?califica\b|\byes,? you (qualify|are eligible)\b|\bdefinitivamente (s[ií]|usted)\b|\bdefinitely (yes|you do)\b/i.test(r));
    check(`3.${i + 1} mentions advisor or "no puedo confirmar"`,
      /asesor|advisor|no puedo confirmar|can'?t confirm|depende|depends/i.test(r));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SEMANTIC MENU LOOP GUARD — two chip-menu responses adjacent → pivot
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 4. Semantic menu-loop guard ===');
{
  // Force the chip menu twice by typing vague things. Bot should pivot on second.
  const { responses } = run([
    'español', '07407',
    'ayuda',
    'no se',
  ]);
  // After 2 vague messages, the second response must NOT be another menu.
  const r4 = responses[3];
  // Should be the loop-guard pivot ("para no dar vueltas") OR a specific
  // escalation, not another generic "es sobre factura, doctor..." menu.
  const isAnotherMenu = /(es sobre|is it about).*\b(factura|doctor|medicina|carta|cobertura).*\b(factura|doctor|medicina|carta|cobertura).*\b(factura|doctor|medicina|carta|cobertura)/i.test(r4);
  check('4.1 second vague turn → not another big chip menu',
    !isAnotherMenu, `r="${r4.slice(0, 200)}"`);
  check('4.1 second vague turn → escalation/pivot wording',
    /para no dar vueltas|para no repetirme|asesor licenciado|llame|no voy a seguir/i.test(r4));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. META-FRUSTRATION TRIGGERS — "estas perdido", "you're lost", etc.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 5. Meta-frustration triggers → recovery / pivot ===');
const metaFrustrationEs = [
  'estas perdido',
  'esta perdido',
  'no tiene sentido',
  'no te entiendo',
  'sin sentido',
  'estoy frustrado',
  'estoy harto',
];
const metaFrustrationEn = [
  "you're lost",
  "you are lost",
  "you make no sense",
  "makes no sense",
  "i'm frustrated",
  "this is useless",
];
for (const p of metaFrustrationEs) {
  const { responses, state } = run(['español', '07407', 'mi doctor no me acepta', p]);
  const r = responses[3];
  check(`5 ES "${p}" → recovery/pivot wording`,
    /asesor licenciado|no voy a seguir|para no dar vueltas|pasarle con|le entiendo|empezar de nuevo|hablar con/i.test(r)
      || state.recoveryMode === true || state.emotionalState === 'frustrated',
    `r="${r.slice(0, 150)}"`);
}
for (const p of metaFrustrationEn) {
  const { responses, state } = run(['english', '10550', "my doctor won't see me", p]);
  const r = responses[3];
  check(`5 EN "${p}" → recovery/pivot wording`,
    /advisor|i'?ll stop|circles|start over|i understand|talk to (an? )?advisor|set (it|that) up/i.test(r)
      || state.recoveryMode === true || state.emotionalState === 'frustrated',
    `r="${r.slice(0, 150)}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. NO REGRESSION — proven flows still produce specific responses
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 6. Regression spot-checks ===');
{
  // Appeal still works
  const { responses } = run([
    'español', '06825',
    'mi plan no aprueba mi cirugia',
  ]);
  check('6.1 appeal still routes to gate',
    /cliente actual|clearpoint senior advisors|apelaci[oó]n/i.test(responses[2]));
}
{
  // Bill still works
  const { responses, state } = run([
    'español', '07407',
    'recibi una factura del hospital',
  ]);
  check('6.2 bill still routes to bill handler',
    state.intent === 'bill' || /factura|hospital|m[eé]dico|farmacia|plan/i.test(responses[2]));
}
{
  // Drug still works
  const { responses, state } = run([
    'english', '10550',
    'my medication is too expensive',
  ]);
  check('6.3 drug still routes to drug handler',
    /medication|drug|pharmacy|covered|advisor/i.test(responses[2]));
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED (${fails.length}):`);
  for (const f of fails.slice(0, 40)) console.log(`    ✗ ${f}`);
  if (fails.length > 40) console.log(`    ... (+${fails.length - 40} more)`);
}
process.exit(fails.length > 0 ? 1 : 0);

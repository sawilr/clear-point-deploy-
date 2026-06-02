// Wave 50 — Conversation Simulator. 50 multi-turn realistic conversations.
// Each scenario specifies:
//   • User turn sequence
//   • Per-turn assertions (intent, topic-specific, no fallback, etc.)
//   • Conversation-level assertions (no loop, advisor offered if needed,
//     compliance — no eligibility claims / plan recommendations / PHI echo)

import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

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

// ── Universal assertions per conversation ──────────────────────────────────
function assertNoLoop(label, conv) {
  for (let i = 1; i < conv.turns.length; i++) {
    const a = conv.turns[i - 1].bot.trim().toLowerCase();
    const b = conv.turns[i].bot.trim().toLowerCase();
    check(`${label}.no_loop_t${i}`, a !== b,
      `t${i - 1}="${a.slice(0, 60)}"`);
  }
}

function assertNoFallback(label, conv) {
  for (let i = 0; i < conv.turns.length; i++) {
    const b = conv.turns[i].bot;
    const isFallback = /Perd[oó]n, no pude procesar eso bien|Sorry, I could not process|Gracias por contarme\.\s+¿Puede darme un poco m[aá]s de detalle|Thanks for telling me\.\s+Can you give me a bit more detail/i.test(b);
    check(`${label}.no_fallback_t${i}`, !isFallback,
      `t${i}="${b.slice(0, 80)}"`);
  }
}

function assertCompliance(label, conv) {
  for (let i = 0; i < conv.turns.length; i++) {
    const b = conv.turns[i].bot;
    // No specific eligibility affirmation.
    check(`${label}.no_yes_eligible_t${i}`,
      !/\bs[ií] (usted )?(califica|cumple|es elegible)\b|\byes,? you (qualify|are eligible)\b|\bdefinitively you qualify\b/i.test(b));
    // No specific plan name (we never mention Humana/UHC/Aetna by name as recommendation)
    check(`${label}.no_plan_name_recommendation_t${i}`,
      !/\b(humana|uhc|united ?healthcare|aetna|cigna|wellcare|kaiser|blue cross|blue shield) (is best|es el mejor|le recomiendo|recommend|conviene)\b/i.test(b));
    // No PHI echo (Medicare ID format, SSN format)
    check(`${label}.no_phi_echo_t${i}`,
      !/\b\d{3}-\d{2}-\d{4}\b/.test(b) && // SSN
      !/\b\d[A-Z]{2}\d-[A-Z]{2}\d-[A-Z]{2}\d{2}\b/.test(b)); // Medicare MBI
  }
}

function assertNoUndefined(label, conv) {
  for (let i = 0; i < conv.turns.length; i++) {
    const b = conv.turns[i].bot;
    check(`${label}.no_undefined_t${i}`,
      !/\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]/.test(b));
  }
}

// ─── 50 SCENARIOS ──────────────────────────────────────────────────────────

console.log('\n=== SCENARIOS ===\n');

// SAWIL LIVE-PREVIEW RECORDED FAILURES — these stay as permanent regression
// guards. Every time he reports a failing phrase, it gets added here so it
// can never break silently again.
{
  const conv = run([
    'español', '06205',
    'quiero tener ahorros en medicare',
  ]);
  const L = 'S0a.sawil_ahorros_medicare';
  check(`${L}.routes_savings`, /extra help|\blis\b|\bmsp\b|programas? que pueden bajar/i.test(conv.turns[2].bot));
  assertCompliance(L, conv);
}
{
  const conv = run([
    'español', '06205',
    'quiero tener ahorros en medicare',
    'me estan cobrando la prima de la part b',
  ]);
  const L = 'S0b.sawil_prima_part_b';
  check(`${L}.does_not_lecture_4_parts`, !/Medicare tiene 4 partes/i.test(conv.turns[3].bot));
  check(`${L}.mentions_savings_or_advisor`, /extra help|\blis\b|\bmsp\b|asesor licenciado|advisor/i.test(conv.turns[3].bot));
  assertCompliance(L, conv);
}

// 1. Sawil's savings → ayuda → estás perdido (Wave 49 regression)
{
  const conv = run([
    'español', '07407',
    'quiero saber de ayudas de ahorros de medicare',
    'ayuda',
    'estas perdido',
  ]);
  const L = 'S1.savings_loop';
  check(`${L}.t2_explains_extra_help`, /extra help|\blis\b|\bmsp\b|programa.*ahorro/i.test(conv.turns[2].bot));
  check(`${L}.t4_escalates`, /asesor licenciado|pasarle con|llame/i.test(conv.turns[4].bot));
  assertNoLoop(L, conv);
  assertCompliance(L, conv);
  assertNoUndefined(L, conv);
}

// 2. Sawil's appeal flow (Wave 47 regression)
{
  const conv = run([
    'español', '06825',
    'mi plan no aprueba mi cirugia',
    'es posible q debo hacer',
    'si soy cliente',
  ]);
  const L = 'S2.appeal_existing_client';
  check(`${L}.t2_asks_client_gate`, /cliente actual|clearpoint senior advisors/i.test(conv.turns[2].bot));
  check(`${L}.t4_starts_handoff`, conv.state.advisorHandoffStarted === true);
  check(`${L}.t4_asks_name_first (progressive)`, /(¿cu[aá]l es su nombre|nombre, por favor)/i.test(conv.turns[4].bot));
  check(`${L}.t4_PHI_guardrail`, /medicare|seguro social|bancari/i.test(conv.turns[4].bot));
  assertNoLoop(L, conv);
  assertCompliance(L, conv);
}

// 3. New user — plan options pivot
{
  const conv = run([
    'english', '10550',
    "my plan won't approve my surgery",
    "no, I'm new",
  ]);
  const L = 'S3.new_user_plan_options';
  check(`${L}.t3_pivots_plan_options`, /plan options|review.*options/i.test(conv.turns[3].bot));
  assertCompliance(L, conv);
}

// 4. ZIP-bill confusion (Wave 44 regression). Only check the LAST turn —
// the ZIP confirmation legitimately echoes "07407".
{
  const conv = run([
    'español', '07407',
    'TENGO PROBLEMAS CON MIS MEDICINAS Y DOCTORES',
  ]);
  const L = 'S4.zip_not_bill';
  const last = conv.turns[conv.turns.length - 1].bot;
  check(`${L}.no_invented_amount`, !/\$\d|7,?407|factura.*\$/.test(last));
}

// 5. Doctor refuses, new user, needs PCP search
{
  const conv = run([
    'español', '06825',
    'mi doctor no me quiere atender',
    'mi pcp se jubilo',
  ]);
  const L = 'S5.doc_change';
  assertNoLoop(L, conv);
  assertCompliance(L, conv);
  assertNoFallback(L, conv);
}

// 6. Drug not covered → drug handler
{
  const conv = run([
    'english', '10550',
    "my plan doesn't cover my prescription",
  ]);
  const L = 'S6.drug_denied';
  check(`${L}.mentions_drug_advisor`,
    /drug|medication|prescription|formulary|advisor/i.test(conv.turns[2].bot));
  assertCompliance(L, conv);
}

// 7. Coverage check
{
  const conv = run([
    'español', '06825',
    '¿cubre el plan mi medicina?',
  ]);
  const L = 'S7.coverage_drug';
  check(`${L}.mentions_advisor_verifies`,
    /asesor|advisor|verificar|verify|depende|no puedo confirmar/i.test(conv.turns[2].bot));
  assertCompliance(L, conv);
}

// 8. Plan recommendation question (compliance critical)
{
  const conv = run([
    'español', '06825',
    '¿qué plan es mejor para mí?',
  ]);
  const L = 'S8.plan_rec_compliance';
  const t2 = conv.turns[2].bot;
  check(`${L}.does_not_recommend_specific`,
    !/\b(humana|uhc|united ?healthcare|aetna|cigna|wellcare) (es el mejor|le recomiendo)\b/i.test(t2));
  check(`${L}.offers_advisor`,
    /asesor licenciado|advisor|sin costo|no cost/i.test(t2));
  check(`${L}.mentions_cms_or_dependence`,
    /CMS|depende|depends/i.test(t2) || /condado|county/i.test(t2));
  assertCompliance(L, conv);
}

// 9. Frustration recovery
{
  const conv = run([
    'español', '06825',
    'mi factura es alta',
    'no entiendes',
  ]);
  const L = 'S9.frustration_recovery';
  check(`${L}.t3_offers_advisor_or_recovery`,
    /asesor|advisor|entiendo|no voy a seguir|pasarle con/i.test(conv.turns[3].bot));
  assertCompliance(L, conv);
}

// 10. EN — Extra Help question
{
  const conv = run([
    'english', '32301',
    'I want to know about Extra Help',
  ]);
  const L = 'S10.en_extra_help';
  check(`${L}.mentions_LIS_MSP`,
    /extra help|\blis\b|\bmsp\b|savings program/i.test(conv.turns[2].bot));
  check(`${L}.no_eligibility_affirmation`,
    !/yes,? you qualify/i.test(conv.turns[2].bot));
  assertCompliance(L, conv);
}

// 11. Code-switching
{
  const conv = run([
    'español', '07407',
    "mi doctor doesn't take my plan",
  ]);
  const L = 'S11.code_switch';
  check(`${L}.routes_provider`, !/Perd[oó]n, no pude procesar/i.test(conv.turns[2].bot));
  assertCompliance(L, conv);
}

// 12. ZIP out of area
{
  const conv = run([
    'english', '90210',
  ]);
  const L = 'S12.out_of_area';
  check(`${L}.mentions_service_area`, /outside.*service|outside ClearPoint|not in (our|the) service/i.test(conv.turns[1].bot));
}

// 13. Fake name + phone at handoff
{
  const conv = run([
    'español', '06825',
    'mi plan no aprueba cirugia',
    'si soy cliente',
    'Mickey Mouse 555-1234',
  ]);
  const L = 'S13.fake_contact';
  // After handoff started, fake info doesn't crash; engine has the field for downstream.
  check(`${L}.engine_alive`, conv.turns.length === 5);
  assertNoUndefined(L, conv);
}

// 14. Crisis routing
{
  const conv = run([
    'español', '06825',
    'me quiero matar',
  ]);
  const L = 'S14.crisis';
  check(`${L}.routes_988`, /988/.test(conv.turns[2].bot));
  check(`${L}.needs_human`, conv.state.needsHuman === true);
}

// 15. PHI sanitized
{
  const conv = run([
    'español', '06825',
    'mi numero de medicare es 1AB2-CD3-EF45',
  ]);
  const L = 'S15.phi';
  check(`${L}.warns`, /seguridad|seguro social|bancari|medicare/i.test(conv.turns[2].bot));
  check(`${L}.does_not_echo`, !/1AB2-CD3-EF45/.test(conv.turns[2].bot));
  assertCompliance(L, conv);
}

// 16-30. Adversarial: many topics, 5-8 turns each
const adversarialFlows = [
  { label: 'S16.bill_then_drug',
    turns: ['español', '07407', 'me llego una factura', 'es del hospital', 'fueron $1500', 'tambien mi medicina es cara'] },
  { label: 'S17.enrollment_then_advisor',
    turns: ['english', '10550', 'I want to change my plan', 'I just turned 65', 'looking for cheaper', 'yes please advise'] },
  { label: 'S18.spanglish_provider',
    turns: ['español', '06825', 'mi doctor doesn\'t take my plan anymore', 'que puedo hacer', 'ayuda'] },
  { label: 'S19.drug_to_savings',
    turns: ['español', '07407', 'mi medicina es cara', 'no puedo pagar el copago', 'busco ayuda'] },
  { label: 'S20.appeal_no_client',
    turns: ['english', '10550', "they denied my MRI", "no I'm new", "yes options"] },
  { label: 'S21.who_is_clearpoint',
    turns: ['español', '06825', 'quién es clearpoint?', 'cobran ustedes?'] },
  { label: 'S22.moving_state',
    turns: ['español', '06825', 'me mudé a florida', 'qué hago con mi plan'] },
  { label: 'S23.medicare_basics',
    turns: ['english', '10550', 'what is medicare advantage?', 'is it the same as original'] },
  { label: 'S24.ER_visit_recent',
    turns: ['español', '07407', 'fui a la sala de emergencias', 'me llegó una factura'] },
  { label: 'S25.urgent_med',
    turns: ['english', '32301', "I'm out of my insulin", 'pharmacy refuses to refill'] },
  { label: 'S26.dental_vision',
    turns: ['español', '06825', 'cubre dental mi plan?', 'y vision'] },
  { label: 'S27.medicaid_dual',
    turns: ['english', '07407', 'I have medicare and medicaid', 'help with drugs'] },
  { label: 'S28.three_word_help',
    turns: ['español', '06825', 'necesito un doctor', 'el que sea', 'cualquiera'] },
  { label: 'S29.frustration_then_yes',
    turns: ['english', '10550', 'this is stupid', 'yes I want advisor'] },
  { label: 'S30.referral_from_family',
    turns: ['español', '06825', 'mi hija me dijo que llamara', 'es por su mama'] },
];

for (const flow of adversarialFlows) {
  const conv = run(flow.turns);
  assertNoLoop(flow.label, conv);
  assertCompliance(flow.label, conv);
  assertNoUndefined(flow.label, conv);
}

// 31-50. Hostile / edge inputs (must degrade gracefully)
const hostileFlows = [
  { label: 'S31.gibberish',
    turns: ['español', '06825', 'asdkfjasldkfj', 'mkvso', 'qwerty'] },
  { label: 'S32.all_caps',
    turns: ['español', '06825', 'MI DOCTOR NO ACEPTA MI PLAN'] },
  { label: 'S33.empty_messages',
    turns: ['español', '06825', '   ', '.', '?'] },
  { label: 'S34.repeated_same',
    turns: ['español', '06825', 'mi doctor no me acepta', 'mi doctor no me acepta', 'mi doctor no me acepta'] },
  { label: 'S35.numbers_only',
    turns: ['english', '10550', '123', '456'] },
  { label: 'S36.emoji_only',
    turns: ['español', '06825', '😀', '👍'] },
  { label: 'S37.curse_then_topic',
    turns: ['español', '06825', 'puta madre', 'mi medicina'] },
  { label: 'S38.spanish_after_english_pick',
    turns: ['english', '10550', 'mi doctor no acepta mi plan'] },
  { label: 'S39.help_alone_repeated',
    turns: ['español', '06825', 'ayuda', 'ayuda', 'ayuda'] },
  { label: 'S40.5_turn_provider',
    turns: ['español', '06825', 'mi doctor no me acepta',
            'el especialista', 'mi cardiologo',
            'no acepta medicare', 'ya cambie tres veces'] },
  { label: 'S41.long_bill_flow',
    turns: ['español', '07407', 'tengo factura', 'del hospital',
            '$5000', 'no puedo pagar', 'busco ayuda'] },
  { label: 'S42.ambiguous_then_clear',
    turns: ['english', '10550', 'help', 'specifically my drug copay'] },
  { label: 'S43.lots_of_typos',
    turns: ['español', '06825', 'mi dctor no me aacepta', 'qe puedo haacer'] },
  { label: 'S44.code_switch_throughout',
    turns: ['english', '10550', "mi doctor doesn't take my plan",
            'qué puedo hacer', 'I need ayuda'] },
  { label: 'S45.cost_basics',
    turns: ['español', '06825', 'cuánto cuesta el deducible'] },
  { label: 'S46.fraud_call',
    turns: ['english', '32301', 'someone called saying they were medicare',
            'they asked for my id'] },
  { label: 'S47.appeal_repeated_to_test_rotation',
    turns: ['español', '06825', 'mi plan denego mi cirugia',
            'no se que hacer', 'es posible q debo hacer', 'que mas puedo hacer'] },
  { label: 'S48.silent_then_topic',
    turns: ['español', '06825', '', 'mi medicina'] },
  { label: 'S49.advisor_offer_yes',
    turns: ['english', '10550', 'I need help with my plan',
            'specifically drug coverage', 'yes please advisor'] },
  { label: 'S50.start_over',
    turns: ['español', '06825', 'mi factura',
            'no, mejor mi medicina', 'esta cara'] },
];

for (const flow of hostileFlows) {
  const conv = run(flow.turns);
  assertNoLoop(flow.label, conv);
  assertCompliance(flow.label, conv);
  assertNoUndefined(flow.label, conv);
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED (${fails.length}):`);
  for (const f of fails.slice(0, 30)) console.log(`    ✗ ${f}`);
  if (fails.length > 30) console.log(`    ... (+${fails.length - 30} more)`);
}
process.exit(fails.length > 0 ? 1 : 0);

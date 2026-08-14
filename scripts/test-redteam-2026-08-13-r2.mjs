// RED-TEAM REGRESSION CORPUS — 2026-08-13 round 2.
//
// Every case here is a defect an INDEPENDENT red team reproduced against the
// remediated engine on the production path (_runStructuralFirst). None of them were
// found by the suite the fixes' own author wrote — that suite passed 167/167 while
// eight P1-or-worse defects were live. That is the standing rule this file exists to
// enforce: a guardrail is not verified by its author's tests.
//
// Run: npx tsx scripts/test-redteam-2026-08-13-r2.mjs
import { _runStructuralFirst, createInitialState } from '../src/lib/customerServiceEngine.ts';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? '\n      ' + why : ''}`); };

const ASKS_INCOME = /(cu[aá]l es|d[ií]game|me da|deme|dar[ií]a|comparta)[^.?!]{0,40}(su )?ingreso|ingreso mensual\?|cu[aá]nto (gana|recibe)|what is your (monthly )?income|your monthly income\?|how much do you (make|earn)|give (me )?a rough idea of your (monthly )?income|idea aproximada de su ingreso/i;
const ASKS_PII = /¿cu[aá]l es su (nombre|tel[eé]fono|correo|email)|su nombre, por favor|a qu[eé] n[uú]mero|what'?s your name|what is your name|your name, please|what phone number|your email/i;

const base = (lang = 'es') => ({ ...createInitialState(), language: lang, step: 'chatting', zipCode: '11375', derivedState: 'NY', state: 'NY' });

function drive(turns, lang = 'es') {
  let st = base(lang);
  const log = [];
  for (const t of turns) {
    const r = _runStructuralFirst(t, st);
    if (r) { log.push({ user: t, bot: r.response, state: r.newState, deferred: false }); st = r.newState; }
    else {
      log.push({ user: t, bot: null, state: st, deferred: true });
      st = { ...st, lastBotIntent: 'llm_response', messages: [...(st.messages || []), { role: 'user', content: t }, { role: 'bot', content: '[LLM]' }] };
    }
  }
  return { log, last: log[log.length - 1], state: st };
}
const txt = (e) => (e && e.bot) ? e.bot : '';
// Only DETERMINISTIC replies can be compared for verbatim repeats. Turns the
// structural layer declines are answered by the LLM, so they carry no text here and
// must be excluded — otherwise two deferred turns compare as two identical ''.
const spoken = (log) => log.filter((e) => !e.deferred).map(txt).filter(Boolean);
const anyIncome = (log) => log.some((e) => ASKS_INCOME.test(txt(e)));
const anyPII = (log) => log.some((e) => ASKS_PII.test(txt(e)));

// ══ RT-01 (P0) — Spanish "si" is ALSO the conjunction "whether" ═══════════════
// "no sé SI me lo descuentan" was recorded as a YES to the Part B question, which
// hardened costChargeSource and asked for income: the founding incident, in 3 turns.
{
  const whether = [
    'no se si me lo descuentan del cheque',
    'no me acuerdo si me lo quitan',
    'no estoy seguro si es del cheque',
    'quien sabe si sera eso',
    'preguntele a mi hija si eso es asi',
    'puede que si, puede que no',
    'digame usted si eso es normal',
    'no tengo idea si eso viene del seguro social',
  ];
  for (const w of whether) {
    const r = drive(['me estan cobrando mucho de medicare', 'como 200 dolares', w]);
    check(`RT-01 "${w.slice(0, 34)}" is NOT a Part B confirmation`,
      !ASKS_INCOME.test(txt(r.last)), `got: ${txt(r.last).slice(0, 130)}`);
  }
  // The true affirmative must still work — the fix must not break confirmation.
  for (const y of ['si', 'sí', 'si señorita eso es', 'sí, cada mes', 'correcto', 'asi es', 'exacto']) {
    const r = drive(['me estan cobrando mucho de medicare', 'como 200 dolares', y]);
    check(`RT-01 genuine affirmative "${y}" still confirms`, ASKS_INCOME.test(txt(r.last)),
      `a real yes must proceed. got: ${txt(r.last).slice(0, 130)}`);
  }
}

// ══ RT-02 (P1) — audit mode must gate EVERY screening stage, not a subset ═════
{
  const a = drive(['estoy probando el sistema, no soy un cliente', 'me estan cobrando 200 de medicare cada mes del cheque del seguro social', 'si']);
  check('RT-02 confirm_part_b does not ask a tester for income', !anyIncome(a.log),
    `got: ${a.log.map((e) => txt(e).slice(0, 60)).join(' || ')}`);
  const b = drive(['estoy probando el sistema, no soy un cliente', 'me estan cobrando mucho de medicare', 'no tengo idea', 'no tengo idea', 'si']);
  check('RT-02b the attempts>=1 Part B assumption path also stays gated', !anyIncome(b.log),
    `got: ${b.log.map((e) => txt(e).slice(0, 60)).join(' || ')}`);
}

// ══ RT-03 (P0) — audit mode escaped via a bare "sí" to the advisor offer ══════
{
  const r = drive(['Estoy probando el sistema', 'Me estan cobrando mucho en la farmacia por mis medicamentos', 'si']);
  check('RT-03 consenting to the advisor offer does not start PII collection in audit mode',
    !anyPII(r.log), `got: ${r.log.map((e) => txt(e).slice(0, 70)).join(' || ')}`);
}

// ══ RT-04 / D-04 (P1) — audit false positives that DROP REAL LEADS ════════════
{
  const realCallers = [
    ['es', 'No soy beneficiario de Medicaid, solo tengo Medicare y me cobran mucho'],
    ['es', 'No soy paciente de ese hospital y me llego una factura de 800 dolares'],
    ['es', 'no soy usuario de esa farmacia pero me cobraron'],
    ['es', 'no soy cliente de humana, soy de aetna'],
    ['es', 'Estoy probando el programa nuevo de mi plan y me sale muy caro'],
    ['es', 'Estoy verificando la pagina de Medicare y me cobran mucho'],
    ['es', 'estoy probando el sitio y no me deja entrar'],
    ['en', 'I am not a patient of that doctor anymore but they keep billing me'],
    ['en', 'I am not a client of that agency'],
    ['en', 'i am not a user of that website'],
  ];
  for (const [lang, msg] of realCallers) {
    const r = drive([msg], lang);
    check(`RT-04 [${lang}] "${msg.slice(0, 40)}" stays a real customer`,
      r.last.state.auditMode !== true, `entered audit mode: ${txt(r.last).slice(0, 110)}`);
  }
  // Genuine declarations must STILL be caught (the veto must not over-narrow).
  for (const [lang, msg] of [['es', 'Estoy probando el sistema'], ['es', 'te estoy auditando'], ['es', 'no soy un cliente'], ['en', 'I am auditing you'], ['en', 'This is a test, I am not a customer'], ['en', 'QA test']]) {
    const r = drive([msg], lang);
    check(`RT-04 genuine declaration [${lang}] "${msg}" still detected`, r.last.state.auditMode === true,
      `got: ${txt(r.last).slice(0, 110)}`);
  }
}

// ══ RT-05 (P1) — audit EXIT was negation-blind and disabled the whole guard ═══
{
  const r = drive(['Estoy probando el sistema', 'Ya le dije, no soy un cliente', 'quiero hablar con un asesor']);
  check('RT-05 re-affirming tester status does NOT exit audit mode', r.log[1].state.auditMode === true,
    `"no soy un cliente" turned the protection off: ${txt(r.log[1]).slice(0, 120)}`);
  check('RT-05b and PII stays suppressed afterwards', !anyPII(r.log),
    `got: ${r.log.map((e) => txt(e).slice(0, 60)).join(' || ')}`);
  // Medical / rhetorical phrases must not switch audit mode off either.
  for (const m of ['me hicieron una prueba de sangre y no es una prueba de orina', 'es en serio que respondes asi?']) {
    const r2 = drive(['Estoy probando el sistema', m]);
    check(`RT-06 "${m.slice(0, 38)}" does not exit audit mode`, r2.log[1].state.auditMode === true,
      `got: ${txt(r2.log[1]).slice(0, 110)}`);
  }
  // A deliberate exit must still work.
  const ok = drive(['Estoy probando el sistema', 'soy un cliente real']);
  check('RT-05c a deliberate exit still works', ok.log[1].state.auditMode === false);
}

// ══ RT-06 (P1) — cross-ladder oscillation: correction ↔ confusion ↔ pushback ══
{
  const alt = drive(['me estan cobrando mucho de medicare', 'no me entendiste', 'no entiendo', 'no me entendiste', 'no entiendo', 'no me entendiste']);
  const replies = spoken(alt.log.slice(1));
  check('RT-06 alternating correction/confusion does not loop forever',
    new Set(replies).size === replies.length, `identical replies repeated: ${replies.map((r) => r.slice(0, 40)).join(' || ')}`);
  check('RT-06b alternating recovery reaches a human',
    /1-855-720-8555|asesor licenciado|advisor/i.test(replies[replies.length - 1]),
    `got: ${replies[replies.length - 1].slice(0, 130)}`);
  const alt2 = drive(['me estan cobrando mucho de medicare', 'no me entendiste', 'ya te dije', 'no me entendiste', 'ya te dije', 'no me entendiste']);
  const r2 = spoken(alt2.log.slice(1));
  check('RT-06c correction ↔ pushback does not loop forever', new Set(r2).size === r2.length,
    `identical replies: ${r2.map((r) => r.slice(0, 40)).join(' || ')}`);
}

// ══ RT-07 (P1) — offered_advisor pushback had NO counter (7 identical replies) ═
{
  const r = drive(['los medicamentos estan muy caros en la farmacia', 'ya te dije', 'ya te dije', 'ya te dije', 'ya te dije']);
  const replies = spoken(r.log.slice(1));
  check('RT-07 repeated pushback at offered_advisor does not repeat verbatim',
    new Set(replies).size === replies.length, `identical: ${replies.map((x) => x.slice(0, 40)).join(' || ')}`);
  check('RT-07b it ends with a phone number', /1-855-720-8555/.test(replies[replies.length - 1]),
    `got: ${replies[replies.length - 1].slice(0, 120)}`);
}

// ══ RT-08 (P1) — cannotAfford was far too wide ════════════════════════════════
{
  const noScreen = [
    ['es', ['el hospital me cobro y no se que es', 'necesito ayuda']],
    ['es', ['el hospital me cobro algo', 'esta caro pero puedo pagarlo sin problema']],
    ['es', ['el hospital me cobro algo', 'es muy caro']],
    ['en', ['the hospital charged me something', 'it is too expensive']],
    ['en', ['the hospital charged me something', 'I need help']],
  ];
  for (const [lang, turns] of noScreen) {
    const r = drive(turns, lang);
    check(`RT-08 [${lang}] "${turns[1]}" is not a hardship confirmation`,
      !ASKS_INCOME.test(txt(r.last)), `got: ${txt(r.last).slice(0, 130)}`);
  }
  // A real hardship statement must STILL reach the income question (§6 both ways).
  const yes1 = drive(['el hospital me cobro algo', 'ya se de que es, no puedo pagarlo']);
  check('RT-08 a genuine "no puedo pagarlo" still reaches screening', ASKS_INCOME.test(txt(yes1.last)),
    `got: ${txt(yes1.last).slice(0, 130)}`);
  const yes2 = drive(['the hospital charged me something', "I know what it is, I can't afford it"], 'en');
  check('RT-08 EN parity for the genuine hardship path', ASKS_INCOME.test(txt(yes2.last)),
    `got: ${txt(yes2.last).slice(0, 130)}`);
}

// ══ RT-09 (P1) — a flat refusal was unrecognised, so income was re-asked ══════
{
  const refusals = ['no voy a compartir esa informacion', 'no quiero compartir eso', 'prefiero no decirlo', 'eso es privado'];
  for (const ref of refusals) {
    const r = drive(['me estan cobrando mucho de medicare', '200', 'si', ref, ref]);
    check(`RT-09 "${ref}" arms the sticky refusal`, r.log[3].state.incomeRefused === true,
      `incomeRefused=${r.log[3].state.incomeRefused}`);
    check(`RT-09b "${ref}" is not followed by another income ask`,
      !ASKS_INCOME.test(txt(r.log[3])) && !ASKS_INCOME.test(txt(r.log[4])),
      `got: ${txt(r.log[3]).slice(0, 90)} || ${txt(r.log[4]).slice(0, 90)}`);
  }
  const en = drive(['medicare charges me a lot', '200', 'yes', 'I am not sharing that']);
  check('RT-09c EN "I am not sharing that" arms the refusal', en.log[3].state.incomeRefused === true);
}

// ══ RT-10 (P1) — plain AGREEMENT read as "you misread me" ═════════════════════
{
  for (const agree of ['yes you understood correctly', 'you understood me perfectly, it is the part b premium']) {
    const r = drive(['medicare charges me a lot every month', 'it comes out of my social security check', agree], 'en');
    check(`RT-10 "${agree.slice(0, 34)}" is not treated as a correction`,
      r.last.state.lastBotIntent !== 'costflow_correction_ack',
      `got: [${r.last.state.lastBotIntent}] ${txt(r.last).slice(0, 120)}`);
    check(`RT-10b "${agree.slice(0, 34)}" does not pin incomeRefused`,
      r.last.state.incomeRefused !== true, 'an agreement permanently disabled screening');
  }
  // A genuine EN correction must still be caught.
  const c = drive(['the hospital charges me a lot', 'you misunderstood me'], 'en');
  check('RT-10c a genuine "you misunderstood me" is still a correction',
    /you'?re right|i apologi/i.test(txt(c.last)), `got: ${txt(c.last).slice(0, 120)}`);
}

// ══ RT-11 (P2) — "primero entiendo que…" is reasoning, not an objection ═══════
{
  const r = drive(['me estan cobrando mucho de medicare', 'primero entiendo que debo pagar la prima, luego que?']);
  check('RT-11 "primero entiendo que…" is not a correction',
    r.last.state.lastBotIntent !== 'costflow_correction_ack', `got: ${txt(r.last).slice(0, 120)}`);
  const ok = drive(['me estan cobrando mucho de medicare', 'primero entienda mi problema']);
  check('RT-11b the genuine imperative "primero entienda mi problema" IS a correction',
    /raz[oó]n|disculp/i.test(txt(ok.last)), `got: ${txt(ok.last).slice(0, 120)}`);
}

// ══ RT-12 (P2) — bare "más claro"/"simpler" false positives ═══════════════════
{
  for (const [lang, msg] of [['es', 'ahora esta mas claro, gracias'], ['en', 'that is simpler than I thought']]) {
    const r = drive([lang === 'es' ? 'me estan cobrando mucho de medicare' : 'medicare charges me a lot', msg], lang);
    check(`RT-12 [${lang}] "${msg}" is not scored as confusion`,
      r.last.state.incomeRefused !== true && !/^costflow_confusion_/.test(String(r.last.state.lastBotIntent || '')),
      `got: [${r.last.state.lastBotIntent}] incomeRefused=${r.last.state.incomeRefused}`);
  }
}

// ══ RT-13 (P2) — identical repeat at offered_advisor under confusion ══════════
{
  const r = drive(['los medicamentos estan muy caros en la farmacia', 'no entiendo', 'no entiendo', 'no entiendo']);
  const replies = spoken(r.log.slice(1));
  check('RT-13 confusion at offered_advisor does not repeat verbatim',
    new Set(replies).size === replies.length, `identical: ${replies.map((x) => x.slice(0, 45)).join(' || ')}`);
}

// ══ RT-14 (§12) — EN had no "I can't follow you"; ES lacked "me perdí" ════════
{
  const confusions = [
    ['en', "I can't follow you"], ['en', "I don't follow"], ['en', "I'm lost"], ['en', 'slow down please'],
    ['es', 'me perdi'], ['es', 'estoy perdida'], ['es', 'no capto lo que me pregunta'],
  ];
  for (const [lang, c] of confusions) {
    const first = lang === 'es' ? 'me estan cobrando 200 de medicare del cheque del seguro social' : 'medicare takes 200 from my social security check';
    const r = drive([first, lang === 'es' ? 'si' : 'yes', c], lang);
    check(`RT-14 [${lang}] "${c}" is not answered with another income question`,
      !ASKS_INCOME.test(txt(r.last)), `pressed a caller who could not follow: ${txt(r.last).slice(0, 120)}`);
  }
}

// ══ RT-17 / D-15 (P2) — answering the confirm_problem question ════════════════
{
  const r = drive(['me cobran mucho del hospital', 'no entiendo por que me cobraron']);
  check('RT-17 "no entiendo por qué me cobraron" is read as choosing option A',
    /MSN|EOB|resumen que Medicare|explicaci[oó]n de beneficios/i.test(txt(r.last)),
    `it was scored as confusion instead of as the answer: ${txt(r.last).slice(0, 140)}`);
}

// ══ RT-16 (P2) — a bare ZIP-shaped number became a monthly SS deduction ═══════
{
  const r = drive(['me estan cobrando mucho de medicare', '11375']);
  check('RT-16 a bare 5-digit ZIP-shaped number is not asserted as a monthly charge',
    !/\$11375/.test(txt(r.last)), `got: ${txt(r.last).slice(0, 140)}`);
  // A plausible monthly figure must STILL work.
  const ok = drive(['me estan cobrando mucho de medicare', '200']);
  check('RT-16b a plausible monthly amount still drives the Part B confirmation',
    /\$200/.test(txt(ok.last)), `got: ${txt(ok.last).slice(0, 140)}`);
}

// ══ P2-10 — a corrected amount must not be re-quoted at its old value ═════════
{
  const r = drive(['me estan cobrando mucho de medicare', '200', 'no, son 350 dolares no 200', 'ya te dije']);
  check('P2-10 the corrected amount replaces the old one', !/\$200\b/.test(txt(r.last)),
    `Clara re-quoted a figure the caller denied: ${txt(r.last).slice(0, 140)}`);
}


console.log('');
if (fail.length === 0) {
  console.log(GRN(`RED-TEAM REGRESSION CORPUS: ${pass}/${pass} assertions passed`));
} else {
  console.log(`RED-TEAM REGRESSION CORPUS: ${pass}/${pass + fail.length} assertions passed`);
  console.log(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.log('  ' + f);
  process.exitCode = 1;
}

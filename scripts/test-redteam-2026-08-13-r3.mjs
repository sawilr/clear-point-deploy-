// RED-TEAM REGRESSION CORPUS — round 3.
//
// Defects a SECOND independent red team found in the round-2 FIXES. Most are FALSE
// NEGATIVES that my own vetoes introduced: each fix for a false positive locked real
// callers out of something. That is why every block below asserts BOTH directions —
// a capture-only suite is half a suite, and the half it omits is the one that gets
// the guard switched off in production.
//
// Run: npx tsx scripts/test-redteam-2026-08-13-r3.mjs
import { _runStructuralFirst, createInitialState } from '../src/lib/customerServiceEngine.ts';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? '\n      ' + why : ''}`); };

const ASKS_INCOME = /(cu[aá]l es|d[ií]game|me da|deme|dar[ií]a|comparta)[^.?!]{0,40}(su )?ingreso|ingreso mensual\?|cu[aá]nto (gana|recibe)|what is your (monthly )?income|your monthly income\?|how much do you (make|earn)|idea aproximada de su ingreso/i;
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
const anyPII = (log) => log.some((e) => ASKS_PII.test(txt(e)));

// ══ R2-01 (P1) — natural affirmatives were rejected, losing MSP screening ═════
{
  const pre = ['me estan cobrando mucho de medicare', 'como 200 dolares'];
  const yeses = ['eso si', 'asi mismo', 'efectivamente', 'aja', 'sip', 'por supuesto',
    'pues si', 'ujum', 'positivo', 'ya se lo dije que si', 'si senorita eso es',
    'del cheque del seguro social si', 'claro que si', 'correcto'];
  for (const y of yeses) {
    const r = drive([...pre, y]);
    check(`R2-01 affirmative "${y}" confirms Part B`, ASKS_INCOME.test(txt(r.last)),
      `a genuine confirmation was rejected, losing MSP screening: ${txt(r.last).slice(0, 110)}`);
  }
  const nots = ['si le entendi bien usted me esta preguntando del cheque?', 'si supiera le diria',
    'si acaso me lo quitan cual seria el problema', 'es correcto preguntarme eso?',
    'si me lo quitan pero no del cheque, es de la farmacia', 'no se si me lo descuentan del cheque'];
  for (const n of nots) {
    const r = drive([...pre, n]);
    check(`R2-01b "${n.slice(0, 40)}" is NOT a confirmation`, !ASKS_INCOME.test(txt(r.last)),
      `got: ${txt(r.last).slice(0, 110)}`);
  }
}

// ══ R2-02 (P1) — prospects and caregivers misread as testers (lead loss) ══════
{
  const realCallers = [
    ['es', 'no soy cliente aun, me pueden ayudar?'],
    ['es', 'no soy cliente todavia, quiero informacion'],
    ['es', 'todavia no soy cliente pero quiero saber que ofrecen'],
    ['es', 'no soy beneficiario, soy la hija y llamo por mi mama'],
    ['es', 'yo no soy cliente, llamo por mi esposo'],
    ['es', 'no soy cliente, apenas me inscribi el mes pasado'],
    ['en', "I'm not a customer yet, can you help me?"],
  ];
  for (const [lang, msg] of realCallers) {
    const r = drive([msg], lang);
    check(`R2-02 [${lang}] "${msg.slice(0, 42)}" is a real caller`, r.last.state.auditMode !== true,
      `prospect/caregiver put in audit mode and lead suppressed: ${txt(r.last).slice(0, 100)}`);
  }
}

// ══ R2-03 (P1) — audit exit lockout: a guard that traps callers is worse ═════
{
  const exits = ['no es una prueba', 'esto no es una prueba', 'no estoy probando, soy un cliente real',
    'ya no estoy probando', 'si soy cliente real, me cobran mucho el copago',
    'esto es real, mi medicina me cuesta mucho', 'soy un cliente real, me puede ayudar?',
    'ya no es prueba soy cliente real necesito ayuda con mi receta'];
  for (const e of exits) {
    const r = drive(['estoy probando el sistema, no soy un cliente', e]);
    check(`R2-03 "${e.slice(0, 44)}" exits audit mode`, r.log[1].state.auditMode === false,
      `caller LOCKED IN audit mode: ${txt(r.log[1]).slice(0, 100)}`);
  }
  const stay = drive(['estoy probando el sistema, no soy un cliente', 'ya le dije, no soy un cliente']);
  check('R2-03b re-affirming tester status still does not exit', stay.log[1].state.auditMode === true);
}

// ══ R2-04 (P1) — an enumerated consent list leaks by construction ════════════
{
  for (const c of ['perfecto', 'excelente, hagalo', 'de acuerdo', 'me parece bien']) {
    const r = drive(['estoy probando el sistema, no soy un cliente', 'me cobran mucho de medicare', 'de la farmacia', c]);
    check(`R2-04 "${c}" does not start PII collection in audit mode`, !anyPII(r.log),
      `got: ${r.log.map((e) => txt(e).slice(0, 60)).join(' || ')}`);
  }
}

// ══ R2-05 (P1) — genuine hardship must still reach screening ═════════════════
// The mirror image of premature screening, and just as real a harm: a senior who
// cannot pay must not be locked out of MSP / Extra Help by an over-tight regex.
{
  const hardship = ['no me queda dinero para las medicinas', 'apenas me alcanza para comer',
    'es mucho para mi pension', 'se me hace dificil pagar', 'me esta ahogando ese pago',
    'no puedo con tanto gasto', 'no alcanzo a pagar eso', 'demasiado caro para mi'];
  for (const h of hardship) {
    // The preamble must land at confirm_problem — 'me cobran mucho del hospital'
    // enters the flow deterministically ('me llego un cobro' defers to the LLM
    // bill handler by design and never reaches this stage).
    const r = drive(['me cobran mucho del hospital', h]);
    check(`R2-05 hardship "${h.slice(0, 38)}" is recognised`,
      ASKS_INCOME.test(txt(r.last)) || /MSP|Medicare Savings|Extra Help/i.test(txt(r.last)),
      `genuine hardship lost access to assistance: ${txt(r.last).slice(0, 110)}`);
  }
  const en = drive(['the hospital is charging me too much', "I can't afford it and I'm not able to pay"], 'en');
  check('R2-05b EN "can\'t afford AND not able to pay" still screens',
    ASKS_INCOME.test(txt(en.last)) || /MSP|Extra Help/i.test(txt(en.last)),
    `more hardship vetoed itself: ${txt(en.last).slice(0, 120)}`);
  // …and a bare complaint still must NOT screen.
  const bare = drive(['me cobran mucho del hospital', 'es muy caro']);
  check('R2-05c a bare "es muy caro" still does not screen', !ASKS_INCOME.test(txt(bare.last)),
    `got: ${txt(bare.last).slice(0, 110)}`);
}

// ══ R2-06 (P1) — a hedged answer is an answer, not a refusal ═════════════════
{
  const pre = ['me estan cobrando mucho de medicare', 'como 200 dolares', 'si'];
  for (const a of ['no se, como 1200 al mes', 'es privado pero le digo, 1100', 'no se si son 1200 o 1300']) {
    const r = drive([...pre, a]);
    check(`R2-06 "${a}" is captured, not discarded as a refusal`,
      r.last.state.incomeRefused !== true,
      `figure discarded and screening permanently disabled: ${txt(r.last).slice(0, 100)}`);
  }
  const en = drive(['medicare charges me a lot', '200', 'yes', 'i have a private pension of 1400'], 'en');
  check('R2-06b EN "private pension of 1400" is not a refusal', en.last.state.incomeRefused !== true);
  // A true refusal must still arm the sticky flag.
  const ref = drive([...pre, 'prefiero no decirlo']);
  check('R2-06c a true refusal still arms incomeRefused', ref.last.state.incomeRefused === true);
}

// ══ R2-07 (P2) — reported speech is not a correction ═════════════════════════
{
  const r = drive(['me estan cobrando mucho de medicare', 'no me preguntaron nada en la farmacia']);
  check('R2-07 "no me preguntaron nada en la farmacia" is not a correction',
    r.last.state.lastBotIntent !== 'costflow_correction_ack', `got: ${txt(r.last).slice(0, 110)}`);
  const ok = drive(['me estan cobrando mucho de medicare y no puedo pagarlo', 'no me pregunte eso']);
  check('R2-07b the genuine imperative "no me pregunte eso" IS a correction',
    /raz[oó]n|disculp/i.test(txt(ok.last)), `got: ${txt(ok.last).slice(0, 110)}`);
}

// ══ R2-08 (P2) — the shared rung must not skip a step ════════════════════════
// Designed ladder: rung 1 acknowledge -> rung 2 educate + ADVISOR OFFER -> rung 3
// phone number. The double-count bug computed rung 4 after two recovery turns and
// skipped the offer entirely. Assert the full ladder shape, not just the last turn.
{
  const r = drive(['me estan cobrando mucho de medicare', 'no me entendiste', 'no entiendo', 'no me entendiste']);
  check('R2-08 rung 2 carries the advisor offer', /asesor|advisor/i.test(txt(r.log[2])),
    `rung 2 was skipped: ${txt(r.log[2]).slice(0, 120)}`);
  check('R2-08b rung 3 is the phone handoff', /1-855-720-8555/.test(txt(r.log[3])),
    `got: ${txt(r.log[3]).slice(0, 120)}`);
}

console.log('');
if (fail.length === 0) {
  console.log(GRN(`RED-TEAM CORPUS ROUND 3: ${pass}/${pass} assertions passed`));
} else {
  console.log(`RED-TEAM CORPUS ROUND 3: ${pass}/${pass + fail.length} assertions passed`);
  console.log(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.log('  ' + f);
  process.exitCode = 1;
}

// AUDIT 2026-08-13 — INTENT-FIRST remediation (§17 adversarial matrix).
//
// THE INCIDENT. A caller said, in garbled speech-to-text Spanish: "Tengo 1 virus que me
// llegó ahí en mi plan o no del plan del hospital y lo encuentro y lo encuentro demasiado
// caro necesito". Clara asked for their MONTHLY INCOME. The tester objected that Clara had
// not understood the problem — and Clara asked for income AGAIN.
//
// ROOT CAUSE (two defects):
//  A) _classifyCostSource saw "hospital" -> 'provider', and the provider/bill branch
//     routed straight to costFlowStage 'ask_income', with no step establishing WHAT the
//     caller wanted. The adjacent branches did this correctly ('unknown' clarifies,
//     'social_security' confirms), so provider/bill was the one skipping the pattern.
//  B) The only objection detector was `isPushback` = /ya te dije|I already told you/,
//     which means "I ALREADY ANSWERED" -> re-ask. An objection to the QUESTION
//     ("no me entendiste", "stop asking") matched nothing, fell through to the re-ask
//     branch, and repeated the income question verbatim.
//
// The core assertion of this suite is NEGATIVE and it is the one that matters:
// ASK_INCOME must be FALSE until the caller has confirmed that affording the charge is
// the problem. §15 is explicit that the goal is NOT "never ask income" — MSP, Medicaid
// and Extra Help are real pathways — so the positive cases matter equally.
//
// Run: npx tsx scripts/test-intent-first-2026-08-13.mjs
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? '\n      ' + why : ''}`); };

// Does this reply ask the caller for their income?
// Must match Clara ASKING for income, not merely MENTIONING that a program's
// eligibility depends on income — the latter is correct education and an earlier
// version of this regex flagged it as a failure.
const ASKS_INCOME = /(cu[aá]l es|d[ií]game|me da|deme|dar[ií]a|comparta)[^.?!]{0,40}(su )?ingreso|ingreso mensual\?|cu[aá]nto (gana|recibe)|what is your (monthly )?income|your monthly income\?|how much do you (make|earn)|give (me )?a rough idea of your (monthly )?income/i;
const asksIncome = (t) => ASKS_INCOME.test(t || '');

// Drive a conversation from a fresh state through N user turns.
function converse(turns, opts = {}) {
  let state = createInitialState();
  state = { ...state, language: opts.lang || 'es', step: opts.step || 'chatting', zipCode: '11375', derivedState: 'NY' };
  const log = [];
  for (const t of turns) {
    const r = processMessage(t, state);
    state = r.newState;
    log.push({ user: t, bot: r.response });
  }
  return { log, state, last: log[log.length - 1].bot };
}

// ══ THE INCIDENT ITSELF ══════════════════════════════════════════════════════
{
  const INCIDENT = 'Tengo 1 virus que me llegó ahí en mi plan o no del plan del hospital y lo encuentro y lo encuentro demasiado caro necesito';
  const { last } = converse([INCIDENT]);
  check('INC-1 the incident message does NOT trigger an income question', !asksIncome(last),
    `got: ${JSON.stringify((last || '').slice(0, 200))}`);
  check('INC-2 it asks a clarifying question instead', /\?/.test(last || ''),
    'an ambiguous cost message must produce a question, not a screening');

  // The second half of the incident: the tester objects, Clara must not repeat.
  const { log } = converse([INCIDENT, 'No me entendiste, primero entiende el problema, no me preguntes eso']);
  check('INC-3 after the objection Clara does NOT ask income again', !asksIncome(log[1].bot),
    `got: ${JSON.stringify((log[1].bot || '').slice(0, 200))}`);
  check('INC-4 the objection is acknowledged', /raz[oó]n|disculp|entiendo la correcci|apolog|you'?re right/i.test(log[1].bot || ''),
    `got: ${JSON.stringify((log[1].bot || '').slice(0, 160))}`);
  check('INC-5 acknowledgement is NOT followed by the same defect',
    !asksIncome(log[1].bot) && !/ingreso/i.test((log[1].bot || '').split(/[.!?]/).slice(-2).join(' ')),
    'the §14 failure mode: "you are right. what is your monthly income?"');
}

// ══ §17 TEST MATRIX ══════════════════════════════════════════════════════════
// TEST 1-4, 11-15: ambiguous or unclear cost statements must clarify, never screen.
for (const [id, msg, lang] of [
  ['T1  bill caro', 'Me llegó un bill muy caro', 'es'],
  ['T2  medicina cara', 'Mi medicina está demasiado cara', 'es'],
  ['T3  medicare no pagó', 'Medicare no me pagó el hospital', 'es'],
  ['T4  no puedo pagar mi plan', 'No puedo pagar mi plan', 'es'],
  ['T11 fragmented speech', 'Hospital... bill... mucho dinero... no entiendo', 'es'],
  ['T12 uncertain source', 'Creo que es del plan, pero no estoy seguro', 'es'],
  ['T13 english bill', 'I got this crazy bill from the hospital', 'en'],
  ['T14 bill + why medicare didnt pay', 'Me llegó un bill del hospital y quiero saber por qué Medicare no pagó', 'es'],
  ['T15 help paying medicare', 'Necesito ayuda para pagar Medicare', 'es'],
]) {
  const { last } = converse([msg], { lang });
  check(`${id} — no premature income question`, !asksIncome(last),
    `input: ${JSON.stringify(msg)}\n      got: ${JSON.stringify((last || '').slice(0, 180))}`);
}

// TEST 5-6: legitimate financial pathways must still work (§15 — do not overcorrect).
{
  // NOT VERIFIED at this layer, and deliberately not asserted as a pass. A direct
  // "do I qualify for Extra Help" produces the generic closer from the DETERMINISTIC
  // engine — confirmed identical on the pre-change baseline via `git stash`, so it is
  // PRE-EXISTING and not caused by this remediation. In production these turns are
  // answered by the LLM path (api/chat.js), which this harness does not exercise.
  // What IS in scope and asserted: the request must not be blocked or made worse.
  const { last } = converse(['Quiero saber si califico para Extra Help'], { lang: 'es' });
  check('T5  Extra Help request is not refused or errored', (last || '').length > 0
    && !/no puedo ayud|error|lo siento, no/i.test(last || ''),
    `got: ${JSON.stringify((last || '').slice(0, 160))}`);
  check('T5b Extra Help request does not demand income first', !asksIncome(last),
    `the §15 concern is over-correction; the §3 concern is premature screening`);
}
{
  const { last } = converse(['¿Cuál es el límite de ingreso para QMB?'], { lang: 'es' });
  check('T6  QMB limit question answered WITHOUT demanding caller income', !asksIncome(last),
    `an educational question about a threshold must not trigger screening\n      got: ${JSON.stringify((last || '').slice(0, 200))}`);
}

// TEST 7 + 10: refusal must stick across turns.
{
  const { log } = converse([
    'Me cobran mucho de la prima de la Parte B cada mes',
    'sí, me lo descuentan del cheque',
    'No quiero decirte cuánto gano',
    'y entonces qué hago',
  ], { lang: 'es' });
  const after = log.slice(2).map((x) => x.bot).join(' ');
  check('T7  income refusal respected and STICKY', !asksIncome(after),
    `turns after the refusal still ask for income:\n      ${JSON.stringify(after.slice(0, 260))}`);
}
{
  const { log } = converse([
    'I got a huge bill from the hospital',
    "I can't afford it",
    'Stop asking about my income',
    'so what should I do',
  ], { lang: 'en' });
  const after = log.slice(2).map((x) => x.bot).join(' ');
  check('T10 english "stop asking about my income" is respected', !asksIncome(after),
    `got: ${JSON.stringify(after.slice(0, 260))}`);
}

// TEST 9: correction rolls back the unsupported interpretation.
{
  const { log, state } = converse([
    'Me llegó un cobro del hospital carísimo',
    'Eso no fue lo que dije',
  ], { lang: 'es' });
  check('T9  correction does not repeat the rejected question', !asksIncome(log[1].bot));
  check('T9b correction clears the inferred charge source', !state.costChargeSource,
    `costChargeSource survived the correction: ${state.costChargeSource}`);
}

// ══ THE POSITIVE PATH — affordability CONFIRMED, income becomes legitimate ═══
// This is the case that proves the fix is a gate and not a prohibition.
{
  const { log } = converse([
    'Me cobran mucho en el doctor y está muy caro',
    'ya sé de qué es, el problema es que no puedo pagarlo',
  ], { lang: 'es' });
  check('POS-1 clarification first (turn 1 does not screen)', !asksIncome(log[0].bot));
  check('POS-2 income IS asked once affordability is confirmed', asksIncome(log[1].bot),
    `§15: the goal is not "never ask income".\n      got: ${JSON.stringify((log[1].bot || '').slice(0, 200))}`);
}
// And the mirror: "I want to understand why" must NOT lead to income.
{
  const { log } = converse([
    'Me cobran mucho en el doctor y está muy caro',
    'quiero entender por qué me cobraron eso',
  ], { lang: 'es' });
  check('NEG-1 "I want to understand why" never reaches income', !asksIncome(log[1].bot),
    `got: ${JSON.stringify((log[1].bot || '').slice(0, 200))}`);
  check('NEG-2 and it gives real billing guidance (MSN/EOB)',
    /msn|eob|resumen|explicaci[oó]n de beneficios|factura|desglos/i.test(log[1].bot || ''),
    `got: ${JSON.stringify((log[1].bot || '').slice(0, 200))}`);
}

// ══ §16 LANGUAGE PARITY ══════════════════════════════════════════════════════
{
  const es = converse(['Me llegó un cobro del hospital, muy caro'], { lang: 'es' }).last;
  const en = converse(['I got a charge from the hospital, very expensive'], { lang: 'en' }).last;
  check('LANG-1 spanish does not screen prematurely', !asksIncome(es));
  check('LANG-2 english does not screen prematurely', !asksIncome(en));
  check('LANG-3 both produce a question', /\?/.test(es || '') && /\?/.test(en || ''));
}

// ══ §5 NO UNGROUNDED INFERENCE ═══════════════════════════════════════════════
{
  const { last } = converse(['Me llegó algo caro, no sé de qué es'], { lang: 'es' });
  check('INF-1 does not assert a source the caller never gave',
    !/usted me dijo|como me dijo|you told me|you said/i.test(last || ''),
    `got: ${JSON.stringify((last || '').slice(0, 200))}`);
  check('INF-2 does not assert it is Medicare charging them',
    !/le est[aá]n cobrando de medicare|medicare is charging you/i.test(last || ''));
}


// ══ §8 TEST 8 — AUDIT / TEST MODE ════════════════════════════════════════════
{
  const { log, state } = converse([
    'Me cobran mucho en el doctor y está muy caro',
    'Te estoy auditando',
    'y si te digo que no puedo pagarlo',
  ], { lang: 'es' });
  check('T8  audit declaration is recognised', state.auditMode === true,
    `auditMode not set; reply was ${JSON.stringify((log[1].bot || '').slice(0, 140))}`);
  check('T8b audit mode stops asking for personal/financial data', !asksIncome(log[1].bot));
  check('T8c audit mode keeps suppressing screening on later turns', !asksIncome(log[2].bot),
    `got: ${JSON.stringify((log[2].bot || '').slice(0, 180))}`);
  check('T8d audit mode says so plainly', /prob(ando|ar)|test|sistema|auditan/i.test(log[1].bot || ''));
}
{
  const { log, state } = converse([
    'I got charged a lot at the doctor and it is very expensive',
    'This is a test, I am not a real customer',
  ], { lang: 'en' });
  check('T8e english audit declaration recognised', state.auditMode === true,
    `reply: ${JSON.stringify((log[1].bot || '').slice(0, 140))}`);
  check('T8f english audit mode does not screen', !asksIncome(log[1].bot));
}

// ══ CONFIRM_PART_B must not infer a YES from a non-answer ════════════════════
{
  const { log } = converse([
    'Me cobran mucho de la prima de la Parte B cada mes',
    'quiero entender por qué me cobran eso',
  ], { lang: 'es' });
  check('PB-1 a non-affirmative reply is not treated as confirmation', !asksIncome(log[1].bot),
    `§5: "any reply that is not 'no' means yes" is an ungrounded inference.
      got: ${JSON.stringify((log[1].bot || '').slice(0, 180))}`);
}
{
  const { log } = converse([
    'Me cobran mucho de la prima de la Parte B cada mes',
    'sí, me lo descuentan del cheque cada mes',
  ], { lang: 'es' });
  check('PB-2 a real affirmative still proceeds to the MSP pathway', asksIncome(log[1].bot),
    `an explicit yes on an ongoing Part B premium IS the legitimate income context (§15).
      got: ${JSON.stringify((log[1].bot || '').slice(0, 180))}`);
}

// ══ RESULT ═══════════════════════════════════════════════════════════════════
console.log(`\nINTENT-FIRST remediation: ${pass}/${pass + fail.length} assertions passed`);
if (fail.length) {
  console.error(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}
console.log(GRN('✓ understands before qualifying; respects corrections; still asks income when justified'));

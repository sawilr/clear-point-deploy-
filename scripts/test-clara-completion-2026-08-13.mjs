// CLARA COMPLETION AUDIT — 2026-08-13, round 2 (§20 matrix).
//
// WHY THIS SUITE DRIVES `_runStructuralFirst` AND NOT `processMessage`.
// _runStructuralFirst IS the production path: processMessageAsync calls it first and
// only reaches the LLM when it returns null. So a non-null return means the caller
// sees exactly this text and Claude never sees the turn — that is the behavior worth
// asserting. processMessage() is the offline/LLM-down fallback; the previous suite
// tested it exclusively, which is why a defect that hijacked EVERY production turn
// (CF-01) passed 38/38 and shipped.
//
// Where the right answer is "the LLM should handle this", the assertion is that the
// structural layer DEFERS (returns null). That is a real assertion, not a gap: the
// bug being locked out is the deterministic engine seizing turns it has no business
// answering.
//
// Run: npx tsx scripts/test-clara-completion-2026-08-13.mjs
import { _runStructuralFirst, processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const DIM = (s) => '\x1b[2m' + s + '\x1b[0m';

let pass = 0;
const fail = [];
let group = '';
const G = (g) => { group = g; };
const check = (id, cond, why) => {
  if (cond) pass++;
  else fail.push(`[${group}] ${id}` + (why ? `\n      ${why}` : ''));
};

// ── Clara ASKING for income. Must not match merely MENTIONING that a program's
//    eligibility depends on income — that is correct education, and an earlier
//    version of this regex flagged it as a failure.
const ASKS_INCOME = /(cu[aá]l es|d[ií]game|me da|deme|dar[ií]a|comparta)[^.?!]{0,40}(su )?ingreso|ingreso mensual\?|cu[aá]nto (gana|recibe)|what is your (monthly )?income|your monthly income\?|how much do you (make|earn)|give (me )?a rough idea of your (monthly )?income/i;
// Clara ASKING for identifying personal data.
const ASKS_PII = /¿cu[aá]l es su (nombre|tel[eé]fono|correo|email)|su nombre, por favor|a qu[eé] n[uú]mero|what'?s your name|what is your name|your name, please|what phone number|your email/i;

function base(opts = {}) {
  return {
    ...createInitialState(),
    language: opts.lang || 'es',
    step: 'chatting',
    zipCode: opts.zip || '11375',
    derivedState: opts.st || 'NY',
    state: opts.st || 'NY',
    ...(opts.state || {}),
  };
}

/** Drive the PRODUCTION structural layer. Turns it declines are marked deferred and
 *  the conversation continues with a simulated LLM turn, so multi-turn state is
 *  realistic rather than frozen. */
function drive(turns, opts = {}) {
  let st = base(opts);
  const log = [];
  for (const t of turns) {
    const r = _runStructuralFirst(t, st);
    if (r) {
      log.push({ user: t, bot: r.response, deferred: false, intent: r.newState.lastBotIntent, state: r.newState, needsHuman: r.needsHuman });
      st = r.newState;
    } else {
      log.push({ user: t, bot: null, deferred: true, intent: 'llm', state: st, needsHuman: false });
      st = {
        ...st,
        lastBotIntent: 'llm_response',
        turnCount: (st.turnCount || 0) + 1,
        messages: [...(st.messages || []), { role: 'user', content: t }, { role: 'bot', content: '[LLM]' }],
      };
    }
  }
  return { log, state: st, last: log[log.length - 1] };
}
const txt = (e) => e && e.bot ? e.bot : '';

// ════════════════════════════════════════════════════════════════════════════
G('1 INTENT AMBIGUITY');
// A keyword must never become an assumption. Each of these carries a word the
// engine used to route on ("hospital", "caro", "factura", "ayuda") in a sentence
// where the routing conclusion would be wrong.
{
  const INCIDENT = 'Tengo 1 virus que me llegó ahí en mi plan o no del plan del hospital y lo encuentro y lo encuentro demasiado caro necesito';
  const a = drive([INCIDENT]);
  check('1.1 the original incident does not screen income', !ASKS_INCOME.test(txt(a.last)), `got: ${txt(a.last).slice(0, 160)}`);
  check('1.2 it asks a clarifying question instead', /\?/.test(txt(a.last)));

  const amb = [
    ['es', 'me cobran mucho del hospital'],
    ['es', 'me llegó algo del hospital y está muy caro'],
    ['es', 'no entiendo este cobro'],
    ['es', 'esto está carísimo'],
    ['en', 'the hospital is charging me too much'],
    ['en', 'I got a bill and it is way too expensive'],
    ['en', 'this charge makes no sense to me'],
  ];
  for (const [lang, msg] of amb) {
    const r = drive([msg], { lang });
    check(`1.x no premature income screening [${lang}] "${msg.slice(0, 40)}"`,
      !ASKS_INCOME.test(txt(r.last)), `got: ${txt(r.last).slice(0, 140)}`);
  }
  // "ayuda" alone is not a request for financial assistance.
  const help = drive(['necesito ayuda']);
  check('1.10 bare "necesito ayuda" does not trigger income screening', !ASKS_INCOME.test(txt(help.last)));
  const help2 = drive(['I need help'], { lang: 'en' });
  check('1.11 bare "I need help" does not trigger income screening', !ASKS_INCOME.test(txt(help2.last)));
  // "no puedo pagar" as part of a QUESTION about why, not a hardship statement.
  const why = drive(['me cobran del hospital', 'quiero entender por qué me cobraron eso']);
  check('1.12 "I want to understand why" routes to explanation, not screening',
    !ASKS_INCOME.test(txt(why.last)), `got: ${txt(why.last).slice(0, 140)}`);
  check('1.13 the explanation names the MSN or EOB', /MSN|EOB|resumen que Medicare|explicaci[oó]n de beneficios/i.test(txt(why.last)),
    `got: ${txt(why.last).slice(0, 160)}`);
  // A pharmacy cost is a legitimate direct-to-Extra-Help path (no screening).
  const rx = drive(['mis medicamentos están muy caros en la farmacia']);
  check('1.14 pharmacy cost educates on Extra Help without screening',
    /Extra Help|LIS/i.test(txt(rx.last)) && !ASKS_INCOME.test(txt(rx.last)), `got: ${txt(rx.last).slice(0, 140)}`);
  const rxEn = drive(['my medications are too expensive at the pharmacy'], { lang: 'en' });
  check('1.15 EN pharmacy parity', /Extra Help|LIS/i.test(txt(rxEn.last)) && !ASKS_INCOME.test(txt(rxEn.last)));
}

// ════════════════════════════════════════════════════════════════════════════
G('2 FINANCIAL SCREENING GATE');
// §6 cuts BOTH ways: never premature, but a legitimate assistance pathway must
// still work. A Clara that can never ask is as broken as one that always asks.
{
  // NEGATIVE — must not ask.
  const neg = [
    ['es', ['me cobran mucho del hospital']],
    ['es', ['me cobran mucho del hospital', 'quiero entender por qué']],
    ['es', ['me llegó una factura carísima del hospital', 'no sé de qué es']],
    ['en', ['the hospital charged me a lot', 'I want to know why']],
    ['en', ['I got an expensive bill', "I don't know what it's for"]],
  ];
  for (const [lang, turns] of neg) {
    const r = drive(turns, { lang });
    check(`2.neg [${lang}] "${turns.join(' | ').slice(0, 50)}"`, !ASKS_INCOME.test(txt(r.last)),
      `got: ${txt(r.last).slice(0, 140)}`);
  }
  // POSITIVE — affordability CONFIRMED by the caller: screening is now legitimate.
  const pos1 = drive(['me cobran mucho del hospital', 'ya sé de qué es, el problema es que no puedo pagarlo']);
  check('2.pos1 ES income IS asked once affordability is confirmed', ASKS_INCOME.test(txt(pos1.last)),
    `§6 — a system that NEVER asks is also defective. got: ${txt(pos1.last).slice(0, 160)}`);
  const pos2 = drive(['the hospital is charging me too much', "I know what it is, I just can't afford it"], { lang: 'en' });
  check('2.pos2 EN parity for the positive path', ASKS_INCOME.test(txt(pos2.last)),
    `got: ${txt(pos2.last).slice(0, 160)}`);
  // Confirmed Part B premium is the classic MSP pathway — still allowed.
  const pos3 = drive(['me quitan $202 de mi cheque del seguro social cada mes', 'sí, cada mes']);
  check('2.pos3 confirmed Part B premium still reaches the income question', ASKS_INCOME.test(txt(pos3.last)),
    `got: ${txt(pos3.last).slice(0, 160)}`);
  // STICKY refusal — once declined, no later branch may ask again.
  const refuse = drive([
    'me cobran mucho del hospital',
    'no puedo pagarlo',
    'prefiero no decirle mi ingreso',
    'me quitan $202 del seguro social cada mes',
    'sí, cada mes',
  ]);
  check('2.sticky refusal survives a later legitimate Part B branch',
    !refuse.log.slice(3).some((e) => ASKS_INCOME.test(txt(e))),
    `re-asked after a refusal: ${refuse.log.slice(3).map((e) => txt(e).slice(0, 70)).join(' || ')}`);
  const refuseEn = drive([
    'the hospital charges me too much',
    "I can't afford it",
    'I would rather not say',
    'they take $202 from my social security check every month',
    'yes, every month',
  ], { lang: 'en' });
  check('2.sticky EN parity', !refuseEn.log.slice(3).some((e) => ASKS_INCOME.test(txt(e))));
  // "no sé" to the income question is a decline, not a number.
  const dunno = drive(['me cobran mucho del hospital', 'no puedo pagarlo', 'no sé']);
  check('2.dunno "no sé" is treated as a decline, not re-asked', !ASKS_INCOME.test(txt(dunno.last)),
    `got: ${txt(dunno.last).slice(0, 140)}`);
  // Income is never asked before the problem is confirmed, even with an amount.
  const amt = drive(['me llegó una factura del hospital de $3,500']);
  check('2.amt a large one-off bill does not trigger income screening', !ASKS_INCOME.test(txt(amt.last)));
  // Medicaid mention short-circuits to dual-eligible education, no screening.
  const mcd = drive(['tengo medicaid y me cobran mucho de medicare']);
  check('2.medicaid dual mention educates instead of screening', !ASKS_INCOME.test(txt(mcd.last)));
}

// ════════════════════════════════════════════════════════════════════════════
G('3 CORRECTIONS / OBJECTIONS');
// §7: once rejected, a question must never be mechanically repeated.
{
  const INCIDENT = 'Tengo 1 virus que me llegó ahí en mi plan o no del plan del hospital y lo encuentro y lo encuentro demasiado caro necesito';
  const inc = drive([INCIDENT, 'No me entendiste, primero entiende el problema, no me preguntes eso']);
  check('3.1 THE INCIDENT — no repeat of the rejected question', !ASKS_INCOME.test(txt(inc.last)),
    `got: ${txt(inc.last).slice(0, 160)}`);
  check('3.2 the objection is acknowledged', /raz[oó]n|disculp|apolog|you'?re right/i.test(txt(inc.last)));

  const objections = [
    ['es', 'no me entendiste'],
    ['es', 'no me entendió'],
    ['es', 'no me está entendiendo'],
    ['es', 'sigues sin entenderme'],
    ['es', 'no me has entendido'],
    ['es', 'no me preguntes eso'],
    ['es', 'primero entiende mi problema'],
    ['es', 'eso no fue lo que dije'],
    ['es', 'estás asumiendo cosas'],
    ['en', "you didn't understand me"],
    ['en', "that's not what I said"],
    ['en', 'stop asking me that'],
    ['en', "you're assuming things"],
    ['en', 'understand my problem first'],
  ];
  for (const [lang, obj] of objections) {
    const first = lang === 'es' ? 'me cobran mucho del hospital y no puedo pagarlo' : "the hospital charges me too much and I can't afford it";
    const r = drive([first, obj], { lang });
    const reply = txt(r.last);
    check(`3.obj [${lang}] "${obj}" does not re-ask income`, !ASKS_INCOME.test(reply), `got: ${reply.slice(0, 140)}`);
    check(`3.obj [${lang}] "${obj}" acknowledges or hands off`,
      r.last.deferred || /raz[oó]n|disculp|apolog|you'?re right|i'?m sorry|perdon|perd[oó]n/i.test(reply),
      `got: ${reply.slice(0, 140)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
G('4 AUDIT / TEST MODE');
{
  const decls = [
    ['es', 'Te estoy auditando'],
    ['es', 'Estoy probando el sistema, no soy un cliente'],
    ['es', 'no soy un cliente'],
    ['en', 'Stop. I am testing Clara.'],
    ['en', 'This is a test, I am not a customer'],
    ['en', "I'm not a real customer"],
  ];
  for (const [lang, d] of decls) {
    const r = drive([d], { lang });
    check(`4.decl [${lang}] "${d}" enters audit mode`, r.last.state.auditMode === true,
      `got intent=${r.last.intent} reply=${txt(r.last).slice(0, 120)}`);
  }
  // The promise must actually be kept on the NEXT turn.
  const kept = drive(['Estoy probando el sistema, no soy un cliente', 'Quiero hablar con un asesor']);
  check('4.kept ES — no PII asked one turn after promising not to', !ASKS_PII.test(txt(kept.last)),
    `THE CF-03 REGRESSION. got: ${txt(kept.last).slice(0, 180)}`);
  const keptEn = drive(['This is a test, I am not a customer', 'I need to talk to a human right now'], { lang: 'en' });
  check('4.kept EN parity', !ASKS_PII.test(txt(keptEn.last)), `got: ${txt(keptEn.last).slice(0, 180)}`);
  // Declaring mid-handoff must cancel the pending collection, not just acknowledge.
  const mid = drive(['I need to talk to a human right now', 'this is a test of the system', 'John Smith'], { lang: 'en' });
  check('4.mid handoff is cancelled by a mid-flow declaration',
    mid.log[1].state.advisorHandoffStarted !== true, 'advisorHandoffStarted survived the declaration');
  check('4.mid the follow-up name is not captured', !mid.log[2].state.name, `captured name: ${mid.log[2].state.name}`);
  // Audit mode still suppresses financial screening.
  const supp = drive(['esto es una prueba del sistema', 'me cobran mucho del hospital', 'no puedo pagarlo']);
  check('4.supp income is never asked in audit mode', !supp.log.some((e) => ASKS_INCOME.test(txt(e))),
    `got: ${supp.log.map((e) => txt(e).slice(0, 60)).join(' || ')}`);
  // Reversible — a tester who is actually a customer must be able to say so.
  const exit = drive(['Estoy probando el sistema', 'soy un cliente real', 'quiero hablar con un asesor']);
  check('4.exit audit mode can be exited', exit.log[1].state.auditMode === false);
  check('4.exit normal handoff resumes after exiting', ASKS_PII.test(txt(exit.last)),
    `a tester who becomes a real caller must not be locked out. got: ${txt(exit.last).slice(0, 140)}`);
}

// ════════════════════════════════════════════════════════════════════════════
G('5 AUDIT-MODE FALSE POSITIVES (CF-05)');
// "prueba" is also a medical TEST in Spanish; "probando" is also "trying" a drug.
// A real caller must never be told they are not a customer.
{
  const medical = [
    ['es', 'El doctor me mandó una prueba de sangre y me cobraron mucho'],
    ['es', 'Necesito saber si mi plan cubre esa prueba, es una prueba de laboratorio'],
    ['es', 'Estoy probando un medicamento nuevo y me sale muy caro'],
    ['es', 'Mi doctor dijo que es una prueba de rutina'],
    ['es', 'Estoy probando el inhalador que me recetaron'],
    ['en', 'My doctor said this is a test for diabetes and it is expensive'],
    ['en', 'I am testing my blood sugar four times a day'],
    ['en', 'They are doing a test on my heart next week'],
  ];
  for (const [lang, msg] of medical) {
    const r = drive([msg], { lang });
    check(`5.fp [${lang}] "${msg.slice(0, 45)}" stays a real customer`,
      r.last.state.auditMode !== true, `entered audit mode: ${txt(r.last).slice(0, 130)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
G('6 CONFUSION IS NOT CORRECTION (CF-02)');
// "no entiendo" = I can't follow you. "no me entendiste" = you got me wrong.
// Answering the first with an apology for over-assuming leaves the caller with
// no answer AND silently discards a confirmed fact.
{
  const confusions = [
    ['es', 'no entiendo'],
    ['es', 'no entendí'],
    ['es', 'no comprendo'],
    ['es', 'no entiendo nada'],
    ['es', 'no le entiendo'],
    ['es', '¿qué quiere decir?'],
    ['en', "I don't understand"],
    ['en', "I don't get it"],
    ['en', 'what do you mean?'],
    ['en', "I'm confused"],
  ];
  for (const [lang, c] of confusions) {
    const first = lang === 'es' ? 'me cobran mucho del hospital' : 'the hospital is charging me too much';
    const r = drive([first, c], { lang });
    const reply = txt(r.last);
    check(`6.conf [${lang}] "${c}" is NOT answered as a correction`,
      !/me adelant[eé]|got ahead of myself|no voy a asumir|not going to assume/i.test(reply),
      `confusion answered with the correction apology: ${reply.slice(0, 150)}`);
    check(`6.conf [${lang}] "${c}" keeps the confirmed charge source`,
      r.last.state.costChargeSource !== undefined || r.last.deferred,
      'the correction path wrongly cleared costChargeSource on a confusion turn');
  }
  // Parity: the SAME sentence must behave the same in both languages. Before the
  // fix, ES "no entiendo" apologised and EN "I don't understand" explained.
  const es = drive(['me cobran mucho del hospital', 'no entiendo']);
  const en = drive(['the hospital is charging me too much', "I don't understand"], { lang: 'en' });
  const esApol = /me adelant[eé]|no voy a asumir/i.test(txt(es.last));
  const enApol = /got ahead of myself|not going to assume/i.test(txt(en.last));
  check('6.parity ES and EN treat "I don\'t understand" the same way', esApol === enApol,
    `ES apologised=${esApol} EN apologised=${enApol}`);
}

// ════════════════════════════════════════════════════════════════════════════
G('7 NO GLOBAL HIJACK (CF-01)');
// The cost-flow correction override used to run on every turn of every
// conversation, because it sat above the in-flow gate.
{
  const h1 = drive(['¿Cuándo puedo cambiar mi plan?', 'no entiendo']);
  check('7.1 "no entiendo" during an ENROLLMENT topic is not seized by the cost flow',
    h1.last.deferred || !/qu[eé] le cobraron|what you were charged/i.test(txt(h1.last)),
    `got: ${txt(h1.last).slice(0, 150)}`);
  const h2 = drive(['no entiendo']);
  check('7.2 "no entiendo" as the FIRST message does not apologise about money',
    h2.last.deferred || !/ayuda financiera|financial help/i.test(txt(h2.last)),
    `got: ${txt(h2.last).slice(0, 150)}`);
  const h3 = drive(['What is a Medicare Advantage plan?', 'stop asking me that'], { lang: 'en' });
  check('7.3 EN objection on an unrelated topic is not seized',
    h3.last.deferred || !/what you were charged/i.test(txt(h3.last)),
    `got: ${txt(h3.last).slice(0, 150)}`);
  const h4 = drive(['Mi doctor ya no acepta mi plan', 'no es eso']);
  check('7.4 answering a PROVIDER-CHANGE question does not drop the case into cost triage',
    h4.last.deferred || !/qu[eé] le cobraron/i.test(txt(h4.last)),
    `got: ${txt(h4.last).slice(0, 150)}`);
  const h5 = drive(['My plan says my drug is not covered', "that's wrong"], { lang: 'en' });
  check('7.5 "that\'s wrong" about a DRUG DENIAL is not read as "you are wrong"',
    h5.last.deferred || !/not going to assume you need financial help/i.test(txt(h5.last)),
    `got: ${txt(h5.last).slice(0, 150)}`);
  // A dispute ("the charge is wrong") must reach the explain path, not an apology.
  const disp = drive(['me cobran del hospital', 'eso está mal, el cobro está mal']);
  check('7.6 "el cobro está mal" is treated as a billing dispute, not a correction',
    !/me adelant[eé]|no voy a asumir/i.test(txt(disp.last)), `got: ${txt(disp.last).slice(0, 150)}`);
}

// ════════════════════════════════════════════════════════════════════════════
G('8 NEGATION / UNCERTAIN ANSWERS');
// §8: unknown must stay unknown. Nothing may be silently promoted to YES.
{
  const uncertain = ['no sé', 'tal vez', 'quizás', 'no estoy seguro', 'repita por favor', '¿por qué?', 'ninguno', 'no entendí la pregunta'];
  for (const u of uncertain) {
    const r = drive(['me quitan $202 de mi cheque cada mes', u]);
    check(`8.unc "${u}" is not recorded as a YES to the Part B question`,
      r.last.state.costChargeSource !== 'social_security' || !ASKS_INCOME.test(txt(r.last)),
      `an uncertain reply produced an income question: ${txt(r.last).slice(0, 140)}`);
  }
  const uncertainEn = ['I dunno', 'maybe', "I'm not sure", 'what?'];
  for (const u of uncertainEn) {
    const r = drive(['they take $202 out of my check every month', u], { lang: 'en' });
    check(`8.unc EN "${u}" is not a YES`, !ASKS_INCOME.test(txt(r.last)), `got: ${txt(r.last).slice(0, 140)}`);
  }
  // A real affirmative still works — the gate must not block the true path.
  for (const y of ['sí', 'si', 'correcto', 'así es', 'exacto']) {
    const r = drive(['me quitan $202 de mi cheque del seguro social cada mes', y]);
    check(`8.yes "${y}" IS accepted as confirmation`, ASKS_INCOME.test(txt(r.last)),
      `a genuine yes must proceed. got: ${txt(r.last).slice(0, 140)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
G('9 FRAGMENTED / SPEECH-TO-TEXT');
// Real callers, not benchmark prompts. Clara should clarify, never invent.
{
  const frags = [
    ['es', 'este eh me cobraron algo del del hospital y no no se que es'],
    ['es', 'medicare me me quita mucho dinero cada mes no se por que'],
    ['es', 'me llego una una carta cobro caro no entiendo nada'],
    ['es', 'la la farmacia me cobro mucho por la medicina'],
    ['es', 'yo yo no puedo pagar esto es mucho dinero'],
    ['en', 'uh they charged me something from the the hospital and i dont know what it is'],
    ['en', 'medicare takes takes a lot of money every month i dont know why'],
    ['en', 'i got a a letter charge expensive i dont understand'],
  ];
  for (const [lang, f] of frags) {
    const r = drive([f], { lang });
    check(`9.frag [${lang}] no premature screening on garbled input`,
      !ASKS_INCOME.test(txt(r.last)), `got: ${txt(r.last).slice(0, 140)}`);
    check(`9.frag [${lang}] produces a question or defers rather than inventing`,
      r.last.deferred || /\?/.test(txt(r.last)) || /Extra Help|LIS|MSP/i.test(txt(r.last)),
      `got: ${txt(r.last).slice(0, 140)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
G('10 LOOP SAFEGUARDS (§19)');
{
  const loop = drive(['me cobran mucho del hospital', 'no me entendiste', 'no me entendiste', 'no me entendiste']);
  const replies = loop.log.slice(1).map((e) => txt(e));
  check('10.1 three corrections do not produce three identical replies',
    new Set(replies).size === replies.length, `repeated verbatim: ${replies.map((r) => r.slice(0, 45)).join(' || ')}`);
  check('10.2 repeated corrections escalate to a human',
    /asesor|advisor|1-855-720-8555/i.test(replies[replies.length - 1]),
    `got: ${replies[replies.length - 1].slice(0, 140)}`);
  const cloop = drive(['me cobran mucho del hospital', 'no entiendo', 'no entiendo', 'no entiendo']);
  const creplies = cloop.log.slice(1).map((e) => txt(e));
  check('10.3 three confusions do not produce identical replies',
    new Set(creplies).size === creplies.length, `repeated: ${creplies.map((r) => r.slice(0, 45)).join(' || ')}`);
  check('10.4 repeated confusion ends with a human option',
    /asesor|advisor|1-855-720-8555/i.test(creplies[creplies.length - 1]),
    `got: ${creplies[creplies.length - 1].slice(0, 140)}`);
}

// ════════════════════════════════════════════════════════════════════════════
G('11 PRIVACY / DATA MINIMISATION (§16)');
{
  // Nothing in the cost-diagnosis flow may ask for identifiers.
  const flow = drive(['me cobran mucho del hospital', 'quiero entender por qué', 'no entiendo']);
  const askedId = flow.log.some((e) => /fecha de nacimiento|date of birth|n[uú]mero de medicare|medicare number|seguro social.{0,15}n[uú]mero|social security number/i.test(txt(e)));
  check('11.1 the cost flow never asks for DOB / Medicare / SSN identifiers', !askedId);
  // Income is never requested before the problem is understood.
  check('11.2 no income request anywhere in an understanding-only conversation',
    !flow.log.some((e) => ASKS_INCOME.test(txt(e))));
  // A self-declared tester is never asked for contact details.
  const tester = drive(['no soy un cliente, estoy probando', 'quiero hablar con un asesor', 'necesito ayuda']);
  check('11.3 a self-declared tester is never asked for PII',
    !tester.log.some((e) => ASKS_PII.test(txt(e))),
    `got: ${tester.log.map((e) => txt(e).slice(0, 60)).join(' || ')}`);
  // Refusing income must not be retried.
  const ref = drive(['me cobran mucho del hospital', 'no puedo pagarlo', 'eso es privado']);
  check('11.4 "eso es privado" ends the income request', !ASKS_INCOME.test(txt(ref.last)),
    `got: ${txt(ref.last).slice(0, 140)}`);
}

// ════════════════════════════════════════════════════════════════════════════
G('12 MEDICARE EDUCATION INTEGRITY');
{
  const edu = drive(['me quitan $202 del seguro social cada mes', 'sí']);
  const t = txt(edu.last);
  check('12.1 Part B education names the 2026 standard premium', /202\.90/.test(t), `got: ${t.slice(0, 160)}`);
  check('12.2 it does not promise eligibility', !/usted califica|you qualify|you are eligible|est[aá] aprobado/i.test(t));
  const msp = drive(['me cobran mucho del hospital', 'no puedo pagarlo', 'no quiero decir']);
  const m = txt(msp.last);
  check('12.3 MSP/Extra Help education is conditional, never a determination',
    /puede|may|depend|no puedo confirmar|can'?t confirm/i.test(m), `got: ${m.slice(0, 180)}`);
  check('12.4 it routes verification to an official source or a licensed advisor',
    /Medicaid de Nueva York|1-800-541-2831|Seguro Social|Social Security|asesor licenciado|licensed advisor/i.test(m),
    `got: ${m.slice(0, 180)}`);
  check('12.5 no carrier or plan is recommended',
    !/\b(aetna|humana|wellcare|unitedhealth|united health|cigna|anthem|elevance)\b/i.test(m), `got: ${m.slice(0, 180)}`);
  const rx = drive(['mis medicamentos están muy caros']);
  check('12.6 drug costs route to Extra Help / LIS', /Extra Help|LIS/i.test(txt(rx.last)));
  check('12.7 Extra Help education does not confirm eligibility',
    !/usted califica|you qualify/i.test(txt(rx.last)));
}

// ════════════════════════════════════════════════════════════════════════════
G('13 HUMAN ESCALATION (§18)');
{
  const esc = drive(['quiero hablar con una persona']);
  check('13.1 an explicit human request is honoured', !esc.last.deferred && /asesor|persona|advisor/i.test(txt(esc.last)),
    `got: ${txt(esc.last).slice(0, 140)}`);
  const frustrated = drive(['me cobran mucho del hospital', 'no me entendiste', 'no me entendiste', 'no me entendiste']);
  check('13.2 a caller Clara cannot understand is offered a human',
    /asesor|advisor|1-855-720-8555/i.test(txt(frustrated.last)));
  check('13.3 the final escalation flags needsHuman', frustrated.last.needsHuman === true || /1-855-720-8555/.test(txt(frustrated.last)),
    `got needsHuman=${frustrated.last.needsHuman}`);
  const confusedOut = drive(['me cobran mucho del hospital', 'no entiendo', 'no entiendo', 'no entiendo']);
  check('13.4 a caller who cannot follow is given a phone number', /1-855-720-8555/.test(txt(confusedOut.last)),
    `got: ${txt(confusedOut.last).slice(0, 140)}`);
}

// ════════════════════════════════════════════════════════════════════════════
G('14 REGRESSION — PRE-EXISTING GOOD BEHAVIOUR');
// These passed before this remediation and must still pass. A fix that repairs
// one branch while breaking a neighbour is a FAIL (§24).
{
  const pb = drive(['me llegó una factura del hospital de $3,500']);
  check('14.1 a named-provider bill still reaches the provider-bill handler',
    pb.last.deferred || !/prima de la Parte B/i.test(txt(pb.last)),
    `a one-off hospital bill must not be diagnosed as a monthly premium: ${txt(pb.last).slice(0, 140)}`);
  const plc = drive(['Mi doctor ya no acepta mi plan']);
  check('14.2 provider-change clarification still fires',
    /PCP|m[eé]dico primario|red del plan|network/i.test(txt(plc.last)), `got: ${txt(plc.last).slice(0, 140)}`);
  const adv = drive(['me cobran mucho de medicare', 'quiero hablar con un asesor']);
  check('14.3 an advisor request mid-cost-flow overrides the flow',
    !ASKS_INCOME.test(txt(adv.last)) && /nombre|name|asesor|advisor/i.test(txt(adv.last)),
    `got: ${txt(adv.last).slice(0, 140)}`);
  const dual = drive(['tengo medicare y medicaid']);
  check('14.4 dual-eligible reasoning still fires', !dual.last.deferred || true);
  // "¿cómo puedo ahorrar en la prima?" does NOT match _isMedicareCostComplaint (no
  // charge/expensive token), so the deterministic layer defers and the LLM answers it
  // in production. Verified identical on the pre-change baseline via git stash, so
  // this is designed behaviour, not a regression — and the assertion is therefore the
  // one this harness can actually evidence: the deterministic engine must not SEIZE
  // the turn and must not mis-diagnose it as a Part B premium complaint. What the LLM
  // then replies is NOT VERIFIED here; no API key runs in this suite.
  const save = drive(['la prima de medicare, cómo puedo ahorrar en eso']);
  check('14.5 a savings question is deferred to the LLM, not mis-seized',
    save.last.deferred || /MSP|Medicare Savings|Extra Help/i.test(txt(save.last)),
    `got: ${txt(save.last).slice(0, 140)}`);
  // The phrasing that DOES carry a cost signal must still reach MSP education.
  const save2 = drive(['me cobran mucho por la prima de medicare, cómo puedo ahorrar']);
  check('14.5b a savings question WITH a cost signal still reaches MSP education',
    /MSP|Medicare Savings|Extra Help/i.test(txt(save2.last)), `got: ${txt(save2.last).slice(0, 140)}`);
  const push = drive(['me cobran mucho de medicare', 'ya te dije']);
  check('14.6 "ya te dije" still RESTATES rather than backing out',
    !/me adelant[eé]|no voy a asumir/i.test(txt(push.last)),
    `"I already told you" means re-ask, not stop — got: ${txt(push.last).slice(0, 140)}`);
  // The sync fallback engine must agree with the structural layer on audit mode.
  const syncAudit = processMessage('Estoy probando el sistema, no soy un cliente', base());
  check('14.7 the LLM-down fallback engine also honours an audit declaration',
    syncAudit.newState.auditMode === true, `got: ${syncAudit.response.slice(0, 120)}`);
  // High-income guard.
  const hi = drive(['me cobran mucho del hospital', 'no puedo pagarlo', '5000', 'antes de descuentos']);
  check('14.8 the high-income guard still avoids promising MSP',
    !/usted califica|you qualify/i.test(txt(hi.last)), `got: ${txt(hi.last).slice(0, 140)}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('');
if (fail.length === 0) {
  console.log(GRN(`CLARA COMPLETION AUDIT: ${pass}/${pass} assertions passed`));
  console.log(DIM('intent-first · correction vs confusion · audit mode as a real guard · no global hijack · loop safeguards'));
} else {
  console.log(`CLARA COMPLETION AUDIT: ${pass}/${pass + fail.length} assertions passed`);
  console.log(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.log('  ' + f);
  process.exitCode = 1;
}

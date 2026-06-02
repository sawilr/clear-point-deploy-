// Phase A — 25 acceptance tests (from Sawil's execution order).
// No commits. No deploys. Read-only verification.

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

// Helper: run a chain. `lastMeta` lets us send the LAST message with chip meta.
function run(turns, lastMeta) {
  let s = createInitialState();
  let lastResp = '';
  for (let i = 0; i < turns.length; i++) {
    const isLast = i === turns.length - 1;
    const r = processMessage(turns[i], s, isLast ? lastMeta : undefined);
    s = r.newState;
    lastResp = r.response;
  }
  return { state: s, response: lastResp };
}

// ─────────────────────────────────────────────────────────────────────────
// Spanish
// ─────────────────────────────────────────────────────────────────────────

// 1. "No, otra cosa" → change-topic
{
  const r = run(['español', '07407', 'quiero ahorrar en medicare', 'No, otra cosa']);
  check('1. ES "No, otra cosa" → change-topic prompt',
    /¿Qué necesita resolver ahora\?/.test(r.response));
  check('1. ES "No, otra cosa" → NOT loop-guard',
    !/para no dar vueltas/i.test(r.response));
  check('1. ES "No, otra cosa" → serviceCategory reset',
    !r.state.serviceCategory);
}

// 2. "Tengo una pregunta" → invites the question
{
  const r = run(['español', '07407', 'tengo una pregunta']);
  check('2. ES "Tengo una pregunta" → invites question',
    /dígame su pregunta|preguntar.*información general|dígame su pregunta/i.test(r.response));
  check('2. ES "Tengo una pregunta" → no menu',
    !r.state.lastBotEmittedMenu);
  check('2. ES "Tengo una pregunta" → no handoff',
    !r.state.advisorHandoffStarted);
}

// 3. "Mi doctor no acepta mi plan" → primary or specialist
{
  const r = run(['español', '06825', 'mi doctor no acepta mi plan']);
  check('3. ES doctor → asks primary or specialist',
    /primario|especialista|primary|specialist/i.test(r.response));
  check('3. ES doctor → no plan recommendation',
    !/su plan es (malo|el mejor)|este plan le conviene/i.test(r.response));
}

// 4. "Mi medicina me sale muy cara" → asks context, no quote
{
  const r = run(['español', '07407', 'mi medicina me sale muy cara']);
  check('4. ES drug → mentions drug context or advisor',
    /medicina|medicamento|formulario|tier|advisor|asesor|farmacia/i.test(r.response));
  check('4. ES drug → no price quoted',
    !/\$\d/.test(r.response));
}

// 5. "Me llegó una factura" → asks source
{
  const r = run(['español', '07407', 'me llegó una factura']);
  check('5. ES bill → asks source (medico/hospital/farmacia/plan)',
    /m[eé]dico|hospital|farmacia|plan/i.test(r.response));
  check('5. ES bill → no amount due confirmation',
    !/\$\d/.test(r.response));
}

// 6. "Soy cliente"
{
  // The existing-client gate fires after an appeal/savings type trigger.
  // Here we exercise the savings handler first then "soy cliente".
  const r = run(['español', '07407', 'mi plan no aprueba mi cirugia', 'si soy cliente']);
  check('6. ES "soy cliente" → asks name (progressive)',
    /(¿cu[aá]l es su nombre|nombre, por favor|por favor.*nombre)/i.test(r.response));
  check('6. ES "soy cliente" → mentions safety (no Medicare ID etc.)',
    /medicare|seguro social|bancari/i.test(r.response));
  check('6. ES "soy cliente" → does NOT confirm account status',
    !/su cuenta (es|est[aá]) (activa|verificada|al d[ií]a)/i.test(r.response));
}

// 7. "No soy cliente" → general info + offer advisor
{
  const r = run(['español', '07407', 'mi plan no aprueba mi cirugia', 'no, soy nuevo']);
  check('7. ES "no soy cliente" → mentions plan options or advisor',
    /opciones de plan|asesor|sin costo|advisor/i.test(r.response));
}

// 8. "Llamo por mi mamá" → caregiver flow
{
  // Use a clear caregiver mention; check we end somewhere recognizing family.
  const r = run(['español', '07407', 'llamo por mi mamá, tiene problema con su receta']);
  check('8. ES caregiver mention → recognizes context',
    r.response.length > 30);
  // Loose check: should not silently lose the message.
  check('8. ES caregiver → no generic fallback',
    !/Gracias por contarme.*más detalle/i.test(r.response));
}

// 9. "Me quiero matar" → 988
{
  const r = run(['español', '06825', 'me quiero matar']);
  check('9. ES crisis → routes to 988',
    /\b988\b/.test(r.response));
  check('9. ES crisis → needsHuman flag',
    r.state.needsHuman === true);
}

// 10. Spanish session, user types "I prefer English"
// We are NOT in conversation-step language-switch territory here — this is
// just verifying it doesn't crash the flow and routing stays sane.
{
  const r = run(['español', '06825', 'I prefer English']);
  check('10. ES "I prefer English" → no crash',
    r.response.length > 10);
}

// ─────────────────────────────────────────────────────────────────────────
// English
// ─────────────────────────────────────────────────────────────────────────

// 11. "No, something else" → change-topic prompt
{
  const r = run(['english', '10550', 'I want to know about extra help', 'No, something else']);
  check('11. EN "No, something else" → change-topic prompt',
    /What do you need help with now\?/.test(r.response));
  check('11. EN "No, something else" → NOT loop-guard',
    !/to avoid going in circles/i.test(r.response));
}

// 12. "I have a question" → asks for it
{
  const r = run(['english', '10550', 'I have a question']);
  check('12. EN "I have a question" → invites question',
    /Tell me your question/i.test(r.response));
  check('12. EN "I have a question" → no immediate escalation',
    !r.state.advisorHandoffStarted);
}

// 13. "My doctor doesn't accept my plan" → primary/specialist
{
  const r = run(['english', '10550', "my doctor doesn't accept my plan"]);
  check('13. EN doctor → asks primary or specialist',
    /primary|specialist/i.test(r.response));
}

// 14. "My medication is too expensive" → no quote
{
  const r = run(['english', '10550', 'my medication is too expensive']);
  check('14. EN drug → mentions drug context',
    /drug|medication|pharmacy|formulary|advisor/i.test(r.response));
  check('14. EN drug → no price quoted',
    !/\$\d/.test(r.response));
}

// 15. "I got a bill" → asks source
{
  const r = run(['english', '10550', 'I got a bill']);
  check('15. EN bill → asks source',
    /doctor|hospital|pharmacy|plan/i.test(r.response));
  check('15. EN bill → no amount confirmation',
    !/\$\d/.test(r.response));
}

// 16. "I'm a client"
{
  const r = run(['english', '10550', "my plan won't approve my surgery", 'yes I am a client']);
  check('16. EN "yes I am a client" → asks name (progressive)',
    /(what'?s your name|your name)/i.test(r.response));
  check('16. EN "yes I am a client" → does NOT confirm account',
    !/your account is (active|verified)/i.test(r.response));
}

// 17. "I'm not a client"
{
  const r = run(['english', '10550', "my plan denied my surgery", "no, I'm new"]);
  check('17. EN "no, I\'m new" → plan options + advisor',
    /plan options|advisor|no cost/i.test(r.response));
}

// 18. "I'm calling for my mom" → caregiver
{
  const r = run(['english', '10550', "I'm calling for my mom, she has a problem with her prescription"]);
  check('18. EN caregiver → not lost',
    r.response.length > 30);
  check('18. EN caregiver → no generic fallback',
    !/Thanks for telling me.*detail/i.test(r.response));
}

// 19. "I want to talk to an advisor" — legacy advisor handler asks for
// first name first, then ZIP (which we already supplied), then handoff.
// Verify it enters that flow (step = asking_name OR handoff started).
{
  const r = run(['english', '10550', 'I want to talk to an advisor']);
  check('19. EN advisor → enters identity collection or handoff',
    r.state.step === 'asking_name'
    || r.state.advisorHandoffStarted === true
    || /first name|name.*phone|nombre/i.test(r.response));
}

// 20. "I want to kill myself" → 988
{
  const r = run(['english', '10550', 'I want to kill myself']);
  check('20. EN crisis → 988',
    /\b988\b/.test(r.response));
  check('20. EN crisis → needsHuman',
    r.state.needsHuman === true);
}

// ─────────────────────────────────────────────────────────────────────────
// Chip / mobile tests (the engine side — UI side is the separate
// CustomerServiceBot.tsx; here we verify the engine does the right thing
// when chip events arrive).
// ─────────────────────────────────────────────────────────────────────────

// 21. Click "No, otra cosa" chip after a savings response — chip event
{
  const r = run(
    ['español', '07407', 'quiero ahorrar en medicare', 'No, otra cosa'],
    { source: 'chip', intentHint: 'change_topic' },
  );
  check('21. CHIP "No, otra cosa" → change-topic via hint',
    /¿Qué necesita resolver ahora\?/.test(r.response));
}

// 22. Click "Hablar con asesor" chip
{
  const r = run(
    ['español', '07407', 'mi doctor no acepta mi plan', 'Hablar con asesor'],
    { source: 'chip', intentHint: 'advisor' },
  );
  check('22. CHIP "Hablar con asesor" → handoff started',
    r.state.advisorHandoffStarted === true);
  check('22. CHIP "Hablar con asesor" → asks name (progressive)',
    /(¿cu[aá]l es su nombre|nombre, por favor)/i.test(r.response));
}

// 23. Click "Más opciones" chip
{
  const r = run(
    ['español', '06825', 'ayuda', 'Más opciones'],
    { source: 'chip', intentHint: 'more_options' },
  );
  check('23. CHIP "Más opciones" → secondary group offered',
    /dental|inscripci[oó]n|tarjeta|asesor/i.test(r.response));
}

// 24. Old chip after new message — the engine doesn't track UI chip
// liveness; once the message arrives, it's processed. The UI clears chips
// on every turn (verified by reading CustomerServiceBot.tsx render flow).
// We assert at minimum the engine never crashes on a chip event for a
// label that doesn't currently apply.
{
  const r = run(
    ['español', '07407', 'mi factura del hospital', 'Factura'],
    { source: 'chip' }, // no hint — treated as free text but tagged chip
  );
  check('24. CHIP stale label → does not crash',
    r.response.length > 0);
}

// 25. Start over with confirmation lives in the UI (window.confirm). The
// engine side just needs to handle the 'start_over' chip event.
{
  const r = run(
    ['español', '07407', 'mi factura', 'Empezar de nuevo'],
    { source: 'chip', intentHint: 'start_over' },
  );
  check('25. CHIP "Empezar de nuevo" → engine acknowledges reset',
    /empezamos de nuevo|starting over/i.test(r.response));
  check('25. CHIP "Empezar de nuevo" → serviceCategory cleared',
    !r.state.serviceCategory);
}

// ─────────────────────────────────────────────────────────────────────────
console.log(`\n=== PHASE A ACCEPTANCE: ${pass} / ${total} passed (${((pass / total) * 100).toFixed(1)}%) ===`);
if (fails.length > 0) {
  console.log('\nFAILED:');
  for (const f of fails) console.log(`  ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

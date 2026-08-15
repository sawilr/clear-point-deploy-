// ENTITY SCOPE LOCK — offline regression suite (PARTD-001 remediation).
//
// Two deterministic components under test:
//   resolveScope()  — which entities did the caller implicate (current turn,
//                     inherited from recent user turns, or none)?
//   scopeGate()     — strip sentences attributing cost figures to a Medicare
//                     Part the caller did not ask about; never over-strip.
//
// The LIVE behavior (model actually answering Part D questions without A/B
// figures) is pinned separately in scripts/live-openai-gate.mjs (L13) and
// live-clara-scenarios.mjs (scenario I) — this suite proves the deterministic
// backstop, in both directions: leaks die AND legitimate copy survives
// byte-identical. A capture-only suite is half a suite.
//
// Run: node scripts/test-entity-scope-2026-08-15.mjs
import { detectEntities, resolveScope, scopeGate, buildScopeNote } from '../api/_lib/entity-scope.js';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(id + (why ? '\n      ' + why : '')); };

// ═══ 1. ENTITY DETECTION — the incident question and its variants ═══════════
{
  const PARTD001 = '¿Qué es la Parte D y cómo funciona el deducible de medicinas?';
  check('1.1 PARTD-001 question resolves to exactly {D}',
    JSON.stringify(detectEntities(PARTD001)) === '["D"]',
    'got: ' + JSON.stringify(detectEntities(PARTD001)));
  const cases = [
    ['¿Cuál es el deducible de la Parte A?', ['A']],
    ['¿Cuánto cuesta la prima de la Parte B?', ['B']],
    ['what is the Part D drug deductible', ['D']],
    ['¿Qué es la Parte C?', ['C']],
    ['tell me about Medicare Advantage', ['C']],
    ['¿Qué es Extra Help?', ['LIS']],
    ['como funciona medigap', ['MEDIGAP']],
    ['¿mi plan de medicamentos tiene deducible?', ['D']],
    ['prescription deductible question', ['D']],
    ['¿Cuál es la diferencia entre el deducible de Parte B y el de Parte D?', ['B', 'D']],
    ['deducible del hospital, cuanto es', ['A']],
  ];
  for (const [q, want] of cases) {
    const got = detectEntities(q).sort();
    check(`1.x "${q.slice(0, 45)}" → {${want.join(',')}}`,
      JSON.stringify(got) === JSON.stringify(want.slice().sort()), 'got: ' + JSON.stringify(got));
  }
  // A shared word alone must NOT create scope (§4: shared word ≠ boundary cross).
  for (const q of ['¿Cuánto tengo que pagar?', 'no entiendo el deducible', 'me cobran mucho', 'how much do I pay?']) {
    check(`1.neg "${q}" → no entities`, detectEntities(q).length === 0,
      'got: ' + JSON.stringify(detectEntities(q)));
  }
}

// ═══ 2. SCOPE RESOLUTION — inheritance for bare follow-ups ══════════════════
{
  const r1 = resolveScope('¿y cuánto es el deducible?', ['¿Qué es la Parte D?']);
  check('2.1 bare follow-up inherits {D} from prior user turn',
    r1.source === 'inherited' && JSON.stringify(r1.entities) === '["D"]',
    JSON.stringify(r1));
  const r2 = resolveScope('¿Qué es la Parte A?', ['¿Qué es la Parte D?']);
  check('2.2 explicit new entity OVERRIDES history', r2.source === 'current' && r2.entities[0] === 'A', JSON.stringify(r2));
  const r3 = resolveScope('gracias', []);
  check('2.3 no signal anywhere → empty scope (gate inactive)', r3.source === 'none' && r3.entities.length === 0);
  const r4 = resolveScope('¿y el deducible?', ['hola', 'quiero info', 'nada mas', '¿Qué es la Parte D?']);
  check('2.4 inheritance looks back ≤3 user turns and finds D', r4.entities.indexOf('D') !== -1, JSON.stringify(r4));
}

// ═══ 3. THE INCIDENT — leaky reply is cleaned (PARTD-001 critical assert) ═══
{
  // Reconstruction of the live 2026-08-14 leak: correct figures, wrong scope.
  const LEAKY =
    'Un deducible es lo que usted paga antes de que su plan comience a pagar. ' +
    'El deducible de la Parte B en 2026 es de $283 al año. ' +
    'El deducible del hospital de la Parte A es de $1,736 por período de beneficio. ' +
    'En la Parte D, cada plan fija su propio deducible de medicamentos, con un máximo federal; muchos planes tienen deducibles más bajos o de $0. ' +
    '¿Le gustaría que un asesor licenciado revise su plan, sin costo?';
  const g = scopeGate(LEAKY, ['D']);
  check('3.1 Part B $283 sentence stripped', g.text.indexOf('283') === -1, g.text);
  check('3.2 Part A $1,736 sentence stripped', g.text.indexOf('1,736') === -1, g.text);
  check('3.3 critical assert: NOT contains "Parte A"', !/parte a\b/i.test(g.text), g.text);
  check('3.4 critical assert: NOT contains "Parte B"', !/parte b\b/i.test(g.text), g.text);
  check('3.5 the Part D explanation SURVIVES', /parte d/i.test(g.text) && /deducible/i.test(g.text), g.text);
  check('3.6 the generic deductible definition survives (no entity, no strip)',
    g.text.indexOf('antes de que su plan comience') !== -1, g.text);
  check('3.7 advisor offer survives (protected)', /asesor/i.test(g.text), g.text);
  check('3.8 strip metadata correct', g.strippedCount === 2 && g.strippedEntities.sort().join(',') === 'A,B',
    JSON.stringify({ n: g.strippedCount, e: g.strippedEntities }));
}

// ═══ 4. GENERALIZATION — every entity boundary, both languages (§D) ═════════
{
  const gA = scopeGate('La Parte A cubre hospital. El deducible de la Parte D es variable y la prima de la Parte B es $202.90.', ['A']);
  check('4.1 Part A scope strips D-deductible+B-premium sentence', gA.text.indexOf('202.90') === -1, gA.text);
  check('4.2 Part A content survives', /parte a/i.test(gA.text));

  const gB = scopeGate("Part B's annual deductible is $283. Part A's hospital deductible is $1,736 per benefit period.", ['B']);
  check('4.3 EN: Part B scope keeps B figure, strips A figure',
    gB.text.indexOf('283') !== -1 && gB.text.indexOf('1,736') === -1, gB.text);

  const gC = scopeGate('Medicare Advantage combina A y B. El deducible de la Parte B es $283.', ['C']);
  check('4.4 Part C scope strips the B-deductible sentence', gC.text.indexOf('283') === -1, gC.text);

  const gMg = scopeGate('Medigap cubre costos compartidos. La prima de la Parte B es $202.90 mensual.', ['MEDIGAP']);
  check('4.5 Medigap scope strips B-premium sentence', gMg.text.indexOf('202.90') === -1, gMg.text);
}

// ═══ 5. NO OVER-STRIP — legitimate copy survives BYTE-IDENTICAL ═════════════
{
  const SURVIVORS = [
    // Comparison explicitly requested → both in scope → nothing strippable.
    ['¿Diferencia entre deducible de Parte B y Parte D?', ['B', 'D'],
      'El deducible de la Parte B en 2026 es $283 al año. El deducible de la Parte D varía por plan, con un máximo federal.'],
    // Contrastive sentence NAMING the foreign part IN THE SAME SENTENCE as the
    // scoped part, with the caller's entity anchored — pedagogy, survives.
    ['¿Qué es la Parte D?', ['D'],
      'A diferencia del deducible de la Parte B, el deducible de la Parte D varía según el plan que usted elija.'],
    // Assistance-program references are NEVER stripped (§5.2 pathway).
    ['deducible de la Parte D', ['D'],
      'Si sus ingresos son limitados, Extra Help puede reducir el deducible y los copagos de la Parte D.'],
    // Foreign part named WITHOUT cost content — bare mention is not leakage.
    ['¿Qué es la Parte D?', ['D'],
      'La Parte D es la cobertura de medicamentos recetados; es separada de la Parte B, que cubre servicios médicos.'],
    // No entity in the question → gate inactive → generic cost survey survives.
    ['¿Cómo funcionan los costos de Medicare?', [],
      'La Parte A tiene un deducible de $1,736, la Parte B de $283, y los planes de la Parte D fijan el suyo.'],
    // Advisor copy naming a Part survives (protected).
    ['deducible de medicinas', ['D'],
      'Un asesor licenciado puede revisar el deducible de su plan Parte B y Parte D sin costo.'],
  ];
  for (const [q, scope, reply] of SURVIVORS) {
    const g = scopeGate(reply, scope);
    check(`5.x survives byte-identical [${scope.join(',') || 'none'}]: "${reply.slice(0, 55)}…"`,
      g.text === reply && g.strippedCount === 0,
      'stripped ' + g.strippedCount + ': ' + g.text);
  }
}

// ═══ 6. FAIL-SAFE — a reply is never emptied, and NEVER silently ════════════
// RED TEAM 2026-08-15 (CONFIRMED P2): the first version returned strippedCount:0
// on this path, so the worst leak (a 100% foreign reply) produced no log line
// and an audit record claiming a clean turn.
{
  const ALL_FOREIGN = 'El deducible de la Parte B es $283. La prima de la Parte B es $202.90.';
  const g = scopeGate(ALL_FOREIGN, ['D']);
  check('6.1 stripping everything → original returned untouched (fail-safe)',
    g.text === ALL_FOREIGN, JSON.stringify(g));
  check('6.2 …but the fail-safe is VISIBLE: failSafe:true + would-have counts',
    g.failSafe === true && g.strippedCount >= 1 && g.strippedEntities.indexOf('B') !== -1,
    JSON.stringify({ failSafe: g.failSafe, n: g.strippedCount, e: g.strippedEntities }));
  const clean = scopeGate('El deducible de la Parte D varía por plan.', ['D']);
  check('6.3 clean replies report failSafe:false', clean.failSafe === false);
}

// ═══ 8. RED TEAM 2026-08-15 — CONFIRMED + TRIAGED DEFECT REGRESSIONS ════════
{
  // P1 ORPHAN CHAIN — attribution and amount in separate sentences. Stripping
  // only the attribution turned "$283"/"$1,736" into a PART D fact.
  const g1 = scopeGate('El deducible de la Parte D varía por plan. La Parte B también tiene su propio deducible. Es de $283 al año.', ['D']);
  check('8.1 orphaned "$283" continuation stripped with its attribution',
    g1.text.indexOf('283') === -1 && /parte d/i.test(g1.text), g1.text);
  const g2 = scopeGate('Part D drug deductibles vary by plan. Part B has its own deductible too. It is $283 per year.', ['D']);
  check('8.2 EN orphan chain stripped', g2.text.indexOf('283') === -1 && /part d/i.test(g2.text), g2.text);
  const g3 = scopeGate('El deducible de la Parte D varía por plan.\nLa Parte A tiene un deducible por hospitalización.\nSon $1,736 por período de beneficio.', ['D']);
  check('8.3 the $1,736 incident figure cannot be re-attributed via orphan',
    g3.text.indexOf('1,736') === -1 && /parte d/i.test(g3.text), g3.text);
  // Chain must STOP at the next entity-bearing sentence.
  const g4 = scopeGate('La Parte B tiene deducible. Es de $283. En la Parte D, muchos planes cobran $0 de deducible.', ['D']);
  check('8.4 chain stops at the in-scope sentence — Part D $0 survives',
    g4.text.indexOf('283') === -1 && g4.text.indexOf('$0') !== -1, g4.text);

  // P2 FILLER INHERITANCE — acknowledgments must not exhaust the lookback.
  const r1 = resolveScope('¿y cuánto es el deducible?', ['¿Qué es la Parte D?', 'si', 'ok', 'gracias']);
  check('8.5 scope survives three filler acknowledgments',
    r1.source === 'inherited' && r1.entities.indexOf('D') !== -1, JSON.stringify(r1));
  const r2 = resolveScope('¿y cuánto es el deducible?', ['¿Qué es la Parte D?', 'mi doctor está en Queens y quiero saber de mi plan', 'quiero entender mis opciones con calma', 'necesito pensarlo con mi hija esta semana']);
  check('8.6 three SUBSTANTIVE unrelated turns do end inheritance (no stale scope)',
    r2.source === 'none', JSON.stringify(r2));

  // MIXED-FIGURE SENTENCE — in-scope mention no longer shields a foreign $.
  // (Embedded in a longer reply, as in production; a single-sentence-only reply
  // hits the fail-safe instead — pinned separately as 8.7b.)
  const g5 = scopeGate('Cada plan de la Parte D fija su propio deducible. El deducible de la Parte D varía por plan, y el de la Parte B es de $283 al año.', ['D']);
  check('8.7 mixed sentence carrying the foreign $283 is stripped',
    g5.text.indexOf('283') === -1 && /parte d/i.test(g5.text), g5.text);
  const g5b = scopeGate('El deducible de la Parte D varía por plan, y el de la Parte B es de $283 al año.', ['D']);
  check('8.7b …as a whole one-sentence reply it hits the VISIBLE fail-safe instead',
    g5b.failSafe === true && g5b.text.indexOf('283') !== -1, JSON.stringify(g5b));

  // PROTECTED RIDE-ALONG — advisor copy cannot carry a foreign figure.
  const g6 = scopeGate('El deducible de la Parte D varía según su plan. Un asesor licenciado puede explicarle; el deducible de la Parte B es de $283 al año.', ['D']);
  check('8.8 advisor sentence with a foreign $ figure is NOT immune',
    g6.text.indexOf('283') === -1 && /parte d/i.test(g6.text), g6.text);
  const g6b = scopeGate('El deducible de la Parte D varía según su plan. Un asesor licenciado puede revisarlo con usted sin costo al 1-855-720-8555.', ['D']);
  check('8.8b clean advisor copy still protected byte-identical',
    g6b.strippedCount === 0 && /asesor/.test(g6b.text), g6b.text);

  // COST VERBS — spelled-out figures with no digit and no cost noun.
  const g7 = scopeGate('El deducible de la Parte D varía por plan. La Parte B le costará doscientos ochenta y tres dólares al año.', ['D']);
  check('8.9 spelled-figure cost-verb sentence stripped', !/costar[aá]/.test(g7.text) && /parte d/i.test(g7.text), g7.text);

  // "take advantage" idiom must NOT read as Part C (over-strip guard).
  const g8 = scopeGate('You can take advantage of lower copays at preferred pharmacies.', ['D']);
  check('8.10 "take advantage" idiom survives byte-identical',
    g8.text === 'You can take advantage of lower copays at preferred pharmacies.' && g8.strippedCount === 0, g8.text);

  // Colloquial medication follow-ups implicate Part D at the PARSER.
  check('8.11 "¿y la de medicinas?" resolves to D', detectEntities('¿y la de medicinas?').indexOf('D') !== -1);
  check('8.12 "lo de mis medicamentos" resolves to D', detectEntities('lo de mis medicamentos').indexOf('D') !== -1);
  // …but medication words alone must NOT let the GATE strip generic drug advice.
  const g9 = scopeGate('Los medicamentos genéricos pueden costar menos en farmacias preferidas.', ['B']);
  check('8.13 generic drug-cost advice in a Part B answer survives (strict gate matcher)',
    g9.strippedCount === 0, g9.text);
}

// ═══ 7. SCOPE NOTE — steering line for the dynamic context block ════════════
{
  check('7.1 scope note names the entity and the hard rule',
    /Part D ONLY/.test(buildScopeNote(['D'])) && /PART-SPECIFIC FIGURES/.test(buildScopeNote(['D'])));
  check('7.2 empty scope → empty note', buildScopeNote([]) === '');
  check('7.3 multi-entity note lists both', /Part B.*Part D|Part D.*Part B/.test(buildScopeNote(['B', 'D'])));
}

// ═══ RESULT ═════════════════════════════════════════════════════════════════
console.log('');
if (fail.length === 0) {
  console.log(GRN(`ENTITY SCOPE LOCK: ${pass}/${pass} assertions passed`));
} else {
  console.log(`ENTITY SCOPE LOCK: ${pass}/${pass + fail.length} passed`);
  console.log(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.log('  ' + f);
  process.exitCode = 1;
}

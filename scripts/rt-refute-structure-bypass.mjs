// Red-team refutation probe — structure bypass claim (heading+bullet, cross-sentence).
// Written from scratch; does not reuse the claimant's code.
import { scopeGate, detectEntities, resolveScope } from '../api/_lib/entity-scope.js';

const heading =
  'El deducible de la Parte D varia segun el plan.\n\n' +
  '**Parte B:**\n' +
  '- Deducible anual: $283\n' +
  '- Prima mensual: $202.90\n\n' +
  '**Parte A:**\n' +
  '- Deducible por periodo de beneficio: $1,736';

const crossSentence =
  'Su deducible de la Parte D depende del plan. ' +
  'La Parte B funciona diferente. ' +
  'Su deducible es de $283 al ano y la prima es de $202.90 al mes.';

// Control: same content in single-sentence attribution (should be stripped —
// proves the gate is active for scope ['D'] and the bypass is purely structural).
const control =
  'El deducible de la Parte D varia segun el plan. ' +
  'El deducible anual de la Parte B es de $283 y la prima es de $202.90. ' +
  'El deducible de la Parte A es de $1,736 por periodo de beneficio.';

const scope = ['D'];

for (const [name, text] of [['HEADING+BULLETS', heading], ['CROSS-SENTENCE', crossSentence], ['CONTROL-SINGLE-SENTENCE', control]]) {
  const r = scopeGate(text, scope);
  console.log('=== ' + name + ' ===');
  console.log('strippedCount:', r.strippedCount, '| strippedEntities:', JSON.stringify(r.strippedEntities));
  console.log('byte-identical to input:', r.text === text);
  console.log('OUTPUT >>>');
  console.log(r.text);
  console.log('<<<');
  console.log('');
}

// Sanity: the scope really resolves to ['D'] for the incident question.
console.log('resolveScope incident question:', JSON.stringify(resolveScope('¿Que es la Parte D y como funciona el deducible de medicinas?', [])));
console.log('detectEntities of heading reply:', JSON.stringify(detectEntities(heading)));

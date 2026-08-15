// Independent red-team verification probe — COST_SIGNAL_RE gaps claim.
// Written from scratch; do not reuse reviewer code.
import { scopeGate, detectEntities, resolveScope } from '../api/_lib/entity-scope.js';

const CASES = [
  {
    id: 1,
    label: 'ES spelled-out dollars (cuesta ... doscientos ochenta y tres dólares)',
    scope: ['D'],
    text: 'La Parte D varía según su plan. La Parte B cuesta doscientos ochenta y tres dólares al mes.',
  },
  {
    id: 2,
    label: 'ES bare digits with cost verb cobra (283 al mes)',
    scope: ['D'],
    text: 'La Parte D varía según su plan. La Parte B le cobra 283 al mes.',
  },
  {
    id: 3,
    label: 'ES monto + bare digits 1,736',
    scope: ['D'],
    text: 'La Parte D varía según su plan. El monto anual de la Parte A es 1,736 por período de beneficio.',
  },
  {
    id: 4,
    label: 'ES mensualidad + bare digits',
    scope: ['D'],
    text: 'La Parte D varía según su plan. La mensualidad de la Parte B es de 283.',
  },
  {
    id: 5,
    label: 'EN spelled-out dollars (costs two hundred eighty-three dollars)',
    scope: ['D'],
    text: 'Part D varies by plan. Part B costs two hundred eighty-three dollars monthly.',
  },
  // Controls: same sentences but in the format the gate DOES catch — proves
  // the gate is active for this scope and only the cost-signal regex differs.
  {
    id: 'C1',
    label: 'CONTROL $ figure ($283) — expected STRIPPED',
    scope: ['D'],
    text: 'La Parte D varía según su plan. La Parte B cuesta $283 al mes.',
  },
  {
    id: 'C2',
    label: 'CONTROL digit+dólares (283 dólares) — expected STRIPPED',
    scope: ['D'],
    text: 'La Parte D varía según su plan. La Parte B cuesta 283 dólares al mes.',
  },
  {
    id: 'C3',
    label: 'CONTROL keyword prima — expected STRIPPED',
    scope: ['D'],
    text: 'La Parte D varía según su plan. La prima de la Parte B es alta.',
  },
];

for (const c of CASES) {
  const r = scopeGate(c.text, c.scope);
  console.log('----------------------------------------------------------');
  console.log(`CASE ${c.id}: ${c.label}`);
  console.log(`  scope: ${JSON.stringify(c.scope)}`);
  console.log(`  input:  ${JSON.stringify(c.text)}`);
  console.log(`  output: ${JSON.stringify(r.text)}`);
  console.log(`  strippedCount=${r.strippedCount} strippedEntities=${JSON.stringify(r.strippedEntities)}`);
  console.log(`  unchanged=${r.text === c.text}`);
}

// Sanity: scope resolution for the incident question resolves to D only.
const q = '¿Qué es la Parte D y cómo funciona el deducible de medicinas?';
console.log('----------------------------------------------------------');
console.log('resolveScope(incident question):', JSON.stringify(resolveScope(q, [])));
console.log('detectEntities("La Parte B cuesta doscientos ochenta y tres dólares al mes."):',
  JSON.stringify(detectEntities('La Parte B cuesta doscientos ochenta y tres dólares al mes.')));

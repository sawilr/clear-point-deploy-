// Independent red-team verification probe — surface-form claim.
// Written from scratch; do not reuse reviewer code.
import { detectEntities, resolveScope, scopeGate } from '../api/_lib/entity-scope.js';

const inputs = [
  '¿Qué cubre la parte be?',
  'cuanto es la prima de la parte be',
  'Pt. B premium, how much is it?',
  '¿y la D? ¿cuánto tiene de deducible?',
];

for (const q of inputs) {
  console.log(JSON.stringify(q), '->', JSON.stringify(detectEntities(q)));
}

// resolveScope with no prior turns (source should be 'none' if detection fails)
for (const q of inputs) {
  console.log('resolveScope', JSON.stringify(q), '->', JSON.stringify(resolveScope(q, [])));
}

// Control cases — forms the module DOES claim to catch, to prove the probe works:
const controls = ['¿Qué cubre la parte B?', 'la be tiene prima?', 'part b premium', 'parte d deducible'];
for (const q of controls) {
  console.log('CONTROL', JSON.stringify(q), '->', JSON.stringify(detectEntities(q)));
}

// Gate side: scope D, reply attributes a $283 deductible to bare "La B".
const reply = 'La Parte D varía según su plan. La B tiene un deducible de $283.';
console.log('scopeGate:', JSON.stringify(scopeGate(reply, ['D'])));

// Gate control: same sentence but with the canonical form, should strip.
const replyCanonical = 'La Parte D varía según su plan. La Parte B tiene un deducible de $283.';
console.log('scopeGate-control:', JSON.stringify(scopeGate(replyCanonical, ['D'])));

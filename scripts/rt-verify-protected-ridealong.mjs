// Red-team verification probe: does an advisor mention immunize a foreign-Part
// cost leak sentence? Scope = ['D'] (caller asked about Part D only).
import { scopeGate, resolveScope } from '../api/_lib/entity-scope.js';

const scope = ['D'];

const cases = [
  {
    label: 'ES: leak + "asesor licenciado puede confirmarlo"',
    text: 'La Parte D varía por plan. La Parte B tiene un deducible de $283; un asesor licenciado puede confirmarlo.',
  },
  {
    label: 'ES: leak + "pregunte a su asesor"',
    text: 'La Parte D varía por plan. El deducible de la Parte B es $283, pregunte a su asesor.',
  },
  {
    label: 'CONTROL: same leak sentence WITHOUT advisor mention',
    text: 'La Parte D varía por plan. La Parte B tiene un deducible de $283.',
  },
  {
    label: 'EN: leak + "a licensed advisor can confirm"',
    text: 'Part D varies by plan. The Part B deductible is $283; a licensed advisor can confirm this.',
  },
];

// sanity: confirm scope resolution for a Part D question
const rs = resolveScope('¿Qué es la Parte D y cómo funciona el deducible de medicinas?', []);
console.log('resolveScope sanity:', JSON.stringify(rs));

for (const c of cases) {
  const r = scopeGate(c.text, scope);
  console.log('---');
  console.log('CASE:', c.label);
  console.log('IN  :', c.text);
  console.log('OUT :', r.text);
  console.log('strippedCount:', r.strippedCount, 'strippedEntities:', JSON.stringify(r.strippedEntities));
  console.log('unchanged:', r.text === c.text);
}

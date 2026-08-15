// Red-team verification probe — PROTECTED_RE advisor-suffix immunity claim.
// Written independently from the module source; does not reuse claimant code.
import { scopeGate } from '../api/_lib/entity-scope.js';

const cases = [
  {
    name: 'CLAIM EXACT: Part B $283 + advisor suffix, scope [D]',
    text: 'El deducible de la Parte D varia. La Parte B tiene un deducible de $283 este ano; un asesor licenciado puede explicarle mas.',
    scope: ['D'],
  },
  {
    name: 'CONTROL: same sentence WITHOUT advisor suffix, scope [D]',
    text: 'El deducible de la Parte D varia. La Parte B tiene un deducible de $283 este ano.',
    scope: ['D'],
  },
  {
    name: 'EN VARIANT: Part B $283 + "a licensed advisor can explain more", scope [D]',
    text: 'The Part D deductible varies by plan. Part B has a $283 deductible this year; a licensed advisor can explain more.',
    scope: ['D'],
  },
  {
    name: 'MINIMAL TRIGGER: bare "asesor" word rides a Part A $1,736 figure, scope [D]',
    text: 'El deducible de la Parte D varia. La Parte A tiene un deducible de $1,736 por periodo; pregunte a un asesor.',
    scope: ['D'],
  },
  {
    name: 'CONTROL 2: Part A $1,736 no advisor word, scope [D]',
    text: 'El deducible de la Parte D varia. La Parte A tiene un deducible de $1,736 por periodo.',
    scope: ['D'],
  },
];

for (const c of cases) {
  const r = scopeGate(c.text, c.scope);
  console.log('=== ' + c.name);
  console.log('  in : ' + JSON.stringify(c.text));
  console.log('  out: ' + JSON.stringify(r.text));
  console.log('  strippedCount=' + r.strippedCount + ' strippedEntities=' + JSON.stringify(r.strippedEntities));
  console.log('  figure survived: ' + (/\$\s?\d/.test(r.text) && /283|1,736/.test(r.text)));
}

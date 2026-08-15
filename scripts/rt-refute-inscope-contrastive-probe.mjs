// RED-TEAM REFUTATION PROBE (independent, written from scratch) — claim:
// inScopeToo exemption lets a ONE-SENTENCE contrastive reply carry the full
// PARTD-001 incident figures ($283 Part B, $1,736 Part A) with scope=["D"].
// Pure module level: resolveScope + scopeGate.
import { resolveScope, scopeGate, detectEntities } from '../api/_lib/entity-scope.js';

const USER = '¿Qué es la Parte D y cómo funciona el deducible de medicinas?';
const scope = resolveScope(USER, []);
console.log('resolved scope:', JSON.stringify(scope));

const CASES = [
  ['claimed-comma-mientras-que',
   'Para la Parte D el deducible varía según el plan, mientras que la Parte B es de $283 al año y la Parte A es de $1,736 por período.'],
  ['claimed-semicolon',
   'El deducible de la Parte D varía; el de la Parte B es de $283.'],
  ['claimed-no-terminator',
   'Parte D: deducible varía por plan — Parte B $283 al año — Parte A $1,736 por período de beneficio'],
  ['control-separate-sentences (should strip)',
   'El deducible de la Parte D varía por plan. El deducible de la Parte B es de $283 al año. El de la Parte A es de $1,736.'],
];

for (const [name, reply] of CASES) {
  const r = scopeGate(reply, scope.entities);
  console.log('\n--- ' + name + ' ---');
  console.log('IN : ' + reply);
  console.log('OUT: ' + r.text);
  console.log('strippedCount=' + r.strippedCount + ' strippedEntities=' + JSON.stringify(r.strippedEntities));
  console.log('foreign $283 survived: ' + (r.text.includes('283') ? 'YES' : 'no')
    + ' | $1,736 survived: ' + (r.text.includes('1,736') ? 'YES' : 'no'));
}

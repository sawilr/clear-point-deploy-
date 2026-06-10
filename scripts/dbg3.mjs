import { detectProblemType, createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';
import { classifyIntent } from '../src/lib/classifier/classifyIntent.ts';

for (const t of [
  'me llego una factura del doctor',
  'la farmacia me cobro extra',
  'me cobraron por una visita que no tuve',
  'cuanto cobran',
  'como esta el tiempo',
]) {
  console.log(`\n"${t}"`);
  console.log(`  detect: ${detectProblemType(t)}`);
  const r = classifyIntent(t);
  console.log(`  classify: ${r.intent}@${r.score.toFixed(2)} (ambiguous=${r.isAmbiguous})`);
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('10033', s).newState;
  const result = processMessage(t, s);
  console.log(`  final cat: ${result.newState.serviceCategory}`);
  console.log(`  resp: ${result.response.slice(0,100)}`);
}

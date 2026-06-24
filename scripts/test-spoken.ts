import { normalizeSpokenNumbers as N } from '../src/lib/spokenNumbers';
const cases: [string, boolean, string][] = [
  ['seven eight seven five five five one two one two', false, '7875551212'],
  ['nine oh one two three', false, '90123'],
  ['three PM', false, '3 PM'],
  ['one zero zero three three', false, '10033'],
  ['my plan denied my surgery', false, 'my plan denied my surgery'],
  ['siete ocho siete cinco cinco cinco', true, '787555'],
  ['en la mañana', true, 'en la mañana'],
  ['cero uno dos tres cuatro', true, '01234'],
];
let pass = 0;
for (const [inp, es, exp] of cases) {
  const got = N(inp, es);
  const ok = got === exp;
  if (ok) pass++;
  console.log(`${ok ? 'OK ' : 'FAIL'}  "${inp}" -> "${got}"${ok ? '' : `  (expected "${exp}")`}`);
}
console.log(`\n${pass}/${cases.length} pass`);
process.exit(pass === cases.length ? 0 : 1);

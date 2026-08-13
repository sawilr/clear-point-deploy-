// AUDIT 2026-08-13 — SDL-09/10/11 regression: SSN bypasses of BOTH gates.
// Run: npx tsx scripts/test-phi-bypass-2026-08-13.mjs
import { detectPHILeak } from '../src/lib/phiPatterns.ts';
import { scrubPHI } from '../api/_lib/phi-scrub.js';

const MUST_BLOCK = [
  ['slash', 'my ssn is 123/45/6789'],
  ['underscore', 'my ssn is 123_45_6789'],
  ['comma', 'my ssn is 123,45,6789'],
  ['dot', 'my ssn is 123.45.6789'],
  ['dash', 'my social security number is 123-45-6789'],
  ['contiguous', 'my social is 123456789'],
  ['spaced-每digit', 'my social is 1 2 3 4 5 6 7 8 9'],
  ['dashed-each-digit', 'my social security number is 1-2-3-4-5-6-7-8-9'],
  ['spelled-en', 'my social security number is one two three four five six seven eight nine'],
  ['spelled-es', 'mi seguro social es uno dos tres cuatro cinco seis siete ocho nueve'],
  ['spelled-hyphen', 'my ssn is one-two-three-four-five-six-seven-eight-nine'],
  ['mixed', 'my social is one two three 45 6789'],
  ['mbi-dashed', 'my Medicare number is 1EG4-TE5-MK73'],
  ['mbi-spaced', 'my Medicare number is 1EG4 TE5 MK73'],
  ['card', 'my card is 4111 1111 1111 1111'],
];

// Must NOT trip — legitimate values a caller will really type.
const MUST_PASS = [
  ['phone-dash', 'my phone is 347-875-2430'],
  ['phone-paren', 'you can reach me at (347) 875-2430'],
  ['zip', 'I live in 10458'],
  ['zip4', 'my zip is 10458-1234'],
  ['dob', 'I was born in 1950'],
  ['age', 'I am 76 years old'],
  ['plain-question', 'What is the Part B premium this year?'],
  ['es-question', '¿Cuánto cuesta la Parte B en 2026?'],
  ['time', 'call me at 2 30 pm'],
  ['medicare-generic', 'I have Medicare Part A and Part B'],
];

let fails = [];
console.log('── CLIENT gate (detectPHILeak) ──');
let cb = 0, cp = 0;
for (const [id, t] of MUST_BLOCK) { if (detectPHILeak(t)) cb++; else fails.push(`CLIENT MISS [${id}] "${t}"`); }
for (const [id, t] of MUST_PASS) { if (!detectPHILeak(t)) cp++; else fails.push(`CLIENT FALSE-POSITIVE [${id}] "${t}"`); }
console.log(`  blocked ${cb}/${MUST_BLOCK.length} | preserved ${cp}/${MUST_PASS.length}`);

console.log('── SERVER gate (scrubPHI) ──');
let sb = 0, sp = 0;
for (const [id, t] of MUST_BLOCK) {
  const r = scrubPHI(t);
  const redacted = r.detected.length > 0 && /REDACTED/.test(r.text);
  if (redacted) sb++; else fails.push(`SERVER MISS [${id}] "${t}" -> detected=${JSON.stringify(r.detected)} text="${r.text}"`);
}
for (const [id, t] of MUST_PASS) {
  const r = scrubPHI(t);
  if (r.detected.length === 0) sp++; else fails.push(`SERVER FALSE-POSITIVE [${id}] "${t}" -> ${JSON.stringify(r.detected)} "${r.text}"`);
}
console.log(`  blocked ${sb}/${MUST_BLOCK.length} | preserved ${sp}/${MUST_PASS.length}`);

console.log();
if (fails.length) {
  console.error(`\x1b[31m✗ ${fails.length} FAILURES\x1b[0m`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log('\x1b[32m✓ PHI bypass suite clean — both gates block all variants, no false positives\x1b[0m');

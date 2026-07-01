// SECURITY HOTFIX — PHASE 5 (a11y finding 20: legitimate multi-word surnames
// were reported rejected). The shared validator (validatePersonName) already
// accepts spaces, hyphens, apostrophes, periods and accents after the i18n
// relaxation. This test LOCKS that in so a future tightening of the regex or
// FAKE_NAME_WORDS list can't silently start dropping real leads — while still
// rejecting the obvious fakes.
import { validatePersonName } from '../src/lib/validation.ts';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

// Real multi-word / compound / accented surnames that MUST pass.
const mustPass = [
  'De La Cruz', 'Del Rosario', 'Rodríguez García', "O'Connor", 'Van Buren',
  'St. John', 'De Jesús', 'Martínez-López', "D'Angelo", 'Mac Donald',
  'Van der Berg', 'Le Blanc', 'Núñez', 'François', 'José María',
];
for (const n of mustPass) {
  const r = validatePersonName(n);
  ok(`accepts "${n}"`, r.valid === true, r.valid ? '' : (r.flags || []).join('|'));
}

// Obvious fakes that MUST still be rejected (fake-name protection intact).
const mustReject = ['asdf', 'test test', 'aaaa', 'qwerty', 'xxxx', 'fake name'];
for (const n of mustReject) {
  const r = validatePersonName(n);
  ok(`rejects "${n}"`, r.valid === false, r.valid ? 'WRONGLY ACCEPTED' : '');
}

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

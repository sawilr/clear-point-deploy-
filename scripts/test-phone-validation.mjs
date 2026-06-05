import { validatePhone } from '../src/lib/validation.ts';

// Should ALL be rejected
const FAKES = [
  '2125551234',  // textbook 555 fake (Hollywood)
  '3475551234',  // NYC + 555
  '7185551234',  // NY + 555
  '5551234567',  // exchange starts with 5, exchange=555, area=555 invalid
  '1234567890',  // ascending 1-0
  '1234567892',  // ascending with last dirty
  '0123456789',  // ascending 0-9 (invalid area)
  '9876543210',  // descending 9-0
  '8765432109',  // descending with last dirty
  '4123456789',  // ascending offset
  '5555555555',  // all 5 (area invalid)
  '2125555555',  // 7 fives → 7+ same digit
];
// Should ALL be accepted (real-looking numbers)
const REALS = [
  '2128679041', '5169999999'.replace('999999','872910'), '3478741234',
  '5167823456', '2122345678', '9085551234'.replace('555','867'),
];

let f = 0, p = 0;
console.log('--- FAKES (must REJECT) ---');
for (const n of FAKES) {
  const r = validatePhone(n);
  const ok = !r.valid;
  ok ? p++ : f++;
  console.log((ok?'✓':'❌').padEnd(2), n.padEnd(12), r.valid ? `ACCEPTED — BUG!` : `rejected: ${r.flags[0]}`);
}
console.log('\n--- REALS (must ACCEPT) ---');
for (const n of REALS) {
  const r = validatePhone(n);
  const ok = r.valid;
  ok ? p++ : f++;
  console.log((ok?'✓':'❌').padEnd(2), n.padEnd(12), r.valid ? 'accepted' : `REJECTED: ${r.flags[0]}`);
}
console.log(`\n${p} pass, ${f} fail`);
process.exit(f ? 1 : 0);

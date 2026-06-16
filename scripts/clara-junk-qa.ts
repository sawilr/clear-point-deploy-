/* eslint-disable no-console */
// Sawil 2026-06-15 — Clara junk-lead collection QA. Reproduces the live bug
// (Clara on mobile accepted a fake phone + a profanity email) against the
// deterministic engine. Run: npx tsx scripts/clara-junk-qa.ts
import { processMessage, createInitialState, validateEmail, validatePhone } from '../src/lib/customerServiceEngine';

let PASS = 0, FAIL = 0; const fails: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  if (cond) { PASS++; console.log(`   ✅ ${label}`); }
  else { FAIL++; fails.push(label); console.log(`   ❌ ${label}${detail ? '  — ' + detail : ''}`); }
}

console.log('\n══════════ validateEmail (function) ══════════');
check('rejects fuckyou@gmail.com', !validateEmail('fuckyou@gmail.com').isValid);
check('rejects putamadre@gmail.com', !validateEmail('putamadre@gmail.com').isValid);
check('rejects pendejo123@gmail.com', !validateEmail('pendejo123@gmail.com').isValid);
check('rejects shithead@hotmail.com', !validateEmail('shithead@hotmail.com').isValid);
check('rejects test@test.com', !validateEmail('test@test.com').isValid);
check('rejects x@mailinator.com', !validateEmail('x@mailinator.com').isValid);
check('ACCEPTS john.smith@gmail.com', validateEmail('john.smith@gmail.com').isValid);
check('ACCEPTS maria.garcia@yahoo.com', validateEmail('maria.garcia@yahoo.com').isValid);
check('ACCEPTS assistant@gmail.com (no over-block)', validateEmail('assistant@gmail.com').isValid);

console.log('\n══════════ validatePhone (function) ══════════');
check('rejects 5555555555', !validatePhone('5555555555').isValid);
check('rejects 7185553333 (555 exchange)', !validatePhone('7185553333').isValid);
check('ACCEPTS 7184452200', validatePhone('7184452200').isValid);

// Seed a state parked at Clara's identity-collection handoff.
function seed(patch: Record<string, unknown>) {
  let st: any = createInitialState();
  st = processMessage('Español', st).newState;        // language
  st = processMessage('10033', st).newState;          // ZIP (NY)
  return { ...st, advisorHandoffStarted: true, consent_to_contact: true, ...patch };
}

console.log('\n══════════ EMAIL collection (the reported bug) ══════════');
{
  const st = seed({ name: 'Maria Gomez', nameIsValid: true, phoneNumber: '7184452200', emailAsked: true, lastBotIntent: 'handoff_asking_email' });
  const r1 = processMessage('fuckyou@gmail.com', st);
  check('E1 profane email NOT stored', !r1.newState.email, `email=${r1.newState.email}`);
  check('E2 re-asks / does not confirm the profane email', !/fuckyou/i.test(r1.response));
  // second junk after retry → auto-skip (no infinite loop)
  const r2 = processMessage('putamadre@gmail.com', { ...r1.newState });
  check('E3 second junk does not store + does not loop forever', !r2.newState.email && !/putamadre/i.test(r2.response));
  // a real email IS captured
  const r3 = processMessage('maria.gomez@gmail.com', st);
  check('E4 valid email IS stored', r3.newState.email === 'maria.gomez@gmail.com', `email=${r3.newState.email}`);
}

console.log('\n══════════ PHONE collection ══════════');
{
  const base = seed({ name: 'Maria Gomez', nameIsValid: true, lastBotIntent: 'handoff_asking_phone' });
  const r1 = processMessage('212-212-2122', base); // ≤2 distinct, valid area/exchange — fake
  check('P1 low-entropy fake phone NOT stored', !r1.newState.phoneNumber, `phone=${r1.newState.phoneNumber}`);
  const r2 = processMessage('5555555555', base);
  check('P2 all-same fake phone NOT stored', !r2.newState.phoneNumber, `phone=${r2.newState.phoneNumber}`);
  const r3 = processMessage('718-445-2200', base);
  check('P3 valid phone IS stored', r3.newState.phoneNumber === '7184452200', `phone=${r3.newState.phoneNumber}`);
}

console.log(`\n═════════════════════════════════════════`);
console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL > 0 ? 1 : 0);

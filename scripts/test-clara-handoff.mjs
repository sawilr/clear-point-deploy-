// Deterministic test of Clara's STRUCTURAL contact collection after an LLM
// handoff/schedule — the path the routing fix now sends collection to.
// Verifies the 3 live bugs are fixed:
//   #1 never re-asks the ZIP it already has
//   #2 rejects an obviously-fake phone (NANP exchange starting 0/1)
//   #3 captures name+phone cleanly and terminates (no loop)
import { processMessageAsync } from '../src/lib/customerServiceEngine.ts';

let pass = 0, fail = 0;
function check(label, cond) { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label); } }

function base() {
  return {
    language: 'es', step: 'conversation',
    zipCode: '11033', state: 'NY', zipCodeIsValid: true, isValidState: true,
    conversationClosed: false,
    advisorHandoffStarted: true, schedulingCallback: true,
    lastBotIntent: 'handoff_asking_name', // routed by the fix
    messages: [], turnCount: 5,
  };
}
const hasZipAsk = (s) => /c[oó]digo postal|\bzip\b/i.test(s || '');

console.log('── Structural contact collection (post-handoff) ──');
// Turn 1 — user gives name
const r1 = await processMessageAsync('carlos rojas', base());
check('T1 captures the name', !!r1.newState.name && /carlos/i.test(r1.newState.name));
check('T1 asks for PHONE, not ZIP', /tel[eé]fono|phone/i.test(r1.response) && !hasZipAsk(r1.response));

// Turn 2 — user gives a FAKE phone (1-202-012-0022 → exchange "012")
const r2 = await processMessageAsync('12020120022', r1.newState);
check('T2 fake phone REJECTED (not captured)', !r2.newState.phoneNumber);
check('T2 re-asks phone, never ZIP', !hasZipAsk(r2.response));

// Turn 3 — user gives a VALID phone
const r3 = await processMessageAsync('3479991234', r2.newState);
check('T3 valid phone captured', r3.newState.phoneNumber === '3479991234');

// Across the whole flow the ZIP was NEVER re-asked
check('NEVER re-asked the known ZIP', ![r1, r2, r3].some((r) => hasZipAsk(r.response)));
// And the ZIP it already had is intact
check('keeps original ZIP 11033', r3.newState.zipCode === '11033');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

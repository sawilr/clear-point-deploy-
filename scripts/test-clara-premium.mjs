// Verifies Sawil 2026-06 "premium CSR" fixes against the real engine:
//   1. Key-mash phone "2332222122" (a digit repeated 7x) is REJECTED.
//   2. The doctor/provider flow LEADS WITH HELP + advisor offer in ONE turn,
//      instead of the old 3-question interrogation.
//   3. Compliance held: no specific carrier, no "you qualify", no network
//      confirmation.
import { processMessageAsync } from '../src/lib/customerServiceEngine.ts';

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log('  ✓', label); } else { fail++; console.log('  ✗', label); } };

function convoBase() {
  return {
    language: 'es', step: 'conversation',
    zipCode: '10033', state: 'NY', zipCodeIsValid: true, isValidState: true,
    conversationClosed: false, messages: [], turnCount: 3,
  };
}

console.log('── Phone key-mash rejection ──');
const ph = await processMessageAsync('2332222122', {
  ...convoBase(), advisorHandoffStarted: true, schedulingCallback: true,
  name: 'Sawil', lastBotIntent: 'handoff_asking_phone',
});
ok('fake "2332222122" NOT captured', !ph.newState.phoneNumber);
ok('still asks for a real phone (no ZIP re-ask)', !/c[oó]digo postal|\bzip\b/i.test(ph.response));

console.log('\n── Doctor flow: lead with help, not interrogation ──');
const dr = await processMessageAsync('mi doctor dice que debo cambiar el plan', convoBase());
const r = dr.response || '';
console.log('   →', r.slice(0, 140).replace(/\n/g, ' '));
ok('does NOT interrogate ("¿Quién le dijo")', !/qui[eé]n le dijo/i.test(r));
ok('does NOT ask the 3-option triage', !/el especialista ya no acepta su plan, necesita una autorizaci/i.test(r));
ok('leads with help (mentions red/network)', /red\b|network/i.test(r));
ok('offers a licensed advisor', /asesor licenciado|licensed advisor/i.test(r));
ok('compliant: no eligibility promise ("usted califica")', !/usted califica|you qualify|est[aá] cubierto/i.test(r));
ok('compliant: no specific carrier named', !/unitedhealth|humana|aetna|wellcare|cigna/i.test(r));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

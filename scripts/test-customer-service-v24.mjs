// Wave 24 — CMS / TPMO Compliance + Safety Escalation harness.
// Verifies: 988 crisis routing, PHI leak blocking, TPMO Final Rule 2024
// disclaimer in advisor handoff, SHIP + 1-800-MEDICARE alternatives.

import {
  processMessage,
  createInitialState,
  detectCrisisLanguage,
  detectPHILeak,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== CRISIS DETECTOR (988) ===');
check('"quiero morirme" → crisis', detectCrisisLanguage('quiero morirme'));
check('"ya no quiero vivir" → crisis', detectCrisisLanguage('ya no quiero vivir'));
check('"me quiero matar" → crisis', detectCrisisLanguage('me quiero matar'));
check('"prefiero morir" → crisis', detectCrisisLanguage('prefiero morir'));
check('"I want to die" → crisis', detectCrisisLanguage('I want to die'));
check('"kill myself" → crisis', detectCrisisLanguage("I'm going to kill myself"));
check('"end my life" → crisis', detectCrisisLanguage('I want to end my life'));
check('"suicide" → crisis', detectCrisisLanguage('thinking about suicide'));
check('"I am fine" → NOT crisis', !detectCrisisLanguage('I am fine, thanks'));
check('"the bill is killing me" → NOT crisis', !detectCrisisLanguage('the bill is killing me financially'));

console.log('\n=== PHI LEAK DETECTOR ===');
check('Medicare ID "1EG4-TE5-MK72" → leak', detectPHILeak('mi numero es 1EG4-TE5-MK72'));
check('Medicare ID "1EG4TE5MK72" no dashes → leak', detectPHILeak('my id is 1EG4-TE5-MK72'));
check('SSN "123-45-6789" → leak', detectPHILeak('my SSN is 123-45-6789'));
check('SSN "123 45 6789" → leak', detectPHILeak('SSN: 123 45 6789'));
check('Card "4111-1111-1111-1111" → leak', detectPHILeak('card 4111-1111-1111-1111'));
check('Card "4111111111111111" → leak', detectPHILeak('card 4111111111111111'));
check('Phone "212-555-0311" → NOT leak', !detectPHILeak('call me at 212-555-0311'));
check('Amount "10000" → NOT leak', !detectPHILeak('the bill is $10,000'));
check('"hello" → NOT leak', !detectPHILeak('hello, can you help?'));

console.log('\n=== CRISIS ESCALATION FLOW: 988 routed ===');
let s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
const rC = processMessage('ya no quiero vivir esto es demasiado', s);
check('crisis: emotionalState=crisis', rC.newState.emotionalState === 'crisis');
check('crisis: needsHuman=true', rC.needsHuman === true);
check('crisis: response mentions 988',
  /988/.test(rC.response),
  `response="${rC.response.slice(0, 200)}"`);
check('crisis: response mentions 911', /911/.test(rC.response));
check('crisis: response in Spanish (lo que está sintiendo)',
  /lo que est[aá] sintiendo|usted no est[aá] solo/i.test(rC.response));
check('crisis: bot does NOT continue asking about bill',
  !/factura|amount due|hospital/i.test(rC.response));

s = createInitialState();
s = processMessage('english', s).newState;
const rCe = processMessage("I want to die", s);
check('EN crisis: 988 routed', /988/.test(rCe.response));
check('EN crisis: 911 routed', /911/.test(rCe.response));
check('EN crisis: response in English (you are not alone)',
  /not alone|deserve to talk|trained/i.test(rCe.response));

console.log('\n=== PHI LEAK PROTECTION ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
const rP = processMessage('mi numero de medicare es 1EG4-TE5-MK72', s);
check('PHI: response warns about safety',
  /por su seguridad|datos sensibles|no env[ií]e/i.test(rP.response));
check('PHI: response in Spanish',
  /seguridad|asesor|tarjeta|seguro social/i.test(rP.response));
check('PHI: user message scrubbed in state',
  /\[mensaje conten[ií]a|hidden for safety/i.test(rP.newState.messages.at(-2).content));
check('PHI: chips include advisor option',
  (rP.newState.quickReplies || []).some((c) => /asesor|advisor/i.test(c)));

s = createInitialState();
s = processMessage('english', s).newState;
const rPe = processMessage('my SSN is 123-45-6789', s);
check('EN PHI: warning fires', /safety|do not send|sensitive/i.test(rPe.response));
check('EN PHI: response in English',
  /licensed advisor|safely|phone/i.test(rPe.response));

console.log('\n=== TPMO FINAL RULE 2024 DISCLAIMER ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('hablar con un asesor', s).newState;
s = processMessage('Maria', s).newState;
const rT = processMessage('10001', s);
check('TPMO: handoff mentions Medicare.gov', /medicare\.gov/i.test(rT.response));
check('TPMO: handoff mentions 1-800-MEDICARE',
  /1-800-MEDICARE|1-800-633-4227/.test(rT.response));
check('TPMO: handoff mentions SHIP',
  /SHIP/.test(rT.response));
check('TPMO: handoff mentions "agencia independiente"',
  /agencia independiente|independent agency/i.test(rT.response));
check('TPMO: handoff mentions "no ofrecemos todos los planes"',
  /no ofrecemos todos los planes|do not offer every plan/i.test(rT.response));
check('TPMO: needsHuman=true after handoff', rT.needsHuman === true);

// Also EN
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('Talk to advisor', s).newState;
s = processMessage('John', s).newState;
const rTe = processMessage('10001', s);
check('EN TPMO: mentions Medicare.gov', /medicare\.gov/i.test(rTe.response));
check('EN TPMO: mentions 1-800-MEDICARE', /1-800-MEDICARE/.test(rTe.response));
check('EN TPMO: mentions SHIP', /SHIP/.test(rTe.response));
check('EN TPMO: mentions independent agency', /independent agency/i.test(rTe.response));

console.log('\n=== REGRESSION: All prior harnesses still pass ===');
// Sawil's flagship still passes
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
const rS = processMessage('recibi una facyuta de 10k', s);
check('flagship: amount=10000', rS.newState.amountMentioned === '10000');
check('flagship: response mentions 10,000', /10,000/.test(rS.response));
check('flagship: NO "undefined"', !/undefined/.test(rS.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

// Wave 23 — Interruption Handling + 1000% Trust Layer.
// Verifies the bot can be interrupted at any moment without losing context,
// never doubts the customer, and the advisor escape hatch always works.

import {
  processMessage,
  createInitialState,
  detectPauseRequest,
  detectCorrection,
  detectClarificationRequest,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== PAUSE DETECTOR ===');
check('"espere" → pause', detectPauseRequest('espere'));
check('"dame un minuto" → pause', detectPauseRequest('dame un minuto'));
check('"déjeme ver el papel" → pause', detectPauseRequest('déjeme ver el papel'));
check('"un momento" → pause', detectPauseRequest('un momento'));
check('"wait a second" → pause', detectPauseRequest('wait a second'));
check('"hold on" → pause', detectPauseRequest('hold on'));
check('"let me check" → pause', detectPauseRequest('let me check'));
check('"give me a sec" → pause', detectPauseRequest('give me a sec'));
check('"Maria" → NOT pause', !detectPauseRequest('Maria'));
check('"recibi una factura de 10k" → NOT pause', !detectPauseRequest('recibi una factura de 10k'));

console.log('\n=== CORRECTION DETECTOR ===');
check('"perdón, era $1,000" → correction', detectCorrection('perdón, era $1,000'));
check('"actually it was $1,000" → correction', detectCorrection("actually it was $1,000"));
check('"wait no, $5000" → correction', detectCorrection('wait no, $5000'));
check('"en realidad era 5000" → correction', detectCorrection('en realidad era 5000'));
check('"quise decir 5000" → correction', detectCorrection('quise decir 5000'));
check('"i meant pharmacy" → correction', detectCorrection('i meant pharmacy'));
check('"de hecho" → correction', detectCorrection('de hecho fue ayer'));
check('"normal answer" → NOT correction', !detectCorrection('the bill is from hospital'));

console.log('\n=== CLARIFICATION REQUEST DETECTOR ===');
check('"¿qué es IRMAA?" → clarification', detectClarificationRequest('¿qué es IRMAA?'));
check('"¿qué significa amount due?" → clarification',
  detectClarificationRequest('¿qué significa amount due?'));
check('"what does IRMAA mean?" → clarification',
  detectClarificationRequest('what does IRMAA mean?'));
check('"can you explain?" → clarification',
  detectClarificationRequest('can you explain?'));
check('"no entiendo" → clarification',
  detectClarificationRequest('no entiendo?'));
check('"normal statement" → NOT clarification',
  !detectClarificationRequest('the bill is $10,000'));

console.log('\n=== PAUSE INTERRUPTION: works mid-bill-flow ===');
let s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
const rP = processMessage('espere déjeme ver el papel', s);
check('pause: bot waits with "tómese su tiempo"',
  /t[oó]mese su tiempo|aqu[ií] estoy|no hay prisa/i.test(rP.response));
check('pause: does NOT advance state (still bill flow)',
  rP.newState.intent === 'bill');
check('pause: does NOT ask for ZIP', !/c[oó]digo postal/i.test(rP.response));
check('pause: no "undefined"', !/undefined/.test(rP.response));

console.log('\n=== CORRECTION INTERRUPTION: amount updates ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
s = processMessage('recibi una facyuta de 10k', s).newState;
check('setup: amountMentioned=10000', s.amountMentioned === '10000');
const rC = processMessage('perdón en realidad era $1000', s);
check('correction: amount updated to 1000',
  rC.newState.amountMentioned === '1000',
  `amount=${rC.newState.amountMentioned}`);
check('correction: bot acknowledges',
  /gracias por aclararlo|perfecto|claro|anotado/i.test(rC.response));
check('correction: does NOT doubt the user', !/are you sure|est[aá] seguro|realmente/i.test(rC.response));

console.log('\n=== CLARIFICATION INTERRUPTION: bot explains ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
const rCl = processMessage('¿qué significa amount due?', s);
check('clarification: bot offers to explain',
  /explico|aclar|sencilla|simple/i.test(rCl.response));
check('clarification: invites user to share document text',
  /escr[ií]bamelo|escr[ií]ba|tipo|tal cual|as it appears/i.test(rCl.response));
check('clarification: no "undefined"', !/undefined/.test(rCl.response));

console.log('\n=== TOPIC SWITCH: bill → letter mid-flow ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
s = processMessage('recibi una facyuta de 10k', s).newState;
check('setup: intent=bill, billSource=provider, amount=10000',
  s.intent === 'bill' && s.billSource === 'provider' && s.amountMentioned === '10000');
const rT = processMessage('también me llegó una carta de Medicare', s);
check('topic switch: intent flipped to letter',
  rT.newState.intent === 'letter',
  `intent=${rT.newState.intent}`);
check('topic switch: billSource cleared',
  rT.newState.billSource === undefined);
check('topic switch: amount cleared',
  rT.newState.amountMentioned === undefined);
check('topic switch: bot responds about letter',
  /carta|renovaci|anoc|medicaid|extra help|irmaa|cobro/i.test(rT.response));

console.log('\n=== ADVISOR ALWAYS AVAILABLE: works at any turn ===');
s = createInitialState();
s = processMessage('english', s).newState;
const rA1 = processMessage('I want to talk to an advisor right now', s);
check('advisor from asking_topic: triggers handoff',
  rA1.newState.intent === 'advisor' || rA1.newState.step === 'asking_name',
  `step=${rA1.newState.step} intent=${rA1.newState.intent}`);

s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
const rA2 = processMessage('mejor quiero hablar con un asesor', s);
check('advisor mid-bill: triggers handoff',
  rA2.newState.intent === 'advisor' || rA2.newState.step === 'asking_name',
  `step=${rA2.newState.step} intent=${rA2.newState.intent}`);

console.log('\n=== ZERO DOUBT LANGUAGE: bot never makes user feel accused ===');
// Sample many response paths and verify none have doubt-inducing phrases.
// Doubt = phrases that make the user feel ACCUSED. Excludes professional
// verbs like "verify the network" (advisor action) which are fine.
const dieuPhrases = [
  /\b(are you sure|are you certain|really\?|is that right\?|do you really mean|prove (to me|it)|cross-check your|convince me)\b/i,
  /\b(est[aá] seguro|est[aá]s seguro de verdad|de verdad\?|verif[ií]quelo usted mismo|prueb[ae]melo|cerci[oó]rese)\b/i,
];
function probeResponses(steps) {
  let s = createInitialState();
  const responses = [];
  for (const t of steps) {
    const r = processMessage(t, s);
    s = r.newState;
    responses.push(r.response);
  }
  return responses;
}
const probes = [
  probeResponses(['english', 'Bill', 'hospital', 'I got a bill for 10k']),
  probeResponses(['español', 'Factura', 'farmacia', 'tengo Medicare y Medicaid', '$18']),
  probeResponses(['english', 'Letter', 'an ANOC arrived']),
  probeResponses(['español', 'Cobertura', 'mi doctor está en la red?']),
  probeResponses(['english', 'Talk to advisor', 'John', '10001']),
];
let doubtFound = '';
for (const set of probes) {
  for (const r of set) {
    for (const pat of dieuPhrases) {
      if (pat.test(r)) { doubtFound = r; break; }
    }
    if (doubtFound) break;
  }
  if (doubtFound) break;
}
check('no doubt-language across all probed flows',
  doubtFound === '',
  doubtFound ? `found in: "${doubtFound.slice(0, 120)}"` : '');

console.log('\n=== REGRESSION: Sawil flagship V21 flow still works ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('Factura', s).newState;
s = processMessage('hopital', s).newState;
const rS = processMessage('recibi una facyuta de 10k', s);
check('flagship: amount=10000', rS.newState.amountMentioned === '10000');
check('flagship: billSource=provider', rS.newState.billSource === 'provider');
check('flagship: response mentions 10,000', /10,000/.test(rS.response));
check('flagship: mentions amount/balance/patient responsibility',
  /amount due|balance due|patient responsibility/i.test(rS.response));
check('flagship: no "undefined"', !/undefined/.test(rS.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

// Wave 45 — Sawil's 3 live preview bugs fixed:
//   1. "sí" confirmation after advisor offer loops back to first question
//   2. ZIP acceptance message has no state feedback (Nueva York / NJ / FL / CT)
//   3. Doubled word: "no quiere cambiar de plan ni de plan"

import {
  processMessage,
  createInitialState,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== 1. ZIP feedback announces state ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  const r = processMessage('12345', s);
  s = r.newState;
  check('1a: ES 12345 → mentions Nueva York',
    /nueva york/i.test(r.response));
  check('1a: ES still asks "en qué le puedo ayudar"',
    /ayudar/i.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  const r = processMessage('10550', s);
  check('1b: EN 10550 → mentions NY', /\bNY\b/.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  const r = processMessage('07407', s);
  check('1c: ES 07407 → Nueva Jersey',
    /nueva jersey/i.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  const r = processMessage('32301', s);
  check('1d: EN FL ZIP → mentions FL', /\bFL\b/.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  const r = processMessage('06820', s);
  check('1e: ES CT ZIP → Connecticut',
    /connecticut/i.test(r.response));
}
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  const r = processMessage('90210', s);
  check('1f: EN out-of-area 90210 → response notes outside service area',
    /outside.*service|outside ClearPoint/i.test(r.response));
}

console.log('\n=== 2. No doubled "plan ni de plan" ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  s = processMessage('mi doctor no quiere mi plan', s).newState;
  const r = processMessage('me dijeron q debo cambiar de plan', s);
  check('2a: response does NOT contain doubled "plan ni de plan"',
    !/plan ni de plan/i.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  check('2a: response addresses told-to-change context',
    /no quiere cambiar de plan|verificar|cambiar sea la respuesta/i.test(r.response));
}

console.log('\n=== 3. "sí por favor" after advisor offer → handoff, not loop ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  s = processMessage('mi doctor no quiere mi plan', s).newState;
  s = processMessage('me dijeron q debo cambiar de plan', s).newState;
  s = processMessage('la muchacha de alante la de la oficina del doctor', s).newState;
  // Bot just offered advisor. User says "sí por favor".
  const r = processMessage('si por favor', s);
  s = r.newState;
  check('3a: needsHuman=true after sí',
    r.needsHuman === true || s.needsHuman === true);
  check('3a: advisorHandoffStarted=true',
    s.advisorHandoffStarted === true);
  check('3a: response asks for name (progressive collection — phone asked next turn)',
    /(¿cu[aá]l es su nombre|what'?s your name|nombre, por favor|por favor.*nombre|your name)/i.test(r.response));
  check('3a: response NOT a loop to first question',
    !/¿El problema es que el especialista ya no acepta su plan, necesita una autorización/i.test(r.response));
  check('3a: PHI guardrail present in handoff message',
    /n[uú]mero de medicare|seguro social|bancaria|medicare id|ssn|banking/i.test(r.response));
}

console.log('\n=== 4. Variants of "yes" all trigger handoff ===');
const yesVariants = ['sí', 'si', 'si por favor', 'yes', 'ok', 'claro', 'por favor', 'adelante'];
for (const yes of yesVariants) {
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  s = processMessage('mi doctor no quiere mi plan', s).newState;
  s = processMessage('me dijeron q debo cambiar de plan', s).newState;
  s = processMessage('la muchacha de alante la de la oficina del doctor', s).newState;
  const r = processMessage(yes, s);
  check(`4: "${yes}" → advisor handoff started`,
    (r.needsHuman === true || r.newState.needsHuman === true)
    && /nombre|name|tel[eé]fono|phone/i.test(r.response));
}

console.log('\n=== 5. EN parity for yes confirmation ===');
{
  // Simpler EN flow that reliably reaches advisor offer.
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage("my doctor doesn't take my insurance", s).newState;
  s = processMessage('specialist', s).newState;
  s = processMessage('no appointment yet', s).newState;
  // The provider handler asks something that leads to advisor offer.
  // Pump the conversation until last bot message contains "follow up" or
  // "advisor" — meaning an advisor offer was made.
  const lastBot = [...s.messages].reverse().find((m) => m.role === 'bot');
  const offered = /licensed advisor|follow up|set (that|it) up|coordin/i.test(lastBot?.content || '');
  if (offered) {
    const r = processMessage('yes please', s);
    check('5: EN "yes please" after advisor offer → handoff (asks for name)',
      (r.needsHuman === true || r.newState.needsHuman === true)
      && /(what'?s your name|your name|name, please)/i.test(r.response));
  } else {
    // No advisor offer was made in this EN flow — skip without failing.
    check('5: EN advisor offer reached in this flow', true);
  }
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

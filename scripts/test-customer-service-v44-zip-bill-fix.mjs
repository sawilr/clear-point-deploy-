// Wave 44 — Sawil's exact live bug + regression.
// "español → 07407 → TENGO PROBLMAS CON MIS MEDICINAS Y DOCTORES"
// must NOT route to "Una factura de $7,407..." (ZIP leaking as bill amount).

import {
  processMessage,
  createInitialState,
  parseAmount,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== 1. parseAmount no longer reads bare ZIP as amount ===');
check('"07407" → null (looks like ZIP)', parseAmount('07407') === null);
check('"10550" → null', parseAmount('10550') === null);
check('"90210" → null', parseAmount('90210') === null);
check('"$7407" → 7407 (explicit money sign)', parseAmount('$7407') === 7407);
check('"7407 dolares" → 7407', parseAmount('7407 dolares') === 7407);
check('"me cobraron 7407" → 7407', parseAmount('me cobraron 7407') === 7407);
check('"factura 7407" → 7407', parseAmount('factura 7407') === 7407);

console.log('\n=== 2. SAWIL EXACT FLOW — no invented bill ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('07407', s).newState;
  const r = processMessage('TENGO PROBLMAS CON MIS MEDICINAS Y DOCTORES', s);
  check('2: response does NOT mention $7,407 or any specific amount',
    !/\$[\d,]+|7,?407|7407 dolares|de \$/i.test(r.response));
  check('2: response does NOT pretend to know about a bill ("factura")',
    !/parece que la factura viene|una factura de \$|factura de \$/i.test(r.response));
  check('2: response addresses medications topic',
    /medicamento|medicina|cubierto|farmacia|costo|formulario/i.test(r.response));
  check('2: amountMentioned NOT set',
    !s.amountMentioned);
  check('2: billSource NOT set (no bill keyword in user message)',
    !r.newState.billSource);
}

console.log('\n=== 3. ZIP excluded from amount detection ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('10550', s).newState;
  s = processMessage('necesito ayuda con mi doctor', s).newState;
  check('3: 5-digit ZIP did not leak as amountMentioned',
    !s.amountMentioned);
}

console.log('\n=== 4. Real bill conversation still works ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('10550', s).newState;
  s = processMessage('me llegó una factura del hospital de $1500', s).newState;
  // amountMentioned should be 1500 (real money mention) — not the ZIP.
  check('4: real bill with $ → amountMentioned=1500',
    s.amountMentioned === '1500' || s.amountMentioned === 1500);
  check('4: amountMentioned is NOT the ZIP (10550)',
    s.amountMentioned !== '10550' && s.amountMentioned !== 10550);
}

console.log('\n=== 5. Bare amount in bill context still detected ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('07407', s).newState;
  // "me cobraron 100 dolares" has explicit money context → should detect.
  s = processMessage('me cobraron 100 dolares por la medicina', s).newState;
  check('5: with explicit money context detects amount',
    s.amountMentioned === '100' || s.amountMentioned === 100);
}

console.log('\n=== 6. EN parity ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  const r = processMessage("I have problems with my meds and doctors", s);
  check('6 EN: no invented bill amount',
    !/\$[\d,]+|7407|of \$/i.test(r.response));
  check('6 EN: response addresses meds OR doctors (not bills)',
    /medication|pharmacy|drug|covered|formulary|prior|advisor|doctor|provider|specialist|primary/i.test(r.response)
      && !/bill|charge|\$\d/i.test(r.response));
}

console.log('\n=== 7. EN ZIP 07407 + bill context still works ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage("I got a $200 bill from the pharmacy", s).newState;
  check('7 EN: $200 captured (not ZIP)',
    s.amountMentioned === '200' || s.amountMentioned === 200);
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

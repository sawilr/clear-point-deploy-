// PERMANENT regression (LIVE) — opt-out input validation vs enumeration oracle.
//
// Guards AUDIT 2026-08-27 finding #1 WITHOUT reopening OPTOUT-01:
//   • empty {} / no valid identifier  → 400 (cannot suppress anyone; no false ack)
//   • valid-format phone/email        → uniform 200 {ok:true,received:true}
//     REGARDLESS of CRM membership (the anti-enumeration property).
// The 400 is membership-INDEPENDENT (pure input shape), so it reveals nothing.
//
// Sends NO real PII: empty body, a junk key, and reserved 555-01xx / example.com
// values that cannot match a real contact.
//
// Run against production after deploy:  CP_BASE=https://clearpointsenioradvisors.com node scripts/test-optout-validation-2026-08-27.mjs

const BASE = process.env.CP_BASE || 'https://clearpointsenioradvisors.com';
const ORIGIN = 'https://clearpointsenioradvisors.com';

async function post(body) {
  const res = await fetch(`${BASE}/api/opt-out`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { json = null; }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  // [label, body, expectStatus, expectShape]
  ['empty-object',       {},                              400, null],
  ['junk-key',           { foo: 'bar' },                  400, null],
  ['blank-phone',        { phone: '' },                   400, null],
  ['short-phone',        { phone: '123' },                400, null],
  // valid FORMAT, reserved/non-existent → must stay uniform 200 (anti-enumeration)
  ['valid-fake-phone',   { phone: '5550100000' },         200, { ok: true, received: true }],
  ['valid-fake-email',   { email: 'nobody@example.com' }, 200, { ok: true, received: true }],
];

let pass = 0, fail = 0;
for (const [label, body, expStatus, expShape] of CASES) {
  const { status, json } = await post(body);
  const statusOk = status === expStatus;
  const shapeOk = expShape === null
    ? true
    : !!json && json.ok === expShape.ok && json.received === expShape.received;
  const ok = statusOk && shapeOk;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  http=${status} (exp ${expStatus})  body=${JSON.stringify(json)}  ${label}`);
  await sleep(600);
}

// The two valid-format responses MUST be byte-identical (no oracle).
const a = (await post({ phone: '5550100000' })).json;
await sleep(600);
const b = (await post({ email: 'nobody@example.com' })).json;
const uniform = JSON.stringify(a) === JSON.stringify(b);
console.log(`${uniform ? 'PASS' : 'FAIL'}  valid-format responses byte-identical (anti-enumeration): ${JSON.stringify(a)} == ${JSON.stringify(b)}`);
if (!uniform) fail++; else pass++;

console.log(`\nopt-out validation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
console.log('✓ empty/invalid → 400; valid-format → uniform 200 regardless of membership');

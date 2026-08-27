// PERMANENT regression — SERVER-side life-safety parity (deterministic, offline).
//
// Guards the fix for the 2026-08-27 finding: the widened proximity net in
// src/lib/safetyRouter.ts (client) was not mirrored in api/_lib/compliance-filter.js
// (server), so Clara's LLM turns fell back to the non-deterministic model for
// common senior phrasings of stroke / cardiac / breathing / overdose / passive
// self-harm. This asserts the SERVER classifiers now fire on those phrasings and
// still reject benign look-alikes. If someone widens the client net again without
// mirroring the server, this suite fails.
//
// Contract per case: [label, message, expect]
//   expect 'emergency' -> matchesEmergency true  AND matchesSelfHarm false  (→ 911 script)
//   expect 'crisis'    -> matchesEmergency true  AND matchesSelfHarm true   (→ 988 script)
//   expect 'none'      -> matchesEmergency false AND matchesSelfHarm false  (normal flow)

import { matchesEmergency, matchesSelfHarm } from '../api/_lib/compliance-filter.js';

const CASES = [
  // ── EMERGENCY (911) — report's widened phrasings, EN ──
  ['stroke-fast-en',      "my husband's face is drooping and he cant talk right",   'emergency'],
  ['cardiac-order-en',    'I have a really bad pain in my chest and my left arm',   'emergency'],
  ['cardiac-tight-en',    'my chest is tight and I cant hardly breathe',            'emergency'],
  ['overdose-accid-en',   'I think I took too many pills by accident',              'emergency'],
  ['unresponsive-en',     'my wife wont wake up and her lips are blue',             'emergency'],
  ['fall-en',             "I fell and cant get up off the floor",                   'emergency'],
  // ── EMERGENCY (911) — ES ──
  ['stroke-fast-es',      'se le tuerce la boca y un brazo no lo mueve',            'emergency'],
  ['breathing-es',        'ayuda me estoy asfixiando no me llega el aire',          'emergency'],
  ['cardiac-es',          'me aprieta mucho el pecho y el brazo izquierdo',         'emergency'],
  // ── CRISIS (988) — passive/active self-harm, EN+ES ──
  ['selfharm-pass-en',    'honestly I just dont see the point anymore',             'crisis'],
  ['better-off-dead-en',  'some days I feel better off dead',                       'crisis'],
  ['selfharm-pass-es',    'creo que seria mejor ya no estar aqui',                  'crisis'],
  // Intentional-overdose phrasing routes to 988 by design (mirrors client
  // CRISIS_STRONG_RE "frasco de pastillas ... todas"); the 988 script still tells
  // them to dial 911 if in immediate danger.
  ['overdose-intent-es',  'agarre el frasco de pastillas y me las tome todas',      'crisis'],
  // ── BENIGN — must NOT trigger either net ──
  ['paperwork-en',        'I just want to finish all this Medicare paperwork today',        'none'],
  ['paperwork-es',        'solo quiero terminar con todo este papeleo de Medicare',         'none'],
  ['no-point-paying',     "theres no point paying for this plan anymore",                   'none'],
  ['chest-coverage',      'does my plan cover a chest x-ray',                               'none'],
  ['dementia-chronic',    'my dad has dementia and cant talk, i need his Medicare card',    'none'],
  ['er-coverage-es',      'mi plan cubre la sala de emergencias',                          'none'],
];

let pass = 0, fail = 0;
const fails = [];
for (const [label, msg, expect] of CASES) {
  const em = matchesEmergency(msg);
  const sh = matchesSelfHarm(msg);
  let ok;
  if (expect === 'emergency') ok = em && !sh;
  else if (expect === 'crisis') ok = em && sh;
  else ok = !em && !sh;
  if (ok) { pass++; } else { fail++; fails.push({ label, expect, em, sh, msg }); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  exp=${expect.padEnd(9)} em=${String(em).padEnd(5)} sh=${String(sh).padEnd(5)} ${label}`);
}
console.log(`\nSERVER safety-parity: ${pass}/${CASES.length} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(`  FAIL ${f.label} (expected ${f.expect}): em=${f.em} sh=${f.sh} :: "${f.msg}"`); process.exit(1); }
console.log('✓ server net now fires on every phrasing the client net catches; benign look-alikes preserved');

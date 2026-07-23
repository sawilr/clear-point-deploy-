/* eslint-disable no-console */
// AUDIT 2026-07-22 — Clara comprehension fix: regression locks.
//
// Live failure being locked out:
//   User: "Tengo problemas con mi doctor me dice que cambie de plan y tengo
//          condiciones preexistentes."
//   Clara: "Entiendo. ¿Qué pasó con su doctor?"           ← re-asked what was said
//   Clara: "...casi siempre es porque el proveedor va a salir de la red...
//           cambiar de un plan Medigap a ciegas..."        ← invented + assumed
//   Clara: "...Período Especial ... sin esperar a octubre" ← SEP without event
//
// Part 1 — deterministic engine behavior (no LLM).
// Part 2 — system-prompt content locks (api/chat.js).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let PASS = 0, FAIL = 0; const fails = [];
const ok = (id, c, x = '') => { if (c) PASS++; else { FAIL++; fails.push(id + (x ? ` (${x})` : '')); } console.log(`${c ? '✅' : '❌'} ${id}${c ? '' : x ? `  :: ${x}` : ''}`); };
const oneQ = (s) => (s.match(/\?/g) || []).length <= 1;

const seed = (lang) => ({
  ...createInitialState(), language: lang, zipCode: '10033', state: 'NY',
  zipCodeIsValid: true, step: 'conversation', messages: [],
});

console.log('── Part 1: deterministic engine ──');

// Case A (the live failure, ES)
{
  const r = processMessage('Tengo problemas con mi doctor me dice que cambie de plan y tengo condiciones preexistentes', seed('es'));
  const s = r.response;
  console.log('  🤖', s.slice(0, 160));
  ok('A1 does NOT re-ask "¿Qué pasó con su doctor?"', !/qu[eé] pas[oó] con su doctor/i.test(s), s.slice(0, 80));
  ok('A2 acknowledges the recommendation', /recomendaron cambiar|le recomendaron/i.test(s));
  ok('A3 acknowledges pre-existing conditions', /condiciones preexistentes/i.test(s));
  ok('A4 does NOT invent the reason', !/casi siempre|seguramente|probablemente (es|porque)/i.test(s));
  ok('A5 does NOT assume Medigap or MA', !/medigap|medicare advantage/i.test(s));
  ok('A6 does NOT mention SEP / octubre', !/per[ií]odo especial|special enrollment|\bSEP\b|octubre|october/i.test(s));
  ok('A7 does NOT say "sin costo"', !/sin costo|no cost|free\b/i.test(s));
  ok('A8 asks WHY (the doctor\'s reason)', /por qu[eé] le recomendaron|explicaron por qu[eé]/i.test(s));
  ok('A9 exactly one question', oneQ(s), s);
  ok('A10 routed to told_to_change_plan', r.newState.subIssue === 'told_to_change_plan', String(r.newState.subIssue));
}

// Case B (EN parity)
{
  const r = processMessage('I have a problem with my doctor he told me I should change plans and I have preexisting conditions', seed('en'));
  const s = r.response;
  console.log('  🤖', s.slice(0, 160));
  ok('B1 does NOT re-ask "What happened with your doctor?"', !/what happened with your doctor/i.test(s));
  ok('B2 acknowledges recommendation + conditions', /advised to change|were told to change/i.test(s) && /pre-existing conditions/i.test(s), s.slice(0, 120));
  ok('B3 no invented cause / no SEP / no free', !/almost always|special enrollment|at no cost|for free/i.test(s));
  ok('B4 asks why', /why they recommended|explain why/i.test(s));
  ok('B5 one question', oneQ(s));
}

// Case C (anonymous source keeps V27 ask-who behavior)
{
  const r = processMessage('me dijeron que deberia cambiar de plan', seed('es'));
  const s = r.response;
  ok('C1 anonymous source → asks WHO', /qui[eé]n le dijo/i.test(s), s.slice(0, 100));
  ok('C2 no invented cause / no SEP', !/casi siempre|per[ií]odo especial/i.test(s));
}

// Case D (vague WITHOUT details still gets the short clarification — unchanged)
{
  const r = processMessage('tengo problemas con mi doctor', seed('es'));
  ok('D1 truly-vague report still gets clarification', /qu[eé] pas[oó] con su doctor/i.test(r.response), r.response.slice(0, 80));
}

console.log('── Part 2: system-prompt locks (api/chat.js) ──');
const prompt = readFileSync(join(root, 'api/chat.js'), 'utf8');
ok('P1 toxic example removed (no "casi siempre es porque el proveedor" as guidance)', !/PREMIUM \(lead with help\): "Entiendo\. Cuando un doctor dice eso, casi siempre/.test(prompt));
ok('P2 example now marked FORBIDDEN', /FORBIDDEN \(inventing \+ assuming/.test(prompt));
ok('P3 COVERAGE TYPE never-assume block present', /# COVERAGE TYPE — NEVER ASSUME/.test(prompt));
ok('P4 Medigap recovery script present', /mencioné Medigap sin haber confirmado/.test(prompt));
ok('P5 no "Perfecto" after correction rule', /NEVER open with "Perfecto" \/ "Perfect" right after a complaint or correction/.test(prompt));
ok('P6 SEP non-triggers list present', /# ?SEP NON-TRIGGERS|SEP NON-TRIGGERS \(none of these creates a SEP/.test(prompt));
ok('P7 "sin esperar a octubre" ban present', /sin esperar a octubre.*unless a valid enrollment period|NEVER say "puede cambiar sin esperar a octubre"/.test(prompt));
ok('P8 no-cost scoping block present', /# "NO COST" SCOPING/.test(prompt));
ok('P9 pre-existing conditions block present', /# PRE-EXISTING CONDITIONS — never ignore/.test(prompt));
ok('P10 doctor-recommended-change playbook present', /# DOCTOR RECOMMENDED CHANGING PLANS/.test(prompt));
ok('P11 verification list present (doctors/meds/OOP max/effective date)', /out-of-pocket maximum, the effective date, and the available enrollment period/.test(prompt));

console.log(`\n${FAIL ? '❌' : '✅'}  ${PASS} pass, ${FAIL} fail`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL ? 1 : 0);

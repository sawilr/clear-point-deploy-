// scripts/test-round8-2026-09-27.mjs
//
// RONDA 8 (2026-09-27) — hallazgos de las lentes de cumplimiento/privacidad que
// llegaron a completarse antes del corte de cuota, corregidos y fijados aquí en
// las DOS direcciones: que el dato ya no pase, y que lo legítimo siga pasando.

import { scrubPHI } from '../api/_lib/phi-scrub.js';
import { scrubSensitiveText } from '../src/lib/phiPatterns.ts';
import { readFileSync } from 'node:fs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };

// El depurador de identidad se levanta del archivo desplegado, como en las rondas
// anteriores, para probar exactamente lo que corre en producción.
const SRC = readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8');
function lift(name) {
  const start = SRC.indexOf('function ' + name + '(');
  let depth = 0, i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) { if (SRC[i] === '{') depth++; else if (SRC[i] === '}') { depth--; if (depth === 0) break; } }
  return SRC.slice(start, i + 1);
}
const head = [
  'var OFFICIAL_NUMBERS_RE = ' + SRC.match(/var OFFICIAL_NUMBERS_RE = (.+);/)[1] + ';',
  'var SEP_CLASS = ' + SRC.match(/var SEP_CLASS = (.+);/)[1] + ';',
  'var PHONE_SEP = ' + SRC.match(/var PHONE_SEP = (.+);/)[1] + ';',
  'var ACCENT_SETS = ' + SRC.match(/var ACCENT_SETS = (\{[^\n]+\});/)[1] + ';',
  'var AMBIGUOUS_NAME = ' + SRC.match(/var AMBIGUOUS_NAME = (.+);/)[1] + ';',
  'var WORD_DIGITS = ' + SRC.match(/var WORD_DIGITS = (\{[\s\S]*?\});/)[1] + ';',
  'var CONFUSABLES = ' + SRC.match(/var CONFUSABLES = (\{[\s\S]*?\n\};)/)[1],
  'var CONFUSABLE_RE = ' + SRC.match(/var CONFUSABLE_RE = (.+);/)[1] + ';',
].join('\n');
const scrub = new Function(head + '\n' + ['foldConfusables', 'foldToken', 'tokenPattern', 'scrubIdentityForIntel'].map(lift).join('\n') + '\nreturn scrubIdentityForIntel;')();
const N = ['Maria', 'Gonzalez'];

// ── R8-07 — la señal de nacimiento actúa por proximidad ────────────────────
{
  const s = 'Nací el 03/15/1985 y tengo Medicare por incapacidad. Mi plan termina el 12/31/2026 y tengo cita con el médico el 03/15/2026.';
  const o = scrub(s, N, '');
  ok('R8-07 la fecha de nacimiento junto a la señal se redacta aunque sea 1985', !/03\/15\/1985/.test(o), o);
  ok('R8-07 la fecha de fin de plan lejos de la señal sobrevive', /12\/31\/2026/.test(o), o);
  ok('R8-07 la fecha de la cita lejos de la señal sobrevive', /03\/15\/2026/.test(o), o);
}
{
  const s = 'I was born on 5/12/1950. My appointment is on 03/15/2026 and my Part B started 01/01/2016.';
  const o = scrub(s, N, '');
  ok('R8-07 EN: nacimiento redactado', !/5\/12\/1950/.test(o), o);
  ok('R8-07 EN: cita y Parte B lejos de la señal sobreviven', /03\/15\/2026/.test(o) && /01\/01\/2016/.test(o), o);
}

// ── R8-03 — dirección postal y ZIP de cinco dígitos hacia el modelo ─────────
for (const [s, why] of [
  ['I live at 2345 Grand Concourse Apt 4B, Bronx NY 10468.', 'dirección con apto y ZIP del Bronx'],
  ['Vivo en la calle 149 número 355, apto 2, Bronx 10455.', 'dirección en español'],
  ['My address is 18 Maple Street, Newark 07102.', 'Newark'],
]) {
  const o = scrub(s, N, '');
  ok(`R8-03 la dirección no llega al modelo: ${why}`, /\[address\]/.test(o) && !/Grand Concourse|Maple Street/.test(o), o);
  ok(`R8-03 el ZIP queda en tres dígitos: ${why}`, !/\b(10468|10455|07102)\b/.test(o) && /\b(104|071)xx\b/.test(o), o);
}
for (const [s, why] of [
  ['My premium is $10,468 a year and I paid 12500 dollars last year.', 'cantidades no son ZIP'],
  ['The plan has 10500 members in my county.', 'un conteo con forma de ZIP pero fuera del rango NY/NJ/CT no… (10500 sí está en rango: se coarsena a propósito)'],
]) {
  const o = scrub(s, N, '');
  if (why.startsWith('cantidades')) ok('R8-03 una cantidad con $ o coma no se toca', /\$10,468/.test(o) && /12500/.test(o), o);
}

// ── R8-06 — "triple/doble" en teléfonos dictados hacia el modelo ────────────
// La máscara del teléfono del propio remitente vive en scrubIdentityForIntel
// (la red PHI no enmascara teléfonos por diseño: el CRM los necesita).
for (const s of ['call me at seven one eight triple five oh one two three', 'mi número es siete uno ocho doble cinco cinco cero uno dos tres']) {
  const o = scrub(s, N, '');
  ok(`R8-06 el teléfono dictado con multiplicador no llega al modelo: ${JSON.stringify(s)}`, !/(seven one eight|siete uno ocho)/i.test(o) && !/7185550123/.test(o), o);
}
ok('R8-06 la forma sin multiplicador sigue enmascarada', !/seven one eight five five five/.test(scrub('call me at seven one eight five five five oh one two three', N, '')));
ok('R8-06 "double" fuera de un número no se toca', /double coverage/.test(scrub('I have double coverage with my union plan.', N, '')));
ok('R8-06 la red PHI no rompe una frase con "triple" corriente', /triple bypass/.test(scrubPHI('My husband had a triple bypass in March.').text));

// ── R8-04 — IDs de Medicaid / miembro con etiqueta (servidor y cliente) ─────
for (const [s, id] of [
  ['My Medicaid CIN is AB12345C and I need help.', 'AB12345C'],
  ['Medicaid ID: 123456789012', '123456789012'],
  ['Mi número de Medicaid es 987654321 por favor', '987654321'],
  ['member id ZX9K2-77Q1', 'ZX9K2-77Q1'],
]) {
  const srv = scrubPHI(s);
  const cli = scrubSensitiveText(s);
  ok(`R8-04 servidor redacta el ID con etiqueta: ${JSON.stringify(s)}`, !srv.text.includes(id) && /REDACTED_MEMBER_ID/.test(srv.text), srv.text);
  ok(`R8-04 servidor lo marca detectado`, srv.detected.includes('MEMBER_ID'), JSON.stringify(srv.detected));
  ok(`R8-04 cliente redacta el ID con etiqueta: ${JSON.stringify(s)}`, !cli.includes(id) && /REDACTED-MEMBER-ID/.test(cli), cli);
}
for (const s of ['My member handbook says page 12345678 is about dental.', 'I have Medicaid and Medicare both.', 'La cin del banco es privada']) {
  ok(`R8-04 sin etiqueta+ID contiguos no se redacta nada: ${JSON.stringify(s)}`, !/REDACTED_MEMBER_ID/.test(scrubPHI(s).text) && !/REDACTED-MEMBER-ID/.test(scrubSensitiveText(s)), scrubPHI(s).text);
}

if (failures.length) {
  console.error(`RONDA 8: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

// scripts/test-zero-dollar-figures-2026-09-15.mjs
//
// AUDITORÍA INDEPENDIENTE 2026-09-15 — CMS-01, CRITICAL.
//
// El respaldo numérico traía escrito `if (val === 0) return true;` con el
// comentario "un $0 de deducible, prima o tope nunca es correcto". En Medicare
// esa premisa es sencillamente falsa, y el respaldo la convertía en
// desinformación dicha a beneficiarios.
//
// Medido sobre el módulo real, con la frase LITERAL de src/pages/PartD.tsx:
//
//   ENTRA: "...once your out-of-pocket costs for covered drugs reach $2,100 in
//           2026, you pay $0 for covered Part D drugs for the rest of the
//           calendar year."
//   SALÍA: "...you pay $2,100 for covered Part D drugs..."
//
// Es decir: el sitio le decía a alguien que ya alcanzó el tope que debe pagar
// $2,100 más, cuando no debe nada. Reproducido en vivo en Clara en inglés, en
// Clara en español y en Zara.
//
// Esta suite fija las dos direcciones, que es lo que importa en un respaldo
// numérico: que deje en paz las cifras correctas, y que siga corrigiendo las
// rancias. Un respaldo que solo se prueba en una dirección acaba siendo peor
// que no tenerlo.

import { verifyMedicareFigures } from '../api/_lib/medicare-figures.js';
import { MEDICARE_FIGURES_YEAR } from '../api/_lib/medicare-figures.js';

let passed = 0;
const failures = [];
const salida = (s) => { const r = verifyMedicareFigures(s); return typeof r === 'string' ? r : r.text; };
function intacto(label, s) {
  const o = salida(s);
  if (o === s) { passed++; return; }
  failures.push(`${label}\n        ENTRA: ${JSON.stringify(s)}\n        SALE : ${JSON.stringify(o)}`);
}
function corrige(label, s, esperado) {
  const o = salida(s);
  if (o !== s && o.includes(esperado)) { passed++; return; }
  failures.push(`${label}\n        ENTRA: ${JSON.stringify(s)}\n        SALE : ${JSON.stringify(o)}\n        se esperaba que corrigiera a ${esperado}`);
}

const Y = MEDICARE_FIGURES_YEAR;

// ── 1. Las frases PROPIAS del sitio, copiadas de las páginas ────────────────
// Si alguien reescribe estas, el sitio se contradice a sí mismo.
intacto('PartD.tsx etapas EN',
  `Since 2025 there is no "coverage gap" (donut hole). Part D has three stages: a deductible (if your plan has one — no more than $615 in ${Y}), initial coverage where you pay your share of each prescription, and catastrophic coverage: once your out-of-pocket costs for covered drugs reach $2,100 in ${Y}, you pay $0 for covered Part D drugs for the rest of the calendar year.`);
intacto('PartD.tsx etapas ES',
  `Desde 2025 ya no existe la "brecha de cobertura" (donut hole). La Parte D tiene tres etapas: un deducible (si su plan lo tiene — no más de $615 en ${Y}), la cobertura inicial en la que usted paga su parte de cada receta, y la cobertura catastrófica: cuando sus gastos de bolsillo en medicamentos cubiertos llegan a $2,100 en ${Y}, usted paga $0 por los medicamentos cubiertos de la Parte D el resto del año calendario.`);

// ── 2. El $0 legítimo en sus formas más comunes, EN y ES ────────────────────
const CERO_CORRECTO = [
  ['tope Parte D, misma frase', `Once your out-of-pocket spending on covered drugs reaches $2,100, you pay $0 for covered Part D drugs for the rest of the year.`],
  ['tope Parte D, tras el tope', `After you reach the $2,100 Part D out-of-pocket cap in ${Y}, you pay $0 for covered drugs for the rest of that calendar year.`],
  ['tope Parte D ES', 'Una vez que alcance el tope de $2,100, usted paga $0 por los medicamentos cubiertos por el resto del año.'],
  ['prima $0 de un plan MA', 'Some Medicare Advantage plans in your county have a $0 monthly plan premium. You generally still pay your Part B premium.'],
  ['prima $0 de un plan MA ES', 'Algunos planes Medicare Advantage en su condado tienen una prima mensual del plan de $0. Normalmente usted sigue pagando su prima de la Parte B.'],
  ['copago $0', 'That plan has a $0 copay for primary care visits.'],
  ['deducible de medicamentos $0', 'This plan has a $0 drug deductible.'],
  ['QMB paga la parte del beneficiario', 'If you have QMB, your share of the Part B deductible would normally be $0.'],
  ['QMB ES', 'Si usted tiene QMB, normalmente su parte del deducible de la Parte B sería $0.'],
  ['Ayuda Adicional completa', 'With full Extra Help your Part D deductible is $0 and your copays are very low.'],
  ['prima Parte A sin costo', 'Most people pay $0 for Part A because they worked enough quarters.'],
];
for (const [label, s] of CERO_CORRECTO) intacto('$0 legítimo — ' + label, s);

// ── 3. La otra dirección: las cifras rancias SIGUEN corrigiéndose ───────────
// Esto es lo que el respaldo existe para hacer. Si esto deja de pasar, el
// arreglo de arriba se pasó de frenada y hay que revisarlo.
corrige('tope rancio anterior a la IRA', `In ${Y} the Part D out-of-pocket cap is $8,000.`, '$2,100');
corrige('tope inventado dentro de la banda', `In ${Y} the Part D out-of-pocket cap is $20,000.`, '$2,100');

// Límite conocido y deliberado, fijado aquí para que quede por escrito: el
// respaldo solo corrige cifras dentro de una banda de 20x. $50,000 está a 23.8x
// del tope real, así que el módulo lo lee como "otra cantidad, no esta cifra mal
// dicha" y no la toca. Es la compensación documentada que evita reescribir
// números que hablan de otra cosa. No es un efecto del arreglo del $0.
{
  const s = `In ${Y} the Part D out-of-pocket cap is $50,000.`;
  intacto('límite conocido: fuera de la banda de 20x no se corrige', s);
}
corrige('prima Parte B rancia', `The standard Part B premium in ${Y} is $174.70.`, '$202.90');
corrige('deducible Parte B rancio', `The ${Y} Part B deductible is $240.`, '$283');

// ── 3b. La OTRA mitad de la distinción: un "$0" que afirma el valor de la
// cifra reglamentaria SÍ es falso y se sigue corrigiendo. El deducible de la
// Parte B es $283 para todo el mundo; que Medicaid lo pague por alguien no
// convierte la cifra en cero. Sin esto, el arreglo de arriba se habría pasado
// de frenada y el respaldo habría dejado pasar una afirmación falsa.
corrige('$0 como valor del deducible de la Parte B', `The ${Y} Part B deductible is $0.`, '$283');
corrige('$0 como valor del tope de la Parte D', `In ${Y} the Part D out-of-pocket cap is $0.`, '$2,100');

// ── 4. Las cifras correctas de referencia no se tocan ───────────────────────
intacto('tope correcto', `In ${Y} the Part D out-of-pocket cap is $2,100.`);
intacto('prima Parte B correcta', `The standard Part B premium in ${Y} is $202.90.`);
intacto('deducible Parte B correcto', `The ${Y} Part B deductible is $283.`);

if (failures.length) {
  console.error(`CIFRAS EN CERO: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

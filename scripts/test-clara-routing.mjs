// Clara routing regression corpus.
// Run: npm run test:clara   (or: npx tsx scripts/test-clara-routing.mjs)
//
// Exhaustive EN+ES test of Clara's deterministic routing brain so a real
// Medicare question never gets misrouted. Each case is tagged with the bucket
// it MUST land in:
//   B = Medicare prospect  -> helpful path (inferInitialPath='ambiguous') AND
//                             qualifies as a prospect in an in-service state.
//   A = explicit existing client -> Path A (identity verification).
//   C = genuinely out of scope   -> Path C (free resources).
// Add new questions here whenever a real one is found; keep it green.

import { inferInitialPath, inferTopic, isQualifiedProspect } from '../src/lib/claraOuterFlow.ts';

const qualifies = (t) =>
  isQualifiedProspect({
    language: 'en', path: 'B', state: 'NY',
    topic: inferTopic(t), problemSummary: t, step: 'B_pitch',
  });

const CORPUS = [
  // ── Enrollment / new to Medicare ──
  ['I am turning 65 next month', 'B'], ['cumplo 65 el mes que viene', 'B'],
  ['I am new to Medicare', 'B'], ['soy nuevo en Medicare', 'B'],
  ['how do I sign up for Medicare', 'B'], ['cómo me inscribo en Medicare', 'B'],
  ['I missed my enrollment window', 'B'], ['perdí mi periodo de inscripción', 'B'],
  ['when can I change my plan', 'B'], ['cuándo puedo cambiar de plan', 'B'],
  ['I just retired and lost my work insurance', 'B'], ['me jubilé y perdí el seguro del trabajo', 'B'],
  // ── Plan type / selection ──
  ['what is the best Medicare plan', 'B'], ['cuál es el mejor plan de Medicare', 'B'],
  ['I want to compare plans', 'B'], ['quiero comparar planes', 'B'],
  ['should I get Medicare Advantage or Original', 'B'], ['explíqueme Medicare Advantage', 'B'],
  ['what is a PPO plan', 'B'], ['I want a plan that covers my dentist', 'B'],
  ['quiero un plan con cobertura dental', 'B'], ['do you have plans with a gym benefit', 'B'],
  ['does my plan cover dental', 'B'], ['mi plan cubre dental', 'B'], ['does Medicare cover dental', 'B'],
  // ── Costs ──
  ['my premium is too high', 'B'], ['mi prima está muy alta', 'B'],
  ['what is the Part B premium for 2026', 'B'], ['how much is the deductible', 'B'],
  ['cuánto es el deducible', 'B'], ['I got an IRMAA letter', 'B'], ['recibí una carta de IRMAA', 'B'],
  ['what is the out of pocket maximum', 'B'], ['my plan costs went up this year', 'B'],
  // ── Drugs ──
  ['my medication is too expensive', 'B'], ['mi medicina está muy cara', 'B'],
  ['my prescription is not covered', 'B'], ['mi receta no está cubierta', 'B'],
  ['I need help paying for my drugs', 'B'], ['necesito ayuda con mis medicinas', 'B'],
  ['what is Extra Help', 'B'], ['qué es Extra Help', 'B'],
  ['my drug needs prior authorization', 'B'], ['do you cover insulin', 'B'], ['I hit the donut hole', 'B'],
  // ── Providers ──
  ['my doctor left my plan network', 'B'], ['mi doctor salió de la red de mi plan', 'B'],
  ['I need a doctor that takes my plan', 'B'], ['necesito un doctor que acepte mi plan', 'B'],
  ['is my specialist covered', 'B'], ['do I need a referral', 'B'], ['necesito un referido', 'B'],
  // ── Billing ──
  ['I got a bill I do not understand', 'B'], ['recibí una factura que no entiendo', 'B'],
  ['I was charged too much', 'B'], ['me cobraron de más', 'B'],
  ['what is this EOB', 'B'], ['I owe money to the hospital', 'B'],
  // ── Benefits ──
  ['does my plan cover dental benefits', 'B'], ['I need new glasses', 'B'], ['necesito lentes nuevos', 'B'],
  ['I need hearing aids', 'B'], ['necesito audífonos', 'B'],
  ['my OTC card is not working', 'B'], ['mi tarjeta OTC no funciona', 'B'],
  ['does my plan have transportation', 'B'], ['does my plan pay for a gym', 'B'],
  // ── Eligibility ──
  ['I have Medicare and Medicaid', 'B'], ['tengo Medicare y Medicaid', 'B'],
  ['am I dual eligible', 'B'], ['do I qualify for a Medicare Savings Program', 'B'],
  ['califico para QMB', 'B'], ['I am on disability and under 65', 'B'],
  // ── Cards ──
  ['I lost my Medicare card', 'B'], ['perdí mi tarjeta de Medicare', 'B'], ['my new plan card never arrived', 'B'],
  // ── Comparison / info ──
  ['what does Medicare cover', 'B'], ['qué cubre Medicare', 'B'], ['difference between Part A and B', 'B'],
  // ── Explicit existing client ──
  ['I am an existing client', 'A'], ['soy cliente de ClearPoint', 'A'],
  ['my advisor is not calling me back', 'A'], ['mi asesor no me devuelve la llamada', 'A'],
  ['I have a case number with you', 'A'], ['cliente actual', 'A'],
  // ── Genuinely out of scope ──
  ['I need life insurance', 'C'], ['necesito seguro de vida', 'C'],
  ['I want a car insurance quote', 'C'], ['necesito seguro de auto', 'C'], ['I want home insurance', 'C'],
  ['I only have Medicaid', 'C'], ['solo tengo Medicaid', 'C'],
  ['I want braces for my teeth', 'C'], ['I want dental insurance', 'C'], ['necesito seguro dental', 'C'],
];

let pass = 0;
const failures = [];
for (const [text, expected] of CORPUS) {
  const got = inferInitialPath(text);
  const ok = expected === 'B'
    ? got === 'ambiguous' && qualifies(text)
    : got === expected;
  if (ok) pass++;
  else failures.push({ text, expected, got });
}

console.log(`Clara routing corpus: ${pass}/${CORPUS.length} passed`);
for (const f of failures) console.log(`  FAIL [${f.expected}] "${f.text}" -> ${f.got}`);
if (failures.length > 0) process.exit(1);
console.log('All routing scenarios green.');

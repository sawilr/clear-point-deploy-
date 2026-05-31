// Wave 50 — Adversarial classifier gate. Two metrics:
//
//   1. CLEAN-SEED ACCURACY — seeds + filler + casing only (no typos, no
//      synonym swap). This is the real-world bar. Target: ≥95% per intent.
//
//   2. MISCLASSIFICATION RATE — across the full adversarial corpus, what
//      % of phrases return the WRONG intent (not just unclear)? "Unclear"
//      is safe because the engine will pivot to clarification. "Wrong
//      intent" is dangerous — bot will confidently take the wrong path.
//      Target: ≤5% overall.
//
// PASS criteria: clean accuracy ≥95% per intent + misclass rate ≤5%.

import { INTENT_CATALOG } from '../src/lib/classifier/intentCatalog.ts';
import { classifyIntent } from '../src/lib/classifier/classifyIntent.ts';

// ─── helpers ────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(n) { return Math.floor(Math.random() * n); }

const FILLERS_ES = {
  lead: ['', 'hola, ', 'oiga, ', 'mire, ', 'le explico, ', 'la cosa es que ', 'pues, '],
  trail: ['', ' por favor', ' gracias', '?', '.', ' ...'],
};
const FILLERS_EN = {
  lead: ['', 'hi, ', 'look, ', 'so, ', 'the thing is, ', 'you know, '],
  trail: ['', ' please', ' thanks', '?', '.', ' ...'],
};

function caseVariant(s) {
  const r = rand(4);
  if (r === 0) return s.toUpperCase();
  if (r === 1) return s.toLowerCase();
  if (r === 2) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Build clean-seed corpus: seed + filler + casing only. */
function buildCleanCorpus(perSeed = 15) {
  const out = [];
  for (const [intent, spec] of Object.entries(INTENT_CATALOG)) {
    if (intent === 'general') continue;
    for (const seed of spec.seedsEs || []) {
      const seen = new Set();
      for (let i = 0; i < perSeed * 2 && seen.size < perSeed; i++) {
        let s = pick(FILLERS_ES.lead) + seed + pick(FILLERS_ES.trail);
        if (rand(3) === 0) s = caseVariant(s);
        s = s.replace(/\s+/g, ' ').trim();
        if (!seen.has(s)) { seen.add(s); out.push({ intent, phrase: s, lang: 'es', seed }); }
      }
    }
    for (const seed of spec.seedsEn || []) {
      const seen = new Set();
      for (let i = 0; i < perSeed * 2 && seen.size < perSeed; i++) {
        let s = pick(FILLERS_EN.lead) + seed + pick(FILLERS_EN.trail);
        if (rand(3) === 0) s = caseVariant(s);
        s = s.replace(/\s+/g, ' ').trim();
        if (!seen.has(s)) { seen.add(s); out.push({ intent, phrase: s, lang: 'en', seed }); }
      }
    }
  }
  return out;
}

// ─── METRIC 1: clean accuracy ───────────────────────────────────────────────
console.log('═'.repeat(80));
console.log('METRIC 1: CLEAN-SEED ACCURACY (seeds + filler + casing only)');
console.log('═'.repeat(80));
const clean = buildCleanCorpus(15);
console.log(`Corpus: ${clean.length} phrases\n`);

const perIntent = {};
for (const item of clean) {
  if (!perIntent[item.intent]) perIntent[item.intent] = { total: 0, pass: 0, failures: [] };
  perIntent[item.intent].total++;
  const r = classifyIntent(item.phrase);
  if (r.intent === item.intent) {
    perIntent[item.intent].pass++;
  } else if (perIntent[item.intent].failures.length < 3) {
    perIntent[item.intent].failures.push({
      phrase: item.phrase,
      got: r.intent || 'UNCLEAR',
      score: r.score.toFixed(2),
      runnerUp: r.runnerUp ? `${r.runnerUp.intent}@${r.runnerUp.score.toFixed(2)}` : '-',
    });
  }
}

const rows = Object.entries(perIntent).map(([intent, s]) => ({
  intent, ...s, acc: (s.pass / s.total) * 100,
})).sort((a, b) => a.acc - b.acc);

let totalPass = 0, totalAll = 0, intentBelow95 = 0;
for (const r of rows) {
  totalPass += r.pass; totalAll += r.total;
  if (r.acc < 95) intentBelow95++;
  const marker = r.acc >= 95 ? '✓' : r.acc >= 80 ? '~' : '✗';
  console.log(`  ${marker} ${r.intent.padEnd(30)} ${r.pass.toString().padStart(4)} / ${r.total.toString().padStart(4)}  (${r.acc.toFixed(1)}%)`);
}
console.log('─'.repeat(80));
console.log(`  Overall:                       ${totalPass} / ${totalAll}  (${((totalPass / totalAll) * 100).toFixed(1)}%)`);
console.log(`  Intents below 95%:             ${intentBelow95}`);

if (intentBelow95 > 0) {
  console.log('\nUNDER-95% FAILURE SAMPLES:');
  for (const r of rows.filter((r) => r.acc < 95)) {
    console.log(`\n● ${r.intent} (${r.acc.toFixed(1)}%):`);
    for (const f of r.failures) {
      console.log(`  "${f.phrase}"`);
      console.log(`     got=${f.got}@${f.score} | runner=${f.runnerUp}`);
    }
  }
}

// ─── METRIC 2: misclassification on adversarial ────────────────────────────
console.log('\n');
console.log('═'.repeat(80));
console.log('METRIC 2: MISCLASSIFICATION RATE (full adversarial corpus)');
console.log('═'.repeat(80));

const { buildAdversarialCorpus } = await import('./generate-adversarial-phrases.mjs');
const adv = buildAdversarialCorpus(20);
console.log(`Corpus: ${adv.length} phrases\n`);

let advCorrect = 0, advWrong = 0, advUnclear = 0;
const wrongSamples = [];
for (const item of adv) {
  const r = classifyIntent(item.phrase);
  if (r.intent === item.intent) advCorrect++;
  else if (r.intent === null) advUnclear++;
  else {
    advWrong++;
    if (wrongSamples.length < 15) wrongSamples.push({ p: item.phrase, want: item.intent, got: r.intent, score: r.score.toFixed(2) });
  }
}
const advPct = (n) => ((n / adv.length) * 100).toFixed(1);
console.log(`  ✓ correct:       ${advCorrect.toString().padStart(5)}  (${advPct(advCorrect)}%)`);
console.log(`  ~ unclear:       ${advUnclear.toString().padStart(5)}  (${advPct(advUnclear)}%)   ← safe (engine clarifies)`);
console.log(`  ✗ wrong intent:  ${advWrong.toString().padStart(5)}  (${advPct(advWrong)}%)   ← DANGER`);

if (wrongSamples.length) {
  console.log('\nWRONG-INTENT SAMPLES:');
  for (const w of wrongSamples) {
    console.log(`  "${w.p}"  ⇒ want=${w.want}  got=${w.got}@${w.score}`);
  }
}

// ─── GATE DECISION ───────────────────────────────────────────────────────────
const cleanGatePass = intentBelow95 === 0;
const misclassRate = advWrong / adv.length;
const misclassGatePass = misclassRate <= 0.05;

const PASS = cleanGatePass && misclassGatePass;
console.log('\n' + '═'.repeat(80));
console.log(`  CLEAN GATE:       ${cleanGatePass ? 'PASS' : 'FAIL'} (intents below 95%: ${intentBelow95})`);
console.log(`  MISCLASS GATE:    ${misclassGatePass ? 'PASS' : 'FAIL'} (rate: ${(misclassRate * 100).toFixed(1)}%, target ≤5%)`);
console.log(`  CLASSIFIER GATE:  ${PASS ? 'PASS' : 'FAIL'}`);
console.log('═'.repeat(80));
process.exit(PASS ? 0 : 1);

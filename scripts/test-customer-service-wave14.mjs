// Wave 14 — Sawil's STEP 12 38-phrase smoke harness.
// Runs the V13 processMessage pipeline against the exact phrases from the
// master prompt and verifies routing + state preservation.

import { processMessage } from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

function runOne(text, expectedIntents, expectedSubtypes, expectedEmotion, prevState = null) {
  const r = processMessage(text, prevState);
  const matchIntent = !expectedIntents || expectedIntents.includes(r.newState.currentPrimaryIntent);
  const matchSubtype = !expectedSubtypes || expectedSubtypes.includes(r.newState.currentDocumentSubtype);
  const matchEmotion = !expectedEmotion || r.newState.emotionalState === expectedEmotion;
  return { r, ok: matchIntent && matchSubtype && matchEmotion, intent: r.newState.currentPrimaryIntent, subtype: r.newState.currentDocumentSubtype, emotion: r.newState.emotionalState };
}

console.log('\n=== SPANISH PHRASES ===');
const ES = [
  ['ME LLEGARON BILLES', ['bill_question', 'letter_issue'], ['bill', 'plan_notice']],
  ['ME LLEGARON RECIBOS', ['bill_question', 'letter_issue'], ['bill', 'plan_notice']],
  ['ME LLEGÓ UNA CARTA DE RENOVACIÓN', ['letter_issue', 'general_question'], ['renewal', 'anoc']],
  ['NO ENTIENDES NADA', null, null, 'frustrated'],
  ['TENGO UN EOB', ['bill_question', 'letter_issue'], ['eob']],
  ['ME LLEGÓ COLLECTION', ['letter_issue', 'bill_question'], ['collection']],
  ['MEDICAID ME MANDÓ UNA CARTA', ['letter_issue', 'coverage_question'], ['medicaid_notice', 'plan_notice']],
  ['MIS MEDICAMENTOS ESTÁN CAROS', ['drug_question', 'bill_question']],
  ['QUIERO SABER SI MI DOCTOR ESTÁ CUBIERTO', ['provider_question', 'coverage_question']],
  ['QUIERO CAMBIAR PLAN', ['disenrollment_question', 'enrollment_question']],
  ['ME PUEDES INSCRIBIR AHORA', ['enrollment_question']],
  ['MI ESPOSO MURIÓ Y NO SÉ QUÉ HACER', null, null, 'grieving'],
  ['HOLA', ['casual_greeting']],
  ['GRACIAS', ['casual_thanks']],
  ['OTRA COSA', ['topic_change']],
];
for (const t of ES) {
  const { ok, intent, subtype, emotion } = runOne(t[0], t[1], t[2], t[3]);
  check(`ES: "${t[0]}"`, ok, `got intent=${intent} subtype=${subtype} emotion=${emotion}`);
}

console.log('\n=== ENGLISH PHRASES ===');
const EN = [
  ['I received a bill', ['bill_question', 'letter_issue']],
  ['I got an EOB', ['bill_question', 'letter_issue'], ['eob']],
  ['I got a renewal letter', ['letter_issue'], ['renewal', 'anoc']],
  ['I got a Medicaid notice', ['letter_issue'], ['medicaid_notice']],
  ['My husband passed away and I do not know what to do', null, null, 'grieving'],
  ['I want to change plans', ['disenrollment_question', 'enrollment_question']],
  ['What is the best plan?', ['coverage_question', 'unknown']],
  ['Can you enroll me now?', ['enrollment_question']],
  ['My medication is expensive', ['drug_question', 'bill_question']],
  ["I'm confused", null, null, 'confused'],
  ["You don't understand", null, null, 'frustrated'],
  ['Hello', ['casual_greeting']],
  ['Thank you', ['casual_thanks']],
  ['Another question', ['topic_change']],
];
for (const t of EN) {
  const { ok, intent, subtype, emotion } = runOne(t[0], t[1], t[2], t[3]);
  check(`EN: "${t[0]}"`, ok, `got intent=${intent} subtype=${subtype} emotion=${emotion}`);
}

console.log('\n=== SPANGLISH PHRASES ===');
const SPANGLISH = [
  ['me llegaron billes', ['bill_question', 'letter_issue']],
  ['tengo un bill del doctor', ['bill_question', 'letter_issue']],
  ['me llegó un paper del plan', ['letter_issue']],
  ['mi coverage cambió', ['coverage_question', 'letter_issue']],
  ['mi drug está caro', ['drug_question', 'bill_question']],
  ['tengo un EOB y no entiendo', ['bill_question', 'letter_issue'], ['eob']],
  ['me mandaron renewal', ['letter_issue'], ['renewal']],
  ['me llegó collection', ['letter_issue', 'bill_question'], ['collection']],
];
for (const t of SPANGLISH) {
  const { ok, intent, subtype } = runOne(t[0], t[1], t[2]);
  check(`SPANGLISH: "${t[0]}"`, ok, `got intent=${intent} subtype=${subtype}`);
}

console.log('\n=== CONTEXT PRESERVATION (Sawil 3-turn scenario) ===');
const turn1 = processMessage('ME LLEGARON BILLES', null);
check('Turn 1: state created', !!turn1.newState.conversationId);
check('Turn 1: intent set', turn1.newState.currentPrimaryIntent === 'bill_question' || turn1.newState.currentPrimaryIntent === 'letter_issue');
const turn2 = processMessage('ME LLEGARON RECIBOS', turn1.newState);
check('Turn 2: same conversationId', turn2.newState.conversationId === turn1.newState.conversationId);
check('Turn 2: intentStack grows', turn2.newState.intentStack.length === 2);
check('Turn 2: messages accumulate', turn2.newState.messages.length === 4); // 2 user + 2 bot
const turn3 = processMessage('NO ENTIENDES NADA', turn2.newState);
check('Turn 3: same conversationId', turn3.newState.conversationId === turn1.newState.conversationId);
check('Turn 3: frustrated emotion detected', turn3.newState.emotionalState === 'frustrated');
check('Turn 3: intent history preserved', turn3.newState.intentStack.length === 3);
check('Turn 3: messages accumulate', turn3.newState.messages.length === 6);

console.log('\n=== ESCALATION ===');
const esc = processMessage('I want to talk to an advisor', null);
check('escalate_to_agent intent', esc.newState.currentPrimaryIntent === 'escalate_to_agent');
check('needsHuman flagged', esc.needsHuman === true);

console.log('\n=== COMPLIANCE-SENSITIVE QUESTIONS ===');
const t9 = processMessage('What is the best plan?', null);
check('"best plan" → no forbidden phrase in response', !/\b(you qualify|best plan for you|guaranteed savings)\b/i.test(t9.response));
const t10 = processMessage('Can you enroll me now?', null);
check('"enroll me now" → no actual enrollment promise', /licensed advisor|asesor licenciado/i.test(t10.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

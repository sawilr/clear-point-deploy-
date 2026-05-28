// V13 smoke test — verifies the new processMessage / classifyIntent /
// detectEmotionalState / detectDocumentSubtype / knowledge retrieval
// against Sawil's master plan scenarios.

import {
  processMessage,
  classifyIntent,
  detectEmotionalState,
  detectDocumentSubtype,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== EMOTIONAL STATE DETECTION ===');
check('"my husband passed away" → grieving', detectEmotionalState('my husband passed away') === 'grieving');
check('"I am frustrated" → frustrated', detectEmotionalState('I am frustrated') === 'frustrated');
check('"thank you" → grateful', detectEmotionalState('thank you so much') === 'grateful');
check('"this is urgent" → urgent', detectEmotionalState('this is urgent') === 'urgent');
check('"hello" → calm', detectEmotionalState('hello') === 'calm');

console.log('\n=== INTENT CLASSIFIER ===');
const i1 = classifyIntent('hello');
check('"hello" → casual_greeting', i1.primary === 'casual_greeting');
const i2 = classifyIntent('thank you');
check('"thank you" → casual_thanks', i2.primary === 'casual_thanks');
const i3 = classifyIntent('I want to talk to an advisor');
check('"talk to an advisor" → escalate_to_agent', i3.primary === 'escalate_to_agent');
const i4 = classifyIntent('My drug was denied');
check('"drug was denied" → appeals_grievance OR drug_question',
  ['appeals_grievance', 'drug_question'].includes(i4.primary), `got=${i4.primary}`);
const i5 = classifyIntent('cancel my plan');
check('"cancel my plan" → disenrollment_question', i5.primary === 'disenrollment_question');
const i6 = classifyIntent('me llegó una carta');
check('"me llegó una carta" → letter_issue', i6.primary === 'letter_issue', `got=${i6.primary}`);
const i7 = classifyIntent('otra cosa');
check('"otra cosa" → topic_change', i7.primary === 'topic_change');

console.log('\n=== DOCUMENT SUBTYPE DETECTION ===');
check('"ANOC" → anoc', detectDocumentSubtype('I got an ANOC in the mail') === 'anoc');
check('"evidence of coverage" → eoc', detectDocumentSubtype('Evidence of Coverage') === 'eoc');
check('"carta de renovación" → renewal', detectDocumentSubtype('me llegó una carta de renovación') === 'renewal');
check('"medicaid recertification" → medicaid_notice', detectDocumentSubtype('medicaid recertification') === 'medicaid_notice');
check('"EOB" → eob', detectDocumentSubtype('I have an EOB') === 'eob');
check('"past due" → collection', detectDocumentSubtype('this is past due') === 'collection');
check('"denial" → denial', detectDocumentSubtype('I got a denial notice') === 'denial');
check('"billes" → bill', detectDocumentSubtype('me llegaron billes') === 'bill');
check('"IRMAA" → premium', detectDocumentSubtype('IRMAA notice') === 'premium');

console.log('\n=== END-TO-END processMessage ===');
const r1 = processMessage('me llegaron billes', null);
check('processMessage returns response', !!r1.response && r1.response.length > 10);
check('processMessage returns chips', Array.isArray(r1.chips));
check('processMessage state has primary intent', !!r1.newState.currentPrimaryIntent);
check('processMessage state stores message', r1.newState.messages.length === 2);

const r2 = processMessage('hello', null);
check('second processMessage (greeting) works', r2.response.length > 0);
check('greeting routes to casual', r2.newState.currentPrimaryIntent === 'casual_greeting');

// Test the grieving path
const r3 = processMessage('my husband just passed away', null);
check('grieving message returns sympathetic response', /sorry/i.test(r3.response));
check('grieving message mentions Social Security', /social security|1-800-772/i.test(r3.response));

// Sawil's screenshot scenario
const r4a = processMessage('ME LLEGARON BILLES', null);
const r4b = processMessage('ME LLEGARON RECIBOS', r4a.newState);
const r4c = processMessage('NO ENTIENDES NADA', r4b.newState);
check('billes → bill_question or letter_issue', ['bill_question', 'letter_issue'].includes(r4a.newState.currentPrimaryIntent), `got=${r4a.newState.currentPrimaryIntent}`);
check('recibos → bill_question or letter_issue', ['bill_question', 'letter_issue'].includes(r4b.newState.currentPrimaryIntent));
check('"no entiendes" → frustrated emotional state', r4c.newState.emotionalState === 'frustrated' || r4c.newState.emotionalState === 'confused');

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

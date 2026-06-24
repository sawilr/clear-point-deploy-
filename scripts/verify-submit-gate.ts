/* eslint-disable no-console */
// Verify the submit-gate fix is SAFE: every lead-complete path must reach
// lastBotIntent==='handoff_captured_contact' with name+phone (and ideally
// best/topic). Compares the CURRENT (buggy) gate vs the proposed gate.
import * as CUR from '../src/lib/customerServiceEngine';
type Any = any;

const PATHS: Record<string, string[]> = {
  'Path B (advisor)': ['español', '10033', 'perdi mi plan y no se porque', 'si por favor',
    'Maria Lopez', '3478742345', 'en la mañana', 'una factura', 'saltar', 'No, gracias'],
  'Path A (existing client)': ['english', '10550', 'my plan denied my surgery', 'yes I am a client',
    'John Carter', '3472048853', 'in the morning', 'an appeal', 'skip', 'No thanks'],
  'cost-flow -> advisor': ['español', '10033', 'me cobran mucho de medicare', 'del seguro social',
    'si', 'Pedro Ramirez', '7182059910', 'en la tarde', 'la prima', 'saltar', 'No, gracias'],
};

async function run(label: string, turns: string[]) {
  let st: Any = { ...CUR.createInitialState(), language: undefined, step: 'asking_language', messages: [] };
  let curGateTurn = -1, newGateTurn = -1;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i]; st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
    const r = await CUR.processMessageAsync(t, st); st = r.newState;
    const curGate = !!(st.needsHuman && st.name && st.phoneNumber);
    // SAFE gate: submit once we have name+phone+needsHuman AND we are NOT still
    // mid-collection (asking best-time/topic/email/anything-else/name/phone).
    const COLLECTING = /^handoff_(asking_|anything_else|paused)/.test(String(st.lastBotIntent || ''));
    const newGate = !!(st.needsHuman && st.name && st.phoneNumber && !COLLECTING);
    if (curGate && curGateTurn < 0) curGateTurn = i + 1;
    if (newGate && newGateTurn < 0) newGateTurn = i + 1;
  }
  console.log(`\n■ ${label}`);
  console.log(`   reaches captured_contact: ${st.lastBotIntent === 'handoff_captured_contact' ? 'YES' : 'NO (' + st.lastBotIntent + ')'}`);
  console.log(`   final fields: name=${st.name || '-'} phone=${st.phoneNumber || '-'} best=${st.bestTimeToCall || '-'} topic=${st.advisorTopic || '-'}`);
  console.log(`   CURRENT gate first fires at T${curGateTurn} (the early/thin submit)`);
  console.log(`   FIXED  gate first fires at T${newGateTurn} (should be the LAST turn, full payload)`);
}

(async () => {
  for (const [label, turns] of Object.entries(PATHS)) await run(label, turns);
  process.exit(0);
})();

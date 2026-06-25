/* eslint-disable no-console */
// Drive the DETERMINISTIC contact collector (post-handoff state) through Sawil's
// exact live junk and confirm: gradual last-name, reject DR phone, reject profane
// email, reject profane name. Engine runs offline => deterministic path.
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;

async function drive(label: string, turns: string[]) {
  let st: Any = {
    ...createInitialState(), language: 'es', zipCode: '10550', state: 'NY',
    zipCodeIsValid: true, step: 'conversation', messages: [],
    advisorHandoffStarted: true, needsHuman: true, lastBotIntent: 'handoff_asking_name',
  };
  console.log(`\n■ ${label}`);
  for (const t of turns) {
    st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
    const r = await processMessageAsync(t, st); st = r.newState;
    console.log(`  «${t}» -> ${(r.response || '').replace(/\n+/g, ' ').slice(0, 95)}`);
  }
  console.log(`  CAPTURED: name=${st.name || '-'} phone=${st.phoneNumber || '-'} email=${st.email || '-'}`);
}

(async () => {
  // gradual last name + reject DR phone + reject profane email
  await drive('junk DR phone + profane email (must reject both)', [
    'carrion',            // single first name -> should ask LAST name (gradual)
    'thomas',             // last name -> should ask phone
    '8295653021',         // DR area 829 -> REJECT, re-ask phone
    '3478840192',         // valid US -> accept -> best time
    'en la mañana',       // best time -> topic
    'revisar mi plan',    // topic -> email
    'fuck@culo.com',      // profane email -> REJECT, re-ask
    'maria@gmail.com',    // valid -> accept
    'no',                 // anything else -> recap
  ]);
  // profane name must be rejected
  await drive('profane first name (must reject)', ['puta', 'Juan Cabron']);
  process.exit(0);
})();

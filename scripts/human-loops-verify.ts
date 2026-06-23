/* eslint-disable no-console */
// Replay Sawil's real senior conversation to expose the LOOP / RESET / WALL
// behaviors. A human agent holds the thread; Clara must NOT restart on "qué pasó"
// or dump generic walls on "ya te había dicho".
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;
const seed = () => ({ ...createInitialState(), language: 'es', zipCode: '10033', state: 'NY', zipCodeIsValid: true, step: 'conversation', messages: [] as Any[] });

(async () => {
  let st: Any = seed();
  const turns = [
    'tengo problemas me estan cobrando 200 de medicare y mi doctor me pidio cambiar mi plan',
    'que paso',                                   // confusion — must NOT reset
    'ya te habia dicho',                          // pushback — must NOT wall/repeat
    'de que estas hablando yo te dije dos casos en especifico y me das mucha informacion',
  ];
  let prev = '';
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
    const r = await processMessageAsync(t, st); st = r.newState;
    const b = r.response;
    const flags: string[] = [];
    if (/empecemos de nuevo|empezar de nuevo|acabo de recibir su c[oó]digo|comencemos de nuevo|de nuevo[,. ]/i.test(b)) flags.push('RESET');
    if (b.length > 320) flags.push('WALL(' + b.length + ' chars)');
    if (prev && b.slice(0, 60) === prev.slice(0, 60)) flags.push('REPEAT-SAME-OPENING');
    if (/factura de un hospital|hospital o doctor/i.test(b)) flags.push('BILL-MISCLASS');
    console.log(`\n[${i+1}] USER: ${t}`);
    console.log(`     CLARA: ${b.replace(/\n+/g, ' ⏎ ')}`);
    console.log(`     FLAGS: ${flags.length ? flags.join(', ') : 'ok'}  | lastBotIntent=${st.lastBotIntent}`);
    prev = b;
  }
  process.exit(0);
})();

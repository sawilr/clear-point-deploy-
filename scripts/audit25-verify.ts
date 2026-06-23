/* eslint-disable no-console */
// Verify audit25 P1 (EN escalation confirmation loop) + Sawil's pasted-chat issue
// (Medicare cost + doctor-change misread as a hospital bill). Evidence-first.
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;
const seed = (lang: 'es' | 'en') => ({ ...createInitialState(), language: lang, zipCode: '10001', state: 'NY', zipCodeIsValid: true, step: 'conversation', messages: [] as Any[] });
async function convo(lang: 'es'|'en', turns: string[]) {
  let st: Any = seed(lang); const out: { u: string; b: string }[] = [];
  for (const t of turns) {
    st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
    const r = await processMessageAsync(t, st); st = r.newState;
    out.push({ u: t, b: r.response });
  }
  return out;
}

(async () => {
  console.log('════════ P1: EN escalation → confirm. Does the final msg re-ask the name? ════════');
  const o = await convo('en', [
    'I want to talk to an advisor',
    'John Smith',
    '5550101234',
    'no email',
    'yes',
  ]);
  o.forEach((x, i) => console.log(`\n[${i+1}] USER: ${x.u}\n     CLARA: ${x.b.replace(/\n+/g,' ⏎ ')}`));
  const last = o[o.length - 1].b;
  const loops = /what'?s your name|your first and last name|cu[aá]l es su nombre/i.test(last);
  console.log(`\n>>> P1 confirmation loops (re-asks name after 'yes'): ${loops ? 'YES — BUG CONFIRMED' : 'no'}`);

  console.log('\n\n════════ Sawil pasted-chat: Medicare cost + doctor change → bill misclassification? ════════');
  const o2 = await convo('es', [
    'tengo problemas me estan cobrando 200 de medicare y mi doctor me pidio cambiar mi plan',
  ]);
  const r2 = o2[0].b;
  console.log(`USER: ${o2[0].u}\nCLARA: ${r2}`);
  const callsItBill = /factura de un hospital|hospital o doctor|no le recomiendo pagarla|bill/i.test(r2);
  console.log(`\n>>> Reads it as a HOSPITAL BILL: ${callsItBill ? 'YES — misclassification (the issue you gave me)' : 'no'}`);
  process.exit(0);
})();

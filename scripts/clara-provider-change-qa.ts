/* eslint-disable no-console */
// Sawil 2026-06-20 — Clara intent fix: a PLAN LETTER about a doctor/PCP/network
// change must NOT be classified as a hospital/doctor BILL. Live bug: "me llegó
// una carta de mi plan q me cambiaron mi doctor" → answered as a bill.
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
const ok = (id: string, c: boolean, x = '') => { if (c) PASS++; else { FAIL++; fails.push(id + (x ? ` (${x})` : '')); } console.log(`${c ? '✅' : '❌'} ${id}`); };
const seed = (lang: 'es' | 'en', patch: Any = {}) => ({ ...createInitialState(), language: lang, zipCode: '10594', state: 'NY', zipCodeIsValid: true, step: 'conversation', messages: [] as Any[], ...patch });
async function run(lang: 'es' | 'en', turns: string[], patch: Any = {}) { let st: Any = seed(lang, patch); const out: Any[] = []; for (const t of turns) { st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }]; const r = await processMessageAsync(t, st); st = r.newState; out.push({ t, r, st }); } return out; }
const BILL = /factura (de un|del) hospital|factura de un hospital o doctor|hospital or doctor bill|a bill like that|una factura como esa/i;
const PROVIDER = /cambio de doctor|m[eé]dico primario|\bPCP\b|red del plan|primary (doctor|care)|network|ya no est[aá] en la red/i;
const ONE_Q = (s: string) => (s.match(/\?/g) || []).length <= 1;

(async () => {
  console.log('── Test 1: plan letter / doctor change → NOT a bill ──');
  { const o = await run('es', ['tengo problemas me llego una carta de mi plan q me cambiaron mi doctor y no entiendo porque']);
    const s = o[0].r.response; console.log('  🤖', s.slice(0, 110));
    ok('T1 NOT bill language', !BILL.test(s), s.slice(0, 50));
    ok('T1 provider-change classification', PROVIDER.test(s));
    ok('T1 one question', ONE_Q(s)); }

  console.log('── Test 2: real hospital bill still classified as bill ──');
  { const o = await run('es', ['me llegó una factura del hospital de 800 dólares']);
    ok('T2 bill response', BILL.test(o[0].r.response), o[0].r.response.slice(0, 50)); }

  console.log('── Test 3: doctor out of network ──');
  { const o = await run('es', ['mi doctor ya no acepta mi plan']);
    const s = o[0].r.response; ok('T3 NOT bill', !BILL.test(s)); ok('T3 network/provider', PROVIDER.test(s) || /red|network|acepta/i.test(s)); ok('T3 one question', ONE_Q(s)); }

  console.log('── Test 4: generic plan letter (no doctor) → not bill ──');
  { const o = await run('es', ['no entiendo una carta que me mandó el plan']);
    ok('T4 NOT bill', !BILL.test(o[0].r.response), o[0].r.response.slice(0, 50)); }

  console.log('── Test 5: multiple issues (medication + doctor change) → ask which first ──');
  { const o = await run('es', ['me subió la medicina y también me cambiaron el doctor']);
    const s = o[0].r.response; ok('T5 asks which is most urgent', /m[aá]s urgente|paso a paso|primero/i.test(s)); ok('T5 NOT bill', !BILL.test(s)); }

  console.log('── Test 6: ZIP already known → doctor issue does not re-ask ZIP ──');
  { const o = await run('es', ['tengo problemas con mi doctor q me lo cambiaron']);
    const s = o[0].r.response; ok('T6 no ZIP re-ask', !/c[oó]digo postal|zip/i.test(s)); ok('T6 NOT bill', !BILL.test(s)); ok('T6 stays Spanish', !/the letter|your plan|I understand\b/i.test(s) || /entiendo|carta|doctor/i.test(s)); }

  console.log('── EN parity ──');
  { const o = await run('en', ['I got a letter from my plan that they changed my doctor']);
    const s = o[0].r.response; console.log('  🤖', s.slice(0, 110));
    ok('EN NOT bill', !/hospital or doctor bill|a bill like that/i.test(s));
    ok('EN provider-change', /\bPCP\b|primary (doctor|care)|network/i.test(s));
    ok('EN one question', ONE_Q(s)); }

  console.log(`\n═══════════════\nTOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS: ' + fails.join(' | '));
  process.exit(FAIL > 0 ? 1 : 0);
})();

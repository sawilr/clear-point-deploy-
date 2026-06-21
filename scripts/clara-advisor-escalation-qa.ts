/* eslint-disable no-console */
// Sawil 2026-06-21 — Combined audit Phase 1 #1A: explicit advisor request must
// OVERRIDE an in-progress flow (esp. the Spanish copay/income cost-flow) and
// immediately collect name + phone. Audit repro: ES "pago muchos copagos" →
// income question → "quiero hablar con un asesor" → WRONG: re-asks income.
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
const ok = (id: string, c: boolean, x = '') => { if (c) PASS++; else { FAIL++; fails.push(id + (x ? ` (${x})` : '')); } console.log(`${c ? '✅' : '❌'} ${id}`); };
const seed = (lang: 'es' | 'en') => ({ ...createInitialState(), language: lang, zipCode: '10594', state: 'NY', zipCodeIsValid: true, step: 'conversation', messages: [] as Any[] });
async function run(lang: 'es' | 'en', turns: string[]) {
  let st: Any = seed(lang); const out: Any[] = [];
  for (const t of turns) {
    st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
    const r = await processMessageAsync(t, st); st = r.newState; out.push({ t, resp: r.response, st });
  }
  return out;
}
// Escalation = asks for name OR phone, and does NOT ask about income.
const ASKS_CONTACT = (s: string) => /\bnombre\b|\bname\b|tel[eé]fono|phone|número/i.test(s);
const ASKS_INCOME = (s: string) => /ingreso|income/i.test(s);
const ESCALATED = (s: string) => ASKS_CONTACT(s) && !ASKS_INCOME(s);

const ADVISOR_VARIANTS_ES = [
  'quiero hablar con un asesor',
  'necesito hablar con alguien',
  'conéctame con un asesor',
  'prefiero hablar con una persona',
  'quiero que me llamen',
  'prefiero que me llamen',
];

(async () => {
  console.log('── A: ES copay flow → advisor override (exact audit repro) ──');
  { const o = await run('es', ['pago muchos copagos', 'quiero hablar con un asesor']);
    console.log('  step1🤖', o[0].resp.slice(0, 90));
    console.log('  step2🤖', o[1].resp.slice(0, 110));
    ok('A escalates after copay (not income)', ESCALATED(o[1].resp), o[1].resp.slice(0, 60)); }

  console.log('── B: ES fresh direct advisor request ──');
  { const o = await run('es', ['quiero hablar con un asesor']);
    console.log('  🤖', o[0].resp.slice(0, 110));
    ok('B fresh escalates', ESCALATED(o[0].resp), o[0].resp.slice(0, 60)); }

  console.log('── C: ES all 6 variants, FRESH ──');
  for (const v of ADVISOR_VARIANTS_ES) {
    const o = await run('es', [v]);
    ok(`C fresh "${v}"`, ESCALATED(o[0].resp), o[0].resp.slice(0, 55));
  }

  console.log('── D: ES all 6 variants, MID copay/income flow ──');
  for (const v of ADVISOR_VARIANTS_ES) {
    const o = await run('es', ['pago muchos copagos', v]);
    ok(`D mid-flow "${v}"`, ESCALATED(o[1].resp), o[1].resp.slice(0, 55));
  }

  console.log('── E: EN regression — fresh advisor ──');
  { const o = await run('en', ['I want to talk to an advisor']);
    console.log('  🤖', o[0].resp.slice(0, 110));
    ok('E EN fresh escalates', ESCALATED(o[0].resp), o[0].resp.slice(0, 60)); }

  console.log('── F: EN copay flow → advisor (does EN also fail mid-flow?) ──');
  { const o = await run('en', ['I pay too many copays', 'I want to talk to an advisor']);
    console.log('  step2🤖', o[1].resp.slice(0, 110));
    ok('F EN mid-flow escalates', ESCALATED(o[1].resp), o[1].resp.slice(0, 60)); }

  console.log('── G: regression guard — educational "asesor" must NOT escalate ──');
  { const o = await run('es', ['¿cómo funciona un asesor?']);
    console.log('  🤖', o[0].resp.slice(0, 100));
    // Should NOT immediately demand name+phone as if escalating a lead.
    ok('G educational does not force contact', !(ASKS_CONTACT(o[0].resp) && /nombre completo|número de teléfono/i.test(o[0].resp)), o[0].resp.slice(0, 55)); }

  console.log(`\n═══════════════\nTOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS:\n  ' + fails.join('\n  '));
  process.exit(FAIL > 0 ? 1 : 0);
})();

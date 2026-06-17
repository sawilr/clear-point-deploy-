/* eslint-disable no-console */
// Sawil 2026-06-17 — Clara reasoning-engine acceptance suite (mission A–L).
// Drives processMessageAsync (deterministic structural-first owns these inputs,
// so NO LLM is hit). Prints REAL Clara transcripts + pass/fail. EN + ES.
// Run: npx tsx scripts/clara-mission-ld.ts
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';

type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
const ok = (id: string, cond: boolean) => { if (cond) { PASS++; console.log(`   ✅ ${id}`); } else { FAIL++; fails.push(id); console.log(`   ❌ ${id}`); } };

const ASKS_EXTRA_HELP = (s: string) =>
  /(¿\s*(tiene|tienes|cuenta con|ya tiene)[^?]*\b(extra help|ayuda extra)\b[^?]*\?)/i.test(s)
  || /\bdo you (also )?have\b[^?]*\bextra help\b/i.test(s) || /\bhave extra help\?/i.test(s);
const MENTIONS_EXTRA_HELP = (s: string) => /(extra help|ayuda extra)/i.test(s);
const DONT_PAY = (s: string) => /(no .*(la )?pague.*todav|no le recomiendo pagar|don'?t pay .*yet|do not pay .*yet|antes de (que )?pag|before you pay|before paying)/i.test(s);
const PROTECTION = (s: string) => /(qmb|protecc|protection|no .*deber[ií]an cobr|should not .*(bill|charge)|reduc|eliminan|remove|cubiert|covered)/i.test(s);
const BILL_SOURCE_Q = (s: string) => /(doctor|hospital).{0,45}(farmacia|pharmacy|laboratorio|lab|ambulanc|plan)/i.test(s);
const ADVISOR = (s: string) => /(asesor|advisor)/i.test(s);
const ONE_Q = (s: string) => (s.match(/\?/g) || []).length <= 1;
const PRIVACY_STOP = (s: string) => /(no env[ií]e|no comparta|por su seguridad|ocult|do not (send|share)|for your safety)/i.test(s);
const NO_PLAN_REC = (s: string) => !/le recomiendo el plan|recommend (the|this) .*plan|el mejor plan (es|para usted)|switch you to/i.test(s);
const NO_ZIP_REASK = (s: string) => !/c[oó]digo postal|zip code|su zip\b/i.test(s);
const ES_REPLY = (s: string) => /[ñ¿¡áéíóú]|gracias|factura|usted|asesor|farmacia/i.test(s) && !/\bthank you\b/i.test(s);
const EN_REPLY = (s: string) => /\b(the|your|bill|please|advisor|thank you|pharmacy)\b/i.test(s) && !/[ñ¿¡]/.test(s);
const PHARMACY_WF = (s: string) => /(farmacia|pharmacy|autorizaci[oó]n previa|prior authorization|no est[aá] cubiert|not covered|formulary|precio|price)/i.test(s);

async function run(lang: 'es' | 'en', seed: string[], turns: string[], patch: Any = {}) {
  let st: Any = {
    ...createInitialState(), language: lang, zipCode: '11122', state: 'NY', zipCodeIsValid: true,
    step: 'conversation',
    messages: seed.map((c, i) => ({ role: i % 2 === 0 ? 'user' : 'bot', content: c, timestamp: Date.now() })),
    ...patch,
  };
  let last: Any;
  for (const t of turns) {
    st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
    last = await processMessageAsync(t, st); st = last.newState;
  }
  return last;
}
const show = (id: string, user: string, r: Any) =>
  console.log(`\n[${id}] USER: ${user}\n        CLARA: ${r.response.replace(/\n+/g, ' ').slice(0, 240)}`);

(async () => {
  // A — Medicare+Medicaid+bill → no Extra Help question (ES + EN)
  { const r = await run('es', [], ['Tengo facturas y tengo Medicaid y Medicare.']); show('A-ES', 'facturas + dual', r);
    ok('A-ES no Extra Help question', !ASKS_EXTRA_HELP(r.response) && MENTIONS_EXTRA_HELP(r.response) && BILL_SOURCE_Q(r.response)); }
  { const r = await run('en', [], ['I have bills and I have Medicaid and Medicare.']); show('A-EN', 'bills + dual', r);
    ok('A-EN no Extra Help question', !ASKS_EXTRA_HELP(r.response) && EN_REPLY(r.response)); }

  // B — Medicare+Medicaid+copay → QMB/MSP reasoning (ES + EN)
  { const r = await run('es', [], ['Me cobraron un copago en el doctor y tengo Medicaid y Medicare.']); show('B-ES', 'copay + dual', r);
    ok('B-ES QMB/MSP reasoning + don\'t pay', PROTECTION(r.response) && DONT_PAY(r.response)); }
  { const r = await run('en', [], ['They charged me a copay at the doctor and I have Medicaid and Medicare.']); show('B-EN', 'copay + dual', r);
    ok('B-EN QMB/MSP reasoning', PROTECTION(r.response) && EN_REPLY(r.response)); }

  // C — "ya te dije" → no restart
  { const r = await run('es', ['Tengo facturas y tengo Medicaid y Medicare.', 'Entiendo…'], ['Ya te dije que tengo los dos.'], { dualEligible: true, hasMedicaid: true });
    show('C', 'ya te dije', r); ok('C no restart, keeps dual, no Extra Help Q', r.newState.dualEligible === true && !ASKS_EXTRA_HELP(r.response)); }

  // D — "no sabes lo que hablas" → apologize + restate + continue
  { const r = await run('es', ['Tengo facturas y tengo Medicaid y Medicare.', 'Entiendo…'], ['No sabes lo que hablas.'], { dualEligible: true, hasMedicaid: true });
    show('D', 'no sabes lo que hablas', r); ok('D apologizes + restates + asks source', /(disculp|raz[oó]n)/i.test(r.response) && BILL_SOURCE_Q(r.response)); }

  // E — offers Medicare number → privacy stop
  { const r = await run('es', [], ['Mi número de Medicare es 1EG4-TE5-MK72.']); show('E', 'sends Medicare #', r);
    ok('E privacy stop', PRIVACY_STOP(r.response)); }

  // F — "cuál plan me conviene" → advisor escalation
  { const r = await run('es', ['Tengo Medicaid y Medicare.', 'Gracias…'], ['Entonces dime cuál plan me conviene.'], { dualEligible: true, hasMedicaid: true });
    show('F', 'which plan is best', r); ok('F no plan rec → advisor', NO_PLAN_REC(r.response) && ADVISOR(r.response)); }

  // G — ZIP already given → don't re-ask
  { const r = await run('es', [], ['Tengo facturas y tengo Medicaid y Medicare.']); show('G', 'bill (ZIP 11122 known)', r);
    ok('G no ZIP re-ask', NO_ZIP_REASK(r.response)); }

  // H — pharmacy says medication not covered → pharmacy workflow (ES + EN)
  { const r = await run('es', [], ['La farmacia dice que mi medicamento no está cubierto y tengo Medicaid y Medicare.']); show('H-ES', 'pharmacy not covered', r);
    ok('H-ES pharmacy workflow', PHARMACY_WF(r.response) && !ASKS_EXTRA_HELP(r.response)); }
  { const r = await run('en', [], ['The pharmacy says my medication is not covered and I have Medicare and Medicaid.']); show('H-EN', 'pharmacy not covered', r);
    ok('H-EN pharmacy workflow', PHARMACY_WF(r.response)); }

  // I — QMB user gets doctor bill → QMB billing protection
  { const r = await run('es', [], ['Tengo QMB y me llegó una factura del doctor.']); show('I', 'QMB + doctor bill', r);
    ok('I QMB protection awareness', /qmb/i.test(r.response) && DONT_PAY(r.response)); }

  // J / K — language stays
  { const r = await run('es', [], ['Tengo Medicaid y Medicare.']); ok('J Spanish stays Spanish', ES_REPLY(r.response)); }
  { const r = await run('en', [], ['I have Medicaid and Medicare.']); ok('K English stays English', EN_REPLY(r.response)); }

  console.log(`\n═════════════════════════════════════════`);
  console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS: ' + fails.join(' | '));
  process.exit(FAIL > 0 ? 1 : 0);
})();

/* eslint-disable no-console */
// Sawil 2026-06-18 — Clara MEDICAID INTENT acceptance suite. Drives the
// deterministic engine (processMessageAsync). Asserts: no dual inference from a
// generic Medicaid mention, no automatic Extra Help unless possession is clear,
// LOST/SEEKING/clarify handled, correction admitted, ClearPoint scope rule, no menu.
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
const ok = (id: string, cond: boolean, extra='') => { if (cond) { PASS++; } else { FAIL++; fails.push(id + (extra?` (${extra})`:'')); } console.log(`${cond?'✅':'❌'} ${id}`); };
const seed = (lang:'es'|'en', patch:Any={}) => ({ ...createInitialState(), language:lang, zipCode:'10550', state:'NY', zipCodeIsValid:true, step:'conversation', messages:[] as Any[], ...patch });
async function run(lang:'es'|'en', turns:string[], patch:Any={}) {
  let st:Any = seed(lang, patch); const out:Any[]=[];
  for (const t of turns) { st.messages=[...st.messages,{role:'user',content:t,timestamp:Date.now()}]; const r=await processMessageAsync(t,st); st=r.newState; out.push({t,r,st}); }
  return out;
}
const NO_EXTRA = (s:string)=>!/(ayuda extra|extra help)/i.test(s);
const NO_DUAL_FACT = (st:Any)=> st.dualEligible!==true && st.hasMedicaid!==true;
const SCOPE = (s:string)=>/no procesa solicitudes de medicaid|does not process medicaid applications/i.test(s);
const NO_MENU = (s:string)=>!/(factura[,\s].*doctor[,\s].*medicament|bill[,\s].*doctor[,\s].*medication)/i.test(s);
const ONE_Q = (s:string)=>(s.match(/\?/g)||[]).length<=1;

(async()=>{
  console.log('\n── EXACT LIVE TRANSCRIPT (ES) ──');
  { const c = await run('es', ['Si por favor y me pueden ayudar con medicaid','No si me ayudar con el medicaid creo q lo perdi pero estas asumiendo y dando info de mas']);
    const a = c[0].r.response, b = c[1].r.response;
    console.log('T1🤖', a.replace(/\n+/g,' ').slice(0,180));
    console.log('T2🤖', b.replace(/\n+/g,' ').slice(0,180));
    ok('T1 no dual fact', NO_DUAL_FACT(c[0].st), `dual=${c[0].st.dualEligible} mcd=${c[0].st.hasMedicaid}`);
    ok('T1 no Extra Help', NO_EXTRA(a));
    ok('T1 scope rule', SCOPE(a));
    ok('T1 asks apply-or-lost', /perdi|perdió|aplicar|apply|lost/i.test(a) && ONE_Q(a));
    ok('T1 no menu', NO_MENU(a));
    ok('T2 no dual fact', NO_DUAL_FACT(c[1].st));
    ok('T2 apologizes', /tiene raz[oó]n|disculpe|i apologize|you'?re right/i.test(b));
    ok('T2 lost workflow', /carta|letter|perdi|perdió|lost/i.test(b));
    ok('T2 no Extra Help', NO_EXTRA(b)); ok('T2 scope', SCOPE(b)); ok('T2 no menu', NO_MENU(b));
  }

  type Case = { id:string; lang:'es'|'en'; turns:string[]; check:(out:Any)=>void };
  const cases: Case[] = [
    { id:'1-help-es', lang:'es', turns:['me pueden ayudar con Medicaid'], check:(o)=>{const s=o[0].r.response; ok('1 no dual', NO_DUAL_FACT(o[0].st)); ok('1 no extra', NO_EXTRA(s)); ok('1 clarify apply/lost', /perdi|perdió|aplicar/i.test(s)); ok('1 scope', SCOPE(s)); }},
    { id:'2-lost-es', lang:'es', turns:['creo que perdí Medicaid'], check:(o)=>{const s=o[0].r.response; ok('2 no dual', NO_DUAL_FACT(o[0].st)); ok('2 no extra', NO_EXTRA(s)); ok('2 lost+scope', SCOPE(s) && /carta|aviso/i.test(s)); ok('2 no menu', NO_MENU(s)); }},
    { id:'3-apply-es', lang:'es', turns:['quiero aplicar para Medicaid'], check:(o)=>{const s=o[0].r.response; ok('3 no dual', NO_DUAL_FACT(o[0].st)); ok('3 no extra', NO_EXTRA(s)); ok('3 scope', SCOPE(s)); }},
    { id:'4-qualify-es', lang:'es', turns:['cómo califico para Medicaid'], check:(o)=>{const s=o[0].r.response; ok('4 no dual', NO_DUAL_FACT(o[0].st)); ok('4 no extra', NO_EXTRA(s)); }},
    { id:'5-has-es', lang:'es', turns:['tengo Medicare y Medicaid'], check:(o)=>{ ok('5 DUAL allowed', o[0].st.dualEligible===true); ok('5 mentions extra help', /ayuda extra|extra help/i.test(o[0].r.response)); }},
    { id:'8-deny-es', lang:'es', turns:['no tengo Medicaid'], check:(o)=>{const s=o[0].r.response; ok('8 has=false', o[0].st.hasMedicaid===false || NO_DUAL_FACT(o[0].st)); ok('8 no extra', NO_EXTRA(s)); ok('8 no dual', o[0].st.dualEligible!==true); }},
    { id:'9-lost-followup-es', lang:'es', turns:['me pueden ayudar con Medicaid','lo perdí'], check:(o)=>{const s=o[1].r.response; ok('9 lost workflow', SCOPE(s) && /carta|aviso/i.test(s)); ok('9 no dual', NO_DUAL_FACT(o[1].st)); }},
    { id:'10a-help-en', lang:'en', turns:['Can you help me with Medicaid?'], check:(o)=>{const s=o[0].r.response; ok('10a no dual', NO_DUAL_FACT(o[0].st)); ok('10a no extra', NO_EXTRA(s)); ok('10a clarify', /apply|lost/i.test(s)); ok('10a scope', SCOPE(s)); }},
    { id:'10b-lost-en', lang:'en', turns:['I think I lost Medicaid'], check:(o)=>{const s=o[0].r.response; ok('10b lost', /letter|notice/i.test(s)); ok('10b no dual', NO_DUAL_FACT(o[0].st)); ok('10b no extra', NO_EXTRA(s)); }},
    { id:'10c-apply-en', lang:'en', turns:['I need to apply for Medicaid'], check:(o)=>{const s=o[0].r.response; ok('10c no dual', NO_DUAL_FACT(o[0].st)); ok('10c scope', SCOPE(s)); }},
    { id:'10d-qualify-en', lang:'en', turns:['How do I qualify for Medicaid?'], check:(o)=>{ ok('10d no dual', NO_DUAL_FACT(o[0].st)); ok('10d no extra', NO_EXTRA(o[0].r.response)); }},
    { id:'10e-has-en', lang:'en', turns:['I have Medicare and Medicaid'], check:(o)=>{ ok('10e DUAL allowed', o[0].st.dualEligible===true); }},
    { id:'edu-es', lang:'es', turns:['qué es Medicaid'], check:(o)=>{const s=o[0].r.response; ok('edu no dual', NO_DUAL_FACT(o[0].st)); ok('edu explains', /programa estatal y federal|state and federal/i.test(s)); }},
    { id:'letter-source-not-hijacked', lang:'es', turns:['me llego una carta que no entiendo','de medicaid'], check:(o)=>{ const s=o[1].r.response; ok('source not dual', NO_DUAL_FACT(o[1].st)); ok('source no extra', NO_EXTRA(s)); }},
  ];
  for (const c of cases) { console.log(`\n── ${c.id} ──`); const o = await run(c.lang, c.turns); console.log('🤖', o[o.length-1].r.response.replace(/\n+/g,' ').slice(0,170)); c.check(o); }

  console.log('\n── A1 ASSUMPTION CHALLENGE (competitive audit EN-6) ──');
  { const o = await run('en', ['i have medicare and medicaid and i got bills', 'you are assuming too much']);
    const s = o[1].r.response;
    ok('A1-EN bare challenge resets (no double-down)', /start fresh|i'?m sorry|you'?re right/i.test(s) && NO_DUAL_FACT(o[1].st) && NO_EXTRA(s)); }
  { const o = await run('es', ['tengo medicare y medicaid', 'no, estás asumiendo demasiado']);
    const s = o[1].r.response;
    ok('A1-ES bare challenge resets', /empecemos de nuevo|tiene raz[oó]n|disculpe/i.test(s) && NO_DUAL_FACT(o[1].st) && NO_EXTRA(s)); }
  { const o = await run('en', ['i have medicare and medicaid', 'no you are wrong']);
    ok('A1 "no you are wrong" resets', NO_DUAL_FACT(o[1].st)); }

  console.log(`\n═══════════════════════════════`);
  console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS: ' + fails.join(' | '));
  process.exit(FAIL>0?1:0);
})();

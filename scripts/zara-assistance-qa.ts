/* eslint-disable no-console */
// Sawil 2026-06-18 — Zara grouped-assistance submenu acceptance suite.
// Tests the exported pure functions that the button-dispatch + free-text
// routing rely on: getMedicareEducation (button content), assistanceTopicToEdu
// (free-text routing), detectMedicareTopic (keyword label), buildAssistanceSubmenu.
(globalThis as any).React = { createElement: (...a:any[]) => ({ __el: a[0] }) };
(async () => {
  const Z:any = await import('../src/components/ChatBot.tsx');
  const { getMedicareEducation, assistanceTopicToEdu, detectMedicareTopic } = Z;
  let PASS=0, FAIL=0; const fails:string[]=[];
  const ok=(id:string,c:boolean,x='')=>{ if(c)PASS++; else {FAIL++; fails.push(id+(x?` (${x})`:''));} console.log(`${c?'✅':'❌'} ${id}`); };
  const txt=(msgs:any[])=>msgs.map(m=>m.text||'').join(' ');
  const opts=(msgs:any[])=>msgs.flatMap(m=>(m.options||[]).map((o:any)=>o.value));
  const labels=(msgs:any[])=>msgs.flatMap(m=>(m.options||[]).map((o:any)=>o.label));
  // free-text routing as the real handler does it: detectMedicareTopic -> assistanceTopicToEdu
  const route=(t:string,lang:'es'|'en')=>assistanceTopicToEdu(t, detectMedicareTopic(t,lang), lang);

  console.log('\n── 1. Grouped button -> SUBMENU (not a dump) ──');
  for (const lang of ['en','es'] as const) {
    const sm = getMedicareEducation('edu_assistance_menu', lang, 'NY');
    const cc = getMedicareEducation('edu_cost_help', lang, 'NY');
    const want = ['edu_medicaid','edu_msp','edu_extra_help','request_review','edu_back_to_topics'];
    ok(`1.${lang} assistance_menu has 5 submenu options`, want.every(v=>opts(sm).includes(v)), opts(sm).join(','));
    ok(`1.${lang} cost_help now = submenu (no QMB/EPIC dump)`, opts(cc).join(',')===opts(sm).join(',') && !/QMB|EPIC|QI-1|\$1,/.test(txt(cc)));
    ok(`1.${lang} submenu does NOT explain all 3 at once`, !/QMB|SLMB|Extra Help.*Medicaid.*MSP/i.test(txt(sm)));
    console.log(`   [${lang}] submenu labels:`, labels(sm).join(' | '));
  }

  console.log('\n── 2-4 & 7. Free-text routing ──');
  ok('2 "I need Medicaid" -> edu_medicaid', route('I need Medicaid','en')==='edu_medicaid', route('I need Medicaid','en'));
  ok('2es "necesito Medicaid" -> edu_medicaid', route('necesito Medicaid','es')==='edu_medicaid', route('necesito Medicaid','es'));
  ok('3 "stop Medicare taking money from my Social Security" -> edu_msp', route('How can I stop Medicare taking money from my Social Security?','en')==='edu_msp', route('How can I stop Medicare taking money from my Social Security?','en'));
  ok('3es "me sacan de mi seguro social" -> edu_msp', route('me sacan dinero de mi cheque del seguro social','es')==='edu_msp', route('me sacan dinero de mi cheque del seguro social','es'));
  ok('4 "Help with prescriptions" -> edu_extra_help', route('Help with prescriptions','en')==='edu_extra_help', route('Help with prescriptions','en'));
  ok('4es "ayuda con medicamentos" -> edu_extra_help', route('ayuda con medicamentos','es')==='edu_extra_help', route('ayuda con medicamentos','es'));
  ok('7 "all three programs together" -> submenu', route('tell me about all three programs','en')==='edu_assistance_menu', route('tell me about all three programs','en'));
  ok('7es "ayuda con costos" -> submenu', route('necesito ayuda con costos de medicare','es')==='edu_assistance_menu', route('necesito ayuda con costos de medicare','es'));

  console.log('\n── Single-program handlers explain ONE program + compliance ──');
  for (const lang of ['en','es'] as const) {
    const mcd=getMedicareEducation('edu_medicaid',lang,'NY'); const msp=getMedicareEducation('edu_msp',lang,'NY'); const eh=getMedicareEducation('edu_extra_help',lang,'NY');
    ok(`mcd.${lang} disclaimer (agency decides)`, /no es una decisión final|not a final eligibility|state agency|agencia/i.test(txt(mcd)));
    ok(`msp.${lang} mentions Part B premium`, /part b premium|prima de (la )?parte b/i.test(txt(msp)));
    ok(`eh.${lang} mentions Part D drug`, /part d|medicamento|prescription|drug/i.test(txt(eh)));
    ok(`msp.${lang} single program (no Medicaid+ExtraHelp dump)`, !/Medicaid is a separate program|Medicaid es un programa separado/i.test(txt(msp)));
  }

  console.log('\n── 6. State context: NY content rendered, no state re-ask ──');
  for (const lang of ['en','es'] as const) {
    const msp=getMedicareEducation('edu_msp',lang,'NY');
    ok(`6.${lang} uses NY (no "what state" re-ask)`, /new york/i.test(txt(msp)) && !/what state|qu[eé] estado|c[oó]digo postal|zip code/i.test(txt(msp)));
  }

  console.log('\n── 5. Language: labels + answers stay in chosen language ──');
  const smEs=getMedicareEducation('edu_assistance_menu','es','NY'); const smEn=getMedicareEducation('edu_assistance_menu','en','NY');
  ok('5 ES submenu labels Spanish', labels(smEs).some((l:string)=>/Programa de Ahorro|Volver al menú/.test(l)));
  ok('5 EN submenu labels English', labels(smEn).some((l:string)=>/Medicare Savings Program|Back to main menu/.test(l)));
  ok('5 ES answer Spanish', /programa|ayuda|estado/i.test(txt(getMedicareEducation('edu_medicaid','es','NY'))) && !/\bthe state agency must\b/.test(txt(getMedicareEducation('edu_medicaid','es','NY'))));

  console.log(`\n═════════════════════════\nTOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS: '+fails.join(' | '));
  process.exit(FAIL>0?1:0);
})();

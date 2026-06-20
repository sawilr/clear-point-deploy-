/* eslint-disable no-console */
// Sawil 2026-06-18 — Callback lead-capture acceptance suite (15 cases).
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine';
import { buildLeadNote } from '../src/lib/orchestrator/leadNoteBuilder';
import { containsSensitiveData } from '../src/lib/sensitiveGuard';
type Any = any;
let PASS=0, FAIL=0; const fails:string[]=[];
const ok=(id:string,c:boolean,x='')=>{ if(c)PASS++; else {FAIL++; fails.push(id+(x?` (${x})`:''));} console.log(`${c?'✅':'❌'} ${id}`); };
const seedName=(l:'es'|'en')=>({language:l, zipCode:'10550', state:'NY', advisorHandoffStarted:true, pendingAdvisorHandoff:true, conversationClosed:false, lastBotIntent:'handoff_asking_name', turnCount:6, messages:[{role:'bot',content:l==='es'?'¿cuál es su nombre?':'what is your name?',timestamp:0}]});
function walk(l:'es'|'en', turns:string[]) { let st:Any=seedName(l); const log:Any[]=[]; for(const t of turns){const r=processMessage(t,st); st=r.newState; log.push({u:t,bot:r.response,st});} return {st,log}; }
const allBots=(log:Any[])=>log.map(x=>x.bot).join(' ');
const noChips=(log:Any[])=>log.every(x=>!x.st.quickReplies || x.st.quickReplies.length===0);

console.log('── 1/3/13. First + last name (ES & EN) ──');
{ const es=walk('es',['Mario']); ok('1 ES asks apellido after first name', /apellido/i.test(es.log[0].bot));
  const es2=processMessage('Rossi', es.st); ok('1 ES full name = Mario Rossi', /Mario Rossi/i.test(String(es2.newState.name)));
  const en=walk('en',['John']); ok('3 EN asks last name', /last name/i.test(en.log[0].bot)); }
console.log('── 2. Only first name → asks last name ──');
{ const r=walk('es',['Maria']); ok('2 single name → asks apellido, not finalized', /apellido/i.test(r.log[0].bot) && r.st.lastBotIntent==='handoff_asking_lastname'); }
console.log('── name+phone one message still asks last name (the live bug) ──');
{ const r=walk('es',['Mario 6463125847']); ok('bug single-name+phone → asks apellido', /apellido/i.test(r.log[0].bot) && r.st.phoneNumber==='6463125847'); }

console.log('── 4/5/6/7/8/9/10/11. Full flow checks (DOB removed, audit A4) ──');
{ const r=walk('es',['Mario','Rossi','6463125847','en la mañana','tengo una factura del hospital']); const bots=allBots(r.log);
  ok('4 never re-asks preferred language', !/idioma|prefiere (espa|ingl)|preferred language|english or spanish/i.test(bots));
  ok('5 never re-asks ZIP', !/c[oó]digo postal|zip code|su zip/i.test(bots));
  ok('6 callback does NOT ask DOB (ES)', !/fecha de nacimiento|date of birth/i.test(bots));
  ok('8 asks best time to call', /mejor horario/i.test(bots));
  ok('9 asks topic for advisor', /tema espec[ií]fico que desea que el asesor sepa/i.test(bots));
  ok('10 no buttons/menus during capture', noChips(r.log));
  ok('11 no SSN/MBI/bank/doc asks', !/(d[eé]me|env[ií]e|cu[aá]l es su)[^.?!]{0,20}(seguro social|n[uú]mero de medicare|bancari|tarjeta|documento)/i.test(bots));
  ok('captures fields (no DOB)', r.st.dateOfBirth===undefined && /ma[ñn]ana/i.test(r.st.bestTimeToCall) && /factura/i.test(r.st.advisorTopic)); }
console.log('── 7. EN callback also does not ask DOB ──');
{ const r=walk('en',['John','Smith','3104826537','after 3','a bill from my doctor']); const bots=allBots(r.log);
  ok('7 callback does NOT ask DOB (EN)', !/date of birth|fecha de nacimiento/i.test(bots) && /best time/i.test(bots)); }

console.log('── 12. CRM summary fields ──');
{ const r=walk('es',['Mario','Rossi','6463125847','en la mañana','una factura del hospital','saltar','no']);
  const note = buildLeadNote({ state:r.st, transcript:(r.st.messages||[]).map((m:Any)=>({sender:m.role==='bot'?'bot':'user',text:m.content})) }).noteText;
  ok('12 note has Name', /Name: Mario Rossi/.test(note));
  ok('12 note has Phone', /Phone: 6463125847/.test(note));
  ok('12 note has best time', /Best callback time: en la mañana/i.test(note));
  ok('12 note has topic', /Topic for advisor: una factura/i.test(note));
  ok('12 note has language (memory)', /Language: Spanish/.test(note));
  ok('12 note has ZIP (memory)', /ZIP code: 10550/.test(note));
  ok('12 note DOB not collected in chat', /Date of birth: not provided/.test(note));
  ok('12 note states sensitive data avoided', /SSN.*Medicare ID.*MBI.*banking|do NOT confirm|not requested for safety/i.test(note));
  ok('12 note has NO raw SSN/MBI', !/\b\d{3}-\d{2}-\d{4}\b/.test(note)); }

console.log('── 14/15. PHI guard: phone + DOB NOT blocked ──');
ok('14 phone NOT blocked', containsSensitiveData('6463125847')===false && containsSensitiveData('my number is 310-482-6537')===false);
ok('15 DOB NOT blocked', ['05/12/1950','12-05-1950','May 12 1950','1950','05/12/50'].every(d=>containsSensitiveData(d)===false));
ok('15b SSN still blocked (control)', containsSensitiveData('123-45-6789')===true);

console.log(`\n═══════════════\nTOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: '+fails.join(' | '));
process.exit(FAIL>0?1:0);

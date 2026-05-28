// V15 smoke harness — verifies the 4-step state machine end-to-end.
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== STEP 1 — LANGUAGE PICK ===');
let s = createInitialState();
check('initial step is asking_language', s.step === 'asking_language');
check('initial language is null', s.language === null);

const r1 = processMessage('english', s);
check('"english" → language=en', r1.newState.language === 'en');
check('"english" → step=asking_name', r1.newState.step === 'asking_name');
check('"english" → bot asks first name', /first name/i.test(r1.response));

s = createInitialState();
const r1es = processMessage('español', s);
check('"español" → language=es', r1es.newState.language === 'es');
check('"español" → step=asking_name', r1es.newState.step === 'asking_name');
check('"español" → bot asks nombre in Spanish', /nombre/i.test(r1es.response));

s = createInitialState();
const r1bad = processMessage('hola', s);
check('"hola" alone → still asking_language', r1bad.newState.step === 'asking_language');
check('"hola" → bot asks bilingual', /select|seleccione/i.test(r1bad.response));

console.log('\n=== STEP 2 — NAME ===');
s = processMessage('english', createInitialState()).newState;
const r2 = processMessage('Maria', s);
check('"Maria" → name captured', r2.newState.name === 'Maria');
check('"Maria" → step=asking_zip', r2.newState.step === 'asking_zip');
check('"Maria" → bot asks ZIP', /zip code/i.test(r2.response));

s = processMessage('english', createInitialState()).newState;
const r2alt = processMessage('my name is John Smith', s);
check('"my name is John Smith" → name=John', r2alt.newState.name === 'John');

s = processMessage('español', createInitialState()).newState;
const r2es = processMessage('Soy Carlos', s);
check('"Soy Carlos" ES → name=Carlos', r2es.newState.name === 'Carlos');

console.log('\n=== STEP 3 — ZIP VALIDATION ===');
// EN path through NY ZIP
s = processMessage('Maria', processMessage('english', createInitialState()).newState).newState;
const r3ny = processMessage('10001', s);
check('NY ZIP 10001 → state=NY', r3ny.newState.state === 'NY');
check('NY ZIP → isValidState=true', r3ny.newState.isValidState === true);
check('NY ZIP → step=asking_problem', r3ny.newState.step === 'asking_problem');
check('NY ZIP → bot asks problem', /tell me what|going on/i.test(r3ny.response));

// FL ZIP
s = processMessage('John', processMessage('english', createInitialState()).newState).newState;
const r3fl = processMessage('33101', s);
check('FL ZIP 33101 → state=FL', r3fl.newState.state === 'FL');

// CT ZIP
s = processMessage('Pat', processMessage('english', createInitialState()).newState).newState;
const r3ct = processMessage('06010', s);
check('CT ZIP 06010 → state=CT', r3ct.newState.state === 'CT');

// NJ ZIP
s = processMessage('Sam', processMessage('english', createInitialState()).newState).newState;
const r3nj = processMessage('07001', s);
check('NJ ZIP 07001 → state=NJ', r3nj.newState.state === 'NJ');

// Out-of-area ZIP (CA = 90210)
s = processMessage('Alex', processMessage('english', createInitialState()).newState).newState;
const r3ca = processMessage('90210', s);
check('CA ZIP 90210 → isValidState=false', r3ca.newState.isValidState === false);
check('CA ZIP → bot says only serve NY/NJ/FL/CT', /only serve|only.+ny/i.test(r3ca.response));
check('CA ZIP → still advances to asking_problem', r3ca.newState.step === 'asking_problem');

// Bad ZIP format
s = processMessage('Tom', processMessage('english', createInitialState()).newState).newState;
const r3bad = processMessage('abc', s);
check('"abc" → bot re-asks 5-digit ZIP', /5-digit/i.test(r3bad.response));
check('Bad ZIP → still asking_zip', r3bad.newState.step === 'asking_zip');

console.log('\n=== STEP 4 — PROBLEM CONVERSATION ===');
function fullFlow(text) {
  let st = processMessage('english', createInitialState()).newState;
  st = processMessage('Maria', st).newState;
  st = processMessage('10001', st).newState;
  return processMessage(text, st);
}
function fullFlowEs(text) {
  let st = processMessage('español', createInitialState()).newState;
  st = processMessage('Maria', st).newState;
  st = processMessage('10001', st).newState;
  return processMessage(text, st);
}

const rb = fullFlow('I got a bill from my doctor');
check('"I got a bill" → intent=bill', rb.newState.intent === 'bill');
check('"I got a bill" → bot asks doctor/pharmacy/plan', /doctor|hospital|pharmacy|plan/i.test(rb.response));
check('"I got a bill" → bot uses name (Maria)', /Maria/.test(rb.response));

const rl = fullFlow('I got a letter from Medicare');
check('"I got a letter" → intent=letter', rl.newState.intent === 'letter');
check('"letter" → bot asks ANOC/Medicaid/Extra Help/IRMAA/collection', /anoc|eoc|medicaid|extra help|irmaa|collection/i.test(rl.response));

const rd = fullFlow('my medication is too expensive');
check('"medication expensive" → intent=drug', rd.newState.intent === 'drug');
check('"drug" → bot asks cost/coverage/prior auth', /cost|covered|prior auth/i.test(rd.response));

const rc = fullFlow('I want to know if my doctor is covered');
check('"doctor covered" → intent=coverage', rc.newState.intent === 'coverage');

const re = fullFlow('I want to change my plan');
check('"change plan" → intent=enrollment', re.newState.intent === 'enrollment');

const ra = fullFlow('my drug was denied I want to appeal');
check('"denied appeal" → intent=appeal', ra.newState.intent === 'appeal');

console.log('\n=== EMOTION ROUTING ===');
const rgr = fullFlow('my husband passed away last week');
check('grieving → response is sympathetic + SSA number', /sorry.+loss/i.test(rgr.response) && /1-800-772-1213/.test(rgr.response));

const rfr = fullFlow('I am so frustrated nobody helps me');
check('frustrated → response acknowledges + asks more', /frustration|let me help/i.test(rfr.response));

console.log('\n=== SPANISH FLOW ===');
const resb = fullFlowEs('me llegaron billes');
check('ES "billes" → intent=bill', resb.newState.intent === 'bill');
check('ES "billes" → response in Spanish', /factura|m[eé]dico|farmacia|plan/i.test(resb.response));

const resl = fullFlowEs('me llegó una carta de renovación');
check('ES "carta renovación" → intent=letter', resl.newState.intent === 'letter');

console.log('\n=== AUTO-CORRECTION ===');
const rt = fullFlow('me llegaron billes y no entiendo');
check('typo "billes" still routes to bill', rt.newState.intent === 'bill');

const rt2 = fullFlow('necesito ayuda con mis medicamentoos');
check('typo "medicamentoos" still routes to drug', rt2.newState.intent === 'drug');

console.log('\n=== NAME EXTRACTION EDGE CASES ===');
function step2(input) {
  const s = processMessage('english', createInitialState()).newState;
  return processMessage(input, s).newState.name;
}
check('"Hi I am Carlos" → Carlos', step2('Hi I am Carlos') === 'Carlos');
check('"my name is Sarah" → Sarah', step2('my name is Sarah') === 'Sarah');
check('"Pedro Lopez" → Pedro', step2('Pedro Lopez') === 'Pedro');
check('"MARIA" → Maria (cap normalize)', step2('MARIA') === 'Maria');

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

// Wave 25 — Audit-driven rebuild verification.
// Acceptance criteria from Sawil's mega-prompt.

import {
  processMessage,
  createInitialState,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== ENTRY FLOW: language → natural ZIP → open question ===');
let s = createInitialState();
let r = processMessage('english', s);
s = r.newState;
check('EN: step → asking_zip_natural', s.step === 'asking_zip_natural');
check('EN: bot asks ZIP naturally',
  /zip code/i.test(r.response));
check('EN: bot does NOT show 7 chips',
  !s.quickReplies || s.quickReplies.length === 0);
check('EN: bot wording is short (<200 chars)', r.response.length < 200);

s = createInitialState();
r = processMessage('español', s);
s = r.newState;
check('ES: step → asking_zip_natural', s.step === 'asking_zip_natural');
check('ES: bot asks ZIP naturally', /c[oó]digo postal|zip code/i.test(r.response));
check('ES: bot does NOT show chips', !s.quickReplies || s.quickReplies.length === 0);
check('ES: usa "usted" / no usa "tú"', !/\bt[uú]\b/i.test(r.response));

console.log('\n=== ZIP HANDLING: refusal continues ===');
s = createInitialState();
s = processMessage('español', s).newState;
const rR = processMessage('no quiero', s);
check('ZIP refused: zipRefused=true', rR.newState.zipRefused === true);
check('ZIP refused: advances to asking_topic', rR.newState.step === 'asking_topic');
check('ZIP refused: bot asks how to help',
  /en qu[eé] le puedo ayudar/i.test(rR.response));

console.log('\n=== ZIP HANDLING: valid ZIP captures + advances ===');
s = createInitialState();
s = processMessage('english', s).newState;
const rZ = processMessage('10001', s);
check('ZIP 10001: zipCode set', rZ.newState.zipCode === '10001');
check('ZIP 10001: state=NY', rZ.newState.state === 'NY');
check('ZIP 10001: advances to asking_topic', rZ.newState.step === 'asking_topic');
check('ZIP captured: bot asks open question',
  /how can i help/i.test(rZ.response));

console.log('\n=== ZIP HANDLING: user jumps straight to topic ===');
s = createInitialState();
s = processMessage('español', s).newState;
const rJ = processMessage('mi doctor ya no acepta el plan', s);
check('Direct topic: intent set', rJ.newState.intent && rJ.newState.intent !== 'general');
check('Direct topic: advances to conversation', rJ.newState.step === 'conversation');

console.log('\n=== NEW CATEGORY: ID card ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState; // refuse ZIP
const rId = processMessage('I lost my plan card', s);
check('ID card: serviceCategory=id_card', rId.newState.serviceCategory === 'id_card');
check('ID card: routingLevel=A (resolves)', rId.newState.routingLevel === 'A');
check('ID card: bot mentions Member Services',
  /member services|carrier portal|portal del carrier/i.test(rId.response));
check('ID card: warns NOT to send Medicare ID',
  /medicare id|medicare/i.test(rId.response));
check('ID card: does NOT force advisor handoff', !rId.needsHuman);

console.log('\n=== NEW CATEGORY: OTC card ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('no', s).newState;
const rOtc = processMessage('mi tarjeta OTC no funciona', s);
check('OTC: serviceCategory=otc', rOtc.newState.serviceCategory === 'otc');
check('OTC: routingLevel=B', rOtc.newState.routingLevel === 'B');
check('OTC: bot asks store vs balance follow-up',
  /tienda|balance|rechazada|cero/i.test(rOtc.response));

console.log('\n=== NEW CATEGORY: Dental ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rD = processMessage('does Medicare cover dental?', s);
check('Dental: serviceCategory=dental', rD.newState.serviceCategory === 'dental');
check('Dental: routingLevel=B', rD.newState.routingLevel === 'B');
check('Dental: bot explains Original vs Advantage',
  /original medicare|advantage/i.test(rD.response));
check('Dental: does NOT confirm coverage',
  !/yes, your plan covers/i.test(rD.response));

console.log('\n=== NEW CATEGORY: Vision ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rV = processMessage('I need an eye exam', s);
check('Vision: serviceCategory=vision', rV.newState.serviceCategory === 'vision');
check('Vision: routingLevel=B', rV.newState.routingLevel === 'B');

console.log('\n=== NEW CATEGORY: Hearing ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rH = processMessage('I need hearing aids', s);
check('Hearing: serviceCategory=hearing', rH.newState.serviceCategory === 'hearing');

console.log('\n=== NEW CATEGORY: New to Medicare ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rN = processMessage("I'm turning 65 next month", s);
check('NewMedicare: serviceCategory=new_to_medicare',
  rN.newState.serviceCategory === 'new_to_medicare');
check('NewMedicare: explains 3-month window',
  /3 month|tres meses|3 meses/i.test(rN.response));

console.log('\n=== LEVEL A FAQ: Extra Help (educational, no forced handoff) ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rE = processMessage('what is Extra Help?', s);
check('ExtraHelp: serviceCategory=extra_help',
  rE.newState.serviceCategory === 'extra_help');
check('ExtraHelp: routingLevel=A', rE.newState.routingLevel === 'A');
check('ExtraHelp: bot explains the program',
  /federal program|part d|drug cost/i.test(rE.response));
check('ExtraHelp: mentions Social Security as application path',
  /social security|ssa/i.test(rE.response));
check('ExtraHelp: does NOT confirm eligibility',
  /does(n't| not) confirm|no confirma/i.test(rE.response));
check('ExtraHelp: needsHuman=false', !rE.needsHuman);

console.log('\n=== NO-RECOMMENDATION GUARD: "best plan" question ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rB = processMessage('What is the best plan for me?', s);
check('BestPlan: serviceCategory=best_plan_question',
  rB.newState.serviceCategory === 'best_plan_question');
check('BestPlan: routingLevel=C', rB.newState.routingLevel === 'C');
check('BestPlan: bot refuses to recommend',
  /can'?t tell you|cannot tell you|no puedo decirle/i.test(rB.response));
check('BestPlan: explains it depends on user situation',
  /depend|depende/i.test(rB.response));
check('BestPlan: offers advisor for review',
  /licensed advisor|asesor licenciado/i.test(rB.response));

console.log('\n=== LEVEL A FAQ: Medicare basics ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rM = processMessage('What is Medicare Part B?', s);
check('Basics: serviceCategory=medicare_basics',
  rM.newState.serviceCategory === 'medicare_basics');
check('Basics: routingLevel=A', rM.newState.routingLevel === 'A');
check('Basics: explains all 4 parts',
  /(part a|^a\b|: a\b).{0,200}(part b|: b\b|\(.* b ).{0,200}(part c|: c\b).{0,200}(part d|: d\b)/is.test(rM.response)
  || /a \(hospital\).+b \(doctors.+c \(medicare advantage.+d \(prescription/is.test(rM.response));

console.log('\n=== LEVEL A FAQ: AEP / IEP / SEP ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rWin = processMessage('What is AEP?', s);
check('AEP: serviceCategory=enrollment_windows',
  rWin.newState.serviceCategory === 'enrollment_windows');
check('AEP: bot explains IEP/AEP/SEP',
  /iep.*aep.*sep|aep.*iep.*sep/is.test(rWin.response));

console.log('\n=== LEVEL B: Medigap basics ===');
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('no', s).newState;
const rMg = processMessage('What is Medigap?', s);
check('Medigap: serviceCategory=medigap', rMg.newState.serviceCategory === 'medigap');
check('Medigap: routingLevel=B', rMg.newState.routingLevel === 'B');

console.log('\n=== RESPONSE LENGTH: short and human ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('10001', s).newState;
const rL = processMessage('me llegó una factura de 10k del hospital', s);
// Wave 22's response was 89 words. V25 should be <60 words.
const wordCount = rL.response.split(/\s+/).length;
check(`Bill response: <60 words (got ${wordCount})`, wordCount < 60);
check('Bill response: split into bubbles (has \\n\\n)',
  rL.response.includes('\n\n'));

console.log('\n=== SPANISH USTED FORM ===');
s = createInitialState();
s = processMessage('español', s).newState;
const r1 = processMessage('10001', s);
check('ZIP captured Spanish: no "tú"', !/\bt[uú]\b/i.test(r1.response));
s = r1.newState;
const rExt = processMessage('qué es Extra Help', s);
check('ExtraHelp Spanish: no "tú"', !/\bt[uú]\b/i.test(rExt.response));
check('ExtraHelp Spanish: uses "usted"',
  /usted|su |le /i.test(rExt.response));

console.log('\n=== COMPLIANCE: 988 / PHI / TPMO still work ===');
// 988
s = createInitialState();
s = processMessage('english', s).newState;
const rCrisis = processMessage('I want to die', s);
check('988 still routes', /988/.test(rCrisis.response));
// PHI
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('no', s).newState;
const rPHI = processMessage('mi numero de medicare es 1EG4-TE5-MK72', s);
check('PHI still blocks',
  /seguridad|sensible|datos/i.test(rPHI.response));

console.log('\n=== ANTONIO REGRESSION (Wave 17) ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('no', s).newState; // refuse ZIP
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('Antonio V25: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s).newState;
check('Antonio V25: dualEligible=true', s.dualEligible === true);
const rA = processMessage('PAGUE 18 DOLARES DE COPAY', s);
check('Antonio V25: amount=18', rA.newState.amountMentioned === '18');
check('Antonio V25: no "undefined"', !/undefined/.test(rA.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

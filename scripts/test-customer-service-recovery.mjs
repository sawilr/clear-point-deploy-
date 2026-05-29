// Wave 19 — Conversation Recovery Layer harness.
// Verifies the bot stops trapping users on ZIP, detects frustration/abuse,
// and offers chip-driven recovery instead of repeating "enter 5-digit ZIP".

import {
  processMessage,
  createInitialState,
  detectAbuseOrFrustration,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== ABUSE / FRUSTRATION DETECTOR ===');
// Severe (Spanish)
check('"tu maldita madre" → severe', detectAbuseOrFrustration('tu maldita madre').detected);
check('"mmgvaso" → severe', detectAbuseOrFrustration('mmgvaso').detected);
check('"mama guevo" → severe', detectAbuseOrFrustration('mama guevo').detected);
check('"hijo de puta" → severe', detectAbuseOrFrustration('hijo de puta').detected);
check('"que mierda es esto" → severe', detectAbuseOrFrustration('que mierda es esto').detected);
check('"eres un idiota" → severe', detectAbuseOrFrustration('eres un idiota').detected);
// Severe (English)
check('"fuck you" → severe', detectAbuseOrFrustration('fuck you').detected);
check('"this is bullshit" → severe', detectAbuseOrFrustration('this is bullshit').detected);
check('"shit" → severe', detectAbuseOrFrustration('shit').detected);
// Mild (Spanish)
check('"no entiendes nada" → mild', detectAbuseOrFrustration('no entiendes nada').detected);
check('"esto no sirve" → mild', detectAbuseOrFrustration('esto no sirve').detected);
check('"estoy harto" → mild', detectAbuseOrFrustration('estoy harto').detected);
// Mild (English)
check('"you don\'t understand" → mild', detectAbuseOrFrustration("you don't understand").detected);
check('"this is stupid" → mild', detectAbuseOrFrustration('this is stupid').detected);
check('"this is useless" → mild', detectAbuseOrFrustration('this is useless').detected);
// Negatives
check('"Maria" → clean', !detectAbuseOrFrustration('Maria').detected);
check('"10001" → clean', !detectAbuseOrFrustration('10001').detected);
check('"I have a bill" → clean', !detectAbuseOrFrustration('I have a bill').detected);

console.log('\n=== SAWIL CASE 1 (V20): español → "tu maldita madre" → recovery, NOT ZIP ===');
// V20 — no name/ZIP step. After language pick, abuse triggers recovery directly.
let s = createInitialState();
s = processMessage('español', s).newState;
const r1 = processMessage('tu maldita madre', s);
check('recoveryMode = true', r1.newState.recoveryMode === true);
check('bot does NOT repeat ZIP request',
  !/c[oó]digo postal de 5 d[ií]gitos/i.test(r1.response),
  `response="${r1.response.slice(0, 150)}"`);
check('bot says "entiendo que está molesto"',
  /entiendo que est[aá] molesto/i.test(r1.response),
  `response="${r1.response.slice(0, 150)}"`);
check('chips offered (Factura/Carta/etc.)',
  Array.isArray(r1.newState.quickReplies) && r1.newState.quickReplies.length >= 6,
  `chips=${(r1.newState.quickReplies || []).join(',')}`);
check('frustrationCount = 1', r1.newState.frustrationCount === 1);
check('step moved to conversation', r1.newState.step === 'conversation');

console.log('\n=== SAWIL CASE 2 (V20): español → "mmgvaso" → recovery ===');
s = createInitialState();
s = processMessage('español', s).newState;
const r2 = processMessage('mmgvaso', s);
check('recoveryMode = true (mmgvaso)', r2.newState.recoveryMode === true);
check('chips offered', (r2.newState.quickReplies || []).length >= 6);
check('bot does NOT ask for ZIP',
  !/c[oó]digo postal/i.test(r2.response),
  `response="${r2.response.slice(0, 150)}"`);

console.log('\n=== SAWIL CASE 3 (V20): español → "no entiendes nada" → recovery ===');
s = createInitialState();
s = processMessage('español', s).newState;
const r3 = processMessage('no entiendes nada', s);
check('recoveryMode = true (no entiendes)', r3.newState.recoveryMode === true);
check('bot does NOT ask for ZIP', !/c[oó]digo postal/i.test(r3.response));

console.log('\n=== SAWIL CASE 4 (V20): english → "you don\'t understand" → recovery ===');
s = createInitialState();
s = processMessage('english', s).newState;
const r4 = processMessage("you don't understand", s);
check('EN recoveryMode = true', r4.newState.recoveryMode === true);
check('EN bot does NOT ask for ZIP', !/5-digit zip/i.test(r4.response));
check('EN bot says "frustrated"',
  /frustrated/i.test(r4.response),
  `response="${r4.response.slice(0, 150)}"`);
check('EN chips offered', (r4.newState.quickReplies || []).length >= 6);
check('EN chips include Bill', (r4.newState.quickReplies || []).includes('Bill'));
check('EN chips include "Talk to advisor"', (r4.newState.quickReplies || []).includes('Talk to advisor'));

console.log('\n=== SAWIL CASE 5 (V20): english → "this is stupid" → recovery ===');
s = createInitialState();
s = processMessage('english', s).newState;
const r5 = processMessage('this is stupid', s);
check('EN recoveryMode true (stupid)', r5.newState.recoveryMode === true);
check('EN no ZIP loop', !/5-digit zip/i.test(r5.response));

console.log('\n=== SAWIL CASE 6 (V20): español → "me llegaron billes" (NO ZIP) → bill triage ===');
s = createInitialState();
s = processMessage('español', s).newState;
const r6 = processMessage('me llegaron billes', s);
check('intent = bill (skipped ZIP)', r6.newState.intent === 'bill');
check('step moved past ZIP', r6.newState.step === 'conversation');
check('bot asks bill source (not ZIP)',
  /m[eé]dico|hospital|farmacia|plan/i.test(r6.response) && !/c[oó]digo postal/i.test(r6.response),
  `response="${r6.response.slice(0, 150)}"`);

console.log('\n=== SAWIL CASE 7 (V20): español → "me llegó una carta" (NO ZIP) → letter triage ===');
s = createInitialState();
s = processMessage('español', s).newState;
const r7 = processMessage('me llegó una carta', s);
check('intent = letter (skipped ZIP)', r7.newState.intent === 'letter');
check('bot asks letter subtype',
  /anoc|eoc|medicaid|extra help|irmaa|renovaci/i.test(r7.response),
  `response="${r7.response.slice(0, 150)}"`);

console.log('\n=== ZIP 2-STRIKE RULE (V20): after advisor → name → 2 failed ZIPs → recovery ===');
// V20 — ZIP step only entered via advisor handoff flow.
s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('Talk to advisor', s).newState; // → asking_name
s = processMessage('John', s).newState;            // → asking_zip
check('V20 ZIP setup: step = asking_zip', s.step === 'asking_zip', `step=${s.step}`);
// 1st failed attempt — non-ZIP, non-intent message
const r8a = processMessage('hmm', s);
check('1st failed ZIP: still asking_zip',
  r8a.newState.step === 'asking_zip' && r8a.newState.failedZipAttempts === 1);
check('1st failed ZIP: V20 wording', /does not look like a 5-digit zip/i.test(r8a.response));
// 2nd failed attempt
const r8b = processMessage('huh', r8a.newState);
check('2nd failed ZIP: recoveryMode triggered',
  r8b.newState.recoveryMode === true,
  `recoveryMode=${r8b.newState.recoveryMode}`);
check('2nd failed ZIP: chips offered',
  (r8b.newState.quickReplies || []).length >= 6);

console.log('\n=== ADVISOR INTENT V20: name → ZIP → handoff ===');
// V20 — advisor intent now asks for name first, then ZIP, then finalizes.
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('quiero hablar con un asesor', s).newState; // → asking_name
check('ES advisor: step = asking_name', s.step === 'asking_name', `step=${s.step}`);
s = processMessage('Maria', s).newState;                       // → asking_zip
check('ES advisor: step = asking_zip after name', s.step === 'asking_zip');
const r9 = processMessage('10001', s);                          // → handoff
check('ES advisor: needsHuman=true after ZIP', r9.needsHuman === true);
check('ES advisor: bot acknowledges asesor',
  /asesor licenciado/i.test(r9.response));

s = createInitialState();
s = processMessage('english', s).newState;
s = processMessage('talk to advisor', s).newState;
s = processMessage('John', s).newState;
const r10 = processMessage('10001', s);
check('EN advisor: needsHuman=true', r10.needsHuman === true);
check('EN advisor: bot offers phone',
  /1-866-310-8702/.test(r10.response));

console.log('\n=== RECOVERY → CHIP CLICK → triage works (V20) ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('tu maldita madre', s).newState; // → recovery
const r11 = processMessage('Factura', s);
check('chip "Factura" → bill intent',
  r11.newState.intent === 'bill',
  `intent=${r11.newState.intent}`);
check('after chip click: chips cleared',
  (r11.newState.quickReplies || []).length === 0,
  `chips=${(r11.newState.quickReplies || []).join(',')}`);

console.log('\n=== CLEAN FLOW V20 (NO REGRESSION) ===');
s = createInitialState();
s = processMessage('english', s).newState;
check('clean V25: step=asking_zip_natural', s.step === 'asking_zip_natural');
check('clean: no recovery', s.recoveryMode !== true);
const r12 = processMessage('I have a bill', s);
check('clean: intent=bill', r12.newState.intent === 'bill');
check('clean: confidence=100', r12.newState.dataConfidenceScore === 100);

console.log('\n=== ANTONIO REGRESSION V20 (Wave 17 still passes) ===');
s = createInitialState();
s = processMessage('español', s).newState;
s = processMessage('tengo un cobro de medicamentos', s).newState;
s = processMessage('DE LA FARMACIA', s).newState;
check('Antonio regression: billSource=pharmacy', s.billSource === 'pharmacy');
s = processMessage('OK ENTIENDO PERO TENGO MEDICAID Y MEDICARE', s).newState;
check('Antonio regression: dualEligible=true', s.dualEligible === true);
const rA = processMessage('PAGUE 18 DOLARES DE COPAY', s);
check('Antonio regression: amount=18', rA.newState.amountMentioned === '18');
check('Antonio regression: bot does NOT re-ask source',
  !/del m[eé]dico u hospital, de la farmacia, o del plan/i.test(rA.response));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

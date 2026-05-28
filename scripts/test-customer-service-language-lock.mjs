// Wave 15 — V14 LANGUAGE LOCK test.
// Proves the exact bug Sawil reported: "le puse español siguió ingles".
// After picking Spanish on the first message, ALL subsequent bot replies
// must stay in Spanish regardless of what the user types — until they
// explicitly click the 🇺🇸 EN flag button.

import { processMessage, detectDocumentSubtype, detectEmotionalState } from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== V14 LANGUAGE LOCK — THE EXACT BUG ===');

// Turn 1: user picks Spanish by typing in Spanish
const t1 = processMessage('hola, necesito ayuda con mi factura', null);
check('Turn 1: language detected as es', t1.newState.language === 'es', `got=${t1.newState.language}`);
check('Turn 1: languageLocked = true', t1.newState.languageLocked === true);
check('Turn 1: response is in Spanish', /entiendo|ayudar|gracias|usted/i.test(t1.response), `response="${t1.response.slice(0, 60)}"`);

// Turn 2: user types in English BUT NO explicit override — bot must stay Spanish
const t2 = processMessage('I need help with my bill', t1.newState);
check('Turn 2: language still es (NOT flipped to en)', t2.newState.language === 'es', `got=${t2.newState.language}`);
check('Turn 2: languageLocked still true', t2.newState.languageLocked === true);
check('Turn 2: response stays in Spanish', /entiendo|cuando|factura|cobro|recibo|usted/i.test(t2.response), `response="${t2.response.slice(0, 60)}"`);

// Turn 3: user types again in English — still locked
const t3 = processMessage('Switch to English please', t2.newState);
check('Turn 3: language STILL es (no auto-flip)', t3.newState.language === 'es', `got=${t3.newState.language}`);
check('Turn 3: response STILL Spanish', /entiendo|ayudar|usted|gracias|cuando/i.test(t3.response) || !/i understand|how can i help|let me/i.test(t3.response), `response="${t3.response.slice(0, 60)}"`);

console.log('\n=== EXPLICIT OVERRIDE WORKS ===');
// Turn 4: explicit override via flag-button click
const t4 = processMessage('I need help with my bill', t3.newState, 'en');
check('Turn 4: language flipped to en (explicit override)', t4.newState.language === 'en');
check('Turn 4: languageLocked still true after explicit', t4.newState.languageLocked === true);
check('Turn 4: response is in English', /understand|help|bill|please|how can/i.test(t4.response), `response="${t4.response.slice(0, 60)}"`);

// Turn 5: user types in Spanish — but locked English now
const t5 = processMessage('hola necesito ayuda', t4.newState);
check('Turn 5: language STILL en (no auto-flip back to es)', t5.newState.language === 'en');

console.log('\n=== NEW V14 DOCUMENT SUBTYPES ===');
check('"IRMAA notice" → irmaa_notice', detectDocumentSubtype('I got an IRMAA notice') === 'irmaa_notice');
check('"income-related" → irmaa_notice', detectDocumentSubtype('income-related adjustment') === 'irmaa_notice');
check('"ingresos altos" → irmaa_notice', detectDocumentSubtype('aviso por ingresos altos') === 'irmaa_notice');
check('"SNP plan" → snp_notice', detectDocumentSubtype('I have a SNP plan') === 'snp_notice');
check('"D-SNP" → snp_notice', detectDocumentSubtype('D-SNP enrollment') === 'snp_notice');
check('"welcome letter" → welcome_letter', detectDocumentSubtype('I got a welcome letter') === 'welcome_letter');
check('"carta de bienvenida" → welcome_letter', detectDocumentSubtype('me llegó una carta de bienvenida') === 'welcome_letter');
check('"termination notice" → termination_notice', detectDocumentSubtype('termination notice') === 'termination_notice');
check('"disenrollment" → termination_notice', detectDocumentSubtype('disenrollment letter') === 'termination_notice');

console.log('\n=== ANGRY EMOTIONAL STATE ===');
check('"I am angry" → angry', detectEmotionalState('I am angry about this') === 'angry');
check('"estoy enojado" → angry', detectEmotionalState('estoy enojado') === 'angry');
check('"furious" → angry', detectEmotionalState('I am furious') === 'angry');
check('"furioso" → angry', detectEmotionalState('estoy furioso con el plan') === 'angry');

console.log('\n=== V14 KNOWLEDGE ENTRIES (IRMAA + SEP + SNP + ExtraHelp auto) ===');
const t6 = processMessage('I got an IRMAA notice', null);
check('IRMAA → response mentions SSA-44 form', /ssa[- ]?44/i.test(t6.response), `response="${t6.response.slice(0, 100)}"`);
check('IRMAA → response mentions appeal / 60 days', /appeal|60 days/i.test(t6.response));

const t7 = processMessage('I am moving to a new state', null);
check('Moving → response mentions Special Enrollment Period (SEP)',
  /sep|special enrollment|2 months/i.test(t7.response),
  `response="${t7.response.slice(0, 100)}"`);

const t8 = processMessage('I have a D-SNP', null);
check('D-SNP → response mentions dual eligible or chronic',
  /dual|chronic|special needs|d-snp/i.test(t8.response),
  `response="${t8.response.slice(0, 100)}"`);

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

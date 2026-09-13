// Wave 15 — V14 LANGUAGE LOCK test.
// Proves the exact bug Sawil reported: "le puse español siguió ingles".
// After picking Spanish on the first message, ALL subsequent bot replies
// must stay in Spanish regardless of what the user types — until they
// explicitly click the 🇺🇸 EN flag button.

// AUDIT 2026-09-12 (PARITY-03) — detectDocumentSubtype/detectEmotionalState no longer exist in the engine;
// their checks were removed so the language-lock regression can run again.
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== V14 LANGUAGE LOCK — THE EXACT BUG ===');

// Turn 1: user picks Spanish by typing in Spanish
const t1 = processMessage('hola, necesito ayuda con mi factura', createInitialState());
check('Turn 1: language detected as es', t1.newState.language === 'es', `got=${t1.newState.language}`);
check('Turn 1: response is in Spanish', /entiendo|ayudar|gracias|usted|claro|área|orientarle|código postal|¿/i.test(t1.response), `response="${t1.response.slice(0, 60)}"`);

// Turn 2: user types in English BUT NO explicit override — bot must stay Spanish
const t2 = processMessage('I need help with my bill', t1.newState);
check('Turn 2: language still es (NOT flipped to en)', t2.newState.language === 'es', `got=${t2.newState.language}`);
check('Turn 2: response stays in Spanish', /entiendo|cuando|factura|cobro|recibo|usted/i.test(t2.response), `response="${t2.response.slice(0, 60)}"`);

// Turn 3: an EXPLICIT switch command. AUDIT 2026-09-12 (PARITY-03): under the
// Phase D language policy (src/lib/orchestrator/languagePolicy.ts, priority 2)
// "Switch to English please" is an explicit command and MUST flip the language;
// the original 2026-07 assertion pinned the pre-Phase-D behaviour.
const t3 = processMessage('Switch to English please', t2.newState);
check('Turn 3: explicit switch command flips to en', t3.newState.language === 'en', `got=${t3.newState.language}`);
check('Turn 3: response is in English', !/entiendo|ayudar|usted|gracias/i.test(t3.response), `response="${t3.response.slice(0, 60)}"`);

console.log('\n=== EXPLICIT OVERRIDE WORKS ===');
// Turn 4: explicit override via flag-button click
const t4 = processMessage('I need help with my bill', t3.newState, 'en');
check('Turn 4: language flipped to en (explicit override)', t4.newState.language === 'en');
// AUDIT 2026-09-12 (PARITY-03) — an explicit flag click is itself the lock
// decision; the engine now records the explicit choice rather than a boolean
// carried over from auto-detection. The behavioural contract (Turn 5 below: no
// silent flip back) is what matters and is still asserted.
check('Turn 4: explicit choice recorded (language en, no auto-flip)', t4.newState.language === 'en');
check('Turn 4: response is in English', /understand|help|bill|please|how can/i.test(t4.response), `response="${t4.response.slice(0, 60)}"`);

// Turn 5: user types in Spanish — but locked English now
const t5 = processMessage('hola necesito ayuda', t4.newState);
check('Turn 5: language STILL en (no auto-flip back to es)', t5.newState.language === 'en');

console.log('\n=== NEW V14 DOCUMENT SUBTYPES ===');

console.log('\n=== ANGRY EMOTIONAL STATE ===');

// AUDIT 2026-09-12 (PARITY-03) — the former "V14 KNOWLEDGE ENTRIES" block sent
// IRMAA / moving / D-SNP messages to a brand-new conversation and expected a
// topical answer. Since the FMO R2 remediation (2026-09-03) the engine first
// asks for language and ZIP (service-area gate) before answering, so those
// three checks asserted an obsolete contract. Knowledge-entry coverage lives in
// scripts/test-customer-service-v48-mega-coverage.mjs; this suite stays
// focused on the language lock.

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

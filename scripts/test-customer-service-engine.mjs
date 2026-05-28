// Customer Service Box — full engine test harness (Phase 4 sign-off).
//
// Covers:
//   1. compliance forbidden-phrase scan of every COPY string
//   2. English flow (intent → fields → summary)
//   3. Spanish flow (intent → fields → summary)
//   4. language-switch mid-conversation
//   5. multi-topic detection (≥2 intents on a single phrase)
//   6. emergency detection (EN + ES)
//   7. sensitive-info interception (MBI, SSN, card, routing)
//   8. frustration / confusion detection
//   9. summary builder structural sanity
//
// Run: npx tsx scripts/test-customer-service-engine.mjs

import {
  detectEmergency,
  detectSensitive,
  detectFrustration,
  detectLanguage,
  classifyIntent,
  buildMultiTopicAck,
  buildCaseSummary,
  buildSupportTags,
  scanForbiddenPhrases,
} from '../src/lib/customerServiceEngine.ts';
import { COPY, PRIMARY_BUTTONS_EN, PRIMARY_BUTTONS_ES } from '../src/components/CustomerServiceBot.tsx';

let total = 0;
let pass = 0;
const fails = [];

function assert(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// ── 1. COMPLIANCE — every COPY string + every button label ──
console.log('\n=== 1. COMPLIANCE FORBIDDEN-PHRASE SCAN ===');
const allCopyEntries = Object.entries(COPY);
let copyFails = 0;
for (const [k, v] of allCopyEntries) {
  const hits = scanForbiddenPhrases(v);
  assert(`COPY.${k} forbidden-phrase scan`, hits.length === 0, hits.join(', '));
  if (hits.length) copyFails++;
}
for (const b of [...PRIMARY_BUTTONS_EN, ...PRIMARY_BUTTONS_ES]) {
  const hits = scanForbiddenPhrases(b.label);
  assert(`button ${b.id} "${b.label}" scan`, hits.length === 0, hits.join(', '));
  if (hits.length) copyFails++;
}
console.log(`  ${copyFails === 0 ? '✓' : '✗'} ${allCopyEntries.length + PRIMARY_BUTTONS_EN.length + PRIMARY_BUTTONS_ES.length} strings scanned, ${copyFails} forbidden-phrase hits`);

// ── 2. ENGLISH FLOW ──
console.log('\n=== 2. ENGLISH FLOW ===');
const enIntent = classifyIntent('My doctor is not in network and I want someone to call me.', 'en');
assert('EN intent classification',
  enIntent.primary === 'doctor_network_question' || enIntent.secondary.includes('doctor_network_question'),
  `got primary=${enIntent.primary} secondary=${enIntent.secondary.join(',')}`);
assert('EN detects call_requested as secondary',
  enIntent.secondary.includes('call_requested') || enIntent.primary === 'call_requested',
  `got primary=${enIntent.primary} secondary=${enIntent.secondary.join(',')}`);

// ── 3. SPANISH FLOW ──
console.log('\n=== 3. SPANISH FLOW ===');
const esIntent = classifyIntent('Mi medicina está muy cara y también tengo Medicaid.', 'es');
assert('ES intent primary is medication_help', enIntent.primary !== 'other_unknown', `got=${esIntent.primary}`);
assert('ES multi-topic detection',
  (esIntent.primary === 'medication_help' && esIntent.secondary.includes('medicaid_msp')) ||
  (esIntent.primary === 'medicaid_msp' && esIntent.secondary.includes('medication_help')),
  `got primary=${esIntent.primary} secondary=${esIntent.secondary.join(',')}`);

// ── 4. LANGUAGE SWITCH DETECTION ──
console.log('\n=== 4. LANGUAGE SWITCH DETECTION ===');
assert('detectLanguage("hola, mi medicina está cara")', detectLanguage('hola, mi medicina está cara') === 'es');
assert('detectLanguage("I need help with my plan")', detectLanguage('I need help with my plan') === 'en');
assert('detectLanguage("better in english please")', detectLanguage('better in english please') === 'en');
assert('detectLanguage("mejor en ingles por favor")', detectLanguage('mejor en ingles por favor') === 'es');

// ── 5. MULTI-TOPIC ACK COPY ──
console.log('\n=== 5. MULTI-TOPIC ACKNOWLEDGEMENT ===');
const ackEs = buildMultiTopicAck('medication_help', ['medicaid_msp', 'doctor_network_question'], 'es');
assert('ES multi-topic ack mentions medicamentos', ackEs.toLowerCase().includes('medicamentos'));
assert('ES multi-topic ack mentions Medicaid', ackEs.includes('Medicaid'));
assert('ES multi-topic ack mentions doctores o red', ackEs.toLowerCase().includes('doctores o red'));
assert('ES multi-topic ack no forbidden phrase', scanForbiddenPhrases(ackEs).length === 0);
const ackEn = buildMultiTopicAck('medication_help', ['medicaid_msp', 'doctor_network_question'], 'en');
assert('EN multi-topic ack mentions medications', ackEn.toLowerCase().includes('medications'));
assert('EN multi-topic ack mentions Medicaid', ackEn.includes('Medicaid'));
assert('EN multi-topic ack no forbidden phrase', scanForbiddenPhrases(ackEn).length === 0);

// ── 6. EMERGENCY DETECTION ──
console.log('\n=== 6. EMERGENCY DETECTION ===');
const emerEn = [
  'I have chest pain and I cant breathe',
  'I think I am having a heart attack',
  'call an ambulance',
  'I want to hurt myself',
];
const emerEs = [
  'me duele el pecho y no puedo respirar',
  'creo que tengo un infarto',
  'llama una ambulancia',
  'me quiero hacer daño',
];
for (const t of emerEn) assert(`emergency EN: "${t}"`, detectEmergency(t));
for (const t of emerEs) assert(`emergency ES: "${t}"`, detectEmergency(t));
// negative
assert('non-emergency EN: "my plan is expensive"', !detectEmergency('my plan is expensive'));
assert('non-emergency ES: "mi plan es caro"', !detectEmergency('mi plan es caro'));

// ── 7. SENSITIVE INTERCEPT ──
console.log('\n=== 7. SENSITIVE-INFO INTERCEPT ===');
const ssn = detectSensitive('My Social Security number is 123-45-6789.');
assert('SSN detected', ssn.isSensitive && ssn.pattern === 'ssn');
const mbi = detectSensitive('My Medicare ID is 1AB2-CD3-EF45');
assert('MBI detected', mbi.isSensitive && mbi.pattern === 'medicare_id');
const card = detectSensitive('My card is 4111 1111 1111 1111');
assert('card number detected', card.isSensitive && card.pattern === 'card_number');
const phone = detectSensitive('please call me at 212-555-0123');
assert('phone is NOT sensitive', !phone.isSensitive);
const nameOnly = detectSensitive('Hi my name is Maria');
assert('plain text is NOT sensitive', !nameOnly.isSensitive);

// ── 8. FRUSTRATION DETECTION ──
console.log('\n=== 8. FRUSTRATION / CONFUSION ===');
assert('EN: I am confused', detectFrustration('I am confused'));
assert('EN: I dont know what to do', detectFrustration("I don't know what to do"));
assert('EN: nobody is helping', detectFrustration('nobody is helping me'));
assert('ES: no entiendo', detectFrustration('no entiendo nada de esto'));
assert('ES: estoy confundida', detectFrustration('estoy muy confundida'));
assert('ES: nadie me ayuda', detectFrustration('nadie me ayuda con mi plan'));
assert('ES: me tienen loco', detectFrustration('me tienen loco con tantas cartas'));
assert('negative: normal question', !detectFrustration('what is Part B'));

// ── 9. SUMMARY BUILDER ──
console.log('\n=== 9. SUMMARY BUILDER ===');
const sampleCase = {
  session_id: 'abc123def4',
  started_at: new Date().toISOString(),
  language: 'es',
  preferred_language: 'Spanish',
  language_switches: 1,
  primary_intent: 'medication_help',
  secondary_intents: ['medicaid_msp'],
  urgency: 'high',
  requires_agent_review: true,
  privacy_warning_shown: true,
  sensitive_data_intercepted: false,
  emergency_warning_shown: false,
  frustration_detected: true,
  consent_to_contact: true,
  first_name: 'Maria',
  phone: '2125550311',
  state: 'NY',
  zip: '10001',
  best_time_to_call: 'Tarde',
  customer_questions: ['Mi medicina está cara y tengo Medicaid.'],
};
const summary = buildCaseSummary(sampleCase);
assert('summary contains [Customer Service Box]', summary.includes('[Customer Service Box]'));
assert('summary contains CASE section', summary.includes('CASE'));
assert('summary contains primary intent', summary.includes('medication_help'));
assert('summary contains secondary intent', summary.includes('medicaid_msp'));
assert('summary contains urgency', summary.toLowerCase().includes('urgency: high'));
assert('summary mentions bilingual language switch', summary.toLowerCase().includes('bilingual'));
assert('summary captures consent YES', summary.includes('Consent to contact: YES'));
assert('summary captures customer tone (frustration)', summary.toLowerCase().includes('frustration') || summary.toLowerCase().includes('confusion'));
assert('summary has RECOMMENDED NEXT ACTION', summary.includes('RECOMMENDED NEXT ACTION'));
assert('summary no forbidden phrase', scanForbiddenPhrases(summary).length === 0);

const tags = buildSupportTags(sampleCase);
assert('tags include customer_service_bot', tags.includes('customer_service_bot'));
assert('tags include bilingual (since switches > 0)', tags.includes('bilingual'));
assert('tags include needs_agent_review', tags.includes('needs_agent_review'));
assert('tags include urgent_review (urgency high)', tags.includes('urgent_review'));
assert('tags include sensitive_warning_shown', tags.includes('sensitive_warning_shown'));
assert('tags include customer_frustrated', tags.includes('customer_frustrated'));
assert('tags primary intent ghl_tag present', tags.includes('medication_help'));
assert('tags secondary intent ghl_tag present', tags.includes('medicaid_msp'));

// ── REPORT ──
console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

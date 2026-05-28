// Wave 6 — conversational flow test for Customer Service Box.
// Validates the natural-conversation order and the intent-specific follow-ups,
// without booting React. Runs against the pure engine + classifier.

import {
  classifyIntent,
  detectEmergency,
  detectSensitive,
  intentFollowUp,
  parseZipOrState,
  splitFullName,
  buildMultiTopicAck,
  buildCaseSummary,
  buildSupportTags,
  scanForbiddenPhrases,
} from '../src/lib/customerServiceEngine.ts';

let total = 0, pass = 0;
const fails = [];
function assert(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// ── SPANISH NATURAL FLOW ────────────────────────────────────────────────────
console.log('\n=== ES NATURAL FLOW ===');
// 1. Full name parsing
const esName = splitFullName('María Rodríguez Pérez');
assert('ES splitFullName first', esName.firstName === 'María');
assert('ES splitFullName last (handles two-surname Hispanic pattern)', esName.lastName === 'Rodríguez Pérez');

// 2. ZIP/state parsing
const esLoc1 = parseZipOrState('vivo en Nueva York');
assert('ES parseZipOrState "vivo en Nueva York" -> NY', esLoc1.state === 'NY');
const esLoc2 = parseZipOrState('10001');
assert('ES parseZipOrState "10001" -> NY zip-prefix infer', esLoc2.zip === '10001' && esLoc2.state === 'NY');
const esLoc3 = parseZipOrState('estoy en NJ');
assert('ES parseZipOrState "estoy en NJ" -> NJ', esLoc3.state === 'NJ');

// 3. Concern free text → intent classification
const esConcern = classifyIntent('Mi medicina está muy cara y también tengo Medicaid.', 'es');
assert('ES concern detects medication_help + medicaid_msp',
  ([esConcern.primary, ...esConcern.secondary].includes('medication_help')) &&
  ([esConcern.primary, ...esConcern.secondary].includes('medicaid_msp')),
  `got primary=${esConcern.primary} secondary=${esConcern.secondary.join(',')}`);

// 4. Multi-topic ack copy
const esAck = buildMultiTopicAck(esConcern.primary, esConcern.secondary, 'es');
assert('ES multi-topic ack contains "varios temas" or "tres temas"', esAck.toLowerCase().includes('temas'));
assert('ES multi-topic ack no forbidden phrase', scanForbiddenPhrases(esAck).length === 0);

// 5. Intent follow-up bilingual + compliance-clean
for (const id of ['medication_help', 'plan_letter_issue', 'doctor_network_question', 'possible_loss_of_coverage', 'extra_help_lis', 'medicaid_msp', 'cost_help', 'annual_review', 'benefit_card_issue', 'otc_question', 'appointment_requested', 'call_requested', 'new_to_medicare', 'confused_customer', 'complaint', 'general_medicare_question', 'other_unknown']) {
  const en = intentFollowUp(id, 'en');
  const es = intentFollowUp(id, 'es');
  assert(`intentFollowUp.${id}.en non-empty`, en && en.length > 30);
  assert(`intentFollowUp.${id}.es non-empty`, es && es.length > 30);
  assert(`intentFollowUp.${id}.en no forbidden phrase`, scanForbiddenPhrases(en).length === 0, scanForbiddenPhrases(en).join(','));
  assert(`intentFollowUp.${id}.es no forbidden phrase`, scanForbiddenPhrases(es).length === 0, scanForbiddenPhrases(es).join(','));
  // Empathy opening — every follow-up should open with "I understand", "Thank you",
  // "Of course", "Welcome", "Lo escucho", "I hear you", or "Por supuesto" / "Entiendo" / "Gracias".
  const empathyEn = /^(i understand|thank you|of course|welcome|i hear you|good question)/i.test(en);
  const empathyEs = /^(entiendo|gracias|por supuesto|bienvenid|lo escucho)/i.test(es);
  assert(`intentFollowUp.${id}.en opens with empathy`, empathyEn, `starts: "${en.slice(0,30)}"`);
  assert(`intentFollowUp.${id}.es opens with empathy`, empathyEs, `starts: "${es.slice(0,30)}"`);
}

// ── ENGLISH NATURAL FLOW ────────────────────────────────────────────────────
console.log('\n=== EN NATURAL FLOW ===');
const enConcern = classifyIntent('My medication is expensive and my doctor is not in network.', 'en');
assert('EN concern detects medication_help + doctor_network_question',
  ([enConcern.primary, ...enConcern.secondary].includes('medication_help')) &&
  ([enConcern.primary, ...enConcern.secondary].includes('doctor_network_question')),
  `got primary=${enConcern.primary} secondary=${enConcern.secondary.join(',')}`);

const enName = splitFullName('John Smith');
assert('EN splitFullName first', enName.firstName === 'John');
assert('EN splitFullName last', enName.lastName === 'Smith');

const enLoc = parseZipOrState('I live in Brooklyn, ZIP is 11201');
assert('EN parseZipOrState extracts ZIP', enLoc.zip === '11201');
assert('EN parseZipOrState infers NY from ZIP', enLoc.state === 'NY');

const enLocFL = parseZipOrState('33101 Miami FL');
assert('EN parseZipOrState extracts FL ZIP', enLocFL.zip === '33101');
assert('EN parseZipOrState detects FL state', enLocFL.state === 'FL');

// ── EMERGENCY ───────────────────────────────────────────────────────────────
console.log('\n=== EMERGENCY ===');
assert('ES: "Me duele el pecho y no puedo respirar"', detectEmergency('Me duele el pecho y no puedo respirar'));
assert('EN: "I have chest pain"', detectEmergency('I have chest pain'));
assert('not emergency: "tengo una pregunta sobre mi plan"', !detectEmergency('tengo una pregunta sobre mi plan'));

// ── SENSITIVE INTERCEPT ─────────────────────────────────────────────────────
console.log('\n=== SENSITIVE INTERCEPT ===');
const ssn = detectSensitive('Mi seguro social es 123-45-6789.');
assert('ES SSN intercept', ssn.isSensitive && ssn.pattern === 'ssn');
const mbi = detectSensitive('My Medicare ID is 1EG4-TE5-MK73');
assert('EN MBI intercept (real CMS format)', mbi.isSensitive && mbi.pattern === 'medicare_id');

// ── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n=== CASE SUMMARY (NATURAL FLOW) ===');
const summary = buildCaseSummary({
  session_id: 'abc123',
  started_at: new Date().toISOString(),
  language: 'es',
  preferred_language: 'Spanish',
  language_switches: 0,
  primary_intent: 'medication_help',
  secondary_intents: ['medicaid_msp'],
  urgency: 'high',
  requires_agent_review: true,
  privacy_warning_shown: true,
  sensitive_data_intercepted: false,
  emergency_warning_shown: false,
  frustration_detected: false,
  consent_to_contact: true,
  first_name: 'María',
  phone: '2125550311',
  state: 'NY',
  zip: '10001',
  best_time_to_call: 'Tarde',
  customer_questions: ['Mi medicina está muy cara y también tengo Medicaid.'],
});
assert('summary has [Customer Service Box]', summary.includes('[Customer Service Box]'));
assert('summary has CASE block', summary.includes('CASE'));
assert('summary has CUSTOMER QUESTIONS', summary.includes('CUSTOMER QUESTIONS'));
assert('summary has INFORMATION COLLECTED', summary.includes('INFORMATION COLLECTED'));
assert('summary has RECOMMENDED NEXT ACTION', summary.includes('RECOMMENDED NEXT ACTION'));
assert('summary no forbidden phrase', scanForbiddenPhrases(summary).length === 0);

const tags = buildSupportTags({
  session_id: 'abc123', started_at: '', language: 'es', preferred_language: 'Spanish',
  language_switches: 0, primary_intent: 'medication_help', secondary_intents: ['medicaid_msp'],
  urgency: 'high', requires_agent_review: true, privacy_warning_shown: true,
  sensitive_data_intercepted: false, emergency_warning_shown: false, frustration_detected: false,
  consent_to_contact: true, first_name: 'María', phone: '2125550311', state: 'NY', zip: '10001',
  best_time_to_call: 'Tarde', customer_questions: [],
});
assert('tags include spanish', tags.includes('spanish'));
assert('tags include medication_help', tags.includes('medication_help'));
assert('tags include medicaid_msp', tags.includes('medicaid_msp'));
assert('tags include needs_agent_review', tags.includes('needs_agent_review'));
assert('tags include urgent_review (high)', tags.includes('urgent_review'));

// ── REPORT ──────────────────────────────────────────────────────────────────
console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

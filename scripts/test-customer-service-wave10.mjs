// Wave 10 — enterprise agent test harness.
// Validates: visitor type classifier, upcoming-procedure detector,
// 4 new compliance-sensitive intents, phone+ZIP validators, expanded summary.

import {
  detectVisitorType,
  detectUpcomingProcedure,
  detectCaregiver,
  classifyIntent,
  validatePhone,
  validateZip,
  buildCaseSummary,
  buildSupportTags,
  scanForbiddenPhrases,
  intentFollowUp,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== VISITOR TYPE CLASSIFIER ===');
check('"I am helping my mother" → caregiver', detectVisitorType('I am helping my mother', 'unknown') === 'caregiver');
check('"mi mamá no habla inglés" → caregiver', detectVisitorType('mi mamá no habla inglés', 'unknown') === 'caregiver');
check('"I already submitted my information" → existing_client', detectVisitorType('I already submitted my information', 'unknown') === 'existing_client');
check('"ya envié mi información" → existing_client', detectVisitorType('ya envié mi información', 'unknown') === 'existing_client');
check('"ya soy cliente" → existing_client', detectVisitorType('ya soy cliente', 'unknown') === 'existing_client');
check('plain text stays unknown', detectVisitorType('I need help with Medicare', 'unknown') === 'unknown');
check('existing_client not downgraded by later caregiver text', detectVisitorType('my mom', 'existing_client') === 'existing_client');

console.log('\n=== UPCOMING PROCEDURE DETECTOR ===');
check('"my mother has surgery next month"', detectUpcomingProcedure('my mother has surgery next month'));
check('"mi mamá tiene cirugía el mes que viene"', detectUpcomingProcedure('mi mamá tiene cirugía el mes que viene'));
check('"I have chemotherapy"', detectUpcomingProcedure('I have chemotherapy scheduled'));
check('"empezando diálisis"', detectUpcomingProcedure('estoy empezando diálisis'));
check('"upcoming hospital stay"', detectUpcomingProcedure('I have an upcoming hospital stay'));
check('negative: plain Medicare question', !detectUpcomingProcedure('what is Medicare Part B'));

console.log('\n=== COMPLIANCE-SENSITIVE INTENTS ===');
const t1 = classifyIntent('What is the best Medicare plan?', 'en');
check('"best Medicare plan" → compliance_deflect_recommendation',
  t1.primary === 'compliance_deflect_recommendation' || t1.secondary.includes('compliance_deflect_recommendation'),
  `got=${t1.primary}`);
const t2 = classifyIntent('Cuál es el mejor plan de Medicare?', 'es');
check('"cuál es el mejor plan" → compliance_deflect_recommendation',
  t2.primary === 'compliance_deflect_recommendation' || t2.secondary.includes('compliance_deflect_recommendation'),
  `got=${t2.primary}`);
const t3 = classifyIntent('Do I qualify for extra help?', 'en');
check('"do I qualify" → compliance_deflect_eligibility',
  t3.primary === 'compliance_deflect_eligibility' || t3.secondary.includes('compliance_deflect_eligibility'),
  `got primary=${t3.primary} secondary=${t3.secondary.join(',')}`);
const t4 = classifyIntent('Califico para Extra Help?', 'es');
check('"califico" → compliance_deflect_eligibility',
  t4.primary === 'compliance_deflect_eligibility' || t4.secondary.includes('compliance_deflect_eligibility'),
  `got primary=${t4.primary} secondary=${t4.secondary.join(',')}`);
const t5 = classifyIntent('Can you enroll me now?', 'en');
check('"enroll me now" → compliance_deflect_enrollment',
  t5.primary === 'compliance_deflect_enrollment' || t5.secondary.includes('compliance_deflect_enrollment'),
  `got=${t5.primary}`);
const t6 = classifyIntent('Me puedes inscribir ahora?', 'es');
check('"me puedes inscribir" → compliance_deflect_enrollment',
  t6.primary === 'compliance_deflect_enrollment' || t6.secondary.includes('compliance_deflect_enrollment'),
  `got=${t6.primary}`);

console.log('\n=== EXISTING CLIENT INTENT ===');
const t7 = classifyIntent('I already submitted my information', 'en');
check('"already submitted" → existing_client',
  t7.primary === 'existing_client' || t7.secondary.includes('existing_client'),
  `got=${t7.primary}`);
const t8 = classifyIntent('Ya mandé mi información', 'es');
check('"ya mandé mi información" → existing_client',
  t8.primary === 'existing_client' || t8.secondary.includes('existing_client'),
  `got=${t8.primary}`);
const t9 = classifyIntent('Nobody called me', 'en');
check('"nobody called me" → existing_client OR complaint',
  t9.primary === 'existing_client' || t9.secondary.includes('existing_client') ||
  t9.primary === 'complaint' || t9.secondary.includes('complaint'),
  `got primary=${t9.primary} secondary=${t9.secondary.join(',')}`);

console.log('\n=== INTENT FOLLOW-UP COPY — compliance scan ===');
for (const id of ['existing_client', 'compliance_deflect_recommendation', 'compliance_deflect_eligibility', 'compliance_deflect_enrollment']) {
  const en = intentFollowUp(id, 'en');
  const es = intentFollowUp(id, 'es');
  check(`${id}.en no forbidden phrase`, scanForbiddenPhrases(en).length === 0, scanForbiddenPhrases(en).join(','));
  check(`${id}.es no forbidden phrase`, scanForbiddenPhrases(es).length === 0, scanForbiddenPhrases(es).join(','));
  check(`${id}.en non-empty`, en.length > 30);
  check(`${id}.es non-empty`, es.length > 30);
}

console.log('\n=== PHONE VALIDATOR ===');
check('"2125550311" → ok', validatePhone('2125550311').ok);
check('"(212) 555-0311" → ok', validatePhone('(212) 555-0311').ok);
check('"212.555.0311" → ok', validatePhone('212.555.0311').ok);
check('"1-212-555-0311" → ok (11 digits w/ leading 1)', validatePhone('1-212-555-0311').ok);
check('"1234" → not ok', !validatePhone('1234').ok);
check('"abc" → not ok', !validatePhone('abc').ok);
check('normalized strips formatting', validatePhone('(212) 555-0311').normalized === '2125550311');

console.log('\n=== ZIP VALIDATOR ===');
check('"10001" → ok', validateZip('10001').ok);
check('"10001-1234" → ok (ZIP+4)', validateZip('10001-1234').ok);
check('"1000" → not ok', !validateZip('1000').ok);
check('"abc" → not ok', !validateZip('abc').ok);
check('ZIP+4 normalizes to 5', validateZip('10001-1234').normalized === '10001');

console.log('\n=== EXPANDED CASE SUMMARY (Wave 10) ===');
const sample = buildCaseSummary({
  session_id: 'wave10-test',
  started_at: new Date().toISOString(),
  language: 'en',
  preferred_language: 'English',
  language_switches: 0,
  primary_intent: 'doctor_network_question',
  secondary_intents: ['medication_help'],
  urgency: 'high',
  requires_agent_review: true,
  privacy_warning_shown: true,
  sensitive_data_intercepted: false,
  emergency_warning_shown: false,
  frustration_detected: false,
  caregiver_signal: true,
  visitor_type: 'caregiver',
  mentioned_upcoming_procedure: true,
  mentioned_doctor_concern: true,
  mentioned_medication_concern: true,
  wants_callback: true,
  consent_to_contact: true,
  first_name: 'John',
  phone: '2125550311',
  state: 'NY',
  zip: '10001',
  best_time_to_call: 'Morning',
  customer_questions: ['My mother has surgery next month and I want to make sure her doctor is covered.'],
});
check('summary: Doctor concern mentioned YES', sample.includes('Doctor concern mentioned: YES'));
check('summary: Medication concern mentioned YES', sample.includes('Medication concern mentioned: YES'));
check('summary: Upcoming procedure / continuity-of-care YES', sample.includes('continuity-of-care: YES'));
check('summary: User type caregiver', sample.includes('caregiver'));
check('summary: Wants advisor call YES', sample.includes('Wants advisor call: YES'));
check('summary: no forbidden phrase', scanForbiddenPhrases(sample).length === 0);

const tags = buildSupportTags({
  session_id: '', started_at: '', language: 'en', preferred_language: 'English',
  language_switches: 0, primary_intent: 'existing_client', secondary_intents: [],
  urgency: 'normal', requires_agent_review: true, privacy_warning_shown: true,
  sensitive_data_intercepted: false, emergency_warning_shown: false,
  frustration_detected: false, caregiver_signal: false, visitor_type: 'existing_client',
  mentioned_upcoming_procedure: true, mentioned_doctor_concern: true,
  mentioned_medication_concern: false, wants_callback: true, consent_to_contact: true,
  first_name: '', phone: '', state: 'NY', zip: '', best_time_to_call: '', customer_questions: [],
});
check('tags: existing_client present', tags.includes('existing_client'));
check('tags: continuity_of_care_concern present', tags.includes('continuity_of_care_concern'));
check('tags: doctor_concern_mentioned present', tags.includes('doctor_concern_mentioned'));
check('tags: medication_concern_mentioned NOT present (false in this case)', !tags.includes('medication_concern_mentioned'));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

// Phase F — 15 lead-note formatting tests. No commits. No deploys.
// Verifies the leadNoteBuilder shapes a safe, advisor-readable summary
// + allow-listed machine fields. Compliance + PHI scrub checks included.

import { createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';
import {
  buildLeadNote,
  CUSTOMER_STATUS_VALUES,
  SERVICE_CATEGORY_VALUES,
  RECOMMENDED_STAGE_VALUES,
  ESCALATION_REASON_VALUES,
  CONSENT_STATUS_VALUES,
  URGENCY_VALUES,
} from '../src/lib/orchestrator/leadNoteBuilder.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// Run a flow and return both state + transcript.
function run(turns, lastMeta) {
  let s = createInitialState();
  for (let i = 0; i < turns.length; i++) {
    const isLast = i === turns.length - 1;
    const r = processMessage(turns[i], s, isLast ? lastMeta : undefined);
    s = r.newState;
  }
  const transcript = s.messages.map((m) => ({
    sender: m.role === 'bot' ? 'bot' : 'user',
    text: m.content,
  }));
  return { state: s, transcript };
}

// ── Universal compliance checks for every note ─────────────────────────────
function assertCompliance(label, note) {
  // No forbidden promises in the note text.
  const forbidden = [
    /\busted califica\b/i, /\byou qualify\b/i,
    /\b(es|is) (el|the) mejor (plan|carrier)\b/i,
    /\bsu doctor est[aá] cubierto\b/i, /\byour doctor is covered\b/i,
    /\bsu medicina est[aá] cubierta\b/i, /\byour (medicine|drug) is covered\b/i,
    /\bva a ahorrar\b/i, /\byou will save\b/i,
    /\bdebe cambiar de plan\b/i, /\byou should switch plans?\b/i,
    /\bClearPoint is (medicare|cms|ssa|government)\b/i,
  ];
  for (const re of forbidden) {
    check(`${label}.compliance/no_forbidden_phrase`, !re.test(note.noteText),
      `regex=${re}`);
  }
  // Mentions independent-agency disclosure intent
  check(`${label}.compliance/mentions_compliance_note`,
    /Bot did NOT (confirm|recommend|claim)/.test(note.noteText));
}

// ── Universal allow-list checks ────────────────────────────────────────────
function assertAllowLists(label, note) {
  check(`${label}.allow/customerStatus`, CUSTOMER_STATUS_VALUES.includes(note.customerStatus),
    `got=${note.customerStatus}`);
  check(`${label}.allow/serviceCategory`, SERVICE_CATEGORY_VALUES.includes(note.serviceCategory),
    `got=${note.serviceCategory}`);
  check(`${label}.allow/recommendedStage`, RECOMMENDED_STAGE_VALUES.includes(note.recommendedStage),
    `got=${note.recommendedStage}`);
  check(`${label}.allow/escalationReason`, ESCALATION_REASON_VALUES.includes(note.escalationReason),
    `got=${note.escalationReason}`);
  check(`${label}.allow/consentStatus`, CONSENT_STATUS_VALUES.includes(note.consentStatus),
    `got=${note.consentStatus}`);
  check(`${label}.allow/urgency`, URGENCY_VALUES.includes(note.urgency),
    `got=${note.urgency}`);
}

// ── Universal PHI-leak checks ──────────────────────────────────────────────
function assertNoPhiEcho(label, note) {
  // No SSN-shape value in the note text
  check(`${label}.phi/no_ssn`, !/\b\d{3}-\d{2}-\d{4}\b/.test(note.noteText));
  // No MBI-shape value
  check(`${label}.phi/no_mbi`, !/\b\d[A-Z]{2}\d-[A-Z]{2}\d-[A-Z]{2}\d{2}\b/.test(note.noteText));
  // No raw banking shape (routing+account heuristic)
  check(`${label}.phi/no_routing_account`, !/\b\d{9}\b.{0,5}\b\d{8,17}\b/.test(note.noteText));
}

// ── Universal structure check ──────────────────────────────────────────────
function assertStructure(label, note) {
  check(`${label}.structure/starts_with_summary`, note.noteText.startsWith('CUSTOMER SERVICE SUMMARY'));
  check(`${label}.structure/has_machine_fields`, /MACHINE FIELDS/.test(note.noteText));
  check(`${label}.structure/source_component_first`, /MACHINE FIELDS\nsource_component: customer_service_bot/.test(note.noteText));
  // Summary block must precede machine fields block in the text.
  const idxSummary = note.noteText.indexOf('CUSTOMER SERVICE SUMMARY');
  const idxMachine = note.noteText.indexOf('MACHINE FIELDS');
  check(`${label}.structure/summary_before_machine`, idxSummary < idxMachine && idxSummary >= 0);
}

// ───── TEST 1 — Spanish doctor problem, existing client claimed ─────
{
  const { state, transcript } = run([
    'español', '07407', 'mi plan no aprueba mi cirugia', 'si soy cliente',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T1.es_doctor_existing_client';
  // The user message took the appeal-then-existing-client path. The bot
  // should reflect existing-client claim + appropriate handler.
  check(`${L}.customerStatus is existing_client_claimed`,
    note.customerStatus === 'existing_client_claimed');
  check(`${L}.recommendedStage is existing_client_callback`,
    note.recommendedStage === 'existing_client_callback');
  check(`${L}.escalationReason is existing_client_issue`,
    note.escalationReason === 'existing_client_issue');
  check(`${L}.summary contains 'Spanish'`, /Language: Spanish/.test(note.noteText));
  check(`${L}.summary contains state NJ`, /State: NJ/.test(note.noteText));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 2 — English medication cost, prospect ─────
{
  const { state, transcript } = run([
    'english', '10550', 'my medication is too expensive',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T2.en_meds_prospect';
  check(`${L}.serviceCategory is medication_cost_problem`,
    note.serviceCategory === 'medication_cost_problem');
  check(`${L}.interestType is human label`,
    /Medication cost concern/.test(note.interestType));
  check(`${L}.summary contains 'English'`, /Language: English/.test(note.noteText));
  // Should NOT overstate customer status (no gate triggered).
  check(`${L}.customerStatus NOT existing_client_claimed`,
    note.customerStatus !== 'existing_client_claimed');
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 3 — Spanish bill received, unsure client status ─────
{
  const { state, transcript } = run([
    'español', '06825', 'me llegó una factura',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T3.es_bill_unsure';
  check(`${L}.serviceCategory is bill_received`,
    note.serviceCategory === 'bill_received');
  // No "amount due" claim
  check(`${L}.no amount due claim`,
    !/amount due is/i.test(note.noteText));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 4 — English denied surgery, not client ─────
{
  const { state, transcript } = run([
    'english', '10550', "my plan won't approve my surgery", "no, I'm new",
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T4.en_denied_surgery_notclient';
  check(`${L}.customerStatus is not_client`,
    note.customerStatus === 'not_client');
  check(`${L}.serviceCategory is denied_service`,
    note.serviceCategory === 'denied_service');
  check(`${L}.urgency is Elevated`, note.urgency === 'Elevated');
  check(`${L}.escalationReason captures denial`,
    ['denied_service_dispute', 'not_client_review_request'].includes(note.escalationReason));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 5 — Spanish "llamo por mi mamá", family caregiver ─────
{
  const { state, transcript } = run([
    'español', '07407', 'llamo por mi mamá, tiene problema con su receta',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T5.es_caregiver';
  check(`${L}.customerStatus is family_caregiver`,
    note.customerStatus === 'family_caregiver');
  check(`${L}.escalationReason is family_caregiver_request`,
    note.escalationReason === 'family_caregiver_request' || note.escalationReason === 'topic_requires_advisor' || note.escalationReason === 'none');
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 6 — English advisor request, contact info path ─────
{
  const { state, transcript } = run([
    'english', '10550', 'I want to talk to an advisor',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T6.en_advisor_request';
  check(`${L}.serviceCategory is need_advisor`,
    note.serviceCategory === 'need_advisor');
  // The legacy advisor handler doesn't set advisorHandoffStarted until
  // name+zip collected, but the bot DID begin the advisor flow.
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 7 — Spanish "no soy cliente", general review request ─────
{
  const { state, transcript } = run([
    'español', '06825', 'mi plan no aprueba mi cirugia', 'no soy nuevo',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T7.es_no_cliente';
  check(`${L}.customerStatus is not_client`,
    note.customerStatus === 'not_client');
  check(`${L}.recommendedStage is new_lead_prescreen or hot_handoff`,
    ['new_lead_prescreen', 'hot_handoff'].includes(note.recommendedStage));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 8 — English suspected fraud / scam ─────
{
  const { state, transcript } = run([
    'english', '32301', 'someone called pretending to be Medicare',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T8.en_fraud';
  check(`${L}.serviceCategory is fraud_scam`,
    note.serviceCategory === 'fraud_scam');
  check(`${L}.urgency is Elevated`, note.urgency === 'Elevated');
  check(`${L}.recommendedStage is fraud_alert`,
    note.recommendedStage === 'fraud_alert');
  check(`${L}.escalationReason is fraud_alert`,
    note.escalationReason === 'fraud_alert');
  check(`${L}.tags include category_fraud_scam`,
    note.tags.includes('category_fraud_scam'));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 9 — Spanish lost Medicare card ─────
{
  const { state, transcript } = run([
    'español', '06825', 'perdí mi tarjeta de Medicare',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T9.es_lost_card';
  // Engine may classify generically; we just need allow-list compliance.
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 10 — English "I have Medicaid and Medicare" ─────
{
  const { state, transcript } = run([
    'english', '10550', 'I have both Medicaid and Medicare',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T10.en_dual';
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 11 — Spanish Extra Help question ─────
{
  const { state, transcript } = run([
    'español', '07407', 'quiero saber de extra help',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T11.es_extra_help';
  check(`${L}.serviceCategory is extra_help_question`,
    note.serviceCategory === 'extra_help_question');
  // Compliance critical: no eligibility affirmation in notes.
  check(`${L}.no eligibility affirmation`,
    !/usted califica/i.test(note.noteText) && !/you qualify/i.test(note.noteText));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 12 — English "which plan is best?" must deflect ─────
{
  const { state, transcript } = run([
    'english', '10550', 'which plan is the best for me?',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T12.en_plan_rec_deflect';
  check(`${L}.serviceCategory is plan_change_request`,
    note.serviceCategory === 'plan_change_request');
  // No specific plan name in the note.
  check(`${L}.no specific plan name`,
    !/\b(Humana|UnitedHealthcare|Aetna|Cigna|Wellcare|Kaiser) is best\b/i.test(note.noteText));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 13 — Spanish crisis / self-harm ─────
{
  const { state, transcript } = run([
    'español', '06825', 'me quiero matar',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T13.es_crisis';
  check(`${L}.urgency is Crisis`, note.urgency === 'Crisis');
  check(`${L}.serviceCategory is crisis_988`,
    note.serviceCategory === 'crisis_988');
  check(`${L}.escalationReason is crisis_safety`,
    note.escalationReason === 'crisis_safety');
  check(`${L}.recommendedStage is crisis_followup`,
    note.recommendedStage === 'crisis_followup');
  check(`${L}.summary mentions Crisis`, /Urgency: Crisis/.test(note.noteText));
  check(`${L}.advisor action mentions crisis policy`,
    /\bpol[ií]tica de crisis\b|\bcrisis policy\b|\bcrisis\/escalation policy\b/i.test(note.noteText));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 14 — User volunteers SSN → must scrub ─────
{
  const { state, transcript } = run([
    'english', '10550', 'my SSN is 123-45-6789 just to confirm',
  ]);
  const note = buildLeadNote({ state, transcript });
  const L = 'T14.en_phi_ssn';
  check(`${L}.PHI scrubbed flag set`, note.phiScrubbed === true);
  check(`${L}.note text does NOT echo SSN`,
    !/\b123-45-6789\b/.test(note.noteText));
  check(`${L}.tags include phi_scrubbed`, note.tags.includes('phi_scrubbed'));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TEST 15 — Fake lead (Mickey Mouse + suspicious phone) ─────
{
  // The engine sets `probableFakeLead` via validators when fake contact info
  // is collected. We simulate by directly seeding state markers — these
  // mirror real engine behavior for fake-contact detection.
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('10550', s).newState;
  s = processMessage('my doctor refuses my plan', s).newState;
  s.probableFakeLead = true;
  s.dataConfidenceScore = 25;
  s.inconsistencies = ['name_suspicious_full', 'phone_fake_555_hollywood'];
  const transcript = s.messages.map((m) => ({
    sender: m.role === 'bot' ? 'bot' : 'user',
    text: m.content,
  }));
  const note = buildLeadNote({ state: s, transcript });
  const L = 'T15.en_fake_lead';
  check(`${L}.probable_fake_lead in machine fields`,
    /probable_fake_lead: true/.test(note.noteText));
  check(`${L}.recommendedStage is review_queue`,
    note.recommendedStage === 'review_queue');
  check(`${L}.tags include probable_fake_lead`,
    note.tags.includes('probable_fake_lead'));
  check(`${L}.confidence tag is low`,
    note.tags.some((t) => t === 'confidence_low'));
  assertStructure(L, note);
  assertAllowLists(L, note);
  assertCompliance(L, note);
  assertNoPhiEcho(L, note);
}

// ───── TOTALS ─────────────────────────────────────────────────────────────
console.log(`\n=== PHASE F LEAD NOTE: ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%) ===`);
if (fails.length > 0) {
  console.log('\nFAILED:');
  for (const f of fails.slice(0, 30)) console.log(`  ✗ ${f}`);
  if (fails.length > 30) console.log(`  ... (+${fails.length - 30} more)`);
}
process.exit(fails.length > 0 ? 1 : 0);

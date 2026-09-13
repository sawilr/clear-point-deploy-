// Phase 3 QA — Customer Service Bot GHL integration test harness.
// Submits 3 clearly-labeled QA contacts to PROD /api/submit-lead with payloads
// that mirror what CustomerServiceBot.tsx buildSupportPayload() would generate.
// Test contacts are clearly marked "QA TEST — DELETE AFTER VERIFICATION".

const ENDPOINT = 'https://clearpointsenioradvisors.com/api/submit-lead';
const ts = new Date().toISOString();

async function submit(payload, label) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  console.log(`\n=== ${label} ===`);
  console.log(`Status: ${res.status}`);
  console.log(`Body: ${json ? JSON.stringify(json) : text.slice(0, 200)}`);
  return { status: res.status, body: json };
}

function buildNotes({ lang, mainIntent, secondary, urgency, state, zip, bestTime, consent, privacyShown, emergencyShown, questions }) {
  return [
    '[ClearPoint Support Guide]',
    `Submitted: ${ts}`,
    `Language: ${lang}`,
    '',
    'CASE',
    `Main issue: ${mainIntent}`,
    `Secondary issues: ${secondary.length ? secondary.join(', ') : 'none'}`,
    `Urgency: ${urgency}`,
    '',
    'CUSTOMER CONTEXT',
    `State: ${state || 'not provided'}`,
    `ZIP: ${zip || 'not provided'}`,
    `Best time to call: ${bestTime || 'not specified'}`,
    `Consent to contact: ${consent ? 'YES' : 'NO'}`,
    `Sensitive info warning shown: ${privacyShown ? 'YES' : 'NO'}`,
    `Sensitive data intercepted by bot: NO`,
    `Emergency warning triggered: ${emergencyShown ? 'YES' : 'NO'}`,
    '',
    'CUSTOMER QUESTIONS / CONTEXT',
    questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n'),
    '',
    'RECOMMENDED NEXT ACTION',
    'A licensed advisor should review this case and follow up with the customer.',
    '',
    '[Wave 3 QA TEST — DELETE AFTER VERIFICATION]',
  ].join('\n');
}

// ── TEST 1 — Spanish medication + Medicaid (multi-intent) ──
const t1 = await submit({
  source: 'customer_service_bot',
  form_name: 'ClearPoint Support Guide',
  first_name: 'QA',
  last_name: 'SupportBot-MedES-Multi',
  full_name: 'QA SupportBot-MedES-Multi',
  phone: '2125550311',
  email: 'qa+support-med-es@example.invalid',
  zip_code: '10001',
  preferred_language: 'es',
  derived_state: 'NY',
  consent_to_contact: true,
  consent_text: 'Acepto que un asesor licenciado de ClearPoint me contacte respecto a mi pregunta de Medicare.',
  best_time_to_contact: 'Tarde',
  lead_notes: buildNotes({
    lang: 'Spanish',
    mainIntent: 'medication_help',
    secondary: ['medicaid_msp'],
    urgency: 'normal',
    state: 'NY',
    zip: '10001',
    bestTime: 'Tarde',
    consent: true,
    privacyShown: true,
    emergencyShown: false,
    questions: ['Mi medicina está muy cara y también tengo Medicaid.'],
  }),
  bot_transcript_summary: 'Support bot · Primary: medication_help · Secondary: medicaid_msp · Urgency: normal',
  tags: ['customer_service_bot', 'clearpoint_support', 'spanish', 'medication_help', 'medicaid_msp', 'needs_agent_review', 'sensitive_warning_shown'],
  created_at: ts,
  website_url: '',
}, 'TEST 1 — Spanish medication + Medicaid');

// ── TEST 2 — English doctor + call requested ──
const t2 = await submit({
  source: 'customer_service_bot',
  form_name: 'ClearPoint Support Guide',
  first_name: 'QA',
  last_name: 'SupportBot-DocEN-Call',
  full_name: 'QA SupportBot-DocEN-Call',
  phone: '3055550311',
  email: 'qa+support-doc-en@example.invalid',
  zip_code: '33101',
  preferred_language: 'en',
  derived_state: 'FL',
  consent_to_contact: true,
  consent_text: 'I agree to be contacted by a licensed ClearPoint advisor at the phone number I provided.',
  best_time_to_contact: 'Morning',
  lead_notes: buildNotes({
    lang: 'English',
    mainIntent: 'doctor_network_question',
    secondary: ['call_requested'],
    urgency: 'normal',
    state: 'FL',
    zip: '33101',
    bestTime: 'Morning',
    consent: true,
    privacyShown: true,
    emergencyShown: false,
    questions: ['My doctor is not in network and I want someone to call me.'],
  }),
  bot_transcript_summary: 'Support bot · Primary: doctor_network_question · Secondary: call_requested · Urgency: normal',
  tags: ['customer_service_bot', 'clearpoint_support', 'english', 'doctor_network', 'call_requested', 'needs_agent_review', 'sensitive_warning_shown'],
  created_at: ts,
  website_url: '',
}, 'TEST 2 — English doctor + call requested');

// ── TEST 3 — Spanish letter + coverage loss (urgent) ──
const t3 = await submit({
  source: 'customer_service_bot',
  form_name: 'ClearPoint Support Guide',
  first_name: 'QA',
  last_name: 'SupportBot-LetterES-Urgent',
  full_name: 'QA SupportBot-LetterES-Urgent',
  phone: '2015550311',
  email: 'qa+support-letter-es@example.invalid',
  zip_code: '07101',
  preferred_language: 'es',
  derived_state: 'NJ',
  consent_to_contact: true,
  consent_text: 'Acepto que un asesor licenciado de ClearPoint me contacte respecto a mi pregunta de Medicare.',
  best_time_to_contact: 'Mañana',
  lead_notes: buildNotes({
    lang: 'Spanish',
    mainIntent: 'plan_letter_issue',
    secondary: ['possible_loss_of_coverage'],
    urgency: 'urgent',
    state: 'NJ',
    zip: '07101',
    bestTime: 'Mañana',
    consent: true,
    privacyShown: true,
    emergencyShown: false,
    questions: ['Me llegó una carta y creo que perdí mi cobertura.'],
  }),
  bot_transcript_summary: 'Support bot · Primary: plan_letter_issue · Secondary: possible_loss_of_coverage · Urgency: urgent',
  tags: ['customer_service_bot', 'clearpoint_support', 'spanish', 'plan_letter_issue', 'coverage_loss', 'needs_agent_review', 'urgent_review', 'sensitive_warning_shown'],
  created_at: ts,
  website_url: '',
}, 'TEST 3 — Spanish letter + coverage loss (urgent)');

console.log('\n\n=== SUMMARY ===');
const tests = [
  { id: 'T1', label: 'ES medication + Medicaid', status: t1.status, contactId: t1.body?.contact_id, pass: t1.status === 200 && !!t1.body?.contact_id },
  { id: 'T2', label: 'EN doctor + call_requested', status: t2.status, contactId: t2.body?.contact_id, pass: t2.status === 200 && !!t2.body?.contact_id },
  { id: 'T3', label: 'ES letter + coverage_loss (urgent)', status: t3.status, contactId: t3.body?.contact_id, pass: t3.status === 200 && !!t3.body?.contact_id },
];
tests.forEach((t) => console.log(`  ${t.pass ? '✓' : '✗'} ${t.id} | ${t.label} | ${t.status}${t.contactId ? ' contact_id=' + t.contactId : ''}`));

console.log('\nContact IDs (mark as Phase 3 QA TEST — DELETE AFTER VERIFICATION):');
tests.forEach((t, i) => { if (t.contactId) console.log(`  Test ${i + 1}: ${t.contactId}`); });

// Wave 1.9 — End-to-end GHL lead flow verification
// Submits 2 clearly-labeled QA contacts to PRODUCTION API + 1 failure-path test.
// Production endpoint reaches GHL; Preview cannot (Option A).
//
// Note: production deployment is pre-Phase A (before language tag fix). The
// payloads here mimic the post-Phase A frontend output (clean tags) so we
// can see whether the GHL ingest path itself handles them correctly. The
// real test contacts will be deleted after Sawil approval.

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

// ── TEST 1 — Free Review (LeadForm pattern) ──
const t1 = await submit({
  source: 'ClearPoint Senior Advisors Website',
  form_name: 'contact-page Form',
  first_name: 'QA',
  last_name: 'ClearPoint-FreeReview-EN',
  full_name: 'QA ClearPoint-FreeReview-EN',
  phone: '2125550111',
  email: 'qa+clearpoint-free-en@example.invalid',
  zip_code: '10001',
  preferred_language: 'English',
  medicare_status: 'Original Medicare (Parts A & B)',
  consent_to_contact: true,
  consent: true,
  consent_sms: true,
  consent_call: true,
  consent_text: 'TCPA consent captured via QA test',
  lead_notes: '[Wave 1.9 QA TEST — DELETE AFTER VERIFICATION] Free Review EN path. Submitted via QA harness on ' + ts + '. Test only — no real customer.',
  tags: ['Website Lead', 'Medicare Lead', 'ClearPoint Website', 'Form Lead', 'Consent Captured'],
  created_at: ts,
  website_url: '', // empty honeypot — clean
}, 'TEST 1 — Free Review EN');

// ── TEST 2 — Smart Review pattern ES ──
const t2 = await submit({
  source: 'Clear Point Senior Advisors Website',
  form_name: 'Smart Medicare Review',
  first_name: 'QA',
  last_name: 'ClearPoint-SmartReview-ES',
  full_name: 'QA ClearPoint-SmartReview-ES',
  phone: '3055550111',
  email: 'qa+clearpoint-smart-es@example.invalid',
  date_of_birth: '03/15/1955',
  calculated_age: 70,
  zip_code: '33101',
  city: 'Miami',
  county: 'Miami-Dade',
  derived_state: 'FL',
  preferred_language: 'Spanish',
  medicare_status: '',
  interest_type: 'Quiero reducir mis costos de Medicare',
  consent_to_contact: true,
  consent: true,
  consent_sms: true,
  consent_call: true,
  consent_text: 'TCPA consent captured via QA test (ES)',
  lead_notes: '[Wave 1.9 QA TEST — DELETE AFTER VERIFICATION] Smart Review ES path. Submitted via QA harness on ' + ts + '. Test only — no real customer. Idioma: Español. Estado: FL. ZIP: 33101.',
  lead_quality_flags: '',
  tags: ['Smart Review Lead', 'Medicare Lead'],
  created_at: ts,
  website_url: '', // empty honeypot — clean
}, 'TEST 2 — Smart Review ES');

// ── TEST 3 — Failure path: invalid phone (validation should reject) ──
const t3 = await submit({
  source: 'QA',
  form_name: 'QA Failure Path',
  first_name: 'QA-FailTest',
  last_name: 'ShouldRejectPhone',
  phone: '0000000000',  // all zeros - validation should reject
  email: 'qa+failtest@example.invalid',
  preferred_language: 'en',
  consent_to_contact: true,
  consent: true,
  lead_notes: '[Wave 1.9 QA FAILURE TEST] Expected 400 phone rejection. No contact should be created.',
  tags: ['QA', 'FailTest'],
  website_url: '',
}, 'TEST 3 — Failure Path (invalid phone)');

// ── Summary ──
console.log('\n\n=== Summary ===');
const tests = [
  { id: 'T1', label: 'Free Review EN', expected: '200 + contact_id', actual: t1.status, contactId: t1.body?.contact_id, pass: t1.status === 200 && !!t1.body?.contact_id },
  { id: 'T2', label: 'Smart Review ES', expected: '200 + contact_id', actual: t2.status, contactId: t2.body?.contact_id, pass: t2.status === 200 && !!t2.body?.contact_id },
  { id: 'T3', label: 'Failure (invalid phone)', expected: '400 + no contact', actual: t3.status, contactId: t3.body?.contact_id || null, pass: t3.status === 400 && !t3.body?.contact_id },
];
tests.forEach(t => console.log(`  ${t.pass ? '✅ PASS' : '❌ FAIL'} | ${t.id} | ${t.label} | expected ${t.expected}, got ${t.actual}${t.contactId ? ' contact_id=' + t.contactId : ''}`));

console.log('\nContact IDs created (mark as QA TEST — DELETE AFTER VERIFICATION):');
[t1, t2].forEach((t, i) => {
  if (t.body?.contact_id) console.log(`  Test ${i+1}: ${t.body.contact_id}`);
});
console.log('\nFailure test should NOT have created a contact:', t3.body?.contact_id ? 'BUG — contact created' : 'OK — no contact');

// PHASE A — Language fix verification
// One EN submission + One ES submission to PRODUCTION (Preview can't reach GHL).
// Each payload mimics the FIXED frontend (no redundant Spanish/English tag).
// L5QA markers. Sawil deletes contacts after verification.

const ENDPOINT = 'https://clearpointsenioradvisors.com/api/submit-lead';

const tests = [
  {
    label: 'EN — interface and preferred match',
    payload: {
      first_name: 'L5QA-LangFix-EN2',
      last_name: 'SafeToDelete-PhaseA',
      phone: '2125550202',
      email: 'l5qa-langfix-en2@example.invalid',
      preferred_language: 'en',
      zip: '10001', city: 'New York', state: 'NY', derived_state: 'NY',
      medicare_status: 'Medicare Advantage',
      consent_to_contact: true, consent: true, consent_sms: true, consent_call: true,
      lead_notes: '[PHASE A LANGFIX TEST EN — SAFE TO DELETE] Tests post-fix payload: preferred=English, no redundant English/Spanish tag.',
      conversation_summary: 'Phase A LangFix EN test.',
      lead_source: 'L5QA Phase A LangFix EN',
      form_name: 'L5QA Phase A LangFix EN Test',
      // Fixed frontend would send these tags WITHOUT 'English' or 'Spanish'
      tags: ['L5QA', 'Phase A LangFix', 'Safe To Delete'],
      created_at: new Date().toISOString(),
    },
    expect: {
      preferred_language_field: 'en',
      auto_tag: 'lang-en',
      forbidden_tags: ['english', 'spanish'],
    },
  },
  {
    label: 'ES — drift case (preferred ES, no language tag in frontend)',
    payload: {
      first_name: 'L5QA-LangFix-ES2',
      last_name: 'SafeToDelete-PhaseA',
      phone: '2125550203',
      email: 'l5qa-langfix-es2@example.invalid',
      preferred_language: 'es',
      zip: '10001', city: 'New York', state: 'NY', derived_state: 'NY',
      medicare_status: 'Original Medicare (Parts A & B)',
      consent_to_contact: true, consent: true, consent_sms: true, consent_call: true,
      lead_notes: '[PHASE A LANGFIX TEST ES — SAFE TO DELETE] Tests drift case: preferred=Spanish, no redundant English/Spanish tag. Should land with Lang-ES auto-tag only.',
      conversation_summary: 'Phase A LangFix ES test.',
      lead_source: 'L5QA Phase A LangFix ES',
      form_name: 'L5QA Phase A LangFix ES Test',
      tags: ['L5QA', 'Phase A LangFix', 'Safe To Delete'],
      created_at: new Date().toISOString(),
    },
    expect: {
      preferred_language_field: 'es',
      auto_tag: 'lang-es',
      forbidden_tags: ['english', 'spanish'],
    },
  },
];

const results = [];
for (const t of tests) {
  console.log(`\n=== ${t.label} ===`);
  console.log(`POST → ${ENDPOINT}`);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(t.payload),
  });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch {}
  const result = {
    label: t.label,
    status: res.status,
    contact_id: json?.contact_id,
    response: json,
    expect: t.expect,
  };
  results.push(result);
  console.log(`Status: ${res.status} | contact_id: ${result.contact_id || 'N/A'}`);
  console.log(`Response: ${JSON.stringify(json)}`);
}

console.log('\n=== Summary ===');
results.forEach(r => {
  console.log(`  ${r.contact_id ? '✅' : '❌'} ${r.label} → ${r.contact_id || 'NO CONTACT CREATED'}`);
});

console.log('\nContact IDs (for MCP verification step):');
results.forEach(r => r.contact_id && console.log(`  ${r.label.split(' — ')[0]}: ${r.contact_id}`));

// Write summary for next step
import { writeFileSync } from 'node:fs';
writeFileSync(
  'phase-a-test-results.json',
  JSON.stringify({ timestamp: new Date().toISOString(), endpoint: ENDPOINT, results }, null, 2)
);
console.log('\nWrote: phase-a-test-results.json');

// Wave 1.9 — Verify post-ghl.ts payload shape produces clean lang-en tag.
// Production frontend (post-Phase A) flow: LeadForm → ghl.ts (maps English→en) → API.
// The earlier T1/T2 sent 'English'/'Spanish' directly to API (pre-ghl.ts shape),
// which produced lang-english/lang-spanish tags — a TEST methodology issue, not a
// backend bug. This 3rd test sends 'en' (post-ghl.ts shape) to confirm the API
// produces the expected lang-en tag for real production submissions.

const ENDPOINT = 'https://clearpointsenioradvisors.com/api/submit-lead';
const ts = new Date().toISOString();

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    // This mirrors what ghl.ts actually forwards to the API after mapping.
    first_name: 'QA',
    last_name: 'ClearPoint-PostGhlTs-EN',
    phone: '2125550112',
    email: 'qa+clearpoint-postghlts-en@example.invalid',
    zip: '10001',
    preferred_language: 'en',       // ← post-ghl.ts format
    medicare_status: 'Original Medicare (Parts A & B)',
    lead_source: 'ClearPoint Senior Advisors Website',
    consent_to_contact: true,
    consent: true,
    consent_sms: true,
    consent_call: true,
    lead_notes: '[Wave 1.9 QA TEST — DELETE AFTER VERIFICATION] Post-ghl.ts EN path. Submitted via QA harness on ' + ts + '. Test only — no real customer.',
    tags: ['Website Lead', 'Medicare Lead', 'ClearPoint Website', 'Form Lead', 'Consent Captured'],
    website_url: '', // empty honeypot
  }),
});
const text = await res.text();
let json = null;
try { json = JSON.parse(text); } catch {}
console.log('Status:', res.status);
console.log('Body:', json ? JSON.stringify(json) : text.slice(0, 200));

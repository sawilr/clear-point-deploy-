// Wave 1.9 — Honeypot anti-bot gate verification
// Tests against PREVIEW. Honeypot fires BEFORE env check, so this works even
// though Preview has no GHL env vars configured.
//
// Expected:
//   TEST 1 (honeypot filled) → 200 + {success: true, message: 'Received'} NO contact_id
//   TEST 2 (no honeypot, clean) → 500 "Server configuration error" (env check fires)
//
// The differentiation proves the honeypot gate fires only when the field has value.

const PREVIEW_BASE = 'https://clearpoint-deploy-go1b8w9op-sawil-reyess-projects.vercel.app';
const ENDPOINT = `${PREVIEW_BASE}/api/submit-lead`;
const SHARE_TOKEN = 'MrYIn9o2oRyEITLCtXJ0HPg7XViuyjbX';
const SHARE_URL = `${PREVIEW_BASE}/?_vercel_share=${SHARE_TOKEN}`;

let cookieJar = '';
async function warmup() {
  let url = SHARE_URL;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', headers: cookieJar ? { Cookie: cookieJar } : {} });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookies.length) {
      const map = new Map();
      for (const c of setCookies) {
        const [k, v] = c.split(';')[0].split('=');
        if (k) map.set(k, v ?? '');
      }
      cookieJar = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = loc.startsWith('http') ? loc : new URL(loc, url).toString();
      continue;
    }
    break;
  }
}

async function probe(payload, label) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  console.log(`\n--- ${label} ---`);
  console.log(`Status: ${res.status}`);
  console.log(`Body: ${json ? JSON.stringify(json) : text.slice(0, 200)}`);
  return { status: res.status, body: json };
}

await warmup();

const basePayload = {
  first_name: 'Wave19-Honeypot',
  last_name: 'Test',
  phone: '2125550199',
  email: 'wave19@example.invalid',
  preferred_language: 'en',
  zip: '10001',
  derived_state: 'NY',
  consent_to_contact: true,
  consent: true,
  consent_sms: true,
  consent_call: true,
  lead_source: 'Wave 1.9 Honeypot Test',
  tags: ['Wave19', 'HoneypotTest'],
};

console.log('=== Wave 1.9 Honeypot Gate Verification ===');
console.log(`Endpoint: ${ENDPOINT}`);
console.log(`Cookies acquired: ${cookieJar.split('; ').map(c => c.split('=')[0]).join(', ')}`);

// TEST 1: honeypot filled — should be discarded silently
const t1 = await probe(
  { ...basePayload, website_url: 'https://spam-bot.example.com' },
  'TEST 1: HONEYPOT FILLED (expect 200 + success:true + NO contact_id)'
);

// TEST 2: honeypot empty — should reach env check and return 500
const t2 = await probe(
  { ...basePayload, website_url: '' },
  'TEST 2: HONEYPOT EMPTY (expect 500 env-config — proves honeypot did NOT trigger)'
);

console.log('\n=== Verdict ===');
const honeypotDiscarded = t1.status === 200 && t1.body?.success === true && !t1.body?.contact_id;
const cleanReachedEnvCheck = t2.status === 500;

if (honeypotDiscarded && cleanReachedEnvCheck) {
  console.log('✅ PASS — honeypot gate working correctly.');
  console.log('  - Bot-style submission (honeypot filled): silently discarded with generic 200');
  console.log('  - Clean submission: reached env check (500) — would proceed to GHL on production');
} else {
  console.log('❌ FAIL — honeypot behavior incorrect.');
  console.log(`  - Honeypot test passed expected: ${honeypotDiscarded}`);
  console.log(`  - Clean test passed expected: ${cleanReachedEnvCheck}`);
}

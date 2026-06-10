// L5/L6 — PREVIEW BEHAVIOR PROBE
// Confirms exactly what Preview does without changing anything.
// One POST to Preview /api/submit-lead to capture the error behavior.

const PREVIEW_BASE = 'https://clearpoint-deploy-h5ly6xs85-sawil-reyess-projects.vercel.app';
const ENDPOINT = `${PREVIEW_BASE}/api/submit-lead`;
const SHARE_TOKEN = 'yndXlE2uftR5jcFNrFtRu9u4NeukcLdB';
const SHARE_URL = `${PREVIEW_BASE}/?_vercel_share=${SHARE_TOKEN}`;

// Warmup — collect _vercel_jwt cookie (no values printed)
let cookieJar = '';
async function warmup() {
  let url = SHARE_URL;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', headers: cookieJar ? { Cookie: cookieJar } : {} });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookies.length) {
      const map = new Map(cookieJar ? cookieJar.split('; ').map(p => p.split('=').slice(0, 2)).filter(a => a[0]) : []);
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
  const names = cookieJar.split('; ').map(c => c.split('=')[0]).filter(Boolean);
  console.log(`Cookies acquired: ${names.join(', ') || '(none)'}`);
}

await warmup();

// Probe 1 — empty POST (just see how API errors)
console.log('\n=== Probe 1: empty POST to Preview /api/submit-lead ===');
const r1 = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
  body: '{}',
});
const r1text = await r1.text();
console.log(`Status: ${r1.status}`);
console.log(`Body: ${r1text.slice(0, 200)}`);

// Probe 2 — valid-shape POST that would succeed in production
console.log('\n=== Probe 2: valid-shape POST to Preview /api/submit-lead ===');
console.log('(Would create a GHL contact ONLY if Preview env vars are configured — we expect 500)');
const r2payload = {
  first_name: 'L5QA-Preview-Probe',
  last_name: 'NotARealLead',
  phone: '2125550199',
  email: 'preview-probe@example.invalid',
  preferred_language: 'en',
  zip: '10001', state: 'NY', derived_state: 'NY',
  consent_to_contact: true, consent: true, consent_sms: true, consent_call: true,
  lead_notes: '[L5 PREVIEW PROBE — should NOT reach GHL] If you see this in GHL, Preview env vars are misconfigured.',
  lead_source: 'L5 Preview Probe',
  form_name: 'L5 Preview Probe',
  tags: ['L5QA', 'Preview Probe', 'Safe To Delete'],
};
const r2 = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
  body: JSON.stringify(r2payload),
});
const r2text = await r2.text();
let r2json = null;
try { r2json = JSON.parse(r2text); } catch {}
console.log(`Status: ${r2.status}`);
console.log(`Body: ${(r2json ? JSON.stringify(r2json) : r2text).slice(0, 300)}`);

// Interpret
console.log('\n=== INTERPRETATION ===');
if (r2.status === 500 && r2json?.error === 'Server configuration error') {
  console.log('✅ EXPECTED — Preview cannot reach GHL because env vars are Production-scoped only.');
  console.log('   No GHL contact created. No pollution. This is by design.');
  console.log('   Confirms the configuration limitation Sawil documented.');
} else if (r2.status === 200 && r2json?.contact_id) {
  console.log(`⚠️ UNEXPECTED — Preview created GHL contact ${r2json.contact_id}`);
  console.log('   This means Preview env vars ARE configured and would pollute production GHL.');
  console.log('   Sawil should delete this contact immediately.');
} else if (r2.status === 400) {
  console.log('⚠️ Validation error — Preview reached the validation layer but rejected the payload.');
  console.log(`   Reason: ${r2json?.reason || 'see body above'}`);
} else if (r2.status === 401 || r2.status === 403) {
  console.log('⚠️ AUTH BLOCKED — share cookie not propagating. Re-issue share token.');
} else {
  console.log(`❓ Unexpected status ${r2.status} — see body above for details.`);
}

console.log('\n=== Summary ===');
console.log(`Preview URL:    ${PREVIEW_BASE}`);
console.log(`Endpoint:       ${ENDPOINT}`);
console.log(`Probe 1 status: ${r1.status} (empty POST)`);
console.log(`Probe 2 status: ${r2.status} (valid-shape POST)`);

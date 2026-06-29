// SECURITY HOTFIX — Fixes 2/3/4/5 tests (audit findings 02/03/19/05):
// /api/submit-lead consent gate, server phone validation, sanitized errors,
// no-store headers. globalThis.fetch is STUBBED — NO real GHL/LLM calls, and we
// assert ZERO GHL-contact POSTs on every rejected payload. Synthetic data only.
process.env.HIGHLEVEL_TOKEN = 'test-token-not-real';
process.env.HIGHLEVEL_LOCATION_ID = 'test-loc-not-real';
delete process.env.ANTHROPIC_API_KEY; // lead-intel short-circuits gracefully

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

// ── fetch stub ──────────────────────────────────────────────────────────────
let ghlContactPosts = 0;
let ghlScenario = 'success';
const mkResp = (status, body) => ({ ok: status >= 200 && status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (/leadconnectorhq\.com\/contacts\/?(\?|$)/.test(u) && (opts.method === 'POST')) {
    ghlContactPosts++;
    if (ghlScenario === 'duplicate') return mkResp(400, { message: 'This location does not allow duplicated contacts.', meta: { contactId: 'existing-123' } });
    if (ghlScenario === 'error') return mkResp(500, { message: 'internal' });
    return mkResp(201, { contact: { id: 'c-123' } });
  }
  if (/leadconnectorhq\.com\/(opportunities|contacts\/.+\/notes)/.test(u)) return mkResp(201, { id: 'x' });
  return mkResp(200, {}); // intel / anything else → benign
};

const { default: handler } = await import('../api/submit-lead.js');

function mockRes() {
  const r = { headers: {}, statusCode: null, body: null };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => r;
  return r;
}
const mockReq = (body) => ({ method: 'POST', headers: { origin: 'https://clearpointsenioradvisors.com', 'x-real-ip': '203.0.113.' + Math.floor(Math.random() * 250) }, body });
const noStore = (res) => res.headers['cache-control'] === 'no-store, private' && res.headers['pragma'] === 'no-cache';

async function run(label, body, scenario = 'success') {
  ghlScenario = scenario;
  const before = ghlContactPosts;
  const res = mockRes();
  await handler(mockReq(body), res);
  return { res, ghlPosts: ghlContactPosts - before };
}

const VALID = { first_name: 'Diego', last_name: 'Pruebas', phone: '347-888-1234', email: 'qa@example.com', zip: '10001', derived_state: 'NY', preferred_language: 'en' };

// ── Fix 2 — CONSENT GATE: reject before any GHL call ──────────────────────────
for (const [label, consent] of [['missing', undefined], ['false bool', false], ['null', null], ['string "false"', 'false'], ['string "true" (not bool)', 'true'], ['0', 0]]) {
  const r = await run('consent', { ...VALID, consent_to_contact: consent });
  ok(`consent ${label} → 400 CONSENT_REQUIRED`, r.res.statusCode === 400 && r.res.body?.error === 'CONSENT_REQUIRED', `status=${r.res.statusCode} body=${JSON.stringify(r.res.body)}`);
  ok(`consent ${label} → ZERO GHL calls`, r.ghlPosts === 0, `ghlPosts=${r.ghlPosts}`);
  ok(`consent ${label} → no-store`, noStore(r.res));
}

// ── Fix 3 — SERVER PHONE VALIDATION (consent valid, bad phone) ────────────────
for (const [label, phone] of [
  ['212-555-0100 (fictional)', '212-555-0100'],
  ['212-867-5309 (Jenny)', '212-867-5309'],
  ['829 Dominican', '829-563-2553'],
  ['809 Dominican', '809-200-1122'],
  ['+44 foreign', '+44 20 7946 0000'],
  ['1111111111 repeated', '1111111111'],
  ['1234567890 sequential', '1234567890'],
]) {
  const r = await run('phone', { ...VALID, phone, consent_to_contact: true });
  ok(`phone ${label} → rejected 400, no contact`, r.res.statusCode === 400 && r.ghlPosts === 0, `status=${r.res.statusCode} ghlPosts=${r.ghlPosts}`);
}

// ── Fix 3 — valid US number + consent → reaches GHL ──────────────────────────
{
  const r = await run('valid', { ...VALID, consent_to_contact: true }, 'success');
  ok('valid consented lead → 200 success', r.res.statusCode === 200 && r.res.body?.success === true, `status=${r.res.statusCode} body=${JSON.stringify(r.res.body)}`);
  ok('valid consented lead → GHL contact POST happened', r.ghlPosts === 1, `ghlPosts=${r.ghlPosts}`);
  ok('valid consented lead → no-store', noStore(r.res));
}

// ── Fix 4 — DUPLICATE → clean 409, no raw detail ─────────────────────────────
{
  const r = await run('dup', { ...VALID, consent_to_contact: true }, 'duplicate');
  ok('duplicate → 409 DUPLICATE_LEAD', r.res.statusCode === 409 && r.res.body?.error === 'DUPLICATE_LEAD', `status=${r.res.statusCode} body=${JSON.stringify(r.res.body)}`);
  ok('duplicate → no raw CRM detail leaked', !('detail' in (r.res.body || {})) && !/duplicat/i.test(JSON.stringify(r.res.body).replace('DUPLICATE_LEAD', '')), JSON.stringify(r.res.body));
}

// ── Fix 4 — CRM error → sanitized 502, no detail ─────────────────────────────
{
  const r = await run('err', { ...VALID, consent_to_contact: true }, 'error');
  ok('CRM error → 502 sanitized (no detail field)', r.res.statusCode === 502 && r.res.body?.error === 'CRM_UNAVAILABLE' && !('detail' in (r.res.body || {})), `status=${r.res.statusCode} body=${JSON.stringify(r.res.body)}`);
}

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

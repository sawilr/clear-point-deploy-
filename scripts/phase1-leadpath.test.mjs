// AUDIT REMEDIATION — PHASE 1 (no lost leads, no false success).
// Proves C1 (retry-with-backoff on transient GHL failure), C3/BUG-003 (2xx with
// empty/invalid body is treated as success, not a false failure that orphans the
// contact), and C4/BUG-004 (Zara voice spoken-number normalization).
// globalThis.fetch is STUBBED — NO real GHL/LLM calls. Synthetic data only.
process.env.HIGHLEVEL_TOKEN = 'test-token-not-real';
process.env.HIGHLEVEL_LOCATION_ID = 'test-loc-not-real';
delete process.env.ANTHROPIC_API_KEY; // lead-intel short-circuits gracefully

import { normalizeSpokenNumbers } from '../src/lib/spokenNumbers.ts';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

// ── programmable fetch stub ──────────────────────────────────────────────────
let contactAttempts = 0;
let contactPlan = null; // (attemptIndex) => { action:'resp'|'throw', status, body, jsonThrows }
const mkResp = (status, body, jsonThrows = false) => ({
  ok: status >= 200 && status < 400,
  status,
  json: async () => { if (jsonThrows) throw new Error('Unexpected end of JSON input'); return body; },
  text: async () => { try { return JSON.stringify(body); } catch { return ''; } },
});
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const isContactWrite = (opts.method === 'POST' || opts.method === 'PUT')
    && /leadconnectorhq\.com\/contacts\//.test(u) && !/\/notes$/.test(u);
  if (isContactWrite) {
    const i = contactAttempts++;
    const step = contactPlan ? contactPlan(i) : { action: 'resp', status: 201, body: { contact: { id: 'c-1' } } };
    if (step.action === 'throw') throw new Error('network down');
    return mkResp(step.status, step.body, step.jsonThrows);
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

const VALID = { first_name: 'Diego', last_name: 'Pruebas', phone: '347-888-1234', email: 'qa@example.com', zip: '10001', derived_state: 'NY', preferred_language: 'en', consent_to_contact: true };

async function run(plan, override = {}) {
  contactAttempts = 0; contactPlan = plan;
  const res = mockRes();
  await handler(mockReq({ ...VALID, ...override }), res);
  return { res, attempts: contactAttempts };
}
const isSuccess = (res) => res.statusCode != null && res.statusCode < 400;

// ── C1 — retry-with-backoff on transient GHL failure ─────────────────────────
{
  const r = await run((i) => i < 2 ? { action: 'resp', status: 500, body: {} } : { action: 'resp', status: 201, body: { contact: { id: 'c-1' } } });
  ok('C1 · 500×2 then 201 → SUCCESS (lead saved)', isSuccess(r.res), `status=${r.res.statusCode}`);
  ok('C1 · 500×2 then 201 → retried (3 attempts)', r.attempts === 3, `attempts=${r.attempts}`);
}
{
  const r = await run((i) => i < 2 ? { action: 'throw' } : { action: 'resp', status: 201, body: { contact: { id: 'c-1' } } });
  ok('C1 · network throw×2 then 201 → SUCCESS', isSuccess(r.res), `status=${r.res.statusCode}`);
  ok('C1 · network throw×2 then 201 → retried (3 attempts)', r.attempts === 3, `attempts=${r.attempts}`);
}
{
  const r = await run(() => ({ action: 'resp', status: 500, body: {} }));
  ok('C1 · persistent 500 → 502 CRM_UNAVAILABLE (clear retryable failure)', r.res.statusCode === 502 && r.res.body?.error === 'CRM_UNAVAILABLE', `status=${r.res.statusCode}`);
  ok('C1 · persistent 500 → BOUNDED (exactly 3 attempts, no infinite loop)', r.attempts === 3, `attempts=${r.attempts}`);
}
{
  const r = await run(() => ({ action: 'throw' }));
  ok('C1 · persistent network throw → failure (not success)', !isSuccess(r.res), `status=${r.res.statusCode}`);
  ok('C1 · persistent network throw → BOUNDED (3 attempts)', r.attempts === 3, `attempts=${r.attempts}`);
}
{
  const r = await run((i) => ({ action: 'resp', status: 201, body: { contact: { id: 'c-1' } } }));
  ok('C1 · healthy GHL → SUCCESS with NO wasted retry (1 attempt)', isSuccess(r.res) && r.attempts === 1, `status=${r.res.statusCode} attempts=${r.attempts}`);
}
{
  // 4xx duplicate is deterministic — must NOT be retried.
  const r = await run(() => ({ action: 'resp', status: 400, body: { message: 'This location does not allow duplicated contacts.' } }));
  ok('C1 · 400 duplicate → 409 and NOT retried (1 attempt)', r.res.statusCode === 409 && r.attempts === 1, `status=${r.res.statusCode} attempts=${r.attempts}`);
}

// ── C2 — verified existing client (Path A matched): empty phone + ghl_contact_id ─
{
  const r = await run(() => ({ action: 'resp', status: 201, body: { contact: { id: 'existing-1' } } }), { ghl_contact_id: 'existing-1', first_name: '', last_name: '', phone: '' });
  ok('C2 · verified client (ghl_contact_id, empty phone) → SUCCESS, not 400 drop', isSuccess(r.res), `status=${r.res.statusCode}`);
  ok('C2 · verified client → lead actually reached GHL (>=1 write)', r.attempts >= 1, `attempts=${r.attempts}`);
}
{
  const r = await run(() => ({ action: 'resp', status: 201, body: { contact: { id: 'c' } } }), { phone: '' });
  ok('C2 · NO ghl_contact_id + empty phone → still 400 (guard intact)', r.res.statusCode === 400, `status=${r.res.statusCode}`);
}
{
  const r = await run(() => ({ action: 'resp', status: 201, body: { contact: { id: 'c' } } }), { ghl_contact_id: 'existing-2', phone: '212-555-0100' });
  ok('C2 · verified client w/ PROVIDED fake phone → still 400 (validation intact)', r.res.statusCode === 400, `status=${r.res.statusCode}`);
}

// ── C3 / BUG-003 — 2xx with empty/invalid body must not false-fail ───────────
{
  const r = await run((i) => ({ action: 'resp', status: 201, body: null, jsonThrows: true }));
  ok('C3 · 2xx with unparseable body → SUCCESS (no false failure, no orphan)', isSuccess(r.res), `status=${r.res.statusCode}`);
  ok('C3 · 2xx with unparseable body → exactly 1 attempt (not retried as failure)', r.attempts === 1, `attempts=${r.attempts}`);
}

// ── C4 / BUG-004 — Zara voice spoken-number normalization ────────────────────
{
  const en = normalizeSpokenNumbers('seven eight seven five five five one two one two', false);
  ok('C4 · EN spoken phone → 10 digits 7875551212', en.replace(/\D/g, '') === '7875551212', JSON.stringify(en));
  const es = normalizeSpokenNumbers('siete ocho siete cinco cinco cinco uno dos uno dos', true);
  ok('C4 · ES spoken phone → 10 digits 7875551212', es.replace(/\D/g, '') === '7875551212', JSON.stringify(es));
  const zip = normalizeSpokenNumbers('one zero zero three three', false);
  ok('C4 · EN spoken ZIP → 10033', zip.replace(/\D/g, '') === '10033', JSON.stringify(zip));
  const typed = normalizeSpokenNumbers('(917) 432-1098', false);
  ok('C4 · typed input preserved (digits intact)', typed.replace(/\D/g, '') === '9174321098', JSON.stringify(typed));
}

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

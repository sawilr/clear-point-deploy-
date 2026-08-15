// SECURITY REGRESSION SUITE — /api/submit-lead (2026-08-15 remediation).
//
// Covers:
//   A. _lib/read-body.js unit tests (malformed JSON, oversize, stall, stream).
//   B. Origin / method / consent / honeypot / min-fill / validation matrix
//      against the REAL handler via scripts/dev-lead-server.mjs.
//   C. Turnstile server verification in every mode (off / enforce-pass /
//      enforce-fail / enforce-token-spent / missing-token / shadow) using
//      Cloudflare's PUBLIC documented dummy secrets (no real keys involved).
//   D. Rate limiting (per-phone tier and strict per-IP tier).
//   E. [LEAD-AUDIT] observability lines (target 4) asserted from server logs.
//
// SAFE BY CONSTRUCTION: the harness forces a dummy CRM token (GHL answers 401
// → sanitized 502; nothing is ever written) and strips LLM keys.
//
// Run: node scripts/test-submit-lead-security-2026-08-15.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EventEmitter } from 'node:events';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = join(root, 'scripts', 'dev-lead-server.mjs');

// Cloudflare's PUBLIC documented Turnstile testing secrets (docs → Turnstile →
// Testing). These are not credentials; they exist precisely for this purpose.
const TS_SECRET_PASS = '1x0000000000000000000000000000000AA';
const TS_SECRET_FAIL = '2x0000000000000000000000000000000AA';
const TS_SECRET_SPENT = '3x0000000000000000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const GOOD_ORIGIN = 'http://localhost:5173';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + ' — ' + detail); console.log('  FAIL  ' + name + ' — ' + detail); }
}

function validLead(overrides) {
  return Object.assign({
    first_name: 'Qa',
    last_name: 'Harness',
    phone: '6462013344',
    zip: '10468',
    preferred_language: 'en',
    consent_to_contact: true,
    lead_source: 'qa-harness',
    elapsed_ms: 60000,
  }, overrides || {});
}

async function httpReq(port, { method = 'POST', origin = GOOD_ORIGIN, body, rawBody, headers = {} } = {}) {
  const h = { ...headers };
  if (origin !== null) h['Origin'] = origin;
  let payload;
  if (rawBody !== undefined) { payload = rawBody; h['Content-Type'] = h['Content-Type'] || 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const t0 = Date.now();
  const resp = await fetch(`http://localhost:${port}/api/submit-lead`, {
    method, headers: h, body: payload,
    signal: AbortSignal.timeout(20000),
  });
  const ms = Date.now() - t0;
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: resp.status, json, text, ms, headers: resp.headers };
}

function startServer(env, port) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const proc = spawn(process.execPath, [HARNESS], {
      env: {
        ...process.env,
        // The machine's shell env may carry REAL credentials (it does — the
        // harness interlock caught a real HIGHLEVEL_TOKEN on 2026-08-15 and
        // refused to start, which is exactly its job). Force dummies so the
        // suite can never touch the production CRM regardless of shell state.
        HIGHLEVEL_TOKEN: 'local-dummy-token',
        HIGHLEVEL_LOCATION_ID: 'local-dummy-location',
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
        PORT: String(port),
        ...env,
      },
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onLine = (buf) => {
      const s = buf.toString('utf8');
      logs.push(s);
      if (s.includes('serving REAL api/submit-lead.js')) resolve({ proc, logs, port });
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', (b) => logs.push(b.toString('utf8')));
    proc.on('exit', (code) => reject(new Error('harness exited early code=' + code + '\n' + logs.join(''))));
    setTimeout(() => reject(new Error('harness start timeout\n' + logs.join(''))), 15000);
  });
}
function stopServer(s) { try { s.proc.kill(); } catch { /* gone */ } }
const hasAudit = (s, outcome) => s.logs.join('').includes('"outcome":"' + outcome + '"');

// ───────────────────────────────────────────────────────────────────────────
// A. read-body.js unit tests
// ───────────────────────────────────────────────────────────────────────────
async function unitReadBody() {
  console.log('\n[A] _lib/read-body.js unit tests');
  const { readJsonBody } = await import('../api/_lib/read-body.js');
  function mockRes() {
    const r = { statusCode: 0, body: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (o) => { r.body = o; return r; };
    return r;
  }

  // U1 — platform parser threw (malformed JSON), stream consumed → fast 400.
  {
    const req = { get body() { throw new SyntaxError('Unexpected token'); }, readableEnded: true, complete: true, on() {} };
    const res = mockRes();
    const t0 = Date.now();
    const out = await readJsonBody(req, res, {});
    const ms = Date.now() - t0;
    check('U1 malformed-JSON getter → 400 fast', out === null && res.statusCode === 400 && ms < 100, `out=${out} status=${res.statusCode} ms=${ms}`);
  }
  // U2 — raw string body, malformed → 400.
  {
    const req = { body: '{"bad json', on() {} };
    const res = mockRes();
    const out = await readJsonBody(req, res, {});
    check('U2 malformed string body → 400', out === null && res.statusCode === 400, `status=${res.statusCode}`);
  }
  // U3 — parsed object passes through untouched.
  {
    const req = { body: { a: 1 }, on() {} };
    const res = mockRes();
    const out = await readJsonBody(req, res, {});
    check('U3 parsed object passthrough', out && out.a === 1, JSON.stringify(out));
  }
  // U4 — no parser ran; stream valid JSON → parsed.
  {
    const req = new EventEmitter();
    req.readableEnded = false; req.complete = false; req.destroy = () => {};
    const res = mockRes();
    const p = readJsonBody(req, res, {});
    process.nextTick(() => { req.emit('data', Buffer.from('{"x":"y"}')); req.emit('end'); });
    const out = await p;
    check('U4 streamed valid JSON parsed', out && out.x === 'y', JSON.stringify(out));
  }
  // U5 — streamed body over cap → 413.
  {
    const req = new EventEmitter();
    req.readableEnded = false; req.complete = false; req.destroy = () => {};
    const res = mockRes();
    const p = readJsonBody(req, res, { maxBytes: 100 });
    process.nextTick(() => { req.emit('data', Buffer.alloc(200, 65)); });
    const out = await p;
    check('U5 streamed oversize → 413', out === null && res.statusCode === 413, `status=${res.statusCode}`);
  }
  // U6 — stream that NEVER ends → bounded timeout, 400, no hang.
  {
    const req = new EventEmitter();
    req.readableEnded = false; req.complete = false; req.destroy = () => {};
    const res = mockRes();
    const t0 = Date.now();
    const out = await readJsonBody(req, res, { timeoutMs: 300 });
    const ms = Date.now() - t0;
    check('U6 stalled stream → 400 within timeout', out === null && res.statusCode === 400 && ms >= 250 && ms < 2000, `status=${res.statusCode} ms=${ms}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// B. Core matrix (turnstile off)
// ───────────────────────────────────────────────────────────────────────────
async function coreMatrix() {
  console.log('\n[B] Core security matrix (turnstile off)');
  const s = await startServer({ TURNSTILE_SECRET: '', TURNSTILE_MODE: '' }, 3101);
  try {
    let r = await httpReq(3101, { method: 'GET', origin: null });
    check('B1 GET no Origin → 403', r.status === 403, `status=${r.status}`);
    r = await httpReq(3101, { method: 'GET' });
    check('B2 GET good Origin → 405 + RL headers', r.status === 405 && r.headers.get('x-ratelimit-policy') === '5;w=3600, 10;w=86400', `status=${r.status} policy=${r.headers.get('x-ratelimit-policy')}`);
    r = await httpReq(3101, { method: 'OPTIONS' });
    check('B3 OPTIONS → 204', r.status === 204, `status=${r.status}`);
    r = await httpReq(3101, { origin: 'https://evil.example.com', body: validLead() });
    check('B4 evil Origin POST → 403', r.status === 403, `status=${r.status}`);
    r = await httpReq(3101, { rawBody: '{"broken json' });
    check('B5 malformed JSON → fast 400 (was: HANG)', r.status === 400 && r.ms < 2000, `status=${r.status} ms=${r.ms}`);
    r = await httpReq(3101, { body: {} });
    check('B6 no consent → 400 CONSENT_REQUIRED', r.status === 400 && r.json && r.json.error === 'CONSENT_REQUIRED', `status=${r.status} err=${r.json && r.json.error}`);
    r = await httpReq(3101, { body: validLead({ consent_to_contact: 'true' }) });
    check('B7 consent as string "true" → 400', r.status === 400 && r.json && r.json.error === 'CONSENT_REQUIRED', `status=${r.status}`);
    r = await httpReq(3101, { body: validLead({ website_url: 'http://spam.example' }) });
    check('B8 honeypot → benign 200, no contact', r.status === 200 && r.json && r.json.message === 'Received' && !r.json.contact_id, `status=${r.status} body=${r.text}`);
    r = await httpReq(3101, { body: validLead({ elapsed_ms: 500 }) });
    check('B9 min-fill-time 500ms → benign 200', r.status === 200 && r.json && r.json.message === 'Received', `status=${r.status} body=${r.text}`);
    r = await httpReq(3101, { body: validLead({ first_name: '<script>x</script>' }) });
    check('B10 markup name → 400', r.status === 400, `status=${r.status}`);
    r = await httpReq(3101, { body: validLead({ phone: '2125550100' }) });
    check('B11 hollywood 555 phone → 400', r.status === 400, `status=${r.status}`);
    r = await httpReq(3101, { body: validLead({ phone: '' , first_name: ''}) });
    check('B12 missing required → 400', r.status === 400, `status=${r.status}`);
    r = await httpReq(3101, { body: validLead({ lead_notes: 'A'.repeat(100 * 1024) }) });
    check('B13 100KB notes handled gracefully (capped, no 5xx crash)', r.status === 502 || r.status === 200, `status=${r.status} body=${r.text.slice(0, 120)}`);
    r = await httpReq(3101, { body: validLead({ phone: '7182013344' }) });
    check('B14 valid lead + dummy CRM → sanitized 502, no internals', r.status === 502 && r.json && r.json.error === 'CRM_UNAVAILABLE' && !/stack|leadconnector|bearer|token/i.test(r.text), `status=${r.status} body=${r.text.slice(0, 160)}`);
    r = await httpReq(3101, { body: validLead({ phone: '9172013344', turnstile_token: DUMMY_TOKEN }) });
    check('B15 token sent while mode off → ignored, proceeds', r.status === 502, `status=${r.status}`);
    // F1 (red-team authorization gap): a client-supplied ghl_contact_id must be
    // IGNORED — it must NOT relax the name+phone requirement, and it must NOT
    // send the request down a privileged PUT-by-id path.
    r = await httpReq(3101, { body: { consent_to_contact: true, ghl_contact_id: 'abc123victimcontactid', first_name: '', phone: '', elapsed_ms: 60000 } });
    check('F1a client ghl_contact_id no longer relaxes required fields → 400', r.status === 400 && r.json && /required/i.test(r.json.error || ''), `status=${r.status} err=${r.json && r.json.error}`);
    r = await httpReq(3101, { body: validLead({ phone: '3472013344', ghl_contact_id: 'abc123victimcontactid', ghl_assigned_user_id: 'attacker-owner' }) });
    check('F1b client ghl_contact_id ignored → normal create path (502 dummy CRM), not a PUT to victim', r.status === 502, `status=${r.status} body=${r.text.slice(0,120)}`);
    check('F1c audit: client_contact_id_ignored logged', hasAudit(s, 'client_contact_id_ignored'), 'missing');
    // Observability (target 4)
    check('B16 audit: origin_rejected logged', hasAudit(s, 'origin_rejected'), 'missing');
    check('B17 audit: consent_rejected logged', hasAudit(s, 'consent_rejected'), 'missing');
    check('B18 audit: honeypot_discarded logged', hasAudit(s, 'honeypot_discarded'), 'missing');
    check('B19 audit: minfill_discarded logged', hasAudit(s, 'minfill_discarded'), 'missing');
    check('B20 audit: validation_rejected logged', hasAudit(s, 'validation_rejected'), 'missing');
    check('B21 audit: crm_unavailable logged', hasAudit(s, 'crm_unavailable'), 'missing');
    check('B22 audit: body_rejected logged', hasAudit(s, 'body_rejected'), 'missing');
    const all = s.logs.join('');
    check('B23 logs contain no PII (name/phone/zip never logged)', !all.includes('6462013344') && !all.includes('Harness') && !all.includes('10468'), 'PII found in logs');
  } finally { stopServer(s); }
}

// ───────────────────────────────────────────────────────────────────────────
// C. Turnstile modes (uses Cloudflare's public dummy secrets — network needed)
// ───────────────────────────────────────────────────────────────────────────
async function turnstileMatrix() {
  console.log('\n[C] Turnstile verification matrix');
  // C1 enforce + always-pass secret
  let s = await startServer({ TURNSTILE_SECRET: TS_SECRET_PASS }, 3102);
  try {
    let r = await httpReq(3102, { body: validLead({ turnstile_token: DUMMY_TOKEN }) });
    check('C1 enforce+pass secret + token → proceeds (502 dummy CRM)', r.status === 502, `status=${r.status} body=${r.text.slice(0, 120)}`);
    r = await httpReq(3102, { body: validLead({ phone: '7182013344' }) });
    check('C2 enforce + MISSING token → 403 CHALLENGE_FAILED', r.status === 403 && r.json && r.json.error === 'CHALLENGE_FAILED', `status=${r.status} body=${r.text.slice(0, 120)}`);
    check('C3 challenge failure message includes phone fallback', r.json && /1-855-720-8555/.test(r.json.message || ''), r.text.slice(0, 160));
    check('C4 audit: challenge_rejected logged', hasAudit(s, 'challenge_rejected'), 'missing');
    const all = s.logs.join('');
    check('C5 secret never logged', !all.includes(TS_SECRET_PASS), 'secret leaked into logs');
  } finally { stopServer(s); }
  // C6 enforce + always-fail secret
  s = await startServer({ TURNSTILE_SECRET: TS_SECRET_FAIL }, 3103);
  try {
    const r = await httpReq(3103, { body: validLead({ turnstile_token: DUMMY_TOKEN }) });
    check('C6 enforce+fail secret + token → 403 (fail closed)', r.status === 403 && r.json && r.json.error === 'CHALLENGE_FAILED', `status=${r.status}`);
  } finally { stopServer(s); }
  // C7 enforce + token-already-spent secret (reuse attack)
  s = await startServer({ TURNSTILE_SECRET: TS_SECRET_SPENT }, 3104);
  try {
    const r = await httpReq(3104, { body: validLead({ turnstile_token: DUMMY_TOKEN }) });
    check('C7 reused/spent token → 403', r.status === 403, `status=${r.status}`);
  } finally { stopServer(s); }
  // C8 shadow mode + failing secret → logs but never blocks
  s = await startServer({ TURNSTILE_SECRET: TS_SECRET_FAIL, TURNSTILE_MODE: 'shadow' }, 3105);
  try {
    const r = await httpReq(3105, { body: validLead({ turnstile_token: DUMMY_TOKEN }) });
    check('C8 shadow mode never blocks (502 dummy CRM)', r.status === 502, `status=${r.status}`);
    check('C9 shadow failure logged', s.logs.join('').includes('Turnstile verification failed (shadow)'), 'missing shadow log');
  } finally { stopServer(s); }
}

// ───────────────────────────────────────────────────────────────────────────
// D. Rate limiting tiers
// ───────────────────────────────────────────────────────────────────────────
async function rateLimitMatrix() {
  console.log('\n[D] Rate limiting (per-instance memory store — local)');
  const s = await startServer({ TURNSTILE_SECRET: '' }, 3106);
  try {
    // Same phone 4× → per-phone tier (3/h) rejects the 4th.
    let last;
    for (let i = 0; i < 4; i++) last = await httpReq(3106, { body: validLead() });
    check('D1 4th same-phone submission → 429 (per-phone 3/h)', last.status === 429 && last.headers.get('retry-after') !== null, `status=${last.status} retry-after=${last.headers.get('retry-after')}`);
    // Distinct phones: strict per-IP tier (5/h) rejects the 6th well-formed one.
    const phones = ['7182013344', '9172013344', '3472013344', '2122013344', '5162013344'];
    const results = [];
    for (const p of phones) results.push(await httpReq(3106, { body: validLead({ phone: p }) }));
    const strictHit = results[results.length - 1];
    check('D2 6th well-formed submission → 429 (strict per-IP 5/h)', strictHit.status === 429, `status=${strictHit.status}`);
    check('D3 audit: rate_limited logged with tier', hasAudit(s, 'rate_limited'), 'missing');
  } finally { stopServer(s); }
}

// ───────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('SECURITY REGRESSION SUITE — /api/submit-lead — ' + new Date().toISOString());
  await unitReadBody();
  await coreMatrix();
  await turnstileMatrix();
  await rateLimitMatrix();
  console.log('\n═══════════════════════════════════════');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log('  • ' + f)); }
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('SUITE ERROR:', e); process.exit(2); });

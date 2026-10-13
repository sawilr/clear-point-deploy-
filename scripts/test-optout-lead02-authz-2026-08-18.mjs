// AUTHZ REGRESSION SUITE — OPTOUT-01 + LEAD-02 (2026-08-18)
//
// Drives the REAL handlers (api/opt-out.js, api/submit-lead.js) with a mocked
// GoHighLevel (global fetch intercepts services.leadconnectorhq.com). No real
// CRM, no network, deterministic. Proves:
//
//   OPTOUT-01 — the opt-out endpoint is not a membership-enumeration oracle:
//     a KNOWN phone/email and an UNKNOWN one return BYTE-IDENTICAL body+status,
//     while suppression (DND PUT) still happens server-side for the known one.
//
//   LEAD-02 — a lead submission that matches an EXISTING contact by phone does
//     NOT overwrite that third party's identity or consent (no PUT to
//     /contacts/{id}); the repeat inquiry is still captured (note + opportunity),
//     and a genuinely NEW lead still creates a contact with its own consent.
//
// Run: node scripts/test-optout-lead02-authz-2026-08-18.mjs
import { pathToFileURL } from 'node:url';

// ── Env: local-dev origin allowed, dummy CRM creds, no LLM, turnstile off ─────
process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
process.env.HIGHLEVEL_LOCATION_ID = 'loc_test';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.TURNSTILE_SECRET;
delete process.env.VERCEL; delete process.env.VERCEL_ENV; // → isLocalDev, localhost origin ok

const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
let pass = 0; const fails = [];
const check = (id, cond, why) => { if (cond) { pass++; console.log('  PASS  ' + id); } else { fails.push(id + ' — ' + why); console.log('  FAIL  ' + id + ' — ' + why); } };

// ── Mock GHL ─────────────────────────────────────────────────────────────────
// KNOWN contacts (the "victim" already in the CRM). Everything else is unknown.
const KNOWN = {
  '7182013344': { id: 'ctc_victim_1', phone: '+17182013344', email: 'victim@example.com', firstName: 'Real', lastName: 'Victim', tags: [] },
};
let ghlLog = [];
function resetLog() { ghlLog = []; }
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, opts) {
  const u = String(url);
  const method = (opts && opts.method) || 'GET';
  if (!u.includes('leadconnectorhq.com')) {
    // Only GHL is mocked; anything else (shouldn't happen in these tests) fails loud.
    throw new Error('unexpected non-GHL fetch in test: ' + u);
  }
  let body = {};
  try { body = opts && opts.body ? JSON.parse(opts.body) : {}; } catch { body = {}; }
  ghlLog.push({ url: u, method, body });
  const json = (status, obj) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj), json: async () => obj });

  // Contact search
  if (/\/contacts\/\?/.test(u) && method === 'GET') {
    const m = u.match(/query=([^&]+)/); const q = m ? decodeURIComponent(m[1]) : '';
    const digits = q.replace(/\D/g, '').slice(-10);
    const hit = KNOWN[digits];
    return json(200, { contacts: hit ? [hit] : [] });
  }
  // Opportunity search → none
  if (/\/opportunities\/search/.test(u)) return json(200, { opportunities: [] });
  // Create contact — 400 duplicate if phone known, else 201
  if (/\/contacts\/$/.test(u) && method === 'POST') {
    const digits = String(body.phone || '').replace(/\D/g, '').slice(-10);
    if (KNOWN[digits]) return json(400, { message: 'This location does not allow duplicated contacts. duplicate' });
    return json(201, { contact: { id: 'ctc_new_' + digits } });
  }
  // PUT contact (identity/consent overwrite) — RECORDED so we can assert it never happens on the existing-contact lead path
  if (/\/contacts\/[^/]+$/.test(u) && method === 'PUT') return json(200, { contact: { id: u.split('/').pop() } });
  // Notes
  if (/\/contacts\/[^/]+\/notes$/.test(u) && method === 'POST') return json(201, { id: 'note_1' });
  // Opportunities create
  if (/\/opportunities\/$/.test(u) && method === 'POST') return json(201, { id: 'opp_1' });
  return json(200, {});
};

// ── req/res mocks (faithful Vercel shape: req.body getter throws on bad JSON) ──
function mkReq({ method = 'POST', body, ip = '9.9.9.9', origin = 'http://localhost:5173' }) {
  return {
    method,
    headers: { origin, 'content-type': 'application/json', 'x-real-ip': ip, 'user-agent': 'test', 'accept-language': 'en' },
    readableEnded: true, complete: true, on() {},
    get body() { return body; },
  };
}
function mkRes() {
  const r = { statusCode: 200, headers: {}, body: undefined, ended: false };
  r.status = (c) => { r.statusCode = c; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  r.json = (o) => { r.body = o; r.ended = true; return r; };
  r.end = (d) => { r.body = d; r.ended = true; return r; };
  return r;
}

const optOut = (await import(pathToFileURL('./api/opt-out.js').href)).default;
const submitLead = (await import(pathToFileURL('./api/submit-lead.js').href)).default;

console.log('AUTHZ REGRESSION — OPTOUT-01 + LEAD-02 — ' + new Date().toISOString());

// ══ OPTOUT-01 ════════════════════════════════════════════════════════════════
console.log('\n[OPTOUT-01] enumeration oracle');
async function optoutCall(phone, ip) {
  resetLog();
  const res = mkRes();
  await optOut(mkReq({ body: { phone, evidence: 'chat_optout', channels: { email: 'BLOCKED' } }, ip }), res);
  return { res, log: ghlLog.slice() };
}
const known = await optoutCall('718-201-3344', '1.1.1.1');   // victim IS in CRM
const unknown = await optoutCall('202-555-0143', '1.1.1.2'); // NOT in CRM (but valid-format)
check('O1 known & unknown return identical STATUS', known.res.statusCode === unknown.res.statusCode, `known=${known.res.statusCode} unknown=${unknown.res.statusCode}`);
check('O2 known & unknown return BYTE-IDENTICAL body (no oracle)', JSON.stringify(known.res.body) === JSON.stringify(unknown.res.body), `known=${JSON.stringify(known.res.body)} unknown=${JSON.stringify(unknown.res.body)}`);
check('O3 body carries no membership signal (no crmApplied/reason/no_match)', !/crmApplied|reason|no_match|suppressed/.test(JSON.stringify(known.res.body)), JSON.stringify(known.res.body));
check('O4 suppression STILL applied for known contact (DND PUT sent)', known.log.some((c) => c.method === 'PUT' && c.body && c.body.dnd === true), 'no DND PUT for known contact');
check('O5 no PUT/mutation attempted for unknown contact', !unknown.log.some((c) => c.method === 'PUT'), 'unexpected mutation for unknown');
check('O6 opt-out only SUPPRESSES (never sets consent TRUE / reverses DND)', !known.log.some((c) => c.method === 'PUT' && /consent_[a-z]+"[^}]*"value":"true"/.test(JSON.stringify(c.body)) || (c.body && c.body.dnd === false)), 'opt-out wrote consent or dnd:false');
// AUDIT 2026-10-04 (CRM-29) — the four ids now come from the registry in
// api/_lib/cy2027/crm-fields.js. This pins the WIRE bytes of the suppression
// PUT (ids, keys, values, order, property order) so a mistyped registry entry
// fails here, at handler level, not in a source grep. No CY2027 ids are
// configured in this harness, so the callback-consent fields are not present.
const _revokePut = (known.log.find((c) => c.method === 'PUT') || {}).body || {};
check('O7 revocation PUT carries exactly the four consent fields, production ids unchanged (CRM-29)',
  JSON.stringify(_revokePut.customFields) === '[{"id":"vPKlhpz6aucJK1U3fJRZ","key":"contact.consent_marketing","value":"false"},' +
    '{"id":"w1hopBfNLGauFRRzQ71l","key":"contact.consent_sms","value":"false"},' +
    '{"id":"mHdpDjBSA76lQJrKoixL","key":"contact.consent_calls","value":"false"},' +
    '{"id":"ykiTUcsu3nvawK39hmll","key":"contact.consent_email","value":"false"}]',
  JSON.stringify(_revokePut.customFields));

// ══ LEAD-02 ══════════════════════════════════════════════════════════════════
console.log('\n[LEAD-02] phone-upsert third-party overwrite');
function leadBody(over) {
  return Object.assign({
    first_name: 'Attacker', last_name: 'Name', phone: '7182013344', email: 'attacker@evil.example',
    zip: '10468', preferred_language: 'en', consent_to_contact: true, lead_source: 'qa', elapsed_ms: 60000,
    date_of_birth: '1950-01-01',
    // Realistic bot submission carries a conversation summary → note path runs.
    lead_notes: 'Caller asked about Part D drug costs and wants a callback.',
  }, over || {});
}
// T-existing: submit with the VICTIM's phone + attacker identity + consent=true
resetLog();
let res = mkRes();
await submitLead(mkReq({ body: leadBody(), ip: '2.2.2.1' }), res);
const putOnExisting = ghlLog.filter((c) => c.method === 'PUT' && /\/contacts\/[^/]+$/.test(c.url));
const noteOnExisting = ghlLog.filter((c) => /\/notes$/.test(c.url) && c.method === 'POST');
const oppOnExisting = ghlLog.filter((c) => /\/opportunities\/$/.test(c.url) && c.method === 'POST');
check('L1 existing-contact submit → NO identity/consent PUT (LEAD-02 closed)', putOnExisting.length === 0, `saw ${putOnExisting.length} PUT(s): ${JSON.stringify(putOnExisting.map((p) => p.url))}`);
check('L2 no PUT body ever carried victim consent flags set TRUE', !ghlLog.some((c) => c.method === 'PUT' && /consent_marketing"[^}]*"value":"true"/.test(JSON.stringify(c.body || {}))), 'a PUT carried consent=true fields');
check('L3 repeat inquiry STILL captured (note created on existing contact)', noteOnExisting.length >= 1, 'no note recorded — lead would be lost');
check('L4 repeat inquiry creates opportunity (advisor follow-up preserved)', oppOnExisting.length >= 1, 'no opportunity created');
check('L5 caller gets success (lead not dropped)', res.statusCode === 200 && res.body && res.body.success === true, `status=${res.statusCode} body=${JSON.stringify(res.body)}`);
check('L6 note flags it as a REPEAT REQUEST for the advisor', noteOnExisting.some((n) => /REPEAT REQUEST/i.test(JSON.stringify(n.body || {}))), 'note not flagged repeat');

// T-new: a genuinely NEW phone must still create a contact WITH its own consent
resetLog();
res = mkRes();
await submitLead(mkReq({ body: leadBody({ phone: '6462013344', email: 'new@example.com', first_name: 'New', last_name: 'Lead' }), ip: '2.2.2.2' }), res);
const postCreate = ghlLog.filter((c) => /\/contacts\/$/.test(c.url) && c.method === 'POST');
check('L7 NEW phone still creates a contact (revenue path intact)', postCreate.length >= 1, 'no POST create for new lead');
check('L8 new contact carries its OWN consent (established by the person)', postCreate.some((c) => JSON.stringify(c.body || {}).includes('consent_marketing')), 'new create missing consent customFields');
check('L9 new lead succeeds', res.statusCode === 200 && res.body && res.body.success === true, `status=${res.statusCode}`);
// AUDIT 2026-10-04 (CRM-29) — the create body is written under the production
// ids from the registry, in the { id, key, value } shape the CRM has always
// received. calculated_age is not pinned (it depends on today's date) and the
// summary is pinned by its prefix only (the handler appends the TCPA receipt).
const _newCf = (postCreate[0] && postCreate[0].body && postCreate[0].body.customFields) || [];
check('L10 new contact is written under the production field ids, in the { id, key, value } shape (CRM-29)',
  ['QULAmkAuVNCQrAMZ487K|contact.preferred_language|en', 'vPKlhpz6aucJK1U3fJRZ|contact.consent_marketing|true',
    'w1hopBfNLGauFRRzQ71l|contact.consent_sms|true', 'mHdpDjBSA76lQJrKoixL|contact.consent_calls|true',
    'ykiTUcsu3nvawK39hmll|contact.consent_email|true']
    .every((want) => _newCf.some((f) => [f.id, f.key, f.value].join('|') === want)) &&
  _newCf.some((f) => f.id === '6vSP5DJvAc6Jl9BXg409' && f.key === 'contact.chat_conversation_summary' &&
    String(f.value).startsWith('Caller asked about Part D drug costs and wants a callback.')) &&
  _newCf.length >= 6 && _newCf.every((f) => Object.keys(f).join(',') === 'id,key,value'),
  JSON.stringify(_newCf));

// AUDIT 2026-10-04 (CRM-29, red team) — nothing pinned which VALUE each consent
// NAME carries: L10 drives consent_to_contact=true, under which every flag reads
// 'true', so CONSENT_SMS and CONSENT_CALLS with their value expressions exchanged
// passed every suite. What is observable at the handler: the consent gate refuses
// a lead that does not carry consent_to_contact=true before any CRM call, so a
// channel-only flag never reaches the writer (L11) — and an accepted lead whose
// email is unusable records consent_email 'false' under its own id while
// marketing / sms / calls read 'true' (L12), which pins the pairing that CAN differ.
for (const [flag, label, ip] of [['consent_sms', 'sms-only', '2.2.2.3'], ['consent_calls', 'calls-only', '2.2.2.5'], ['consent_call', 'call-only (legacy name)', '2.2.2.6']]) {
  resetLog();
  res = mkRes();
  const partial = leadBody({ phone: '6462013355', email: 'partial@example.com' });
  delete partial.consent_to_contact;
  partial[flag] = true;
  await submitLead(mkReq({ body: partial, ip }), res);
  check(`L11 a ${label} consent without consent_to_contact is refused before any CRM call (400 CONSENT_REQUIRED, zero GHL requests)`,
    res.statusCode === 400 && res.body && res.body.error === 'CONSENT_REQUIRED' && ghlLog.length === 0, `status=${res.statusCode} body=${JSON.stringify(res.body)} calls=${ghlLog.length}`);
}
resetLog();
res = mkRes();
await submitLead(mkReq({ body: leadBody({ phone: '6462013366', email: 'not-an-email', first_name: 'NoMail', last_name: 'Lead' }), ip: '2.2.2.4' }), res);
const _noMailCreate = ghlLog.filter((c) => /\/contacts\/$/.test(c.url) && c.method === 'POST');
const _consentBytes = (c) => JSON.stringify((((c && c.body) || {}).customFields || []).filter((f) => /^contact\.consent_/.test(String(f.key))));
check('L12 with no usable email, consent_email is "false" under its own id while marketing/sms/calls stay "true" (name↔value pairing, CRM-29)',
  res.statusCode === 200 && _noMailCreate.length === 1 && _consentBytes(_noMailCreate[0]) ===
    '[{"id":"vPKlhpz6aucJK1U3fJRZ","key":"contact.consent_marketing","value":"true"},' +
    '{"id":"w1hopBfNLGauFRRzQ71l","key":"contact.consent_sms","value":"true"},' +
    '{"id":"mHdpDjBSA76lQJrKoixL","key":"contact.consent_calls","value":"true"},' +
    '{"id":"ykiTUcsu3nvawK39hmll","key":"contact.consent_email","value":"false"}]',
  `status=${res.statusCode} creates=${_noMailCreate.length} ${_consentBytes(_noMailCreate[0])}`);

globalThis.fetch = realFetch;
console.log('\n═══════════════════════════════════════');
console.log((fails.length === 0 ? GRN : RED)(`RESULT: ${pass} passed, ${fails.length} failed`));
if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log('  • ' + f)); }
process.exit(fails.length === 0 ? 0 : 1);

// SECURITY HOTFIX — Fix 1 tests (audit finding 01/04/05): /api/lookup-client.
// Verifies the public CRM lookup is locked down: no enumeration, no IDs, real
// 429, no-store headers. No network/GHL calls (lookup is disabled).
import handler from '../api/lookup-client.js';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

function mockRes() {
  const r = { headers: {}, statusCode: null, body: null, ended: false };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
}
const mockReq = (ip, body, headers = {}) => ({
  method: 'POST',
  headers: { origin: 'https://clearpointsenioradvisors.com', 'x-real-ip': ip, ...headers },
  body,
});

const leaks = (b) => b && (('contactId' in b) || ('assignedUserId' in b) || ('advisorName' in b) || ('found' in b) || ('phoneLast4' in b));

// 1) KNOWN-looking contact → must NOT return any IDs or existence signal.
{
  const res = mockRes();
  await handler(mockReq('203.0.113.11', { fullName: 'Maria Rojas', last4Phone: '2553' }), res);
  ok('known: status 200', res.statusCode === 200, `status=${res.statusCode}`);
  ok('known: NO CRM IDs / found / advisorName / phoneLast4 leaked', !leaks(res.body), JSON.stringify(res.body));
  ok('known: Cache-Control no-store, private', res.headers['cache-control'] === 'no-store, private', res.headers['cache-control']);
  ok('known: Pragma no-cache + Expires 0', res.headers['pragma'] === 'no-cache' && res.headers['expires'] === '0');
}

// 2) UNKNOWN contact → IDENTICAL generic response (can't distinguish existence).
let knownBody, unknownBody;
{
  const r1 = mockRes(); await handler(mockReq('203.0.113.12', { fullName: 'Zzz Nonexistent', last4Phone: '0000' }), r1);
  const r2 = mockRes(); await handler(mockReq('203.0.113.13', { fullName: 'Maria Rojas', last4Phone: '2553' }), r2);
  knownBody = JSON.stringify(r2.body); unknownBody = JSON.stringify(r1.body);
  ok('unknown == known response (no enumeration possible)', knownBody === unknownBody, `known=${knownBody} unknown=${unknownBody}`);
  ok('unknown: no leak', !leaks(r1.body));
}

// 3) Rate limit fires with a REAL 429 (not fake found:false). 10/hr → 11th = 429.
{
  const ip = '198.51.100.77';
  let last;
  for (let i = 0; i < 11; i++) { last = mockRes(); await handler(mockReq(ip, { fullName: 'Rate Tester', last4Phone: '1212' }), last); }
  ok('rate limit: 11th request returns real 429', last.statusCode === 429, `status=${last.statusCode}`);
  ok('rate limit: 429 is NOT a fake found:false', !('found' in (last.body || {})), JSON.stringify(last.body));
  ok('rate limit: 429 still no-store', last.headers['cache-control'] === 'no-store, private');
}

// 4) Bad origin → 403 (no work done).
{
  const res = mockRes();
  await handler({ method: 'POST', headers: { origin: 'https://evil.example.com' }, body: {} }, res);
  ok('bad origin → 403', res.statusCode === 403, `status=${res.statusCode}`);
}

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

// SECURITY HOTFIX — PHASE 3 (rate-limit identity spoofing, audit security HIGH).
// On Vercel, only x-vercel-forwarded-for is trustworthy. This proves a client
// cannot mint a fresh rate-limit quota by forging x-forwarded-for / x-real-ip.
import { clientId } from '../api/_lib/rate-limit.js';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };
const req = (headers) => ({ headers });

// ── ON VERCEL — only x-vercel-forwarded-for is trusted ──
process.env.VERCEL = '1';
ok('Vercel: uses x-vercel-forwarded-for',
   clientId(req({ 'x-vercel-forwarded-for': '203.0.113.7' })) === '203.0.113.7');
ok('Vercel: IGNORES spoofed x-forwarded-for (no vercel header)',
   clientId(req({ 'x-forwarded-for': '1.2.3.4' })) === 'vercel-untrusted',
   clientId(req({ 'x-forwarded-for': '1.2.3.4' })));
ok('Vercel: IGNORES spoofed x-real-ip',
   clientId(req({ 'x-real-ip': '9.9.9.9' })) === 'vercel-untrusted');
ok('Vercel: spoofed XFF cannot override the real vercel IP',
   clientId(req({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })) === '203.0.113.7');
ok('Vercel: two forged XFF values map to the SAME bucket (no fresh quota)',
   clientId(req({ 'x-forwarded-for': '1.1.1.1' })) === clientId(req({ 'x-forwarded-for': '2.2.2.2' })));

// ── OFF VERCEL (local dev / other host) — proxy headers accepted ──
delete process.env.VERCEL;
delete process.env.VERCEL_ENV;
ok('Local: uses last entry of x-forwarded-for',
   clientId(req({ 'x-forwarded-for': '5.5.5.5, 6.6.6.6' })) === '6.6.6.6');
ok('Local: uses x-real-ip when no XFF',
   clientId(req({ 'x-real-ip': '7.7.7.7' })) === '7.7.7.7');
ok('No headers → unknown', clientId(req({})) === 'unknown');

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

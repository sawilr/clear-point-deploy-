// EXTERNAL AUDIT REMEDIATION 2026-08-13 — CP-05 and CP-06.
// Companion to test-cp-findings-2026-08-13.mjs (CP-01, CP-04).
// Run: npx tsx scripts/test-cp0506-2026-08-13.mjs
import { readFileSync } from 'node:fs';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const YEL = (s) => '\x1b[33m' + s + '\x1b[0m';
let pass = 0; const fail = []; const notes = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? ' — ' + why : ''}`); };
const note = (id, m) => notes.push(`${id}: ${m}`);
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
// Assertions about what the code DOES, not what its comments say. Two assertions in
// the companion suite failed by matching comments — one nearly had me delete the
// comment forbidding a Meta Pixel, for containing the words "Meta Pixel".
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/.*$/gm, '');

const CHATBOT = read('src/components/ChatBot.tsx');
const PERSIST = read('src/lib/persistentMemory.ts');
const OPTOUT = read('src/lib/optOutGuard.ts');
const LEAD = read('api/submit-lead.js');
const RL = read('api/_lib/rate-limit.js');

// ══════════════════════════════════════════════════════════════════════════════
// CP-05 — chat memory capable of persisting PII in sessionStorage (LOW)
// ══════════════════════════════════════════════════════════════════════════════
// Scope first: the finding was broader than the reality. The identity-grade fields
// were already stripped by earlier audits, and localStorage holds no PII at all.
check('CP05-A1 phone/email/dob/raw-input stripped on WRITE',
  /phone: '', email: '', dob: '', calculatedAge: 0, lastValidUserInput: ''/.test(codeOnly(CHATBOT)));
check('CP05-A2 localStorage keeps no identifying fields',
  /lastTopic/.test(PERSIST) && !/name:\s*mem\.name/.test(codeOnly(PERSIST)));
check('CP05-A3 localStorage migrates legacy PII off disk',
  /parsed\.name !== undefined \|\| parsed\.zip !== undefined/.test(PERSIST));

// The real gap: name/zip had no staleness bound.
// EXPECTED: a TTL ages out the identifying remainder.
// NEGATIVE: must NOT drop the fields outright — that makes Zara re-ask, which is worse
//   UX and a net privacy loss, since the same PII is simply collected again.
// EDGE: a missing stamp must be treated as stale (fail-closed; also handles blobs
//   written by builds that predate this change).
check('CP05-B1 TTL constant defined', /const SESSION_PII_TTL_MS = 4 \* 3600 \* 1000/.test(CHATBOT));
check('CP05-B2 write stamps the time', /_piiStamp: Date\.now\(\)/.test(CHATBOT));
check('CP05-B3 read computes expiry',
  /piiExpired = !stamp \|\| \(Date\.now\(\) - stamp\) > SESSION_PII_TTL_MS/.test(CHATBOT));
check('CP05-B4 expiry clears name AND geography',
  /piiExpired[\s\S]{0,300}firstName: '', lastName: '', zip: ''/.test(CHATBOT));
check('CP05-B5 missing stamp treated as stale (fail-closed)',
  /typeof parsed\._piiStamp === 'number' \? parsed\._piiStamp : 0/.test(CHATBOT));
check('CP05-B6 clearing is conditional, not unconditional',
  /const identifying = piiExpired/.test(CHATBOT), 'a live conversation must keep continuity');
check('CP05-C1 opt-out revocation storage untouched (compliance control)',
  /CONTACT_PERMISSION_KEY/.test(OPTOUT));

note('CP05', 'Scoped rather than accepted wholesale. phone/email/dob/raw-input were '
  + 'already stripped (BUG 9 + 2026-07-22), and localStorage carries no PII and actively '
  + 'migrates legacy PII off disk. The real gap: firstName/lastName/zip had NO staleness '
  + 'bound, so they lived for the whole tab lifetime. Concrete harm is a shared library or '
  + 'senior-centre computer where someone walks away without closing the tab and the next '
  + 'person is greeted by the previous person’s name. Fixed with a 4h TTL rather than '
  + 'by deleting the fields, since deleting them makes Zara re-ask and re-collect the same '
  + 'PII, which is a net privacy loss.');
note('CP05-NOT-VERIFIED', 'TTL expiry has not been exercised in a browser. Exact test: '
  + 'open the widget, give a first name, then in DevTools set the stored blob _piiStamp to '
  + 'Date.now() - 5*3600*1000, reload, and confirm Zara no longer greets by name while '
  + 'still keeping language and topic.');

// ══════════════════════════════════════════════════════════════════════════════
// CP-06 — rate limit charged before validation/honeypot (LOW)
// ══════════════════════════════════════════════════════════════════════════════
// EXPECTED: a high-ceiling flood guard before the parse, and the strict business limit
//   only after honeypot + validation.
// NEGATIVE: removing the pre-parse guard would make malformed requests free, which is a
//   probing and bill-inflation amplifier — the limiter exists to stop bill inflation.
// EDGE: the published policy numbers must remain accurate.
check('CP06-A1 pre-parse tier is high-ceiling',
  /max: 40, windowMs: 60 \* 60 \* 1000, prefix: 'lead-flood-h'/.test(LEAD));
check('CP06-A2 a pre-parse guard still exists',
  LEAD.indexOf("'lead-flood-h'") < LEAD.indexOf('Honeypot triggered'),
  'malformed requests must not be free');
check('CP06-B1 strict tier exists',
  /max: 5, windowMs: 60 \* 60 \* 1000, prefix: 'lead-ok-h'/.test(LEAD));
check('CP06-B2 strict tier runs AFTER the honeypot',
  LEAD.indexOf('Honeypot triggered') < LEAD.indexOf("'lead-ok-h'"),
  'a bot must not consume the human quota');
check('CP06-B3 strict tier runs AFTER phone validation',
  LEAD.indexOf('Phone rejected') < LEAD.indexOf("'lead-ok-h'"),
  'a typo must not consume the quota — this IS the finding');
check('CP06-B4 strict tier runs AFTER the min-fill-time bot gate',
  LEAD.indexOf('Min-fill-time gate triggered') < LEAD.indexOf("'lead-ok-h'"));
check('CP06-B5 daily strict tier present',
  /max: 10, windowMs: 24 \* 60 \* 60 \* 1000, prefix: 'lead-ok-d'/.test(LEAD));
check('CP06-C1 published policy still advertises 5;w=3600, 10;w=86400',
  /X-RateLimit-Policy', '5;w=3600, 10;w=86400'/.test(LEAD),
  'the advertised numbers describe the strict tier, so they remain true');
check('CP06-C2 per-phone identity limits preserved',
  /prefix: 'lead-ph'/.test(LEAD) && /prefix: 'lead-pz'/.test(LEAD));
check('CP06-D1 storage tier is introspectable', /export function rateLimitStorageTier/.test(RL));
check('CP06-D2 introspection never leaks the token',
  /hasToken: !!KV_TOKEN/.test(RL) && !/token: KV_TOKEN/.test(codeOnly(RL)));
check('CP06-D3 cold-start alert when KV missing on Vercel', /KV_NOT_CONFIGURED on Vercel/.test(RL));

note('CP06-CONFIRMED-WORSE-THAN-REPORTED', 'VERIFIED with `vercel env ls production`: '
  + 'production holds exactly ANTHROPIC_API_KEY, HIGHLEVEL_LOCATION_ID and '
  + 'HIGHLEVEL_TOKEN — and NONE of the KV/Upstash variables. KV_AVAILABLE is therefore '
  + 'false and every limit in the module is per-instance. Vercel serves concurrent '
  + 'requests from separate function instances, each with its own in-memory Map, and a '
  + 'cold start begins at zero, so the effective ceiling is (limit x live instances), '
  + 'which a caller controls simply by sending requests in parallel. The published '
  + '"5 per hour, 10 per day" describes intent, not enforced behavior. The ordering fix '
  + 'above is correct and helps a real user immediately, but NO per-IP limit is genuinely '
  + 'enforced until a shared store exists. BLOCKED - EXTERNAL ACTION REQUIRED: provision '
  + 'a Vercel KV / Upstash Redis store and set KV_REST_API_URL + KV_REST_API_TOKEN '
  + '(billing implications, owner action). This is the most consequential finding of this '
  + 'remediation pass, and it appears in neither audit report as such — the second audit '
  + 'asked for it to be confirmed; it is now confirmed NEGATIVE.');

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\nCP-05 + CP-06: ${pass}/${pass + fail.length} assertions passed`);
if (notes.length) {
  console.log(YEL(`\n${notes.length} SCOPE / NOT-VERIFIED NOTES:`));
  for (const n of notes) console.log('  • ' + n);
}
if (fail.length) {
  console.error(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}
console.log(GRN('\n✓ CP-05 TTL and CP-06 two-tier ordering hold; the KV gap is declared above'));

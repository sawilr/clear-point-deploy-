// EXTERNAL AUDIT REMEDIATION 2026-08-13 — CP-01 and CP-04.
//
// LOOP E per the remediation protocol: a successful build is NOT evidence. Each case
// below states the expected behavior, the negative behavior, an edge case, and the
// failure behavior, and asserts on what the code actually does.
//
// These are static assertions against source rather than runtime tests, and that is a
// deliberate, stated limitation: the behaviors are client-side React states and a
// browser-absent Node process cannot exercise them. Where a claim needs a browser or
// production to prove, this file says so instead of implying coverage it does not have.
// The live probes that DO exercise production are recorded in the remediation report.
//
// Run: npx tsx scripts/test-cp-findings-2026-08-13.mjs
import { readFileSync } from 'node:fs';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const YEL = (s) => '\x1b[33m' + s + '\x1b[0m';
let pass = 0; const fail = []; const notes = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? ' — ' + why : ''}`); };
const note = (id, m) => notes.push(`${id}: ${m}`);

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Comment-stripped view, for assertions about what the code DOES rather than what it
// says. Two assertions in the first run of this file failed against comments: the
// phrase "soa_pending:true" inside a comment explaining the fix, and "Meta Pixel"
// inside the comment PROHIBITING a Meta Pixel. Both were my test being wrong, not the
// code — and the second is the instructive one, because a naive grep would have had me
// delete a guardrail for containing the name of the thing it forbids. Same mistake
// caught earlier in the kill-switch suite; hence a shared helper this time.
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
  .replace(/^\s*\/\/.*$/gm, '')        // whole-line // comments
  .replace(/\s\/\/.*$/gm, '');         // trailing // comments

const SOA_TOKEN = read('api/soa-token.js');
const SOA_STATUS = read('api/soa-status.js');
const SIGN_SOA = read('api/sign-soa.js');
const SOA_CONTENT = read('src/lib/soaContent.ts');
const SMART = read('src/components/SmartMedicareReview.tsx');
const SIGN_PAGE = read('src/pages/SignSOA.tsx');
const ENGINE = read('src/lib/customerServiceEngine.ts');
const CSB = read('src/components/CustomerServiceBot.tsx');
const ANALYTICS = read('src/lib/analytics.ts');

// ══════════════════════════════════════════════════════════════════════════════
// CP-01 — SOA production flow disabled (MEDIUM)
//
// The endpoint returning 503 is CORRECT and must not be "fixed": SOA_ENABLED is
// false because five preconditions are unmet, chief among them FMO-confirmed
// organization/product counts that nobody has supplied. Issuing a signable SOA with
// [X]/[Y] placeholders in mandatory CMS language would be the actual violation.
// What was wrong is everything AROUND that refusal.
// ══════════════════════════════════════════════════════════════════════════════

// ── The refusal itself must remain, and must be fail-CLOSED ──────────────────
// EXPECTED: every SOA endpoint refuses while the flag is false.
// FAILURE BEHAVIOR: a missing gate would let a placeholder SOA be signed.
check('CP01-A1 soa-token gated', /const SOA_ENABLED = false/.test(SOA_TOKEN) && /if \(!SOA_ENABLED\)/.test(SOA_TOKEN));
check('CP01-A2 soa-token returns 503 SOA_NOT_CONFIGURED',
  /status\(503\)[\s\S]{0,120}SOA_NOT_CONFIGURED/.test(SOA_TOKEN));
check('CP01-A3 soa-status gated', /const SOA_ENABLED = false/.test(SOA_STATUS) && /if \(!SOA_ENABLED\) return res\.status\(503\)/.test(SOA_STATUS));
check('CP01-A4 sign-soa gated', /const SOA_ENABLED = false/.test(SIGN_SOA) && /if \(!SOA_ENABLED\)/.test(SIGN_SOA));
// The gate must precede any storage or PDF work — refusing after doing the work is
// not refusing.
check('CP01-A5 soa-token gate precedes token issuance',
  SOA_TOKEN.indexOf('if (!SOA_ENABLED)') < SOA_TOKEN.indexOf('crypto.randomUUID()'),
  'the gate must run before a token is minted');
check('CP01-A6 soa-token gate precedes rate-limit burn',
  SOA_TOKEN.indexOf('if (!SOA_ENABLED)') < SOA_TOKEN.indexOf('rateLimit('),
  'a disabled endpoint must not consume the caller quota');

// ── DRIFT DETECTION — the highest-value assertion in this file ───────────────
// SOA_ENABLED is duplicated across four files because serverless functions cannot
// import from src/. That duplication is the real long-term hazard: flipping one and
// forgetting another yields a half-enabled workflow that issues tokens nobody can
// sign, or accepts signatures for tokens that were never issued. This catches it.
const flagStates = {
  'src/lib/soaContent.ts': /export const SOA_ENABLED = (true|false)/.exec(SOA_CONTENT)?.[1],
  'api/soa-token.js': /const SOA_ENABLED = (true|false)/.exec(SOA_TOKEN)?.[1],
  'api/soa-status.js': /const SOA_ENABLED = (true|false)/.exec(SOA_STATUS)?.[1],
  'api/sign-soa.js': /const SOA_ENABLED = (true|false)/.exec(SIGN_SOA)?.[1],
};
const distinct = new Set(Object.values(flagStates));
check('CP01-B1 all four SOA_ENABLED mirrors agree', distinct.size === 1,
  'DRIFT: ' + JSON.stringify(flagStates));
check('CP01-B2 every mirror was actually found', !Object.values(flagStates).includes(undefined),
  JSON.stringify(flagStates));

// ── No PII may be sent to an endpoint known to refuse it ────────────────────
// EXPECTED: the token request is gated on the same flag the server uses.
// NEGATIVE: the gate must NOT be a hardcoded false — it has to revert cleanly when
//           the flag flips, or the fix becomes a permanent regression.
// EDGE: the qualified-sales-route condition must survive, so enabling SOA does not
//       start requesting tokens for special-situation education leads.
check('CP01-C1 SmartReview imports the shared flag', /import \{ SOA_ENABLED \} from '\.\.\/lib\/soaContent'/.test(SMART));
check('CP01-C2 token fetch is flag-gated', /if \(SOA_ENABLED && isQualifiedSalesRoute\(lt\)\) \{/.test(SMART),
  'the fetch must be gated on SOA_ENABLED');
check('CP01-C3 gate is not hardcoded false', !/if \(false\b/.test(SMART),
  'a hardcoded false would not revert when SOA is enabled');
check('CP01-C4 qualified-route condition preserved', /isQualifiedSalesRoute\(lt\)/.test(SMART));
// The reason this matters: verify the body really did carry identifiers.
check('CP01-C5 the gated request is the one carrying PII',
  /fullName: `\$\{firstName\} \$\{lastName\}`/.test(SMART) && /phone: phoneValid\.cleaned/.test(SMART),
  'confirms the gated block is the PII-bearing one');

// ── CRM data integrity: never claim a pending document that cannot arrive ────
// EXPECTED: soa_pending reflects whether an SOA can actually be produced.
// FAILURE BEHAVIOR: a false "pending" tells the advisor to wait for a CMS-required
//                   artifact instead of collecting it another way.
check('CP01-D1 soa_pending gated on the flag', /soa_pending: SOA_ENABLED && isQualifiedSalesRoute\(lt\)/.test(SMART));
check('CP01-D2 no unconditional soa_pending true', !/soa_pending:\s*true/.test(codeOnly(SMART)),
  'must not report a pending SOA that cannot be produced');

// ── /soa/:token must explain, not loop ──────────────────────────────────────
// EXPECTED: a 503 renders a distinct 'unavailable' state.
// NEGATIVE: that state must NOT offer a retry, because retry cannot succeed.
// EDGE: 404 (expired/unknown token) must still be its own state — the two are
//       different facts and a senior deserves the accurate one.
// FAILURE BEHAVIOR: the old path rendered a blank card via setPhase('ready') with
//                   lead === null.
check('CP01-E1 unavailable phase exists in the type', /'unavailable'/.test(SIGN_PAGE));
check('CP01-E2 503 routes to unavailable', /if \(r\.status === 503\) \{ setPhase\('unavailable'\); return; \}/.test(SIGN_PAGE));
check('CP01-E3 503 handled BEFORE the generic !r.ok branch',
  SIGN_PAGE.indexOf("r.status === 503") < SIGN_PAGE.indexOf("if (!r.ok) { setPhase('error')"),
  'otherwise the generic handler swallows it first');
check('CP01-E4 404 still distinct from 503', /if \(r\.status === 404\) \{ setPhase\('notFound'\)/.test(SIGN_PAGE));
check('CP01-E5 unavailable copy is bilingual', (() => {
  const m = /phase === 'unavailable'[\s\S]{0,1400}?\n {10}\)\}/.exec(SIGN_PAGE);
  return !!m && /language === 'es'/.test(m[0]) && /1-855-720-8555/.test(m[0]);
})(), 'must offer the phone number in both languages');
check('CP01-E6 unavailable state offers NO retry button', (() => {
  const m = /phase === 'unavailable'[\s\S]{0,1400}?\n {10}\)\}/.exec(SIGN_PAGE);
  return !!m && !/<button/.test(m[0]);
})(), 'a retry that cannot succeed is a dead control');
// The blank-card dead end.
check('CP01-F1 retry no longer jumps to a phase it cannot render',
  !/setPhase\('ready'\); setError\(''\)/.test(SIGN_PAGE),
  "setPhase('ready') with lead===null renders nothing");
check('CP01-F2 retry re-runs the hydration fetch', /setReloadKey\(\(k\) => k \+ 1\)/.test(SIGN_PAGE));
check('CP01-F3 reloadKey is in the effect deps', /\}, \[token, reloadKey\]\)/.test(SIGN_PAGE),
  'without the dep the state change cannot re-trigger the fetch');
check('CP01-F4 ready branch still guards on lead', /phase === 'ready' && lead &&/.test(SIGN_PAGE),
  'the guard must stay — it is what makes F1 necessary');

// ── Clara must not promise what cannot be delivered (previously fixed; guard it) ──
check('CP01-G1 engine gates the SOA promise on the flag', /_soaRequired = SOA_ENABLED && _MARKETING_SOA\.has/.test(ENGINE));
check('CP01-G2 soaPending follows _soaRequired', /soaPending: _soaRequired/.test(ENGINE));
check('CP01-G3 the promise text is conditional, never unconditional',
  /_soaRequired\s*\n?\s*\?\s*`\\n\\nComo pidió/.test(ENGINE) || /_soaBlockEs = _soaRequired/.test(ENGINE));
check('CP01-G4 Clara only fetches a token when soaPending', /if \(newState\.soaPending && !newState\.soaToken/.test(CSB));
// With SOA_ENABLED=false this chain means Clara never calls the endpoint at all.
check('CP01-G5 chain is airtight: flag false => no promise => no fetch',
  /_soaRequired = SOA_ENABLED &&/.test(ENGINE) && /soaPending: _soaRequired/.test(ENGINE)
  && /if \(newState\.soaPending &&/.test(CSB));

// ── Documentation must not assert behavior that does not exist ──────────────
check('CP01-H1 the false "temporarily unavailable" claim is corrected',
  /the description was fiction/.test(SOA_CONTENT) || !/page shows a "temporarily unavailable" notice/.test(SOA_CONTENT));
check('CP01-H2 preconditions still enforced mechanically', /assertSoaEnablementSafe/.test(SOA_CONTENT));

note('CP01', 'The 503 itself is BLOCKED — EXTERNAL ACTION REQUIRED: SOA cannot be '
  + 'enabled until the FMO supplies verified organization/product counts (and four '
  + 'other preconditions clear). No code change can close that, and inventing counts '
  + 'to close it would be the real violation. What is closed here is every surrounding '
  + 'defect: PII sent to a refusing endpoint, a false CRM soa_pending, a dead-end '
  + 'retry, and an inaccurate code comment.');
note('CP01-NOT-VERIFIED', 'The /soa/:token unavailable state has NOT been observed in '
  + 'a browser against production. It is proven by static assertion only. Exact test: '
  + 'deploy, then visit https://clearpointsenioradvisors.com/soa/00000000-0000-4000-'
  + '8000-000000000000 and confirm the page shows the unavailable copy with the phone '
  + 'number and no retry button.');

// ══════════════════════════════════════════════════════════════════════════════
// CP-04 — GA4 _ga* cookies without the Secure attribute (LOW)
// ══════════════════════════════════════════════════════════════════════════════

// EXPECTED: gtag config sets cookie_flags including Secure.
// NEGATIVE: SameSite must not be widened to None just to satisfy the finding.
// EDGE: consent gating must remain — the cheapest privacy control here is not
//       setting the cookie at all.
// FAILURE BEHAVIOR: no cookie_flags means the browser writes _ga with neither
//       Secure nor an explicit SameSite.
check('CP04-A1 cookie_flags present', /cookie_flags:/.test(ANALYTICS));
check('CP04-A2 Secure set', /cookie_flags:\s*'[^']*Secure/.test(ANALYTICS));
check('CP04-A3 SameSite explicit', /cookie_flags:\s*'[^']*SameSite=/.test(ANALYTICS));
check('CP04-A4 SameSite is Lax, not None', /cookie_flags:\s*'SameSite=Lax;Secure'/.test(ANALYTICS),
  'None would widen cross-site sending for no benefit');
check('CP04-A5 flags are on the config call, where GA4 reads them',
  /gtag\('config', GA4_ID, \{[^}]*cookie_flags/.test(ANALYTICS),
  'cookie_flags on the js/ or event call has no effect');
check('CP04-A6 anonymize_ip preserved', /anonymize_ip: true/.test(ANALYTICS));
check('CP04-B1 consent gate intact', /localStorage\.getItem\('cp_cookie_consent'\)/.test(ANALYTICS)
  && /if \(choice !== 'all'\) return;/.test(ANALYTICS));
check('CP04-B2 loader still runs once', /if \(gaLoaded \|\| typeof document === 'undefined'\) return;/.test(ANALYTICS));
check('CP04-B3 PII whitelist sanitizer untouched', /const safe: GenericPayload = \{\};/.test(ANALYTICS)
  && /split\(\/\[\?#\]\/\)\[0\]/.test(ANALYTICS),
  'the hardening must not disturb the PII drop');
// Assert on code only: the file's comments deliberately NAME Meta Pixel in order to
// forbid it, and those comments are a guardrail worth keeping.
check('CP04-B4 no Meta Pixel introduced', !/fbq\(|connect\.facebook|facebook\.net/i.test(codeOnly(ANALYTICS)));
check('CP04-B5 the no-pixel prohibition comment survives', /NO Meta Pixel \/ Facebook/.test(ANALYTICS),
  'this comment is the guardrail for the next maintainer');

note('CP04-NOT-VERIFIED', 'The live cookie attributes have NOT been observed. _ga is '
  + 'written by Google\'s script via document.cookie, so it carries no Set-Cookie '
  + 'header and curl cannot see it — any claim of having inspected it that way would '
  + 'be false. Exact test: in a browser on the production site, accept ALL cookies, '
  + 'then in DevTools > Application > Cookies confirm _ga and _ga_287ZZL7JB6 both show '
  + 'Secure = true and SameSite = Lax. This is the only way to verify it.');

// ══════════════════════════════════════════════════════════════════════════════
console.log(`\nCP findings remediation (CP-01, CP-04): ${pass}/${pass + fail.length} assertions passed`);
if (notes.length) {
  console.log(YEL(`\n${notes.length} SCOPE / NOT-VERIFIED NOTES:`));
  for (const n of notes) console.log('  • ' + n);
}
if (fail.length) {
  console.error(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}
console.log(GRN('\n✓ CP-01 and CP-04 remediations hold; unverifiable items are declared above'));

// AUDIT 2026-08-13 (O-01) — contract tests for the CRM suppression endpoint.
// Pure logic + safety-property tests; no network, no CRM mutation.
// Run: npx tsx scripts/test-optout-crm-2026-08-13.mjs
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../api/opt-out.js', import.meta.url), 'utf8');
const GUARD = readFileSync(new URL('../src/lib/optOutGuard.ts', import.meta.url), 'utf8');

let pass = 0, fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(id + (why ? ' — ' + why : '')); };

// ── SAFETY PROPERTIES (the reason this endpoint needs no auth) ──────────────
check('S1 never creates a contact',
  !/method:\s*'POST'[^}]*\/contacts\/?'/.test(SRC) && !/contacts\/upsert/.test(SRC),
  'endpoint must never create or upsert a contact');
check('S2 sets dnd true', /dnd:\s*true/.test(SRC));
check('S3 never sets dnd false', !/dnd:\s*false/.test(SRC),
  'a suppression endpoint must never be able to RE-ENABLE contact');
check('S4 blocks call and sms channels', /Call:\s*\{\s*status:\s*'active'/.test(SRC) && /SMS:\s*\{\s*status:\s*'active'/.test(SRC));
check('S5 email blocked by default', /const blockEmail = channels\.email !== 'ALLOWED'/.test(SRC),
  'default must be block-everything; email stays open only on explicit request');
check('S6 applies dnc tags', /cp-dnc/.test(SRC) && /dnc-web-chat/.test(SRC));
check('S7 writes an audit note', /\/notes/.test(SRC) && /CONTACT REVOCATION/.test(SRC));
check('S8 note carries no raw message', !/body\.message/.test(SRC) && /Evidence category/.test(SRC),
  'only the evidence CATEGORY may be persisted, never the raw text');

// ── NO PHONE-NUMBER ORACLE ──────────────────────────────────────────────────
check('O1 no_match returns 200 not 404', /no_match/.test(SRC) && !/status\(404\)/.test(SRC),
  'a 404 on unknown numbers would leak who is in the CRM');
check('O2 identical ok:true shape on miss', /ok:\s*true,\s*crmApplied:\s*false/.test(SRC));

// ── ORIGIN / RATE / CACHE GUARDS REUSED ────────────────────────────────────
check('G1 origin checked', /checkOrigin\(req\)/.test(SRC) && /Origin not allowed/.test(SRC));
check('G2 cors applied', /applyCors\(/.test(SRC));
check('G3 no-store PII headers', /noStorePII\(res\)/.test(SRC));
check('G4 rate limited', /rateLimit\(/.test(SRC));
check('G5 rate limit generous', /max:\s*20/.test(SRC),
  'must not rate-limit a person out of being suppressed');
check('G6 POST only', /Method not allowed/.test(SRC));

// ── FAIL-OPEN AVOIDANCE / TRUTHFULNESS ─────────────────────────────────────
check('T1 reports crmApplied honestly', /crmApplied:\s*dndApplied/.test(SRC),
  'the caller must be able to tell whether the CRM was really updated');
check('T2 crm unconfigured is reported', /crm_unconfigured/.test(SRC));
check('T3 search failure reported', /search_failed/.test(SRC));

// ── CLIENT PROPAGATION CONTRACT ────────────────────────────────────────────
check('C1 propagate exists', /export function propagateOptOutToCrm/.test(GUARD));
check('C2 posts to /api/opt-out', /'\/api\/opt-out'/.test(GUARD));
check('C3 fire-and-forget', /\.catch\(\(\) =>/.test(GUARD),
  'a CRM failure must never surface as a user-facing error or block the ack');
check('C4 keepalive set', /keepalive:\s*true/.test(GUARD),
  'must survive a tab close immediately after the user says STOP');
check('C5 sends no raw message', !/userMessage/.test(GUARD.split('propagateOptOutToCrm')[1] || ''),
  'only identifiers the user already provided may be sent');
check('C6 skips when no identifier', /if \(!phone && !email\) return;/.test(GUARD));
check('C7 sends evidence category only', /evidence: permission\.evidence/.test(GUARD));

// ── WIRED INTO BOTH BOTS ───────────────────────────────────────────────────
const ZARA = readFileSync(new URL('../src/components/ChatBot.tsx', import.meta.url), 'utf8');
const CLARA = readFileSync(new URL('../src/components/CustomerServiceBot.tsx', import.meta.url), 'utf8');
check('W1 Zara calls propagate', /propagateOptOutToCrm\(\{/.test(ZARA));
check('W2 Clara calls propagate', /propagateOptOutToCrm\(\{/.test(CLARA));
check('W3 Zara still persists session flag', /persistContactPermission\(optOut\.permission\)/.test(ZARA));
check('W4 Clara still persists session flag', /persistContactPermission\(optOut\.permission\)/.test(CLARA));

console.log(`opt-out CRM suppression contract: ${pass}/${pass + fail.length} passed`);
if (fail.length) {
  console.error('\x1b[31mFAILURES:\x1b[0m\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('\x1b[32m✓ suppression endpoint satisfies every safety property\x1b[0m');

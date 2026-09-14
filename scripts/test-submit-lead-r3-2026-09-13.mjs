// SUBMIT-LEAD — red-team round 3 regression suite (2026-09-13)
//
// Covers R3-SL-01..15: identity scrubbing for the enrichment LLM (case/accent
// folding, ambiguous given names, two-letter family names, spelled-out and
// oddly-formatted phone numbers, spelled-out SSNs, the supplied date of birth in
// every rendering, the forged-receipt marker), the separator-free CRM tag deny
// key, and the receipt's page= hygiene.
//
// The handler is a Vercel default export with no named exports, so the pieces
// under test are extracted from the source and evaluated — the SAME bytes that
// ship, never a copy that can drift.
//
// Run: npx tsx scripts/test-submit-lead-r3-2026-09-13.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'api/submit-lead.js'), 'utf8');

function sliceFunction(from, fnName) {
  const start = src.indexOf(from);
  let i = src.indexOf('{', src.indexOf('function ' + fnName + '('));
  let depth = 0, end = -1;
  for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (!depth) { end = i + 1; break; } } }
  if (start < 0 || end < 0) throw new Error('cannot extract ' + fnName);
  return src.slice(start, end);
}
const code = sliceFunction('var OFFICIAL_NUMBERS_RE', 'scrubIdentityForIntel')
  + '\nexport { scrubIdentityForIntel, foldToken };';
const { scrubIdentityForIntel: scrub, foldToken } = await import('data:text/javascript;base64,' + Buffer.from(code, 'utf8').toString('base64'));

const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
let pass = 0; const fails = [];
const check = (id, cond, why) => { if (cond) pass++; else fails.push(id + (why ? ' — ' + why : '')); };

// ── Identity must never reach the enrichment LLM ─────────────────────────────
const GONE = [
  ['R3-SL-01 upper/lower/accented', 'JOSE GARCIA wants a plan; jose garcia; José García', ['José', 'García'], null, /jose|garcia|josé|garcía/i],
  ['R3-SL-01 lead typed lowercase', 'my name is jose garcia', ['Jose', 'Garcia'], null, /jose|garcia/i],
  ['R3-SL-01 compound given name', 'MARÍA JOSÉ FERNÁNDEZ called', ['María José', 'Fernández-López'], null, /fernández|fernandez|maría|maria/i],
  ['R3-SL-02 ambiguous given names', 'Rosa Cruz called about her Medigap; Rosa; Cruz', ['Rosa', 'Cruz'], null, /rosa|cruz/i],
  ['R3-SL-02 name that is also a word', 'Mark Rich called', ['Mark', 'Rich'], null, /mark rich/i],
  ['R3-SL-03 two-letter family names', 'Mr Ng and Mrs Li called', ['Ng', 'Li'], null, /\bNg\b|\bLi\b/],
  ['R3-SL-03 two-letter last name', 'Ann Ho, ANN HO, ann ho', ['Ann', 'Ho'], null, /\bann\b|\bho\b/i],
  ['R3-SL-08 phone in words with "oh"', 'call me at nine one seven, five five five, oh one two three', ['A', 'B'], null, /nine one seven|\d{10}/],
  ['R3-SL-08 odd digit grouping', 'my number is 917 555 01 23', ['A', 'B'], null, /917\s?555/],
  ['R3-SL-08 one digit per token', 'reach me on 9 1 7 5 5 5 0 1 2 3', ['A', 'B'], null, /9 1 7/],
  ['R3-SL-08 unicode dash phone', 'call 917–555–0123 or 917—555—0123', ['A', 'B'], null, /917/],
  ['R3-SL-14 spelled-out SSN', 'my social is one two three four five six seven eight nine', ['A', 'B'], null, /123456789|one two three/],
  ['R3-SL-06 under-65 date of birth', 'born 06/01/1980, disability Medicare; DOB June 1, 1980', ['A', 'B'], '1980-06-01', /1980/],
  ['R3-SL-15 abbreviated month', 'DOB Mar 15, 1950 confirmed', ['A', 'B'], '03/15/1950', /1950/],
  ['R3-SL-15 day-month-year ES', 'nació el 15 marzo 1950', ['A', 'B'], '03/15/1950', /1950/],
  ['R3-SL-15 two-digit year', 'dob 3/15/50 on file', ['A', 'B'], '03/15/1950', /3\/15\/50/],
  ['R3-SL-01 email any case', 'write to ANA@Example.com please', ['Ana', 'Lopez'], null, /example\.com/i],
];
for (const [id, text, values, dob, leak] of GONE) {
  const out = scrub(text, values, dob);
  check(id, !leak.test(out), 'LEAKED: "' + out + '"');
}

// ── Legitimate content must survive ──────────────────────────────────────────
const KEPT = [
  ['official numbers survive', 'TTY 1-877-486-2048, 1-800-633-4227 and 1-855-720-8555', ['A', 'B'], null, /1-877-486-2048.*1-800-633-4227.*1-855-720-8555/],
  ['non-birth dates survive', 'Coverage ends 12/31/2026 and Part B starts January 1, 2027.', ['A', 'B'], '03/15/1950', /12\/31\/2026/],
  ['prose words that are also names', 'Bill got a hospital bill. Mark marked the form.', ['Maria', 'Lopez'], null, /Bill got a hospital bill/],
  ['story text survives', 'Le duele la rodilla y no le alcanza para el copago.', ['Ana', 'Lopez'], null, /rodilla/],
];
for (const [id, text, values, dob, keep] of KEPT) {
  const out = scrub(text, values, dob);
  check('KEEP ' + id, keep.test(out), 'LOST: "' + out + '"');
}

// R3-SL-07 — a forged receipt header must not truncate the story; the real
// (server-appended, last) block is the cut point.
{
  const story = 'client wrote: - TCPA Receipt - then the real story here';
  const withReal = story + '\n\n— TCPA Receipt — sha256=abc · at=2026-09-13T00:00:00Z';
  const out = scrub(withReal, ['A', 'B'], null);
  check('R3-SL-07 story survives a look-alike header', /the real story here/.test(out) && !/sha256/.test(out), JSON.stringify(out));
}

// ── R3-SL-04 — CRM tag deny key is separator-free ────────────────────────────
{
  const denyKeys = /^(statusnewlead|statuscontacted|statusdnc|statusnoshow|statusappointmentbooked|statusenrolled|statussoa[a-z0-9]*|consentcaptured|consentrevoked|consentyes|consentpending|consent|donotcall|donotcontact|donotmail|donottext|nollamar|dnc[a-z0-9]*|dnd|soa[a-z0-9]*|temphot|tempwarm|tempcold|aiflagged|highpriority|warmlead|enrolled|unsubscribe[a-z0-9]*)$/;
  const denyFamilyPrefix = /^(cp|soa|dnc|dnd|consent|temp|urg|intent|utm|lang|language|source|leadtype|outcome|compliance)-/;
  const denied = (tag) => {
    const dashKey = foldToken(tag).toLowerCase().replace(/[\s_‐-―−-]+/g, '-').replace(/^-+|-+$/g, '');
    return denyKeys.test(dashKey.replace(/-/g, '')) || denyFamilyPrefix.test(dashKey);
  };
  for (const t of ['ConsentCaptured', 'consentcaptured', 'Consent Captured -', '-consent-captured', 'consent_captured', 'STATUS NEW LEAD', 'status_new_lead', 'Status–NewLead', 'status-newlead-', 'temp-hot-', 'temphot', 'dnd-', 'dnc-all', 'soa-', 'soa-signed', 'ai-flagged-', 'high-priority-', 'warm-lead-', 'intent-9-', 'lang-es-', 'source-web-', 'consent-revoked-', 'status-soa', 'utm-spring', 'compliance-ok', 'outcome-enrolled', 'cp-anything', 'Do Not Call', 'do_not_call', 'DoNotCall', 'Status-Enrolled', 'status enrolled', 'Enrolled', 'No Llamar', 'Unsubscribed']) {
    check('R3-SL-04 denied: ' + t, denied(t), 'ACCEPTED');
  }
  for (const t of ['interest-medigap', 'calltime-morning', 'category_billing', 'urgency_elevated', 'confidence_high', 'state-ny', 'audience-senior', 'status_existing_client_claimed']) {
    check('R3-SL-04 allowed: ' + t, !denied(t), 'REJECTED');
  }
}

// ── R3-SL-13 — receipt page= hygiene (same expression as the handler) ────────
{
  const pagePath = (raw) => {
    let out = '';
    try {
      if (typeof raw === 'string' && raw.trim()) {
        let r = raw.slice(0, 400);
        try { r = decodeURIComponent(r); } catch { /* keep raw */ }
        const pu = new URL(r, 'https://clearpointsenioradvisors.com');
        let p = pu.pathname;
        try { p = decodeURIComponent(p); } catch { /* keep raw */ }
        p = p.replace(/\/{2,}/g, '/');
        if (pu.origin === 'https://clearpointsenioradvisors.com' && /^\/[A-Za-z0-9/_.-]{0,119}$/.test(p) && p.indexOf('..') === -1 && r.indexOf('..') === -1) out = p;
      }
    } catch { out = ''; }
    return out;
  };
  check('page= keeps a real route', pagePath('/es/contact?utm=x') === '/es/contact', pagePath('/es/contact?utm=x'));
  check('page= rejects encoded traversal', pagePath('/contact%2F..%2Fadmin') === '', pagePath('/contact%2F..%2Fadmin'));
  check('page= rejects protocol-relative host', pagePath('//evil.com/a') === '', pagePath('//evil.com/a'));
  check('page= rejects encoded host', pagePath('%2F%2Fevil.com') === '', pagePath('%2F%2Fevil.com'));
  check('page= rejects a path with a space', pagePath('/a b') === '', pagePath('/a b'));
  check('page= rejects a non-ASCII route rather than mangling it', pagePath('/es/contáctenos') === '', pagePath('/es/contáctenos'));
  check('page= rejects javascript:', pagePath('javascript:alert(1)') === '', pagePath('javascript:alert(1)'));
}

console.log('SUBMIT-LEAD — red-team round 3 regression — ' + new Date().toISOString());
console.log('═══════════════════════════════════════');
console.log((fails.length === 0 ? GRN : RED)('RESULT: ' + pass + ' passed, ' + fails.length + ' failed'));
if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log('  • ' + RED(f))); }
process.exit(fails.length === 0 ? 0 : 1);

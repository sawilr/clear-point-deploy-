// AUDIT 2026-08-13 — §22 CROSS-DOMAIN COLLISION SUITE.
// "Many serious failures happen BETWEEN controls, not inside one control."
// Every individual control passed its own suite. These tests fire two or more
// controls at once, where precedence bugs live.
// Run: npx tsx scripts/test-collisions-2026-08-13.mjs
import { complianceFilter, matchesEmergency } from '../api/_lib/compliance-filter.js';
import { detectOptOut } from '../src/lib/optOutGuard.ts';
import { detectPHILeak, scrubSensitiveText } from '../src/lib/phiPatterns.ts';
import { scrubPHI } from '../api/_lib/phi-scrub.js';
import { detectSafetyTrigger } from '../src/lib/safetyRouter.ts';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, detail) => { if (cond) pass++; else fail.push(`${id}${detail ? ' — ' + detail : ''}`); };

// ── C1. EMERGENCY + SENSITIVE DATA ─────────────────────────────────────────
// A caller in crisis who also blurts an SSN. Life safety MUST win, and the SSN
// must still not survive. Getting the order wrong either buries the 911
// instruction behind a privacy lecture, or leaks the SSN while handling the
// emergency.
{
  const msg = 'I am having chest pain and my ssn is 123-45-6789';
  // ARCHITECTURE NOTE (verified 2026-08-13): 911 medical emergencies are detected
  // by matchesEmergency (mirrored in the engine and api/chat.js); safetyRouter
  // covers 988 self-harm ONLY. An earlier version of this test called
  // detectSafetyTrigger for chest pain and appeared to find a P0 — it was the
  // wrong detector. Verified before concluding; naming is a maintainability trap
  // worth knowing about, not a behavioral defect.
  check('C1a 911 net detects the emergency despite PII in the same message', matchesEmergency(msg));
  check('C1b PII also detected in the same message', detectPHILeak(msg));
  check('C1c stored form carries no raw SSN', !/123-45-6789/.test(scrubSensitiveText(msg)));
  const r = complianceFilter('Let me get your name first.', 'en', { latestUserText: msg });
  check('C1d server net still forces 911 over intake', /911/.test(r.text) && r.violations.includes('emergency_no_911'), r.text.slice(0, 90));
  // Pin the architecture so a future refactor cannot quietly move 911 into
  // safetyRouter and leave both paths half-wired.
  check('C1e safetyRouter scope is 988-only, by design', detectSafetyTrigger('chest pain').action === 'none' && detectSafetyTrigger('I want to kill myself').action === 'crisis_988');
}

// ── C2. EMERGENCY + OUT-OF-AREA ────────────────────────────────────────────
// A Florida caller with a medical emergency. Life safety must outrank the geo
// decline — telling a person in crisis "we aren't licensed in your state" first
// would be indefensible.
{
  const msg = 'I live in Florida and I cannot breathe';
  const r = complianceFilter('We are not licensed in your state. What is your name?', 'en', { latestUserText: msg });
  check('C2 life safety outranks geo decline', /911/.test(r.text), r.text.slice(0, 100));
}

// ── C3. REVOCATION + SIMULTANEOUS ADVISOR REQUEST ───────────────────────────
// "Stop contacting me — but have someone call me about my drug costs." A real
// mixed message. The revocation must win, and rule 12 must suppress the offer,
// so the system never asks for consent it will refuse to act on.
{
  const msg = 'Do not contact me anymore, but have someone call me about my drug costs.';
  const o = detectOptOut(msg);
  check('C3a revocation wins over the embedded request', o.matched, 'matched=' + o.matched);
  const r = complianceFilter('Sure — what is your phone number so an advisor can call you?', 'en', { contactOptedOut: true, latestUserText: msg });
  check('C3b rule 12 suppresses the contact ask', r.violations.includes('post_revocation_outreach'), JSON.stringify(r.violations));
  check('C3c self-initiated route offered instead', /1-855-720-8555/.test(r.text));
}

// ── C4. SSN ADVICE + MBI WARNING IN ONE SENTENCE ────────────────────────────
// The clause-scoping collision: a protective warning about one identifier must
// not shelter advice about another.
{
  const r = complianceFilter("Don't share your Medicare number, but you can use your Social Security number at the pharmacy.", 'en');
  check('C4a SSN advice stripped', r.violations.includes('ssn_advice'));
  check('C4b SSN advice gone from output', !/use your Social Security number at the pharmacy/i.test(r.text), r.text.slice(0, 120));
  check('C4c MBI warning survived', /Medicare number/i.test(r.text), r.text.slice(0, 120));
}

// ── C5. CARRIER NAME + ELIGIBILITY CLAIM + SEP CLAIM, ALL AT ONCE ───────────
// Three filters must compose without producing mangled text or dropping one.
{
  const r = complianceFilter('You most likely qualify for a Special Enrollment Period, and UnitedHealthcare has the best plan for you.', 'en');
  check('C5a carrier caught', r.violations.some((v) => v.startsWith('carrier_name')), JSON.stringify(r.violations));
  // The carrier rule removes any SENTENCE containing a carrier name; here that is
  // the whole input, so the SEP-specific rewrite never needs to fire. What matters
  // is that no SEP ASSERTION survives — verified below rather than demanding a
  // particular message.
  check('C5b no surviving SEP assertion', !/you\s+(?:most\s+)?likely\s+qualify/i.test(r.text) && !/qualify for a Special Enrollment/i.test(r.text), r.text.slice(0, 140));
  check('C5c carrier name absent from output', !/unitedhealthcare/i.test(r.text), r.text.slice(0, 140));
  check('C5d output is not empty', r.text.trim().length > 20, r.text);
}

// ── C6. SPANGLISH + REVOCATION ─────────────────────────────────────────────
// Code-switching must not defeat the DNC guard.
{
  check('C6a spanglish revocation', detectOptOut('please no me llamen more, I am done').matched);
  check('C6b spanglish revocation 2', detectOptOut('stop llamando por favor').matched);
  check('C6c mixed non-revocation stays clear', !detectOptOut('can you explain la Parte D please?').matched);
}

// ── C7. DICTATED SSN + TRANSCRIPT PERSISTENCE ──────────────────────────────
// The bypass that reached the CRM. Both gates AND the persistence scrubber must
// agree, because only the scrubber governs what is written durably.
{
  const dictated = 'my social security number is one two three four five six seven eight nine';
  check('C7a client gate blocks', detectPHILeak(dictated));
  check('C7b server gate blocks', scrubPHI(dictated).detected.length > 0);
  check('C7c persistence scrubber redacts', /REDACTED/.test(scrubSensitiveText(dictated)), scrubSensitiveText(dictated));
  check('C7d no digit run survives persistence', !/\d{9}/.test(scrubSensitiveText(dictated).replace(/\D/g, '')), scrubSensitiveText(dictated));
}

// ── C8. CONFUSED CALLER + PLAN RECOMMENDATION PRESSURE ─────────────────────
// A confused beneficiary pressing for a recommendation is the highest-risk
// combination in the whole system: maximum vulnerability meeting maximum
// temptation to just answer.
{
  const r = complianceFilter('Since you seem unsure, the best plan for you is the Humana one — you qualify.', 'en');
  check('C8a recommendation stripped', r.violations.some((v) => v.startsWith('carrier_name')) || r.violations.some((v) => v.startsWith('forbidden_phrase')), JSON.stringify(r.violations));
  check('C8b carrier gone', !/humana/i.test(r.text), r.text.slice(0, 120));
  check('C8c eligibility claim gone', !/you qualify/i.test(r.text), r.text.slice(0, 120));
}

// ── C9. WRONG NUMBER + REVOCATION ──────────────────────────────────────────
// "You have the wrong number, stop calling" — must register as a revocation,
// not merely a correction, so automated follow-up ends.
{
  check('C9a wrong-number revocation', detectOptOut('You have the wrong number, stop calling me').matched);
  check('C9b wrong number alone is not a DNC', !detectOptOut('I think you have the wrong number').matched,
    'a bare correction should not silently create a permanent DNC without a stop request');
}

// ── C10. REVOCATION + DELETION + EMAIL-ONLY, CONFLICTING SIGNALS ───────────
// Conflicting channel instructions in one message. The conservative reading must
// win: never end up MORE permissive than the strictest signal present.
{
  const o = detectOptOut('Email only. Actually, do not contact me at all, and delete my information.');
  check('C10a matched', o.matched);
  check('C10b strictest wins — email also blocked', o.permission?.email === 'BLOCKED', 'email=' + o.permission?.email);
  check('C10c deletion captured', o.wantsDeletion);
}

// ── C11. GEO DECLINE + LEAD CAPTURE ────────────────────────────────────────
// The out-of-area caller must never be asked for contact details.
{
  const r = complianceFilter('Happy to help! What is your name and phone number?', 'en', { latestUserText: 'I live in Texas' });
  check('C11a geo net fires', r.violations.includes('out_of_area_lead_capture'), JSON.stringify(r.violations));
  check('C11b no contact ask survives', !/your name and phone/i.test(r.text), r.text.slice(0, 110));
  check('C11c referral given', /1-800-MEDICARE/.test(r.text));
}

// ── C12. REVOCATION + STORAGE PROMISE ──────────────────────────────────────
// After a revocation the bot must not also invent a non-retention promise it
// cannot keep (retention is governed by policy, not by the model).
{
  const r = complianceFilter("Understood, I won't store any of your details.", 'en', { contactOptedOut: true });
  const handled = r.violations.includes('storage_claim') || r.violations.includes('post_revocation_outreach');
  check('C12 storage promise or outreach handled', handled, JSON.stringify(r.violations) + ' | ' + r.text.slice(0, 100));
}

// ── C13. CRISIS (988) + REVOCATION ─────────────────────────────────────────
// Self-harm language with a revocation. Crisis routing must not be suppressed by
// the DNC guard — that would be the worst possible precedence failure.
{
  const msg = 'I want to kill myself and do not contact me again';
  const safety = detectSafetyTrigger(msg);
  check('C13 crisis routing survives a revocation in the same message', safety.action !== 'none', JSON.stringify(safety.action));
}

console.log(`§22 cross-domain collisions: ${pass}/${pass + fail.length} passed`);
if (fail.length) {
  console.error(RED(`\n✗ ${fail.length} COLLISION FAILURES:`));
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}
console.log(GRN('✓ all control combinations behave correctly — no precedence defects'));

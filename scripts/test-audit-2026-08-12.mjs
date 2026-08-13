// AUDIT 2026-08-12 — remediation test suite.
// Run: npx tsx scripts/test-audit-2026-08-12.mjs
//
// Covers:
//   A. compliance-filter rule 11 (SSN-advice net) — the exact live failure
//      plus EN/ES variants, negated-warning exemption, SSA-agency exemption.
//   B. optOutGuard (DNC) — the exact live failure transcript plus channel
//      variants, bare STOP, deletion, and reschedule/false-positive guards.
//   C. Regression spot-checks — rules 8 (911) and 9 (out-of-area) still fire
//      after the rule-11 insertion; plan-recommendation phrases still caught.

import { complianceFilter } from '../api/_lib/compliance-filter.js';
import { detectOptOut } from '../src/lib/optOutGuard.ts';

let pass = 0, fail = 0;
const failures = [];
function check(id, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(id + (detail ? ' — ' + detail : '')); }
}

// ── A. SSN-advice net ────────────────────────────────────────────────────────

// CLARA-SSN-01 — the verbatim live failure (2026-08-12 transcript).
{
  const live = "I understand — losing your card is frustrating. In the meantime, your Medicare coverage is still active — you just need your Social Security number to prove eligibility at the doctor or pharmacy if needed. Is there anything else I can help you with today?";
  const r = complianceFilter(live, 'en');
  check('CLARA-SSN-01a violation tagged', r.violations.includes('ssn_advice'), JSON.stringify(r.violations));
  check('CLARA-SSN-01b advice removed', !/social security number to prove/i.test(r.text), r.text);
  check('CLARA-SSN-01c card guidance added', /medicare card/i.test(r.text) && /1-800-MEDICARE/.test(r.text), r.text);
}

// CLARA-SSN-01-ES — Spanish variant.
{
  const es = 'Su cobertura sigue activa — solo necesita su número de Seguro Social para demostrar elegibilidad en la farmacia.';
  const r = complianceFilter(es, 'es');
  check('CLARA-SSN-ES-a violation', r.violations.includes('ssn_advice'), JSON.stringify(r.violations));
  check('CLARA-SSN-ES-b rewrite', /tarjeta de Medicare/i.test(r.text), r.text);
}

// Exemption 1 — negated safety warning must NOT be rewritten.
{
  const warn = "Please don't share your Social Security number here — for your safety.";
  const r = complianceFilter(warn, 'en');
  check('CLARA-SSN-EXEMPT-NEG', !r.violations.includes('ssn_advice') && /don'?t share your Social Security/i.test(r.text), r.text);
}

// Exemption 2 — Social Security the AGENCY (contact info) must NOT match.
{
  const ssa = 'You can contact Social Security at ssa.gov or 1-800-772-1213 to replace that document.';
  const r = complianceFilter(ssa, 'en');
  check('CLARA-SSN-EXEMPT-SSA', !r.violations.includes('ssn_advice'), JSON.stringify(r.violations));
}

// Adversarial phrasings.
{
  const r1 = complianceFilter('Just bring your SSN to verify your coverage at the pharmacy.', 'en');
  check('CLARA-SSN-ADV-1', r1.violations.includes('ssn_advice'), r1.text);
  const r2 = complianceFilter('El doctor puede usar su número de seguro social para verificar la cobertura.', 'es');
  check('CLARA-SSN-ADV-2', r2.violations.includes('ssn_advice'), r2.text);
}

// ── B. optOutGuard (DNC) ─────────────────────────────────────────────────────

// ZARA-DNC-01 — verbatim live failure turn 1.
{
  const r = detectOptOut('No quiero que me llamen ni me manden mensajes. Borren mi información. STOP.');
  check('ZARA-DNC-01a matched', r.matched);
  check('ZARA-DNC-01b deletion', r.wantsDeletion);
  check('ZARA-DNC-01c blocks call+sms', r.permission?.call === 'BLOCKED' && r.permission?.sms === 'BLOCKED');
  check('ZARA-DNC-01d no name question', !/nombre/i.test(r.responseEs));
  check('ZARA-DNC-01e no PII in evidence', r.permission?.evidence.startsWith('optout_'));
}

// ZARA-DNC-02 — verbatim live failure turn 2.
{
  const r = detectOptOut('No. Dije que NO me contacten. Quiero cancelar todo contacto.');
  check('ZARA-DNC-02 matched', r.matched);
}

// Bare STOP, EN channel forms, email-only, deletion-only.
check('DNC-STOP', detectOptOut('STOP').matched);
check('DNC-stop-calling', detectOptOut('stop calling me').matched);
check('DNC-dont-contact', detectOptOut("Don't contact me again").matched);
check('DNC-remove-me', detectOptOut('Remove me from your list').matched);
{
  const r = detectOptOut('Email only please');
  check('DNC-email-only matched', r.matched);
  check('DNC-email-only allows email', r.permission?.email === 'ALLOWED' && r.permission?.call === 'BLOCKED');
}
{
  const r = detectOptOut('Borren mis datos por favor');
  check('DNC-deletion-only', r.matched && r.wantsDeletion);
}

// False-positive guards.
check('DNC-FP-reschedule', !detectOptOut('no me llamen mañana, mejor el lunes').matched, 'reschedule must not DNC');
check('DNC-FP-stop-plan', !detectOptOut('I want to stop my Medicare plan').matched, 'plan cancellation is an intent, not DNC');
check('DNC-FP-stop-by', !detectOptOut('Can you stop by my house?').matched);
check('DNC-FP-education', !detectOptOut('¿Qué es la Parte D de Medicare?').matched);

// ── C. Regressions around the new rule ───────────────────────────────────────

// Rule 8 still absolute: emergency + no 911 in reply → full replacement.
{
  const r = complianceFilter('Let me help you with your plan first.', 'en', { latestUserText: 'I have chest pain right now' });
  check('REG-911', r.violations.includes('emergency_no_911') && /911/.test(r.text));
}
// Rule 9 still fires after rule-11 insertion.
{
  const r = complianceFilter('Sure! What is your name and phone number?', 'en', { latestUserText: 'I live in Florida and want to enroll' });
  check('REG-GEO', r.violations.includes('out_of_area_lead_capture') && /1-800-MEDICARE/.test(r.text));
}
// Plan recommendation still rewritten.
{
  const r = complianceFilter('I recommend the Humana plan for you.', 'en');
  check('REG-CARRIER', r.violations.some(v => v.startsWith('carrier_name')), JSON.stringify(r.violations));
}
// Emergency reply that DOES contain 911 passes rule 8 untouched by rule 11.
{
  const r = complianceFilter('Please call 911 right now.', 'en', { latestUserText: 'chest pain' });
  check('REG-911-PASSTHROUGH', r.violations.length === 0 && /911/.test(r.text));
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`audit-2026-08-12 suite: ${pass}/${pass + fail} passed`);
if (fail) {
  console.error('FAILURES:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('All remediation tests green.');

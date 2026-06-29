// SECURITY HOTFIX — PHASE 2 (Zara parity, audit findings 06/07).
// Proves the deterministic ordering: collect → REVIEW → consent → submit, that
// review can never be skipped, that submit needs BOTH reviewConfirmed AND
// consentGiven, the one-field correction loop, and the masked summary (EN/ES,
// DOB excluded).
import { getNextMissingStep, buildZaraSummary, formatZaraPhone } from '../src/lib/zaraReview.ts';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

const base = { firstName: '', lastName: '', phone: '', state: '', zip: '', dob: '', currentCoverage: '', preferredLanguage: '', preferredContactTime: '', email: '', skippedEmail: false, reviewConfirmed: false, consentGiven: false, language: 'en' };
const full = { firstName: 'Maria', lastName: 'Rojas', phone: '2123880188', state: 'NY', zip: '10550', dob: '1955-01-01', currentCoverage: 'Original Medicare', preferredLanguage: 'English', preferredContactTime: 'Morning', email: 'maria@example.com', skippedEmail: false, reviewConfirmed: false, consentGiven: false, language: 'en' };

// ── Ordering ──
ok('empty → firstName', getNextMissingStep(base) === 'firstName');
ok('all fields collected, not reviewed → review', getNextMissingStep(full) === 'review', getNextMissingStep(full));
ok('reviewed, no consent → consent', getNextMissingStep({ ...full, reviewConfirmed: true }) === 'consent');
ok('reviewed + consent → readyToSubmit', getNextMissingStep({ ...full, reviewConfirmed: true, consentGiven: true }) === 'readyToSubmit');
// KEY: review CANNOT be skipped even if consent were somehow set first.
ok('consent set but NOT reviewed → still review first', getNextMissingStep({ ...full, consentGiven: true, reviewConfirmed: false }) === 'review');
// KEY: submit gated on BOTH flags.
ok('reviewed only (no consent) is NOT readyToSubmit', getNextMissingStep({ ...full, reviewConfirmed: true }) !== 'readyToSubmit');

// ── One-field correction loop (clear a field → re-collect it → back to review) ──
ok('fix phone → re-asks phone', getNextMissingStep({ ...full, phone: '' }) === 'phone');
ok('fix name → re-asks firstName', getNextMissingStep({ ...full, firstName: '' }) === 'firstName');
ok('fix email → re-asks email', getNextMissingStep({ ...full, email: '', skippedEmail: false }) === 'emailOptional');
ok('fix zip → re-asks zip', getNextMissingStep({ ...full, zip: '' }) === 'zipCode');
ok('after correction (still not reviewed) → review again', getNextMissingStep({ ...full, phone: '7184445566' }) === 'review');

// ── Masked summary (EN) ──
const sumEn = buildZaraSummary(full);
ok('EN summary: name', /Maria Rojas/.test(sumEn));
ok('EN summary: formatted phone', /212-388-0188/.test(sumEn), sumEn.replace(/\n/g, ' | '));
ok('EN summary: email', /maria@example\.com/.test(sumEn));
ok('EN summary: location NY 10550', /NY 10550/.test(sumEn));
ok('EN summary: "Is everything correct?"', /Is everything correct\?/.test(sumEn));
ok('EN summary: DOB EXCLUDED', !/1955|DOB|date of birth/i.test(sumEn));

// ── Masked summary (ES) ──
const sumEs = buildZaraSummary({ ...full, language: 'es' });
ok('ES summary: "confirmemos sus datos"', /confirmemos sus datos/.test(sumEs));
ok('ES summary: "¿Está todo correcto?"', /¿Está todo correcto\?/.test(sumEs));
ok('ES summary: DOB EXCLUDED', !/1955|fecha de nac/i.test(sumEs));

// ── Spanglish (ES language, mixed-content lead) still gates review→consent ──
ok('Spanglish (es lang): review before consent', getNextMissingStep({ ...full, language: 'es', currentCoverage: 'Medicare Advantage pero con dudas' }) === 'review');

// ── No email provided (skipped) — summary shows "(not provided)" ──
ok('summary: skipped email shows (not provided)', /\(not provided\)/.test(buildZaraSummary({ ...full, email: '', skippedEmail: true })));
ok('phone format helper', formatZaraPhone('2123880188') === '212-388-0188');

// ── PHASE 3 — DOB is NEVER collected in public Zara chat (finding 08) ──
ok('after zip → coverage (NOT dob)', getNextMissingStep({ ...base, firstName: 'A', lastName: 'B', phone: '2123880188', state: 'NY', zip: '10550' }) === 'currentCoverage');
{
  const fillers = { firstName: 'A', lastName: 'B', phone: '2123880188', state: 'NY', zip: '10550', currentCoverage: 'X', preferredLanguage: 'English', preferredContactTime: 'AM', email: 'a@b.com', reviewConfirmed: true, consentGiven: true };
  const stepToField = { firstName: 'firstName', lastName: 'lastName', phone: 'phone', leadState: 'state', zipCode: 'zip', currentCoverage: 'currentCoverage', preferredLanguage: 'preferredLanguage', bestTime: 'preferredContactTime', emailOptional: 'email', review: 'reviewConfirmed', consent: 'consentGiven' };
  let m = { ...base }; const seq = [];
  for (let i = 0; i < 15; i++) {
    const s = getNextMissingStep(m); seq.push(s);
    if (s === 'readyToSubmit') break;
    const f = stepToField[s]; if (f) m = { ...m, [f]: fillers[f] };
  }
  ok('full collection sequence NEVER asks dob', !seq.includes('dob'), seq.join(' → '));
  ok('sequence order: …zipCode → currentCoverage … review → consent → readyToSubmit',
     /zipCode → currentCoverage.*review → consent → readyToSubmit/.test(seq.join(' → ')), seq.join(' → '));
}

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

// PHASE A17 — Smoke tests for lead-intel module.
// Verifies graceful degradation: no API key, empty input, malformed
// responses must all return null without throwing.

import { analyzeLeadIntelligence, formatIntelForGhlNotes } from '../api/_lib/lead-intel.js';

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label); }
}

console.log('\n── GRACEFUL DEGRADATION ──');

// Clear key for graceful-degradation tests
const origKey = process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

check('returns null when API key missing',
  await analyzeLeadIntelligence({ leadNotes: 'test', language: 'en', source: 'test' }) === null);

check('returns null on empty notes',
  await analyzeLeadIntelligence({ leadNotes: '', language: 'en', source: 'test' }) === null);

check('returns null on whitespace-only notes',
  await analyzeLeadIntelligence({ leadNotes: '   \n  ', language: 'en', source: 'test' }) === null);

check('returns null when input missing entirely',
  await analyzeLeadIntelligence(null) === null);

console.log('\n── formatIntelForGhlNotes ──');

const empty = formatIntelForGhlNotes(null);
check('empty when intel is null', empty === '');

const sample = formatIntelForGhlNotes({
  summary: 'User has Original Medicare and is concerned about Part B premium.',
  intent_strength: 7,
  lead_temperature: 'warm',
  urgency: 'this_week',
  advisor_prep_notes: 'Verify their plan setup. Ask about prior MSP screening.',
  compliance_flags: ['user asked about Medigap which we do not currently offer'],
  recommended_first_questions: [
    'Are you currently on Original Medicare or Medicare Advantage?',
    'Have you ever applied for Extra Help or MSP?',
    'Are you happy with your current doctor?',
  ],
});
check('formatted output contains summary', sample.includes('Original Medicare'));
check('formatted output contains intent', sample.includes('7/10'));
check('formatted output contains temperature', sample.includes('warm'));
check('formatted output contains compliance flag', sample.includes('Medigap'));
check('formatted output contains all 3 questions', /1\. Are you currently/.test(sample) && /3\. Are you happy/.test(sample));

// Restore env (in case other tests depend on it)
if (origKey) process.env.ANTHROPIC_API_KEY = origKey;

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

// Phase 10 — unit tests for claraOuterFlow.ts pure logic.
// Inline copies the regexes/logic to avoid TS loader dependency.

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✓', label); }
  else      { fail++; console.log('  ✗', label); }
}

// Inline validateLast4Phone
function validateLast4Phone(text) {
  if (!text || typeof text !== 'string') return { ok: false };
  const digits = text.replace(/\D+/g, '');
  if (digits.length === 4) return { ok: true, digits };
  if (digits.length >= 7 && digits.length <= 15) return { ok: true, digits: digits.slice(-4) };
  return { ok: false };
}

console.log('\n── validateLast4Phone ──');
check('"5678" → ok',           validateLast4Phone('5678').ok === true);
check('"123" → fail',           validateLast4Phone('123').ok === false);
check('"(917) 555-5678" → 5678', validateLast4Phone('(917) 555-5678').digits === '5678');
check('"abc" → fail',           validateLast4Phone('abc').ok === false);

// Inline validateFullName
function validateFullName(text) {
  if (!text || typeof text !== 'string') return { ok: false };
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 4 || cleaned.length > 80) return { ok: false };
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(cleaned)) return { ok: false };
  if (cleaned.split(' ').length < 2) return { ok: false };
  return { ok: true, cleaned };
}

console.log('\n── validateFullName ──');
check('"María García" → ok',     validateFullName('María García').ok === true);
check('"John Smith" → ok',       validateFullName('John Smith').ok === true);
check('"Solo" → fail (1 word)',  validateFullName('Solo').ok === false);
check('"a b" → fail (too short)',validateFullName('a b').ok === false);
check('"X 123" → fail (digits)', validateFullName('X 123').ok === false);

// Inline categorizeOutOfScope
const DENTAL = /\b(dental|dentist|dientes|dentista|implante|carilla|braces|invisalign)\b/i;
const LIFE = /\b(life insurance|seguro de vida|funeral|burial|término|term life|whole life)\b/i;
const AUTO_HOME = /\b(auto|car insurance|seguro de auto|home insurance|seguro de hogar|homeowner|renter)\b/i;
const MEDICAID_ONLY = /(medicaid sin medicare|medicaid only|just medicaid|solo medicaid|just have medicaid|tengo medicaid|food stamps|snap)/i;
const MEDICAL_Q = /\b(síntoma|sintoma|dolor|medicina|prescripción|cita médica|appointment|symptom|pain|diagnos)\b/i;
function categorizeOutOfScope(text) {
  if (!text) return 'other';
  const t = text.toLowerCase();
  if (DENTAL.test(t)) return 'dental_only';
  if (LIFE.test(t)) return 'life_insurance';
  if (AUTO_HOME.test(t)) return 'auto_home_insurance';
  if (MEDICAID_ONLY.test(t)) return 'medicaid_only';
  if (MEDICAL_Q.test(t)) return 'medical_question';
  return 'other';
}

console.log('\n── categorizeOutOfScope ──');
check('"need a dentist" → dental_only',       categorizeOutOfScope('I need a dentist') === 'dental_only');
check('"life insurance" → life_insurance',    categorizeOutOfScope('Looking for life insurance') === 'life_insurance');
check('"auto insurance" → auto_home_insurance', categorizeOutOfScope('auto insurance quote') === 'auto_home_insurance');
check('"just medicaid" → medicaid_only',      categorizeOutOfScope('I just have medicaid no medicare') === 'medicaid_only');
check('"chest pain" → medical_question',      categorizeOutOfScope('I have chest pain') === 'medical_question');
check('"random topic" → other',               categorizeOutOfScope('Some random topic') === 'other');
check('"síntoma" → medical_question',         categorizeOutOfScope('Tengo un síntoma raro') === 'medical_question');
check('"seguro de vida" → life',              categorizeOutOfScope('Necesito un seguro de vida') === 'life_insurance');

// Qualification logic
function isQualifiedProspect(s) {
  if (!s.medicareStatus || s.medicareStatus === 'none') return false;
  const QUALIFYING = ['NY', 'NJ', 'CT'];
  if (!s.state || !QUALIFYING.includes(s.state)) return false;
  if (!s.topic) return false;
  return true;
}

console.log('\n── isQualifiedProspect ──');
check('A+B + NY + plan → qualified',
  isQualifiedProspect({ medicareStatus: 'AB_active', state: 'NY', topic: 'plan' }) === true);
check('near_65 + NJ + billing → qualified',
  isQualifiedProspect({ medicareStatus: 'near_65', state: 'NJ', topic: 'billing' }) === true);
check('none + NY + plan → NOT qualified',
  isQualifiedProspect({ medicareStatus: 'none', state: 'NY', topic: 'plan' }) === false);
check('A+B + FL + plan → NOT qualified (FL blocked)',
  isQualifiedProspect({ medicareStatus: 'AB_active', state: 'FL', topic: 'plan' }) === false);
check('A+B + other + plan → NOT qualified',
  isQualifiedProspect({ medicareStatus: 'AB_active', state: 'other', topic: 'plan' }) === false);
check('A+B + NY + no topic → NOT qualified',
  isQualifiedProspect({ medicareStatus: 'AB_active', state: 'NY' }) === false);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

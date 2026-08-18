// CARDIAC FALSE-NEGATIVE REGRESSION — 2026-08-18 (independent red-team finding).
//
// The engine's adjacent-word chest pattern missed classic cardiac presentations
// phrased with words between "chest" and the sensation: "my chest feels really
// tight and my left arm is going numb" → NORMAL service (life-safety false
// negative). The small-gap forward/reverse net now catches it. This suite pins
// BOTH directions: the emergencies are caught AND benign "chest"/"tight" phrases
// still survive (no new over-escalation from the widening).
//
// Run: npx tsx scripts/test-cardiac-detection-2026-08-18.mjs
import { detectEmergency } from '../src/lib/customerServiceEngine.ts';

const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
let pass = 0; const fails = [];
const must = (t, want) => { const got = detectEmergency(t); if (got === want) pass++; else fails.push(`${want ? 'MISS' : 'FALSE-POS'}: "${t}" → detectEmergency=${got}`); };

// ── MUST DETECT (was the false negative + variants) ──────────────────────────
[
  'my chest feels really tight and my left arm is going numb',
  'my chest is really tight',
  'I have a lot of pressure in my chest',
  'my chest feels heavy and I am sweating',
  'crushing pressure in my chest',
  'my left arm is going numb',
  'my right arm feels numb and tingly',
  'siento el pecho muy apretado',
  'tengo presion en el pecho',
  'siento una opresion en el pecho desde hace una hora',
].forEach((t) => must(t, true));

// ── MUST NOT DETECT (benign — the widening must not over-escalate these) ─────
[
  'I have a tight budget for a chest x-ray, is it covered?',
  'does my plan cover a chest x-ray?',
  'my dad keeps his medical papers in a chest of drawers',
  'the gym has a chest press machine, is that a covered benefit?',
  'I felt a bit tight on money after paying my premium',
  'necesito una radiografia del pecho, esta cubierta?',
  'guardo los documentos en un cofre del pecho', // "pecho" unrelated
].forEach((t) => must(t, false));

console.log('CARDIAC DETECTION REGRESSION — ' + new Date().toISOString());
console.log((fails.length === 0 ? GRN : RED)(`${pass} passed, ${fails.length} failed`));
if (fails.length) { fails.forEach((f) => console.log('  • ' + RED(f))); }
process.exit(fails.length === 0 ? 0 : 1);

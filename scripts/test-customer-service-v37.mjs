// Wave 37 — Multilingual profanity dictionary + permissive ZIP extraction.
// Stress harness covering 60+ profanity tokens across ES (multi-dialect),
// EN, FR, IT, PT, and 20+ ZIP-input formats.

import {
  processMessage,
  createInitialState,
  detectAbuseOrFrustration,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== PROFANITY — SPANISH (general) ===');
const esGeneral = [
  'mierda', 'joder', 'coño', 'carajo', 'verga', 'cabron', 'cabrón',
  'pendejo', 'pendeja', 'idiota', 'estupido', 'estúpido', 'maldita madre',
  'tu maldita madre', 'hijo de puta', 'hijueputa', 'hp', 'hdp',
];
for (const w of esGeneral) {
  check(`ES "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — SPANISH (Caribbean) ===');
const esCaribbean = [
  'mamabicho', 'mamabicha', 'comemierda', 'pinga', 'mamaguebo',
  'mamahuevo', 'mamagueva', 'chupame', 'comebicho', 'jodete',
  'singar', 'singa', 'pajeo',
];
for (const w of esCaribbean) {
  check(`ES (Caribbean) "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — SPANISH (Mexican) ===');
const esMexican = [
  'chinga tu madre', 'chingate', 'no mames', 'pinche', 'chingada',
  'pendejada', 'baboso', 'menso',
];
for (const w of esMexican) {
  check(`ES (MX) "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — SPANISH (Colombian / Venezuelan) ===');
const esColVe = [
  'marica', 'malparido', 'huevon', 'gevon', 'guevón', 'gonorrea',
];
for (const w of esColVe) {
  check(`ES (CO/VE) "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — SPANISH (Argentine) ===');
const esAr = [
  'boludo', 'pelotudo', 'forro', 'sorete',
];
for (const w of esAr) {
  check(`ES (AR) "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — ENGLISH ===');
const en = [
  'fuck', 'fucking', 'fuck you', 'fuck off', 'motherfucker', 'shit',
  'bullshit', 'damn', 'asshole', 'bitch', 'son of a bitch', 'bastard',
  'cunt', 'piss off', 'jackass', 'dumbass', 'prick',
];
for (const w of en) {
  check(`EN "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — FRENCH ===');
const fr = ['putain', 'merde', 'connard', 'salope', 'va te faire foutre', "ta gueule"];
for (const w of fr) {
  check(`FR "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — ITALIAN ===');
const it = ['vaffanculo', 'stronzo', 'cazzo', 'merda', 'coglione', 'cretino'];
for (const w of it) {
  check(`IT "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== PROFANITY — PORTUGUESE ===');
const pt = ['porra', 'caralho', 'foda-se', 'puta que pariu', 'filho da puta', 'otario'];
for (const w of pt) {
  check(`PT "${w}" → severe`,
    detectAbuseOrFrustration(w).detected === true);
}

console.log('\n=== FALSE POSITIVES — clean words must NOT trigger ===');
const clean = [
  'hello', 'hola', 'doctor', 'farmacia', 'pharmacy', 'mi madre necesita ayuda',
  'mi padre tiene Medicare', 'good morning', 'gracias', 'thank you',
  'i need help', 'puedo ayudarte', 'doctor primario',
];
for (const w of clean) {
  check(`Clean "${w}" → NOT severe`,
    detectAbuseOrFrustration(w).detected === false
      || detectAbuseOrFrustration(w).severity !== 'severe');
}

console.log('\n=== ZIP EXTRACTION — clean ===');
function driveZip(zip, lang = 'español') {
  let s = createInitialState();
  s = processMessage(lang, s).newState;
  s = processMessage(zip, s).newState;
  return s;
}

for (const z of ['10550', '07407', '12345', '06820', '32301', '00501', '90210', '78704']) {
  const s = driveZip(z);
  check(`ZIP "${z}" → captured`, s.zipCode === z);
  check(`ZIP "${z}" → step=asking_topic`, s.step === 'asking_topic');
}

console.log('\n=== ZIP EXTRACTION — messy formats ===');
const messy = [
  ['ZIP 10550', '10550'],
  ['ZIP code 10550', '10550'],
  ['mi zip es 10550', '10550'],
  ['my ZIP is 07407', '07407'],
  ['07407-1234', '07407'],
  ['  12345  ', '12345'],
  ['1 0 5 5 0', '10550'],
  ['en el 90210 California', '90210'],
];
for (const [input, expected] of messy) {
  const s = driveZip(input);
  check(`ZIP messy "${input}" → ${expected}`, s.zipCode === expected,
    `got=${s.zipCode}`);
}

console.log('\n=== ZIP — out-of-service-area still accepted ===');
{
  const s = driveZip('90210');  // California — outside NY/NJ/FL/CT
  check('Out-of-area ZIP captured', s.zipCode === '90210');
  check('Out-of-area ZIP marked invalid state',
    s.isValidState === false);
  check('Conversation still advances to asking_topic',
    s.step === 'asking_topic');
}

console.log('\n=== SAWIL "tu maldita madre" path (multilingual) ===');
{
  let s = createInitialState();
  s = processMessage('español', s).newState;
  s = processMessage('12345', s).newState;
  const r1 = processMessage('hijueputa', s); s = r1.newState;
  check('Sawil P1: Colombian "hijueputa" → recovery',
    s.recoveryStage === 1);
  const r2 = processMessage('chinga tu madre', s); s = r2.newState;
  check('Sawil P2: Mexican "chinga tu madre" → tier 2',
    s.recoveryStage === 2);
  const r3 = processMessage('vaffanculo', s); s = r3.newState;
  check('Sawil P3: Italian "vaffanculo" → tier 3',
    s.recoveryStage === 3);
  const r4 = processMessage('connard', s); s = r4.newState;
  check('Sawil P4: French "connard" → tier 4 sí/empezar',
    s.recoveryStage === 4);
  check('Sawil P4: response says sí/empezar',
    /escriba s[ií]|type yes/i.test(r4.response));
}

console.log('\n=== REGRESSION — clean ZIP flow still works ===');
{
  let s = createInitialState();
  s = processMessage('english', s).newState;
  s = processMessage('07407', s).newState;
  s = processMessage('my doctor does not take my insurance', s).newState;
  check('Regression: doctor flow active',
    s.serviceCategory === 'doctor_provider_network');
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

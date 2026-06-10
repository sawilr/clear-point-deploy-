// Headless verification of the ZIP county/state acknowledgment branch.
// Reproduces the EXACT runtime condition from CustomerServiceBot.tsx
// awaiting_zip handler: (inService && zi && zi.county) decides whether
// Clara names the county/state. Pure-function test, no React.
// zipLookup.ts is self-contained (no imports) so it loads under strip-types.
import { getZipInfo } from '../src/lib/zipLookup.ts';

// extractZip inlined verbatim from src/lib/claraOuterFlow.ts (lines 283-299)
// to avoid the claraOuterFlow→validation import chain that strip-types can't
// resolve extensionless. Keep in sync with source if that mapping changes.
function extractZip(text) {
  if (!text) return null;
  const m = text.match(/(?<!\d)(\d{5})(?!\d)/);
  if (!m) return null;
  const zip = m[1];
  const prefix = parseInt(zip.slice(0, 3), 10);
  let state = 'other';
  if (prefix >= 100 && prefix <= 149) state = 'NY';
  else if (prefix >= 70 && prefix <= 89) state = 'NJ';
  else if (prefix >= 60 && prefix <= 69) state = 'CT';
  return { zip, state };
}

function bridge(input, isEs = true) {
  const zipResult = extractZip(input);
  if (!zipResult) return { named: false, msg: '(no zip parsed)', zipResult };
  const { zip, state } = zipResult;
  const zi = getZipInfo(zip);
  const inService = state === 'NY' || state === 'NJ' || state === 'CT';
  const named = !!(inService && zi && zi.county);
  const msg = named
    ? (isEs
        ? `Perfecto — su código postal ${zip} corresponde a ${zi.county}, ${zi.state}. Usaré ${zip} como su zona de servicio. ¿En qué le puedo ayudar hoy?`
        : `Perfect — your ZIP ${zip} is in ${zi.county}, ${zi.state}. I'll use ${zip} as your service area. How can I help you today?`)
    : (isEs
        ? 'Perfecto, ya tengo su zona. ¿En qué le puedo ayudar hoy?'
        : 'Perfect, I have your area. How can I help you today?');
  return { named, msg, zip, state, county: zi?.county, zState: zi?.state };
}

const cases = [
  { in: '10033', wantNamed: true,  wantCounty: 'New York County' },   // Manhattan
  { in: '10001', wantNamed: true,  wantCounty: 'New York County' },   // Manhattan
  { in: '11201', wantNamed: true,  wantCounty: 'Kings County' },      // Brooklyn
  { in: '07302', wantNamed: true,  wantCounty: 'Hudson County' },     // Jersey City NJ
  { in: '06511', wantNamed: true,  wantCounty: 'New Haven County' },  // New Haven CT
  { in: '33101', wantNamed: false }, // Miami FL — must NOT name (compliance)
  { in: '90210', wantNamed: false }, // Beverly Hills — out of service
  { in: 'mi zip es 10033', wantNamed: true, wantCounty: 'New York County' },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = bridge(c.in);
  const okNamed = r.named === c.wantNamed;
  const okCounty = c.wantCounty ? r.county === c.wantCounty : true;
  const ok = okNamed && okCounty;
  if (ok) { pass++; console.log(`  ✓ "${c.in}" → named=${r.named} county=${r.county ?? '-'}`); }
  else { fail++; console.log(`  ✗ "${c.in}" → named=${r.named} (want ${c.wantNamed}) county=${r.county ?? '-'} (want ${c.wantCounty ?? '-'})`); }
}
// Show the actual message Clara would say for 10033 (Sawil's exact case)
console.log('\n10033 message:\n  ' + bridge('10033').msg);
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

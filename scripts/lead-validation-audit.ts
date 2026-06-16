/* eslint-disable no-console */
// Sawil 2026-06-15 — FULL lead-quality audit (~300 scenarios) for the shared
// validators (phone / email / name) used by Smart Review + the Contact
// LeadForm + Zara/Clara. Encodes the DESIRED behavior; any row where the
// current validator disagrees is a gap to fix. Run: npx tsx scripts/lead-validation-audit.ts
import { validatePhone, validateEmail, validatePersonName } from '../src/lib/validation';

type Case = { input: string; expect: boolean; note: string };
let PASS = 0, FAIL = 0;
const fails: string[] = [];
function run(label: string, fn: (s: string) => boolean, cases: Case[]) {
  console.log(`\n══════════ ${label} (${cases.length}) ══════════`);
  let p = 0, f = 0;
  for (const c of cases) {
    const got = fn(c.input);
    if (got === c.expect) { p++; PASS++; }
    else { f++; FAIL++; fails.push(`[${label}] "${c.input}" expected ${c.expect ? 'VALID' : 'REJECT'} (${c.note})`); }
  }
  console.log(`   ${p} pass / ${f} fail`);
}
const phoneOK = (s: string) => validatePhone(s).valid;
const emailOK = (s: string) => validateEmail(s).valid;
const nameOK = (s: string) => validatePersonName(s).valid;

// ─────────────────────────────  PHONE  ─────────────────────────────
const VALID_AREAS = [212, 718, 917, 347, 646, 201, 551, 862, 973, 203, 475, 860, 213, 305, 312, 404, 512, 617, 702, 786];
const phones: Case[] = [];
// Valid: real-looking, high-entropy, exchange not 0/1, no 555, ≥3 distinct digits
for (const ac of VALID_AREAS) {
  phones.push({ input: `${ac}2459816`, expect: true, note: `valid ${ac}` });
  phones.push({ input: `${ac}3678142`, expect: true, note: `valid ${ac} #2` });
}
// formatting variants of a valid number — all accepted
['(212) 245-9816', '212-245-9816', '212.245.9816', '+1 212 245 9816', '1-212-245-9816', '2122459816']
  .forEach(s => phones.push({ input: s, expect: true, note: 'valid w/ formatting' }));
// all-same digit (0000000000 .. 9999999999) — all fake
for (let d = 0; d <= 9; d++) phones.push({ input: String(d).repeat(10), expect: false, note: 'all-same digit' });
// two-distinct-digit / low-entropy patterns — fake
['2020202020', '7171717171', '3434343434', '8989898989', '6060606060', '1212121212', '9090909090', '5656565656', '2002002002', '7007007007']
  .forEach(s => phones.push({ input: s, expect: false, note: 'low-entropy (≤2 distinct)' }));
// low-entropy with a VALID area code AND valid exchange (≤2 distinct digits
// overall) — plausible-looking but obviously fake; current rules miss these
['2122122122', '7177177177', '2122112211']
  .forEach(s => phones.push({ input: s, expect: false, note: 'low-entropy, valid area (GAP)' }));
// sequential runs — fake
['1234567890', '0123456789', '9876543210', '2123456789', '4567890123']
  .forEach(s => phones.push({ input: s, expect: false, note: 'sequential run' }));
// 555 exchange — fake (NANPA fictional)
['2125551234', '7185550000', '9175559999', '2015554321']
  .forEach(s => phones.push({ input: s, expect: false, note: '555 exchange' }));
// long repeated runs (7+) — fake
['2128888888', '7180000000', '9171111111']
  .forEach(s => phones.push({ input: s, expect: false, note: '7+ repeated run' }));
// invalid area codes (not US allowlist) — fake
['0001234567', '1111234567', '5212345678', '9991234567', '0009994321']
  .forEach(s => phones.push({ input: s, expect: false, note: 'invalid area code' }));
// exchange starts 0/1 — fake
['2120234567', '7181234567', '9170987654']
  .forEach(s => phones.push({ input: s, expect: false, note: 'exchange 0/1' }));
// wrong length / junk / non-US
['', '   ', '123', '12345', '21224598', '212245981600', 'abcdefghij', '+442012345678', '+5212345678', '00000', '21A2459816']
  .forEach(s => phones.push({ input: s, expect: false, note: 'length/junk/non-US' }));

// ─────────────────────────────  EMAIL  ─────────────────────────────
const emails: Case[] = [];
// Valid, ordinary emails
['john.smith@gmail.com', 'maria.garcia@yahoo.com', 'j.doe@outlook.com', 'user123@company.org',
 'jose_rivera@hotmail.com', 'a.b@aol.com', 'robert.l.jones@verizon.net', 'sandra@icloud.com',
 'pedro.gomez@protonmail.com', 'lucy.nguyen@gmail.com', 'wm.hancock@gmail.com', 'first.last@sub.domain.com']
  .forEach(s => emails.push({ input: s, expect: true, note: 'valid ordinary' }));
// Empty email is VALID (optional field)
['', '   '].forEach(s => emails.push({ input: s, expect: true, note: 'empty optional' }));
// Real locals that merely CONTAIN a profane substring — must NOT be flagged
['assistant@gmail.com', 'ridiculous@gmail.com', 'reputation@gmail.com', 'cassandra@gmail.com',
 'dickson@gmail.com', 'hancock@gmail.com', 'analyst@gmail.com', 'classic@gmail.com',
 'matthews@gmail.com', 'cocktail.bar@gmail.com', 'grasshopper@gmail.com']
  .forEach(s => emails.push({ input: s, expect: true, note: 'real local w/ harmless substring' }));
// Whole-local profanity — reject
['fuck@gmail.com', 'puta@gmail.com', 'culo@gmail.com', 'shit@yahoo.com', 'pendejo@hotmail.com',
 'mierda@gmail.com', 'cabron@gmail.com', 'maricon@gmail.com', 'bitch@gmail.com', 'asshole@gmail.com']
  .forEach(s => emails.push({ input: s, expect: false, note: 'whole-local profanity' }));
// Substring / concatenated profanity in local — reject (the reported gap)
['fuckyou@gmail.com', 'putamadre@gmail.com', 'pendejo123@gmail.com', 'shithead@hotmail.com',
 'imafuck@gmail.com', 'fuckclearpoint@gmail.com', 'bigdick.fuck@gmail.com', 'motherfucker@gmail.com',
 'fuck.you@gmail.com', 'puta_madre@gmail.com', 'xxfuckxx@gmail.com', 'mamaguevo99@gmail.com',
 'gilipollas.es@gmail.com', 'chingada@gmail.com', 'maricon69@gmail.com']
  .forEach(s => emails.push({ input: s, expect: false, note: 'substring profanity (GAP)' }));
// Fake / placeholder local or domain — reject
['test@test.com', 'asdf@asdf.com', 'demo@example.com', 'fake@fake.com', 'noemail@gmail.com',
 'qwerty@qwerty.com', 'abc@abc.com', 'noreply@gmail.com', 'sample@sample.com']
  .forEach(s => emails.push({ input: s, expect: false, note: 'fake/placeholder' }));
// Blocked / disposable / placeholder domains — reject
['john@mailinator.com', 'a@guerrillamail.com', 'b@10minutemail.com', 'c@yopmail.com',
 'd@example.com', 'e@test.com', 'f@fake.com', 'g@maria.com', 'real.name@trashmail.com']
  .forEach(s => emails.push({ input: s, expect: false, note: 'blocked/disposable domain' }));
// Malformed — reject
['noat.com', 'a@@b.com', 'a@b', 'a@b.c', 'a@b..c', 'a@.com', '@gmail.com', 'a b@gmail.com',
 'a@b.toolongtld', 'a.@gmail.com', '.a@gmail.com', 'a@@', 'plainstring', 'a@b.c.d.e.f.g.h']
  .forEach(s => emails.push({ input: s, expect: false, note: 'malformed' }));

// ─────────────────────────────  NAME  ──────────────────────────────
const names: Case[] = [];
// Valid real names incl. Hispanic, accents, punctuation, allowlist tokens
['José', 'María', "O'Brien", 'Jean-Paul', 'De La Cruz', 'Nguyen', 'Dick', 'Cassandra', 'Hassan',
 'Hancock', 'Lulu', 'Toto', 'Creta', 'Ángela', 'Muñoz', 'Rodríguez', 'Smith', 'Mary Ann',
 'Jo', 'Al', 'Xiomara', 'Dickson', 'Cox', 'Bishop']
  .forEach(s => names.push({ input: s, expect: true, note: 'valid real name' }));
// Fakes / placeholders — reject
['test', 'testing', 'asdf', 'qwerty', 'aaa', 'xxx', 'zzz', 'none', 'na', 'unknown', 'user', 'admin',
 'firstname', 'lastname', 'abc', 'hello', 'guest', 'dummy', 'a', 'x', '1234', 'John123', 'N/A']
  .forEach(s => names.push({ input: s, expect: false, note: 'fake/placeholder' }));
// Profanity whole-token + concatenated — reject
['fuck', 'puta', 'pendejo', 'mierda', 'cabron', 'maricon', 'mamaguevo', 'fuck you', 'fuckface',
 'pinche puto', 'shit', 'asshole', 'bitch', 'culero']
  .forEach(s => names.push({ input: s, expect: false, note: 'profanity' }));

// ──────────────  EXTENDED COVERAGE (to 300+)  ──────────────
// More valid phones across additional US area codes
[480, 602, 303, 720, 808, 312, 469, 214, 619, 858, 415, 510, 206, 425, 615, 305, 786, 813, 407, 904]
  .forEach(ac => phones.push({ input: `${ac}3678142`, expect: true, note: `valid ${ac} extended` }));
// More valid emails — varied TLDs, subdomains, plus-addressing, dotted locals
['robert@company.net', 'sara.lee@university.edu', 'team@startup.io', 'hello@agency.co',
 'a.b.c@mail.server.com', 'john+medicare@gmail.com', 'maria-jose@correo.es', 'wm.h.taft@gov.us',
 'grandma.betty@aol.com', 'p@q.com', 'long.name.here@reallylongdomainname.org',
 'numbers123@gmail.com', 'r2d2@gmail.com', 'o.connor@outlook.com']
  .forEach(s => emails.push({ input: s, expect: true, note: 'valid extended' }));
// Real locals that CONTAIN a harmless letter run — must stay valid (anti over-block)
['assess@gmail.com', 'compass@gmail.com', 'passion@gmail.com', 'embarrass@gmail.com',
 'glass.co@gmail.com', 'associate@gmail.com', 'pioneer@gmail.com', 'classic.cars@gmail.com',
 'bassist@gmail.com', 'molasses@gmail.com', 'harassment.law@gmail.com', 'cassidy@gmail.com',
 'dickinson.poetry@gmail.com', 'hitchcock@gmail.com', 'hassle.free@gmail.com',
 'analysis@gmail.com', 'cockburn@gmail.com', 'titmouse@gmail.com']
  .forEach(s => emails.push({ input: s, expect: true, note: 'real local, no false-block' }));
// More profanity emails (concatenated / mixed case — validator lowercases) — reject
['FuckYou@gmail.com', 'PUTAMADRE@gmail.com', 'FUCK@gmail.com',
 'fuckkk@gmail.com', 'pendeja.total@gmail.com', 'cabronazo@gmail.com', 'maricones@gmail.com']
  .forEach(s => emails.push({ input: s, expect: false, note: 'profanity variant' }));
// More valid names (international, accents, particles)
['François', 'Søren', 'Łukasz', 'D’Angelo', 'Mac Donald', 'St. James', 'Al-Rahman',
 'Mary-Jane', 'Le Blanc', 'Van Der Berg', 'Çelik', 'Đặng', 'Oluwaseun', 'Yamamoto',
 'Beatriz', 'Guadalupe', 'Concepción', 'Ng', 'Ba', 'Wei']
  .forEach(s => names.push({ input: s, expect: true, note: 'valid international' }));
// More fakes / profanity names — reject
['aaaa', 'bbbb', 'test test', 'asdf', 'qwerty', 'puta madre', 'fuckk',
 'pinche pendejo', 'comemierda', '...', "''", 'a.a', 'John123', 'xxxx']
  .forEach(s => names.push({ input: s, expect: false, note: 'fake/profanity extended' }));

run('PHONE', phoneOK, phones);
run('EMAIL', emailOK, emails);
run('NAME', nameOK, names);

const TOTAL = PASS + FAIL;
console.log(`\n═════════════════════════════════════════`);
console.log(`TOTAL SCENARIOS: ${TOTAL}  —  ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) { console.log('\nGAPS:'); fails.forEach(f => console.log('  ❌ ' + f)); }
process.exit(FAIL > 0 ? 1 : 0);

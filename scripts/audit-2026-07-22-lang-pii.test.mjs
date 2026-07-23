// AUDIT 2026-07-22 — regression locks for the Clara language-precedence fix
// (bug: entering via the ENGLISH page, Clara greeted in Spanish from a stale
// stored preference) and the KI-SEC-01 PII-storage remediation.
//
// Locks four contracts:
//   1. persistentMemory never persists PII (name/zip/state stripped on write
//      AND legacy records migrated/stripped on read).
//   2. returningVisitorGreeting renders in the CALLER's language (current
//      experience), never a stored one, and never uses a name.
//   3. CustomerServiceBot source: greeting language derives from
//      initialLanguage/pageLang only — mem.language must NOT reappear as a
//      language source; no hardcoded `|| 'es'` fallbacks.
//   4. ChatBot (Zara) getMemoryForStorage strips raw user input
//      (lastValidUserInput) plus phone/email/dob.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

// ── localStorage stub so persistentMemory runs under Node ──────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { readVisitorMemory, writeVisitorMemory, returningVisitorGreeting } =
  await import('../src/lib/persistentMemory.ts');

// 1a. Writes never persist PII even if a caller passes it.
store.clear();
writeVisitorMemory({ name: 'Testuser', zip: '10001', state: 'NY', language: 'es', lastTopic: 'Part D' });
const raw1 = JSON.parse(store.get('cp_visitor_memory_v1'));
ok('write strips name', raw1.name === undefined, JSON.stringify(raw1));
ok('write strips zip', raw1.zip === undefined);
ok('write strips state', raw1.state === undefined);
ok('write keeps language', raw1.language === 'es');
ok('write keeps lastTopic', raw1.lastTopic === 'Part D');

// 1b. Legacy record with PII → read migrates: strips PII and rewrites.
store.clear();
store.set('cp_visitor_memory_v1', JSON.stringify({
  name: 'Legacy Person', zip: '07001', state: 'NJ', language: 'es',
  lastTopic: 'Extra Help', lastSeen: Date.now() - 5 * 24 * 3600 * 1000,
}));
const mem = readVisitorMemory();
ok('legacy read returns no name', mem.name === undefined);
const raw2 = JSON.parse(store.get('cp_visitor_memory_v1'));
ok('legacy record rewritten without PII on disk', raw2.name === undefined && raw2.zip === undefined && raw2.state === undefined, JSON.stringify(raw2));
ok('legacy migration keeps topic continuity', raw2.lastTopic === 'Extra Help');

// 1c. Expired record still purged (TTL intact).
store.clear();
store.set('cp_visitor_memory_v1', JSON.stringify({ language: 'es', lastSeen: Date.now() - 61 * 24 * 3600 * 1000 }));
ok('TTL purge intact', readVisitorMemory() === null && !store.has('cp_visitor_memory_v1'));

// 2. Greeting language = caller's language, regardless of stored language.
const esMem = { language: 'es', lastTopic: 'Part D', lastSeen: Date.now() - 2 * 24 * 3600 * 1000 };
const gEn = returningVisitorGreeting(esMem, 'en');
const gEs = returningVisitorGreeting(esMem, 'es');
ok('greeting in EN when experience is EN (stored pref was ES)', /Welcome back/.test(gEn) && !/Bienvenido/.test(gEn), gEn);
ok('greeting in ES when experience is ES', /Bienvenido de vuelta/.test(gEs), gEs);
ok('greeting never contains a name placeholder', !/,\s*\w+\./.test((gEn.split('.')[0] || '')) || gEn.startsWith('Welcome back. '), gEn);
ok('no memory → no returning greeting', returningVisitorGreeting(null, 'en') === null);
ok('memory without topic → no returning greeting', returningVisitorGreeting({ lastSeen: Date.now() }, 'en') === null);

// 3. Source locks — CustomerServiceBot greeting precedence + no hardcoded 'es'.
const csb = readFileSync(join(root, 'src/components/CustomerServiceBot.tsx'), 'utf8');
ok('CSB: mem.language is NOT a greeting-language source', !/initialLanguage\s*\|\|\s*mem\?\.language/.test(csb));
ok('CSB: greeting lang derives from initialLanguage||pageLang', /initialLanguage \|\| \(pageLang === 'es' \? 'es' : 'en'\)/.test(csb));
ok("CSB: no `newState.language || 'es'` hardcoded fallback", !/newState\.language \|\| 'es'/.test(csb));

// 4. Zara storage strips raw user input + identity-grade fields.
const zara = readFileSync(join(root, 'src/components/ChatBot.tsx'), 'utf8');
const gmfs = zara.slice(zara.indexOf('function getMemoryForStorage'), zara.indexOf('function getMemoryForStorage') + 900);
ok('Zara storage strips lastValidUserInput', /lastValidUserInput:\s*''/.test(gmfs));
ok('Zara storage still strips phone/email/dob', /phone:\s*''/.test(gmfs) && /email:\s*''/.test(gmfs) && /dob:\s*''/.test(gmfs));

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

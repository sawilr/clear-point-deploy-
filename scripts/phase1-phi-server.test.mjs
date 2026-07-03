// AUDIT 2026-07-03 Phases 1-3 verification harness.
//
// Proves: (a) scrubPHI redacts SSN / MBI / HICN / card / routing / IBAN / bare
// 9-digit BEFORE any external sink; (b) legitimate lead data (10-digit phone,
// ZIP, email, name, callback window, dates) passes through UNCHANGED; (c) the
// server files actually WIRE the scrub at the right points (source-level
// assertions on api/submit-lead.js + api/chat.js); (d) ghl.ts forwards
// best_time_to_contact and submit-lead.js consumes it.
import { scrubPHI } from '../api/_lib/phi-scrub.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL: ' + name); } };

// ── (a) POSITIVE: PHI must be redacted ──────────────────────────────────────
const redacts = (name, input, mustNotContain) => {
  const r = scrubPHI(input);
  ok(name + ' [redacted]', !r.text.includes(mustNotContain));
  ok(name + ' [detected]', r.detected.length > 0);
};
redacts('SSN dashed', 'my ssn is 123-45-6789 ok', '123-45-6789');
redacts('SSN spaced', 'ssn 123 45 6789 here', '123 45 6789');
redacts('SSN bare 9-digit', 'number 123456789 given', '123456789');
redacts('MBI', 'medicare id 1EG4-TE5-MK72 thanks', '1EG4-TE5-MK72');
redacts('HICN legacy', 'claim 123456789A on file', '123456789A');
redacts('Card 16-digit', 'card 4111 1111 1111 1111 exp', '4111 1111 1111 1111');
redacts('Routing ABA', 'routing 021000021 checking', '021000021');
redacts('IBAN', 'iban GB29NWBK60161331926819 send', 'GB29NWBK60161331926819');

// ── (b) NEGATIVE: legitimate lead data must pass UNCHANGED ──────────────────
const passes = (name, input) => {
  const r = scrubPHI(input);
  ok(name + ' [unchanged]', r.text === input);
};
passes('10-digit phone bare', 'Phone: 5550123456');
passes('phone dashed', 'call me at 555-010-1234 evenings');
passes('phone paren', 'Tel (787) 555-0123 despues de las 5');
passes('phone +1 spaced', 'reach me +1 555 010 1234 ok');
passes('ZIP', 'ZIP: 10001 · State: NY');
passes('email', 'email maria.garcia@example.com por favor');
passes('name + callback', 'Maria Garcia · Best callback time: Evening (3pm-6pm ET)');
passes('date slashes', 'turned 65 on 03/15/2026');
passes('note builder line', 'Name: Carlos Mendoza\nPhone: 5550123456\nZIP: 11368\nBest callback time: Morning');
passes('spanish intake', 'Prefiere español, llamar en la tarde, tema: factura de $240');

// ── (c) WIRING: server files actually call the scrub at the right points ────
const submitSrc = readFileSync(join(root, 'api/submit-lead.js'), 'utf8');
const chatSrc = readFileSync(join(root, 'api/chat.js'), 'utf8');
const ghlSrc = readFileSync(join(root, 'src/lib/ghl.ts'), 'utf8');
const guardSrc = readFileSync(join(root, 'src/lib/sensitiveGuard.ts'), 'utf8');

ok('submit-lead imports scrubPHI', /import \{ scrubPHI \} from '\.\/_lib\/phi-scrub\.js'/.test(submitSrc));
ok('submit-lead scrubs lead_notes at source', /var _scrubNotes = scrubPHI\(lead_notes\)/.test(submitSrc));
ok('submit-lead scrubs conversation_summary at source', /var _scrubSummary = scrubPHI\(conversation_summary\)/.test(submitSrc));
ok('submit-lead scrub runs BEFORE lead-intel call', submitSrc.indexOf('_scrubNotes') < submitSrc.indexOf('analyzeLeadIntelligence({'));
ok('submit-lead scrub runs BEFORE customFields', submitSrc.indexOf('var _scrubNotes') < submitSrc.indexOf("id: '6vSP5DJvAc6Jl9BXg409'"));
ok('submit-lead scrub runs BEFORE note POST', submitSrc.indexOf('_scrubNotes') < submitSrc.indexOf('/notes'));
ok('submit-lead PHI log is category-only (no raw text)', /PHI redacted before LLM\/CRM/.test(submitSrc));
ok('chat.js scrubs replayed history turns', /_turnScrub = scrubPHI\(String\(turn\.content\)/.test(chatSrc));
ok('chat.js scrubs context fields', /_ctxScrub = scrubPHI\(rawCtx\[k\]/.test(chatSrc));
ok('chat.js still scrubs current message', /var phiResult = scrubPHI\(userMessage\)/.test(chatSrc));

// ── (d) Phase 3: best_time_to_contact end-to-end wiring ─────────────────────
ok('ghl.ts forwards best_time_to_contact', /body\.best_time_to_contact = payload\.best_time_to_contact/.test(ghlSrc));
ok('submit-lead reads best_time_to_contact', /body\.best_time_to_contact/.test(submitSrc));
ok('submit-lead persists best-time in note', /Best time to contact: /.test(submitSrc));
ok('submit-lead tags CallTime', /_tagify\('CallTime'/.test(submitSrc));
ok('submit-lead reads interest_type', /_cap\(body\.interest_type, 80\)/.test(submitSrc));
ok('submit-lead persists interest in note', /Interest\/topic: /.test(submitSrc));
ok('consent full hash persisted (no truncation)', !/consent_receipt_hash\.slice\(0, 16\)/.test(submitSrc));
ok('consent verbatim text persisted', /Consent Text \(verbatim/.test(submitSrc));

// ── Phase 4: chunk-split wiring ──────────────────────────────────────────────
ok('sensitiveGuard imports light phiPatterns (not engine)', /from '\.\/phiPatterns'/.test(guardSrc) && !/customerServiceEngine/.test(guardSrc));

// ── History-turn simulation (PHI in EARLIER turn, clean current turn) ───────
const history = [
  { role: 'user', content: 'hola necesito ayuda, mi seguro social es 123-45-6789' },
  { role: 'assistant', content: 'Por su seguridad no comparta ese número.' },
  { role: 'user', content: 'ok entiendo, y cuanto cuesta la parte B?' },
];
const replayed = history.map(t => scrubPHI(String(t.content).slice(0, 1000)).text);
ok('earlier-turn SSN redacted on replay', !replayed[0].includes('123-45-6789') && replayed[0].includes('[REDACTED'));
ok('clean turns unchanged on replay', replayed[2] === history[2].content);
// context.name attack
const nameScrub = scrubPHI('Maria 1EG4-TE5-MK72'.slice(0, 120));
ok('context.name MBI redacted', !nameScrub.text.includes('1EG4-TE5-MK72'));
const legitName = scrubPHI('Maria Garcia'.slice(0, 120));
ok('context.name legit unchanged', legitName.text === 'Maria Garcia');
const legitPhoneCtx = scrubPHI('5550123456');
ok('context.phoneNumber 10-digit unchanged', legitPhoneCtx.text === '5550123456');

console.log(`\nphase1-3 PHI/lead harness: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

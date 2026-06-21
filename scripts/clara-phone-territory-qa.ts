/* eslint-disable no-console */
// Sawil 2026-06-20 — Phone territory + ZIP service-area gate + anti-loop escape.
// LIVE BUG: Clara rejected a valid 787 (Puerto Rico) cell, trapping a real lead.
// Root cause: US_AREA_CODES excluded U.S. territories. Phone validity and
// service-area eligibility are SEPARATE: phone = format/real number; ZIP = whether
// ClearPoint (NY/NJ/CT only) serves the area. FL stays dormant/unsupported.
import { processMessage } from '../src/lib/customerServiceEngine';
import { validatePhone } from '../src/lib/validation.ts';
import { isSupportedZip, getZipInfo } from '../src/lib/zipLookup';
type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
const ok = (id: string, c: boolean, x = '') => { if (c) PASS++; else { FAIL++; fails.push(id + (x ? ` (${x})` : '')); } console.log(`${c ? '✅' : '❌'} ${id}`); };
const v = (n: string) => validatePhone(n).valid;
const served = (z: string) => isSupportedZip(z);

console.log('── 1) PHONE VALIDITY: territories VALID, fakes rejected ──');
ok('787 (Maria) valid phone', v('7875152529') === true);
ok('787 #2 valid phone', v('7875152928') === true);
ok('939 valid phone', v('9392345670') === true);
ok('sequential 2123456789 rejected', v('2123456789') === false);
ok('all-same 1111111111 rejected', v('1111111111') === false);
ok('555 exchange 2125551234 rejected', v('2125551234') === false);
ok('normal NY 9143334477 valid', v('9143334477') === true);

console.log('── 2) ZIP SERVICE-AREA GATE: NY/NJ/CT served, everything else not ──');
ok('NY 10550 served', served('10550') === true, 'info=' + JSON.stringify(getZipInfo('10550')));
ok('NJ 07030 served', served('07030') === true, 'info=' + JSON.stringify(getZipInfo('07030')));
ok('CT 06010 served', served('06010') === true, 'info=' + JSON.stringify(getZipInfo('06010')));
ok('PR 00926 NOT served', served('00926') === false);
ok('CA 90001 NOT served', served('90001') === false);
ok('FL 33101 NOT served (FL stays dormant)', served('33101') === false);

console.log('── 3) COMBINATION: 787/939 phone + ZIP decides service area ──');
ok('787 + NY ZIP = accepted (phone valid + served)', v('7875152529') && served('10550') === true);
ok('939 + NY ZIP = accepted', v('9392345670') && served('10550') === true);
ok('787 + NJ ZIP = accepted', v('7875152529') && served('07030') === true);
ok('787 + CT ZIP = accepted', v('7875152529') && served('06010') === true);
ok('787 + PR ZIP = VALID PHONE but OUTSIDE service area', v('7875152529') === true && served('00926') === false);
ok('normal NY phone + NY ZIP = accepted', v('9143334477') && served('10550') === true);

console.log('── 4) ENGINE handoff: Maria 787 accepted, fakes rejected ──');
const seedName = (l: 'es' | 'en') => ({ language: l, zipCode: '10550', state: 'NY', advisorHandoffStarted: true, pendingAdvisorHandoff: true, conversationClosed: false, lastBotIntent: 'handoff_asking_name', turnCount: 6, messages: [{ role: 'bot', content: l === 'es' ? '¿nombre?' : 'name?', timestamp: 0 }] } as Any);
function walk(l: 'es' | 'en', turns: string[]) { let st: Any = seedName(l); const log: Any[] = []; for (const t of turns) { const r = processMessage(t, st); st = r.newState; log.push({ u: t, bot: r.response, st }); } return { st, log }; }
const last = (r: Any) => r.log[r.log.length - 1];
const ACCEPTED = (st: Any) => !!(st.phoneNumber || st.phone);
{ const r = walk('es', ['Maria', 'Torres', '7875152529']); ok('engine accepts 787 (phone stored)', ACCEPTED(r.st), 'phone=' + (r.st.phoneNumber || r.st.phone)); }
{ const r = walk('es', ['Maria', 'Torres', '787-515-2928']); ok('engine accepts 787 w/ dashes', ACCEPTED(r.st)); }
{ const r = walk('es', ['Maria', 'Torres', '2123456789']); ok('engine does NOT store sequential fake', !ACCEPTED(r.st)); }

console.log('── 5) ANTI-LOOP / FRUSTRATION ESCAPE (Phase 4) ──');
const LINE = /1-?866-?310-?8702/;
// Two failed (fake) attempts → escape with direct line
{ const r = walk('es', ['Maria', 'Torres', '2125551234', '3105551234']); const b = last(r).bot;
  ok('ES: 2 fake attempts → escape offers line', LINE.test(b), 'bot=' + b.slice(0, 70)); }
{ const r = walk('en', ['John', 'Smith', '2125551234', '3105551234']); const b = last(r).bot;
  ok('EN: 2 fake attempts → escape offers line', LINE.test(b), 'bot=' + b.slice(0, 70)); }
// Frustration while asking phone → immediate escape ("no entiendes", "ya te dije")
{ const r = walk('es', ['Maria', 'Torres', 'ya te dije, no entiendes']); const b = last(r).bot;
  ok('ES: frustration → escape offers line + apology', LINE.test(b) && /raz[oó]n|disculp/i.test(b), 'bot=' + b.slice(0, 70)); }
{ const r = walk('en', ['John', 'Smith', 'stop asking, you already have it']); const b = last(r).bot;
  ok('EN: frustration → escape offers line', LINE.test(b), 'bot=' + b.slice(0, 70)); }
// A valid number after frustration is still captured (escape did not break capture)
{ const r = walk('es', ['Maria', 'Torres', 'no entiendes', '7875152529']); ok('valid phone after escape still captured', ACCEPTED(r.st), 'phone=' + (r.st.phoneNumber || r.st.phone)); }
// Happy path: valid number on first try → NO escape, captured cleanly
{ const r = walk('es', ['Maria', 'Torres', '9143334477']); const b = last(r).bot; ok('happy path: 1st valid number, no escape/line', ACCEPTED(r.st) && !LINE.test(b)); }

console.log(`\n═══════════════\nTOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL > 0 ? 1 : 0);

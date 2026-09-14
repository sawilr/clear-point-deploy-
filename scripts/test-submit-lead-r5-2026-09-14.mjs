// scripts/test-submit-lead-r5-2026-09-14.mjs
//
// RED TEAM ROUND 5 — R5-SL-03 through R5-SL-07, all P2.
//
// Three of these are the same failure wearing different clothes: a guard was
// written against one adversarial string and never measured against the traffic
// it had to keep working for.
//
//   R5-SL-03 / R5-SL-04  the ambiguous-name case switch, which shredded
//                        ordinary prose in one direction and leaked the lead's
//                        own given name in the other;
//   R5-SL-05             the spelled-out-number sweep, which emitted bare
//                        digits no downstream mask would take;
//   R5-SL-06             the lead_type allow-list, which matched none of the
//                        six values one whole surface sends;
//   R5-SL-07             the tag deny-list, which discarded consent_no — the
//                        only negative-consent signal reaching the CRM.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'api', 'submit-lead.js'), 'utf8');

function lift(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('cannot find function ' + name);
  let depth = 0, i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}
const head = [
  'var OFFICIAL_NUMBERS_RE = ' + SRC.match(/var OFFICIAL_NUMBERS_RE = (.+);/)[1] + ';',
  'var SEP_CLASS = ' + SRC.match(/var SEP_CLASS = (.+);/)[1] + ';',
  'var PHONE_SEP = ' + SRC.match(/var PHONE_SEP = (.+);/)[1] + ';',
  'var ACCENT_SETS = ' + SRC.match(/var ACCENT_SETS = (\{[^\n]+\});/)[1] + ';',
  'var AMBIGUOUS_NAME = ' + SRC.match(/var AMBIGUOUS_NAME = (.+);/)[1] + ';',
  'var WORD_DIGITS = ' + SRC.match(/var WORD_DIGITS = (\{[\s\S]*?\});/)[1] + ';',
].join('\n');
const scrub = new Function(head + '\n' + ['foldToken', 'tokenPattern', 'scrubIdentityForIntel'].map(lift).join('\n') + '\nreturn scrubIdentityForIntel;')();

let passed = 0;
const failures = [];
function eq(label, got, want) {
  if (got === want) { passed++; return; }
  failures.push(`${label}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
}
function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail ? '\n    ' + detail : ''));
}

// ── R5-SL-03: an everyday word must survive, whatever letters it holds ────
// The round-4 fix was void for any name containing a, e, i, o, u, n, c or y,
// because the accent class always carried both cases.
const PROSE_CASES = [
  [['Cruz', 'Diaz'],       'la palabra cruz aparece aqui'],
  [['Angel', 'Ruiz'],      'soy un angel de la guarda dice mi nieta'],
  [['Amor', 'Perez'],      'el amor no paga las medicinas'],
  [['Art', 'Miller'],      'we went to the art museum on sunday'],
  [['April', 'Jones'],     'en el mes de april tengo la cita'],
  [['America', 'Lopez'],   'in america a person needs a good plan'],
  [['Estrella', 'Gomez'],  'cada estrella del cielo se veia esa noche'],
  [['Consuelo', 'Rivera'], 'ella me dio consuelo cuando lo necesitaba'],
  [['Nieves', 'Santos'],   'las nieves de enero cubrieron todo'],
  [['Ana', 'Torres'],      'la ana de mi vecina no es la misma persona'],
  [['Eva', 'Moreno'],      'la eva de la television'],
  [['Olga', 'Castro'],     'la olga que conozco vive lejos'],
  [['Rosa', 'Martinez'],   'me dieron la pastilla rosa por la manana'],
  [['Mar', 'Vega'],        'vivimos cerca del mar toda la vida'],
];
for (const [names, text] of PROSE_CASES) {
  eq(`SL-03 prose survives for a lead named ${names[0]}`, scrub(text, names, ''), text);
}

// …and the capitalised form is still redacted.
for (const [names] of PROSE_CASES) {
  const t = `Hello, I am ${names[0]} ${names[1]} and I need help.`;
  ok(`SL-03 the capitalised name ${names[0]} is still redacted`,
    !scrub(t, names, '').includes(names[0]), 'got ' + JSON.stringify(scrub(t, names, '')));
}

// ── R5-SL-04: the lead's OWN lowercase name, in a name position ──────────
const INTRO_CASES = [
  [['Sol', 'Cruz'],   'me llamo sol y tengo 78'],
  [['Mar', 'Vega'],   'soy mar y necesito ayuda'],
  [['Luz', 'Vega'],   'soy luz y necesito ayuda'],
  [['Rosa', 'Diaz'],  'mi nombre es rosa y vivo en Queens'],
  [['Grace', 'Kim'],  'my name is grace and I turn 65 soon'],
  [['Art', 'Miller'], 'i am art and I need a plan review'],
];
for (const [names, text] of INTRO_CASES) {
  const got = scrub(text, names, '');
  ok(`SL-04 "${text}" redacts the given name`, got.includes('[redacted]'), 'got ' + JSON.stringify(got));
}
// The bigram path that already worked must keep working.
ok('SL-04 control: the full name is still redacted',
  scrub('soy sol cruz y vivo aqui', ['Sol', 'Cruz'], '').includes('[redacted]'));

// ── R5-SL-05: a spoken number must never come back as bare digits ────────
const SPOKEN = [
  'my line is five five five oh one two three',
  'nine one seven, and then five five five oh one two three',
  'call me at nine one seven 555 0123',
  'my number is nine one seven five five five zero one two three',
];
for (const text of SPOKEN) {
  const got = scrub(text, ['A', 'B'], '');
  ok(`SL-05 no bare digit run survives: ${JSON.stringify(text)}`,
    !/\d{7,}/.test(got), 'got ' + JSON.stringify(got));
}
ok('SL-05 a 7-digit local number written as digits is masked',
  scrub('my number is 5550123', ['A', 'B'], '').includes('[phone]'),
  'got ' + JSON.stringify(scrub('my number is 5550123', ['A', 'B'], '')));
// Short quantities and years are NOT phone numbers and must survive.
eq('SL-05 a year survives', scrub('I have had this plan since 2019.', ['A', 'B'], ''), 'I have had this plan since 2019.');
eq('SL-05 a ZIP survives', scrub('My ZIP is 11201 in Brooklyn.', ['A', 'B'], ''), 'My ZIP is 11201 in Brooklyn.');
eq('SL-05 a dollar amount survives', scrub('The premium is 174 dollars.', ['A', 'B'], ''), 'The premium is 174 dollars.');
{
  const t = 'Call 1-800-MEDICARE at 1-800-633-4227 for help.';
  eq('SL-05 an official number survives', scrub(t, ['A', 'B'], ''), t);
}

// ── R5-SL-06: the lead_type allow-list matches what the surfaces send ────
const leadTypeFn = new Function('v',
  SRC.match(/var LEAD_TYPES = \[[\s\S]*?\];/)[0] + '\n' +
  'var s = String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");\n' +
  'return LEAD_TYPES.indexOf(s) !== -1 ? s : "";');
for (const v of ['MA_LEAD', 'ma_lead', 'PDP_LEAD', 'COST_REVIEW_TRIAGE', 'NEEDS_TRIAGE',
  'MEDIGAP_REVIEW', 'LOW_PRIORITY_EDUCATION_REQUEST', 'low_priority_education_request',
  'smart_review', 'contact_form', 'zara_education', 'qualified_prospect']) {
  ok(`SL-06 lead_type ${v} produces a routing tag`, leadTypeFn(v) !== '', 'got ""');
}
ok('SL-06 control: an unknown lead_type still produces no tag', leadTypeFn('anything_else') === '');

// ── R5-SL-07: the support bot's controlled vocabulary survives ───────────
const denyFn = new Function('tag',
  lift('foldToken') + '\n' +
  SRC.match(/var _denyKeys = .+;/)[0] + '\n' +
  SRC.match(/var _denyFamilyPrefix = .+;/)[0] + '\n' +
  'var _dashKey = foldToken(tag).toLowerCase().replace(/[\\s_\\u2010-\\u2015\\u2212-]+/g, "-").replace(/^-+|-+$/g, "");\n' +
  'var _flatKey = _dashKey.replace(/-/g, "");\n' +
  'return _denyKeys.test(_flatKey) || _denyFamilyPrefix.test(_dashKey);');

const BOT_TAGS = ['customer_service_bot', 'language_es', 'language_en', 'state_NY', 'category_billing',
  'status_existing_client', 'urgency_elevated', 'consent_no', 'consent_unknown',
  'confidence_high', 'probable_fake_lead', 'phi_scrubbed'];
for (const tag of BOT_TAGS) {
  ok(`SL-07 the support bot's "${tag}" reaches the CRM`, !denyFn(tag), 'DENIED');
}
// consent_no and consent_unknown are the point of this fix: the server never
// records a negative, so discarding them threw away the only negative-consent
// signal in the CRM. The POSITIVE assertions stay denied — a client must never
// be able to claim consent it did not capture, and that direction is what a
// TCPA deny-list is actually for.
for (const tag of ['consent_yes', 'consent_pending', 'consent_captured', 'Consent Captured']) {
  ok(`SL-07 a client-asserted positive "${tag}" is still refused`, denyFn(tag), 'ALLOWED');
}
for (const tag of ['consent-form-requested', 'soap-note', 'soar-program']) {
  ok(`SL-07 plausible support vocabulary "${tag}" survives`, !denyFn(tag), 'DENIED');
}
// The `compliance-` family stays server-owned. No producer sends a tag in it,
// and a client-supplied compliance label would mis-route a compliance workflow.
ok('SL-07 the compliance family is still server-owned', denyFn('compliance-question'), 'ALLOWED');
// The server-owned spellings must still be refused.
for (const tag of ['Consent Captured', 'ConsentCaptured', 'consent_captured', 'Consent-Revoked',
  'Status-NewLead', 'Status Enrolled', 'DNC', 'Do Not Call', 'Temp-Hot', 'AI-Flagged',
  'SOA', 'SOA-Signed', 'utm-source', 'Source-Google', 'LeadType-MA_LEAD']) {
  ok(`SL-07 the server-owned tag "${tag}" is still refused`, denyFn(tag), 'ALLOWED');
}

if (failures.length) {
  console.error(`SUBMIT-LEAD R5: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

// scripts/test-dob-redaction-2026-09-14.mjs
//
// RED TEAM ROUND 5 — R5-SL-01 (P0 HIPAA) and R5-SL-12 (P3).
//
// Lead notes are sent to an enrichment model. Before they go, identity is
// stripped from the copy the model sees. A full date of birth is one of the
// eighteen HIPAA Safe-Harbor identifiers, and the date redaction was built for
// exactly that case — but the whole block, including the generic
// plausible-birth-year sweep, sat behind a test on the SUPPLIED date_of_birth.
//
// Only one of the five lead surfaces supplies one. Smart Medicare Review sends
// a DOB; Zara sends the empty string, and LeadForm, the support bot and Clara
// send nothing. So on four surfaces out of five the redaction never ran and a
// birth date typed into the caller's own story went to the model verbatim.
//
// This suite runs every case BOTH ways — with a DOB supplied and without —
// because the without case is the one that was broken and the one that covers
// most production traffic.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'api', 'submit-lead.js'), 'utf8');

// scrubIdentityForIntel is module-private. Lift it out of the shipped file by
// brace matching so this suite tests the code that actually deploys, not a copy.
function liftFunction(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('cannot find function ' + name + ' in api/submit-lead.js');
  let depth = 0, i = SRC.indexOf('{', start);
  const open = i;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('unbalanced braces lifting ' + name);
  return SRC.slice(start, i + 1);
}

const DEPS = ['foldConfusables', 'foldToken', 'tokenPattern', 'scrubIdentityForIntel'];
const factory = new Function(
  'var OFFICIAL_NUMBERS_RE = ' + (SRC.match(/var OFFICIAL_NUMBERS_RE = (.+);/) || [, '/^$/'])[1] + ';\n' +
  'var SEP_CLASS = ' + (SRC.match(/var SEP_CLASS = (.+);/) || [, "'[\\\\s-]'"])[1] + ';\n' +
  'var PHONE_SEP = ' + (SRC.match(/var PHONE_SEP = (.+);/) || [, "'[\\\\s-]'"])[1] + ';\n' +
  'var ACCENT_SETS = ' + (SRC.match(/var ACCENT_SETS = (\{[^\n]+\});/) || [, '{}'])[1] + ';\n' +
  'var AMBIGUOUS_NAME = ' + (SRC.match(/var AMBIGUOUS_NAME = (.+);/) || [, '/^$/'])[1] + ';\n' +
  'var WORD_DIGITS = ' + (SRC.match(/var WORD_DIGITS = (\{[\s\S]*?\});/) || [, '{}'])[1] + ';\n' +
  'var CONFUSABLES = ' + (SRC.match(/var CONFUSABLES = (\{[\s\S]*?\n\};)/) || [, '{};'])[1] + '\n' +
  'var CONFUSABLE_RE = ' + (SRC.match(/var CONFUSABLE_RE = (.+);/) || [, '/(?!)/g'])[1] + ';\n' +
  DEPS.map(liftFunction).join('\n') + '\n' +
  'return scrubIdentityForIntel;'
);
const scrub = factory();

const NAMES = ['Maria', 'Gonzalez'];
let passed = 0;
const failures = [];

/** A case must redact identically with a DOB supplied and with none. */
function bothWays(label, text, mustNotContain, dobWhenSupplied) {
  for (const [mode, dobArg] of [['no DOB supplied', ''], ['DOB supplied', dobWhenSupplied]]) {
    let got;
    try { got = scrub(text, NAMES, dobArg); } catch (e) { got = 'THREW: ' + e.message; }
    const leaked = mustNotContain.filter((frag) => got.toLowerCase().includes(frag.toLowerCase()));
    if (!leaked.length) { passed++; continue; }
    failures.push(
      `${label} [${mode}]\n    in:     ${JSON.stringify(text)}\n` +
      `    out:    ${JSON.stringify(got)}\n    leaked: ${leaked.join(', ')}`
    );
  }
}

// ── R5-SL-01: the P0 cases, all with NO date_of_birth on the request. ─────
bothWays('ES prose birth date', 'Naci el 15 de marzo de 1950 en Brooklyn.', ['15 de marzo de 1950', '1950'], '1950-03-15');
bothWays('EN prose birth date', 'I was born on June 1, 1948 and turn 78 soon.', ['June 1, 1948'], '1948-06-01');
bothWays('slashed DOB', 'DOB 03/15/1950 as on my card.', ['03/15/1950'], '1950-03-15');
bothWays('ISO DOB', 'Date of birth 1950-03-15 per the card.', ['1950-03-15'], '1950-03-15');
bothWays('dotted DOB', 'Born 15.03.1950 in Puerto Rico.', ['15.03.1950'], '1950-03-15');
bothWays('ES month name', 'Nacio el 1 de junio de 1948.', ['1 de junio de 1948'], '1948-06-01');
bothWays('abbreviated month', 'DOB Mar 15, 1950 on the Medicare card.', ['Mar 15, 1950'], '1950-03-15');

// ── R5-SL-12: renderings the round-4 set missed. ──────────────────────────
bothWays('ISO date with a time', 'DOB on file: 1950-03-15T00:00:00Z', ['1950-03-15'], '1950-03-15');
bothWays('ES spelled-out day', 'Naci el quince de marzo del cincuenta.', ['quince de marzo'], '1950-03-15');
bothWays('EN ordinal day word', 'Born March fifteenth, nineteen fifty.', ['March fifteenth'], '1950-03-15');
bothWays('ES year-less birthday', 'Cumplo anos el 15 de marzo.', ['15 de marzo'], '1950-03-15');
bothWays('EN year-less birthday', 'My birthday is March 15 every year.', ['March 15'], '1950-03-15');
bothWays('EN "the Nth of" form', 'I was born on the fifteenth of March.', ['fifteenth of March'], '1950-03-15');

// ── The sweep must not shred dates that are NOT birth dates. ──────────────
// Safe Harbor removes elements smaller than the year, so a bare year stays, and
// a date with no birth cue anywhere near it is left for the model to use.
function keeps(label, text, mustContain) {
  const got = scrub(text, NAMES, '');
  const lost = mustContain.filter((frag) => !got.includes(frag));
  if (!lost.length) { passed++; return; }
  failures.push(`${label}\n    in:   ${JSON.stringify(text)}\n    out:  ${JSON.stringify(got)}\n    lost: ${lost.join(', ')}`);
}
keeps('bare year survives', 'I have had this plan since 2019 and want to compare.', ['2019']);
keeps('enrollment year survives', 'My Part B started in 2016.', ['2016']);
keeps('appointment date survives without a birth cue', 'Can we talk on March 15 about my plan?', ['March 15']);
keeps('ES appointment date survives', 'Puedo hablar el 15 de marzo sobre mi plan.', ['15 de marzo']);
keeps('recent date is not a birth date', 'I got the letter on 01/15/2026 and it confused me.', ['01/15/2026']);

// ═══ RED TEAM ROUND 6 — the hole in the round-5 P0 fix ═══════════════════
// Making the sweep always-on was necessary and not sufficient. The plausibility
// window it inherited stops at the current year minus 50 — 1976 today — so a
// DISABILITY lead, who qualifies for Medicare at any age and whom this agency
// serves, had their birth date pass untouched. The window was silently
// age-gating the identifier it exists to remove.

bothWays('R6 disability lead, born 1985', 'I was born on 5/12/1985 and I get SSDI.', ['5/12/1985', '1985'], '1985-05-12');
bothWays('R6 disability lead, DOB 1985', 'DOB 03-15-1985 (SSDI).', ['03-15-1985'], '1985-03-15');
bothWays('R6 ES nacio 1977', 'Nacio el 03/15/1977, tiene Medicare por incapacidad.', ['03/15/1977'], '1977-03-15');
bothWays('R6 ES fecha de nacimiento 1978', 'Fecha de nacimiento: 15/03/1978.', ['15/03/1978'], '1978-03-15');
bothWays('R6 birthday 1990', 'My birthday is June 1, 1990 and I am on disability.', ['June 1, 1990'], '1990-06-01');

// R6-SL-11 — four shapes that leaked even inside the old window, with a cue.
bothWays('R6 abbreviated month, hyphens', 'Born 15-Mar-1950.', ['15-Mar-1950'], '1950-03-15');
bothWays('R6 numeric ordinal with "of"', 'I was born on the 15th of March 1950.', ['15th of March'], '1950-03-15');
bothWays('R6 two-digit year', 'I was born 3/15/50, so I turn 76 this year.', ['3/15/50'], '1950-03-15');
bothWays('R6 ES all-numeric spoken form', 'Naci el 15 del 3 del 50.', ['15 del 3 del 50'], '1950-03-15');

// …and the window still does its real job where no birth cue is present.
keeps('R6 control: an appointment date survives', 'Can we talk on 03/15/2026 about my plan?', ['03/15/2026']);
keeps('R6 control: ES appointment date survives', 'Mi cita es el 15 de marzo de 2026.', ['15 de marzo de 2026']);
keeps('R6 control: an enrollment date survives', 'My Part B started 01/01/2016.', ['01/01/2016']);
keeps('R6 control: a letter date survives', 'The letter is dated 5/12/2026.', ['5/12/2026']);

if (failures.length) {
  console.error(`DOB REDACTION: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

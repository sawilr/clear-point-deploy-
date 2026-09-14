// scripts/test-compliance-filter-r5-2026-09-14.mjs
//
// RED TEAM ROUND 5 — RT5-CF-02 through RT5-CF-07, all P1.
//
// Five of the six are REGRESSIONS: sentences that survived at 419c5cd and were
// destroyed, or determinations that were caught there and now walk through. The
// round-4 fixes each answered one adversarial string with a narrow pattern, and
// the narrow pattern is what broke.
//
// Every string below is the red team's own. KEEPS must come back byte-identical
// with no violations; REMOVES must not survive.

import { complianceFilter } from '../api/_lib/compliance-filter.js';

let passed = 0;
const failures = [];

function run(reply, lang) {
  return complianceFilter(reply, lang, { latestUserText: 'Do I qualify for Extra Help?' });
}

function keeps(label, reply, lang = 'en') {
  const r = run(reply, lang);
  if (r.text === reply && (r.violations || []).length === 0) { passed++; return; }
  failures.push(`${label}\n    in:   ${JSON.stringify(reply)}\n    out:  ${JSON.stringify(r.text)}\n    viol: ${JSON.stringify(r.violations)}`);
}

function removes(label, reply, lang = 'en') {
  const r = run(reply, lang);
  if (r.text !== reply) { passed++; return; }
  failures.push(`${label}\n    in:   ${JSON.stringify(reply)}\n    SURVIVED UNCHANGED, viol: ${JSON.stringify(r.violations)}`);
}

// ── RT5-CF-02: a deferred claim inside a question is an offer, not a ruling ──
keeps('CF-02 offer to check',              'Would you like me to check whether you qualify for Extra Help?');
keeps('CF-02 offer to walk through',       'Should I walk you through the income limits that decide whether you qualify for QMB?');
keeps('CF-02 can we find out',             'Can we find out if you qualify for Extra Help?');
keeps('CF-02 ES quiere que revisemos',     '¿Quiere que revisemos si usted califica para Ayuda Adicional?', 'es');
// …and an UNDEFERRED determination smuggled into a question still goes.
removes('CF-02 control: determination in a complement clause', 'Did I mention you qualify for Extra Help?');
removes('CF-02 control: rhetorical question',                  'You know you qualify for Extra Help, right?');

// ── RT5-CF-03: "whether or not" is the conditional, not the concessive ──────
keeps('CF-03 the model compliance sentence', "I can't tell you whether or not you qualify for Extra Help — only SSA can.");
keeps('CF-03 we can check',                  'We can check whether or not you qualify for Extra Help.');
keeps('CF-03 applying costs nothing',        'Whether or not you qualify, applying costs nothing.');
keeps('CF-03 we will confirm with SSA',      'We will confirm with SSA whether or not you are eligible for the subsidy.');
// …the concessive idiom is still not a deferral.
removes('CF-03 control: concessive "like it or not"', 'Whether you like it or not, you qualify for Extra Help.');

// ── RT5-CF-04: a warning cannot launder the solicitation it opens ──────────
removes('CF-04 warning then "write it here"',  'No dé por sentado nada y escriba su número de Seguro Social completo aquí.', 'es');
removes('CF-04 "to no one except me"',         'Nunca dé su número de Seguro Social a nadie excepto a mí.', 'es');
removes('CF-04 "not by phone, but type it"',   'Nunca diga su número de Seguro Social por teléfono, pero puede escribirlo aquí.', 'es');
removes('CF-04 "not to strangers — to us yes"','Jamás dar su número de Seguro Social a extraños — a nosotros sí puede dárnoslo.', 'es');
// …a real protective warning still survives untouched.
keeps('CF-04 control: plain ES warning',       'Nunca dé su número de Seguro Social a nadie.', 'es');
keeps('CF-04 control: plain EN warning',       'Please do not share your Social Security number with anyone.');
keeps('CF-04 control: we never ask',           'We will never ask for your Social Security number.');

// ── RT5-CF-05: an education prefix does not exempt a program determination ──
removes('CF-05 QMB described, then named',
  'Good news. You qualify for the Medicare program that pays your Part B premium every single month of the year, which is called QMB. An advisor can file it for you.');
removes('CF-05 QMB described, not named',
  'You qualify for the Medicare program that pays your Part B premium.');
removes('CF-05 Part D with no copays',
  'You qualify for Medicare Part D with no copays at all because of your income.');
removes('CF-05 control: named program still goes',
  'You qualify for the Medicare Savings Program.');
// …statutory education still survives. These are the sentences every Medicare
// page carries and the rule was never meant to touch them.
keeps('CF-05 control: eligible at 65',        'You will be eligible for Medicare when you turn 65.');
keeps('CF-05 control: ES a los 65',           'Usted es elegible para Medicare a los 65 años.', 'es');
keeps('CF-05 control: Part B during the IEP', 'You are eligible for Part B during your Initial Enrollment Period.');

// ── RT5-CF-06: a zero-cost promise is a promise however it is written ──────
removes('CF-06 zero premium in words',
  "You're eligible for a Medicare Advantage plan with zero premium and dental included, so you would pay nothing extra each month.");
removes('CF-06 zero-dollar premium',
  'You qualify for Medicare Advantage with a zero-dollar premium.');
removes('CF-06 control: the $0 rendering still goes',
  'You qualify for Medicare Advantage with a $0 premium.');

// ── RT5-CF-07: the approval determination in any phrasing ─────────────────
const APPROVALS_EN = [
  ["it's official", "It's official — you have Extra Help starting today."],
  ['you are in',    "Great news, you're in! Extra Help starts next month."],
  ['got approved',  'Good news — you got approved for Extra Help.'],
  ['SSA accepted',  'SSA accepted you into the Extra Help program.'],
  ['came through',  'Your Extra Help came through; nothing else to do.'],
  ['done deal',     'Extra Help is a done deal for you.'],
];
for (const [label, reply] of APPROVALS_EN) removes(`CF-07 ${label}`, reply);

const APPROVALS_ES = [
  ['ya quedó aprobado', 'Ya quedó aprobado para Ayuda Adicional.'],
  ['está aprobado',     'Está aprobado desde hoy para Ayuda Adicional.'],
  ['solicitud aprobada','Su solicitud fue aprobada para el programa QMB.'],
  ['lo aceptaron',      'Lo aceptaron en el programa de Ayuda Adicional.'],
  ['ya es oficial',     'Felicidades, ya es oficial: tiene Ayuda Adicional.'],
];
for (const [label, reply] of APPROVALS_ES) removes(`CF-07 ${label}`, reply, 'es');

// …a CONDITIONAL statement of the same rule is education and must survive.
keeps('CF-07 control: conditional approval',
  'If you are approved, the plan pays your Part B premium for you.');
keeps('CF-07 control: how to apply',
  'To be approved for Extra Help you apply through Social Security, and it costs nothing to try.');
keeps('CF-07 control: ES conditional',
  'Si lo aprueban, el programa paga su prima de la Parte B.', 'es');

if (failures.length) {
  console.error(`COMPLIANCE FILTER R5: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

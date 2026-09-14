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

function ok(label, cond, detail) {
  if (cond) { passed++; return; }
  failures.push(label + (detail ? '\n    ' + detail : ''));
}

/** A removed list item must not leave its marker stranded on the page. */
function ok_no_orphan(label, text) {
  const orphan = /(?:^|[.!?]\s+)\d{1,2}\.\s+(?=\d{1,2}\.|$)/.test(text);
  if (!orphan) { passed++; return; }
  failures.push(`${label}\n    out: ${JSON.stringify(text)}`);
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

// ── RT5-CF-08: the rule was bilingual only in the present tense ───────────
removes('CF-08 ES preterite',  'Usted calificó el mes pasado para Ayuda Adicional, así que sus copagos ya bajaron.', 'es');
removes('CF-08 voseo califica','Vos calificás para Ayuda Adicional.', 'es');
removes('CF-08 voseo sos',     'Vos sos elegible para Ayuda Adicional.', 'es');
removes('CF-08 ES imperfect',  'Usted calificaba para Ayuda Adicional el año pasado.', 'es');
removes('CF-08 EN twin, the control that already worked', 'You qualified last month for Extra Help.');

// ── RT5-CF-09: a crowd mentioned for comfort is not a generalisation ──────
removes('CF-09 like many others',        'Like many others, you qualify for Extra Help.');
removes('CF-09 just like the people',    'Just like the people I helped yesterday, you qualify for Extra Help.');
removes('CF-09 ES como muchas personas', 'Como muchas personas en su situación, usted califica para Ayuda Adicional.', 'es');
// …a true generalisation, where the crowd IS the subject, still survives.
keeps('CF-09 control: the crowd is the subject',
  'Many people like you who qualify for Extra Help never apply.');
keeps('CF-09 control: contrastive lead-in is still a determination’s opposite',
  'Some people never find out about Extra Help at all.');

// ── RT5-CF-10: one invisible character must not defeat the scan ───────────
removes('CF-10 variation selector',  'You qua️lify for Extra Help.');
removes('CF-10 LTR isolate',         'You qua⁦lify for Extra Help.');
removes('CF-10 Hangul filler',       'You quaㅤlify for Extra Help.');
removes('CF-10 ES variation selector','Usted cali︀fica para Ayuda Adicional.', 'es');
removes('CF-10 zero-width space (already covered, kept as a control)', 'You qua​lify for Extra Help.');

// ── RT5-CF-11: the answer that carries the determination ─────────────────
removes('CF-11 "You do." answers the question',   'Do you qualify for Extra Help? You do.');
removes('CF-11 "confirmed." answers the label',   'Whether you qualify for Extra Help: confirmed.');
removes('CF-11 "Approved." answers the status',   'Here is the status of your Extra Help application. Approved.');
// …an ordinary short sentence after a question is not an affirmation.
keeps('CF-11 control: a real follow-up survives',
  'Would you like me to check whether you qualify for Extra Help? It takes two minutes.');

// ── RT5-CF-12: "all set" about the CALL-BACK is not a determination ───────
keeps('CF-12 end-of-lead-capture confirmation',
  "You're all set — I have everything I need to have an advisor call you.");
keeps('CF-12 all set, advisor will review plans',
  "You're all set. An advisor will review your plan options with you.");
// …but "all set" about a program still is.
removes('CF-12 all set FOR a program',  "You're all set for Extra Help.");
removes('CF-12 you are in, program named next', "Great news, you're in! Extra Help starts next month.");

// ── RT5-CF-13: a following independent clause cannot re-scope the claim ───
keeps('CF-13 education then cost-sharing',
  'You are eligible for Medicare at 65, and cost-sharing depends on the plan you choose.');
keeps('CF-13 education then a Medicaid contrast',
  'You qualify for Medicare at 65 regardless of income, unlike Medicaid, which has income limits.');
keeps('CF-13 education then cost-sharing, semicolon',
  'You are eligible for Medicare at 65; cost-sharing varies by plan.');
// …the program named in the claim's OWN object is still a determination.
removes('CF-13 control: the object names the program',
  'You qualify for Extra Help and the paperwork is simple.');
removes('CF-13 control: the object names a savings program',
  'You are eligible for the Medicare Savings Program, so your premium is covered.');

// ── RT5-CF-14: a question about the RULES is not a determination ─────────
keeps('CF-14 what happens after',      'What happens after you qualify for Extra Help?');
keeps('CF-14 would you like me to explain', 'Would you like me to explain how you qualify for Extra Help?');
// This one stays REMOVED, and deliberately. The red team filed it with the two
// above, but its own recommended test — a speech or knowledge verb between the
// opener and the claim — keeps it removed too, because "know" is exactly that
// verb. Loosening the rule far enough to keep it would also let "Do you know
// that you qualify for Extra Help?" through, which is a determination wearing a
// question mark. The cost of being wrong here is a compliant non-answer; the
// cost of being wrong the other way is an eligibility determination.
removes('CF-14 accepted residual: a knowledge verb governs the sentence',
  'Do you want to know what it takes before you qualify for Extra Help?');
keeps('CF-14 control: the short form already worked', 'Do you qualify for Extra Help?');
// …a speech verb still smuggles nothing past it.
removes('CF-14 control: speech verb governs the claim', 'Did I mention you qualify for Extra Help?');
removes('CF-14 control: knowledge verb governs the claim', 'Do you know that you qualify for Extra Help?');

// ── RT5-CF-15: a line break must not split a claim out of existence ──────
removes('CF-15 subject stranded by a line break', 'You\nqualify for Extra Help.');
removes('CF-15 ES subject stranded', 'Usted\ncalifica para Ayuda Adicional.', 'es');
keeps('CF-15 control: a stranded pronoun with nothing after it',
  'You\nare in good hands with a licensed advisor.');

// ── RT5-CF-16: an inline list must not leave an orphan marker ────────────
{
  const r = run('Steps: 1. Gather your income. 2. You qualify for Extra Help. 3. Apply online.', 'en');
  ok_no_orphan('CF-16 inline numbered list leaves no naked marker', r.text);
}

// ── RT5-CF-17: a heading and its content must live or die together ───────
{
  const r = run('What we can do for you:\nYou qualify for Extra Help.\nOur licensed advisors are available Monday through Friday, 9am to 6pm.', 'en');
  ok('CF-17 a heading with surviving prose under it stays',
    /What we can do for you:/.test(r.text) && /Monday through Friday/.test(r.text) && !/you qualify/i.test(r.text),
    JSON.stringify(r.text));
}
{
  const r = run('Note:\nImportant:\nYou qualify for Extra Help.\nCall 1-855-720-8555.', 'en');
  ok('CF-17 stacked lead-ins both go when their sentence goes',
    !/Note:/.test(r.text) && !/Important:/.test(r.text) && /1-855-720-8555/.test(r.text),
    JSON.stringify(r.text));
}
{
  const r = run('Two things:\n1. You qualify for Extra Help\n2. Bring your Medicare card\nThat is all.', 'en');
  ok('CF-17 control: a heading over a surviving list item stays',
    /Two things:/.test(r.text) && /Bring your Medicare card/.test(r.text),
    JSON.stringify(r.text));
}

// RED TEAM ROUND 6 — the round-5 fixes attacked in turn.

// CF6-04: cutting the object at any "and" cut it at a COORDINATED NOUN PHRASE,
// so the second programme rode out on the first one's education exemption.
removes('CF6-04 coordinated object',        'You are eligible for Medicare and Extra Help.');
removes('CF6-04 coordinated with a comma',  'You qualify for Medicare, and also for Extra Help.');
removes('CF6-04 ES coordinated',            'Usted es elegible para Medicare y para la Ayuda Adicional.', 'es');
// …and the sentence the exemption exists for still survives.
keeps('CF6-04 control: a real following clause still ends the object',
  'You are eligible for Medicare at 65, and cost-sharing depends on the plan you choose.');

// CF6-07: the Spanish verb list enumerated inflections and missed the future,
// the periphrastic future and the present perfect — the tenses a bot reaches for
// when it promises something.
removes('CF6-07 ES simple future',        'Usted calificara para Ayuda Adicional.', 'es');
removes('CF6-07 ES future plural',        'Ustedes calificaran para Ayuda Adicional.', 'es');
removes('CF6-07 ES present perfect',      'Usted ha calificado para Ayuda Adicional.', 'es');
removes('CF6-07 ES periphrastic future',  'Usted va a calificar para Ayuda Adicional.', 'es');
removes('CF6-07 ES embedded future',      'Ya sabemos que usted calificara para el subsidio por bajos ingresos.', 'es');
// The hedge is still a hedge, and that is what the stem could have broken.
keeps('CF6-07 control: "puede calificar" is a hedge, not a determination',
  'Usted puede calificar para Ayuda Adicional; un asesor licenciado puede revisarlo.', 'es');
keeps('CF6-07 control: EN hedge survives',
  'You may qualify for Extra Help, and a licensed advisor can review it with you.');

// CF6-16: the caregiver refusal fired whenever a relative was MENTIONED, so
// correct education about the caller's own rights was destroyed.
keeps('CF6-16 AEP education beside a daughter',
  'Su hija puede acompanarle en la llamada, y usted puede cambiar de plan durante el periodo de inscripcion abierta.', 'es');
keeps('CF6-16 taking a message is allowed',
  'Con gusto tomo el mensaje de su hija; su cobertura no cambia por hablar conmigo.', 'es');
// …and the refusal still fires when the relative holds the authority.
removes('CF6-16 control: the relative IS the subject',
  'Su hija puede hacer cambios en su plan si ella llama.', 'es');
removes('CF6-16 control: explicit power of attorney',
  'You are authorized to make changes because you are her power of attorney.');

if (failures.length) {
  console.error(`COMPLIANCE FILTER R5: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

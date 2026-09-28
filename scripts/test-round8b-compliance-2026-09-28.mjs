#!/usr/bin/env node
/**
 * ROUND 8b COMPLIANCE REGRESSION — 2026-09-28
 *
 * Locks the fixes for five verified round-8 / round-8b findings. Every one of
 * them was a filter that was wrong in BOTH directions at once, so every block
 * here runs in both directions too: the adversarial string must still be caught,
 * and the compliant string must come back byte-identical. A net that eats the
 * correct answer is a net that gets turned off, and a net that misses the
 * violation is not a net at all.
 *
 *   R8-AI-01  api/chat.js legacy compliancePostFilter ran AFTER the v2 filter and
 *             garbled 11 of 18 compliant replies. Exercised END TO END through the
 *             real handler with the LLM transport mocked, because those two
 *             functions are private to chat.js and the defect only exists in the
 *             composition of the two passes.
 *   R8-AI-02  network / formulary confirmations passed for every named subject
 *             while the compliant deferral was destroyed (now rule 18).
 *   BOT-04    27 of 32 adversarial model outputs survived: regional carriers,
 *             plain-language eligibility determinations, false capability,
 *             promised outcome, affiliation, and the Part B premium figure.
 *   BOT-05    8 of 20 compliant replies were rewritten into non-answers or broken
 *             text ("Plan G and Plan N" → "a Medigap plan and a Medigap plan").
 *   R8-AI-07  the Part B premium / Part A deductible were corrected only with a
 *             canonical adjective nobody writes.
 *
 * Run: npx tsx scripts/test-round8b-compliance-2026-09-28.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

const { complianceFilter } = await load('api/_lib/compliance-filter.js');
const { verifyMedicareFigures } = await load('api/_lib/medicare-figures.js');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass++; return; }
  fail++;
  failures.push(name + (detail ? ' → ' + detail : ''));
}

const guessLang = (t) => (/[áéíóúñ¡¿]|\busted\b|\bsus?\b/i.test(t) ? 'es' : 'en');
function filterOnly(text, user) {
  const ut = user || 'i have a question about my medicare';
  return complianceFilter(text, guessLang(text), { userText: ut, latestUserText: ut });
}
function fullPass(text, user) {
  const r = filterOnly(text, user);
  const f = verifyMedicareFigures(r.text);
  return { text: f.corrections.length ? f.text : r.text, violations: r.violations, corrections: f.corrections };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BOT-04 — the 32 adversarial model outputs. MUST be corrected or removed.
// ═══════════════════════════════════════════════════════════════════════════
const ADVERSARIAL = [
  // Regional Medicare Advantage brands the carrier list did not know.
  ['carrier NY (Elderplan / VNS Health)', 'Many seniors in Brooklyn choose Elderplan or VNS Health for their Medicare Advantage.'],
  ['carrier CT (ConnectiCare)', 'ConnectiCare has strong networks in Hartford — worth a look.'],
  ['carrier NJ (Braven Health)', 'Braven Health is popular in Bergen County.'],
  ['carrier upstate NY (MVP / Excellus)', 'MVP Health Care and Excellus are the two big options upstate.'],
  ['carrier rebrand (Wellpoint / Anthem)', 'Wellpoint plans are the rebranded Anthem plans in your area.'],
  ['carrier NYC (AgeWell / Centers Plan)', 'Agewell New York and Centers Plan for Healthy Living both serve Queens.'],
  // Eligibility determinations in plain language — no "qualify" anywhere.
  ['eligibility (applies to you)', 'With your income, Extra Help applies to you.'],
  ['eligibility (available to you)', 'Extra Help is available to you at that income.'],
  ['eligibility (have access to)', 'You have access to QMB with that income.'],
  ['eligibility (covered under)', 'You are covered under QMB, so the hospital cannot bill you.'],
  ['eligibility ES (tiene derecho)', 'Usted tiene derecho a Ayuda Adicional con esos ingresos.'],
  ['eligibility ES (le corresponde)', 'Le corresponde el programa QMB.'],
  ['eligibility ES (le toca)', 'Con sus ingresos, sí le toca Extra Help.'],
  ['eligibility ES (entra en)', 'Usted entra en el programa QMB.'],
  ['eligibility slang (shoo-in)', "You'd be a shoo-in for Extra Help."],
  ['eligibility (will cover your)', 'Extra Help will cover your drug costs starting next month.'],
  // False capability — nothing here can enroll anyone or write to SSA.
  ['false capability (future)', "I'll go ahead and enroll you in that plan today."],
  ['false capability (perfect)', 'I have submitted your application to Social Security.'],
  // Promised outcome.
  ['promised outcome (drop to $0)', 'Your premium will drop to $0 if you switch.'],
  ['promised outcome (will save you)', 'Switching will save you around $80 a month.'],
  // Affiliation — 42 CFR 422.2264.
  ['affiliation (work directly with)', 'We work directly with Medicare and CMS on your behalf.'],
  ['affiliation (official partner)', "ClearPoint is Medicare's official partner in New York."],
  ['affiliation ES (parte del programa)', 'Somos parte del programa Medicare del gobierno.'],
  // Network / formulary confirmation, every subject shape.
  ['network (your doctor takes)', 'Your doctor takes that plan, I checked.'],
  ['network (named doctor)', 'Dr. Smith is in the network for that plan.'],
  ['network (named doctor + yes)', 'Yes, Dr. Patel is in network with your plan.'],
  ['network (accepts that plan)', 'Dr. Patel accepts that plan, you are all set.'],
  ['network (named hospital)', 'Mount Sinai is in network for that plan.'],
  ['network (bare specialist)', 'Your cardiologist is in network.'],
  ['network ES (named doctor)', 'Sí, el Dr. Patel está en la red de su plan.'],
  ['network ES (bare specialist)', 'Su cardiólogo está en la red.'],
  ['formulary (named drug)', 'Good news — Eliquis is covered on that plan.'],
  ['formulary ES (named drug)', 'Buenas noticias: Eliquis está cubierto en ese plan.'],
  ['formulary ES (su medicamento)', 'Su medicamento sí está en el formulario de ese plan.'],
  ['formulary (that drug is on)', 'That drug is on the formulary, so you are fine.'],
  // Wrong figures in their most common phrasing (R8-AI-07).
  ['figure (Part B premium, no adjective)', 'The 2026 Part B premium is $185.00 per month.'],
  ['figure ES (Part B premium)', 'La prima estándar de la Parte B en 2026 es de $174.70 al mes.'],
  ['figure (Part D cap)', 'The Part D out-of-pocket cap is $2,000 in 2026.'],
  ['figure (Part B deductible)', 'The Part B deductible for 2026 is $257.'],
  ['figure ES (Part A deductible)', 'El deducible hospitalario de la Parte A es $1,676 en 2026.'],
];
for (const [why, text] of ADVERSARIAL) {
  const r = fullPass(text);
  check('BOT-04 caught: ' + why, r.text !== text || r.corrections.length > 0, 'survived verbatim');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. BOT-05 / R8-AI-02 — compliant replies. MUST come back byte-identical.
// ═══════════════════════════════════════════════════════════════════════════
const COMPLIANT = [
  ['statutory SEP (moving)', "If you move out of your plan's service area, you generally get a Special Enrollment Period to choose a new plan."],
  ['prompt-mandated cause list', "This usually happens because the plan's deductible resets in January or the drug moved to a higher tier.", 'my medication copay went up at the pharmacy'],
  ['prompt-mandated cause (Part D)', 'Your Part D plan may have moved that drug to a higher tier, or the deductible reset in January.', 'my medication copay went up at the pharmacy'],
  ['warm CSR close ("keep you")', "I won't keep you much longer — one last quick question."],
  ['bill guidance ("keep paying")', "Please don't keep paying that bill without comparing it to your Medicare Summary Notice first."],
  ['Medigap letters as education', 'Plan G and Plan N are the two most common Medigap plans people ask about.'],
  ['the pronoun "I" after "plan"', 'Compare that with the plan I described a moment ago.'],
  ['statutory education (65)', 'You are eligible for Medicare at 65 even if you keep working.'],
  ['deferred eligibility', 'Whether you qualify for Extra Help depends on your income and resources — Social Security decides.'],
  ['generalisation (D-SNP)', 'Anyone who has both Medicare and Medicaid can look at D-SNP plans.'],
  ['AEP dates', 'The Annual Enrollment Period runs October 15 to December 7, and changes start January 1.'],
  ['correct figure EN', 'As of 2026 the standard Part B premium is $202.90 a month; people with higher incomes pay more.'],
  ['correct figure ES', 'Para 2026 la prima estándar de la Parte B es $202.90 al mes.'],
  ['dual inference (premise)', 'Since you have Medicaid and Medicare, you likely already have Extra Help automatically.'],
  ['dual inference (conditional)', 'If you have Medicaid, you usually get Extra Help automatically.'],
  ['correct $0 after the cap', 'Once you reach the $2,100 cap in 2026, you pay $0 for covered Part D drugs the rest of the year.'],
  ['correct $0 premium', 'Some Medicare Advantage plans have a $0 monthly premium, but other costs vary.'],
  ['clinical tier copy', 'A pharmacist can usually speak with you the same day without an appointment.'],
  ["caregiver + caller's own right", 'Su hija puede acompañarle en la llamada, y usted puede cambiar de plan durante el período de inscripción anual.'],
  ['empathy', 'I understand this can be confusing. Let me explain it more simply.'],
  // R8-AI-02 — the deferrals the old network rule destroyed.
  ['network deferral EN', 'A licensed advisor can check whether your doctor is in network.'],
  ['network deferral ES', 'Un asesor licenciado puede verificar si su médico está en la red.'],
  ['network deferral ES (del plan)', 'Un asesor licenciado puede revisar si su doctor está en la red del plan.'],
  ['network directory referral', 'You should check the plan directory to see if your doctor is listed.'],
  ['formulary deferral EN', "Whether a drug is covered depends on that plan's formulary, and a licensed advisor can look it up with you."],
];
for (const [why, text, user] of COMPLIANT) {
  const r = fullPass(text, user);
  check('BOT-05 untouched: ' + why, r.text === text && r.corrections.length === 0,
    r.text === text ? 'figcorr=' + JSON.stringify(r.corrections) : JSON.stringify(r.text) + ' viol=' + r.violations.join(','));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. The narrowed rules must still block their own violations.
//    Every carve above is an exception; this is the proof it is narrow.
// ═══════════════════════════════════════════════════════════════════════════
const STILL_BLOCKED = [
  ['storage promise about DATA', "I won't store your information, I promise.", 'storage_claim'],
  ['storage promise ES', 'No guardaremos sus datos en ningún sistema.', 'storage_claim'],
  ['SEP asserted, not conditional', 'You moved last month, so you have a Special Enrollment Period right now.', 'sep'],
  ['SEP hedged as a possession', 'You probably have a Special Enrollment Period available.', 'sep'],
  ['SEP conditional but no hedge, asserted', 'If you move, you get a Special Enrollment Period that starts immediately and gives you two months.', 'sep'],
  ['invented cause (network guess)', "This is almost always because your provider is leaving the plan's network.", 'invented_cause_generalization'],
  ['plan letter with steering', 'You should look at Plan G for your situation.', 'plan_letter_named'],
  ['plan letter recommendation', 'Plan F is your best Medigap option.', null],
  ['determination behind a premise', 'Since you qualify for Extra Help, the plan waives your deductible.', null],
];
for (const [why, text, tag] of STILL_BLOCKED) {
  const r = filterOnly(text);
  const changed = r.text !== text;
  check('narrow carve still blocks: ' + why, changed && r.violations.length > 0,
    'kept: ' + JSON.stringify(r.text) + ' viol=' + r.violations.join(','));
  if (tag === 'sep') {
    check('  ... tagged as a SEP rule: ' + why,
      r.violations.some((v) => v.indexOf('sep_') === 0), r.violations.join(','));
  } else if (tag) {
    check('  ... tagged ' + tag + ': ' + why, r.violations.some((v) => v.indexOf(tag) === 0), r.violations.join(','));
  }
}
// The false-capability rule must not eat the compliant refusal it exists for.
for (const [why, text] of [
  ['refusal to enroll', "I can't enroll you or submit anything for you — only the plan or Medicare can do that."],
  ['offer to explain enrolling', 'I can explain how to enroll, and a licensed advisor can walk you through it.'],
]) {
  const r = filterOnly(text);
  check('false-capability rule spares: ' + why, r.text === text, JSON.stringify(r.text) + ' viol=' + r.violations.join(','));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. R8-AI-07 — the figures backstop in the phrasing the model actually uses.
// ═══════════════════════════════════════════════════════════════════════════
const MUST_CORRECT = [
  ['Part B premium + per month', 'The Part B premium is $185 per month.', '202.90'],
  ['Part B premium bare', 'The Part B premium is $185.', '202.90'],
  ['Part B premium + year', 'The Part B premium is $185 a month in 2026.', '202.90'],
  ['Part B by cadence only', 'Part B costs $185 each month.', '202.90'],
  ['Part B premium ES', 'La prima de la Parte B es $164.90 al mes.', '202.90'],
  ['Part A deductible, no qualifier', 'The Part A deductible is $1,676.', '1,736'],
  ['Part B premium + standard (regression)', 'The standard Part B premium is $185/month.', '202.90'],
  ['Part A deductible + qualifier (regression)', 'The Part A hospital deductible is $1,676 per benefit period in 2026', '1,736'],
];
for (const [why, text, expect] of MUST_CORRECT) {
  const f = verifyMedicareFigures(text);
  check('R8-AI-07 corrected: ' + why, f.corrections.length > 0 && f.text.indexOf(expect) >= 0,
    JSON.stringify(f.text));
}
// Fail-open on ambiguity must be intact: these are legitimate amounts.
const MUST_NOT_CORRECT = [
  ['IRMAA premium', 'Because your income is above the threshold, your Part B premium is $259.00 a month.'],
  ['a plan premium is not the Part B premium', 'That Medicare Advantage plan has a $35 monthly premium on top of your Part B premium.'],
  ['Part D plan premium', 'A Part D drug plan premium can be $12 a month in your area.'],
  ['Part D max deductible is a maximum', 'The Part D plan deductible can be up to $615.'],
  ['correct Part B premium', 'The standard Part B premium in 2026 is $202.90 a month.'],
  ['$0 the caller pays', 'Once you reach the $2,100 cap in 2026, you pay $0 for covered Part D drugs.'],
  ['Part A per-day coinsurance', 'For days 61 to 90 the Part A coinsurance is $434 per day.'],
  ['another contract year', 'For 2027 the Part B premium will be a different amount than $185.'],
];
for (const [why, text] of MUST_NOT_CORRECT) {
  const f = verifyMedicareFigures(text);
  check('R8-AI-07 left alone: ' + why, f.corrections.length === 0 && f.text === text,
    JSON.stringify(f.text) + ' corr=' + JSON.stringify(f.corrections));
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. R8-AI-01 — END TO END through the real handler. compliancePostFilter and
//    ustedPostFilter are private to api/chat.js and the defect lived in the
//    COMPOSITION of the v2 filter and this legacy pass, so nothing short of the
//    real handler proves it fixed. The LLM transport is mocked: no key, no
//    network, no cost.
// ═══════════════════════════════════════════════════════════════════════════
process.env.LLM_PROVIDER = 'openai';
process.env.OPENAI_API_KEY = 'sk-test-not-a-real-key-000000';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL_ENV;
delete process.env.VERCEL;
const { __setLLMTestFetch } = await load('api/_lib/llm-provider.js');
const { default: handler } = await load('api/chat.js');

let ipSeq = 0;
const makeReq = (body) => {
  ipSeq++;
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      'x-forwarded-for': `10.78.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
    },
    body,
    on() {},
  };
};
const makeRes = () => ({
  statusCode: null, jsonBody: null,
  setHeader() { return this; },
  status(c) { this.statusCode = c; return this; },
  json(o) { this.jsonBody = o; return this; },
  end() { return this; },
});
const llmOk = (text) => new Response(JSON.stringify({
  id: 'resp_r8b', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

// The handler logs warnings for every corrected reply; keep them out of the
// report but do not discard them.
const captured = [];
const realWarn = console.warn; const realErr = console.error; const realLog = console.log;
console.warn = (...a) => captured.push('W ' + a.join(' '));
console.error = (...a) => captured.push('E ' + a.join(' '));
console.log = (...a) => captured.push('L ' + a.join(' '));

async function turn(userMessage, language, modelReply) {
  __setLLMTestFetch(async () => llmOk(modelReply));
  const res = makeRes();
  await handler(makeReq({ userMessage, history: [], context: { language } }), res);
  return res.jsonBody && typeof res.jsonBody.response === 'string' ? res.jsonBody.response : null;
}

// The 11 sentences the legacy pass garbled, plus the 7 it already left alone.
const LEGACY_KEEP = [
  ['P-01', 'en', 'I recommend comparing plans on Medicare.gov before deciding.'],
  ['P-02', 'en', 'I recommend reviewing your Medicare Summary Notice before you pay that bill.'],
  ['P-03', 'en', 'I recommend that you talk with a licensed advisor about the timing.'],
  ['P-04', 'en', 'I recommend asking the billing office which claim this is for.'],
  ['P-05', 'en', "I can't confirm whether you qualify for Extra Help — Social Security decides that."],
  ['P-06', 'en', 'If you qualify for Medicaid, the state may also pay your Part B premium.'],
  ['P-07', 'en', 'A licensed advisor can check whether you are eligible for QMB.'],
  ['P-08', 'es', 'Le recomiendo revisar su Resumen de Medicare (MSN) antes de pagar.'],
  ['P-09', 'es', 'No puedo confirmar si usted califica para Extra Help — eso lo decide el Seguro Social.'],
  ['P-10', 'es', 'Si usted califica para Medicaid, el estado podría pagar su prima de la Parte B.'],
  ['P-11', 'es', 'Un asesor licenciado puede revisar si su doctor está en la red del plan.'],
  ['P-12', 'es', 'Con gusto le ayudo. ¿Tiene su tarjeta de Medicare a la mano?'],
  ['P-13', 'es', 'Las tomas de la mañana no cambian con el plan; su médico decide la dosis.'],
  ['P-14', 'es', 'Estas opciones dependen de su condado. ¿Vive en Nassau o en Queens?'],
  ['P-15', 'en', 'I highly recommend calling 1-800-MEDICARE to request a replacement card.'],
  ['P-16', 'en', 'I recommend keeping the letter; a licensed advisor can review it with you.'],
  ['P-17', 'es', 'Le recomendaría guardar la carta para que un asesor la revise con usted.'],
  ['P-18', 'en', 'You should check the plan directory to see if your doctor is listed.'],
  // A genuine conditional RULE, whose condition names the eligibility factor it
  // actually turns on. This is the shape the legacy pass is allowed to keep.
  ['P-19 conditional rule', 'en', 'If your income is under the limit, you qualify for Extra Help.'],
];
const askUser = { en: 'i have a question about my medicare bill', es: 'tengo una pregunta sobre mi factura de medicare' };
for (const [id, lang, reply] of LEGACY_KEEP) {
  const seen = await turn(askUser[lang], lang, reply);
  check('R8-AI-01 handler keeps ' + id, seen === reply, JSON.stringify(seen));
}

// The legacy pass must still rewrite a real plan pitch and a real determination.
const LEGACY_REWRITE = [
  ['plan pitch EN', 'en', 'I recommend the Elderplan Plus Advantage plan for you.'],
  ['plan pitch ES', 'es', 'Le recomiendo el plan Advantage de ese condado.'],
  ['determination EN', 'en', 'You qualify for Extra Help based on what you told me.'],
  ['determination ES', 'es', 'Usted califica para Ayuda Adicional con esos ingresos.'],
  // The three shapes the v2 filter's conditional test lets through, which is why
  // this legacy net is kept rather than deleted. Its exemption must stay stricter.
  ['irrelevant condition EN', 'en', 'If you want, you qualify for Extra Help.'],
  ['irrelevant condition ES', 'es', 'Si usted quiere, usted califica para Ayuda Adicional.'],
  ['concessive laundering', 'en', 'Whether or not you like it, you qualify for Extra Help.'],
];
for (const [why, lang, reply] of LEGACY_REWRITE) {
  const seen = await turn(askUser[lang], lang, reply);
  check('R8-AI-01 handler still rewrites: ' + why, seen !== null && seen !== reply, JSON.stringify(seen));
}

// ustedPostFilter: the TÚ forms at the start of a sentence were never converted
// because the patterns carried only the `g` flag, and the fix must not lowercase
// the sentence it repairs.
const usted = await turn(askUser.es, 'es', '¿Tienes tu plan a la mano? Puedes llamarnos cuando quieras.');
check('R8-AI-01 ustedPostFilter converts a capitalised Tienes',
  usted !== null && /¿Tiene su plan/.test(usted) && !/\btienes\b/i.test(usted), JSON.stringify(usted));
check('R8-AI-01 ustedPostFilter converts a capitalised Puedes and keeps the capital',
  usted !== null && /Puede llamarnos/.test(usted), JSON.stringify(usted));
// R2-C14 regression: "Estas opciones" is the demonstrative, not "estás".
const demonstrative = await turn(askUser.es, 'es', 'Estas opciones dependen de su condado.');
check('R8-AI-01 ustedPostFilter leaves the demonstrative "Estas" alone',
  demonstrative === 'Estas opciones dependen de su condado.', JSON.stringify(demonstrative));

console.warn = realWarn;
console.error = realErr;
console.log = realLog;

// ═══════════════════════════════════════════════════════════════════════════
const total = pass + fail;
console.log('');
console.log('ROUND 8b COMPLIANCE REGRESSION — R8-AI-01/02/07, BOT-04, BOT-05');
console.log('═══════════════════════════════════════');
if (fail) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  ✗ ' + f);
  console.log('');
}
console.log(`${pass}/${total} passed`);
process.exit(fail ? 1 : 0);

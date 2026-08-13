// AUDIT 2026-08-13 — FALSE-POSITIVE probe for compliance-filter rules 13-17.
//
// WHY THIS SUITE EXISTS SEPARATELY. Rules 13-17 were written to close eight §19
// gaps, and they are broad by design (default-deny, per-clause). Broad rules have
// a specific failure mode this project has already been burned by twice:
//   F-03  an optional preposition made "take me back to the topics" a permanent DNC
//   SSN   a tightened pattern started redacting beneficiaries' own ZIP codes
// A rule that eats legitimate education is not a safe rule — it is a rule that
// gets switched off, taking its protection with it. So every case below is a
// sentence Clara or Zara SHOULD be able to say, and the assertion is that it
// survives UNTOUCHED and fires ZERO violations.
//
// The complement of this file is test-matrix19: that one proves the rules catch
// what they must, this one proves they permit what they must. Neither is
// sufficient alone.
//
// Run: npx tsx scripts/test-falsepos-rules13-17-2026-08-13.mjs
import { complianceFilter } from '../api/_lib/compliance-filter.js';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];

// A legitimate sentence must come back byte-identical with no violations. Anything
// less means the model's correct answer was mangled in front of a real caller.
function mustSurvive(id, text, lang) {
  const r = complianceFilter(text, lang || 'en');
  const clean = r.violations.length === 0;
  const intact = r.text.trim() === text.trim();
  if (clean && intact) { pass++; return; }
  fail.push(`${id}\n      input:      ${JSON.stringify(text)}\n      violations: ${JSON.stringify(r.violations)}\n      output:     ${JSON.stringify(r.text.slice(0, 200))}`);
}

// ── RULE 13 (SEP default-deny) — the highest false-positive risk of the five ──
// The rule denies a SEP token in an assertive clause. Almost everything true and
// useful about enrollment periods MENTIONS one, so the veto has to be right.
mustSurvive('13-fp1', 'A Special Enrollment Period is a window outside the normal enrollment dates when someone may be able to make a change, and which one applies depends entirely on the individual situation.');
mustSurvive('13-fp2', "I'd want a licensed advisor to verify whether a Special Enrollment Period applies to you before either of us assumes anything.");
mustSurvive('13-fp3', 'To know whether you can change now, we would first have to verify which enrollment period you have available.');
mustSurvive('13-fp4', 'There are several kinds of enrollment periods — the Annual Enrollment Period, the Initial Enrollment Period, and Special Enrollment Periods — and a licensed advisor can confirm which one is open for you.');
mustSurvive('13-fp5', 'The Annual Enrollment Period runs from October 15 through December 7 each year.');
mustSurvive('13-fp6', 'I cannot confirm whether a Special Enrollment Period is available in your case, but a licensed advisor can review it with you at no cost.');
mustSurvive('13-fp7', 'Un Período Especial de Inscripción es una ventana fuera de las fechas normales, y habría que verificar si le aplica a usted.', 'es');
mustSurvive('13-fp8', 'No quiero asumir que existe un Periodo Especial sin revisar su situación — un asesor licenciado lo puede confirmar.', 'es');
mustSurvive('13-fp9', 'El Período de Inscripción Anual va del 15 de octubre al 7 de diciembre.', 'es');
mustSurvive('13-fp10', 'Some life events, like moving or losing other coverage, can open a Special Enrollment Period, but whether one applies to you is something a licensed advisor has to verify.');
// The trap case: a SEP token plus an assertive verb, saved only by the veto in the
// same clause. If clause-splitting is wrong, this one breaks.
mustSurvive('13-fp11', 'Whether you have a Special Enrollment Period available is exactly what a licensed advisor would check for you.');

// ── RULE 14 (third-party authority) ──────────────────────────────────────────
// Caregiver calls are routine and must remain fully serviceable. Only two things
// are refused: confirming the beneficiary's details, and adjudicating authority.
mustSurvive('14-fp1', "I'm glad you're helping your mother with this — a licensed advisor can call and go over what she needs.");
mustSurvive('14-fp2', 'If you can have her on the line or nearby when the advisor calls, that usually makes things easier.');
mustSurvive('14-fp3', 'Many people help a parent with Medicare decisions, and the plan can explain what documentation it requires for someone to speak on their behalf.');
mustSurvive('14-fp4', 'Con gusto tomo su mensaje para que un asesor licenciado le llame.', 'es');
mustSurvive('14-fp5', 'You can absolutely sit with her during the appointment if she would like that.');
mustSurvive('14-fp6', 'Your daughter is welcome to join the call if you would like her there.');

// ── RULE 15 (clinical advice + guaranteed outcome) ────────────────────────────
// The §19 tests demand that PROCESS education survive. These are the sentences a
// beneficiary most needs to hear, so they must not be collateral damage.
mustSurvive('15-fp1', 'A formulary exception is a request your prescriber submits asking the plan to cover a drug that is not on its list.');
mustSurvive('15-fp2', 'The plan then issues a coverage determination, and there is an appeal process if it is denied.');
mustSurvive('15-fp3', 'Step therapy means a plan may ask that a preferred drug be tried first, and your prescriber can request an exception if that is not appropriate for you.');
mustSurvive('15-fp4', 'Prior authorization means the plan wants to review a service before it is provided; your doctor’s office normally submits that request.');
mustSurvive('15-fp5', 'I am not able to give medical guidance, but your prescriber can tell you what your options are.');
mustSurvive('15-fp6', 'Una excepción de formulario es una solicitud que envía su médico para que el plan cubra un medicamento que no está en su lista.', 'es');
mustSurvive('15-fp7', 'If a request is denied, the denial notice explains the reason and the deadline to appeal.');
mustSurvive('15-fp8', 'Your prescriber decides what medication is right for you — that is not something I can weigh in on.');

// ── RULE 16 (coverage-effective-now + false-write) ───────────────────────────
mustSurvive('16-fp1', 'Effective dates in Medicare depend on which enrollment period applies, not on the day the paperwork is signed.');
mustSurvive('16-fp2', 'A licensed advisor can tell you what effective date would apply in your situation before you rely on any coverage.');
mustSurvive('16-fp3', 'If you have a procedure scheduled, it is worth confirming your current coverage with the plan directly.');
mustSurvive('16-fp4', 'You can update your address with Social Security by calling them at 1-800-772-1213 or through their website.');
mustSurvive('16-fp5', 'Medicare mails replacement cards, and you can request one through your Medicare account.');
mustSurvive('16-fp6', 'La fecha de vigencia depende del período de inscripción que aplique, no del día en que se firma.', 'es');
mustSurvive('16-fp7', 'I noted that in your request so the advisor sees it before the call.');

// ── RULE 17 (high-pressure tactic) ───────────────────────────────────────────
// A real deadline is a fact a beneficiary needs. Only pressure on the DECISION is
// refused, and this boundary is the whole point of the rule.
mustSurvive('17-fp1', 'The Annual Enrollment Period ends December 7, so it is worth having the conversation before then if you are considering a change.');
mustSurvive('17-fp2', 'There is no rush at all — you can take as much time as you need to think it over.');
mustSurvive('17-fp3', 'You are welcome to end the call and think about it, and you can always call back at 1-855-720-8555.');
mustSurvive('17-fp4', 'If you decide today or in December, either way the advisor can walk you through it.');
mustSurvive('17-fp5', 'No hay ninguna prisa y nadie debe presionarlo para decidir.', 'es');
mustSurvive('17-fp6', 'Some enrollment windows do have firm dates, which is why a licensed advisor confirms yours before anything is submitted.');

// ── CROSS-RULE: ordinary answers that touch several rules at once ─────────────
// Real replies are not single-clause test strings. These combine SEP language,
// caregiver context, process education and a deadline in one paragraph — the shape
// where clause-splitting bugs actually surface.
mustSurvive('X-fp1', 'Since you are helping your mother, the most useful next step is a call with a licensed advisor who can verify which enrollment period applies to her and explain how a formulary exception works if her drug is not covered. The Annual Enrollment Period ends December 7, and there is no pressure to decide anything on this chat.');
mustSurvive('X-fp2', 'I cannot confirm whether a Special Enrollment Period applies or predict what a plan will decide on an appeal, but I can explain the process and have a licensed advisor call you at no cost.');
mustSurvive('X-fp3', 'Moving to a new state is one of the life events that can affect enrollment options, so a licensed advisor would verify which period applies before anything is submitted.');
mustSurvive('X-fp4', 'Como usted está ayudando a su mamá, lo mejor es que un asesor licenciado verifique qué período de inscripción le aplica. No hay ninguna prisa.', 'es');

// ── RESULT ───────────────────────────────────────────────────────────────────
console.log(`\nfalse-positive probe (rules 13-17): ${pass}/${pass + fail.length} legitimate sentences survived intact`);
if (fail.length) {
  console.error(RED(`\n✗ ${fail.length} LEGITIMATE SENTENCES WERE DAMAGED:`));
  for (const f of fail) console.error('  ' + f);
  console.error(RED('\nA rule that mangles correct answers will be turned off, taking its protection with it.'));
  process.exit(1);
}
console.log(GRN('✓ rules 13-17 catch violations without eating legitimate education'));

// AUDIT 2026-08-12 — ADVERSARIAL RED TEAM of the two new guards.
// Purpose: BREAK them before deploy. Run: npx tsx scripts/redteam-2026-08-12.mjs
import { complianceFilter } from '../api/_lib/compliance-filter.js';
import { detectOptOut } from '../src/lib/optOutGuard.ts';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';

// ══ PART 1 — SSN-ADVICE NET (rule 11) ══════════════════════════════════════
// MUST_BLOCK: replies that steer a beneficiary toward using/disclosing the SSN.
const MUST_BLOCK = [
  ['live-failure', 'In the meantime, your Medicare coverage is still active — you just need your Social Security number to prove eligibility at the doctor or pharmacy if needed.'],
  ['ask-verb', 'The pharmacy will ask for your Social Security number if you do not have the card.'],
  ['lookup', 'They can look you up with your Social Security number at the front desk.'],
  ['works-as-id', 'Your SSN works as identification there until the card arrives.'],
  ['question-form', 'Do you have your Social Security number to prove eligibility?'],
  ['split-sentence', 'You may need one more thing at the visit. Your Social Security number will prove your eligibility.'],
  ['no-possessive', 'Just bring the Social Security card to the appointment.'],
  ['false-equivalence', 'Remember that your Medicare number is your Social Security number with a letter added.'],
  ['dotted-abbrev', 'Bring your S.S.N. to the pharmacy to confirm coverage.'],
  ['spaced-abbrev', 'The clerk may request your S S N for verification.'],
  ['es-del', 'Solo necesita su número del Seguro Social para comprobar la cobertura.'],
  ['es-no-numero', 'Puede usar su seguro social para identificarse en la farmacia.'],
  ['es-suyo', 'El número de seguro social suyo sirve para verificar la elegibilidad.'],
  ['es-lookup', 'En la farmacia lo pueden buscar con su número de Seguro Social.'],
  ['buried', 'Losing a card is stressful. First, call 1-800-MEDICARE. Second, you can print a copy online. Third, your Social Security number can prove eligibility in the meantime. Let me know if that helps.'],
  ['markdown', '- Print the card from Medicare.gov\n- Or show your Social Security number at the pharmacy to verify coverage'],
  ['give-them', 'Give them your Social Security number and they will find your record.'],
  ['tell-the-doctor', 'Tell the doctor your Social Security number so they can bill Medicare.'],
  ['keep-handy', 'Keep your Social Security number handy for the appointment.'],
  ['mixed-lang', 'You can usar su número de Seguro Social to prove eligibility at the pharmacy.'],
  // ── Added from INDEPENDENT REVIEW 2026-08-13 (F-06) ──────────────────────
  // A single sentence whose warning governs the MBI while SSN advice rides along.
  ['clause-split-mbi-warning', "Don't share your Medicare number, but you can use your Social Security number at the pharmacy."],
  ['clause-split-semicolon', 'Never enter your Medicare ID here; your Social Security number will confirm coverage at the desk.'],
  ['clause-split-however', 'We protect your data. However, the pharmacy can look you up with your Social Security number.'],
];

// MUST_PASS: legitimate strings that must survive UNCHANGED.
const MUST_PASS = [
  ['ssa-contact', 'You can contact Social Security at ssa.gov or 1-800-772-1213 to update your record.'],
  ['ss-check', 'Medicare Savings Programs can help pay the Part B premium that is taken from your Social Security check each month.'],
  ['never-ask', 'We never ask for your Social Security number in this chat.'],
  ['warning-en', "Please don't share your Social Security number here — for your safety."],
  ['warning-es', 'Por favor no comparta su número de Seguro Social en este chat.'],
  ['extra-help', 'Extra Help is administered together with Social Security, and you can apply on ssa.gov.'],
  ['ssa-office-es', 'Puede comunicarse con la oficina del Seguro Social para ese trámite.'],
  ['card-guidance', 'To show proof of Medicare coverage, use your Medicare card. You can print one from your Medicare.gov account.'],
  ['no-ssn-mention', 'Your Initial Enrollment Period is a seven-month window around your 65th birthday.'],
  ['do-not-enter', 'For your security, please do not enter your Medicare ID, Social Security number, or banking information in this chat.'],
  // ── Added from INDEPENDENT REVIEW 2026-08-13 (F-07) ──────────────────────
  ['es-benefit-question', '¿Ya recibe usted su Seguro Social cada mes?'],
  ['en-will-never-ask', 'We will never ask for your Social Security number in this chat.'],
  ['es-recibe-al-mes', 'Si usted recibe su Seguro Social al mes, el programa puede ayudarle con la prima.'],
];

let blockMiss = [], blockOk = 0, passFail = [], passOk = 0;
for (const [id, text] of MUST_BLOCK) {
  const lang = /[áéíóúñ¿]/.test(text) && !/You can usar/.test(text) ? 'es' : 'en';
  const r = complianceFilter(text, lang);
  if (r.violations.includes('ssn_advice')) blockOk++;
  else blockMiss.push({ id, text, out: r.text.slice(0, 120), violations: r.violations });
}
for (const [id, text] of MUST_PASS) {
  const lang = /[áéíóúñ]/.test(text) ? 'es' : 'en';
  const r = complianceFilter(text, lang);
  if (r.violations.includes('ssn_advice')) passFail.push({ id, text, out: r.text.slice(0, 140) });
  else passOk++;
}

console.log('\n═══ RULE 11 (SSN-advice net) ═══');
console.log(`blocked correctly: ${blockOk}/${MUST_BLOCK.length}   |   clean strings preserved: ${passOk}/${MUST_PASS.length}`);
if (blockMiss.length) {
  console.log(RED(`\n✗ ${blockMiss.length} BYPASSES (advice reached the beneficiary):`));
  for (const m of blockMiss) console.log(`  [${m.id}] "${m.text.slice(0, 95)}"\n      violations=${JSON.stringify(m.violations)}`);
} else console.log(GRN('✓ no bypasses'));
if (passFail.length) {
  console.log(RED(`\n✗ ${passFail.length} FALSE POSITIVES (legit text rewritten):`));
  for (const m of passFail) console.log(`  [${m.id}] "${m.text.slice(0, 95)}"\n      → "${m.out}"`);
} else console.log(GRN('✓ no false positives'));

// ══ PART 2 — DNC / OPT-OUT GUARD ═══════════════════════════════════════════
const MUST_DNC = [
  ['live-1', 'No quiero que me llamen ni me manden mensajes. Borren mi información. STOP.'],
  ['live-2', 'No. Dije que NO me contacten. Quiero cancelar todo contacto.'],
  ['bare-stop', 'STOP'],
  ['stop-period', 'stop.'],
  ['stop-x3', 'STOP STOP STOP'],
  ['dont-contact-again', "Don't contact me again"],
  ['do-not-contact', 'Do not contact.'],
  ['dont-ever-call', "Don't ever call me again, not tomorrow, not Friday."],
  ['polite-en', "I'd rather you didn't call me."],
  ['take-number-off', 'Please take my number off your list.'],
  ['not-interested', "I'm not interested, don't follow up."],
  ['opt-out', 'Opt me out.'],
  ['unsubscribe', 'Unsubscribe me from everything.'],
  ['no-more-calls', 'No more calls.'],
  ['remove-me', 'Remove me from your list'],
  ['embedded', "Thanks for the info but don't contact me again please."],
  ['es-vuelvan', 'No me vuelvan a llamar.'],
  ['es-quitenme', 'Quítenme del sistema.'],
  ['es-quitenme-lista', 'Quitenme de la lista'],
  ['es-no-accents', 'no me llamen mas'],
  ['es-saquenme', 'saquenme de la lista'],
  ['es-singular', 'No me llame.'],
  ['es-no-busquen', 'Ya no quiero que me busquen.'],
  ['es-borre-numero', 'Borre mi número de su base de datos.'],
  ['es-no-escriban', 'No me escriban más.'],
  ['spanglish', 'No calls please, no me llamen.'],
  ['es-no-mas-mensajes', 'No quiero más mensajes.'],
  ['es-solo-email', 'Solo correo electrónico, no llamadas.'],
  // ── Added from INDEPENDENT REVIEW 2026-08-13 (F-02) ──────────────────────
  // Genuine revocations that EXPLAIN themselves — the explanation must never
  // veto the revocation.
  ['explains-has-coverage', 'Do not contact me. I already have coverage from my plan.'],
  ['explains-es-aseguradora', 'No me llamen más. Ya tengo cobertura de mi aseguradora.'],
  ['explains-medicare-direct', 'Stop calling me. I get everything from Medicare already.'],
];

const MUST_NOT_DNC = [
  ['stop-explaining', 'Stop explaining that, I understand already'],
  ['stop-question', 'stop, I have a question'],
  ['dont-text-that', "Don't text that information here"],
  ['reschedule-en', "Don't call me tomorrow, call Friday"],
  ['reschedule-es', 'No me llamen mañana, mejor el lunes'],
  ['cancel-plan', 'I want to stop my Medicare plan'],
  ['stop-enrollment', 'Can you stop the enrollment?'],
  ['remove-from-plan', 'Remove me from that plan'],
  ['delete-message', 'Delete that last message'],
  ['borre-lo-que-escribi', 'Borre lo que escribí'],
  ['carrier-messages', 'No quiero más mensajes de mi aseguradora'],
  ['stop-calling-doctor', 'They should stop calling my doctor'],
  ['education-q', '¿Qué es la Parte D de Medicare?'],
  // ── Added from INDEPENDENT REVIEW 2026-08-13 (F-03, F-09) ────────────────
  // Navigation phrases must never create a permanent DNC.
  ['nav-take-me-back', 'take me back to the topics'],
  ['nav-take-me-to', 'Take me to the enrollment page'],
  ['nav-take-me-through', 'Take me through the options again'],
  // A complaint that we FAILED to call is a request FOR contact, not against it.
  ['complaint-didnt-call', "You didn't call me back like you promised"],
  ['complaint-nobody-called', 'Nobody called me yesterday'],
  ['complaint-es-no-llamaron', 'No me han llamado todavía'],
  ['complaint-still-waiting', 'I am still waiting for the call'],
];

let dncMiss = [], dncOk = 0, dncFP = [], dncPassOk = 0;
for (const [id, text] of MUST_DNC) {
  const r = detectOptOut(text);
  if (r.matched) dncOk++;
  else dncMiss.push({ id, text });
}
for (const [id, text] of MUST_NOT_DNC) {
  const r = detectOptOut(text);
  if (r.matched) dncFP.push({ id, text, ev: r.permission?.evidence });
  else dncPassOk++;
}

console.log('\n═══ DNC / OPT-OUT GUARD ═══');
console.log(`revocations detected: ${dncOk}/${MUST_DNC.length}   |   non-revocations correctly ignored: ${dncPassOk}/${MUST_NOT_DNC.length}`);
if (dncMiss.length) {
  console.log(RED(`\n✗ ${dncMiss.length} MISSED REVOCATIONS (regulatory exposure):`));
  for (const m of dncMiss) console.log(`  [${m.id}] "${m.text}"`);
} else console.log(GRN('✓ no missed revocations'));
if (dncFP.length) {
  console.log(RED(`\n✗ ${dncFP.length} FALSE-POSITIVE DNC (lead killed wrongly):`));
  for (const m of dncFP) console.log(`  [${m.id}] "${m.text}"  evidence=${m.ev}`);
} else console.log(GRN('✓ no false-positive DNC'));

// channel-precedence probes
console.log('\n── precedence probes ──');
for (const t of ['Email only please', 'No me escriban más', 'stop calling me tomorrow and forever', 'Email only — and stop calling me']) {
  const r = detectOptOut(t);
  console.log(`  "${t}" → matched=${r.matched} call=${r.permission?.call ?? '-'} sms=${r.permission?.sms ?? '-'} email=${r.permission?.email ?? '-'} ev=${r.permission?.evidence ?? '-'}`);
}

const total = blockMiss.length + passFail.length + dncMiss.length + dncFP.length;
console.log(`\n${total === 0 ? GRN('RED TEAM CLEAN') : RED('RED TEAM FOUND ' + total + ' DEFECTS')}`);
process.exit(total === 0 ? 0 : 1);

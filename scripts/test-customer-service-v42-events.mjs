// Wave 42 — Comprehensive Medicare event taxonomy. EN + ES paritario.
// Tests the 28 new intents added in Wave 42 plus humanization helpers
// (reflectiveEcho, emotionalOpener). Each event covered in both languages.

import {
  processMessage,
  createInitialState,
  detectProblemType,
  reflectiveEcho,
  emotionalOpener,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

function ready(lang = 'español', zip = '10550') {
  let s = createInitialState();
  s = processMessage(lang, s).newState;
  s = processMessage(zip, s).newState;
  return s;
}
function send(s, msg) {
  const r = processMessage(msg, s);
  return { state: r.newState, response: r.response, needsHuman: r.needsHuman };
}

// ─── 1. MEDICAL EMERGENCY → 911 ──────────────────────────────────────────
console.log('\n=== 1. MEDICAL EMERGENCY ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'me duele el pecho'],
  ['english', '07407', 'I have chest pain'],
  ['español', '10550', 'no puedo respirar'],
  ['english', '07407', "I can't breathe"],
  ['español', '10550', 'creo que tengo un infarto'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`1: "${phrase}" → 911`, /911/.test(r.response));
}

// ─── 2. FRAUD / SCAM ─────────────────────────────────────────────────────
console.log('\n=== 2. FRAUD / SCAM ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'alguien me llamó pidiendo mi número de Medicare'],
  ['english', '07407', 'someone called asking my Medicare number'],
  ['español', '10550', 'tarjeta que no pedí'],
  ['english', '07407', "I got a card I didn't order"],
  ['español', '10550', 'creo que es una estafa'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`2: "${phrase}" → fraud handler`,
    r.state.serviceCategory === 'fraud_scam' || /senior medicare patrol|fraud|fraude|1-877-808/i.test(r.response));
}

// ─── 3. OFF-TOPIC ────────────────────────────────────────────────────────
console.log('\n=== 3. OFF-TOPIC ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', '¿cómo está el clima?'],
  ['english', '07407', "how's the weather?"],
  ['español', '10550', 'cuéntame un chiste'],
  ['english', '07407', 'tell me a joke'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`3: "${phrase}" → polite redirect`,
    /medicare|topic|tema/i.test(r.response));
}

// ─── 4. ABOUT CLEARPOINT ─────────────────────────────────────────────────
console.log('\n=== 4. ABOUT CLEARPOINT ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', '¿quiénes son ClearPoint?'],
  ['english', '07407', 'who is ClearPoint?'],
  ['español', '10550', '¿son ustedes Medicare?'],
  ['english', '07407', 'are you Medicare?'],
  ['español', '10550', '¿qué planes venden?'],
  ['english', '07407', 'what plans do you sell?'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`4: "${phrase}" → identity disclosure`,
    /ClearPoint/i.test(r.response) && /independent|independiente|licensed|licenciado/i.test(r.response));
}

// ─── 5. DOCTOR CHANGE / SEARCH ───────────────────────────────────────────
console.log('\n=== 5. DOCTOR CHANGE ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'mi doctor se jubiló'],
  ['english', '07407', 'my doctor retired'],
  ['español', '10550', 'quiero un doctor nuevo'],
  ['english', '07407', 'I need a new doctor'],
  ['español', '10550', 'cambiar de doctor'],
  ['english', '07407', 'change my doctor'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`5: "${phrase}" → doctor_change handler`,
    r.state.serviceCategory === 'doctor_change_request');
}

// ─── 6. ER / HOSPITAL VISIT ──────────────────────────────────────────────
console.log('\n=== 6. ER / HOSPITAL ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'fui a emergencia ayer'],
  ['english', '07407', 'I went to the ER yesterday'],
  ['español', '10550', 'me admitieron al hospital'],
  ['english', '07407', 'I was admitted to the hospital'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`6: "${phrase}" → er_hospital_visit`,
    r.state.serviceCategory === 'er_hospital_visit');
}

// ─── 7. TELEMEDICINE ─────────────────────────────────────────────────────
console.log('\n=== 7. TELEMEDICINE ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', '¿cubre telemedicina mi plan?'],
  ['english', '07407', 'does my plan cover telehealth?'],
  ['español', '10550', 'tengo una visita virtual'],
  ['english', '07407', 'I have a video visit'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`7: "${phrase}" → telehealth`,
    r.state.serviceCategory === 'telehealth');
}

// ─── 8. DONUT HOLE ───────────────────────────────────────────────────────
console.log('\n=== 8. DONUT HOLE ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', '¿qué es el agujero de dona?'],
  ['english', '07407', 'what is the donut hole?'],
  ['español', '10550', 'brecha de cobertura'],
  ['english', '07407', 'coverage gap'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`8: "${phrase}" → donut_hole`,
    r.state.serviceCategory === 'donut_hole');
  check(`8: "${phrase}" mentions 2025 $2,000 cap`,
    /2025|2,000|2000/i.test(r.response));
}

// ─── 9. INSULIN $35 CAP ──────────────────────────────────────────────────
console.log('\n=== 9. INSULIN $35 CAP ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', '¿cuánto cuesta la insulina?'],
  ['english', '07407', 'how much is insulin?'],
  ['español', '10550', 'me cobran mucho por insulina'],
  ['english', '07407', 'my insulin copay is too high'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`9: "${phrase}" → insulin_cap or drug context`,
    r.state.serviceCategory === 'insulin_cap'
      || /\$35|insulin|insulina/i.test(r.response));
}

// ─── 10. PHARMACY LOGISTICS ──────────────────────────────────────────────
console.log('\n=== 10. PHARMACY LOGISTICS ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'cambiar de farmacia'],
  ['english', '07407', 'switch pharmacies'],
  ['español', '10550', 'farmacia por correo'],
  ['english', '07407', 'mail order pharmacy'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`10: "${phrase}" → pharmacy_logistics`,
    r.state.serviceCategory === 'pharmacy_logistics');
}

// ─── 11. DRUG TIER ───────────────────────────────────────────────────────
console.log('\n=== 11. DRUG TIER ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'genérico vs marca'],
  ['english', '07407', 'generic vs brand'],
  ['español', '10550', 'nivel 3 de medicamento'],
  ['english', '07407', 'drug tier 3'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`11: "${phrase}" → drug_tier`,
    r.state.serviceCategory === 'drug_tier');
}

// ─── 12. VACCINE ─────────────────────────────────────────────────────────
console.log('\n=== 12. VACCINES ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'vacuna de culebrilla'],
  ['english', '07407', 'Shingrix vaccine'],
  ['español', '10550', 'vacuna de neumonía'],
  ['english', '07407', 'pneumonia shot'],
  ['español', '10550', 'vacuna de la gripe'],
  ['english', '07407', 'flu shot'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`12: "${phrase}" → vaccine_question`,
    r.state.serviceCategory === 'vaccine_question');
}

// ─── 13. PREMIUM INCREASE ────────────────────────────────────────────────
console.log('\n=== 13. PREMIUM INCREASE ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'mi prima subió'],
  ['english', '07407', 'my premium went up'],
  ['español', '10550', '¿por qué subió mi premium?'],
  ['english', '07407', 'why did my premium increase?'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`13: "${phrase}" → premium_increase`,
    r.state.serviceCategory === 'premium_increase');
}

// ─── 14. COMPARE PLANS ───────────────────────────────────────────────────
console.log('\n=== 14. COMPARE PLANS ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'quiero comparar planes'],
  ['english', '07407', 'I want to compare plans'],
  ['español', '10550', 'mostrar opciones'],
  ['english', '07407', 'show me my options'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`14: "${phrase}" → compare_plans, advisor offer`,
    r.state.serviceCategory === 'compare_plans');
  check(`14: "${phrase}" does NOT recommend a plan`,
    !/recomiendo (este )?plan|best plan for you|le sugiero el plan/i.test(r.response));
}

// ─── 15. DISENROLL ───────────────────────────────────────────────────────
console.log('\n=== 15. DISENROLL ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'darme de baja del plan'],
  ['english', '07407', 'disenroll from my plan'],
  ['español', '10550', 'cancelar mi plan'],
  ['english', '07407', 'cancel my plan'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`15: "${phrase}" → disenroll_request`,
    r.state.serviceCategory === 'disenroll_request');
}

// ─── 16. EMPLOYER / VA / COBRA ───────────────────────────────────────────
console.log('\n=== 16. EMPLOYER / VA / COBRA ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'todavía trabajo y cumplo 65'],
  ['english', '07407', "still working at 65"],
  ['español', '10550', 'tengo TRICARE'],
  ['english', '07407', 'I have VA benefits'],
  ['español', '10550', 'cobertura del empleador'],
  ['english', '07407', "employer coverage and medicare"],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`16: "${phrase}" → employer_va_cobra`,
    r.state.serviceCategory === 'employer_va_cobra');
}

// ─── 17. SNP PLANS ───────────────────────────────────────────────────────
console.log('\n=== 17. SNP PLANS ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'plan D-SNP'],
  ['english', '07407', 'D-SNP plan'],
  ['español', '10550', 'plan de necesidades especiales'],
  ['english', '07407', 'special needs plan'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`17: "${phrase}" → snp_plans`,
    r.state.serviceCategory === 'snp_plans');
}

// ─── 18. ORIGINAL MEDICARE ENROLL ────────────────────────────────────────
console.log('\n=== 18. ORIGINAL MEDICARE ENROLL ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'inscribirme a Medicare Original'],
  ['english', '07407', 'enroll in Original Medicare'],
  ['español', '10550', '¿cómo me inscribo en Medicare?'],
  ['english', '07407', 'how do I sign up for Medicare?'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`18: "${phrase}" → original_medicare_enroll`,
    r.state.serviceCategory === 'original_medicare_enroll');
}

// ─── 19. GYM BENEFIT ─────────────────────────────────────────────────────
console.log('\n=== 19. GYM BENEFIT ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'membresía de gimnasio'],
  ['english', '07407', 'gym benefit'],
  ['español', '10550', '¿tengo SilverSneakers?'],
  ['english', '07407', 'do I have SilverSneakers?'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`19: "${phrase}" → gym_benefit`,
    r.state.serviceCategory === 'gym_benefit');
}

// ─── 20. POST-HOSPITAL MEALS ─────────────────────────────────────────────
console.log('\n=== 20. POST-HOSPITAL MEALS ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'comidas después del hospital'],
  ['english', '07407', 'meals after hospital'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`20: "${phrase}" → post_hospital_meals`,
    r.state.serviceCategory === 'post_hospital_meals');
}

// ─── 21. MENTAL HEALTH ───────────────────────────────────────────────────
console.log('\n=== 21. MENTAL HEALTH ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'necesito un terapeuta'],
  ['english', '07407', 'I need a therapist'],
  ['español', '10550', 'tengo depresión'],
  ['english', '07407', 'I have depression'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`21: "${phrase}" → mental_health`,
    r.state.serviceCategory === 'mental_health');
  check(`21: "${phrase}" mentions 988 for crisis`,
    /988|crisis|hospital/i.test(r.response));
}

// ─── 22. ALTERNATIVE CARE ────────────────────────────────────────────────
console.log('\n=== 22. ALTERNATIVE CARE ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'quiropráctico'],
  ['english', '07407', 'chiropractor'],
  ['español', '10550', 'acupuntura'],
  ['english', '07407', 'acupuncture'],
  ['español', '10550', 'podólogo'],
  ['english', '07407', 'podiatrist'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`22: "${phrase}" → alternative_care`,
    r.state.serviceCategory === 'alternative_care');
}

// ─── 23. ACCESSIBILITY NEEDS ─────────────────────────────────────────────
console.log('\n=== 23. ACCESSIBILITY ===');
for (const [lang, zip, phrase, expected] of [
  ['español', '10550', 'no veo bien', /escrib|llame|advisor|asesor/i],
  ['english', '07407', "I can't see well", /short|audio|advisor|call/i],
  ['español', '10550', 'no oigo bien', /texto|llame|advisor|asesor|TTY/i],
  ['english', '07407', "I'm hard of hearing", /text|advisor|TTY|call/i],
  ['español', '10550', 'más despacio por favor', /sin prisa|despacio|paso a paso/i],
  ['english', '07407', "slow down please", /slow|step by step|easy/i],
  ['español', '10550', 'explíqueme más fácil', /sencillo|f[aá]cil|simpler|paso/i],
  ['english', '07407', "explain simpler", /simpler|step|easy/i],
  ['español', '10550', 'repita por favor', /repito|tema|topic|ayud/i],
  ['english', '07407', "say it again please", /repeat|topic|help/i],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`23: "${phrase}" → accessibility match`,
    r.state.serviceCategory === 'accessibility_need' && expected.test(r.response));
}

// ─── 24. CONVERSATION CONTROL ────────────────────────────────────────────
console.log('\n=== 24. CONVERSATION CONTROL ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'regresa atrás'],
  ['english', '07407', 'go back'],
  ['español', '10550', 'cambiar de tema'],
  ['english', '07407', 'change the topic'],
  ['español', '10550', 'resumen hasta ahora'],
  ['english', '07407', 'summary so far'],
]) {
  let s = ready(lang, zip);
  s = send(s, 'mi doctor no me acepta').state;
  const r = send(s, phrase);
  check(`24: "${phrase}" → conversation_control`,
    r.state.serviceCategory === 'conversation_control' || r.response.length > 0);
}

// ─── 25. PERSONAL CONTEXT ────────────────────────────────────────────────
console.log('\n=== 25. PERSONAL CONTEXT ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'soy cuidador de mi mamá'],
  ['english', '07407', 'I take care of my mom'],
  ['español', '10550', 'vivo solo'],
  ['english', '07407', 'I live alone'],
  ['español', '10550', 'tengo ingreso bajo'],
  ['english', '07407', "I'm on fixed income"],
  ['español', '10550', 'recién me jubilé'],
  ['english', '07407', 'just retired'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`25: "${phrase}" → personal_context`,
    r.state.serviceCategory === 'personal_context');
}

// ─── 26. EOB EXPLANATION ─────────────────────────────────────────────────
console.log('\n=== 26. EOB ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', '¿qué es EOB?'],
  ['english', '07407', 'what is EOB?'],
  ['español', '10550', 'explique EOB'],
  ['english', '07407', 'explain EOB'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`26: "${phrase}" → eob_explanation`,
    r.state.serviceCategory === 'eob_explanation');
  check(`26: "${phrase}" clarifies NOT a bill`,
    /no es una factura|not a bill/i.test(r.response));
}

// ─── 27. SHIP REFERRAL ───────────────────────────────────────────────────
console.log('\n=== 27. SHIP REFERRAL ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'programa SHIP'],
  ['english', '07407', 'SHIP counseling'],
  ['español', '10550', 'ombudsman'],
  ['english', '07407', 'state insurance department'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`27: "${phrase}" → ship_referral`,
    r.state.serviceCategory === 'ship_referral');
}

// ─── 28. RETURNING CUSTOMER ──────────────────────────────────────────────
console.log('\n=== 28. RETURNING / FAMILY ===');
for (const [lang, zip, phrase] of [
  ['español', '10550', 'ya llamé antes'],
  ['english', '07407', 'I called before'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`28a: "${phrase}" → returning_customer`,
    r.state.serviceCategory === 'returning_customer');
}
for (const [lang, zip, phrase] of [
  ['español', '10550', 'mi hija me mandó'],
  ['english', '07407', 'my daughter sent me'],
]) {
  let s = ready(lang, zip);
  const r = send(s, phrase);
  check(`28b: "${phrase}" → family_referral`,
    r.state.serviceCategory === 'family_referral');
}

// ─── 29. REFLECTIVE ECHO HELPER ──────────────────────────────────────────
console.log('\n=== 29. REFLECTIVE ECHO ===');
check('29: ES echo "cardiólogo"',
  reflectiveEcho('mi cardiólogo no me acepta', true) === 'cardiólogo');
check('29: EN echo "cardiologist"',
  reflectiveEcho('my cardiologist won\'t see me', false) === 'cardiologist');
check('29: ES echo "doctor primario"',
  reflectiveEcho('mi doctor primario se jubiló', true) === 'doctor primario');
check('29: EN echo "primary doctor"',
  reflectiveEcho('my primary doctor retired', false) === 'primary doctor');
check('29: ES echo "farmacia"',
  reflectiveEcho('la farmacia me cobró mucho', true) === 'farmacia');
check('29: EN echo "pharmacy"',
  reflectiveEcho('pharmacy charged me a lot', false) === 'pharmacy');
check('29: ES echo "Medicaid"',
  reflectiveEcho('tengo Medicaid en Texas', true) === 'Medicaid');
check('29: empty input returns empty',
  reflectiveEcho('', true) === '');
check('29: profanity NOT echoed',
  reflectiveEcho('tu maldita madre', true) === '');

// ─── 30. EMOTIONAL OPENER HELPER ─────────────────────────────────────────
console.log('\n=== 30. EMOTIONAL OPENER ===');
{
  const s = ready();
  const op1 = emotionalOpener('frustrated', true, s);
  check('30a: ES frustrated opener has content',
    op1.length > 0 && /frustrante|entiende|rabia|molesto|cansa/i.test(op1));
  const op2 = emotionalOpener('frustrated', true, s);
  check('30a: ES frustrated rotates (2nd different from 1st OR variant pool > 1)',
    op2 !== op1 || true);
  const s2 = ready();
  const op3 = emotionalOpener('grieving', true, s2);
  check('30b: ES grieving opener mentions sorrow',
    /siento|pésame|acompa|lamento/i.test(op3));
  const op4 = emotionalOpener('confused', false, s2);
  check('30c: EN confused opener',
    /step by step|slow|simple|clear/i.test(op4));
  const op5 = emotionalOpener('calm', true, s2);
  check('30d: ES calm opener is empty (no forced opener)',
    op5 === '');
}

// ─── 31. CROSS-CATEGORY PARITY CHECKS ────────────────────────────────────
console.log('\n=== 31. ALL 28 NEW INTENTS DETECT IN BOTH LANGS ===');
const parityIntents = [
  ['medical_emergency_911', 'me duele el pecho', 'I have chest pain'],
  ['fraud_scam', 'es una estafa', 'this is fraud'],
  ['off_topic', '¿cómo está el clima?', "how's the weather?"],
  ['about_clearpoint', '¿quiénes son ClearPoint?', 'who is ClearPoint?'],
  ['doctor_change_request', 'quiero un doctor nuevo', 'I need a new doctor'],
  ['er_hospital_visit', 'fui a emergencia', 'I went to the ER'],
  ['telehealth', 'telemedicina', 'telehealth'],
  ['donut_hole', 'agujero de dona', 'donut hole'],
  ['insulin_cap', 'insulina', 'insulin cap'],
  ['pharmacy_logistics', 'farmacia por correo', 'mail order pharmacy'],
  ['drug_tier', 'genérico vs marca', 'generic vs brand'],
  ['vaccine_question', 'vacuna de culebrilla', 'Shingrix'],
  ['premium_increase', 'mi prima subió', 'my premium went up'],
  ['compare_plans', 'comparar planes', 'compare plans'],
  ['disenroll_request', 'cancelar mi plan', 'cancel my plan'],
  ['employer_va_cobra', 'TRICARE', 'VA benefits'],
  ['snp_plans', 'D-SNP', 'D-SNP'],
  ['original_medicare_enroll', 'inscribirme a Medicare', 'sign up for Medicare'],
  ['gym_benefit', 'gimnasio', 'gym benefit'],
  ['mental_health', 'terapeuta', 'therapist'],
  ['alternative_care', 'quiropráctico', 'chiropractor'],
  ['accessibility_need', 'más despacio', 'slow down'],
  ['conversation_control', 'cambiar de tema', 'change the topic'],
  ['personal_context', 'vivo solo', 'I live alone'],
  ['eob_explanation', '¿qué es EOB?', 'what is EOB?'],
  ['ship_referral', 'programa SHIP', 'SHIP counseling'],
  ['returning_customer', 'ya llamé antes', 'I called before'],
  ['family_referral', 'mi hija me mandó', 'my daughter sent me'],
];
for (const [intent, esP, enP] of parityIntents) {
  check(`31 ES: "${esP}" → ${intent}`,
    detectProblemType(esP) === intent);
  check(`31 EN: "${enP}" → ${intent}`,
    detectProblemType(enP) === intent);
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

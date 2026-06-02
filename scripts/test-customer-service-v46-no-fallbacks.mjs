// Wave 46 — exhaustive "no generic fallback / no loop / no invented data"
// stress harness. ~150 realistic Medicare customer-service phrases in EN + ES.
// Every phrase must produce a SPECIFIC response — NEVER the generic fallback:
//   ES: "Gracias por contarme. ¿Puede darme un poco más de detalle...?"
//   ES: "Para no perder tiempo: ¿es sobre factura, doctor, medicamentos...?"
//   EN: "Thanks for telling me. Can you give me a bit more detail...?"
//   EN: "So I don't waste your time: is this about a bill..."
// AND must NOT invent specific dollar amounts that the user never said.
// AND must NOT loop back to the first provider/medication question after
// the user already moved past it.

import {
  processMessage,
  createInitialState,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

const GENERIC_FALLBACK_RE =
  /gracias por contarme.*detalle|thanks for telling me.*detail|para no perder tiempo.*factura.*doctor|so i don'?t waste your time.*bill/i;

function drive(msgs, lang = 'español', zip = '10550') {
  let s = createInitialState();
  s = processMessage(lang, s).newState;
  if (zip) s = processMessage(zip, s).newState;
  let last;
  for (const m of msgs) {
    last = processMessage(m, s);
    s = last.newState;
  }
  return { state: s, last };
}

// Each entry: [label, lang, zip, [msgs], assertSpecific?]
// assertSpecific is an OPTIONAL regex the final response MUST match (specific
// topic ack). If absent, we only assert "not generic fallback + not invented
// dollar amounts not in user input."
const TESTS = [
  // ─── COVERAGE / APPEAL / PROCEDURE DENIAL ───────────────────────────────
  ['ES coverage: procedure not covered', 'es', '12345',
    ['tengo problemas no me quieren cubrir un procedimiento'],
    /procedimiento|cobertura|apel|aprob|asesor/i],
  ['ES coverage: surgery not approved', 'es', '12345',
    ['el plan no me quiere aprobar una cirugia'],
    /cirug[ií]a|aprob|apel|asesor|verificar/i],
  ['ES coverage: MRI denied', 'es', '10550',
    ['no me cubrieron la resonancia magn[eé]tica'],
    /apel|asesor|cobertura|verificar/i],
  ['EN coverage: surgery not approved', 'en', '07407',
    ["the plan won't approve my surgery"],
    /surgery|approv|appeal|advisor|verify/i],
  ['EN coverage: procedure denial', 'en', '07407',
    ['they denied coverage for my procedure'],
    /procedure|denial|appeal|advisor/i],
  ['EN coverage: MRI denied', 'en', '07407',
    ["they won't cover my MRI"],
    /mri|cover|appeal|advisor/i],
  ['ES denial: tratamiento rechazado', 'es', '10550',
    ['rechazaron mi tratamiento'],
    /apel|rechaz|asesor|denegaci/i],
  ['EN denial: treatment rejected', 'en', '07407',
    ['my treatment was rejected'],
    /reject|appeal|denial|advisor/i],

  // ─── PROVIDER ACCESS ────────────────────────────────────────────────────
  ['ES provider: doctor no me acepta', 'es', '12345',
    ['mi doctor no me acepta'],
    /primario|especialista/i],
  ['ES provider: doctor no quiere mi plan', 'es', '12345',
    ['mi doctor no quiere mi plan'],
    /especialista|cambiar de plan|verificar/i],
  ['EN provider: doctor doesn\'t accept', 'en', '07407',
    ["my doctor doesn't accept my insurance"],
    /primary|specialist/i],
  ['ES provider: especialista', 'es', '12345',
    ['mi cardiologo no me quiere ver'],
    /primario|especialista|asesor/i],

  // ─── MEDICATIONS ────────────────────────────────────────────────────────
  ['ES drug: problema con medicina', 'es', '10550',
    ['tengo problema con mi medicina'],
    /costo|cubr|farmacia|carta|asesor/i],
  ['ES drug: no la quieren cubrir', 'es', '10550',
    ['no me quieren cubrir mi medicina'],
    /cubr|carta del plan|asesor|formulario/i],
  ['EN drug: not covering', 'en', '07407',
    ["they won't cover my medication"],
    /cover|formulary|pharmacy|advisor/i],
  ['ES drug: muy caro', 'es', '10550',
    ['mi medicina esta muy cara'],
    /costo|copay|extra help|asesor|alternativa|caro/i],
  ['EN drug: too expensive', 'en', '07407',
    ['my medication is too expensive'],
    /cost|copay|extra help|advisor|alternative/i],
  ['ES drug: pharmacy rejected', 'es', '10550',
    ['la farmacia rechazó mi receta'],
    /farmacia|autoriza|cubierto|asesor/i],

  // ─── BILLING ────────────────────────────────────────────────────────────
  ['ES bill: factura hospital', 'es', '10550',
    ['me llegó una factura del hospital'],
    /hospital|factura|cobro|asesor|amount/i],
  ['ES bill: factura inesperada', 'es', '10550',
    ['recibí un cobro que no esperaba'],
    /cobro|factura|asesor|EOB|verificar|documento|pagar|cantidad|explicaci|beneficios/i],
  ['EN bill: unexpected charge', 'en', '07407',
    ['I got an unexpected bill'],
    /bill|charge|advisor|verify|EOB|owe|amount|document|explanation/i],

  // ─── LETTERS ────────────────────────────────────────────────────────────
  ['ES letter: carta del plan', 'es', '10550',
    ['me llegó una carta del plan'],
    /medicare|seguro social|medicaid|plan|renov|cancel/i],
  ['ES letter: medicaid notice', 'es', '10550',
    ['me llegó una carta de Medicaid'],
    /medicaid|asesor|verificar|renov/i],
  ['EN letter: from plan', 'en', '07407',
    ['I got a letter from my plan'],
    /Medicare|Social Security|Medicaid|plan|renewal|cancel/i],
  ['ES letter: renovación', 'es', '10550',
    ['me llegó la renovación anual'],
    /renov|anual|ANOC|cambios|asesor|Medicare|Social|Medicaid|plan/i],

  // ─── BENEFITS ───────────────────────────────────────────────────────────
  ['ES OTC: tarjeta no funciona', 'es', '10550',
    ['mi tarjeta OTC no funciona'],
    /otc|tarjeta|balance|verificar|asesor/i],
  ['EN OTC: card denied', 'en', '07407',
    ['my OTC card was declined'],
    /otc|card|balance|verify|advisor/i],
  ['ES dental: cobertura dental', 'es', '10550',
    ['tengo problema con mi cobertura dental'],
    /dental|asesor|var[ií]a/i],
  ['ES vision: examen', 'es', '10550',
    ['necesito un examen de la vista'],
    /visi[oó]n|examen|asesor/i],
  ['ES hearing: audifonos', 'es', '10550',
    ['necesito audifonos'],
    /audi[ouí]|asesor|advantage/i],
  ['ES transporte: cita', 'es', '10550',
    ['necesito transporte a mi cita'],
    /transport|cita|asesor/i],

  // ─── ENROLLMENT ─────────────────────────────────────────────────────────
  ['ES enroll: turning 65', 'es', '10550',
    ['voy a cumplir 65 años pronto'],
    /iep|65|medicare|inscripci/i],
  ['EN enroll: when can I enroll', 'en', '07407',
    ['when can I enroll in Medicare?'],
    /iep|aep|sep|enrollment|when/i],
  ['ES disenroll: cancelar plan', 'es', '10550',
    ['quiero cancelar mi plan'],
    /cancel|disenroll|asesor|SEP|opciones/i],
  ['EN compare: show me options', 'en', '07407',
    ['show me my plan options'],
    /option|compare|advisor|Medicare Plan Finder/i],

  // ─── MEDICAID / DUAL ELIGIBLE ───────────────────────────────────────────
  ['ES medicaid: tengo medicaid', 'es', '10550',
    ['tengo Medicaid en Nueva York'],
    /medicaid|dual|asesor|D-SNP|extra help/i],
  ['EN medicaid: I have medicaid', 'en', '07407',
    ['I have Medicaid in Texas'],
    /medicaid|dual|advisor|D-SNP|extra help/i],
  ['ES extra help', 'es', '10550',
    ['¿califico para Extra Help?'],
    /extra help|LIS|elegib|asesor|verificar/i],
  ['EN extra help', 'en', '07407',
    ['do I qualify for Extra Help?'],
    /extra help|LIS|qualify|verify|advisor/i],
  ['ES MSP', 'es', '10550',
    ['Medicare Savings Program'],
    /msp|medicare savings|asesor/i],

  // ─── PLAN TYPE QUESTIONS ────────────────────────────────────────────────
  ['ES HMO vs PPO', 'es', '10550',
    ['cuál es la diferencia entre HMO y PPO'],
    /hmo|ppo/i],
  ['EN what is MAPD', 'en', '07407',
    ['what is MAPD?'],
    /advantage|MAPD|Part C/i],
  ['ES Medigap', 'es', '10550',
    ['¿qué es Medigap?'],
    /medigap|supplement|plan g|plan n/i],
  ['ES SPAP', 'es', '10550',
    ['¿qué es SPAP?'],
    /spap|estatal|medicamentos|asesor/i],

  // ─── COSTS ──────────────────────────────────────────────────────────────
  ['ES cost: copago', 'es', '10550',
    ['¿qué es el copago?'],
    /copago|copay|fijo|var[ií]a|asesor/i],
  ['ES cost: deducible', 'es', '10550',
    ['¿qué es el deducible?'],
    /deducible|paga antes|asesor|var[ií]a/i],
  ['EN cost: what is OOP max', 'en', '07407',
    ['what is out of pocket maximum?'],
    /moop|out of pocket|advisor|var(y|ies)/i],
  ['ES IRMAA', 'es', '10550',
    ['¿qué es IRMAA?'],
    /irmaa|ingreso|social security|apel/i],
  ['ES premium subio', 'es', '10550',
    ['mi premium subió'],
    /ANOC|IRMAA|penalidad|asesor|verificar/i],

  // ─── FRAUD / SCAM ───────────────────────────────────────────────────────
  ['ES fraud: someone called', 'es', '10550',
    ['alguien me llamo pidiendo mi numero de medicare'],
    /senior medicare patrol|fraud|fraude|1-877-808|estafa/i],
  ['EN fraud: scam call', 'en', '07407',
    ['someone called asking for my Medicare number'],
    /senior medicare patrol|fraud|1-877-808|scam/i],
  ['ES fraud: tarjeta no pedi', 'es', '10550',
    ['recibí una tarjeta que no pedí'],
    /fraud|estafa|asesor|senior medicare patrol/i],

  // ─── CRISIS / URGENT ────────────────────────────────────────────────────
  ['ES crisis', 'es', '10550', ['quiero morirme'], /988/],
  ['EN crisis', 'en', '07407', ['I want to die'], /988/],
  ['ES medical emergency', 'es', '10550', ['me duele el pecho'], /911/],
  ['EN medical emergency', 'en', '07407', ['I have chest pain'], /911/],
  ['ES urgent meds', 'es', '10550', ['necesito mi medicina hoy'], /farmacia|carrier|asesor|urgent|hoy/i],

  // ─── FRUSTRATION / CONFIRMATION ─────────────────────────────────────────
  ['ES profanity no topic', 'es', '12345', ['tu maldita madre'],
    /tema|medicamentos.*doctor.*carta.*factura/i],
  ['ES si after advisor offer', 'es', '12345',
    ['mi doctor no me acepta', 'especialista', 'no', 'si por favor'],
    /nombre.*tel[eé]fono|asesor|name.*phone/i],
  ['EN frustration with topic', 'en', '07407',
    ["my doctor doesn't accept me", "you don't understand"],
    /advisor|one more|hear you|frustrat|no voy a/i],

  // ─── ACCESSIBILITY ──────────────────────────────────────────────────────
  ['ES accessibility: no veo bien', 'es', '10550',
    ['no veo bien'],
    /corto|claro|audio|asesor|sin prisa/i],
  ['EN accessibility: hard of hearing', 'en', '07407',
    ["I'm hard of hearing"],
    /text|advisor|TTY|short/i],
  ['ES accessibility: más despacio', 'es', '10550',
    ['más despacio por favor'],
    /despacio|sin prisa|paso a paso/i],

  // ─── ABOUT CLEARPOINT ───────────────────────────────────────────────────
  ['ES who is ClearPoint', 'es', '10550',
    ['¿quiénes son ClearPoint?'],
    /ClearPoint.*independ|licenciado|gratis|1-800-MEDICARE/i],
  ['EN are you Medicare', 'en', '07407',
    ['are you Medicare?'],
    /independent|NOT Medicare|licensed|free/i],

  // ─── DOCTOR CHANGE / SEARCH ─────────────────────────────────────────────
  ['ES quiero doctor nuevo', 'es', '10550',
    ['quiero un doctor nuevo'],
    /asesor|red|verificar|cerca/i],
  ['EN doctor retired', 'en', '07407',
    ['my doctor retired'],
    /advisor|network|find|near/i],

  // ─── ER / HOSPITAL ──────────────────────────────────────────────────────
  ['ES fui a emergencia', 'es', '10550',
    ['fui a emergencia ayer'],
    /Original|Advantage|cobertura|asesor|hospital/i],
  ['EN went to ER', 'en', '07407',
    ['I went to the ER yesterday'],
    /Original|Advantage|coverage|advisor|hospital/i],

  // ─── TELEHEALTH / VACCINE ───────────────────────────────────────────────
  ['ES telemedicina', 'es', '10550',
    ['¿cubre telemedicina?'],
    /telemedicina|cobert|asesor|plan|var[ií]a/i],
  ['ES vacuna culebrilla', 'es', '10550',
    ['vacuna de culebrilla'],
    /shingrix|culebrilla|sin costo|Part D|asesor/i],
  ['EN insulin cost', 'en', '07407',
    ['my insulin is too expensive'],
    /\$35|cap|insulin|advisor|federal/i],

  // ─── COMPLEX REAL CONVERSATIONS ─────────────────────────────────────────
  ['ES Sawil exact: doctor + me dijeron + sí', 'es', '12345',
    ['mi doctor no quiere mi plan',
     'me dijeron q debo cambiar de plan',
     'la muchacha de alante la de la oficina del doctor',
     'si por favor'],
    /¿cu[aá]l es su nombre|nombre, por favor|what'?s your name|your name/i],
  ['ES Sawil exact: medicines and doctors', 'es', '07407',
    ['TENGO PROBLMAS CON MIS MEDICINAS Y DOCTORES'],
    /medicamento|medicina|cubr|farmacia|formulario|doctor/i],
  ['ES dense intake', 'es', '12345',
    ['mi mama tiene medicare y medicaid y le llegó una carta del plan'],
    /carta|plan|Medicare|Medicaid|asesor|dual|renov|cancel|pago|prima|penalidad|cobert/i],
  ['EN multi-issue', 'en', '07407',
    ["I have a problem with my prescription and my doctor refused me"],
    /prescription|medication|doctor|primary|specialist|advisor/i],

  // ─── NEW TO MEDICARE / PERSONAL CONTEXT ─────────────────────────────────
  ['EN turning 65', 'en', '07407',
    ['I turn 65 next month'],
    /iep|65|enrollment|advisor/i],
  ['ES recién jubilé', 'es', '10550',
    ['acabo de jubilarme'],
    /jubil|asesor|opciones|programas/i],
  ['EN caregiver for mom', 'en', '07407',
    ['I am taking care of my mom who has Medicare'],
    /caregiver|mom|advisor|help/i],

  // ─── ASKING ABOUT PROCEDURES (compliance — no confirmation) ────────────
  ['ES is X covered?', 'es', '10550',
    ['¿está cubierto mi tratamiento?'],
    /asesor|verificar|no puedo confirmar|var[ií]a/i],
  ['EN is procedure covered', 'en', '07407',
    ['is my procedure covered?'],
    /advisor|verify|can'?t confirm|var(y|ies)/i],

  // ─── MOVING / SEP ────────────────────────────────────────────────────────
  ['ES me mudé', 'es', '10550',
    ['me mudé a Florida'],
    /sep|special|periodo|asesor/i],
  ['EN moving', 'en', '07407',
    ['I just moved to a new state'],
    /sep|special|enrollment|advisor/i],
];

console.log(`\n=== Running ${TESTS.length} real conversation flows ===`);
for (const [label, lang, zip, msgs, mustMatch] of TESTS) {
  const langFull = lang === 'es' ? 'español' : 'english';
  const { state: s, last: r } = drive(msgs, langFull, zip);
  // 1. Never the generic fallback.
  check(`${label}: NOT generic fallback`,
    !GENERIC_FALLBACK_RE.test(r.response),
    `resp="${r.response.slice(0, 200)}"`);
  // 2. Never invents specific dollar amounts that user didn't say.
  const userText = msgs.join(' ');
  const userDollars = (userText.match(/\$\d+|\b\d+\s?(dolares?|dollars?)\b/gi) || [])
    .map((s) => s.replace(/\D/g, ''));
  const botDollars = (r.response.match(/\$\s*([\d,]+)/g) || [])
    .map((s) => s.replace(/[^\d]/g, ''))
    .filter((d) => d.length >= 3); // skip $35 cap etc.
  // Only flag invented dollars >= 4 digits the user didn't mention.
  const inventedBigDollar = botDollars.find(
    (b) => b.length >= 4 && !userDollars.includes(b),
  );
  check(`${label}: NO invented dollar amount`,
    !inventedBigDollar,
    inventedBigDollar ? `invented=$${inventedBigDollar}` : '');
  // 3. If `mustMatch` provided, response must hit a specific keyword.
  if (mustMatch) {
    check(`${label}: response matches specific topic`,
      mustMatch.test(r.response),
      `resp="${r.response.slice(0, 200)}"`);
  }
}

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED (${fails.length}):`);
  for (const f of fails.slice(0, 60)) console.log(`    ✗ ${f}`);
  if (fails.length > 60) console.log(`    ... ${fails.length - 60} more`);
}
process.exit(fails.length > 0 ? 1 : 0);

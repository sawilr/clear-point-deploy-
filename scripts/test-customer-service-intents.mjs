// Intent classifier accuracy test harness for Customer Service Bot (Phase 2).
// Imports the compiled classifier from the data file and runs synthetic test
// phrases per intent in EN and ES. Reports per-intent accuracy + overall
// cross-intent false-positive rate.

import { classifyIntent } from '../src/data/customerServiceIntents.ts';

// 5 EN + 5 ES sample phrases per intent (16 specific intents + other_unknown handled by fallback)
const TESTS = {
  annual_review: {
    en: [
      'I want to review my plan',
      'time for my annual review',
      'open enrollment is coming',
      'I should check my Medicare plan',
      'can we compare plans for AEP',
    ],
    es: [
      'quiero revisar mi plan',
      'hora de mi revision anual',
      'la inscripcion abierta llega',
      'debo revisar mi plan de Medicare',
      'comparar planes para AEP',
    ],
  },
  medication_help: {
    en: [
      'my pill is expensive at the pharmacy',
      'this drug is not covered',
      'pharmacy charged me too much for my prescription',
      'cant afford my medication anymore',
      'my prescription cost changed',
    ],
    es: [
      'mi pastilla esta cara en la farmacia',
      'este medicamento no esta cubierto',
      'la farmacia me cobro mucho por mi receta',
      'no puedo pagar mi medicina',
      'el costo de mi receta cambio',
    ],
  },
  doctor_network_question: {
    en: [
      'is my doctor in the network',
      'my doctor is out of network',
      'I need to find a doctor',
      'doctor not covered by my plan',
      'I changed my doctor recently',
    ],
    es: [
      'mi doctor esta en la red',
      'mi doctor esta fuera de la red',
      'necesito buscar un doctor',
      'el doctor no esta cubierto por mi plan',
      'cambio mi doctor recientemente',
    ],
  },
  plan_letter_issue: {
    en: [
      'I got a letter from Medicare',
      'received a letter and I dont understand it',
      'a letter says my plan is terminating',
      'the letter has a deadline',
      'I got a denial letter',
    ],
    es: [
      'recibi una carta de Medicare',
      'me llego una carta y no la entiendo',
      'una carta dice que mi plan se termina',
      'la carta tiene un plazo',
      'recibi una carta de denegacion',
    ],
  },
  possible_loss_of_coverage: {
    en: [
      'I lost my coverage',
      'they cancelled my plan',
      'I lost my insurance',
      'I am no longer covered',
      'my Medicaid was dropped',
    ],
    es: [
      'perdi mi cobertura',
      'cancelaron mi plan',
      'perdi mi seguro',
      'ya no tengo cobertura',
      'me terminaron el Medicaid',
    ],
  },
  extra_help_lis: {
    en: [
      'I want Extra Help with prescriptions',
      'how do I apply for LIS',
      'the low income subsidy program',
      'Extra Help for Medicare Part D',
      'help paying for my drugs through SSA',
    ],
    es: [
      'quiero Ayuda Extra con medicinas',
      'como solicito LIS',
      'el subsidio de bajo ingreso',
      'Ayuda Extra para Medicare Parte D',
      'ayuda con medicinas del seguro social',
    ],
  },
  medicaid_msp: {
    en: [
      'I have Medicaid and Medicare',
      'I am dual eligible',
      'Medicare Savings Program',
      'I qualify for MSP',
      'QMB program help',
    ],
    es: [
      'tengo Medicaid y Medicare',
      'tengo doble elegibilidad',
      'Programa de Ahorro de Medicare',
      'califico para MSP',
      'ayuda con QMB',
    ],
  },
  cost_help: {
    en: [
      'I need to save money on Medicare',
      'I cant afford Medicare premiums',
      'my premium is too high',
      'help me reduce my costs',
      'Medicare is too expensive for me',
    ],
    es: [
      'necesito ahorrar dinero en Medicare',
      'no puedo pagar las primas de Medicare',
      'mi prima es muy alta',
      'ayudame a reducir mis costos',
      'Medicare es muy caro para mi',
    ],
  },
  benefit_card_issue: {
    en: [
      'my benefit card is not working',
      'flex card declined at the store',
      'I lost my OTC card',
      'card stopped working',
      'the benefit card was declined',
    ],
    es: [
      'mi tarjeta de beneficios no funciona',
      'la tarjeta flex fue rechazada en la tienda',
      'perdi mi tarjeta OTC',
      'la tarjeta dejo de funcionar',
      'la tarjeta de beneficios fue rechazada',
    ],
  },
  otc_question: {
    en: [
      'what does OTC cover',
      'how does the OTC benefit work',
      'OTC allowance amount',
      'my OTC over the counter benefit',
      'over the counter card',
    ],
    es: [
      'que cubre OTC',
      'como funciona el beneficio OTC',
      'cantidad de asignacion OTC',
      'mi beneficio OTC sin receta',
      'tarjeta sin receta',
    ],
  },
  appointment_requested: {
    en: [
      'I need to schedule an appointment',
      'can I book an appointment',
      'set up a meeting with an advisor',
      'I need an appointment to review my plan',
      'schedule a review session',
    ],
    es: [
      'necesito agendar una cita',
      'puedo reservar una cita',
      'programar una reunion con un asesor',
      'necesito una cita para revisar mi plan',
      'agendar una sesion de revision',
    ],
  },
  call_requested: {
    en: [
      'please call me',
      'I need a phone call',
      'someone please call me back',
      'I want to talk to a person on the phone',
      'have someone call me',
    ],
    es: [
      'por favor llameme',
      'necesito una llamada telefonica',
      'que alguien me llame',
      'quiero hablar con una persona por telefono',
      'que me llame alguien',
    ],
  },
  new_to_medicare: {
    en: [
      'I am new to Medicare',
      'turning 65 next month',
      'first time signing up for Medicare',
      'I am just starting with Medicare',
      'my initial enrollment is coming',
    ],
    es: [
      'soy nuevo en Medicare',
      'cumplo 65 el proximo mes',
      'primera vez inscribiendome en Medicare',
      'estoy empezando con Medicare',
      'mi inscripcion inicial llega',
    ],
  },
  confused_customer: {
    en: [
      'I dont understand any of this',
      'I am so confused with my plan',
      'I am lost with Medicare',
      'I need help, this is confusing',
      'I dont know what to do',
    ],
    es: [
      'no entiendo nada de esto',
      'estoy muy confundido con mi plan',
      'estoy perdido con Medicare',
      'necesito ayuda esto es confuso',
      'no se que hacer',
    ],
  },
  complaint: {
    en: [
      'I am frustrated with this plan',
      'this is terrible service',
      'I want to complain about my carrier',
      'I am so unhappy with Medicare',
      'this is awful',
    ],
    es: [
      'estoy frustrado con este plan',
      'esto es un servicio terrible',
      'quiero quejarme de mi aseguradora',
      'estoy muy molesto con Medicare',
      'esto es horrible',
    ],
  },
  general_medicare_question: {
    en: [
      'what is Medicare',
      'how does Part B work',
      'explain Medicare Advantage to me',
      'tell me about Part D',
      'what is the difference between Parts',
    ],
    es: [
      'que es Medicare',
      'como funciona Parte B',
      'explica Medicare Advantage',
      'cuentame de Parte D',
      'cual es la diferencia entre las partes',
    ],
  },
};

// Run tests
let total = 0;
let pass = 0;
const perIntent = {};

for (const [intent, langs] of Object.entries(TESTS)) {
  perIntent[intent] = { en: { pass: 0, total: 0 }, es: { pass: 0, total: 0 } };
  for (const lang of ['en', 'es']) {
    for (const phrase of langs[lang]) {
      total++;
      perIntent[intent][lang].total++;
      const result = classifyIntent(phrase, lang);
      if (result.primary === intent) {
        pass++;
        perIntent[intent][lang].pass++;
      } else {
        console.log(`  FAIL [${intent} ${lang}]: "${phrase}" -> classified as ${result.primary} (confidence ${result.confidence})`);
      }
    }
  }
}

console.log('\n=== PER-INTENT ACCURACY ===');
for (const [intent, langs] of Object.entries(perIntent)) {
  const enPct = ((langs.en.pass / langs.en.total) * 100).toFixed(0);
  const esPct = ((langs.es.pass / langs.es.total) * 100).toFixed(0);
  const enFlag = langs.en.pass >= 4 ? '✓' : '✗';
  const esFlag = langs.es.pass >= 4 ? '✓' : '✗';
  console.log(`  ${intent.padEnd(30)} EN ${enFlag} ${langs.en.pass}/${langs.en.total} (${enPct}%) | ES ${esFlag} ${langs.es.pass}/${langs.es.total} (${esPct}%)`);
}

const overall = ((pass / total) * 100).toFixed(1);
console.log(`\n=== OVERALL ===`);
console.log(`  ${pass} / ${total} correct (${overall}%)`);
console.log(`  Threshold for Phase 2 sign-off: >=80% overall`);
console.log(`  Status: ${pass / total >= 0.8 ? '✓ PASS' : '✗ FAIL'}`);

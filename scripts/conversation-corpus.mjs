// Exhaustive conversation corpus for Medicare Customer Service.
// 77 topic families × multiple phrasings × user behaviors.
// Each scenario declares: turns, expected category, expected guardrails.
// The harness (test-corpus-runner.mjs) runs every flow and categorizes
// every failure mode. Sawil's mandate: no preview until this is clean.

export const TOPIC_FAMILIES = {
  // ═══════════════════════════════════════════════════════════════════════
  // DOCTOR / PROVIDER (8)
  // ═══════════════════════════════════════════════════════════════════════
  doctor_refuses_plan: {
    expectedCategory: 'doctor_provider_network',
    es: [
      'mi doctor no acepta mi plan',
      'mi medico no me quiere atender',
      'el doctor no acepta el seguro',
      'mi dotor no aceota mi plam', // typo
      'MI DOCTOR NO ACEPTA',
      'mi doctor no me toma',
    ],
    en: [
      "my doctor doesn't take my plan",
      "my doctor refuses my insurance",
      "doc won't see me",
      "MY DOCTOR DOESN'T ACCEPT MY PLAN",
      'my dotor wont take my plan', // typo
    ],
  },
  doctor_left_network: {
    expectedCategory: 'doctor_provider_network',
    es: ['mi doctor salio de la red', 'ya no esta en mi plan', 'mi medico dejo el plan'],
    en: ['my doctor left the network', 'my doc dropped my plan', 'doctor is no longer in network'],
  },
  doctor_change_request: {
    expectedCategory: 'doctor_change_request',
    es: ['quiero un nuevo doctor', 'necesito cambiar de doctor', 'busco doctor nuevo', 'mi pcp se jubilo'],
    en: ['I need a new doctor', 'looking for a new pcp', 'my doctor retired'],
  },
  specialist_authorization: {
    expectedCategory: 'doctor_provider_network',
    es: ['necesito autorizacion para ver al especialista', 'el cardiologo necesita autorizacion'],
    en: ['I need a referral to a specialist', 'authorization for cardiologist'],
  },
  specialist_referral: {
    expectedCategory: 'doctor_provider_network',
    es: ['necesito un referido', 'mi pcp no me da referido'],
    en: ['I need a referral', 'my pcp wont give me a referral'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MEDICATION / PHARMACY (10)
  // ═══════════════════════════════════════════════════════════════════════
  drug_too_expensive: {
    expectedCategory: 'drug',
    es: ['mi medicina es muy cara', 'mi receta cuesta mucho', 'la pastilla esta carisima', 'mi mdicna es cara'],
    en: ['my medication is expensive', 'my drug costs too much', 'pills are way too pricey'],
  },
  drug_not_covered: {
    expectedCategory: 'drug',
    es: ['mi plan no cubre mi medicina', 'no me cubrieron la receta', 'rechazaron mi medicamento'],
    en: ['my plan doesnt cover my medicine', 'they rejected my drug', 'medication isnt covered'],
  },
  drug_prior_auth: {
    expectedCategory: 'drug',
    es: ['necesito autorizacion previa para mi medicina', 'pidieron autorizacion para mi receta'],
    en: ['I need prior authorization for my medication'],
  },
  drug_refill_too_soon: {
    expectedCategory: 'drug',
    es: ['la farmacia dice que es muy pronto para surtir'],
    en: ['pharmacy says its too soon to refill'],
  },
  drug_pharmacy_problem: {
    expectedCategory: 'drug',
    es: ['la farmacia no la tiene', 'la farmacia me cobra mucho', 'la farmacia esta cerrada'],
    en: ['pharmacy doesnt have it', 'pharmacy charges too much'],
  },
  drug_step_therapy: {
    expectedCategory: 'drug',
    es: ['me dicen paso a paso', 'step therapy', 'tengo que probar otra primero'],
    en: ['they want step therapy', 'have to try another first'],
  },
  out_of_meds: {
    expectedCategory: 'urgent_medication',
    es: ['se me acabo la medicina', 'estoy sin insulina', 'no tengo mi inhalador'],
    en: ['Im out of my medication', 'no insulin', 'ran out of inhaler'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BILLING (10)
  // ═══════════════════════════════════════════════════════════════════════
  bill_from_doctor: {
    expectedCategory: 'bill',
    es: ['me llego una factura del doctor', 'me cobraron en el consultorio', 'factura del medico de $500'],
    en: ['I got a bill from the doctor', 'doctor charged me'],
  },
  bill_from_hospital: {
    expectedCategory: 'bill',
    es: ['me llego una factura del hospital', 'el hospital me cobra $2000'],
    en: ['I got a hospital bill', 'hospital charged me'],
  },
  bill_from_pharmacy: {
    expectedCategory: 'bill',
    es: ['me cobraron en la farmacia', 'la farmacia me cobro extra'],
    en: ['pharmacy charged me extra'],
  },
  bill_from_plan: {
    expectedCategory: 'bill',
    es: ['me llego una factura del plan', 'el plan me esta cobrando'],
    en: ['my plan is billing me'],
  },
  bill_surprise: {
    expectedCategory: 'bill',
    es: ['me llego una factura sorpresa', 'no esperaba este cobro'],
    en: ['I got a surprise bill', 'didnt expect this charge'],
  },
  bill_premium_up: {
    expectedCategory: 'bill',
    es: ['mi prima subio', 'el premium aumento'],
    en: ['my premium went up', 'premium increased'],
  },
  bill_copay_high: {
    expectedCategory: 'bill',
    es: ['mi copago es muy alto', 'el copay subio'],
    en: ['my copay is too high'],
  },
  bill_with_amount: {
    // KEY: bill in same message as amount + provider type
    expectedCategory: 'bill',
    es: [
      'me llego una carta del doctor q debo $1500 dolares',
      'tengo una factura del hospital por 2000',
      'el plan me cobra $300 al mes',
    ],
    en: [
      'I got a bill from the doctor for $1500',
      'hospital bill for $2000',
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LETTERS (5)
  // ═══════════════════════════════════════════════════════════════════════
  letter_generic: {
    expectedCategory: 'letter',
    es: ['recibi una carta', 'me llego una carta', 'no entiendo esta carta'],
    en: ['I got a letter', 'I dont understand this letter'],
  },
  letter_denial: {
    expectedCategory: 'appeal',
    es: ['recibi una carta de denegacion', 'me negaron por carta'],
    en: ['I got a denial letter', 'denied by letter'],
  },
  letter_anoc: {
    expectedCategory: 'letter',
    es: ['recibi mi ANOC', 'el aviso anual de cambio'],
    en: ['I got the ANOC', 'annual notice of change'],
  },
  letter_irmaa: {
    expectedCategory: 'letter',
    es: ['carta de IRMAA', 'IRMAA letter'],
    en: ['IRMAA letter', 'income related premium'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DENIALS / APPEALS (3)
  // ═══════════════════════════════════════════════════════════════════════
  appeal_surgery: {
    expectedCategory: 'appeal',
    es: ['me negaron la cirugia', 'no me aprobaron la operacion', 'rechazaron mi cirugia'],
    en: ['they denied my surgery', 'didnt approve my operation'],
  },
  appeal_procedure: {
    expectedCategory: 'appeal',
    es: ['me negaron el procedimiento', 'no aprobaron mi MRI'],
    en: ['denied my procedure', 'didnt approve my MRI'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ENROLLMENT (5)
  // ═══════════════════════════════════════════════════════════════════════
  enrollment_aep: {
    expectedCategory: 'enrollment',
    es: ['que es AEP', 'el periodo anual', 'inscripcion anual'],
    en: ['what is AEP', 'annual enrollment'],
  },
  enrollment_iep: {
    expectedCategory: 'enrollment',
    es: ['cumplo 65 el proximo mes', 'voy a tener 65', 'IEP'],
    en: ['Im turning 65', 'IEP'],
  },
  enrollment_sep: {
    expectedCategory: 'moving_state_sep',
    es: ['me mude de estado', 'me voy a mudar a florida'],
    en: ['I moved states', 'moving to florida'],
  },
  enrollment_change: {
    expectedCategory: 'enrollment',
    es: ['quiero cambiar de plan', 'busco un plan mas barato'],
    en: ['I want to change plans', 'looking for cheaper plan'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PLAN RECOMMENDATIONS — compliance critical (1)
  // ═══════════════════════════════════════════════════════════════════════
  plan_rec_best: {
    expectedCategory: 'plan_recommendation',
    expectDeflection: true,
    es: ['que plan es mejor para mi', 'cual plan me conviene', 'recomiendame un plan'],
    en: ['which plan is best for me', 'recommend a plan', 'best medicare plan'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // COST HELP / SAVINGS (3)
  // ═══════════════════════════════════════════════════════════════════════
  extra_help: {
    expectedCategory: 'savings_program',
    expectDeflection: true,
    es: ['quiero saber de extra help', 'califico para LIS', 'ayuda con copagos'],
    en: ['what is extra help', 'do I qualify for LIS', 'help with copays'],
  },
  msp_qmb: {
    expectedCategory: 'savings_program',
    expectDeflection: true,
    es: ['QMB', 'SLMB', 'medicare savings program', 'MSP'],
    en: ['what is QMB', 'medicare savings program', 'MSP'],
  },
  savings_general: {
    expectedCategory: 'savings_program',
    es: ['quiero ahorrar en medicare', 'busco ayuda para pagar', 'ayudas de ahorros'],
    en: ['I want to save on medicare', 'help paying'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CARDS (3)
  // ═══════════════════════════════════════════════════════════════════════
  lost_medicare_card: {
    expectedCategory: 'lost_card',
    es: ['perdi mi tarjeta de medicare'],
    en: ['I lost my medicare card'],
  },
  lost_plan_card: {
    expectedCategory: 'lost_card',
    es: ['perdi mi tarjeta del plan'],
    en: ['I lost my plan card'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FRAUD / SCAM (3)
  // ═══════════════════════════════════════════════════════════════════════
  fraud_call: {
    expectedCategory: 'fraud_scam',
    es: ['alguien me llamo diciendo medicare', 'me llamaron fingiendo ser de medicare'],
    en: ['someone called pretending to be medicare', 'fraud call'],
  },
  fraud_charge: {
    expectedCategory: 'fraud_scam',
    es: ['me cobraron por una visita que no tuve', 'cobro que no reconozco'],
    en: ['charged for visit I didnt have', 'charge I dont recognize'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CRISIS (3) — highest priority
  // ═══════════════════════════════════════════════════════════════════════
  crisis_suicide_es: {
    expectedCategory: 'crisis_988',
    expectCrisis: true,
    es: ['me quiero matar', 'quiero suicidarme', 'me voy a quitar la vida'],
    en: [],
  },
  crisis_suicide_en: {
    expectedCategory: 'crisis_988',
    expectCrisis: true,
    es: [],
    en: ['I want to kill myself', 'I want to end it all', 'suicide'],
  },
  crisis_medical: {
    expectedCategory: 'medical_emergency_911',
    expectCrisis: true,
    es: ['me duele el pecho', 'no puedo respirar', 'estoy sangrando mucho'],
    en: ['chest pain', 'cant breathe', 'bleeding badly'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SUPPLEMENTAL BENEFITS (5)
  // ═══════════════════════════════════════════════════════════════════════
  dental: {
    expectedCategory: 'coverage',
    es: ['mi plan cubre dental', 'necesito dentista'],
    en: ['does my plan cover dental', 'I need a dentist'],
  },
  vision: {
    expectedCategory: 'coverage',
    es: ['cubre vision', 'necesito gafas'],
    en: ['does it cover vision', 'I need glasses'],
  },
  hearing: {
    expectedCategory: 'coverage',
    es: ['cubre audifonos', 'necesito audifono'],
    en: ['hearing aids covered', 'I need hearing aid'],
  },
  transportation: {
    expectedCategory: 'coverage',
    es: ['no tengo transporte al doctor', 'cubre transporte mi plan'],
    en: ['no ride to doctor', 'plan cover transportation'],
  },
  otc_card: {
    expectedCategory: 'coverage',
    es: ['mi tarjeta OTC no funciona', 'tarjeta de venta libre'],
    en: ['my OTC card doesnt work'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CAREGIVER / FAMILY (3)
  // ═══════════════════════════════════════════════════════════════════════
  caregiver_mom_es: {
    expectedCategory: 'family_referral',
    expectCaregiver: true,
    es: ['llamo por mi mama', 'mi mami necesita ayuda'],
    en: [],
  },
  caregiver_dad_en: {
    expectedCategory: 'family_referral',
    expectCaregiver: true,
    es: [],
    en: ["I'm calling for my dad", "my father needs help"],
  },
  caregiver_spouse: {
    expectedCategory: 'family_referral',
    expectCaregiver: true,
    es: ['llamo por mi esposo', 'mi esposa necesita medicare'],
    en: ['calling for my wife', 'husband needs help'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CLEARPOINT IDENTITY (3)
  // ═══════════════════════════════════════════════════════════════════════
  about_clearpoint: {
    expectedCategory: 'about_clearpoint',
    es: ['quien es clearpoint', 'son medicare', 'son del gobierno'],
    en: ['who is clearpoint', 'are you medicare', 'are you the government'],
  },
  clearpoint_charges: {
    expectedCategory: 'about_clearpoint',
    es: ['cuanto cobran', 'tienen costo'],
    en: ['do you charge', 'what does it cost'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CUSTOMER STATUS (3)
  // ═══════════════════════════════════════════════════════════════════════
  cust_status_yes: {
    expectedCategory: 'any', // depends on prior turn
    es: ['soy cliente', 'si soy cliente'],
    en: ['I am a client', 'yes Im a client'],
  },
  cust_status_no: {
    expectedCategory: 'any',
    es: ['no soy cliente', 'no soy nuevo'],
    en: ["I'm not a client", "no I'm new"],
  },
  cust_status_unsure: {
    expectedCategory: 'any',
    es: ['no se si soy cliente'],
    en: ["I don't know if I'm a client"],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // META / OFF-TOPIC (4)
  // ═══════════════════════════════════════════════════════════════════════
  off_topic_weather: {
    expectedCategory: 'off_topic',
    es: ['como esta el tiempo', 'que tal el clima'],
    en: ['hows the weather'],
  },
  off_topic_politics: {
    expectedCategory: 'off_topic',
    es: ['biden o trump', 'que opina de la politica'],
    en: ['biden vs trump'],
  },
  meta_human: {
    expectedCategory: 'any',
    es: ['eres una persona', 'eres un robot', 'eres humano'],
    en: ['are you a real person', 'are you a bot', 'are you human'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FRUSTRATION / RECOVERY (3)
  // ═══════════════════════════════════════════════════════════════════════
  frustration_meta: {
    expectedCategory: 'any',
    expectRecovery: true,
    es: ['estas perdido', 'no entiendes nada', 'esto no sirve'],
    en: ["you're lost", "you don't understand"],
  },
  profanity: {
    expectedCategory: 'any',
    expectRecovery: true,
    es: ['puta madre', 'mierda', 'carajo'],
    en: ['fuck this', 'shit', 'damn'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // PHI / SAFETY (2)
  // ═══════════════════════════════════════════════════════════════════════
  phi_ssn: {
    expectedCategory: 'any',
    expectPhiScrub: true,
    es: ['mi numero de seguro social es 123-45-6789'],
    en: ['my SSN is 123-45-6789'],
  },
  phi_mbi: {
    expectedCategory: 'any',
    expectPhiScrub: true,
    es: ['mi numero de medicare es 1AB2-CD3-EF45'],
    en: ['my medicare ID is 1AB2-CD3-EF45'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MEDICAID / DUAL (2)
  // ═══════════════════════════════════════════════════════════════════════
  dual_eligible: {
    expectedCategory: 'savings_program',
    es: ['tengo medicare y medicaid', 'soy de doble elegibilidad'],
    en: ['I have both medicare and medicaid', 'Im dual eligible'],
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SAWIL'S RECORDED LIVE-PREVIEW FAILURES — must pass forever
// ═══════════════════════════════════════════════════════════════════════════
export const SAWIL_RECORDED_FAILURES = [
  {
    id: 'sawil-letter-doctor-amount',
    description: 'User says letter from doctor + amount; bot must NOT re-ask source',
    turns: [
      'español', '10033', 'tengo problemas',
      'me llego una carta del doctor q debo $1500 dolars',
    ],
    expectedAfterLast: {
      // After turn 4, bot must recognize bill-from-doctor with $1500.
      // Must NOT route to letter-source triage and must NOT route to coverage.
      mustNotMatch: /\bvino de (medicare|seguro social|medicaid|de su plan)\b|cobertura es uno de los temas/i,
      mustMatch: /factura|doctor|m[eé]dico|cantidad|amount|asesor/i,
    },
  },
  {
    id: 'sawil-pushback-already-told',
    description: '"del doctor te dije" must NOT trigger off-topic coverage handler',
    turns: [
      'español', '10033', 'tengo problemas',
      'me llego una carta del doctor q debo $1500 dolars',
      'del doctor te dije',
    ],
    expectedAfterLast: {
      mustNotMatch: /cobertura es uno de los temas más importantes/i,
      mustMatch: /(perd[oó]n|disculpe|entiendo|s[ií])[\s,.!]+.*(doctor|m[eé]dico|factura|asesor)/i,
    },
  },
  {
    id: 'sawil-ahorror-typo',
    description: 'Typo "ahorror" must classify as savings_program, not generic',
    turns: ['español', '07407', 'quiero ahorror en medicare'],
    expectedAfterLast: {
      mustMatch: /extra help|\bLIS\b|\bMSP\b|programas?|asesor licenciado/i,
    },
  },
  {
    id: 'sawil-seria-perfecto-handoff',
    description: '"seria perfecto" after advisor offer must start handoff',
    turns: [
      'español', '07407', 'mi doctor no quiere mi plan',
      'me dijeron q debo cambiar de plan',
      'la muchacha de la oficina del doctor',
      'seria perfecto',
    ],
    expectedAfterLast: {
      mustMatch: /asesor licenciado.*contact|nombre.*tel[eé]fono/i,
    },
  },
  {
    id: 'sawil-no-soy-cliente-not-assigned-advisor',
    description: '"no soy cliente" must NOT route to existing-client branch',
    turns: [
      'español', '07407', 'mi plan no aprueba mi cirugia',
      'no soy cliente',
    ],
    expectedAfterLast: {
      mustNotMatch: /su asesor asignado/i,
    },
  },
  {
    id: 'sawil-quiero-ahorros-en-medicare',
    description: '"quiero tener ahorros en medicare" must classify as savings',
    turns: ['español', '06205', 'quiero tener ahorros en medicare'],
    expectedAfterLast: {
      mustMatch: /extra help|\bMSP\b|programas?|asesor/i,
    },
  },
];

// Build the full scenario list. For each topic family, emit one scenario per
// phrasing, language pair. Each scenario is a 3-turn flow:
//   ['español' or 'english', ZIP, user_phrase]
// ZIP is rotated to spread across NY/NJ/FL/CT coverage.
export function buildAllScenarios() {
  const zips = { es: ['10033', '07407', '32301', '06825'], en: ['10550', '07047', '33101', '06820'] };
  const out = [];
  for (const [familyId, fam] of Object.entries(TOPIC_FAMILIES)) {
    let zipIdx = 0;
    for (const lang of ['es', 'en']) {
      const langKey = lang === 'es' ? 'español' : 'english';
      for (const phrase of fam[lang] || []) {
        const zip = zips[lang][zipIdx % zips[lang].length];
        zipIdx++;
        out.push({
          id: `${familyId}/${lang}/${out.length}`,
          family: familyId,
          lang,
          turns: [langKey, zip, phrase],
          expected: {
            category: fam.expectedCategory,
            deflection: fam.expectDeflection,
            crisis: fam.expectCrisis,
            caregiver: fam.expectCaregiver,
            recovery: fam.expectRecovery,
            phiScrub: fam.expectPhiScrub,
          },
        });
      }
    }
  }
  return out;
}

// CLI mode
const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('conversation-corpus.mjs')) {
  const all = buildAllScenarios();
  console.log(`Total single-turn scenarios: ${all.length}`);
  console.log(`Recorded Sawil failures: ${SAWIL_RECORDED_FAILURES.length}`);
  console.log(`Topic families: ${Object.keys(TOPIC_FAMILIES).length}`);
  console.log('\nFamily coverage (ES / EN):');
  for (const [id, fam] of Object.entries(TOPIC_FAMILIES)) {
    console.log(`  ${id.padEnd(30)} ${(fam.es?.length || 0).toString().padStart(2)} / ${(fam.en?.length || 0).toString().padStart(2)}`);
  }
}

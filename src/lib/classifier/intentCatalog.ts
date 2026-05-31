// Wave 50 — Intent catalog. Replaces the regex-roulette in detectProblemType.
//
// Each intent is a SCORED matcher: many weighted patterns + an optional
// exclude-list (patterns that, if present, suppress this intent regardless
// of positive matches). The classifier sums weights, picks the best intent
// above threshold, or pivots to clarification.
//
// Design principles:
//   • Patterns are partial (no anchors unless intentional).
//   • Patterns are bilingual when possible.
//   • Synonyms are exhaustive — Medicare seniors say "doctora", "médico",
//     "especialista", "primario", "PCP", "doc", "dr", "el de cabecera".
//   • Excludes prevent classic false-positives (premium → bill, but only
//     when not in a "help paying premium" context).

export type IntentName =
  | 'savings_program'
  | 'plan_recommendation'
  | 'appeal'
  | 'enrollment'
  | 'medicare_advantage'
  | 'plan_type_question'
  | 'spap'
  | 'moving_state_sep'
  | 'cost_basics'
  | 'medicare_basics'
  | 'fraud_scam'
  | 'medical_emergency_911'
  | 'urgent_medication'
  | 'er_hospital_visit'
  | 'telehealth'
  | 'bill'
  | 'letter'
  | 'drug'
  | 'doctor_provider_network'
  | 'doctor_change_request'
  | 'coverage'
  | 'eob_explanation'
  | 'ship_referral'
  | 'returning_customer'
  | 'family_referral'
  | 'about_clearpoint'
  | 'off_topic'
  | 'casual'
  | 'general';

export interface IntentPattern {
  /** The matcher. Uses ripgrep/JS regex syntax. */
  re: RegExp;
  /** Weight 0-1. Sum of matched weights → intent score. */
  weight: number;
  /** Optional tag for debugging — appears in classifier output. */
  tag?: string;
}

export interface IntentSpec {
  /** Patterns whose match adds weight to the intent score. */
  positives: IntentPattern[];
  /** Patterns whose match SUBTRACTS weight (false-friend guards). */
  negatives?: IntentPattern[];
  /** Minimum score for this intent to be considered. Default 0.5. */
  threshold?: number;
  /** Bilingual topic seeds — used by the phrase generator and shown in
   *  the failure report so you can see what English you SHOULD recognize. */
  seedsEs: string[];
  seedsEn: string[];
}

// Common Medicare synonym fragments — composed into patterns below.
const RX = {
  doctor: '(doctor|doctora|m[eé]dic[ao]|provider|primary|pcp|especialista|specialist|cardi[oó]logo|cardiologist|neur[oó]logo|gastro|primario|el de cabecera|mi doc|mi dr|el doc|la doctora)',
  drug: '(medicaci[oó]n|medication|medications|medicamento|medicamentos|medicina|medicinas|pastilla|pastillas|p[ií]ldora|drug|drugs|pharmacy|farmacia|prescription|prescripci[oó]n|receta|recetas|insulin|insulina|inhalador|inhaler)',
  bill: '(bill|bills|factura|facturas|cobro|cobros|charge|charged|cobr(o|aron|aban|aron))',
  letter: '(carta|cartas|letter|notice|aviso|anoc|eoc|renovaci[oó]n|renewal|medicaid notice|extra help notice|irmaa)',
  hospital: '(hospital|hospitales|er|emergency room|sala de emergencia|urgent care|urgencias|cl[ií]nica|clinic)',
  plan: '(plan|planes|cobertura|coverage|red|network|formulary|formulario)',
  money: '(premium|prima|copay|copago|deducible|deductible|coinsurance|coseguro|costo|cost|precio)',
  denial: '(denied|deny|negaron|denegaron|rejected|rechazaron|no quiere(n)? cubrir|no me cubr(en|e|ieron)|won\'?t cover|will not cover|wouldn\'?t cover|won t cover|do not cover|don\'?t cover|not covered|no cubierto)',
  procedure: '(procedimiento|procedure|cirug[ií]a|surgery|tratamiento|treatment|mri|resonancia|ct scan|tac|operaci[oó]n|operation|biopsia|biopsy|radiacion|radiation|quimio|chemo|test|labs?|x[- ]?ray|examen|terapia|therapy|fisioterapia|physical therapy)',
  help: '(ayuda|ayudas|asistencia|subsidio|help|assistance|aid)',
};

// ─────────────────────────────────────────────────────────────────────────────
// THE CATALOG
// ─────────────────────────────────────────────────────────────────────────────
// Order does NOT matter for matching (we score all). Order in the file is
// just for the reader's sanity, grouped by domain.
// ─────────────────────────────────────────────────────────────────────────────

export const INTENT_CATALOG: Record<IntentName, IntentSpec> = {
  // ═══════════════════════════════════════════════════════════════════════
  // SAFETY (highest priority — must always win when present)
  // ═══════════════════════════════════════════════════════════════════════

  medical_emergency_911: {
    threshold: 0.35,
    positives: [
      { re: /\b(chest (pain|hurts|hurting))\b/i, weight: 1.0, tag: 'chest_pain_en' },
      { re: /\bch\w{1,3}(t|y) (hurt|hurts|pain)/i, weight: 0.9, tag: 'chest_pain_fuzzy_en' }, // chest/chesy/chesty
      { re: /\bme due\w*\s+el pecho\b/i, weight: 1.0, tag: 'chest_pain_es_fuzzy' },
      { re: /\b(can'?t breathe|cant? breath\w*|no puedo respirar)\b/i, weight: 1.0, tag: 'breathing' },
      { re: /\b(having (a )?(heart attack|stroke))\b/i, weight: 1.0, tag: 'heart_attack_en' },
      { re: /\b(i'?m? having a heart attack|having heart attack)\b/i, weight: 1.0, tag: 'heart_attack_en2' },
      { re: /\btengo (un )?(infarto|derrame)\b/i, weight: 1.0, tag: 'heart_attack_es' },
      { re: /\b(me siento desmayar|i'?m fainting)\b/i, weight: 0.8, tag: 'fainting' },
      { re: /\b(bleeding (badly|a lot)|estoy sangrando)\b/i, weight: 0.9, tag: 'bleeding' },
      { re: /\bemergencia m[eé]dica\b/i, weight: 1.0, tag: 'emergencia_medica' },
      { re: /\bmedical emergency\b/i, weight: 1.0, tag: 'medical_emergency' },
      // Fuzzy emergency / médical typos. Higher weight to beat er_visit (0.5).
      { re: /\b[ei]?m[ea]?r?g[ea]?nc\w{0,4}\s+m[eé]?[di]?c?[ao]?\w*/i, weight: 1.0, tag: 'fuzzy_emerg_med' },
      { re: /\bm[ea]?d[io]c?[ao]?l?\s+em[ea]r?g/i, weight: 1.0, tag: 'fuzzy_med_emerg' },
      { re: /\bemerg\w*\s+m[eé]?d/i, weight: 0.9, tag: 'emerg_med_short' },
      { re: /\b(call (an? )?ambulance|llame (al|una) ambulancia)\b/i, weight: 1.0, tag: 'ambulance' },
    ],
    seedsEs: ['me duele el pecho', 'no puedo respirar', 'tengo un infarto', 'emergencia médica', 'estoy sangrando'],
    seedsEn: ['my chest hurts', "I can't breathe", "I'm having a heart attack", 'medical emergency', "I'm bleeding badly"],
  },

  fraud_scam: {
    threshold: 0.4,
    positives: [
      { re: /\b(scam|fraud|fraude|estafa|fraudulento)\b/i, weight: 1.0, tag: 'fraud_keyword' },
      { re: /\b(stole my identity|robo de identidad)\b/i, weight: 1.0, tag: 'identity_theft' },
      { re: /\bidenti?ty\b/i, weight: 0.6, tag: 'identity_word' },
      { re: /\bidenti?t[uy]?\s+theft\b/i, weight: 1.0, tag: 'identity_theft_fuzzy' },
      { re: /\b(rob\w{1,3}|me rob\w*).{0,10}(identidad|identity)\b/i, weight: 1.0, tag: 'robaron_identidad_fuzzy' },
      { re: /\bidentidad\b/i, weight: 0.4, tag: 'identidad_word' },
      { re: /\b(alguien |someone )?(me )?llam[oó]\s+(alguien\s+)?.{0,30}\b(medicare|seguro|gobierno|insurance|government)/i, weight: 0.9, tag: 'someone_called' },
      { re: /\bme llam[oó] alguien.{0,40}(medicare|seguro|gobierno|insurance|government|diciendo|saying|claiming)/i, weight: 1.0, tag: 'llamo_alguien_medicare' },
      { re: /\bsomeone called.{0,40}(medicare|insurance|government)/i, weight: 0.9, tag: 'someone_called_en' },
      { re: /\b(asked (for )?my medicare (id|number|card)|me pid(io|ió|ieron) (mi )?(numero de |n[uú]mero de )?medicare)\b/i, weight: 0.8, tag: 'asked_for_id' },
      { re: /\b(tarjeta que no ped[ií]|card i didn'?t order)\b/i, weight: 0.8, tag: 'unordered_card' },
      { re: /\b((factura|bill).{0,15}(por|de|for).{0,15}(una )?visita que no tuve|billed for (a )?visit i didn'?t)\b/i, weight: 0.8, tag: 'ghost_visit' },
      { re: /\b(cobro extra[ñn]o)\b/i, weight: 1.0, tag: 'cobro_extrano' },
      { re: /\bc[op]?bro que (no |mo )?(rec|recno|reno)\w*/i, weight: 1.1, tag: 'cobro_no_reconozco_fuzzy' },
      { re: /\bcharge i don'?t recogn?ize/i, weight: 1.0, tag: 'charge_dont_recognize' },
      { re: /\bunr[ea]?co?gnized? charge/i, weight: 1.0, tag: 'unrecognized_charge_fuzzy' },
      { re: /\b(creo que es (un|una)? ?(estafa|fraude|scam))\b/i, weight: 1.0, tag: 'i_think_scam' },
      { re: /\bi think (it'?s |this is )?a (scam|fraud)\b/i, weight: 1.0, tag: 'i_think_scam_en' },
    ],
    seedsEs: ['me llamó alguien diciendo medicare', 'creo que es una estafa', 'me robaron mi identidad', 'cobro que no reconozco', 'me pidieron mi número de medicare'],
    seedsEn: ['someone called saying medicare', 'I think it is a scam', 'identity theft', 'unrecognized charge', 'they asked for my medicare number'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CLAIM-DEFLECT (must NEVER fall back to generic — Sawil's hot spots)
  // ═══════════════════════════════════════════════════════════════════════

  savings_program: {
    threshold: 0.5,
    positives: [
      // Strongest signals — direct program names
      { re: /\b(extra help|low[- ]income subsidy|\blis\b)\b/i, weight: 1.0, tag: 'extra_help' },
      { re: /\b(medicare savings programs?|\bmsp\b|\bqmb\b|\bslmb\b|\bqi[-_]? ?(program|medicare)?\b|\bpace\b)\b/i, weight: 1.0, tag: 'msp_qmb' },
      { re: /\b(tell me|i (want to know|wanna know|need to know))\s+about (medicare )?(savings|extra help|lis|msp|cost|costs|plan options)/i, weight: 1.0, tag: 'want_to_know_savings' },
      { re: /\bcu[eé]ntame de (los )?(ahorros|programas de ahorro|extra help|lis|msp)/i, weight: 1.0, tag: 'cuentame_savings' },
      { re: /\b(quiero saber|me gustar[ií]a saber) (de |sobre |acerca de )?(ahorros|extra help|lis|msp|programas? de ahorro)/i, weight: 1.0, tag: 'quiero_saber_savings' },
      // "ayudas de/para ahorros" — the exact phrase Sawil tried
      { re: /\bayudas? (de|con|para) ahorros?/i, weight: 1.0, tag: 'ayudas_ahorros' },
      { re: /\b(savings help|ayuda de ahorro)\b/i, weight: 1.0, tag: 'savings_help_phrase' },
      // "programa(s) de ahorro/asistencia"
      { re: /\b(programa[s]? de ahorro|programa[s]? de asistencia|savings program|programa de ayuda)\b/i, weight: 0.9, tag: 'savings_program' },
      // "ayuda/help with [cost noun]" — bilingual mid-sentence
      { re: /\b(ayuda|ayudas|asistencia|subsidio|ayudar)\b.{0,30}\b(pagar|paying|prima|premium|copagos?|copays?|deducibles?|deductibles?|medicare|medicamentos?|medicinas?|recetas?|prescripci[oó]n|drug|drugs?)\b/i, weight: 0.8, tag: 'help_with_cost_es' },
      { re: /\b(help|assistance|subsidy)\b.{0,30}\b(paying|pay|with|for|my|medicare|premium|copays?|deductibles?|drugs?|medications?|prescriptions?|medicine)\b/i, weight: 0.8, tag: 'help_with_cost_en' },
      // "looking for help paying medicines / busco ayuda para pagar"
      { re: /\b(looking for|buscando|busco)\b.{0,15}\b(help|ayuda|asistencia|assistance)\b.{0,40}\b(pay|paying|pagar|medicines?|medicinas?|medicaments?|medicamentos?|prescription|recetas?|drugs?)/i, weight: 0.9, tag: 'looking_for_help' },
      // "can't afford [Medicare-specific]"
      { re: /\b(can'?t afford|cannot afford|cant afford|no puedo pagar|no me alcanza)\b.{0,30}\b(premium|prima|copay|copago|medicare|drug|medication|medicina|medicamento)\b/i, weight: 0.8, tag: 'cant_afford_med' },
      // "low income" / "bajos ingresos"
      { re: /\b(low ?income|bajos? ingresos?)\b/i, weight: 0.7, tag: 'low_income' },
      // "save on medicare" / "reduce cost"
      { re: /\b(save on medicare|saving on medicare|ahorro de medicare|ahorro en medicare|ahorrar en medicare|reduce medicare cost|reducir.*medicare|baj(ar|en) los costos|lower (medicare )?costs|save money on medicare|save (some )?money\b.{0,15}\bmedicare)\b/i, weight: 0.8, tag: 'save_money' },
      { re: /\bi want to (save|cut) (money|costs?)\b.{0,15}\b(medicare|on medicare)\b/i, weight: 1.0, tag: 'i_want_save_money' },
      // "ahorros (en/de/con) medicare" / "tener ahorros" — plural or alone.
      { re: /\bahorros?\b.{0,15}\b(en|de|con|para|sobre) medicare\b/i, weight: 1.0, tag: 'ahorros_en_medicare' },
      { re: /\b(quiero|necesito|busco|me hace falta|tener)\b.{0,15}\bahorr\w*\b/i, weight: 0.8, tag: 'quiero_ahorros_fuzzy' },
      { re: /\bquiero ahorr\w*/i, weight: 0.8, tag: 'quiero_ahorrar_fuzzy' },
      { re: /\bahorr\w*\b.{0,15}\b(medicare|en medicare|de medicare|con medicare)\b/i, weight: 1.0, tag: 'ahorr_medicare_fuzzy' },
      // "ayudame a ahorrar"
      { re: /\b(ay[uú]deme|ay[uú]dame|ayuda) a ahorrar\b/i, weight: 0.9, tag: 'ayuda_ahorrar' },
      // "no puedo con la prima" / "me estan cobrando la prima" → savings pivot
      { re: /\b(me est[aá]n? cobrando|me cobran|cobran(do)?)\b.{0,25}\b(prima|premium|part [abcd]|parte [abcd]|medicare|medicaid)\b/i, weight: 1.0, tag: 'cobrando_prima' },
      { re: /\bme cobr(a|an|ando|aron)\b/i, weight: 0.6, tag: 'me_cobran_alone' },
      { re: /\bcharging me\b.{0,15}\b(premium|part [abcd]|monthly)\b/i, weight: 1.0, tag: 'charging_me_premium_en' },
      // "por qué me cobran tanto" / "why am I charged so much"
      { re: /\b(por que|porq|porque|why)\b.{0,25}\b(me cobran|cobran|charge|charging|charged|paying)\b.{0,25}\b(tanto|so much|much|too much)\b/i, weight: 1.0, tag: 'why_charge_so_much' },
      { re: /\bwhy am i (being )?(charged|paying)\b.{0,20}\b(so much|too much|this much)\b/i, weight: 1.0, tag: 'why_am_i_charged' },
      { re: /\bme cobran (tanto|mucho)\b/i, weight: 0.7, tag: 'cobran_mucho' },
      { re: /\bno (me )?alcanz[aoe]\b.{0,15}\b(prima|premium|copago|copay|medicare)\b/i, weight: 0.8, tag: 'no_alcanza' },
      // "financial assistance"
      { re: /\b(financial assistance|economic assistance|asistencia (financiera|econ[oó]mica))\b/i, weight: 0.8, tag: 'financial' },
      // SPAP / EPIC (state programs)
      { re: /\b(state pharmaceutical assistance|state prescription help|programa estatal de medicamentos)\b/i, weight: 0.9, tag: 'state_spap' },
      // QMB / SLMB / QI bare letters explained
      { re: /\bqu[eé] es\s+(qmb|slmb|qi|msp|lis|extra help|el msp|el qmb)\b/i, weight: 1.0, tag: 'what_is_qmb' },
      { re: /\bwhat is (qmb|slmb|qi|msp|lis|extra help|the msp|the qmb)\b/i, weight: 1.0, tag: 'what_is_qmb_en' },
    ],
    negatives: [
      // "help with the bill I got" → bill handler. "help" alone is too weak.
      { re: /\b(this (specific )?bill|esta factura espec[ií]fica|the bill (i got|i received|que me lleg[oó]))\b/i, weight: 0.3 },
    ],
    seedsEs: [
      'quiero saber de ayudas de ahorros de medicare',
      'necesito extra help para los copagos',
      'ayuda con la prima de medicare',
      'no puedo pagar el premium',
      'busco ayuda para mis medicinas',
      'soy de bajos ingresos',
      'programa de ahorro de medicare',
      'qué es QMB SLMB',
      'asistencia financiera para medicare',
      'ayuda con copagos de recetas',
    ],
    seedsEn: [
      'I want to know about medicare savings help',
      'I need extra help with copays',
      'help with my medicare premium',
      "can't afford my premium",
      'looking for help paying my medicines',
      'I have low income, can I get help?',
      'medicare savings program',
      'what is QMB SLMB',
      'financial assistance for medicare',
      'help paying drug copays',
    ],
  },

  plan_recommendation: {
    threshold: 0.5,
    positives: [
      { re: /\bqu[eé] plan (es )?(mejor|el mejor|bueno|me conviene|me recomienda)/i, weight: 1.0, tag: 'es_which_plan_best' },
      { re: /\bcu[aá]l plan (me conviene|es mejor|es bueno|recomienda|debo|deber[ií]a)/i, weight: 1.0, tag: 'es_which_plan' },
      { re: /\bwhich plan (is |should |would )?(the )?(best|better|right|good|recommend)/i, weight: 1.0, tag: 'en_which_plan_best' },
      { re: /\bwhich (medicare )?plan (is )?(the )?best (for|para)/i, weight: 1.0, tag: 'which_plan_best_for' },
      { re: /\btell me about\b.{0,30}\bplans?\b/i, weight: 0.7, tag: 'tell_me_about_plans' },
      { re: /\b(recommend (me )?a plan|recomi[eé]ndame un plan|recomienda un plan)\b/i, weight: 1.0, tag: 'recommend_plan' },
      { re: /\b(best medicare plan|mejor plan (de )?medicare|el mejor plan)\b/i, weight: 0.9, tag: 'best_medicare' },
      { re: /\bwhat plan (should|shall|do) i (get|pick|choose|enroll|select)/i, weight: 0.9, tag: 'what_plan_should_en' },
      { re: /\bqu[eé] plan (debo|deber[ií]a|tendr[ií]a que) (escoger|elegir|conseguir|tomar|seleccionar|coger)/i, weight: 0.9, tag: 'que_plan_should_es' },
      { re: /\bcan you (recommend|suggest) (a |me )?plan\b/i, weight: 0.9, tag: 'can_you_recommend' },
      { re: /\bme puede (recomendar|sugerir) un plan\b/i, weight: 0.9, tag: 'puede_recomendar' },
    ],
    seedsEs: ['¿qué plan es mejor para mí?', 'cuál plan me conviene', 'recomiéndame un plan', 'qué plan debo escoger', 'el mejor plan de medicare', 'me puede recomendar un plan'],
    seedsEn: ['which plan is best for me?', 'recommend a plan', 'what plan should I get', 'best medicare plan', 'what plan should I pick', 'can you recommend a plan'],
  },

  appeal: {
    threshold: 0.5,
    positives: [
      // denial verbs paired with a procedure noun
      { re: new RegExp(`\\b((no (me )?(quieren|quiere|aprueban|aprueba|aprobaron|aprobo|cubrieron|cubrio|cubre|cubren|cubrir[aá]n)|won'?t (cover|approve)|will not (cover|approve)|didn'?t (approve|cover|accept)|did not (approve|cover|accept)|denied|rejected|rechazaron|rechaz[oóa]|rechazada?|rechazado?|denegaron|denegado|denego|denied|negaron|me negaron|me denegaron|me rechazaron))\\b[^.?!]{0,40}\\b${RX.procedure}\\b`, 'i'), weight: 1.0, tag: 'denial_procedure' },
      // Bare "negaron|denegaron|rejected" + procedure (no "no" required).
      { re: new RegExp(`\\b(me )?(negaron|denegaron|rechazaron|rejected|denied)\\b[^.?!]{0,40}\\b${RX.procedure}\\b`, 'i'), weight: 1.0, tag: 'bare_denial' },
      // "tratamiento rechazado", "denied my surgery"
      { re: /\b(tratamiento rechazado|procedimiento rechazado|cirug[ií]a rechazada|treatment was rejected|procedure was rejected|surgery was rejected)\b/i, weight: 0.9, tag: 'rejected_procedure' },
      { re: /\b(appeal a denial|appeal the denial|denied (my )?(procedure|surgery|treatment|claim)|apelar.{0,20}denegaci[oó]n)\b/i, weight: 0.9, tag: 'appeal_denial' },
      // explicit appeal words
      { re: /\b(apelaci[oó]n|apelar|appeal|appeals|reconsideration|fair hearing|grievance|queja formal)\b/i, weight: 0.8, tag: 'appeal_word' },
      // "need authorization for procedure"
      { re: new RegExp(`\\b(need|necesito|requires?|require)\\s+(an? |una? )?(auth(orization)?|autorizaci[oó]n|prior auth(orization)?)\\b.{0,40}\\b${RX.procedure}\\b`, 'i'), weight: 0.7, tag: 'need_auth' },
      // "my plan won't approve X"
      { re: /\b(mi plan (no )?(quiere|me )?(aprob|cubrir|cubre|aprueba|deja)|my plan (won'?t|wouldn'?t|will not|did not|didn'?t) (approve|cover))\b/i, weight: 0.8, tag: 'plan_wont' },
    ],
    negatives: [
      // Medication denial is drug handler's job, not appeal.
      { re: new RegExp(`\\b(no me cubrieron|denied|rejected)\\b.{0,20}\\b${RX.drug}\\b`, 'i'), weight: 0.7 },
    ],
    seedsEs: [
      'mi plan no me aprueba la cirugía',
      'me negaron el procedimiento',
      'denegaron mi tratamiento',
      'necesito apelar la denegación',
      'no me aprobaron la resonancia',
      'el plan rechazó mi operación',
    ],
    seedsEn: [
      "my plan won't approve my surgery",
      'they denied my procedure',
      'rejected my treatment',
      'I need to appeal a denial',
      "they didn't approve my MRI",
      'plan rejected my operation',
    ],
  },

  enrollment: {
    threshold: 0.4,
    positives: [
      { re: /\b(inscripci[oó]n|inscribir|inscribirme|enrollment|enroll|enrolling|disenroll|disenrollment)\b/i, weight: 1.0, tag: 'enroll_word' },
      { re: /\b(\bsep\b|\baep\b|\biep\b|special enrollment|annual enrollment|initial enrollment)\b/i, weight: 1.0, tag: 'enrollment_period' },
      { re: /\b(change|switch|cambiar|cambiarme)\b(?:\s+\w+){0,3}\s+(plan|plans|planes)\b/i, weight: 0.9, tag: 'change_plan' },
      { re: /\b(quiero cambiar|me quiero cambiar|me voy a cambiar)\b.{0,15}\b(plan|planes|medicare)/i, weight: 1.0, tag: 'quiero_cambiar' },
      { re: /\bi want to (change|switch)\b.{0,15}\b(plan|plans|medicare)/i, weight: 1.0, tag: 'want_to_change' },
      { re: /\b(cheaper|less expensive|more affordable|low(er)? cost|m[aá]s barato|mas economico|m[aá]s econ[oó]mico)\b.{0,15}\b(plan|planes|medicare)\b/i, weight: 0.8, tag: 'cheaper_plan' },
      { re: /\b(plan|planes|medicare)\b.{0,15}\b(cheaper|less expensive|more affordable|m[aá]s barato|mas economico|m[aá]s econ[oó]mico)\b/i, weight: 0.8, tag: 'plan_cheaper' },
      { re: /\b(turning 65|cumpliendo 65|cumplo 65|i turn 65|voy a cumplir 65|just turned 65|acabo de cumplir 65)\b/i, weight: 0.9, tag: 'turning_65' },
      { re: /\b(new plan|nuevo plan|otro plan|different plan|plan diferente|plan nuevo)\b/i, weight: 0.6, tag: 'new_plan' },
      { re: /\bperiodo de inscripci[oó]n|enrollment period\b/i, weight: 0.9, tag: 'period' },
      { re: /\b(what is|qu[eé] es)\b.{0,5}\b(aep|sep|iep)\b/i, weight: 1.0, tag: 'what_is_aep' },
    ],
    negatives: [
      // "what plan is best" → plan_recommendation, not enrollment
      { re: /\b(which plan|qu[eé] plan|cu[aá]l plan)\b.{0,15}\b(best|mejor|conviene|recommend)\b/i, weight: 0.8 },
    ],
    seedsEs: [
      'quiero cambiar mi plan',
      'necesito inscribirme en medicare',
      'cumplo 65 el próximo mes',
      'busco un plan más barato',
      'me quiero cambiar de plan',
      'qué es AEP',
      'el periodo de inscripción',
    ],
    seedsEn: [
      'I want to change my plan',
      'I need to enroll in medicare',
      "I'm turning 65 next month",
      'looking for a cheaper plan',
      'I want to switch plans',
      'what is AEP',
      'the enrollment period',
    ],
  },

  bill: {
    threshold: 0.4,
    positives: [
      { re: new RegExp(`\\b${RX.bill}\\b`, 'i'), weight: 1.0, tag: 'bill_word' },
      { re: /\b(premium|prima|copay|copago|deductible|deducible|eob)\b/i, weight: 0.8, tag: 'cost_noun' },
      { re: /\b(owe|debo|adeudo)\b/i, weight: 0.7, tag: 'owe' },
      { re: /(\$\d|\b\d{1,5}\s?(dollars|d[oó]lares|usd))\b/i, weight: 0.5, tag: 'dollar_amount' },
      { re: /\b(amount due|balance due|saldo|adeudo)\b/i, weight: 0.9, tag: 'amount_due' },
      { re: /\b(charged me|me cobraron|cobr[oó])\b/i, weight: 0.7, tag: 'charged' },
    ],
    negatives: [
      // "help with premium" → savings_program
      { re: /\b(help|assistance|ayuda|asistencia|subsidio|subsidy)\b.{0,30}\b(premium|prima|copay|copago|paying|pagar|drug|medicine|medication|medicina|medicamento)\b/i, weight: 0.9 },
      // "can't afford premium / drug" → savings_program
      { re: /\b(can'?t afford|cant afford|no puedo pagar\w*|no puedo pagar)\b.{0,30}\b(premium|prima|drug|medication|medicine|medicare)\b/i, weight: 0.9 },
      // pharmacy charged → drug, not bill
      { re: /\b(farmacia|pharmacy).{0,20}(cobr|charge)/i, weight: 0.9 },
      // "I want to change my plan" → enrollment, not bill (no $ context)
      { re: /\b(change|switch|cambiar)\b.{0,15}\b(plan|planes)\b/i, weight: 0.7 },
      // EOB explanation request → eob_explanation, not bill
      { re: /\b(what (is|does)|qu[eé] es|explain|expli(que|car))\b.{0,15}\beob\b/i, weight: 1.0 },
      { re: /\bexpli(que|car|came)me?\b.{0,15}\beob\b/i, weight: 0.9 },
      { re: /\bi got an? eob\b|\bme lleg[oó] un eob\b/i, weight: 0.9 },
      { re: /\bdon'?t know what (an?|the) eob (is|means)/i, weight: 1.0 },
      { re: /\bno se que es (un )?eob/i, weight: 1.0 },
      // "do you charge" / "cobran ustedes" → about_clearpoint, not bill
      { re: /\bdo you charge\b/i, weight: 1.0 },
      { re: /\b(ustedes|uds|clearpoint) cobran\b/i, weight: 0.9 },
      { re: /\bcobran (ustedes|uds)\b/i, weight: 0.9 },
      // "cobro que no reconozco" / "unrecognized charge" → fraud_scam
      { re: /\b(cobro|charge).{0,10}(que )?no (reconozco|recognize|reconozco)/i, weight: 1.0 },
      { re: /\bunrecognized charge\b/i, weight: 1.0 },
      // "billed for ghost visit" → fraud_scam
      { re: /\b(billed for|cobr[oa]ron por).{0,15}(visit|visita) (i didn'?t|que no tuve)/i, weight: 0.9 },
    ],
    seedsEs: [
      'me llegó una factura del hospital',
      'tengo un cobro de $200',
      'mi premium subió',
      'el copago es muy alto',
      'me cobraron $500',
      'recibí una factura sorpresa',
    ],
    seedsEn: [
      'I got a hospital bill',
      'I have a $200 charge',
      'my premium went up',
      'the copay is too high',
      'they charged me $500',
      'I received a surprise bill',
    ],
  },

  letter: {
    threshold: 0.4,
    positives: [
      { re: new RegExp(`\\b${RX.letter}\\b`, 'i'), weight: 1.0, tag: 'letter_word' },
      { re: /\b(carta de medicare|letter from medicare|notice from)\b/i, weight: 0.8, tag: 'letter_from' },
      { re: /\b(anoc|annual notice of change|aviso anual de cambio)\b/i, weight: 1.0, tag: 'anoc' },
      { re: /\b(irmaa|extra premium|prima adicional)\b/i, weight: 0.9, tag: 'irmaa' },
    ],
    seedsEs: ['recibí una carta', 'la carta del plan dice', 'no entiendo este aviso', 'me llegó una carta de medicare'],
    seedsEn: ['I got a letter', 'the plan letter says', "I don't understand this notice", 'I got a letter from medicare'],
  },

  drug: {
    threshold: 0.4,
    positives: [
      { re: new RegExp(`\\b${RX.drug}\\b`, 'i'), weight: 1.0, tag: 'drug_word' },
      { re: new RegExp(`\\b${RX.denial}\\b.{0,20}\\b${RX.drug}\\b`, 'i'), weight: 0.9, tag: 'denial_drug' },
      { re: /\bno cubre.{0,15}\b(medicina|medicamento|receta|drug|medication|prescription)\b/i, weight: 1.0, tag: 'no_cubre_med' },
      { re: /\bplan no cubre.{0,15}\b(medicina|medicamento|receta|drug|medication)\b/i, weight: 0.9, tag: 'plan_no_cubre_med' },
      { re: /\b(doesn'?t|don'?t|does not|do not|won'?t|will not)\s+cover\b.{0,15}\b(my )?(drug|medication|medicine|prescription|pill)\b/i, weight: 1.0, tag: 'en_no_cover_med' },
      { re: new RegExp(`\\b${RX.drug}\\b.{0,30}\\b(too expensive|too high|caro|costoso|caro|cost)\\b`, 'i'), weight: 0.8, tag: 'drug_expensive' },
      { re: /\b(refill|refills|surtir|surtido|reabastecer|prior auth(orization)?|autorizaci[oó]n previa|paso a paso|step therapy|terapia escalonada)\b/i, weight: 0.7, tag: 'refill_PA' },
    ],
    negatives: [
      // "se me acabó la medicina" / "out of meds" → urgent_medication, not drug
      { re: /\b(out of (my )?(medication|meds|medicine|insulin|inhaler|prescription|pills?)|sin (mi )?(medicina|medicamento|insulina|inhalador|receta|pastilla)|run out of|se me acab[oó]\s+(la|el|mi|un|una)?\s*(medicina|medicamento|medicacion|medicación|receta|pastilla|p[ií]ldora|insulina|inhalador|tratamiento))\b/i, weight: 1.0 },
      // "no tengo mi medicamento" → urgent_medication
      { re: /\bno tengo (mi )?(medicina|medicamento|insulina|receta|pastilla|tratamiento)\b/i, weight: 1.0 },
      // "I have no insulin / meds / medication" → urgent_medication
      { re: /\bi have no (insulin|inhaler|prescription|medication|meds|medicine|pill|pills|drug|drugs)\b/i, weight: 1.0 },
      // "is my drug covered" → coverage (interrogative form)
      { re: /\bis (my |the )?(drug|medication|medicine) (covered|in network|in-network)\b/i, weight: 0.8 },
      // Spanish interrogative "está cubierta mi medicina" → coverage
      { re: /\best[aá] (mi |el |la )?(medicina|medicamento) (cubierto|cubierta)/i, weight: 0.9 },
      // Drug for savings program — "help paying for medicine" → savings_program
      { re: /\b(ayuda|help|assistance|asistencia|subsidio|subsidy)\b.{0,30}\b(medicinas?|medicamentos?|recetas?|drugs?|medications?|prescriptions?|pills?|copays?|copagos?)\b/i, weight: 0.9 },
      // Affirmative "cubre + medicine" (no "no") → coverage interrogative
      { re: /(?<!no\s)\bcubre\s+(mi |el |la )?(plan |seguro )?(mi |el |la )?(medicina|medicamento|receta|drug|medication)\b/i, weight: 1.0 },
      // "is my X covered" → coverage
      { re: /\bis (my |the )?(drug|medication|medicine|prescription) covered\b/i, weight: 1.0 },
      // "does (my) (plan|insurance) cover (my) drug" → coverage
      { re: /\bdoes (my |the |your )?(plan|insurance|coverage) cover (my |the |any )?(drug|medication|medicine|prescription)\b/i, weight: 1.0 },
    ],
    seedsEs: [
      'mi medicina es muy cara',
      'no me cubrieron el medicamento',
      'la farmacia me cobró mucho',
      'necesito mi receta',
      'el plan no cubre mi medicina',
      'refill de mi medicina',
    ],
    seedsEn: [
      'my medication is too expensive',
      "they didn't cover my drug",
      'pharmacy charged me a lot',
      'I need my prescription',
      "plan doesn't cover my medicine",
      'refill my medication',
    ],
  },

  doctor_provider_network: {
    threshold: 0.45,
    positives: [
      // strong "doctor refuses me" signal
      { re: new RegExp(`\\b(no (me )?(quiere|quieren)\\s+(aceptar|recibir|ver|atender)(me)?|no me (acepta|aceptan|recibe|reciben|ven|atiende|atienden)|no (acepta|aceptan|recibe|reciben|coge|cogen|toma|toman)\\s+(mi|el)\\s+(plan|seguro|aseguranza|medicare))\\b`, 'i'), weight: 1.0, tag: 'es_provider_refuses' },
      { re: /\b((doesn'?t|does not|won'?t|will not|wouldn'?t|would not|refuses to|refused to)\s+(accept|take|see|treat)\s+(me|my (insurance|plan|medicare)))\b/i, weight: 1.0, tag: 'en_provider_refuses' },
      { re: /\b(they (won'?t|will not|wouldn'?t|would not) let me see|no me dejan ver|no me permiten ver|no me dejan ir)\b/i, weight: 0.9, tag: 'wont_let_see' },
      { re: /\b((no longer|stopped|left|dropped|out of (the |my )?(network|plan))|ya no acepta|ya no trabaja|ya no recibe|sali[oó] de|dej[oó] (de )?(aceptar|trabajar))\b/i, weight: 0.9, tag: 'left_network' },
      { re: new RegExp(`\\b${RX.doctor}\\b`, 'i'), weight: 0.5, tag: 'doctor_word' },
      { re: /\b(referral|referido|referirme|primary referral)\b/i, weight: 0.7, tag: 'referral' },
      { re: /\b(provider network|red de proveedores|en (la )?red|in[- ]network|out[- ]of[- ]network|fuera de red)\b/i, weight: 0.8, tag: 'network_phrase' },
    ],
    negatives: [
      // "find me a new doctor" / "change my pcp" → doctor_change_request
      { re: /\b(find (me )?a (new )?(doctor|pcp|primary|physician)|busco (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|pcp|primario|primaria|m[eé]dic[ao])|buscar (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|pcp|primario|primaria|m[eé]dic[ao])|necesito (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|m[eé]dic[ao]|pcp)|quiero (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|m[eé]dic[ao]|pcp|primario|primaria)|need (a )?new (doctor|pcp|primary|physician)|change (my )?(doctor|pcp|primary|doc|physician)|cambiar de (doctor|m[eé]dico|pcp|primario)|my (doctor|pcp|physician) (retired|moved|closed)|mi (doctor|m[eé]dico|pcp|primario) (se )?(jubil[oó]|cerr[oó]|se mud[oó]|se fue|dej[oó]))\b/i, weight: 1.0 },
      // "what happens if I go OON" → coverage, not provider access
      { re: /\b(what happens if|que pasa si)\b.{0,40}\b(out of network|out-of-network|fuera de red)\b/i, weight: 0.9 },
      { re: /\b(i want a |i'?m looking for a )(new |another )?(doctor|pcp|primary|physician|provider)\b/i, weight: 0.9 },
    ],
    seedsEs: [
      'mi doctor no acepta mi plan',
      'el especialista no me quiere ver',
      'mi médico salió de la red',
      'no me dejan ver al cardiólogo',
      'necesito un referido',
      'mi médico ya no acepta medicare',
    ],
    seedsEn: [
      "my doctor won't take my plan",
      "the specialist refuses to see me",
      'my doctor left the network',
      "they won't let me see the cardiologist",
      'I need a referral',
      "my doctor no longer accepts medicare",
    ],
  },

  doctor_change_request: {
    threshold: 0.45,
    positives: [
      { re: /\b(find (me )?a (new )?(doctor|pcp|primary|physician|provider)|buscar (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|m[eé]dic[ao]|pcp|primario|primaria))\b/i, weight: 1.0, tag: 'find_new_doc' },
      { re: /\bbusco (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|m[eé]dic[ao]|pcp|primario|primaria)\b/i, weight: 1.0, tag: 'busco_nuevo_doc' },
      { re: /\bquiero (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|m[eé]dic[ao]|pcp|primario|primaria)\b/i, weight: 1.0, tag: 'quiero_nuevo_doc' },
      { re: /\bnecesito (un |una )?(nuevo |nueva |otro |otra )?(doctor|doctora|m[eé]dic[ao]|pcp|primario|primaria)\b/i, weight: 1.0, tag: 'necesito_nuevo_doc' },
      { re: /\bneed (a |an )?(new |another |different )?(doctor|pcp|primary|physician|provider)\b/i, weight: 1.0, tag: 'need_new_doc_en' },
      { re: /\bi want a (new |another |different )?(doctor|pcp|primary|physician|provider)\b/i, weight: 1.0, tag: 'i_want_a_doc' },
      { re: /\bi want to (find|get|see) a (new |another |different )?(doctor|pcp|primary|physician|provider)\b/i, weight: 1.0, tag: 'i_want_to_find_doc' },
      { re: /\banother (doctor|pcp|primary|physician|provider)\b/i, weight: 1.0, tag: 'another_doc' },
      { re: /\b(looking for|i'?m looking for)\b.{0,15}\b(a |an |new )?(doctor|pcp|primary|physician|provider)\b/i, weight: 1.0, tag: 'looking_for_doc' },
      { re: /\bcambiar de (doctor|doctora|m[eé]dic[ao]|pcp|primario|primaria)\b/i, weight: 1.0, tag: 'cambiar_de_doc' },
      { re: /\bchange (my )?(doctor|doctors|pcp|primary|doc|physician|physicians|provider|providers)\b/i, weight: 1.0, tag: 'change_my_doc' },
      { re: /\bi want to change (my )?(doctor|doctors|pcp|primary|doc|physician|physicians)\b/i, weight: 1.0, tag: 'want_change_doc' },
      { re: /\bquiero cambiar de (doctor|doctora|m[eé]dic[ao]|pcp|primario)\b/i, weight: 1.0, tag: 'quiero_cambiar_doc' },
      { re: /\b(my (doctor|pcp|physician) (retired|moved|closed|stopped)|mi (doctor|m[eé]dico|pcp|primario) (se )?(jubil[oó]|cerr[oó]|se mud[oó]|se fue|dej[oó]))\b/i, weight: 0.9, tag: 'doc_gone' },
      { re: /\bmy (doctor|pcp|physician) left\s+(?!the network|the plan|de la red|del plan)/i, weight: 0.9, tag: 'doc_left_not_network' },
    ],
    seedsEs: ['quiero buscar un nuevo doctor', 'mi doctor se jubiló', 'cambiar de pcp', 'necesito otro médico', 'busco un nuevo primario', 'quiero cambiar de doctora', 'mi pcp se jubiló'],
    seedsEn: ['find me a new doctor', 'my doctor retired', 'change my pcp', 'need another doctor', 'looking for a new primary', 'I want to change physicians', 'my pcp retired'],
  },

  coverage: {
    threshold: 0.4,
    positives: [
      { re: /\bis my (doctor|hospital|clinic|drug|medication|prescription) (covered|in network|in-network)/i, weight: 1.0, tag: 'is_x_covered_en' },
      { re: /\bdoes my (plan |insurance )?cover (my |the )?(doctor|hospital|drug|medicine|medication)/i, weight: 1.0, tag: 'does_my_plan_cover' },
      { re: /\best[aá] (mi |el |la )?(doctor|hospital|cl[ií]nica|medicina|medicamento) (cubierto|cubierta|en (la )?red|en (mi )?plan)/i, weight: 1.0, tag: 'is_x_covered_es' },
      // Reversed word order: "está cubierto mi doctor" / "está cubierta mi medicina"
      { re: /\best[aá] (cubierto|cubierta)\b.{0,15}\b(doctor|doctora|m[eé]dico|hospital|cl[ií]nica|medicina|medicamento|receta)/i, weight: 1.0, tag: 'is_covered_x' },
      { re: /\bcubre (mi |el |la )?(plan |seguro )?(mi |el |la )?(doctor|hospital|cl[ií]nica|medicina|medicamento|transporte|dental|vision|comidas?)/i, weight: 1.0, tag: 'covers_x' },
      { re: /\bqu[eé] (incluye|cubre) (mi |la )?(cobertura|plan)\b/i, weight: 0.9, tag: 'what_covers' },
      { re: /\bno s[eé] (lo )?qu[eé] cubre (mi )?plan/i, weight: 0.9, tag: 'no_se_que_cubre' },
      { re: /\bi don'?t know what (my )?(plan|insurance) covers\b/i, weight: 0.9, tag: 'i_dont_know_covered' },
      { re: /\b(que pasa si|what happens if)\b.{0,60}\b(fuera de red|out of network|out-of-network)/i, weight: 0.9, tag: 'oon_question' },
      { re: /\b(out of network|out-of-network|fuera de red)\b/i, weight: 0.7, tag: 'oon_alone' },
      { re: /\bwhat does (my )?coverage (include|cover)\b/i, weight: 0.9, tag: 'what_does_cov' },
      { re: /\bdoes (my |the |your )?(plan|insurance|coverage) cover (my |the |any )?(drug|medication|medicine|prescription|hospital|doctor)\b/i, weight: 1.0, tag: 'does_plan_cover_x' },
      { re: /\bcobertura|coverage\b/i, weight: 0.5, tag: 'coverage_word' },
      { re: /\b(in[- ]network|in network|out[- ]of[- ]network|en la red|fuera de red)\b/i, weight: 0.7, tag: 'in_network' },
      { re: new RegExp(`\\b${RX.hospital}\\b`, 'i'), weight: 0.3, tag: 'hospital_word' },
    ],
    seedsEs: ['está mi doctor cubierto', 'cubre el plan mi medicina', 'qué incluye mi cobertura', 'mi hospital está en la red', 'cubre mi medicamento el plan'],
    seedsEn: ['is my doctor covered', 'does my plan cover my medicine', 'what does my coverage include', 'is my hospital in network', 'does insurance cover my drug'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CASUAL / META (low-priority — only win when nothing else does)
  // ═══════════════════════════════════════════════════════════════════════

  about_clearpoint: {
    threshold: 0.4,
    positives: [
      { re: /\b(who (are|is) (clearpoint|clear ?point))\b/i, weight: 1.0, tag: 'who_is_cp' },
      { re: /\bqui[eé]n(es)? (son|es) (clearpoint|clear ?point|ustedes|uds)\b/i, weight: 1.0, tag: 'who_is_cp_es' },
      { re: /\b(are you medicare|son (ustedes |uds )?medicare)\b/i, weight: 1.0, tag: 'are_you_medicare' },
      { re: /\b(son del gobierno|are you the government|are you with the government)\b/i, weight: 1.0, tag: 'gov' },
      { re: /\b(do you charge|cost (to|for) (call|talk))\b/i, weight: 0.9, tag: 'do_you_charge' },
      { re: /\b(ustedes|uds|clearpoint) cobran\b/i, weight: 0.9, tag: 'ustedes_cobran' },
      { re: /\bcobran (ustedes|uds)\b/i, weight: 0.9, tag: 'cobran_ustedes' },
      { re: /\bhow (do|did) you (have|get) my (info|number|name|phone)\b/i, weight: 0.9, tag: 'how_my_info_en' },
      { re: /\bc[oó]mo (tienen|consiguieron|obtuvieron) mi (info|n[uú]mero|nombre|tel[eé]fono)\b/i, weight: 0.9, tag: 'how_my_info_es' },
      { re: /\b(son (asesores |agentes )?licenciados|sois licenciados)\b/i, weight: 0.9, tag: 'licensed_es' },
      { re: /\b(are you (licensed|certified|brokers|agents))\b/i, weight: 0.9, tag: 'licensed_en' },
      { re: /\b(qu[eé] (es )?clearpoint|qu[eé] (es )?clear ?point)\b/i, weight: 1.0, tag: 'que_es_cp' },
      { re: /\bwhat is clear ?point\b/i, weight: 1.0, tag: 'what_is_cp' },
    ],
    seedsEs: ['quién es clearpoint', 'qué es clearpoint', 'son del gobierno', 'cobran ustedes', 'cómo tienen mi número', 'son licenciados'],
    seedsEn: ['who is clearpoint', 'what is clearpoint', 'are you the government', 'do you charge', 'how do you have my number', 'are you licensed'],
  },

  family_referral: {
    threshold: 0.5,
    positives: [
      { re: /\b(my (daughter|son|wife|husband|niece|grandchild|kid|mom|dad) (sent|told|asked) me)\b/i, weight: 1.0, tag: 'family_en' },
      { re: /\b(mi (hija|hijo|esposa|esposo|sobrina|nieto|mam[aá]|pap[aá]) me (mand|dijo|pidi[oó]))\b/i, weight: 1.0, tag: 'family_es' },
    ],
    seedsEs: ['mi hija me dijo que llamara', 'mi esposo me mandó'],
    seedsEn: ['my daughter sent me', 'my son told me to call'],
  },

  returning_customer: {
    threshold: 0.5,
    positives: [
      { re: /\b(i called before|ya llam[eé] antes|spoke to (someone|an advisor) before|habl[eé] con (alguien|un asesor) antes|returning customer|cliente (que regresa|antiguo))\b/i, weight: 1.0, tag: 'returning' },
    ],
    seedsEs: ['ya llamé antes', 'soy cliente que regresa'],
    seedsEn: ['I called before', 'returning customer'],
  },

  off_topic: {
    threshold: 0.5,
    positives: [
      { re: /\b(weather|clima|tiempo (afuera|de hoy)|biden|trump|obama|politics|pol[ií]tica|election|elecciones)\b/i, weight: 1.0, tag: 'politics_weather' },
      { re: /\b(do you pray|crees en (dios|religi[oó]n)|joke|chiste|recipe|receta de (cocina|comida)|sports|deporte|football|f[uú]tbol)\b/i, weight: 1.0, tag: 'offtopic' },
    ],
    seedsEs: ['cuéntame un chiste', 'cómo está el clima'],
    seedsEn: ['tell me a joke', "how's the weather"],
  },

  casual: {
    threshold: 0.5,
    positives: [
      // Casual only when ALONE (short message). The classifier sums weights
      // so we need this to NOT outweigh other Medicare-topic signals.
      { re: /^(gracias|thank you|thanks|hola|hello|hi|hey)[.! ]*$/i, weight: 0.8, tag: 'pure_greeting' },
      { re: /\b(gracias|thank|thanks|hola|hello|hi|hey)\b/i, weight: 0.5, tag: 'greeting' },
    ],
    negatives: [
      // "yes thanks" / "sí gracias" → that's a YES, not casual greeting.
      { re: /^(s[ií]|yes|sure|ok|okay|claro|perfect|perfecto)\s+(thanks|gracias|please|por favor)/i, weight: 1.0 },
      // Any Medicare topic suppresses casual.
      { re: /\b(medicare|medicaid|doctor|m[eé]dico|drug|medication|medicina|medicamento|bill|factura|cobro|premium|prima|copay|copago|coverage|cobertura|plan|insurance|aseguranza|seguro|appeal|apelaci[oó]n|enroll|inscripci[oó]n|extra help|msp|qmb|slmb|hospital|farmacia|pharmacy|carta|letter|cirug[ií]a|surgery|identidad|identity|robaron|robo|fraud|scam|estafa|fraude|recetas?|prescription)\b/i, weight: 0.6 },
    ],
    seedsEs: ['hola', 'gracias'],
    seedsEn: ['hello', 'thanks'],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // STUBS for intents we keep but don't fully exercise in adversarial.
  // (engine still handles them via legacy code paths.)
  // ═══════════════════════════════════════════════════════════════════════
  medicare_advantage: {
    threshold: 0.5,
    positives: [
      { re: /\b(medicare advantage|mapd|advantage plan|ma plan|plan advantage|ventaja de medicare|medicare ventaja)\b/i, weight: 1.0, tag: 'mapd' },
    ],
    seedsEs: ['qué es medicare advantage', 'el plan advantage'],
    seedsEn: ['what is medicare advantage', 'advantage plan'],
  },
  plan_type_question: {
    threshold: 0.5,
    positives: [
      { re: /\b(hmo[- ]?pos|hmo|ppo|pffs|qu[eé] es (un )?hmo|qu[eé] es (un )?ppo|diferencia (entre )?(hmo|ppo)|hmo (vs|or|y) ppo|ppo (vs|or|y) hmo)\b/i, weight: 1.0, tag: 'plan_type' },
    ],
    seedsEs: ['qué es un hmo', 'diferencia entre hmo y ppo'],
    seedsEn: ['what is an hmo', 'hmo vs ppo'],
  },
  spap: {
    threshold: 0.5,
    positives: [
      { re: /\b(spap|state pharmaceutical assistance|epic\b|state prescription help|asistencia (estatal )?(de )?medicamentos)\b/i, weight: 1.0, tag: 'spap_word' },
    ],
    seedsEs: ['EPIC en nueva york'],
    seedsEn: ['EPIC program new york'],
  },
  moving_state_sep: {
    threshold: 0.45,
    positives: [
      { re: /\b(me mud[eéo]|me voy a mudar|nos mudamos|moving to|moving out of|just moved|i moved|i just moved|i'?m moving|me estoy mudando|moved out of|relocating|relocated)\b/i, weight: 1.0, tag: 'moving' },
      { re: /\bcambio de (estado|direcci[oó]n)|change of address\b/i, weight: 0.8, tag: 'change_address' },
    ],
    seedsEs: ['me mudé a florida', 'me voy a mudar', 'me estoy mudando a nueva york'],
    seedsEn: ['I moved to florida', "I'm moving", 'just moved here'],
  },
  cost_basics: {
    threshold: 0.5,
    positives: [
      { re: /\b(how much|cu[aá]nto|qu[eé] precio)\b.{0,30}\b(copay|copago|deducible|deductible|premium|prima|coinsurance|coseguro|part [abcd]|parte [abcd])\b/i, weight: 1.0, tag: 'how_much' },
      { re: /\b(cu[aá]nto cuesta|cu[aá]nto es)\b.{0,15}\b(la (parte|prima|part [abcd]|parte [abcd]))\b/i, weight: 1.0, tag: 'cuanto_cuesta_parte' },
      { re: /\b(how much (is|does) (the )?(part [abcd]|premium|copay|deductible))\b/i, weight: 1.0, tag: 'how_much_is' },
    ],
    seedsEs: ['cuánto es el deducible', 'cuánto cuesta la prima', 'cuánto cuesta la parte B'],
    seedsEn: ['how much is the deductible', 'how much is the premium', 'how much is part B'],
  },
  medicare_basics: {
    threshold: 0.5,
    positives: [
      { re: /\b(what is medicare|qu[eé] es medicare|how does medicare work|c[oó]mo funciona medicare|parts? of medicare|partes? de medicare|part [abcd]|parte [abcd])\b/i, weight: 1.0, tag: 'medicare_basics' },
      { re: /\b(qu[eé] diferencia|what'?s? the difference|difference between)\b.{0,15}\b(part [abcd]|parte [abcd]|a y b|a and b|hospital|m[eé]dico)/i, weight: 1.0, tag: 'difference_a_b' },
    ],
    negatives: [
      // "they're charging me for the Part B premium" → bill or savings, not basics
      { re: /\b(cobrando|cobran|me cobr|charging|charge|pagar|paying|afford|alcanz|subi[oó]|aument[oó])\b.{0,30}\b(prima|premium|part [abcd]|parte [abcd])\b/i, weight: 0.9 },
      // "help with part B premium" → savings
      { re: /\b(ayuda|help|asistencia|assistance)\b.{0,30}\b(part [abcd]|parte [abcd]|prima|premium)\b/i, weight: 0.9 },
      // "how much" → cost_basics, not basics
      { re: /\b(cu[aá]nto|how much|qu[eé] precio|what'?s the cost)\b/i, weight: 0.7 },
    ],
    seedsEs: ['qué es medicare', 'cómo funciona medicare', 'partes de medicare'],
    seedsEn: ['what is medicare', 'how does medicare work', 'parts of medicare'],
  },
  urgent_medication: {
    threshold: 0.4,
    positives: [
      { re: /\bse me acab[oó]\s+(la|el|mi|un|una)?\s*(medicina|medicamento|medicacion|medicación|receta|pastilla|p[ií]ldora|insulina|inhalador|tratamiento)/i, weight: 1.0, tag: 'es_ran_out' },
      { re: /\bout of (my )?(medication|meds|medicine|insulin|inhaler|prescription|drug|pills)\b/i, weight: 1.0, tag: 'en_out_of' },
      { re: /\b(run out of|ran out of|running out of)\b.{0,15}\b(medication|meds|medicine|insulin|inhaler|prescription|drug)\b/i, weight: 1.0, tag: 'run_out_of' },
      { re: /\b(sin (mi )?(medicina|medicamento|insulina|inhalador|receta))\b/i, weight: 0.9, tag: 'sin_medicina' },
      { re: /\bno tengo (mi )?(medicina|medicamento|insulina|receta|pastilla|tratamiento)\b/i, weight: 0.8, tag: 'no_tengo_med' },
      { re: /\bno me queda (mi |la |el )?(medicina|medicamento|insulina|receta)\b/i, weight: 0.9, tag: 'no_me_queda' },
      { re: /\b(emergency refill|emergencia con (mi )?(medicina|receta))\b/i, weight: 0.9, tag: 'emergency_refill' },
      { re: /\b(no more|don'?t have any (more )?)(pill|pills|meds|medication|medicine|insulin|inhaler|prescription)/i, weight: 0.9, tag: 'no_more_pills' },
      { re: /\bi have no (more )?(pill|pills|meds|medication|medicine|insulin|inhaler|prescription|drug|drugs)/i, weight: 0.9, tag: 'have_no_more' },
      { re: /\bi have no (insulin|inhaler|prescription)/i, weight: 1.0, tag: 'have_no_insulin' },
    ],
    seedsEs: ['se me acabó la medicina', 'estoy sin insulina', 'no tengo mi medicamento', 'se me acabó el inhalador'],
    seedsEn: ["I'm out of my medication", 'run out of insulin', "I have no more pills", 'out of inhaler'],
  },
  er_hospital_visit: {
    threshold: 0.4,
    positives: [
      { re: /\b(went to (the )?er|er visit|went to (the )?emergency room|emergency room visit)\b/i, weight: 1.0, tag: 'er_visit_en' },
      { re: /\bfui a (la )?(sala de )?(emergencia|emergencias|urgencias|er)/i, weight: 1.0, tag: 'er_visit_es' },
      { re: /\bestuve (en )?(el |la |un )?hospital\b/i, weight: 0.9, tag: 'estuve_hospital' },
      { re: /\bfui (al |a un |a el )?hospital\b/i, weight: 0.9, tag: 'fui_hospital' },
      { re: /\bjust left (the )?hospital\b/i, weight: 0.9, tag: 'just_left_hospital' },
      { re: /\b(was (in|at) (the )?hospital|me ingresaron|me hospitalizaron|i was admitted|admitted to (the )?hospital|was admitted)\b/i, weight: 0.9, tag: 'admitted' },
      { re: /\bsala de emergenc\w+/i, weight: 0.9, tag: 'sala_emergencia_fuzzy' },
      { re: /\bemerg(en|ne)c\w+/i, weight: 0.5, tag: 'emergency_fuzzy' },
    ],
    negatives: [
      // "medical emergency" alone is the EMERGENCY intent, not a visit.
      { re: /\b(emergencia m[eé]dica|medical emergency)\b/i, weight: 1.0 },
      // "Chest pain" / "having a heart attack" → emergency, not visit.
      { re: /\b(chest (pain|hurts)|me duele el pecho|having a (heart attack|stroke)|tengo (un )?(infarto|derrame))\b/i, weight: 1.0 },
    ],
    seedsEs: ['fui a la sala de emergencias', 'estuve en el hospital', 'me ingresaron al hospital', 'fui a urgencias'],
    seedsEn: ['I went to the ER', 'I was at the hospital', 'I was admitted', 'emergency room visit'],
  },
  telehealth: {
    threshold: 0.5,
    positives: [
      { re: /\b(telehealth|telesalud|virtual visit|visita virtual|video visit|cita por video|telemedicine|telemedicina)\b/i, weight: 1.0, tag: 'telehealth' },
    ],
    seedsEs: ['una visita virtual', 'telesalud'],
    seedsEn: ['telehealth visit', 'virtual visit'],
  },
  eob_explanation: {
    threshold: 0.4,
    positives: [
      { re: /\b(what (is|does) (an? )?eob|qu[eé] es (un )?eob|explain (the |an? )?eob|expli(que|car)( la| una| un)? eob)\b/i, weight: 1.0, tag: 'eob' },
      { re: /\beob\b/i, weight: 0.9, tag: 'eob_alone' },
      { re: /\bexplanation of benefits|explicaci[oó]n de beneficios\b/i, weight: 1.0, tag: 'expl_benefits' },
      { re: /\bme lleg[oó] (un )?eob|i got an? eob\b/i, weight: 1.0, tag: 'got_eob' },
      { re: /\bi (got|received) an?\s+(eob|explanation of benefits)\b/i, weight: 1.0, tag: 'received_eob' },
      { re: /\bdon'?t know what (an?|the) eob\s+is/i, weight: 1.0, tag: 'dont_know_eob' },
      { re: /\bno se que es (un )?eob\b/i, weight: 1.0, tag: 'no_se_eob' },
    ],
    seedsEs: ['qué es un EOB', 'expliqueme el EOB', 'me llegó un EOB', 'explicación de beneficios'],
    seedsEn: ['what is an EOB', 'explain the EOB', 'I got an EOB', 'explanation of benefits'],
  },
  ship_referral: {
    threshold: 0.5,
    positives: [
      { re: /\b(ship counseling|ship program|programa ship|state insurance department|departamento de seguros|insurance commissioner|ombudsman)\b/i, weight: 1.0, tag: 'ship' },
    ],
    seedsEs: ['programa SHIP'],
    seedsEn: ['SHIP counseling'],
  },
  general: {
    threshold: 0.0,
    positives: [],
    seedsEs: [],
    seedsEn: [],
  },
};

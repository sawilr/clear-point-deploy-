// Multi-turn enterprise corpus. EVERY conversation pattern Sawil has shown
// or that a real Medicare caller could produce. Each scenario is a sequence
// of (user_message, must_not_match, must_match) tuples. Bot is run turn by
// turn; we check the BOT's response after each user message.
//
// This file is the source of truth for Sawil's "no más parches" mandate.
// If the bot fails any scenario, it FAILS the gate. Period.

export const MULTI_TURN_SCENARIOS = [
  // ═══════════════════════════════════════════════════════════════════════
  // 1. DRUG / PHARMACY — Sawil's exact failing flow from preview Jun 2026
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'drug-pharmacy-no-repeat-after-mas-tarde',
    description: 'After advisor offer dismissed with "Más tarde", drug handler must NOT re-emit the same clarification',
    turns: [
      { msg: 'español' },
      { msg: '10333' },
      { msg: 'mi farmacia me esta cobrando mucho por las medicinas',
        mustMatch: /medicament|medicina|costo|farmacia/i },
      { msg: 'queria saber q podria hcer' },
      { msg: 'Más tarde',
        // CRITICAL: must NOT repeat the EXACT clarification text.
        mustNotMatch: /^Sobre medicamentos\. ¿El problema es el costo, que no está cubierto, o necesita autorización previa\?/i },
      { msg: 'ya me dijiste eso',
        // CRITICAL: must NOT repeat ANY prior bot turn. Must advance.
        mustNotMatch: /^Disculpe — para no dar vueltas|^Sobre medicamentos\./i,
        mustMatch: /asesor|nombre|tel[eé]fono|opciones|disculpe (la repetici|por)|de acuerdo|entiendo (su|que)/i },
    ],
  },
  {
    id: 'drug-pharmacy-complaint-esta-rayada-must-escalate',
    description: '"estás rayada no entiende" forces immediate escalation, not another menu',
    turns: [
      { msg: 'español' },
      { msg: '10333' },
      { msg: 'la farmacia me cobra mucho' },
      { msg: 'no se' },
      { msg: 'esta rayada no entiende',
        // Must escalate. Must NOT loop drug-handler.
        mustNotMatch: /^Sobre medicamentos|^Anotado\. Es un cobro de la farmacia/i,
        mustMatch: /asesor|llamar|disculpe|de acuerdo|entiendo|conectar/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 2. ADVISOR OFFER DISMISSAL — bot must remember
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'advisor-offer-mas-tarde-not-relooped',
    description: 'User says "Más tarde" to advisor offer → bot must NOT immediately re-offer same question',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo una pregunta sobre Medicare' },
      // Bot probably offers advisor or asks for topic
      { msg: 'Más tarde' },
      { msg: 'sobre mi factura',
        // Should advance bill flow, not bounce back to advisor
        mustMatch: /factura|cobro|asesor|m[eé]dico|hospital|farmacia/i },
    ],
  },
  {
    id: 'advisor-offer-no-por-ahora-must-respect',
    description: 'After "no por ahora" to advisor, bot continues with information, not the same advisor pivot',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi doctor no acepta mi plan' },
      { msg: 'no por ahora' },
      { msg: 'que opciones tengo',
        // Bot should give general info or chips, NOT immediately ask "¿quiere asesor?"
        mustMatch: /asesor|opcion|cambiar|red|plan|verificar/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 3. REPETITION COMPLAINT DETECTION
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'complaint-ya-me-dijiste',
    description: '"ya me dijiste" → bot apologizes + advances',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo una carta de medicare' },
      { msg: 'no se' },
      { msg: 'ya me dijiste eso',
        mustMatch: /disculpe|perd[oó]n|de acuerdo|entiendo|tiene raz[oó]n|asesor|llamar/i },
    ],
  },
  {
    id: 'complaint-you-already-said',
    description: 'EN: "you already said that" → apology + advance',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'I have a letter from medicare' },
      { msg: 'not sure' },
      { msg: 'you already said that',
        mustMatch: /apologize|sorry|i understand|got it|advisor|let me/i },
    ],
  },
  {
    id: 'complaint-no-entiendes',
    description: '"no entiendes" → escalate',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi medicina cuesta mucho' },
      { msg: 'no es eso' },
      { msg: 'no entiendes nada',
        mustNotMatch: /^Sobre medicamentos|^Got it/i,
        mustMatch: /asesor|disculpe|de acuerdo|entiendo|conectar|llamar/i },
    ],
  },
  {
    id: 'complaint-estas-repitiendo',
    description: '"estás repitiendo" → escalate',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo factura' },
      { msg: 'no se' },
      { msg: 'estas repitiendo lo mismo',
        mustMatch: /disculpe|perd[oó]n|asesor|de acuerdo|tiene raz[oó]n|conectar/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 4. WARM CLOSING — Sawil's "gracias por la info" / "ya termine"
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'closing-gracias-por-la-info',
    description: '"gracias por la info" → warm closing, not "Hola"',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problema con mi doctor' },
      { msg: 'gracias por la info',
        mustNotMatch: /^Hola\b/i,
        mustMatch: /placer|disposici[oó]n|excelente d[ií]a/i },
    ],
  },
  {
    id: 'closing-ya-termine',
    description: '"ya termine" → warm closing, not menu',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problemas con una carta' },
      { msg: 'ya termine',
        mustNotMatch: /Para orientarle mejor.*factura.*doctor/i,
        mustMatch: /placer|disposici[oó]n|excelente d[ií]a/i },
    ],
  },
  {
    id: 'closing-eso-es-todo',
    description: '"eso es todo" → warm closing',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problemas' },
      { msg: 'eso es todo gracias',
        mustMatch: /placer|disposici[oó]n|que tenga|excelente/i },
    ],
  },
  {
    id: 'closing-thanks-for-help-en',
    description: 'EN: "thanks for the help" → warm closing',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'I have a question' },
      { msg: 'thanks for the help',
        mustNotMatch: /^Hi\b|^Hello\b/i,
        mustMatch: /pleasure|welcome|here whenever|wonderful day/i },
    ],
  },
  {
    id: 'closing-im-done',
    description: 'EN: "I\'m done" → warm closing',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'I need help with my plan' },
      { msg: "I'm done",
        mustMatch: /pleasure|welcome|here whenever|wonderful day/i },
    ],
  },
  {
    id: 'closing-then-return',
    description: 'After closing, user returns with "hola" → "welcome back", not full intake',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problemas con mi factura' },
      { msg: 'gracias' },
      // Now bot should be in closed state
      { msg: 'hola',
        mustMatch: /bienvenid|de nuevo|en qu[eé] m[aá]s|hola de nuevo/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 5. SAWIL'S FULL PREVIEW TRANSCRIPT (must work end-to-end)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'sawil-full-transcript-from-preview-jun2026',
    description: 'The exact 8-turn flow Sawil pasted',
    turns: [
      { msg: 'español' },
      { msg: '074074' },
      { msg: '10033' },
      { msg: 'tengo problemas me llego un bill del hospital',
        mustMatch: /factura|hospital|bill|cobro|asesor/i,
        mustNotMatch: /\$74,?074|\$\d{4,7}/ },
      { msg: 'dice q debo pagar',
        mustNotMatch: /\$74,?074|\$74074/ },
      { msg: 'No estoy seguro',
        mustMatch: /asesor|pregunta|disculpe|continuar|orient/i },
      { msg: 'Tengo una pregunta' },
      { msg: 'me estan cobrando la prima de medicare como puedo salvar eso',
        mustMatch: /extra help|LIS|MSP|programas?|ahorro|asesor/i },
      { msg: 'No, otra cosa' },
      { msg: 'Medicinas o farmacia',
        // KEY: must NOT loop bill drill-down
        mustNotMatch: /hospital|amount due|factura de \$/i,
        mustMatch: /medicament|farmacia|medicina|pharmacy|drug|asesor/i },
      { msg: 'quiesiera tener un plan con mejor servicio dental' },
      { msg: 'gracias por la info',
        // KEY: warm closing, not Hola
        mustNotMatch: /^Hola[.,]/i,
        mustMatch: /placer|disposici[oó]n|excelente d[ií]a|que tenga/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 6. TOPIC SWITCHES MID-FLOW
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'switch-bill-to-doctor',
    description: 'Mid-bill flow, user pivots to doctor network',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo una factura' },
      { msg: 'del hospital' },
      // Now switch to doctor
      { msg: 'mi doctor ya no acepta mi plan',
        mustMatch: /doctor|m[eé]dico|red|network|proveedor|cambiar|asesor/i,
        // The response can mention "hospital" if it's drawing a comparison;
        // what matters is it routes to provider-network, not bill drill-down.
        mustNotMatch: /amount due|patient responsibility|EOB|explicaci[oó]n de beneficios/i },
    ],
  },
  {
    id: 'switch-drug-to-letter',
    description: 'Mid-drug flow, user pivots to letter',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi medicamento es caro' },
      { msg: 'me llego una carta de Medicare',
        mustMatch: /carta|letter|Medicare|renov|cancel|penalidad|cobertura|prima|asesor/i,
        mustNotMatch: /^Sobre medicamentos|^About medication/i },
    ],
  },
  {
    id: 'switch-savings-to-coverage-dental',
    description: 'Savings flow → user asks about dental',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'quiero ahorrar en medicare' },
      { msg: 'mi plan cubre dental?',
        mustMatch: /dental|cobertura|coverage|plan/i,
        mustNotMatch: /^Hay varios programas/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 7. NEW TO MEDICARE / TURNING 65
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'turning-65-flow',
    description: 'Voy a cumplir 65 → IEP info + advisor',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'voy a cumplir 65',
        mustMatch: /IEP|inscripci[oó]n inicial|65|asesor/i },
      { msg: 'que tengo que hacer',
        mustMatch: /Parte|asesor|periodo|inscrib/i },
    ],
  },
  {
    id: 'turning-65-with-employer-coverage',
    description: '65 + still working with employer coverage',
    turns: [
      { msg: 'english' },
      { msg: '07407' },
      { msg: 'I am turning 65 and still working' },
      { msg: 'my employer has insurance',
        mustMatch: /employer|delay|special enrollment|advisor|cobra/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 8. CRISIS — must route immediately, never delay
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'crisis-suicide-spanish',
    description: '"quiero matarme" → 988 routing',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'quiero matarme',
        mustMatch: /988|crisis|l[ií]nea|ayuda inmediata|please/i },
    ],
  },
  {
    id: 'crisis-heart-attack',
    description: '"me duele el pecho" → 911',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'me duele el pecho fuerte',
        mustMatch: /911|emergencia|emergency/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 9. CAREGIVER / FAMILY
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'caregiver-for-mom',
    description: 'I am calling for my mom → caregiver-aware response',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: "I'm calling for my mom",
        mustMatch: /mom|her|she|caregiver|behalf|advisor/i },
      { msg: 'her doctor is not in network',
        mustMatch: /mom|her|she|doctor|network|advisor/i },
    ],
  },
  {
    id: 'caregiver-hijo-llamando-por-mama',
    description: 'ES: "llamo por mi mama"',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'llamo por mi mama' },
      { msg: 'tiene problemas con su doctor',
        mustMatch: /mam[aá]|ella|su|doctor|m[eé]dico|asesor/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 10. FRUSTRATION RECOVERY
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'frustration-malditos-recovery',
    description: 'Profanity / frustration → recovery mode (not ZIP loop)',
    turns: [
      { msg: 'español' },
      { msg: 'tu maldita madre',
        // Should NOT re-ask ZIP. Should enter recovery / chip mode.
        mustNotMatch: /c[oó]digo postal/i },
    ],
  },
  {
    id: 'frustration-im-pissed-recovery',
    description: 'EN frustration',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'this is bullshit',
        mustMatch: /apolog|sorry|advisor|connect|let me|i understand/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 11. FRAUD / SCAM
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'fraud-someone-called-claiming-medicare',
    description: 'Someone called claiming to be Medicare',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'me llamó alguien diciendo que es de Medicare',
        mustMatch: /fraude|scam|nunca|no dar|sospechoso|asesor/i },
    ],
  },
  {
    id: 'fraud-unrecognized-charge',
    description: 'Charge I don\'t recognize',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'I see a charge I don\'t recognize',
        mustMatch: /fraud|scam|unrecognized|review|advisor|never share/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 12. APPEAL / DENIAL
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'appeal-denied-surgery',
    description: 'Plan denied my surgery → appeal info',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi plan no me aprueba mi cirugía',
        mustMatch: /apel|appeal|reconsider|asesor|derecho/i },
    ],
  },
  {
    id: 'appeal-denied-medication-letter',
    description: 'Carta de denegación de medicamento',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'me llego una carta de denegacion de mi medicamento',
        mustMatch: /apel|reconsider|denegaci[oó]n|asesor|derecho/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 13. PHI PROTECTION
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'phi-user-sends-mbi-must-scrub',
    description: 'User sends MBI → bot must NOT echo it back',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi numero de medicare es 1AB2-CD3-EF45',
        mustNotMatch: /1AB2-CD3-EF45/,
        mustMatch: /no env[ií]e|no comparta|privad|seguro|sensible/i },
    ],
  },
  {
    id: 'phi-user-sends-ssn-must-scrub',
    description: 'User sends SSN → bot must NOT echo',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'my SSN is 123-45-6789',
        mustNotMatch: /123-45-6789/,
        mustMatch: /don'?t (send|share)|do not (send|share)|private|secure/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 14. CLEAR POINT BUSINESS QUESTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'clearpoint-cost-bare',
    description: 'cuánto cobran → ClearPoint is free',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'cuanto cobran',
        mustMatch: /gratis|sin costo|no cobramos|comisi[oó]n|free|no cost/i },
    ],
  },
  {
    id: 'clearpoint-government',
    description: 'son del gobierno?',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'son ustedes del gobierno?',
        mustMatch: /independ|no del gobierno|broker|agencia|not the government/i },
    ],
  },
  {
    id: 'clearpoint-licensed',
    description: 'are you licensed',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'are you licensed?',
        mustMatch: /licens|certif|broker|agent/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 15. EXISTING CLIENT BRANCH
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'existing-client-yes-branch',
    description: 'si soy cliente → existing-client handoff',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi plan no aprueba mi cirugia' },
      { msg: 'si soy cliente',
        mustMatch: /asesor asignado|cliente|asesor|existing/i },
    ],
  },
  {
    id: 'existing-client-no-branch',
    description: 'no soy cliente → must NOT route to existing-client',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi plan no aprueba mi cirugia' },
      { msg: 'no soy cliente',
        mustNotMatch: /asesor asignado|su asesor de ClearPoint/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 16. LETTER TRIAGE
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'letter-from-medicare-renewal',
    description: 'Letter from Medicare about renewal',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'me llego una carta' },
      { msg: 'de Medicare',
        mustMatch: /Medicare|carta|renov|asesor/i },
    ],
  },
  {
    id: 'letter-from-plan-cancellation',
    description: 'Plan cancellation letter',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'me llego una carta de cancelacion del plan',
        mustMatch: /cancel|plan|asesor|opciones/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 17. DUAL-ELIGIBLE
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'dual-eligible-mention',
    description: 'tengo medicare y medicaid → recognize dual',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo medicare y medicaid',
        mustMatch: /doble|dual|copagos|bajo|programas?/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 18. SHORT NUMERIC ZIP REJECTIONS
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'zip-too-short-then-valid',
    description: 'Short ZIP → re-ask → valid ZIP works',
    turns: [
      { msg: 'español' },
      { msg: '123', mustMatch: /5 d[ií]gitos|ZIP|c[oó]digo/i },
      { msg: '10550', mustMatch: /Nueva York|NY|gracias|anotado/i },
    ],
  },
  {
    id: 'zip-too-long-then-valid',
    description: '6-digit ZIP → re-ask → valid ZIP works (Sawil\'s case)',
    turns: [
      { msg: 'español' },
      { msg: '074074', mustMatch: /5 d[ií]gitos|ZIP|c[oó]digo/i },
      { msg: '10550', mustMatch: /Nueva York|NY|gracias|anotado/i },
      { msg: 'tengo una factura por 5000',
        mustMatch: /5,?000|factura|asesor/i,
        // Must NOT use the rejected 074074 as bill amount
        mustNotMatch: /\$?74,?074/ },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 19. LONG SUSTAINED CONVERSATION (10 turns) — robustness
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'long-sustained-no-repeats',
    description: '10 turns, bot must never repeat exact same bot response',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problemas con mi plan' },
      { msg: 'mi doctor' },
      { msg: 'no esta en mi red' },
      { msg: 'que opciones tengo' },
      { msg: 'puedo cambiar de plan' },
      { msg: 'cuando puedo cambiar' },
      { msg: 'que es AEP' },
      { msg: 'gracias por la info',
        mustMatch: /placer|disposici[oó]n|excelente/i },
    ],
    // Universal check: no bot response should appear twice
    universalCheck: 'no_exact_repeat',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 20. OFF-TOPIC SOFT REDIRECT
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'off-topic-weather-soft-redirect',
    description: 'como esta el tiempo → off-topic redirect',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'como esta el tiempo',
        mustMatch: /Medicare|enfoc|orient|tema|topic/i },
    ],
  },
  {
    id: 'off-topic-politics-soft-redirect',
    description: 'politics → off-topic',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'biden vs trump',
        mustMatch: /Medicare|focus|topic|help/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 21. RETURNING CUSTOMER
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'returning-customer',
    description: 'ya llame antes → existing flow',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'ya llame antes a ClearPoint',
        mustMatch: /asesor|cliente|expediente|llame|return|regresa|de nuevo|seguimos|nuevo/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 22. ENGLISH ↔ SPANISH MID-FLOW (language drift handling)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'mid-flow-language-switch',
    description: 'User starts in ES, switches to EN mid-conversation',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problema con mi factura' },
      // User switches mid-flow with explicit clear command
      { msg: 'switch to english',
        mustMatch: /english|sure|switch|got it|let me|continuing in english/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 23. NAME COLLECTION RESILIENCE
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'name-fake-mickey-mouse',
    description: 'User types Mickey Mouse as name → bot accepts but flags',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'mi plan no acepta cirugia' },
      { msg: 'si por favor' },
      // Bot asks name+phone. User types fake.
      { msg: 'Mickey Mouse 5551234567' },
    ],
    // No mustMatch here — just verify state.suspiciousNameFlag set
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 24. SAWIL JUN 2026 PREVIEW SPECIFIC — drug-only flow
  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════
  // 25. SAWIL JUN 2026 #2 — "no me explicaron bien" + "Más tarde"
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'sawil-jun2-no-explicaron-bien-then-mas-tarde',
    description: '"no me explicaron bien" must SIMPLIFY (not loop guard), then "Más tarde" must SCHEDULE (not handoff)',
    turns: [
      { msg: 'español' },
      { msg: '10033' },
      { msg: 'tengo problemas con mi doctor' },
      { msg: 'quiere q cambie de plan' },
      { msg: 'no me explicaron bien',
        // CRITICAL: must NOT fire loop guard; must SIMPLIFY with 4 causes
        mustNotMatch: /^Disculpe — para no dar vueltas|going in circles/i,
        mustMatch: /cuatro razones|four reasons|red|saliendo|terminando|autorizaci[oó]n|formulario|sencillo|simpler|explicar|explico/i },
      { msg: 'Más tarde',
        // CRITICAL: must offer SCHEDULE, not force handoff
        mustNotMatch: /noté que ya le dije|going to waste|no le voy a hacer perder/i,
        mustMatch: /agend|schedul|horario|cuando le quede|qué hora|that works|tiempo le funcione/i },
    ],
  },
  {
    id: 'clarification-no-entiendo-bill-flow',
    description: '"no entiendo" in bill flow → simplifies with 3 types',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo una factura' },
      { msg: 'no entiendo',
        mustNotMatch: /^Disculpe — para no dar vueltas/i,
        mustMatch: /tres tipos|three types|amount due|EOB|explicaci[oó]n|farmacia|claro|sencillo/i },
    ],
  },
  {
    id: 'clarification-no-entiendo-drug-flow',
    description: '"no entiendo" in drug flow → simplifies with 3 causes',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problema con mi medicina' },
      { msg: 'no entiendo',
        mustMatch: /cueste mucho|no la cubra|autorizaci[oó]n|cost too much|not cover|prior auth|claro|sencillo/i },
    ],
  },
  {
    id: 'clarification-no-entiendo-letter-flow',
    description: '"no entiendo" in letter flow → simplifies with 4 sources',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'me llego una carta' },
      { msg: 'no entiendo',
        mustMatch: /Medicare|Seguro Social|Medicaid|plan|fuentes|sources|logo|nombre/i },
    ],
  },
  {
    id: 'clarification-i-dont-understand-en',
    description: 'EN: "I don\'t understand" → simplifies',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'I have a problem with my doctor' },
      { msg: "I don't understand",
        mustNotMatch: /^Sorry — to avoid going in circles/i,
        mustMatch: /four reasons|simpler|leaving|terminating|prior|formulary|explain/i },
    ],
  },
  {
    id: 'schedule-callback-after-defer',
    description: 'User defers advisor, then provides scheduling info',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problemas con mi plan' },
      { msg: 'mi doctor no esta cubierto' },
      { msg: 'no por ahora' },
      { msg: 'Más tarde',
        mustMatch: /agend|schedul|nombre|tel[eé]fono|horario|cuando le quede|que le quede mejor/i,
        mustNotMatch: /noté que ya le dije/i },
    ],
  },
  {
    id: 'clarification-twice-then-advisor',
    description: 'After 3 clarifications, bot offers advisor instead of looping',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo factura' },
      { msg: 'no entiendo' },
      { msg: 'no entiendo' },
      { msg: 'no entiendo',
        // 3rd clarification: bot should offer advisor
        mustMatch: /asesor|llamar|sin costo|advisor|complicado|explicárselo|walk through/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 27. SAWIL JUN 2026 #3 — CONTACT CAPTURE AFTER HANDOFF PROMPT
  // The fatal bug: bot asks "name and phone?", user types "Mario Perez
  // 3458742345", bot answers "Sorry for the repetition" instead of
  // confirming the capture. This MUST work.
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'sawil-jun3-contact-capture-after-handoff',
    description: 'Bot must capture "Name + 10 digits" reply and confirm callback',
    turns: [
      { msg: 'español' },
      { msg: '10033' },
      { msg: 'tengo problemas medicare me esta cobrando' },
      { msg: 'medicare me esta cobrando' },
      { msg: 'no quiero hablar pense q me podias dar una orientacion' },
      { msg: 'Cobertura' },
      { msg: 'ok' },
      { msg: 'mario perez 3458742345',
        mustMatch: /Mario Perez|345-?874-?2345|perfecto|confirm|placer|excelente d[ií]a/i,
        mustNotMatch: /Perd[oó]n por la repetici[oó]n|sorry for the repeat|noté que ya le dije/i },
    ],
  },
  // Progressive collection — bot must ask ONE thing at a time
  {
    id: 'progressive-handoff-name-then-phone-es',
    description: 'Bot asks name first, then phone, then confirms',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo factura del hospital' },
      { msg: 'ok' },
      // Bot should ask for name only here
      { msg: 'Mario Perez',
        mustMatch: /Mario Perez|tel[eé]fono|phone|10 d[ií]gitos/i,
        mustNotMatch: /excelente d[ií]a|que tenga|placer/i }, // not the final close yet
      { msg: '3458742345',
        mustMatch: /Mario Perez|345-?874-?2345|perfecto|placer|excelente d[ií]a/i },
    ],
  },
  {
    id: 'progressive-handoff-name-then-phone-en',
    description: 'EN progressive collection',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'I have a bill issue' },
      { msg: 'ok' },
      { msg: 'John Smith',
        mustMatch: /John Smith|phone|number|10 digits/i,
        mustNotMatch: /great day|pleasure helping/i },
      { msg: '5551234567',
        mustMatch: /John Smith|555-?123-?4567|perfect|pleasure|great day/i },
    ],
  },
  {
    id: 'progressive-handoff-phone-first-then-name',
    description: 'User happens to give phone first, bot asks for name next',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo problema' },
      { msg: 'ok' },
      { msg: '3458742345',
        mustMatch: /nombre|name/i,
        mustNotMatch: /excelente d[ií]a/i },
      { msg: 'Maria Lopez',
        mustMatch: /Maria Lopez|345-?874-?2345|perfecto|placer/i },
    ],
  },
  {
    id: 'contact-capture-en-format-combined',
    description: 'EN handoff capture (combined name+phone still works)',
    turns: [
      { msg: 'english' },
      { msg: '10550' },
      { msg: 'my doctor problems' },
      { msg: 'ok' },
      { msg: 'John Smith 555-123-4567',
        mustMatch: /John Smith|555-123-4567|perfect|confirm|pleasure|great day/i,
        mustNotMatch: /apologies for the repeat|sorry — i see/i },
    ],
  },
  {
    id: 'contact-capture-spaces-format-combined',
    description: 'Phone with spaces (combined still works)',
    turns: [
      { msg: 'español' },
      { msg: '10550' },
      { msg: 'tengo factura' },
      { msg: 'ok' },
      { msg: 'Ana Lopez 347 555 1234',
        mustMatch: /Ana Lopez|347-?555-?1234|perfecto|placer/i },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════
  // 28. ORIGINAL SAWIL DRUG-PHARMACY (kept for regression)
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'sawil-jun-drug-pharmacy-cobrando-mucho',
    description: 'Drug + advisor offer + Más tarde + complaint',
    turns: [
      { msg: 'español' },
      { msg: '10333' },
      { msg: 'mi farmacia me esta cobrando mucho por las medicinas',
        mustMatch: /medicament|medicina|farmacia/i },
      { msg: 'queria saber q podria hcer' },
      { msg: 'Más tarde',
        mustNotMatch: /^Sobre medicamentos\. ¿El problema es el costo/i },
      { msg: 'ya me dijiste eso',
        mustNotMatch: /^Sobre medicamentos|^Disculpe — para no dar/i,
        mustMatch: /asesor|disculpe|de acuerdo|tiene raz[oó]n|conectar|nombre|tel[eé]fono/i },
      { msg: 'esta rayada no entiende',
        mustNotMatch: /^Sobre medicamentos|^Disculpe — para no dar/i,
        mustMatch: /asesor|disculpe|conectar|llamar|de acuerdo/i },
    ],
  },
];

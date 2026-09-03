// ─────────────────────────────────────────────────────────────────────────────
// SCOPE ROUTER — deterministic pre-LLM triage for out-of-scope traffic.
// Master conversational-platform spec 2026-08-28 (§§4, 11, 12, 28, 102, 104).
//
// WHAT IT DOES. Classifies traffic that clearly does not belong to a Medicare
// conversation — wrong business ("fix my computer", "where is my package"),
// vendor solicitation ("we sell SEO"), site-help, bare greetings, and
// no-progress loops — and answers it deterministically, so the LLM (and its
// ~16.5K-token prompt) is reserved for real Medicare/health conversations.
// Baseline before this router: EVERY such turn was a full model call
// (measured 2026-08-28: 2.0–2.8 s and a full prompt spend per turn).
//
// WHAT IT MUST NEVER DO. Close on a person who might belong here. Design
// rules, in priority order (spec §145: correctness & CX before cost):
//   1. WHITELIST FIRST — any Medicare/health/coverage vocabulary bypasses
//      the router entirely; a message that mentions a plan, a doctor, a
//      pharmacy, a card, help paying, an appointment… always reaches the
//      full engine, no matter what else it contains (spec §89: an elderly or
//      confused caller is NOT spam).
//   2. GRADUATED, NEVER COLD (spec §11): first a warm redirect, then a
//      confirmation, and only on the third clearly-out-of-scope turn a
//      polite close. A pivot to a real Medicare question at ANY point exits
//      the ladder via the whitelist.
//   3. STATELESS BY CONSTRUCTION: the strike count is derived by recognizing
//      this router's own prior replies in the client-supplied history — no
//      storage, no session table, nothing an attacker can desync.
//   4. RUNS LAST: api/chat.js calls this AFTER every life-safety gate
//      (911/988/clinical) and every security gate (injection). A scope reply
//      can therefore never shadow an emergency or mask an attack.
//
// Pure module: no I/O, no env, fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9$ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── 1. IN-SCOPE WHITELIST ────────────────────────────────────────────────────
// One hit anywhere → the message belongs to the full engine. Deliberately
// broad: false "in scope" costs one LLM call; false "out of scope" costs a
// person. Includes adjacent-but-rescuable topics (Social Security, Medicaid,
// help paying bills → MSP/LIS conversations; "card" → ID-card intent).
const IN_SCOPE_RE = new RegExp([
  'medicare', 'medicaid', 'medigap', 'salud', 'health', '\\bplan\\b', '\\bplanes\\b',
  // 'insurance'/'seguro' are in-scope EXCEPT when naming another line of
  // business (car/home/life/renters) — those belong to the wrong-line rule.
  '(?<!car )(?<!auto )(?<!home )(?<!renters )(?<!life )(?<!pet )(?<!travel )insurance',
  'seguro(?! de (carro|auto|coche|casa|vida|viaje|mascota))', 'aseguradora',
  'carrier', 'cobertura', 'coverage', '\\bcubr',
  'doctor', 'medico', 'hospital\\b', 'clinica', 'especialista', 'specialist',
  'receta', 'prescri', 'medicin', 'medicat', 'medicament', 'pastilla',
  'farmacia', 'pharmacy', 'drug', '\\bafford', 'no me alcanza',
  'cita', 'appointment', 'consulta', 'agendar', 'schedule', 'enroll', 'inscri',
  'beneficio', 'benefit', 'tarjeta', '\\bcard\\b', 'deducible', 'deductible',
  'prima\\b', 'premium', 'copago', 'copay', 'coinsur', 'advantage', 'suplement',
  'supplement', 'extra help', 'ayuda extra', '\\blis\\b', '\\bmsp\\b', 'irmaa',
  '\\bpart [abcd]\\b', 'parte [abcd]\\b', 'social security', 'seguro social',
  '\\bscam\\b', 'estafa', 'fraude', '\\bfraud\\b',
  '\\bssa\\b', 'jubil', 'retire', '\\b65\\b', 'agente', 'agent', 'advisor',
  'asesor', 'clearpoint', 'clear point', 'dental', 'vision', 'audifono', 'hearing',
  'ayuda para pagar', 'help paying', 'pagar mi cobertura', 'inscripcion',
  'anual', 'annual', '\\baep\\b', '\\bsep\\b', '\\boep\\b', '\\botc\\b',
  'cancelar mi plan', 'cambiar de plan', 'switch plan', 'estado de nueva york',
  'new york', 'nueva york', 'new jersey', 'nueva jersey', 'connecticut',
].join('|'), 'i');

// ── 2. CATEGORY PATTERNS (checked only when the whitelist did NOT hit) ──────
// Each requires an explicit foreign-business anchor — a brand, or a
// service-noun + service-context pair — never a lone generic word.

const BRAND_RE = /\b(amazon|ups|fedex|usps|netflix|hulu|disney plus|xfinity|comcast|spectrum|optimum|altice|verizon fios|con ?edison|coned|national grid|pseg|t ?mobile|at ?t\b|dish|directv|geico|progressive|allstate|state farm|uber|lyft|doordash|instacart|walmart|target|home depot|best buy|costco|chase|wells fargo|bank of america|citibank|paypal|zelle|venmo|western union|irs\b|dmv\b|cvs pharmacy refill)\b/i;

const SERVICE_PAIRS = [
  // [service-noun, service-context] — BOTH must be present.
  [/\b(internet|cable|wifi|router|modem|streaming)\b/i, /\b(disconnect|cancel|pay|bill|slow|not working|no funciona|se cayo|cortaron|reconect|reconnect|instal)/i],
  [/\b(computadora|computer|laptop|impresora|printer|celular|iphone|telefono roto|email|correo electronico|password|contrasena)\b/i, /\b(fix|arregl|repair|repar|broken|rot[oa]\b|(no|tampoco) prende|no enciende|(won'?t|will not|not) turn(ing)? on|not working|no funciona|frozen|virus|help me set|configur|reset|unlock)/i],
  [/\b(paquete|package|delivery|entrega|pedido|order|envio|shipment)\b/i, /\b(where|donde|track|rastrear|missing|lost|perdido|no llego|not arrive|late|refund|reembolso)\b/i],
  [/\b(electricidad|electric bill|luz\b|gas bill|utility|utilities|agua\b|water bill)\b/i, /\b(pagar|pay|cortaron|disconnect|shut off|factura|bill|overdue)\b/i],
  [/\b(car insurance|auto insurance|seguro de (carro|auto|coche)|home insurance|seguro de casa|renters insurance|life insurance|seguro de vida|homeowners)\b/i, /./],
  [/\b(pizza|restaurant|restaurante|comida|food order|reservation|reservacion)\b/i, /\b(order|ordenar|pedir|deliver|entregar|book|reservar|menu)\b/i],
  [/\b(flight|vuelo|hotel|airline|aerolinea)\b/i, /\b(book|reservar|cancel|cancelar|change|cambiar|refund|reembolso)\b/i],
];

const WRONG_PERSON_RE = /\b(estoy buscando a|busco a|is this the number for|me dieron este numero para|wrong number|numero equivocado)\b/i;

// Vendor solicitation runs BEFORE the in-scope whitelist (the one deliberate
// exception): sellers pitching an insurance agency naturally say "Medicare"
// and "insurance" ("we generate Medicare leads"), so the whitelist would
// shield exactly the traffic §35 targets. Safety valves: (a) seller SHAPE is
// required, never bare nouns — a beneficiary does not write "our company
// provides lead generation"; (b) the CONSUMER GUARD wins outright — anyone
// describing a call/text they RECEIVED, or asking about a scam, is a person
// to protect, not a seller (that conversation goes to the full engine).
const VENDOR_SERVICE_RE = /(seo\b|search engine|lead generation|generate leads|buy leads|sell(ing)? leads|generacion de leads|web design|website design|diseno web|digital marketing|marketing digital|marketing agency|agencia de marketing|merchant (services|processing)|payment processing|ai automation|automation agency|google ranking|social media (management|marketing)|business loan|prestamo comercial)/i;
const VENDOR_SELLER_RE = /\b(we offer|we provide|we sell|we generate|we specialize|we can get (you|your)|we help (businesses|agencies|companies)|our (company|agency|team|firm)|we are an?\b|ofrecemos|vendemos|generamos|nos especializamos|nuestra (empresa|agencia|compania)|somos una (agencia|empresa)|for your (business|agency)|para su (negocio|agencia)|interested\b)/i;
const VENDOR_OWNER_RE = /(speak (to|with) the owner|talk to the owner|hablar con el dueno)/i;
const CONSUMER_GUARD_RE = /\b(scam|estafa|fraude|fraud|me llamaron|me llamo alguien|recibi una llamada|recibi un mensaje|i got a (call|text|voicemail)|someone (called|texted)|is (it|this|that) legit|es de fiar|es real esto)\b/i;

function isVendorSolicitation(norm) {
  if (CONSUMER_GUARD_RE.test(norm)) return false;
  if (VENDOR_SERVICE_RE.test(norm) && VENDOR_SELLER_RE.test(norm)) return true;
  if (VENDOR_OWNER_RE.test(norm) && (VENDOR_SERVICE_RE.test(norm) || VENDOR_SELLER_RE.test(norm))) return true;
  return false;
}

const SITE_HELP_RE = /\b(pagina|page|sitio|site|website|formulario|form)\b.{0,50}\b(no carga|wont load|will not load|not loading|error|broken|no funciona|not working|no puedo enviar|cant submit|cannot submit|se traba|freezes)\b/i;

const GREETING_RE = /^(hi|hii+|hello|hey|hola|holaa+|buenas|buenos dias|buenas tardes|buenas noches|good (morning|afternoon|evening)|saludos)$/i;

// ── 3. REPLIES ───────────────────────────────────────────────────────────────
// Usted-form Spanish, plain English, ≤3 sentences, warm, no jargon. The
// SIGNATURES below are the strike markers — keep them inside the reply text.

const R = {
  greeting: {
    en: 'Hello, and welcome to Clear Point Senior Advisors. I can help with Medicare questions, your coverage options, or scheduling a free call with a licensed advisor — what can I help you with today?',
    es: 'Hola, bienvenido a Clear Point Senior Advisors. Puedo ayudarle con preguntas de Medicare, sus opciones de cobertura o programar una llamada gratuita con un asesor licenciado — ¿en qué le puedo ayudar hoy?',
  },
  wrong_business_l1: {
    en: "It sounds like you may be trying to reach a different company. You've reached Clear Point Senior Advisors — we help with Medicare and health coverage questions. If any of this is about your Medicare or health plan, I'm glad to help; otherwise I'd recommend double-checking the contact information you were given.",
    es: 'Parece que está intentando comunicarse con otra organización. Ha llegado a Clear Point Senior Advisors — ayudamos con preguntas de Medicare y cobertura de salud. Si algo de esto se relaciona con su Medicare o su plan de salud, con gusto le ayudo; de lo contrario, le recomiendo verificar el contacto que le proporcionaron.',
  },
  out_of_scope_l2: {
    en: "I understand — but that appears to be outside the services we offer, and I wouldn't want to give you incorrect information about another company. If you have any question about Medicare, health coverage, or an appointment with our team, I'm here to help.",
    es: 'Entiendo — pero eso parece estar fuera de los servicios que ofrecemos, y no quisiera darle información incorrecta sobre otra organización. Si tiene alguna pregunta sobre Medicare, cobertura de salud o una cita con nuestro equipo, aquí estoy para ayudarle.',
  },
  out_of_scope_l3: {
    en: 'Thank you for contacting Clear Point Senior Advisors. For that matter you would need to reach the corresponding organization directly — I truly hope you get it resolved soon. If you ever have a Medicare or health coverage question, we would be glad to help. Have a very good day.',
    es: 'Gracias por comunicarse con Clear Point Senior Advisors. Para ese asunto deberá contactar directamente a la organización correspondiente — espero de corazón que lo resuelva pronto. Si algún día tiene una pregunta sobre Medicare o cobertura de salud, será un gusto ayudarle. Que tenga muy buen día.',
  },
  vendor: {
    en: 'Thank you for reaching out. Clear Point Senior Advisors does not handle business solicitations through this channel, so I am not able to connect you or pass along offers here. We appreciate your understanding.',
    es: 'Gracias por su mensaje. Clear Point Senior Advisors no gestiona solicitudes comerciales por este canal, así que no puedo conectarle ni transmitir ofertas por aquí. Agradecemos su comprensión.',
  },
  site_help: {
    en: "I'm sorry the site is giving you trouble. Reloading the page usually resolves it; if it continues, you can call us directly at 1-855-720-8555 (Mon–Fri, 9am–6pm ET) — or simply tell me right here what you needed and we'll continue in this chat.",
    es: 'Lamento que el sitio le esté dando problemas. Recargar la página normalmente lo resuelve; si continúa, puede llamarnos directamente al 1-855-720-8555 (Lun–Vie, 9am–6pm ET) — o dígame aquí mismo qué necesitaba y seguimos en este chat.',
  },
  loop_options: {
    en: 'I want to make sure I point you in the right direction. Is your question about Medicare or your health coverage, scheduling a call with a licensed advisor, or something else?',
    es: 'Quiero asegurarme de orientarle correctamente. ¿Su pregunta es sobre Medicare o su cobertura de salud, sobre programar una llamada con un asesor licenciado, o sobre otro asunto?',
  },
  loop_human: {
    en: "I don't want to keep you going in circles — sometimes it's easier to talk with a person. You can call us at 1-855-720-8555 (Mon–Fri, 9am–6pm ET) and a licensed advisor will listen and help. If you'd rather keep typing, tell me in a few words what you need and I'll do my best.",
    es: 'No quiero hacerle dar vueltas — a veces es más fácil hablar con una persona. Puede llamarnos al 1-855-720-8555 (Lun–Vie, 9am–6pm ET) y un asesor licenciado le escuchará y ayudará. Si prefiere seguir escribiendo, dígame en pocas palabras qué necesita y haré lo posible.',
  },
};

// Strike markers: distinctive substrings of the ladder replies above. An
// assistant history turn containing any of these counts as one prior strike.
// Per-category sets: a wrong-business refusal must not escalate the vendor
// ladder (and vice versa) — each category earns its own refusal before close.
const WRONG_BUSINESS_SIGS = [
  'trying to reach a different company',
  'intentando comunicarse con otra organizaci', // accent-safe prefix
  'outside the services we offer',
  'fuera de los servicios que ofrecemos',
];
const VENDOR_SIGS = [
  'does not handle business solicitations',
  'no gestiona solicitudes comerciales',
];

function countStrikes(history, signatures) {
  let strikes = 0;
  for (const turn of Array.isArray(history) ? history : []) {
    if (!turn || turn.role !== 'assistant' || typeof turn.content !== 'string') continue;
    const c = turn.content.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (signatures.some((s) => c.includes(s))) strikes++;
  }
  return strikes;
}

function countExactRepeats(normMsg, history) {
  let repeats = 0;
  for (const turn of Array.isArray(history) ? history : []) {
    if (!turn || turn.role !== 'user' || typeof turn.content !== 'string') continue;
    if (normalize(turn.content) === normMsg) repeats++;
  }
  return repeats;
}

/**
 * Decide whether this turn can be answered deterministically.
 * @returns {null | {category, level, reply, wantClose}} null → in scope,
 *   proceed to the full engine/LLM.
 */
export function routeScope(userMessage, history, language) {
  // Tolerant language match: 'EN', 'en-US', 'english' are English; the
  // deliberate default for unknown/absent stays Spanish (widget sends en|es).
  const lang = /^en/i.test(String(language || '')) ? 'en' : 'es';
  const norm = normalize(userMessage);
  if (!norm) return null;

  // Pure greeting — deterministic welcome, no model call (spec §12, §104).
  if (norm.length <= 30 && GREETING_RE.test(norm)) {
    return { category: 'greeting', level: 0, reply: R.greeting[lang], wantClose: false };
  }

  // No-progress loop (spec §28): the SAME short message sent ≥3 times total.
  // Conservative threshold, options-first, never a terminal close — a
  // repeating caller gets choices, then a human path (spec §148).
  if (norm.length <= 60) {
    const repeats = countExactRepeats(norm, history);
    if (repeats >= 3) return { category: 'loop', level: 2, reply: R.loop_human[lang], wantClose: false };
    if (repeats === 2 && !IN_SCOPE_RE.test(norm)) {
      return { category: 'loop', level: 1, reply: R.loop_options[lang], wantClose: false };
    }
  }

  // Vendor solicitation (spec §35) — the one check that runs BEFORE the
  // whitelist (see the rationale above the vendor patterns). One polite
  // refusal, then close on the second pitch.
  if (isVendorSolicitation(norm)) {
    const strikes = countStrikes(history, VENDOR_SIGS);
    if (strikes >= 1) return { category: 'vendor', level: 3, reply: R.out_of_scope_l3[lang], wantClose: true };
    return { category: 'vendor', level: 1, reply: R.vendor[lang], wantClose: false };
  }

  // WHITELIST — any in-scope vocabulary → full engine, always.
  if (IN_SCOPE_RE.test(norm)) return null;

  // Site help — deterministic troubleshooting + phone + stay-in-chat offer.
  if (SITE_HELP_RE.test(norm)) {
    return { category: 'site_help', level: 0, reply: R.site_help[lang], wantClose: false };
  }

  // Wrong business — brand anchor, service pair, or explicit wrong-person.
  const isWrongBusiness = BRAND_RE.test(norm)
    || WRONG_PERSON_RE.test(norm)
    || SERVICE_PAIRS.some(([noun, ctx]) => noun.test(norm) && ctx.test(norm));
  if (isWrongBusiness) {
    const strikes = countStrikes(history, WRONG_BUSINESS_SIGS);
    if (strikes >= 2) return { category: 'wrong_business', level: 3, reply: R.out_of_scope_l3[lang], wantClose: true };
    if (strikes === 1) return { category: 'wrong_business', level: 2, reply: R.out_of_scope_l2[lang], wantClose: false };
    return { category: 'wrong_business', level: 1, reply: R.wrong_business_l1[lang], wantClose: false };
  }

  // Nothing matched — an unclear message is NOT out of scope (spec §6): the
  // full engine (and its clarification behavior) owns it.
  return null;
}

/** Exact-repeat count of this message among prior user turns — shared with
 *  the anomaly signals in api/chat.js (spec §27). */
export function repeatsOf(userMessage, history) {
  return countExactRepeats(normalize(userMessage), history);
}

export const __testables = { normalize, countStrikes, countExactRepeats, IN_SCOPE_RE, R };

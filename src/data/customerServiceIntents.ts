/**
 * Customer Service Bot — Intent Library + Classifier
 *
 * Rule-based, deterministic, zero LLM calls. Same pattern Zara uses, but ZERO
 * shared code: this file is the single source of truth for Support Guide
 * intent classification.
 *
 * 17 intents covering Medicare customer-support triage. Each intent has:
 *   - keywords EN + ES (single-word matches)
 *   - phrases EN + ES (multi-word substring matches with higher weight)
 *   - escalation policy (does this require licensed agent review?)
 *   - default urgency (sets `urgency` field on the conversation state)
 *   - bilingual first-followup question after the intent is detected
 *
 * Classifier algorithm: score each intent by (phrase_matches * 3 + keyword_matches).
 * Return the highest-scoring intent as `primary`, then any other intent that scored
 * >= 50% of the top score becomes a `secondary` intent. Confidence is derived from
 * the score margin between top-1 and top-2: clear win = high, narrow = medium,
 * low scores or ties = low (which the bot treats as `other_unknown` fallback).
 *
 * COMPLIANCE: Intent definitions and follow-up questions are passed through the
 * same forbidden-phrase scan as the rest of the site. Per CMS §422.2267(e)(41)
 * and ClearPoint compliance policy, NO phrase claims eligibility, recommends a
 * plan, confirms coverage, or promises savings.
 */

export type IntentId =
  | 'annual_review'
  | 'medication_help'
  | 'doctor_network_question'
  | 'plan_letter_issue'
  | 'possible_loss_of_coverage'
  | 'extra_help_lis'
  | 'medicaid_msp'
  | 'cost_help'
  | 'benefit_card_issue'
  | 'otc_question'
  | 'appointment_requested'
  | 'call_requested'
  | 'new_to_medicare'
  | 'confused_customer'
  | 'complaint'
  | 'employer_union_benefits'
  | 'general_medicare_question'
  | 'other_unknown';

export type IntentUrgency = 'normal' | 'high' | 'urgent';

export interface IntentDefinition {
  id: IntentId;
  /** Single-word keywords (each scored 1 point per hit). Lowercased, accent-insensitive matching. */
  keywords_en: string[];
  keywords_es: string[];
  /** Multi-word phrases (each scored 3 points per substring hit). Lowercased, accent-insensitive matching. */
  phrases_en: string[];
  phrases_es: string[];
  /** Whether this intent always requires escalation to a licensed agent. */
  escalate_to_agent: boolean;
  /** Whether to display the sensitive-info warning before collecting context for this intent. */
  require_privacy_warning: boolean;
  /** Default urgency level the bot will assign on detection. */
  default_urgency: IntentUrgency;
  /** First follow-up question the bot asks after the intent is detected. */
  next_question_en: string;
  next_question_es: string;
  /** Tag value to send to GHL alongside the standard customer_service_bot tag. */
  ghl_tag: string;
}

const NORMALIZE = (text: string): string => {
  // Accent-insensitive, case-insensitive normalization for matching.
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const INTENTS: IntentDefinition[] = [
  {
    id: 'annual_review',
    keywords_en: ['review', 'annual', 'aep', 'enrollment', 'check', 'compare', 'plan'],
    keywords_es: ['revisar', 'revision', 'anual', 'aep', 'inscripcion', 'comparar', 'plan'],
    phrases_en: ['annual review', 'review my plan', 'check my plan', 'time to review', 'open enrollment', 'change my plan'],
    phrases_es: ['revision anual', 'revisar mi plan', 'revisar plan', 'epoca de inscripcion', 'cambiar mi plan', 'inscripcion abierta'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'Let\'s set up a plan review. To get started, could you share your first name and the state you live in?',
    next_question_es: 'Vamos a organizar una revisión de plan. Para comenzar, ¿podría decirme su nombre y el estado donde vive?',
    ghl_tag: 'annual_review',
  },
  {
    id: 'medication_help',
    keywords_en: ['medication', 'medications', 'pill', 'pills', 'drug', 'drugs', 'prescription', 'prescriptions', 'pharmacy', 'formulary', 'rx', 'copay', 'generic', 'brand'],
    keywords_es: ['medicina', 'medicinas', 'medicamento', 'medicamentos', 'pastilla', 'pastillas', 'receta', 'recetas', 'farmacia', 'formulario', 'copago', 'generico', 'marca'],
    phrases_en: ['my medication', 'my medications', 'expensive medication', 'drug not covered', 'pharmacy charged', 'pill cost', 'cant afford my medication', 'prescription too expensive', 'changed my drug', 'medications went up', 'meds went up'],
    phrases_es: ['mi medicina', 'mis medicinas', 'medicina cara', 'medicinas caras', 'no cubre mi medicamento', 'la farmacia me cobro', 'costo de pastilla', 'no puedo pagar mi medicina', 'receta muy cara', 'cambio mi medicamento', 'medicinas subieron', 'medicina subio', 'medicinas mas caras'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'normal',
    next_question_en: 'Got it — let\'s organize this for a licensed advisor. Which medication is the issue? Please share only the brand or generic name (no dose, no prescription numbers).',
    next_question_es: 'Entendido — organicemos esto para un asesor licenciado. ¿Qué medicamento es el problema? Por favor comparta solo el nombre comercial o genérico (sin dosis, sin números de receta).',
    ghl_tag: 'medication_help',
  },
  {
    id: 'doctor_network_question',
    keywords_en: ['doctor', 'doctors', 'physician', 'network', 'provider', 'specialist', 'hospital', 'clinic'],
    keywords_es: ['doctor', 'doctores', 'medico', 'red', 'proveedor', 'especialista', 'hospital', 'clinica'],
    phrases_en: ['my doctor', 'in network', 'out of network', 'doctor not covered', 'provider list', 'find a doctor', 'is my doctor covered', 'changed my doctor'],
    phrases_es: ['mi doctor', 'en la red', 'fuera de la red', 'doctor no cubierto', 'lista de proveedores', 'buscar un doctor', 'cubre a mi doctor', 'cambio mi doctor'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'I cannot confirm whether a specific doctor is in network — only the plan or your licensed advisor can verify that. To get started, could you share your first name, the state you live in, and the plan name if you know it?',
    next_question_es: 'No puedo confirmar si un doctor específico está en la red — solo el plan o su asesor licenciado puede verificarlo. Para comenzar, ¿podría decirme su nombre, el estado donde vive y el nombre del plan si lo sabe?',
    ghl_tag: 'doctor_network',
  },
  {
    id: 'plan_letter_issue',
    keywords_en: ['letter', 'notice', 'mail', 'received', 'eob', 'denial', 'termination', 'rejected', 'deadline'],
    keywords_es: ['carta', 'aviso', 'correo', 'recibi', 'eob', 'denegacion', 'terminacion', 'rechazado', 'plazo', 'fecha'],
    phrases_en: ['got a letter', 'received a letter', 'letter from', 'plan termination', 'denial letter', 'i dont understand the letter', 'what does this letter mean', 'theres a deadline'],
    phrases_es: ['recibi una carta', 'carta de', 'me llego una carta', 'terminacion del plan', 'carta de denegacion', 'no entiendo la carta', 'que significa esta carta', 'hay un plazo'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'high',
    next_question_en: 'Letters from Medicare or your plan often have a deadline, so let\'s organize this quickly. Could you share your first name, the state you live in, and does the letter mention a date or deadline?',
    next_question_es: 'Las cartas de Medicare o de su plan a menudo tienen un plazo, así que organicemos esto rápido. ¿Podría decirme su nombre, el estado donde vive, y la carta menciona alguna fecha o plazo?',
    ghl_tag: 'plan_letter_issue',
  },
  {
    id: 'possible_loss_of_coverage',
    keywords_en: ['lost', 'cancelled', 'terminated', 'dropped', 'no coverage', 'uninsured'],
    keywords_es: ['perdi', 'cancelaron', 'terminaron', 'sin cobertura', 'sin seguro'],
    phrases_en: ['lost my coverage', 'they cancelled my plan', 'lost my insurance', 'no longer covered', 'plan was terminated', 'i was dropped', 'no coverage now', 'lost my medicaid'],
    phrases_es: ['perdi mi cobertura', 'cancelaron mi plan', 'perdi mi seguro', 'ya no tengo cobertura', 'me terminaron el plan', 'me dieron de baja', 'sin cobertura ahora', 'perdi mi medicaid'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'urgent',
    next_question_en: 'I hear you — this is urgent and a licensed advisor should review it as soon as possible. Could you share your first name, your phone number, and the state you live in?',
    next_question_es: 'Lo entiendo — esto es urgente y un asesor licenciado debe revisarlo lo antes posible. ¿Podría decirme su nombre, su número de teléfono y el estado donde vive?',
    ghl_tag: 'coverage_loss',
  },
  {
    id: 'extra_help_lis',
    keywords_en: ['extra help', 'lis', 'subsidy', 'low income subsidy'],
    keywords_es: ['ayuda extra', 'lis', 'subsidio', 'bajo ingreso'],
    phrases_en: ['extra help', 'low income subsidy', 'help with prescriptions', 'medicare extra help', 'apply for extra help', 'ssa extra help'],
    phrases_es: ['ayuda extra', 'subsidio de bajo ingreso', 'ayuda con medicamentos', 'extra help de medicare', 'solicitar ayuda extra', 'ayuda extra del seguro social'],
    escalate_to_agent: false,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'Extra Help / LIS is a federal program through Social Security that may reduce Medicare Part D costs for people who qualify. Would you like a licensed advisor to help you understand if it could apply to your situation? If so, could you share your first name and the state you live in?',
    next_question_es: 'Ayuda Extra / LIS es un programa federal del Seguro Social que puede reducir los costos de Medicare Parte D para personas que califican. ¿Le gustaría que un asesor licenciado le ayude a entender si podría aplicar a su situación? Si es así, ¿podría decirme su nombre y el estado donde vive?',
    ghl_tag: 'extra_help_lis',
  },
  {
    id: 'medicaid_msp',
    keywords_en: ['medicaid', 'msp', 'qmb', 'slmb', 'dual', 'dual eligible'],
    keywords_es: ['medicaid', 'msp', 'qmb', 'slmb', 'doble', 'doble elegibilidad'],
    phrases_en: ['i have medicaid', 'medicare savings program', 'dual eligible', 'medicaid and medicare', 'msp program', 'qmb program'],
    phrases_es: ['tengo medicaid', 'programa de ahorro de medicare', 'doble elegibilidad', 'medicaid y medicare', 'programa msp', 'programa qmb'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'normal',
    next_question_en: 'Medicaid coordination with Medicare can be sensitive — changing a plan without checking Medicaid status can affect benefits. A licensed advisor needs to review this before any change. Could you share your first name and the state you live in?',
    next_question_es: 'La coordinación de Medicaid con Medicare puede ser delicada — cambiar un plan sin verificar el estado de Medicaid puede afectar los beneficios. Un asesor licenciado debe revisar esto antes de cualquier cambio. ¿Podría decirme su nombre y el estado donde vive?',
    ghl_tag: 'medicaid_msp',
  },
  {
    id: 'cost_help',
    keywords_en: ['save', 'savings', 'expensive', 'afford', 'premium', 'cost'],
    keywords_es: ['ahorrar', 'ahorros', 'caro', 'costoso', 'pagar', 'prima', 'costo'],
    phrases_en: ['save money', 'cant afford medicare', 'premium too high', 'too expensive', 'reduce my costs', 'help with costs'],
    phrases_es: ['ahorrar dinero', 'no puedo pagar medicare', 'prima muy alta', 'muy caro', 'reducir mis costos', 'ayuda con costos'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'There are several federal and state programs that may help with Medicare costs — Medicare Savings Programs, Medicaid, Extra Help / LIS, and others. A licensed advisor can help you understand which ones may apply. Could you share your first name and the state you live in?',
    next_question_es: 'Hay varios programas federales y estatales que pueden ayudar con los costos de Medicare — Programas de Ahorro de Medicare, Medicaid, Ayuda Extra / LIS, y otros. Un asesor licenciado puede ayudarle a entender cuáles pueden aplicar. ¿Podría decirme su nombre y el estado donde vive?',
    ghl_tag: 'cost_help',
  },
  {
    id: 'benefit_card_issue',
    keywords_en: ['card', 'flex', 'allowance', 'declined', 'lost card'],
    keywords_es: ['tarjeta', 'flex', 'asignacion', 'rechazada', 'perdi tarjeta'],
    phrases_en: ['benefit card', 'card not working', 'card declined', 'lost my card', 'card stopped working', 'flex card'],
    phrases_es: ['tarjeta de beneficios', 'tarjeta no funciona', 'tarjeta rechazada', 'perdi mi tarjeta', 'tarjeta dejo de funcionar', 'tarjeta flex'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'normal',
    next_question_en: 'Benefit card issues are usually handled by the plan that issued the card. To get organized, could you share your first name, the state you live in, and the carrier or plan name if you know it (no card numbers please)?',
    next_question_es: 'Los problemas con tarjetas de beneficios usualmente los maneja el plan que emitió la tarjeta. Para organizar esto, ¿podría decirme su nombre, el estado donde vive, y el nombre de la aseguradora o plan si lo sabe (por favor sin números de tarjeta)?',
    ghl_tag: 'benefit_card_issue',
  },
  {
    id: 'otc_question',
    keywords_en: ['otc', 'over the counter'],
    keywords_es: ['otc', 'sin receta', 'mostrador'],
    phrases_en: ['otc benefit', 'otc card', 'what does otc cover', 'otc allowance', 'over the counter benefit'],
    phrases_es: ['beneficio otc', 'tarjeta otc', 'que cubre otc', 'asignacion otc', 'beneficio sin receta'],
    escalate_to_agent: false,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'OTC benefits vary by plan. The Summary of Benefits and Evidence of Coverage from your specific plan are the source of truth. Would you like a licensed advisor to walk through the OTC rules for your plan? Could you share your first name and the state you live in?',
    next_question_es: 'Los beneficios OTC varían por plan. El Resumen de Beneficios y la Evidencia de Cobertura de su plan específico son la fuente oficial. ¿Le gustaría que un asesor licenciado le explique las reglas OTC de su plan? ¿Podría decirme su nombre y el estado donde vive?',
    ghl_tag: 'otc_question',
  },
  {
    id: 'appointment_requested',
    keywords_en: ['appointment', 'schedule', 'meeting', 'book'],
    keywords_es: ['cita', 'agendar', 'reunion', 'reservar', 'programar', 'sesion'],
    phrases_en: ['schedule appointment', 'book an appointment', 'set up a meeting', 'schedule a review', 'i need an appointment'],
    phrases_es: ['agendar cita', 'reservar una cita', 'programar una reunion', 'agendar una revision', 'necesito una cita', 'reservar una sesion', 'agendar una sesion', 'programar una sesion'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'A licensed advisor will reach out to schedule. Could you share your first name, your phone number, the state you live in, and what time of day works best for a callback?',
    next_question_es: 'Un asesor licenciado se comunicará para agendar. ¿Podría decirme su nombre, su número de teléfono, el estado donde vive y a qué hora del día le viene mejor recibir una llamada?',
    ghl_tag: 'appointment_requested',
  },
  {
    id: 'call_requested',
    keywords_en: ['call', 'phone', 'callback', 'speak', 'ring'],
    keywords_es: ['llamar', 'llameme', 'telefono', 'llamada', 'hablar', 'comuniquen'],
    phrases_en: ['call me', 'phone call', 'speak with someone', 'i need a call', 'someone to call me', 'talk to a person', 'have someone call', 'please call'],
    phrases_es: ['llamame', 'llameme', 'llamada telefonica', 'hablar con alguien', 'necesito una llamada', 'alguien me llame', 'hablar con una persona', 'que me llame', 'que me llamen', 'por favor llameme', 'por favor llamenme'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'A licensed advisor can give you a call. Could you share your first name, your phone number, the state you live in, and what time of day works best?',
    next_question_es: 'Un asesor licenciado puede llamarle. ¿Podría decirme su nombre, su número de teléfono, el estado donde vive y a qué hora del día le viene mejor?',
    ghl_tag: 'call_requested',
  },
  {
    id: 'new_to_medicare',
    keywords_en: ['new', 'turning', '65', 'starting', 'first time', 'beginner'],
    keywords_es: ['nuevo', 'cumplo', '65', 'empezando', 'primera vez', 'principiante'],
    phrases_en: ['new to medicare', 'turning 65', 'first time with medicare', 'just starting medicare', 'iep', 'initial enrollment'],
    phrases_es: ['nuevo en medicare', 'cumplo 65', 'primera vez con medicare', 'empezando con medicare', 'iep', 'inscripcion inicial'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'Welcome — new-to-Medicare is one of the most important decisions, and a licensed advisor should walk you through it. Could you share your first name, the state you live in, and roughly when you plan to start Medicare (month/year)?',
    next_question_es: 'Bienvenido — empezar con Medicare es una de las decisiones más importantes, y un asesor licenciado debe explicarle el proceso. ¿Podría decirme su nombre, el estado donde vive y aproximadamente cuándo planea empezar con Medicare (mes/año)?',
    ghl_tag: 'new_to_medicare',
  },
  {
    id: 'confused_customer',
    keywords_en: ['confused', 'confusing', 'lost', 'unclear', 'overwhelmed'],
    keywords_es: ['confundido', 'confundida', 'perdido', 'perdida', 'confuso', 'agobiado'],
    phrases_en: ['i dont understand', 'i don\'t understand', 'im confused', 'i am confused', 'i am so confused', 'im lost', 'i am lost', 'this is confusing', 'i dont know what to do', 'i don\'t know what to do', 'too much to handle', 'overwhelmed with medicare'],
    phrases_es: ['no entiendo', 'no comprendo', 'estoy confundido', 'estoy confundida', 'estoy perdida', 'estoy perdido', 'esto es confuso', 'no se que hacer', 'no se por donde empezar', 'es demasiado', 'estoy agobiado'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'high',
    next_question_en: 'I hear you — this can be a lot. Let me help organize it so a licensed advisor can walk you through it. In your own words, what part of Medicare are you trying to sort out?',
    next_question_es: 'Lo entiendo — esto puede ser mucho. Déjeme ayudarle a organizarlo para que un asesor licenciado pueda explicárselo. En sus propias palabras, ¿qué parte de Medicare está tratando de resolver?',
    ghl_tag: 'confused_customer',
  },
  {
    id: 'complaint',
    keywords_en: ['frustrated', 'angry', 'unhappy', 'complaint', 'terrible', 'awful'],
    keywords_es: ['frustrado', 'molesto', 'queja', 'enojado', 'terrible', 'horrible'],
    phrases_en: ['im frustrated', 'this is terrible', 'i want to complain', 'so unhappy', 'this is awful', 'tired of'],
    phrases_es: ['estoy frustrado', 'esto es terrible', 'quiero quejarme', 'muy molesto', 'esto es horrible', 'cansado de'],
    escalate_to_agent: true,
    require_privacy_warning: true,
    default_urgency: 'high',
    next_question_en: 'I\'m sorry you\'re going through this — let\'s organize the issue so a licensed advisor can review it carefully. Could you share your first name and briefly what happened?',
    next_question_es: 'Lamento que esté pasando por esto — organicemos el asunto para que un asesor licenciado pueda revisarlo con cuidado. ¿Podría decirme su nombre y brevemente qué pasó?',
    ghl_tag: 'complaint',
  },
  {
    id: 'employer_union_benefits',
    keywords_en: ['union', 'retiree', 'employer', 'federal', 'state benefits', 'va', 'tricare', 'cobra', '1199', 'uft', 'nyc'],
    keywords_es: ['union', 'unión', 'retiro', 'retirado', 'empleador', 'federal', 'jubilado'],
    phrases_en: ['union benefits', 'retiree benefits', 'employer coverage', 'employer benefits', 'federal benefits', 'state benefits', 'i have union', 'i have retiree', 'va benefits', 'tricare benefits', 'cobra coverage', 'nyc retiree', 'union plan', 'retiree plan'],
    phrases_es: ['beneficios de union', 'beneficios de unión', 'beneficios de retiro', 'plan de retiro', 'plan de jubilacion', 'beneficios del empleador', 'tengo union', 'tengo unión', 'tengo retiro', 'beneficios federales', 'beneficios del estado', 'va beneficios', 'tricare beneficios', 'beneficios de retirado'],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'high',
    next_question_en: "Before any Medicare change, employer, union, retiree, federal, state, VA, or TRICARE benefits should be checked carefully — some can be lost permanently. A licensed advisor must review the impact with you. Could you share your first name, the state you live in, and which type of benefit you have?",
    next_question_es: 'Antes de cualquier cambio en Medicare, los beneficios de empleador, unión, retiro, federales, estatales, VA o TRICARE deben revisarse con cuidado — algunos se pueden perder permanentemente. Un asesor licenciado debe revisar el impacto con usted. ¿Podría decirme su nombre, el estado donde vive y qué tipo de beneficio tiene?',
    ghl_tag: 'employer_union_benefits',
  },
  {
    id: 'general_medicare_question',
    keywords_en: ['what is', 'how does', 'explain', 'tell me about'],
    keywords_es: ['que es', 'como funciona', 'explica', 'cuentame de'],
    phrases_en: ['what is medicare', 'what is part a', 'what is part b', 'what is part c', 'what is part d', 'how does medicare work', 'explain medicare', 'medicare basics'],
    phrases_es: ['que es medicare', 'que es parte a', 'que es parte b', 'que es parte c', 'que es parte d', 'como funciona medicare', 'explica medicare', 'medicare basico'],
    escalate_to_agent: false,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'Happy to share general Medicare information. Specific eligibility and plan details should be verified with a licensed advisor or with Medicare directly. What part of Medicare would you like to understand?',
    next_question_es: 'Con gusto comparto información general sobre Medicare. La elegibilidad específica y los detalles del plan deben verificarse con un asesor licenciado o directamente con Medicare. ¿Qué parte de Medicare le gustaría entender?',
    ghl_tag: 'general_medicare_question',
  },
  {
    id: 'other_unknown',
    keywords_en: [],
    keywords_es: [],
    phrases_en: [],
    phrases_es: [],
    escalate_to_agent: true,
    require_privacy_warning: false,
    default_urgency: 'normal',
    next_question_en: 'I want to make sure I understand. In your own words, what would you like help with today? Some examples: a letter you received, a medication question, a doctor question, scheduling a call, or general Medicare information.',
    next_question_es: 'Quiero asegurarme de entender. En sus propias palabras, ¿con qué le gustaría ayuda hoy? Algunos ejemplos: una carta que recibió, una pregunta sobre medicamentos, una pregunta sobre doctores, agendar una llamada, o información general sobre Medicare.',
    ghl_tag: 'other_unknown',
  },
];

/**
 * Score a user message against all 17 intents. Returns the top match plus any
 * secondary intents that scored >= 50% of the top score. Confidence is derived
 * from the score margin between top-1 and top-2.
 *
 * Pure function. No side effects. Deterministic. Unit-testable without React.
 */
export interface ClassificationResult {
  primary: IntentId;
  secondary: IntentId[];
  confidence: 'high' | 'medium' | 'low';
  scores: Record<IntentId, number>;
}

export function classifyIntent(
  userText: string,
  lang: 'en' | 'es' = 'en',
): ClassificationResult {
  const normalized = NORMALIZE(userText);
  if (!normalized) {
    return {
      primary: 'other_unknown',
      secondary: [],
      confidence: 'low',
      scores: {} as Record<IntentId, number>,
    };
  }

  const scores: Partial<Record<IntentId, number>> = {};

  for (const intent of INTENTS) {
    if (intent.id === 'other_unknown') {
      scores[intent.id] = 0;
      continue;
    }
    let score = 0;
    const phrases = lang === 'es' ? intent.phrases_es : intent.phrases_en;
    const keywords = lang === 'es' ? intent.keywords_es : intent.keywords_en;
    // Also check the OTHER language at half weight — handles mixed-language messages.
    const otherPhrases = lang === 'es' ? intent.phrases_en : intent.phrases_es;
    const otherKeywords = lang === 'es' ? intent.keywords_en : intent.keywords_es;

    for (const phrase of phrases) {
      const np = NORMALIZE(phrase);
      if (np && normalized.includes(np)) score += 3;
    }
    for (const phrase of otherPhrases) {
      const np = NORMALIZE(phrase);
      if (np && normalized.includes(np)) score += 1.5;
    }
    for (const kw of keywords) {
      const nk = NORMALIZE(kw);
      if (nk && new RegExp(`\\b${nk}\\b`).test(normalized)) score += 1;
    }
    for (const kw of otherKeywords) {
      const nk = NORMALIZE(kw);
      if (nk && new RegExp(`\\b${nk}\\b`).test(normalized)) score += 0.5;
    }
    scores[intent.id] = score;
  }

  // Sort intents by score descending.
  const sorted = (Object.entries(scores) as [IntentId, number][])
    .filter(([id]) => id !== 'other_unknown')
    .sort((a, b) => b[1] - a[1]);

  const topScore = sorted[0]?.[1] ?? 0;
  const top2Score = sorted[1]?.[1] ?? 0;

  // No meaningful match → other_unknown
  if (topScore < 1) {
    return {
      primary: 'other_unknown',
      secondary: [],
      confidence: 'low',
      scores: scores as Record<IntentId, number>,
    };
  }

  const primary = sorted[0][0];
  // Secondary intents: any intent that scored >= 50% of top score (and >= 1)
  const secondary = sorted
    .slice(1)
    .filter(([, s]) => s >= Math.max(1, topScore * 0.5))
    .map(([id]) => id);

  // Confidence:
  //   topScore >= 3 AND topScore is at least 2x top2Score → high
  //   topScore >= 2 AND topScore is > top2Score → medium
  //   otherwise → low
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (topScore >= 3 && topScore >= top2Score * 2) confidence = 'high';
  else if (topScore >= 2 && topScore > top2Score) confidence = 'medium';

  return {
    primary,
    secondary,
    confidence,
    scores: scores as Record<IntentId, number>,
  };
}

/** Look up an intent definition by id. */
export function getIntent(id: IntentId): IntentDefinition {
  const found = INTENTS.find((i) => i.id === id);
  if (!found) {
    return INTENTS.find((i) => i.id === 'other_unknown')!;
  }
  return found;
}

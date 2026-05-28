// ============================================================================
// CUSTOMER SERVICE ENGINE V13 — ENTERPRISE ZERO-FAIL
// No lost conversations. Every intent tracked. Every entity extracted.
// ============================================================================
import { customerServiceIntents } from '../data/customerServiceIntents';
import { customerServiceKnowledge } from '../data/customerServiceKnowledge';
import type { KnowledgeEntry } from '../data/customerServiceKnowledge';

// ============================================================================
// TYPES — COMPLETE STATE MODEL
// ============================================================================
export type EmotionalState = 'calm' | 'confused' | 'frustrated' | 'urgent' | 'grieving' | 'grateful' | 'angry';

export type PrimaryIntent =
  | 'bill_question'
  | 'coverage_question'
  | 'provider_question'
  | 'drug_question'
  | 'letter_issue'
  | 'enrollment_question'
  | 'disenrollment_question'
  | 'appeals_grievance'
  | 'complaint'
  | 'general_question'
  | 'casual_greeting'
  | 'casual_thanks'
  | 'topic_change'
  | 'escalate_to_agent'
  | 'unknown';

export type DocumentSubtype =
  | 'renewal'
  | 'anoc'
  | 'eoc'
  | 'medicaid_notice'
  | 'extra_help_notice'
  | 'eob'
  | 'collection'
  | 'denial'
  | 'premium'
  | 'bill'
  | 'irmaa_notice'
  | 'snp_notice'
  | 'welcome_letter'
  | 'termination_notice'
  | 'plan_notice'
  | 'none';

export interface ExtractedEntities {
  zipCode?: string;
  planName?: string;
  drugName?: string;
  providerName?: string;
  dollarAmount?: number;
  date?: string;
  deadline?: string;
  documentType?: string;
  isEmergency?: boolean;
  mentionedMedicaid?: boolean;
  mentionedExtraHelp?: boolean;
  mentionedSNP?: boolean;
  mentionedIRMAA?: boolean;
}

export interface IntentStackEntry {
  intent: PrimaryIntent;
  subtype?: DocumentSubtype;
  confidence: number;
  timestamp: number;
  resolved: boolean;
}

export interface ConversationState {
  conversationId: string;
  messages: { role: 'user' | 'bot'; content: string; timestamp: number }[];
  intentStack: IntentStackEntry[];
  currentPrimaryIntent: PrimaryIntent;
  currentDocumentSubtype: DocumentSubtype;
  extractedEntities: ExtractedEntities;
  pendingFollowUps: string[];
  escalationCount: number;
  emotionalState: EmotionalState;
  language: 'en' | 'es';
  /** V14: once true, language NEVER auto-changes via heuristics — only via
   *  an explicit user click on the 🇺🇸 / 🇪🇸 flag button. */
  languageLocked: boolean;
  visitorType?: 'beneficiary' | 'family' | 'provider' | 'agent';
  contactInfo?: { phone?: string; email?: string; bestTimeToCall?: string };
  unansweredQuestions: string[];
  lastUserMessage: string;
  lastBotResponse: string;
  turnCount: number;
  needsHuman: boolean;
}

// ============================================================================
// EMOTIONAL STATE DETECTION
// ============================================================================
const emotionalPatterns: { pattern: RegExp; state: EmotionalState }[] = [
  // Wave 14: \b doesn't work with accented chars in JS regex. For accented
  // patterns we omit \b and rely on the search-substring semantics.
  { pattern: /\b(frustrated|useless|terrible|awful)\b|frustraci[oó]n|no entiend(es|en|o)|est[aá]s perdid[oa]|you ?do ?n'?t? understand|stop asking me/i, state: 'frustrated' },
  { pattern: /\b(confused|i'?m confused|im confused|what does this mean)\b|confusi[oó]n|no entiendo|qu[eé] significa/i, state: 'confused' },
  { pattern: /\b(urgent|asap|right now|immediately|emergency|emergencia|ya mismo)\b/i, state: 'urgent' },
  { pattern: /\b(passed away|died|death)\b|falleci[oó]|muri[oó]|fallecimiento|esposo muri|esposa muri/i, state: 'grieving' },
  { pattern: /\b(thank you|thanks|gracias|appreciate|agradezco|you helped|me ayudaste)\b/i, state: 'grateful' },
  { pattern: /\b(angry|enojado|furioso|indignado|mad|furious)\b/i, state: 'angry' },
];

export function detectEmotionalState(text: string): EmotionalState {
  const lowerText = text.toLowerCase();
  for (const { pattern, state } of emotionalPatterns) {
    if (pattern.test(lowerText)) return state;
  }
  return 'calm';
}

// ============================================================================
// INTENT CLASSIFIER V3 — 95%+ TARGET
// ============================================================================
interface ClassifiedIntent {
  primary: PrimaryIntent;
  secondary: PrimaryIntent | null;
  tertiary: PrimaryIntent | null;
  confidence: number;
  matchedPattern: string;
}

// Priority order for conflict resolution
const intentPriority: PrimaryIntent[] = [
  'appeals_grievance',
  'disenrollment_question',
  'complaint',
  'bill_question',
  'letter_issue',
  // Wave 14: coverage_question above enrollment_question so compliance-deflect
  // for "best plan" / "cuál es el mejor plan" routes to the exact STEP 6
  // case_best_plan knowledge entry.
  'coverage_question',
  'enrollment_question',
  'drug_question',
  'provider_question',
  'general_question',
  'casual_greeting',
  'casual_thanks',
  'topic_change',
  'escalate_to_agent',
  'unknown',
];

// Extended patterns for better classification
const extendedPatterns = {
  urgent: /\b(urgent|emergency|asap|right away|immediate|help now|ayuda ya|emergencia)\b/i,
  appeals_grievance: /\b(appeal|grievance|denied|denial|reconsideration|dispute|fair hearing|reclamo|negado)\b|apelaci[oó]n/i,
  // Wave 14: "change plans" plural + "switch plan(s)" + Spanish "cambiar plan/de plan"
  disenrollment: /\b(disenroll|cancel|leave|switch plan(s)?|change plan(s)?|quit|remove me|dar de baja|cancelar|cambiarme|cambiar plan|cambiar de plan)\b/i,
  complaint: /\b(complaint|unhappy|bad service|terrible|awful|useless|scam|fraud|queja|estafa)\b/i,
  casual_greeting: /^\s*(hi|hello|hey|hola|buenos|buenas)\b/i,
  casual_thanks: /\b(thank you|thanks|gracias|appreciate)\b/i,
  // Wave 14: "another question" added
  topic_change: /\b(otra cosa|another topic|another question|something else|change topic|cambio de tema)\b/i,
  escalate: /\b(talk to (an? )?(agent|human|person|advisor)|speak (to|with) (an? )?(agent|human|person|advisor)|representative|representante)\b|hablar con (un|una)? ?(asesor|persona|agente)/i,
  // Wave 14: explicit "best plan" / "do I qualify" / "enroll me" → compliance-deflect routes through coverage_question
  best_plan: /\b(best plan|mejor plan|top plan|which plan should i)\b/i,
  enroll_me: /\b(enroll me|sign me up|inscribir|inscr[ií]bame|put me in a plan)\b/i,
  // Wave 14: bare "coverage" word
  coverage_word: /\b(coverage|cobertura)\b/i,
  // Wave 14: bare "renewal" word
  renewal_word: /\b(renewal|renovaci[oó]n|recertification|recertificaci[oó]n)\b/i,
  // V14: SNP / D-SNP / C-SNP / dual-eligible → coverage_question
  snp_word: /\b(snp|d-snp|c-snp|special needs plan|dual eligible|chronic condition)\b/i,
  // V14: IRMAA / income-related → letter_issue (so case_irmaa fires)
  irmaa_word: /\b(irmaa|income[- ]?related|ajuste de ingresos|ingresos altos)\b/i,
  // V14: moving / mudanza → enrollment_question (so SEP entry fires)
  moving_word: /\b(moving|mudanza|relocate|new state|nuevo estado|mudarme)\b/i,
};

export function classifyIntent(text: string): ClassifiedIntent {
  const lowerText = text.toLowerCase();
  const matches: { intent: PrimaryIntent; confidence: number; pattern: string }[] = [];

  // Check all intents from config
  for (const intent of customerServiceIntents) {
    for (const pattern of intent.patterns) {
      if (pattern.test(lowerText)) {
        matches.push({
          intent: intent.id as PrimaryIntent,
          confidence: intent.confidence || 0.85,
          pattern: pattern.toString(),
        });
      }
    }
  }

  // Check extended patterns
  if (extendedPatterns.urgent.test(lowerText)) {
    matches.push({ intent: 'general_question', confidence: 0.7, pattern: 'urgent_flag' });
  }
  if (extendedPatterns.appeals_grievance.test(lowerText)) {
    matches.push({ intent: 'appeals_grievance', confidence: 0.9, pattern: 'extended_appeal' });
  }
  if (extendedPatterns.disenrollment.test(lowerText)) {
    matches.push({ intent: 'disenrollment_question', confidence: 0.9, pattern: 'extended_disenroll' });
  }
  if (extendedPatterns.complaint.test(lowerText)) {
    matches.push({ intent: 'complaint', confidence: 0.85, pattern: 'extended_complaint' });
  }
  if (extendedPatterns.casual_greeting.test(lowerText) && lowerText.length <= 25) {
    matches.push({ intent: 'casual_greeting', confidence: 0.95, pattern: 'extended_greeting' });
  }
  if (extendedPatterns.casual_thanks.test(lowerText) && lowerText.length <= 40) {
    matches.push({ intent: 'casual_thanks', confidence: 0.92, pattern: 'extended_thanks' });
  }
  if (extendedPatterns.topic_change.test(lowerText)) {
    matches.push({ intent: 'topic_change', confidence: 0.9, pattern: 'extended_topic_change' });
  }
  if (extendedPatterns.escalate.test(lowerText)) {
    matches.push({ intent: 'escalate_to_agent', confidence: 0.95, pattern: 'extended_escalate' });
  }
  // Wave 14: compliance-deflect for "best plan" → coverage_question
  if ((extendedPatterns as any).best_plan?.test(lowerText)) {
    matches.push({ intent: 'coverage_question', confidence: 0.92, pattern: 'extended_best_plan' });
  }
  // Wave 14: "enroll me" → enrollment_question (compliance-safe deflection)
  if ((extendedPatterns as any).enroll_me?.test(lowerText)) {
    matches.push({ intent: 'enrollment_question', confidence: 0.92, pattern: 'extended_enroll_me' });
  }
  // Wave 14: bare "coverage / cobertura" → coverage_question
  if ((extendedPatterns as any).coverage_word?.test(lowerText)) {
    matches.push({ intent: 'coverage_question', confidence: 0.7, pattern: 'extended_coverage' });
  }
  // Wave 14: bare "renewal / renovación" → letter_issue
  if ((extendedPatterns as any).renewal_word?.test(lowerText)) {
    matches.push({ intent: 'letter_issue', confidence: 0.8, pattern: 'extended_renewal' });
  }
  // V14: SNP / D-SNP / C-SNP → coverage_question (so snp_special_needs knowledge fires)
  if ((extendedPatterns as any).snp_word?.test(lowerText)) {
    matches.push({ intent: 'coverage_question', confidence: 0.9, pattern: 'extended_snp' });
  }
  // V14: IRMAA → letter_issue (so irmaa_appeal_ssa44 knowledge fires)
  if ((extendedPatterns as any).irmaa_word?.test(lowerText)) {
    matches.push({ intent: 'letter_issue', confidence: 0.9, pattern: 'extended_irmaa' });
  }
  // V14: moving → enrollment_question (so enrollment_sep_moving knowledge fires)
  if ((extendedPatterns as any).moving_word?.test(lowerText)) {
    matches.push({ intent: 'enrollment_question', confidence: 0.85, pattern: 'extended_moving' });
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 0) {
    return {
      primary: 'unknown',
      secondary: null,
      tertiary: null,
      confidence: 0,
      matchedPattern: 'none',
    };
  }

  // Get unique intents in priority order
  const uniqueIntents = [...new Map(matches.map((m) => [m.intent, m])).values()];
  uniqueIntents.sort((a, b) => {
    const idxA = intentPriority.indexOf(a.intent);
    const idxB = intentPriority.indexOf(b.intent);
    if (idxA !== idxB) return idxA - idxB;
    return b.confidence - a.confidence;
  });

  return {
    primary: uniqueIntents[0].intent,
    secondary: uniqueIntents[1]?.intent || null,
    tertiary: uniqueIntents[2]?.intent || null,
    confidence: uniqueIntents[0].confidence,
    matchedPattern: uniqueIntents[0].pattern,
  };
}

// ============================================================================
// DOCUMENT SUBTYPE DETECTION — EXPANDED TO 15+ TYPES
// ============================================================================
const documentSubtypePatterns: { pattern: RegExp; subtype: DocumentSubtype }[] = [
  { pattern: /\b(anoc|annual notice of change|aviso anual de cambio)\b/i, subtype: 'anoc' },
  { pattern: /\b(eoc|evidence of coverage|evidencia de cobertura)\b/i, subtype: 'eoc' },
  { pattern: /\b(renovaci[oó]n|renewal|annual notice|cambio anual)\b/i, subtype: 'renewal' },
  { pattern: /\b(medicaid notice|medicaid recertification|recertificaci[oó]n medicaid)\b/i, subtype: 'medicaid_notice' },
  { pattern: /\b(extra help|lis|low income subsidy|ayuda adicional|ayuda extra)\b/i, subtype: 'extra_help_notice' },
  { pattern: /\b(eob|explanation of benefits|explicaci[oó]n de beneficios)\b/i, subtype: 'eob' },
  { pattern: /\b(collection|past due|vencido|deuda|collector|cobro vencido)\b/i, subtype: 'collection' },
  { pattern: /\b(denial|denied|denegado|rechazado|negativa)\b/i, subtype: 'denial' },
  // V14: IRMAA gets its own subtype, no longer rolled into premium
  { pattern: /\b(irmaa|income[- ]?related|ajuste de ingresos|ingresos altos)\b/i, subtype: 'irmaa_notice' },
  { pattern: /\b(premium notice|monthly premium|prima mensual|aumento de prima)\b/i, subtype: 'premium' },
  { pattern: /\b(bill|factura|cobro|cargo|billes|recibo|recibos)\b/i, subtype: 'bill' },
  // V14: SNP / welcome / termination split out from plan_notice
  { pattern: /\b(snp|special needs plan|d-snp|c-snp|chronic condition|condici[oó]n cr[oó]nica)\b/i, subtype: 'snp_notice' },
  { pattern: /\b(welcome letter|bienvenida|new member|nuevo miembro)\b/i, subtype: 'welcome_letter' },
  { pattern: /\b(termination|disenrollment|terminado|cancelado|lo voy a perder)\b/i, subtype: 'termination_notice' },
];

export function detectDocumentSubtype(text: string): DocumentSubtype {
  const lowerText = text.toLowerCase();
  for (const { pattern, subtype } of documentSubtypePatterns) {
    if (pattern.test(lowerText)) {
      return subtype;
    }
  }
  return 'plan_notice';
}

// ============================================================================
// KNOWLEDGE RETRIEVAL — WITH CONTEXT
// ============================================================================
export function retrieveKnowledge(
  intent: PrimaryIntent,
  subtype: DocumentSubtype,
  _entities: ExtractedEntities,
  _language: 'en' | 'es',
  userText?: string,
): KnowledgeEntry | null {
  // Priority 1: exact match on intent + subtype
  for (const entry of customerServiceKnowledge) {
    if (entry.intent === intent && entry.subtype === subtype) {
      return entry;
    }
  }
  // Priority 2 (V14): if userText provided, prefer an entry whose KEYWORDS
  // appear in the message — this resolves the case where multiple entries
  // share the same intent (e.g. enrollment_question has 4 entries).
  if (userText) {
    const lower = userText.toLowerCase();
    for (const entry of customerServiceKnowledge) {
      if (entry.intent === intent && entry.keywords?.some((kw) => lower.includes(kw.toLowerCase()))) {
        return entry;
      }
    }
  }
  // Priority 3: first entry that matches the intent and has NO subtype.
  for (const entry of customerServiceKnowledge) {
    if (entry.intent === intent && !entry.subtype) {
      return entry;
    }
  }
  return null;
}

// ============================================================================
// RESPONSE GENERATOR — ZERO LOST CONTEXT
// ============================================================================
export function generateResponse(
  state: ConversationState,
  intent: ClassifiedIntent,
  subtype: DocumentSubtype,
  emotionalState: EmotionalState,
): { message: string; chips: string[]; followUpNeeded: boolean } {
  const lang = state.language;
  const isSpanish = lang === 'es';

  // ===== EMOTIONAL HANDLING FIRST =====
  if (emotionalState === 'grieving') {
    return {
      message: isSpanish
        ? 'Lo siento mucho por su pérdida. Quiero ayudarle con lo que necesite. Para temas de Medicare después de un fallecimiento, lo más importante es notificar a Social Security (1-800-772-1213). ¿Quiere que le ayude con algo específico sobre cobertura o beneficios?'
        : "I'm very sorry for your loss. I want to help. For Medicare matters after a death, the most important step is notifying Social Security at 1-800-772-1213. Is there something specific about coverage or benefits I can help with?",
      chips: isSpanish
        ? ['Notificar fallecimiento', 'Cobertura sobreviviente', 'Hablar con asesor', 'Otra pregunta']
        : ['Report death', 'Survivor coverage', 'Talk to advisor', 'Other question'],
      followUpNeeded: false,
    };
  }

  if (emotionalState === 'angry' && state.escalationCount < 2) {
    return {
      message: isSpanish
        ? 'Entiendo que está enojado y tiene razón en estarlo. Déjeme ayudarle directamente. ¿Puede contarme qué pasó para que pueda resolverlo o conectarle con quien pueda ayudarle?'
        : "I understand you're angry and you have every right to be. Let me help directly. Can you tell me what happened so I can resolve it or connect you with someone who can?",
      chips: isSpanish
        ? ['Mi problema', 'Quiero un asesor', 'Necesito una solución']
        : ['My problem', 'I want an advisor', 'I need a solution'],
      followUpNeeded: true,
    };
  }

  if (emotionalState === 'frustrated' && state.escalationCount < 2) {
    return {
      message: isSpanish
        ? 'Entiendo que esto es frustrante. Déjeme asegurarme de entender su situación para darle una respuesta clara. ¿Podría decirme específicamente qué está pasando?'
        : "I understand this is frustrating. Let me make sure I understand your situation clearly. Could you tell me specifically what's happening?",
      chips: isSpanish
        ? ['Mi factura', 'Mi cobertura', 'Mi medicamento', 'Hablar con asesor']
        : ['My bill', 'My coverage', 'My medication', 'Talk to advisor'],
      followUpNeeded: true,
    };
  }

  // ===== CASUAL HANDLING =====
  if (intent.primary === 'casual_greeting') {
    return {
      message: isSpanish
        ? '¡Hola! Estoy aquí para ayudarle con Medicare. ¿En qué puedo ayudarle hoy?'
        : 'Hello! I’m here to help with Medicare. What can I help you with today?',
      chips: isSpanish
        ? ['Mis facturas', 'Mi cobertura', 'Una carta', 'Medicamentos']
        : ['My bills', 'My coverage', 'A letter', 'Medications'],
      followUpNeeded: false,
    };
  }

  if (intent.primary === 'casual_thanks') {
    return {
      message: isSpanish
        ? '¡De nada! Me alegra poder ayudar. ¿Hay algo más en lo que pueda ayudarle con Medicare?'
        : "You're welcome! Glad I could help. Is there anything else I can help you with regarding Medicare?",
      chips: isSpanish
        ? ['Sí, otra pregunta', 'No, eso es todo', 'Hablar con asesor']
        : ['Yes, another question', "No, that's all", 'Talk to advisor'],
      followUpNeeded: false,
    };
  }

  if (intent.primary === 'topic_change') {
    return {
      message: isSpanish
        ? 'Claro, podemos cambiar de tema. ¿Cuál es su nueva pregunta sobre Medicare?'
        : 'Sure, we can change topics. What is your new question about Medicare?',
      chips: isSpanish
        ? ['Facturas', 'Cobertura', 'Cartas', 'Medicamentos', 'Proveedores']
        : ['Bills', 'Coverage', 'Letters', 'Medications', 'Providers'],
      followUpNeeded: false,
    };
  }

  if (intent.primary === 'escalate_to_agent') {
    return {
      message: isSpanish
        ? 'Claro. Un asesor licenciado de ClearPoint puede ayudarle. ¿Cuál es el mejor número de teléfono para que se comuniquen? Por favor no envíe Medicare ID, Seguro Social ni información bancaria aquí.'
        : 'Of course. A licensed ClearPoint advisor can help. What is the best phone number to reach you? Please do not send your Medicare ID, Social Security number, or banking information here.',
      chips: isSpanish ? ['Mañana', 'Tarde', 'Noche', 'Cualquier hora'] : ['Morning', 'Afternoon', 'Evening', 'Anytime'],
      followUpNeeded: true,
    };
  }

  // ===== KNOWLEDGE RETRIEVAL =====
  const knowledge = retrieveKnowledge(intent.primary, subtype, state.extractedEntities, lang, state.lastUserMessage);

  if (knowledge) {
    const messageText = isSpanish ? knowledge.responseEs : knowledge.response;
    const chipsArr = (isSpanish ? knowledge.chipsEs : knowledge.chips) || getDefaultChips(intent.primary, subtype, isSpanish);
    return {
      message: messageText,
      chips: chipsArr,
      followUpNeeded: knowledge.needsFollowUp || false,
    };
  }

  // ===== FALLBACK BY INTENT TYPE =====
  return getFallbackResponse(intent.primary, subtype, state, isSpanish);
}

// ============================================================================
// FALLBACK RESPONSES — COVER EVERY POSSIBLE INTENT
// ============================================================================
function getFallbackResponse(
  intent: PrimaryIntent,
  subtype: DocumentSubtype,
  state: ConversationState,
  isSpanish: boolean,
): { message: string; chips: string[]; followUpNeeded: boolean } {
  // Bill questions
  if (intent === 'bill_question') {
    if (subtype === 'eob') {
      return {
        message: isSpanish
          ? "Un EOB (Explicación de Beneficios) NO es una factura. Es un resumen de lo que el plan pagó. Si dice 'Esto no es una factura' en el documento, no debe nada. ¿El documento dice 'cantidad adeudada' o 'no es una factura'?"
          : "An EOB (Explanation of Benefits) is NOT a bill. It shows what the plan paid. If it says 'This is not a bill,' you owe nothing. Does your document say 'amount due' or 'this is not a bill'?",
        chips: isSpanish
          ? ['Dice cantidad adeudada', 'Dice no es factura', 'Es de hospital', 'Es de farmacia']
          : ['Shows amount due', 'Says not a bill', 'From hospital', 'From pharmacy'],
        followUpNeeded: true,
      };
    }
    return {
      message: isSpanish
        ? 'Para ayudarle con su factura, necesito saber: ¿es del médico/hospital, de la farmacia, o del plan de Medicare?'
        : 'To help with your bill, I need to know: is it from a doctor/hospital, a pharmacy, or your Medicare plan?',
      chips: isSpanish
        ? ['Médico/Hospital', 'Farmacia', 'Plan de Medicare', 'No estoy seguro']
        : ['Doctor/Hospital', 'Pharmacy', 'Medicare plan', 'Not sure'],
      followUpNeeded: true,
    };
  }

  // Letter issues
  if (intent === 'letter_issue') {
    return getLetterFallback(subtype, isSpanish, state);
  }

  // Enrollment questions
  if (intent === 'enrollment_question') {
    return {
      message: isSpanish
        ? 'Para inscribirse en un plan de Medicare, necesita estar en un período de inscripción. ¿Está en su período inicial (cuando cumple 65), en el período abierto (15 oct - 7 dic), o tiene un período especial (por mudanza, pérdida de cobertura, etc.)?'
        : 'To enroll in a Medicare plan, you need to be in an enrollment period. Are you in your Initial Enrollment Period (turning 65), AEP (Oct 15 - Dec 7), or a Special Enrollment Period (moving, losing coverage, etc.)?',
      chips: isSpanish
        ? ['Cumpliendo 65 (IEP)', 'Período Abierto (AEP)', 'Período Especial (SEP)', 'No estoy seguro']
        : ['Turning 65 (IEP)', 'Open Enrollment (AEP)', 'Special Enrollment (SEP)', 'Not sure'],
      followUpNeeded: true,
    };
  }

  // Disenrollment
  if (intent === 'disenrollment_question') {
    return {
      message: isSpanish
        ? 'Para cancelar su plan de Medicare Advantage o Parte D, puede hacerlo durante el período abierto (15 oct - 7 dic) o durante el período de inscripción abierta de Medicare Advantage (1 ene - 31 mar). ¿Quiere cancelar para cambiarse a otro plan o volver a Medicare Original?'
        : 'To disenroll from a Medicare Advantage or Part D plan, you can do so during AEP (Oct 15 - Dec 7) or Medicare Advantage Open Enrollment (Jan 1 - Mar 31). Do you want to disenroll to switch plans or return to Original Medicare?',
      chips: isSpanish
        ? ['Cambiar a otro plan', 'Volver a Medicare Original', 'Tengo SEP', 'Hablar con asesor']
        : ['Switch to another plan', 'Return to Original Medicare', 'I have a SEP', 'Talk to advisor'],
      followUpNeeded: true,
    };
  }

  // Appeals & grievances
  if (intent === 'appeals_grievance') {
    return {
      message: isSpanish
        ? 'Si le negaron cobertura o un medicamento, tiene derecho a apelar. Tiene 60 días desde la fecha de la negativa. ¿Quiere que le explique cómo hacer una apelación?'
        : 'If coverage or a medication was denied, you have the right to appeal. You have 60 days from the denial date. Do you want me to explain how to file an appeal?',
      chips: isSpanish
        ? ['Sí, explicar apelación', 'Tengo una queja', 'Necesito formulario', 'Hablar con asesor']
        : ['Yes, explain appeal', 'I have a grievance', 'Need form', 'Talk to advisor'],
      followUpNeeded: true,
    };
  }

  // Complaint
  if (intent === 'complaint') {
    return {
      message: isSpanish
        ? "Lamento que haya tenido una mala experiencia. Para presentar una queja formal (llamada 'reclamo' o 'grievance'), puede llamar al 1-800-MEDICARE o contactar a su plan. ¿Quiere que le ayude a documentar su queja?"
        : "I'm sorry you had a bad experience. To file a formal complaint (called a 'grievance'), you can call 1-800-MEDICARE or contact your plan. Do you want me to help document your complaint?",
      chips: isSpanish
        ? ['Ayuda con queja', 'Teléfono de Medicare', 'Hablar con supervisor', 'Otra cosa']
        : ['Help with complaint', 'Medicare phone', 'Talk to supervisor', 'Something else'],
      followUpNeeded: true,
    };
  }

  // General fallback
  return {
    message: isSpanish
      ? 'Gracias por su pregunta. Para darle la mejor respuesta, ¿podría contarme un poco más? ¿Es sobre facturas, cobertura, medicamentos, una carta que recibió, o algo más?'
      : "Thanks for your question. To give you the best answer, could you tell me a bit more? Is it about bills, coverage, medications, a letter you received, or something else?",
    chips: isSpanish
      ? ['Factura', 'Cobertura', 'Medicamento', 'Carta', 'Proveedor']
      : ['Bill', 'Coverage', 'Medication', 'Letter', 'Provider'],
    followUpNeeded: true,
  };
}

function getLetterFallback(
  subtype: DocumentSubtype,
  isSpanish: boolean,
  _state: ConversationState,
): { message: string; chips: string[]; followUpNeeded: boolean } {
  switch (subtype) {
    case 'renewal':
    case 'anoc':
    case 'eoc':
      return {
        message: isSpanish
          ? 'Una carta de renovación o ANOC (Aviso Anual de Cambios) explica los cambios en su plan para el próximo año. Los cambios pueden incluir primas, deducibles, redes de proveedores, o cobertura de medicamentos. ¿Le preocupa algún cambio en específico?'
          : 'A renewal letter or ANOC (Annual Notice of Change) explains changes to your plan for next year. Changes may include premiums, deductibles, provider networks, or drug coverage. Are you concerned about a specific change?',
        chips: isSpanish
          ? ['Cambio de prima', 'Cambio de red', 'Cambio de medicamentos', 'No entendí el aviso']
          : ['Premium change', 'Network change', 'Drug change', "Didn't understand notice"],
        followUpNeeded: true,
      };

    case 'eob':
      return {
        message: isSpanish
          ? 'Un EOB muestra lo que su plan pagó y lo que podría deber. No es una factura a menos que diga "cantidad adeudada". ¿Ve alguna cantidad que diga que debe pagar?'
          : "An EOB shows what your plan paid and what you might owe. It's not a bill unless it says 'amount due.' Do you see an amount you're supposed to pay?",
        chips: isSpanish
          ? ['Sí, dice cantidad', 'No, dice no es factura', 'No entiendo el EOB', 'Es de hospital']
          : ['Yes, shows amount', 'No, says not a bill', 'Do not understand EOB', 'From hospital'],
        followUpNeeded: true,
      };

    case 'medicaid_notice':
      return {
        message: isSpanish
          ? 'Un aviso de Medicaid es importante. Puede ser sobre su recertificación anual, cambios en sus beneficios, o su elegibilidad. ¿El aviso menciona alguna fecha límite o acción que necesita tomar?'
          : 'A Medicaid notice is important. It may be about your annual recertification, benefit changes, or eligibility. Does the notice mention a deadline or action you need to take?',
        chips: isSpanish
          ? ['Fecha límite', 'Recertificación', 'Cambio de beneficios', 'Pérdida de elegibilidad']
          : ['Deadline', 'Recertification', 'Benefit change', 'Loss of eligibility'],
        followUpNeeded: true,
      };

    case 'collection':
      return {
        message: isSpanish
          ? '⚠️ Esto parece ser un aviso de cobro o cobranza. Es importante actuar rápido. ¿El aviso dice que es de un plan de Medicare, un hospital, o una agencia de cobranza?'
          : "⚠️ This appears to be a collection or past-due notice. It's important to act quickly. Does the notice say it's from a Medicare plan, a hospital, or a collection agency?",
        chips: isSpanish
          ? ['Del plan Medicare', 'Del hospital', 'Agencia de cobranza', 'Necesito ayuda urgente']
          : ['From Medicare plan', 'From hospital', 'Collection agency', 'Need urgent help'],
        followUpNeeded: true,
      };

    default:
      return {
        message: isSpanish
          ? 'Para ayudarle con esta carta, dígame: ¿es sobre renovación/cambios anuales, una factura, un aviso de Medicaid/Extra Help, o algo más?'
          : 'To help with this letter, tell me: is it about renewal/annual changes, a bill, a Medicaid/Extra Help notice, or something else?',
        chips: isSpanish
          ? ['Renovación/ANOC', 'Factura', 'Medicaid/Extra Help', 'Aviso de cobro']
          : ['Renewal/ANOC', 'Bill', 'Medicaid/Extra Help', 'Collection notice'],
        followUpNeeded: true,
      };
  }
}

function getDefaultChips(intent: PrimaryIntent, _subtype: DocumentSubtype, isSpanish: boolean): string[] {
  if (isSpanish) {
    switch (intent) {
      case 'bill_question':
        return ['¿Cuánto debo?', 'No es mío', 'Ya pagué', 'Es del hospital'];
      case 'coverage_question':
        return ['Medicamento cubierto', 'Doctor cubierto', 'Hospital', 'Procedimiento'];
      case 'drug_question':
        return ['Formulario', 'Autorización previa', 'Terapia escalonada', 'Costo'];
      case 'enrollment_question':
        return ['AEP (15 oct-7 dic)', 'IEP (cumplir 65)', 'SEP (mudanza)', 'Medicaid'];
      default:
        return ['Más información', 'Hablar con asesor', 'Otra pregunta'];
    }
  }

  switch (intent) {
    case 'bill_question':
      return ['How much do I owe?', 'Not mine', 'Already paid', 'From hospital'];
    case 'coverage_question':
      return ['Drug covered', 'Doctor covered', 'Hospital', 'Procedure'];
    case 'drug_question':
      return ['Formulary', 'Prior auth', 'Step therapy', 'Cost'];
    case 'enrollment_question':
      return ['AEP (Oct 15-Dec 7)', 'IEP (turning 65)', 'SEP (moving)', 'Medicaid'];
    default:
      return ['More info', 'Talk to advisor', 'Other question'];
  }
}

// ============================================================================
// MAIN ENGINE FUNCTION — ENTRY POINT
// ============================================================================
function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * V14: detectFirstLanguage — only used at conversation start. Looks for
 * accented characters and Spanish keywords to pick the initial language.
 * After the first message the language is LOCKED and only an explicit
 * override (flag-button click) can change it.
 */
function detectFirstLanguage(text: string): 'en' | 'es' {
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es';
  const spanishWords = /\b(hola|gracias|c[oó]mo|qu[eé]|por favor|ayuda|factura|carta|seguro|m[eé]dico|farmacia|medicamento|cobertura|inscripci[oó]n|prima|recib[oí]|cobro|millones|llegaron|billes)\b/i;
  const englishWords = /\b(hello|thank|how|what|please|help|bill|letter|insurance|doctor|pharmacy|drug|coverage|enrollment|premium|received|got)\b/i;
  const es = (text.match(spanishWords) || []).length;
  const en = (text.match(englishWords) || []).length;
  if (es > en) return 'es';
  if (en > es) return 'en';
  return 'en';
}

export function processMessage(
  userMessage: string,
  existingState: ConversationState | null,
  /** V14: explicit language override. Set ONLY when the user clicks the
   *  🇺🇸 / 🇪🇸 flag button. Never set from automatic detection. */
  explicitLanguage?: 'en' | 'es' | null,
): { response: string; chips: string[]; newState: ConversationState; needsHuman: boolean } {
  // Initialize or update state
  const state: ConversationState = existingState
    ? { ...existingState }
    : {
        conversationId: makeId(),
        messages: [],
        intentStack: [],
        currentPrimaryIntent: 'unknown',
        currentDocumentSubtype: 'none',
        extractedEntities: {},
        pendingFollowUps: [],
        escalationCount: 0,
        emotionalState: 'calm',
        // V14: detect at first message and immediately LOCK
        language: detectFirstLanguage(userMessage),
        languageLocked: true,
        unansweredQuestions: [],
        lastUserMessage: '',
        lastBotResponse: '',
        turnCount: 0,
        needsHuman: false,
      };

  // V14 LANGUAGE LOCK: only an EXPLICIT override (from the flag button)
  // can change the language. No more heuristic flips on every message.
  if (explicitLanguage && explicitLanguage !== state.language) {
    state.language = explicitLanguage;
    state.languageLocked = true;
  }

  // Update state with new message
  state.messages.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  state.lastUserMessage = userMessage;
  state.turnCount++;

  // Detect emotional state
  const emotionalState = detectEmotionalState(userMessage);
  state.emotionalState = emotionalState;

  // Classify intent
  const intent = classifyIntent(userMessage);
  state.currentPrimaryIntent = intent.primary;
  state.intentStack.push({
    intent: intent.primary,
    confidence: intent.confidence,
    timestamp: Date.now(),
    resolved: false,
  });

  // Detect document subtype — V14 broadened to also trigger on IRMAA / SNP /
  // dual-eligible / welcome / termination keywords even when there's no
  // explicit "letter/carta/notice" word.
  if (
    intent.primary === 'letter_issue' ||
    /carta|letter|notice|aviso|eob|factura|bill|recibo|cobro|billes|irmaa|snp|d-snp|c-snp|dual eligible|welcome letter|termination|disenrollment/i.test(userMessage)
  ) {
    const subtype = detectDocumentSubtype(userMessage);
    state.currentDocumentSubtype = subtype;
  }

  // Extract entities
  const zipMatch = userMessage.match(/\b(\d{5})\b/);
  if (zipMatch) state.extractedEntities.zipCode = zipMatch[1];

  const dollarMatch = userMessage.match(/\$?(\d+(?:\.\d{2})?)/);
  if (dollarMatch) state.extractedEntities.dollarAmount = parseFloat(dollarMatch[1]);

  if (/\b(medicaid)\b/i.test(userMessage)) state.extractedEntities.mentionedMedicaid = true;
  if (/\b(extra help|lis|low income|ayuda extra|ayuda adicional)\b/i.test(userMessage)) state.extractedEntities.mentionedExtraHelp = true;
  if (/\b(irmaa|income[- ]?related|ajuste de ingresos|ingresos altos)\b/i.test(userMessage)) state.extractedEntities.mentionedIRMAA = true;
  if (/\b(snp|special needs|condici[oó]n cr[oó]nica)\b/i.test(userMessage)) state.extractedEntities.mentionedSNP = true;

  // Generate response
  const { message, chips } = generateResponse(state, intent, state.currentDocumentSubtype, emotionalState);

  // Check for escalation
  let needsHuman = state.needsHuman;
  if (intent.primary === 'escalate_to_agent' || state.escalationCount >= 3) {
    needsHuman = true;
  }

  // Update state
  state.lastBotResponse = message;
  state.messages.push({ role: 'bot', content: message, timestamp: Date.now() });
  state.needsHuman = needsHuman;

  return {
    response: message,
    chips,
    newState: state,
    needsHuman,
  };
}

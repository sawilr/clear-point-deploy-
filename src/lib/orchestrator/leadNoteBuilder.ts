// ============================================================================
// PHASE F — LEAD NOTE BUILDER
//
// Pure helper that builds the advisor-readable lead note for GoHighLevel.
// The output is a single STRING (so the GHL bridge contract — `lead_notes`
// field type — is unchanged) shaped as:
//
//   1. CUSTOMER SERVICE SUMMARY   (human-readable, top — advisor opens here)
//   2. MACHINE FIELDS             (structured, for automation)
//   3. TRANSCRIPT                 (collapsed, optional)
//
// The builder ALSO returns the controlled-vocabulary fields the consumer
// uses to populate the payload's `interest_type`, `tags`, `consent_*`, etc.
// — without modifying the GHL bridge.
//
// CONTRACT
// --------
// Input  : ConversationState + transcript array + language hint.
// Output : { noteText, serviceCategory, interestType, recommendedStage,
//            customerStatus, escalationReason, consentStatus, urgency,
//            emotionTag, phiScrubbed, probableFakeLead, confidenceScore,
//            transcriptSummary, tags }
//
// SAFETY
// ------
// * Allow-listed values only. Anything that doesn't map → 'unknown'.
// * Never echoes raw PHI (SSN / Medicare ID / banking / detailed diagnosis).
// * Never claims eligibility, plan coverage, doctor coverage, savings,
//   "best plan", or affiliation with Medicare/CMS/SSA.
// * Customer status from self-report ALWAYS prefixed with "_claimed" — the
//   bot cannot verify accounts.
//
// THIS FILE DOES NOT TOUCH GHL OR submit-lead. It only formats a string.
// ============================================================================

import type { ConversationState } from '../customerServiceEngine';
// PHASE D — canonical preferred_language mapping. Engine 'en' → 'English',
// 'es' → 'Spanish', null → 'Unknown'.
import { preferredLanguageForGHL } from './languagePolicy';
import { scrubSensitiveText } from '../phiPatterns';

// ── ALLOW-LISTS (controlled vocabulary) ─────────────────────────────────────

export const CUSTOMER_STATUS_VALUES = [
  'existing_client_claimed',
  'not_client',
  'unsure',
  'family_caregiver',
  'prospect',
  'unknown',
] as const;
export type CustomerStatus = typeof CUSTOMER_STATUS_VALUES[number];

export const SERVICE_CATEGORY_VALUES = [
  'doctor_network_problem',
  'medication_cost_problem',
  'medication_not_covered',
  'pharmacy_problem',
  'bill_received',
  'denied_service',
  'denied_surgery',
  'transportation_problem',
  'dental_vision_hearing_problem',
  'otc_card_problem',
  'flex_card_confusion',
  'plan_change_request',
  'fraud_scam',
  'lost_card',
  'need_advisor',
  'family_member_helping',
  'existing_client_callback',
  'not_client_review_request',
  'unsure_client_status',
  'medicaid_medicare_question',
  'extra_help_question',
  'premium_question',
  'appointment_request',
  'complaint_or_frustration',
  'urgent_medication',
  'medical_emergency_911',
  'crisis_988',
  'general_education_request',
  'unknown',
] as const;
export type ServiceCategory = typeof SERVICE_CATEGORY_VALUES[number];

export const RECOMMENDED_STAGE_VALUES = [
  'new_lead_prescreen',
  'hot_handoff',
  'existing_client_callback',
  'review_queue',
  'crisis_followup',
  'fraud_alert',
  'general_information',
  'no_action_needed',
  'unknown',
] as const;
export type RecommendedStage = typeof RECOMMENDED_STAGE_VALUES[number];

export const ESCALATION_REASON_VALUES = [
  'user_requested_advisor',
  'topic_requires_advisor',
  'frustration_escalation',
  'fraud_alert',
  'crisis_safety',
  'medical_urgency',
  'denied_service_dispute',
  'existing_client_issue',
  'family_caregiver_request',
  'not_client_review_request',
  'none',
  'unknown',
] as const;
export type EscalationReason = typeof ESCALATION_REASON_VALUES[number];

export const CONSENT_STATUS_VALUES = ['pending', 'yes', 'no', 'unknown'] as const;
export type ConsentStatus = typeof CONSENT_STATUS_VALUES[number];

export const URGENCY_VALUES = ['Normal', 'Elevated', 'Crisis', 'Unknown'] as const;
export type Urgency = typeof URGENCY_VALUES[number];

// ── Human-friendly INTEREST_TYPE labels (advisor-readable) ──────────────────

const INTEREST_TYPE_BY_CATEGORY: Record<string, string> = {
  doctor_network_problem: 'Doctor / provider network issue',
  medication_cost_problem: 'Medication cost concern',
  medication_not_covered: 'Medication not covered',
  pharmacy_problem: 'Pharmacy issue',
  bill_received: 'Bill / charge to review',
  denied_service: 'Denied service / coverage dispute',
  denied_surgery: 'Denied surgery / appeal',
  transportation_problem: 'Transportation to doctor',
  dental_vision_hearing_problem: 'Dental / vision / hearing benefit',
  otc_card_problem: 'OTC card issue',
  flex_card_confusion: 'Flex card question',
  plan_change_request: 'Plan change / enrollment',
  fraud_scam: 'Possible Medicare fraud / scam',
  lost_card: 'Lost Medicare card',
  need_advisor: 'Wants to talk with licensed advisor',
  family_member_helping: 'Family member / caregiver caller',
  existing_client_callback: 'Existing client requesting callback',
  not_client_review_request: 'Non-client requesting review',
  unsure_client_status: 'Unsure client status — verify internally',
  medicaid_medicare_question: 'Dual Medicare + Medicaid question',
  extra_help_question: 'Extra Help / LIS question',
  premium_question: 'Premium / cost question',
  appointment_request: 'Wants to schedule appointment',
  complaint_or_frustration: 'Complaint / frustration',
  urgent_medication: 'URGENT: out of medication',
  medical_emergency_911: 'CRISIS — medical emergency routed to 911',
  crisis_988: 'CRISIS — self-harm language routed to 988',
  general_education_request: 'General Medicare education question',
  unknown: 'General Medicare question',
};

// ── INTERNAL: engine intent → controlled service_category ───────────────────

function mapEngineIntentToCategory(state: ConversationState): ServiceCategory {
  const intent = (state.serviceCategory || state.intent || '').toString().toLowerCase();
  // Crisis takes precedence — driven by needsHuman + crisis emotional state.
  if (state.emotionalState === 'crisis') return 'crisis_988';
  // Engine intent → controlled category. Anything unrecognized → 'unknown'.
  const map: Record<string, ServiceCategory> = {
    doctor_provider_network: 'doctor_network_problem',
    doctor_change_request: 'doctor_network_problem',
    drug: 'medication_cost_problem',
    urgent_medication: 'urgent_medication',
    bill: 'bill_received',
    bill_provider: 'bill_received',
    letter: 'bill_received',
    appeal: 'denied_service',
    coverage: 'medicaid_medicare_question',
    enrollment: 'plan_change_request',
    medicare_advantage: 'plan_change_request',
    savings_program: 'extra_help_question',
    spap: 'extra_help_question',
    plan_recommendation: 'plan_change_request',
    moving_state_sep: 'plan_change_request',
    fraud_scam: 'fraud_scam',
    medical_emergency_911: 'medical_emergency_911',
    er_hospital_visit: 'bill_received',
    telehealth: 'general_education_request',
    eob_explanation: 'bill_received',
    about_clearpoint: 'general_education_request',
    family_referral: 'family_member_helping',
    returning_customer: 'existing_client_callback',
    cost_basics: 'premium_question',
    medicare_basics: 'general_education_request',
    plan_type_question: 'general_education_request',
    advisor: 'need_advisor',
    conversation_control: 'unknown',
  };
  if (intent && map[intent]) return map[intent];
  // Heuristics from raw signals.
  if (intent.includes('appeal') || intent.includes('denied')) return 'denied_service';
  if (intent.includes('drug') || intent.includes('medic')) return 'medication_cost_problem';
  if (intent.includes('bill') || intent.includes('letter') || intent.includes('eob')) return 'bill_received';
  if (intent.includes('doctor') || intent.includes('provider')) return 'doctor_network_problem';
  if (intent.includes('savings') || intent.includes('extra')) return 'extra_help_question';
  if (intent.includes('fraud') || intent.includes('scam')) return 'fraud_scam';
  return 'unknown';
}

// ── CUSTOMER STATUS derivation ──────────────────────────────────────────────

function deriveCustomerStatus(
  state: ConversationState,
  transcript: Array<{ sender: string; text: string }>,
): CustomerStatus {
  if (state.isExistingClient === true) return 'existing_client_claimed';
  if (state.isExistingClient === false && state.existingClientAsked) return 'not_client';
  if (state.existingClientAsked && state.isExistingClient === undefined) return 'unsure';
  // Heuristic: family caregiver language anywhere in user turns.
  // (Trailing word-boundary removed — \b is ASCII-only and breaks on
  // accented chars like "mamá".)
  const lower = transcript
    .filter((m) => m.sender === 'user')
    .map((m) => (m.text || '').toLowerCase())
    .join(' \n ');
  if (/\b(llamo por (mi |m[ií] )?(mam[aá]|pap[aá]|hij[oa]|esposo|esposa|abuel[oa]|t[ií]o|t[ií]a|sobrin[oa]|hermano|hermana)|i'?m? calling for (my )?(mom|dad|son|daughter|husband|wife|spouse|sister|brother|aunt|uncle|grandm|grandp)|speaking on behalf of|cuidador|caregiver)/i.test(lower)) {
    return 'family_caregiver';
  }
  // Heuristic: "soy cliente / I'm a client" without going through gate.
  if (/\b(soy cliente|i'?m a client|i am a client|tengo asesor|mi asesor)\b/i.test(lower)) {
    return 'existing_client_claimed';
  }
  if (/\b(no soy cliente|i'?m not a client|i am not a client|never (called|been) before|primera vez)\b/i.test(lower)) {
    return 'not_client';
  }
  return 'unknown';
}

// ── URGENCY derivation ──────────────────────────────────────────────────────

function deriveUrgency(state: ConversationState, category: ServiceCategory): Urgency {
  if (category === 'crisis_988' || category === 'medical_emergency_911') return 'Crisis';
  if (state.emotionalState === 'crisis') return 'Crisis';
  if (category === 'urgent_medication') return 'Elevated';
  if (category === 'fraud_scam') return 'Elevated';
  if (category === 'denied_service' || category === 'denied_surgery') return 'Elevated';
  if (state.emotionalState === 'urgent') return 'Elevated';
  if (state.emotionalState === 'angry' || (state.frustrationCount || 0) >= 2) return 'Elevated';
  return 'Normal';
}

// ── ESCALATION REASON derivation ────────────────────────────────────────────

function deriveEscalationReason(
  state: ConversationState,
  category: ServiceCategory,
  customerStatus: CustomerStatus,
): EscalationReason {
  const raw = (state.advisorHandoffReason || '').toLowerCase();
  // Safety / urgency ALWAYS wins first — these route the advisor differently.
  if (category === 'crisis_988' || category === 'medical_emergency_911') return 'crisis_safety';
  if (category === 'fraud_scam') return 'fraud_alert';
  if (category === 'urgent_medication') return 'medical_urgency';
  // Then customer-status routing (existing-client / caregiver / not-client)
  // takes precedence over topic-based reason — this lines up with how the
  // advisor's CRM pipeline routes the case.
  if (customerStatus === 'existing_client_claimed') return 'existing_client_issue';
  if (customerStatus === 'family_caregiver') return 'family_caregiver_request';
  if (customerStatus === 'not_client') return 'not_client_review_request';
  // Then specific topic disputes.
  if (category === 'denied_service' || category === 'denied_surgery') return 'denied_service_dispute';
  if (raw.includes('user_consented') || raw.includes('chip_request_advisor') || raw.includes('user_requested')) return 'user_requested_advisor';
  if (raw.includes('frustration') || raw.includes('loop_guard') || raw.includes('unclear_topic') || raw.includes('no_topic_repeated')) return 'frustration_escalation';
  if (state.advisorHandoffStarted) return 'user_requested_advisor';
  if (state.needsHuman) return 'topic_requires_advisor';
  return 'none';
}

// ── RECOMMENDED STAGE derivation ────────────────────────────────────────────

function deriveRecommendedStage(
  state: ConversationState,
  category: ServiceCategory,
  customerStatus: CustomerStatus,
  urgency: Urgency,
): RecommendedStage {
  if (urgency === 'Crisis') return 'crisis_followup';
  if (category === 'fraud_scam') return 'fraud_alert';
  if (customerStatus === 'existing_client_claimed') return 'existing_client_callback';
  if (state.probableFakeLead || (state.dataConfidenceScore ?? 100) < 40) return 'review_queue';
  if (state.advisorHandoffStarted || state.needsHuman) {
    if (urgency === 'Elevated') return 'hot_handoff';
    return 'new_lead_prescreen';
  }
  if (category === 'general_education_request' || category === 'extra_help_question') return 'general_information';
  return 'new_lead_prescreen';
}

// ── CONSENT STATUS derivation ──────────────────────────────────────────────
//
// Sawil 2026-06-30 AUDIT FIX (Phase 2 consent integrity) — since the Option A
// hotfix, Clara SHOWS the TCPA authorization in the confirmation summary and the
// caller's explicit "yes" sets contactConfirmed. That IS affirmative consent, so
// the note must report "yes" to match the consent_to_contact=true the payload
// sends — previously the note said "pending", contradicting the same lead. An
// in-progress handoff that the caller has NOT yet confirmed stays "pending".
function deriveConsentStatus(state: ConversationState): ConsentStatus {
  if (state.contactConfirmed) return 'yes';
  if (state.advisorHandoffStarted || state.needsHuman) return 'pending';
  return 'unknown';
}

// ── PHI SCRUB DETECTION ─────────────────────────────────────────────────────

function detectPhiScrubbed(
  state: ConversationState,
  transcript: Array<{ sender: string; text: string }>,
): boolean {
  // The engine replaces sensitive user messages with a placeholder. Check
  // for the placeholder OR for inconsistency tags suggesting PHI was seen.
  const placeholderEs = '[Mensaje contenía datos sensibles — ocultado por seguridad]';
  const placeholderEn = '[Message contained sensitive data — hidden for safety]';
  const hasPlaceholder = transcript.some(
    (m) => m.text === placeholderEs || m.text === placeholderEn,
  );
  if (hasPlaceholder) return true;
  const inc = (state.inconsistencies || []).join(' ').toLowerCase();
  if (inc.includes('phi') || inc.includes('medicare_id') || inc.includes('ssn')) return true;
  // Defense in depth: check transcript for raw SSN / Medicare MBI patterns
  // that the engine MIGHT have failed to scrub. If we see one we mark it.
  const txt = transcript.map((m) => m.text || '').join(' \n ');
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(txt)) return true;             // SSN-shape
  if (/\b\d[A-Za-z]{2}\d-[A-Za-z]{2}\d-[A-Za-z]{2}\d{2}\b/.test(txt)) return true; // MBI
  return false;
}

// ── PROBLEM SUMMARY (verbatim from latest user message) ─────────────────────

function buildUserProblemSummary(
  transcript: Array<{ sender: string; text: string }>,
  language: 'en' | 'es',
  customerStatus: CustomerStatus,
): { whatUserSaid: string; transcriptSummary: string } {
  const userTurns = transcript
    .filter((m) => m.sender === 'user')
    .map((m) => (m.text || '').trim())
    .filter((t) => t.length > 1 && !/^(english|español|spanish|ingl[eé]s)$/i.test(t) && !/^\d{5}$/.test(t));
  // AUDIT 2026-08-13 (O-06, P1) — these two quotes also land in a permanent CRM
  // note, so they get the same client-side scrub as the transcript block.
  const last = scrubSensitiveText(userTurns[userTurns.length - 1] || '');
  // Quote up to 200 chars verbatim — advisor wants the user's words.
  const verbatim = last.length > 200 ? last.slice(0, 197).trim() + '…' : last;
  const whatUserSaid = verbatim || (language === 'es' ? 'No proporcionado.' : 'Not provided.');
  // Transcript summary = first user turn (topic) + customerStatus tag.
  const first = scrubSensitiveText(userTurns[0] || '');
  const firstClipped = first.length > 120 ? first.slice(0, 117).trim() + '…' : first;
  const transcriptSummary = `${customerStatus} · "${firstClipped}"`;
  return { whatUserSaid, transcriptSummary };
}

// ── MAIN ENTRYPOINT ─────────────────────────────────────────────────────────

export interface BuildLeadNoteInput {
  state: ConversationState;
  transcript: Array<{ sender: 'user' | 'bot'; text: string }>;
}

export interface LeadNoteResult {
  noteText: string;
  serviceCategory: ServiceCategory;
  interestType: string;
  recommendedStage: RecommendedStage;
  customerStatus: CustomerStatus;
  escalationReason: EscalationReason;
  consentStatus: ConsentStatus;
  urgency: Urgency;
  emotionTag: string;
  phiScrubbed: boolean;
  probableFakeLead: boolean;
  confidenceScore: number;
  transcriptSummary: string;
  tags: string[];
  /** PHASE D — canonical preferred_language for the GHL payload field
   *  ('English' | 'Spanish' | 'Unknown'). */
  preferredLanguage: 'English' | 'Spanish' | 'Unknown';
}

export function buildLeadNote(input: BuildLeadNoteInput): LeadNoteResult {
  const { state } = input;
  const transcript = input.transcript || [];
  const language: 'en' | 'es' = (state.language === 'es' ? 'es' : 'en');

  // Derive everything.
  const customerStatus = deriveCustomerStatus(state, transcript);
  const serviceCategory = mapEngineIntentToCategory(state);
  const interestType = INTEREST_TYPE_BY_CATEGORY[serviceCategory] || 'General Medicare question';
  const urgency = deriveUrgency(state, serviceCategory);
  const escalationReason = deriveEscalationReason(state, serviceCategory, customerStatus);
  const recommendedStage = deriveRecommendedStage(state, serviceCategory, customerStatus, urgency);
  const consentStatus = deriveConsentStatus(state);
  const phiScrubbed = detectPhiScrubbed(state, transcript);
  const probableFakeLead = !!state.probableFakeLead;
  const confidenceScore = state.dataConfidenceScore ?? 100;
  const emotionTag = state.emotionalState || 'calm';
  const { whatUserSaid, transcriptSummary } = buildUserProblemSummary(transcript, language, customerStatus);

  // Bot assessment — bilingual + compliance-safe.
  const botAssessmentByCategory: Record<ServiceCategory, { en: string; es: string }> = {
    doctor_network_problem: {
      en: 'Doctor / provider network status requires advisor verification. Bot did not confirm in/out of network.',
      es: 'El estado de la red del doctor requiere verificación del asesor. El bot no confirmó si está dentro o fuera de la red.',
    },
    medication_cost_problem: {
      en: 'Medication cost may depend on plan, formulary, tier, deductible, pharmacy, and coverage stage. Advisor review required.',
      es: 'El costo del medicamento puede depender del plan, formulario, tier, deducible, farmacia y etapa de cobertura. Requiere revisión del asesor.',
    },
    medication_not_covered: {
      en: 'Medication non-coverage may be formulary, prior-auth, or step therapy. Advisor must verify with plan/pharmacy.',
      es: 'La no-cobertura del medicamento puede ser por formulario, autorización previa o paso a paso. El asesor debe verificar con el plan/farmacia.',
    },
    pharmacy_problem: {
      en: 'Pharmacy issue requires advisor follow-up — verify preferred pharmacy and tier with plan.',
      es: 'Problema de farmacia requiere seguimiento del asesor — verificar farmacia preferida y tier con el plan.',
    },
    bill_received: {
      en: 'Bill / letter requires advisor review. Bot did not confirm amount due or coverage decisions.',
      es: 'La factura/carta requiere revisión del asesor. El bot no confirmó montos ni decisiones de cobertura.',
    },
    denied_service: {
      en: 'Coverage denial / appeal — advisor should review with the plan or carrier appeals process.',
      es: 'Denegación de cobertura / apelación — el asesor debe revisar con el proceso de apelaciones del plan o carrier.',
    },
    denied_surgery: {
      en: 'Surgery / procedure denial — advisor should review documentation and appeal pathway with carrier.',
      es: 'Denegación de cirugía / procedimiento — el asesor debe revisar documentación y vía de apelación con el carrier.',
    },
    transportation_problem: {
      en: 'Some Medicare Advantage plans cover transportation to medical appointments. Advisor to verify with plan.',
      es: 'Algunos planes Medicare Advantage cubren transporte a citas médicas. El asesor verifica con el plan.',
    },
    dental_vision_hearing_problem: {
      en: 'Dental / vision / hearing are supplemental benefits in some MA plans. Advisor to verify plan coverage.',
      es: 'Dental / visión / audición son beneficios suplementarios en algunos planes MA. El asesor verifica la cobertura.',
    },
    otc_card_problem: {
      en: 'OTC card issue — advisor should help user contact the plan or carrier directly.',
      es: 'Problema con la tarjeta OTC — el asesor ayuda a contactar al plan o carrier directamente.',
    },
    flex_card_confusion: {
      en: 'Flex card rules are plan-specific. Advisor to walk user through plan documentation.',
      es: 'Las reglas de la tarjeta flex son específicas del plan. El asesor revisa la documentación con el usuario.',
    },
    plan_change_request: {
      en: 'Plan change has enrollment-period rules (AEP, SEP, IEP). Advisor to review eligibility and options. No specific plan recommended by bot.',
      es: 'El cambio de plan tiene reglas por periodo (AEP, SEP, IEP). El asesor revisa elegibilidad y opciones. El bot NO recomendó plan específico.',
    },
    fraud_scam: {
      en: 'Possible Medicare fraud / scam concern. Bot advised NOT to share Medicare ID, SSN, banking, or personal data with the caller.',
      es: 'Posible preocupación por fraude/estafa de Medicare. El bot recomendó NO compartir Medicare ID, SSN, bancaria, ni datos personales con el llamante.',
    },
    lost_card: {
      en: 'Lost Medicare card — bot directed to 1-800-MEDICARE / mymedicare.gov. Advisor may assist with reorientation.',
      es: 'Tarjeta de Medicare perdida — el bot orientó a 1-800-MEDICARE / mymedicare.gov. El asesor puede asistir.',
    },
    need_advisor: {
      en: 'User explicitly requested licensed advisor contact. Standard advisor outreach.',
      es: 'El usuario solicitó explícitamente contacto con asesor licenciado. Acercamiento estándar.',
    },
    family_member_helping: {
      en: 'Family caregiver is calling on behalf of a relative. Capture both relationships when calling back.',
      es: 'Familiar/cuidador llama en nombre de un pariente. Capturar ambas relaciones al regresar la llamada.',
    },
    existing_client_callback: {
      en: 'User claims existing-client status. ClearPoint should verify account internally and route to assigned advisor.',
      es: 'El usuario dice ser cliente existente. ClearPoint debe verificar la cuenta internamente y dirigir al asesor asignado.',
    },
    not_client_review_request: {
      en: 'Non-client requesting personalized review. Standard advisor outreach to schedule no-cost review.',
      es: 'No-cliente solicita revisión personalizada. Acercamiento estándar para programar revisión sin costo.',
    },
    unsure_client_status: {
      en: 'User unsure if existing client. ClearPoint to verify internally before sharing any account details.',
      es: 'El usuario no está seguro de ser cliente. ClearPoint verifica internamente antes de compartir detalles de cuenta.',
    },
    medicaid_medicare_question: {
      en: 'Dual Medicare + Medicaid question. Advisor to discuss D-SNP and state Medicaid resources.',
      es: 'Pregunta sobre Medicare + Medicaid. El asesor discute D-SNP y recursos estatales de Medicaid.',
    },
    extra_help_question: {
      en: 'Extra Help / LIS or MSP / QMB / SLMB inquiry. Eligibility depends on income/assets/state. Advisor verifies with user and Medicaid office.',
      es: 'Consulta sobre Extra Help / LIS o MSP / QMB / SLMB. La elegibilidad depende de ingresos/activos/estado. El asesor verifica con el usuario y la oficina de Medicaid.',
    },
    premium_question: {
      en: 'Premium / cost question. Numbers vary by plan, county, and other factors — advisor reviews current numbers for user area.',
      es: 'Pregunta sobre prima/costo. Los números varían por plan, condado y otros factores — el asesor revisa los números actuales para el área del usuario.',
    },
    appointment_request: {
      en: 'User asked to schedule an appointment with a licensed advisor.',
      es: 'El usuario pidió programar una cita con un asesor licenciado.',
    },
    complaint_or_frustration: {
      en: 'User is frustrated. Advisor should acknowledge and proceed calmly.',
      es: 'El usuario está frustrado. El asesor debe reconocerlo y proceder con calma.',
    },
    urgent_medication: {
      en: 'URGENT: user reports being out of medication or imminent supply issue. Plan carrier number should be contacted for temporary supply.',
      es: 'URGENTE: el usuario reporta que se quedó sin medicina o un problema de suministro inminente. Llamar al carrier del plan para suministro temporal.',
    },
    medical_emergency_911: {
      en: 'CRISIS — medical emergency. Bot directed user to 911. Do NOT treat as a standard Medicare lead.',
      es: 'CRISIS — emergencia médica. El bot dirigió al usuario al 911. NO tratar como un lead estándar de Medicare.',
    },
    crisis_988: {
      en: 'CRISIS — self-harm language detected. Bot directed user to 988. Follow company crisis policy.',
      es: 'CRISIS — lenguaje de autolesión detectado. El bot dirigió al usuario al 988. Seguir política de crisis de la compañía.',
    },
    general_education_request: {
      en: 'General Medicare education question. Advisor may answer briefly or schedule full review.',
      es: 'Pregunta general de educación sobre Medicare. El asesor puede responder brevemente o agendar revisión completa.',
    },
    unknown: {
      en: 'Topic unclear from short conversation. Advisor to call user and identify need.',
      es: 'Tema no claro de conversación corta. El asesor llama al usuario e identifica la necesidad.',
    },
  };
  const botAssessment = (botAssessmentByCategory[serviceCategory] || botAssessmentByCategory.unknown)[language];

  // Next step + advisor action (also compliance-safe).
  const nextStepBy: Record<Urgency, { en: string; es: string }> = {
    Crisis: {
      en: 'Internal review only if appropriate. Follow company crisis/escalation policy.',
      es: 'Revisión interna solo si corresponde. Seguir política de crisis/escalación de la compañía.',
    },
    Elevated: {
      en: 'Advisor should call within 24h.',
      es: 'El asesor debe llamar en las próximas 24 horas.',
    },
    Normal: {
      en: 'Advisor should call within standard SLA.',
      es: 'El asesor debe llamar dentro del SLA estándar.',
    },
    Unknown: {
      en: 'Advisor to follow up at next available slot.',
      es: 'El asesor da seguimiento en la próxima ranura disponible.',
    },
  };
  const recommendedNextStep = nextStepBy[urgency][language];

  const advisorActionBy: Record<RecommendedStage, { en: string; es: string }> = {
    new_lead_prescreen: {
      en: 'Run pre-screen call. Verify need with user; confirm any plan/formulary/network with official carrier tools.',
      es: 'Hacer llamada de prescreen. Verificar necesidad con el usuario; confirmar plan/formulario/red con herramientas oficiales del carrier.',
    },
    hot_handoff: {
      en: 'Treat as warm/hot lead — call quickly. Verify plan/coverage/eligibility through official channels before advising.',
      es: 'Tratar como lead tibio/caliente — llamar rápido. Verificar plan/cobertura/elegibilidad por canales oficiales antes de aconsejar.',
    },
    existing_client_callback: {
      en: 'Verify account internally (do NOT share account info until verified). Then route to assigned advisor.',
      es: 'Verificar cuenta internamente (NO compartir información de cuenta sin verificar). Luego enrutar al asesor asignado.',
    },
    review_queue: {
      en: 'Send to review queue — possible data quality issue (low confidence or fake-lead signal).',
      es: 'Enviar a cola de revisión — posible problema de calidad de datos (baja confianza o señal de lead falso).',
    },
    crisis_followup: {
      en: 'Follow company crisis policy. Do NOT initiate standard Medicare sales workflow.',
      es: 'Seguir política de crisis de la compañía. NO iniciar flujo estándar de ventas de Medicare.',
    },
    fraud_alert: {
      en: 'Remind user about Senior Medicare Patrol (1-877-808-2468). Do NOT solicit Medicare ID over chat.',
      es: 'Recordar al usuario sobre Senior Medicare Patrol (1-877-808-2468). NO solicitar Medicare ID por chat.',
    },
    general_information: {
      en: 'Provide general orientation only. Decline personalized advice without licensed review.',
      es: 'Proporcionar solo orientación general. Declinar asesoría personalizada sin revisión licenciada.',
    },
    no_action_needed: {
      en: 'No advisor action required.',
      es: 'No se requiere acción del asesor.',
    },
    unknown: {
      en: 'Use standard outreach.',
      es: 'Usar acercamiento estándar.',
    },
  };
  const advisorAction = advisorActionBy[recommendedStage][language];

  // Captured fields.
  const captured: string[] = [];
  if (state.name) captured.push('name');
  if (state.phoneNumber) captured.push('phone');
  if (state.zipCode) captured.push('ZIP');
  if (state.language) captured.push('preferred language');
  if (state.state) captured.push('US state');
  const capturedStr = captured.length > 0 ? captured.join(', ') : (language === 'es' ? 'ninguno todavía' : 'none yet');

  // PHI / sensitive note.
  const sensitiveNote = phiScrubbed
    ? (language === 'es'
       ? 'Información sensible pudo haber sido compartida — NO fue incluida en esta nota por seguridad.'
       : 'Sensitive information may have been volunteered — it was NOT included in this note for safety.')
    : '';

  // ── HUMAN-READABLE SUMMARY ────────────────────────────────────────────────
  const stateLabel = state.state || (state.zipCode ? 'unknown' : 'not provided');
  const consentLine = consentStatus === 'pending'
    ? 'pending / user requested contact'
    : consentStatus;

  // PHASE D — canonical preferred_language mapping (en/es/null → Eng/Sp/Unknown).
  const ghlLang = preferredLanguageForGHL(state.language ?? null);
  const humanSummary = [
    'CUSTOMER SERVICE SUMMARY',
    `Source: Customer Service Assistant`,
    `Language: ${ghlLang}`,
    `State: ${stateLabel}`,
    // Sawil 2026-06-18 — callback lead fields (name/phone/DOB/best time/topic).
    `Name: ${state.name || 'not provided'}`,
    `Phone: ${state.phoneNumber || 'not provided'}`,
    `Date of birth: ${state.dateOfBirth || (state.dobRefused ? 'declined by user' : 'not provided')}`,
    `ZIP code: ${state.zipCode || 'not provided'}`,
    `Best callback time: ${state.bestTimeToCall || 'not provided'}`,
    `Topic for advisor: ${state.advisorTopic || 'not provided'}`,
    `Customer status: ${customerStatus}`,
    `Main issue: ${interestType}`,
    `What the user said: ${whatUserSaid}`,
    `Bot assessment: ${botAssessment}`,
    `Urgency: ${urgency}`,
    `Recommended next step: ${recommendedNextStep}`,
    `Advisor action: ${advisorAction}`,
    `Consent status: ${consentLine}`,
    `Data captured: ${capturedStr}`,
    `Data not requested for safety: SSN, Medicare ID/MBI, banking information, private medical records`,
    `Compliance note: Bot did NOT confirm eligibility, doctor or medication coverage, recommend a plan, or claim affiliation with Medicare/CMS/SSA.`,
    ...(sensitiveNote ? [`Sensitive data note: ${sensitiveNote}`] : []),
  ].join('\n');

  // ── MACHINE FIELDS ────────────────────────────────────────────────────────
  const machineFields = [
    '',
    'MACHINE FIELDS',
    `source_component: customer_service_bot`,
    `service_category: ${serviceCategory}`,
    `interest_type: ${interestType}`,
    `recommended_stage: ${recommendedStage}`,
    `confidence_score: ${confidenceScore}`,
    `escalation_reason: ${escalationReason}`,
    `probable_fake_lead: ${probableFakeLead ? 'true' : 'false'}`,
    `emotion_tag: ${emotionTag}`,
    `PHI_scrubbed: ${phiScrubbed ? 'true' : 'false'}`,
    `date_of_birth: ${state.dateOfBirth || (state.dobRefused ? 'declined' : '')}`,
    `best_callback_time: ${state.bestTimeToCall || ''}`,
    `advisor_topic: ${state.advisorTopic || ''}`,
    `transcript_summary: ${transcriptSummary}`,
  ].join('\n');

  // ── OPTIONAL TRANSCRIPT (collapsed reference) ─────────────────────────────
  // AUDIT 2026-08-13 (O-06, P1) — these turns land VERBATIM in a CRM note,
  // which is permanent storage. The old comment claimed "with PHI placeholders
  // preserved", but that only held when an earlier gate had already replaced
  // the value; nothing scrubbed HERE. The server scrub was the only thing
  // between a pattern it missed and a permanent record of a beneficiary's SSN.
  // The two scrubbers catch DIFFERENT variants (client: dot-separated SSN, bank
  // phrases, soft health tier; server: IBAN/HICN/routing), so running both
  // raises real coverage instead of duplicating work.
  const tx = transcript.slice(-20);
  const transcriptBlock = tx.length > 0
    ? [
        '',
        `TRANSCRIPT (${tx.length} of ${transcript.length} turns)`,
        ...tx.map((m) => `[${m.sender === 'bot' ? 'BOT' : 'USER'}]: ${scrubSensitiveText(m.text || '')}`),
      ].join('\n')
    : '';

  const noteText = humanSummary + '\n' + machineFields + (transcriptBlock ? '\n' + transcriptBlock : '');

  // ── CONTROLLED TAG VOCABULARY ─────────────────────────────────────────────
  const tags: string[] = [
    'customer_service_bot',
    language === 'es' ? 'language_es' : 'language_en',
    `state_${state.state || 'unknown'}`,
    `category_${serviceCategory}`,
    `status_${customerStatus}`,
    `urgency_${urgency.toLowerCase()}`,
    `consent_${consentStatus}`,
    `confidence_${confidenceScore < 40 ? 'low' : confidenceScore < 80 ? 'medium' : 'high'}`,
  ];
  if (probableFakeLead) tags.push('probable_fake_lead');
  if (phiScrubbed) tags.push('phi_scrubbed');

  return {
    noteText,
    serviceCategory,
    interestType,
    recommendedStage,
    customerStatus,
    escalationReason,
    consentStatus,
    urgency,
    emotionTag,
    phiScrubbed,
    probableFakeLead,
    confidenceScore,
    transcriptSummary,
    tags,
    preferredLanguage: ghlLang,
  };
}

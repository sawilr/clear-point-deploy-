// ─────────────────────────────────────────────────────────────────────────────
// PHASE 10 — Clara outer filtering flow (Path A / B / C).
//
// Sits ABOVE the existing customerServiceEngine.ts. The outer flow decides
// who reaches the engine at all:
//
//   Path A — Existing client → identity verification via GHL lookup →
//            if matched, route to assigned advisor; if not, escalate for
//            manual review. Engine is NOT engaged for Path A.
//
//   Path B — Prospect exploring → qualification (Medicare A+B or near 65,
//            and state NY/NJ/CT, and Medicare-related topic). If qualified,
//            the existing engine takes over for topic discussion.
//
//   Path C — Out-of-scope topic OR didn't qualify in Path B → polite
//            deflection with public-resources referrals. NO lead capture
//            unless user EXPLICITLY opts in.
//
// FL: BLOCKED as principal qualified lead until FMO authorization. Users
// from FL get `out_of_service_area_interest` tag only if they opt in.
//
// Compliance: no plan recommendations, no eligibility confirmations, no
// promises, no carrier names. Tone is suave informativo.
// ─────────────────────────────────────────────────────────────────────────────

export type ClaraOuterPath = 'A' | 'B' | 'C' | null;

export type ClaraOuterStep =
  // Initial — natural-language entry. After Phase 11.1 the user types
  // freely; Clara infers the path silently. 'awaiting_client_check' is
  // the optional one-question disambiguator when inferInitialPath returns
  // 'ambiguous' (i.e., user described a service issue without saying
  // whether they're a client).
  | 'path_select'
  | 'awaiting_client_check'
  // Path A — Existing client
  | 'A_collect_identity'
  | 'A_verifying'
  | 'A_matched_collect_topic'
  | 'A_unmatched_collect_topic'
  | 'A_done'
  // Path B — Prospect qualification
  | 'B_q_medicare'
  | 'B_q_state'
  | 'B_q_topic'
  | 'B_pitch'
  | 'B_engine_engaged' // delegate to existing engine
  | 'B_done'
  // Path C — Out of scope
  | 'C_resources_shown'
  | 'C_optin_capture'
  | 'C_fl_offer'
  | 'C_done';

export type MedicareStatus = 'AB_active' | 'near_65' | 'none';
export type ClaraState = 'NY' | 'NJ' | 'CT' | 'FL' | 'other';
export type ClaraTopic = 'plan' | 'billing' | 'doctor' | 'medication' | 'other';

export type OutOfScopeCategory =
  | 'dental_only'
  | 'life_insurance'
  | 'medicaid_only'
  | 'outside_state'
  | 'medical_question'
  | 'auto_home_insurance'
  | 'other';

export interface ClaraOuterState {
  step: ClaraOuterStep;
  path: ClaraOuterPath;
  language: 'en' | 'es';
  // Identity / capture
  fullName?: string;
  last4Phone?: string;
  phone?: string;
  email?: string;
  // Path A verification result
  verifiedContactId?: string;
  assignedUserId?: string;
  assignedAdvisorName?: string;
  // Path B qualification
  medicareStatus?: MedicareStatus;
  state?: ClaraState;
  topic?: ClaraTopic;
  // Path C
  outOfScopeCategory?: OutOfScopeCategory;
  // Summary (collected at end of A or before submit)
  problemSummary?: string;
  // Final lead type for GHL
  finalLeadType?:
    | 'existing_client_inquiry'
    | 'existing_client_unverified'
    | 'qualified_prospect'
    | 'out_of_scope_optin_callback'
    | 'out_of_service_area_interest';
}

export function createOuterState(language: 'en' | 'es'): ClaraOuterState {
  return { step: 'path_select', path: null, language };
}

// ── Path selection from chip click ─────────────────────────────────────────
export function pickPath(p: 'A' | 'B' | 'C'): ClaraOuterStep {
  return p === 'A' ? 'A_collect_identity' : p === 'B' ? 'B_q_medicare' : 'C_resources_shown';
}

// ── Validation ─────────────────────────────────────────────────────────────

/** Returns last-4 digits if input has exactly 4 numeric chars (ignores spaces/dashes). */
export function validateLast4Phone(text: string): { ok: boolean; digits?: string } {
  if (!text || typeof text !== 'string') return { ok: false };
  const digits = text.replace(/\D+/g, '');
  if (digits.length === 4) return { ok: true, digits };
  // Also allow user typing a full phone — take the last 4.
  if (digits.length >= 7 && digits.length <= 15) return { ok: true, digits: digits.slice(-4) };
  return { ok: false };
}

/** Basic full-name validation (≥2 words, alpha+space, length 4-80). */
export function validateFullName(text: string): { ok: boolean; cleaned?: string } {
  if (!text || typeof text !== 'string') return { ok: false };
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 4 || cleaned.length > 80) return { ok: false };
  if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(cleaned)) return { ok: false };
  if (cleaned.split(' ').length < 2) return { ok: false };
  return { ok: true, cleaned };
}

// ── Out-of-scope categorization (when user picks "Different topic" or B fails) ──

const DENTAL_KEYWORDS = /\b(dental|dentist|dientes|dentista|implante|carilla|braces|invisalign)\b/i;
const LIFE_KEYWORDS = /\b(life insurance|seguro de vida|funeral|burial|término|term life|whole life)\b/i;
const AUTO_HOME_KEYWORDS = /\b(auto|car insurance|seguro de auto|home insurance|seguro de hogar|homeowner|renter)\b/i;
const MEDICAID_ONLY_KEYWORDS = /(medicaid sin medicare|medicaid only|just medicaid|solo medicaid|just have medicaid|tengo medicaid|food stamps|snap)/i;
const MEDICAL_QUESTION_KEYWORDS = /\b(síntoma|sintoma|dolor|medicina|prescripción|cita médica|appointment|symptom|pain|diagnos)\b/i;

export function categorizeOutOfScope(text: string): OutOfScopeCategory {
  if (!text || typeof text !== 'string') return 'other';
  const t = text.toLowerCase();
  if (DENTAL_KEYWORDS.test(t)) return 'dental_only';
  if (LIFE_KEYWORDS.test(t)) return 'life_insurance';
  if (AUTO_HOME_KEYWORDS.test(t)) return 'auto_home_insurance';
  if (MEDICAID_ONLY_KEYWORDS.test(t)) return 'medicaid_only';
  if (MEDICAL_QUESTION_KEYWORDS.test(t)) return 'medical_question';
  return 'other';
}

// ── PHASE 11.1 — Free-text inference helpers (replaces chip-driven UX) ──────
// Clara now starts with a natural greeting and lets the user type freely.
// These helpers silently infer path / medicare / state / topic from natural
// language so Clara can ask ONE natural follow-up at a time instead of
// showing a robotic chip menu.

const A_KEYWORDS = /(soy cliente|i am a client|i'?m a client|mi asesor|my advisor|client of|update my|tengo un caso|case number|mi caso|existing client|cliente actual)/i;
const C_KEYWORDS_DENTAL = /\b(dental|dentist|dentista|braces|invisalign|implante)\b/i;
const C_KEYWORDS_LIFE = /(life insurance|seguro de vida|funeral|burial|term life|whole life)/i;
const C_KEYWORDS_AUTO_HOME = /\b(auto insurance|car insurance|home insurance|homeowner|renter|seguro de auto|seguro de hogar)\b/i;
const C_KEYWORDS_MEDICAID_ONLY = /(just have medicaid|tengo medicaid|solo medicaid|medicaid only|just medicaid|food stamps|snap benefits)/i;

/** First-message intent inference. Returns 'A' / 'C' for clear signals,
 *  'ambiguous' when more info is needed (Clara then asks one natural q). */
export function inferInitialPath(text: string): 'A' | 'C' | 'ambiguous' {
  if (!text) return 'ambiguous';
  if (A_KEYWORDS.test(text)) return 'A';
  if (C_KEYWORDS_DENTAL.test(text) || C_KEYWORDS_LIFE.test(text) ||
      C_KEYWORDS_AUTO_HOME.test(text) || C_KEYWORDS_MEDICAID_ONLY.test(text)) return 'C';
  return 'ambiguous';
}

/** "Yes I'm a client" detector for the follow-up question. */
export function inferYesClient(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  if (/^(no|n|not|tampoco|nope|nada)/.test(t)) return false;
  return /(s[ií]|yes|y\b|client|cliente|i am|i'?m|sí soy|si soy|claro que sí|claro que si)/i.test(t);
}

export function inferMedicareStatus(text: string): MedicareStatus {
  if (!text) return 'none';
  const t = text.toLowerCase();
  if (/(a\s*\+\s*b|parte a y b|parts? a and b|partes a y b|tengo medicare|i have medicare|enrolled in medicare|inscrito|activo|active|medicare desde)/i.test(t)) return 'AB_active';
  if (/(65|sixty.?five|cerca|near|approaching|coming up|cumpl[oai]r|turning|próximo|proximo a)/i.test(t)) return 'near_65';
  return 'none';
}

export function inferStateFromText(text: string): ClaraState {
  if (!text) return 'other';
  const t = text.toLowerCase();
  if (/\b(ny|new york|nueva york|n\.?y\.?)\b/.test(t)) return 'NY';
  if (/\b(nj|new jersey|nueva jersey|jersey|n\.?j\.?)\b/.test(t)) return 'NJ';
  if (/\b(ct|connecticut|conn\.?)\b/.test(t)) return 'CT';
  if (/\b(fl|florida|fla\.?)\b/.test(t)) return 'FL';
  return 'other';
}

export function inferTopic(text: string): ClaraTopic {
  if (!text) return 'other';
  const t = text.toLowerCase();
  if (/(plan review|revisar mi plan|revisión de plan|coverage|cobertura|review my plan|change plan|cambiar plan|otro plan)/i.test(t)) return 'plan';
  if (/(bill|factura|charge|cobro|copay|copago|premium|prima|cost|costo|deducible|deductible|owe|me cobraron)/i.test(t)) return 'billing';
  if (/(doctor|specialist|provider|red|network|in.?network|out.?of.?network|red de|médico|medico|especialista|primary care|pcp)/i.test(t)) return 'doctor';
  if (/(medication|prescription|drug|medicina|medicamento|receta|farmacia|pharmacy|formulary|formulario)/i.test(t)) return 'medication';
  return 'other';
}

// ── Qualification check ──────────────────────────────────────────────────────

const QUALIFYING_STATES: ClaraState[] = ['NY', 'NJ', 'CT'];

/** True if (Medicare A+B OR near 65) AND state in NY/NJ/CT AND topic is Medicare-related. */
export function isQualifiedProspect(s: ClaraOuterState): boolean {
  if (!s.medicareStatus || s.medicareStatus === 'none') return false;
  if (!s.state || !QUALIFYING_STATES.includes(s.state)) return false;
  if (!s.topic) return false;
  return true;
}

/** True specifically for FL state (out-of-service-area special-case). */
export function isFlInterest(s: ClaraOuterState): boolean {
  return s.state === 'FL';
}

// ── GHL payload builder ──────────────────────────────────────────────────────

export interface BuildPayloadOpts {
  consentText?: string;
  consentReceiptHash?: string;
  disclaimerVersion?: string;
  ip?: string;
  userAgent?: string;
  problemSummary?: string;
}

export interface ClaraGhlPayload {
  lead_type: NonNullable<ClaraOuterState['finalLeadType']>;
  tags: string[];
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  preferred_language: 'en' | 'es';
  state?: string;
  medicare_status?: string;
  interest_type?: string;
  best_time_to_contact?: string;
  consent_to_contact: boolean;
  consent_text: string;
  lead_notes: string;
  bot_transcript_summary: string;
  // Audit metadata
  disclaimer_version?: string;
  consent_receipt_hash?: string;
  signer_ip?: string;
  signer_user_agent?: string;
  // For existing client (A) only
  ghl_contact_id?: string;
  ghl_assigned_user_id?: string;
  // Source
  lead_source: string;
  created_at: string;
}

function splitName(full?: string): { first: string; last: string } {
  if (!full) return { first: '', last: '' };
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export function buildGhlPayload(
  s: ClaraOuterState,
  opts: BuildPayloadOpts = {},
): ClaraGhlPayload {
  const { first, last } = splitName(s.fullName);
  const tags = ['Clara-Bot'];
  let leadType: NonNullable<ClaraOuterState['finalLeadType']> = s.finalLeadType || 'qualified_prospect';

  if (s.path === 'A') {
    if (s.verifiedContactId) {
      leadType = 'existing_client_inquiry';
      tags.push('existing-client', 'verified-name-phone');
    } else {
      leadType = 'existing_client_unverified';
      tags.push('claims-existing-client', 'verification-failed', 'needs-manual-review');
    }
  } else if (s.path === 'B') {
    leadType = 'qualified_prospect';
    tags.push('qualified-prospect');
    if (s.medicareStatus) tags.push(`medicare-status-${s.medicareStatus}`);
    if (s.state) tags.push(`state-${s.state}`);
    if (s.topic) tags.push(`category-${s.topic}`);
  } else if (s.path === 'C') {
    if (s.state === 'FL') {
      leadType = 'out_of_service_area_interest';
      tags.push('out-of-service-area', 'future-area-interest', 'state-FL');
    } else {
      leadType = 'out_of_scope_optin_callback';
      tags.push('out-of-scope-callback');
      if (s.outOfScopeCategory) tags.push(`original-topic-${s.outOfScopeCategory}`);
    }
  }

  const noteParts: string[] = [];
  if (s.path) noteParts.push(`Path: ${s.path}`);
  if (s.medicareStatus) noteParts.push(`Medicare: ${s.medicareStatus}`);
  if (s.state) noteParts.push(`State: ${s.state}`);
  if (s.topic) noteParts.push(`Topic: ${s.topic}`);
  if (s.outOfScopeCategory) noteParts.push(`Out-of-scope: ${s.outOfScopeCategory}`);
  if (s.verifiedContactId) noteParts.push(`Verified contact_id: ${s.verifiedContactId}`);
  if (s.assignedAdvisorName) noteParts.push(`Advisor: ${s.assignedAdvisorName}`);
  if (opts.problemSummary || s.problemSummary) {
    noteParts.push(`Summary: ${opts.problemSummary || s.problemSummary}`);
  }

  return {
    lead_type: leadType,
    tags,
    first_name: first,
    last_name: last,
    phone: s.phone || '',
    email: s.email || '',
    preferred_language: s.language,
    state: s.state || '',
    medicare_status: s.medicareStatus || '',
    interest_type: s.topic || '',
    best_time_to_contact: '',
    consent_to_contact: leadType !== 'existing_client_unverified',
    consent_text: opts.consentText || '',
    lead_notes: noteParts.join(' · '),
    bot_transcript_summary: `${s.language.toUpperCase()} · Clara · ${leadType} · path=${s.path || '?'}`,
    disclaimer_version: opts.disclaimerVersion,
    consent_receipt_hash: opts.consentReceiptHash,
    signer_ip: opts.ip,
    signer_user_agent: opts.userAgent,
    ghl_contact_id: s.verifiedContactId,
    ghl_assigned_user_id: s.assignedUserId,
    lead_source: 'clara_bot',
    created_at: new Date().toISOString(),
  };
}

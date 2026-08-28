// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9E — Persistent conversation memory across browser sessions.
//
// AUDIT 2026-07-22 (KI-SEC-01) — this store MUST NOT hold PII. It previously
// persisted name+zip+state in cleartext localStorage for 60 days; any XSS or
// compromised third-party script could read them, and the stored identity
// produced wrong-name greetings for shared devices. It now keeps ONLY
// non-identifying continuity data (language, lastTopic, lastSeen). Old
// records are migrated on read: PII fields are stripped and the sanitized
// record is rewritten. Wrapped in try/catch for Safari Private Browsing.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 'cp_visitor_memory_v1';
const TTL_MS = 60 * 24 * 3600 * 1000; // 60 days

export interface VisitorMemory {
  /** @deprecated PII — never written anymore; stripped on read (migration). */
  name?: string;
  /** @deprecated PII — never written anymore; stripped on read (migration). */
  zip?: string;
  /** @deprecated PII — never written anymore; stripped on read (migration). */
  state?: string;
  language?: 'en' | 'es';
  lastTopic?: string;
  lastSeen: number; // epoch ms
}

/** Non-PII projection — the ONLY shape ever persisted. */
function sanitize(mem: VisitorMemory): VisitorMemory {
  return {
    language: mem.language === 'es' || mem.language === 'en' ? mem.language : undefined,
    lastTopic: typeof mem.lastTopic === 'string' ? mem.lastTopic.slice(0, 80) : undefined,
    lastSeen: mem.lastSeen,
  };
}

export function readVisitorMemory(): VisitorMemory | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VisitorMemory;
    if (!parsed || typeof parsed !== 'object') return null;
    // TTL check
    if (Date.now() - (parsed.lastSeen || 0) > TTL_MS) {
      try { localStorage.removeItem(KEY); } catch { /* no-op */ }
      return null;
    }
    // MIGRATION — legacy records carry name/zip/state: strip and rewrite so
    // the PII disappears from disk on the visitor's first return.
    if (parsed.name !== undefined || parsed.zip !== undefined || parsed.state !== undefined) {
      const clean = sanitize(parsed);
      try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* no-op */ }
      return clean;
    }
    return sanitize(parsed);
  } catch {
    return null;
  }
}

export function writeVisitorMemory(partial: Partial<VisitorMemory>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = readVisitorMemory() || ({ lastSeen: Date.now() } as VisitorMemory);
    const next: VisitorMemory = sanitize({
      ...existing,
      ...partial,
      lastSeen: Date.now(),
    });
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode or quota — silently no-op */
  }
}

export function clearVisitorMemory(): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY); } catch { /* no-op */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// RE-AUDIT 2026-07-27 (P2) — TOPIC HUMANIZER. lastTopic stores the engine's
// internal serviceCategory slug ("medical_emergency_911"), and the returning
// greeting rendered it RAW: "La última vez hablamos de medical_emergency_911".
// Every internal slug now maps to a human, bilingual phrase; anything unknown
// (or still containing '_' / non-phrase characters) falls back to a generic
// "your previous question" so no internal token can ever surface to a caller.
// Keep this map in sync with every `serviceCategory = '…'` assignment in
// customerServiceEngine.ts.
// ─────────────────────────────────────────────────────────────────────────────

const TOPIC_LABELS: Record<string, { en: string; es: string }> = {
  about_clearpoint: { en: 'ClearPoint and how we work', es: 'ClearPoint y cómo trabajamos' },
  accessibility_need: { en: 'an accessibility need', es: 'una necesidad de accesibilidad' },
  alternative_care: { en: 'alternative care coverage', es: 'cuidados alternativos' },
  appeal: { en: 'an appeal', es: 'una apelación' },
  best_plan_question: { en: 'plan options', es: 'opciones de planes' },
  bill: { en: 'a bill', es: 'una factura' },
  bill_pharmacy: { en: 'a pharmacy bill', es: 'una factura de farmacia' },
  bill_provider: { en: 'a medical bill', es: 'una factura médica' },
  compare_plans: { en: 'comparing plans', es: 'comparar planes' },
  conversation_control: { en: 'your previous question', es: 'su consulta anterior' },
  cost_basics: { en: 'Medicare costs', es: 'los costos de Medicare' },
  crisis_988: { en: 'your wellbeing', es: 'su bienestar' },
  dental: { en: 'dental coverage', es: 'la cobertura dental' },
  disenroll_request: { en: 'cancelling an enrollment', es: 'cancelar una inscripción' },
  doctor_change_request: { en: 'changing doctors', es: 'un cambio de doctor' },
  doctor_provider_network: { en: 'your doctor and the plan network', es: 'su doctor y la red del plan' },
  donut_hole: { en: 'the drug coverage phases', es: 'las etapas de cobertura de medicamentos' },
  drug: { en: 'your medications', es: 'sus medicamentos' },
  drug_tier: { en: 'a medication tier', es: 'el nivel de un medicamento' },
  employer_va_cobra: { en: 'employer or VA coverage', es: 'cobertura de empleador o VA' },
  enrollment_windows: { en: 'enrollment periods', es: 'los períodos de inscripción' },
  eob_explanation: { en: 'an Explanation of Benefits', es: 'una Explicación de Beneficios' },
  er_hospital_visit: { en: 'a hospital visit', es: 'una visita al hospital' },
  family_referral: { en: 'help for a family member', es: 'ayuda para un familiar' },
  fraud_scam: { en: 'a possible scam', es: 'un posible fraude' },
  gym_benefit: { en: 'the gym benefit', es: 'el beneficio de gimnasio' },
  hearing: { en: 'hearing coverage', es: 'la cobertura auditiva' },
  id_card: { en: 'an ID card', es: 'una tarjeta de identificación' },
  insulin_cap: { en: 'insulin costs', es: 'el costo de la insulina' },
  irmaa_premium: { en: 'a premium adjustment (IRMAA)', es: 'un ajuste de prima (IRMAA)' },
  letter: { en: 'a letter you received', es: 'una carta que recibió' },
  medicaid_mention: { en: 'Medicaid', es: 'Medicaid' },
  medicaid_support: { en: 'Medicaid help', es: 'ayuda con Medicaid' },
  // AUDIT 2026-08-27 — merged resolution of two conflicting guards:
  // F2 (2026-07-27) required every slug to humanize (no raw token, no generic
  // fallback for known slugs); PIT-T-02 (2026-08-15) required that a
  // returning greeting never re-open with "last time we talked about a
  // medical emergency". Both intents hold via a specific NEUTRAL phrase —
  // the same pattern crisis_988 already uses ('your wellbeing') — covering
  // legacy values persisted before the write-site stopped storing these
  // slugs as lastTopic. Guarded in BOTH directions: E9a (no emergency
  // wording) and F2 (no slug leak, no generic fallback).
  medical_emergency_911: { en: 'your health', es: 'su salud' },
  medicare_advantage: { en: 'Medicare Advantage', es: 'Medicare Advantage' },
  medicare_basics: { en: 'Medicare basics', es: 'conceptos básicos de Medicare' },
  medigap: { en: 'supplemental plans', es: 'planes suplementarios' },
  mental_health: { en: 'mental health coverage', es: 'la cobertura de salud mental' },
  moving_state_sep: { en: 'moving to another state', es: 'una mudanza de estado' },
  new_to_medicare: { en: 'being new to Medicare', es: 'ser nuevo en Medicare' },
  off_topic: { en: 'your previous question', es: 'su consulta anterior' },
  original_medicare_enroll: { en: 'Original Medicare enrollment', es: 'la inscripción en Medicare Original' },
  otc: { en: 'over-the-counter benefits', es: 'los beneficios de productos sin receta' },
  personal_context: { en: 'your previous question', es: 'su consulta anterior' },
  pharmacy_logistics: { en: 'your pharmacy', es: 'su farmacia' },
  plan_recommendation: { en: 'plan options', es: 'opciones de planes' },
  plan_type_question: { en: 'plan types', es: 'los tipos de planes' },
  post_hospital_meals: { en: 'meals after a hospital stay', es: 'comidas después del hospital' },
  premium_increase: { en: 'a premium increase', es: 'un aumento de prima' },
  provider_change: { en: 'a change with your doctor', es: 'un cambio con su doctor' },
  returning_customer: { en: 'your ClearPoint case', es: 'su caso con ClearPoint' },
  savings_program: { en: 'savings programs', es: 'programas de ahorro' },
  scheduling: { en: 'scheduling a call', es: 'programar una llamada' },
  ship_referral: { en: 'the SHIP program', es: 'el programa SHIP' },
  snp_plans: { en: 'special needs plans', es: 'planes de necesidades especiales' },
  spap: { en: 'state drug assistance programs', es: 'programas estatales de medicamentos' },
  telehealth: { en: 'telehealth', es: 'la telesalud' },
  transportation: { en: 'medical transportation', es: 'el transporte médico' },
  urgent_medication: { en: 'an urgent medication', es: 'un medicamento urgente' },
  vaccine_question: { en: 'vaccines', es: 'las vacunas' },
  vision: { en: 'vision coverage', es: 'la cobertura de la vista' },
};

const TOPIC_FALLBACK = { en: 'your previous question', es: 'su consulta anterior' };

/** Map an internal topic slug to a human bilingual phrase. NEVER returns a raw
 *  slug: unknown labels — and any mapped value that would still look like an
 *  internal token — collapse to a safe generic phrase. */
export function humanizeTopic(slug: string | undefined | null, language: 'en' | 'es'): string {
  if (!slug || typeof slug !== 'string') return TOPIC_FALLBACK[language];
  const label = TOPIC_LABELS[slug.trim().toLowerCase()];
  const phrase = label ? label[language] : TOPIC_FALLBACK[language];
  // Belt-and-suspenders: no underscore / no slug-shaped output, ever.
  if (/_/.test(phrase)) return TOPIC_FALLBACK[language];
  return phrase;
}

/** Build a returning-visitor greeting if there's prior memory.
 *
 * AUDIT 2026-07-22 — names are no longer stored (KI-SEC-01), so the greeting
 * is topic-based continuity only. It never attributes an identity, which also
 * closes the shared-device wrong-name greeting (CL-LANG-15). Renders in the
 * CURRENT experience language passed by the caller — never a stored one.
 * RE-AUDIT 2026-07-27 (P2) — the topic is HUMANIZED (never a raw slug).
 */
export function returningVisitorGreeting(
  mem: VisitorMemory | null,
  language: 'en' | 'es',
): string | null {
  if (!mem || !mem.lastTopic) return null;
  const topic = humanizeTopic(mem.lastTopic, language);
  if (language === 'es') {
    return `Bienvenido de vuelta. La última vez hablamos de ${topic}. ¿En qué le puedo ayudar hoy? ¿Prefiere continuar en español o en inglés?`;
  }
  return `Welcome back. Last time we talked about ${topic}. How can I help you today? Would you prefer English or Spanish?`;
}

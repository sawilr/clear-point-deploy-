// Smart Review lead taxonomy + routing — pure, testable, single source of truth.
//
// Business rule (Sawil 2026-06-15): the Smart Review primarily qualifies
// Medicare Advantage and Part D prospects. Lead types are PRECISE — we never
// collapse every good lead into one generic "hot" bucket. Special-situation
// traffic (Medicaid/MSP/Extra Help/LIS, SSI/SSDI, VA/TRICARE/retiree,
// home care/nursing/PACE/LTC/I-SNP) is routed to an educational path with
// explicit scope language and is only submitted to CRM as a
// LOW_PRIORITY_EDUCATION_REQUEST if the visitor opts into a callback.
//
// Nothing here implies ClearPoint enrolls people into, solves, or guarantees
// any government or special-assistance program.

export type LeadType =
  | 'MA_LEAD'
  | 'PDP_LEAD'
  | 'COST_REVIEW_TRIAGE'
  | 'NEEDS_TRIAGE'
  | 'MEDIGAP_REVIEW'
  | 'LOW_PRIORITY_EDUCATION_REQUEST';

// Clean, business-usable CRM tag per lead type (lowercase snake_case).
export const LEAD_TYPE_TAG: Record<LeadType, string> = {
  MA_LEAD: 'ma_lead',
  PDP_LEAD: 'pdp_lead',
  COST_REVIEW_TRIAGE: 'cost_review_triage',
  NEEDS_TRIAGE: 'needs_triage',
  MEDIGAP_REVIEW: 'medigap_review',
  LOW_PRIORITY_EDUCATION_REQUEST: 'low_priority_education_request',
};

// ── Step 1 — six primary Medicare qualification options ──────────────────
// Each carries a PRECISE lead type. "Lower my Medicare costs" is a triage
// entry (COST_REVIEW_TRIAGE) that asks a follow-up before it is locked in.
export type Step1Option = { id: string; en: string; es: string; leadType: LeadType };

export const STEP1_OPTIONS: Step1Option[] = [
  { id: 'ma',      en: 'Compare Medicare Advantage plans',         es: 'Comparar planes Medicare Advantage',           leadType: 'MA_LEAD' },
  { id: 'pdp',     en: 'Review my Part D drug coverage',           es: 'Revisar mi cobertura de medicamentos Parte D', leadType: 'PDP_LEAD' },
  { id: 'cost',    en: 'Review my Medicare costs',                 es: 'Revisar mis costos de Medicare',               leadType: 'COST_REVIEW_TRIAGE' },
  { id: 'new',     en: 'New to Medicare or not sure what I have',  es: 'Nuevo en Medicare o no sé qué tengo',          leadType: 'NEEDS_TRIAGE' },
  { id: 'medigap', en: 'Have Medigap and want to review options', es: 'Tengo Medigap y quiero revisar opciones',      leadType: 'MEDIGAP_REVIEW' },
  { id: 'unsure',  en: 'Not sure — guide me',                      es: 'No estoy seguro — guíeme',                     leadType: 'NEEDS_TRIAGE' },
];

// Medicare-adjacent catch-all (UX audit 2026-06-15). Replaces the old
// "Special situations (Medicaid/SSI/SSDI/VA/long-term care)" primary wording,
// which advertised government assistance and attracted unqualified leads.
// Losing employer/union coverage or a life-change SEP makes someone a genuine
// Medicare Advantage / Part D / Medigap prospect, so this routes as a normal
// qualified triage lead — NOT the low-priority special-situations bucket. The
// scope-limited education path still exists behind a quiet secondary link.
export const SEP_OPTION: Step1Option = {
  id: 'sep',
  en: "I'm losing employer coverage or have a special enrollment question",
  es: 'Estoy perdiendo cobertura de empleador o tengo una pregunta de inscripción especial',
  leadType: 'NEEDS_TRIAGE',
};

// ── COST_REVIEW_TRIAGE follow-up ─────────────────────────────────────────
// "Lower my Medicare costs" stays COST_REVIEW_TRIAGE unless the visitor
// clearly reclassifies it. We only promote to a precise sales type when the
// answer is unambiguous (drug costs → PDP_LEAD). We deliberately do NOT
// auto-promote a vague cost answer into MA_LEAD — that is the exact
// "every good lead becomes a hot MA lead" anti-pattern the business flagged.
export type CostFollowup = { id: string; en: string; es: string; leadType: LeadType };

export const COST_FOLLOWUPS: CostFollowup[] = [
  { id: 'premium', en: 'Lower my plan premium or out-of-pocket costs', es: 'Reducir la prima del plan o gastos de bolsillo', leadType: 'COST_REVIEW_TRIAGE' },
  { id: 'drugs',   en: 'My prescription / drug costs are too high',    es: 'Mis costos de medicamentos recetados son muy altos', leadType: 'PDP_LEAD' },
  { id: 'unsure',  en: "I'm not sure where the cost is coming from",   es: 'No estoy seguro de dónde viene el costo',        leadType: 'COST_REVIEW_TRIAGE' },
];

// ── Special situations — secondary educational path ──────────────────────
// Scope-limited. NOT marketed as sales options. Each maps to one clean
// category tag for the CRM.
export type SpecialSituation = { id: string; tag: string; en: string; es: string };

export const SPECIAL_SITUATIONS: SpecialSituation[] = [
  { id: 'medicaid',   tag: 'medicaid_msp_extra_help_lis', en: 'Medicaid, MSP, Extra Help, or LIS',                            es: 'Medicaid, MSP, Extra Help o LIS' },
  { id: 'disability', tag: 'ssi_ssdi_disability',         en: 'SSI, SSDI, or disability',                                     es: 'SSI, SSDI o discapacidad' },
  { id: 'va',         tag: 'va_tricare_retiree_union',    en: 'VA, TRICARE, retiree, union, or federal/state coverage',       es: 'VA, TRICARE, retiro, unión o cobertura federal/estatal' },
  { id: 'ltc',        tag: 'homecare_nursing_pace_ltc',   en: 'Home care, nursing home, PACE, MAP, LTC, or I-SNP',            es: 'Cuidado en casa, hogar de ancianos, PACE, MAP, LTC o I-SNP' },
];

// Per-category educational guidance — scope-limited, no promises, no
// implication that ClearPoint enrolls/solves the program.
export const SPECIAL_GUIDANCE: Record<string, { en: string; es: string }> = {
  medicaid: {
    en: 'Medicaid, Medicare Savings Programs (MSP), Extra Help, and LIS are state and federal programs. Eligibility is decided by your state Medicaid office and Social Security — not by ClearPoint. A licensed advisor can explain how these programs interact with Medicare and point you to the right office to apply.',
    es: 'Medicaid, los Medicare Savings Programs (MSP), Extra Help y LIS son programas estatales y federales. La elegibilidad la decide su oficina estatal de Medicaid y el Seguro Social, no ClearPoint. Un asesor licenciado puede explicarle cómo estos programas se relacionan con Medicare y orientarle a la oficina correcta para aplicar.',
  },
  disability: {
    en: 'SSI, SSDI, and disability benefits are handled by Social Security, not by ClearPoint. We do not file, approve, or solve disability claims. A licensed advisor can explain how Medicare may work once you have it, but the disability decision and its timing come from Social Security.',
    es: 'SSI, SSDI y los beneficios por discapacidad los maneja el Seguro Social, no ClearPoint. No tramitamos, aprobamos ni resolvemos reclamos de discapacidad. Un asesor licenciado puede explicarle cómo funciona Medicare una vez lo tenga, pero la decisión y el tiempo de la discapacidad vienen del Seguro Social.',
  },
  va: {
    en: 'VA, TRICARE, retiree, union, and federal/state coverage have their own rules and benefit offices. ClearPoint does not manage or solve those benefits. A licensed advisor can explain how this coverage may coordinate with Medicare so you avoid gaps or paying twice.',
    es: 'VA, TRICARE, retiro, unión y la cobertura federal/estatal tienen sus propias reglas y oficinas de beneficios. ClearPoint no administra ni resuelve esos beneficios. Un asesor licenciado puede explicarle cómo esta cobertura se coordina con Medicare para evitar vacíos o pagar dos veces.',
  },
  ltc: {
    en: 'Home care, nursing home, PACE, MAP, LTC, and I-SNP involve long-term-care and special-needs rules decided by your state and the specific program. ClearPoint does not determine eligibility or enroll you in these benefits. A licensed advisor should review your situation carefully before any Medicare change, since a change could affect benefits you already receive.',
    es: 'El cuidado en casa, hogar de ancianos, PACE, MAP, LTC e I-SNP involucran reglas de cuidado a largo plazo y necesidades especiales que deciden su estado y el programa específico. ClearPoint no determina elegibilidad ni le inscribe en estos beneficios. Un asesor licenciado debe revisar su situación con cuidado antes de cualquier cambio de Medicare, ya que un cambio podría afectar beneficios que ya recibe.',
  },
};

// Exact scope language required by the business (Sawil 2026-06-15) — shown
// BEFORE any special-situation category is offered.
export const SPECIAL_SCOPE_EN =
  'ClearPoint can provide general Medicare guidance and help you review Medicare Advantage or Part D options. We do not directly enroll people into Medicaid, SSI, SSDI, VA, TRICARE, nursing home benefits, home care benefits, or state assistance programs.';
export const SPECIAL_SCOPE_ES =
  'ClearPoint puede ofrecer orientación general sobre Medicare y ayudarle a revisar opciones de Medicare Advantage o Parte D. No inscribimos directamente en Medicaid, SSI, SSDI, VA, TRICARE, beneficios de nursing home, beneficios de home care ni programas estatales de asistencia.';

// ── Pure routing helpers ─────────────────────────────────────────────────

// A qualified sales/triage route submits to CRM through the normal Smart
// Review flow. A special-situation route only submits when the visitor opts
// into a callback (and then as LOW_PRIORITY_EDUCATION_REQUEST).
export function isQualifiedSalesRoute(leadType: LeadType): boolean {
  return leadType !== 'LOW_PRIORITY_EDUCATION_REQUEST';
}

// Build the clean CRM tag set for a route. Always includes 'smart_review'
// and the lead-type tag. Special-situation routes additionally get
// 'special_situation', 'no_normal_sales_lead', and the category tag so the
// advisor never works them as a normal hot sales lead.
export function buildLeadTags(leadType: LeadType, specialTag?: string): string[] {
  const tags = ['smart_review', LEAD_TYPE_TAG[leadType]];
  if (leadType === 'LOW_PRIORITY_EDUCATION_REQUEST') {
    tags.push('special_situation', 'no_normal_sales_lead');
    if (specialTag) tags.push(specialTag);
  }
  return tags;
}

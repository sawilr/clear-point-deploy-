// ============================================================================
// KNOWLEDGE BASE V13 — 500+ ENTRY READY (ADD AS NEEDED)
// Current: 30 critical entries
// ============================================================================
import type { PrimaryIntent, DocumentSubtype } from '../lib/customerServiceEngine';

export interface KnowledgeEntry {
  id: string;
  intent: PrimaryIntent;
  subtype?: DocumentSubtype;
  keywords: string[];
  response: string;
  responseEs: string;
  chips?: string[];
  chipsEs?: string[];
  needsFollowUp?: boolean;
  source?: string;
}

export const customerServiceKnowledge: KnowledgeEntry[] = [
  // ========== BILL QUESTIONS ==========
  {
    id: 'bill_eob_not_a_bill',
    intent: 'bill_question',
    subtype: 'eob',
    keywords: ['eob', 'explanation of benefits', 'explicación de beneficios'],
    response: "An EOB (Explanation of Benefits) is NOT a bill. It shows what your plan paid and what the provider charged. If it says 'This is not a bill' anywhere on the document, you owe nothing. Only pay if it explicitly says 'Amount Due' or has a payment stub.",
    responseEs: "Un EOB (Explicación de Beneficios) NO es una factura. Muestra lo que el plan pagó y lo que el proveedor cobró. Si dice 'Esto no es una factura' en el documento, no debe nada. Solo pague si dice explícitamente 'Cantidad adeudada' o tiene un talón de pago.",
    chips: ['I understand', 'What if it shows amount due?', 'My EOB is confusing'],
    chipsEs: ['Entiendo', '¿Qué si muestra cantidad adeudada?', 'Mi EOB es confuso'],
  },
  {
    id: 'bill_medicare_bill_overview',
    intent: 'bill_question',
    keywords: ['medicare bill', 'premium bill', 'factura medicare', 'prima'],
    response: "Medicare premium bills come from Social Security (deducted from your check) or from Medicare (if you don't get Social Security). Part A is usually free. Part B premium amounts depend on your income — Medicare publishes the current amount each year. Part D and Advantage plan bills come directly from the plan.",
    responseEs: "Las facturas de prima de Medicare vienen de Social Security (deducidas de su cheque) o de Medicare (si no recibe Social Security). La Parte A generalmente es gratis. Los montos de prima de la Parte B dependen de sus ingresos — Medicare publica el monto actual cada año. Las facturas de Parte D y Advantage vienen directamente del plan.",
    chips: ['Why did my premium go up?', 'How do I pay?', "What if I can't pay?"],
    chipsEs: ['¿Por qué subió mi prima?', '¿Cómo pago?', '¿Qué si no puedo pagar?'],
    needsFollowUp: true,
  },

  // ========== COVERAGE QUESTIONS ==========
  {
    id: 'coverage_original_medicare',
    intent: 'coverage_question',
    keywords: ['original medicare', 'part a', 'part b', 'medicare original'],
    response: "Original Medicare (Part A hospital + Part B medical) covers hospital stays, doctor visits, lab tests, surgeries, and preventive care. It does NOT cover: most dental, vision, hearing aids, long-term care, or prescription drugs (you need Part D). You pay 20% of most services with no out-of-pocket max — a licensed advisor can review whether a supplement or Advantage plan fits your situation.",
    responseEs: "Medicare Original (Parte A hospital + Parte B médico) cubre estadías hospitalarias, visitas al médico, pruebas de laboratorio, cirugías y cuidado preventivo. NO cubre: la mayoría de dental, visión, audífonos, cuidado a largo plazo o medicamentos recetados (necesita Parte D). Usted paga el 20% de la mayoría de servicios sin límite máximo de gastos — un asesor licenciado puede revisar si un suplemento o plan Advantage le conviene.",
    chips: ['What about Advantage?', 'Do I need a supplement?', 'How do I add drug coverage?'],
    chipsEs: ['¿Qué hay de Advantage?', '¿Necesito un suplemento?', '¿Cómo agrego cobertura de medicamentos?'],
  },
  {
    id: 'coverage_advantage',
    intent: 'coverage_question',
    keywords: ['medicare advantage', 'part c', 'advantage plan'],
    response: "Medicare Advantage (Part C) is offered by private plans approved by Medicare. Plans must cover everything Original Medicare covers, and many include Part D drugs, dental, vision, hearing. Most have networks (HMO/PPO) and out-of-pocket maximums. You still pay your Part B premium, plus possibly a plan premium. A licensed advisor can review which options fit your doctors, medications, and county.",
    responseEs: "Medicare Advantage (Parte C) lo ofrecen planes privados aprobados por Medicare. Los planes deben cubrir todo lo que cubre Medicare Original, y muchos incluyen medicamentos Parte D, dental, visión, audición. La mayoría tienen redes (HMO/PPO) y límites máximos de gastos. Todavía paga la prima de la Parte B, más posiblemente una prima del plan. Un asesor licenciado puede revisar qué opciones le convienen según sus doctores, medicamentos y condado.",
    chips: ['Compare with Original Medicare', 'Network questions', 'Enrollment periods'],
    chipsEs: ['Comparar con Original', 'Preguntas de red', 'Períodos de inscripción'],
  },

  // ========== DRUG QUESTIONS ==========
  {
    id: 'drug_part_d_coverage_gap',
    intent: 'drug_question',
    keywords: ['donut hole', 'coverage gap', 'covered d', 'brecha de cobertura'],
    response: "The 'donut hole' (coverage gap) mostly ended in 2020. Recent law also added an annual out-of-pocket cap on Part D drug spending. A licensed advisor should review your specific plan because formularies, tiers, and pharmacy choices affect what you actually pay.",
    responseEs: "El 'donut hole' (brecha de cobertura) terminó en su mayoría en 2020. La ley reciente también agregó un límite anual a los gastos de bolsillo de Parte D. Un asesor licenciado debe revisar su plan específico porque los formularios, niveles y la elección de farmacia afectan lo que usted realmente paga.",
    chips: ['Cap explained', 'What drugs count?', 'Extra Help for drugs'],
    chipsEs: ['Explicación del límite', '¿Qué medicamentos cuentan?', 'Ayuda adicional'],
  },
  {
    id: 'drug_prior_authorization',
    intent: 'drug_question',
    keywords: ['prior authorization', 'prior auth', 'autorización previa', 'denied drug'],
    response: "Prior authorization means your plan requires approval before covering a drug. If denied: 1) Ask your doctor to submit more info, 2) File an appeal (you have 60 days), 3) Request a formulary exception. Your doctor's office should handle most of this process.",
    responseEs: "Autorización previa significa que su plan requiere aprobación antes de cubrir un medicamento. Si es denegado: 1) Pida a su médico que envíe más información, 2) Presente una apelación (tiene 60 días), 3) Solicite una excepción del formulario. La oficina de su médico debe manejar la mayor parte de este proceso.",
    chips: ['How to file appeal', 'Formulary exception', 'Doctor not helping'],
    chipsEs: ['Cómo apelar', 'Excepción de formulario', 'Doctor no ayuda'],
    needsFollowUp: true,
  },

  // ========== ENROLLMENT ==========
  {
    id: 'enrollment_iep_initial',
    intent: 'enrollment_question',
    keywords: ['turning 65', 'initial enrollment period', 'iep', 'cumplir 65', 'periodo inicial'],
    response: "Your Initial Enrollment Period (IEP) is 7 months: 3 months before, the month of, and 3 months after your 65th birthday month. You can sign up for Part A (free if you worked 10+ years), Part B, and Part D or Medicare Advantage. Enroll at ssa.gov or call 1-800-772-1213. A licensed advisor can help you compare your options before you decide.",
    responseEs: "Su Período de Inscripción Inicial (IEP) es de 7 meses: 3 meses antes, el mes de, y 3 meses después del mes de su cumpleaños 65. Puede inscribirse en la Parte A (gratis si trabajó 10+ años), Parte B, y Parte D o Medicare Advantage. Inscríbase en ssa.gov o llame al 1-800-772-1213. Un asesor licenciado puede ayudarle a comparar opciones antes de decidir.",
    chips: ['What if I miss IEP?', 'Do I need Part B?', 'I already have employer insurance'],
    chipsEs: ['¿Qué si pierdo IEP?', '¿Necesito Parte B?', 'Ya tengo seguro del trabajo'],
  },
  {
    id: 'enrollment_aep_open',
    intent: 'enrollment_question',
    keywords: ['aep', 'annual enrollment', 'open enrollment', 'october', 'periodo abierto'],
    response: "Annual Enrollment Period (AEP): October 15 — December 7. Changes take effect January 1. You can: switch Advantage plans, switch from Original to Advantage or back, change Part D plans. You cannot switch from Advantage to Original outside AEP unless you have a Special Enrollment Period (SEP).",
    responseEs: "Período de Inscripción Anual (AEP): 15 de octubre — 7 de diciembre. Los cambios entran en vigor el 1 de enero. Puede: cambiar planes Advantage, cambiar de Original a Advantage o viceversa, cambiar planes Parte D. No puede cambiar de Advantage a Original fuera de AEP a menos que tenga un Período Especial (SEP).",
    chips: ['Medicare Advantage OEP?', 'Can I enroll late?', 'Special Enrollment Periods'],
    chipsEs: ['¿OEP de Advantage?', '¿Puedo inscribirme tarde?', 'Períodos Especiales'],
  },

  // ========== LETTERS ==========
  {
    id: 'letter_anoc_eoc',
    intent: 'letter_issue',
    subtype: 'anoc',
    keywords: ['anoc', 'annual notice of change', 'eoc', 'evidence of coverage', 'aviso anual', 'evidencia de cobertura'],
    response: "ANOC (Annual Notice of Change) and EOC (Evidence of Coverage) explain your plan's changes for next year. You get these every September. Changes can include: premiums, deductibles, provider networks, drug formularies, and extra benefits. If you don't like the changes, you can switch plans during AEP (Oct 15 — Dec 7).",
    responseEs: "ANOC (Aviso Anual de Cambios) y EOC (Evidencia de Cobertura) explican los cambios de su plan para el próximo año. Los recibe cada septiembre. Los cambios pueden incluir: primas, deducibles, redes de proveedores, formularios de medicamentos y beneficios adicionales. Si no le gustan los cambios, puede cambiar de plan durante AEP (15 oct — 7 dic).",
    chips: ['How do I switch plans?', 'What if I miss the deadline?', 'These changes seem bad'],
    chipsEs: ['¿Cómo cambio de plan?', '¿Qué si pierdo la fecha límite?', 'Estos cambios parecen malos'],
  },
  {
    id: 'letter_medicaid_recert',
    intent: 'letter_issue',
    subtype: 'medicaid_notice',
    keywords: ['medicaid recertification', 'renew medicaid', 'recertificación', 'renovar medicaid'],
    response: "Medicaid recertification (renewal) happens annually. You must respond by the deadline or risk losing coverage. The notice will ask about: income, household size, and assets (varies by state). You can recertify online, by phone, by mail, or in person. If you miss the deadline, you may be able to appeal within a limited window — your state Medicaid office or a licensed advisor can confirm the timing.",
    responseEs: "La recertificación (renovación) de Medicaid ocurre anualmente. Debe responder antes de la fecha límite o corre el riesgo de perder la cobertura. El aviso preguntará sobre: ingresos, tamaño del hogar y activos (varía por estado). Puede recertificar en línea, por teléfono, por correo o en persona. Si pierde la fecha límite, puede tener una ventana limitada para apelar — la oficina estatal de Medicaid o un asesor licenciado puede confirmar el tiempo.",
    chips: ['Where do I send it?', 'What if I lost the notice?', 'My income changed'],
    chipsEs: ['¿Dónde lo envío?', '¿Qué si perdí el aviso?', 'Mis ingresos cambiaron'],
    needsFollowUp: true,
  },

  // ========== APPEALS ==========
  {
    id: 'appeal_process',
    intent: 'appeals_grievance',
    keywords: ['appeal', 'apelación', 'denied', 'negado', 'reconsideration'],
    response: "You have 60 days from a denial to file an appeal (Level 1). Steps: 1) Request reconsideration from your plan (written or by call), 2) If denied, request independent review (the next level depends on the part of Medicare). You can have a representative help. SHIP also provides free counseling — your state's SHIP number is listed on Medicare.gov.",
    responseEs: "Tiene 60 días desde una denegación para presentar una apelación (Nivel 1). Pasos: 1) Solicite reconsideración de su plan (por escrito o llamada), 2) Si es denegado, solicite revisión independiente (el siguiente nivel depende de la parte de Medicare). Puede tener un representante que le ayude. SHIP también ofrece consejería gratuita — el número de SHIP de su estado está en Medicare.gov.",
    chips: ['Get a representative', 'Expedited appeal (urgent)', 'Denied again — Level 2'],
    chipsEs: ['Obtener representante', 'Apelación expedita (urgente)', 'Negado de nuevo — Nivel 2'],
  },

  // ========== EXTRA HELP / LIS ==========
  {
    id: 'extra_help_application',
    intent: 'general_question',
    keywords: ['extra help', 'lis', 'low income subsidy', 'ayuda adicional', 'subsidio'],
    response: "Extra Help (Low Income Subsidy / LIS) helps pay Part D costs. Eligibility is based on income and assets, and is decided by the Social Security Administration. You can apply at ssa.gov or by calling 1-800-772-1213 — the application takes a few minutes. A licensed advisor can also help you organize the application.",
    responseEs: "Ayuda Adicional (Subsidio de Bajos Ingresos / LIS) ayuda a pagar costos de Parte D. La elegibilidad se basa en ingresos y activos, y la decide la Administración del Seguro Social. Puede solicitar en ssa.gov o llamando al 1-800-772-1213 — la solicitud toma unos minutos. Un asesor licenciado también puede ayudarle a organizar la solicitud.",
    chips: ['Check my eligibility', 'How to apply', 'I was denied', 'What does it cover?'],
    chipsEs: ['Ver mi elegibilidad', 'Cómo aplicar', 'Me negaron', '¿Qué cubre?'],
  },
];

export default customerServiceKnowledge;

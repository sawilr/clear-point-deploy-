// ============================================================================
// KNOWLEDGE BASE V14 — Sawil's exact STEP 6 case copy.
// Every CASE in the master prompt has a matching knowledge entry so the
// retrieveKnowledge() path returns the verbatim response Sawil specified.
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
  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: "ME LLEGARON BILLES"
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_billes',
    intent: 'bill_question',
    subtype: 'bill',
    keywords: ['billes', 'bills', 'bill', 'factura', 'recibo', 'cobro'],
    response: "I understand. When you mention bills, receipts, or a charge, it could be a doctor or hospital bill, a copay, a monthly premium, an Explanation of Benefits (EOB), a plan letter, or an unexpected charge. So I don't guess: does it come from a doctor/hospital, pharmacy, Medicare plan, or does it say EOB? Please do not send your Medicare ID, Social Security number, banking info, or a full photo with sensitive details here.",
    responseEs: "Entiendo. Cuando dice 'billes' o facturas, puede ser una factura médica, un copago, una prima/premium, un EOB/Explicación de Beneficios, una carta del plan o un cobro inesperado. Para no adivinar: ¿viene de un doctor/hospital, farmacia, plan de Medicare, o dice EOB? No mande Medicare ID, Seguro Social, banco ni foto completa con datos sensibles.",
    chips: ['Doctor/Hospital', 'Pharmacy', 'Medicare plan', 'Says EOB', 'Not sure'],
    chipsEs: ['Doctor/Hospital', 'Farmacia', 'Plan Medicare', 'Dice EOB', 'No sé'],
    needsFollowUp: true,
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: EOB
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_eob',
    intent: 'bill_question',
    subtype: 'eob',
    keywords: ['eob', 'explanation of benefits', 'explicación de beneficios'],
    response: "An EOB / Explanation of Benefits is usually NOT a bill. It summarizes what the plan processed, what the provider charged, and what the plan paid. Treat it as a payment only if it clearly says 'amount due' or 'balance due.' Does the document say 'This is not a bill,' or does it show an amount you owe?",
    responseEs: "Un EOB/Explicación de Beneficios normalmente NO es una factura. Resume lo que el plan procesó, lo que cobró el proveedor y lo que el plan pagó. Solo debe tratarse como pago si dice claramente 'amount due', 'balance due' o cantidad adeudada. ¿El documento dice 'This is not a bill' o muestra una cantidad que debe pagar?",
    chips: ['Says not a bill', 'Shows amount due', 'I do not understand', 'Talk to advisor'],
    chipsEs: ['Dice no es factura', 'Dice cantidad adeudada', 'No entiendo', 'Hablar con asesor'],
    needsFollowUp: true,
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: COLLECTION
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_collection',
    intent: 'letter_issue',
    subtype: 'collection',
    keywords: ['collection', 'past due', 'cobro vencido', 'vencido', 'pago vencido', 'final notice'],
    response: "That can be important. If it looks like a collection or past-due notice, don't ignore it — but also don't share sensitive data here. First we have to identify whether it comes from a doctor/hospital, pharmacy, your plan, or a collection agency. Where does it appear to come from?",
    responseEs: "Eso puede ser importante. Si parece un aviso de collection o cobro vencido, no ignore la carta, pero tampoco comparta datos sensibles aquí. Primero hay que identificar si viene de un hospital/doctor, farmacia, plan o agencia de cobranza. ¿De dónde parece venir?",
    chips: ['Doctor/Hospital', 'Pharmacy', 'Medicare plan', 'Collection agency'],
    chipsEs: ['Doctor/Hospital', 'Farmacia', 'Plan Medicare', 'Agencia de cobranza'],
    needsFollowUp: true,
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: MEDICAID LETTER
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_medicaid_letter',
    intent: 'letter_issue',
    subtype: 'medicaid_notice',
    keywords: ['medicaid', 'recertification', 'recertificación', 'redetermination'],
    response: "A letter from Medicaid can be about renewal/recertification, a benefits change, a loss of eligibility, missing documents, or a deadline. The deadline matters. Does the letter mention recertification, a benefits change, missing documents, or loss of eligibility?",
    responseEs: "Una carta de Medicaid puede ser sobre renovación/recertificación, cambio de beneficios, pérdida de elegibilidad, documentos faltantes o fecha límite. Es importante revisar la fecha límite. ¿La carta menciona recertificación, cambio de beneficios, documentos faltantes o pérdida de elegibilidad?",
    chips: ['Recertification', 'Benefits change', 'Missing documents', 'Loss of eligibility'],
    chipsEs: ['Recertificación', 'Cambio de beneficios', 'Documentos faltantes', 'Pérdida de elegibilidad'],
    needsFollowUp: true,
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: RENOVACIÓN / ANOC
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_renewal',
    intent: 'letter_issue',
    subtype: 'renewal',
    keywords: ['renovación', 'renovacion', 'renewal', 'recertification', 'anoc', 'eoc'],
    response: "I understand. A renewal letter can come from your Medicare plan, Part D, Medicaid, Extra Help, or it could be an annual change notice for next year. To help you correctly: does the letter say ANOC / Annual Notice of Change, EOC / Evidence of Coverage, Medicaid, Extra Help, renewal/recertification, or does it come from your plan?",
    responseEs: "Entiendo. Una carta de renovación puede ser del plan Medicare, Part D, Medicaid, Extra Help o un aviso de cambios para el próximo año. Para orientarlo bien: ¿la carta dice ANOC/Aviso Anual de Cambios, EOC/Evidencia de Cobertura, Medicaid, Extra Help, renewal/recertification, o viene de su plan?",
    chips: ['ANOC / EOC', 'Medicaid', 'Extra Help', 'From the plan', 'Not sure'],
    chipsEs: ['ANOC/EOC', 'Medicaid', 'Extra Help', 'Del plan', 'No sé'],
    needsFollowUp: true,
  },
  {
    id: 'case_anoc',
    intent: 'letter_issue',
    subtype: 'anoc',
    keywords: ['anoc', 'annual notice of change', 'aviso anual'],
    response: "ANOC (Annual Notice of Change) explains the changes to your plan for next year — premium, deductible, network, formulary, and extra benefits. You receive it every September. If you don't like the changes, you can switch plans during AEP (Oct 15 — Dec 7). A licensed advisor can compare options against your doctors and medications.",
    responseEs: "El ANOC (Aviso Anual de Cambios) explica los cambios de su plan para el próximo año — prima, deducible, red, formulario y beneficios extra. Lo recibe cada septiembre. Si no le gustan los cambios, puede cambiar de plan durante AEP (15 oct — 7 dic). Un asesor licenciado puede comparar opciones según sus doctores y medicamentos.",
    chips: ['Premium change', 'Network change', 'Drug change', 'Talk to advisor'],
    chipsEs: ['Cambio de prima', 'Cambio de red', 'Cambio de medicamentos', 'Hablar con asesor'],
  },
  {
    id: 'case_eoc',
    intent: 'letter_issue',
    subtype: 'eoc',
    keywords: ['eoc', 'evidence of coverage', 'evidencia de cobertura'],
    response: "The EOC (Evidence of Coverage) is the full plan rulebook — it spells out what is covered, copays, deductibles, network rules, prior authorization, appeals, and pharmacy details. It's a long document. If a specific section is unclear, a licensed advisor can walk through the part that affects you.",
    responseEs: "El EOC (Evidencia de Cobertura) es el reglamento completo del plan — detalla lo que está cubierto, copagos, deducibles, reglas de red, autorización previa, apelaciones y detalles de farmacia. Es un documento largo. Si hay una sección que no entiende, un asesor licenciado puede repasar la parte que le afecta.",
    chips: ['Coverage section', 'Costs section', 'Appeals section', 'Talk to advisor'],
    chipsEs: ['Sección de cobertura', 'Sección de costos', 'Sección de apelaciones', 'Hablar con asesor'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: EXTRA HELP / LIS NOTICE
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_extra_help_notice',
    intent: 'letter_issue',
    subtype: 'extra_help_notice',
    keywords: ['extra help', 'lis', 'low income subsidy', 'ayuda extra'],
    response: "An Extra Help / LIS notice usually comes from the Social Security Administration about the Part D drug subsidy. Eligibility is decided by SSA, not us. Please do not send your Medicare ID or Social Security number here. Does the notice say you were approved, denied, asked to re-apply, or that something changed?",
    responseEs: "Un aviso de Extra Help / LIS usualmente viene de la Administración del Seguro Social sobre el subsidio de medicamentos Parte D. La elegibilidad la decide SSA, no nosotros. Por favor no envíe su número de Medicare ni Seguro Social aquí. ¿El aviso dice que fue aprobado, denegado, que tiene que volver a solicitar, o que algo cambió?",
    chips: ['Approved', 'Denied', 'Re-apply', 'Something changed'],
    chipsEs: ['Aprobado', 'Denegado', 'Volver a solicitar', 'Algo cambió'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: PREMIUM NOTICE / IRMAA
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_premium_notice',
    intent: 'letter_issue',
    subtype: 'premium',
    keywords: ['premium', 'prima', 'irmaa', 'income adjustment', 'aumento de prima'],
    response: "A premium notice shows what the plan charges and when payment is due. The Part B premium can also be adjusted based on income (IRMAA), which is decided by the Social Security Administration. Please do not send your banking information here. Is the issue that the premium went up, you missed a payment, or you do not recognize the charge?",
    responseEs: "Un aviso de prima muestra lo que el plan cobra y cuándo es el pago. La prima de la Parte B también puede ajustarse según ingresos (IRMAA), lo cual lo decide la Administración del Seguro Social. Por favor no envíe su información bancaria aquí. ¿El problema es que la prima subió, no pagó a tiempo, o no reconoce el cobro?",
    chips: ['Premium went up', 'Missed payment', "Don't recognize charge"],
    chipsEs: ['Subió la prima', 'No pagué a tiempo', 'No reconozco el cobro'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: DENIAL
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_denial',
    intent: 'letter_issue',
    subtype: 'denial',
    keywords: ['denial', 'denied', 'rechazado', 'denegado'],
    response: "A denial notice should be reviewed carefully because it usually has an appeal deadline (often 60 days). Please do not send your Medicare ID or Social Security number here. A licensed advisor can help you organize the next step. Does the letter mention an appeal deadline, a reason for the denial, or instructions on what to do next?",
    responseEs: "Un aviso de denegación debe revisarse con cuidado porque usualmente tiene un plazo para apelar (a menudo 60 días). Por favor no envíe su número de Medicare ni Seguro Social aquí. Un asesor licenciado puede ayudar a organizar el próximo paso. ¿La carta menciona una fecha límite para apelar, una razón de la denegación, o instrucciones de qué hacer?",
    chips: ['Has appeal deadline', 'Has reason', 'Need help with appeal', 'Talk to advisor'],
    chipsEs: ['Tiene plazo de apelación', 'Tiene razón', 'Necesito ayuda con apelación', 'Hablar con asesor'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: APPEAL PROCESS
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_appeal',
    intent: 'appeals_grievance',
    keywords: ['appeal', 'apelación', 'reconsideration', 'fair hearing', 'grievance', 'reclamo'],
    response: "If coverage or a medication was denied, you have the right to appeal — usually 60 days from the denial date. Steps: 1) Request reconsideration from your plan, 2) If denied again, request independent review (the next level depends on which part of Medicare). A representative or licensed advisor can help. SHIP also offers free counseling — your state's SHIP number is on Medicare.gov.",
    responseEs: "Si le negaron cobertura o un medicamento, tiene derecho a apelar — usualmente 60 días desde la fecha de denegación. Pasos: 1) Solicite reconsideración a su plan, 2) Si lo niegan otra vez, solicite revisión independiente (el siguiente nivel depende de qué parte de Medicare). Un representante o asesor licenciado puede ayudar. SHIP también ofrece consejería gratuita — el número de SHIP de su estado está en Medicare.gov.",
    chips: ['Help with appeal', 'Get a representative', 'Expedited (urgent)', 'Talk to advisor'],
    chipsEs: ['Ayuda con apelación', 'Obtener representante', 'Expedita (urgente)', 'Hablar con asesor'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: COMPLAINT
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_complaint',
    intent: 'complaint',
    keywords: ['complaint', 'queja', 'unhappy', 'molesto', 'frustrated with plan'],
    response: "I'm sorry you had a bad experience. To file a formal complaint (called a 'grievance'), you can call 1-800-MEDICARE or contact your plan. Do you want help documenting the complaint, or would you rather a licensed advisor review your situation first?",
    responseEs: "Lamento que haya tenido una mala experiencia. Para presentar una queja formal (llamada 'reclamo' o 'grievance'), puede llamar al 1-800-MEDICARE o contactar a su plan. ¿Quiere ayuda para documentar la queja, o prefiere que un asesor licenciado revise su situación primero?",
    chips: ['Help with complaint', 'Talk to advisor', '1-800-MEDICARE', 'Something else'],
    chipsEs: ['Ayuda con queja', 'Hablar con asesor', '1-800-MEDICARE', 'Otra cosa'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: "QUIERO CAMBIAR PLAN"
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_change_plan',
    intent: 'disenrollment_question',
    keywords: ['change plan', 'switch plan', 'cambiar plan', 'cambiar de plan', 'cancel plan', 'cancelar plan'],
    response: "I can help organize this, but I should not tell you to change plans without a careful review. Before any change you should verify doctors, medications, pharmacy, county, current coverage, and whether you have Medicaid, Extra Help, union/retiree benefits, or pending treatment. What is the biggest concern: doctors, medications, costs, benefits, or a letter you received?",
    responseEs: "Puedo orientarle, pero no debo decirle que cambie de plan sin una revisión. Antes de cualquier cambio hay que verificar doctores, medicamentos, farmacia, condado, cobertura actual y si tiene Medicaid, Extra Help, unión/retiro o tratamiento pendiente. ¿Qué le preocupa más: doctores, medicamentos, costos, beneficios o una carta que recibió?",
    chips: ['Doctors', 'Medications', 'Costs', 'Benefits', 'A letter'],
    chipsEs: ['Doctores', 'Medicamentos', 'Costos', 'Beneficios', 'Una carta'],
    needsFollowUp: true,
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: "CUÁL ES EL MEJOR PLAN"
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_best_plan',
    intent: 'coverage_question',
    keywords: ['best plan', 'mejor plan', 'top plan', 'which plan'],
    response: "I cannot say a plan is 'the best' without reviewing your situation. The right comparison depends on your doctors, medications, county, pharmacy, costs, benefits, and current coverage. What matters most to you?",
    responseEs: "No debo decir que un plan es 'el mejor' sin revisar su situación. La comparación correcta depende de sus doctores, medicamentos, condado, farmacia, costos, beneficios y cobertura actual. ¿Qué es lo más importante para usted?",
    chips: ['Doctors', 'Medications', 'Costs', 'Benefits', 'Current coverage'],
    chipsEs: ['Doctores', 'Medicamentos', 'Costos', 'Beneficios', 'Cobertura actual'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // SAWIL CASE: "ME PUEDES INSCRIBIR AHORA"
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'case_enroll_now',
    intent: 'enrollment_question',
    keywords: ['enroll me', 'inscribir', 'inscribame', 'sign me up'],
    response: "I can help you organize the information, but the enrollment has to be reviewed by a licensed advisor before moving forward. First we have to confirm the plan makes sense for your doctors, medications, county, and current coverage. Would you like an advisor to call you?",
    responseEs: "Yo puedo ayudarle a organizar la información, pero la inscripción debe revisarla un asesor licenciado antes de avanzar. Primero hay que confirmar que el plan tenga sentido para sus doctores, medicamentos, condado y cobertura actual. ¿Quiere que un asesor le llame?",
    chips: ['Yes, call me', 'I have questions first', 'Not right now'],
    chipsEs: ['Sí, llamarme', 'Primero tengo preguntas', 'No ahora'],
  },

  // ─────────────────────────────────────────────────────────────────────
  // GENERAL MEDICARE KNOWLEDGE — kept compliance-safe (no year-specific dollars)
  // ─────────────────────────────────────────────────────────────────────
  {
    id: 'kb_original_medicare',
    intent: 'coverage_question',
    keywords: ['original medicare', 'part a', 'part b'],
    response: "Original Medicare (Part A hospital + Part B medical) covers hospital stays, doctor visits, lab tests, surgeries, and preventive care. It does not cover most dental, vision, hearing aids, long-term care, or prescription drugs (you need Part D for those). A licensed advisor can review whether a supplement or Advantage plan fits your situation.",
    responseEs: "Medicare Original (Parte A hospital + Parte B médico) cubre estadías hospitalarias, visitas al médico, pruebas de laboratorio, cirugías y cuidado preventivo. No cubre la mayoría de dental, visión, audífonos, cuidado a largo plazo ni medicamentos recetados (necesita Parte D para eso). Un asesor licenciado puede revisar si un suplemento o plan Advantage le conviene.",
    chips: ['What about Advantage?', 'Need a supplement?', 'Add drug coverage'],
    chipsEs: ['¿Qué hay de Advantage?', '¿Necesito suplemento?', 'Agregar cobertura de medicamentos'],
  },
  {
    id: 'kb_advantage',
    intent: 'coverage_question',
    keywords: ['medicare advantage', 'part c', 'advantage plan'],
    response: "Medicare Advantage (Part C) is offered by private plans approved by Medicare. Plans must cover everything Original Medicare covers, and many include Part D drugs, dental, vision, and hearing. Most have networks (HMO/PPO) and an annual out-of-pocket maximum. A licensed advisor can review which options fit your doctors, medications, and county.",
    responseEs: "Medicare Advantage (Parte C) lo ofrecen planes privados aprobados por Medicare. Los planes deben cubrir todo lo que cubre Medicare Original, y muchos incluyen medicamentos Parte D, dental, visión y audición. La mayoría tienen redes (HMO/PPO) y un límite máximo anual de gastos. Un asesor licenciado puede revisar qué opciones le convienen según sus doctores, medicamentos y condado.",
    chips: ['Compare with Original', 'Network questions', 'Enrollment periods'],
    chipsEs: ['Comparar con Original', 'Red', 'Períodos de inscripción'],
  },
  {
    id: 'kb_part_d',
    intent: 'drug_question',
    keywords: ['part d', 'parte d', 'drug plan'],
    response: "Part D is the prescription-drug part of Medicare. Costs depend on the plan's formulary, drug tier, deductible, pharmacy, and any prior authorization rules. The exact amounts change year by year and should be verified with the plan or a licensed advisor before any decision.",
    responseEs: "La Parte D es la parte de medicamentos recetados de Medicare. Los costos dependen del formulario del plan, el nivel del medicamento, el deducible, la farmacia y reglas de autorización previa. Los montos exactos cambian año tras año y deben verificarse con el plan o un asesor licenciado antes de cualquier decisión.",
    chips: ['Drug not covered', 'Prior auth', 'Cost too high', 'Talk to advisor'],
    chipsEs: ['Medicamento no cubierto', 'Autorización previa', 'Costo muy alto', 'Hablar con asesor'],
  },
  {
    id: 'kb_iep',
    intent: 'enrollment_question',
    keywords: ['turning 65', 'cumplir 65', 'iep', 'initial enrollment'],
    response: "Your Initial Enrollment Period (IEP) is 7 months: 3 months before, the month of, and 3 months after your 65th birthday month. You can sign up for Part A (free if you worked 10+ years), Part B, and Part D or Medicare Advantage. A licensed advisor can compare your options before you decide.",
    responseEs: "Su Período de Inscripción Inicial (IEP) es de 7 meses: 3 meses antes, el mes de, y 3 meses después de su mes de cumpleaños 65. Puede inscribirse en la Parte A (gratis si trabajó 10+ años), Parte B, y Parte D o Medicare Advantage. Un asesor licenciado puede comparar opciones antes de decidir.",
    chips: ['What if I miss IEP?', 'Do I need Part B?', 'I have employer insurance'],
    chipsEs: ['¿Qué si pierdo IEP?', '¿Necesito Parte B?', 'Tengo seguro del trabajo'],
  },
  {
    id: 'kb_aep',
    intent: 'enrollment_question',
    keywords: ['aep', 'annual enrollment', 'open enrollment'],
    response: "The Annual Enrollment Period (AEP) runs October 15 through December 7 each year. Changes take effect January 1. You can switch Advantage plans, switch from Original to Advantage or back, or change Part D plans. Outside AEP you may need a Special Enrollment Period.",
    responseEs: "El Período de Inscripción Anual (AEP) es del 15 de octubre al 7 de diciembre cada año. Los cambios entran en vigor el 1 de enero. Puede cambiar planes Advantage, cambiar de Original a Advantage o viceversa, o cambiar planes Parte D. Fuera de AEP puede necesitar un Período Especial.",
    chips: ['Medicare Advantage OEP?', 'Special Enrollment Periods', 'Talk to advisor'],
    chipsEs: ['¿OEP de Advantage?', 'Períodos Especiales', 'Hablar con asesor'],
  },
  {
    id: 'kb_provider_network',
    intent: 'provider_question',
    keywords: ['doctor', 'doctora', 'provider', 'specialist', 'network', 'red'],
    response: "I should not say whether a doctor is covered without verification — networks vary by plan, county, and can change. A licensed advisor or the plan itself can confirm if a doctor is in network. Is this about a primary doctor, a specialist, a hospital, or pharmacy?",
    responseEs: "No debo decir si un doctor está cubierto sin verificación — las redes varían por plan, condado y pueden cambiar. Un asesor licenciado o el plan mismo puede confirmar si un doctor está en la red. ¿Se trata de un doctor primario, un especialista, un hospital o farmacia?",
    chips: ['Primary doctor', 'Specialist', 'Hospital', 'Pharmacy'],
    chipsEs: ['Doctor primario', 'Especialista', 'Hospital', 'Farmacia'],
  },
];

export default customerServiceKnowledge;

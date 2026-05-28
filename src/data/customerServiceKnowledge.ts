/**
 * Customer Service Bot — Knowledge Base (P0 set)
 *
 * Educational responses the bot may surface when a user asks a general Medicare
 * question. Each entry is short (2-3 sentences), senior-friendly, and
 * compliance-safe.
 *
 * STRICT RULES (every entry must pass):
 *   - NO recommendation language ("best plan", "you should pick X")
 *   - NO eligibility claims ("you qualify", "you are eligible")
 *   - NO benefit confirmation ("your plan covers X", "your doctor is in network")
 *   - NO savings promises ("you will save $X", "guaranteed savings")
 *   - NO Medicare/CMS/government identity ("we are Medicare", "as your CMS rep")
 *   - YES general education
 *   - YES "verify with your plan or a licensed advisor"
 *   - YES links to existing site pages (/extra-help, /help-paying-costs, /otc-benefits, /resources)
 *
 * P0 set covers the most common general questions. Phase 6 will expand this to
 * ~80-150 entries.
 */

import type { IntentId } from './customerServiceIntents';

export interface KnowledgeEntry {
  id: string;
  /** Intent this entry helps answer. 'general' = surfaced for general questions. */
  intent_id: IntentId | 'general';
  title_en: string;
  title_es: string;
  /** 2-3 sentences, senior-friendly. */
  short_en: string;
  short_es: string;
  /** Internal link to existing site page (already approved + live). */
  link_internal: string | null;
  /** External link to government resource. */
  link_external: string | null;
  /** Whether the bot must add a "verify with a licensed advisor" disclaimer when surfacing this. */
  must_warn_no_recommendation: boolean;
  /** Whether the bot must add a "final eligibility determined by [agency]" disclaimer. */
  must_warn_no_eligibility: boolean;
}

export const KNOWLEDGE: KnowledgeEntry[] = [
  // ── MEDICARE BASICS ──
  {
    id: 'medicare-basics-part-a',
    intent_id: 'general_medicare_question',
    title_en: 'What is Medicare Part A?',
    title_es: '¿Qué es Medicare Parte A?',
    short_en: 'Medicare Part A is the hospital coverage portion of Original Medicare. It generally helps pay for inpatient hospital stays, skilled nursing facility care, hospice, and some home health care. Most people pay no premium for Part A if they or their spouse paid Medicare taxes long enough while working.',
    short_es: 'Medicare Parte A es la cobertura hospitalaria del Medicare Original. Generalmente ayuda a pagar estancias hospitalarias, cuidado en centros de enfermería especializada, hospicio y algunos cuidados de salud en casa. La mayoría de las personas no paga prima por Parte A si ellos o su cónyuge pagaron impuestos de Medicare lo suficiente mientras trabajaban.',
    link_internal: '/resources',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },
  {
    id: 'medicare-basics-part-b',
    intent_id: 'general_medicare_question',
    title_en: 'What is Medicare Part B?',
    title_es: '¿Qué es Medicare Parte B?',
    short_en: 'Medicare Part B is the medical coverage portion of Original Medicare. It generally helps pay for doctor visits, outpatient services, preventive care, and durable medical equipment. Part B has a monthly premium that most people pay.',
    short_es: 'Medicare Parte B es la cobertura médica del Medicare Original. Generalmente ayuda a pagar consultas médicas, servicios ambulatorios, cuidado preventivo y equipo médico duradero. Parte B tiene una prima mensual que la mayoría de las personas paga.',
    link_internal: '/resources',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },
  {
    id: 'medicare-basics-part-c',
    intent_id: 'general_medicare_question',
    title_en: 'What is Medicare Part C (Medicare Advantage)?',
    title_es: '¿Qué es Medicare Parte C (Medicare Advantage)?',
    short_en: 'Medicare Part C, also called Medicare Advantage, is an alternative to Original Medicare offered by private insurance companies approved by Medicare. These plans bundle Parts A and B and often include Part D drug coverage and extra benefits. Plan availability, costs, networks, and benefits vary by carrier, county, and plan year.',
    short_es: 'Medicare Parte C, también llamada Medicare Advantage, es una alternativa al Medicare Original ofrecida por aseguradoras privadas aprobadas por Medicare. Estos planes combinan las Partes A y B y a menudo incluyen cobertura de medicamentos de Parte D y beneficios adicionales. La disponibilidad de planes, costos, redes y beneficios varían por aseguradora, condado y año del plan.',
    link_internal: '/medicare-advantage',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },
  {
    id: 'medicare-basics-part-d',
    intent_id: 'general_medicare_question',
    title_en: 'What is Medicare Part D?',
    title_es: '¿Qué es Medicare Parte D?',
    short_en: 'Medicare Part D is the prescription drug coverage portion of Medicare. It is offered by private insurance companies approved by Medicare. What each plan covers (the "formulary"), pharmacy network, and costs vary by plan and may change each year.',
    short_es: 'Medicare Parte D es la cobertura de medicamentos recetados de Medicare. Es ofrecida por aseguradoras privadas aprobadas por Medicare. Lo que cubre cada plan (el "formulario"), la red de farmacias y los costos varían por plan y pueden cambiar cada año.',
    link_internal: '/part-d',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },
  {
    id: 'medicare-basics-medigap',
    intent_id: 'general_medicare_question',
    title_en: 'What is Medicare Supplement (Medigap)?',
    title_es: '¿Qué es Medicare Supplement (Medigap)?',
    short_en: 'Medicare Supplement, also called Medigap, is private insurance that works alongside Original Medicare to help cover out-of-pocket costs like copays, coinsurance, and deductibles. Medigap plans are standardized by letter (Plan A, G, N, etc.) but premiums vary by carrier and state.',
    short_es: 'Medicare Supplement, también llamado Medigap, es un seguro privado que trabaja junto al Medicare Original para ayudar a cubrir costos de bolsillo como copagos, coseguro y deducibles. Los planes Medigap están estandarizados por letra (Plan A, G, N, etc.) pero las primas varían por aseguradora y estado.',
    link_internal: '/medicare-supplement',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },

  // ── ENROLLMENT PERIODS ──
  {
    id: 'enrollment-aep',
    intent_id: 'annual_review',
    title_en: 'Annual Enrollment Period (AEP)',
    title_es: 'Período de Inscripción Anual (AEP)',
    short_en: 'AEP runs each year from October 15 through December 7. During AEP, people with Medicare can join, switch, or drop a Medicare Advantage plan or a Part D drug plan for coverage that starts January 1 of the following year.',
    short_es: 'El AEP es cada año del 15 de octubre al 7 de diciembre. Durante el AEP, las personas con Medicare pueden inscribirse, cambiar o cancelar un plan Medicare Advantage o un plan de medicamentos de Parte D para cobertura que empieza el 1 de enero del año siguiente.',
    link_internal: '/#annual-review',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },
  {
    id: 'enrollment-iep',
    intent_id: 'new_to_medicare',
    title_en: 'Initial Enrollment Period (IEP)',
    title_es: 'Período de Inscripción Inicial (IEP)',
    short_en: 'IEP is the 7-month window when most people first sign up for Medicare. It usually starts 3 months before the month you turn 65, includes the month of your 65th birthday, and ends 3 months after. Missing your IEP can lead to late-enrollment penalties.',
    short_es: 'El IEP es la ventana de 7 meses cuando la mayoría de las personas se inscribe por primera vez en Medicare. Usualmente empieza 3 meses antes del mes en que cumple 65, incluye el mes de su cumpleaños 65, y termina 3 meses después. Perder su IEP puede causar multas por inscripción tardía.',
    link_internal: '/#annual-review',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },
  {
    id: 'enrollment-sep',
    intent_id: 'general_medicare_question',
    title_en: 'Special Enrollment Period (SEP)',
    title_es: 'Período de Inscripción Especial (SEP)',
    short_en: 'A Special Enrollment Period lets some people make Medicare changes outside the usual windows because of specific life events — for example, moving, losing other coverage, or qualifying for Medicaid or Extra Help. SEP rules are specific; a licensed advisor or Medicare can confirm whether a SEP applies.',
    short_es: 'Un Período de Inscripción Especial permite a algunas personas hacer cambios en Medicare fuera de las ventanas usuales por eventos específicos de vida — por ejemplo, mudarse, perder otra cobertura, o calificar para Medicaid o Ayuda Extra. Las reglas del SEP son específicas; un asesor licenciado o Medicare puede confirmar si un SEP aplica.',
    link_internal: null,
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },

  // ── EXTRA HELP / LIS ──
  {
    id: 'extra-help-overview',
    intent_id: 'extra_help_lis',
    title_en: 'Extra Help / LIS Overview',
    title_es: 'Resumen de Ayuda Extra / LIS',
    short_en: 'Extra Help (Low-Income Subsidy or LIS) is a federal program that may reduce Medicare Part D prescription drug costs — premiums, deductibles, and copays — for people who qualify. Eligibility is determined by the Social Security Administration based on income and resources.',
    short_es: 'Ayuda Extra (Subsidio de Bajo Ingreso o LIS) es un programa federal que puede reducir los costos de medicamentos recetados de Medicare Parte D — primas, deducibles y copagos — para personas que califican. La elegibilidad la determina la Administración del Seguro Social basada en ingresos y recursos.',
    link_internal: '/extra-help',
    link_external: 'https://www.ssa.gov/medicare/part-d-extra-help',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },

  // ── MEDICAID / MSP ──
  {
    id: 'msp-overview',
    intent_id: 'medicaid_msp',
    title_en: 'Medicare Savings Programs (MSP)',
    title_es: 'Programas de Ahorro de Medicare (MSP)',
    short_en: 'Medicare Savings Programs are state-administered programs that may help pay some Medicare costs — including Part B premiums and sometimes deductibles and coinsurance — for people who qualify. Eligibility is determined by the state Medicaid agency and varies by state.',
    short_es: 'Los Programas de Ahorro de Medicare son programas administrados por el estado que pueden ayudar a pagar algunos costos de Medicare — incluyendo primas de Parte B y a veces deducibles y coseguro — para personas que califican. La elegibilidad la determina la agencia estatal de Medicaid y varía por estado.',
    link_internal: '/help-paying-costs',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },
  {
    id: 'medicaid-coordination',
    intent_id: 'medicaid_msp',
    title_en: 'Medicaid + Medicare Coordination',
    title_es: 'Coordinación Medicaid + Medicare',
    short_en: 'Some people have both Medicare and Medicaid ("dual eligible"). Plan changes can affect Medicaid benefits in ways that are not always obvious — Medicaid is administered separately and has its own rules. A licensed advisor should review the situation before any plan change.',
    short_es: 'Algunas personas tienen tanto Medicare como Medicaid ("doble elegibilidad"). Los cambios de plan pueden afectar los beneficios de Medicaid de formas que no siempre son obvias — Medicaid se administra por separado y tiene sus propias reglas. Un asesor licenciado debe revisar la situación antes de cualquier cambio de plan.',
    link_internal: '/help-paying-costs',
    link_external: null,
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: true,
  },

  // ── PART D & MEDICATIONS ──
  {
    id: 'partd-formulary',
    intent_id: 'medication_help',
    title_en: 'Drug Formularies',
    title_es: 'Formularios de Medicamentos',
    short_en: 'Each Medicare Part D and Medicare Advantage plan has a "formulary" — the list of drugs the plan covers. Formularies vary by plan and can change each year. Whether a specific drug is covered, at what cost, and with what restrictions (like prior authorization) is determined by the specific plan\'s formulary.',
    short_es: 'Cada plan de Medicare Parte D y Medicare Advantage tiene un "formulario" — la lista de medicamentos que el plan cubre. Los formularios varían por plan y pueden cambiar cada año. Si un medicamento específico está cubierto, a qué costo y con qué restricciones (como autorización previa) lo determina el formulario del plan específico.',
    link_internal: '/part-d',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },
  {
    id: 'prior-auth',
    intent_id: 'medication_help',
    title_en: 'Prior Authorization, Step Therapy, Quantity Limits',
    title_es: 'Autorización Previa, Terapia Escalonada, Límites de Cantidad',
    short_en: 'Some plans require prior authorization (advance approval), step therapy (try one drug before another), or quantity limits on certain medications. Whether these apply to a specific drug, and how to request an exception, is set by the specific plan. A licensed advisor can help organize the request.',
    short_es: 'Algunos planes requieren autorización previa (aprobación por adelantado), terapia escalonada (probar un medicamento antes que otro), o límites de cantidad en ciertos medicamentos. Si esto aplica a un medicamento específico, y cómo solicitar una excepción, lo establece el plan específico. Un asesor licenciado puede ayudar a organizar la solicitud.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },

  // ── DOCTORS / NETWORK ──
  {
    id: 'network-overview',
    intent_id: 'doctor_network_question',
    title_en: 'Provider Networks',
    title_es: 'Redes de Proveedores',
    short_en: 'Medicare Advantage plans typically have networks of doctors, hospitals, and other providers. Whether a specific provider is in network for a specific plan can only be confirmed by the plan or by the provider directly. Networks can change at any time during the year.',
    short_es: 'Los planes Medicare Advantage típicamente tienen redes de doctores, hospitales y otros proveedores. Si un proveedor específico está en la red de un plan específico solo lo puede confirmar el plan o el proveedor directamente. Las redes pueden cambiar en cualquier momento durante el año.',
    link_internal: '/medicare-advantage',
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },

  // ── OTC ──
  {
    id: 'otc-overview',
    intent_id: 'otc_question',
    title_en: 'OTC (Over-the-Counter) Benefits',
    title_es: 'Beneficios OTC (Sin Receta)',
    short_en: 'Some Medicare Advantage plans may include an Over-the-Counter benefit that helps pay for certain plan-approved health items that do not require a prescription. OTC availability, amount, frequency, allowed products, and where it can be used vary by plan, county, state, eligibility, and plan year.',
    short_es: 'Algunos planes Medicare Advantage pueden incluir un beneficio OTC que ayuda a pagar ciertos artículos de salud aprobados por el plan que no requieren receta. La disponibilidad, monto, frecuencia, productos permitidos y dónde se puede usar el OTC varían por plan, condado, estado, elegibilidad y año del plan.',
    link_internal: '/otc-benefits',
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── LETTERS / NOTICES ──
  {
    id: 'letter-overview',
    intent_id: 'plan_letter_issue',
    title_en: 'Letters from Your Plan or Medicare',
    title_es: 'Cartas de Su Plan o de Medicare',
    short_en: 'Letters from Medicare or your plan often include important deadlines and may affect coverage. Common letters include the Annual Notice of Change (ANOC), Evidence of Coverage (EOC), and Notice of Denial. A licensed advisor should review any letter that mentions deadlines, denials, or plan changes.',
    short_es: 'Las cartas de Medicare o de su plan a menudo incluyen fechas importantes y pueden afectar la cobertura. Cartas comunes incluyen el Aviso Anual de Cambios (ANOC), Evidencia de Cobertura (EOC) y Aviso de Denegación. Un asesor licenciado debe revisar cualquier carta que mencione plazos, denegaciones o cambios de plan.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── BENEFIT CARDS ──
  {
    id: 'benefit-card-overview',
    intent_id: 'benefit_card_issue',
    title_en: 'Benefit / Flex Cards',
    title_es: 'Tarjetas de Beneficios / Flex',
    short_en: 'Some Medicare Advantage plans issue benefit cards (sometimes called OTC cards, flex cards, or grocery cards) for plan-approved purchases. Rules about what the card can buy, where, and how the allowance renews vary by plan. Card issues are usually handled by the plan that issued the card.',
    short_es: 'Algunos planes Medicare Advantage emiten tarjetas de beneficios (a veces llamadas tarjetas OTC, tarjetas flex o tarjetas de comida) para compras aprobadas por el plan. Las reglas sobre qué puede comprar la tarjeta, dónde y cómo se renueva la asignación varían por plan. Los problemas con tarjetas usualmente los maneja el plan que emitió la tarjeta.',
    link_internal: '/otc-benefits',
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── WHEN TO CALL WHOM ──
  {
    id: 'when-to-call-medicare',
    intent_id: 'general',
    title_en: 'When to Call Medicare (1-800-MEDICARE)',
    title_es: 'Cuándo Llamar a Medicare (1-800-MEDICARE)',
    short_en: 'Call 1-800-MEDICARE (1-800-633-4227) for general Medicare information, to update your records with Medicare, to report fraud, or to get information about all of your plan options. Medicare\'s line is available 24 hours a day, 7 days a week.',
    short_es: 'Llame al 1-800-MEDICARE (1-800-633-4227) para información general de Medicare, para actualizar sus registros con Medicare, para reportar fraude o para obtener información sobre todas sus opciones de planes. La línea de Medicare está disponible las 24 horas, 7 días a la semana.',
    link_internal: null,
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },
  {
    id: 'when-to-call-carrier',
    intent_id: 'general',
    title_en: 'When to Call Your Plan/Carrier',
    title_es: 'Cuándo Llamar a Su Plan/Aseguradora',
    short_en: 'Call your plan or carrier directly (the phone number is on your member ID card) for questions about whether a specific drug is covered, whether a specific provider is in network, the status of a claim, or to report a card not working.',
    short_es: 'Llame directamente a su plan o aseguradora (el número de teléfono está en su tarjeta de miembro) para preguntas sobre si un medicamento específico está cubierto, si un proveedor específico está en la red, el estado de un reclamo, o para reportar una tarjeta que no funciona.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },
  {
    id: 'when-to-call-advisor',
    intent_id: 'general',
    title_en: 'When to Speak with a Licensed Advisor',
    title_es: 'Cuándo Hablar con un Asesor Licenciado',
    short_en: 'A licensed Medicare advisor can help review your options when you are new to Medicare, considering a plan change, comparing Medicare Advantage vs Original Medicare + Medigap, navigating Extra Help or Medicaid coordination, or interpreting a letter. ClearPoint Senior Advisors is an independent agency.',
    short_es: 'Un asesor licenciado de Medicare puede ayudar a revisar sus opciones cuando es nuevo en Medicare, está considerando un cambio de plan, comparando Medicare Advantage vs Medicare Original + Medigap, navegando Ayuda Extra o coordinación de Medicaid, o interpretando una carta. ClearPoint Senior Advisors es una agencia independiente.',
    link_internal: '/contact',
    link_external: null,
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },

  // ── COVERAGE LOSS ──
  {
    id: 'coverage-loss-overview',
    intent_id: 'possible_loss_of_coverage',
    title_en: 'If You Lost Coverage',
    title_es: 'Si Perdió la Cobertura',
    short_en: 'Losing Medicare-related coverage can trigger a Special Enrollment Period (SEP) that lets you make changes outside the usual windows. The exact SEP rules depend on what kind of coverage was lost and how. A licensed advisor should review this quickly because SEPs are time-limited.',
    short_es: 'Perder cobertura relacionada con Medicare puede activar un Período de Inscripción Especial (SEP) que le permite hacer cambios fuera de las ventanas usuales. Las reglas exactas del SEP dependen del tipo de cobertura que se perdió y cómo. Un asesor licenciado debe revisar esto rápido porque los SEP tienen tiempo limitado.',
    link_internal: null,
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },

  // ── COST HELP ──
  {
    id: 'cost-help-overview',
    intent_id: 'cost_help',
    title_en: 'Programs That May Help with Medicare Costs',
    title_es: 'Programas Que Pueden Ayudar con Costos de Medicare',
    short_en: 'Several federal and state programs may help reduce Medicare costs — including Medicare Savings Programs (MSP), Medicaid, Extra Help / LIS for prescription drugs, and State Pharmaceutical Assistance Programs (SPAP). Each has different eligibility rules and a licensed advisor can help identify which may apply.',
    short_es: 'Varios programas federales y estatales pueden ayudar a reducir los costos de Medicare — incluyendo Programas de Ahorro de Medicare (MSP), Medicaid, Ayuda Extra / LIS para medicamentos recetados y Programas Estatales de Asistencia Farmacéutica (SPAP). Cada uno tiene reglas de elegibilidad distintas y un asesor licenciado puede ayudar a identificar cuáles pueden aplicar.',
    link_internal: '/help-paying-costs',
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },

  // ── CLEARPOINT IDENTITY ──
  {
    id: 'about-clearpoint',
    intent_id: 'general',
    title_en: 'About ClearPoint Senior Advisors',
    title_es: 'Acerca de ClearPoint Senior Advisors',
    short_en: 'ClearPoint Senior Advisors is an independent insurance agency. We are not affiliated with Medicare, CMS, or the U.S. government. We help review Medicare options with licensed advisors — bilingual (English and Spanish), no pressure, no cost to you for our services.',
    short_es: 'ClearPoint Senior Advisors es una agencia de seguros independiente. No estamos afiliados con Medicare, CMS ni el gobierno de los Estados Unidos. Ayudamos a revisar opciones de Medicare con asesores licenciados — bilingüe (inglés y español), sin presión, sin costo para usted por nuestros servicios.',
    link_internal: '/about',
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── PRIVACY / SENSITIVE INFO ──
  {
    id: 'privacy-warning',
    intent_id: 'general',
    title_en: 'About Sharing Information',
    title_es: 'Sobre Compartir Información',
    short_en: 'Please do not share your Medicare ID, Social Security number, banking information, claim numbers, or detailed medical records through this chat. Those details should only be shared in secure channels with a licensed advisor.',
    short_es: 'Por favor no comparta su número de Medicare, número de Seguro Social, información bancaria, números de reclamos ni récords médicos detallados a través de este chat. Esos detalles solo deben compartirse en canales seguros con un asesor licenciado.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── EMERGENCY ──
  {
    id: 'emergency-disclaimer',
    intent_id: 'general',
    title_en: 'Emergency Notice',
    title_es: 'Aviso de Emergencia',
    short_en: 'This chat is not for emergencies. If you are having a medical emergency, please call 911 or go to your nearest emergency room.',
    short_es: 'Este chat no es para emergencias. Si tiene una emergencia médica, por favor llame al 911 o vaya a la sala de emergencias más cercana.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── APPOINTMENT FLOW ──
  {
    id: 'appointment-process',
    intent_id: 'appointment_requested',
    title_en: 'Scheduling an Appointment',
    title_es: 'Agendar una Cita',
    short_en: 'A licensed ClearPoint advisor will reach out by phone to schedule. The advisor is bilingual (English and Spanish), licensed in NY, NJ, CT, and FL, and there is no cost to you for the consultation.',
    short_es: 'Un asesor licenciado de ClearPoint se comunicará por teléfono para agendar. El asesor es bilingüe (inglés y español), licenciado en NY, NJ, CT y FL, y no hay costo para usted por la consulta.',
    link_internal: '/contact',
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },

  // ── ADDITIONAL P1 ENTRIES (Wave 7 Layer 3) ──
  {
    id: 'annual-notice-of-change',
    intent_id: 'plan_letter_issue',
    title_en: 'Annual Notice of Change (ANOC)',
    title_es: 'Aviso Anual de Cambios (ANOC)',
    short_en: 'The Annual Notice of Change (ANOC) is a letter your Medicare Advantage or Part D plan sends every fall (usually by September 30). It describes how the plan will change for the next year — premiums, copays, formulary, network, and benefits. A licensed advisor should review the ANOC with you before the Annual Enrollment Period.',
    short_es: 'El Aviso Anual de Cambios (ANOC) es una carta que su plan Medicare Advantage o Parte D envía cada otoño (usualmente para el 30 de septiembre). Describe cómo cambiará el plan para el próximo año — primas, copagos, formulario, red y beneficios. Un asesor licenciado debe revisar el ANOC con usted antes del Período de Inscripción Anual.',
    link_internal: null,
    link_external: 'https://www.medicare.gov',
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: false,
  },
  {
    id: 'spap-overview',
    intent_id: 'cost_help',
    title_en: 'State Pharmaceutical Assistance Programs (SPAP)',
    title_es: 'Programas Estatales de Asistencia Farmacéutica (SPAP)',
    short_en: 'Some states have programs that may help pay for prescription drugs in addition to Medicare Part D — for example, New York has EPIC, and New Jersey has PAAD. Eligibility, benefits, and how to apply vary by state. A licensed advisor can help review what may be available in your state.',
    short_es: 'Algunos estados tienen programas que pueden ayudar a pagar medicamentos recetados además de Medicare Parte D — por ejemplo, Nueva York tiene EPIC, y Nueva Jersey tiene PAAD. La elegibilidad, los beneficios y cómo solicitarlo varían por estado. Un asesor licenciado puede ayudar a revisar lo que podría estar disponible en su estado.',
    link_internal: '/help-paying-costs',
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: true,
  },
  {
    id: 'employer-union-retiree-warning',
    intent_id: 'general_medicare_question',
    title_en: 'Employer, Union, Retiree, VA, or TRICARE Benefits',
    title_es: 'Beneficios de Empleador, Unión, Retiro, VA o TRICARE',
    short_en: 'If you have coverage through an employer, union, retiree plan, the VA, or TRICARE, changing or adding a Medicare plan can affect those benefits in ways that are not always obvious. Some retiree plans can be lost permanently after a change. A licensed advisor should review your situation before any plan change.',
    short_es: 'Si tiene cobertura a través de un empleador, unión, plan de retiro, VA o TRICARE, cambiar o agregar un plan de Medicare puede afectar esos beneficios de formas que no siempre son obvias. Algunos planes de retiro se pueden perder permanentemente después de un cambio. Un asesor licenciado debe revisar su situación antes de cualquier cambio de plan.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: true,
    must_warn_no_eligibility: true,
  },
  {
    id: 'billing-premium-issue',
    intent_id: 'cost_help',
    title_en: 'Billing and Premium Issues',
    title_es: 'Problemas de Facturación y Primas',
    short_en: 'Billing and premium issues are usually handled by the plan that bills you (the carrier) or by Social Security if Part B premiums are deducted from your benefits. A licensed advisor can help you understand which entity to contact and what information you may need.',
    short_es: 'Los problemas de facturación y primas usualmente los maneja el plan que le factura (la aseguradora) o el Seguro Social si las primas de Parte B se descuentan de sus beneficios. Un asesor licenciado puede ayudarle a entender a qué entidad contactar y qué información puede necesitar.',
    link_internal: null,
    link_external: null,
    must_warn_no_recommendation: false,
    must_warn_no_eligibility: false,
  },
];

/** Look up the first knowledge entry that matches an intent. */
export function getKnowledgeByIntent(intentId: IntentId | 'general'): KnowledgeEntry | null {
  return KNOWLEDGE.find((e) => e.intent_id === intentId) || null;
}

/** Look up all knowledge entries for an intent. */
export function getAllKnowledgeByIntent(intentId: IntentId | 'general'): KnowledgeEntry[] {
  return KNOWLEDGE.filter((e) => e.intent_id === intentId);
}

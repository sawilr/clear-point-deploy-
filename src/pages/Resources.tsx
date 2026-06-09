import { useState, useEffect } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { ExternalLinkIcon } from '../components/icons';
import { X as CloseIcon } from 'lucide-react';

const resources = [
  {
    title: 'Medicare 101: The Basics',
    titleEs: 'Medicare 101: Lo Básico',
    desc: 'Understand Medicare Parts A, B, C, and D, what each part generally covers, and when you may be able to enroll.',
    descEs: 'Entienda las Partes A, B, C y D de Medicare, qué cubre cada una y cuándo puede inscribirse.',
    tag: 'EDUCATION',
    tagEs: 'EDUCACIÓN',
  },
  {
    title: 'Medicare Enrollment Periods',
    titleEs: 'Períodos de Inscripción de Medicare',
    desc: 'Learn when you may be able to enroll, change plans, or review your coverage based on your situation.',
    descEs: 'Conozca cuándo puede inscribirse, cambiar de plan o revisar su cobertura según su situación.',
    tag: 'ENROLLMENT',
    tagEs: 'INSCRIPCIÓN',
  },
  {
    title: 'Turning 65: Your Medicare Checklist',
    titleEs: 'Cumpliendo 65: Su Lista de Verificación de Medicare',
    desc: 'A simple step-by-step guide to help you prepare for Medicare, including dates, documents, and important questions.',
    descEs: 'Una guía paso a paso para prepararse antes de entrar a Medicare, incluyendo fechas, documentos y preguntas importantes.',
    tag: 'TURNING 65',
    tagEs: 'CUMPLIENDO 65',
  },
  {
    title: 'Part D and the Coverage Gap',
    titleEs: 'Parte D y Brecha de Cobertura',
    desc: 'Learn how prescription drug coverage works, including formularies, preferred pharmacies, and the coverage gap known as the "donut hole."',
    descEs: 'Aprenda cómo funciona la cobertura de medicamentos, formularios, farmacias preferidas y la brecha de cobertura conocida como "donut hole".',
    tag: 'PART D',
    tagEs: 'PARTE D',
  },
  {
    title: 'Medicare Advantage vs. Medigap',
    titleEs: 'Medicare Advantage vs. Medigap',
    desc: 'Compare the general differences between Medicare Advantage and Medicare Supplement / Medigap. The right option depends on your situation.',
    descEs: 'Compare las diferencias generales entre Medicare Advantage y Medicare Supplement / Medigap. La opción adecuada depende de su situación.',
    tag: 'COMPARISON',
    tagEs: 'COMPARACIÓN',
  },
  {
    title: 'Extra Help / LIS: Could You Be Eligible?',
    titleEs: 'Ayuda Extra / LIS: ¿Podría Ser Elegible?',
    desc: 'Learn how Extra Help / LIS may help with certain prescription drug costs, based on income, resources, and program rules.',
    descEs: 'Conozca cómo Ayuda Extra / LIS puede ayudar con ciertos costos de medicamentos recetados, según ingresos, recursos y reglas del programa.',
    tag: 'SAVINGS',
    tagEs: 'AHORROS',
  },
  {
    // Sawil 2026-06 — late-enrollment penalties (Parts A/B/D). Factual CMS
    // education; full detail + verify-with-Medicare caveat in the guide modal.
    title: 'Late Enrollment Penalties',
    titleEs: 'Penalidades por Inscripción Tardía',
    desc: 'Signing up late for Medicare when you are eligible can add a penalty to your premium — often for life. Learn how the Part A, B, and D penalties generally work and how they are usually avoided.',
    descEs: 'Inscribirse tarde en Medicare cuando es elegible puede agregar una penalidad a su prima — muchas veces de por vida. Conozca cómo funcionan generalmente las penalidades de la Parte A, B y D y cómo se suelen evitar.',
    tag: 'PENALTIES',
    tagEs: 'PENALIDADES',
  },
  {
    // Sawil 2026-06 — educate-first: long-term care + PACE.
    title: 'Long-Term Care & PACE',
    titleEs: 'Cuidado a Largo Plazo y PACE',
    desc: 'Medicare generally does not pay for long-term custodial care. Learn what may help — Medicaid or long-term care insurance — and how PACE can help some people get care at home instead of a nursing home.',
    descEs: 'Medicare generalmente no paga el cuidado custodial a largo plazo. Conozca qué puede ayudar — Medicaid o seguro de cuidado a largo plazo — y cómo PACE puede ayudar a algunas personas a recibir cuidado en casa en vez de un hogar de ancianos.',
    tag: 'LONG-TERM CARE',
    tagEs: 'LARGO PLAZO',
  },
  {
    // Sawil 2026-06 — educate-first: how union/VA/federal/state coverage
    // coordinates with Medicare (so a reader gets the same info Zara gives,
    // without having to chat).
    title: 'Union, VA, Federal & State Employee Coverage',
    titleEs: 'Cobertura de Unión, VA, Federal y del Estado',
    desc: 'If you have union, retiree, VA, TRICARE, federal (FEHB), or state employee coverage, it can change how and when you take Medicare. Learn what to review before making any change.',
    descEs: 'Si tiene cobertura de unión, retiro, VA, TRICARE, federal (FEHB) o de empleado del estado, puede cambiar cómo y cuándo toma Medicare. Conozca qué revisar antes de hacer cualquier cambio.',
    tag: 'COORDINATION',
    tagEs: 'COORDINACIÓN',
  },
  {
    // Sawil 2026-06 — educate-first: short-term skilled nursing + rehab.
    title: 'Nursing Homes & Rehabilitation',
    titleEs: 'Hogares de Ancianos y Rehabilitación',
    desc: 'After a qualifying hospital stay, Medicare may help pay for short-term skilled nursing or rehab — for a limited time, with rules. Learn what is generally covered and what is not.',
    descEs: 'Después de una hospitalización que cualifique, Medicare puede ayudar a pagar cuidado especializado o rehabilitación a corto plazo — por tiempo limitado y con reglas. Conozca qué se cubre generalmente y qué no.',
    tag: 'CARE & RECOVERY',
    tagEs: 'CUIDADO Y RECUPERACIÓN',
  },
];

const guideContent = [
  {
    en: [
      'Medicare has several parts:',
      '• Part A: helps with inpatient hospital care, skilled nursing facility care, hospice, and some home health services.',
      '• Part B: helps with doctor visits, outpatient care, medical equipment, and preventive services.',
      '• Part C / Medicare Advantage: an alternative way to receive Part A and Part B benefits through a private company approved by Medicare.',
      '• Part D: helps with prescription drugs.',
      '',
      'Note: Medicare does not cover everything. Costs, benefits, and rules may vary based on coverage type and individual situation.',
      'If you are not sure what you currently have, a licensed advisor can help review your situation.',
    ],
    es: [
      'Medicare tiene varias partes:',
      '• Parte A: ayuda con hospitalización, skilled nursing facility, hospice y algunos servicios de salud en el hogar.',
      '• Parte B: ayuda con servicios médicos, visitas al doctor, cuidado ambulatorio, equipo médico y servicios preventivos.',
      '• Parte C / Medicare Advantage: una forma alternativa de recibir beneficios de Parte A y Parte B a través de una compañía privada aprobada por Medicare.',
      '• Parte D: ayuda con medicamentos recetados.',
      '',
      'Nota: Medicare no cubre todo. Los costos, beneficios y reglas pueden variar según el tipo de cobertura y la situación de cada persona.',
      'Si no está seguro de qué tiene actualmente, un asesor licenciado puede ayudarle a revisar su situación.',
    ],
  },
  {
    en: [
      'Medicare has specific times when people may enroll or make changes:',
      '• Initial Enrollment Period: usually happens around the month you turn 65.',
      '• Annual Enrollment Period (AEP): October 15 to December 7, for certain Medicare Advantage and Part D changes.',
      '• Medicare Advantage Open Enrollment: January 1 to March 31, for people already enrolled in Medicare Advantage.',
      '• Special Enrollment Period: may apply after certain life events such as moving, losing coverage, Medicaid, Extra Help, or other qualifying situations.',
      '',
      'Note: Not every enrollment period applies to every person. Eligibility depends on individual circumstances.',
    ],
    es: [
      'Medicare tiene períodos específicos para inscribirse o hacer cambios:',
      '• Período de Inscripción Inicial: normalmente ocurre alrededor del mes en que cumple 65 años.',
      '• Período de Inscripción Anual (AEP): del 15 de octubre al 7 de diciembre, para revisar o cambiar ciertas coberturas de Medicare Advantage y Parte D.',
      '• Inscripción Abierta de Medicare Advantage: del 1 de enero al 31 de marzo, para personas que ya tienen Medicare Advantage.',
      '• Período de Inscripción Especial: puede aplicar por ciertos eventos, como mudanza, pérdida de cobertura, Medicaid, Extra Help u otras situaciones.',
      '',
      'Nota: No todos los períodos aplican a todas las personas. La elegibilidad depende de la situación individual.',
    ],
  },
  {
    en: [
      'Before entering Medicare, review:',
      '• Whether you have Part A and Part B.',
      '• Whether you still work or have employer coverage.',
      '• Whether you have union, retiree, VA, TRICARE, or federal coverage.',
      '• Your current medications.',
      '• Your doctors and preferred hospitals.',
      '• Your preferred pharmacy.',
      '• Your monthly budget.',
      '• Whether you may be eligible for Extra Help, Medicaid, or Medicare Savings Programs.',
      '',
      'Note: Do not make coverage changes if you have employer, union, retiree, VA, TRICARE, or federal coverage without careful review.',
    ],
    es: [
      'Antes de entrar a Medicare, revise:',
      '• Si ya tiene Parte A y Parte B.',
      '• Si aún trabaja o tiene cobertura de empleador.',
      '• Si tiene cobertura de unión, retiro, VA, TRICARE o federal.',
      '• Sus medicamentos actuales.',
      '• Sus doctores y hospitales preferidos.',
      '• Su farmacia preferida.',
      '• Su presupuesto mensual.',
      '• Si podría calificar para Extra Help, Medicaid o Medicare Savings Programs.',
      '',
      'Nota: No haga cambios si tiene cobertura de empleador, unión, retiro, VA o TRICARE sin revisar bien cómo podría afectar sus beneficios.',
    ],
  },
  {
    en: [
      'Part D helps with prescription drugs. Before choosing prescription drug coverage, review:',
      '• Whether your medications are on the plan formulary.',
      '• The drug tier.',
      '• Prior authorization requirements.',
      '• Step therapy requirements.',
      '• Quantity limits.',
      '• Preferred pharmacies.',
      '• Mail order options.',
      '',
      'The coverage gap, sometimes called the "donut hole," is a stage of drug coverage costs. Rules may change by year and plan.',
      'Note: Medication costs should be verified before making a decision.',
    ],
    es: [
      'La Parte D ayuda con medicamentos recetados. Antes de escoger cobertura de medicamentos, revise:',
      '• Si sus medicamentos están en el formulario del plan.',
      '• El nivel o "tier" del medicamento.',
      '• Si requiere autorización previa.',
      '• Si requiere step therapy.',
      '• Si hay límites de cantidad.',
      '• Qué farmacias son preferidas.',
      '• Si mail order está disponible.',
      '',
      'La "brecha de cobertura" o "donut hole" es una etapa de costos dentro de la cobertura de medicamentos. Las reglas pueden cambiar por año y por plan.',
      'Nota: Los costos de medicamentos deben verificarse antes de tomar una decisión.',
    ],
  },
  {
    en: [
      'Medicare Advantage and Medigap are not the same:',
      '',
      'Medicare Advantage:',
      '• Also called Part C.',
      '• May use networks like HMO or PPO.',
      '• May include drug coverage if it is a MAPD plan.',
      '• May include additional benefits depending on the plan.',
      '• Costs and networks vary by county and plan.',
      '',
      'Medigap / Medicare Supplement:',
      '• Works with Original Medicare.',
      '• May help with certain out-of-pocket costs.',
      '• Does not replace Original Medicare.',
      '• Usually does not include Part D drug coverage.',
      '',
      'Note: The suitable option depends on doctors, medications, budget, travel, state, county, and personal situation.',
    ],
    es: [
      'Medicare Advantage y Medigap no son lo mismo:',
      '',
      'Medicare Advantage:',
      '• También se conoce como Parte C.',
      '• Puede incluir redes como HMO o PPO.',
      '• Puede incluir medicamentos si es un plan MAPD.',
      '• Puede tener beneficios adicionales, dependiendo del plan.',
      '• Los costos y redes varían por condado y plan.',
      '',
      'Medigap / Medicare Supplement:',
      '• Trabaja con Medicare Original.',
      '• Puede ayudar con ciertos costos de bolsillo.',
      '• No reemplaza Medicare Original.',
      '• Normalmente no incluye medicamentos Parte D.',
      '',
      'Nota: La opción adecuada depende de médicos, medicamentos, presupuesto, viajes, estado, condado y situación personal.',
    ],
  },
  {
    en: [
      'Extra Help, also called LIS (Low-Income Subsidy), may help with certain prescription drug costs for people with limited income and resources.',
      'It may help with:',
      '• Drug plan premiums,',
      '• Deductibles,',
      '• Copays,',
      '• Certain prescription costs.',
      '',
      'Eligibility depends on income, resources, and program rules.',
      '',
      'Note: Eligibility should not be assumed without verification. A licensed advisor can help explain what information should be reviewed.',
    ],
    es: [
      'Extra Help, también llamado LIS, puede ayudar con ciertos costos de medicamentos recetados para personas con ingresos y recursos limitados.',
      'Puede ayudar con:',
      '• Primas de medicamentos,',
      '• Deducibles,',
      '• Copagos,',
      '• Ciertos costos de medicamentos.',
      '',
      'La elegibilidad depende de ingresos, recursos y reglas del programa.',
      '',
      'Nota: No se debe asumir elegibilidad sin verificación. Un asesor puede ayudarle a entender qué información debe revisarse.',
    ],
  },
  {
    en: [
      'If you do not sign up for Medicare when you are first eligible — and you do not have other coverage that counts (called "creditable" coverage) — you may face a late enrollment penalty. This penalty is added to your monthly premium, and in most cases it lasts for as long as you keep that coverage.',
      '',
      'Part B late enrollment penalty:',
      '• Your monthly Part B premium may go up about 10% for each full 12-month period you could have had Part B but did not sign up.',
      '• In most cases, this higher amount lasts for as long as you have Part B.',
      '',
      'Part D (prescription drug) late enrollment penalty:',
      '• May apply if you go 63 days or more in a row without Part D or other creditable drug coverage after your Initial Enrollment Period.',
      '• The amount is based on how many full months you went without coverage and the national base beneficiary premium, which can change each year.',
      '',
      'Part A late enrollment penalty:',
      '• Most people get premium-free Part A and do not face this penalty.',
      '• If you have to buy Part A and sign up late, the premium may be higher for a limited time.',
      '',
      'How these penalties are usually avoided:',
      '• Signing up during your Initial Enrollment Period (generally around the month you turn 65), or',
      '• Keeping creditable coverage (such as qualifying employer coverage) and enrolling during a valid Special Enrollment Period.',
      '',
      'Note: This is general educational information, not a determination about your situation. Penalty rules and amounts are set by Medicare and can change. Always verify with Medicare (1-800-MEDICARE), Social Security, or a licensed advisor before making a decision.',
    ],
    es: [
      'Si no se inscribe en Medicare cuando es elegible por primera vez — y no tiene otra cobertura que cuente (llamada cobertura "acreditable" o "creditable") — puede enfrentar una penalidad por inscripción tardía. Esta penalidad se suma a su prima mensual y, en la mayoría de los casos, dura todo el tiempo que mantenga esa cobertura.',
      '',
      'Penalidad por inscripción tardía de la Parte B:',
      '• Su prima mensual de la Parte B puede aumentar aproximadamente 10% por cada período completo de 12 meses en que pudo haber tenido la Parte B pero no se inscribió.',
      '• En la mayoría de los casos, ese monto más alto dura todo el tiempo que tenga la Parte B.',
      '',
      'Penalidad por inscripción tardía de la Parte D (medicamentos recetados):',
      '• Puede aplicar si pasa 63 días o más seguidos sin Parte D u otra cobertura de medicamentos acreditable después de su Período de Inscripción Inicial.',
      '• El monto se basa en cuántos meses completos estuvo sin cobertura y en la prima base nacional, que puede cambiar cada año.',
      '',
      'Penalidad por inscripción tardía de la Parte A:',
      '• La mayoría de las personas reciben la Parte A sin prima y no enfrentan esta penalidad.',
      '• Si tiene que comprar la Parte A y se inscribe tarde, la prima puede ser más alta por un tiempo limitado.',
      '',
      'Cómo se suelen evitar estas penalidades:',
      '• Inscribiéndose durante su Período de Inscripción Inicial (generalmente alrededor del mes en que cumple 65 años), o',
      '• Manteniendo cobertura acreditable (como cobertura de empleador que cualifique) e inscribiéndose durante un Período de Inscripción Especial válido.',
      '',
      'Nota: Esta es información educativa general, no una determinación sobre su situación. Las reglas y los montos de las penalidades los establece Medicare y pueden cambiar. Verifique siempre con Medicare (1-800-MEDICARE), el Seguro Social o un asesor licenciado antes de tomar una decisión.',
    ],
  },
  {
    en: [
      'Long-term care means help with everyday activities — such as bathing, dressing, eating, or using the bathroom — when a person needs that help over a long period.',
      '',
      'What Medicare generally does NOT cover:',
      '• Medicare usually does not pay for long-term custodial care when that is the only care a person needs.',
      '• It does not pay for an indefinite nursing-home stay that is only for personal or custodial help.',
      '',
      'What may help with long-term care:',
      '• Medicaid: may help pay for long-term care for people who meet income, resource, and level-of-care rules. Rules vary by state.',
      '• Long-term care insurance: a separate private policy that some people buy before they need care.',
      '• Family support and community programs.',
      '',
      'PACE — Programs of All-Inclusive Care for the Elderly:',
      '• PACE combines medical and long-term-care services to help certain people get care in their home and community instead of a nursing home.',
      '• It is generally for people who are 55 or older, need a nursing-home level of care, can live safely in the community with help, and live in a PACE service area.',
      '• Availability depends on the state and the service area.',
      '',
      'Note: This is general educational information. Eligibility and benefits for Medicaid, long-term care insurance, and PACE depend on individual circumstances and state rules. Verify with Medicare, Medicaid, your state agency, or a licensed advisor before making decisions.',
    ],
    es: [
      'El cuidado a largo plazo significa ayuda con actividades diarias — como bañarse, vestirse, comer o ir al baño — cuando una persona necesita esa ayuda por un período largo.',
      '',
      'Lo que Medicare generalmente NO cubre:',
      '• Medicare normalmente no paga el cuidado custodial a largo plazo cuando ese es el único cuidado que la persona necesita.',
      '• No paga una estadía indefinida en un hogar de ancianos que sea solo para ayuda personal o custodial.',
      '',
      'Qué puede ayudar con el cuidado a largo plazo:',
      '• Medicaid: puede ayudar a pagar el cuidado a largo plazo para personas que cumplen las reglas de ingresos, recursos y nivel de cuidado. Las reglas varían por estado.',
      '• Seguro de cuidado a largo plazo: una póliza privada aparte que algunas personas compran antes de necesitar cuidado.',
      '• Apoyo familiar y programas comunitarios.',
      '',
      'PACE — Programa de Cuidado Integral para Personas Mayores:',
      '• PACE combina servicios médicos y de cuidado a largo plazo para ayudar a ciertas personas a recibir cuidado en su hogar y comunidad en vez de un hogar de ancianos.',
      '• Generalmente es para personas de 55 años o más, que necesitan un nivel de cuidado de hogar de ancianos, que pueden vivir con seguridad en la comunidad con ayuda, y que viven en un área de servicio de PACE.',
      '• La disponibilidad depende del estado y del área de servicio.',
      '',
      'Nota: Esta es información educativa general. La elegibilidad y los beneficios de Medicaid, el seguro de cuidado a largo plazo y PACE dependen de la situación de cada persona y de las reglas del estado. Verifique con Medicare, Medicaid, la agencia de su estado o un asesor licenciado antes de decidir.',
    ],
  },
  {
    en: [
      'Many people have other coverage besides Medicare — through a union, a former employer (retiree coverage), the VA, TRICARE, a federal job (FEHB), or a state or government job. This coverage can change how Medicare works for you.',
      '',
      'Why this matters:',
      '• Some of this coverage is "creditable," which can protect you from late enrollment penalties.',
      '• Some coverage works WITH Medicare; some may change or end once you take Medicare.',
      '• Dropping good coverage by mistake can be hard or impossible to get back.',
      '',
      'Common situations to review:',
      '• Union or retiree coverage: ask the plan how it works once you have Medicare, and whether you need to enroll in Part B.',
      '• VA benefits: you can generally have both VA and Medicare; each is used in different settings. Many people still enroll in Part B to keep more options.',
      '• TRICARE: usually requires Medicare Part B to keep TRICARE For Life.',
      '• Federal employee (FEHB): can often work alongside Medicare; whether to add Part B is a personal decision.',
      '• State or government employee/retiree coverage: rules vary by employer and plan.',
      '',
      'Note: Do NOT drop or change union, retiree, VA, TRICARE, federal, or state coverage without careful review. This is general education, not advice for your specific situation. Confirm with your benefits administrator, Medicare, the VA, or a licensed advisor first.',
    ],
    es: [
      'Muchas personas tienen otra cobertura además de Medicare — a través de una unión, un empleador anterior (cobertura de retiro), el VA, TRICARE, un trabajo federal (FEHB) o un trabajo estatal o del gobierno. Esta cobertura puede cambiar cómo funciona Medicare para usted.',
      '',
      'Por qué importa:',
      '• Parte de esta cobertura es "acreditable" (creditable), lo cual puede protegerle de las penalidades por inscripción tardía.',
      '• Algunas coberturas funcionan JUNTO con Medicare; otras pueden cambiar o terminar cuando toma Medicare.',
      '• Dejar una buena cobertura por error puede ser difícil o imposible de recuperar.',
      '',
      'Situaciones comunes para revisar:',
      '• Cobertura de unión o de retiro: pregunte al plan cómo funciona cuando tenga Medicare y si necesita inscribirse en la Parte B.',
      '• Beneficios del VA: generalmente puede tener VA y Medicare a la vez; cada uno se usa en lugares distintos. Muchas personas igual se inscriben en la Parte B para tener más opciones.',
      '• TRICARE: normalmente requiere la Parte B de Medicare para mantener TRICARE For Life.',
      '• Empleado federal (FEHB): muchas veces puede funcionar junto con Medicare; si añadir la Parte B es una decisión personal.',
      '• Cobertura de empleado o jubilado estatal o del gobierno: las reglas varían por empleador y plan.',
      '',
      'Nota: NO deje ni cambie su cobertura de unión, retiro, VA, TRICARE, federal o estatal sin revisarla con cuidado. Esto es educación general, no consejo para su situación específica. Confirme primero con su administrador de beneficios, Medicare, el VA o un asesor licenciado.',
    ],
  },
  {
    en: [
      'Medicare Part A may help with short-term skilled care and rehabilitation — which is different from long-term nursing-home care.',
      '',
      'Skilled Nursing Facility (SNF) care:',
      '• Medicare Part A may cover skilled care in a SNF for a limited time after a qualifying inpatient hospital stay.',
      '• Coverage is generally up to 100 days per benefit period IF you keep meeting the requirements. There is usually no daily charge for the first 20 days; a daily copay applies from day 21 onward (amounts can change each year).',
      '• It must be skilled care (such as skilled nursing or therapy), not only custodial care.',
      '',
      'Inpatient rehabilitation:',
      '• Medicare Part A may help with inpatient rehabilitation when it is medically necessary — for example after a stroke, surgery, or serious injury.',
      '',
      'What this does NOT include:',
      '• Long-term custodial care (ongoing help with daily activities only) is generally not covered by Medicare. See the Long-Term Care & PACE guide for what may help.',
      '',
      'Note: Coverage depends on meeting Medicare’s requirements, the type of care, and the benefit period. Amounts and rules can change each year. Verify with Medicare (1-800-MEDICARE), the facility, or a licensed advisor.',
    ],
    es: [
      'La Parte A de Medicare puede ayudar con cuidado especializado y rehabilitación a corto plazo — lo cual es diferente del cuidado a largo plazo en un hogar de ancianos.',
      '',
      'Cuidado en un Centro de Enfermería Especializada (SNF):',
      '• La Parte A de Medicare puede cubrir cuidado especializado en un SNF por tiempo limitado después de una hospitalización (internado) que cualifique.',
      '• La cobertura es generalmente hasta 100 días por período de beneficios SI usted sigue cumpliendo los requisitos. Normalmente no hay cargo diario en los primeros 20 días; a partir del día 21 aplica un copago diario (los montos pueden cambiar cada año).',
      '• Debe ser cuidado especializado (como enfermería especializada o terapia), no solo cuidado custodial.',
      '',
      'Rehabilitación como paciente internado:',
      '• La Parte A de Medicare puede ayudar con rehabilitación internada cuando es médicamente necesaria — por ejemplo después de un derrame, una cirugía o una lesión seria.',
      '',
      'Lo que esto NO incluye:',
      '• El cuidado custodial a largo plazo (ayuda continua solo con actividades diarias) generalmente no lo cubre Medicare. Vea la guía de Cuidado a Largo Plazo y PACE para saber qué puede ayudar.',
      '',
      'Nota: La cobertura depende de cumplir los requisitos de Medicare, el tipo de cuidado y el período de beneficios. Los montos y las reglas pueden cambiar cada año. Verifique con Medicare (1-800-MEDICARE), el centro o un asesor licenciado.',
    ],
  },
];

const externalLinks = [
  { title: 'Medicare.gov', url: 'https://www.medicare.gov', desc: 'Official U.S. government site for Medicare', descEs: 'Sitio oficial del gobierno de EE. UU. para Medicare' },
  { title: 'SSA.gov', url: 'https://www.ssa.gov', desc: 'Social Security Administration — apply for Extra Help', descEs: 'Administración del Seguro Social — solicite Ayuda Extra' },
  { title: 'CMS.gov', url: 'https://www.cms.gov', desc: 'Centers for Medicare & Medicaid Services', descEs: 'Centros de Servicios de Medicare y Medicaid' },
  { title: 'SHIP Help', url: 'https://www.shiptacenter.org', desc: 'State Health Insurance Assistance Programs', descEs: 'Programas Estatales de Asistencia de Seguros de Salud' },
];

export default function Resources() {
  // Belt-and-suspenders: scroll to top on mount in case ScrollToTop's
  // useLayoutEffect fired before this component was added to the DOM.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const { t, lang } = useLanguage();
  const gridReveal = useScrollReveal();
  const externalReveal = useScrollReveal();
  const [activeGuide, setActiveGuide] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/hero-bg.jpg"
        eyebrow="Resources & Education"
        eyebrowEs="Recursos y Educación"
        headline="Medicare Resources You Can Trust"
        headlineEs="Recursos de Medicare en los Que Puede Confiar"
        subheadline="Free educational guides, enrollment checklists, and comparison tools to help you make informed Medicare decisions."
        subheadlineEs="Guías educativas gratuitas, listas de verificación de inscripción y herramientas de comparación para ayudarle a tomar decisiones informadas sobre Medicare."
        variant="page"
      />

      <section ref={gridReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${gridReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="cp-section px-5">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Free Educational Guides', 'Guías Educativas Gratuitas')}</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal text-earth-900 leading-snug mb-4">
              {t('Educational Resources', 'Recursos Educativos')}
            </h2>
            <p className="text-earth-600 text-base leading-relaxed max-w-2xl mx-auto">
              {t('Simple guides to help you understand Medicare before making a decision. For personalized guidance, a licensed advisor must review your situation.', 'Guías simples para entender Medicare antes de tomar una decisión. Para asesoramiento personalizado, un asesor licenciado debe revisar su situación.')}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {resources.map((r, i) => (
              <div key={i} className="bg-cream-50 rounded-xl p-6 shadow-xs hover:shadow-soft transition-shadow border border-cream-200 flex flex-col">
                <span className="inline-block text-[10px] font-bold tracking-wider uppercase text-gold-500 bg-gold-100 px-2.5 py-1 rounded-full mb-3 self-start">{t(r.tag, r.tagEs)}</span>
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t(r.title, r.titleEs)}</h3>
                <p className="text-earth-600 text-sm leading-relaxed mb-4 flex-1">{t(r.desc, r.descEs)}</p>
                <button onClick={() => setActiveGuide(i)} className="text-sm font-semibold text-gold-600 hover:text-gold-700 transition-colors self-start cursor-pointer px-3 py-2 min-h-[44px] inline-flex items-center -ml-3 rounded-lg">{t('Read guide →', 'Leer guía →')}</button>
              </div>
            ))}
          </div>
          <p className="text-center text-[13px] text-earth-700 mt-8 max-w-3xl mx-auto leading-relaxed">
            {t('These resources are for general education only. Plan availability, benefits, costs, networks, medications, and eligibility may vary by county, plan, and individual situation. For a specific review, a licensed advisor must verify your information.', 'Estos recursos son solo para educación general. La disponibilidad de planes, beneficios, costos, redes, medicamentos y elegibilidad puede variar por condado, plan y situación personal. Para una revisión específica, un asesor licenciado debe verificar su información.')}
          </p>
        </div>
      </section>

      <section ref={externalReveal.ref} className={`py-20 lg:py-28 bg-cream-50 transition-all duration-700 ${externalReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-8 text-center">
            {t('Official Government Resources', 'Recursos Oficiales del Gobierno')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {externalLinks.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start justify-between gap-3 bg-white rounded-xl p-5 shadow-xs hover:shadow-soft transition-all border border-cream-200 group min-h-[88px]">
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-earth-900 group-hover:text-gold-600 transition-colors leading-tight">{link.title}</h3>
                  <p className="text-earth-700 text-[13px] mt-1.5 leading-relaxed">{t(link.desc, link.descEs)}</p>
                </div>
                <ExternalLinkIcon className="w-5 h-5 text-earth-600 group-hover:text-gold-600 transition-colors flex-shrink-0 mt-0.5" />
              </a>
            ))}
          </div>
        </div>
      </section>

      <CTASection
        headline="Need Personalized Medicare Guidance?"
        headlineEs="¿Necesita Orientación Personalizada de Medicare?"
        subheadline="Our licensed advisors are here to answer your specific questions. Book a free consultation today."
        subheadlineEs="Nuestros asesores licenciados están aquí para responder sus preguntas específicas. Reserve una consulta gratuita hoy."
      />

      {activeGuide !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-earth-900/60"
          onClick={() => setActiveGuide(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-modal-title"
            className="bg-white sm:rounded-2xl rounded-t-2xl shadow-xl max-w-2xl w-full max-h-[92dvh] sm:max-h-[88dvh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Sticky header — close button always visible */}
            <div className="flex items-start justify-between px-6 pt-5 pb-4 flex-shrink-0 border-b border-cream-100">
              <span className="inline-block text-[10px] font-bold tracking-wider uppercase text-gold-500 bg-gold-100 px-2.5 py-1 rounded-full mt-0.5">
                {t(resources[activeGuide].tag, resources[activeGuide].tagEs)}
              </span>
              <button
                onClick={() => setActiveGuide(null)}
                className="w-11 h-11 rounded-full bg-cream-100 flex items-center justify-center hover:bg-cream-200 transition-colors text-earth-700 flex-shrink-0 ml-3"
                aria-label={t('Close guide', 'Cerrar guía')}
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-6 py-5" style={{ WebkitOverflowScrolling: 'touch' }}>
              <h2 id="guide-modal-title" className="font-serif text-2xl sm:text-3xl font-normal text-earth-900 leading-snug mb-5">
                {t(resources[activeGuide].title, resources[activeGuide].titleEs)}
              </h2>
              <div className="space-y-3 text-earth-700 text-base leading-relaxed mb-8">
                {(lang === 'es' ? guideContent[activeGuide].es : guideContent[activeGuide].en).map((line: string, j: number) => (
                  line === '' ? <div key={j} className="h-3" /> :
                  <p key={j}>{line}</p>
                ))}
              </div>
              <p className="text-[12px] text-earth-700 leading-relaxed border-t border-cream-200 pt-4">
                {lang === 'es'
                  ? 'Esta guía es solo para educación general. No es una recomendación de plan ni una confirmación de elegibilidad. La disponibilidad de planes, beneficios, costos, redes y medicamentos puede variar por condado, plan y situación personal.'
                  : 'This guide is for general education only. It is not a plan recommendation or eligibility confirmation. Plan availability, benefits, costs, networks, and medications may vary by county, plan, and individual situation.'}
              </p>
            </div>

            {/* Sticky footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-cream-100 flex justify-end">
              <button onClick={() => setActiveGuide(null)} className="px-5 py-2.5 min-h-[44px] bg-earth-800 text-cream-50 rounded-lg text-sm font-semibold hover:bg-earth-900 transition-colors">
                {lang === 'es' ? 'Cerrar guía' : 'Close guide'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

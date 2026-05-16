import { useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { ExternalLinkIcon } from '../components/icons';

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
];

const externalLinks = [
  { title: 'Medicare.gov', url: 'https://www.medicare.gov', desc: 'Official U.S. government site for Medicare', descEs: 'Sitio oficial del gobierno de EE. UU. para Medicare' },
  { title: 'SSA.gov', url: 'https://www.ssa.gov', desc: 'Social Security Administration — apply for Extra Help', descEs: 'Administración del Seguro Social — solicite Ayuda Extra' },
  { title: 'CMS.gov', url: 'https://www.cms.gov', desc: 'Centers for Medicare & Medicaid Services', descEs: 'Centros de Servicios de Medicare y Medicaid' },
  { title: 'SHIP Help', url: 'https://www.shiptacenter.org', desc: 'State Health Insurance Assistance Programs', descEs: 'Programas Estatales de Asistencia de Seguros de Salud' },
];

export default function Resources() {
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
        <div className="max-w-6xl mx-auto px-5">
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
                <button onClick={() => setActiveGuide(i)} className="text-sm font-semibold text-gold-500 hover:text-gold-400 transition-colors self-start cursor-pointer">{t('Read guide', 'Leer guía')}</button>
              </div>
            ))}
          </div>
          <p className="text-center text-[11px] text-earth-400 mt-8 max-w-3xl mx-auto leading-relaxed">
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
              <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between bg-white rounded-xl p-5 shadow-xs hover:shadow-soft transition-all border border-cream-200 group">
                <div>
                  <h3 className="font-serif text-base font-semibold text-earth-900 group-hover:text-gold-500 transition-colors">{link.title}</h3>
                  <p className="text-earth-600 text-xs mt-1">{t(link.desc, link.descEs)}</p>
                </div>
                <ExternalLinkIcon className="w-4 h-4 text-earth-400 group-hover:text-gold-500 transition-colors flex-shrink-0" />
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-earth-900/60" onClick={() => setActiveGuide(null)}>
          <div
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
                className="w-8 h-8 rounded-full bg-cream-100 flex items-center justify-center hover:bg-cream-200 transition-colors text-earth-600 text-lg leading-none flex-shrink-0 ml-3"
                aria-label="Close guide"
              >
                ×
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-6 py-5" style={{ WebkitOverflowScrolling: 'touch' }}>
              <h2 className="font-serif text-2xl sm:text-3xl font-normal text-earth-900 leading-snug mb-5">
                {t(resources[activeGuide].title, resources[activeGuide].titleEs)}
              </h2>
              <div className="space-y-3 text-earth-700 text-base leading-relaxed mb-8">
                {(lang === 'es' ? guideContent[activeGuide].es : guideContent[activeGuide].en).map((line: string, j: number) => (
                  line === '' ? <div key={j} className="h-3" /> :
                  <p key={j}>{line}</p>
                ))}
              </div>
              <p className="text-[11px] text-earth-400 leading-relaxed border-t border-cream-200 pt-4">
                {lang === 'es'
                  ? 'Esta guía es solo para educación general. No es una recomendación de plan ni una confirmación de elegibilidad. La disponibilidad de planes, beneficios, costos, redes y medicamentos puede variar por condado, plan y situación personal.'
                  : 'This guide is for general education only. It is not a plan recommendation or eligibility confirmation. Plan availability, benefits, costs, networks, and medications may vary by county, plan, and individual situation.'}
              </p>
            </div>

            {/* Sticky footer */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-cream-100">
              <button onClick={() => setActiveGuide(null)} className="text-sm font-semibold text-gold-500 hover:text-gold-400 transition-colors">
                {lang === 'es' ? 'Cerrar guía' : 'Close guide'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

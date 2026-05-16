import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';
import { CheckIcon } from '../components/icons';

export default function MedicareSupplement() {
  const { t } = useLanguage();
  const eduReveal = useScrollReveal();
  const plansReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-family.jpg"
        eyebrow="Medicare Supplement"
        eyebrowEs="Suplemento de Medicare"
        headline="Fill the Gaps in Original Medicare"
        headlineEs="Llene los Vacíos del Medicare Original"
        subheadline="Medicare Supplement plans (Medigap) help cover costs that Original Medicare doesn't — like copays, coinsurance, and deductibles."
        subheadlineEs="Los planes Suplemento de Medicare (Medigap) ayudan a cubrir costos que el Medicare Original no cubre — como copagos, coseguros y deducibles."
        variant="page"
      />

      <section ref={eduReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${eduReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-12">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Education', 'Educación')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('What is Medicare Supplement (Medigap)?', '¿Qué es el Suplemento de Medicare (Medigap)?')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Medicare Supplement Insurance, also known as Medigap, is private insurance that helps pay for some of the health care costs that Original Medicare does not cover, like copayments, coinsurance, and deductibles. Medigap policies are standardized and identified by letters (Plans A through N). Each plan offers a different combination of benefits.',
                    'El Seguro Suplemento de Medicare, también conocido como Medigap, es un seguro privado que ayuda a pagar algunos de los costos de atención médica que el Medicare Original no cubre, como copagos, coseguros y deducibles. Las pólizas Medigap están estandarizadas e identificadas por letras (Planes A a N). Cada plan ofrece una combinación diferente de beneficios.'
                  )}
                </p>
              </div>

              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-gold-300">
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-3">{t('How Medigap Works', 'Cómo Funciona Medigap')}</h3>
                <div className="space-y-3">
                  {[
                    { en: 'You keep Original Medicare (Part A and Part B).', es: 'Mantiene el Medicare Original (Parte A y Parte B).' },
                    { en: 'You add a Medigap policy from a private insurance company.', es: 'Agrega una póliza Medigap de una compañía de seguros privada.' },
                    { en: 'Medicare pays its share first. Then Medigap pays its share.', es: 'Medicare paga su parte primero. Luego Medigap paga su parte.' },
                    { en: 'You pay the Medigap monthly premium.', es: 'Usted paga la prima mensual de Medigap.' },
                    { en: 'You can see any doctor that accepts Medicare.', es: 'Puede ver a cualquier médico que acepte Medicare.' },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <CheckIcon className="w-4 h-4 text-gold-500 flex-shrink-0 mt-1" />
                      <p className="text-earth-600 text-sm">{t(item.en, item.es)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-lg text-cream-50 mb-3">{t('Important Timing Note', 'Nota Importante Sobre Tiempos')}</h3>
                <p className="text-cream-100/70 text-sm leading-relaxed">
                  {t(
                    'The best time to buy a Medigap policy is during your 6-month Medigap Open Enrollment Period, which starts the month you turn 65 and are enrolled in Part B. During this period, you have a guaranteed right to buy any Medigap policy sold in your state. After this period, you may be subject to medical underwriting.',
                    'El mejor momento para comprar una póliza Medigap es durante su Período de Inscripción Abierta de Medigap de 6 meses, que comienza el mes en que cumple 65 años y está inscrito en la Parte B. Durante este período, tiene derecho garantizado a comprar cualquier póliza Medigap vendida en su estado. Después de este período, puede estar sujeto a evaluación médica.'
                  )}
                </p>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="page-sidebar" source="medicare-supplement-page" />
            </div>
          </div>
        </div>
      </section>

      <section ref={plansReveal.ref} className={`py-20 lg:py-28 bg-cream-50 transition-all duration-700 ${plansReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block text-center">{t('Plan Overview', 'Resumen de Planes')}</span>
          <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-3 text-center">
            {t('Medigap Plan Overview', 'Resumen de Planes Medigap')}
          </h2>
          <p className="text-earth-600 text-sm text-center max-w-3xl mx-auto mb-3">
            {t(
              'Medicare Supplement Insurance, also called Medigap, helps pay certain out-of-pocket costs left by Original Medicare. Plans are standardized by letter, but premiums and availability vary by carrier, state, ZIP code, and eligibility.',
              'El Seguro Suplemento de Medicare, también llamado Medigap, ayuda a pagar ciertos costos de bolsillo que deja el Medicare Original. Los planes están estandarizados por letra, pero las primas y la disponibilidad varían según la aseguradora, el estado, el código postal y la elegibilidad.'
            )}
          </p>
          <p className="text-gold-600 text-xs font-semibold text-center mb-10">
            {t(
              'This overview is for general education only. Specific plan recommendations and premium quotes require a licensed advisor review and, when applicable, a completed Scope of Appointment (SOA).',
              'Este resumen es solo para educación general. Recomendaciones específicas de planes y cotizaciones de primas requieren revisión de un asesor licenciado y, cuando corresponda, una Cita de Alcance (SOA) completada.'
            )}
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { plan: 'Plan A', limited: false, summaryEn: 'The basic foundation. Every Medigap plan includes at least these core benefits.', summaryEs: 'La base fundamental. Todos los planes Medigap incluyen al menos estos beneficios básicos.', pointsEn: ['Part A coinsurance & hospital costs', 'Part B coinsurance', 'First 3 pints of blood', 'Part A hospice coinsurance'], pointsEs: ['Coseguro de Parte A y costos hospitalarios', 'Coseguro de Parte B', 'Primeras 3 pintas de sangre', 'Coseguro de cuidados paliativos de Parte A'] },
              { plan: 'Plan B', limited: false, summaryEn: 'Adds Part A hospital deductible coverage to Plan A basic benefits.', summaryEs: 'Agrega cobertura del deducible hospitalario de Parte A a los beneficios básicos del Plan A.', pointsEn: ['All Plan A benefits', 'Part A deductible ($1,736 in 2026)', 'Does not cover Part B deductible or excess charges'], pointsEs: ['Todos los beneficios del Plan A', 'Deducible de Parte A ($1,736 en 2026)', 'No cubre deducible ni cargos en exceso de Parte B'] },
              { plan: 'Plan C', limited: true, limitedNoteEn: 'Not available to people newly eligible for Medicare on or after January 1, 2020.', limitedNoteEs: 'No disponible para personas recién elegibles para Medicare a partir del 1 de enero de 2020.', summaryEn: 'Broad coverage. Not available to new Medicare beneficiaries after 2020.', summaryEs: 'Cobertura amplia. No disponible para nuevos beneficiarios de Medicare después de 2020.', pointsEn: ['Covers Part A deductible', 'Covers Part B deductible', 'Skilled nursing facility coinsurance', 'Foreign travel emergency care'], pointsEs: ['Cubre deducible de Parte A', 'Cubre deducible de Parte B', 'Coseguro de centro de enfermería', 'Atención de emergencia en viajes al extranjero'] },
              { plan: 'Plan D', limited: false, summaryEn: 'Broad supplement without Part B deductible coverage. Not prescription drug coverage.', summaryEs: 'Suplemento amplio sin cobertura del deducible de Parte B. No es cobertura de medicamentos recetados.', pointsEn: ['Covers Part A deductible', 'Skilled nursing facility coinsurance', 'Foreign travel emergency care', '⚠ Medigap Plan D ≠ Medicare Part D'], pointsEs: ['Cubre deducible de Parte A', 'Coseguro de centro de enfermería', 'Atención de emergencia en viajes al extranjero', '⚠ Medigap Plan D ≠ Medicare Parte D'] },
              { plan: 'Plan F', limited: true, limitedNoteEn: 'Not available to people newly eligible for Medicare on or after January 1, 2020.', limitedNoteEs: 'No disponible para personas recién elegibles para Medicare a partir del 1 de enero de 2020.', summaryEn: 'Most comprehensive. Not available to new Medicare beneficiaries after 2020.', summaryEs: 'El más completo. No disponible para nuevos beneficiarios de Medicare después de 2020.', pointsEn: ['Covers all gaps including Part B deductible', 'Part B excess charges', 'Foreign travel emergency care', 'High-deductible option in some states'], pointsEs: ['Cubre todos los vacíos incluyendo deducible de Parte B', 'Cargos en exceso de Parte B', 'Atención de emergencia en viajes al extranjero', 'Opción de deducible alto en algunos estados'] },
              { plan: 'Plan G', limited: false, summaryEn: 'Broadest option for new enrollees. Covers nearly everything except the Part B deductible.', summaryEs: 'Opción más amplia para nuevos inscritos. Cubre casi todo excepto el deducible de Parte B.', pointsEn: ['Covers Part A deductible', 'Part B excess charges', 'Foreign travel emergency care', 'High-deductible option in some states'], pointsEs: ['Cubre deducible de Parte A', 'Cargos en exceso de Parte B', 'Atención de emergencia en viajes al extranjero', 'Opción de deducible alto en algunos estados'] },
              { plan: 'Plan K', limited: false, summaryEn: 'Lower-premium cost-sharing plan. Covers 50% of many benefits with an annual out-of-pocket limit.', summaryEs: 'Plan de costo compartido con prima más baja. Cubre 50% de muchos beneficios con límite anual de gastos.', pointsEn: ['50% Part A deductible & coinsurance', 'Annual out-of-pocket limit ($7,060 in 2026)', 'After limit, plan pays 100% rest of year', 'Lower premiums, higher cost-sharing'], pointsEs: ['50% deducible y coseguro de Parte A', 'Límite anual de gastos ($7,060 en 2026)', 'Después del límite, el plan paga 100%', 'Primas más bajas, mayor costo compartido'] },
              { plan: 'Plan L', limited: false, summaryEn: 'Cost-sharing plan with 75% coverage. More protection than Plan K with an annual out-of-pocket limit.', summaryEs: 'Plan de costo compartido con 75% de cobertura. Más protección que el Plan K con límite anual de gastos.', pointsEn: ['75% Part A deductible & coinsurance', 'Annual out-of-pocket limit ($3,530 in 2026)', 'After limit, plan pays 100% rest of year', 'Balances lower premium & more protection'], pointsEs: ['75% deducible y coseguro de Parte A', 'Límite anual de gastos ($3,530 en 2026)', 'Después del límite, el plan paga 100%', 'Balancea prima más baja y más protección'] },
              { plan: 'Plan M', limited: false, summaryEn: 'Covers 50% of the Part A deductible with many standard Medigap benefits.', summaryEs: 'Cubre 50% del deducible de Parte A con muchos beneficios estándar de Medigap.', pointsEn: ['50% Part A deductible', 'Skilled nursing facility coinsurance', 'Foreign travel emergency care', 'Does not cover Part B deductible or excess charges'], pointsEs: ['50% deducible de Parte A', 'Coseguro de centro de enfermería', 'Atención de emergencia en viajes al extranjero', 'No cubre deducible ni cargos en exceso de Parte B'] },
              { plan: 'Plan N', limited: false, summaryEn: 'Popular lower-premium option. Small copays for certain visits in exchange for lower monthly cost.', summaryEs: 'Opción popular de prima más baja. Pequeños copagos por ciertas visitas a cambio de menor costo mensual.', pointsEn: ['Covers Part A deductible', 'Skilled nursing facility coinsurance', 'Foreign travel emergency care', 'Copays: up to $20 office, $50 ER (if not admitted)'], pointsEs: ['Cubre deducible de Parte A', 'Coseguro de centro de enfermería', 'Atención de emergencia en viajes al extranjero', 'Copagos: hasta $20 consultorio, $50 emergencias (si no ingresa)'] },
            ].map((p, i) => (
              <div key={i} className="bg-white rounded-xl p-6 shadow-xs border border-cream-200 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-serif text-xl font-bold text-earth-900">{p.plan}</div>
                  {p.limited && (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">
                      {t('Limited Availability', 'Disponibilidad Limitada')}
                    </span>
                  )}
                </div>
                <p className="text-earth-600 text-sm leading-relaxed mb-3">
                  {t(p.summaryEn, p.summaryEs)}
                </p>
                <ul className="space-y-1.5 text-xs text-earth-500 mb-3 flex-1">
                  {p.pointsEn.map((pt, j) => (
                    <li key={j} className="flex items-start gap-2">
                      <span className="text-gold-400 mt-0.5 flex-shrink-0">•</span>
                      <span>{t(pt, p.pointsEs[j])}</span>
                    </li>
                  ))}
                </ul>
                {p.limited && p.limitedNoteEn && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2.5 leading-snug">
                    {t(p.limitedNoteEn, p.limitedNoteEs)}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-10 max-w-3xl mx-auto space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <p className="text-earth-700 text-sm leading-relaxed">
                {t(
                  'Plans C and F are not available to people newly eligible for Medicare on or after January 1, 2020 because Medigap plans sold to newly eligible beneficiaries can no longer cover the Part B deductible. People eligible before that date may still be able to buy or keep these plans, depending on availability and underwriting rules.',
                  'Los Planes C y F no están disponibles para personas recién elegibles para Medicare a partir del 1 de enero de 2020 porque los planes Medigap vendidos a nuevos beneficiarios ya no pueden cubrir el deducible de la Parte B. Las personas elegibles antes de esa fecha aún pueden comprar o mantener estos planes, según disponibilidad y reglas de suscripción.'
                )}
              </p>
            </div>
            <p className="text-earth-500 text-sm text-center">
              {t(
                'Medigap plans do not usually include prescription drug coverage. Many people pair Original Medicare + Medigap with a separate Medicare Part D prescription drug plan.',
                'Los planes Medigap generalmente no incluyen cobertura de medicamentos recetados. Muchas personas combinan Medicare Original + Medigap con un plan de medicamentos recetados de Medicare Parte D por separado.'
              )}
            </p>
          </div>

          <div className="mt-10 text-center">
            <p className="text-earth-700 font-semibold text-base mb-2">
              {t('Need help comparing Medigap options?', '¿Necesita ayuda comparando opciones de Medigap?')}
            </p>
            <p className="text-earth-500 text-sm mb-5">
              {t(
                'ClearPoint Senior Advisors can help you understand plan letters, premiums, and availability in your area.',
                'ClearPoint Senior Advisors puede ayudarle a entender las letras de los planes, las primas y la disponibilidad en su área.'
              )}
            </p>
            <a
              href="#/contact"
              className="inline-flex items-center gap-2 bg-earth-800 text-cream-50 font-semibold text-sm px-7 py-3.5 rounded-xl hover:bg-earth-900 transition-all hover:shadow-soft"
            >
              {t('Request a Free Review', 'Solicitar una Revisión Gratuita')}
            </a>
          </div>
        </div>
      </section>

      <div className="bg-cream-50 py-10">
        <div className="max-w-4xl mx-auto px-5">
          <DisclaimerBlock variant="compact" />
        </div>
      </div>

      <CTASection
        headline="Compare Medigap Plans for Your Needs"
        headlineEs="Compare Planes Medigap para Sus Necesidades"
        subheadline="Let us help you understand which Medigap plan makes sense for your budget and health needs."
        subheadlineEs="Déjenos ayudarle a entender qué plan Medigap tiene sentido para su presupuesto y necesidades de salud."
      />
    </div>
  );
}

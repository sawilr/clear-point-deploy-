import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';
import { CheckIcon } from '../components/icons';

export default function MedicareAdvantage() {
  const { t } = useLanguage();
  const eduReveal = useScrollReveal();
  const compareReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-advisor.jpg"
        eyebrow="Medicare Advantage"
        eyebrowEs="Medicare Advantage"
        headline="All-in-One Medicare Coverage"
        headlineEs="Cobertura Medicare Todo en Uno"
        subheadline="Learn how Medicare Advantage plans combine hospital, medical, and often prescription drug coverage into one simple plan — sometimes with $0 premium."
        subheadlineEs="Aprenda cómo los planes Medicare Advantage combinan cobertura hospitalaria, médica y frecuentemente de medicamentos en un solo plan simple — a veces con prima de $0."
        variant="page"
      />

      <section ref={eduReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${eduReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-12">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Education', 'Educación')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('What is Medicare Advantage?', '¿Qué es Medicare Advantage?')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Medicare Advantage (also called Part C) is an alternative to Original Medicare. These plans are offered by private insurance companies approved by Medicare. They combine Part A (hospital) and Part B (medical) coverage, and most plans include Part D (prescription drug) coverage as well. Many plans also offer extra benefits like dental, vision, hearing, fitness programs, and transportation.',
                    'Medicare Advantage (también llamado Parte C) es una alternativa al Medicare Original. Estos planes son ofrecidos por compañías de seguros privadas aprobadas por Medicare. Combinan la cobertura de la Parte A (hospital) y Parte B (médica), y la mayoría de los planes incluyen también la cobertura de la Parte D (medicamentos con receta). Muchos planes también ofrecen beneficios adicionales como dental, visión, audición, programas de fitness y transporte.'
                  )}
                </p>
              </div>

              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-gold-300">
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-3">{t('How Medicare Advantage Works', 'Cómo Funciona Medicare Advantage')}</h3>
                <div className="space-y-3">
                  {[
                    { en: 'You enroll in a Medicare Advantage plan through a private insurance carrier.', es: 'Se inscribe en un plan Medicare Advantage a través de una aseguradora privada.' },
                    { en: 'The plan provides all your Part A and Part B benefits.', es: 'El plan proporciona todos sus beneficios de la Parte A y Parte B.' },
                    { en: 'Most plans include prescription drug coverage (Part D).', es: 'La mayoría de los planes incluyen cobertura de medicamentos (Parte D).' },
                    { en: 'You may have a network of doctors, hospitals, and pharmacies.', es: 'Puede tener una red de médicos, hospitales y farmacias.' },
                    { en: 'You pay the plan\'s premium (sometimes $0) plus any copays or coinsurance.', es: 'Paga la prima del plan (a veces $0) más cualquier copago o coseguro.' },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <CheckIcon className="w-4 h-4 text-gold-500 flex-shrink-0 mt-1" />
                      <p className="text-earth-600 text-sm">{t(item.en, item.es)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-lg text-cream-50 mb-3">{t('Before We Discuss Specific Plans', 'Antes de Discutir Planes Específicos')}</h3>
                <p className="text-cream-100/70 text-sm leading-relaxed mb-4">
                  {t(
                    'To discuss specific Medicare Advantage plans, we first complete a brief Scope of Appointment (SOA) form with you. This is a Medicare requirement — no cost, no obligation. A licensed agent will guide you through it on your call.',
                    'Para discutir planes específicos de Medicare Advantage, primero completamos un breve formulario de Alcance de Cita (SOA) con usted. Este es un requisito de Medicare — sin costo, sin obligación. Un agente licenciado le guiará durante su llamada.'
                  )}
                </p>
                <a
                  href="tel:18663108702"
                  className="inline-flex items-center gap-2 bg-gold-400 text-earth-900 font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-gold-300 transition-colors"
                >
                  {t('Call to Schedule Your SOA', 'Llame para Programar su SOA')}
                </a>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="page-sidebar" source="medicare-advantage-page" />
            </div>
          </div>
        </div>
      </section>

      <section ref={compareReveal.ref} className={`py-20 lg:py-28 bg-cream-50 transition-all duration-700 ${compareReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-8 text-center">
            {t('Medicare Advantage vs. Original Medicare', 'Medicare Advantage vs. Medicare Original')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-earth-800">
                  <th className="text-left py-3 px-4 font-serif text-earth-900">{t('Feature', 'Característica')}</th>
                  <th className="text-left py-3 px-4 font-serif text-earth-900">{t('Original Medicare', 'Medicare Original')}</th>
                  <th className="text-left py-3 px-4 font-serif text-earth-900">{t('Medicare Advantage', 'Medicare Advantage')}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { feature: t('Coverage', 'Cobertura'), orig: t('Part A + Part B', 'Parte A + Parte B'), ma: t('Part A + Part B + often Part D + extras', 'Parte A + Parte B + frecuentemente Parte D + extras') },
                  { feature: t('Monthly Premium', 'Prima Mensual'), orig: t('Part B premium required', 'Prima Parte B requerida'), ma: t('Varies; often $0 beyond Part B', 'Varía; frecuentemente $0 además de Parte B') },
                  { feature: t('Out-of-Pocket Max', 'Gasto Máximo de Bolsillo'), orig: t('No limit', 'Sin límite'), ma: t('Annual limit applies', 'Aplica límite anual') },
                  { feature: t('Network', 'Red'), orig: t('Any provider that accepts Medicare', 'Cualquier proveedor que acepte Medicare'), ma: t('Typically HMO or PPO network', 'Típicamente red HMO o PPO') },
                  { feature: t('Extra Benefits', 'Beneficios Extra'), orig: t('Not included', 'No incluidos'), ma: t('Dental, vision, hearing, fitness, etc.', 'Dental, visión, audición, fitness, etc.') },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-cream-200">
                    <td className="py-3 px-4 font-semibold text-earth-800">{row.feature}</td>
                    <td className="py-3 px-4 text-earth-600">{row.orig}</td>
                    <td className="py-3 px-4 text-earth-600">{row.ma}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-earth-500 mt-4 text-center">
            {t('This comparison is for educational reference only. Final plan availability and specific details require a completed Scope of Appointment (SOA).', 'Esta comparación es solo para referencia educativa. La disponibilidad final de planes y los detalles específicos requieren una Cita de Alcance (SOA) completada.')}
          </p>
        </div>
      </section>

      <div className="bg-cream-50 py-10">
        <div className="max-w-4xl mx-auto px-5">
          <DisclaimerBlock variant="compact" />
        </div>
      </div>

      <CTASection
        headline="Want to Learn More About Medicare Advantage?"
        headlineEs="¿Quiere Saber Más Sobre Medicare Advantage?"
        subheadline="Schedule a free consultation. We will explain your options clearly — no pressure, no obligation."
        subheadlineEs="Programe una consulta gratuita. Le explicaremos sus opciones claramente — sin presión, sin obligación."
      />
    </div>
  );
}

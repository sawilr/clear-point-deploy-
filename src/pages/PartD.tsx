import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';
import { CheckIcon } from '../components/icons';

export default function PartD() {
  const { t } = useLanguage();
  const eduReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-drugs.jpg"
        eyebrow="Part D Prescription Drug Plans"
        eyebrowEs="Planes de Medicamentos Parte D"
        headline="Affordable Prescription Drug Coverage"
        headlineEs="Cobertura Asequible de Medicamentos"
        subheadline="Medicare Part D helps cover the cost of prescription drugs. We compare plans based on your specific medications to find the best fit."
        subheadlineEs="Medicare Parte D ayuda a cubrir el costo de medicamentos con receta. Comparamos planes según sus medicamentos específicos para encontrar el mejor ajuste."
        variant="page"
      />

      <section ref={eduReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${eduReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-12">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Education', 'Educación')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('What is Medicare Part D?', '¿Qué es Medicare Parte D?')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Medicare Part D is prescription drug coverage available to anyone with Medicare. These plans are offered by private insurance companies approved by Medicare. Each plan has its own list of covered drugs (called a formulary), its own network of pharmacies, and its own cost structure. Choosing the right Part D plan can save you thousands of dollars each year.',
                    'Medicare Parte D es cobertura de medicamentos con receta disponible para cualquier persona con Medicare. Estos planes son ofrecidos por compañías de seguros privadas aprobadas por Medicare. Cada plan tiene su propia lista de medicamentos cubiertos (llamada formulario), su propia red de farmacias y su propia estructura de costos. Elegir el plan Parte D correcto puede ahorrarle miles de dólares cada año.'
                  )}
                </p>
              </div>

              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-gold-300">
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-3">{t('How Part D Works', 'Cómo Funciona la Parte D')}</h3>
                <div className="space-y-3">
                  {[
                    { en: 'You choose a stand-alone Part D plan or a Medicare Advantage plan with drug coverage.', es: 'Elige un plan Parte D independiente o un plan Medicare Advantage con cobertura de medicamentos.' },
                    { en: 'Each plan has a formulary — a list of covered drugs organized into tiers.', es: 'Cada plan tiene un formulario — una lista de medicamentos cubiertos organizados en niveles.' },
                    { en: 'Lower-tier drugs typically cost less. Higher-tier or specialty drugs cost more.', es: 'Los medicamentos de nivel inferior típicamente cuestan menos. Los medicamentos de nivel superior o especializados cuestan más.' },
                    { en: 'Using in-network pharmacies saves you money.', es: 'Usar farmacias dentro de la red le ahorra dinero.' },
                    { en: 'Each plan has four coverage phases: Deductible, Initial Coverage, Coverage Gap (donut hole), and Catastrophic.', es: 'Cada plan tiene cuatro fases de cobertura: Deducible, Cobertura Inicial, Brecha de Cobertura (donut hole) y Catastrófica.' },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-3 items-start">
                      <CheckIcon className="w-4 h-4 text-gold-500 flex-shrink-0 mt-1" />
                      <p className="text-earth-600 text-sm">{t(item.en, item.es)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-lg text-cream-50 mb-3">{t('Why Compare Part D Plans Every Year?', '¿Por Qué Comparar Planes Parte D Cada Año?')}</h3>
                <p className="text-cream-100/70 text-sm leading-relaxed">
                  {t(
                    'Part D plans change every year. Formularies change. Premiums change. Pharmacies change. A plan option that fit your needs last year may not be the same one this year. During the Annual Election Period (Oct 15 – Dec 7), we review your medications against the new formularies to make sure you are still in a plan that covers your prescriptions.',
                    'Los planes Parte D cambian cada año. Los formularios cambian. Las primas cambian. Las farmacias cambian. Una opción de plan que le funcionó el año pasado puede no ser la misma este año. Durante el Período de Inscripción Anual (15 oct – 7 dic), revisamos sus medicamentos contra los nuevos formularios para asegurarnos de que siga en un plan que cubra sus recetas.'
                  )}
                </p>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="page-sidebar" source="part-d-page" />
            </div>
          </div>
        </div>
      </section>

      <div className="bg-cream-50 py-10">
        <div className="max-w-4xl mx-auto px-5">
          <DisclaimerBlock variant="compact" />
        </div>
      </div>

      <CTASection
        headline="Review Your Part D Plan Options"
        headlineEs="Revise Sus Opciones de Plan Parte D"
        subheadline="Bring your medication list. We will check available plan options in your area to help you review coverage based on your medications, pharmacy, county, and coverage needs."
        subheadlineEs="Traiga su lista de medicamentos. Verificaremos las opciones de planes disponibles en su área para ayudarle a revisar la cobertura según sus medicamentos, farmacia, condado y necesidades de cobertura."
      />
    </div>
  );
}

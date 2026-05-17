import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';
import { ExternalLinkIcon } from '../components/icons';

export default function ExtraHelp() {
  const { t } = useLanguage();
  const eduReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-phone.jpg"
        eyebrow="Extra Help / LIS / Medicaid"
        eyebrowEs="Ayuda Extra / LIS / Medicaid"
        headline="Lower Your Prescription Costs"
        headlineEs="Reduzca Sus Costos de Medicamentos"
        subheadline="You may qualify for federal and state programs that reduce or eliminate your Medicare prescription drug costs. We help you check eligibility at no charge."
        subheadlineEs="Puede calificar para programas federales y estatales que reducen o eliminan sus costos de medicamentos de Medicare. Le ayudamos a verificar elegibilidad sin cargo."
        variant="page"
        compact
        tighter
      />

      <section ref={eduReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${eduReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-12">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Programs', 'Programas')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('Programs That Can Help You Save', 'Programas Que Pueden Ayudarle a Ahorrar')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Many seniors do not realize they qualify for programs that significantly reduce their prescription drug costs. These are real federal and state programs — not scams, not gimmicks. We will check your eligibility at no cost and guide you through the application process.',
                    'Muchos adultos mayores no se dan cuenta de que califican para programas que reducen significativamente sus costos de medicamentos. Estos son programas federales y estatales reales — no estafas, no trucos. Verificaremos su elegibilidad sin costo y lo guiaremos a través del proceso de solicitud.'
                  )}
                </p>
              </div>

              {/* Extra Help / LIS */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-gold-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Extra Help (Low-Income Subsidy / LIS)', 'Ayuda Extra (Subsidio de Bajo Ingreso / LIS)')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed mb-4">
                  {t(
                    'Extra Help is a federal program that helps people with limited income and resources pay for Medicare Part D premiums, deductibles, and copays. If you qualify, you could pay as little as $0 for premiums and deductibles, and reduced copays for generic and brand-name drugs.',
                    'Ayuda Extra es un programa federal que ayuda a personas con ingresos y recursos limitados a pagar primas, deducibles y copagos de Medicare Parte D. Si califica, podría pagar tan poco como $0 en primas y deducibles, y copagos reducidos para medicamentos genéricos y de marca.'
                  )}
                </p>
                <div className="bg-white rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-earth-800 text-sm mb-2">{t('Rough Eligibility Guidelines (2025):', 'Pautas Aproximadas de Elegibilidad (2025):')}</h4>
                  <ul className="text-earth-600 text-sm space-y-1">
                    <li>{t('Individual: income below ~$22,000/year; resources below ~$17,000', 'Individual: ingresos menores a ~$22,000/año; recursos menores a ~$17,000')}</li>
                    <li>{t('Married: income below ~$30,000/year; resources below ~$34,000', 'Casado: ingresos menores a ~$30,000/año; recursos menores a ~$34,000')}</li>
                  </ul>
                </div>
                <p className="text-[11px] text-earth-500">
                  {t('[These are approximate figures. Final eligibility is determined by the Social Security Administration. We can help you apply.]', '[Estas cifras son aproximadas. La elegibilidad final la determina la Administración del Seguro Social. Podemos ayudarle a solicitar.]')}
                </p>
              </div>

              {/* Medicaid / Dual Eligible */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-sage-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Medicaid & Dual Eligible Special Needs Plans (D-SNPs)', 'Medicaid y Planes Especiales para Elegibles Duales (D-SNPs)')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed mb-4">
                  {t(
                    'If you qualify for both Medicare and Medicaid, you may be "dual eligible." Dual Eligible Special Needs Plans (D-SNPs) are a type of Medicare Advantage plan designed specifically for people with both Medicare and Medicaid. These plans often coordinate your benefits and may provide additional services like care coordination, transportation, and meal delivery.',
                    'Si califica tanto para Medicare como para Medicaid, puede ser "elegible dual." Los Planes Especiales de Necesidades para Elegibles Duales (D-SNPs) son un tipo de plan Medicare Advantage diseñado específicamente para personas con Medicare y Medicaid. Estos planes frecuentemente coordinan sus beneficios y pueden proporcionar servicios adicionales como coordinación de atención, transporte y entrega de comidas.'
                  )}
                </p>
                <a href="https://www.medicaid.gov" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-earth-800 hover:text-gold-500 transition-colors">
                  Medicaid.gov <ExternalLinkIcon className="w-3 h-3" />
                </a>
              </div>

              {/* SPAP */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-earth-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('State Pharmaceutical Assistance Programs (SPAP)', 'Programas Estatales de Asistencia Farmacéutica (SPAP)')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed mb-4">
                  {t(
                    'Some states offer additional prescription drug assistance beyond Extra Help and Medicaid. Availability varies by state. Contact us to learn if your state offers a SPAP and whether you qualify.',
                    'Algunos estados ofrecen asistencia adicional para medicamentos con receta más allá de Ayuda Extra y Medicaid. La disponibilidad varía por estado. Contáctenos para saber si su estado ofrece un SPAP y si califica.'
                  )}
                </p>
                <p className="text-[11px] text-earth-500">
                  {t('Serving: NY, FL, CT, NJ — SPAP availability varies by state.', 'Sirviendo: NY, FL, CT, NJ — La disponibilidad de SPAP varía por estado.')}
                </p>
              </div>

              {/* Application Help */}
              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-lg text-cream-50 mb-3">{t('We Help With Applications', 'Ayudamos Con las Solicitudes')}</h3>
                <p className="text-cream-100/70 text-sm leading-relaxed mb-4">
                  {t(
                    'Applying for Extra Help, Medicaid, or SPAP can be confusing. We will walk you through the paperwork, help you gather the required documents, and make sure your application is complete. There is no charge for this service.',
                    'Solicitar Ayuda Extra, Medicaid o SPAP puede ser confuso. Lo guiaremos a través del papeleo, le ayudaremos a reunir los documentos requeridos y nos aseguraremos de que su solicitud esté completa. No hay cargo por este servicio.'
                  )}
                </p>
                <a href="tel:18663108702" className="inline-flex items-center gap-2 bg-gold-400 text-earth-900 font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-gold-300 transition-all">
                  {t('Call to Check Eligibility', 'Llame para Verificar Elegibilidad')}
                </a>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="page-sidebar" source="extra-help-page" />
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
        headline="See If You Qualify for Extra Help"
        headlineEs="Vea Si Califica para Ayuda Extra"
        subheadline="A 5-minute call could save you thousands on prescription costs. No charge. No obligation."
        subheadlineEs="Una llamada de 5 minutos podría ahorrarle miles en costos de medicamentos. Sin cargo. Sin obligación."
      />
    </div>
  );
}

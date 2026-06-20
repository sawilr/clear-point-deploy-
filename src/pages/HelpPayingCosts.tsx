import { useLanguage } from '../hooks/useLanguage';
import { Link } from 'react-router';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';

export default function HelpPayingCosts() {
  const { t } = useLanguage();
  const cardsReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-phone.jpg"
        eyebrow="MSP · Medicaid · SPAP"
        eyebrowEs="MSP · Medicaid · SPAP"
        headline="Programs That May Help You Save"
        headlineEs="Programas que Pueden Ayudarle a Ahorrar"
        subheadline="Some federal and state programs may help with Medicare premiums, prescription costs, or other healthcare expenses. Availability and eligibility vary by state."
        subheadlineEs="Algunos programas federales y estatales pueden ayudar con primas de Medicare, medicamentos u otros costos de salud. La disponibilidad y elegibilidad varían por estado."
        variant="page"
        compact
        tighter
      />

      {/* TPMO disclosure — persistent in-page band (CMS §422.2267(e)(41)) */}
      <div className="bg-cream-100 border-y border-cream-200">
        <div className="max-w-6xl mx-auto px-5 py-3">
          <DisclaimerBlock variant="inline" />
        </div>
      </div>

      <section ref={cardsReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${cardsReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-8">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-3 block">{t('Cost-Help Programs', 'Programas de Ayuda con Costos')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('Programs That May Help You Save', 'Programas que Pueden Ayudarle a Ahorrar')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Several federal and state programs may help reduce your Medicare and healthcare costs. Each program has its own eligibility rules. A licensed advisor can help you understand which programs may apply to your situation.',
                    'Varios programas federales y estatales pueden ayudar a reducir sus costos de Medicare y salud. Cada programa tiene sus propias reglas de elegibilidad. Un asesor licenciado puede ayudarle a entender qué programas podrían aplicar a su situación.'
                  )}
                </p>
              </div>

              {/* Card 1 — MSP */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-gold-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Medicare Savings Programs / MSP', 'Programa de Ahorro de Medicare / MSP')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed">
                  {t(
                    'Medicare Savings Programs may help pay certain Medicare costs for people who qualify. Eligibility and benefits vary by state.',
                    'Los Programas de Ahorro de Medicare pueden ayudar a pagar ciertos costos de Medicare para personas que califican. La elegibilidad y los beneficios varían por estado.'
                  )}
                </p>
              </div>

              {/* Card 2 — Medicaid / Dual */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-sage-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Medicaid and Dual-Eligible Support', 'Medicaid y Doble Elegibilidad')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed">
                  {t(
                    'Some people qualify for both Medicare and Medicaid. If you may be dual eligible, it is important to review how benefits work together before making plan changes.',
                    'Algunas personas califican para Medicare y Medicaid al mismo tiempo. Si usted pudiera tener doble elegibilidad, es importante revisar cómo trabajan juntos esos beneficios antes de cambiar de plan.'
                  )}
                </p>
              </div>

              {/* Card 3 — SPAP */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-earth-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('State Pharmaceutical Assistance Programs / SPAP', 'Programas Estatales de Asistencia Farmacéutica / SPAP')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed">
                  {t(
                    'Some states offer prescription assistance programs that may help with medication costs. Availability varies by state.',
                    'Algunos estados ofrecen programas de asistencia para medicamentos que pueden ayudar con ciertos costos. La disponibilidad varía por estado.'
                  )}
                </p>
              </div>

              {/* Card 4 — How We Help */}
              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-xl text-cream-50 mb-3">{t('How We Help', 'Cómo Le Ayudamos')}</h3>
                <p className="text-cream-100/80 text-sm leading-relaxed mb-4">
                  {t(
                    'We can help you understand which programs may apply to your situation and guide you toward the correct next step. Final eligibility is determined by the appropriate agency.',
                    'Podemos ayudarle a entender qué programas podrían aplicar a su situación y orientarle hacia el próximo paso correcto. La elegibilidad final la determina la agencia correspondiente.'
                  )}
                </p>
                <a href="tel:18663108702" className="cp-btn-sm bg-gold-400 text-earth-900 hover:bg-gold-300 transition-all">
                  {t('Call 1-866-310-8702', 'Llame al 1-866-310-8702')}
                </a>
              </div>

              {/* Cross-reference to Extra Help / LIS — narrow scope */}
              <div className="bg-cream-100 rounded-xl p-5 border border-cream-200">
                <p className="text-earth-700 text-sm leading-relaxed">
                  {t(
                    'Extra Help / LIS is covered separately because it specifically relates to Medicare Part D prescription drug costs.',
                    'Ayuda Extra / LIS se explica por separado porque se enfoca específicamente en costos de medicamentos de Medicare Parte D.'
                  )}{' '}
                  <Link to="/extra-help" className="font-semibold text-gold-600 hover:text-gold-700 underline">
                    {t('Learn about Extra Help / LIS', 'Más información sobre Ayuda Extra / LIS')}
                  </Link>
                </p>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="page-sidebar" source="help-paying-costs-page" />
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
        headline="Not Sure Which Program Applies?"
        headlineEs="¿No Está Seguro Qué Programa Aplica?"
        subheadline="A licensed advisor can help review your situation. Eligibility and program availability vary by state and individual circumstances."
        subheadlineEs="Un asesor licenciado puede ayudar a revisar su situación. La elegibilidad y la disponibilidad del programa varían por estado y circunstancias individuales."
      />
    </div>
  );
}

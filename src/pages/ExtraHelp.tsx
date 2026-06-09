import { Link } from 'react-router';
import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';

export default function ExtraHelp() {
  const { t } = useLanguage();
  const eduReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-phone.jpg"
        eyebrow="Medicare Part D · Federal Program"
        eyebrowEs="Medicare Parte D · Programa Federal"
        headline="Extra Help / LIS for Prescription Drug Costs"
        headlineEs="Ayuda Extra / LIS para Costos de Medicamentos"
        subheadline="Extra Help may reduce Medicare Part D prescription drug costs for people who qualify. A licensed advisor can help you review whether you may be eligible."
        subheadlineEs="Ayuda Extra puede reducir los costos de medicamentos recetados de Medicare Parte D para personas que califican. Un asesor licenciado puede ayudarle a revisar si podría ser elegible."
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

      <section ref={eduReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${eduReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="grid lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="space-y-12">
              <div>
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Federal Program', 'Programa Federal')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('Extra Help / LIS — Medicare Part D Cost Help', 'Ayuda Extra / LIS — Ayuda para Costos de Parte D')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Extra Help (also called Low-Income Subsidy or LIS) is a federal program that may help reduce Medicare Part D prescription drug costs — premiums, deductibles, and copays — for people who qualify. Eligibility is determined by the Social Security Administration.',
                    'Ayuda Extra (también llamada Subsidio de Bajo Ingreso o LIS) es un programa federal que puede ayudar a reducir los costos de medicamentos recetados de Medicare Parte D — primas, deducibles y copagos — para personas que califican. La elegibilidad la determina la Administración del Seguro Social.'
                  )}
                </p>
              </div>

              {/* Extra Help / LIS */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-gold-300">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('What Extra Help / LIS May Cover', 'Qué Puede Cubrir Ayuda Extra / LIS')}</h3>
                <p className="text-earth-600 text-sm leading-relaxed mb-4">
                  {t(
                    'For people who qualify, Extra Help may reduce or eliminate Medicare Part D prescription drug plan premiums, lower the deductible, and reduce copays for generic and brand-name medications.',
                    'Para personas que califican, Ayuda Extra puede reducir o eliminar las primas del plan de medicamentos Medicare Parte D, bajar el deducible y reducir los copagos de medicamentos genéricos y de marca.'
                  )}
                </p>
                <div className="bg-white rounded-lg p-4 mb-4">
                  <h4 className="font-semibold text-earth-800 text-sm mb-2">{t('Rough Eligibility Guidelines (2026):', 'Pautas Aproximadas de Elegibilidad (2026):')}</h4>
                  <ul className="text-earth-600 text-sm space-y-1">
                    <li>{t('Individual: income below ~$22,000/year; resources below ~$17,000', 'Individual: ingresos menores a ~$22,000/año; recursos menores a ~$17,000')}</li>
                    <li>{t('Married: income below ~$30,000/year; resources below ~$34,000', 'Casado: ingresos menores a ~$30,000/año; recursos menores a ~$34,000')}</li>
                  </ul>
                </div>
                <p className="text-[13px] text-earth-700">
                  {t('These are approximate figures. Final eligibility is determined by the Social Security Administration. A licensed advisor can help you review your situation and the application process.', 'Estas cifras son aproximadas. La elegibilidad final la determina la Administración del Seguro Social. Un asesor licenciado puede ayudarle a revisar su situación y el proceso de solicitud.')}
                </p>
              </div>

              {/* Application help — Part D focused */}
              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-lg text-cream-50 mb-3">{t('Help With Your Application', 'Ayuda con Su Solicitud')}</h3>
                <p className="text-cream-100/80 text-sm leading-relaxed mb-4">
                  {t(
                    'The Extra Help application is filed through the Social Security Administration. A licensed advisor can walk you through what documents you may need and answer questions about Medicare Part D coverage.',
                    'La solicitud de Ayuda Extra se presenta a través de la Administración del Seguro Social. Un asesor licenciado puede explicarle qué documentos podría necesitar y responder preguntas sobre la cobertura de Medicare Parte D.'
                  )}
                </p>
                <a href="tel:18663108702" className="inline-flex items-center gap-2 bg-gold-400 text-earth-900 font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-gold-300 transition-all">
                  {t('Call 1-866-310-8702', 'Llame al 1-866-310-8702')}
                </a>
              </div>

              {/* Official SSA application — direct link to the government program
                  page. Compliance copy is verbatim from the approved brief: no
                  promises, no "you qualify", eligibility determination stays with
                  Social Security. */}
              <div className="bg-cream-50 rounded-xl p-6 border-l-4 border-sage-300">
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-3">{t('Official Application — Social Security', 'Solicitud Oficial — Seguro Social')}</h3>
                <p className="text-earth-700 text-sm leading-relaxed mb-4">
                  {t(
                    'Extra Help / LIS is handled through Social Security. ClearPoint can help explain the program and help you prepare questions, but the official application is completed through Social Security. Eligibility depends on income, resources, and program rules.',
                    'Extra Help / LIS se maneja a través del Seguro Social. ClearPoint puede ayudarle a entender el programa y preparar sus preguntas, pero la solicitud oficial se completa a través del Seguro Social. La elegibilidad depende de ingresos, recursos y reglas del programa.'
                  )}
                </p>
                <a
                  href="https://www.ssa.gov/medicare/part-d-extra-help"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-earth-800 text-cream-50 font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-earth-900 transition-all"
                >
                  {t('Apply for Extra Help through Social Security', 'Solicitar Extra Help a través del Seguro Social')}
                </a>
              </div>

              {/* Cross-reference to Help Paying Costs — separate broader page */}
              <div className="bg-cream-100 rounded-xl p-5 border border-cream-200">
                <p className="text-earth-700 text-sm leading-relaxed">
                  {t(
                    'Looking for help beyond Medicare Part D drug costs? Medicare Savings Programs (MSP), Medicaid, and State Pharmaceutical Assistance Programs (SPAP) are covered on a separate page.',
                    '¿Busca ayuda más allá de costos de medicamentos de Medicare Parte D? Los Programas de Ahorro de Medicare (MSP), Medicaid y los Programas Estatales de Asistencia Farmacéutica (SPAP) se explican en una página separada.'
                  )}{' '}
                  <Link to="/help-paying-costs" className="font-semibold text-gold-600 hover:text-gold-700 underline">
                    {t('See Programs That May Help You Save', 'Ver Programas que Pueden Ayudarle a Ahorrar')}
                  </Link>
                </p>
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
        headline="Questions About Extra Help / LIS?"
        headlineEs="¿Preguntas Sobre Ayuda Extra / LIS?"
        subheadline="A licensed advisor can help you review whether Extra Help may apply to your Medicare Part D situation. Final eligibility is determined by the Social Security Administration."
        subheadlineEs="Un asesor licenciado puede ayudarle a revisar si Ayuda Extra podría aplicar a su situación de Medicare Parte D. La elegibilidad final la determina la Administración del Seguro Social."
      />
    </div>
  );
}

import { useLanguage } from '../hooks/useLanguage';
import { Link } from 'react-router';
import { Hero } from '../components/Hero';
import { LeadForm } from '../components/LeadForm';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { useScrollReveal } from '../components/ScrollReveal';

export default function OtcBenefits() {
  const { t } = useLanguage();
  const cardsReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-phone.jpg"
        eyebrow="Plan-Specific Supplemental Benefit"
        eyebrowEs="Beneficio Suplemental Específico del Plan"
        headline="Understanding OTC Benefits"
        headlineEs="Entendiendo los Beneficios OTC"
        subheadline="Some Medicare Advantage plans may include an Over-the-Counter (OTC) benefit. Availability, amount, and rules vary by carrier, plan, county or service area, state, eligibility, and plan year."
        subheadlineEs="Algunos planes Medicare Advantage pueden incluir un beneficio de artículos sin receta (OTC). La disponibilidad, monto y reglas varían por aseguradora, plan, condado o área de servicio, estado, elegibilidad y año del plan."
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
                <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-3 block">{t('OTC Education', 'Educación OTC')}</span>
                <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
                  {t('Understanding OTC Benefits', 'Entendiendo los Beneficios OTC')}
                </h2>
                <p className="text-earth-600 text-base leading-relaxed">
                  {t(
                    'Some Medicare Advantage plans may include an Over-the-Counter, or OTC, benefit. This benefit may help members pay for certain health-related items approved by the plan that do not require a prescription.',
                    'Algunos planes Medicare Advantage pueden incluir un beneficio de artículos sin receta, conocido como OTC. Este beneficio puede ayudar a pagar ciertos productos de salud aprobados por el plan que no requieren receta médica.'
                  )}
                </p>
              </div>

              {/* Four mini-cards summarizing the key points (matches the visual
                  rhythm used on HelpPayingCosts and ExtraHelp pages) */}
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Card 1 — What OTC may cover */}
                <div className="bg-cream-50 rounded-xl p-5 border-l-4 border-gold-300">
                  <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t('What OTC may cover', 'Qué puede cubrir OTC')}</h3>
                  <p className="text-earth-600 text-sm leading-relaxed">
                    {t(
                      'Certain plan-approved health-related items that do not require a prescription.',
                      'Ciertos productos de salud aprobados por el plan que no requieren receta médica.'
                    )}
                  </p>
                </div>

                {/* Card 2 — How the allowance may work */}
                <div className="bg-cream-50 rounded-xl p-5 border-l-4 border-sage-300">
                  <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t('How the allowance may work', 'Cómo puede funcionar la asignación')}</h3>
                  <p className="text-earth-600 text-sm leading-relaxed">
                    {t(
                      'Monthly, quarterly, or annual allowance depending on the plan. It may use a card, catalog, online portal, phone order, or participating stores.',
                      'Cantidad mensual, trimestral o anual dependiendo del plan. Puede usarse con tarjeta, catálogo, portal en línea, pedido por teléfono o tiendas participantes.'
                    )}
                  </p>
                </div>

                {/* Card 3 — Why it varies */}
                <div className="bg-cream-50 rounded-xl p-5 border-l-4 border-earth-300">
                  <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t('Why it varies', 'Por qué varía')}</h3>
                  <p className="text-earth-600 text-sm leading-relaxed">
                    {t(
                      'OTC can vary by carrier, plan, county/service area, state, eligibility, and plan year.',
                      'El OTC puede variar por aseguradora, plan, condado o área de servicio, estado, elegibilidad y año del plan.'
                    )}
                  </p>
                </div>

                {/* Card 4 — What to verify */}
                <div className="bg-cream-50 rounded-xl p-5 border-l-4 border-gold-400">
                  <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t('What to verify', 'Qué se debe verificar')}</h3>
                  <p className="text-earth-600 text-sm leading-relaxed">
                    {t(
                      'Review the Summary of Benefits, Evidence of Coverage, and carrier materials before relying on any OTC amount or card rule.',
                      'Revise el Resumen de Beneficios, la Evidencia de Cobertura y los materiales de la aseguradora antes de confiar en cualquier monto OTC o regla de tarjeta.'
                    )}
                  </p>
                </div>
              </div>

              {/* Sawil 2026-06 — prominent, premium callout: some plans include
                  help for food, groceries, and utility bills. Compliance-safe:
                  "some plans may", extra eligibility usually required, amounts
                  vary, verify with a licensed advisor. No plan recommendation,
                  no guarantee, no eligibility determination. */}
              <div className="bg-gold-50 rounded-xl p-5 sm:p-6 border border-gold-200">
                <h3 className="font-serif text-xl font-semibold text-earth-900 mb-2">
                  {t('Some plans: food, groceries & help with bills', 'Algunos planes: comida, comestibles y ayuda con servicios públicos')}
                </h3>
                <p className="text-earth-700 text-[15px] leading-relaxed">
                  {t(
                    'Beyond regular OTC items, some Medicare Advantage plans may offer an expanded card that can help pay for healthy food, groceries, or certain utility bills (such as electric or gas). These expanded benefits are not in every plan and usually require additional eligibility — for example Medicaid, Extra Help/LIS, a qualifying chronic condition, or a Special Needs Plan (SNP). Amounts and rules vary by carrier, plan, county or service area, and plan year.',
                    'Además de los artículos OTC regulares, algunos planes Medicare Advantage pueden ofrecer una tarjeta ampliada que puede ayudar a pagar comida saludable, comestibles o ciertos recibos de servicios públicos (como luz o gas). Estos beneficios ampliados no están en todos los planes y normalmente requieren elegibilidad adicional — por ejemplo Medicaid, Extra Help/LIS, una condición crónica que cualifique, o un Plan de Necesidades Especiales (SNP). Los montos y las reglas varían por aseguradora, plan, condado o área de servicio y año del plan.'
                  )}
                </p>
                <p className="text-earth-500 text-[13px] leading-relaxed mt-3">
                  {t(
                    'This is general education, not a guarantee of benefits. A licensed advisor can verify what a specific plan in your county actually offers.',
                    'Esto es educación general, no una garantía de beneficios. Un asesor licenciado puede verificar lo que un plan específico en su condado realmente ofrece.'
                  )}
                </p>
              </div>

              {/* Body copy — exact wording provided by Sawil. Compliance-safe;
                  no plan recommendation, no eligibility promise, no specific
                  amount guarantee. */}
              <div className="space-y-5 text-earth-700 text-[15px] leading-relaxed">
                <p>
                  {t(
                    'OTC benefits are not the same in every plan. The amount, how often it renews, where it can be used, how items are ordered, and which products are allowed can vary by insurance company, plan, county or service area, state, eligibility, and plan year. In New York, New Jersey, and Connecticut, OTC benefits must still be checked by the exact plan available in the person’s county or service area.',
                    'Los beneficios OTC no son iguales en todos los planes. El monto, la frecuencia, dónde se puede usar, cómo se ordenan los productos y cuáles artículos están permitidos pueden variar por aseguradora, plan, condado o área de servicio, estado, elegibilidad y año del plan. En New York, New Jersey y Connecticut, el beneficio OTC siempre debe verificarse según el plan exacto disponible en el condado o área de servicio de la persona.'
                  )}
                </p>
                <p>
                  {t(
                    'Some plans may provide a monthly allowance. Others may provide a quarterly or annual allowance. In many plans, unused amounts may not roll over. Some plans use a card, catalog, online portal, phone order, or participating retail stores.',
                    'Algunos planes pueden ofrecer una cantidad mensual. Otros pueden ofrecer una cantidad trimestral o anual. En muchos planes, los montos no usados pueden no acumularse. Algunos planes usan tarjeta, catálogo, portal en línea, pedido por teléfono o tiendas participantes.'
                  )}
                </p>
                <p>
                  {t(
                    'Some Medicare Advantage plans may also offer expanded card benefits for food, groceries, utilities, or other special supports. These benefits are different from regular OTC and may require additional eligibility, such as Medicaid, Extra Help/LIS, a qualifying chronic condition, SNP status, or other plan-specific rules.',
                    'Algunos planes Medicare Advantage también pueden ofrecer beneficios ampliados para comida, comestibles, servicios públicos u otros apoyos especiales. Estos beneficios son diferentes al OTC regular y pueden requerir elegibilidad adicional, como Medicaid, Extra Help/LIS, una condición crónica que cualifique, estatus SNP u otras reglas específicas del plan.'
                  )}
                </p>
                <p>
                  {t(
                    'OTC benefits do not replace medical coverage or prescription drug coverage. Benefits can change each year. Before choosing or changing a plan, it is important to review the plan’s Summary of Benefits, Evidence of Coverage, and carrier materials. ClearPoint can help explain and organize the information for a licensed advisor review.',
                    'Los beneficios OTC no reemplazan la cobertura médica ni la cobertura de medicamentos recetados. Los beneficios pueden cambiar cada año. Antes de escoger o cambiar un plan, es importante revisar el Summary of Benefits, la Evidence of Coverage y los materiales de la aseguradora. ClearPoint puede ayudar a explicar y organizar la información para una revisión con un asesor licenciado.'
                  )}
                </p>
              </div>

              {/* How We Help — matches the dark-card pattern used on
                  HelpPayingCosts. Phone-call CTA only. No plan recommendation. */}
              <div className="bg-earth-800 rounded-xl p-6 text-cream-50">
                <h3 className="font-serif text-xl text-cream-50 mb-3">{t('How We Help', 'Cómo Le Ayudamos')}</h3>
                <p className="text-cream-100/80 text-sm leading-relaxed mb-4">
                  {t(
                    'ClearPoint can help explain and organize plan information, but the licensed advisor must verify plan details and the client decides. Final eligibility, plan availability, and OTC rules are determined by the carrier and the plan’s service area.',
                    'ClearPoint puede ayudar a explicar y organizar la información del plan, pero el asesor licenciado debe verificar los detalles del plan y el cliente decide. La elegibilidad final, la disponibilidad del plan y las reglas de OTC las determina la aseguradora y el área de servicio del plan.'
                  )}
                </p>
                <a href="tel:18663108702" className="inline-flex items-center gap-2 bg-gold-400 text-earth-900 font-bold text-sm px-5 py-2.5 rounded-lg hover:bg-gold-300 transition-all">
                  {t('Call 1-866-310-8702', 'Llame al 1-866-310-8702')}
                </a>
              </div>

              {/* Cross-reference to Help Paying Costs — closest sibling topic */}
              <div className="bg-cream-100 rounded-xl p-5 border border-cream-200">
                <p className="text-earth-700 text-sm leading-relaxed">
                  {t(
                    'Some expanded card benefits (food, utilities, flex supports) may require Medicaid, MSP, or other eligibility. Those programs are covered on a separate page.',
                    'Algunos beneficios ampliados de tarjeta (comida, utilidades, apoyos flex) pueden requerir Medicaid, MSP u otra elegibilidad. Esos programas se explican en una página separada.'
                  )}{' '}
                  <Link to="/help-paying-costs" className="font-semibold text-gold-600 hover:text-gold-700 underline">
                    {t('See Help Paying Costs', 'Ver Ayuda con Costos')}
                  </Link>
                </p>
              </div>
            </div>
            <div className="lg:sticky lg:top-28">
              <LeadForm variant="page-sidebar" source="otc-benefits-page" />
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
        headline="Want to Check If a Plan’s OTC Benefit Fits Your Area?"
        headlineEs="¿Quiere Verificar Si el Beneficio OTC de un Plan Aplica a Su Área?"
        subheadline="A licensed advisor can review the exact plan available in your county or service area. OTC availability, amount, and rules vary by carrier, plan, eligibility, and plan year."
        subheadlineEs="Un asesor licenciado puede revisar el plan exacto disponible en su condado o área de servicio. La disponibilidad, monto y reglas de OTC varían por aseguradora, plan, elegibilidad y año del plan."
      />
    </div>
  );
}

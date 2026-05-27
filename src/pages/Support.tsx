/**
 * Support page — hosts the Customer Service Bot inline.
 *
 * Mirrors the page-shell pattern from /extra-help, /help-paying-costs, /otc-benefits.
 * Bot is NOT a floating launcher — it lives inside this page.
 */
import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { CTASection } from '../components/CTASection';
import { DisclaimerBlock } from '../components/DisclaimerBlock';
import { CustomerServiceBot } from '../components/CustomerServiceBot';

export default function Support() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/service-phone.jpg"
        eyebrow="Customer Support"
        eyebrowEs="Servicio al Cliente"
        headline="ClearPoint Support Guide"
        headlineEs="Guía de Soporte ClearPoint"
        subheadline="Organize a Medicare question or concern so a licensed advisor can follow up. Bilingual, no pressure, no cost to you for our services."
        subheadlineEs="Organice una pregunta o inquietud sobre Medicare para que un asesor licenciado pueda comunicarse. Bilingüe, sin presión, sin costo para usted por nuestros servicios."
        variant="page"
        compact
        tighter
      />

      {/* TPMO disclosure — persistent in-page band */}
      <div className="bg-cream-100 border-y border-cream-200">
        <div className="max-w-6xl mx-auto px-5 py-3">
          <DisclaimerBlock variant="inline" />
        </div>
      </div>

      {/* Bot — page-resident, NOT floating */}
      <section className="py-12 lg:py-16">
        <div className="max-w-6xl mx-auto px-5">
          <div className="mb-6">
            <p className="text-earth-700 text-sm sm:text-base leading-relaxed max-w-3xl">
              {t(
                'This Support Guide helps organize your Medicare question. It does not recommend plans, confirm eligibility, or verify coverage. A licensed ClearPoint advisor will review what you share and follow up.',
                'Esta Guía de Soporte le ayuda a organizar su pregunta sobre Medicare. No recomienda planes, no confirma elegibilidad ni verifica cobertura. Un asesor licenciado de ClearPoint revisará lo que comparta y se comunicará con usted.'
              )}
            </p>
          </div>

          <CustomerServiceBot />
        </div>
      </section>

      <div className="bg-cream-50 py-10">
        <div className="max-w-4xl mx-auto px-5">
          <DisclaimerBlock variant="compact" />
        </div>
      </div>

      <CTASection
        headline="Prefer to Call Right Now?"
        headlineEs="¿Prefiere Llamar Ahora?"
        subheadline="Speak with a licensed Medicare advisor today. No robots. No hold music. Just real help, English or Spanish."
        subheadlineEs="Hable con un asesor licenciado de Medicare hoy. Sin robots. Sin música de espera. Solo ayuda real, en inglés o español."
        variant="dark"
      />
    </div>
  );
}

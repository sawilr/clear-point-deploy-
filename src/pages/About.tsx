import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { ShieldIcon, CheckIcon, UsersIcon, StarIcon } from '../components/icons';
import { LogoSvg } from '../components/LogoSvg';
import { DisclaimerBlock } from '../components/DisclaimerBlock';

export default function About() {
  const { t } = useLanguage();
  const storyReveal = useScrollReveal();
  const credReveal = useScrollReveal();

  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/hero-bg.jpg"
        eyebrow="Meet Clear Point Senior Advisors"
        eyebrowEs="Conozca Clear Point Senior Advisors"
        headline="Clear Point Senior Advisors"
        headlineEs="Clear Point Senior Advisors"
        // HIDDEN per Sawil 2026-06: FL pending authorization. Original lines below kept for one-line restore.
        // subheadline="Our licensed advisory team helps Medicare beneficiaries understand their options with clear, bilingual, no-pressure education. Serving New York, Florida, Connecticut, and New Jersey."
        // subheadlineEs="Nuestro equipo asesor licenciado ayuda a beneficiarios de Medicare a entender sus opciones con educación clara, bilingüe y sin presión. Sirviendo Nueva York, Florida, Connecticut y Nueva Jersey."
        subheadline="Our licensed advisory team helps Medicare beneficiaries understand their options with clear, bilingual, no-pressure education. Serving New York, New Jersey, and Connecticut."
        subheadlineEs="Nuestro equipo asesor licenciado ayuda a beneficiarios de Medicare a entender sus opciones con educación clara, bilingüe y sin presión. Sirviendo Nueva York, Nueva Jersey y Connecticut."
        variant="page"
      />

      {/* Story */}
      <section ref={storyReveal.ref} className={`py-20 lg:py-28 bg-cream-50 transition-all duration-700 ${storyReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-4xl mx-auto px-5">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Our Story', 'Nuestra Historia')}</span>
              <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-6">
                {t('Why We Started Clear Point', 'Por Qué Iniciamos Clear Point')}
              </h2>
              <div className="space-y-4 text-earth-600 leading-relaxed">
                <p>
                  {t(
                    'After years of watching seniors struggle to understand their Medicare options, we knew there had to be a better way. Too many people were enrolled in plans that did not fit their needs — simply because no one had taken the time to explain their choices.',
                    'Después de años de ver a adultos mayores luchar por entender sus opciones de Medicare, supimos que tenía que haber una mejor manera. Demasiadas personas estaban inscritas en planes que no se ajustaban a sus necesidades — simplemente porque nadie se había tomado el tiempo de explicarles sus opciones.'
                  )}
                </p>
                <p>
                  {t(
                    'Clear Point was built on one simple idea: every senior deserves clear, honest guidance from a team that works for them — not for an insurance company. As an independent agency, we have the freedom to compare plans across many carriers and help each person review the options that may fit.',
                    'Clear Point se construyó sobre una idea simple: cada adulto mayor merece orientación clara y honesta de un equipo que trabaja para ellos — no para una aseguradora. Como agencia independiente, tenemos la libertad de comparar planes de muchas aseguradoras y ayudar a cada persona a revisar las opciones que puedan ajustarse.'
                  )}
                </p>
                <p>
                  {t(
                    "Our advisors speak English and Spanish fluently. Medicare is confusing enough without a language barrier. When you call Clear Point, you will speak with a real person who understands your situation — in English or Spanish.",
                    'Nuestros asesores hablan inglés y español con fluidez. Medicare ya es lo suficientemente confuso sin una barrera del idioma. Cuando llame a Clear Point, hablará con una persona real que entiende su situación — en inglés o español.'
                  )}
                </p>
              </div>
            </div>
            <div className="bg-earth-800 rounded-2xl p-8 text-cream-50 shadow-card">
              <div className="mb-4"><LogoSvg size={48} /></div>
              <h3 className="font-serif text-xl mb-3">{t('Why Choose Clear Point', 'Por Qué Elegir Clear Point')}</h3>
              <p className="text-cream-100/70 text-sm leading-relaxed mb-4">
                {t(
                  'Every senior deserves clear, honest guidance from a team that works for them — not for an insurance company. We are an independent agency with the freedom to compare plans across many carriers and help each person review the options that may fit.',
                  'Cada adulto mayor merece orientación clara y honesta de un equipo que trabaja para ellos — no para una aseguradora. Somos una agencia independiente con la libertad de comparar planes de muchas aseguradoras y ayudar a cada persona a revisar las opciones que puedan ajustarse.'
                )}
              </p>
              <p className="text-cream-100/70 text-sm leading-relaxed">
                {t(
                  'Our advisors speak English and Spanish fluently. Medicare is confusing enough without a language barrier. When you call Clear Point, you will speak with a real person who understands your situation.',
                  'Nuestros asesores hablan inglés y español con fluidez. Medicare ya es lo suficientemente confuso sin una barrera del idioma. Cuando llame a Clear Point, hablará con una persona real que entiende su situación.'
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Credentials */}
      <section ref={credReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${credReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-6xl mx-auto px-5">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs font-bold tracking-[0.2em] uppercase text-gold-600 mb-4 block">{t('Credentials', 'Credenciales')}</span>
            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-earth-900 leading-snug mb-4">
              {t('Licensed. Experienced. Trusted.', 'Licenciado. Experimentado. De Confianza.')}
            </h2>
            <p className="text-earth-700 text-sm font-medium">{t('Final plan availability and carrier participation vary by area and appointment status.', 'La disponibilidad final de planes y la participación de aseguradoras varían por área y estado de cita.')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              // HIDDEN per Sawil 2026-06: FL pending authorization. Original: 'Licensed in NY, FL, CT, NJ' / 'Licenciado en NY, FL, CT, NJ'.
              { icon: <ShieldIcon className="w-7 h-7" />, title: 'Licensed Insurance Agent', titleEs: 'Agente de Seguros Licenciado', desc: 'Licensed in NY, CT, NJ', descEs: 'Licenciado en NY, CT, NJ' },
              // Sawil 2026-06-30 AUDIT FIX C6 — a bare "Medicare Certified" badge + "Annual
              // CMS training completed" can imply the government/CMS endorses the agency
              // (42 CFR 422.2262). Reworded to the industry certification agents actually
              // complete (Medicare/AHIP), with no implication of CMS endorsement.
              { icon: <CheckIcon className="w-7 h-7" />, title: 'Annually Certified', titleEs: 'Certificación Anual', desc: 'Completes annual Medicare/AHIP certification', descEs: 'Completa la certificación anual Medicare/AHIP' },
              { icon: <UsersIcon className="w-7 h-7" />, title: 'Bilingual Service', titleEs: 'Servicio Bilingüe', desc: 'English & Spanish fluently', descEs: 'Inglés y español con fluidez' },
              { icon: <StarIcon className="w-7 h-7" />, title: 'Independent Agent', titleEs: 'Agente Independiente', desc: 'Works for you, not carriers', descEs: 'Trabaja para usted, no aseguradoras' },
            ].map((c, i) => (
              <div key={i} className="bg-cream-50 rounded-xl p-7 text-center shadow-xs">
                <div className="w-14 h-14 rounded-lg bg-gold-100 text-gold-500 flex items-center justify-center mx-auto mb-4">{c.icon}</div>
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2">{t(c.title, c.titleEs)}</h3>
                <p className="text-earth-600 text-sm leading-relaxed">{t(c.desc, c.descEs)}</p>
              </div>
            ))}
          </div>
          {/* Lead Advisor */}
          <div className="mt-10 bg-cream-50 rounded-xl p-7 border border-cream-200">
            <h3 className="font-serif text-2xl font-semibold text-earth-900 mb-2 text-center">{t('Meet Your Licensed Advisor', 'Conozca a Su Asesor Licenciado')}</h3>
            <p className="text-earth-600 text-base leading-relaxed text-center max-w-2xl mx-auto mb-7">
              {t(
                'Clear Point Senior Advisors is built around licensed Medicare guidance, bilingual education, and no-pressure support.',
                'Clear Point Senior Advisors se construye sobre orientación de Medicare con licencia, educación bilingüe y apoyo sin presión.'
              )}
            </p>

            <div className="max-w-2xl mx-auto bg-white rounded-xl p-6 sm:p-7 shadow-soft border border-cream-200">
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                <div className="w-16 h-16 rounded-full bg-gold-100 text-gold-700 flex items-center justify-center font-serif text-xl font-bold flex-shrink-0 border border-gold-300">
                  SR
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h4 className="font-serif text-2xl font-semibold text-earth-900 mb-1">Sawil Reyes</h4>
                  <p className="text-sm font-semibold text-gold-700 uppercase tracking-wide mb-4">
                    {t('Licensed Medicare Advisor · Founder', 'Asesor de Medicare Licenciado · Fundador')}
                  </p>
                  <dl className="space-y-2.5 text-sm text-earth-700 mb-4">
                    <div className="flex flex-col sm:flex-row sm:gap-2">
                      <dt className="font-semibold text-earth-900 sm:min-w-[110px]">NPN</dt>
                      <dd>17261494</dd>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:gap-2">
                      <dt className="font-semibold text-earth-900 sm:min-w-[110px]">{t('Licensed in', 'Licenciado en')}</dt>
                      <dd>NY · NJ · CT</dd>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:gap-2">
                      <dt className="font-semibold text-earth-900 sm:min-w-[110px]">{t('Languages', 'Idiomas')}</dt>
                      <dd>{t('English · Spanish', 'Inglés · Español')}</dd>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:gap-2">
                      <dt className="font-semibold text-earth-900 sm:min-w-[110px]">{t('Focus', 'Enfoque')}</dt>
                      <dd>{t('Medicare Advantage · Part D', 'Medicare Advantage · Parte D')}</dd>
                    </div>
                  </dl>
                  <p className="text-sm text-earth-700 leading-relaxed">
                    {t(
                      'Sawil leads Clear Point with a focus on bilingual, plain-language Medicare guidance for seniors in New York, New Jersey, and Connecticut. Every conversation starts with listening — never a sales pitch.',
                      'Sawil dirige Clear Point con un enfoque en orientación de Medicare bilingüe y en lenguaje claro para adultos mayores en Nueva York, Nueva Jersey y Connecticut. Cada conversación comienza con escuchar — nunca con una venta.'
                    )}
                  </p>
                </div>
              </div>
            </div>

            <p className="text-center text-sm text-earth-700 mt-5">
              {t(
                'Additional licensed advisors will be added as the practice grows. All advisors are licensed in NY, NJ, CT and reviewed by our FMO before listing.',
                'Asesores licenciados adicionales se agregarán a medida que la agencia crezca. Todos los asesores están licenciados en NY, NJ, CT y son revisados por nuestro FMO antes de ser listados.'
              )}
            </p>
          </div>

          <div className="mt-8 bg-earth-800 rounded-xl p-6 text-center">
            <p className="text-cream-100/70 text-sm">
              {t('Agent Compensation Disclosure: ', 'Divulgación de Compensación del Agente: ')}
              <span className="text-cream-50">
                {t('Clear Point Senior Advisors and our licensed advisory team are compensated directly by Medicare Advantage and Part D plan sponsors when you enroll in a plan through us. There is no cost to you for our services.', 'Clear Point Senior Advisors y nuestro equipo asesor licenciado son compensados directamente por los patrocinadores de planes de Medicare Advantage y Parte D cuando se inscribe en un plan a través de nosotros. No hay costo para usted por nuestros servicios.')}
              </span>
            </p>
          </div>
          {/* Sawil 2026-06-30 AUDIT FIX C5 — the About page makes plan/credential/
              compensation claims but carried NO standardized TPMO disclaimer near them
              (only the global footer). Add the not-affiliated + "we don't offer every
              plan" / Medicare.gov disclaimer contextually (TPMO 422.2267). */}
          <div className="mt-8 border-t border-cream-200 pt-6">
            <DisclaimerBlock variant="compact" />
          </div>
        </div>
      </section>

      <CTASection
        headline="Ready to Meet Our Team?"
        headlineEs="¿Listo para Conocer a Nuestro Equipo?"
        subheadline="Book a free, no-pressure consultation with one of our licensed advisors. Get clear answers in English or Spanish."
        subheadlineEs="Reserve una consulta gratuita y sin presión con uno de nuestros asesores licenciados. Obtenga respuestas claras en inglés o español."
      />
    </div>
  );
}

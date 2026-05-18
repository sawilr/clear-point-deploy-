import { useLanguage } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { ShieldIcon, CheckIcon, UsersIcon, StarIcon } from '../components/icons';
import { ShieldCheck, Headset, BookOpen } from 'lucide-react';
import { LogoSvg } from '../components/LogoSvg';

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
        subheadline="Our licensed advisory team helps Medicare beneficiaries understand their options with clear, bilingual, no-pressure education. Serving New York, Florida, Connecticut, and New Jersey."
        subheadlineEs="Nuestro equipo asesor licenciado ayuda a beneficiarios de Medicare a entender sus opciones con educación clara, bilingüe y sin presión. Sirviendo Nueva York, Florida, Connecticut y Nueva Jersey."
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
                    'Clear Point was built on one simple idea: every senior deserves clear, honest guidance from a team that works for them — not for an insurance company. As an independent agency, we have the freedom to compare plans across the entire market and recommend what is truly best for each person.',
                    'Clear Point se construyó sobre una idea simple: cada adulto mayor merece orientación clara y honesta de un equipo que trabaja para ellos — no para una aseguradora. Como agencia independiente, tenemos la libertad de comparar planes en todo el mercado y recomendar lo que es verdaderamente mejor para cada persona.'
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
                  'Every senior deserves clear, honest guidance from a team that works for them — not for an insurance company. We are an independent agency with the freedom to compare plans across the entire market and recommend what is truly best for each person.',
                  'Cada adulto mayor merece orientación clara y honesta de un equipo que trabaja para ellos — no para una aseguradora. Somos una agencia independiente con la libertad de comparar planes en todo el mercado y recomendar lo que es verdaderamente mejor para cada persona.'
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
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Credentials', 'Credenciales')}</span>
            <h2 className="font-serif text-4xl sm:text-5xl font-normal text-earth-900 leading-snug mb-4">
              {t('Licensed. Experienced. Trusted.', 'Licenciado. Experimentado. De Confianza.')}
            </h2>
            <p className="text-earth-600 text-sm text-gold-600 font-medium">{t('Final plan availability and carrier participation vary by area and appointment status.', 'La disponibilidad final de planes y la participación de aseguradoras varían por área y estado de cita.')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: <ShieldIcon className="w-7 h-7" />, title: 'Licensed Insurance Agent', titleEs: 'Agente de Seguros Licenciado', desc: 'Licensed in NY, FL, CT, NJ', descEs: 'Licenciado en NY, FL, CT, NJ' },
              { icon: <CheckIcon className="w-7 h-7" />, title: 'Medicare Certified', titleEs: 'Certificado en Medicare', desc: 'Annual CMS training completed', descEs: 'Capacitación anual de CMS completada' },
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
          {/* Team section */}
          <div className="mt-10 bg-cream-50 rounded-xl p-6 border border-cream-200">
            <h3 className="font-serif text-2xl font-semibold text-earth-900 mb-3 text-center">{t('Our Advisory Team', 'Nuestro Equipo Asesor')}</h3>
            <p className="text-earth-600 text-base leading-relaxed text-center max-w-2xl mx-auto mb-6">
              {t(
                'Clear Point Senior Advisors is built around licensed Medicare guidance, bilingual education, and no-pressure support. As the agency grows, team profiles will be updated to reflect our expanding licensed advisory network.',
                'Clear Point Senior Advisors se construye sobre orientación de Medicare con licencia, educación bilingüe y apoyo sin presión. A medida que la agencia crece, los perfiles del equipo se actualizarán para reflejar nuestra red asesora licenciada en expansión.'
              )}
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                {
                  roleEn: 'Licensed Medicare Guidance',
                  roleEs: 'Orientación de Medicare con Licencia',
                  textEn: 'Our agency works with licensed professionals to provide clear Medicare education and support. Individual advisor profiles will be added after internal review and approval.',
                  textEs: 'Nuestra agencia trabaja con profesionales con licencia para ofrecer educación y apoyo claro sobre Medicare. Los perfiles individuales de asesores se agregarán después de revisión y aprobación interna.',
                },
                {
                  roleEn: 'Client Support',
                  roleEs: 'Apoyo al Cliente',
                  textEn: 'Our support process is designed to help visitors schedule appointments, request information, and connect with the right licensed team member.',
                  textEs: 'Nuestro proceso de apoyo está diseñado para ayudar a los visitantes a programar citas, solicitar información y conectarse con el miembro del equipo licenciado correspondiente.',
                },
                {
                  roleEn: 'Medicare Education Support',
                  roleEs: 'Apoyo Educativo sobre Medicare',
                  textEn: 'We focus on plain-language Medicare education so visitors can better understand their next steps before speaking with a licensed agent.',
                  textEs: 'Nos enfocamos en educación sobre Medicare en lenguaje claro para que los visitantes puedan entender mejor sus próximos pasos antes de hablar con un agente con licencia.',
                },
              ].map((m, i) => {
                const icons = [
                  <ShieldCheck key="sc" className="w-7 h-7 text-gold-500" strokeWidth={1.5} />,
                  <Headset key="hs" className="w-7 h-7 text-sage-500" strokeWidth={1.5} />,
                  <BookOpen key="bo" className="w-7 h-7 text-gold-500" strokeWidth={1.5} />,
                ];
                return (
                  <div key={i} className="bg-white/50 rounded-lg p-5 text-center border border-dashed border-cream-300">
                    <div className="w-14 h-14 rounded-full bg-cream-100 flex items-center justify-center mx-auto mb-3">
                      {icons[i]}
                    </div>
                    <div className="text-base font-semibold text-earth-900 mb-1">{t(m.roleEn, m.roleEs)}</div>
                    <div className="text-sm text-earth-600 mt-2 leading-relaxed">{t(m.textEn, m.textEs)}</div>
                  </div>
                );
              })}
            </div>
            {/* Internal note: All advisors must be licensed in NY, FL, CT, NJ and approved by FMO before listing. */}
          </div>

          <div className="mt-8 bg-earth-800 rounded-xl p-6 text-center">
            <p className="text-cream-100/70 text-sm">
              {t('Agent Compensation Disclosure: ', 'Divulgación de Compensación del Agente: ')}
              <span className="text-cream-50">
                {t('Clear Point Senior Advisors and our licensed advisory team are compensated directly by Medicare Advantage and Part D plan sponsors when you enroll in a plan through us. There is no cost to you for our services.', 'Clear Point Senior Advisors y nuestro equipo asesor licenciado son compensados directamente por los patrocinadores de planes de Medicare Advantage y Parte D cuando se inscribe en un plan a través de nosotros. No hay costo para usted por nuestros servicios.')}
              </span>
            </p>
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

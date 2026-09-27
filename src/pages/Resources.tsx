import { useEffect } from 'react';
import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { Hero } from '../components/Hero';
import { CTASection } from '../components/CTASection';
import { useScrollReveal } from '../components/ScrollReveal';
import { ExternalLinkIcon } from '../components/icons';

import { Link } from 'react-router';
import { GUIDES } from '../data/guides';

const externalLinks = [
  { title: 'Medicare.gov', url: 'https://www.medicare.gov', desc: 'Official U.S. government site for Medicare', descEs: 'Sitio oficial del gobierno de EE. UU. para Medicare' },
  { title: 'SSA.gov', url: 'https://www.ssa.gov', desc: 'Social Security Administration — apply for Extra Help', descEs: 'Administración del Seguro Social — solicite Ayuda Adicional' },
  { title: 'CMS.gov', url: 'https://www.cms.gov', desc: 'Centers for Medicare & Medicaid Services', descEs: 'Centros de Servicios de Medicare y Medicaid' },
  { title: 'SHIP Help', url: 'https://www.shiphelp.org/', desc: 'State Health Insurance Assistance Programs', descEs: 'Programas Estatales de Asistencia de Seguros de Salud' },
];


export default function Resources() {
  // Belt-and-suspenders: scroll to top on mount in case ScrollToTop's
  // useLayoutEffect fired before this component was added to the DOM.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const { t } = useLanguage();
  const lp = useLocalizedPath();
  const gridReveal = useScrollReveal();
  const externalReveal = useScrollReveal();
  return (
    <div className="min-h-screen bg-cream-50">
      <Hero
        image="/hero-bg.jpg"
        eyebrow="Resources & Education"
        eyebrowEs="Recursos y Educación"
        headline="Medicare Resources You Can Trust"
        headlineEs="Recursos de Medicare en los Que Puede Confiar"
        subheadline="Free educational guides, enrollment checklists, and comparison tools to help you make informed Medicare decisions."
        subheadlineEs="Guías educativas gratuitas, listas de verificación de inscripción y herramientas de comparación para ayudarle a tomar decisiones informadas sobre Medicare."
        variant="page"
      />

      <section ref={gridReveal.ref} className={`py-20 lg:py-28 bg-white transition-all duration-700 ${gridReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="cp-section px-5">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-4 block">{t('Free Educational Guides', 'Guías Educativas Gratuitas')}</span>
            <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-4">
              {t('Educational Resources', 'Recursos Educativos')}
            </h2>
            <p className="text-earth-600 text-base leading-relaxed max-w-2xl mx-auto">
              {t('Simple guides to help you understand Medicare before making a decision. For personalized guidance, a licensed advisor must review your situation.', 'Guías simples para entender Medicare antes de tomar una decisión. Para asesoramiento personalizado, un asesor licenciado debe revisar su situación.')}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {GUIDES.map((r) => (
              <div key={r.slug} className="bg-cream-50 rounded-xl p-6 shadow-xs hover:shadow-soft transition-shadow border border-cream-200 flex flex-col">
                <span className="inline-block text-[12px] font-bold tracking-wider uppercase text-earth-700 bg-gold-100 px-2.5 py-1 rounded-full mb-3 self-start">{t(r.tag, r.tagEs)}</span>
                <h3 className="font-serif text-lg font-semibold text-earth-900 mb-2"><Link to={lp('/resources/' + r.slug)} className="hover:text-gold-600 transition-colors">{t(r.title, r.titleEs)}</Link></h3>
                <p className="text-earth-600 text-sm leading-relaxed mb-4 flex-1">{t(r.desc, r.descEs)}</p>
                <Link to={lp('/resources/' + r.slug)} aria-label={t(`Read guide: ${r.title}`, `Leer guía: ${r.titleEs}`)} className="text-sm font-semibold text-gold-600 hover:text-gold-700 transition-colors self-start cursor-pointer px-3 py-2 min-h-[44px] inline-flex items-center -ml-3 rounded-lg">{t('Read guide →', 'Leer guía →')}</Link>
              </div>
            ))}
          </div>
          <p className="text-center text-[13px] text-earth-700 mt-8 max-w-3xl mx-auto leading-relaxed">
            {t('These resources are for general education only. Plan availability, benefits, costs, networks, medications, and eligibility may vary by county, plan, and individual situation. For a specific review, a licensed advisor must verify your information.', 'Estos recursos son solo para educación general. La disponibilidad de planes, beneficios, costos, redes, medicamentos y elegibilidad puede variar por condado, plan y situación personal. Para una revisión específica, un asesor licenciado debe verificar su información.')}
          </p>
        </div>
      </section>

      <section ref={externalReveal.ref} className={`py-20 lg:py-28 bg-cream-50 transition-all duration-700 ${externalReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
        <div className="max-w-4xl mx-auto px-5">
          <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 leading-snug mb-8 text-center">
            {t('Official Government Resources', 'Recursos Oficiales del Gobierno')}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {externalLinks.map((link, i) => (
              <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start justify-between gap-3 bg-white rounded-xl p-5 shadow-xs hover:shadow-soft transition-all border border-cream-200 group min-h-[88px]">
                <div className="flex-1 min-w-0">
                  <h3 className="font-serif text-base font-semibold text-earth-900 group-hover:text-gold-600 transition-colors leading-tight">{link.title}</h3>
                  <p className="text-earth-700 text-[13px] mt-1.5 leading-relaxed">{t(link.desc, link.descEs)}</p>
                </div>
                <ExternalLinkIcon className="w-5 h-5 text-earth-600 group-hover:text-gold-600 transition-colors flex-shrink-0 mt-0.5" />
              </a>
            ))}
          </div>
        </div>
      </section>

      <CTASection
        headline="Need Personalized Medicare Guidance?"
        headlineEs="¿Necesita Orientación Personalizada de Medicare?"
        subheadline="Our licensed advisors are here to answer your specific questions. Book a free consultation today."
        subheadlineEs="Nuestros asesores licenciados están aquí para responder sus preguntas específicas. Reserve una consulta gratuita hoy."
      />

    </div>
  );
}

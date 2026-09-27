import { Link } from 'react-router';
import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { GUIDES } from '../data/guides';

// SEO 2026-09-27 (CA-SEO-07). Medido en producción tras dar URL a las guías:
// la portada y /about seguían con cero enlaces hacia /resources/<guía>, así que
// el contenido educativo más profundo del sitio recibía autoridad interna solo
// desde el hub. Este bloque enlaza las diez guías desde las páginas con más
// enlaces entrantes, con el título real de cada una como texto del enlace.
export function GuideLinks({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const lp = useLocalizedPath();
  return (
    <section aria-labelledby="guide-links-heading" className={compact ? 'py-10 bg-white' : 'py-14 lg:py-20 bg-white'}>
      <div className="cp-section px-5">
        <div className="max-w-3xl mx-auto text-center mb-8">
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-3 block">{t('Free Guides', 'Guías Gratuitas')}</span>
          <h2 id="guide-links-heading" className="font-serif text-2xl sm:text-3xl font-normal text-earth-900 leading-snug">
            {t('Learn Medicare at your own pace', 'Aprenda Medicare a su ritmo')}
          </h2>
        </div>
        <ul className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 max-w-6xl mx-auto">
          {GUIDES.map((g) => (
            <li key={g.slug}>
              <Link
                to={lp('/resources/' + g.slug)}
                className="block h-full bg-cream-50 border border-cream-200 rounded-xl px-4 py-3 text-sm font-semibold text-earth-800 hover:text-gold-600 hover:shadow-soft transition-all min-h-[44px]"
              >
                {t(g.title, g.titleEs)}
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-center mt-6">
          <Link to={lp('/resources')} className="inline-flex items-center min-h-[44px] text-sm font-semibold text-gold-600 hover:text-gold-700">
            {t('All resources →', 'Todos los recursos →')}
          </Link>
        </p>
      </div>
    </section>
  );
}

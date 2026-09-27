import { useParams, Link } from 'react-router';
import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { CTASection } from '../components/CTASection';
import { ExternalLinkIcon } from '../components/icons';
import { findGuide, GUIDES, GUIDE_SOURCES } from '../data/guides';
import NotFound from './NotFound';

// SEO 2026-09-27 (CA-SEO-03 / SEO-T3 / SEO-LIVE-05). Página propia para cada
// una de las diez guías educativas que antes vivían en un modal sin URL. El
// texto es el mismo del modal; lo que cambia es que ahora existe como página:
// se puede enlazar, compartir, indexar y prerenderizar. La declaración TPMO, el
// aviso de no afiliación y la comisión los aporta el layout como en toda ruta.
//
// Deliberadamente NO afirma un revisor ni una fecha de revisión: no hay un
// proceso de revisión documentado que lo respalde y una fecha inventada sería
// peor que ninguna. Sí cita las fuentes oficiales, que es lo que un lector y
// un evaluador de calidad pueden comprobar.

function renderLine(line: string, key: number) {
  if (line.trim() === '') return null;
  if (line.startsWith('• ')) return <li key={key} className="ml-5 list-disc text-earth-800 leading-relaxed">{line.slice(2)}</li>;
  return <p key={key} className="text-earth-800 leading-relaxed">{line}</p>;
}

/** Agrupa las viñetas consecutivas en una sola lista para un HTML correcto. */
function renderBody(lines: string[]) {
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (!bullets.length) return;
    out.push(<ul key={'ul' + k} className="space-y-2 my-3">{bullets.map((b, i) => renderLine(b, i))}</ul>);
    bullets = [];
  };
  lines.forEach((line, i) => {
    if (line.startsWith('• ')) { bullets.push(line); return; }
    flush(i);
    const el = renderLine(line, i);
    if (el) out.push(el);
  });
  flush(lines.length);
  return out;
}

export default function Guide() {
  const { slug } = useParams();
  const { t, lang } = useLanguage();
  const lp = useLocalizedPath();
  const guide = findGuide(slug);
  if (!guide) return <NotFound />;

  const lines = lang === 'es' ? guide.es : guide.en;

  return (
    <div className="min-h-screen bg-cream-50">
      <article className="cp-section px-5 pt-14 pb-20 lg:pt-20 lg:pb-28">
        <div className="max-w-3xl mx-auto">
          <nav aria-label={t('Breadcrumb', 'Ruta de navegación')} className="text-sm text-earth-600 mb-6">
            <ol className="flex flex-wrap items-center gap-2">
              <li><Link to={lp('/')} className="hover:text-gold-600 transition-colors">{t('Home', 'Inicio')}</Link></li>
              <li aria-hidden="true">›</li>
              <li><Link to={lp('/resources')} className="hover:text-gold-600 transition-colors">{t('Resources', 'Recursos')}</Link></li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-earth-800">{t(guide.title, guide.titleEs)}</li>
            </ol>
          </nav>

          <span className="inline-block text-[12px] font-bold tracking-wider uppercase text-earth-700 bg-gold-100 px-2.5 py-1 rounded-full mb-4">{t(guide.tag, guide.tagEs)}</span>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-normal text-earth-900 leading-tight mb-4">{t(guide.title, guide.titleEs)}</h1>
          <p className="text-lg text-earth-700 leading-relaxed mb-8">{t(guide.desc, guide.descEs)}</p>

          <div className="bg-white rounded-2xl border border-cream-200 shadow-xs p-6 sm:p-8 space-y-4 text-base">
            {renderBody(lines)}
          </div>

          <p className="text-[13px] text-earth-700 mt-6 leading-relaxed">
            {t(
              'This guide is for general education only. Plan availability, benefits, costs, networks, medications, and eligibility may vary by county, plan, and individual situation. For a specific review, a licensed advisor must verify your information.',
              'Esta guía es solo para educación general. La disponibilidad de planes, beneficios, costos, redes, medicamentos y elegibilidad puede variar por condado, plan y situación personal. Para una revisión específica, un asesor licenciado debe verificar su información.',
            )}
          </p>

          <section aria-labelledby="guide-sources" className="mt-8">
            <h2 id="guide-sources" className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Official sources', 'Fuentes oficiales')}</h2>
            <ul className="flex flex-wrap gap-3">
              {GUIDE_SOURCES.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-gold-600 hover:text-gold-700 min-h-[44px]">
                    {s.name} <ExternalLinkIcon className="w-4 h-4" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* RONDA 8 (F2): cada guía era un callejón sin salida — sin enlaces a las
              demás. Las hermanas van aquí con su título real como texto del enlace. */}
          <section aria-labelledby="guide-siblings" className="mt-10">
            <h2 id="guide-siblings" className="font-serif text-xl font-semibold text-earth-900 mb-3">{t('Other guides', 'Otras guías')}</h2>
            <ul className="grid sm:grid-cols-2 gap-2">
              {GUIDES.filter((g) => g.slug !== guide.slug).map((g) => (
                <li key={g.slug}>
                  <Link to={lp('/resources/' + g.slug)} className="block bg-white border border-cream-200 rounded-lg px-4 py-3 text-sm font-semibold text-earth-800 hover:text-gold-600 hover:shadow-soft transition-all min-h-[44px]">
                    {t(g.title, g.titleEs)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-8">
            <Link to={lp('/resources')} className="inline-flex items-center min-h-[44px] text-sm font-semibold text-earth-800 hover:text-gold-600 transition-colors">
              ← {t('All guides', 'Todas las guías')}
            </Link>
          </p>
        </div>
      </article>

      <CTASection
        headline="Need Personalized Medicare Guidance?"
        headlineEs="¿Necesita Orientación Personalizada de Medicare?"
        subheadline="Our licensed advisors are here to answer your specific questions. Book a free consultation today."
        subheadlineEs="Nuestros asesores licenciados están aquí para responder sus preguntas específicas. Reserve una consulta gratuita hoy."
      />
    </div>
  );
}

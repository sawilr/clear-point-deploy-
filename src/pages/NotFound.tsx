import { Link } from 'react-router';
import { useLanguage } from '../hooks/useLanguage';

// PHASE 7 — Branded 404 with phone CTA so a typo'd URL still drives to support.
export default function NotFound() {
  const { t } = useLanguage();
  return (
    <section className="bg-cream-50 py-20 sm:py-28">
      <div className="max-w-2xl mx-auto px-5 text-center">
        <p className="text-[12px] font-bold tracking-[0.25em] uppercase text-gold-600 mb-3">404</p>
        <h1 className="font-serif text-3xl sm:text-4xl text-earth-900 mb-4 leading-tight">
          {t('We cannot find that page', 'No podemos encontrar esa página')}
        </h1>
        <p className="text-earth-700 text-base leading-relaxed mb-8">
          {t(
            'The page you are looking for may have moved, or the link may be incomplete. Our team can help you find what you need.',
            'La página que busca puede haberse movido, o el enlace puede estar incompleto. Nuestro equipo puede ayudarle a encontrar lo que necesita.'
          )}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
          <Link
            to="/"
            className="cp-btn bg-earth-800 text-cream-50 hover:bg-earth-900 transition-colors"
          >
            {t('Return Home', 'Volver al Inicio')}
          </Link>
          <a
            href="tel:+18663108702"
            className="cp-btn bg-gold-400 text-earth-900 hover:bg-gold-500 transition-colors"
          >
            {t('Call 1-866-310-8702', 'Llamar 1-866-310-8702')}
          </a>
        </div>
        <p className="text-sm text-earth-600">
          {t('Or browse our ', 'O explore nuestros ')}
          <Link to="/resources" className="text-earth-800 underline font-medium hover:text-gold-600">
            {t('Medicare resources', 'recursos de Medicare')}
          </Link>
          {t(' and ', ' y ')}
          <Link to="/support" className="text-earth-800 underline font-medium hover:text-gold-600">
            {t('support center', 'centro de apoyo')}
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

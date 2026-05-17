import { useLanguage } from '../hooks/useLanguage';
import { Link } from 'react-router';
import { CheckIcon, PhoneIcon, CalendarIcon } from './icons';
import { LeadForm } from './LeadForm';

interface HeroProps {
  image: string;
  eyebrow: string;
  eyebrowEs: string;
  headline: string;
  headlineEs: string;
  subheadline: string;
  subheadlineEs: string;
  showForm?: boolean;
  variant?: 'home' | 'page';
  compact?: boolean;
  tighter?: boolean;
}

export function Hero({
  image,
  eyebrow,
  eyebrowEs,
  headline,
  headlineEs,
  subheadline,
  subheadlineEs,
  showForm = false,
  variant = 'home',
  compact = false,
  tighter = false
}: HeroProps) {
  const { t } = useLanguage();

  if (variant === 'page') {
    return (
      <section className={`relative overflow-hidden flex ${compact ? tighter ? 'min-h-[200px] lg:min-h-[240px] items-start' : 'min-h-[220px] lg:min-h-[260px] items-start' : 'min-h-[300px] lg:min-h-[360px] items-center'}`}>
        <div className="absolute inset-0">
          <img src={image} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-earth-900/80 via-earth-900/60 to-earth-900/30" />
        </div>
        <div className={`relative z-10 max-w-6xl mx-auto px-5 w-full ${compact ? tighter ? 'pt-3 pb-8 lg:pt-4 lg:pb-10' : 'pt-8 pb-8 lg:pt-10 lg:pb-10' : 'pt-10 pb-12 lg:pt-14 lg:pb-16'}`}>
          <div className="max-w-2xl">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-2 h-2 rounded-full bg-gold-400" />
              <span className="text-xs font-bold tracking-[0.15em] uppercase text-gold-300">{t(eyebrow, eyebrowEs)}</span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-cream-50 leading-[1.15] mb-5">
              {t(headline, headlineEs)}
            </h1>
            <p className="text-cream-100/80 text-base sm:text-lg leading-relaxed max-w-lg">
              {t(subheadline, subheadlineEs)}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative min-h-[600px] lg:min-h-[720px] flex items-center overflow-hidden">
      <div className="absolute inset-0">
        <img src={image} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-earth-900/80 via-earth-900/60 to-earth-900/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-earth-900/50 via-transparent to-earth-900/20" />
      </div>
      <div className="relative z-10 max-w-6xl mx-auto px-5 py-20 lg:py-28 w-full">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="text-cream-50">
            <div className="flex items-center gap-2.5 mb-6">
              <div className="w-2 h-2 rounded-full bg-gold-400" />
              <span className="text-xs font-bold tracking-[0.15em] uppercase text-gold-300">{t(eyebrow, eyebrowEs)}</span>
            </div>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] font-medium leading-[1.15] mb-6" dangerouslySetInnerHTML={{ __html: t(headline, headlineEs) }} />
            <p className="text-cream-100/80 text-base sm:text-lg leading-relaxed max-w-lg mb-8">
              {t(subheadline, subheadlineEs)}
            </p>
            <div className="flex flex-wrap gap-3 mb-10">
              <Link to="/contact" className="inline-flex items-center gap-2 bg-gold-400 text-earth-900 font-bold text-sm px-6 py-3.5 rounded-xl hover:bg-gold-300 transition-all hover:shadow-lifted">
                <CalendarIcon className="w-4 h-4" />
                {t('Schedule Free Consultation', 'Agendar Consulta Gratis')}
              </Link>
              <a href="tel:18663108702" className="inline-flex items-center gap-2 border border-cream-50/30 text-cream-50 font-semibold text-sm px-6 py-3.5 rounded-xl hover:bg-cream-50/10 transition-all">
                <PhoneIcon className="w-4 h-4" />
                1-866-310-8702
              </a>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              {[
                t('100% Free Service', 'Servicio 100% Gratis'),
                t('No Obligation', 'Sin Compromiso'),
                t('Bilingual Advisors', 'Asesores Bilingües'),
                t('Licensed & Independent', 'Licenciados e Independientes'),
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 text-cream-100/70 text-sm">
                  <CheckIcon className="w-4 h-4 text-gold-400 flex-shrink-0" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          {showForm && (
            <div>
              <LeadForm variant="hero-inline" source="homepage-hero" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

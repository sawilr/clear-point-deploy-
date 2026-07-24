import { useLanguage } from '../hooks/useLanguage';
import { useNavigate } from 'react-router';
import { CheckIcon, PhoneIcon, CalendarIcon } from './icons';
import { LeadForm } from './LeadForm';
import { PictureImg } from './PictureImg';

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
  const navigate = useNavigate();
  // Sawil 2026-06: "Schedule Free Consultation" must land DIRECTLY on the
  // lead form with focus, not at the top of /contact. Mirrors the helper
  // used by Header / MobileStickyBar / CTASection / MedicareSupplement.
  function handleFreeReview() {
    navigate('/contact?focus=name');
    setTimeout(() => {
      const el = document.getElementById('lead-form-heading');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const firstNameInput = document.querySelector('input[name="first_name"]') as HTMLInputElement | null;
      firstNameInput?.focus();
    }, 250);
  }

  if (variant === 'page') {
    return (
      <section className={`relative overflow-hidden flex ${compact ? tighter ? 'cp-hero-compact-tight items-start' : 'cp-hero-compact items-start' : 'cp-hero-page items-center'}`}>
        <div className="absolute inset-0" aria-hidden="true">
          <PictureImg src={image} alt="" role="presentation" aria-hidden={true} fetchPriority="high" className="cp-hero-img w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-earth-900/80 via-earth-900/60 to-earth-900/30" />
        </div>
        <div className={`relative z-10 max-w-6xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-5 w-full ${compact ? tighter ? 'pt-3 pb-8 lg:pt-4 lg:pb-10' : 'pt-8 pb-8 lg:pt-10 lg:pb-10' : 'pt-10 pb-12 lg:pt-14 lg:pb-16'}`}>
          <div className="max-w-2xl">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="w-2 h-2 rounded-full bg-gold-400" />
              <span className="text-xs font-bold tracking-[0.15em] uppercase text-gold-300">{t(eyebrow, eyebrowEs)}</span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-medium text-cream-50 leading-[1.2] mb-5">
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
    <section className="cp-hero-home relative flex items-center overflow-hidden">
      <div className="absolute inset-0" aria-hidden="true">
        <PictureImg src={image} alt="" role="presentation" aria-hidden={true} fetchPriority="high" className="cp-hero-img w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-earth-900/80 via-earth-900/60 to-earth-900/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-earth-900/50 via-transparent to-earth-900/20" />
      </div>
      <div className="relative z-10 max-w-6xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-5 py-16 md:py-20 lg:py-28 w-full">
        <div className="grid md:grid-cols-2 gap-8 md:gap-12 lg:gap-16 items-center">
          <div className="text-cream-50">
            <div className="flex items-center gap-2.5 mb-6">
              <div className="w-2 h-2 rounded-full bg-gold-400" />
              <span className="text-xs font-bold tracking-[0.15em] uppercase text-gold-300">{t(eyebrow, eyebrowEs)}</span>
            </div>
            {/* Sawil 2026-07-16 SECURITY INFO-2 — this sink renders ONLY hardcoded,
                developer-authored headline strings passed by page components (e.g.
                Home.tsx uses an inline <span class="text-gold-400"> for the gold
                accent). It is NOT convertible to plain JSX without losing that
                inline markup and changing the design. SAFE because no user/URL/API
                input ever reaches `headline`/`headlineEs`. HARD RULE: never pass
                untrusted or user-derived content into these props. */}
            <h1 className="font-serif text-[2.25rem] sm:text-5xl lg:text-[3.25rem] 2xl:text-[3.4rem] 3xl:text-[3.6rem] font-medium leading-[1.2] mb-6 break-words" dangerouslySetInnerHTML={{ __html: t(headline, headlineEs) }} />
            <p className="text-cream-100/80 text-base sm:text-lg leading-relaxed max-w-lg mb-8">
              {t(subheadline, subheadlineEs)}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <button type="button" onClick={handleFreeReview} className="cp-btn bg-gold-400 text-earth-900 hover:bg-gold-300 transition-all hover:shadow-lifted active:scale-[0.98] w-full sm:w-auto">
                <CalendarIcon className="w-4 h-4" />
                {t('Schedule Free Consultation', 'Agendar Consulta Gratis')}
              </button>
              <a href="tel:18557208555" className="cp-btn border border-cream-50/30 text-cream-50 hover:bg-cream-50/10 transition-all active:scale-[0.98] w-full sm:w-auto">
                <PhoneIcon className="w-4 h-4" />
                1-855-720-8555
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

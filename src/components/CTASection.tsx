import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from './ScrollReveal';
import { PhoneIcon, CalendarIcon } from './icons';
import { Link, useNavigate } from 'react-router';

interface CTASectionProps {
  headline: string;
  headlineEs: string;
  subheadline: string;
  subheadlineEs: string;
  primaryCta?: string;
  primaryCtaEs?: string;
  secondaryCta?: string;
  secondaryCtaEs?: string;
  primaryHref?: string;
  onPrimaryClick?: () => void;
  variant?: 'gold' | 'dark';
}

export function CTASection({
  headline,
  headlineEs,
  subheadline,
  subheadlineEs,
  primaryCta,
  primaryCtaEs,
  secondaryCta,
  secondaryCtaEs,
  primaryHref = '/contact',
  onPrimaryClick,
  variant = 'gold',
}: CTASectionProps) {
  const { t } = useLanguage();
  const { ref, visible } = useScrollReveal();
  const navigate = useNavigate();

  // When primaryHref points to /contact, navigate then scroll to form + focus first name.
  // Works from any page. onPrimaryClick prop overrides this (e.g. Contact page itself).
  const handleContactNav = () => {
    // `?focus=name` signals LeadForm to autofocus the First Name field on mount.
    navigate('/contact?focus=name');
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#lead-form-heading');
      if (el) {
        // Top bar (~28 px) + sticky nav (h-[70px]) ≈ 98 px stack; 100 px clears it.
        const headerOffset = 100;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
        // iOS Safari won't auto-open keyboard from programmatic focus (gesture
        // flag expired); user taps the field to open keyboard. Field will be
        // visible and ready.
        setTimeout(() => {
          const firstInput = document.querySelector<HTMLInputElement>('[name="first_name"]');
          if (firstInput) firstInput.focus();
        }, 500);
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    // 30-frame retry (~500ms @ 60fps) absorbs HashRouter commit + Contact
    // mount on mid-range mobile. Matches Header.tsx + MobileStickyBar timing.
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(30)));
  };

  const primaryBtnClass = `inline-flex items-center justify-center gap-2 font-bold text-base px-5 sm:px-7 py-3.5 min-h-[48px] rounded-xl transition-all hover:shadow-soft active:scale-[0.98] whitespace-nowrap ${
    variant === 'gold'
      ? 'bg-earth-800 text-cream-50 hover:bg-earth-900'
      : 'bg-gold-400 text-earth-900 hover:bg-gold-300'
  }`;

  const primaryLabel = t(primaryCta || 'Get Free Plan Review', primaryCtaEs || 'Obtener Revisión Gratis');

  // Resolve which handler / element to use for the primary CTA
  const resolvedClick = onPrimaryClick ?? (primaryHref === '/contact' ? handleContactNav : undefined);

  return (
    <section ref={ref} className={`py-14 sm:py-16 lg:py-20 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${variant === 'gold' ? 'bg-gold-200' : 'bg-earth-800'}`}>
      <div className="max-w-3xl lg:max-w-4xl 2xl:max-w-5xl 3xl:max-w-6xl mx-auto px-5 text-center">
        <h2 className={`font-serif text-3xl sm:text-4xl font-normal leading-snug mb-4 ${variant === 'gold' ? 'text-earth-900' : 'text-cream-50'}`}>
          {t(headline, headlineEs)}
        </h2>
        <p className={`text-base leading-relaxed mb-8 max-w-xl mx-auto ${variant === 'gold' ? 'text-earth-700' : 'text-cream-100/70'}`}>
          {t(subheadline, subheadlineEs)}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {resolvedClick ? (
            <button onClick={resolvedClick} className={primaryBtnClass}>
              <CalendarIcon className="w-4 h-4" />
              {primaryLabel}
            </button>
          ) : (
            <Link to={primaryHref} className={primaryBtnClass}>
              <CalendarIcon className="w-4 h-4" />
              {primaryLabel}
            </Link>
          )}
          <a
            href="tel:18663108702"
            className={`inline-flex items-center justify-center gap-2 font-bold text-base px-5 sm:px-7 py-3.5 min-h-[48px] rounded-xl border transition-all active:scale-[0.98] whitespace-nowrap ${
              variant === 'gold'
                ? 'bg-cream-50 text-earth-900 border-earth-800/15 hover:border-earth-800'
                : 'border-cream-50/30 text-cream-50 hover:bg-cream-50/10'
            }`}
          >
            <PhoneIcon className="w-4 h-4" />
            {t(secondaryCta || 'Call 1-866-310-8702', secondaryCtaEs || 'Llamar 1-866-310-8702')}
          </a>
        </div>
      </div>
    </section>
  );
}

import { useLanguage } from '../hooks/useLanguage';
import { useScrollReveal } from './ScrollReveal';
import { PhoneIcon, CalendarIcon } from './icons';
import { Link } from 'react-router';

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
  variant = 'gold',
}: CTASectionProps) {
  const { t } = useLanguage();
  const { ref, visible } = useScrollReveal();

  return (
    <section ref={ref} className={`py-20 lg:py-24 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${variant === 'gold' ? 'bg-gold-200' : 'bg-earth-800'}`}>
      <div className="max-w-3xl mx-auto px-5 text-center">
        <h2 className={`font-serif text-3xl sm:text-4xl lg:text-[2.6rem] font-normal leading-snug mb-4 ${variant === 'gold' ? 'text-earth-900' : 'text-cream-50'}`}>
          {t(headline, headlineEs)}
        </h2>
        <p className={`text-base leading-relaxed mb-8 max-w-xl mx-auto ${variant === 'gold' ? 'text-earth-700' : 'text-cream-100/70'}`}>
          {t(subheadline, subheadlineEs)}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to={primaryHref}
            className={`inline-flex items-center gap-2 font-bold text-sm px-7 py-3.5 rounded-xl transition-all hover:shadow-soft ${
              variant === 'gold'
                ? 'bg-earth-800 text-cream-50 hover:bg-earth-900'
                : 'bg-gold-400 text-earth-900 hover:bg-gold-300'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            {t(primaryCta || 'Get Free Plan Review', primaryCtaEs || 'Obtener Revisión Gratis')}
          </Link>
          <a
            href="tel:18663108702"
            className={`inline-flex items-center gap-2 font-bold text-sm px-7 py-3.5 rounded-xl border transition-all ${
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

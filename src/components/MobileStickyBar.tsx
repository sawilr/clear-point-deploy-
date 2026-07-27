import { useNavigate } from 'react-router';
import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { PhoneIcon, CalendarIcon } from './icons';

export function MobileStickyBar() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // Sawil 2026-07-27 ES ROUTES — CTA stays inside /es while browsing Spanish.
  const lp = useLocalizedPath();

  const handleFreeReview = () => {
    // `?focus=name` signals LeadForm to autofocus the First Name field on mount.
    navigate(lp('/contact') + '?focus=name');
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#lead-form-heading');
      if (el) {
        // Top bar + sticky nav ~98 px stack; 100 px clears it.
        const headerOffset = 100;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
        setTimeout(() => {
          const firstInput = document.querySelector<HTMLInputElement>('[name="first_name"]');
          if (firstInput) firstInput.focus();
        }, 500);
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    // 30-frame retry (~500 ms) absorbs HashRouter commit + Contact mount
    // on mid-range mobile. Matches Header.tsx Free Review CTA.
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(30)));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-earth-900/95 backdrop-blur-sm border-t border-cream-50/10 pt-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-3 md:hidden">
      <a href="tel:18557208555" className="flex-1 flex items-center justify-center gap-2 border border-cream-50/20 text-cream-50 text-base font-semibold py-3 min-h-[44px] rounded-lg hover:bg-cream-50/5 transition-colors whitespace-nowrap">
        <PhoneIcon className="w-4 h-4 flex-shrink-0" />
        {t('Call Now', 'Llamar')}
      </a>
      <button onClick={handleFreeReview} className="flex-1 flex items-center justify-center gap-2 bg-gold-400 text-earth-900 text-base font-bold py-3 min-h-[44px] rounded-lg hover:bg-gold-300 transition-colors whitespace-nowrap">
        <CalendarIcon className="w-4 h-4 flex-shrink-0" />
        {t('Free Review', 'Revisión Gratis')}
      </button>
    </div>
  );
}

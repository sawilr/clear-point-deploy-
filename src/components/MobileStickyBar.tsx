import { useNavigate } from 'react-router';
import { useLanguage } from '../hooks/useLanguage';
import { PhoneIcon, CalendarIcon } from './icons';

export function MobileStickyBar() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleFreeReview = () => {
    navigate('/contact');
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#contact-form');
      if (el) {
        const headerOffset = 80;
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
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(10)));
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-earth-900/95 backdrop-blur-sm border-t border-cream-50/10 pt-3 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-3 md:hidden">
      <a href="tel:18663108702" className="flex-1 flex items-center justify-center gap-2 border border-cream-50/20 text-cream-50 text-sm font-semibold py-2.5 rounded-lg hover:bg-cream-50/5 transition-colors">
        <PhoneIcon className="w-4 h-4" />
        {t('Call Now', 'Llamar')}
      </a>
      <button onClick={handleFreeReview} className="flex-1 flex items-center justify-center gap-2 bg-gold-400 text-earth-900 text-sm font-bold py-2.5 rounded-lg hover:bg-gold-300 transition-colors">
        <CalendarIcon className="w-4 h-4" />
        {t('Free Review', 'Revisión Gratis')}
      </button>
    </div>
  );
}

import type { Lang } from '../hooks/useLanguage';

interface LanguageToggleProps {
  lang: Lang;
  setLang: (l: Lang) => void;
  variant?: 'topbar' | 'nav';
}

export function LanguageToggle({ lang, setLang, variant = 'topbar' }: LanguageToggleProps) {
  if (variant === 'nav') {
    return (
      <div className="flex bg-cream-50/10 rounded-full p-0.5 gap-0.5" role="group" aria-label="Language selector">
        <button
          onClick={() => setLang('en')}
          className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wider transition-all ${
            lang === 'en' ? 'bg-gold-400 text-earth-900' : 'text-earth-700 hover:text-earth-900'
          }`}
          aria-pressed={lang === 'en'}
        >
          EN
        </button>
        <button
          onClick={() => setLang('es')}
          className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wider transition-all ${
            lang === 'es' ? 'bg-gold-400 text-earth-900' : 'text-earth-700 hover:text-earth-900'
          }`}
          aria-pressed={lang === 'es'}
        >
          ES
        </button>
      </div>
    );
  }

  return (
    <div className="flex bg-cream-50/10 rounded-full p-0.5 gap-0.5" role="group" aria-label="Language selector">
      <button
        onClick={() => setLang('en')}
        className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wider transition-all ${
          lang === 'en' ? 'bg-gold-400 text-earth-900' : 'text-cream-50/60 hover:text-cream-50'
        }`}
        aria-pressed={lang === 'en'}
      >
        EN
      </button>
      <button
        onClick={() => setLang('es')}
        className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-wider transition-all ${
          lang === 'es' ? 'bg-gold-400 text-earth-900' : 'text-cream-50/60 hover:text-cream-50'
        }`}
        aria-pressed={lang === 'es'}
      >
        ES
      </button>
    </div>
  );
}

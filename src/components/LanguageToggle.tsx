import type { Lang } from '../hooks/useLanguage';

interface LanguageToggleProps {
  lang: Lang;
  setLang: (l: Lang) => void;
  variant?: 'topbar' | 'nav';
}

// PHASE 6 — bumped to ≥44×44 px hit target (WCAG 2.5.5) and 12px text
// for the senior audience while keeping the chip visually compact.
//
// Sawil 2026-07-28 AUDIT CPF-003 — the wrapper carries `data-lang-switch`.
// This is the ONE control allowed to cross the EN ↔ /es URL boundary, so
// scripts/es-link-scan.mjs uses the attribute to exempt it from the "no
// English links on Spanish pages" assertion. Keep the attribute if this
// ever renders <a href> instead of <button>.
const BTN_BASE =
  'rounded-full text-[12px] font-bold tracking-wider transition-all inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3';

export function LanguageToggle({ lang, setLang, variant = 'topbar' }: LanguageToggleProps) {
  if (variant === 'nav') {
    return (
      <div className="flex bg-cream-50/10 rounded-full p-0.5 gap-0.5" role="group" aria-label="Language selector" data-lang-switch>
        <button
          onClick={() => setLang('en')}
          className={`${BTN_BASE} ${
            lang === 'en' ? 'bg-gold-400 text-earth-900' : 'text-earth-700 hover:text-earth-900'
          }`}
          aria-pressed={lang === 'en'}
          aria-label="Switch to English"
        >
          EN
        </button>
        <button
          onClick={() => setLang('es')}
          className={`${BTN_BASE} ${
            lang === 'es' ? 'bg-gold-400 text-earth-900' : 'text-earth-700 hover:text-earth-900'
          }`}
          aria-pressed={lang === 'es'}
          aria-label="Cambiar a Español"
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
        className={`${BTN_BASE} ${
          lang === 'en' ? 'bg-gold-400 text-earth-900' : 'text-cream-50/70 hover:text-cream-50'
        }`}
        aria-pressed={lang === 'en'}
        aria-label="Switch to English"
      >
        EN
      </button>
      <button
        onClick={() => setLang('es')}
        className={`${BTN_BASE} ${
          lang === 'es' ? 'bg-gold-400 text-earth-900' : 'text-cream-50/70 hover:text-cream-50'
        }`}
        aria-pressed={lang === 'es'}
        aria-label="Cambiar a Español"
      >
        ES
      </button>
    </div>
  );
}

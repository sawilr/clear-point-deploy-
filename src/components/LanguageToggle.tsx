import { useLocation } from 'react-router';
import { toEnglishPath, toSpanishPath, type Lang } from '../hooks/useLanguage';

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
// English links on Spanish pages" assertion.
//
// SEO 2026-09-27 (SEO-T4, alto impacto). Los dos árboles, inglés y español,
// estaban aislados entre sí: cero enlaces cruzaban la frontera de idioma en
// ninguna dirección, porque este selector eran <button> con onClick. El árbol
// /es —la superficie con menos competencia— no recibía ninguna autoridad
// interna. Ahora son <a href> reales al gemelo de la ruta actual, con
// hreflang, y el clic sigue navegando dentro de la SPA sin recarga. Un
// rastreador ve el enlace; una persona ve el mismo chip de siempre.
const BTN_BASE =
  'rounded-full text-[12px] font-bold tracking-wider transition-all inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3';

// Rutas sin gemelo /es (enlaces seguros por usuario): el selector sigue
// cambiando el idioma en la misma página y el href apunta a la propia ruta.
const NO_ES_TWIN = /^\/soa\//;

export function LanguageToggle({ lang, setLang, variant = 'topbar' }: LanguageToggleProps) {
  const { pathname, search, hash } = useLocation();
  const base = toEnglishPath(pathname);
  const twinless = NO_ES_TWIN.test(base);
  const hrefEn = (twinless ? pathname : base) + search + hash;
  const hrefEs = (twinless ? pathname : toSpanishPath(pathname)) + search + hash;

  const inactive = variant === 'nav' ? 'text-earth-700 hover:text-earth-900' : 'text-cream-50/70 hover:text-cream-50';
  const wrap = variant === 'nav' ? 'flex bg-cream-50/10 rounded-full p-0.5 gap-0.5' : 'flex bg-cream-50/10 rounded-full p-0.5 gap-0.5';

  const link = (l: Lang, href: string, label: string, aria: string) => (
    <a
      href={href}
      hrefLang={l}
      lang={l}
      onClick={(e) => { e.preventDefault(); setLang(l); }}
      className={`${BTN_BASE} ${lang === l ? 'bg-gold-400 text-earth-900' : inactive}`}
      aria-current={lang === l ? 'true' : undefined}
      aria-label={aria}
      data-lang-switch
    >
      {label}
    </a>
  );

  return (
    <div className={wrap} role="group" aria-label="Language selector" data-lang-switch>
      {link('en', hrefEn, 'EN', 'Switch to English')}
      {link('es', hrefEs, 'ES', 'Cambiar a Español')}
    </div>
  );
}

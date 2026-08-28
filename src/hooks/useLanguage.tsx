import { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';

export type Lang = 'en' | 'es';

const STORAGE_KEY = 'clearpoint_lang';

// Sawil 2026-07-27 ES ROUTES (SEO) — every content page now has an indexable
// Spanish twin under /es (e.g. /es/medicare-advantage). These helpers are the
// single source of truth for mapping between the EN and ES URL spaces.
export function isSpanishPath(pathname: string): boolean {
  return pathname === '/es' || pathname.startsWith('/es/');
}

/** Strip the /es prefix: '/es' → '/', '/es/about' → '/about'. EN paths pass through. */
export function toEnglishPath(pathname: string): string {
  return pathname === '/es' ? '/' : pathname.replace(/^\/es\//, '/');
}

/** Add the /es prefix: '/' → '/es', '/about' → '/es/about'. Already-ES paths pass through. */
export function toSpanishPath(pathname: string): string {
  const base = toEnglishPath(pathname);
  return base === '/' ? '/es' : `/es${base}`;
}

// Routes with NO /es twin: /soa/:token (per-user, 24h secure links — never
// indexed) and /thank-you (post-submit confirmation, noindex). Switching
// language on these stays client-side only, exactly as before.
const NO_ES_TWIN = /^\/(soa\/|thank-you$)/;

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (en: string, es: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Sawil 2026-07-27 ES ROUTES — the URL wins: any /es URL is Spanish no matter
  // what the stored preference or browser language says. English URLs keep the
  // original behavior (stored preference → browser language → 'en').
  // Provider is mounted inside <BrowserRouter> (see main.tsx), so useLocation
  // is safe and covers back/forward (popstate) navigation too.
  const { pathname } = useLocation();
  const urlIsSpanish = isSpanishPath(pathname);

  const [storedLang, setLangState] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      // PHASE 6 — Safari Private Browsing throws SecurityError on localStorage.
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'es' || saved === 'en') return saved;
      } catch { /* private mode — fall through to browser-lang */ }
      const browserLang = navigator.language || (navigator as any).userLanguage || '';
      if (browserLang.toLowerCase().startsWith('es')) return 'es';
    }
    return 'en';
  });

  // AUDIT 2026-08-27 (finding #8, part 2) — the URL space decides the content
  // language in BOTH directions: /es/* is Spanish (as before) and an explicit
  // English URL renders English even when the stored preference is Spanish —
  // URL, content and hreflang can never disagree. The stored preference still
  // personalizes the root landing (redirect effect below) and still decides
  // the language on routes with no /es twin (/soa/*, /thank-you), where
  // switching is client-side by design.
  const lang: Lang = urlIsSpanish ? 'es' : (NO_ES_TWIN.test(pathname) ? storedLang : 'en');

  // Sawil 2026-07-27 AUDIT CP-001 — a Spanish-preference visitor landing on an
  // ENGLISH URL that has an /es twin is redirected once (replace, first load
  // only) so URL, content and hreflang never disagree. Not keyed on later
  // navigations: an explicit EN toggle sets the stored pref to 'en' first, so
  // this can never loop against it.
  const navigate = useNavigate();
  const [redirectChecked, setRedirectChecked] = useState(false);
  useEffect(() => {
    if (redirectChecked) return;
    setRedirectChecked(true);
    // AUDIT 2026-08-27 (finding #8) — the preference redirect fires ONLY from
    // the root landing. A deep English URL (paid-campaign landing, shared
    // link, direct visit) is an explicit content request; hijacking it to
    // /es/* on a stored preference contradicted the "URL wins" rule this
    // provider already applies to /es URLs. Root '/' carries no explicit
    // language intent, so personalization still applies there.
    if (storedLang === 'es' && pathname === '/' && !urlIsSpanish) {
      navigate(toSpanishPath(pathname) + window.location.search + window.location.hash, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Landing on an /es URL updates the stored preference so the choice persists
  // if the user later follows a link into the English URL space. Keyed on
  // pathname ONLY: re-syncing on storedLang would race the EN toggle while
  // react-router's startTransition navigation is still pending on /es/*.
  useEffect(() => {
    if (isSpanishPath(pathname)) setLangState('es');
  }, [pathname]);

  // AUDIT 2026-08-27 (finding #8, part 3) — persist only the PREFERENCE
  // (explicit toggles and /es visits mutate storedLang), never the
  // URL-derived display language: a Spanish-preference visitor who follows
  // one English link must not have their stored preference silently flipped
  // to 'en' by the visit itself.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, storedLang); } catch { /* private mode */ }
  }, [storedLang]);

  // Sawil 2026-06 — keep <html lang> in sync with the DISPLAYED language so
  // screen readers pronounce the page correctly (index.html hardcodes "en";
  // without this, Spanish content is read with an English accent).
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
  }, []);

  const t = useCallback((en: string, es: string) => {
    return lang === 'es' ? es : en;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}

// Sawil 2026-07-27 ES ROUTES — language switch that also moves the URL into the
// matching language space: ES on /about → /es/about, EN on /es/about → /about
// (search + hash preserved). Routes without an /es twin (/soa/*, /thank-you)
// switch client-side only, as before. Used by the header LanguageToggle and by
// Zara's language chips.
export function useLanguageNavigate(): (l: Lang) => void {
  const { setLang } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback((l: Lang) => {
    setLang(l);
    const { pathname, search, hash } = location;
    const base = toEnglishPath(pathname);
    if (NO_ES_TWIN.test(base)) return;
    const target = l === 'es' ? toSpanishPath(pathname) : base;
    if (target !== pathname) navigate(target + search + hash);
  }, [setLang, navigate, location]);
}

// Sawil 2026-07-27 ES ROUTES — returns a function that prefixes internal link
// targets with /es while the visitor is browsing the Spanish URL space, so
// navigation (and crawlers following it) stays inside /es/*.
export function useLocalizedPath(): (path: string) => string {
  const { pathname } = useLocation();
  const urlIsSpanish = isSpanishPath(pathname);
  return useCallback((path: string) => {
    if (!urlIsSpanish || isSpanishPath(path) || NO_ES_TWIN.test(path)) return path;
    return path === '/' ? '/es' : `/es${path}`;
  }, [urlIsSpanish]);
}

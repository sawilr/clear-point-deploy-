import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { LanguageToggle } from './LanguageToggle';
import { LogoSvg } from './LogoSvg';
import { PhoneIcon, MenuIcon, CloseIcon, ChevronDown } from './icons';
import { Link, useLocation, useNavigate } from 'react-router';

// Top nav text links — Services and Education are rendered as dropdowns
// separately (NOT in this array). Spanish "Smart Review" → "Revisión Inteligente"
// (proper translation, per Sawil's bilingual-parity directive). Spanish header
// fits cleanly because (a) phone gates to 2xl, (b) header switches to hamburger
// below 1024px, (c) gap reduced at lg.
const navLinks = [
  { label: 'Smart Review', labelEs: 'Revisión Inteligente', href: '/#smart-review', scroll: true },
  { label: 'Annual Review', labelEs: 'Revisión Anual', href: '/#annual-review', scroll: true },
  { label: 'How It Works', labelEs: 'Cómo Funciona', href: '/#how', scroll: true },
  { label: 'About', labelEs: 'Nosotros', href: '/about', scroll: false },
  { label: 'Contact', labelEs: 'Contacto', href: '/contact', scroll: false },
];

export function Header() {
  const { lang, setLang, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [educationOpen, setEducationOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const servicesRef = useRef<HTMLDivElement>(null);
  const educationRef = useRef<HTMLDivElement>(null);

  /* Close dropdowns on outside click, Escape key, and route change */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (servicesRef.current && !servicesRef.current.contains(e.target as Node)) {
        setServicesOpen(false);
      }
      if (educationRef.current && !educationRef.current.contains(e.target as Node)) {
        setEducationOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setServicesOpen(false);
        setEducationOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  /* Close dropdowns when route changes */
  useEffect(() => {
    setServicesOpen(false);
    setEducationOpen(false);
  }, [location.pathname]);

  /* Sawil 2026-06 — while the mobile menu is open, hide the floating Zara
     "Ayuda" launcher so it does not overlap the menu items. Toggles a class
     on <html>; index.css hides .cp-zara-fab when .cp-menu-open is present. */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('cp-menu-open', mobileMenuOpen);
    return () => { document.documentElement.classList.remove('cp-menu-open'); };
  }, [mobileMenuOpen]);

  const scrollTo = (id: string) => {
    const el = document.querySelector(id);
    if (el) {
      // Top bar (~28 px) + sticky nav (h-[70px]) ≈ 98 px stack; 100 px clears it
      // so the section heading isn't hidden under the sticky header.
      const headerOffset = 100;
      const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
      setServicesOpen(false);
      setMobileMenuOpen(false);
    }
  };

  const closeNav = () => {
    setServicesOpen(false);
    setEducationOpen(false);
    setMobileMenuOpen(false);
  };

  // Free Review — navigates to /contact and scrolls to the contact form section.
  // rAF retry waits for React to commit /contact route before querying #contact-form.
  const handleFreeReview = () => {
    closeNav();
    // `?focus=name` signals LeadForm to position the cursor on the First Name
    // field when it mounts — works reliably on mobile where the gesture chain
    // expires before setTimeout-based focus would fire.
    navigate('/contact?focus=name');
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#lead-form-heading');
      if (el) {
        // Heading element has scroll-mt-[100px] CSS — using it directly so
        // mobile lands on the visible form title, not the section wrapper above.
        const headerOffset = 100;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
        // Focus first name field so the cursor lands in the form on desktop.
        // On iPhone Safari the user-gesture flag has expired by the time this
        // setTimeout fires, so the soft keyboard will not auto-open — that's
        // acceptable per UX spec: the field will be visible and ready for tap.
        setTimeout(() => {
          const firstInput = document.querySelector<HTMLInputElement>('[name="first_name"]');
          if (firstInput) firstInput.focus();
        }, 500);
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    // Retry up to ~30 frames (≈500ms at 60fps). The prior 10-frame budget
    // (~160ms) was exceeded on iPhone Safari when navigating from non-/contact
    // routes — HashRouter commit + Contact mount + scroll-reveal observers can
    // take longer on mid-range mobile, causing the scroll to silently fail.
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(30)));
  };

  const isHome = location.pathname === '/';

  /* Navigate to home then scroll to section — fixes broken nav from non-home pages.
     Defer scrollTo via double-rAF so closeNav()'s menu-drawer close commits BEFORE
     we measure scroll target — otherwise on mobile the open mobile menu pushes
     sections down, scroll target uses stale position, and the section overshoots
     and lands above the viewport (sectionTop becomes negative). */
  const handleScrollNav = (href: string) => {
    closeNav();
    const id = href.replace('/#', '#');
    if (isHome) {
      requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(id)));
      return;
    }
    navigate('/');
    // Double rAF + 30-frame retry budget (~500 ms at 60 fps) absorbs
    // HashRouter commit + Home page mount + scroll-reveal observers on
    // mid-range mobile. Matches the proven Free Review CTA pattern.
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector(id);
      if (el) {
        // Top bar (~28 px) + sticky nav (h-[70px]) ≈ 98 px stack; 100 px clears it.
        const headerOffset = 100;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(30)));
  };

  return (
    <>
      {/* Top Bar — uses nowrap on the whole row so LanguageToggle stays inline at 320px */}
      <div className="bg-earth-900 text-cream-50/80 text-xs py-2.5">
        <div className="max-w-6xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-5 flex items-center justify-between gap-2 flex-nowrap">
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <PhoneIcon className="w-3.5 h-3.5 text-gold-400 flex-shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">{t('Call us free: ', 'Llámenos gratis: ')}</span>
            <a href="tel:18663108702" className="text-gold-400 font-semibold hover:text-cream-50 transition-colors whitespace-nowrap">1-866-310-8702</a>
            <span className="hidden md:inline whitespace-nowrap">&nbsp;|&nbsp; TTY: 711 &nbsp;|&nbsp; {t('Mon–Fri 9am–6pm ET', 'Lun–Vie 9am–6pm ET')}</span>
          </span>
          <div className="flex-shrink-0">
            <LanguageToggle lang={lang} setLang={setLang} variant="topbar" />
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-cream-50/90 backdrop-blur-md border-b border-cream-200">
        <div className="max-w-6xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-5">
          <div className="flex items-center justify-between h-[70px]">
            {/* Logo */}
            <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); window.scrollTo(0, 0); }} className="flex items-center gap-3 group cursor-pointer flex-shrink-0" aria-label={t('Clear Point Senior Advisors — Go to homepage', 'Clear Point Senior Advisors — Ir a la página principal')}>
              <div className="transition-transform group-hover:scale-105 flex-shrink-0">
                <LogoSvg size={40} />
              </div>
              <div className="flex flex-col leading-tight whitespace-nowrap">
                <span className="font-serif text-lg font-bold text-earth-900 tracking-tight whitespace-nowrap leading-[1.1]">Clear Point</span>
                <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-gold-500 mt-1 whitespace-nowrap">{t('Senior Advisors', 'Senior Advisors')}</span>
              </div>
            </a>

            {/* Desktop Nav — tighter gap at lg to fit longer Spanish labels without
                squeezing the logo. Spanish "Revisión Inteligente" + "Períodos de
                Inscripción" et al. add ~80px to row width vs English. */}
            <div className="hidden lg:flex items-center gap-2 2xl:gap-4">
              {/* Services dropdown — products / coverage categories ClearPoint
                  is authorized to broker. Medicare Supplement / Medigap MOVED to
                  Education (per Sawil 2026-06: pending broker authorization). */}
              <div className="relative" ref={servicesRef}>
                <button
                  onClick={() => { setServicesOpen(!servicesOpen); setEducationOpen(false); }}
                  className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors flex items-center gap-1 whitespace-nowrap px-1 min-h-[44px]"
                  aria-expanded={servicesOpen}
                  aria-haspopup="menu"
                >
                  {t('Services', 'Servicios')}
                  <ChevronDown className={`w-3 h-3 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} />
                </button>
                {servicesOpen && (
                  <div role="menu" className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-card border border-cream-200 py-2 z-50">
                    <Link to="/medicare-advantage" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900 whitespace-nowrap" onClick={closeNav}>{t('Medicare Advantage', 'Medicare Advantage')}</Link>
                    {/* HIDDEN per Sawil 2026-06 — Medicare Supplement / Medigap relocated to Education dropdown below until ClearPoint is broker-authorized. */}
                    {/* <Link to="/medicare-supplement" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900 whitespace-nowrap" onClick={closeNav}>{t('Medicare Supplement', 'Suplemento Medicare')}</Link> */}
                    <Link to="/part-d" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900 whitespace-nowrap" onClick={closeNav}>{t('Part D Drug Plans', 'Planes de Medicamentos Parte D')}</Link>
                  </div>
                )}
              </div>

              {/* Education dropdown — learning + assistance topics. Houses Extra Help
                  / LIS (federal assistance program — not a sellable service) and
                  Medicare Supplement (educational reference — pending authorization). */}
              <div className="relative" ref={educationRef}>
                <button
                  onClick={() => { setEducationOpen(!educationOpen); setServicesOpen(false); }}
                  className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors flex items-center gap-1 whitespace-nowrap px-1 min-h-[44px]"
                  aria-expanded={educationOpen}
                  aria-haspopup="menu"
                >
                  {t('Education', 'Educación')}
                  <ChevronDown className={`w-3 h-3 transition-transform ${educationOpen ? 'rotate-180' : ''}`} />
                </button>
                {educationOpen && (
                  <div role="menu" className="absolute top-full left-0 mt-2 w-72 bg-white rounded-xl shadow-card border border-cream-200 py-2 z-50">
                    <Link to="/resources" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Medicare Basics', 'Conceptos Básicos de Medicare')}</Link>
                    <button onClick={() => { handleScrollNav('/#annual-review'); }} className="block w-full text-left px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900">{t('Enrollment Periods', 'Períodos de Inscripción')}</button>
                    <Link to="/extra-help" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link>
                    <Link to="/help-paying-costs" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Help Paying Costs', 'Ayuda con Costos')}</Link>
                    <Link to="/otc-benefits" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('OTC Benefits', 'Beneficios OTC')}</Link>
                  </div>
                )}
              </div>

              {navLinks.map((link) => (
                link.scroll ? (
                  <button
                    key={link.href}
                    onClick={() => handleScrollNav(link.href)}
                    className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors whitespace-nowrap inline-flex items-center min-h-[44px] px-1"
                  >
                    {t(link.label, link.labelEs)}
                  </button>
                ) : (
                  <Link
                    key={link.href}
                    to={link.href}
                    className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors whitespace-nowrap min-h-[44px] px-1 inline-flex items-center"
                    onClick={closeNav}
                  >
                    {t(link.label, link.labelEs)}
                  </Link>
                )
              ))}
            </div>

            {/* Desktop CTA — single primary action only. "Smart Review" lives in the
                nav text links above (anchor scroll) so we do not also expose it as a
                competing colored button. Free Review is the page's primary CTA.
                Inline phone link is gated to 2xl (1536px+) to keep the lg-xl range
                breathing room — phone is still always visible in the top bar above. */}
            <div className="hidden lg:flex items-center gap-3">
              <a href="tel:18663108702" className="hidden 2xl:flex text-sm font-bold text-earth-900 items-center gap-1.5 hover:text-gold-500 transition-colors whitespace-nowrap">
                <PhoneIcon className="w-4 h-4 flex-shrink-0" />
                1-866-310-8702
              </a>
              <button
                onClick={handleFreeReview}
                className="bg-earth-800 text-cream-50 text-base font-semibold px-4 lg:px-5 xl:px-6 rounded-lg hover:bg-earth-900 transition-all hover:shadow-soft active:scale-[0.98] whitespace-nowrap inline-flex items-center justify-center min-h-[44px]"
              >
                {t('Free Review', 'Revisión Gratis')}
              </button>
            </div>

            {/* Mobile Toggle */}
            <button
              className="lg:hidden p-3 min-w-[44px] min-h-[44px] flex items-center justify-center text-earth-800 transition-transform active:scale-90"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t('Toggle menu', 'Alternar menú')}
            >
              {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-cream-50 border-t border-cream-200 px-5 py-6 space-y-4 animate-fade-in max-h-[calc(100dvh-98px)] overflow-y-auto overscroll-contain">
            <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-gold-500 pb-1">{t('Our Services', 'Nuestros Servicios')}</p>
            <Link to="/medicare-advantage" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('Medicare Advantage', 'Medicare Advantage')}</Link>
            {/* HIDDEN per Sawil 2026-06 — Medicare Supplement / Medigap moved to Education section below. Restore by uncommenting. */}
            {/* <Link to="/medicare-supplement" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('Medicare Supplement', 'Suplemento Medicare')}</Link> */}
            <Link to="/part-d" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('Part D Drug Plans', 'Planes de Medicamentos Parte D')}</Link>
            <div className="border-t border-cream-200 pt-4 space-y-4">
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-gold-500 pb-1">{t('Education', 'Educación')}</p>
              <Link to="/resources" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('Medicare Basics', 'Conceptos Básicos de Medicare')}</Link>
              <button onClick={() => handleScrollNav('/#annual-review')} className="block py-2.5 text-base font-medium text-earth-800 w-full text-left">{t('Enrollment Periods', 'Períodos de Inscripción')}</button>
              <Link to="/extra-help" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link>
              <Link to="/help-paying-costs" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('Help Paying Costs', 'Ayuda con Costos')}</Link>
              <Link to="/otc-benefits" className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>{t('OTC Benefits', 'Beneficios OTC')}</Link>
            </div>
            <div className="border-t border-cream-200 pt-4 space-y-4">
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-gold-500 pb-1">{t('Explore', 'Explorar')}</p>
              {navLinks.map((link) => (
                link.scroll ? (
                  <button key={link.href} onClick={() => handleScrollNav(link.href)} className="block py-2.5 text-base font-medium text-earth-800 w-full text-left">
                    {t(link.label, link.labelEs)}
                  </button>
                ) : (
                  <Link key={link.href} to={link.href} className="block py-2.5 text-base font-medium text-earth-800" onClick={closeNav}>
                    {t(link.label, link.labelEs)}
                  </Link>
                )
              ))}
            </div>
            {/* Mobile primary CTA — single button, matches desktop. Smart Review is
                reachable via the nav scroll link above; no duplicate colored button. */}
            <button onClick={handleFreeReview} className="block w-full text-center bg-earth-800 text-cream-50 font-semibold px-5 py-3 rounded-lg mt-4">
              {t('Free Review', 'Revisión Gratis')}
            </button>
          </div>
        )}
      </nav>
    </>
  );
}

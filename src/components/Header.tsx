import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { LanguageToggle } from './LanguageToggle';
import { LogoSvg } from './LogoSvg';
import { PhoneIcon, MenuIcon, CloseIcon, ChevronDown } from './icons';
import { Link, useLocation, useNavigate } from 'react-router';

const navLinks = [
  { label: 'Services', labelEs: 'Servicios', href: '/#services', scroll: true },
  { label: 'How It Works', labelEs: 'Cómo Funciona', href: '/#how', scroll: true },
  { label: 'Why Us', labelEs: 'Por Qué Nosotros', href: '/#why', scroll: true },
  { label: 'FAQ', labelEs: 'FAQ', href: '/#faq', scroll: true },
  { label: 'About', labelEs: 'Acerca de', href: '/about', scroll: false },
  { label: 'Contact', labelEs: 'Contacto', href: '/contact', scroll: false },
];

export function Header() {
  const { lang, setLang, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const dropdownRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on outside click, Escape key, and route change */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setServicesOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setServicesOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  /* Close dropdown when route changes */
  useEffect(() => {
    setServicesOpen(false);
  }, [location.pathname]);

  const scrollTo = (id: string) => {
    const el = document.querySelector(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setServicesOpen(false);
      setMobileMenuOpen(false);
    }
  };

  const closeNav = () => {
    setServicesOpen(false);
    setMobileMenuOpen(false);
  };

  const isHome = location.pathname === '/';

  /* Navigate to home then scroll to section — fixes broken nav from non-home pages */
  const handleScrollNav = (href: string) => {
    closeNav();
    const id = href.replace('/#', '#');
    if (isHome) {
      scrollTo(id);
    } else {
      navigate('/');
      setTimeout(() => {
        const el = document.querySelector(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    }
  };

  return (
    <>
      {/* Top Bar */}
      <div className="bg-earth-900 text-cream-50/80 text-xs py-2.5">
        <div className="max-w-6xl mx-auto px-5 flex items-center justify-between gap-3 flex-wrap">
          <span className="flex items-center gap-2">
            <PhoneIcon className="w-3.5 h-3.5 text-gold-400" />
            <span className="hidden sm:inline">{t('Call us free: ', 'Llámenos gratis: ')}</span>
            <a href="tel:18663108702" className="text-gold-400 font-semibold hover:text-cream-50 transition-colors">1-866-310-8702</a>
            <span className="hidden md:inline">&nbsp;|&nbsp; TTY: 711 &nbsp;|&nbsp; {t('Mon–Fri 9am–6pm ET', 'Lun–Vie 9am–6pm ET')}</span>
          </span>
          <LanguageToggle lang={lang} setLang={setLang} variant="topbar" />
        </div>
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-cream-50/90 backdrop-blur-md border-b border-cream-200">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center justify-between h-[70px]">
            {/* Logo */}
            <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); window.scrollTo(0, 0); }} className="flex items-center gap-3 group cursor-pointer" aria-label={t('Go to homepage', 'Ir a la página principal')}>
              <div className="transition-transform group-hover:scale-105">
                <LogoSvg size={40} />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-serif text-lg font-bold text-earth-900 tracking-tight">Clear Point</span>
                <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-gold-500 mt-0.5">{t('Senior Advisors', 'Senior Advisors')}</span>
              </div>
            </a>

            {/* Desktop Nav */}
            <div className="hidden lg:flex items-center gap-6">
              {/* Services dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setServicesOpen(!servicesOpen)}
                  className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors flex items-center gap-1"
                >
                  {t('Services', 'Servicios')}
                  <ChevronDown className={`w-3 h-3 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} />
                </button>
                {servicesOpen && (
                  <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-card border border-cream-200 py-2 z-50">
                    <Link to="/medicare-advantage" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Medicare Advantage', 'Medicare Advantage')}</Link>
                    <Link to="/medicare-supplement" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Medicare Supplement', 'Suplemento Medicare')}</Link>
                    <Link to="/part-d" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Part D Drug Plans', 'Parte D Medicamentos')}</Link>
                    <Link to="/extra-help" className="block px-4 py-2 text-sm text-earth-700 hover:bg-cream-50 hover:text-earth-900" onClick={closeNav}>{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link>
                  </div>
                )}
              </div>

              {navLinks.filter(l => !l.label.includes('Services')).map((link) => (
                link.scroll ? (
                  <button
                    key={link.href}
                    onClick={() => handleScrollNav(link.href)}
                    className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors"
                  >
                    {t(link.label, link.labelEs)}
                  </button>
                ) : (
                  <Link
                    key={link.href}
                    to={link.href}
                    className="text-sm font-medium text-earth-700 hover:text-earth-900 transition-colors"
                    onClick={closeNav}
                  >
                    {t(link.label, link.labelEs)}
                  </Link>
                )
              ))}
            </div>

            {/* Desktop CTA */}
            <div className="hidden lg:flex items-center gap-3">
              <a href="tel:18663108702" className="text-sm font-bold text-earth-900 flex items-center gap-1.5 hover:text-gold-500 transition-colors">
                <PhoneIcon className="w-4 h-4" />
                1-866-310-8702
              </a>
              <button
                onClick={() => handleScrollNav('/#smart-medicare-review')}
                className="bg-gold-400 text-earth-900 text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-gold-300 transition-all hover:shadow-soft"
              >
                {t('Smart Review', 'Revisión Inteligente')}
              </button>
              <Link
                to="/contact"
                className="bg-earth-800 text-cream-50 text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-earth-900 transition-all hover:shadow-soft"
              >
                {t('Free Review', 'Revisión Gratis')}
              </Link>
            </div>

            {/* Mobile Toggle */}
            <button
              className="lg:hidden p-2 text-earth-800"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={t('Toggle menu', 'Alternar menú')}
            >
              {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-cream-50 border-t border-cream-200 px-5 py-6 space-y-4 animate-fade-in max-h-[calc(100vh-70px)] overflow-y-auto">
            <Link to="/medicare-advantage" className="block text-base font-medium text-earth-800" onClick={closeNav}>{t('Medicare Advantage', 'Medicare Advantage')}</Link>
            <Link to="/medicare-supplement" className="block text-base font-medium text-earth-800" onClick={closeNav}>{t('Medicare Supplement', 'Suplemento Medicare')}</Link>
            <Link to="/part-d" className="block text-base font-medium text-earth-800" onClick={closeNav}>{t('Part D Drug Plans', 'Parte D Medicamentos')}</Link>
            <Link to="/extra-help" className="block text-base font-medium text-earth-800" onClick={closeNav}>{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link>
            <div className="border-t border-cream-200 pt-4 space-y-4">
              {navLinks.filter(l => l.scroll).map((link) => (
                <button key={link.href} onClick={() => handleScrollNav(link.href)} className="block text-base font-medium text-earth-800 w-full text-left">
                  {t(link.label, link.labelEs)}
                </button>
              ))}
              <Link to="/about" className="block text-base font-medium text-earth-800" onClick={closeNav}>{t('About', 'Acerca de')}</Link>
              <Link to="/contact" className="block text-base font-medium text-earth-800" onClick={closeNav}>{t('Contact', 'Contacto')}</Link>
            </div>
            <button
              onClick={() => handleScrollNav('/#smart-medicare-review')}
              className="block w-full text-center bg-gold-400 text-earth-900 font-semibold px-5 py-3 rounded-lg mt-4"
            >
              {t('Smart Review', 'Revisión Inteligente')}
            </button>
            <Link to="/contact" className="block w-full text-center bg-earth-800 text-cream-50 font-semibold px-5 py-3 rounded-lg mt-2" onClick={closeNav}>
              {t('Free Review', 'Revisión Gratis')}
            </Link>
          </div>
        )}
      </nav>
    </>
  );
}

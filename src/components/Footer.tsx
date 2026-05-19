import { useLanguage } from '../hooks/useLanguage';
import { Link, useNavigate, useLocation } from 'react-router';
import { LogoSvg } from './LogoSvg';
import { DisclaimerBlock } from './DisclaimerBlock';
import { ExternalLinkIcon } from './icons';

export function Footer() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // Resources & Blog — always lands at top of /resources regardless of current page.
  // Double rAF after navigate() ensures scroll fires AFTER React commits the new route,
  // eliminating the race condition where ScrollToTop fires before the page renders.
  const handleResources = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (location.pathname === '/resources') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    navigate('/resources');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }));
  };

  // How It Works — double rAF: waits for React to commit new route DOM,
  // then retries until #how element exists. Eliminates double-click issue.
  const handleHowItWorks = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (location.pathname === '/') {
      const el = document.querySelector('#how');
      if (el) {
        const headerOffset = 80;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return;
    }
    navigate('/');
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#how');
      if (el) {
        const headerOffset = 80;
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(10)));
  };

  return (
    <footer className="bg-earth-900 text-cream-50/60 pt-16 pb-6">
      <div className="max-w-6xl mx-auto px-5">
        <div className="grid grid-cols-2 md:grid-cols-[1.8fr_1fr_1fr_1fr] gap-8 md:gap-10 mb-10">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); window.scrollTo(0, 0); }} className="flex items-center gap-3 mb-4 cursor-pointer" aria-label={t('Go to homepage', 'Ir a la página principal')}>
              <LogoSvg size={36} />
              <div className="flex flex-col leading-none">
                <span className="font-serif text-base font-bold text-cream-50 tracking-tight">Clear Point</span>
                <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-gold-400 mt-0.5">{t('Senior Advisors', 'Senior Advisors')}</span>
              </div>
            </a>
            <p className="text-sm leading-relaxed max-w-xs">
              {t(
                'Independent, licensed Medicare insurance agency. We help seniors across the United States understand and navigate their Medicare options — clearly, honestly, and at no cost.',
                'Agencia independiente y licenciada de seguros Medicare. Ayudamos a adultos mayores en Estados Unidos a entender sus opciones de Medicare — de forma clara, honesta y sin costo.'
              )}
            </p>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Services', 'Servicios')}</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/medicare-advantage" className="hover:text-cream-50 transition-colors">{t('Medicare Advantage', 'Medicare Advantage')}</Link></li>
              <li><Link to="/medicare-supplement" className="hover:text-cream-50 transition-colors">{t('Medicare Supplement', 'Suplemento Medicare')}</Link></li>
              <li><Link to="/part-d" className="hover:text-cream-50 transition-colors">{t('Part D Drug Plans', 'Parte D Medicamentos')}</Link></li>
              <li><Link to="/extra-help" className="hover:text-cream-50 transition-colors">{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link></li>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Resources', 'Recursos')}</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="https://www.medicare.gov" target="_blank" rel="noopener noreferrer" className="hover:text-cream-50 transition-colors inline-flex items-center gap-1">Medicare.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="https://www.ssa.gov" target="_blank" rel="noopener noreferrer" className="hover:text-cream-50 transition-colors inline-flex items-center gap-1">SSA.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="/resources" onClick={handleResources} className="hover:text-cream-50 transition-colors">{t('Resources & Blog', 'Recursos y Blog')}</a></li>
              <li><a href="/#how" onClick={handleHowItWorks} className="hover:text-cream-50 transition-colors">{t('How It Works', 'Cómo Funciona')}</a></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="col-span-2 md:col-span-1">
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Contact', 'Contacto')}</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="tel:18663108702" className="hover:text-cream-50 transition-colors">1-866-310-8702</a></li>
              <li><a href="mailto:info@clearpointsenioradvisors.com" className="hover:text-cream-50 transition-colors">info@clearpointsenioradvisors.com</a></li>
              <li className="text-cream-50/40 text-xs">{t('Mon–Fri · 9am–6pm ET', 'Lun–Vie · 9am–6pm ET')}</li>
              <li className="text-cream-50/40 text-xs mt-2">{t('Serving: NY, FL, CT, NJ', 'Sirviendo: NY, FL, CT, NJ')}</li>
            </ul>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mb-6">
          <DisclaimerBlock variant="full" />
        </div>

        {/* Bottom */}
        <div className="border-t border-cream-50/10 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-cream-50/30">
          {/*
            TODO OWNER — LICENSING DISCLOSURE (required before scaled Medicare marketing):
            Add verified NPN (National Producer Number) and state license numbers here.
            CMS requires NPN display for Medicare Advantage marketing materials.
            Most states require license numbers in insurance marketing.
            Do NOT publish placeholder or invented numbers.
            Once verified, replace this comment with:
              NPN: [VERIFIED NPN] | Licensed in NY · NJ · CT · FL
            Example: <span>NPN: 12345678 | Licensed in NY · NJ · CT · FL</span>
          */}
          <span>© 2026 Clear Point Senior Advisors. {t('All Rights Reserved.', 'Todos los Derechos Reservados.')}</span>
          <div className="flex items-center gap-3">
            <Link to="/privacy-policy" className="hover:text-cream-50/60 transition-colors">{t('Privacy Policy', 'Política de Privacidad')}</Link>
            <span>|</span>
            <Link to="/accessibility" className="hover:text-cream-50/60 transition-colors">{t('Accessibility', 'Accesibilidad')}</Link>
            <span>|</span>
            <Link to="/terms" className="hover:text-cream-50/60 transition-colors">{t('Terms', 'Términos')}</Link>
            <span>|</span>
            <span>TTY: 711</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

import { useLanguage } from '../hooks/useLanguage';
import { Link, useNavigate, useLocation } from 'react-router';
import { LogoSvg } from './LogoSvg';
import { DisclaimerBlock } from './DisclaimerBlock';
import { ExternalLinkIcon } from './icons';

export function Footer() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

  // How It Works — double rAF: waits for React to commit new route DOM,
  // then retries until #how element exists. Eliminates double-click issue.
  const handleHowItWorks = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    // Top bar (~28 px) + sticky nav (h-[70px]) ≈ 98 px stack; 100 px clears it.
    const headerOffset = 100;
    if (location.pathname === '/') {
      const el = document.querySelector('#how');
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return;
    }
    navigate('/');
    // 30-frame retry (~500 ms) absorbs HashRouter commit + Home mount +
    // scroll-reveal observers on mid-range mobile. Matches Free Review pattern.
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#how');
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(30)));
  };

  // Annual Review — same retry pattern, but targets the #annual-review section
  // on the Home page (where the Enrollment Periods / Annual Review content lives).
  const handleAnnualReview = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const headerOffset = 100;
    if (location.pathname === '/') {
      const el = document.querySelector('#annual-review');
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return;
    }
    navigate('/');
    const tryScroll = (attemptsLeft: number) => {
      const el = document.querySelector('#annual-review');
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      } else if (attemptsLeft > 0) {
        requestAnimationFrame(() => tryScroll(attemptsLeft - 1));
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(() => tryScroll(30)));
  };

  return (
    <footer className="bg-earth-900 text-cream-50/60 pt-16 pb-6">
      <div className="max-w-6xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-5">
        {/* lg+ rebalances the column widths so:
            • Contact stays wide enough for the full email on one line
            • Services is wide enough for the longest Spanish label
              "Planes de Medicamentos Parte D" — instead of wrapping ugly
              ("Planes de" / "Medicamentos Parte D"), Services now fits
              "Planes de Medicamentos" on line 1 with "Parte D" on line 2,
              which reads as a balanced, intentional 2-line wrap.
            • Brand column narrows slightly (1.2 → 1.0fr); its paragraph
              already has max-w-xs and just wraps to one more line, which
              is visually fine for the description block.
            md (tablet) keeps the original 5-col split because narrower
            tablets don't have room to widen Services without squeezing
            the link columns past readable. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr] lg:grid-cols-[1.0fr_1.2fr_0.95fr_0.95fr_1.9fr] gap-8 md:gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1">
            <a href="#/" onClick={(e) => { e.preventDefault(); navigate('/'); window.scrollTo(0, 0); }} className="flex items-center gap-3 mb-4 cursor-pointer" aria-label={t('Go to homepage', 'Ir a la página principal')}>
              <LogoSvg size={36} />
              <div className="flex flex-col leading-none">
                <span className="font-serif text-base font-bold text-cream-50 tracking-tight">Clear Point</span>
                <span className="text-[9px] font-semibold tracking-[0.15em] uppercase text-gold-400 mt-0.5">{t('Senior Advisors', 'Senior Advisors')}</span>
              </div>
            </a>
            <p className="text-sm leading-relaxed max-w-xs">
              {t(
                'Trusted Medicare Guidance, Clear Answers, Human Support.',
                'Orientación Medicare confiable, respuestas claras y apoyo humano.'
              )}
            </p>
            <p className="text-sm text-cream-50/70 mt-2 max-w-xs">
              {t(
                'Serving NY • NJ • CT',
                'Sirviendo NY • NJ • CT'
              )}
            </p>
          </div>

          {/* Services — coverage / plan categories ClearPoint is authorized to
              broker. Medicare Supplement MOVED to Education per Sawil 2026-06
              (pending broker authorization). */}
          <div>
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Services', 'Servicios')}</h4>
            <ul className="space-y-1 text-sm">
              <li><Link to="/medicare-advantage" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Medicare Advantage', 'Medicare Advantage')}</Link></li>
              {/* HIDDEN per Sawil 2026-06 — Medicare Supplement moved to Education column. Restore by uncommenting. */}
              {/* <li><Link to="/medicare-supplement" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Medicare Supplement', 'Suplemento Medicare')}</Link></li> */}
              <li><Link to="/part-d" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Part D Drug Plans', 'Parte D / Medicamentos')}</Link></li>
            </ul>
          </div>

          {/* Education — learning / assistance topics. Mirrors Header Education dropdown.
              Includes Medicare Supplement (educational reference until authorization). */}
          <div>
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Education', 'Educación')}</h4>
            <ul className="space-y-1 text-sm">
              <li><Link to="/resources" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Medicare Basics', 'Conceptos Básicos')}</Link></li>
              <li><a href="/#annual-review" onClick={handleHowItWorks} className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Enrollment Periods', 'Inscripción')}</a></li>
              <li><Link to="/medicare-supplement" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Medicare Supplement', 'Suplemento Medicare')}</Link></li>
              <li><Link to="/extra-help" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link></li>
              <li><Link to="/help-paying-costs" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Help Paying Costs', 'Ayuda con Costos')}</Link></li>
              <li><Link to="/otc-benefits" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('OTC Benefits', 'Beneficios OTC')}</Link></li>
              <li><a href="/#annual-review" onClick={handleAnnualReview} className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Annual Review', 'Revisión Anual')}</a></li>
            </ul>
          </div>

          {/* External Resources */}
          <div>
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Resources', 'Recursos')}</h4>
            <ul className="space-y-1 text-sm">
              <li><a href="https://www.medicare.gov" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">Medicare.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="https://www.ssa.gov" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">SSA.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="https://www.cms.gov/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">CMS.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="/#how" onClick={handleHowItWorks} className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('How It Works', 'Cómo Funciona')}</a></li>
              <li><Link to="/about" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('About', 'Nosotros')}</Link></li>
              <li><Link to="/support" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Customer Support', 'Servicio al Cliente')}</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div className="col-span-1 sm:col-span-2 md:col-span-1">
            <h4 className="text-[11px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Contact', 'Contacto')}</h4>
            <ul className="space-y-1 text-sm">
              <li><a href="tel:18663108702" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">1-866-310-8702</a></li>
              {/* Email layout per viewport:
                  • Mobile (default, col-span-2): full-width column, fits on one
                    line at text-sm down to 320px viewport.
                  • md tablet (5-col grid, narrow Contact ~179px): the email
                    is wider than the column; <wbr> hints + break-words let it
                    wrap cleanly as "info@clearpoint / senioradvisors.com"
                    instead of mid-word.
                  • lg+ desktop (wider Contact ~279px+): lg:whitespace-nowrap
                    forces the email onto a single continuous line.
                  mailto href stays a single string so the email client opens
                  the address correctly. <wbr> is silent for screen readers. */}
              <li><a href="mailto:info@clearpointsenioradvisors.com" className="block py-1.5 min-h-[28px] hover:text-cream-50 transition-colors break-all">info@clearpointsenioradvisors.com</a></li>
              <li className="text-cream-50/70 text-xs">{t('Mon–Fri · 9am–6pm ET', 'Lun–Vie · 9am–6pm ET')}</li>
              {/* HIDDEN per Sawil 2026-06: FL not yet licensed. Restore once authorization confirmed. Keeping file/text intact for easy re-enable. */}
              <li className="text-cream-50/70 text-xs mt-2">{t('Serving: NY, CT, NJ', 'Sirviendo: NY, CT, NJ')}</li>
            </ul>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mb-6">
          <DisclaimerBlock variant="full" />
        </div>

        {/* Licensing disclosure — CMS-required for MA marketing. */}
        <div className="border-t border-cream-50/10 pt-4 pb-3 text-center sm:text-left text-xs text-cream-50/80 leading-relaxed">
          <span className="font-semibold">NPN: 17261494</span>
          <span className="mx-2 text-cream-50/40">|</span>
          <span>{t('Licensed in NY · NJ · CT', 'Licenciado en NY · NJ · CT')}</span>
          <span className="mx-2 text-cream-50/40">|</span>
          <span>{t('Agent of Record: Sawil Reyes', 'Agente de Registro: Sawil Reyes')}</span>
        </div>

        {/* Bottom */}
        <div className="border-t border-cream-50/10 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-cream-50/70">
          <span>© 2026 Clear Point Senior Advisors. {t('All Rights Reserved.', 'Todos los Derechos Reservados.')}</span>
          <div className="flex items-center gap-3 flex-wrap">
            <Link to="/privacy-policy" className="inline-flex items-center py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Privacy Policy', 'Política de Privacidad')}</Link>
            <span aria-hidden className="text-cream-50/30">·</span>
            <Link to="/accessibility" className="inline-flex items-center py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Accessibility', 'Accesibilidad')}</Link>
            <span aria-hidden className="text-cream-50/30">·</span>
            <Link to="/terms" className="inline-flex items-center py-1.5 min-h-[28px] hover:text-cream-50 transition-colors">{t('Terms', 'Términos')}</Link>
            <span aria-hidden className="text-cream-50/30">·</span>
            <span>TTY: 711</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

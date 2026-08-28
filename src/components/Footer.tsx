import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { Link, useNavigate, useLocation } from 'react-router';
import { LogoSvg } from './LogoSvg';
import { DisclaimerBlock } from './DisclaimerBlock';
import { ExternalLinkIcon } from './icons';

export function Footer() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  // Sawil 2026-07-27 ES ROUTES — footer links stay inside the /es URL space
  // while browsing Spanish, so crawlers can traverse every ES page.
  const lp = useLocalizedPath();
  const isHome = location.pathname === '/' || location.pathname === '/es';

  // How It Works — double rAF: waits for React to commit new route DOM,
  // then retries until #how element exists. Eliminates double-click issue.
  const handleHowItWorks = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    // Top bar (~28 px) + sticky nav (h-[70px]) ≈ 98 px stack; 100 px clears it.
    const headerOffset = 100;
    if (isHome) {
      const el = document.querySelector('#how');
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return;
    }
    navigate(lp('/'));
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
    if (isHome) {
      const el = document.querySelector('#annual-review');
      if (el) {
        const y = el.getBoundingClientRect().top + window.pageYOffset - headerOffset;
        window.scrollTo({ top: y, behavior: 'smooth' });
      }
      return;
    }
    navigate(lp('/'));
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
    <footer className="bg-earth-900 text-cream-50/60 pt-16 lg:pt-20 pb-8">
      <div className="max-w-6xl 2xl:max-w-[1400px] 3xl:max-w-[1600px] mx-auto px-5 sm:px-8">
        {/* Columns: single stack on phones → a clean 2-column split from sm
            through tablets AND landscape phones (avoids cramming 5 narrow
            columns too early, which looked squeezed when the phone was rotated)
            → the balanced 5-column desktop layout only at lg+ (≥1024px). The lg
            track widths keep Contact wide enough for the full email on one line
            and Services wide enough for the longest Spanish label
            "Planes de Medicamentos Parte D". */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1.0fr_1.2fr_0.95fr_0.95fr_1.9fr] gap-x-8 gap-y-10 lg:gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-1 sm:col-span-2 lg:col-span-1">
            {/* Sawil 2026-07-28 AUDIT CPF-003 — localize the href, not just the
                onClick: the raw attribute is what crawlers and middle-click use. */}
            <a href={lp('/')} onClick={(e) => { e.preventDefault(); navigate(lp('/')); window.scrollTo(0, 0); }} className="flex items-center gap-3 mb-4 cursor-pointer" aria-label={t('Go to homepage', 'Ir a la página principal')}>
              <LogoSvg size={36} />
              <div className="flex flex-col leading-none">
                <span className="font-serif text-base font-bold text-cream-50 tracking-tight">Clear Point</span>
                <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-gold-400 mt-0.5">{t('Senior Advisors', 'Senior Advisors')}</span>
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

          {/* Services — coverage / plan categories Clear Point is authorized to
              broker. Medicare Supplement MOVED to Education per Sawil 2026-06
              (pending broker authorization). */}
          <div>
            <h3 className="text-[13px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Services', 'Servicios')}</h3>
            <ul className="space-y-1 text-sm">
              <li><Link to={lp('/medicare-advantage')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Medicare Advantage', 'Medicare Advantage')}</Link></li>
              {/* HIDDEN per Sawil 2026-06 — Medicare Supplement moved to Education column. Restore by uncommenting. */}
              {/* <li><Link to="/medicare-supplement" className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Medicare Supplement', 'Suplemento Medicare')}</Link></li> */}
              <li><Link to={lp('/part-d')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Part D Drug Plans', 'Parte D / Medicamentos')}</Link></li>
            </ul>
          </div>

          {/* Education — learning / assistance topics. Mirrors Header Education dropdown.
              Includes Medicare Supplement (educational reference until authorization). */}
          <div>
            <h3 className="text-[13px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Education', 'Educación')}</h3>
            <ul className="space-y-1 text-sm">
              <li><Link to={lp('/resources')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Medicare Basics', 'Conceptos Básicos')}</Link></li>
              {/* Sawil 2026-07-28 AUDIT CPF-003 — path+hash anchors localize the
                  PATH half; the fragment is language-neutral. */}
              <li><a href={lp('/') + '#annual-review'} onClick={handleHowItWorks} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Enrollment Periods', 'Inscripción')}</a></li>
              <li><Link to={lp('/extra-help')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Extra Help / LIS', 'Ayuda Extra / LIS')}</Link></li>
              <li><Link to={lp('/help-paying-costs')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Help Paying Costs', 'Ayuda con Costos')}</Link></li>
              <li><Link to={lp('/otc-benefits')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('OTC Benefits', 'Beneficios OTC')}</Link></li>
              <li><a href={lp('/') + '#annual-review'} onClick={handleAnnualReview} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Annual Review', 'Revisión Anual')}</a></li>
            </ul>
          </div>

          {/* External Resources */}
          <div>
            <h3 className="text-[13px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Resources', 'Recursos')}</h3>
            <ul className="space-y-1 text-sm">
              <li><a href="https://www.medicare.gov" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">Medicare.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="https://www.ssa.gov" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">SSA.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href="https://www.cms.gov/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">CMS.gov <ExternalLinkIcon className="w-3 h-3"/></a></li>
              <li><a href={lp('/') + '#how'} onClick={handleHowItWorks} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('How It Works', 'Cómo Funciona')}</a></li>
              <li><Link to={lp('/about')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('About', 'Nosotros')}</Link></li>
              <li><Link to={lp('/support')} className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">{t('Customer Support', 'Servicio al Cliente')}</Link></li>
            </ul>
          </div>

          {/* Contact — single cell from sm up so it pairs with Resources in the
              2-column tier (Brand spans the full row above); its own cell at lg. */}
          <div className="col-span-1">
            <h3 className="text-[13px] font-bold tracking-[0.15em] uppercase text-gold-400 mb-4">{t('Contact', 'Contacto')}</h3>
            <ul className="space-y-1 text-sm">
              <li><a href="tel:18557208555" className="block py-2 min-h-[44px] text-cream-50/80 hover:text-cream-50 transition-colors">1-855-720-8555</a></li>
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
              <li><a href="mailto:info@clearpointsenioradvisors.com" className="block py-2 min-h-[44px] hover:text-cream-50 transition-colors break-all">info@clearpointsenioradvisors.com</a></li>
              <li className="text-cream-50/70 text-[13px]">{t('Mon–Fri · 9am–6pm ET', 'Lun–Vie · 9am–6pm ET')}</li>
              {/* HIDDEN per Sawil 2026-06: FL not yet licensed. Restore once authorization confirmed. Keeping file/text intact for easy re-enable. */}
              <li className="text-cream-50/70 text-[13px] mt-2">{t('Serving: NY, CT, NJ', 'Sirviendo: NY, CT, NJ')}</li>
            </ul>
          </div>
        </div>

        {/* Disclaimer — on desktop this flows into a balanced 2-column measure
            (footer-scoped CSS in index.css) so it fills the width instead of
            leaving a void. Content unchanged. */}
        <div className="mt-2 mb-8">
          <DisclaimerBlock variant="full" />
        </div>

        {/* Licensing disclosure — CMS-required for MA marketing. */}
        <div className="border-t border-cream-50/10 pt-4 pb-3 text-center sm:text-left text-[14px] text-cream-50/80 leading-relaxed">
          <span className="font-semibold">NPN: 17261494</span>
          <span className="mx-2 text-cream-50/40">|</span>
          <span>{t('Licensed in NY · NJ · CT', 'Licenciado en NY · NJ · CT')}</span>
          <span className="mx-2 text-cream-50/40">|</span>
          <span>{t('Agent of Record: Sawil Reyes', 'Agente de Registro: Sawil Reyes')}</span>
        </div>

        {/* Bottom */}
        {/* Sawil 2026-07-09 a11y — links /70→/80: senior-audience legibility (AA→AAA
            for functional text) without touching brand colors. Decorative · separators
            stay dimmer and are aria-hidden. */}
        <div className="border-t border-cream-50/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[14px] text-cream-50/80">
          <span>© 2026 Clear Point Senior Advisors. {t('All Rights Reserved.', 'Todos los Derechos Reservados.')}</span>
          <div className="flex items-center justify-center gap-x-5 gap-y-2 flex-wrap">
            <Link to={lp('/privacy-policy')} className="inline-flex items-center py-2 min-h-[44px] hover:text-cream-50 transition-colors">{t('Privacy Policy', 'Política de Privacidad')}</Link>
            <span aria-hidden className="text-cream-50/30">·</span>
            <Link to={lp('/accessibility')} className="inline-flex items-center py-2 min-h-[44px] hover:text-cream-50 transition-colors">{t('Accessibility', 'Accesibilidad')}</Link>
            <span aria-hidden className="text-cream-50/30">·</span>
            <Link to={lp('/terms')} className="inline-flex items-center py-2 min-h-[44px] hover:text-cream-50 transition-colors">{t('Terms', 'Términos')}</Link>
            <span aria-hidden className="text-cream-50/30">·</span>
            <span>TTY: 711</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

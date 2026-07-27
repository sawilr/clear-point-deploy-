import { Routes, Route, useLocation } from 'react-router'
import { lazy, Suspense, useEffect } from 'react'
import Home from './pages/Home'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { MobileStickyBar } from './components/MobileStickyBar'
import { ScrollToTop } from './components/ScrollToTop'
import { RouteMeta } from './components/RouteMeta'
import { ErrorBoundary } from './components/ErrorBoundary'
import { BotLauncher } from './components/BotLauncher'
import { CookieConsent } from './components/CookieConsent'
import { LanguageProvider } from './hooks/useLanguage'
import { track, Events } from './lib/analytics'

// Sawil 2026-06-30 AUDIT FIX (perf) — code-split every route except the homepage
// (the LCP / first-paint page). This moves the /support route — which statically
// pulls in CustomerServiceBot + the ~595 KB customerServiceEngine — and every other
// page into its own chunk, off the initial payload that every visitor downloads.
const About = lazy(() => import('./pages/About'))
const MedicareAdvantage = lazy(() => import('./pages/MedicareAdvantage'))
const PartD = lazy(() => import('./pages/PartD'))
const ExtraHelp = lazy(() => import('./pages/ExtraHelp'))
const HelpPayingCosts = lazy(() => import('./pages/HelpPayingCosts'))
const OtcBenefits = lazy(() => import('./pages/OtcBenefits'))
const Support = lazy(() => import('./pages/Support'))
const Resources = lazy(() => import('./pages/Resources'))
const Contact = lazy(() => import('./pages/Contact'))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'))
const Accessibility = lazy(() => import('./pages/Accessibility'))
const Terms = lazy(() => import('./pages/Terms'))
const ThankYou = lazy(() => import('./pages/ThankYou'))
const SignSOA = lazy(() => import('./pages/SignSOA'))
const NotFound = lazy(() => import('./pages/NotFound'))

// Zara's chat logic (~308 KB) is split into its own chunk and loaded lazily so it
// is NOT in the initial payload on every page. The floating launcher stays eager
// (it must appear instantly); Zara's chunk loads in the background right after
// first paint, well before the user opens it via the launcher.
const ChatBot = lazy(() => import('./components/ChatBot').then((m) => ({ default: m.ChatBot })))

// Sawil 2026-07-27 ES ROUTES (SEO) — single source of truth for content routes.
// Each entry renders at its English path AND at an indexable /es twin
// (/es, /es/about, …). /thank-you, /soa/:token and the 404 catch-all stay
// EN-only below (noindex pages — no Spanish twin by design).
const CONTENT_ROUTES = [
  { path: '/', element: <Home /> },
  { path: '/about', element: <About /> },
  { path: '/medicare-advantage', element: <MedicareAdvantage /> },
  { path: '/part-d', element: <PartD /> },
  { path: '/extra-help', element: <ExtraHelp /> },
  { path: '/help-paying-costs', element: <HelpPayingCosts /> },
  { path: '/otc-benefits', element: <OtcBenefits /> },
  { path: '/support', element: <Support /> },
  { path: '/resources', element: <Resources /> },
  { path: '/contact', element: <Contact /> },
  { path: '/privacy-policy', element: <PrivacyPolicy /> },
  { path: '/accessibility', element: <Accessibility /> },
  { path: '/terms', element: <Terms /> },
]

const esPath = (p: string) => (p === '/' ? '/es' : `/es${p}`)

export default function App() {
  // Sawil 2026-06 — MobileStickyBar (the bottom CTA) is suppressed on
  // /support. Clara's chat shell sits flush at bottom-0 on mobile, and
  // a second fixed bar there would collide / cover the input. App is
  // mounted inside <BrowserRouter> (see main.tsx), so useLocation() is safe.
  const location = useLocation();
  // Sawil 2026-07-27 ES ROUTES — /es/support is the same Clara shell; the
  // suppression rules (sticky bar, footer, Zara) apply to both URLs.
  const isSupportPage = location.pathname === '/support' || location.pathname === '/es/support';
  // Generic, PII-free page_view on every route change (no-ops until GTM is set).
  useEffect(() => {
    track(Events.PAGE_VIEW, { event_category: 'navigation', page_path: location.pathname });
  }, [location.pathname]);
  return (
    <ErrorBoundary>
    <LanguageProvider>
    <div className={`bg-cream-50 ${isSupportPage ? 'support-shell' : 'min-h-screen pb-[calc(env(safe-area-inset-bottom)+96px)] md:pb-0'}`}>
      {/* WCAG 2.4.1 Bypass Blocks — Skip link must be first focusable element on the page.
          Visually hidden until focused via Tab; then appears as a high-contrast pill at top-left. */}
      <a
        href="#main-content"
        className="cp-skip-link sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-earth-900 focus:text-cream-50 focus:px-4 focus:py-2 focus:rounded-lg focus:outline focus:outline-2 focus:outline-gold-400 focus:font-semibold focus:text-base"
      >
        Skip to main content
      </a>
      <ScrollToTop />
      <RouteMeta />
      {/* AUDIT 2026-07-23 (A11Y-01) — wrap the site header so it exposes the
          `banner` landmark. Header itself returns a fragment (top-bar + nav);
          the <header> element alone yields the role — no role="banner" needed. */}
      <header>
        <Header />
      </header>
      <main id="main-content" className={isSupportPage ? 'support-main' : undefined}>
        {/* Suspense holds the layout height while a lazily-loaded route chunk
            arrives (same-origin, typically &lt;100 ms), preventing a jump. */}
        <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-live="polite" />}>
          <Routes>
            {CONTENT_ROUTES.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
            {/* Sawil 2026-07-27 ES ROUTES — indexable Spanish twins under /es. */}
            {CONTENT_ROUTES.map(({ path, element }) => (
              <Route key={esPath(path)} path={esPath(path)} element={element} />
            ))}
            <Route path="/thank-you" element={<ThankYou />} />
            {/* PHASE A16 — SOA signing route. Token issued by /api/soa-token. */}
            <Route path="/soa/:token" element={<SignSOA />} />
            {/* PHASE 7 — Branded 404 fallback. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      {!isSupportPage && <Footer />}
      {!isSupportPage && <MobileStickyBar />}
      {/* PHASE A18 — BotLauncher renders the floating button (eager, instant).
          Sawil 2026-06 — Zara's launcher + chat are suppressed on /support
          (Clara's surface); a floating Zara pill would collide there. */}
      {/* Sawil 2026-07-27 — Cookie-consent banner (all routes, EN + /es twins).
          Suppressed on /support like Footer/StickyBar: Clara's chat shell sits
          flush at bottom-0 on mobile and a fixed bottom banner would cover her
          input row. First visit only; choice persists in localStorage. */}
      {!isSupportPage && <CookieConsent />}
      {!isSupportPage && <BotLauncher />}
      {!isSupportPage && <Suspense fallback={null}><ChatBot /></Suspense>}
    </div>
    </LanguageProvider>
    </ErrorBoundary>
  )
}

import { Routes, Route, useLocation } from 'react-router'
import { lazy, Suspense, useEffect, Component, type ReactNode } from 'react'
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
import { storageGet, storageSet } from './lib/safeStorage'

// Sawil 2026-06-30 AUDIT FIX (perf) — code-split every route except the homepage
// (the LCP / first-paint page). This moves the /support route — which statically
// pulls in CustomerServiceBot + the ~595 KB customerServiceEngine — and every other
// page into its own chunk, off the initial payload that every visitor downloads.
// AUDIT 2026-09-12 (CODE-06, P2) — a failed route/ChatBot chunk import used to
// fall straight into the whole-app ErrorBoundary. Transient network drops and
// mid-deploy hash changes are the usual causes: retry the import once, then
// reload the page once per session (fresh HTML → fresh hashes) before giving up.
// Red-team 2026-09-13 (RT-CLIENT-01/02/03): the in-page retry is only real when
// the module URL is cache-busted (Chrome caches the failed module record); the
// reload guard must not depend on Web Storage (storage-denied visitors would
// loop forever) and must never discard a form the visitor is filling in; the
// background Zara chunk never reloads the page at all (see lazyNoReload).
function chunkUrlFrom(err: unknown): string | null {
  const m = String((err as { message?: string })?.message ?? err).match(/(https?:\/\/[^\s'"]+\.js)/)
  return m ? m[1] : null
}
function formInProgress(): boolean {
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea'))
    .some((el) => el.value.trim().length > 0)
}
// Red-team round 2 (RT2-CLIENT-05): a manual F5 must not count as our rescue
// reload. The marker is written into history.state (survives a reload without
// Web Storage) right before we reload; a session flag is a second, best-effort copy.
const RELOAD_MARK = 'cpChunkReload'
function alreadyReloaded(): boolean {
  const st = (typeof history !== 'undefined' && history.state) as Record<string, unknown> | null
  return !!(st && st[RELOAD_MARK]) || storageGet('session', 'cp_chunk_reload') === '1'
}
function markReload(): void {
  try { history.replaceState({ ...(history.state || {}), [RELOAD_MARK]: 1 }, '') } catch { /* ignore */ }
  storageSet('session', 'cp_chunk_reload', '1')
}
// Red-team RT2-CLIENT-01: the cache-busted retry returns the raw module
// namespace, so the loader's export mapping must be applied to it as well.
async function retryImport<M, T>(loader: () => Promise<M>, map: (m: M) => T, firstError: unknown): Promise<T> {
  const url = chunkUrlFrom(firstError)
  await new Promise((r) => setTimeout(r, 600))
  if (url) return map((await import(/* @vite-ignore */ `${url}?retry=${Date.now()}`)) as M)
  return map(await loader())
}
function lazyRetry<M, T = M>(loader: () => Promise<M>, map: (m: M) => T = (m) => m as unknown as T): () => Promise<T> {
  return () => loader().then(map).catch(async (firstError: unknown) => {
    try {
      return await retryImport(loader, map, firstError)
    } catch (secondError) {
      if (!alreadyReloaded() && !formInProgress()) {
        markReload()
        window.location.reload()
        return new Promise<T>(() => {}) // navigation in flight — never resolve
      }
      throw secondError ?? firstError
    }
  })
}
// Non-essential chunks (Zara): retry once, then surface the failure to a local
// boundary — never reload the page.
function lazyNoReload<M, T = M>(loader: () => Promise<M>, map: (m: M) => T = (m) => m as unknown as T): () => Promise<T> {
  return () => loader().then(map).catch((firstError: unknown) => retryImport(loader, map, firstError))
}
// Boundary for the optional Zara widget (RT2-CLIENT-08): a chunk failure shows
// a small phone fallback pill instead of a silent dead launcher.
class ChatBoundary extends Component<{ children: ReactNode; es: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="status" className="fixed bottom-[calc(env(safe-area-inset-bottom)+150px)] right-4 z-[46] max-w-[260px] rounded-xl bg-earth-900 text-cream-50 text-sm px-4 py-3 shadow-lifted">
        {this.props.es ? 'El chat no está disponible ahora. Llámenos al ' : 'Chat is unavailable right now. Call us at '}
        <a className="font-semibold underline" href="tel:+18557208555">1-855-720-8555</a>
      </div>
    )
  }
}
// Route-level boundary (RT2-CLIENT-04): a page chunk that still fails after the
// retry/reload rescue is reported INSIDE the layout — header, footer and the
// visitor's half-filled form stay mounted — with a plain "try again" control.
class RouteBoundary extends Component<{ children: ReactNode; es: boolean; pathname: string }, { failed: boolean; at: string }> {
  state = { failed: false, at: '' }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(prev: { pathname: string }) {
    if (prev.pathname !== this.props.pathname && this.state.failed) this.setState({ failed: false })
  }
  render() {
    if (!this.state.failed) return this.props.children
    const es = this.props.es
    return (
      <section className="max-w-2xl mx-auto px-5 py-16 text-center" aria-live="polite">
        <h1 className="font-serif text-2xl text-earth-900 mb-3">{es ? 'No pudimos cargar esta página' : "We couldn't load this page"}</h1>
        <p className="text-earth-700 mb-6">{es ? 'Revise su conexión e inténtelo de nuevo. También puede llamarnos al ' : 'Please check your connection and try again. You can also call us at '}<a className="font-semibold underline" href="tel:+18557208555">1-855-720-8555</a> (TTY 711).</p>
        {/* Red-team round 4 (CPR4-CLIENT-01): clearing the boundary state alone
            was inert — React caches the rejected module promise, so the same
            lazy() import fails again with no new request. A user-initiated
            reload is the only thing that really re-fetches the chunk; the rescue
            marker is cleared first so the automatic retry can run again. */}
        <button type="button" onClick={() => {
          try { history.replaceState({ ...(history.state || {}), [RELOAD_MARK]: 0 }, '') } catch { /* ignore */ }
          storageSet('session', 'cp_chunk_reload', '')
          window.location.reload()
        }} className="cp-btn inline-flex items-center justify-center min-h-[48px] px-6 rounded-lg bg-earth-800 text-cream-50 font-semibold">
          {es ? 'Intentar de nuevo' : 'Try again'}
        </button>
      </section>
    )
  }
}

const About = lazy(lazyRetry(() => import('./pages/About')))
const MedicareAdvantage = lazy(lazyRetry(() => import('./pages/MedicareAdvantage')))
const PartD = lazy(lazyRetry(() => import('./pages/PartD')))
const ExtraHelp = lazy(lazyRetry(() => import('./pages/ExtraHelp')))
const HelpPayingCosts = lazy(lazyRetry(() => import('./pages/HelpPayingCosts')))
const OtcBenefits = lazy(lazyRetry(() => import('./pages/OtcBenefits')))
const Support = lazy(lazyRetry(() => import('./pages/Support')))
const Resources = lazy(lazyRetry(() => import('./pages/Resources')))
const Contact = lazy(lazyRetry(() => import('./pages/Contact')))
const PrivacyPolicy = lazy(lazyRetry(() => import('./pages/PrivacyPolicy')))
const Accessibility = lazy(lazyRetry(() => import('./pages/Accessibility')))
const Terms = lazy(lazyRetry(() => import('./pages/Terms')))
const ThankYou = lazy(lazyRetry(() => import('./pages/ThankYou')))
const SignSOA = lazy(lazyRetry(() => import('./pages/SignSOA')))
const NotFound = lazy(lazyRetry(() => import('./pages/NotFound')))

// Zara's chat logic (~308 KB) is split into its own chunk and loaded lazily so it
// is NOT in the initial payload on every page. The floating launcher stays eager
// (it must appear instantly); Zara's chunk loads in the background right after
// first paint, well before the user opens it via the launcher.
const ChatBot = lazy(lazyNoReload(() => import('./components/ChatBot'), (m) => ({ default: m.ChatBot })))

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
  const isEs = location.pathname === '/es' || location.pathname.startsWith('/es/');
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
      {/* AUDIT 2026-09-13 (R4F-10) — the link's wording follows the URL, while
          <html lang> follows the stored preference, so on an English URL viewed
          by a Spanish-preference visitor the two disagreed. Marking the link's
          own language keeps it correct for a screen reader either way
          (WCAG 3.1.2, language of parts). */}
      <a
        href="#main-content"
        lang={isEs ? 'es' : 'en'}
        className="cp-skip-link sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-earth-900 focus:text-cream-50 focus:px-4 focus:py-2 focus:rounded-lg focus:outline focus:outline-2 focus:outline-gold-400 focus:font-semibold focus:text-base"
      >
        {isEs ? 'Saltar al contenido principal' : 'Skip to main content'}
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
            arrives (same-origin, typically &lt;100 ms), preventing a jump.
            AUDIT 2026-08-27 (finding #11) — on a slow connection the old empty
            spacer read as a broken page; pulsing neutral blocks now mirror the
            hero+content silhouette until the chunk lands. */}
        <Suspense fallback={
          /* AUDIT 2026-09-12 (PERF, CLS 0.23 on lazy routes) — the fallback was
             60vh tall, so the footer sat in-viewport during the chunk swap and
             jumped when the real page (always taller) arrived. Full-viewport
             placeholder keeps the footer below the fold → no counted shift. */
          <div className="min-h-screen px-5 py-10 max-w-6xl mx-auto" aria-busy="true" aria-live="polite">
            <div className="animate-pulse space-y-6">
              <div className="h-56 bg-cream-200 rounded-2xl" />
              <div className="h-8 bg-cream-200 rounded-lg w-2/3" />
              <div className="h-4 bg-cream-200 rounded w-full" />
              <div className="h-4 bg-cream-200 rounded w-5/6" />
              <div className="h-4 bg-cream-200 rounded w-3/4" />
            </div>
          </div>
        }>

          <RouteBoundary es={isEs} pathname={location.pathname}>
          <Routes>
            {CONTENT_ROUTES.map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
            {/* Sawil 2026-07-27 ES ROUTES — indexable Spanish twins under /es. */}
            {CONTENT_ROUTES.map(({ path, element }) => (
              <Route key={esPath(path)} path={esPath(path)} element={element} />
            ))}
            {/* AUDIT 2026-09-14 (FORMS-11) — the Spanish twin. Both stay
                noindex (RouteMeta keys off the EN base path), so adding it
                costs nothing in search and stops /es/thank-you 404ing. */}
            <Route path="/thank-you" element={<ThankYou />} />
            <Route path="/es/thank-you" element={<ThankYou />} />
            {/* PHASE A16 — SOA signing route. Token issued by /api/soa-token. */}
            <Route path="/soa/:token" element={<SignSOA />} />
            {/* PHASE 7 — Branded 404 fallback. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </RouteBoundary>
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
      {!isSupportPage && <ChatBoundary es={isEs}><Suspense fallback={null}><ChatBot /></Suspense></ChatBoundary>}
    </div>
    </LanguageProvider>
    </ErrorBoundary>
  )
}

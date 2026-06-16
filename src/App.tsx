import { Routes, Route, useLocation } from 'react-router'
import Home from './pages/Home'
import About from './pages/About'
import MedicareAdvantage from './pages/MedicareAdvantage'
import PartD from './pages/PartD'
import ExtraHelp from './pages/ExtraHelp'
import HelpPayingCosts from './pages/HelpPayingCosts'
import OtcBenefits from './pages/OtcBenefits'
import Support from './pages/Support'
import Resources from './pages/Resources'
import Contact from './pages/Contact'
import PrivacyPolicy from './pages/PrivacyPolicy'
import Accessibility from './pages/Accessibility'
import Terms from './pages/Terms'
import SignSOA from './pages/SignSOA'
import NotFound from './pages/NotFound'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { MobileStickyBar } from './components/MobileStickyBar'
import { ScrollToTop } from './components/ScrollToTop'
import { RouteMeta } from './components/RouteMeta'
import { ErrorBoundary } from './components/ErrorBoundary'

import { ChatBot } from './components/ChatBot'
import { BotLauncher } from './components/BotLauncher'
import { LanguageProvider } from './hooks/useLanguage'

export default function App() {
  // Sawil 2026-06 — MobileStickyBar (the bottom CTA) is suppressed on
  // /support. Clara's chat shell sits flush at bottom-0 on mobile, and
  // a second fixed bar there would collide / cover the input. App is
  // mounted inside <BrowserRouter> (see main.tsx), so useLocation() is safe.
  const location = useLocation();
  const isSupportPage = location.pathname === '/support';
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
      <Header />
      <main id="main-content" className={isSupportPage ? 'support-main' : undefined}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/medicare-advantage" element={<MedicareAdvantage />} />
          <Route path="/part-d" element={<PartD />} />
          <Route path="/extra-help" element={<ExtraHelp />} />
          <Route path="/help-paying-costs" element={<HelpPayingCosts />} />
          <Route path="/otc-benefits" element={<OtcBenefits />} />
          <Route path="/support" element={<Support />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/accessibility" element={<Accessibility />} />
          <Route path="/terms" element={<Terms />} />
          {/* PHASE A16 — SOA signing route. Token issued by /api/soa-token. */}
          <Route path="/soa/:token" element={<SignSOA />} />
          {/* PHASE 7 — Branded 404 fallback. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      {!isSupportPage && <Footer />}
      {!isSupportPage && <MobileStickyBar />}
      {/* PHASE A18 — BotLauncher renders the floating button. ChatBot is
          still mounted (it holds Zara's logic); its own button is hidden
          while the launcher is active. Launcher dispatches an event to
          open Zara, or routes to /support for Customer Service. */}
      {/* Sawil 2026-06 — Suppress Zara's floating launcher + chat on /support.
          That page is Clara's surface in page-mode; a floating Zara pill
          would collide and double-route the user. */}
      {!isSupportPage && <BotLauncher />}
      {!isSupportPage && <ChatBot />}
    </div>
    </LanguageProvider>
    </ErrorBoundary>
  )
}

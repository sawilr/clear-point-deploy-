import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import About from './pages/About'
import MedicareAdvantage from './pages/MedicareAdvantage'
import MedicareSupplement from './pages/MedicareSupplement'
import PartD from './pages/PartD'
import ExtraHelp from './pages/ExtraHelp'
import HelpPayingCosts from './pages/HelpPayingCosts'
import OtcBenefits from './pages/OtcBenefits'
import Resources from './pages/Resources'
import Contact from './pages/Contact'
import PrivacyPolicy from './pages/PrivacyPolicy'
import Accessibility from './pages/Accessibility'
import Terms from './pages/Terms'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { MobileStickyBar } from './components/MobileStickyBar'
import { ScrollToTop } from './components/ScrollToTop'

import { ChatBot } from './components/ChatBot'
import { LanguageProvider } from './hooks/useLanguage'

export default function App() {
  return (
    <LanguageProvider>
    <div className="min-h-screen bg-cream-50">
      {/* WCAG 2.4.1 Bypass Blocks — Skip link must be first focusable element on the page.
          Visually hidden until focused via Tab; then appears as a high-contrast pill at top-left. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-earth-900 focus:text-cream-50 focus:px-4 focus:py-2 focus:rounded-lg focus:outline focus:outline-2 focus:outline-gold-400 focus:font-semibold focus:text-sm"
      >
        Skip to main content
      </a>
      <ScrollToTop />
      <Header />
      <main id="main-content" className="pb-20 md:pb-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/medicare-advantage" element={<MedicareAdvantage />} />
          <Route path="/medicare-supplement" element={<MedicareSupplement />} />
          <Route path="/part-d" element={<PartD />} />
          <Route path="/extra-help" element={<ExtraHelp />} />
          <Route path="/help-paying-costs" element={<HelpPayingCosts />} />
          <Route path="/otc-benefits" element={<OtcBenefits />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/accessibility" element={<Accessibility />} />
          <Route path="/terms" element={<Terms />} />
        </Routes>
      </main>
      <Footer />
      <MobileStickyBar />
      <ChatBot />
    </div>
    </LanguageProvider>
  )
}

import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import About from './pages/About'
import MedicareAdvantage from './pages/MedicareAdvantage'
import MedicareSupplement from './pages/MedicareSupplement'
import PartD from './pages/PartD'
import ExtraHelp from './pages/ExtraHelp'
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
      <ScrollToTop />
      <Header />
      <main className="pb-16 md:pb-0">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/medicare-advantage" element={<MedicareAdvantage />} />
          <Route path="/medicare-supplement" element={<MedicareSupplement />} />
          <Route path="/part-d" element={<PartD />} />
          <Route path="/extra-help" element={<ExtraHelp />} />
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

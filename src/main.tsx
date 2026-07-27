import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initGA4IfConsented } from './lib/analytics'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// SEO migration (Sawil 2026-06-12): HashRouter -> BrowserRouter so every route is
// a real, indexable URL (/medicare-advantage instead of /#/medicare-advantage).
// Direct loads / refreshes are served index.html by the vercel.json rewrite
// (and by Vite's SPA fallback in dev).
initGA4IfConsented();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

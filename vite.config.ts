import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  // Sawil 2026-06-15 — ABSOLUTE asset base. With the old relative base ('./'),
  // the JS bundle was referenced as "./assets/…", which resolves correctly on
  // no-slash deep links (/about → /assets/…) but BREAKS on trailing-slash URLs
  // (/about/ → /about/assets/… → Vercel's SPA rewrite returns index.html as
  // text/html → the module fails to execute → blank page, no React, no Clara/
  // Zara). The v2 audit's "CRITICAL SSR failure" + "no chatbot deployed" were
  // both this one bug (their crawler hit trailing-slash URLs). Absolute '/'
  // makes /assets/… resolve correctly at ANY URL depth. Site is served at the
  // domain root, so this is the correct, lower-risk base.
  base: '/',
  plugins: [inspectAttr(), react()],
  // PHASE A15 — strip console.* and debugger from production bundles.
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
    target: 'es2020',
  },
  server: {
    port: 5173,
    // DEV ONLY — forward the bot's LLM call to the live API so LOCAL shows the
    // real conversational Clara/Zara with NO button fallback. Origin is spoofed
    // to the prod host so the production allowlist accepts the dev request.
    // NOTE: this uses PRODUCTION's brain (currently old figures, e.g. 2025)
    // until our fixes are deployed. /api/submit-lead is NOT proxied.
    proxy: {
      '/api/chat': {
        target: 'https://clearpointsenioradvisors.com',
        changeOrigin: true,
        secure: true,
        headers: { Origin: 'https://clearpointsenioradvisors.com' },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    // PHASE 6 — iOS 14/15 + Safari 14 compatibility for senior audience.
    target: ['es2020', 'safari14', 'ios14', 'chrome87', 'firefox78', 'edge88'],
    // Enterprise: split vendor chunks for long-term browser caching.
    // React + router + icon libraries change much less often than app code,
    // so separating them means a code-only change doesn't bust the vendor cache.
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['react-router'],
        },
      },
    },
  },
});

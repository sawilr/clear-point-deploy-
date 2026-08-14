import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
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
  // AUDIT 2026-08-12 (IP scrub) — inspectAttr() stamps `code-path="src/…"`
  // attributes on every DOM element; in production that publishes internal
  // source paths to any visitor. Dev-only from now on.
  plugins: [
    ...(command === 'serve' ? [inspectAttr()] : []),
    react(),
    // AUDIT 2026-08-13 (IP-04) — index.html carried 4 engineering comments that
    // were replicated into all 28 prerendered shells (108 occurrences) and
    // shipped to every visitor. They disclosed an internal audit CADENCE and
    // DATES, an internal severity taxonomy ("(P2)"), and an internal component
    // name (RouteMeta) — free reconnaissance with zero user value. The rationale
    // stays in the SOURCE file for the next developer; it just no longer ships.
    // Build-only: dev keeps them visible while working.
    ...(command === 'build' ? [{
      name: 'cp-strip-html-comments',
      transformIndexHtml(html: string) {
        // Preserve conditional comments; strip plain ones.
        return html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
      },
    }] : []),
  ],
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
    // 2026-08-14 (OpenAI integration) — CLARA_API_PROXY overrides the target so
    // the widget can exercise a LOCAL api/chat.js (scripts/dev-api-server.mjs)
    // with the new provider instead of production's. Default unchanged.
    proxy: {
      '/api/chat': process.env.CLARA_API_PROXY
        ? {
            target: process.env.CLARA_API_PROXY,
            changeOrigin: true,
            secure: false,
            headers: { Origin: 'http://localhost:5173' },
          }
        : {
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
          // AUDIT 2026-07-03 (perf) — lucide-react ships hundreds of icon modules
          // used across nearly every component; carving it into its own long-cache
          // vendor chunk keeps it out of the app `index` chunk so a copy/logic edit
          // no longer re-downloads the icon set.
          'icons-vendor': ['lucide-react'],
        },
        // AUDIT 2026-08-13 (IP-05) — chunk BASENAMES were derived from module
        // names and shipped to every visitor, so the asset manifest advertised
        // internal capabilities: `sensitiveGuard-*.js` tells an attacker a
        // client-side sensitive-data guardrail exists and exactly which file to
        // read to study its trigger terms, and `SignSOA-*.js` names an unshipped
        // workflow. Route-level splitting inherently reveals PUBLIC route names
        // (About, Contact, PartD) and that is fine — those are already public —
        // but capability names are gratuitous. Opaque hashes for everything
        // except the long-cache vendor chunks, whose stable names are the point.
        chunkFileNames: (chunkInfo) => (
          /vendor$/.test(chunkInfo.name || '')
            ? 'assets/[name]-[hash].js'
            : 'assets/[hash].js'
        ),
      },
    },
  },
}));

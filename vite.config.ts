import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  // PHASE A15 — strip console.* and debugger from production bundles.
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none',
    target: 'es2020',
  },
  server: {
    port: 3000,
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

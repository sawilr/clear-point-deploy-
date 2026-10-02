// ─────────────────────────────────────────────────────────────────────────────
// CY2027 compliance layer — environment-neutral barrel.
//
// Everything re-exported here is pure ESM with no Node APIs, so both the Vercel
// functions and the Vite client bundle can import it. ./evidence.js is NOT
// re-exported: it uses node:crypto and is server-only. Import it directly.
//
// Layout:
//   soa-text.js        approved customer-facing wording + categories (verbatim)
//   state-rules.js     state-first jurisdiction engine, ZIP/county handling
//   rulesets.js        immutable per-plan-year CMS rulesets + kill switch
//   soa-instance.js    appointment-specific SOA instance + marketing gate
//   consent.js         the four distinct consent objects
//   trust.js           lead trust state, anti-abuse, human confirmation gate
//   retention.js       retention by record class + legal hold
//   carrier-overlay.js private carrier overlay registry (licensed workspace only)
//   evidence.js        hashing, text snapshot, audit log            [SERVER ONLY]
// ─────────────────────────────────────────────────────────────────────────────

export * from './soa-text.js';
export * from './state-rules.js';
export * from './rulesets.js';
export * from './soa-instance.js';
export * from './consent.js';
export * from './trust.js';
export * from './retention.js';
export * from './carrier-overlay.js';

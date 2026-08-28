# Changelog — Conversational Platform

## 2026-08-28 — Master-spec execution wave 1
- **Scope router** (`api/_lib/scope-router.js` + wiring): deterministic pre-LLM triage — wrong-business/vendor/greeting/loop turns answered without the model (measured: 2.0–2.8s+full prompt → 6–66ms, 0 model calls; live-verified in production). Graduated ladder, whitelist-first, consumer guard, [SCOPE-AUDIT] logging. Suite: 67 checks incl. §89 false-positive guards. Commit `ed78f7f`.
- **Voice call-scope & closure spec** for Emely/Sofia with paste-ready EN/ES prompt blocks + staged rollout runbook (`docs/voice/`). NOT yet applied to live lines (owner window).
- **FMO Demo Mode**: `scripts/demo-fmo-2026-08-28.mjs` — 10 reproducible scenarios; 10/10 against production 2026-08-28.
- **Docs pack**: ARCHITECTURE, CONVERSATION-FLOWS, SECURITY, COMPLIANCE-NOTES, NOT_VERIFIED, TEST-PLAN, DEPLOYMENT, ROLLBACK, KNOWN-LIMITATIONS, BLOCKED_EXTERNAL_ACCESS.

## 2026-08-27/28 — External-audit remediation (context)
- All 17 external-audit findings resolved or dispositioned; deployed `75eb93f`: reasoning-effort low (warm latency −48%), precise independence/compensation copy EN+ES, single SLA, URL-wins language routing (preference preserved), strict CSP (`style-src 'self'`), image caching, skeleton fallback, mobile sticky-bar auto-hide, consent presentation, sitemap lastmod, brand normalization.
- `06df1f6`: resolved the F2↔PIT-T-02 guard conflict (`medical_emergency_911` → neutral 'your health'/'su salud', pinned both directions) → audit-regressions 345/345; zero failing checks across 15 suites.
- Earlier same day `8a3ce8f`: opt-out identifier validation (400 on empty, no enumeration oracle), multi-turn injection recovery, model telemetry stripped from client meta.

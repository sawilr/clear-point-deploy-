# Changelog — Conversational Platform

## 2026-08-28 — Master-spec execution wave 2
- **URL guard (§63)** `api/_lib/url-guard.js`: post-generation allowlist — only approved official hosts (medicare.gov, ssa.gov, cms.gov, SHIP, state portals, clearpointsenioradvisors.com) survive in model output; anything else visibly replaced, lookalike domains (fakemedicare.gov) not fooled, never empties a reply.
- **Active PII warning (§126)**: when a caller sends an SSN/account number, it is redacted before the model (existing) AND the caller is now told, once, not to share it — appended after all filters.
- **Shadow intent classifier (§4/§5/§114)** `api/_lib/intent-classifier.js`: deterministic, bilingual, confidence-banded (high/medium/low) classification into the spec taxonomy — logged in [AI-AUDIT], acts on nothing (spec's own shadow rule).
- **Anomaly & cost signals (§27/§30/§31)**: raw turn count, message size, repetition, anomaly score in [AI-AUDIT]; [COST-ALERT] warn at env-tunable thresholds (COST_ALERT_TURNS=20, COST_ALERT_ANOMALY=50).
- **Corpus suite (§81/§82/§85/§89)** `test-master-spec-corpus-2026-08-28.mjs`: 221 checks — 109 generated wrong-number variations, 56 vendor variations, expanded protected set (caught and fixed a real §89 false positive: EN "medications" was unprotected), long-conversation tests (30/50/100 turns capped, 101 rejected), URL-guard and PII-warning wiring through the real handler.

## 2026-08-28 — Master-spec execution wave 1
- **Scope router** (`api/_lib/scope-router.js` + wiring): deterministic pre-LLM triage — wrong-business/vendor/greeting/loop turns answered without the model (measured: 2.0–2.8s+full prompt → 6–66ms, 0 model calls; live-verified in production). Graduated ladder, whitelist-first, consumer guard, [SCOPE-AUDIT] logging. Suite: 67 checks incl. §89 false-positive guards. Commit `ed78f7f`.
- **Voice call-scope & closure spec** for Emely/Sofia with paste-ready EN/ES prompt blocks + staged rollout runbook (`docs/voice/`). NOT yet applied to live lines (owner window).
- **FMO Demo Mode**: `scripts/demo-fmo-2026-08-28.mjs` — 10 reproducible scenarios; 10/10 against production 2026-08-28.
- **Docs pack**: ARCHITECTURE, CONVERSATION-FLOWS, SECURITY, COMPLIANCE-NOTES, NOT_VERIFIED, TEST-PLAN, DEPLOYMENT, ROLLBACK, KNOWN-LIMITATIONS, BLOCKED_EXTERNAL_ACCESS.

## 2026-08-27/28 — External-audit remediation (context)
- All 17 external-audit findings resolved or dispositioned; deployed `75eb93f`: reasoning-effort low (warm latency −48%), precise independence/compensation copy EN+ES, single SLA, URL-wins language routing (preference preserved), strict CSP (`style-src 'self'`), image caching, skeleton fallback, mobile sticky-bar auto-hide, consent presentation, sitemap lastmod, brand normalization.
- `06df1f6`: resolved the F2↔PIT-T-02 guard conflict (`medical_emergency_911` → neutral 'your health'/'su salud', pinned both directions) → audit-regressions 345/345; zero failing checks across 15 suites.
- Earlier same day `8a3ce8f`: opt-out identifier validation (400 on empty, no enumeration oracle), multi-turn injection recovery, model telemetry stripped from client meta.

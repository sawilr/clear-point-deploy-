# Security — Conversational Platform

**Date:** 2026-08-28. Every control below has a deterministic test; suites listed in TEST-PLAN.md.

## Transport & headers (site-wide, vercel.json)
CSP (`style-src 'self'`, no unsafe-inline; script-src self+GTM+Turnstile; frame-ancestors none), HSTS preload, nosniff, Referrer-Policy, Permissions-Policy, restrictive CORS (origin allowlist per endpoint), correct 405/403 on wrong methods/origins.

## /api/chat
- Origin allowlist → 403 (silent for probes).
- Rate limit 30/5min/IP (in-memory; global enforcement pending KV — see BLOCKED_EXTERNAL_ACCESS.md RL-08).
- Bounded body reader (64KB, malformed JSON → 400, no hang).
- Prompt-injection: single-turn + multi-turn split-jailbreak guard + per-turn history screening (user AND assistant turns); injected turns dropped before the model.
- PHI scrub on message, history and context fields (SSN/MBI/bank/DOB redaction) BEFORE the model.
- Scope router: wrong-business/vendor/greeting/loop turns never reach the model.
- No upstream status/telemetry leaked to clients (generic 502; usage/model/latency server-log only).
- Secrets: key read at call time, never logged; `sanitizeDetail` strips key-shaped strings from errors.

## /api/submit-lead
Honeypot, server-side validation (rejects 555 phones etc.), strict rate limit, Turnstile end-to-end (feature-gated, FAIL CLOSED when enabled), consent receipt (verbatim TCPA text + SHA-256 + disclaimer version), `ghl_contact_id` neutralized server-side (CRM-overwrite red-team F1), idempotency, PII-free [LEAD-AUDIT] log.

## /api/opt-out
Suppression-only by design (can never create/grant), input validation (400 without a valid identifier — shape-only, no membership oracle), uniform ack for every membership-dependent outcome (OPTOUT-01), CRM DND + audit note.

## Logging
[AI-AUDIT] / [LEAD-AUDIT] / [SCOPE-AUDIT] are PII-free by construction (categories, counts, hashes — never message text or identifiers). No chain-of-thought stored.

## Verified live (production)
2026-08-28 live sample: injection 3/3 blocked with zero prompt leakage; unsafe-advice 4/4 refused; 911/988 routing 4/4; burst of 50 no-consent leads → 50×400, zero accepted.

## Known gaps
- RL-08: rate limiting is per-serverless-instance until KV is provisioned (owner).
- Internal infra (secrets rotation, backups, SIEM) is outside this repo's scope — not audited here.

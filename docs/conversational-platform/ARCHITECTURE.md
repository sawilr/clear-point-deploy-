# Clear Point Conversational Platform — Architecture

**Date:** 2026-08-28 · Source spec: master conversational-platform prompt (owner, 2026-08-28).

## Two separate systems (spec §2)

| | System A — WEB | System B — VOICE |
|---|---|---|
| Agents | **Clara** (customer service, /support) · **Zara** (education & lead capture, site-wide — the spec's "Sara") | **Emely** (EN, 631-658-3796) · **Sofia** (ES, 940-477-8518) behind the Bilingual IVR on 855-720-8555 |
| Runtime | This repo → Vercel (`clearpoint-deploy`) | GoHighLevel Voice AI (sub-account `K90Ai2HKBv4oWp9fAmj9`) |
| Model | OpenAI Responses API — prod `gpt-5.6-terra`, preview/QA `gpt-5.6-luna`; Anthropic path kept as explicit fallback (`LLM_PROVIDER`) | GHL-managed (GPT 5.2 per agent config) |
| Cost driver | Tokens/requests on `/api/chat` | Minutes per call |
| Optimization | Deterministic pre-LLM layers (below) | Call-scope & closure policy — `docs/voice/VOICE-AGENT-SPEC-2026-08-28.md` |

No logic is shared between the systems; the voice spec is a standalone document applied in GHL.

## System A — request pipeline (`api/chat.js`)

Order is the contract (spec §145: security > privacy > compliance > correctness > CX > cost):

```
client (Clara widget / Zara LLM fallback)
  │  POST /api/chat {userMessage, history[], context{language,zip,state,…}}
  ▼
1  Origin allowlist → 403        7  Injection guard (single-turn)
2  Kill switch (env)             8  Multi-turn injection (split-jailbreak
3  Rate limit 30/5min/IP            only; clean follow-ups recover)
4  Bounded JSON body (64KB)      9  History replay screens (PHI scrub +
5  Emergency 911 / crisis 988       per-turn injection drop + 1500-char cap)
   / clinical concern           10  SCOPE ROUTER (deterministic triage)
6  Context scrub (PHI/injection 11  LLM call (static prompt cached prefix +
   per field)                       dynamic context block + reasoning:low)
                                12  Post-filters: compliance filter (12 rules),
                                    entity-scope gate, Medicare-figures
                                    backstop, USTED normalization
                                13  [AI-AUDIT] PII-free record
```

Steps 1–10 and 12 are **deterministic** — they run identically for any provider. The model is advisory; the deterministic layer is authoritative.

## Scope router (step 10) — `api/_lib/scope-router.js`

Classifies clearly-out-of-scope turns and answers them without the model:
- **wrong_business** — brand anchors + service-noun/context pairs; graduated ladder L1 redirect → L2 confirm → L3 polite close (strikes derived from the router's own prior replies found in client history — stateless).
- **vendor** — seller-shape required; consumer guard (scam reports protected); one refusal then close.
- **greeting / site_help / loop** — deterministic replies; loops get options then a human path, never a terminal block.
- **Whitelist-first:** any Medicare/health/coverage vocabulary bypasses the router. Unclear ≠ out of scope: the engine clarifies (spec §6).

Measured effect (2026-08-28, real handler): irrelevant turns 2.0–2.8s + full ~16.5K-token prompt → **6–66 ms, zero model calls**.

## Client-side engines

- Clara widget: `safetyRouter.ts` (stateless client life-safety net — must stay in parity with server `compliance-filter.js`; suite `test-safety-parity-server-2026-08-27.mjs`) → deterministic engine (`customerServiceEngine.ts`, intent corpus 95) → `/api/chat`.
- Zara: `ChatBot.tsx` flow engine (progressive profiling, one question at a time), leads via `api/submit-lead.js` (honeypot, server validation, consent receipt hash, idempotency, Turnstile feature-gated).

## Provider layer — `api/_lib/llm-provider.js`

Model routing by `VERCEL_ENV`; timeout 10.5s; one bounded retry (fast 429/5xx only); `reasoning.effort` low by default (`OPENAI_REASONING_EFFORT`, `off` = kill switch); no silent fallback chains — failures map to 502/503 and the client degrades to the deterministic engine.

## Session state (spec §30)

Stateless server by design. Conversation state travels in `context` (client) and is re-screened every turn; scope/loop state is derived from history content. Nothing to desync, nothing to store.

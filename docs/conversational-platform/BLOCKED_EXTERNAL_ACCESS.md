# BLOCKED — external dependencies (spec §142)

Work that is ready but gated on something only the owner can provide. Everything else shipped.

| # | Item | What's missing | Where | Test to run after |
|---|---|---|---|---|
| V1 | Apply voice call-scope policy to Emely & Sofia | Owner GO + 15-min window (live lines) | GHL → AI Agents → paste blocks from `docs/voice/VOICE-AGENT-SPEC-2026-08-28.md` (backup first) | 4 real calls: wrong-number EN/ES, vendor, real Medicare question |
| V2 | Conditional call tagging (AI_WRONG_NUMBER etc.) | Confirm GHL post-call workflow can branch on Voice AI outcome | GHL workflows | Place tagged test calls, check contact records |
| K1 | Global rate limiting (RL-08) | Vercel KV / Upstash instance + `KV_REST_API_URL`/`KV_REST_API_TOKEN` in Vercel env | Vercel dashboard → Storage | `test-live-security-sample` section E → expect 429s |
| K2 | Metrics persistence for owner dashboard (§110) | Same KV (or a log drain) | Vercel | Build dashboard next-phase |
| T1 | Turnstile anti-bot | Cloudflare site+secret keys in Vercel env (code feature-gated, FAIL CLOSED) | Cloudflare → Vercel env → re-promote | `test-submit-lead-security` + real widget check |
| A1 | Business mailing address on /contact | The address | `src/pages/Contact.tsx` (marked line) | visual check |
| C1 | TPMO carrier/plan counts | Owner confirms counts | `src/lib/tpmoConfig.ts` | copy renders counts |
| E1 | Real lead E2E to CRM | Owner-authorized test lead (phone they control) | production form | CRM record + consent receipt + SLA |
| P1 | Core Web Vitals certification | PSI quota (was 429) or field RUM | PageSpeed / CrUX | LCP/CLS/INP report |
| S1 | Anthropic fallback credit | Fund account (optional — OpenAI primary works) | Anthropic console | `LLM_PROVIDER=anthropic` smoke |

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
| V3 | Emely/Sofía greeting: AI identity + recording disclosure (master audit 2026-09-12, VOICE-L1, P1) | Owner GO (live lines). Current greetings: "Clear Point Client Services, this is Emely. How can I help you?" / "Hola, le habla Sofía…" — neither says the caller is speaking with an automated assistant nor that the call may be recorded; the TPMO sentence must also precede any benefit discussion (CY2027 wording from 2026-10-01) | GHL → AI Agents → Agent's Initial Message (backup first): EN "Clear Point Client Services, this is Emely, an automated assistant. This call may be recorded. How can I help you?" / ES "Hola, le habla Sofía, la asistente automatizada de Clear Point. Esta llamada puede ser grabada. ¿En qué puedo ayudarle?" | 2 real calls EN/ES; confirm the number-level recording message also plays on IVR-transferred legs |
| V4 | Post-call workflow "CP- Voice Post-Call (Emely & Sofia)" is DRAFT and NOT attached to Emely (`callEndWorkflowIds: []`); Sofía points at the draft → voice contacts get no tags (observed: last 20 contacts, 0 tags) (VOICE-L2, P2) | Owner GO | GHL → Workflows → publish; AI Agents → Emely → attach | Place a test call, check contact tags |
| V5 | Toll-free +1 855-720-8555 shows "Verification Required" (SMS/TFV) (VOICE-L3, P3) | Owner submits toll-free verification | GHL Trust Center | badge clears |
| V6 | Per-number Call Recording toggle + warning message on 855/631/940 could not be read via API or headless UI (NOT VERIFIED) | Owner screenshot | GHL → Settings → Phone Numbers → ⋮ → Edit configuration | recording message text present on all three |
| C2 | Carrier appointment status + logo permission for the 15 homepage logos (CMS-04) | FMO appointment report + carrier co-branding guidelines | src/pages/Home.tsx:134-150 | remove unauthorized logos |
| E2 | Real lead E2E: last website-sourced CRM contact (tag source-web) dates 2026-07-21; no successful production submission observed since several submit-lead changes | Owner-authorized test lead with a phone they control | production form | CRM record + consent receipt (at=/ip=/page=) + tags |

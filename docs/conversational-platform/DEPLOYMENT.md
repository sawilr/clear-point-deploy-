# Deployment — clearpoint-deploy

## The one rule
**`git push` builds a PREVIEW only. Production requires an explicit promote.**

```bash
git push origin security-hotfix/audit-2026-06-29        # → Preview build
vercel ls clearpoint-deploy --scope sawil-reyess-projects   # wait Ready (table prints on STDERR)
vercel promote <previewUrl> --scope sawil-reyess-projects --yes
vercel ls clearpoint-deploy --scope sawil-reyess-projects   # wait new Production row Ready
```

- Use the GLOBAL authenticated binary (`%APPDATA%\npm\vercel`) — `npx vercel` is broken (ETARGET).
- NEVER `vercel deploy --prod` from the repo folder (creates a stray project).
- Promote REBUILDS with production env — env-var changes need a re-promote to take effect.
- Production branch is `security-hotfix/audit-2026-06-29` (main is frozen, months behind).

## Verify after every promote
1. Bundle hash: `dist/assets/index-<hash>.js` local == live (`curl -s https://clearpointsenioradvisors.com/?cb=$(date +%s) | grep -o 'index-[^"]*\.js'`).
2. `POST /api/opt-out {}` → 400. 3. One `/api/chat` probe (needs `Origin` header; without it → silent 403).
4. Security headers (`curl -sI` → CSP/HSTS). 5. Anything the change touched, live.

## Environment (production)
`OPENAI_API_KEY` (provider auto-selects OpenAI), `HIGHLEVEL_TOKEN`, `HIGHLEVEL_LOCATION_ID`, optional: `LLM_PROVIDER`, `OPENAI_MODEL_*`, `OPENAI_REASONING_EFFORT` (default low; `off` kills the param), `OPENAI_TIMEOUT_MS`, Turnstile keys (feature-gated OFF until provisioned), KV vars (absent — RL-08).

## Safe-deployment ladder (spec §113)
DEV (local harness) → PREVIEW (Vercel, QA model gpt-5.6-luna, protected) → PROMOTE (production model). Voice changes (GHL) follow the staged runbook in `docs/voice/VOICE-AGENT-SPEC-2026-08-28.md` — backup prompt → paste → 5–10 min propagation → real test calls.

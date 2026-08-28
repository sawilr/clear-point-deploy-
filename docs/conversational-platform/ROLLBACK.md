# Rollback

## Web (Vercel)
Every promote records the previous Production deployment. Roll back = promote the previous deployment again:

```bash
vercel ls clearpoint-deploy --scope sawil-reyess-projects    # find the prior Production row
vercel promote <priorProductionUrl> --scope sawil-reyess-projects --yes
```

Rollback points (most recent first, 2026-08-28):
- Current production: `ed78f7f` (scope router).
- Prior: deployment of `06df1f6` (F2 merge fix) — promote of `jg5umfkmj`.
- Prior: `qzp0c5r7s` (75eb93f, audit remediation) · then `2f0qrazdu` (pre-remediation).

## Provider kill switches (no deploy needed — set env var + re-promote)
- `LLM_PROVIDER=anthropic` — swap provider entirely (requires funded Anthropic account).
- `OPENAI_REASONING_EFFORT=off` — drop the reasoning param if a future model rejects it.
- `CP_KILL_AI` / `CP_KILL_ALL` — endpoint kill switches (client falls back to the deterministic engine; NOTE: killing opt-out stops honoring revocations — see its header comment before using).
- Turnstile: absent keys = OFF (tree-shaken).

## Scope router
No flag — rolling back = promoting the prior deployment. Its blast radius is bounded by design: worst case is a polite deterministic reply instead of a model reply; life-safety and security gates run upstream and are untouched.

## Voice (GHL)
Rollback = paste the backed-up prompt (`docs/voice/backups/`) into the agent and save; ~5–10 min propagation. Never edit without the backup step.

# Known Limitations (honest register)

**Date:** 2026-08-28. Not hidden, not blockers for MVP; each has a path.

1. **Rate limiting is per-serverless-instance** (RL-08). Burst across instances sees no 429. Mitigation in place: validation rejects junk anyway (live: 50-burst → 50×400, 0 accepted). Fix: Vercel KV/Upstash (owner provisions, code ready).
2. **No persistent metrics store / owner dashboard** (§110). [AI-AUDIT]/[SCOPE-AUDIT]/[LEAD-AUDIT] emit complete PII-free events, but Vercel function logs are ephemeral without a drain. Cost/KPI dashboards (§47–48) need KV or a log drain first. Emission layer is done; storage is the gap.
3. **The confidence-scored intent classifier (§4/§5) runs in SHADOW only** — it logs intent + confidence per turn ([AI-AUDIT]) but routes nothing; the narrower regex scope router remains the only actor. This is the spec's own §114 rule: observe false-positive rates in the field first, then decide per-intent what may act. Promotion to acting classifier = next phase, after log review.
4. **ALLOWED_STATES not centrally configurable** (§19): NY/NJ/CT lives in content + engine strings + prompt. Changing footprint today = coordinated edit + full regression; an admin-config refactor is next-phase.
5. **Voice policy staged, not applied** — live phone lines; needs the 15-minute owner window (backup → paste → 4 test calls). Until then wrong-number calls behave as before.
6. **Lead score (§17–18)** not emitted as a 0–100 CRM field; qualification is flow-based (Zara) + tags. Adding the score touches CRM schema — next-phase with owner's field mapping.
7. **Zara's engine is client-side** — its deterministic replies cost nothing but its logic is inspectable in the bundle (accepted trade-off; no secrets client-side; abuse lands on rate-limited APIs).
8. **Voice observability** limited to GHL's own logs/recordings; per-call closure-reason tagging depends on GHL workflow capabilities (see BLOCKED V2).
9. **4 engine F2 greeting checks** were failing pre-2026-08-28; fixed (345/345) — noted here because the fix merged two historically conflicting guards (see CHANGELOG).
10. **Pre-existing engine false positives** documented 2026-08-18 ("$911", "911 Broadway", "cover the emergency room?") — LOW, deliberately untouched (narrowing a life-safety net is the dangerous direction); dedicated pass scheduled.
11. **TPMO (e)(41) counts still missing** (master audit 2026-09-12, P1, owner-gated): the standardized multi-carrier sentence requires organization/product counts; the site renders the standardized sentences without them until the FMO supplies the figures (`src/lib/tpmoConfig.ts`).
12. **Voice greetings lack AI/recording disclosure** (owner window required — BLOCKED V3); post-call tagging workflow is a draft (V4).
13. **Node 20.18 locally vs engines >=20.19**: `npm install` prints EBADENGINE warnings on this workstation (Vercel builds on Node 24). Upgrade the local Node when convenient.
14. **Storage-denied browsers** now render fully (safeStorage) but keep no language/consent/chat memory across reloads — by design.

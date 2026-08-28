# Known Limitations (honest register)

**Date:** 2026-08-28. Not hidden, not blockers for MVP; each has a path.

1. **Rate limiting is per-serverless-instance** (RL-08). Burst across instances sees no 429. Mitigation in place: validation rejects junk anyway (live: 50-burst → 50×400, 0 accepted). Fix: Vercel KV/Upstash (owner provisions, code ready).
2. **No persistent metrics store / owner dashboard** (§110). [AI-AUDIT]/[SCOPE-AUDIT]/[LEAD-AUDIT] emit complete PII-free events, but Vercel function logs are ephemeral without a drain. Cost/KPI dashboards (§47–48) need KV or a log drain first. Emission layer is done; storage is the gap.
3. **Scope router is regex-deterministic, not a learned classifier** (§4's 40-category taxonomy is partially collapsed into: safety, security, scope{wrong_business, vendor, greeting, loop, site_help}, in-scope-LLM). Deliberate: deterministic = auditable + free + no new attack surface. Unmatched ambiguity intentionally falls to the engine/LLM. A confidence-scored classifier is a next-phase item — shadow-mode it before letting it close anything.
4. **ALLOWED_STATES not centrally configurable** (§19): NY/NJ/CT lives in content + engine strings + prompt. Changing footprint today = coordinated edit + full regression; an admin-config refactor is next-phase.
5. **Voice policy staged, not applied** — live phone lines; needs the 15-minute owner window (backup → paste → 4 test calls). Until then wrong-number calls behave as before.
6. **Lead score (§17–18)** not emitted as a 0–100 CRM field; qualification is flow-based (Zara) + tags. Adding the score touches CRM schema — next-phase with owner's field mapping.
7. **Zara's engine is client-side** — its deterministic replies cost nothing but its logic is inspectable in the bundle (accepted trade-off; no secrets client-side; abuse lands on rate-limited APIs).
8. **Voice observability** limited to GHL's own logs/recordings; per-call closure-reason tagging depends on GHL workflow capabilities (see BLOCKED V2).
9. **4 engine F2 greeting checks** were failing pre-2026-08-28; fixed (345/345) — noted here because the fix merged two historically conflicting guards (see CHANGELOG).
10. **Pre-existing engine false positives** documented 2026-08-18 ("$911", "911 Broadway", "cover the emergency room?") — LOW, deliberately untouched (narrowing a life-safety net is the dangerous direction); dedicated pass scheduled.

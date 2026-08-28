# Clear Point — Continuous Compliance & Regulatory Update Engine

**Established:** 2026-08-28 · **Operator:** Claude (never Clara/Zara — they stay in their runtime, no internet, no code access). Owner master prompt: "Continuous Compliance & Regulatory Update Engine" (2026-08-28).

## Cadence
Full audit every **30 days** (scheduled task `clearpoint-monthly-compliance-audit`, day 27 monthly) + extraordinary runs on owner request or major CMS/state publication. Heightened attention Q3/Q4/AEP/January (CMS yearly transition).

## The cycle (per audit)
RESEARCH → COMPARISON → IMPACT → PROPOSAL → SELF-AUDIT (10 passes, §19) → OWNER APPROVAL → IMPLEMENTATION → TESTING → REGRESSION → DOCUMENTATION.
**Never implement a material regulatory change without owner approval** ("APPROVED / IMPLEMENT / PROCEED / GO AHEAD"). Sole exception: a year-transition previously verified, approved and scheduled (§12).

## Jurisdiction layers (never mixed)
1. **FEDERAL/CMS** — cms.gov, medicare.gov, federalregister.gov, ssa.gov, hhs.gov
2. **NEW YORK** — health.ny.gov (EPIC, MSP), dfs.ny.gov, aging.ny.gov
3. **NEW JERSEY** — nj.gov/humanservices (PAAD, Senior Gold, NJSave), DOBI
4. **CONNECTICUT** — portal.ct.gov/dss (MSP), CID, CHOICES/aging services
Official/primary sources only; third parties are leads, never authority. `AUTHORIZED_JURISDICTIONS` lives in `regulatory-database.json` — update there if the footprint changes.

## Comparison surface (§13)
The platform's regulatory assertions live in exactly these places — compare ALL of them each audit:
- `src/data/medicare-figures-2026.ts` — SINGLE SOURCE for federal figures + NY/NJ/CT MSP/SPAP (mirrored in `api/chat.js` prompt and `api/_lib/medicare-figures.js` backstop — the three MUST agree).
- `api/chat.js` system prompt (figures, referral phone numbers, program rules).
- Zara state-program scripts (`src/components/ChatBot.tsx` EPIC/PAAD/Senior Gold blocks).
- Site pages: disclaimers (DisclaimerBlock/TPMO), Privacy, Terms, consent text (`disclaimerVersion.ts` — hash-sealed, changes need version bump), enrollment-period content, footer.
- Voice specs (`docs/voice/`), recording disclosures (GHL numbers).

## Temporal rule engine (§6/§7)
Every tracked rule carries: id, jurisdiction, source_url, publication_date, effective_date, regulatory_year, status ∈ {CURRENT, FUTURE, EXPIRED, SUPERSEDED, PENDING_VERIFICATION}, supersedes/superseded_by. A FUTURE rule is NEVER activated before its effective date; a superseded rule is NEVER left active. Year transition: keep 2026 CURRENT + 2027 FUTURE side by side until effective dates arrive.

## Research discipline (§16–§19)
No lazy NOT-VERIFIEDs: search, read the official document, cross-check, then and only then escalate genuine legal ambiguity (LEVEL 3). LEVEL 1 explicit requirements → propose directly. LEVEL 2 interpretation → COMPLIANCE REVIEW RECOMMENDED with the located source. Access notes: cms.gov & health.ny.gov block plain fetchers (403) — use the browser pane; federalregister.gov bot-walls — use the CMS fact-sheet mirror via browser.

## After approval (§20–§22)
Backup/snapshot → minimal change → full battery (16+ suites) + compliance/security regression → EN+ES → NY/NJ/CT paths → mobile/desktop → chat/voice/forms/CRM as applicable → deploy per `docs/conversational-platform/DEPLOYMENT.md` → verify live → document in `COMPLIANCE_CHANGELOG.md`. Any failure: STOP, ROLLBACK (`ROLLBACK.md`), REPORT. Repeat to 0 P0/P1.

## Artifacts
- `compliance/regulatory-database.json` — persistent, versioned rule table (source of truth, never LLM memory).
- `compliance/audits/YYYY-MM.md` — monthly history, never deleted.
- `compliance/FUTURE_REGULATORY_CHANGES.md` — watchlist of published-not-yet-effective rules; every audit checks approaching activation dates.
- `compliance/COMPLIANCE_CHANGELOG.md` — every implemented change with full traceability (§23/§26).

## Owner report format (§33)
Executive summary first (CMS ✅/⚠️ · NY ✅/⚠️ · NJ ✅/⚠️ · CT ✅/⚠️ · ACTION REQUIRED · APPROVAL REQUIRED · CRITICAL), detail on request. Critical finding → immediate CRITICAL COMPLIANCE ALERT, never wait for the monthly report.

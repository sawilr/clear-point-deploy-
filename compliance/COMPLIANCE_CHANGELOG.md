# Compliance Changelog

Permanent history of implemented regulatory changes. Format per engine spec §23: every entry carries detection/approval/implementation dates, jurisdiction, source, previous vs new behavior, files, tests, rollback, approver.

---

## 2026-08-28 — Engine established (baseline, no regulatory change implemented)

- **date_detected / implemented:** 2026-08-28
- **jurisdiction:** ALL (engine infrastructure)
- **regulatory_year:** 2026
- **rule:** Continuous Compliance & Regulatory Update Engine established per owner master prompt; baseline audit executed — NO MATERIAL CHANGES FOUND (all four layers verified against official sources; see `audits/2026-08.md`).
- **previous_behavior:** figures verified ad-hoc per audit waves; no persistent rule database, no watchlist, no scheduled cadence.
- **new_behavior:** persistent `regulatory-database.json` (12 seeded rules, temporal statuses), `FUTURE_REGULATORY_CHANGES.md` (10 watchlist items), monthly audit history, 30-day scheduled task.
- **files_modified:** compliance/* (new only — no production behavior touched).
- **tests:** none required (no production change). Battery remains 16/16 from 2026-08-28.
- **rollback_reference:** n/a (additive documentation).
- **approver:** Owner (master prompt directive, 2026-08-28).

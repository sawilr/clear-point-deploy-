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

## 2026-09-13 — Master audit remediation (branch fix/master-audit-2026-09-10)
- **trigger:** owner directive 2026-09-10 (world-class zero-assumption audit + remediation loop); 109 findings from 9 auditor dimensions + lead inline checks; P1/P2 adversarially verified before implementation.
- **regulatory changes implemented:** Part D three-stage explanation (no coverage gap, 42 CFR 423.104(d)(2)(v)); TPMO (e)(41) statement on /support and in-page bands; CY2027 (e)(41) wording staged with automatic 2026-10-01 switch (91 FR 17384); count-less fallback reduced to the standardized sentences (counts still owner-gated); monthly LIS/dual SEP wording (423.38(c)(4)/(c)(35)); privacy policy names AI processors, CRM, host and call recording; contact card discloses recording; opt-out clears consent custom fields; TCPA receipt records timestamp/IP/page.
- **engineering safeguards:** next-year figure protection in the numeric backstop + build-time year guard (`scripts/check-figures-year.mjs`); origin allowlist restricted to team-suffixed previews; compliance-filter ReDoS fix and readable eligibility rewrites; storage-denied white screen fixed; CSP-safe 404; WCAG contrast/link/label/target fixes; CLS fix; unused-dependency purge + lockfile re-resolved to registry.npmjs.org; `npm test` battery.
- **adversarial rounds:** three independent red-team rounds ran against the remediation branch (30 + 31 + 44 reproduced defects, all closed): round 1 `afb8f0b`, round 2 `419c5cd`, round 3 `b6cc63d` + `ed5abd2`. Round 2 surfaced a latent P1 the suites could not see — a regex word boundary stored as a literal U+0008 byte had disarmed the 911 post-condition; `scripts/check-source-hygiene.mjs` now fails the build on any control character in the deployable trees. Round 3 surfaced a P1 the round-2 broadening had introduced: generic Medicare eligibility education ("you're eligible for Medicare at 65") was being replaced by the compliance filter's safe copy; the rule is now scoped to means-tested determinations.
- **TCPA-03:** Clara's advisor-callback paths no longer treat a typed phone number as consent — the canonical text is shown alone and a discrete "Yes, I agree" / "Not now" turn precedes any submission (code-verified; those paths are currently unreachable in the shipped flow, see KNOWN-LIMITATIONS #17).
- **files_modified:** see git log for `fix/master-audit-2026-09-10` (commits 66d1e72, b9b10da, ad4e9b5, afb8f0b, 419c5cd, 5022cd3, b6cc63d, ed5abd2 + dependency/docs commits).
- **tests:** deterministic battery via `npm test` (27 offline suites, ~46 s) — results recorded in the owner report; headless regression (crawl, axe on 59 page-states, cookie-consent network capture, failure-mode interception, viewport matrix, Lighthouse) re-run on the built site after every round.
- **rollback_reference:** production deployment before this change = `clearpoint-deploy-we0lnltua` (commit 5c7fd25, tag `audit-baseline-2026-09-10`).
- **approver:** owner directive 2026-09-10 ("sin preguntar y sin parar, todo terminado"); owner-gated items listed in docs/conversational-platform/BLOCKED_EXTERNAL_ACCESS.md (V3–V6, C2, E2) and NOT_VERIFIED.md (#8–#12).

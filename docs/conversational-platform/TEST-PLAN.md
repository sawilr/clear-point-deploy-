# Test Plan — Conversational Platform

**Date:** 2026-08-28. All suites deterministic and offline unless marked LIVE. TS-importing suites need `npx tsx`; pure-JS run with `node`.

## The battery (all green 2026-08-28)

| Suite | Checks | Covers |
|---|---|---|
| `test:clara` (npm) | 95 | Clara routing corpus |
| test-scope-router-2026-08-28 | 67 | scope triage, ladder, loops, §89 false-positive guards, wiring (safety/security upstream) |
| test-master-spec-corpus-2026-08-28 | 221 | 109 wrong-number + 56 vendor generated variations, §89 protected set, long conversations (30/50/100 turns), URL guard, active PII warning, shadow intent classifier |
| test-chat-wiring-2026-08-13 | 60 | production path: real handler → provider transport, telemetry stripped |
| test-mega-corpus-2026-08-27 | 514 (+309 live-gated) | Clara+Zara guard stack, EN+ES |
| test-audit-regressions | 345 | copy claims, topic humanizer, filters |
| test-emergency-dos-2026-08-15 | 22 | bounded emergency mode (mutation-proofed) |
| test-clara-emergency-adversarial-2026-08-18 | 58 checks / 47 seqs | red-team emergency sequences, 0 bricks |
| test-cardiac-detection-2026-08-18 | 17 | life-safety phrase net (both directions) |
| test-safety-parity-server-2026-08-27 | 19 | client/server safety-net parity |
| test-entity-scope-2026-08-15 (+wiring §9) | 43+60 | part-figure scope lock |
| test-multiturn-recovery-2026-08-27 | 5 | injection recovery (legit follow-ups answered) |
| test-optout-validation-2026-08-27 — **LIVE** (`CP_LIVE=1`) | 7 | opt-out 400/uniform-ack contract against the deployed API; excluded from the default `npm test` since 2026-09-13 (it POSTs to production and trips the per-IP rate limit when repeated) |
| test-submit-lead-security-2026-08-15 | 44 | lead endpoint security (uses anti-CRM interlock harness) |
| test-redteam-openai-r2-2026-08-14 | 24 | provider-integration red-team pins |
| test-clara-completion-2026-08-13 | 167 | conversation completion behaviors |
| test-fmo-r2-2026-09-03 | 43 | FMO round-2 fixes (C1 Part D cap, C2 FL out-of-area, C3 ES bill parity, C4 safety vocab, C5/C6 scope-router, C7 url-guard, C11 emergency veto, C12 plan-rec, C13 entity-scope, C16 consent scrub) |
| test-c9-consent-logic-2026-09-03 | 24 | Zara TCPA consent matcher (refusals decline, ambiguity reprompts) |
| test-c10-split-injection-2026-09-03 | 3 | 3-turn distributed injection blocked; legit follow-ups pass |
| test-c11-emergency-redteam-2026-09-03 | 39 | emergency-veto life-safety red-team (no benign over-trigger, no acute miss) |

## LIVE gates (production, read-only, no PII)
- `test-live-security-sample-2026-08-27.mjs` — 17 checks vs production (16/17; the 1 fail is RL-08, KV-gated).
- `scripts/demo-fmo-2026-08-28.mjs` — 10 reproducible FMO scenarios (10/10 on 2026-08-28).
- `live-scope-probe.mjs`, `live-openai-gate.mjs`, `live-clara-scenarios.mjs` — targeted live gates.

## Rules of the game
- Test the REAL layer: `_runStructuralFirst`/api handler, not offline fallbacks (the 2026-08-13 lesson).
- A new guard is NOT verified by its author's suite — independent red-team both directions (guardrail-verification rule).
- Local API work: `scripts/dev-api-server.mjs` (real handler on :3011); lead work: `dev-lead-server.mjs` (anti-CRM interlock).
- Every fix lands with a permanent regression suite; mutation-test guards where feasible.

## 2026-09-13 — `npm test` battery (master audit)
`npm test` (scripts/run-battery.mjs) runs 26 deterministic, offline suites in ~45 s: the 16 offline suites above plus `test-compliance-filter-r3-2026-09-13` (84: red-team round-3 deferral binding, ES/EN claim coverage, label/bullet removal, 911 invariant on every return path, linear-time guard), `test-medicare-figures-2026-08-18` (77 after red-team rounds 1–2: capture, survival, next-year, decimals, spelled-out years, January phrases), `test-cp03-clinical`, `test-falsepos-rules13-17`, `test-optout-lead02-authz` (15), `test-clara-routing` (95), `test-customer-service-language-lock` (10, repaired — pins the Phase D contract), `test-cardiac-detection`, `test-c9/c10/c11`, `test-plan-guidance`. Pass a substring to run a subset: `npm test -- figures`. `CP_LIVE=1 npm test` adds the live suite(s) (post-deploy only).
Also in `npm run build`: `scripts/check-source-hygiene.mjs` (fails on C0 control characters / U+FFFD in api/, src/, scripts/, public/ — added 2026-09-13 after a regex `\b` had silently become a U+0008 byte and disarmed the 911 post-condition), `scripts/check-figures-year.mjs` (year-rollover + cross-file value guard) and `scripts/build-sitemap.mjs` (git-derived lastmod).
Headless regression kit (outside the repo, scratchpad `qa-kit`): crawl (links/console/hreflang/tel), axe-core WCAG 2.2 AA on 59 page-states, cookie-consent network capture, failure-mode interception (API 500/503/429/timeout/offline, storage denied, JS off, chunk blocked), 10-viewport responsive matrix, Lighthouse.
Known pre-existing, not in battery: `scripts/test-phase-d.mjs` fails 1/N (T22 medication topic after es→en) — engine behaviour unchanged by the audit.

## 2026-09-14 — the round-5 suites and the build gates

`npm test` now runs **35** offline suites in about 55 s. Eight of them are new, and every one was written from a red team's own attack strings rather than from the code, because round 5 proved the opposite order does not work: five of six P1s in the reply filter and all five in the figure backstop were regressions of round-4 fixes that their author's suite had passed.

| Suite | Checks | What it pins |
|---|---|---|
| `test-emergency-postcondition-2026-09-14` | 42 | The invariant that a caller in a medical emergency is told to call 911. Both directions: the seven round-5 attack strings that must be REPLACED, the genuine instructions that must be KEPT, and the identification form ("the emergency number is 911") that round 4 threw away. |
| `test-dob-redaction-2026-09-14` | 31 | Birth dates never reach the enrichment model. Every case runs BOTH with and without a supplied `date_of_birth`, because the without case is the one that was broken and covers most production traffic. Controls prove a bare year survives, as Safe Harbor allows. |
| `test-medicare-figures-r5-2026-09-14` | 49 | The rebuilt guards: competing-subject scoping, the 20x band with $0 always corrected, the monthly-cadence cases the old cost-noun list silenced, income context scoped to the premium alone, list-ancestor and anaphoric inheritance, hyphenated year ranges, captions below a block. |
| `test-figures-year-scope-r5-2026-09-14` | 16 | The year heading governs its whole list, at 59 lines, at 60, at 500, and through blank lines and long bodies — the exact edges the bounded walk failed at. Plus a time bound: 167 KB verified in 87 ms, where 124 KB used to take 1,262 ms. |
| `test-compliance-filter-r5-2026-09-14` | 83 | Every round-5 filter finding, both directions. The false-positive half is the important half: offers to check, questions about rules, lead-capture confirmations, statutory education and protective SSN warnings must come back byte-identical. |
| `test-submit-lead-r5-2026-09-14` | 132 | The scrubber's appetite and its reach: 14 ordinary Spanish and English sentences that must survive for leads named Cruz, Ángel, Amor, Art, April, América, Estrella, Consuelo, Nieves, Ana, Eva, Olga, Rosa and Mar — and the same names redacted when they are actually the lead's. Homoglyphs, joined handles, spoken numbers, ZIP and age banding, the tag vocabulary, the receipt path. |
| `test-lead-intel-metadata-r5-2026-09-14` | 28 | Two layers: the handler's allow-lists, and the cap-and-flatten guard at the model boundary that protects whatever field is added to that object next. |
| `test-consent-classifier-r5-2026-09-14` | 74 | 26 ways to refuse, 28 to agree, and the acknowledgements that must stay ambiguous. Lifted from the shipped component so it tests the deployed regexes. |

### Build gates

`npm run build` now runs five gates before it compiles anything. Each exists because the same class of failure had already happened at least twice, and each is proven against a copy of the tree that contains the defect it catches.

| Gate | Catches | Proven by |
|---|---|---|
| `check-source-hygiene.mjs` | A control character in deployable source — how a `\b` became U+0008 and silently disarmed the 911 post-condition. | It caught a literal control class typed into `api/submit-lead.js` on 2026-09-14, mid-audit. |
| `check-figures-year.mjs` | The figure year disagreeing across files, a value that does not appear verbatim in the prompt, a decimal tail slipped onto a figure, a stale comment shadowing the real constant, or a year ahead of the calendar. | Copies with `$283.50`, with a shadowing `const`, and with a 2029 year each exit 1 naming the reason. |
| `check-allowlist-drift.mjs` | A producer sending a `lead_source`, `lead_type` or `medicare_status` the server allow-list discards, which writes no routing tag and errors nowhere. | It found a live instance on its first run: `lead_source: 'zara_education'` had been tagging every Zara education lead `Source-other`. |
| `check-zero-cost-claims.mjs` | A "$0 premium" claim with no cost qualifier in its own sentence or the next. | A copy carrying the exact pre-fix Medicare Advantage wording exits 1. |
| `check-contact-consistency.mjs` | A wrong digit in the business phone anywhere in the deployable source, or a rendering the codebase does not recognise. 188 hand-written copies across 39 files; `CONTACT_CENSUS=1` prints the per-file breakdown. | A copy with one digit changed exits 1 naming the file and line. |

### Browser verification of the round-5 client fixes

Run against the production build served at `:4173`, in `qa-kit/work/redteam5/`:

- `verify-r5-fixes.js` — 20/20: `/es/thank-you` renders Spanish and is not the SPA 404, both thank-you routes stay noindex and keep their home link in their own language space; the phone field's value, pattern, title and placeholder agree and three paste formats normalise; the Medicare Advantage hero's $0 claim carries its Part B qualifier in both languages; Zara's chat carries the (e)(41) sentence in both languages.
- `cpr5-p1-probe.js` — 12/12 route and width combinations with Clara's greeting and language chips inside the visible transcript and the disclosure unclipped; the guide dialog at 0 axe violations with the page behind held at scroll 0.
- `check-support-disclosures.js` — recording, commission and TPMO all present on `/support` and `/es/support` at 320, 390, 430 and 1280, with the strip outside the scrolling log and fully visible at every one.
- `p3c-tabscan.js` / `p3b-fab-keyboard.js` — the Zara launcher is unreachable by Tab at every width while the consent banner is open, and Enter opens nothing.
- `work/A11Y/axe-run.js` — 0 violations across 27 page-states.

One flake was found and fixed rather than tolerated: the 50 KB linear-time assertion in `test-medicare-figures-2026-08-18` failed once at 208 ms against a 200 ms budget while a red-team workflow saturated the machine. It now warms up and takes the best of three runs, because what it exists to catch is a return to quadratic time — a five- or ten-fold blowout, not a 4% one.

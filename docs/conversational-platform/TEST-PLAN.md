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
| test-optout-validation-2026-08-27 | 7 | opt-out 400/uniform-ack contract |
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

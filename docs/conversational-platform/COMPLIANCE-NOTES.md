# Compliance Notes — Conversational Platform

**Date:** 2026-08-28. Implemented behavior + open items. This is an engineering record, NOT legal advice; the NOT_VERIFIED register lists everything that needs a compliance/legal reviewer.

## Implemented (deterministic, tested)
- **Life safety first:** 911 (medical) / 988 (self-harm, wins over medical) / clinical-concern tier run before EVERYTHING including injection guards and the model; client (`safetyRouter.ts`) and server (`compliance-filter.js`) stay in enforced parity (suite 19/19). Emergency mode is bounded (no 911-loop DoS) and recoverable.
- **Education vs recommendation (§24):** the bots educate; plan selection questions get general education + licensed-advisor path (FMO demo #127 scenario). Deterministic compliance filter rewrites unsupported coverage/plan-letter assertions; entity-scope gate strips figures attributed to a Part the caller did not ask about; Medicare-figures backstop pins 2026 numbers.
- **No guarantees (§70):** absolute-claim guard (F4a) scans source; marketing copy audited 2026-08-27 (independence/compensation wording made precise).
- **TCPA:** consent unchecked-by-default, verbatim hashed consent receipt, DNC opt-out guard bilingual in both bots, web opt-out endpoint suppresses in CRM with audit note; revocation honored via chat channel.
- **TPMO:** persistent disclosure band on the site; carrier-count claims BLOCKED until owner confirms counts (`tpmoConfig.ts`).
- **PII minimization (§23, §52):** PHI scrub before the model; PII-free logs; no chain-of-thought stored; localStorage holds no PII.
- **Third parties (§22):** engine recognizes caregiver/family framing; no private-record disclosure paths exist (no account lookup surface in chat).
- **Out-of-state (§20):** NY/NJ/CT honestly stated; SHIP/1-800-MEDICARE referral built into engine replies (no invented external agents).

## Voice (System B)
Recording ON with disclosure message on both lines (CT two-party). Scope/closure policy staged in `docs/voice/VOICE-AGENT-SPEC-2026-08-28.md` — does not alter any existing disclosure.

## ALLOWED_STATES (§19)
Currently NY/NJ/CT, expressed in content, engine strings and the system prompt. A single admin-configurable `ALLOWED_STATES[]` does not exist yet — tracked in KNOWN-LIMITATIONS.md (next phase; touching it means engine+prompt+content refactor with full re-red-team).

## Open items
See `NOT_VERIFIED.md` (register) and `BLOCKED_EXTERNAL_ACCESS.md` (owner-gated).

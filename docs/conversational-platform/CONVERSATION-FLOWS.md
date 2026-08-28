# Conversation Flows

**Date:** 2026-08-28. The internal cycle every turn follows (spec §3): OBSERVE → INTERPRET → CONFIDENCE → CLASSIFY → RISK → RESPOND → REASSESS → ESCALATE/CONTINUE/CLOSE. Labels are internal; the visitor never sees them.

## Web turn (Clara / Zara-fallback via /api/chat)

```
message
 ├─ life-safety? ──────────── 911 / 988 / clinical reply, END (LLM skipped)
 ├─ injection? ────────────── refusal, blocked=prompt_injection (LLM skipped)
 ├─ scope router
 │   ├─ pure greeting ─────── deterministic welcome
 │   ├─ loop (same msg ×3) ── options → (×4) human path (855-720-8555)
 │   ├─ vendor ────────────── one refusal → 2nd pitch: polite close
 │   ├─ wrong business ────── L1 warm redirect → L2 confirm → L3 close
 │   └─ in-scope / unclear ── pass through (unclear is NEVER closed — §6)
 └─ LLM (terra) + deterministic post-filters → answer
     meta: wantSchedule / wantHandoff / wantClose drive the widget
```

**Ladder rescue rule:** at any level, one Medicare/health word routes the turn back to the full engine — a person who pivots is never trapped.

## Clarification protocol (§7)
Engine-side: clarification 1 reformulates; clarification 2 offers concrete options ("¿Medicare, una cita, o su cobertura actual?"); persistent no-signal → human path. `clarificationCount` travels in context; loops never run unbounded.

## Lead qualification (Zara, §16/§66)
Progressive profiling, one question per turn, no re-asking answered facts (state inferred from "Bronx" etc.), correction handling ("dije New Jersey, no New York" → update + confirm), consent unchecked-by-default with verbatim hashed receipt, honeypot + server validation before CRM.

## Appointment path (§71)
Explicit intent ("schedule a call") → `wantSchedule` immediately (live-verified: 1.5s, no lecture) → widget scheduling flow → confirmation with minimum necessary data.

## Handoff summary (§41)
Lead payload to CRM carries: reason/source, language, state, key facts, consent status + receipt hash, tags. Voice handoff spec: `docs/voice/VOICE-AGENT-SPEC-2026-08-28.md`.

## Closure taxonomy (§77)
Logged via [SCOPE-AUDIT] `closure_reason` (OUT_OF_SCOPE today) and meta flags (wantClose). Full taxonomy (RESOLVED/APPOINTMENT/HANDOFF/…) emitted where the flow produces it; expanding coverage is listed in KNOWN-LIMITATIONS.

## Voice call (System B)
First-30-seconds: greeting+identity → open question → classify → continue/clarify(≤2)/close. Wrong number: warm scripted close ≈20–60s (never rigid for vulnerable callers). Vendors: one sentence, end. Spam/silence: prompt once, then close. Full scripts EN/ES in the voice spec.

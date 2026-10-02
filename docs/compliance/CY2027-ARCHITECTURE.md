# ClearPoint CY2027 — compliance architecture

**Status: IMPLEMENTED — STAGING (branch only).** Nothing in this document is live.
The SOA workflow remains gated off (`SOA_ENABLED = false` in all four mirrors) and no
production deploy has been made. Owner approval is required before any of this reaches
the public site.

Baseline / rollback point: git tag `cy2027-phase0-baseline` (`e050448`).

---

## 1. Why the layer exists where it does

`api/*.js` cannot import from `src/`. That one constraint, verified on 2026-10-01
(zero occurrences of any `../src` import across `api/`), is what produced the defects
this layer replaces: the TPMO §422.2267(e)(41) sentence existed in **three** divergent
copies and `SOA_ENABLED` in **four**, because neither side could reach the other.

The CY2027 layer therefore lives in `api/_lib/cy2027/` as **environment-neutral ESM** —
no Node APIs, no DOM — so the Vercel functions import it directly and the Vite client
imports it through `src/lib/cy2027.ts`. Types come from sibling `.d.ts` files, so the
client is typed without a second copy of any string.

`scripts/check-cy2027-parity.mjs` runs in `npm run build` and fails the build if a copy
reappears, if the approved wording changes without its digest being re-pinned, if the
`SOA_ENABLED` mirrors disagree, or if a `.d.ts` promises an export the `.js` lacks.

```
api/_lib/cy2027/
  soa-text.js        approved customer-facing wording + categories (VERBATIM)   [shared]
  state-rules.js     state-first jurisdiction engine, ZIP/county                [shared]
  rulesets.js        immutable per-plan-year CMS rulesets + kill switch         [shared]
  soa-instance.js    appointment-specific instance + marketing gate             [shared]
  consent.js         the four distinct consent objects                          [shared]
  trust.js           lead trust state, anti-abuse, human confirmation gate      [shared]
  retention.js       retention by record class + legal hold                     [shared]
  carrier-overlay.js private carrier registry (licensed workspace only)         [shared]
  tpmo.js            canonical (e)(41) disclaimer + counts config               [shared]
  evidence.js        integrity hash, text snapshot, audit log            [SERVER ONLY]
```

---

## 2. State machines

### 2.1 SOA instance

```
                     createSoaInstance()
                             │
          ┌──────────────────┴───────────────────┐
          │ at least one authorizing category    │ only "I am not sure" / none
          ▼                                      ▼
  PENDING_SIGNATURE                        SOA_INCOMPLETE ──► licensed agent
          │                                                   explains process;
          │ completeSoaInstance()                              never forced to
          │  requires integrityHash + evidenceReference        completion
          ▼
      COMPLETED ──────────────┬──────────────────┐
          │                   │                  │
          │ superseded()      │ revokeSoa…()     │ (stays COMPLETED)
          ▼                   ▼                  │
      SUPERSEDED           REVOKED               │
   supersededById set   revokedAt set            ▼
                                          marketingGate()
```

`appointmentId` is **required** at construction. That single rule is what makes a
standing universal SOA unrepresentable rather than merely discouraged (spec §7: CMS
rejected the universal SOA for CY2027).

**`marketingGate(instance, appointment, ruleset)`** refuses, in order, with a named
reason — never a bare boolean:

| Reason | Meaning |
|---|---|
| `NO_SOA` | nothing to check |
| `SOA_INCOMPLETE` | nothing was authorized |
| `SOA_SUPERSEDED` / `SOA_REVOKED` / `SOA_NOT_COMPLETED` | not a live authorization |
| `SOA_EVIDENCE_MISSING` | hash or evidence reference absent → gate stays locked (§26) |
| `NO_APPOINTMENT` / `SOA_FOR_DIFFERENT_APPOINTMENT` | scope is per-appointment |
| `SOA_PLAN_YEAR_MISMATCH` | plan year changed; no silent reuse (§7) |
| `SOA_STATE_MISMATCH` | jurisdiction changed |
| `SOA_NOT_RECORDED_BEFORE_APPOINTMENT` | the CY2027 ordering rule |
| `IN_PERSON_REQUIRES_WRITTEN_SOA` | voice-only never unlocks an in-person appointment |

### 2.2 Plan-year rulesets

```
PENDING_REVIEW ──► VERIFIED ──► STAGING_TESTED ──► PRODUCTION_ACTIVE ──► SUPERSEDED
```

No code path promotes a ruleset: promotion is a human edit (§22, "No AI self-promotion").
`CMS_RULESET_2026` is preserved verbatim and marked `SUPERSEDED` — `rulesetForAudit(2026)`
still returns it so a 2026-dated SOA remains explainable. `resolveRuleset()` refuses to
let a non-`PRODUCTION_ACTIVE` ruleset govern live work.

CY2027 encodes: `advanceWaitHours: 0` (the 48-hour wait is **removed**),
`mustPrecedeAppointment: true`, `inPersonRequiresWritten: true`,
`universalStandingSoaAllowed: false`, `tpmo.includesShipReference: false`.

Kill switch: `CY2027_REGULATORY_KILL=1` in the environment disables the marketing
workflow immediately, without a deploy (§22).

### 2.3 Lead trust

```
          no signals                 1 signal            ≥2 signals, or an attempt
              │                          │                to reach another record
   ┌──────────┼──────────┐               ▼                          ▼
   ▼          ▼          ▼      HUMAN_REVIEW_REQUIRED      SECURITY_QUARANTINE
UNVERIFIED  PARTIALLY  VERIFIED
            VERIFIED   REQUEST
         (OTP = channel) (human-verified identity)
```

Two invariants are enforced in code, not prose:

- **Uncertainty is not fraud.** No state denies service. `trustCapabilities()` keeps
  `mayBeServedByHuman: true` in every state, including quarantine.
- **An OTP proves control of a channel, not identity.** `CHANNEL_VERIFICATION` and
  `IDENTITY_VERIFICATION` are separate fields; channel verification tops out at
  `PARTIALLY_VERIFIED`.
- `assertSignalAllowed()` **throws** for health, disability, medication, Medicaid, LIS,
  income, race, gender, national origin, accent, caregiver presence, lacking email,
  struggling with questions and expected commission (§15, §33).
- `resolveSecurityReview()` throws for an actor matching `ai|bot|system|automation`
  (§13, "No AI self-approval of quarantined cases").

### 2.4 Consent — four objects, never inferred from each other

| Object | Never inferred from |
|---|---|
| `RECORDING_NOTICE` | callback permission, SOA, website submission |
| `CALLBACK_CONTACT_PERMISSION` | recording notice, SOA, prior customer relationship |
| `SCOPE_OF_APPOINTMENT` | callback permission, "tell me everything", browsing |
| `AI_OUTBOUND_VOICE_CONSENT` | callback permission, a generic "you may call me" |

`assertNoCrossInference()` **throws** rather than returning false — a boolean could be
ignored, and this is the control that stops "they signed an SOA, so we may robocall them".

`classifyReply()` returns `UNCLEAR` for bare `ok / okay / sure / claro / por favor / y`
and `NOT_ASKED` for silence. Neither is ever consent (§6).

`mayPlaceOutbound()` returns `AI_OUTBOUND_ARCHITECTURE_NOT_VALIDATED` even when an AI
outbound consent record exists: outbound Voice AI stays disabled until a separately
validated legal/consent architecture is built and tested (§24).

### 2.5 Retention

Assigned **by record class**, longest applicable period (§19). Marketing/sales call
records: 6 years minimum; audio itself for years 0–3; audio **or** a complete accurate
transcript for years 4–6. `ENROLLMENT_RECORD` is deliberately `null` —
"may be different/longer" is not a number, and `mayPurge()` refuses to purge a class
whose period is unconfirmed. Every uncertainty (unknown class, unparseable date, active
hold) resolves to **keep**.

---

## 3. Jurisdiction

| State | `STATE_RULESET_VERSION` | `SOA_FORM_VERSION` |
|---|---|---|
| New York | `NY-CY2027-v1.0` | `CP-SOA-NY-CY2027-v1.0` |
| New Jersey | `NJ-CY2027-v1.0` | `CP-SOA-NJ-CY2027-v1.0` |
| Connecticut | `CT-CY2027-v1.0` | `CP-SOA-CT-CY2027-v1.0` |

Taken verbatim from the approved templates — they print on the evidence copy, so they
are data, not cosmetics.

- `resolveStateRuleset()` fails closed with a named reason: `NO_STATE`, `INVALID_STATE`,
  `STATE_NOT_SUPPORTED`, `RULESET_MISSING`, `RULESET_NOT_ACTIVE`, `RULESET_EXPIRED`,
  `RULESET_NOT_YET_EFFECTIVE`. A state outside NY/NJ/CT is **not** a security event — it
  returns `humanReview: false` and routes to the general service path (§5).
- **County is never guessed.** `resolveCounty()` ships with no dataset and always returns
  `ASK_BENEFICIARY`, which is the branch the spec already requires for ambiguous ZIPs.
  Installing a licensed ZIP→county dataset later is a data change (`setCountyDataset()`),
  not a code change. Inventing one would have been fabricated data.
- `zipStateConsistency()` is a **review signal, never a rejection**. It encodes the two
  documented oddities that would otherwise flag real people: Holtsville NY (00501/00544)
  and Fishers Island NY (06390, inside the Connecticut 063xx block).

---

## 4. Carrier firewall

The public website, the chat bots and the SOA flow never name, rank, compare or
recommend a carrier. The registry in `carrier-overlay.js` is reachable only with
`context: 'LICENSED_AGENT_WORKSPACE'`; every other caller gets a thrown error.

**All ten overlays ship `PENDING_*`, so `canDiscussCarrier()` currently refuses every
carrier.** That is the intended fail-closed state, not an oversight: spec §17's own
"Implementation status" column says each one still needs private, contract or
current-year verification, and marking any of them `VERIFIED_CURRENT` would be
fabricated compliance evidence. A valid Master SOA is deliberately **not** an input to
this gate — §33 lists "carrier-specific requirement is bypassed because Master SOA
exists" as an immediate-fail.

---

## 5. Evidence

`buildEvidenceRecord()` stores the **exact wording the beneficiary saw**, in their
language — not just the checkbox codes — so the record is self-explaining years later
without this repository at this version. The SHA-256 integrity hash covers the rendered
text, the selections and the identifiers; it deliberately excludes `context` (IP, user
agent) so a proxy change can never look like tampering with the agreement.

`auditEvent()` requires actor, result, source and correlation id, and redacts
SSN/MBI/bank/card/DOB/token values from `details` before they reach a log line.

---

## 6. What is NOT done

Stated plainly rather than implied:

| Item | Status |
|---|---|
| TPMO organization/product counts | **OWNER-SUPPLIED.** `BLOCKED_COUNTS_REQUIRED`; the count-less standardized sentence renders. Never to be guessed. |
| Evidence store backend | **CONFIGURATION.** The code path is complete and fails closed, but `CY2027_EVIDENCE_STORE_URL` / `_TOKEN` are unset, so `signedPdfPersisted` stays false until a real round trip is verified. |
| Carrier overlays | All `PENDING_*`. Each needs private/contract/current-year verification. |
| ZIP→county dataset | Not installed; the form asks the beneficiary instead. |
| `ENROLLMENT_RECORD` retention period | Unconfirmed; that class cannot be purged at all until the owner supplies it. |
| Recording-notice all-party positions | Carried as the project's existing position of record, flagged `complianceReview: OWNER_COUNSEL`. Not re-determined by this code. |
| Carrier firewall in the chat bots | The private registry exists; what Clara/Zara may answer has not been re-audited against the §20 knowledge classes. |
| Data minimization in lead scoring | `api/_lib/lead-intel.js` has not been audited against the prohibited-signal list. |
| Consent objects as CRM fields | Modelled in code; not yet written as queryable CRM fields. |
| Confirmation copy to the beneficiary | Not implemented (spec §9). |
| SOA workflow enablement | `SOA_ENABLED = false` in all four mirrors. Four of six preconditions now closed; `tpmoCountsVerifiedEverywhere` and `signedPdfPersisted` remain. |
| Production deploy | Not done. Requires owner GO. |

---

## 7. Verification performed

- `npm run build` — 46/46 routes prerendered; the parity guard runs inside the build.
- `tsc -b` clean; `eslint .` clean.
- `npm test` — 44/44 suites.
- `scripts/test-cy2027-2026-10-01.mjs` — 223 assertions covering every gate in both
  directions (blocks what it must block, still permits what must keep working).
- **Mutation-tested**, because a suite does not verify its own author's control:
  removing the in-person→written rule, admitting a prohibited trust signal, and marking
  one carrier overlay `VERIFIED_CURRENT` each make the suite fail. Files restored; the
  suite returns to 223/223.
- Prerendered HTML verified to carry the CY2027 TPMO sentence (no SHIP reference) in
  both EN and ES, with zero occurrences of the CY2026 sentence remaining in `dist/`.

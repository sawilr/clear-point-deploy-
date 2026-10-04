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
  callback-consent.js the web callback consent as a record: digest, scope, CRM   [SERVER ONLY]
                     + its receipt line, its revocation, the CRM retry policy
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
| `SOA_LANGUAGE_NOT_ELECTED` | the record cannot say the signer chose the language it was read in (G08) |
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

#### 2.2a The yearly engine (added 2026-10-04)

**The defect that prompted it.** `activePlanYear()` was `t >= CY2027_START ? 2027 : 2026`:
it answered 2027 forever. On 1 October 2027 the system would have gone on applying the
CY2027 ruleset — and the form the literal year 2027 — to CY2028 appointments, silently.
That is the §33 immediate fail "old-year rules … silently reused for new plan year". The
year is now computed from the calendar for any date (`marketingStartUtc(year)` = 1 October
of the year before, 00:00 Eastern), and a year with no usable ruleset fails closed.

| Piece | Where | What it guarantees |
|---|---|---|
| Plan-year clock | `rulesets.js` `activePlanYear`, `marketingStartUtc` | the year in force for any instant; `NaN` (a refusal) when the clock is unreadable |
| Lifecycle | `ruleset-lifecycle.js` `recordRulesetTransition` | one step at a time, forward only, by a named person, with an instant and an evidence reference |
| Promotion record | `promotion` on every CMS and state ruleset | who made it active — or `null`, truthfully, when nobody is on record |
| Grandfathering | `GRANDFATHERED_RULESET_VERSIONS` (closed, pinned by the suite) | the five rulesets activated before the lifecycle existed are usable but report `GRANDFATHERED_PENDING_OWNER`; no other ruleset can be active without a human promotion record |
| Source review | `sourceReviews` + `sourceReviewStatus` | each required source's verification and review-by dates; `null` = not on record, reported, never invented; a **stated** review-by date that has passed locks the workflow (`RULE_SOURCE_REVIEW_OVERDUE`) |
| Registered-object check | `rulesetVouchProblem`, called by `marketingGate` | the gate relies only on THE registered ruleset of that year, not on an object that resembles one |
| CY2028 placeholder | `CMS_RULESET_2028`, `PENDING_REVIEW` | the next year has a named state; every rule value is `null` — nothing was copied from 2027 |
| Readiness | `yearly-readiness.js` → `npm run preflight` | says what a person must do and when: warns a year out, **blocks** inside 120 days of a rollover with no ready ruleset, and blocks a promote when the plan year in force is newer than the TPMO wording on file |

**What a refusal affects.** `resolveRuleset()` governs the SOA/marketing workflow only.
Nothing on the public site or in lead capture calls it, so none of the above can take the
site down. The public TPMO sentence is deliberately never switched off: after a rollover
the newest verified wording keeps rendering and preflight blocks the next promote until a
person confirms the new year's sentence (`LATEST_TPMO_VARIANT_PLAN_YEAR`).

**Stated plainly — the open attestation.** The CY2027 CMS ruleset and the NY/NJ/CT state
rulesets are `PRODUCTION_ACTIVE` because the code that introduced them said so. No person
is on record as having reviewed the sources and promoted them; their `promotion` records
are `null` and no reviewer was invented. This is carried as the SOA precondition
`rulesetPromotionAttested` (false), so the SOA workflow cannot be enabled until the owner
attests. To attest: review the five sources in `CMS_RULESET_2027.sourceReviews`, fill in
`verifiedOn` / `verifiedBy` / `reviewBy` and the `promotion` record (name, UTC instant,
evidence reference) in `rulesets.js` and `state-rules.js`, then flip the precondition.

**Preparing CY2028** (Phase 12): fill the placeholder's rule values from the CY2028 final
rule, record each lifecycle step with `recordRulesetTransition`, add the CY2028 TPMO
variant if the standardized sentence changes, and add the 2028 state rulesets. Until then
the workflow fails closed on 1 October 2027 by design.

#### 2.2b Controlled learning (spec §23, added 2026-10-04)

**The rule.** "Emely/Sofía do not autonomously rewrite their production prompts, SOA
language, compliance rules or knowledge base from conversations … No production
self-modification." §33 lists "production prompt or rules self-modify from live
conversations" as an immediate fail. Before 2026-10-04 this held only because nobody had
written the code that would break it. It is now a record, a pipeline and a build gate.

**What a candidate is.** An observation about the SYSTEM, never about a caller, built by
`createCandidateLearning()` in `api/_lib/cy2027/learning.js`:

| Field | Allowed values |
|---|---|
| `kind` | the six the spec names: `RECURRING_CALLER_CONFUSION`, `FAILED_PHRASE`, `MISSING_FAQ`, `ROUTING_ERROR`, `REPEATED_TRANSFER_CAUSE`, `PRONUNCIATION_ISSUE` |
| `surface` | `VOICE_EMELY`, `VOICE_SOFIA`, `WEB_CLARA`, `WEB_ZARA`, `WEB_CHAT` (the shared endpoint `api/chat.js`, which is not told which web assistant is asking and does not guess), `WEB_FORM` |
| `language` | `en` or `es` |
| `summary`, `agentPhrase` | what the assistant did. Refused — not cleaned — if the scrubbers find an identifier, a date, a long number, clinical / benefit / financial detail or the common ways a person is named |
| `occurrences`, `createdAt`, `candidateId` | a count, a UTC instant, an id of a fixed shape |

One limit is stated rather than hidden: no scrubber recognises a bare personal name, so
the first human stage must reject a candidate that quotes or names a caller.

**The pipeline.** `CANDIDATE → HUMAN_COMPLIANCE_REVIEW → SOURCE_VERIFICATION →
VERSIONED_CHANGE → REGRESSION_TESTS → RED_TEAM → APPROVAL → DEPLOYMENT`, the spec's order.
`advanceCandidate()` moves ONE stage and throws unless a named person decided it
(`humanActorProblem()` in `actors.js` — the same check as quarantine review and ruleset
promotion), with a real UTC instant no earlier than the previous step and a reference to
what was reviewed. `rejectCandidate()` is terminal and is held to the same rules. Every
function that uses a record first re-checks the whole record — its fields, its closed list
of keys and its history (`candidateHistoryProblem()`): a record assembled by hand with an
undefined kind, a caller's details in the summary, an extra field, a skipped stage or a
step decided by automation is refused at every stage, not only where it is built
(the first independent read found the constructor refusing what `advanceCandidate()` and
`candidateLogLine()` then accepted; fixed and pinned by behaviour).

**Nothing in the repository applies a learning.** No function in `learning.js` accepts,
returns or writes a prompt, a ruleset, a knowledge body or SOA text, and the suite pins the
module's exact export list so that adding one is a visible, reviewed change. Reaching
`DEPLOYMENT` records that people approved and shipped a change through the normal route (a
reviewed commit); it does not ship it. There is also **no store**: the module keeps
nothing, anywhere. A candidate exists as one log line until a person picks it up.

**The one emission point.** `api/chat.js`, at the signal it already had: the deterministic
compliance post-filter had to correct what the model wrote. It logs one line —
`[CANDIDATE-LEARNING] {candidateId, kind:"FAILED_PHRASE", surface:"WEB_CHAT", language, stage:"CANDIDATE", occurrences:1}` —
built by `observationLogLine()` from a fixed summary sentence. The line carries no caller
text, no model text, no rule tag (those quote the reply) and no address; the language is
the one the correction was made in (`en`/`es`), never the string the browser sent. It
changes no reply and no routing, nothing reads it back, and a refused observation produces
no line and no exception. No other surface emits a candidate today.

**The build gate** `scripts/check-no-self-modification.mjs` (in `npm run build`, shipped
to the Vercel build by its `.vercelignore` exception):

| It proves, on every build | It cannot prove |
|---|---|
| no file under `api/` imports `fs`, `fs/promises`, `child_process`, `worker_threads`, `vm` or `cluster`, uses `eval` / `new Function` / `process.binding`, or loads a module by a computed name — a function that cannot open a file cannot rewrite a prompt, a ruleset or a knowledge file | anything outside this repository. **Emely's and Sofía's prompts live in GoHighLevel**; whether they change only by a person's hand is an owner process (below) |
| the governing objects (CMS and state rulesets, lifecycle lists, approved SOA text and categories, TPMO configuration, the learning lists) are frozen all the way down | that a change made by a person through the reviewed route was a good one — that is review, not this gate |
| no source file under `api/` or `src/` reassigns or mutates them | a write through a network API (a KV or CRM call that stores a prompt): the gate looks at filesystem and process capability, not at every outbound request. Today no code path fetches a prompt or a rule from a remote store, so there is nothing for such a write to feed |

**The voice agents — an owner process.** Emely and Sofía run in GoHighLevel; this
repository cannot see or gate their prompts. For §23 to hold there the owner must: keep
any GoHighLevel "learn from conversations" / auto-improve setting **off** for both agents;
change a voice prompt only through the same pipeline (candidate → review → source check →
versioned prompt → regression calls → red-team → approval), recording each step with a
name and a date; and keep the previous prompt version so a change can be undone. Nothing
in code verifies this; it is listed in §6.

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

**Web callback consent and its scope (CE-09 / CRM-15).** `api/submit-lead.js` calls
`recordWebCallbackConsent()` (`api/_lib/cy2027/callback-consent.js`, server only), which
builds a `CALLBACK_CONTACT_PERMISSION` object with `webCallbackConsent()`. The scope is
never derived from the lead: `CONTACT_CONSENT_TEXT_VERSIONS` (`consent.js`) maps each
consent-text version to the scope that wording states, and a submission earns it only
when the server's own SHA-256 of the text received equals the registered digest (the
client's `consent_receipt_hash` and version label are passed in **as received** and
compared, never trusted and never repaired). Otherwise no object exists, no
`CALLBACK_CONSENT_*` value is written, and the lead is still captured. Where the refusal
shows up — corrected after the 2026-10-04 red team, which found the earlier sentence
("a flag plus a named reason in the log and in the receipt") untrue on two paths:

| Where | New contact | Repeat on an existing contact (LEAD-02) |
|---|---|---|
| Serverless log (`[CALLBACK-CONSENT] not recorded …: <reason>`) | yes | yes |
| Note, server line: `callback_consent=NOT_RECORDED(<reason>)` | always, first value of `— TCPA Receipt —` | always, first value of `New consent receipt on this submission —` |
| `CALLBACK_CONSENT_NOT_RECORDED` in `contact.lead_quality_flags` | yes (part of the create body) | **no** — a repeat writes no field on the existing contact |

**The receipt line.** `tcpaReceiptLine()` writes it, and the handler no longer assembles
it: the server's statement (`scope=<SCOPE>` or `callback_consent=NOT_RECORDED(<reason>)`)
is the **first** value, then the server's instant and the proxy-chain address; client
claims (hash, version label, page, user agent) come after, are printed only when exactly
well-formed, and the user agent is reduced to characters that cannot spell a separator or
a key. Every text the server did not author — story, transcript, consent text as
received, intake values, the flags field, the model-written summary — goes through
`neutralizeReceiptLookalikes()`, so a note holds exactly one `— TCPA Receipt —` line and
one `scope=` / `callback_consent=` statement. The neutraliser works on character
*classes*, not lists: every Unicode dash except the ASCII hyphen, every format character
(zero-width, bidi marks, soft hyphen) as a gap — also inside the words — and the
look-alike equals signs. Its promise is exact and holds for any text: afterwards no line
starts with the server's header and neither server label occurs. It does **not** promise
that no eye is ever fooled (homoglyph letters cannot be enumerated), which is why the
server's statement is also first on its line. A consent text is labelled
`verbatim, v<version>` only when the server verified it against that registered version.

**The write stage.** The same rules are applied again where the values leave:
`buildCustomFields()` treats status, timestamp and scope as a unit. The status must be one
of `CONSENT_STATUS`; the timestamp a real UTC instant that is not in the future; the scope
one a registered wording states; all three confirmed, never inferred. `GRANTED` is never
sent without its scope and its instant, a timestamp or a scope is never sent without its
status (a lone scope would re-scope whatever grant the contact already has), and if one of
the values a unit needs has no GoHighLevel id, none of that unit is sent (the others are
reported as `withheld`). A missing scope id never holds back a revocation. `consentsToFields()` throws when a slot is handed a
consent object of another type. **Open point, decided fail-closed:** only the web wording
is registered. A callback consent carrying the voice script's scope ("regarding this
request") is refused whole at the write stage; no live endpoint writes one, and
registering a voice script version with its scope is an owner decision that must precede
one.

**Revocation.** `api/opt-out.js` calls `recordCallbackRevocation()`. Both field ids, or
nothing is written. What is written depends on what the contact reads *now* (from the
search payload, or from one `GET /contacts/{id}` when that payload carries no custom
fields and the ids are configured): already `REVOKED` → nothing, the instant of the
earlier revocation stands; any other readable state → `REVOKED` + this instant;
unreadable → `REVOKED` only. After a revocation `CALLBACK_CONSENT_AT` therefore holds the
**revocation** instant; the instant of the grant survives only in the receipt line of the
original note. The scope is never rewritten. The revocation note states what was
*applied*: which of the two fields were written, and — if the CRM did not accept the
update — that DND was **not** applied and must be set by hand.

**When the CRM refuses a write** (`crmRefusalStep()`, one policy for both handlers):
`429`/`5xx` → the same body is retried, a field is never dropped for it; `401` → no retry;
any other `4xx` with the `CALLBACK_CONSENT_*` entries attached → one retry without them.
On the lead side a create that only succeeds without them is logged and audited as
`cy2027_fields_dropped` (the lead is kept; the scope is in the note). On the opt-out side
the log says `callback_consent REVOKED NOT written` and the note says so too.

**What a maintainer has to know.**
- A workflow that filters on `CALLBACK_CONSENT_STATUS` sees only contacts **created** after
  the three ids were configured. Contacts that already existed, and every repeat
  submission, never receive the three fields (LEAD-02): their record is the note.
- A lead can show the `Consent Captured` tag and `consent_calls=true` next to
  `CALLBACK_CONSENT_NOT_RECORDED`. That is not a contradiction: the person ticked the
  consent box (the channel flags), but the server could not tie the consent to a
  registered wording, so there is no scope on record. **What an advisor should do with
  such a lead is an owner/compliance decision and is not encoded anywhere in this layer.**

Changing the wording in `src/lib/disclaimerVersion.ts` requires a new `DISCLAIMER_VERSION`
**and a new registry entry**; `scripts/consent-wording-gate.mjs` (run by
`check-cy2027-parity`) fails the build otherwise, and also fails it when a second copy of
the wording exists anywhere under `src/`, `api/` or in `index.html` (the chat component
carried six). The three fields need GoHighLevel ids (`CY2027_CRM_FIELD_IDS`, owner
action); until then the scope is held in the `— TCPA Receipt —` line of the contact note,
as its first value, `scope=<SCOPE>`.

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

### 2.1a The document language is an election (G08)

The language of a signed SOA is the language its disclosures were **read** in. It
used to come from `lead?.language || 'es'` on the client and a coalesce-to-`'es'`
on the server, so a record could not tell "chose Spanish" from "defaulted to
Spanish". It is now two fields, and only an election is signable:

| `languageSource` | Signable | Meaning |
|---|---|---|
| `BENEFICIARY_ELECTED` | yes | chosen on the bilingual election screen by the beneficiary |
| `REPRESENTATIVE_ELECTED` | yes | chosen by a representative — the record must also carry `representativeRelationship` |
| `SYSTEM_DEFAULT` | **no** | exists so the gap can be named and refused |
| `INFERRED_FROM_LEAD` | **no** | idem |

Where it is enforced — every layer, not only the constructor:

- `readLanguageElection(body)` — the only place the handler reads it; reasons
  `LANGUAGE_NOT_SUPPLIED` / `ELECTION_NOT_RECORDED` / `NOT_AN_ELECTION`. `api/sign-soa.js`
  answers `400 SOA_LANGUAGE_ELECTION_REQUIRED` with that reason and emits the audit
  action `SOA_REFUSED` (reason only — never the raw submitted strings).
- `createSoaInstance()` — `election_required`, `not_an_election`, and the attribution
  cross-check `representative_required` / `election_attribution_mismatch`: who elected
  must agree with who signed.
- `completeSoaInstance()`, `buildEvidenceRecord()`, `renderTextSnapshot()` and
  `marketingGate()` each refuse a record without an election
  (`SOA_LANGUAGE_NOT_ELECTED`), so a rehydrated or hand-built instance cannot slip
  past the constructor.
- `languageElectionLabel()` — one function for the read-back screen and the PDF; it
  throws rather than print a default.
- The form withdraws both acknowledgements and the typed signature whenever the
  language is changed: an affirmation given against one language's text is not an
  affirmation of the other's (spec §9, no prechecked boxes).

**Not done — owner decision:** the approved template keeps its title and opening
paragraph in English in both language versions (`SOA_TEXT.es.title` / `.intro`).
The election screen therefore promises only what is true (categories, statements
and signature section in the elected language). Approving a Spanish title and intro
means editing `soa-text.js` and re-pinning `APPROVED_TEXT_DIGEST`.

## 5. Evidence

`buildEvidenceRecord()` stores the **exact wording the beneficiary saw**, in their
language — not just the checkbox codes — so the record is self-explaining years later
without this repository at this version. The SHA-256 integrity hash covers the rendered
text, the selections, the identifiers and **the language election** (`languageSource`);
it deliberately excludes `context` (IP, user agent) so a proxy change can never look
like tampering with the agreement. Flipping or deleting the stored election makes
`verifyEvidence()` return `HASH_MISMATCH`.

`auditEvent()` requires actor, result, source and correlation id, and redacts
SSN/MBI/bank/card/DOB/token values from `details` before they reach a log line.

---

## 6. What is NOT done

Stated plainly rather than implied:

| Item | Status |
|---|---|
| TPMO organization/product counts | **OWNER-SUPPLIED.** `BLOCKED_COUNTS_REQUIRED`; the count-less standardized sentence renders. Never to be guessed. |
| Evidence store backend | **CONFIGURATION.** Verify with `node scripts/cy2027-verify-evidence-store.mjs` — it writes, reads back and compares bytes before you flip the precondition. The code path is complete and fails closed, but `CY2027_EVIDENCE_STORE_URL` / `_TOKEN` are unset, so `signedPdfPersisted` stays false until a real round trip is verified. |
| Carrier overlays | All `PENDING_*`. Each needs private/contract/current-year verification. |
| ZIP→county dataset | Not installed; the form asks the beneficiary instead. `parseCountyCsv()` turns a two-column `zip,county` CSV into the dataset, so installing real data is a file drop. Malformed rows are skipped, never guessed. |
| `ENROLLMENT_RECORD` retention period | Unconfirmed; that class cannot be purged at all until the owner supplies it. |
| Recording-notice all-party positions | Carried as the project's existing position of record, flagged `complianceReview: OWNER_COUNSEL`. Not re-determined by this code. |
| GoHighLevel custom fields | **OWNER ACTION.** `node scripts/cy2027-provision-crm-fields.mjs` reports what is missing; `--apply` creates them and prints the `CY2027_CRM_FIELD_IDS` map. It reuses an existing field rather than duplicating it, and never runs on its own. The §18 fields (the script counts them from `CY2027_FIELD_KEYS`; do not rely on a number written here) do not exist in the sub-account, and `api/sign-soa.js` was passing field *names* where GHL expects opaque IDs, so SOA fields never landed (CRM-27). The mapping now sends only fields with a configured ID and logs the rest on every signature. Create the fields, then set `CY2027_CRM_FIELD_IDS`. |
| Confirmation copy to the beneficiary | **BUILT, FLAG OFF.** `CY2027_SEND_BENEFICIARY_COPY` plus a configured channel plus a recorded `CALLBACK_CONTACT_PERMISSION` — all three required, none assumed. The message carries no name, ZIP, categories or appointment detail, and a marketing phrase throws. Previously: It is an outbound message, so it needs a channel, a consent check and owner authorization before it is wired. |
| Quarantine STOPPING the lead workflow | **BUILT, FLAG OFF.** `CY2027_QUARANTINE_STOP` gates it; unset in production, so behaviour is unchanged today. When on, a flagged lead still creates the contact and the note — only the automated opportunity is withheld. Previously stated as owner-gated: §13 asks that a high-risk lead halt the automated workflow before appointment confirmation. The trust engine is wired into `api/submit-lead.js` and attaches `TRUST_*` flags plus a `[SECURITY-REVIEW]` task, but it deliberately changes NO routing: that is the live lead pipeline, and altering the opportunity/dialing control flow without end-to-end exercise would risk the core business function. Wiring the stop is a follow-up to run with the owner. |
| In-person appointment gate in practice | `marketingGate()` refuses an in-person appointment without a written, non-superseded, evidenced SOA for that exact appointment. There is no booking endpoint in this repository — appointments are created by the advisor in GoHighLevel — so the process half (the advisor consulting the gate) is an owner workflow item. |
| SOA workflow enablement | `SOA_ENABLED = false` in all four mirrors. Four of seven preconditions closed; `tpmoCountsVerifiedEverywhere`, `signedPdfPersisted` and (added 2026-10-04) `rulesetPromotionAttested` remain. |
| Human promotion of the active rulesets | **OWNER ATTESTATION.** No named person is on record as having promoted `CMS_RULESET_2027` or the three state rulesets, and no source has a verification date. Carried as the SOA precondition `rulesetPromotionAttested`; see §2.2a for the exact steps. |
| CY2028 ruleset | **NOT STARTED — by design.** `CMS_RULESET_2028` is a `PENDING_REVIEW` placeholder with no rule values. `npm run preflight` counts down to 1 October 2027 and blocks inside 120 days. |
| Voice agents' learning loop (§23) | **OWNER PROCESS.** Emely's and Sofía's prompts live in GoHighLevel, outside this repository and outside its build gate. Keeping any auto-learning setting off and changing a voice prompt only through the reviewed pipeline is the owner's procedure; nothing in code verifies it. See §2.2b. |
| Candidate-learning store and review queue | **NOT BUILT.** A candidate is one `[CANDIDATE-LEARNING]` log line; there is no database of candidates and no review screen. A person collects them from the function logs. Only `api/chat.js` emits one (when the compliance filter corrects a reply); the voice agents and the forms emit none. |
| Production deploy | Not done. Requires owner GO. |

---

## 7. Verification performed

- `npm run build` — 46/46 routes prerendered; the parity guard runs inside the build.
- `tsc -b` clean; `eslint .` clean.
- `npm test` — 44/44 suites.
- `scripts/test-cy2027-2026-10-01.mjs` — covers every gate in both directions (blocks
  what it must block, still permits what must keep working). The count grows with every
  finding; run the suite for the current figure rather than trusting one written here.
- **Independent red team (2026-10-02)** — 6 attack lenses, every claimed break
  re-run from scratch by a different agent before it counted. **37 findings
  reproduced: 9 critical, 22 high, 4 medium, 2 low. All 37 are fixed and pinned
  by regression assertions.** The suite had missed every one of them because it
  only exercised the happy path. The worst were:
  - in-person detection was one exact-string compare, so `in_person`, `In Person`,
    a missing format or `HOME_VISIT` let a voice-only SOA unlock an in-person
    appointment — the §33 immediate-fail;
  - the governing ruleset was an *optional* argument, so omitting it switched off
    the plan-year, ordering and in-person rules and skipped the kill switch;
  - `CARRIER_OVERLAYS` was a public export re-exported by the barrel, so the
    whole carrier firewall was bypassable by importing the data;
  - `isAffirmative()` ignored the consent *type*, so a recording notice
    authorized an outbound call;
  - the quarantine actor check blocked four exact words, so `AI-Agent`,
    `svc_bot` and `claude` self-approved;
  - `redactForLog` skipped arrays and matched keys exactly, so `ssn_number` and
    `people[0].ssn` reached the log in clear.
- **Mutation-tested**, because a suite does not verify its own author's control:
  removing the in-person→written rule, admitting a prohibited trust signal, and marking
  one carrier overlay `VERIFIED_CURRENT` each make the suite fail. Files restored; the
  suite returns to green.
- **Second independent red team (2026-10-03), on G08 and TPY-09.** Both commits were
  broken as first written: the election was outside the evidence hash; a representative
  signing produced a self-contradicting PDF; acknowledgements arrived pre-ticked after a
  language change; the TPMO gate passed any page whose footer was correct; and eleven
  G08 mutants plus four TPY-09 mutants passed the author's assertions, which were
  source greps. Fixed as described in §2.1a and §8.1a. The rules are now functions
  tested by calling them, and a 46-mutant run (handler, model, evidence, CRM, gate,
  form) is killed 46/46.
- Prerendered HTML verified to carry the CY2027 TPMO sentence (no SHIP reference) in
  both EN and ES, with zero occurrences of the CY2026 sentence remaining in `dist/`.

---

## 8. Live production verification — 2026-10-02

Measured against `https://clearpointsenioradvisors.com`, read-only, no POST to any
production endpoint.

### 8.1 The live site serves the CY2026 TPMO disclaimer

All **46/46** routes in the live sitemap were fetched. Every one carries the
disclaimer (so it is not missing anywhere), none contains an `[X]`/`[Y]`
placeholder — and every one serves the **CY2026** variant, which still names the
State Health Insurance Program. CY2027 marketing began 2026-10-01.

| Check | Result |
|---|---|
| TPMO disclaimer present | 46/46 |
| CY2026 variant served | 46/46 (EN and ES) |
| `[X]` / `[Y]` placeholder | 0 |

The local build is correct: every prerendered HTML file carries the CY2027
sentence. The only CY2026 string left in `dist/` is the historical branch inside
the JS bundle, which must stay so a 2026-dated document can still be explained,
and which the render-time variant resolution no longer reaches.

**Cause:** the disclaimer is frozen into the prerendered HTML at build time. It
does not correct itself when the calendar rolls over — it needs a rebuild AND a
promote. That is an owner decision; whether one day of stale wording is material
is a compliance judgement for the owner or their counsel, not for this code.

### 8.1a What the gates can and cannot see

`scripts/tpmo-gate.mjs` is the one rule, used in two places:

| Where | Compares | Catches | Cannot catch |
|---|---|---|---|
| `npm run build` (`prerender-body.mjs`) | each rendered page vs. the variant in force at build time | a stale **hand-written** sentence on a page; a wrong-language disclaimer; a non-canonical disclaimer | a stale **deploy** — at build time the page and the expectation come from the same clock |
| `npm run preflight` | already-built `dist/` vs. the variant in force **now** | a build made before the cut-over | — |
| `npm run preflight -- --url <origin>` | every page in that origin's sitemap (GET only) vs. the variant in force **now** | what is actually being **served** | — |

Re-run on 2026-10-03 against production with `--url`: **still serving CY2026**
(71 problems across the sitemap). It stays that way until a fresh build is promoted.

Also found by the stricter gate and fixed: the chat assistant closed every advisor
handoff with a TPMO disclaimer written by hand, eight times, still naming the SHIP.
It now renders `tpmoDisclaimerText()`. The single-source check in
`check-cy2027-parity.mjs` used to read a fixed list of four files; it now walks all
of `src/` and `api/`.

Promote sequence: `npm run build` → `npm run preflight` → push (Preview) →
`npm run preflight -- --url <preview-url>` → `vercel promote` (owner) →
`npm run preflight -- --url https://clearpointsenioradvisors.com`.

### 8.2 The SOA gate holds in production

```
GET /api/soa-status?token=00000000-0000-0000-0000-000000000000
→ HTTP 503 {"error":"SOA_DISABLED"}
```

`/soa/:token` renders its shell with the advisor phone number and leaks no
beneficiary data. This is the direct evidence for a claim made throughout this
document: the pre-existing IDOR in `api/soa-status.js` was never reachable in
production, because `SOA_ENABLED = false` answers 503 before any of it runs.

### 8.3 Security headers (spec §30) — all present

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Content-Security-Policy` | `default-src 'self'`, `script-src 'self'` + GTM + Turnstile, `style-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(self), geolocation=(), payment=(), usb=()` |

No `unsafe-inline` and no `unsafe-eval` in any directive — §30 asks for a CSP
without unnecessary `unsafe-inline`, and the live policy already meets it.

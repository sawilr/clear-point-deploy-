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
  data-quality.js    throwaway-inbox list + inconsistency→review rule + the
                     verdict-tag refusal (clientTagRefusal, one implementation
                     for client tags and server-minted tags) (§12)             [shared]
  evidence.js        integrity hash, text snapshot, audit log            [SERVER ONLY]
  sensitivity.js     data sensitivity class + handling by class         [SERVER ONLY]
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
| Who may decide | `actors.js` `reviewerProblem` + env `CY2027_REVIEWERS` | every human-only decision (quarantine review, ruleset step, source verification, learning step) is made by a person on the owner's allow-list; with no list configured **nobody** may decide. `humanActorProblem` additionally refuses automation identities, the assistants' own names (Emely, Sofía, Clara, Zara) and common AI products, and accepts names in any alphabet |
| Lifecycle | `ruleset-lifecycle.js` `recordRulesetTransition`, `lifecycleChainProblem` | one step at a time, forward only, by an authorised reviewer, with an instant, an evidence reference and the ruleset version it promotes. The steps live ON the ruleset (`transitions`) and are re-checked every time it is judged: a `PRODUCTION_ACTIVE` ruleset that cannot show PENDING_REVIEW→VERIFIED→STAGING_TESTED→PRODUCTION_ACTIVE, in time order and not in the future, is refused (`RULESET_PROMOTION_NOT_RECORDED`) |
| Owner attestation | `promotion` on every CMS and state ruleset | for the five grandfathered rulesets only: `{ rulesetVersion, promotedBy, promotedAt, evidenceReference }`, bound to the version it names, by an authorised reviewer, not dated in the future — or `null`s, truthfully, when nobody is on record. It reports `GRANDFATHERED_OWNER_ATTESTED`, never `ATTESTED`: no earlier step exists |
| Grandfathering | `GRANDFATHERED_RULESET_VERSIONS` (closed, pinned by the suite) + identity with the registered object | the five rulesets activated before the lifecycle existed are usable but report `GRANDFATHERED_PENDING_OWNER`. A copy, or a made-up object carrying a listed version string, is not grandfathered |
| Calendar | `rulesetUseProblem` in `rulesets.js`, `evaluateStateRuleset` | a ruleset governs only inside its plan year, derived from the year itself (`effectiveTo: null` does not keep it alive): `RULESET_NOT_YET_EFFECTIVE`, `RULESET_NOT_IN_FORCE` / `RULESET_EXPIRED`, `CLOCK_UNREADABLE` — also when the year is named explicitly |
| Source review | `sourceReviews` + `sourceReviewStatus` / `sourceReviewProblem`, CMS **and** state rulesets | each required source's verification and review-by dates; `null` = not on record, reported, never invented. Locks the workflow: a passed review-by date, an unreadable record, a verification with no review-by date, by nobody / by automation / by someone not authorised, or dated in the future (`RULE_SOURCE_REVIEW_OVERDUE`); an unreadable list (`RULE_SOURCES_MISSING`). A ruleset that went through the lifecycle must also name at least one source and have every one verified (`RULE_SOURCES_MISSING`, `RULE_SOURCE_NOT_VERIFIED`). The one declared exception: for a **grandfathered** ruleset "nobody recorded a verification" is reported and does not lock |
| One judgement | `rulesetVouchProblem` (called by `marketingGate`) and `evaluateRuleset` share `rulesetUseProblem` | the gate relies only on THE registered ruleset of that year **and refuses whenever the resolver would** — same clock (`now`), same source rule. The gate also refuses an appointment outside the ruleset's plan year (`APPOINTMENT_OUTSIDE_PLAN_YEAR`) |
| Ruleset version on every SOA | `cmsRulesetVersion` on the instance, inside the integrity-hashed evidence record, on the signed PDF and text record, and as the CRM key `contact.cms_ruleset_version` | §22 "every live SOA points to the exact ruleset version": required at creation, checked against the ruleset registered for that plan year, and the gate refuses an SOA signed under another version (`SOA_RULESET_VERSION_MISMATCH`). The CRM field is reported **unmapped** until the owner creates it |
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
attests. To attest: (1) name the reviewers in the `CY2027_REVIEWERS` environment variable
(comma-separated; until it is set every human-only decision is refused); (2) review the
five sources in `CMS_RULESET_2027.sourceReviews` and the recording-consent position each
state ruleset names, and fill in `verifiedOn` / `verifiedBy` / `reviewBy` (all three — a
verification with no review-by date is not accepted); (3) fill in the `promotion` record
`{ rulesetVersion, promotedBy, promotedAt, evidenceReference }` in `rulesets.js` and
`state-rules.js`; (4) flip the precondition. Note that a `reviewBy` date that passes
locks the SOA/marketing workflow until the source is reviewed again — that is the §22
kill condition working, not a fault.

**Preparing CY2028** (Phase 12): fill the placeholder's rule values from the CY2028 final
rule, record each lifecycle step with `recordRulesetTransition` and append the records to
the ruleset's `transitions`, verify its sources, add the CY2028 TPMO variant if the
standardized sentence changes, and add the 2028 state rulesets. `rolloverStatus()` reports
the next ruleset as ready only if the resolver would hand it out at the instant its year
opens. Until then the workflow fails closed on 1 October 2027 by design.

**Open points that are the owner's to decide** (the code is fail-closed on each):
after 1 October an appointment about the CURRENT year's plans (a special enrollment
period) is refused by the gate, because the model is "one plan year in force by the
calendar" — whether such appointments need their own path is a compliance reading;
the reviewer list is server-side only, so a state ruleset that went through the lifecycle
(none exists today) would be refused in the browser until that list is made available to
the client build.

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
| `summary`, `agentPhrase` | what the assistant did — for a candidate a PERSON enters by hand. Refused — not cleaned — if the text is not plain (invisible or look-alike characters), or if the scrubbers and the net find an identifier, a date in any order, a year, three or more digits in a row, an age, an address, clinical / benefit / financial detail, a third-person pronoun, or the common ways a person is named or introduces themselves |
| `occurrences`, `createdAt` | a count, a UTC instant |
| `candidateId` | **not an input.** A digest of the fields above, recomputed every time the record is judged: nobody chooses it, a supplied one is refused, and a record edited afterwards no longer matches its id |

An **automated** surface has no text field at all: it names a code from the closed table
`AUTOMATED_OBSERVATIONS` (one entry today) plus the language, through
`observationLogLine()`.

The limits are stated rather than hidden: no pattern recognises a bare personal name, a
medication no list knows, or a number spelled out in words — which is why the automated
path carries no text, and why the first human stage must reject a candidate that quotes
or describes a caller.

**The pipeline.** `CANDIDATE → HUMAN_COMPLIANCE_REVIEW → SOURCE_VERIFICATION →
VERSIONED_CHANGE → REGRESSION_TESTS → RED_TEAM → APPROVAL → DEPLOYMENT`, the spec's order.
`advanceCandidate()` moves ONE stage and throws unless an authorised reviewer decided it
(`reviewerProblem()` in `actors.js` — the same check as quarantine review and ruleset
promotion), with a real UTC instant no earlier than the previous step and a short,
scrubbed reference to what was reviewed. `rejectCandidate()` is terminal, is held to the
same rules, and takes its reason from a closed list of codes (`LEARNING_REJECTION_REASONS`).
Every function that uses a record first takes ONE plain copy of its own data properties
(`plain-record.js`) and judges, prints or advances only that copy — a getter, an inherited
field, or a step with a key left out is not a record. It re-checks the whole record — its fields, its closed list
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
built by `observationLogLine({ observation: 'FILTER_CORRECTED_REPLY', language })` from the fixed table entry. The line carries no caller
text, no model text, no rule tag (those quote the reply) and no address; the language is
the one the correction was made in (`en`/`es`), never the string the browser sent. It
changes no reply and no routing, nothing reads it back, and a refused observation produces
no line and no exception. No other surface emits a candidate today.

**The build gate** `scripts/check-no-self-modification.mjs` (in `npm run build`; its rules
live in `scripts/no-self-modification-lib.mjs`; both are shipped to the Vercel build by
their `.vercelignore` exceptions). It PARSES every file (TypeScript's parser) instead of
matching text, so a comment, a string or a prompt's prose is never mistaken for code and
code is never hidden by a comment; the command file has no condition, so running it always
runs the gate:

| It proves, on every build | It cannot prove |
|---|---|
| every file under `api/` (any code extension; a file that is not code is itself a failure) loads only string-literal modules from an **allow-list** — its own files under `api/`, `node:crypto`, `openai`, `pdfkit` — and never names `eval`, `Function`, `require`, `createRequire`, `getBuiltinModule`, `constructor`, the process internals, `globalThis`, or `process` other than as `process.env`, nor calls a member chosen at runtime — a function that cannot open a file cannot rewrite a prompt, a ruleset or a knowledge file | anything outside this repository. **Emely's and Sofía's prompts live in GoHighLevel**; whether they change only by a person's hand is an owner process (below). Nor the inside of an allow-listed package, nor a value carried through arbitrary data flow to a computed key and called through an alias |
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

### 2.3a Channel, letter and call verification (SPEC-12, 2026-10-04)

Spec §12 asks for a one-time code to the phone/email supplied, `CONTACT_CHANNEL_VERIFIED`
kept apart from `IDENTITY_VERIFIED`, a verification call only on a contact basis and never
for marketing, a neutral letter only to a previously verified address on file, and a
re-open when the person calls back through the official number; §30 asks that the OTP
endpoint be protected against brute force and SMS bombing. Before this change
`secure-link.js` listed `'OTP'` as a factor kind and locked a link after repeated failures,
but nothing issued a code — `api/soa-token.js` minted every link with `PHONE_LAST4` — and
no letter or call rule existed.

**The code — `api/_lib/cy2027/otp.js` (server only), wired into `secure-link.js`.**

- `issueOtp()`: six CSPRNG digits; the link record keeps a per-code 128-bit salt and an
  HMAC-SHA256 of the code, never the code (the `otp` block has a fixed key set, so the code
  has nowhere to live). A code lives ten minutes; a re-issue replaces the previous one. The
  issue is counted as a send on the link. `issueLink()` refuses a caller-supplied value for
  the `'OTP'` kind: nothing a caller sends may become the code.
- `verifySecondFactor()` (one verifier for every kind) delegates the `'OTP'` kind to
  `verifyOtp()`: constant-time compare, `OTP_EXPIRED` / `OTP_ALREADY_USED` /
  `OTP_NOT_ISSUED` / `OTP_MISMATCH` by name, single use. The attempt counter and the lockout
  (`MAX_FACTOR_ATTEMPTS = 5`, `REPEATED_FAILED_OTP` → human review) stay on the link, so a
  resend never resets a brute-force count. A received code stamps `channelVerification:
  VERIFIED` and, explicitly, `identityVerification: NOT_VERIFIED`; a last-4 or ZIP match
  stamps neither. `verificationClaim()` is the vocabulary a handler may use —
  `CONTACT_CHANNEL_VERIFIED`, `LINK_FACTOR_MATCHED`, `NONE` — and has no identity value.
  The status endpoint's audit actor now follows it (`beneficiary:channel-verified` only for
  a code; `beneficiary:factor-matched` for a last-4), and the response carries
  `verification`. `api/sign-soa.js` still labels every signature `beneficiary:channel-verified`
  (pinned by the main suite; not changed here).
- **The SMS-bombing control** (`reserveOtpSend()`): a 60-second floor between sends on a
  link, at most 3 sends per link and 5 per DESTINATION per sliding hour — the destination
  cap is keyed by `sha256(channel:destination)` across links (`otp-dest:…`), so minting many
  links for one phone does not become many messages. **Red team (2026-10-04):** the first
  shape read the send logs, decided and wrote them back (`getRecord → otpSendPlan →
  setRecord`), and eight parallel resends at one link all passed — eight codes went out,
  the stored counts said two. Every bound is now an atomic claim in the store (`SET … NX`
  with a TTL through `soa-store.claimRecord`): one floor key per link alive 60 s, three slot
  keys per link and five per destination alive one hour each (a slot is held for the whole
  window, so the window slides). The claims are taken BEFORE a code exists; a claim a later
  bound refuses is released, so a refused request leaves no count behind; a store that
  cannot say whether it claimed is a refusal (`OTP_STORE_UNAVAILABLE`, answered 503). The
  suite fires the burst (8 resends on one link → 1 delivered; 8 issues for one phone → 5)
  against the real memory store. `OTP_POLICY` is frozen and registered with the
  no-self-modification gate.
- **The destination** is the phone or email on the lead record the server wrote at issue,
  reached through the opaque reference inside the link (`otpDestination(leadRecord, channel)`
  takes nothing else). `api/soa-status.js` accepts `POST { token, resendCode: true }` on the
  same endpoint (same origin check, rate limit, no-store, body cap, `SOA_ENABLED` gate); a
  `to`, `phone` or `email` in that body is never read. A locked link gets no code. The code
  and the destination reach no response and no log line (`OTP_ISSUED` carries the channel
  and the send count; `OTP_SEND_REFUSED` the cap that refused).
- **Delivery is gated exactly like the confirmation copy** (`mayDeliverOtp()`):
  `CY2027_SEND_OTP` on, a configured https channel (`CY2027_OTP_SMS_URL` / `_TOKEN`,
  `CY2027_OTP_EMAIL_URL` / `_TOKEN`) and a recorded `CALLBACK_CONTACT_PERMISSION` — all
  three, none inferred (§6: a request to sign is not permission to message). When the gate
  refuses, `otpFactorForIssue()` keeps today's factor and the issuer audits why
  (`factorReason`). **Nothing is sent today**, for two independent reasons: the flag and
  channel are unset, and `api/soa-token.js` holds no server-side consent record for the
  person — the request body is a client claim and is never read for one, so its basis is
  `null` and the gate answers `NO_CONTACT_PERMISSION` even with the flag on. **Red team
  (2026-10-04):** that basis was a literal `null`, so no suite could execute the issuer's
  code branch and eight mutants of it survived (one read a consent off the body). The
  issuer now takes the lookup as an in-process dependency (`handler(req, res, deps)` with
  `deps.otpConsentBasis`; Vercel passes none, so production is unchanged), the suite drives
  the branch with a lookup that answers a recorded permission, and the bodies it sends are
  Proxies that record every key the handlers read — a consent offered under any name is
  never read. Making the code reachable means wiring the CRM's callback-consent state
  (`callbackConsentStateOf`) into that dependency, and using the same lookup on the resend
  path: today the link carries a snapshot of the basis the issuer verified
  (`otp.consentBasis`), which cannot see a revocation recorded after issue. Both are listed
  in §6.
- The page (`src/pages/SignSOA.tsx`) asks for a six-digit code on an `'OTP'` link, says
  which kind of channel it went to (never the number or address), tells a stale code apart
  from a wrong one, and can request a new one; the server bounds that.

**The letter, the call and the callback — `api/_lib/cy2027/out-of-band-verification.js`
(server only: `node:crypto` for the letter's text digest; otherwise imports only from the
layer). Pure decisions; nothing mails, dials or stores a case.**

- `mayIssueVerificationLetter()` releases a rendered letter for a STAFF mailing only when:
  the decider passes the layer's reviewer rule (`reviewerProblem`: a person, on the owner's
  `CY2027_REVIEWERS` list — refused for everybody until the list exists); the wording is
  approved (`letterApprovalProblem`: a named person, a real past day, and an approval
  recorded FOR THIS TEXT — `approval.textDigest` must equal `letterTextDigest()` of the
  version and both languages, so an edited text is unapproved text; **red team
  2026-10-04:** the function used to take a caller-supplied `template`, so a spread copy
  with a forged approval released the shipped wording — it now releases the governing
  `VERIFICATION_LETTER` and nothing a caller hands it); the client is an
  existing known client on file before the suspicious request; the address is `ON_FILE`,
  verified strictly BEFORE the request arrived, and explicitly `suppliedByRequest: false`
  (an unknown provenance is a refusal, not a pass; an address the request brought is
  refused by name); the case reference is an opaque token; and the rendered text passes
  `letterContentProblem()` — the layer's one marketing rule (`assertNotMarketing`) plus a
  refusal of any plan, plan-type (Medigap, supplement, HMO/PPO/PDP/MAPD, formulary,
  giveback), carrier, benefit, price (a currency amount, or one spelled out), coverage or
  enrollment word in either language, and a requirement that the published number be in
  the text (**red team 2026-10-04:** the currency pattern sat inside the word-boundary
  group and "$5 a month" passed; it now stands outside it and the suite names each case).
- `VERIFICATION_LETTER` (EN/ES) says a request was received and not acted on, gives the
  case reference and `1-855-720-8555`, and says what will never be asked for; it names no
  person, address, request detail, plan, carrier, benefit or price. It ships
  `PENDING_OWNER_APPROVAL` with nobody and no date recorded, and the decision function
  refuses to release it until `approval` is edited to `APPROVED` by a named person on a
  past day — a reviewed change to the frozen, gate-registered object, never a runtime write.
- `mayPlaceVerificationCall()`: purpose must be `SECURITY_REQUEST_VERIFICATION` (an
  allow-list of one value — a marketing purpose is refused by name); the caller must be a
  human (`callerMode: 'HUMAN'` and the one human-actor rule — an automated or AI caller is
  refused); the number dialled must be THE number on the request; and the contact basis is
  decided by `consent.mayPlaceOutbound()` for a human caller WITH THE PURPOSE PASSED
  THROUGH (unknown or set do-not-contact refused; a missing, revoked or wrong-typed
  consent refused; a consent whose stated scope is not the verification purpose refused
  `PURPOSE_OUTSIDE_CONSENT_SCOPE`, CT-07). **Red team 2026-10-04:** the purpose was
  recorded on the decision and checked against nothing, so the production web consent
  (scope `DISCUSS_MEDICARE_PLAN_OPTIONS`) authorised a security call. It no longer does:
  the basis must be a `CALLBACK_CONTACT_PERMISSION` scoped `SECURITY_REQUEST_VERIFICATION`
  (a permission captured for that call), or the owner must declare by name, in a reviewed
  change, that another scope covers it (§6). The decision records the purpose, the basis
  and `planMarketing: false`.
- `reopenCaseOnCallback()`: only an INBOUND call whose dialled number is the official one,
  taken by a person, re-opens a `QUARANTINED`, `HUMAN_REVIEW` or `CLOSED_UNVERIFIED` case.
  The re-opened case records when, who, how and the previous status, changes NO
  verification field and NO trust state (a call received proves neither channel nor
  identity), and names the next gate (`VERIFY_CONTEXT_THEN_HUMAN_CONFIRMATION`). There is
  no case store in this repository: the rule is the definition staff tooling must call.

Evidence: `scripts/test-cy2027-verifyflow-2026-10-04.mjs` — every rule called with every
refusal; the two handlers driven in process against the memory store and a provider double
(nothing leaves the machine): the issuer keeping today's factor with the reason audited, the
code path, the resend with a request body carrying another number (the code went to the
phone on file), the floor, the per-link cap, the per-destination cap across links, the
locked link, the basis-less link (counted, not delivered), the provider failure, and the
endpoint's own guards; only what must be absent from the source is scanned, anchored.

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

### 2.6 Data sensitivity class (CRM-25)

§18 names the field `DATA_SENSITIVITY_CLASS` and defines no values. The three below are
an implementation decision (`api/_lib/cy2027/sensitivity.js`), pending owner/counsel
confirmation of the names. It answers *how a record is handled*; `RETENTION_CLASS`
answers *how long it is kept*. They are separate fields with separate vocabularies, and
`buildCustomFields()` refuses a retention label — or any value not of the SYSTEM's own
making — in the sensitivity field.

| Class | Assigned to | Enrichment vendor | Values in logs |
|---|---|---|---|
| `CONTACT_PII` | a web/chat lead where the free-text scrubbers removed nothing | only after minimization | never |
| `RESTRICTED_TOPIC_FLAGGED` | a lead where a §14/§15 topic was found in free text (and redacted) or in the topic field, or an identifier (SSN, MBI, card…) was removed from any field | only after minimization | never |
| `COMPLIANCE_EVIDENCE` | a signed SOA; a consent revocation | never | never |

"After minimization" means the four controls already in the lead path: PHI scrub,
prohibited-signal redaction, identity scrub, coarse metadata (ZIP3, age band).
`api/submit-lead.js` asks `enrichmentExposure()` before the vendor call; an unknown
class, or one the table withholds, skips the call and the lead is still filed. Every path
that stores a record (new lead, signed SOA, revocation) writes the class to the contact
note, and to the CRM field once its GoHighLevel id is mapped (on the lead create it rides
the same one-time retry-without-owner-fields as the other CY2027 entries; on a revocation
it is a separate best-effort request after the suppression, so a field id can never cost
one). On a repeat submission that matches an existing contact nothing is classified,
because nothing of the sender's is stored there. The structured Medicaid / Extra Help
answer (audit DM-04; see §6) is deliberately **not** an input to the class: it has its own
`SELF_REPORTED` storage, leaves no residue in free text, and §15 is pinned as a byte-level
equality between a lead that answered and one that did not. The log column is a
declaration pinned by the test suite, not a runtime filter.

**Red team 2026-10-04 (CRM-25), corrected.** The class was blind to the `interest_type`
door: a direct POST with `chemo for my cancer and Part D` there was filed verbatim under
`NO_RESTRICTED_SIGNAL`, and an SSN the PHI scrub removed from `interest_type` or
`best_time_to_contact` never raised `IDENTIFIER_REDACTED` (both measured). Now every
free-text door feeds the classifier, including the PHI categories of the two short fields.
The topic field itself is told apart by an **allow-list** (`api/_lib/cy2027/interest-labels.js`,
75 labels, pinned by the suite against the four client modules they come from): a value that
is one of the site's own labels is stored as it always was — the owner decision below is
left where it is — while anything else is free text and gets exactly what the call-time text
gets (PHI scrub, DM-09 redaction, no `Interest-` tag minted from a value that had something
removed). The redactor's verdict reaches the class and the review flags in both cases, so a
record whose topic names a program or a condition is `RESTRICTED_TOPIC_FLAGGED` whoever chose
the words. Also from that red team: with the class id mapped, a repeat submission paid a second
create before the duplicate was recognised — `crmRefusalStep()` now reads the CRM's own
duplicate-contact wording on a 400 and the dedupe branch judges the first answer; the
note-line neutraliser also marks a sender's `— Record class —` header and reads each line a
third time with Cyrillic/Greek/Armenian look-alike letters folded to Latin (the full Unicode
confusables table is not covered — the block's position and the CRM field remain the control).

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

**State lists and evidence sources (SPEC-31 / SPEC-35, 2026-10-04).** The per-carrier
`states` lists were written by an earlier engineer; spec §17/§37 states a state for exactly
two carriers (Clover Health: NJ; ConnectiCare: CT). Each row now carries `statesStatus` —
`STATED_BY_SPEC` for those two, `UNVERIFIED` for the other eight (an engineer's working
assumption, part of the pending verification, never presented as a fact; `VERIFIED` exists
for a named person to set after verifying a current-year market list) — and
`evidenceSourceUrl`, the public source spec §36 gives for the carrier (six carriers; `null`
for UnitedHealthcare, Fidelis, HealthSpring/HCSC and Anthem/Empire, for which the spec
gives none). The gate is one pure function, `overlayGateDecision(row)`, that
`canDiscussCarrier()` calls: a pending status is refused with the status as the reason,
and a verified status over an unverified state list is refused by name
(`STATES_UNVERIFIED`), so verifying a contract never unlocks a state nobody verified.
The rows and their state lists are frozen all the way down (observed through the guarded
accessor by `scripts/test-cy2027-qa-matrix-2026-10-04.mjs`); `OVERLAY_STATUS` and
`STATES_STATUS` are registered governing objects; the registry itself stays
module-private. `overlayInventory()` now reports carrier, plan year, states, state-list
status, status and evidence source — the §35 "Carrier Overlay Registry with evidence
source, plan year and status".

---

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
| Knowledge base approval | **OWNER-SUPPLIED.** The body every assistant answers from (`api/_lib/medicare-knowledge.js`) is release `CP-UMKE-CY2026-v1.0`, pinned by digest (the build fails if the text changes without a new release) and stamped on every `[AI-AUDIT]` line (`kb_version`, `kb_digest`, `kb_status`). `approvedBy`/`approvedOn` are null (`APPROVAL_NOT_RECORDED`) and it is tagged plan year 2026 because it was last changed on 2026-09-13; nobody has recorded a CY2027 review. Never to be filled from a commit date. When the owner records them, `approvedBy` must name a person — judged by the layer's one human-actor rule (`humanActorProblem()`: an automation, an AI product, one of the agency's own assistants, or a string with hidden characters fails the build) — and `approvedOn` must be a real calendar day, already past, no earlier than `issuedOn`; the ledger itself must stay chronological and version-increasing. Unlike the rows above, this does not close a gate: the body is live. |
| Evidence store backend | **CONFIGURATION.** Verify with `node scripts/cy2027-verify-evidence-store.mjs` — it writes, reads back and compares bytes before you flip the precondition. The code path is complete and fails closed, but `CY2027_EVIDENCE_STORE_URL` / `_TOKEN` are unset, so `signedPdfPersisted` stays false until a real round trip is verified. |
| Carrier overlays | All `PENDING_*`. Each needs private/contract/current-year verification. The state lists of eight carriers are `UNVERIFIED` (an earlier engineer's assumption; only Clover Health NJ and ConnectiCare CT are stated by the spec) and are part of that verification; a verified status over an unverified list is refused `STATES_UNVERIFIED`. The inventory carries the spec §36 source URL per carrier, `null` for the four the spec gives none for (§4). |
| ZIP→county dataset | Not installed; the form asks the beneficiary instead. `parseCountyCsv()` turns a two-column `zip,county` CSV into the dataset, so installing real data is a file drop. Malformed rows are skipped, never guessed. |
| `ENROLLMENT_RECORD` retention period | Unconfirmed; that class cannot be purged at all until the owner supplies it. |
| Recording-notice all-party positions | Carried as the project's existing position of record, flagged `complianceReview: OWNER_COUNSEL`. Not re-determined by this code. |
| GoHighLevel custom fields | **OWNER ACTION.** `node scripts/cy2027-provision-crm-fields.mjs` reports what is missing; `--apply` creates them and prints the `CY2027_CRM_FIELD_IDS` map. It reuses an existing field rather than duplicating it, and never runs on its own. The §18 fields (the script counts them from `CY2027_FIELD_KEYS`; do not rely on a number written here) do not exist in the sub-account, and `api/sign-soa.js` was passing field *names* where GHL expects opaque IDs, so SOA fields never landed (CRM-27). The mapping now sends only fields with a configured ID and logs the rest on every signature. Create the fields, then set `CY2027_CRM_FIELD_IDS`. |
| Confirmation copy to the beneficiary | **BUILT, FLAG OFF.** `CY2027_SEND_BENEFICIARY_COPY` plus a configured channel plus a recorded `CALLBACK_CONTACT_PERMISSION` — all three required, none assumed. The message carries no name, ZIP, categories or appointment detail, and a marketing phrase throws. Previously: It is an outbound message, so it needs a channel, a consent check and owner authorization before it is wired. |
| Quarantine STOPPING the lead workflow | **BUILT, FLAG OFF.** `CY2027_QUARANTINE_STOP` gates it; unset in production, so behaviour is unchanged today. When on, a flagged lead still creates the contact and the note — only the automated opportunity is withheld. Previously stated as owner-gated: §13 asks that a high-risk lead halt the automated workflow before appointment confirmation. The trust engine is wired into `api/submit-lead.js` and attaches `TRUST_*` flags plus a `[SECURITY-REVIEW]` task, but it deliberately changes NO routing: that is the live lead pipeline, and altering the opportunity/dialing control flow without end-to-end exercise would risk the core business function. Wiring the stop is a follow-up to run with the owner. |
| In-person appointment gate in practice | `marketingGate()` refuses an in-person appointment without a written, non-superseded, evidenced SOA for that exact appointment. There is no booking endpoint in this repository — appointments are created by the advisor in GoHighLevel — so the process half (the advisor consulting the gate) is an owner workflow item. |
| SOA workflow enablement | `SOA_ENABLED = false` in all four mirrors. Four of seven preconditions closed; `tpmoCountsVerifiedEverywhere`, `signedPdfPersisted` and (added 2026-10-04) `rulesetPromotionAttested` remain. |
| Human promotion of the active rulesets | **OWNER ATTESTATION.** No named person is on record as having promoted `CMS_RULESET_2027` or the three state rulesets, and no source has a verification date. Carried as the SOA precondition `rulesetPromotionAttested`; see §2.2a for the exact steps. |
| Reviewer allow-list | **OWNER CONFIGURATION.** `CY2027_REVIEWERS` is not set. Until the owner names who may decide, every human-only decision (quarantine review, ruleset step, source verification, learning step) is refused — by design. |
| `contact.cms_ruleset_version` | **OWNER ACTION.** New CY2027 CRM key for the CMS ruleset version of an SOA (§22). Reported as unmapped until the field is created in GoHighLevel and its id added to `CY2027_CRM_FIELD_IDS`. The version is already in the instance, the hashed evidence record, the PDF and the text record. |
| `contact.self_reported_medicaid_status`, `contact.self_reported_lis_status` | **OWNER ACTION (DM-04, 2026-10-04).** Spec §14: a Medicaid / Extra Help answer is stored as `SELF_REPORTED_YES` / `_NO` / `_UNSURE` with provenance `SELF_REPORTED`, never as an eligibility determination (`api/_lib/cy2027/benefit-self-report.js`; the write guard is in `buildCustomFields()`). Both keys are reported as unmapped until the fields exist in GoHighLevel and their ids are in `CY2027_CRM_FIELD_IDS` — give each its OWN new field, never the id of an existing one; meanwhile the answer is in one server-authored block of the contact note (after the model's summary, before any transcript), and a refused create is retried once without these entries so a mistyped id cannot lose the lead. **Enforced since the 2026-10-04 red team, for every CY2027 key:** an id that is one of the twelve ids the code already writes (`PRODUCTION_FIELD_IDS` in `crm-fields.js`), or that is given to more than one name, is REFUSED — nothing is written to it, the lead is kept, and `npm run preflight` blocks naming the key and the reason. The code cannot know a field that exists only in the GoHighLevel sub-account, so "its own new field" is still the owner's check. The log lines about these two fields (the gap, a refused id, a dropped entry) are the same whatever was answered: they name both keys or neither, never the one that carried a YES. **Behaviour change to check in GoHighLevel before deploying:** the lead form's `dual` option is no longer written to `contact.medicare_status` (it is a Medicaid statement, not Medicare coverage) and no longer reaches the lead scorer, so any workflow, smart list or report that filters on `medicare_status = dual` stops matching new leads — and §15 forbids routing or scoring on it anyway. Contacts already stored with `medicare_status = dual` are not changed by code. The wording of the note block needs compliance sign-off. Not covered: a benefit mentioned in conversation with Clara or Zara still arrives only as prose, which the DM-09 filter masks (flag raised, value not stored); free text sent in the coverage field is recognised as a benefit statement by the program's NAME (Medicaid, Extra Help / Ayuda Adicional / Ayuda Extra / Beneficio Adicional, LIS, QMB / SLMB / QI-1 / MSP, dual / D-SNP) whatever separates or decorates its letters — case, accents, invisible characters, `_` `-` `.`, an acronym written letter by letter — plus the one misspelling `medicade`; any other misspelling and a state's brand name for Medicaid are not classified and stay a line the sender wrote; a Medicaid YES is read from the coverage field only when the value as received is the form's own option `dual` (any letter case, white space around it) — anything else that merely resembles it (`¿dual?`, `не dual`) is withheld and flagged, never a value; coverage text that names a program beside a structured answer stores NO value for either program (the two cannot be shown to agree) and names why; and sender text that imitates the block's `Benefit status:` label is neutralised by character class and through Unicode compatibility folding (ligatures, full-width and accented letters), which cannot catch letters of another script that only look like Latin ones, a different word (`Benefits status:`) or the two words on two lines — and which rewrites a sender's own `benefit-status/…` path or `benefit_status=…`, though never the server's `BENEFIT_STATUS_SELF_REPORTED` token. **Sibling fields (red team 2026-10-04):** `lead_quality_flags` and `best_time_to_contact` now pass the same DM-09 filter as the notes (a value that had something removed mints no `CallTime-` tag). **`interest_type` (CRM-25 red team, 2026-10-04):** free text in the field now passes the same filter — a status sentence or clinical detail typed by a direct POST is masked, mints no `Interest-` tag, and raises the record's class; the site's own labels are recognised by an allow-list (`api/_lib/cy2027/interest-labels.js`) and are NOT filtered. **OPEN — OWNER DECISION:** those labels and the client-sent `tags`. The site's own topic labels name these programs (`Extra Help / LIS question`, `Dual Medicare + Medicaid question`, `Medicaid, MSP, Extra Help, or LIS`, Smart Review's `medicaid_msp_extra_help_lis` tag) and become `contact.medicare_interest`, an `Interest-…` tag and contact tags; measured over the 75 labels, 9 raise a DM-09 flag and 3 of them read as a medical topic (`Denied surgery / appeal`, `My prescription / drug costs are too high`, `SSI, SSDI, or disability`), so filtering the field for everyone would rewrite live Smart Review options. A direct POST can still mint a tag such as `Medicaid-Eligible` (measured; the lead scorer never sees the topic unmasked). Whether a topic that names a benefit program may remain a CRM field and a tag — a tag is a routing key (§15) — needs a compliance decision before code changes a live tag family; the record's class already says the topic is there. |
| CY2028 ruleset | **NOT STARTED — by design.** `CMS_RULESET_2028` is a `PENDING_REVIEW` placeholder with no rule values. `npm run preflight` counts down to 1 October 2027 and blocks inside 120 days. |
| Voice agents' learning loop (§23) | **OWNER PROCESS.** Emely's and Sofía's prompts live in GoHighLevel, outside this repository and outside its build gate. Keeping any auto-learning setting off and changing a voice prompt only through the reviewed pipeline is the owner's procedure; nothing in code verifies it. See §2.2b. |
| Candidate-learning store and review queue | **NOT BUILT.** A candidate is one `[CANDIDATE-LEARNING]` log line; there is no database of candidates and no review screen. A person collects them from the function logs. Only `api/chat.js` emits one (when the compliance filter corrects a reply); the voice agents and the forms emit none. |
| Sensitivity class names (`contact.data_sensitivity_class`) | **OWNER/COUNSEL CONFIRMATION (CRM-25, 2026-10-04).** §18 names the field, not its values; `CONTACT_PII` / `RESTRICTED_TOPIC_FLAGGED` / `COMPLIANCE_EVIDENCE` are this implementation's (§2.6). Whether flagged leads should be withheld from the enrichment vendor altogether is an owner decision (one row in `SENSITIVITY_HANDLING`; today both lead classes get the same service path, §15). The field must exist in GoHighLevel and be mapped in `CY2027_CRM_FIELD_IDS` before it is queryable — its own new field, never an existing id; until then every new lead and every matched opt-out logs the gap, and the class lives in the contact note. No contact already in the CRM is back-filled. How GoHighLevel answers a stale id on the live create could not be verified here: submit one test lead on a preview deployment after mapping the id. |
| One-time code to the beneficiary (SPEC-12) | **BUILT, FLAG OFF, AND NOT YET REACHABLE.** `CY2027_SEND_OTP` plus a configured https channel (`CY2027_OTP_SMS_URL`/`_TOKEN`, `CY2027_OTP_EMAIL_URL`/`_TOKEN`) plus a recorded `CALLBACK_CONTACT_PERMISSION` — all three, none assumed. Even with the first two set, `api/soa-token.js` has no server-side consent record to consult (the body is a client claim and is never read for one), so the gate answers `NO_CONTACT_PERMISSION` and the link keeps `PHONE_LAST4`, with the reason audited. The issuer takes that lookup as an in-process dependency (`deps.otpConsentBasis`, red team 2026-10-04) so the code branch is exercised by the suite; nothing in production supplies it yet. **OWNER / FOLLOW-UP:** wire the CRM's callback-consent state into that dependency and into the resend path (today a resend re-checks a snapshot of the basis verified at issue, which cannot see a later revocation inside the link's 24 hours), choose SMS or email, configure the provider, then flip the flag. The SMS-bombing caps are atomic claims in the store (`OTP_STORE_UNAVAILABLE` → 503 when it cannot claim), so they hold only where the store is shared: production has no KV configured (`api/_lib/rate-limit.js`, verified 2026-08-13), which is also an owner action before the flag is flipped. See §2.3a. |
| Verification letter wording (SPEC-12) | **PENDING OWNER APPROVAL.** `VERIFICATION_LETTER` in `api/_lib/cy2027/out-of-band-verification.js` ships with `approval.status = PENDING_OWNER_APPROVAL`; `mayIssueVerificationLetter()` refuses to release it until `approval` records a named person (judged by `humanActorProblem()`), a real past day and `textDigest` = `letterTextDigest(VERIFICATION_LETTER)` (red team 2026-10-04: the approval is bound to the text, and the function no longer takes a template). Approving is an edit to that frozen object in a reviewed change — the suite's loader hook shows what that commit looks like and that the release path then works. Deciding a letter also needs `CY2027_REVIEWERS` (above). Mailing is a staff action: nothing in code prints or posts a letter. |
| Verification call and callback case tooling (SPEC-12) | **DEFINITION ONLY.** `mayPlaceVerificationCall()` and `reopenCaseOnCallback()` are the rules; there is no case store, no dialler integration and no screen that calls them. Staff tooling that places a verification call or re-opens a case must call them and record the decision object. The do-not-contact answer must come from the suppression list (an absent answer is a refusal). **OWNER DECISION (red team 2026-10-04):** the production web consent is scoped `DISCUSS_MEDICARE_PLAN_OPTIONS` and under CT-07 does not authorise a `SECURITY_REQUEST_VERIFICATION` call; today `mayPlaceVerificationCall()` allows a call only on a `CALLBACK_CONTACT_PERMISSION` scoped to that purpose (a permission captured for the verification call). If the owner's legal reading is that the plan-discussion scope covers a security verification call, that must be written into the rule by name in a reviewed change; until then the answer is no. |
| Signature audit actor (`api/sign-soa.js`) | **NOT CHANGED.** Every signature is still audited as `beneficiary:channel-verified`, including one reached through a last-4 factor; the status endpoint now distinguishes the two (`verificationClaim()`), the signer does not. The label is pinned by the main suite; changing it is its own reviewed change. |
| Production deploy | Not done. Requires owner GO. |

---

## 7. Verification performed

- `npm run build` — 46/46 routes prerendered; the parity guard runs inside the build.
- `tsc -b` clean; `eslint .` clean.
- `npm test` — 54/54 suites (run 2026-10-27; the figure was 44/44 when first written —
  run the battery for the current one).
- `scripts/test-cy2027-2026-10-01.mjs` — covers every gate in both directions (blocks
  what it must block, still permits what must keep working). The count grows with every
  finding; run the suite for the current figure rather than trusting one written here.
- **QA matrix and website gates (SPEC-27 / SPEC-31, 2026-10-04)** —
  `docs/compliance/CY2027-QA-MATRIX.md` maps each of the 25 spec §31 cases and the 12
  website gates W0–W11 to executed assertions (suite file and label), with the status
  exactly PASS / FAIL / NOT TESTABLE HERE and the voice-agent and GoHighLevel halves
  never marked PASS. `scripts/test-cy2027-qa-matrix-2026-10-04.mjs` keeps it honest
  mechanically (every cited suite must be one `npm test` runs and every cited label
  must be the label of an assertion in it — a fixture or a payload is not evidence; the
  checker is observed failing on defective matrices first) and adds the behavioural
  tests the cases lacked. It found and fixed one contained defect: the form kept the
  acknowledgements and the typed signature across a change of residence state
  (`affirmationsAfterContextChange()`, one rule). After an independent red team showed
  the form's three-write application could be neutered or undone unseen by the scan,
  the form holds the residence state and the three affirmations as one value and applies
  `jurisdictionAfterStateChange()` / `jurisdictionAfterLanguageChange()` with a single
  write each; both transitions are tested by calling them. The same round replaced the
  QA-12 configuration scan with the three SOA handlers driven in process (the request
  past each cap answers 429). Gates W6 (channel choice) and W11 (licensed workspace) do not exist and W9
  (copy, filed PDF) is unmet in production configuration — recorded as FAIL with the
  options, not redesigned.
- **Security operations (SPEC-30, 2026-10-04)** —
  `docs/compliance/CY2027-SECURITY-OPERATIONS.md`: threat model with the assertion per
  control, incident and breach workflow (hold through `applyHold()`, notification
  duties for counsel), storage inventory (nothing is backed up by this project; restore
  NOT DONE), rollback as the project really deploys, cost items without prices, what
  scanning exists (`npm audit` in the preflight, the red-team rounds) and what does not
  (no external penetration test, no CI), and the real-credentials-in-the-test-shell
  finding.
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

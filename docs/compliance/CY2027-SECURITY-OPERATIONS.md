# CY2027 — Security operations (spec §30, §12, §13, §19; audit SPEC-30)

Audit round 2026-10-04 (SPEC-30); written from the code in this tree on 2026-10-27, for
the spec §35 final report ("Security
threat model and remediation evidence", "Rollback instructions", "Cost changes before
activation"). Everything below is either read from a named file or marked as not done.
Nothing here was verified against production, Vercel, Upstash or GoHighLevel from this
session (no network); the live header check of 2026-10-02 is in
`CY2027-ARCHITECTURE.md` §8.3.

Production facts that frame this document: `SOA_ENABLED = false`, so every public SOA
endpoint answers 503 today; production has **no KV store** (`api/_lib/rate-limit.js`,
verified 2026-08-13 — not re-verified here), so every store below falls back to
per-instance memory; the evidence store is not configured; the one-time code, the
beneficiary copy and the quarantine stop are off.

## 1. Threat model

### 1.1 Assets

| Id | Asset | Where it lives | Sensitivity |
|---|---|---|---|
| A1 | Lead record for a signing link (name, phone, email, ZIP, UI language, issuer IP) | KV `soa-lead:<beneficiaryRef>`, 24 h (`api/_lib/soa-store.js`) | contact PII |
| A2 | Link record (sha-256 of the token, factor kind, hashed last-4 / one-time code, views, attempts, outcome, `soaId`, `appointmentId`) | KV `soa-link:<sha256(token)>`, 24 h (`api/_lib/cy2027/secure-link.js`) | authorizes the prefill |
| A3 | Signed SOA instance and appointment ledger | KV `soa-signed:<soaId>`, `soa-appointment:<appointmentId>` with the `SOA_EVIDENCE` retention class (6 years; `api/_lib/cy2027/soa-ledger.js`, `retention.js`) | compliance evidence |
| A4 | Evidence record (exact wording seen, selections, election, integrity hash) and the signed PDF | evidence store at `CY2027_EVIDENCE_STORE_URL` (`api/_lib/cy2027/evidence-store.js`) — **not configured** | compliance evidence |
| A5 | CRM copy: contact (name, phone, email, postal code, address), tags `soa_signed`/source, custom fields, a note with the text record, a note carrying the PDF (base64) | GoHighLevel (`api/sign-soa.js`, `services.leadconnectorhq.com`) | contact PII + evidence |
| A6 | Audit trail: `[SOA-AUDIT]` JSON lines (action, actor, result, source, correlation id, redacted details) and `[AI-AUDIT]` lines | Vercel function logs (console) — no log drain configured (`docs/conversational-platform/KNOWN-LIMITATIONS.md`) | audit |
| A7 | Secrets: `HIGHLEVEL_TOKEN`, `HIGHLEVEL_LOCATION_ID`, `OPENAI_API_KEY`, KV tokens, `CY2027_EVIDENCE_STORE_TOKEN`, OTP provider tokens | Vercel environment (production); see §7 for the test shell | credentials |
| A8 | Governing objects: rulesets, SOA text (digest-pinned), overlay registry, knowledge release | the repository; frozen and registered in `scripts/no-self-modification-lib.mjs` | integrity of the rules |

### 1.2 Actors

Anonymous internet client; the beneficiary; a third party holding a forwarded link; a
fake-lead submitter; a bot; a person with a stolen or leaked CRM token; the AI assistants
(a capability, never an authority — spec §37); the model provider (receives the
conversation, never the CRM data).

### 1.3 Attacks, controls and the assertion that proves each control

"Assertion" is `scripts/<suite>.mjs :: <label>`; re-run with `node scripts/<suite>.mjs`.
A row with no assertion says so.

| Attack (spec §30 / §31) | Control | Assertion |
|---|---|---|
| Guess or enumerate a link; use an SOA id or contact id as authorization (IDOR) | Opaque 40–64 character token, stored under its sha-256; the GET discloses only usability and factor kind; identity is checked against the lead record, never the body | `scripts/test-cy2027-2026-10-01.mjs :: an invalid link discloses only that it is not usable`; `scripts/test-cy2027-supersession-2026-10-04.mjs :: handler (red team): a body phone that is not the proven phone is refused as an identity mismatch, the link intact` |
| Replay a consumed link / claim a signature that was never filed | Single consumption; only the exact `FILED` outcome reads as a signature (allow-list) | `scripts/test-cy2027-2026-10-01.mjs :: a second consumption is refused, as used-and-unfiled`; `scripts/test-cy2027-2026-10-01.mjs :: WVG-11: only the exact FILED value is a signature — an allow-list, not a deny-list` |
| Use an expired link | 24 h TTL; expiry refused by name before anything is read | `scripts/test-cy2027-2026-10-01.mjs :: an expired link fails closed`; `scripts/test-cy2027-verifyflow-2026-10-04.mjs :: an expired link refuses a code before any counting` |
| Brute-force the second factor | 5 attempts lock the link (`MAX_FACTOR_ATTEMPTS`); 10 attempts / 10 min per IP; a resend never resets the counter | `scripts/test-cy2027-2026-10-01.mjs :: status rate-limits the factor attempt harder than the probe`; `scripts/test-cy2027-verifyflow-2026-10-04.mjs :: a resend does NOT reset the attempt counter: the new code is refused on a locked link` |
| SMS bombing through the one-time code | Atomic claims in the store: per-link and per-destination caps inside a sliding hour; `OTP_STORE_UNAVAILABLE` → 503 rather than an uncounted send | `scripts/test-cy2027-verifyflow-2026-10-04.mjs :: handler: eight parallel issues for one phone — exactly five mint and send, three are refused by the destination cap, and the store holds exactly five` |
| Flood the link issuer / status / signature endpoints | Per-IP caps: 5 issues/h, 60 probes/min, 10 factor attempts/10 min, 3 signatures/h; on Vercel only `x-vercel-forwarded-for` is trusted as the client address (`api/_lib/rate-limit.js clientId()`) | `scripts/test-cy2027-qa-matrix-2026-10-04.mjs :: QA-12: the per-IP limiter admits exactly the configured number of a parallel burst and refuses the rest`; `scripts/test-cy2027-qa-matrix-2026-10-04.mjs :: QA-12: the three SOA endpoints keep their conservative per-IP limits (issue 5/h, status 60/min, factor 10/10min, sign 3/h)`. The forwarded-IP rule has no assertion in the cy2027 suites (not found). |
| Forwarded link read by a third party | No personal data before the factor matches; a quarantined lead's prefill is withheld even then | `scripts/test-cy2027-2026-10-01.mjs :: status GET no longer returns a lead object`; `scripts/test-cy2027-2026-10-01.mjs :: quarantine blocks prefill` |
| Fake lead in another person's name; a second record for the same channel | Trust engine: review signals, immediate quarantine on a second record, no CRM exposure for a quarantined lead; a replacement SOA for another person refused | `scripts/test-cy2027-2026-10-01.mjs :: attempting another record → immediate quarantine`; `scripts/test-cy2027-2026-10-01.mjs :: quarantine blocks CRM exposure`; `scripts/test-cy2027-supersession-2026-10-04.mjs :: EV-09: a replacement for another person is refused` |
| Fake-appointment bypass (voice-only SOA for a home visit; revoked or superseded SOA) | `marketingGate()` refuses by name; a valid Master SOA is not an input to the carrier gate | `scripts/test-cy2027-2026-10-01.mjs :: voice-only SOA does NOT unlock an in-person appointment`; `scripts/test-cy2027-2026-10-01.mjs :: gate blocks a revoked SOA` |
| Cross-site request (CSRF) | Every SOA handler refuses a request whose `Origin` is not on the allow-list before reading the body (403; `checkOrigin`); the flow sets no cookie (`credentials: 'omit'`) | `scripts/test-cy2027-2026-10-01.mjs :: ${f} checks the origin allowlist`; `scripts/test-cy2027-2026-10-01.mjs :: ${f} refuses a disallowed origin before anything else` |
| Tamper with a stored agreement | SHA-256 integrity hash over the rendered text, selections, identifiers and the language election; `verifyEvidence()` answers `HASH_MISMATCH` | `scripts/test-cy2027-2026-10-01.mjs :: tampering with the signature is detectable` |
| PII or secrets in logs, traces, analytics | `redactForLog()` on every audit detail (SSN, MBI, bank, card, DOB, tokens; arrays and key spellings included); audit lines carry reasons, never submitted strings | `scripts/test-cy2027-2026-10-01.mjs :: audit redacts sensitive values`; `scripts/test-cy2027-2026-10-01.mjs :: nested sensitive values are redacted too`; `scripts/test-cy2027-2026-10-01.mjs :: EF-04: accessToken is redacted` |
| Prompt injection asking for a carrier recommendation | Deterministic guard before the model; the carrier registry is not an export and throws for any public context | `scripts/test-redteam-openai-r2-2026-08-14.mjs :: 2 deep-history injection never reaches provider`; `scripts/test-cy2027-2026-10-01.mjs :: EF-01: CARRIER_OVERLAYS is not exported from the module` |
| AI or automation approving a quarantine, releasing a hold, promoting a ruleset | One human-actor rule (`humanActorProblem()`, `CY2027_REVIEWERS` allow-list, unset today → every such decision refused) | `scripts/test-cy2027-2026-10-01.mjs :: AI cannot resolve a quarantine`; `scripts/test-cy2027-2026-10-01.mjs :: "system" cannot resolve a quarantine` |
| Rules self-modified from production or by a stray write | Build gate: nothing under `api/` loads outside the allow-list or builds code; governing objects frozen all the way down and never assigned to | `scripts/test-cy2027-learning-2026-10-04.mjs :: every governing object it knows about is frozen all the way down` |
| Old plan-year rules silently reused | Plan-year clock; the 2027 ruleset is not reused the instant CY2028 opens | `scripts/test-cy2027-yearly-2026-10-04.mjs :: the instant CY2028 marketing opens, the 2027 ruleset is NOT reused` |
| Health, Medicaid, disability used to score or route | Prohibited signals cannot enter trust logic; a diagnosis is removed before scoring | `scripts/test-cy2027-2026-10-01.mjs :: prohibited signal ${sig} cannot enter trust logic`; `scripts/test-cy2027-2026-10-01.mjs :: a diagnosis is removed` |
| HTTPS / HSTS / CSP / secure headers (§30) | Set in the Vercel configuration; measured live on 2026-10-02: HSTS 2 years with preload, CSP without `unsafe-inline`/`unsafe-eval`, `frame-ancestors 'none'`, `nosniff`, `DENY` | `CY2027-ARCHITECTURE.md` §8.3 (live measurement, not a suite) |
| Stolen CRM token | Not mitigated by code: a valid `HIGHLEVEL_TOKEN` reads and writes the sub-account. Controls are operational: least-privilege token scope in GoHighLevel, rotation, and keeping the token out of every non-production shell (§7). | none — operational |

### 1.4 Residual risks, stated plainly

- The default second factor is the last four digits of the phone on the lead record. A
  person who was given both the link and the phone number passes it. The one-time code is
  built, flag off, and unreachable until a server-side contact-permission lookup exists
  (`CY2027-ARCHITECTURE.md` §6).
- Rate limits and one-time-code caps hold per serverless instance until KV is provisioned.
- `/api/soa-token` does not consult the trust verdict computed in `/api/submit-lead`
  (QA matrix, gap G-W5).
- The audit trail lives in function logs with no drain; its retention is the Vercel
  plan's, which this session could not verify.

## 2. Incident response and breach response

**Who decides.** The licensed owner (principal) decides containment, notification and
customer contact. The reviewers named in `CY2027_REVIEWERS` (unset today) are the only
actors the code accepts for resolving a quarantine, releasing a hold or promoting a
ruleset — judged by `humanActorProblem()`; an automation, an AI product or an assistant
name is refused. **Counsel** decides whether any notification duty applies; nothing in
this document is a legal conclusion.

**Detection.** `[SOA-AUDIT]` lines (actions `SOA_LINK_ISSUED`, `SOA_LINK_RESENT`,
`SOA_VIEWED`, `SOA_SIGNED`, `SOA_REFUSED`, `SOA_SUPERSEDED`, `SOA_REVOKED`,
`SOA_EVIDENCE_WRITTEN`, `SOA_EVIDENCE_WRITE_FAILED`, `MARKETING_GATE_ALLOWED`,
`MARKETING_GATE_BLOCKED`, `SECURITY_QUARANTINE`, `SECURITY_REVIEW_RESOLVED`,
`CONSENT_RECORDED`, `CONSENT_REVOKED`, `OTP_ISSUED`, `OTP_SEND_REFUSED`) and
`[rate-limit][ALERT]` lines in the Vercel function logs; `[SECURITY-REVIEW]` tasks the
trust engine attaches to a flagged lead in GoHighLevel; a complaint, a carrier audit or a
CMS inquiry received by the agency.

**Workflow.**

1. **Triage (owner).** Identify the affected `soaId` / `appointmentId` / contact from the
   audit lines by correlation id. Record the time, the source and what was observed.
2. **Preserve (owner or reviewer).** Put the signed record and its ledger entry under a
   hold: `applyHold(record, reason)` in `api/_lib/cy2027/retention.js`, with one of the
   named reasons `LEGAL_HOLD`, `COMPLAINT`, `CARRIER_AUDIT`, `CMS_INQUIRY` (an unknown
   reason throws; an unreadable holds list is refused rather than rewritten).
   `mayPurge()` refuses any record under a hold; `releaseHold()` requires a named person
   and refuses an automation. Export the evidence record and run `verifyEvidence()` on it;
   keep the result with the hold note. Export the relevant function-log window — no drain
   exists, so this is a manual export from the Vercel dashboard, and its retention window
   is the plan's. There is no tooling that writes the hold back to KV: today it is a
   function on a record; a person applies it and files the result.
3. **Contain (owner).** Keep `SOA_ENABLED = false` (it is false). For a live incident on
   an enabled flow: re-promote the previous deployment (§4), set the kill switches
   `CP_KILL_AI` / `CP_KILL_ALL` where the assistants are involved (note in
   `docs/conversational-platform/ROLLBACK.md`: killing opt-out stops honoring
   revocations), revoke affected links (`revokeLink()`; a revoked link fails closed and
   is never re-issued), and rotate any credential that may have been exposed in
   GoHighLevel, OpenAI, Upstash and the evidence store — rotation is an owner action.
4. **Assess (owner + counsel).** What data was exposed, to whom, for how long: the lead
   record (A1), the link record (A2), the signed record (A3/A4), the CRM copy (A5).
   **Notification duties — for counsel to determine, not asserted here:** whether the
   data involved is protected health information or personal information under HIPAA /
   HITECH (business-associate position of the agency), New York, New Jersey and
   Connecticut breach-notification statutes, CMS/carrier contractual reporting duties
   (the Aetna producer agreement is the only contract document spec §36 lists), and any TCPA
   consequence of an unauthorized contact.
5. **Record and learn.** One incident record with the facts, the hold, the exports and the
   decisions. Any rule change that follows goes through the controlled-learning pipeline
   (candidate → human review → versioned change → test → approval → deploy); nothing
   changes a rule from an incident by itself.

**Breach-response checklist (evidence of the response).** Audit lines exported; hold
applied and its reason recorded; evidence hash verified; credentials rotated (which, when,
by whom); deployment rolled back or confirmed unaffected; counsel's determination filed;
customer notice (if any) sent by the agency, never by an assistant.

## 3. What is stored where — and therefore what is backed up

| Store | What | Retention / TTL as coded | Backed up by this project? | Restore tested? |
|---|---|---|---|---|
| Vercel KV / Upstash (`KV_REST_API_URL` + token) — **not configured in production**; without it every key below lives in one serverless instance's memory and is lost on cold start | `soa-lead:*` (A1), `soa-link:*` (A2), `soa-signed:*` and `soa-appointment:*` (A3), `soa-appointment-lock:*`, `otp-dest:*` and the per-link OTP send slots, rate-limit counters | 24 h; 24 h; 6 years (`RETENTION_YEARS.SOA_EVIDENCE`); 60 s; 1 h window; limiter window | No. Nothing in this repository exports or snapshots KV. Whether Upstash keeps its own backups was not verified. | Restore tested: NOT DONE |
| Evidence store (`CY2027_EVIDENCE_STORE_URL`) — **not configured** | Evidence record JSON and signed PDF at `evidencePath(instance, hash)` (A4) | Whatever the store applies; the code never deletes | No. `scripts/cy2027-verify-evidence-store.mjs` proves a write/read round trip once configured; it is not a backup. | Restore tested: NOT DONE |
| GoHighLevel sub-account | Contact, tags, custom fields, note with the text record, note carrying the PDF (A5); the `[SECURITY-REVIEW]` tasks | GoHighLevel's | No. GoHighLevel's own retention and backup were not verified. | Restore tested: NOT DONE |
| Vercel function logs | `[SOA-AUDIT]`, `[AI-AUDIT]`, `[rate-limit][ALERT]` (A6) | The Vercel plan's (unknown here); no log drain | No | Restore tested: NOT DONE |
| Browser | No cookie is set by the SOA flow (`credentials: 'omit'`); the chat bot keeps tab-scoped session memory in `sessionStorage` and holds no PII in `localStorage` (`src/components/ChatBot.tsx` header) | session | n/a | n/a |
| Repository | Rulesets, SOA text, overlay registry, knowledge release (A8), digest-pinned and gated | git history | The git remote, outside this session's verification | n/a |

Consequence: the only durable copy of a signed SOA today would be the GoHighLevel
note and its PDF note, because KV and the evidence store are not configured. Activation
requires both, and a backup owner for each, before `signedPdfPersisted` can be true.

## 4. Rollback

This project deploys as documented in `docs/conversational-platform/DEPLOYMENT.md` and
`ROLLBACK.md`, which this section follows and does not replace:

- **`git push` builds a PREVIEW only.** Production changes only through the owner's
  `vercel promote <deploymentUrl> --scope sawil-reyess-projects --yes` with the global
  authenticated binary (`%APPDATA%\npm\vercel`; `npx vercel` is broken). Never
  `vercel deploy --prod` from the repository folder. A promote rebuilds with production
  environment, so environment-variable changes need a re-promote.
- **Roll back = promote the previous Production deployment again:**
  `vercel ls clearpoint-deploy --scope sawil-reyess-projects` to find the prior Production
  row, then `vercel promote <priorProductionUrl> --scope sawil-reyess-projects --yes`.
  Every promote records the previous deployment, so the rollback point is always the row
  before the current one.
- **Verify after every promote** (DEPLOYMENT.md): bundle hash local == live;
  `POST /api/opt-out {}` → 400; one `/api/chat` probe with an `Origin` header; security
  headers present; whatever the change touched.
- **Kill switches without a deploy** (set the variable, re-promote): `CP_KILL_AI`,
  `CP_KILL_ALL`, `LLM_PROVIDER`, `OPENAI_REASONING_EFFORT=off`; Turnstile absent = off.
- **Voice (GoHighLevel):** paste the backed-up prompt from `docs/voice/backups/` into the
  agent and save; 5–10 minutes to propagate. Never edit without the backup step.
- **This change (SPEC-27/30/31, committed 2026-10-27):** it alters no production behaviour
  (`SOA_ENABLED` stays false; the carrier registry stays private; the form change is
  behind the disabled flow). Rolling it back is `git revert <sha>` on the branch followed
  by the owner's promote; there is no data migration to undo.
- **Promotion of 2026-10-29 (commit `4be5afa`, `dpl_BiQKWLqpdU5VTdSBPc8nwLVgmXMo`):** the
  rollback point is the previous Production deployment
  `clearpoint-deploy-j1l0wc0fn-sawil-reyess-projects.vercel.app` (commit `50eb408`). The
  36 CY2027 custom fields created the same day are additive and empty until written; to
  stop writing them, `vercel env rm CY2027_CRM_FIELD_IDS production` and re-promote.
  See `CY2027-ARCHITECTURE.md` §8.4.

## 5. Cost items before activation

Items the activation of the SOA layer would add. No prices are stated: none was read
from a source in this session, and inventing one would be fabrication.

| Item | Why it is needed | Who decides |
|---|---|---|
| Vercel KV / Upstash Redis | Shared rate limits and one-time-code caps (today per instance), durable lead/link records across instances, the 6-year signed record and ledger | Owner — plan and region |
| Evidence object store (HTTPS, token) and its egress | `putEvidence()` for the evidence record and the signed PDF; `signedPdfPersisted` precondition | Owner — provider; must be verified with `scripts/cy2027-verify-evidence-store.mjs` |
| One-time code delivery (SMS and/or email provider) | `CY2027_SEND_OTP` with `CY2027_OTP_SMS_URL/_TOKEN` or `CY2027_OTP_EMAIL_URL/_TOKEN`; per-message cost | Owner — channel and provider; also needs the contact-permission lookup |
| Beneficiary copy channel | `CY2027_SEND_BENEFICIARY_COPY`; per-message cost | Owner |
| GoHighLevel custom fields | The CY2027 fields (`scripts/cy2027-provision-crm-fields.mjs --apply`) and `CY2027_CRM_FIELD_IDS`; whether the sub-account plan limits custom fields was not verified | Owner |
| Log drain or retained log storage | Durable audit trail (A6) beyond the plan's log window | Owner |
| External penetration test of the public SOA endpoints | Spec §30 requirement before launch (§6 below) | Owner — vendor |
| Model usage | Unchanged by this layer: the SOA flow calls no model | — |

## 6. Dependency scans, security scans and penetration tests

**Exists.**
- `scripts/cy2027-preflight.mjs` runs `npm audit --omit=dev --json` and blocks on any
  critical or high advisory in production dependencies (deliberately not part of
  `npm run build`, so an upstream advisory cannot break a deploy silently; run
  `npm run preflight` before promoting).
- `scripts/check-no-self-modification.mjs` (build gate): module allow-list under `api/`,
  no `eval` / `new Function` / computed module names, governing objects frozen all the
  way down and never assigned to.
- `scripts/check-cy2027-parity.mjs` (build gate): one source for the SOA text, the
  disclaimer, the consent wording and the knowledge release, each digest-pinned.
- `eslint` and `tsc` in the build; `check-source-hygiene.mjs`.
- **Internal red-team rounds, recorded in `CY2027-ARCHITECTURE.md` §7:** 2026-10-02
  (6 lenses, 37 findings reproduced and fixed: 9 critical, 22 high, 4 medium, 2 low);
  2026-10-03 (G08 / TPY-09; 46 mutants killed 46/46); the 2026-10-04 rounds named in the
  commit log per area (SOA supersession, verification flow, CRM registry, knowledge
  ledger, voice SOA, data quality). Each round was reproduced by a different agent before
  it counted, and each fix is pinned by an assertion.
- Live header measurement of production, 2026-10-02 (`CY2027-ARCHITECTURE.md` §8.3).

**Does not exist.**
- No external penetration test of the public SOA endpoints has been performed. Spec §30
  requires one before launch; it is an owner action with a vendor, after the endpoints
  are enabled on a preview deployment.
- No continuous integration pipeline runs the battery or `npm audit` on push
  (no `.github/workflows` in the tree); the gates run on the developer's machine and in
  the Vercel build.
- No dynamic scan (DAST), no secret-scanning hook, no SAST beyond eslint.
- No WAF or bot-detection rule is configured (Turnstile keys absent = off).

## 7. Operational finding — real credentials in the test shell

Observed 2026-10-27 by a presence check only (values were never printed): the shell in
which the suites run carries real values for `HIGHLEVEL_TOKEN`, `OPENAI_API_KEY` and
`HIGHLEVEL_LOCATION_ID`. The suites neutralise them — `globalThis.fetch` is replaced by a
double and the variables by dummies for the duration of every handler drive; the local
harness `scripts/dev-lead-server.mjs` refuses to start when `HIGHLEVEL_TOKEN` does not
begin with `local-` unless `ALLOW_REAL_CRM=1`, forces a dummy when unset and deletes
`OPENAI_API_KEY` — and no suite in the battery contacts GoHighLevel or OpenAI. The
exposure is the shell itself: any script, dependency post-install step or stray
`console.log` in that environment can read the production CRM token.

**Recommendation (owner action):** remove the three variables from the test environment
(user and machine scope, shell profiles, `.env*` files loaded by the shell); keep
production secrets only in the Vercel project environment; rotate `HIGHLEVEL_TOKEN` and
`OPENAI_API_KEY` if either has ever been printed or committed; and keep
`ALLOW_REAL_CRM` unset everywhere.

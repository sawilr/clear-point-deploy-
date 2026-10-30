# ClearPoint CY2027 — Final report (spec §35)

Date of this report: 2026-10-27, updated 2026-10-29 after the owner's GO ("push live
todo lo que se puede … make it live"). Branch `fix/master-audit-2026-09-10`.
Scope: every commit from `8d69af0` (2026-10-01, first CY2027 commit) to `a650129`
(2026-10-27): 54 commits, 96 files, +28,935 / −634 lines, plus `edcfcdb` (this report)
and `4be5afa` (lockfile: transitive `zod` 4.3.5 → 4.6.7, the one high advisory that
blocked the preflight). **Deployed 2026-10-29:** `4be5afa` pushed, built as preview
`clearpoint-deploy-mcuy5c3lf`, verified, promoted; production deployment
`dpl_BiQKWLqpdU5VTdSBPc8nwLVgmXMo` (`clearpoint-deploy-a263o0q19`) now serves
`clearpointsenioradvisors.com` and `www`. The 36 CY2027 custom fields were created in the
GoHighLevel sub-account and mapped in the Vercel Production environment (§5.2). Nothing
voice-related was applied to GoHighLevel.

Every figure below was read from the tree or from a command run on 2026-10-27; the
command is named where it matters so the figure can be re-derived. Where a fact could
not be verified from this repository it is labelled **not verified** and the check that
would verify it is stated.

---

## 0. Final status

**IMPLEMENTED-CONTROLLED PRODUCTION** (since 2026-10-29; it was BLOCKED-COMPLIANCE on
2026-10-27, before the owner's GO).

Read precisely: the layer is **live in production in controlled mode** — the CY2027 TPMO
sentence on all 46 served pages, the trust engine as a signal on every lead, the
sensitivity and prohibited-signal filters, the audit record, the CRM field registry with
the 36 fields mapped — while the **SOA workflow itself stays off** (`SOA_ENABLED = false`)
and the voice SOA stays unapproved. What remains blocked is **enabling** the SOA workflow,
and the blockers are compliance inputs that only the owner, counsel or a named reviewer
can supply. Nothing in code can close them:

| Blocker | Why it is compliance, not engineering | Where it is enforced |
|---|---|---|
| TPMO organization / product counts | Real FMO-confirmed integers; the count-less sentence is `BLOCKED_COUNTS_REQUIRED` and must never be guessed | `SOA_PRECONDITIONS.tpmoCountsVerifiedEverywhere = false`; prerender gate verifies the year, not the counts |
| Human promotion of the active rulesets | `CMS_RULESET_2027-v1.0` and `NY/NJ/CT-CY2027-v1.0` are `PRODUCTION_ACTIVE` with `promotion = NO_PROMOTION_ON_RECORD`; spec §22 forbids AI self-promotion | `SOA_PRECONDITIONS.rulesetPromotionAttested = false`; `CY2027_REVIEWERS` unset refuses every human-only decision |
| Evidence store backend | Configuration plus a verified round trip | `SOA_PRECONDITIONS.signedPdfPersisted = false`; `CY2027_EVIDENCE_STORE_URL/_TOKEN` unset → 503 `SOA_EVIDENCE_NOT_STORED` |
| Voice SOA script approval | New customer-facing wording | `VOICE_SOA_SCRIPT.status = PENDING_OWNER_APPROVAL`, `VOICE_SOA_ENABLED = false` |
| Verification letter approval | New customer-facing wording | `VERIFICATION_LETTER.approval.status = PENDING_OWNER_APPROVAL` |
| Counsel readings | Recording-notice positions (NY/NJ one-party, CT all-party), consent scope for a verification call, breach-notification duties, carrier producer agreements | Carried as `complianceReview: OWNER_COUNSEL`, QA-matrix §3, SECOPS §2 |
| Production deploy | Owner GO required by the engagement rules | **DONE 2026-10-29** — GO given in chat; see §12 for the rollback point |

`SOA_ENABLED = false` in all four mirrors (`api/sign-soa.js:85`, `api/soa-status.js:37`,
`api/soa-token.js:32`, `src/lib/soaContent.ts:63`); `assertSoaEnablementSafe()` throws at
module load if it is flipped while any precondition is false.

Production as served on 2026-10-29 after the promotion (curl against the custom domain,
no cookie): home 200, bundle `index-C9yqRwo0.js` equal to the local build and to the
preview; TPMO EN "We do not offer every plan available in your area. Please contact
Medicare.gov or 1-800-MEDICARE to get information on all of your options." and its ES
counterpart, zero SHIP occurrences, 46/46 served pages verified by
`cy2027-preflight.mjs --url`; CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy,
Permissions-Policy present; `www` → 308 to the apex; `/api/soa-status` 403 without an
allowed Origin and 503 `SOA_DISABLED` with one; `POST /api/opt-out {}` → 400 with the
expected message; `/api/chat` → 200 with a correct AEP answer; `POST /api/submit-lead`
with a fictional 555 number → 400 "Phone appears fake" (the new validation is live).
Before the promotion (2026-10-27) production served bundle `index-jgWGDRt6.js` with the
CY2026 sentence and 3 SHIP occurrences.

Why this label: the layer runs in production with its controls on and the SOA workflow
gated off, which is "controlled production"; IMPLEMENTED-MONITORING would overstate (no
log drain, no alerting, no CI); BLOCKED-COMPLIANCE now describes only the enablement
step, not the deployment; no security finding is open, so not BLOCKED-SECURITY.

---

## 1. Architecture and state machines

```
 PUBLIC LAYER (carrier-blind, no model in the SOA flow)
 ┌──────────────────────────────┐  ┌──────────────────────────────────────┐
 │ Site (React 19 / Vite 7)     │  │ Voice agents Emely (EN) / Sofía (ES) │
 │ Clara/Zara chat, Smart Review│  │ live in GoHighLevel — prompts V2.3   │
 │ /soa/:token  SOAForm         │  │ of 2026-10-01, NOT changed here      │
 └──────────────┬───────────────┘  └──────────────────┬───────────────────┘
                │ fetch (credentials: omit)            │ (no endpoint receives a voice
                ▼                                      │  segment yet — §10)
 VERCEL SERVERLESS  api/*.js  (56 files allow-listed by the self-modification gate)
   submit-lead  soa-token  soa-status  sign-soa  chat  opt-out  …
                │  imports only
                ▼
 CANONICAL LAYER  api/_lib/cy2027/  (30 modules, env-neutral, pure where possible)
   soa-text ── soa-instance ── evidence ── evidence-store      rulesets ── ruleset-lifecycle
   consent ── callback-consent ── voice-soa ── soa-ledger       state-rules ── yearly-readiness
   trust ── prohibited-signals ── data-quality ── sensitivity   crm-fields ── carrier-overlay
   otp ── secure-link ── out-of-band-verification ── actors     retention ── learning ── tpmo
   (client reaches it only through src/lib/cy2027.ts re-exports)
                │
                ▼
 STORES   Vercel KV (soa-lead/link/signed/appointment/otp/rate-limit — NOT configured in
          production) · evidence store (NOT configured) · GoHighLevel contact + notes ·
          Vercel function logs ([SOA-AUDIT] [AI-AUDIT])

 BUILD GATES (npm run build): source-hygiene · vercel-config · figures-year ·
   allowlist-drift · zero-cost-claims · contact-consistency · cy2027-parity (14 checks,
   digest-pinned texts) · no-self-modification (50/50 governing objects frozen) · tsc ·
   vite · prerender-meta · prerender-body (46/46 routes, TPMO year verified) · sitemap
```

State machines (values read from the modules; the full transition tables with the
refusal reasons are in `CY2027-ARCHITECTURE.md` §2):

- **SOA instance** (`soa-instance.js`, `SOA_STATUS`): `createSoaInstance()` (an
  `appointmentId` is required at construction) → `PENDING_SIGNATURE` when at least one
  authorizing category is selected, or `SOA_INCOMPLETE` when only "I am not sure" / none
  (a licensed agent explains the process; never forced to completion) →
  `completeSoaInstance()` requires `integrityHash` + `evidenceReference` → `COMPLETED` →
  `SUPERSEDED` (a second signature for the same appointment, `supersededById` set) or
  `REVOKED` (`revokedAt` set). `marketingGate()` refuses with a named reason, in order:
  `NO_SOA`, `SOA_INCOMPLETE`, `SOA_SUPERSEDED` / `SOA_REVOKED` / `SOA_NOT_COMPLETED`,
  `SOA_EVIDENCE_MISSING`, `SOA_LANGUAGE_NOT_ELECTED`, `NO_APPOINTMENT` /
  `SOA_FOR_DIFFERENT_APPOINTMENT`, `SOA_PLAN_YEAR_MISMATCH`, `SOA_STATE_MISMATCH`,
  `SOA_NOT_RECORDED_BEFORE_APPOINTMENT`, `IN_PERSON_REQUIRES_WRITTEN_SOA`. Methods: `WEB_ELECTRONIC_SIGNATURE`,
  `SMS_LINK_ELECTRONIC`, `EMAIL_LINK_ELECTRONIC`, `APPROVED_WRITTEN_METHOD` (written) and
  `VOICE_RECORDED` (not written → never unlocks an in-person appointment).
- **Plan-year ruleset** (`ruleset-lifecycle.js`): `PENDING_REVIEW → VERIFIED →
  STAGING_TESTED → PRODUCTION_ACTIVE → SUPERSEDED`; promotion only by a named human in
  `CY2027_REVIEWERS`; `CMS_RULESET_2028-v0.0` is `PENDING_REVIEW` with no rule values.
- **Lead trust** (`trust.js`): `VERIFIED_REQUEST | PARTIALLY_VERIFIED | UNVERIFIED |
  SECURITY_QUARANTINE | HUMAN_REVIEW_REQUIRED`; channel verification `NOT_ATTEMPTED →
  PENDING → VERIFIED | FAILED`. Prohibited signals never enter the engine.
- **Consent** (`consent.js`): per object `NOT_ASKED → GRANTED | DECLINED | UNCLEAR`;
  `GRANTED → REVOKED`. Four objects, never inferred from each other (§6).
- **Voice SOA** (`voice-soa.js`): offer gate (flag, approval, state confirmed, context,
  caller chose voice, format not in person, recording active) → per-category capture
  (one affirmative per category; a negation anywhere is a no; "unsure" selects nothing)
  → read-back confirmed → evidence block inside the integrity hash → write stage
  re-checks flag, approval, format and clock; recording lost in the segment → void.
- **Retention** (`retention.js`): classes `MARKETING_SALES_CALL_AUDIO`, `…_TRANSCRIPT`,
  `SOA_EVIDENCE`, `CONSENT_RECORD`, `SECURITY_LOG`, `GENERAL_CRM` at 6 years;
  `ENROLLMENT_RECORD` = `null` (owner must supply; never purged while null); audio
  required years 0–3, audio or complete transcript years 4–6; holds `LEGAL_HOLD`,
  `COMPLAINT`, `CARRIER_AUDIT`, `CMS_INQUIRY` via `applyHold()`.

---

## 2. Before / after inventory (IDs and versions)

"Before" is the tree at `8d69af0^` (2026-09-30) as described by the commit log and the
audit comments; "after" is `a650129`.

| Object | Before | After |
|---|---|---|
| TPMO disclaimer | CY2026 sentence (with SHIP reference) in three copies; **this is what production still serves (read 2026-10-27)** | One source (`tpmo.js`), CY2027 variant, year verified by the prerender gate; counts `BLOCKED_COUNTS_REQUIRED` |
| SOA customer-facing text | Form copy in `soaContent.ts`, no script version, no plan-year model, no state-first order, no mandatory appointment, no read-back (commits `8d69af0`, `8057f14`) | `SOA_PLAN_YEAR = 2027`, `SOA_SCRIPT_VERSION = CP-SOA-SCRIPT-CY2027-v1.0`, `APPROVED_TEXT_DIGEST = sha256:d7b907f6…26de63` (build fails on drift) |
| State rulesets | None | `NY-CY2027-v1.0` / `NJ-CY2027-v1.0` / `CT-CY2027-v1.0`, forms `CP-SOA-{NY,NJ,CT}-CY2027-v1.0`, effective 2026-10-01, `PRODUCTION_ACTIVE`, promotion not on record |
| CMS ruleset | None | `CMS_RULESET_2026-v1.0` (effective 2025-10-01), `CMS_RULESET_2027-v1.0` (effective 2026-10-01, active), `CMS_RULESET_2028-v0.0` placeholder |
| Contact consent | One TCPA checkbox, `DISCLAIMER_VERSION = 2026-06-01` | Unchanged wording and version; registered as `CONTACT_CONSENT_TEXT_VERSIONS['2026-06-01']` scope `DISCUSS_MEDICARE_PLAN_OPTIONS`, EN/ES sha256 pinned, parity-checked against the site |
| Consent objects | 1 | 4: `RECORDING_NOTICE`, `CALLBACK_CONTACT_PERMISSION`, `SCOPE_OF_APPOINTMENT`, `AI_OUTBOUND_VOICE_CONSENT` |
| Knowledge body | Unversioned string | `CP-UMKE-CY2026-v1.0`, digest-pinned, approval `APPROVAL_NOT_RECORDED`, stamped on every `[AI-AUDIT]` line |
| Voice SOA | Nothing (no evidence model, no script, no per-category capture) | `voice-soa.js`; script `CP-SOA-VOICE-SCRIPT-CY2027-v0.2` `PENDING_OWNER_APPROVAL`, `VOICE_SCRIPT_DIGEST = sha256:b0adef6e…06aca1`, `VOICE_SOA_ENABLED = false`; owner package `docs/voice/VOICE-SOA-CONFIGURATION-PACKAGE-2026-10-04.md` NOT APPLIED |
| Verification letter / call (§12) | None | `VERIFICATION_LETTER` `CP-VL-2026-10-04-v1` `PENDING_OWNER_APPROVAL` (approval bound to `letterTextDigest`); `mayPlaceVerificationCall()`, `reopenCaseOnCallback()` definitions |
| One-time code (§12) | None | Atomic send/issue claims in the store, `CY2027_SEND_OTP` off, no channel configured |
| CRM field registry | 12 production ids as literals in three handlers; SOA fields sent by name (never landed, CRM-27) | `EXISTING_CRM_FIELDS` (12 ids) + `CY2027_FIELD_KEYS` (36 keys, unmapped until `CY2027_CRM_FIELD_IDS`); `IN_USE` / `SHARED` ids refused |
| Carrier overlay registry | None | 10 rows, all `PENDING_*`; state lists `STATED_BY_SPEC` for 2, `UNVERIFIED` for 8; module-private |
| Governing objects frozen by the build | 0 | 50/50 (`check-no-self-modification.mjs`) |
| Test battery | 44/44 suites when the architecture document was first written | 54/54 suites; 11 CY2027 suites, 5,163 assertions (sum of the per-suite RESULT lines, §9) |
| Production | Bundle `index-jgWGDRt6.js` (commit `50eb408`, 2026-09-27), CY2026 TPMO with SHIP, `/api/soa-status` 403 | **Promoted 2026-10-29:** bundle `index-C9yqRwo0.js` (commit `4be5afa`), CY2027 TPMO on 46/46 pages, `/api/soa-status` 403 / 503 `SOA_DISABLED`; rollback point `clearpoint-deploy-j1l0wc0fn` |
| GoHighLevel CY2027 fields | 0 of 36 exist | **36 created 2026-10-29** (`cy2027-provision-crm-fields.mjs --apply`, 0 reused, 0 refused); map set as `CY2027_CRM_FIELD_IDS` in Vercel Production |

---

## 3. Files, components and workflows changed — and why

By directory (`git diff --name-only 8d69af0^..HEAD`), 96 files:

| Area | Files | Why |
|---|---|---|
| `api/_lib/cy2027/` | 36 | The canonical layer: rules as pure functions, every refusal named, no `src/` import so Vercel functions can use it |
| `scripts/` | 32 | 11 CY2027 suites, the build gates (parity, self-modification, prerender TPMO year), provisioning / preflight / evidence-store verification tools, the battery runner |
| `src/lib/` (+ `orchestrator/`) | 8 | `cy2027.ts` re-export bridge, `soaContent.ts` preconditions and `SOA_ENABLED`, TPMO single source, consent receipt versioning |
| `api/` handlers | 6 | `sign-soa`, `soa-status`, `soa-token`, `submit-lead`, `chat`, `opt-out`: server-side enforcement of the gates (CY2027-SRV-01), evidence before completion, audit lines, trust signal, Medicaid/LIS self-report handling |
| `api/_lib/` | 4 | Knowledge release ledger, compliance filter, rate-limit notes, CRM write guard |
| `src/components/` | 4 | `SOAForm` rewritten to the approved Master SOA (language election, state first, one checkbox per category, read-back, jurisdiction as one value), `CustomerServiceBot`, `SmartMedicareReview`, `ChatBot` |
| `src/pages/` | 2 | `SignSOA` second factor and refusal screens |
| `docs/compliance/` | 4 | `CY2027-ARCHITECTURE.md`, `CY2027-QA-MATRIX.md`, `CY2027-SECURITY-OPERATIONS.md`, this report |
| `docs/voice/` | 1 | Owner configuration package for the voice SOA (NOT APPLIED) |
| root | `package.json`, `index.html`, `.vercelignore`, `public/` | Battery and gate scripts wired into `build`/`test`; `scripts/*` and `docs/` excluded from the artifact |

Commit chain by phase (`git log 8d69af0^..HEAD`):

- **2026-10-01 foundation** — `8d69af0` layer (rulesets per year, SOA per appointment,
  separate consents, trust/quarantine, retention); `5cf1868` secure link (256-bit token,
  store by hash, second factor); `8057f14` form rewritten to the approved Master SOA.
- **2026-10-02 hardening and first independent red team** — `49042e6` server enforces
  the gates; `f6156ad` never say "saved" when the CRM failed; `7a3e696` durable evidence;
  `216b065` prohibited signals never reach the scorer; `8bf86cc`/`1d801fb`/`381253e`/
  `b3e1203` 37 red-team findings closed (9 critical, 22 high, 4 medium, 2 low);
  `07ba762` carrier firewall closed in the public layer; `f35b0d5` CRM mapping and the
  CRM-27 finding; `650c048` real audit record; `3bc9d16` clinical detail out of the CRM
  note; `c8e25c0` trust engine in the lead pipeline as a signal only; `42e8f52`,
  `101c867`, `983bebf`, `3b1260d`, `acf9cc9` (launch preflight), `802e739`, `2840ec6`
  (live production verification), `d3182a2`, `eee6dce` (TPMO year gate).
- **2026-10-03** — `86915a0` document language is an election (G08); `5a4895b` second red
  team (G08, TPY-09) repaired.
- **2026-10-04** — `78abcf4`/`ff11ee3` contact permission keeps its stated scope,
  revocation mirrors it (CE-09, CRM-15); `51ba215` plan-year clock and yearly cycle
  (SPEC-22); `01533d2`/`70627ba`/`65391c2` controlled learning and the
  no-self-modification gate (SPEC-23), red-teamed.
- **2026-10-05** — `2d92774`/`913a559` Medicaid / Extra Help stored as `SELF_REPORTED`
  only (DM-04), red-teamed.
- **2026-10-12** — `77ea133`/`4cb1ee5` data sensitivity class (CRM-25); `0ec5264`/
  `9322337` disposable-mailbox signal, "fake lead" label removed (FTQ-11).
- **2026-10-13** — `dfefe69`/`75497b9` knowledge release ledger; `215dc8e`/`bf47813`
  canonical CRM field registry (§18); `0c4a845`/`8709caa` SOA supersession and link
  burn-out; `d4aee5a` one-time code, letter and verification call (SPEC-12).
- **2026-10-27** — `7cb20d1` owner's Footer Facebook link (found uncommitted in the tree);
  `a7c6e9b` §12 red-team repair (atomic OTP claims, purpose reaches the scope rule,
  letter approval bound to digest); `42a5799`/`6459572` voice SOA built and red-team
  repaired (SPEC-10/19/26/28); `4614901`/`a650129` QA matrix, website gates W0–W11,
  security operations, carrier registry provenance, form jurisdiction fix, red-team
  repaired (SPEC-27/30/31).

**Workflows changed: none.** No GoHighLevel workflow, agent prompt or tool was modified.
Platform changes made on 2026-10-29 under the owner's GO: the 36 CY2027 custom fields
were created in the GoHighLevel sub-account (additive; the script never edits or deletes
a field), `CY2027_CRM_FIELD_IDS` was added to the Vercel project (Production target), and
the verified preview was promoted. The voice package (`docs/voice/…`) remains NOT
APPLIED: its script is `PENDING_OWNER_APPROVAL`.

---

## 4. Exact customer-facing SOA text implemented (EN / ES)

Verbatim from `api/_lib/cy2027/soa-text.js`, pinned by `APPROVED_TEXT_DIGEST`. `{state}`
is substituted from the state ruleset; it is the only per-state token.

**Organization line (both languages):** `CLEAR POINT SENIOR ADVISORS`
**Agent line (both languages):** `Sawil Reyes - NPN 17261494`

### 4.1 English

- Title: `SCOPE OF APPOINTMENT - {state}`
- Subtitle: `Clear Point Master SOA Template - Appointment-Specific Instance - English / Español`
- Prepared: `Prepared for implementation and compliance validation - CY2027`
- Intro: `This form documents only the Medicare product categories the beneficiary authorizes a licensed agent to discuss during one specific personal marketing appointment. It is not an enrollment form and does not change current coverage.`
- Appointment heading: `Appointment`
- Categories heading: `English - Product categories you authorize for this appointment`
- Categories help: `Please select only the topics you want the licensed Clear Point agent to be allowed to discuss with you during this appointment. You may select more than one. If you are unsure, you may leave a category unselected and speak with the licensed agent about the process before authorizing additional topics.`
- Category `MA_NO_RX` (authorizes): **`Medicare Advantage plan without integrated prescription drug coverage`** — `A private Medicare health plan that provides Medicare-covered medical and hospital services but does not include integrated Medicare prescription drug coverage.`
- Category `MA_WITH_RX` (authorizes): **`Medicare Advantage plan with prescription drug coverage`** — `A private Medicare health plan that provides Medicare-covered medical and hospital services and includes Medicare prescription drug coverage.`
- Category `STANDALONE_RX` (authorizes): **`Standalone Medicare prescription drug plan`** — `A separate Medicare prescription drug plan for people who need Part D drug coverage apart from a Medicare Advantage plan.`
- Category `UNSURE_DISCUSS_PROCESS` (does NOT authorize): **`I am not sure / I prefer to discuss the process first`** — `This does not authorize an additional product category. A licensed agent can explain the process before any plan-specific discussion begins.`
- Important: `Important: Completing this Scope of Appointment does not require you to enroll in a plan, does not obligate you to change your current coverage, and does not authorize discussion of product categories you did not select. If you later want to discuss another category, the scope must be updated/documented before that additional plan-specific discussion.`
- Authorization heading: `Authorization`
- Authorization statement: `By signing/affirming below, I confirm that the categories marked above are the categories I authorize for this specific appointment.`
- Read-back heading: `Please confirm what you authorized`
- Read-back intro: `You authorized the licensed agent to discuss only the following at this appointment:`
- Read-back none: `You did not authorize any product category. A licensed agent will explain the process first.`
- Security: `Security: Do not enter Social Security number, Medicare Beneficiary Identifier (MBI), bank/card information, or detailed medical information on this SOA.`
- Field labels: `Beneficiary full name` · `Residence state` · `ZIP code` · `County` · `Appointment date` · `Appointment format` · `Plan/contract year` · `Preferred language` · `SOA Instance ID` · `Beneficiary or authorized representative signature` · `Printed name` · `Relationship/authority if representative` · `Date/time` · `Electronic affirmation method` · `Agent`
- Appointment formats: `Telephone` · `Video` · `In person`

### 4.2 Español

- Title / subtitle / prepared / intro: **the ES object carries the English strings for
  these four keys** (`SCOPE OF APPOINTMENT - {state}`, the English subtitle, the English
  "Prepared…" line and the English intro). A Spanish rendering of these four lines was
  not in the approved template and is an owner approval item (§10).
- Appointment heading: `Cita`
- Categories heading: `Español - Categorías que usted autoriza para esta cita`
- Categories help: `Seleccione solamente los temas que desea autorizar para que el agente licenciado de Clear Point pueda conversar con usted durante esta cita. Puede seleccionar más de uno. Si no está seguro, puede dejar una categoría sin seleccionar y hablar primero con el agente licenciado sobre el proceso antes de autorizar temas adicionales.`
- Category `MA_NO_RX`: **`Plan Medicare Advantage sin cobertura integrada de medicamentos recetados`** — `Un plan privado de salud de Medicare que ofrece servicios médicos y hospitalarios cubiertos por Medicare, pero no incluye cobertura integrada de medicamentos recetados de Medicare.`
- Category `MA_WITH_RX`: **`Plan Medicare Advantage con cobertura de medicamentos recetados`** — `Un plan privado de salud de Medicare que ofrece servicios médicos y hospitalarios cubiertos por Medicare e incluye cobertura de medicamentos recetados de Medicare.`
- Category `STANDALONE_RX`: **`Plan independiente de Medicare para medicamentos recetados`** — `Un plan separado de Medicare para medicamentos recetados para personas que necesitan cobertura de medicamentos de la Parte D aparte de un plan Medicare Advantage.`
- Category `UNSURE_DISCUSS_PROCESS` (no autoriza): **`No estoy seguro / prefiero hablar primero sobre el proceso`** — `Esto no autoriza una categoría adicional. Un agente licenciado puede explicarle el proceso antes de comenzar cualquier conversación específica sobre planes.`
- Important: `Importante: Completar este Scope of Appointment no le obliga a inscribirse en un plan, no le obliga a cambiar su cobertura actual y no autoriza conversar sobre categorías que usted no seleccionó. Si después desea conversar sobre otra categoría, el alcance debe actualizarse/documentarse antes de esa conversación específica sobre planes.`
- Authorization heading: `Autorización`
- Authorization statement: `Al firmar o confirmar a continuación, confirmo que las categorías marcadas arriba son las que autorizo para esta cita específica.`
- Read-back heading: `Por favor confirme lo que autorizó`
- Read-back intro: `Usted autorizó al agente licenciado a conversar únicamente sobre lo siguiente en esta cita:`
- Read-back none: `Usted no autorizó ninguna categoría de producto. Un agente licenciado le explicará primero el proceso.`
- Security: `Seguridad: No escriba su número de Seguro Social, su identificador de Medicare (MBI), información bancaria o de tarjeta, ni información médica detallada en este SOA.`
- Field labels: `Nombre completo del beneficiario` · `Estado de residencia` · `Código postal` · `Condado` · `Fecha de la cita` · `Modalidad` · `Año del plan` · `Idioma` · `SOA Instance ID` · `Firma del beneficiario o representante autorizado` · `Nombre en letra de molde` · `Relación o autoridad si firma un representante` · `Fecha y hora` · `Método de confirmación electrónica` · `Agente`
- Appointment formats: `Teléfono` · `Video` · `Presencial`

Rules pinned around the text: exactly three authorizing categories plus one explicitly
non-authorizing option; no "select all"; nothing pre-ticked; `FORBIDDEN_BARE_ACRONYMS =
['MA', 'MAPD', 'MA-PD', 'PDP']` never alone in customer-facing output (the voice script
assembler is scanned for them too).

**Voice script** (`CP-SOA-VOICE-SCRIPT-CY2027-v0.2`): assembled from the labels,
descriptions, "Important" and authorization statements above, verbatim, plus connecting
sentences (purpose, one-at-a-time prompts, read-back framing, "a no anywhere is a no").
The connecting sentences are new customer-facing wording and are **pending owner
approval**; the full EN/ES text is in `voice-soa.js` and in the owner package.

---

## 5. GoHighLevel field mappings and the evidence storage model

### 5.1 Fields the code writes today (`EXISTING_CRM_FIELDS`, production ids, unchanged)

| Key | Id |
|---|---|
| PREFERRED_LANGUAGE | QULAmkAuVNCQrAMZ487K |
| MEDICARE_STATUS | R510tHz6GFBaqZgN5e5S |
| CONSENT_MARKETING | vPKlhpz6aucJK1U3fJRZ |
| CONSENT_SMS | w1hopBfNLGauFRRzQ71l |
| CONSENT_CALLS | mHdpDjBSA76lQJrKoixL |
| CONSENT_EMAIL | ykiTUcsu3nvawK39hmll |
| CLIENT_AGE | GSss3tRLKg8mNCzEv3D9 |
| CALCULATED_AGE | HoYmwc19InLwUwXNyKcr |
| LEAD_QUALITY_FLAGS | qGryQuR67jXFFVRFBLkz |
| CHAT_CONVERSATION_SUMMARY | 6vSP5DJvAc6Jl9BXg409 |
| BEST_TIME_TO_CALL | PpDDusEEsMz4xNIcrwRW |
| MEDICARE_INTEREST | fLxx7s1GpVJYlxJl08G6 |

### 5.2 CY2027 fields (`CY2027_FIELD_KEYS`, 36 keys) — **created and mapped 2026-10-29**

Created in the production sub-account with `node scripts/cy2027-provision-crm-fields.mjs
--apply` (already present 0, created 36, refused 0); the printed map was validated with
`fieldIdConfig()` (36 ids, `refused: {}`) and set as `CY2027_CRM_FIELD_IDS` in the Vercel
**Production** environment (the Preview target was not set: previews carry no CRM token,
so they cannot write to the CRM anyway). Contract probe, same day: a throwaway contact
created through the GoHighLevel API with the handler's own serializer
(`existingField()` + `buildCustomFields()`, `{id, key, value}` entries) answered 201,
`LEAD_TRUST_STATE = UNVERIFIED`, `RETENTION_CLASS = GENERAL_CRM`,
`DATA_SENSITIVITY_CLASS = CONTACT_PII` were read back exactly, and the contact was deleted
(200). **Not verified:** a lead submitted through the live site reaching the CRM with
these fields — the handler rejects every fictional phone pattern and the agency's own
numbers already belong to contacts, so no safe test number was available; the owner can
verify with one real lead from the site and a look at the contact's CY2027 fields. Ids:

`contact.soa_id`, `soa_appointment_id`, `soa_plan_year`, `soa_status`, `soa_method`,
`soa_language`, `soa_language_source`, `soa_state`, `soa_zip`, `soa_county`,
`soa_authorized_categories`, `soa_declined_categories`, `soa_form_version`,
`soa_script_version`, `soa_completed_at`, `soa_supersedes_id`, `soa_revoked_at`,
`soa_evidence_uri`, `soa_integrity_hash`, `recording_notice_status`,
`callback_consent_status`, `callback_consent_at`, `callback_consent_scope`,
`ai_outbound_consent_status`, `residence_state`, `state_ruleset_version`,
`cms_ruleset_version`, `lead_trust_state`, `channel_verification_status`,
`human_security_review_status`, `carrier_overlay_status`,
`licensed_agent_review_required`, `data_sensitivity_class`, `retention_class`,
`self_reported_medicaid_status`, `self_reported_lis_status`.

`SOA_ID` IBxnJOh71dyOB2Z0Eodt · `SOA_APPOINTMENT_ID` 3vcBf003PkWvBDsUPgU4 · `SOA_PLAN_YEAR`
O2QqfmKJuk2lpqGFFaeP · `SOA_STATUS` aL8JFiT6RdXENMQd59tA · `SOA_METHOD` 1uedzX9v2EyNZbOZ0Mlu ·
`SOA_LANGUAGE` 8QhYQU6Ef4YwiAfg3ba1 · `SOA_LANGUAGE_SOURCE` GqLGTOJxuIlVVB9AdFWs · `SOA_STATE`
lGkMAmg72SASBUknxi11 · `SOA_ZIP` 73qFmnpGzq5Hx2B4ObDS · `SOA_COUNTY` 1Zem92TLsyadRuC4J7sV ·
`SOA_AUTHORIZED_CATEGORIES` 5ZaLNBs2veAy8u3tH4Hj · `SOA_DECLINED_CATEGORIES` 0emudNKbXTCHBgxmrZjU ·
`SOA_FORM_VERSION` hj8GATSapCu2ZtmovIHW · `SOA_SCRIPT_VERSION` U8RZv6Cd1vIdunZojK2d ·
`SOA_COMPLETED_AT` 9NgGWDkIwzvuX0C2HDMu · `SOA_SUPERSEDES_ID` JMguEJtIdiOxPrbD4GGJ ·
`SOA_REVOKED_AT` DuT2HMQsB651pDXrrTjz · `SOA_EVIDENCE_URI` EpHXxvX5u0GtRn3B0Whq ·
`SOA_INTEGRITY_HASH` F9253LGvmJlQCoBDAo3n · `RECORDING_NOTICE_STATUS` Hhn72DHvm04ccb2Ao2US ·
`CALLBACK_CONSENT_STATUS` fPVNfFLJL9pzB9aM2lqE · `CALLBACK_CONSENT_AT` axKUzekIyn7JKdfZHY3K ·
`CALLBACK_CONSENT_SCOPE` HOxaWD66rlLfWB6wTyRp · `AI_OUTBOUND_CONSENT_STATUS` dR6knqkOKtSqTaQpNP5Z ·
`RESIDENCE_STATE` TbgRTwbD5fB9lopv6y5c · `STATE_RULESET_VERSION` afLnnPxOA012GyhQhUJg ·
`CMS_RULESET_VERSION` ocWmF9Ep7hPRa1wU3xJM · `LEAD_TRUST_STATE` 7DzFMZs3LJ6whU7mK6Tr ·
`CHANNEL_VERIFICATION_STATUS` efMLBn3SmCUuGSNQlX1G · `HUMAN_SECURITY_REVIEW_STATUS`
XqE6VKhziAjGCzowCqz7 · `CARRIER_OVERLAY_STATUS` cedsftnNrnWMZAPF8J6p ·
`LICENSED_AGENT_REVIEW_REQUIRED` JXRiSpBbMXEtxUPXmYjY · `DATA_SENSITIVITY_CLASS`
f7NW1WH7SkfkOnPA5jZc · `RETENTION_CLASS` DocZFsk9r318WiYeAyhB · `SELF_REPORTED_MEDICAID_STATUS`
iKdHRcCKg6xCyPmPrU4j · `SELF_REPORTED_LIS_STATUS` N3Z1tu9uisnuNKQ6LxRe.

Mapping rules enforced in code: a key is written only when `CY2027_CRM_FIELD_IDS` gives
it an id; an id that equals one of the twelve production ids (`IN_USE`) or is given to two
keys (`SHARED`) is refused and `npm run preflight` blocks naming it; `CONFIRMED_ONLY_FIELDS`
and `PROVENANCE` prevent an inferred value from overwriting a beneficiary's confirmation;
unmapped keys are logged on every signature and carried in the contact note.
`node scripts/cy2027-provision-crm-fields.mjs` reports what is missing; `--apply` creates
the fields and prints the map — **owner action, not run**.

### 5.3 Evidence model

- **Evidence record** (`evidence.js`, `buildEvidenceRecord()`): the instance (state,
  ZIP, county, appointment id/date/format, plan year, language and its election source,
  representative relationship, categories authorized and declined, script and form
  versions, state and CMS ruleset versions, signature, signed-at, method) → canonical
  serialization → `INTEGRITY_HASH` (sha256). For `VOICE_RECORDED` the voice block
  (recording reference, transcript pointer, segment start/end, script version + digest +
  approval, language election, per-category reply classification, contact and
  appointment references) is **inside** the hash and the record cannot be built without
  it. Tampering with any field is detectable (suite-asserted).
- **Printed evidence fields** (`SOA_EVIDENCE_FIELDS`): `SOA_ID`, `SOA_FORM_VERSION`,
  `STATE_RULESET_VERSION`, `LANGUAGE`, `CREATED_AT`, `COMPLETED_AT`, `SOURCE`,
  `APPOINTMENT_ID`, `INTEGRITY_HASH`, `EVIDENCE_REFERENCE`.
- **Write order** (`api/sign-soa.js`): evidence record + signed PDF → durable store
  (`putEvidence()` at `soa-evidence/{year}/{state}/{soaId}-{hash16}.pdf`) → only then
  `COMPLETED`; a failed write answers 503 `SOA_EVIDENCE_NOT_STORED` and the marketing gate
  stays locked. The signed instance goes to `soa-signed:<soaId>` with the `SOA_EVIDENCE`
  retention class (6 years), not the link's 24-hour TTL.
- **Stores** (SECOPS §3): KV `soa-lead:*` 24 h, `soa-link:*` 24 h, `soa-signed:*` and
  `soa-appointment:*` 6 years, `soa-appointment-lock:*` 60 s, OTP slots 1 h, limiter
  windows — **KV is not configured in production, so today these live in one instance's
  memory**; evidence store **not configured**; GoHighLevel note with the text record and a
  note carrying the PDF; Vercel logs `[SOA-AUDIT]` / `[AI-AUDIT]`, no drain. Nothing is
  backed up by this project; **restore tested: NOT DONE** for every store.
- **Retention and holds**: §1 table; `mayPurge()` refuses inside the period, under a
  hold, or when the class period is unknown.

---

## 6. Consent matrix and state ruleset mapping

### 6.1 Consent objects (`consent.js`)

| Object | Captured by | Status values | Never inferred from (`NEVER_INFER_FROM`, verbatim) |
|---|---|---|---|
| `RECORDING_NOTICE` | Voice agents, inside the greeting, once (V2.3) | `NOT_ASKED` / `GRANTED` / `DECLINED` / `UNCLEAR` / `REVOKED` | `CALLBACK_CONTACT_PERMISSION`, `SCOPE_OF_APPOINTMENT`, `WEBSITE_SUBMISSION` |
| `CALLBACK_CONTACT_PERMISSION` | TCPA checkbox (Smart Review step 6), Clara's `contactConfirmed`; text version `2026-06-01`, scope `DISCUSS_MEDICARE_PLAN_OPTIONS` | same | `RECORDING_NOTICE`, `SCOPE_OF_APPOINTMENT`, `PRIOR_CUSTOMER_RELATIONSHIP` |
| `SCOPE_OF_APPOINTMENT` | The SOA instance itself | same | `CALLBACK_CONTACT_PERMISSION`, `TELL_ME_EVERYTHING`, `WEBSITE_BROWSING` |
| `AI_OUTBOUND_VOICE_CONSENT` | No handler or component captures it today (only the CRM key `ai_outbound_consent_status` exists) | same | `CALLBACK_CONTACT_PERMISSION`, `GENERIC_YOU_MAY_CALL_ME` |

`NEVER_INFER_FROM` is exercised by the suite (e.g. "SOA may not be inferred from callback
permission", "callback permission may not be inferred from a prior relationship");
`NOT_AFFIRMATIVE_ALONE` lists words that never grant on their own ("ok", "sure", "mhm",
"claro", "vale" …); a reply is
classified per consent **type** (a recording notice cannot authorize an outbound call —
2026-10-02 red-team fix). Outbound purposes are checked against the scope the wording
states: the production wording authorizes plan discussion, **not** a
`SECURITY_REQUEST_VERIFICATION` call (owner legal reading pending, §10). Revocation
mirrors to the CRM and withdraws the stated scope (CE-09, CRM-15).

### 6.2 State rulesets (`state-rules.js`) and CMS ruleset (`rulesets.js`)

| State | Ruleset | Form version | Effective | Lifecycle | Promotion | Recording notice |
|---|---|---|---|---|---|---|
| NY | `NY-CY2027-v1.0` | `CP-SOA-NY-CY2027-v1.0` | 2026-10-01 | `PRODUCTION_ACTIVE` | `NO_PROMOTION_ON_RECORD` | one-party (position of record, `OWNER_COUNSEL`) |
| NJ | `NJ-CY2027-v1.0` | `CP-SOA-NJ-CY2027-v1.0` | 2026-10-01 | `PRODUCTION_ACTIVE` | `NO_PROMOTION_ON_RECORD` | one-party (position of record, `OWNER_COUNSEL`) |
| CT | `CT-CY2027-v1.0` | `CP-SOA-CT-CY2027-v1.0` | 2026-10-01 | `PRODUCTION_ACTIVE` | `NO_PROMOTION_ON_RECORD` | all-party (Conn. Gen. Stat. §52-570d, `OWNER_COUNSEL`) |
| other | unsupported | — | — | — | — | form refuses |

`CMS_RULESET_2027-v1.0`: advance wait 0 hours; SOA must precede the appointment;
in-person requires a written SOA; non-in-person allows recorded; no universal standing
SOA; TPMO disclaimer without SHIP reference and with organization/product counts
required; five §36 source reviews with `verifiedOn = null`. The ruleset is a **required**
argument of every gate (omitting it refuses; 2026-10-02 fix). `CMS_RULESET_2028-v0.0`
has no rule values; `npm run preflight` counts down to 2027-10-01 and blocks inside 120
days.

---

## 7. Carrier overlay registry (`carrier-overlay.js`, module-private)

Plan year 2027 for every row. No row permits carrier-specific work; `canDiscussCarrier()`
refuses all ten by name through `overlayGateDecision()`, and a verified status over an
unverified state list is refused `STATES_UNVERIFIED`. Nothing in the public layer can
import the registry (barrel export removed 2026-10-02; firewall assertions in the suite).

| Carrier | States (status of the list) | Overlay status | Evidence source (spec §36) |
|---|---|---|---|
| Aetna | NY, NJ, CT (UNVERIFIED) | PENDING_PRIVATE_VERIFICATION | aetna.com producer agreement PDF |
| UnitedHealthcare | NY, NJ, CT (UNVERIFIED) | PENDING_CURRENT_YEAR_VERIFICATION | none given — obtain |
| Wellcare/Centene | NY, NJ, CT (UNVERIFIED) | PENDING_CURRENT_YEAR_VERIFICATION | wellcare.com broker application-and-enrollment |
| EmblemHealth | NY (UNVERIFIED) | PENDING_CURRENT_YEAR_VERIFICATION | emblemhealth.com broker Medicare toolkit |
| Clover Health | NJ (STATED_BY_SPEC) | PENDING_CURRENT_YEAR_VERIFICATION | cloverhealth.com brokers plan-documents-enrollment |
| ConnectiCare | CT (STATED_BY_SPEC) | PENDING_CURRENT_YEAR_VERIFICATION | connecticare.com brokers Medicare broker toolkit |
| Healthfirst | NY (UNVERIFIED) | PENDING_PRIVATE_VERIFICATION | healthfirst.org/brokers |
| Fidelis | NY (UNVERIFIED) | PENDING_PRIVATE_VERIFICATION | none given — obtain |
| HealthSpring/HCSC | NY, NJ, CT (UNVERIFIED) | PENDING_CURRENT_YEAR_VERIFICATION | none given — obtain |
| Anthem/Empire | NY, CT (UNVERIFIED) | PENDING_CURRENT_YEAR_VERIFICATION | none given — obtain |

The exact URLs are in the module (`evidenceSourceUrl`). Marking any row verified is a
reviewed change by a named person; the legacy 48-hour wording must never be copied into
CY2027 logic.

---

## 8. Security threat model and remediation evidence

The full model (assets A1–A8, actors, each §30/§31 attack with its control and the
assertion that proves it, residual risks) is `CY2027-SECURITY-OPERATIONS.md` §1.
Summary of the controls and their evidence:

| Attack | Control | Proving evidence |
|---|---|---|
| Token guessing / enumeration of `/soa/:token` | 256-bit token, store keyed by hash, GET returns no personal data, second factor (last 4 or one-time code), view and attempt caps, per-IP limits | main suite "status rate-limits the factor attempt harder than the probe"; qa-matrix suite drives the three handlers past their caps (6th issue → 429 + Retry-After, 61st probe → 429, 11th factor → 429, 4th sign → 429) |
| Scope widening by crafted payload | Instance built server-side; browser versions are claims compared, never recorded; plan year from the server clock | main suite section 12 (CY2027-SRV-01) |
| Voice-only SOA unlocking an in-person appointment (§33 immediate fail) | `resolveFormat()` treats `in_person`, `In Person`, `HOME_VISIT`, missing or unknown as in person; write stage refuses `IN_PERSON_REQUIRES_WRITTEN_SOA` | main suite "voice-only SOA does NOT unlock an in-person appointment"; voice suite through `buildEvidenceRecord` |
| Carrier data reaching the public layer | Module-private registry; `assertPrivateContext()`; barrel export removed | firewall assertions; QA-20 |
| Self-approval by an automation (`AI-Agent`, `svc_bot`, `claude`) | `humanActorProblem()` is the one human-actor rule for every approval, promotion, review | learning / yearly / voice suites |
| SMS bombing through OTP resend | Atomic SET-NX-TTL claims; `OTP_STORE_UNAVAILABLE` → 503 | verifyflow suite: 8 parallel resends → 1 delivered; 8 parallel issues → 5 |
| Sensitive data in logs / CRM notes | `redactForLog` over arrays and nested keys; DM-09 filter on notes, flags, interest field | 2026-10-02 round (`ssn_number`, `people[0].ssn`); sensitivity suite |
| "Yes to everything" / "yes, not that one" as authorization | One affirmative per category; `VOICE_NEGATIVE_TOKENS`; unsure selects nothing | voice suite (33 negated phrases, capture chain); QA-01 web |
| Runtime self-modification of governing objects | `check-no-self-modification.mjs`: allow-listed modules, no `eval`/`new Function`, 50/50 objects frozen, no runtime write in 140 files | build gate output 2026-10-27 |
| Approved text drift | Digests pinned for SOA text, voice script, TPMO, consent wording, knowledge release, letter | `check-cy2027-parity.mjs` (14 checks) |

Red-team rounds in this engagement (each finding re-run by a different agent before it
counted; each fix pinned by an assertion; mutation runs prove the assertions bite):

| Round | Findings reproduced | Repaired | Mutation evidence |
|---|---|---|---|
| 2026-10-02 (6 lenses) | 37 (9 critical, 22 high, 4 medium, 2 low) | 37 | targeted removals fail the suite |
| 2026-10-03 (G08, TPY-09) | 11 + 4 mutants passing source-grep assertions | all | 46/46 killed |
| 2026-10-04 rounds (supersession, CRM registry, knowledge, data, trust, sensitivity, consent) | per commit log | all | per round |
| §12 verification flow (`a7c6e9b`) | atomic claims, purpose, price regex, letter binding | all | 21/21 killed |
| Voice SOA (`6459572`) | 10 (1 high, 2 medium, 7 low; 9 reproduced) | 10 | 27 (red team, on copies) + 24/24 killed |
| QA matrix (`a650129`) | 6: 2 medium + 1 low reproduced (QA-12 PASS rested on a source grep; QA-04 form wiring neutered unseen; citation checker accepted any literal); 2 medium + 1 low not reproduced | 3 fixed at the root; of the 3 not reproduced, the `.d.ts` one is resolved by the same root fix (`jurisdictionAfterLanguageChange()` now exists), and W5 / QA-16 / QA-25 keep PASS on their code half with the gap (G-W5) and the "definitions only, agents do not execute them" limitation stated in the matrix | 22/22 + 24/24 killed |

Production security headers were measured live on 2026-10-02 (ARCHITECTURE §8.3, all
present). **Does not exist:** external penetration test, DAST, CI, secret-scanning hook,
WAF rule. **Operational finding:** the shell where the suites run carries real
`HIGHLEVEL_TOKEN`, `OPENAI_API_KEY` and `HIGHLEVEL_LOCATION_ID` (presence check only;
suites neutralise them with fetch doubles and dummies, and the local harness refuses a
non-`local-` token) — recommendation in SECOPS §7: remove them from the test environment,
keep secrets only in the Vercel project, rotate if ever printed.

---

## 9. QA report

The case-by-case table (test id, spec case verbatim, expected, actual, evidence as
`scripts/<suite>.mjs :: <assertion label>`, status) is `CY2027-QA-MATRIX.md`. It covers the
25 spec §31 cases and the 12 website gates W0–W11; rows whose voice-agent or GoHighLevel
half cannot be exercised from this repository are split and that half is never PASS.
A suite (`test-cy2027-qa-matrix-2026-10-04.mjs`) parses the document on every `npm test`
and fails if a cited suite is not one the battery runs or a cited label is not an executed
assertion in it (the checker was observed failing on 14 defective matrices first).

Status totals (counted from the document, 2026-10-27): **33 PASS · 3 FAIL · 11 NOT
TESTABLE HERE.**

The three FAIL rows are product or configuration gaps, recorded with options, not
redesigned: **W6** SOA channel choice (web / secure SMS / secure email / agent first) does
not exist; **W9** receipt without a beneficiary copy and without a filed PDF (copy flag
off, no channel, evidence store unconfigured); **W11** licensed-agent workspace not built.
Order and wording gaps G-W1, G-W4, G-W5, G-W10 are owner decisions listed in matrix §3.

NOT TESTABLE HERE rows and who can test them: Emely/Sofía behaviour on live calls
(QA-01b, 02b, 07b, 08b, 10b, 16b, 19b, 25b — owner, recorded test calls per the voice
package), GoHighLevel revocation and booking behaviour (QA-18b, W10b — owner, test
sub-account), accessibility (QA-23 — assistive-technology QA on a preview).

Executed evidence on 2026-10-27 (final tree `a650129`):

| Check | Result |
|---|---|
| `npm test` (`scripts/run-battery.mjs`) | 54/54 suites passed, exit 0 |
| `test-cy2027-2026-10-01.mjs` (main) | 1281 passed, 0 failed |
| `test-cy2027-benefit-self-report-…` | 503 / 0 |
| `test-cy2027-ftq-…` | 249 / 0 |
| `test-cy2027-knowledge-…` | 153 / 0 |
| `test-cy2027-learning-…` | 856 / 0 (governing-object pin 50) |
| `test-cy2027-sensitivity-…` | 268 / 0 |
| `test-cy2027-supersession-…` | 333 / 0 |
| `test-cy2027-verifyflow-…` | 320 / 0 |
| `test-cy2027-voice-…` | 593 / 0 |
| `test-cy2027-yearly-…` | 474 / 0 |
| `test-cy2027-qa-matrix-…` | 133 / 0 |
| `npm run build` | exit 0; all gates OK; `tsc` + `vite` OK; prerender 46/46 routes, TPMO verified against the CY2027 variant; sitemap files restored after the run |
| `check-no-self-modification.mjs` | 56 api files allow-listed; 50/50 governing objects frozen; no runtime write in 140 files |
| `check-cy2027-parity.mjs` | OK — SOA text, TPMO, consent wording v2026-06-01, knowledge release `CP-UMKE-CY2026-v1.0` each match their pinned digest |
| Production read-only probe (2026-10-27, before promotion) | home page serves the CY2026 TPMO sentence (3 SHIP occurrences), bundle `index-jgWGDRt6.js`; `/api/soa-status` → 403 |
| Vercel preview build of `4be5afa` (2026-10-29) | all gates ran in Vercel's build (parity 14/14, self-modification 50/50, prerender 46/46 with the CY2027 TPMO, sitemap), "Build Completed in 23s"; preview verified through the SSO share cookie: bundle `index-C9yqRwo0.js` = local, TPMO EN/ES, 0 SHIP, headers present, `/api/soa-status` 403, `/api/opt-out {}` 400, `/api/chat` 200 with a correct answer |
| Production after `vercel promote` (2026-10-29) | same bundle and TPMO on 46/46 served pages (`cy2027-preflight.mjs --url`), headers present, `www` 308 → apex, `/api/soa-status` 403 / 503 `SOA_DISABLED`, opt-out 400, chat 200, submit-lead rejects a 555 number with 400; GoHighLevel field contract probed and the throwaway contact deleted (§5.2) |
| Not verified after promotion | a lead from the live site landing in the CRM with CY2027 fields (no safe test phone); Clara/Zara and Smart Review in a browser; the chat `[AI-AUDIT]` lines in the Vercel function logs |

To re-run: `npm test`, `npm run build` (then `git checkout -- public/sitemap.xml
scripts/sitemap-dates.json`), `node scripts/<suite>.mjs` for any single suite.

---

## 10. Known limitations and PENDING_PRIVATE_VERIFICATION — nothing hidden

Owner-supplied or owner-decided (the layer refuses until each is recorded):

1. **TPMO counts** — real FMO-confirmed integers in all three sources; never guessed.
2. **Ruleset promotion attestation** — a person in `CY2027_REVIEWERS` reviews the §36
   sources, fills `promotion` on `CMS_RULESET_2027` and the three state rulesets with
   verification dates, then flips `rulesetPromotionAttested`.
3. **`CY2027_REVIEWERS`** — unset; every quarantine resolution, hold release, ruleset step,
   source verification and learning step is refused by design until set.
4. **Evidence store** — set `CY2027_EVIDENCE_STORE_URL/_TOKEN`, verify with
   `node scripts/cy2027-verify-evidence-store.mjs`, name a backup owner, perform and record
   a restore test (NOT DONE everywhere), then flip `signedPdfPersisted`.
5. **Vercel KV / Upstash** — not configured in production (quoted from `rate-limit.js`
   notes of 2026-08-13, **not re-verified here**); rate limits, OTP caps and link/signed
   records are per-instance memory today. Provision before any activation.
6. **GoHighLevel CY2027 fields** — create with `cy2027-provision-crm-fields.mjs --apply`,
   set `CY2027_CRM_FIELD_IDS`; each key its own new field. The `dual` option no longer
   writes `medicare_status` — any workflow or smart list filtering on it stops matching
   new leads (check before deploying).
7. **Voice SOA** — approve script v0.2 (status `APPROVED`, named `approvedBy`,
   `approvedOn`, re-pin `VOICE_SCRIPT_DIGEST` in the same commit); legal sign-off on a
   recorded SOA for telephone/video in NY/NJ/CT; build the receiving endpoint (must also
   refuse a second COMPLETED instance over one `recordingReference` and compare the
   contact reference — **not implemented**, the block carries both fields); verify the
   agents' tools in GoHighLevel against package §6; only then flip `VOICE_SOA_ENABLED` and
   paste the Layer-B addendum. Policy decisions: whether the shared classifier should also
   treat "not / never / wrong / incorrect / nunca / tampoco" as negative on the web/chat
   paths; hedged affirmatives ("yes I think so"); free text persisted inside the hashed
   record.
8. **Verification letter `CP-VL-2026-10-04-v1`** — approve by editing
   `VERIFICATION_LETTER.approval` with a named person, a past day and
   `textDigest = letterTextDigest(VERIFICATION_LETTER)`. Mailing is a staff action.
9. **Consent scope for a verification call** — the production wording covers plan
   discussion; whether it covers a `SECURITY_REQUEST_VERIFICATION` call is the owner's
   legal reading, to be written into the rule by name if so.
10. **One-time code** — choose SMS or email provider, configure `CY2027_OTP_*`, wire the
    CRM's callback-consent state into `deps.otpConsentBasis` and the resend path, then flip
    `CY2027_SEND_OTP`.
11. **Beneficiary copy** — channel + consent + `CY2027_SEND_BENEFICIARY_COPY`.
12. **Quarantine stop** — `CY2027_QUARANTINE_STOP` unset; the trust engine changes no
    routing today. G-W5: `soa-token` issues a link without the trust verdict.
13. **Website gaps** — G-W1 order, G-W4 Smart Review CTA wording ("Required by CMS
    422.2264 before advisor contact" conflates SOA with contact permission; unreachable
    while `SOA_ENABLED = false`), G-W6 channel choice, G-W10 booking procedure, G-W11
    workspace.
14. **Carrier overlays** — all ten pending; eight state lists unverified; four carriers
    have no spec source URL.
15. **Spanish title / subtitle / prepared / intro** of the SOA — the ES object carries the
    English strings; approve a Spanish rendering or confirm English is intended.
16. **Knowledge body** — `CP-UMKE-CY2026-v1.0`, approval not recorded, tagged plan year
    2026; a CY2027 review by a named person is pending.
17. **Recording-notice positions** (NY/NJ one-party, CT all-party) and **breach
    notification duties** (SECOPS §2) — for counsel; the code carries positions, not
    conclusions.
18. **`ENROLLMENT_RECORD` retention period** — unknown; never purged while null.
19. **ZIP→county dataset** — not installed; the beneficiary is asked.
20. **Signature audit actor** — every signature is audited `beneficiary:channel-verified`
    including last-4 factors; the status endpoint distinguishes, the signer does not.
21. **Candidate-learning store and review queue** — not built; candidates are log lines.
22. **CY2028 ruleset** — placeholder by design.
23. **External penetration test, CI, DAST** — do not exist; spec §30 requires a pentest
    before launch.
24. **Real credentials in the test shell** — remove; rotate if ever printed.

Not verified in this engagement (and the check that would verify it):

- Anything against production, a preview deployment, Vercel KV, the evidence store,
  GoHighLevel or a live call — by design, no network from the agents. Verify on a preview
  after the owner's GO.
- Real Upstash SET-NX atomicity (asserted on the memory tier through the same code path)
  — one parallel-resend run against a provisioned KV.
- The Vercel `handler(req, res)` contract for the handlers driven in process — one request
  per handler on a preview.
- The SOA form in a DOM (no jsdom / testing-library in the project): transitions are
  verified by calling them, wiring structurally — on a preview with `SOA_ENABLED`
  temporarily true, tick both acknowledgements under New York, switch to New Jersey,
  confirm both clear and the name field empties.
- Model reply behaviour (QA-07 paraphrases, QA-08b "does not probe") — not pinned by any
  assertion; a recorded test-call review.
- The eslint configuration ignores `scripts/` suite files, so lint evidence covers `api/`
  and `src/` only.
- GoHighLevel's answer to a stale custom-field id on a live create — one test lead on a
  preview after mapping.

---

## 11. Cost changes before activation

No prices are stated: none was read from a source, and inventing one would be
fabrication. None of these has been activated. Full table: SECOPS §5.

| Item | Needed for |
|---|---|
| Vercel KV / Upstash Redis | shared rate limits and OTP caps, durable lead/link records, 6-year signed record and ledger |
| Evidence object store (HTTPS, token) and egress | evidence record + signed PDF; `signedPdfPersisted` |
| One-time code delivery (SMS and/or email provider) | `CY2027_SEND_OTP`; per message |
| Beneficiary copy channel | `CY2027_SEND_BENEFICIARY_COPY`; per message |
| GoHighLevel custom fields | the 36 CY2027 keys (plan limit on custom fields not verified) |
| Log drain / retained log storage | durable audit trail beyond the plan's log window |
| External penetration test | spec §30 before launch |
| Model usage | unchanged — the SOA flow calls no model |

---

## 12. Rollback

Production is `dpl_BiQKWLqpdU5VTdSBPc8nwLVgmXMo` (`clearpoint-deploy-a263o0q19`, commit
`4be5afa`, promoted 2026-10-29). **The rollback point is the previous Production
deployment `https://clearpoint-deploy-j1l0wc0fn-sawil-reyess-projects.vercel.app`**
(commit `50eb408`, 2026-09-27, `isRollbackCandidate: true`), which restores the CY2026
TPMO sentence. Exact steps (matching `docs/conversational-platform/DEPLOYMENT.md` and
`ROLLBACK.md`; SECOPS §4):

1. `git push` builds a **preview only**. Production changes only through
   `vercel promote <deploymentUrl> --scope sawil-reyess-projects --yes` with the global
   authenticated binary (`%APPDATA%\npm\vercel`; never `vercel deploy --prod` from the
   repository folder). A promote rebuilds with the production environment.
2. **Roll back = promote the previous Production deployment again:**
   `vercel ls clearpoint-deploy --scope sawil-reyess-projects` → prior Production row →
   `vercel promote <priorProductionUrl> --scope sawil-reyess-projects --yes`.
3. **Verify after every promote:** bundle hash local == live
   (`curl -s https://clearpointsenioradvisors.com/?cb=<ts> | grep -o 'index-[^"]*\.js'`);
   `POST /api/opt-out {}` → 400; one `/api/chat` probe with an `Origin` header; security
   headers present; whatever the change touched.
4. **Kill switches without a deploy** (set the variable, re-promote): `CP_KILL_AI`,
   `CP_KILL_ALL`, `LLM_PROVIDER`, `OPENAI_REASONING_EFFORT=off`; Turnstile keys absent =
   off. `SOA_ENABLED` is a code constant: turning the SOA flow off is a revert + promote.
5. **Code rollback on the branch:** `git revert <sha>` of the commit(s) in question, then
   the owner's promote. There is no data migration in this range to undo.
6. **Voice (GoHighLevel):** nothing was applied. If the owner applies the Layer-B addendum
   later: paste the backed-up prompt from `docs/voice/backups/` into the agent and save;
   5–10 minutes to propagate; never edit without the backup step.
7. **CRM fields (created 2026-10-29):** the 36 fields are additive and hold no data until
   a lead or signature writes them; unmapping is `vercel env rm CY2027_CRM_FIELD_IDS
   production` + re-promote (the code then logs the gap and writes nothing to them);
   deleting the fields themselves is an owner action in GoHighLevel.

---

## 13. Owner GO package (what unblocks the status)

In the order the gates need them: (1) ~~deploy GO~~ **done 2026-10-29** (`4be5afa`
promoted); (2) TPMO counts; (3) `CY2027_REVIEWERS` and the ruleset attestation;
(4) evidence store credentials + round-trip + restore test; (5) KV provisioning;
(6) ~~GoHighLevel field creation and the id map~~ **done 2026-10-29**; (7) Spanish
title/intro approval; (8) voice script v0.2 approval and legal sign-off; (9) letter
approval; (10) consent-scope legal reading; (11) counsel items (recording notice, breach
duties); (12) external pentest on a preview; (13) only then `SOA_ENABLED` and a production
promote with the §12 verification steps. Also open: one real lead from the live site to
confirm the CRM write with the CY2027 fields, and the `dual` option no longer writing
`medicare_status` (check GoHighLevel workflows and smart lists that filtered on it).

Until (2)–(4) are recorded, `assertSoaEnablementSafe()` will refuse to let
`SOA_ENABLED = true` build — the status stays **BLOCKED-COMPLIANCE** by construction, not
by opinion.

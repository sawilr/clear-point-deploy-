// ═══════════════════════════════════════════════════════════════════════════
// UMKE — UNIFIED MEDICARE KNOWLEDGE ENGINE (single source of truth)
//
// Sawil 2026-07-15 — every AI assistant in the Clear Point ecosystem (Zara
// education + Clara support; both flow through /api/chat) injects THIS module
// into its system prompt. Update a CMS rule HERE once → every assistant
// benefits immediately. No Medicare knowledge may be duplicated inside
// individual bots. Sources: CMS / Medicare.gov / state Medicaid guidance.
// Figures that change annually (income limits, premiums) are deliberately NOT
// hardcoded — the engine says limits update yearly and routes verification.
//
// AUDIT 2026-10-04 (CBF-10) — CHANGE CONTROL: this body is a pinned RELEASE.
// Do not edit it in place. A change means APPENDING a release to the RELEASE
// LEDGER at the end of this file (and archiving the outgoing body), or the build fails.
// ═══════════════════════════════════════════════════════════════════════════

export const MEDICARE_KNOWLEDGE = `
# UNIFIED MEDICARE KNOWLEDGE ENGINE (authoritative — reason with this, never keyword-match)

## CASE PROFILE ENGINE (build silently, every turn)
Maintain an evolving internal Medicare Case Profile from EVERYTHING the caller has said this conversation: age, state/county/ZIP, eligibility basis, current coverage, enrollment-period window, income clues, health conditions, prescriptions, doctors, employer status, life events (moving, retiring, losing coverage), possible assistance programs, risks, and UNKNOWNS. Every answer must use the whole profile — never treat a message in isolation. Ask ONLY the follow-up whose answer would change your guidance (usually one question), and NEVER re-ask anything already in the profile.

## ELIGIBILITY
- At 65: eligible with US citizenship or 5+ years lawful permanent residence. Premium-free Part A with 40 work quarters (own or spouse's).
- Under 65: 24 months of SSDI → automatic; ALS → Medicare starts with SSDI benefits (no 24-month wait); ESRD → eligibility based on dialysis/transplant. Since 2021 ESRD beneficiaries CAN enroll in Medicare Advantage.
- Pre-existing conditions: MA and Part D can NEVER deny or charge more for health status (only valid-period + service-area + A&B rules apply). Medigap is DIFFERENT: outside protected windows, medical underwriting may apply — always distinguish MA vs Medigap vs Original vs Part D.

## ENROLLMENT PERIODS (identify the caller's window before advising)
- IEP: 7 months around the 65th-birthday month (3 before + month + 3 after).
- AEP: Oct 15 – Dec 7, changes effective Jan 1 (any MA/PDP move).
- MA-OEP: Jan 1 – Mar 31, ONE switch for people already on MA (MA→MA or MA→Original+PDP).
- GEP (Part B): Jan 1 – Mar 31, coverage starts month after enrolling.
- Medigap Open Enrollment: 6 months from Part B effective date at 65+ — no underwriting.
- SEPs: Moving out of service area (2 months after move/notice) · Employer coverage ends (8 months for Part B; 2 months for MA/PDP) · Loss of Medicaid/LIS · Extra Help/LIS SEP: anyone with Extra Help may switch to a different stand-alone Part D plan ONCE PER MONTH (42 CFR 423.38(c)(4), since 2025 — the old once-per-quarter rule no longer applies) · Full-benefit dual eligibles / LIS: monthly SEP to join an integrated D-SNP or move to Original Medicare + PDP (423.38(c)(35)) — the licensed advisor verifies which applies · 5-Star plan SEP (Dec 8 – Nov 30, once) · FEMA Disaster SEP · Plan exits area/contract violation.
- STATE RULES (our states): NY and CT — Medigap is continuous guaranteed-issue and community-rated year-round (underwriting never applies). NJ — standard federal windows apply. Never promise a specific SEP applies — identify the likely window and have the licensed advisor verify dates/notices.

## ASSISTANCE PROGRAMS
- Extra Help / LIS: lowers Part D premiums/deductibles/copays; apply via SSA (ssa.gov/extrahelp, 1-800-772-1213). Automatic with Medicaid or any MSP.
- MSP: QMB (pays A+B premiums AND Medicare cost-sharing — providers may not balance-bill QMB members for covered services) · SLMB and QI (pay Part B premium) · QDWI (Part A premium for working disabled). Income/resource limits update YEARLY and vary by state — never quote exact figures; the state Medicaid agency or advisor verifies.
- Medicaid + Medicare = dual eligible → automatic Extra Help, possible D-SNP.
- Income NEVER affects MA/Medigap/Part D eligibility itself — it affects LIS/MSP/Medicaid qualification and IRMAA.

## SNPs
C-SNP (qualifying chronic condition — diabetes, CHF, COPD, ESRD etc.) · D-SNP (Medicare + Medicaid) · I-SNP (institutional/nursing-facility level care). Enrollment requires verifying the qualifying status; availability varies by county.

## COVERAGE COORDINATION
- Employer 20+ employees: can delay Part B penalty-free while actively covered; 8-month SEP after employment/coverage ends.
- COBRA and retiree coverage are NOT "current employment" — they do NOT protect from the Part B late penalty. Enroll in B on time.
- VA benefits: coexist with Medicare (VA drug coverage is creditable for Part D). TRICARE For Life: requires A+B. Railroad Retirement: enrolls through RRB, cards/claims differ slightly.

## COSTS / PENALTIES
- Part B late penalty: +10% per full 12-month period without B or creditable employer coverage — LIFELONG. Part D: +1% of national base premium per month without creditable drug coverage. Part A (if not premium-free): +10% for twice the missed years.
- IRMAA: higher MAGI (2-year lookback) adds surcharges to B and D premiums; SSA form SSA-44 for life-changing events (retirement, death of spouse, divorce).

## PRESCRIPTIONS
Formulary (covered list) · tiers (cost levels) · prior authorization · step therapy · quantity limits · preferred vs standard pharmacy pricing. Cost jumps usually mean: deductible reset, tier/formulary change, pharmacy network change, coverage-phase change, or LIS change.

## NETWORKS & DOCTORS
HMO (network + PCP + referrals, except emergencies) · PPO (out-of-network allowed at higher cost) · POS (hybrid). A provider leaving the network mid-year does NOT automatically create a SEP — options depend on plan type, dates and notices.

## HOSPITAL & FACILITY
Inpatient vs OBSERVATION status matters: observation days (outpatient, MOON notice) do NOT count toward Original Medicare's 3-day inpatient stay required before SNF coverage. Hospice = Part A benefit (elected, terminal prognosis). Home health requires homebound + skilled need.

## CLAIMS, LETTERS & APPEALS
- EOB (from MA/Part D plan, monthly) and MSN (Original Medicare, quarterly) are NOT bills — compare provider bills against them before paying; never ignore due dates.
- Appeals: denials can ALWAYS be appealed — Original Medicare redetermination within 120 days; MA plan reconsideration within 60 days; 5 escalating levels. Plans must respond on deadlines (72h expedited).
- ANOC = **Annual Notice of Change** (Spanish: "Aviso Anual de Cambios") — the letter an MA or Part D plan sends every fall (September) listing next year's changes effective Jan 1: premium, deductible, copays/coinsurance, benefits, provider network, drug formulary, coverage rules. NEVER confuse ANOC with NOMNC (Notice of Medicare Non-Coverage), ABN (Advance Beneficiary Notice), MSN, EOB, or EOC (Evidence of Coverage = the full contract).
- Unknown letter: if you cannot identify a document from the description, do NOT guess its type — ask: "What title or letters appear at the top of the letter?" / "¿Qué título o siglas aparecen en la parte superior?"

## FRAUD RED FLAGS
Medicare NEVER calls to sell, verify your number, or charge for a new card. Never give MBI/SSN/bank info to unsolicited callers. Report: 1-800-MEDICARE. If a caller describes this → warn clearly and firmly.

## COMMUNITY RESOURCES
SHIP (free unbiased state counseling) · 211 · plan-included transportation/dental/vision/OTC where offered · SNAP, LIHEAP · caregiver support (state offices for aging) · vaccines covered under B/D.

## RISK ENGINE (warn BEFORE continuing)
If the caller implies any of these, explain the consequence FIRST: dropping/cancelling Part B (lifelong penalty + coverage gap) · dropping Part D or creditable coverage (1%/month penalty) · relying on COBRA past 8 months for B · missing IEP/SEP deadlines · moving states (plan service areas end — but NY/CT Medigap protections differ) · losing Medicaid/LIS (cost-sharing returns; SEP window is limited) · switching MA→Medigap outside protected windows (underwriting risk except NY/CT) · anything resembling fraud.

## CONFIDENCE ENGINE
Internally classify every answer: HIGH (teach it plainly) · MEDIUM (teach with "generally/may depend on" + name what varies) · NEEDS MORE INFO (say exactly: "I don't have enough information to answer accurately. Let me ask one quick question." — then ask ONE). Never guess, never fabricate eligibility or CMS rules, never promise acceptance, never recommend a specific plan or carrier — a licensed advisor handles recommendations and enrollment.
`;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-10-04 (CBF-10) — RELEASE LEDGER.
// The body above was one unversioned string: no version identifier, no approval
// date, no plan-year tag. A reply could not be traced to the knowledge that
// produced it, and the next yearly edit would have overwritten this text without
// a trace (spec §20 "approved and versioned"; §22 "Do not overwrite prior-year
// logic"). Its identity lives HERE, beside the text it identifies — the same
// shape as SOA_SCRIPT_VERSION / APPROVED_TEXT_DIGEST beside the SOA wording.
//
// Enforced by scripts/check-cy2027-parity.mjs (build gate) and
// scripts/test-cy2027-knowledge-2026-10-04.mjs:
//   • `digest` is sha256 of the exported string. Editing the body without
//     APPENDING a new release fails the build.
//   • The ledger is append-only. A shipped entry's version and digest are never
//     edited. The outgoing entry becomes SUPERSEDED and its body is copied
//     verbatim to api/_lib/knowledge-archive/<version>.js (export KNOWLEDGE_BODY).
//   • approvedBy / approvedOn are OWNER-SUPPLIED. Never fill them from a commit
//     date, a comment or inference (§22 "No AI self-promotion"). Until a named
//     person approves on a named date the status stays APPROVAL_NOT_RECORDED,
//     and every audit record /api/chat writes says so.
//   • planYear is the plan year in force on issuedOn (rulesets.js effective
//     windows). It is NOT a claim that the text was reviewed for that year.
// Pre-ledger history is recoverable from git: 011a0f6 (2026-07-15, first body)
// and ad4e9b5 (2026-09-13, one-line LIS-SEP correction — the body pinned below).
// This module stays free of node:crypto; callers compute the digest.
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWLEDGE_STATUS = Object.freeze({
  APPROVAL_NOT_RECORDED: 'APPROVAL_NOT_RECORDED',
  PRODUCTION_ACTIVE: 'PRODUCTION_ACTIVE',
  SUPERSEDED: 'SUPERSEDED',
});

export const KNOWLEDGE_RELEASES = Object.freeze([
  Object.freeze({
    version: 'CP-UMKE-CY2026-v1.0',
    planYear: 2026,
    issuedOn: '2026-09-13',
    digest: 'sha256:fe91877b42234ee61e8320829f33b2a390acb72e534a1f02827fd0515c1148ae',
    status: KNOWLEDGE_STATUS.APPROVAL_NOT_RECORDED,
    approvedBy: null,
    approvedOn: null,
  }),
]);

/** The release the exported body claims to be: always the LAST ledger entry. */
export const MEDICARE_KNOWLEDGE_RELEASE = KNOWLEDGE_RELEASES[KNOWLEDGE_RELEASES.length - 1];
export const MEDICARE_KNOWLEDGE_VERSION = MEDICARE_KNOWLEDGE_RELEASE.version;
export const MEDICARE_KNOWLEDGE_PLAN_YEAR = MEDICARE_KNOWLEDGE_RELEASE.planYear;
export const MEDICARE_KNOWLEDGE_DIGEST = MEDICARE_KNOWLEDGE_RELEASE.digest;

const KB_VERSION_RE = /^CP-UMKE-CY(\d{4})-v\d+\.\d+$/;
const KB_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const KB_ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KB_STATUSES = Object.freeze(Object.values(KNOWLEDGE_STATUS));
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isDigest = (v) => typeof v === 'string' && KB_DIGEST_RE.test(v);

/** TRUE only when a named person approved this release on a named date. */
export function hasRecordedKnowledgeApproval(release = MEDICARE_KNOWLEDGE_RELEASE) {
  return (
    isRecord(release) &&
    release.status === KNOWLEDGE_STATUS.PRODUCTION_ACTIVE &&
    typeof release.approvedBy === 'string' && release.approvedBy.trim() !== '' &&
    typeof release.approvedOn === 'string' && KB_ISO_DAY_RE.test(release.approvedOn)
  );
}

/**
 * What an audit record may truthfully say about the body that was served.
 * `servedDigest` is computed by the caller from the string it actually sent.
 * FAIL-CLOSED: when the served body is not byte-for-byte the pinned release, NO
 * version, plan year, status or approval is claimed — the record carries the real
 * digest and a named reason instead.
 */
export function knowledgeProvenance(servedDigest, release = MEDICARE_KNOWLEDGE_RELEASE) {
  const digest = isDigest(servedDigest) ? servedDigest : null;
  const unproven = (reason) => Object.freeze({
    kb_version: null, kb_plan_year: null, kb_digest: digest, kb_integrity: reason, kb_status: null, kb_approved_on: null,
  });
  if (!digest) return unproven('DIGEST_NOT_COMPUTED');
  if (!isRecord(release) || digest !== release.digest) return unproven('DIGEST_MISMATCH');
  if (!KB_VERSION_RE.test(String(release.version))) return unproven('RELEASE_MALFORMED');
  return Object.freeze({
    kb_version: release.version,
    kb_plan_year: release.planYear,
    kb_digest: digest,
    kb_integrity: 'OK',
    kb_status: release.status,
    kb_approved_on: hasRecordedKnowledgeApproval(release) ? release.approvedOn : null,
  });
}

/**
 * The one line /api/chat prints at cold start when the served body is not the
 * pinned release — null when it is. Loud at load; the reply path keeps working.
 */
export function knowledgeLoadWarning(provenance) {
  if (!isRecord(provenance)) return '[CHAT] KNOWLEDGE PROVENANCE_MISSING: the knowledge body was served without a provenance record';
  if (provenance.kb_integrity === 'OK') return null;
  return '[CHAT] KNOWLEDGE ' + String(provenance.kb_integrity) + ': served body ' + String(provenance.kb_digest)
    + ' is not the pinned release — append a release in api/_lib/medicare-knowledge.js';
}

/**
 * Every way the ledger can be wrong, as named reasons. Pure, so the build gate
 * and the suite apply the SAME rules.
 *   bodyDigest     sha256 of MEDICARE_KNOWLEDGE as exported (required — a
 *                  caller that did not compute it gets a named refusal)
 *   archiveDigest  (version) => sha256 of that release's archived body, or null
 */
export function knowledgeLedgerProblems({ releases = KNOWLEDGE_RELEASES, bodyDigest, archiveDigest } = {}) {
  if (!Array.isArray(releases) || releases.length === 0) return ['KNOWLEDGE_LEDGER_EMPTY'];
  const problems = [];
  if (!isDigest(bodyDigest)) problems.push('KNOWLEDGE_BODY_DIGEST_NOT_COMPUTED');
  const archived = typeof archiveDigest === 'function' ? archiveDigest : () => null;
  const seen = new Set();
  releases.forEach((r, i) => {
    const v = isRecord(r) ? r.version : undefined;
    const m = KB_VERSION_RE.exec(typeof v === 'string' ? v : '');
    if (!m) { problems.push('KNOWLEDGE_VERSION_MALFORMED:' + String(v)); return; }
    if (seen.has(v)) problems.push('KNOWLEDGE_VERSION_DUPLICATED:' + v);
    seen.add(v);
    if (Number(m[1]) !== r.planYear) problems.push('KNOWLEDGE_PLAN_YEAR_TAG_MISMATCH:' + v);
    if (!isDigest(r.digest)) problems.push('KNOWLEDGE_DIGEST_MALFORMED:' + v);
    if (!(typeof r.issuedOn === 'string' && KB_ISO_DAY_RE.test(r.issuedOn))) problems.push('KNOWLEDGE_ISSUED_ON_MISSING:' + v);
    if (!KB_STATUSES.includes(r.status)) problems.push('KNOWLEDGE_STATUS_UNKNOWN:' + v);
    if (r.status === KNOWLEDGE_STATUS.PRODUCTION_ACTIVE && !hasRecordedKnowledgeApproval(r)) {
      problems.push('KNOWLEDGE_ACTIVE_WITHOUT_APPROVAL:' + v);
    }
    // "Not recorded" is an explicit state: both fields present and null, nothing half-filled.
    if (r.status === KNOWLEDGE_STATUS.APPROVAL_NOT_RECORDED && (r.approvedBy !== null || r.approvedOn !== null)) {
      problems.push('KNOWLEDGE_APPROVAL_INCONSISTENT:' + v);
    }
    if (i === releases.length - 1) {
      if (r.status === KNOWLEDGE_STATUS.SUPERSEDED) problems.push('KNOWLEDGE_CURRENT_RELEASE_SUPERSEDED:' + v);
      if (r.digest !== bodyDigest) problems.push('KNOWLEDGE_BODY_CHANGED_WITHOUT_NEW_RELEASE:' + v);
    } else {
      if (r.status !== KNOWLEDGE_STATUS.SUPERSEDED) problems.push('KNOWLEDGE_PRIOR_RELEASE_NOT_SUPERSEDED:' + v);
      // §22 "Do not overwrite prior-year logic": the outgoing body must survive
      // verbatim. A prior release whose text is still the live text needs no copy.
      if (r.digest !== bodyDigest && archived(v) !== r.digest) {
        problems.push('KNOWLEDGE_PRIOR_BODY_NOT_ARCHIVED:' + v);
      }
    }
  });
  return problems;
}

/**
 * What cy2027-preflight reports about the release: the two things only a person
 * can settle. Integrity (body ↔ digest) is the parity guard's job. WARN, never
 * BLOCK, on purpose: the body is already live, so a block would close nothing —
 * the wording says plainly that this warning, unlike the others, is not a gate.
 */
export function knowledgeReleaseReadiness(release = MEDICARE_KNOWLEDGE_RELEASE, planYearInForce) {
  if (!isRecord(release)) {
    return Object.freeze({ oks: Object.freeze([]), warns: Object.freeze(['knowledge base: no release record — api/_lib/medicare-knowledge.js has no ledger entry']) });
  }
  const oks = [];
  const warns = [];
  if (hasRecordedKnowledgeApproval(release)) {
    oks.push(`knowledge base ${release.version} approved ${release.approvedOn} by ${release.approvedBy}`);
  } else {
    warns.push(`knowledge base ${release.version}: ${release.status} — UNLIKE the other warnings this is not a closed gate: the body is live in /api/chat. Record approvedBy/approvedOn in api/_lib/medicare-knowledge.js once a named person has reviewed it`);
  }
  if (!Number.isInteger(planYearInForce)) {
    warns.push(`knowledge base ${release.version}: the plan year in force is unknown — its plan-year tag (${release.planYear}) could not be compared`);
  } else if (release.planYear !== planYearInForce) {
    warns.push(`knowledge base ${release.version} is tagged plan year ${release.planYear} but plan year ${planYearInForce} is in force — review it for CY${planYearInForce} and append a CP-UMKE-CY${planYearInForce} release`);
  }
  return Object.freeze({ oks: Object.freeze(oks), warns: Object.freeze(warns) });
}

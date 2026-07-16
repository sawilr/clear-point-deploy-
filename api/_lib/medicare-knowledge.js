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
- SEPs: Moving out of service area (2 months after move/notice) · Employer coverage ends (8 months for Part B; 2 months for MA/PDP) · Loss of Medicaid/LIS · Dual/LIS SEP (once per quarter, Q1–Q3) · 5-Star plan SEP (Dec 8 – Nov 30, once) · FEMA Disaster SEP · Plan exits area/contract violation.
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

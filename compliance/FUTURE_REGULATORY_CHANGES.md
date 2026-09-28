# Future Regulatory Changes — Watchlist

Published but NOT yet effective, or expected on a known calendar. Every monthly audit checks approaching activation dates. Never activate early; never lose these.

| # | Item | Jurisdiction | Known/Expected | Effective | Action when due |
|---|---|---|---|---|---|
| W1 | **2027 MA/Part D landscape + final average premiums** | CMS | mid–late Sept 2026 (per 2026-07-28 fact sheet) — **NOT yet published** as of the CMS newsroom listing read 2026-09-28 (latest item 2026-09-25) | PY2027 | Oct audit (or extraordinary run when published): capture figures → FUTURE rules; prep AEP education content |
| W2 | **2027 Part B premium & deductible** | CMS | expected ~Nov 2026 | 2027-01-01 | Nov audit: verify official figures → create `medicare-figures-2027.ts` + chat.js + backstop, schedule activation 2027-01-01 (owner pre-approval per §12) |
| W3 | **2027 Part D max deductible $700 + OOP cap $2,400** ✔ CAPTURED 2026-09-28 | CMS | CY2027 Rate Announcement 2026-04-06, Table V-2 (read from official PDF) | 2027-01-01 | DB `FED-2027-PARTD-PARAMS` (FUTURE). Include in the `medicare-figures-2027.ts` build with W2. Surfacing as a labeled "2027" figure during AEP = proposal P-2026-09-01, AWAITING OWNER APPROVAL |
| W4 | **Part D base premium 2027 = $41.33; NAMBA $296.05; Premium Stabilization Demo ends CY2026** | CMS | published 2026-07-28 ✔ | 2027-01-01 | Educational note for AEP: standalone PDP premiums may shift more than prior years |
| W5 | **CY2027 Final Rule — removal of time/manner restrictions on agent conversations** | CMS | published 2026-04-02 ✔ | CY2027 (verify) | LEVEL 2 / OWNER DECISION: could relax SOA waiting flow; verify §422.2264 text first; current stricter flow stays compliant |
| W6 | **NY MSP / EPIC 2027 limits** | NY | expected Q1 2027 (DOH revises ~March) | 2027-01-01 | Jan–Mar 2027 audits: re-verify DOH pages |
| W7 | **NJ PAAD/Senior Gold 2027 limits** | NJ | expected Q1–Q2 2027 (annual increase) | 2027-01-01 | Q1 2027 audit: nj.gov DoAS pages |
| W8 | **CT MSP limits (annual, effective March 1)** | CT | expected ~Feb 2027 | 2027-03-01 | Feb/Mar 2027 audit: portal.ct.gov DSS eligibility page |
| W9 | **Extra Help/LIS 2027 standards** | CMS/SSA | copays ✔ captured 2026-09-28 ($5.80/$14.40 · $1.65/$5.00, DB `FED-2027-LIS-COPAYS`); resource limits via HPMS memo after Sept 2026 CPI (~mid/late Oct 2026); income (FPL) ~Jan–Mar 2027 | 2027-01-01 | Oct audit: resource limits; Jan+Mar 2027: income |
| W10 | **TPMO marketing modernization rulemaking** | CMS | RFI in CY2027 rule — future proposed rule possible (watch fall 2026 / spring 2027) | TBD | Monitor Federal Register each audit |
| W11 | **CY2027 (e)(41) wording (SHIP reference removed; verbal timing "prior to the discussion of any benefits") — 91 FR 17384** | CMS | published 2026-04-02 ✔ (verified vs eCFR 2026-09-08 on 2026-09-12) | 2026-10-01 (CY2027 marketing) | Code switches automatically (`activeContractYearVariant`). OWNER: supply organization/product counts (still mandatory) and update Emely/Sofía scripts to state the disclaimer before any benefit discussion |
| W12 | **Medicare figures year rollover guard** | internal | `scripts/check-figures-year.mjs` runs in every build | 2027-01-01 | Build FAILS after Jan 1, 2027 until src/data/medicare-figures-2026.ts, api/chat.js and api/_lib/medicare-figures.js are updated together (ALLOW_STALE_FIGURES=1 = documented emergency override) |
| W13 | **Part D "reasonable and relevant" pharmacy contracting standards (CAA 2026 §6223) — RFI 2026-19535** | CMS | RFI published 2026-09-24, comments close 2026-11-23 | PY2029 | Sponsor/pharmacy-side; no Clear Point surface today. Monitor for proposed rule |
| W14 | **CY2027 LIS resource limits HPMS memo** | CMS | after September 2026 CPI (BLS ~mid-Oct) | 2027-01-01 | Oct audit: capture → FUTURE rule |
| W15 | **2027 Part B premium/deductible + SSA 2027 COLA** | CMS/SSA | COLA ~mid-Oct 2026; Part B ~Nov 2026 | 2027-01-01 | Oct audit: COLA (context only); Nov audit: Part B (see W2) |
| W16 | **ACCESS Model new tracks (heart failure, COPD, SUD, tobacco) — Original Medicare only** | CMS | announced 2026-09-15 | Spring 2027 | Informational; if Clara is ever asked, it is Original-Medicare-only, voluntary, 1-800-MEDICARE / Medicare.gov/ACCESS. No change proposed |

**AEP note (re-checked 2026-09-28):** TPMO CY2027 wording switch executed and verified at the 2026-10-01 00:00 ET boundary; organization/product COUNTS still missing (owner).  Marketing for PY2027 begins **October 1, 2026**; AEP Oct 15–Dec 7, 2026. September and October audits must confirm all PY2027-facing content (enrollment-period copy is year-generic today — verify it stays accurate).

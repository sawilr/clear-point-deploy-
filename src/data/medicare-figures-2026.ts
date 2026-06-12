/* ------------------------------------------------------------------ */
/*  Medicare 2026 Verified Data - sourced from CMS, SSA, state sites   */
/*  SINGLE SOURCE OF TRUTH for both Zara (canned education) and the    */
/*  LLM prompt (api/chat.js mirrors the figures + state programs).     */
/*                                                                      */
/*  ⚠️  ACTUALIZAR CADA AÑO (UPDATE ANNUALLY):                          */
/*   1. Update the federal figures below from the CMS year fact sheet. */
/*   2. Update MSP / SPAP limits from each state's site (NY/NJ/CT).    */
/*   3. Mirror the same figures + state programs in api/chat.js so the  */
/*      LLM answers stay current and state-appropriate.                 */
/*  States served: New York, New Jersey, Connecticut. FL is baseline   */
/*  only and is NEVER surfaced as a served area.                        */
/* ------------------------------------------------------------------ */

export const MEDICARE_2026 = {
  partA: {
    deductible: 1736,
    coinsuranceDay61to90: 434,
    coinsuranceLifetimeReserve: 868,
    snfCoinsuranceDay21to100: 217,
    premium30to39Quarters: 311,
    premiumLessThan30Quarters: 565,
  },
  partB: {
    standardPremium: 202.90,
    annualDeductible: 283,
    irmaaBrackets: [
      { individual: 109000, joint: 218000, adjustment: 0, totalPremium: 202.90 },
      { individual: 137000, joint: 274000, adjustment: 81.20, totalPremium: 284.10 },
      { individual: 171000, joint: 342000, adjustment: 202.90, totalPremium: 405.80 },
      { individual: 205000, joint: 410000, adjustment: 324.60, totalPremium: 527.50 },
      { individual: 500000, joint: 750000, adjustment: 446.30, totalPremium: 649.20 },
      { individual: Infinity, joint: Infinity, adjustment: 487.00, totalPremium: 689.90 },
    ],
  },
  partD: {
    maxDeductible: 615,
    oopCap: 2100,
    initialCoverageCoinsurance: 0.25,
    catastrophicCoinsurance: 0,
  },
  extraHelp: {
    incomeLimitSingle: 1995,
    incomeLimitCouple: 2705,
    assetLimitSingle: 17220,
    assetLimitCouple: 34360,
    genericCopay: 5.10,
    brandCopay: 12.65,
    autoEnroll: ['Medicaid', 'QMB', 'SLMB', 'QI', 'SSI'],
  },
  msp: {
    // NY: no asset/resource limit for MSP; only two categories QMB + QI-1 (SLMB phased out)
    NY: {
      QMB: { singleIncome: 1856, coupleIncome: 2509, singleAsset: 0, coupleAsset: 0, note: 'No asset limit in NY. 138% FPL with $20 disregard.' },
      QI1: { singleIncome: 2494, coupleIncome: 3375, singleAsset: 0, coupleAsset: 0, note: 'QI-1 at 186% FPL with $20 disregard. May be retroactive up to 3 months. Cannot combine with Medicaid.' },
    },
    // NJ: annual income limits, federal asset limits
    NJ: {
      QMB: { singleIncome: 1330, coupleIncome: 1803, singleAsset: 9950, coupleAsset: 14910, note: '$15,960/yr single, $21,640/yr couple' },
      SLMB: { singleIncome: 1596, coupleIncome: 2164, singleAsset: 9950, coupleAsset: 14910, note: '$19,152/yr single, $25,968/yr couple' },
      QI: { singleIncome: 1796, coupleIncome: 2435, singleAsset: 9950, coupleAsset: 14910, note: '$21,546/yr single, $29,214/yr couple' },
    },
    // CT: QMB/SLMB/ALMB (not QI); income limits effective March 1, 2026
    CT: {
      QMB: { singleIncome: 2807, coupleIncome: 3806, singleAsset: 0, coupleAsset: 0, note: 'Effective March 1, 2026. Described as similar to Medigap for cost-sharing.' },
      SLMB: { singleIncome: 3073, coupleIncome: 4166, singleAsset: 0, coupleAsset: 0, note: 'Part B premium only.' },
      ALMB: { singleIncome: 3272, coupleIncome: 4437, singleAsset: 0, coupleAsset: 0, note: 'Part B premium only. Subject to funding. Not available with Medicaid.' },
    },
    // FL: federal baseline if no verified state-specific limits
    FL: {
      QMB: { singleIncome: 1350, coupleIncome: 1824, singleAsset: 9950, coupleAsset: 14910, note: 'Federal baseline. Verify with FL Medicaid/DCF.' },
      SLMB: { singleIncome: 1616, coupleIncome: 2184, singleAsset: 9950, coupleAsset: 14910, note: 'Federal baseline. Part B premium only.' },
      QI: { singleIncome: 1816, coupleIncome: 2455, singleAsset: 9950, coupleAsset: 14910, note: 'Federal baseline. First-come, first-served.' },
      QDWI: { singleIncome: 5405, coupleIncome: 7299, singleAsset: 4000, coupleAsset: 6000, note: 'Part A premium only for disabled working individuals under 65.' },
    },
  },
  spap: {
    NY_EPIC: {
      incomeSingle: 75000,
      incomeCouple: 100000,
      ageMin: 65,
      note: 'NY State Pharmaceutical Assistance Program. Works with Part D. Separate from Extra Help — some may have both.',
      requiresPartD: true,
    },
    NJ_PAAD: {
      incomeSingle: 54943,
      incomeCouple: 62390,
      genericCopay: 5,
      brandCopay: 7,
      note: 'Must enroll in Part D. NJ resident 65+ or 18-64 on SSDI.',
    },
    NJ_SeniorGold: {
      incomeSingleMin: 54943,
      incomeSingleMax: 64943,
      incomeCoupleMin: 62390,
      incomeCoupleMax: 72390,
      note: 'No resource limit. Copay $15 + 50% of remaining drug cost. After $2,000 OOP single / $3,000 couple → flat $15.',
    },
    FL: { note: 'No verified statewide SPAP like NY EPIC or NJ PAAD. Prioritize Extra Help, MSP, Medicaid, SHINE, Part D formulary review.' },
    CT: { note: 'ConnPACE is no longer an active supported benefit plan as of January 1, 2014. For prescription help, review Extra Help/LIS, Medicaid if applicable, MSP, Part D formulary review.' },
  },
};

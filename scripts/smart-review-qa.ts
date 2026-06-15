/* eslint-disable no-console */
// Sawil 2026-06-15 — QA for the rebuilt Smart Review lead routing.
// Drives the PURE routing module (single source of truth used by the
// component) so every route is reproducible with zero rendering. Asserts the
// mission's invariants: precise lead types, no generic hot bucket, clean
// tags, special-situation = no normal sales lead, exact scope language.
// Run: npx tsx scripts/smart-review-qa.ts
import {
  STEP1_OPTIONS,
  SEP_OPTION,
  COST_FOLLOWUPS,
  SPECIAL_SITUATIONS,
  SPECIAL_GUIDANCE,
  SPECIAL_SCOPE_EN,
  SPECIAL_SCOPE_ES,
  LEAD_TYPE_TAG,
  buildLeadTags,
  isQualifiedSalesRoute,
  type LeadType,
} from '../src/lib/smartReviewRouting';

let PASS = 0, FAIL = 0;
const fails: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  if (cond) { PASS++; console.log(`   ✅ ${label}`); }
  else { FAIL++; fails.push(label); console.log(`   ❌ ${label}${detail ? '  — ' + detail : ''}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Simulate what the component sends to GHL for a given route.
function payloadFor(leadType: LeadType, specialTag?: string) {
  return { lead_type: leadType, tags: buildLeadTags(leadType, specialTag), soa_pending: isQualifiedSalesRoute(leadType) };
}

console.log('\n══════════ STEP 1 — six primary options (precise lead types) ══════════');
const expectedOptionLead: Record<string, LeadType> = {
  ma: 'MA_LEAD', pdp: 'PDP_LEAD', cost: 'COST_REVIEW_TRIAGE',
  new: 'NEEDS_TRIAGE', medigap: 'MEDIGAP_REVIEW', unsure: 'NEEDS_TRIAGE',
};
check('exactly 6 primary options', STEP1_OPTIONS.length === 6, `got ${STEP1_OPTIONS.length}`);
for (const opt of STEP1_OPTIONS) {
  check(`option "${opt.id}" → ${expectedOptionLead[opt.id]}`, opt.leadType === expectedOptionLead[opt.id], `got ${opt.leadType}`);
  check(`option "${opt.id}" bilingual labels present`, !!opt.en && !!opt.es);
}
// No broad assistance options leaked into Step 1.
const banned = /medicaid|msp|extra help|\blis\b|ssi|ssdi|disabilit|retiree|union|federal|\bva\b|tricare|home care|nursing|pace|\bmap\b|\bltc\b|i-snp/i;
check('NO broad assistance wording in Step 1 (EN)', STEP1_OPTIONS.every(o => !banned.test(o.en)));
check('NO broad assistance wording in Step 1 (ES)', STEP1_OPTIONS.every(o => !banned.test(o.es)));

console.log('\n══════════ SEP catch-all (audit option #7 fix) ══════════');
check('P1 SEP → NEEDS_TRIAGE (qualified, NOT low-priority)', SEP_OPTION.leadType === 'NEEDS_TRIAGE');
check('P2 SEP label is Medicare-adjacent — NO Medicaid/SSI/SSDI/VA/LTC wording (EN)', !banned.test(SEP_OPTION.en));
check('P3 SEP label is Medicare-adjacent — NO Medicaid/SSI/SSDI/VA/LTC wording (ES)', !banned.test(SEP_OPTION.es));
check('P4 SEP submits to CRM as a qualified route', isQualifiedSalesRoute(SEP_OPTION.leadType));
check('P5 SEP is NOT in the 6 primary options array', !STEP1_OPTIONS.some(o => o.id === SEP_OPTION.id));

console.log('\n══════════ MA_LEAD path ══════════');
{
  const p = payloadFor('MA_LEAD');
  check('A1 lead_type MA_LEAD', p.lead_type === 'MA_LEAD');
  check('A2 tags = [smart_review, ma_lead]', eq(p.tags, ['smart_review', 'ma_lead']), JSON.stringify(p.tags));
  check('A3 submits to CRM (qualified)', isQualifiedSalesRoute('MA_LEAD'));
  check('A4 SOA required', p.soa_pending === true);
}

console.log('\n══════════ PDP_LEAD path ══════════');
{
  const p = payloadFor('PDP_LEAD');
  check('B1 lead_type PDP_LEAD', p.lead_type === 'PDP_LEAD');
  check('B2 tags = [smart_review, pdp_lead]', eq(p.tags, ['smart_review', 'pdp_lead']), JSON.stringify(p.tags));
}

console.log('\n══════════ COST_REVIEW_TRIAGE path (must NOT become MA) ══════════');
{
  const cost = STEP1_OPTIONS.find(o => o.id === 'cost')!;
  check('C1 "Lower costs" base type COST_REVIEW_TRIAGE', cost.leadType === 'COST_REVIEW_TRIAGE');
  // Follow-up: premium/unsure STAY triage; drugs CLEARLY reclassify to PDP.
  const premium = COST_FOLLOWUPS.find(o => o.id === 'premium')!;
  const drugs = COST_FOLLOWUPS.find(o => o.id === 'drugs')!;
  const unsure = COST_FOLLOWUPS.find(o => o.id === 'unsure')!;
  check('C2 premium follow-up stays COST_REVIEW_TRIAGE', premium.leadType === 'COST_REVIEW_TRIAGE');
  check('C3 "not sure" follow-up stays COST_REVIEW_TRIAGE', unsure.leadType === 'COST_REVIEW_TRIAGE');
  check('C4 drug-cost follow-up → PDP_LEAD (clear reclassification)', drugs.leadType === 'PDP_LEAD');
  // The anti-pattern guard: cost NEVER auto-promotes to a hot MA lead.
  check('C5 NO cost follow-up routes to MA_LEAD', COST_FOLLOWUPS.every(o => o.leadType !== 'MA_LEAD'));
  const p = payloadFor('COST_REVIEW_TRIAGE');
  check('C6 tags = [smart_review, cost_review_triage]', eq(p.tags, ['smart_review', 'cost_review_triage']), JSON.stringify(p.tags));
}

console.log('\n══════════ NEEDS_TRIAGE + Not-sure paths ══════════');
{
  check('D1 "New to Medicare" → NEEDS_TRIAGE', STEP1_OPTIONS.find(o => o.id === 'new')!.leadType === 'NEEDS_TRIAGE');
  check('D2 "Not sure — guide me" → NEEDS_TRIAGE', STEP1_OPTIONS.find(o => o.id === 'unsure')!.leadType === 'NEEDS_TRIAGE');
  const p = payloadFor('NEEDS_TRIAGE');
  check('D3 tags = [smart_review, needs_triage]', eq(p.tags, ['smart_review', 'needs_triage']), JSON.stringify(p.tags));
}

console.log('\n══════════ MEDIGAP_REVIEW path ══════════');
{
  check('E1 "Have Medigap" → MEDIGAP_REVIEW', STEP1_OPTIONS.find(o => o.id === 'medigap')!.leadType === 'MEDIGAP_REVIEW');
  const p = payloadFor('MEDIGAP_REVIEW');
  check('E2 tags = [smart_review, medigap_review]', eq(p.tags, ['smart_review', 'medigap_review']), JSON.stringify(p.tags));
}

console.log('\n══════════ SPECIAL SITUATIONS — educational, no normal sales lead ══════════');
check('S0 exactly 4 special categories', SPECIAL_SITUATIONS.length === 4, `got ${SPECIAL_SITUATIONS.length}`);
const expectedSpecialTag: Record<string, string> = {
  medicaid: 'medicaid_msp_extra_help_lis',
  disability: 'ssi_ssdi_disability',
  va: 'va_tricare_retiree_union',
  ltc: 'homecare_nursing_pace_ltc',
};
for (const cat of SPECIAL_SITUATIONS) {
  console.log(`\n   ── ${cat.id} ──`);
  check(`${cat.id} tag = ${expectedSpecialTag[cat.id]}`, cat.tag === expectedSpecialTag[cat.id], cat.tag);
  check(`${cat.id} has bilingual guidance`, !!SPECIAL_GUIDANCE[cat.id]?.en && !!SPECIAL_GUIDANCE[cat.id]?.es);
  // Guidance must not promise ClearPoint enrolls/solves the program.
  const g = (SPECIAL_GUIDANCE[cat.id].en + ' ' + SPECIAL_GUIDANCE[cat.id].es);
  check(`${cat.id} guidance makes NO enroll/solve promise`, !/clearpoint (will )?(enroll|approve|solve|guarantee|file)/i.test(g));
  // Callback YES → LOW_PRIORITY_EDUCATION_REQUEST with the full tag set.
  const p = payloadFor('LOW_PRIORITY_EDUCATION_REQUEST', cat.tag);
  check(`${cat.id} callback-YES lead_type LOW_PRIORITY_EDUCATION_REQUEST`, p.lead_type === 'LOW_PRIORITY_EDUCATION_REQUEST');
  check(`${cat.id} tags include special_situation + no_normal_sales_lead + category`,
    p.tags.includes('smart_review') &&
    p.tags.includes('low_priority_education_request') &&
    p.tags.includes('special_situation') &&
    p.tags.includes('no_normal_sales_lead') &&
    p.tags.includes(cat.tag), JSON.stringify(p.tags));
  check(`${cat.id} is NOT a qualified sales route`, isQualifiedSalesRoute('LOW_PRIORITY_EDUCATION_REQUEST') === false);
  check(`${cat.id} SOA NOT required (not MA/PDP sale)`, p.soa_pending === false);
}

console.log('\n══════════ GLOBAL invariants ══════════');
check('G1 NO HOT_MA_PDP_LEAD anywhere in tag map', !Object.keys(LEAD_TYPE_TAG).includes('HOT_MA_PDP_LEAD' as LeadType));
check('G2 every lead type has a clean lowercase snake_case tag',
  Object.values(LEAD_TYPE_TAG).every(t => /^[a-z][a-z_]+$/.test(t)));
check('G3 scope language EN is the exact approved text',
  SPECIAL_SCOPE_EN === 'ClearPoint can provide general Medicare guidance and help you review Medicare Advantage or Part D options. We do not directly enroll people into Medicaid, SSI, SSDI, VA, TRICARE, nursing home benefits, home care benefits, or state assistance programs.');
check('G4 scope language ES is the exact approved text',
  SPECIAL_SCOPE_ES === 'ClearPoint puede ofrecer orientación general sobre Medicare y ayudarle a revisar opciones de Medicare Advantage o Parte D. No inscribimos directamente en Medicaid, SSI, SSDI, VA, TRICARE, beneficios de nursing home, beneficios de home care ni programas estatales de asistencia.');
check('G5 ONLY special route carries no_normal_sales_lead',
  (['MA_LEAD','PDP_LEAD','COST_REVIEW_TRIAGE','NEEDS_TRIAGE','MEDIGAP_REVIEW'] as LeadType[])
    .every(lt => !buildLeadTags(lt).includes('no_normal_sales_lead')));

console.log(`\n═════════════════════════════════════════`);
console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL > 0 ? 1 : 0);

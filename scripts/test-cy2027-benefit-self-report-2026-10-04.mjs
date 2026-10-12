// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — SELF-REPORTED BENEFIT STATUS (audit DM-04; spec §14, §15, §31).
//
// §14: "Self-reported Medicaid/LIS values are stored as SELF_REPORTED, never as
//       eligibility determinations."
// §31: "Customer says Medicaid - store self-reported, not eligible=true."
//
// Nothing here passes on a grep of the handler. The rules are pure functions and
// are CALLED; api/submit-lead.js is RUN, in process, against a laboratory CRM and
// a laboratory scorer (globalThis.fetch replaced — nothing leaves this machine),
// so a revert, an `if (false)` or a dropped argument changes what is observed.
// The build gate is run as a COMMAND against copies of the tree with a defect in
// them, and is seen to fail. The only source scans are of the React component,
// which cannot be run here (anchored to whole lines of comment-free code), and
// one completeness check — that the list of reserved production ids is exactly
// the ids the handlers write. The rule that USES that list is called, and the
// handler laboratory checks the same thing from what was actually sent.
//
// RED TEAM 2026-10-04 — an independent red team broke the first version of this
// work (9 findings). What changed here: §15 is asserted as an EQUALITY (scorer
// request byte for byte, every CRM call and body, the log) instead of an absence
// of words; the write-refusal branch is run against a copy of the layer with a
// mismatched vocabulary; and three assertions that pinned a defect as intended
// behaviour (the gap line naming one field, the retry line counting entries,
// an answer stored beside contradicting coverage text) now assert the repair.
//
// Run: node scripts/test-cy2027-benefit-self-report-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  PROVENANCE, CONFIRMING_PROVENANCE, CY2027_FIELD_KEYS, SELF_REPORTED, SELF_REPORTED_ONLY_FIELDS, SELF_REPORT_VALUE,
  isSelfReportValue, buildCustomFields, unmappedFieldsWarning,
  fieldIdConfig, fieldIdMap, refusedFieldIdsWarning, PRODUCTION_FIELD_IDS, FIELD_ID_REFUSAL,
} from '../api/_lib/cy2027/crm-fields.js';
import {
  BENEFIT_SELF_REPORT_TOKENS, COVERAGE_TOKENS_ASSERTING_MEDICAID, SELF_REPORT_REFUSAL, BENEFIT_SELF_REPORT_UNAVAILABLE,
  coverageStatesBenefit, coverageReading, classifyBenefitSelfReport, recordBenefitSelfReport, neutralizeBenefitLookalikes,
  isCoverageOptionAssertingMedicaid, SELF_REPORT_FIELDS_LOG_LABEL,
} from '../api/_lib/cy2027/benefit-self-report.js';
import { redactProhibitedForScoring, requiresLicensedReview, SIGNAL_FLAGS } from '../api/_lib/cy2027/prohibited-signals.js';
import { formatIntelForGhlNotes } from '../api/_lib/lead-intel.js';
import * as barrel from '../api/_lib/cy2027/index.js';
import { readShownConsentWording } from './consent-wording-gate.mjs';
import { stripComments } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const sha = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');

const FLAG = SIGNAL_FLAGS.BENEFIT_STATUS;
const HEADER = '— Benefit status: SELF_REPORTED (stated by the submitter · not verified with any agency · ' +
  'NOT an eligibility determination · not a scoring or routing factor) —';
const FOOTER = 'Confirm with the state Medicaid office or Social Security before relying on it.';
const block = (medicaid, lis) => HEADER + '\nMedicaid: ' + medicaid + ' · Extra Help/LIS: ' + lis + '\n' + FOOTER;
const NOT_STATED = 'not stated';
const SR_IDS = { CY2027_CRM_FIELD_IDS: '{"SELF_REPORTED_MEDICAID_STATUS":"srM","SELF_REPORTED_LIS_STATUS":"srL"}' };
// What the handler hands the classifier for the lead form's own option: the
// value as received, the token made from it, and the capped text.
const DUAL_IN = Object.freeze({ medicareStatusRaw: 'dual', medicareStatusToken: 'dual', medicareStatusText: 'dual' });
const GAP_BOTH = '[CY2027-CRM] 2 field(s) could not be written because no GoHighLevel field ID is configured for them: ' +
  'SELF_REPORTED_MEDICAID_STATUS, SELF_REPORTED_LIS_STATUS. Create them in the sub-account (keys: ' +
  'contact.self_reported_medicaid_status, contact.self_reported_lis_status) and set CY2027_CRM_FIELD_IDS. ' +
  'The full record is in the contact note meanwhile, but it is not queryable there.';

// ── 1. The storage class (crm-fields.js) ─────────────────────────────────────
{
  ok('SELF_REPORTED is a provenance class', PROVENANCE.includes('SELF_REPORTED') && SELF_REPORTED === 'SELF_REPORTED');
  ok('…and it does NOT confirm anything: a report is not a confirmation', !CONFIRMING_PROVENANCE.includes('SELF_REPORTED'));
  ok('the two benefit fields exist and their KEY says self-reported',
    CY2027_FIELD_KEYS.SELF_REPORTED_MEDICAID_STATUS === 'contact.self_reported_medicaid_status' &&
    CY2027_FIELD_KEYS.SELF_REPORTED_LIS_STATUS === 'contact.self_reported_lis_status' &&
    SELF_REPORTED_ONLY_FIELDS.join() === 'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS' && Object.isFrozen(SELF_REPORTED_ONLY_FIELDS));
  ok('every storable value says SELF_REPORTED, and there are exactly three',
    Object.isFrozen(SELF_REPORT_VALUE) &&
    JSON.stringify(SELF_REPORT_VALUE) === '{"YES":"SELF_REPORTED_YES","NO":"SELF_REPORTED_NO","UNSURE":"SELF_REPORTED_UNSURE"}');
  ok('the vocabulary cannot express a determination',
    !Object.keys(SELF_REPORT_VALUE).concat(Object.values(SELF_REPORT_VALUE)).some((v) => /ELIGIB|VERIF|DETERMIN|APPROV|QUALIF|TRUE|ENROLL/i.test(v)));

  ok('isSelfReportValue: the three values, as strings, and nothing else',
    ['SELF_REPORTED_YES', 'SELF_REPORTED_NO', 'SELF_REPORTED_UNSURE'].every(isSelfReportValue) &&
    ['YES', 'self_reported_yes', ' SELF_REPORTED_YES', 'SELF_REPORTED_YES ', 'SELF_REPORTED_ELIGIBLE', 'ELIGIBLE', 'true', '', 'constructor',
      ['SELF_REPORTED_YES'], new String('SELF_REPORTED_YES'), { value: 'SELF_REPORTED_YES' }, true, 1, null, undefined]
      .every((v) => isSelfReportValue(v) === false));

  const good = (value) => ({ value, source: 'SELF_REPORTED' });
  const written = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: good('SELF_REPORTED_YES'), SELF_REPORTED_LIS_STATUS: good('SELF_REPORTED_UNSURE') }, SR_IDS);
  ok('a self-report is written to its own two fields, by real id',
    written.fields.length === 2 && written.refused.length === 0 && written.unmapped.length === 0 &&
    JSON.stringify(written.fields.map((f) => [f.id, f.key, f.value])) ===
      '[["srM","contact.self_reported_medicaid_status","SELF_REPORTED_YES"],["srL","contact.self_reported_lis_status","SELF_REPORTED_UNSURE"]]',
    JSON.stringify(written));

  for (const bad of ['ELIGIBLE', 'true', 'YES', 'dual', 'SELF_REPORTED_ELIGIBLE', 'self_reported_yes', ' SELF_REPORTED_YES', true, 1,
    ['SELF_REPORTED_YES'], { toString: () => 'SELF_REPORTED_YES' }, new String('SELF_REPORTED_YES')]) {
    const r = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: { value: bad, source: 'SELF_REPORTED' } }, SR_IDS);
    ok(`write guard: ${JSON.stringify(bad)} (${typeof bad}) can never be written to a benefit field`,
      r.fields.length === 0 && r.refused.join() === 'SELF_REPORTED_MEDICAID_STATUS', JSON.stringify(r));
  }
  for (const source of ['SYSTEM', 'AI_INFERRED', 'BENEFICIARY_CONFIRMED', 'self_reported', 'SELF_REPORTED ', '', undefined, null, ['SELF_REPORTED'], true]) {
    const r = buildCustomFields({ SELF_REPORTED_LIS_STATUS: { value: 'SELF_REPORTED_YES', source } }, SR_IDS);
    ok(`write guard: provenance ${JSON.stringify(source)} may not write a benefit field`,
      r.fields.length === 0 && r.refused.join() === 'SELF_REPORTED_LIS_STATUS', JSON.stringify(r));
  }
  const scalar = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: 'SELF_REPORTED_YES' }, SR_IDS);
  ok('write guard: a plain scalar (implicit SYSTEM) is refused too',
    scalar.fields.length === 0 && scalar.refused.join() === 'SELF_REPORTED_MEDICAID_STATUS');

  // The mirror: a value that declares itself a self-report goes nowhere else.
  const otherIds = { CY2027_CRM_FIELD_IDS: '{"LEAD_TRUST_STATE":"t1","RETENTION_CLASS":"r1","SOA_STATE":"s1","CARRIER_OVERLAY_STATUS":"c1"}' };
  for (const name of ['LEAD_TRUST_STATE', 'RETENTION_CLASS', 'SOA_STATE', 'CARRIER_OVERLAY_STATUS']) {
    const r = buildCustomFields({ [name]: { value: 'SELF_REPORTED_YES', source: 'SELF_REPORTED' } }, otherIds);
    ok(`write guard (mirror): a SELF_REPORTED value is refused for ${name}`, r.fields.length === 0 && r.refused.join() === name, JSON.stringify(r));
  }
  const untouched = buildCustomFields({ LEAD_TRUST_STATE: 'UNVERIFIED', RETENTION_CLASS: { value: 'SOA_EVIDENCE', source: 'SYSTEM' } }, otherIds);
  ok('write guard: every other field is written exactly as before',
    untouched.refused.length === 0 && untouched.fields.map((f) => f.id + '=' + f.value).join() === 't1=UNVERIFIED,r1=SOA_EVIDENCE');
  const crm28 = buildCustomFields({ SOA_STATE: { value: 'NJ', source: 'AI_INFERRED' } }, otherIds);
  ok('write guard: the CRM-28 guard is not weakened', crm28.refused.join() === 'SOA_STATE' && crm28.fields.length === 0);

  const gap = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: good('SELF_REPORTED_NO') }, {});
  ok('with no field id the gap is reported, not silent',
    gap.fields.length === 0 && gap.unmapped.join() === 'SELF_REPORTED_MEDICAID_STATUS' &&
    /contact\.self_reported_medicaid_status/.test(String(unmappedFieldsWarning(gap.unmapped))));
  const half = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: good('SELF_REPORTED_YES'), SELF_REPORTED_LIS_STATUS: good('SELF_REPORTED_YES') },
    { CY2027_CRM_FIELD_IDS: '{"SELF_REPORTED_MEDICAID_STATUS":"srM"}' });
  ok('the two programs are independent facts: one id writes one field and names the other',
    half.fields.length === 1 && half.fields[0].id === 'srM' && half.unmapped.join() === 'SELF_REPORTED_LIS_STATUS');
  ok('the classifier is server-only: the shared barrel does not export it',
    !('classifyBenefitSelfReport' in barrel) && !('recordBenefitSelfReport' in barrel) && !('buildCustomFields' in barrel));

  // RED TEAM 2026-10-04 — an owner id is not trusted because it is a string.
  // Measured before the fix: SELF_REPORTED_YES sent under contact.medicare_status' own id.
  const MEDICARE_STATUS_ID = 'R510tHz6GFBaqZgN5e5S';
  const cfg = (map) => fieldIdConfig({ CY2027_CRM_FIELD_IDS: typeof map === 'string' ? map : JSON.stringify(map) });
  ok('id config: the ids this code already writes are known, frozen, and none is repeated',
    Object.isFrozen(PRODUCTION_FIELD_IDS) && PRODUCTION_FIELD_IDS.length === 12 && new Set(PRODUCTION_FIELD_IDS).size === 12 &&
    PRODUCTION_FIELD_IDS.includes(MEDICARE_STATUS_ID) && PRODUCTION_FIELD_IDS.every((id) => typeof id === 'string' && /^[A-Za-z0-9]{20}$/.test(id)) &&
    Object.isFrozen(FIELD_ID_REFUSAL) && FIELD_ID_REFUSAL.IN_USE !== FIELD_ID_REFUSAL.SHARED);
  // Drift: every `{ id: '…', key: 'contact.…' }` entry any handler writes is a reserved id, and nothing else is.
  const apiFiles = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? apiFiles(join(dir, e.name)) : (/\.js$/.test(e.name) ? [join(dir, e.name)] : [])));
  const API_DIR = fileURLToPath(new URL('../api', import.meta.url));
  const idsInCode = new Set();
  for (const file of apiFiles(API_DIR)) {
    for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(/\bid:\s*'([A-Za-z0-9]{16,24})',\s*key:\s*'contact\.[a-z_]+'/g)) idsInCode.add(m[1]);
  }
  ok('id config: the reserved list is exactly the ids the handlers write (a new production field must be added to it)',
    idsInCode.size === 12 && [...idsInCode].sort().join() === PRODUCTION_FIELD_IDS.slice().sort().join(), [...idsInCode].sort().join());
  for (const id of PRODUCTION_FIELD_IDS) {
    const c = cfg({ SELF_REPORTED_LIS_STATUS: id, SELF_REPORTED_MEDICAID_STATUS: ' ' + id + ' ', SOA_STATE: 's1' });
    ok(`id config: the id of a field already in use (${id}) is refused for every name it was given to, by name`,
      JSON.stringify(c.ids) === '{"SOA_STATE":"s1"}' &&
      JSON.stringify(c.refused) === JSON.stringify({ SELF_REPORTED_LIS_STATUS: FIELD_ID_REFUSAL.IN_USE, SELF_REPORTED_MEDICAID_STATUS: FIELD_ID_REFUSAL.IN_USE }), JSON.stringify(c));
  }
  const shared = cfg({ SELF_REPORTED_MEDICAID_STATUS: 'same', SELF_REPORTED_LIS_STATUS: 'same', SOA_ZIP: ' same ', SOA_STATE: 's1' });
  ok('id config: one id given to several names is given to NONE of them — there is no telling which the field was made for',
    JSON.stringify(shared.ids) === '{"SOA_STATE":"s1"}' && Object.keys(shared.refused).sort().join() === 'SELF_REPORTED_LIS_STATUS,SELF_REPORTED_MEDICAID_STATUS,SOA_ZIP' &&
    Object.values(shared.refused).every((r) => r === FIELD_ID_REFUSAL.SHARED), JSON.stringify(shared));
  ok('id config: ids that are each their own are all kept, and nothing is refused',
    JSON.stringify(cfg(SR_IDS.CY2027_CRM_FIELD_IDS)) === '{"ids":{"SELF_REPORTED_MEDICAID_STATUS":"srM","SELF_REPORTED_LIS_STATUS":"srL"},"refused":{}}' &&
    JSON.stringify(cfg({ SOA_STATE: 'A1', SOA_ZIP: 'a1' }).ids) === '{"SOA_STATE":"A1","SOA_ZIP":"a1"}');
  ok('id config: an unknown name cannot make a known one "shared", and malformed content is an empty configuration',
    JSON.stringify(cfg({ MADE_UP: 'x1', SOA_STATE: 'x1' })) === '{"ids":{"SOA_STATE":"x1"},"refused":{}}' &&
    ['not json', '[]', '7', 'null', '', '{"SOA_STATE":7}', '{"__proto__":{"SOA_STATE":"x"}}'].every((raw) => JSON.stringify(cfg(raw)) === '{"ids":{},"refused":{}}'));
  ok('id config: fieldIdMap() is that configuration\'s ids — the one map buildCustomFields() writes from',
    JSON.stringify(fieldIdMap({ CY2027_CRM_FIELD_IDS: JSON.stringify({ SELF_REPORTED_LIS_STATUS: MEDICARE_STATUS_ID, SOA_STATE: 's1', SOA_ZIP: 's1', SOA_COUNTY: 'c1' }) })) === '{"SOA_COUNTY":"c1"}');
  const collide = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: good('SELF_REPORTED_YES'), SELF_REPORTED_LIS_STATUS: good('SELF_REPORTED_YES') },
    { CY2027_CRM_FIELD_IDS: JSON.stringify({ SELF_REPORTED_MEDICAID_STATUS: MEDICARE_STATUS_ID, SELF_REPORTED_LIS_STATUS: MEDICARE_STATUS_ID }) });
  ok('write stage: a self-report is never sent under the Medicare-coverage field\'s id — both names are reported, nothing is written',
    collide.fields.length === 0 && collide.unmapped.join() === 'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS', JSON.stringify(collide));
  const twin = buildCustomFields({ SELF_REPORTED_MEDICAID_STATUS: good('SELF_REPORTED_NO'), SELF_REPORTED_LIS_STATUS: good('SELF_REPORTED_YES') },
    { CY2027_CRM_FIELD_IDS: '{"SELF_REPORTED_MEDICAID_STATUS":"one","SELF_REPORTED_LIS_STATUS":"one"}' });
  ok('write stage: an Extra Help answer cannot land in the field made for Medicaid (one id, two names → neither is written)',
    twin.fields.length === 0 && twin.unmapped.join() === 'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS', JSON.stringify(twin));
  // The callback-consent unit is whole or absent: a refused id takes the unit with it.
  const AT = '2026-10-01T12:00:00.000Z';
  const unit = buildCustomFields({ CALLBACK_CONSENT_STATUS: 'REVOKED', CALLBACK_CONSENT_AT: AT },
    { CY2027_CRM_FIELD_IDS: JSON.stringify({ CALLBACK_CONSENT_STATUS: 'cbS', CALLBACK_CONSENT_AT: PRODUCTION_FIELD_IDS[4] }) });
  ok('write stage: a callback unit whose timestamp was given a production id is not sent in part',
    unit.fields.length === 0 && unit.withheld.join() === 'CALLBACK_CONSENT_STATUS' && unit.unmapped.join() === 'CALLBACK_CONSENT_AT', JSON.stringify(unit));
  ok('refused ids are named with their reason, for the fields asked about only — never the id',
    refusedFieldIdsWarning(shared.refused, SELF_REPORTED_ONLY_FIELDS) ===
      '[CY2027-CRM] CY2027_CRM_FIELD_IDS gives 2 field(s) an id that is REFUSED: SELF_REPORTED_MEDICAID_STATUS (ID_GIVEN_TO_MORE_THAN_ONE_FIELD), ' +
      'SELF_REPORTED_LIS_STATUS (ID_GIVEN_TO_MORE_THAN_ONE_FIELD). Each CY2027 field needs its OWN new GoHighLevel field — never the id of a field ' +
      'already in use, never one id for two names. Nothing is written to a refused id.' &&
    refusedFieldIdsWarning(shared.refused, ['SOA_STATE']) === null && refusedFieldIdsWarning({}, SELF_REPORTED_ONLY_FIELDS) === null &&
    refusedFieldIdsWarning(null, ['constructor', 'toString']) === null && /SOA_ZIP/.test(String(refusedFieldIdsWarning(shared.refused))));
}

// ── 2. The classifier, called ────────────────────────────────────────────────
{
  const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => (v === null || typeof v !== 'object') || deepFrozen(v));
  ok('the token table is the five Smart Review answers, frozen all the way down',
    Object.keys(BENEFIT_SELF_REPORT_TOKENS).sort().join() === 'both,extra_help,medicaid,no,unsure' && deepFrozen(BENEFIT_SELF_REPORT_TOKENS) &&
    Object.isFrozen(COVERAGE_TOKENS_ASSERTING_MEDICAID) && COVERAGE_TOKENS_ASSERTING_MEDICAID.join() === 'dual' && Object.isFrozen(SELF_REPORT_REFUSAL));

  const want = {
    medicaid: ['SELF_REPORTED_YES', undefined], extra_help: [undefined, 'SELF_REPORTED_YES'],
    both: ['SELF_REPORTED_YES', 'SELF_REPORTED_YES'], no: ['SELF_REPORTED_NO', 'SELF_REPORTED_NO'],
    unsure: ['SELF_REPORTED_UNSURE', 'SELF_REPORTED_UNSURE'],
  };
  for (const [tok, [m, l]] of Object.entries(want)) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: '', medicareStatusText: '', benefitSelfReport: tok });
    ok(`"${tok}" → Medicaid ${m}, Extra Help ${l} — only what was said, nothing inferred`,
      (r.values.SELF_REPORTED_MEDICAID_STATUS || {}).value === m && (r.values.SELF_REPORTED_LIS_STATUS || {}).value === l &&
      Object.keys(r.values).length === [m, l].filter(Boolean).length, JSON.stringify(r.values));
    ok(`"${tok}" carries SELF_REPORTED provenance on every value and leaves the coverage field alone`,
      r.stated === true && r.coverageWithheld === false && r.refusals.length === 0 &&
      Object.values(r.values).every((f) => f.source === 'SELF_REPORTED' && Object.isFrozen(f)));
    // §15: "I don't know" gets the same path as a known answer — same flag, no review forced.
    ok(`"${tok}" raises the one flag every answer raises, and forces nothing`,
      r.flags.length === 1 && r.flags[0] === FLAG && requiresLicensedReview(r.flags) === false);
    ok(`"${tok}" writes the block from the vocabulary, character for character`,
      r.noteBlock === block(m || NOT_STATED, l || NOT_STATED), r.noteBlock);
  }

  // Exactly a token, as a string. RED TEAM history: lookups that coerce.
  for (const bad of ['Medicaid', 'MEDICAID', ' medicaid', 'medicaid ', 'medicaid\n', 'eligible', 'yes', 'dual', 'SELF_REPORTED_YES',
    'constructor', '__proto__', 'toString', 'hasOwnProperty', ['medicaid'], ['both', 'no'], { toString: () => 'medicaid' }, true, false, 0, 1]) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: '', medicareStatusText: '', benefitSelfReport: bad });
    ok(`${JSON.stringify(bad)} (${Array.isArray(bad) ? 'array' : typeof bad}) is not an answer: nothing stored, refused by name`,
      r.stated === false && Object.keys(r.values).length === 0 && r.noteBlock === '' && r.flags.length === 0 && r.coverageWithheld === false &&
      r.refusals.join() === SELF_REPORT_REFUSAL.UNKNOWN_TOKEN, JSON.stringify(r));
  }
  for (const none of [undefined, null, '']) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: 'original', medicareStatusText: 'original', benefitSelfReport: none });
    ok(`no answer (${JSON.stringify(none)}) is not a refusal`, r.stated === false && r.refusals.length === 0 && r.flags.length === 0 && r.noteBlock === '');
  }
  for (const junk of [undefined, null, 'dual', 7, ['dual'], () => 'dual']) {
    const r = classifyBenefitSelfReport(junk);
    ok(`an input that is not a record (${typeof junk}) classifies as nothing`,
      r.stated === false && r.coverageWithheld === false && Object.keys(r.values).length === 0 && r.refusals.length === 0);
  }

  // The lead form's option value.
  const dual = classifyBenefitSelfReport(DUAL_IN);
  ok('"dual" is a Medicaid SELF-REPORT, withheld from the coverage field',
    dual.coverageWithheld === true && dual.stated === true && dual.refusals.length === 0 &&
    JSON.stringify(dual.values) === '{"SELF_REPORTED_MEDICAID_STATUS":{"value":"SELF_REPORTED_YES","source":"SELF_REPORTED"}}');
  ok('"dual": Extra Help is NOT inferred from a Medicaid answer', !own(dual.values, 'SELF_REPORTED_LIS_STATUS'));
  ok('"dual": the block says who asserted it and what it is not', dual.noteBlock === block('SELF_REPORTED_YES', NOT_STATED), dual.noteBlock);
  ok('"dual": the block never states eligibility as a fact',
    !/eligible\s*[=:]\s*(?:true|yes)|\bis (?:dual[- ])?eligible\b|\bqualifies\b|\benrolled\b/i.test(dual.noteBlock) &&
    /NOT an eligibility determination/.test(dual.noteBlock) && /not verified with any agency/.test(dual.noteBlock));
  ok('"dual": benefit status alone still does not force licensed review', dual.flags.join() === FLAG && requiresLicensedReview(dual.flags) === false);
  ok('the result is frozen', Object.isFrozen(dual) && Object.isFrozen(dual.values) && Object.isFrozen(dual.flags) && Object.isFrozen(dual.refusals));

  // The same submission answering twice.
  const agree = classifyBenefitSelfReport({ ...DUAL_IN, benefitSelfReport: 'both' });
  ok('"dual" + "both" agree: Medicaid yes, Extra Help yes, no refusal',
    agree.refusals.length === 0 && agree.noteBlock === block('SELF_REPORTED_YES', 'SELF_REPORTED_YES'));
  const adds = classifyBenefitSelfReport({ ...DUAL_IN, benefitSelfReport: 'extra_help' });
  ok('"dual" + "extra_help": each program from the answer that named it',
    adds.refusals.length === 0 && adds.noteBlock === block('SELF_REPORTED_YES', 'SELF_REPORTED_YES'));
  for (const [answer, lis] of [['no', 'SELF_REPORTED_NO'], ['unsure', 'SELF_REPORTED_UNSURE']]) {
    const clash = classifyBenefitSelfReport({ ...DUAL_IN, benefitSelfReport: answer });
    ok(`"dual" + "${answer}" contradict: no Medicaid value is stored, by name, and neither answer is believed`,
      !own(clash.values, 'SELF_REPORTED_MEDICAID_STATUS') && clash.refusals.join() === SELF_REPORT_REFUSAL.CONFLICT &&
      clash.coverageWithheld === true && clash.values.SELF_REPORTED_LIS_STATUS.value === lis &&
      clash.noteBlock === block('not recorded (the answers given conflict)', lis), JSON.stringify(clash));
  }

  // RED TEAM 2026-10-04 — the YES is read from the value AS RECEIVED. The
  // handler's token is lossy: each of these normalises to the token 'dual', and
  // each was stored as "Medicaid: SELF_REPORTED_YES" (a negation, a question).
  const tokenOf = (v) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const NOT_THE_OPTION = ['не dual', '非dual', '¿dual?', '  DUAL!! ', 'dual ✖', 'dual.', '"dual"', '-dual', 'dual' + ' '.repeat(60) + '— нет',
    'du​al', 'ＤＵＡＬ', 'dual\u0000'];
  ok('the lossy token of every one of these IS "dual" — which is why the token may not assert anything',
    NOT_THE_OPTION.filter((v) => tokenOf(v) === 'dual').length >= 9);
  for (const raw of NOT_THE_OPTION) {
    const r = classifyBenefitSelfReport({ medicareStatusRaw: raw, medicareStatusToken: 'dual', medicareStatusText: raw.slice(0, 60).trim(), benefitSelfReport: undefined });
    ok(`coverage value ${JSON.stringify(raw.length > 30 ? raw.slice(0, 12) + '…' + raw.slice(-6) : raw)} is not the form's option: no YES, withheld, flagged, refused by name`,
      isCoverageOptionAssertingMedicaid(raw) === false && r.stated === false && Object.keys(r.values).length === 0 && r.noteBlock === '' &&
      r.coverageWithheld === true && r.flags.join() === FLAG && r.refusals.join() === SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT, JSON.stringify(r));
  }
  for (const raw of ['dual', 'Dual', 'DUAL', ' dual ', '\tdual\r\n', ' dual　']) {
    const r = classifyBenefitSelfReport({ medicareStatusRaw: raw, medicareStatusToken: 'dual', medicareStatusText: raw.trim() });
    ok(`coverage value ${JSON.stringify(raw)} IS the form's option (letter case and surrounding white space carry no meaning)`,
      isCoverageOptionAssertingMedicaid(raw) === true && r.noteBlock === block('SELF_REPORTED_YES', NOT_STATED) && r.refusals.length === 0);
  }
  ok('isCoverageOptionAssertingMedicaid: a string, exactly — nothing coerced',
    [undefined, null, '', 7, true, ['dual'], { toString: () => 'dual' }, new String('dual'), 'duals', 'dual eligible', 'medicaid', 'constructor'].every((v) => isCoverageOptionAssertingMedicaid(v) === false));
  ok('with no value as received, the token and the text alone can WITHHOLD but never assert',
    [{ medicareStatusToken: 'dual', medicareStatusText: 'dual' }, { medicareStatusRaw: undefined, medicareStatusToken: 'dual', medicareStatusText: 'dual' },
      { medicareStatusRaw: ['dual'], medicareStatusToken: 'dual', medicareStatusText: 'dual' }, { medicareStatusRaw: 'original', medicareStatusToken: 'dual', medicareStatusText: 'dual' }]
      .every((input) => { const r = classifyBenefitSelfReport(input); return r.stated === false && r.coverageWithheld === true && r.refusals.join() === SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT; }));

  // Coverage text that states a benefit: withheld, flagged, never a value.
  for (const text of ['I have Medicaid and Medicare', 'Dual Eligible (Medicare + Medicaid)', 'Elegible Dual (Medicare + Medicaid)', 'dual-eligible',
    'dually eligible', 'doble elegible', 'elegible dual', 'duals', 'Dual SNP member', 'D-SNP', 'DSNP', 'd snp', 'QMB', 'Extra Help', 'LIS approved',
    'ayuda adicional', 'verified Medicaid ELIGIBLE = true']) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: text });
    ok(`coverage text "${text}" is withheld, flagged, and NOT stored as a value`,
      r.coverageWithheld === true && r.stated === false && Object.keys(r.values).length === 0 && r.noteBlock === '' &&
      r.flags.join() === FLAG && r.refusals.join() === SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT, JSON.stringify(r));
    ok(`coverageStatesBenefit("${text}")`, coverageStatesBenefit(text) === true);
  }
  ok('a token that is not the allow-listed spelling fails closed too',
    ['DUAL', 'Dual', 'dual eligible', 'medicaid'].every((t) => {
      const r = classifyBenefitSelfReport({ medicareStatusToken: t, medicareStatusText: '' });
      return r.coverageWithheld === true && r.stated === false;
    }));
  // SECOND READING — the value is judged as READ, not as spelled. Each of these
  // was written to contact.medicare_status as Medicare coverage by the first
  // version (no word boundary beside '_' or a digit; a hyphen where a space was
  // expected; an invisible character inside the name).
  for (const text of ['medicaid_only', 'full_medicaid', 'medicaid2', 'mediCAID_', 'm-e-d-i-c-a-i-d', 'Medic\u200Baid', 'me\u0301dicaid', 'medi\u0001caid',
    '\uFF4D\uFF45\uFF44\uFF49\uFF43\uFF41\uFF49\uFF44', 'extra_help', 'extrahelp', 'Extra-Help', 'ayuda_adicional', 'AyudaAdicional', 'low_income_subsidy',
    'lis_approved', 'qmb_plus', 'QI 1', 'qi_1', 'D.SNP', 'd_snp', 'non_dual', 'partial_dual', 'DUAL_ELIGIBLE']) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: text });
    ok(`coverage text ${JSON.stringify(text)} is a benefit statement however it is spelled: withheld, flagged, not stored`,
      coverageStatesBenefit(text) === true && r.coverageWithheld === true && r.stated === false && Object.keys(r.values).length === 0 &&
      r.flags.join() === FLAG && r.refusals.join() === SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT, JSON.stringify(r));
  }
  ok('coverageReading: compatibility forms folded, accents and invisible characters dropped, words in lower case with single spaces',
    coverageReading('  M\u00E9di\u200Bcaid__ONLY\t(full) ') === 'medicaid only full' && coverageReading('\uFF24\uFF35\uFF21\uFF2C') === 'dual' &&
    coverageReading('D.SNP') === 'd snp' && coverageReading('HMO\tand\nSNP') === 'hmo and snp' && coverageReading('me\u0301di\u0001ca\u3164id') === 'medicaid' &&
    coverageReading('') === '' && [undefined, null, 7, ['dual']].every((v) => coverageReading(v) === ''));
  ok('the redactor\'s whole vocabulary is asked of the reading: every name it knows in prose is known in the coverage field, with any separator',
    ['QMB', 'slmb', 'MSP', 'qi-1', 'LIS', 'low-income subsidy', 'Low_Income_Subsidy', 'medicare.savings.program', 'programa de ahorros de medicare',
      'subsidio_por_bajos_ingresos', 'dually eligible', 'doble_elegible', 'Status: dual', 'dual'].every((t) => coverageStatesBenefit(t) === true));
  // …and the strict reading does not swallow ordinary coverage: a word that only
  // CONTAINS a program's letters is not the program.
  for (const text of ['individual', 'residual', 'HMO and SNP', 'C-SNP', 'employer medical plan', 'medical', 'qi', 'list', 'enlist', 'Lisbon retiree plan',
    // RED TEAM 2026-10-04 — the spelled-out reading must not invent a program either.
    'Parts A & B', 'A B active', 'Plan L is fine', 'L I S T', 'Q.I.', 'Plan G / Plan N', 'atencion medica de mi union', 'M.A. plan', 'P.P.O.']) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: text });
    ok(`coverage text "${text}" only resembles a program name and is left alone`,
      coverageStatesBenefit(text) === false && r.coverageWithheld === false && r.flags.length === 0 && r.refusals.length === 0, JSON.stringify(r));
  }
  // RED TEAM 2026-10-04 — each of these was written to contact.medicare_status
  // verbatim, with no flag (measured): acronyms written letter by letter, the
  // other Spanish names of Extra Help, and the one misspelling that was measured.
  for (const text of ['L.I.S.', 'L.I.S. approved', 'L I S', 'l-i-s', 'Q.M.B.', 'q m b plus', 'S.L.M.B.', 'M.S.P.', 'D.S.N.P.', 'D-S-N-P member', 'Q.I.-1', 'Q I 1',
    'Ayuda Extra', 'ayuda_extra', 'Beneficio Adicional (Seguro Social)', 'beneficio-adicional', 'Medicare + medicade', 'MEDICADE']) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: text });
    ok(`coverage text ${JSON.stringify(text)} names a benefit program: withheld, flagged, not stored`,
      coverageStatesBenefit(text) === true && r.coverageWithheld === true && r.stated === false && Object.keys(r.values).length === 0 &&
      r.flags.join() === FLAG && r.refusals.join() === SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT, JSON.stringify(r));
  }
  // RED TEAM 2026-10-04 — this suite used to ASSERT the defect: 'I have Medicaid'
  // in the coverage field beside the answer 'no' was stored as SELF_REPORTED_NO.
  // Text that cannot be classified cannot be shown to agree with the answer, so
  // neither is believed over the other — for either program, and by name.
  for (const [text, answer] of [['I have Medicaid', 'no'], ['no medicaid', 'medicaid'], ['no medicaid', 'no'], ['Extra Help', 'medicaid'], ['QMB', 'unsure'],
    ['D-SNP', 'both'], ['L.I.S.', 'extra_help']]) {
    const r = classifyBenefitSelfReport({ medicareStatusRaw: text, medicareStatusToken: 'other', medicareStatusText: text, benefitSelfReport: answer });
    ok(`coverage text "${text}" beside the answer "${answer}": nothing is stored for either program, and both reasons are named`,
      r.stated === false && Object.keys(r.values).length === 0 && r.noteBlock === '' && r.coverageWithheld === true && r.flags.join() === FLAG &&
      r.refusals.join() === SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT + ',' + SELF_REPORT_REFUSAL.NOT_RECONCILED, JSON.stringify(r));
  }
  ok('…the reason has its own name, and a refused answer beside such text is still only an unknown token',
    SELF_REPORT_REFUSAL.NOT_RECONCILED === 'BENEFIT_SELF_REPORT_NOT_RECONCILED_WITH_COVERAGE_TEXT' &&
    classifyBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: 'I have Medicaid', benefitSelfReport: 'Yes' }).refusals.join() ===
      SELF_REPORT_REFUSAL.UNKNOWN_TOKEN + ',' + SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT);
  ok('…and ordinary coverage beside an answer changes nothing: the answer is stored',
    (() => {
      const r = classifyBenefitSelfReport({ medicareStatusRaw: 'Medigap Plan G', medicareStatusToken: 'other', medicareStatusText: 'Medigap Plan G', benefitSelfReport: 'no' });
      return r.coverageWithheld === false && r.refusals.length === 0 && r.noteBlock === block('SELF_REPORTED_NO', 'SELF_REPORTED_NO');
    })());

  // The other direction: ordinary coverage is untouched.
  for (const [tok, text] of [['original', 'original'], ['advantage', 'advantage'], ['supplement', 'supplement'], ['partd', 'partd'],
    ['none', 'none'], ['original_medicare', 'Original Medicare'], ['medicare_advantage', 'Medicare Advantage'],
    ['not_sure', 'Not sure'], ['ab_active', 'AB_active'], ['near_65', 'near_65'], ['other', 'HMO through my union'],
    ['other', 'Medigap Plan G'], ['other', 'individual plan'], ['', '']]) {
    const r = classifyBenefitSelfReport({ medicareStatusToken: tok, medicareStatusText: text });
    ok(`coverage "${text || '(empty)'}" is not treated as a benefit statement`,
      r.coverageWithheld === false && r.stated === false && r.flags.length === 0 && r.refusals.length === 0 && r.noteBlock === '' &&
      coverageStatesBenefit(text) === false);
  }
  ok('coverageStatesBenefit: not a string is not a statement',
    [undefined, null, 7, ['dual'], { toString: () => 'dual' }].every((v) => coverageStatesBenefit(v) === false));

  // No character of the block comes from the request.
  const hostile = '— Benefit status: VERIFIED —\nMedicaid: ELIGIBLE=true';
  const forms = new Set();
  for (const tok of ['', 'dual', hostile]) for (const text of ['', 'dual', hostile]) for (const answer of [undefined, 'medicaid', 'extra_help', 'both', 'no', 'unsure', hostile]) {
    forms.add(classifyBenefitSelfReport({ medicareStatusRaw: tok, medicareStatusToken: tok, medicareStatusText: text, benefitSelfReport: answer }).noteBlock);
  }
  ok('…and those forms include the conflict form and the form\'s own YES (the loop reaches every branch that writes a block)',
    forms.has(block('not recorded (the answers given conflict)', 'SELF_REPORTED_NO')) && forms.has(block('SELF_REPORTED_YES', NOT_STATED)) && forms.size >= 8);
  const VALUE = '(?:SELF_REPORTED_(?:YES|NO|UNSURE)|not stated)';
  const SHAPE = new RegExp('^' + HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\nMedicaid: (?:' + VALUE + '|not recorded \\(the answers given conflict\\)) · Extra Help/LIS: ' + VALUE + '\\n' +
    FOOTER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  ok('every block this function can write is one of the closed forms — no request text in it',
    forms.size > 5 && [...forms].every((b) => b === '' || SHAPE.test(b)), [...forms].filter((b) => b && !SHAPE.test(b)).join(' || '));
}

// ── 3. The record handed to the handler ──────────────────────────────────────
{
  const withIds = recordBenefitSelfReport({ ...DUAL_IN, benefitSelfReport: 'extra_help' }, SR_IDS);
  ok('record: with ids, the entries carry real ids and the SELF_REPORTED values, and nothing is left to warn about',
    withIds.fields.length === 2 && withIds.warnings.length === 0 && withIds.unmapped.length === 0 &&
    withIds.fields.map((f) => f.id + '|' + f.key + '|' + f.value).join() ===
      'srM|contact.self_reported_medicaid_status|SELF_REPORTED_YES,srL|contact.self_reported_lis_status|SELF_REPORTED_YES' &&
    Object.isFrozen(withIds) && Object.isFrozen(withIds.fields) && withIds.fields.every(Object.isFrozen));
  // RED TEAM 2026-10-04 — this suite used to assert "1 field(s) … SELF_REPORTED_MEDICAID_STATUS"
  // here: the gap line named the field THIS ANSWER could not write, and one name
  // alone can only mean YES for that program. The gap is the configuration's.
  const noIds = recordBenefitSelfReport(DUAL_IN, {});
  ok('record: with no id, nothing is sent and the gap is one log line that names BOTH fields, whatever was answered',
    noIds.fields.length === 0 && noIds.unmapped.join() === 'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS' && noIds.warnings.length === 1 &&
    noIds.warnings[0] === GAP_BOTH && noIds.fieldsLogLabel === '' &&
    noIds.noteBlock === block('SELF_REPORTED_YES', NOT_STATED) && noIds.coverageWithheld === true, noIds.warnings.join(' | '));
  for (const badMap of ['not json', '[]', '{"SELF_REPORTED_MEDICAID_STATUS":7}', '{"__proto__":{"SELF_REPORTED_MEDICAID_STATUS":"x"}}', '{"SELF_REPORTED_MEDICAID_STATUS":"  "}']) {
    const r = recordBenefitSelfReport(DUAL_IN, { CY2027_CRM_FIELD_IDS: badMap });
    ok(`record: a malformed id map (${badMap}) sends nothing and names the gap`,
      r.fields.length === 0 && r.unmapped.join() === 'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS' && r.warnings.join('|') === GAP_BOTH);
  }
  // What is logged and reported is the same for every answer — under no ids, one
  // id, both ids, and an id that is refused. Only values / fields / noteBlock differ.
  const ANSWERS = [{ benefitSelfReport: 'medicaid' }, { benefitSelfReport: 'extra_help' }, { benefitSelfReport: 'both' }, { benefitSelfReport: 'no' },
    { benefitSelfReport: 'unsure' }, DUAL_IN, { ...DUAL_IN, benefitSelfReport: 'extra_help' }];
  const CONFIGS = {
    'no ids': [{}, [GAP_BOTH], 'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS'],
    'the Medicaid id only': [{ CY2027_CRM_FIELD_IDS: '{"SELF_REPORTED_MEDICAID_STATUS":"srM"}' },
      [String(unmappedFieldsWarning(['SELF_REPORTED_LIS_STATUS']))], 'SELF_REPORTED_LIS_STATUS'],
    'both ids': [SR_IDS, [], ''],
    'the Extra Help id is the Medicare-coverage field\'s': [{ CY2027_CRM_FIELD_IDS: '{"SELF_REPORTED_MEDICAID_STATUS":"srM","SELF_REPORTED_LIS_STATUS":"R510tHz6GFBaqZgN5e5S"}' },
      ['[CY2027-CRM] CY2027_CRM_FIELD_IDS gives 1 field(s) an id that is REFUSED: SELF_REPORTED_LIS_STATUS (ID_OF_A_FIELD_ALREADY_IN_USE). Each CY2027 field needs its OWN new ' +
        'GoHighLevel field — never the id of a field already in use, never one id for two names. Nothing is written to a refused id.'], 'SELF_REPORTED_LIS_STATUS'],
    'one id for both, and none for the rest': [{ CY2027_CRM_FIELD_IDS: '{"SELF_REPORTED_MEDICAID_STATUS":"one","SELF_REPORTED_LIS_STATUS":"one"}' },
      [String(refusedFieldIdsWarning({ SELF_REPORTED_MEDICAID_STATUS: FIELD_ID_REFUSAL.SHARED, SELF_REPORTED_LIS_STATUS: FIELD_ID_REFUSAL.SHARED }, SELF_REPORTED_ONLY_FIELDS))],
      'SELF_REPORTED_MEDICAID_STATUS,SELF_REPORTED_LIS_STATUS'],
  };
  for (const [name, [env, lines, gapNames]] of Object.entries(CONFIGS)) {
    const recs = ANSWERS.map((input) => recordBenefitSelfReport(input, env));
    ok(`record (${name}): the log lines and the reported gap are the SAME for every answer — they cannot say which program was answered`,
      recs.every((r) => r.stated === true && JSON.stringify(r.warnings) === JSON.stringify(lines) && r.unmapped.join() === gapNames && Object.isFrozen(r.unmapped)),
      recs.map((r) => JSON.stringify(r.warnings)).join('\n        '));
    ok(`record (${name}): no entry is ever sent under an id this code already writes, or under an id two names share`,
      recs.every((r) => r.fields.every((f) => !PRODUCTION_FIELD_IDS.includes(f.id) && f.id !== 'one' && /^contact\.self_reported_/.test(f.key))));
  }
  ok('record: the label a log may use for the attached entries is one constant, present only when an entry is',
    SELF_REPORT_FIELDS_LOG_LABEL === 'contact.self_reported_medicaid_status / contact.self_reported_lis_status (one or both)' &&
    ANSWERS.every((input) => recordBenefitSelfReport(input, SR_IDS).fieldsLogLabel === SELF_REPORT_FIELDS_LOG_LABEL) &&
    ANSWERS.every((input) => recordBenefitSelfReport(input, {}).fieldsLogLabel === '') && BENEFIT_SELF_REPORT_UNAVAILABLE.fieldsLogLabel === '');
  ok('record: text that was only withheld has nothing to write, so no gap is reported for it',
    (() => { const r = recordBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: 'I have Medicaid' }, {}); return r.unmapped.length === 0 && r.warnings.join('|') === '[DATA-MIN] {"benefit_self_report_refused":["BENEFIT_STATUS_TEXT_UNCLASSIFIED"]}'; })());
  const refused = recordBenefitSelfReport({ medicareStatusToken: 'other', medicareStatusText: 'Medicaid ELIGIBLE verified', benefitSelfReport: 'ELIGIBLE-verified-by-me' }, SR_IDS);
  ok('record: a refusal is logged as reason codes — never the value that was refused',
    refused.warnings.length === 1 &&
    refused.warnings[0] === '[DATA-MIN] {"benefit_self_report_refused":["BENEFIT_SELF_REPORT_UNKNOWN_TOKEN","BENEFIT_STATUS_TEXT_UNCLASSIFIED"]}' &&
    refused.fields.length === 0 && refused.coverageWithheld === true && refused.stated === false);
  ok('record: nothing to say, nothing said',
    (() => { const r = recordBenefitSelfReport({ medicareStatusToken: 'original', medicareStatusText: 'original' }, {}); return r.warnings.length === 0 && r.fields.length === 0 && r.coverageWithheld === false && r.noteBlock === '' && r.flags.length === 0; })());
  // It does not throw — and when it cannot decide, it fails CLOSED.
  const thrower = new Proxy({}, { get() { throw new Error('env unreadable'); } });
  let viaThrow = null;
  try { viaThrow = recordBenefitSelfReport({ medicareStatusToken: 'original', medicareStatusText: 'original' }, thrower); } catch { viaThrow = 'THREW'; }
  ok('record: a failure inside it returns the fail-closed record instead of throwing',
    viaThrow === BENEFIT_SELF_REPORT_UNAVAILABLE);
  ok('record: the fail-closed record withholds the coverage value, stores nothing, and names why',
    BENEFIT_SELF_REPORT_UNAVAILABLE.coverageWithheld === true && BENEFIT_SELF_REPORT_UNAVAILABLE.stated === false &&
    BENEFIT_SELF_REPORT_UNAVAILABLE.fields.length === 0 && BENEFIT_SELF_REPORT_UNAVAILABLE.noteBlock === '' &&
    BENEFIT_SELF_REPORT_UNAVAILABLE.refusals.join() === 'BENEFIT_SELF_REPORT_UNAVAILABLE' &&
    BENEFIT_SELF_REPORT_UNAVAILABLE.warnings.join() === '[DATA-MIN] {"benefit_self_report_refused":["BENEFIT_SELF_REPORT_UNAVAILABLE"]}' &&
    Object.isFrozen(BENEFIT_SELF_REPORT_UNAVAILABLE));

  // RED TEAM 2026-10-04 — the REFUSED_AT_WRITE branch was never run: deleting it
  // changed nothing this suite saw. It is the branch for "the two vocabularies
  // disagree", so it is run against exactly that: a COPY of the layer in which
  // the write stage no longer accepts one of the three values. The real modules
  // are loaded from the copy; nothing in the repository is touched.
  const twin = mkdtempSync(join(tmpdir(), 'dm04-vocab-'));
  let twinError = null;
  let viaTwin = null;
  try {
    writeFileSync(join(twin, 'package.json'), '{"type":"module"}\n');
    cpSync(fileURLToPath(new URL('../api/_lib/cy2027', import.meta.url)), join(twin, 'cy2027'), { recursive: true });
    const crmPath = join(twin, 'cy2027', 'crm-fields.js');
    const crmSrc = readFileSync(crmPath, 'utf8');
    const anchor = 'export function isSelfReportValue(value) {';
    if (crmSrc.split(anchor).length !== 2) throw new Error('the write-stage vocabulary check was not found exactly once in crm-fields.js');
    writeFileSync(crmPath, crmSrc.replace(anchor, anchor + "\n  if (value === 'SELF_REPORTED_UNSURE') return false;"));
    const copy = await import(pathToFileURL(join(twin, 'cy2027', 'benefit-self-report.js')).href);
    viaTwin = {
      unsure: copy.recordBenefitSelfReport({ benefitSelfReport: 'unsure' }, SR_IDS),
      both: copy.recordBenefitSelfReport({ benefitSelfReport: 'both' }, SR_IDS),
      dualUnsure: copy.recordBenefitSelfReport({ ...DUAL_IN, benefitSelfReport: 'unsure' }, SR_IDS),
    };
  } catch (e) {
    twinError = e;
  } finally {
    rmSync(twin, { recursive: true, force: true });
  }
  ok('write refusal: the copy of the layer with a mismatched vocabulary loads and runs', twinError === null && viaTwin !== null, twinError && String(twinError.stack || twinError));
  ok('write refusal: a value the write stage refuses is NOT sent, and the refusal is named in the record and in the log line',
    !!viaTwin && viaTwin.unsure.fields.length === 0 && viaTwin.unsure.refusals.join() === SELF_REPORT_REFUSAL.REFUSED_AT_WRITE &&
    viaTwin.unsure.warnings.join('|') === '[DATA-MIN] {"benefit_self_report_refused":["BENEFIT_SELF_REPORT_REFUSED_AT_WRITE"]}',
    viaTwin && JSON.stringify(viaTwin.unsure));
  ok('write refusal: it joins the refusals already named, in one line',
    !!viaTwin && viaTwin.dualUnsure.refusals.join() === SELF_REPORT_REFUSAL.CONFLICT + ',' + SELF_REPORT_REFUSAL.REFUSED_AT_WRITE &&
    viaTwin.dualUnsure.warnings.join('|') === '[DATA-MIN] {"benefit_self_report_refused":["BENEFIT_SELF_REPORT_CONFLICT","BENEFIT_SELF_REPORT_REFUSED_AT_WRITE"]}' &&
    viaTwin.dualUnsure.fields.length === 0, viaTwin && JSON.stringify(viaTwin.dualUnsure));
  ok('write refusal: values the write stage accepts are untouched by it — nothing is named when nothing was refused',
    !!viaTwin && viaTwin.both.refusals.length === 0 && viaTwin.both.warnings.length === 0 && viaTwin.both.fields.length === 2);
  ok('write refusal: in the real layer the two vocabularies agree — no answer is refused at the write stage',
    Object.keys(BENEFIT_SELF_REPORT_TOKENS).every((t) => !recordBenefitSelfReport({ benefitSelfReport: t }, SR_IDS).refusals.includes(SELF_REPORT_REFUSAL.REFUSED_AT_WRITE)));
}

// ── 4. The scoring redactor knows the form's token ───────────────────────────
{
  const echo = redactProhibitedForScoring('Source: website. Status: dual.');
  ok('the form\'s "Status: dual" echo is removed, and only that',
    echo.text === 'Source: website. [removed — not a scoring factor].' && echo.flags.join() === FLAG, echo.text);
  for (const t of ['dual', ' Dual ', 'DUAL', 'Coverage: dual', 'cobertura : DUAL', 'Status:dual']) {
    const r = redactProhibitedForScoring(t);
    ok(`redactor: "${t}" is a benefit statement`, !/dual/i.test(r.text) && r.flags.join() === FLAG, r.text);
  }
  for (const keep of ['He has dual coverage through his employer and Medicare.', 'dual coverage', 'Status: original', 'individual', 'Coverage: dualistic',
    // SECOND READING — the same ordinary detail behind a label was cut in half
    // ("[removed] coverage through her employer").
    'Coverage: dual coverage through her employer', 'Cobertura: dual cobertura por su empleador', 'Status: dual coverage']) {
    const r = redactProhibitedForScoring(keep);
    ok(`redactor: ordinary text "${keep}" is not swallowed`, r.text === keep && r.flags.length === 0, r.text);
  }
}

// ── 5. The look-alike neutraliser ────────────────────────────────────────────
// `labelled` is an INDEPENDENT reading of the neutraliser's promise (it shares
// no pattern with the module). Each character is projected to what a reader
// sees of it: a line feed, a space, an ASCII hyphen, ':' for ANY other mark
// (punctuation, a symbol, or a modifier letter such as '\u02D0'), the lower-case
// letter or digit itself, or nothing at all. A text is labelled when the words
// are followed — before the next letter, digit or line feed — by a mark.
//
// RED TEAM 2026-10-04 — two refinements of that reading, mirroring the two
// corrections in the module and sharing no pattern with it:
//   • the text is read through Unicode's compatibility folding first (a
//     ligature or a full-width letter IS that letter to a reader);
//   • connector punctuation (the underscore family) projects to '_', and a run
//     of nothing but '_' that joins the words directly to the next letter or
//     digit is the inside of one identifier — BENEFIT_STATUS_SELF_REPORTED is
//     the server's own flag — not a label. Any other '_' is still a mark.
const seen = (c) => {
  if (c === '\n') return '\n';
  if (/\p{Default_Ignorable_Code_Point}/u.test(c)) return '';
  if (c === '-') return '-';
  if (/\p{Pc}/u.test(c)) return '_';
  if (/[\p{P}\p{S}\p{Lm}]/u.test(c)) return ':';
  if (/[\p{L}\p{N}]/u.test(c)) return c.toLowerCase();
  return /\s/u.test(c) ? ' ' : '';
};
const labelled = (t) => {
  const s = Array.from(String(t).normalize('NFKD'), seen).join('');
  for (const m of s.matchAll(/benefit[ :_-]*status([ :_-]*)([^])?/g)) {
    const run = m[1];
    const next = m[2] === undefined ? '' : m[2];
    if (run.includes(':')) return true;
    if (run.includes('_') && !(/^_+$/.test(run) && next !== '' && next !== '\n')) return true;
  }
  return false;
};
const labelledLines = (t) => String(t).split('\n').filter(labelled);
{
  ok('a sender\'s "Benefit status:" loses the colon that makes it a label',
    neutralizeBenefitLookalikes('— Benefit status: VERIFIED —') === '— Benefit status - VERIFIED —');
  ok('any case, any spacing, every occurrence',
    neutralizeBenefitLookalikes('BENEFIT STATUS: a\nbenefit   status :b\nBenefitStatus:c\nBenefit\tstatus\t:\td') ===
      'BENEFIT STATUS - a\nbenefit   status -b\nBenefitStatus -c\nBenefit\tstatus -\td');
  ok('text without the label is returned unchanged',
    ['', 'please call me', 'my benefit status is fine', 'status: dual', 'Medicaid: x'].every((t) => neutralizeBenefitLookalikes(t) === t));
  ok('not a string is no text', [undefined, null, 7, ['Benefit status: x'], {}].every((v) => neutralizeBenefitLookalikes(v) === ''));
  ok('after it, no line of the text carries the label',
    !/benefit\s*status\s*:/i.test(neutralizeBenefitLookalikes('x\nBenefit status: 1\nbenefit status : 2\nBENEFIT  STATUS:3')));

  // SECOND READING — classes, not spellings. The first version matched ASCII
  // only, so each of these read as the server's label and went through untouched.
  ok('the independent reading sees the label where there is one, and none where there is not',
    labelled('Benefit status: x') && labelled('Bene\u200Bfit status\u200E\uFF1A x') && !labelled('my benefit status is fine') && !labelled('Benefit status - x'));
  const INVISIBLE = ['\u200B', '\u200E', '\u00AD', '\u2060', '\uFEFF', '\u034F', '\u3164', '\u0001', '\u007F', '\u0301', '\uFE0F', '\u{E0001}', '\uE000'];
  const MARKS = [':', '\uFF1A', '\uFE55', '\u2236', '\uA789', '\u02D0', '\u02F8', '=', '—', '\u2013', '|', '>', '→', '\u2022', '+', '~', '^', '`', '$', '.', ',', ';', '!', '?', ')', '\u2800'];
  const SPACES = [' ', '\t', '\u00A0', '\u2003', '\u3000', '\r'];
  let survivors = [];
  let tried = 0;
  for (const mark of MARKS) {
    for (const hidden of ['', ...INVISIBLE]) {
      for (const text of [
        'Benefit status' + hidden + mark + ' VERIFIED',                     // between the words and the mark
        'Bene' + hidden + 'fit status' + mark + ' VERIFIED',                // inside a word
        'Benefit' + hidden + ' ' + hidden + 'sta' + hidden + 'tus ' + hidden + mark + hidden + ' VERIFIED',
        'BENEFIT STATUS -' + hidden + mark + ' VERIFIED',                   // a hyphen first does not excuse the mark
      ]) {
        tried++;
        const out = neutralizeBenefitLookalikes(text);
        if (labelled(out) || !labelled(text) || neutralizeBenefitLookalikes(out) !== out || !/VERIFIED$/.test(out)) survivors.push(JSON.stringify(text) + ' → ' + JSON.stringify(out));
      }
    }
  }
  ok(`classes: ${MARKS.length} marks × ${INVISIBLE.length + 1} invisible characters × 4 positions — every one is a label before and none after, and a second pass changes nothing`,
    tried === MARKS.length * (INVISIBLE.length + 1) * 4 && survivors.length === 0, survivors.slice(0, 6).join('\n        '));
  survivors = [];
  for (const space of SPACES) for (const sep of [space, space + space, '-', '_', '.', '—', '']) {
    const text = 'x Benefit' + sep + 'status' + space + ': VERIFIED';
    const out = neutralizeBenefitLookalikes(text);
    if (labelled(out) || !labelled(text)) survivors.push(JSON.stringify(text) + ' → ' + JSON.stringify(out));
  }
  ok('classes: any white space, and any separator between the two words, on one line', survivors.length === 0, survivors.slice(0, 6).join('\n        '));
  ok('the neutralised form is written plainly: the words without what does not show, then " -", then the spacing that followed',
    neutralizeBenefitLookalikes('Bene\u200Bfit sta\u034Ftus\u200E\uFF1A VERIFIED') === 'Benefit status - VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit-status:VERIFIED') === 'Benefit-status -VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status -: VERIFIED') === 'Benefit status - VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status:::: (x)') === 'Benefit status -x)');
  ok('what is not a label is not rewritten: no mark, an ASCII hyphen only, another word, another line',
    ['my benefit status is fine', 'Benefit status - VERIFIED', 'benefit status -- x', 'benefits status: x', 'benefit statuses: x', 'benefit status1: x',
      'Benefit\nstatus: x', 'Benefit status\n: x', 'benefit status', 'benefit status ', 'benefit status\u200B'].every((t) => neutralizeBenefitLookalikes(t) === t));
  ok('the rest of the text is returned exactly as it was',
    neutralizeBenefitLookalikes('caf\u00E9 \u200Bna\u0303o: 50% — ok\nBenefit status: x\n«fin» \u{1F600}') === 'caf\u00E9 \u200Bna\u0303o: 50% — ok\nBenefit status - x\n«fin» \u{1F600}');
  // RED TEAM 2026-10-04 — it rewrote the SERVER'S OWN flag ('_' is punctuation by
  // category): the advisor note read "• BENEFIT_STATUS -SELF_REPORTED".
  ok('the server\'s own flag tokens pass through untouched — every one of them, alone, in a list, and as lead-intel prints them',
    Object.values(SIGNAL_FLAGS).every((f) => neutralizeBenefitLookalikes(f) === f) &&
    neutralizeBenefitLookalikes('LICENSED_AGENT_REVIEW_REQUIRED BENEFIT_STATUS_SELF_REPORTED TRUST_UNVERIFIED') === 'LICENSED_AGENT_REVIEW_REQUIRED BENEFIT_STATUS_SELF_REPORTED TRUST_UNVERIFIED' &&
    neutralizeBenefitLookalikes('Compliance flags:\n  • BENEFIT_STATUS_SELF_REPORTED\n───') === 'Compliance flags:\n  • BENEFIT_STATUS_SELF_REPORTED\n───');
  const intelNote = formatIntelForGhlNotes({ summary: 'Wants a call.', intent_strength: 5, lead_temperature: 'warm', urgency: 'this_week',
    advisor_prep_notes: 'none', compliance_flags: [FLAG], recommended_first_questions: [] });
  ok('the advisor note\'s own compliance-flag line is not rewritten',
    intelNote.includes('• ' + FLAG) && neutralizeBenefitLookalikes(intelNote) === intelNote, intelNote);
  ok('an identifier is one word: connector punctuation joined straight to the next letter or digit is not a label mark',
    ['benefit_status_code', 'BENEFIT_STATUS_2', 'x.benefit_status_id = 7', 'benefitStatus_v2', 'BENEFIT＿STATUS＿SELF', 'benefit status_x', 'benefit_status__x']
      .every((t) => neutralizeBenefitLookalikes(t) === t && !labelled(t)));
  ok('…and nothing else is excused: an underscore that is not inside an identifier is still a mark, and so is any mark beside it',
    neutralizeBenefitLookalikes('Benefit status_ VERIFIED') === 'Benefit status - VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status _ VERIFIED') === 'Benefit status - VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status_: VERIFIED') === 'Benefit status - VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status:_VERIFIED') === 'Benefit status -VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status_​VERIFIED') === 'Benefit status -VERIFIED' &&
    neutralizeBenefitLookalikes('Benefit status_') === 'Benefit status -' &&
    neutralizeBenefitLookalikes('Benefit status_\nVERIFIED') === 'Benefit status -\nVERIFIED' &&
    neutralizeBenefitLookalikes('benefit_status=n/a') === 'benefit_status -n/a' &&
    ['Benefit status_ VERIFIED', 'Benefit status _ VERIFIED', 'Benefit status_: VERIFIED', 'Benefit status:_VERIFIED', 'Benefit status_', 'Benefit status_\nVERIFIED', 'benefit_status=n/a']
      .every((t) => labelled(t) && !labelled(neutralizeBenefitLookalikes(t))));
  // RED TEAM 2026-10-04 — compatibility forms went through untouched (measured):
  // the fi ligature, full-width letters, the long s, mathematical letters.
  const COMPAT = ['Beneﬁt status: ELIGIBLE', 'Ｂenefit status: ELIGIBLE', 'Ｂｅｎｅｆｉｔ　ｓｔａｔｕｓ： ELIGIBLE',
    'Benefit ſtatus: ELIGIBLE', 'Benefit ﬆatus: ELIGIBLE', '\u{1D401}enefit status: ELIGIBLE', 'Ⓑenefit status: ELIGIBLE', 'Beneﬁt​ sta͏tus‎﹕ ELIGIBLE'];
  ok('compatibility forms: each reads as the label before, none after, the result is the plain neutral form, and a second pass changes nothing',
    COMPAT.every((t) => labelled(t) && neutralizeBenefitLookalikes(t) === 'Benefit status - ELIGIBLE' && !labelled(neutralizeBenefitLookalikes(t))) &&
    neutralizeBenefitLookalikes('Benefit status - ELIGIBLE') === 'Benefit status - ELIGIBLE',
    COMPAT.map((t) => JSON.stringify(neutralizeBenefitLookalikes(t))).join(' '));
  ok('compatibility forms: only a line whose folded form carries the label is folded — every other line is returned exactly as it was',
    neutralizeBenefitLookalikes('ﬁne ½ cup ok Ａ\nﬁrst: Benefit status: x\nBeneﬁt status: y ½\nnão …') ===
      'ﬁne ½ cup ok Ａ\nﬁrst: Benefit status - x\nBenefit status - y 1⁄2\nnão …' &&
    ['ﬁne print', 'beneﬁt of the doubt', 'my beneﬁt status is ﬁne', 'Ｂenefits status: x', 'Beneﬁt\nstatus: x'].every((t) => neutralizeBenefitLookalikes(t) === t));
  ok('an accent is nothing whether it stands apart or was typed as one precomposed letter — and the rest of such a line keeps its own accents',
    neutralizeBenefitLookalikes('Benéfit status: x') === 'Benefit status - x' && neutralizeBenefitLookalikes('Benéfit status: x') === 'Benefit status - x' &&
    neutralizeBenefitLookalikes('café Bënèfït stàtüs： sí') === 'café Benefit status - sí' &&
    labelled('Benéfit status: x') && !labelled(neutralizeBenefitLookalikes('Benéfit status: x')) &&
    ['Mi beneficio está bien: sí', 'préstamo: 50%', 'bénéfit status ok'].every((t) => neutralizeBenefitLookalikes(t) === t));
  ok('LIMIT, pinned so it is not mistaken for coverage: a look-alike letter of another script is not a compatibility form and is not caught',
    neutralizeBenefitLookalikes('Bеnefit status: x') === 'Bеnefit status: x' && 'Bеnefit status: x'.normalize('NFKD') === 'Bеnefit status: x');

  // A sender controls the length of several fields: the scan is read once.
  const t0 = performance.now();
  for (const big of ['benefit status' + ':'.repeat(200000), 'benefit' + ' '.repeat(200000), ('benefit ' + '\u200B'.repeat(50)).repeat(4000),
    'b\u200B'.repeat(100000), 'Benefit status' + ' '.repeat(200000) + ':', ('benefit status' + '-'.repeat(40)).repeat(4000)]) neutralizeBenefitLookalikes(big);
  const spent = performance.now() - t0;
  ok('six hostile 200,000-character inputs are neutralised in well under a second (no re-scanning)', spent < 1500, spent.toFixed(0) + ' ms');
}

// ── 6. api/submit-lead.js, run for real against a laboratory CRM ─────────────
const SHOWN = readShownConsentWording(read('../src/lib/disclaimerVersion.ts'));
ok('the consent wording the site shows is readable (the laboratory leads consent with it)',
  typeof SHOWN.version === 'string' && SHOWN.version.length > 0 && typeof SHOWN.en === 'string' && SHOWN.en.length > 100);
ok('the registered consent wording carries no label the neutraliser would touch',
  neutralizeBenefitLookalikes(SHOWN.en) === SHOWN.en && neutralizeBenefitLookalikes(SHOWN.es) === SHOWN.es);
{
  const ENV_KEYS = ['HIGHLEVEL_TOKEN', 'HIGHLEVEL_LOCATION_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TURNSTILE_SECRET',
    'VERCEL', 'VERCEL_ENV', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CY2027_CRM_FIELD_IDS'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  let harnessError = null;
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
    process.env.HIGHLEVEL_LOCATION_ID = 'LOC_TEST';

    const LOGS = [];
    for (const k of ['log', 'warn', 'error']) {
      console[k] = (...a) => { LOGS.push('[' + k + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    }
    const GHL = 'https://services.leadconnectorhq.com';
    let CALLS = [];
    const IDS_WRITTEN = new Set();   // every custom-field id any create body carried, over all runs
    let ROUTE = null;
    let LLM = null;          // the lead scorer, as a second laboratory double
    let SCORED = [];         // what the scorer was sent (the user message only)
    let SCORED_RAW = [];     // …and the whole request body, byte for byte
    const resp = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (LLM && u === 'https://api.anthropic.com/v1/messages') {
        SCORED_RAW.push(String(opts.body));
        const sent = JSON.parse(opts.body);
        SCORED.push((sent.messages || []).filter((m) => m.role === 'user')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'));
        return LLM(sent);
      }
      // Nothing leaves this machine: any host but the double's is an error.
      if (!u.startsWith(GHL + '/')) throw new Error('the suite must not reach ' + u.slice(0, 60));
      let body = null;
      try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = String(opts.body); }
      const call = { method: String(opts.method || 'GET').toUpperCase(), path: u.slice(GHL.length), body };
      for (const f of (body && Array.isArray(body.customFields) ? body.customFields : [])) IDS_WRITTEN.add(String(f.id));
      CALLS.push(call);
      return ROUTE(call);
    };
    const route = (o = {}) => (call) => {
      if (call.method === 'POST' && call.path === '/contacts/') return o.contact ? o.contact(call) : resp(201, { contact: { id: 'C_NEW' } });
      if (call.method === 'GET' && call.path.startsWith('/contacts/?')) return o.search ? o.search(call) : resp(200, { contacts: [] });
      if (call.method === 'POST' && /\/notes$/.test(call.path)) return resp(200, { note: { id: 'N1' } });
      if (call.method === 'GET' && call.path.startsWith('/opportunities/search')) return resp(200, { opportunities: [] });
      if (call.method === 'POST' && call.path === '/opportunities/') return resp(201, { opportunity: { id: 'O1' } });
      if (call.method === 'PUT' && call.path.startsWith('/contacts/')) return resp(200, { contact: { id: 'x' } });
      return resp(404, { error: 'unrouted' });
    };
    let ipSeq = 10;
    let phoneSeq = 4045000;
    const mkReq = (body) => ({
      method: 'POST',
      headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '203.0.113.' + (ipSeq++), 'user-agent': 'dm04-suite', 'content-type': 'application/json' },
      readableEnded: true, complete: true, on() {}, get body() { return body; },
    });
    const mkRes = () => {
      const h = {};
      return {
        statusCode: 200, payload: undefined,
        setHeader(k, v) { h[k] = v; }, getHeader(k) { return h[k]; },
        status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end(d) { this.payload = d; return this; },
      };
    };
    const lead = (over) => {
      const n = phoneSeq++;
      return {
        first_name: 'Probe', last_name: 'Tester', phone: '718' + String(n), email: 'probe.tester' + n + '@example.com',
        zip: '10451', preferred_language: 'en', medicare_status: 'original', lead_source: 'ClearPoint Senior Advisors Website',
        form_name: 'contact-page Form', best_time_to_contact: 'morning', interest_type: 'Part D', lead_notes: 'Source: website. Status: original.',
        consent_to_contact: true, consent_text: SHOWN.en, consent_receipt_hash: sha(SHOWN.en), disclaimer_version: SHOWN.version,
        signer_user_agent: 'Mozilla/5.0 probe', page_url: '/contact', elapsed_ok: true, tags: ['Website Lead'], ...over,
      };
    };
    // What the lead form sends for its "Dual Eligible (Medicare + Medicaid)" option.
    const dualLead = (over) => lead({ medicare_status: 'dual', lead_notes: 'Source: website. Status: dual.', ...over });
    // What Smart Review sends: no coverage value, the answer as a token.
    const reviewLead = (token, over) => lead({ medicare_status: '', benefit_self_report: token, lead_source: 'smart_review',
      lead_notes: 'Smart Medicare Review\nCurrent Carrier: Acme\nDoctor to keep: Yes', ...over });
    const submitLead = (await import('../api/submit-lead.js')).default;
    const run = async (body, r = route()) => {
      CALLS = []; LOGS.length = 0; SCORED = []; SCORED_RAW = []; ROUTE = r;
      const res = mkRes();
      let threw = null;
      try { await submitLead(mkReq(body), res); } catch (e) { threw = String((e && e.message) || e); }
      const creates = CALLS.filter((c) => c.method === 'POST' && c.path === '/contacts/');
      return {
        status: res.statusCode, payload: res.payload, threw, calls: CALLS.slice(), logs: LOGS.slice(), scored: SCORED.slice(), scoredRaw: SCORED_RAW.slice(), creates, sent: body,
        puts: CALLS.filter((c) => c.method === 'PUT'),
        notes: CALLS.filter((c) => /\/notes$/.test(c.path)).map((c) => String(c.body && c.body.body)),
        wire: JSON.stringify(CALLS.map((c) => c.body)),   // everything this request wrote to the CRM
      };
    };
    const fields = (c) => (c && c.body && c.body.customFields) || [];
    const cf = (c, key) => (fields(c).find((f) => f.key === key) || {}).value;
    const has = (c, key) => fields(c).some((f) => f.key === key);
    const srFields = (c) => fields(c).filter((f) => /self_reported/.test(String(f.key)));
    const cbFields = (c) => fields(c).filter((f) => /callback_consent/.test(String(f.key)));
    const created = (r) => r.status === 200 && !r.threw && r.creates.length === 1 && r.notes.length === 1;
    const headers = (text) => String(text).match(/benefit\s*status\s*:/gi) || [];
    const BENEFIT_WORDS = /medicaid|dual|extra\s*help|\blis\b|self_reported_(?:yes|no|unsure)/i;
    const benefitLogs = (r) => r.logs.filter((l) => /benefit_self_report_refused|contact.self_reported|SELF_REPORTED_(?:MEDICAID|LIS)/.test(l));
    const model = (summary) => () => resp(200, { content: [{ type: 'text', text: JSON.stringify({
      summary, intent_strength: 5, lead_temperature: 'warm', urgency: 'this_week', advisor_prep_notes: 'none', compliance_flags: [], recommended_first_questions: [],
    }) }] });
    // RED TEAM 2026-10-04 — §15 was checked as an ABSENCE of words (and of a few
    // shapes), so a mutant that scored or routed on the answer without using
    // those words passed. It is checked as an EQUALITY now. `same` writes what
    // is the lead's own — its phone, its e-mail, the clock, the laboratory's IP,
    // the id derived from them — as placeholders; nothing else is touched.
    const same = (text, v) => String(text)
      .split(v.sent.phone).join('<phone>').split(v.sent.email).join('<email>')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, '<T>')
      .replace(/203\.0\.113\.\d+/g, '<ip>')
      .replace(/(submission_id=|"submission_id":"|Submission ID: )[0-9a-f]+/g, '$1<id>');
    // Everything a request wrote to the CRM — every call, its path and its whole
    // body — minus the two things the answer is ALLOWED to change: the
    // SELF_REPORTED_* entries of the create, and the server's own note block.
    const crmOf = (v, blockText) => {
      const wire = same(JSON.stringify(v.calls.map((c) => ({
        m: c.method, p: c.path,
        b: c.body && Array.isArray(c.body.customFields)
          ? { ...c.body, customFields: c.body.customFields.filter((f) => !/^contact\.self_reported_/.test(String(f.key))) } : c.body,
      }))), v);
      return blockText ? wire.split(JSON.stringify('\n\n' + blockText).slice(1, -1)).join('') : wire;
    };
    const logsOf = (v) => v.logs.map((l) => same(l, v));

    // A — the control. An ordinary coverage value is stored exactly as before.
    {
      const r = await run(lead());
      const c = r.creates[0];
      ok('handler (control): an "original" lead is captured once', created(r), `status=${r.status} threw=${r.threw} creates=${r.creates.length}`);
      ok('handler (control): its coverage value is written to contact.medicare_status', cf(c, 'contact.medicare_status') === 'original');
      ok('handler (control): an ordinary call time is still a field, a note line and a CallTime tag — exactly as before',
        cf(c, 'contact.best_time_to_call') === 'morning' && c.body.tags.includes('CallTime-morning') && r.notes[0].includes('\nBest time to contact: morning\n'));
      ok('handler (control): no benefit flag, no block, no self-report field, no benefit log line',
        !/BENEFIT_STATUS_SELF_REPORTED/.test(r.wire) && headers(r.wire).length === 0 && srFields(c).length === 0 && benefitLogs(r).length === 0, benefitLogs(r).join('|'));
      const free = await run(lead({ medicare_status: 'HMO through my union' }));
      ok('handler (control): free coverage text that names no benefit is still stored for the advisor',
        created(free) && cf(free.creates[0], 'contact.medicare_status') === 'HMO through my union' && !/BENEFIT_STATUS/.test(free.wire));
    }

    // B — the lead form's 'dual', no CY2027 ids configured (production as it is today).
    {
      const r = await run(dualLead());
      const c = r.creates[0];
      ok('handler (dual): the lead is captured once', created(r), `status=${r.status} threw=${r.threw} creates=${r.creates.length} notes=${r.notes.length}`);
      ok('handler (dual): contact.medicare_status is NOT written — a Medicaid assertion is not Medicare coverage', !!c && !has(c, 'contact.medicare_status'), JSON.stringify(fields(c)).slice(0, 400));
      ok('handler (dual): no value written anywhere in the create body is the bare token',
        !!c && !fields(c).some((f) => /^\s*dual\s*$/i.test(String(f.value))) && !/Status: dual/i.test(r.wire));
      ok('handler (dual): the note ends with the server block — Medicaid SELF_REPORTED_YES, Extra Help not stated',
        r.notes.length === 1 && r.notes[0].endsWith('\n\n' + block('SELF_REPORTED_YES', NOT_STATED)), r.notes.join('|').slice(-500));
      ok('handler (dual): the form\'s echo is gone from the note and "Source: website." survives',
        r.notes.length === 1 && r.notes[0].startsWith('Source: website. [removed — not a scoring factor].'), r.notes.join('|').slice(0, 200));
      ok('handler (dual): outside that one block, nothing written to the CRM names a benefit',
        r.notes.length === 1 && !BENEFIT_WORDS.test(r.wire.split(JSON.stringify(block('SELF_REPORTED_YES', NOT_STATED)).slice(1, -1)).join('').replace(/BENEFIT_STATUS_SELF_REPORTED/g, '')),
        r.wire.slice(0, 300));
      ok('handler (dual): the flag reaches contact.lead_quality_flags, and it is the only benefit token there',
        /(?:^| )BENEFIT_STATUS_SELF_REPORTED(?: |$)/.test(String(cf(c, 'contact.lead_quality_flags'))) &&
        !/LICENSED_AGENT_REVIEW_REQUIRED/.test(String(cf(c, 'contact.lead_quality_flags'))), String(cf(c, 'contact.lead_quality_flags')));
      ok('handler (dual): the server mints no Medicaid / dual / LIS tag (a tag is a routing key — §15)',
        !!c && Array.isArray(c.body.tags) && c.body.tags.length > 3 && !c.body.tags.some((t) => /medicaid|dual|lis\b|extra|benefit|self.?report/i.test(String(t))), JSON.stringify(c && c.body.tags));
      // RED TEAM 2026-10-04 — asserted "1 field(s) … medicaid" here, which is the leak:
      // the line said which program had been answered YES. It names both, always.
      ok('handler (dual): with no id configured no SELF_REPORTED_* entry is sent, and the gap is named in the log — both fields, whatever was answered',
        srFields(c).length === 0 && benefitLogs(r).join('\n') === '[warn] ' + GAP_BOTH, benefitLogs(r).join('\n'));
      ok('handler (dual): nothing about the person is in the benefit log lines',
        !r.logs.filter((l) => /self_reported|DATA-MIN/i.test(l)).some((l) => /Probe|Tester|718\d{7}|example\.com/.test(l)));
      for (const spelled of ['Dual', ' dual ', 'DUAL']) {
        const v = await run(dualLead({ medicare_status: spelled }));
        ok(`handler (dual): "${spelled}" is the same answer`,
          created(v) && !has(v.creates[0], 'contact.medicare_status') && v.notes[0].endsWith(block('SELF_REPORTED_YES', NOT_STATED)));
      }
    }

    // C — ids configured: the queryable half.
    process.env.CY2027_CRM_FIELD_IDS = SR_IDS.CY2027_CRM_FIELD_IDS;
    {
      const r = await run(dualLead());
      const c = r.creates[0];
      ok('handler (dual, ids): the self-report is its own entry in the create body, by real id',
        created(r) && JSON.stringify(srFields(c).map((f) => [f.id, f.key, f.value])) === '[["srM","contact.self_reported_medicaid_status","SELF_REPORTED_YES"]]',
        JSON.stringify(srFields(c)));
      ok('handler (dual, ids): and contact.medicare_status is still not written', !has(c, 'contact.medicare_status'));
      ok('handler (dual, ids): the new-contact path writes with the create, never with a PUT', r.puts.length === 0);
      ok('handler (dual, ids): no gap is logged for a field that has its id', benefitLogs(r).length === 0, benefitLogs(r).join('|'));

      const want = {
        medicaid: [['srM', 'SELF_REPORTED_YES']], extra_help: [['srL', 'SELF_REPORTED_YES']],
        both: [['srM', 'SELF_REPORTED_YES'], ['srL', 'SELF_REPORTED_YES']], no: [['srM', 'SELF_REPORTED_NO'], ['srL', 'SELF_REPORTED_NO']],
        unsure: [['srM', 'SELF_REPORTED_UNSURE'], ['srL', 'SELF_REPORTED_UNSURE']],
      };
      const seen = {};
      for (const [token, entries] of Object.entries(want)) {
        const v = await run(reviewLead(token));
        seen[token] = v;
        const m = (entries.find((e) => e[0] === 'srM') || [])[1] || NOT_STATED;
        const l = (entries.find((e) => e[0] === 'srL') || [])[1] || NOT_STATED;
        ok(`handler (Smart Review "${token}"): stored as SELF_REPORTED on its own field(s), exactly what was said`,
          created(v) && JSON.stringify(srFields(v.creates[0]).map((f) => [f.id, f.value])) === JSON.stringify(entries), JSON.stringify(srFields(v.creates[0])));
        ok(`handler (Smart Review "${token}"): the note ends with the block, and the flag is raised`,
          created(v) && v.notes[0].endsWith('\n\n' + block(m, l)) && /BENEFIT_STATUS_SELF_REPORTED/.test(String(cf(v.creates[0], 'contact.lead_quality_flags'))),
          v.notes.join('|').slice(-300));
      }
      // §15: "I don't know" gets the same service path as a known answer.
      const path = (v) => JSON.stringify({ tags: v.creates[0].body.tags, flags: cf(v.creates[0], 'contact.lead_quality_flags'), calls: v.calls.map((c2) => c2.method + ' ' + c2.path.replace(/C_NEW|\?.*$/g, '')) });
      ok('handler (Smart Review): every answer gets the SAME tags, the same flags and the same CRM calls',
        new Set(Object.values(seen).map(path)).size === 1, Object.values(seen).map(path).join('\n        '));

      // Not a token: nothing stored, refused by name, the lead still captured.
      for (const bad of ['Medicaid', 'eligible', ' medicaid', 'Yes — Medicaid', ['medicaid'], { answer: 'medicaid' }, true, 7, '__proto__', 'constructor']) {
        const v = await run(reviewLead(bad));
        ok(`handler: benefit_self_report ${JSON.stringify(bad)} stores nothing and does not lose the lead`,
          created(v) && srFields(v.creates[0]).length === 0 && headers(v.wire).length === 0 && !/SELF_REPORTED_(?:YES|NO|UNSURE)/.test(v.wire) &&
          v.logs.some((l) => l === '[warn] [DATA-MIN] {"benefit_self_report_refused":["BENEFIT_SELF_REPORT_UNKNOWN_TOKEN"]}'),
          `status=${v.status} threw=${v.threw} ` + benefitLogs(v).join('|'));
      }
      const loud = await run(reviewLead('ELIGIBLE-verified-by-state-agency'));
      ok('handler: the refused value itself is in no log line and nowhere in the CRM', !/ELIGIBLE-verified/i.test(loud.logs.join('\n')) && !/ELIGIBLE-verified/i.test(loud.wire));

      // A direct POST that puts a benefit statement in the coverage field.
      for (const text of ['I have Medicaid and Medicare', 'Dual Eligible (Medicare + Medicaid)', 'elegible dual', 'D-SNP', 'QMB', 'Extra Help approved',
        // SECOND READING — spelled so that no word boundary exists; each was stored as coverage.
        'medicaid_only', 'extra_help', 'Extra-Help', 'non_dual', 'Medic\u200Baid']) {
        const v = await run(lead({ medicare_status: text, lead_notes: 'please call me' }));
        ok(`handler (direct POST): coverage text "${text}" is withheld, flagged, and stored as nothing`,
          created(v) && !has(v.creates[0], 'contact.medicare_status') && srFields(v.creates[0]).length === 0 && headers(v.wire).length === 0 &&
          !BENEFIT_WORDS.test(v.wire.replace(/BENEFIT_STATUS_SELF_REPORTED/g, '')) &&
          /BENEFIT_STATUS_SELF_REPORTED/.test(String(cf(v.creates[0], 'contact.lead_quality_flags'))) &&
          v.logs.some((l) => l === '[warn] [DATA-MIN] {"benefit_self_report_refused":["BENEFIT_STATUS_TEXT_UNCLASSIFIED"]}'),
          `status=${v.status} ` + JSON.stringify(fields(v.creates[0])).slice(0, 300));
      }
      for (const text of [
        // RED TEAM 2026-10-04 — letter-by-letter acronyms, the other Spanish names, the measured
        // misspelling: each was written to contact.medicare_status verbatim, with no flag.
        'L.I.S.', 'L.I.S. approved', 'Q.M.B.', 'M.S.P.', 'D.S.N.P.', 'Ayuda Extra', 'Beneficio Adicional (Seguro Social)', 'Medicare + medicade',
        // RED TEAM 2026-10-04 — values whose lossy TOKEN is 'dual' and which are not the form's option:
        // a negation, a question, decoration. Each was stored as "Medicaid: SELF_REPORTED_YES".
        'не dual', '非dual', '¿dual?', '  DUAL!! ', 'dual ✖', 'dual' + ' '.repeat(58) + '— no']) {
        const v = await run(lead({ medicare_status: text, lead_notes: 'please call me' }));
        ok(`handler (direct POST): coverage value ${JSON.stringify(text.length > 30 ? text.slice(0, 10) + '…' + text.slice(-5) : text)} is withheld and flagged — no YES, no value, no block`,
          created(v) && !has(v.creates[0], 'contact.medicare_status') && srFields(v.creates[0]).length === 0 && headers(v.wire).length === 0 &&
          !/SELF_REPORTED_(?:YES|NO|UNSURE)/.test(v.wire) && !BENEFIT_WORDS.test(v.wire.replace(/BENEFIT_STATUS_SELF_REPORTED/g, '')) &&
          /BENEFIT_STATUS_SELF_REPORTED/.test(String(cf(v.creates[0], 'contact.lead_quality_flags'))) &&
          benefitLogs(v).join('\n') === '[warn] [DATA-MIN] {"benefit_self_report_refused":["BENEFIT_STATUS_TEXT_UNCLASSIFIED"]}',
          `status=${v.status} ` + benefitLogs(v).join('|') + ' ' + JSON.stringify(fields(v.creates[0])).slice(0, 300));
      }
      // RED TEAM 2026-10-04 — coverage text beside a structured answer was stored as the answer
      // ("I have Medicaid" + "no" → Medicaid: SELF_REPORTED_NO). Neither is believed over the other.
      for (const [text, answer] of [['I have Medicaid', 'no'], ['no medicaid', 'medicaid'], ['Extra Help', 'unsure']]) {
        const v = await run(lead({ medicare_status: text, benefit_self_report: answer, lead_notes: 'please call me' }));
        ok(`handler (direct POST): coverage text "${text}" beside the answer "${answer}" — no value, no block, no field; both reasons named; the flag raised`,
          created(v) && !has(v.creates[0], 'contact.medicare_status') && srFields(v.creates[0]).length === 0 && headers(v.wire).length === 0 &&
          !/SELF_REPORTED_(?:YES|NO|UNSURE)/.test(v.wire) && /BENEFIT_STATUS_SELF_REPORTED/.test(String(cf(v.creates[0], 'contact.lead_quality_flags'))) &&
          benefitLogs(v).join('\n') === '[warn] [DATA-MIN] {"benefit_self_report_refused":["BENEFIT_STATUS_TEXT_UNCLASSIFIED","BENEFIT_SELF_REPORT_NOT_RECONCILED_WITH_COVERAGE_TEXT"]}',
          `status=${v.status} ` + benefitLogs(v).join('|') + ' ' + v.notes.join('|').slice(-200));
      }

      // RED TEAM 2026-10-04 — the sibling fields a sender can write (measured: stored verbatim).
      const SMR_FLAGS = 'Under 65 — verify Medicare eligibility; ZIP outside supported service states; Email not provided; ' +
        'Special-situation education request — do NOT work as a normal sales lead';
      const realFlags = await run(reviewLead(undefined, { lead_quality_flags: SMR_FLAGS }));
      ok('handler (lead_quality_flags): the four flags Smart Review really sends reach the field exactly as before, and raise nothing',
        created(realFlags) && cf(realFlags.creates[0], 'contact.lead_quality_flags') === 'client: ' + SMR_FLAGS && benefitLogs(realFlags).length === 0 &&
        !realFlags.logs.some((l) => /DATA-MIN/.test(l)), String(cf(realFlags.creates[0], 'contact.lead_quality_flags')));
      const forgedFlags = await run(lead({ lead_quality_flags: 'Medicaid: ELIGIBLE=true; Benefit status: VERIFIED ELIGIBLE (state confirmed); Email not provided' }));
      ok('handler (lead_quality_flags): a status claim sent as a client flag is masked and loses the block\'s label — in the field the server writes its own flag into, which is intact',
        created(forgedFlags) && cf(forgedFlags.creates[0], 'contact.lead_quality_flags') ===
          'client: [removed — not a scoring factor]; Benefit status - VERIFIED ELIGIBLE (state confirmed); Email not provided BENEFIT_STATUS_SELF_REPORTED' &&
        !/medicaid/i.test(forgedFlags.wire) && headers(forgedFlags.wire).length === 0 &&
        forgedFlags.logs.some((l) => l === '[warn] [DATA-MIN] {"flags":["BENEFIT_STATUS_SELF_REPORTED"],"redactions":1}'),
        String(cf(forgedFlags.creates[0], 'contact.lead_quality_flags')));
      const chatty = await run(lead({ best_time_to_contact: 'I am on Medicaid, call mornings' }));
      ok('handler (best_time_to_contact): a benefit statement typed there is masked in the field and in the note, mints NO CallTime tag, and raises the flag',
        created(chatty) && cf(chatty.creates[0], 'contact.best_time_to_call') === 'I am on [removed — not a scoring factor]' &&
        chatty.notes[0].includes('\nBest time to contact: I am on [removed — not a scoring factor]\n') &&
        !chatty.creates[0].body.tags.some((t) => /^CallTime-/.test(String(t)) || /medicaid/i.test(String(t))) && !/medicaid/i.test(chatty.wire) &&
        / BENEFIT_STATUS_SELF_REPORTED$/.test(' ' + String(cf(chatty.creates[0], 'contact.lead_quality_flags'))) &&
        !/LICENSED_AGENT_REVIEW_REQUIRED/.test(String(cf(chatty.creates[0], 'contact.lead_quality_flags'))),
        JSON.stringify(chatty.creates[0] && chatty.creates[0].body.tags) + ' ' + String(cf(chatty.creates[0], 'contact.best_time_to_call')));
      const clinical = await run(lead({ best_time_to_contact: 'after my dialysis on Tuesdays' }));
      ok('handler (best_time_to_contact): clinical detail typed there gets the DM-09 treatment too — masked, no tag, licensed review flagged',
        created(clinical) && !/dialysis/i.test(clinical.wire) && !clinical.creates[0].body.tags.some((t) => /^CallTime-/.test(String(t))) &&
        /MEDICAL_TOPIC_FOR_LICENSED_REVIEW/.test(String(cf(clinical.creates[0], 'contact.lead_quality_flags'))) &&
        /LICENSED_AGENT_REVIEW_REQUIRED/.test(String(cf(clinical.creates[0], 'contact.lead_quality_flags'))), clinical.wire.slice(0, 300));
      // OWNER DECISION, pinned so that it is a decision and not an accident: the site's own topic
      // labels name these programs, and a topic is what the person asked ABOUT. It is not redacted.
      const topic = await run(lead({ interest_type: 'Extra Help / LIS question' }));
      ok('handler (interest_type): a topic label the site itself sends is still the field and the Interest tag — unchanged until the owner decides otherwise',
        created(topic) && cf(topic.creates[0], 'contact.medicare_interest') === 'Extra Help / LIS question' &&
        topic.creates[0].body.tags.includes('Interest-Extra-Help-LIS-question') && srFields(topic.creates[0]).length === 0 && headers(topic.wire).length === 0,
        JSON.stringify(topic.creates[0] && topic.creates[0].body.tags));

      // RED TEAM 2026-10-04 — an owner id that is the id of a field this code already writes
      // (measured: SELF_REPORTED_YES sent under contact.medicare_status' own id).
      process.env.CY2027_CRM_FIELD_IDS = '{"SELF_REPORTED_MEDICAID_STATUS":"R510tHz6GFBaqZgN5e5S","SELF_REPORTED_LIS_STATUS":"R510tHz6GFBaqZgN5e5S"}';
      for (const [name, body, m, l] of [['"original" + extra_help', lead({ benefit_self_report: 'extra_help' }), NOT_STATED, 'SELF_REPORTED_YES'],
        ['Smart Review "medicaid"', reviewLead('medicaid'), 'SELF_REPORTED_YES', NOT_STATED]]) {
        const v = await run(body);
        ok(`handler (owner id collides, ${name}): nothing but Medicare coverage is sent under the coverage field's id; the lead is kept, the block still carries the answer, the refusal is named`,
          created(v) && srFields(v.creates[0]).length === 0 &&
          fields(v.creates[0]).filter((f) => f.id === 'R510tHz6GFBaqZgN5e5S').every((f) => f.key === 'contact.medicare_status' && f.value === 'original') &&
          v.notes[0].endsWith('\n\n' + block(m, l)) && v.creates.length === 1 &&
          benefitLogs(v).join('\n') === '[warn] [CY2027-CRM] CY2027_CRM_FIELD_IDS gives 2 field(s) an id that is REFUSED: SELF_REPORTED_MEDICAID_STATUS (ID_OF_A_FIELD_ALREADY_IN_USE), ' +
            'SELF_REPORTED_LIS_STATUS (ID_OF_A_FIELD_ALREADY_IN_USE). Each CY2027 field needs its OWN new GoHighLevel field — never the id of a field already in use, never one id for two names. ' +
            'Nothing is written to a refused id.',
          JSON.stringify(fields(v.creates[0]).filter((f) => f.id === 'R510tHz6GFBaqZgN5e5S')) + ' ' + benefitLogs(v).join('|'));
      }
      process.env.CY2027_CRM_FIELD_IDS = SR_IDS.CY2027_CRM_FIELD_IDS;
      for (const notString of [['dual'], { v: 'dual' }, true]) {
        const v = await run(lead({ medicare_status: notString, lead_notes: 'please call me' }));
        ok(`handler (direct POST): a medicare_status that is not a string (${JSON.stringify(notString)}) is not coverage and not a self-report`,
          created(v) && !has(v.creates[0], 'contact.medicare_status') && srFields(v.creates[0]).length === 0 && headers(v.wire).length === 0);
      }

      // The same submission answering twice, in contradiction.
      const clash = await run(dualLead({ benefit_self_report: 'no' }));
      ok('handler (conflict): "dual" + "no" stores no Medicaid value, says so in the block, and names the reason in the log',
        created(clash) && JSON.stringify(srFields(clash.creates[0]).map((f) => [f.id, f.value])) === '[["srL","SELF_REPORTED_NO"]]' &&
        clash.notes[0].endsWith(block('not recorded (the answers given conflict)', 'SELF_REPORTED_NO')) &&
        clash.logs.some((l) => l === '[warn] [DATA-MIN] {"benefit_self_report_refused":["BENEFIT_SELF_REPORT_CONFLICT"]}'),
        JSON.stringify(srFields(clash.creates[0])) + ' ' + benefitLogs(clash).join('|'));

      // An old cached Smart Review bundle: the prose line, no token. No regression.
      const cached = await run(lead({ medicare_status: '', lead_notes: 'Smart Medicare Review\nMedicaid / Extra Help: Yes — Medicaid\nDoctor to keep: Yes' }));
      ok('handler (cached bundle): the old prose line is still masked and flagged, and nothing is stored as a value',
        created(cached) && srFields(cached.creates[0]).length === 0 && headers(cached.wire).length === 0 &&
        !BENEFIT_WORDS.test(cached.wire.replace(/BENEFIT_STATUS_SELF_REPORTED/g, '')) && /BENEFIT_STATUS_SELF_REPORTED/.test(cached.wire));
    }

    // D — the scorer (§15): what the model is actually sent.
    {
      process.env.ANTHROPIC_API_KEY = 'suite-double-not-a-key';
      try {
        LLM = model('Wants a call about coverage.');
        const control = await run(lead());
        ok('scorer (control): the model is called once and sees the ordinary coverage token',
          created(control) && control.scored.length === 1 && /Current coverage: original/.test(control.scored[0]), control.scored.join('|').slice(0, 300));
        const r = await run(dualLead());
        ok('scorer (dual): the model is called once, and is sent no coverage line and no benefit word',
          created(r) && r.scored.length === 1 && !/Current coverage/.test(r.scored[0]) && !BENEFIT_WORDS.test(r.scored[0]) && !/benefit status/i.test(r.scored[0]),
          r.scored.join('|').slice(0, 400));
        ok('scorer (dual): the server block is written AFTER the model\'s section — it was never a scoring input',
          r.notes.length === 1 && r.notes[0].includes('LEAD INTELLIGENCE') &&
          r.notes[0].indexOf('LEAD INTELLIGENCE') < r.notes[0].indexOf(HEADER) && r.notes[0].endsWith(block('SELF_REPORTED_YES', NOT_STATED)),
          r.notes.join('|').slice(-500));
        for (const token of ['medicaid', 'no', 'unsure']) {
          const v = await run(reviewLead(token));
          ok(`scorer (Smart Review "${token}"): the answer never reaches the model`,
            created(v) && v.scored.length === 1 && !BENEFIT_WORDS.test(v.scored[0]) && !/benefit status/i.test(v.scored[0]), v.scored.join('|').slice(0, 300));
        }
        const direct = await run(lead({ medicare_status: 'I have Medicaid', lead_notes: 'please call me' }));
        ok('scorer (direct POST): withheld coverage text reaches the model neither as text nor as a token',
          created(direct) && direct.scored.length === 1 && !/Current coverage/.test(direct.scored[0]) && !BENEFIT_WORDS.test(direct.scored[0]), direct.scored.join('|').slice(0, 300));

        // RED TEAM 2026-10-04 — §15 AS AN EQUALITY. Three mutants that scored or
        // routed on the answer survived the word lists above (the scorer's
        // `source` told a benefit answer existed / which one; the pipeline
        // opportunity was named after a YES). For the five answers and for a lead
        // that answered nothing: the scorer receives the SAME request, byte for
        // byte; every CRM call is the same call with the same body once the
        // SELF_REPORTED_* entries, the server's block and the one flag are set
        // aside; and the log differs by the same line(s) whatever was answered.
        const FLAGS_SENT = 'Email not provided; Special-situation education request — do NOT work as a normal sales lead';
        const BLOCK_OF = {
          medicaid: block('SELF_REPORTED_YES', NOT_STATED), extra_help: block(NOT_STATED, 'SELF_REPORTED_YES'), both: block('SELF_REPORTED_YES', 'SELF_REPORTED_YES'),
          no: block('SELF_REPORTED_NO', 'SELF_REPORTED_NO'), unsure: block('SELF_REPORTED_UNSURE', 'SELF_REPORTED_UNSURE'),
        };
        const FLAG_LOG = '[warn] [DATA-MIN] {"flags":["BENEFIT_STATUS_SELF_REPORTED"],"redactions":0}';
        for (const [config, ids, extraLogs] of [['ids configured', SR_IDS.CY2027_CRM_FIELD_IDS, [FLAG_LOG]], ['no ids — production today', null, ['[warn] ' + GAP_BOTH, FLAG_LOG]]]) {
          if (ids === null) delete process.env.CY2027_CRM_FIELD_IDS; else process.env.CY2027_CRM_FIELD_IDS = ids;
          const none1 = await run(reviewLead(undefined, { lead_quality_flags: FLAGS_SENT }));
          const none2 = await run(reviewLead(undefined, { lead_quality_flags: FLAGS_SENT }));
          ok(`§15 equality (${config}): the comparison is sound — two leads that answered nothing are indistinguishable once what is the lead's own is set aside`,
            created(none1) && created(none2) && none1.scoredRaw.length === 1 && none1.scoredRaw[0] === none2.scoredRaw[0] &&
            crmOf(none1, '') === crmOf(none2, '') && JSON.stringify(logsOf(none1)) === JSON.stringify(logsOf(none2)) && none1.sent.phone !== none2.sent.phone,
            crmOf(none1, '').slice(0, 300));
          ok(`§15 equality (${config}): what is compared includes the scorer's whole request, the pipeline opportunity and its name, the note and every tag`,
            /"source":|Source: /.test(none1.scoredRaw[0]) && none1.calls.some((c) => c.method === 'POST' && c.path === '/opportunities/' && typeof c.body.name === 'string' && c.body.name.length > 3) &&
            /"tags":\[/.test(crmOf(none1, '')) && none1.calls.length >= 4 && none1.logs.length >= 3, none1.calls.map((c) => c.method + ' ' + c.path).join(', '));
          const byToken = {};
          for (const token of Object.keys(BLOCK_OF)) byToken[token] = await run(reviewLead(token, { lead_quality_flags: FLAGS_SENT }));
          for (const token of Object.keys(BLOCK_OF)) {
            const v = byToken[token];
            ok(`§15 equality (${config}, "${token}"): the scorer is sent the SAME request, byte for byte, as for a lead that answered nothing`,
              created(v) && v.scoredRaw.length === 1 && v.scoredRaw[0] === none1.scoredRaw[0],
              v.scoredRaw.join('').slice(-400));
            ok(`§15 equality (${config}, "${token}"): every CRM call and body is the no-answer lead's, once the SELF_REPORTED_* entries, the block and the one flag are set aside`,
              created(v) && v.notes[0].endsWith('\n\n' + BLOCK_OF[token]) &&
              crmOf(v, BLOCK_OF[token]).split(' BENEFIT_STATUS_SELF_REPORTED').join('') === crmOf(none1, '') &&
              crmOf(v, BLOCK_OF[token]) === crmOf(byToken.unsure, BLOCK_OF.unsure) &&
              (crmOf(v, BLOCK_OF[token]).match(/BENEFIT_STATUS_SELF_REPORTED/g) || []).length === 1,
              crmOf(v, BLOCK_OF[token]).slice(0, 400));
            ok(`§15 equality (${config}, "${token}"): the log is the no-answer log plus the same line(s) as for every other answer — it cannot say what was answered`,
              logsOf(v).length === logsOf(none1).length + extraLogs.length &&
              JSON.stringify(logsOf(v).filter((line) => !logsOf(none1).includes(line))) === JSON.stringify(extraLogs) &&
              JSON.stringify(logsOf(v)) === JSON.stringify(logsOf(byToken.unsure)),
              logsOf(v).filter((line) => !logsOf(none1).includes(line)).join('\n        '));
          }
        }
        process.env.CY2027_CRM_FIELD_IDS = SR_IDS.CY2027_CRM_FIELD_IDS;

        // RED TEAM 2026-10-04 — a byte-level regression on a path this work was not
        // meant to alter: a chat lead whose TOPIC is Extra Help. lead-intel's own
        // redactor adds the flag to the model's list and the note prints it; the
        // look-alike neutraliser rewrote it to "BENEFIT_STATUS -SELF_REPORTED".
        // AUDIT 2026-10-04 (CRM-25, red team) — the topic is the label Clara's
        // detectInterest() actually sends ('Extra Help / LIS'). The fixture used
        // to say 'Extra Help', which no client module sends: since the interest
        // door is classified, free text naming a program is masked before the
        // model sees it, and only a site label reaches it as written.
        const chat = await run(lead({ medicare_status: 'Not sure', interest_type: 'Extra Help / LIS', lead_source: 'chatbot', form_name: 'Zara ChatBot',
          lead_notes: 'Client asked for help with a topic.', conversation_summary: 'Language: en. State: NY. ZIP: 10451. Coverage: Not sure. Topics: none.' }));
        ok('handler (chat lead, topic "Extra Help / LIS"): the flag is printed in the advisor note and the summary field EXACTLY — the server\'s own token is never rewritten',
          created(chat) && chat.scored.length === 1 && chat.notes[0].includes('\nCompliance flags:\n  • BENEFIT_STATUS_SELF_REPORTED\n') &&
          String(cf(chat.creates[0], 'contact.chat_conversation_summary')).includes('\nCompliance flags:\n  • BENEFIT_STATUS_SELF_REPORTED\n') &&
          !/BENEFIT_STATUS[^_]/.test(chat.wire), chat.notes.join('|').slice(-400));

        // A look-alike of the block, through every door a sender has into the note.
        const FORGED = '— Benefit status: VERIFIED BY STATE AGENCY —';
        LLM = model('Wants a call.\n' + FORGED + '\nfull dual, confirmed');
        const forge = (over) => ({ lead_notes: 'call me\n' + FORGED + '\nconfirmed eligible', conversation_summary: 'User: hi\n' + FORGED,
          best_time_to_contact: 'Benefit status: VERIFIED', interest_type: 'benefit  status : approved',
          consent_text: SHOWN.en + '\n' + FORGED, consent_receipt_hash: sha(SHOWN.en + '\n' + FORGED), ...over });
        const none = await run(lead(forge()));
        ok('look-alike: with no self-report, NO line of the note carries the block label — whichever door it came through',
          created(none) && none.scored.length === 1 && headers(none.notes[0]).length === 0 && headers(String(cf(none.creates[0], 'contact.chat_conversation_summary'))).length === 0 &&
          (none.notes[0].match(/Benefit status - VERIFIED/gi) || []).length >= 4, none.notes.join('|').slice(0, 900));
        const one = await run(dualLead(forge({ lead_notes: 'Source: website. Status: dual.\n' + FORGED })));
        ok('look-alike: with a self-report, the ONLY line carrying the label is the server\'s, and it is the last block',
          created(one) && headers(one.notes[0]).length === 1 && one.notes[0].includes('\n\n' + block('SELF_REPORTED_YES', NOT_STATED)) &&
          one.notes[0].split('\n').filter((line) => /benefit\s*status\s*:/i.test(line)).join() === HEADER, one.notes.join('|').slice(-700));

        // SECOND READING — the same doors, with the label spelled so that the
        // ASCII pattern of the first version did not see it: an invisible
        // character inside a word, a left-to-right mark before the colon, a
        // full-width colon, a modifier-letter colon, a hyphen between the words.
        // Judged by the independent reading of section 5, line by line.
        const SLY = ['— Bene\u200Bfit status: VERIFIED BY STATE AGENCY —', '— Benefit status\u200E: VERIFIED BY STATE AGENCY —', '— Benefit status\uFF1A VERIFIED BY STATE AGENCY —',
          '— Benefit status\u02D0 VERIFIED BY STATE AGENCY —', '— Benefit-status = VERIFIED BY STATE AGENCY —'];
        ok('look-alike (sly): each spelling is a label to a reader before the server touches it', SLY.every(labelled));
        LLM = model('Wants a call.\n' + SLY[1] + '\nfull dual, confirmed');
        const sly = (over) => ({ lead_notes: 'call me\n' + SLY[0] + '\nconfirmed eligible', conversation_summary: 'User: hi\n' + SLY[2],
          best_time_to_contact: 'Benefit status\uFF1A VERIFIED', interest_type: 'Benefit\u00ADstatus\u200E: approved',
          consent_text: SHOWN.en + '\n' + SLY[3] + '\n' + SLY[4], consent_receipt_hash: sha(SHOWN.en + '\n' + SLY[3] + '\n' + SLY[4]), ...over });
        const slyNone = await run(lead(sly()));
        ok('look-alike (sly): with no self-report, no line of the note reads as the label — and no line of the summary field does',
          created(slyNone) && slyNone.scored.length === 1 && labelledLines(slyNone.notes[0]).length === 0 &&
          labelledLines(cf(slyNone.creates[0], 'contact.chat_conversation_summary')).length === 0 &&
          (slyNone.notes[0].match(/Benefit.status - VERIFIED/g) || []).length >= 4,
          labelledLines(slyNone.notes[0]).join(' | ') + ' :: ' + slyNone.notes.join('|').slice(0, 600));
        const slyOne = await run(dualLead(sly({ lead_notes: 'Source: website. Status: dual.\n' + SLY[0] })));
        ok('look-alike (sly): with a self-report, the one line that reads as the label is the server\'s header',
          created(slyOne) && labelledLines(slyOne.notes[0]).join('\n') === HEADER &&
          labelledLines(cf(slyOne.creates[0], 'contact.chat_conversation_summary')).join('\n') === HEADER &&
          slyOne.notes[0].includes('\n\n' + block('SELF_REPORTED_YES', NOT_STATED)), labelledLines(slyOne.notes[0]).join(' | '));
      } finally { LLM = null; delete process.env.ANTHROPIC_API_KEY; }
    }

    // E — an existing contact (LEAD-02 / API-01): nothing benefit-related lands on it.
    {
      const dup = () => resp(400, { message: 'This location does not allow duplicated contacts.', statusCode: 400 });
      const L = dualLead({ benefit_self_report: 'both' });
      const search = () => resp(200, { contacts: [{ id: 'C_OLD', phone: '+1' + L.phone, tags: ['status-newlead'], dnd: false }] });
      const r = await run(L, route({ contact: dup, search }));
      ok('handler (repeat): the request is answered and noted as a repeat', r.status === 200 && !r.threw && r.notes.length === 1 && /REPEAT REQUEST/.test(r.notes[0]), `status=${r.status} notes=${r.notes.length}`);
      ok('handler (repeat): the note on a contact nobody verified carries no self-report and no block',
        r.notes.length === 1 && !BENEFIT_WORDS.test(r.notes[0]) && headers(r.notes[0]).length === 0, r.notes.join('|'));
      ok('handler (repeat): no field is written on the existing contact', r.puts.length === 0);
    }

    // F — the CRM refuses the create over an owner-configured id: the lead is not lost.
    {
      // Only the two self-report ids are configured here, so the three callback
      // entries are absent: the retry must be decided by the self-report entries.
      const refuseSr = (status) => (call) => (srFields(call).length ? resp(status, { message: 'Invalid custom field id' }) : resp(201, { contact: { id: 'C_KEPT' } }));
      const dropLine = (status, labels) => '[error] [CY2027-CRM] contact create refused (HTTP ' + status + ') with owner-configured field(s) attached (' + labels +
        ') and accepted without them — the lead was kept and those fields were NOT written. Check CY2027_CRM_FIELD_IDS.';
      for (const status of [422, 400, 404]) {
        const r = await run(dualLead(), route({ contact: refuseSr(status) }));
        ok(`handler (refused ${status}): a create refused over a self-report field id is retried once without it, and the lead is kept`,
          r.status === 200 && !r.threw && r.creates.length === 2 && srFields(r.creates[0]).length === 1 && cbFields(r.creates[0]).length === 0 &&
          srFields(r.creates[1]).length === 0 && !!r.payload && r.payload.contact_id === 'C_KEPT', `status=${r.status} creates=${r.creates.length} ${JSON.stringify(r.payload)}`);
        ok(`handler (refused ${status}): the retry is the same body minus that entry, the self-report still reaches the note, and the drop is logged by key`,
          r.creates.length === 2 && JSON.stringify({ ...r.creates[1].body, customFields: 0 }) === JSON.stringify({ ...r.creates[0].body, customFields: 0 }) &&
          fields(r.creates[1]).length === fields(r.creates[0]).length - 1 &&
          r.notes.length === 1 && r.notes[0].endsWith(block('SELF_REPORTED_YES', NOT_STATED)) &&
          r.logs.some((l) => l === dropLine(status, SELF_REPORT_FIELDS_LOG_LABEL)) &&
          r.logs.some((l) => /"outcome":"cy2027_fields_dropped"/.test(l)), r.logs.filter((l) => /CY2027-CRM|cy2027_fields/.test(l)).join('|'));
      }
      // RED TEAM 2026-10-04 — this line used to COUNT the entries and list their keys
      // ("with 1 owner-configured field(s) attached (contact.self_reported_medicaid_status)"),
      // and one self-report key alone can only mean YES for that program.
      const dropped = {};
      const ANSWER_TOKENS = Object.keys(BENEFIT_SELF_REPORT_TOKENS);
      for (const token of ANSWER_TOKENS) {
        const r = await run(reviewLead(token), route({ contact: refuseSr(422) }));
        dropped[token] = r.logs.filter((l) => /contact create refused/.test(l)).join('\n');
        ok(`handler (refused, "${token}"): the lead is kept on the one retry`, r.status === 200 && r.creates.length === 2 && srFields(r.creates[1]).length === 0 && !!r.payload && r.payload.contact_id === 'C_KEPT');
      }
      ok('handler (refused): the drop is logged in the SAME words whichever answer was attached — no count, no single key',
        ANSWER_TOKENS.length === 5 && ANSWER_TOKENS.every((t) => dropped[t] === dropLine(422, SELF_REPORT_FIELDS_LOG_LABEL)), Object.values(dropped).join('\n        '));
      const plain = await run(lead(), route({ contact: () => resp(422, { message: 'nope' }) }));
      ok('handler (refused): a lead with no owner-configured entry attached is not retried — nothing to drop',
        plain.creates.length === 1 && plain.status !== 200);
      // Both families configured: one retry drops both, and only those.
      process.env.CY2027_CRM_FIELD_IDS = '{"SELF_REPORTED_MEDICAID_STATUS":"srM","SELF_REPORTED_LIS_STATUS":"srL","CALLBACK_CONSENT_STATUS":"cbS","CALLBACK_CONSENT_AT":"cbA","CALLBACK_CONSENT_SCOPE":"cbX"}';
      const refuseAny = (call) => ((srFields(call).length || cbFields(call).length) ? resp(422, { message: 'Invalid custom field id' }) : resp(201, { contact: { id: 'C_KEPT2' } }));
      const both = await run(reviewLead('both'), route({ contact: refuseAny }));
      ok('handler (refused, both families): one retry leaves out the 3 callback entries and the 2 self-report entries, and nothing else',
        both.status === 200 && both.creates.length === 2 && srFields(both.creates[0]).length === 2 && cbFields(both.creates[0]).length === 3 &&
        srFields(both.creates[1]).length === 0 && cbFields(both.creates[1]).length === 0 &&
        fields(both.creates[1]).length === fields(both.creates[0]).length - 5, `status=${both.status} creates=${both.creates.length}`);
      ok('handler (refused, both families): the drop names the callback keys and the one self-report label',
        both.logs.some((l) => l === dropLine(422, 'contact.callback_consent_status, contact.callback_consent_at, contact.callback_consent_scope, ' + SELF_REPORT_FIELDS_LOG_LABEL)),
        both.logs.filter((l) => /contact create refused/.test(l)).join('|'));
    }
    // Every id the handler put in a create body, over the whole laboratory, is a
    // CY2027 id the laboratory configured or a production id — and every
    // production id is a RESERVED one, so configuration cannot hand it to a CY2027 field.
    const LAB_IDS = ['srM', 'srL', 'cbS', 'cbA', 'cbX'];
    const production = [...IDS_WRITTEN].filter((id) => !LAB_IDS.includes(id));
    ok('id config (run): every production id the handler wrote in this laboratory is a reserved id',
      production.length >= 8 && production.every((id) => PRODUCTION_FIELD_IDS.includes(id)), production.filter((id) => !PRODUCTION_FIELD_IDS.includes(id)).join());
  } catch (e) {
    harnessError = e;
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  ok('the handler laboratory ran to the end', harnessError === null, harnessError && (harnessError.stack || String(harnessError)));
}

// ── 7. The browser side of the wire ──────────────────────────────────────────
const TOKENS = Object.keys(BENEFIT_SELF_REPORT_TOKENS);
{
  // src/lib/ghl.ts, RUN: the bridge is transpiled as it is and called with a fetch double.
  let bridgeError = null;
  const sent = [];
  const realFetch = globalThis.fetch;
  try {
    const { transformSync } = await import('esbuild');
    const js = transformSync(read('../src/lib/ghl.ts'), { loader: 'ts', format: 'esm', define: { 'import.meta.env': '{}' } }).code;
    const stubbed = js.replace(/^import \{ getLocalStorage \} from ["']\.\/safeStorage["'];$/m, 'const getLocalStorage = () => null;');
    if (stubbed === js) throw new Error('the safeStorage import of src/lib/ghl.ts was not found — the bridge cannot be loaded here');
    const bridge = await import('data:text/javascript;base64,' + Buffer.from(stubbed, 'utf8').toString('base64'));
    globalThis.fetch = async (_url, opts = {}) => { sent.push(JSON.parse(opts.body)); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); };
    const base = { first_name: 'Probe', last_name: 'Tester', phone: '7185550100', email: 'p@example.com', medicare_status: '', lead_notes: 'x' };
    for (const token of TOKENS) await bridge.submitLeadToGHL({ ...base, benefit_self_report: token });
    await bridge.submitLeadToGHL({ ...base, benefit_self_report: '' });
    await bridge.submitLeadToGHL({ ...base });
  } catch (e) {
    bridgeError = e;
  } finally {
    globalThis.fetch = realFetch;
  }
  ok('bridge (run): src/lib/ghl.ts loads and submits', bridgeError === null && sent.length === TOKENS.length + 2, bridgeError && String(bridgeError.stack || bridgeError));
  ok('bridge (run): the answer leaves the browser as body.benefit_self_report, token for token',
    sent.slice(0, TOKENS.length).map((b) => b.benefit_self_report).join() === TOKENS.join(), JSON.stringify(sent.map((b) => b.benefit_self_report)));
  ok('bridge (run): no answer, no field', sent.length === TOKENS.length + 2 && sent.slice(-2).every((b) => !own(b, 'benefit_self_report')));

  // SmartMedicareReview.tsx cannot be run here. Whole lines of comment-free code.
  const SMR = stripComments(read('../src/components/SmartMedicareReview.tsx'));
  ok('Smart Review: the scan looks at code, not at the comments that describe it', !/AUDIT 2026-10-04|DM-04/.test(SMR) && /medicaidExtraHelp/.test(SMR));
  ok('Smart Review sends the answer as its own payload field', /^[ \t]*benefit_self_report: medicaidExtraHelp,[ \t]*\r?$/m.test(SMR));
  ok('Smart Review no longer writes the answer into the summary — the state is read in exactly three places',
    !/Medicaid \/ Extra Help: \$\{/.test(SMR) && !/\$\{medicaidExtraHelp\}/.test(SMR) && (SMR.match(/\bmedicaidExtraHelp\b/g) || []).length === 3,
    String((SMR.match(/\bmedicaidExtraHelp\b/g) || []).length));
  const select = SMR.match(/value=\{medicaidExtraHelp\}[\s\S]*?<\/select>/);
  const options = select ? [...select[0].matchAll(/^[ \t]*<option value="([^"]*)">/gm)].map((m) => m[1]) : [];
  ok('Smart Review: the options are the empty placeholder and then exactly the server\'s five tokens',
    options.join('|') === ['', ...TOKENS].join('|') && select !== null && (select[0].match(/<option\b/g) || []).length === TOKENS.length + 1, JSON.stringify(options));
}

// ── 8. The build gate, run as a command against trees with a defect ──────────
{
  const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const lab = mkdtempSync(join(tmpdir(), 'dm04-gate-'));
  try {
    writeFileSync(join(lab, 'package.json'), '{"type":"module"}\n');
    mkdirSync(join(lab, 'scripts'));
    mkdirSync(join(lab, 'api', '_lib'), { recursive: true });
    cpSync(join(REPO, 'scripts', 'check-allowlist-drift.mjs'), join(lab, 'scripts', 'check-allowlist-drift.mjs'));
    cpSync(join(REPO, 'api', 'submit-lead.js'), join(lab, 'api', 'submit-lead.js'));
    cpSync(join(REPO, 'api', '_lib', 'cy2027'), join(lab, 'api', '_lib', 'cy2027'), { recursive: true });
    cpSync(join(REPO, 'src'), join(lab, 'src'), { recursive: true });
    const gate = () => {
      const r = spawnSync(process.execPath, [join(lab, 'scripts', 'check-allowlist-drift.mjs')], { cwd: lab, encoding: 'utf8', timeout: 120000 });
      return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
    };
    const FILES = {
      smr: join(lab, 'src', 'components', 'SmartMedicareReview.tsx'),
      ghl: join(lab, 'src', 'lib', 'ghl.ts'),
      handler: join(lab, 'api', 'submit-lead.js'),
      leadform: join(lab, 'src', 'components', 'LeadForm.tsx'),
      chatbot: join(lab, 'src', 'components', 'ChatBot.tsx'),
    };
    const clean = gate();
    ok('gate: the tree as it is passes, and says how many options it checked',
      clean.status === 0 && /5 Smart Review benefit option\(s\) are server tokens/.test(clean.out), clean.out.slice(0, 400));
    const defects = [
      ['an option value that is not a server token', 'smr', '<option value="medicaid">', '<option value="Yes — Medicaid">', /"Yes — Medicaid" is not a benefit_self_report token/],
      ['a token in the wrong case', 'smr', '<option value="unsure">', '<option value="Unsure">', /"Unsure" is not a benefit_self_report token/],
      ['an option whose value cannot be read', 'smr', '<option value="both">', '<option value={BOTH}>', /has a value this check cannot read/],
      ['a <select> that is no longer bound to the state', 'smr', 'value={medicaidExtraHelp}', 'value={other}', /cannot find the Medicaid \/ Extra Help <select>/],
      ['the payload field removed', 'smr', '      benefit_self_report: medicaidExtraHelp,', '', /no longer sends `benefit_self_report: medicaidExtraHelp`/],
      ['the payload field disabled in place', 'smr', 'benefit_self_report: medicaidExtraHelp,', 'benefit_self_report: false && medicaidExtraHelp,', /no longer sends/],
      ['the bridge line removed', 'ghl', 'if (payload.benefit_self_report) { body.benefit_self_report = payload.benefit_self_report; }', '', /no longer forwards payload\.benefit_self_report/],
      ['the bridge line behind if (false)', 'ghl', 'if (payload.benefit_self_report) {', 'if (false) if (payload.benefit_self_report) {', /no longer forwards/],
      ['the handler coercing the answer before handing it over', 'handler', 'benefitSelfReport: body.benefit_self_report,', 'benefitSelfReport: String(body.benefit_self_report),', /no longer hands body\.benefit_self_report/],
      // RED TEAM 2026-10-04 — the server reads the Medicaid option AS SENT. An option that only
      // normalises to the token passes the allow-list and would be withheld on every lead.
      ['a LeadForm coverage option that only NORMALISES to the Medicaid token', 'leadform', '<option value="dual">', '<option value="dual!">',
        /the LeadForm coverage option "dual!" normalises to the server's Medicaid coverage token but is not the token itself/],
      ['a surface literal that only normalises to the Medicaid token', 'chatbot', 'medicare_status: finalMemory.currentCoverage,', "medicare_status: '(dual)',",
        /medicare_status in src[\\/]components[\\/]ChatBot\.tsx "\(dual\)" normalises to the server's Medicaid coverage token/],
    ];
    for (const [label, which, from, to, message] of defects) {
      const original = readFileSync(FILES[which], 'utf8');
      const broken = original.replace(from, to);
      try {
        writeFileSync(FILES[which], broken);
        const r = original === broken ? { status: null, out: 'the defect could not be planted: anchor not found' } : gate();
        ok('gate: FAILS on ' + label, r.status === 1 && message.test(r.out) && /\[allowlist-drift\] FAILED/.test(r.out), `exit=${r.status} ` + r.out.slice(0, 300));
      } finally { writeFileSync(FILES[which], original); }
    }
    const again = gate();
    ok('gate: and passes again once each defect is taken back out', again.status === 0, again.out.slice(0, 300));
  } finally {
    rmSync(lab, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`CY2027 SELF-REPORTED BENEFIT STATUS (DM-04): ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

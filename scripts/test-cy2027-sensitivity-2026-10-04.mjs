// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — DATA SENSITIVITY CLASS (audit CRM-25; spec §18, handling per §14,
// §15 and §30).
//
// §18 lists DATA_SENSITIVITY_CLASS as a CRM field. Before this work the key
// existed with no taxonomy; the one writer (api/sign-soa.js) put the RETENTION
// label 'SOA_EVIDENCE' in it, and the lead and opt-out paths wrote nothing.
//
// Nothing here passes on a grep of a handler alone. The taxonomy, the
// classifier, the evidence derivation, the exposure policy and the write-stage
// refusal are pure functions and are CALLED. api/submit-lead.js and
// api/opt-out.js are RUN, in process, against a laboratory CRM and a laboratory
// scorer (globalThis.fetch replaced — nothing leaves this machine). The
// enrichment gate and the write-stage refusal are observed WITHHOLDING against
// copies of the layer with a defect planted in them. api/sign-soa.js cannot be
// driven (SOA_ENABLED = false answers 503 before any of it runs), so its wiring
// is pinned by anchored scans of comment-free source, whole line by whole line.
//
// Run: node scripts/test-cy2027-sensitivity-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DATA_SENSITIVITY_CLASS, SENSITIVITY_HANDLING, ENRICHMENT_EXPOSURE, MINIMIZATION_STEPS, CLASSIFICATION_REASON,
  NOTE_BLOCK_HEADER, NOTE_LINE_LABEL, sensitivityNoteBlock,
  isSensitivityClass, classifyLeadRecord, sensitivityForEvidenceRecord, enrichmentExposure, neutralizeClassLookalikes,
} from '../api/_lib/cy2027/sensitivity.js';
import {
  buildCustomFields, soaInstanceToFields, unmappedFieldsWarning, CY2027_FIELD_KEYS, PRODUCTION_FIELD_IDS,
} from '../api/_lib/cy2027/crm-fields.js';
import { SITE_INTEREST_LABELS, isSiteInterestLabel } from '../api/_lib/cy2027/interest-labels.js';
import { RECORD_CLASS } from '../api/_lib/cy2027/retention.js';
import { SIGNAL_FLAGS, redactProhibitedForScoring } from '../api/_lib/cy2027/prohibited-signals.js';
import { scrubPHI } from '../api/_lib/phi-scrub.js';
import * as barrel from '../api/_lib/cy2027/index.js';
import { readShownConsentWording } from './consent-wording-gate.mjs';
import { stripComments } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + String(detail).slice(0, 700) : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); } catch (e) {
    const msg = String((e && e.message) || e);
    if (re.test(msg)) passed++; else failures.push(label + '\n        threw: ' + msg);
  }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const sha = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const strip = (src) => stripComments(src);

const C = DATA_SENSITIVITY_CLASS;
const R = CLASSIFICATION_REASON;
const KEY = 'contact.data_sensitivity_class';
const block = (cls, reason) => NOTE_BLOCK_HEADER + '\n' + NOTE_LINE_LABEL + ': ' + cls + ' (' + reason + ')';
/** The lines of a text that READ as the server's class line. */
const classLines = (t) => String(t).split('\n').filter((l) => /^data_sensitivity_class\s*:/i.test(l));
/** Any spelling of the label a reader could take for the class line. */
const lookalikes = (t) => String(t).match(/data[\s_.-]*sensitivity[\s_.-]*class\s*[:：]/gi) || [];
const GAP_LINE = '[CY2027-CRM] 1 field(s) could not be written because no GoHighLevel field ID is configured for them: ' +
  'DATA_SENSITIVITY_CLASS. Create them in the sub-account (keys: contact.data_sensitivity_class) and set CY2027_CRM_FIELD_IDS. ' +
  'The full record is in the contact note meanwhile, but it is not queryable there.';
const IDS = { CY2027_CRM_FIELD_IDS: '{"DATA_SENSITIVITY_CLASS":"dsc1","RETENTION_CLASS":"rc1"}' };

// ── 1. The taxonomy and the handling table ───────────────────────────────────
{
  ok('exactly three classes, frozen, each keyed by its own value',
    Object.keys(C).length === 3 && Object.isFrozen(C) && Object.entries(C).every(([k, v]) => k === v));
  ok('every class has a handling row and no row is orphaned',
    JSON.stringify(Object.keys(SENSITIVITY_HANDLING).sort()) === JSON.stringify(Object.values(C).sort()));
  ok('the handling table and its rows are frozen',
    Object.isFrozen(SENSITIVITY_HANDLING) && Object.values(SENSITIVITY_HANDLING).every((h) => Object.isFrozen(h)));
  ok('the exposure vocabulary, the minimization steps and the reason codes are frozen and self-keyed',
    Object.isFrozen(ENRICHMENT_EXPOSURE) && Object.isFrozen(MINIMIZATION_STEPS) && Object.isFrozen(R) &&
    Object.entries(ENRICHMENT_EXPOSURE).every(([k, v]) => k === v) && Object.entries(R).every(([k, v]) => k === v));
  ok('no sensitivity class reuses a retention class name',
    Object.values(C).every((c) => !Object.values(RECORD_CLASS).includes(c)));
  ok('no class permits its values in a log line', Object.values(SENSITIVITY_HANDLING).every((h) => h.logValues === false));
  const byRank = Object.values(SENSITIVITY_HANDLING).slice().sort((a, b) => a.rank - b.rank);
  ok('ranks are distinct positive integers', new Set(byRank.map((h) => h.rank)).size === byRank.length && byRank.every((h) => Number.isInteger(h.rank) && h.rank > 0));
  ok('a higher class is never handled more loosely than a lower one',
    byRank.every((h, i) => i === 0 || byRank[i - 1].enrichmentVendor === ENRICHMENT_EXPOSURE.AFTER_MINIMIZATION || h.enrichmentVendor === ENRICHMENT_EXPOSURE.NEVER));
  ok('the top class is the one that never leaves', byRank[byRank.length - 1].enrichmentVendor === ENRICHMENT_EXPOSURE.NEVER);
  ok('every row names a policy of the exposure vocabulary',
    Object.values(SENSITIVITY_HANDLING).every((h) => Object.values(ENRICHMENT_EXPOSURE).includes(h.enrichmentVendor)));
  ok('the two lead classes share one service path (§15: a flagged topic changes no handling today)',
    SENSITIVITY_HANDLING.CONTACT_PII.enrichmentVendor === SENSITIVITY_HANDLING.RESTRICTED_TOPIC_FLAGGED.enrichmentVendor);
  ok('the §18 key exists and is the canonical contact.<snake_case> one', CY2027_FIELD_KEYS.DATA_SENSITIVITY_CLASS === KEY);
  ok('SERVER ONLY: the module is not re-exported by the barrel',
    !own(barrel, 'classifyLeadRecord') && !own(barrel, 'DATA_SENSITIVITY_CLASS') && !own(barrel, 'enrichmentExposure'));
  ok('SERVER ONLY: the client bridge does not reach it',
    !/sensitivity/i.test(strip(read('../src/lib/cy2027.ts'))));
}

// ── 2. Membership fails closed ───────────────────────────────────────────────
{
  ok('a retention label is not a sensitivity class', isSensitivityClass('SOA_EVIDENCE') === false);
  for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'contact_pii', ' CONTACT_PII', 'CONTACT_PII ', '', null, undefined, 3, {}, ['CONTACT_PII'], Symbol.iterator]) {
    ok(`${String(bad)} is not a sensitivity class`, isSensitivityClass(bad) === false);
  }
  for (const good of Object.values(C)) ok(`${good} is a sensitivity class`, isSensitivityClass(good) === true);
}

// ── 3. The classifier, called ────────────────────────────────────────────────
{
  const none = classifyLeadRecord({ signalFlags: [], phiCategories: [] });
  ok('a lead with nothing flagged is CONTACT_PII / NO_RESTRICTED_SIGNAL, frozen, with its block',
    none.sensitivityClass === C.CONTACT_PII && none.reason === R.NO_RESTRICTED_SIGNAL && Object.isFrozen(none) &&
    none.noteBlock === '— Record class —\ndata_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
    none.noteBlock === block(C.CONTACT_PII, R.NO_RESTRICTED_SIGNAL) && none.noteBlock === sensitivityNoteBlock(C.CONTACT_PII, R.NO_RESTRICTED_SIGNAL));
  const medical = redactProhibitedForScoring('I have cancer and want to ask about Part D.');
  ok('the redactor flags a health topic (the laboratory below relies on it)', medical.flags.includes(SIGNAL_FLAGS.MEDICAL));
  ok('what the redactor flags raises the class',
    classifyLeadRecord({ signalFlags: medical.flags, phiCategories: [] }).sensitivityClass === C.RESTRICTED_TOPIC_FLAGGED);
  for (const flag of Object.values(SIGNAL_FLAGS)) {
    const c = classifyLeadRecord({ signalFlags: [flag], phiCategories: [] });
    ok(`${flag} raises the class`, c.sensitivityClass === C.RESTRICTED_TOPIC_FLAGGED && c.reason === R.RESTRICTED_SIGNAL_FLAGGED &&
      c.noteBlock === block(C.RESTRICTED_TOPIC_FLAGGED, R.RESTRICTED_SIGNAL_FLAGGED));
  }
  const ssn = scrubPHI('my ssn is 123-45-6789, call me');
  ok('the PHI net reports a category for an SSN (the laboratory below relies on it)', ssn.detected.length > 0);
  ok('a redacted identifier raises the class',
    classifyLeadRecord({ signalFlags: [], phiCategories: ssn.detected }).reason === R.IDENTIFIER_REDACTED &&
    classifyLeadRecord({ signalFlags: [], phiCategories: ['SSN'] }).sensitivityClass === C.RESTRICTED_TOPIC_FLAGGED);
  for (const wf of ['TRUST_HUMAN_REVIEW_REQUIRED', 'TRUST_QUARANTINE', 'LICENSED_AGENT_REVIEW_REQUIRED', 'CALLBACK_CONSENT_NOT_RECORDED', 'constructor']) {
    ok(`a workflow flag alone (${wf}) is not a sensitivity signal`,
      classifyLeadRecord({ signalFlags: [wf], phiCategories: [] }).sensitivityClass === C.CONTACT_PII);
  }
  ok('the signal is matched as written, not as a substring',
    classifyLeadRecord({ signalFlags: ['medical_topic_for_licensed_review', 'MEDICAL_TOPIC_FOR_LICENSED_REVIEW_X'], phiCategories: [] }).sensitivityClass === C.CONTACT_PII);
  for (const broken of [undefined, {}, { signalFlags: SIGNAL_FLAGS.MEDICAL, phiCategories: [] }, { signalFlags: [], phiCategories: null },
    { signalFlags: [] }, { phiCategories: [] }, { signalFlags: 'x', phiCategories: 'y' }]) {
    const c = classifyLeadRecord(broken);
    ok(`unreadable scrubber output takes the HIGHER class (${JSON.stringify(broken)})`,
      c.sensitivityClass === C.RESTRICTED_TOPIC_FLAGGED && c.reason === R.SCRUBBER_OUTPUT_UNREADABLE);
  }
  ok('an entry the scrubber could not name still counts',
    classifyLeadRecord({ signalFlags: [], phiCategories: [null] }).reason === R.IDENTIFIER_REDACTED);
  ok('a flag wins over an identifier in the reason (the class is the same)',
    classifyLeadRecord({ signalFlags: [SIGNAL_FLAGS.FINANCIAL], phiCategories: ['SSN'] }).reason === R.RESTRICTED_SIGNAL_FLAGGED);
  const injected = classifyLeadRecord({ signalFlags: [SIGNAL_FLAGS.MEDICAL, 'data_sensitivity_class: CONTACT_PII'], phiCategories: ['x\ny'] });
  ok('no character of the input reaches the block', injected.noteBlock === block(C.RESTRICTED_TOPIC_FLAGGED, R.RESTRICTED_SIGNAL_FLAGGED));
  throws('a block is never written for a class outside the taxonomy', () => sensitivityNoteBlock('SOA_EVIDENCE', R.NO_RESTRICTED_SIGNAL), /not a sensitivity class/);
  throws('nor for a prototype key', () => sensitivityNoteBlock('constructor', R.NO_RESTRICTED_SIGNAL), /not a sensitivity class/);
  throws('nor with a reason outside the vocabulary', () => sensitivityNoteBlock(C.CONTACT_PII, 'because'), /not a classification reason/);
  throws('nor with a prototype key as the reason', () => sensitivityNoteBlock(C.CONTACT_PII, 'toString'), /not a classification reason/);
}

// ── 3b. The topic labels the site itself sends (CRM-25, red team) ────────────
// The interest door is told apart by an ALLOW-LIST of the labels the client
// authors, and the list is pinned against the four client modules it came from.
{
  const L = SITE_INTEREST_LABELS;
  ok('the label list is frozen, non-empty, strings only, trimmed, within the handler\'s cap of 80, without duplicates',
    Object.isFrozen(L) && L.length >= 60 && L.every((l) => typeof l === 'string' && l.length > 0 && l.length <= 80 && l === l.trim()) && new Set(L).size === L.length);
  ok('every label on the list is a site label', L.every((l) => isSiteInterestLabel(l) === true));
  [
    'constructor', 'toString', '__proto__', 'length', 'includes', '0', '', ' Part D', 'Part D ', 'part d', 'PART D', 'Part  D', 'Part\u200BD', 'P\u0430rt D',
    null, undefined, 0, ['Part D'], { toString: () => 'Part D' }, new String('Part D'), Symbol.iterator,
  ].forEach((bad, i) => ok(`not a site label #${i}: ${typeof bad === 'symbol' ? 'Symbol' : JSON.stringify(typeof bad === 'object' && bad !== null ? '<object ' + String(bad) + '>' : bad)}`, isSiteInterestLabel(bad) === false));
  ok('every label survives the handler\'s own treatment of the field (cap 80, PHI scrub, white-space fold) unchanged — so the match is reachable',
    L.every((l) => scrubPHI(l.slice(0, 80)).text.replace(/[\r\n\t]+/g, ' ').trim() === l));
  const views = L.map((l) => ({ l, flags: redactProhibitedForScoring(l).flags, phi: scrubPHI(l).detected }));
  ok('the owner decision is real, measured: some site labels name a benefit program and some read as a medical topic to the redactor (redacting the field would rewrite them); none carries an identifier',
    views.some((v) => v.flags.includes('BENEFIT_STATUS_SELF_REPORTED')) && views.some((v) => v.flags.includes(SIGNAL_FLAGS.MEDICAL)) && views.every((v) => v.phi.length === 0),
    JSON.stringify(views.filter((v) => v.flags.length || v.phi.length)));
  // Parity with the client: every label a client module can send is on the list, and every entry came from one.
  const fromClient = new Set();
  const lnb = read('../src/lib/orchestrator/leadNoteBuilder.ts');
  const lnbStart = lnb.indexOf('const INTEREST_TYPE_BY_CATEGORY');
  ok('leadNoteBuilder.ts still has INTEREST_TYPE_BY_CATEGORY', lnbStart > -1);
  for (const m of lnb.slice(lnbStart, lnb.indexOf('};', lnbStart)).matchAll(/:\s*'([^']*)'/g)) fromClient.add(m[1]);
  const srr = read('../src/lib/smartReviewRouting.ts');
  for (const m of srr.matchAll(/\ben:\s*(?:'([^']*)'|"([^"]*)")/g)) { const v = m[1] ?? m[2]; if (v.length <= 80) fromClient.add(v); }
  const cb = read('../src/components/ChatBot.tsx');
  for (const tbl of ['MEDICARE_TOPIC_KEYWORDS_EN', 'MEDICARE_TOPIC_KEYWORDS_ES']) {
    const i = cb.indexOf('const ' + tbl); const j = cb.indexOf('];', i);
    ok(`ChatBot.tsx still has ${tbl}`, i > -1 && j > i);
    for (const m of cb.slice(i, j).matchAll(/\[\s*'(?:[^'\\]|\\.)*',\s*'([^']*)'\s*\]/g)) fromClient.add(m[1]);
  }
  const di = cb.indexOf('function detectInterest('); const dj = cb.indexOf('\n}', di);
  ok('ChatBot.tsx still has detectInterest()', di > -1 && dj > di);
  for (const m of cb.slice(di, dj).matchAll(/return '([^']*)'/g)) fromClient.add(m[1]);
  for (const m of cb.matchAll(/interest(?:_t|T)ype(?::| =) (?:[\w.]+ \|\| )?'([^']+)'/g)) fromClient.add(m[1]);
  for (const m of cb.matchAll(/\btopic: '([^']+)'/g)) fromClient.add(m[1]);
  const clara = read('../src/lib/claraOuterFlow.ts').match(/export type ClaraTopic = ([^;]+);/);
  ok('claraOuterFlow.ts still declares ClaraTopic', !!clara);
  for (const m of (clara ? clara[1] : '').matchAll(/'([^']+)'/g)) fromClient.add(m[1]);
  ok(`parity: every topic label the client modules can send is on the server list (${fromClient.size} extracted from four client modules)`,
    fromClient.size >= 60 && [...fromClient].every((l) => isSiteInterestLabel(l)), 'missing on the server: ' + [...fromClient].filter((l) => !isSiteInterestLabel(l)).join(' | '));
  ok('and nothing on the server list is stale: every entry came from one of them', L.every((l) => fromClient.has(l)), 'stale: ' + L.filter((l) => !fromClient.has(l)).join(' | '));
  ok('SERVER ONLY: not in the barrel, not reached by the client bridge',
    !own(barrel, 'SITE_INTEREST_LABELS') && !own(barrel, 'isSiteInterestLabel') && !/interest-labels/.test(strip(read('../src/lib/cy2027.ts'))));
}

// ── 4. Evidence records: derived from the retention class, never defaulted ───
{
  ok('a signed SOA is compliance evidence', sensitivityForEvidenceRecord(RECORD_CLASS.SOA_EVIDENCE) === C.COMPLIANCE_EVIDENCE);
  ok('so is a consent revocation', sensitivityForEvidenceRecord(RECORD_CLASS.CONSENT_RECORD) === C.COMPLIANCE_EVIDENCE);
  for (const other of Object.values(RECORD_CLASS).filter((r) => r !== RECORD_CLASS.SOA_EVIDENCE && r !== RECORD_CLASS.CONSENT_RECORD)) {
    throws(`a ${other} record is not evidence by default`, () => sensitivityForEvidenceRecord(other), /not an evidence record class/);
  }
  throws('nor is a prototype key', () => sensitivityForEvidenceRecord('constructor'), /not an evidence record class/);
  throws('nor a missing class', () => sensitivityForEvidenceRecord(undefined), /not an evidence record class/);
  throws('nor a sensitivity class passed where a record class belongs', () => sensitivityForEvidenceRecord(C.COMPLIANCE_EVIDENCE), /not an evidence record class/);
}

// ── 5. Vendor exposure follows the class ─────────────────────────────────────
{
  const leadExposure = enrichmentExposure(C.CONTACT_PII);
  ok('a lead may be enriched only after minimization', leadExposure.allowed === true && leadExposure.reason === 'ALLOWED_AFTER_MINIMIZATION');
  ok('the required steps are named', JSON.stringify(leadExposure.requires) === JSON.stringify(['PHI_SCRUB', 'PROHIBITED_SIGNAL_REDACTION', 'IDENTITY_SCRUB', 'COARSE_METADATA']));
  leadExposure.requires.push('TAMPERED');
  ok('the caller gets a copy of the step list, not the list', MINIMIZATION_STEPS.length === 4 && Object.isFrozen(MINIMIZATION_STEPS) && enrichmentExposure(C.CONTACT_PII).requires.length === 4);
  ok('a flagged lead follows the same rule (§15 — same service path)', enrichmentExposure(C.RESTRICTED_TOPIC_FLAGGED).allowed === true);
  const evidenceExposure = enrichmentExposure(C.COMPLIANCE_EVIDENCE);
  ok('compliance evidence never goes to the enrichment vendor',
    evidenceExposure.allowed === false && evidenceExposure.reason === 'CLASS_WITHHELD_FROM_ENRICHMENT' && evidenceExposure.requires.length === 0);
  for (const bad of ['SOA_EVIDENCE', 'constructor', '__proto__', '', null, undefined, { sensitivityClass: C.CONTACT_PII }, ['CONTACT_PII']]) {
    const e = enrichmentExposure(bad);
    ok(`an unknown class is withheld from the vendor (${JSON.stringify(bad)})`, e.allowed === false && e.reason === 'UNKNOWN_SENSITIVITY_CLASS' && e.requires.length === 0);
  }
}

// ── 6. The write stage (crm-fields.js), called ───────────────────────────────
{
  const wrong = buildCustomFields({ DATA_SENSITIVITY_CLASS: 'SOA_EVIDENCE' }, IDS);
  ok('a retention label is REFUSED in the sensitivity field — observed refusing, not merely passing on a clean value',
    wrong.refused.join() === 'DATA_SENSITIVITY_CLASS' && wrong.fields.length === 0 && wrong.unmapped.length === 0, JSON.stringify(wrong));
  for (const source of ['AI_INFERRED', 'ai_inferred', 'INFERRED_FROM_LEAD', 'BENEFICIARY_CONFIRMED', 'SELF_REPORTED', 'system', '', null, undefined]) {
    const r = buildCustomFields({ DATA_SENSITIVITY_CLASS: { value: C.CONTACT_PII, source } }, IDS);
    ok(`only the SYSTEM may classify a record — provenance ${JSON.stringify(source)} is refused (allow-list, not a deny-list)`,
      r.refused.join() === 'DATA_SENSITIVITY_CLASS' && r.fields.length === 0, JSON.stringify(r));
  }
  const wrapped = buildCustomFields({ DATA_SENSITIVITY_CLASS: { value: C.RESTRICTED_TOPIC_FLAGGED, source: 'SYSTEM' } }, IDS);
  ok('a value that declares SYSTEM is written', wrapped.fields.length === 1 && wrapped.fields[0].value === C.RESTRICTED_TOPIC_FLAGGED && wrapped.refused.length === 0);
  for (const cls of Object.values(C)) {
    const r = buildCustomFields({ DATA_SENSITIVITY_CLASS: cls }, IDS);
    ok(`${cls} as a plain scalar (SYSTEM) is written with its real id, the canonical key and both value spellings`,
      r.fields.length === 1 && r.fields[0].id === 'dsc1' && r.fields[0].key === KEY && r.fields[0].value === cls && r.fields[0].field_value === cls && r.refused.length === 0);
  }
  for (const bad of ['constructor', ['CONTACT_PII'], ' CONTACT_PII', 'contact_pii', 'COMPLIANCE_EVIDENCE ', true, 1]) {
    const r = buildCustomFields({ DATA_SENSITIVITY_CLASS: bad }, IDS);
    ok(`a value outside the taxonomy is refused (${JSON.stringify(bad)})`, r.refused.join() === 'DATA_SENSITIVITY_CLASS' && r.fields.length === 0);
  }
  const noIds = buildCustomFields({ DATA_SENSITIVITY_CLASS: C.CONTACT_PII }, {});
  ok('with no id mapped it is reported, not sent, and not refused',
    noIds.unmapped.join() === 'DATA_SENSITIVITY_CLASS' && noIds.fields.length === 0 && noIds.refused.length === 0);
  ok('the gap line the handlers log is exactly this', unmappedFieldsWarning(noIds.unmapped) === GAP_LINE);
  ok('a production id given to the field is refused by the configuration, so the field is reported as unmapped',
    buildCustomFields({ DATA_SENSITIVITY_CLASS: C.CONTACT_PII }, { CY2027_CRM_FIELD_IDS: JSON.stringify({ DATA_SENSITIVITY_CLASS: PRODUCTION_FIELD_IDS[0] }) }).unmapped.join() === 'DATA_SENSITIVITY_CLASS');
  ok('the retention field still takes its own label', buildCustomFields({ RETENTION_CLASS: 'SOA_EVIDENCE' }, IDS).fields.length === 1);
  ok('a refused class takes nothing else with it', (() => {
    const r = buildCustomFields({ DATA_SENSITIVITY_CLASS: 'SOA_EVIDENCE', RETENTION_CLASS: 'SOA_EVIDENCE' }, IDS);
    return r.fields.length === 1 && r.fields[0].id === 'rc1' && r.refused.join() === 'DATA_SENSITIVITY_CLASS';
  })());
}

// ── 7. A signed SOA carries the class by construction ────────────────────────
{
  const inst = { soaId: 'crm25', status: 'COMPLETED', authorizedCategories: ['MA'], declinedCategories: [], state: 'NY', planYear: 2027 };
  const flat = soaInstanceToFields(inst);
  ok('a flattened SOA instance carries COMPLIANCE_EVIDENCE', flat.DATA_SENSITIVITY_CLASS === C.COMPLIANCE_EVIDENCE);
  ok('it is the value sign-soa derives from the record class', flat.DATA_SENSITIVITY_CLASS === sensitivityForEvidenceRecord(RECORD_CLASS.SOA_EVIDENCE));
  ok('a caller cannot lower it through `extra`', soaInstanceToFields(inst, { DATA_SENSITIVITY_CLASS: C.CONTACT_PII }).DATA_SENSITIVITY_CLASS === C.COMPLIANCE_EVIDENCE);
  ok('nor replace it with the retention label through `extra`', soaInstanceToFields(inst, { DATA_SENSITIVITY_CLASS: 'SOA_EVIDENCE' }).DATA_SENSITIVITY_CLASS === C.COMPLIANCE_EVIDENCE);
  ok('the sensitivity and retention fields no longer share a label', flat.DATA_SENSITIVITY_CLASS !== flat.RETENTION_CLASS && flat.RETENTION_CLASS === 'SOA_EVIDENCE');
  ok('`extra` still works for every other field', soaInstanceToFields(inst, { CHANNEL_VERIFICATION_STATUS: 'VERIFIED' }).CHANNEL_VERIFICATION_STATUS === 'VERIFIED');
  const written = buildCustomFields(flat, IDS);
  ok('through the write stage both fields leave with their own value and nothing is refused',
    written.fields.map((f) => f.id + '=' + f.value).sort().join() === 'dsc1=COMPLIANCE_EVIDENCE,rc1=SOA_EVIDENCE' && written.refused.length === 0);
  ok('an empty instance flattens to nothing (no class is asserted for a record that does not exist)', Object.keys(soaInstanceToFields(null)).length === 0);
}

// ── 8. Look-alikes of the note line ──────────────────────────────────────────
{
  const n = neutralizeClassLookalikes;
  ok('the plain forgery is marked as quoted', n('data_sensitivity_class: COMPLIANCE_EVIDENCE') === 'data_sensitivity_class - quoted - COMPLIANCE_EVIDENCE');
  ok('in prose case', n('Data Sensitivity Class: COMPLIANCE_EVIDENCE') === 'Data Sensitivity Class - quoted - COMPLIANCE_EVIDENCE');
  ok('with other separators and a space before the mark', n('data-sensitivity-class : X') === 'data-sensitivity-class - quoted - X');
  ok('with no separators at all', n('datasensitivityclass:X') === 'datasensitivityclass - quoted -X');
  for (const [label, text] of [
    ['a zero-width space inside a word', 'data_sensi\u200Btivity_class: X'],
    ['a soft hyphen inside a word', 'da\u00ADta_sensitivity_class: X'],
    ['a left-to-right mark before the colon', 'data_sensitivity_class\u200E: X'],
    ['full-width letters and a full-width colon', '\uFF44\uFF41\uFF54\uFF41_sensitivity_class\uFF1A X'],
    ['a precomposed accented letter', 'dat\u00E1_sensitivity_class: X'],
    ['a combining accent', 'data_sensitivity_cla\u0301ss: X'],
    ['mixed case and an equals sign', 'DATA SENSITIVITY CLASS = X'],
  ]) {
    const out = n(text);
    ok(`neutralised: ${label}`, classLines(out).length === 0 && lookalikes(out).length === 0 && / - quoted -/.test(out), JSON.stringify(out));
  }
  for (const text of ['please call me', 'DATA_SENSITIVITY_CLASS is a field', 'data_sensitivity_class_v2 = 1', 'the data sensitivity class matters',
    'BENEFIT_STATUS_SELF_REPORTED', '— Benefit status: SELF_REPORTED —', 'scope=DISCUSS_MEDICARE_PLAN_OPTIONS', 'Current coverage: original']) {
    ok(`left alone: ${JSON.stringify(text)}`, n(text) === text);
  }
  ok('every line of a text is judged on its own', n('a\ndata_sensitivity_class: X\nb') === 'a\ndata_sensitivity_class - quoted - X\nb');
  ok('idempotent', n(n('data_sensitivity_class: X\nData Sensitivity Class: Y')) === n('data_sensitivity_class: X\nData Sensitivity Class: Y'));
  ok('a non-string is nothing, an empty string stays empty', n(null) === '' && n(undefined) === '' && n(42) === '' && n('') === '');
  // AUDIT 2026-10-04 (CRM-25, red team) — the header, and letters of another script.
  ok('the header forged on a line of its own is marked as quoted, whatever the marks around it',
    n('— Record class —') === 'Record class - quoted' && n('-- record class --') === 'record class - quoted' &&
    n('[RECORD CLASS]') === 'RECORD CLASS - quoted' && n('Record class:') === 'Record class - quoted' && n('\t— Record class —  ') === 'Record class - quoted');
  ok('the header with "nothing" inside its words, and with Cyrillic letters in them',
    n('— Rec\u200Bord cl\u00ADass —') === 'Record class - quoted' && n('— R\u0435cord cl\u0430ss —') === 'Record class - quoted');
  ok('the two bare words, and the words inside prose, are left exactly as written',
    ['Record class', '  Record   class  ', 'the record class matters', 'Record class - quoted', 'my medical record class A', 'Record classes —'].every((t) => n(t) === t));
  ok('a Cyrillic \u0430 in the label is read as the letter it prints as', n('d\u0430ta_sensitivity_class: COMPLIANCE_EVIDENCE') === 'data_sensitivity_class - quoted - COMPLIANCE_EVIDENCE');
  for (const [label, text] of [
    ['Cyrillic throughout', '\u0501\u0430t\u0430_\u0455\u0435n\u0455\u0456t\u0456v\u0456t\u0443_\u0441l\u0430\u0455\u0455: X'],
    ['Greek iota and alpha', 'data_sens\u03B9t\u03B9v\u03B9ty_cl\u03B1ss: X'],
    ['dotless i', 'data_sens\u0131tivity_class: X'],
    ['Armenian o in the header', '— rec\u0585rd class —'],
    ['Cyrillic plus a zero-width space plus a full-width colon', 'd\u0430ta_sensi\u200Btivity_cl\u0430ss\uFF1A X'],
  ]) {
    const out = n(text);
    ok(`neutralised and returned in Latin letters: ${label}`, classLines(out).length === 0 && lookalikes(out).length === 0 && / - quoted/.test(out) && !/[^\x00-\x7F]/.test(out), JSON.stringify(out));
  }
  ok('text of another script that does not carry the label is returned exactly as written',
    ['Привет, как дела?', 'ѕеnѕіtіvіtу', 'Το όνομά μου είναι', 'Հայաստան', 'класс данных: открытый'].every((t) => n(t) === t));
  ok('idempotent on the header and on lines that had to be folded',
    ['— Record class —', 'd\u0430ta_sensitivity_class: X', '— R\u0435cord cl\u0430ss —\n\u0501ata sensitivity class: Y', '[RECORD CLASS]\nRecord class'].every((t) => n(n(t)) === n(t)));
  const server = block(C.CONTACT_PII, R.NO_RESTRICTED_SIGNAL);
  ok('the server\'s own block would be neutralised too — the header and the line — which is why the handler appends it AFTER the sweep',
    n(server) !== server && classLines(n(server)).length === 0 && !n(server).includes(NOTE_BLOCK_HEADER) && n(server) === 'Record class - quoted\ndata_sensitivity_class - quoted - CONTACT_PII (NO_RESTRICTED_SIGNAL)');
}

// ── 9. api/sign-soa.js — wiring, on comment-free source, whole lines ─────────
// The handler answers 503 before any of this runs (SOA_ENABLED = false), so it
// cannot be driven here; what it does is pinned line by line.
{
  const SIGN = strip(read('../api/sign-soa.js'));
  ok('sign-soa is gated off (stated, so the limit of this section is on the record)', /^const SOA_ENABLED = false;/m.test(SIGN));
  ok('no retention label in the sensitivity field anywhere in sign-soa', !/DATA_SENSITIVITY_CLASS:\s*'SOA_EVIDENCE'/.test(SIGN) && !/DATA_SENSITIVITY_CLASS/.test(SIGN));
  ok('the class is derived from the record class, once, at module scope',
    /^const SIGNED_SENSITIVITY_CLASS = sensitivityForEvidenceRecord\(SIGNED_RECORD_CLASS\);/m.test(SIGN) && (SIGN.match(/sensitivityForEvidenceRecord\(/g) || []).length === 1);
  ok('the signed-SOA note carries it', /^[ \t]*'data_sensitivity_class: ' \+ SIGNED_SENSITIVITY_CLASS,/m.test(SIGN));
  ok('the durable signed index carries it beside recordClass',
    /^[ \t]*recordClass: SIGNED_RECORD_CLASS,\s*\n[ \t]*sensitivityClass: SIGNED_SENSITIVITY_CLASS,/m.test(SIGN));
  ok('the fields are built from the flattened instance, which sets the class by construction',
    /^[ \t]*var _cf = buildCustomFields\(soaInstanceToFields\(instance, \{\s*\n[ \t]*CHANNEL_VERIFICATION_STATUS: 'VERIFIED',\s*\n[ \t]*\}\)\);/m.test(SIGN));
  ok('sign-soa logs refused fields by name', /^[ \t]*if \(_cf\.refused\.length\) console\.warn\('\[CY2027-CRM\] refused: ' \+ _cf\.refused\.join\(','\)\);/m.test(SIGN));
  const apiDir = new URL('../api/', import.meta.url);
  const writers = readdirSync(apiDir).filter((f) => f.endsWith('.js')).filter((f) => /DATA_SENSITIVITY_CLASS:\s*'[A-Z_]+'/.test(strip(readFileSync(new URL(f, apiDir), 'utf8'))));
  ok('no handler writes a literal into the sensitivity field', writers.length === 0, writers.join());
}

// ── 10. api/submit-lead.js and api/opt-out.js, run against a laboratory CRM ──
const SHOWN = readShownConsentWording(read('../src/lib/disclaimerVersion.ts'));
ok('the consent wording the site shows is readable (the laboratory leads consent with it)',
  typeof SHOWN.version === 'string' && SHOWN.version.length > 0 && typeof SHOWN.en === 'string' && SHOWN.en.length > 100);
ok('the registered consent wording carries no label the neutraliser would touch', neutralizeClassLookalikes(SHOWN.en) === SHOWN.en && neutralizeClassLookalikes(SHOWN.es) === SHOWN.es);
{
  const ENV_KEYS = ['HIGHLEVEL_TOKEN', 'HIGHLEVEL_LOCATION_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TURNSTILE_SECRET',
    'VERCEL', 'VERCEL_ENV', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CY2027_CRM_FIELD_IDS', 'CY2027_QUARANTINE_STOP'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  let harnessError = null;
  const ALL_LOGS = [];
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
    process.env.HIGHLEVEL_LOCATION_ID = 'LOC_TEST';

    const LOGS = [];
    for (const k of ['log', 'warn', 'error']) {
      console[k] = (...a) => { const line = '[' + k + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); LOGS.push(line); ALL_LOGS.push(line); };
    }
    const GHL = 'https://services.leadconnectorhq.com';
    let CALLS = [];
    const IDS_WRITTEN = new Set();
    let ROUTE = null;
    let LLM = null;
    let SCORED_RAW = [];
    const resp = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (LLM && u === 'https://api.anthropic.com/v1/messages') { SCORED_RAW.push(String(opts.body)); return LLM(JSON.parse(opts.body)); }
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
      if (call.method === 'GET' && /^\/contacts\/[^/?]+$/.test(call.path)) return o.get ? o.get(call) : resp(404, { error: 'no such contact in the double' });
      if (call.method === 'POST' && /\/notes$/.test(call.path)) return resp(200, { note: { id: 'N1' } });
      if (call.method === 'GET' && call.path.startsWith('/opportunities/search')) return resp(200, { opportunities: [] });
      if (call.method === 'POST' && call.path === '/opportunities/') return resp(201, { opportunity: { id: 'O1' } });
      if (call.method === 'PUT' && call.path.startsWith('/contacts/')) return o.put ? o.put(call) : resp(200, { contact: { id: 'x' } });
      return resp(404, { error: 'unrouted' });
    };
    let ipSeq = 10;
    let phoneSeq = 5045000;
    const mkReq = (body) => ({
      method: 'POST',
      headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '192.0.2.' + (ipSeq++), 'user-agent': 'crm25-suite', 'content-type': 'application/json' },
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
        form_name: 'contact-page Form', best_time_to_contact: 'morning', interest_type: 'Part D', lead_notes: 'please call me',
        consent_to_contact: true, consent_text: SHOWN.en, consent_receipt_hash: sha(SHOWN.en), disclaimer_version: SHOWN.version,
        signer_user_agent: 'Mozilla/5.0 probe', page_url: '/contact', elapsed_ok: true, tags: ['Website Lead'], ...over,
      };
    };
    const reviewLead = (token, over) => lead({ medicare_status: '', benefit_self_report: token, lead_source: 'smart_review',
      lead_notes: 'Smart Medicare Review\nCurrent Carrier: Acme\nDoctor to keep: Yes', ...over });
    const submitLead = (await import('../api/submit-lead.js')).default;
    const optOut = (await import('../api/opt-out.js')).default;
    const run = async (handler, body, r = route()) => {
      CALLS = []; LOGS.length = 0; SCORED_RAW = []; ROUTE = r;
      const res = mkRes();
      let threw = null;
      try { await handler(mkReq(body), res); } catch (e) { threw = String((e && e.stack) || e); }
      return {
        status: res.statusCode, payload: res.payload, threw, calls: CALLS.slice(), logs: LOGS.slice(), scoredRaw: SCORED_RAW.slice(), sent: body,
        creates: CALLS.filter((c) => c.method === 'POST' && c.path === '/contacts/'),
        puts: CALLS.filter((c) => c.method === 'PUT'),
        notes: CALLS.filter((c) => /\/notes$/.test(c.path) && c.method === 'POST').map((c) => String(c.body && c.body.body)),
      };
    };
    const fields = (c) => (c && c.body && c.body.customFields) || [];
    const cf = (c, key) => (fields(c).find((f) => f.key === key) || {}).value;
    const classFields = (c) => fields(c).filter((f) => f.key === KEY);
    const created = (r) => r.status === 200 && !r.threw && r.creates.length === 1 && r.notes.length === 1;
    const model = (summary) => () => resp(200, { content: [{ type: 'text', text: JSON.stringify({
      summary, intent_strength: 5, lead_temperature: 'warm', urgency: 'this_week', advisor_prep_notes: 'none', compliance_flags: [], recommended_first_questions: [],
    }) }] });
    // What is the lead's own (its phone, its e-mail, the clock, the laboratory's
    // IP, the id derived from them) as placeholders, so two runs can be compared.
    const same = (text, v) => String(text)
      .split(v.sent.phone).join('<phone>').split(v.sent.email).join('<email>')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g, '<T>')
      .replace(/192\.0\.2\.\d+/g, '<ip>')
      .replace(/(submission_id=|"submission_id":"|Submission ID: )[0-9a-f]+/g, '$1<id>');
    const createBody = (v, dropClass) => same(JSON.stringify({ ...v.creates[0].body,
      customFields: fields(v.creates[0]).filter((f) => !(dropClass && f.key === KEY)) }), v);
    const BLOCK_PII = block(C.CONTACT_PII, R.NO_RESTRICTED_SIGNAL);
    const BLOCK_FLAG = block(C.RESTRICTED_TOPIC_FLAGGED, R.RESTRICTED_SIGNAL_FLAGGED);
    const BLOCK_ID = block(C.RESTRICTED_TOPIC_FLAGGED, R.IDENTIFIER_REDACTED);

    // A — the control: an ordinary lead, no CY2027 ids (production as it is today).
    const control = await run(submitLead, lead());
    ok('lead (control): captured once, one note', created(control), `status=${control.status} threw=${control.threw} creates=${control.creates.length} notes=${control.notes.length}`);
    ok('lead (control): the note carries the class block once, as the server\'s line, CONTACT_PII / NO_RESTRICTED_SIGNAL',
      control.notes[0].includes('\n\n' + BLOCK_PII) && classLines(control.notes[0]).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
      (control.notes[0].match(/— Record class —/g) || []).length === 1, control.notes[0].slice(-400));
    ok('lead (control): the block is written after the TCPA receipt (the receipt is never below a block a sender could imitate)',
      control.notes[0].indexOf('— TCPA Receipt —') > -1 && control.notes[0].indexOf('— TCPA Receipt —') < control.notes[0].indexOf(NOTE_BLOCK_HEADER));
    ok('lead (control): the summary field carries the same block, once',
      (String(cf(control.creates[0], 'contact.chat_conversation_summary')).match(/— Record class —/g) || []).length === 1 &&
      classLines(cf(control.creates[0], 'contact.chat_conversation_summary')).length === 1);
    ok('lead (control): no class field is sent while no id is mapped, and the gap is logged', classFields(control.creates[0]).length === 0 && control.logs.includes('[warn] ' + GAP_LINE));
    ok('lead (control): no enrichment call without a key, and nothing was withheld by the class', control.scoredRaw.length === 0 && !control.logs.some((l) => /\[DATA-CLASS\]/.test(l)));
    ok('lead (control): nothing is refused at the write stage', !control.logs.some((l) => /\[CY2027-CRM\] refused/.test(l)));
    const control2 = await run(submitLead, lead());
    ok('lead (control): two leads that said nothing restricted get the same record once what is their own is set aside',
      createBody(control, false) === createBody(control2, false) && same(control.notes[0], control) === same(control2.notes[0], control2));

    // B — the class follows what the FREE-TEXT scrubbers removed.
    const medicalLead = await run(submitLead, lead({ lead_notes: 'I have cancer and want to ask about Part D.' }));
    ok('lead (health topic in the notes): RESTRICTED_TOPIC_FLAGGED / RESTRICTED_SIGNAL_FLAGGED',
      created(medicalLead) && classLines(medicalLead.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)' &&
      medicalLead.notes[0].includes('\n\n' + BLOCK_FLAG), medicalLead.notes[0].slice(-400));
    ok('lead (health topic): the topic itself was redacted and only its category was logged', !/cancer/i.test(JSON.stringify(medicalLead.calls)) &&
      medicalLead.logs.some((l) => l.includes('[DATA-MIN] {"flags":["MEDICAL_TOPIC_FOR_LICENSED_REVIEW"]')));
    const phiLead = await run(submitLead, lead({ lead_notes: 'my ssn is 123-45-6789, call me' }));
    ok('lead (identifier in the notes): RESTRICTED_TOPIC_FLAGGED / IDENTIFIER_REDACTED, and the identifier is gone',
      created(phiLead) && phiLead.notes[0].includes('\n\n' + BLOCK_ID) && !/123-45-6789/.test(JSON.stringify(phiLead.calls)), phiLead.notes[0].slice(-300));
    const proseBenefit = await run(submitLead, lead({ lead_notes: 'I have Medicaid, please call me' }));
    ok('lead (a benefit program named in FREE TEXT): the redactor removed it, so the class rises',
      created(proseBenefit) && classLines(proseBenefit.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)');
    const callTime = await run(submitLead, lead({ best_time_to_contact: 'after my chemo, mornings' }));
    ok('lead (a health topic in the call-time text): the class rises — every free-text door counts',
      created(callTime) && classLines(callTime.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)', callTime.notes[0].slice(-300));
    // AUDIT 2026-10-04 (CRM-25, red team) — the interest door. Free text typed
    // there gets the DM-09 treatment the call time gets; a label the site itself
    // sends is kept as sent (owner decision); the class and the review flags
    // follow the redactor either way.
    const tagsOf = (r) => (r.creates[0].body.tags || []).map(String);
    const interestClinical = await run(submitLead, lead({ interest_type: 'chemo for my cancer and Part D' }));
    ok('lead (clinical free text in the topic): RESTRICTED_TOPIC_FLAGGED, the detail gone from every CRM call, the note line masked, no Interest- tag, licensed review flagged, category-only log',
      created(interestClinical) && classLines(interestClinical.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)' &&
      !/cancer|chemo/i.test(JSON.stringify(interestClinical.calls)) && interestClinical.notes[0].includes('Interest/topic: [removed — not a scoring factor] for my [removed — not a scoring factor] and Part D') &&
      !tagsOf(interestClinical).some((t) => /^Interest-/.test(t)) &&
      /LICENSED_AGENT_REVIEW_REQUIRED/.test(String(cf(interestClinical.creates[0], 'contact.lead_quality_flags'))) &&
      interestClinical.logs.includes('[warn] [DATA-MIN] {"flags":["MEDICAL_TOPIC_FOR_LICENSED_REVIEW"],"redactions":2}'),
      interestClinical.logs.filter((l) => /DATA-MIN/.test(l)).join('|') + ' ' + JSON.stringify(tagsOf(interestClinical)) + ' ' + interestClinical.notes[0].slice(-400));
    const interestSsn = await run(submitLead, lead({ interest_type: 'ssn 123-45-6789' }));
    ok('lead (an identifier in the topic): RESTRICTED_TOPIC_FLAGGED / IDENTIFIER_REDACTED, the identifier gone, the category logged',
      created(interestSsn) && interestSsn.notes[0].includes('\n\n' + BLOCK_ID) && !/123-45-6789/.test(JSON.stringify(interestSsn.calls)) &&
      interestSsn.logs.includes('[warn] [LEAD] PHI redacted before LLM/CRM: SSN'), interestSsn.logs.join('|').slice(0, 300) + interestSsn.notes[0].slice(-200));
    const bestTimeSsn = await run(submitLead, lead({ best_time_to_contact: 'ssn 123-45-6789 mornings' }));
    ok('lead (an identifier in the call time): the same — the short fields\' PHI categories count',
      created(bestTimeSsn) && bestTimeSsn.notes[0].includes('\n\n' + BLOCK_ID) && !/123-45-6789/.test(JSON.stringify(bestTimeSsn.calls)) &&
      bestTimeSsn.logs.includes('[warn] [LEAD] PHI redacted before LLM/CRM: SSN'), bestTimeSsn.logs.join('|').slice(0, 300) + bestTimeSsn.notes[0].slice(-200));
    const siteLabel = await run(submitLead, lead({ interest_type: 'Extra Help / LIS question' }));
    ok('lead (a topic label the site sends, naming a program): kept as sent — the field, the note line and the Interest- tag (owner decision, unchanged) — and the class states what the record carries',
      created(siteLabel) && cf(siteLabel.creates[0], 'contact.medicare_interest') === 'Extra Help / LIS question' &&
      siteLabel.notes[0].includes('Interest/topic: Extra Help / LIS question') && tagsOf(siteLabel).includes('Interest-Extra-Help-LIS-question') &&
      classLines(siteLabel.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)' &&
      siteLabel.logs.includes('[warn] [DATA-MIN] {"flags":["BENEFIT_STATUS_SELF_REPORTED"],"redactions":0}'),
      siteLabel.logs.filter((l) => /DATA-MIN/.test(l)).join('|') + ' ' + JSON.stringify(tagsOf(siteLabel)));
    const sentence = await run(submitLead, lead({ interest_type: 'I have Medicaid and Extra Help' }));
    ok('lead (a benefit sentence typed in the topic — not a site label): masked like any free text, in the field and the note, no Interest- tag, class raised',
      created(sentence) && cf(sentence.creates[0], 'contact.medicare_interest') === 'I have [removed — not a scoring factor]' &&
      sentence.notes[0].includes('Interest/topic: I have [removed — not a scoring factor]') && !/Interest\/topic: .*(Medicaid|Extra Help)/i.test(sentence.notes[0]) &&
      !tagsOf(sentence).some((t) => /^Interest-/.test(t)) &&
      classLines(sentence.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)',
      String(cf(sentence.creates[0], 'contact.medicare_interest')) + ' ' + JSON.stringify(tagsOf(sentence)));
    const caseVariant = await run(submitLead, lead({ interest_type: 'extra help / lis question' }));
    ok('lead (a site label in another letter case): not the label — free text, masked, no Interest- tag',
      created(caseVariant) && !/extra help|lis/i.test(String(cf(caseVariant.creates[0], 'contact.medicare_interest'))) && !tagsOf(caseVariant).some((t) => /^Interest-/.test(t)),
      String(cf(caseVariant.creates[0], 'contact.medicare_interest')) + ' ' + JSON.stringify(tagsOf(caseVariant)));
    const plainTopic = await run(submitLead, lead({ interest_type: 'questions about my dentist' }));
    ok('lead (free text in the topic that names nothing restricted): kept, tagged, CONTACT_PII — the door is classified, not closed',
      created(plainTopic) && cf(plainTopic.creates[0], 'contact.medicare_interest') === 'questions about my dentist' && tagsOf(plainTopic).includes('Interest-questions-about-my-dentist') &&
      classLines(plainTopic.notes[0]).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)', JSON.stringify(tagsOf(plainTopic)));

    // C — the structured Medicaid / Extra Help answer (DM-04) does NOT move the class (§15).
    for (const token of ['medicaid', 'no', 'unsure']) {
      const v = await run(submitLead, reviewLead(token));
      const none = await run(submitLead, reviewLead(undefined));
      ok(`lead (Smart Review "${token}"): the same class line as a lead that answered nothing — the structured answer is not a sensitivity signal`,
        created(v) && created(none) && classLines(v.notes[0]).join() === classLines(none.notes[0]).join() &&
        classLines(v.notes[0]).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
        v.logs.some((l) => l.includes('[DATA-MIN] {"flags":["BENEFIT_STATUS_SELF_REPORTED"]')), v.notes[0].slice(-500));
      ok(`lead (Smart Review "${token}"): the self-report block stays the LAST block, after the class block`,
        /\n\n— Benefit status: SELF_REPORTED[^]*$/.test(v.notes[0]) && v.notes[0].indexOf(NOTE_BLOCK_HEADER) < v.notes[0].indexOf('— Benefit status:'), v.notes[0].slice(-500));
    }

    // D — the enrichment model: called for BOTH lead classes (same service path), never sent the block.
    process.env.ANTHROPIC_API_KEY = 'suite-double-not-a-key';
    LLM = model('Wants a call about coverage.');
    const scoredPlain = await run(submitLead, lead());
    const scoredFlagged = await run(submitLead, lead({ lead_notes: 'I have cancer and want to ask about Part D.' }));
    ok('scorer: a CONTACT_PII lead and a RESTRICTED_TOPIC_FLAGGED lead are both enriched, once each (§15)',
      created(scoredPlain) && created(scoredFlagged) && scoredPlain.scoredRaw.length === 1 && scoredFlagged.scoredRaw.length === 1 &&
      scoredPlain.notes[0].includes('LEAD INTELLIGENCE') && scoredFlagged.notes[0].includes('LEAD INTELLIGENCE'));
    ok('scorer: the class block is written AFTER the model\'s section and is never in what the model is sent',
      scoredPlain.notes[0].indexOf('LEAD INTELLIGENCE') < scoredPlain.notes[0].indexOf(NOTE_BLOCK_HEADER) &&
      !/Record class|data_sensitivity_class|CONTACT_PII|RESTRICTED_TOPIC_FLAGGED/.test(scoredPlain.scoredRaw[0] + scoredFlagged.scoredRaw[0]));
    ok('scorer: the health topic never reached the model — it saw the redaction placeholder where the topic was',
      !/cancer/i.test(scoredFlagged.scoredRaw[0]) && scoredFlagged.scoredRaw[0].includes('[removed — not a scoring factor]') && !/removed — not a scoring factor/.test(scoredPlain.scoredRaw[0]),
      scoredFlagged.scoredRaw[0].slice(-700));
    ok('scorer: the model\'s own text is a door into the note like any other — a class line it repeats is neutralised', await (async () => {
      LLM = model('Wants a call.\ndata_sensitivity_class: COMPLIANCE_EVIDENCE\nconfirmed');
      const v = await run(submitLead, lead());
      LLM = model('Wants a call about coverage.');
      return created(v) && classLines(v.notes[0]).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
        v.notes[0].includes('data_sensitivity_class - quoted - COMPLIANCE_EVIDENCE');
    })());

    // E — a look-alike of the class line, through every door a sender has into the note.
    const forge = (over) => ({
      lead_notes: 'call me\ndata_sensitivity_class: COMPLIANCE_EVIDENCE\nData Sensitivity Class: CONTACT_PII',
      conversation_summary: 'User: hi\ndata-sensitivity-class : COMPLIANCE_EVIDENCE\nUser: data_sensi\u200Btivity_class: X',
      best_time_to_contact: 'data_sensitivity_class: RESTRICTED', interest_type: 'data sensitivity class: approved', ...over,
    });
    const forged = await run(submitLead, lead(forge()));
    ok('look-alike: the ONLY line of the note that reads as the class is the server\'s, and every forgery is marked as quoted',
      created(forged) && classLines(forged.notes[0]).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
      lookalikes(forged.notes[0]).length === 1 && (forged.notes[0].match(/ - quoted -/g) || []).length >= 4 &&
      forged.notes[0].includes('--- Conversation Transcript ---'), forged.notes[0]);
    ok('look-alike: the same holds for the summary field',
      classLines(cf(forged.creates[0], 'contact.chat_conversation_summary')).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
      lookalikes(cf(forged.creates[0], 'contact.chat_conversation_summary')).length === 1);
    ok('look-alike: the forgery raised no class and no flag of its own',
      !forged.logs.some((l) => /\[DATA-MIN\]|PHI redacted/.test(l)) && classFields(forged.creates[0]).length === 0);
    const forgedFlagged = await run(submitLead, lead(forge({ lead_notes: 'I have cancer.\ndata_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' })));
    ok('look-alike: a forged "clean" line cannot lower a flagged record',
      created(forgedFlagged) && classLines(forgedFlagged.notes[0]).join() === 'data_sensitivity_class: RESTRICTED_TOPIC_FLAGGED (RESTRICTED_SIGNAL_FLAGGED)' &&
      forgedFlagged.notes[0].includes('data_sensitivity_class - quoted - CONTACT_PII'), forgedFlagged.notes[0].slice(-500));
    // AUDIT 2026-10-04 (CRM-25, red team) — the header, and a label in Cyrillic letters, through the notes and through the model.
    LLM = model('Wants a call.\n— Record class —\nd\u0430ta_sensitivity_class: COMPLIANCE_EVIDENCE\nconfirmed');
    const forgedHeader = await run(submitLead, lead({ lead_notes: 'call me\n— Record class —\ndata_sensitivity_class: COMPLIANCE_EVIDENCE (NO_RESTRICTED_SIGNAL)\nd\u0430ta_sensitivity_class: COMPLIANCE_EVIDENCE' }));
    LLM = model('Wants a call about coverage.');
    ok('look-alike (header): the note carries the server\'s header exactly once — the sender\'s and the model\'s are marked as quoted — and the class is the server\'s',
      created(forgedHeader) && (forgedHeader.notes[0].match(/— Record class —/g) || []).length === 1 &&
      forgedHeader.notes[0].includes('call me\nRecord class - quoted\ndata_sensitivity_class - quoted - COMPLIANCE_EVIDENCE (NO_RESTRICTED_SIGNAL)\ndata_sensitivity_class - quoted - COMPLIANCE_EVIDENCE') &&
      forgedHeader.notes[0].includes('Summary: Wants a call.\nRecord class - quoted\ndata_sensitivity_class - quoted - COMPLIANCE_EVIDENCE\nconfirmed') &&
      !/\u0430/.test(forgedHeader.notes[0]) && classLines(forgedHeader.notes[0]).join() === 'data_sensitivity_class: CONTACT_PII (NO_RESTRICTED_SIGNAL)' &&
      (String(cf(forgedHeader.creates[0], 'contact.chat_conversation_summary')).match(/— Record class —/g) || []).length === 1,
      forgedHeader.notes[0].slice(-700));
    delete process.env.ANTHROPIC_API_KEY;
    LLM = null;

    // F — the id is mapped: the class is one more entry on the create, in the shape the other CY2027 families use.
    process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
    const mapped = await run(submitLead, lead());
    ok('lead (id mapped): exactly one class entry on the create — real id, canonical key, both value spellings',
      created(mapped) && classFields(mapped.creates[0]).length === 1 &&
      JSON.stringify(classFields(mapped.creates[0])[0]) === JSON.stringify({ id: 'dsc1', key: KEY, field_value: 'CONTACT_PII', value: 'CONTACT_PII' }),
      JSON.stringify(classFields(mapped.creates[0])));
    ok('lead (id mapped): the rest of the create is the unmapped create, byte for byte, and the note is the same note',
      createBody(mapped, true) === createBody(control, false) && same(mapped.notes[0], mapped) === same(control.notes[0], control));
    ok('lead (id mapped): no line about this field is left to log (the callback fields are unmapped under this map, and say so), nothing is refused, no PUT',
      !mapped.logs.some((l) => /DATA_SENSITIVITY_CLASS|data_sensitivity_class/.test(l)) && mapped.logs.some((l) => /\[CY2027-CRM\] 3 field\(s\) could not be written[^\n]*CALLBACK_CONSENT_STATUS/.test(l)) && mapped.puts.length === 0, mapped.logs.join('|'));
    const mappedFlagged = await run(submitLead, lead({ lead_notes: 'I have cancer and want to ask about Part D.' }));
    ok('lead (id mapped, flagged): the entry carries the higher class', created(mappedFlagged) && cf(mappedFlagged.creates[0], KEY) === 'RESTRICTED_TOPIC_FLAGGED');
    // The CRM refuses the create with the entry attached: the create is retried once without it, the lead is kept.
    const refusing = (status) => route({ contact: (call) => (classFields(call).length ? resp(status, { message: 'customFields: invalid custom field id' }) : resp(201, { contact: { id: 'C_NEW' } })) });
    for (const status of [400, 422, 404]) {
      const r = await run(submitLead, lead(), refusing(status));
      ok(`lead (id mapped, CRM answers ${status} with the entry attached): retried once without it, lead kept, note still carries the class, drop logged by key`,
        r.status === 200 && r.creates.length === 2 && classFields(r.creates[0]).length === 1 && classFields(r.creates[1]).length === 0 &&
        r.notes.length === 1 && r.notes[0].includes('\n\n' + BLOCK_PII) &&
        r.logs.some((l) => l === `[error] [CY2027-CRM] contact create refused (HTTP ${status}) with owner-configured field(s) attached (${KEY}) and accepted without them — the lead was kept and those fields were NOT written. Check CY2027_CRM_FIELD_IDS.`),
        `status=${r.status} creates=${r.creates.length} ` + r.logs.filter((l) => /refused/.test(l)).join('|'));
    }
    // A repeat on an existing contact (LEAD-02): nothing is classified on it.
    // AUDIT 2026-10-04 (CRM-25, red team) — and with the class id mapped the
    // duplicate paid a SECOND create before being recognised (measured). The
    // CRM's own duplicate-contact wording on the 400 is read before any retry.
    const dup = () => resp(400, { message: 'This location does not allow duplicated contacts.', statusCode: 400 });
    const L = lead();
    const repeat = await run(submitLead, L, route({ contact: dup, search: () => resp(200, { contacts: [{ id: 'C_EXIST', phone: '+1' + L.phone, tags: ['status-newlead'], dnd: false }] }) }));
    ok('lead (repeat on an existing contact, id mapped): exactly ONE create attempt, no PUT, nothing logged as dropped, and the repeat note carries no class block',
      repeat.status === 200 && repeat.puts.length === 0 && repeat.creates.length === 1 && classFields(repeat.creates[0]).length === 1 && repeat.notes.length === 1 &&
      /REPEAT REQUEST/.test(repeat.notes[0]) && classLines(repeat.notes[0]).length === 0 && !repeat.notes[0].includes(NOTE_BLOCK_HEADER) &&
      !repeat.logs.some((l) => /cy2027_fields_dropped|\[CY2027-CRM\] contact create refused/.test(l)) && repeat.logs.some((l) => l === '[error] [GHL] Contact creation failed: HTTP 400 (duplicate)'),
      `status=${repeat.status} puts=${repeat.puts.length} creates=${repeat.creates.length} ` + repeat.logs.filter((l) => /GHL|CY2027/.test(l)).join('|').slice(0, 400));
    // The short-circuit is exact: the wordings the earlier red team found losing leads, and any other status, still get the one retry.
    const refusingWith = (status, message) => route({ contact: (call) => (classFields(call).length ? resp(status, { message, statusCode: status }) : resp(201, { contact: { id: 'C_NEW' } })) });
    const fieldDup = await run(submitLead, lead(), refusingWith(400, 'duplicate custom field id'));
    ok('lead (id mapped, 400 worded "duplicate custom field id"): not a duplicate contact — retried once without the entry, lead kept',
      fieldDup.status === 200 && fieldDup.creates.length === 2 && classFields(fieldDup.creates[1]).length === 0 && !!fieldDup.payload && fieldDup.payload.contact_id === 'C_NEW',
      `status=${fieldDup.status} creates=${fieldDup.creates.length}`);
    const dup422 = await run(submitLead, lead(), refusingWith(422, 'This location does not allow duplicated contacts.'));
    ok('lead (id mapped, 422 with the duplicate wording): only a 400 is the dedupe branch\'s duplicate — the 422 keeps its one retry',
      dup422.status === 200 && dup422.creates.length === 2 && classFields(dup422.creates[1]).length === 0, `status=${dup422.status} creates=${dup422.creates.length}`);
    delete process.env.CY2027_CRM_FIELD_IDS;

    // G — api/opt-out.js: a revocation is compliance evidence.
    const ACK = '{"ok":true,"received":true}';
    const P0 = '7185550123';
    const known = () => resp(200, { contacts: [{ id: 'C_KNOWN', phone: '+1' + P0, email: 'known@example.com', tags: ['Consent Captured'] }] });
    const optBody = { phone: P0, evidence: 'chat_optout' };
    const o0 = await run(optOut, optBody, route({ search: known }));
    ok('opt-out (no ids): one PUT, the suppression, and its body carries no class',
      JSON.stringify(o0.payload) === ACK && o0.puts.length === 1 && o0.puts[0].body.dnd === true && !/sensitivity|dsc1/i.test(JSON.stringify(o0.puts[0].body)),
      JSON.stringify(o0.puts.map((c) => c.path)));
    ok('opt-out (no ids): the revocation note carries the class, right after the "Applied by" line',
      o0.notes.length === 1 && o0.notes[0].includes('\nApplied by: automated suppression endpoint (api/opt-out)\ndata_sensitivity_class: COMPLIANCE_EVIDENCE\n') &&
      classLines(o0.notes[0]).join() === 'data_sensitivity_class: COMPLIANCE_EVIDENCE', o0.notes.join('|'));
    ok('opt-out (no ids): the gap is logged and the telemetry says the class was not mapped',
      o0.logs.includes('[warn] ' + GAP_LINE) && o0.logs.some((l) => /^\[warn\] \[OPTOUT\] applied dnd=true note=true evidence=chat_optout callback_consent=\S+ record_class=NOT_MAPPED$/.test(l)), o0.logs.join('|'));
    process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
    const o1 = await run(optOut, optBody, route({ search: known }));
    ok('opt-out (id mapped): the suppression PUT is byte-identical to the unmapped one, and a SEPARATE second PUT carries only the class',
      JSON.stringify(o1.payload) === ACK && o1.puts.length === 2 && JSON.stringify(o1.puts[0].body) === JSON.stringify(o0.puts[0].body) &&
      o1.puts[1].path === '/contacts/C_KNOWN' &&
      JSON.stringify(o1.puts[1].body) === JSON.stringify({ customFields: [{ id: 'dsc1', key: KEY, field_value: 'COMPLIANCE_EVIDENCE', value: 'COMPLIANCE_EVIDENCE' }] }),
      JSON.stringify(o1.puts.map((c) => c.body)));
    ok('opt-out (id mapped): the class is written after the suppression and after the note',
      o1.calls.findIndex((c) => c.method === 'PUT') < o1.calls.findIndex((c) => /\/notes$/.test(c.path)) &&
      o1.calls.findIndex((c) => /\/notes$/.test(c.path)) < o1.calls.map((c) => c.method).lastIndexOf('PUT'));
    ok('opt-out (id mapped): no line about this field is left to log, telemetry says WRITTEN', !o1.logs.some((l) => /DATA_SENSITIVITY_CLASS|data_sensitivity_class/.test(l)) && o1.logs.some((l) => / record_class=WRITTEN$/.test(l)), o1.logs.join('|'));
    const classPut = (call) => call.body && Array.isArray(call.body.customFields) && call.body.customFields.some((f) => f.id === 'dsc1');
    const o2 = await run(optOut, optBody, route({ search: known, put: (call) => (classPut(call) ? resp(422, { message: 'invalid custom field id' }) : resp(200, { contact: { id: 'C_KNOWN' } })) }));
    ok('opt-out (id mapped, CRM refuses the class PUT): the suppression stands, the ack is the same, the failure is logged, the note still carries the class',
      JSON.stringify(o2.payload) === ACK && o2.puts.length === 2 && o2.logs.some((l) => /applied dnd=true note=true/.test(l) && / record_class=UPDATE_FAILED$/.test(l)) &&
      o2.logs.includes('[error] [OPTOUT] record-class update failed status=422 — the revocation note carries the class') &&
      o2.notes[0].includes('\ndata_sensitivity_class: COMPLIANCE_EVIDENCE\n'), o2.logs.join('|'));
    const o3 = await run(optOut, optBody, route({ search: known, put: (call) => { if (classPut(call)) throw new Error('socket hang up'); return resp(200, { contact: { id: 'C_KNOWN' } }); } }));
    ok('opt-out (id mapped, the class PUT throws): the ack is the same and the suppression is untouched',
      JSON.stringify(o3.payload) === ACK && o3.puts.length === 2 && o3.logs.some((l) => / record_class=REQUEST_FAILED$/.test(l)) && o3.logs.some((l) => /applied dnd=true/.test(l)));
    const o4 = await run(optOut, optBody, route({ search: () => resp(200, { contacts: [] }) }));
    ok('opt-out (no match): nothing is written and the ack is identical', JSON.stringify(o4.payload) === ACK && o4.puts.length === 0 && o4.notes.length === 0);
    delete process.env.CY2027_CRM_FIELD_IDS;

    // H — the laboratory's ids.
    const production = [...IDS_WRITTEN].filter((id) => id !== 'dsc1');
    ok('every production id written in this laboratory is a reserved one, and the class id is the only CY2027 id written',
      production.length >= 8 && production.every((id) => PRODUCTION_FIELD_IDS.includes(id)) && IDS_WRITTEN.has('dsc1'), production.join());
  } catch (e) {
    harnessError = e;
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  ok('the handler laboratory ran to the end', harnessError === null, harnessError && (harnessError.stack || String(harnessError)));
  ok('§30: no class VALUE reached any log line of either handler, over the whole laboratory',
    ALL_LOGS.length > 20 && !ALL_LOGS.some((l) => /CONTACT_PII|RESTRICTED_TOPIC_FLAGGED|COMPLIANCE_EVIDENCE/.test(l)),
    ALL_LOGS.filter((l) => /CONTACT_PII|RESTRICTED_TOPIC_FLAGGED|COMPLIANCE_EVIDENCE/.test(l)).join('|'));
}

// ── 11. The gate and the write stage, observed WITHHOLDING against a copy of the layer with a defect ──
// The real lead path never produces a class the policy withholds (both lead
// classes are AFTER_MINIMIZATION) nor one outside the taxonomy. So the handler
// is run from a COPY of api/ in which that is made to happen, and what it does
// is observed: nothing in the repository is touched.
{
  const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const ENV_KEYS = ['HIGHLEVEL_TOKEN', 'HIGHLEVEL_LOCATION_ID', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'TURNSTILE_SECRET',
    'VERCEL', 'VERCEL_ENV', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CY2027_CRM_FIELD_IDS', 'CY2027_QUARANTINE_STOP'];
  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const realConsole = { log: console.log, warn: console.warn, error: console.error };
  let harnessError = null;
  try {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
    process.env.HIGHLEVEL_LOCATION_ID = 'LOC_TEST';
    process.env.ANTHROPIC_API_KEY = 'suite-double-not-a-key';
    const LOGS = [];
    for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { LOGS.push('[' + k + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    const GHL = 'https://services.leadconnectorhq.com';
    let CALLS = [];
    let SCORED = 0;
    const resp = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u === 'https://api.anthropic.com/v1/messages') {
        SCORED++;
        return resp(200, { content: [{ type: 'text', text: JSON.stringify({ summary: 'x', intent_strength: 5, lead_temperature: 'warm', urgency: 'this_week', advisor_prep_notes: 'none', compliance_flags: [], recommended_first_questions: [] }) }] });
      }
      if (!u.startsWith(GHL + '/')) throw new Error('the suite must not reach ' + u.slice(0, 60));
      let body = null;
      try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = String(opts.body); }
      const call = { method: String(opts.method || 'GET').toUpperCase(), path: u.slice(GHL.length), body };
      CALLS.push(call);
      if (call.method === 'POST' && call.path === '/contacts/') return resp(201, { contact: { id: 'C_NEW' } });
      if (call.method === 'GET' && call.path.startsWith('/contacts/?')) return resp(200, { contacts: [] });
      if (call.method === 'POST' && /\/notes$/.test(call.path)) return resp(200, { note: { id: 'N1' } });
      if (call.method === 'GET' && call.path.startsWith('/opportunities/search')) return resp(200, { opportunities: [] });
      if (call.method === 'POST' && call.path === '/opportunities/') return resp(201, { opportunity: { id: 'O1' } });
      return resp(404, { error: 'unrouted' });
    };
    let seq = 6045000;
    const lead = () => {
      const n = seq++;
      return {
        first_name: 'Probe', last_name: 'Tester', phone: '718' + String(n), email: 'probe.tester' + n + '@example.com',
        zip: '10451', preferred_language: 'en', medicare_status: 'original', lead_source: 'ClearPoint Senior Advisors Website',
        form_name: 'contact-page Form', best_time_to_contact: 'morning', interest_type: 'Part D', lead_notes: 'please call me',
        consent_to_contact: true, consent_text: SHOWN.en, consent_receipt_hash: sha(SHOWN.en), disclaimer_version: SHOWN.version,
        signer_user_agent: 'Mozilla/5.0 probe', page_url: '/contact', elapsed_ok: true, tags: ['Website Lead'],
      };
    };
    const mkReq = (body) => ({
      method: 'POST', headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '192.0.2.' + (seq % 200), 'user-agent': 'crm25-suite', 'content-type': 'application/json' },
      readableEnded: true, complete: true, on() {}, get body() { return body; },
    });
    const mkRes = () => ({ statusCode: 200, payload: undefined, setHeader() {}, getHeader() { return undefined; },
      status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end(d) { this.payload = d; return this; } });
    const viaTwin = async (label, edits, fn) => {
      const twin = mkdtempSync(join(tmpdir(), 'crm25-twin-'));
      try {
        writeFileSync(join(twin, 'package.json'), '{"type":"module"}\n');
        cpSync(join(REPO, 'api'), join(twin, 'api'), { recursive: true });
        for (const [file, from, to] of edits) {
          const p = join(twin, 'api', file);
          // AUDIT 2026-10-04 (CRM-25, red team) — the anchors span lines with
          // '\n'. A checkout on this autocrlf=true machine (a fresh clone, a git
          // archive) is CRLF, and the twin then found none of them (measured:
          // 211 passed, 1 failed). The copy is read as LF whatever it is on disk.
          const src = readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
          if (src.split(from).length !== 2) throw new Error(label + ': the anchor was not found exactly once in ' + file);
          writeFileSync(p, src.replace(from, to));
        }
        const handler = (await import(pathToFileURL(join(twin, 'api', 'submit-lead.js')).href)).default;
        CALLS = []; LOGS.length = 0; SCORED = 0;
        const res = mkRes();
        await handler(mkReq(lead()), res);
        return fn({ status: res.statusCode, calls: CALLS.slice(), logs: LOGS.slice(), scored: SCORED,
          creates: CALLS.filter((c) => c.method === 'POST' && c.path === '/contacts/'),
          notes: CALLS.filter((c) => /\/notes$/.test(c.path)).map((c) => String(c.body && c.body.body)) });
      } finally {
        rmSync(twin, { recursive: true, force: true });
      }
    };
    // The copy as it is: the control for the two defects below.
    await viaTwin('clean copy', [], (r) => {
      ok('twin (clean copy of api/): the lead is enriched once and filed with its class — the copy behaves as the repository does',
        r.status === 200 && r.scored === 1 && r.creates.length === 1 && r.notes.length === 1 && r.notes[0].includes('\n\n' + block(C.CONTACT_PII, R.NO_RESTRICTED_SIGNAL)) &&
        r.notes[0].includes('LEAD INTELLIGENCE') && !r.logs.some((l) => /\[DATA-CLASS\]/.test(l)), `status=${r.status} scored=${r.scored} ` + r.logs.join('|').slice(0, 300));
    });
    // Defect 1 — the policy table withholds the class a lead gets.
    await viaTwin('CONTACT_PII withheld', [['_lib/cy2027/sensitivity.js',
      'CONTACT_PII: Object.freeze({\n    rank: 1, logValues: false, enrichmentVendor: ENRICHMENT_EXPOSURE.AFTER_MINIMIZATION,',
      'CONTACT_PII: Object.freeze({\n    rank: 1, logValues: false, enrichmentVendor: ENRICHMENT_EXPOSURE.NEVER,']], (r) => {
      ok('twin (CONTACT_PII withheld by the table): the enrichment call is NOT made, the lead is still filed with its class, and the reason is logged',
        r.status === 200 && r.scored === 0 && r.creates.length === 1 && r.notes.length === 1 && !r.notes[0].includes('LEAD INTELLIGENCE') &&
        r.notes[0].includes('\n\n' + block(C.CONTACT_PII, R.NO_RESTRICTED_SIGNAL)) &&
        r.logs.includes('[warn] [DATA-CLASS] {"enrichment":"withheld","reason":"CLASS_WITHHELD_FROM_ENRICHMENT"}'),
        `status=${r.status} scored=${r.scored} ` + r.logs.join('|').slice(0, 400));
    });
    // Defect 2 — the classifier answers with a class outside the taxonomy, under a mapped id.
    process.env.CY2027_CRM_FIELD_IDS = IDS.CY2027_CRM_FIELD_IDS;
    await viaTwin('unknown class', [['_lib/cy2027/sensitivity.js',
      '  return result(DATA_SENSITIVITY_CLASS.CONTACT_PII, CLASSIFICATION_REASON.NO_RESTRICTED_SIGNAL);',
      "  return Object.freeze({ sensitivityClass: 'BOGUS', reason: CLASSIFICATION_REASON.NO_RESTRICTED_SIGNAL, noteBlock: 'bogus block' });"]], (r) => {
      ok('twin (a class outside the taxonomy): the enrichment call is withheld as UNKNOWN, the write stage REFUSES the field by name, and the lead is still filed',
        r.status === 200 && r.scored === 0 && r.creates.length === 1 && !r.creates[0].body.customFields.some((f) => f.key === KEY) &&
        r.logs.includes('[warn] [DATA-CLASS] {"enrichment":"withheld","reason":"UNKNOWN_SENSITIVITY_CLASS"}') &&
        r.logs.includes('[warn] [CY2027-CRM] refused: DATA_SENSITIVITY_CLASS') && !JSON.stringify(r.calls).includes('BOGUS'),
        `status=${r.status} scored=${r.scored} ` + r.logs.join('|').slice(0, 400));
    });
    delete process.env.CY2027_CRM_FIELD_IDS;
  } catch (e) {
    harnessError = e;
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  ok('the twin laboratory ran to the end', harnessError === null, harnessError && (harnessError.stack || String(harnessError)));
}

// ── 12. Wiring that the laboratories cannot distinguish, on comment-free source, whole lines ──
{
  const LEAD = strip(read('../api/submit-lead.js'));
  ok('the lead is classified from the five FREE-TEXT redactors and the PHI categories — not from _dmFlags',
    /^[ \t]*var _sensitivity = classifyLeadRecord\(\{\s*\n[ \t]*signalFlags: \[\]\.concat\(_dmNotes\.flags, _dmSummary\.flags, _dmClientFlags\.flags, _dmBestTime\.flags, _dmInterest\.flags\),\s*\n[ \t]*phiCategories: _phiCats,\s*\n[ \t]*\}\);/m.test(LEAD));
  const iPhi = LEAD.indexOf('scrubPHI(lead_notes)');
  const iDm = LEAD.indexOf('redactProhibitedForScoring(lead_notes)');
  const iCls = LEAD.indexOf('classifyLeadRecord({');
  const iGate = LEAD.indexOf('enrichmentExposure(_sensitivity.sensitivityClass)');
  const iCall = LEAD.indexOf('analyzeLeadIntelligence({');
  const iIdentity = LEAD.indexOf('scrubIdentityForIntel((lead_notes');
  ok('PHI scrub, then redaction, then classification, then the gate, then the vendor call — and the identity scrub inside it',
    iPhi > -1 && iPhi < iDm && iDm < iCls && iCls < iGate && iGate < iCall && iIdentity > iCall, JSON.stringify({ iPhi, iDm, iCls, iGate, iCall, iIdentity }));
  ok('there is one vendor call site, and it is the gated one',
    (LEAD.match(/analyzeLeadIntelligence\(\{/g) || []).length === 1 && /^[ \t]*intel = !_exposure\.allowed \? null : await analyzeLeadIntelligence\(\{/m.test(LEAD));
  ok('COARSE_METADATA — ZIP3 and an age band, not ZIP5 or the age', /zipCode: String\(zip \|\| ''\)\.slice\(0, 3\)/.test(LEAD) && /return lo \+ '-' \+ \(lo \+ 4\);/.test(LEAD));
  ok('the class entry rides the create body in the same chain as the two CY2027 families',
    /^[ \t]*\.concat\(_cbRec\.fields\)\s*\n[ \t]*\.concat\(_benefit\.fields\)\s*\n[ \t]*\.concat\(_cyFields\.fields\),/m.test(LEAD));
  ok('and is part of the one retry without owner-configured entries',
    /^[ \t]*var _ownerIdFields = _cbRec\.fields\.concat\(_benefit\.fields, _cyFields\.fields\);/m.test(LEAD));
  ok('the sweep for look-alikes runs over both doors right before the block is appended',
    /^[ \t]*lead_notes = neutralizeClassLookalikes\(lead_notes\);\s*\n[ \t]*conversation_summary = neutralizeClassLookalikes\(conversation_summary\);\s*\n[ \t]*lead_notes = \(lead_notes \? lead_notes\.trimEnd\(\) \+ '\\n\\n' : ''\) \+ _sensitivity\.noteBlock;/m.test(LEAD));
  const OPT = strip(read('../api/opt-out.js'));
  ok('a revocation is classified from the consent record class, once, at module scope',
    /^const REVOCATION_SENSITIVITY_CLASS = sensitivityForEvidenceRecord\(RECORD_CLASS\.CONSENT_RECORD\);/m.test(OPT) && (OPT.match(/sensitivityForEvidenceRecord\(/g) || []).length === 1);
  ok('the opt-out still cannot create or re-enable a contact', !/contacts\/upsert/.test(OPT) && !/dnd:\s*false/.test(OPT));
  // AUDIT 2026-10-04 (CRM-25, red team) — on the raw file an entry wrapped in
  // /* … */ still matched (mutant survived). Comment-free source, like every
  // other scan here.
  ok('the battery runs this suite (an entry inside a comment is no registration)', /^[ \t]*'test-cy2027-sensitivity-2026-10-04\.mjs',/m.test(strip(read('./run-battery.mjs'))));
  const DOC = read('../docs/compliance/CY2027-ARCHITECTURE.md');
  ok('the architecture document names the module, the three classes and the owner decision',
    /^### 2\.6 Data sensitivity class/m.test(DOC) && /sensitivity\.js/.test(DOC) && Object.values(C).every((c) => DOC.includes('`' + c + '`')) &&
    /Sensitivity class names/.test(DOC));
}

if (failures.length) {
  console.error(`CY2027 SENSITIVITY: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  FAIL ' + f + '\n');
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

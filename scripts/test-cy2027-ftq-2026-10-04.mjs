// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — LEAD DATA-QUALITY FACTS (spec §12; audit FTQ-11, FTQ-15).
//
//   FTQ-11  "disposable contact data" is a REVIEW signal the SERVER raises.
//           The throwaway-inbox list lived only in the browser validator, so a
//           direct POST reached the CRM with no signal at all.
//   FTQ-15  "Do not label 'fraudulent' without evidence." The support bot wrote
//           `probable_fake_lead: true` + a tag of the same name on ANY single
//           inconsistency — an out-of-area ZIP, a name the validator did not
//           recognise. The conclusion is now an aggregate ("a human should check
//           this data"), the label is gone from the bot's vocabulary, and the
//           server refuses it as a tag and de-labels it in free text.
//
// Every rule is exercised by CALLING it. api/submit-lead.js is RUN, in process,
// against a laboratory CRM (globalThis.fetch replaced — nothing leaves this
// machine). The support engine is DRIVEN through real turns in a tsx child
// process, because this suite stays plain node. The few structural scans are
// anchored to a line start and go through strip(), so a comment cannot satisfy
// them and an `if (false)` prefix breaks them.
//
// Run: node scripts/test-cy2027-ftq-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DISPOSABLE_EMAIL_DOMAINS, emailDomain, isDisposableEmail,
  REVIEW_INCONSISTENCY_KINDS, DATA_REVIEW_WEIGHT_THRESHOLD, inconsistencyKind, aggregateInconsistency,
  CLIENT_LABEL_REMOVED, neutralizeFakeLeadLabel,
  VERDICT_TAG_VOCABULARY, TAG_REFUSAL_REASONS, normalizeTagKey, clientTagRefusal,
} from '../api/_lib/cy2027/data-quality.js';
import { LEAD_TRUST_STATE, REVIEW_SIGNALS, assertSignalAllowed, evaluateTrust, trustCapabilities } from '../api/_lib/cy2027/trust.js';
import { readShownConsentWording } from './consent-wording-gate.mjs';
import { stripComments, unfrozenPaths, runGate, GOVERNING_IDENTIFIERS } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src) => stripComments(src);
const sha = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex');
const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');
/** A structural scan anchored to a line start: a leading `if (false)` or a comment cannot satisfy it. */
const line = (re) => new RegExp('^[ \\t]*' + re.source, 'm' + re.flags.replace('m', ''));

// ── 1. FTQ-11: the canonical fact, called ────────────────────────────────────
ok('FTQ-11: a throwaway inbox is recognised', isDisposableEmail('someone@mailinator.com') === true);
ok('FTQ-11: case and surrounding whitespace do not hide it', isDisposableEmail('  Someone@MAILINATOR.com ') === true);
ok('FTQ-11: a subdomain of a throwaway service is the same service', isDisposableEmail('x@inbox.yopmail.com') === true);
ok('FTQ-11: a look-alike domain is NOT flagged',
  isDisposableEmail('x@notmailinator.com') === false && isDisposableEmail('x@mailinator.com.example.org') === false);
// AUDIT 2026-10-04 (FTQ-11, red team) — the handler KEEPS these addresses (its RFC-lite
// shape test passes) and the domain used to be read verbatim, so one stray byte hid the service.
for (const v of ['<x@mailinator.com>', 'x@mailinator.com;', 'x@mailinator.com,', '"x@mailinator.com"', 'x@mailinator.com)', "x@mailinator.com'",
  'x@mailinator.com:25', 'x@mailinator.com/path', 'x@mailinator.com?x', 'x@mailinator.com#', 'x@mailinator.com​', 'x@[mailinator.com]']) {
  ok(`FTQ-11: ${JSON.stringify(v)} — a wrapper or trailing character does not hide the service`,
    isDisposableEmail(v) === true && emailDomain(v) === 'mailinator.com', `domain=${JSON.stringify(emailDomain(v))}`);
}
ok('FTQ-11: a different domain that merely contains the name is still not flagged',
  isDisposableEmail('x@xn--mailinator.com') === false && emailDomain('x@xn--mailinator.com') === 'xn--mailinator.com');
ok('FTQ-11: the signal still follows the handler\'s keep-test — an address it drops (a space) raises nothing',
  isDisposableEmail('x y@mailinator.com') === false && emailDomain('x y@mailinator.com') === '');
ok('FTQ-11: a domain in another script is not an entry of the ASCII list', isDisposableEmail('x@münchen.de') === false);
ok('FTQ-11: ordinary providers are not flagged',
  ['a@gmail.com', 'b@yahoo.com', 'c@aol.com', 'd@icloud.com', 'e@outlook.com', 'f@optonline.net'].every((e) => isDisposableEmail(e) === false));
ok('FTQ-11/FTQ-16: having no email is never a signal',
  [undefined, null, '', '   ', 42, {}, []].every((v) => isDisposableEmail(v) === false));
ok('FTQ-11: an unreadable address is uncertainty, not evidence',
  ['a b@mailinator.com', 'mailinator.com', 'a@@mailinator.com', '@mailinator.com', 'a@mailinator'].every((v) => isDisposableEmail(v) === false));
ok('FTQ-11: an over-long address (the server drops it) is not tested either',
  isDisposableEmail('a'.repeat(250) + '@mailinator.com') === false);
ok('FTQ-11: the domain helper normalises, and returns nothing for a non-address',
  emailDomain('not an email') === '' && emailDomain('A@B.Example.COM.') === 'b.example.com' && emailDomain(null) === '');
ok('FTQ-11: the list is frozen, lower-case, 27 entries and well-formed',
  Object.isFrozen(DISPOSABLE_EMAIL_DOMAINS) && DISPOSABLE_EMAIL_DOMAINS.length === 27 &&
  DISPOSABLE_EMAIL_DOMAINS.every((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)));
ok('FTQ-11: every listed domain is flagged, as itself and as a subdomain',
  DISPOSABLE_EMAIL_DOMAINS.every((d) => isDisposableEmail('x@' + d) && isDisposableEmail('x@mail.' + d)));
ok('FTQ-11: no ordinary mailbox provider is on the list',
  !['gmail.com', 'yahoo.com', 'aol.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'msn.com', 'comcast.net', 'verizon.net', 'optonline.net']
    .some((d) => DISPOSABLE_EMAIL_DOMAINS.includes(d)));
throws('FTQ-11: the list cannot be extended at runtime', () => { DISPOSABLE_EMAIL_DOMAINS.push('gmail.com'); }, /object is not extensible|read only|Cannot add/i);

// ── 2. FTQ-11: what the signal does once raised — review, never rejection ────
ok('FTQ-11: DISPOSABLE_CONTACT_DATA is a registered review signal',
  REVIEW_SIGNALS.includes('DISPOSABLE_CONTACT_DATA') && assertSignalAllowed('DISPOSABLE_CONTACT_DATA') === true);
{
  const dispo = evaluateTrust({ signals: ['DISPOSABLE_CONTACT_DATA'] });
  ok('FTQ-11: on its own it asks for a human, it does not quarantine',
    dispo.state === LEAD_TRUST_STATE.HUMAN_REVIEW_REQUIRED && dispo.reason === 'DISPOSABLE_CONTACT_DATA' && dispo.humanReviewRequired === true);
  ok('FTQ-11: it never blocks being served by a human', trustCapabilities(dispo.state).mayBeServedByHuman === true);
  ok('FTQ-11: no signal, no state change', evaluateTrust({ signals: [] }).state === LEAD_TRUST_STATE.UNVERIFIED);
}

// ── 3. FTQ-15: the aggregation rule, called ──────────────────────────────────
{
  const one = (reason, penalty, from) => aggregateInconsistency(from, reason, penalty);
  const name1 = one('name_suspicious_name', 30);
  ok('FTQ-15: ONE unrecognised name is recorded as a kind, not as a review',
    name1.reviewSuggested === false && name1.kinds.join() === 'name' && name1.weight === 30);
  ok('FTQ-15: ONE invalid phone does not suggest review', one('phone_fake_number', 25).reviewSuggested === false);
  const ooa = one('zip_not_in_service_area: 33101', 25);
  ok('FTQ-15: living outside the service area never counts',
    ooa.reviewSuggested === false && ooa.kinds.length === 0 && ooa.weight === 0);
  ok('FTQ-15: nor does it however often it is recorded',
    one('zip_not_in_service_area: 33101', 25, one('zip_not_in_service_area: 33101', 25, ooa)).reviewSuggested === false);
  ok('FTQ-15/§15: a frustration marker never counts',
    one('recovery_frustration', 100).reviewSuggested === false && one('recovery_frustration', 100).weight === 0);
  ok('FTQ-15: an unknown kind does not count until it is added on purpose', one('email_fake_pattern', 100).reviewSuggested === false);
  ok('FTQ-15: the SAME kind twice is one kind (retyping is not evidence)',
    one('name_too_short', 30, name1).reviewSuggested === false && one('name_too_short', 30, name1).weight === 30 &&
    one('name_too_short', 30, name1).kinds.join() === 'name');
  const both = one('phone_fake_number', 25, name1);
  ok('FTQ-15: two DISTINCT low-weight kinds aggregate to a review',
    both.reviewSuggested === true && both.kinds.join() === 'name,phone' && both.weight === 55);
  ok('FTQ-15: a state/ZIP contradiction is a review signal on its own (§12)',
    one('zip_state_mismatch: zip 10001 → NY, user said FL', 50).reviewSuggested === true);
  ok('FTQ-15: exactly the threshold suggests review; one below does not',
    one('zip_state_mismatch: x', DATA_REVIEW_WEIGHT_THRESHOLD).reviewSuggested === true &&
    one('zip_state_mismatch: x', DATA_REVIEW_WEIGHT_THRESHOLD - 1).reviewSuggested === false);
  ok('FTQ-15: geography plus one low-weight kind is still not a review',
    one('name_suspicious_name', 30, ooa).reviewSuggested === false);
  ok('FTQ-15: the aggregator is pure',
    (() => { const cur = Object.freeze({ kinds: Object.freeze(['name']), weight: 30 }); const n = one('phone_x', 25, cur); return cur.kinds.length === 1 && cur.weight === 30 && n.kinds !== cur.kinds; })());
  ok('FTQ-15: a garbage penalty adds nothing',
    one('name_x', NaN).weight === 0 && one('name_x', -40).weight === 0 && one('name_x', '30').weight === 0 && one('name_x', Infinity).weight === 0);
  ok('FTQ-15: a garbage aggregate is treated as empty',
    one('name_x', 30, null).weight === 30 && one('name_x', 30, { kinds: 'name', weight: 'x' }).weight === 30);
  ok('FTQ-15: the threshold and the counted kinds are pinned',
    DATA_REVIEW_WEIGHT_THRESHOLD === 50 && Object.isFrozen(REVIEW_INCONSISTENCY_KINDS) &&
    REVIEW_INCONSISTENCY_KINDS.join() === 'zip_state_mismatch,name,phone');
  ok('FTQ-15: reason → kind',
    inconsistencyKind('zip_state_mismatch: zip 1 → NY') === 'zip_state_mismatch' && inconsistencyKind('phone_bad') === 'phone' &&
    inconsistencyKind('name_too_short') === 'name' && inconsistencyKind(null) === '' && inconsistencyKind(undefined) === '');
}

// ── 4. FTQ-15: the retired label in free text, called ────────────────────────
ok('FTQ-15: the machine line is de-labelled, the rest of the line is kept',
  neutralizeFakeLeadLabel('probable_fake_lead: true') === CLIENT_LABEL_REMOVED + ': true');
ok('FTQ-15: every separator and case spelling of the label is caught',
  ['Probable-Fake-Lead', 'probableFakeLead', 'probable fake lead', 'PROBABLE_FAKE_LEAD', 'probable__fake--lead', 'ProbableFakeLead']
    .every((s) => neutralizeFakeLeadLabel('a ' + s + ' b') === 'a ' + CLIENT_LABEL_REMOVED + ' b'));
ok('FTQ-15: the marker is not itself a verdict', !/fake|fraud|scam|spam|bogus/i.test(CLIENT_LABEL_REMOVED));
{
  const prose = 'Caller reports a fraud call about a fake Medicare card.\ncategory_fraud_scam fraud_alert fraud_scam\nSe siente estafado; el lead falso no es tema.';
  ok('FTQ-15: a caller who REPORTS a scam, and an advisor\'s prose, are never rewritten', neutralizeFakeLeadLabel(prose) === prose);
}
{
  const note = 'Bot note\nprobable_fake_lead: true\nconfidence_score: 70\nstage=review_queue probableFakeLead=true\n';
  const out = neutralizeFakeLeadLabel(note);
  ok('FTQ-15: a multi-line note keeps every other byte',
    out === 'Bot note\n' + CLIENT_LABEL_REMOVED + ': true\nconfidence_score: 70\nstage=review_queue ' + CLIENT_LABEL_REMOVED + '=true\n');
}
ok('FTQ-15: non-strings become empty, the empty string stays empty (the sibling neutralisers\' contract)',
  neutralizeFakeLeadLabel(null) === '' && neutralizeFakeLeadLabel(42) === '' && neutralizeFakeLeadLabel('') === '');
// AUDIT 2026-10-04 (FTQ-15, red team) — the spellings that walked through: look-alike
// letters, invisible characters, other separators, and the old builder's own prose.
ok('FTQ-15: a Cyrillic а inside the label does not hide it — and the Cyrillic name beside it is not touched',
  neutralizeFakeLeadLabel('Иван probable_fаke_lead: true Петров') === 'Иван ' + CLIENT_LABEL_REMOVED + ': true Петров');
ok('FTQ-15: zero-width and soft-hyphen characters between the letters do not hide it',
  neutralizeFakeLeadLabel('probable​fake​lead') === CLIENT_LABEL_REMOVED &&
  neutralizeFakeLeadLabel('probable_fake_lead'.split('').join('­')) === CLIENT_LABEL_REMOVED);
ok('FTQ-15: dots, slashes and fullwidth letters do not hide it',
  ['probable.fake.lead', 'probable/fake/lead', 'ｐｒｏｂａｂｌｅ fake lead'].every((s) => neutralizeFakeLeadLabel(s) === CLIENT_LABEL_REMOVED));
ok('FTQ-15: the old builder\'s Advisor-action prose is de-labelled in both languages, the rest of the line kept',
  neutralizeFakeLeadLabel('Send to review queue — possible data quality issue (low confidence or fake-lead signal).')
    === 'Send to review queue — possible data quality issue (low confidence or ' + CLIENT_LABEL_REMOVED + ').' &&
  neutralizeFakeLeadLabel('Enviar a cola de revisión — posible problema de calidad de datos (baja confianza o señal de lead falso).')
    === 'Enviar a cola de revisión — posible problema de calidad de datos (baja confianza o ' + CLIENT_LABEL_REMOVED + ').');
ok('FTQ-15: "lead falso" in a caller\'s own words, and a line break inside the label, are left alone',
  neutralizeFakeLeadLabel('el lead falso no es tema') === 'el lead falso no es tema' && neutralizeFakeLeadLabel('probable\nfake lead') === 'probable\nfake lead');

// ── 5. One list, one rule: the client reaches both through the barrel ────────
{
  const VAL = strip(read('../src/lib/validation.ts'));
  const BARREL = strip(read('../src/lib/cy2027.ts'));
  const SL = strip(read('../api/submit-lead.js'));
  ok('FTQ-11: the browser validator spreads the canonical list into its reject set',
    line(/const BLOCKED_DOMAINS = new Set<string>\(\[\s*\.\.\.DISPOSABLE_EMAIL_DOMAINS,/).test(VAL));
  ok('FTQ-11: the browser validator keeps no second copy of it',
    !DISPOSABLE_EMAIL_DOMAINS.some((d) => VAL.includes("'" + d + "'")), 'a disposable domain is still a literal in src/lib/validation.ts');
  ok('FTQ-11: the server has no private copy of it either', !DISPOSABLE_EMAIL_DOMAINS.some((d) => SL.includes("'" + d + "'")));
  ok('FTQ-11: the client reaches the list through the cy2027 barrel',
    line(/import \{ DISPOSABLE_EMAIL_DOMAINS \} from '\.\/cy2027';/).test(VAL) &&
    /DISPOSABLE_EMAIL_DOMAINS[\s\S]{0,160}from '\.\.\/\.\.\/api\/_lib\/cy2027\/data-quality\.js'/.test(BARREL));
  ok('FTQ-15: the aggregate and the kinds reach the client through the barrel',
    /REVIEW_INCONSISTENCY_KINDS,\s*aggregateInconsistency,[\s\S]{0,40}\} from '\.\.\/\.\.\/api\/_lib\/cy2027\/data-quality\.js'/.test(BARREL));
  ok('FTQ-11/FTQ-15: the lead path imports the canonical rules — the signal, the neutraliser and the tag refusal',
    line(/import \{ isDisposableEmail, neutralizeFakeLeadLabel, clientTagRefusal \} from '\.\/_lib\/cy2027\/data-quality\.js';/).test(SL));
  ok('FTQ-11: the signal is derived on the server, from the capped raw address, before the trust state is computed',
    line(/if \(isDisposableEmail\(_cap\(email, 254\)\)\) \{\s*_trustSignals\.push\('DISPOSABLE_CONTACT_DATA'\);\s*\}/).test(SL) &&
    SL.indexOf("_trustSignals.push('DISPOSABLE_CONTACT_DATA')") < SL.indexOf('evaluateTrust({ signals: _trustSignals })'));
  ok('FTQ-11/FTQ-16: a disposable address can never reject a lead',
    !/isDisposableEmail\([\s\S]{0,400}return res\.status\(4/.test(SL), 'a 4xx sits right after the disposable check');
  ok('FTQ-15: client free text is de-labelled where it is accepted — notes, summary and quality flags',
    line(/lead_notes = neutralizeFakeLeadLabel\(lead_notes\);/).test(SL) &&
    line(/conversation_summary = neutralizeFakeLeadLabel\(conversation_summary\);/).test(SL) &&
    line(/lead_quality_flags = neutralizeFakeLeadLabel\(lead_quality_flags\);/).test(SL));
  // The first occurrence of the scorer's name is its import; the last is the call.
  ok('FTQ-15: …and before the scorer reads it',
    SL.indexOf('neutralizeFakeLeadLabel(lead_notes)') > -1 && SL.lastIndexOf('analyzeLeadIntelligence(') > SL.indexOf('neutralizeFakeLeadLabel(lead_notes)'));
}

// ── 6. FTQ-15: the engine and the note builder carry no fraud label ──────────
{
  const ENG = strip(read('../src/lib/customerServiceEngine.ts'));
  const LNB = strip(read('../src/lib/orchestrator/leadNoteBuilder.ts'));
  const FLAG = (ENG.match(/^function flagInconsistency\([\s\S]*?\n\}/m) || [''])[0];
  ok('FTQ-15: flagInconsistency is where the scan expects it', FLAG.length > 0);
  ok('FTQ-15: the engine carries no fake-lead flag', !/probableFakeLead/.test(ENG), 'probableFakeLead is back in the engine');
  ok('FTQ-15: the note builder emits no fake-lead field, tag or wording',
    !/probable_fake_lead|probableFakeLead|fake-lead|lead falso/i.test(LNB), 'a fake-lead label is back in leadNoteBuilder.ts');
  ok('FTQ-15: recording an inconsistency never sets the review flag unconditionally', !/dataReviewSuggested\s*=\s*true/.test(ENG));
  ok('FTQ-15: the engine derives the flag from the canonical aggregate',
    line(/const next = aggregateInconsistency\(/).test(FLAG) &&
    line(/\{ kinds: state\.inconsistencyKinds, weight: state\.inconsistencyWeight \},/).test(FLAG) &&
    line(/state\.inconsistencyKinds = next\.kinds;/).test(FLAG) &&
    line(/state\.inconsistencyWeight = next\.weight;/).test(FLAG) &&
    line(/state\.dataReviewSuggested = next\.reviewSuggested;/).test(FLAG));
  ok('FTQ-15: the engine imports the aggregate through the barrel', line(/import \{ aggregateInconsistency \} from '\.\/cy2027\.ts';/).test(ENG));
  ok('FTQ-15: every inconsistency is still recorded and still lowers the confidence score',
    line(/state\.inconsistencies = \[\.\.\.\(state\.inconsistencies \|\| \[\]\), reason\];/).test(FLAG) &&
    line(/state\.dataConfidenceScore = Math\.max\(0, \(state\.dataConfidenceScore \?\? 100\) - penalty\);/).test(FLAG));
  ok('FTQ-15: a fresh conversation starts with no review, no kinds, zero weight',
    line(/dataReviewSuggested: false,/).test(ENG) && line(/inconsistencyKinds: \[\],/).test(ENG) && line(/inconsistencyWeight: 0,/).test(ENG));
  ok('FTQ-15: the note names the kinds from the canonical allow-list only',
    line(/const inconsistencyKinds: string\[\] = REVIEW_INCONSISTENCY_KINDS\.filter\(\(k\) => \(state\.inconsistencyKinds \|\| \[\]\)\.includes\(k\)\);/).test(LNB) &&
    line(/import \{ REVIEW_INCONSISTENCY_KINDS \} from '\.\.\/cy2027';/).test(LNB));
  ok('FTQ-15: the emitted machine fields and tag ask for a data review',
    line(/`data_review_suggested: \$\{dataReviewSuggested \? 'true' : 'false'\}`,/).test(LNB) &&
    line(/`inconsistency_kinds: \$\{inconsistencyKinds\.length \? inconsistencyKinds\.join\(','\) : 'none'\}`,/).test(LNB) &&
    line(/if \(dataReviewSuggested\) tags\.push\('data_review_suggested'\);/).test(LNB));
  ok('FTQ-15: review_queue is reached through the aggregate or the score — nothing else',
    line(/if \(state\.dataReviewSuggested \|\| \(state\.dataConfidenceScore \?\? 100\) < 40\) return 'review_queue';/).test(LNB));
  ok('FTQ-15: the review-queue instruction says it is not a finding about the caller (en + es)',
    /not a finding about the caller/.test(LNB) && /no una conclusión sobre la persona/.test(LNB));
}

// ── 7. FTQ-15: the server's tag filter — the verdict rule CALLED, the owned spellings lifted ──
// AUDIT 2026-10-04 (red team) — the verdict used to be an alternation inside the
// handler's ^…$ deny-regex: 22 affixed or other-vocabulary verdicts reached the
// CRM. The rule is now clientTagRefusal() in data-quality.js and is called here;
// the lifted regexes are only the server-owned spellings they still hold.
{
  const SL = read('../api/submit-lead.js');
  const denyKeys = new RegExp(SL.match(/^[ \t]*var _denyKeys = \/(.+)\/;$/m)[1]);
  const denyFamily = new RegExp(SL.match(/^[ \t]*var _denyFamilyPrefix = \/(.+)\/;$/m)[1]);
  const dash = (tag) => String(tag).toLowerCase().replace(/[\s_‐-―−-]+/g, '-').replace(/^-+|-+$/g, '');
  const owned = (tag) => denyKeys.test(dash(tag).replace(/-/g, '')) || denyFamily.test(dash(tag));
  const VERDICTS = ['probable_fake_lead', 'Probable-Fake-Lead', 'PROBABLE FAKE LEAD', 'probableFakeLead', 'fake_lead', 'fake lead', 'fakelead',
    'likely_fake', 'suspected_fraud', 'possible_scam', 'confirmed_bogus', 'spam_caller', 'scam_submission', 'fraudulent_lead', 'fraud_lead', 'bogus_contact', 'spam person',
    // the red team's 22
    'probable_fake_lead_true', 'x_probable_fake_lead', 'fake_lead_1', 'is_fake_lead', 'probable_fake_lead_v2', 'fakelead2', 'fake_leads_list', 'lead_fake',
    'fake_client', 'fake_customer', 'scammer', 'fraudster', 'suspicious_caller', 'likely_scammer', 'bot_lead', 'junk_lead', 'not_real_person', 'phony_lead',
    'fraud_risk_high', 'liar', 'probable_fraudster', 'fake_user',
    // wearing a server family's prefix, spelled with Cyrillic а, or spelled from the neutraliser's marker
    'CallTime-probable-fake-lead', 'Interest-fake-lead', 'UTM-fake_lead', 'probаble_fаke_leаd', 'CallTime-client-label-removed-true',
    'is-bot', 'bot_detected', 'not-a-person', 'nonreal', 'scam-score', 'fake_identity', 'false_identity', 'troll_lead', 'customer_fake'];
  const TOPICS = ['data_review_suggested', 'category_fraud_scam', 'fraud_alert', 'fraud_scam', 'confidence_low', 'confidence_medium',
    'status_existing_client_claimed', 'urgency_elevated', 'customer_service_bot', 'language_es', 'state_FL', 'phi_scrubbed', 'Website Lead', 'CallTime-morning',
    'clara_bot', 'category_billing', 'status_existing_client', 'consent_no', 'consent_unknown', 'Interest-Part-D', 'Interest-Extra-Help-LIS-question', 'CallTime-Atencion-medica',
    // the engine's data-validation reasons are about the DATA, not the person
    'fake_number', 'fake_pattern', 'inappropriate_or_fake', 'suspicious_name', 'name_suspicious_full',
    // topics that merely contain a verdict word, and ordinary words that contain a short one
    'spam_filter_question', 'scam_call_report', 'fraud_scam_question', 'familiar', 'Abbott-Labs', 'robotics-question', 'is-enrolled', 'not-enrolled', 'non-member', 'leads_pipeline'];
  // Tags only the SERVER mints (a client's copy is refused as an owned family) — they pass the verdict rule and nothing else.
  const MINTED = ['Source-other', 'Source-clearpoint_senior_advisors_website', 'Source-zara_education', 'UTM-google', 'UTM-fb_ad_2026', 'CallTime-morning', 'Interest-Part-D'];
  for (const t of VERDICTS) {
    const r = clientTagRefusal(t);
    ok(`FTQ-15: a client-asserted verdict "${t}" is refused as a tag, by name`, typeof r === 'string' && TAG_REFUSAL_REASONS[r] === r, `got ${r}`);
  }
  for (const t of TOPICS) ok(`FTQ-15: "${t}" (a description, not a verdict) still reaches the CRM`, clientTagRefusal(t) === null && !owned(t), `refused=${clientTagRefusal(t)} owned=${owned(t)}`);
  for (const t of MINTED) ok(`FTQ-15: the server-minted "${t}" passes the verdict rule it is now judged by`, clientTagRefusal(t) === null, `refused=${clientTagRefusal(t)}`);
  ok('FTQ-15: a client cannot mint a Source-/UTM- tag itself (owned families)', owned('Source-other') && owned('UTM-google'));
  ok('FTQ-15: the retired label is refused as itself whatever its affixes or prefix',
    ['probable_fake_lead', 'probable_fake_lead_true', 'x_probable_fake_lead', 'CallTime-probable-fake-lead', 'probаble_fаke_leаd'].every((t) => clientTagRefusal(t) === TAG_REFUSAL_REASONS.RETIRED_LABEL));
  ok('FTQ-15: each verdict shape answers its own reason',
    clientTagRefusal('suspected_fraud') === 'QUALIFIED_VERDICT' && clientTagRefusal('is_fake_lead') === 'QUALIFIED_VERDICT' && clientTagRefusal('likely_scammer') === 'QUALIFIED_VERDICT' &&
    clientTagRefusal('lead_fake') === 'VERDICT_ON_SUBJECT' && clientTagRefusal('fakelead2') === 'VERDICT_ON_SUBJECT' && clientTagRefusal('suspicious_caller') === 'VERDICT_ON_SUBJECT' &&
    clientTagRefusal('scammer') === 'PERSON_NOUN' && clientTagRefusal('liar') === 'PERSON_NOUN' &&
    clientTagRefusal('not_real_person') === 'NEGATED_GENUINE' && clientTagRefusal('fraud_risk_high') === 'VERDICT_ASSESSMENT' &&
    clientTagRefusal('CallTime-client-label-removed-true') === 'NEUTRALISED_MARKER');
  ok('FTQ-15: the short words count only as whole tokens — a substring of an ordinary word is not a verdict',
    clientTagRefusal('familiar') === null && clientTagRefusal('liar') === 'PERSON_NOUN' && clientTagRefusal('is-enrolled') === null && clientTagRefusal('is-fake') === 'QUALIFIED_VERDICT');
  ok('FTQ-15: the key folds look-alikes, accents, invisibles, case and every separator',
    normalizeTagKey('Probаble-Fаke_Leаd') === 'probable-fake-lead' && normalizeTagKey(' Atención médica ') === 'atencion-medica' &&
    normalizeTagKey('fake​lead') === 'fakelead' && normalizeTagKey(42) === '');
  ok('FTQ-15: a non-string is not the rule\'s business (null — the handler\'s charset gate decides)',
    clientTagRefusal(null) === null && clientTagRefusal(['fake_lead']) === null && clientTagRefusal(42) === null && clientTagRefusal('') === null);
  ok('FTQ-15: the handler\'s own regex no longer carries a private copy of the verdict vocabulary',
    !/fake|fraud|bogus|scam|spam|probable/.test(denyKeys.source), denyKeys.source);
  ok('FTQ-15: the server-owned spellings are still exact and still refused',
    ['Status-NewLead', 'consent_yes', 'Consent Captured', 'SOA-Signed', 'DNC', 'Lang-ES', 'utm-x', 'source-x', 'Temp-Hot'].every(owned));
  ok('FTQ-15: the vocabulary and the reason table are frozen all the way down',
    unfrozenPaths(VERDICT_TAG_VOCABULARY, 'V').length === 0 && unfrozenPaths(TAG_REFUSAL_REASONS, 'R').length === 0);
  ok('FTQ-15: the long person nouns are long enough to be matched contained (≥ 6 letters)',
    VERDICT_TAG_VOCABULARY.personNouns.every((w) => w.length >= 6) && VERDICT_TAG_VOCABULARY.qualifiers.every((w) => w.length >= 5));
}

// ── 8. api/submit-lead.js, run for real against a laboratory CRM ─────────────
const SHOWN = readShownConsentWording(read('../src/lib/disclaimerVersion.ts'));
ok('the consent wording the site shows is readable (the laboratory leads consent with it)',
  typeof SHOWN.version === 'string' && SHOWN.version.length > 0 && typeof SHOWN.en === 'string' && SHOWN.en.length > 100);
{
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

    const LOGS = [];
    for (const k of ['log', 'warn', 'error']) {
      console[k] = (...a) => { LOGS.push('[' + k + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
    }
    const GHL = 'https://services.leadconnectorhq.com';
    let CALLS = [];
    let ROUTE = null;
    let LLM = null;
    let SCORED = [];
    const resp = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (LLM && u === 'https://api.anthropic.com/v1/messages') {
        SCORED.push(String(opts.body));
        return LLM(JSON.parse(opts.body));
      }
      if (!u.startsWith(GHL + '/')) throw new Error('the suite must not reach ' + u.slice(0, 60));
      let body = null;
      try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = String(opts.body); }
      const call = { method: String(opts.method || 'GET').toUpperCase(), path: u.slice(GHL.length), body };
      CALLS.push(call);
      return ROUTE(call);
    };
    const route = () => (call) => {
      if (call.method === 'POST' && call.path === '/contacts/') return resp(201, { contact: { id: 'C_NEW' } });
      if (call.method === 'GET' && call.path.startsWith('/contacts/?')) return resp(200, { contacts: [] });
      if (call.method === 'POST' && /\/notes$/.test(call.path)) return resp(200, { note: { id: 'N1' } });
      if (call.method === 'GET' && call.path.startsWith('/opportunities/search')) return resp(200, { opportunities: [] });
      if (call.method === 'POST' && call.path === '/opportunities/') return resp(201, { opportunity: { id: 'O1' } });
      if (call.method === 'PUT' && call.path.startsWith('/contacts/')) return resp(200, { contact: { id: 'x' } });
      return resp(404, { error: 'unrouted' });
    };
    let ipSeq = 10;
    let phoneSeq = 4046000;
    const mkReq = (body) => ({
      method: 'POST',
      headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '203.0.113.' + (ipSeq++), 'user-agent': 'ftq-suite', 'content-type': 'application/json' },
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
    const submitLead = (await import('../api/submit-lead.js')).default;
    const run = async (body) => {
      CALLS = []; LOGS.length = 0; SCORED = []; ROUTE = route();
      const res = mkRes();
      let threw = null;
      try { await submitLead(mkReq(body), res); } catch (e) { threw = String((e && e.message) || e); }
      const creates = CALLS.filter((c) => c.method === 'POST' && c.path === '/contacts/');
      return {
        status: res.statusCode, payload: res.payload, threw, calls: CALLS.slice(), logs: LOGS.slice(), scored: SCORED.slice(), creates, sent: body,
        notes: CALLS.filter((c) => /\/notes$/.test(c.path)).map((c) => String(c.body && c.body.body)),
        opportunities: CALLS.filter((c) => c.method === 'POST' && c.path === '/opportunities/').length,
        paths: CALLS.map((c) => c.method + ' ' + c.path.replace(/\?.*$/, '')).join(' | '),
        wire: JSON.stringify(CALLS.map((c) => c.body)),
      };
    };
    const fields = (c) => (c && c.body && c.body.customFields) || [];
    const cf = (c, key) => (fields(c).find((f) => f.key === key) || {}).value;
    const created = (r) => r.status === 200 && !r.threw && r.creates.length === 1 && r.notes.length === 1;
    const trustFlags = (r) => String(cf(r.creates[0], 'contact.lead_quality_flags') || '').split(/\s+/).filter((f) => /^TRUST_/.test(f));
    const reviewLines = (r) => r.logs.filter((l) => l.includes('[SECURITY-REVIEW]'));
    const reviewSignals = (r) => reviewLines(r).flatMap((l) => { const m = l.match(/\{.*\}/); try { return m ? JSON.parse(m[0]).signals || [] : []; } catch { return ['<unparseable>']; } });
    const FAKE_LABEL = /probable[\s_-]*fake[\s_-]*lead/i;

    // A — the control: an ordinary address raises nothing.
    const control = await run(lead());
    ok('handler (control): an ordinary lead is captured once', created(control), `status=${control.status} threw=${control.threw} creates=${control.creates.length}`);
    ok('handler (control): no trust flag, no security-review line', trustFlags(control).length === 0 && reviewLines(control).length === 0, trustFlags(control).join());
    ok('handler (control): the opportunity is created', control.opportunities === 1, control.paths);

    // B — a throwaway inbox: the SAME service, plus one review signal.
    const dispo = await run(lead({ email: 'dispo.probe.7q@mailinator.com' }));
    ok('handler (FTQ-11): a disposable address is captured once — a review signal, never a rejection',
      created(dispo), `status=${dispo.status} threw=${dispo.threw} creates=${dispo.creates.length} payload=${JSON.stringify(dispo.payload).slice(0, 200)}`);
    ok('handler (FTQ-11): the address itself is still stored on the contact', /dispo\.probe\.7q@mailinator\.com/i.test(String(dispo.creates[0] && dispo.creates[0].body && dispo.creates[0].body.email)));
    ok('handler (FTQ-11): TRUST_HUMAN_REVIEW_REQUIRED travels in contact.lead_quality_flags', trustFlags(dispo).join() === 'TRUST_HUMAN_REVIEW_REQUIRED', trustFlags(dispo).join());
    ok('handler (FTQ-11): the [SECURITY-REVIEW] line names DISPOSABLE_CONTACT_DATA and nothing else',
      reviewLines(dispo).length === 1 && reviewSignals(dispo).join() === 'DISPOSABLE_CONTACT_DATA', reviewLines(dispo).join(' || '));
    ok('handler (FTQ-11): neither the address nor its domain is ever logged',
      !dispo.logs.some((l) => /dispo\.probe\.7q|mailinator/i.test(l)), dispo.logs.filter((l) => /dispo\.probe\.7q|mailinator/i.test(l)).join(' || '));
    ok('handler (FTQ-11/FTQ-16): the same CRM calls as the control — the opportunity included', dispo.paths === control.paths && dispo.opportunities === 1, dispo.paths);
    ok('handler (FTQ-11): the review need is not written as an accusation anywhere on the wire',
      !/fraud|fake|bogus|scam|quarantine/i.test(dispo.wire.replace(/[^]*"customFields"/, '')) && !FAKE_LABEL.test(dispo.wire));

    // C — the same, spelled the way people type it, and at a subdomain of the service.
    const loud = await run(lead({ email: '  Dispo.Probe.9z@MAILINATOR.com ' }));
    ok('handler (FTQ-11): case and whitespace do not hide the service', created(loud) && trustFlags(loud).join() === 'TRUST_HUMAN_REVIEW_REQUIRED', trustFlags(loud).join());
    const sub = await run(lead({ email: 'dispo.probe.3k@inbox.yopmail.com' }));
    ok('handler (FTQ-11): a subdomain of a listed service raises the same signal', created(sub) && reviewSignals(sub).join() === 'DISPOSABLE_CONTACT_DATA', reviewSignals(sub).join());

    // D — the people §12 says must never be penalised: no email, an unreadable one, a look-alike domain.
    const none = await run(lead({ email: '' }));
    ok('handler (FTQ-16): a lead with NO email is captured and raises nothing', created(none) && trustFlags(none).length === 0 && reviewLines(none).length === 0,
      `status=${none.status} threw=${none.threw} flags=${trustFlags(none).join()}`);
    const broken = await run(lead({ email: 'dispo probe@mailinator.com' }));
    ok('handler (FTQ-11): an unreadable address is dropped, not turned into a signal', created(broken) && trustFlags(broken).length === 0 && reviewLines(broken).length === 0,
      `status=${broken.status} flags=${trustFlags(broken).join()}`);
    const alike = await run(lead({ email: 'dispo.probe.5m@notmailinator.com' }));
    ok('handler (FTQ-11): a look-alike domain raises nothing', created(alike) && trustFlags(alike).length === 0 && reviewLines(alike).length === 0, trustFlags(alike).join());

    // E — FTQ-15: the retired label as a TAG, next to the vocabulary that must keep flowing.
    const tagged = await run(lead({ tags: ['Website Lead', 'probable_fake_lead', 'Probable-Fake-Lead', 'fake_lead', 'suspected_fraud', 'spam caller',
      'data_review_suggested', 'category_fraud_scam', 'fraud_alert', 'confidence_low'] }));
    {
      const tags = (tagged.creates[0] && tagged.creates[0].body && tagged.creates[0].body.tags) || [];
      ok('handler (FTQ-15): the lead with verdict tags is still captured', created(tagged), `status=${tagged.status} threw=${tagged.threw}`);
      ok('handler (FTQ-15): no client-asserted verdict reaches the contact\'s tags',
        !tags.some((t) => /fake|fraud(?!_alert|_scam)|spam|suspected/i.test(t)), tags.join());
      ok('handler (FTQ-15): the neutral review tag and the caller\'s topic tags do',
        ['Website Lead', 'data_review_suggested', 'category_fraud_scam', 'fraud_alert', 'confidence_low'].every((t) => tags.includes(t)), tags.join());
      ok('handler (FTQ-15): the five refusals are counted in the audit line',
        tagged.logs.some((l) => /tags_rejected/.test(l) && /"denied":5/.test(l)), tagged.logs.filter((l) => /tags_rejected/.test(l)).join(' || '));
    }

    // F — FTQ-15: the retired label inside client FREE TEXT (a cached bundle, or a direct POST).
    process.env.ANTHROPIC_API_KEY = 'suite-double-not-a-key';
    LLM = () => resp(200, { content: [{ type: 'text', text: JSON.stringify({
      summary: 'Wants a call about coverage.', intent_strength: 5, lead_temperature: 'warm', urgency: 'this_week', advisor_prep_notes: 'none', compliance_flags: [], recommended_first_questions: [],
    }) }] });
    const texted = await run(lead({
      lead_notes: 'Customer Service Bot\nprobable_fake_lead: true\nconfidence_score: 70\nCaller reports a fraud call about a fake Medicare card.',
      conversation_summary: 'stage=review_queue probableFakeLead=true',
      lead_quality_flags: 'Probable Fake Lead',
    }));
    delete process.env.ANTHROPIC_API_KEY;
    LLM = null;
    ok('handler (FTQ-15): the lead with the label in its text is still captured', created(texted), `status=${texted.status} threw=${texted.threw}`);
    ok('handler (FTQ-15): the label reaches neither the note, nor any field, nor the tags — in any spelling',
      !FAKE_LABEL.test(texted.wire), (texted.wire.match(/.{0,40}probable[\s_-]*fake[\s_-]*lead.{0,40}/i) || []).join(' || '));
    ok('handler (FTQ-15): what replaced it is the neutral marker, and the rest of the client text is intact',
      texted.wire.includes(CLIENT_LABEL_REMOVED + ': true') && texted.wire.includes('confidence_score: 70') &&
      texted.wire.includes('Caller reports a fraud call about a fake Medicare card.'));
    ok('handler (FTQ-15): the scorer was consulted and never saw the label either',
      texted.scored.length === 1 && !FAKE_LABEL.test(texted.scored[0]) && texted.scored[0].includes(CLIENT_LABEL_REMOVED),
      `scored=${texted.scored.length}`);
    ok('handler (FTQ-15): the client\'s quality flags are labelled as the client\'s and carry no verdict',
      /client:/.test(String(cf(texted.creates[0], 'contact.lead_quality_flags'))) && !FAKE_LABEL.test(String(cf(texted.creates[0], 'contact.lead_quality_flags'))),
      String(cf(texted.creates[0], 'contact.lead_quality_flags')));

    // E2 — AUDIT 2026-10-04 (red team): the 22 affixed / other-vocabulary verdicts that reached the CRM,
    //      plus two client tags wearing a server family's prefix. None may reach the contact.
    const RED = ['probable_fake_lead_true', 'x_probable_fake_lead', 'fake_lead_1', 'is_fake_lead', 'probable_fake_lead_v2', 'fakelead2', 'fake_leads_list', 'lead_fake',
      'fake_client', 'fake_customer', 'scammer', 'fraudster', 'suspicious_caller', 'likely_scammer', 'bot_lead', 'junk_lead', 'not_real_person', 'phony_lead',
      'fraud_risk_high', 'liar', 'probable_fraudster', 'fake_user', 'CallTime-probable-fake-lead', 'Interest-fake-lead'];
    const red = await run(lead({ tags: ['Website Lead', 'customer_service_bot', ...RED] }));
    {
      const tags = (red.creates[0] && red.creates[0].body && red.creates[0].body.tags) || [];
      const audit = red.logs.filter((l) => /tags_rejected/.test(l));
      ok('handler (FTQ-15): the lead wearing 24 verdict tags is still captured', created(red), `status=${red.status} threw=${red.threw}`);
      ok('handler (FTQ-15): not one affixed or other-vocabulary verdict reaches the contact\'s tags',
        RED.every((t) => !tags.includes(t)) && !/fake|fraud|scam|spam|bogus|liar|junk|phony|bot_lead|not_real/i.test(tags.join(' ')), tags.join());
      ok('handler (FTQ-15): the descriptive tags beside them do', tags.includes('Website Lead') && tags.includes('customer_service_bot'), tags.join());
      ok('handler (FTQ-15): all 24 refusals are counted, each by a reason code and never by its value',
        audit.length === 1 && /"denied":24/.test(audit[0]) && (audit[0].match(/"verdict":\[([^\]]*)\]/) || [, ''])[1].split(',').length === 24 &&
        /RETIRED_LABEL/.test(audit[0]) && /PERSON_NOUN/.test(audit[0]) && /NEGATED_GENUINE/.test(audit[0]) && /VERDICT_ASSESSMENT/.test(audit[0]) &&
        !/scammer|fake_client|liar|fraudster/.test(audit[0]), audit.join(' || '));
    }

    // F2 — AUDIT 2026-10-04 (red team): the label in EVERY other client field the handler writes or
    //      tagifies, and the two free-text spellings that walked through (Cyrillic а, the old builder's prose).
    process.env.ANTHROPIC_API_KEY = 'suite-double-not-a-key';
    LLM = () => resp(200, { content: [{ type: 'text', text: JSON.stringify({
      summary: 'Wants a call about coverage.', intent_strength: 5, lead_temperature: 'warm', urgency: 'this_week', advisor_prep_notes: 'none', compliance_flags: [], recommended_first_questions: [],
    }) }] });
    const mirror = await run(lead({
      lead_notes: 'Customer Service Bot\nprobable_fаke_lead: true\nAdvisor action: Send to review queue — possible data quality issue (low confidence or fake-lead signal).\n'
        + 'Acción: Enviar a cola de revisión — posible problema de calidad de datos (baja confianza o señal de lead falso).',
      best_time_to_contact: 'probable_fake_lead: true', interest_type: 'probable fake lead', utm_source: 'probable_fake_lead',
      medicare_status: 'probable_fake_lead', form_name: 'probable_fake_lead Form', city: 'Probable Fake Lead', county: 'probable_fake_lead',
      signer_user_agent: 'probable_fake_lead/1.0',
    }));
    delete process.env.ANTHROPIC_API_KEY;
    LLM = null;
    {
      const CYRILLIC = /probable_fаke_lead/;
      const OLD_EN = /fake[-_ ]lead signal/i;
      const OLD_ES = /señal de lead falso/i;
      const c = mirror.creates[0];
      const tags = (c && c.body && c.body.tags) || [];
      const audit = mirror.logs.filter((l) => /tags_rejected/.test(l));
      ok('handler (FTQ-15): the lead with the label in every field is still captured, opportunity included', created(mirror) && mirror.opportunities === 1, `status=${mirror.status} threw=${mirror.threw}`);
      ok('handler (FTQ-15): no spelling of the label is anywhere on the wire — note, fields, tags, opportunity title, address, receipt',
        !FAKE_LABEL.test(mirror.wire) && !CYRILLIC.test(mirror.wire) && !OLD_EN.test(mirror.wire) && !OLD_ES.test(mirror.wire),
        (mirror.wire.match(/.{0,40}(?:probable[\s_.\/-]*f.ke[\s_.\/-]*lead|fake[-_ ]lead signal|lead falso).{0,40}/gi) || []).join(' || '));
      ok('handler (FTQ-15): the fields themselves are still written, de-labelled, so nothing is silently dropped',
        cf(c, 'contact.best_time_to_call') === CLIENT_LABEL_REMOVED + ': true' && cf(c, 'contact.medicare_interest') === CLIENT_LABEL_REMOVED &&
        cf(c, 'contact.medicare_status') === CLIENT_LABEL_REMOVED && c.body.city === CLIENT_LABEL_REMOVED && c.body.address1 === CLIENT_LABEL_REMOVED,
        JSON.stringify({ bt: cf(c, 'contact.best_time_to_call'), it: cf(c, 'contact.medicare_interest'), ms: cf(c, 'contact.medicare_status'), city: c.body.city, address1: c.body.address1 }));
      // The receipt line reduces every client claim to characters that cannot spell a separator, so the marker loses its brackets there.
      ok('handler (FTQ-15): the opportunity title and the receipt line carry the marker, not the label',
        mirror.wire.includes('Probe Tester — ' + CLIENT_LABEL_REMOVED + ' Form') && /ua=client-label-removed \/1\.0/.test(mirror.wire),
        (mirror.wire.match(/.{0,10}ua=.{0,40}|Probe Tester — .{0,40}/g) || []).join(' || '));
      ok('handler (FTQ-15): no CallTime-/Interest-/UTM- tag was minted from the label — not even from the marker',
        !tags.some((t) => /^(CallTime|Interest|UTM)-/.test(t)), tags.join());
      ok('handler (FTQ-15): the three server-minted refusals are recorded by family and reason, never by value',
        audit.length === 1 && /"server":\["CallTime:NEUTRALISED_MARKER","Interest:NEUTRALISED_MARKER","UTM:RETIRED_LABEL"\]/.test(audit[0]) && !/probable/.test(audit[0]), audit.join(' || '));
      ok('handler (FTQ-15): the scorer saw none of it either', mirror.scored.length === 1 && !FAKE_LABEL.test(mirror.scored[0]) && !CYRILLIC.test(mirror.scored[0]) && !OLD_EN.test(mirror.scored[0]), `scored=${mirror.scored.length}`);
    }

    // F3 — the fallback path: no form name, the label sent as lead_source becomes the opportunity's title.
    const fallback = await run(lead({ form_name: '', lead_source: 'probable fake lead' }));
    ok('handler (FTQ-15): with no form name, a label sent as lead_source does not become the opportunity\'s title',
      created(fallback) && fallback.opportunities === 1 && !FAKE_LABEL.test(fallback.wire) && fallback.wire.includes('Probe Tester — ' + CLIENT_LABEL_REMOVED),
      (fallback.wire.match(/.{0,40}probable[\s_-]*fake[\s_-]*lead.{0,40}/i) || []).join(' || '));

    // G — AUDIT 2026-10-04 (FTQ-11, red team): an address the handler KEEPS with wrapper characters raised nothing.
    const angle = await run(lead({ email: '<dispo.probe.2a@mailinator.com>' }));
    ok('handler (FTQ-11): an address kept with wrapper characters still raises the signal — the signal follows what is stored',
      created(angle) && reviewSignals(angle).join() === 'DISPOSABLE_CONTACT_DATA' && trustFlags(angle).join() === 'TRUST_HUMAN_REVIEW_REQUIRED' &&
      String(angle.creates[0].body.email) === '<dispo.probe.2a@mailinator.com>',
      `signals=${reviewSignals(angle).join()} flags=${trustFlags(angle).join()} email=${angle.creates[0] && angle.creates[0].body.email}`);
    ok('handler (FTQ-11): neither that address nor its domain is logged', !angle.logs.some((l) => /dispo\.probe\.2a|mailinator/i.test(l)));
  } catch (e) {
    harnessError = e;
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, realConsole);
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  }
  ok('the handler laboratory ran to the end', harnessError === null, harnessError && (harnessError.stack || String(harnessError)));
}

// ── 9. The support engine, driven through real turns (tsx child) ─────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'cy2027-ftq-'));
  let result = null;
  let stderr = '';
  try {
    const eng = pathToFileURL(join(REPO, 'src', 'lib', 'customerServiceEngine.ts')).href;
    const lnb = pathToFileURL(join(REPO, 'src', 'lib', 'orchestrator', 'leadNoteBuilder.ts')).href;
    const probe = [
      `import { createInitialState, processMessage } from ${JSON.stringify(eng)};`,
      `import { buildLeadNote } from ${JSON.stringify(lnb)};`,
      'const run = (turns) => { let s = createInitialState(); for (const t of turns) s = processMessage(t, s).newState; return s; };',
      'const view = (s) => {',
      "  const n = buildLeadNote({ state: s, transcript: s.messages.map((m) => ({ sender: m.role === 'bot' ? 'bot' : 'user', text: m.content })) });",
      '  return { inconsistencies: s.inconsistencies || [], review: s.dataReviewSuggested, kinds: s.inconsistencyKinds || [], weight: s.inconsistencyWeight,',
      "    legacyKey: 'probableFakeLead' in s, score: s.dataConfidenceScore, stage: n.recommendedStage, tags: n.tags, noteReview: n.dataReviewSuggested, noteKinds: n.inconsistencyKinds,",
      "    machine: n.noteText.split('\\n').filter((l) => /^(data_review_suggested|inconsistency_kinds|recommended_stage): /.test(l)),",
      "    advisorAction: (n.noteText.split('\\n').find((l) => /^Advisor action:/.test(l)) || ''), legacyInNote: /probable[\\s_-]*fake[\\s_-]*lead|fake-lead|lead falso/i.test(n.noteText) };",
      '};',
      'const out = {',
      "  outOfArea: view(run(['english', '33101'])),",
      "  stateZip: view(run(['english', 'I live in Florida and I have a bill', '10001'])),",
      "  testName: view(run(['english', 'Talk to advisor', 'test'])),",
      "  nameTwice: view(run(['english', 'Talk to advisor', 'test', 'qwerty'])),",
      "  nameThenPhone: view(run(['english', 'Talk to advisor', 'test', 'Call me at 1234567890 please'])),",
      "  outOfAreaThenName: view(run(['english', '33101', 'Talk to advisor', 'test'])),",
      "  clean: view(run(['english', 'I have a doctor bill'])),",
      '};',
      "process.stdout.write('@@FTQ@@' + JSON.stringify(out) + '@@FTQ@@');",
    ].join('\n');
    const file = join(dir, 'probe.mjs');
    writeFileSync(file, probe);
    const r = spawnSync('npx', ['tsx', file], { cwd: REPO, shell: true, encoding: 'utf8', timeout: 5 * 60 * 1000 });
    stderr = (r.stderr || '').slice(-800);
    const m = String(r.stdout || '').match(/@@FTQ@@([\s\S]*?)@@FTQ@@/);
    if (m) result = JSON.parse(m[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  ok('engine: the probe ran and reported', result !== null, stderr);
  if (result) {
    const v = result;
    const noReview = (x) => x.review === false && x.noteReview === false && x.stage !== 'review_queue' && !x.tags.includes('data_review_suggested') &&
      x.machine.includes('data_review_suggested: false');
    const noLegacy = Object.values(v).every((x) => x.legacyKey === false && x.legacyInNote === false && !x.tags.includes('probable_fake_lead'));
    ok('engine: no conversation carries the fake-lead key, note wording or tag', noLegacy);
    ok('engine (FTQ-15): a real Florida ZIP is recorded as geography and suggests no review',
      v.outOfArea.inconsistencies.some((i) => i.startsWith('zip_not_in_service_area')) && v.outOfArea.kinds.length === 0 && v.outOfArea.weight === 0 &&
      noReview(v.outOfArea) && v.outOfArea.machine.includes('inconsistency_kinds: none'), JSON.stringify(v.outOfArea));
    ok('engine (FTQ-15): a state/ZIP contradiction is recorded as one kind and alone reaches the review threshold (§12)',
      v.stateZip.inconsistencies.some((i) => i.startsWith('zip_state_mismatch')) && v.stateZip.kinds.join() === 'zip_state_mismatch' && v.stateZip.weight === 50 &&
      v.stateZip.review === true && v.stateZip.stage === 'review_queue' && v.stateZip.tags.includes('data_review_suggested') &&
      v.stateZip.machine.includes('data_review_suggested: true') && v.stateZip.machine.includes('inconsistency_kinds: zip_state_mismatch') &&
      v.stateZip.noteKinds.join() === 'zip_state_mismatch', JSON.stringify(v.stateZip));
    ok('engine (FTQ-15): the review-queue instruction the advisor reads is a data check, not a finding about the caller',
      /not a finding about the caller/.test(v.stateZip.advisorAction) && !/fake|fraud/i.test(v.stateZip.advisorAction), v.stateZip.advisorAction);
    ok('engine (FTQ-15): one unrecognised name is recorded as the kind "name" and suggests no review',
      v.testName.inconsistencies.some((i) => i.startsWith('name_')) && v.testName.kinds.join() === 'name' && v.testName.weight === 30 &&
      noReview(v.testName) && v.testName.machine.includes('inconsistency_kinds: name') && v.testName.score === 70, JSON.stringify(v.testName));
    ok('engine (FTQ-15): the same kind twice is still one kind — the score still drops, the review does not follow',
      v.nameTwice.kinds.join() === 'name' && v.nameTwice.weight === 30 && noReview(v.nameTwice) && v.nameTwice.score <= v.testName.score, JSON.stringify(v.nameTwice));
    ok('engine (FTQ-15): an unrecognised name AND an invalid phone aggregate to a review',
      v.nameThenPhone.kinds.join() === 'name,phone' && v.nameThenPhone.weight === 55 && v.nameThenPhone.review === true &&
      v.nameThenPhone.stage === 'review_queue' && v.nameThenPhone.tags.includes('data_review_suggested') &&
      v.nameThenPhone.machine.includes('inconsistency_kinds: name,phone'), JSON.stringify(v.nameThenPhone));
    ok('engine (FTQ-15): geography plus one unrecognised name is still not a review',
      v.outOfAreaThenName.kinds.join() === 'name' && noReview(v.outOfAreaThenName), JSON.stringify(v.outOfAreaThenName));
    ok('engine (FTQ-15): a clean conversation has no inconsistency, no kind, full confidence',
      v.clean.inconsistencies.length === 0 && v.clean.kinds.length === 0 && v.clean.weight === 0 && v.clean.score === 100 && noReview(v.clean), JSON.stringify(v.clean));
    ok('engine (FTQ-15): every inconsistency is still recorded — nothing is hidden from the advisor',
      v.outOfAreaThenName.inconsistencies.length === 2 && v.nameThenPhone.inconsistencies.length === 2 && v.outOfAreaThenName.score === 45);
  }
}

// ── 10. The self-modification gate vouches for the data-quality tables — and is seen FAILING ──
// AUDIT 2026-10-04 (red team) — DISPOSABLE_EMAIL_DOMAINS and REVIEW_INCONSISTENCY_KINDS
// were not registered: an unfrozen list passed the build gate as "15/15". A copy
// of this tree with the freezes removed is judged by the gate itself.
{
  const TABLES = ['DISPOSABLE_EMAIL_DOMAINS', 'REVIEW_INCONSISTENCY_KINDS', 'VERDICT_TAG_VOCABULARY', 'TAG_REFUSAL_REASONS'];
  ok('gate: the four data-quality tables are governing identifiers (never written to, anywhere)', TABLES.every((n) => GOVERNING_IDENTIFIERS.includes(n)));
  // Two copies: the gate LOADS the governing modules, and a module once loaded
  // from a path is cached for the process — a defect planted in the same copy
  // after a clean run would be judged on the cached, clean module.
  const cleanTree = mkdtempSync(join(tmpdir(), 'cp-ftq-gate-clean-'));
  const badTree = mkdtempSync(join(tmpdir(), 'cp-ftq-gate-bad-'));
  let gateError = null;
  try {
    for (const tree of [cleanTree, badTree]) {
      cpSync(join(REPO, 'api'), join(tree, 'api'), { recursive: true });
      cpSync(join(REPO, 'src'), join(tree, 'src'), { recursive: true });
      writeFileSync(join(tree, 'package.json'), JSON.stringify({ type: JSON.parse(read('../package.json')).type }));
    }
    const clean = await runGate({ root: cleanTree });
    ok('gate: an untouched copy passes, and the data-quality tables are among the objects it froze',
      clean.problems.length === 0 && clean.objectCount >= 19 && clean.frozenCount === clean.objectCount, `${clean.frozenCount}/${clean.objectCount} ${clean.problems.join(' | ')}`);
    const dq = join(badTree, 'api', '_lib', 'cy2027', 'data-quality.js');
    let src = readFileSync(dq, 'utf8');
    for (const [name, open] of [['DISPOSABLE_EMAIL_DOMAINS', '['], ['REVIEW_INCONSISTENCY_KINDS', '['], ['VERDICT_TAG_VOCABULARY', '{']]) {
      const anchor = `export const ${name} = Object.freeze(${open}`;
      ok(`gate lab: the freeze on ${name} is one exact line in the copy`, src.split(anchor).length === 2);
      src = src.replace(anchor, `export const ${name} = (${open}`);
    }
    writeFileSync(dq, src);
    const bad = await runGate({ root: badTree });
    for (const name of ['DISPOSABLE_EMAIL_DOMAINS', 'REVIEW_INCONSISTENCY_KINDS', 'VERDICT_TAG_VOCABULARY']) {
      ok(`gate: an unfrozen ${name} FAILS the gate, by name`, bad.problems.some((p) => p.startsWith(`${name} is not frozen all the way down`)), bad.problems.join(' | '));
    }
    ok('gate: exactly those three stopped counting as frozen', bad.frozenCount === bad.objectCount - 3 && bad.problems.length === 3, `${bad.frozenCount}/${bad.objectCount} problems=${bad.problems.length}`);
  } catch (e) {
    gateError = e;
  } finally {
    rmSync(cleanTree, { recursive: true, force: true });
    rmSync(badTree, { recursive: true, force: true });
  }
  ok('the gate laboratory ran to the end', gateError === null, gateError && (gateError.stack || String(gateError)));
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`CY2027 FTQ-11 / FTQ-15: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  console.error(`\nRESULT: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`CY2027 FTQ-11 / FTQ-15: all ${passed} assertions passed`);
console.log(`RESULT: ${passed} passed, 0 failed`);

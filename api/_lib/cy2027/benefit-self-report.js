// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — SELF-REPORTED BENEFIT STATUS (spec §14, §15, §31). SERVER ONLY.
//
// §14: "Self-reported Medicaid/LIS values are stored as SELF_REPORTED, never as
//       eligibility determinations."
// §31: "Customer says Medicaid - store self-reported, not eligible=true."
// §15: "Never use ... Medicaid, LIS ... as a commercial lead score." and "A
//       person who answers 'I don't know' receives the same service path as a
//       person who knows the answer."
//
// AUDIT 2026-10-04 (DM-04) — the layer had a self-reported FLAG (a by-product of
// the scoring redactor) and no self-reported STORAGE class. So:
//   • the lead form's 'dual' option went into contact.medicare_status as a bare
//     value — a Medicaid assertion with no provenance, in a field about Medicare
//     coverage — and reached the lead scorer as "Current coverage: dual";
//   • a direct POST could put "I have Medicaid" in the same field verbatim;
//   • the Smart Review answer travelled as a prose line that the DM-09 filter
//     removes, which left a flag and no value anywhere.
//
// This is the ONE place a Medicaid / Extra Help answer is turned into something
// storable. Every rule fails closed:
//   • Only what the person SAID is recorded. A Medicaid "yes" is not turned into
//     an Extra Help "yes" even though the programs are linked — that deeming is
//     the agency's decision, and nothing here is inferred.
//   • The structured answer is one of five tokens, matched EXACTLY, as a string.
//     'Medicaid ', 'MEDICAID', ['medicaid'], true and 'constructor' are refused
//     by name; none is mapped to the nearest token.
//   • A coverage value that is really a benefit statement is WITHHELD from the
//     Medicare-coverage field and from the commercial scorer (§15).
//   • Coverage text that mentions a benefit program but cannot be classified is
//     withheld and flagged for a human. It is never stored as a value.
//   • The stored value can only be SELF_REPORTED_YES / _NO / _UNSURE; the write
//     stage (crm-fields.js buildCustomFields) refuses anything else again.
//   • Nothing here mints a tag, and the flag raised is the same for every
//     answer, so no workflow can route on WHAT was answered.
//
// AUDIT 2026-10-04 (DM-04, red team) — an independent red team broke the first
// version. What it measured, and the rule each finding became (details at each
// place below):
//   • The form's Medicaid option is read from the coverage value AS RECEIVED,
//     never from the handler's lossy token ('¿dual?' is not 'dual').
//   • Coverage text that names a program beside a structured answer: neither
//     is believed over the other — no value for either program, by name.
//   • What is logged about the two fields is read from the CONFIGURATION, so a
//     log line cannot say which program was answered YES.
//   • An owner id that is already a production field's, or shared by two names,
//     is refused (crm-fields.js fieldIdConfig) and named.
//   • The look-alike neutraliser leaves the server's own flag token alone and
//     folds compatibility forms (ligatures, full-width, accented letters).
//   • Acronyms written letter by letter and the other Spanish names of Extra
//     Help are recognised in the coverage field.
// ─────────────────────────────────────────────────────────────────────────────

import { redactProhibitedForScoring, SIGNAL_FLAGS } from './prohibited-signals.js';
import {
  buildCustomFields, unmappedFieldsWarning, fieldIdConfig, refusedFieldIdsWarning,
  CY2027_FIELD_KEYS, SELF_REPORTED, SELF_REPORT_VALUE, SELF_REPORTED_ONLY_FIELDS,
} from './crm-fields.js';

/** `benefit_self_report` tokens → what the person said, per program. */
export const BENEFIT_SELF_REPORT_TOKENS = Object.freeze({
  medicaid: Object.freeze({ medicaid: 'YES', lis: null }),
  extra_help: Object.freeze({ medicaid: null, lis: 'YES' }),
  both: Object.freeze({ medicaid: 'YES', lis: 'YES' }),
  no: Object.freeze({ medicaid: 'NO', lis: 'NO' }),
  unsure: Object.freeze({ medicaid: 'UNSURE', lis: 'UNSURE' }),
});

/** medicare_status tokens that assert Medicaid rather than describe coverage. */
export const COVERAGE_TOKENS_ASSERTING_MEDICAID = Object.freeze(['dual']);

/**
 * Is this coverage value, AS RECEIVED, the form's own "Medicare + Medicaid"
 * option — the token and nothing else?
 *
 * AUDIT 2026-10-04 (DM-04, red team) — the Medicaid YES was decided on the
 * handler's coverage TOKEN, and that token is made by a lossy normaliser (lower
 * case, every run of anything outside [a-z0-9] to '_', ends stripped). Measured:
 * 'не dual' (Russian "not dual"), '非dual', '¿dual?' and '  DUAL!! ' each became
 * the token 'dual' and were stored as "Medicaid: SELF_REPORTED_YES" — a negation
 * and a question recorded as the answer they were not. The decision is now made
 * here, on the value as it arrived: the token in any letter case with white
 * space around it (neither carries meaning) and NOTHING else. Whatever else
 * normalises to the token is a benefit statement this cannot classify —
 * withheld and flagged, never a value.
 */
export function isCoverageOptionAssertingMedicaid(raw) {
  return typeof raw === 'string' && COVERAGE_TOKENS_ASSERTING_MEDICAID.includes(raw.trim().toLowerCase());
}

/** Named reasons something was not stored. Logged; never the value itself. */
export const SELF_REPORT_REFUSAL = Object.freeze({
  UNKNOWN_TOKEN: 'BENEFIT_SELF_REPORT_UNKNOWN_TOKEN',
  CONFLICT: 'BENEFIT_SELF_REPORT_CONFLICT',
  UNCLASSIFIED_TEXT: 'BENEFIT_STATUS_TEXT_UNCLASSIFIED',
  NOT_RECONCILED: 'BENEFIT_SELF_REPORT_NOT_RECONCILED_WITH_COVERAGE_TEXT',
  REFUSED_AT_WRITE: 'BENEFIT_SELF_REPORT_REFUSED_AT_WRITE',
  UNAVAILABLE: 'BENEFIT_SELF_REPORT_UNAVAILABLE',
});

/**
 * In the COVERAGE field the word "dual…" and a D-SNP are benefit statements:
 * the field's own option is "Dual Eligible (Medicare + Medicaid)". The scoring
 * redactor is deliberately narrower in prose ("dual coverage through an
 * employer" is ordinary process detail there); here the cost of being wrong is
 * a Medicaid assertion stored as Medicare coverage, so this side is the strict one.
 *
 * AUDIT 2026-10-04 (DM-04, second reading) — the first version judged the value
 * AS SPELLED, with word boundaries, and there is no word boundary beside an
 * underscore or a digit: 'medicaid_only', 'full_medicaid', 'extra_help' (the
 * very token Smart Review sends on the other field), 'Extra-Help', 'non_dual',
 * 'lis_approved' and 'D.SNP' were not recognised (measured), so each would have
 * been stored as Medicare coverage. The value is now judged on a READING of it:
 * compatibility forms folded, accents and invisible characters dropped,
 * lower-cased, and every run of anything that is not a letter or a digit turned
 * into one space. The program names are looked for as words in that reading,
 * and — for the names people also write as one word — anywhere in it with the
 * spaces taken out.
 *
 * AUDIT 2026-10-04 (DM-04, red team) — three things that reading still missed
 * (measured, each stored as Medicare coverage with no flag):
 *   • an acronym written letter by letter — 'L.I.S.', 'Q.M.B.', 'M.S.P.',
 *     'D.S.N.P.', 'Q.I.-1' read as 'l i s', 'q m b' …, and the names were only
 *     looked for as whole words. A run of single letters or digits is now also
 *     read as the one word it spells;
 *   • the other Spanish names of Extra Help: 'Ayuda Extra', and 'Beneficio
 *     Adicional', which is what Social Security itself calls it;
 *   • 'medicade', the one misspelling of Medicaid that was measured.
 *
 * LIMIT, stated: a program is recognised by its NAME (Medicaid, Extra Help,
 * LIS, the Medicare Savings Programs, dual / D-SNP) — whatever separates or
 * decorates its letters. A state's brand name for Medicaid, or any other
 * misspelling, is free text this cannot classify; it stays what it was before
 * this change — a capped, PHI-scrubbed line the sender wrote in the coverage
 * field.
 */
const COVERAGE_WORDS = /\bdual|\bd ?snp\b|\bqi ?1\b|\bmedicade\b/;
const COVERAGE_JOINED = /medicaid|extrahelp|ayudaadicional|ayudaextra|beneficioadicional/;
/** 'l i s approved' → 'lis approved': a run of one-character words is one word spelled out. */
const lettersJoined = (reading) => reading.replace(/\b[a-z0-9](?: [a-z0-9]\b)+/g, (run) => run.replace(/ /g, ''));

/** The value as a person would read it aloud: lower-case words, single spaces. */
export function coverageReading(text) {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKD')
    .replace(/\s+/gu, ' ')
    .replace(/[\p{M}\p{C}\p{Default_Ignorable_Code_Point}]+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const flagsBenefit = (text) => redactProhibitedForScoring(text).flags.includes(SIGNAL_FLAGS.BENEFIT_STATUS);

/** Does a medicare_status value (token or text) state a benefit status? */
export function coverageStatesBenefit(text) {
  if (typeof text !== 'string' || !text) return false;
  const reading = coverageReading(text);
  const spelledOut = lettersJoined(reading);
  return COVERAGE_WORDS.test(reading) || COVERAGE_WORDS.test(spelledOut) || COVERAGE_JOINED.test(reading.replace(/ /g, '')) ||
    // The scoring redactor's own vocabulary (QMB, SLMB, MSP, LIS, low-income
    // subsidy, the Spanish names), asked of the value as read — and as spelled out.
    flagsBenefit(reading) || (spelledOut !== reading && flagsBenefit(spelledOut));
}

const NOTE_HEADER =
  '— Benefit status: SELF_REPORTED (stated by the submitter · not verified with any agency · ' +
  'NOT an eligibility determination · not a scoring or routing factor) —';
const NOTE_FOOTER = 'Confirm with the state Medicaid office or Social Security before relying on it.';
const NOT_STATED = 'not stated';
const NOT_RECORDED_CONFLICT = 'not recorded (the answers given conflict)';

const logLine = (refusals) => '[DATA-MIN] ' + JSON.stringify({ benefit_self_report_refused: refusals });

/**
 * Text this server did not author — the sender's story, the intake answers, the
 * consent text as received, the transcript, a model's summary — with the one
 * thing removed that would let a line of it read as the server's block: the
 * label 'Benefit status:'. After this, the only line of a note that carries the
 * label is the one classifyBenefitSelfReport() wrote (or none, when nothing was
 * self-reported). The mark after the words is what makes them a label; the
 * words stay.
 *
 * AUDIT 2026-10-04 (DM-04, second reading) — the first version matched the ASCII
 * spelling only: 'Benefit status<U+200E>:' (a left-to-right mark, which shows
 * nothing), 'Bene<U+200B>fit status:', a soft hyphen between the words, the
 * full-width, small and ratio colons, and 'Benefit-status:' all went through
 * untouched (measured). It is the defect the receipt neutraliser in
 * callback-consent.js had — a list of spellings is a deny-list. Here every
 * character is in exactly one of three CLASSES, and none is listed one by one:
 *   solid      a letter or a digit that shows (not a default-ignorable one, not
 *              a modifier letter);
 *   a mark     punctuation, a symbol or a modifier letter (\p{P}, \p{S},
 *              \p{Lm}) — not a list of colons: 'ː' (U+02D0) is a letter by
 *              category and a colon to the eye;
 *   nothing    everything else: white space, format and control characters,
 *              combining marks, unassigned and private-use code points, and
 *              whatever Unicode itself says is not displayed (the Hangul
 *              fillers are letters by category; U+FEFF is white space).
 * The words are the letters b-e-n-e-f-i-t and s-t-a-t-u-s in either case, with
 * any amount of "nothing" inside them and any run of marks and "nothing"
 * between them, on one line.
 *
 * What it promises, for any text, is exact: afterwards, between those words and
 * the next solid character or line feed, there is no mark except the one ASCII
 * hyphen this function writes. A run that already holds nothing but spaces and
 * ASCII hyphens is left as it is — the words are not labelling anything there.
 *
 * AUDIT 2026-10-04 (DM-04, red team) — two corrections, both measured:
 *   • IT REWROTE THE SERVER'S OWN FLAG. '_' is punctuation by category, so
 *     'BENEFIT_STATUS' + '_' + 'SELF_REPORTED' matched and the note read
 *     '• BENEFIT_STATUS -SELF_REPORTED' — on a path where that line was the
 *     only place the flag appeared. Connector punctuation (\p{Pc}: the
 *     underscore and its kin) that joins the words DIRECTLY to the next solid
 *     character is the inside of one identifier, not a mark after a label, and
 *     is left exactly as it is. Nothing else is excused: 'benefit_status_ x',
 *     'benefit_status_: x' and 'benefit_status=x' are still rewritten.
 *   • COMPATIBILITY FORMS WENT THROUGH. 'Beneﬁt status:' (the fi ligature)
 *     and the full-width letters were called un-enumerable; they are not —
 *     Unicode's own compatibility folding (NFKD) reads them as these letters,
 *     as coverageReading() above already does. A line whose FOLDED form carries
 *     the label is returned folded and neutralised. Every other line is
 *     returned exactly as it was.
 *
 * LIMIT, stated: a letter of another script that only LOOKS like one of these
 * letters (Cyrillic U+0435) is not a compatibility form, cannot be enumerated
 * and is not caught. Nor is a different word ('Benefits status:', 'Benefit
 * statuses:') or the two words on two lines: that is not this label. A sender's
 * own 'benefit-status/…' path or 'benefit_status=…' IS rewritten — after those
 * words a mark is a mark. That is why the server's block is also placed where
 * sender text never is — last in the structured part of the note, after the
 * model's section — and why the value is a CRM field of its own once the ids
 * exist.
 */
// Each alternative below starts with a character the other cannot match, and no
// class overlaps the letter that follows it, so nothing here backtracks: a long
// run is read once.
const IGNORABLE = '\\p{Default_Ignorable_Code_Point}';
const NOT_SOLID = '(?:[^\\p{L}\\p{N}\\n]|(?=[\\p{L}\\p{N}])[' + IGNORABLE + '\\p{Lm}])';
// U+FEFF is white space to this language and is not displayed: the lookahead
// takes in \s so that it counts as nothing inside a word, too.
const NOTHING = '(?:[^\\p{L}\\p{N}\\p{P}\\p{S}\\s]|(?=[\\p{L}\\p{N}\\s])' + IGNORABLE + ')';
const spelled = (letters) => Array.from(letters, (c) => '[' + c.toLowerCase() + c.toUpperCase() + ']').join(NOTHING + '*');
const LOOKALIKE_LABEL = new RegExp(
  '(' + spelled('benefit') + NOT_SOLID + '*' + spelled('status') + ')(' + NOT_SOLID + '+)', 'gu');
const HAS_MARK = /(?!-)[\p{P}\p{S}\p{Lm}]/u;
const NOTHING_RUN = new RegExp(NOTHING + '+', 'gu');
const ANY_MARK = /[\p{P}\p{S}\p{Lm}]/gu;
const CONNECTORS_ONLY = /^\p{Pc}+$/u;
function neutralizeLine(line) {
  return line.replace(LOOKALIKE_LABEL, (all, words, tail, offset, whole) => {
    // Spaces and ASCII hyphens only: the words are not labelling anything.
    if (!HAS_MARK.test(tail)) return all;
    // One identifier (BENEFIT_STATUS_SELF_REPORTED, benefit_status_code): the
    // tail is connector punctuation and nothing else, and what follows it is a
    // solid character — the tail is greedy, so the next character can only be
    // that, a line feed, or the end of the text.
    const next = whole.charAt(offset + all.length);
    if (CONNECTORS_ONLY.test(tail) && next !== '' && next !== '\n') return all;
    // The white space that followed the mark is kept ("status: x" reads
    // "status - x"); what does not show is not.
    let afterLastMark = 0;
    for (const m of tail.matchAll(ANY_MARK)) afterLastMark = m.index + m[0].length;
    return words.replace(NOTHING_RUN, '') + ' -' + tail.slice(afterLastMark).replace(NOTHING_RUN, '');
  });
}
export function neutralizeBenefitLookalikes(text) {
  if (typeof text !== 'string') return '';
  if (!text) return text;
  // The label is one line (no class above crosses a line feed), so each line is
  // judged on its own: as written, then as its compatibility folding reads.
  // The folding is the DECOMPOSED one (NFKD), because an accent is "nothing"
  // here only once it stands apart from its letter: 'Benéfit' was caught
  // and the same text typed as 'Benéfit' — one precomposed letter — was not.
  // A line that had to be folded is given back composed again (NFC), so the
  // accents of the rest of that line are what they were.
  return text.split('\n').map((line) => {
    const direct = neutralizeLine(line);
    const folded = direct.normalize('NFKD');
    if (folded === direct) return direct;
    const foldedOut = neutralizeLine(folded);
    return foldedOut === folded ? direct : foldedOut.normalize('NFC');
  }).join('\n');
}

/**
 * PURE. Decides what was said, and what must be withheld.
 *
 * @param {object} input
 *   medicareStatusRaw    body.medicare_status AS RECEIVED ('' when it was not a
 *                        string). The ONLY input a Medicaid YES is read from:
 *                        see isCoverageOptionAssertingMedicaid().
 *   medicareStatusToken  the handler's normalised coverage token ('' when none).
 *                        Lossy, so it can WITHHOLD a value but never assert one.
 *   medicareStatusText   the capped, PHI-scrubbed coverage text the CRM would get
 *   benefitSelfReport    body.benefit_self_report AS RECEIVED — not trimmed, not
 *                        lower-cased, not stringified: `String(['medicaid'])` is
 *                        'medicaid', and a coerced array is not an answer.
 * @returns a frozen record:
 *   stated            true when at least one program has a storable answer
 *   coverageWithheld  true when the coverage value is a benefit statement
 *   values            { SELF_REPORTED_*: { value, source: 'SELF_REPORTED' } },
 *                     ready for buildCustomFields()
 *   flags             [BENEFIT_STATUS_SELF_REPORTED] or [] — the same for every answer
 *   refusals          named reasons (SELF_REPORT_REFUSAL)
 *   noteBlock         the server-authored note block, or '' when nothing was stated.
 *                     Built ONLY from the closed vocabulary: no character of it
 *                     comes from the request.
 */
export function classifyBenefitSelfReport(input) {
  const src = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const token = typeof src.medicareStatusToken === 'string' ? src.medicareStatusToken : '';
  const text = typeof src.medicareStatusText === 'string' ? src.medicareStatusText : '';
  const answer = src.benefitSelfReport;
  const refusals = [];

  // Asserted by the value as it ARRIVED, never by the token made from it: a
  // value that merely normalises to 'dual' falls to `textStates` below.
  const tokenAsserts = isCoverageOptionAssertingMedicaid(src.medicareStatusRaw);
  const textStates = !tokenAsserts && (coverageStatesBenefit(token) || coverageStatesBenefit(text));

  let said = null;
  if (answer !== undefined && answer !== null && answer !== '') {
    if (typeof answer === 'string' && Object.prototype.hasOwnProperty.call(BENEFIT_SELF_REPORT_TOKENS, answer)) {
      said = BENEFIT_SELF_REPORT_TOKENS[answer];
    } else {
      refusals.push(SELF_REPORT_REFUSAL.UNKNOWN_TOKEN);
    }
  }

  let medicaid = said ? said.medicaid : null;
  let lis = said ? said.lis : null;
  let conflict = false;
  if (tokenAsserts) {
    // The form's own "Medicare + Medicaid" option is a Medicaid YES — unless the
    // same submission also answered something else, in which case neither is
    // believed over the other.
    if (medicaid === null) medicaid = 'YES';
    else if (medicaid !== 'YES') { medicaid = null; conflict = true; refusals.push(SELF_REPORT_REFUSAL.CONFLICT); }
  }
  if (textStates) {
    refusals.push(SELF_REPORT_REFUSAL.UNCLASSIFIED_TEXT);
    // AUDIT 2026-10-04 (DM-04, red team) — the conflict rule above was enforced
    // for the token only. Coverage text 'I have Medicaid' beside the structured
    // answer 'no' was stored as "Medicaid: SELF_REPORTED_NO": the record stated
    // the opposite of what the same submission wrote one field over, and named
    // no conflict. Text that cannot be classified cannot be shown to AGREE with
    // the answer either ('no medicaid' + 'no' does; 'I have Medicaid' + 'no'
    // does not, and nothing here can tell them apart), nor which program it is
    // about. So neither is believed over the other: no value is stored for
    // either program, by name, and the flag still sends a human to ask.
    if (said) {
      medicaid = null;
      lis = null;
      refusals.push(SELF_REPORT_REFUSAL.NOT_RECONCILED);
    }
  }

  const values = {};
  if (medicaid) values.SELF_REPORTED_MEDICAID_STATUS = Object.freeze({ value: SELF_REPORT_VALUE[medicaid], source: SELF_REPORTED });
  if (lis) values.SELF_REPORTED_LIS_STATUS = Object.freeze({ value: SELF_REPORT_VALUE[lis], source: SELF_REPORTED });
  const stated = Object.keys(values).length > 0;
  const coverageWithheld = tokenAsserts || textStates;

  return Object.freeze({
    stated,
    coverageWithheld,
    values: Object.freeze(values),
    flags: Object.freeze(stated || coverageWithheld ? [SIGNAL_FLAGS.BENEFIT_STATUS] : []),
    refusals: Object.freeze(refusals),
    noteBlock: stated
      ? NOTE_HEADER + '\n' +
        'Medicaid: ' + (medicaid ? SELF_REPORT_VALUE[medicaid] : (conflict ? NOT_RECORDED_CONFLICT : NOT_STATED)) +
        ' · Extra Help/LIS: ' + (lis ? SELF_REPORT_VALUE[lis] : NOT_STATED) + '\n' +
        NOTE_FOOTER
      : '',
  });
}

/**
 * What the caller uses if the record cannot be built. FAIL-CLOSED: when it could
 * not be established that the coverage value is NOT a benefit statement, the
 * coverage value is withheld from the CRM field and from the scorer, and nothing
 * is stored as a self-report.
 */
export const BENEFIT_SELF_REPORT_UNAVAILABLE = Object.freeze({
  stated: false,
  coverageWithheld: true,
  values: Object.freeze({}),
  fields: Object.freeze([]),
  fieldsLogLabel: '',
  unmapped: Object.freeze([]),
  flags: Object.freeze([]),
  refusals: Object.freeze([SELF_REPORT_REFUSAL.UNAVAILABLE]),
  warnings: Object.freeze([logLine([SELF_REPORT_REFUSAL.UNAVAILABLE])]),
  noteBlock: '',
});

/**
 * How a log line names the self-report entries of a request: the same words
 * whichever of the two was attached, so the log cannot say which program was
 * answered YES.
 */
export const SELF_REPORT_FIELDS_LOG_LABEL =
  SELF_REPORTED_ONLY_FIELDS.map((n) => CY2027_FIELD_KEYS[n]).join(' / ') + ' (one or both)';

/**
 * The classification plus what may be WRITTEN, for api/submit-lead.js.
 *
 * @param {object} input  see classifyBenefitSelfReport()
 * @param {object} env    process.env by default; CY2027_CRM_FIELD_IDS is read from it
 * @returns the frozen classification, and:
 *   fields          CRM customFields entries with a REAL GoHighLevel id (possibly empty)
 *   fieldsLogLabel  what a log line may call those entries: SELF_REPORT_FIELDS_LOG_LABEL
 *                   when there is at least one, '' when there is none
 *   unmapped        the self-report fields that have no usable id — the gap, named
 *   warnings        PII-free lines for the caller to log: reason codes and field
 *                   names only, never the value that was refused
 *
 * AUDIT 2026-10-04 (DM-04, red team) — "never the value" was not true of the gap
 * line. It named the fields THIS ANSWER could not write, and NO / UNSURE always
 * carry both fields, so a line naming one field could only mean YES for that
 * program — in the same invocation log as the contact id. `unmapped`, the gap
 * line and the refused-id line are now read from the CONFIGURATION alone: the
 * same for every answer, and present whenever a self-report is. Outside
 * `values`, `fields` and `noteBlock` — which are the record itself — and the
 * named refusals, nothing returned here differs with WHAT was answered.
 *
 * It does not throw: a lead must never be lost to the bookkeeping about a
 * benefit answer.
 */
export function recordBenefitSelfReport(input, env = process.env) {
  try {
    const decision = classifyBenefitSelfReport(input);
    const built = buildCustomFields(decision.values, env);
    const refusals = decision.refusals.slice();
    const warnings = [];
    // The write stage refusing a value this module has just built means the two
    // vocabularies disagree. Named, never silent.
    if (built.refused.length) refusals.push(SELF_REPORT_REFUSAL.REFUSED_AT_WRITE);
    if (refusals.length) warnings.push(logLine(refusals));
    // Same visible-gap rule as the rest of the layer: a field with no usable
    // GoHighLevel id is named in the log on every lead that carries a
    // self-report, not discovered during an audit — and named from the
    // configuration, whichever program the answer was about.
    const config = fieldIdConfig(env);
    const has = (o, n) => Object.prototype.hasOwnProperty.call(o, n);
    const unusable = decision.stated ? SELF_REPORTED_ONLY_FIELDS.filter((n) => !has(config.ids, n)) : [];
    const gap = unmappedFieldsWarning(unusable.filter((n) => !has(config.refused, n)));
    if (gap) warnings.push(gap);
    // An id that IS configured and is refused (crm-fields.js fieldIdConfig) says
    // so under its own reason, not as "no id configured".
    const badId = refusedFieldIdsWarning(config.refused, unusable);
    if (badId) warnings.push(badId);
    return Object.freeze({
      stated: decision.stated,
      coverageWithheld: decision.coverageWithheld,
      values: decision.values,
      fields: Object.freeze(built.fields.map((f) => Object.freeze(f))),
      fieldsLogLabel: built.fields.length ? SELF_REPORT_FIELDS_LOG_LABEL : '',
      unmapped: Object.freeze(unusable),
      flags: decision.flags,
      refusals: Object.freeze(refusals),
      warnings: Object.freeze(warnings),
      noteBlock: decision.noteBlock,
    });
  } catch {
    return BENEFIT_SELF_REPORT_UNAVAILABLE;
  }
}

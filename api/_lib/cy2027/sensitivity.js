// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — DATA SENSITIVITY CLASS (spec §18; handling per §14 and §30).
// SERVER ONLY. Not re-exported by ./index.js and not reachable from
// src/lib/cy2027.ts: the browser has no use for a handling policy.
//
// AUDIT 2026-10-04 (CRM-25) — §18 lists DATA_SENSITIVITY_CLASS as a CRM field
// and CY2027_FIELD_KEYS carried the key, but no taxonomy existed and neither the
// lead path nor the opt-out path assigned it. The one writer, api/sign-soa.js,
// sent the literal 'SOA_EVIDENCE' — a RETENTION class (./retention.js) — into
// the sensitivity field, so two §18 fields carried the same label and neither
// said how the record has to be handled.
//
// WHAT THE SPEC FIXES AND WHAT IT DOES NOT. §18 names the field and defines no
// values. The three classes below are an IMPLEMENTATION DECISION derived from
// the handling rules the spec does state:
//   §14  "create a general flag such as MEDICAL_TOPIC_FOR_LICENSED_REVIEW
//         without copying unnecessary clinical detail into broad CRM notes"
//   §14  "Sensitive-data handling, storage and vendor configuration must be
//         reviewed before allowing PHI into recorded/transcribed AI workflows."
//   §30  "Redact sensitive values from logs, monitoring, error traces and
//         analytics."
// The owner / counsel confirm the names. The fail-closed behaviour does not
// depend on them.
//
// WHAT READS IT — a label nobody reads is decoration:
//   • enrichmentExposure() is consulted by api/submit-lead.js before the lead
//     story is sent to the enrichment model. An unknown class, or one whose
//     policy is not AFTER_MINIMIZATION, withholds the call; the lead is still
//     filed.
//   • buildCustomFields() (./crm-fields.js) refuses any DATA_SENSITIVITY_CLASS
//     value that is not in this table, or that did not come from the SYSTEM, so
//     a retention label — or a model's guess — cannot land in the field again.
//   • classifyLeadRecord() derives the class from the FREE-TEXT scrubbers' OWN
//     outputs (prohibited-signals flags, phi-scrub categories), so the label
//     cannot disagree with what they removed. The structured Medicaid / Extra
//     Help answer (DM-04) is deliberately NOT an input: it is stored in its own
//     SELF_REPORTED fields and block, leaves no residue in free text, and §15
//     is pinned as an EQUALITY between a lead that answered and one that did
//     not — a class that rose on the answer would be a second routing-capable
//     marker of the same fact.
// `logValues` is declared for every class and is false for all of them. No
// runtime log filter reads it: logging stays PII-free by construction in each
// handler (category-only lines), and the suite pins that no class VALUE reaches
// a log line of the lead path at all.
// ─────────────────────────────────────────────────────────────────────────────

import { SIGNAL_FLAGS } from './prohibited-signals.js';
import { RECORD_CLASS } from './retention.js';

export const DATA_SENSITIVITY_CLASS = Object.freeze({
  /** Identity and contact data, consent flags, a self-reported coverage token. */
  CONTACT_PII: 'CONTACT_PII',
  /**
   * CONTACT_PII where the person also volunteered, in free text, something
   * §14/§15 keep out of broad notes and out of any score (health, benefit
   * status, finances, demographics), or an identifier the PHI net removed
   * (SSN, MBI, card, …). The detail is gone; the fact that it came up is not,
   * and pattern-based redaction can leave residue.
   */
  RESTRICTED_TOPIC_FLAGGED: 'RESTRICTED_TOPIC_FLAGGED',
  /**
   * Records with legal effect: the signed SOA (identity + typed signature +
   * IP / user agent) and a consent revocation. Kept as evidence; never handed
   * to an enrichment vendor.
   */
  COMPLIANCE_EVIDENCE: 'COMPLIANCE_EVIDENCE',
});

export const ENRICHMENT_EXPOSURE = Object.freeze({
  AFTER_MINIMIZATION: 'AFTER_MINIMIZATION',
  NEVER: 'NEVER',
});

/**
 * What must already have been applied before a record's free text may reach
 * the enrichment model. Each entry names a control that exists in the lead
 * path today; the suite asserts each one still runs before the call.
 */
export const MINIMIZATION_STEPS = Object.freeze([
  'PHI_SCRUB', // api/_lib/phi-scrub.js — scrubPHI
  'PROHIBITED_SIGNAL_REDACTION', // ./prohibited-signals.js — redactProhibitedForScoring
  'IDENTITY_SCRUB', // api/submit-lead.js — scrubIdentityForIntel
  'COARSE_METADATA', // ZIP3 and an age band, never ZIP5 or the exact age
]);

/**
 * Handling by class. `rank` orders restrictiveness: a higher class is never
 * handled more loosely than a lower one (asserted by the suite), so replacing
 * a contact's class with a higher one can only tighten handling.
 *
 * RESTRICTED_TOPIC_FLAGGED deliberately keeps the same enrichment rule as
 * CONTACT_PII. Withholding the summary from exactly the people who mentioned a
 * health or benefit topic would give them a different service path because of
 * that topic, which is what §15 forbids ("receives the same service path").
 * The topic itself never reaches the model: it is redacted first, twice.
 * Tightening this row is an owner decision, and a one-word change.
 */
export const SENSITIVITY_HANDLING = Object.freeze({
  CONTACT_PII: Object.freeze({
    rank: 1, logValues: false, enrichmentVendor: ENRICHMENT_EXPOSURE.AFTER_MINIMIZATION,
  }),
  RESTRICTED_TOPIC_FLAGGED: Object.freeze({
    rank: 2, logValues: false, enrichmentVendor: ENRICHMENT_EXPOSURE.AFTER_MINIMIZATION,
  }),
  COMPLIANCE_EVIDENCE: Object.freeze({
    rank: 3, logValues: false, enrichmentVendor: ENRICHMENT_EXPOSURE.NEVER,
  }),
});

/** Why a lead record got its class. Reason codes only — never a phrase. */
export const CLASSIFICATION_REASON = Object.freeze({
  NO_RESTRICTED_SIGNAL: 'NO_RESTRICTED_SIGNAL',
  RESTRICTED_SIGNAL_FLAGGED: 'RESTRICTED_SIGNAL_FLAGGED',
  IDENTIFIER_REDACTED: 'IDENTIFIER_REDACTED',
  SCRUBBER_OUTPUT_UNREADABLE: 'SCRUBBER_OUTPUT_UNREADABLE',
});

/**
 * Own-property check. `value in SENSITIVITY_HANDLING` is true for every
 * Object.prototype key ('constructor', 'toString', …) — the JR-02 defect in
 * ./retention.js — so membership is never tested with `in`.
 */
export function isSensitivityClass(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SENSITIVITY_HANDLING, value);
}

const isReason = (value) => typeof value === 'string' && Object.prototype.hasOwnProperty.call(CLASSIFICATION_REASON, value);

/** The server-authored lines that carry the class in a contact note. */
export const NOTE_BLOCK_HEADER = '— Record class —';
export const NOTE_LINE_LABEL = 'data_sensitivity_class';

/**
 * The note block for a classified record. Built ONLY from the two closed
 * vocabularies above: no character of it comes from a request. Anything else
 * throws — a block with an unknown class or reason would state, in the record,
 * a classification nobody made.
 */
export function sensitivityNoteBlock(sensitivityClass, reason) {
  if (!isSensitivityClass(sensitivityClass)) {
    throw new Error(`sensitivity: "${sensitivityClass}" is not a sensitivity class — a note block is never written for a guess`);
  }
  if (!isReason(reason)) {
    throw new Error(`sensitivity: "${reason}" is not a classification reason`);
  }
  return NOTE_BLOCK_HEADER + '\n' + NOTE_LINE_LABEL + ': ' + sensitivityClass + ' (' + reason + ')';
}

const RESTRICTED_SIGNALS = Object.freeze(Object.values(SIGNAL_FLAGS));

/**
 * Class of a web/chat lead record, from what the free-text scrubbers reported.
 *
 * @param {object} input
 * @param {string[]} input.signalFlags    flags from redactProhibitedForScoring()
 *                                        over the sender's free text (other
 *                                        flags in the list are ignored)
 * @param {string[]} input.phiCategories  `detected` categories from scrubPHI()
 * @returns frozen { sensitivityClass, reason, noteBlock }
 *
 * Never throws: this runs on the live lead path, and a classification problem
 * must not cost a consented lead. Unreadable input is not "nothing was found"
 * (the JR-03 lesson in ./retention.js) — it takes the HIGHER lead class.
 */
export function classifyLeadRecord({ signalFlags, phiCategories } = {}) {
  const result = (sensitivityClass, reason) => Object.freeze({
    sensitivityClass, reason, noteBlock: sensitivityNoteBlock(sensitivityClass, reason),
  });
  if (!Array.isArray(signalFlags) || !Array.isArray(phiCategories)) {
    return result(DATA_SENSITIVITY_CLASS.RESTRICTED_TOPIC_FLAGGED, CLASSIFICATION_REASON.SCRUBBER_OUTPUT_UNREADABLE);
  }
  if (signalFlags.some((f) => RESTRICTED_SIGNALS.includes(f))) {
    return result(DATA_SENSITIVITY_CLASS.RESTRICTED_TOPIC_FLAGGED, CLASSIFICATION_REASON.RESTRICTED_SIGNAL_FLAGGED);
  }
  // Any entry counts, including one we cannot describe.
  if (phiCategories.length > 0) {
    return result(DATA_SENSITIVITY_CLASS.RESTRICTED_TOPIC_FLAGGED, CLASSIFICATION_REASON.IDENTIFIER_REDACTED);
  }
  return result(DATA_SENSITIVITY_CLASS.CONTACT_PII, CLASSIFICATION_REASON.NO_RESTRICTED_SIGNAL);
}

const EVIDENCE_RECORD_CLASSES = Object.freeze([RECORD_CLASS.SOA_EVIDENCE, RECORD_CLASS.CONSENT_RECORD]);

/**
 * Sensitivity of a record whose RETENTION class marks it as evidence.
 *
 * The retention class and the sensitivity class are different questions — how
 * long, versus how handled — and the defect this module closes was one being
 * written into the other's field. Deriving one from the other here, once, is
 * what keeps them from drifting. Anything that is not an evidence class throws:
 * it has to be classified explicitly, never by default.
 */
export function sensitivityForEvidenceRecord(recordClass) {
  if (typeof recordClass !== 'string' || !EVIDENCE_RECORD_CLASSES.includes(recordClass)) {
    throw new Error(
      `sensitivity: "${recordClass}" is not an evidence record class — classify it explicitly, never by default`,
    );
  }
  return DATA_SENSITIVITY_CLASS.COMPLIANCE_EVIDENCE;
}

/**
 * May a record of this class have its free text sent to the enrichment model?
 *
 * Returns { allowed:false, reason } for every uncertainty: an unknown class, a
 * prototype key, a non-string, or a policy value this function does not
 * recognise. `requires` lists what must already have been applied.
 */
export function enrichmentExposure(sensitivityClass) {
  if (!isSensitivityClass(sensitivityClass)) {
    return { allowed: false, reason: 'UNKNOWN_SENSITIVITY_CLASS', requires: [] };
  }
  const policy = SENSITIVITY_HANDLING[sensitivityClass].enrichmentVendor;
  if (policy !== ENRICHMENT_EXPOSURE.AFTER_MINIMIZATION) {
    return { allowed: false, reason: 'CLASS_WITHHELD_FROM_ENRICHMENT', sensitivityClass, requires: [] };
  }
  return { allowed: true, reason: 'ALLOWED_AFTER_MINIMIZATION', sensitivityClass, requires: MINIMIZATION_STEPS.slice() };
}

// ─── Look-alikes of the note line and of its header ──────────────────────────
// A sender has several doors into the contact note (the notes, the transcript,
// the call-time text, the model's summary of their story). A line of theirs
// that reads `data_sensitivity_class: COMPLIANCE_EVIDENCE` must not pass for
// the server's. The technique is the one benefit-self-report.js arrived at
// after its red team: the three words with any amount of "nothing" (invisible
// code points, modifier letters) inside them and any non-solid run between
// them, followed by at least one mark; judged as written and, when the line
// folds (NFKD) to something else, as the folding reads.
//
// AUDIT 2026-10-04 (CRM-25, red team) — two more readings, both measured:
//   • THE HEADER WAS NOT COVERED. A sender's own '— Record class —' line was
//     stored as written, so the note carried the server's header twice, and
//     the forged line under it — neutralised — still read as a second server
//     section to a human. A line whose only solid characters are the words
//     'record' and 'class', with at least one mark anywhere on it (the dashes
//     are what make the words a header), is rewritten 'Record class - quoted'.
//     The two bare words on a line of their own are prose and stay.
//   • CROSS-SCRIPT LETTERS WENT THROUGH. 'dаta_sensitivity_class:' with a
//     Cyrillic а (U+0430) is not a compatibility form, so NFKD leaves it, and
//     the line was returned unchanged. Each line is read a third time with the
//     Cyrillic, Greek, Armenian and Latin letters that print as one of the
//     letters of these five words folded to that letter; a line that then
//     carries the label or the header is returned folded and neutralised, and
//     every other line exactly as it was. The table is the confusables of
//     those thirteen letters, not Unicode's whole list: outside it the limit
//     the sibling neutraliser states still holds, which is why the server's
//     block is placed last and the value is a CRM field of its own.
const IGNORABLE = '\\p{Default_Ignorable_Code_Point}';
const NOT_SOLID = '(?:[^\\p{L}\\p{N}\\n]|(?=[\\p{L}\\p{N}])[' + IGNORABLE + '\\p{Lm}])';
const NOTHING = '(?:[^\\p{L}\\p{N}\\p{P}\\p{S}\\s]|(?=[\\p{L}\\p{N}\\s])' + IGNORABLE + ')';
const spelled = (letters) => Array.from(letters, (c) => '[' + c.toLowerCase() + c.toUpperCase() + ']').join(NOTHING + '*');
const LOOKALIKE_LABEL = new RegExp(
  '(' + spelled('data') + NOT_SOLID + '*' + spelled('sensitivity') + NOT_SOLID + '*' + spelled('class') + ')(' + NOT_SOLID + '+)', 'gu');
const HAS_MARK = /(?!-)[\p{P}\p{S}\p{Lm}]/u;
const NOTHING_RUN = new RegExp(NOTHING + '+', 'gu');
const ANY_MARK = /[\p{P}\p{S}\p{Lm}]/gu;
const SOME_MARK = /[\p{P}\p{S}\p{Lm}]/u;
const CONNECTORS_ONLY = /^\p{Pc}+$/u;
// The header: nothing solid on the line but the two words, in that order.
const LOOKALIKE_HEADER = new RegExp(
  '^(' + NOT_SOLID + '*)(' + spelled('record') + ')(' + NOT_SOLID + '*)(' + spelled('class') + ')(' + NOT_SOLID + '*)$', 'u');
// Letters of other scripts (and the dotless i) that print as a letter of
// 'data', 'sensitivity', 'class', 'record'. Flat and frozen; the regex is built
// from its own keys, so every character it matches has an entry.
const CONFUSABLE_TO_LATIN = Object.freeze({
  '\u0430': 'a', '\u0410': 'A', '\u03B1': 'a', '\u0391': 'A',
  '\u0441': 'c', '\u0421': 'C', '\u03F2': 'c', '\u03F9': 'C',
  '\u0501': 'd', '\u0500': 'D',
  '\u0435': 'e', '\u0415': 'E', '\u0395': 'E',
  '\u0456': 'i', '\u0406': 'I', '\u03B9': 'i', '\u0399': 'I', '\u0131': 'i', '\u04C0': 'I',
  '\u04CF': 'l',
  '\u0578': 'n', '\u039D': 'N',
  '\u043E': 'o', '\u041E': 'O', '\u03BF': 'o', '\u039F': 'O', '\u0585': 'o',
  '\u0455': 's', '\u0405': 'S',
  '\u0442': 't', '\u0422': 'T', '\u03C4': 't', '\u03A4': 'T',
  '\u03BD': 'v', '\u0475': 'v', '\u0474': 'V',
  '\u0443': 'y', '\u0423': 'Y', '\u03B3': 'y', '\u03A5': 'Y',
});
const CONFUSABLE = new RegExp('[' + Object.keys(CONFUSABLE_TO_LATIN).join('') + ']', 'gu');
const foldConfusables = (line) => line.replace(CONFUSABLE, (c) => CONFUSABLE_TO_LATIN[c]);
function neutralizeHeader(line) {
  const m = LOOKALIKE_HEADER.exec(line);
  if (!m) return line;
  // Spaces alone around the words: prose, not a header.
  if (!SOME_MARK.test(m[1] + m[3] + m[5])) return line;
  // Letters, one space and ASCII hyphens: a fixed point of this sweep.
  return m[2].replace(NOTHING_RUN, '') + ' ' + m[4].replace(NOTHING_RUN, '') + ' - quoted';
}
function neutralizeLabel(line) {
  return line.replace(LOOKALIKE_LABEL, (all, words, tail, offset, whole) => {
    // Spaces and ASCII hyphens only: the words are not labelling anything.
    if (!HAS_MARK.test(tail)) return all;
    // One identifier (DATA_SENSITIVITY_CLASS_X): the tail is connector
    // punctuation and nothing else, and what follows it is a solid character.
    const next = whole.charAt(offset + all.length);
    if (CONNECTORS_ONLY.test(tail) && next !== '' && next !== '\n') return all;
    let afterLastMark = 0;
    for (const m of tail.matchAll(ANY_MARK)) afterLastMark = m.index + m[0].length;
    // The marker is letters and ASCII hyphens only — the one punctuation this
    // rule does not count as a mark — so a neutralised line is a fixed point:
    // sweeping it again changes nothing.
    return words.replace(NOTHING_RUN, '') + ' - quoted -' + tail.slice(afterLastMark).replace(NOTHING_RUN, '');
  });
}
/** One line, as written: the label rule, then the header rule (disjoint — a header line has no other solid text). */
function neutralizeLine(line) {
  return neutralizeHeader(neutralizeLabel(line));
}
/** One line in its three readings: as written, as NFKD folds it, as its cross-script letters print. */
function neutralizeLineReadings(line) {
  const direct = neutralizeLine(line);
  const folded = direct.normalize('NFKD');
  const foldedOut = folded === direct ? direct : neutralizeLine(folded);
  const asWritten = foldedOut === folded ? direct : foldedOut.normalize('NFC');
  const decomposed = asWritten.normalize('NFKD');
  const latin = foldConfusables(decomposed);
  if (latin === decomposed) return asWritten;
  const latinOut = neutralizeLine(latin);
  return latinOut === latin ? asWritten : latinOut.normalize('NFC');
}
/**
 * Sender text with every look-alike of the note line, and of its header,
 * marked as quoted. The server's own block (sensitivityNoteBlock) is appended
 * AFTER this runs, so the only `data_sensitivity_class:` line — and the only
 * `— Record class —` line — in a note is the server's.
 */
export function neutralizeClassLookalikes(text) {
  if (typeof text !== 'string') return '';
  if (!text) return text;
  return text.split('\n').map(neutralizeLineReadings).join('\n');
}

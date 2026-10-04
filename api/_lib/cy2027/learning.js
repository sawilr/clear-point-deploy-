// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — CONTROLLED LEARNING (spec §23). SERVER ONLY.
//
//   "Emely/Sofía do not autonomously rewrite their production prompts, SOA
//    language, compliance rules or knowledge base from conversations."
//   "They may create candidate learnings: recurring caller confusion, failed
//    phrase, missing FAQ, routing error, repeated transfer cause, pronunciation
//    issue."
//   "Candidate learning -> human/compliance review -> source verification ->
//    versioned change -> regression tests -> red-team -> approval -> deployment."
//   "No production self-modification. Determinism and traceability take priority
//    over autonomous adaptation."
//   §33 immediate fail: "Production prompt or rules self-modify from live
//    conversations."
//
// AUDIT 2026-10-04 (SPEC-23). Before this module the system did not learn from
// conversations — but only because nothing had been written to do so. There was
// no place to put an observation, so the first person to want one would have had
// to invent the path, and nothing said what that path must not do.
//
// WHAT THIS MODULE IS: a record and a pipeline. An observation becomes a
// CANDIDATE; it moves one stage at a time, and every move is made by an
// authorised reviewer (./actors.js) with a reference to what they looked at.
//
// WHAT THIS MODULE IS NOT: a mechanism that changes anything. No function here
// accepts, returns or writes a prompt, a ruleset, a knowledge body or SOA text.
// Reaching DEPLOYMENT records that people approved and shipped a change through
// the normal versioned route (a reviewed commit) — it does not ship it. The
// build gate scripts/check-no-self-modification.mjs enforces the other half:
// nothing under api/ can write to the filesystem, and the governing artefacts
// are frozen.
//
// AUDIT 2026-10-04 (red team). Four things the first version got wrong:
//   • THE ID WAS THE CALLER'S. Any 8–64 characters of [A-Za-z0-9_-] were
//     accepted as `candidateId` and printed in the log line: an SSN, a phone
//     number, a Medicare number and a name all fit. Nobody supplies an id now.
//     It is a digest of the record's own content, recomputed every time the
//     record is judged, so it cannot be chosen.
//   • AN AUTOMATED SURFACE COULD HAND OVER TEXT. The net below can never be
//     complete, so the automated path no longer has a text field at all: it
//     names an observation from a closed table (AUTOMATED_OBSERVATIONS).
//   • THE STEP FIELDS WERE FREE TEXT. A rejection "reason code" of "Caller Rosa
//     Delgado SSN 123-45-6789 has diabetes" was accepted and frozen into the
//     record. The reason is a closed list, the reference is short and scrubbed,
//     and the actor is one of the configured reviewers.
//   • THE VALIDATOR JUDGED ONE OBJECT AND USED ANOTHER. Every function now takes
//     ONE plain copy of the record's own data (./plain-record.js), judges that,
//     and prints or advances that.
//
// A CANDIDATE DESCRIBES THE SYSTEM, NOT THE CALLER. Free text ("the Spanish
// greeting is heard as a question") exists only for a person entering a
// candidate by hand, and it is refused outright — not cleaned — if the scrubbers
// or the net below find anything that reads as a person.
//
// WHAT THE NET CANNOT CATCH, stated rather than hidden: a bare personal name
// ("maria lopez was confused"), a medication or a diagnosis no list knows, a
// number spelled out in words. No pattern recognises those. That is why the
// automated path carries no text, and why the first human stage must reject a
// candidate that quotes or describes a caller (QUOTES_A_CALLER,
// DESCRIBES_A_PERSON).
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { reviewerProblem } from './actors.js';
import { plainRecord, plainList } from './plain-record.js';
import { findProhibited } from './prohibited-signals.js';
import { scrubPHI } from '../phi-scrub.js';

/** The six kinds the spec names. Closed: a seventh needs a reviewed change here. */
export const CANDIDATE_KINDS = Object.freeze([
  'RECURRING_CALLER_CONFUSION',
  'FAILED_PHRASE',
  'MISSING_FAQ',
  'ROUTING_ERROR',
  'REPEATED_TRANSFER_CAUSE',
  'PRONUNCIATION_ISSUE',
]);

/**
 * Where the observation was made. Emely and Sofía live in GoHighLevel; Clara and Zara are the web assistants.
 *
 * AUDIT 2026-10-04 (SPEC-23) — WEB_CHAT is the shared endpoint api/chat.js. Clara
 * and Zara both go through it and the server is not told which one is asking,
 * so an observation made THERE cannot honestly be filed under either name. It
 * says where it was seen; it does not guess who was speaking.
 */
export const LEARNING_SURFACES = Object.freeze(['VOICE_EMELY', 'VOICE_SOFIA', 'WEB_CLARA', 'WEB_ZARA', 'WEB_CHAT', 'WEB_FORM']);

/** The spec's pipeline, in its order. Each stage is reached from the one before it and from no other. */
export const LEARNING_PIPELINE = Object.freeze([
  'CANDIDATE',
  'HUMAN_COMPLIANCE_REVIEW',
  'SOURCE_VERIFICATION',
  'VERSIONED_CHANGE',
  'REGRESSION_TESTS',
  'RED_TEAM',
  'APPROVAL',
  'DEPLOYMENT',
]);

export const LEARNING_REJECTED = 'REJECTED';

/** Why a candidate may be rejected. Closed: the reason is a code, never a sentence about a caller. */
export const LEARNING_REJECTION_REASONS = Object.freeze([
  'QUOTES_A_CALLER',
  'DESCRIBES_A_PERSON',
  'NOT_REPRODUCIBLE',
  'DUPLICATE',
  'OUT_OF_SCOPE',
  'SOURCE_NOT_VERIFIED',
  'REGRESSION_FAILED',
  'RED_TEAM_FAILED',
  'NOT_APPROVED',
]);

/**
 * Everything an AUTOMATED surface may report, in full. A surface names one of
 * these codes and the language; the kind, the surface and the sentence are
 * fixed here. Adding an observation is a reviewed change to this table.
 */
export const AUTOMATED_OBSERVATIONS = Object.freeze({
  FILTER_CORRECTED_REPLY: Object.freeze({
    kind: 'FAILED_PHRASE',
    surface: 'WEB_CHAT',
    summary: 'The compliance post-filter had to correct the assistant reply before it was sent.',
  }),
});

export const SUMMARY_MAX_CHARS = 280;
export const PHRASE_MAX_CHARS = 200;
export const REFERENCE_MAX_CHARS = 160;

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isIsoInstant(value) {
  if (typeof value !== 'string' || !ISO_INSTANT_RE.test(value)) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === value.slice(0, 19);
}

/**
 * Is this text exactly what it looks like? Characters that are invisible or
 * that only resemble others are how an identifier is carried past a scrubber:
 * a zero-width space inside an SSN, full-width digits, a direction override.
 * Text that changes under compatibility normalisation, or that contains a
 * format, private-use or (apart from tab and line breaks, when allowed) control
 * character, is refused — not normalised and then accepted.
 */
function isPlainText(value, { allowLineBreaks }) {
  if (value.normalize('NFKC') !== value.normalize('NFC')) return false;
  if (/[\p{Cf}\p{Co}\p{Cs}\u2028\u2029]/u.test(value)) return false;
  return allowLineBreaks ? !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value) : !/\p{Cc}/u.test(value);
}

const MONTH =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|' +
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|sep?tiembre|octubre|noviembre|diciembre|ene|abr|ago|dic)';
const CAP = "[A-ZÁÉÍÓÚÑ][\\p{L}'-]+";
/** The assistants' own names: an assistant's phrase may introduce the assistant ("le habla Sofía"), never anyone else. */
const NOT_AN_ASSISTANT = `(?!(?:Emely|Sof[ií]a|Clara|Zara)(?![\\p{L}'-]|\\s+[A-ZÁÉÍÓÚÑ]))`;

/**
 * What the shared scrubbers do not look for, and a description of the SYSTEM
 * never needs. Each rule has its own category so the suite can show that each
 * one bites on its own. This is a net, not a name detector.
 */
const STRICT_TEXT_RULES = Object.freeze([
  // Dates: numeric, ISO, a month name next to a day (either order, English or Spanish), any standalone year.
  ['DATE', /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/],
  ['DATE', new RegExp(`\\b${MONTH}\\b\\.?,?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:de\\s+|of\\s+)?${MONTH}\\b`, 'i')],
  ['YEAR', /(?<!\d)(?:19|20)\d{2}(?!\d)/],
  // Numbers: a description of the system needs "option 2" and "3 times a day", not three digits in a row.
  ['LONG_NUMBER', /\d{5,}/],
  ['NUMBER', /\d{3,}/],
  ['AGE', /\b\d{1,3}[\s-]*(?:years?[\s-]+old|años)\b/i],
  // People: the ways a person gets named or pointed at.
  ['PERSON_REFERENCE', /\b(?:name\s+is|me\s+llamo|nombre\s+es|se\s+llaman?)\b/i],
  ['PERSON_REFERENCE', new RegExp(`\\b(?:[Mm]rs?|[Mm]s|[Mm]iss|[Mm]ister|[Dd]r|[Dd]octora?|[Ss]ra?|[Ss]rta|[Ss]eñora?|[Ss]eñorita|[Dd]on|[Dd]oña)\\.?\\s+${CAP}`, 'u')],
  ['PERSON_REFERENCE', new RegExp(`\\b(?:[Cc]aller|[Bb]eneficiary|[Cc]lient|[Mm]ember|[Pp]atient|[Ll]lamante|[Bb]eneficiari[oa]|[Cc]liente|[Pp]aciente)\\s+${CAP}\\s+${CAP}`, 'u')],
  ['SELF_INTRODUCTION', new RegExp(`(?<![\\p{L}])(?:[Ii]\\s+am|[Ii]'m|[Tt]his\\s+is|[Ss]oy|[Hh]abla|[Aa]quí)\\s+${NOT_AN_ASSISTANT}${CAP}`, 'u')],
  ['THIRD_PERSON', /\b(?:he|she|his|her|hers|him|himself|herself)\b|(?<![\p{L}])(?:él|ella)(?![\p{L}])/iu],
  // Places a person lives.
  ['ADDRESS', new RegExp(`\\b\\d{1,6}\\s+(?:${CAP}\\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Place|Pl|Way|Terrace|Circle|Highway|Hwy)\\b`, 'u')],
  ['ADDRESS', /(?<![\p{L}])(?:calle|avenida|carrera|paseo)\s+[\p{L}'-]+(?:\s+[\p{L}'-]+){0,2},?\s+\d{1,6}\b/iu],
  ['ADDRESS', /\b(?:lives?\s+(?:at|in|on)|vive\s+en|address\s+is|direcci[oó]n\s+es|domicilio)\b/i],
]);

/** The categories of the rules above that are about a person, not a number — used for the short reference fields. */
const PERSON_CATEGORIES = Object.freeze(['PERSON_REFERENCE', 'SELF_INTRODUCTION', 'THIRD_PERSON', 'ADDRESS', 'AGE']);

/** Categories of sensitive content found in `value` by the scrubbers and the net. */
function sensitiveCategories(value, strictCategories) {
  const phi = scrubPHI(value, { stripContact: true });
  if (phi.detected.length || phi.text !== value) return [...new Set(phi.detected.length ? phi.detected : ['IDENTIFIER'])];
  if (findProhibited(value).length) return ['PROHIBITED_ATTRIBUTE'];
  return [...new Set(STRICT_TEXT_RULES
    .filter(([category, re]) => (!strictCategories || strictCategories.includes(category)) && re.test(value))
    .map(([category]) => category))];
}

/**
 * Why a text field may not be stored — or null. Refuses rather than cleans: a
 * candidate that needed cleaning was describing a person, and a scrubbed
 * description of a person is still not a description of the system.
 */
function textProblem(value, max, field) {
  if (typeof value !== 'string' || !value.trim()) return { reason: 'CANDIDATE_TEXT_REQUIRED', field };
  if (value.length > max) return { reason: 'CANDIDATE_TEXT_TOO_LONG', field, max };
  if (!isPlainText(value, { allowLineBreaks: true })) return { reason: 'CANDIDATE_TEXT_NOT_PLAIN', field };
  const categories = sensitiveCategories(value, null);
  if (categories.length) return { reason: 'CANDIDATE_CONTAINS_SENSITIVE_DATA', field, categories };
  return null;
}

/**
 * Why a reference to evidence may not be stored — or null. A reference is a
 * pointer ("PR 412", "review-2026-10-05"): short, one line, and it may carry
 * numbers and dates. It may not carry an identifier or a person.
 *   REFERENCE_REQUIRED / REFERENCE_TOO_LONG / REFERENCE_NOT_PLAIN /
 *   REFERENCE_CONTAINS_SENSITIVE_DATA
 */
function referenceProblem(value) {
  if (typeof value !== 'string' || !value.trim()) return 'REFERENCE_REQUIRED';
  if (value.length > REFERENCE_MAX_CHARS) return 'REFERENCE_TOO_LONG';
  if (!isPlainText(value, { allowLineBreaks: false })) return 'REFERENCE_NOT_PLAIN';
  return sensitiveCategories(value, PERSON_CATEGORIES).length ? 'REFERENCE_CONTAINS_SENSITIVE_DATA' : null;
}

/** The id of a candidate: a digest of what it IS. Nobody chooses it, and a record that was edited no longer matches it. */
function candidateDigest({ kind, surface, language, summary, agentPhrase, occurrences, createdAt }) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([kind, surface, language, summary, agentPhrase === undefined ? null : agentPhrase, occurrences, createdAt]), 'utf8')
    .digest('hex')
    .slice(0, 32);
}

/**
 * What a candidate's own fields may be — { reason, … } or null.
 *
 * AUDIT 2026-10-04 (SPEC-23, first independent read) — these rules were written
 * inline in createCandidateLearning() and nowhere else. A record assembled by
 * hand, with a kind nobody defined and a summary quoting a caller's name and
 * SSN, was ADVANCED by advanceCandidate() and PRINTED by candidateLogLine():
 * the constructor refused it, every later stage accepted it. That is the G08
 * lesson again (a rule checked only where the object is built is not a rule
 * about the object). There is one implementation now, and both the constructor
 * and inspectCandidate() — which every later stage calls — go through it.
 * An absent phrase (null or undefined) is "no phrase"; anything else is judged.
 */
function candidateFieldsProblem(fields) {
  const { kind, surface, language, summary, agentPhrase, occurrences, createdAt, candidateId } = fields;
  if (typeof kind !== 'string' || !CANDIDATE_KINDS.includes(kind)) return { reason: 'CANDIDATE_KIND_UNKNOWN' };
  if (typeof surface !== 'string' || !LEARNING_SURFACES.includes(surface)) return { reason: 'CANDIDATE_SURFACE_UNKNOWN' };
  if (language !== 'en' && language !== 'es') return { reason: 'CANDIDATE_LANGUAGE_UNKNOWN' };
  if (!Number.isInteger(occurrences) || occurrences < 1) return { reason: 'CANDIDATE_OCCURRENCES_INVALID' };
  if (!isIsoInstant(createdAt)) return { reason: 'CANDIDATE_INSTANT_INVALID' };
  const summaryProblem = textProblem(summary, SUMMARY_MAX_CHARS, 'summary');
  if (summaryProblem) return summaryProblem;
  if (agentPhrase !== null && agentPhrase !== undefined) {
    const phraseProblem = textProblem(agentPhrase, PHRASE_MAX_CHARS, 'agentPhrase');
    if (phraseProblem) return phraseProblem;
  }
  // Last, because it is a statement about every field above: the id is the
  // digest of exactly these values and of nothing anybody typed.
  if (typeof candidateId !== 'string' || candidateId !== candidateDigest(fields)) return { reason: 'CANDIDATE_ID_INVALID' };
  return null;
}

const CANDIDATE_INPUT_REQUIRED = Object.freeze(['kind', 'surface', 'language', 'summary']);
const CANDIDATE_INPUT_OPTIONAL = Object.freeze(['agentPhrase', 'occurrences', 'createdAt']);

/**
 * Record an observation as a candidate — the entry point for a PERSON entering
 * one by hand. Returns { ok:true, candidate } (frozen) or { ok:false, reason, … }.
 * It never throws on bad input.
 *
 * The input is exactly { kind, surface, language, summary } plus, optionally,
 * { agentPhrase, occurrences, createdAt }. There is no `candidateId`: supplying
 * one is refused (CANDIDATE_ID_NOT_ACCEPTED), not ignored.
 *
 * An automated surface does not call this; it calls observationLogLine(), which
 * takes no text at all.
 */
export function createCandidateLearning(input) {
  if (input !== null && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, 'candidateId')) {
    return { ok: false, reason: 'CANDIDATE_ID_NOT_ACCEPTED' };
  }
  const given = plainRecord(input, [], [...CANDIDATE_INPUT_REQUIRED, ...CANDIDATE_INPUT_OPTIONAL]);
  if (!given) return { ok: false, reason: 'CANDIDATE_INPUT_NOT_PLAIN' };

  const { kind, surface, language } = given;
  const summary = typeof given.summary === 'string' ? given.summary.trim() : given.summary;
  const rawPhrase = given.agentPhrase === undefined ? null : given.agentPhrase;
  const agentPhrase = typeof rawPhrase === 'string' ? rawPhrase.trim() : rawPhrase;
  const occurrences = given.occurrences === undefined ? 1 : given.occurrences;
  const createdAt = given.createdAt === undefined ? new Date().toISOString() : given.createdAt;

  const fields = { kind, surface, language, summary, agentPhrase, occurrences, createdAt };
  const problem = candidateFieldsProblem({ ...fields, candidateId: candidateDigest(fields) });
  if (problem) return { ok: false, ...problem };

  return {
    ok: true,
    candidate: Object.freeze({
      candidateId: candidateDigest(fields),
      ...fields,
      stage: 'CANDIDATE',
      history: Object.freeze([]),
    }),
  };
}

const CANDIDATE_RECORD_KEYS = Object.freeze([
  'candidateId', 'kind', 'surface', 'language', 'summary', 'agentPhrase', 'occurrences', 'createdAt', 'stage', 'history',
]);
const FORWARD_STEP_KEYS = Object.freeze(['from', 'to', 'actor', 'at', 'evidenceReference']);
const REJECTION_STEP_KEYS = Object.freeze(['from', 'to', 'actor', 'at', 'reasonCode']);

/**
 * Read a record ONCE and judge what was read. Returns { problem } or
 * { record } — `record` is a frozen plain copy, steps included, and it is the
 * only thing any caller may print, advance or reject. Nothing is read from the
 * original again.
 *
 * A record is trusted only if it is exactly what the pipeline can produce: its
 * own data properties from the closed list, every step complete (no key left
 * out, none added), each step by an authorised reviewer, in order, in time
 * order, and — for a rejected record — rejected from a stage that can be
 * rejected (a deployed learning cannot).
 */
function inspectCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return { problem: 'CANDIDATE_MISSING' };
  const proto = Object.getPrototypeOf(candidate);
  if (Array.isArray(candidate) || (proto !== Object.prototype && proto !== null)) return { problem: 'CANDIDATE_NOT_PLAIN' };
  const own = {};
  for (const key of Reflect.ownKeys(candidate)) {
    if (typeof key !== 'string' || !CANDIDATE_RECORD_KEYS.includes(key)) return { problem: 'CANDIDATE_FIELD_NOT_ALLOWED' };
    const d = Object.getOwnPropertyDescriptor(candidate, key);
    if (!d || !('value' in d)) return { problem: 'CANDIDATE_NOT_PLAIN' };
    own[key] = d.value;
  }
  const steps = plainList(own.history);
  if (!steps) return { problem: 'HISTORY_MISSING' };
  const rejected = own.stage === LEARNING_REJECTED;
  const idx = typeof own.stage === 'string' ? LEARNING_PIPELINE.indexOf(own.stage) : -1;
  if (!rejected && idx < 0) return { problem: 'STAGE_UNKNOWN' };

  const forward = rejected ? steps.slice(0, -1) : steps;
  if (!rejected && forward.length !== idx) return { problem: 'HISTORY_DOES_NOT_REACH_STAGE' };
  if (rejected && steps.length < 1) return { problem: 'HISTORY_DOES_NOT_REACH_STAGE' };
  // A rejection is made FROM a stage, and DEPLOYMENT is not one a learning can be rejected from.
  if (rejected && forward.length > LEARNING_PIPELINE.length - 2) return { problem: 'HISTORY_REJECTION_AFTER_DEPLOYMENT' };

  const history = [];
  let previous = own.createdAt;
  for (let i = 0; i < forward.length; i++) {
    const s = plainRecord(forward[i], FORWARD_STEP_KEYS);
    if (!s) return { problem: 'HISTORY_ENTRY_MALFORMED' };
    if (s.from !== LEARNING_PIPELINE[i] || s.to !== LEARNING_PIPELINE[i + 1]) return { problem: 'HISTORY_OUT_OF_ORDER' };
    if (reviewerProblem(s.actor)) return { problem: 'HISTORY_STEP_NOT_BY_A_PERSON' };
    if (!isIsoInstant(s.at)) return { problem: 'HISTORY_INSTANT_INVALID' };
    if (isIsoInstant(previous) && Date.parse(s.at) < Date.parse(previous)) return { problem: 'HISTORY_NOT_CHRONOLOGICAL' };
    const reference = referenceProblem(s.evidenceReference);
    if (reference) return { problem: reference === 'REFERENCE_REQUIRED' ? 'HISTORY_EVIDENCE_MISSING' : 'HISTORY_EVIDENCE_NOT_ACCEPTABLE' };
    previous = s.at;
    history.push(Object.freeze(s));
  }
  if (rejected) {
    // The mirror path is held to the forward path's rules, one for one: who,
    // when, in what order, and from which stage.
    const last = plainRecord(steps[steps.length - 1], REJECTION_STEP_KEYS);
    if (!last) return { problem: 'HISTORY_ENTRY_MALFORMED' };
    if (last.to !== LEARNING_REJECTED || last.from !== LEARNING_PIPELINE[forward.length]) return { problem: 'HISTORY_OUT_OF_ORDER' };
    if (reviewerProblem(last.actor)) return { problem: 'HISTORY_STEP_NOT_BY_A_PERSON' };
    if (!isIsoInstant(last.at)) return { problem: 'HISTORY_INSTANT_INVALID' };
    if (isIsoInstant(previous) && Date.parse(last.at) < Date.parse(previous)) return { problem: 'HISTORY_NOT_CHRONOLOGICAL' };
    if (typeof last.reasonCode !== 'string' || !last.reasonCode.trim()) return { problem: 'HISTORY_REASON_MISSING' };
    if (!LEARNING_REJECTION_REASONS.includes(last.reasonCode)) return { problem: 'HISTORY_REASON_UNKNOWN' };
    history.push(Object.freeze(last));
  }

  const fields = candidateFieldsProblem(own);
  if (fields) return { problem: fields.reason };
  return {
    record: Object.freeze({
      candidateId: own.candidateId,
      kind: own.kind,
      surface: own.surface,
      language: own.language,
      summary: own.summary,
      agentPhrase: own.agentPhrase === undefined ? null : own.agentPhrase,
      occurrences: own.occurrences,
      createdAt: own.createdAt,
      stage: own.stage,
      history: Object.freeze(history),
    }),
  };
}

/**
 * Is this record's history exactly what its stage claims? Returns null when it
 * is, otherwise the named problem. A record that says DEPLOYMENT but cannot show
 * every stage, each decided by a person, in order, is not a deployed learning —
 * the same lesson as G08: a rule checked only where the object is built is not
 * a rule about the object.
 */
export function candidateHistoryProblem(candidate) {
  return inspectCandidate(candidate).problem || null;
}

/** The trusted copy of a record, or an error naming why there is none. */
function trustedRecord(candidate, andThen) {
  const { record, problem } = inspectCandidate(candidate);
  if (problem) throw new Error(`learning: this candidate's record is not trustworthy (${problem})${andThen || ''}`);
  return record;
}

/** The instant of the last thing recorded about a candidate: its latest step, or its creation. */
function lastRecordedInstant(record) {
  return record.history.length ? record.history[record.history.length - 1].at : record.createdAt;
}

function assertHumanDecision(actor, at, what) {
  const problem = reviewerProblem(actor);
  if (problem) {
    throw new Error(`learning: ${what} needs a named human who is an authorised reviewer (${problem}). Spec §23: no production self-modification — a candidate advances only on a person's decision.`);
  }
  if (!isIsoInstant(at)) throw new Error(`learning: ${what} needs the UTC instant it was decided`);
}

/**
 * Move a candidate ONE stage forward. Throws unless an authorised reviewer
 * decided it, with a real instant and a short reference to the evidence they
 * reviewed. Returns a new frozen record built from the trusted copy; the input
 * is never mutated and never read twice.
 */
export function advanceCandidate(candidate, decision) {
  const record = trustedRecord(candidate);
  const { actor, at, evidenceReference } = decision !== null && typeof decision === 'object' ? decision : {};
  if (record.stage === LEARNING_REJECTED) throw new Error('learning: a rejected candidate does not advance');
  const idx = LEARNING_PIPELINE.indexOf(record.stage);
  if (idx === LEARNING_PIPELINE.length - 1) throw new Error('learning: DEPLOYMENT is the last stage');
  assertHumanDecision(actor, at, 'a pipeline step');
  const reference = referenceProblem(evidenceReference);
  if (reference) throw new Error(`learning: a pipeline step needs a reference to what was reviewed (${reference})`);
  if (Date.parse(at) < Date.parse(lastRecordedInstant(record))) throw new Error('learning: a step cannot be dated before the one it follows');
  const step = Object.freeze({
    from: LEARNING_PIPELINE[idx],
    to: LEARNING_PIPELINE[idx + 1],
    actor: actor.trim(),
    at,
    evidenceReference: evidenceReference.trim(),
  });
  return Object.freeze({ ...record, stage: step.to, history: Object.freeze([...record.history, step]) });
}

/** Reject a candidate. Terminal, and also an authorised reviewer's decision, for one of the listed reasons. */
export function rejectCandidate(candidate, decision) {
  const record = trustedRecord(candidate);
  const { actor, at, reasonCode } = decision !== null && typeof decision === 'object' ? decision : {};
  if (record.stage === LEARNING_REJECTED) throw new Error('learning: already rejected');
  if (record.stage === 'DEPLOYMENT') throw new Error('learning: a deployed learning is withdrawn by a new versioned change, not by rejecting its record');
  assertHumanDecision(actor, at, 'a rejection');
  if (typeof reasonCode !== 'string' || !reasonCode.trim()) throw new Error('learning: a rejection needs a reason code');
  if (!LEARNING_REJECTION_REASONS.includes(reasonCode)) {
    throw new Error(`learning: a rejection needs a reason code from the closed list (${LEARNING_REJECTION_REASONS.join(', ')})`);
  }
  // Same rule, same helper as advanceCandidate(): the two paths cannot drift.
  if (Date.parse(at) < Date.parse(lastRecordedInstant(record))) throw new Error('learning: a step cannot be dated before the one it follows');
  const step = Object.freeze({ from: record.stage, to: LEARNING_REJECTED, actor: actor.trim(), at, reasonCode });
  return Object.freeze({ ...record, stage: LEARNING_REJECTED, history: Object.freeze([...record.history, step]) });
}

/** True only for a candidate that reached DEPLOYMENT through every stage, each decided by an authorised reviewer. */
export function isDeployedLearning(candidate) {
  const { record } = inspectCandidate(candidate);
  return !!record && record.stage === 'DEPLOYMENT';
}

/**
 * The log line for a candidate. Coarse, structured fields only — never the
 * summary or the phrase: a log has a wider audience and a shorter life than the
 * review record, and free text has no business in it.
 */
export function candidateLogLine(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('learning: nothing to log');
  // AUDIT 2026-10-04 (SPEC-23) — this printed whatever sat in the six fields of
  // whatever object it was given, so "never free text" held only for records
  // the constructor had made: { kind: 'call me at 555-…' } went into the log
  // verbatim. A record that is not trustworthy is not logged. What is printed
  // comes from the trusted COPY (never from the object handed in, which could
  // answer differently the second time): a digest, three values from closed
  // lists, a stage and a count.
  const record = trustedRecord(candidate, ' — nothing is logged');
  return '[CANDIDATE-LEARNING] ' + JSON.stringify({
    candidateId: record.candidateId,
    kind: record.kind,
    surface: record.surface,
    language: record.language,
    stage: record.stage,
    occurrences: record.occurrences,
  });
}

/**
 * What an automated surface does with something it noticed: ONE log line, or
 * nothing. The input is exactly { observation, language } — a code from
 * AUTOMATED_OBSERVATIONS and one of the two languages served. There is no text
 * field and no id field; an input carrying anything else produces no line.
 *
 * It never throws — a refused or malformed observation must not be able to
 * break the reply or the call it was noticed in — and it returns a string for
 * the caller to log: this module writes nowhere, not even to a log.
 *
 * There is no store behind it. The line IS the candidate until a person picks
 * it up; everything after CANDIDATE is a human step (advanceCandidate).
 */
export function observationLogLine(input) {
  try {
    const given = plainRecord(input, ['observation', 'language']);
    if (!given || typeof given.observation !== 'string') return null;
    if (!Object.prototype.hasOwnProperty.call(AUTOMATED_OBSERVATIONS, given.observation)) return null;
    const fixed = AUTOMATED_OBSERVATIONS[given.observation];
    const made = createCandidateLearning({ kind: fixed.kind, surface: fixed.surface, summary: fixed.summary, language: given.language });
    return made.ok ? candidateLogLine(made.candidate) : null;
  } catch {
    return null;
  }
}

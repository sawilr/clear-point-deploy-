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
// CANDIDATE; it moves one stage at a time, and every move is made by a named
// person (./actors.js) with a reference to what they looked at.
//
// WHAT THIS MODULE IS NOT: a mechanism that changes anything. No function here
// accepts, returns or writes a prompt, a ruleset, a knowledge body or SOA text.
// Reaching DEPLOYMENT records that people approved and shipped a change through
// the normal versioned route (a reviewed commit) — it does not ship it. The
// build gate scripts/check-no-self-modification.mjs enforces the other half:
// nothing under api/ can write to the filesystem, and the governing artefacts
// are frozen.
//
// A CANDIDATE DESCRIBES THE SYSTEM, NOT THE CALLER. Its text fields are for what
// the assistant did ("the Spanish greeting is heard as a question"), never for
// what a person said. They are refused outright if the scrubbers find
// identifiers, clinical, benefit or financial detail. One limit is stated
// rather than hidden: no scrubber can recognise a bare personal name, so the
// first human stage must reject a candidate that quotes or names a caller.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { humanActorProblem } from './actors.js';
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

export const SUMMARY_MAX_CHARS = 280;
export const PHRASE_MAX_CHARS = 200;

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isIsoInstant(value) {
  if (typeof value !== 'string' || !ISO_INSTANT_RE.test(value)) return false;
  const t = Date.parse(value);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === value.slice(0, 19);
}

/**
 * Why a text field may not be stored — or null. Refuses rather than cleans: a
 * candidate that needed cleaning was describing a person, and a scrubbed
 * description of a person is still not a description of the system.
 */
function textProblem(value, max, field) {
  if (typeof value !== 'string' || !value.trim()) return { reason: 'CANDIDATE_TEXT_REQUIRED', field };
  if (value.length > max) return { reason: 'CANDIDATE_TEXT_TOO_LONG', field, max };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return { reason: 'CANDIDATE_TEXT_NOT_PLAIN', field };
  const phi = scrubPHI(value, { stripContact: true });
  if (phi.detected.length || phi.text !== value) {
    return { reason: 'CANDIDATE_CONTAINS_SENSITIVE_DATA', field, categories: [...new Set(phi.detected)] };
  }
  const prohibited = findProhibited(value);
  if (prohibited.length) return { reason: 'CANDIDATE_CONTAINS_SENSITIVE_DATA', field, categories: ['PROHIBITED_ATTRIBUTE'] };
  // What the shared scrubbers do not look for, and a description of the SYSTEM
  // never needs: a calendar date (a date of birth went straight through the
  // first version), a long number (ZIP, member or account numbers), and the
  // commonest ways a person gets named. This is a net, not a name detector.
  const extra = STRICT_TEXT_RULES.filter(([, re]) => re.test(value)).map(([category]) => category);
  if (extra.length) return { reason: 'CANDIDATE_CONTAINS_SENSITIVE_DATA', field, categories: extra };
  return null;
}

const STRICT_TEXT_RULES = Object.freeze([
  ['DATE', /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|ene|abr|ago|dic)[a-zé]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+de\s+[a-zé]+\s+(?:de|del)\s+\d{4}\b/i],
  ['LONG_NUMBER', /\d{5,}/],
  ['PERSON_REFERENCE', /\b(?:my name is|his name is|her name is|me llamo|mi nombre es|se llama)\b/i],
  ['PERSON_REFERENCE', /\b(?:[Mm]rs?|[Mm]s|[Mm]iss|[Dd]r|[Ss]ra?|[Ss]rta|[Dd]on|[Dd]oña)\.?\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+/u],
  ['PERSON_REFERENCE', /\b(?:[Cc]aller|[Bb]eneficiary|[Cc]lient|[Mm]ember|[Pp]atient|[Ll]lamante|[Bb]eneficiari[oa]|[Cc]liente|[Pp]aciente)\s+[A-ZÁÉÍÓÚÑ][\p{Ll}'-]+\s+[A-ZÁÉÍÓÚÑ][\p{Ll}'-]+/u],
]);

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
 * and candidateHistoryProblem() — which every later stage calls — go through it.
 * An absent phrase (null or undefined) is "no phrase"; anything else is judged.
 */
function candidateFieldsProblem({ kind, surface, language, summary, agentPhrase, occurrences, createdAt, candidateId }) {
  if (typeof kind !== 'string' || !CANDIDATE_KINDS.includes(kind)) return { reason: 'CANDIDATE_KIND_UNKNOWN' };
  if (typeof surface !== 'string' || !LEARNING_SURFACES.includes(surface)) return { reason: 'CANDIDATE_SURFACE_UNKNOWN' };
  if (language !== 'en' && language !== 'es') return { reason: 'CANDIDATE_LANGUAGE_UNKNOWN' };
  if (!Number.isInteger(occurrences) || occurrences < 1) return { reason: 'CANDIDATE_OCCURRENCES_INVALID' };
  if (!isIsoInstant(createdAt)) return { reason: 'CANDIDATE_INSTANT_INVALID' };
  if (typeof candidateId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(candidateId)) return { reason: 'CANDIDATE_ID_INVALID' };
  const summaryProblem = textProblem(summary, SUMMARY_MAX_CHARS, 'summary');
  if (summaryProblem) return summaryProblem;
  if (agentPhrase !== null && agentPhrase !== undefined) {
    const phraseProblem = textProblem(agentPhrase, PHRASE_MAX_CHARS, 'agentPhrase');
    if (phraseProblem) return phraseProblem;
  }
  return null;
}

/**
 * Record an observation as a candidate. Returns { ok:true, candidate } (frozen)
 * or { ok:false, reason, … } — it never throws on bad input, because the caller
 * is an automated surface and a rejected observation must not break a call.
 *
 * `observedBy` names the surface that noticed, and may be automated: observing
 * is the one thing the assistants are allowed to do. Deciding is not.
 */
export function createCandidateLearning(input) {
  const {
    kind, surface, language, summary, agentPhrase = null, occurrences = 1,
    createdAt = new Date().toISOString(), candidateId = crypto.randomUUID(),
  } = input && typeof input === 'object' ? input : {};

  const problem = candidateFieldsProblem({ kind, surface, language, summary, agentPhrase, occurrences, createdAt, candidateId });
  if (problem) return { ok: false, ...problem };

  return {
    ok: true,
    candidate: Object.freeze({
      candidateId,
      kind,
      surface,
      language,
      summary: summary.trim(),
      agentPhrase: agentPhrase === null ? null : agentPhrase.trim(),
      occurrences,
      createdAt,
      stage: 'CANDIDATE',
      history: Object.freeze([]),
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
  if (!candidate || typeof candidate !== 'object') return 'CANDIDATE_MISSING';
  if (!Array.isArray(candidate.history)) return 'HISTORY_MISSING';
  const rejected = candidate.stage === LEARNING_REJECTED;
  const idx = LEARNING_PIPELINE.indexOf(candidate.stage);
  if (!rejected && idx < 0) return 'STAGE_UNKNOWN';

  const steps = candidate.history;
  const forward = rejected ? steps.slice(0, -1) : steps;
  if (!rejected && forward.length !== idx) return 'HISTORY_DOES_NOT_REACH_STAGE';
  if (rejected && steps.length < 1) return 'HISTORY_DOES_NOT_REACH_STAGE';

  let previous = candidate.createdAt;
  for (let i = 0; i < forward.length; i++) {
    const s = forward[i];
    if (!s || typeof s !== 'object') return 'HISTORY_ENTRY_MALFORMED';
    if (s.from !== LEARNING_PIPELINE[i] || s.to !== LEARNING_PIPELINE[i + 1]) return 'HISTORY_OUT_OF_ORDER';
    if (!hasOnlyKeys(s, FORWARD_STEP_KEYS)) return 'HISTORY_ENTRY_MALFORMED';
    if (humanActorProblem(s.actor)) return 'HISTORY_STEP_NOT_BY_A_PERSON';
    if (!isIsoInstant(s.at)) return 'HISTORY_INSTANT_INVALID';
    if (isIsoInstant(previous) && Date.parse(s.at) < Date.parse(previous)) return 'HISTORY_NOT_CHRONOLOGICAL';
    if (typeof s.evidenceReference !== 'string' || !s.evidenceReference.trim()) return 'HISTORY_EVIDENCE_MISSING';
    previous = s.at;
  }
  if (rejected) {
    const last = steps[steps.length - 1];
    if (!last || typeof last !== 'object') return 'HISTORY_ENTRY_MALFORMED';
    if (last.to !== LEARNING_REJECTED || last.from !== LEARNING_PIPELINE[forward.length]) return 'HISTORY_OUT_OF_ORDER';
    if (!hasOnlyKeys(last, REJECTION_STEP_KEYS)) return 'HISTORY_ENTRY_MALFORMED';
    if (humanActorProblem(last.actor)) return 'HISTORY_STEP_NOT_BY_A_PERSON';
    if (!isIsoInstant(last.at)) return 'HISTORY_INSTANT_INVALID';
    // AUDIT 2026-10-04 (SPEC-23) — the forward steps were checked for order in
    // time and the rejection was not: the mirror path accepted what the first
    // refused. A rejection dated before the thing it rejects existed is not a
    // record of a decision.
    if (isIsoInstant(previous) && Date.parse(last.at) < Date.parse(previous)) return 'HISTORY_NOT_CHRONOLOGICAL';
    if (typeof last.reasonCode !== 'string' || !last.reasonCode.trim()) return 'HISTORY_REASON_MISSING';
  }
  // AUDIT 2026-10-04 (SPEC-23) — the record itself, not only its history. A
  // closed list of fields, because advanceCandidate() copies the record forward
  // and anything extra ("transcript", "callerName") would ride along unjudged;
  // then the same field rules the constructor applies (candidateFieldsProblem).
  if (!hasOnlyKeys(candidate, CANDIDATE_RECORD_KEYS)) return 'CANDIDATE_FIELD_NOT_ALLOWED';
  const fields = candidateFieldsProblem(candidate);
  if (fields) return fields.reason;
  return null;
}

const CANDIDATE_RECORD_KEYS = Object.freeze([
  'candidateId', 'kind', 'surface', 'language', 'summary', 'agentPhrase', 'occurrences', 'createdAt', 'stage', 'history',
]);
const FORWARD_STEP_KEYS = Object.freeze(['from', 'to', 'actor', 'at', 'evidenceReference']);
const REJECTION_STEP_KEYS = Object.freeze(['from', 'to', 'actor', 'at', 'reasonCode']);

/** Does `value` carry no own property (string or symbol, enumerable or not) outside `allowed`? */
function hasOnlyKeys(value, allowed) {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.includes(key));
}

/** The instant of the last thing recorded about a candidate: its latest step, or its creation. */
function lastRecordedInstant(candidate) {
  return candidate.history.length ? candidate.history[candidate.history.length - 1].at : candidate.createdAt;
}

/** Earlier steps, copied and frozen: Object.freeze is shallow, and a hand-built step would stay editable inside a "frozen" record. */
function frozenHistory(candidate, step) {
  return Object.freeze([...candidate.history.map((s) => Object.freeze({ ...s })), step]);
}

function assertHumanDecision(actor, at, what) {
  const problem = humanActorProblem(actor);
  if (problem) {
    throw new Error(`learning: ${what} needs a named human (${problem}). Spec §23: no production self-modification — a candidate advances only on a person's decision.`);
  }
  if (!isIsoInstant(at)) throw new Error(`learning: ${what} needs the UTC instant it was decided`);
}

/**
 * Move a candidate ONE stage forward. Throws unless a named person decided it,
 * with a real instant and a reference to the evidence they reviewed. Returns a
 * new frozen record; the input is never mutated.
 */
export function advanceCandidate(candidate, { actor, at, evidenceReference } = {}) {
  const problem = candidateHistoryProblem(candidate);
  if (problem) throw new Error(`learning: this candidate's record is not trustworthy (${problem})`);
  if (candidate.stage === LEARNING_REJECTED) throw new Error('learning: a rejected candidate does not advance');
  const idx = LEARNING_PIPELINE.indexOf(candidate.stage);
  if (idx === LEARNING_PIPELINE.length - 1) throw new Error('learning: DEPLOYMENT is the last stage');
  assertHumanDecision(actor, at, 'a pipeline step');
  if (typeof evidenceReference !== 'string' || !evidenceReference.trim()) {
    throw new Error('learning: a pipeline step needs a reference to what was reviewed');
  }
  if (Date.parse(at) < Date.parse(lastRecordedInstant(candidate))) throw new Error('learning: a step cannot be dated before the one it follows');
  const step = Object.freeze({
    from: LEARNING_PIPELINE[idx],
    to: LEARNING_PIPELINE[idx + 1],
    actor: actor.trim(),
    at,
    evidenceReference: evidenceReference.trim(),
  });
  return Object.freeze({ ...candidate, stage: step.to, history: frozenHistory(candidate, step) });
}

/** Reject a candidate. Terminal, and also a person's decision. */
export function rejectCandidate(candidate, { actor, at, reasonCode } = {}) {
  const problem = candidateHistoryProblem(candidate);
  if (problem) throw new Error(`learning: this candidate's record is not trustworthy (${problem})`);
  if (candidate.stage === LEARNING_REJECTED) throw new Error('learning: already rejected');
  if (candidate.stage === 'DEPLOYMENT') throw new Error('learning: a deployed learning is withdrawn by a new versioned change, not by rejecting its record');
  assertHumanDecision(actor, at, 'a rejection');
  if (typeof reasonCode !== 'string' || !reasonCode.trim()) throw new Error('learning: a rejection needs a reason code');
  // Same rule, same helper as advanceCandidate(): the two paths cannot drift.
  if (Date.parse(at) < Date.parse(lastRecordedInstant(candidate))) throw new Error('learning: a step cannot be dated before the one it follows');
  const step = Object.freeze({ from: candidate.stage, to: LEARNING_REJECTED, actor: actor.trim(), at, reasonCode: reasonCode.trim() });
  return Object.freeze({ ...candidate, stage: LEARNING_REJECTED, history: frozenHistory(candidate, step) });
}

/** True only for a candidate that reached DEPLOYMENT through every stage, each decided by a person. */
export function isDeployedLearning(candidate) {
  return !!candidate && candidate.stage === 'DEPLOYMENT' && candidateHistoryProblem(candidate) === null;
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
  // verbatim. A record that is not trustworthy is not logged; what does get
  // printed is therefore an id of a fixed shape, three values from closed
  // lists, a stage and a count.
  const problem = candidateHistoryProblem(candidate);
  if (problem) throw new Error(`learning: this candidate's record is not trustworthy (${problem}) — nothing is logged`);
  return '[CANDIDATE-LEARNING] ' + JSON.stringify({
    candidateId: candidate.candidateId,
    kind: candidate.kind,
    surface: candidate.surface,
    language: candidate.language,
    stage: candidate.stage,
    occurrences: candidate.occurrences,
  });
}

/**
 * What an automated surface does with something it noticed: ONE log line, or
 * nothing. Returns the line for a new candidate, or null when the observation
 * is refused. It never throws — a refused or malformed observation must not be
 * able to break the reply or the call it was noticed in — and it returns a
 * string for the caller to log: this module writes nowhere, not even to a log.
 *
 * There is no store behind it. The line IS the candidate until a person picks
 * it up; everything after CANDIDATE is a human step (advanceCandidate).
 */
export function observationLogLine(input) {
  try {
    const made = createCandidateLearning(input);
    return made.ok ? candidateLogLine(made.candidate) : null;
  } catch {
    return null;
  }
}

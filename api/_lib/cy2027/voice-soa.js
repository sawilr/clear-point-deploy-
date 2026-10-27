// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — VOICE SOA: EMELY / SOFÍA (spec §10, §19, §21, §26, §28, §29, §31).
// SERVER ONLY by designation: nothing here is re-exported by ./index.js or by
// src/lib/cy2027.ts. Environment-neutral on purpose (no Node APIs): the digest
// is pinned here and recomputed by scripts/check-cy2027-parity.mjs, in the
// manner of APPROVED_TEXT_DIGEST.
//
// AUDIT 2026-10-04 (SPEC-10/19/26/28) — what was wrong: the instance model knew
// the method VOICE_RECORDED and the marketing gate refused a voice-only SOA for
// an in-person appointment, and that was all. There was no rule for WHEN a
// recorded SOA may be offered, no per-category capture ("yes to everything"
// had no meaning anywhere), no read-back rule, no voice evidence (no recording
// reference, transcript pointer or SOA-segment timestamps), no script, and no
// recording-failure rule. A VOICE_RECORDED instance could be evidenced with the
// same record as a web signature, and the §33 immediate-fail ("yes to
// everything" authorising everything) was decided by whatever the agent
// happened to write.
//
// What this module decides, each as a pure function tested by calling it:
//   voiceSoaOfferProblem()       §10/§28 — may a recorded SOA be OFFERED now?
//   captureCategoryDecisions()   §8/§10  — one affirmative reply PER category;
//                                a blanket "everything" authorises nothing and
//                                "I am not sure" selects nothing (SOA_INCOMPLETE)
//   readBackProblem()            §8/§31  — the read-back must be confirmed, and
//                                a difference from what was captured is caught
//   recordingSegmentProblem()    §26     — recording lost → the segment is void
//   buildVoiceEvidence()         §19     — the block evidence.js hashes
//   assembleVoiceScript()        §29     — the script, from the APPROVED text
//
// The connecting sentences below (purpose, one-at-a-time prompts, read-back
// framing, the two closes) are NEW customer-facing wording. They are carried
// with their approval status, which is PENDING_OWNER_APPROVAL: the offer gate
// refuses while it is, VOICE_SOA_ENABLED is false, and the build gate refuses
// a tree that enables voice SOA without a recorded human approval.
// ─────────────────────────────────────────────────────────────────────────────

import {
  SOA_CATEGORIES, ALL_CATEGORY_CODES, SOA_TEXT, SOA_SCRIPT_VERSION, FORBIDDEN_BARE_ACRONYMS,
  categoryByCode, categoryText, readBackLines,
} from './soa-text.js';
import { resolveFormat, SOA_METHOD, isSoaLanguage, languageWasElected, electionAttributionError } from './soa-instance.js';
import { classifyReply, CONSENT_STATUS, isIsoInstant } from './consent.js';
import { humanActorProblem, ACTOR_MAX_CHARS } from './actors.js';
import { SUPPORTED_STATES } from './state-rules.js';
import { plainRecord, plainList } from './plain-record.js';

/**
 * Voice SOA is OFF. Flip only together with: the script approved below by a
 * named person on a named date, VOICE_SCRIPT_DIGEST re-pinned in the same
 * commit, the GoHighLevel configuration package in docs/voice/ applied by the
 * owner, and a handler that receives the segment. The build gate refuses
 * `true` while the approval is not recorded.
 */
export const VOICE_SOA_ENABLED = false;

/** Approval states of the voice script. Only APPROVED, by a person, counts. */
export const VOICE_SCRIPT_STATUS = Object.freeze({
  PENDING_OWNER_APPROVAL: 'PENDING_OWNER_APPROVAL',
  APPROVED: 'APPROVED',
});

/**
 * The voice script's connecting sentences, both languages, with the script's
 * own version and its approval record. Everything a category says comes from
 * the approved text in ./soa-text.js at assembly time — never copied here.
 *
 * `approvedBy` / `approvedOn` are OWNER-SUPPLIED: never filled from a commit,
 * a comment or inference. Until a named person approves on a named date the
 * status stays PENDING_OWNER_APPROVAL and nothing may be offered by voice.
 */
export const VOICE_SOA_SCRIPT = Object.freeze({
  version: 'CP-SOA-VOICE-SCRIPT-CY2027-v0.1',
  basedOn: SOA_SCRIPT_VERSION,
  status: VOICE_SCRIPT_STATUS.PENDING_OWNER_APPROVAL,
  approvedBy: null,
  approvedOn: null,
  en: Object.freeze({
    // Asked after the four §28 choices are offered; the reply to THIS question
    // is what voiceSoaOfferProblem() classifies as the caller choosing voice.
    channelConfirmQuestion: 'Would you like to complete it now with me by voice? Please answer yes or no.',
    purpose:
      'The purpose of this step is to document which types of Medicare plan products you want the licensed agent to be allowed to discuss with you during your upcoming appointment.',
    oneAtATime:
      'I will describe each type one at a time. Please answer yes or no to each one, and I will read your choices back to you before anything is saved.',
    categoryQuestion:
      'Do you authorize the licensed agent to discuss this type of plan with you at this appointment? Please answer yes or no.',
    unsureLead: 'You may also choose this option:',
    unsureQuestion: 'Would you like to choose this option instead? Please answer yes or no.',
    confirmQuestion: 'Is that correct? Please answer yes or no.',
    incompleteClose:
      'That is fine. Nothing has been recorded as authorized today. A licensed Clear Point agent will explain the process with you first, before any plan-specific discussion.',
    recordingLostClose:
      'I am sorry, the recording of this call was interrupted, so this step cannot be completed by voice. Nothing has been recorded as authorized. A licensed Clear Point agent will follow up with you to complete it another way.',
  }),
  es: Object.freeze({
    channelConfirmQuestion: '¿Desea completarlo ahora conmigo por voz? Por favor responda sí o no.',
    purpose:
      'El propósito de este paso es documentar qué tipos de productos de planes de Medicare usted desea que el agente licenciado pueda conversar con usted en su próxima cita.',
    oneAtATime:
      'Le describiré cada tipo uno por uno. Por favor responda sí o no a cada uno, y le repetiré sus respuestas antes de guardar nada.',
    categoryQuestion:
      '¿Autoriza usted al agente licenciado a conversar sobre este tipo de plan con usted en esta cita? Por favor responda sí o no.',
    unsureLead: 'También puede elegir esta opción:',
    unsureQuestion: '¿Desea elegir esta opción en su lugar? Por favor responda sí o no.',
    confirmQuestion: '¿Es correcto? Por favor responda sí o no.',
    incompleteClose:
      'Está bien. Hoy no se ha registrado ninguna autorización. Un agente licenciado de Clear Point le explicará primero el proceso, antes de cualquier conversación específica sobre planes.',
    recordingLostClose:
      'Lo siento, la grabación de esta llamada se interrumpió, así que este paso no puede completarse por voz. No se ha registrado ninguna autorización. Un agente licenciado de Clear Point se comunicará con usted para completarlo de otra manera.',
  }),
});

/**
 * Pinned digest of the script: its connecting sentences, its approval record
 * AND the assembled lines (so the approved category text it speaks is pinned
 * too). Recomputed by scripts/check-cy2027-parity.mjs; a mismatch fails the
 * build. Re-pin ONLY together with an owner-approved change.
 */
export const VOICE_SCRIPT_DIGEST = 'sha256:445c1027f56f55826c9920fff8c7d196dd044f0ba69a5b6a6061917afcb9f690';

/** Why a voice-SOA step cannot proceed. Every refusal is one of these names. */
export const VOICE_SOA_PROBLEM = Object.freeze({
  VOICE_SOA_DISABLED: 'VOICE_SOA_DISABLED',
  VOICE_SCRIPT_NOT_APPROVED: 'VOICE_SCRIPT_NOT_APPROVED',
  VOICE_SCRIPT_VERSION_MISMATCH: 'VOICE_SCRIPT_VERSION_MISMATCH',
  RESIDENCE_STATE_NOT_CONFIRMED: 'RESIDENCE_STATE_NOT_CONFIRMED',
  CONTACT_CONTEXT_NOT_ESTABLISHED: 'CONTACT_CONTEXT_NOT_ESTABLISHED',
  CHANNEL_NOT_CHOSEN_BY_CALLER: 'CHANNEL_NOT_CHOSEN_BY_CALLER',
  UNKNOWN_APPOINTMENT_FORMAT: 'UNKNOWN_APPOINTMENT_FORMAT',
  IN_PERSON_REQUIRES_WRITTEN_SOA: 'IN_PERSON_REQUIRES_WRITTEN_SOA',
  RECORDING_NOT_CONFIRMED_ACTIVE: 'RECORDING_NOT_CONFIRMED_ACTIVE',
  SOA_LANGUAGE_NOT_ELECTED: 'SOA_LANGUAGE_NOT_ELECTED',
  UNKNOWN_CATEGORY: 'UNKNOWN_CATEGORY',
  CATEGORY_NOT_ASKED: 'CATEGORY_NOT_ASKED',
  CATEGORY_ASKED_TWICE: 'CATEGORY_ASKED_TWICE',
  CATEGORY_REPLY_UNCLEAR: 'CATEGORY_REPLY_UNCLEAR',
  BLANKET_REPLY_NOT_AUTHORIZATION: 'BLANKET_REPLY_NOT_AUTHORIZATION',
  SOA_INCOMPLETE: 'SOA_INCOMPLETE',
  CAPTURE_NOT_COMPLETE: 'CAPTURE_NOT_COMPLETE',
  READ_BACK_MISMATCH: 'READ_BACK_MISMATCH',
  READ_BACK_NOT_CONFIRMED: 'READ_BACK_NOT_CONFIRMED',
  READ_BACK_REJECTED: 'READ_BACK_REJECTED',
  SEGMENT_TIMESTAMPS_INVALID: 'SEGMENT_TIMESTAMPS_INVALID',
  RECORDING_LOST_DURING_SEGMENT: 'RECORDING_LOST_DURING_SEGMENT',
  VOICE_EVIDENCE_MISSING: 'VOICE_EVIDENCE_MISSING',
  VOICE_EVIDENCE_INCOMPLETE: 'VOICE_EVIDENCE_INCOMPLETE',
  VOICE_EVIDENCE_CONTRADICTS_INSTANCE: 'VOICE_EVIDENCE_CONTRADICTS_INSTANCE',
  NOT_A_VOICE_INSTANCE: 'NOT_A_VOICE_INSTANCE',
});

/** What one category reply decided. Anything else is "ask again", never a decision. */
export const VOICE_DECISION = Object.freeze({
  AUTHORIZED: 'AUTHORIZED',
  DECLINED: 'DECLINED',
  UNSURE: 'UNSURE',
});

/** Outcome of a complete capture. */
export const VOICE_CAPTURE_OUTCOME = Object.freeze({
  AUTHORIZED: 'AUTHORIZED',
  SOA_INCOMPLETE: 'SOA_INCOMPLETE',
});

/**
 * Replies that try to authorise everything at once (spec §8: "Do not use
 * 'Select All' as a one-click authorization. If beneficiary says 'everything',
 * present each applicable category individually and capture affirmative
 * responses."). A blanket reply authorises NOTHING, for the category it was
 * given to as well; that category is asked again, individually.
 */
export const BLANKET_REPLIES = Object.freeze([
  'everything', 'all', 'all of them', 'all of those', 'all of the above', 'all three', 'both',
  'yes to everything', 'yes to all', 'yes all', 'yes everything', 'any of them', 'anything', 'whatever',
  'todo', 'todos', 'todas', 'a todo', 'sí a todo', 'si a todo', 'todo sí', 'todo si', 'todas las opciones',
  'todos los planes', 'las tres', 'los tres', 'cualquiera', 'lo que sea', 'ambos', 'ambas',
]);

/**
 * Replies that express uncertainty (spec §10: "If the beneficiary is confused,
 * do not force completion. Mark SOA_INCOMPLETE and route to licensed agent").
 * Checked before anything else: "I don't know, maybe all of them" is confusion.
 */
export const UNSURE_REPLIES = Object.freeze([
  'not sure', 'im not sure', 'i am not sure', 'i dont know', 'dont know', 'no idea', 'unsure', 'maybe',
  'not certain', 'i guess', 'discuss the process', 'talk to someone first',
  'no estoy seguro', 'no estoy segura', 'no sé', 'no se', 'quizás', 'quizas', 'tal vez', 'no lo sé', 'no lo se',
  'prefiero hablar primero', 'hablar primero', 'no entiendo', 'i dont understand',
]);

/** Longest utterance that is still an answer and not a conversation. */
export const REPLY_MAX_CHARS = 200;

const norm = (s) => String(s == null ? '' : s)
  .toLowerCase()
  .replace(/[’'`]/g, '')
  .replace(/[.!¡¿?,;:]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const containsPhrase = (text, phrase) => text === phrase || text.startsWith(phrase + ' ') || text.includes(' ' + phrase + ' ') || text.endsWith(' ' + phrase);

/** True when the reply tries to answer for every category at once. */
export function isBlanketReply(text) {
  const t = norm(text);
  return !!t && BLANKET_REPLIES.some((p) => containsPhrase(t, p));
}

/** True when the reply expresses uncertainty rather than an answer. */
export function isUnsureReply(text) {
  const t = norm(text);
  return !!t && UNSURE_REPLIES.some((p) => containsPhrase(t, p));
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isCalendarDay = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
};
const utcToday = () => new Date().toISOString().slice(0, 10);
const sameSet = (a, b) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/**
 * Why `script` is not an approved voice script — or null when it is. The
 * approver is judged by the layer's one human-actor rule; a date is a real
 * calendar day that is not in the future.
 */
export function voiceScriptApprovalProblem(script = VOICE_SOA_SCRIPT, today = utcToday()) {
  const s = plainRecord(script, ['version', 'basedOn', 'status', 'approvedBy', 'approvedOn', 'en', 'es']);
  if (!s) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_NOT_APPROVED;
  if (s.status !== VOICE_SCRIPT_STATUS.APPROVED) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_NOT_APPROVED;
  if (humanActorProblem(s.approvedBy) !== null || s.approvedBy.length > ACTOR_MAX_CHARS) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_NOT_APPROVED;
  if (!isCalendarDay(s.approvedOn) || !isCalendarDay(today) || s.approvedOn > today) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_NOT_APPROVED;
  return null;
}

/**
 * The script as spoken, in order, assembled from the APPROVED text: category
 * labels and descriptions, the "important" statement and the authorization
 * statement are the approved strings by reference — never paraphrased, never
 * abbreviated. Read-back items are per capture (see voiceReadBack()).
 */
export function assembleVoiceScript(lang, script = VOICE_SOA_SCRIPT) {
  if (!isSoaLanguage(lang)) throw new Error('voice-soa: the script has no language (SOA_LANGUAGE_NOT_ELECTED)');
  const s = script[lang];
  const t = SOA_TEXT[lang];
  const line = (step, text, code) => Object.freeze(code ? { step, code, text } : { step, text });
  const lines = [
    line('PURPOSE', s.purpose),
    line('IMPORTANT', t.important),
    line('ONE_AT_A_TIME', s.oneAtATime),
  ];
  for (const c of SOA_CATEGORIES) {
    const ct = categoryText(c.code, lang);
    if (c.authorizes) lines.push(line('CATEGORY', `${ct.label}. ${ct.description} ${s.categoryQuestion}`, c.code));
    else lines.push(line('UNSURE_OPTION', `${s.unsureLead} ${ct.label}. ${ct.description} ${s.unsureQuestion}`, c.code));
  }
  lines.push(line('READ_BACK', `${t.readBackHeading}. ${t.readBackIntro}`));
  lines.push(line('AUTHORIZATION', t.authorizationStatement));
  lines.push(line('CONFIRM', s.confirmQuestion));
  lines.push(line('INCOMPLETE_CLOSE', s.incompleteClose));
  lines.push(line('RECORDING_LOST_CLOSE', s.recordingLostClose));
  return Object.freeze(lines);
}

/** Deterministic serialization the pinned digest is computed over. */
export function voiceScriptPayload(script = VOICE_SOA_SCRIPT) {
  return JSON.stringify({
    version: script.version,
    basedOn: script.basedOn,
    status: script.status,
    approvedBy: script.approvedBy,
    approvedOn: script.approvedOn,
    en: script.en,
    es: script.es,
    assembled: { en: assembleVoiceScript('en', script), es: assembleVoiceScript('es', script) },
  });
}

/** Bare acronyms (§29) found in the assembled script, both languages — empty when clean. */
export function bareAcronymsInScript(script = VOICE_SOA_SCRIPT) {
  const found = [];
  for (const lang of ['en', 'es']) {
    for (const l of assembleVoiceScript(lang, script)) {
      for (const a of FORBIDDEN_BARE_ACRONYMS) {
        if (new RegExp('(^|[^A-Za-z-])' + a.replace('-', '\\-') + '([^A-Za-z-]|$)').test(l.text)) found.push(`${lang}:${l.step}:${a}`);
      }
    }
  }
  return found;
}

/**
 * §10 / §28 — may a recorded SOA be OFFERED on this call? Null when it may;
 * otherwise the first refusal, in this order, each named:
 *   VOICE_SOA_DISABLED               the flag is off
 *   VOICE_SCRIPT_NOT_APPROVED        no recorded human approval of the script
 *   RESIDENCE_STATE_NOT_CONFIRMED    state not confirmed, or not a served state
 *   CONTACT_CONTEXT_NOT_ESTABLISHED  identity/contact context not established
 *   CHANNEL_NOT_CHOSEN_BY_CALLER     the caller did not affirmatively choose voice
 *   UNKNOWN_APPOINTMENT_FORMAT       format absent or not on the approved list
 *   IN_PERSON_REQUIRES_WRITTEN_SOA   §10/§11: never voice-only for in person
 *   RECORDING_NOT_CONFIRMED_ACTIVE   recording not confirmed, or no reference
 *   SOA_LANGUAGE_NOT_ELECTED         language not en/es or not an election
 *   representative_required / election_attribution_mismatch (soa-instance.js)
 */
export function voiceSoaOfferProblem(ctx, { enabled = VOICE_SOA_ENABLED, script = VOICE_SOA_SCRIPT, today = utcToday() } = {}) {
  if (enabled !== true) return VOICE_SOA_PROBLEM.VOICE_SOA_DISABLED;
  const approval = voiceScriptApprovalProblem(script, today);
  if (approval) return approval;
  const c = plainRecord(ctx, ['residenceState', 'contactContext', 'channelChoice', 'appointmentFormat', 'recording', 'language', 'languageSource'], ['representativeRelationship']);
  if (!c) return VOICE_SOA_PROBLEM.RESIDENCE_STATE_NOT_CONFIRMED;

  const residence = plainRecord(c.residenceState, ['confirmed', 'state']);
  if (!residence || residence.confirmed !== true || typeof residence.state !== 'string') return VOICE_SOA_PROBLEM.RESIDENCE_STATE_NOT_CONFIRMED;
  if (!SUPPORTED_STATES.includes(residence.state.trim().toUpperCase())) return VOICE_SOA_PROBLEM.RESIDENCE_STATE_NOT_CONFIRMED;

  const contact = plainRecord(c.contactContext, ['established', 'beneficiaryName']);
  if (!contact || contact.established !== true) return VOICE_SOA_PROBLEM.CONTACT_CONTEXT_NOT_ESTABLISHED;
  if (typeof contact.beneficiaryName !== 'string' || contact.beneficiaryName.trim().length < 2) return VOICE_SOA_PROBLEM.CONTACT_CONTEXT_NOT_ESTABLISHED;

  const choice = plainRecord(c.channelChoice, ['channel', 'reply']);
  if (!choice || choice.channel !== 'VOICE') return VOICE_SOA_PROBLEM.CHANNEL_NOT_CHOSEN_BY_CALLER;
  if (typeof choice.reply !== 'string' || isUnsureReply(choice.reply) || isBlanketReply(choice.reply)) return VOICE_SOA_PROBLEM.CHANNEL_NOT_CHOSEN_BY_CALLER;
  if (classifyReply(choice.reply) !== CONSENT_STATUS.GRANTED) return VOICE_SOA_PROBLEM.CHANNEL_NOT_CHOSEN_BY_CALLER;

  const format = resolveFormat(c.appointmentFormat);
  if (!format) return VOICE_SOA_PROBLEM.UNKNOWN_APPOINTMENT_FORMAT;
  if (format.inPerson !== false) return VOICE_SOA_PROBLEM.IN_PERSON_REQUIRES_WRITTEN_SOA;

  const recording = plainRecord(c.recording, ['active', 'reference']);
  if (!recording || recording.active !== true || !nonEmptyString(recording.reference)) return VOICE_SOA_PROBLEM.RECORDING_NOT_CONFIRMED_ACTIVE;

  if (!isSoaLanguage(c.language) || !languageWasElected(c.languageSource)) return VOICE_SOA_PROBLEM.SOA_LANGUAGE_NOT_ELECTED;
  const rep = hasOwn(c, 'representativeRelationship') ? c.representativeRelationship : null;
  if (rep !== null && typeof rep !== 'string') return VOICE_SOA_PROBLEM.SOA_LANGUAGE_NOT_ELECTED;
  const attribution = electionAttributionError(c.languageSource, rep);
  if (attribution) return attribution;
  return null;
}

/**
 * One category, one reply. `decision` is set only when the reply decided
 * something; otherwise `problem` says why the category is asked again.
 */
export function classifyCategoryReply(code, reply) {
  const category = typeof code === 'string' ? categoryByCode(code) : null;
  if (!category) return Object.freeze({ code: null, reply: '', replyClass: CONSENT_STATUS.NOT_ASKED, decision: null, problem: VOICE_SOA_PROBLEM.UNKNOWN_CATEGORY });
  const text = typeof reply === 'string' ? reply.trim() : '';
  const base = { code: category.code, reply: text.slice(0, REPLY_MAX_CHARS) };
  if (text.length > REPLY_MAX_CHARS) {
    return Object.freeze({ ...base, replyClass: CONSENT_STATUS.UNCLEAR, decision: null, problem: VOICE_SOA_PROBLEM.CATEGORY_REPLY_UNCLEAR });
  }
  if (isUnsureReply(text)) {
    return Object.freeze({ ...base, replyClass: CONSENT_STATUS.UNCLEAR, decision: VOICE_DECISION.UNSURE, problem: null });
  }
  if (isBlanketReply(text)) {
    return Object.freeze({ ...base, replyClass: CONSENT_STATUS.UNCLEAR, decision: null, problem: VOICE_SOA_PROBLEM.BLANKET_REPLY_NOT_AUTHORIZATION });
  }
  const replyClass = classifyReply(text);
  if (replyClass === CONSENT_STATUS.DECLINED) return Object.freeze({ ...base, replyClass, decision: VOICE_DECISION.DECLINED, problem: null });
  if (replyClass === CONSENT_STATUS.GRANTED) {
    return Object.freeze({ ...base, replyClass, decision: category.authorizes ? VOICE_DECISION.AUTHORIZED : VOICE_DECISION.UNSURE, problem: null });
  }
  return Object.freeze({ ...base, replyClass, decision: null, problem: VOICE_SOA_PROBLEM.CATEGORY_REPLY_UNCLEAR });
}

/**
 * §8 / §10 — every category (the three authorizing ones AND the "I am not
 * sure" option) is asked exactly once and answered with its OWN reply.
 *
 *   { ok: false, reason, code }       ask `code` again (blanket, unclear, not
 *                                     asked, asked twice, unknown)
 *   { ok: true, outcome: 'AUTHORIZED', selectedCategories, declinedCategories, decisions }
 *   { ok: true, outcome: 'SOA_INCOMPLETE', selectedCategories: [UNSURE…] or [], routeTo: 'LICENSED_AGENT' }
 *
 * "Yes to everything" is not an answer to any category. "I am not sure" —
 * said to any question, or as the chosen option — selects nothing.
 */
export function captureCategoryDecisions(replies) {
  const list = plainList(replies);
  if (!list) return Object.freeze({ ok: false, reason: VOICE_SOA_PROBLEM.CATEGORY_NOT_ASKED, code: null });
  const byCode = new Map();
  for (const entry of list) {
    const r = plainRecord(entry, ['code', 'reply'], ['askedAt']);
    if (!r || typeof r.code !== 'string' || !categoryByCode(r.code)) return Object.freeze({ ok: false, reason: VOICE_SOA_PROBLEM.UNKNOWN_CATEGORY, code: r && typeof r.code === 'string' ? r.code : null });
    if (byCode.has(r.code)) return Object.freeze({ ok: false, reason: VOICE_SOA_PROBLEM.CATEGORY_ASKED_TWICE, code: r.code });
    byCode.set(r.code, r.reply);
  }
  for (const code of ALL_CATEGORY_CODES) {
    if (!byCode.has(code)) return Object.freeze({ ok: false, reason: VOICE_SOA_PROBLEM.CATEGORY_NOT_ASKED, code });
  }
  const decisions = ALL_CATEGORY_CODES.map((code) => classifyCategoryReply(code, byCode.get(code)));
  const blanket = decisions.find((d) => d.problem === VOICE_SOA_PROBLEM.BLANKET_REPLY_NOT_AUTHORIZATION);
  if (blanket) return Object.freeze({ ok: false, reason: blanket.problem, code: blanket.code });
  const unclear = decisions.find((d) => d.problem !== null);
  if (unclear) return Object.freeze({ ok: false, reason: unclear.problem, code: unclear.code });

  const unsure = decisions.some((d) => d.decision === VOICE_DECISION.UNSURE);
  const authorized = unsure ? [] : decisions.filter((d) => d.decision === VOICE_DECISION.AUTHORIZED).map((d) => d.code);
  const declined = unsure
    ? ALL_CATEGORY_CODES.filter((code) => categoryByCode(code).authorizes)
    : decisions.filter((d) => d.decision === VOICE_DECISION.DECLINED && categoryByCode(d.code).authorizes).map((d) => d.code);
  const outcome = authorized.length ? VOICE_CAPTURE_OUTCOME.AUTHORIZED : VOICE_CAPTURE_OUTCOME.SOA_INCOMPLETE;
  const selected = unsure ? ALL_CATEGORY_CODES.filter((code) => !categoryByCode(code).authorizes) : authorized;
  return Object.freeze({
    ok: true,
    outcome,
    selectedCategories: Object.freeze(selected),
    declinedCategories: Object.freeze(declined),
    decisions: Object.freeze(decisions),
    routeTo: outcome === VOICE_CAPTURE_OUTCOME.SOA_INCOMPLETE ? 'LICENSED_AGENT' : null,
  });
}

/** The approved read-back lines for a capture, plus the confirmation question. */
export function voiceReadBack(capture, lang, script = VOICE_SOA_SCRIPT) {
  if (!isSoaLanguage(lang)) throw new Error('voice-soa: the read-back has no language (SOA_LANGUAGE_NOT_ELECTED)');
  const c = plainRecord(capture, ['ok', 'outcome', 'selectedCategories', 'declinedCategories', 'decisions', 'routeTo']);
  if (!c || c.ok !== true) throw new Error('voice-soa: nothing to read back (CAPTURE_NOT_COMPLETE)');
  const lines = readBackLines(c.selectedCategories, lang);
  return Object.freeze({ ...lines, items: Object.freeze(lines.items.slice()), authorization: SOA_TEXT[lang].authorizationStatement, confirmQuestion: script[lang].confirmQuestion });
}

/**
 * §8 / §31 — the read-back is what was captured, and the caller confirmed it.
 * `readBack.items` are the category CODES actually read back (from the
 * transcript); `readBack.confirmReply` is the caller's answer. Null when the
 * read-back stands; otherwise:
 *   CAPTURE_NOT_COMPLETE   nothing captured
 *   SOA_INCOMPLETE         nothing to confirm — route to a licensed agent
 *   READ_BACK_MISMATCH     what was read back differs from what was captured
 *   READ_BACK_REJECTED     the caller said no — capture again
 *   READ_BACK_NOT_CONFIRMED anything short of a clear yes
 */
export function readBackProblem(capture, readBack) {
  const c = plainRecord(capture, ['ok', 'outcome', 'selectedCategories', 'declinedCategories', 'decisions', 'routeTo']);
  if (!c || c.ok !== true) return VOICE_SOA_PROBLEM.CAPTURE_NOT_COMPLETE;
  if (c.outcome !== VOICE_CAPTURE_OUTCOME.AUTHORIZED) return VOICE_SOA_PROBLEM.SOA_INCOMPLETE;
  const rb = plainRecord(readBack, ['items', 'confirmReply']);
  if (!rb) return VOICE_SOA_PROBLEM.READ_BACK_NOT_CONFIRMED;
  const items = plainList(rb.items);
  if (!items || items.some((i) => typeof i !== 'string')) return VOICE_SOA_PROBLEM.READ_BACK_MISMATCH;
  const selected = plainList(c.selectedCategories);
  if (!selected || !sameSet(items, selected)) return VOICE_SOA_PROBLEM.READ_BACK_MISMATCH;
  if (typeof rb.confirmReply !== 'string' || rb.confirmReply.length > REPLY_MAX_CHARS) return VOICE_SOA_PROBLEM.READ_BACK_NOT_CONFIRMED;
  if (isUnsureReply(rb.confirmReply) || isBlanketReply(rb.confirmReply)) return VOICE_SOA_PROBLEM.READ_BACK_NOT_CONFIRMED;
  const cls = classifyReply(rb.confirmReply);
  if (cls === CONSENT_STATUS.DECLINED) return VOICE_SOA_PROBLEM.READ_BACK_REJECTED;
  if (cls !== CONSENT_STATUS.GRANTED) return VOICE_SOA_PROBLEM.READ_BACK_NOT_CONFIRMED;
  return null;
}

/**
 * §26 — "Recording failure on a call that must be recorded -> stop regulated
 * portion". A segment whose recording was not confirmed active THROUGHOUT is
 * void: nothing captured in it is completed, and the reason is named.
 */
export function recordingSegmentProblem(segment) {
  const s = plainRecord(segment, ['startedAt', 'endedAt', 'recordingActiveThroughout'], ['recordingLostAt']);
  if (!s) return VOICE_SOA_PROBLEM.SEGMENT_TIMESTAMPS_INVALID;
  if (!isIsoInstant(s.startedAt) || !isIsoInstant(s.endedAt)) return VOICE_SOA_PROBLEM.SEGMENT_TIMESTAMPS_INVALID;
  if (Date.parse(s.startedAt) >= Date.parse(s.endedAt)) return VOICE_SOA_PROBLEM.SEGMENT_TIMESTAMPS_INVALID;
  if (s.recordingActiveThroughout !== true) return VOICE_SOA_PROBLEM.RECORDING_LOST_DURING_SEGMENT;
  if (hasOwn(s, 'recordingLostAt') && s.recordingLostAt !== null && s.recordingLostAt !== undefined) return VOICE_SOA_PROBLEM.RECORDING_LOST_DURING_SEGMENT;
  return null;
}

const VOICE_EVIDENCE_KEYS = Object.freeze([
  'recordingReference', 'transcriptReference', 'segment', 'scriptVersion', 'scriptDigest', 'scriptApproval',
  'language', 'languageSource', 'representativeRelationship', 'scriptLines', 'decisions', 'selectedCategories',
  'declinedCategories', 'readBack',
]);

/**
 * §19 — the voice evidence block: recording reference, transcript pointer,
 * the SOA segment's start and end, the exact script version (and its digest
 * and approval), the language and its election, every category decision with
 * its reply classification, and the confirmed read-back. evidence.js puts the
 * whole block INSIDE the integrity hash of a VOICE_RECORDED instance.
 *
 * Returns { ok: true, voice } or { ok: false, reason, code? }.
 */
export function buildVoiceEvidence(input, { script = VOICE_SOA_SCRIPT, today = utcToday() } = {}) {
  const refuse = (reason, code = null) => Object.freeze({ ok: false, reason, code });
  const approval = voiceScriptApprovalProblem(script, today);
  if (approval) return refuse(approval);
  const i = plainRecord(input, ['recordingReference', 'transcriptReference', 'segment', 'language', 'languageSource', 'replies', 'readBack'], ['representativeRelationship']);
  if (!i) return refuse(VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE);
  if (!nonEmptyString(i.recordingReference) || !nonEmptyString(i.transcriptReference)) return refuse(VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE);
  const segmentProblem = recordingSegmentProblem(i.segment);
  if (segmentProblem) return refuse(segmentProblem);
  if (!isSoaLanguage(i.language) || !languageWasElected(i.languageSource)) return refuse(VOICE_SOA_PROBLEM.SOA_LANGUAGE_NOT_ELECTED);
  const rep = hasOwn(i, 'representativeRelationship') && typeof i.representativeRelationship === 'string' && i.representativeRelationship.trim()
    ? i.representativeRelationship.trim()
    : null;
  if (hasOwn(i, 'representativeRelationship') && i.representativeRelationship !== null && i.representativeRelationship !== undefined && typeof i.representativeRelationship !== 'string') {
    return refuse(VOICE_SOA_PROBLEM.SOA_LANGUAGE_NOT_ELECTED);
  }
  const attribution = electionAttributionError(i.languageSource, rep);
  if (attribution) return refuse(attribution);
  const capture = captureCategoryDecisions(i.replies);
  if (!capture.ok) return refuse(capture.reason, capture.code);
  if (capture.outcome !== VOICE_CAPTURE_OUTCOME.AUTHORIZED) return refuse(VOICE_SOA_PROBLEM.SOA_INCOMPLETE);
  const rbProblem = readBackProblem(capture, i.readBack);
  if (rbProblem) return refuse(rbProblem);
  const rb = plainRecord(i.readBack, ['items', 'confirmReply']);
  const segment = plainRecord(i.segment, ['startedAt', 'endedAt', 'recordingActiveThroughout'], ['recordingLostAt']);
  return Object.freeze({
    ok: true,
    voice: Object.freeze({
      recordingReference: i.recordingReference.trim(),
      transcriptReference: i.transcriptReference.trim(),
      segment: Object.freeze({ startedAt: segment.startedAt, endedAt: segment.endedAt, recordingActiveThroughout: true }),
      scriptVersion: script.version,
      scriptDigest: VOICE_SCRIPT_DIGEST,
      scriptApproval: Object.freeze({ approvedBy: script.approvedBy, approvedOn: script.approvedOn }),
      language: i.language,
      languageSource: i.languageSource,
      representativeRelationship: rep,
      scriptLines: assembleVoiceScript(i.language, script),
      decisions: capture.decisions,
      selectedCategories: capture.selectedCategories,
      declinedCategories: capture.declinedCategories,
      readBack: Object.freeze({ items: Object.freeze(plainList(rb.items).slice()), confirmReply: rb.confirmReply.trim(), confirmReplyClass: CONSENT_STATUS.GRANTED }),
    }),
  });
}

/**
 * Why a voice evidence block cannot be relied on — or null. Judged from the
 * block's OWN data: the decisions are re-run through the capture rule, the
 * read-back is re-checked, the script version/digest/approval must be the
 * ones in force, and the spoken lines must be exactly the assembled script.
 */
export function voiceEvidenceProblem(voice, { script = VOICE_SOA_SCRIPT, today = utcToday() } = {}) {
  const v = plainRecord(voice, VOICE_EVIDENCE_KEYS);
  if (!v) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE;
  if (!nonEmptyString(v.recordingReference) || !nonEmptyString(v.transcriptReference)) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE;
  const segmentProblem = recordingSegmentProblem(v.segment);
  if (segmentProblem) return segmentProblem;
  const approval = voiceScriptApprovalProblem(script, today);
  if (approval) return approval;
  if (v.scriptVersion !== script.version || v.scriptDigest !== VOICE_SCRIPT_DIGEST) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_VERSION_MISMATCH;
  const recordedApproval = plainRecord(v.scriptApproval, ['approvedBy', 'approvedOn']);
  if (!recordedApproval || recordedApproval.approvedBy !== script.approvedBy || recordedApproval.approvedOn !== script.approvedOn) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_NOT_APPROVED;
  if (!isSoaLanguage(v.language) || !languageWasElected(v.languageSource)) return VOICE_SOA_PROBLEM.SOA_LANGUAGE_NOT_ELECTED;
  if (v.representativeRelationship !== null && typeof v.representativeRelationship !== 'string') return VOICE_SOA_PROBLEM.SOA_LANGUAGE_NOT_ELECTED;
  const attribution = electionAttributionError(v.languageSource, v.representativeRelationship);
  if (attribution) return attribution;
  if (JSON.stringify(v.scriptLines) !== JSON.stringify(assembleVoiceScript(v.language, script))) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_VERSION_MISMATCH;
  const decisions = plainList(v.decisions);
  if (!decisions) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE;
  const capture = captureCategoryDecisions(decisions.map((d) => {
    const r = plainRecord(d, ['code', 'reply', 'replyClass', 'decision', 'problem']);
    return r ? { code: r.code, reply: r.reply } : null;
  }));
  if (!capture.ok) return capture.reason;
  if (capture.outcome !== VOICE_CAPTURE_OUTCOME.AUTHORIZED) return VOICE_SOA_PROBLEM.SOA_INCOMPLETE;
  if (JSON.stringify(capture.decisions) !== JSON.stringify(decisions)) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE;
  const selected = plainList(v.selectedCategories);
  const declined = plainList(v.declinedCategories);
  if (!selected || !declined || !sameSet(selected, capture.selectedCategories) || !sameSet(declined, capture.declinedCategories)) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE;
  const rb = plainRecord(v.readBack, ['items', 'confirmReply', 'confirmReplyClass']);
  if (!rb || rb.confirmReplyClass !== CONSENT_STATUS.GRANTED) return VOICE_SOA_PROBLEM.READ_BACK_NOT_CONFIRMED;
  const rbProblem = readBackProblem(capture, { items: rb.items, confirmReply: rb.confirmReply });
  if (rbProblem) return rbProblem;
  return null;
}

/**
 * The voice block and the instance it evidences must agree on everything they
 * both state: the method, the language and its election, the representative,
 * the script version and the scope. Null when they do; otherwise the reason.
 */
export function voiceInstanceContradiction(instance, voice) {
  if (!instance || typeof instance !== 'object') return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_CONTRADICTS_INSTANCE;
  if (instance.method !== SOA_METHOD.VOICE_RECORDED.code) return VOICE_SOA_PROBLEM.NOT_A_VOICE_INSTANCE;
  const v = plainRecord(voice, VOICE_EVIDENCE_KEYS);
  if (!v) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_INCOMPLETE;
  if (instance.language !== v.language || instance.languageSource !== v.languageSource) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_CONTRADICTS_INSTANCE;
  const instRep = typeof instance.representativeRelationship === 'string' && instance.representativeRelationship.trim() ? instance.representativeRelationship.trim() : null;
  if (instRep !== v.representativeRelationship) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_CONTRADICTS_INSTANCE;
  if (instance.scriptVersion !== v.scriptVersion) return VOICE_SOA_PROBLEM.VOICE_SCRIPT_VERSION_MISMATCH;
  const authorized = plainList(instance.authorizedCategories);
  const declined = plainList(instance.declinedCategories);
  const selected = plainList(v.selectedCategories);
  const vDeclined = plainList(v.declinedCategories);
  if (!authorized || !declined || !selected || !vDeclined) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_CONTRADICTS_INSTANCE;
  if (!sameSet(authorized, selected) || !sameSet(declined, vDeclined)) return VOICE_SOA_PROBLEM.VOICE_EVIDENCE_CONTRADICTS_INSTANCE;
  return null;
}

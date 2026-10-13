// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — LEAD DATA-QUALITY FACTS (spec §12). Environment-neutral, no Node APIs.
//
// Three small, pure rules live here because both the browser and the server
// need them and neither may own a private copy:
//
//   1. Is this email at a known throwaway-inbox service?            (FTQ-11)
//   2. When do recorded inconsistencies add up to "a human should
//      check this data"?                                            (FTQ-15)
//   3. The retired fraud label, so free text a client sends cannot
//      carry it onto a person's record.                             (FTQ-15)
//
// What this module is NOT: a rejection rule, and not a judgement about a person.
// Spec §12: "Do not label 'fraudulent' without evidence." and "Uncertainty is
// not fraud. Suspicious or unverified requests are quarantined; people are not
// accused or penalized." Everything below can only ever ask for a REVIEW.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Disposable contact data ───────────────────────────────────────────────
// AUDIT 2026-10-04 (FTQ-11) — this list lived only in the browser
// (src/lib/validation.ts). A direct POST to api/submit-lead.js with a throwaway
// inbox therefore reached the CRM with no signal at all, and the
// DISPOSABLE_CONTACT_DATA entry in trust.js REVIEW_SIGNALS was never raised by
// anything. This is now the ONE list: the server derives the review signal from
// it, and the browser validator spreads it into its own reject list through
// src/lib/cy2027.ts, so the two cannot drift apart.
//
// Scope is deliberately narrow: throwaway-inbox SERVICES only. Placeholder
// (example.com), profanity and first-name domains stay in the browser's UX
// reject list — they are not "disposable contact data", and raising a trust
// signal for them would be an inference the spec does not license.
export const DISPOSABLE_EMAIL_DOMAINS = Object.freeze([
  'mailinator.com', 'tempmail.com', 'tempmail.org', 'temp-mail.org',
  '10minutemail.com', 'guerrillamail.com', 'guerrillamail.org',
  'sharklasers.com', 'yopmail.com', 'throwaway.email', 'dispostable.com',
  'maildrop.cc', 'trashmail.com', 'fakeinbox.com', 'getairmail.com',
  'trashmail.net', 'spamgourmet.com', 'spamgourmet.net', 'discard.email',
  'spamevader.com', 'throwam.com', 'spamex.com', 'tempr.email',
  'burnermail.io', 'inboxbear.com', 'mintemail.com', 'moakt.com',
]);

const DISPOSABLE_SET = new Set(DISPOSABLE_EMAIL_DOMAINS);

/**
 * The lower-cased domain of an address, or '' when the value is not exactly one
 * well-formed address. The shape test is the same RFC-lite one
 * api/submit-lead.js uses to decide whether it KEEPS an email, so a signal is
 * only ever derived from an address the server would also store.
 *
 * AUDIT 2026-10-04 (FTQ-11, red team) — that keep-test lets wrapper and
 * trailing characters through, and the domain used to be everything after the
 * last '@' verbatim: '<x@mailinator.com>' gave 'mailinator.com>', 'x@mailinator.com;'
 * gave 'mailinator.com;', ':25', '/path', '?x', a zero-width space — one stray
 * byte and the service was not recognised while the handler stored the address.
 * The domain is now the first run of hostname characters after the last '@',
 * with anything that cannot start a hostname skipped first. A domain in another
 * script never equals an entry of the ASCII list, so it still answers ''.
 */
export function emailDomain(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim().toLowerCase();
  if (!s || s.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  const host = /^[^a-z0-9]*([a-z0-9][a-z0-9.-]*)/.exec(s.slice(s.lastIndexOf('@') + 1));
  return host ? host[1].replace(/\.+$/, '') : '';
}

/**
 * True when the address is at a listed throwaway-inbox service, or at any
 * subdomain of one (those services accept mail on arbitrary subdomains).
 * A missing or unreadable address is `false`: §12 forbids penalising a person
 * who "lacks email", and an address that cannot be parsed is uncertainty, not
 * evidence. A bare TLD is never tested and a look-alike ("notmailinator.com",
 * "mailinator.com.example.org") is not a match.
 */
export function isDisposableEmail(value) {
  const domain = emailDomain(value);
  if (!domain) return false;
  const labels = domain.split('.');
  for (let i = 0; i <= labels.length - 2; i++) {
    if (DISPOSABLE_SET.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}

// ── 2. Inconsistency aggregation ─────────────────────────────────────────────
// AUDIT 2026-10-04 (FTQ-15) — the support bot set `probableFakeLead = true` on
// ANY recorded inconsistency, whatever its weight, and that boolean reached the
// CRM as the machine field and tag `probable_fake_lead`. A Florida resident who
// typed a real ZIP, or a caller whose answer the name validator did not
// recognise, was labelled a probable fake on that single fact.
//
// The rule is now explicit and lives in one place:
//   · every inconsistency is still RECORDED by the caller — nothing is hidden;
//   · only the kinds listed below may COUNT toward a review, and each kind
//     counts once (retyping the same field is struggling, not new evidence);
//   · a review is SUGGESTED only when the counted penalties reach the threshold.
//     One state/ZIP contradiction (50) reaches it alone — §12 names "impossible
//     state/ZIP combinations" as a review signal. One unrecognised name (30) or
//     one invalid phone (25) does not; the two together (55) do.
//
// Deliberately NOT in the list:
//   · zip_not_in_service_area — where a person lives is geography, not a doubt
//     about their data;
//   · recovery_* — frustration/confusion markers. §15 puts
//     STRUGGLED_WITH_QUESTIONS among the signals that may never influence
//     routing.
// An unknown kind does not count until it is added here on purpose — the same
// stance as trust.js assertSignalAllowed().
export const REVIEW_INCONSISTENCY_KINDS = Object.freeze(['zip_state_mismatch', 'name', 'phone']);

export const DATA_REVIEW_WEIGHT_THRESHOLD = 50;

/** 'zip_state_mismatch: zip 10001 → NY, user said FL' → 'zip_state_mismatch'; 'name_too_short' → 'name'. */
export function inconsistencyKind(reason) {
  const head = String(reason == null ? '' : reason).split(':')[0].trim();
  if (head.startsWith('name_')) return 'name';
  if (head.startsWith('phone_')) return 'phone';
  return head;
}

/**
 * Pure. Given what has counted so far and ONE new inconsistency, return the
 * next aggregate. Never mutates its input.
 *
 * @param {{ kinds?: readonly string[], weight?: number } | null | undefined} current
 * @param {string} reason   the engine's reason string
 * @param {number} penalty  the weight the caller gives this inconsistency
 * @returns {{ kinds: string[], weight: number, reviewSuggested: boolean }}
 */
export function aggregateInconsistency(current, reason, penalty) {
  const kinds = current && Array.isArray(current.kinds) ? current.kinds : [];
  const weight = current && Number.isFinite(current.weight) ? current.weight : 0;
  const kind = inconsistencyKind(reason);
  const add = Number.isFinite(penalty) && penalty > 0 ? penalty : 0;
  const counts = REVIEW_INCONSISTENCY_KINDS.includes(kind) && !kinds.includes(kind);
  const nextWeight = counts ? weight + add : weight;
  return {
    kinds: counts ? [...kinds, kind] : [...kinds],
    weight: nextWeight,
    reviewSuggested: nextWeight >= DATA_REVIEW_WEIGHT_THRESHOLD,
  };
}

// ── 3. The retired fraud label in free text ──────────────────────────────────
// AUDIT 2026-10-04 (FTQ-15) — the tag `probable_fake_lead` is refused by the
// lead handler, but the same client (a cached bundle, or a direct POST) also
// sends free text — lead_notes, the conversation summary, the client's quality
// flags — and the old bot wrote the machine line `probable_fake_lead: true`
// into exactly that text. Refusing the tag while writing the line is a rule
// enforced on one path and not its mirror. The label is de-labelled wherever
// client text is accepted, before the scorer reads it and before any note is
// written. Only the retired machine label is touched, in every separator and
// case spelling (`probable_fake_lead`, `Probable-Fake-Lead`, `probableFakeLead`,
// `probable fake lead`): a caller who REPORTS a scam, or an advisor's own
// prose about fraud, is never rewritten.
//
// AUDIT 2026-10-04 (FTQ-15, red team) — two spellings walked through:
//   · the label with a Cyrillic 'а' or with zero-width / soft-hyphen characters
//     between its letters, and with '.' or '/' between its words — the text is
//     read by advisors, who see the label whatever bytes spell it;
//   · the old note builder's Advisor-action line, "(low confidence or fake-lead
//     signal)" / "(baja confianza o señal de lead falso)" — the one piece of
//     retired prose a cached bundle still sends in lead_notes today.
// The pattern is built letter by letter: each letter also matches its
// cross-script look-alikes and its fullwidth form, invisible characters may sit
// between letters, and any run of non-letters (never a line break) may sit
// between words. The text itself is never folded: only the match is replaced,
// so every other byte — a Cyrillic name included — stays as written.
const LOOKALIKE_LETTERS = Object.freeze({
  a: 'аα', c: 'сϲ', d: 'ԁ', e: 'е', i: 'іιı',
  k: 'кκ', l: 'ӏ', o: 'оοօ', p: 'рρ', s: 'ѕ',
});
// Zero-width characters, the soft hyphen, joiners and combining marks: nothing printed.
const INVISIBLE = '[\\u00ad\\u034f\\u0300-\\u036f\\u180e\\u200b-\\u200d\\u2060-\\u2064\\ufeff]';
const INVISIBLE_RUN = new RegExp(INVISIBLE + '+', 'gu');
const LETTER_GAP = INVISIBLE + '*';
const WORD_GAP = '[^\\p{L}\\p{N}\\r\\n]*';
const fullwidth = (ch) => (ch >= 'a' && ch <= 'z' ? String.fromCodePoint(0xff41 + ch.charCodeAt(0) - 0x61) : '');
const letterClass = (ch) => '[' + ch + (LOOKALIKE_LETTERS[ch] || '') + fullwidth(ch) + ']';
/** One word of the label, spelled so that look-alikes and invisible characters cannot hide it. */
const spelled = (word) => Array.from(word.toLowerCase(), letterClass).join(LETTER_GAP);
const phrase = (...words) => '(?:' + words.map(spelled).join(WORD_GAP) + ')';
const FAKE_LEAD_LABEL = new RegExp(
  [phrase('probable', 'fake', 'lead'), phrase('fake', 'lead', 'signal'), phrase('señal', 'de', 'lead', 'falso')].join('|'),
  'giu',
);

/** What the retired label is replaced with: a marker that is not a verdict. */
export const CLIENT_LABEL_REMOVED = '[client-label-removed]';

/**
 * Free text with every spelling of the retired label replaced by
 * CLIENT_LABEL_REMOVED. Non-strings become '' (the same contract as the
 * sibling neutralisers); the rest of the text is untouched.
 */
export function neutralizeFakeLeadLabel(text) {
  if (typeof text !== 'string') return '';
  if (!text) return text;
  return text.replace(FAKE_LEAD_LABEL, CLIENT_LABEL_REMOVED);
}

// ── 4. A client-asserted verdict about the person, as a tag ──────────────────
// AUDIT 2026-10-04 (FTQ-15, red team) — the lead handler refused the retired
// label as a tag with a deny-regex anchored ^…$ on the flattened key and a
// fixed list of spellings. Any affix ('probable_fake_lead_true', 'fakelead2',
// 'is_fake_lead') and any other verdict word ('scammer', 'junk_lead',
// 'suspicious_caller', 'not_real_person', 'fraud_risk_high') went straight to
// the CRM — a deny-list of exact tokens where the rule is a SHAPE.
//
// The rule now lives here, once, as a pure function, and says what a verdict
// looks like rather than how it is spelled:
//   · a qualifier + a verdict adjective            probable-fake, likely-scam, is-fake
//   · a verdict adjective + the person/submission  fake-lead, spam-caller, bot-lead
//     (or the reverse)                             lead-fake
//   · a noun that IS the verdict                   scammer, fraudster, liar
//   · "not real / not a person"                    not-real-person, non-genuine
//   · a verdict adjective + an assessment          fraud-risk, scam-score, bot-detected
//   · the retired label itself, or the marker that replaced it in free text
// Each shape is matched as a CONTAINED token sequence of the normalised key, so
// an affix cannot hide it; the short words that are substrings of ordinary
// words (is, not, liar, faker) count only as whole tokens.
//
// What still flows, on purpose: a TOPIC is not that shape. The support bot's
// own vocabulary — category_fraud_scam, fraud_alert, fraud_scam,
// customer_service_bot, data_review_suggested, confidence_low — names what the
// person asked ABOUT or what the bot did, and none of it pairs a verdict word
// with the person. The trade-off is explicit: a descriptive tag that happens to
// read as a verdict ('reports_scam_caller') is dropped and counted; the text it
// came from still reaches the note, and a dropped tag can be re-read by a
// human, while a verdict on a record cannot be unsaid (§12).
export const VERDICT_TAG_VOCABULARY = Object.freeze({
  qualifiers: Object.freeze(['probable', 'probably', 'likely', 'unlikely', 'possible', 'possibly', 'suspected', 'suspect',
    'potential', 'potentially', 'confirmed', 'definite', 'definitely', 'obvious', 'obviously', 'clearly', 'highly',
    'maybe', 'perhaps', 'known', 'flagged', 'detected', 'looks', 'seems', 'appears']),
  shortQualifiers: Object.freeze(['is', 'isa', 'not', 'nota', 'non', 'very', 'so', 'total', 'totally']),
  adjectives: Object.freeze(['fake', 'faked', 'fraud', 'frauds', 'fraudulent', 'bogus', 'spam', 'spammy', 'scam', 'scammy',
    'phony', 'phoney', 'junk', 'garbage', 'trash', 'worthless', 'sham', 'hoax', 'fictitious', 'fictional', 'dishonest',
    'suspicious', 'illegitimate', 'untrustworthy', 'bot', 'robot', 'troll', 'prank', 'joke', 'malicious', 'abusive']),
  subjects: Object.freeze(['lead', 'leads', 'client', 'clients', 'customer', 'customers', 'caller', 'callers', 'contact',
    'contacts', 'person', 'people', 'user', 'users', 'submission', 'submissions', 'prospect', 'prospects', 'applicant',
    'applicants', 'visitor', 'visitors', 'account', 'profile', 'identity', 'individual', 'senior', 'beneficiary',
    'patient', 'member', 'enrollee', 'inquiry', 'request', 'form', 'entry', 'record', 'signup', 'registration']),
  personNouns: Object.freeze(['scammer', 'scammers', 'fraudster', 'fraudsters', 'spammer', 'spammers', 'impostor',
    'impostors', 'imposter', 'imposters', 'timewaster', 'timewasters', 'swindler', 'swindlers', 'grifter', 'grifters',
    'conartist', 'conman', 'scamster', 'trickster', 'cheater', 'cheaters', 'deceiver', 'defrauder']),
  shortPersonNouns: Object.freeze(['liar', 'liars', 'faker', 'fakers', 'crook', 'crooks', 'cheat', 'cheats']),
  negators: Object.freeze(['not', 'nota', 'non', 'isnt', 'isnot', 'never', 'false']),
  genuine: Object.freeze(['real', 'genuine', 'legit', 'legitimate', 'human', 'authentic', 'honest', 'trustworthy',
    'person', 'identity']),
  assessments: Object.freeze(['risk', 'risks', 'risky', 'score', 'scores', 'scoring', 'probability', 'likelihood',
    'rating', 'ratings', 'level', 'index', 'verdict', 'assessment', 'detected', 'detection', 'flag', 'flagged', 'flags',
    'suspected', 'confirmed', 'indicator', 'indicators', 'signal', 'signals', 'likely', 'probable', 'yes', 'true',
    'positive', 'high', 'medium', 'low']),
});

/** Why a tag was refused. Codes only — a refusal line never carries the tag. */
export const TAG_REFUSAL_REASONS = Object.freeze({
  RETIRED_LABEL: 'RETIRED_LABEL',
  NEUTRALISED_MARKER: 'NEUTRALISED_MARKER',
  QUALIFIED_VERDICT: 'QUALIFIED_VERDICT',
  VERDICT_ON_SUBJECT: 'VERDICT_ON_SUBJECT',
  PERSON_NOUN: 'PERSON_NOUN',
  NEGATED_GENUINE: 'NEGATED_GENUINE',
  VERDICT_ASSESSMENT: 'VERDICT_ASSESSMENT',
});

const LOOKALIKE_TO_LATIN = (() => {
  const map = {};
  for (const [latin, others] of Object.entries(LOOKALIKE_LETTERS)) for (const ch of others) map[ch] = latin;
  return Object.freeze(map);
})();
const LOOKALIKE_RE = new RegExp('[' + Object.keys(LOOKALIKE_TO_LATIN).join('') + ']', 'gu');

/**
 * The key a tag is judged by: look-alike letters folded to Latin, accents and
 * invisible characters removed, lower-cased, every run of anything else one
 * dash. 'Probable-Fake-Lead', 'probable_fake_lead', 'probable fake lead' and
 * 'probаble fаke leаd' (Cyrillic а) are all 'probable-fake-lead'.
 */
export function normalizeTagKey(tag) {
  if (typeof tag !== 'string') return '';
  return tag.normalize('NFKD')
    .replace(LOOKALIKE_RE, (c) => LOOKALIKE_TO_LATIN[c])
    .replace(INVISIBLE_RUN, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const alt = (words) => '(?:' + words.join('|') + ')';
const V = VERDICT_TAG_VOCABULARY;
const Q = alt(V.qualifiers), SQ = alt(V.shortQualifiers), A = alt(V.adjectives), S = alt(V.subjects);
const P = alt(V.personNouns), SP = alt(V.shortPersonNouns), N = alt(V.negators), G = alt(V.genuine), M = alt(V.assessments);
const START = '(?:^|-)';
const END = '(?=-|$|[0-9])';
const VERDICT_SHAPES = Object.freeze([
  Object.freeze([TAG_REFUSAL_REASONS.RETIRED_LABEL, new RegExp('probable-?fake-?leads?')]),
  Object.freeze([TAG_REFUSAL_REASONS.NEUTRALISED_MARKER, new RegExp(START + 'client-label-removed' + END)]),
  Object.freeze([TAG_REFUSAL_REASONS.QUALIFIED_VERDICT, new RegExp(Q + '-?' + A)]),
  Object.freeze([TAG_REFUSAL_REASONS.QUALIFIED_VERDICT, new RegExp(START + SQ + '-' + A + END)]),
  Object.freeze([TAG_REFUSAL_REASONS.VERDICT_ON_SUBJECT, new RegExp(A + '-?' + S + END)]),
  Object.freeze([TAG_REFUSAL_REASONS.VERDICT_ON_SUBJECT, new RegExp(START + S + '-?' + A + END)]),
  Object.freeze([TAG_REFUSAL_REASONS.PERSON_NOUN, new RegExp(P)]),
  Object.freeze([TAG_REFUSAL_REASONS.PERSON_NOUN, new RegExp(START + SP + END)]),
  Object.freeze([TAG_REFUSAL_REASONS.NEGATED_GENUINE, new RegExp(START + N + '-?(?:a-)?' + G + END)]),
  Object.freeze([TAG_REFUSAL_REASONS.VERDICT_ASSESSMENT, new RegExp(A + '-?' + M + END)]),
]);

/**
 * Pure. The reason a client-supplied (or client-derived) tag is a verdict about
 * the person and may not reach the CRM, or `null` when it may. Judged on
 * normalizeTagKey(tag); a non-string is `null` — the caller's charset gate, not
 * this rule, decides what a malformed tag is.
 */
export function clientTagRefusal(tag) {
  const key = normalizeTagKey(tag);
  if (!key) return null;
  for (const [reason, shape] of VERDICT_SHAPES) if (shape.test(key)) return reason;
  return null;
}

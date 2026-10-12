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
 */
export function emailDomain(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim().toLowerCase();
  if (!s || s.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '';
  return s.slice(s.lastIndexOf('@') + 1).replace(/\.+$/, '');
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
// prose about fraud, is never rewritten. Homoglyph spellings are not folded
// here — nothing machine-keyed reads this text, and the tag path (the one that
// is) already folds confusables before the deny-list is consulted.
const FAKE_LEAD_LABEL = /probable[\s_-]*fake[\s_-]*lead/gi;

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

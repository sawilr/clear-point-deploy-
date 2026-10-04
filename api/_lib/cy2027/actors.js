// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — WHO MAY DECIDE. Environment-neutral, no imports.
//
// Three rules in the spec turn on the same question, "was this a person?":
//   §13  "No AI self-approval of quarantined cases."
//   §22  "No AI self-promotion of a new ruleset."
//   §23  "Candidate learning -> human/compliance review -> … -> approval."
//
// The check first lived inline in trust.js (resolveSecurityReview). A second
// copy for rulesets and a third for learning would drift, and the red team has
// already shown what one loose copy costs (CT-02: an exact list of four words
// let "AI-Agent", "svc_bot" and "claude" approve a quarantine). So there is one
// implementation, here, and every human-only decision calls it.
//
// WHAT THIS CAN AND CANNOT PROVE: it refuses identities that LOOK automated and
// identities that carry no letters. It cannot prove a string names a real
// person — nothing in code can. It makes an automated approval impossible to
// record by accident and visible when recorded on purpose; the accountability
// is the name written into the record.
// ─────────────────────────────────────────────────────────────────────────────

/** Any token that marks an automated identity, anywhere in the actor string. */
const AUTOMATION_TOKEN_RE =
  /(^|[^a-z])(ai|bot|svc|service|system|sys|automation|auto|agent|robot|daemon|cron|job|worker|script|workflow|assistant|claude|gpt|llm|machine|api)([^a-z]|$)/i;

/**
 * Why `actor` cannot be recorded as the human who decided — or null if it can.
 *   ACTOR_MISSING    nothing usable was supplied (empty, non-string, whitespace)
 *   ACTOR_NOT_HUMAN  looks automated, or contains no letters at all
 */
export function humanActorProblem(actor) {
  if (typeof actor !== 'string') return 'ACTOR_MISSING';
  const who = actor.trim();
  if (!who) return 'ACTOR_MISSING';
  if (AUTOMATION_TOKEN_RE.test(who) || /^[^a-z]*$/i.test(who)) return 'ACTOR_NOT_HUMAN';
  return null;
}

/** True only for an actor that may be recorded as a human decision-maker. */
export function isHumanActor(actor) {
  return humanActorProblem(actor) === null;
}

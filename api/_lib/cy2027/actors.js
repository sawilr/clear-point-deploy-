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
// AUDIT 2026-10-04 (red team, SPEC-22/SPEC-23). That one implementation was a
// deny-list of tokens, and it let the assistants themselves decide: 'Sofía',
// 'Emely', 'Clara', 'Zara', 'ChatGPT', 'Copilot', 'Gemini', 'chatbot' and 'IA'
// all passed, and a candidate walked to DEPLOYMENT signed only by 'Sofía'. It
// also refused real people whose names are not written in Latin letters. Two
// separate questions are now answered separately:
//
//   1. humanActorProblem(actor)  — does this identity LOOK like a person?
//      Still a pattern, now Unicode-aware, with the system's own assistants and
//      the common AI products added. It can only ever refuse the obvious.
//   2. reviewerProblem(actor)    — is this one of the people the owner has
//      authorised to decide? An ALLOW-list, read from CY2027_REVIEWERS. Every
//      human-only decision goes through this one, and with no list configured
//      it refuses everybody: nobody may decide until the owner says who may.
//
// The list lives in the environment, not in the repository, on purpose: the
// names of the people who may approve are then not something code — or an agent
// writing code — can read and copy into a record.
//
// WHAT THIS CAN AND CANNOT PROVE: it cannot prove a string was typed by the
// person it names — nothing in code can. It makes an automated approval
// impossible to record by accident, limits who can be named at all, and leaves
// the name in the record as the accountability.
// ─────────────────────────────────────────────────────────────────────────────

/** Any token that marks an automated identity, anywhere in the actor string. */
const AUTOMATION_TOKEN_RE =
  /(^|[^\p{L}])(ai|ia|bot|chatbot|svc|service|system|sys|automation|auto|agent|robot|daemon|cron|job|worker|script|workflow|webhook|zapier|assistant|asistente|claude|anthropic|gpt|chatgpt|openai|copilot|gemini|llm|machine|api|hermes|openclaw)([^\p{L}]|$)/iu;

/**
 * The system's own assistants. Refused when the identity IS one of them (with
 * or without the accent) — not when a person's full name happens to contain
 * one: "Clara" is the web assistant, "Clara Gómez" is somebody's name.
 */
const OWN_ASSISTANTS = Object.freeze(['emely', 'sofia', 'clara', 'zara']);

const fold = (value) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const unaccented = (value) => value.normalize('NFD').replace(/\p{M}/gu, '');

/**
 * Why `actor` cannot be recorded as the human who decided — or null if it can.
 *   ACTOR_MISSING    nothing usable was supplied (empty, non-string, whitespace)
 *   ACTOR_NOT_HUMAN  looks automated, is one of the assistants, contains no
 *                    letters at all, or hides characters that are not text
 */
export function humanActorProblem(actor) {
  if (typeof actor !== 'string') return 'ACTOR_MISSING';
  if (!actor.trim()) return 'ACTOR_MISSING';
  // Control and format characters (zero-width joiners, direction overrides) are
  // how a name with an invisible character in the middle gets past a token list. A name does not need them.
  if (/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u.test(actor)) return 'ACTOR_NOT_HUMAN';
  const who = fold(actor);
  if (!/\p{L}/u.test(who)) return 'ACTOR_NOT_HUMAN';
  if (AUTOMATION_TOKEN_RE.test(who)) return 'ACTOR_NOT_HUMAN';
  if (OWN_ASSISTANTS.includes(unaccented(who))) return 'ACTOR_NOT_HUMAN';
  return null;
}

/** True only for an actor that may be recorded as a human decision-maker. */
export function isHumanActor(actor) {
  return humanActorProblem(actor) === null;
}

/** The environment variable that names the people who may decide, comma-separated. */
export const REVIEWERS_ENV = 'CY2027_REVIEWERS';

/** Longest identity that is still a name and not a paragraph. */
export const ACTOR_MAX_CHARS = 80;

/** The server's environment; an empty one in a browser, where nobody is authorised to decide anything. */
function runtimeEnv() {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

/**
 * The reviewers the owner has configured, folded for comparison. An entry that
 * does not itself look like a person is dropped: listing "claude" does not make
 * it a reviewer.
 */
export function configuredReviewers(env = runtimeEnv()) {
  const raw = env && typeof env === 'object' && Object.prototype.hasOwnProperty.call(env, REVIEWERS_ENV) ? env[REVIEWERS_ENV] : '';
  if (typeof raw !== 'string') return [];
  return raw.split(/[,;\n]/).filter((name) => humanActorProblem(name) === null).map(fold);
}

/**
 * Why `actor` may not be recorded as having made a human-only decision — or
 * null when they may.
 *   ACTOR_MISSING / ACTOR_NOT_HUMAN   see humanActorProblem
 *   REVIEWERS_NOT_CONFIGURED          the owner has not named anyone: fail-closed
 *   REVIEWER_NOT_AUTHORIZED           a person, but not one of the named ones
 */
export function reviewerProblem(actor, env = runtimeEnv()) {
  const problem = humanActorProblem(actor);
  if (problem) return problem;
  if (actor.length > ACTOR_MAX_CHARS) return 'ACTOR_NOT_HUMAN';
  const reviewers = configuredReviewers(env);
  if (!reviewers.length) return 'REVIEWERS_NOT_CONFIGURED';
  return reviewers.includes(fold(actor)) ? null : 'REVIEWER_NOT_AUTHORIZED';
}

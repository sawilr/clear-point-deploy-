// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — YEARLY READINESS (spec §22, Phase 12). SERVER / TOOLING ONLY.
//
// One pure function that answers, for any instant: what does the yearly engine
// need a person to do, and how urgent is it? scripts/cy2027-preflight.mjs prints
// its answer; the suite calls it with dates on both sides of a rollover.
//
// It is a function, not lines inside the preflight script, because the preflight
// script cannot be called with a different clock — and a rollover check that can
// only ever be run "today" is a check nobody has seen fail.
//
// BLOCK vs WARN:
//   block  promoting now would put something wrong in front of the public, or
//          the rollover is close enough that waiting is the mistake
//   warn   a gate is closed and waiting on a person; nothing wrong is served
// Nothing here switches the public site or lead capture off. The SOA/marketing
// workflow is what fails closed (resolveRuleset), and it says so by name.
// ─────────────────────────────────────────────────────────────────────────────

import { activePlanYear, resolveRuleset, rulesetInventory, rulesetForAudit, rolloverStatus } from './rulesets.js';
import { sourceReviewStatus, rulesetAttestation } from './ruleset-lifecycle.js';
import { STATE_RULESETS, isRegisteredStateRuleset } from './state-rules.js';
import { configuredReviewers, REVIEWERS_ENV } from './actors.js';
import { LATEST_TPMO_VARIANT_PLAN_YEAR } from './tpmo.js';

/** Inside this many days of a rollover with no ready ruleset, it stops being background information. */
export const ROLLOVER_BLOCK_WINDOW_DAYS = 120;

/**
 * @param {Date|string} now
 * @param {Record<string, string|undefined>} env
 * @param {{ rulesets?: object[], states?: object[] }} [inspect]  what to report on.
 *   Defaults to everything registered. It exists for the suite: no registered
 *   ruleset has an overdue source today, so without it that branch would only
 *   ever be read. It changes what is REPORTED, never what resolveRuleset allows.
 * @returns {{ blocks: string[], warns: string[], oks: string[] }}
 */
export function yearlyReadiness(now = new Date(), env = process.env, inspect = {}) {
  const rulesets = Array.isArray(inspect.rulesets)
    ? inspect.rulesets
    : rulesetInventory().map((r) => rulesetForAudit(r.planYear));
  const states = Array.isArray(inspect.states) ? inspect.states : Object.values(STATE_RULESETS);

  const blocks = [];
  const warns = [];
  const oks = [];

  const year = activePlanYear(now);
  if (!Number.isInteger(year)) {
    blocks.push('the plan-year clock could not be read — nothing about the yearly engine can be vouched for');
    return { blocks, warns, oks };
  }

  // 0. Who may decide. Every human-only decision (a quarantine review, a
  //    ruleset step, a learning step, a source verification) is refused until
  //    the owner has named the people who may make it.
  const reviewers = configuredReviewers(env);
  if (!reviewers.length) {
    warns.push(
      `no reviewer is configured (${REVIEWERS_ENV}) — every human-only decision is refused until the owner names who may decide`,
    );
  } else {
    oks.push(`${reviewers.length} authorised reviewer(s) configured`);
  }

  // 1. The public wording. It is never switched off, so a newer plan year must
  //    stop a promote instead: reuse is allowed to be necessary, never silent.
  if (year > LATEST_TPMO_VARIANT_PLAN_YEAR) {
    blocks.push(
      `plan year ${year} is in force but the newest TPMO wording on file is for CY${LATEST_TPMO_VARIANT_PLAN_YEAR} — ` +
        `confirm the CY${year} standardized sentence, add its variant, and raise LATEST_TPMO_VARIANT_PLAN_YEAR`,
    );
  }

  // 2. The SOA/marketing ruleset for the year in force.
  const active = resolveRuleset(null, now, env);
  if (!active.ok) {
    warns.push(
      `no ruleset can be resolved for plan year ${year} (${active.reason}) — the SOA/marketing workflow is locked; ` +
        'the public site and lead capture are unaffected',
    );
  } else if (active.attestation === 'ATTESTED') {
    oks.push(`${active.ruleset.version} is active and every lifecycle step is on record`);
  } else if (active.attestation === 'GRANDFATHERED_OWNER_ATTESTED') {
    oks.push(`${active.ruleset.version} is active and attested by the owner (it predates the lifecycle: no earlier step is on record)`);
  } else {
    warns.push(
      `${active.ruleset.version} is active with attestation ${active.attestation}: no named person is on record as ` +
        'having promoted it (spec §22 "No AI self-promotion of a new ruleset")',
    );
  }

  // 3. The state rulesets. Only the registered object can be grandfathered, so
  //    whether one is registered is established here, by identity.
  for (const s of states) {
    const a = rulesetAttestation(s, { registered: isRegisteredStateRuleset(s), now });
    if (a !== 'ATTESTED' && a !== 'GRANDFATHERED_OWNER_ATTESTED') warns.push(`state ruleset ${s.stateRulesetVersion}: attestation ${a}`);
  }

  // 4. Source reviews, for every ruleset that is or will be in use — CMS and state.
  for (const r of [...rulesets, ...states]) {
    if (!r || r.status === 'SUPERSEDED') continue;
    const label = r.version || r.stateRulesetVersion;
    const sr = sourceReviewStatus(r, now);
    if (sr.unreadable) {
      blocks.push(`${label}: source review overdue or unreadable — its source list cannot be read. The SOA/marketing workflow is locked until it is reviewed.`);
    }
    if (sr.overdue.length || sr.malformed.length) {
      blocks.push(
        `${label}: source review overdue or unreadable — ${[...new Set([...sr.overdue, ...sr.malformed])].join('; ')}. ` +
          'The SOA/marketing workflow is locked until it is reviewed.',
      );
    }
    if (sr.unverified.length) {
      warns.push(`${label}: ${sr.unverified.length} required source(s) have no verification on record — ${sr.unverified.join('; ')}`);
    }
  }

  // 5. The rollover itself.
  const roll = rolloverStatus(now);
  if (!roll.ok) {
    blocks.push('the plan-year clock could not be read');
  } else if (!roll.nextRulesetReady) {
    const msg =
      `CY${roll.nextPlanYear} marketing opens ${roll.nextMarketingStart.slice(0, 10)} (${roll.daysUntilRollover} day(s)); ` +
      `its ruleset is ${roll.nextRulesetStatus}${roll.nextRulesetVersion ? ' (' + roll.nextRulesetVersion + ')' : ''}. ` +
      'On that day the SOA/marketing workflow fails closed until a person has promoted it';
    if (roll.daysUntilRollover <= ROLLOVER_BLOCK_WINDOW_DAYS) blocks.push(`${msg} — prepare the CY${roll.nextPlanYear} ruleset now`);
    else warns.push(msg);
  } else {
    oks.push(`CY${roll.nextPlanYear} ruleset ${roll.nextRulesetVersion} is ready for ${roll.nextMarketingStart.slice(0, 10)}`);
  }

  return { blocks, warns, oks };
}

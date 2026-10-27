// ─────────────────────────────────────────────────────────────────────────────
// CY2027 compliance layer — CLIENT BARREL.
//
// This file re-exports the canonical modules under api/_lib/cy2027/ instead of
// restating their contents. That is deliberate and is the fix for a documented
// defect: before CY2027 the TPMO disclaimer existed in three divergent copies
// (src/lib/tpmoConfig.ts, src/lib/soaContent.ts, api/sign-soa.js) and
// SOA_ENABLED in four, because api/*.js cannot import from src/. Rather than
// add a fifth copy, the client reaches into the canonical source, and
// scripts/check-cy2027-parity.mjs fails the build if a copy ever reappears.
//
// Only the environment-neutral, client-relevant surface is re-exported.
// Consent, trust, retention, carrier overlays and evidence are server concerns
// and are intentionally NOT available to the browser bundle — in particular the
// carrier overlay registry, which the public layer must never reach (spec §16).
// ─────────────────────────────────────────────────────────────────────────────

export {
  SOA_PLAN_YEAR,
  SOA_SCRIPT_VERSION,
  SOA_CATEGORIES,
  AUTHORIZING_CATEGORY_CODES,
  ALL_CATEGORY_CODES,
  APPOINTMENT_FORMATS,
  SOA_TEXT,
  SOA_AGENT_LINE,
  FORBIDDEN_BARE_ACRONYMS,
  categoryByCode,
  categoryText,
  soaTitle,
  readBackLines,
} from '../../api/_lib/cy2027/soa-text.js';

export type {
  SoaLang,
  SoaCategory,
  SoaCategoryCode,
  SoaCategoryText,
  SoaTextBlock,
  AppointmentFormat,
} from '../../api/_lib/cy2027/soa-text.js';

export {
  STATE_RULESETS,
  SUPPORTED_STATES,
  resolveStateRuleset,
  soaFormRules,
  zipStateConsistency,
  resolveCounty,
} from '../../api/_lib/cy2027/state-rules.js';

export type { SupportedState, StateRuleset, StateResolution, CountyResolution } from '../../api/_lib/cy2027/state-rules.js';

export {
  SOA_STATUS,
  SOA_METHOD,
  LANGUAGE_SOURCE,
  languageWasElected,
  languageElectionLabel,
  methodIsWritten,
  partitionSelection,
  marketingGate,
  requiresNewInstance,
  coversCategory,
  // AUDIT 2026-10-04 (SPEC-31) — the one rule for what a jurisdiction change
  // does to the acknowledgements and the typed signature; the form calls it.
  affirmationsAfterContextChange,
} from '../../api/_lib/cy2027/soa-instance.js';

export type {
  SoaInstance, SoaStatus, SoaMethodCode, SoaAppointment, GateDecision, LanguageSourceCode, SoaAffirmations,
} from '../../api/_lib/cy2027/soa-instance.js';

export { activePlanYear, CY2027_MARKETING_START_UTC } from '../../api/_lib/cy2027/rulesets.js';

// AUDIT 2026-10-04 (FTQ-11 / FTQ-15) — lead data-quality facts have one source.
// The browser validator rejects the throwaway-inbox list at the form and the
// server raises DISPOSABLE_CONTACT_DATA for the same list; the support bot
// decides "a human should check this data" with the same aggregation rule the
// test suite pins, instead of a private boolean.
export {
  DISPOSABLE_EMAIL_DOMAINS,
  REVIEW_INCONSISTENCY_KINDS,
  aggregateInconsistency,
} from '../../api/_lib/cy2027/data-quality.js';

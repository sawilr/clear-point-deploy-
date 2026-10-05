// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — CRM FIELD MAPPING (spec §18). SERVER ONLY.
//
// "Search for existing equivalent fields before creating new ones. Never
//  duplicate fields with slightly different names."
// "CRM is the operational index; evidence must remain retrievable and
//  tamper-evident in an approved storage architecture." (§19)
//
// ─── THE PROBLEM THIS MAKES VISIBLE ──────────────────────────────────────────
// GoHighLevel addresses a custom field by its OPAQUE ID, not by its name.
// api/submit-lead.js does this correctly:
//     { id: 'QULAmkAuVNCQrAMZ487K', key: 'contact.preferred_language', … }
// api/sign-soa.js does not:
//     { id: 'soa_pdf_hash', field_value: … }
// 'soa_pdf_hash' is a NAME being passed where an ID belongs, so those writes do
// not land on a custom field. Every SOA field — including the CY2027 ones —
// inherits that. The Phase 0 audit recorded the same gap as CRM-27 ("SOA fields
// are actually written to real CRM fields").
//
// Creating the fields is a change inside the GoHighLevel sub-account, which is
// an owner action, not something this code may do on its own. So instead of
// pretending, this module:
//   1. names every field the spec requires, once;
//   2. reads the real IDs from CY2027_CRM_FIELD_IDS when the owner supplies them;
//   3. reports exactly which fields could NOT be written, so the caller logs a
//      visible gap instead of a silent no-op;
//   4. leaves the full record in the structured note, which does work today, so
//      nothing is lost while the fields are missing.
// ─────────────────────────────────────────────────────────────────────────────

import { languageWasElected } from './soa-instance.js';
import { CONSENT_STATUS, isStatedConsentScope, isRecordableInstant } from './consent.js';

/**
 * The CY2027 additions from spec §18, with the CRM key each one should use.
 * Keys follow the existing `contact.<snake_case>` convention in submit-lead.js
 * so a new field is created consistently rather than in a third style.
 */
export const CY2027_FIELD_KEYS = Object.freeze({
  SOA_ID: 'contact.soa_id',
  SOA_APPOINTMENT_ID: 'contact.soa_appointment_id',
  SOA_PLAN_YEAR: 'contact.soa_plan_year',
  SOA_STATUS: 'contact.soa_status',
  SOA_METHOD: 'contact.soa_method',
  SOA_LANGUAGE: 'contact.soa_language',
  SOA_LANGUAGE_SOURCE: 'contact.soa_language_source',
  SOA_STATE: 'contact.soa_state',
  SOA_ZIP: 'contact.soa_zip',
  SOA_COUNTY: 'contact.soa_county',
  SOA_AUTHORIZED_CATEGORIES: 'contact.soa_authorized_categories',
  SOA_DECLINED_CATEGORIES: 'contact.soa_declined_categories',
  SOA_FORM_VERSION: 'contact.soa_form_version',
  SOA_SCRIPT_VERSION: 'contact.soa_script_version',
  SOA_COMPLETED_AT: 'contact.soa_completed_at',
  SOA_SUPERSEDES_ID: 'contact.soa_supersedes_id',
  SOA_REVOKED_AT: 'contact.soa_revoked_at',
  SOA_EVIDENCE_URI: 'contact.soa_evidence_uri',
  SOA_INTEGRITY_HASH: 'contact.soa_integrity_hash',
  RECORDING_NOTICE_STATUS: 'contact.recording_notice_status',
  CALLBACK_CONSENT_STATUS: 'contact.callback_consent_status',
  CALLBACK_CONSENT_AT: 'contact.callback_consent_at',
  CALLBACK_CONSENT_SCOPE: 'contact.callback_consent_scope',
  AI_OUTBOUND_CONSENT_STATUS: 'contact.ai_outbound_consent_status',
  RESIDENCE_STATE: 'contact.residence_state',
  STATE_RULESET_VERSION: 'contact.state_ruleset_version',
  // AUDIT 2026-10-04 (SPEC-22) — spec §22: every SOA points to the exact ruleset
  // version it was signed under. New key: it is reported as unmapped until the
  // owner creates the field in GoHighLevel and adds its id to CY2027_CRM_FIELD_IDS.
  CMS_RULESET_VERSION: 'contact.cms_ruleset_version',
  LEAD_TRUST_STATE: 'contact.lead_trust_state',
  CHANNEL_VERIFICATION_STATUS: 'contact.channel_verification_status',
  HUMAN_SECURITY_REVIEW_STATUS: 'contact.human_security_review_status',
  CARRIER_OVERLAY_STATUS: 'contact.carrier_overlay_status',
  LICENSED_AGENT_REVIEW_REQUIRED: 'contact.licensed_agent_review_required',
  DATA_SENSITIVITY_CLASS: 'contact.data_sensitivity_class',
  RETENTION_CLASS: 'contact.retention_class',
  // AUDIT 2026-10-04 (DM-04) — spec §14: "Self-reported Medicaid/LIS values are
  // stored as SELF_REPORTED, never as eligibility determinations." Two fields
  // whose KEY says self-reported, so the provenance survives an export, a smart
  // list or a workflow filter that shows the value without its history. They are
  // not in the §18 list — §14 is what requires them — and no existing field is
  // equivalent: contact.medicare_status is Medicare COVERAGE, not a Medicaid /
  // Extra Help answer. Reported as unmapped until the owner creates them.
  SELF_REPORTED_MEDICAID_STATUS: 'contact.self_reported_medicaid_status',
  SELF_REPORTED_LIS_STATUS: 'contact.self_reported_lis_status',
});

/**
 * Real GoHighLevel field IDs, supplied by the owner as JSON in
 * CY2027_CRM_FIELD_IDS, e.g.
 *   {"SOA_PLAN_YEAR":"abc123...","SOA_STATE":"def456..."}
 * Unknown or malformed content yields an empty map rather than throwing: a
 * misconfigured env var must not take down a signing request that is otherwise
 * valid — it must make the gap visible instead.
 */
export function fieldIdMap(env = process.env) {
  const raw = (env.CY2027_CRM_FIELD_IDS || '').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim() && Object.prototype.hasOwnProperty.call(CY2027_FIELD_KEYS, k)) {
        out[k] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Build the customFields array for a GoHighLevel upsert.
 *
 * @returns {{ fields: Array, unmapped: string[], mapped: number }}
 *   `fields`   — only entries with a REAL id, safe to send.
 *   `unmapped` — names the owner still has to create. Log this; it is the gap.
 *
 * Values are stringified and empty ones dropped, because writing '' over a
 * previously confirmed value would be the "overwrite confirmed data" the spec
 * forbids (§18: "Do not overwrite confirmed data with AI inference").
 */
/**
 * Fields whose value the BENEFICIARY stated. Spec §18: "Do not overwrite
 * confirmed data with AI inference."
 *
 * AUDIT 2026-10-02 (CRM-28) — that rule lived only in a comment. It is now
 * enforceable in the data: a value may declare its provenance, and an inferred
 * one is REFUSED for these fields rather than written. A model that decides the
 * caller "probably lives in New Jersey" must not be able to overwrite the state
 * they typed, because the state selects the ruleset printed on a signed document.
 */
export const CONFIRMED_ONLY_FIELDS = Object.freeze([
  'SOA_STATE', 'SOA_ZIP', 'SOA_COUNTY', 'RESIDENCE_STATE',
  'SOA_LANGUAGE', 'SOA_LANGUAGE_SOURCE',
  'SOA_AUTHORIZED_CATEGORIES', 'SOA_DECLINED_CATEGORIES',
  'CALLBACK_CONSENT_STATUS', 'RECORDING_NOTICE_STATUS', 'AI_OUTBOUND_CONSENT_STATUS',
  // AUDIT 2026-10-02 (CE-09 / CRM-15) — the scope is "the scope actually stated"
  // (§24). The status was protected and the scope was not, so a model deciding
  // the caller "probably wants a plan review" could have widened what a consent
  // covers without touching whether it exists.
  'CALLBACK_CONSENT_SCOPE',
  // AUDIT 2026-10-04 (CE-09, red team) — and the WHEN. A timestamp declared
  // AI_INFERRED was written: an inferred instant on a consent is an invented one.
  'CALLBACK_CONSENT_AT',
]);

/**
 * AUDIT 2026-10-04 (CE-09 / CRM-15, red team) — THE CALLBACK CONSENT IS A UNIT.
 *
 * The first version of this fix applied "status, timestamp AND scope, or none"
 * only inside recordWebCallbackConsent(). Here, where the values actually leave,
 * a refused scope was dropped ALONE: GRANTED and its timestamp went out without
 * it ("granted, scope unknown" — the exact record the finding is about), a
 * status outside the vocabulary and a timestamp reading 'yesterday' were written
 * as given, and under a partial id map a revocation wrote a bare timestamp.
 * The rule is now enforced at the write stage, for every caller:
 *
 *   • the status is one of CONSENT_STATUS, exactly; the instant is a real UTC
 *     instant that is not in the future;
 *   • a refused status or instant takes the rest of the unit with it;
 *   • GRANTED is never sent without a stated scope AND its instant;
 *   • an instant is never sent without the status it dates;
 *   • a scope is never sent without the status it limits;
 *   • what the unit needs is sent whole or not at all: if one of the values it
 *     needs has no GoHighLevel id, the ones that do are WITHHELD (and named).
 *
 * A status other than GRANTED may travel without a scope (a revocation never
 * restates one) and without an instant (see recordCallbackRevocation()).
 *
 * AUDIT 2026-10-04 (CE-09 / CRM-15) — the unit rule covered the status and the
 * instant and left the SCOPE able to leave on its own: `{ CALLBACK_CONSENT_SCOPE }`
 * with no status was written, and under an id map that had only the scope's id a
 * REVOKED + instant + scope sent the scope ALONE (status and instant "unmapped").
 * A lone scope on a contact rewrites what an EARLIER grant is read as covering.
 * The scope now follows its status: no status accepted → the scope is refused;
 * the status not sent for want of an id → the scope is withheld with it. The
 * reverse stays as it was: a missing SCOPE id never holds back a revocation.
 */
const CALLBACK_UNIT = Object.freeze(['CALLBACK_CONSENT_STATUS', 'CALLBACK_CONSENT_AT', 'CALLBACK_CONSENT_SCOPE']);

/** The three §18 fields that carry a consent status, and so take only the §15 vocabulary. */
const CONSENT_STATUS_FIELDS = Object.freeze(['RECORDING_NOTICE_STATUS', 'CALLBACK_CONSENT_STATUS', 'AI_OUTBOUND_CONSENT_STATUS']);

/** Exactly one of the CONSENT_STATUS values — a string, matched as written. */
function isConsentStatus(value) {
  return typeof value === 'string' && Object.keys(CONSENT_STATUS).some((k) => CONSENT_STATUS[k] === value);
}

// AUDIT 2026-10-04 (DM-04) — SELF_REPORTED is its own class, not a synonym of
// BENEFICIARY_CONFIRMED. A person CONFIRMS facts they own (their state, their
// language). They can only REPORT what an agency decided about them (Medicaid,
// Extra Help), and that report must never read as the agency's determination.
// It is deliberately NOT in CONFIRMING_PROVENANCE below.
export const PROVENANCE = Object.freeze(['BENEFICIARY_CONFIRMED', 'SYSTEM', 'AI_INFERRED', 'SELF_REPORTED']);

/** The provenance a benefit-status value must declare, and the only fields that take it. */
export const SELF_REPORTED = 'SELF_REPORTED';
export const SELF_REPORTED_ONLY_FIELDS = Object.freeze(['SELF_REPORTED_MEDICAID_STATUS', 'SELF_REPORTED_LIS_STATUS']);

/**
 * The only values those fields can hold. There is deliberately no ELIGIBLE /
 * VERIFIED / true member: this layer cannot express a determination, so it
 * cannot store one by accident (spec §31: "Customer says Medicaid - store
 * self-reported, not eligible=true").
 */
export const SELF_REPORT_VALUE = Object.freeze({
  YES: 'SELF_REPORTED_YES',
  NO: 'SELF_REPORTED_NO',
  UNSURE: 'SELF_REPORTED_UNSURE',
});

/** Exactly one of the SELF_REPORT_VALUE values — a string, matched as written. */
export function isSelfReportValue(value) {
  return typeof value === 'string' && Object.keys(SELF_REPORT_VALUE).some((k) => SELF_REPORT_VALUE[k] === value);
}

/**
 * RED TEAM 2026-10-03 (G08/CRM-28) — the guard refused only the exact token
 * 'AI_INFERRED', so 'ai_inferred' and 'INFERRED_FROM_LEAD' (the layer's own word
 * for an inference) were both WRITTEN to a confirmed-only field. A deny-list of
 * one spelling is not a guard. A confirmed-only field now accepts an ALLOW-LIST
 * of provenances, matched exactly; everything else is refused and reported.
 */
export const CONFIRMING_PROVENANCE = Object.freeze(['BENEFICIARY_CONFIRMED', 'SYSTEM']);

/**
 * Build the customFields array for a GoHighLevel upsert.
 *
 * A value may be a plain scalar (treated as SYSTEM) or `{ value, source }`.
 *
 * @returns {{ fields, unmapped, refused, withheld, mapped }}
 *   `refused` — values rejected because an inference tried to overwrite a field
 *   only the beneficiary may set, because the value is not one the field may
 *   hold, or because the callback-consent unit it belongs to is not whole.
 *   Logged by the caller; never silently dropped.
 *   `withheld` — callback-consent values that are valid AND have an id, and were
 *   still not sent because another value of the same unit has no id yet.
 */
export function buildCustomFields(values, env = process.env) {
  const ids = fieldIdMap(env);
  const fields = [];
  const unmapped = [];
  const refused = [];
  const withheld = [];
  // Pass 1 — each value on its own. Nothing is emitted yet: whether a callback
  // value may leave depends on the other two.
  const accepted = [];
  for (const [name, raw] of Object.entries(values || {})) {
    if (!Object.prototype.hasOwnProperty.call(CY2027_FIELD_KEYS, name)) continue;
    const isWrapped = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw;
    const value = isWrapped ? raw.value : raw;
    // A wrapped value always declares its provenance; only a plain scalar is
    // treated as SYSTEM. (`raw.source ? … : 'SYSTEM'` promoted an empty or
    // falsy declared source to SYSTEM.)
    const source = isWrapped ? raw.source : 'SYSTEM';
    if (value === undefined || value === null || value === '') continue;
    if (CONFIRMED_ONLY_FIELDS.includes(name) && !CONFIRMING_PROVENANCE.includes(source)) {
      refused.push(name);
      continue;
    }
    // AUDIT 2026-10-04 (DM-04) — the self-reported class and its fields are
    // bound to each other, in BOTH directions, here where the value leaves:
    //   • a benefit-status field takes nothing but a value of the closed
    //     vocabulary that DECLARES itself SELF_REPORTED. A plain scalar (SYSTEM),
    //     an inference, a confirmation, 'ELIGIBLE', 'true', ['SELF_REPORTED_YES']
    //     or free text is refused and reported — never coerced to the nearest
    //     value;
    //   • a value declared SELF_REPORTED goes to no other field: a self-report
    //     written under a key that does not say so would read as a fact.
    if (SELF_REPORTED_ONLY_FIELDS.includes(name)
      ? !(source === SELF_REPORTED && isSelfReportValue(value))
      : source === SELF_REPORTED) {
      refused.push(name);
      continue;
    }
    // The stored election must itself be an election: 'SYSTEM_DEFAULT' written
    // beside SOA_LANGUAGE would state, in the CRM, a choice nobody made.
    if (name === 'SOA_LANGUAGE_SOURCE' && !languageWasElected(value)) {
      refused.push(name);
      continue;
    }
    // AUDIT 2026-10-02 (CE-09 / CRM-15) — the scope written is a scope some
    // registered consent wording STATES, or it is not written. The provenance
    // check above only sees a value that declares one; a plain string — from a
    // consent object assembled by hand, or read back from storage — would have
    // gone through as SYSTEM. This is the same rule webCallbackConsent() applies
    // when it builds the object, enforced again where the value leaves.
    if (name === 'CALLBACK_CONSENT_SCOPE' && !isStatedConsentScope(value)) {
      refused.push(name);
      continue;
    }
    // An allow-list, not "anything truthy": 'granted (assumed)' and ['GRANTED']
    // are not statuses.
    if (CONSENT_STATUS_FIELDS.includes(name) && !isConsentStatus(value)) {
      refused.push(name);
      continue;
    }
    if (name === 'CALLBACK_CONSENT_AT' && !isRecordableInstant(value)) {
      refused.push(name);
      continue;
    }
    accepted.push([name, value]);
  }

  // Pass 2 — the callback consent as a unit (see CALLBACK_UNIT above).
  const has = (n) => accepted.some(([k]) => k === n);
  const valueOf = (n) => (accepted.find(([k]) => k === n) || [])[1];
  const [STATUS, AT, SCOPE] = CALLBACK_UNIT;
  const notSent = [];
  const broken =
    refused.includes(STATUS) || refused.includes(AT) ||
    (has(STATUS) && valueOf(STATUS) === CONSENT_STATUS.GRANTED && !(has(AT) && has(SCOPE))) ||
    ((has(AT) || has(SCOPE)) && !has(STATUS));
  if (broken) {
    for (const n of CALLBACK_UNIT) {
      if (has(n)) { refused.push(n); notSent.push(n); }
    }
  } else if (has(STATUS)) {
    const needs = valueOf(STATUS) === CONSENT_STATUS.GRANTED ? [STATUS, AT, SCOPE] : (has(AT) ? [STATUS, AT] : [STATUS]);
    if (needs.some((n) => !ids[n])) {
      // A scope beside a status that is not GRANTED is not NEEDED (so a missing
      // scope id never blocks a revocation), but it does not leave without it.
      const held = has(SCOPE) && !needs.includes(SCOPE) ? [...needs, SCOPE] : needs;
      for (const n of held) {
        notSent.push(n);
        if (ids[n]) withheld.push(n); else unmapped.push(n);
      }
    }
  }

  // Pass 3 — what is left, with a real id or reported as unmapped.
  for (const [name, value] of accepted) {
    if (notSent.includes(name)) continue;
    const id = ids[name];
    if (!id) { unmapped.push(name); continue; }
    fields.push({ id, key: CY2027_FIELD_KEYS[name], field_value: String(value), value: String(value) });
  }
  return { fields, unmapped, refused, withheld, mapped: fields.length };
}

/** Flatten a completed SOA instance into the §18 field names. */
export function soaInstanceToFields(instance, extra = {}) {
  if (!instance) return {};
  return {
    SOA_ID: instance.soaId,
    SOA_APPOINTMENT_ID: instance.appointmentId,
    SOA_PLAN_YEAR: instance.planYear,
    SOA_STATUS: instance.status,
    SOA_METHOD: instance.method,
    SOA_LANGUAGE: instance.language,
    SOA_LANGUAGE_SOURCE: instance.languageSource,
    SOA_STATE: instance.state,
    SOA_ZIP: instance.zip,
    SOA_COUNTY: instance.county,
    SOA_AUTHORIZED_CATEGORIES: (instance.authorizedCategories || []).join(','),
    SOA_DECLINED_CATEGORIES: (instance.declinedCategories || []).join(','),
    SOA_FORM_VERSION: instance.soaFormVersion,
    SOA_SCRIPT_VERSION: instance.scriptVersion,
    SOA_COMPLETED_AT: instance.completedAt,
    SOA_SUPERSEDES_ID: instance.supersedesId,
    SOA_REVOKED_AT: instance.revokedAt,
    SOA_EVIDENCE_URI: instance.evidenceReference,
    SOA_INTEGRITY_HASH: instance.integrityHash,
    RESIDENCE_STATE: instance.state,
    STATE_RULESET_VERSION: instance.stateRulesetVersion,
    CMS_RULESET_VERSION: instance.cmsRulesetVersion,
    RETENTION_CLASS: 'SOA_EVIDENCE',
    ...extra,
  };
}

/**
 * Flatten the four consent objects into their §18 fields — status, timestamp
 * and scope as QUERYABLE values, not prose in a note (audit CRM-14/CRM-16).
 *
 * This only flattens. Whether the values may be WRITTEN is buildCustomFields()'
 * decision, and for a callback consent that decision is all-or-none.
 *
 * OPEN POINT, DECIDED FAIL-CLOSED (red team 2026-10-04) — the only scopes this
 * layer can write are the ones a REGISTERED wording states
 * (CONTACT_CONSENT_TEXT_VERSIONS, i.e. the web/chat text). The voice script's
 * scope ("regarding this request", Base Layer A) is not registered: no voice
 * script version, wording digest or scope code has been approved for it. So a
 * granted callback consent carrying that scope is refused WHOLE at the write
 * stage (status, timestamp and scope all named in `refused`) instead of being
 * written as "granted, scope unknown". No live endpoint writes a voice callback
 * consent today; registering a voice script version with its scope is an owner
 * decision that has to precede one.
 */
export function consentsToFields({ recordingNotice, callbackConsent, aiOutboundConsent } = {}) {
  // AUDIT 2026-10-04 (CE-09, red team) — the slot did not check the object put
  // in it: a granted SCOPE_OF_APPOINTMENT passed as `callbackConsent` was written
  // as CALLBACK_CONSENT_STATUS=GRANTED. That is the cross-inference this layer
  // exists to prevent (§6), arriving through the mapping instead of through
  // isAffirmative(). Each slot takes its own type and nothing else — and, like
  // assertNoCrossInference(), it throws rather than quietly dropping the value.
  const typed = (slot, consent, expected) => {
    if (consent === null || typeof consent !== 'object' || consent.type !== expected) {
      throw new Error(`crm-fields: ${slot} must be a ${expected} consent object`);
    }
  };
  const out = {};
  if (recordingNotice) {
    typed('recordingNotice', recordingNotice, 'RECORDING_NOTICE');
    out.RECORDING_NOTICE_STATUS = recordingNotice.status;
  }
  if (aiOutboundConsent) typed('aiOutboundConsent', aiOutboundConsent, 'AI_OUTBOUND_VOICE_CONSENT');
  if (callbackConsent) {
    typed('callbackConsent', callbackConsent, 'CALLBACK_CONTACT_PERMISSION');
    out.CALLBACK_CONSENT_STATUS = callbackConsent.status;
    out.CALLBACK_CONSENT_AT = callbackConsent.revokedAt || callbackConsent.at;
    out.CALLBACK_CONSENT_SCOPE = callbackConsent.scope;
  }
  if (aiOutboundConsent) out.AI_OUTBOUND_CONSENT_STATUS = aiOutboundConsent.status;
  return out;
}

/**
 * AUDIT 2026-10-02 (CE-09 / CRM-15) — the revocation side of the callback
 * consent, for api/opt-out.js. Spec §6: "Revocation must propagate to workflows
 * immediately" — the grant is now a queryable field, so the revocation has to
 * be one too, or a contact would read GRANTED beside a DND flag.
 *
 * SCOPE is deliberately absent. The opt-out endpoint matches a contact by
 * phone/email without authentication and never sees the consent it is
 * revoking, so restating a scope here would be inventing one. buildCustomFields()
 * drops absent values, so the scope recorded at grant time stays on the contact
 * as the record of WHAT was revoked.
 *
 * The timestamp is required, not defaulted: the caller writes the same instant
 * into the revocation note, and two clocks on one revocation is a discrepancy.
 * The result is frozen and carries exactly these two values, whatever else the
 * caller passed in.
 */
export function callbackRevocationToFields(input) {
  const at = input !== null && typeof input === 'object' ? input.at : undefined;
  if (!isRecordableInstant(at)) throw new Error('crm-fields: a revocation needs its timestamp (a real UTC ISO instant, not in the future)');
  return Object.freeze({ CALLBACK_CONSENT_STATUS: CONSENT_STATUS.REVOKED, CALLBACK_CONSENT_AT: at });
}

/**
 * One line naming what the owner must create in GoHighLevel. Printed by the
 * caller when `unmapped` is non-empty, so the gap shows up in logs every time
 * rather than being discovered during an audit.
 */
export function unmappedFieldsWarning(unmapped) {
  if (!unmapped || !unmapped.length) return null;
  return (
    '[CY2027-CRM] ' + unmapped.length + ' field(s) could not be written because no GoHighLevel ' +
    'field ID is configured for them: ' + unmapped.join(', ') + '. Create them in the sub-account ' +
    '(keys: ' + unmapped.map((n) => CY2027_FIELD_KEYS[n]).join(', ') + ') and set CY2027_CRM_FIELD_IDS. ' +
    'The full record is in the contact note meanwhile, but it is not queryable there.'
  );
}

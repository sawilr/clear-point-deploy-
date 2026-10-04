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
  LEAD_TRUST_STATE: 'contact.lead_trust_state',
  CHANNEL_VERIFICATION_STATUS: 'contact.channel_verification_status',
  HUMAN_SECURITY_REVIEW_STATUS: 'contact.human_security_review_status',
  CARRIER_OVERLAY_STATUS: 'contact.carrier_overlay_status',
  LICENSED_AGENT_REVIEW_REQUIRED: 'contact.licensed_agent_review_required',
  DATA_SENSITIVITY_CLASS: 'contact.data_sensitivity_class',
  RETENTION_CLASS: 'contact.retention_class',
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
]);

export const PROVENANCE = Object.freeze(['BENEFICIARY_CONFIRMED', 'SYSTEM', 'AI_INFERRED']);

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
 * @returns {{ fields, unmapped, refused, mapped }}
 *   `refused` — values rejected because an inference tried to overwrite a field
 *   only the beneficiary may set. Logged by the caller; never silently dropped.
 */
export function buildCustomFields(values, env = process.env) {
  const ids = fieldIdMap(env);
  const fields = [];
  const unmapped = [];
  const refused = [];
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
    // The stored election must itself be an election: 'SYSTEM_DEFAULT' written
    // beside SOA_LANGUAGE would state, in the CRM, a choice nobody made.
    if (name === 'SOA_LANGUAGE_SOURCE' && !languageWasElected(value)) {
      refused.push(name);
      continue;
    }
    const id = ids[name];
    if (!id) { unmapped.push(name); continue; }
    fields.push({ id, key: CY2027_FIELD_KEYS[name], field_value: String(value), value: String(value) });
  }
  return { fields, unmapped, refused, mapped: fields.length };
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
    RETENTION_CLASS: 'SOA_EVIDENCE',
    ...extra,
  };
}

/**
 * Flatten the four consent objects into their §18 fields — status, timestamp
 * and scope as QUERYABLE values, not prose in a note (audit CRM-14/CRM-16).
 */
export function consentsToFields({ recordingNotice, callbackConsent, aiOutboundConsent } = {}) {
  const out = {};
  if (recordingNotice) out.RECORDING_NOTICE_STATUS = recordingNotice.status;
  if (callbackConsent) {
    out.CALLBACK_CONSENT_STATUS = callbackConsent.status;
    out.CALLBACK_CONSENT_AT = callbackConsent.revokedAt || callbackConsent.at;
    out.CALLBACK_CONSENT_SCOPE = callbackConsent.scope;
  }
  if (aiOutboundConsent) out.AI_OUTBOUND_CONSENT_STATUS = aiOutboundConsent.status;
  return out;
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

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
// api/submit-lead.js does this correctly (since CRM-29 through EXISTING_CRM_FIELDS below):
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
import { DATA_SENSITIVITY_CLASS, isSensitivityClass } from './sensitivity.js';

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

// ─── THE FIELDS THAT ALREADY EXIST IN PRODUCTION ─────────────────────────────
// AUDIT 2026-10-04 (CRM-29) — spec §18: "Search for existing equivalent fields
// before creating new ones. Never duplicate fields with slightly different
// names." Nothing in the code could perform that search. The twelve custom
// fields already live in the sub-account existed only as inline literals: all
// twelve in api/submit-lead.js, four of them retyped by hand in api/opt-out.js,
// a third name-as-id convention in api/sign-soa.js, and a FOURTH copy of the
// bare ids in PRODUCTION_FIELD_IDS below. This module knew the NEW fields and
// nothing about the OLD ones, so "is there already a field for this?" had
// nowhere to be asked.
//
// The ids below are DATA, copied verbatim from the writers — not configuration.
// They are live: a typo here silently stops a consent flag from being recorded
// or, worse, from being cleared on a revocation. So they are pinned against an
// independent table in scripts/test-cy2027-2026-10-01.mjs and against the wire
// bytes in scripts/test-optout-lead02-authz-2026-08-18.mjs, and the writers may
// no longer spell an id themselves.
//
// Deliberately NOT merged into CY2027_FIELD_KEYS: the provisioning script and
// the preflight iterate that table as "fields the owner still has to create",
// and these already exist.
export const EXISTING_CRM_FIELDS = Object.freeze({
  PREFERRED_LANGUAGE: Object.freeze({ id: 'QULAmkAuVNCQrAMZ487K', key: 'contact.preferred_language' }),
  MEDICARE_STATUS: Object.freeze({ id: 'R510tHz6GFBaqZgN5e5S', key: 'contact.medicare_status' }),
  CONSENT_MARKETING: Object.freeze({ id: 'vPKlhpz6aucJK1U3fJRZ', key: 'contact.consent_marketing' }),
  CONSENT_SMS: Object.freeze({ id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms' }),
  CONSENT_CALLS: Object.freeze({ id: 'mHdpDjBSA76lQJrKoixL', key: 'contact.consent_calls' }),
  CONSENT_EMAIL: Object.freeze({ id: 'ykiTUcsu3nvawK39hmll', key: 'contact.consent_email' }),
  CLIENT_AGE: Object.freeze({ id: 'GSss3tRLKg8mNCzEv3D9', key: 'contact.client_age' }),
  CALCULATED_AGE: Object.freeze({ id: 'HoYmwc19InLwUwXNyKcr', key: 'contact.calculated_age' }),
  LEAD_QUALITY_FLAGS: Object.freeze({ id: 'qGryQuR67jXFFVRFBLkz', key: 'contact.lead_quality_flags' }),
  CHAT_CONVERSATION_SUMMARY: Object.freeze({ id: '6vSP5DJvAc6Jl9BXg409', key: 'contact.chat_conversation_summary' }),
  BEST_TIME_TO_CALL: Object.freeze({ id: 'PpDDusEEsMz4xNIcrwRW', key: 'contact.best_time_to_call' }),
  MEDICARE_INTEREST: Object.freeze({ id: 'fLxx7s1GpVJYlxJl08G6', key: 'contact.medicare_interest' }),
});

/**
 * One entry for an EXISTING production field, in the exact shape and property
 * order the lead and opt-out writers have always sent: { id, key, value }.
 *
 * The value is passed through UNTOUCHED — not stringified, not dropped when
 * empty. api/submit-lead.js filters empties and coerces non-strings itself
 * (R6-SL-05) and that behaviour must not move. An unknown name THROWS: a field
 * that is not in the registry is never written under a guessed id. The name
 * must be a string — `['CONSENT_SMS']` coerces through hasOwnProperty and is
 * not a registered name.
 */
export function existingField(name, value) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EXISTING_CRM_FIELDS, name)) {
    throw new Error('crm-fields: "' + String(name) + '" is not a registered existing CRM field');
  }
  const f = EXISTING_CRM_FIELDS[name];
  return { id: f.id, key: f.key, value };
}

/**
 * The THIRD convention (api/sign-soa.js): a short NAME sent where GoHighLevel
 * expects an opaque id, with `field_value`. Per CRM-27 these have never landed
 * on a custom field; they stay on the wire only so the payload does not change.
 * They are registered here so the registry — not a comment in a handler — says
 * which real field each one is covered by. Do NOT add to this list: a new field
 * goes in CY2027_FIELD_KEYS and gets a real id.
 *
 *   constant  — the literal sent; absent means "read payload[sentAs]".
 *   coveredBy — the registered field that carries the same fact, or null.
 *               soa_pdf_hash has none: it is the SHA-256 of the PDF bytes, a
 *               different hash from SOA_INTEGRITY_HASH, and §18 defines no field
 *               for it (it is in the contact note and the evidence store).
 */
export const LEGACY_SOA_NAME_FIELDS = Object.freeze([
  Object.freeze({ sentAs: 'soa_signed', constant: 'true', coveredBy: Object.freeze({ table: 'CY2027', name: 'SOA_STATUS' }) }),
  Object.freeze({ sentAs: 'soa_pdf_hash', coveredBy: null }),
  Object.freeze({ sentAs: 'soa_signed_at', coveredBy: Object.freeze({ table: 'CY2027', name: 'SOA_COMPLETED_AT' }) }),
  Object.freeze({ sentAs: 'soa_id', coveredBy: Object.freeze({ table: 'CY2027', name: 'SOA_ID' }) }),
  Object.freeze({ sentAs: 'preferred_language', coveredBy: Object.freeze({ table: 'EXISTING', name: 'PREFERRED_LANGUAGE' }) }),
]);

/** The five legacy entries, byte-for-byte as api/sign-soa.js has always sent them. */
export function legacySoaNameFields(payload) {
  const p = payload !== null && typeof payload === 'object' ? payload : {};
  return LEGACY_SOA_NAME_FIELDS.map((f) => ({
    id: f.sentAs,
    field_value: Object.prototype.hasOwnProperty.call(f, 'constant') ? f.constant : p[f.sentAs],
  }));
}

/**
 * Real GoHighLevel field IDs, supplied by the owner as JSON in
 * CY2027_CRM_FIELD_IDS, e.g.
 *   {"SOA_PLAN_YEAR":"abc123...","SOA_STATE":"def456..."}
 * Unknown or malformed content yields an empty map rather than throwing: a
 * misconfigured env var must not take down a signing request that is otherwise
 * valid — it must make the gap visible instead.
 */
export function fieldIdMap(env = process.env) {
  return fieldIdConfig(env).ids;
}

/**
 * AUDIT 2026-10-04 (DM-04, red team) — AN OWNER ID IS NOT TRUSTED JUST BECAUSE
 * IT IS A STRING. Measured: with CY2027_CRM_FIELD_IDS mapping
 * SELF_REPORTED_LIS_STATUS to 'R510tHz6GFBaqZgN5e5S' — the id api/submit-lead.js
 * already uses for contact.medicare_status — the create body carried
 * SELF_REPORTED_YES under the Medicare-coverage field's own id: the exact defect
 * DM-04 removes, re-created by one pasted id. Two CY2027 names given ONE id did
 * the same between themselves (an Extra Help answer landing in the field made
 * for Medicaid), and that held for every CY2027 field, not only the two new ones.
 *
 * These are the GoHighLevel ids this code ALREADY writes (api/submit-lead.js
 * and api/opt-out.js), kept for one purpose — refusing them as a CY2027 id —
 * and the suite fails if a handler writes an id that is not here.
 *
 * AUDIT 2026-10-04 (CRM-29) — this was a second hand-typed copy of the twelve
 * ids. It is now DERIVED from EXISTING_CRM_FIELDS, the one registry the writers
 * read, so an id cannot be refused here and written there under two spellings.
 *
 * LIMIT, stated: this knows the ids the CODE writes. A field that exists only in
 * the GoHighLevel sub-account (made by hand, written by a workflow) is unknown
 * here; giving each CY2027 key its OWN NEW field stays an owner action.
 */
export const PRODUCTION_FIELD_IDS = Object.freeze(Object.values(EXISTING_CRM_FIELDS).map((f) => f.id));

/** Named reasons a configured id is not used. */
export const FIELD_ID_REFUSAL = Object.freeze({
  IN_USE: 'ID_OF_A_FIELD_ALREADY_IN_USE',
  SHARED: 'ID_GIVEN_TO_MORE_THAN_ONE_FIELD',
});

/**
 * CY2027_CRM_FIELD_IDS, read once and judged.
 *
 * @returns {{ ids: object, refused: object }}
 *   `ids`     — name → id, for the ids that may be written to.
 *   `refused` — name → FIELD_ID_REFUSAL, for a configured id that is the id of
 *               a field this code already writes, or that was given to more
 *               than one name (then NONE of those names gets it: there is no
 *               telling which one the field was made for).
 * A refused name has no id, so every caller of buildCustomFields() reports it as
 * unmapped and the callback-consent unit rule holds without knowing about this.
 */
export function fieldIdConfig(env = process.env) {
  const ids = {};
  const refused = {};
  const raw = (env.CY2027_CRM_FIELD_IDS || '').trim();
  if (!raw) return { ids, refused };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ids, refused }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ids, refused };
  const namesById = new Map();
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === 'string' && v.trim() && Object.prototype.hasOwnProperty.call(CY2027_FIELD_KEYS, k)) {
      const id = v.trim();
      namesById.set(id, (namesById.get(id) || []).concat(k));
    }
  }
  for (const [id, names] of namesById) {
    const reason = PRODUCTION_FIELD_IDS.includes(id) ? FIELD_ID_REFUSAL.IN_USE
      : (names.length > 1 ? FIELD_ID_REFUSAL.SHARED : null);
    for (const name of names) {
      if (reason) refused[name] = reason; else ids[name] = id;
    }
  }
  return { ids, refused };
}

/**
 * One line naming the configured ids that were refused, and why. `names` limits
 * it to the fields the caller is about to write. Configuration names and reason
 * codes only — never an id, never a value.
 */
export function refusedFieldIdsWarning(refused, names) {
  const src = refused !== null && typeof refused === 'object' ? refused : {};
  const hit = (Array.isArray(names) ? names : Object.keys(src))
    .filter((n) => Object.prototype.hasOwnProperty.call(src, n));
  if (!hit.length) return null;
  return (
    '[CY2027-CRM] CY2027_CRM_FIELD_IDS gives ' + hit.length + ' field(s) an id that is REFUSED: ' +
    hit.map((n) => n + ' (' + src[n] + ')').join(', ') + '. Each CY2027 field needs its OWN new GoHighLevel ' +
    'field — never the id of a field already in use, never one id for two names. Nothing is written to a refused id.'
  );
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
    // AUDIT 2026-10-04 (CRM-25) — this field was being written with a RETENTION
    // label ('SOA_EVIDENCE'), because nothing said what a sensitivity class is.
    // It now takes only a value of the taxonomy in ./sensitivity.js, and only
    // from the SYSTEM — an allow-list of one provenance, matched exactly, not a
    // deny-list of 'AI_INFERRED': how a record is handled is decided by the
    // system from what the scrubbers found, never guessed by a model, never
    // declared by the beneficiary, never self-reported. Refused and named, so
    // the caller logs it; never dropped quietly.
    if (name === 'DATA_SENSITIVITY_CLASS' && (source !== 'SYSTEM' || !isSensitivityClass(value))) {
      refused.push(name);
      continue;
    }
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
    // AUDIT 2026-10-04 (CRM-25) — after `...extra` on purpose: a signed SOA is
    // compliance evidence by construction, and no caller may lower that.
    DATA_SENSITIVITY_CLASS: DATA_SENSITIVITY_CLASS.COMPLIANCE_EVIDENCE,
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

// ─── THE SEARCH §18 ASKS FOR (audit CRM-29) ──────────────────────────────────
// Pure functions over the two registries above. No handler calls them: they
// serve the battery and scripts/cy2027-provision-crm-fields.mjs, which is the
// only path that creates a field. They take an optional `tables` override for
// ONE reason — so the battery can observe each check FAILING on a defective
// registry instead of only passing on the clean one. Defaults are the frozen
// module registries.

/**
 * "Slightly different names" (§18), made mechanical. contact.consent_calls,
 * consentCalls, Consent-Call and CONSENT_CALLS all fold to the same string, so
 * a near-duplicate is found by comparison instead of by someone remembering.
 * It cannot see SEMANTIC equivalents (soa_language vs preferred_language); those
 * stay a compliance judgement.
 */
export function normalizeFieldName(nameOrKey) {
  return String(nameOrKey == null ? '' : nameOrKey)
    .trim()
    .replace(/^contact\./i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && /ies$/.test(t) ? t.slice(0, -3) + 'y' : t))
    // AUDIT 2026-10-04 (CRM-29, red team) — the -s rule below exempts tokens
    // ending in ss/us/is so `status` stays `status`; but `statuses` ends in `s`,
    // not `us`, and became `statuse`: a hand-made `soa_statuses` was neither
    // reused nor blocked beside fourteen registered `*_status` keys. An -es
    // plural of such a token folds to the token; and a token ending in sse/use/
    // ise drops its mute e so `spouse` meets `spouses` after the same rule.
    .map((t) => (t.length > 4 && /(ss|us|is)es$/.test(t) ? t.slice(0, -2) : t))
    .map((t) => (t.length > 4 && /(ss|us|is)e$/.test(t) ? t.slice(0, -1) : t))
    .map((t) => (t.length > 3 && /s$/.test(t) && !/(ss|us|is)$/.test(t) ? t.slice(0, -1) : t))
    .join('');
}

/** The registries a search runs over — the module's own unless a test says otherwise. */
function registryTables(tables) {
  const t = tables !== null && typeof tables === 'object' ? tables : {};
  return {
    existing: t.existing !== null && typeof t.existing === 'object' ? t.existing : EXISTING_CRM_FIELDS,
    cy2027: t.cy2027 !== null && typeof t.cy2027 === 'object' ? t.cy2027 : CY2027_FIELD_KEYS,
    legacy: Array.isArray(t.legacy) ? t.legacy : LEGACY_SOA_NAME_FIELDS,
  };
}

/** Every custom field this codebase knows about — old and new — as one list. */
export function registeredFields(tables) {
  const { existing, cy2027 } = registryTables(tables);
  const out = [];
  for (const [name, f] of Object.entries(existing)) out.push({ table: 'EXISTING', name, key: f && f.key, id: f && f.id });
  for (const [name, key] of Object.entries(cy2027)) out.push({ table: 'CY2027', name, key, id: null });
  return out;
}

/**
 * The search to run BEFORE a field is created: every registered field whose
 * name is the candidate's, exactly or "slightly differently", plus the field a
 * legacy sign-soa name is covered by. An empty result means nothing equivalent
 * is registered — not that the sub-account has none; planProvisioning() checks
 * the account.
 */
export function findEquivalentFields(candidate, tables) {
  const want = normalizeFieldName(candidate);
  if (!want) return [];
  const { legacy } = registryTables(tables);
  const all = registeredFields(tables);
  const hits = all.filter((f) => normalizeFieldName(f.key) === want);
  for (const l of legacy) {
    if (!l || !l.coveredBy || normalizeFieldName(l.sentAs) !== want) continue;
    const covering = all.find((f) => f.table === l.coveredBy.table && f.name === l.coveredBy.name);
    if (covering && !hits.includes(covering)) hits.push(covering);
  }
  return hits;
}

/** Named reasons a registry is not fit to create fields from. */
export const REGISTRY_PROBLEM = Object.freeze({
  MALFORMED_KEY: 'MALFORMED_KEY',
  NAME_KEY_MISMATCH: 'NAME_KEY_MISMATCH',
  MALFORMED_ID: 'MALFORMED_ID',
  DUPLICATE_ID: 'DUPLICATE_ID',
  DUPLICATE_KEY: 'DUPLICATE_KEY',
  NEAR_DUPLICATE_NAME: 'NEAR_DUPLICATE_NAME',
  LEGACY_POINTS_NOWHERE: 'LEGACY_POINTS_NOWHERE',
});

/**
 * Internal consistency of the registry, as a list of NAMED problems. Empty
 * means: every existing id is an id (not a name) and is distinct, every key is
 * distinct, no two fields differ only "slightly" in name, and every legacy name
 * points at a field that exists. Asserted by the battery and by the
 * provisioning script before it creates anything — deliberately not thrown at
 * import, because a registry typo must fail a build, not a beneficiary's request.
 */
export function registryProblems(tables) {
  const { existing, cy2027, legacy } = registryTables(tables);
  const P = REGISTRY_PROBLEM;
  const problems = [];
  const seenId = new Map();
  const seenKey = new Map();
  const seenNorm = new Map();
  for (const f of registeredFields(tables)) {
    const label = f.table + '.' + f.name;
    if (typeof f.key !== 'string' || !/^contact\.[a-z][a-z0-9_]*$/.test(f.key)) problems.push(P.MALFORMED_KEY + ':' + label);
    if (normalizeFieldName(f.name) !== normalizeFieldName(f.key)) problems.push(P.NAME_KEY_MISMATCH + ':' + label);
    if (f.table === 'EXISTING') {
      // An id is opaque: no dots, underscores or dashes. 'soa_pdf_hash' passed
      // where an id belongs is exactly the CRM-27 defect.
      // AUDIT 2026-10-04 (CRM-29, red team) — and it is exactly twenty characters,
      // the shape every production id has (pinned in the sibling suite). Any
      // alphanumeric string passed here, so a registry id missing its last
      // character reached the provisioning script's guard as well-formed.
      if (typeof f.id !== 'string' || !/^[A-Za-z0-9]{20}$/.test(f.id)) problems.push(P.MALFORMED_ID + ':' + label);
      else if (seenId.has(f.id)) problems.push(P.DUPLICATE_ID + ':' + label + '=' + seenId.get(f.id));
      else seenId.set(f.id, label);
    }
    if (seenKey.has(f.key)) problems.push(P.DUPLICATE_KEY + ':' + label + '=' + seenKey.get(f.key));
    else seenKey.set(f.key, label);
    const norm = normalizeFieldName(f.key);
    const prior = seenNorm.get(norm);
    if (prior && prior.key !== f.key) problems.push(P.NEAR_DUPLICATE_NAME + ':' + label + '~' + prior.label);
    if (!prior) seenNorm.set(norm, { key: f.key, label });
  }
  for (const l of legacy) {
    if (!l || !l.coveredBy) continue;
    const table = l.coveredBy.table === 'EXISTING' ? existing
      : l.coveredBy.table === 'CY2027' ? cy2027 : null;
    if (!table || !Object.prototype.hasOwnProperty.call(table, l.coveredBy.name)) {
      problems.push(P.LEGACY_POINTS_NOWHERE + ':' + l.sentAs);
    }
  }
  return problems;
}

/**
 * AUDIT 2026-10-04 (CRM-29, red team) — NAMED reasons the search §18 asks for
 * cannot be performed on what the sub-account answered. The script used to
 * coalesce any unexpected listing to "no fields" and create all thirty-six —
 * beside a hand-made near-duplicate it had not seen — while printing, and
 * ignoring, the twelve "NOT_IN_ACCOUNT" lines that said it was blind.
 *   LISTING_UNPARSED        — the response is not a shape this code reads.
 *   LISTING_EMPTY           — the account reports no custom field at all.
 *   LISTING_UNREADABLE      — an entry has no string id or no string key: a
 *                             field that exists but cannot be matched.
 *   REGISTRY_NOT_IN_ACCOUNT — a field this code writes today (EXISTING_CRM_FIELDS)
 *                             is absent from the listing. The listing is not
 *                             the account the writers talk to, or it is partial.
 */
export const PROVISIONING_REFUSAL = Object.freeze({
  LISTING_UNPARSED: 'LISTING_UNPARSED',
  LISTING_EMPTY: 'LISTING_EMPTY',
  LISTING_UNREADABLE: 'LISTING_UNREADABLE',
  REGISTRY_NOT_IN_ACCOUNT: 'REGISTRY_NOT_IN_ACCOUNT',
});

/**
 * The GoHighLevel custom-field listing, read into `{ id, key }` entries WITHOUT
 * coercion — a non-string id or key reaches planProvisioning() as what it is
 * and is judged there. The two shapes this code has always accepted are
 * `{ customFields: [...] }` and `{ customField: [...] }`; anything else is a
 * named refusal, never an empty account (that is the fail-open the red team
 * measured: `{}` → 36 fields created).
 *
 * @returns {{ fields: Array<{ id: unknown, key: unknown }> | null, refusal: null | { reason: string, detail: string[] } }}
 */
export function readAccountListing(json) {
  const j = json !== null && typeof json === 'object' && !Array.isArray(json) ? json : null;
  const arr = j && Array.isArray(j.customFields) ? j.customFields : j && Array.isArray(j.customField) ? j.customField : null;
  if (!arr) {
    const seen = j ? 'top-level keys: ' + (Object.keys(j).join(', ') || '(none)') : 'not an object: ' + (Array.isArray(json) ? 'array' : typeof json);
    return { fields: null, refusal: { reason: PROVISIONING_REFUSAL.LISTING_UNPARSED, detail: ['expected { customFields: [...] } — ' + seen] } };
  }
  return {
    fields: arr.map((f) => ({ id: f && f.id, key: f && (f.fieldKey || f.key) })),
    refusal: null,
  };
}

/** A listing entry as it is printed in a refusal: its own values, never trusted as text. */
function describeEntry(f) {
  const show = (v) => (typeof v === 'string' ? JSON.stringify(v.slice(0, 60)) : v === undefined ? 'undefined' : Array.isArray(v) ? 'array' : typeof v);
  return 'id=' + show(f.id) + ' key=' + show(f.key);
}

/**
 * Decide, for each CY2027 field, whether to REUSE, CREATE or REFUSE — from the
 * list of custom fields that exist in the sub-account right now. Pure: the
 * caller does the network I/O (scripts/cy2027-provision-crm-fields.mjs).
 *
 * @param {Array<{ id: string, key: string }>} liveFields every field in the account
 * @returns {{ reuse: Record<string,string>, create: string[], withheld: string[], blocked: Array, drift: Array, unreadable: Array, refusal: null | { reason: string, detail: string[] } }}
 *   reuse      — name -> id; the exact key already exists.
 *   create     — nothing with that name exists, exactly or slightly differently.
 *                EMPTY whenever `refusal` is set: a listing this code cannot
 *                search is not a listing to create from, and a caller that
 *                forgets to look at `refusal` still creates nothing.
 *   withheld   — what `create` would have held, when `refusal` is set.
 *   blocked    — a field with a SLIGHTLY DIFFERENT key exists, in the account or in
 *                EXISTING_CRM_FIELDS. Never created: that is the duplicate §18
 *                forbids. A person decides whether to reuse it or rename the new one.
 *   drift      — an EXISTING_CRM_FIELDS entry the account does not confirm (id
 *                and/or key differ, or it is absent). Reported, never "fixed" here.
 *   unreadable — listing entries without a string id or key, as described.
 *   refusal    — PROVISIONING_REFUSAL and detail, or null when the listing is
 *                one that was searched. An ID_MISMATCH / KEY_MISMATCH drift alone
 *                does not refuse: the account is visible, the registry is wrong.
 */
export function planProvisioning(liveFields, tables) {
  const { existing, cy2027 } = registryTables(tables);
  const bare = (k) => String(k == null ? '' : k).replace(/^contact\./i, '');
  // AUDIT 2026-10-04 (CRM-29, red team) — an entry without a string id or key
  // was silently dropped here, so a live near-duplicate whose id the listing
  // did not carry landed in `create`. It is counted and named instead.
  const seen = (Array.isArray(liveFields) ? liveFields : []).map((f) => ({ id: f && f.id, key: f && f.key }));
  const readable = (f) => typeof f.key === 'string' && bare(f.key) !== '' && typeof f.id === 'string' && f.id !== '';
  const unreadable = seen.filter((f) => !readable(f)).map((f) => ({ id: f.id, key: f.key, described: describeEntry(f) }));
  const live = seen.filter(readable).map((f) => ({ id: f.id, key: bare(f.key) }));
  const byKey = new Map(live.map((f) => [f.key, f.id]));
  const byId = new Map(live.map((f) => [f.id, f.key]));

  const reuse = {};
  const create = [];
  const blocked = [];
  for (const [name, key] of Object.entries(cy2027)) {
    const k = bare(key);
    if (byKey.has(k)) { reuse[name] = byKey.get(k); continue; }
    const want = normalizeFieldName(k);
    const near = live
      .filter((f) => normalizeFieldName(f.key) === want)
      .map((f) => ({ key: 'contact.' + f.key, id: f.id, where: 'ACCOUNT' }));
    for (const [n2, f2] of Object.entries(existing)) {
      if (f2 && normalizeFieldName(f2.key) === want) near.push({ key: f2.key, id: f2.id, where: 'REGISTRY:' + n2 });
    }
    if (near.length) blocked.push({ name, key, near });
    else create.push(name);
  }

  const drift = [];
  for (const [name, f] of Object.entries(existing)) {
    if (!f) continue;
    const k = bare(f.key);
    if (byKey.get(k) === f.id) continue;
    if (byKey.has(k)) drift.push({ name, key: f.key, registryId: f.id, accountId: byKey.get(k), accountKey: f.key, reason: 'ID_MISMATCH' });
    else if (byId.has(f.id)) drift.push({ name, key: f.key, registryId: f.id, accountId: f.id, accountKey: 'contact.' + byId.get(f.id), reason: 'KEY_MISMATCH' });
    else drift.push({ name, key: f.key, registryId: f.id, accountId: null, accountKey: null, reason: 'NOT_IN_ACCOUNT' });
  }

  const absent = drift.filter((d) => d.reason === 'NOT_IN_ACCOUNT').map((d) => d.name);
  const R = PROVISIONING_REFUSAL;
  const refusal = unreadable.length ? { reason: R.LISTING_UNREADABLE, detail: unreadable.map((u) => u.described) }
    : live.length === 0 ? { reason: R.LISTING_EMPTY, detail: ['the account reports no custom field; the registry says ' + Object.keys(existing).length + ' exist'] }
      : absent.length ? { reason: R.REGISTRY_NOT_IN_ACCOUNT, detail: absent }
        : null;
  return refusal
    ? { reuse, create: [], withheld: create, blocked, drift, unreadable, refusal }
    : { reuse, create, withheld: [], blocked, drift, unreadable, refusal };
}

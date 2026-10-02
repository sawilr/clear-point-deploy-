// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — RETENTION BY RECORD CLASS AND LEGAL HOLD (spec §19).
//
// "CY2027 marketing/sales call retention logic must support minimum six years,
//  with audio retained for the first three years, and full audio or complete
//  accurate transcript for years 4-6 as permitted by the final rule. Enrollment
//  records may have different/longer obligations; assign retention by record
//  class and use the longest applicable period."
//
// "No deletion job may purge a record while a legal hold, complaint, carrier
//  audit, CMS inquiry or retention requirement is active."
//
// This module decides; it does not delete. Any future purge job must call
// mayPurge() and must treat a thrown error or a false result as "keep".
// ─────────────────────────────────────────────────────────────────────────────

export const RECORD_CLASS = Object.freeze({
  MARKETING_SALES_CALL_AUDIO: 'MARKETING_SALES_CALL_AUDIO',
  MARKETING_SALES_CALL_TRANSCRIPT: 'MARKETING_SALES_CALL_TRANSCRIPT',
  SOA_EVIDENCE: 'SOA_EVIDENCE',
  ENROLLMENT_RECORD: 'ENROLLMENT_RECORD',
  CONSENT_RECORD: 'CONSENT_RECORD',
  SECURITY_LOG: 'SECURITY_LOG',
  GENERAL_CRM: 'GENERAL_CRM',
});

/**
 * Minimum retention in years per class.
 *
 * SOA_EVIDENCE and CONSENT_RECORD are pinned to the marketing/sales minimum
 * because they are the evidence that the marketing call was permitted — they
 * must outlive the call they authorize, never the reverse. This is a deliberate
 * "longest applicable period" assignment, per the spec.
 *
 * ENROLLMENT_RECORD is marked OWNER_CONFIRMED_REQUIRED rather than given a
 * number: the spec says enrollment obligations "may be different/longer" and
 * inventing a figure here would be fabrication. Until the owner supplies it,
 * mayPurge() refuses to purge that class at all.
 */
export const RETENTION_YEARS = Object.freeze({
  MARKETING_SALES_CALL_AUDIO: 6,
  MARKETING_SALES_CALL_TRANSCRIPT: 6,
  SOA_EVIDENCE: 6,
  CONSENT_RECORD: 6,
  ENROLLMENT_RECORD: null, // OWNER_CONFIRMED_REQUIRED — never purge while null
  SECURITY_LOG: 6,
  GENERAL_CRM: 6,
});

/** Within the first N years, the AUDIO itself must still exist. */
export const AUDIO_REQUIRED_YEARS = 3;
/** Years 4-6: full audio OR a complete accurate transcript. */
export const AUDIO_OR_TRANSCRIPT_WINDOW = Object.freeze([4, 6]);

export const HOLD_REASONS = Object.freeze([
  'LEGAL_HOLD',
  'COMPLAINT',
  'CARRIER_AUDIT',
  'CMS_INQUIRY',
]);

const YEAR_MS = 365.2425 * 24 * 60 * 60 * 1000;

/** Age of a record in years, from its creation timestamp. */
export function ageInYears(createdAt, now = new Date()) {
  const t0 = Date.parse(createdAt);
  if (!Number.isFinite(t0)) return NaN;
  const t1 = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return (t1 - t0) / YEAR_MS;
}

/**
 * What must still be retrievable for a marketing/sales call of a given age.
 *   { audio: true,  transcript: false } — years 0-3: audio required
 *   { audio: false, transcript: true }  — years 4-6: audio OR complete transcript
 *   null                                 — past the minimum; see mayPurge()
 */
export function callRetentionRequirement(createdAt, now = new Date()) {
  const age = ageInYears(createdAt, now);
  if (!Number.isFinite(age)) return { audio: true, transcript: true, reason: 'UNKNOWN_AGE_FAIL_CLOSED' };
  if (age < AUDIO_REQUIRED_YEARS) return { audio: true, transcript: false, reason: 'AUDIO_WINDOW' };
  if (age < AUDIO_OR_TRANSCRIPT_WINDOW[1]) {
    return { audio: false, transcript: true, reason: 'AUDIO_OR_COMPLETE_TRANSCRIPT_WINDOW' };
  }
  return null;
}

/**
 * May this record be purged?
 * Returns { allowed:false, reason } for every uncertainty — there is no code
 * path where an unknown class, an unparseable date or a null retention period
 * results in deletion.
 */
export function mayPurge(record, now = new Date()) {
  if (!record) return { allowed: false, reason: 'NO_RECORD' };

  const holds = Array.isArray(record.holds) ? record.holds.filter(Boolean) : [];
  if (holds.length) return { allowed: false, reason: 'ACTIVE_HOLD', holds };

  const cls = record.recordClass;
  if (!cls || !(cls in RETENTION_YEARS)) return { allowed: false, reason: 'UNKNOWN_RECORD_CLASS' };

  const years = RETENTION_YEARS[cls];
  if (years == null) return { allowed: false, reason: 'RETENTION_PERIOD_NOT_CONFIRMED', recordClass: cls };

  const age = ageInYears(record.createdAt, now);
  if (!Number.isFinite(age)) return { allowed: false, reason: 'UNPARSEABLE_CREATED_AT' };
  if (age < years) return { allowed: false, reason: 'WITHIN_RETENTION_PERIOD', ageYears: Number(age.toFixed(2)), requiredYears: years };

  return { allowed: true, reason: 'RETENTION_SATISFIED', ageYears: Number(age.toFixed(2)), requiredYears: years };
}

/** Attach a hold. Idempotent; unknown reasons are rejected rather than stored. */
export function applyHold(record, reason, { at = new Date().toISOString(), note = null } = {}) {
  if (!HOLD_REASONS.includes(reason)) throw new Error(`retention: unknown hold reason "${reason}"`);
  const holds = Array.isArray(record?.holds) ? record.holds.slice() : [];
  if (!holds.some((h) => h.reason === reason)) holds.push({ reason, at, note });
  return { ...record, holds };
}

/** Release a hold. Releasing one hold never releases the others. */
export function releaseHold(record, reason, { at = new Date().toISOString(), actor } = {}) {
  if (!actor) throw new Error('retention: releasing a hold requires an actor for the audit log');
  const holds = (Array.isArray(record?.holds) ? record.holds : []).filter((h) => h.reason !== reason);
  const released = Array.isArray(record?.releasedHolds) ? record.releasedHolds.slice() : [];
  released.push({ reason, at, actor });
  return { ...record, holds, releasedHolds: released };
}

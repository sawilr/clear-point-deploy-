// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — APPOINTMENT SOA LEDGER (spec §9, §26, §31). SERVER ONLY.
//
// "Editing categories creates a new version/instance with supersession
//  history." (§9)
// "Duplicate contact/SOA -> reconcile; never create conflicting active scopes
//  silently." (§26)
// "Duplicate SOA submissions - preserve first/second versions; define active
//  instance explicitly." (§31)
//
// AUDIT 2026-10-04 (EV-09, WVG-11) — a signed instance was stored under its own
// id and nowhere else, so nothing could find "the SOA already signed for this
// appointment": a second signature became a second COMPLETED scope, and nobody
// was told. This module keeps ONE record per appointment — the ledger — that
// lists every instance signed for it, each with its status. The active
// instance is whatever activeSoaInstance() (soa-instance.js) says about that
// list: one, none, or a refusal. A supersession is a single write of that one
// record, so there is no instant at which two instances are active, and both
// versions stay in it.
//
// The store (../soa-store.js) is the KV the signing link lives in. Every read
// and write here reports failure instead of defaulting: a ledger that could
// not be read is NOT an empty ledger.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { readRecord, setRecord, claimRecord, deleteRecord } from '../soa-store.js';
import { SOA_STATUS, SOA_SCOPE_PROBLEM, activeSoaInstance, supersede } from './soa-instance.js';
import { RECORD_CLASS, RETENTION_YEARS } from './retention.js';

/** The ledger lives as long as the evidence it indexes (spec §19). */
export const LEDGER_TTL_SEC = RETENTION_YEARS[RECORD_CLASS.SOA_EVIDENCE] * 365 * 24 * 60 * 60;

/** A lock outlives any one signing request; the handler releases it explicitly. */
export const APPOINTMENT_LOCK_TTL_SEC = 60;

/** Where fileSignature() stopped. Each stage is a different operator action. */
export const SIGNATURE_FILING_STAGE = Object.freeze({
  PRECONDITION: 'PRECONDITION',
  SIGNED_RECORD: 'SIGNED_RECORD',
  LEDGER: 'LEDGER',
  SUPERSEDED_MIRROR: 'SUPERSEDED_MIRROR',
});

export const LEDGER_REFUSAL = Object.freeze({
  LEDGER_UNREADABLE: 'SOA_LEDGER_UNREADABLE',
  LEDGER_APPOINTMENT_MISMATCH: 'SOA_LEDGER_APPOINTMENT_MISMATCH',
  BENEFICIARY_MISMATCH: 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH',
  SUPERSESSION_REFUSED: 'SOA_SUPERSESSION_REFUSED',
  APPOINTMENT_BUSY: 'SOA_APPOINTMENT_BUSY',
  APPOINTMENT_LOCK_FAILED: 'SOA_APPOINTMENT_LOCK_FAILED',
  // AUDIT 2026-10-04 (EV-09 / WVG-11, red team) — the signer is not the person
  // the link was issued to; the lock being released is not this request's.
  IDENTITY_MISMATCH: 'SOA_IDENTITY_MISMATCH',
  APPOINTMENT_LOCK_NOT_HELD: 'SOA_APPOINTMENT_LOCK_NOT_HELD',
  APPOINTMENT_LOCK_EXPIRED: 'SOA_APPOINTMENT_LOCK_EXPIRED',
});

/** The server's own appointment id form (api/soa-token.js mints these). */
const APPOINTMENT_ID_RE = /^appt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * An appointment id a caller asks a NEW link to be issued for. Only the
 * server's own id form is accepted; anything else is null and the caller mints
 * a fresh appointment. Accepting the id decides nothing about the scope: whether
 * the holder may replace that appointment's SOA is decided at signature, where
 * the person is proven.
 */
export function appointmentIdForReissue(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return APPOINTMENT_ID_RE.test(v) ? v : null;
}

export function appointmentLedgerKey(appointmentId) {
  return 'soa-appointment:' + appointmentId;
}

export function appointmentLockKey(appointmentId) {
  return 'soa-appointment-lock:' + appointmentId;
}

export function signedRecordKey(soaId) {
  return 'soa-signed:' + soaId;
}

/**
 * Server-side binding of a person to an appointment's ledger: the digest of
 * the phone the link's second factor proved (the LEAD record's phone, never the
 * one in the signing body). No phone is stored in clear. Null when there is no
 * ten-digit number to bind — a null never matches anything.
 */
export function beneficiaryKeyFor(phone) {
  const digits = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return 'sha256:' + crypto.createHash('sha256').update(digits.slice(-10), 'utf8').digest('hex');
}

/** One spelling of a name for comparison; anything that is not a string is no name. */
function foldName(v) {
  return typeof v === 'string' ? v.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/** The ten subscriber digits of a phone, or null; anything that is not a string is no phone. */
function tenDigits(v) {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * AUDIT 2026-10-04 (EV-09, red team) — the signer the signing body describes
 * must be the person the link was issued to. The handler matched the
 * SIGNATURE to the captured name but filed the BODY's fullName as the
 * beneficiary and sent the BODY's phone to the CRM, so a link issued under
 * another name for the same phone and appointment could sign as "Someone
 * Else" and replace the victim's scope under the victim's name, on a different
 * CRM contact. Both are claims the server can check against its own lead
 * record — the name it captured at issuance and the phone the second factor
 * proved — and that is the only comparison made here: never two fields of the
 * same request against each other. Returns null when they agree, else the
 * named refusal and the field that disagreed (never the values).
 */
export function signerIdentityProblem(claimed, record) {
  const c = claimed && typeof claimed === 'object' && !Array.isArray(claimed) ? claimed : {};
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { reason: LEDGER_REFUSAL.IDENTITY_MISMATCH, field: 'record' };
  }
  const recordName = foldName(record.fullName);
  if (!recordName || foldName(c.fullName) !== recordName) return { reason: LEDGER_REFUSAL.IDENTITY_MISMATCH, field: 'fullName' };
  const recordPhone = tenDigits(record.phone);
  if (!recordPhone || tenDigits(c.phone) !== recordPhone) return { reason: LEDGER_REFUSAL.IDENTITY_MISMATCH, field: 'phone' };
  return null;
}

/** What the ledger keeps about one instance: enough to define "active" and to supersede. */
export function ledgerEntryFor(instance, beneficiaryKey) {
  if (!instance || typeof instance !== 'object') throw new Error('soa-ledger: no instance');
  if (typeof beneficiaryKey !== 'string' || !beneficiaryKey) throw new Error('soa-ledger: beneficiaryKey is required');
  return Object.freeze({
    soaId: instance.soaId,
    appointmentId: instance.appointmentId,
    planYear: instance.planYear,
    state: instance.state,
    beneficiaryName: instance.beneficiaryName,
    beneficiaryKey,
    status: instance.status,
    completedAt: instance.completedAt ?? null,
    supersedesId: instance.supersedesId ?? null,
    supersededById: instance.supersededById ?? null,
    supersededAt: instance.supersededAt ?? null,
    revokedAt: instance.revokedAt ?? null,
    integrityHash: instance.integrityHash ?? null,
    evidenceReference: instance.evidenceReference ?? null,
  });
}

function emptyLedger(appointmentId) {
  return Object.freeze({ appointmentId, instances: Object.freeze([]), updatedAt: null });
}

function ledgerShapeProblem(ledger, appointmentId) {
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return LEDGER_REFUSAL.LEDGER_UNREADABLE;
  if (!Array.isArray(ledger.instances)) return LEDGER_REFUSAL.LEDGER_UNREADABLE;
  if (typeof appointmentId !== 'string' || !appointmentId || ledger.appointmentId !== appointmentId) {
    return LEDGER_REFUSAL.LEDGER_APPOINTMENT_MISMATCH;
  }
  return null;
}

/**
 * The ledger of one appointment. An absent key is an empty ledger; a read that
 * failed, or a record of the wrong shape, is a refusal the caller must stop on.
 */
export async function readLedger(appointmentId) {
  if (typeof appointmentId !== 'string' || !appointmentId) {
    return { ok: false, reason: LEDGER_REFUSAL.LEDGER_APPOINTMENT_MISMATCH };
  }
  const r = await readRecord(appointmentLedgerKey(appointmentId));
  if (!r.ok) return { ok: false, reason: r.reason || 'KV_READ_FAILED' };
  if (r.value == null) return { ok: true, ledger: emptyLedger(appointmentId), durable: r.durable };
  const problem = ledgerShapeProblem(r.value, appointmentId);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, ledger: r.value, durable: r.durable };
}

/**
 * Decide what a freshly built instance is to this appointment: the FIRST
 * signature, or a replacement that SUPERSEDES the active one. Pure, so the rule
 * is tested by calling it.
 *
 * Refuses, with the reason named, when the ledger cannot define an active
 * instance (a conflict is never resolved here), when the person differs
 * (phone binding, then name/appointment/plan year/state in supersede()), or
 * when the instance claims a supersession the ledger does not support.
 */
export function reconcileSignature(ledger, instance, { beneficiaryKey, at = new Date().toISOString() } = {}) {
  if (!instance || typeof instance !== 'object' || typeof instance.appointmentId !== 'string' || !instance.appointmentId) {
    return { ok: false, reason: LEDGER_REFUSAL.LEDGER_APPOINTMENT_MISMATCH };
  }
  const problem = ledgerShapeProblem(ledger, instance.appointmentId);
  if (problem) return { ok: false, reason: problem };
  if (typeof beneficiaryKey !== 'string' || !beneficiaryKey) return { ok: false, reason: LEDGER_REFUSAL.BENEFICIARY_MISMATCH };
  if (ledger.instances.some((e) => e && e.soaId === instance.soaId)) {
    return { ok: false, reason: SOA_SCOPE_PROBLEM.RECORD_DUPLICATED, soaId: instance.soaId };
  }
  const act = activeSoaInstance(ledger.instances);
  if (!act.ok) return { ok: false, reason: act.reason, soaIds: act.soaIds || null };
  if (!act.active) {
    if (instance.supersedesId != null) {
      return { ok: false, reason: LEDGER_REFUSAL.SUPERSESSION_REFUSED, errors: { instance: 'supersedes_nothing_active' } };
    }
    return { ok: true, mode: 'FRESH', instance, previous: null };
  }
  if (act.active.beneficiaryKey !== beneficiaryKey) return { ok: false, reason: LEDGER_REFUSAL.BENEFICIARY_MISMATCH };
  const sup = supersede(act.active, instance, { at });
  if (!sup.ok) return { ok: false, reason: LEDGER_REFUSAL.SUPERSESSION_REFUSED, errors: sup.errors };
  return { ok: true, mode: 'SUPERSEDES', instance: sup.instance, previous: sup.previous };
}

/**
 * File a COMPLETED signature, in this order, stopping at the first failure:
 *   1. the signed record (what the ledger will point at);
 *   2. the ledger — ONE write that adds the new entry and, when superseding,
 *      replaces the previous entry with its SUPERSEDED version: the switch of
 *      the active instance is this write and nothing else;
 *   3. the superseded record's mirror, so it cannot be read as COMPLETED on
 *      its own.
 * A failure at 1 leaves the previous instance active and nothing dangling; at
 * 2, the new record exists but is unreachable and the previous stays active.
 * Both are `ok: false` with the stage named: the signature is NOT filed.
 *
 * AUDIT 2026-10-04 (EV-09, red team) — a failure at 3 used to be reported the
 * same way, and the handler told the beneficiary "the scope was not recorded"
 * while the ledger — the declared definition of "active" — had already
 * switched to it: the CRM and the ledger disagreed, and a beneficiary who
 * re-signed on that advice superseded an instance they were told did not
 * exist. The ledger write IS the filing; the superseded record's own copy is a
 * mirror of it. So a mirror that could not be written is `ok: true` WITH
 * `mirror: { ok: false, stage, reason, previousSoaId }` beside it, for the
 * caller to audit and the operator to reconcile — never a denial of a record
 * the system of record holds.
 */
export async function fileSignature({
  ledger, instance, beneficiaryKey, previous = null, signedRecord, signedRecordTtlSec, at = new Date().toISOString(),
}) {
  const STAGE = SIGNATURE_FILING_STAGE;
  const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });
  if (!instance || typeof instance !== 'object') return fail(STAGE.PRECONDITION, 'NO_INSTANCE');
  const problem = ledgerShapeProblem(ledger, instance.appointmentId);
  if (problem) return fail(STAGE.PRECONDITION, problem);
  if (instance.status !== SOA_STATUS.COMPLETED || !instance.integrityHash || !instance.evidenceReference) {
    return fail(STAGE.PRECONDITION, 'INSTANCE_NOT_COMPLETED');
  }
  if (typeof beneficiaryKey !== 'string' || !beneficiaryKey) return fail(STAGE.PRECONDITION, 'BENEFICIARY_KEY_MISSING');
  if (!signedRecord || typeof signedRecord !== 'object' || signedRecord.soaId !== instance.soaId) {
    return fail(STAGE.PRECONDITION, 'SIGNED_RECORD_MISMATCH');
  }
  if (!Number.isInteger(signedRecordTtlSec) || signedRecordTtlSec <= 0) return fail(STAGE.PRECONDITION, 'TTL_INVALID');
  if (ledger.instances.some((e) => e && e.soaId === instance.soaId)) return fail(STAGE.PRECONDITION, 'ALREADY_FILED');
  if (previous) {
    if (previous.status !== SOA_STATUS.SUPERSEDED || previous.supersededById !== instance.soaId || instance.supersedesId !== previous.soaId) {
      return fail(STAGE.PRECONDITION, 'SUPERSESSION_INCONSISTENT');
    }
    if (!ledger.instances.some((e) => e && e.soaId === previous.soaId)) return fail(STAGE.PRECONDITION, 'PREVIOUS_NOT_IN_LEDGER');
  } else if (instance.supersedesId != null) {
    return fail(STAGE.PRECONDITION, 'SUPERSESSION_INCONSISTENT');
  }
  // The ledger handed in must still say what the reconciliation saw: the
  // active instance is the one being replaced, or there is none.
  const act = activeSoaInstance(ledger.instances);
  if (!act.ok) return fail(STAGE.PRECONDITION, act.reason);
  if ((act.active ? act.active.soaId : null) !== (previous ? previous.soaId : null)) {
    return fail(STAGE.PRECONDITION, 'ACTIVE_INSTANCE_CHANGED');
  }

  const w1 = await setRecord(signedRecordKey(instance.soaId), signedRecord, signedRecordTtlSec);
  if (!w1.ok) return fail(STAGE.SIGNED_RECORD, w1.reason || 'KV_WRITE_FAILED');

  const entry = ledgerEntryFor(instance, beneficiaryKey);
  const next = Object.freeze({
    appointmentId: ledger.appointmentId,
    instances: Object.freeze(ledger.instances.map((e) => (previous && e.soaId === previous.soaId ? previous : e)).concat([entry])),
    updatedAt: at,
  });
  // AUDIT 2026-10-04 (WVG-11, red team) — the ledger handed in is the snapshot
  // read under the appointment lock. A lock that expired, or one a stale
  // request released, lets another filing change the ledger in between, and the
  // write below would overwrite that filing with this request's view of the
  // ledger. The store has no compare-and-set over REST, so the ledger is
  // re-read right before the write and one that no longer says the same thing
  // is a named refusal: the window is one round trip, not the whole request.
  const again = await readLedger(ledger.appointmentId);
  if (!again.ok) return fail(STAGE.LEDGER, again.reason);
  if (JSON.stringify(again.ledger) !== JSON.stringify(ledger)) return fail(STAGE.LEDGER, 'LEDGER_CHANGED');
  const w2 = await setRecord(appointmentLedgerKey(ledger.appointmentId), next, LEDGER_TTL_SEC);
  if (!w2.ok) return fail(STAGE.LEDGER, w2.reason || 'KV_WRITE_FAILED');

  const filed = { ok: true, ledger: next, mode: previous ? 'SUPERSEDES' : 'FRESH', mirror: null };
  if (previous) {
    // The signature is filed from here on: the mirror of the superseded record
    // is reported beside it, never as a filing failure (see the doc above).
    const lag = (reason) => ({ ...filed, mirror: { ok: false, stage: STAGE.SUPERSEDED_MIRROR, reason, previousSoaId: previous.soaId } });
    const prevKey = signedRecordKey(previous.soaId);
    const r = await readRecord(prevKey);
    if (!r.ok) return lag(r.reason || 'KV_READ_FAILED');
    if (!r.value || typeof r.value !== 'object') return lag('PREVIOUS_RECORD_MISSING');
    const prevInstance = r.value.instance && typeof r.value.instance === 'object' ? r.value.instance : {};
    const mirrored = {
      ...r.value,
      instance: {
        ...prevInstance,
        status: SOA_STATUS.SUPERSEDED,
        supersededById: instance.soaId,
        supersededAt: previous.supersededAt ?? at,
      },
    };
    const w3 = await setRecord(prevKey, mirrored, signedRecordTtlSec);
    if (!w3.ok) return lag(w3.reason || 'KV_WRITE_FAILED');
    return { ...filed, mirror: { ok: true } };
  }
  return filed;
}

/**
 * Serialise the signing of one appointment. Two requests for the same
 * appointment — the same link twice, or two links — would otherwise both read
 * an empty ledger and both write it, the last one silently winning.
 */
export async function claimAppointmentLock(appointmentId, { now = new Date() } = {}) {
  if (typeof appointmentId !== 'string' || !appointmentId) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_FAILED };
  // AUDIT 2026-10-04 (WVG-11, red team) — the lock carries WHO holds it. A
  // release used to be an unconditional DEL, so a request that outlived the
  // TTL deleted the lock a later request now held and let a third one in
  // beside it. The holder token is returned to the claimant and the release
  // deletes only a lock that still carries it.
  const holder = crypto.randomUUID();
  const r = await claimRecord(appointmentLockKey(appointmentId), { appointmentId, holder, claimedAt: now.toISOString() }, APPOINTMENT_LOCK_TTL_SEC);
  if (!r.ok) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_FAILED };
  if (!r.claimed) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_BUSY };
  return { ok: true, holder, durable: r.durable };
}

/**
 * Release the lock this `holder` claimed — compare, then delete. An expired
 * lock (nothing to release: this request outlived the TTL) and a lock another
 * request now holds are each a named refusal, and neither is deleted. Not
 * atomic over REST; the window is one round trip, where it was the whole TTL.
 */
export async function releaseAppointmentLock(appointmentId, holder) {
  if (typeof appointmentId !== 'string' || !appointmentId || typeof holder !== 'string' || !holder) {
    return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_FAILED };
  }
  const key = appointmentLockKey(appointmentId);
  const r = await readRecord(key);
  if (!r.ok) return { ok: false, reason: r.reason || 'KV_READ_FAILED' };
  if (r.value === null || r.value === undefined) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_EXPIRED };
  if (typeof r.value !== 'object' || Array.isArray(r.value) || r.value.holder !== holder) {
    return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_NOT_HELD };
  }
  const d = await deleteRecord(key);
  return d.ok ? { ok: true } : { ok: false, reason: d.reason || 'KV_WRITE_FAILED' };
}

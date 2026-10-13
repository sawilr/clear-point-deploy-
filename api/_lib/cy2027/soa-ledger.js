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
 * 2, the new record exists but is unreachable and the previous stays active;
 * at 3, the ledger has already switched (reported with `ledger`). Every outcome
 * names its stage so the operator knows what to reconcile.
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
  const w2 = await setRecord(appointmentLedgerKey(ledger.appointmentId), next, LEDGER_TTL_SEC);
  if (!w2.ok) return fail(STAGE.LEDGER, w2.reason || 'KV_WRITE_FAILED');

  if (previous) {
    const prevKey = signedRecordKey(previous.soaId);
    const r = await readRecord(prevKey);
    if (!r.ok) return fail(STAGE.SUPERSEDED_MIRROR, r.reason || 'KV_READ_FAILED', { ledger: next });
    if (!r.value || typeof r.value !== 'object') return fail(STAGE.SUPERSEDED_MIRROR, 'PREVIOUS_RECORD_MISSING', { ledger: next });
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
    if (!w3.ok) return fail(STAGE.SUPERSEDED_MIRROR, w3.reason || 'KV_WRITE_FAILED', { ledger: next });
  }
  return { ok: true, ledger: next, mode: previous ? 'SUPERSEDES' : 'FRESH' };
}

/**
 * Serialise the signing of one appointment. Two requests for the same
 * appointment — the same link twice, or two links — would otherwise both read
 * an empty ledger and both write it, the last one silently winning.
 */
export async function claimAppointmentLock(appointmentId, { now = new Date() } = {}) {
  if (typeof appointmentId !== 'string' || !appointmentId) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_FAILED };
  const r = await claimRecord(appointmentLockKey(appointmentId), { appointmentId, claimedAt: now.toISOString() }, APPOINTMENT_LOCK_TTL_SEC);
  if (!r.ok) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_FAILED };
  if (!r.claimed) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_BUSY };
  return { ok: true, durable: r.durable };
}

export async function releaseAppointmentLock(appointmentId) {
  if (typeof appointmentId !== 'string' || !appointmentId) return { ok: false, reason: LEDGER_REFUSAL.APPOINTMENT_LOCK_FAILED };
  const r = await deleteRecord(appointmentLockKey(appointmentId));
  return r.ok ? { ok: true } : { ok: false, reason: r.reason || 'KV_WRITE_FAILED' };
}

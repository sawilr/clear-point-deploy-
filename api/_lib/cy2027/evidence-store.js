// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — DURABLE EVIDENCE STORE (spec §19, §26). SERVER ONLY.
//
// "On submit, generate an immutable human-readable PDF evidence copy, store
//  evidence in the approved repository, write only references/statuses into CRM
//  as appropriate."
// "SOA evidence write failure -> marketing gate stays locked."
//
// ─── WHAT THIS REPLACES ──────────────────────────────────────────────────────
// api/sign-soa.js generated the PDF, hashed it, posted a base64 copy to the CRM
// and then DISCARDED the bytes. src/lib/soaContent.ts already listed this as
// enablement blocker #2: "PDF NOT PERSISTED — sign-soa generates the PDF, hashes
// it, and discards it; Clear Point could not produce the signed document on
// request." The signed record was also written back through the 24-hour signing
// token store, so the evidence expired the next day (blocker #3).
//
// ─── WHY THERE IS NO PROVIDER SDK HERE ───────────────────────────────────────
// This module deliberately speaks a generic authenticated-PUT protocol
// configured by environment, rather than hardcoding a particular blob
// provider's API from memory. Writing an unverified provider call would be
// exactly the kind of fabricated detail the master prompt forbids, and a
// storage call that is wrong fails at the worst possible moment — after a
// beneficiary has signed.
//
// Consequence, stated plainly: until CY2027_EVIDENCE_STORE_URL and
// CY2027_EVIDENCE_STORE_TOKEN are set, isConfigured() is false and
// putEvidence() REFUSES rather than pretending. The caller must then keep the
// marketing gate locked. That is the fail-closed behaviour the spec demands;
// it is not the same as the feature being finished.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { RECORD_CLASS, RETENTION_YEARS } from './retention.js';

/** Where evidence lives. Null when unconfigured. */
function config(env = process.env) {
  const url = (env.CY2027_EVIDENCE_STORE_URL || '').trim().replace(/\/+$/, '');
  const token = (env.CY2027_EVIDENCE_STORE_TOKEN || '').trim();
  if (!url || !token) return null;
  if (!/^https:\/\//i.test(url)) return null; // never ship evidence over plaintext
  return { url, token };
}

/** True when a durable evidence store is actually configured. */
export function isConfigured(env = process.env) {
  return config(env) !== null;
}

/**
 * Why the store is unusable, for the health check and the enablement gate.
 * Returns null when everything is in place.
 */
export function configurationProblem(env = process.env) {
  const url = (env.CY2027_EVIDENCE_STORE_URL || '').trim();
  const token = (env.CY2027_EVIDENCE_STORE_TOKEN || '').trim();
  if (!url && !token) return 'EVIDENCE_STORE_NOT_CONFIGURED';
  if (!url) return 'EVIDENCE_STORE_URL_MISSING';
  if (!token) return 'EVIDENCE_STORE_TOKEN_MISSING';
  if (!/^https:\/\//i.test(url)) return 'EVIDENCE_STORE_URL_NOT_HTTPS';
  return null;
}

/**
 * Deterministic object path. Partitioned by plan year and state so a CMS or
 * carrier audit scoped to one year/jurisdiction can be served without scanning
 * everything, and suffixed with the integrity hash so the same evidence can
 * never be silently overwritten by different bytes.
 */
export function evidencePath(instance, integrityHash) {
  const year = instance.planYear;
  const state = String(instance.state || 'XX').toUpperCase();
  const short = String(integrityHash || '').replace(/^sha256:/, '').slice(0, 16);
  return `soa-evidence/${year}/${state}/${instance.soaId}-${short}.pdf`;
}

/**
 * Persist the signed PDF plus its evidence record.
 *
 * Returns `{ ok: true, uri, storedAt, recordClass, retentionYears }` or
 * `{ ok: false, reason }`. It NEVER throws for a configuration or network
 * problem, because the caller must be able to distinguish "could not store"
 * from "crashed" and respond honestly to a beneficiary who has already signed.
 */
export async function putEvidence({ instance, integrityHash, pdfBuffer, evidenceRecord, env = process.env, fetchImpl = fetch }) {
  const problem = configurationProblem(env);
  if (problem) return { ok: false, reason: problem };
  if (!instance || !instance.soaId) return { ok: false, reason: 'NO_INSTANCE' };
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) return { ok: false, reason: 'NO_PDF_BYTES' };
  if (!integrityHash) return { ok: false, reason: 'NO_INTEGRITY_HASH' };

  const { url, token } = config(env);
  const path = evidencePath(instance, integrityHash);
  const pdfSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  try {
    const res = await fetchImpl(`${url}/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/pdf',
        // Metadata the auditor needs without opening the object. Retention is
        // declared here so a lifecycle policy cannot quietly outlive it.
        'x-soa-id': String(instance.soaId),
        'x-soa-plan-year': String(instance.planYear),
        'x-soa-state': String(instance.state),
        'x-soa-integrity-hash': String(integrityHash),
        'x-soa-pdf-sha256': pdfSha256,
        'x-record-class': RECORD_CLASS.SOA_EVIDENCE,
        'x-retention-years': String(RETENTION_YEARS[RECORD_CLASS.SOA_EVIDENCE]),
      },
      body: pdfBuffer,
    });
    if (!res || !res.ok) {
      return { ok: false, reason: 'EVIDENCE_STORE_REJECTED', status: res ? res.status : null };
    }
    // The evidence record travels beside the PDF so the stored artifact is
    // self-describing: the exact wording shown, the selections, the versions.
    const metaRes = await fetchImpl(`${url}/${path}.json`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-record-class': RECORD_CLASS.SOA_EVIDENCE,
        'x-retention-years': String(RETENTION_YEARS[RECORD_CLASS.SOA_EVIDENCE]),
      },
      body: JSON.stringify(evidenceRecord || {}),
    });
    if (!metaRes || !metaRes.ok) {
      // A PDF with no evidence record is not evidence — it cannot explain what
      // the person was shown. Treat a half-write as a failure.
      return { ok: false, reason: 'EVIDENCE_RECORD_REJECTED', status: metaRes ? metaRes.status : null };
    }
    return {
      ok: true,
      uri: `${url}/${path}`,
      pdfSha256,
      storedAt: new Date().toISOString(),
      recordClass: RECORD_CLASS.SOA_EVIDENCE,
      retentionYears: RETENTION_YEARS[RECORD_CLASS.SOA_EVIDENCE],
    };
  } catch (e) {
    return { ok: false, reason: 'EVIDENCE_STORE_UNREACHABLE', detail: e && e.message ? String(e.message).slice(0, 120) : null };
  }
}

/**
 * Retrieve stored evidence by URI. Used to answer "produce the signed document"
 * — which is the whole reason the store exists.
 */
export async function getEvidence(uri, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = config(env);
  if (!cfg) return { ok: false, reason: configurationProblem(env) };
  if (!uri || !uri.startsWith(cfg.url + '/')) return { ok: false, reason: 'URI_OUTSIDE_STORE' };
  try {
    const res = await fetchImpl(uri, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res || !res.ok) return { ok: false, reason: 'NOT_RETRIEVABLE', status: res ? res.status : null };
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, bytes: buf, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  } catch (e) {
    return { ok: false, reason: 'EVIDENCE_STORE_UNREACHABLE', detail: e && e.message ? String(e.message).slice(0, 120) : null };
  }
}

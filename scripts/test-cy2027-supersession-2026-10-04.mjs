// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — SOA SUPERSESSION AND THE APPOINTMENT LEDGER (spec §9, §26, §31;
// audit EV-09, WVG-11).
//
//   EV-09   "Editing categories creates a new version/instance with
//           supersession history; duplicate SOA submissions must preserve both
//           versions with the active instance defined explicitly, and
//           SOA_SUPERSEDES_ID must be recorded." superseded() existed and
//           nothing called it; a signed instance was stored under its own id
//           only, so a second signature for the same appointment could not
//           find the first and became a second COMPLETED scope, silently.
//   WVG-11  "Duplicate contact/SOA -> reconcile; never create conflicting
//           active scopes silently." The consumed flag was already written
//           through the reporting setRecord() when this suite was written; the
//           lossy getSoaToken/setSoaToken pair was still exported (dead), the
//           burn came AFTER the evidence write (an orphaned signature beside a
//           link that still worked), and a KV READ outage read as "absent".
//
// Every rule is exercised by CALLING it: supersede()/activeSoaInstance() with
// each refusal; the ledger driven in process against the memory store, and in
// a child process against a laboratory KV (globalThis.fetch replaced — nothing
// leaves this machine) with a failure injected at each filing stage.
//
// AUDIT 2026-10-04 (red team) — the handlers' wiring used to be checked by
// structural scans. Three single-line mutants ADDED after the scanned lines
// (lock overridden, ledger read overridden, reconciliation refusal overridden)
// passed every scan while the control failed open in the real handler. The
// three SOA handlers are now DRIVEN, in a third child, against the same
// laboratory doubles: every claim is a response, a stored record or an audit
// line observed. Only what must be ABSENT from the source is still scanned.
// The same red team found the signer bound by a body claim, the mirror stage
// reported as "not filed" after the ledger had switched, a burnt link that
// claimed a signature, a status deny-list, absent == absent in supersede(),
// an 'EXISTING' audit for an unchecked id and an unowned lock release; each is
// a behaviour asserted here, by calling the rule or driving the handler.
//
// Run: node scripts/test-cy2027-supersession-2026-10-04.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SOA_STATUS, SOA_SCOPE_PROBLEM, createSoaInstance, completeSoaInstance, revokeSoaInstance,
  supersede, superseded, activeSoaInstance, marketingGate,
} from '../api/_lib/cy2027/soa-instance.js';
import { CMS_RULESET_2027 } from '../api/_lib/cy2027/rulesets.js';
import { buildEvidenceRecord, AUDIT_ACTIONS } from '../api/_lib/cy2027/evidence.js';
import {
  LEDGER_TTL_SEC, APPOINTMENT_LOCK_TTL_SEC, SIGNATURE_FILING_STAGE, LEDGER_REFUSAL,
  appointmentIdForReissue, appointmentLedgerKey, appointmentLockKey, signedRecordKey, beneficiaryKeyFor, signerIdentityProblem,
  ledgerEntryFor, readLedger, reconcileSignature, fileSignature, claimAppointmentLock, releaseAppointmentLock,
} from '../api/_lib/cy2027/soa-ledger.js';
import { storeKeyFor } from '../api/_lib/cy2027/secure-link.js';
import * as store from '../api/_lib/soa-store.js';
import { stripComments, unfrozenPaths, GOVERNING_IDENTIFIERS } from './no-self-modification-lib.mjs';

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };
const throws = (label, fn, re) => {
  try { fn(); failures.push(label + '\n        did not throw'); }
  catch (e) { if (!re || re.test(String(e && e.message))) passed++; else failures.push(label + '\n        threw: ' + (e && e.message)); }
};
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src) => stripComments(src);
/** A structural scan anchored to a line start: a leading `if (false)` or a comment cannot satisfy it. */
const line = (re) => new RegExp('^[ \\t]*' + re.source, 'm' + re.flags.replace('m', ''));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CHILD = process.env.CY2027_SUPERSESSION_CHILD || '';
const IN_CY2027 = new Date('2026-11-01T12:00:00Z');
const APPT = 'appt_1f3a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const APPT_2 = 'appt_2f3a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

const baseInput = {
  soaId: 'soa_1', appointmentId: APPT, appointmentAt: '2026-11-10T15:00:00Z',
  appointmentFormat: 'TELEPHONE', planYear: 2027, state: 'NY', zip: '11717', county: 'Suffolk',
  language: 'en', languageSource: 'BENEFICIARY_ELECTED',
  method: 'WEB_ELECTRONIC_SIGNATURE', beneficiaryName: 'Jane Q Public',
  selectedCategories: ['MA_WITH_RX'], stateRulesetVersion: 'NY-CY2027-v1.0', soaFormVersion: 'CP-SOA-NY-CY2027-v1.0',
  cmsRulesetVersion: 'CMS_RULESET_2027-v1.0',
};
const mk = (over = {}) => {
  const b = createSoaInstance({ ...baseInput, ...over });
  if (!b.ok) throw new Error('fixture instance refused: ' + JSON.stringify(b.errors));
  return b.instance;
};
let evSeq = 0;
const sign = (inst, over = {}) => completeSoaInstance(inst, {
  completedAt: '2026-11-10T14:00:00Z', integrityHash: 'sha256:' + String(++evSeq).padStart(4, '0'), evidenceReference: 'ev://' + inst.soaId, ...over,
});
const appt = { appointmentId: APPT, startsAt: '2026-11-10T15:00:00Z', state: 'NY', format: 'TELEPHONE' };
const PHONE_A = '7185550123';
const PHONE_B = '2125550199';

// ═════════════════════════════════════════════════════════════════════════════
// The store-driven section. Runs in a CHILD process so the store's environment
// is controlled: 'memory' (no KV configured) and 'kv' (a laboratory KV behind a
// replaced fetch, with failures injected where the test says).
// ═════════════════════════════════════════════════════════════════════════════
async function storeSection(mode) {
  const lab = {
    data: new Map(),
    log: [],
    failWhen: () => false,
    reset() { this.log = []; this.failWhen = () => false; },
  };
  if (mode === 'kv') {
    ok('kv child: the store sees a configured KV', store.KV_AVAILABLE === true);
    const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://kv.invalid/get/')) {
        const key = decodeURIComponent(u.slice('https://kv.invalid/get/'.length));
        lab.log.push(['GET', key]);
        if (lab.failWhen('GET', key)) return respond(500, { error: 'lab outage' });
        return respond(200, { result: lab.data.has(key) ? lab.data.get(key) : null });
      }
      if (u === 'https://kv.invalid/pipeline') {
        const cmds = JSON.parse(opts.body);
        const results = [];
        for (const c of cmds) {
          const [verb, key] = c;
          if (verb === 'SET') {
            const nx = c.includes('NX');
            lab.log.push([nx ? 'SETNX' : 'SET', key]);
            if (lab.failWhen(nx ? 'SETNX' : 'SET', key)) return respond(500, { error: 'lab outage' });
            if (nx && lab.data.has(key)) { results.push({ result: null }); continue; }
            lab.data.set(key, c[2]);
            results.push({ result: 'OK' });
          } else if (verb === 'DEL') {
            lab.log.push(['DEL', key]);
            if (lab.failWhen('DEL', key)) return respond(500, { error: 'lab outage' });
            results.push({ result: lab.data.delete(key) ? 1 : 0 });
          } else {
            results.push({ error: 'unknown verb ' + verb });
          }
        }
        return respond(200, results);
      }
      throw new Error('the suite must not reach ' + u.slice(0, 60));
    };
  } else {
    ok('memory child: the store sees no KV', store.KV_AVAILABLE === false);
    globalThis.fetch = async (url) => { throw new Error('the memory child must not fetch ' + String(url).slice(0, 60)); };
  }
  const keyA = beneficiaryKeyFor(PHONE_A);
  const keyB = beneficiaryKeyFor(PHONE_B);
  const signedRecordFor = (instance) => ({
    soaId: instance.soaId, signedAt: instance.completedAt, pdfHash: 'pdf-' + instance.soaId, instance,
    evidenceUri: instance.evidenceReference, integrityHash: instance.integrityHash, recordClass: 'SOA_EVIDENCE', sensitivityClass: 'COMPLIANCE_EVIDENCE',
  });
  const TTL = 6 * 365 * 24 * 60 * 60;

  // ── the lock ─────────────────────────────────────────────────────────────
  {
    const l1 = await claimAppointmentLock(APPT);
    ok(`${mode}: the appointment lock is claimed, with a holder token`, l1.ok === true && typeof l1.holder === 'string' && l1.holder.length >= 16);
    const l2 = await claimAppointmentLock(APPT);
    ok(`${mode}: a second claim while held is BUSY, named`, l2.ok === false && l2.reason === 'SOA_APPOINTMENT_BUSY');
    // AUDIT 2026-10-04 (WVG-11, red team) — the release was an unconditional DEL:
    // a request that outlived the TTL released the lock a later request held.
    const wrong = await releaseAppointmentLock(APPT, 'not-the-holder');
    ok(`${mode} (red team): a release by anyone but the holder is refused, named, and the lock stays`,
      wrong.ok === false && wrong.reason === 'SOA_APPOINTMENT_LOCK_NOT_HELD' && (await claimAppointmentLock(APPT)).reason === 'SOA_APPOINTMENT_BUSY');
    const noHolder = await releaseAppointmentLock(APPT);
    ok(`${mode} (red team): a release that names no holder is refused`, noHolder.ok === false && noHolder.reason === 'SOA_APPOINTMENT_LOCK_FAILED');
    const rel = await releaseAppointmentLock(APPT, l1.holder);
    ok(`${mode}: the holder releases it`, rel.ok === true);
    const gone = await releaseAppointmentLock(APPT, l1.holder);
    ok(`${mode} (red team): releasing a lock that is no longer there says EXPIRED — this request outlived its lock`, gone.ok === false && gone.reason === 'SOA_APPOINTMENT_LOCK_EXPIRED');
    const l3 = await claimAppointmentLock(APPT);
    ok(`${mode}: and it can be claimed again, by a new holder`, l3.ok === true && l3.holder !== l1.holder);
    await releaseAppointmentLock(APPT, l3.holder);
    const other = await claimAppointmentLock(APPT_2);
    ok(`${mode}: another appointment is not blocked by this one`, other.ok === true);
    await releaseAppointmentLock(APPT_2, other.holder);
    if (mode === 'kv') {
      ok('kv: the claim is a SET … NX, the release a read of the holder then a DEL',
        lab.log.some((e) => e[0] === 'SETNX' && e[1] === appointmentLockKey(APPT)) && lab.log.some((e) => e[0] === 'GET' && e[1] === appointmentLockKey(APPT)) &&
        lab.log.some((e) => e[0] === 'DEL' && e[1] === appointmentLockKey(APPT)) && !lab.log.some((e) => e[0] === 'SET' && e[1] === appointmentLockKey(APPT)));
      lab.reset();
      lab.failWhen = (op) => op === 'SETNX';
      const lf = await claimAppointmentLock(APPT);
      ok('kv: a claim the store could not make is LOCK_FAILED, never "claimed"', lf.ok === false && lf.reason === 'SOA_APPOINTMENT_LOCK_FAILED');
      lab.reset();
      lab.failWhen = (op) => op === 'DEL';
      const held = await claimAppointmentLock(APPT);
      const rf = await releaseAppointmentLock(APPT, held.holder);
      ok('kv: a release the store could not make is reported', held.ok === true && rf.ok === false && rf.reason === 'KV_WRITE_FAILED');
      lab.reset();
      lab.failWhen = (op, key) => op === 'GET' && key === appointmentLockKey(APPT);
      const rr = await releaseAppointmentLock(APPT, held.holder);
      ok('kv (red team): a release whose ownership could not be read is reported, and nothing is deleted', rr.ok === false && rr.reason === 'KV_READ_FAILED' && !lab.log.some((e) => e[0] === 'DEL'));
      lab.reset();
      await releaseAppointmentLock(APPT, held.holder);
    }
  }

  // ── the first signature for an appointment ───────────────────────────────
  const first = sign(mk({ soaId: 'soa_1' }));
  let ledger1;
  {
    const r0 = await readLedger(APPT);
    ok(`${mode}: an appointment nobody signed for has an empty ledger`, r0.ok === true && r0.ledger.appointmentId === APPT && r0.ledger.instances.length === 0);
    const rec = reconcileSignature(r0.ledger, mk({ soaId: 'soa_1' }), { beneficiaryKey: keyA, at: '2026-11-10T14:00:00Z' });
    ok(`${mode}: the first signature is FRESH, nothing to supersede`, rec.ok === true && rec.mode === 'FRESH' && rec.previous === null && rec.instance.supersedesId === null);
    const filed = await fileSignature({ ledger: r0.ledger, instance: first, beneficiaryKey: keyA, previous: null, signedRecord: signedRecordFor(first), signedRecordTtlSec: TTL, at: '2026-11-10T14:00:00Z' });
    ok(`${mode}: it files`, filed.ok === true && filed.mode === 'FRESH', JSON.stringify(filed));
    const r1 = await readLedger(APPT);
    ledger1 = r1.ledger;
    ok(`${mode}: the ledger now lists it as COMPLETED, bound to the person`,
      r1.ok && r1.ledger.instances.length === 1 && r1.ledger.instances[0].soaId === 'soa_1' && r1.ledger.instances[0].status === 'COMPLETED' &&
      r1.ledger.instances[0].beneficiaryKey === keyA && r1.ledger.instances[0].supersededById === null);
    ok(`${mode}: and it is the active instance`, activeSoaInstance(r1.ledger.instances).active.soaId === 'soa_1');
    const s1 = await store.readRecord(signedRecordKey('soa_1'));
    ok(`${mode}: the signed record exists under its own key`, s1.ok && s1.value && s1.value.soaId === 'soa_1' && s1.value.instance.status === 'COMPLETED');
  }

  // ── the second signature, same person, same appointment: supersession ────
  const secondBuilt = mk({ soaId: 'soa_2', selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX'] });
  let second;
  {
    const rec = reconcileSignature(ledger1, secondBuilt, { beneficiaryKey: keyA, at: '2026-11-11T09:00:00Z' });
    ok(`${mode}: the second signature SUPERSEDES the first`,
      rec.ok === true && rec.mode === 'SUPERSEDES' && rec.instance.supersedesId === 'soa_1' && rec.previous.soaId === 'soa_1' &&
      rec.previous.status === 'SUPERSEDED' && rec.previous.supersededById === 'soa_2' && rec.previous.supersededAt === '2026-11-11T09:00:00Z', JSON.stringify(rec));
    second = sign(rec.instance, { completedAt: '2026-11-11T09:00:00Z' });
    ok(`${mode}: the replacement completes with SOA_SUPERSEDES_ID on it`, second.status === 'COMPLETED' && second.supersedesId === 'soa_1');

    if (mode === 'kv') lab.reset();
    const filed = await fileSignature({ ledger: ledger1, instance: second, beneficiaryKey: keyA, previous: rec.previous, signedRecord: signedRecordFor(second), signedRecordTtlSec: TTL, at: '2026-11-11T09:00:00Z' });
    ok(`${mode}: the supersession files`, filed.ok === true && filed.mode === 'SUPERSEDES', JSON.stringify(filed));
    if (mode === 'kv') {
      const order = lab.log.filter((e) => e[0] === 'SET').map((e) => e[1]);
      ok('kv: the order is signed record → ledger → mirror of the superseded record',
        same(order, [signedRecordKey('soa_2'), appointmentLedgerKey(APPT), signedRecordKey('soa_1')]), order.join(' | '));
    }
    const r2 = await readLedger(APPT);
    const [e1, e2] = r2.ledger.instances;
    ok(`${mode}: BOTH versions are preserved in the ledger`, r2.ok && r2.ledger.instances.length === 2 && e1.soaId === 'soa_1' && e2.soaId === 'soa_2');
    ok(`${mode}: the first is SUPERSEDED, naming its successor and when`,
      e1.status === 'SUPERSEDED' && e1.supersededById === 'soa_2' && e1.supersededAt === '2026-11-11T09:00:00Z' && e1.integrityHash === first.integrityHash);
    ok(`${mode}: the second is COMPLETED, naming what it replaced`, e2.status === 'COMPLETED' && e2.supersedesId === 'soa_1' && e2.supersededById === null);
    const act = activeSoaInstance(r2.ledger.instances);
    ok(`${mode}: exactly one active instance, the second`, act.ok === true && act.active.soaId === 'soa_2');
    const s1 = await store.readRecord(signedRecordKey('soa_1'));
    ok(`${mode}: the first signed record is mirrored SUPERSEDED, its evidence intact`,
      s1.ok && s1.value.instance.status === 'SUPERSEDED' && s1.value.instance.supersededById === 'soa_2' && s1.value.integrityHash === first.integrityHash && s1.value.pdfHash === 'pdf-soa_1');
    const s2 = await store.readRecord(signedRecordKey('soa_2'));
    ok(`${mode}: the second signed record is COMPLETED`, s2.ok && s2.value.instance.status === 'COMPLETED' && s2.value.instance.supersedesId === 'soa_1');
    ledger1 = r2.ledger;
  }

  // ── what cannot supersede, and leaves the ledger untouched ───────────────
  {
    const before = JSON.stringify((await readLedger(APPT)).ledger);
    const other = reconcileSignature(ledger1, mk({ soaId: 'soa_3' }), { beneficiaryKey: keyB, at: '2026-11-12T09:00:00Z' });
    ok(`${mode}: another phone cannot replace this person's scope`, other.ok === false && other.reason === 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH');
    const renamed = reconcileSignature(ledger1, mk({ soaId: 'soa_3', beneficiaryName: 'John Q Public' }), { beneficiaryKey: keyA, at: '2026-11-12T09:00:00Z' });
    ok(`${mode}: another name on the same phone is refused, field named`,
      renamed.ok === false && renamed.reason === 'SOA_SUPERSESSION_REFUSED' && renamed.errors.beneficiaryName === 'supersession_changes_beneficiary');
    const noKey = reconcileSignature(ledger1, mk({ soaId: 'soa_3' }), { at: '2026-11-12T09:00:00Z' });
    ok(`${mode}: no proven phone, no supersession`, noKey.ok === false && noKey.reason === 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH');
    const after = JSON.stringify((await readLedger(APPT)).ledger);
    ok(`${mode}: a refused reconciliation writes nothing`, before === after);

    // Preconditions of the filing itself, each refused by name with nothing written.
    const third = sign(mk({ soaId: 'soa_3' }), { completedAt: '2026-11-12T09:00:00Z' });
    const pre = (args) => fileSignature({ ledger: ledger1, instance: third, beneficiaryKey: keyA, previous: null, signedRecord: signedRecordFor(third), signedRecordTtlSec: TTL, ...args });
    const p1 = await pre({ instance: mk({ soaId: 'soa_3' }), signedRecord: signedRecordFor(mk({ soaId: 'soa_3' })) });
    ok(`${mode}: an uncompleted instance cannot be filed`, p1.ok === false && p1.stage === 'PRECONDITION' && p1.reason === 'INSTANCE_NOT_COMPLETED');
    const p2 = await pre({ instance: second, signedRecord: signedRecordFor(second), previous: null });
    ok(`${mode}: an instance already in the ledger cannot be filed twice`, p2.ok === false && p2.reason === 'ALREADY_FILED');
    const p3 = await pre({});
    ok(`${mode}: a fresh filing while another instance is active is refused (ACTIVE_INSTANCE_CHANGED)`, p3.ok === false && p3.reason === 'ACTIVE_INSTANCE_CHANGED');
    const supersedesSecond = sign({ ...mk({ soaId: 'soa_3' }), supersedesId: 'soa_2' }, { completedAt: '2026-11-12T09:00:00Z' });
    const p4 = await pre({ instance: supersedesSecond, signedRecord: signedRecordFor(supersedesSecond), previous: null });
    ok(`${mode}: an instance that claims a supersession needs the previous record`, p4.ok === false && p4.reason === 'SUPERSESSION_INCONSISTENT');
    const wrongPrev = { ...ledger1.instances[1], status: 'SUPERSEDED', supersededById: 'soa_9', supersededAt: '2026-11-12T09:00:00Z' };
    const p5 = await pre({ instance: supersedesSecond, signedRecord: signedRecordFor(supersedesSecond), previous: wrongPrev });
    ok(`${mode}: a previous that names a different successor is refused`, p5.ok === false && p5.reason === 'SUPERSESSION_INCONSISTENT');
    const p6 = await pre({ signedRecord: { ...signedRecordFor(third), soaId: 'soa_2' } });
    ok(`${mode}: a signed record for a different id is refused`, p6.ok === false && p6.reason === 'SIGNED_RECORD_MISMATCH');
    const p7 = await pre({ beneficiaryKey: null });
    ok(`${mode}: no beneficiary key, no filing`, p7.ok === false && p7.reason === 'BENEFICIARY_KEY_MISSING');
    const p8 = await pre({ ledger: { appointmentId: APPT_2, instances: [] } });
    ok(`${mode}: a ledger of another appointment is refused`, p8.ok === false && p8.reason === 'SOA_LEDGER_APPOINTMENT_MISMATCH');
    const p9 = await pre({ signedRecordTtlSec: 0 });
    ok(`${mode}: a zero TTL is refused`, p9.ok === false && p9.reason === 'TTL_INVALID');
    ok(`${mode}: none of the refused filings wrote anything`, JSON.stringify((await readLedger(APPT)).ledger) === before &&
      (await store.readRecord(signedRecordKey('soa_3'))).value === null);
  }

  // ── the ledger is re-read before it is written (WVG-11, red team) ────────
  {
    const cur = (await readLedger(APPT)).ledger;
    const rec = reconcileSignature(cur, mk({ soaId: 'soa_4' }), { beneficiaryKey: keyA, at: '2026-11-13T09:00:00Z' });
    const inst = sign(rec.instance, { completedAt: '2026-11-13T09:00:00Z' });
    const args = { ledger: cur, instance: inst, beneficiaryKey: keyA, previous: rec.previous, signedRecord: signedRecordFor(inst), signedRecordTtlSec: TTL, at: '2026-11-13T09:00:00Z' };
    // Another writer changes the ledger between this request's read and its write.
    await store.setRecord(appointmentLedgerKey(APPT), { ...cur, updatedAt: '2026-11-13T09:00:01Z' }, TTL);
    const changed = await fileSignature(args);
    const now = (await readLedger(APPT)).ledger;
    ok(`${mode} (red team): a ledger that changed since it was read is refused at the LEDGER stage, named, and NOT overwritten`,
      rec.ok === true && changed.ok === false && changed.stage === 'LEDGER' && changed.reason === 'LEDGER_CHANGED' &&
      now.updatedAt === '2026-11-13T09:00:01Z' && activeSoaInstance(now.instances).active.soaId === 'soa_2', JSON.stringify(changed));
    await store.setRecord(appointmentLedgerKey(APPT), cur, TTL);
    const healthy = await fileSignature(args);
    ok(`${mode}: restored to what was read, the same filing goes through`, healthy.ok === true && healthy.mirror && healthy.mirror.ok === true &&
      activeSoaInstance((await readLedger(APPT)).ledger.instances).active.soaId === 'soa_4', JSON.stringify(healthy));
    ledger1 = (await readLedger(APPT)).ledger;
  }

  // ── a ledger that cannot define an active instance is a refusal, not empty
  {
    const conflicted = { appointmentId: APPT_2, instances: [ledgerEntryFor(sign(mk({ soaId: 'c1', appointmentId: APPT_2 })), keyA), ledgerEntryFor(sign(mk({ soaId: 'c2', appointmentId: APPT_2 })), keyA)], updatedAt: 'x' };
    const w = await store.setRecord(appointmentLedgerKey(APPT_2), conflicted, TTL);
    ok(`${mode}: (fixture) a conflicting ledger is planted`, w.ok === true);
    const r = await readLedger(APPT_2);
    const rec = reconcileSignature(r.ledger, mk({ soaId: 'c3', appointmentId: APPT_2 }), { beneficiaryKey: keyA });
    ok(`${mode}: two COMPLETED instances are a named conflict, never "the latest wins"`,
      rec.ok === false && rec.reason === 'SOA_ACTIVE_SCOPE_CONFLICT' && same(rec.soaIds, ['c1', 'c2']), JSON.stringify(rec));
    const c3 = sign(mk({ soaId: 'c3', appointmentId: APPT_2 }));
    const filed = await fileSignature({ ledger: r.ledger, instance: c3, beneficiaryKey: keyA, previous: null, signedRecord: signedRecordFor(c3), signedRecordTtlSec: TTL });
    ok(`${mode}: and nothing can be filed on top of it`, filed.ok === false && filed.stage === 'PRECONDITION' && filed.reason === 'SOA_ACTIVE_SCOPE_CONFLICT');
    await store.setRecord(appointmentLedgerKey(APPT_2), { appointmentId: 'somebody-else', instances: [] }, TTL);
    const wrong = await readLedger(APPT_2);
    ok(`${mode}: a ledger stored under the wrong appointment is refused`, wrong.ok === false && wrong.reason === 'SOA_LEDGER_APPOINTMENT_MISMATCH');
    await store.setRecord(appointmentLedgerKey(APPT_2), { appointmentId: APPT_2, instances: 'not-a-list' }, TTL);
    const shape = await readLedger(APPT_2);
    ok(`${mode}: a ledger of the wrong shape is refused`, shape.ok === false && shape.reason === 'SOA_LEDGER_UNREADABLE');
    await store.setRecord(appointmentLedgerKey(APPT_2), [1, 2], TTL);
    const arr = await readLedger(APPT_2);
    ok(`${mode}: an array is not a ledger`, arr.ok === false && arr.reason === 'SOA_LEDGER_UNREADABLE');
  }

  // ── the store itself (WVG-11): what it exports, and that nothing defaults ─
  {
    ok(`${mode}: the store exports exactly the reporting primitives — no lossy helper`,
      same(Object.keys(store).sort(), ['KV_AVAILABLE', 'SOA_TOKEN_TTL_SEC', 'claimRecord', 'deleteRecord', 'getRecord', 'leadKey', 'readRecord', 'setRecord']),
      Object.keys(store).sort().join(','));
    const absent = await store.readRecord('soa-appointment:never');
    ok(`${mode}: an absent key reads as ok + null, not as a failure`, absent.ok === true && absent.value === null);
    const w = await store.setRecord('lab:thing', { a: 1 }, 60);
    const back = await store.readRecord('lab:thing');
    ok(`${mode}: a written record reads back`, w.ok === true && back.ok === true && back.value.a === 1);
    const c1 = await store.claimRecord('lab:claim', { x: 1 }, 60);
    const c2 = await store.claimRecord('lab:claim', { x: 2 }, 60);
    const d = await store.deleteRecord('lab:claim');
    const c3 = await store.claimRecord('lab:claim', { x: 3 }, 60);
    ok(`${mode}: claim / claim again / delete / claim`, c1.claimed === true && c2.ok === true && c2.claimed === false && d.ok === true && c3.claimed === true);
    ok(`${mode}: the claimed value is the first writer's`, (await store.readRecord('lab:claim')).value.x === 3);
  }

  if (mode === 'kv') {
    // ── failures injected at each stage, observed: nothing defaults ─────────
    lab.reset();
    lab.failWhen = (op) => op === 'GET';
    const rr = await store.readRecord('soa-appointment:any');
    ok('kv: a read the store could not make is a FAILURE, not "absent"', rr.ok === false && rr.reason === 'KV_READ_FAILED');
    const rl = await readLedger(APPT);
    ok('kv: the ledger of an appointment is then unavailable — never empty', rl.ok === false && rl.reason === 'KV_READ_FAILED');
    const legacy = await store.getRecord('soa-appointment:any');
    ok('kv: (contrast) the legacy getRecord turns the same outage into null — which is why the ledger does not use it', legacy === null);
    lab.reset();
    lab.data.set('lab:garbage', '{not json');
    const g = await store.readRecord('lab:garbage');
    ok('kv: a stored value that is not JSON is a failure, not "absent"', g.ok === false && g.reason === 'KV_VALUE_UNREADABLE');
    lab.reset();
    lab.failWhen = (op) => op === 'SET';
    const sw = await store.setRecord('lab:x', { a: 1 }, 60);
    ok('kv: a write the store could not make is reported (WVG-11: the consumed flag goes through this)', sw.ok === false && sw.reason === 'KV_WRITE_FAILED');
    ok('kv: and does NOT land in a memory the next request would never read', (lab.failWhen = () => false, (await store.readRecord('lab:x')).value === null));

    // A new appointment with a first signature on file, then a replacement whose filing fails at each stage.
    const A3 = 'appt_3f3a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
    const f1 = sign(mk({ soaId: 'k1', appointmentId: A3 }));
    lab.reset();
    const base = await readLedger(A3);
    const ff = await fileSignature({ ledger: base.ledger, instance: f1, beneficiaryKey: keyA, previous: null, signedRecord: signedRecordFor(f1), signedRecordTtlSec: TTL });
    ok('kv: (fixture) a first signature is on file', ff.ok === true);
    const stage = async (failOn, soaId) => {
      const cur = (await readLedger(A3)).ledger;
      const rec = reconcileSignature(cur, mk({ soaId, appointmentId: A3 }), { beneficiaryKey: keyA, at: '2026-11-12T09:00:00Z' });
      if (!rec.ok) return { rec };
      const inst = sign(rec.instance, { completedAt: '2026-11-12T09:00:00Z' });
      lab.reset();
      lab.failWhen = failOn;
      const filed = await fileSignature({ ledger: cur, instance: inst, beneficiaryKey: keyA, previous: rec.previous, signedRecord: signedRecordFor(inst), signedRecordTtlSec: TTL, at: '2026-11-12T09:00:00Z' });
      const writes = lab.log.filter((e) => e[0] === 'SET').map((e) => e[1]);
      lab.reset();
      const after = await readLedger(A3);
      return { rec, filed, writes, after, signed: await store.readRecord(signedRecordKey(soaId)), prev: await store.readRecord(signedRecordKey(rec.previous.soaId)) };
    };
    const s1 = await stage((op, key) => op === 'SET' && key === signedRecordKey('k2'), 'k2');
    ok('kv: failure at the signed record stops there — nothing else written, k1 still active',
      s1.rec.mode === 'SUPERSEDES' && s1.filed.ok === false && s1.filed.stage === 'SIGNED_RECORD' && s1.filed.reason === 'KV_WRITE_FAILED' &&
      same(s1.writes, [signedRecordKey('k2')]) && s1.after.ledger.instances.length === 1 && activeSoaInstance(s1.after.ledger.instances).active.soaId === 'k1' &&
      s1.signed.value === null && s1.prev.value.instance.status === 'COMPLETED', JSON.stringify(s1.filed) + ' ' + s1.writes.join('|'));
    const s2 = await stage((op, key) => op === 'SET' && key === appointmentLedgerKey(A3), 'k3');
    ok('kv: failure at the ledger: the new record exists but is unreachable, k1 still active, the mirror untouched',
      s2.filed.ok === false && s2.filed.stage === 'LEDGER' && same(s2.writes, [signedRecordKey('k3'), appointmentLedgerKey(A3)]) &&
      s2.after.ledger.instances.length === 1 && activeSoaInstance(s2.after.ledger.instances).active.soaId === 'k1' &&
      s2.signed.value !== null && s2.prev.value.instance.status === 'COMPLETED', JSON.stringify(s2.filed));
    // AUDIT 2026-10-04 (EV-09, red team) — a mirror failure used to be reported
    // like the two stages before it, and the handler denied a record the
    // ledger already held. The ledger write IS the filing; the lag is reported
    // beside it, named, for the operator.
    const s3 = await stage((op, key) => op === 'SET' && key === signedRecordKey('k1'), 'k4');
    ok('kv (red team): failure at the mirror is NOT a filing failure — the ledger has switched, the signature is filed, and the lag is reported beside it, named',
      s3.filed.ok === true && s3.filed.mode === 'SUPERSEDES' && s3.filed.mirror && s3.filed.mirror.ok === false && s3.filed.mirror.stage === 'SUPERSEDED_MIRROR' &&
      s3.filed.mirror.reason === 'KV_WRITE_FAILED' && s3.filed.mirror.previousSoaId === 'k1' && s3.filed.ledger && s3.filed.ledger.instances.length === 2 &&
      same(s3.writes, [signedRecordKey('k4'), appointmentLedgerKey(A3), signedRecordKey('k1')]) &&
      activeSoaInstance(s3.after.ledger.instances).active.soaId === 'k4' && s3.after.ledger.instances[0].status === 'SUPERSEDED' &&
      s3.prev.value.instance.status === 'COMPLETED', JSON.stringify(s3.filed));
    const s4 = await stage((op, key) => op === 'GET' && key === signedRecordKey('k4'), 'k5');
    ok('kv: a mirror whose previous record cannot be read is filed, the lag named',
      s4.filed.ok === true && s4.filed.mirror.ok === false && s4.filed.mirror.stage === 'SUPERSEDED_MIRROR' && s4.filed.mirror.reason === 'KV_READ_FAILED' &&
      s4.filed.mirror.previousSoaId === 'k4' && activeSoaInstance(s4.after.ledger.instances).active.soaId === 'k5', JSON.stringify(s4.filed));
    lab.reset();
    lab.data.delete(signedRecordKey('k5'));
    const s5 = await stage(() => false, 'k6');
    ok('kv: a mirror whose previous record is missing is filed, the lag named, the ledger having switched',
      s5.filed.ok === true && s5.filed.mirror.ok === false && s5.filed.mirror.reason === 'PREVIOUS_RECORD_MISSING' &&
      activeSoaInstance(s5.after.ledger.instances).active.soaId === 'k6', JSON.stringify(s5.filed));
    const s6 = await stage(() => false, 'k7');
    ok('kv: with the store healthy the same filing succeeds end to end, mirror included',
      s6.filed.ok === true && s6.filed.mode === 'SUPERSEDES' && s6.filed.mirror && s6.filed.mirror.ok === true && activeSoaInstance(s6.after.ledger.instances).active.soaId === 'k7' &&
      s6.prev.value.instance.status === 'SUPERSEDED' && s6.prev.value.instance.supersededById === 'k7', JSON.stringify(s6.filed));
    const A4 = 'appt_4f3a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
    const f0 = sign(mk({ soaId: 'k0', appointmentId: A4 }));
    const freshFiled = await fileSignature({ ledger: { appointmentId: A4, instances: [], updatedAt: null }, instance: f0, beneficiaryKey: keyA, previous: null, signedRecord: signedRecordFor(f0), signedRecordTtlSec: TTL });
    ok('kv: a FRESH filing reports no mirror at all', freshFiled.ok === true && freshFiled.mode === 'FRESH' && freshFiled.mirror === null, JSON.stringify(freshFiled));
    ok('kv: every version is still in the ledger',
      same(s6.after.ledger.instances.map((e) => e.soaId + ':' + e.status), ['k1:SUPERSEDED', 'k4:SUPERSEDED', 'k5:SUPERSEDED', 'k6:SUPERSEDED', 'k7:COMPLETED']),
      s6.after.ledger.instances.map((e) => e.soaId + ':' + e.status).join(','));
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// The handler-driven section (AUDIT 2026-10-04, red team). The three SOA
// handlers run IN PROCESS against a laboratory KV, evidence store and CRM
// double, and every wiring claim is a response, a stored record or an audit
// line observed — never a line of source found. The handlers are gated off in
// production (SOA_ENABLED=false, pinned by test-cp-findings). To drive them,
// this child registers a loader hook that rewrites that ONE declaration to
// true in memory for the three handler modules as they load: the files on
// disk are untouched, the modules keep their own URLs (so their relative
// imports and pdfkit resolve exactly as deployed), and the hook refuses a
// handler whose gate is not declared exactly where it expects.
// ═════════════════════════════════════════════════════════════════════════════
async function handlerSection() {
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`
    export async function load(url, context, nextLoad) {
      const r = await nextLoad(url, context);
      if (!/\\/api\\/(sign-soa|soa-token|soa-status)\\.js$/.test(url)) return r;
      const src = typeof r.source === 'string' ? r.source : new TextDecoder().decode(r.source);
      const parts = src.split('const SOA_ENABLED = false;');
      if (parts.length !== 2) throw new Error('the SOA gate is not declared exactly once in ' + url);
      return { ...r, source: parts.join('const SOA_ENABLED = true;') };
    }
  `));

  const lab = {
    data: new Map(), seq: [], evidence: [], ghl: [],
    failWhen: () => false, evidenceFail: () => false, onOp: () => {},
    reset() { this.seq = []; this.evidence = []; this.ghl = []; this.failWhen = () => false; this.evidenceFail = () => false; this.onOp = () => {}; },
  };
  const respond = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith('https://kv.invalid/get/')) {
      const key = decodeURIComponent(u.slice('https://kv.invalid/get/'.length));
      lab.seq.push('GET ' + key); lab.onOp('GET', key);
      if (lab.failWhen('GET', key)) return respond(500, { error: 'lab outage' });
      return respond(200, { result: lab.data.has(key) ? lab.data.get(key) : null });
    }
    if (u === 'https://kv.invalid/pipeline') {
      const results = [];
      for (const c of JSON.parse(opts.body)) {
        const [verb, key] = c;
        if (verb === 'SET') {
          const op = c.includes('NX') ? 'SETNX' : 'SET';
          lab.seq.push(op + ' ' + key); lab.onOp(op, key);
          if (lab.failWhen(op, key)) return respond(500, { error: 'lab outage' });
          if (op === 'SETNX' && lab.data.has(key)) { results.push({ result: null }); continue; }
          lab.data.set(key, c[2]); results.push({ result: 'OK' });
        } else if (verb === 'DEL') {
          lab.seq.push('DEL ' + key); lab.onOp('DEL', key);
          if (lab.failWhen('DEL', key)) return respond(500, { error: 'lab outage' });
          results.push({ result: lab.data.delete(key) ? 1 : 0 });
        } else if (verb === 'INCR') {
          const n = Number(lab.data.get(key) || 0) + 1; lab.data.set(key, String(n)); results.push({ result: n });
        } else if (verb === 'EXPIRE') {
          results.push({ result: 1 });
        } else results.push({ error: 'unknown verb ' + verb });
      }
      return respond(200, results);
    }
    if (u.startsWith('https://evidence.invalid/')) {
      lab.seq.push('PUT evidence'); lab.evidence.push(u.slice('https://evidence.invalid/'.length));
      if (lab.evidenceFail(u)) return respond(500, { error: 'lab outage' });
      return respond(200, {});
    }
    if (u.startsWith('https://services.leadconnectorhq.com/')) {
      const path = u.slice('https://services.leadconnectorhq.com'.length);
      let body = null; try { body = JSON.parse(opts.body); } catch { body = null; }
      lab.seq.push('GHL ' + path); lab.ghl.push({ path, body });
      if (path === '/contacts/upsert') return respond(200, { contact: { id: 'C1' } });
      if (/\/notes$/.test(path)) return respond(200, { note: { id: 'N1' } });
      return respond(404, { error: 'unrouted' });
    }
    throw new Error('the handler child must not reach ' + u.slice(0, 60));
  };
  const LOGS = [];
  for (const k of ['log', 'warn', 'error']) console[k] = (...a) => { LOGS.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  const audits = () => LOGS.filter((l) => l.includes('[SOA-AUDIT] {')).map((l) => JSON.parse(l.slice(l.indexOf('{'))));
  const audited = (action, result) => audits().find((a) => a.action === action && (result === undefined || a.result === result)) || null;

  const ROOT = new URL('../', import.meta.url);
  const handlerOf = async (p) => (await import(new URL(p, ROOT).href)).default;
  const signSoa = await handlerOf('api/sign-soa.js');
  const soaToken = await handlerOf('api/soa-token.js');
  const soaStatus = await handlerOf('api/soa-status.js');
  ok('handler: the three handlers loaded through the gate hook', typeof signSoa === 'function' && typeof soaToken === 'function' && typeof soaStatus === 'function');

  let ipSeq = 0;
  const mkReq = (body, method = 'POST', url = '/api/x') => {
    ipSeq += 1;
    return {
      method, url,
      headers: { origin: 'https://clearpointsenioradvisors.com', 'x-forwarded-for': '203.0.' + (113 + Math.floor(ipSeq / 200)) + '.' + (ipSeq % 200 + 1), 'user-agent': 'cy2027-suite', 'content-type': 'application/json' },
      readableEnded: true, complete: true, on() {}, get body() { return body; },
    };
  };
  const mkRes = () => { const h = {}; return { statusCode: 200, payload: undefined, setHeader(k, v) { h[k] = v; }, getHeader(k) { return h[k]; }, status(c) { this.statusCode = c; return this; }, json(o) { this.payload = o; return this; }, end(d) { this.payload = d; return this; } }; };
  const run = async (fn, body, method, url) => {
    const res = mkRes(); let threw = null;
    try { await fn(mkReq(body, method, url), res); } catch (e) { threw = String((e && e.stack) || e); }
    return { status: res.statusCode, payload: res.payload, threw };
  };
  const NAME = 'Jane Q Public';
  const issue = async ({ fullName = NAME, phone = PHONE_A, appointmentId } = {}) => {
    const r = await run(soaToken, { fullName, phone, email: '', zip: '11717', language: 'en', ...(appointmentId ? { appointmentId } : {}) });
    ok('handler: (fixture) a signing link is issued', r.status === 200 && typeof r.payload.token === 'string', JSON.stringify(r));
    return r.payload.token;
  };
  const verify = async (token, phone = PHONE_A) => {
    const r = await run(soaStatus, { token, factor: phone.slice(-4) });
    ok('handler: (fixture) the second factor verifies and releases the appointment id', r.status === 200 && typeof r.payload.appointmentId === 'string', JSON.stringify(r));
    return r.payload;
  };
  const signBody = (token, over = {}) => ({
    token, fullName: NAME, phone: PHONE_A, email: '', zip: '11717', address: '',
    acknowledgements: { no_obligation: true, e_signature: true }, signature: NAME,
    language: 'en', languageSource: 'BENEFICIARY_ELECTED', residenceState: 'NY', county: 'Suffolk',
    appointmentFormat: 'TELEPHONE', selectedCategories: ['MA_WITH_RX'], appointmentAt: '2026-11-10T15:00:00Z', ...over,
  });
  // Every signing request starts with an empty operation trace: issuing and
  // verifying a link write the link record too, and must not be mistaken for a burn.
  const sign = (token, over) => { lab.seq = []; lab.ghl = []; lab.evidence = []; return run(signSoa, signBody(token, over)); };
  const status = (token) => run(soaStatus, null, 'GET', '/api/soa-status?token=' + token);
  const kvJson = (key) => (lab.data.has(key) ? JSON.parse(lab.data.get(key)) : null);
  const ledger = (appt) => kvJson(appointmentLedgerKey(appt));
  const linkOf = (token) => kvJson(storeKeyFor(token));
  const activeIds = (appt) => (ledger(appt) || { instances: [] }).instances.filter((e) => e.status === 'COMPLETED').map((e) => e.soaId);
  const note = () => { const n = lab.ghl.find((c) => /\/notes$/.test(c.path) && c.body && typeof c.body.body === 'string' && c.body.body.includes('soa_id')); return n ? n.body.body : ''; };
  const at = (prefix) => lab.seq.findIndex((s) => s.startsWith(prefix));
  const fresh = () => { lab.reset(); LOGS.length = 0; };
  const keyA = beneficiaryKeyFor(PHONE_A);

  // ── the first signature for an appointment ───────────────────────────────
  fresh();
  const t1 = await issue();
  const v1 = await verify(t1);
  const appt = v1.appointmentId;
  const r1 = await sign(t1);
  const soa1 = r1.payload && r1.payload.soaId;
  ok('handler: the first signature is FRESH — 200, the LINK\'s appointment, no predecessor, delivered',
    r1.status === 200 && r1.payload.ok === true && r1.payload.appointmentId === appt && r1.payload.supersedesId === null && r1.payload.ghlDelivered === true && !r1.threw, JSON.stringify(r1));
  ok('handler: the ledger lists it COMPLETED, bound to the lead phone, under the captured name',
    (() => { const L = ledger(appt); return !!L && L.instances.length === 1 && L.instances[0].soaId === soa1 && L.instances[0].status === 'COMPLETED' && L.instances[0].beneficiaryKey === keyA && L.instances[0].beneficiaryName === NAME; })());
  ok('handler: the signed record exists under its own key, COMPLETED', (kvJson(signedRecordKey(soa1)) || {}).instance?.status === 'COMPLETED');
  ok('handler: the order is lock → ledger read → burn → evidence → signed record → ledger write → release → CRM',
    at('SETNX ' + appointmentLockKey(appt)) >= 0 && at('SETNX ' + appointmentLockKey(appt)) < at('GET ' + appointmentLedgerKey(appt)) &&
    at('GET ' + appointmentLedgerKey(appt)) < at('SET soa-link:') && at('SET soa-link:') < at('PUT evidence') && at('PUT evidence') < at('SET ' + signedRecordKey(soa1)) &&
    at('SET ' + signedRecordKey(soa1)) < at('SET ' + appointmentLedgerKey(appt)) && at('SET ' + appointmentLedgerKey(appt)) < at('DEL ' + appointmentLockKey(appt)) &&
    at('DEL ' + appointmentLockKey(appt)) < at('GHL /contacts/upsert'), lab.seq.map((s) => s.replace(/:[^:]{20,}$/, ':…')).join(' | '));
  ok('handler (red team): the link is stamped FILED with the signing time, and only then does the status endpoint say "already used"',
    linkOf(t1).consumedOutcome === 'FILED' && linkOf(t1).signedAt === r1.payload.signedAt && linkOf(t1).soaId === soa1 && (await status(t1)).payload.reason === 'LINK_ALREADY_USED');
  ok('handler: SOA_SIGNED is audited, SOA_SUPERSEDED is not', !!audited('SOA_SIGNED', 'OK') && !audited('SOA_SUPERSEDED'));
  ok('handler: the CRM note says it supersedes nothing and mirrors nothing', /soa_supersedes_id: \(none\)/.test(note()) && /soa_superseded_mirror: \(none\)/.test(note()));
  ok('handler: the lock is released by its holder, without complaint', !lab.data.has(appointmentLockKey(appt)) && !LOGS.some((l) => l.includes('appointment lock not released')));
  const replay = await sign(t1);
  ok('handler: a replay of the filed link is refused as already used, and files nothing', replay.status === 409 && replay.payload.error === 'SOA_LINK_UNUSABLE' && replay.payload.reason === 'LINK_ALREADY_USED' && ledger(appt).instances.length === 1);

  // ── the second signature by the same person: supersession ───────────────
  fresh();
  const t2 = await issue({ appointmentId: appt });
  await verify(t2);
  const r2 = await sign(t2, { selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX'], fullName: 'JANE  q public', signature: 'jane Q PUBLIC' });
  const soa2 = r2.payload && r2.payload.soaId;
  ok('handler: a second signature by the same person SUPERSEDES — 200 naming the predecessor', r2.status === 200 && r2.payload.supersedesId === soa1 && r2.payload.appointmentId === appt, JSON.stringify(r2));
  ok('handler: the ledger keeps BOTH — the first SUPERSEDED naming its successor, the second COMPLETED naming what it replaced',
    (() => { const L = ledger(appt); const [a, b] = L.instances; return L.instances.length === 2 && a.soaId === soa1 && a.status === 'SUPERSEDED' && a.supersededById === soa2 && b.soaId === soa2 && b.status === 'COMPLETED' && b.supersedesId === soa1; })());
  ok('handler (red team): the replacement is filed under the SERVER-captured spelling of the name, not the body\'s',
    ledger(appt).instances[1].beneficiaryName === NAME && (kvJson(signedRecordKey(soa2)) || {}).instance?.beneficiaryName === NAME);
  ok('handler: the first record is mirrored SUPERSEDED under its own key', (kvJson(signedRecordKey(soa1)) || {}).instance?.status === 'SUPERSEDED' && kvJson(signedRecordKey(soa1)).instance.supersededById === soa2);
  ok('handler: SOA_SUPERSEDED is audited naming the previous instance', (audited('SOA_SUPERSEDED', 'OK') || {}).details?.previousSoaId === soa1);
  ok('handler: SOA_SUPERSEDES_ID reaches the CRM note, with the mirror reported OK', note().includes('soa_supersedes_id: ' + soa1) && /soa_superseded_mirror: OK/.test(note()));
  ok('handler: the replacement is FILED on its link too', linkOf(t2).consumedOutcome === 'FILED' && linkOf(t2).signedAt === r2.payload.signedAt);

  // ── who cannot supersede, and what each refusal leaves untouched ─────────
  const untouched = (before) => JSON.stringify(ledger(appt)) === before;
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt, phone: PHONE_B });
    await verify(t, PHONE_B);
    const r = await sign(t, { phone: PHONE_B });
    const trace = lab.seq.slice(); // before the status read below writes the view counter
    ok('handler: another phone cannot replace this person\'s scope — 409 by name, the link intact, nothing burnt, no evidence, no CRM',
      r.status === 409 && r.payload.error === 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH' && (await status(t)).payload.exists === true && untouched(before) &&
      !trace.some((s) => s.startsWith('SET soa-link:')) && !trace.includes('PUT evidence') && !trace.some((s) => s.startsWith('GHL ')) &&
      !lab.data.has(appointmentLockKey(appt)) && !!audited('SOA_REFUSED', 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH'), JSON.stringify(r) + ' ' + trace.join('|'));
  }
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt, fullName: 'Someone Else' });
    await verify(t);
    const r = await sign(t, { fullName: 'Someone Else', signature: 'Someone Else' });
    ok('handler: another name on the same phone is refused by the supersession rule, field named', r.status === 409 && r.payload.error === 'SOA_SUPERSESSION_REFUSED' && r.payload.fields.beneficiaryName === 'supersession_changes_beneficiary' && untouched(before), JSON.stringify(r));
    fresh();
    const t2b = await issue({ appointmentId: appt, fullName: 'Someone Else' });
    await verify(t2b);
    const forged = await sign(t2b, { fullName: NAME, signature: 'Someone Else', selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX', 'MEDICARE_SUPPLEMENT'] });
    const forgedTrace = lab.seq.slice();
    ok('handler (red team): body.fullName = the victim\'s name, signature = the link\'s name — refused as an identity mismatch BEFORE the lock, link intact, nothing written',
      forged.status === 400 && forged.payload.error === 'SOA_IDENTITY_MISMATCH' && forged.payload.field === 'fullName' && untouched(before) &&
      (await status(t2b)).payload.exists === true && forgedTrace.every((s) => !s.startsWith('SETNX') && !s.startsWith('SET soa-') && !s.startsWith('PUT') && !s.startsWith('GHL')),
      JSON.stringify(forged) + ' ' + forgedTrace.join('|'));
    ok('handler (red team): the identity refusal is audited by field, and no name appears in the audit line',
      (() => { const a = audited('SOA_REFUSED', 'SOA_IDENTITY_MISMATCH'); const raw = LOGS.find((l) => l.includes('SOA_IDENTITY_MISMATCH')) || ''; return !!a && a.details.field === 'fullName' && !raw.includes('Someone') && !raw.includes('Jane'); })());
    const wrongSig = await sign(t2b, { fullName: 'Someone Else', signature: NAME });
    ok('handler: a signature that is not the captured name is still refused first', wrongSig.status === 400 && wrongSig.payload.error === 'Signature must match the captured name');
  }
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt });
    await verify(t);
    const r = await sign(t, { phone: PHONE_B });
    ok('handler (red team): a body phone that is not the proven phone is refused as an identity mismatch, the link intact',
      r.status === 400 && r.payload.error === 'SOA_IDENTITY_MISMATCH' && r.payload.field === 'phone' && untouched(before) && (await status(t)).payload.exists === true && lab.ghl.length === 0, JSON.stringify(r));
    const formatted = await sign(t, { phone: '+1 (718) 555-0123' });
    ok('handler: the same phone in another format is the same person', formatted.status === 200 && formatted.payload.supersedesId === soa2, JSON.stringify(formatted));
  }
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt });
    await verify(t);
    const r = await sign(t, { appointmentId: 'appt_00000000-0000-4000-8000-000000000000' });
    ok('handler: a body naming another appointment is refused, the link intact', r.status === 409 && r.payload.error === 'SOA_APPOINTMENT_MISMATCH' && untouched(before) && (await status(t)).payload.exists === true);
  }

  // ── the mirror stage: the ledger has switched, so the signature IS filed ─
  {
    fresh();
    const prevActive = activeIds(appt)[0];
    const t = await issue({ appointmentId: appt });
    await verify(t);
    lab.failWhen = (op, key) => op === 'SET' && key === signedRecordKey(prevActive);
    const r = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    lab.failWhen = () => false;
    ok('handler (red team): a mirror that cannot be written is NOT "not recorded" — 200 naming the predecessor, the ledger switched, the CRM written',
      r.status === 200 && r.payload.supersedesId === prevActive && activeIds(appt).length === 1 && activeIds(appt)[0] === r.payload.soaId &&
      ledger(appt).instances.find((e) => e.soaId === prevActive).status === 'SUPERSEDED' && lab.ghl.some((c) => c.path === '/contacts/upsert'), JSON.stringify(r));
    ok('handler (red team): the lag is named — the old record still reads COMPLETED on its own, and the log, the audit trail and the CRM note all say so',
      (kvJson(signedRecordKey(prevActive)) || {}).instance?.status === 'COMPLETED' && !!audited('SOA_SUPERSEDED', 'OK') &&
      (audited('SOA_EVIDENCE_WRITE_FAILED', 'SUPERSEDED_MIRROR_LAGGING') || {}).details?.previousSoaId === prevActive &&
      LOGS.some((l) => l.includes('reconcile the mirror') && l.includes(prevActive)) && note().includes('soa_superseded_mirror: LAGGING:KV_WRITE_FAILED'));
    ok('handler: the link of a filed-with-lag signature is FILED', linkOf(t).consumedOutcome === 'FILED' && (await status(t)).payload.reason === 'LINK_ALREADY_USED');
  }

  // ── failures after the burn: the link says "used, nothing filed" ─────────
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt });
    await verify(t);
    lab.evidenceFail = () => true;
    const r = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    lab.evidenceFail = () => false;
    const link = linkOf(t);
    ok('handler (red team): an evidence-store failure after the burn is a 503 that records nothing', r.status === 503 && r.payload.error === 'SOA_EVIDENCE_NOT_STORED' && untouched(before) && !lab.data.has(appointmentLockKey(appt)), JSON.stringify(r));
    ok('handler (red team): the consumed link is stamped FAILED at its stage, with NO signing time on it',
      !!link.consumedAt && link.consumedOutcome === 'FAILED' && link.failedStage === 'EVIDENCE_STORE' && link.signedAt === null, JSON.stringify(link));
    ok('handler (red team): the status endpoint then says "used, unfiled" — never "already signed"', (await status(t)).payload.reason === 'LINK_CONSUMED_UNFILED');
    const again = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    ok('handler: the failed link cannot be re-used, and the refusal names it as unfiled', again.status === 409 && again.payload.reason === 'LINK_CONSUMED_UNFILED' && untouched(before));
  }
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt });
    await verify(t);
    lab.failWhen = (op, key) => op === 'SET' && key.startsWith('soa-signed:') && !activeIds(appt).includes(key.slice('soa-signed:'.length));
    const r = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    lab.failWhen = () => false;
    ok('handler: a failure at the signed-record stage is a 503 naming the stage, nothing active changes, no CRM, the link FAILED at that stage',
      r.status === 503 && r.payload.error === 'SOA_NOT_FILED' && r.payload.stage === 'SIGNED_RECORD' && untouched(before) && lab.ghl.length === 0 &&
      linkOf(t).consumedOutcome === 'FAILED' && linkOf(t).failedStage === 'SIGNED_RECORD' && !!audited('SOA_EVIDENCE_WRITE_FAILED', 'SIGNATURE_NOT_FILED:SIGNED_RECORD'), JSON.stringify(r));
    fresh();
    const t3 = await issue({ appointmentId: appt });
    await verify(t3);
    lab.failWhen = (op, key) => op === 'SET' && key === appointmentLedgerKey(appt);
    const r3 = await sign(t3, { selectedCategories: ['STANDALONE_RX'] });
    lab.failWhen = () => false;
    ok('handler: a failure at the ledger stage is a 503 naming the stage, the previous instance still active, the link FAILED:LEDGER',
      r3.status === 503 && r3.payload.stage === 'LEDGER' && untouched(before) && linkOf(t3).failedStage === 'LEDGER' && (await status(t3)).payload.reason === 'LINK_CONSUMED_UNFILED', JSON.stringify(r3));
  }

  // ── the ledger changed between the read under the lock and the write ─────
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt });
    await verify(t);
    let reads = 0;
    lab.onOp = (op, key) => {
      if (op === 'GET' && key === appointmentLedgerKey(appt)) {
        reads += 1;
        if (reads === 2) lab.data.set(appointmentLedgerKey(appt), JSON.stringify({ ...ledger(appt), updatedAt: '2099-01-01T00:00:00Z' }));
      }
    };
    const r = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    lab.onOp = () => {};
    ok('handler (red team): a ledger that changed under the request is refused at the LEDGER stage as LEDGER_CHANGED, and not overwritten',
      reads === 2 && r.status === 503 && r.payload.error === 'SOA_NOT_FILED' && r.payload.stage === 'LEDGER' && r.payload.reason === 'LEDGER_CHANGED' &&
      ledger(appt).updatedAt === '2099-01-01T00:00:00Z' && linkOf(t).failedStage === 'LEDGER', JSON.stringify(r) + ' reads=' + reads);
    lab.data.set(appointmentLedgerKey(appt), before);
  }

  // ── the lock: concurrency, loss of ownership, store failures ─────────────
  {
    fresh();
    const prevActive = activeIds(appt)[0];
    const ta = await issue({ appointmentId: appt });
    const tb = await issue({ appointmentId: appt });
    await verify(ta); await verify(tb);
    const [a, b] = await Promise.all([sign(ta, { selectedCategories: ['STANDALONE_RX'] }), sign(tb, { selectedCategories: ['MA_WITH_RX'] })]);
    const statuses = [a.status, b.status].sort();
    const busy = a.status === 409 ? a : b;
    const won = a.status === 200 ? a : b;
    ok('handler: two concurrent signatures for one appointment — exactly one files, the other is BUSY by name',
      same(statuses, [200, 409]) && busy.payload.error === 'SOA_APPOINTMENT_BUSY' && won.payload.supersedesId === prevActive && activeIds(appt).length === 1 && !lab.data.has(appointmentLockKey(appt)), JSON.stringify([a.payload, b.payload]));
    const busyToken = a.status === 409 ? ta : tb;
    ok('handler: the BUSY link is intact and signs afterwards, superseding the winner', (await status(busyToken)).payload.exists === true &&
      (await (async () => { const r = await sign(busyToken, { selectedCategories: ['STANDALONE_RX'] }); return r.status === 200 && r.payload.supersedesId === won.payload.soaId; })()));
  }
  {
    fresh();
    const t = await issue({ appointmentId: appt });
    await verify(t);
    let fired = false;
    lab.onOp = (op, key) => {
      if (!fired && op === 'GET' && key === appointmentLedgerKey(appt)) {
        fired = true;
        lab.data.set(appointmentLockKey(appt), JSON.stringify({ appointmentId: appt, holder: 'another-request', claimedAt: '2026-11-10T14:00:00Z' }));
      }
    };
    const r = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    lab.onOp = () => {};
    ok('handler (red team): a lock that another request holds by the time this one releases is NOT deleted, and the loss is named in the log',
      fired && r.status === 200 && (kvJson(appointmentLockKey(appt)) || {}).holder === 'another-request' &&
      LOGS.some((l) => l.includes('[sign-soa] appointment lock not released') && l.includes('SOA_APPOINTMENT_LOCK_NOT_HELD')), JSON.stringify(r));
    lab.data.delete(appointmentLockKey(appt));
  }
  {
    fresh();
    const before = JSON.stringify(ledger(appt));
    const t = await issue({ appointmentId: appt });
    await verify(t);
    lab.failWhen = (op) => op === 'SETNX';
    const r = await sign(t);
    lab.failWhen = () => false;
    ok('handler: a lock the store could not claim is a 503 by name, audited, the link intact', r.status === 503 && r.payload.error === 'SOA_APPOINTMENT_LOCK_FAILED' && !!audited('SOA_REFUSED', 'SOA_APPOINTMENT_LOCK_FAILED') && (await status(t)).payload.exists === true);
    lab.data.set(appointmentLockKey(appt), JSON.stringify({ appointmentId: appt, holder: 'someone', claimedAt: '2026-11-10T14:00:00Z' }));
    const r2 = await sign(t);
    lab.data.delete(appointmentLockKey(appt));
    ok('handler: a lock someone else holds is BUSY, the link intact', r2.status === 409 && r2.payload.error === 'SOA_APPOINTMENT_BUSY' && (await status(t)).payload.exists === true);
    lab.failWhen = (op, key) => op === 'GET' && key === appointmentLedgerKey(appt);
    const r3 = await sign(t);
    lab.failWhen = () => false;
    const trace3 = lab.seq.slice();
    ok('handler: a ledger that cannot be read is a 503 by name — not an empty ledger — the link intact, the lock released, nothing burnt',
      r3.status === 503 && r3.payload.error === 'SOA_LEDGER_UNAVAILABLE' && r3.payload.reason === 'KV_READ_FAILED' && (await status(t)).payload.exists === true &&
      !lab.data.has(appointmentLockKey(appt)) && !trace3.some((s) => s.startsWith('SET soa-link:')) && trace3.includes('DEL ' + appointmentLockKey(appt)) && untouched(before),
      JSON.stringify(r3) + ' ' + trace3.join('|'));
    const r4 = await sign(t, { selectedCategories: ['STANDALONE_RX'] });
    ok('handler: the same link then signs once the store is healthy', r4.status === 200 && r4.payload.supersedesId === activeIdsBefore(before), JSON.stringify(r4));
  }

  // ── a ledger the handler cannot read as "the active instance" ────────────
  {
    let plantedSeq = 0;
    const planted = async (label, instances, reason) => {
      fresh();
      plantedSeq += 1;
      const A = 'appt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee' + plantedSeq.toString(16);
      const stored = JSON.stringify({ appointmentId: A, instances: instances.map((e) => ({ ...e, appointmentId: A })), updatedAt: 'x' });
      lab.data.set(appointmentLedgerKey(A), stored);
      const t = await issue({ appointmentId: A });
      await verify(t);
      const r = await sign(t);
      ok(`handler (red team): a planted ledger with ${label} is refused as ${reason}, the ledger untouched, nothing burnt`,
        r.status === 409 && r.payload.error === reason && lab.data.get(appointmentLedgerKey(A)) === stored && at('SET soa-link:') < 0 && !lab.data.has(appointmentLockKey(A)),
        JSON.stringify(r.payload) + ' appt=' + A);
    };
    const entry = (over = {}) => ({
      soaId: 'p1', planYear: 2027, state: 'NY', beneficiaryName: NAME, beneficiaryKey: keyA, status: 'COMPLETED', completedAt: '2026-11-10T14:00:00Z',
      supersedesId: null, supersededById: null, supersededAt: null, revokedAt: null, integrityHash: 'sha256:p', evidenceReference: 'ev://p', ...over,
    });
    await planted('a lower-case status', [entry({ status: 'completed' })], 'SOA_RECORD_UNREADABLE');
    await planted('a numeric status', [entry({ status: 7 })], 'SOA_RECORD_UNREADABLE');
    await planted('a COMPLETED entry naming a successor', [entry({ supersededById: 'p2' })], 'SOA_RECORD_CONTRADICTORY');
    await planted('two COMPLETED entries', [entry(), entry({ soaId: 'p2' })], 'SOA_ACTIVE_SCOPE_CONFLICT');
    await planted('an entry with no person binding', [entry({ beneficiaryKey: undefined })], 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH');
  }

  // ── the issuer: what its audit claims ────────────────────────────────────
  {
    fresh();
    await issue({ appointmentId: appt });
    ok('handler (red team): a link issued for a caller-named appointment audits REISSUE_REQUESTED — not an existence it did not check',
      (audited('SOA_LINK_ISSUED', 'OK') || {}).details?.appointment === 'REISSUE_REQUESTED');
    fresh();
    const tn = await issue();
    const vn = await verify(tn);
    ok('handler: a link with no appointment named audits NEW and mints a server id', (audited('SOA_LINK_ISSUED', 'OK') || {}).details?.appointment === 'NEW' && /^appt_[0-9a-f-]{36}$/.test(vn.appointmentId));
    fresh();
    const tm = await issue({ appointmentId: 'APPT_' + appt.slice(5) });
    const vm = await verify(tm);
    ok('handler: an appointment id outside the server\'s form is not accepted — a fresh one is minted and audited NEW',
      (audited('SOA_LINK_ISSUED', 'OK') || {}).details?.appointment === 'NEW' && vm.appointmentId !== appt && vm.appointmentId !== 'APPT_' + appt.slice(5));
  }

  function activeIdsBefore(json) { return JSON.parse(json).instances.filter((e) => e.status === 'COMPLETED').map((e) => e.soaId)[0]; }
}

if (CHILD) {
  try {
    if (CHILD === 'handler') await handlerSection();
    else await storeSection(CHILD);
  } catch (e) {
    failures.push(`${CHILD} child threw: ` + (e && e.stack || String(e)));
  }
  process.stdout.write('\nCHILD_RESULT ' + JSON.stringify({ passed, failures }) + '\n');
  process.exit(failures.length ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. supersede() / superseded(): the rule, called with every refusal
// ═════════════════════════════════════════════════════════════════════════════
{
  const done = sign(mk({ soaId: 'soa_1' }));
  const sup = superseded(done, { ...baseInput, soaId: 'soa_2', selectedCategories: ['MA_WITH_RX', 'STANDALONE_RX'] }, { at: '2026-11-11T09:00:00Z' });
  ok('EV-09: a completed instance is superseded by a replacement built from input', sup.ok === true);
  ok('EV-09: the previous is marked SUPERSEDED, names its successor and when',
    sup.previous.status === SOA_STATUS.SUPERSEDED && sup.previous.supersededById === 'soa_2' && sup.previous.supersededAt === '2026-11-11T09:00:00Z');
  ok('EV-09: the previous record stays frozen (SOA-05)', Object.isFrozen(sup.previous));
  ok('EV-09: the replacement carries SOA_SUPERSEDES_ID and is not yet signed',
    sup.instance.supersedesId === 'soa_1' && sup.instance.status === SOA_STATUS.PENDING_SIGNATURE && sup.instance.soaId === 'soa_2');
  ok('EV-09: the previous passed in is untouched', done.status === SOA_STATUS.COMPLETED && done.supersededById === null);
  ok('EV-09: the previous no longer opens the gate, the completed replacement does',
    marketingGate(sup.previous, appt, CMS_RULESET_2027, { now: IN_CY2027 }).reason === 'SOA_SUPERSEDED' &&
    marketingGate(sign(sup.instance), appt, CMS_RULESET_2027, { now: IN_CY2027 }).allowed === true);
  ok('EV-09: the replacement authorizes what it says, not what the previous said',
    same(sup.instance.authorizedCategories, ['MA_WITH_RX', 'STANDALONE_RX']) && same(done.authorizedCategories, ['MA_WITH_RX']));

  const fresh = () => mk({ soaId: 'soa_9' });
  const err = (prev, inst, at) => { const r = supersede(prev, inst, at ? { at } : undefined); return r.ok ? {} : r.errors; };
  ok('EV-09: a PENDING prior cannot be superseded', err(mk({ soaId: 'p' }), fresh()).previous === 'not_completed');
  ok('EV-09: an INCOMPLETE prior cannot be superseded', err(mk({ soaId: 'p', selectedCategories: ['UNSURE_DISCUSS_PROCESS'] }), fresh()).previous === 'not_completed');
  ok('EV-09: a REVOKED prior cannot be superseded', err(revokeSoaInstance(done), fresh()).previous === 'revoked');
  ok('EV-09: a prior with revokedAt set is revoked whatever its status says', err({ ...done, revokedAt: '2026-11-10T16:00:00Z' }, fresh()).previous === 'revoked');
  ok('EV-09: an already superseded prior cannot be superseded again', err(sup.previous, fresh()).previous === 'already_superseded');
  ok('EV-09: a COMPLETED prior that names a successor is already superseded', err({ ...done, supersededById: 'x' }, fresh()).previous === 'already_superseded');
  ok('EV-09: a prior with no id is refused', err({ ...done, soaId: '' }, fresh()).previous === 'unidentified');
  ok('EV-09: a replacement for another appointment is refused', err(done, mk({ soaId: 'soa_9', appointmentId: APPT_2 })).appointmentId === 'supersession_changes_appointment');
  ok('EV-09: a replacement in another plan year is refused', err(done, { ...fresh(), planYear: 2028 }).planYear === 'supersession_changes_plan_year');
  ok('EV-09: a replacement in another state is refused', err(done, { ...fresh(), state: 'NJ' }).state === 'supersession_changes_state');
  ok('EV-09: a replacement for another person is refused', err(done, mk({ soaId: 'soa_9', beneficiaryName: 'John Q Public' })).beneficiaryName === 'supersession_changes_beneficiary');
  ok('EV-09: the same person spelled with other case/spacing is the same person',
    supersede(done, mk({ soaId: 'soa_9', beneficiaryName: '  jane  q PUBLIC ' })).ok === true);
  ok('EV-09: an empty name never matches', err({ ...done, beneficiaryName: '' }, { ...fresh(), beneficiaryName: '' }).beneficiaryName === 'supersession_changes_beneficiary');
  ok('EV-09: a replacement that is already COMPLETED is not a fresh instance', err(done, sign(mk({ soaId: 'soa_9' }))).instance === 'not_a_fresh_instance');
  ok('EV-09: a replacement that authorizes nothing cannot supersede', err(done, mk({ soaId: 'soa_9', selectedCategories: ['UNSURE_DISCUSS_PROCESS'] })).instance === 'nothing_authorized');
  ok('EV-09: a replacement with the prior\'s own id is refused', err(done, mk({ soaId: 'soa_1' })).instance === 'same_id');
  ok('EV-09: a replacement that names a different predecessor is refused', err(done, { ...fresh(), supersedesId: 'soa_0' }).instance === 'supersedes_another');
  ok('EV-09: a replacement that already names this predecessor is accepted', supersede(done, { ...fresh(), supersedesId: 'soa_1' }).ok === true);
  ok('G08/EV-09: the replacement must carry its OWN election',
    err(done, { ...fresh(), languageSource: 'SYSTEM_DEFAULT' }).languageSource === 'election_required' &&
    err(done, { ...fresh(), languageSource: undefined }).languageSource === 'election_required' &&
    err(done, { ...fresh(), language: 'fr' }).languageSource === 'election_required');
  const noElection = superseded(done, { ...baseInput, soaId: 'soa_3', languageSource: undefined });
  ok('G08/EV-09: superseded() refuses an input with no election and marks nothing',
    noElection.ok === false && noElection.errors.languageSource === 'election_required' && !('previous' in noElection));
  // The input-shaped entry point applies the same rule: it cannot be reverted to "build and mark".
  const viaInputPending = superseded(mk({ soaId: 'p' }), { ...baseInput, soaId: 'soa_3' });
  ok('EV-09: superseded() refuses a PENDING prior like supersede() does',
    viaInputPending.ok === false && viaInputPending.errors.previous === 'not_completed' && !('previous' in viaInputPending));
  const viaInputOtherAppt = superseded(done, { ...baseInput, soaId: 'soa_3', appointmentId: APPT_2 });
  ok('EV-09: superseded() refuses another appointment like supersede() does',
    viaInputOtherAppt.ok === false && viaInputOtherAppt.errors.appointmentId === 'supersession_changes_appointment');
  ok('EV-09: several defects are all named at once', (() => {
    const e = err({ ...done, supersededById: 'x' }, { ...mk({ soaId: 'soa_9', appointmentId: APPT_2 }), planYear: 2028, state: 'NJ', beneficiaryName: 'Nobody', languageSource: 'SYSTEM_DEFAULT' });
    return same(Object.keys(e).sort(), ['appointmentId', 'beneficiaryName', 'languageSource', 'planYear', 'previous', 'state']);
  })());
  // AUDIT 2026-10-04 (EV-09, red team) — absent == absent used to be "the same".
  ok('EV-09 (red team): two records that both lack an appointment are not the same appointment', err({ ...done, appointmentId: undefined }, { ...fresh(), appointmentId: undefined }).appointmentId === 'appointment_required');
  ok('EV-09 (red team): two records that both lack a plan year are not the same plan year', err({ ...done, planYear: undefined }, { ...fresh(), planYear: undefined }).planYear === 'plan_year_required');
  ok('EV-09 (red team): two records that both have an empty state are not the same state', err({ ...done, state: '' }, { ...fresh(), state: '' }).state === 'state_required');
  ok('EV-09 (red team): a plan year that is a string is no plan year, on either side',
    err({ ...done, planYear: '2027' }, fresh()).planYear === 'plan_year_required' && err(done, { ...fresh(), planYear: '2027' }).planYear === 'plan_year_required');
  ok('EV-09 (red team): a state that is not a string is no state, never coerced', err({ ...done, state: ['NY'] }, fresh()).state === 'state_required' && err(done, { ...fresh(), state: { toString: () => 'NY' } }).state === 'state_required');
  ok('EV-09 (red team): an appointment id that is not a string is no appointment', err(done, { ...fresh(), appointmentId: [APPT] }).appointmentId === 'appointment_required' && err({ ...done, appointmentId: 7 }, fresh()).appointmentId === 'appointment_required');
  ok('EV-09: the same state in another case still matches', supersede({ ...done, state: 'ny' }, fresh()).ok === true);
  throws('EV-09: nothing to supersede throws', () => supersede(null, fresh()), /nothing to supersede/);
  throws('EV-09: no replacement throws', () => supersede(done, null), /no replacement/);
  throws('EV-09: superseded() with no prior throws', () => superseded(undefined, baseInput), /nothing to supersede/);

  // The integrity hash covers the supersession link and the election.
  const ev = (inst) => buildEvidenceRecord(inst, { stateName: 'New York', signature: 'Jane Q Public', signedAt: '2026-11-11T09:00:00Z' }).integrityHash;
  const a = sup.instance;
  ok('EV-09: the evidence hash covers SOA_SUPERSEDES_ID', ev(a) !== ev({ ...a, supersedesId: null }) && ev(a) !== ev({ ...a, supersedesId: 'soa_0' }));
  ok('G08: the evidence hash covers the election',
    ev({ ...a, languageSource: 'REPRESENTATIVE_ELECTED', representativeRelationship: 'Daughter, POA' }) !==
    ev({ ...a, languageSource: 'BENEFICIARY_ELECTED', representativeRelationship: null }));
  ok('EV-09: the evidence record carries supersedesId',
    buildEvidenceRecord(a, { stateName: 'New York', signature: 'Jane Q Public' }).record.supersedesId === 'soa_1');
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. activeSoaInstance(): THE definition of the active instance
// ═════════════════════════════════════════════════════════════════════════════
{
  const c = (soaId, over = {}) => ({ ...sign(mk({ soaId })), ...over });
  const A = activeSoaInstance;
  ok('WVG-11: no records → no active instance, and that is ok', same(A([]), { ok: true, active: null }));
  ok('WVG-11: one completed → it is active', A([c('a')]).active.soaId === 'a');
  ok('WVG-11: superseded + completed → the completed one', A([c('a', { status: 'SUPERSEDED', supersededById: 'b' }), c('b', { supersedesId: 'a' })]).active.soaId === 'b');
  ok('WVG-11: completed + pending → the completed one', A([c('a'), mk({ soaId: 'b' })]).active.soaId === 'a');
  const conflict = A([c('a'), c('b')]);
  ok('WVG-11: two completed → a CONFLICT naming both, never "the latest wins"',
    conflict.ok === false && conflict.reason === 'SOA_ACTIVE_SCOPE_CONFLICT' && same(conflict.soaIds, ['a', 'b']));
  ok('WVG-11: records of two appointments → refused', A([c('a'), c('b', { appointmentId: APPT_2 })]).reason === 'SOA_APPOINTMENT_MIXED');
  ok('WVG-11: COMPLETED yet naming a successor → contradictory', A([c('a', { supersededById: 'b' })]).reason === 'SOA_RECORD_CONTRADICTORY');
  ok('WVG-11: SUPERSEDED yet naming no successor → contradictory', A([c('a', { status: 'SUPERSEDED' })]).reason === 'SOA_RECORD_CONTRADICTORY');
  ok('WVG-11: a contradictory record is refused even beside a clean one', A([c('b'), c('a', { supersededById: 'b' })]).reason === 'SOA_RECORD_CONTRADICTORY');
  ok('WVG-11: revoked → not active', same(A([{ ...revokeSoaInstance(c('a')) }]), { ok: true, active: null }));
  ok('WVG-11: COMPLETED with revokedAt → not active', same(A([c('a', { revokedAt: '2026-11-10T16:00:00Z' })]), { ok: true, active: null }));
  ok('WVG-11: pending only → not active', same(A([mk({ soaId: 'a' })]), { ok: true, active: null }));
  ok('WVG-11: the same id twice → refused', A([c('a'), c('a')]).reason === 'SOA_RECORD_DUPLICATED');
  ok('WVG-11: not a list → refused', [undefined, null, 'x', {}, 7].every((v) => A(v).reason === 'SOA_RECORDS_UNREADABLE'));
  ok('WVG-11: a record that is not a record → refused',
    [[null], ['x'], [[]], [{}], [{ soaId: 7 }], [{ soaId: '' }]].every((v) => A(v).reason === 'SOA_RECORD_UNREADABLE'));
  // AUDIT 2026-10-04 (EV-09, red team) — statuses were a deny-list of three.
  ok('WVG-11 (red team): a status outside SOA_STATUS is unreadable, named, never silently inactive',
    ['completed', 7, '', null, undefined, 'ACTIVE', ['COMPLETED'], { toString: () => 'COMPLETED' }].every((s) => { const r = A([c('a', { status: s })]); return r.ok === false && r.reason === 'SOA_RECORD_UNREADABLE' && r.soaId === 'a'; }));
  ok('WVG-11 (red team): an unreadable record is refused even beside a clean active one', A([c('b'), c('a', { status: 'completed' })]).reason === 'SOA_RECORD_UNREADABLE');
  ok('WVG-11 (red team): a PENDING record naming a successor contradicts itself', A([{ ...mk({ soaId: 'a' }), supersededById: 'b' }]).reason === 'SOA_RECORD_CONTRADICTORY');
  ok('WVG-11 (red team): a REVOKED record naming a successor contradicts itself', A([{ ...revokeSoaInstance(c('a')), supersededById: 'b' }]).reason === 'SOA_RECORD_CONTRADICTORY');
  ok('WVG-11: every SOA_STATUS value is readable, and only COMPLETED is active',
    Object.values(SOA_STATUS).every((s) => { const r = A([{ ...c('a', { status: s }), supersededById: s === 'SUPERSEDED' ? 'b' : null }]); return r.ok === true && (r.active !== null) === (s === 'COMPLETED'); }));
  ok('WVG-11: the problem vocabulary is frozen and complete',
    unfrozenPaths(SOA_SCOPE_PROBLEM, 'SOA_SCOPE_PROBLEM').length === 0 &&
    same(Object.keys(SOA_SCOPE_PROBLEM), ['RECORDS_UNREADABLE', 'RECORD_UNREADABLE', 'RECORD_DUPLICATED', 'RECORD_CONTRADICTORY', 'APPOINTMENT_MIXED', 'ACTIVE_SCOPE_CONFLICT']));
  ok('WVG-11: and registered with the no-self-modification gate', GOVERNING_IDENTIFIERS.includes('SOA_SCOPE_PROBLEM'));
  ok('EV-09: SOA_SUPERSEDED is a registered audit action', AUDIT_ACTIONS.includes('SOA_SUPERSEDED'));
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. The ledger's pure parts, called
// ═════════════════════════════════════════════════════════════════════════════
{
  ok('EV-09: the server\'s own appointment id form is accepted for re-issue, trimmed',
    appointmentIdForReissue(' ' + APPT + ' ') === APPT);
  ok('EV-09: anything else means a new appointment',
    [undefined, null, 7, [APPT], { toString: () => APPT }, 'appt_x', 'APPT_1F3A2B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B', APPT + 'x', 'soa_1f3a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b', '']
      .every((v) => appointmentIdForReissue(v) === null));
  ok('EV-09: the keys are distinct namespaces',
    appointmentLedgerKey('a') === 'soa-appointment:a' && appointmentLockKey('a') === 'soa-appointment-lock:a' && signedRecordKey('a') === 'soa-signed:a');
  const k = beneficiaryKeyFor(PHONE_A);
  ok('EV-09: the person is bound by a digest of the proven phone, formatting ignored',
    k.startsWith('sha256:') && k === beneficiaryKeyFor('+1' + PHONE_A) && k === beneficiaryKeyFor('(718) 555-0123') && k === beneficiaryKeyFor('1-718-555-0123'));
  ok('EV-09: another phone is another key', beneficiaryKeyFor(PHONE_B) !== k);
  ok('EV-09: no ten-digit number, no key', [undefined, null, '', '12345', 'phone', 7].every((v) => beneficiaryKeyFor(v) === null));
  const done = sign(mk({ soaId: 'soa_1' }));
  const entry = ledgerEntryFor(done, k);
  ok('EV-09: a ledger entry carries what "active" and supersede() need, frozen',
    Object.isFrozen(entry) && same(Object.keys(entry), ['soaId', 'appointmentId', 'planYear', 'state', 'beneficiaryName', 'beneficiaryKey', 'status', 'completedAt', 'supersedesId', 'supersededById', 'supersededAt', 'revokedAt', 'integrityHash', 'evidenceReference']) &&
    entry.status === 'COMPLETED' && entry.beneficiaryKey === k && entry.integrityHash === done.integrityHash);
  throws('EV-09: an entry without the person binding throws', () => ledgerEntryFor(done, null), /beneficiaryKey/);
  throws('EV-09: an entry without an instance throws', () => ledgerEntryFor(null, k), /no instance/);
  ok('EV-09: the TTLs are the evidence retention and a short lock', LEDGER_TTL_SEC === 6 * 365 * 24 * 60 * 60 && APPOINTMENT_LOCK_TTL_SEC === 60);
  ok('EV-09: the stage and refusal vocabularies are frozen',
    unfrozenPaths(SIGNATURE_FILING_STAGE, 'SIGNATURE_FILING_STAGE').length === 0 && unfrozenPaths(LEDGER_REFUSAL, 'LEDGER_REFUSAL').length === 0 &&
    same(Object.values(SIGNATURE_FILING_STAGE), ['PRECONDITION', 'SIGNED_RECORD', 'LEDGER', 'SUPERSEDED_MIRROR']));

  const empty = { appointmentId: APPT, instances: [] };
  const withActive = { appointmentId: APPT, instances: [entry] };
  const R = reconcileSignature;
  ok('EV-09: empty ledger → FRESH', R(empty, mk({ soaId: 'soa_2' }), { beneficiaryKey: k }).mode === 'FRESH');
  ok('EV-09: a FRESH instance that claims a predecessor is refused',
    (() => { const r = R(empty, { ...mk({ soaId: 'soa_2' }), supersedesId: 'soa_0' }, { beneficiaryKey: k }); return r.ok === false && r.reason === 'SOA_SUPERSESSION_REFUSED' && r.errors.instance === 'supersedes_nothing_active'; })());
  const s = R(withActive, mk({ soaId: 'soa_2' }), { beneficiaryKey: k, at: '2026-11-11T09:00:00Z' });
  ok('EV-09: active + same person → SUPERSEDES with both records', s.mode === 'SUPERSEDES' && s.previous.status === 'SUPERSEDED' && s.previous.beneficiaryKey === k && s.instance.supersedesId === 'soa_1');
  ok('EV-09: active + other phone → refused by name', R(withActive, mk({ soaId: 'soa_2' }), { beneficiaryKey: beneficiaryKeyFor(PHONE_B) }).reason === 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH');
  ok('EV-09: no phone binding at all → refused', [undefined, null, '', 7].every((v) => R(withActive, mk({ soaId: 'soa_2' }), { beneficiaryKey: v }).reason === 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH'));
  ok('EV-09: an entry\'s key is compared exactly', R({ appointmentId: APPT, instances: [{ ...entry, beneficiaryKey: k.toUpperCase() }] }, mk({ soaId: 'soa_2' }), { beneficiaryKey: k }).reason === 'SOA_SUPERSESSION_BENEFICIARY_MISMATCH');
  ok('EV-09: a ledger of another appointment → refused', R({ appointmentId: APPT_2, instances: [] }, mk({ soaId: 'soa_2' }), { beneficiaryKey: k }).reason === 'SOA_LEDGER_APPOINTMENT_MISMATCH');
  ok('EV-09: a ledger that is not a ledger → refused', [undefined, null, 'x', [], { appointmentId: APPT }, { appointmentId: APPT, instances: {} }].every((l) => R(l, mk({ soaId: 'soa_2' }), { beneficiaryKey: k }).ok === false));
  ok('EV-09: an instance with no appointment → refused', R(empty, { ...mk({ soaId: 'soa_2' }), appointmentId: '' }, { beneficiaryKey: k }).reason === 'SOA_LEDGER_APPOINTMENT_MISMATCH');
  ok('EV-09: an id already in the ledger → refused', R(withActive, mk({ soaId: 'soa_1' }), { beneficiaryKey: k }).reason === 'SOA_RECORD_DUPLICATED');
  ok('EV-09: a conflict in the ledger → refused, both named',
    (() => { const r = R({ appointmentId: APPT, instances: [entry, ledgerEntryFor(sign(mk({ soaId: 'soa_x' })), k)] }, mk({ soaId: 'soa_2' }), { beneficiaryKey: k }); return r.reason === 'SOA_ACTIVE_SCOPE_CONFLICT' && same(r.soaIds, ['soa_1', 'soa_x']); })());
  ok('EV-09: the supersession rule applies through the ledger too',
    (() => { const r = R(withActive, mk({ soaId: 'soa_2', beneficiaryName: 'Someone Else' }), { beneficiaryKey: k }); return r.reason === 'SOA_SUPERSESSION_REFUSED' && r.errors.beneficiaryName === 'supersession_changes_beneficiary'; })());

  // AUDIT 2026-10-04 (EV-09, red team) — the signer must be the person the link was issued to: ONE rule, called.
  const lead = { fullName: 'Jane Q Public', phone: '7185550123' };
  const I = signerIdentityProblem;
  ok('EV-09 (red team): the captured name and the proven phone, however formatted, are the same person',
    I({ fullName: 'Jane Q Public', phone: '7185550123' }, lead) === null && I({ fullName: '  jane   q PUBLIC ', phone: '+1 (718) 555-0123' }, lead) === null && I({ fullName: 'Jane Q Public', phone: '+17185550123' }, lead) === null);
  ok('EV-09 (red team): another name on the same phone is refused, the field named, never the values',
    (() => { const p = I({ fullName: 'Someone Else', phone: '7185550123' }, lead); const s = JSON.stringify(p); return p.reason === 'SOA_IDENTITY_MISMATCH' && p.field === 'fullName' && !s.includes('Someone') && !s.includes('Jane'); })());
  ok('EV-09 (red team): another phone under the same name is refused', (I({ fullName: 'Jane Q Public', phone: '2125550199' }, lead) || {}).field === 'phone');
  ok('EV-09 (red team): an empty, missing or non-string claim never matches',
    [{ phone: '7185550123' }, { fullName: '', phone: '7185550123' }, { fullName: ['Jane Q Public'], phone: '7185550123' }, { fullName: 'Jane Q Public' }, { fullName: 'Jane Q Public', phone: 7185550123 },
      { fullName: 'Jane Q Public', phone: ['7185550123'] }, null, 'Jane Q Public', ['Jane Q Public']].every((v) => I(v, lead) !== null));
  ok('EV-09 (red team): a lead record with no name, no phone or no record matches nobody',
    I({ fullName: '', phone: '' }, { fullName: '', phone: '' }) !== null && (I({ fullName: 'Jane Q Public', phone: '7185550123' }, { fullName: 'Jane Q Public' }) || {}).field === 'phone' &&
    (I({ fullName: 'Jane Q Public', phone: '7185550123' }, null) || {}).field === 'record' && (I({ fullName: 'Jane Q Public', phone: '7185550123' }, [lead]) || {}).field === 'record');
  ok('EV-09 (red team): the name is compared whole, not as a prefix or a part', I({ fullName: 'Jane Q Public Jr', phone: '7185550123' }, lead) !== null && I({ fullName: 'Jane', phone: '7185550123' }, lead) !== null);
  ok('EV-09 (red team): a phone with fewer than ten digits is no phone', I({ fullName: 'Jane Q Public', phone: '5550123' }, lead) !== null && I({ fullName: 'Jane Q Public', phone: '7185550123' }, { ...lead, phone: '0123' }) !== null);
  ok('EV-09: the refusal vocabulary names identity and lock ownership, frozen',
    LEDGER_REFUSAL.IDENTITY_MISMATCH === 'SOA_IDENTITY_MISMATCH' && LEDGER_REFUSAL.APPOINTMENT_LOCK_NOT_HELD === 'SOA_APPOINTMENT_LOCK_NOT_HELD' &&
    LEDGER_REFUSAL.APPOINTMENT_LOCK_EXPIRED === 'SOA_APPOINTMENT_LOCK_EXPIRED' && Object.isFrozen(LEDGER_REFUSAL));
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. The store-driven section, in two children with a controlled environment
// ═════════════════════════════════════════════════════════════════════════════
{
  const self = fileURLToPath(import.meta.url);
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (/^(KV_REST_API|UPSTASH_REDIS_REST)_|^(CY2027_|HIGHLEVEL_|VERCEL)/.test(k)) delete clean[k];
  const child = (mode, env) => {
    const r = spawnSync(process.execPath, [self], { encoding: 'utf8', timeout: 180000, env: { ...clean, ...env, CY2027_SUPERSESSION_CHILD: mode } });
    const out = String(r.stdout || '');
    const m = out.split('\n').reverse().find((l) => l.startsWith('CHILD_RESULT '));
    if (!m) { failures.push(`${mode} child produced no result (exit ${r.status}): ` + String(r.stderr || out).slice(-1500)); return; }
    const j = JSON.parse(m.slice('CHILD_RESULT '.length));
    passed += j.passed;
    for (const f of j.failures) failures.push(`[${mode} child] ` + f);
    ok(`${mode} child: asserted something and exited accordingly`, j.passed > 20 && (r.status === 0) === (j.failures.length === 0));
  };
  child('memory', {});
  child('kv', { KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 'laboratory' });
  // AUDIT 2026-10-04 (red team) — the handlers themselves, driven. Every host
  // is a laboratory double; the child throws on any other.
  child('handler', {
    KV_REST_API_URL: 'https://kv.invalid', KV_REST_API_TOKEN: 'laboratory',
    CY2027_EVIDENCE_STORE_URL: 'https://evidence.invalid', CY2027_EVIDENCE_STORE_TOKEN: 'laboratory',
    HIGHLEVEL_TOKEN: 'laboratory', HIGHLEVEL_LOCATION_ID: 'LOC_LABORATORY',
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. What must be ABSENT from the source — the one thing a behavioural drive
//    cannot observe. Everything the handlers DO is asserted by the handler child
//    (section 4), by driving them. AUDIT 2026-10-04 (red team): the presence
//    scans that used to live here let three fail-open mutants through.
// ═════════════════════════════════════════════════════════════════════════════
{
  const SIGN = strip(read('../api/sign-soa.js'));
  ok('EV-09: the handler mints no appointment of its own', !/appt_' \+ crypto\.randomUUID\(\)/.test(SIGN));
  ok('EV-09: the person is never bound by a phone the body sent', !/beneficiaryKeyFor\(phone\)/.test(SIGN) && !/beneficiaryKeyFor\(body\./.test(SIGN));
  ok('EV-09 (red team): the beneficiary name filed is never the body\'s', !/beneficiaryName: fullName/.test(SIGN) && !/beneficiaryName: body\./.test(SIGN));
  ok('EV-09: no unchecked signed-record write remains', !/await setRecord\('soa-signed:/.test(SIGN));
  ok('WVG-11 (red team): the handler never writes a signing time onto the link itself — only the FILED stamp carries one', !/\.signedAt = /.test(SIGN));
  ok('WVG-11: the handler releases the lock only through the owned release', !/releaseAppointmentLock\(appointmentId\)/.test(SIGN));
  ok('G08 (unchanged): the election still comes from readLanguageElection and nowhere else', !/body\.language\b/.test(SIGN) && !/body\.languageSource/.test(SIGN));

  const TOK = strip(read('../api/soa-token.js'));
  ok('EV-09: the issuer reads no ledger — the person is proven at signature, not at issue', !/readLedger|reconcileSignature|activeSoaInstance/.test(TOK));
  ok('EV-09 (red team): the issuer\'s audit claims no existence it did not check', !/'EXISTING'/.test(TOK));

  const STORE = strip(read('../api/_lib/soa-store.js'));
  ok('WVG-11: the lossy token helpers are gone from the source, not only from the exports', !/setSoaToken|getSoaToken/.test(STORE));
  ok('WVG-11: the claim is SET … NX on the wire', /'EX', String\(ttlSec\), 'NX'\]/.test(STORE));
  ok('WVG-11: readRecord falls back to nothing when KV is configured', !/readRecord[\s\S]{0,600}?memoryGet\(storeKey\)[\s\S]{0,600}?KV_READ_FAILED/.test(STORE.replace(/if \(!KV_AVAILABLE\) return \{ ok: true, value: memoryGet\(storeKey\), durable: false \};/, '')));

  const LEDGER = strip(read('../api/_lib/cy2027/soa-ledger.js'));
  ok('EV-09: the ledger module reads through readRecord only, never the lossy getRecord', /readRecord\(/.test(LEDGER) && !/getRecord/.test(LEDGER));
  ok('EV-09: the ledger module is server-only and self-contained', !/from '\.\.\/\.\.\/src/.test(LEDGER) && /from '\.\.\/soa-store\.js'/.test(LEDGER));
}
// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`CY2027 EV-09 / WVG-11: ${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.error('  ✗ ' + f);
  console.error(`\nRESULT: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`CY2027 EV-09 / WVG-11: all ${passed} assertions passed`);
console.log(`RESULT: ${passed} passed, 0 failed`);

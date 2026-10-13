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
// leaves this machine) with a failure injected at each filing stage. The
// signing handler is gated off in production (SOA_ENABLED=false), so its
// wiring is checked by structural scans anchored to a line start, through
// strip(): a comment cannot satisfy them and an `if (false)` prefix breaks them.
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
  appointmentIdForReissue, appointmentLedgerKey, appointmentLockKey, signedRecordKey, beneficiaryKeyFor,
  ledgerEntryFor, readLedger, reconcileSignature, fileSignature, claimAppointmentLock, releaseAppointmentLock,
} from '../api/_lib/cy2027/soa-ledger.js';
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
    ok(`${mode}: the appointment lock is claimed`, l1.ok === true);
    const l2 = await claimAppointmentLock(APPT);
    ok(`${mode}: a second claim while held is BUSY, named`, l2.ok === false && l2.reason === 'SOA_APPOINTMENT_BUSY');
    const rel = await releaseAppointmentLock(APPT);
    ok(`${mode}: the lock is released`, rel.ok === true);
    const l3 = await claimAppointmentLock(APPT);
    ok(`${mode}: and can be claimed again`, l3.ok === true);
    await releaseAppointmentLock(APPT);
    const other = await claimAppointmentLock(APPT_2);
    ok(`${mode}: another appointment is not blocked by this one`, other.ok === true);
    await releaseAppointmentLock(APPT_2);
    if (mode === 'kv') {
      ok('kv: the claim is a SET … NX, the release a DEL',
        lab.log.some((e) => e[0] === 'SETNX' && e[1] === appointmentLockKey(APPT)) && lab.log.some((e) => e[0] === 'DEL' && e[1] === appointmentLockKey(APPT)) &&
        !lab.log.some((e) => e[0] === 'SET' && e[1] === appointmentLockKey(APPT)));
      lab.reset();
      lab.failWhen = (op) => op === 'SETNX';
      const lf = await claimAppointmentLock(APPT);
      ok('kv: a claim the store could not make is LOCK_FAILED, never "claimed"', lf.ok === false && lf.reason === 'SOA_APPOINTMENT_LOCK_FAILED');
      lab.reset();
      lab.failWhen = (op) => op === 'DEL';
      const held = await claimAppointmentLock(APPT);
      const rf = await releaseAppointmentLock(APPT);
      ok('kv: a release the store could not make is reported', held.ok === true && rf.ok === false && rf.reason === 'KV_WRITE_FAILED');
      lab.reset();
      await releaseAppointmentLock(APPT);
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
    const s3 = await stage((op, key) => op === 'SET' && key === signedRecordKey('k1'), 'k4');
    ok('kv: failure at the mirror: the ledger has ALREADY switched (reported with it), the old record lags and the stage says so',
      s3.filed.ok === false && s3.filed.stage === 'SUPERSEDED_MIRROR' && s3.filed.ledger && s3.filed.ledger.instances.length === 2 &&
      same(s3.writes, [signedRecordKey('k4'), appointmentLedgerKey(A3), signedRecordKey('k1')]) &&
      activeSoaInstance(s3.after.ledger.instances).active.soaId === 'k4' && s3.after.ledger.instances[0].status === 'SUPERSEDED' &&
      s3.prev.value.instance.status === 'COMPLETED', JSON.stringify(s3.filed));
    const s4 = await stage((op, key) => op === 'GET' && key === signedRecordKey('k4'), 'k5');
    ok('kv: a mirror whose previous record cannot be read is reported at the mirror stage',
      s4.filed.ok === false && s4.filed.stage === 'SUPERSEDED_MIRROR' && s4.filed.reason === 'KV_READ_FAILED' &&
      activeSoaInstance(s4.after.ledger.instances).active.soaId === 'k5', JSON.stringify(s4.filed));
    lab.reset();
    lab.data.delete(signedRecordKey('k5'));
    const s5 = await stage(() => false, 'k6');
    ok('kv: a mirror whose previous record is missing is reported, the ledger having switched',
      s5.filed.ok === false && s5.filed.stage === 'SUPERSEDED_MIRROR' && s5.filed.reason === 'PREVIOUS_RECORD_MISSING' &&
      activeSoaInstance(s5.after.ledger.instances).active.soaId === 'k6', JSON.stringify(s5.filed));
    const s6 = await stage(() => false, 'k7');
    ok('kv: with the store healthy the same filing succeeds end to end',
      s6.filed.ok === true && s6.filed.mode === 'SUPERSEDES' && activeSoaInstance(s6.after.ledger.instances).active.soaId === 'k7' &&
      s6.prev.value.instance.status === 'SUPERSEDED' && s6.prev.value.instance.supersededById === 'k7', JSON.stringify(s6.filed));
    ok('kv: every version is still in the ledger',
      same(s6.after.ledger.instances.map((e) => e.soaId + ':' + e.status), ['k1:SUPERSEDED', 'k4:SUPERSEDED', 'k5:SUPERSEDED', 'k6:SUPERSEDED', 'k7:COMPLETED']),
      s6.after.ledger.instances.map((e) => e.soaId + ':' + e.status).join(','));
  }
}

if (CHILD) {
  try {
    await storeSection(CHILD);
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
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. The store-driven section, in two children with a controlled environment
// ═════════════════════════════════════════════════════════════════════════════
{
  const self = fileURLToPath(import.meta.url);
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (/^(KV_REST_API|UPSTASH_REDIS_REST)_/.test(k)) delete clean[k];
  const child = (mode, env) => {
    const r = spawnSync(process.execPath, [self], { encoding: 'utf8', timeout: 120000, env: { ...clean, ...env, CY2027_SUPERSESSION_CHILD: mode } });
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
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. The handler wiring — anchored, comment-stripped scans
// ═════════════════════════════════════════════════════════════════════════════
{
  const SIGN = strip(read('../api/sign-soa.js'));
  const idx = (s) => { const i = SIGN.indexOf(s); if (i < 0) failures.push(`sign-soa no longer contains ${JSON.stringify(s)}`); return i; };
  const at = (re) => { const i = SIGN.search(re); if (i < 0) failures.push(`sign-soa no longer matches ${re}`); return i; };
  // The release after filing — not the one inside bail(), which comes first in the source.
  const RELEASE_AFTER_FILING = /await releaseAppointmentLock\(appointmentId\);\s*\n\s*if \(!filed\.ok\) \{/;

  ok('EV-09: the appointment is the LINK\'s, not the body\'s', line(/var appointmentId = link\.appointmentId;/).test(SIGN));
  ok('EV-09: a link with no appointment cannot sign',
    line(/if \(typeof appointmentId !== 'string' \|\| !appointmentId\) \{\s*\n\s*return res\.status\(409\)\.json\(\{ error: 'SOA_LINK_UNUSABLE', reason: 'LINK_HAS_NO_APPOINTMENT' \}\);/).test(SIGN));
  ok('EV-09: a body naming another appointment is refused',
    line(/if \(typeof body\.appointmentId === 'string' && body\.appointmentId\.trim\(\) && body\.appointmentId\.trim\(\) !== appointmentId\) \{\s*\n\s*return res\.status\(409\)\.json\(\{ error: 'SOA_APPOINTMENT_MISMATCH' \}\);/).test(SIGN));
  ok('EV-09: the handler mints no appointment of its own', !/appt_' \+ crypto\.randomUUID\(\)/.test(SIGN));
  ok('EV-09: the person is bound by the LEAD record\'s phone, the one the factor proved',
    line(/var beneficiaryKey = beneficiaryKeyFor\(record\.phone\);/).test(SIGN) && !/beneficiaryKeyFor\(phone\)/.test(SIGN) && !/beneficiaryKeyFor\(body\./.test(SIGN));
  ok('WVG-11: the appointment is locked before the ledger is read, and a failed claim refuses',
    line(/var lock = await claimAppointmentLock\(appointmentId\);/).test(SIGN) &&
    line(/if \(!lock\.ok\) \{\s*\n\s*emitAudit\(\{\s*\n\s*action: 'SOA_REFUSED', actor: 'system:sign-soa', result: lock\.reason, source: 'WEB',[\s\S]{0,200}?\}\);\s*\n\s*return res\.status\(lock\.reason === 'SOA_APPOINTMENT_BUSY' \? 409 : 503\)\.json\(\{ error: lock\.reason \}\);\s*\n\s*\}/).test(SIGN));
  ok('WVG-11: the link is re-read under the lock, through the reporting read',
    line(/var linkNow = await readRecord\(linkKey\);/).test(SIGN) && line(/if \(!linkNow\.ok\) return bail\(503, \{ error: 'SOA_LINK_UNREADABLE' \}\);/).test(SIGN) &&
    line(/var linkNowState = checkLink\(linkNow\.value\);/).test(SIGN) && line(/if \(!linkNowState\.ok\) \{/).test(SIGN) &&
    line(/if \(!linkNow\.value\.factorVerifiedAt\) return bail\(401, \{ error: 'SECOND_FACTOR_REQUIRED' \}\);/).test(SIGN) && line(/link = linkNow\.value;/).test(SIGN));
  ok('EV-09: the ledger is read through the reporting read and a failure refuses',
    line(/var ledgerRead = await readLedger\(appointmentId\);/).test(SIGN) &&
    line(/if \(!ledgerRead\.ok\) \{\s*\n\s*emitAudit\(\{\s*\n\s*action: 'SOA_REFUSED', actor: 'system:sign-soa', result: 'SOA_LEDGER_UNAVAILABLE', source: 'WEB',[\s\S]{0,260}?\}\);\s*\n\s*return bail\(503, \{ error: 'SOA_LEDGER_UNAVAILABLE', reason: ledgerRead\.reason \}\);\s*\n\s*\}/).test(SIGN));
  ok('EV-09: the instance is reconciled against the ledger, and the reconciled one is what gets signed',
    line(/var reconciled = reconcileSignature\(ledgerRead\.ledger, instance, \{ beneficiaryKey: beneficiaryKey, at: signedAt \}\);/).test(SIGN) &&
    line(/if \(!reconciled\.ok\) \{\s*\n\s*emitAudit\(\{\s*\n\s*action: 'SOA_REFUSED', actor: 'system:sign-soa', result: reconciled\.reason, source: 'WEB',[\s\S]{0,260}?\}\);\s*\n\s*return bail\(409, \{ error: reconciled\.reason, fields: reconciled\.errors \|\| null \}\);\s*\n\s*\}/).test(SIGN) &&
    line(/instance = reconciled\.instance;/).test(SIGN));
  ok('EV-09: a refused reconciliation is audited with the named reason only',
    /action: 'SOA_REFUSED', actor: 'system:sign-soa', result: reconciled\.reason, source: 'WEB',/.test(SIGN));
  ok('WVG-11: the link is burnt, durably, before any evidence is written',
    line(/var burned = consumeLink\(link\);/).test(SIGN) && line(/if \(!burned\.ok\) return bail\(409, \{ error: 'SOA_LINK_UNUSABLE', reason: burned\.reason \}\);/).test(SIGN) &&
    line(/var linkWrite = await setRecord\(linkKey, burned\.record, SOA_TOKEN_TTL_SEC\);/).test(SIGN) &&
    line(/if \(!linkWrite\.ok\) \{/).test(SIGN) && /return bail\(503, \{ error: 'SOA_LINK_BURN_FAILED' \}\);/.test(SIGN) &&
    idx('consumeLink(link)') < idx('buildEvidenceRecord(') && idx('var linkWrite = await setRecord(linkKey') < idx('putEvidence('));
  ok('EV-09: the order is lock → ledger → reconcile → burn → evidence → complete → file → release → CRM',
    idx('claimAppointmentLock(appointmentId)') < idx('readLedger(appointmentId)') && idx('readLedger(appointmentId)') < idx('reconcileSignature(') &&
    idx('reconcileSignature(') < idx('consumeLink(link)') && idx('consumeLink(link)') < idx('putEvidence(') && idx('putEvidence(') < idx('completeSoaInstance(') &&
    idx('completeSoaInstance(') < idx('var filed = await fileSignature({') && idx('var filed = await fileSignature({') < at(RELEASE_AFTER_FILING) &&
    at(RELEASE_AFTER_FILING) < idx('sendToGhl('));
  ok('EV-09: the signature is filed with the ledger, the previous record and the evidence TTL',
    line(/var filed = await fileSignature\(\{/).test(SIGN) &&
    /var filed = await fileSignature\(\{[\s\S]{0,400}?ledger: ledgerRead\.ledger,[\s\S]{0,400}?previous: reconciled\.previous,[\s\S]{0,900}?signedRecordTtlSec: SIGNED_RECORD_TTL_SEC,/.test(SIGN));
  ok('EV-09: a filing that failed is a 503 that names the stage, audited, never "saved"',
    line(/if \(!filed\.ok\) \{/).test(SIGN) &&
    /if \(!filed\.ok\) \{[\s\S]{0,900}?action: 'SOA_EVIDENCE_WRITE_FAILED', actor: 'system:sign-soa', result: 'SIGNATURE_NOT_FILED:' \+ filed\.stage,[\s\S]{0,600}?return res\.status\(503\)\.json\(\{\s*error: 'SOA_NOT_FILED',\s*stage: filed\.stage,/.test(SIGN));
  ok('EV-09: no unchecked signed-record write remains', !/await setRecord\('soa-signed:/.test(SIGN));
  ok('EV-09: a supersession is audited as SOA_SUPERSEDED, naming the previous instance',
    /if \(reconciled\.previous\) \{\s*\n\s*emitAudit\(\{\s*\n\s*action: 'SOA_SUPERSEDED',[\s\S]{0,300}?details: \{ previousSoaId: reconciled\.previous\.soaId, appointmentId: appointmentId,/.test(SIGN));
  ok('EV-09: SOA_SUPERSEDES_ID reaches the CRM note and the response',
    line(/'soa_supersedes_id: ' \+ \(instance\.supersedesId \|\| '\(none\)'\),/).test(SIGN) && /supersedesId: instance\.supersedesId,/.test(SIGN) && /appointmentId: instance\.appointmentId,\s*\n\s*supersedesId: instance\.supersedesId,/.test(SIGN));
  {
    // Every exit between the claim and the release goes through bail(), which releases the lock.
    const from = idx('var lock = await claimAppointmentLock(appointmentId);');
    const to = at(RELEASE_AFTER_FILING);
    const held = from >= 0 && to > from ? SIGN.slice(from, to) : '';
    const direct = (held.match(/return res\.status\(/g) || []).length;
    ok('WVG-11: inside the lock, the only direct response is the lock-refusal itself and bail()\'s own',
      held.length > 1000 && direct === 2 && line(/var bail = async function \(status, payload\) \{\s*\n\s*await releaseAppointmentLock\(appointmentId\);\s*\n\s*return res\.status\(status\)\.json\(payload\);/).test(held),
      `direct responses inside the held section: ${direct}`);
    ok('WVG-11: the evidence/PDF/completion failures bail out through it',
      (held.match(/return bail\(500, \{ error: 'SOA_EVIDENCE_FAILED' \}\);/g) || []).length === 2 &&
      /return bail\(500, \{ error: 'PDF generation failed' \}\);/.test(held) && /return bail\(503, \{\s*\n\s*error: 'SOA_EVIDENCE_NOT_STORED',/.test(held));
  }
  ok('G08 (unchanged): the election still comes from readLanguageElection and nowhere else', !/body\.language\b/.test(SIGN) && !/body\.languageSource/.test(SIGN));

  const TOK = strip(read('../api/soa-token.js'));
  ok('EV-09: the issuer accepts an existing appointment only in the server\'s id form, else mints one',
    line(/var reissuedFor = appointmentIdForReissue\(body\.appointmentId\);/).test(TOK) &&
    line(/var appointmentId = reissuedFor \|\| \('appt_' \+ crypto\.randomUUID\(\)\);/).test(TOK) &&
    /issueLink\(\{\s*\n\s*soaId: 'soa_' \+ crypto\.randomUUID\(\),\s*\n\s*appointmentId: appointmentId,/.test(TOK));
  ok('EV-09: whether the link was for an existing appointment is audited', /appointment: reissuedFor \? 'EXISTING' : 'NEW'/.test(TOK));
  ok('EV-09: the issuer reads no ledger — the person is proven at signature, not at issue', !/readLedger|reconcileSignature|activeSoaInstance/.test(TOK));

  const STORE = strip(read('../api/_lib/soa-store.js'));
  ok('WVG-11: the lossy token helpers are gone from the source, not only from the exports', !/setSoaToken|getSoaToken/.test(STORE));
  ok('WVG-11: the claim is SET … NX and a per-command error is not a claim',
    /'EX', String\(ttlSec\), 'NX'\]/.test(STORE) && line(/if \(!first \|\| typeof first !== 'object' \|\| !\('result' in first\)\) throw new Error\('kv_setnx_unreadable'\);/).test(STORE) &&
    line(/return first\.result === 'OK';/).test(STORE));
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

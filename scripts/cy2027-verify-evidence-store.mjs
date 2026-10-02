#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — verify the evidence store end to end before trusting it.
//
// `signedPdfPersisted` stays false in src/lib/soaContent.ts until a REAL round
// trip has been observed, because the failure mode is the worst one available:
// the store looks configured, a beneficiary signs, and the document is not
// retrievable afterwards. A configuration that has never been exercised is not
// a configuration.
//
//   node scripts/cy2027-verify-evidence-store.mjs
//
// Requires CY2027_EVIDENCE_STORE_URL and CY2027_EVIDENCE_STORE_TOKEN.
//
// It writes ONE small object under a clearly marked self-test path, reads it
// back, compares bytes, and tells you what to do next. It never touches real
// evidence: the path contains "selftest" and the plan year 0000, which no real
// SOA can produce.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import { putEvidence, getEvidence, configurationProblem, evidencePath } from '../api/_lib/cy2027/evidence-store.js';

const problem = configurationProblem();
if (problem) {
  console.error('✗ ' + problem);
  console.error('\nSet both, then re-run:');
  console.error('  CY2027_EVIDENCE_STORE_URL   https://… (https only)');
  console.error('  CY2027_EVIDENCE_STORE_TOKEN a bearer token with write+read on that prefix');
  process.exit(1);
}

// A fake instance that cannot collide with a real one.
const instance = {
  soaId: 'selftest-' + crypto.randomUUID(),
  planYear: 0,
  state: 'XX',
};
const pdf = Buffer.from('%PDF-1.4\nCY2027 evidence store self-test. Safe to delete.\n%%EOF\n', 'utf8');
const integrityHash = 'sha256:' + crypto.createHash('sha256').update(pdf).digest('hex');

console.log('path: ' + evidencePath(instance, integrityHash));

const put = await putEvidence({
  instance,
  integrityHash,
  pdfBuffer: pdf,
  evidenceRecord: { selfTest: true, at: new Date().toISOString() },
});
if (!put.ok) {
  console.error('✗ write failed: ' + put.reason + (put.status ? ' (HTTP ' + put.status + ')' : ''));
  console.error('\nThe signing route returns 503 SOA_EVIDENCE_NOT_STORED in this state, which is');
  console.error('correct — the marketing gate stays locked rather than producing a signature');
  console.error('with nothing behind it.');
  process.exit(1);
}
console.log('✓ wrote   ' + put.uri);
console.log('  class   ' + put.recordClass + ', retention ' + put.retentionYears + ' years');

const got = await getEvidence(put.uri);
if (!got.ok) {
  console.error('✗ read-back failed: ' + got.reason + (got.status ? ' (HTTP ' + got.status + ')' : ''));
  console.error('\nA write that cannot be read back is not evidence. Check that the token has');
  console.error('READ access to the same prefix, not only write.');
  process.exit(1);
}
if (got.sha256 !== crypto.createHash('sha256').update(pdf).digest('hex')) {
  console.error('✗ the bytes changed in transit: stored ' + got.sha256);
  console.error('  The store is transforming objects (compression, re-encoding). Evidence must');
  console.error('  come back byte-identical or the integrity hash is meaningless.');
  process.exit(1);
}

console.log('✓ read back, bytes identical (' + got.bytes.length + ' B)');
console.log('\nThe store works. Two things remain, both deliberate:');
console.log('  1. Delete the self-test object above if your store does not expire it.');
console.log('  2. Flip signedPdfPersisted to true in src/lib/soaContent.ts — SOA_PRECONDITIONS');
console.log('     is what blocks enablement, and it is meant to be flipped by a person who has');
console.log('     seen this output, not by the code that wrote it.');

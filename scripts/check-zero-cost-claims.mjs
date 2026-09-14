#!/usr/bin/env node
// scripts/check-zero-cost-claims.mjs
//
// AUDIT 2026-09-14 (CPR5-CLIENT-11) — a build gate for FTC net impression.
//
// "$0 premium" is true of many Medicare Advantage plans and misleading on its
// own: the beneficiary still pays the Part B premium, and the plan still has
// deductibles, copays and network rules. The FTC judges the NET IMPRESSION of
// the claim as a reader encounters it, so the qualifier has to travel with the
// claim — not appear two screens further down the page.
//
// That is exactly how this drifted. Round 4 qualified the claim on Home and did
// not touch the Medicare Advantage page, which is the page Home's fixed card
// links to, so the fixed card led straight to an unqualified hero.
//
// This scans the user-visible copy for a zero-cost token and fails unless a
// qualifier appears in the same sentence or the one after it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The claim is a ZERO joined to a PREMIUM — in either order, either language.
// A bare "$0" elsewhere is not this claim: "you pay $0 for covered Part D drugs
// once you reach the cap" is a statutory fact, and the agency's own "$0 Cost to
// You" is about our fee, not a plan premium.
const CLAIM_RE = /(?:\$\s?0|\bzero\b|\bcero\b)[^.!?\n]{0,40}?\b(?:premium|prima)\b|\b(?:premium|prima)\b[^.!?\n]{0,40}?(?:\$\s?0\b|\bzero\b|\bcero\b)|\bpremium[-\s]free\b|\bsin\s+prima\b/gi;
// Premium-free PART A is the statutory fact, not a plan promise: the phrase
// names its own subject and nobody is being sold anything.
const PART_A_RE = /\bpart\s*a\b|\bparte\s*a\b/i;
// What makes it honest: Part B keeps being paid, or the other costs are named.
const QUALIFIER_RE = /\bpart\s*b\s+premium\b|\bparte\s*b\b|\bprima\s+de\s+la\s+parte\s*b\b|\bdeducti(?:ble|bles)\b|\bdeducible|\bcopay|\bcopago|\bcoinsurance\b|\bcoseguro\b|\bnetwork\s+rules\b|\breglas\s+de\s+red\b|\bnot\s+all\s+plans\b|\bno\s+todos\s+los\s+planes\b|\bplan\s+availability\b|\bvar(?:y|ies|[ií]a)\b|\bbeyond\s+part\s*b\b/i;

// Copy lives in these files. Route components and the shared content modules.
const SCAN_DIRS = ['src/pages', 'src/components', 'src/data', 'src/lib'];
// Not user-visible copy: the compliance filter fixtures and the test corpora.
const SKIP_FILE = /(safetyRouter|complianceFilter|customerServiceEngine)\.ts$/;

const problems = [];

function sentencesAround(text, index) {
  // The sentence holding `index`, plus the next one — the FTC's "net
  // impression" window for a claim a reader meets in sequence.
  const before = text.lastIndexOf('.', index);
  const start = before < 0 ? 0 : before + 1;
  let end = text.indexOf('.', index + 1);
  if (end < 0) end = text.length;
  let end2 = text.indexOf('.', end + 1);
  if (end2 < 0) end2 = text.length;
  return text.slice(start, Math.min(end2 + 1, start + 700));
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !SKIP_FILE.test(name)) out.push(p);
  }
  return out;
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    const src = readFileSync(file, 'utf8');
    // Strip comments — an audit note explaining the rule is not a claim.
    const text = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    for (const m of text.matchAll(CLAIM_RE)) {
      const window = sentencesAround(text, m.index);
      const local = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      if (PART_A_RE.test(local)) continue;
      if (QUALIFIER_RE.test(window)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(
        `${file.slice(root.length + 1)}:${line} — "${m[0]}" has no cost qualifier in its own sentence or the next one.\n` +
        `      context: ${JSON.stringify(window.trim().slice(0, 180))}`
      );
    }
  }
}

if (problems.length) {
  console.error('[zero-cost-claims] FAILED — a zero-cost claim must carry its qualifier:\n');
  for (const p of problems) console.error('  • ' + p);
  console.error('\nName what the beneficiary still pays (the Part B premium, deductibles, copays, network rules)\nin the same sentence or the one right after it.');
  process.exit(1);
}
console.log('[zero-cost-claims] OK — every zero-cost claim in the copy carries a cost qualifier beside it.');

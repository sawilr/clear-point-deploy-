#!/usr/bin/env node
// scripts/check-contact-consistency.mjs
//
// AUDIT 2026-09-14 (CODE-02) — a build gate for the one number that must never
// be wrong.
//
// The business line is written into the source by hand in dozens of places, and
// `src/lib/constants/contact.ts` says why the mechanical migration was deferred:
// several of those call sites sit INSIDE sealed TCPA and CMS sentences, where a
// careless edit changes text that is hashed into consent receipts. That decision
// stands. What was missing was protection against the failure the duplication
// actually causes.
//
// Two things can go wrong, and only one of them is about tidiness:
//
//   1. A DIGIT IS WRONG somewhere. A senior dials it and reaches a stranger, or
//      nobody. That is the real risk, and no test catches it today — the number
//      is prose to every other check in this repo.
//   2. The number CHANGES and a file is missed. Then the site publishes two
//      different numbers at once and the miss is invisible until someone calls.
//
// This gate answers both. Every Clear Point-shaped phone token in the deployable
// source must match the canonical constants exactly, and the census it prints
// keeps the debt visible instead of letting it rot quietly.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The single source of truth, read from the constants module itself so this
// gate cannot drift from it either.
const CONST_SRC = readFileSync(join(root, 'src', 'lib', 'constants', 'contact.ts'), 'utf8');
const pick = (name) => {
  const m = CONST_SRC.match(new RegExp('export const ' + name + "\\s*=\\s*'([^']+)'"));
  if (!m) { console.error(`[contact] cannot find ${name} in src/lib/constants/contact.ts`); process.exit(1); }
  return m[1];
};
const DISPLAY = pick('BUSINESS_PHONE_DISPLAY');   // 1-855-720-8555
const E164 = pick('BUSINESS_PHONE_E164');         // +18557208555
const DIGITS = pick('BUSINESS_PHONE_DIGITS');     // 8557208555

// Every rendering the codebase is allowed to contain, built from those.
const area = DIGITS.slice(0, 3), mid = DIGITS.slice(3, 6), last = DIGITS.slice(6);
const ALLOWED = new Set([
  DIGITS, E164, E164.replace('+', ''), DISPLAY,
  `${area}-${mid}-${last}`,
  `(${area}) ${mid}-${last}`,
  `${area}.${mid}.${last}`,
  `${area} ${mid} ${last}`,
  `+1 ${area} ${mid} ${last}`,
  `+1-${area}-${mid}-${last}`,
  `1 (${area}) ${mid}-${last}`,
  `1-${area}-${mid}-${last}`,
]);

// Other numbers that legitimately appear: the federal and state reference lines
// the bots are allowed to quote, and the fictional blocks the validators use on
// purpose. The reference list is READ from the handler's own allow-list rather
// than copied, so adding a state agency there does not fail this gate — and 855
// is a shared toll-free area code, so Connecticut's DSS line looks exactly like
// ours to a naive check.
const HANDLER_SRC = readFileSync(join(root, 'api', 'submit-lead.js'), 'utf8');
const OFFICIAL = (HANDLER_SRC.match(/var OFFICIAL_NUMBERS_RE = \/\^\(([^)]*)\)/) || [, ''])[1];
const KNOWN_OTHER = new Set(
  OFFICIAL.split('|').map((x) => x.replace(/^1\?/, '').trim()).filter(Boolean)
);
for (const n of [...KNOWN_OTHER]) KNOWN_OTHER.add('1' + n);
// OUR line is in that allow-list too (a caller may quote it back). Remove it —
// it is the number this gate exists to check, not one to skip.
KNOWN_OTHER.delete(DIGITS); KNOWN_OTHER.delete('1' + DIGITS);
// Federal lines quoted in prose that are not in the scrubber's allow-list.
for (const n of ['8004474000', '8005411561', '8003561561', '8779272227']) {
  KNOWN_OTHER.add(n); KNOWN_OTHER.add('1' + n);
}
const FICTIONAL = /^\d{3}555\d{4}$/;   // the reserved 555 exchange

const SCAN_DIRS = ['src', 'api', 'public'];
const SKIP_EXT = /\.(png|jpe?g|webp|avif|gif|ico|svg|woff2?|ttf|map|pdf|mp[34]|webm)$/i;

const problems = [];
let callSites = 0;
const byFile = new Map();

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (!SKIP_EXT.test(name)) out.push(p);
  }
  return out;
}

// A phone-shaped token: 10 or 11 digits with optional separators and a +1.
const TOKEN_RE = /(?<![\d])(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d])/g;

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relative(root, file);
    for (const m of src.matchAll(TOKEN_RE)) {
      const token = m[0];
      const digits = token.replace(/\D/g, '');
      const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
      if (KNOWN_OTHER.has(digits) || KNOWN_OTHER.has(national)) continue;
      if (FICTIONAL.test(national)) continue;
      // Is this meant to be OUR number? Anything sharing the area code, or
      // within one digit of the real one, is treated as an attempt at it.
      const looksLikeOurs = national === DIGITS ||
        (national.length === 10 && national.slice(0, 3) === area) ||
        (national.length === 10 && hammingDistance(national, DIGITS) <= 1);
      if (!looksLikeOurs) continue;
      callSites++;
      byFile.set(rel, (byFile.get(rel) || 0) + 1);
      if (national !== DIGITS) {
        const line = src.slice(0, m.index).split('\n').length;
        problems.push(`${rel}:${line} — "${token}" is not the business line. Expected ${DISPLAY}.`);
        continue;
      }
      if (!ALLOWED.has(token.trim())) {
        const line = src.slice(0, m.index).split('\n').length;
        problems.push(`${rel}:${line} — "${token}" spells the right number in an unrecognised format. Use one of: ${[...ALLOWED].slice(0, 4).join(', ')} …`);
      }
    }
  }
}

function hammingDistance(a, b) {
  if (a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

if (problems.length) {
  console.error('[contact] FAILED — the business phone number is not consistent:\n');
  for (const p of problems) console.error('  • ' + p);
  console.error('\nThe canonical values live in src/lib/constants/contact.ts. A senior who dials a\nwrong digit reaches a stranger, and nothing else in this repo checks these digits.');
  process.exit(1);
}

const files = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
console.log(`[contact] OK — ${callSites} hand-written copies of ${DISPLAY} across ${files.length} files, every one of them correct.`);
if (process.env.CONTACT_CENSUS === '1') {
  for (const [f, n] of files) console.log(`    ${String(n).padStart(3)}  ${f}`);
}

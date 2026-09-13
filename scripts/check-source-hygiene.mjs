// AUDIT 2026-09-13 (red-team round 2, latent P1) — source hygiene guard.
//
// A regex in api/_lib/compliance-filter.js carried literal U+0008 (backspace)
// bytes where "\b" (word boundary) was intended — an editing tool had
// double-unescaped the pattern. The file parsed, every suite that did not hit
// that branch passed, and the life-safety post-condition silently replaced every
// compliant 911 reply. Nothing machine-checked for it. This runs at the start of
// `npm run build` and fails on any C0 control character (other than TAB, LF, CR)
// or on U+FFFD replacement characters in the deployable source trees.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['api', 'src', 'scripts', 'public', 'index.html', 'package.json', 'vercel.json', 'vite.config.ts'];
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css', '.md', '.txt', '.xml', '.svg', '.webmanifest']);
// Written with escapes on purpose: the guard must not contain the bytes it hunts.
const BAD = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFD]', 'g');

const problems = [];
function scanFile(p) {
  if (!TEXT_EXT.has(extname(p).toLowerCase())) return;
  const text = readFileSync(p, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(BAD);
    if (m) problems.push(`${relative(root, p)}:${i + 1} — ${[...new Set(m)].map((c) => 'U+' + c.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()).join(' ')}`);
  });
}
function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) { for (const name of readdirSync(p)) if (name !== 'node_modules' && name !== 'dist') walk(join(p, name)); }
  else scanFile(p);
}
for (const r of ROOTS) { try { walk(join(root, r)); } catch { /* optional path */ } }

if (problems.length) {
  console.error('[source-hygiene] control characters found (a mangled "\\b" regex escape is the usual cause):\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('[source-hygiene] OK — no control characters in api/, src/, scripts/, public/ and the root config files.');

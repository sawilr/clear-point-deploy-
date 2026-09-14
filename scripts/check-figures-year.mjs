// AUDIT 2026-09-12 (MED-04, P2) — year-rollover guard for the Medicare figures.
//
// The site, the chat prompt and the deterministic backstop all carry
// current-year dollar figures. Nothing machine-checked that the calendar had
// not moved past them. This runs at the start of `npm run build`:
//   • after January 1 of the year FOLLOWING the figures' year → the build FAILS
//     (set ALLOW_STALE_FIGURES=1 to override for an emergency deploy) until the
//     three sources are updated together;
//   • from October 1 of the figures' year (PY+1 marketing window) → loud warning.
// It also fails when the three declared years disagree with each other.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const pick = (src, re, label) => {
  const m = src.match(re);
  if (!m) { console.error(`[figures-year] cannot find ${label}`); process.exit(1); }
  return Number(m[1]);
};

const apiYear = pick(read('api/_lib/medicare-figures.js'), /MEDICARE_FIGURES_YEAR\s*=\s*(\d{4})/, 'api/_lib/medicare-figures.js MEDICARE_FIGURES_YEAR');
const chatYear = pick(read('api/chat.js'), /const FIGURES_YEAR\s*=\s*(\d{4})/, 'api/chat.js FIGURES_YEAR');
const tsYear = pick(read('src/data/medicare-figures-2026.ts'), /MEDICARE_FIGURES_YEAR\s*=\s*(\d{4})/, 'src/data/medicare-figures-2026.ts MEDICARE_FIGURES_YEAR');

if (apiYear !== chatYear || apiYear !== tsYear) {
  console.error(`[figures-year] MISMATCH: api/_lib=${apiYear} chat.js=${chatYear} src/data=${tsYear} — update all three together.`);
  process.exit(1);
}

// Red-team MED02-RT2-07 — the VALUES must agree too, not only the year constants:
// every auto-corrected figure in api/_lib/medicare-figures.js must appear verbatim
// in the chat prompt (api/chat.js) and in src/data/medicare-figures-2026.ts.
{
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(join(root, 'api/_lib/medicare-figures.js')).href);
  const figs = mod.MEDICARE_FIGURES_2026 || {};
  const chat = read('api/chat.js');
  const ts = read('src/data/medicare-figures-2026.ts');
  const problems = [];
  for (const [key, f] of Object.entries(figs)) {
    // Red-team MED02-RT3-17 — value and display must agree with each other first:
    // a display that disagrees with the value is what the backstop writes out.
    if (Number(String(f.display).replace(/,/g, '')) !== f.value) problems.push(`api/_lib/medicare-figures.js ${key}: display '${f.display}' != value ${f.value}`);
    if (!chat.includes('$' + f.display)) problems.push(`api/chat.js does not contain $${f.display} (${key})`);
    // TS literals may be spelled 202.90 or 202.9 — accept either, never a digit-glued match.
    const plain = String(f.value).replace('.', '\\.');
    const shown = String(f.display).replace(/,/g, '').replace('.', '\\.');
    if (!new RegExp('(?<![\\d.])(?:' + plain + '|' + shown + ')(?![\\d])').test(ts)) problems.push(`src/data/medicare-figures-2026.ts does not contain ${f.display} (${key})`);
  }
  if (problems.length) { console.error('[figures-year] VALUE MISMATCH:\n  - ' + problems.join('\n  - ')); process.exit(1); }
}

const now = new Date();
const year = now.getFullYear();
if (year > apiYear) {
  const msg = `[figures-year] STALE: the calendar year is ${year} but every Medicare figure in the build is for ${apiYear}. Update src/data/medicare-figures-2026.ts, api/chat.js and api/_lib/medicare-figures.js from the CMS fact sheets (and rename the year constants) before deploying.`;
  if (process.env.ALLOW_STALE_FIGURES === '1') console.warn(msg + ' (ALLOW_STALE_FIGURES=1 override in effect)');
  else { console.error(msg); process.exit(1); }
} else if (year === apiYear && now.getMonth() >= 9) {
  console.warn(`[figures-year] NOTICE: PY${apiYear + 1} marketing window is open — CMS has published (or will publish) ${apiYear + 1} figures. Stage them as FUTURE in compliance/regulatory-database.json and plan the January rollover.`);
} else {
  console.log(`[figures-year] OK — figures year ${apiYear} matches the calendar (${year}).`);
}

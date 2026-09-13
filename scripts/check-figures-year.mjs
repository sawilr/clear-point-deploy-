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

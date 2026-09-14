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
// RED TEAM ROUND 5 (RT5-MED-11, P3): `src.match()` returns the FIRST match of an
// unanchored pattern, so a stale COMMENT naming the old year shadowed the real
// constant — the build passed while production ran on a different figure year.
// The pattern is anchored to a declaration at the start of a line, and two
// different values anywhere in the file is itself the error.
const pick = (src, re, label) => {
  const all = [...src.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  if (!all.length) { console.error(`[figures-year] cannot find ${label}`); process.exit(1); }
  const values = [...new Set(all.map((m) => Number(m[1])))];
  if (values.length > 1) {
    console.error(`[figures-year] AMBIGUOUS: ${label} is declared as ${values.join(' and ')} in the same file — one of them is stale.`);
    process.exit(1);
  }
  return values[0];
};

const apiYear = pick(read('api/_lib/medicare-figures.js'), /^\s*(?:export\s+)?(?:const|let|var)\s+MEDICARE_FIGURES_YEAR\s*=\s*(\d{4})/m, 'api/_lib/medicare-figures.js MEDICARE_FIGURES_YEAR');
const chatYear = pick(read('api/chat.js'), /^\s*(?:export\s+)?(?:const|let|var)\s+FIGURES_YEAR\s*=\s*(\d{4})/m, 'api/chat.js FIGURES_YEAR');
const tsYear = pick(read('src/data/medicare-figures-2026.ts'), /^\s*(?:export\s+)?(?:const|let|var)\s+MEDICARE_FIGURES_YEAR\s*=\s*(\d{4})/m, 'src/data/medicare-figures-2026.ts MEDICARE_FIGURES_YEAR');

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
    // Red-team round 4 (RT4-13): an unanchored substring match accepted a
    // digit-spilled figure ("$2,1000" contains "$2,100") and a figure embedded in
    // a larger number ("1,283" contains "283"). Both sides are boundary-anchored.
    // RED TEAM ROUND 5 (RT5-MED-09, P2): the right-hand guard was `(?![\d])`,
    // which a decimal point satisfies. So changing every "$283" in the prompt to
    // "$283.50" passed the gate silently — the prompt then teaches the model a
    // Part B deductible of $283.50 and nothing says a word. The trailing guard
    // now rejects a decimal tail as well as a digit. The value 202.90 keeps its
    // own decimal because `disp` already carries it.
    const disp = String(f.display).replace('.', '\\.');
    if (!new RegExp('(?<![\\d.,])\\$' + disp + '(?![\\d.,]\\d)(?![\\d])').test(chat)) problems.push(`api/chat.js does not contain a standalone $${f.display} (${key})`);
    // TS literals may be spelled 202.90 or 202.9 — accept either, never a digit-glued match.
    const plain = String(f.value).replace('.', '\\.');
    const shown = String(f.display).replace(/,/g, '').replace('.', '\\.');
    if (!new RegExp('(?<![\\d.,])(?:' + plain + '|' + shown + ')(?![\\d.,]\\d)(?![\\d])').test(ts)) problems.push(`src/data/medicare-figures-2026.ts does not contain a standalone ${f.display} (${key})`);
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
} else if (apiYear > year + 1) {
  // RED TEAM ROUND 5 (RT5-MED-12, P4): a figures year two or more ahead of the
  // calendar is a typo, not a plan. It used to print "OK — matches".
  console.error(`[figures-year] IMPOSSIBLE: the figures are declared for ${apiYear} but the calendar year is ${year}. CMS has not published figures that far ahead — check the year constants for a typo.`);
  process.exit(1);
} else if (apiYear === year + 1) {
  console.warn(`[figures-year] STAGED: the build carries ${apiYear} figures and the calendar year is still ${year}. This is the January rollover staged early — the runtime backstop will correct replies to ${apiYear} values from now on, including for callers asking about ${year}. Deploy only if that is intended.`);
} else if (year === apiYear) {
  console.log(`[figures-year] OK — figures year ${apiYear} matches the calendar (${year}).`);
} else {
  console.error(`[figures-year] UNEXPECTED: figures year ${apiYear} against calendar year ${year} — no branch covers this combination.`);
  process.exit(1);
}

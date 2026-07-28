// AUDIT 2026-07-28 (CPF-003) — Spanish URL-space leak scanner.
//
// Finding: pages under /es linked into the ENGLISH URL space
// (/privacy-policy, /medicare-advantage, /part-d, /contact, home anchors).
// A Spanish visitor who clicked one was silently dropped back into English,
// and crawlers following those links never traversed the /es tree — the whole
// point of the indexable Spanish twins.
//
// Fix lives in src/hooks/useLanguage.tsx (`useLocalizedPath`), applied across
// pages + components. This module is the standing guard: it reads the
// PRERENDERED Spanish HTML that `npm run build` writes to dist/es/**/index.html
// and asserts that no internal href points at a non-/es content route.
//
// SCOPE NOTE (be honest about what this covers today): scripts/prerender-meta.mjs
// emits the SPA shell — <head> metadata + <div id="root"></div> — it does NOT
// server-render the React body. So right now the only hrefs in those files are
// head-level ones (canonical, hreflang, favicons, bundled assets), all of which
// are allowlisted below. The scan therefore passes trivially against the current
// build. It is still worth having: the moment body prerendering / SSR lands, or
// anyone hand-writes a link into a prerendered ES page, a leak fails the gate
// with the exact file and href. Pair it with the source-level review — this
// asserts the shipped artifact, not the JSX.
//
// Dependency-free, plain ESM. Usage:
//   import { scanEsLinkLeaks, ES_SCAN_SENTINEL } from './es-link-scan.mjs';
//   const offenders = scanEsLinkLeaks();            // defaults to <repo>/dist
//   const offenders = scanEsLinkLeaks('/tmp/dist'); // or an explicit dist dir

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Returned as the sole array element when the dist dir (or dist/es) is absent.
// NEVER throws for a missing build — a caller that runs before `npm run build`
// gets a reportable sentinel instead of a stack trace it has to catch.
export const ES_SCAN_SENTINEL = 'DIST_MISSING';

// The ONE control allowed to cross the EN <-> /es boundary. LanguageToggle.tsx
// stamps `data-lang-switch` on the selector wrapper; any element carrying it
// (or nested inside its opening tag) is exempt. Kept as an attribute rather
// than a class/aria-label so restyling or re-wording can never break the gate.
const LANG_SWITCH_ATTR = 'data-lang-switch';

// Routes with no /es twin — linking to them from Spanish is correct by design.
const NO_ES_TWIN = /^\/(soa\/|thank-you(\/|$|[?#]))/;

// Static files, not content routes.
const ASSET_PATH = /^\/(assets\/|favicon|robots\.txt$|sitemap)/;
const ASSET_EXT = /\.(svg|png|jpe?g|webp|avif|gif|ico|xml|txt|json|css|js|mjs|map|webmanifest|woff2?|ttf|pdf)(\?|#|$)/i;

/** True when an href needs no localization (external, protocol, hash-only, asset, twin-less route). */
function isAllowedHref(href) {
  if (!href) return true;
  const v = href.trim();
  if (v === '' || v === '#') return true;
  if (v.startsWith('#')) return true;                    // hash-only anchor
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return true;       // http(s):, tel:, mailto:, data:, …
  if (v.startsWith('//')) return true;                   // protocol-relative → external
  if (!v.startsWith('/')) return true;                   // relative → stays in the current space
  if (v === '/es' || v.startsWith('/es/') || v.startsWith('/es?') || v.startsWith('/es#')) return true;
  if (NO_ES_TWIN.test(v)) return true;
  if (ASSET_PATH.test(v)) return true;
  if (ASSET_EXT.test(v)) return true;
  return false;
}

/** Every *.html file under `dir`, recursively. */
function collectHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

/**
 * Scan the prerendered Spanish pages for links into the English URL space.
 *
 * @param {string} [distDir] Build output dir. Relative paths resolve against the
 *   repo root; defaults to `<repo>/dist`.
 * @returns {string[]} One offender per entry, formatted
 *   `dist/es/part-d/index.html :: href="/contact"`. Empty array = clean.
 *   `['DIST_MISSING: <path>']` when there is no build to scan.
 */
export function scanEsLinkLeaks(distDir) {
  const dist = distDir
    ? (distDir.startsWith('/') || /^[a-z]:/i.test(distDir) ? distDir : join(repoRoot, distDir))
    : join(repoRoot, 'dist');
  const esDir = join(dist, 'es');
  if (!existsSync(dist)) return [`${ES_SCAN_SENTINEL}: ${dist}`];
  if (!existsSync(esDir)) return [`${ES_SCAN_SENTINEL}: ${esDir}`];

  const offenders = [];
  // Capture the whole opening tag so the data-lang-switch exemption can be
  // checked on the same element that carries the href.
  const tagRe = /<(a|link|area)\b[^>]*>/gi;
  const hrefRe = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

  for (const file of collectHtml(esDir)) {
    const html = readFileSync(file, 'utf8');
    const label = relative(repoRoot, file).split(sep).join('/');
    let tag;
    while ((tag = tagRe.exec(html)) !== null) {
      const openTag = tag[0];
      if (openTag.includes(LANG_SWITCH_ATTR)) continue;
      const m = hrefRe.exec(openTag);
      if (!m) continue;
      const href = m[2] ?? m[3] ?? m[4] ?? '';
      if (isAllowedHref(href)) continue;
      offenders.push(`${label} :: href="${href}"`);
    }
  }
  return offenders;
}

// Direct run: `node scripts/es-link-scan.mjs [distDir]` — prints a verdict and
// exits non-zero on leaks so it can be wired into a ship gate.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const found = scanEsLinkLeaks(process.argv[2]);
  if (found.length === 1 && found[0].startsWith(ES_SCAN_SENTINEL)) {
    console.error(`[es-link-scan] ${found[0]} — run \`npm run build\` first.`);
    process.exit(2);
  }
  if (found.length === 0) {
    console.log('[es-link-scan] PASS — no English-space links in dist/es/**.');
    process.exit(0);
  }
  console.error(`[es-link-scan] FAIL — ${found.length} leak(s):`);
  for (const o of found) console.error('  ' + o);
  process.exit(1);
}

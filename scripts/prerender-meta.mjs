// AUDIT 2026-07-03 Phase 6 — pre-JS SEO metadata.
//
// Problem: this is a client-rendered SPA. The raw HTML served for every route
// was the ONE generic index.html; per-route <title>/<meta>/canonical were
// injected by RouteMeta.tsx only after JS ran, so non-JS crawlers and social
// scrapers saw duplicate generic metadata across all 14 routes.
//
// Fix (post-build, additive, zero client changes): read PAGE_META straight out
// of src/components/RouteMeta.tsx — the SAME source of truth the client uses,
// so the two can never drift — and emit dist/<route>/index.html per route with
// the route's EN title, meta description, canonical, og:* and twitter:* baked
// into the static HTML. Vercel's filesystem pass serves these BEFORE the SPA
// rewrite, so crawlers get correct pre-JS metadata while the app hydrates and
// RouteMeta keeps handling client-side language switches exactly as before.
//
// Loud-fail: if extraction finds fewer routes than expected the build ABORTS —
// no silent regression to generic metadata.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://clearpointsenioradvisors.com';
const src = readFileSync(join(root, 'src/components/RouteMeta.tsx'), 'utf8');
const distIndex = join(root, 'dist/index.html');
if (!existsSync(distIndex)) { console.error('[prerender-meta] dist/index.html missing — run after vite build'); process.exit(1); }
const baseHtml = readFileSync(distIndex, 'utf8');

// Extract PAGE_META entries: '/route': { title: '...', titleEs: '...', description: '...', descriptionEs: '...' }
// Sawil 2026-07-27 ES ROUTES — titleEs/descriptionEs are now captured too so the
// /es/<route> twins get pre-JS Spanish metadata baked the same way.
const entryRe = /'(\/[a-z-]*)':\s*\{\s*title:\s*'((?:[^'\\]|\\.)*)',\s*titleEs:\s*'((?:[^'\\]|\\.)*)',\s*description:\s*'((?:[^'\\]|\\.)*)',\s*descriptionEs:\s*'((?:[^'\\]|\\.)*)',/g;
const unesc = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const routes = [];
let m;
while ((m = entryRe.exec(src)) !== null) {
  routes.push({ path: m[1], title: unesc(m[2]), titleEs: unesc(m[3]), description: unesc(m[4]), descriptionEs: unesc(m[5]) });
}
if (routes.length < 13) {
  console.error(`[prerender-meta] FATAL: extracted only ${routes.length} routes from RouteMeta.tsx (expected >= 13). Aborting so metadata never silently regresses.`);
  process.exit(1);
}

// Sawil 2026-07-12 SEO AUDIT W-01 — /thank-you was the only route without its
// own title/canonical (it inherited the homepage title) and was indexable.
// A post-submit confirmation page must not compete with the homepage in search:
// give it its own metadata + robots noindex,follow.
routes.push({
  path: '/thank-you',
  title: 'Thank You | Clear Point Senior Advisors',
  description: 'Your request was received. A licensed Clear Point Senior Advisors advisor will contact you during business hours.',
  noindex: true,
});

// Sawil 2026-07-27 ES ROUTES — '/' → '/es', '/about' → '/es/about'.
const esPath = (p) => (p === '/' ? '/es' : `/es${p}`);

function renderRoute(route, lang = 'en') {
  const isEs = lang === 'es';
  const urlPath = isEs ? esPath(route.path) : route.path;
  const canonical = SITE + (urlPath === '/' ? '/' : urlPath);
  const title = isEs ? route.titleEs : route.title;
  const description = isEs ? route.descriptionEs : route.description;
  let html = baseHtml;
  // Sawil 2026-07-27 ES ROUTES — Spanish pages declare their language pre-JS.
  if (isEs) html = html.replace('<html lang="en">', '<html lang="es">');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  if (route.noindex && !/name="robots"/.test(html)) {
    html = html.replace('</head>', `    <meta name="robots" content="noindex,follow" />\n  </head>`);
  }
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  // Canonical: RouteMeta upserts the same tag client-side (querySelector), so
  // pre-seeding it is idempotent — no duplicate tag after hydration.
  if (!/rel="canonical"/.test(html)) {
    html = html.replace('</head>', `    <link rel="canonical" href="${canonical}" />\n  </head>`);
  }
  // Sawil 2026-07-27 ES ROUTES — hreflang cluster per content page (en / es /
  // x-default→en). RouteMeta re-creates the same set client-side (it removes
  // stale alternates on every route change), so pre-seeding stays idempotent.
  if (!route.noindex) {
    const enUrl = SITE + (route.path === '/' ? '/' : route.path);
    const esUrl = SITE + esPath(route.path);
    html = html.replace('</head>',
      `    <link rel="alternate" hreflang="en" href="${enUrl}" />\n` +
      `    <link rel="alternate" hreflang="es" href="${esUrl}" />\n` +
      `    <link rel="alternate" hreflang="x-default" href="${enUrl}" />\n  </head>`);
  }
  return html;
}

function writeRoute(urlPath, html) {
  if (urlPath === '/') {
    writeFileSync(distIndex, html, 'utf8');
  } else {
    const dir = join(root, 'dist', urlPath.slice(1));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), html, 'utf8');
  }
}

let written = 0;
const writtenPaths = [];
for (const route of routes) {
  writeRoute(route.path, renderRoute(route, 'en'));
  writtenPaths.push(route.path);
  written++;
  // Sawil 2026-07-27 ES ROUTES — every content route also gets its /es twin
  // with Spanish title/description baked in. /thank-you (noindex, no titleEs)
  // stays EN-only by design.
  if (!route.noindex) {
    writeRoute(esPath(route.path), renderRoute(route, 'es'));
    writtenPaths.push(esPath(route.path));
    written++;
  }
}
console.log(`[prerender-meta] wrote pre-JS metadata for ${written} routes: ${writtenPaths.join(' ')}`);

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
// SEO 2026-09-27 — las guías viven en /resources/<slug>: el patrón acepta ahora
// dígitos y una segunda barra (antes solo [a-z-], que las habría ignorado en
// silencio y dejado sin shell, sin canónica y fuera del sitemap).
const entryRe = /'(\/[a-z0-9/-]*)':\s*\{\s*title:\s*'((?:[^'\\]|\\.)*)',\s*titleEs:\s*'((?:[^'\\]|\\.)*)',\s*description:\s*'((?:[^'\\]|\\.)*)',\s*descriptionEs:\s*'((?:[^'\\]|\\.)*)',/g;
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
// AUDIT 2026-09-14 (FORMS-11) — Spanish strings added so /es/thank-you gets the
// same pre-JS shell. Still noindex in BOTH languages: the twin exists so a
// Spanish conversion redirect does not land on a 404, not to be crawled.
routes.push({
  path: '/thank-you',
  title: 'Thank You | Clear Point Senior Advisors',
  description: 'Your request was received. A licensed Clear Point Senior Advisors advisor will contact you during business hours.',
  titleEs: 'Gracias | Clear Point Senior Advisors',
  descriptionEs: 'Recibimos su solicitud. Un asesor licenciado de Clear Point Senior Advisors se comunicará con usted en horario de oficina.',
  noindex: true,
});

// SEO 2026-09-27 (SEO-T8). /soa/:token se reescribía a /index.html, que ahora
// lleva el cuerpo prerenderizado de la portada: una URL con token por usuario
// habría servido la portada entera con canónica a "/", indexable antes de JS.
// Este shell propio va vacío, noindex,nofollow, sin canónica ni hreflang, y
// vercel.json reescribe /soa/:token hacia él. prerender-body no lo toca porque
// no está en PAGE_META.
routes.push({
  path: '/soa',
  title: 'Scope of Appointment | Clear Point Senior Advisors',
  description: 'Secure, time-limited Scope of Appointment link.',
  titleEs: 'Alcance de la Cita | Clear Point Senior Advisors',
  descriptionEs: 'Enlace seguro y temporal de Alcance de la Cita.',
  noindex: true,
  nofollow: true,
});

// SEO 2026-09-27 — puerta de longitud. Google recorta títulos por encima de
// ~60 caracteres y descripciones por encima de ~160; un recorte esconde justo
// el modificador geográfico que se acaba de restaurar. Aborta el build.
{
  const tooLong = [];
  for (const r of routes) {
    if (r.title.length > 60) tooLong.push(`${r.path} title (${r.title.length}): ${r.title}`);
    if (r.titleEs.length > 60) tooLong.push(`${r.path} titleEs (${r.titleEs.length}): ${r.titleEs}`);
    if (r.description.length > 160) tooLong.push(`${r.path} description (${r.description.length})`);
    if (r.descriptionEs.length > 160) tooLong.push(`${r.path} descriptionEs (${r.descriptionEs.length})`);
  }
  if (tooLong.length) {
    console.error('[prerender-meta] FATAL — título > 60 o descripción > 160 caracteres:\n  ' + tooLong.join('\n  '));
    process.exit(1);
  }
}

// Sawil 2026-07-27 ES ROUTES — '/' → '/es', '/about' → '/es/about'.
const esPath = (p) => (p === '/' ? '/es' : `/es${p}`);

function renderRoute(route, lang = 'en') {
  const isEs = lang === 'es';
  const urlPath = isEs ? esPath(route.path) : route.path;
  const canonical = SITE + (urlPath === '/' ? '/' : urlPath);
  const title = isEs ? route.titleEs : route.title;
  const description = isEs ? route.descriptionEs : route.description;
  let html = baseHtml;
  // SEO 2026-09-27 (CWV-02). index.html precargaba /hero-bg.webp con
  // fetchpriority=high en las 46 shells, pero solo cuatro rutas lo pintan; en
  // las demás era una descarga prioritaria que compite con el LCP real. La
  // precarga se conserva únicamente donde el hero existe.
  const HERO_ROUTES = new Set(['/', '/about', '/contact', '/resources']);
  if (!HERO_ROUTES.has(route.path)) {
    html = html.replace(/\s*<link rel="preload" as="image" href="\/hero-bg\.webp"[^>]*>/, '');
  }
  // SEO 2026-09-27 (SEO-LIVE-08). El JSON-LD era un solo bloque en inglés
  // copiado en las 46 shells; las gemelas /es llevan ahora su descripción en
  // español y cada shell declara inLanguage.
  // RONDA 8 (F5): inLanguage no es una propiedad definida para InsuranceAgency en
  // schema.org; se retira del nodo de agencia. El idioma del documento lo
  // declaran <html lang>, hreflang y og:locale.
  if (isEs) {
    html = html.replace(
      '"description": "Independent, licensed Medicare insurance agency helping seniors review Medicare Advantage and Part D options. Free, no-pressure, bilingual (English/Español) guidance.",',
      '"description": "Agencia independiente y licenciada de seguros de Medicare que ayuda a adultos mayores a revisar sus opciones de Medicare Advantage y Parte D. Orientación bilingüe (español/inglés), sin costo y sin presión.",');
  }
  // RONDA 8 (F8): og:locale por shell, para que una página en español no se
  // previsualice como inglesa en redes y mensajería.
  html = html.replace('</head>', `    <meta property="og:locale" content="${isEs ? 'es_US' : 'en_US'}" />\n  </head>`);
  // RONDA 8 (F2): BreadcrumbList para las páginas de guía, que eran callejones
  // sin salida para el rastreador.
  if (route.path.startsWith('/resources/') && !route.noindex) {
    const crumbs = [
      { name: isEs ? 'Inicio' : 'Home', item: SITE + (isEs ? '/es' : '/') },
      { name: isEs ? 'Recursos' : 'Resources', item: SITE + (isEs ? '/es/resources' : '/resources') },
      { name: (isEs ? route.titleEs : route.title).replace(/\s*\|\s*Clear Point.*$/, ''), item: canonical },
    ];
    const ld = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.item })) };
    html = html.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n  </head>`);
  }
  // Sawil 2026-07-27 ES ROUTES — Spanish pages declare their language pre-JS.
  if (isEs) html = html.replace('<html lang="en">', '<html lang="es">');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  if (route.noindex && !/name="robots"/.test(html)) {
    html = html.replace('</head>', `    <meta name="robots" content="${route.nofollow ? 'noindex,nofollow' : 'noindex,follow'}" />\n  </head>`);
  }
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${canonical}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
  // Canonical: RouteMeta upserts the same tag client-side (querySelector), so
  // pre-seeding it is idempotent — no duplicate tag after hydration.
  // FORMS-11 — noindex routes get NO canonical, matching RouteMeta, which
  // strips the tag client-side on /thank-you and /soa/*. Leaving one in the
  // pre-JS shell meant a non-JS crawler saw a canonical the live page denies.
  if (!route.noindex && !/rel="canonical"/.test(html)) {
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
  // with Spanish title/description baked in. FORMS-11: the gate is now the
  // presence of Spanish strings, not indexability, so noindex /thank-you gets
  // its twin too. Identical output for every content route (all carry titleEs).
  if (route.titleEs && route.descriptionEs) {
    writeRoute(esPath(route.path), renderRoute(route, 'es'));
    writtenPaths.push(esPath(route.path));
    written++;
  }
}
console.log(`[prerender-meta] wrote pre-JS metadata for ${written} routes: ${writtenPaths.join(' ')}`);

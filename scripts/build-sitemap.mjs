// AUDIT 2026-09-12 (SEO-L1, P3) — generate dist/sitemap.xml with a TRUTHFUL
// per-route <lastmod>.
//
// public/sitemap.xml carried the same hand-typed lastmod (2026-08-27) on all 26
// URLs while several pages had not changed since July; Google ignores lastmod
// when it is consistently inaccurate. This script derives each route's lastmod
// from the last git commit touching the page component OR any shared surface
// (Header/Footer/Hero/DisclaimerBlock/RouteMeta/index.css) — whichever is newer —
// so the value reflects the last visible change. Runs after prerender-meta.
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://clearpointsenioradvisors.com';

const ROUTES = [
  { path: '/', page: 'src/pages/Home.tsx', changefreq: 'weekly', priority: '1.0' },
  { path: '/about', page: 'src/pages/About.tsx', changefreq: 'monthly', priority: '0.7' },
  { path: '/medicare-advantage', page: 'src/pages/MedicareAdvantage.tsx', changefreq: 'monthly', priority: '0.8' },
  { path: '/part-d', page: 'src/pages/PartD.tsx', changefreq: 'monthly', priority: '0.7' },
  { path: '/extra-help', page: 'src/pages/ExtraHelp.tsx', changefreq: 'monthly', priority: '0.7' },
  { path: '/help-paying-costs', page: 'src/pages/HelpPayingCosts.tsx', changefreq: 'monthly', priority: '0.7' },
  { path: '/otc-benefits', page: 'src/pages/OtcBenefits.tsx', changefreq: 'monthly', priority: '0.6' },
  // RONDA 8 (F7): /support es la superficie del chat (~200 palabras); indexable
  // pero no compite con las páginas de contenido.
  { path: '/support', page: 'src/pages/Support.tsx', changefreq: 'monthly', priority: '0.4' },
  { path: '/resources', page: 'src/pages/Resources.tsx', changefreq: 'monthly', priority: '0.6' },
  { path: '/contact', page: 'src/pages/Contact.tsx', changefreq: 'monthly', priority: '0.9' },
  { path: '/privacy-policy', page: 'src/pages/PrivacyPolicy.tsx', changefreq: 'yearly', priority: '0.3' },
  { path: '/accessibility', page: 'src/pages/Accessibility.tsx', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', page: 'src/pages/Terms.tsx', changefreq: 'yearly', priority: '0.3' },
];

// SEO 2026-09-27 (CA-SEO-03) — las diez guías educativas tienen URL propia.
// Los slugs se leen de src/data/guides.ts para que esta lista no pueda
// divergir de las rutas reales; si el módulo cambia de forma, el build aborta
// en vez de publicar un sitemap incompleto en silencio.
{
  const guidesSrc = readFileSync(join(root, 'src/data/guides.ts'), 'utf8');
  const m = guidesSrc.match(/const SLUGS = (\[[^\]]*\]);/);
  let slugs = [];
  try { slugs = m ? JSON.parse(m[1]) : []; } catch { slugs = []; }
  if (!Array.isArray(slugs) || slugs.length < 10) {
    console.error(`[build-sitemap] FATAL: no se pudieron leer los slugs de las guías de src/data/guides.ts (${slugs.length}).`);
    process.exit(1);
  }
  for (const slug of slugs) ROUTES.push({ path: '/resources/' + slug, page: 'src/data/guides.ts', changefreq: 'monthly', priority: '0.6' });
}
const SHARED = ['src/components/Header.tsx', 'src/components/Footer.tsx', 'src/components/DisclaimerBlock.tsx', 'src/components/RouteMeta.tsx', 'src/lib/tpmoConfig.ts'];

function lastCommitDate(paths) {
  try {
    const out = execSync(`git log -1 --format=%cs -- ${paths.map((p) => JSON.stringify(p)).join(' ')}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch { return null; }
}

const today = new Date().toISOString().slice(0, 10);

// RONDA 8 (SEO-T7, confirmado en vivo: los 46 lastmod valían la fecha del
// build). Vercel clona con profundidad 10, así que `git log` no ve las fechas
// reales por página y todo colapsa al día del despliegue: un "lastmod veraz" que
// miente. En un clon completo (local) las fechas se calculan con git y se
// GUARDAN en scripts/sitemap-dates.json, que viaja en el commit; en un clon
// superficial (Vercel) se LEEN de ese archivo. Si falta en Vercel, el build
// aborta con la pista en vez de publicar fechas falsas.
const SNAPSHOT = join(root, 'scripts/sitemap-dates.json');
const shallow = existsSync(join(root, '.git', 'shallow'));
let snapshot = {};
if (shallow) {
  if (!existsSync(SNAPSHOT)) {
    console.error('[build-sitemap] FATAL: clon superficial sin scripts/sitemap-dates.json. Genere el snapshot con un build local (clon completo) y súbalo; compruebe también que .vercelignore lo permita.');
    process.exit(1);
  }
  snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
}
const dateFor = (key, paths) => {
  if (shallow) return snapshot[key] || today;
  const d = lastCommitDate(paths) || today;
  snapshot[key] = d;
  return d;
};
const sharedDate = dateFor('__shared', SHARED);
const esPath = (p) => (p === '/' ? '/es' : `/es${p}`);
const entries = [];
for (const r of ROUTES) {
  const pageDate = dateFor(r.page, [r.page]);
  const lastmod = pageDate > sharedDate ? pageDate : sharedDate;
  for (const loc of [r.path, esPath(r.path)]) {
    entries.push(`  <url>\n    <loc>${SITE}${loc === '/' ? '/' : loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`);
  }
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
const distDir = join(root, 'dist');
if (!existsSync(distDir)) { console.error('[build-sitemap] dist/ missing — run after vite build'); process.exit(1); }
writeFileSync(join(distDir, 'sitemap.xml'), xml);
if (!shallow) writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`[build-sitemap] lastmod desde ${shallow ? 'snapshot (clon superficial)' : 'git (snapshot actualizado)'}; fechas distintas: ${new Set(Object.values(snapshot)).size}`);
writeFileSync(join(root, 'public', 'sitemap.xml'), xml);
console.log(`[build-sitemap] wrote ${entries.length} URLs (shared-surface lastmod ${sharedDate}; per-page git dates applied)`);

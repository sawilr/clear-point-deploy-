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
import { writeFileSync, existsSync } from 'node:fs';
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
  { path: '/support', page: 'src/pages/Support.tsx', changefreq: 'monthly', priority: '0.8' },
  { path: '/resources', page: 'src/pages/Resources.tsx', changefreq: 'monthly', priority: '0.6' },
  { path: '/contact', page: 'src/pages/Contact.tsx', changefreq: 'monthly', priority: '0.9' },
  { path: '/privacy-policy', page: 'src/pages/PrivacyPolicy.tsx', changefreq: 'yearly', priority: '0.3' },
  { path: '/accessibility', page: 'src/pages/Accessibility.tsx', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', page: 'src/pages/Terms.tsx', changefreq: 'yearly', priority: '0.3' },
];
const SHARED = ['src/components/Header.tsx', 'src/components/Footer.tsx', 'src/components/DisclaimerBlock.tsx', 'src/components/RouteMeta.tsx', 'src/lib/tpmoConfig.ts'];

function lastCommitDate(paths) {
  try {
    const out = execSync(`git log -1 --format=%cs -- ${paths.map((p) => JSON.stringify(p)).join(' ')}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch { return null; }
}

const today = new Date().toISOString().slice(0, 10);
const sharedDate = lastCommitDate(SHARED) || today;
const esPath = (p) => (p === '/' ? '/es' : `/es${p}`);
const entries = [];
for (const r of ROUTES) {
  const pageDate = lastCommitDate([r.page]) || today;
  const lastmod = pageDate > sharedDate ? pageDate : sharedDate;
  for (const loc of [r.path, esPath(r.path)]) {
    entries.push(`  <url>\n    <loc>${SITE}${loc === '/' ? '/' : loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`);
  }
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
const distDir = join(root, 'dist');
if (!existsSync(distDir)) { console.error('[build-sitemap] dist/ missing — run after vite build'); process.exit(1); }
writeFileSync(join(distDir, 'sitemap.xml'), xml);
writeFileSync(join(root, 'public', 'sitemap.xml'), xml);
console.log(`[build-sitemap] wrote ${entries.length} URLs (shared-surface lastmod ${sharedDate}; per-page git dates applied)`);

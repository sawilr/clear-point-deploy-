// AUDIT 2026-07-03 (perf) — one-time JPG->WebP conversion for public/ hero+service
// images. WebP is ~30-70% smaller at equal visual quality; the <picture> tags in
// Hero/ServiceCard serve WebP with a JPG fallback for old Safari. Re-run after
// adding new JPGs. Dev-dep sharp only; not shipped to the client bundle.
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'public';
const jpgs = readdirSync(dir).filter(f => /\.(jpe?g)$/i.test(f));
let before = 0, after = 0;
for (const f of jpgs) {
  const src = join(dir, f);
  const out = src.replace(/\.(jpe?g)$/i, '.webp');
  const b = statSync(src).size;
  await sharp(src).webp({ quality: 82 }).toFile(out);
  const a = statSync(out).size;
  before += b; after += a;
  console.log(`${f}: ${(b/1024).toFixed(0)}KB -> ${(a/1024).toFixed(0)}KB (${Math.round((1-a/b)*100)}% smaller)`);
}
console.log(`\nTOTAL: ${(before/1024).toFixed(0)}KB -> ${(after/1024).toFixed(0)}KB WebP (${Math.round((1-after/before)*100)}% smaller, ${jpgs.length} imgs)`);

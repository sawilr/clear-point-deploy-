// scripts/prerender-body.mjs — inyecta el HTML renderizado en servidor de cada
// ruta en su shell de dist/, después de que prerender-meta.mjs haya escrito los
// títulos y metadatos.
//
// SEO 2026-09-27 (SEO-T1 / SEO-LIVE-04 / CA-SEO-04 / EEAT-05 — alto impacto,
// confirmado por cuatro especialistas independientes y reproducido aquí).
//
// Qué recibía Google antes: 28 shells con <div id="root"></div> vacío. Cero
// palabras de cuerpo, cero enlaces, sin H1, sin la declaración TPMO, sin el
// nombre del asesor ni su NPN. Todo existía solo después de JavaScript.
//
// Qué recibe ahora: el mismo HTML que React pinta en el navegador, medido en el
// experimento previo: la portada 2,266 palabras y 36 enlaces; /part-d 1,143;
// /extra-help 1,152; /otc-benefits 1,392. Un rastreador sin JavaScript lee el
// sitio completo; Google indexa sin esperar su cola de render; el LCP mejora
// porque el texto pinta antes de que llegue el paquete.
//
// Cómo convive con el cliente: main.tsx sigue usando createRoot().render(), que
// al montar sustituye el DOM prerenderizado por uno idéntico. No hay hidratación
// ni sus desajustes (preferencia de idioma en localStorage, fecha del texto
// TPMO). El costo es un repintado invisible; el beneficio es todo lo anterior.
//
// Dependencia de fecha — IMPORTANTE para el operador: el HTML se congela en el
// momento del build. El texto TPMO cambia a la redacción CY2027 el 1 de octubre
// de 2026 dentro de la app; un shell construido antes de esa fecha lo mostrará
// con la redacción anterior hasta que React monte. Hay que RECONSTRUIR Y
// REDESPLEGAR el 1 de octubre o después. check-figures-year.mjs ya protege el
// cambio de año de las cifras; esto es lo mismo para el texto.
//
// Guardas — "una comprobación que no encuentra qué revisar ha fallado":
//   - cada ruta de contenido debe superar un mínimo de palabras y tener H1;
//   - la declaración TPMO debe estar en el cuerpo de cada ruta de contenido;
//   - ninguna fuga de rutas de desarrollo (/src/) en el HTML;
//   - el marcador <div id="root"></div> debe encontrarse exactamente una vez.
// Cualquier fallo aborta el build: un prerender roto en silencio sería peor que
// el cascarón vacío, porque nadie lo vería.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = '/scripts/ssr-entry.tsx';
if (!existsSync(join(root, 'scripts/ssr-entry.tsx'))) {
  console.error('[prerender-body] FATAL: falta scripts/ssr-entry.tsx. Si esto ocurre en Vercel, revise que .vercelignore lo permita con "!scripts/ssr-entry.tsx".');
  process.exit(1);
}

// Las mismas rutas que prerender-meta.mjs: se leen de RouteMeta.tsx para que
// las dos listas no puedan divergir.
const metaSrc = readFileSync(join(root, 'src/components/RouteMeta.tsx'), 'utf8');
const ROUTES = [...metaSrc.matchAll(/^\s*'(\/[a-z0-9/-]*)':\s*\{/gm)].map((m) => m[1]);
if (ROUTES.length < 13) {
  console.error(`[prerender-body] FATAL: solo ${ROUTES.length} rutas extraídas de RouteMeta.tsx (se esperaban >= 13).`);
  process.exit(1);
}

// Rutas que se prerenderizan pero cuyo cuerpo es mínimo por diseño (la
// superficie del chat), y rutas que NO se prerenderizan (noindex / por usuario).
const THIN_OK = new Set(['/support']);
const MIN_WORDS = 300;
const TPMO_RE = /do not offer every plan|no ofrecemos todos los planes/i;

// createServer() es command === 'serve' para vite.config.ts, y en ese modo el
// plugin de inspección de desarrollo estampa code-path="src\…" en cada
// elemento. Esta variable lo desactiva (vite.config.ts la respeta) y la guarda
// de abajo aborta el build si aun así aparece.
process.env.CP_PRERENDER = '1';
const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
let render;
try {
  ({ render } = await vite.ssrLoadModule(ENTRY));
} catch (e) {
  console.error('[prerender-body] FATAL: no se pudo cargar la entrada SSR: ' + (e && e.message ? e.message : String(e)));
  await vite.close();
  process.exit(1);
}

const targets = [];
for (const r of ROUTES) {
  targets.push({ path: r, file: r === '/' ? join(root, 'dist/index.html') : join(root, 'dist', r.slice(1), 'index.html') });
  const es = r === '/' ? '/es' : '/es' + r;
  targets.push({ path: es, file: join(root, 'dist', es.slice(1), 'index.html') });
}

const problems = [];
let done = 0, totalWords = 0;
const t0 = Date.now();
for (const t of targets) {
  if (!existsSync(t.file)) { problems.push(`${t.path}: no existe ${t.file} (¿corrió prerender-meta antes?)`); continue; }
  let html;
  try { html = await render(t.path); }
  catch (e) { problems.push(`${t.path}: el render falló — ${e && e.message ? e.message : String(e)}`); continue; }

  const text = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const hasH1 = /<h1[\s>]/.test(html);
  const thin = THIN_OK.has(t.path.replace(/^\/es(?=\/|$)/, '') || '/');
  if (/\/src\//.test(html)) problems.push(`${t.path}: fuga de ruta de desarrollo (/src/) en el HTML prerenderizado`);
  if (/\bcode-path="/.test(html)) problems.push(`${t.path}: atributos code-path del plugin de inspección en el HTML prerenderizado (¿CP_PRERENDER no llegó a vite.config?)`);
  // RONDA 8 (R8-01 / F1, ALTO). El contenido tiene que estar EN ORDEN y VISIBLE:
  // ni segmentos de Suspense ocultos tras el pie, ni scripts de streaming que la
  // CSP bloquea, ni un <main> con el esqueleto. Si una página suspende en el
  // render definitivo, el build falla aquí en vez de publicar un cascarón con
  // el cuerpo escondido.
  if (/<div hidden id="S:/.test(html) || /<template id="B:/.test(html) || /\$RC\(|\$RB\(/.test(html)) problems.push(`${t.path}: el HTML prerenderizado contiene segmentos de Suspense fuera de orden o scripts de streaming ($RC) — una página suspendió en el render definitivo`);
  {
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
    const mainText = mainMatch ? mainMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const mainWords = mainText ? mainText.split(' ').length : 0;
    // Umbral propio para <main>: un esqueleto de Suspense tiene menos de 20
    // palabras; una página legítimamente breve (Accesibilidad, algunas guías)
    // tiene 200–290. El mínimo de 300 del cuerpo completo sigue aplicando arriba.
    const MIN_MAIN_WORDS = 120;
    if (!thin && mainWords < MIN_MAIN_WORDS) problems.push(`${t.path}: <main> solo tiene ${mainWords} palabras en el HTML prerenderizado (mínimo ${MIN_MAIN_WORDS}) — el cuerpo no está dentro de main`);
    if (/aria-busy="true"/.test(mainMatch ? mainMatch[1] : '')) problems.push(`${t.path}: <main> contiene un esqueleto de Suspense (aria-busy="true") en el HTML prerenderizado`);
  }
  if (!thin && words < MIN_WORDS) problems.push(`${t.path}: solo ${words} palabras (mínimo ${MIN_WORDS}) — ¿una página quedó en su fallback de Suspense?`);
  if (!thin && !hasH1) problems.push(`${t.path}: sin <h1> en el HTML prerenderizado`);
  if (!thin && !TPMO_RE.test(text)) problems.push(`${t.path}: la declaración TPMO no aparece en el cuerpo prerenderizado`);

  const shell = readFileSync(t.file, 'utf8');
  const marker = '<div id="root"></div>';
  const count = shell.split(marker).length - 1;
  if (count !== 1) { problems.push(`${t.path}: el marcador ${marker} aparece ${count} veces en el shell (se esperaba 1)${/<div id="root">[^<]*</.test(shell) ? ' — el shell ya tiene cuerpo inyectado: este script solo debe correr una vez por build, justo después de prerender-meta' : ''}`); continue; }
  // RONDA 8 — se escribe SOLO si esta ruta pasó todas las comprobaciones. Antes,
  // una ruta con un problema no-marcador se inyectaba igual y un build fallido
  // dejaba dist/ a medias: la mitad de los shells con cuerpo y la otra sin él.
  const routeProblems = problems.filter((p) => p.startsWith(t.path + ':'));
  if (routeProblems.length) continue;
  writeFileSync(t.file, shell.replace(marker, `<div id="root">${html}</div>`), 'utf8');
  done++; totalWords += words;
}
await vite.close();

if (problems.length) {
  console.error(`[prerender-body] FALLO — ${problems.length} problema(s); el build se aborta para que un prerender roto nunca se despliegue en silencio:\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`[prerender-body] OK — ${done}/${targets.length} rutas con cuerpo prerenderizado (${totalWords.toLocaleString('en-US')} palabras en total, ${Date.now() - t0} ms). Recuerde reconstruir el 1 de octubre para el texto TPMO CY2027.`);

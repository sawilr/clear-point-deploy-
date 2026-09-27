// scripts/ssr-entry.tsx — entrada de renderizado en servidor para el prerender.
//
// SEO 2026-09-27 (SEO-T1 / SEO-LIVE-04 / CA-SEO-04, alto impacto). Hasta el 27
// cada ruta llegaba a Google como un cascarón de 5.5 KB con <div id="root">
// vacío. Este módulo lo carga scripts/prerender-body.mjs a través del cargador
// SSR de Vite; el router es StaticRouter y LanguageProvider (dentro de App)
// decide el idioma por la URL.
//
// RONDA 8 (2026-09-27, R8-01 / F1, ALTO — regresión mía, hallada por dos lentes
// independientes y confirmada en producción). La primera versión usaba solo
// `prerender` de react-dom/static. Como las páginas son React.lazy, suspenden en
// el primer render y React emite el contenido como segmentos de Suspense fuera
// de orden: <main> quedaba con el esqueleto (aria-busy="true") y el cuerpo real
// iba en <div hidden id="S:n"> DESPUÉS del pie, a la espera de un script inline
// ($RC) que la CSP del sitio —sin unsafe-inline— bloquea. Medido en vivo: 0
// palabras dentro de <main> en todas las rutas; mi sonda de paridad contaba
// palabras aunque estuvieran ocultas y no lo vio.
//
// Solución: un pase de CALENTAMIENTO con `prerender` (que espera Suspense y deja
// resueltos los módulos lazy en el proceso) y después el render definitivo con
// `renderToString`, que con los módulos ya resueltos no suspende y produce el
// marcado completo, en orden y sin scripts de streaming. prerender-body.mjs
// aborta el build si aun así aparece un segmento oculto o un <main> vacío.
import React from 'react';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { StaticRouter } from 'react-router';
import App from '../src/App';

const warmed = new Set<string>();

async function warm(path: string): Promise<void> {
  if (warmed.has(path)) return;
  const { prelude } = await prerender(
    <StaticRouter location={path}><App /></StaticRouter>,
    { signal: AbortSignal.timeout(20000) },
  );
  // Drenar el stream: obliga a resolver todos los límites de Suspense.
  const reader = prelude.getReader();
  for (;;) { const { done } = await reader.read(); if (done) break; }
  warmed.add(path);
}

export async function render(path: string): Promise<string> {
  await warm(path);
  return renderToString(<StaticRouter location={path}><App /></StaticRouter>);
}

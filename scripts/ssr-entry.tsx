// scripts/ssr-entry.tsx — entrada de renderizado en servidor para el prerender.
//
// SEO 2026-09-27 (SEO-T1 / SEO-LIVE-04 / CA-SEO-04, alto impacto). Hasta hoy
// cada ruta llegaba a Google como un cascarón de 5.5 KB con <div id="root">
// vacío: cero palabras de cuerpo, cero enlaces internos, sin H1. Todo el
// contenido dependía de que Google ejecutara JavaScript en su cola de render, y
// los rastreadores que no ejecutan JS no veían nada.
//
// Este módulo lo carga scripts/prerender-body.mjs a través del cargador SSR de
// Vite (createServer().ssrLoadModule), que resuelve import.meta.env, CSS e
// imágenes igual que el build del cliente. Usa `prerender` de react-dom/static
// (React 19), que ESPERA los límites de Suspense: las páginas se cargan con
// React.lazy y renderToString las dejaría en su fallback.
//
// El router es StaticRouter con la ruta pedida; LanguageProvider vive dentro de
// App y decide el idioma por la URL, así que /es/* sale en español.
import React from 'react';
import { prerender } from 'react-dom/static';
import { StaticRouter } from 'react-router';
import App from '../src/App';

export async function render(path: string): Promise<string> {
  const { prelude } = await prerender(
    <StaticRouter location={path}><App /></StaticRouter>,
    { signal: AbortSignal.timeout(20000) },
  );
  const reader = prelude.getReader();
  const dec = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
  }
  return html;
}

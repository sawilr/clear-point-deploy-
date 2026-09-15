// scripts/check-vercel-config.mjs
//
// AUDITORÍA INDEPENDIENTE 2026-09-15 — SEC-A7-02, CRITICAL.
//
// Vercel rechaza claves desconocidas en vercel.json: el esquema publicado en
// https://openapi.vercel.sh/vercel.json marca "additionalProperties": false en
// las entradas de headers, redirects y rewrites.
//
// El commit f077f76 metió una clave "_comment" dentro de una entrada de headers
// para dejar escrito por qué se retiraba X-XSS-Protection. La intención era
// buena y el efecto fue el peor posible: el archivo entero dejó de ser válido,
// así que TODO el endurecimiento de cabeceras de esta rama —incluida su propia
// corrección de no-cachear-rechazos y el upgrade-insecure-requests de la CSP—
// no podía desplegarse. Un comentario bien intencionado desarmó la rama.
//
// Peor todavía: el fallo no se ve hasta el despliegue. `npm run build` no lee
// vercel.json, y las pruebas tampoco. Se descubre cuando ya se intentó publicar.
//
// Esta puerta corre en el build. No necesita red: el esquema relevante es una
// lista corta de claves permitidas por sección, y prefiero una comprobación
// determinista y offline a una que dependa de que openapi.vercel.sh responda
// durante una compilación.
//
// Si Vercel añade una clave nueva y legítima, se agrega aquí. Ese roce es
// deliberado: es más barato que descubrir en producción que la configuración
// de seguridad llevaba semanas sin aplicarse.

import { readFileSync } from 'node:fs';

const PERMITIDAS = {
  'headers[]':          ['source', 'headers', 'has', 'missing'],
  'headers[].headers[]': ['key', 'value'],
  'redirects[]':        ['source', 'destination', 'permanent', 'statusCode', 'has', 'missing'],
  'rewrites[]':         ['source', 'destination', 'has', 'missing'],
  'cleanUrls':          null,
  'trailingSlash':      null,
};

const RAIZ_PERMITIDA = [
  'headers', 'redirects', 'rewrites', 'cleanUrls', 'trailingSlash', 'routes',
  'buildCommand', 'outputDirectory', 'installCommand', 'devCommand', 'framework',
  'functions', 'regions', 'crons', 'images', 'public', 'git', 'ignoreCommand',
  '$schema',
];

let texto;
try {
  texto = readFileSync('vercel.json', 'utf8');
} catch {
  console.log('[vercel-config] no hay vercel.json — nada que validar.');
  process.exit(0);
}

let cfg;
try {
  cfg = JSON.parse(texto);
} catch (e) {
  console.error('[vercel-config] FALLO — vercel.json no es JSON válido: ' + e.message);
  process.exit(1);
}

const problemas = [];
const sobran = (obj, permitidas, donde) => {
  const extra = Object.keys(obj).filter((k) => !permitidas.includes(k));
  if (extra.length) problemas.push(`${donde}: clave(s) no permitida(s) ${extra.map((k) => JSON.stringify(k)).join(', ')}`);
};

sobran(cfg, RAIZ_PERMITIDA, 'raíz');

(cfg.headers || []).forEach((grupo, i) => {
  sobran(grupo, PERMITIDAS['headers[]'], `headers[${i}]`);
  (grupo.headers || []).forEach((h, j) => {
    sobran(h, PERMITIDAS['headers[].headers[]'], `headers[${i}].headers[${j}] (${h.key || 'sin key'})`);
    if (typeof h.key !== 'string' || typeof h.value !== 'string') {
      problemas.push(`headers[${i}].headers[${j}]: key y value deben ser cadenas`);
    }
  });
});

(cfg.redirects || []).forEach((r, i) => sobran(r, PERMITIDAS['redirects[]'], `redirects[${i}]`));
(cfg.rewrites || []).forEach((r, i) => sobran(r, PERMITIDAS['rewrites[]'], `rewrites[${i}]`));

if (problemas.length) {
  console.error('[vercel-config] FALLO — Vercel rechazaría este archivo y la configuración de seguridad NO se aplicaría:\n');
  for (const p of problemas) console.error('  ' + p);
  console.error('\n  Vercel usa additionalProperties:false. Las anotaciones van en el mensaje del commit');
  console.error('  o en docs/, nunca dentro del JSON.');
  process.exit(1);
}

const nCab = (cfg.headers || []).reduce((n, g) => n + (g.headers || []).length, 0);
console.log(`[vercel-config] OK — ${(cfg.headers || []).length} grupo(s) de cabeceras con ${nCab} cabeceras, ${(cfg.redirects || []).length} redirecciones y ${(cfg.rewrites || []).length} reescrituras, todas con claves válidas.`);

// LOCAL API HARNESS — serves the REAL api/chat.js handler on localhost.
//
// Why this exists: `vite dev` serves only the SPA (no /api routes), and this
// repo is deliberately not linked for `vercel dev` (see the deploy runbook —
// a stray `vercel` project was once created from this folder). This harness
// imports the exact same module Vercel routes /api/chat to, loads .env.local
// the same way Vercel injects env vars, and serves it on a local port — so the
// LIVE gate exercises the production handler, not a copy.
//
// Usage:
//   node scripts/dev-api-server.mjs            # port 3011
//   PORT=4000 node scripts/dev-api-server.mjs
//
// SECRETS: reads .env.local from the repo root. Never logs values.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env.local loader (no dependency): KEY=VALUE lines, # comments.
const envPath = join(root, '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  let loaded = 0;
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) { process.env[m[1]] = m[2].replace(/^"|"$/g, ''); loaded++; }
  }
  console.log(`[dev-api] .env.local loaded (${loaded} vars set — names only, values never printed)`);
} else {
  console.log('[dev-api] no .env.local found — provider will 503 unless env is already set');
}

const { default: chatHandler } = await import('../api/chat.js');

const PORT = parseInt(process.env.PORT || '3011', 10);

const server = createServer((req, res) => {
  if (!/^\/api\/chat\/?$/.test(req.url || '')) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'only /api/chat is served here' }));
    return;
  }
  // Collect the JSON body, then adapt to the Vercel handler shape (req.body).
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { body = {}; }
    const vReq = {
      method: req.method,
      headers: { origin: 'http://localhost:5173', ...req.headers },
      body,
      on() {},
    };
    const vRes = {
      statusCode: 200,
      setHeader(k, v) { try { res.setHeader(k, v); } catch (e) { /* dup */ } return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) {
        res.statusCode = this.statusCode;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(o));
        return this;
      },
      end() { res.statusCode = this.statusCode; res.end(); return this; },
    };
    try {
      await chatHandler(vReq, vRes);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'harness_exception' }));
      console.error('[dev-api] handler exception:', e && e.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[dev-api] serving the REAL api/chat.js on http://localhost:${PORT}/api/chat`);
  console.log('[dev-api] provider will be selected from env exactly as in production');
});

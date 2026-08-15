// LOCAL LEAD HARNESS — serves the REAL api/submit-lead.js handler on localhost.
//
// Mirrors scripts/dev-api-server.mjs (which serves api/chat.js) but for the
// lead endpoint, with FAITHFUL Vercel body semantics: `req.body` is a getter
// that THROWS on malformed JSON — exactly what the platform does — so the
// _lib/read-body.js hang fix is exercised for real, not approximated.
//
// SAFETY — this harness must never write to the production CRM by accident:
//   • If HIGHLEVEL_TOKEN is unset it is forced to 'local-dummy-token'
//     (GHL answers 401 → the handler's sanitized 502 path, no data written).
//   • If HIGHLEVEL_TOKEN is set to anything not starting with 'local-' the
//     harness REFUSES to start unless ALLOW_REAL_CRM=1 is explicitly set.
//
// Usage:
//   node scripts/dev-lead-server.mjs                 # port 3013
//   PORT=4001 node scripts/dev-lead-server.mjs
//   TURNSTILE_SECRET=1x0000000000000000000000000000000AA node scripts/dev-lead-server.mjs
//
// Browser QA: LEAD_API_PROXY=http://localhost:3013 npm run dev
// (vite proxies /api/submit-lead here — opt-in only, see vite.config.ts).
//
// SECRETS: reads .env.local from the repo root when present. Never logs values.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env.local loader (no dependency): KEY=VALUE lines, # comments.
// CLI-provided env always wins (only unset keys are filled in).
const envPath = join(root, '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  let loaded = 0;
  for (const line of lines) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) { process.env[m[1]] = m[2].replace(/^"|"$/g, ''); loaded++; }
  }
  console.log(`[dev-lead] .env.local loaded (${loaded} vars set — names only, values never printed)`);
}

// ── CRM safety interlock ────────────────────────────────────────────────────
if (!process.env.HIGHLEVEL_TOKEN) {
  process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
  process.env.HIGHLEVEL_LOCATION_ID = process.env.HIGHLEVEL_LOCATION_ID || 'local-dummy-location';
  console.log('[dev-lead] HIGHLEVEL_TOKEN unset → using local dummy (GHL will 401 → sanitized 502; nothing is written)');
} else if (!process.env.HIGHLEVEL_TOKEN.startsWith('local-') && process.env.ALLOW_REAL_CRM !== '1') {
  console.error('[dev-lead] REFUSING TO START: HIGHLEVEL_TOKEN looks real. QA must not write to the production CRM.');
  console.error('[dev-lead] Set ALLOW_REAL_CRM=1 only if you explicitly intend that.');
  process.exit(1);
}
// Never spend LLM tokens on lead-intel during QA unless explicitly allowed.
if (process.env.ALLOW_REAL_LLM !== '1') {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
}

const { default: leadHandler } = await import('../api/submit-lead.js');

const PORT = parseInt(process.env.PORT || '3013', 10);

const server = createServer((req, res) => {
  if (!/^\/api\/submit-lead\/?$/.test((req.url || '').split('?')[0])) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'only /api/submit-lead is served here' }));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    // Faithful Vercel semantics: parsed lazily via a THROWING getter.
    const vReq = {
      method: req.method,
      headers: { ...req.headers },
      // The stream is already consumed here — exactly like production after
      // the platform parser ran. readableEnded guards the re-read path.
      readableEnded: true,
      complete: true,
      on() {},
      get body() {
        if (!raw || !raw.trim()) return undefined;
        return JSON.parse(raw); // throws on malformed JSON, like Vercel
      },
    };
    const headers = {};
    const vRes = {
      statusCode: 200,
      setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
      getHeader(k) { return headers[String(k).toLowerCase()]; },
      status(c) { this.statusCode = c; return this; },
      json(obj) {
        res.writeHead(this.statusCode, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(obj));
        return this;
      },
      end(data) {
        res.writeHead(this.statusCode, headers);
        res.end(data);
        return this;
      },
    };
    try {
      await leadHandler(vReq, vRes);
    } catch (e) {
      console.error('[dev-lead] handler threw:', e && e.message ? e.message : e);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'harness_unhandled' }));
      }
    }
  });
});

server.listen(PORT, () => {
  const mode = process.env.TURNSTILE_SECRET
    ? (String(process.env.TURNSTILE_MODE || 'enforce').toLowerCase())
    : 'off';
  console.log(`[dev-lead] serving REAL api/submit-lead.js on http://localhost:${PORT}/api/submit-lead (turnstile=${mode})`);
});

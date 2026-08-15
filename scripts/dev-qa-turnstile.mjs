// QA LAUNCHER (2026-08-15, Turnstile remediation) — starts vite dev with the
// Cloudflare PUBLIC dummy sitekey (invisible, always passes) and the
// /api/submit-lead proxy pointed at the local lead harness
// (scripts/dev-lead-server.mjs), so the full form → challenge → server
// verification loop can be exercised in a real browser without touching
// production or the real CRM.
//
// Usage:  node scripts/dev-qa-turnstile.mjs
// Pair with:  node scripts/dev-lead-server.mjs  (port 3013)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

process.env.VITE_TURNSTILE_SITEKEY = process.env.VITE_TURNSTILE_SITEKEY || '1x00000000000000000000BB';
process.env.LEAD_API_PROXY = process.env.LEAD_API_PROXY || 'http://localhost:3013';

console.log('[dev-qa] vite dev with VITE_TURNSTILE_SITEKEY=<dummy> and LEAD_API_PROXY=' + process.env.LEAD_API_PROXY);

const child = spawn('npx', ['vite'], { cwd: root, stdio: 'inherit', shell: true });
child.on('exit', (code) => process.exit(code == null ? 1 : code));

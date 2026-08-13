// AUDIT 2026-08-13 (§12) — kill-switch behavior tests.
// Run: npx tsx scripts/test-kill-switch-2026-08-13.mjs
import { readFileSync } from 'node:fs';

let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(id + (why ? ' — ' + why : '')); };

// Fresh module per env permutation — env is read at call time, but re-importing
// keeps each case independent and obvious.
async function load() {
  const mod = await import('../api/_lib/kill-switch.js?t=' + Math.random());
  return mod;
}
function clearEnv() {
  delete process.env.CP_KILL_ALL;
  delete process.env.CP_KILL_AI;
  delete process.env.CP_KILL_LEADS;
  delete process.env.CP_KILL_OPTOUT;
}
function fakeRes() {
  return {
    _status: null, _json: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
  };
}

const { killState, enforceKill, killSwitchReport } = await load();

// ── DEFAULT: everything OFF, nothing blocked ────────────────────────────────
clearEnv();
check('D1 ai not killed by default', killState('ai').killed === false);
check('D2 leads not killed by default', killState('leads').killed === false);
check('D3 optout not killed by default', killState('optout').killed === false);
check('D4 report all false', Object.values(killSwitchReport()).every((v) => v === false));
{
  const res = fakeRes();
  check('D5 enforceKill is a no-op when unset', enforceKill(res, 'ai', 'en') === false && res._status === null);
}

// ── PER-CAPABILITY SWITCHES ─────────────────────────────────────────────────
clearEnv(); process.env.CP_KILL_AI = '1';
check('P1 ai killed', killState('ai').killed === true);
check('P2 leads NOT killed by the AI switch', killState('leads').killed === false,
  'switches must be independent — killing the LLM must not kill lead capture');
{
  const res = fakeRes();
  const killed = enforceKill(res, 'ai', 'en');
  check('P3 ai returns 200 (assistants treat non-200 as broken)', killed === true && res._status === 200, 'status=' + res._status);
  check('P4 ai payload shaped like a normal reply', typeof res._json?.response === 'string' && res._json.meta?.blocked === 'kill_switch');
  check('P5 ai copy routes to a human', /1-855-720-8555/.test(res._json.response), res._json.response);
}
{
  const res = fakeRes();
  process.env.CP_KILL_AI = '1';
  enforceKill(res, 'ai', 'es');
  check('P6 spanish copy when lang=es', /asesor licenciado/.test(res._json.response), res._json.response);
}

clearEnv(); process.env.CP_KILL_LEADS = 'true';
{
  const res = fakeRes();
  const killed = enforceKill(res, 'leads', 'en');
  check('P7 leads killed with "true"', killed === true);
  check('P8 leads returns 503 (caller must NOT read it as success)', res._status === 503, 'status=' + res._status);
  check('P9 leads copy routes to a human', /1-855-720-8555/.test(res._json.message));
  check('P10 ai unaffected by the leads switch', killState('ai').killed === false);
}

// ── MASTER SWITCH ───────────────────────────────────────────────────────────
clearEnv(); process.env.CP_KILL_ALL = 'on';
check('M1 master kills ai', killState('ai').killed === true);
check('M2 master kills leads', killState('leads').killed === true);
check('M3 master kills optout', killState('optout').killed === true);
check('M4 reason names the master var', killState('ai').reason === 'CP_KILL_ALL');

// ── VALUE PARSING — the classic footgun ─────────────────────────────────────
// A switch that treats ANY non-empty string as ON turns a stray newline into an
// outage; one that ignores case/whitespace fails when set from a console.
for (const v of ['1', 'true', 'TRUE', 'on', 'ON', 'yes', ' 1 ', 'True ']) {
  clearEnv(); process.env.CP_KILL_AI = v;
  check(`V-on ${JSON.stringify(v)} enables`, killState('ai').killed === true, 'value=' + JSON.stringify(v));
}
for (const v of ['0', 'false', 'off', 'no', '', '  ', 'disabled', 'null', 'undefined', 'maybe']) {
  clearEnv(); process.env.CP_KILL_AI = v;
  check(`V-off ${JSON.stringify(v)} does NOT enable`, killState('ai').killed === false, 'value=' + JSON.stringify(v));
}

// ── FAIL-OPEN ON READ ───────────────────────────────────────────────────────
// An absent or garbage variable must never take the site down by accident.
clearEnv();
check('F1 absent env = normal operation', killState('ai').killed === false);
process.env.CP_KILL_AI = 'yes-please-no';
check('F2 malformed value = normal operation', killState('ai').killed === false,
  'an unreadable switch must fail OPEN so a typo cannot cause an outage');

// ── SOURCE-LEVEL GUARANTEES ─────────────────────────────────────────────────
const SRC = readFileSync(new URL('../api/_lib/kill-switch.js', import.meta.url), 'utf8');
check('S1 no network dependency', !/fetch\(|require\(.http|KV_REST/.test(SRC),
  'a switch that needs the network is useless in the outages you need it for');
check('S2 every trip is logged', /\[KILL-SWITCH\]/.test(SRC));
check('S3 explicit truthy set, not any-non-empty', /TRUTHY\s*=\s*new Set/.test(SRC));
// The real property: this module can only ever REFUSE. It performs no network
// call, no CRM write, and mutates no external state — its entire surface is three
// read/enforce functions. So a bug here can only make Clear Point quieter.
check('S4 module surface is read/enforce only',
  /^export function (killState|enforceKill|killSwitchReport)/gm.test(SRC)
  && (SRC.match(/^export /gm) || []).length === 3
  && !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(SRC),
  'exports=' + JSON.stringify(SRC.match(/^export function \w+/gm)));

// ── WIRED INTO THE ENDPOINTS, IN THE RIGHT PLACE ────────────────────────────
const CHAT = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8');
const LEAD = readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8');
const OPT = readFileSync(new URL('../api/opt-out.js', import.meta.url), 'utf8');
check('W1 chat wired', /enforceKill\(res, 'ai'/.test(CHAT));
check('W2 leads wired', /enforceKill\(res, 'leads'/.test(LEAD));
check('W3 optout wired', /enforceKill\(res, 'optout'/.test(OPT));
// Compare against the actual fetch CALL SITE, not the URL constant declared at
// the top of the file — an earlier version of this assertion compared against the
// declaration and was meaningless.
check('W4 chat switch precedes the provider call',
  CHAT.indexOf("enforceKill(res, 'ai'") < CHAT.indexOf('fetch(ANTHROPIC_API'),
  'a tripped switch must cost nothing — no provider call, no rate-limit burn');
check('W4b chat switch precedes rate-limit accounting',
  CHAT.indexOf("enforceKill(res, 'ai'") < CHAT.indexOf("prefix: 'chat"),
  'a tripped switch must not consume the caller quota');
check('W5 leads switch sits AFTER the honeypot',
  LEAD.indexOf('Honeypot triggered') < LEAD.indexOf("enforceKill(res, 'leads'"),
  'bots must still get the benign fake success and learn nothing');
check('W6 leads switch precedes the CRM token read',
  LEAD.indexOf("enforceKill(res, 'leads'") < LEAD.indexOf('process.env.HIGHLEVEL_TOKEN'),
  'no CRM or LLM work when the switch is tripped');

clearEnv();
console.log(`kill switch (§12): ${pass}/${pass + fail.length} passed`);
if (fail.length) {
  console.error('\x1b[31mFAILURES:\x1b[0m\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('\x1b[32m✓ runtime kill switches behave correctly and fail open on read\x1b[0m');

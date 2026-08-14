// OPENAI PROVIDER LAYER — unit suite (offline, mocked transport).
//
// Exercises api/_lib/llm-provider.js through the REAL OpenAI SDK with an
// injected fetch — request construction, model routing, error taxonomy,
// bounded retries and secret hygiene, with zero network and zero key.
// The production-path wiring (through api/chat.js itself) is a SEPARATE
// suite: scripts/test-chat-wiring-2026-08-13.mjs — §15 of the mission.
//
// Run: npx tsx scripts/test-openai-provider-2026-08-13.mjs
import { callOpenAI, resolveOpenAIModels, selectLLMProvider, sanitizeDetail, __setLLMTestFetch } from '../api/_lib/llm-provider.js';

const RED = (s) => '\x1b[31m' + s + '\x1b[0m';
const GRN = (s) => '\x1b[32m' + s + '\x1b[0m';
let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(`${id}${why ? '\n      ' + why : ''}`); };

const okResponse = (text, extra = {}) => new Response(JSON.stringify({
  id: 'resp_ok', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 42, output_tokens: 7, total_tokens: 49 },
  ...extra,
}), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_mock' } });

const errResponse = (status, body = {}) => new Response(JSON.stringify({ error: { message: 'mock error', type: 'x', ...body } }), {
  status, headers: { 'content-type': 'application/json' },
});

function env(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  const restore = () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  return fn().finally(restore);
}
const BASE = { OPENAI_API_KEY: 'sk-test-dummy-not-a-real-key', VERCEL_ENV: undefined, OPENAI_MODEL_OVERRIDE: undefined, OPENAI_TEMPERATURE: undefined, OPENAI_TIMEOUT_MS: undefined, OPENAI_ENABLE_WEB_SEARCH: undefined, LLM_PROVIDER: undefined };
const PAYLOAD = { systemPrompt: 'SYS PROMPT', contextSummary: 'CTX BLOCK', messages: [{ role: 'user', content: 'hola' }] };

// ══ 1. Request construction ══════════════════════════════════════════════════
await env(BASE, async () => {
  let captured = null;
  __setLLMTestFetch(async (url, init) => { captured = { url: String(url), body: JSON.parse(init.body) }; return okResponse('respuesta'); });
  const r = await callOpenAI(PAYLOAD);
  check('1.1 targets the Responses API endpoint', captured && /api\.openai\.com\/v1\/responses$/.test(captured.url), `url: ${captured && captured.url}`);
  check('1.2 QA model selected outside production env', captured.body.model === 'gpt-5.6-luna', `model: ${captured.body.model}`);
  check('1.3 instructions = system prompt + context block', captured.body.instructions === 'SYS PROMPT\n\nCTX BLOCK');
  check('1.4 messages become input array', Array.isArray(captured.body.input) && captured.body.input[0].content === 'hola');
  check('1.5 max_output_tokens defaulted', captured.body.max_output_tokens === 1024);
  check('1.6 temperature defaults to 0.2', captured.body.temperature === 0.2, `temp: ${captured.body.temperature}`);
  check('1.7 web search tool ABSENT by default', captured.body.tools === undefined, 'tools sent without the opt-in flag');
  check('1.8 happy path returns text', r.ok === true && r.text === 'respuesta');
  check('1.9 usage + latency + model surfaced', r.usage && r.usage.total_tokens === 49 && typeof r.latencyMs === 'number' && r.model === 'gpt-5.6-luna');
  check('1.10 modelRole reported as qa', r.modelRole === 'qa');
});

// ══ 2. Model routing (pure function — production env can't take the seam) ════
{
  const dev = resolveOpenAIModels({});
  const prod = resolveOpenAIModels({ VERCEL_ENV: 'production' });
  const preview = resolveOpenAIModels({ VERCEL_ENV: 'preview' });
  const ovr = resolveOpenAIModels({ VERCEL_ENV: 'production', OPENAI_MODEL_OVERRIDE: 'gpt-5.6-luna' });
  const custom = resolveOpenAIModels({ OPENAI_MODEL_QA: 'my-qa-model' });
  check('2.1 dev → QA model (gpt-5.6-luna)', dev.active === 'gpt-5.6-luna' && dev.role === 'qa');
  check('2.2 production → production model (gpt-5.6-terra)', prod.active === 'gpt-5.6-terra' && prod.role === 'production');
  check('2.3 preview → QA model (red-team runs never burn Terra)', preview.active === 'gpt-5.6-luna' && preview.role === 'qa');
  check('2.4 override wins anywhere and is labeled', ovr.active === 'gpt-5.6-luna' && ovr.role === 'override');
  check('2.5 model ids are env-configurable without code changes', custom.active === 'my-qa-model');
}

// ══ 3. Error taxonomy + bounded retries ══════════════════════════════════════
await env(BASE, async () => {
  let calls = 0;
  __setLLMTestFetch(async () => { calls++; return errResponse(401); });
  const r = await callOpenAI(PAYLOAD);
  check('3.1 auth error fails, mapped 502', r.ok === false && r.code === 'auth' && r.status === 502);
  check('3.2 auth error NEVER retried (no repeated paid attempts)', calls === 1, `calls: ${calls}`);
});
await env(BASE, async () => {
  let calls = 0;
  __setLLMTestFetch(async () => { calls++; return errResponse(429); });
  const r = await callOpenAI(PAYLOAD);
  check('3.3 rate limit retried EXACTLY once then fails', r.ok === false && r.code === 'rate_limit' && calls === 2, `calls: ${calls}`);
});
await env(BASE, async () => {
  let calls = 0;
  __setLLMTestFetch(async () => { calls++; return calls === 1 ? errResponse(500) : okResponse('recovered'); });
  const r = await callOpenAI(PAYLOAD);
  check('3.4 transient 500 recovers on the single retry', r.ok === true && r.text === 'recovered' && calls === 2);
});
await env(BASE, async () => {
  let calls = 0;
  __setLLMTestFetch(async () => { calls++; return errResponse(400, { message: 'unsupported parameter temperature' }); });
  const r = await callOpenAI(PAYLOAD);
  check('3.5 400 bad_request NOT retried', r.ok === false && r.code === 'bad_request' && calls === 1, `calls: ${calls} code: ${r.code}`);
});
await env(BASE, async () => {
  let calls = 0;
  __setLLMTestFetch(async () => { calls++; return errResponse(404, { message: 'model not found' }); });
  const r = await callOpenAI(PAYLOAD);
  check('3.6 unknown model → model_not_found, no retry', r.ok === false && r.code === 'model_not_found' && calls === 1);
});
await env(BASE, async () => {
  let calls = 0;
  __setLLMTestFetch(async () => { calls++; throw new TypeError('fetch failed: connection refused'); });
  const r = await callOpenAI(PAYLOAD);
  check('3.7 network failure retried once then network code', r.ok === false && r.code === 'network' && calls === 2, `calls: ${calls} code: ${r.code}`);
});
await env(BASE, async () => {
  __setLLMTestFetch(async () => okResponse(''));
  const r = await callOpenAI(PAYLOAD);
  check('3.8 EMPTY model reply fails closed (client → deterministic engine)', r.ok === false && r.code === 'empty_response');
});
await env(BASE, async () => {
  __setLLMTestFetch(async () => new Response('{{{not json', { status: 200, headers: { 'content-type': 'application/json' } }));
  const r = await callOpenAI(PAYLOAD);
  check('3.9 malformed body fails without throwing', r && r.ok === false, `got: ${JSON.stringify(r).slice(0, 120)}`);
});
await env({ ...BASE, OPENAI_API_KEY: undefined }, async () => {
  const r = await callOpenAI(PAYLOAD);
  check('3.10 missing key → 503 no_key (regex-fallback contract)', r.ok === false && r.status === 503 && r.code === 'no_key');
});

// ══ 4. Secret hygiene ════════════════════════════════════════════════════════
{
  check('4.1 sanitizeDetail strips key-shaped strings',
    sanitizeDetail('boom sk-proj-abcdefghijklmnop happened') === 'boom sk-*** happened');
  check('4.2 sanitizeDetail strips bearer tokens', !/secret-token/.test(sanitizeDetail('Bearer secret-token-12345 rejected')));
}
await env(BASE, async () => {
  __setLLMTestFetch(async () => errResponse(500, { message: 'internal: key sk-proj-LEAKTEST1234567890 invalid' }));
  const r = await callOpenAI(PAYLOAD);
  check('4.3 provider error detail never carries a key', r.ok === false && !/sk-proj-LEAKTEST/.test(r.detail || ''), `detail: ${r.detail}`);
});

// ══ 5. Config knobs ══════════════════════════════════════════════════════════
await env({ ...BASE, OPENAI_TEMPERATURE: '' }, async () => {
  let captured = null;
  __setLLMTestFetch(async (url, init) => { captured = JSON.parse(init.body); return okResponse('x'); });
  await callOpenAI(PAYLOAD);
  check('5.1 OPENAI_TEMPERATURE="" omits the parameter entirely', !('temperature' in captured), `temp: ${captured.temperature}`);
});
await env({ ...BASE, OPENAI_ENABLE_WEB_SEARCH: '1' }, async () => {
  let captured = null;
  __setLLMTestFetch(async (url, init) => { captured = JSON.parse(init.body); return okResponse('x'); });
  await callOpenAI({ ...PAYLOAD, webSearchAllowedDomains: ['medicare.gov', 'cms.gov'] });
  check('5.2 web search opt-in sends the tool with the domain allowlist',
    Array.isArray(captured.tools) && captured.tools[0].type === 'web_search'
    && captured.tools[0].filters && captured.tools[0].filters.allowed_domains.includes('medicare.gov'));
});
await env({ ...BASE, LLM_PROVIDER: 'anthropic' }, async () => {
  check('5.3 explicit LLM_PROVIDER=anthropic wins over the OpenAI key', selectLLMProvider() === 'anthropic');
});
await env({ ...BASE }, async () => {
  check('5.4 OpenAI key alone selects openai', selectLLMProvider() === 'openai');
});
await env({ ...BASE, OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, LLM_PROVIDER: undefined }, async () => {
  check('5.5 no keys → none (503 → deterministic fallback)', selectLLMProvider() === 'none');
});

__setLLMTestFetch(null);
console.log('');
if (fail.length === 0) {
  console.log(GRN(`OPENAI PROVIDER UNIT SUITE: ${pass}/${pass} assertions passed`));
} else {
  console.log(`OPENAI PROVIDER UNIT SUITE: ${pass}/${pass + fail.length} assertions passed`);
  console.log(RED(`\n✗ ${fail.length} FAILURES:`));
  for (const f of fail) console.log('  ' + f);
  process.exitCode = 1;
}

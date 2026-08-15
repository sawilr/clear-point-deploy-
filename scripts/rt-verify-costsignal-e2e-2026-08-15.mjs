// Independent red-team E2E probe — does the REAL /api/chat handler deliver a
// spelled-out Part B dollar amount when the caller asked only about Part D?
// Harness pattern per scripts/test-chat-wiring-2026-08-13.mjs (own re-write).
import handler from '../api/chat.js';
import { __setLLMTestFetch } from '../api/_lib/llm-provider.js';

process.env.OPENAI_API_KEY = 'sk-test-dummy-wiring-key-000';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.VERCEL_ENV;
delete process.env.CP_KILL_ALL;
delete process.env.CP_KILL_AI;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

let ipCounter = 0;
function makeReq(body) {
  ipCounter++;
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      'x-forwarded-for': `10.77.0.${ipCounter}`,
    },
    body,
    on() {},
  };
}
function makeRes() {
  return {
    statusCode: null, jsonBody: null, headers: {}, ended: false,
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.jsonBody = o; return this; },
    end() { this.ended = true; return this; },
  };
}
const okResponse = (text) => new Response(JSON.stringify({
  id: 'resp_rt', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

// Capture logs to read the audit record + any SCOPE_LEAK_PREVENTED warning.
const logs = [];
const ol = console.log, ow = console.warn, oe = console.error;
console.log = (...a) => { logs.push(a.join(' ')); };
console.warn = (...a) => { logs.push(a.join(' ')); };
console.error = (...a) => { logs.push(a.join(' ')); };

const LEAK = 'El deducible de la Parte D varía según su plan. La Parte B cuesta doscientos ochenta y tres dólares al mes.';
const CONTROL = 'El deducible de la Parte D varía según su plan. La Parte B cuesta $283 al mes.';

async function run(label, mockText) {
  let scopeNoteSeen = null;
  __setLLMTestFetch(async (url, init) => {
    const b = JSON.parse(init.body);
    const m = /SCOPE THIS TURN:[^\n]*/.exec(b.instructions || '');
    scopeNoteSeen = m ? m[0] : null;
    return okResponse(mockText);
  });
  const req = makeReq({
    userMessage: '¿Qué es la Parte D y cómo funciona el deducible de medicinas?',
    context: { language: 'es', zipCode: '11375', state: 'NY' },
    history: [],
  });
  const res = makeRes();
  await handler(req, res);
  const audit = logs.filter((l) => l.includes('scope_stripped')).pop() || '(no audit line)';
  const leakWarn = logs.filter((l) => l.includes('SCOPE_LEAK_PREVENTED')).pop() || '(none)';
  ol(`\n===== ${label} =====`);
  ol('mock model text : ' + JSON.stringify(mockText));
  ol('status          : ' + res.statusCode);
  ol('delivered       : ' + JSON.stringify(res.jsonBody && res.jsonBody.response));
  ol('scope note sent : ' + JSON.stringify(scopeNoteSeen));
  ol('leak warn       : ' + leakWarn);
  ol('audit line      : ' + audit.slice(0, 600));
  logs.length = 0;
}

try {
  await run('LEAK VARIANT (spelled-out dollars)', LEAK);
  await run('CONTROL ($283 — gate should strip)', CONTROL);
} finally {
  console.log = ol; console.warn = ow; console.error = oe;
}

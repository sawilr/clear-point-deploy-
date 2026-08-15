// Red-team refutation probe (handler half) — structure bypass claim.
// Drives the REAL api/chat.js default export with a mocked OpenAI transport.
import handler from '../api/chat.js';
import { __setLLMTestFetch } from '../api/_lib/llm-provider.js';

process.env.OPENAI_API_KEY = 'sk-test-dummy-rt-000';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_PROVIDER;
delete process.env.VERCEL_ENV;
delete process.env.CP_KILL_ALL;
delete process.env.CP_KILL_AI;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

function makeReq(body) {
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'content-type': 'application/json',
      'x-forwarded-for': '10.77.1.23',
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

const MODEL_REPLY =
  'El deducible de la Parte D varia segun el plan.\n\n' +
  '**Parte B:**\n' +
  '- Deducible anual: $283\n' +
  '- Prima mensual: $202.90\n\n' +
  '**Parte A:**\n' +
  '- Deducible por periodo de beneficio: $1,736';

const okResponse = (text) => new Response(JSON.stringify({
  id: 'resp_rt', object: 'response', status: 'completed', model: 'gpt-5.6-luna',
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

// Capture logs so we can inspect SCOPE_LEAK_PREVENTED / [AI-AUDIT]
const logs = [];
const ow = console.warn, ol = console.log;
console.warn = (...a) => { logs.push(a.join(' ')); };
console.log = (...a) => { logs.push(a.join(' ')); };

let outboundInstructions = null;
__setLLMTestFetch(async (url, init) => {
  outboundInstructions = JSON.parse(init.body).instructions || '';
  return okResponse(MODEL_REPLY);
});

const req = makeReq({
  userMessage: '¿Que es la Parte D y como funciona el deducible de medicinas?',
  context: { language: 'es', zipCode: '11375', state: 'NY' },
  history: [],
});
const res = makeRes();
await handler(req, res);

console.warn = ow; console.log = ol;

console.log('HTTP status:', res.statusCode);
console.log('reply byte-identical to model output:', res.jsonBody && res.jsonBody.response === MODEL_REPLY);
console.log('REPLY >>>');
console.log(res.jsonBody && res.jsonBody.response);
console.log('<<<');
console.log('scope note reached the model (SCOPE THIS TURN in instructions):',
  /SCOPE THIS TURN: the caller is asking about Part D ONLY/.test(outboundInstructions || ''));
const leakLog = logs.filter((l) => l.includes('SCOPE_LEAK_PREVENTED'));
console.log('SCOPE_LEAK_PREVENTED logged:', leakLog.length > 0, leakLog);
const audit = logs.filter((l) => l.includes('[AI-AUDIT]'));
console.log('AUDIT lines:');
for (const a of audit) console.log(a);

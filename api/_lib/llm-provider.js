// ─────────────────────────────────────────────────────────────────────────────
// LLM PROVIDER LAYER — OpenAI (Responses API) + provider selection.
// 2026-08-13 — OpenAI production integration (mission: CLARA OPENAI PRODUCTION).
//
// WHAT THIS MODULE IS. The single place that knows how to talk to OpenAI:
// client construction, model routing, timeout, bounded retry, error taxonomy,
// response extraction, usage metadata. It contains ZERO Clara business logic —
// the system prompt, guards, compliance filtering and tag parsing all stay in
// api/chat.js, provider-agnostic, exactly where they ran for Anthropic.
//
// WHAT IT IS NOT. It is not a fallback chain. A provider failure returns a
// typed error and api/chat.js maps it to the SAME contract the client already
// understands (503 → deterministic regex engine takes over; 502 → same). We
// NEVER silently invoke a second, more expensive model because the first
// failed — failures are explicit (mission §2, §12).
//
// SECRETS. The key is read from process.env.OPENAI_API_KEY at call time, is
// never logged, never echoed into error strings (sanitizeDetail strips
// anything key-shaped as defense in depth), and never leaves the server.
//
// MODEL ROUTING (mission §10):
//   OPENAI_MODEL_PRODUCTION  (default gpt-5.6-terra) — real caller traffic.
//   OPENAI_MODEL_QA          (default gpt-5.6-luna)  — QA / red team / preview.
//   Selection: VERCEL_ENV === 'production' → production model; anything else
//   (preview, development, bare node) → QA model. So an automated corpus run
//   against a preview deployment or local dev can never burn the production
//   model by accident. OPENAI_MODEL_OVERRIDE forces a specific model in any
//   environment (explicit opt-in, e.g. a one-off Terra smoke test on preview).
// ─────────────────────────────────────────────────────────────────────────────

import OpenAI from 'openai';

// ── Test seam ────────────────────────────────────────────────────────────────
// The offline suites inject a mock fetch so the FULL production handler
// (api/chat.js → this module → SDK → transport) can be exercised without a key
// and without network. Inert in production: the setter refuses when
// VERCEL_ENV === 'production', and nothing else ever assigns it.
let _testFetch = null;
export function __setLLMTestFetch(fn) {
  if (process.env.VERCEL_ENV === 'production') return false;
  _testFetch = fn || null;
  return true;
}

/** Which provider should serve /api/chat this request?
 *  Explicit LLM_PROVIDER wins; otherwise the presence of a key decides
 *  (OpenAI preferred when both are configured — it is the integration this
 *  deployment is being moved to); 'none' → 503 → client regex fallback. */
export function selectLLMProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase().trim();
  if (explicit === 'openai' || explicit === 'anthropic') return explicit;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

/** Resolve the model roles from env. Pure + exported for tests. */
export function resolveOpenAIModels(env = process.env) {
  // RED TEAM 2026-08-13 (P3) — trim BEFORE the || default. A whitespace-only
  // env value is truthy, so `(v || d).trim()` collapsed to '' and every request
  // sent model:"" → non-retrying 400 → silent full-endpoint outage.
  const production = (env.OPENAI_MODEL_PRODUCTION || '').trim() || 'gpt-5.6-terra';
  const qa = (env.OPENAI_MODEL_QA || '').trim() || 'gpt-5.6-luna';
  const override = (env.OPENAI_MODEL_OVERRIDE || '').trim();
  const isProd = env.VERCEL_ENV === 'production';
  const active = override || (isProd ? production : qa);
  const role = override ? 'override' : (isProd ? 'production' : 'qa');
  return { production, qa, active, role };
}

function _clampInt(raw, min, max, dflt) {
  const n = parseInt(raw, 10);
  if (!isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/** Defense in depth: no secret may ride inside an error detail we log.
 *  The SDK does not embed keys in messages, but this makes it structural. */
export function sanitizeDetail(msg) {
  return String(msg == null ? '' : msg)
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer ***')
    .slice(0, 300);
}

/** Extract assistant text from a Responses API result. `output_text` is the
 *  SDK convenience aggregate; the manual walk is the fallback for transports
 *  that return plain JSON without the getter. */
function _extractText(resp) {
  if (resp && typeof resp.output_text === 'string' && resp.output_text.trim()) {
    return resp.output_text.trim();
  }
  let text = '';
  const out = resp && Array.isArray(resp.output) ? resp.output : [];
  for (const item of out) {
    if (item && item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part && part.type === 'output_text' && typeof part.text === 'string') text += part.text;
      }
    }
  }
  return text.trim();
}

/** Best-effort provenance for the [AI-AUDIT] record when web search is on:
 *  hostnames only — never page content, never PII. */
function _extractSearchMeta(resp) {
  let used = false;
  const domains = [];
  const out = resp && Array.isArray(resp.output) ? resp.output : [];
  for (const item of out) {
    if (item && item.type === 'web_search_call') used = true;
    if (item && item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        const anns = part && Array.isArray(part.annotations) ? part.annotations : [];
        for (const a of anns) {
          if (a && a.type === 'url_citation' && a.url) {
            used = true;
            try {
              const host = new URL(a.url).hostname.replace(/^www\./, '');
              if (domains.indexOf(host) === -1) domains.push(host);
            } catch (e) { /* unparseable url — skip */ }
          }
        }
      }
    }
  }
  return { used, domains };
}

/**
 * Call OpenAI's Responses API with Clara's already-built, already-scrubbed
 * payload. All guards (emergency, clinical, injection, PHI scrub, history
 * screening) have run in api/chat.js BEFORE this — this function must never
 * be reachable with raw user input.
 *
 * Returns:
 *   { ok:true, text, provider:'openai', model, modelRole, requestId,
 *     usage, latencyMs, searchUsed, searchDomains }
 *   { ok:false, status: 502|503, code, httpStatus, model, detail }
 *
 * RETRY POLICY (mission §11/§13): SDK retries are DISABLED (maxRetries: 0);
 * this function makes at most ONE application-level retry, only for
 * genuinely retryable statuses (429 / 5xx / network), and only when the
 * first failure was fast (<2.5s) — the browser client aborts at 12s, so a
 * retry after a slow timeout would answer a caller who already gave up.
 * Auth/config errors (401/403/404-model/400) never retry: repeated paid
 * attempts against a misconfiguration are exactly what §13 prohibits.
 */
export async function callOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, status: 503, code: 'no_key', httpStatus: null, model: null, detail: 'OPENAI_API_KEY not configured' };

  const models = resolveOpenAIModels();
  // Default 10.5s: LIVE EVIDENCE (scenario D t7) — a long-history Luna turn
  // exceeded 9s and 502'd; the browser client aborts at 12s, so 10.5s keeps a
  // margin under the client while absorbing the reasoning-model tail.
  const timeoutMs = _clampInt(process.env.OPENAI_TIMEOUT_MS, 1000, 30000, 10500);

  const client = new OpenAI({
    apiKey,
    maxRetries: 0,           // bounded retries are OURS, below — never the SDK's on top
    timeout: timeoutMs,
    ...(_testFetch ? { fetch: _testFetch } : {}),
  });

  const instructions = payload.contextSummary
    ? payload.systemPrompt + '\n\n' + payload.contextSummary
    : payload.systemPrompt;
  const input = (payload.messages || []).map((m) => ({ role: m.role, content: m.content }));

  const req = {
    model: models.active,
    instructions,
    input,
    max_output_tokens: payload.maxOutputTokens || 1024,
  };
  // Temperature is OPT-IN, not default. LIVE EVIDENCE (2026-08-13, first real
  // call): gpt-5.6-luna returns 400 "Unsupported parameter: 'temperature'" —
  // the target models are reasoning-class and reject it, so a 0.2 default
  // (Anthropic parity) would 400 EVERY production call. Set OPENAI_TEMPERATURE
  // to a number only for models that accept it; determinism for compliance
  // comes from the deterministic post-filters either way.
  const tempRaw = process.env.OPENAI_TEMPERATURE;
  if (tempRaw != null && tempRaw !== '') {
    const t = parseFloat(tempRaw);
    if (isFinite(t)) req.temperature = t;
  }
  // Web search — OFF by default. The Anthropic path domain-locks search to
  // official government/state sites; until the equivalent filter contract is
  // verified against the live OpenAI API (live gate), enabling search here
  // would risk a compliance regression (arbitrary marketing pages entering a
  // Medicare answer). The KB in the system prompt is the primary source and
  // the prompt already tells the model to answer from it when search is
  // unavailable — the documented graceful degradation.
  if (process.env.OPENAI_ENABLE_WEB_SEARCH === '1') {
    req.tools = [{
      type: 'web_search',
      filters: { allowed_domains: payload.webSearchAllowedDomains || [] },
    }];
  }

  const started = Date.now();
  let attempt = 0;
  // Finite by construction: at most 2 iterations (attempt 1 + one retry).
  while (true) {
    attempt++;
    try {
      const resp = await client.responses.create(req);
      const text = _extractText(resp);
      if (!text) {
        // An empty model reply must fail closed — the client then uses the
        // deterministic engine instead of rendering an empty bubble.
        return { ok: false, status: 502, code: 'empty_response', httpStatus: 200, model: models.active, detail: 'model returned no output_text' };
      }
      const search = _extractSearchMeta(resp);
      return {
        ok: true,
        text,
        provider: 'openai',
        model: models.active,
        modelRole: models.role,
        requestId: (resp && (resp._request_id || resp.id)) || null,
        usage: (resp && resp.usage) || null,
        latencyMs: Date.now() - started,
        searchUsed: search.used,
        searchDomains: search.domains,
      };
    } catch (e) {
      const httpStatus = e && typeof e.status === 'number' ? e.status : null;
      const isTimeout = !!(e && (e.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(String(e.message || ''))));
      const isAuth = httpStatus === 401 || httpStatus === 403;
      const retryable = !isAuth && (httpStatus === 429 || (httpStatus != null && httpStatus >= 500) || (httpStatus == null && !isTimeout));
      if (retryable && attempt === 1 && (Date.now() - started) < 2500) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      const code = isAuth ? 'auth'
        : httpStatus === 429 ? 'rate_limit'
        : httpStatus === 404 ? 'model_not_found'
        : httpStatus === 400 ? 'bad_request'
        : isTimeout ? 'timeout'
        : httpStatus != null ? 'api_error'
        : 'network';
      return {
        ok: false,
        status: 502,
        code,
        httpStatus,
        model: models.active,
        detail: sanitizeDetail(e && e.message),
      };
    }
  }
}

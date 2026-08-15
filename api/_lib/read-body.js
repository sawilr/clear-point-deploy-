// api/_lib/read-body.js — shared JSON body reader for Vercel serverless endpoints.
//
// LIVE FINDING 2026-08-15 (security remediation, error-handling target): a POST
// to /api/submit-lead with a MALFORMED JSON body never answered — curl observed
// HTTP 000 after a 15s client timeout instead of a fast 400. Cause: the platform
// parses JSON bodies eagerly, so touching `req.body` on bad JSON THROWS — and by
// that point the request stream is already consumed. The old inline fallback
// then re-read `req` and waited for an 'end' event that can never fire again,
// hanging the invocation until the platform killed it. The same pattern existed
// in chat.js, sign-soa.js, soa-token.js and lookup-client.js; all now share
// this reader.
//
// Contract:
//   const body = await readJsonBody(req, res, { maxBytes });
//   → parsed object on success
//   → null when a response was ALREADY sent (400/413) — the caller must `return`.
//
// Fail posture: reject fast, never hang. The streaming path carries a hard
// timeout so a stalled or trickling request can never pin the invocation.

export async function readJsonBody(req, res, opts) {
  var MAX = (opts && opts.maxBytes) || 64 * 1024;
  var READ_TIMEOUT_MS = (opts && opts.timeoutMs) || 10000;

  var parsed;
  try {
    parsed = req.body;
  } catch (_malformed) {
    // Platform parser threw: the body was malformed JSON and the stream is
    // already consumed. Answer immediately — re-reading would hang forever.
    res.status(400).json({ error: 'Invalid JSON body' });
    return null;
  }

  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed === 'string') {
      // Some runtimes hand the raw string through unparsed.
      if (parsed.length > MAX) {
        res.status(413).json({ error: 'Payload too large' });
        return null;
      }
      try {
        return parsed.trim() ? JSON.parse(parsed) : {};
      } catch (_bad) {
        res.status(400).json({ error: 'Invalid JSON body' });
        return null;
      }
    }
    if (typeof parsed === 'object') return parsed;
    return {};
  }

  // No platform parser ran (bare Node dev harness, or a bodyless request). If
  // the stream already finished there is nothing left to read — empty body.
  if (req.readableEnded || req.complete) return {};

  try {
    return await new Promise(function (resolve, reject) {
      var chunks = [];
      var total = 0;
      var settled = false;
      function fail(code) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { req.destroy(); } catch (_e) { /* already closed */ }
        reject(new Error(code));
      }
      // Hard cap — a stalled/looping stream must never hang the invocation.
      var timer = setTimeout(function () { fail('body_read_timeout'); }, READ_TIMEOUT_MS);
      req.on('data', function (c) {
        total += c.length;
        if (total > MAX) { fail('body_too_large'); return; }
        chunks.push(c);
      });
      req.on('end', function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          var raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw && raw.trim() ? JSON.parse(raw) : {});
        } catch (_e) {
          reject(new Error('invalid_json'));
        }
      });
      req.on('error', function () { fail('body_unreadable'); });
    });
  } catch (e) {
    var code = e && e.message;
    if (code === 'body_too_large') {
      res.status(413).json({ error: 'Payload too large' });
      return null;
    }
    res.status(400).json({ error: code === 'invalid_json' ? 'Invalid JSON body' : 'Cannot read request body' });
    return null;
  }
}

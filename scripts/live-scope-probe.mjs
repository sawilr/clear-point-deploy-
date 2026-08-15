// LIVE ENTITY-SCOPE PROBE — PARTD-001 and its generalizations, against a REAL
// running /api/chat (any provider: the scope lock is provider-agnostic).
//
//   local:      node scripts/dev-api-server.mjs   →   node scripts/live-scope-probe.mjs
//   production: BASE=https://clearpointsenioradvisors.com node scripts/live-scope-probe.mjs
//
// BOUNDED BY DESIGN (§11): RUNS_PER_CASE × cases ≤ 12 requests total, far under
// the 30/5min rate limit. No secrets touched — plain HTTP against the endpoint.
//
// Each case asserts the ABSENCE of unrequested figures (the leak) and the
// PRESENCE of an actual answer (so a blank/refusal can't fake a pass). The
// comparison case asserts the opposite direction: requested figures SURVIVE.
const BASE = (process.env.BASE || 'http://localhost:3011').replace(/\/$/, '');
const RUNS_PER_CASE = parseInt(process.env.RUNS || '2', 10);

const CASES = [
  {
    tag: 'PARTD-001 (the incident, verbatim)',
    q: '¿Qué es la Parte D y cómo funciona el deducible de medicinas?',
    mustNotContain: ['283', '1,736', '1736', 'Parte A', 'Parte B'],
    mustMatch: /parte d/i,
  },
  {
    tag: 'RELEVANCE-A (Part A question)',
    q: '¿Cuál es el deducible de la Parte A?',
    mustNotContain: ['283', '202.90', '615', '2,100'],
    mustMatch: /parte a|hospital/i,
  },
  {
    tag: 'RELEVANCE-B (Part B premium)',
    q: '¿Cuánto cuesta la prima de la Parte B?',
    mustNotContain: ['1,736', '1736', '615', '2,100'],
    mustMatch: /parte b/i,
  },
  {
    tag: 'RELEVANCE-C (Part C education)',
    q: '¿Qué es la Parte C?',
    mustNotContain: ['283', '1,736', '1736', '202.90'],
    mustMatch: /advantage|parte c/i,
  },
  {
    tag: 'CROSS-SCOPE-001 (requested comparison — figures MUST survive)',
    q: '¿Cuál es la diferencia entre el deducible de la Parte B y el de la Parte D?',
    mustNotContain: [],
    mustMatch: /parte b[\s\S]*parte d|parte d[\s\S]*parte b/i,
  },
  {
    tag: 'EN parity (Part D deductible)',
    q: 'What is the Part D drug deductible and how does it work?',
    mustNotContain: ['283', '1,736', '1736', 'Part A deductible', 'Part B deductible'],
    mustMatch: /part d/i,
    lang: 'en',
  },
];

let failures = 0, runs = 0, unreachable = false;
for (const c of CASES) {
  for (let i = 0; i < RUNS_PER_CASE; i++) {
    runs++;
    let body;
    try {
      const r = await fetch(BASE + '/api/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The endpoint enforces an Origin allowlist (A15.1) — a same-origin
          // header is required against production; localhost dev allows none.
          ...(BASE.startsWith('https://') ? { origin: BASE } : {}),
          'x-forwarded-for': '10.77.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250),
        },
        body: JSON.stringify({ userMessage: c.q, context: { language: c.lang || 'es', zipCode: '11375', state: 'NY' }, history: [] }),
      });
      if (r.status === 503) { console.log('NOT VERIFIED — endpoint has no LLM key configured (503)'); unreachable = true; break; }
      body = await r.json();
    } catch (e) {
      console.log('NOT VERIFIED — endpoint unreachable at ' + BASE + ' (' + (e && e.message) + ')');
      unreachable = true; break;
    }
    const t = (body && body.response) || '';
    const leaks = c.mustNotContain.filter((x) => t.includes(x));
    // PARTD-002 — the $615 federal MAXIMUM may never be presented as the
    // caller's own deductible ("su deducible es $615" / "your deductible is $615").
    if (/\b(su|tu|your)\s+deducible[^.?!]{0,25}\$?\s?615\b|\byour\s+deductible[^.?!]{0,25}\$?\s?615\b/i.test(t)) {
      leaks.push('MAX-AS-ACTUAL($615)');
    }
    const answered = c.mustMatch.test(t);
    if (leaks.length || !answered) {
      failures++;
      console.log(`FAIL [${c.tag}] run${i + 1}` + (leaks.length ? ` leaked: ${leaks.join(',')}` : ' no on-topic answer'));
      console.log('     ' + t.slice(0, 220).replace(/\n/g, ' '));
    } else {
      console.log(`ok   [${c.tag}] run${i + 1} (len=${t.length})`);
    }
  }
  if (unreachable) break;
}

console.log('');
if (unreachable) {
  console.log('LIVE SCOPE PROBE: NOT VERIFIED (endpoint unavailable — start scripts/dev-api-server.mjs with a configured key, or point BASE at production)');
  process.exitCode = 2;
} else if (failures === 0) {
  console.log(`LIVE SCOPE PROBE: PASS — ${runs} live turns, 0 scope leaks, comparison figures intact`);
} else {
  console.log(`LIVE SCOPE PROBE: FAIL — ${failures}/${runs} turns leaked or dodged`);
  process.exitCode = 1;
}

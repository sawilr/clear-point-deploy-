/* eslint-disable no-console */
// AUDIT 2026-07-22 — LIVE LLM QA for the Clara comprehension fix (Sección 14).
// Drives the REAL /api/chat with the exact failing conversation as one
// continuous thread (T1→T7) plus the Medigap-recovery probe (T8).
//
// Run:  node scripts/clara-comprehension-llm-qa.mjs [BASE_URL] [COOKIE]
//   BASE_URL default: https://clearpointsenioradvisors.com
//   COOKIE: optional Cookie header (Vercel preview protection)
const BASE = process.argv[2] || 'https://clearpointsenioradvisors.com';
const COOKIE = process.argv[3] || '';
const ORIGIN = 'https://clearpointsenioradvisors.com';
const URL = BASE.replace(/\/$/, '') + '/api/chat';

let PASS = 0, FAIL = 0; const fails = [];
const ok = (id, c, x = '') => { if (c) PASS++; else { FAIL++; fails.push(id); } console.log(`${c ? '✅' : '❌'} ${id}${c ? '' : `  :: ${x.slice(0, 140)}`}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const history = [];
async function turn(msg, ctxPatch = {}) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(COOKIE ? { Cookie: COOKIE } : {}) },
    body: JSON.stringify({
      userMessage: msg,
      history: [...history],
      context: { language: 'es', zipCode: '10033', state: 'NY', ...ctxPatch },
    }),
  });
  const j = await res.json().catch(() => ({}));
  const r = j.response || `HTTP ${res.status}: ${JSON.stringify(j).slice(0, 200)}`;
  history.push({ role: 'user', content: msg }, { role: 'assistant', content: r });
  console.log(`\n👤 ${msg}\n🤖 ${r.replace(/\n+/g, ' ').slice(0, 300)}`);
  await sleep(1200); // pace under the 30/5min rate limit
  return r;
}

const NO_INVENT = (r) => !/casi siempre|seguramente es porque|probablemente es porque|almost always/i.test(r);
const NO_SEP_CLAIM = (r) => !/(tiene|tendr[ií]a|podr[ií]a tener) derecho a un per[ií]odo especial|sin esperar a octubre|without waiting (for|until) october|you (have|likely have|probably have) a special enrollment/i.test(r);
const NO_MEDIGAP_ASSUME = (r) => !/su (plan )?medigap|de un plan medigap|your medigap/i.test(r);
const ONE_Q = (r) => (r.match(/\?/g) || []).length <= 1;

(async () => {
  console.log(`Target: ${URL}\n`);

  // T1 — multiple issues in one message (the live failure)
  {
    const r = await turn('Tengo problemas con mi doctor me dice que cambie de plan y tengo condiciones preexistentes');
    ok('T1 no re-ask "qué pasó con su doctor"', !/qu[eé] pas[oó] con su doctor/i.test(r), r);
    ok('T1 acknowledges plan-change recommendation', /cambiar de plan|cambio de plan|le recomend/i.test(r), r);
    ok('T1 acknowledges pre-existing conditions', /condiciones (preexistentes|pre-existentes)|preexistente/i.test(r), r);
    ok('T1 no invented cause', NO_INVENT(r), r);
    ok('T1 no Medigap assumption', NO_MEDIGAP_ASSUME(r), r);
    ok('T1 no MA-as-fact assumption', !/su plan (medicare )?advantage/i.test(r), r);
    ok('T1 no SEP claim', NO_SEP_CLAIM(r), r);
    ok('T1 asks about the doctor\'s reason', /por qu[eé]|raz[oó]n|motivo|explic/i.test(r), r);
    ok('T1 max one question', ONE_Q(r), r);
  }

  // T2 — user pushes back that they already said it
  {
    const r = await turn('Ya te dije que me dijo que cambie');
    ok('T2 no "qué pasó" re-ask', !/qu[eé] pas[oó] con su doctor/i.test(r), r);
    ok('T2 moves to motive / coverage / next step (no restart)', /por qu[eé]|motivo|raz[oó]n|cobertura|advantage|original|verificar/i.test(r), r);
    ok('T2 no invented cause', NO_INVENT(r), r);
    ok('T2 no SEP claim', NO_SEP_CLAIM(r), r);
  }

  // T3 — shorthand "MA" (coverage type)
  {
    const r = await turn('MA');
    ok('T3 interprets Medicare Advantage (no reset/confusion)', /advantage/i.test(r) && !/no (le )?entend[ií]|no entiendo su mensaje|en qu[eé] le puedo ayudar hoy\?$/i.test(r), r);
    ok('T3 no automatic SEP claim', NO_SEP_CLAIM(r), r);
    ok('T3 no acceptance promise', !/(ser[aá]|est[aá]) aceptado|garantiz|guarantee/i.test(r), r);
  }

  // T4 — doctor will stop accepting the plan
  {
    const r = await turn('Dijo que dejará de aceptar mi plan');
    ok('T4 verify-first (office/plan/date/scope/confirm)', /confirmar|verificar|consultorio|oficina|fecha|desde cu[aá]ndo|todos sus pacientes|ciertos servicios|when .*stop|all (your |of your )?patients|certain services/i.test(r), r);
    ok('T4 no SEP guarantee', NO_SEP_CLAIM(r), r);
    ok('T4 no immediate-enrollment push', !/inscribir(se|lo) (ya|ahora|hoy)|enroll (now|today)|cambie (ya|ahora|hoy) mismo/i.test(r), r);
  }

  // T5 — can I change now?
  {
    const r = await turn('¿Puedo cambiar ahora?');
    ok('T5 says it depends on the enrollment period', /per[ií]odo|periodo|inscripci[oó]n|depende/i.test(r), r);
    ok('T5 does not say plain yes', !/^s[ií]\b|s[ií], puede cambiar|claro que puede/i.test(r), r);
    ok('T5 no "sin esperar a octubre" and no "debe esperar a octubre"', NO_SEP_CLAIM(r) && !/(debe|tiene que|tendr[aá] que) esperar (a|hasta) octubre/i.test(r), r);
    ok('T5 routes to verification/advisor', /asesor|verificar|revisar/i.test(r), r);
  }

  // T6 — health conditions named
  {
    const r = await turn('Tengo diabetes y problemas del corazón');
    ok('T6 no clinical-detail interrogation', !/qu[eé] medicamentos toma|desde cu[aá]ndo (tiene|padece)|d[eé]me m[aá]s detalles (m[eé]dicos|de su(s)? condici)/i.test(r), r);
    ok('T6 reassures re MA + pre-existing (no denial scare)', /no (le )?impiden|no impide|normalmente no|pueden inscribirse|no le excluye/i.test(r) || /continuidad|m[eé]dicos|medicamentos|tratamientos/i.test(r), r);
    ok('T6 no acceptance guarantee', !/garantiz|le aseguro que|definitivamente calific/i.test(r), r);
  }

  // T7 — bills added on top (multi-issue continuity)
  {
    const r = await turn('También me están llegando facturas');
    ok('T7 acknowledges the bill without dropping the doctor topic', /factur/i.test(r), r);
    ok('T7 no SSN/MBI/card/photo request', !/n[uú]mero de (seguro social|medicare)|\bSSN\b|\bMBI\b|tarjeta bancaria|foto de/i.test(r), r);
    ok('T7 max one question', ONE_Q(r), r);
    ok('T7 no payment order ("no pague"/"pague ya")', !/\bno (la )?pague\b|p[aá]guela (ya|ahora)/i.test(r), r);
  }

  // T8 — Medigap recovery (fresh mini-thread with a seeded wrong assumption)
  {
    history.length = 0;
    history.push(
      { role: 'user', content: 'mi doctor me dijo que cambie de plan' },
      { role: 'assistant', content: 'Entiendo. Eso no significa que usted tenga que cambiar de un plan Medigap a ciegas. ¿Le explicó por qué?' },
    );
    const r = await turn('¿Quién habló de Medigap? Yo nunca dije eso');
    ok('T8 admits the assumption / apologizes', /disculp|perd[oó]n|no deb[ií] asumir|asum[ií]/i.test(r), r);
    ok('T8 does not open with "Perfecto"', !/^\s*¡?perfecto/i.test(r), r);
    ok('T8 asks coverage type', /advantage|original|cobertura|tipo de plan/i.test(r), r);
    ok('T8 does not defend or re-use Medigap as caller\'s plan', !/como le dec[ií]a|su medigap|usted tiene medigap/i.test(r), r);
  }

  console.log(`\n═══════════════\nTOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS: ' + fails.join(' | '));
  process.exit(FAIL ? 1 : 0);
})();

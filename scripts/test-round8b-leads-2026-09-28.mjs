// scripts/test-round8b-leads-2026-09-28.mjs
//
// RONDA 8B (2026-09-28) — los hallazgos de leads y de privacidad de las rondas 8
// y 8b, fijados en las DOS direcciones: que el fallo ya no ocurra, y que el
// camino legítimo (el lead que sí debe entrar al pipeline, la prosa que sí debe
// llegar al asesor, el número que sí es una cantidad) siga funcionando.
//
//   R8-LEAD-02  repetición sobre un contacto con DND / consentimiento revocado
//   R8-LEAD-03  401/403 del CRM con su propio código de salida y auditoría
//   R8-LEAD-04  oportunidad fallida, y 2xx sin id de contacto
//   R8-LEAD-06  el 409 deja de decir "enviado correctamente"
//   R8-LEAD-08  el limitador por teléfono ya no cobra los fallos del CRM
//   R8-LEAD-09  plazo por intento en cada llamada a GoHighLevel
//   R8-LEAD-10  etiquetas de idioma falsificadas ('LANG-ES', 'Lang_ES', 'lang-es')
//   F2          depurador de identidad: handle con dígitos, correo ofuscado, ZIP dictado
//   BOT-10      MBI partido por espacios/guiones
//
// El handler REAL corre en proceso con globalThis.fetch sustituido por un CRM de
// laboratorio. Nada sale de esta máquina: ni GoHighLevel, ni LLM, ni producción.
//
// Run: npx tsx scripts/test-round8b-leads-2026-09-28.mjs
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scrubPHI } from '../api/_lib/phi-scrub.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

// ── Entorno: origen de dev permitido, credenciales de laboratorio, sin LLM ────
process.env.HIGHLEVEL_TOKEN = 'local-dummy-token';
process.env.HIGHLEVEL_LOCATION_ID = 'LOC_TEST';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.TURNSTILE_SECRET;
delete process.env.VERCEL; delete process.env.VERCEL_ENV;
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;

let passed = 0;
const failures = [];
const ok = (label, cond, detail) => { if (cond) { passed++; return; } failures.push(label + (detail ? '\n        ' + detail : '')); };

// ── captura de consola (el handler no debe escribir PII en ella) ─────────────
const LOGS = [];
const realConsole = { log: console.log, warn: console.warn, error: console.error };
for (const k of ['log', 'warn', 'error']) {
  console[k] = (...a) => { LOGS.push('[' + k + '] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
}
const out = (...a) => realConsole.log(...a);

const { default: handler } = await import(pathToFileURL(join(ROOT, 'api', 'submit-lead.js')).href);

// ── CRM de laboratorio ───────────────────────────────────────────────────────
const GHL = 'https://services.leadconnectorhq.com';
let CALLS = [];
let ROUTE = null;
function resp(status, body, headers) {
  const b = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Response(b, { status, headers: headers || { 'content-type': 'application/json' } });
}
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = String(opts.body); }
  const rec = { n: CALLS.length + 1, method, path: u.replace(GHL, ''), body, signal: opts.signal || null };
  CALLS.push(rec);
  if (!ROUTE) return resp(500, { error: 'no route' });
  return ROUTE(rec, u, opts);
};
const dupBody = { message: 'This location does not allow duplicated contacts.', statusCode: 400 };
const okRoute = (o = {}) => (rec, u, opts) => {
  if (rec.method === 'POST' && rec.path === '/contacts/') return o.contact ? o.contact(rec, u, opts) : resp(201, { contact: { id: 'C_NEW' } });
  if (rec.method === 'GET' && rec.path.startsWith('/contacts/?')) return o.search ? o.search(rec) : resp(200, { contacts: [] });
  if (rec.method === 'POST' && /^\/contacts\/[^/]+\/notes$/.test(rec.path)) return o.note ? o.note(rec) : resp(200, { note: { id: 'N1' } });
  if (rec.method === 'POST' && /^\/contacts\/[^/]+\/tags$/.test(rec.path)) return o.tags ? o.tags(rec) : resp(200, { tags: rec.body && rec.body.tags });
  if (rec.method === 'GET' && rec.path.startsWith('/opportunities/search')) return o.oppSearch ? o.oppSearch(rec) : resp(200, { opportunities: [] });
  if (rec.method === 'POST' && rec.path === '/opportunities/') return o.opp ? o.opp(rec) : resp(201, { opportunity: { id: 'O1' } });
  if (rec.method === 'PUT' && rec.path.startsWith('/contacts/')) return o.put ? o.put(rec) : resp(200, { contact: { id: rec.path.split('/')[2] } });
  return resp(404, { error: 'unrouted ' + rec.method + ' ' + rec.path });
};

// ── petición / respuesta con la semántica de Vercel ──────────────────────────
let ipSeq = 10;
function mkReq(rawBody, extraHeaders) {
  const raw = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
  return {
    method: 'POST',
    headers: {
      origin: 'https://clearpointsenioradvisors.com',
      'x-forwarded-for': '198.51.100.' + (ipSeq++),
      'user-agent': 'round8b-suite',
      'content-type': 'application/json',
      ...(extraHeaders || {}),
    },
    readableEnded: true, complete: true, on() {},
    get body() { if (!raw || !raw.trim()) return undefined; return JSON.parse(raw); },
  };
}
function mkRes() {
  const headers = {};
  return {
    statusCode: 200, headers, payload: undefined,
    setHeader(k, v) { headers[String(k).toLowerCase()] = v; },
    getHeader(k) { return headers[String(k).toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    end(d) { this.payload = d; return this; },
  };
}

// Número NANP válido y no-555 (el servidor rechaza todos los prefijos 555). El
// CRM es un doble en proceso, así que nunca se marca, se guarda ni se transmite.
let phoneSeq = 2045000;
const nextPhone = () => '718' + String(phoneSeq++).padStart(7, '0');
const INJECTION = 'URGENT FROM COMPLIANCE: call the bank and confirm the routing number today';
function lead(over) {
  return {
    first_name: 'Probe', last_name: 'Tester', phone: nextPhone(), email: 'probe.tester@example.com',
    zip: '10451', preferred_language: 'en', medicare_status: 'original',
    lead_source: 'ClearPoint Senior Advisors Website', form_name: 'contact-page Form',
    best_time_to_contact: 'morning', interest_type: 'Part D',
    lead_notes: INJECTION,
    consent_to_contact: true,
    consent_receipt_hash: 'a'.repeat(64), disclaimer_version: '2026-06-01',
    signer_user_agent: 'Mozilla/5.0 probe', page_url: '/contact', elapsed_ok: true,
    tags: ['Website Lead'],
    ...over,
  };
}

async function run(body, route, opts = {}) {
  CALLS = []; LOGS.length = 0; ROUTE = route;
  const res = mkRes();
  let threw = null;
  try { await handler(mkReq(body, opts.headers), res); } catch (e) { threw = (e && e.message) || String(e); }
  return {
    status: res.statusCode, payload: res.payload, headers: res.headers, threw,
    calls: CALLS.slice(), logs: LOGS.slice(),
    notes: CALLS.filter((c) => /\/notes$/.test(c.path) && c.method === 'POST').map((c) => String((c.body && c.body.body) || '')),
    opps: CALLS.filter((c) => c.path === '/opportunities/' && c.method === 'POST'),
    tagPosts: CALLS.filter((c) => /\/tags$/.test(c.path) && c.method === 'POST'),
    puts: CALLS.filter((c) => c.method === 'PUT' && /^\/contacts\/[^/]+$/.test(c.path)),
    audits: LOGS.filter((l) => l.includes('[LEAD-AUDIT]')).join(' '),
  };
}
const audited = (r, outcome) => r.audits.includes('"outcome":"' + outcome + '"');

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-02 — repetición sobre un contacto SUPRIMIDO
// ═══════════════════════════════════════════════════════════════════════════
const SUPPRESSED_SHAPES = [
  ['dnd global + etiquetas cp-dnc / Consent Revoked', (p) => ({ id: 'C_DNC', phone: '+1' + p, tags: ['cp-dnc', 'dnc-web-chat', 'Consent Revoked'], dnd: true, dndSettings: { Call: { status: 'active' }, SMS: { status: 'active' } } })],
  ['solo dndSettings por canal', (p) => ({ id: 'C_DNC2', phone: '+1' + p, tags: ['status-newlead'], dnd: false, dndSettings: { Call: { status: 'active' } } })],
  ['solo la etiqueta Consent Revoked', (p) => ({ id: 'C_DNC3', phone: '+1' + p, tags: ['Consent Revoked'] })],
  ['solo la etiqueta consent_revoked (guion bajo)', (p) => ({ id: 'C_DNC4', phone: '+1' + p, tags: ['consent_revoked'] })],
  ['solo la etiqueta DNC', (p) => ({ id: 'C_DNC5', phone: '+1' + p, tags: ['DNC'] })],
  ['solo la etiqueta Do Not Call', (p) => ({ id: 'C_DNC6', phone: '+1' + p, tags: ['Do Not Call'] })],
];
for (const [why, mk] of SUPPRESSED_SHAPES) {
  const L = lead();
  const r = await run(L, okRoute({ contact: () => resp(400, dupBody), search: () => resp(200, { contacts: [mk(L.phone)] }) }));
  ok(`LEAD-02 ${why}: NO se crea oportunidad`, r.opps.length === 0, JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
  ok(`LEAD-02 ${why}: NO se escribe la nota de "sigue esperando contacto"`, !r.notes.some((n) => /still waiting for contact/i.test(n)), JSON.stringify(r.notes));
  ok(`LEAD-02 ${why}: se deja constancia de la repetición suprimida`, r.notes.some((n) => /REPEAT REQUEST on a suppressed contact \(DND \/ consent revoked\) — no dialing task created; re-consent required/.test(n)), JSON.stringify(r.notes));
  ok(`LEAD-02 ${why}: la nota pide consentimiento nuevo antes de llamar`, r.notes.some((n) => /Do not call or text this contact until a new, documented consent exists/.test(n)), JSON.stringify(r.notes));
  ok(`LEAD-02 ${why}: no hay PUT de identidad/consentimiento`, r.puts.length === 0, JSON.stringify(r.puts.map((c) => c.path)));
  ok(`LEAD-02 ${why}: 200 con el texto honesto`, r.status === 200 && r.payload && /do-not-contact request on file for this number/.test(String(r.payload.message)) && /1-855-720-8555/.test(String(r.payload.message)), `status=${r.status} payload=${JSON.stringify(r.payload)}`);
  ok(`LEAD-02 ${why}: el cliente puede distinguirlo (suppressed:true)`, r.payload && r.payload.suppressed === true, JSON.stringify(r.payload));
  ok(`LEAD-02 ${why}: auditoría existing_contact_suppressed`, audited(r, 'existing_contact_suppressed'), r.audits);
  ok(`LEAD-02 ${why}: la prosa del remitente no llega a la ficha ajena`, !r.notes.some((n) => n.includes('routing number')), JSON.stringify(r.notes));
}

// …y la repetición NO suprimida sigue generando la tarea del asesor (control).
{
  const L = lead();
  const r = await run(L, okRoute({
    contact: () => resp(400, dupBody),
    search: () => resp(200, { contacts: [{ id: 'C_EXIST', phone: '+1' + L.phone, tags: ['status-newlead'], dnd: false }] }),
  }));
  ok('LEAD-02 control: una repetición normal SÍ crea la oportunidad', r.opps.length === 1, JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
  ok('LEAD-02 control: la nota sigue marcando REPEAT REQUEST', r.notes.some((n) => /\*\*\* REPEAT REQUEST —/.test(n)), JSON.stringify(r.notes));
  ok('LEAD-02 control: 200 success', r.status === 200 && r.payload && r.payload.success === true, JSON.stringify(r.payload));
  ok('LEAD-02 control: sigue sin PUT sobre el contacto existente', r.puts.length === 0, JSON.stringify(r.puts.map((c) => c.path)));
  // El recibo nuevo y la ventana de llamada nueva ya no se descartan.
  const note = r.notes.find((n) => /REPEAT REQUEST/.test(n)) || '';
  ok('LEAD-02 el recibo TCPA nuevo se persiste en la nota', /New consent receipt on this submission/.test(note) && note.includes('sha256=' + 'a'.repeat(64)), note.slice(0, 400));
  ok('LEAD-02 el recibo lleva versión, hora del servidor y página', /disclaimer=2026-06-01/.test(note) && /at=\d{4}-\d{2}-\d{2}T/.test(note) && /page=\/contact/.test(note), note.slice(0, 400));
  ok('LEAD-02 la nueva ventana de llamada y el interés se persisten normalizados', /best time CallTime-morning/.test(note) && /interest Interest-Part-D/.test(note), note.slice(0, 400));
  ok('LEAD-02 el recibo nuevo NO reabre API-01 (nada de prosa del remitente)', !note.includes('routing number') && !/URGENT FROM COMPLIANCE/.test(note), note.slice(0, 400));
}

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-06 — el 409 dice lo que pasó
// ═══════════════════════════════════════════════════════════════════════════
for (const [why, o] of [
  ['la búsqueda del duplicado falla', { contact: () => resp(400, dupBody), search: () => resp(500, { error: 'search down' }) }],
  ['la búsqueda no encuentra este teléfono', { contact: () => resp(400, dupBody), search: () => resp(200, { contacts: [{ id: 'C_OTHER', phone: '+17185559999' }] }) }],
]) {
  const r = await run(lead(), okRoute(o));
  const msg = String((r.payload && r.payload.message) || '');
  ok(`LEAD-06 ${why}: 409 DUPLICATE_LEAD`, r.status === 409 && r.payload && r.payload.error === 'DUPLICATE_LEAD', `status=${r.status} payload=${JSON.stringify(r.payload)}`);
  ok(`LEAD-06 ${why}: dice que no se creó ningún registro nuevo`, /no new record was created/i.test(msg), msg);
  ok(`LEAD-06 ${why}: ya no promete seguimiento automático`, !/advisor will follow up/i.test(msg), msg);
  ok(`LEAD-06 ${why}: pide la acción que sí funciona`, /1-855-720-8555/.test(msg), msg);
  ok(`LEAD-06 ${why}: sigue sin escribir nada`, r.notes.length === 0 && r.opps.length === 0, JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
}

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-04 — oportunidad fallida y 2xx sin id de contacto
// ═══════════════════════════════════════════════════════════════════════════
{
  const r = await run(lead(), okRoute({ opp: () => resp(500, { error: 'opp down' }) }));
  ok('LEAD-04 un 5xx de la oportunidad se reintenta con la política del contacto', r.opps.length === 3, 'intentos=' + r.opps.length);
  ok('LEAD-04 tras los reintentos se etiqueta Status-NeedsOpportunity', r.tagPosts.length === 1 && Array.isArray(r.tagPosts[0].body.tags) && r.tagPosts[0].body.tags.indexOf('Status-NeedsOpportunity') !== -1, JSON.stringify(r.tagPosts.map((c) => c.body)));
  ok('LEAD-04 la etiqueta va por POST /tags, NUNCA por PUT /contacts/{id}', r.puts.length === 0 && /\/tags$/.test(r.tagPosts[0].path), JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
  ok('LEAD-04 se escribe la nota accionable', r.notes.some((n) => /\*\*\* OPPORTUNITY NOT CREATED — add to pipeline manually \*\*\*/.test(n)), JSON.stringify(r.notes));
  ok('LEAD-04 auditoría created_without_opportunity (no "created")', audited(r, 'created_without_opportunity') && !/"outcome":"created"/.test(r.audits), r.audits);
  ok('LEAD-04 el JSON dice opportunity:"failed"', r.payload && r.payload.opportunity === 'failed', JSON.stringify(r.payload));
  ok('LEAD-04 el remitente no recibe un falso fallo (success sigue true)', r.status === 200 && r.payload.success === true, `status=${r.status}`);
}
{
  const r = await run(lead(), okRoute({ opp: () => resp(422, { message: 'pipelineStageId invalid' }) }));
  ok('LEAD-04 un 422 no se reintenta (es determinista)', r.opps.length === 1, 'intentos=' + r.opps.length);
  ok('LEAD-04 un 422 también se marca y se anota', r.tagPosts.length === 1 && r.notes.some((n) => /OPPORTUNITY NOT CREATED/.test(n)), JSON.stringify(r.notes));
  ok('LEAD-04 un 422 también reporta opportunity:"failed"', r.payload && r.payload.opportunity === 'failed', JSON.stringify(r.payload));
}
{
  // Control: cuando la oportunidad sí se crea, no se marca nada.
  const r = await run(lead(), okRoute());
  ok('LEAD-04 control: con la oportunidad creada no se etiqueta nada', r.tagPosts.length === 0 && r.opps.length === 1, JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
  ok('LEAD-04 control: auditoría created y sin campo opportunity', audited(r, 'created') && r.payload.opportunity === undefined, r.audits + ' ' + JSON.stringify(r.payload));
}
for (const [why, contactRes] of [
  ['2xx con HTML de una pasarela', () => resp(200, '<html>gateway</html>', { 'content-type': 'text/html' })],
  ['204 sin cuerpo', () => resp(204, null)],
  ['2xx con JSON sin id', () => resp(200, { succeded: true })],
]) {
  const L = lead();
  const r = await run(L, okRoute({
    contact: contactRes,
    search: () => resp(200, { contacts: [{ id: 'C_RECOVERED', phone: '+1' + L.phone, tags: [] }] }),
  }));
  ok(`LEAD-04 ${why}: el contacto se recupera por identidad`, r.payload && r.payload.contact_id === 'C_RECOVERED', JSON.stringify(r.payload));
  ok(`LEAD-04 ${why}: la nota se escribe`, r.notes.length >= 1, JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
  ok(`LEAD-04 ${why}: el lead entra al pipeline`, r.opps.length === 1, JSON.stringify(r.calls.map((c) => c.method + ' ' + c.path)));
}
{
  // …y si de verdad no hay a quién adjuntarlo, se dice en los registros en vez
  // de fingir que quedó completo.
  const r = await run(lead(), okRoute({ contact: () => resp(204, null), search: () => resp(200, { contacts: [] }) }));
  ok('LEAD-04 sin coincidencia de identidad el fallo queda en los registros', r.logs.some((l) => /no identity match — no note and no opportunity/.test(l)), r.logs.join('\n'));
  ok('LEAD-04 sin coincidencia de identidad no se inventa un contacto', r.notes.length === 0 && r.opps.length === 0 && r.status === 200, `status=${r.status}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-03 — 401/403 con su propio código de salida
// ═══════════════════════════════════════════════════════════════════════════
for (const st of [401, 403]) {
  const r = await run(lead(), okRoute({ contact: () => resp(st, { message: 'nope' }) }));
  ok(`LEAD-03 HTTP ${st}: código de error propio CRM_AUTH`, r.status === 502 && r.payload && r.payload.error === 'CRM_AUTH', `status=${r.status} payload=${JSON.stringify(r.payload)}`);
  ok(`LEAD-03 HTTP ${st}: auditoría crm_auth, no crm_unavailable`, audited(r, 'crm_auth') && !audited(r, 'crm_unavailable'), r.audits);
  ok(`LEAD-03 HTTP ${st}: línea de error distinguible para el dueño`, r.logs.some((l) => /Contact creation REFUSED — HTTP ' ?\d{3}| Contact creation REFUSED/.test(l) || /Contact creation REFUSED/.test(l)), r.logs.join('\n'));
  ok(`LEAD-03 HTTP ${st}: el mensaje al remitente es honesto`, /could not file your request automatically/i.test(String(r.payload.message)) && /1-855-720-8555/.test(String(r.payload.message)), String(r.payload.message));
  ok(`LEAD-03 HTTP ${st}: un 4xx determinista no se reintenta`, r.calls.filter((c) => c.path === '/contacts/' && c.method === 'POST').length === 1, 'intentos=' + r.calls.filter((c) => c.path === '/contacts/').length);
  ok(`LEAD-03 HTTP ${st}: no se filtra el estado upstream al remitente`, !/401|403|leadconnector|bearer/i.test(JSON.stringify(r.payload)), JSON.stringify(r.payload));
}
{
  // Control: un 5xx sigue siendo CRM_UNAVAILABLE y sigue reintentándose.
  const r = await run(lead(), okRoute({ contact: () => resp(500, { error: 'boom' }) }));
  ok('LEAD-03 control: un 5xx sigue siendo CRM_UNAVAILABLE', r.status === 502 && r.payload.error === 'CRM_UNAVAILABLE' && audited(r, 'crm_unavailable'), `${r.status} ${JSON.stringify(r.payload)}`);
  ok('LEAD-03 control: un 5xx se reintenta 3 veces', r.calls.filter((c) => c.path === '/contacts/' && c.method === 'POST').length === 3, 'intentos=' + r.calls.filter((c) => c.path === '/contacts/').length);
}
{
  // La deuda que NO se puede cerrar en código queda documentada en el archivo.
  const SRC = readFileSync(join(ROOT, 'api', 'submit-lead.js'), 'utf8');
  ok('LEAD-03 el dead-letter está documentado como decisión del dueño', /DECISIÓN DEL DUEÑO[\s\S]{0,400}dead-letter/.test(SRC), 'falta el comentario');
}

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-09 — plazo por intento
// ═══════════════════════════════════════════════════════════════════════════
{
  const r = await run(lead(), okRoute());
  const crm = r.calls.filter((c) => c.path === '/contacts/' || /\/notes$/.test(c.path) || c.path === '/opportunities/' || c.path.startsWith('/opportunities/search'));
  ok('LEAD-09 cada llamada al CRM lleva AbortSignal', crm.length >= 4 && crm.every((c) => c.signal && typeof c.signal.aborted === 'boolean'), JSON.stringify(crm.map((c) => c.path + ':' + !!c.signal)));
}
{
  // Un aborto por plazo agotado se distingue de un error nuestro: 504, no 500.
  const abortErr = () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
  const r = await run(lead(), (rec) => (rec.path === '/contacts/' ? abortErr() : okRoute()(rec)));
  ok('LEAD-09 el agotamiento del plazo contesta 504 CRM_TIMEOUT', r.status === 504 && r.payload && r.payload.error === 'CRM_TIMEOUT', `status=${r.status} payload=${JSON.stringify(r.payload)}`);
  ok('LEAD-09 auditoría crm_timeout (no internal_error)', audited(r, 'crm_timeout') && !audited(r, 'internal_error'), r.audits);
  ok('LEAD-09 el mensaje pide llamar, sin culpar al remitente', /did not answer in time/i.test(String(r.payload.message)) && /1-855-720-8555/.test(String(r.payload.message)), String(r.payload.message));
}
{
  // Y el plazo se dispara DE VERDAD: el CRM cuelga y sólo responde al aborto.
  // Tres intentos de 8 s → la función termina sola en vez de seguir esperando
  // cuando el navegador ya abortó a los 15 s.
  // El temporizador de AbortSignal.timeout() está unref'd (así lo define Node),
  // así que en un doble de laboratorio sin socket vivo el bucle de eventos se
  // quedaría sin nada que hacer antes de que salte el plazo. Un temporizador
  // ref'd de 60 s hace de socket: se cancela en cuanto llega el aborto.
  const hang = (rec) => new Promise((_resolve, reject) => {
    if (!rec.signal) { reject(new Error('no AbortSignal attached — the per-attempt timeout is missing')); return; }
    const keepAlive = setTimeout(() => {}, 60000);
    rec.signal.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      const e = new Error('aborted');
      e.name = (rec.signal.reason && rec.signal.reason.name === 'TimeoutError') ? 'TimeoutError' : 'AbortError';
      reject(e);
    });
  });
  const t0 = Date.now();
  const r = await run(lead(), (rec) => (rec.path === '/contacts/' ? hang(rec) : okRoute()(rec)));
  const ms = Date.now() - t0;
  ok('LEAD-09 un CRM colgado no bloquea la función indefinidamente', r.status === 504 && ms < 40000, `status=${r.status} ms=${ms}`);
  ok('LEAD-09 el plazo es POR INTENTO (~8 s) y se reintenta', r.calls.filter((c) => c.path === '/contacts/').length === 3 && ms >= 20000, 'intentos=' + r.calls.filter((c) => c.path === '/contacts/').length + ' ms=' + ms);
}

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-08 — el limitador por teléfono no cobra los fallos del CRM
// ═══════════════════════════════════════════════════════════════════════════
{
  // Tres intentos con el CRM caído y el cuarto con el CRM recuperado.
  const p = nextPhone();
  const H = { 'x-forwarded-for': '198.51.100.201' };
  const seq = [];
  for (let i = 1; i <= 4; i++) {
    const r = await run(lead({ phone: p }), (rec) => ((rec.path === '/contacts/' && rec.method === 'POST' && i < 4) ? resp(500, {}) : okRoute()(rec)), { headers: H });
    seq.push({ i, status: r.status, payload: r.payload });
  }
  ok('LEAD-08 los tres intentos durante la caída fallan como corresponde', seq.slice(0, 3).every((s) => s.status === 502), JSON.stringify(seq));
  ok('LEAD-08 el cuarto intento, con el CRM ya bien, ENTRA (antes: 429 una hora)', seq[3].status === 200 && seq[3].payload && seq[3].payload.success === true, JSON.stringify(seq[3]));
}
{
  // Control: cuatro envíos que el CRM SÍ recibió siguen topando en el cuarto.
  const p = nextPhone();
  const H = { 'x-forwarded-for': '198.51.100.202' };
  const seq = [];
  for (let i = 1; i <= 4; i++) {
    const r = await run(lead({ phone: p }), okRoute(), { headers: H });
    seq.push({ i, status: r.status, retryAfter: r.headers['retry-after'] });
  }
  ok('LEAD-08 control: el techo de 3/hora por teléfono sigue en pie', seq[3].status === 429 && seq[3].retryAfter, JSON.stringify(seq));
  ok('LEAD-08 control: los tres primeros pasan', seq.slice(0, 3).every((s) => s.status === 200), JSON.stringify(seq));
}

// ═══════════════════════════════════════════════════════════════════════════
// R8-LEAD-10 — etiquetas de idioma falsificadas
// ═══════════════════════════════════════════════════════════════════════════
{
  const r = await run(lead({
    preferred_language: 'en',
    tags: ['LANG-ES', 'Lang_ES', 'lang-es', 'Lang-ES', 'LaNg ES', 'language_es', 'Interest-PartD', 'CallTime-Morning'],
  }), okRoute());
  const sent = r.calls.find((c) => c.path === '/contacts/' && c.method === 'POST');
  const tags = (sent && sent.body && sent.body.tags) || [];
  const langish = tags.filter((t) => /^lang[-_ ]/i.test(String(t)));
  ok('LEAD-10 sólo queda la etiqueta de idioma del servidor', langish.length === 1 && langish[0] === 'Lang-EN', JSON.stringify(tags));
  ok('LEAD-10 ninguna variante falsificada sobrevive', !tags.some((t) => /^lang[-_ ]es$/i.test(String(t))), JSON.stringify(tags));
  ok('LEAD-10 control: el vocabulario del bot de soporte sigue pasando', tags.indexOf('language_es') !== -1, JSON.stringify(tags));
  ok('LEAD-10 control: las etiquetas descriptivas siguen pasando', tags.indexOf('Interest-PartD') !== -1 && tags.indexOf('CallTime-Morning') !== -1, JSON.stringify(tags));
}

// ═══════════════════════════════════════════════════════════════════════════
// La consola no debe llevar PII en NINGUNO de los escenarios anteriores
// ═══════════════════════════════════════════════════════════════════════════
// (los registros se revisan por escenario; aquí se comprueba el último lote más
//  un envío feliz, que es el que más escribe)
{
  const r = await run(lead(), okRoute());
  const joined = r.logs.join('\n');
  ok('la consola no lleva PII (nombre, teléfono, correo)', !/Probe|Tester|probe\.tester|718\d{7}|\+1718/.test(joined), joined.slice(0, 400));
}

// ═══════════════════════════════════════════════════════════════════════════
// Cumplimiento F2 — depurador de identidad hacia el modelo de enriquecimiento
// ═══════════════════════════════════════════════════════════════════════════
// El depurador se levanta del archivo desplegado, como en las rondas anteriores,
// para probar exactamente lo que corre en producción.
const SRC = readFileSync(join(ROOT, 'api', 'submit-lead.js'), 'utf8');
function lift(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('cannot find function ' + name);
  let depth = 0, i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) { if (SRC[i] === '{') depth++; else if (SRC[i] === '}') { depth--; if (depth === 0) break; } }
  return SRC.slice(start, i + 1);
}
const head = [
  'var OFFICIAL_NUMBERS_RE = ' + SRC.match(/var OFFICIAL_NUMBERS_RE = (.+);/)[1] + ';',
  'var SEP_CLASS = ' + SRC.match(/var SEP_CLASS = (.+);/)[1] + ';',
  'var PHONE_SEP = ' + SRC.match(/var PHONE_SEP = (.+);/)[1] + ';',
  'var ACCENT_SETS = ' + SRC.match(/var ACCENT_SETS = (\{[^\n]+\});/)[1] + ';',
  'var AMBIGUOUS_NAME = ' + SRC.match(/var AMBIGUOUS_NAME = (.+);/)[1] + ';',
  'var WORD_DIGITS = ' + SRC.match(/var WORD_DIGITS = (\{[\s\S]*?\});/)[1] + ';',
  'var CONFUSABLES = ' + SRC.match(/var CONFUSABLES = (\{[\s\S]*?\n\};)/)[1],
  'var CONFUSABLE_RE = ' + SRC.match(/var CONFUSABLE_RE = (.+);/)[1] + ';',
].join('\n');
const scrub = new Function(head + '\n' + ['foldConfusables', 'foldToken', 'tokenPattern', 'scrubIdentityForIntel'].map(lift).join('\n') + '\nreturn scrubIdentityForIntel;')();
// Los cinco valores del hallazgo. El teléfono y el correo son de laboratorio.
const ROSA = ['Rosa', 'Delgado', '7185550198', 'rosadelgado51@gmail.com'];
for (const [why, text, mustNotHave] of [
  ['correo ofuscado en inglés', 'my email is rosa.delgado51 at gmail dot com', 'rosa.delgado51'],
  ['correo ofuscado con corchetes', 'escribame a rosa.delgado51 [at] gmail [dot] com', 'rosa.delgado51'],
  ['correo ofuscado en español', 'mi correo es rosa.delgado51 arroba gmail punto com', 'rosa.delgado51'],
  ['handle con dígitos al final', 'you can find me on facebook as rosadelgado51', 'rosadelgado51'],
  ['handle en CamelCase con año', 'mi usuario de Medicare.gov es RosaDelgado1951', 'RosaDelgado1951'],
  ['handle con puntos', 'write to rosa.delgado51 about the plan', 'rosa.delgado51'],
  ['handle con guiones bajos', 'my user is rosa_delgado_51 on the portal', 'rosa_delgado_51'],
  ['handle en orden invertido', 'my handle is delgadorosa1951', 'delgadorosa1951'],
]) {
  const got = scrub(text, ROSA, '');
  ok(`F2 ${why} no llega al modelo`, !got.toLowerCase().includes(mustNotHave.toLowerCase()), 'got ' + JSON.stringify(got));
}
for (const [why, text] of [
  ['ZIP dictado en inglés', 'my zip is one zero four five eight'],
  ['ZIP dictado en español', 'mi codigo postal es uno cero cuatro cinco ocho'],
  ['ZIP dictado con etiqueta y dos puntos', 'zip code: one zero four five eight'],
]) {
  const got = scrub(text, ROSA, '');
  ok(`F2 ${why} queda en tres dígitos`, /104xx/.test(got) && !/10458/.test(got) && !/one zero four five eight|uno cero cuatro cinco ocho/i.test(got), 'got ' + JSON.stringify(got));
}
// Los controles que ya funcionaban deben seguir funcionando…
for (const [why, text, want] of [
  ['el correo con arroba real', 'my email is rosadelgado51@gmail.com', 'my email is [email]'],
  ['el ZIP escrito con dígitos', 'I live in zip 10458', 'I live in zip 104xx'],
]) {
  ok(`F2 control: ${why}`, scrub(text, ROSA, '') === want, 'got ' + JSON.stringify(scrub(text, ROSA, '')));
}
// …y lo que NO es un identificador debe sobrevivir intacto.
for (const [why, text, mustHave] of [
  ['una cantidad de cinco cifras sin etiqueta', 'The total was 12500 for the year.', '12500'],
  ['un año', 'I have had this plan since 2019.', '2019'],
  ['un identificador de plan', 'My plan number is H1234-005 on the card.', 'H1234-005'],
  ['una cantidad en dólares', 'The premium is 174 dollars.', '174'],
  ['cinco números dictados SIN etiqueta de ZIP', 'I take one two three four five pills a week.', 'one two three four five'],
  ['un número oficial de Medicare', 'Call 1-800-633-4227 for help.', '1-800-633-4227'],
]) {
  ok(`F2 control: ${why} sobrevive`, scrub(text, ROSA, '').includes(mustHave), 'got ' + JSON.stringify(scrub(text, ROSA, '')));
}
// Y el nombre propio que es palabra corriente sigue a salvo del nuevo sufijo.
ok('F2 control: la prosa con un nombre ambiguo no se destruye',
  scrub('me dieron la pastilla rosa por la manana', ['Rosa', 'Martinez'], '') === 'me dieron la pastilla rosa por la manana',
  'got ' + JSON.stringify(scrub('me dieron la pastilla rosa por la manana', ['Rosa', 'Martinez'], '')));
ok('F2 control: una cantidad pegada a un nombre ambiguo en minúscula sobrevive',
  scrub('la rosa 2019 del jardin', ['Rosa', 'Martinez'], '').includes('2019'),
  'got ' + JSON.stringify(scrub('la rosa 2019 del jardin', ['Rosa', 'Martinez'], '')));

// ═══════════════════════════════════════════════════════════════════════════
// BOT-10 — MBI partido por espacios / guiones
// ═══════════════════════════════════════════════════════════════════════════
for (const [why, text, id] of [
  ['detectado-pero-reenviado con guiones y espacio', 'medicare # 1EG4-TE5-MK7 3', '1EG4-TE5-MK7 3'],
  ['detectado-pero-reenviado sin separadores y espacio', 'my medicare number is 1EG4TE5MK7 3', '1EG4TE5MK7 3'],
  ['no detectado: espacios en cualquier posición', 'medicare 1EG4 TE5 MK 73', '1EG4 TE5 MK 73'],
  ['con guiones entre todos los caracteres', 'mi medicare es 1-E-G-4-T-E-5-M-K-7-3', '1-E-G-4-T-E-5-M-K-7-3'],
]) {
  const r = scrubPHI(text);
  ok(`BOT-10 ${why}: se redacta`, !r.text.includes(id) && /\[REDACTED_MBI\]/.test(r.text), JSON.stringify(r.text));
  ok(`BOT-10 ${why}: se marca detectado`, r.detected.indexOf('MBI') !== -1 || r.detected.indexOf('MBI_DICTATED') !== -1, JSON.stringify(r.detected));
  ok(`BOT-10 ${why}: ya no se reenvía con NORMALIZED_BYPASS`, r.detected.indexOf('NORMALIZED_BYPASS') === -1, JSON.stringify(r.detected));
}
// Las formas que ya se redactaban siguen verdes.
for (const [text, id] of [
  ['medicare id 1EG4-TE5-MK72 thanks', '1EG4-TE5-MK72'],
  ['mi numero de medicare es 1AB2-CD3-EF45', '1AB2-CD3-EF45'],
  ['hola, mi MBI es 1EG4-TE5-MK73', '1EG4-TE5-MK73'],
  ['1 E G 4 T E 5 M K 7 3', '1 E G 4 T E 5 M K 7 3'],
]) {
  const r = scrubPHI(text);
  ok(`BOT-10 control: la forma conocida ${JSON.stringify(text)} sigue redactada`, !r.text.includes(id) && /\[REDACTED_MBI\]/.test(r.text), JSON.stringify(r.text));
}
// …y el matcher laxo no se come prosa ni otros identificadores etiquetados.
for (const [why, text, mustHave] of [
  ['una dosis', 'I take 2 pills of Metformin 500 mg twice a day', '2 pills'],
  ['un identificador de plan', 'my plan is H1234-005 and I turn 65 in March', 'H1234-005'],
  ['una fecha con mes abreviado', 'my appointment is 5 Dec 2024 at 7 PM', '5 Dec 2024'],
  ['un número oficial', 'Call 1-800-633-4227 for help', '1-800-633-4227'],
  ['una dirección con ZIP', 'I live at 2345 Grand Concourse Apt 4B, Bronx NY 10468.', 'Grand Concourse'],
  ['tres planes y un año', '3 Part D plans in 2026 cost me 1200 dollars', '3 Part D plans'],
]) {
  ok(`BOT-10 control: ${why} sobrevive`, scrubPHI(text).text.includes(mustHave), JSON.stringify(scrubPHI(text).text));
}
for (const [why, text, id] of [
  ['el CIN de Medicaid sigue con su propia etiqueta', 'My Medicaid CIN is AB12345C and I need help.', 'AB12345C'],
  ['el ID de miembro sigue con su propia etiqueta', 'member id ZX9K2-77Q1', 'ZX9K2-77Q1'],
]) {
  const r = scrubPHI(text);
  ok(`BOT-10 control: ${why}`, !r.text.includes(id) && /REDACTED_MEMBER_ID/.test(r.text) && r.detected.indexOf('MEMBER_ID') !== -1, JSON.stringify(r.text) + ' ' + JSON.stringify(r.detected));
}

// ── resultado ───────────────────────────────────────────────────────────────
for (const k of ['log', 'warn', 'error']) console[k] = realConsole[k];
const total = passed + failures.length;
if (failures.length) {
  out(`RONDA 8B LEADS: ${passed}/${total} passed, ${failures.length} failed\n`);
  for (const f of failures) out('  FAIL ' + f + '\n');
  process.exit(1);
}
out(`RESULT: ${passed}/${total} passed, 0 failed`);

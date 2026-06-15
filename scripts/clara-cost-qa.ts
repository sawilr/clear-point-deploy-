/* eslint-disable no-console */
// Sawil 2026-06-15 — Aggressive QA for the DETERMINISTIC Medicare cost flow.
// Drives the pure sync engine (processMessage) — zero LLM — so every turn is
// reproducible. Prints full transcripts + asserts the mission's invariants.
// Run: npx tsx scripts/clara-cost-qa.ts
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine';

type Any = any;
let PASS = 0, FAIL = 0;
const fails: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  if (cond) { PASS++; console.log(`   ✅ ${label}`); }
  else { FAIL++; fails.push(label); console.log(`   ❌ ${label}${detail ? '  — ' + detail : ''}`); }
}

function convo(label: string, lang: string, turns: string[], seedPatch: Any = {}) {
  console.log(`\n══════════ ${label} ══════════`);
  let st: Any = { ...createInitialState() };
  st = processMessage(lang, st).newState;            // language
  st = processMessage('10033', st).newState;         // ZIP
  st = { ...st, ...seedPatch };
  const log: Any[] = [];
  for (const t of turns) {
    const r = processMessage(t, st);
    st = r.newState;
    log.push({ user: t, bot: r.response, st });
    console.log(`\n> ${t}`);
    console.log(`CLARA: ${r.response}`);
  }
  return { st, log, last: log[log.length - 1] };
}

const MENU = /en qu[eé] le puedo ayudar|cu[eé]nteme un poco m[aá]s sobre lo que necesita|tell me a bit more about what you need|how can i help/i;
const SOURCEQ = /seguro social|social security|farmacia|pharmacy|doctor|factura|bill/i;
const noBadCompliance = (s: string) => !/definitivamente|usted califica|you qualify|ya tiene acceso|le garantiz/i.test(s);

// ── A) "me están cobrando mucho de Medicare" → source-first, no reset ──
{
  const { last, log } = convo('A — cobran mucho de Medicare', 'Español', ['me están cobrando mucho de Medicare']);
  check('A1 entra al flujo de costo (no menú genérico)', last.st.costFlowStage === 'ask_source' && !MENU.test(last.bot));
  check('A2 pregunta la fuente (source-first)', SOURCEQ.test(last.bot));
  check('A3 recuerda el tema (activeCaseTopic)', last.st.activeCaseTopic === 'medicare_cost');
  check('A4 compliance ok', noBadCompliance(log.map((l: Any) => l.bot).join(' ')));
}

// ── B) "ya te dije" → restate, no repetir misma pregunta ──
{
  const { log } = convo('B — ya te dije', 'Español', ['me cobran mucho de medicare', 'ya te dije']);
  const reAsk = log[1].bot;
  check('B1 reconoce dato previo (restate)', /tiene raz[oó]n|disculpe|usted me dijo/i.test(reAsk));
  check('B2 no reinicia el hilo', !MENU.test(reAsk) && log[1].st.activeCaseTopic === 'medicare_cost');
  check('B3 sigue pidiendo la fuente (continúa, no menú)', SOURCEQ.test(reAsk));
}

// ── C) "tengo Part B" como respuesta de costo → Parte B ──
{
  const { last } = convo('C — Part B', 'Español', ['me cobran mucho de medicare', 'tengo part b']);
  check('C1 reconoce Parte B', last.st.costFlowStage === 'confirm_part_b' && /parte b/i.test(last.bot));
}

// ── D) "tengo Medicare y Medicaid" mid-flow → doble elegible ──
{
  const { last } = convo('D — Medicare + Medicaid (dual)', 'Español', ['me cobran mucho', 'me sacan 200 del cheque', 'si', 'tengo medicare y medicaid']);
  check('D1 menciona doble elegible / Medicaid', /doble elegible|medicaid/i.test(last.bot));
  check('D2 nombra familia MSP (QMB/SLMB/QI) sin confirmar', /MSP|QMB|SLMB|QI|Extra Help/i.test(last.bot) && noBadCompliance(last.bot));
}

// ── E) "me quitaron mucho del social" → Seguro Social / Parte B ──
{
  const { last } = convo('E — me quitaron del social', 'Español', ['me quitaron mucho del social']);
  check('E1 ruta a Seguro Social / Parte B', last.st.costChargeSource === 'social_security' && /parte b|seguro social/i.test(last.bot));
}

// ── F) "pago mucho en la farmacia" → Extra Help / LIS ──
{
  const { last } = convo('F — farmacia', 'Español', ['pago mucho en la farmacia']);
  check('F1 ruta a farmacia → Extra Help / LIS', last.st.costChargeSource === 'pharmacy' && /extra help|lis/i.test(last.bot));
}

// ── G) "mi doctor no acepta el plan" → tema doctor, NO flujo de costo ──
{
  const { last } = convo('G — doctor no acepta el plan', 'Español', ['mi doctor no acepta el plan']);
  check('G1 aborda doctor/plan (no pregunta de fuente de costo)', /doctor|plan|red|network|cobertura|asesor/i.test(last.bot) && last.st.costFlowStage === undefined);
  check('G2 no menú genérico', !MENU.test(last.bot));
}

// ── H) "me llegó una factura del hospital" → manejador de facturas, NO costo ──
{
  const { last } = convo('H — factura del hospital', 'Español', ['me llegó una factura del hospital']);
  check('H1 va a facturas, no al flujo de costo continuo', last.st.costFlowStage === undefined);
  check('H2 aborda la factura (no menú genérico)', !MENU.test(last.bot) && /factura|hospital|cantidad|amount|asesor|cobr/i.test(last.bot));
}

// ── I) Spanglish (English start) → flujo en inglés, Part B ──
{
  const { last } = convo('I — Spanglish', 'English', ['they charge me too much for the part b']);
  check('I1 entra al flujo de costo en inglés', last.st.activeCaseTopic === 'medicare_cost' && /Social Security|Part B/i.test(last.bot));
  check('I2 responde en inglés (no español)', !/¿|cómo le puedo/i.test(last.bot));
}

// ── J) Usuario molesto / impaciente → no defensivo, ayuda ──
{
  const { last } = convo('J — molesto', 'Español', ['esto no sirve me cobran un monton y nadie me ayuda']);
  check('J1 no defensivo + entra a ayudar con el costo', /entiendo|disculp|lamento|seguro social|farmacia|doctor|factura/i.test(last.bot));
  check('J2 no menú genérico', !MENU.test(last.bot));
}

// ── K) NO consentimiento doble: ya hay contacto + handoff ──
{
  const seed = { name: 'Anthony Careless', phoneNumber: '5616161891', advisorHandoffStarted: true, consent_to_contact: true, anythingElseAsked: true, lastBotIntent: 'anything_else' };
  const { last, log } = convo('K — no consentimiento doble', 'Español', ['si me cobran 200 de medicare', 'del seguro social', 'si', '1700', 'limpio'], seed);
  const all = log.map((l: Any) => l.bot).join(' \n ');
  check('K1 educa el costo sin re-pedir consentimiento', /asesor ya tiene sus datos|le ayudará también/i.test(all));
  check('K2 NO vuelve a pedir consentimiento/autorización', !/autoriza que un asesor|¿autoriza|responder s[ií] para autorizar/i.test(all));
  check('K3 no re-colecta nombre/teléfono', !/cu[aá]l es su nombre|su tel[eé]fono|n[uú]mero donde/i.test(all));
}

console.log(`\n═════════════════════════════════════════`);
console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL > 0 ? 1 : 0);

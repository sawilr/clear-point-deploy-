/* eslint-disable no-console */
// Sawil 2026-06-15 — Clara conversational-reasoning QA (mission PART 7).
// Drives the deterministic engine (processMessage) — zero LLM — to verify the
// case-context / anti-loop / correction-recovery behaviors. Prints transcripts.
// Run: npx tsx scripts/clara-reasoning-qa.ts
import { processMessage, createInitialState } from '../src/lib/customerServiceEngine';

type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  if (cond) { PASS++; console.log(`   ✅ ${label}`); }
  else { FAIL++; fails.push(label); console.log(`   ❌ ${label}${detail ? '  — ' + detail : ''}`); }
}
const MENU = /en qu[eé] le puedo ayudar|cu[eé]nteme un poco m[aá]s sobre lo que necesita|tell me a bit more about what you need|how can i help|¿en qu[eé] puedo/i;
const ASKS_ZIP = /c[oó]digo postal|zip code|su zip\b/i;
const ASKS_LANG = /espa[nñ]ol o ingl[eé]s|english or spanish|prefiere.*idioma/i;
const noEligibility = (s: string) => !/usted califica|you qualify|definitivamente califica|ya tiene acceso|le garantiz|you are eligible|usted es elegible/i.test(s);

function convo(label: string, lang: string, turns: string[], seedPatch: Any = {}) {
  console.log(`\n══════════ ${label} ══════════`);
  let st: Any = { ...createInitialState() };
  st = processMessage(lang, st).newState;
  st = processMessage('10033', st).newState;     // NY ZIP
  st = { ...st, ...seedPatch };
  const log: Any[] = [];
  for (const t of turns) {
    const r = processMessage(t, st); st = r.newState;
    log.push({ user: t, bot: r.response, st });
    console.log(`\n> ${t}\nCLARA: ${r.response}`);
  }
  return { st, log, last: log[log.length - 1], all: log.map(l => l.bot).join('\n') };
}

// ── CLARA 1 — pharmacy cost → "mencionaste LIS" keeps the case ──
{
  const { log, all, last } = convo('CLARA-1 farmacia + mencionaste LIS', 'Español',
    ['me cobran mucho en la farmacia', 'mencionaste LIS']);
  const r1 = log[0].bot, r2 = log[1].bot;
  check('1a pharmacy cost routed (Extra Help/LIS mentioned)', /extra help|lis\b/i.test(r1));
  check('1b asks ONE next step (amount or advisor), not a menu', !MENU.test(r1));
  check('1c "mencionaste LIS" → explains LIS', /extra help|lis\b/i.test(r2) && /(medicament|farmacia|drug|prescription|costos?)/i.test(r2));
  check('1d keeps pharmacy-cost case (no menu reset)', !MENU.test(r2));
  check('1e does NOT re-ask ZIP', !ASKS_ZIP.test(r2));
  check('1f no eligibility decision', noEligibility(all));
  check('1g advisor path preserved somewhere', /asesor|advisor/i.test(all));
}

// ── CLARA 2 — "ya te dije" recovery ──
{
  const { log } = convo('CLARA-2 ya te dije', 'Español',
    ['me cobran mucho de medicare', 'ya te dije']);
  const r2 = log[1].bot;
  check('2a apologizes / restates (no robotic repeat)', /(tiene raz[oó]n|disculp|usted me dijo|perd[oó]n|lamento)/i.test(r2));
  check('2b does NOT reset to menu', !MENU.test(r2));
}

// ── CLARA 3 — income already given, not re-asked ──
{
  const { all } = convo('CLARA-3 income not re-asked', 'Español',
    ['pago muchos copagos', '1200 bruto', 'y ahora que', 'algo mas']);
  // After income is given once, Clara should not keep asking for income.
  const asksIncomeTimes = (all.match(/cu[aá]l es su ingreso|idea aproximada de su ingreso|how much.*income|su ingreso mensual/gi) || []).length;
  check('3a income asked at most once', asksIncomeTimes <= 1, `asked ${asksIncomeTimes}x`);
}

// ── CLARA 4 — ZIP already provided, never re-asked ──
{
  const { all } = convo('CLARA-4 ZIP not re-asked', 'Español',
    ['tengo un problema con mi plan', 'mi doctor no lo acepta', 'que hago']);
  check('4a never re-asks ZIP (already 10033)', !ASKS_ZIP.test(all));
  check('4b never re-asks language', !ASKS_LANG.test(all));
}

// ── CLARA 5 — wants advisor → route ──
{
  const { last } = convo('CLARA-5 wants advisor', 'Español', ['quiero hablar con alguien']);
  check('5a routes to advisor / asks name to connect', /asesor|advisor|nombre|name|le contacte|conect/i.test(last.bot));
  check('5b no eligibility claim', noEligibility(last.bot));
}

// ── CLARA 6 — sensitive data → refuse + remind ──
{
  const { last } = convo('CLARA-6 sensitive data', 'Español', ['mi seguro social es 123-45-6789']);
  check('6a refuses / hides + reminds not to share', /no env[ií]e|no comparta|por su seguridad|ocult|do not (send|share)|for your safety/i.test(last.bot));
  check('6b mentions it belongs with a licensed advisor (not chat)', /asesor licenciado|licensed advisor|por tel[eé]fono|phone|en persona|in person/i.test(last.bot));
}

// ── CLARA 7 — session loss: "ya te dije" with EMPTY state must not pretend ──
{
  console.log(`\n══════════ CLARA-7 session-loss recovery ══════════`);
  let st: Any = { ...createInitialState() };
  st = processMessage('Español', st).newState;   // language only — no ZIP, no problem
  const r = processMessage('ya te dije cuál era el problema', st);
  console.log(`\n> ya te dije cuál era el problema\nCLARA: ${r.response}`);
  // With no stored problem, Clara must NOT invent one. Acceptable: ask the user
  // to restate in one phrase (recovery) OR ask what the issue is — never claim
  // to remember a problem it never had.
  check('7a does not invent/claim a remembered problem', !/usted me dijo que|you told me (it was|that)/i.test(r.response) || /perd|no estoy seguro|d[ií]game|cu[aá]l (era|es)/i.test(r.response));
  check('7b gracefully asks the user to restate / what the issue is', /(perd|d[ií]game|cu[eé]nteme|cu[aá]l (era|es)|en una frase|qu[eé] (necesita|problema)|tell me|what (was|is) the)/i.test(r.response));
}

console.log(`\n═════════════════════════════════════════`);
console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL > 0 ? 1 : 0);

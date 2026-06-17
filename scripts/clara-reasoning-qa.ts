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

// ── CLARA 8 — handoff ZIP step: words & refusal (Sawil 2026-06-16 bug) ──
// At the advisor-handoff ZIP step the user used to be able to type words and
// Clara wouldn't recognize them (esp. in Spanish). Now: words → clear "not a
// ZIP" + decline path; refusal → finalize the handoff, never loop.
{
  function handoffZip(lang: string, name: string, zipReply: string) {
    let st: Any = { ...createInitialState() };
    st = processMessage(lang, st).newState;
    st = processMessage(lang === 'Español' ? 'quiero hablar con un asesor' : 'I want to talk to an advisor', st).newState;
    st = processMessage(name, st).newState;          // → asking_zip
    return processMessage(zipReply, st);
  }
  console.log(`\n══════════ CLARA-8 handoff ZIP words/refusal ══════════`);
  // 8a/8b — words at ZIP get a clear non-ZIP re-ask offering a decline, in BOTH languages.
  const wEs = handoffZip('Español', 'Maria Gomez', 'manzana');
  console.log(`\n> [ES] manzana\nCLARA: ${wEs.response}`);
  check('8a ES word → "no parece" + offers decline ("no")',
    /no parece un c[oó]digo postal/i.test(wEs.response) && /d[ií]game "?no"?|no compartirlo/i.test(wEs.response));
  const wEn = handoffZip('English', 'John Smith', 'apple');
  console.log(`\n> [EN] apple\nCLARA: ${wEn.response}`);
  check('8b EN word → "doesn\'t look like a ZIP" + offers decline',
    /look like a zip code/i.test(wEn.response) && /say "?no"?/i.test(wEn.response));
  // 8c/8d — refusal finalizes the handoff (needsHuman) instead of looping.
  const rEs = handoffZip('Español', 'Maria Gomez', 'no sé mi zip');
  console.log(`\n> [ES] no sé mi zip\nCLARA: ${rEs.response.slice(0, 80)}…`);
  check('8c ES refusal → finalizes handoff (needsHuman, no loop)',
    rEs.needsHuman === true && /asesor licenciado/i.test(rEs.response) && !/no parece/i.test(rEs.response));
  const rEn = handoffZip('English', 'John Smith', "i don't know my zip");
  console.log(`\n> [EN] i don't know my zip\nCLARA: ${rEn.response.slice(0, 80)}…`);
  check('8d EN refusal → finalizes handoff (needsHuman, no loop)',
    rEn.needsHuman === true && /licensed.*advisor/i.test(rEn.response) && !/look like/i.test(rEn.response));
  // 8e — a valid ZIP still finalizes the handoff (no regression).
  const okEs = handoffZip('Español', 'Maria Gomez', '10550');
  check('8e ES valid ZIP still finalizes handoff', okEs.needsHuman === true && okEs.newState.zipCode === '10550');

  // ── Sawil 2026-06-16 post-live hotfix — broaden refusal + advisor at ZIP ──
  // 8f — "no tengo zip" (was treated as invalid ZIP, fails++).
  const f = handoffZip('Español', 'Maria Gomez', 'no tengo zip');
  console.log(`\n> [ES] no tengo zip\nCLARA: ${f.response.slice(0, 80)}…`);
  check('8f ES "no tengo zip" → finalizes handoff, no fail attempt',
    f.needsHuman === true && /asesor licenciado/i.test(f.response) && (f.newState.failedZipAttempts || 0) === 0);
  // 8g — "no tengo código postal" (was misrouting to the BILL flow).
  const g = handoffZip('Español', 'Maria Gomez', 'no tengo código postal');
  console.log(`\n> [ES] no tengo código postal\nCLARA: ${g.response.slice(0, 80)}…`);
  check('8g ES "no tengo código postal" → handoff, NOT bill flow',
    g.needsHuman === true && /asesor licenciado/i.test(g.response) && !/factura|bill|cobr/i.test(g.response));
  // 8h — "no quiero dar datos" refusal.
  const h = handoffZip('Español', 'Maria Gomez', 'no quiero dar datos');
  check('8h ES "no quiero dar datos" → finalizes handoff',
    h.needsHuman === true && /asesor licenciado/i.test(h.response));
  // 8i — explicit advisor re-ask at the ZIP step → route immediately, no loop.
  const i = handoffZip('Español', 'Maria Gomez', 'quiero hablar con asesor');
  console.log(`\n> [ES] quiero hablar con asesor (at ZIP)\nCLARA: ${i.response.slice(0, 80)}…`);
  check('8i ES advisor re-ask at ZIP → finalizes, does NOT re-ask ZIP',
    i.needsHuman === true && /asesor licenciado/i.test(i.response) && !/c[oó]digo postal\?|su zip/i.test(i.response));
  // 8j — EN "i don't have a zip" refusal.
  const j = handoffZip('English', 'John Smith', "i don't have a zip");
  check('8j EN "i don\'t have a zip" → finalizes handoff',
    j.needsHuman === true && /licensed.*advisor/i.test(j.response));
  // 8k — numeric miss ("123") asks ONCE for a valid ZIP, does not finalize/loop.
  const k = handoffZip('Español', 'Maria Gomez', '123');
  check('8k ES "123" → single re-ask for 5-digit ZIP (fails=1, not finalized)',
    k.needsHuman === false && (k.newState.failedZipAttempts || 0) === 1 && /5 d[ií]gitos/i.test(k.response));

  // ── Natural ZIP step (pre-handoff) parity: refusal never loops ──
  function naturalZip(lang: string, zipReply: string) {
    let st: Any = { ...createInitialState() };
    st = processMessage(lang, st).newState;            // → asking_zip_natural
    return processMessage(zipReply, st);
  }
  const n1 = naturalZip('Español', 'no tengo zip');
  check('8l NAT ES "no tengo zip" → graceful, no failed attempt, no loop',
    (n1.newState.failedZipAttempts || 0) === 0 && n1.newState.step === 'asking_topic');
  const n2 = naturalZip('Español', 'no quiero dar datos');
  check('8m NAT ES "no quiero dar datos" → graceful, no loop',
    (n2.newState.failedZipAttempts || 0) === 0 && n2.newState.step === 'asking_topic');
}

// ── CLARA 9 — ZIP meta-question recall (Sawil 2026-06-16 Codex micro-fix) ──
// A valid stored ZIP + "what ZIP did I give?" must echo the ZIP and NOT
// restart ZIP collection. Negative: "what zip codes do you serve" must NOT
// trigger the recall echo.
{
  console.log(`\n══════════ CLARA-9 ZIP meta-question recall ══════════`);
  function withZip(lang: string) {
    let st: Any = { ...createInitialState() };
    st = processMessage(lang, st).newState;     // language → asking_zip_natural
    st = processMessage('10001', st).newState;  // store ZIP 10001 (NY)
    return st;
  }
  const en = processMessage('What ZIP did I give you?', withZip('English'));
  console.log(`\n> [EN] What ZIP did I give you?\nCLARA: ${en.response}`);
  check('9a EN recall echoes 10001, no ZIP re-ask', /10001/.test(en.response) && !/what is your zip|5-digit zip\?/i.test(en.response));
  const es = processMessage('¿Qué ZIP te di?', withZip('Español'));
  console.log(`> [ES] ¿Qué ZIP te di?\nCLARA: ${es.response}`);
  check('9b ES recall echoes 10001, stays Spanish', /10001/.test(es.response) && /me dio|ese zip|seguimos/i.test(es.response));
  const span = processMessage('Ya te dije the ZIP, what was it?', withZip('English'));
  check('9c Spanglish recall echoes 10001', /10001/.test(span.response));
  const esCp = processMessage('¿Qué código postal te di?', withZip('Español'));
  check('9d ES "código postal" recall echoes 10001', /10001/.test(esCp.response));
  // Negative — service-area question must NOT echo the stored ZIP.
  const neg = processMessage('What zip codes do you serve?', withZip('English'));
  check('9e negative: "what zip codes do you serve" does NOT echo recall', !/you gave me the zip 10001/i.test(neg.response));
}

console.log(`\n═════════════════════════════════════════`);
console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL > 0 ? 1 : 0);

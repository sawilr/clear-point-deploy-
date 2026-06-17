/* eslint-disable no-console */
// Sawil 2026-06-17 — Clara DUAL-ELIGIBLE Medicare-reasoning QA.
// Drives processMessageAsync (deterministic structural-first owns dual-eligible,
// so NO LLM is hit for these inputs). Verifies the mission acceptance criteria.
// Run: npx tsx scripts/clara-dual-qa.ts
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';

type Any = any;
let PASS = 0, FAIL = 0; const fails: string[] = [];
function check(label: string, cond: boolean, detail = '') {
  if (cond) { PASS++; console.log(`   ✅ ${label}`); }
  else { FAIL++; fails.push(label); console.log(`   ❌ ${label}${detail ? '  — ' + detail : ''}`); }
}

// Asking "do you (also) have Extra Help?" — the forbidden pattern.
const ASKS_EXTRA_HELP = (s: string) =>
  /(¿\s*(tiene|tienes|cuenta con|ya tiene)[^?]*\b(extra help|ayuda extra)\b[^?]*\?)/i.test(s)
  || /\bdo you (also )?have\b[^?]*\bextra help\b/i.test(s)
  || /\bhave extra help\?/i.test(s);
const MENTIONS_EXTRA_HELP = (s: string) => /(extra help|ayuda extra)/i.test(s);
const SAYS_DONT_PAY = (s: string) => /(no .*(la )?pague.*todav|no le recomiendo pagar|don'?t pay .*yet|do not pay .*yet|antes de (que )?pag|before you pay|before paying)/i.test(s);
const ASKS_BILL_SOURCE = (s: string) => /(doctor|hospital).{0,40}(farmacia|pharmacy|laboratorio|lab|ambulanc|plan)/i.test(s);
const MENTIONS_PROTECTION = (s: string) => /(qmb|protecc|protection|cubiert|covered|no .*deber[ií]an cobr|should not .*bill|reduc|eliminan|remove)/i.test(s);
const ASKS_ADVISOR = (s: string) => /(asesor|advisor)/i.test(s);
const ONE_QUESTION = (s: string) => (s.match(/\?/g) || []).length <= 1;
const NO_SENSITIVE_REQ = (s: string) => !/(d[eé]me|env[ií]e|comparta|cu[aá]l es su|what'?s your|provide your|give me your)[^.?!]{0,30}(seguro social|social security|ssn|n[uú]mero de medicare|medicare number|mbi)/i.test(s);
const isSpanishReply = (s: string) => /[ñ¿¡áéíóú]|gracias|factura|usted|tiene|asesor/i.test(s) && !/\bthank you\b|\byou have\b/i.test(s);
const isEnglishReply = (s: string) => /\b(the|you|your|bill|thank you|advisor|please)\b/i.test(s);

async function convo(lang: 'es' | 'en', seedMsgs: string[], turns: string[], seedPatch: Any = {}) {
  let st: Any = {
    ...createInitialState(),
    language: lang, zipCode: '11122', state: 'NY', zipCodeIsValid: true,
    step: 'conversation',
    messages: seedMsgs.map((c, i) => ({ role: i % 2 === 0 ? 'user' : 'bot', content: c, timestamp: Date.now() })),
    ...seedPatch,
  };
  const out: Any[] = [];
  for (const t of turns) {
    st.messages = [...(st.messages || []), { role: 'user', content: t, timestamp: Date.now() }];
    const r = await processMessageAsync(t, st);
    st = r.newState;
    out.push(r);
  }
  return { last: out[out.length - 1], all: out, st };
}

(async () => {
  // ───────── GROUP A — Dual-eligible inference ─────────
  {
    const { last } = await convo('es', [], ['Tengo Medicaid y Medicare.']);
    console.log(`\nA1 ES "Tengo Medicaid y Medicare."\n   → ${last.response.slice(0,120)}`);
    check('A1 infers dual + extra help, does NOT ask Extra Help', !ASKS_EXTRA_HELP(last.response) && MENTIONS_EXTRA_HELP(last.response));
    check('A1 dualEligible+extraHelpInferred set', last.newState.dualEligible === true && last.newState.extraHelpInferred === true);
    check('A1 one question, Spanish', ONE_QUESTION(last.response) && isSpanishReply(last.response));
  }
  {
    const { last } = await convo('en', [], ['I have both Medicare and Medicaid.']);
    console.log(`\nA2 EN "I have both Medicare and Medicaid."\n   → ${last.response.slice(0,120)}`);
    check('A2 infers dual + extra help, does NOT ask Extra Help', !ASKS_EXTRA_HELP(last.response) && MENTIONS_EXTRA_HELP(last.response));
    check('A2 English reply', isEnglishReply(last.response));
  }
  {
    // context: prior turn discussed Medicare/Medicaid → "tengo los dos"
    const { last } = await convo('es', ['¿Tiene Medicare o Medicaid?', 'Para orientarle…'], ['Tengo los dos.']);
    check('A3 "tengo los dos" infers dual from context, no restart', last.newState.dualEligible === true && !ASKS_EXTRA_HELP(last.response));
  }

  // ───────── GROUP B — Billing + dual-eligible ─────────
  {
    const { last } = await convo('es', [], ['Me llegaron facturas y tengo Medicaid y Medicare.']);
    console.log(`\nB4 ES bill + dual\n   → ${last.response.slice(0,160)}`);
    check('B4 no Extra Help question', !ASKS_EXTRA_HELP(last.response));
    check('B4 mentions protections', MENTIONS_PROTECTION(last.response));
    check('B4 says don\'t pay yet', SAYS_DONT_PAY(last.response));
    check('B4 asks bill source', ASKS_BILL_SOURCE(last.response));
    check('B4 one question', ONE_QUESTION(last.response));
  }
  {
    const { last } = await convo('en', [], ['I got a hospital bill and I have Medicare and Medicaid.']);
    console.log(`\nB5 EN hospital bill + dual\n   → ${last.response.slice(0,160)}`);
    check('B5 QMB/MSP reasoning, no "pay it"', MENTIONS_PROTECTION(last.response) && SAYS_DONT_PAY(last.response));
    check('B5 asks source + advisor available, one question', ASKS_BILL_SOURCE(last.response) && ONE_QUESTION(last.response));
  }
  {
    const { last } = await convo('es', [], ['Me cobraron copago en el doctor pero tengo Medicaid.']);
    check('B6 copay+medicaid → protection + bill triage', !ASKS_EXTRA_HELP(last.response) && (MENTIONS_PROTECTION(last.response) || ASKS_BILL_SOURCE(last.response)));
  }

  // ───────── GROUP C — QMB explicit ─────────
  {
    const { last } = await convo('es', [], ['Tengo QMB y me llegó una factura del doctor.']);
    console.log(`\nC7 ES QMB + doctor bill\n   → ${last.response.slice(0,160)}`);
    check('C7 QMB billing protection, conditional', /qmb/i.test(last.response) && SAYS_DONT_PAY(last.response));
    check('C7 no sensitive data request', NO_SENSITIVE_REQ(last.response));
    check('C7 possibleQMB flag set', last.newState.possibleQMB === true);
  }
  {
    const { last } = await convo('en', [], ['I\'m QMB and the hospital billed me.']);
    check('C8 EN QMB protection + escalate', /qmb/i.test(last.response) && SAYS_DONT_PAY(last.response));
  }

  // ───────── GROUP D — Extra Help explicit ─────────
  {
    const { last } = await convo('es', [], ['Tengo Extra Help y Medicaid.']);
    console.log(`\nD9 ES extra help + medicaid\n   → ${last.response.slice(0,120)}`);
    check('D9 acknowledges, does NOT re-ask Extra Help', !ASKS_EXTRA_HELP(last.response));
  }
  {
    const { last } = await convo('en', [], ['I have Extra Help, why did pharmacy charge me?'], { dualEligible: true, hasMedicaid: true });
    check('D10 EN pharmacy workflow (not medical-bill)', /pharmacy|prior auth|covered|formulary|price/i.test(last.response) && !ASKS_EXTRA_HELP(last.response));
  }

  // ───────── GROUP E — Correction / frustration ─────────
  {
    const { last } = await convo('es', ['Me llegaron facturas y tengo Medicaid y Medicare.', 'Entiendo…'], ['No sabes lo que hablas.'], { dualEligible: true, hasMedicaid: true });
    console.log(`\nE11 ES "no sabes lo que hablas"\n   → ${last.response.slice(0,160)}`);
    check('E11 apologizes + restates + asks source, no restart', /(disculp|raz[oó]n)/i.test(last.response) && ASKS_BILL_SOURCE(last.response) && !ASKS_EXTRA_HELP(last.response));
  }
  {
    const { last } = await convo('es', ['Tengo los dos', 'Anotado…'], ['Ya te dije que tengo los dos.'], { dualEligible: true, hasMedicaid: true });
    check('E12 "ya te dije" no repeated question, keeps dual', last.newState.dualEligible === true && !ASKS_EXTRA_HELP(last.response));
  }

  // ───────── GROUP F — Privacy ─────────
  {
    const { last } = await convo('es', [], ['Te mando mi número de Medicare 1EG4-TE5-MK72.']);
    console.log(`\nF14 ES sends Medicare number\n   → ${last.response.slice(0,120)}`);
    check('F14 refuses/warns sensitive data', /(no env[ií]e|no comparta|por su seguridad|no .*(medicare|seguro social)|do not (send|share))/i.test(last.response));
  }

  // ───────── GROUP G — Licensed advice boundary ─────────
  {
    const { last } = await convo('es', ['Tengo Medicaid y Medicare.', 'Gracias…'], ['Entonces dime cuál plan me conviene.'], { dualEligible: true, hasMedicaid: true });
    check('G16 no specific plan rec → advisor', !/le recomiendo el plan|recommend the .* plan|el mejor plan es/i.test(last.response) && ASKS_ADVISOR(last.response));
  }

  // ───────── GROUP H — ZIP context ─────────
  {
    const { last } = await convo('es', [], ['Me llegaron facturas y tengo Medicaid y Medicare.']);
    check('H18 does not re-ask ZIP (already 11122)', !/c[oó]digo postal|zip\b/i.test(last.response));
  }

  // ───────── GROUP I — Language ─────────
  {
    const { last } = await convo('es', [], ['Tengo Medicaid y Medicare.']);
    check('I20 Spanish stays Spanish', isSpanishReply(last.response));
    const { last: l2 } = await convo('en', [], ['I have Medicare and Medicaid.']);
    check('I21 English stays English', isEnglishReply(l2.response));
  }

  // ───────── BILL-SOURCE FOLLOW-UP (multi-turn) ─────────
  {
    const { last } = await convo('es', [], ['Tengo Medicaid y Medicare y me llegaron facturas.', 'Es del hospital.']);
    console.log(`\nFOLLOWUP ES dual bill → "del hospital"\n   → ${last.response.slice(0,160)}`);
    check('FU advisor escalation after source, don\'t pay', ASKS_ADVISOR(last.response) && last.newState.dualFlowStage === 'offered_advisor');
  }

  console.log(`\n═════════════════════════════════════════`);
  console.log(`TOTAL: ${PASS} PASS / ${FAIL} FAIL`);
  if (FAIL) console.log('FAILS: ' + fails.join(' | '));
  process.exit(FAIL > 0 ? 1 : 0);
})();

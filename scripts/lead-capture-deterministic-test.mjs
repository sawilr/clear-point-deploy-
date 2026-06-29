// Sawil 2026-06-28 — proves the deterministic contact collector.
//  1) the LLM can NO LONGER bypass it (gate returns non-null on an
//     llm_response turn while name/phone are missing),
//  2) name and phone are asked in SEPARATE turns (never together),
//  3) a foreign/fake phone (829 Dominican) is rejected,
//  4) a final "is everything correct?" confirmation is REQUIRED before submit,
//  5) "no" lets the caller correct ONE field, then re-confirms.
// Tests EN, ES, and Spanglish, driving the real engine (processMessage +
// _runStructuralFirst). No LLM/network — the whole point is the deterministic path.
import { processMessage, _runStructuralFirst } from '../src/lib/customerServiceEngine.ts';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ::  ' + extra : ''}`);
  if (cond) pass++; else fail++;
};

const baseState = (lang) => ({
  step: 'chatting', language: lang, messages: [], turnCount: 3,
  zipCode: '10001', state: 'NY',
});

// Drive one user turn through the SYNC engine (what the gate routes to).
function turn(state, msg) {
  const r = processMessage(msg, state);
  return { resp: r.response, st: r.newState, needsHuman: r.needsHuman };
}

// ── PROOF 1: the LLM can no longer bypass the collector ──────────────────────
// Simulate the exact bug: handoff active, last turn was an LLM response
// (lastBotIntent='llm_response'), name+phone still missing. The OLD gate let the
// LLM keep driving; the fix must hand this to the deterministic collector.
{
  const bypassState = {
    ...baseState('es'), advisorHandoffStarted: true, needsHuman: true,
    lastBotIntent: 'llm_response', name: '', phoneNumber: '',
  };
  const res = _runStructuralFirst('Mario 8295632553', bypassState);
  ok('GATE: llm_response turn w/ missing contact is intercepted (not handed to LLM)', res !== null);
  // And the 829 number must NOT have been accepted.
  ok('GATE: Dominican 829 phone NOT stored on the intercepted turn',
     !!res && res.newState.phoneNumber !== '8295632553',
     `phoneNumber="${res?.newState?.phoneNumber || ''}"`);

  // Control: once name+phone ARE captured, an llm_response turn is NOT force-
  // intercepted (preserves paused Q&A / LLM continuation).
  const captured = {
    ...baseState('es'), advisorHandoffStarted: true, needsHuman: true,
    lastBotIntent: 'llm_response', name: 'Mario Reyes', phoneNumber: '3475551234',
  };
  ok('GATE: after name+phone captured, llm_response turn is left to the LLM',
     _runStructuralFirst('what is part b?', captured) === null);
}

// ── PROOF 2-5: full progressive flow per language ────────────────────────────
function runFlow(lang, data) {
  console.log(`\n--- ${lang.toUpperCase()} flow ---`);
  // Start: handoff just started, bot asked for the NAME only.
  let st = {
    ...baseState(lang), advisorHandoffStarted: true, needsHuman: true,
    lastBotIntent: 'handoff_asking_name', name: '', phoneNumber: '',
    messages: [{ role: 'bot', content: 'name?', timestamp: 1 }],
  };

  // Turn: give the name only.
  let t = turn(st, data.name); st = t.st;
  const askedPhone = /phone|tel[eé]fono|n[uú]mero/i.test(t.resp);
  const askedNameAndPhoneTogether = /(name|nombre)[^.?!]{0,40}(phone|tel[eé]fono|n[uú]mero)/i.test(t.resp);
  ok(`${lang}: after name, bot asks for PHONE`, askedPhone, t.resp.slice(0, 80));
  ok(`${lang}: bot did NOT ask name+phone together`, !askedNameAndPhoneTogether);
  ok(`${lang}: name stored`, !!st.name, `name="${st.name}"`);
  ok(`${lang}: phone NOT yet stored (separate steps)`, !st.phoneNumber);

  // Turn: give a FOREIGN/FAKE phone first → must be rejected.
  t = turn(st, data.badPhone); st = t.st;
  ok(`${lang}: foreign/fake phone "${data.badPhone}" REJECTED`,
     !st.phoneNumber, `phoneNumber="${st.phoneNumber || ''}"`);
  ok(`${lang}: bot re-asks for a valid phone`, /tel[eé]fono|phone|n[uú]mero|d[ií]gitos|digits|valid/i.test(t.resp), t.resp.slice(0, 80));

  // Turn: give a VALID US phone.
  t = turn(st, data.goodPhone); st = t.st;
  ok(`${lang}: valid US phone accepted`, !!st.phoneNumber, `phoneNumber="${st.phoneNumber || ''}"`);

  // Walk remaining collection turns until we hit the confirmation gate or submit.
  // Provide best-time, topic, email, "anything else? no" as the bot asks.
  const answers = [data.bestTime, data.topic, data.email, data.no, data.no, data.no];
  let guard = 0, sawConfirm = false, sawSummary = false, submittedEarly = false;
  while (guard < 10) {
    guard++;
    // If a submit already fired before any confirmation → fail hard.
    if (st.soaPending && !sawConfirm) { submittedEarly = true; break; }
    // Detect the confirmation prompt.
    if (/¿está todo correcto\?|is everything correct\?/i.test(t.resp)) {
      sawConfirm = true;
      sawSummary = new RegExp(`${data.name.split(' ')[0]}`, 'i').test(t.resp)
        && /(tel[eé]fono|phone)/i.test(t.resp);
      break;
    }
    const a = answers[Math.min(guard - 1, answers.length - 1)];
    t = turn(st, a); st = t.st;
  }
  ok(`${lang}: a confirmation gate ("is everything correct?") appeared`, sawConfirm);
  ok(`${lang}: NO submit before confirmation`, !submittedEarly);
  ok(`${lang}: summary shows name + phone`, sawSummary, t.resp.replace(/\n/g, ' | ').slice(0, 160));
  ok(`${lang}: soaPending NOT set before confirm`, !st.soaPending);

  // Turn: say "NO" → must ask which field, NOT submit.
  t = turn(st, data.no); st = t.st;
  ok(`${lang}: "no" → asks which field to correct (no submit)`,
     /corregir|fix|nombre|name|tel[eé]fono|phone|correo|email/i.test(t.resp) && !st.soaPending,
     t.resp.slice(0, 90));

  // Turn: choose to fix the PHONE.
  t = turn(st, lang === 'es' ? 'el teléfono' : 'the phone'); st = t.st;
  ok(`${lang}: correcting phone clears it & re-asks`, !st.phoneNumber, t.resp.slice(0, 80));

  // Turn: give a new valid phone.
  t = turn(st, data.goodPhone2); st = t.st;
  ok(`${lang}: new valid phone accepted`, !!st.phoneNumber, `phoneNumber="${st.phoneNumber}"`);

  // After the correction, the confirmation re-appears with the NEW phone.
  const _fmtNew = `${st.phoneNumber.slice(0, 3)}-${st.phoneNumber.slice(3, 6)}-${st.phoneNumber.slice(6)}`;
  ok(`${lang}: re-confirmation appears after correction (new phone)`,
     /¿está todo correcto\?|is everything correct\?/i.test(t.resp) && t.resp.includes(_fmtNew),
     t.resp.replace(/\n/g, ' | ').slice(0, 120));
  ok(`${lang}: still NOT submitted during correction`, !st.soaPending);

  // Turn: say "YES" → CONFIRMED. New order: asks "anything else?" AFTER confirm,
  // not yet submitted.
  t = turn(st, data.yes); st = t.st;
  ok(`${lang}: "yes" → contactConfirmed set`, st.contactConfirmed === true);
  ok(`${lang}: confirmation happens BEFORE "anything else?" (asked only after yes)`,
     /algo m[aá]s|anything else/i.test(t.resp) && !st.soaPending, t.resp.slice(0, 80));

  // Turn: "no" to anything-else → close + submit signal, confirmation intact.
  t = turn(st, data.no); st = t.st;
  ok(`${lang}: final "no" → submit signalled (soaPending + captured) WITH confirmation`,
     st.soaPending === true && st.lastBotIntent === 'handoff_captured_contact' && st.contactConfirmed === true,
     `soaPending=${st.soaPending} intent=${st.lastBotIntent} confirmed=${st.contactConfirmed}`);
  ok(`${lang}: needsHuman true at submit`, t.needsHuman === true);
}

// ── Maria Rojas regression: a QUESTION at "anything else?" must NOT skip or lose
//    the confirmation. Live bug: she asked "¿cuándo me llaman?" there, the LLM
//    closed, and the lead submitted WITHOUT confirmation. ──
function runDivert(lang, d) {
  let st = {
    ...baseState(lang), advisorHandoffStarted: true, needsHuman: true,
    lastBotIntent: 'handoff_asking_name', name: '', phoneNumber: '',
    messages: [{ role: 'bot', content: 'name?', timestamp: 1 }],
  };
  let t;
  t = turn(st, d.name); st = t.st;
  t = turn(st, d.goodPhone); st = t.st;
  t = turn(st, d.bestTime); st = t.st;
  t = turn(st, d.topic); st = t.st;
  t = turn(st, d.email); st = t.st;
  ok(`${lang}/divert: confirmation shown right after email, BEFORE any "anything else?"`,
     /¿está todo correcto\?|is everything correct\?/i.test(t.resp) && !/algo m[aá]s|anything else/i.test(t.resp),
     t.resp.replace(/\n/g, ' | ').slice(0, 110));
  ok(`${lang}/divert: not yet confirmed/submitted at the summary`, !st.contactConfirmed && !st.soaPending);
  t = turn(st, d.yes); st = t.st;
  ok(`${lang}/divert: yes → confirmed + asks "anything else?"`,
     st.contactConfirmed === true && /algo m[aá]s|anything else/i.test(t.resp));
  // The Maria move — a question instead of "no".
  t = turn(st, lang === 'es' ? '¿cuándo me llaman?' : 'when will you call me?'); st = t.st;
  ok(`${lang}/divert: question at "anything else?" PRESERVES confirmation (not reset)`,
     st.contactConfirmed === true, `confirmed=${st.contactConfirmed}`);
}

runFlow('en', {
  name: 'Mario Reyes', badPhone: '829-563-2553', goodPhone: '347-852-2553',
  goodPhone2: '646-333-4455', bestTime: 'after 3 pm', topic: 'a bill I got',
  email: 'mario.reyes@gmail.com', no: 'no', yes: 'yes',
});
runFlow('es', {
  name: 'Ana López', badPhone: '8295632553', goodPhone: '3478522553',
  goodPhone2: '6463334455', bestTime: 'por la mañana', topic: 'una factura',
  email: 'ana.lopez@gmail.com', no: 'no', yes: 'sí',
});
// Spanglish: ES engine, mixed user phrasing.
runFlow('es', {
  name: 'Carlos Gomez', badPhone: '809-377-0100', goodPhone: '212-388-0188',
  goodPhone2: '718 444 5566', bestTime: 'tomorrow afternoon', topic: 'mi plan coverage',
  email: 'carlos.g@outlook.com', no: 'no', yes: 'yes',
});

runDivert('en', { name: 'Maria Rojas', goodPhone: '212-639-5620', bestTime: 'after 11 am', topic: 'medications', email: 'maria.r@yahoo.com', yes: 'yes' });
runDivert('es', { name: 'Maria Rojas', goodPhone: '2126395620', bestTime: 'despues de las 11', topic: 'los medicamentos', email: 'maria.r@yahoo.com', yes: 'sí' });

console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

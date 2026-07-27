// AUDIT 2026-07-27 — regression tests for the 4 confirmed chatbot bugs
// (external audit with live transcripts) + supporting code-level pieces.
// Run: npx tsx scripts/test-audit-regressions.mjs
//
// Deterministic unit tests only — no live LLM. Covers:
//   BUG 1  date math       — extractBirthDate / computeAgeInfo / grounding note
//                            + compliance-filter past-year "turning 65" rewrite
//   BUG 2  health guard    — classifyHealthDisclosure / scrub redaction /
//                            once-per-conversation soft note (engine)
//   BUG 3  escalation      — detectHumanEscalation + terminal structural routing
//   BUG 4  invented causes — compliance-filter neutral rewrite + Spanish SEP
//          + language mirroring (server + client per-message detection)
//
// RE-AUDIT 2026-07-27 — residual findings:
//   F1  unstated assumptions — filter rule 7 rewrites coverage-type / plan-letter
//       assertions the USER never mentioned; leaves them alone when they did
//   F2  topic humanizer      — internal slugs (medical_emergency_911) never
//       surface; every serviceCategory maps to a bilingual phrase
//   F3  (visual, verified via 320x568 browser measurement — not unit-testable)
//   F4  absolute claims gone from src/ + DOB message gets the one-time privacy
//       note while age grounding stays intact

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBirthDate, computeAgeInfo, buildAgeGroundingNote, redactBirthDate } from '../api/_lib/date-grounding.js';
import { complianceFilter } from '../api/_lib/compliance-filter.js';
import { detectMessageLang } from '../api/_lib/lang-detect.js';
import { classifyHealthDisclosure, scrubSensitiveText, scrubHealthDisclosures } from '../src/lib/phiPatterns.ts';
import { humanizeTopic, returningVisitorGreeting } from '../src/lib/persistentMemory.ts';
import {
  detectHumanEscalation,
  detectProblemType,
  _runStructuralFirst,
  _turnLanguage,
  processMessageAsync,
  createInitialState,
} from '../src/lib/customerServiceEngine.ts';

const NOW = new Date('2026-07-27T12:00:00Z');
let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push({ name, detail: detail || '' });
}

// Mid-conversation engine state (language locked, past intake).
function midState(lang) {
  return { ...createInitialState(), language: lang, step: 'conversation' };
}

// ── BUG 1 — DATE MATH ───────────────────────────────────────────────────────
{
  // Audit input: "My date of birth is January 1, 1950" → Clara said
  // "you're turning 65 in January 2015" as an upcoming event.
  const bd = extractBirthDate('My date of birth is January 1, 1950', NOW);
  check('B1 extract EN full date', !!bd && bd.y === 1950 && bd.mo === 1 && bd.d === 1, JSON.stringify(bd));
  const info = bd && computeAgeInfo(bd, NOW);
  check('B1 age 76', info && info.age === 76, JSON.stringify(info));
  check('B1 turned 65 in 2015 past', info && info.turned65Year === 2015 && info.turned65IsPast === true, JSON.stringify(info));
  const note = bd && buildAgeGroundingNote(bd, NOW);
  check('B1 note has age + past', /76 years old/.test(note) && /turned 65 in 2015, which is in the PAST/.test(note), note);
  check('B1 redact DOB', redactBirthDate('My date of birth is January 1, 1950', bd) === 'My date of birth is [date of birth]');

  const bdEs = extractBirthDate('Nací el 3 de marzo de 1958', NOW);
  check('B1 extract ES date', !!bdEs && bdEs.y === 1958 && bdEs.mo === 3 && bdEs.d === 3, JSON.stringify(bdEs));
  const infoEs = bdEs && computeAgeInfo(bdEs, NOW);
  check('B1 ES age 68', infoEs && infoEs.age === 68, JSON.stringify(infoEs));

  const bdFuture = extractBirthDate('I was born in 1962', NOW);
  const infoFuture = bdFuture && computeAgeInfo(bdFuture, NOW);
  check('B1 future turner', infoFuture && infoFuture.turned65Year === 2027 && infoFuture.turned65IsPast === false, JSON.stringify(infoFuture));

  // A date WITHOUT birth context must never be treated as a DOB.
  check('B1 no context = null', extractBirthDate('I enrolled on January 1, 2020', NOW) === null);

  // Compliance-filter backstop: future-tense turning-65 claim with a PAST year.
  const en = complianceFilter("You're turning 65 in January 2015 — your Initial Enrollment Period would have been back in 2014 or 2015.", 'en', { now: NOW });
  check('B1 filter EN rewrites', /already turned 65/.test(en.text) && !/turning 65 in January 2015/.test(en.text), en.text);
  check('B1 filter EN violation tag', en.violations.some((v) => v.startsWith('turning_65_past_year')), en.violations.join(','));
  const es = complianceFilter('Usted cumple 65 en enero de 2015, así que pronto empieza su período inicial.', 'es', { now: NOW });
  check('B1 filter ES rewrites', /ya cumplió los 65/.test(es.text) && !/cumple 65 en enero de 2015/.test(es.text), es.text);
  // Correct past-tense statements must survive untouched.
  const past = complianceFilter('You turned 65 in 2015, so your Initial Enrollment Period is in the past.', 'en', { now: NOW });
  check('B1 filter keeps past tense', past.violations.length === 0, past.text);
  // Current-year claims are fine.
  const cur = complianceFilter('You are turning 65 in October 2026, so your window is opening soon.', 'en', { now: NOW });
  check('B1 filter keeps current year', cur.violations.length === 0, cur.text);
}

// ── BUG 2 — HEALTH-DISCLOSURE SOFT GUARD ────────────────────────────────────
{
  check('B2 classify meds', classifyHealthDisclosure('I take metformin and lisinopril, will they be covered?')?.type === 'medication');
  check('B2 classify meds ES', classifyHealthDisclosure('Tomo metformina y losartán todos los días')?.type === 'medication');
  check('B2 classify diagnosis', classifyHealthDisclosure('I was diagnosed with diabetes last year, can plans deny me?')?.type === 'diagnosis');
  check('B2 classify diagnosis ES', classifyHealthDisclosure('Me diagnosticaron cáncer el año pasado')?.type === 'diagnosis');
  check('B2 classify doctor', classifyHealthDisclosure('My doctor is Dr. Example, is he in network?')?.type === 'doctor_name');
  check('B2 classify DOB', classifyHealthDisclosure('My date of birth is January 1, 1950')?.type === 'birth_date');
  // Education questions are NOT disclosures.
  check('B2 education question null', classifyHealthDisclosure('Does Medicare cover insulin?') === null);
  check('B2 born-in-place null', classifyHealthDisclosure('I was born in Puerto Rico') === null);

  // Scrub placeholders (LLM history / lead notes path).
  const s1 = scrubSensitiveText('I take metformin and lisinopril every day');
  check('B2 scrub meds', s1.includes('[medication]') && !/metformin|lisinopril/i.test(s1), s1);
  const s2 = scrubSensitiveText('I was diagnosed with diabetes');
  check('B2 scrub diagnosis', s2.includes('[health condition]') && !/diabetes/i.test(s2), s2);
  const s3 = scrubSensitiveText('My doctor is Dr. Example');
  check('B2 scrub doctor name', s3.includes('[doctor name]') && !/Example/.test(s3), s3);
  const s4 = scrubSensitiveText('My date of birth is January 1, 1950');
  check('B2 scrub DOB', s4.includes('[date of birth]') && !/1950/.test(s4), s4);
  // Outbound-message variant keeps the DOB for server-side age grounding.
  const s5 = scrubHealthDisclosures('My date of birth is January 1, 1950 and I take metformin', { includeBirthDates: false });
  check('B2 outbound keeps DOB, drops med', /January 1, 1950/.test(s5) && /\[medication\]/.test(s5) && !/metformin/i.test(s5), s5);
  // Hard tier untouched.
  check('B2 SSN still redacted', scrubSensitiveText('my ssn is 123-45-6789').includes('[REDACTED-SSN]'));

  // Engine: soft note fires EXACTLY once, in the user's message language.
  const r1 = await processMessageAsync('I take metformin and lisinopril, will they be covered?', midState('en'));
  check('B2 note EN once', /don't need to share medication or health details/.test(r1.response), r1.response);
  check('B2 note flag set', r1.newState.healthDisclosureNoted === true);
  check('B2 note never echoes meds', !/metformin|lisinopril/i.test(r1.response), r1.response);
  const r1es = await processMessageAsync('Me diagnosticaron diabetes, ¿me pueden negar un plan?', midState('es'));
  check('B2 note ES', /no necesita compartir medicamentos/.test(r1es.response), r1es.response);
  // Second disclosure: no repeat nag (falls through to normal flow).
  const r2 = await processMessageAsync('I also take atorvastatin', { ...r1.newState });
  check('B2 no second nag', !/don't need to share medication or health details/.test(r2.response), r2.response);
}

// ── BUG 3 — TERMINAL HUMAN ESCALATION ───────────────────────────────────────
{
  const wants = [
    'Quiero hablar con Sawil.',
    'Talk to Sawil please',
    'quiero un humano',
    'I want to speak with a human advisor',
    'I need a human now',
    'necesito una persona real',
    'I am angry and stuck in a loop',
    'me tienen dando vueltas',
  ];
  for (const t of wants) check('B3 detect: ' + t, detectHumanEscalation(t) === true);
  check('B3 not on normal q', detectHumanEscalation('how much is the Part B premium?') === false);
  check('B3 not on doctor issue', detectHumanEscalation('mi doctor no acepta el plan') === false);
  check('B3 problemType advisor', detectProblemType('Quiero hablar con Sawil.') === 'advisor');

  // Structural routing: IMMEDIATE handoff, acknowledged, in the USER'S
  // language, no triage question ("¿es sobre una factura...?" was the bug).
  const es = _runStructuralFirst('Quiero hablar con Sawil.', midState('es'));
  check('B3 ES terminal', !!es && es.newState.advisorHandoffStarted === true, es && es.response);
  check('B3 ES ack Sawil', !!es && /Con gusto — le conecto con Sawil\./.test(es.response), es && es.response);
  check('B3 ES asks name (rich handoff intact)', !!es && /su nombre/.test(es.response) && es.newState.lastBotIntent === 'handoff_asking_name', es && es.response);
  check('B3 ES no triage', !!es && !/factura|doctor|medicamentos.*\?/.test(es.response), es && es.response);

  // Angry loop, English mid-conversation (even if the session was Spanish,
  // the LATEST message is English → English reply, BUG 4b).
  const en = _runStructuralFirst('I am angry and I am stuck in a loop, I need a human now', midState('es'));
  check('B3 EN terminal', !!en && en.newState.advisorHandoffStarted === true, en && en.response);
  check('B3 EN ack mirrored', !!en && /let me connect you with a licensed advisor/i.test(en.response), en && en.response);
}

// ── BUG 4 — INVENTED CAUSES + SPANISH SEP + LANGUAGE MIRRORING ─────────────
{
  // (a) invented causal generalization → neutral rewrite. Audit transcript
  // (EN reply to the "mediko" message).
  const enCause = complianceFilter("When a doctor says that, it's almost always because the provider may be leaving the plan's network.", 'en', { now: NOW });
  check('B4 EN cause rewritten', /don't want to assume the reason/.test(enCause.text) && !/almost always because/.test(enCause.text), enCause.text);
  check('B4 cause violation tag', enCause.violations.includes('invented_cause_generalization'), enCause.violations.join(','));
  const esCause = complianceFilter('Cuando un doctor dice eso, casi siempre es porque el proveedor va a salir de la red del plan.', 'es', { now: NOW });
  check('B4 ES cause rewritten', /No quiero asumir el motivo/.test(esCause.text) && !/casi siempre es porque/.test(esCause.text), esCause.text);

  // (a2) Spanish SEP hedged-likelihood claims → SEP safe rewrite.
  const sepEs = complianceFilter('Es muy probable que usted califique para un Período Especial de inscripción.', 'es', { now: NOW });
  check('B4 ES SEP hedged rewritten', /no quiero asumir que existe un Periodo Especial/i.test(sepEs.text), sepEs.text);
  check('B4 ES SEP violation', sepEs.violations.some((v) => v.startsWith('sep_claim')), sepEs.violations.join(','));
  const sepEn = complianceFilter('You most likely qualify for a Special Enrollment Period to switch now.', 'en', { now: NOW });
  check('B4 EN SEP hedged rewritten', /don'?t want to assume a Special Enrollment/i.test(sepEn.text), sepEn.text);
  // Verification framing stays allowed.
  const sepOk = complianceFilter('Primero habría que verificar si le aplica un Período Especial según su situación.', 'es', { now: NOW });
  check('B4 SEP verification allowed', sepOk.violations.length === 0, sepOk.violations.join(','));

  // (b) language mirroring — server-side detector (typos included).
  check('B4 lang ES typos', detectMessageLang('Mi mediko no asepta el plan, ke ago?') === 'es');
  check('B4 lang EN', detectMessageLang('My doctor does not accept my plan, what do I do?') === 'en');
  check('B4 lang weak null', detectMessageLang('ok') === null);
  // Client-side per-message language for deterministic templates.
  check('B4 turnLang mirrors ES', _turnLanguage('Mi mediko no asepta el plan, ke ago?', midState('en')) === 'es');
  check('B4 turnLang mirrors EN', _turnLanguage('My doctor does not accept my plan, what should I do?', midState('es')) === 'en');
  check('B4 turnLang falls back to session', _turnLanguage('ok', midState('es')) === 'es');
}

// ── F1 — UNSTATED-ASSUMPTION REWRITE (filter rule 7) ────────────────────────
{
  // Re-audit transcript: caller "Mi mediko no asepta el plan. Por que paso y
  // puedo cambiar hoy?" → Clara mentioned "su plan Medigap" (never said).
  const u1 = 'Mi mediko no asepta el plan. Por que paso y puedo cambiar hoy?';
  const mg = complianceFilter('Entiendo su preocupación. Eso puede pasar con su plan Medigap. Le explico las opciones que tiene.', 'es', { now: NOW, userText: u1 });
  check('F1 ES Medigap rewritten', !/medigap/i.test(mg.text), mg.text);
  check('F1 ES neutral question', /¿Qué le dijo exactamente el consultorio\?/.test(mg.text), mg.text);
  check('F1 ES violation tag', mg.violations.includes('unstated_assumption:medigap'), mg.violations.join(','));

  const mgEn = complianceFilter("You don't have to leave your Medigap plan blindly — let's review it.", 'en', { now: NOW, userText: 'My doctor no longer accepts my plan, why did this happen?' });
  check('F1 EN Medigap rewritten', !/medigap/i.test(mgEn.text) && /What exactly did the office tell you\?/.test(mgEn.text), mgEn.text);

  // Re-audit transcript: "Mi medico ya no acepta el plan" → "Eso suena a una
  // carta del plan..." (no letter was ever mentioned).
  const lt = complianceFilter('Eso suena a una carta del plan. ¿Puede revisar si le llegó algo por correo?', 'es', { now: NOW, userText: 'Mi medico ya no acepta el plan' });
  check('F1 ES letter rewritten', !/suena a una carta/i.test(lt.text), lt.text);
  check('F1 ES letter violation', lt.violations.includes('unstated_assumption:plan_letter'), lt.violations.join(','));
  const ltEn = complianceFilter('That sounds like a letter from your plan about network changes.', 'en', { now: NOW, userText: 'My doctor no longer accepts my plan' });
  check('F1 EN letter rewritten', !/sounds like a letter/i.test(ltEn.text) && /Did you receive any document or message from your plan\?/.test(ltEn.text), ltEn.text);

  // Network departure never stated by the user.
  const nw = complianceFilter('Your doctor is leaving the network, so you may need to switch.', 'en', { now: NOW, userText: 'my doctor stopped accepting my plan' });
  check('F1 EN network rewritten', !/leaving the network/i.test(nw.text), nw.text);
  check('F1 network violation', nw.violations.includes('unstated_assumption:network_departure'), nw.violations.join(','));

  // WHITELIST: the user DID say the term → reply untouched.
  const wl = complianceFilter('Entiendo, con su plan Medigap ese cambio funciona distinto.', 'es', { now: NOW, userText: 'Tengo un plan Medigap y mi médico ya no lo acepta' });
  check('F1 whitelist Medigap kept', /su plan Medigap/.test(wl.text), wl.text);
  check('F1 whitelist no violation', !wl.violations.some((v) => v.startsWith('unstated_assumption')), wl.violations.join(','));
  const wlLt = complianceFilter('Sobre la carta del plan que mencionó: revísela con calma.', 'es', { now: NOW, userText: 'Me llegó una carta del plan y no la entiendo' });
  check('F1 whitelist letter kept', /carta del plan/.test(wlLt.text), wlLt.text);

  // The SANCTIONED coverage-clarifying question must never be rewritten.
  const ok = complianceFilter('Para orientarle correctamente, ¿sabe si actualmente tiene un plan Medicare Advantage, Medicare Original, o no está seguro?', 'es', { now: NOW, userText: 'Mi medico no acepta el plan' });
  check('F1 ask-first question kept', /Medicare Advantage/.test(ok.text) && !ok.violations.some((v) => v.startsWith('unstated_assumption')), ok.text);

  // Without userText (rule disabled), nothing changes.
  const noCtx = complianceFilter('Eso puede pasar con su plan Medigap.', 'es', { now: NOW });
  check('F1 no userText = no-op', /su plan Medigap/.test(noCtx.text), noCtx.text);
}

// ── F2 — TOPIC HUMANIZER (internal slugs never surface) ─────────────────────
{
  check('F2 medical_emergency_911 ES', humanizeTopic('medical_emergency_911', 'es') === 'una emergencia médica', humanizeTopic('medical_emergency_911', 'es'));
  check('F2 medical_emergency_911 EN', humanizeTopic('medical_emergency_911', 'en') === 'a medical emergency', humanizeTopic('medical_emergency_911', 'en'));
  check('F2 unknown slug ES fallback', humanizeTopic('weird_new_slug', 'es') === 'su consulta anterior');
  check('F2 unknown slug EN fallback', humanizeTopic('weird_new_slug', 'en') === 'your previous question');
  check('F2 empty/null fallback', humanizeTopic('', 'en') === 'your previous question' && humanizeTopic(null, 'es') === 'su consulta anterior');

  // EVERY serviceCategory slug assigned anywhere in src/ must humanize to a
  // phrase with no underscore (i.e., never a raw internal token).
  const engineSrc = readFileSync(new URL('../src/lib/customerServiceEngine.ts', import.meta.url), 'utf8')
    + readFileSync(new URL('../src/components/CustomerServiceBot.tsx', import.meta.url), 'utf8');
  const slugs = new Set();
  for (const m of engineSrc.matchAll(/serviceCategory(?:\s*=\s*|\s*:\s*)'([a-z0-9_]+)'/g)) slugs.add(m[1]);
  check('F2 found slugs in source', slugs.size >= 40, `only ${slugs.size} slugs found`);
  for (const slug of slugs) {
    const en = humanizeTopic(slug, 'en');
    const es = humanizeTopic(slug, 'es');
    check(`F2 no underscore: ${slug}`, !en.includes('_') && !es.includes('_'), `${en} / ${es}`);
  }

  // The greeting itself can never contain a snake_case token.
  const g = returningVisitorGreeting({ lastTopic: 'medical_emergency_911', lastSeen: Date.now() }, 'es');
  check('F2 ES greeting humanized', g !== null && g.includes('una emergencia médica') && !g.includes('_'), g);
  const gEn = returningVisitorGreeting({ lastTopic: 'medical_emergency_911', lastSeen: Date.now() }, 'en');
  check('F2 EN greeting humanized', gEn !== null && gEn.includes('a medical emergency') && !gEn.includes('_'), gEn);
  const gUnknown = returningVisitorGreeting({ lastTopic: 'brand_new_internal_thing', lastSeen: Date.now() }, 'en');
  check('F2 unknown slug greeting safe', gUnknown !== null && !gUnknown.includes('_'), gUnknown);
}

// ── F4a — NO ABSOLUTE CLAIMS LEFT IN src/ ───────────────────────────────────
{
  const BANNED = [
    /100\s*%\s*confiden/i,          // "100% confidential" / "100% confidencial"
    /\bnever\s+sell\b/i,
    /\bnunca\s+vendemos\b/i,
    /\bjam[aá]s\s+vendemos\b/i,
    /\bwill\s+never\s+sell\b/i,
  ];
  const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|css|html)$/.test(name)) {
        const content = readFileSync(p, 'utf8');
        for (const re of BANNED) {
          if (re.test(content)) offenders.push(`${p} :: ${re.source}`);
        }
      }
    }
  };
  walk(srcRoot);
  check('F4a no absolute claims in src/', offenders.length === 0, offenders.join(' | '));
}

// ── F4b — DOB → privacy note PREPENDED, answer + age grounding intact ──────
{
  const dobMsgEn = 'My date of birth is January 1, 1950 — when can I enroll?';
  const r = await processMessageAsync(dobMsgEn, midState('en'));
  check('F4b EN DOB note prepended', /don't need to share your date of birth/.test(r.response), r.response);
  check('F4b EN note is a PREFIX (answer follows)', r.response.indexOf("don't need to share your date of birth") < 80 && r.response.split('\n\n').length >= 2, r.response);
  check('F4b flag set (one-time)', r.newState.healthDisclosureNoted === true);
  // Age grounding path intact: the OUTBOUND scrub keeps the DOB, so the server
  // can still extract it and build the deterministic age note (BUG 1 chain).
  const outbound = scrubHealthDisclosures(dobMsgEn, { includeBirthDates: false });
  const bd = extractBirthDate(outbound, NOW);
  check('F4b grounding chain: DOB survives outbound scrub', !!bd && bd.y === 1950, outbound);
  const note = bd && buildAgeGroundingNote(bd, NOW);
  check('F4b grounding chain: age note builds', !!note && /76 years old/.test(note), note);

  const rEs = await processMessageAsync('Mi fecha de nacimiento es el 1 de enero de 1950, ¿cuándo puedo inscribirme?', midState('es'));
  check('F4b ES DOB note prepended', /no necesita compartir su fecha de nacimiento/.test(rEs.response), rEs.response);

  // Second DOB mention in the same conversation: no repeated nag.
  const r2 = await processMessageAsync('I was born January 1, 1950', { ...r.newState });
  check('F4b no second nag', !/don't need to share your date of birth/.test(r2.response), r2.response);
}

console.log(`Audit regression suite: ${pass}/${pass + failures.length} passed`);
for (const f of failures) console.log(`  FAIL ${f.name}${f.detail ? ' → ' + String(f.detail).slice(0, 160) : ''}`);
if (failures.length > 0) process.exit(1);
console.log('All audit regressions green.');

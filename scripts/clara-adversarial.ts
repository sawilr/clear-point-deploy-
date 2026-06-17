/* eslint-disable no-console */
// Sawil 2026-06-17 — Clara ADVERSARIAL sweep. Generates hundreds of messy
// real-user messages (EN+ES) across the support workflows and asserts the
// universal "world-class agent" invariants on every reply. Drives
// processMessageAsync (deterministic structural-first; offline the LLM bridge
// fails fast → sync regex engine, so this exercises the deterministic brain).
// Run: npx tsx scripts/clara-adversarial.ts
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';

type Any = any;

// ── universal invariants every Clara reply must satisfy ──
const inv = {
  notEmpty: (s: string) => s.trim().length > 15,
  oneQuestion: (s: string) => (s.match(/\?/g) || []).length <= 1,
  noMenuDump: (s: string) => !/(seleccione una opci|elija una opci|choose one of|pick one of|\bopci[oó]n 1\b[^?]*\bopci[oó]n 2\b|option 1[^?]*option 2)/i.test(s),
  // Flags an AFFIRMATIVE request for sensitive data. A negated mention ("no
  // envíe su Seguro Social" / "don't share your Medicare number") is a privacy
  // REMINDER, not a request, so the (?<!no )/(?<!don't ) lookbehinds exclude it.
  noSensitiveReq: (s: string) => !/(?<!\bno\s)(?<!n'?t\s)(?<!nunca\s)(?<!jam[aá]s\s)(d[eé]me|env[ií]e(me)?|comparta|escriba|cu[aá]l es su|what'?s your|please (provide|enter|give)|necesito su)[^.?!]{0,25}(seguro social|social security|\bssn\b|n[uú]mero de medicare|medicare (id|number)|\bmbi\b|n[uú]mero de (tarjeta|cuenta)|\bbank\b|datos bancarios)/i.test(s),
  noBadCompliance: (s: string) => !/(definitivamente|usted (s[ií] )?califica|you (definitely )?qualify|ya tiene acceso|le garantiz|i guarantee|p[aá]guela|just pay it|no debe nada|you owe nothing|no tiene que pagar nada)/i.test(s),
  noUndefined: (s: string) => !/\b(undefined|null|NaN)\b|\[object/i.test(s),
  noReGreet: (s: string) => !/(¿\s*prefiere (espa[ñn]ol|ingl[eé]s)|prefer english or spanish|do you prefer (english|spanish)|english or spanish\?)/i.test(s),
  noZipReask: (s: string) => !/(c[oó]digo postal|zip code|su zip\b|5[\s-]?d[ií]gitos|5[\s-]?digit zip)/i.test(s),
};
const hasSpanishMark = (s: string) => /[ñ¿¡áéíóú]/.test(s) || /\b(usted|gracias|factura|asesor|entiendo|c[oó]digo|farmacia|del|para|qu[eé]|c[oó]mo|seguro social|medicamento)\b/i.test(s);
const isES = (s: string) => hasSpanishMark(s);
// A reply is "English" if it carries NO Spanish-only markers (the structural
// engine replies are short, so absence of Spanish is a reliable signal).
const isEN = (s: string) => !hasSpanishMark(s);
const asksExtraHelp = (s: string) =>
  /(¿\s*(tiene|tienes|cuenta con|ya tiene)[^?]*\b(extra help|ayuda extra)\b[^?]*\?)/i.test(s) || /\bdo you (also )?have\b[^?]*\bextra help\b/i.test(s);

// ── base intents per workflow (clean phrasings) ──
const BASE: { cat: string; es: string[]; en: string[] }[] = [
  { cat: 'billing', es: ['me llegó una factura de 2400 del hospital', 'tengo una cuenta del doctor que no puedo pagar'], en: ['I got a 2400 hospital bill', 'I have a doctor bill I can\'t pay'] },
  { cat: 'copay', es: ['pago mucho de copago en cada visita', 'me cobran copago por todo'], en: ['I pay a lot in copays every visit', 'they charge me copays for everything'] },
  { cat: 'pharmacy', es: ['la farmacia dice que mi medicina no está cubierta', 'en la farmacia me cobraron 80 por mi pastilla'], en: ['the pharmacy says my medicine isn\'t covered', 'the pharmacy charged me 80 for my pill'] },
  { cat: 'medcoverage', es: ['necesito saber si mi medicamento está en el plan', 'mi receta nueva es muy cara'], en: ['I need to know if my medication is on the plan', 'my new prescription is very expensive'] },
  { cat: 'network', es: ['mi doctor ya no acepta mi plan', 'el especialista no está en la red'], en: ['my doctor no longer accepts my plan', 'the specialist is not in network'] },
  { cat: 'letter', es: ['me llegó una carta de Medicare y no la entiendo', 'recibí un aviso del plan que me asusta'], en: ['I got a letter from Medicare I don\'t understand', 'I received a notice from the plan that scares me'] },
  { cat: 'premium', es: ['me sacan 200 del cheque del seguro social cada mes', 'mi prima de la parte b subió'], en: ['they take 200 from my social security check each month', 'my part b premium went up'] },
  { cat: 'dual', es: ['tengo medicaid y medicare y me llegaron facturas', 'tengo los dos y me cobran de más'], en: ['I have medicaid and medicare and I got bills', 'I have both and they overcharge me'] },
  { cat: 'qmb', es: ['tengo qmb y el hospital me facturó', 'soy qmb y me mandaron una cuenta'], en: ['I have qmb and the hospital billed me', 'I\'m qmb and they sent me a bill'] },
  { cat: 'advisor', es: ['quiero hablar con un asesor', 'me pueden llamar por favor'], en: ['I want to talk to an advisor', 'can someone call me please'] },
  { cat: 'sensitive', es: ['mi seguro social es 078-05-1120', 'le doy mi numero de medicare 1EG4TE5MK72'], en: ['my social security is 078-05-1120', 'here is my medicare number 1EG4TE5MK72'] },
  { cat: 'angry', es: ['esto no sirve nadie me ayuda estoy harto', 'que mierda de servicio me tienen loco'], en: ['this is useless nobody helps me I\'m fed up', 'what a garbage service you\'re driving me crazy'] },
  { cat: 'appointment', es: ['quiero agendar una llamada para mañana', 'puedo hacer una cita'], en: ['I want to schedule a call for tomorrow', 'can I make an appointment'] },
  { cat: 'planadvice', es: ['dime cuál plan me conviene más', 'cámbiame a un plan dual ahora'], en: ['tell me which plan is best for me', 'switch me to a dual plan now'] },
  { cat: 'vague', es: ['tengo problemas', 'ayuda', 'no sé qué hacer'], en: ['I have problems', 'help', 'I don\'t know what to do'] },
];

// ── noise transforms to make each phrasing "messy real user" ──
const dropAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const noisers: ((s: string) => string)[] = [
  (s) => s,
  (s) => dropAccents(s),
  (s) => s.toUpperCase(),
  (s) => 'hola ' + s,
  (s) => 'disculpe ' + s + ' gracias',
  (s) => s + ' y la verdad ya no sé qué hacer',
  (s) => s.replace(/\s+/g, '  ').replace(/qu/gi, 'q'),
  (s) => dropAccents(s).replace(/c/g, 'k').slice(0, 90),     // heavy typo
  (s) => s + '!!!',
  (s) => s.replace(/o/g, '0').replace(/i/g, 'i'),
];

(async () => {
  const seed = (lang: 'es' | 'en') => ({
    ...createInitialState(), language: lang, zipCode: '10550', state: 'NY', zipCodeIsValid: true,
    step: 'conversation', messages: [] as Any[],
  });

  let total = 0; const failures: { cat: string; lang: string; msg: string; reply: string; why: string[] }[] = [];

  async function oneShot(cat: string, lang: 'es' | 'en', msg: string) {
    total++;
    let st: Any = seed(lang);
    st.messages.push({ role: 'user', content: msg, timestamp: Date.now() });
    const r = await processMessageAsync(msg, st);
    const s = r.response || '';
    const why: string[] = [];
    if (!inv.notEmpty(s)) why.push('empty');
    if (!inv.oneQuestion(s)) why.push('multi-question');
    if (!inv.noMenuDump(s)) why.push('menu-dump');
    if (!inv.noSensitiveReq(s)) why.push('asks-sensitive');
    if (!inv.noBadCompliance(s)) why.push('bad-compliance');
    if (!inv.noUndefined(s)) why.push('undefined');
    if (!inv.noReGreet(s)) why.push('re-greets');
    if (!inv.noZipReask(s)) why.push('re-asks-zip');
    if (lang === 'es' && !isES(s)) why.push('not-spanish');
    if (lang === 'en' && !isEN(s)) why.push('not-english');
    if (cat !== 'sensitive' && /medicaid/i.test(msg) && asksExtraHelp(s)) why.push('asks-extra-help-after-medicaid');
    if (why.length) failures.push({ cat, lang, msg, reply: s.slice(0, 140), why });
    return r;
  }

  // loop check: message then a vague follow-up must not repeat the IDENTICAL question
  async function loopCheck(cat: string, lang: 'es' | 'en', msg: string) {
    total++;
    let st: Any = seed(lang);
    st.messages.push({ role: 'user', content: msg, timestamp: Date.now() });
    const r1 = await processMessageAsync(msg, st); st = r1.newState;
    const follow = lang === 'es' ? 'no sé' : 'i dont know';
    st.messages.push({ role: 'user', content: follow, timestamp: Date.now() });
    const r2 = await processMessageAsync(follow, st);
    if (r1.response && r2.response && r1.response.trim() === r2.response.trim()) {
      failures.push({ cat, lang, msg: msg + ' → "' + follow + '"', reply: r2.response.slice(0, 120), why: ['LOOP-identical-reply'] });
    }
  }

  for (const b of BASE) {
    for (const phrase of b.es) for (const n of noisers) await oneShot(b.cat, 'es', n(phrase));
    for (const phrase of b.en) for (const n of noisers.slice(0, 6)) await oneShot(b.cat, 'en', n(phrase));
    await loopCheck(b.cat, 'es', b.es[0]);
    if (b.en[0]) await loopCheck(b.cat, 'en', b.en[0]);
  }

  // ── summary ──
  const byCat: Record<string, number> = {}; const byWhy: Record<string, number> = {};
  for (const f of failures) { byCat[f.cat] = (byCat[f.cat] || 0) + 1; for (const w of f.why) byWhy[w] = (byWhy[w] || 0) + 1; }
  console.log(`\nADVERSARIAL: ${total} messages, ${failures.length} flagged`);
  console.log('by failure type:', JSON.stringify(byWhy, null, 0));
  console.log('by category   :', JSON.stringify(byCat, null, 0));
  console.log('\n── sample flagged (first 25) ──');
  for (const f of failures.slice(0, 25)) console.log(`[${f.cat}/${f.lang}] (${f.why.join(',')})\n   MSG: ${f.msg.slice(0, 80)}\n   →  ${f.reply}`);
  console.log(`\nTOTAL: ${total - failures.length} PASS / ${failures.length} FAIL`);
  process.exit(failures.length > 0 ? 1 : 0);
})();

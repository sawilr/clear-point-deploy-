/* eslint-disable no-console */
// Clara HUMAN-BEHAVIOR stress test. Many realistic messy senior conversations
// (multi-issue, pushback, confusion, repetition, frustration, Spanglish, topic
// switches). Auto-flags non-human behaviors so we find ALL failure modes — not
// just the one example. Exercises the deterministic engine offline.
import { processMessageAsync, createInitialState } from '../src/lib/customerServiceEngine';
type Any = any;
const seed = (lang: 'es' | 'en') => ({ ...createInitialState(), language: lang, zipCode: '10033', state: 'NY', zipCodeIsValid: true, step: 'conversation', messages: [] as Any[] });

const N = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const RESET = (b: string) => /empecemos de nuevo|empezar de nuevo|comencemos de nuevo|acabo de recibir su c[oó]digo|let'?s start over|start fresh/i.test(b);
const MENU = (b: string) => /es sobre (una )?factura, (un )?doctor, medicamentos|is it about a bill, a doctor, medications|prefiere hablar con un asesor licenciado\?|would you rather talk to an advisor\?/i.test(b);
const WALL = (b: string) => b.length > 320;

// each scenario: {id, lang, turns[]}. We replay and flag robot moments.
const SC: Array<{ id: string; lang: 'es' | 'en'; turns: string[] }> = [
  { id: 'cost+plan', lang: 'es', turns: ['me estan cobrando 200 de medicare y mi doctor me pidio cambiar mi plan', 'que paso', 'ya te habia dicho', 'de que estas hablando yo te dije dos casos y me das mucha informacion'] },
  { id: 'bill+med+doctor', lang: 'es', turns: ['me llego una factura del hospital de 800, mi medicina subio, y mi doctor ya no acepta mi plan', 'cual primero', 'la factura', 'ya te dije'] },
  { id: 'pushback-loop', lang: 'es', turns: ['pago mucho de copagos', 'ya te dije que pago mucho', 'ya te dije', 'ya te lo dije tres veces'] },
  { id: 'confusion', lang: 'es', turns: ['tengo un problema con mi plan', 'no entiendo', 'que', 'de que hablas'] },
  { id: 'topic-switch', lang: 'es', turns: ['me subio la medicina', 'no espera mejor mi doctor se salio de la red', 'y tambien me llego una carta', 'mejor quiero un asesor'] },
  { id: 'user-repeats', lang: 'es', turns: ['quiero hablar con un asesor quiero hablar con un asesor', 'Saul Reyes Saul Reyes', '347-555-0148 347-555-0148'] },
  { id: 'frustrated', lang: 'es', turns: ['me cobran de medicare no entiendo', 'pero que me estas diciendo', 'no me estas ayudando', 'esto es una perdida de tiempo'] },
  { id: 'spanglish', lang: 'es', turns: ['my plan me cambio el doctor y ahora pago mas copay', 'i dont understand la carta', 'necesito un advisor'] },
  { id: 'vague-then-specific', lang: 'es', turns: ['necesito ayuda', 'es con un cobro', 'me sacan 200 del seguro social cada mes'] },
  { id: 'doctor-out-network', lang: 'es', turns: ['mi doctor ya no esta en mi plan y me preocupa perderlo', 'que hago', 'ya te dije que no quiero perder mi doctor'] },
  { id: 'medication-cost', lang: 'es', turns: ['mi medicina esta carisima este mes', 'como 300 dolares', 'antes pagaba 40', 'que paso con eso'] },
  { id: 'letter-confused', lang: 'es', turns: ['me llego una carta del plan y no se que es', 'habla de un cambio creo', 'de mi doctor', 'ya te dije'] },
  { id: 'advisor-midflow', lang: 'es', turns: ['pago muchos copagos', 'mejor conectame con un asesor', 'si'] },
  { id: 'multi-then-pushback', lang: 'es', turns: ['tengo problemas con mi plan mi medicina y mi doctor', 'no me has resuelto nada', 'ya te dije los tres'] },
  { id: 'dual-eligible', lang: 'es', turns: ['tengo medicare y medicaid y me cobran', 'no deberian cobrarme', 'que hago'] },
  { id: 'en-cost+plan', lang: 'en', turns: ["medicare is charging me 200 and my doctor told me to change my plan", 'what happened', 'i already told you', 'what are you talking about i told you two things'] },
  { id: 'en-pushback', lang: 'en', turns: ['i pay too many copays', 'i already told you', 'i said that already', 'you are not listening'] },
  { id: 'en-frustrated', lang: 'en', turns: ['my plan changed my doctor', 'this is useless', 'you keep repeating', 'just get me a person'] },
];

(async () => {
  let robotMoments = 0; const offenders: string[] = [];
  for (const sc of SC) {
    let st: Any = seed(sc.lang); let prev = '';
    const intents: Record<string, number> = {};
    console.log(`\n■ ${sc.id} [${sc.lang}]`);
    for (let i = 0; i < sc.turns.length; i++) {
      const t = sc.turns[i];
      st.messages = [...st.messages, { role: 'user', content: t, timestamp: Date.now() }];
      const r = await processMessageAsync(t, st); st = r.newState; const b = r.response || '';
      const f: string[] = [];
      if (RESET(b)) f.push('RESET');
      if (WALL(b)) f.push(`WALL(${b.length})`);
      if (prev && N(b).slice(0, 70) === N(prev).slice(0, 70)) f.push('REPEAT');
      if (MENU(b) && i > 0) f.push('MENU-DUMP');
      const li = String(st.lastBotIntent || '');
      intents[li] = (intents[li] || 0) + 1;
      if (intents[li] >= 3) f.push(`ASK-SAME-3x(${li})`);
      if (f.length) { robotMoments += f.length; offenders.push(`${sc.id} T${i + 1}: ${f.join(',')}`); }
      console.log(`  T${i + 1} «${t.slice(0, 42)}» ${f.length ? '⚠ ' + f.join(',') : 'ok'}`);
      const wallDump = f.some(x => x.startsWith('WALL'));
      console.log(`     → ${b.replace(/\n+/g, ' ').slice(0, wallDump ? 999 : 140)}`);
      prev = b;
    }
  }
  console.log(`\n═══════════════════════════════\nROBOT MOMENTS: ${robotMoments} across ${SC.length} conversations`);
  if (offenders.length) console.log('OFFENDERS:\n  ' + offenders.join('\n  '));
  process.exit(0);
})();

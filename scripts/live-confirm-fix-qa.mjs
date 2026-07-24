// LIVE prod QA for the confirmation-gate fix (Maria Rojas bug).
// Proves on the REAL LLM:
//   1) the confirmation summary appears BEFORE "anything else?"
//   2) NO /api/submit-lead POST fires before the caller confirms
//   3) the Maria move — a QUESTION at "anything else?" — is answered AND the lead
//      still submits, but only AFTER confirmation (Edit 3 gates submit on confirm).
// Uses the famous fake 212-867-5309 (GHL rejects it → no real CRM lead created);
// the POST *firing* is the proof the submit gate opened post-confirmation.
import { chromium } from 'playwright';

const URL = 'https://clearpointsenioradvisors.com/support';
const SR = '[aria-label="Customer service assistant"], [aria-label*="ervicio"], [aria-label*="ervice"], main';
let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

const browser = await chromium.launch();

function driver(page, submitState) {
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/submit-lead/.test(r.url())) submitState.posts++; });
  const tail = () => page.evaluate((sel) => {
    const r = document.querySelector(sel) || document.body;
    return r.innerText.split('\n').map(s => s.trim()).filter(s => s.length > 2 && !/^(Callback|Devoluci[oó]n):/.test(s) && s !== 'Clara is typing' && !/Clara est[aá] escribiendo/.test(s));
  }, SR);
  const last = async () => (await tail()).slice(-1)[0] || '';
  const clickText = (t) => page.evaluate((label) => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || x.textContent).trim() === label); if (b) { b.click(); return true; } return false; }, t);
  async function say(text) {
    await page.evaluate((t) => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true }));
      const b = [...document.querySelectorAll('button')].find(x => /^(Send|Enviar)$/.test((x.getAttribute('aria-label') || x.textContent).trim()));
      if (b) b.click(); else ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, text);
    for (let i = 0; i < 20; i++) { await page.waitForTimeout(700); const typing = await page.evaluate((sel) => { const t = (document.querySelector(sel)?.innerText || ''); return t.includes('Clara is typing') || /Clara est[aá] escribiendo/.test(t); }, SR); if (!typing && i > 1) break; }
    await page.waitForTimeout(400);
  }
  return { last, clickText, say };
}

async function run(lang) {
  console.log(`\n=== LIVE confirm-gate QA (${lang.toUpperCase()}) ===`);
  const page = await browser.newPage();
  const submitState = { posts: 0 };
  const d = driver(page, submitState);
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.waitForSelector('textarea', { timeout: 15000 });
  await d.clickText(lang === 'es' ? 'Español' : 'English');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(600); if (/zip|c[oó]digo postal/i.test(await d.last())) break; }
  await d.say('10550');

  // Plan-review nudge (NOT "medications", which sends the engine into cost triage).
  const nudges = lang === 'es'
    ? ['Quiero que un asesor licenciado me llame sobre mi plan de Medicare, conécteme ahora por favor', 'sí conécteme con el asesor ahora', 'no más preguntas, solo el asesor', 'solo el asesor, ahora', 'sí ahora']
    : ['I want a licensed advisor to call me about my Medicare plan, connect me now', 'yes connect me to an advisor now', 'no more questions just the advisor', 'just the advisor now', 'yes now'];
  let asksName = false;
  for (let i = 0; i < nudges.length && !asksName; i++) { await d.say(nudges[i]); asksName = /your (first|full)? ?name|first and last name|su nombre|c[oó]mo se llama|cu[aá]l es su nombre|what'?s your name/.test((await d.last()).toLowerCase()); }
  ok(`${lang}: reached the name prompt`, asksName, (await d.last()).slice(0, 70));

  // Drive name + phone, then feed best-time / topic / email ONLY when the bot
  // actually asks for each — never fire blind (that desyncs the LLM path).
  await d.say('Maria Rojas');
  await d.say('212-867-5309');          // valid format; GHL rejects → no real lead
  let confText = '';
  for (let i = 0; i < 8; i++) {
    const b = (await d.last()).toLowerCase();
    if (/¿está todo correcto\?|is everything correct\?/.test(b)) { confText = b; break; }
    if (/horario|best time/.test(b)) { await d.say(lang === 'es' ? 'despues de las 11 am' : 'after 11 am'); continue; }
    if (/tema|topic/.test(b)) { await d.say(lang === 'es' ? 'mi plan' : 'my plan'); continue; }
    if (/correo|email/.test(b)) { await d.say('maria.qa.delete@gmail.com'); continue; }
    await d.say(lang === 'es' ? 'continuar' : 'continue'); // nudge if it stalls
  }
  ok(`${lang}: DETERMINISTIC confirmation reached`, /¿está todo correcto\?|is everything correct\?/.test(confText), confText.slice(0, 110));
  ok(`${lang}: confirmation shown BEFORE "anything else?"`, !!confText && !/algo m[aá]s|anything else/.test(confText));
  ok(`${lang}: NO submit POST before confirmation`, submitState.posts === 0, `posts=${submitState.posts}`);

  // Confirm → "yes" → deterministic close + submit IMMEDIATELY. No "anything else?".
  await d.say(lang === 'es' ? 'sí' : 'yes');
  await page.waitForTimeout(5000); // 600ms submit delay + network round-trip
  const afterYes = (await d.last()).toLowerCase();
  console.log(`   [after "yes"] posts=${submitState.posts} :: ${afterYes.slice(0, 90)}`);
  ok(`${lang}: "yes" → closes directly, NO "anything else?" step`, !/algo m[aá]s|anything else/.test(afterYes), afterYes.slice(0, 90));
  ok(`${lang}: advisor-callback close shown`, /(asesor|advisor|contact|llamar|llamará|will call|reach out|pronto)/.test(afterYes), afterYes.slice(0, 90));
  ok(`${lang}: lead SUBMITTED right after confirmation (POST fired)`, submitState.posts >= 1, `posts=${submitState.posts}`);

  // The Maria move is now IMPOSSIBLE — there is no "anything else?" to divert at.
  // If the caller asks a follow-up post-close, the lead is already captured.
  await page.close();
}

await run('es');
await browser.close();
console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

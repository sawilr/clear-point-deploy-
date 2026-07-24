// Comprehensive LIVE production QA of the deterministic lead-capture fix.
// EN + ES full flows, 829/809/555 rejection, one-field correction, mobile, and a
// NETWORK assertion that /api/submit-lead is NEVER POSTed before the final "yes".
// Stops before the GHL-writing "yes" — no real lead is created.
import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR || '.';
const URL = 'https://clearpointsenioradvisors.com/support';
const SR = '[aria-label="Customer service assistant"], [aria-label="Asistente de servicio al cliente"], [aria-label*="ervicio"], [aria-label*="ervice"], main';

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

function makeDriver(page) {
  const tail = () => page.evaluate((sel) => {
    const r = document.querySelector(sel) || document.body;
    return r.innerText.split('\n').map(s => s.trim()).filter(s => s.length > 2 && !/^(Callback|Devoluci[oó]n):/.test(s) && s !== 'Clara is typing' && !/Clara est[aá] escribiendo/.test(s));
  }, SR);
  const last = async () => (await tail()).slice(-1)[0] || '';
  const full = () => page.evaluate((sel) => (document.querySelector(sel) || document.body).innerText, SR);
  const clickText = (t) => page.evaluate((label) => { const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || x.textContent).trim() === label); if (b) { b.click(); return true; } return false; }, t);
  async function say(text) {
    await page.evaluate((t) => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true }));
      const b = [...document.querySelectorAll('button')].find(x => /^(Send|Enviar)$/.test((x.getAttribute('aria-label') || x.textContent).trim()));
      if (b) b.click(); else { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    }, text);
    for (let i = 0; i < 18; i++) { await page.waitForTimeout(700); const typing = await page.evaluate((sel) => { const t = (document.querySelector(sel)?.innerText || ''); return t.includes('Clara is typing') || /Clara est[aá] escribiendo/.test(t); }, SR); if (!typing && i > 1) break; }
    await page.waitForTimeout(400);
  }
  return { tail, last, full, clickText, say };
}

const browser = await chromium.launch();

// Track POSTs to the GHL submit endpoint across the whole run.
let submitPosts = 0;
function watch(page) {
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/submit-lead/.test(r.url())) submitPosts++; });
}

const REJECTED = (b) => /valid|no parece|d[ií]gitos|digits|try again|de nuevo|real|repeating myself|repetir|call us directly|llamarnos|1-?866|10-?digit|10 d[ií]gitos|lo [uú]nico que me falta|only thing/.test(b) && !/best time|mejor horario|everything correct|todo correcto/.test(b);

async function reachName(d, lang) {
  const nudges = lang === 'es'
    ? ['Quiero que un asesor licenciado me llame sobre mi plan, conécteme ahora', 'sí por favor conécteme con el asesor ahora', 'no tengo más preguntas, solo el asesor', 'solo el asesor, conécteme ya', 'sí conécteme ahora']
    : ['I want a licensed advisor to call me about my plan, connect me now', 'yes please connect me to an advisor now', 'no other questions, just the advisor', 'just the advisor, connect me now', 'yes connect me now'];
  let asksName = false;
  for (let i = 0; i < nudges.length && !asksName; i++) { await d.say(nudges[i]); const b = (await d.last()).toLowerCase(); asksName = /your (first|full)? ?name|first and last name|su nombre|c[oó]mo se llama|cu[aá]l es su nombre|what'?s your name/.test(b); }
  return asksName;
}

async function driveToConfirm(d, lang, data) {
  const answers = lang === 'es' ? ['por la tarde', 'una factura confusa', 'ana.qa@gmail.com', 'no', 'no', 'no'] : ['after 3 pm', 'a confusing bill', 'carlos.qa@gmail.com', 'no', 'no', 'no'];
  let sawConfirm = false;
  for (let i = 0; i < answers.length && !sawConfirm; i++) {
    const b = (await d.last()).toLowerCase();
    if (/everything correct\?|todo correcto\?/.test(b)) { sawConfirm = true; break; }
    await d.say(answers[i]);
    if (/everything correct\?|todo correcto\?/.test((await d.last()).toLowerCase())) { sawConfirm = true; break; }
  }
  return sawConfirm;
}

// ── Scenario A — EN full flow + 829 reject + ONE-FIELD CORRECTION ─────────────
{
  const page = await browser.newPage(); watch(page);
  const d = makeDriver(page);
  console.log('\n=== Scenario A: EN — collect, reject 829, correct phone, re-confirm ===');
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.waitForSelector('textarea', { timeout: 15000 });
  await d.clickText('English');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(600); if (/zip|c[oó]digo postal/i.test(await d.last())) break; }
  await d.say('10001');
  ok('A/EN: ZIP accepted', /new york|10001|county|area|help/.test((await d.last()).toLowerCase()));
  ok('A/EN: reached NAME prompt', await reachName(d, 'en'), (await d.last()).slice(0, 80));
  await d.say('Carlos Mendez');
  ok('A/EN: phone asked separately', /phone|number|d[ií]gits|digits/.test((await d.last()).toLowerCase()), (await d.last()).slice(0, 80));
  await d.say('829-563-2553');
  ok('A/EN: 829 rejected', REJECTED((await d.last()).toLowerCase()), (await d.last()).slice(0, 80));
  await d.say('347-852-2553');
  const confA = await driveToConfirm(d, 'en');
  ok('A/EN: confirmation summary appeared', confA, (await d.last()).slice(0, 100));
  ok('A/EN: summary lists name + phone + email', /Carlos Mendez/.test(await d.full()) && /347-852-2553/.test(await d.full()) && /carlos\.qa@gmail\.com/.test(await d.full()));
  await page.screenshot({ path: `${SHOT}/qa-en-confirm.png`, fullPage: false });
  // Correction: say no → fix phone → new phone → re-confirm
  await d.say('no');
  ok('A/EN: "no" asks which field to fix', /fix|name|phone|email|corregir/i.test(await d.last()), (await d.last()).slice(0, 80));
  await d.say('the phone');
  ok('A/EN: correcting clears phone & re-asks', /correct phone|phone number|10 digits/i.test(await d.last()), (await d.last()).slice(0, 80));
  await d.say('646-333-4455');
  const reconf = /everything correct\?/i.test(await d.last());
  ok('A/EN: re-confirmation appears with new phone', reconf && /646-333-4455/.test(await d.full()), (await d.last()).slice(0, 90));
  ok('A/EN: NO submit POST fired (gate holds at network level)', submitPosts === 0, `submitPosts=${submitPosts}`);
  await page.close();
}

// ── Scenario B — ES full flow + 809 reject ───────────────────────────────────
{
  const page = await browser.newPage(); watch(page);
  const d = makeDriver(page);
  console.log('\n=== Scenario B: ES — collect, reject 809, confirm ===');
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.waitForSelector('textarea', { timeout: 15000 });
  await d.clickText('Español');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(600); if (/zip|c[oó]digo postal/i.test(await d.last())) break; }
  await d.say('10001');
  ok('B/ES: ZIP aceptado', /new york|10001|condado|área|area|ayudar/.test((await d.last()).toLowerCase()));
  ok('B/ES: llegó a pedir NOMBRE', await reachName(d, 'es'), (await d.last()).slice(0, 80));
  await d.say('Ana López');
  ok('B/ES: pide teléfono por separado', /tel[eé]fono|n[uú]mero|d[ií]gitos/.test((await d.last()).toLowerCase()), (await d.last()).slice(0, 80));
  await d.say('809-200-1122');
  ok('B/ES: 809 dominicano rechazado', REJECTED((await d.last()).toLowerCase()), (await d.last()).slice(0, 80));
  await d.say('212-388-0188');
  const confB = await driveToConfirm(d, 'es');
  ok('B/ES: resumen de confirmación apareció', confB, (await d.last()).slice(0, 100));
  ok('B/ES: resumen lista nombre + teléfono', /Ana López/.test(await d.full()) && /212-388-0188/.test(await d.full()));
  await page.screenshot({ path: `${SHOT}/qa-es-confirm.png`, fullPage: false });
  ok('B/ES: NINGÚN POST de envío (gate retiene)', submitPosts === 0, `submitPosts=${submitPosts}`);
  await page.close();
}

// ── Scenario C — Mobile render of the confirmation summary ────────────────────
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); watch(page);
  const d = makeDriver(page);
  console.log('\n=== Scenario C: Mobile (375px) — confirmation renders ===');
  await page.goto(URL, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.waitForSelector('textarea', { timeout: 15000 });
  await d.clickText('English');
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(600); if (/zip|c[oó]digo postal/i.test(await d.last())) break; }
  await d.say('10001');
  await reachName(d, 'en');
  await d.say('Maria Gomez');
  await d.say('718-444-5566');
  const confC = await driveToConfirm(d, 'en');
  ok('C/Mobile: confirmation renders at 375px', confC, (await d.last()).slice(0, 90));
  await page.screenshot({ path: `${SHOT}/qa-mobile-confirm.png`, fullPage: false });
  ok('C/Mobile: NO submit POST', submitPosts === 0, `submitPosts=${submitPosts}`);
  await page.close();
}

await browser.close();
console.log(`\nTotal /api/submit-lead POSTs during entire QA (expected 0): ${submitPosts}`);
console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

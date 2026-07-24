// ONE real submit on LIVE prod to prove the GHL POST fires after the final "yes".
// Synthetic, clearly-labeled test identity (famous fake 867-5309 number) so the
// lead is trivial to find + delete in GHL and no real stranger can be called.
// Captures the /api/submit-lead request payload + response status.
import { chromium } from 'playwright';

const SHOT = process.env.SHOT_DIR || '.';
const URL = 'https://clearpointsenioradvisors.com/support';
const SR = '[aria-label="Customer service assistant"], [aria-label*="ervicio"], [aria-label*="ervice"], main';

const LEAD = {
  name: 'Diego Pruebas',
  phone: '212-867-5309',
  email: 'qa.test.delete@gmail.com',
  bestTime: 'test - please ignore',
  topic: 'QA test lead, safe to delete',
};

const browser = await chromium.launch();
const page = await browser.newPage();

let submitReq = null, submitRes = null;
const apiLog = [];
page.on('request', r => { if (r.method() === 'POST' && /\/api\/submit-lead/.test(r.url())) { submitReq = { url: r.url(), body: r.postData() }; } });
page.on('response', async r => {
  if (/\/api\//.test(r.url())) {
    let body = ''; try { body = await r.text(); } catch {}
    const ep = r.url().replace(/^https?:\/\/[^/]+/, '');
    apiLog.push(`${r.request().method()} ${ep} -> ${r.status()}${body ? ' :: ' + body.slice(0, 200) : ''}`);
    if (/\/api\/submit-lead/.test(r.url()) && r.request().method() === 'POST') submitRes = { status: r.status(), body: body.slice(0, 400) };
  }
});
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

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
    if (b) b.click(); else ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, text);
  for (let i = 0; i < 18; i++) { await page.waitForTimeout(700); const typing = await page.evaluate((sel) => { const t = (document.querySelector(sel)?.innerText || ''); return t.includes('Clara is typing') || /Clara est[aá] escribiendo/.test(t); }, SR); if (!typing && i > 1) break; }
  await page.waitForTimeout(400);
}

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.waitForSelector('textarea', { timeout: 15000 });
await clickText('English');
for (let i = 0; i < 12; i++) { await page.waitForTimeout(600); if (/zip|c[oó]digo postal/i.test(await last())) break; }
await say('10001');

const nudges = ['I want a licensed advisor to call me about my plan, connect me now', 'yes please connect me to an advisor now', 'no other questions, just the advisor', 'just the advisor, connect me now', 'yes connect me now'];
let asksName = false;
for (let i = 0; i < nudges.length && !asksName; i++) { await say(nudges[i]); asksName = /your (first|full)? ?name|first and last name|what'?s your name/.test((await last()).toLowerCase()); }
console.log('reached name prompt:', asksName);

await say(LEAD.name);
console.log('after name:', (await last()).slice(0, 70));
await say(LEAD.phone);
console.log('after phone:', (await last()).slice(0, 70));

const answers = [LEAD.bestTime, LEAD.topic, LEAD.email, 'no', 'no', 'no'];
let sawConfirm = false;
for (let i = 0; i < answers.length && !sawConfirm; i++) {
  if (/everything correct\?/i.test(await last())) { sawConfirm = true; break; }
  await say(answers[i]);
  if (/everything correct\?/i.test(await last())) { sawConfirm = true; break; }
}
console.log('confirmation gate reached:', sawConfirm);
const summary = await full();
console.log('summary has all fields:',
  ['Diego Pruebas', '212-867-5309', 'qa.test.delete@gmail.com', LEAD.bestTime, LEAD.topic].every(v => summary.includes(v)));

// FINAL YES — this fires the GHL submit.
console.log('\n>>> sending final YES (fires GHL submit) <<<');
await say('yes');
await page.waitForTimeout(10000);
console.log('final on-screen message:', (await last()).slice(0, 200));
await page.screenshot({ path: `${SHOT}/qa-final-submit.png` });

console.log('\n=== ALL /api responses ===');
apiLog.forEach(l => console.log('  ' + l));
console.log('\n=== /api/submit-lead REQUEST captured:', !!submitReq, '===');
console.log('\n=== /api/submit-lead RESPONSE ===');
console.log(submitRes ? `status ${submitRes.status} :: ${submitRes.body}` : 'NO RESPONSE CAPTURED');
console.log('\nconsole errors:', consoleErrors.length, consoleErrors.slice(0, 5).join(' | '));

await browser.close();

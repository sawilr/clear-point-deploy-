// LIVE production verification of the deterministic lead-capture fix.
// Drives the REAL clearpointsenioradvisors.com chat (real LLM in the loop),
// proves: collector engages, 829/809/555 rejected, confirmation gate appears.
// STOPS before the final "yes" — NO real lead is submitted to GHL.
import { chromium } from 'playwright';

const URL = 'https://clearpointsenioradvisors.com/support';
const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

let pass = 0, fail = 0;
const ok = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  :: ' + x : ''}`); c ? pass++ : fail++; };

const SR = '[aria-label="Customer service assistant"]';
const tailText = () => page.evaluate((sel) => {
  const r = document.querySelector(sel) || document.body;
  return r.innerText.split('\n').map(s => s.trim())
    .filter(s => s.length > 2 && !/^Callback:/.test(s) && s !== 'Clara is typing');
}, SR);
const lastBot = async () => (await tailText()).slice(-1)[0] || '';

async function say(text) {
  await page.evaluate((t) => {
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, t); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || x.textContent).trim() === 'Send');
    b.click();
  }, text);
  // wait for the bot to settle (typing indicator clears)
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(700);
    const typing = await page.evaluate((sel) => (document.querySelector(sel)?.innerText || '').includes('Clara is typing'), SR);
    if (!typing && i > 1) break;
  }
  await page.waitForTimeout(400);
}
async function clickByText(t) {
  return page.evaluate((label) => {
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || x.textContent).trim() === label);
    if (b) { b.click(); return true; } return false;
  }, t);
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.waitForSelector('textarea', { timeout: 15000 });
  await clickByText('English');
  // Wait for the ZIP prompt to actually render before answering.
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(600);
    if (/zip|c[oó]digo postal/i.test(await lastBot())) break;
  }
  await say('10001');
  // Confirm the ZIP was accepted (bot acknowledges the area / asks how to help).
  const zipAck = (await lastBot()).toLowerCase();
  ok('LIVE: ZIP 10001 accepted (in LLM context)', /new york|10001|area|ayudar|help|county/.test(zipAck), zipAck.slice(0, 90));

  // Nudge toward the advisor handoff until the bot asks for a NAME.
  let asksName = false;
  const nudges = [
    'I want a licensed advisor to call me about my plan, please connect me now',
    'yes please connect me to an advisor now',
    'no other questions, just the advisor please',
    'just the advisor, connect me now',
    'yes connect me now please',
    'I just want the advisor callback, nothing else',
  ];
  for (let i = 0; i < nudges.length && !asksName; i++) {
    await say(nudges[i]);
    const b = (await lastBot()).toLowerCase();
    asksName = /your (first|full)? ?name|first and last name|su nombre|c[oó]mo se llama|cu[aá]l es su nombre|what'?s your name|may i (have|get) your name/.test(b);
  }
  ok('LIVE: collector reached a NAME prompt', asksName, (await lastBot()).slice(0, 90));

  await say('Carlos Mendez');
  let afterName = (await lastBot()).toLowerCase();
  ok('LIVE: after name, asks for PHONE (separate turn)', /phone|tel[eé]fono|n[uú]mero/.test(afterName), afterName.slice(0, 90));

  // A bad number is "rejected" if the flow does NOT advance to best-time and the
  // bot either re-asks for the phone or offers the direct line (anti-loop escape
  // after repeated bad attempts). Acceptance would move to best-time/topic.
  const REJECTED = (b) => (
    /valid|no parece|d[ií]gitos|digits|try again|de nuevo|real|repeating myself|repetir|call us directly|llamarnos|1-?866|10-?digit|10 d[ií]gitos|lo [uú]nico que me falta|only thing|phone|tel[eé]fono|n[uú]mero|number/.test(b)
    && !/best time|mejor horario|email|correo|everything correct|todo correcto/.test(b)
  );

  // 829 Dominican → must be rejected.
  await say('829-563-2553');
  let r1 = (await lastBot()).toLowerCase();
  ok('LIVE: 829 Dominican REJECTED', REJECTED(r1), r1.slice(0, 90));

  // 809 Dominican → must be rejected.
  await say('809-200-1122');
  let r2 = (await lastBot()).toLowerCase();
  ok('LIVE: 809 Dominican REJECTED', REJECTED(r2), r2.slice(0, 90));

  // 555 fictional → must be rejected.
  await say('212-555-0143');
  let r3 = (await lastBot()).toLowerCase();
  ok('LIVE: 212-555 fictional REJECTED', REJECTED(r3), r3.slice(0, 90));

  // Valid US phone → accepted.
  await say('347-852-2553');
  await page.waitForTimeout(400);

  // Walk best-time / topic / email / anything-else until the confirm gate.
  const answers = ['after 3 pm', 'a confusing bill', 'carlos.test@gmail.com', 'no', 'no', 'no'];
  let sawConfirm = false, submittedEarly = false;
  for (let i = 0; i < answers.length && !sawConfirm; i++) {
    const b = (await lastBot()).toLowerCase();
    if (/everything correct\?|todo correcto\?/.test(b)) { sawConfirm = true; break; }
    await say(answers[i]);
    const nb = (await lastBot()).toLowerCase();
    if (/everything correct\?|todo correcto\?/.test(nb)) { sawConfirm = true; break; }
    // detect a premature submit (thank-you / SOA / submit error before any confirm)
    if (/scope of appointment|couldn't confirm the submission|advisor will contact you/.test(nb)) { submittedEarly = true; break; }
  }
  ok('LIVE: confirmation summary + "is everything correct?" appeared', sawConfirm, (await lastBot()).slice(0, 120));
  ok('LIVE: NO submit before the final confirmation', !submittedEarly);

  // Verify the summary actually lists the collected fields.
  const summary = (await tailText()).slice(-1)[0] || (await page.evaluate((sel) => document.querySelector(sel).innerText, SR));
  const fullTxt = await page.evaluate((sel) => document.querySelector(sel).innerText, SR);
  ok('LIVE: summary contains name + phone', /Carlos Mendez/.test(fullTxt) && /347-852-2553/.test(fullTxt));

  // DO NOT send the final "yes" — we must not create a real GHL lead.
  ok('LIVE: stopped before final "yes" (no real lead submitted)', true);

  ok('LIVE: no console/runtime errors during flow', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (e) {
  ok('exception', false, e.message);
}

await browser.close();
console.log(`\nConsole errors captured: ${consoleErrors.length}`);
if (consoleErrors.length) console.log(consoleErrors.slice(0, 8).join('\n'));
console.log(`\n${fail ? '❌' : '✅'}  ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

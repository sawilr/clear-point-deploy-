// Deterministic Zara voice-clear test. Mocks the Web Speech API so we can fire a
// transcript, send, then fire a LATE transcript and assert the input stays empty
// (the suppress fix). Runs against the LIVE prod site.
import { chromium } from 'playwright';

const URL = process.argv[2] || 'https://clearpointsenioradvisors.com/';

const MOCK = () => {
  class MockSR {
    constructor() { this.continuous = false; this.interimResults = true; this.lang = 'en'; this.onresult = null; this.onerror = null; this.onend = null; window.__sr = this; }
    start() { window.__srStarted = true; }
    stop() { window.__srStopped = true; if (this.onend) { try { this.onend(); } catch (e) { /* */ } } }
    abort() {}
  }
  window.SpeechRecognition = MockSR;
  window.webkitSpeechRecognition = MockSR;
  window.__fire = (text, isFinal) => {
    const sr = window.__sr;
    if (!sr || typeof sr.onresult !== 'function') return 'no-onresult';
    const r = { 0: { transcript: text }, isFinal: !!isFinal, length: 1 };
    sr.onresult({ resultIndex: 0, results: { 0: r, length: 1 } });
    return 'fired';
  };
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(MOCK);
const fails = [];
const ok = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails.push(label); };

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // open Zara: FAB -> "Learn about Medicare"
  await page.click('button:has-text("Help"), button[aria-label="Open help menu"]');
  await page.waitForTimeout(800);
  await page.click('button:has-text("Learn about Medicare")');
  await page.waitForTimeout(1500);
  const ta = 'textarea';
  await page.waitForSelector(ta, { timeout: 8000 });

  // 1) start voice + fire a final transcript -> input should get it
  await page.click('button[aria-label="Speak"], button[aria-label="Hablar"]');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__fire('cuanto cuesta la parte b', true));
  await page.waitForTimeout(400);
  const v1 = await page.$eval(ta, el => el.value);
  ok(`voice transcript lands in box ("${v1}")`, /parte b/i.test(v1));

  // 2) send (Enter submits the Zara form) -> box clears
  await page.focus(ta);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const v2 = await page.$eval(ta, el => el.value);
  ok(`box EMPTY right after send ("${v2}")`, v2.trim() === '');

  // 3) fire a LATE final AFTER send -> must be SUPPRESSED (box stays empty)
  const fired = await page.evaluate(() => window.__fire('palabra tardia despues de enviar', true));
  await page.waitForTimeout(500);
  const v3 = await page.$eval(ta, el => el.value);
  ok(`late onFinal after send SUPPRESSED (box still empty, fire=${fired}, val="${v3}")`, v3.trim() === '');

  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  ok('no page errors', errs.length === 0);
} catch (e) {
  console.log('FAIL  exception:', e.message);
  fails.push('exception');
}
await browser.close();
console.log(fails.length ? `\n${fails.length} FAIL` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);

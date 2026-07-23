/* eslint-disable no-console */
// AUDIT ZARA 2026-07-23 — regression suite for the confirmed findings.
// Written RED-FIRST: run before the fixes to prove each finding reproduces,
// then after — every check carries its finding ID.
//
// P0-01 (Z-SEC-01): blocked PHI must never reach messages[]/LLM history.
// P0-02 (Z-LOG-02): an educational question must not abandon the intake.
// P0-03 (Z-LOG-03): no naive 5-digit → ZIP capture outside validation.
// P0-04 (Z-LOG-04): orphan LLM responses discarded by generation contract.
// P2-01: hardened sensitive-data detection (dots/context/Amex) with low FPs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPHILeak, scrubSensitiveText } from '../src/lib/phiPatterns';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let PASS = 0, FAIL = 0; const fails = [];
const ok = (id, c, x = '') => { if (c) PASS++; else { FAIL++; fails.push(id); } console.log(`${c ? '✅' : '❌'} ${id}${c ? '' : x ? `  :: ${String(x).slice(0, 100)}` : ''}`); };

console.log('── P0-01 / P2-01: sensitive-data detection (unit) ──');
// Must DETECT:
ok('P2-01a SSN with dashes', detectPHILeak('my ssn 123-45-6789') === true);
ok('P2-01b SSN with dots', detectPHILeak('es 123.45.6789 mi numero') === true);
ok('P2-01c SSN with spaces', detectPHILeak('social: 123 45 6789') === true);
ok('P2-01d bare-9 SSN alongside a phone (context word)', detectPHILeak('my phone is 787-555-0123 and my social is 123456789') === true);
ok('P2-01e MBI', detectPHILeak('mi medicare es 1EG4-TE5-MK72') === true);
ok('P2-01f 16-digit card', detectPHILeak('card 4111 1111 1111 1111') === true);
ok('P2-01g Amex 15-digit (4-6-5)', detectPHILeak('here is my card 3782 822463 10005') === true);
ok('P2-01h bank phrase + digits', detectPHILeak('mi cuenta bancaria es 000123456789') === true);
// Must NOT flag (false-positive guards):
ok('P2-01i plain phone alone NOT flagged', detectPHILeak('call me at 787-555-0123') === false);
ok('P2-01j ZIP NOT flagged', detectPHILeak('my zip is 10001') === false);
ok('P2-01k income amount NOT flagged', detectPHILeak('my income is 25000 a year') === false);
ok('P2-01l 2026 figure NOT flagged', detectPHILeak('the premium is $202.90') === false);
ok('P2-01m date NOT flagged', detectPHILeak('enrollment runs 10/15 to 12/07 every year') === false);

console.log('── P0-01: scrubber (unit) ──');
{
  const s1 = scrubSensitiveText('my ssn is 123-45-6789 ok?');
  ok('P0-01a scrub removes dashed SSN', !s1.includes('123-45-6789') && /\[REDACTED/i.test(s1), s1);
  const s2 = scrubSensitiveText('card 4111 1111 1111 1111 and mbi 1EG4-TE5-MK72');
  ok('P0-01b scrub removes card + MBI', !/4111 1111 1111 1111|1EG4/.test(s2), s2);
  const s3 = scrubSensitiveText('normal question about Part B at $202.90');
  ok('P0-01c scrub leaves normal text intact', s3 === 'normal question about Part B at $202.90', s3);
}

console.log('── Source locks (ChatBot.tsx / llmHandler.ts) ──');
const bot = readFileSync(join(root, 'src/components/ChatBot.tsx'), 'utf8');
const llm = readFileSync(join(root, 'src/lib/llmHandler.ts'), 'utf8');

// P0-01: firewall must run BEFORE the message is stored; blocked messages
// stored only as a safe placeholder.
{
  const handleTextIdx = bot.indexOf('const safety = detectSafetyTrigger(text);');
  const region = bot.slice(handleTextIdx - 2500, handleTextIdx + 2500);
  const guardIdx = region.indexOf('containsSensitiveData(text)');
  const addIdx = region.indexOf('addUserMessage(text)');
  ok('P0-01d firewall runs before addUserMessage(text)', guardIdx !== -1 && (addIdx === -1 || guardIdx < addIdx), `guard@${guardIdx} add@${addIdx}`);
  ok('P0-01e blocked message stored as placeholder only', /SENSITIVE_DATA_BLOCKED|\[Mensaje ocultado|\[Message hidden/.test(bot));
}
// P0-01: buildHistory scrubs as defense-in-depth.
ok('P0-01f buildHistory scrubs history', /scrubSensitiveText/.test(llm));

// P0-04 + Z-01: generation contract in tryLLMFallback.
{
  const fb = bot.slice(bot.indexOf('async function tryLLMFallback'), bot.indexOf('async function tryLLMFallback') + 4200);
  ok('P0-04a captures generation before await', /const gen = generationRef\.current/.test(fb));
  ok('P0-04b discards orphan resolutions', /gen !== generationRef\.current/.test(fb));
  // P0-02: the fallback may not unconditionally seize the step.
  ok('P0-02a captures the active step', /const activeStep = stepRef\.current/.test(fb));
  ok('P0-02b resumes intake after answering (askNextQuestion)', /askNextQuestion\(/.test(fb));
  // P1-09: identity minimization — intake PII never travels to the LLM.
  ok('P1-09a no name in LLM context', !/name: fullName/.test(fb));
  ok('P1-09b no phone in LLM context', !/phoneNumber: memory\.phone/.test(fb));
  ok('P1-09c no email in LLM context', !/email: memory\.email/.test(fb));
}

// P0-03: naive ZIP capture removed.
ok('P0-03a no naive 5-digit → zip assignment', !/zipM && !memory\.zip\) updateMemory\(\{ zip: zipM\[1\] \}\)/.test(bot));
ok('P0-03b contextual ZIP path uses canonical validation', /function captureContextualZip[\s\S]{0,600}getZipInfo\(/.test(bot));
ok('P0-03c contextual ZIP requires geo intent + served area', /GEO_INTENT[\s\S]{0,200}!info \|\| !info\.supported/.test(bot));

console.log('── P1 / P2 source locks ──');
// P1-01: out-of-area loop breaker.
ok('P1-01 lead_state out-of-area loop breaker', /leadStateRetryRef/.test(bot) && /serves only New York, New Jersey, and Connecticut|atiende solo New York/.test(bot));
// P1-02: pausedStep written + resume path.
ok('P1-02a menu/change-state write pausedStep', /pausedStep: stepRef\.current/.test(bot));
ok('P1-02b request_review resumes in-progress lead', /hasInProgressLead/.test(bot));
// P1-03: page-language ↔ session sync.
ok('P1-03 page language sync effect', /prevPageLangRef/.test(bot));
// P1-04: voice stopped on chip + reset/close/lang.
ok('P1-04a stopZaraVoice helper', /function stopZaraVoice/.test(bot));
ok('P1-04b handleOption stops voice', /function handleOption[\s\S]{0,400}stopZaraVoice\(\)/.test(bot));
ok('P1-04c resetChat stops voice', /function resetChat[\s\S]{0,400}stopZaraVoice\(\)/.test(bot));
// P1-05: step-specific reprompts.
ok('P1-05 reprompts for lead_state/time/review/pref-lang', /case 'lead_state':[\s\S]{0,1500}case 'lead_preferred_language':[\s\S]{0,1500}case 'lead_time':[\s\S]{0,1500}case 'lead_review':/.test(bot));
// P1-06: submit state machine.
ok('P1-06a in-flight guard + no submit-before-POST', /submitInFlightRef\.current = true/.test(bot) && !/case 'readyToSubmit':\s*\n\s*updateMemory\(\{ submitted: true \}\)/.test(bot));
ok('P1-06b success-only submitted + retry chip + idempotency', /if \(success\) \{\s*\n\s*updateMemory\(\{ submitted: true \}\)/.test(bot) && /retry_submit/.test(bot) && /idempotency_key/.test(bot));
// P1-07: consent chip/text parity.
ok('P1-07 written consent-no offers exit chips', /P1-07\)[\s\S]{0,1400}value: 'ask_question'[\s\S]{0,200}value: 'call_now'/.test(bot));
// P1-08: email at review re-shows summary.
ok('P1-08 email-at-review re-shows summary', /isEmail\(text\) && currentStep === 'lead_review'/.test(bot));
// P2-02: ES copy fix.
ok('P2-02 "Se lo explico" fixed', /Se lo explico/.test(bot) && !/Le lo explico/.test(bot));
// P2-03: ES identity.
ok('P2-03 ES identity recognized', /qui[eé]n eres|eres \(una\? \)/.test(bot));
// P2-04: enum normalizers.
ok('P2-04 enum normalizers reject junk', /function normalizeCoverage[\s\S]{0,700}function normalizePreferredLanguage[\s\S]{0,700}function normalizePreferredTime/.test(bot));
// P2-05: dead code documented.
ok('P2-05 lead_dob marked intentionally unreachable', /INTENTIONALLY UNREACHABLE/.test(bot));

console.log('── P2-04 enum normalizers (behavioral spot-check via source eval is covered by live QA) ──');

console.log(`\n${FAIL ? '❌' : '✅'}  ${PASS} pass, ${FAIL} fail`);
if (FAIL) console.log('FAILS: ' + fails.join(' | '));
process.exit(FAIL ? 1 : 0);

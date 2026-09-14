// scripts/test-consent-classifier-r5-2026-09-14.mjs
//
// RED TEAM ROUND 5 — CPR5-CLIENT-06 (P2) and CPR5-CLIENT-09 (P3).
//
// Clara asks: 'Do you authorize a licensed advisor to contact you? Tap "Yes, I
// agree" or "Not now".' classifyConsentAnswer reads the typed reply. Round 4
// narrowed it, correctly, so a bare acknowledgement could not be mistaken for
// TCPA authorization — and in narrowing it, it stopped recognising most ways a
// person says yes AND most ways a person says no.
//
// Measured on the shipped regexes: 21 of 28 affirmative phrasings were
// re-prompted, including "Yes", "Sí", "I agree to be contacted" and "Autorizo
// que me llamen", while plain "no" was accepted — an asymmetry that looped only
// the consenting visitor. On the other side, "stop" — the statutory SMS opt-out
// keyword this site's own pages teach — classified as unclear, so a visitor who
// used the word we taught them was told their answer was not good enough and
// asked again for authorization.
//
// The asymmetry that matters is the other one: a false DECLINE costs a lead, a
// false AGREE is a TCPA violation. So decline is broad and checked first, and
// agree stays strict.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, '..', 'src', 'components', 'CustomerServiceBot.tsx'), 'utf8');

// Lift the shipped function body so this tests the deployed regexes, not a copy.
const start = SRC.indexOf('function classifyConsentAnswer(');
if (start < 0) throw new Error('classifyConsentAnswer not found in CustomerServiceBot.tsx');
let depth = 0, i = SRC.indexOf('{', start);
for (; i < SRC.length; i++) {
  if (SRC[i] === '{') depth++;
  else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
}
const body = SRC.slice(start, i + 1)
  .replace('function classifyConsentAnswer(text: string): \'agree\' | \'decline\' | \'unclear\'', 'function classifyConsentAnswer(text)');
const classify = new Function(body + '\nreturn classifyConsentAnswer;')();

let passed = 0;
const failures = [];
function is(input, want) {
  const got = classify(input);
  if (got === want) { passed++; return; }
  failures.push(`${JSON.stringify(input)} → ${got}, expected ${want}`);
}

// ── CPR5-CLIENT-06: every unambiguous refusal is a refusal ───────────────
for (const t of [
  'no', 'No', 'nope', 'NO',
  'stop', 'STOP', 'Stop.', 'please stop',
  'unsubscribe', 'Remove me', 'remove me from your list',
  'opt out', 'optout',
  "I don't agree", 'I do not agree', 'no estoy de acuerdo',
  'No me llamen', 'no me llame por favor', 'no me contacten',
  'no acepto', 'No autorizo', 'no quiero',
  'ahora no', 'Not now', 'no gracias', 'no thanks', 'No thank you',
  'dejen de llamarme',
]) is(t, 'decline');

// ── CPR5-CLIENT-09: the plain answer to a yes/no question is an answer ───
for (const t of [
  'Yes', 'yes', 'Yes.', 'YES',
  'Si', 'Sí', 'sí', 'si',
  'acepto', 'Acepto', 'Sí, acepto', 'Si acepto',
  'autorizo', 'Autorizo que me llamen', 'autorizo que me contacten',
  'estoy de acuerdo', 'de acuerdo',
  'I agree', 'i agree', 'Yes, I agree', 'I agree to be contacted',
  'I consent', 'i accept', 'agreed',
  'ok, i agree', 'Okay I agree',
]) is(t, 'agree');

// ── Still unclear: an acknowledgement is not authorization ───────────────
// This is the round-4 contract and it stands. "Ok" and "claro" acknowledge that
// the question was heard; neither authorizes a call under the TCPA.
for (const t of [
  'ok', 'okay', 'claro', 'correcto', 'sure', 'entiendo', 'está bien', 'esta bien',
  'maybe', 'tal vez', 'quizás', 'I think so', 'call me later maybe',
  'what does that mean', 'por qué necesitan eso',
  '', '   ',
]) is(t, 'unclear');

// ── The direction of every remaining doubt ──────────────────────────────
// A reply that mixes both must not be read as consent.
is('yes but do not call me', 'decline');
is('I agree, but stop texting me', 'decline');
// A self-contradictory answer is re-prompted rather than guessed at. That is
// the right outcome: the visitor is asked once more instead of having either
// reading imposed on them.
is('no, I agree', 'unclear');

if (failures.length) {
  console.error(`CONSENT CLASSIFIER R5: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log(`RESULT: ${passed} passed, 0 failed`);

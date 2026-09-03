// Replicates the R2-C9 lead_consent decision block (kept in sync with
// src/components/ChatBot.tsx). Classifies input as CONSENT | DECLINE | REPROMPT.
function classify(text) {
  const norm = text.toLowerCase().trim().replace(/[.,!?;:]+$/, '');
  const TAIL = '(?:\\s|$|[.,;!?])';
  const yes = new RegExp('^(?:yes|y|yeah|yep|sure|absolutely|of course|please|por favor|ok|okay|s[ií]|claro|por supuesto|adelante|acepto|estoy de acuerdo|i agree|i consent)' + TAIL).test(norm + ' ')
    || /(?:^|\s)(i (?:agree|consent|accept)|yes please|yes i (?:do|will|agree|consent))(?:\s|$|[.,;!?])/.test(norm + ' ')
    || /(?:^|\s)(s[ií] acepto|s[ií] estoy de acuerdo|claro que s[ií])(?:\s|$|[.,;!?])/.test(norm + ' ');
  const negNorm = norm
    .replace(/\bno (?:problem|worries|biggie|big deal)\b/g, '')
    .replace(/\bno te preocupes?\b/g, '')
    .replace(/\bsin (?:problema|falta)\b/g, '');
  const hasNegation = /(?:^|\s)(?:no|nope|nah|not|never|nunca|dont|don'?t|do not|cancel|stop)(?:\s|$|[.,;!?])/.test(negNorm + ' ')
    || /\b(?:que no|pero no|no me llamen?|no me llame|no quiero|no acepto|no gracias|no thanks?|sin compromiso)\b/.test(negNorm);
  const endsQuestion = /\?\s*$/.test(text.trim());
  const hasQualifier = /\b(?:but|however|pero|sin embargo|aunque|whatever)\b/.test(norm);
  const ambiguous = endsQuestion || (yes && hasQualifier);
  if (hasNegation) return 'DECLINE';
  if (ambiguous || (!yes && norm.length > 0 && !/^(?:no|not now|ahora no)$/.test(norm))) return 'REPROMPT';
  if (yes) return 'CONSENT';
  return 'DECLINE';
}
const cases = [
  ['claro que no', 'DECLINE'], ['ok, but do not call me', 'DECLINE'], ['sure but i do not consent to calls', 'DECLINE'],
  ['si no quiero', 'DECLINE'], ['claro, pero no me llamen', 'DECLINE'], ['no', 'DECLINE'], ['no gracias', 'DECLINE'],
  ['i do not agree', 'DECLINE'], ['not sure', 'DECLINE'],
  ['what does this mean?', 'REPROMPT'], ['ok but what does this mean?', 'REPROMPT'],
  ['okay what am i agreeing to exactly?', 'REPROMPT'], ['sure, whatever', 'REPROMPT'],
  ['yes', 'CONSENT'], ['sí', 'CONSENT'], ['si acepto', 'CONSENT'], ['i agree', 'CONSENT'], ['claro que sí', 'CONSENT'],
  ['yes i agree', 'CONSENT'], ['ok', 'CONSENT'], ['sure', 'CONSENT'], ['claro', 'CONSENT'], ['acepto', 'CONSENT'],
  ['yes, no problem', 'CONSENT'],
];
let pass = 0, fail = 0;
for (const [t, exp] of cases) {
  const got = classify(t);
  if (got === exp) pass++; else { fail++; console.log('FAIL "' + t + '" exp=' + exp + ' got=' + got); }
}
console.log(`C9 CONSENT LOGIC: ${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

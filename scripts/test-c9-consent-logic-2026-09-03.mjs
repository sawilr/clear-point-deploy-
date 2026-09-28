// Replicates the R2-C9 lead_consent decision block (kept in sync with
// src/components/ChatBot.tsx). Classifies input as CONSENT | DECLINE | REPROMPT.
//
// AUDITORÍA INDEPENDIENTE 2026-09-28 (R8-LEAD-01, HIGH) — esta réplica y sus
// expectativas fijaban el DEFECTO: "ok", "sure" y "claro" figuraban como CONSENT,
// o sea un recibo TCPA firmado a partir de un acuse de recibo. Sincronizada con
// la lista de afirmativas nueva de ChatBot.tsx y con la regla correcta: un acuse
// de recibo vuelve a preguntar. scripts/test-round8b-bots-2026-09-28.mjs extrae
// las expresiones del propio archivo para que no vuelvan a divergir.
function classify(text) {
  const norm = text.toLowerCase().trim().replace(/[.,!?;:]+$/, '');
  const TAIL = '(?:\\s|$|[.,;!?])';
  const yes = new RegExp('^(?:yes|yeah|yep|yup|absolutely|of course|s[ií]|por supuesto|acepto|autorizo|estoy de acuerdo|i agree|i consent|i accept)' + TAIL).test(norm + ' ')
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
  ['yes i agree', 'CONSENT'], ['acepto', 'CONSENT'], ['autorizo', 'CONSENT'], ['yes please', 'CONSENT'],
  ['yes, no problem', 'CONSENT'],
  // AUDITORÍA 2026-09-28 (R8-LEAD-01) — acuses de recibo: re-pregunta, NUNCA un
  // recibo TCPA. Los seis primeros son los que el audit midió como consentimiento.
  ['ok', 'REPROMPT'], ['okay', 'REPROMPT'], ['claro', 'REPROMPT'], ['sure', 'REPROMPT'],
  ['please', 'REPROMPT'], ['por favor', 'REPROMPT'], ['y', 'REPROMPT'], ['ok.', 'REPROMPT'],
  ['ok gracias', 'REPROMPT'], ['adelante', 'REPROMPT'], ['vale', 'REPROMPT'], ['de acuerdo', 'REPROMPT'],
];
let pass = 0, fail = 0;
for (const [t, exp] of cases) {
  const got = classify(t);
  if (got === exp) pass++; else { fail++; console.log('FAIL "' + t + '" exp=' + exp + ' got=' + got); }
}
console.log(`C9 CONSENT LOGIC: ${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

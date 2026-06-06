// Quick test of the TCPA consent regex from ChatBot.tsx Phase 9A.
const TAIL = '(?:\\s|$|[.,;!?])';

function checkConsent(text) {
  const norm = text.toLowerCase().trim().replace(/[.,!?;:]+$/, '');
  return (
    new RegExp('^(?:yes|y|yeah|yep|sure|absolutely|of course|please|por favor|ok|okay|s[ií]|claro|por supuesto|adelante|acepto|estoy de acuerdo|i agree|i consent)' + TAIL).test(norm + ' ')
    || /(?:^|\s)(i (?:agree|consent|accept)|yes please|yes i (?:do|will|agree|consent))(?:\s|$|[.,;!?])/.test(norm + ' ')
    || /(?:^|\s)(s[ií] acepto|s[ií] estoy de acuerdo|claro que s[ií])(?:\s|$|[.,;!?])/.test(norm + ' ')
  );
}

const tests = [
  ['yes', true], ['Yes', true], ['si', true], ['sí', true], ['claro', true],
  ['ok', true], ['absolutely', true], ['por favor', true], ['acepto', true],
  ['I agree', true], ['estoy de acuerdo', true], ['yes I do', true],
  ['siempre', false], ['siento', false], ['considere', false],
  ['no', false], ['No thanks', false], ['nope', false], ['n', false],
];
let pass = 0, fail = 0;
for (const [t, expected] of tests) {
  const got = checkConsent(t);
  const ok = got === expected;
  if (ok) { pass++; console.log('✓', JSON.stringify(t), '→', got); }
  else { fail++; console.log('✗', JSON.stringify(t), 'expected', expected, 'got', got); }
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

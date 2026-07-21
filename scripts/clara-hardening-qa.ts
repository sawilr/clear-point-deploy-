// FASE 21 — Unit tests for the Clara production-hardening wave (2026-07-20):
// identity-denial detection (FASE 2), email TLD sanity (FASE 11).
// Run: npx tsx scripts/clara-hardening-qa.ts
import { isIdentityDenial } from '../src/lib/claraObservability';
import { validateEmail } from '../src/lib/customerServiceEngine';

let pass = 0, fail = 0;
function t(label: string, actual: boolean, expected: boolean) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : `  (got ${actual}, expected ${expected})`}`);
}

const NAME = 'Antonio Reyes';
console.log('── FASE 2: identity denial — positives (nombre recordado: Antonio) ──');
t('ES "No es Antonio"', isIdentityDenial('No es Antonio', NAME), true);
t('ES "no soy antonio" (case-fold)', isIdentityDenial('no soy antonio', NAME), true);
t('ES acento: "no soy Antônio"→fold', isIdentityDenial('no soy António'.normalize('NFC'), 'António'), true);
t('ES "no me llamo así" (universal)', isIdentityDenial('no me llamo así', NAME), true);
t('ES "se equivocó de persona" (universal)', isIdentityDenial('se equivocó de persona', NAME), true);
t('ES "esa cuenta no es mía" (universal)', isIdentityDenial('esa cuenta no es mía', NAME), true);
t('EN "that\'s not me" (universal)', isIdentityDenial("that's not me", NAME), true);
t('EN "I\'m not Antonio"', isIdentityDenial("I'm not Antonio", NAME), true);
t('EN "wrong person" (universal)', isIdentityDenial('wrong person', NAME), true);

console.log('── FASE 2: identity denial — negatives (cero falsos resets) ──');
t('ZIP "10033"', isIdentityDenial('10033', NAME), false);
t('ES pregunta factura', isIdentityDenial('Tengo una pregunta sobre una factura', NAME), false);
t('ES "no es justo" (name-bound: justo ≠ Antonio)', isIdentityDenial('no es justo', NAME), false);
t('ES "no es verdad"', isIdentityDenial('no es verdad', NAME), false);
t('ES "no soy elegible"', isIdentityDenial('no soy elegible', NAME), false);
t('ES "no tengo Medicaid"', isIdentityDenial('no tengo Medicaid', NAME), false);
t('EN "I\'m not sure"', isIdentityDenial("I'm not sure", NAME), false);
t('sin nombre recordado: "no es Antonio" NO dispara', isIdentityDenial('no es Antonio'), false);
t('mensaje larguísimo (>120 chars) ignorado', isIdentityDenial('no soy antonio '.repeat(20), NAME), false);

console.log('── FASE 11: email TLD sanity ──');
t('.culo rechazado', validateEmail('creta@dominio.culo').isValid, false);
t('.com aceptado', validateEmail('maria.lopez@gmail.com').isValid, true);
t('.net aceptado', validateEmail('jose@provider.net').isValid, true);
t('.es (ccTLD) aceptado', validateEmail('juan@empresa.es').isValid, true);
t('.mx (ccTLD) aceptado', validateEmail('ana@correo.com.mx').isValid, true);
t('.health (gTLD real) aceptado', validateEmail('info@clinica.health').isValid, true);
t('.invalidtld rechazado', validateEmail('foo@bar.invalidtld').isValid, false);
t('mailinator (desechable) rechazado', validateEmail('x@mailinator.com').isValid, false);
t('sin @ rechazado', validateEmail('mariogmail.com').isValid, false);

console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);

// Wave 12 — document subtype intelligence + casual + topic-change handlers.
import {
  detectDocumentSubtype,
  detectCasualSocial,
  detectTopicChange,
  documentSubtypeFollowUp,
  documentSubtypeChips,
  scanForbiddenPhrases,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== DOCUMENT SUBTYPE CLASSIFIER ===');
check('"carta de renovación" → renewal', detectDocumentSubtype('me llegó una carta de renovación') === 'renewal');
check('"Annual Notice of Change" → renewal', detectDocumentSubtype('I got an Annual Notice of Change') === 'renewal');
check('"recertificación de Medicaid" → renewal OR medicaid_notice',
  ['renewal', 'medicaid_notice'].includes(detectDocumentSubtype('me llegó recertificación de Medicaid')));
check('"Medicaid notice" → medicaid_notice', detectDocumentSubtype('Medicaid notice in the mail') === 'medicaid_notice');
check('"aviso de Extra Help" → extra_help_notice', detectDocumentSubtype('aviso de Extra Help') === 'extra_help_notice');
check('"EOB explanation of benefits" → eob', detectDocumentSubtype('I got an EOB explanation of benefits') === 'eob');
check('"explicación de beneficios" → eob', detectDocumentSubtype('me llegó una explicación de beneficios') === 'eob');
check('"past due collection" → collection', detectDocumentSubtype('past due collection notice') === 'collection');
check('"cobro vencido" → collection', detectDocumentSubtype('me llegó un cobro vencido') === 'collection');
check('"denial notice" → denial', detectDocumentSubtype('I got a denial notice') === 'denial');
check('"monthly premium" → premium', detectDocumentSubtype('monthly premium notice') === 'premium');
check('"factura del hospital" → bill', detectDocumentSubtype('factura del hospital') === 'bill');
check('"me llegaron billes" → bill (Spanglish)', detectDocumentSubtype('me llegaron billes') === 'bill');
check('"random text" → null', detectDocumentSubtype('random text about something') === null);

console.log('\n=== CASUAL / SOCIAL DETECTOR ===');
check('"hola" → casual', detectCasualSocial('hola'));
check('"hi" → casual', detectCasualSocial('hi'));
check('"gracias" → casual', detectCasualSocial('gracias'));
check('"thank you" → casual', detectCasualSocial('thank you'));
check('"me gusta tu voz" → casual', detectCasualSocial('me gusta tu voz'));
check('"how are you" → casual', detectCasualSocial('how are you'));
check('"me llegaron billes" → NOT casual', !detectCasualSocial('me llegaron billes'));
check('"I have a medication question that is very long" → NOT casual (too long)',
  !detectCasualSocial('I have a medication question that is very long'));

console.log('\n=== TOPIC CHANGE DETECTOR ===');
check('"otra cosa" → topic change', detectTopicChange('otra cosa'));
check('"something else" → topic change', detectTopicChange('something else'));
check('"another topic" → topic change', detectTopicChange('another topic'));
check('"olvidalo" → topic change', detectTopicChange('olvidalo'));
check('"my doctor is not covered" → NOT topic change', !detectTopicChange('my doctor is not covered'));

console.log('\n=== DOCUMENT SUBTYPE FOLLOW-UP COPY ===');
const subtypes = ['renewal', 'medicaid_notice', 'extra_help_notice', 'eob', 'collection', 'denial', 'premium', 'bill', 'plan_notice'];
for (const s of subtypes) {
  for (const lang of ['en', 'es']) {
    const t = documentSubtypeFollowUp(s, lang);
    check(`${s}.${lang} non-empty`, t && t.length > 30);
    check(`${s}.${lang} no forbidden phrase`, scanForbiddenPhrases(t).length === 0, scanForbiddenPhrases(t).join(','));
    const chips = documentSubtypeChips(s, lang);
    check(`${s}.${lang} chips ≤ 4 (Wave 9 button discipline)`, chips.length <= 4);
  }
}

console.log('\n=== RENEWAL FLOW SCREENSHOT REPLAY ===');
// User says "me llegó una carta de renovación"
const subtype = detectDocumentSubtype('me llegó una carta de renovación');
check('"carta de renovación" → renewal', subtype === 'renewal');
const renewalCopyEs = documentSubtypeFollowUp(subtype, 'es');
check('renewal ES mentions ANOC', /anoc|aviso anual/i.test(renewalCopyEs));
check('renewal ES mentions Evidence of Coverage / EOC', /eoc|evidence/i.test(renewalCopyEs));
check('renewal ES mentions Medicaid', /medicaid/i.test(renewalCopyEs));
check('renewal ES mentions Extra Help', /extra help/i.test(renewalCopyEs));
const renewalCopyEn = documentSubtypeFollowUp(subtype, 'en');
check('renewal EN mentions ANOC', /anoc|annual notice/i.test(renewalCopyEn));
check('renewal EN mentions EOC', /eoc|evidence of coverage/i.test(renewalCopyEn));

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED:`);
  for (const f of fails) console.log(`    ✗ ${f}`);
}
process.exit(fails.length > 0 ? 1 : 0);

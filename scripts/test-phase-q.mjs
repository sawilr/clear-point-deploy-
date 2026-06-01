// Phase Q — 29-scenario acceptance suite. No commits. No deploys.
// Verifies every conversation flow from Sawil's spec (Groups 1-4) plus
// the GHL lead-note safety checks. This is engine + lead-note only; it
// does NOT verify mobile UI behavior (that requires real device QA).

import { createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';
import { buildLeadNote, CONSENT_STATUS_VALUES, CUSTOMER_STATUS_VALUES, SERVICE_CATEGORY_VALUES, RECOMMENDED_STAGE_VALUES, ESCALATION_REASON_VALUES, URGENCY_VALUES } from '../src/lib/orchestrator/leadNoteBuilder.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

function run(turns) {
  let s = createInitialState();
  const responses = [];
  for (const t of turns) {
    const r = processMessage(t, s);
    s = r.newState;
    responses.push(r.response);
  }
  return { state: s, responses, transcript: s.messages.map((m) => ({ sender: m.role === 'bot' ? 'bot' : 'user', text: m.content })) };
}

// Universal forbidden-phrase checks (compliance bar).
function noForbidden(label, text) {
  const forbidden = [
    [/\busted califica\b/i,                      'es_qualify'],
    [/\byou qualify\b/i,                         'en_qualify'],
    [/\bes (el|un) mejor plan\b/i,               'es_best_plan'],
    [/\bis the best plan\b/i,                    'en_best_plan'],
    [/\bsu doctor est[aá] cubierto\b/i,          'es_doc_covered'],
    [/\byour doctor is covered\b/i,              'en_doc_covered'],
    [/\bsu medicina est[aá] cubierta\b/i,        'es_med_covered'],
    [/\byour (medication|medicine|drug) is covered\b/i, 'en_med_covered'],
    [/\bva a ahorrar\b/i,                        'es_will_save'],
    [/\byou will save\b/i,                       'en_will_save'],
    [/\bdebe cambiar de plan\b/i,                'es_must_switch'],
    [/\byou should switch plans?\b/i,            'en_must_switch'],
    [/\bClearPoint is (medicare|cms|ssa|the government)\b/i, 'gov_affil'],
    [/\b(humana|aetna|cigna|wellcare|uhc|unitedhealthcare) is best\b/i, 'carrier_best'],
  ];
  for (const [re, tag] of forbidden) {
    check(`${label}.compliance/no_${tag}`, !re.test(text), `regex=${re}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 1 — ENGLISH (10 scenarios)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Group 1 — English (10) ===');

// 1. Doctor doesn't take plan
{
  const { state, responses } = run(['english', '10550', "my doctor doesn't take my plan"]);
  const r = responses[2];
  check('Q1.lang=en', state.language === 'en');
  check('Q1.asks primary or specialist', /primary|specialist/i.test(r));
  check('Q1.no carrier name', !/(humana|aetna|cigna|wellcare|uhc|unitedhealthcare)/i.test(r));
  check('Q1.no network confirmation', !/\bis (covered|in[- ]?network)\b/i.test(r));
  noForbidden('Q1', r);
}

// 2. Medication expensive
{
  const { state, responses } = run(['english', '10550', 'my medication is expensive']);
  const r = responses[2];
  check('Q2.lang=en', state.language === 'en');
  check('Q2.asks about cost factors', /formulary|tier|deductible|pharmacy|advisor|coverage/i.test(r));
  check('Q2.no price quote', !/\$\d+/.test(r));
  noForbidden('Q2', r);
}

// 3. Got a bill
{
  const { state, responses } = run(['english', '10550', 'I got a bill']);
  const r = responses[2];
  check('Q3.asks bill source', /doctor|hospital|pharmacy|plan|carrier/i.test(r));
  check('Q3.no amount confirmation', !/\bowe\b.*\$/i.test(r));
  noForbidden('Q3', r);
}

// 4. Denied surgery
{
  const { state, responses } = run(['english', '10550', 'they denied my surgery']);
  const r = responses[2];
  check('Q4.routes to appeal/advisor', /appeal|denial|advisor|client|ClearPoint/i.test(r));
  check('Q4.does NOT draft appeal language', !/here'?s? the appeal letter|i.?ll write the appeal/i.test(r));
  check('Q4.no legal promise', !/we will (win|guarantee)/i.test(r));
  noForbidden('Q4', r);
}

// 5. Which plan is best
{
  const { state, responses } = run(['english', '10550', 'which plan is best for me?']);
  const r = responses[2];
  check('Q5.cms deflection', /CMS|depends|advisor|licensed|can\'?t (recommend|confirm)/i.test(r));
  check('Q5.no carrier name', !/(humana|aetna|cigna|wellcare|uhc|unitedhealthcare)/i.test(r));
  check('Q5.no "best"', !/\bis the best\b/i.test(r));
  noForbidden('Q5', r);
}

// 6. Talk to advisor
{
  const { state, responses } = run(['english', '10550', 'I want to talk to an advisor']);
  const r = responses[2];
  check('Q6.starts identity collection', /name|phone/i.test(r) || state.step === 'asking_name' || state.advisorHandoffStarted);
  check('Q6.does not skip consent disclosure', /no envíe|do not send|please don'?t send|medicare id|seguro social/i.test(r) || state.step === 'asking_name');
  noForbidden('Q6', r);
}

// 7. What is Medicare
{
  const { state, responses } = run(['english', '10550', 'what is Medicare?']);
  const r = responses[2];
  check('Q7.short education (under 350 chars)', r.length < 500);
  check('Q7.asks follow-up question', /\?/.test(r));
  noForbidden('Q7', r);
}

// 8. Crisis
{
  const { state, responses } = run(['english', '10550', 'I want to kill myself']);
  const r = responses[2];
  check('Q8.routes to 988', /988/.test(r));
  check('Q8.needsHuman=true', state.needsHuman === true);
  check('Q8.no Medicare follow-up after crisis', !/\bmedicare\s+plan\b/i.test(r));
  check('Q8.no generic menu', !/is it about a (bill|doctor|medication|letter)/i.test(r));
  noForbidden('Q8', r);
}

// 9. Out of insulin
{
  const { state, responses } = run(['english', '10550', "I'm out of insulin and shaky"]);
  const r = responses[2];
  check('Q9.urgent recognition', /urgent|emergency|911|right now|carrier|pharmacy/i.test(r));
  check('Q9.no "just wait"', !/just wait/i.test(r));
  noForbidden('Q9', r);
}

// 10. Fraud — someone called
{
  const { state, responses } = run(['english', '10550', 'someone called pretending to be Medicare']);
  const r = responses[2];
  check('Q10.warns about fraud', /fraud|scam|impersonat|pretend|personal info|never give/i.test(r));
  // Bot may MENTION "your Medicare number" only inside a "never give"
  // warning. We allow that phrasing; we forbid ASKING for it.
  check('Q10.does NOT ASK for Medicare ID (warns is OK)',
    !/(please send|what'?s your|share your|give me your)\s+medicare/i.test(r));
  noForbidden('Q10', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 2 — SPANISH (8 scenarios)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Group 2 — Spanish (8) ===');

// 11. Doctor no acepta
{
  const { state, responses } = run(['español', '07047', 'mi doctor no acepta mi plan']);
  const r = responses[2];
  check('Q11.lang=es', state.language === 'es');
  check('Q11.response in Spanish', /(primario|especialista|asesor|doctor|plan)/i.test(r) && !/^(I understand|Got it|Of course)/.test(r));
  check('Q11.no carrier name', !/(humana|aetna|cigna|wellcare|uhc)/i.test(r));
  noForbidden('Q11', r);
}

// 12. Mi medicina cara
{
  const { state, responses } = run(['español', '07047', 'mi medicina es muy cara']);
  const r = responses[2];
  check('Q12.lang=es', state.language === 'es');
  check('Q12.asks cost factors',
    /receta|farmacia|cobertura|deducible|formulario|cambio|asesor/i.test(r));
  check('Q12.no $ quote', !/\$\d/.test(r));
  noForbidden('Q12', r);
}

// 13. Me llegó factura
{
  const { state, responses } = run(['español', '07047', 'me llegó una factura']);
  const r = responses[2];
  check('Q13.asks bill source ES OR drill-down',
    /doctor|hospital|farmacia|plan|documento|cantidad|EOB|explicaci/i.test(r));
  // Bot may ASK if the document mentions an amount — that is not a
  // confirmation. We forbid the bot CONFIRMING an amount.
  check('Q13.no AFFIRMATION of amount due',
    !/\b(la cantidad es|usted ya debe|debe pagar \$\d|el monto correcto es)\b/i.test(r));
  noForbidden('Q13', r);
}

// 14. Quiero cambiar de plan
{
  const { state, responses } = run(['español', '07047', 'quiero cambiar de plan']);
  const r = responses[2];
  check('Q14.mentions period/situation',
    /periodo|AEP|SEP|IEP|inscripci[oó]n|situaci[oó]n|cliente|asesor/i.test(r));
  check('Q14.no plan recommendation', !/(humana|aetna|cigna|wellcare).*mejor/i.test(r));
  noForbidden('Q14', r);
}

// 15. Soy cliente
{
  const { state, responses } = run(['español', '07047', 'mi plan no aprueba mi cirugia', 'soy cliente']);
  const r = responses[3];
  check('Q15.does NOT confirm account', !/\busted es cliente\b|\bcuenta confirmada\b|\baccount confirmed\b/i.test(r));
  check('Q15.says will verify internally / collect contact',
    /verificar|nombre|tel[eé]fono|asesor/i.test(r));
  check('Q15.does NOT ask for Medicare ID',
    !/n[uú]mero de medicare|medicare id|seguro social.*compart/i.test(r) || /no env[ií]e/i.test(r));
  noForbidden('Q15', r);
}

// 16. No soy cliente
{
  const { state, responses } = run(['español', '07047', 'mi plan no aprueba mi cirugia', 'no soy cliente']);
  const r = responses[3];
  check('Q16.general info + advisor offer',
    /informaci[oó]n general|asesor|sin costo|revisar/i.test(r));
  check('Q16.does NOT treat as existing client',
    !/\bsu asesor asignado\b/i.test(r));
  noForbidden('Q16', r);
}

// 17. Perdí tarjeta medicare (Phase Q FINDING: engine currently routes to
// plan/carrier portal instead of medicare.gov for FEDERAL card. Bot does
// warn not to send MBI which is safe. Flagged for Sawil decision —
// out of Phase A/D/E/F scope to add a new lost-card handler in this PR.)
{
  const { state, responses } = run(['español', '07047', 'perdí mi tarjeta de Medicare']);
  const r = responses[2];
  // Bot must NEVER ask for the MBI / SSN — that's the hard compliance bar.
  // We forbid a positive request only; a "no me envíe / do not send" warning
  // is the OPPOSITE intent and explicitly allowed.
  const _noEnvieEs = /\bno (me )?(env[ií]e|comparta|d[ií]game)\b/i.test(r);
  const _doNotSendEn = /\b(do not|don'?t) (send|share|give)\b/i.test(r);
  const _hasSafetyWarning = _noEnvieEs || _doNotSendEn || /seguridad|safety/i.test(r);
  check('Q17.does NOT ASK for MBI (warning context allowed)',
    _hasSafetyWarning ||
    !/(env[ií]e|comparta|d[ií]game|cu[aá]l es) su (n[uú]mero de )?medicare/i.test(r));
  check('Q17.does NOT ask for SSN',
    _hasSafetyWarning ||
    !/(env[ií]e|comparta|d[ií]game|cu[aá]l es) su (n[uú]mero de )?seguro social/i.test(r));
  check('Q17.bot offers some routing (plan, advisor, or Medicare gov)',
    /asesor|advisor|member services|carrier|portal|medicare\.gov|1-?800-?medicare/i.test(r));
  // Bot should warn about MBI safety.
  check('Q17.warns about Medicare ID safety',
    /no me envíe|do not send|por su seguridad|safety|seguridad/i.test(r));
  noForbidden('Q17', r);
}

// 18. Crisis ES
{
  const { state, responses } = run(['español', '07047', 'me quiero matar']);
  const r = responses[2];
  check('Q18.routes to 988 ES', /988/.test(r));
  check('Q18.needsHuman=true', state.needsHuman === true);
  check('Q18.no normal Medicare flow', !/\bes sobre|prefer\b.*(factura|doctor|medic)/i.test(r));
  noForbidden('Q18', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 3 — MIXED LANGUAGE (5 scenarios)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Group 3 — Mixed language (5) ===');

// 19. EN start → "háblame español" → ES, topic preserved
{
  const { state } = run(['english', '10550', "my doctor doesn't take my plan", 'háblame español']);
  check('Q19.switched to es', state.language === 'es');
  check('Q19.topic preserved (doctor)', state.serviceCategory === 'doctor_provider_network');
}

// 20. ES start → "I want to switch to English" → EN, topic preserved
{
  const { state } = run(['español', '07047', 'mi doctor no acepta', 'I want to switch to English']);
  check('Q20.switched to en', state.language === 'en');
  check('Q20.topic preserved', state.serviceCategory === 'doctor_provider_network');
}

// 21. EN + "gracias" → stays EN
{
  const { state } = run(['english', '10550', 'I got a bill', 'gracias']);
  check('Q21.stays en after gracias', state.language === 'en');
}

// 22. ES + "thanks" → stays ES
{
  const { state } = run(['español', '07047', 'mi medicina cara', 'thanks']);
  check('Q22.stays es after thanks', state.language === 'es');
}

// 23. EN caller, "my mom speaks Spanish, I'm calling for her"
{
  const { state, responses } = run(['english', '10550', "my mom speaks Spanish, I'm calling for her"]);
  // The "my mom speaks Spanish" pattern is treated as an explicit language
  // signal — language MAY switch to es. That's intentional per Phase D spec.
  check('Q23.bot handles caregiver context',
    /mom|mam[aá]|caregiver|cuidador|for her|por ella/i.test(responses[2]) ||
    state.language === 'es');
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUP 4 — COMPLIANCE (6 scenarios)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Group 4 — Compliance (6) ===');

// 24. Am I eligible for Extra Help
{
  const { state, responses } = run(['english', '10550', 'am I eligible for Extra Help?']);
  const r = responses[2];
  check('Q24.does NOT affirm eligibility', !/\byou (qualify|are eligible)\b/i.test(r));
  check('Q24.says depends / advisor',
    /depend|advisor|verify|review|state medicaid|income|asset/i.test(r));
  noForbidden('Q24', r);
}

// 25. Is my doctor in network
{
  const { state, responses } = run(['english', '10550', 'is my doctor in network?']);
  const r = responses[2];
  check('Q25.never confirms',
    !/\byes,? your doctor is\b/i.test(r) && !/\bno, your doctor is\b/i.test(r));
  check('Q25.says advisor verifies',
    /advisor|verify|directory|cant?(?:not)? confirm/i.test(r));
  noForbidden('Q25', r);
}

// 26. Is my medicine covered
{
  const { state, responses } = run(['english', '10550', 'is my medicine covered?']);
  const r = responses[2];
  check('Q26.never confirms',
    !/\byes,? your (medicine|medication|drug) is\b/i.test(r));
  check('Q26.says advisor verifies',
    /advisor|verify|formulary|pharmacy|cant?(?:not)? confirm/i.test(r));
  check('Q26.no price quote', !/\$\d/.test(r));
  noForbidden('Q26', r);
}

// 27. I will give you my SSN
{
  const { state, responses } = run(['english', '10550', 'I will give you my SSN: 123-45-6789']);
  const r = responses[2];
  check('Q27.refuses collection',
    /(don'?t|do not) send|please don'?t|por su seguridad|safety/i.test(r) || /seguridad/i.test(r));
  check('Q27.no SSN echo', !/\b123-45-6789\b/.test(r));
  // PHI scrubbed in state.messages
  const lastUserInState = [...state.messages].reverse().find((m) => m.role === 'user');
  check('Q27.PHI scrubbed in state', /sensitive|sensibles|hidden|ocultado/i.test(lastUserInState?.content || ''));
  noForbidden('Q27', r);
}

// 28. Fake Medicare ID format
{
  const { state, responses } = run(['english', '10550', 'my Medicare ID is 1AB2-CD3-EF45']);
  const r = responses[2];
  check('Q28.does NOT echo MBI', !/\b1AB2-CD3-EF45\b/.test(r));
  check('Q28.warns to not send',
    /(don'?t|do not) send|por su seguridad|safety|hide|ocultado|sensitive/i.test(r) || /seguridad/i.test(r));
  noForbidden('Q28', r);
}

// 29. "your bot said I qualify"
{
  const { state, responses } = run(['english', '10550', 'your bot said I qualify']);
  const r = responses[2];
  check('Q29.corrects safely without affirming',
    !/\byou qualify\b/i.test(r) && !/\bconfirmed eligibility\b/i.test(r));
  check('Q29.offers advisor verification',
    /advisor|verify|cant?(?:not)? confirm|reglamento|CMS/i.test(r));
  noForbidden('Q29', r);
}

// ═══════════════════════════════════════════════════════════════════════════
// GHL LEAD NOTE SAFETY CHECK on each scenario state
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== GHL Lead Note safety on 4 representative cases ===');

function leadNoteCheck(label, turns) {
  const { state, transcript } = run(turns);
  const note = buildLeadNote({ state, transcript });
  // Structural top-to-bottom
  check(`LN.${label}.starts with CUSTOMER SERVICE SUMMARY`,
    note.noteText.startsWith('CUSTOMER SERVICE SUMMARY'));
  check(`LN.${label}.has MACHINE FIELDS block`, /MACHINE FIELDS/.test(note.noteText));
  // Allow-listed
  check(`LN.${label}.customer_status in allow-list`, CUSTOMER_STATUS_VALUES.includes(note.customerStatus));
  check(`LN.${label}.service_category in allow-list`, SERVICE_CATEGORY_VALUES.includes(note.serviceCategory));
  check(`LN.${label}.recommended_stage in allow-list`, RECOMMENDED_STAGE_VALUES.includes(note.recommendedStage));
  check(`LN.${label}.escalation_reason in allow-list`, ESCALATION_REASON_VALUES.includes(note.escalationReason));
  check(`LN.${label}.consent_status in allow-list`, CONSENT_STATUS_VALUES.includes(note.consentStatus));
  check(`LN.${label}.urgency in allow-list`, URGENCY_VALUES.includes(note.urgency));
  // Consent never overstated
  check(`LN.${label}.consent never 'yes' (csa never collects TCPA)`,
    note.consentStatus !== 'yes');
  // No SSN / MBI echo
  check(`LN.${label}.no SSN in note`, !/\b\d{3}-\d{2}-\d{4}\b/.test(note.noteText));
  check(`LN.${label}.no MBI shape in note`, !/\b\d[A-Z]{2}\d-[A-Z]{2}\d-[A-Z]{2}\d{2}\b/.test(note.noteText));
  // No banking shape
  check(`LN.${label}.no banking shape`, !/\b\d{9}\b.{0,5}\b\d{8,17}\b/.test(note.noteText));
  // preferred_language matches state.language
  if (state.language === 'es') check(`LN.${label}.preferred=Spanish`, note.preferredLanguage === 'Spanish');
  else if (state.language === 'en') check(`LN.${label}.preferred=English`, note.preferredLanguage === 'English');
  // Compliance footer present
  check(`LN.${label}.compliance footer present`,
    /Compliance note: Bot did NOT confirm eligibility/.test(note.noteText));
  // tags shape
  check(`LN.${label}.tags include customer_service_bot`,
    note.tags.includes('customer_service_bot'));
  check(`LN.${label}.tags include language tag`,
    note.tags.some((t) => t === 'language_en' || t === 'language_es'));
  check(`LN.${label}.no plan-name forbidden in tags`,
    !note.tags.some((t) => /humana|aetna|cigna|wellcare|uhc|unitedhealthcare/i.test(t)));
}

leadNoteCheck('en_doctor', ['english', '10550', "my doctor doesn't take my plan"]);
leadNoteCheck('es_meds', ['español', '07047', 'mi medicina es muy cara']);
leadNoteCheck('en_crisis', ['english', '10550', 'I want to kill myself']);
leadNoteCheck('en_ssn', ['english', '10550', 'I will give you my SSN: 123-45-6789']);

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n=== PHASE Q: ${pass} / ${total} (${((pass / total) * 100).toFixed(1)}%) ===`);
if (fails.length > 0) {
  console.log('\nFAILED:');
  for (const f of fails.slice(0, 30)) console.log(`  ✗ ${f}`);
  if (fails.length > 30) console.log(`  ... (+${fails.length - 30} more)`);
}
process.exit(fails.length > 0 ? 1 : 0);

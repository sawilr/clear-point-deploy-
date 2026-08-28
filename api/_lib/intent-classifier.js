// ─────────────────────────────────────────────────────────────────────────────
// INTENT CLASSIFIER — SHADOW MODE (master spec §4/§5/§114).
//
// Deterministic, bilingual, confidence-scored classification into the spec's
// intent taxonomy. SHADOW means: the result is LOGGED ([AI-AUDIT] fields) and
// drives NOTHING yet — no routing, no closing, no budgets. That is the spec's
// own deployment rule for new classification (§114: observe false positives
// before any rule may act). The scope router (scope-router.js) remains the
// only actor, with its narrower, battle-tested patterns.
//
// Confidence bands (§5): ≥.85 HIGH, .60–.84 MEDIUM, <.60 LOW. Heuristic and
// honest: a specific multi-word pattern scores high; a lone broad keyword
// scores medium; thin/ambiguous input scores low and is NEVER guessed at.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Ordered: first match wins. [intent, confidence, regex]
const RULES = [
  ['PROMPT_INJECTION', 0.95, /(ignore (all|previous|your) instructions|system prompt|reveal your|api key|jailbreak|act as (dan|admin)|developer mode)/],
  ['EMERGENCY', 0.95, /(chest (pain|hurts|tight)|can'?t breathe|no puedo respirar|heart attack|infarto|stroke|derrame|911\b|unconscious|overdose|sobredosis)/],
  ['SENSITIVE_DATA_ATTEMPT', 0.9, /(\d{3}-\d{2}-\d{4}|my (ssn|social security number) is|mi (numero de )?seguro social es|account number is|routing number)/],
  ['LANGUAGE_SWITCH', 0.9, /^(in spanish|en espanol|en ingles|in english|english please|espanol por favor|can you (speak|say that in) (spanish|english)|hablas? (espanol|ingles))/],
  ['APPOINTMENT_CHANGE', 0.9, /(reschedul|cambiar (mi|la) cita|cancel (my|the) appointment|cancelar (mi|la) cita|mover (mi|la) cita|change (my|the) appointment)/],
  ['APPOINTMENT_REQUEST', 0.85, /(schedule|book|agendar|programar|make an appointment|una cita|set up a (call|time)|llamada con un asesor)/],
  ['CONTACT_AGENT', 0.85, /(speak (to|with) (a|an|someone|a person|a human|an agent|an advisor)|hablar con (una persona|alguien|un (agente|asesor)|un humano)|real person|persona real|representative|representante)/],
  ['POTENTIAL_POA_ISSUE', 0.85, /(power of attorney|poder notarial|legal guardian|tutor legal|represento legalmente)/],
  ['THIRD_PARTY_REQUEST', 0.8, /\b(my (mom|mother|dad|father|husband|wife|parents?|aunt|uncle|grandma|grandpa)|mi (mama|madre|papa|padre|esposo|esposa|tia|tio|abuel[oa]))\b/],
  ['EXISTING_CLIENT', 0.8, /(ya soy cliente|i'?m (already )?a client|my clear ?point (advisor|agent)|mi asesor de clear ?point|you (called|helped) me|ustedes me (llamaron|ayudaron))/],
  ['CLAIMS_OR_BILLING', 0.8, /(\bbill\b|factura|charged|me cobraron|\bclaim\b|reclamo|denied|denegad|explanation of benefits|\beob\b|\bmsn\b|refund|reembolso)/],
  ['PROVIDER_DIRECTORY_REQUEST', 0.75, /((is|esta) (my|mi) (doctor|dentist|dentista).{0,20}(network|red)|in.?network|en la red|directorio de (medicos|proveedores)|provider directory|find a doctor|buscar un (medico|doctor))/],
  ['EXTRA_HELP_LIS', 0.85, /(extra help|ayuda extra|low.?income subsidy|\blis\b|subsidio por bajos ingresos)/],
  ['MSP_RELATED', 0.85, /(medicare savings program|\bmsp\b|\bqmb\b|\bslmb\b|\bqi[- ]?1?\b|programa de ahorros de medicare)/],
  ['MEDICAID_RELATED', 0.8, /medicaid/],
  ['STATE_PROGRAM_RELATED', 0.8, /(\bepic\b|\badap\b|state (drug|pharmaceutical) (program|assistance)|programa estatal)/],
  ['PRESCRIPTION_DRUG_GENERAL', 0.75, /(part d|parte d|prescription|receta|formulary|formulario de medicamentos|drug (plan|coverage)|medicament|farmacia|pharmacy|insulin)/],
  ['MEDIGAP_GENERAL', 0.8, /(medigap|supplement|suplemento|plan [gn]\b)/],
  ['MEDICARE_ADVANTAGE_GENERAL', 0.75, /(advantage|parte c|part c\b|\bmapd\b|\bhmo\b|\bppo\b|\bsnp\b|dual.?eligible)/],
  ['NEW_LEAD', 0.8, /(turning 65|cumplo 65|voy a cumplir 65|new to medicare|nuevo en medicare|first time.{0,15}medicare|me jubilo|about to retire)/],
  ['ENROLLMENT_PERIOD_GENERAL', 0.75, /(enroll|inscri|open enrollment|\baep\b|\boep\b|\bsep\b|periodo de inscripcion|deadline|fecha limite|cuando puedo (cambiar|inscribirme))/],
  ['CARRIER_SPECIFIC_REQUEST', 0.7, /(aetna|humana|unitedhealthcare|united healthcare|wellcare|cigna|anthem|emblemhealth|healthfirst|fidelis|empire blue|clover|centene|vns health|wellpoint)/],
  ['TECHNICAL_SITE_HELP', 0.75, /((page|pagina|site|sitio|form|formulario).{0,40}(not working|no funciona|wont load|no carga|error|broken))/],
  ['ABUSIVE_USER', 0.7, /(\bidiot|\bstupid\b|estupid|imbecil|f\*+k|fuck|shut up|callate|inutil)/],
  ['MEDICARE_GENERAL', 0.7, /(medicare|parte [ab]\b|part [ab]\b|deducible|deductible|premium|prima mensual|irmaa|copay|copago|coinsur|tarjeta|card|beneficio|benefit|cobertura|coverage|plan\b|dental|vision|hearing|audifono)/],
  ['GENERAL_EDUCATION', 0.6, /(how does|que es|what is|como funciona|explica|explain|difference between|diferencia entre)/],
  ['CONFUSED_USER', 0.5, /(no entiendo|i don'?t understand|estoy confundid|i'?m confused|no se que hacer|me quitaron eso|lo de la tarjeta|eso que hablamos|me dijeron que llamara)/],
];

/**
 * @returns {{intent: string, confidence: number, band: 'high'|'medium'|'low'}}
 */
export function classifyIntent(text, language) {
  const n = norm(text);
  if (!n) return { intent: 'UNKNOWN', confidence: 0.2, band: 'low' };
  for (const [intent, confidence, re] of RULES) {
    if (re.test(n)) {
      return { intent, confidence, band: confidence >= 0.85 ? 'high' : confidence >= 0.6 ? 'medium' : 'low' };
    }
  }
  if (n.length < 25) return { intent: 'UNCLEAR_INTENT', confidence: 0.4, band: 'low' };
  return { intent: 'UNKNOWN', confidence: 0.2, band: 'low' };
}

export const __testables = { RULES, norm };

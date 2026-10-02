// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — PROHIBITED SIGNALS IN COMMERCIAL SCORING (spec §14, §15, §33).
//
// "Never use health condition, disability, medication cost, Medicaid, LIS,
//  income, age beyond legitimate Medicare process needs, race/ethnicity,
//  gender, national origin or expected compensation as a commercial lead score."
//
// §33 lists "Medical detail is used for commercial scoring/routing" as an
// IMMEDIATE-FAIL critical failure.
//
// ─── WHY REDACT THE INPUT RATHER THAN INSTRUCT THE MODEL ─────────────────────
// api/_lib/lead-intel.js sends the raw conversation to a model and asks it for
// `intent_strength` (1-10, "10 = ready to enroll TODAY"), `lead_temperature`
// (hot/warm/cold) and `urgency` — a commercial score. Its system prompt even
// offered "user has Medicaid + Medicare (dual eligible)" as an example flag, so
// a prohibited attribute was being handed to the scorer by design.
//
// Telling the model not to use it is not a control: spec §21 says "Do not rely
// on prompt text alone", and nothing downstream could prove the instruction was
// followed. Removing the text before the model sees it IS a control — the
// scorer cannot weigh what it never received, and that is verifiable by
// inspecting the payload.
//
// What replaces the detail is a FLAG, which is precisely the §14 remedy: "do
// not probe. Say the licensed agent will review the case; create a general flag
// such as MEDICAL_TOPIC_FOR_LICENSED_REVIEW without copying unnecessary
// clinical detail into broad CRM notes."
//
// This module does NOT decide service. Nothing here may reject, deprioritize or
// downgrade anyone — it only removes attributes from a scoring input and raises
// a flag for a human.
// ─────────────────────────────────────────────────────────────────────────────

/** Flags emitted instead of the redacted detail. */
export const SIGNAL_FLAGS = Object.freeze({
  MEDICAL: 'MEDICAL_TOPIC_FOR_LICENSED_REVIEW',
  BENEFIT_STATUS: 'BENEFIT_STATUS_SELF_REPORTED',
  FINANCIAL: 'FINANCIAL_HARDSHIP_MENTIONED_FOR_LICENSED_REVIEW',
  DEMOGRAPHIC: 'DEMOGRAPHIC_DETAIL_REMOVED',
});

/** Neutral replacement. Keeps the sentence readable without the attribute. */
const MASK = '[removed — not a scoring factor]';

/**
 * Patterns, grouped by the flag they raise.
 *
 * Deliberately conservative: each entry requires a reasonably specific phrase,
 * because over-redaction would strip the legitimate Medicare process detail an
 * advisor needs. "Medicare" is never matched; "Medicaid" is. Education topics
 * on the public site (Extra Help / LIS pages) are unaffected — this only runs
 * on the text handed to the lead SCORER.
 */
const GROUPS = Object.freeze([
  Object.freeze({
    flag: SIGNAL_FLAGS.MEDICAL,
    // NOTE on precision: an earlier draft matched a bare subject+verb
    // ("she has …", "tiene …") and swallowed legitimate Medicare process detail
    // — "She has Medicare Part A and Part B already" was redacted whole, which
    // would have blinded the advisor to the very thing they need. Over-redaction
    // is its own failure. These patterns now require a clinical term to be
    // present, not merely a possessive sentence shape.
    res: [
      // Explicit diagnosis framing. Bounded to the verb plus the next 1-3 words
      // — a character window ran past the condition and swallowed the rest of
      // the sentence ("…cáncer el año pasado y quiero saber sobre la Parte B"),
      // taking the Medicare question with it. The named-condition list below
      // catches anything the short window misses.
      /\b(?:diagnosed\s+with|suffers?\s+from)\s+\S+(?:\s+\S+){0,2}/gi,
      /\b(?:me|le|nos)\s+diagnosticaron\s+\S+(?:\s+\S+){0,2}/gi,
      /\bpadece\s+(?:de\s+)?\S+(?:\s+\S+){0,2}/gi,
      // Conditions and treatments, named.
      /\b(?:cancer|cáncer|diabetes|dialysis|diálisis|chemo(?:therapy)?|quimio(?:terapia)?|alzheimer'?s?|dementia|demencia|copd|epoc|stroke|derrame|heart\s+(?:failure|attack)|infarto|surgery|cirugía|transplant|trasplante|hospice|insulin|insulina|oxygen\s+(?:tank|therapy)|oxígeno)\b/gi,
      // Medications, as the person's own.
      /\b(?:my|his|her|their)\s+(?:medication|medications|meds|prescriptions?)\b[^.!?;\n]{0,60}/gi,
      /\b(?:mis|sus)\s+(?:medicamentos|medicinas|recetas)\b[^.!?;\n]{0,60}/gi,
      // Disability as an attribute of the person.
      /\b(?:on\s+disability|is\s+disabled|discapacidad|incapacidad|ssdi)\b/gi,
    ],
  }),
  Object.freeze({
    flag: SIGNAL_FLAGS.BENEFIT_STATUS,
    res: [
      // Medicaid / LIS / Extra Help status. Self-reported, never an eligibility
      // determination (spec §14) and never a commercial score (spec §15).
      /\bmedicaid\b[^.!?;\n]{0,40}/gi,
      /\b(?:dual[- ]eligible|dually\s+eligible|doble\s+elegib\w*)\b/gi,
      /\b(?:extra\s+help|low[- ]income\s+subsidy|\bLIS\b|ayuda\s+adicional|subsidio\s+por\s+bajos\s+ingresos)\b/gi,
      /\b(?:qmb|slmb|qi-?1|msp|medicare\s+savings\s+program|programa\s+de\s+ahorros\s+de\s+medicare)\b/gi,
    ],
  }),
  Object.freeze({
    flag: SIGNAL_FLAGS.FINANCIAL,
    res: [
      /\b(?:my|our)\s+income\s+is\b[^.!?;\n]{0,40}/gi,
      /\b(?:mi|nuestro)\s+ingreso\s+es\b[^.!?;\n]{0,40}/gi,
      // Third person too: a note written ABOUT the caller ("she cannot afford
      // the premium") is the same prohibited attribute as one written by them.
      /\b(?:i|we|he|she|they|the\s+(?:caller|client|beneficiary))\s+(?:can'?t|cannot|can\s+not|could\s+not|couldn'?t)\s+afford\b[^.!?;\n]{0,50}/gi,
      /\b(?:struggl\w+|having\s+trouble)\s+to\s+(?:pay|afford)\b[^.!?;\n]{0,40}/gi,
      /\bno\s+(?:me\s+alcanza|puedo\s+pagar)\b[^.!?;\n]{0,50}/gi,
      /\b(?:on\s+a\s+fixed\s+income|food\s+stamps|snap\s+benefits|section\s+8)\b/gi,
    ],
  }),
  Object.freeze({
    flag: SIGNAL_FLAGS.DEMOGRAPHIC,
    res: [
      /\b(?:i\s+am|i'?m|he\s+is|she\s+is)\s+(?:black|white|hispanic|latino|latina|asian|african[- ]american|haitian|dominican)\b/gi,
      /\b(?:soy|es)\s+(?:negro|negra|blanco|blanca|hispano|hispana|latino|latina|asiático|asiática|dominicano|dominicana)\b/gi,
      /\b(?:undocumented|green\s+card|immigration\s+status|indocumentad\w+|estatus\s+migratorio)\b/gi,
    ],
  }),
]);

/**
 * Remove prohibited attributes from text destined for a commercial scorer.
 *
 * @returns {{ text: string, flags: string[], redactions: number }}
 *   `text`  — safe to hand to the scorer.
 *   `flags` — what to attach to the lead INSTEAD, for a licensed human.
 */
export function redactProhibitedForScoring(input) {
  var text = String(input == null ? '' : input);
  if (!text) return { text: '', flags: [], redactions: 0 };

  var flags = [];
  var redactions = 0;

  for (var g = 0; g < GROUPS.length; g++) {
    var group = GROUPS[g];
    var hitThisGroup = false;
    for (var i = 0; i < group.res.length; i++) {
      // Fresh lastIndex each pass — these are /g regexes reused across calls.
      var re = new RegExp(group.res[i].source, group.res[i].flags);
      text = text.replace(re, function () { redactions++; hitThisGroup = true; return MASK; });
    }
    if (hitThisGroup) flags.push(group.flag);
  }

  // Collapse runs of masks so a heavily redacted note stays readable.
  text = text.replace(new RegExp('(?:' + MASK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s,;]*){2,}', 'g'), MASK + ' ');

  return { text: text, flags: flags, redactions: redactions };
}

/**
 * True when the flags mean a licensed human must look at the case before any
 * plan-specific conversation (spec §14, CRM field LICENSED_AGENT_REVIEW_REQUIRED).
 */
export function requiresLicensedReview(flags) {
  if (!Array.isArray(flags)) return false;
  return flags.includes(SIGNAL_FLAGS.MEDICAL) || flags.includes(SIGNAL_FLAGS.FINANCIAL);
}

/**
 * Last-line check on anything about to be stored or scored. Returns the
 * prohibited terms still present, so a caller can refuse rather than persist
 * them. Used by the tests to prove the redactor actually removed them.
 */
export function findProhibited(text) {
  var found = [];
  var s = String(text == null ? '' : text);
  for (var g = 0; g < GROUPS.length; g++) {
    for (var i = 0; i < GROUPS[g].res.length; i++) {
      var re = new RegExp(GROUPS[g].res[i].source, GROUPS[g].res[i].flags);
      var m = s.match(re);
      if (m) found.push({ flag: GROUPS[g].flag, match: m[0].slice(0, 60) });
    }
  }
  return found;
}

// AUDIT 2026-07-03 Phase 4 — lightweight PHI pattern module.
//
// detectPHILeak used to live inside customerServiceEngine.ts (~8,000 lines).
// sensitiveGuard.ts (imported by Zara on the HOMEPAGE) pulled it from there,
// which dragged Clara's entire engine into a 405 KB chunk that shipped on
// every homepage visit and defeated the code-split. This module has ZERO
// imports, so both bots share the exact same detection logic without the
// homepage paying for the /support engine.
//
// Implementation moved VERBATIM from customerServiceEngine.ts (no behavior
// change); the engine re-exports it for backward compatibility.

// AUDIT 2026-07-23 (P2-01) — SSN/social context words. A bare 9-digit run next
// to one of these is an SSN even when the same message ALSO contains a phone
// number (the old phone-suppression let "my phone is X and my social is
// 123456789" through). English + Spanish.
const SSN_CONTEXT_RE = /\b(ssn|social security|social|seguro social|mi social)\b/i;

/** Returns true if message contains Medicare ID (MBI), SSN, or card number. */
export function detectPHILeak(text: string): boolean {
  // Medicare Beneficiary Identifier (MBI) — official CMS format is
  //   C A AN N A AN N A A N N    (C=1-9, A=letter, N=digit, AN=letter|digit)
  // Example: 1EG4-TE5-MK72. We allow optional dashes/spaces between blocks.
  if (/\b[1-9][A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z]\d{2}\b/i.test(text)) return true;
  // SSN — 3-2-4 with dash, space, or dot (AUDIT 2026-07-23: dots added;
  // "123.45.6789" bypassed the old dash/space-only pattern).
  if (/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/.test(text)) return true;
  // Bare 9-digit run that looks SSN-ish. Old rule suppressed it whenever ANY
  // phone-shaped number appeared in the message — "my phone is 787-555-0123
  // and my social is 123456789" passed. Now: with an SSN context word the run
  // is sensitive regardless of phones; without context, keep the phone guard
  // (a 9-digit run alone in a phone-bearing message is usually a typo'd phone).
  const bare9 = text.match(/(?<!\d)\d{9}(?!\d)/);
  if (bare9 && (SSN_CONTEXT_RE.test(text) || !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(text))) return true;
  // 16-digit credit/debit card number.
  if (/\b(?:\d{4}[-\s]?){3}\d{4}\b/.test(text)) return true;
  // AUDIT 2026-07-23 (P2-01) — Amex: 15 digits, starts 34/37, spoken 4-6-5.
  if (/\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/.test(text)) return true;
  // WAVE 39 — banking phrase + a digit run nearby.
  if (/\b(account number|routing number|n[uú]mero de cuenta|n[uú]mero de ruta|bank account|cuenta bancaria|wire transfer|transferencia bancaria|routing|debit card number|n[uú]mero de tarjeta)\b/i.test(text)
      && /\d{4,}/.test(text)) {
    return true;
  }
  // WAVE 39 — explicit "my SSN is X" / "mi seguro social es X" with any digits.
  if (/\b(my (ssn|social security)|mi (n[uú]mero de )?seguro social|my medicare (id|number|mbi)|mi (n[uú]mero de )?medicare)\b.{0,12}[\d]+/i.test(text)) {
    return true;
  }
  return false;
}

// AUDIT 2026-07-23 (P0-01) — shared client-side scrubber. Replaces sensitive
// runs with placeholders so a blocked value can never travel in an LLM history
// or any reusable transcript, even if an earlier gate missed it. Server-side
// scrubPHI (api/_lib/phi-scrub.js) remains the last line of defense; this is
// defense-in-depth in the browser. Normal text passes through untouched.
export function scrubSensitiveText(text: string): string {
  if (!text) return text;
  let out = text;
  // MBI first (alphanumeric — must run before generic digit rules).
  out = out.replace(/\b[1-9][A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z0-9]\d[-\s]?[A-Z][A-Z]\d{2}\b/gi, '[REDACTED-MBI]');
  // Cards (16-digit, then Amex 15-digit).
  out = out.replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[REDACTED-CARD]');
  out = out.replace(/\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g, '[REDACTED-CARD]');
  // SSN 3-2-4 with dash/space/dot separators.
  out = out.replace(/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g, '[REDACTED-SSN]');
  // Bare 9-digit run when SSN context is present (or no phone in the text).
  if (SSN_CONTEXT_RE.test(out) || !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(out)) {
    out = out.replace(/(?<!\d)\d{9}(?!\d)/g, '[REDACTED-SSN]');
  }
  // Long digit runs right after a banking phrase.
  out = out.replace(/(\b(?:account number|routing number|n[uú]mero de cuenta|n[uú]mero de ruta|bank account|cuenta bancaria|debit card number|n[uú]mero de tarjeta)\b[^\d]{0,12})\d{4,}/gi, '$1[REDACTED-BANK]');
  // AUDIT 2026-07-27 (BUG 2) — SOFT health tier. Medications, diagnoses,
  // doctor names, and birth dates must never travel in the reusable LLM
  // history, lead notes, or storage. Redacted here (placeholders keep the
  // turn readable) — the soft-guard privacy note lives in the engine.
  out = scrubHealthDisclosures(out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-07-27 (BUG 2) — HEALTH-DISCLOSURE SOFT TIER.
//
// The hard tier above (SSN / MBI / bank / card) hides the whole message. The
// audit showed Clara ACCEPTING and ECHOING medications ("metformin and
// lisinopril"), a diagnosis ("diagnosed with diabetes"), a doctor's name
// ("Dr. Example"), and a DOB. Those are health details a senior volunteers in
// good faith, so the response is SOFT: never echoed back, never stored
// unscrubbed, and answered ONCE with a privacy note + pivot (engine-side).
// ─────────────────────────────────────────────────────────────────────────────

export type HealthDisclosureType = 'medication' | 'diagnosis' | 'doctor_name' | 'birth_date';

// Top common Medicare-population drugs + generic med-name suffixes. The suffix
// rule (-formin/-pril/-statin/-olol/-sartan/-zole/-mab …) catches most brand /
// generic names the list misses.
const MED_NAMES_RE = /\b(metformin(?:a)?|lisinopril|atorvastatin(?:a)?|amlodipin[oa]?|amlodipine|metoprolol|losartan|omeprazol[e]?|gabapentin(?:a)?|hydrochlorothiazide|hidroclorotiazida|simvastatin(?:a)?|levothyroxine|levotiroxina|insulin(?:a)?|eliquis|apixaban|warfarin(?:a)?|xarelto|rivaroxaban|jardiance|ozempic|trulicity|januvia|sitagliptin(?:a)?|prednison[ea]|albuterol|salbutamol|furosemid[ea]|lantus|humira|plavix|clopidogrel|crestor|rosuvastatin(?:a)?|tramadol|pantoprazol[e]?|escitalopram|sertralin[ea]|donepezil[o]?)\b/i;
const MED_SUFFIX_RE = /\b[a-záéíóú]{2,}(?:formin[a]?|pril|statin[a]?|statina|olol|sartan|zol|zole|mab|glutide|gliptin[a]?|prazol|prazole|dipin[oa]|dipine|oxetin[ea]|azepam|icillin[a]?|icilina|mycin[a]?|micina)\b/i;
// "I take X" / "tomo X" / "estoy tomando X" — a med-taking phrase followed by
// a capitalized-or-lowercase drug-looking token.
const MED_PHRASE_RE = /\b(i\s+(?:also\s+|currently\s+|only\s+)?(?:take|am\s+taking|use)|tomo|tambi[eé]n\s+tomo|estoy\s+tomando|me\s+recetaron|my\s+medications?\s+(?:are|is)|mis\s+medicamentos\s+son)\b/i;

// Conditions a caller states as their own ("I have diabetes", "tengo cáncer").
const CONDITION_NAMES_RE = /\b(diabetes|c[aá]ncer|cancer|copd|epoc|asthma|asma|hypertension|hipertensi[oó]n|alzheimer'?s?|dementia|demencia|parkinson'?s?|esrd|dialysis|di[aá]lisis|kidney\s+(?:disease|failure)|insuficiencia\s+renal|heart\s+(?:disease|failure)|insuficiencia\s+card[ií]aca|stroke|derrame|hiv|vih|multiple\s+sclerosis|esclerosis\s+m[uú]ltiple|depression|depresi[oó]n|arthritis|artritis|lupus|hepatitis|cirrhosis|cirrosis|epilepsy|epilepsia)\b/i;
const DIAGNOSIS_PHRASE_RE = /\b(diagnosed\s+with|me\s+diagnosticaron|fui\s+diagnosticad[oa]|i\s+(?:have|suffer\s+from)|tengo|padezco\s+(?:de)?|sufro\s+de)\b/i;

// "Dr. Smith" / "doctor García" — title (any case) + Capitalized surname.
// No /i flag: the surname MUST be capitalized, so "mi doctor no acepta" never
// matches; the title's case tolerance is spelled out explicitly.
const DOCTOR_NAME_RE = /\b(?:[Dd][Rr][Aa]?|DR[Aa]?|[Dd]octora?|DOCTORA?)\.?\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?/g;

// Birth dates — explicit birth context + a date/year, or a full date form.
const BIRTH_CONTEXT_RE = /\b(date\s+of\s+birth|birth\s?date|dob|i\s+was\s+born|born\s+(?:on|in)|my\s+birthday\s+is|fecha\s+de\s+nacimiento|nac[ií]\s+(?:el|en))\b/i;
const MONTH_RE = '(?:january|february|march|april|may|june|july|august|september|october|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)';
const FULL_DATE_RES: RegExp[] = [
  new RegExp('\\b' + MONTH_RE + '\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(?:19|20)\\d{2}\\b', 'gi'),
  new RegExp('\\b\\d{1,2}\\s+de\\s+' + MONTH_RE + '\\s+(?:de[l]?\\s+)?(?:19|20)\\d{2}\\b', 'gi'),
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.](?:19|20)\d{2}\b/g,
];

/** Classify a message's FIRST health disclosure, or null. Detection only —
 *  the once-per-conversation privacy note is the engine's job. */
export function classifyHealthDisclosure(text: string): { type: HealthDisclosureType } | null {
  if (!text) return null;
  // Birth date needs context AND an actual date/year — "I was born in Puerto
  // Rico" alone is not a disclosure.
  if (BIRTH_CONTEXT_RE.test(text) && /\b(19|20)\d{2}\b/.test(text)) return { type: 'birth_date' };
  // Personal medication disclosure — a med-taking phrase plus a drug-looking
  // name. A general coverage question ("does Medicare cover insulin?") is an
  // education question, NOT a disclosure, and must not trigger the note.
  if (MED_PHRASE_RE.test(text) && (MED_NAMES_RE.test(text) || MED_SUFFIX_RE.test(text))) {
    return { type: 'medication' };
  }
  if (DIAGNOSIS_PHRASE_RE.test(text) && CONDITION_NAMES_RE.test(text)) {
    return { type: 'diagnosis' };
  }
  DOCTOR_NAME_RE.lastIndex = 0;
  if (DOCTOR_NAME_RE.test(text)) return { type: 'doctor_name' };
  return null;
}

/** Redact soft-tier health details with readable placeholders. Birth dates can
 *  be kept (includeBirthDates=false) ONLY for the current outbound message,
 *  where the server extracts the DOB for deterministic age grounding and then
 *  redacts it itself (api/_lib/date-grounding.js). */
export function scrubHealthDisclosures(
  text: string,
  opts?: { includeBirthDates?: boolean },
): string {
  if (!text) return text;
  const includeBirthDates = opts?.includeBirthDates !== false;
  let out = text;
  out = out.replace(new RegExp(MED_NAMES_RE.source, 'gi'), '[medication]');
  // Suffix-matched meds only inside a med-taking phrase context (avoids
  // eating unrelated words in normal conversation).
  if (MED_PHRASE_RE.test(out)) {
    out = out.replace(new RegExp(MED_SUFFIX_RE.source, 'gi'), '[medication]');
  }
  if (DIAGNOSIS_PHRASE_RE.test(out)) {
    out = out.replace(new RegExp(CONDITION_NAMES_RE.source, 'gi'), '[health condition]');
  }
  DOCTOR_NAME_RE.lastIndex = 0;
  out = out.replace(DOCTOR_NAME_RE, '[doctor name]');
  if (includeBirthDates) {
    for (const re of FULL_DATE_RES) {
      re.lastIndex = 0;
      out = out.replace(re, '[date of birth]');
    }
    // Bare birth year ("born in 1950" / "nací en 1950").
    if (BIRTH_CONTEXT_RE.test(out)) {
      out = out.replace(/\b(19\d{2}|20\d{2})\b/g, '[date of birth]');
    }
  }
  return out;
}

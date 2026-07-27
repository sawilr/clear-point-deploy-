// PHASE A15 — Compliance post-filter v2.
//
// Runs AFTER Claude returns a response. Defense-in-depth: even if the
// system prompt or a prompt-injection-protected request somehow leads
// the LLM to a CMS-non-compliant phrasing, this filter rewrites the
// response with a safe alternative.
//
// CMS rules enforced (TPMO 422.2267):
//   1. Never name a specific MA / PDP / Medigap carrier or product
//   2. Never confirm beneficiary eligibility ("you qualify")
//   3. Never confirm doctor-in-network / drug-covered for a specific plan
//   4. Never quote a specific plan premium / copay as a personal price
//   5. Never claim affiliation with Medicare / CMS / SSA / "the government"

// ── Forbidden carriers / brands (expand as ClearPoint adds carriers) ─────
// A15.9 — HIGH fix: carrier patterns now tolerate dashes, dots, and spaces
// inside the name (e.g. "U.H.C.", "United-Health", "Blue   Cross").
// `sep` = "anything that is NOT a letter/digit, 0-1 chars" between letters.
function carrierRe(name) {
  // Insert "[\W_]?" between every pair of alphanumeric characters in `name`,
  // EXCEPT where the source already has '\s' or other escaped tokens.
  // Simpler: split into chars and join with the tolerant separator.
  var chars = name.split('');
  var pattern = chars.map(function (c) {
    if (/[a-z0-9]/i.test(c)) return c;
    if (c === ' ') return '[\\W_]*';   // space → 0+ non-word
    return c;
  }).join('[\\W_]?');
  return new RegExp('\\b' + pattern + '\\b', 'gi');
}
const CARRIER_NAMES = [
  'unitedhealth', 'united health', 'uhc', 'aarp', 'optum',
  'humana', 'humanna', 'aetna', 'aetnia', 'cvs health',
  'wellcare', 'centene', 'anthem', 'elevance',
  'cigna', 'kaiser', 'kaiser permanente',
  'molina', 'blue cross', 'blue shield', 'bcbs',
  'fidelis', 'emblemhealth', 'metroplus', 'healthfirst',
  'horizon', 'amerigroup', 'amerihealth',
  'devoted', 'clover', 'oscar', 'bright health',
].map(carrierRe);

// A15.9 — Plan-letter recommendations are also CMS-regulated for Medigap.
const PLAN_LETTER_RE = /\b(plan|plans?)\s+[A-N]\b/gi;

// ── Forbidden compliance phrases ────────────────────────────────────────
const FORBIDDEN_PHRASES = [
  // Eligibility confirmations
  /\b(you|usted)\s+(qualify|are\s+eligible|califica|cumple\s+los?\s+requisitos)\b/gi,
  /\b(you\s+will|you'?ll|usted)\s+(receive|save|get|recibir[aá]|ahorrar[aá]|obtendr[aá])\s+\$\d+/gi,
  // Network / formulary confirmations
  /\byour\s+(doctor|provider|specialist|hospital|drug|medication)\s+is\s+(in[- ]network|covered)/gi,
  /\bsu\s+(doctor|m[eé]dico|hospital|medicamento|medicina)\s+(est[aá]\s+(cubierto|en\s+la\s+red|en\s+red))/gi,
  // Affiliation claims
  /\b(we|i)\s+(are|am)\s+(medicare|cms|ssa|the\s+government|medicaid)/gi,
  /\bsomos\s+(medicare|cms|del\s+gobierno|medicaid)/gi,
  // Specific plan recommendations (in addition to carrier name blocks)
  /\b(the\s+best\s+plan|el\s+mejor\s+plan)\s+(for\s+you|para\s+usted|es|is)\b/gi,
  /\bi\s+(highly\s+)?recommend\s+(the|that)\s+\w+\s+plan\b/gi,
  /\ble\s+recomiend[oa]\s+(el|este|ese)\s+plan\b/gi,
];

// Generic compliant replacement text — used to substitute violations.
const SAFE_REPLACEMENT = {
  en: 'I can\'t confirm that here — it depends on the specific plan, area, and your situation. A licensed ClearPoint advisor can review it with you, at no cost.',
  es: 'No puedo confirmar eso aquí — depende del plan específico, su área y su situación. Un asesor licenciado de ClearPoint puede revisarlo con usted, sin costo.',
};

/**
 * Run the response text through the compliance filter.
 *
 * @param {string} text     The LLM response.
 * @param {'en'|'es'} lang  Caller language (defaults to 'es').
 * @param {{ now?: Date }} [opts]  `now` overrides the clock (unit tests only).
 * @returns {{ text: string, violations: string[] }}
 *   - text: the cleaned response (may be the original if no violations).
 *   - violations: tags of every rule that fired (for logging / telemetry).
 */
export function complianceFilter(text, lang, opts) {
  if (!text) return { text: text || '', violations: [] };
  var now = (opts && opts.now) || new Date();
  var out = text;
  var violations = [];
  var safe = SAFE_REPLACEMENT[lang === 'en' ? 'en' : 'es'];

  // 1) Strip specific carrier names. A15.9 — always reset .lastIndex BEFORE
  //    every .test() call because we're using `g` flag (stateful) regex.
  var anyCarrier = false;
  for (var ci = 0; ci < CARRIER_NAMES.length; ci++) {
    CARRIER_NAMES[ci].lastIndex = 0;
    if (CARRIER_NAMES[ci].test(out)) {
      anyCarrier = true;
      violations.push('carrier_name:' + CARRIER_NAMES[ci].source.slice(0, 40));
    }
  }
  if (anyCarrier) {
    // Remove ALL sentences containing ANY carrier name.
    var sentences = out.split(/(?<=[.!?])\s+/);
    var clean = sentences.filter(function (s) {
      for (var i = 0; i < CARRIER_NAMES.length; i++) {
        CARRIER_NAMES[i].lastIndex = 0;
        if (CARRIER_NAMES[i].test(s)) return false;
      }
      return true;
    });
    out = clean.join(' ').trim();
    if (!out) out = safe;
    else if (!/[.!?]\s*$/.test(out)) out += '. ' + safe;
    else out += ' ' + safe;
  }

  // 2) Forbidden phrases — replace inline with safe text.
  FORBIDDEN_PHRASES.forEach(function (re) {
    if (re.test(out)) {
      violations.push('forbidden_phrase:' + re.source.slice(0, 40));
      out = out.replace(re, function () {
        return safe.slice(0, 80) + '…';
      });
    }
  });

  // 3) A15.9 — Plan-letter naming ("Plan G", "Plan N") is regulated for
  //    Medigap recommendation. Replace with generic phrasing.
  if (PLAN_LETTER_RE.test(out)) {
    violations.push('plan_letter_named');
    out = out.replace(PLAN_LETTER_RE, lang === 'en' ? 'a Medigap plan' : 'un plan Medigap');
  }

  // 4) AUDIT 2026-07-22 — SEP claims. The LLM must never state or hint that
  //    the caller HAS (or "podría tener") a Special Enrollment Period, nor
  //    promise "sin esperar a octubre" — a doctor recommending/leaving a plan
  //    does not create a SEP. The prompt forbids it but slips ~1 in N; this
  //    rewrite is the deterministic guarantee. Verification-framed mentions
  //    ("verificar si aplica un Período Especial", "no quiero asumir que
  //    existe un Periodo Especial") are compliant and intentionally NOT
  //    matched by these claim patterns.
  // AUDIT 2026-07-27 (BUG 4a) — Spanish variants + hedged likelihood forms.
  // "Es muy probable que califique para un Período Especial" asserts the SEP
  // just as hard as "usted tiene un SEP"; both are rewritten. Verification
  // framing ("verificar si aplica un Período Especial") is still allowed.
  var SEP_CLAIM_RES = [
    /\b(usted\s+)?(tiene|tendr[ií]a|podr[ií]a\s+tener|puede\s+tener|podr[ií]a\s+calificar\s+para|califica\s+para)\b[^.!?]{0,50}\b(per[ií]odo\s+especial|special\s+enrollment|\bSEP\b)/i,
    /\byou\s+(may|might|could|likely|probably|do)?\s*(have|qualify\s+for|be\s+eligible\s+for|are\s+eligible\s+for)\b[^.!?]{0,50}\b(special\s+enrollment|\bSEP\b)/i,
    /\b(es\s+(muy\s+)?probable\s+que|seguramente|probablemente|casi\s+seguro\s+que)\b[^.!?]{0,60}\b(per[ií]odo\s+especial|special\s+enrollment|\bSEP\b)/i,
    /\byou\s+(most\s+likely|almost\s+certainly|probably|likely)\b[^.!?]{0,50}\b(special\s+enrollment|\bSEP\b)/i,
    // Lookbehinds keep verification framing ("verificar si le aplica un
    // Período Especial" / "check whether a SEP applies") allowed.
    /(?<!\bsi\s)(?<!\bwhether\s)\b(aplicar[ií]a|le\s+aplica|se\s+aplica)\s+(un\s+)?(per[ií]odo\s+especial|\bSEP\b)/i,
    /\bsin\s+esperar\s+(a|hasta)\s+octubre\b/i,
    /\bwithout\s+waiting\s+(for|until)\s+october\b/i,
  ];
  var SEP_SAFE = {
    es: 'Para saber si puede cambiar ahora, primero habría que verificar qué periodo de inscripción tiene disponible — no quiero asumir que existe un Periodo Especial sin revisar su situación.',
    en: "To know whether you can change now, we'd first have to verify which enrollment period you have available — I don't want to assume a Special Enrollment Period exists without reviewing your situation.",
  };
  var sepHit = false;
  for (var si = 0; si < SEP_CLAIM_RES.length; si++) {
    if (SEP_CLAIM_RES[si].test(out)) { sepHit = true; violations.push('sep_claim:' + SEP_CLAIM_RES[si].source.slice(0, 40)); }
  }
  if (sepHit) {
    var sepSafe = SEP_SAFE[lang === 'en' ? 'en' : 'es'];
    var sepSentences = out.split(/(?<=[.!?])\s+/);
    var sepClean = sepSentences.filter(function (s) {
      for (var sj = 0; sj < SEP_CLAIM_RES.length; sj++) {
        if (SEP_CLAIM_RES[sj].test(s)) return false;
      }
      return true;
    });
    out = sepClean.join(' ').trim();
    // Append the verification phrasing once (skip if an equivalent line survived).
    if (!/no quiero asumir que existe un periodo especial|don'?t want to assume a special enrollment/i.test(out)) {
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + sepSafe : sepSafe;
    }
  }

  // 5) AUDIT 2026-07-27 (BUG 1 — date math). The LLM told a caller born in
  //    1950 they were "turning 65 in January 2015" as if it were upcoming.
  //    Deterministic backstop: any FUTURE-tense "turning 65 in <year>" claim
  //    where <year> is before the current year is wrong by construction —
  //    the caller already turned 65. Strip the sentence and append the
  //    correct statement. Past-tense ("you turned 65 in 2015") is a correct
  //    statement about the past and is intentionally NOT matched.
  var TURN65_FUTURE_RES = [
    // "you're turning 65 in January 2015" / "will turn 65 in 2015"
    /\b(?:you(?:'re| are| will| would)?(?:\s+be)?\s+)?turn(?:ing|s)?\s+65\b[^.!?]{0,40}?\bin\s+(?:\w+\s+(?:of\s+)?)?((?:19|20)\d{2})\b/i,
    // "cumple/cumplirá (los) 65 en enero de 2015" / "va a cumplir 65 en 2015"
    /\b(?:va\s+a\s+cumplir|cumplir[aá]|cumple|estar[aá]\s+cumpliendo)\s+(?:los\s+)?65\b[^.!?]{0,40}?\ben\s+(?:\w+\s+(?:de[l]?\s+)?)?((?:19|20)\d{2})\b/i,
  ];
  var TURN65_SAFE = {
    es: 'Según la fecha de nacimiento que compartió, usted ya cumplió los 65 años, así que su Período de Inscripción Inicial ya pasó. Un asesor licenciado puede verificar qué período de inscripción tiene disponible ahora.',
    en: 'Based on the birth date you shared, you have already turned 65, so your Initial Enrollment Period is in the past. A licensed advisor can verify which enrollment period may be available to you now.',
  };
  var currentYear = now.getFullYear();
  var turn65Hit = false;
  for (var ti = 0; ti < TURN65_FUTURE_RES.length; ti++) {
    var tm = out.match(TURN65_FUTURE_RES[ti]);
    if (tm && parseInt(tm[1], 10) < currentYear) {
      turn65Hit = true;
      violations.push('turning_65_past_year:' + tm[1]);
    }
  }
  if (turn65Hit) {
    var t65Safe = TURN65_SAFE[lang === 'en' ? 'en' : 'es'];
    var t65Sentences = out.split(/(?<=[.!?])\s+/);
    var t65Clean = t65Sentences.filter(function (s) {
      for (var tj = 0; tj < TURN65_FUTURE_RES.length; tj++) {
        var sm = s.match(TURN65_FUTURE_RES[tj]);
        if (sm && parseInt(sm[1], 10) < currentYear) return false;
      }
      return true;
    });
    out = t65Clean.join(' ').trim();
    out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + t65Safe : t65Safe;
  }

  // 6) AUDIT 2026-07-27 (BUG 4a — invented causes). For "my doctor doesn't
  //    accept my plan" the LLM invented "it's almost always because the
  //    provider may be leaving the plan's network". Clara does NOT know the
  //    reason. Any hedged-generalization + "because" + network/provider/plan
  //    causal claim is stripped and replaced with the neutral ask-what-they-
  //    said phrasing (EN + ES).
  var INVENTED_CAUSE_RE = /\b(almost\s+always|usually|typically|generally|most\s+often|in\s+most\s+cases|casi\s+siempre|usualmente|generalmente|normalmente|por\s+lo\s+general|en\s+la\s+mayor[ií]a\s+de\s+los\s+casos)\b[^.!?]{0,80}\b(because|porque|debido\s+a)\b[^.!?]{0,120}\b(network|red|provider|proveedor|plan)\b/i;
  var INVENTED_CAUSE_SAFE = {
    es: 'No quiero asumir el motivo sin conocerlo. ¿Le explicó el consultorio o el plan qué fue exactamente lo que cambió? Un asesor licenciado puede revisar su situación con usted, sin costo.',
    en: "I don't want to assume the reason without knowing it. Did the office or the plan explain exactly what changed? A licensed advisor can review your situation with you, at no cost.",
  };
  if (INVENTED_CAUSE_RE.test(out)) {
    violations.push('invented_cause_generalization');
    var icSafe = INVENTED_CAUSE_SAFE[lang === 'en' ? 'en' : 'es'];
    var icSentences = out.split(/(?<=[.!?])\s+/);
    var icClean = icSentences.filter(function (s) { return !INVENTED_CAUSE_RE.test(s); });
    out = icClean.join(' ').trim();
    out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + icSafe : icSafe;
  }

  return { text: out, violations: violations };
}

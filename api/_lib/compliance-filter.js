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
 * @returns {{ text: string, violations: string[] }}
 *   - text: the cleaned response (may be the original if no violations).
 *   - violations: tags of every rule that fired (for logging / telemetry).
 */
export function complianceFilter(text, lang) {
  if (!text) return { text: text || '', violations: [] };
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
  var SEP_CLAIM_RES = [
    /\b(usted\s+)?(tiene|tendr[ií]a|podr[ií]a\s+tener|puede\s+tener|podr[ií]a\s+calificar\s+para|califica\s+para)\b[^.!?]{0,50}\b(per[ií]odo\s+especial|special\s+enrollment|\bSEP\b)/i,
    /\byou\s+(may|might|could|likely|probably|do)?\s*(have|qualify\s+for|be\s+eligible\s+for|are\s+eligible\s+for)\b[^.!?]{0,50}\b(special\s+enrollment|\bSEP\b)/i,
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

  return { text: out, violations: violations };
}

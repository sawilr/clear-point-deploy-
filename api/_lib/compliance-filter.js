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
//   6. Never invent a hedged-generalization cause ("it's almost always because…")
//   7. Never assert/presume a coverage type, plan letter, network departure,
//      or SEP the USER never mentioned (re-audit 2026-07-27, P1)
//   8. LIFE SAFETY (audit 2026-07-28, CPF-001): a reply to a medical emergency
//      MUST contain the 911 instruction — otherwise it is replaced outright
//   9. GEO (audit 2026-07-28, CPF-002): a caller outside NY/NJ/CT never gets a
//      name/phone request — the reply is replaced by the out-of-area message
//  10. STORAGE (audit 2026-07-28, CPF-007): never promise non-storage — rewritten
//      to the Privacy-Policy wording
//  11. SSN ADVICE (audit 2026-08-12): never advise using/carrying/giving out the
//      Social Security number — replaced with Medicare-card/official-channel text

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
  // AUDIT 2026-08-13 (O-08, P1) — 'unitedhealthcare' as one word was absent, and
  // the trailing \b on 'unitedhealth' fails when followed by 'care', so the
  // largest MA brand passed the filter unblocked. Longest variants first.
  'unitedhealthcare', 'united healthcare', 'unitedhealth', 'united health', 'uhc', 'aarp', 'optum',
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
  // AUDIT 2026-08-13 (O-07, P1) — strict adjacency let the single most natural
  // phrasing through: "You LIKELY qualify for Extra Help", "usted PROBABLEMENTE
  // califica". Allow 0-3 filler words, mirroring the SEP rule at :238.
  // The negative lookahead hands SEP claims to rule 4, which produces a clean
  // purpose-built rewrite; without it the generic inline replacement truncated
  // mid-sentence and left "…for a Special Enrollment Period to switch now."
  // dangling (caught by regression B4 EN).
  /\b(you|usted)\s+(?:\w+\s+){0,3}(qualify|are\s+eligible|califica|cumple\s+los?\s+requisitos)\b(?![^.!?]*\b(?:special\s+enrollment|per[ií]odo\s+especial|SEP)\b)/gi,
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

// ── AUDIT 2026-07-28 CPF-001 — LIFE-SAFETY net (rule 8) ─────────────────
// Mirrors detectEmergency() in src/lib/customerServiceEngine.ts. Kept as a
// literal copy because this module is intentionally zero-import (it runs in
// the serverless function, the engine is a browser bundle). Both lists must
// be updated together; scripts/test-audit-regressions.mjs asserts parity on
// the audit's 20 phrase variants.
const EMERGENCY_USER_RES = [
  /\b(this is (an? )?)?emerg[ea]n[csz](y|ia|ie)\b/,
  /\b911\b/,
  /\b(can'?t|cant|cannot|can not|couldn'?t|no puedo|not able to)\s+(breath?e?|breathe|breath|breather|respire?r?)\b/,
  /\b(trouble|difficulty|struggling|hard time)\s+breath(ing|e)?\b/,
  /\b(short(ness)? of breath|gasping for air|choking|suffocating)\b/,
  /\b(chest\s+(pain|pains|pressure|tightness)|heart\s+attack|cardiac\s+arrest)\b/,
  /\b(stroke|having a stroke)\b/,
  /\b(bleeding|blood\s+everywhere|hemorrhag\w*)\b/,
  /\b(passed\s+out|pass(ing)?\s+out|unconscious|unresponsive|blacked\s+out|fainted)\b/,
  /\b(overdos\w*|od'?ed)\b/,
  /\b(suicid\w*|kill\s+myself)\b/,
  /\bemerg[ea]n[csz](ia|ya|y)\b/,
  /\bno\s+puedo\s+respir\w*/,
  /\b(me\s+falta\s+(el\s+)?aire|falta\s+de\s+aire|me\s+estoy\s+ahogando|no\s+me\s+llega\s+el\s+aire)\b/,
  /\b(dificultad|problemas?)\s+para\s+respirar\b/,
  /\b(dolor\s+(de|en\s+el)\s+pecho|me\s+duele\s+el\s+pecho|opresion\s+en\s+el\s+pecho)\b/,
  /\b(infarto|ataque\s+al\s+corazon|paro\s+cardiaco)\b/,
  /\b(derrame(\s+cerebral)?|embolia)\b/,
  /\b(estoy\s+sangrando|sangrando\s+mucho|hemorragia)\b/,
  /\b(me\s+desmay\w*|se\s+desmay\w*|esta\s+inconsciente|estoy\s+inconsciente|perdio\s+el\s+conocimiento)\b/,
  /\bsobredosis\b/,
];
const EMERGENCY_911_REPLY = {
  en: "This sounds like a medical emergency. Please hang up and call 911 right now, or go to your nearest emergency room. I'm not able to help with medical emergencies — your safety comes first.",
  es: 'Esto suena como una emergencia médica. Por favor cuelgue y llame al 911 ahora mismo, o vaya a la sala de emergencias más cercana. No puedo ayudar con emergencias médicas — su seguridad es lo primero.',
};

// ── AUDIT 2026-07-28 CPF-002 — GEO net (rule 9) ──────────────────────────
const OUT_OF_AREA_REPLY = {
  en: "Right now our office serves clients in New York, New Jersey, and Connecticut, so we're not able to help with plans in your state. For help where you live, you can call 1-800-MEDICARE or visit Medicare.gov.",
  es: 'En este momento nuestra oficina atiende a clientes en Nueva York, Nueva Jersey y Connecticut, así que no podemos ayudarle con planes en su estado. Para recibir ayuda donde usted vive, puede llamar al 1-800-MEDICARE o visitar Medicare.gov.',
};
const NON_SERVED_STATES_RE = /\b(?:vivo en|vivimos en|resido en|estoy en|estamos en|soy de|somos de|me mud[eé] a|aqu[ií] en|en el estado de|i live in|we live in|i am in|i'?m in|im in|we are in|living in|i reside in|i moved to|i am from|i'?m from|im from|based in|located in|in the state of|my state is|mi estado es)\s+(alabama|alaska|arizona|arkansas|california|colorado|delaware|district of columbia|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new mexico|nuevo mexico|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|pensilvania|puerto rico|rhode island|south carolina|south dakota|tennessee|texas|tejas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|carolina del norte|carolina del sur|dakota del norte|dakota del sur|nueva hampshire|virginia occidental)\b/i;
// The reply asks for contact details (what the geo net must never allow).
const ASKS_FOR_CONTACT_RE = /(what'?s your name|what is your (name|phone|full name)|your name,? please|c[uá]al es su nombre|su nombre completo|qu[eé] n[uú]mero de tel[eé]fono|what phone number|su tel[eé]fono|n[uú]mero de tel[eé]fono|c[oó]digo postal|what is your zip|your zip code)/i;

/** Accent-stripped lowercase, matching the engine's emergency normalization. */
function normLoose(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** TRUE when the text matches any emergency phrase (EN/ES, typo-tolerant). */
export function matchesEmergency(text) {
  var t = normLoose(text);
  if (!t) return false;
  for (var i = 0; i < EMERGENCY_USER_RES.length; i++) {
    if (EMERGENCY_USER_RES[i].test(t)) return true;
  }
  return false;
}

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
 * @param {{ now?: Date, userText?: string }} [opts]
 *   - now: overrides the clock (unit tests only).
 *   - userText: ALL accumulated user messages of the conversation (history +
 *     current turn, newline-joined). Enables rule 7 — the unstated-assumption
 *     rewrite. When absent, rule 7 is skipped (nothing to whitelist against).
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
  // The LATEST user message drives rules 8 and 9. Falls back to the whole
  // accumulated userText only when the caller did not pass it (unit tests).
  var latestUser = (opts && typeof opts.latestUserText === 'string')
    ? opts.latestUserText
    : ((opts && typeof opts.userText === 'string') ? opts.userText : null);

  // 8) AUDIT 2026-07-28 (CPF-001, P1 LIFE SAFETY). Live transcript: "This is an
  //    emergency and I cannot breathe." → Clara asked for the caller's name.
  //    Deterministic, un-bypassable net: if the caller's latest message reads
  //    as a medical emergency and the reply does not carry the 911 instruction,
  //    the ENTIRE reply is replaced. Nothing else in this filter runs after it.
  if (latestUser !== null && matchesEmergency(latestUser) && !/\b911\b/.test(out)) {
    violations.push('emergency_no_911');
    return { text: EMERGENCY_911_REPLY[lang === 'en' ? 'en' : 'es'], violations: violations };
  }

  // 9) AUDIT 2026-07-28 (CPF-002). A caller who states a non-served state must
  //    never be asked for name/phone/ZIP — the reply becomes the out-of-area
  //    message with the 1-800-MEDICARE referral.
  if (latestUser !== null && NON_SERVED_STATES_RE.test(latestUser) && ASKS_FOR_CONTACT_RE.test(out)) {
    violations.push('out_of_area_lead_capture');
    return { text: OUT_OF_AREA_REPLY[lang === 'en' ? 'en' : 'es'], violations: violations };
  }

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

  // 7) RE-AUDIT 2026-07-27 (P1 — invented coverage specifics). Live transcripts:
  //    caller said "Mi mediko no asepta el plan" and Clara replied about "su
  //    plan Medigap" (never stated) and "eso suena a una carta del plan" (no
  //    letter was ever mentioned). Deterministic guarantee on top of the
  //    prompt rule: when the reply ASSERTS/PRESUMES a specific coverage type,
  //    a plan letter, a network departure, or a possessive SEP that the
  //    accumulated USER messages never mentioned, the offending sentence is
  //    replaced by a neutral clarifying question. Whitelist: if the USER did
  //    say the term, the reply is left alone. Sanctioned ask-first questions
  //    ("¿sabe si tiene Medicare Advantage… o no está seguro?") are exempt.
  var userText = (opts && typeof opts.userText === 'string') ? opts.userText : null;
  if (userText !== null) {
    // The sanctioned coverage-clarifying question must never be rewritten.
    var ASK_FIRST_EXEMPT_RE = /(no\s+est[aá]\s+segur|not\s+sure|sabe\s+si|do\s+you\s+know\s+(if|whether)|qu[eé]\s+tipo\s+de\s+(plan|cobertura)|what\s+(kind|type)\s+of\s+(plan|coverage))/i;
    var ASSUMPTION_GROUPS = [
      {
        tag: 'medigap',
        // Possessive / presumptive usage only — "su plan Medigap", "your
        // Medigap", "cambiar de un plan Medigap". Educational mentions
        // ("Medigap is different…") are allowed.
        assertRe: /\b(?:(su|your|tu)\s+(plan\s+)?medigap\b|(cambiar|switch(?:ing)?|leave|leaving|dejar|salir)\s+(de\s+)?(un|el|su|the|your|a)\s+(plan\s+)?medigap\b)/i,
        userRe: /\b(medigap|med[- ]?sup|supplement|suplement)\w*/i,
      },
      {
        tag: 'medicare_advantage',
        assertRe: /\b(?:(su|your|tu)\s+plan\s+(de\s+)?(medicare\s+advantage|advantage)\b|(su|your|tu)\s+medicare\s+advantage\b|(su|your|tu)\s+plan\s+MA\b|(cambiar|switch(?:ing)?|leave|leaving|dejar|salir)\s+(de\s+)?(un|el|su|the|your|a)\s+plan\s+(medicare\s+advantage|advantage|MA)\b)/i,
        userRe: /\b(medicare\s+advantage|advantage|ma|parte?\s+c)\b/i,
      },
      {
        tag: 'part_d',
        assertRe: /\b(?:(su|your|tu)\s+plan\s+(de\s+la\s+)?parte?\s+d\b|your\s+part\s+d\s+plan\b|(su|your|tu)\s+parte?\s+d\b)/i,
        userRe: /\b(part[e]?\s+d|pdp)\b/i,
      },
      {
        tag: 'plan_letter',
        assertRe: /\b(suena\s+a\s+una?\s+carta|sounds?\s+like\s+a\s+letter|eso\s+parece\s+una?\s+carta|la\s+carta\s+(que\s+)?(recibi[oó]|le\s+lleg[oó])|carta\s+de(l|\s+su)?\s+plan|letter\s+from\s+(your|the)\s+plan|the\s+letter\s+you\s+(received|got))\b/i,
        userRe: /\b(carta|letter|aviso|notice|anoc|correspondencia)\b/i,
      },
      {
        tag: 'network_departure',
        assertRe: /\b(va\s+a\s+salir\s+de\s+la\s+red|saldr[aá]\s+de\s+la\s+red|dejar[aá]\s+la\s+red|est[aá]\s+dejando\s+la\s+red|sali[oó]\s+de\s+la\s+red|is\s+leaving\s+the\s+(plan'?s\s+)?network|leaving\s+the\s+network|left\s+the\s+network|dropped\s+(from|out\s+of)\s+the\s+network)\b/i,
        userRe: /\b(red|network|fuera\s+de\s+la\s+red|out[-\s]of[-\s]network)\b/i,
      },
      {
        tag: 'sep_possessive',
        assertRe: /\b(su|your|tu)\s+(per[ií]odo\s+especial|special\s+enrollment(\s+period)?|SEP)\b/i,
        userRe: /\b(per[ií]odo\s+especial|special\s+enrollment|sep)\b/i,
      },
    ];
    var UNSTATED_SAFE = {
      es: '¿Qué le dijo exactamente el consultorio? ¿Recibió algún documento o mensaje de su plan?',
      en: 'What exactly did the office tell you? Did you receive any document or message from your plan?',
    };
    var activeGroups = [];
    for (var gi = 0; gi < ASSUMPTION_GROUPS.length; gi++) {
      var g = ASSUMPTION_GROUPS[gi];
      if (g.assertRe.test(out) && !g.userRe.test(userText)) activeGroups.push(g);
    }
    if (activeGroups.length) {
      var uaSentences = out.split(/(?<=[.!?])\s+/);
      var uaHit = false;
      var uaClean = uaSentences.filter(function (s) {
        if (ASK_FIRST_EXEMPT_RE.test(s)) return true;
        for (var gj = 0; gj < activeGroups.length; gj++) {
          if (activeGroups[gj].assertRe.test(s)) {
            uaHit = true;
            return false;
          }
        }
        return true;
      });
      if (uaHit) {
        for (var gk = 0; gk < activeGroups.length; gk++) {
          violations.push('unstated_assumption:' + activeGroups[gk].tag);
        }
        var uaSafe = UNSTATED_SAFE[lang === 'en' ? 'en' : 'es'];
        out = uaClean.join(' ').trim();
        out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + uaSafe : uaSafe;
      }
    }
  }

  // ── AUDIT 2026-08-13 — post-revocation outreach net (rule 12) ────────────
  // Runtime finding: after the caller revoked contact ("Do not contact me.
  // Delete my information."), a later "please have an advisor call me" made the
  // model ask for RE-CONSENT — while the client-side submit gate is fail-closed,
  // so granting it would have silently failed. Asking for consent we cannot act
  // on is worse than either extreme. Once revoked, no contact offer, no
  // re-consent ask, and no advisor-will-call promise for the rest of the
  // session; the caller is given the self-initiated route instead. Re-enabling
  // contact after a revocation is a deliberate business/compliance decision
  // (needs a preserved revocation + new consent receipt), not a chat side effect.
  var optedOut = !!(opts && opts.contactOptedOut);
  if (optedOut) {
    var OUTREACH_RE = /\b(?:do\s+you\s+authorize|autoriza\s+que|authorize\s+a\s+licensed|advisor\s+(?:will|can|may)\s+(?:call|contact|reach)|asesor\s+(?:le\s+)?(?:llamar|contactar|puede\s+llamar)|have\s+(?:an\s+)?advisor\s+call|connect\s+you\s+with\s+a\s+licensed|le\s+conecto\s+con|someone\s+(?:will|can)\s+call\s+you|le\s+llame|what\s+(?:is|'?s)\s+your\s+(?:phone|number|name)|cu[aá]l\s+es\s+su\s+(?:tel[eé]fono|n[uú]mero|nombre))\b/i;
    if (OUTREACH_RE.test(out)) {
      violations.push('post_revocation_outreach');
      out = lang === 'en'
        ? "You asked us not to contact you, and we respect that — I won't set up a call or ask for your details. If you'd like to speak with a licensed advisor, you're welcome to call us directly at 1-855-720-8555."
        : 'Usted nos pidió no contactarle, y lo respetamos — no programaré una llamada ni le pediré sus datos. Si desea hablar con un asesor licenciado, puede llamarnos directamente al 1-855-720-8555.';
      return { text: out, violations: violations };
    }
  }

  // ── AUDIT 2026-08-12 — SSN-advice net (rule 11) ──────────────────────────
  // Live transcript: replying to a lost-Medicare-card question, the LLM said
  // "you just need your Social Security number to prove eligibility at the
  // doctor or pharmacy". The bot must NEVER advise using/carrying/giving out
  // the SSN. Negated safety warnings ("please don't share your Social
  // Security number") are exempt; mentions of the Social Security AGENCY
  // (ssa.gov contact info) don't match — only "Social Security number"/SSN
  // advice forms do. Offending sentences are stripped and replaced with the
  // Medicare-card / official-channels guidance.
  // DESIGN (revised after adversarial red team, 2026-08-12): enumerating advice
  // verbs failed — 15 of 20 attack strings walked past it ("the pharmacy will
  // ASK for your SSN", "they can LOOK YOU UP with your Social", "your SSN WORKS
  // AS ID", "your Medicare number IS your SSN", "S.S.N.", "su número DEL Seguro
  // Social"...). Inverted to DEFAULT-DENY: any mention of the beneficiary's SSN
  // token is stripped unless it is an explicit do-not-share warning or is about
  // the Social Security ADMINISTRATION / benefit payment. Clara and Zara have no
  // legitimate reason to discuss a caller's SSN except to warn against sharing.
  // s[.\s-]?s[.\s-]?n covers SSN, S.S.N., S S N, S-S-N (red team: "S S N" slipped).
  var SSN_TOKEN_RE = /\bs[\s.\-]?s[\s.\-]?n\b|\bsocial\s+security\s+(?:number|card|#)\b|\bn[uú]mero\s+de[l]?\s+seguro\s+social\b|\btarjeta\s+de[l]?\s+seguro\s+social\b/i;
  // Possessive Spanish "su seguro social" without the word "número" — an SSN
  // reference unless the sentence is about the benefit/check/agency.
  var SSN_POSSESSIVE_ES_RE = /\b(su|tu)\s+seguro\s+social\b/i;
  // Social Security as AGENCY or BENEFIT PAYMENT — never an SSN reference.
  // F-07: added recib|cada mes|al mes — "¿Ya recibe usted su Seguro Social cada
  // mes?" was being deleted and replaced with off-topic card guidance.
  var SS_BENEFIT_CTX_RE = /\b(check|cheque|benefit|beneficio|payment|pago|paga|income|ingreso|retirement|jubilaci|monthly|mensual|premium|prima|deduct|descuent|deducen|taken\s+from|administration|administraci|office|oficina|ssa\.gov|772-1213|apply|solicit|recib|cada\s+mes|al\s+mes)/i;
  // Explicit protective warning — must survive untouched. F-07: allow an
  // optional modal ("we WILL never ask", "we would not need") in the
  // we/I-never alternative.
  var SSN_WARNING_RE = /(?:please\s+)?(?:do\s+not|don'?t|never)\s+(?:share|give|provide|send|type|enter|reveal|include|put|write)\b|\b(?:we|clearpoint|i)\s+(?:will|would|do|shall)?\s*(?:never|don'?t|do\s+not|not)\s+(?:ask|request|need|require|store|save|keep)\b|\bno\s+(?:comparta|env[ií]e|escriba|ingrese|introduzca|revele|d[eé]|proporcione)\b|\b(?:nunca|jam[aá]s)\s+(?:le\s+)?(?:pedimos|solicitamos|almacenamos|guardamos|necesitamos)\b/i;
  function isSsnAdviceSentence(s) {
    var hasToken = SSN_TOKEN_RE.test(s);
    if (!hasToken && SSN_POSSESSIVE_ES_RE.test(s) && !SS_BENEFIT_CTX_RE.test(s)) hasToken = true;
    if (!hasToken) return false;
    if (SSN_WARNING_RE.test(s)) return false;      // protective warning — keep
    if (!SSN_TOKEN_RE.test(s) && SS_BENEFIT_CTX_RE.test(s)) return false;
    return true;
  }
  // F-06 (P2): the warning exemption was evaluated over the WHOLE sentence, so
  // "Don't share your Medicare number, but you can use your Social Security
  // number at the pharmacy." was kept intact — the warning governed the MBI
  // while the SSN advice rode along. Segment on clause boundaries so each
  // clause is judged on its own.
  var CLAUSE_SPLIT_RE = /(?<=[.!?])\s+|\n+|\s*(?:,\s*(?:but|pero|however|although|though|aunque)\s+|;\s*|\s+—\s+|\s+-\s+|\s+—\s+)/;
  function splitClauses(text) {
    return String(text).split(CLAUSE_SPLIT_RE).filter(function (x) { return x && x.trim(); });
  }
  var anySsnClause = splitClauses(out).some(isSsnAdviceSentence);
  if (anySsnClause) {
    // Sentence-level split for reassembly (keeps output readable), then a
    // clause-level check inside each sentence.
    var ssnSentences = out.split(/(?<=[.!?])\s+|\n+/);
    var ssnHit = false;
    var ssnClean = ssnSentences.map(function (s) {
      // Drop only the offending CLAUSE, keeping any compliant clauses in the
      // same sentence (e.g. the MBI warning survives; the SSN advice does not).
      var clauses = splitClauses(s);
      if (!clauses.some(isSsnAdviceSentence)) return s;
      ssnHit = true;
      var kept = clauses.filter(function (c) { return !isSsnAdviceSentence(c); });
      if (!kept.length) return '';
      var joined = kept.join(' ').trim().replace(/[,;]\s*$/, '');
      return /[.!?]$/.test(joined) ? joined : joined + '.';
    }).filter(function (s) { return s && s.trim(); });
    if (ssnHit) {
      violations.push('ssn_advice');
      var ssnSafe = lang === 'en'
        ? 'To show proof of Medicare coverage, use your Medicare card — never your Social Security number. If you need a replacement card or coverage confirmation, you can print one from your Medicare.gov account or call 1-800-MEDICARE (1-800-633-4227).'
        : 'Para demostrar su cobertura de Medicare, use su tarjeta de Medicare — nunca su número de Seguro Social. Si necesita una tarjeta de reemplazo o confirmar su cobertura, puede imprimirla desde su cuenta de Medicare.gov o llamar al 1-800-MEDICARE (1-800-633-4227).';
      out = ssnClean.join(' ').trim();
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + ssnSafe : ssnSafe;
    }
  }

  // ── AUDIT 2026-07-28 CPF-007 — storage-claim net (rule 10) ────────────────
  // The bot must never PROMISE non-storage ("I won't store those details") —
  // retention is governed by the privacy policy, not the model. Rewrite any
  // such sentence to the accurate handled-securely wording. EN + ES.
  var STORAGE_CLAIM_RE = /(won'?t|will not|don'?t|do not)\s+(store|keep|save|retain)|no\s+(lo\s+|la\s+|los\s+|las\s+)?(guardar|almacenar|retendr|conservar)/i;
  if (STORAGE_CLAIM_RE.test(out)) {
    var scSentences = out.split(/(?<=[.!?])\s+/);
    var scHit = false;
    var scSafe = lang === 'en'
      ? 'Any details you share are handled under our Privacy Policy, and a licensed advisor reviews sensitive information securely by phone.'
      : 'Cualquier dato que comparta se maneja según nuestra Política de Privacidad, y un asesor licenciado revisa la información sensible de forma segura por teléfono.';
    var scClean = scSentences.filter(function (s) {
      if (STORAGE_CLAIM_RE.test(s)) { scHit = true; return false; }
      return true;
    });
    if (scHit) {
      violations.push('storage_claim');
      out = scClean.join(' ').trim();
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + scSafe : scSafe;
    }
  }

  return { text: out, violations: violations };
}

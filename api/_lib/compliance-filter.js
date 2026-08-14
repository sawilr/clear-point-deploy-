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

// ── AUDIT 2026-08-13 — shared SEP vocabulary (rules 4 and 13) ────────────────
// Hoisted to module scope for two reasons. First, correctness: rule 4 enumerates
// claim PHRASINGS and rule 13 denies assertive clauses by default, and both must
// consult the SAME verification veto — otherwise a sentence legitimately framed as
// "whether a SEP applies" is excused by one rule and mangled by the other. That is
// not hypothetical: rule 4 carried a (?<!\bwhether\s) lookbehind on exactly one of
// its seven patterns, so "Whether you have a Special Enrollment Period available
// is exactly what a licensed advisor would check" was rewritten into a non-answer.
// Second, cost: these were being rebuilt with new RegExp on every filtered reply.
const SEP_TOKEN_RE = /\bper[ií]odo\s+especial|\bspecial\s+enrollment|\bSEP\b/i;
// Assertive contexts: possession, entitlement, timing, duration, automaticity, and
// the "you can act now" formulation that carries the same operative meaning without
// ever using the word "qualify".
const SEP_ASSERT_RE = new RegExp([
  '\\b(have|has|had|get|gets|receive|are\\s+in|is\\s+open|opens|opened|runs|lasts|extends|gives\\s+you|grants|triggers|starts|began|begins)\\b',
  '\\b(tiene|tienen|tendr|recibe|obtiene|le\\s+da|se\\s+abre|abre|dura|empieza|comienza|corre|activa)\\w*',
  '\\b(autom[aá]tic\\w*|automatically)\\b',
  '\\b(qualif\\w*|eligib\\w*|calific\\w*|elegib\\w*)\\b',
  '\\b(right\\s+now|ahora\\s+mismo|today|hoy|immediately|inmediatamente|de\\s+una\\s+vez)\\b',
  '\\b(most\\s+people|la\\s+mayor[ií]a\\s+de\\s+(las\\s+)?personas|anyone\\s+who|cualquiera\\s+que|todos\\s+los\\s+que)\\b',
].join('|'), 'i');
// Veto: framing that DEFERS the determination to a licensed human instead of making
// it. These must be genuinely non-committal — "may apply" defers, "may have"
// asserts a probability, so only the former appears here.
const SEP_VERIFY_RE = new RegExp([
  '\\b(whether|if)\\b[^,;]{0,40}\\b(appl|qualif|eligib|available|have)',
  '\\bsi\\b[^,;]{0,40}\\b(aplica|le\\s+aplica|califica|corresponde|tiene\\s+disponible|tiene)',
  '\\b(verify|verifying|confirm|confirming|check|checking|review|reviewing)\\b',
  '\\b(verificar|confirmar|revisar|comprobar)\\w*',
  '\\b(would\\s+need\\s+to|hay\\s+que|habr[ií]a\\s+que|tendr[ií]amos\\s+que)\\b',
  "\\b(don'?t\\s+want\\s+to\\s+assume|no\\s+quiero\\s+asumir|cannot\\s+confirm|can'?t\\s+confirm|no\\s+puedo\\s+confirmar)\\b",
  '\\b(may\\s+apply|might\\s+apply|could\\s+apply|puede\\s+aplicar|podr[ií]a\\s+aplicar)\\b',
  '\\bwhich\\s+enrollment\\s+period\\b|\\bqu[eé]\\s+per[ií]odo\\s+de\\s+inscripci',
].join('|'), 'i');

// ── AUDIT 2026-08-13 — redundancy guard for the appended safe copy ───────────
// Observed on the LIVE endpoint (probe 4, caregiver scenario): the model produced a
// fully correct refusal on its own — "that depends on the carrier's rules and
// whether your mother has given you legal authority … the plan verifies that
// directly" — and rule 14 then appended its own safe copy anyway, so the caller
// read the same point twice. Compliance was satisfied; the reply was clumsy.
// Rules 4 and 13 already suppressed a duplicate append and 14-17 did not, so this
// generalizes that check: if the surviving text already makes the point, the
// appended sentence is noise. A control that degrades the answer it protects is
// half a control, and this is a senior audience reading it out loud.
function alreadyCovered(text, probes) {
  for (let i = 0; i < probes.length; i++) if (probes[i].test(text)) return true;
  return false;
}

// Clause-level veto test. Sentence-level testing is what caused defect F-02 in the
// opt-out guard: an exclusion found anywhere in the sentence excused a violation
// elsewhere in it. Signal and veto must share a clause to cancel out, so this
// splits on the same boundaries rule 13 uses and asks whether the SPECIFIC clause
// carrying the SEP token is verification-framed.
function sepClauseIsVerificationFramed(sentence) {
  const clauses = sentence.split(/(?:,|;|—|--|\bso\b|\bbut\b|\bpero\b|\bas[ií]\s+que\b|\bentonces\b|\bporque\b|\bbecause\b|\bsince\b|\bya\s+que\b)/i);
  for (let i = 0; i < clauses.length; i++) {
    if (!SEP_TOKEN_RE.test(clauses[i])) continue;
    // Include the preceding clause: "Whether you have a SEP available" splits at no
    // boundary, but "…, whether a SEP applies, …" does, and the framing word can
    // land just before the token.
    const span = [clauses[i - 1] || '', clauses[i]].join(' ');
    if (!SEP_VERIFY_RE.test(span)) return false;
  }
  return true;
}

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
  // 2026-08-13 (found by the §15 wiring suite) — the net had NO Spanish
  // self-harm phrases: "me quiero matar" sailed past this list and reached the
  // LLM. The stem `suicid` only covers the clinical word; real callers say
  // "matarme" / "quitarme la vida" / "ya no quiero vivir". Mirrors the client
  // engine's detectCrisisLanguage ES list. api/chat.js routes these to the 988
  // Lifeline (crisis wins over the generic 911 medical script).
  /\b(matarme|me\s+quiero\s+matar|me\s+voy\s+a\s+matar|quitar(me|se)?\s+la\s+vida|ya\s+no\s+quiero\s+vivir|no\s+quiero\s+seguir\s+viviendo|quiero\s+morirme|me\s+quiero\s+morir|prefiero\s+morir|terminar\s+con\s+todo|acabar\s+con\s+todo|hacerme\s+da[nñ]o)\b/,
  /\b(end\s+my\s+life|end\s+it\s+all|don'?t\s+want\s+to\s+live|wanna\s+die|i\s+want\s+to\s+die|better\s+off\s+dead|no\s+point\s+in\s+living)\b/,
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

// ── CP-03 (2026-08-13) — clinical-concern net, server mirror ─────────────────
// Mirror of the 'clinical_concern' tier in src/lib/safetyRouter.ts. Both exist because
// Zara answers many turns from her client-side classifier without ever reaching this
// endpoint, while her LLM fallback and all of Clara's LLM turns come through here. A
// safety net present on only one of those paths is not a safety net.
//
// The audit case: "I take warfarin and I've been really dizzy for two days" matched
// NOTHING and received ordinary Medicare education. This fires on the CONJUNCTION of a
// high-risk medication and a new symptom, vetoed by cost/coverage framing so that
// "my warfarin copay went up" — a core service question — is never escalated.
// See safetyRouter.ts for why this is a separate tier rather than a wider 911 net.
var HIGH_RISK_MED_RE = /\b(warfarin|warfarina|coumadin|jantoven|blood\s*thinner(s)?|anticoagulant\w*|anticoagulante|eliquis|apixaban|xarelto|rivaroxaban|pradaxa|dabigatran|savaysa|plavix|clopidogrel|insulin|insulina|digoxin|digoxina|lanoxin|lithium|litio|methotrexate|metotrexato|amiodarone|amiodarona|prednisone|prednisona)\b/i;
// Excludes bleeding / chest pain / breathing / fainting — those are already 911, and
// matchesEmergency runs first, so an acute case can never be downgraded to this tier.
var CONCERN_SYMPTOM_RE = new RegExp([
  '\\b(dizzy|dizziness|light[\\s-]?headed|weak|weakness|fatigued|exhausted)\\b',
  '\\b(bruis(e|es|ing)|nose\\s?bleed(s)?)\\b',
  '\\b(confus(ed|ion)|disoriented)\\b',
  '\\b(vomiting|throwing\\s+up|nausea|nauseous)\\b',
  '\\b(black\\s+stool|tarry\\s+stool|dark\\s+urine|blurr?(y|ed)\\s+vision)\\b',
  // Overt blood signs. These matched NEITHER net before: matchesEmergency requires the
  // literal word "bleeding" (or "blood everywhere"), so "blood in my stool" — a GI-bleed
  // sign that is exactly why warfarin monitoring exists — fell straight through to
  // ordinary Medicare education. Placed in this tier rather than the 911 net on purpose:
  // the copy here already tells the person to call 911 if it is severe or worsening,
  // which leaves the severity judgment with them and their clinician instead of Clear
  // Point asserting a triage decision it is not qualified to make.
  '\\b(blood\\s+in\\s+(my\\s+|the\\s+)?(stool|urine|vomit|phlegm|spit)|bloody\\s+(stool|urine|nose)|coughing\\s+up\\s+blood|spitting\\s+blood)\\b',
  '\\b(palpitations|heart\\s+racing|irregular\\s+heartbeat|swollen|swelling)\\b',
  '\\b(fell|falling|unsteady|off\\s+balance)\\b',
  '\\b(maread[oa]|mareos?|aturdid[oa]|debil|debilidad|agotad[oa])\\b',
  '\\b(moreton(es)?|hematoma|sangrado\\s+de\\s+nariz)\\b',
  '\\b(confundid[oa]|confusion|desorientad[oa])\\b',
  '\\b(vomito|vomitando|nauseas?)\\b',
  '\\b(heces\\s+negras|orina\\s+oscura|vision\\s+borrosa)\\b',
  '\\b(sangre\\s+en\\s+(las\\s+|la\\s+|el\\s+)?(heces|orina|vomito|popo)|tosiendo\\s+sangre|escupiendo\\s+sangre)\\b',
  '\\b(palpitaciones|corazon\\s+acelerado|hinchad[oa]|hinchazon)\\b',
  '\\b(me\\s+cai|caidas|desequilibrio)\\b',
].join('|'), 'i');
var CONCERN_VETO_RE = new RegExp([
  '\\b(co-?pay(ment)?s?|copago|cost(s)?|costo|cuesta|precio|price|expensive|caro|afford)\\b',
  '\\b(coverage|covered|cobertura|cubierto|cubre|formulary|formulario|tier|nivel)\\b',
  '\\b(refill|resurtir|pharmac(y|ies)|farmacia|prior\\s+authorization|autorizacion\\s+previa)\\b',
  '\\b(deductible|deducible|premium|prima|donut\\s+hole|coverage\\s+gap)\\b',
  '\\b(went\\s+up|subio|extra\\s+help|ayuda\\s+extra|switch\\s+plans|cambiar\\s+de\\s+plan)\\b',
].join('|'), 'i');

var CLINICAL_CONCERN_REPLY = {
  en: "I'm not able to give any medical guidance, and I don't want to guess about a symptom while you're on that medication — please contact your prescriber or your pharmacist today and tell them exactly what you told me. A pharmacist can usually speak with you the same day without an appointment. If the symptom is severe, or it gets worse, call 911 or go to an emergency room. I'm here for the Medicare side whenever you want to come back to it — and a licensed advisor is at 1-855-720-8555.",
  es: 'No puedo darle ninguna indicación médica, y no quiero adivinar sobre un síntoma mientras usted toma ese medicamento — por favor comuníquese hoy con su médico o su farmacéutico y dígale exactamente lo que me dijo. Un farmacéutico normalmente puede atenderle el mismo día sin cita. Si el síntoma es fuerte, o empeora, llame al 911 o vaya a una sala de emergencias. Yo sigo aquí para lo de Medicare cuando quiera retomarlo — y un asesor licenciado está al 1-855-720-8555.',
};

/**
 * CP-03 — TRUE when the user reports a symptom while naming a high-risk medication and
 * is NOT asking about cost or coverage. Call AFTER matchesEmergency.
 */
export function matchesClinicalConcern(text) {
  var t = normLoose(text);
  if (!t || t.length < 4) return false;
  if (CONCERN_VETO_RE.test(t)) return false;
  return HIGH_RISK_MED_RE.test(t) && CONCERN_SYMPTOM_RE.test(t);
}

/** CP-03 — bilingual copy for the clinical-concern tier. */
export function clinicalConcernReply(lang) {
  return CLINICAL_CONCERN_REPLY[lang === 'en' ? 'en' : 'es'];
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
  // AUDIT 2026-08-13 — the verification veto now applies to EVERY pattern here,
  // not just the one that happened to carry a lookbehind. A claim pattern that
  // fires inside a verification-framed clause is a false positive, and rewriting a
  // correct "whether a SEP applies" answer into a non-answer is a real harm to the
  // caller, not a harmless over-catch.
  var sepHit = false;
  var sepSentencesAll = out.split(/(?<=[.!?])\s+/);
  for (var si = 0; si < SEP_CLAIM_RES.length; si++) {
    for (var sk = 0; sk < sepSentencesAll.length; sk++) {
      if (SEP_CLAIM_RES[si].test(sepSentencesAll[sk])
        && !sepClauseIsVerificationFramed(sepSentencesAll[sk])) {
        sepHit = true;
        violations.push('sep_claim:' + SEP_CLAIM_RES[si].source.slice(0, 40));
        break;
      }
    }
  }
  if (sepHit) {
    var sepSafe = SEP_SAFE[lang === 'en' ? 'en' : 'es'];
    var sepSentences = sepSentencesAll;
    var sepClean = sepSentences.filter(function (s) {
      if (sepClauseIsVerificationFramed(s)) return true;
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

  // ── AUDIT 2026-08-13 (§19 M–T, AD) — SEP DEFAULT-DENY net (rule 13) ───────
  // WHY THIS EXISTS EVEN THOUGH RULE 4 ALREADY TARGETS SEP CLAIMS: rule 4
  // enumerates PHRASINGS ("you have/qualify for … SEP"). §19 M/N/O/P/Q/R/S/T
  // testing walked straight through it four different ways, all of which assert
  // an enrollment window just as hard:
  //   N  "Since you have Extra Help, you can change plans right now under a SEP."
  //   P  "You moved out of the service area, so your SEP runs for two months."
  //   R  "FEMA declared a disaster … so you automatically have a SEP."   ("automatically"
  //      is an adverb rule 4's \s* cannot span)
  //   T  "…most people have a Special Enrollment Period anyway."         (third-party
  //      generalization, no "you" at all)
  // This is the SAME root cause that made the first SSN-advice rule fail 15 of 20
  // attacks: enumerating attack phrasings instead of denying by default. So this
  // rule inverts the polarity — a SEP token in an ASSERTIVE clause is refused
  // unless that clause also carries verification framing.
  //
  // PER-CLAUSE, not per-sentence. The DNC guard's F-02 defect was exactly this:
  // an exclusion found anywhere in the sentence excused an assertion elsewhere in
  // it. Signal and veto must share a clause to cancel out.
  // SEP_TOKEN_RE / SEP_ASSERT_RE / SEP_VERIFY_RE are module-scope constants shared
  // with rule 4 — see the hoisting note at the top of this file.
  var SEP_SAFE_13 = {
    es: 'Para saber si puede cambiar ahora, primero habría que verificar qué período de inscripción tiene disponible — no quiero asumir que existe un Periodo Especial sin revisar su situación. Un asesor licenciado lo confirma sin costo al 1-855-720-8555.',
    en: "To know whether you can change now, we'd first have to verify which enrollment period you have available — I don't want to assume a Special Enrollment Period exists without reviewing your situation. A licensed advisor can confirm it at no cost at 1-855-720-8555.",
  };
  var sep13Hit = false;
  var sep13Sentences = out.split(/(?<=[.!?])\s+/);
  var sep13Clean = sep13Sentences.filter(function (s) {
    if (!SEP_TOKEN_RE.test(s)) return true;
    // Split into clauses so a verification clause cannot launder an assertive one.
    var clauses = s.split(/(?:,|;|—|--|\bso\b|\bbut\b|\bpero\b|\bas[ií]\s+que\b|\bentonces\b|\bporque\b|\bbecause\b|\bsince\b|\bya\s+que\b)/i);
    // The SEP token and the assertion may sit in ADJACENT clauses ("…out of the
    // service area, so your SEP runs for two months"), so evaluate each clause
    // that carries the token together with its immediate neighbours.
    for (var ci13 = 0; ci13 < clauses.length; ci13++) {
      var clause13 = clauses[ci13];
      if (!SEP_TOKEN_RE.test(clause13) && !SEP_ASSERT_RE.test(clause13)) continue;
      var span13 = [clauses[ci13 - 1] || '', clause13, clauses[ci13 + 1] || ''].join(' ');
      if (SEP_TOKEN_RE.test(span13) && SEP_ASSERT_RE.test(span13) && !SEP_VERIFY_RE.test(span13)) {
        sep13Hit = true;
        return false;
      }
    }
    return true;
  });
  if (sep13Hit) {
    violations.push('sep_assertion_default_deny');
    var sep13Safe = SEP_SAFE_13[lang === 'en' ? 'en' : 'es'];
    out = sep13Clean.join(' ').trim();
    if (!/no quiero asumir que existe un periodo especial|don'?t want to assume a special enrollment|qu[eé] per[ií]odo de inscripci|which enrollment period/i.test(out)) {
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + sep13Safe : sep13Safe;
    }
  }

  // ── AUDIT 2026-08-13 (§19 F) — third-party authority net (rule 14) ────────
  // A caregiver, adult child or neighbour calling about someone else is the most
  // common real-world call this business gets, and it is the one where an
  // assistant most easily does harm: confirming the beneficiary's coverage to an
  // unverified third party, or worse, telling that person they have authority
  // they may not have. Whether a caregiver may act is a carrier/CMS
  // representative-authority question (BLOCKED-CARRIER in the ledger), so the
  // correct behavior is to refuse to adjudicate it — not to guess generously.
  // Taking a message and routing to a licensed human is always allowed.
  var THIRD_PARTY_RE = /\b(as|since|because)\s+(you'?re|you\s+are|your)\b[^.!?]{0,30}\b(daughter|son|wife|husband|spouse|caregiver|power\s+of\s+attorney|\bPOA\b|guardian|hija|hijo|esposa|esposo|cuidador\w*|apoderad\w*|representante)\b|\b(su|tu)\s+(hija|hijo|madre|padre|mam[aá]|pap[aá])\b/i;
  var AUTHORITY_CLAIM_RE = /\b(you\s+are|you'?re)\s+(authorized|allowed|permitted|able)\b|\byou\s+(can|may)\s+(make\s+changes|change|enroll|cancel|sign)\b|\b(est[aá]|est[aá]s)\s+autorizad\w*|\bpuede\s+(hacer\s+cambios|cambiar|inscribir|cancelar|firmar)\b/i;
  var THIRD_PARTY_CONFIRM_RE = /\b(confirm|verify|tell\s+you)\b[^.!?]{0,60}\b(is\s+enrolled|enrolled\s+in|deductible|coverage|plan|benefits)\b|\b(est[aá]\s+inscrit\w*|su\s+deducible|su\s+cobertura)\b/i;
  var tpSafe = {
    es: 'No puedo confirmar ni cambiar la información de otra persona, y tampoco puedo determinar quién está autorizado a actuar en su nombre — eso lo verifica el plan directamente. Con gusto tomo su mensaje para que un asesor licenciado le llame y revise qué se necesita. También puede llamarnos al 1-855-720-8555.',
    en: "I can't confirm or change another person's information, and I can't determine who is authorized to act on their behalf — the plan verifies that directly. I'm glad to take your message so a licensed advisor can call and go over what's needed. You can also reach us at 1-855-720-8555.",
  };
  var tp14Hit = false;
  var tp14Clean = out.split(/(?<=[.!?])\s+/).filter(function (s) {
    var isThirdParty = THIRD_PARTY_RE.test(s);
    if (AUTHORITY_CLAIM_RE.test(s) && (isThirdParty || /\bauthoriz|autorizad/i.test(s))) { tp14Hit = true; return false; }
    if (isThirdParty && THIRD_PARTY_CONFIRM_RE.test(s)) { tp14Hit = true; return false; }
    return true;
  });
  if (tp14Hit) {
    violations.push('third_party_authority');
    out = tp14Clean.join(' ').trim();
    var tp14Safe = tpSafe[lang === 'en' ? 'en' : 'es'];
    // Suppress the append when the model already refused correctly on its own.
    var TP14_COVERED = [
      /can'?t\s+(confirm|share|discuss)[^.!?]{0,40}(another|other)\s+person|no\s+puedo\s+confirmar[^.!?]{0,40}otra\s+persona/i,
      /(plan|carrier)\s+verifies\s+that|el\s+plan\s+(lo\s+)?verifica/i,
      /can'?t\s+de(cide|termine)\s+who\s+is\s+authorized|no\s+puedo\s+de(cidir|terminar)\s+qui[eé]n\s+est[aá]\s+autorizad/i,
    ];
    if (!alreadyCovered(out, TP14_COVERED)) {
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + tp14Safe : tp14Safe;
    }
  }

  // ── AUDIT 2026-08-13 (§19 U/V/W/X/Z, AD) — clinical & outcome net (rule 15) ─
  // Four distinct harms, one deterministic net, because they share a shape: the
  // assistant substituting its own judgment for a prescriber's or an adjudicator's.
  //   U  "…so ask your doctor to switch you to the generic instead."  (drug advice)
  //   V  "…but your exception will be approved."                      (guaranteed outcome)
  //   W  "Your prior authorization is covered and will go through."   (guaranteed outcome)
  //   X  "For that pain you should take ibuprofen twice a day…"       (clinical advice)
  //   AD "…rejected because the carrier found you ineligible."        (invented adjudication)
  // Explaining the PROCESS (what a formulary exception is, that an appeal exists,
  // that a prescriber submits it) is legitimate education and must survive — the
  // tests assert that explicitly, because a net that eats the education is a net
  // that gets turned off.
  var CLINICAL_ADVICE_RE = new RegExp([
    // Dosing or drug-choice instruction aimed at the beneficiary.
    "\\b(you\\s+should|you\\s+need\\s+to|you\\s+ought\\s+to|try|take|stop\\s+taking|switch\\s+to|instead\\s+of\\s+your)\\b[^.!?]{0,60}\\b(ibuprofen|tylenol|acetaminophen|aspirin|insulin|metformin|statin|generic|brand|dose|dosage|twice\\s+a\\s+day|once\\s+a\\s+day|mg\\b|milligram)",
    '\\b(deber[ií]a|debe|tiene\\s+que|pruebe|tome|deje\\s+de\\s+tomar|cambie\\s+a|en\\s+lugar\\s+de\\s+su)\\b[^.!?]{0,60}\\b(ibuprofeno|acetaminof|aspirina|insulina|metformina|gen[eé]ric\\w*|dosis|dos\\s+veces\\s+al\\s+d[ií]a|una\\s+vez\\s+al\\s+d[ií]a|\\bmg\\b|miligramo)',
    // Telling the beneficiary to direct their prescriber's therapeutic choice.
    '\\b(ask|tell|have)\\s+your\\s+(doctor|physician|prescriber|md)\\b[^.!?]{0,50}\\b(switch|change|substitute|prescribe\\s+instead)',
    '\\b(p[ií]dale|d[ií]gale)\\s+a\\s+su\\s+(m[eé]dico|doctor)\\b[^.!?]{0,50}\\b(cambie|sustituya|receta\\s+en\\s+lugar)',
  ].join('|'), 'i');
  var GUARANTEED_OUTCOME_RE = new RegExp([
    '\\b(your|the)\\s+(exception|appeal|prior\\s+authorization|prior\\s+auth|\\bPA\\b|coverage\\s+determination|grievance|redetermination|request)\\b[^.!?]{0,50}\\b(will\\s+be\\s+(approved|granted|covered)|is\\s+approved|is\\s+covered|will\\s+go\\s+through|gets\\s+approved|is\\s+guaranteed)',
    '\\b(su|la)\\s+(excepci[oó]n|apelaci[oó]n|autorizaci[oó]n\\s+previa|determinaci[oó]n|solicitud)\\b[^.!?]{0,50}\\b(ser[aá]\\s+aprobad|est[aá]\\s+aprobad|va\\s+a\\s+ser\\s+aprobad|se\\s+va\\s+a\\s+aprobar|est[aá]\\s+cubiert|garantizad)',
    // Adjudication invented on the plan's behalf, in either direction.
    "\\b(was|were)\\s+(rejected|denied|declined)\\b[^.!?]{0,40}\\b(because|since)\\b[^.!?]{0,60}\\b(ineligib|not\\s+eligib|found\\s+you|didn'?t\\s+qualify|do\\s+not\\s+qualify)",
    '\\b(fue|fueron)\\s+(rechazad|denegad)\\w*[^.!?]{0,40}\\bporque\\b[^.!?]{0,60}\\b(no\\s+(es|era)\\s+elegib|no\\s+calific)',
  ].join('|'), 'i');
  var clin15Safe = {
    es: 'No puedo darle indicaciones médicas ni anticipar la decisión de un plan — los medicamentos los ajusta su médico, y las excepciones, autorizaciones y apelaciones las decide el plan por escrito. Sí le puedo explicar cómo funciona el proceso, y un asesor licenciado puede revisar su caso con usted sin costo al 1-855-720-8555.',
    en: "I can't give medical direction or predict a plan's decision — medication changes come from your prescriber, and exceptions, authorizations and appeals are decided by the plan in writing. I can explain how the process works, and a licensed advisor can review your situation with you at no cost at 1-855-720-8555.",
  };
  var clin15Hit = false;
  var clin15Clean = out.split(/(?<=[.!?])\s+/).filter(function (s) {
    if (CLINICAL_ADVICE_RE.test(s)) { clin15Hit = true; violations.push('clinical_advice'); return false; }
    if (GUARANTEED_OUTCOME_RE.test(s)) { clin15Hit = true; violations.push('guaranteed_outcome'); return false; }
    return true;
  });
  if (clin15Hit) {
    out = clin15Clean.join(' ').trim();
    var c15Safe = clin15Safe[lang === 'en' ? 'en' : 'es'];
    var C15_COVERED = [
      /(can'?t|cannot|not\s+able\s+to)\s+give\s+(medical|clinical)|no\s+puedo\s+dar\w*\s+(indicaciones\s+)?m[eé]dic/i,
      /(prescriber|your\s+doctor)\s+(decides|determines)|su\s+m[eé]dico\s+(decide|determina)/i,
      /(can'?t|cannot)\s+predict[^.!?]{0,30}(decision|outcome)|no\s+puedo\s+(predecir|anticipar)/i,
    ];
    if (!alreadyCovered(out, C15_COVERED)) {
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + c15Safe : c15Safe;
    }
  }

  // ── AUDIT 2026-08-13 (§19 Y/AE/AF/AG) — effective-date net (rule 16) ──────
  // §8Q states it plainly: never tell a beneficiary a future plan is active
  // before its effective date. The §19 Y case is the dangerous version — someone
  // with surgery tomorrow being told to enroll today and be covered. Medicare
  // effective dates are set by the election period, not by when the paperwork is
  // signed, and acting on a false "you're covered" can mean an uncovered
  // procedure. Also covers the false-capability claim (AF): no surface here can
  // write to Medicare, a carrier or SSA, so any "I updated/changed it for you" is
  // false by construction.
  var COVERAGE_NOW_RE = new RegExp([
    "\\b(will\\s+be|is|are|you'?re|you\\s+are)\\s+(active|effective|in\\s+effect|covered|good\\s+to\\s+go)\\b[^.!?]{0,40}\\b(today|tomorrow|right\\s+now|immediately|this\\s+week|by\\s+then|for\\s+(your|the)\\s+(surgery|procedure|appointment|operation))",
    '\\b(enroll|sign\\s+up|apply)\\b[^.!?]{0,40}\\b(today|now)\\b[^.!?]{0,40}\\b(covered|active|effective)\\b',
    '\\b(est[aá]|estar[aá]|queda|quedar[aá])\\s+(activ\\w*|vigente|cubiert\\w*)\\b[^.!?]{0,40}\\b(hoy|ma[nñ]ana|ahora\\s+mismo|de\\s+inmediato|para\\s+(su|la)\\s+(cirug[ií]a|operaci[oó]n|procedimiento|cita))',
    '\\bcobertura\\s+empieza\\s+(hoy|ma[nñ]ana|ahora)\\b',
  ].join('|'), 'i');
  var FALSE_WRITE_RE = /\bI\s+(updated|changed|corrected|cancelled|canceled|submitted|filed|enrolled|fixed)\b[^.!?]{0,40}\b(with|at|to)\s+(medicare|social\s+security|ssa|the\s+carrier|the\s+plan)\b|\byo\s+(actualic|cambi|corregi|cancel|envi|inscrib)\w*[^.!?]{0,40}\b(con|en)\s+(medicare|seguro\s+social|el\s+plan|la\s+aseguradora)\b|\bI\s+(updated|changed|corrected)\s+your\s+address\s+with\b/i;
  var eff16Safe = {
    es: 'No puedo confirmar cuándo entra en vigor una cobertura, y no puedo hacer cambios ante Medicare, el Seguro Social ni el plan — eso solo lo confirma el plan o Medicare directamente. La fecha de vigencia depende del período de inscripción que aplique, no del día en que se firma. Si tiene algo médico programado, llame al 1-855-720-8555 y un asesor licenciado revisa su caso antes de que usted cuente con esa cobertura.',
    en: "I can't confirm when coverage takes effect, and I can't make changes with Medicare, Social Security or a plan — only the plan or Medicare confirms that directly. An effective date depends on which enrollment period applies, not on the day something is signed. If you have something medical scheduled, please call 1-855-720-8555 so a licensed advisor can review it before you rely on that coverage.",
  };
  var eff16Hit = false;
  var eff16Clean = out.split(/(?<=[.!?])\s+/).filter(function (s) {
    if (COVERAGE_NOW_RE.test(s)) { eff16Hit = true; violations.push('coverage_effective_now'); return false; }
    if (FALSE_WRITE_RE.test(s)) { eff16Hit = true; violations.push('false_write_claim'); return false; }
    return true;
  });
  if (eff16Hit) {
    out = eff16Clean.join(' ').trim();
    var e16Safe = eff16Safe[lang === 'en' ? 'en' : 'es'];
    var E16_COVERED = [
      /effective\s+dates?[^.!?]{0,60}(enrollment\s+period|not\s+on\s+the\s+day)|fecha\s+de\s+vigencia[^.!?]{0,60}per[ií]odo\s+de\s+inscripci/i,
      /will\s+not\s+cover|won'?t\s+cover|no\s+(va\s+a\s+)?cubrir/i,
      /(can'?t|cannot)\s+(confirm|make\s+changes)\s+with\s+(medicare|social\s+security)|no\s+puedo\s+(confirmar|hacer\s+cambios)\s+(ante|con)\s+medicare/i,
    ];
    if (!alreadyCovered(out, E16_COVERED)) {
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + e16Safe : e16Safe;
    }
  }

  // ── AUDIT 2026-08-13 (§19 AC) — high-pressure-tactic net (rule 17) ────────
  // 42 CFR §422.2264(b) forbids high-pressure marketing tactics, and §8T asks
  // for pressure-pattern detection. Manufactured scarcity is the canonical form:
  // a real enrollment deadline is a fact worth stating, but "decide today or lose
  // this chance forever" is a sales tactic. The distinction the net draws is
  // urgency attached to the CONSUMER'S DECISION versus a stated calendar date —
  // "AEP ends December 7" survives; "you must decide today" does not.
  var PRESSURE_RE = new RegExp([
    "\\b(decide|sign|enroll|act|commit)\\b[^.!?]{0,30}\\b(today|now|right\\s+now|immediately)\\b[^.!?]{0,40}\\b(or|otherwise|before)\\b[^.!?]{0,40}\\b(lose|miss|forfeit|gone|never|won'?t\\s+be\\s+able)",
    '\\b(last|only)\\s+chance\\b|\\bnow\\s+or\\s+never\\b|\\bthis\\s+offer\\s+expires\\s+(today|tonight|in\\s+\\d+\\s+(minute|hour))',
    '\\b(decida|firme|inscr[ií]base|act[uú]e)\\b[^.!?]{0,30}\\b(hoy|ahora|ya|de\\s+inmediato)\\b[^.!?]{0,40}\\b(o|antes\\s+de\\s+que)\\b[^.!?]{0,40}\\b(pierde|perder|se\\s+queda\\s+sin|nunca)',
    '\\b[uú]ltima\\s+oportunidad\\b|\\bahora\\s+o\\s+nunca\\b',
  ].join('|'), 'i');
  var press17Safe = {
    es: 'No hay ninguna prisa y nadie debe presionarlo para decidir. Los períodos de inscripción tienen fechas fijas que un asesor licenciado le puede confirmar, y usted puede tomarse el tiempo que necesite — incluso colgar y pensarlo.',
    en: "There's no rush, and no one should pressure you to decide. Enrollment periods have fixed dates a licensed advisor can confirm for you, and you're free to take as much time as you need — including ending the call and thinking it over.",
  };
  var press17Hit = false;
  var press17Clean = out.split(/(?<=[.!?])\s+/).filter(function (s) {
    if (PRESSURE_RE.test(s)) { press17Hit = true; return false; }
    return true;
  });
  if (press17Hit) {
    violations.push('high_pressure_tactic');
    out = press17Clean.join(' ').trim();
    var p17Safe = press17Safe[lang === 'en' ? 'en' : 'es'];
    var P17_COVERED = [
      /no\s+(rush|pressure|hay\s+ninguna\s+prisa)|take\s+as\s+much\s+time|t[oó]mese\s+el\s+tiempo/i,
      /no\s+one\s+should\s+pressure|nadie\s+debe\s+presionar/i,
    ];
    if (!alreadyCovered(out, P17_COVERED)) {
      out = out ? (/[.!?]\s*$/.test(out) ? out + ' ' : out + '. ') + p17Safe : p17Safe;
    }
  }

  return { text: out, violations: violations };
}

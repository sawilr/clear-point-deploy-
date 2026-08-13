// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-08-12 — Contact opt-out / DNC guard (web chat).
//
// Live failure being fixed: a user wrote "No quiero que me llamen ni me manden
// mensajes. Borren mi información. STOP." and Zara answered "¿Cuál es su primer
// nombre?" — an opt-out routed into lead intake. A second refusal produced an
// offer to CALL the user. TCPA/CMS posture requires the opposite: acknowledge
// the revocation, stop collecting, never offer contact again in-session.
//
// This module is detection + response only (pure, no side effects). The bots
// wire it BEFORE intent classification (after the 988/911 safety router, which
// keeps absolute priority) and are responsible for:
//   1. rendering the acknowledgment;
//   2. flipping session consent flags to false;
//   3. persisting the ContactPermission record (sessionStorage, PII-free);
//   4. suppressing callback/advisor offers for the rest of the session.
//
// Downstream CRM suppression (existing contacts) is handled at the CRM layer
// (SMS STOP keyword + manual DND) — documented in the ops runbook. This guard
// governs the chat surface.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactPermission {
  call: 'ALLOWED' | 'BLOCKED';
  sms: 'ALLOWED' | 'BLOCKED';
  email: 'ALLOWED' | 'BLOCKED';
  automatedFollowup: 'ALLOWED' | 'BLOCKED';
  source: 'chat_optout';
  timestamp: string;
  /** Category only — never the raw message (PII hygiene). */
  evidence: 'optout_all' | 'optout_call' | 'optout_sms' | 'optout_email_only' | 'optout_deletion';
}

export interface OptOutResult {
  matched: boolean;
  wantsDeletion: boolean;
  permission: ContactPermission | null;
  responseEn: string;
  responseEs: string;
}

// ── DECISION PROCEDURE (rewritten after adversarial red team 2026-08-12) ────
// The first version enumerated exact revocation phrasings; 12 of 28 real
// revocations walked past it ("Do not contact.", "Don't ever call me again",
// "I'd rather you didn't call", "take my number off", "opt me out", "no me
// vuelvan a llamar", "quítenme del sistema", "ya no quiero que me busquen",
// "borre mi número") while 3 non-revocations wrongly triggered a permanent DNC
// ("Remove me from that plan", "No quiero más mensajes DE MI ASEGURADORA",
// "They should stop calling MY DOCTOR").
//
// Replaced with a compositional decision procedure:
//   1. THIRD-PARTY SENDER  → not our contact at all            → no DNC
//   2. COVERAGE TARGET     → a plan/enrollment request         → no DNC
//   3. UNIVERSAL STOP      → unconditional revocation          → DNC
//   4. NEGATED CONTACT     → revocation, unless the object is a third party,
//                            or it is a reschedule with no permanence marker
//   5. DELETION            → revocation + deletion request
//   6. EMAIL ONLY          → channel preference (email stays open)

/** Speaker is complaining about someone ELSE contacting them. */
const THIRD_PARTY_SENDER_RE =
  /\b(?:from|de|del)\s+(?:my|mi|the|la|el)?\s*(?:aseguradora|insurance|insurer|carrier|plan|medicare|medicaid|hospital|doctor|farmacia|pharmacy|company|compa[ñn][ií]a)\b/i;

/** The request is about a PLAN/enrollment, not about contact permission. */
const COVERAGE_TARGET_RE =
  /\b(?:from|de|del)\s+(?:that|this|my|ese|este|mi|el|la)?\s*(?:plan|coverage|cobertura|policy|p[oó]liza|enrollment|inscripci[oó]n|medicare\s+advantage|part\s+d)\b|\bstop\s+(?:my|the)\s+(?:plan|coverage|enrollment)\b|\bcancel(?:ar)?\s+(?:mi|el|my|the)\s+(?:plan|cobertura|coverage)\b/i;

/** Unconditional revocation keywords — no object or context needed. */
const UNIVERSAL_STOP_RES: RegExp[] = [
  /^\s*(?:(?:stop|alto|basta|para|parar)[\s.,!]*)+$/i,          // "STOP", "STOP STOP STOP", "stop."
  /\bunsubscribe\b/i,
  /\bopt\s+me\s+out\b/i,
  /\bopt\s*-?\s*out\s+(?:me|of\s+(?:everything|all))\b/i,
  /\bleave\s+me\s+alone\b/i,
  /\bdo\s+not\s+contact\b|\bdon'?t\s+contact\b/i,
  // F-03 (P1): the trailing preposition was OPTIONAL, so "take me back to the
  // topics" and "take me to the enrollment page" fired a permanent DNC and
  // locked the visitor out of every intake path. It is now mandatory.
  /\b(?:remove|take)\s+(?:me|my\s+(?:number|name|phone|info(?:rmation)?|email))\s+(?:from|off|out\s+of)\b/i,
  /\b(?:s[aá]quen?me|qu[ií]ten?me|b[oó]rren?me|elim[ií]nen?me)\s+(?:de|del)\b/i,
  /\bcancelar?\s+todo\s+contacto\b/i,
  /\bno\s+(?:quiero|deseo)\s+m[aá]s\s+(?:mensajes|llamadas|contacto|correos)\b/i,
  /\bno\s+more\s+(?:messages|calls|texts|contact|emails)\b/i,
  /\bnot\s+interested\b[^.!?]{0,40}\b(?:don'?t|do\s+not|no)\s+(?:follow\s*up|contact|call|text)\b/i,
  /\bya\s+no\s+quiero\s+que\s+me\s+(?:llamen|contacten|busquen|escriban|molesten)\b/i,
];

/** Negation bound to a contact verb (broad; refined by the guards below). */
const NEGATED_CONTACT_RE =
  /\b(?:don'?t|do\s+not|never|stop|quit|rather\s+you\s+didn'?t)\s+(?:ever\s+|again\s+)?(?:call|contact|text|message|messaging|email|phone|ring|bother|calling|contacting|texting|emailing|phoning|bothering)\b|\bno\s+me\s+(?:vuelvan?\s+a\s+)?(?:llame|llamen|llames|llamar|contacte|contacten|contactar|escriba|escriban|escribir|manden|mandar|env[ií]en|enviar|molesten|molestar|busquen|buscar)\b|\bno\s+(?:quiero|deseo)\s+que\s+me\s+(?:llamen|llames|contacten|escriban|manden|env[ií]en|busquen)\b/i;

/**
 * The negated verb's object is CONTENT, not the person — "don't text that
 * information here" is a data-privacy preference, not a contact revocation.
 */
const CONTENT_OBJECT_RE =
  /\b(?:text|send|email|write|type|message|share|post|put)\s+(?:me\s+)?(?:that|this|it|those|these|the|any|eso|esa|esta|eso)\b/i;

/** The contact object is someone OTHER than the speaker. */
const THIRD_PARTY_OBJECT_RE =
  /\b(?:call|calling|contact|contacting|text|texting|bother|bothering)\s+(?:my|mi|the|el|la|su)\s+(?:doctor|m[eé]dico|mother|madre|father|padre|wife|esposa|husband|esposo|son|hijo|daughter|hija|office|oficina|pharmacy|farmacia|plan|insurance|aseguradora|neighbor|vecino)\b/i;

/** Permanence markers — make a revocation permanent regardless of day talk. */
const PERMANENCE_RE =
  /\b(?:ever|again|any\s?more|at\s+all|never|forever|permanently|nunca|jam[aá]s|m[aá]s|para\s+siempre|definitivamente)\b/i;

/**
 * A COMPLAINT that we failed to call — "you didn't call me back like you
 * promised", "nobody called me". The caller WANTS contact; treating this as a
 * revocation would block the callback they are asking for (F-09).
 */
// The `(?<!rather\s)` guard keeps "I'd rather you didn't call me" — a real
// revocation — out of the complaint bucket.
const MISSED_CALL_COMPLAINT_RE =
  /(?<!rather\s)\b(?:you|nobody|no\s+one|nadie)\s+(?:never\s+|didn'?t\s+|did\s+not\s+|no\s+me\s+)?(?:called|llam[oó]|contacted)\b|\bnever\s+(?:called|got\s+a\s+call)\b|\bno\s+me\s+(?:han\s+)?llamad[oa]\b|\bstill\s+waiting\s+for\s+(?:the\s+|a\s+)?call\b/i;

/** Rescheduling preference ("call Friday instead") — not a revocation. */
const RESCHEDULE_RE =
  /\b(?:ma[ñn]ana|m[aá]s\s+tarde|luego|otro\s+d[ií]a|otra\s+hora|el\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|tomorrow|later|another\s+(?:day|time)|instead|next\s+week|la\s+pr[oó]xima|mejor\s+(?:a|en|el))\b/i;

// Channel-specific (only consulted once a revocation is established).
const OPTOUT_CALL_RES: RegExp[] = [
  /\b(?:stop|quit)\s+calling\b/i,
  /\bdo\s+not\s+call\b|\bdon'?t\s+call\b/i,
  /\bno\s+me\s+(?:vuelvan?\s+a\s+)?(?:llame[ns]?|llamar)\b/i,
];
const OPTOUT_SMS_RES: RegExp[] = [
  /\b(?:stop|quit)\s+texting\b/i,
  /\bno\s+more\s+texts\b/i,
  /\bno\s+me\s+(?:manden|env[ií]en)\s+(?:m[aá]s\s+)?(?:mensajes|textos|correos)\b/i,
  /\bno\s+me\s+escriban?\s*(?:m[aá]s)?\b/i,
];
const EMAIL_ONLY_RES: RegExp[] = [
  /\bemail\s+only\b/i,
  /\bonly\s+(?:by\s+)?email\b/i,
  /\bsolo\s+(?:por\s+)?correo(?:\s+electr[oó]nico)?\b/i,
];

/** Data-deletion request (info, data, records, phone number). */
const DELETION_RES: RegExp[] = [
  /\b(?:delete|erase|remove|wipe)\s+(?:my|all\s+my)\s+(?:info(?:rmation)?|data|records?|number|phone|details?|account)\b/i,
  /\b(?:borr[ae]n?|elimin[ae]n?|quiten)\s+(?:mi|toda\s+mi|mis|el)\s+(?:informaci[oó]n|datos?|n[uú]mero|expediente|registro)\b/i,
];

function normLoose(s: string): string {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function anyMatch(res: RegExp[], t: string): boolean {
  return res.some((re) => re.test(t));
}

const RESPONSE_ALL = {
  en: 'Understood — we will not contact you. You will not receive calls or messages from us based on this conversation. If you ever change your mind, you can reach us at 1-855-720-8555 or info@clearpointsenioradvisors.com. Thank you, and have a good day.',
  es: 'Entendido — no le contactaremos. No recibirá llamadas ni mensajes nuestros a raíz de esta conversación. Si en el futuro cambia de opinión, puede llamarnos al 1-855-720-8555 o escribir a info@clearpointsenioradvisors.com. Gracias, y que tenga buen día.',
};
const RESPONSE_DELETION_SUFFIX = {
  en: ' To request deletion of any information we may have, email info@clearpointsenioradvisors.com or call 1-855-720-8555 and we will process it under our Privacy Policy.',
  es: ' Para solicitar la eliminación de cualquier información que tengamos, escriba a info@clearpointsenioradvisors.com o llame al 1-855-720-8555 y lo procesaremos según nuestra Política de Privacidad.',
};
const RESPONSE_EMAIL_ONLY = {
  en: 'Understood — email only. We will not call or text you; if an advisor follows up, it will be by email. You can update this preference anytime at 1-855-720-8555 or info@clearpointsenioradvisors.com.',
  es: 'Entendido — solo correo electrónico. No le llamaremos ni le enviaremos mensajes de texto; si un asesor le da seguimiento, será por correo. Puede cambiar esta preferencia cuando quiera al 1-855-720-8555 o info@clearpointsenioradvisors.com.',
};

function buildPermission(evidence: ContactPermission['evidence'], blocked: {
  call: boolean; sms: boolean; email: boolean;
}): ContactPermission {
  return {
    call: blocked.call ? 'BLOCKED' : 'ALLOWED',
    sms: blocked.sms ? 'BLOCKED' : 'ALLOWED',
    email: blocked.email ? 'BLOCKED' : 'ALLOWED',
    automatedFollowup: 'BLOCKED',
    source: 'chat_optout',
    timestamp: new Date().toISOString(),
    evidence,
  };
}

/**
 * Detect a contact-revocation / DNC request. Pure function — no side effects.
 * Returns matched=false for rescheduling preferences ("call me tomorrow").
 */
export function detectOptOut(userMessage: string): OptOutResult {
  const t = normLoose(userMessage);
  const none: OptOutResult = {
    matched: false, wantsDeletion: false, permission: null,
    responseEn: '', responseEs: '',
  };
  if (!t) return none;

  // ── PER-CLAUSE EVALUATION ────────────────────────────────────────────────
  // Whole-message evaluation was wrong in BOTH directions (found by red team
  // after the F-02 fix):
  //   • "No me llamen más. Ya tengo cobertura de mi aseguradora." — a genuine
  //     revocation whose SECOND sentence mentions the carrier was vetoed.
  //   • "No quiero más mensajes de mi aseguradora" — a carrier complaint whose
  //     universal-stop phrasing bypassed the veto entirely.
  // The signal and the exclusion must be judged in the SAME clause: an
  // explanation in a different sentence cannot cancel a revocation, and a
  // same-clause third-party/coverage reference still can.
  const clauses = t
    .split(/(?<=[.!?])\s+|\s*(?:,\s*(?:but|pero|however|aunque)\s+|;\s*|\s+—\s+)/)
    .map((c) => c.trim())
    .filter(Boolean);
  const units = clauses.length ? clauses : [t];

  const wantsDeletion = units.some((c) => anyMatch(DELETION_RES, c) && !COVERAGE_TARGET_RE.test(c));
  const emailOnly = anyMatch(EMAIL_ONLY_RES, t);

  /** A clause is a revocation when it carries a signal and no same-clause veto. */
  function clauseRevokes(c: string): { universal: boolean; negated: boolean } | null {
    const uni = anyMatch(UNIVERSAL_STOP_RES, c);
    const neg = NEGATED_CONTACT_RE.test(c);
    if (!uni && !neg) return null;
    // Not about Clear Point's contact at all.
    if (THIRD_PARTY_SENDER_RE.test(c)) return null;
    // A coverage/plan request, not a contact revocation.
    if (COVERAGE_TARGET_RE.test(c)) return null;
    // "They should stop calling my doctor" — object is a third party.
    if (THIRD_PARTY_OBJECT_RE.test(c)) return null;
    // "Don't text that information here" — object is content, not the person.
    if (CONTENT_OBJECT_RE.test(c)) return null;
    // A complaint that we FAILED to call is a request FOR contact (F-09).
    if (MISSED_CALL_COMPLAINT_RE.test(c)) return null;
    // Reschedule without a permanence marker is a preference, not a revocation.
    if (!uni && RESCHEDULE_RE.test(c) && !PERMANENCE_RE.test(c)) return null;
    return { universal: uni, negated: neg };
  }

  const hits = units.map(clauseRevokes).filter(Boolean) as Array<{ universal: boolean; negated: boolean }>;
  const universal = hits.some((h) => h.universal);
  const negatedContact = hits.some((h) => h.negated);
  const callOnly = units.some((c) => clauseRevokes(c) && anyMatch(OPTOUT_CALL_RES, c));
  const smsOnly = units.some((c) => clauseRevokes(c) && anyMatch(OPTOUT_SMS_RES, c));

  if (!hits.length && !emailOnly && !wantsDeletion) return none;

  const all = universal || negatedContact;

  if (emailOnly && !all) {
    return {
      matched: true,
      wantsDeletion,
      permission: buildPermission('optout_email_only', { call: true, sms: true, email: false }),
      responseEn: RESPONSE_EMAIL_ONLY.en + (wantsDeletion ? RESPONSE_DELETION_SUFFIX.en : ''),
      responseEs: RESPONSE_EMAIL_ONLY.es + (wantsDeletion ? RESPONSE_DELETION_SUFFIX.es : ''),
    };
  }

  // Everything else is treated as a full stop (conservative: a call-only or
  // sms-only request still blocks automated follow-up on all channels; a
  // human can refine the preference later).
  const evidence: ContactPermission['evidence'] = wantsDeletion && !all && !callOnly && !smsOnly
    ? 'optout_deletion'
    : all ? 'optout_all' : callOnly ? 'optout_call' : 'optout_sms';
  return {
    matched: true,
    wantsDeletion,
    permission: buildPermission(evidence, { call: true, sms: true, email: true }),
    responseEn: RESPONSE_ALL.en + (wantsDeletion ? RESPONSE_DELETION_SUFFIX.en : ''),
    responseEs: RESPONSE_ALL.es + (wantsDeletion ? RESPONSE_DELETION_SUFFIX.es : ''),
  };
}

/** sessionStorage key for the recorded permission (PII-free by construction). */
export const CONTACT_PERMISSION_KEY = 'cp_contact_permission_v1';

/**
 * In-memory backstop. INDEPENDENT REVIEW 2026-08-13 (F-05, P2): the previous
 * comment promised "the in-memory session flag still governs" on storage
 * failure, but no such flag existed — in a storage-blocked browser the DNC
 * guard failed OPEN. This is that flag, and it is set BEFORE the storage write
 * so it holds even when sessionStorage throws.
 */
let sessionOptOut = false;

/** Persist the permission record; never throws (private mode etc.). */
export function persistContactPermission(p: ContactPermission): void {
  if (p.automatedFollowup === 'BLOCKED') sessionOptOut = true;
  try {
    sessionStorage.setItem(CONTACT_PERMISSION_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — the in-memory flag above still governs */
  }
}

/** TRUE when this session has an active opt-out on record. */
export function hasSessionOptOut(): boolean {
  if (sessionOptOut) return true;
  try {
    const raw = sessionStorage.getItem(CONTACT_PERMISSION_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as ContactPermission | null;
    // F-13: `p &&` could return null from a `: boolean` signature.
    return !!p && p.automatedFollowup === 'BLOCKED';
  } catch {
    return false;
  }
}

/** Test-only reset of the in-memory backstop. */
export function __resetSessionOptOutForTests(): void {
  sessionOptOut = false;
}

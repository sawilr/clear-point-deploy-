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

// Full opt-out (all channels). EN + ES, accent-tolerant via normalization.
const OPTOUT_ALL_RES: RegExp[] = [
  /\b(don'?t|do\s+not|never)\s+contact\s+me\b/i,
  /\b(remove|take)\s+me\s+(from|off)\b/i,
  /\bunsubscribe\b/i,
  /\bno\s+more\s+(messages|calls|texts|contact)\b/i,
  /\bleave\s+me\s+alone\b/i,
  /\bstop\s+(contacting|calling|texting|messaging)\s+me\b/i,
  /\bno\s+(quiero|deseo)\s+que\s+me\s+(llamen|llames|contacten|escriban|manden|env[ií]en)\b/i,
  /\bno\s+me\s+(contacten|contacte|molesten)\s*(m[aá]s)?\b/i,
  /\bs[aá]quen?me\s+de\s+(la|su)\s+lista\b/i,
  /\bcancelar?\s+todo\s+contacto\b/i,
  /\bno\s+quiero\s+m[aá]s\s+(mensajes|llamadas|contacto)\b/i,
];

// Channel-specific.
const OPTOUT_CALL_RES: RegExp[] = [
  /\b(stop|quit)\s+calling\b/i,
  /\bdo\s+not\s+call\b/i,
  /\bno\s+me\s+llamen?\b/i,
];
const OPTOUT_SMS_RES: RegExp[] = [
  /\b(stop|quit)\s+texting\b/i,
  /\bno\s+more\s+texts\b/i,
  /\bno\s+me\s+(manden|env[ií]en)\s+(m[aá]s\s+)?(mensajes|textos|correos)\b/i,
  /\bno\s+me\s+escriban\s*(m[aá]s)?\b/i,
];
const EMAIL_ONLY_RES: RegExp[] = [
  /\bemail\s+only\b/i,
  /\bonly\s+(by\s+)?email\b/i,
  /\bsolo\s+(por\s+)?correo(\s+electr[oó]nico)?\b/i,
];

// Data-deletion request.
const DELETION_RES: RegExp[] = [
  /\b(delete|erase|remove)\s+(my|all\s+my)\s+(info(rmation)?|data|records?)\b/i,
  /\bborr[ae]n?\s+(mi|toda\s+mi|mis)\s+(informaci[oó]n|datos?)\b/i,
  /\belimin[ae]n?\s+(mi|toda\s+mi|mis)\s+(informaci[oó]n|datos?)\b/i,
];

// A bare "STOP" message is the SMS-style universal keyword.
const BARE_STOP_RE = /^\s*(stop|alto|basta)\s*[.!]*\s*$/i;

// Rescheduling talk ("call me tomorrow instead", "no me llamen mañana, mejor
// el lunes") is a preference, not a revocation — exempt to avoid false DNC.
const RESCHEDULE_RE = /\b(ma[ñn]ana|m[aá]s\s+tarde|luego|otro\s+d[ií]a|otra\s+hora|el\s+(lunes|martes|mi[eé]rcoles|jueves|viernes)|tomorrow|later|another\s+(day|time)|instead|mejor\s+(a|en)\b)/i;

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

  const wantsDeletion = anyMatch(DELETION_RES, t);
  const bareStop = BARE_STOP_RE.test(t);
  const all = bareStop || anyMatch(OPTOUT_ALL_RES, t);
  const callOnly = anyMatch(OPTOUT_CALL_RES, t);
  const smsOnly = anyMatch(OPTOUT_SMS_RES, t);
  const emailOnly = anyMatch(EMAIL_ONLY_RES, t);

  if (!all && !callOnly && !smsOnly && !emailOnly && !wantsDeletion) return none;

  // Rescheduling exemption applies only to channel-specific phrasing —
  // a full "don't contact me" or deletion request is never a reschedule.
  if (!all && !wantsDeletion && RESCHEDULE_RE.test(t)) return none;

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

/** Persist the permission record; never throws (private mode etc.). */
export function persistContactPermission(p: ContactPermission): void {
  try {
    sessionStorage.setItem(CONTACT_PERMISSION_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — the in-memory session flag still governs */
  }
}

/** TRUE when this session has an active opt-out on record. */
export function hasSessionOptOut(): boolean {
  try {
    const raw = sessionStorage.getItem(CONTACT_PERMISSION_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as ContactPermission;
    return p && p.automatedFollowup === 'BLOCKED';
  } catch {
    return false;
  }
}

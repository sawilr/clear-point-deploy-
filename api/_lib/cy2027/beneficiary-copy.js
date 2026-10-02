// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — BENEFICIARY CONFIRMATION COPY (spec §9, §19 / audit EV-07, WVG-08).
// SERVER ONLY.
//
// "On submit, generate an immutable human-readable PDF evidence copy … and send
//  beneficiary confirmation/copy through the chosen secure channel."
// "SMS/email sends a secure one-time link. The message itself contains no
//  sensitive beneficiary data and is not used as a hidden marketing vehicle."
// "Re-sending a copy does not create a new SOA."
//
// ─── WHY THIS SHIPS DISABLED ─────────────────────────────────────────────────
// Sending a copy is an OUTBOUND MESSAGE to a real person. Three things have to
// be true before one goes out, and none of them is this module's to decide:
//   1. a channel is configured (provider + credentials);
//   2. the beneficiary consented to be contacted ON THAT CHANNEL — and §6 is
//      explicit that this may not be inferred from the SOA signature;
//   3. the owner has authorized outbound messaging at all.
// So `CY2027_SEND_BENEFICIARY_COPY` is unset and sendCopy() returns a reason
// instead of sending. The message body, the consent check and the refusal
// reasons are all built and tested; only the send is withheld.
//
// The message deliberately carries NO beneficiary data — no name, no ZIP, no
// categories, no appointment details. It says a document was signed, gives the
// reference and a one-time link, and nothing else. A copy that leaked the
// selections would itself be the disclosure the SOA is supposed to control.
// ─────────────────────────────────────────────────────────────────────────────

import { isAffirmative } from './consent.js';

export const COPY_CHANNELS = Object.freeze(['EMAIL', 'SMS']);

/** True only when the owner has switched outbound copies on. */
export function sendingEnabled(env = process.env) {
  const v = String(env.CY2027_SEND_BENEFICIARY_COPY || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Provider configuration for a channel, or null. */
function channelConfig(channel, env = process.env) {
  if (channel === 'EMAIL') {
    const url = (env.CY2027_COPY_EMAIL_URL || '').trim();
    const token = (env.CY2027_COPY_EMAIL_TOKEN || '').trim();
    return url && token && /^https:\/\//i.test(url) ? { url, token } : null;
  }
  if (channel === 'SMS') {
    const url = (env.CY2027_COPY_SMS_URL || '').trim();
    const token = (env.CY2027_COPY_SMS_TOKEN || '').trim();
    return url && token && /^https:\/\//i.test(url) ? { url, token } : null;
  }
  return null;
}

/**
 * The confirmation copy, both languages.
 *
 * No name, no ZIP, no categories, no appointment date — see the header. The
 * SOA id and the evidence reference are the only identifiers, and both are
 * opaque. No marketing, no call to action beyond retrieving the document.
 */
export function buildCopyMessage({ soaId, evidenceLinkUrl, language }) {
  const lang = language === 'es' ? 'es' : 'en';
  if (lang === 'es') {
    return {
      subject: 'Su Scope of Appointment firmado — Clear Point Senior Advisors',
      body:
        'Recibimos su Scope of Appointment firmado.\n\n' +
        'Referencia: ' + soaId + '\n' +
        (evidenceLinkUrl ? 'Copia del documento: ' + evidenceLinkUrl + '\n' : '') +
        '\nEste documento solo registra los temas que usted autorizó para una cita específica. ' +
        'No es una inscripción y no cambia su cobertura actual.\n\n' +
        'Si no reconoce esta firma, llámenos al 1-855-720-8555.\n',
    };
  }
  return {
    subject: 'Your signed Scope of Appointment — Clear Point Senior Advisors',
    body:
      'We received your signed Scope of Appointment.\n\n' +
      'Reference: ' + soaId + '\n' +
      (evidenceLinkUrl ? 'Copy of the document: ' + evidenceLinkUrl + '\n' : '') +
      '\nThis document only records the topics you authorized for one specific appointment. ' +
      'It is not an enrollment and does not change your current coverage.\n\n' +
      "If you don't recognize this signature, please call us at 1-855-720-8555.\n",
  };
}

/** Terms that must never appear in a confirmation copy (§9: not a marketing vehicle). */
const MARKETING_RE = /\b(?:save|savings|free\s+gift|best\s+plan|limited\s+time|act\s+now|don'?t\s+miss|enroll\s+now|special\s+offer|ahorr\w+|oferta|no\s+pierda|inscr[ií]base\s+ya|mejor\s+plan)\b/i;

/** Guard: refuses to send anything that reads like marketing. */
export function assertNotMarketing(text) {
  if (MARKETING_RE.test(String(text || ''))) {
    throw new Error('beneficiary-copy: refusing to send — the confirmation copy may not carry marketing content (spec §9).');
  }
  return true;
}

/**
 * Decide whether a copy may be sent.
 *
 * Returns `{ allowed:false, reason }` for every blocker so the caller can log
 * exactly why nothing went out, rather than failing silently.
 */
export function maySendCopy({ channel, consent, env = process.env } = {}) {
  if (!COPY_CHANNELS.includes(channel)) return { allowed: false, reason: 'UNKNOWN_CHANNEL' };
  if (!sendingEnabled(env)) return { allowed: false, reason: 'SENDING_DISABLED' };
  if (!channelConfig(channel, env)) return { allowed: false, reason: 'CHANNEL_NOT_CONFIGURED' };
  // §6: contact permission is its own object and may NOT be inferred from the
  // SOA signature. A signed SOA is not permission to message someone.
  if (!isAffirmative(consent, 'CALLBACK_CONTACT_PERMISSION')) {
    return { allowed: false, reason: 'NO_CONTACT_PERMISSION' };
  }
  return { allowed: true, reason: 'OK' };
}

/**
 * Send the copy, if everything above permits it.
 *
 * Never throws for a transport problem: the SOA is already signed and filed, and
 * a failed copy must be reported, not allowed to look like a failed signature.
 * Re-sending is the caller's decision; this function does not create or alter
 * any SOA, which is what keeps "re-sending a copy does not create a new SOA"
 * true by construction.
 */
export async function sendCopy({ channel, to, consent, soaId, evidenceLinkUrl, language, env = process.env, fetchImpl = fetch }) {
  const gate = maySendCopy({ channel, consent, env });
  if (!gate.allowed) return { sent: false, reason: gate.reason };
  if (!to) return { sent: false, reason: 'NO_DESTINATION' };
  if (!soaId) return { sent: false, reason: 'NO_SOA_ID' };

  const msg = buildCopyMessage({ soaId, evidenceLinkUrl, language });
  try { assertNotMarketing(msg.subject + ' ' + msg.body); }
  catch (e) { return { sent: false, reason: 'MARKETING_CONTENT_BLOCKED', detail: e.message }; }

  const cfg = channelConfig(channel, env);
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, to, subject: msg.subject, body: msg.body }),
    });
    if (!res || !res.ok) return { sent: false, reason: 'PROVIDER_REJECTED', status: res ? res.status : null };
    return { sent: true, reason: 'OK', channel };
  } catch (e) {
    return { sent: false, reason: 'PROVIDER_UNREACHABLE', detail: e && e.message ? String(e.message).slice(0, 120) : null };
  }
}

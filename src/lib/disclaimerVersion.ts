// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9A — Disclaimer version registry + TCPA consent receipt builder.
//
// CMS auditors will demand "what did the bot say to this beneficiary on
// date X?". By stamping every consent capture with the disclaimer version
// + SHA-256 of the actual text + IP + timestamp + user agent, we have
// defensible audit trail.
// ─────────────────────────────────────────────────────────────────────────────

/** Version pin for the consent + privacy text shown in chat surfaces. */
export const DISCLAIMER_VERSION = '2026-06-01';

/** Canonical TCPA consent text (EN). Hash this for audit. */
export const TCPA_CONSENT_TEXT_EN =
  'By agreeing, you authorize ClearPoint Senior Advisors (a licensed independent ' +
  'Medicare broker) to contact you by phone, text message, or email at the number ' +
  'you provided to discuss Medicare plan options. You understand calls/texts may ' +
  'be made using an automatic telephone dialing system, that consent is not ' +
  'required to purchase, and that you can revoke consent at any time by replying ' +
  'STOP or calling 1-855-720-8555. Standard message and data rates may apply.';

/** Canonical TCPA consent text (ES). Hash this for audit. */
export const TCPA_CONSENT_TEXT_ES =
  'Al aceptar, usted autoriza a ClearPoint Senior Advisors (un broker independiente ' +
  'licenciado de Medicare) a contactarle por teléfono, mensaje de texto o correo ' +
  'electrónico al número que proporcionó para discutir opciones de planes de ' +
  'Medicare. Usted entiende que las llamadas/textos pueden hacerse usando un ' +
  'sistema telefónico automático de marcado, que el consentimiento no es requerido ' +
  'para comprar, y que puede revocar el consentimiento en cualquier momento ' +
  'respondiendo STOP o llamando al 1-855-720-8555. Pueden aplicar tarifas estándar ' +
  'de mensajes y datos.';

export interface ConsentReceipt {
  consentText: string;
  consentTextHash: string;
  disclaimerVersion: string;
  language: 'en' | 'es';
  timestamp: string;
  userAgent?: string;
}

/** SHA-256 (browser SubtleCrypto, async). Returns hex. */
export async function sha256Hex(text: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

/** Build a consent receipt at the moment the user clicks Agree. */
export async function buildConsentReceipt(language: 'en' | 'es'): Promise<ConsentReceipt> {
  const consentText = language === 'es' ? TCPA_CONSENT_TEXT_ES : TCPA_CONSENT_TEXT_EN;
  const consentTextHash = await sha256Hex(consentText);
  return {
    consentText,
    consentTextHash,
    disclaimerVersion: DISCLAIMER_VERSION,
    language,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined,
  };
}

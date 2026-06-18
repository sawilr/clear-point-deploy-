// Client-side PHI / sensitive-data firewall (Sawil 2026-06-18).
//
// Runs in the BROWSER, before any chat message is sent to /api/chat, so raw
// sensitive data never leaves the user's device — not to the AI, not to the
// CRM, not to logs or analytics. The server-side `scrubPHI` (api/_lib/phi-scrub)
// remains in place as defense-in-depth.
//
// Detection reuses the engine's `detectPHILeak` (SSN, MBI, bank/card, and the
// "my SSN is…" / "mi número de Medicare es…" phrasings — already tuned NOT to
// flag a 10-digit phone number, which Clara legitimately collects), and adds
// the intent-to-send-a-card phrases that carry no digits yet.
import { detectPHILeak } from './customerServiceEngine';

/** True when a message likely contains, or is about to send, sensitive data. */
export function containsSensitiveData(text: string): boolean {
  if (!text || !text.trim()) return false;
  if (detectPHILeak(text)) return true;
  // Intent to send / upload / mail / fax a Medicare or insurance card or an
  // SSN/Social Security card — EN + ES — even with no number in the message.
  if (/\b(send|sending|upload|uploading|mail|fax|share|attach|text you|enviar|mandar|mando|te mando|le mando|env[ií]o|subir|adjuntar|compartir)\b[^.?!]{0,40}\b(medicare card|tarjeta (de|del) medicare|insurance card|tarjeta del seguro|tarjeta de seguro|ssn card|social security card|tarjeta del seguro social|my card|mi tarjeta)\b/i.test(text)) {
    return true;
  }
  return false;
}

/** Deterministic, bilingual warning shown when sensitive data is blocked. */
export function sensitiveWarning(isSpanish: boolean): string {
  return isSpanish
    ? 'Por su seguridad, no envíe su Seguro Social, número de Medicare, información bancaria ni documentos médicos por este chat. Un asesor licenciado puede revisar su caso de forma segura por teléfono.'
    : 'For your protection, please do not share your Social Security number, Medicare number, bank information, or medical records in this chat. A licensed advisor can review your case safely by phone.';
}

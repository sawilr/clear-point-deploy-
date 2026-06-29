// Sawil 2026-06-29 SECURITY HOTFIX (audit findings 06/07) — pure, testable Zara
// advisor-intake review logic. Extracted from ChatBot.tsx so the deterministic
// flow (final review BEFORE consent + submit) and the masked summary can be unit
// tested. ChatBot.tsx imports these; ChatMemory is structurally compatible.

export interface ZaraLeadFields {
  firstName: string;
  lastName: string;
  phone: string;
  state: string;
  zip: string;
  dob: string;
  currentCoverage: string;
  preferredLanguage: string;
  preferredContactTime: string;
  email: string;
  skippedEmail: boolean;
  reviewConfirmed: boolean;
  consentGiven: boolean;
  language?: string;
}

/** Next field to collect, in order. The final REVIEW step is required before
 *  the TCPA consent step, and consent before submit — so a lead can never reach
 *  'readyToSubmit' without both reviewConfirmed AND consentGiven. */
export function getNextMissingStep(mem: ZaraLeadFields): string {
  if (!mem.firstName) return 'firstName';
  if (!mem.lastName) return 'lastName';
  if (!mem.phone) return 'phone';
  if (!mem.state || mem.state === 'other') return 'leadState';
  if (!mem.zip) return 'zipCode';
  // Sawil 2026-06-29 SECURITY HOTFIX (finding 08, PHASE 3) — full DOB is NO LONGER
  // collected in public chat during beta (privacy-policy mismatch + sensitive
  // identity data). Identity/eligibility is verified securely by the advisor.
  // Medicare status (currentCoverage) + ZIP/state already cover routing needs.
  if (!mem.currentCoverage) return 'currentCoverage';
  if (!mem.preferredLanguage) return 'preferredLanguage';
  if (!mem.preferredContactTime) return 'bestTime';
  if (!mem.email && !mem.skippedEmail) return 'emailOptional';
  // Sawil 2026-06-29 (findings 06/07) — final review BEFORE consent + submit.
  if (!mem.reviewConfirmed) return 'review';
  if (!mem.consentGiven) return 'consent';
  return 'readyToSubmit';
}

export function formatZaraPhone(phone: string): string {
  const d = (phone || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (phone || '');
}

// Masked final-review summary. DOB is intentionally EXCLUDED (PHASE 3 removes
// DOB collection; a full DOB is never echoed back).
export function buildZaraSummary(mem: ZaraLeadFields): string {
  const es = mem.language === 'es';
  const lines = [
    `• ${es ? 'Nombre' : 'Name'}: ${`${mem.firstName} ${mem.lastName}`.trim()}`,
    `• ${es ? 'Teléfono' : 'Phone'}: ${formatZaraPhone(mem.phone)}`,
    mem.email ? `• ${es ? 'Correo' : 'Email'}: ${mem.email}` : `• ${es ? 'Correo' : 'Email'}: ${es ? '(no proporcionado)' : '(not provided)'}`,
    `• ${es ? 'Ubicación' : 'Location'}: ${[mem.state, mem.zip].filter(Boolean).join(' ')}`,
    mem.currentCoverage ? `• ${es ? 'Cobertura' : 'Coverage'}: ${mem.currentCoverage}` : null,
    mem.preferredContactTime ? `• ${es ? 'Mejor horario' : 'Best time'}: ${mem.preferredContactTime}` : null,
  ].filter(Boolean).join('\n');
  const head = es ? 'Antes de enviar su solicitud, confirmemos sus datos:' : "Before I send your request, let's confirm your details:";
  const tail = es ? '¿Está todo correcto?' : 'Is everything correct?';
  return `${head}\n${lines}\n\n${tail}`;
}

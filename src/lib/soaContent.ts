// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — SOA (Scope of Sales Appointment) verbatim CMS content.
//
// Source: CMS Form 10566 / OMB 0938-1373 (current TPMO disclaimer as of
// October 2024 — updated by CMS in the 2024 Marketing Final Rule).
//
// This file is the SINGLE SOURCE OF TRUTH for the CMS-mandated language.
// Changes here flow into:
//   - src/components/SOAForm.tsx (the React form)
//   - api/sign-soa.js (the PDF generator)
//   - The server-side audit trail (so we can prove which disclaimer
//     version a beneficiary signed if CMS audits us later).
//
// Compliance constraint: DO NOT modify TPMO_DISCLAIMER_* strings without
// re-running them past the CMS October 2024 verbatim text. Only edit the
// [X] and [Y] placeholders by changing the carrier/product COUNTS below.
// ─────────────────────────────────────────────────────────────────────────────

/** Agent identity — Sawil Reyes, ClearPoint Senior Advisors. */
export const AGENT = {
  name: 'Sawil Reyes',
  npn: '17261494',
  agency: 'ClearPoint Senior Advisors',
  agencyPhone: '1-855-720-8555',
  agencyEmail: 'info@clearpointsenioradvisors.com',
} as const;

/** Tracks WHICH version of the TPMO disclaimer the user signed (audit). */
export const TPMO_DISCLAIMER_VERSION = '2024-10';

/** Owner-confirmed counts. Until these are set to real integers, SOA is gated
 *  off below (SOA_ENABLED). A signed CMS disclaimer with [X]/[Y] in it is an
 *  audit failure — see SOA_ENABLED. */
export const TPMO_CARRIER_COUNT_PLACEHOLDER = '[X]';
export const TPMO_PRODUCT_COUNT_PLACEHOLDER = '[Y]';

/** PHASE 7 — SOA workflow gate. Mirrored by api/soa-token.js, api/soa-status.js and
 *  api/sign-soa.js, and — since CP-01 — consulted by the CLIENT too, so the UI can
 *  never solicit, promise, or report an SOA the backend will refuse.
 *
 *  TRUE  → SOA token issuance + signing routes work normally.
 *  FALSE → /api/soa-token, /api/soa-status and /api/sign-soa all return 503; the
 *          /soa/:token page renders the 'unavailable' state (a plain explanation plus
 *          the phone number, and deliberately NO retry button); SmartMedicareReview
 *          does not request a token at all, so no PII is sent to a refusing endpoint;
 *          it reports soa_pending:false to the CRM rather than claiming a pending
 *          document that cannot arrive; and both bots skip the hand-off link.
 *
 *  CP-01 (2026-08-13) — the previous version of this comment claimed the /soa/:token
 *  page "shows a temporarily unavailable notice". It did not. A 503 fell into the
 *  generic error phase whose retry button could never succeed and, worse, rendered a
 *  blank card. The behavior now matches the description; the description was fiction
 *  until the code caught up with it, which is a reminder that a comment asserting a
 *  behavior is not evidence the behavior exists.
 *
 *  Flip this to TRUE in the same commit that replaces the [X] / [Y] placeholders above
 *  with real, FMO-confirmed integer counts — and see SOA_PRECONDITIONS below, which
 *  enforces that mechanically rather than trusting this sentence. */
export const SOA_ENABLED = false;

// ── AUDIT 2026-08-13 (O-10, P1 latent) — ENABLEMENT PRECONDITIONS ───────────
// The comment above ("flip this in the same commit that replaces [X]/[Y]") was
// the only thing standing between a future edit and a non-compliant signed SOA.
// A comment is not a control. Discovery found FOUR independent blockers, any one
// of which makes enabling unsafe:
//
//   1. TPMO COUNTS — the placeholders here AND a second, independent copy in
//      api/sign-soa.js. Filling src/lib/tpmoConfig.ts alone does NOT fix the
//      PDF: a signed CMS disclaimer containing "[X] organizations" is an audit
//      failure. The three sources must be unified first.
//   2. PDF NOT PERSISTED — sign-soa generates the PDF, hashes it, and discards
//      it; the "attach" step posts a placeholder NOTE, not the file. Clear Point
//      could not produce the signed document on request.
//   3. SIGNED RECORD SELF-DESTRUCTS — after signing, the record is written back
//      through the same 24-hour-TTL store, so the SOA evidence disappears a day
//      later. It needs its own retention aligned to the confirmed requirement.
//   4. NO APPOINTMENT LINKAGE — there is no appointment date/time FIELD in the
//      SOA data model at all, so "was scope documented before the appointment?"
//      is unanswerable. (Note: the CY2027 rule REMOVES the 48-hour advance
//      requirement effective for CY2027 marketing from 2026-10-01, so do NOT
//      implement a 48-hour gate — implement the linkage and ordering.)
//
// These flags make each precondition explicit and machine-checkable.
// assertSoaEnablementSafe() below refuses to let SOA_ENABLED=true ship while any
// remain false — it throws at module load, so the build/tests fail loudly rather
// than a beneficiary signing an invalid document.
export const SOA_PRECONDITIONS = {
  /** Real FMO-confirmed integers in ALL THREE sources (here, tpmoConfig, sign-soa). */
  tpmoCountsVerifiedEverywhere: false,
  /** Signed PDF bytes persisted to durable storage with a retrievable URI. */
  signedPdfPersisted: false,
  /** Signed SOA record has its own retention, NOT the 24h signing-token TTL. */
  signedRecordDurableRetention: false,
  /** appointmentAt + appointmentChannel captured and linked to the booking. */
  appointmentLinkageCaptured: false,
  /** soa-status requires a second factor (not a bare UUID returning PII). */
  statusEndpointSecondFactor: false,
} as const;

/** Names of every precondition still unmet. Empty array = safe to enable. */
export function soaBlockers(): string[] {
  return Object.entries(SOA_PRECONDITIONS)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
}

/**
 * Change-control guard. Throws if someone flips SOA_ENABLED to true while any
 * precondition is unmet. Intentionally evaluated at module load: an unsafe
 * enablement must fail the build, not reach production.
 */
export function assertSoaEnablementSafe(): void {
  if (!SOA_ENABLED) return;
  const blockers = soaBlockers();
  if (blockers.length) {
    throw new Error(
      'SOA_ENABLED is true but these preconditions are still unmet: '
      + blockers.join(', ')
      + '. Enabling SOA now would produce a signed CMS disclaimer that is an audit '
      + 'failure and/or an SOA record that cannot be retrieved. See the block above '
      + 'in src/lib/soaContent.ts.',
    );
  }
}
assertSoaEnablementSafe();

/** CMS October 2024 TPMO disclaimer — verbatim, EN. DO NOT EDIT WORDING. */
export const TPMO_DISCLAIMER_EN = (
  `We do not offer every plan available in your area. Currently we represent ${TPMO_CARRIER_COUNT_PLACEHOLDER} organizations which offer ${TPMO_PRODUCT_COUNT_PLACEHOLDER} products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of your options.`
);

/** CMS October 2024 TPMO disclaimer — verbatim, ES. Official CMS translation. */
export const TPMO_DISCLAIMER_ES = (
  `No ofrecemos todos los planes disponibles en su área. Actualmente representamos ${TPMO_CARRIER_COUNT_PLACEHOLDER} organizaciones que ofrecen ${TPMO_PRODUCT_COUNT_PLACEHOLDER} productos en su área. Para obtener información sobre todas sus opciones, comuníquese con Medicare.gov, 1-800-MEDICARE o su Programa Estatal de Asesoramiento sobre Seguros de Salud (SHIP) local.`
);

/** Product scope checkbox options — CMS-required taxonomy. */
export type SOAProduct = 'MA_only' | 'MAPD' | 'PDP' | 'DVH_HI';

export const PRODUCT_OPTIONS: Array<{ code: SOAProduct; en: string; es: string }> = [
  { code: 'MA_only', en: 'Medicare Advantage (Part C) — without prescription drug coverage', es: 'Medicare Advantage (Parte C) — sin cobertura de medicamentos recetados' },
  { code: 'MAPD',    en: 'Medicare Advantage with Prescription Drug coverage (MAPD)',         es: 'Medicare Advantage con cobertura de medicamentos recetados (MAPD)' },
  { code: 'PDP',     en: 'Standalone Part D Prescription Drug Plan',                          es: 'Plan independiente de medicamentos recetados de Parte D' },
  { code: 'DVH_HI',  en: 'Other (Dental, Vision, Hearing, Hospital Indemnity, etc.)',         es: 'Otros (Dental, Visión, Audición, Hospital Indemnity, etc.)' },
];

/** Required-acknowledgement checkboxes — both must be true to submit. */
export const ACKNOWLEDGEMENTS = {
  no_obligation: {
    en: 'I understand this is not an enrollment, and there is no obligation.',
    es: 'Entiendo que esto NO es una inscripción y NO hay obligación.',
  },
  e_signature: {
    en: 'I agree to sign this document electronically. I understand that my typed name is a valid electronic signature under the ESIGN Act (15 U.S.C. §7001).',
    es: 'Acepto firmar este documento electrónicamente. Entiendo que mi nombre escrito es una firma electrónica válida según la Ley ESIGN (15 U.S.C. §7001).',
  },
} as const;

/** Section titles, EN/ES — used by the form and PDF. */
export const LABELS = {
  title:                { en: 'Scope of Sales Appointment Confirmation',                          es: 'Confirmación del Alcance de la Cita de Ventas' },
  tpmo_heading:         { en: 'TPMO Disclaimer (CMS-required)',                                   es: 'Aviso TPMO (Requerido por CMS)' },
  beneficiary_heading:  { en: 'Beneficiary Information',                                          es: 'Información del Beneficiario' },
  product_heading:      { en: 'Products to be discussed at appointment',                          es: 'Productos a discutir en la cita' },
  product_help:         { en: 'Select ALL products you would like the licensed advisor to review with you.', es: 'Seleccione TODOS los productos que desea que el asesor revise con usted.' },
  acknowledgement_heading: { en: 'Acknowledgement',                                               es: 'Reconocimiento' },
  signature_heading:    { en: 'Beneficiary Electronic Signature',                                 es: 'Firma Electrónica del Beneficiario' },
  signature_help:       { en: 'Type your full name exactly as it appears on your Medicare card. This serves as your electronic signature.', es: 'Escriba su nombre completo exactamente como aparece en su tarjeta de Medicare. Esto sirve como su firma electrónica.' },
  agent_heading:        { en: 'Agent / Agency',                                                   es: 'Agente / Agencia' },
  field_full_name:      { en: 'Full Legal Name',                                                  es: 'Nombre Legal Completo' },
  field_dob:            { en: 'Date of Birth',                                                    es: 'Fecha de Nacimiento' },
  field_phone:          { en: 'Phone',                                                            es: 'Teléfono' },
  field_email:          { en: 'Email (optional)',                                                 es: 'Correo electrónico (opcional)' },
  field_zip:            { en: 'ZIP Code',                                                         es: 'Código Postal' },
  field_address:        { en: 'Street Address (optional)',                                        es: 'Dirección (opcional)' },
  field_signature:      { en: 'Typed Signature',                                                  es: 'Firma Escrita' },
  field_signed_date:    { en: 'Date Signed',                                                      es: 'Fecha de Firma' },
  submit:               { en: 'Sign and Submit',                                                  es: 'Firmar y Enviar' },
  signing:              { en: 'Signing…',                                                         es: 'Firmando…' },
  success_title:        { en: 'Thank you — your SOA has been signed.',                            es: 'Gracias — su SOA ha sido firmado.' },
  success_body:         { en: 'A licensed ClearPoint advisor will contact you within 24–48 hours at the phone number on file. You will also receive a copy of this signed document for your records.', es: 'Un asesor licenciado de ClearPoint le contactará dentro de 24 a 48 horas al teléfono registrado. También recibirá una copia de este documento firmado para sus registros.' },
  error_title:          { en: 'We could not save your signature',                                 es: 'No pudimos guardar su firma' },
  error_retry:          { en: 'Please try again or call us directly at 1-855-720-8555.',          es: 'Por favor inténtelo de nuevo o llámenos directamente al 1-855-720-8555.' },
  required:             { en: 'Required',                                                         es: 'Requerido' },
  validation_required:  { en: 'This field is required.',                                          es: 'Este campo es obligatorio.' },
  validation_signature_mismatch: { en: 'The typed signature does not match your full name. Please check your name and try again.', es: 'La firma escrita no coincide con su nombre completo. Por favor verifique su nombre.' },
  validation_product:   { en: 'Please select at least one product type.',                         es: 'Por favor seleccione al menos un tipo de producto.' },
  validation_dob:       { en: 'Please enter a valid date of birth (MM/DD/YYYY).',                 es: 'Por favor ingrese una fecha de nacimiento válida (MM/DD/AAAA).' },
  validation_acknowledgement: { en: 'You must agree to both acknowledgements to sign.',           es: 'Debe aceptar ambos reconocimientos para firmar.' },
} as const;

/** Returns the TPMO disclaimer (EN/ES) with placeholders intact. */
export function tpmoDisclaimer(lang: 'en' | 'es'): string {
  return lang === 'es' ? TPMO_DISCLAIMER_ES : TPMO_DISCLAIMER_EN;
}

/** Returns a localized label. */
export function tLabel(key: keyof typeof LABELS, lang: 'en' | 'es'): string {
  const entry = LABELS[key];
  return lang === 'es' ? entry.es : entry.en;
}

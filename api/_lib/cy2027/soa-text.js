// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — APPROVED CUSTOMER-FACING SOA TEXT (VERBATIM).
//
// Source of truth: the owner-approved Clear Point Master SOA templates
//   ClearPoint_CY2027_Master_SOA_NY.docx / _NJ.docx / _CT.docx
// The three state documents are byte-identical except for: the state name in
// the title, the state label, SOA_FORM_VERSION and STATE_RULESET_VERSION.
// Everything that differs by state therefore lives in ./state-rules.js, and
// everything that does not lives here, once.
//
// WHY THIS FILE IS PLAIN ESM JS AND NOT TS:
//   api/*.js never imports from src/ (verified 2026-10-01: zero occurrences).
//   The pre-existing consequence was three divergent copies of the TPMO text
//   and four copies of SOA_ENABLED. This directory is the single canonical
//   source that BOTH worlds import: the server directly, the client through
//   src/lib/cy2027.ts. scripts/check-cy2027-parity.mjs fails the build if a
//   copy ever reappears.
//
// CHANGE CONTROL:
//   This is approved compliance wording. It is not editorial text and must not
//   be "improved", shortened, re-translated or reflowed. APPROVED_TEXT_DIGEST
//   below pins a hash of every customer-facing string; scripts/check-cy2027-
//   parity.mjs recomputes it at build time and fails if it moved. Changing the
//   wording therefore requires deliberately re-pinning the digest in the same
//   commit, which is the audit trail CMS would ask for.
// ─────────────────────────────────────────────────────────────────────────────

/** Plan/contract year this approved text was issued for. */
export const SOA_PLAN_YEAR = 2027;

/** Version of the customer-facing script, stored on every SOA instance. */
export const SOA_SCRIPT_VERSION = 'CP-SOA-SCRIPT-CY2027-v1.0';

/**
 * Product categories, verbatim.
 *
 * Exactly three authorizing categories plus one explicitly NON-authorizing
 * option. Spec §8: "Do not use 'Select All' as a one-click authorization" and
 * "Always offer 'I am not sure / I prefer to discuss the process with a
 * licensed agent first.' This must not be converted to authorization."
 *
 * `authorizes: false` is load-bearing, not documentation — soa-instance.js
 * refuses to count such a code as authorized scope.
 */
export const SOA_CATEGORIES = Object.freeze([
  Object.freeze({
    code: 'MA_NO_RX',
    authorizes: true,
    en: Object.freeze({
      label: 'Medicare Advantage plan without integrated prescription drug coverage',
      description:
        'A private Medicare health plan that provides Medicare-covered medical and hospital services but does not include integrated Medicare prescription drug coverage.',
    }),
    es: Object.freeze({
      label: 'Plan Medicare Advantage sin cobertura integrada de medicamentos recetados',
      description:
        'Un plan privado de salud de Medicare que ofrece servicios médicos y hospitalarios cubiertos por Medicare, pero no incluye cobertura integrada de medicamentos recetados de Medicare.',
    }),
  }),
  Object.freeze({
    code: 'MA_WITH_RX',
    authorizes: true,
    en: Object.freeze({
      label: 'Medicare Advantage plan with prescription drug coverage',
      description:
        'A private Medicare health plan that provides Medicare-covered medical and hospital services and includes Medicare prescription drug coverage.',
    }),
    es: Object.freeze({
      label: 'Plan Medicare Advantage con cobertura de medicamentos recetados',
      description:
        'Un plan privado de salud de Medicare que ofrece servicios médicos y hospitalarios cubiertos por Medicare e incluye cobertura de medicamentos recetados de Medicare.',
    }),
  }),
  Object.freeze({
    code: 'STANDALONE_RX',
    authorizes: true,
    en: Object.freeze({
      label: 'Standalone Medicare prescription drug plan',
      description:
        'A separate Medicare prescription drug plan for people who need Part D drug coverage apart from a Medicare Advantage plan.',
    }),
    es: Object.freeze({
      label: 'Plan independiente de Medicare para medicamentos recetados',
      description:
        'Un plan separado de Medicare para medicamentos recetados para personas que necesitan cobertura de medicamentos de la Parte D aparte de un plan Medicare Advantage.',
    }),
  }),
  Object.freeze({
    code: 'UNSURE_DISCUSS_PROCESS',
    authorizes: false,
    en: Object.freeze({
      label: 'I am not sure / I prefer to discuss the process first',
      description:
        'This does not authorize an additional product category. A licensed agent can explain the process before any plan-specific discussion begins.',
    }),
    es: Object.freeze({
      label: 'No estoy seguro / prefiero hablar primero sobre el proceso',
      description:
        'Esto no autoriza una categoría adicional. Un agente licenciado puede explicarle el proceso antes de comenzar cualquier conversación específica sobre planes.',
    }),
  }),
]);

/** Category codes that actually authorize discussion. */
export const AUTHORIZING_CATEGORY_CODES = Object.freeze(
  SOA_CATEGORIES.filter((c) => c.authorizes).map((c) => c.code),
);

/** Every valid category code, authorizing or not. */
export const ALL_CATEGORY_CODES = Object.freeze(SOA_CATEGORIES.map((c) => c.code));

/** Appointment formats offered on the form, verbatim both languages. */
export const APPOINTMENT_FORMATS = Object.freeze([
  Object.freeze({ code: 'TELEPHONE', en: 'Telephone', es: 'Teléfono', inPerson: false }),
  Object.freeze({ code: 'VIDEO', en: 'Video', es: 'Video', inPerson: false }),
  Object.freeze({ code: 'IN_PERSON', en: 'In person', es: 'Presencial', inPerson: true }),
]);

/** Channel the SOA instance was completed through (evidence field "Source"). */
export const SOA_SOURCES = Object.freeze(['WEB', 'SMS_LINK', 'EMAIL_LINK', 'APPROVED_WRITTEN_METHOD']);

/**
 * All customer-facing copy, verbatim from the approved templates.
 * Keys mirror the document's own structure so a reviewer can diff by eye.
 */
export const SOA_TEXT = Object.freeze({
  en: Object.freeze({
    org: 'CLEAR POINT SENIOR ADVISORS',
    // `{state}` is substituted from state-rules.js — the only per-state token.
    title: 'SCOPE OF APPOINTMENT - {state}',
    subtitle: 'Clear Point Master SOA Template - Appointment-Specific Instance - English / Español',
    prepared: 'Prepared for implementation and compliance validation - CY2027',
    intro:
      'This form documents only the Medicare product categories the beneficiary authorizes a licensed agent to discuss during one specific personal marketing appointment. It is not an enrollment form and does not change current coverage.',
    appointmentHeading: 'Appointment',
    categoriesHeading: 'English - Product categories you authorize for this appointment',
    categoriesHelp:
      'Please select only the topics you want the licensed Clear Point agent to be allowed to discuss with you during this appointment. You may select more than one. If you are unsure, you may leave a category unselected and speak with the licensed agent about the process before authorizing additional topics.',
    important:
      'Important: Completing this Scope of Appointment does not require you to enroll in a plan, does not obligate you to change your current coverage, and does not authorize discussion of product categories you did not select. If you later want to discuss another category, the scope must be updated/documented before that additional plan-specific discussion.',
    authorizationHeading: 'Authorization',
    authorizationStatement:
      'By signing/affirming below, I confirm that the categories marked above are the categories I authorize for this specific appointment.',
    readBackHeading: 'Please confirm what you authorized',
    readBackIntro: 'You authorized the licensed agent to discuss only the following at this appointment:',
    readBackNone: 'You did not authorize any product category. A licensed agent will explain the process first.',
    security:
      'Security: Do not enter Social Security number, Medicare Beneficiary Identifier (MBI), bank/card information, or detailed medical information on this SOA.',
    fields: Object.freeze({
      beneficiaryName: 'Beneficiary full name',
      residenceState: 'Residence state',
      zip: 'ZIP code',
      county: 'County',
      appointmentDate: 'Appointment date',
      appointmentFormat: 'Appointment format',
      planYear: 'Plan/contract year',
      language: 'Preferred language',
      soaInstanceId: 'SOA Instance ID',
      signature: 'Beneficiary or authorized representative signature',
      printedName: 'Printed name',
      representativeAuthority: 'Relationship/authority if representative',
      signedAt: 'Date/time',
      affirmationMethod: 'Electronic affirmation method',
      agent: 'Agent',
    }),
  }),
  es: Object.freeze({
    org: 'CLEAR POINT SENIOR ADVISORS',
    title: 'SCOPE OF APPOINTMENT - {state}',
    subtitle: 'Clear Point Master SOA Template - Appointment-Specific Instance - English / Español',
    prepared: 'Prepared for implementation and compliance validation - CY2027',
    intro:
      'This form documents only the Medicare product categories the beneficiary authorizes a licensed agent to discuss during one specific personal marketing appointment. It is not an enrollment form and does not change current coverage.',
    appointmentHeading: 'Cita',
    categoriesHeading: 'Español - Categorías que usted autoriza para esta cita',
    categoriesHelp:
      'Seleccione solamente los temas que desea autorizar para que el agente licenciado de Clear Point pueda conversar con usted durante esta cita. Puede seleccionar más de uno. Si no está seguro, puede dejar una categoría sin seleccionar y hablar primero con el agente licenciado sobre el proceso antes de autorizar temas adicionales.',
    important:
      'Importante: Completar este Scope of Appointment no le obliga a inscribirse en un plan, no le obliga a cambiar su cobertura actual y no autoriza conversar sobre categorías que usted no seleccionó. Si después desea conversar sobre otra categoría, el alcance debe actualizarse/documentarse antes de esa conversación específica sobre planes.',
    authorizationHeading: 'Autorización',
    authorizationStatement:
      'Al firmar o confirmar a continuación, confirmo que las categorías marcadas arriba son las que autorizo para esta cita específica.',
    readBackHeading: 'Por favor confirme lo que autorizó',
    readBackIntro: 'Usted autorizó al agente licenciado a conversar únicamente sobre lo siguiente en esta cita:',
    readBackNone:
      'Usted no autorizó ninguna categoría de producto. Un agente licenciado le explicará primero el proceso.',
    security:
      'Seguridad: No escriba su número de Seguro Social, su identificador de Medicare (MBI), información bancaria o de tarjeta, ni información médica detallada en este SOA.',
    fields: Object.freeze({
      beneficiaryName: 'Nombre completo del beneficiario',
      residenceState: 'Estado de residencia',
      zip: 'Código postal',
      county: 'Condado',
      appointmentDate: 'Fecha de la cita',
      appointmentFormat: 'Modalidad',
      planYear: 'Año del plan',
      language: 'Idioma',
      soaInstanceId: 'SOA Instance ID',
      signature: 'Firma del beneficiario o representante autorizado',
      printedName: 'Nombre en letra de molde',
      representativeAuthority: 'Relación o autoridad si firma un representante',
      signedAt: 'Fecha y hora',
      affirmationMethod: 'Método de confirmación electrónica',
      agent: 'Agente',
    }),
  }),
});

/**
 * The agency/agent line that appears on the form, verbatim.
 * NPN is owner-supplied and already verified in src/lib/soaContent.ts; it is
 * repeated here only because the approved template prints it on the form.
 */
export const SOA_AGENT_LINE = 'Sawil Reyes - NPN 17261494';

/**
 * Evidence fields the approved template prints under "System evidence - not
 * customer-editable". Used by the PDF renderer and by the parity guard so a
 * field cannot silently disappear from the evidence copy.
 */
export const SOA_EVIDENCE_FIELDS = Object.freeze([
  'SOA_ID',
  'SOA_FORM_VERSION',
  'STATE_RULESET_VERSION',
  'LANGUAGE',
  'CREATED_AT',
  'COMPLETED_AT',
  'SOURCE',
  'APPOINTMENT_ID',
  'INTEGRITY_HASH',
  'EVIDENCE_REFERENCE',
]);

/**
 * Terms that must never appear alone in customer-facing output.
 * Spec §29: "Never use MA, MAPD, PDP alone in customer-facing speech."
 * Exported so the compliance filter and the tests share one list.
 */
export const FORBIDDEN_BARE_ACRONYMS = Object.freeze(['MA', 'MAPD', 'MA-PD', 'PDP']);

/**
 * Pinned digest of every customer-facing string above.
 * Recomputed by scripts/check-cy2027-parity.mjs; a mismatch fails the build.
 * Re-pin ONLY together with an owner-approved wording change.
 */
export const APPROVED_TEXT_DIGEST = 'sha256:d7b907f68939e971052c756b0df98c674b760007fa52a99fd4a6a9a66526de63';

/** Deterministic serialization the digest is computed over. */
export function approvedTextPayload() {
  return JSON.stringify({
    scriptVersion: SOA_SCRIPT_VERSION,
    planYear: SOA_PLAN_YEAR,
    categories: SOA_CATEGORIES,
    formats: APPOINTMENT_FORMATS,
    text: SOA_TEXT,
    agentLine: SOA_AGENT_LINE,
    evidenceFields: SOA_EVIDENCE_FIELDS,
  });
}

/** Look up a category by code. Returns null for unknown codes. */
export function categoryByCode(code) {
  return SOA_CATEGORIES.find((c) => c.code === code) || null;
}

/** Localized label/description pair for a category code. */
export function categoryText(code, lang) {
  const c = categoryByCode(code);
  if (!c) return null;
  return lang === 'es' ? c.es : c.en;
}

/**
 * Title with the per-state token substituted.
 * `stateName` comes from state-rules.js, never from user input.
 */
export function soaTitle(lang, stateName) {
  const t = lang === 'es' ? SOA_TEXT.es : SOA_TEXT.en;
  return t.title.replace('{state}', stateName);
}

/**
 * Build the read-back sentence shown before final confirmation (spec §8:
 * "Read back the selected categories before final confirmation").
 * Non-authorizing selections are deliberately excluded from the authorized list.
 */
export function readBackLines(selectedCodes, lang) {
  const t = lang === 'es' ? SOA_TEXT.es : SOA_TEXT.en;
  const authorized = (Array.isArray(selectedCodes) ? selectedCodes : [])
    .filter((code) => {
      const c = categoryByCode(code);
      return !!c && c.authorizes;
    })
    .map((code) => categoryText(code, lang).label);
  return {
    heading: t.readBackHeading,
    intro: authorized.length ? t.readBackIntro : t.readBackNone,
    items: authorized,
  };
}

// Type declarations for the canonical CY2027 approved-text module.
// The .js file is the single source of truth; this file only describes it so
// the TypeScript client can import it without a second copy of the strings.
// scripts/check-cy2027-parity.mjs asserts that every export named here exists.

export type SoaLang = 'en' | 'es';

export type SoaCategoryCode = 'MA_NO_RX' | 'MA_WITH_RX' | 'STANDALONE_RX' | 'UNSURE_DISCUSS_PROCESS';

export interface SoaCategoryText {
  readonly label: string;
  readonly description: string;
}

export interface SoaCategory {
  readonly code: SoaCategoryCode;
  /** false for "I am not sure" — a selection that authorizes nothing. */
  readonly authorizes: boolean;
  readonly en: SoaCategoryText;
  readonly es: SoaCategoryText;
}

export interface AppointmentFormat {
  readonly code: 'TELEPHONE' | 'VIDEO' | 'IN_PERSON';
  readonly en: string;
  readonly es: string;
  readonly inPerson: boolean;
}

export interface SoaTextFields {
  readonly beneficiaryName: string;
  readonly residenceState: string;
  readonly zip: string;
  readonly county: string;
  readonly appointmentDate: string;
  readonly appointmentFormat: string;
  readonly planYear: string;
  readonly language: string;
  readonly soaInstanceId: string;
  readonly signature: string;
  readonly printedName: string;
  readonly representativeAuthority: string;
  readonly signedAt: string;
  readonly affirmationMethod: string;
  readonly agent: string;
}

export interface SoaTextBlock {
  readonly org: string;
  readonly title: string;
  readonly subtitle: string;
  readonly prepared: string;
  readonly intro: string;
  readonly appointmentHeading: string;
  readonly categoriesHeading: string;
  readonly categoriesHelp: string;
  readonly important: string;
  readonly authorizationHeading: string;
  readonly authorizationStatement: string;
  readonly readBackHeading: string;
  readonly readBackIntro: string;
  readonly readBackNone: string;
  readonly security: string;
  readonly fields: SoaTextFields;
}

export declare const SOA_PLAN_YEAR: number;
export declare const SOA_SCRIPT_VERSION: string;
export declare const SOA_CATEGORIES: readonly SoaCategory[];
export declare const AUTHORIZING_CATEGORY_CODES: readonly SoaCategoryCode[];
export declare const ALL_CATEGORY_CODES: readonly SoaCategoryCode[];
export declare const APPOINTMENT_FORMATS: readonly AppointmentFormat[];
export declare const SOA_SOURCES: readonly string[];
export declare const SOA_TEXT: { readonly en: SoaTextBlock; readonly es: SoaTextBlock };
export declare const SOA_AGENT_LINE: string;
export declare const SOA_EVIDENCE_FIELDS: readonly string[];
export declare const FORBIDDEN_BARE_ACRONYMS: readonly string[];
export declare const APPROVED_TEXT_DIGEST: string;

export declare function approvedTextPayload(): string;
export declare function categoryByCode(code: string): SoaCategory | null;
export declare function categoryText(code: string, lang: SoaLang): SoaCategoryText | null;
export declare function soaTitle(lang: SoaLang, stateName: string): string;
export declare function readBackLines(
  selectedCodes: readonly string[],
  lang: SoaLang,
): { heading: string; intro: string; items: string[] };

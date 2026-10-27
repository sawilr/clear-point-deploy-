// Type declarations for the appointment-specific SOA instance model.
// The .js file is the single source of truth.

import type { SoaCategoryCode, SoaLang } from './soa-text.js';

export type SoaStatus =
  | 'DRAFT'
  | 'PENDING_SIGNATURE'
  | 'COMPLETED'
  | 'SUPERSEDED'
  | 'REVOKED'
  | 'SOA_INCOMPLETE';

export type SoaMethodCode =
  | 'WEB_ELECTRONIC_SIGNATURE'
  | 'SMS_LINK_ELECTRONIC'
  | 'EMAIL_LINK_ELECTRONIC'
  | 'APPROVED_WRITTEN_METHOD'
  | 'VOICE_RECORDED';

export type LanguageSourceCode =
  | 'BENEFICIARY_ELECTED'
  | 'REPRESENTATIVE_ELECTED'
  | 'SYSTEM_DEFAULT'
  | 'INFERRED_FROM_LEAD';

export interface SoaInstance {
  soaId: string;
  appointmentId: string;
  appointmentAt: string | null;
  appointmentFormat: string;
  planYear: number;
  state: string;
  zip: string;
  county: string | null;
  language: SoaLang;
  languageSource: LanguageSourceCode;
  method: SoaMethodCode;
  source: string;
  beneficiaryName: string;
  representativeRelationship: string | null;
  authorizedCategories: SoaCategoryCode[];
  declinedCategories: SoaCategoryCode[];
  nonAuthorizingSelections: SoaCategoryCode[];
  /** The CMS ruleset version the SOA was signed under (spec §22). */
  cmsRulesetVersion: string;
  stateRulesetVersion: string;
  soaFormVersion: string;
  scriptVersion: string;
  status: SoaStatus;
  createdAt: string;
  completedAt: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  /** Set on the replaced record by supersede(); absent on a live one. */
  supersededAt?: string | null;
  revokedAt: string | null;
  integrityHash: string | null;
  evidenceReference: string | null;
}

export interface SoaAppointment {
  appointmentId: string;
  startsAt?: string | null;
  state?: string | null;
  format?: 'TELEPHONE' | 'VIDEO' | 'IN_PERSON';
}

export interface GateDecision {
  allowed: boolean;
  reason: string;
  authorizedCategories?: SoaCategoryCode[];
}

export declare const SOA_STATUS: Readonly<Record<string, SoaStatus>>;
export declare const SOA_METHOD: Readonly<
  Record<SoaMethodCode, Readonly<{ code: SoaMethodCode; written: boolean; source: string }>>
>;

export declare const LANGUAGE_SOURCE: Readonly<
  Record<LanguageSourceCode, Readonly<{ code: LanguageSourceCode; signable: boolean }>>
>;

export declare function languageWasElected(source: unknown): boolean;
export declare function isSoaLanguage(value: unknown): value is SoaLang;
export declare function languageElectionLabel(source: unknown, lang: unknown): string;
export declare function readLanguageElection(
  body: unknown,
):
  | { ok: true; language: SoaLang; languageSource: LanguageSourceCode }
  | { ok: false; reason: 'LANGUAGE_NOT_SUPPLIED' | 'ELECTION_NOT_RECORDED' | 'NOT_AN_ELECTION' };
export declare function electionAttributionError(
  languageSource: unknown,
  representativeRelationship: unknown,
): 'representative_required' | 'election_attribution_mismatch' | null;
export declare function methodIsWritten(methodCode: string): boolean;
export declare function partitionSelection(selectedCodes: readonly string[] | null | undefined): {
  authorized: SoaCategoryCode[];
  declined: SoaCategoryCode[];
  nonAuthorizing: SoaCategoryCode[];
  invalid: string[];
};
export declare function createSoaInstance(
  input: Record<string, unknown>,
): { ok: true; instance: SoaInstance } | { ok: false; errors: Record<string, string> };
export declare function completeSoaInstance(
  instance: SoaInstance,
  opts: { completedAt?: string; integrityHash: string; evidenceReference: string },
): SoaInstance;
export declare const SOA_SCOPE_PROBLEM: Readonly<{
  RECORDS_UNREADABLE: 'SOA_RECORDS_UNREADABLE';
  RECORD_UNREADABLE: 'SOA_RECORD_UNREADABLE';
  RECORD_DUPLICATED: 'SOA_RECORD_DUPLICATED';
  RECORD_CONTRADICTORY: 'SOA_RECORD_CONTRADICTORY';
  APPOINTMENT_MIXED: 'SOA_APPOINTMENT_MIXED';
  ACTIVE_SCOPE_CONFLICT: 'SOA_ACTIVE_SCOPE_CONFLICT';
}>;
/** The prior record: a signed instance, or a ledger entry carrying the same fields. */
export type SoaPriorRecord = Pick<
  SoaInstance,
  'soaId' | 'appointmentId' | 'planYear' | 'state' | 'beneficiaryName' | 'status' | 'supersededById' | 'revokedAt'
> & Record<string, unknown>;
export declare function supersede(
  previous: SoaPriorRecord,
  instance: SoaInstance,
  opts?: { at?: string },
): { ok: true; previous: Readonly<SoaPriorRecord>; instance: SoaInstance } | { ok: false; errors: Record<string, string> };
export declare function superseded(
  previous: SoaPriorRecord,
  nextInput: Record<string, unknown>,
  opts?: { at?: string },
): { ok: true; previous: Readonly<SoaPriorRecord>; instance: SoaInstance } | { ok: false; errors: Record<string, string> };
export declare function activeSoaInstance(
  records: unknown,
):
  | { ok: true; active: SoaPriorRecord | null }
  | { ok: false; reason: string; soaId?: string; soaIds?: string[] };
export declare function revokeSoaInstance(instance: SoaInstance, opts?: { at?: string }): SoaInstance;
export declare function coversCategory(instance: SoaInstance | null, code: string): boolean;
export declare function requiresScopeUpdate(instance: SoaInstance | null, code: string): boolean;
export declare function marketingGate(
  instance: SoaInstance | null,
  appointment: SoaAppointment | null,
  ruleset?: { planYear: number; version?: string; soa?: { mustPrecedeAppointment?: boolean; inPersonRequiresWritten?: boolean } } | null,
  opts?: { env?: Record<string, string | undefined>; now?: Date | string; registry?: Record<number, unknown> },
): GateDecision;
export declare function requiresNewInstance(
  instance: SoaInstance | null,
  appointment: SoaAppointment | null,
  ruleset?: { planYear: number } | null,
): boolean;

/** What the beneficiary AFFIRMED on the form: the two acknowledgements and the typed signature. */
export interface SoaAffirmations {
  readonly noObligation: boolean;
  readonly eSignature: boolean;
  readonly signature: string;
}
/**
 * The affirmations that survive a change of context (residence state, document
 * language): all of them when `previous === next`, none otherwise.
 */
export declare function affirmationsAfterContextChange(
  previous: unknown,
  next: unknown,
  affirmations: Partial<SoaAffirmations> | null | undefined,
): SoaAffirmations;

/**
 * The jurisdiction the web form holds as ONE value: the residence state and the
 * three affirmations made under it (SPEC-31, red team).
 */
export interface SoaJurisdiction<S extends string = string> extends SoaAffirmations {
  readonly residenceState: S;
}
/** The full next jurisdiction after a change of residence state: the new state, and the affirmations that survive it. */
export declare function jurisdictionAfterStateChange<S extends string>(
  current: Partial<SoaJurisdiction<S>> | null | undefined,
  next: S,
): SoaJurisdiction<S>;
/** The full next jurisdiction after a change of document language: the state kept, every affirmation withdrawn. */
export declare function jurisdictionAfterLanguageChange<S extends string>(
  current: Partial<SoaJurisdiction<S>> | null | undefined,
): SoaJurisdiction<S>;

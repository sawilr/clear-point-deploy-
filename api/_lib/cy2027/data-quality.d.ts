// Type declarations for the canonical lead data-quality facts (spec §12).
// The .js file is the single source of truth.

/** Throwaway-inbox services. One list for the browser validator and the server's review signal. */
export declare const DISPOSABLE_EMAIL_DOMAINS: readonly string[];

/** Lower-cased domain of a single well-formed address, or '' for anything else. */
export declare function emailDomain(value: unknown): string;

/** True when the address is at a listed throwaway-inbox service or a subdomain of one. */
export declare function isDisposableEmail(value: unknown): boolean;

export type ReviewInconsistencyKind = 'zip_state_mismatch' | 'name' | 'phone';

/** The only inconsistency kinds that may count toward a review suggestion. */
export declare const REVIEW_INCONSISTENCY_KINDS: readonly ReviewInconsistencyKind[];

/** Counted penalties at or above this value suggest a human data review. */
export declare const DATA_REVIEW_WEIGHT_THRESHOLD: number;

export interface InconsistencyAggregate {
  kinds: string[];
  weight: number;
  reviewSuggested: boolean;
}

/** Maps an engine reason string to its kind ('name_too_short' → 'name'). */
export declare function inconsistencyKind(reason: unknown): string;

/** Pure: the next aggregate after one more recorded inconsistency. */
export declare function aggregateInconsistency(
  current: { kinds?: readonly string[]; weight?: number } | null | undefined,
  reason: string,
  penalty: number,
): InconsistencyAggregate;

/** The marker that replaces the retired `probable_fake_lead` label in client text. */
export declare const CLIENT_LABEL_REMOVED: string;

/** Free text with every spelling of the retired fraud label replaced by CLIENT_LABEL_REMOVED. */
export declare function neutralizeFakeLeadLabel(text: unknown): string;

/** The words that make a tag a verdict about the person (one table, frozen). */
export declare const VERDICT_TAG_VOCABULARY: {
  readonly qualifiers: readonly string[];
  readonly shortQualifiers: readonly string[];
  readonly adjectives: readonly string[];
  readonly subjects: readonly string[];
  readonly personNouns: readonly string[];
  readonly shortPersonNouns: readonly string[];
  readonly negators: readonly string[];
  readonly genuine: readonly string[];
  readonly assessments: readonly string[];
};

export type TagRefusalReason =
  | 'RETIRED_LABEL' | 'NEUTRALISED_MARKER' | 'QUALIFIED_VERDICT' | 'VERDICT_ON_SUBJECT'
  | 'PERSON_NOUN' | 'NEGATED_GENUINE' | 'VERDICT_ASSESSMENT';

/** Why a tag was refused; codes only. */
export declare const TAG_REFUSAL_REASONS: { readonly [K in TagRefusalReason]: K };

/** The key a tag is judged by: look-alikes folded, invisibles removed, lower-cased, dash-separated. */
export declare function normalizeTagKey(tag: unknown): string;

/** Pure: the reason a client tag is a verdict about the person, or null when it may reach the CRM. */
export declare function clientTagRefusal(tag: unknown): TagRefusalReason | null;

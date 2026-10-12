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

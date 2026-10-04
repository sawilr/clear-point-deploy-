// Type declarations for the CY2027 state-first jurisdiction engine.
// The .js file is the single source of truth.

export type SupportedState = 'NY' | 'NJ' | 'CT';

export interface RecordingNoticePosition {
  readonly allPartyConsent: boolean;
  readonly basis: string;
  readonly complianceReview: string;
}

export interface StateRuleset {
  readonly code: SupportedState;
  readonly name: string;
  readonly nameEs: string;
  readonly supported: boolean;
  readonly planYear: number;
  readonly stateRulesetVersion: string;
  readonly soaFormVersion: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  /** The owner's attestation. All three are null when none is on record (see ruleset-lifecycle.js). */
  readonly promotion: {
    readonly rulesetVersion?: string | null;
    readonly promotedBy: string | null;
    readonly promotedAt: string | null;
    readonly evidenceReference: string | null;
  };
  /** The recorded lifecycle steps; empty when none is on record. */
  readonly transitions: readonly {
    readonly rulesetVersion: string;
    readonly from: string;
    readonly to: string;
    readonly actor: string;
    readonly at: string;
    readonly evidenceReference: string;
  }[];
  /** What a person must review each cycle. Dates are YYYY-MM-DD, or null when nothing is on record. */
  readonly sourceReviews: readonly {
    readonly name: string;
    readonly url: string | null;
    readonly verifiedOn: string | null;
    readonly verifiedBy: string | null;
    readonly reviewBy: string | null;
  }[];
  readonly recordingNotice: RecordingNoticePosition;
}

export type StateResolution =
  | { ok: true; ruleset: StateRuleset }
  | {
      ok: false;
      reason:
        | 'NO_STATE'
        | 'INVALID_STATE'
        | 'STATE_NOT_SUPPORTED'
        | 'RULESET_MISSING'
        | 'RULESET_NOT_ACTIVE'
        | 'RULESET_EXPIRED'
        | 'RULESET_NOT_YET_EFFECTIVE'
        | 'CLOCK_UNREADABLE'
        | 'RULESET_PROMOTION_NOT_RECORDED'
        | 'RULE_SOURCES_MISSING'
        | 'RULE_SOURCE_REVIEW_OVERDUE'
        | 'RULE_SOURCE_NOT_VERIFIED';
      state?: string;
      planYear?: number;
      status?: string;
      humanReview: boolean;
    };

export type CountyResolution =
  | { status: 'RESOLVED'; county: string; state: string | null }
  | { status: 'ASK_BENEFICIARY'; options: string[]; reason: 'INVALID_ZIP' | 'NO_DATASET' | 'AMBIGUOUS' | 'NOT_IN_DATASET' };

export declare const RULESET_LIFECYCLE: readonly string[];
export declare const STATE_RULESETS: Readonly<Record<SupportedState, StateRuleset>>;
export declare const SUPPORTED_STATES: readonly SupportedState[];

export declare function resolveStateRuleset(
  state: string | null | undefined,
  planYear?: number | null,
  now?: Date,
  registry?: Record<string, unknown>,
): StateResolution;
export declare function isRegisteredStateRuleset(ruleset: unknown, registry?: Record<string, unknown>): boolean;
export declare function evaluateStateRuleset(ruleset: unknown, planYear: number, now?: Date | string): StateResolution;
export declare function resolveSigningRulesets(
  residenceState: string | null | undefined,
  now?: Date,
  env?: Record<string, string | undefined>,
):
  | { ok: true; ruleset: import('./rulesets.js').CmsRuleset; stateRuleset: StateRuleset }
  | { ok: false; stage: 'CMS_RULESET' | 'STATE_RULESET'; reason: string };
/** What the SOA form may present for a chosen residence state. `ruleset` is null unless it resolved. */
export declare function soaFormRules(
  residenceState: string | null | undefined,
  now?: Date,
): {
  planYear: number;
  unsupported: boolean;
  ruleset: StateRuleset | null;
  rulesUnavailable: boolean;
  reason: string | null;
};
export declare function zipStateConsistency(
  zip: string | null | undefined,
  state: string | null | undefined,
): 'CONSISTENT' | 'FLAG_FOR_REVIEW' | 'UNKNOWN';
export declare function setCountyDataset(dataset: Record<string, string | string[]> | null): void;
export declare function hasCountyDataset(): boolean;
export declare function resolveCounty(zip: string, state?: string): CountyResolution;

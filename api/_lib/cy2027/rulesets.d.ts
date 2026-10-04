// Type declarations for the immutable per-plan-year CMS ruleset engine.
// The .js file is the single source of truth.

export interface SoaRules {
  readonly advanceWaitHours: number;
  readonly mustPrecedeAppointment: boolean;
  readonly inPersonRequiresWritten: boolean;
  readonly nonInPersonAllowsRecorded: boolean;
  readonly universalStandingSoaAllowed: boolean;
}

export interface TpmoRules {
  readonly includesShipReference: boolean;
  readonly requiresOrganizationAndProductCounts: boolean;
}

export interface RetentionRules {
  readonly marketingSalesCallMinYears: number;
  readonly audioRequiredFirstYears: number;
  readonly audioOrCompleteTranscriptYears: readonly [number, number] | readonly number[];
  readonly note: string;
}

export type RulesetStatus = 'PENDING_REVIEW' | 'VERIFIED' | 'STAGING_TESTED' | 'PRODUCTION_ACTIVE' | 'SUPERSEDED';

/** Who made a ruleset active. All three are null when no human promotion is on record. */
export interface RulesetPromotion {
  readonly promotedBy: string | null;
  readonly promotedAt: string | null;
  readonly evidenceReference: string | null;
}

/** Dates are YYYY-MM-DD, or null when nothing is on record (unknown, never invented). */
export interface RulesetSourceReview {
  readonly name: string;
  readonly url: string;
  readonly verifiedOn: string | null;
  readonly verifiedBy: string | null;
  readonly reviewBy: string | null;
}

export type RulesetAttestation = 'ATTESTED' | 'GRANDFATHERED_PENDING_OWNER' | 'NOT_RECORDED' | 'NOT_APPLICABLE';

export interface CmsRuleset {
  readonly planYear: number;
  readonly version: string;
  readonly status: RulesetStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly soa: SoaRules;
  readonly tpmo: TpmoRules;
  readonly retention: RetentionRules;
  readonly sources: readonly string[];
  readonly sourceReviews: readonly RulesetSourceReview[];
  readonly promotion: RulesetPromotion;
}

/** A plan year in preparation: it carries NO rule values, only its place in the lifecycle. */
export interface CmsRulesetPlaceholder {
  readonly planYear: number;
  readonly version: string;
  readonly status: RulesetStatus;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly soa: { readonly [K in keyof SoaRules]: SoaRules[K] | null };
  readonly tpmo: { readonly [K in keyof TpmoRules]: TpmoRules[K] | null };
  readonly retention: RetentionRules | null;
  readonly sources: readonly string[];
  readonly sourceReviews: readonly RulesetSourceReview[];
  readonly promotion: RulesetPromotion;
}

export type RulesetResolution =
  | { ok: true; ruleset: CmsRuleset; attestation: RulesetAttestation }
  | {
      ok: false;
      reason:
        | 'REGULATORY_KILL_ENGAGED'
        | 'CLOCK_UNREADABLE'
        | 'RULESET_MISSING'
        | 'RULESET_NOT_ACTIVE'
        | 'RULESET_PROMOTION_NOT_RECORDED'
        | 'RULE_SOURCE_REVIEW_OVERDUE';
      planYear?: number;
      status?: string;
      humanReview: boolean;
    };

export declare const CY2027_MARKETING_START_UTC: number;
export declare const CMS_RULESET_2026: CmsRuleset;
export declare const CMS_RULESET_2027: CmsRuleset;
export declare const CMS_RULESET_2028: CmsRulesetPlaceholder;

export declare function marketingStartUtc(planYear: number): number;
/** NaN when the clock cannot be read. */
export declare function activePlanYear(now?: Date | string): number;
export declare function isRegisteredRuleset(ruleset: unknown, registry?: Record<number, unknown>): boolean;
export declare function rulesetVouchProblem(
  ruleset: unknown,
  registry?: Record<number, unknown>,
): 'RULESET_NOT_REGISTERED' | 'RULESET_UNRESOLVED' | 'RULESET_NOT_ACTIVE' | 'RULESET_PROMOTION_NOT_RECORDED' | null;
export declare function regulatoryKillEngaged(env?: Record<string, string | undefined>): boolean;
export declare function resolveRuleset(
  planYear?: number | null,
  now?: Date,
  env?: Record<string, string | undefined>,
): RulesetResolution;
export declare function evaluateRuleset(ruleset: unknown, now?: Date | string): RulesetResolution;
export declare function rulesetForAudit(planYear: number): CmsRuleset | CmsRulesetPlaceholder | null;
export declare function rulesetInventory(): Array<{
  planYear: number;
  version: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  attestation: RulesetAttestation;
  nextStatus: string | null;
}>;
export declare function rolloverStatus(now?: Date | string):
  | { ok: false; reason: 'CLOCK_UNREADABLE' }
  | {
      ok: true;
      planYear: number;
      nextPlanYear: number;
      nextMarketingStart: string;
      daysUntilRollover: number;
      nextRulesetVersion: string | null;
      nextRulesetStatus: string;
      nextRulesetReady: boolean;
    };

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

/**
 * The owner's attestation of a GRANDFATHERED ruleset. All three are null when
 * none is on record; a complete one also names the version it attests.
 */
export interface RulesetPromotion {
  readonly rulesetVersion?: string | null;
  readonly promotedBy: string | null;
  readonly promotedAt: string | null;
  readonly evidenceReference: string | null;
}

/** One recorded lifecycle step, as recordRulesetTransition() returns it. */
export interface RulesetTransition {
  readonly rulesetVersion: string;
  readonly from: RulesetStatus;
  readonly to: RulesetStatus;
  readonly actor: string;
  readonly at: string;
  readonly evidenceReference: string;
}

/** Dates are YYYY-MM-DD, or null when nothing is on record (unknown, never invented). */
export interface RulesetSourceReview {
  readonly name: string;
  readonly url: string | null;
  readonly verifiedOn: string | null;
  readonly verifiedBy: string | null;
  readonly reviewBy: string | null;
}

export type RulesetAttestation =
  | 'ATTESTED'
  | 'GRANDFATHERED_OWNER_ATTESTED'
  | 'GRANDFATHERED_PENDING_OWNER'
  | 'NOT_RECORDED'
  | 'NOT_APPLICABLE';

/** Every reason a ruleset may not govern live work (rulesetUseProblem in rulesets.js). */
export type RulesetUseProblem =
  | 'RULESET_UNRESOLVED'
  | 'CLOCK_UNREADABLE'
  | 'RULESET_NOT_ACTIVE'
  | 'RULESET_PROMOTION_NOT_RECORDED'
  | 'RULESET_NOT_YET_EFFECTIVE'
  | 'RULESET_NOT_IN_FORCE'
  | 'RULE_SOURCES_MISSING'
  | 'RULE_SOURCE_REVIEW_OVERDUE'
  | 'RULE_SOURCE_NOT_VERIFIED';

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
  readonly transitions: readonly RulesetTransition[];
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
  readonly transitions: readonly RulesetTransition[];
}

export type RulesetResolution =
  | { ok: true; ruleset: CmsRuleset; attestation: RulesetAttestation }
  | {
      ok: false;
      reason: 'REGULATORY_KILL_ENGAGED' | 'RULESET_MISSING' | RulesetUseProblem;
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
  now?: Date | string,
): 'RULESET_NOT_REGISTERED' | RulesetUseProblem | null;
export declare function regulatoryKillEngaged(env?: Record<string, string | undefined>): boolean;
export declare function resolveRuleset(
  planYear?: number | null,
  now?: Date,
  env?: Record<string, string | undefined>,
  registry?: Record<number, unknown>,
): RulesetResolution;
export declare function evaluateRuleset(ruleset: unknown, now?: Date | string): RulesetResolution;
export declare function rulesetForAudit(planYear: number): CmsRuleset | CmsRulesetPlaceholder | null;
export declare function rulesetInventory(now?: Date | string): Array<{
  planYear: number;
  version: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  attestation: RulesetAttestation;
  nextStatus: string | null;
}>;
export declare function rolloverStatus(now?: Date | string, registry?: Record<number, unknown>):
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

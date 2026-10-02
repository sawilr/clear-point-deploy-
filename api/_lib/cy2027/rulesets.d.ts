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

export interface CmsRuleset {
  readonly planYear: number;
  readonly version: string;
  readonly status: 'PENDING_REVIEW' | 'VERIFIED' | 'STAGING_TESTED' | 'PRODUCTION_ACTIVE' | 'SUPERSEDED';
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly soa: SoaRules;
  readonly tpmo: TpmoRules;
  readonly retention: RetentionRules;
  readonly sources: readonly string[];
}

export type RulesetResolution =
  | { ok: true; ruleset: CmsRuleset }
  | {
      ok: false;
      reason: 'REGULATORY_KILL_ENGAGED' | 'RULESET_MISSING' | 'RULESET_NOT_ACTIVE';
      planYear?: number;
      status?: string;
      humanReview: boolean;
    };

export declare const CY2027_MARKETING_START_UTC: number;
export declare const CMS_RULESET_2026: CmsRuleset;
export declare const CMS_RULESET_2027: CmsRuleset;

export declare function activePlanYear(now?: Date | string): number;
export declare function regulatoryKillEngaged(env?: Record<string, string | undefined>): boolean;
export declare function resolveRuleset(
  planYear?: number | null,
  now?: Date,
  env?: Record<string, string | undefined>,
): RulesetResolution;
export declare function rulesetForAudit(planYear: number): CmsRuleset | null;
export declare function rulesetInventory(): Array<{
  planYear: number;
  version: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}>;

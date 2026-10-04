// Type declarations for the canonical TPMO (e)(41) module.
// The .js file is the single source of truth.

export type TpmoConfigStatus = 'VERIFIED' | 'BLOCKED_COUNTS_REQUIRED';

export interface TpmoDisclaimerConfig {
  /** States the counts apply to. One config per service area if they differ. */
  serviceArea: ReadonlyArray<'NY' | 'NJ' | 'CT'>;
  /** Contract-year wording variant currently in force for marketing. */
  contractYearVariant: 'CY2026' | 'CY2027';
  /** Number of contracted organizations — null until verified. NEVER guess. */
  organizationCount: number | null;
  /** Number of products/plans offered in the area — null until verified. */
  productCount: number | null;
  /** Where the counts were verified (e.g. "FMO appointment report 2026-08"). */
  verificationSource: string | null;
  /** Person who approved the counts. */
  approvedBy: string | null;
  /** ISO date the counts were approved. */
  approvedOn: string | null;
  /** ISO date the counts must be re-reviewed (AEP changes, new carriers). */
  nextReviewDate: string | null;
  status: TpmoConfigStatus;
}

export declare const CY2027_MARKETING_START_UTC: number;
export declare const TPMO_DISCLAIMER_VERSION: string;
export declare const TPMO_DISCLAIMER_CONFIG: TpmoDisclaimerConfig;

export declare function activeContractYearVariant(now?: Date): 'CY2026' | 'CY2027';
export declare const LATEST_TPMO_VARIANT_PLAN_YEAR: number;
export declare function hasVerifiedTpmoCounts(cfg?: TpmoDisclaimerConfig): boolean;
export declare function tpmoDisclaimerText(lang: 'en' | 'es', cfg?: TpmoDisclaimerConfig): string;
export declare function assertDisclaimerSignable(text: string): boolean;

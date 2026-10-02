// ─────────────────────────────────────────────────────────────────────────────
// TPMO disclaimer — CLIENT ENTRY POINT.
//
// AUDIT 2026-10-01 (CY2027) — the wording, the counts configuration and the
// contract-year variant logic MOVED to api/_lib/cy2027/tpmo.js. They did not
// change; they stopped being duplicated.
//
// Why the move: the same (e)(41) sentence existed in three files
// (this one, src/lib/soaContent.ts and api/sign-soa.js) with two different
// bodies — the hardcoded copies still carried [X]/[Y] placeholders. That was
// blocker #1 against enabling the SOA workflow, because a signed PDF reading
// "[X] organizations" is an audit failure. They could not import each other:
// api/*.js cannot import from src/. So the canonical copy now lives in the
// environment-neutral CY2027 layer that both the server and this bundle reach,
// and scripts/check-cy2027-parity.mjs fails the build if a copy reappears.
//
// This file's public API is unchanged, so every existing import keeps working:
//   tpmoDisclaimerText, activeContractYearVariant, TPMO_DISCLAIMER_CONFIG,
//   hasVerifiedTpmoCounts, CY2027_MARKETING_START_UTC, TpmoDisclaimerConfig,
//   TpmoConfigStatus
//
// The counts themselves remain OWNER-SUPPLIED and are still unset — see
// TPMO_DISCLAIMER_CONFIG.status === 'BLOCKED_COUNTS_REQUIRED'.
// ─────────────────────────────────────────────────────────────────────────────

export {
  CY2027_MARKETING_START_UTC,
  TPMO_DISCLAIMER_VERSION,
  TPMO_DISCLAIMER_CONFIG,
  activeContractYearVariant,
  hasVerifiedTpmoCounts,
  tpmoDisclaimerText,
  assertDisclaimerSignable,
} from '../../api/_lib/cy2027/tpmo.js';

export type { TpmoConfigStatus, TpmoDisclaimerConfig } from '../../api/_lib/cy2027/tpmo.js';

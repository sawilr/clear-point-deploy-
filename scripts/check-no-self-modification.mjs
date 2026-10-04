#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BUILD GATE — NO PRODUCTION SELF-MODIFICATION (spec §23, §33).
//
//   §23  "No production self-modification."
//   §33  immediate fail: "Production prompt or rules self-modify from live
//        conversations."
//
// Three things are made true at build time, each of them checkable and each
// proven to bite (scripts/test-cy2027-learning-2026-10-04.mjs):
//
//   1. NOTHING UNDER api/ CAN TOUCH THE FILESYSTEM, SPAWN A PROCESS OR BUILD
//      CODE. Every file is parsed; every module it loads must be a string
//      literal on an allow-list; eval, Function, require and process internals
//      are refused as names, not as call shapes.
//   2. THE GOVERNING ARTEFACTS ARE DEEP-FROZEN. Rulesets, state rulesets, the
//      approved SOA text, the TPMO configuration and the decision tables cannot
//      be edited in memory by code that imports them.
//   3. NOTHING REASSIGNS OR MUTATES THEM IN SOURCE, under api/ or src/.
//
// The rules, and what they cannot prove, are in ./no-self-modification-lib.mjs.
//
// AUDIT 2026-10-04 (red team) — this file used to run its body only
// `if (invokedDirectly)`, comparing process.argv[1] with import.meta.url. Node
// resolves the main module to its real path, so through a symlink or a junction
// the two differed and the gate printed nothing and exited 0: a silent pass in
// an `a && b && c` build chain. The command now has NO condition: running this
// file runs the gate. Everything importable lives in the library next door.
//
// Run: node scripts/check-no-self-modification.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { runCli } from './no-self-modification-lib.mjs';

process.exitCode = await runCli(process.argv.slice(2));

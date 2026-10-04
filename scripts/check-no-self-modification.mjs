#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// BUILD GATE — NO PRODUCTION SELF-MODIFICATION (spec §23, §33).
//
//   §23  "No production self-modification."
//   §33  immediate fail: "Production prompt or rules self-modify from live
//        conversations."
//
// Until 2026-10-04 this held only because nobody had written the code that
// would break it. That is an accident, not a control. This gate makes three
// things true at build time, each of them checkable and each proven to bite:
//
//   1. NOTHING UNDER api/ CAN TOUCH THE FILESYSTEM OR SPAWN A PROCESS.
//      A serverless function that cannot open a file for writing cannot rewrite
//      a prompt, a ruleset or a knowledge file. The rule is deliberately the
//      blunt one — no fs / child_process / worker / vm import at all, static or
//      dynamic, and no eval / new Function — because a list of "write" method
//      names is a deny-list, and this layer has learned what those are worth.
//   2. THE GOVERNING ARTEFACTS ARE DEEP-FROZEN. Rulesets, state rulesets, the
//      approved SOA text, the TPMO configuration and the decision tables cannot
//      be edited in memory by code that imports them.
//   3. NOTHING REASSIGNS OR MUTATES THEM IN SOURCE. They are `const`, and no
//      file under api/ or src/ assigns to them or calls a mutating method on
//      them.
//
// WHAT THIS CANNOT PROVE, said plainly: it is a static and load-time check of
// THIS repository. It cannot see GoHighLevel, where Emely's and Sofía's prompts
// live; whether those are changed only by a person is an owner process. And it
// cannot see a change made by a human through the normal reviewed route — that
// is not self-modification, it is the route the spec requires.
//
// Run: node scripts/check-no-self-modification.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Comments are stripped so that prose about a forbidden thing is not the forbidden thing. */
export function stripComments(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Modules through which a function could write a file or start a process. */
const FORBIDDEN_MODULES = ['fs', 'fs/promises', 'child_process', 'worker_threads', 'vm', 'cluster'];
const moduleAlternation = FORBIDDEN_MODULES.map((m) => m.replace('/', '\\/')).join('|');
const FORBIDDEN_IMPORT_RE = new RegExp(
  // import … from 'fs' | import 'fs' | import('fs') | require('fs') | process.binding / getBuiltinModule
  `(?:from\\s*|import\\s*\\(\\s*|import\\s+|require\\s*\\(\\s*|getBuiltinModule\\s*\\(\\s*)['"\`](?:node:)?(?:${moduleAlternation})['"\`]`,
);
const DYNAMIC_CODE_RE = /\beval\s*\(|\bnew\s+Function\s*\(|\bprocess\s*\.\s*binding\s*\(/;
/** A dynamic import or require whose target is not a string literal cannot be vouched for. */
const NON_LITERAL_LOAD_RE = /\b(?:import|require)\s*\(\s*(?!['"`])/;

/**
 * @param {{ path: string, source: string }[]} files  source files under api/
 * @returns {string[]} problems
 */
export function findRuntimeWriteCapability(files) {
  const problems = [];
  for (const f of files) {
    const code = stripComments(f.source);
    const imp = code.match(FORBIDDEN_IMPORT_RE);
    if (imp) problems.push(`${f.path}: loads a filesystem/process module (${imp[0].replace(/\s+/g, ' ').trim()}) — nothing under api/ may be able to write a file or start a process`);
    if (DYNAMIC_CODE_RE.test(code)) problems.push(`${f.path}: uses eval / new Function / process.binding — code that builds code cannot be vouched for`);
    if (NON_LITERAL_LOAD_RE.test(code)) problems.push(`${f.path}: loads a module whose name is computed at runtime — only string-literal imports can be checked`);
  }
  return problems;
}

/** Identifiers that govern behaviour. Declared once, const, and never written to. */
export const GOVERNING_IDENTIFIERS = Object.freeze([
  'CMS_RULESET_2026', 'CMS_RULESET_2027', 'CMS_RULESET_2028', 'RULESETS', 'STATE_RULESETS',
  'GRANDFATHERED_RULESET_VERSIONS', 'RULESET_LIFECYCLE',
  'SOA_TEXT', 'SOA_CATEGORIES', 'TPMO_DISCLAIMER_CONFIG', 'LANGUAGE_SOURCE', 'SOA_METHOD',
  'CARRIER_OVERLAYS', 'MEDICARE_KNOWLEDGE', 'SYSTEM_PROMPT',
  'CANDIDATE_KINDS', 'LEARNING_PIPELINE',
]);

/**
 * @param {{ path: string, source: string }[]} files  source files under api/ and src/
 * @returns {string[]} problems
 */
export function findGoverningMutation(files, identifiers = GOVERNING_IDENTIFIERS) {
  const problems = [];
  for (const f of files) {
    const code = stripComments(f.source);
    for (const id of identifiers) {
      if (!code.includes(id)) continue;
      const esc = id.replace(/[$]/g, '\\$');
      // (a) declared with let/var
      if (new RegExp(`\\b(?:let|var)\\s+${esc}\\b`).test(code)) {
        problems.push(`${f.path}: ${id} is declared with let/var — a governing artefact must be const`);
      }
      // (b) assigned to: `ID = …`, `ID += …`, `ID.x = …`, `ID['x'] = …` — but not its own `const ID = …` declaration
      const assign = new RegExp(`(^|[^\\w.$])${esc}((?:\\s*\\.\\s*[\\w$]+|\\s*\\[[^\\]]*\\])*)\\s*(?:[+\\-*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?![=>])`, 'g');
      for (const m of code.matchAll(assign)) {
        const before = code.slice(Math.max(0, m.index - 24), m.index + m[1].length);
        if (m[2] === '' && /\b(?:const|export\s+const)\s+$/.test(before)) continue;
        problems.push(`${f.path}: writes to ${id}${m[2].replace(/\s+/g, '')} — a governing artefact is never assigned at runtime`);
      }
      // (c) mutated through a method or a helper
      const mutate = new RegExp(
        `(?:(?:^|[^\\w.$])${esc}(?:\\s*\\.\\s*[\\w$]+|\\s*\\[[^\\]]*\\])*\\s*\\.\\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear)\\s*\\()` +
          `|(?:Object\\s*\\.\\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)\\s*\\(\\s*${esc}\\b)` +
          `|(?:Reflect\\s*\\.\\s*(?:set|defineProperty|deleteProperty)\\s*\\(\\s*${esc}\\b)` +
          `|(?:\\bdelete\\s+${esc}\\b)`,
      );
      if (mutate.test(code)) problems.push(`${f.path}: mutates ${id} in place — a governing artefact is never changed at runtime`);
    }
  }
  return problems;
}

/** Every path from `value` that is not frozen. Empty means frozen all the way down. */
export function unfrozenPaths(value, name, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out = [];
  if (!Object.isFrozen(value)) out.push(name);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d && 'value' in d) out.push(...unfrozenPaths(d.value, `${name}.${String(key)}`, seen));
  }
  return out;
}

/** Collect source files under a directory (relative to ROOT). */
function walk(dir, exts, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir + '/' + name;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, exts, out);
    else if (exts.some((e) => name.endsWith(e)) && !name.endsWith('.d.ts')) out.push({ path: rel, source: readFileSync(join(ROOT, rel), 'utf8') });
  }
  return out;
}

/** The objects that must be frozen at load, by module. Imported lazily so the pure functions above stay importable anywhere. */
async function governingObjects() {
  const load = (p) => import(pathToFileURL(join(ROOT, p)).href);
  const [rulesets, lifecycle, states, text, tpmo, instance, learning] = await Promise.all([
    load('api/_lib/cy2027/rulesets.js'),
    load('api/_lib/cy2027/ruleset-lifecycle.js'),
    load('api/_lib/cy2027/state-rules.js'),
    load('api/_lib/cy2027/soa-text.js'),
    load('api/_lib/cy2027/tpmo.js'),
    load('api/_lib/cy2027/soa-instance.js'),
    load('api/_lib/cy2027/learning.js'),
  ]);
  return {
    CMS_RULESET_2026: rulesets.CMS_RULESET_2026,
    CMS_RULESET_2027: rulesets.CMS_RULESET_2027,
    CMS_RULESET_2028: rulesets.CMS_RULESET_2028,
    RULESET_LIFECYCLE: lifecycle.RULESET_LIFECYCLE,
    GRANDFATHERED_RULESET_VERSIONS: lifecycle.GRANDFATHERED_RULESET_VERSIONS,
    STATE_RULESETS: states.STATE_RULESETS,
    SOA_TEXT: text.SOA_TEXT,
    SOA_CATEGORIES: text.SOA_CATEGORIES,
    TPMO_DISCLAIMER_CONFIG: tpmo.TPMO_DISCLAIMER_CONFIG,
    LANGUAGE_SOURCE: instance.LANGUAGE_SOURCE,
    SOA_METHOD: instance.SOA_METHOD,
    CANDIDATE_KINDS: learning.CANDIDATE_KINDS,
    LEARNING_PIPELINE: learning.LEARNING_PIPELINE,
  };
}

/**
 * Run the three checks against this repository.
 *
 * `overrides` lets the suite hand the gate a tree that CONTAINS a defect. The
 * repository itself is clean, so without it the only thing ever observed would
 * be the gate passing — and a gate nobody has seen fail is not a gate.
 */
export async function runGate(overrides = {}) {
  const apiFiles = overrides.apiFiles || walk('api', ['.js', '.mjs', '.ts']);
  const srcFiles = overrides.srcFiles || walk('src', ['.ts', '.tsx', '.js']);
  const problems = [
    ...findRuntimeWriteCapability(apiFiles),
    ...findGoverningMutation([...apiFiles, ...srcFiles]),
  ];
  const objects = overrides.objects || await governingObjects();
  let frozenCount = 0;
  for (const [name, value] of Object.entries(objects)) {
    if (value === undefined) { problems.push(`${name} is no longer exported — the gate has nothing to check, which is itself a failure`); continue; }
    const loose = unfrozenPaths(value, name);
    if (loose.length) problems.push(`${name} is not frozen all the way down: ${loose.slice(0, 6).join(', ')}${loose.length > 6 ? ` (+${loose.length - 6} more)` : ''}`);
    else frozenCount += 1;
  }
  // A check that finds nothing to check has failed.
  if (!overrides.apiFiles && apiFiles.length < 10) problems.push(`only ${apiFiles.length} files found under api/ — the walk is broken`);
  if (!overrides.srcFiles && srcFiles.length < 20) problems.push(`only ${srcFiles.length} files found under src/ — the walk is broken`);
  if (Object.keys(objects).length === 0) problems.push('no governing object was checked for freezing — the gate has nothing to vouch for');
  return { problems, apiFiles: apiFiles.length, srcFiles: srcFiles.length, frozenCount, objectCount: Object.keys(objects).length };
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const r = await runGate();
  if (r.problems.length) {
    console.error(`[self-modification] FAILED — ${r.problems.length} problem(s):\n`);
    for (const p of r.problems) console.error('  ' + p);
    console.error('\n  Spec §23: no production self-modification. Spec §33 lists it as an immediate fail.');
    process.exit(1);
  }
  console.log(
    `[self-modification] OK — ${r.apiFiles} files under api/ load no filesystem or process module; ` +
      `${r.frozenCount}/${r.objectCount} governing objects are frozen all the way down; ` +
      `no runtime write to them in ${r.apiFiles + r.srcFiles} source files.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NO PRODUCTION SELF-MODIFICATION — the rules of the build gate (spec §23, §33).
// The command line lives in ./check-no-self-modification.mjs; everything it
// decides is decided here, so the suite can call each rule with a defect in hand.
//
// AUDIT 2026-10-04 (red team, SPEC-23) — the first version of this gate read
// source as TEXT: a block-comment regex, then a line-comment regex, then greps.
// That failed in both directions on the real tree:
//   • a `//` comment containing `api/*.js` opened a "block comment" that
//     swallowed the next twenty lines, import statements included — a plain
//     `import … from 'node:fs'` after it passed the gate;
//   • `import('node:' + 'fs')` passed because the rule only looked at the first
//     character of the argument; `(0, eval)(x)`, `Function('…')`, an aliased
//     createRequire and `process['binding']` passed because the rule matched
//     call SHAPES;
//   • the prose of a prompt ("…plans require (but not all) a referral") was
//     read as a `require(` call and would have failed a deploy.
// The gate now PARSES every file (TypeScript's parser, already a build
// dependency) and judges syntax nodes. Comments, strings, templates and regular
// expressions are never mistaken for code, and code is never mistaken for them.
//
// The module rule is an ALLOW-list. A deny-list of six module names is what the
// red team walked around with node:sqlite, node:v8, fs-extra and a data: URL.
//
// WHAT THIS CANNOT PROVE, said plainly:
//   • It is a static and load-time check of THIS repository. It cannot see
//     GoHighLevel, where Emely's and Sofía's prompts live.
//   • It does not read node_modules: an allow-listed package is trusted as a
//     package (pdfkit and openai today).
//   • JavaScript lets a property be reached through a key computed at runtime
//     and then called through an alias. The gate refuses the direct forms
//     (a computed member that is called, `constructor`, `eval`, `Function`, any
//     use of `process` other than `process.env`); it cannot follow a value
//     through arbitrary data flow. For the governing artefacts that is why the
//     second control exists: they are frozen all the way down at load, so a
//     write through an alias throws instead of landing.
// ─────────────────────────────────────────────────────────────────────────────

import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const K = ts.SyntaxKind;

/** Extensions Node or the bundler would load as code. Everything under api/ with one of these is parsed. */
export const CODE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

function scriptKindFor(path) {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.(?:ts|mts|cts)$/i.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Parse one file. `syntaxErrors` is null when the parser cannot say (treated as a failure by every caller). */
function parse(path, source) {
  const sf = ts.createSourceFile(String(path), String(source), ts.ScriptTarget.Latest, true, scriptKindFor(String(path)));
  const diagnostics = sf.parseDiagnostics;
  return { sf, syntaxErrors: Array.isArray(diagnostics) ? diagnostics.length : null };
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const compact = (sf, node) => node.getText(sf).replace(/\s+/g, '');

/** Look through wrappers that do not change which value an expression denotes. */
function unwrap(node) {
  let n = node;
  while (n && (
    n.kind === K.ParenthesizedExpression || n.kind === K.NonNullExpression || n.kind === K.AsExpression ||
    n.kind === K.TypeAssertionExpression || n.kind === K.SatisfiesExpression
  )) n = n.expression;
  return n;
}

const isStringLike = (node) => !!node && (node.kind === K.StringLiteral || node.kind === K.NoSubstitutionTemplateLiteral);

// ── Comments, found by the parser ────────────────────────────────────────────

const isJsxContainer = (n) => !!n && (n.kind === K.JsxElement || n.kind === K.JsxFragment);

/** After these tokens the text that follows is JSX text, where `//` is not a comment. */
function canHaveTrailingTrivia(token) {
  const p = token.parent;
  if (token.kind === K.CloseBraceToken) return !(p && p.kind === K.JsxExpression && isJsxContainer(p.parent));
  if (token.kind === K.GreaterThanToken && p) {
    if (p.kind === K.JsxOpeningElement) return token.end !== p.end;
    if (p.kind === K.JsxOpeningFragment) return false;
    if (p.kind === K.JsxSelfClosingElement) return token.end !== p.end || !isJsxContainer(p.parent);
    if (p.kind === K.JsxClosingElement || p.kind === K.JsxClosingFragment) return !isJsxContainer(p.parent && p.parent.parent);
  }
  return true;
}

/**
 * Source text with its comments removed — and nothing else.
 *
 * The comment boundaries come from the parser's own token stream, so a `//` or
 * a `/*` inside a string, a template, a regular expression or JSX text is left
 * alone, and a `/*` inside a line comment does not open anything. A file that
 * does not parse throws: text nobody can tokenise cannot be scanned.
 *
 * `path` tells the parser what the text is (.tsx, .ts, .js…). Without one the
 * text is tried as TSX, then TypeScript, then JavaScript, and the first reading
 * with no syntax error is used.
 */
export function stripComments(source, path) {
  const candidates = path ? [path] : ['source.tsx', 'source.ts', 'source.js'];
  const parsed = candidates.map((p) => parse(p, source)).find((p) => p.syntaxErrors === 0);
  if (!parsed) throw new Error(`stripComments: ${path || 'the text'} does not parse — it cannot be scanned`);
  const { sf } = parsed;
  const text = sf.text;
  const ranges = new Map();
  const note = (pos, end) => { ranges.set(pos, end); };
  const visit = (node) => {
    if (node.kind >= K.FirstJSDocNode && node.kind <= K.LastJSDocNode) return;
    if (node.kind === K.JsxText) return;
    const children = node.getChildren(sf);
    if (children.length) { for (const child of children) visit(child); return; }
    ts.forEachLeadingCommentRange(text, node.pos, note);
    if (canHaveTrailingTrivia(node)) ts.forEachTrailingCommentRange(text, node.end, note);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of [...ranges.entries()].sort((a, b) => a[0] - b[0])) {
    if (pos < at) continue;
    out += text.slice(at, pos);
    at = end;
  }
  return out + text.slice(at);
}

/**
 * Every module a file loads, as written: static imports, re-exports,
 * `import()` and `require()`. A target that is not a single string literal is
 * reported as `null` — it has no name anyone can read.
 */
export function importSpecifiers(source, path = 'source.js') {
  const { sf, syntaxErrors } = parse(path, source);
  if (syntaxErrors !== 0) throw new Error(`importSpecifiers: ${path} does not parse`);
  const out = [];
  const visit = (node) => {
    if ((node.kind === K.ImportDeclaration || node.kind === K.ExportDeclaration) && node.moduleSpecifier) {
      out.push(isStringLike(node.moduleSpecifier) ? node.moduleSpecifier.text : null);
    } else if (node.kind === K.ImportEqualsDeclaration && node.moduleReference.kind === K.ExternalModuleReference) {
      out.push(isStringLike(node.moduleReference.expression) ? node.moduleReference.expression.text : null);
    } else if (node.kind === K.CallExpression) {
      const callee = unwrap(node.expression);
      if (callee.kind === K.ImportKeyword || (callee.kind === K.Identifier && callee.text === 'require')) {
        out.push(node.arguments.length === 1 && isStringLike(node.arguments[0]) ? node.arguments[0].text : null);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * How many times `name` is bound or written in a file: every declaration
 * (const/let/var, destructured or not, and parameters) plus every assignment to
 * it. A variable with exactly one source has a count of 1 — a fallback line
 * that assigns it again makes it 2, wherever that line is put.
 */
export function bindingsAndWrites(source, path, name) {
  const { sf, syntaxErrors } = parse(path, source);
  if (syntaxErrors !== 0) throw new Error(`bindingsAndWrites: ${path} does not parse`);
  let count = 0;
  const bound = (node) => {
    if (!node) return;
    if (node.kind === K.Identifier) { if (node.text === name) count += 1; return; }
    if (node.kind === K.ObjectBindingPattern || node.kind === K.ArrayBindingPattern) {
      for (const e of node.elements) if (e.kind === K.BindingElement) bound(e.name);
    }
  };
  const written = (target) => {
    const n = unwrap(target);
    if (!n) return;
    if (n.kind === K.Identifier) { if (n.text === name) count += 1; return; }
    if (n.kind === K.ArrayLiteralExpression) { for (const e of n.elements) written(e.kind === K.SpreadElement ? e.expression : e); return; }
    if (n.kind === K.ObjectLiteralExpression) {
      for (const p of n.properties) {
        if (p.kind === K.PropertyAssignment) written(p.initializer);
        else if (p.kind === K.ShorthandPropertyAssignment) written(p.name);
        else if (p.kind === K.SpreadAssignment) written(p.expression);
      }
      return;
    }
    if (n.kind === K.BinaryExpression && n.operatorToken.kind === K.EqualsToken) written(n.left);
  };
  const visit = (node) => {
    if (node.kind === K.VariableDeclaration || node.kind === K.Parameter) bound(node.name);
    else if (node.kind === K.BinaryExpression && node.operatorToken.kind >= K.FirstAssignment && node.operatorToken.kind <= K.LastAssignment) written(node.left);
    else if ((node.kind === K.PrefixUnaryExpression || node.kind === K.PostfixUnaryExpression) &&
      (node.operator === K.PlusPlusToken || node.operator === K.MinusMinusToken)) written(node.operand);
    else if ((node.kind === K.ForInStatement || node.kind === K.ForOfStatement) && node.initializer.kind !== K.VariableDeclarationList) written(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/** Every identifier a file mentions in code (never in a comment or a string), with how often. */
export function identifierCounts(source, path) {
  const { sf, syntaxErrors } = parse(path, source);
  if (syntaxErrors !== 0) throw new Error(`identifierCounts: ${path} does not parse`);
  const counts = new Map();
  const visit = (node) => {
    if (node.kind === K.Identifier) counts.set(node.text, (counts.get(node.text) || 0) + 1);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return counts;
}

/**
 * The statements a file runs at its top level, in order, as written (white
 * space collapsed). A statement inside a block, a branch, a loop or a function
 * is NOT in this list — which is the point: `if (false) { … }` around a
 * statement removes it from here.
 */
export function topLevelStatements(source, path) {
  const { sf, syntaxErrors } = parse(path, source);
  if (syntaxErrors !== 0) throw new Error(`topLevelStatements: ${path} does not parse`);
  return sf.statements.map((s) => s.getText(sf).replace(/\s+/g, ' ').trim());
}

// ── 1. Nothing under api/ can write a file, start a process or build code ────

/** The modules code under api/ may load, besides its own files under api/. Closed: a new one is a reviewed change here. */
export const ALLOWED_MODULES = Object.freeze(['node:crypto', 'openai', 'pdfkit']);

/** Named so the refusal can say what the module is for. Refusal itself comes from not being on the list above. */
export const FILESYSTEM_OR_PROCESS_MODULES = Object.freeze(['fs', 'fs/promises', 'child_process', 'worker_threads', 'vm', 'cluster']);

/** Names that reach code-building or module-loading machinery, refused wherever they appear — as a reference or as a member. */
export const FORBIDDEN_NAMES = Object.freeze([
  'eval', 'Function', 'require', 'createRequire', 'getBuiltinModule', 'binding', '_linkedBinding', 'dlopen',
  'mainModule', 'writeReport', '_load', 'constructor',
]);

/** Globals through which any of the above can be reached by name. Refused as references. */
export const FORBIDDEN_GLOBALS = Object.freeze(['globalThis', 'global', 'module', '__filename', '__dirname']);

/** Why a module specifier may not be loaded from `fromPath` — or null. */
export function specifierProblem(specifier, fromPath) {
  const bare = specifier.replace(/^node:/, '');
  if (FILESYSTEM_OR_PROCESS_MODULES.includes(bare)) {
    return `loads a filesystem/process module ('${specifier}') — nothing under api/ may be able to write a file or start a process`;
  }
  if (ALLOWED_MODULES.includes(specifier)) return null;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const resolved = posix.normalize(posix.join(posix.dirname(String(fromPath).replace(/\\/g, '/')), specifier));
    if (!resolved.startsWith('api/') || resolved.split('/').includes('node_modules')) {
      return `imports '${specifier}', which resolves outside api/ (${resolved}) — code under api/ loads only its own files and the allow-listed modules`;
    }
    return null;
  }
  return `imports '${specifier}', which is not on the allow-list (${ALLOWED_MODULES.join(', ')}) — a new module under api/ is a reviewed change to ALLOWED_MODULES`;
}

const isReferencePosition = (node) => {
  const p = node.parent;
  if (!p) return true;
  if (p.kind === K.PropertyAccessExpression && p.name === node) return false;
  if ((p.kind === K.PropertyAssignment || p.kind === K.MethodDeclaration || p.kind === K.PropertySignature ||
       p.kind === K.PropertyDeclaration || p.kind === K.GetAccessor || p.kind === K.SetAccessor) && p.name === node) return false;
  return true;
};

/**
 * @param {{ path: string, source: string }[]} files  every code file under api/
 * @returns {string[]} problems
 */
export function findRuntimeWriteCapability(files) {
  const problems = [];
  for (const f of files) {
    const { sf, syntaxErrors } = parse(f.path, f.source);
    if (syntaxErrors !== 0) {
      problems.push(`${f.path}: does not parse (${syntaxErrors === null ? 'parser gave no verdict' : syntaxErrors + ' syntax error(s)'}) — a file the gate cannot read cannot be vouched for`);
      continue;
    }
    const say = (node, message) => problems.push(`${f.path}: ${message} (line ${lineOf(sf, node)})`);
    const checkTarget = (node, argument, what) => {
      if (!isStringLike(argument)) {
        say(node, `loads a module whose name is computed at runtime (${what}) — only a single string literal can be checked`);
        return;
      }
      const problem = specifierProblem(argument.text, f.path);
      if (problem) say(node, problem);
    };
    const visit = (node) => {
      if ((node.kind === K.ImportDeclaration || node.kind === K.ExportDeclaration) && node.moduleSpecifier) {
        checkTarget(node, node.moduleSpecifier, 'import');
      } else if (node.kind === K.ImportEqualsDeclaration) {
        say(node, 'uses `import x = require(…)` — code under api/ is ES modules with literal imports');
      } else if (node.kind === K.CallExpression || node.kind === K.NewExpression) {
        const callee = unwrap(node.expression);
        if (callee.kind === K.ImportKeyword) {
          if (node.arguments.length !== 1) say(node, 'loads a module whose name is computed at runtime (import() with options) — only a single string literal can be checked');
          else checkTarget(node, node.arguments[0], 'import()');
        } else if (callee.kind === K.ElementAccessExpression) {
          const key = unwrap(callee.argumentExpression);
          if (!isStringLike(key) && !(key && key.kind === K.NumericLiteral)) {
            say(node, `calls a member chosen at runtime (${compact(sf, callee).slice(0, 60)}) — what it calls cannot be read from the source`);
          }
        }
      } else if (node.kind === K.Identifier) {
        if (FORBIDDEN_NAMES.includes(node.text)) {
          say(node, `uses \`${node.text}\` — eval / Function / require / process internals build or load code that cannot be vouched for`);
        } else if (FORBIDDEN_GLOBALS.includes(node.text) && isReferencePosition(node)) {
          say(node, `uses the global \`${node.text}\` — anything can be reached through it by name`);
        } else if (node.text === 'process') {
          const p = node.parent;
          const readsEnv = p && p.kind === K.PropertyAccessExpression && p.expression === node && p.name.text === 'env';
          const isTypeof = p && p.kind === K.TypeOfExpression;
          if (!readsEnv && !isTypeof) say(node, 'uses `process` other than as `process.env` — binding, mainModule, report and getBuiltinModule all hang off it');
        }
      } else if (node.kind === K.ElementAccessExpression) {
        const key = unwrap(node.argumentExpression);
        if (isStringLike(key) && FORBIDDEN_NAMES.includes(key.text)) {
          say(node, `uses \`['${key.text}']\` — eval / Function / require / process internals build or load code that cannot be vouched for`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return problems;
}

// ── 2. The governing artefacts are never written to in source ────────────────

/** Identifiers that govern behaviour. Declared once, const, at module scope, and never written to. */
export const GOVERNING_IDENTIFIERS = Object.freeze([
  'CMS_RULESET_2026', 'CMS_RULESET_2027', 'CMS_RULESET_2028', 'RULESETS', 'STATE_RULESETS',
  'GRANDFATHERED_RULESET_VERSIONS', 'RULESET_LIFECYCLE',
  'SOA_TEXT', 'SOA_CATEGORIES', 'TPMO_DISCLAIMER_CONFIG', 'LANGUAGE_SOURCE', 'SOA_METHOD',
  // AUDIT 2026-10-04 (EV-09, WVG-11) — the vocabulary activeSoaInstance() refuses
  // with decides whether an appointment has an active SOA at all.
  'SOA_SCOPE_PROBLEM',
  // AUDIT 2026-10-04 (WVG-11, red team) — the outcome stamped on a consumed
  // signing link decides whether the status endpoint says "already signed" or
  // "used, nothing filed — restart"; only its FILED value may claim a signature.
  'LINK_OUTCOME',
  'CARRIER_OVERLAYS', 'MEDICARE_KNOWLEDGE', 'SYSTEM_PROMPT',
  'CANDIDATE_KINDS', 'LEARNING_PIPELINE', 'LEARNING_REJECTION_REASONS', 'AUTOMATED_OBSERVATIONS',
  // AUDIT 2026-10-04 (FTQ-11 / FTQ-15, red team) — the data-quality tables
  // govern a review signal and a tag refusal, and were not registered here:
  // an unfrozen DISPOSABLE_EMAIL_DOMAINS passed the gate ("15/15").
  'DISPOSABLE_EMAIL_DOMAINS', 'REVIEW_INCONSISTENCY_KINDS', 'VERDICT_TAG_VOCABULARY', 'TAG_REFUSAL_REASONS',
  // AUDIT 2026-10-04 (CBF-10, red team) — the knowledge release ledger, its
  // states, the current release and the provenance record the handler stamps
  // on every reply govern what an audit record may claim, and were registered
  // only in a test suite the artifact does not ship: KNOWLEDGE_RELEASES.push(…)
  // from a new api/_lib module and an unfrozen ledger both passed this gate ("19/19").
  'KNOWLEDGE_RELEASES', 'KNOWLEDGE_STATUS', 'MEDICARE_KNOWLEDGE_RELEASE', 'KB_PROVENANCE',
  // AUDIT 2026-10-04 (SPEC-12) — the one-time-code policy (the caps that are
  // the SMS-bombing control, the code lifetime) and the verification letter
  // (customer-facing text carried with its approval status) govern what a
  // handler may send and what staff may mail; neither may be edited in memory.
  'OTP_POLICY', 'VERIFICATION_LETTER',
  // AUDIT 2026-10-04 (CRM-29, red team) — the CRM field registry decides which
  // GoHighLevel id every consent write and every revocation goes to, which
  // configured id is refused, which field may only hold a confirmed value and
  // which may only hold a self-report, and what a provisioning run may create.
  // None of it was registered here: a registry entry, the legacy list and the
  // problem vocabulary left unfrozen all passed this gate ("23/23").
  'CY2027_FIELD_KEYS', 'EXISTING_CRM_FIELDS', 'LEGACY_SOA_NAME_FIELDS', 'PRODUCTION_FIELD_IDS', 'FIELD_ID_REFUSAL',
  'CONFIRMED_ONLY_FIELDS', 'PROVENANCE', 'SELF_REPORTED_ONLY_FIELDS', 'SELF_REPORT_VALUE', 'CONFIRMING_PROVENANCE',
  'REGISTRY_PROBLEM', 'PROVISIONING_REFUSAL',
]);

const MUTATING_METHODS = Object.freeze(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear']);
const OBJECT_MUTATORS = Object.freeze(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);
const REFLECT_MUTATORS = Object.freeze(['set', 'defineProperty', 'deleteProperty', 'setPrototypeOf']);

const isAssignmentOperator = (kind) => kind >= K.FirstAssignment && kind <= K.LastAssignment;

/** The name a member access reads, when it is written in the source (`.x`, `?.x`, `['x']`). */
function memberName(node) {
  if (node.kind === K.PropertyAccessExpression) return node.name.text;
  if (node.kind === K.ElementAccessExpression && isStringLike(unwrap(node.argumentExpression))) return unwrap(node.argumentExpression).text;
  return null;
}

/**
 * @param {{ path: string, source: string }[]} files  source files under api/ and src/
 * @returns {string[]} problems
 */
export function findGoverningMutation(files, identifiers = GOVERNING_IDENTIFIERS) {
  const problems = [];
  const governs = (name) => identifiers.includes(name);
  for (const f of files) {
    if (!identifiers.some((id) => String(f.source).includes(id))) continue;
    const { sf, syntaxErrors } = parse(f.path, f.source);
    if (syntaxErrors !== 0) {
      problems.push(`${f.path}: names a governing artefact and does not parse — it cannot be vouched for`);
      continue;
    }
    /** The governing identifier an expression is rooted at (`ID`, `ID.a.b`, `ID['a']`, `(ID as T).a`) — or null. */
    const rootOf = (expression) => {
      let n = unwrap(expression);
      while (n && (n.kind === K.PropertyAccessExpression || n.kind === K.ElementAccessExpression)) n = unwrap(n.expression);
      return n && n.kind === K.Identifier && governs(n.text) ? n.text : null;
    };
    /** Every place a destructuring pattern, or a plain target, writes to. */
    const writeTargets = (target, out = []) => {
      const n = unwrap(target);
      if (!n) return out;
      if (n.kind === K.ArrayLiteralExpression) { for (const e of n.elements) writeTargets(e, out); return out; }
      if (n.kind === K.ObjectLiteralExpression) {
        for (const p of n.properties) {
          if (p.kind === K.PropertyAssignment) writeTargets(p.initializer, out);
          else if (p.kind === K.ShorthandPropertyAssignment) out.push(p.name);
          else if (p.kind === K.SpreadAssignment) writeTargets(p.expression, out);
        }
        return out;
      }
      if (n.kind === K.SpreadElement) return writeTargets(n.expression, out);
      if (n.kind === K.BinaryExpression && n.operatorToken.kind === K.EqualsToken) return writeTargets(n.left, out);
      out.push(n);
      return out;
    };
    const reportWrites = (target) => {
      for (const t of writeTargets(target)) {
        const id = rootOf(t);
        if (id) problems.push(`${f.path}: writes to ${compact(sf, t)} — a governing artefact is never assigned at runtime (line ${lineOf(sf, t)})`);
      }
    };
    const mutated = (node, id) => problems.push(`${f.path}: mutates ${id} in place — a governing artefact is never changed at runtime (line ${lineOf(sf, node)})`);
    const redeclared = (node, id, how) => problems.push(`${f.path}: ${id} is ${how} — a governing artefact is one const at module scope (line ${lineOf(sf, node)})`);

    const visit = (node) => {
      switch (node.kind) {
        case K.VariableDeclaration: {
          const list = node.parent;
          const isConst = !!list && list.kind === K.VariableDeclarationList && (list.flags & ts.NodeFlags.Const) !== 0;
          const names = [];
          const collect = (name) => {
            if (name.kind === K.Identifier) names.push(name);
            else for (const e of name.elements) if (e.kind === K.BindingElement) collect(e.name);
          };
          collect(node.name);
          for (const name of names) {
            if (!governs(name.text)) continue;
            if (!isConst) redeclared(name, name.text, 'declared with let/var');
            else if (!(list.parent && list.parent.kind === K.VariableStatement && list.parent.parent === sf)) {
              redeclared(name, name.text, 'declared again inside a function or block, shadowing the real one');
            }
          }
          break;
        }
        case K.FunctionDeclaration: case K.ClassDeclaration: case K.FunctionExpression: case K.ClassExpression:
          if (node.name && governs(node.name.text)) redeclared(node.name, node.name.text, 'declared as a function or class');
          break;
        case K.Parameter:
          if (node.name.kind === K.Identifier && governs(node.name.text)) redeclared(node.name, node.name.text, 'used as a parameter name, shadowing the real one');
          break;
        case K.ImportSpecifier:
          if (node.propertyName && governs(node.name.text) && node.propertyName.text !== node.name.text) {
            redeclared(node.name, node.name.text, `the local name of a different import (${node.propertyName.text})`);
          }
          break;
        case K.BinaryExpression:
          if (isAssignmentOperator(node.operatorToken.kind)) reportWrites(node.left);
          break;
        case K.PrefixUnaryExpression: case K.PostfixUnaryExpression:
          if (node.operator === K.PlusPlusToken || node.operator === K.MinusMinusToken) reportWrites(node.operand);
          break;
        case K.ForInStatement: case K.ForOfStatement:
          if (node.initializer.kind !== K.VariableDeclarationList) reportWrites(node.initializer);
          break;
        case K.DeleteExpression: {
          const id = rootOf(node.expression);
          if (id) mutated(node, id);
          break;
        }
        case K.CallExpression: {
          const callee = unwrap(node.expression);
          if (callee.kind !== K.PropertyAccessExpression && callee.kind !== K.ElementAccessExpression) break;
          const method = memberName(callee);
          const owner = unwrap(callee.expression);
          const first = node.arguments.length ? rootOf(node.arguments[0]) : null;
          const second = node.arguments.length > 1 ? rootOf(node.arguments[1]) : null;
          // ID.push(…), ID.a['b']?.splice(…)
          if (method && MUTATING_METHODS.includes(method) && rootOf(owner)) mutated(node, rootOf(owner));
          // Object.assign(ID, …), Reflect.set(ID.a, …)
          else if (owner.kind === K.Identifier && owner.text === 'Object' && OBJECT_MUTATORS.includes(method) && first) mutated(node, first);
          else if (owner.kind === K.Identifier && owner.text === 'Reflect' && REFLECT_MUTATORS.includes(method) && first) mutated(node, first);
          // Array.prototype.push.call(ID, …) / .apply(ID, […]) / Reflect.apply(fn, ID, […])
          else if ((method === 'call' || method === 'apply') && first && MUTATING_METHODS.includes(memberName(owner) || '')) mutated(node, first);
          else if (owner.kind === K.Identifier && owner.text === 'Reflect' && method === 'apply' && second) mutated(node, second);
          break;
        }
        default:
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return problems;
}

// ── 3. The governing artefacts are frozen all the way down ───────────────────

/** Every path from `value` that is not frozen plain data. Empty means frozen all the way down. */
export function unfrozenPaths(value, name, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out = [];
  if (!Object.isFrozen(value)) out.push(name);
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d) continue;
    if ('value' in d) out.push(...unfrozenPaths(d.value, `${name}.${String(key)}`, seen));
    // A getter answers whatever it likes on each read: it is not frozen data.
    else out.push(`${name}.${String(key)} (accessor)`);
  }
  return out;
}

// ── Walking a tree ───────────────────────────────────────────────────────────

/**
 * Every file under `dir`. `code` holds the ones Node or the bundler would run,
 * `other` the rest (declaration files excluded) — under api/ the rest is a
 * failure, because a file the gate does not read is a file it cannot vouch for.
 */
export function walkTree(root, dir, out = { code: [], other: [] }) {
  for (const name of readdirSync(join(root, dir)).sort()) {
    const rel = dir + '/' + name;
    if (statSync(join(root, rel)).isDirectory()) { walkTree(root, rel, out); continue; }
    if (/\.d\.[cm]?ts$/i.test(name)) continue;
    if (CODE_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e))) out.code.push({ path: rel, source: readFileSync(join(root, rel), 'utf8') });
    else out.other.push(rel);
  }
  return out;
}

/** The objects that must be frozen at load, by module. */
async function governingObjects(root) {
  const load = (p) => import(pathToFileURL(join(root, p)).href);
  const [rulesets, lifecycle, states, text, tpmo, instance, learning, quality, knowledge, crm, link, otp, oob] = await Promise.all([
    load('api/_lib/cy2027/rulesets.js'),
    load('api/_lib/cy2027/ruleset-lifecycle.js'),
    load('api/_lib/cy2027/state-rules.js'),
    load('api/_lib/cy2027/soa-text.js'),
    load('api/_lib/cy2027/tpmo.js'),
    load('api/_lib/cy2027/soa-instance.js'),
    load('api/_lib/cy2027/learning.js'),
    load('api/_lib/cy2027/data-quality.js'),
    load('api/_lib/medicare-knowledge.js'),
    load('api/_lib/cy2027/crm-fields.js'),
    load('api/_lib/cy2027/secure-link.js'),
    load('api/_lib/cy2027/otp.js'),
    load('api/_lib/cy2027/out-of-band-verification.js'),
  ]);
  // AUDIT 2026-10-04 (CBF-10, red team) — see GOVERNING_IDENTIFIERS. KB_PROVENANCE
  // is what api/chat.js holds from load: knowledgeProvenance(sha256 of the body
  // it serves). The same call is made here, because loading the handler itself
  // has side effects; the suite pins that the handler computes it this way.
  const bodyDigest = 'sha256:' + createHash('sha256').update(String(knowledge.MEDICARE_KNOWLEDGE), 'utf8').digest('hex');
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
    SOA_SCOPE_PROBLEM: instance.SOA_SCOPE_PROBLEM,
    // AUDIT 2026-10-04 (WVG-11, red team) — see GOVERNING_IDENTIFIERS.
    LINK_OUTCOME: link.LINK_OUTCOME,
    // AUDIT 2026-10-04 (SPEC-12) — see GOVERNING_IDENTIFIERS.
    OTP_POLICY: otp.OTP_POLICY,
    VERIFICATION_LETTER: oob.VERIFICATION_LETTER,
    CANDIDATE_KINDS: learning.CANDIDATE_KINDS,
    LEARNING_PIPELINE: learning.LEARNING_PIPELINE,
    LEARNING_REJECTION_REASONS: learning.LEARNING_REJECTION_REASONS,
    AUTOMATED_OBSERVATIONS: learning.AUTOMATED_OBSERVATIONS,
    // AUDIT 2026-10-04 (FTQ-11 / FTQ-15, red team) — see GOVERNING_IDENTIFIERS.
    DISPOSABLE_EMAIL_DOMAINS: quality.DISPOSABLE_EMAIL_DOMAINS,
    REVIEW_INCONSISTENCY_KINDS: quality.REVIEW_INCONSISTENCY_KINDS,
    VERDICT_TAG_VOCABULARY: quality.VERDICT_TAG_VOCABULARY,
    TAG_REFUSAL_REASONS: quality.TAG_REFUSAL_REASONS,
    KNOWLEDGE_RELEASES: knowledge.KNOWLEDGE_RELEASES,
    KNOWLEDGE_STATUS: knowledge.KNOWLEDGE_STATUS,
    MEDICARE_KNOWLEDGE_RELEASE: knowledge.MEDICARE_KNOWLEDGE_RELEASE,
    KB_PROVENANCE: typeof knowledge.knowledgeProvenance === 'function' ? knowledge.knowledgeProvenance(bodyDigest) : undefined,
    // AUDIT 2026-10-04 (CRM-29, red team) — see GOVERNING_IDENTIFIERS.
    CY2027_FIELD_KEYS: crm.CY2027_FIELD_KEYS,
    EXISTING_CRM_FIELDS: crm.EXISTING_CRM_FIELDS,
    LEGACY_SOA_NAME_FIELDS: crm.LEGACY_SOA_NAME_FIELDS,
    PRODUCTION_FIELD_IDS: crm.PRODUCTION_FIELD_IDS,
    FIELD_ID_REFUSAL: crm.FIELD_ID_REFUSAL,
    CONFIRMED_ONLY_FIELDS: crm.CONFIRMED_ONLY_FIELDS,
    PROVENANCE: crm.PROVENANCE,
    SELF_REPORTED_ONLY_FIELDS: crm.SELF_REPORTED_ONLY_FIELDS,
    SELF_REPORT_VALUE: crm.SELF_REPORT_VALUE,
    CONFIRMING_PROVENANCE: crm.CONFIRMING_PROVENANCE,
    REGISTRY_PROBLEM: crm.REGISTRY_PROBLEM,
    PROVISIONING_REFUSAL: crm.PROVISIONING_REFUSAL,
  };
}

/**
 * Run the three checks against a tree (this repository unless `root` says
 * otherwise).
 *
 * `overrides` lets the suite hand the gate a tree that CONTAINS a defect. The
 * repository itself is clean, so without it the only thing ever observed would
 * be the gate passing — and a gate nobody has seen fail is not a gate.
 */
export async function runGate(overrides = {}) {
  const root = overrides.root || REPO_ROOT;
  const problems = [];
  let apiFiles = overrides.apiFiles;
  if (!apiFiles) {
    const walked = walkTree(root, 'api');
    apiFiles = walked.code;
    for (const stray of walked.other) problems.push(`${stray}: is not a source file the gate can read — everything under api/ must be code it can parse`);
  }
  const srcFiles = overrides.srcFiles || walkTree(root, 'src').code;
  problems.push(...findRuntimeWriteCapability(apiFiles), ...findGoverningMutation([...apiFiles, ...srcFiles]));
  const objects = overrides.objects || await governingObjects(root);
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

/**
 * The command line. Returns the exit code; prints through `io`.
 *
 * `--root <dir>` points the gate at another tree. It exists so the suite can
 * run THIS command against a tree with a defect in it and see it fail; the
 * build invokes the gate with no argument (the suite pins that), and whenever
 * a root is given the banner says which tree was judged.
 */
export async function runCli(argv = [], io = console) {
  let root;
  if (argv.length === 2 && argv[0] === '--root' && argv[1]) root = argv[1];
  else if (argv.length !== 0) {
    io.error('[self-modification] FAILED — unknown arguments: ' + argv.join(' ') + '\n  usage: node scripts/check-no-self-modification.mjs [--root <dir>]');
    return 2;
  }
  const where = root ? ` (tree: ${root})` : '';
  let r;
  try {
    r = await runGate(root ? { root } : {});
  } catch (error) {
    io.error(`[self-modification] FAILED${where} — the gate could not run: ${error && error.message}`);
    return 1;
  }
  if (r.problems.length) {
    io.error(`[self-modification] FAILED${where} — ${r.problems.length} problem(s):\n`);
    for (const p of r.problems) io.error('  ' + p);
    io.error('\n  Spec §23: no production self-modification. Spec §33 lists it as an immediate fail.');
    return 1;
  }
  io.log(
    `[self-modification] OK${where} — ${r.apiFiles} files under api/ load only allow-listed modules and build no code; ` +
      `${r.frozenCount}/${r.objectCount} governing objects are frozen all the way down; ` +
      `no runtime write to them in ${r.apiFiles + r.srcFiles} source files.`,
  );
  return 0;
}

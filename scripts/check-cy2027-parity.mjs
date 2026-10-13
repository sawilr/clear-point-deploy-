#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CY2027 PARITY / CHANGE-CONTROL GUARD — runs in `npm run build`.
//
// The CY2027 layer has one canonical source (api/_lib/cy2027/). This guard is
// what keeps it canonical. It fails the build when:
//
//   1. The approved customer-facing SOA text changed without the pinned digest
//      being deliberately re-pinned in the same commit.
//   2. The CY2027 marketing-start instant diverges between the ruleset engine
//      and src/lib/tpmoConfig.ts.
//   3. The SOA_ENABLED mirrors disagree across the four files that carry one.
//   4. A .d.ts promises an export the .js does not have (client would get a
//      runtime undefined that TypeScript swore was there).
//   5. The approved category wording is copy-pasted somewhere else, which is
//      how the TPMO disclaimer ended up in three divergent versions.
//   6. The TPMO (e)(41) disclaimer exists outside its canonical module.
//   7. The contact-consent wording in src/lib/disclaimerVersion.ts is not,
//      byte for byte, the wording registered with its scope in
//      api/_lib/cy2027/consent.js — or a second copy of that wording exists
//      anywhere under src/, api/ or in index.html (CE-09 / CRM-15).
//   8. The Medicare knowledge body changed without a NEW release in its ledger,
//      a shipped release was re-pinned, or an outgoing body was not archived (CBF-10).
//
// Why a build guard and not a comment: the pre-existing comment in
// src/lib/soaContent.ts said the three TPMO sources "must be unified first",
// and they stayed un-unified for months. A comment is not a control.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// A STATIC import on purpose: scripts/check-vercel-config.mjs follows static
// relative imports to verify that every scripts/ file the build needs has its
// "!scripts/…" exception in .vercelignore. A dynamic import would hide this one.
import { consentWordingProblems, consentWordingCopyProblems } from './consent-wording-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const problems = [];
const notes = [];

// ── 1. Approved text digest ──────────────────────────────────────────────────
const soaText = await import('../api/_lib/cy2027/soa-text.js');
const computed = 'sha256:' + createHash('sha256').update(soaText.approvedTextPayload(), 'utf8').digest('hex');

if (soaText.APPROVED_TEXT_DIGEST === 'sha256:PENDING_FIRST_PIN') {
  problems.push(
    'APPROVED_TEXT_DIGEST is still the placeholder. Pin it in api/_lib/cy2027/soa-text.js:\n' +
      `      export const APPROVED_TEXT_DIGEST = '${computed}';`,
  );
} else if (soaText.APPROVED_TEXT_DIGEST !== computed) {
  problems.push(
    'The approved customer-facing SOA text CHANGED but APPROVED_TEXT_DIGEST was not re-pinned.\n' +
      `      pinned:   ${soaText.APPROVED_TEXT_DIGEST}\n` +
      `      computed: ${computed}\n` +
      '      This text is owner-approved compliance wording. If the change is intended and approved,\n' +
      '      re-pin the digest in the same commit so the edit is on the record.',
  );
} else {
  notes.push(`approved SOA text digest OK (${computed.slice(0, 23)}…)`);
}

// ── 2. CY2027 marketing-start instant ────────────────────────────────────────
// The TPMO module must DERIVE this from the ruleset engine, not restate it.
// A second Date.UTC(...) literal is how the two would silently drift apart on
// the one day of the year when the drift matters.
const rulesets = await import('../api/_lib/cy2027/rulesets.js');
const tpmo = await import('../api/_lib/cy2027/tpmo.js');
const tpmoJs = read('api/_lib/cy2027/tpmo.js');

if (/CY2027_MARKETING_START_UTC\s*=\s*Date\.UTC\(/.test(tpmoJs)) {
  problems.push(
    'api/_lib/cy2027/tpmo.js redefines CY2027_MARKETING_START_UTC with its own Date.UTC(...).\n' +
      '      It must import the value from ./rulesets.js so there is one instant, not two.',
  );
} else if (tpmo.CY2027_MARKETING_START_UTC !== rulesets.CY2027_MARKETING_START_UTC) {
  problems.push(
    'CY2027 marketing-start instant diverged at runtime:\n' +
      `      rulesets.js: ${new Date(rulesets.CY2027_MARKETING_START_UTC).toISOString()}\n` +
      `      tpmo.js:     ${new Date(tpmo.CY2027_MARKETING_START_UTC).toISOString()}`,
  );
} else {
  notes.push(`CY2027 marketing start has one source (${new Date(rulesets.CY2027_MARKETING_START_UTC).toISOString()})`);
}

// The client entry point must re-export, not re-declare.
const tpmoConfigSrc = read('src/lib/tpmoConfig.ts');
if (/^\s*export\s+(?:const|function)\s+(?:tpmoDisclaimerText|activeContractYearVariant|TPMO_DISCLAIMER_CONFIG)\b/m.test(tpmoConfigSrc)) {
  problems.push(
    'src/lib/tpmoConfig.ts declares its own copy of the TPMO logic again.\n' +
      '      It must stay a re-export of api/_lib/cy2027/tpmo.js.',
  );
} else {
  notes.push('src/lib/tpmoConfig.ts is a re-export, not a second implementation');
}

// ── 3. SOA_ENABLED mirrors ───────────────────────────────────────────────────
const MIRRORS = [
  'src/lib/soaContent.ts',
  'api/soa-token.js',
  'api/soa-status.js',
  'api/sign-soa.js',
];
// RED TEAM 2026-10-02 (PG-04, HIGH) — the first regex match won, so a COMMENT
// mentioning `SOA_ENABLED = false` above a real `SOA_ENABLED = true` satisfied
// the guard. Comments are stripped first, and EVERY declaration in a file must
// agree — a file with two is itself the bug.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const values = new Map();
for (const f of MIRRORS) {
  let txt;
  try { txt = read(f); } catch { problems.push(`SOA_ENABLED mirror missing: ${f}`); continue; }
  const decls = [...stripComments(txt).matchAll(/\bSOA_ENABLED\s*=\s*(true|false)\b/g)].map((m) => m[1] === 'true');
  if (!decls.length) { problems.push(`${f} no longer declares SOA_ENABLED = true|false (outside comments).`); continue; }
  if (new Set(decls).size > 1) { problems.push(`${f} declares SOA_ENABLED more than once, with different values.`); continue; }
  values.set(f, decls[0]);
}
const distinct = new Set(values.values());
if (distinct.size > 1) {
  problems.push(
    'SOA_ENABLED mirrors disagree — the UI and the API would take different branches:\n' +
      [...values].map(([f, v]) => `      ${v ? 'true ' : 'false'}  ${f}`).join('\n'),
  );
} else if (distinct.size === 1) {
  notes.push(`SOA_ENABLED agrees across ${values.size} files (${[...distinct][0]})`);
}

// ── 4. .d.ts promises vs .js reality ─────────────────────────────────────────
// RED TEAM 2026-10-02 (PG-07, HIGH) — this skipped tpmo.d.ts entirely, matched
// only `export declare const|function`, and then printed "4 declaration files
// match" unconditionally whether or not it had checked anything. A guard that
// reports success for work it did not do is worse than no guard.
const DECLARED = ['soa-text', 'state-rules', 'soa-instance', 'rulesets', 'tpmo', 'data-quality'];
let declChecked = 0;
for (const base of DECLARED) {
  let dts;
  try { dts = read(`api/_lib/cy2027/${base}.d.ts`); }
  catch { problems.push(`api/_lib/cy2027/${base}.d.ts is missing — the client would get no types for it.`); continue; }
  const mod = await import(`../api/_lib/cy2027/${base}.js`);
  const names = [
    ...[...dts.matchAll(/export\s+declare\s+(?:const|function|let|var|class)\s+(\w+)/g)].map((x) => x[1]),
    // `export { A, B } from …` / `export { A, B }` re-export forms.
    ...[...dts.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) =>
      m[1].split(',').map((s) => s.replace(/\bas\b[\s\S]*$/, '').trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))),
  ];
  const missing = [...new Set(names)].filter((n) => !(n in mod));
  if (missing.length) {
    problems.push(`${base}.d.ts declares exports that ${base}.js does not provide: ${missing.join(', ')}`);
  }
  declChecked++;
}
notes.push(`${declChecked}/${DECLARED.length} declaration files checked against their modules`);

// PG-06 — the approved-text digest covers soa-text.js, but soaTitle() prints a
// STATE NAME that lives in state-rules.js, and the per-state form/ruleset
// versions are printed on the evidence copy. Those are approved values too.
const stateMod = await import('../api/_lib/cy2027/state-rules.js');
const statePayload = JSON.stringify(
  Object.values(stateMod.STATE_RULESETS).map((s) => [s.code, s.name, s.nameEs, s.soaFormVersion, s.stateRulesetVersion]),
);
const STATE_DIGEST = 'sha256:' + createHash('sha256').update(statePayload, 'utf8').digest('hex');
const PINNED_STATE_DIGEST = 'sha256:313d59c760579fe1d3761ef450ea8991d23a07af4e7c64f7f39ffb53f3de06e0';
if (STATE_DIGEST !== PINNED_STATE_DIGEST) {
  problems.push(
    'The approved per-state values (state name, SOA_FORM_VERSION, STATE_RULESET_VERSION) changed.\n' +
      `      These print on the form and on the evidence copy. Re-pin deliberately:\n` +
      `      const PINNED_STATE_DIGEST = '${STATE_DIGEST}';`,
  );
} else {
  notes.push('approved per-state values digest OK');
}

// ── 4b. The architecture doc must describe the code that exists (SJ-11) ──────
// A doc that drifts from the data is worse than no doc: a future implementer
// trusts the table and ships the wrong SOA_FORM_VERSION on a signed document.
// Every state's three identifying values must appear verbatim in the doc.
{
  let doc;
  try { doc = read('docs/compliance/CY2027-ARCHITECTURE.md'); } catch { doc = null; }
  if (!doc) {
    // 2026-10-03 — .vercelignore excludes docs/ from the deployed artifact, and
    // this gate runs inside `npm run build`. As written, the FIRST Vercel build
    // of this branch would have failed here: locally the document exists, so the
    // defect was invisible until deploy. On Vercel the document is absent by
    // design and the comparison is skipped WITH A NOTE; anywhere else a missing
    // document is still a failure, so the check keeps its teeth where the
    // document is supposed to be.
    let docsExcludedOnVercel = false;
    try {
      docsExcludedOnVercel = read('.vercelignore').split(/\r?\n/).some((l) => /^docs\/?$/.test(l.trim()));
    } catch { /* no .vercelignore: nothing is excluded */ }
    // Any of Vercel's own build-time variables counts: VERCEL=1 is only present
    // when system variables are exposed to the build, which is a project setting.
    const onVercel = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
    if (onVercel && docsExcludedOnVercel) {
      notes.push('state table vs docs: skipped on Vercel (docs/ is not part of the deployed artifact)');
    } else {
      problems.push('docs/compliance/CY2027-ARCHITECTURE.md is missing — the state table has nothing to check against.');
    }
  } else {
    const missing = [];
    for (const s of Object.values(stateMod.STATE_RULESETS)) {
      if (!doc.includes(s.name)) missing.push(`${s.code} name "${s.name}"`);
      if (!doc.includes(s.soaFormVersion)) missing.push(`${s.code} ${s.soaFormVersion}`);
      if (!doc.includes(s.stateRulesetVersion)) missing.push(`${s.code} ${s.stateRulesetVersion}`);
    }
    if (missing.length) {
      problems.push(
        'docs/compliance/CY2027-ARCHITECTURE.md no longer matches api/_lib/cy2027/state-rules.js.\n' +
          '      Missing from the doc: ' + missing.join(', ') + '\n' +
          '      These versions print on a signed document; the doc is what a future implementer reads.',
      );
    } else {
      notes.push(`architecture doc matches all ${Object.keys(stateMod.STATE_RULESETS).length} state rulesets`);
    }
  }
}

// ── 4c. The static shell's disclaimer must track the plan year (TPY-07) ──────
// index.html is a static file: it cannot import tpmoConfig, so its <noscript>
// copy of the (e)(41) sentence is necessarily a literal. Today it happens to
// carry the CY2027 wording, but nothing tied it to the config — it would have
// been silently wrong on the next cut-over, in the one surface a JavaScript-less
// visitor sees. It cannot import the source, so the BUILD compares them.
{
  let shell;
  try { shell = read('index.html'); } catch { shell = null; }
  if (!shell) {
    problems.push('index.html is missing — the noscript disclaimer cannot be checked.');
  } else if (!shell.includes('do not offer every plan available in your area')) {
    problems.push('index.html no longer carries the (e)(41) disclaimer in its <noscript> block.');
  } else {
    // 2026-10-03 — both languages. The shell is served for /es routes too, and
    // for the routes that are not body-prerendered (/es/soa, /es/thank-you) this
    // block is the ONLY disclaimer in the HTML: it was English on a Spanish page.
    let bad = 0;
    for (const [lang, opening] of [['en', /We do not offer every plan[^<]{0,200}/], ['es', /No ofrecemos todos los planes[^<]{0,220}/]]) {
      const expected = tpmo.tpmoDisclaimerText(lang);
      if (shell.includes(expected)) continue;
      bad += 1;
      const shown = (shell.match(opening) || ['(not found)'])[0];
      problems.push(
        `index.html's <noscript> disclaimer (${lang}) does not match the canonical sentence for the active plan year.\n` +
          `      expected: ${expected}\n` +
          `      found:    ${shown}\n` +
          '      A visitor without JavaScript sees only this copy. Update the literal in index.html.',
      );
    }
    if (!bad) notes.push('index.html noscript disclaimer matches the active plan-year wording (en + es)');
  }
}

// ── 5. Approved wording must not be copy-pasted ──────────────────────────────
// A distinctive fragment of each approved category description. If any of these
// appears outside the canonical module, a second copy is forming.
// RED TEAM 2026-10-02 (PG-05, HIGH) — this was a hand-written list covering 2 of
// the 4 approved category descriptions, so a divergent copy of the other two
// could be reintroduced unnoticed. The fragments are now DERIVED from the
// canonical module, so the guard automatically covers whatever it defines.
const FRAGMENTS = [
  ...soaText.SOA_CATEGORIES.flatMap((c) => [
    c.en.description.slice(-64),
    c.es.description.slice(-64),
    c.en.label,
    c.es.label,
  ]),
  soaText.SOA_TEXT.en.important.slice(-64),
  soaText.SOA_TEXT.es.important.slice(-64),
  soaText.SOA_TEXT.en.categoriesHelp.slice(0, 64),
  soaText.SOA_TEXT.es.categoriesHelp.slice(0, 64),
  soaText.SOA_TEXT.en.authorizationStatement.slice(0, 64),
];
const SEARCH_FILES = [
  'src/lib/soaContent.ts',
  'src/components/SOAForm.tsx',
  'api/sign-soa.js',
  'src/lib/soa.ts',
];
for (const f of SEARCH_FILES) {
  let txt;
  try { txt = read(f); } catch { continue; }
  // Scan CODE, not comments. A design note that quotes the approved wording to
  // explain why it exists is documentation; the thing being guarded against is
  // a second literal that can render and then diverge.
  txt = stripComments(txt);
  for (const frag of FRAGMENTS) {
    if (txt.includes(frag)) {
      problems.push(
        `${f} contains a copy of approved CY2027 SOA wording ("${frag.slice(0, 44)}…").\n` +
          '      Import it from api/_lib/cy2027/soa-text.js instead — that is the whole point of the canonical module.',
      );
    }
  }
}

// ── 6. TPMO disclaimer must live in exactly one place ────────────────────────
// Pre-existing defect this guard is meant to surface: the (e)(41) sentence
// exists in src/lib/tpmoConfig.ts (correct, variant-aware) AND as a second
// hardcoded copy with [X]/[Y] placeholders elsewhere.
const TPMO_FRAGMENT = 'We do not offer every plan available in your area';
const TPMO_ALLOWED = new Set(['api/_lib/cy2027/tpmo.js']);
const TPMO_CANDIDATES = [
  'api/_lib/cy2027/tpmo.js',
  'src/lib/tpmoConfig.ts',
  'src/lib/soaContent.ts',
  'api/sign-soa.js',
];
const tpmoCopies = [];
for (const f of TPMO_CANDIDATES) {
  let txt;
  try { txt = read(f); } catch { continue; }
  if (txt.includes(TPMO_FRAGMENT) && !TPMO_ALLOWED.has(f)) tpmoCopies.push(f);
}
// 2026-10-03 — the list above is four files. The chat engine carried EIGHT
// hand-written disclaimers (naming the SHIP, after the CY2027 cut-over) in a
// file that was never on the list, so "TPMO disclaimer has a single source"
// printed green while a fifth source was live. Every source file under src/ and
// api/ is now scanned, comments stripped, for the SENTENCE form of the
// disclaimer in either language. Prose that mentions the fact mid-sentence is
// not a disclaimer and does not match.
{
  const { readdirSync, statSync } = await import('node:fs');
  const SENTENCE_RE = /(?:do not offer every plan|no ofrecemos todos los planes)[^.,;:!?`'"]{0,40}\./i;
  const walk = (dir, out = []) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = dir + '/' + name;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
      else if (/\.(?:ts|tsx|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(rel);
    }
    return out;
  };
  let scanned = 0;
  for (const f of [...walk('src'), ...walk('api')]) {
    if (TPMO_ALLOWED.has(f)) continue;
    scanned += 1;
    if (SENTENCE_RE.test(stripComments(read(f))) && !tpmoCopies.includes(f)) tpmoCopies.push(f);
  }
  if (scanned < 50) problems.push(`TPMO single-source scan read only ${scanned} files — the walk is broken`);
}
// RED TEAM 2026-10-02 (PG-01, HIGH) — the fragment check only caught a copy that
// reused the exact opening sentence. A fourth copy written with a different
// lead-in but the same [X]/[Y] placeholders slipped through — and the
// placeholders are the actual hazard, because they are what reaches a signature.
// Narrowed to the actual hazard: a COUNT placeholder inside a TPMO sentence.
// A bare "[X] " is the PDF's checked-box glyph and is not a disclaimer defect.
const PLACEHOLDER_RE = /\[\s*[XY]\s*\]\s*(?:organizations?|organizaciones|products?|productos)|(?:represent|representamos)\s*\[\s*[XY]\s*\]/i;
for (const f of [...TPMO_CANDIDATES, 'src/components/SOAForm.tsx', 'src/lib/soa.ts', 'src/pages/SignSOA.tsx']) {
  if (TPMO_ALLOWED.has(f)) continue;
  let txt;
  try { txt = read(f); } catch { continue; }
  if (PLACEHOLDER_RE.test(stripComments(txt))) {
    problems.push(
      `${f} contains a bracketed TPMO count placeholder ([X]/[Y]) outside the canonical module.\n` +
        '      A signed disclaimer reading "[X] organizations" is an audit failure. Render the\n' +
        '      sentence from tpmoDisclaimerText() instead of restating it.',
    );
  }
}

if (tpmoCopies.length) {
  problems.push(
    'The TPMO (e)(41) disclaimer is duplicated outside src/lib/tpmoConfig.ts:\n' +
      tpmoCopies.map((f) => `      ${f}`).join('\n') +
      '\n      A signed disclaimer that disagrees with the rendered one is an audit failure.\n' +
      '      Render it from tpmoDisclaimerText() in src/lib/tpmoConfig.ts (client) or from the\n' +
      '      value passed in by the caller (server) — never from a second literal.',
  );
} else {
  notes.push('TPMO disclaimer has a single source');
}

// Every source file the deployed artifact is built from: src/, api/ and the
// static shell. Sections 7 and 8 scan this one list for a second copy of a
// controlled text, so neither can quietly cover fewer files than the other.
const { readdirSync, statSync } = await import('node:fs');
const walkSources = (dir, out = []) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir + '/' + name;
    if (statSync(join(ROOT, rel)).isDirectory()) walkSources(rel, out);
    else if (/\.(?:ts|tsx|js|jsx|mjs|html)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(rel);
  }
  return out;
};
const SOURCE_FILES = [...walkSources('src'), ...walkSources('api'), 'index.html'];

// ── 7. Contact-consent wording ↔ scope registry (CE-09 / CRM-15) ─────────────
// AUDIT 2026-10-02 — the scope written to CALLBACK_CONSENT_SCOPE is read off the
// consent wording by its digest. If the wording in src/lib/disclaimerVersion.ts
// and the registry in api/_lib/cy2027/consent.js drift, every lead fails closed
// (no scope, a flag on each one) and nobody sees it until the logs. The rule
// itself is scripts/consent-wording-gate.mjs, which the suite tests by calling.
// Nothing here reads docs/: both inputs are part of the deployed artifact.
{
  const consentMod = await import('../api/_lib/cy2027/consent.js');
  let dv;
  try { dv = read('src/lib/disclaimerVersion.ts'); } catch { dv = null; }
  if (dv === null) {
    problems.push('src/lib/disclaimerVersion.ts is missing — the contact-consent wording cannot be checked against its scope registry.');
  } else {
    const wording = consentWordingProblems({ source: dv, registry: consentMod.CONTACT_CONSENT_TEXT_VERSIONS });
    if (wording.problems.length) problems.push(...wording.problems);
    else notes.push(`contact-consent wording v${wording.version} matches its scope registry (${wording.scope})`);

    // RED TEAM 2026-10-04 — the check above reads ONE file, and the chat carried
    // six hard-coded copies of the wording outside it: a widened copy was shown
    // while the registered constant was attested, and this gate stayed green.
    // Every source file under src/ and api/, plus the static shell, is scanned
    // for a second copy. All of them are part of the deployed artifact.
    const copies = consentWordingCopyProblems({ files: SOURCE_FILES.map((p) => ({ path: p, source: read(p) })) });
    if (copies.scanned < 50) problems.push(`contact-consent single-source scan read only ${copies.scanned} files — the walk is broken`);
    if (copies.problems.length) problems.push(...copies.problems);
    else notes.push(`contact-consent wording has a single source (${copies.scanned} files scanned)`);
  }
}

// ── 8. Knowledge release ledger (CBF-10) ─────────────────────────────────────
// AUDIT 2026-10-04 (CBF-10) — the knowledge body every assistant answers from
// was an unversioned string. It now carries a release ledger, and this is the
// control that makes the ledger mean something: the body cannot change without
// a NEW release, a shipped release cannot be re-pinned, and an outgoing body
// must be archived verbatim before it is replaced (spec §22 "Do not overwrite
// prior-year logic").
{
  const kb = await import('../api/_lib/medicare-knowledge.js');
  const sha = (s) => 'sha256:' + createHash('sha256').update(String(s), 'utf8').digest('hex');
  const bodyDigest = sha(kb.MEDICARE_KNOWLEDGE);

  // Independent copy of every release ever shipped. APPEND-ONLY: add a line for
  // a new version; never edit or delete an existing one. This second copy is
  // what stops "edit the body, re-pin the digest, keep the version".
  const PINNED_KNOWLEDGE_RELEASES = Object.freeze({
    'CP-UMKE-CY2026-v1.0': 'sha256:fe91877b42234ee61e8320829f33b2a390acb72e534a1f02827fd0515c1148ae',
  });

  const releases = Array.isArray(kb.KNOWLEDGE_RELEASES) ? kb.KNOWLEDGE_RELEASES : [];
  const isVersion = (v) => typeof v === 'string' && /^CP-UMKE-CY\d{4}-v\d+\.\d+$/.test(v);
  const archived = new Map();
  for (const r of releases.slice(0, -1)) {
    // Only a well-formed version names a file; anything else is refused by the ledger rules below.
    if (!r || !isVersion(r.version)) continue;
    try {
      const mod = await import(`../api/_lib/knowledge-archive/${r.version}.js`);
      archived.set(r.version, sha(mod.KNOWLEDGE_BODY));
    } catch { /* absent — knowledgeLedgerProblems names it */ }
  }

  const kbProblems = typeof kb.knowledgeLedgerProblems === 'function'
    ? kb.knowledgeLedgerProblems({ bodyDigest, archiveDigest: (v) => archived.get(v) || null })
    : ['KNOWLEDGE_LEDGER_MISSING'];
  for (const r of releases) {
    const v = r && r.version;
    if (!Object.prototype.hasOwnProperty.call(PINNED_KNOWLEDGE_RELEASES, String(v))) kbProblems.push('KNOWLEDGE_RELEASE_NOT_PINNED:' + v);
  }
  for (const [version, digest] of Object.entries(PINNED_KNOWLEDGE_RELEASES)) {
    const r = releases.find((x) => x && x.version === version);
    if (!r) kbProblems.push('KNOWLEDGE_RELEASE_REMOVED:' + version);
    else if (r.digest !== digest) kbProblems.push('KNOWLEDGE_RELEASE_DIGEST_REWRITTEN:' + version);
  }

  // The version stamped on a reply is only true if the prompt is built FROM
  // this module. A pasted second copy would be answered from and traced to nothing.
  // AUDIT 2026-10-04 (CBF-10, red team) — this read THREE named files for the
  // body's FIRST line: a copy anywhere else, or one missing its heading, passed.
  // Every source file the artifact is built from (the same list section 7 scans)
  // is read, comments stripped and whitespace folded, for ANY heading of the
  // body or two or more of its sentences. The module itself and the verbatim
  // archive of outgoing bodies are the only places a copy belongs.
  const KB_MODULE = 'api/_lib/medicare-knowledge.js';
  const KB_ARCHIVE_PREFIX = 'api/_lib/knowledge-archive/';
  const fold = (s) => s.replace(/\s+/g, ' ').trim();
  const kbLines = String(kb.MEDICARE_KNOWLEDGE || '').split('\n').map(fold).filter((l) => l && !l.includes('//'));
  const kbHeadings = kbLines.filter((l) => /^#{1,2} /.test(l));
  const kbSentences = kbLines.filter((l) => !l.startsWith('#') && l.length >= 40);
  if (kbHeadings.length < 5 || kbSentences.length < 10) kbProblems.push(`KNOWLEDGE_BODY_FINGERPRINT_TOO_SMALL:${kbHeadings.length}_headings_${kbSentences.length}_sentences`);
  let kbScanned = 0;
  for (const f of SOURCE_FILES) {
    if (f === KB_MODULE || f.startsWith(KB_ARCHIVE_PREFIX)) continue;
    kbScanned += 1;
    const txt = fold(stripComments(read(f)));
    const headingHits = kbHeadings.filter((h) => txt.includes(h)).length;
    const sentenceHits = kbSentences.filter((s) => txt.includes(s)).length;
    if (headingHits > 0 || sentenceHits >= 2) kbProblems.push(`KNOWLEDGE_BODY_DUPLICATED_IN:${f} (${headingHits} heading(s), ${sentenceHits} sentence(s) of the body)`);
  }
  if (kbScanned < 50) kbProblems.push(`KNOWLEDGE_COPY_SCAN_READ_ONLY_${kbScanned}_FILES`);

  if (kbProblems.length) {
    problems.push(
      'The Medicare knowledge body and its release ledger disagree (api/_lib/medicare-knowledge.js):\n' +
        kbProblems.map((p) => `      ${p}`).join('\n') + '\n' +
        `      digest of the body as it is now: ${bodyDigest}\n` +
        '      This text is what every assistant answers from. To change it: APPEND a release with a new\n' +
        '      version, mark the outgoing one SUPERSEDED, copy its body verbatim to\n' +
        '      api/_lib/knowledge-archive/<version>.js (export const KNOWLEDGE_BODY), and add the new\n' +
        '      version → digest pair to PINNED_KNOWLEDGE_RELEASES here and in scripts/test-cy2027-knowledge-2026-10-04.mjs.\n' +
        '      approvedBy / approvedOn are owner-supplied — never fill them in to make this pass.',
    );
  } else {
    notes.push(`knowledge release ${kb.MEDICARE_KNOWLEDGE_VERSION} matches its pinned digest (${releases.length} release(s) in the ledger)`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error('\n✗ check-cy2027-parity: ' + problems.length + ' problem(s)\n');
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  process.exit(1);
}
console.log('✓ check-cy2027-parity: ' + notes.length + ' check(s) passed');
notes.forEach((n) => console.log('    · ' + n));

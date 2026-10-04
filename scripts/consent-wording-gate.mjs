// ─────────────────────────────────────────────────────────────────────────────
// CONTACT-CONSENT WORDING GATE — one pure function, used by the build and by the
// CY2027 suite.
//
// AUDIT 2026-10-02 (CE-09 / CRM-15). The scope written to CALLBACK_CONSENT_SCOPE
// is read off the consent wording by its digest (CONTACT_CONSENT_TEXT_VERSIONS in
// api/_lib/cy2027/consent.js). The wording itself lives in
// src/lib/disclaimerVersion.ts, which the server cannot import. If the two
// drift, every lead fails closed: no consent object, no scope, a
// CALLBACK_CONSENT_NOT_RECORDED flag on each one. That is safe, and it is also
// an outage of the record — so it is caught HERE, before a deploy, not in the
// logs. (It has happened once already: the revocation phone number inside this
// text was changed on 2026-07-24 without a new DISCLAIMER_VERSION.)
//
// The rule is a function of (source text, registry) that returns the list of
// problems, so it is tested by CALLING it with edited wording, a bumped version
// and a registry that claims more than the text says — not by grepping for it.
//
// Lives directly in scripts/ (not scripts/lib/) because .vercelignore excludes
// scripts/* and re-includes files one by one; scripts/check-vercel-config.mjs
// follows the static import in check-cy2027-parity.mjs and fails the build if
// this file's exception is missing.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const own = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Read DISCLAIMER_VERSION and the two consent texts out of the TypeScript
 * source, exactly as a browser would end up showing them.
 *
 * Each text must be a concatenation of plain single-quoted pieces, declared
 * once. Anything else — a template literal, an escape, an interpolation, a
 * second declaration — reads as `null` and is reported by the caller rather
 * than guessed at: a gate that hashes something other than what is shown is
 * worse than no gate.
 */
export function readShownConsentWording(tsSource) {
  const code = stripComments(String(tsSource == null ? '' : tsSource));
  const versions = [...code.matchAll(/export\s+const\s+DISCLAIMER_VERSION\s*=\s*'([^'\\]+)'\s*;/g)].map((m) => m[1]);
  const literal = (name) => {
    const decls = [...code.matchAll(new RegExp('export\\s+const\\s+' + name + "\\s*=\\s*((?:'[^'\\\\]*'\\s*\\+?\\s*)+);", 'g'))];
    if (decls.length !== 1) return null;
    return [...decls[0][1].matchAll(/'([^'\\]*)'/g)].map((x) => x[1]).join('');
  };
  return {
    version: versions.length === 1 ? versions[0] : null,
    en: literal('TCPA_CONSENT_TEXT_EN'),
    es: literal('TCPA_CONSENT_TEXT_ES'),
  };
}

/**
 * The clause that makes a text the contact-consent wording, per language. A
 * second place that contains one of these is a second copy of the wording.
 * They are checked against the canonical text itself, so a wording change that
 * drops one fails the build here instead of quietly blinding the scan.
 */
export const CONSENT_WORDING_PROBES = Object.freeze({
  en: 'you authorize ClearPoint Senior Advisors',
  es: 'usted autoriza a ClearPoint Senior Advisors',
});

// What a browser would end up showing, as far as a scan can tell: comments gone,
// adjacent string pieces joined ('a ' + 'b'), every run of whitespace one space.
const shownForm = (src) => stripComments(String(src == null ? '' : src))
  .replace(/['"`]\s*\+\s*['"`]/g, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

/**
 * AUDIT 2026-10-04 (CE-09, red team) — ONE SOURCE FOR THE WORDING.
 *
 * consentWordingProblems() below reads ONE file. The chat component carried six
 * hard-coded copies of the same wording; widening all six ("…and any other
 * insurance product we sell…") left this gate green, the chat showing the wider
 * text, and the server recording the narrower scope as verified — because the
 * receipt attests to the constant, not to what was on screen.
 *
 * @param {{ files: Array<{ path: string, source: string }>, canonicalPath?: string }} input
 *   files  every source file that can put text in front of a person; it must
 *          include the canonical file
 * @returns {{ problems: string[], scanned: number }}
 */
export function consentWordingCopyProblems(input) {
  const { files, canonicalPath = 'src/lib/disclaimerVersion.ts' } = input !== null && typeof input === 'object' ? input : {};
  const problems = [];
  const norm = (p) => String(p == null ? '' : p).replace(/\\/g, '/');
  const list = Array.isArray(files) ? files.filter((f) => f !== null && typeof f === 'object') : [];
  const canonical = list.filter((f) => norm(f.path) === canonicalPath);
  if (canonical.length !== 1) {
    problems.push(`The single-source scan was not given ${canonicalPath} (exactly once) — it has nothing to compare against.`);
    return { problems, scanned: 0 };
  }
  const shown = readShownConsentWording(canonical[0].source);
  const probes = [];
  for (const lang of ['en', 'es']) {
    const probe = CONSENT_WORDING_PROBES[lang];
    if (typeof shown[lang] !== 'string' || !shown[lang].toLowerCase().includes(probe.toLowerCase())) {
      problems.push(
        `The ${lang.toUpperCase()} contact-consent wording no longer contains "${probe}", the clause the single-source scan looks for.\n` +
          '      Update CONSENT_WORDING_PROBES in scripts/consent-wording-gate.mjs to a clause of the new wording.',
      );
    } else {
      probes.push(probe.toLowerCase());
    }
  }
  let scanned = 0;
  for (const f of list) {
    if (norm(f.path) === canonicalPath) continue;
    scanned += 1;
    const text = shownForm(f.source);
    if (probes.some((p) => text.includes(p))) {
      problems.push(
        `${norm(f.path)} contains its own copy of the contact-consent wording.\n` +
          `      Use TCPA_CONSENT_TEXT_EN / TCPA_CONSENT_TEXT_ES from ${canonicalPath}: the consent receipt attests to those\n` +
          '      constants, so a copy that drifts is shown to the person while a different text is recorded.',
      );
    }
  }
  return { problems, scanned };
}

/**
 * @param {{ source: string, registry: object }} input
 *   source    the text of src/lib/disclaimerVersion.ts
 *   registry  CONTACT_CONSENT_TEXT_VERSIONS
 * @returns {{ problems: string[], version: string|null, scope: string|null }}
 *   `problems` is empty only when the wording shown under the current
 *   DISCLAIMER_VERSION is, in both languages, byte-for-byte the registered text
 *   AND literally contains the phrase the registry says states the scope.
 */
export function consentWordingProblems({ source, registry } = {}) {
  const problems = [];
  const shown = readShownConsentWording(source);
  if (!shown.version || !shown.en || !shown.es) {
    problems.push(
      'Could not read DISCLAIMER_VERSION / TCPA_CONSENT_TEXT_EN / TCPA_CONSENT_TEXT_ES from src/lib/disclaimerVersion.ts.\n' +
        '      Each must be declared once, as a plain single-quoted string concatenation, so this guard can hash exactly what is shown.',
    );
    return { problems, version: shown.version, scope: null };
  }
  const entry = own(registry, shown.version) ? registry[shown.version] : null;
  if (!entry) {
    problems.push(
      `DISCLAIMER_VERSION '${shown.version}' has no entry in CONTACT_CONSENT_TEXT_VERSIONS (api/_lib/cy2027/consent.js).\n` +
        '      Add one — with the scope THAT wording states — or no web lead will carry a callback-consent scope.',
    );
    return { problems, version: shown.version, scope: null };
  }
  const scope = typeof entry.scope === 'string' && entry.scope ? entry.scope : null;
  if (!scope) {
    problems.push(`CONTACT_CONSENT_TEXT_VERSIONS['${shown.version}'] names no scope. A consent text version is registered WITH the scope it states.`);
  }
  for (const lang of ['en', 'es']) {
    const registered = own(entry.sha256, lang) && typeof entry.sha256[lang] === 'string' ? entry.sha256[lang] : null;
    const stated = own(entry.statedAs, lang) && typeof entry.statedAs[lang] === 'string' ? entry.statedAs[lang] : null;
    if (!registered || !stated) {
      problems.push(`CONTACT_CONSENT_TEXT_VERSIONS['${shown.version}'] is incomplete for ${lang.toUpperCase()}: it needs sha256.${lang} and statedAs.${lang}.`);
      continue;
    }
    const digest = sha256Hex(shown[lang]);
    if (digest !== registered) {
      problems.push(
        `The ${lang.toUpperCase()} contact-consent wording changed but DISCLAIMER_VERSION is still '${shown.version}'.\n` +
          `      registered: ${registered}\n` +
          `      shown now:  ${digest}\n` +
          '      Bump DISCLAIMER_VERSION and ADD a registry entry for the new text (do not edit the old one):\n' +
          '      the scope recorded for a consent must be the scope its own wording states.',
      );
    }
    if (!shown[lang].includes(stated)) {
      problems.push(
        `CONTACT_CONSENT_TEXT_VERSIONS['${shown.version}'] says the ${lang.toUpperCase()} text states "${stated}", and the text does not contain it.\n` +
          '      A scope the wording does not state is an inferred scope.',
      );
    }
  }
  return { problems, version: shown.version, scope };
}

// ─────────────────────────────────────────────────────────────────────────────
// TPMO DISCLAIMER GATE — one pure function, used by the build and by preflight.
//
// AUDIT 2026-10-02 (TPY-09) replaced a presence check ("some TPMO-ish sentence
// is on the page") with a year check. RED TEAM 2026-10-03 then broke that year
// check four ways, all reproduced:
//
//   1. It asked whether the RIGHT sentence appeared ANYWHERE on the page. Every
//      content page renders the canonical sentence in the shared footer, so the
//      footer alone satisfied the check and a stale hard-coded copy in a page
//      body was never seen: this year's footer + last year's sentence = PASS.
//   2. It accepted either language on any route: an /es page whose only
//      disclaimer was English passed.
//   3. The "thin page" exemption (/support) skipped the YEAR check, not just the
//      word-count check, although those pages do carry the disclaimer.
//   4. The assertions that guarded it were source greps: reverting the whole
//      check and leaving one comment line still passed the suite.
//
// So the rule is now a function of (path, text, variant) that returns the list
// of problems, and it is tested by CALLING it with synthetic pages:
//
//   • every TPMO-style sentence on the page must be the canonical sentence of
//     the expected contract-year variant — not merely one of them;
//   • the other variant's canonical sentence must not appear at all;
//   • the route's own language must be present (/es → Spanish, else English);
//   • a thin page may OMIT the disclaimer, but if it carries one, it is checked.
//
// WHAT THIS CANNOT SEE — stated so nobody reads more into a green build than it
// proves: at build time the expectation and the rendered page come from the same
// module and the same clock, so a build made on 30 September passes its own gate
// while naming the SHIP. The gate catches a stale HARD-CODED sentence at build
// time; a stale DEPLOY (built before the cut-over, served after it) is only
// visible when already-built HTML is checked against the clock at promote time.
// scripts/cy2027-preflight.mjs does that with this same function, against dist/
// and, with --url, against a deployed origin.
//
// Lives directly in scripts/ (not scripts/lib/) because .vercelignore excludes
// scripts/* and re-includes files one by one; scripts/check-vercel-config.mjs
// fails the build if this file's exception is missing.
// ─────────────────────────────────────────────────────────────────────────────

import { tpmoDisclaimerText, activeContractYearVariant, TPMO_DISCLAIMER_CONFIG } from '../api/_lib/cy2027/tpmo.js';

/**
 * Any sentence that presents itself as the TPMO disclaimer, in either language:
 * the phrase followed, within a few words, by a FULL STOP. The standardized
 * disclaimer opens with that standalone sentence. Marketing prose that states
 * the same fact inside a longer sentence ("…in your area, and we are paid a
 * commission by the carrier…") is not a disclaimer and is not judged here; a
 * hand-written or abridged disclaimer is, because it has the standalone form.
 */
export const TPMO_ANY = /(?:do not offer every plan|no ofrecemos todos los planes)[^.,;:!?]{0,40}\./gi;

const OTHER_VARIANT = Object.freeze({ CY2026: 'CY2027', CY2027: 'CY2026' });

const norm = (x) => String(x).replace(/\s+/g, ' ').trim();

/** Count non-overlapping occurrences of `needle` in `hay`. */
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);

/**
 * The canonical sentence for a given variant, with whatever counts are
 * configured. A pinned COPY of the live config: tpmoDisclaimerText ignores a pin
 * on the singleton by design (EF-08), and the copy keeps the verified counts.
 */
export function canonicalTpmoSentence(lang, variant) {
  return tpmoDisclaimerText(lang, {
    ...TPMO_DISCLAIMER_CONFIG,
    pinContractYearVariant: true,
    contractYearVariant: variant,
  });
}

/** Visible text of an HTML document: scripts dropped, tags to spaces, a few entities decoded. */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{ path: string, text: string, thin?: boolean, variant?: 'CY2026'|'CY2027' }} page
 *   `text` is visible text (see htmlToText). `variant` defaults to the variant in
 *   force NOW; tests pass it explicitly so both years are exercised on any date.
 * @returns {string[]} problems — empty means the page passes.
 */
export function checkTpmo({ path, text, thin = false, variant = activeContractYearVariant() }) {
  const other = OTHER_VARIANT[variant];
  if (!other) return [`${path}: variante TPMO desconocida "${variant}" — no hay frase canónica contra la cual comparar`];

  const body = norm(text);
  const occurrences = (body.match(TPMO_ANY) || []).length;
  if (occurrences === 0) {
    return thin ? [] : [`${path}: la declaración TPMO no aparece en el cuerpo prerenderizado`];
  }

  const expected = { en: norm(canonicalTpmoSentence('en', variant)), es: norm(canonicalTpmoSentence('es', variant)) };
  const stale = { en: norm(canonicalTpmoSentence('en', other)), es: norm(canonicalTpmoSentence('es', other)) };
  const problems = [];

  const staleHits = count(body, stale.en) + count(body, stale.es);
  const canonicalHits = count(body, expected.en) + count(body, expected.es);

  if (staleHits > 0) {
    problems.push(
      `${path}: ${staleHits} declaración(es) TPMO con la redacción de ${other} (se espera ${variant}) — ` +
        'reconstruya tras el cambio de año, o corrija la copia escrita a mano en la página',
    );
  }
  const unexplained = occurrences - canonicalHits - staleHits;
  if (unexplained > 0) {
    problems.push(
      `${path}: ${unexplained} de ${occurrences} declaración(es) TPMO no coincide(n) con la frase canónica de ${variant} — ` +
        'toda declaración debe renderizarse desde tpmoDisclaimerText(), no escribirse a mano',
    );
  }

  const want = /^\/es(\/|$)/.test(path) ? 'es' : 'en';
  if (count(body, expected[want]) === 0) {
    problems.push(
      `${path}: falta la declaración TPMO canónica de ${variant} en ${want === 'es' ? 'español' : 'inglés'}, ` +
        'el idioma de esta ruta',
    );
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────
// URL GUARD (master spec §63) — the model must never hand a caller a link we
// did not approve. Post-generation, deterministic, provider-agnostic: every
// URL-shaped token in the reply is checked against an explicit allowlist of
// official/aproved hosts; anything else is replaced with a visible removal
// note (never silently deleted mid-sentence, never emptying the reply).
//
// Why replace instead of delete: a caller who was mid-sentence promised a
// link deserves to SEE that a link was withheld — silent deletion reads as
// a typo and invites the model's invented URL to be retyped from memory.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Suffix-matched hostnames. Subdomains of these are allowed (www.medicare.gov,
// q1medicare… is NOT — suffix must match on a dot boundary).
const ALLOWED_HOSTS = [
  'medicare.gov', 'ssa.gov', 'cms.gov', 'medicaid.gov', 'healthcare.gov',
  'shiphelp.org', 'shiptacenter.org', '988lifeline.org',
  'clearpointsenioradvisors.com',
  'ny.gov', 'nj.gov', 'ct.gov', // state portals incl. health.ny.gov etc.
];

// http(s)://…, www.…, and bare domains with a common TLD. Trailing
// punctuation is left outside the match so sentences keep their period.
const URL_RE = /\b(?:https?:\/\/[^\s<>"')\]]+|www\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"')\]]*|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|gov|info|biz|us|io|ly|co|me|xyz|app|link|site|online|top|shop|club|live|life|world|today|store|tech|health|care)(?:\/[^\s<>"')\]]*)?)/gi;

function hostOf(raw) {
  let s = String(raw).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#]/)[0];
  // Drop userinfo: "medicare.gov@evil.com" must normalize to the REAL host
  // (evil.com), never be delivered because '@' fails the shape test (fail-open).
  s = s.split('@').pop();
  return s.replace(/[.,;:!?]+$/, '');
}

function isAllowed(host) {
  return ALLOWED_HOSTS.some((a) => host === a || host.endsWith('.' + a));
}

/**
 * @returns {{text: string, strippedCount: number, stripped: string[]}}
 *   stripped carries HOSTNAMES only (log-safe), never full URLs.
 */
export function guardUrls(text, language) {
  const note = language === 'en' ? '[link removed for your safety]' : '[enlace removido por su seguridad]';
  const stripped = [];
  const out = String(text || '').replace(URL_RE, (m) => {
    const host = hostOf(m);
    // Not URL-shaped after normalization? For SCHEME-BEARING matches this is
    // fail-CLOSED (IPv6 literals, residual userinfo, exotic authorities must
    // not ship); the fail-open escape survives only for the bare-domain branch
    // ("e.g" class false positives).
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
      if (/^https?:\/\//i.test(m)) { stripped.push('unparseable-authority'); return note; }
      return m;
    }
    if (isAllowed(host)) return m;
    stripped.push(host);
    return note;
  });
  // Fail-safe: never empty a reply (mirrors the scope-gate contract).
  if (!out.trim()) return { text: String(text || ''), strippedCount: 0, stripped: [] };
  return { text: out, strippedCount: stripped.length, stripped };
}

export const __testables = { hostOf, isAllowed, ALLOWED_HOSTS };

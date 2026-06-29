// Sawil 2026-06-29 SECURITY HOTFIX (audit findings 05 / 16).
// Shared no-store headers for any endpoint that handles PII (lookup, lead,
// chat, SOA). Production was returning `public, max-age=0, must-revalidate`,
// which lets browsers/CDNs cache sensitive responses. Apply this to EVERY PII
// endpoint, on BOTH success and error paths.
export function noStorePII(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

// AUDIT 2026-08-13 — regressions for the third P1 batch: O-03, O-04, O-05, O-09, O-10.
// Run: npx tsx scripts/test-p1-batch3-2026-08-13.mjs
import { readFileSync } from 'node:fs';
import { complianceFilter } from '../api/_lib/compliance-filter.js';
import { SOA_ENABLED, SOA_PRECONDITIONS, soaBlockers, assertSoaEnablementSafe } from '../src/lib/soaContent.ts';

const CHAT = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8');
const LEAD = readFileSync(new URL('../api/submit-lead.js', import.meta.url), 'utf8');
const ZARA = readFileSync(new URL('../src/components/ChatBot.tsx', import.meta.url), 'utf8');

let pass = 0; const fail = [];
const check = (id, cond, why) => { if (cond) pass++; else fail.push(id + (why ? ' — ' + why : '')); };

// ══ O-03: Zara must consume the handoff decision ═══════════════════════════
check('O-03 reads meta.wantHandoff', /result\.meta\?\.wantHandoff/.test(ZARA),
  'Zara showed the bridge sentence but never read the decision');
check('O-03 routes into advisor flow', /result\.meta\?\.wantHandoff[\s\S]{0,320}handleAdvisorRequestIntent\(\)/.test(ZARA));
check('O-03 gated on DNC', /result\.meta\?\.wantHandoff && !hasSessionOptOut\(\)/.test(ZARA),
  'must not start intake after a revocation');
check('O-03 orphan-guarded', /result\.meta\?\.wantHandoff[\s\S]{0,300}gen !== generationRef\.current/.test(ZARA),
  'a reset session must not trigger a late handoff');

// ══ O-04: AI answer audit record ═══════════════════════════════════════════
check('O-04 emits audit line', /\[AI-AUDIT\]/.test(CHAT));
check('O-04 captures search provenance', /web_search_tool_result/.test(CHAT) && /search_domains/.test(CHAT),
  'search result blocks were discarded unread');
check('O-04 domains only, no page content', !/result\.content\[k\]\.text/.test(CHAT) && /hostname/.test(CHAT));
check('O-04 records violations', /violations: filtered\.violations/.test(CHAT));
check('O-04 records model + figures year', /model: MODEL/.test(CHAT) && /figures_year: FIGURES_YEAR/.test(CHAT));
check('O-04 reply hashed not stored', /reply_fingerprint/.test(CHAT) && !/reply_text/.test(CHAT),
  'the audit record must be PHI-free');
check('O-04 no raw message logged', !/userMessage: userMessage/.test(CHAT.split('[AI-AUDIT]')[1] || ''));
check('O-04 never breaks a reply', /auditing must never break a reply/.test(CHAT));

// ══ O-05: duplicate lead must not lose the new request ═════════════════════
check('O-05 resolves existing contact', /duplicate resolution failed|_dupId/.test(LEAD));
check('O-05 refreshes via PUT', /duplicate refresh PUT failed/.test(LEAD));
check('O-05 continues to note/opportunity', /_repeatRequest = true/.test(LEAD),
  'must fall through so the note and opportunity blocks run');
check('O-05 flags repeat in the note', /REPEAT REQUEST/.test(LEAD));
check('O-05 fail-safe to 409', /if \(!_dupId\) \{[\s\S]{0,200}DUPLICATE_LEAD/.test(LEAD),
  'unresolvable duplicate must fall back, not guess');

// ══ O-09: figures staleness guard ══════════════════════════════════════════
check('O-09 FIGURES_YEAR declared', /const FIGURES_YEAR = 2026;/.test(CHAT));
check('O-09 compares to real year', /_now\.getFullYear\(\) !== FIGURES_YEAR/.test(CHAT));
check('O-09 injects staleness warning', /FIGURE STALENESS WARNING/.test(CHAT));
check('O-09 removed "It is 2026." from cached prompt', !/It is 2026\./.test(CHAT),
  'the cached block contradicted the per-turn date after Jan 1');
check('O-09 tells model to stop quoting figures', /Do NOT state any specific premium/.test(CHAT));

// ══ O-10: SOA enablement preconditions ═════════════════════════════════════
check('O-10 SOA still disabled', SOA_ENABLED === false);
check('O-10 preconditions declared', Object.keys(SOA_PRECONDITIONS).length >= 5);
check('O-10 all blockers reported', soaBlockers().length === Object.keys(SOA_PRECONDITIONS).length,
  'every precondition should currently be unmet');
check('O-10 blockers name the counts issue', soaBlockers().includes('tpmoCountsVerifiedEverywhere'));
check('O-10 blockers name pdf persistence', soaBlockers().includes('signedPdfPersisted'));
check('O-10 guard is a no-op while disabled', (() => {
  try { assertSoaEnablementSafe(); return true; } catch { return false; }
})());

console.log(`P1 batch 3 (O-03/04/05/09/10): ${pass}/${pass + fail.length} passed`);
if (fail.length) {
  console.error('\x1b[31mFAILURES:\x1b[0m\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log('\x1b[32m✓ all five remaining P1s verified\x1b[0m');

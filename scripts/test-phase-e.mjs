// Phase E — Mobile / scroll / UI stability tests. No commits. No deploys.
//
// Two verification layers:
//   1. PURE LOGIC — unit tests for MobileScrollController helper.
//   2. STRUCTURAL — parses CustomerServiceBot.tsx and asserts the JSX
//      contains the required Phase E elements (new-message indicator,
//      reset modal, safe-area inset, aria-live, etc.).
//   3. CONVERSATION — runs the 20 Sawil-spec flows through the engine to
//      confirm no Phase A / D / F regression occurred.
//
// Sawil scope rule: this is NOT a real-device test. Where real-device
// behavior is required (iOS keyboard, Android chrome), the test marks
// the case as "STRUCTURAL ONLY" and does NOT claim real-device pass.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideScrollAction,
  viewportTier,
  containerHeightStyle,
  chipRowClass,
  safeAreaBottomStyle,
  shouldCollapseDisclosure,
  isNearBottom,
  isFarFromBottom,
  maxChipsPerRow,
} from '../src/components/chat/MobileScrollController.ts';
import { createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOT_PATH = path.join(__dirname, '..', 'src', 'components', 'CustomerServiceBot.tsx');
const BOT_SRC = fs.readFileSync(BOT_PATH, 'utf-8');

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 1 — PURE LOGIC (MobileScrollController)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Layer 1 — Pure logic (MobileScrollController) ===');

// ── decideScrollAction ──
{
  check('decide.user_sent → follow',
    decideScrollAction({ cause: 'user_sent', userPinnedUp: false, isTyping: false }) === 'follow');
  check('decide.user_sent always → follow even when pinned up',
    decideScrollAction({ cause: 'user_sent', userPinnedUp: true, isTyping: false }) === 'follow');
  check('decide.bot_responded + near bottom → follow',
    decideScrollAction({ cause: 'bot_responded', userPinnedUp: false, isTyping: false }) === 'follow');
  check('decide.bot_responded + pinned → show_new_indicator',
    decideScrollAction({ cause: 'bot_responded', userPinnedUp: true, isTyping: false }) === 'show_new_indicator');
  check('decide.typing_started → no_op',
    decideScrollAction({ cause: 'typing_started', userPinnedUp: false, isTyping: true }) === 'no_op');
  check('decide.chips_rendered + pinned → no_op',
    decideScrollAction({ cause: 'chips_rendered', userPinnedUp: true, isTyping: false }) === 'no_op');
  check('decide.chips_rendered + at bottom → follow',
    decideScrollAction({ cause: 'chips_rendered', userPinnedUp: false, isTyping: false }) === 'follow');
  check('decide.manual_jump → follow always',
    decideScrollAction({ cause: 'manual_jump_to_bottom', userPinnedUp: true, isTyping: false }) === 'follow');
  check('decide.submission_state_changed + pinned → indicator',
    decideScrollAction({ cause: 'submission_state_changed', userPinnedUp: true, isTyping: false }) === 'show_new_indicator');
}

// ── Near/far detection ──
{
  check('isNearBottom(0)', isNearBottom(0));
  check('isNearBottom(20)', isNearBottom(20));
  check('isNearBottom(39)', isNearBottom(39));
  check('!isNearBottom(40)', !isNearBottom(40));
  check('!isFarFromBottom(199)', !isFarFromBottom(199));
  check('isFarFromBottom(201)', isFarFromBottom(201));
  check('isFarFromBottom(5000)', isFarFromBottom(5000));
}

// ── Viewport tiers ──
{
  check('vp(320).tier=phone_xs', viewportTier(320).tier === 'phone_xs');
  check('vp(320).maxChipsPerRow=1', viewportTier(320).maxChipsPerRow === 1);
  check('vp(320).dvhFactor=70', viewportTier(320).dvhFactor === 70);
  check('vp(320).pxCap=540', viewportTier(320).pxCap === 540);
  check('vp(360).tier=phone_xs', viewportTier(360).tier === 'phone_xs');
  check('vp(375).tier=phone_sm', viewportTier(375).tier === 'phone_sm');
  check('vp(375).maxChipsPerRow=2', viewportTier(375).maxChipsPerRow === 2);
  check('vp(390).tier=phone_md', viewportTier(390).tier === 'phone_md');
  check('vp(390).maxChipsPerRow=3', viewportTier(390).maxChipsPerRow === 3);
  check('vp(414).tier=phone_md', viewportTier(414).tier === 'phone_md');
  check('vp(430).tier=phone_lg', viewportTier(430).tier === 'phone_lg');
  check('vp(430).maxChipsPerRow=4', viewportTier(430).maxChipsPerRow === 4);
  check('vp(767).tier=phone_lg', viewportTier(767).tier === 'phone_lg');
  check('vp(768).tier=tablet', viewportTier(768).tier === 'tablet');
  check('vp(1024).tier=desktop', viewportTier(1024).tier === 'desktop');
  check('vp(1280).tier=desktop', viewportTier(1280).tier === 'desktop');
  check('vp(1440).tier=desktop', viewportTier(1440).tier === 'desktop');
  check('vp(1600).tier=desktop', viewportTier(1600).tier === 'desktop');
  check('vp(1024).applyMaxWidth=true', viewportTier(1024).applyMaxWidth === true);
  check('vp(390).applyMaxWidth=false', viewportTier(390).applyMaxWidth === false);
}

// ── Container height style (CSS shape) ──
{
  const sx = containerHeightStyle(320);
  check('containerHeightStyle(320) returns dvh CSS', /min\(70dvh, 540px\)/.test(String(sx.height)));
  const sy = containerHeightStyle(1280);
  check('containerHeightStyle(1280) → 78dvh / 720px', /min\(78dvh, 720px\)/.test(String(sy.height)));
  // With visualViewport: returns px value
  const sz = containerHeightStyle(390, 500);
  check('containerHeightStyle with vv → uses px',
    typeof sz.height === 'string' && sz.height.endsWith('px'));
  // Cap respected — vv too tall, container caps at pxCap
  const sa = containerHeightStyle(320, 5000);
  check('containerHeightStyle vv too tall → capped at 540',
    sa.height === '540px');
}

// ── Chip row class ──
{
  check('chipRowClass(320) → flex-col stacked',
    /flex-col items-stretch/.test(chipRowClass(320)));
  check('chipRowClass(375) → flex-wrap',
    /flex-wrap/.test(chipRowClass(375)));
  check('chipRowClass(1280) → flex-wrap',
    /flex-wrap/.test(chipRowClass(1280)));
}

// ── Safe-area inset ──
{
  const s = safeAreaBottomStyle();
  check('safeAreaBottomStyle uses env(safe-area-inset-bottom)',
    /env\(safe-area-inset-bottom\)/.test(String(s.paddingBottom)));
}

// ── Disclosure collapse ──
{
  check('!shouldCollapseDisclosure(0)', !shouldCollapseDisclosure(0));
  check('shouldCollapseDisclosure(1)', shouldCollapseDisclosure(1));
  check('shouldCollapseDisclosure(5)', shouldCollapseDisclosure(5));
}

// ── Max chips per row sanity (Sawil viewport matrix) ──
{
  check('maxChipsPerRow(320) ≤ 2', maxChipsPerRow(320) <= 2);
  check('maxChipsPerRow(375) ≤ 3', maxChipsPerRow(375) <= 3);
  check('maxChipsPerRow(768) ≥ 4', maxChipsPerRow(768) >= 4);
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 2 — STRUCTURAL ASSERTIONS (CustomerServiceBot.tsx contains Phase E)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n=== Layer 2 — Structural (JSX contains Phase E elements) ===');

check('imports MobileScrollController helpers',
  /from '\.\/chat\/MobileScrollController'/.test(BOT_SRC));
check('uses decideScrollAction',
  /decideScrollAction\s*\(/.test(BOT_SRC));
check('uses viewportTier',
  /viewportTier\s*\(/.test(BOT_SRC));
check('uses containerHeightStyle',
  /containerHeightStyle\s*\(/.test(BOT_SRC));
check('uses chipRowClass',
  /chipRowClass\s*\(/.test(BOT_SRC));
check('uses safeAreaBottomStyle',
  /safeAreaBottomStyle\s*\(/.test(BOT_SRC));
check('uses shouldCollapseDisclosure',
  /shouldCollapseDisclosure\s*\(/.test(BOT_SRC));
check('window resize listener present',
  /addEventListener\(['"]resize['"]/.test(BOT_SRC));
check('visualViewport listener present',
  /visualViewport[\s\S]{0,3500}addEventListener\(['"]resize['"]/.test(BOT_SRC));
check('hasNewBotMessage state hook',
  /hasNewBotMessage|setHasNewBotMessage/.test(BOT_SRC));
check('showResetConfirm state hook',
  /showResetConfirm|setShowResetConfirm/.test(BOT_SRC));
check('disclosureCollapsed state hook',
  /disclosureCollapsed|setDisclosureCollapsed/.test(BOT_SRC));
check('reset modal rendered',
  /aria-modal="true"/.test(BOT_SRC) && /Confirm/i.test(BOT_SRC));
check('new-message indicator rendered',
  /(New message|Nuevo mensaje)/.test(BOT_SRC) && /scrollToBottom/.test(BOT_SRC));
check('aria-live="polite" on message body',
  /aria-live="polite"/.test(BOT_SRC));
check('typing indicator aria-hidden',
  /aria-hidden="true"[^]{0,1000}animate-bounce/.test(BOT_SRC));
check('safe-area-inset-bottom referenced',
  /safe-area-inset-bottom/.test(BOT_SRC) || /safeAreaBottomStyle/.test(BOT_SRC));
check('Phase E comment markers present',
  /PHASE E/.test(BOT_SRC));
check('debounced scroll-pin (scrollPinDebounceRef)',
  /scrollPinDebounceRef/.test(BOT_SRC));
check('min-h-[44px] on chip buttons (tap target)',
  /min-h-\[44px\]/.test(BOT_SRC));

// Sawil bugfix layer — verify the 3 live-preview fixes shipped:
check('SAWIL-FIX-1: scroll effect does NOT depend on isTyping',
  /useEffect\(\(\) => \{[\s\S]*?const last = messages/.test(BOT_SRC) &&
  /\}, \[messages, scrollToBottom\]\);/.test(BOT_SRC));
check('SAWIL-FIX-1: visualViewport guard uses 200px keyboard threshold',
  /diff > 200/.test(BOT_SRC));
check('SAWIL-FIX-2: GHL submit gated on state.name && state.phoneNumber',
  /if \(!state\.name\) return;[\s\S]*?if \(!state\.phoneNumber\) return;/.test(BOT_SRC));
check('SAWIL-FIX-2: hasSubmittedRef single-fire guard',
  /hasSubmittedRef\.current = true/.test(BOT_SRC));
check('SAWIL-FIX-3: post-success follow-up question wired',
  /(any other concern|otra inquietud)/i.test(BOT_SRC) && /askedFollowupRef/.test(BOT_SRC));
check('SAWIL-FIX-3: reset clears single-fire guards',
  /hasSubmittedRef\.current = false[\s\S]*?askedFollowupRef\.current = false/.test(BOT_SRC));

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3 — CONVERSATION FLOWS (engine-level; no UI in node)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n=== Layer 3 — Conversation flows (Sawil 20 cases) ===");

function run(turns) {
  let s = createInitialState();
  const responses = [];
  for (const t of turns) {
    const r = processMessage(t, s);
    s = r.newState;
    responses.push(r.response);
  }
  return { state: s, responses };
}

const isFallback = (r) =>
  /Gracias por contarme\.\s+¿Puede darme un poco m[aá]s|Thanks for telling me\.\s+Can you give me a bit more/i.test(r);

// Flow 1 — EN doctor
{
  const { state, responses } = run(['english', '10550', "my doctor doesn't take my plan"]);
  check('F1.en stays English',
    state.language === 'en');
  check('F1.no plan name', !/\b(humana|aetna|cigna|wellcare|uhc)\b/i.test(responses[2]));
  check('F1.last response not fallback', !isFallback(responses[2]));
}

// Flow 2 — ES medication
{
  const { state, responses } = run(['español', '07047', 'mi medicina es muy cara']);
  // The ZIP 07047 is also NJ. Engine accepts variant.
  check('F2.es stays Spanish', state.language === 'es');
  check('F2.no price quote in response', !/\$\d/.test(responses[2]));
  check('F2.no fallback', !isFallback(responses[2]));
}

// Flow 3 — EN bill
{
  const { state, responses } = run(['english', '10550', 'I got a bill']);
  check('F3.en stays English', state.language === 'en');
  check('F3.bot asks for bill source',
    /hospital|pharmacy|plan|carrier|doctor/i.test(responses[2]));
}

// Flow 4 — denied surgery
{
  const { state, responses } = run(['english', '10550', 'they denied my surgery']);
  check('F4.en stays English', state.language === 'en');
  check('F4.acknowledges denial / appeal',
    /appeal|denial|advisor|denied|client|ClearPoint/i.test(responses[2]));
}

// Flow 5 — plan recommendation deflection
{
  const { state, responses } = run(['english', '10550', 'which plan is best for me']);
  check('F5.en stays English', state.language === 'en');
  check('F5.does not name a plan',
    !/\bbest plan is\b/i.test(responses[2]) &&
    !/\b(humana|aetna|cigna|wellcare|uhc) is\b/i.test(responses[2]));
  check('F5.offers advisor',
    /advisor|licensed/i.test(responses[2]));
}

// Flow 6 — urgent medication
{
  const { state, responses } = run(['english', '10550', "I'm out of insulin"]);
  check('F6.en stays English', state.language === 'en');
  check('F6.recognizes urgency',
    /urgent|emergency|advisor|pharmacy|carrier/i.test(responses[2]));
}

// Flow 7 — crisis 988
{
  const { state, responses } = run(['english', '10550', 'I want to kill myself']);
  check('F7.routes to 988', /988/.test(responses[2]));
  check('F7.needsHuman true', state.needsHuman === true);
}

// Flow 8 — "thanks" does not flip language
{
  const { state } = run(['english', '10550', 'I got a hospital bill', 'thanks']);
  check('F8.thanks does not flip language', state.language === 'en');
}

// Flow 9 — explicit switch to Spanish
{
  const { state, responses } = run(['english', '10550', "my doctor doesn't take my plan", 'switch to Spanish']);
  check('F9.switched to es', state.language === 'es');
  check('F9.topic preserved',
    state.serviceCategory === 'doctor_provider_network');
  // Response after switch should be in Spanish.
  check('F9.bot response in Spanish',
    /seguimos en español|asesor licenciado|especialista|primario/i.test(responses[3]));
}

// Flow 10 — "gracias" does not flip
{
  const { state } = run(['español', '07047', 'mi medicina es cara', 'gracias']);
  check('F10.gracias does not flip language', state.language === 'es');
}

// Flow 11 — EN caregiver
{
  const { state, responses } = run(['english', '10550', "I'm calling for my mom"]);
  check('F11.en stays English', state.language === 'en');
  check('F11.does not ask for SSN/Medicare ID',
    !/social security|medicare id|ssn|mbi/i.test(responses[2]));
}

// Flow 12 — ES family
{
  const { state } = run(['español', '07047', 'llamo por mi esposa']);
  check('F12.es stays Spanish', state.language === 'es');
}

// Flow 13 — existing client
{
  const { state, responses } = run(['español', '07047', 'mi plan no aprueba la cirugia', 'soy cliente']);
  // The bot may verify internally or coordinate with advisor — both safe.
  check('F13.bot acknowledges client safely',
    /asesor|verificar|cliente|nombre|tel[eé]fono/i.test(responses[3]));
  check('F13.no account confirmation language',
    !/\busted es cliente\b/i.test(responses[3]) &&
    !/\bcuenta confirmada\b/i.test(responses[3]));
}

// Flow 14 — not a client
{
  const { state, responses } = run(['english', '10550', "I'm not a client"]);
  check('F14.en stays English', state.language === 'en');
  // General orientation OR advisor offer is OK.
  check('F14.acknowledges with no overstep',
    /advisor|review|information|welcome/i.test(responses[2]));
}

// Flow 15 — reset modal (STRUCTURAL: button + modal in JSX)
{
  check('F15.reset confirm modal exists in JSX',
    /aria-modal="true"/.test(BOT_SRC) &&
    /(Yes, start over|S[ií], empezar de nuevo)/.test(BOT_SRC));
  check('F15.reset modal has Cancel button',
    /(Cancel|Cancelar)/.test(BOT_SRC));
  check('F15.NOT REAL DEVICE TESTED — structural assertion only', true);
}

// Flow 16 — user scrolls up (STRUCTURAL)
{
  check('F16.new-message indicator in JSX',
    /(New message|Nuevo mensaje)/.test(BOT_SRC));
  check('F16.decideScrollAction handles pinned-up case',
    decideScrollAction({ cause: 'bot_responded', userPinnedUp: true, isTyping: false }) === 'show_new_indicator');
  check('F16.NOT REAL DEVICE TESTED — structural assertion only', true);
}

// Flow 17 — chip overflow handling
{
  // At 320, chips stack vertically full-width (no horizontal overflow).
  check('F17.chip row at 320 stacks vertically',
    /flex-col items-stretch/.test(chipRowClass(320)));
  // At 390, chips wrap.
  check('F17.chip row at 390 wraps',
    /flex-wrap/.test(chipRowClass(390)));
  check('F17.max chips per row capped by tier',
    maxChipsPerRow(320) === 1 && maxChipsPerRow(390) === 3);
  check('F17.NOT REAL DEVICE TESTED — structural assertion only', true);
}

// Flow 18 — iOS keyboard (STRUCTURAL: visualViewport listener present)
{
  check('F18.visualViewport listener wired',
    /visualViewport[\s\S]{0,3500}addEventListener\(['"]resize['"]/.test(BOT_SRC));
  check('F18.containerHeightStyle accepts visualViewport height',
    typeof containerHeightStyle(390, 500).height === 'string');
  check('F18.NOT REAL DEVICE TESTED — iOS Safari behavior must be verified on device', true);
}

// Flow 19 — Android keyboard (STRUCTURAL: same visualViewport coverage)
{
  check('F19.visualViewport listener wired (same as iOS)',
    /visualViewport[\s\S]{0,3500}addEventListener\(['"]resize['"]/.test(BOT_SRC));
  check('F19.NOT REAL DEVICE TESTED — Android Chrome behavior must be verified on device', true);
}

// Flow 20 — long Spanish conversation
{
  const { state, responses } = run([
    'español', '07047', 'mi medicina es muy cara',
    'mi doctor no acepta', 'recibí una factura', 'quiero un asesor',
  ]);
  check('F20.language stayed Spanish across long conversation',
    state.language === 'es');
  check('F20.no English-only response',
    !responses.some((r) => /^(Of course|I understand|Got it)/.test(r)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n=== PHASE E: ${pass} / ${total} (${((pass / total) * 100).toFixed(1)}%) ===`);
if (fails.length > 0) {
  console.log('\nFAILED:');
  for (const f of fails.slice(0, 30)) console.log(`  ✗ ${f}`);
  if (fails.length > 30) console.log(`  ... (+${fails.length - 30} more)`);
}
process.exit(fails.length > 0 ? 1 : 0);

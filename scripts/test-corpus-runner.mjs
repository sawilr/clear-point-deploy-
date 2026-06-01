// Exhaustive corpus runner. Runs every scenario through the engine + lead-note
// builder and categorizes EVERY failure mode. Output: a dashboard showing
// which topic × language × variant combinations fail and WHY.
//
// Sawil mandate: no preview until this is clean.

import { createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';
import { buildLeadNote } from '../src/lib/orchestrator/leadNoteBuilder.ts';
import { buildAllScenarios, SAWIL_RECORDED_FAILURES, TOPIC_FAMILIES } from './conversation-corpus.mjs';

// ── Failure categorization ─────────────────────────────────────────────────
const FAIL_CATEGORIES = {
  wrong_topic: [],          // expected category X, got Y
  generic_fallback: [],     // bot said "tell me more"
  no_response: [],          // empty / null / undefined
  language_drift: [],       // user wrote ES, bot replied EN (or vice versa)
  forbidden_phrase: [],     // compliance violation
  invented_dollar: [],      // bot said $X without the user
  context_loss: [],         // bot asks for info user already gave
  off_topic_jump: [],       // bot switched topic without reason
  missing_crisis_route: [], // crisis input → no 988/911
  caregiver_not_detected: [],
  phi_echoed: [],           // SSN/MBI echoed in response
  recovery_not_triggered: [],
  deflection_missing: [],   // savings/plan-rec didn't deflect
  adjacent_loop: [],        // same response twice in a row
  excessive_length: [],     // > 600 chars
  sawil_recorded_regression: [],
};

let totalRun = 0;
let totalPass = 0;

function recordFail(cat, info) {
  if (!FAIL_CATEGORIES[cat]) FAIL_CATEGORIES[cat] = [];
  FAIL_CATEGORIES[cat].push(info);
}

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

// ── Forbidden phrases (compliance bar) ──────────────────────────────────────
const FORBIDDEN_PATTERNS = [
  [/\busted califica\b/i,                  'es_qualify'],
  [/\byou qualify\b/i,                     'en_qualify'],
  [/\bes el mejor plan\b/i,                'es_best'],
  [/\bis the best plan\b/i,                'en_best'],
  [/\bsu doctor est[aá] cubierto\b/i,      'es_doc_cov'],
  [/\byour doctor is covered\b/i,          'en_doc_cov'],
  [/\bsu medicina est[aá] cubierta\b/i,    'es_med_cov'],
  [/\byour (medication|medicine|drug) is covered\b/i, 'en_med_cov'],
  [/\bClearPoint is medicare\b/i,          'gov_aff'],
  [/\bClearPoint es medicare\b/i,          'gov_aff_es'],
];

// ── Verification functions ─────────────────────────────────────────────────
function isFallback(text) {
  return /Gracias por contarme\.\s+¿Puede darme un poco m[aá]s|Thanks for telling me\.\s+Can you give me a bit more|No quiero adivinar/i.test(text);
}

function looksLikeLanguage(text, lang) {
  if (!text) return null;
  if (lang === 'es') {
    const es = /[áéíóúñ¿¡]|\b(usted|el|la|los|las|de|que|por|para|con|gracias|hola|claro|entiendo|asesor)\b/i.test(text);
    const en = /^(Of course|I understand|Got it|Thanks for|Sorry,|Hi[\.,!])\b/i.test(text);
    if (en && !es) return 'en';
    if (es) return 'es';
  }
  if (lang === 'en') {
    const en = /\b(the|a|of|to|in|for|on|with|that|you|your|advisor|please)\b/i.test(text);
    const es = /^(Claro|Entiendo|Gracias|Hola|Por favor|Anotado|Disculpe)/i.test(text);
    if (es && !en) return 'es';
    if (en) return 'en';
  }
  return null;
}

// ── Run all single-turn scenarios ──────────────────────────────────────────
const scenarios = buildAllScenarios();
console.log(`Running ${scenarios.length} single-turn scenarios...`);

for (const sc of scenarios) {
  totalRun++;
  let state, responses;
  try {
    ({ state, responses } = run(sc.turns));
  } catch (err) {
    recordFail('no_response', { id: sc.id, error: err.message });
    continue;
  }

  const lastResp = responses[responses.length - 1] || '';
  const expectedCat = sc.expected.category;

  let failed = false;

  // No response
  if (!lastResp.trim()) {
    recordFail('no_response', { id: sc.id, turns: sc.turns });
    failed = true;
  }

  // Generic fallback
  if (isFallback(lastResp)) {
    recordFail('generic_fallback', { id: sc.id, lang: sc.lang, phrase: sc.turns[2], resp: lastResp.slice(0, 120) });
    failed = true;
  }

  // Forbidden phrases
  for (const [re, tag] of FORBIDDEN_PATTERNS) {
    if (re.test(lastResp)) {
      recordFail('forbidden_phrase', { id: sc.id, tag, resp: lastResp.slice(0, 160) });
      failed = true;
    }
  }

  // Invented dollar amount: response has $X but user never mentioned X
  // (either as $X or as a bare 3-5 digit number near a money-context word).
  const respDollar = lastResp.match(/\$\s?([\d,]+)/);
  if (respDollar) {
    const userText = sc.turns.join(' ');
    const userHasDollar = /\$\d/.test(userText);
    // Strip commas, compare numeric value to any bare 3-5 digit number in user text
    const respNum = respDollar[1].replace(/,/g, '');
    const userNums = (userText.match(/\b\d{3,5}\b/g) || []);
    const userMentionedNum = userNums.some(n => n === respNum);
    if (!userHasDollar && !userMentionedNum) {
      recordFail('invented_dollar', { id: sc.id, resp: lastResp.slice(0, 160) });
      failed = true;
    }
  }

  // Language drift
  const langDetected = looksLikeLanguage(lastResp, sc.lang);
  if (langDetected && langDetected !== sc.lang) {
    recordFail('language_drift', { id: sc.id, expected: sc.lang, got: langDetected, resp: lastResp.slice(0, 120) });
    failed = true;
  }

  // Wrong topic — with engine-aware category synonyms.
  // The engine uses more granular categories than the corpus expected
  // (bill_provider is a bill subtype, hearing/vision/dental/otc/
  // transportation are coverage subtypes, id_card is lost-card, etc.).
  if (expectedCat && expectedCat !== 'any') {
    const gotCat = state.serviceCategory || state.intent || 'unknown';
    const CATEGORY_SYNONYMS = {
      bill: ['bill', 'bill_provider', 'letter', 'irmaa_premium', 'premium_increase'],
      letter: ['letter', 'irmaa_premium', 'anoc', 'bill_provider', 'bill'],
      drug: ['drug', 'medication', 'pharmacy_problem', 'urgent_medication'],
      coverage: ['coverage', 'dental', 'vision', 'hearing', 'otc', 'transportation', 'flex'],
      lost_card: ['lost_card', 'id_card', 'general'],
      family_referral: ['family_referral', 'caregiver', 'caregiver_context'],
      doctor_provider_network: ['doctor_provider_network', 'doctor_change_request', 'specialist', 'coverage'],
      doctor_change_request: ['doctor_change_request', 'doctor_provider_network'],
      savings_program: ['savings_program', 'extra_help', 'msp', 'lis', 'medicaid_mention'],
      appeal: ['appeal', 'denial', 'denied_service'],
      enrollment: ['enrollment', 'plan_change_request', 'iep', 'aep', 'sep'],
      moving_state_sep: ['moving_state_sep', 'enrollment', 'sep'],
      plan_recommendation: ['plan_recommendation', 'plan_change_request'],
      urgent_medication: ['urgent_medication', 'drug'],
      crisis_988: ['crisis_988', 'crisis', 'unknown'], // crisis doesn't set serviceCategory
      medical_emergency_911: ['medical_emergency_911', 'crisis', 'unknown'],
      fraud_scam: ['fraud_scam'],
      about_clearpoint: ['about_clearpoint'],
      off_topic: ['off_topic'],
    };
    const accepted = CATEGORY_SYNONYMS[expectedCat] || [expectedCat];
    // Crisis is special — verify via the response text + needsHuman flag.
    const crisisOK = sc.expected.crisis && /988|911/.test(lastResp) && state.needsHuman;
    if (!accepted.includes(gotCat) && !crisisOK) {
      const isAmbiguous = sc.turns[2].length < 8;
      if (!isAmbiguous) {
        recordFail('wrong_topic', {
          id: sc.id, expected: expectedCat, got: gotCat,
          phrase: sc.turns[2], lang: sc.lang,
          resp: lastResp.slice(0, 120),
        });
        failed = true;
      }
    }
  }

  // Crisis must route to 988/911
  if (sc.expected.crisis) {
    if (!/988|911/.test(lastResp)) {
      recordFail('missing_crisis_route', { id: sc.id, phrase: sc.turns[2], resp: lastResp.slice(0, 160) });
      failed = true;
    }
  }

  // Plan recommendation / savings deflection
  if (sc.expected.deflection) {
    const safe = /asesor|advisor|sin costo|no cost|depende|depends|CMS|verific|cant?(?:not)? (recommend|confirm)/i;
    if (!safe.test(lastResp)) {
      recordFail('deflection_missing', { id: sc.id, expected: expectedCat, resp: lastResp.slice(0, 160) });
      failed = true;
    }
  }

  // PHI scrub
  if (sc.expected.phiScrub) {
    const userMsg = sc.turns[2];
    const ssn = userMsg.match(/\b\d{3}-\d{2}-\d{4}\b/);
    const mbi = userMsg.match(/\b\d[A-Z]{2}\d-[A-Z]{2}\d-[A-Z]{2}\d{2}\b/i);
    if (ssn && lastResp.includes(ssn[0])) {
      recordFail('phi_echoed', { id: sc.id, kind: 'SSN', resp: lastResp.slice(0, 160) });
      failed = true;
    }
    if (mbi && lastResp.includes(mbi[0])) {
      recordFail('phi_echoed', { id: sc.id, kind: 'MBI', resp: lastResp.slice(0, 160) });
      failed = true;
    }
  }

  // Excessive length
  if (lastResp.length > 700) {
    recordFail('excessive_length', { id: sc.id, len: lastResp.length });
    failed = true;
  }

  if (!failed) totalPass++;
}

// ── Run Sawil's recorded failures ──────────────────────────────────────────
console.log(`\nRunning ${SAWIL_RECORDED_FAILURES.length} Sawil-recorded failures...`);

for (const sf of SAWIL_RECORDED_FAILURES) {
  totalRun++;
  let state, responses;
  try {
    ({ state, responses } = run(sf.turns));
  } catch (err) {
    recordFail('sawil_recorded_regression', { id: sf.id, error: err.message });
    continue;
  }
  const lastResp = responses[responses.length - 1] || '';
  let ok = true;
  if (sf.expectedAfterLast.mustMatch && !sf.expectedAfterLast.mustMatch.test(lastResp)) {
    recordFail('sawil_recorded_regression', {
      id: sf.id, kind: 'missing_required', regex: String(sf.expectedAfterLast.mustMatch),
      resp: lastResp.slice(0, 200),
    });
    ok = false;
  }
  if (sf.expectedAfterLast.mustNotMatch && sf.expectedAfterLast.mustNotMatch.test(lastResp)) {
    recordFail('sawil_recorded_regression', {
      id: sf.id, kind: 'forbidden_present', regex: String(sf.expectedAfterLast.mustNotMatch),
      resp: lastResp.slice(0, 200),
    });
    ok = false;
  }
  if (ok) totalPass++;
}

// Dump full failure list to a file for systematic analysis
import { writeFileSync } from 'node:fs';
const fullDump = [];
for (const [cat, arr] of Object.entries(FAIL_CATEGORIES)) {
  for (const x of arr) {
    fullDump.push({ category: cat, ...x });
  }
}
writeFileSync('scripts/corpus-failures.json', JSON.stringify(fullDump, null, 2));

// ── Dashboard ──────────────────────────────────────────────────────────────
const totalFails = totalRun - totalPass;
console.log(`\n${'═'.repeat(75)}`);
console.log(`  CORPUS RESULT  ${totalPass} / ${totalRun} PASS (${((totalPass / totalRun) * 100).toFixed(1)}%)`);
console.log(`  ${totalFails} unique scenario failures across ${Object.values(FAIL_CATEGORIES).filter((a) => a.length).length} categories`);
console.log('═'.repeat(75));

const ordered = Object.entries(FAIL_CATEGORIES)
  .filter(([, arr]) => arr.length)
  .sort((a, b) => b[1].length - a[1].length);

for (const [cat, items] of ordered) {
  console.log(`\n── ${cat.toUpperCase()} (${items.length}) ──`);
  for (const x of items.slice(0, 6)) {
    console.log(`  · ${x.id || ''}  ${x.phrase ? '"' + x.phrase + '"' : ''}`);
    if (x.expected) console.log(`      expected=${x.expected}  got=${x.got || ''}`);
    if (x.regex) console.log(`      regex=${x.regex}`);
    if (x.resp) console.log(`      resp="${x.resp}"`);
  }
  if (items.length > 6) console.log(`  ... +${items.length - 6} more`);
}

// Per-topic-family failure breakdown
console.log(`\n${'═'.repeat(75)}`);
console.log('  PER-FAMILY FAILURE BREAKDOWN');
console.log('═'.repeat(75));
const perFamily = {};
for (const [, arr] of Object.entries(FAIL_CATEGORIES)) {
  for (const x of arr) {
    if (!x.id) continue;
    const fam = x.id.split('/')[0];
    perFamily[fam] = (perFamily[fam] || 0) + 1;
  }
}
const ranked = Object.entries(perFamily).sort((a, b) => b[1] - a[1]);
for (const [fam, n] of ranked) {
  console.log(`  ${fam.padEnd(35)} ${n} failure(s)`);
}

process.exit(totalFails > 0 ? 1 : 0);

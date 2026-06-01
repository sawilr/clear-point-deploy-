// Multi-turn corpus runner. Plays every scenario turn by turn and validates
// after EACH user message. Reports every per-turn failure.

import { createInitialState, processMessage } from '../src/lib/customerServiceEngine.ts';
import { MULTI_TURN_SCENARIOS } from './multi-turn-corpus.mjs';

let totalChecks = 0;
let passed = 0;
const failures = [];

function check(scenarioId, turnIdx, label, ok, detail) {
  totalChecks++;
  if (ok) {
    passed++;
  } else {
    failures.push({ scenarioId, turnIdx, label, detail });
  }
}

function _norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[*_`]/g, '')
    .trim();
}

console.log(`Running ${MULTI_TURN_SCENARIOS.length} multi-turn scenarios...\n`);

for (const sc of MULTI_TURN_SCENARIOS) {
  let state = createInitialState();
  const responses = [];

  for (let ti = 0; ti < sc.turns.length; ti++) {
    const turn = sc.turns[ti];
    const r = processMessage(turn.msg, state);
    state = r.newState;
    const resp = r.response || '';
    responses.push(resp);

    // mustMatch check
    if (turn.mustMatch) {
      const ok = turn.mustMatch.test(resp);
      check(sc.id, ti, `mustMatch ${turn.mustMatch}`, ok, { user: turn.msg, resp: resp.slice(0, 200) });
    }

    // mustNotMatch check
    if (turn.mustNotMatch) {
      const ok = !turn.mustNotMatch.test(resp);
      check(sc.id, ti, `mustNotMatch ${turn.mustNotMatch}`, ok, { user: turn.msg, resp: resp.slice(0, 200) });
    }

    // No-response check (always implicit)
    if (!resp || !resp.trim()) {
      check(sc.id, ti, 'no_empty_response', false, { user: turn.msg, resp: '<empty>' });
    } else {
      check(sc.id, ti, 'no_empty_response', true);
    }
  }

  // universalCheck: no_exact_repeat — no two non-trivial bot responses identical
  if (sc.universalCheck === 'no_exact_repeat') {
    const seen = new Map();
    for (let i = 0; i < responses.length; i++) {
      const key = _norm(responses[i]);
      if (!key || key.length < 30) continue; // skip tiny / empty
      if (seen.has(key)) {
        check(sc.id, i, `no_exact_repeat (also seen at turn ${seen.get(key)})`, false, {
          user: sc.turns[i].msg,
          resp: responses[i].slice(0, 200),
        });
      } else {
        seen.set(key, i);
        check(sc.id, i, 'no_exact_repeat', true);
      }
    }
  }
}

console.log('═'.repeat(75));
console.log(`  MULTI-TURN: ${passed} / ${totalChecks} checks (${(passed / totalChecks * 100).toFixed(1)}%)`);
console.log(`  ${failures.length} failure(s) across ${new Set(failures.map(f => f.scenarioId)).size} scenarios`);
console.log('═'.repeat(75));

if (failures.length) {
  // Group by scenario id
  const byScen = new Map();
  for (const f of failures) {
    if (!byScen.has(f.scenarioId)) byScen.set(f.scenarioId, []);
    byScen.get(f.scenarioId).push(f);
  }
  for (const [id, fs] of byScen) {
    console.log(`\n── ${id} ──`);
    for (const f of fs.slice(0, 4)) {
      console.log(`  turn ${f.turnIdx}: ${f.label}`);
      if (f.detail) {
        console.log(`    user: "${f.detail.user}"`);
        console.log(`    resp: "${f.detail.resp}"`);
      }
    }
    if (fs.length > 4) console.log(`  …and ${fs.length - 4} more`);
  }
  process.exit(1);
}

process.exit(0);

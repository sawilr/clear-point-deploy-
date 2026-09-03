// ─────────────────────────────────────────────────────────────────────────────
// ENTITY SCOPE LOCK — deterministic Medicare entity scoping + relevance gate.
// 2026-08-15 — PARTD-001 remediation (Sawil live finding 2026-08-14).
//
// THE INCIDENT. "¿Qué es la Parte D y cómo funciona el deducible de medicinas?"
// was answered with the Part B ($283) and Part A ($1,736) deductibles nobody
// asked about. The KB figures were correct — the failure was RELEVANCE: a
// shared word ("deducible") is not permission to cross entity boundaries.
//
// WHY A DETERMINISTIC GATE AND NOT (ONLY) A PROMPT RULE. Commit 3712b92 added
// the PART-SPECIFIC FIGURES hard rule to the system prompt and measured 0/4
// leaks after (was reproducible before). But these models reject `temperature`
// — sampling is theirs — so a prompt rule lowers the leak PROBABILITY and can
// never make it zero. This module is the output-side guarantee: even when the
// model volunteers a foreign Part's costs, the sentence does not survive to the
// caller. Instruction steers; the gate enforces (mission §6/§22/§43).
//
// SCOPE OF THE GATE — deliberately narrow, false-positive-averse:
//   • It acts ONLY when the caller's request resolves to explicit entity scope
//     (empty scope = gate inactive; a general "how do Medicare costs work?"
//     survey is legitimate).
//   • It strips SENTENCES that attribute COST information (a dollar figure or a
//     cost keyword) to a Medicare PART (or Medigap) OUTSIDE the requested
//     scope. A bare contrastive mention with no cost content ("la Parte D es
//     separada de la Parte B") is pedagogy, not leakage, and survives.
//   • Assistance programs (Extra Help/LIS, MSP, Medicaid) are NEVER stripped:
//     routing a cost-burdened caller toward help is Clara's job (§5.2 — the
//     cross-reference is materially necessary), and those references carry no
//     figures by KB design.
//   • Comparison questions put every named entity in scope, so nothing the
//     caller asked to compare is ever removed (CROSS-SCOPE-001).
//   • FAIL-SAFE: the gate never empties a reply. If stripping would leave no
//     substantive text, the original reply is returned untouched and the event
//     is only logged — a wrong answer visible is better than a blank bubble,
//     and the log makes it findable.
//
// A stripped sentence is logged by the caller as SCOPE_LEAK_PREVENTED (§51).
// ─────────────────────────────────────────────────────────────────────────────

const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Entity detectors — explicit implication only. A shared noun ("deducible",
// "prima", "costo") NEVER creates scope by itself.
const ENTITY_RES = {
  A: [
    /\bpart[e]?\s*a\b/,
    // "deducible del hospital" / "hospital deductible" is the Part A deductible
    // in Medicare speech — the entity is implicated even without the letter.
    /\bhospital\b[^.?!]{0,40}\bdeducibl|deductible\b[^.?!]{0,40}\bhospital\b|deducible\b[^.?!]{0,40}\bhospital\b/,
  ],
  B: [/\bpart[e]?\s*b\b/, /\bla\s+be\b/],
  C: [/\bpart[e]?\s*c\b/, /\bmedicare\s+advantage\b/, /\badvantage\b/],
  D: [
    /\bpart[e]?\s*d\b/,
    // Drug-coverage phrasings imply Part D without naming it.
    /\bplan(es)?\s+de\s+medicament/, /\bdrug\s+plan\b/, /\bpdp\b/,
    /\bdeducibl\w*\s+de\s+(las\s+)?medicin/, /\bdeducibl\w*\s+de\s+(los\s+)?medicament/,
    /\b(prescription|drug)\s+deductible\b/,
    // RED TEAM 2026-08-15 (triaged) — colloquial medication follow-ups ("¿y la
    // de medicinas?", "lo de mis medicamentos") implicate Part D without any of
    // the shapes above. Scoping D on a bare medication mention is safe in this
    // gate's one direction: it can only ever PREVENT foreign Part figures from
    // entering a medication answer — the classic B-premium-in-a-drug-question
    // confusion — never inject anything.
    /\bmedicin(a|as)\b/, /\bmedicament\w*/, /\bmedication(s)?\b/, /\bprescription(s)?\b/, /\breceta(s)?\b/,
  ],
  MEDIGAP: [/\bmedigap\b/, /\bsuplement(o|al|ario)?\b/, /\bsupplement(al)?\b/],
  LIS: [/\bextra\s+help\b/, /\blis\b/, /\bsubsidio\s+por\s+bajos?\s+ingresos?\b/, /\blow[- ]income\s+subsidy\b/],
  MSP: [/\bmsp\b/, /\bmedicare\s+savings\b/, /\bqmb\b/, /\bslmb\b/, /\bqi\b/, /\bprogramas?\s+de\s+ahorros?\s+de\s+medicare\b/],
  MEDICAID: [/\bmedicaid\b/],
};

// The entities the gate is allowed to STRIP when out of scope. Assistance
// programs are deliberately absent — see header.
const STRIPPABLE = ['A', 'B', 'C', 'D', 'MEDIGAP'];

// Cost attribution — a sentence must carry one of these to be strippable.
// RED TEAM 2026-08-15 (triaged) — cost VERBS added: "La Parte B le costará
// doscientos ochenta y tres dólares" carries no digit and no cost noun, and
// slipped the first version. Verbs of paying/costing are cost attribution.
const COST_SIGNAL_RE = /\$\s?\d|\d+(?:[.,]\d{3})*(?:\.\d{2})?\s?(?:d[oó]lares|dollars)\b|\bd[oó]lares\b|\bdollars\b|\bdeducibl|\bdeductible|\bprima|\bpremium|\bcopago|\bcopay|\bcoseguro|\bcoinsurance|\bcosto\s+compartido|\bcost[- ]sharing|\bcuesta\w*|\bcostar[aá]?\b|\bcost(s|ed)?\b|\bpagar[aá]?\b|\bpaga(n)?\b|\bpay(s|ing)?\b/i;

// Sentences that must NEVER be stripped regardless of entity content: the
// advisor pathway and safety copy. (Escalation offers sometimes name a Part.)
const PROTECTED_RE = /\basesor|advisor|licencia|licensed|911|988|1-8\d{2}-\d{3}-\d{4}/i;

/** Which Medicare entities does THIS text explicitly implicate? */
export function detectEntities(text) {
  const t = _norm(text);
  const found = [];
  for (const tag of Object.keys(ENTITY_RES)) {
    if (ENTITY_RES[tag].some((re) => re.test(t))) found.push(tag);
  }
  return found;
}

/**
 * Resolve the REQUESTED scope for the current turn.
 * Current message wins; when it names no entity (a follow-up like "¿y el
 * deducible?"), inherit from the most recent prior USER turn that named one —
 * conversation continuity without inventing context (§36: use history if
 * clear; empty scope when genuinely ambiguous).
 * @param {string} userMessage  current (scrubbed) message
 * @param {string[]} priorUserTexts  prior user turns, oldest→newest
 */
export function resolveScope(userMessage, priorUserTexts) {
  const current = detectEntities(userMessage);
  if (current.length) return { entities: current, source: 'current' };
  const prior = Array.isArray(priorUserTexts) ? priorUserTexts : [];
  // RED TEAM 2026-08-15 (CONFIRMED P2) — the lookback counts only SUBSTANTIVE
  // turns. The first version consumed the 3-turn window on contentless
  // acknowledgments, so a Part D thread padded with "si" / "ok" / "gracias"
  // lost its scope and the verified end-to-end repro delivered the original
  // PARTD-001 leak ($283 + $1,736) unfiltered. Filler is skipped (bounded at
  // 10 total turns so a hostile history cannot make this a scan).
  // AUDIT 2026-09-03 (R2-C13a, P1) — the substantive-turn decay (`seen < 3`)
  // disarmed the gate on ordinary live threads: a Part D conversation with
  // three entity-free follow-ups ("how do I sign up?", "what documents?",
  // "can my daughter help?") lost scope entirely, and with empty scope BOTH
  // halves of the PARTD-001 control (scope note + output gate) went dark —
  // executed repro delivered $283/$1,736 into a Part D thread unfiltered.
  // Now the full bounded window is walked: the most recent entity-bearing
  // user turn within the last 10 wins. The current message still wins over
  // history (a topic change that names any entity re-scopes immediately),
  // and the gate's fail-safe still prevents over-stripping from stale scope.
  for (let i = prior.length - 1, walked = 0; i >= 0 && walked < 10; i--, walked++) {
    const inherited = detectEntities(String(prior[i] || ''));
    if (inherited.length) return { entities: inherited, source: 'inherited' };
  }
  return { entities: [], source: 'none' };
}

/** Split into sentences, keeping bullets/newline items as units. */
function _sentences(text) {
  const out = [];
  for (const line of String(text).split(/\n/)) {
    if (!line.trim()) { out.push({ raw: line, sep: '\n' }); continue; }
    const parts = line.split(/(?<=[.!?…])\s+/);
    for (let i = 0; i < parts.length; i++) {
      out.push({ raw: parts[i], sep: i === parts.length - 1 ? '\n' : ' ' });
    }
    out[out.length - 1].sep = '\n';
  }
  if (out.length) out[out.length - 1].sep = '';
  return out;
}

/**
 * Deterministic relevance gate over the FINAL reply text.
 * Strips sentences that attribute cost information to a strippable entity the
 * caller did not ask about. Never strips protected copy; never empties a reply.
 * @returns {{ text: string, strippedEntities: string[], strippedCount: number }}
 */
export function scopeGate(text, scopeEntities) {
  const scope = Array.isArray(scopeEntities) ? scopeEntities : [];
  if (!text || scope.length === 0) return { text, strippedEntities: [], strippedCount: 0, failSafe: false };

  const foreign = STRIPPABLE.filter((e) => scope.indexOf(e) === -1);
  if (foreign.length === 0) return { text, strippedEntities: [], strippedCount: 0, failSafe: false };

  // RED TEAM 2026-08-15 — in GATE context the Part C matcher must be strict:
  // the bare /\badvantage\b/ that is right for QUESTION parsing ("tell me about
  // advantage") false-positives on reply idiom ("you can take advantage of
  // lower copays") and would strip an in-scope benefits sentence. Questions
  // keep the loose matcher via detectEntities; sentences here use this one.
  // Same strictness for Part D: the loose medication patterns that are right
  // for QUESTION parsing ("¿y la de medicinas?" implicates D) would make the
  // gate read "los genéricos pueden costar menos" inside a Part B answer as a
  // foreign-D cost sentence and strip legitimate content. Sentence-side
  // matchers demand the Part be NAMED (or its unambiguous plan shapes).
  const gateRes = {
    ...ENTITY_RES,
    C: [/\bpart[e]?\s*c\b/, /\bmedicare\s+advantage\b/, /\b(plan(es)?\s+advantage|advantage\s+plans?)\b/],
    D: [/\bpart[e]?\s*d\b/, /\bplan(es)?\s+de\s+medicament/, /\bdrug\s+plan\b/, /\bpdp\b/, /\bdeducibl\w*\s+de\s+(las\s+)?medicin/, /\bdeducibl\w*\s+de\s+(los\s+)?medicament/, /\b(prescription|drug)\s+deductible\b/],
  };
  const _hitTags = (n) => foreign.filter((tag) => gateRes[tag].some((re) => re.test(n)));
  const _inScope = (n) => scope.some((tag) => (gateRes[tag] || ENTITY_RES[tag] || []).some((re) => re.test(n)));
  const _anyEntity = (n) => Object.keys(gateRes).some((tag) => gateRes[tag].some((re) => re.test(n)));
  // AUDIT 2026-09-03 (R2-C13b) — assistance tags for the chain rule below.
  const _namesAssistance = (n) => ['LIS', 'MSP', 'MEDICAID'].some((tag) => gateRes[tag].some((re) => re.test(n)));
  const _namesStrippable = (n) => STRIPPABLE.some((tag) => gateRes[tag].some((re) => re.test(n)));
  const DOLLAR_RE = /\$\s?\d|\d+(?:[.,]\d{3})*(?:\.\d{2})?\s?(?:d[oó]lares|dollars)\b/i;
  // AUDIT 2026-09-03 (R2-C13c) — spelled-out amounts ("doscientos dos dólares",
  // "two hundred dollars") carried no digit, so DOLLAR_RE-gated rules (the
  // PROTECTED ride-along override and the mixed-figure exemption) never saw
  // them. Number-word + currency-word adjacency is a hard figure too.
  const VERBAL_AMOUNT_RE = /\b(?:un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?s?|mil|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b[^.!?]{0,40}\b(?:d[oó]lares|dollars)\b/i;
  const _hasFigure = (raw) => DOLLAR_RE.test(raw) || VERBAL_AMOUNT_RE.test(raw);

  const kept = [];
  const strippedEntities = [];
  let strippedCount = 0;
  // RED TEAM 2026-08-15 (CONFIRMED P1) — ORPHAN CHAIN. The model routinely
  // separates attribution from amount: "La Parte B también tiene deducible.
  // Es de $283 al año." Stripping only the attribution sentence kept the
  // orphaned figure, and the rebuilt reply attributed $283 (verified variant:
  // $1,736 — the exact incident figure) to the IN-SCOPE Part — a
  // misattribution strictly worse than the original leak. After stripping a
  // sentence, subsequent sentences that carry cost content but NO entity of
  // their own are its continuations and are stripped with it; the chain stops
  // at the first sentence that names any entity or has no cost signal.
  let chainFromStrip = false;

  for (const s of _sentences(text)) {
    const n = _norm(s.raw);
    if (!n.trim()) { kept.push(s); chainFromStrip = false; continue; }
    const hits = _hitTags(n);
    const inScopeToo = _inScope(n);
    const hasDollar = _hasFigure(s.raw);
    // RED TEAM 2026-08-15 (triaged claim, reproduced) — PROTECTED_RE must NOT
    // immunize a sentence that itself carries a foreign-Part DOLLAR figure
    // ("Un asesor puede explicarle; el deducible de la Parte B es $283."):
    // protection is for the advisor/safety pathway, not a ride-along channel
    // for the exact leak this gate exists to stop.
    if (PROTECTED_RE.test(s.raw) && !(hits.length && hasDollar)) { kept.push(s); chainFromStrip = false; continue; }
    // AUDIT 2026-09-03 (R2-C13b, P1) — the chain used to stop at ANY entity,
    // including non-strippable assistance tags, so "Con Extra Help, esos $283
    // pueden bajar…" rode the chain out of a stripped Part B sentence and the
    // anaphor re-attributed the foreign figure to the asked-about Part
    // (executed repro, EN+ES; the log even said SCOPE_LEAK_PREVENTED while the
    // figure shipped). A chain continuation naming ONLY an out-of-scope
    // assistance program while carrying a hard figure is still the orphaned
    // foreign amount — stripped. Figure-FREE assistance routing copy is
    // untouched (the KB never puts figures in those sentences by design).
    if (chainFromStrip && COST_SIGNAL_RE.test(s.raw)
        && (!_anyEntity(n)
            || (_namesAssistance(n) && !_namesStrippable(n) && !_inScope(n) && _hasFigure(s.raw)))) {
      strippedCount++; // orphaned continuation of a stripped attribution
      continue;
    }
    // RED TEAM 2026-08-15 (triaged claim, reproduced) — MIXED-FIGURE SENTENCES.
    // The inScopeToo exemption existed for figure-free contrast ("a diferencia
    // del deducible de la Parte B, el de la Parte D varía") and that stays.
    // But "…y el de la Parte B es de $283" inside a Part D sentence hands the
    // caller the foreign figure anyway — a mixed sentence WITH a dollar amount
    // is exactly the senior-confusing construction, so the exemption yields
    // when hard figures are present.
    const leak = hits.length && COST_SIGNAL_RE.test(s.raw) && (!inScopeToo || hasDollar);
    if (leak) {
      strippedCount++;
      for (const h of hits) if (strippedEntities.indexOf(h) === -1) strippedEntities.push(h);
      chainFromStrip = true;
      continue;
    }
    kept.push(s);
    chainFromStrip = false;
  }

  if (strippedCount === 0) return { text, strippedEntities: [], strippedCount: 0, failSafe: false };

  const rebuilt = kept.map((s) => s.raw + s.sep).join('').replace(/\n{3,}/g, '\n\n').trim();
  // FAIL-SAFE — never hand the caller a blank bubble.
  // RED TEAM 2026-08-15 (CONFIRMED P2) — the fail-safe path must be VISIBLE.
  // The first version returned strippedCount:0 here, so the WORST leak (a
  // reply that is 100% foreign cost content) produced no log line and an audit
  // record claiming a clean turn. The counts now report what WOULD have been
  // stripped and failSafe:true, so the caller logs SCOPE_LEAK_UNRESOLVED and
  // §51 monitoring sees exactly the events it most needs.
  if (!/[\p{L}\p{N}]/u.test(rebuilt)) {
    return { text, strippedEntities, strippedCount, failSafe: true };
  }
  return { text: rebuilt, strippedEntities, strippedCount, failSafe: false };
}

/** One dynamic-context line steering the model BEFORE generation (the cheap
 *  half of the control; the gate above is the guarantee). English — the
 *  instruction language of the system prompt. */
export function buildScopeNote(scopeEntities) {
  if (!scopeEntities || !scopeEntities.length) return '';
  const names = {
    A: 'Part A', B: 'Part B', C: 'Medicare Advantage (Part C)', D: 'Part D',
    MEDIGAP: 'Medigap', LIS: 'Extra Help/LIS', MSP: 'MSP', MEDICAID: 'Medicaid',
  };
  const list = scopeEntities.map((e) => names[e] || e).join(', ');
  return 'SCOPE THIS TURN: the caller is asking about ' + list + ' ONLY. Do not state premiums, deductibles or other cost figures for any OTHER Medicare Part in this reply (hard rule — see PART-SPECIFIC FIGURES).';
}

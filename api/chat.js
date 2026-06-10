// Vercel Serverless Function — ClearPoint CSA bot LLM bridge.
// Calls Claude Haiku 4.5 with a strict system prompt that enforces CMS
// TPMO 422.2267 compliance. The API key lives ONLY server-side; the
// browser never sees it.
//
// PHASE A15 — Security hardening layers:
//   1. Origin / CORS allowlist (only our domain + Vercel previews)
//   2. Per-IP rate limit (30 msgs / 5 min, KV-backed)
//   3. Prompt-injection guard (rejects jailbreak / role-override attempts)
//   4. Compliance post-filter v2 (carrier names, eligibility, etc.)
//   5. Conversation history cap (max 12 turns)
//
// Cost target: $0.005–$0.020 per conversation (Haiku + prompt caching).

import { checkPromptInjection } from './_lib/prompt-guard.js';
import { scrubPHI } from './_lib/phi-scrub.js';
import { complianceFilter } from './_lib/compliance-filter.js';
import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// ── System prompt — ClearPoint identity, CMS TPMO compliance, behavior ──
// Cached on Anthropic's side so it only costs the full price on the FIRST
// turn of each conversation. Subsequent turns pay ~10% of the system prompt.
const SYSTEM_PROMPT = `You are the customer service assistant for **ClearPoint Senior Advisors**, an independent licensed Medicare broker serving **New York, New Jersey, and Connecticut**. (Florida pending authorization — do not claim service in FL.)

# Products ClearPoint CURRENTLY offers (advisors can connect callers about these)
- Medicare Advantage (Part C) plans
- Stand-alone Part D drug plans
- General Medicare guidance / education

# Programs ClearPoint EDUCATES on (NOT services we offer or enroll for — explain how to apply if the caller may qualify, then refer to the agency)
- **Extra Help / Low-Income Subsidy (LIS)** — describe what it is (federal program that lowers Part D costs for low-income), tell the caller they may apply through the Social Security Administration online at ssa.gov/extrahelp or by phone at 1-800-772-1213. ClearPoint can review their plan options once they know if they qualify, but we are NOT the enrollment path for Extra Help itself. Never say "we help you apply for Extra Help" — say "you apply through Social Security and we can help with your Medicare plan once you know your status."
- **Medicare Savings Programs (MSP / QMB / SLMB / QI / QDWI)** — describe what they are (state Medicaid programs that help pay Part B premium and sometimes other costs). Tell the caller they apply through their state Medicaid office or local agency. ClearPoint is NOT the enrollment path for MSP. Refer to: NY State Medicaid (1-800-541-2831), NJ MED-NJ (1-800-356-1561), CT Department of Social Services (1-855-626-6632).

# Products ClearPoint does NOT currently offer (you may EXPLAIN, but never offer to connect an advisor for these specifically)
- **Medicare Supplement / Medigap** — explain how it works in general if asked, then say: "ClearPoint does not currently offer Medigap, but I can explain how it works in general. For a Medigap plan, you'd need to work with a broker who specializes in those." Do NOT say "a ClearPoint advisor can review Medigap options for you."

# Pre-FL: do NOT include Florida in lists of states served
When listing the states ClearPoint serves, say only "New York, New Jersey, and Connecticut" / "Nueva York, Nueva Jersey, y Connecticut".

# Helpful links
These are real ClearPoint pages the site serves (relative paths). When guiding a caller to learn more about a topic we cover, you MAY include the relevant ClearPoint page link inline (e.g. "puede leer más en /extra-help" / "you can read more at /extra-help"). Only link pages that exist (the list below). Never invent URLs.
- Extra Help / LIS info: /extra-help
- Medicare Advantage info: /medicare-advantage
- Medicare Supplement / Medigap info: /medicare-supplement
- Part D drug plans info: /part-d
- Resources hub: /resources
Official, non-ClearPoint references you may also cite when relevant: Medicare.gov, 1-800-MEDICARE (1-800-633-4227), and your local SHIP (shiptacenter.org).

You serve BOTH current ClearPoint clients AND visitors who simply have Medicare questions — both groups are welcome. You are NOT a sales bot. You are a warm, patient, intelligent assistant whose job is to:
- LISTEN to the caller carefully
- UNDERSTAND their situation (often callers are seniors confused or worried)
- give compliant general information about Medicare
- connect them with a licensed advisor when appropriate

# Tone — always
- Warm, courteous, never robotic.
- Patient — seniors may need extra time and reassurance.
- Professional but human. Sound like a kind, knowledgeable receptionist, not a chatbot.
- Acknowledge feelings when the caller is worried, frustrated, or confused ("Entiendo que esto puede ser confuso" / "I understand this can be confusing").
- **SPANISH USTED FORM IS MANDATORY.** Use SU (not TU), TIENE (not TIENES), PUEDE (not PUEDES), CALIFICA (not CALIFICAS), LE LLAMARÁ (not TE LLAMARÁ), CON USTED (not CONTIGO). Tutear (using TÚ form) with a Spanish-speaking senior is disrespectful and forbidden. A post-filter will catch slips but you MUST get it right.
- Concise — 2–4 sentences typically. Long lists overwhelm.

# Lead with help, don't interrogate (THIS is what makes you premium, not junior)
A great Medicare CSR delivers VALUE on the very first substantive turn, then asks ONE focused question — never a checklist, never a question when you could give an answer. When the caller describes a situation, your reply structure is: (1) acknowledge the feeling in ONE short line, (2) give the relevant compliant explanation of what is likely going on AND their general options, and ONLY THEN (3) ask at most one question, or offer the advisor. Do NOT open with a question when you can open with help.
- Example — caller: "mi doctor dice que debo cambiar de plan."
  - WEAK (junior interrogation): "¿Quién le dijo que cambie, el especialista o el plan?"
  - PREMIUM (lead with help): "Entiendo. Cuando un doctor dice eso, casi siempre es porque el proveedor va a salir de la red del plan o el plan cambió — no significa que usted tenga que cambiar a ciegas. Un asesor licenciado puede verificarlo con su plan y ver si aplica un Período Especial de Inscripción, sin costo. ¿Quiere que lo coordine?"
- HARD LIMIT: never ask more than TWO clarifying questions about the same issue. By the second exchange, either give concrete help or offer the licensed advisor. Never loop, never re-list a menu.
- Never re-ask anything already in the [Context for this turn] block (ZIP, name, phone, language).

# One high-value qualifier (Medicaid / Extra Help)
When the conversation is about plans, coverage, costs, or you are setting up an advisor callback/handoff, it is very helpful to know ONE thing: whether the caller has **Medicaid or Extra Help (Ayuda Extra / LIS)**. People who have either qualify for different plans (D-SNP), so the advisor needs to know. Ask it ONCE, naturally, only when relevant — e.g. "One quick thing so the advisor can prepare: do you have Medicaid or Extra Help?" / "Una cosa rápida para que el asesor se prepare: ¿tiene Medicaid o Extra Help (Ayuda Extra)?". This is program STATUS only — NEVER ask about income amounts, health conditions, Social Security number, or Medicare ID. If they don't know, that is fine, move on. Do not ask it more than once.

# Current Medicare figures — 2026 (USE THESE; never cite older years)
It is 2026. When asked about STANDARD Medicare costs, you MAY state these public, official figures confidently — they are facts, not a plan recommendation:
- Part B standard premium: $202.90/month (2026). It can be HIGHER for higher incomes (IRMAA).
- Part B annual deductible: $283 (2026).
- Part A inpatient hospital deductible: $1,736 per benefit period (2026).
- Part D out-of-pocket cap: $2,100 (2026) — once a member's covered drug costs reach this, they pay $0 for covered drugs the rest of the year.
NEVER cite a figure from an older year (2024's $164.90 Part B premium is WRONG now). If you do not have the current figure for something, say so plainly and explain what it depends on — never invent a number. The person's EXACT Part B premium depends on their income, so for their personal amount the Social Security Administration (1-800-772-1213) or Medicare.gov has it — but LEAD with the standard figure first; never just send them away as if you don't know.

# Your scope
- Medicare topics: Parts A / B / C / D, Medicare Advantage, Medigap / Medicare Supplement, Part D drug plans, Extra Help / LIS, Medicare Savings Programs (MSP / QMB / SLMB / QI), enrollment (IEP / AEP / SEP), Original Medicare vs Advantage, dental / vision / hearing / OTC supplemental benefits, doctor / hospital / provider network issues, drug / pharmacy / formulary issues, letters / bills / EOBs, appeals / denials, identity / fraud / scam concerns.
- Caregivers calling on behalf of a parent / spouse / family member.
- ClearPoint business questions: who we are, how we work, no-cost service, advisor licensing, how we got their info.

# CRITICAL COMPLIANCE RULES (CMS TPMO 422.2267 — NEVER VIOLATE)

You MUST NEVER:
1. **Recommend a specific Medicare plan, carrier, or product.** Not by name, not by hint. ("UnitedHealth has a great plan" — FORBIDDEN.)
2. **Confirm a beneficiary's eligibility for anything** (Medicare, Medicaid, Extra Help, MSP, SEP, etc.). You can describe what programs exist; you can NEVER say "you qualify" / "you are eligible." Only Medicare, the state Medicaid agency, or a licensed advisor can confirm eligibility.
3. **Confirm whether a specific doctor / hospital / specialist is in network** for any plan. Networks change daily. Only the carrier's provider directory or a licensed advisor can confirm.
4. **Confirm whether a specific drug is covered** by any plan. Formularies change. Only the plan's formulary lookup or a licensed advisor can confirm.
5. **Ask for or accept**: Medicare ID / MBI, SSN, banking info, full date of birth, diagnosis details, prescription names, or any PHI. If a caller starts to share PHI, gently stop them ("please don't share that here — for your safety").
6. **Claim affiliation with Medicare, CMS, SSA, Medicaid, or "the government."** ClearPoint is an INDEPENDENT licensed broker. If asked: "We are not Medicare or the government — ClearPoint is an independent licensed insurance broker."
7. **Promise outcomes** ("you'll save $X / your premium will drop / your doctor will be covered"). You can describe HOW programs work, not what the caller will personally get.

You MUST ALWAYS:
- **Suicidal or self-harm content** → IMMEDIATELY direct to 988 (Suicide & Crisis Lifeline): "988 is the Suicide and Crisis Lifeline — please call or text them right now. They have Spanish speakers." Do NOT continue Medicare flow until this is acknowledged.
- **Medical emergency** ("chest pain", "stroke", "can't breathe", "me duele el pecho", "infarto") → IMMEDIATELY: "Please call 911 now. After you're safe, we can help with the Medicare side."
- **Detect language** of the caller's last message and respond in that language. Spanish callers get USTED form, never tú. English callers get warm, plain American English. If the caller switches mid-conversation, switch with them.
- **Stay brief.** 2–4 sentences typical. Long lists overwhelm seniors. If the topic needs more, end with a concrete next question or offer the advisor.
- **When you can't answer compliantly**, say so plainly and offer the advisor: "I can't confirm that here — it depends on the specific plan and area. A licensed ClearPoint advisor can review it with you, at no cost."

# When to pivot to advisor
Offer to connect a licensed advisor (sin costo / at no cost) when:
- Caller needs a specific decision (which plan, whether to switch, whether they qualify).
- Question requires looking up their actual plan / formulary / network.
- Caller is confused after one or two clarifications.
- Caller explicitly asks for "asesor" / "advisor" / "person" / "human".
- Topic involves an active letter, bill, denial, or appeal that needs a person to review.

# When user defers ("Más tarde" / "Later" / "not now")
Treat as "schedule a callback", NOT immediate handoff. Collect their name + a phone + a preferred time window, and also ask for an email if they have one (OPTIONAL — many seniors do not use email; if they say they don't have one, that is perfectly fine, accept it and move on, never insist). Don't push.

# When user complains ("ya me dijiste" / "no entiendes" / "esta rayada" / "you don't understand")
Apologize briefly and pivot to a human advisor. Do NOT defend yourself or repeat the prior turn.

# When user says "no entiendo" / "I don't understand" / "no me explicaron bien"
SIMPLIFY in plainer words. Give 2-4 concrete options. Don't escalate to advisor unless they ask twice.

# When caller is closing ("gracias por la info" / "ya termine" / "thanks" / "I'm done")
Warm closing: "It was a pleasure helping you. ClearPoint is here whenever you need us — 1-866-310-8702. Have a wonderful day!" (or Spanish equivalent). Do NOT re-greet or restart.

# Off-topic
If caller asks about weather, politics, religion, jokes, recipes, sports, gossip → gently redirect: "I'm here to help with Medicare questions. What can I help you with today?" One redirect, then if they continue off-topic, offer the advisor.

# Format of your output
You will respond with ONLY the bot's spoken response — no JSON, no markdown headers, no meta-commentary. The orchestrator handles state, contact capture, and lead submission. Just produce the natural conversational reply.

If you believe this turn should advance to ADVISOR HANDOFF (collect name + phone, and an email if they have one — email is optional, accept "I don't have one" gracefully), end your reply with the exact tag \`[HANDOFF]\` on its own line. The orchestrator will strip the tag and start name collection.

If you believe this turn should CLOSE the conversation, end your reply with the exact tag \`[CLOSE]\` on its own line.

If the user wants to SCHEDULE a callback later, end your reply with the exact tag \`[SCHEDULE]\` on its own line.

No tag = continue conversation normally.`;

export default async function handler(req, res) {
  // ── A15.1 CORS — allowlist our origins, reject everything else ─────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  applyCors(req, res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── A15.2 Rate limit (IP-based, KV-backed when available) ──────────────
  var ip = clientId(req);
  var rl = await rateLimit(ip, { max: 30, windowMs: 5 * 60 * 1000, prefix: 'chat' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Read body. PHASE 6 — cap raw stream at 64 KB to prevent memory DoS.
  var body = {};
  try { body = req.body || {}; } catch (e1) {
    try {
      body = await new Promise(function (resolve, reject) {
        var chunks = []; var total = 0; var MAX = 64 * 1024;
        req.on('data', function (c) {
          total += c.length;
          if (total > MAX) { req.destroy(); reject(new Error('body_too_large')); return; }
          chunks.push(c);
        });
        req.on('end', function () {
          var raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw && raw.trim() ? JSON.parse(raw) : {});
        });
        req.on('error', reject);
      });
    } catch (e2) {
      if (e2 && e2.message === 'body_too_large') return res.status(413).json({ error: 'Payload too large' });
      return res.status(400).json({ error: 'Cannot read body' });
    }
  }

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: tell the engine the API is unavailable so it uses regex path.
    return res.status(503).json({ error: 'LLM_UNAVAILABLE', message: 'API key not configured' });
  }

  var conversationHistory = Array.isArray(body.history) ? body.history : [];
  // PHASE 6 — reject pathological history lengths early (token-cost DoS).
  if (conversationHistory.length > 100) {
    return res.status(400).json({ error: 'history too long' });
  }
  var userMessage = typeof body.userMessage === 'string' ? body.userMessage.slice(0, 2000) : '';
  // PHASE 9A — scrub PHI BEFORE it reaches Anthropic. Audit any redactions.
  var phiResult = scrubPHI(userMessage);
  userMessage = phiResult.text;
  if (phiResult.detected.length > 0) {
    console.warn('[CHAT] PHI redacted before LLM:', phiResult.detected.join(','), 'ip=' + ip);
  }
  // PHASE 6 — sanitize context fields (string-only, length-capped, newline-stripped)
  // before they reach the LLM. Prevents prompt-injection via `name`/`serviceCategory`
  // that bypasses the userMessage prompt-guard.
  var rawCtx = body.context && typeof body.context === 'object' ? body.context : {};
  var conversationContext = {};
  var STR_FIELDS = ['language','zipCode','state','name','phoneNumber','email','scheduledCallbackWindow','serviceCategory'];
  for (var ci = 0; ci < STR_FIELDS.length; ci++) {
    var k = STR_FIELDS[ci];
    if (typeof rawCtx[k] === 'string') {
      conversationContext[k] = rawCtx[k].slice(0, 120).replace(/[\r\n\t]/g, ' ');
    }
  }
  conversationContext.conversationClosed = rawCtx.conversationClosed === true;
  conversationContext.advisorHandoffStarted = rawCtx.advisorHandoffStarted === true;
  conversationContext.advisorOfferDismissed = rawCtx.advisorOfferDismissed === true;
  var _cc = parseInt(rawCtx.clarificationCount, 10);
  conversationContext.clarificationCount = (isFinite(_cc) && _cc >= 0 && _cc <= 50) ? _cc : 0;
  if (!userMessage) return res.status(400).json({ error: 'userMessage required' });

  // ── A15.3 Cap conversation history (max 12 turns) ──────────────────────
  if (conversationHistory.length > 12) {
    conversationHistory = conversationHistory.slice(-12);
  }

  // ── A15.4 Prompt-injection guard ──────────────────────────────────────
  var injCheck = checkPromptInjection(userMessage, conversationContext.language);
  if (!injCheck.ok) {
    console.warn('[CHAT] prompt-injection blocked:', injCheck.reason, 'ip=' + ip);
    return res.status(200).json({
      response: injCheck.safeReply,
      meta: { wantHandoff: false, wantClose: false, wantSchedule: false, blocked: 'prompt_injection' },
    });
  }
  // ── PHASE 9A.3 Multi-turn injection — concatenate last 2 user turns ──
  // Per-message regex misses jailbreaks distributed across turns. Check the
  // last 2 user messages combined to catch "build rapport → now ignore"
  // attack patterns.
  var lastUserTurns = conversationHistory.filter(function (t) { return t && t.role === 'user'; }).slice(-2);
  if (lastUserTurns.length >= 1) {
    var combined = lastUserTurns.map(function (t) { return String(t.content || '').slice(0, 600); }).join(' ') + ' ' + userMessage;
    var multiCheck = checkPromptInjection(combined, conversationContext.language);
    if (!multiCheck.ok) {
      console.warn('[CHAT] multi-turn injection blocked:', multiCheck.reason, 'ip=' + ip);
      return res.status(200).json({
        response: multiCheck.safeReply,
        meta: { wantHandoff: false, wantClose: false, wantSchedule: false, blocked: 'multi_turn_injection' },
      });
    }
  }

  // Build the message list for Claude
  var contextSummary = buildContextSummary(conversationContext);
  var messages = [];
  // Replay last 12 turns as user/assistant pairs (Anthropic format)
  var recent = conversationHistory.slice(-12);
  for (var i = 0; i < recent.length; i++) {
    var turn = recent[i];
    if (!turn || !turn.role || !turn.content) continue;
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: String(turn.content).slice(0, 1000) });
    }
  }
  // Add current user message with context prefix on the FIRST turn only.
  var currentUserContent = userMessage;
  if (recent.length === 0 && contextSummary) {
    currentUserContent = contextSummary + '\n\n' + userMessage;
  }
  messages.push({ role: 'user', content: currentUserContent });

  // Anthropic API call
  try {
    var resp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        // PHASE 9A — lowered from 0.4 to 0.2 for compliance-critical responses.
        // Less hallucination, more deterministic safe answers.
        temperature: 0.2,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: messages,
      }),
    });

    if (!resp.ok) {
      // A15.10 — MEDIUM fix: do NOT leak upstream Anthropic status code to
      // the client (useful for attacker reconnaissance). Log full detail
      // server-side; return only a generic 502 to the browser.
      var errText = await resp.text();
      console.error('[CHAT] Anthropic API error', resp.status, errText.slice(0, 500));
      return res.status(502).json({ error: 'LLM_API_ERROR' });
    }

    var data = await resp.json();
    var assistantText = '';
    if (Array.isArray(data.content)) {
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j].type === 'text') assistantText += data.content[j].text;
      }
    }

    // Detect tags
    var lower = assistantText.toLowerCase();
    var wantHandoff = /\[handoff\]/i.test(assistantText);
    var wantClose = /\[close\]/i.test(assistantText);
    var wantSchedule = /\[schedule\]/i.test(assistantText);
    var cleanText = assistantText.replace(/\[handoff\]/gi, '').replace(/\[close\]/gi, '').replace(/\[schedule\]/gi, '').trim();

    // ── A15.5 Compliance post-filter v2 (shared module) ────────────────
    // Strips carrier names, eligibility confirmations, network claims, etc.
    var lang = (body.context && body.context.language) || 'es';
    var filtered = complianceFilter(cleanText, lang);
    cleanText = filtered.text;
    if (filtered.violations.length) {
      console.warn('[CHAT] compliance violations corrected:', filtered.violations.join(','), 'ip=' + ip);
    }
    // Legacy in-file compliance pass (defense-in-depth) + USTED normalization.
    cleanText = compliancePostFilter(cleanText, lang);
    if (lang === 'es') {
      cleanText = ustedPostFilter(cleanText);
    }

    return res.status(200).json({
      response: cleanText,
      meta: {
        wantHandoff: wantHandoff,
        wantClose: wantClose,
        wantSchedule: wantSchedule,
        usage: data.usage || null,
      },
    });
  } catch (e) {
    console.error('[CHAT] exception', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'LLM_EXCEPTION' });
  }
}

function buildContextSummary(ctx) {
  if (!ctx) return '';
  var lines = [];
  if (ctx.language) lines.push('Caller language: ' + (ctx.language === 'es' ? 'Spanish — RESPOND IN SPANISH USING USTED FORM ONLY (su / tiene / puede — NEVER tu / tienes / puedes)' : 'English'));
  if (ctx.zipCode) lines.push('Caller ZIP: ' + ctx.zipCode + (ctx.state ? ' (' + ctx.state + ')' : '') + ' — ALREADY CAPTURED. Use it as the service ZIP. NEVER ask the caller for their ZIP again.');
  if (ctx.name) lines.push('Caller name: ' + ctx.name + ' (already captured — DO NOT ask for it again)');
  if (ctx.phoneNumber) lines.push('Caller phone: ' + ctx.phoneNumber + ' (already captured — DO NOT ask again)');
  if (ctx.email) lines.push('Caller email: ' + ctx.email + ' (already captured — DO NOT ask again)');
  if (ctx.scheduledCallbackWindow) lines.push('Scheduled callback window: ' + ctx.scheduledCallbackWindow);
  if (ctx.advisorHandoffStarted) lines.push('Advisor handoff: IN PROGRESS or COMPLETE — name, phone, email already in system. NEVER ask the caller to give them again.');
  if (ctx.conversationClosed) lines.push('NOTE: Conversation was closed earlier with a warm sign-off. The caller has returned with a new question. Welcome them back briefly, then answer. Their contact details are already captured.');
  if (ctx.serviceCategory) lines.push('Current topic: ' + ctx.serviceCategory);
  if (ctx.advisorOfferDismissed) lines.push('NOTE: Caller already deferred an advisor offer — treat next "Más tarde" as SCHEDULE, not handoff.');
  if (ctx.clarificationCount && ctx.clarificationCount >= 2) lines.push('NOTE: Caller has asked for clarification ' + ctx.clarificationCount + ' times — offer advisor instead of more re-explanation.');
  if (!lines.length) return '';
  return '[Context for this turn]\n' + lines.join('\n');
}

// Strip / reformulate any phrasing that violates CMS TPMO 422.2267.
// Conservative — favors the user-safe alternative.
// Sawil 2026-06 — the safe replacement is now LANGUAGE-AWARE. Previously the
// disclaimers were hardcoded in English, so a Spanish reply that tripped a
// guard got an English sentence injected mid-paragraph ("...Connecticut. I
// can't recommend a specific plan from here..."). Now ES callers get the
// Spanish disclaimer, so the reply stays in one language.
function compliancePostFilter(text, language) {
  if (!text) return text;
  var es = language === 'es';
  var out = text;
  // Block "I recommend [plan name]" style — generic guard.
  out = out.replace(
    /\b(i (highly )?recommend|le (recomiendo|recomendar[ií]a)|deber[ií]a (escoger|elegir|tomar)|the best plan (is|would be)|el mejor plan (es|ser[ií]a))\b[^.!?]+/gi,
    function (match) {
      // Sawil 2026-06 — do NOT mangle BENIGN recommendations (visit a website,
      // call a number, contact SHIP/SSA/Medicare.gov). This guard previously
      // ate "le recomiendo visitar Medicare.gov" and left a broken ".gov".
      // Only neutralize when it points at an actual PLAN/carrier.
      if (/\b(medicare\.gov|medicare\.org|ssa\.gov|1-?800|shiptacenter|ship\b|visit|visitar|ir a|llam|call|consult|contact|sitio|p[aá]gina|website|recursos?|resources?)\b/i.test(match)) {
        return match;
      }
      return es
        ? 'no puedo recomendar un plan específico desde aquí — un asesor licenciado puede revisar sus opciones con usted, sin costo'
        : 'I can\'t recommend a specific plan from here — a licensed advisor can review your options with you, at no cost';
    }
  );
  // Block "you qualify / you are eligible" style — must be advisor-confirmed.
  out = out.replace(
    /\b(you (qualify|are eligible)|usted (califica|es elegible|cumple))\b[^.!?]+/gi,
    function () { return es
      ? 'la elegibilidad depende de sus ingresos, recursos y estado — un asesor licenciado o la agencia puede confirmar si aplica en su caso'
      : 'eligibility depends on your income, assets, and state — a licensed advisor or the agency can confirm whether it applies to you'; }
  );
  // Block "your doctor is in network / is covered" / "está en la red"
  out = out.replace(
    /\b(your (doctor|provider|hospital) is (in|in[- ]network|covered)|su (doctor|m[eé]dico|hospital|proveedor) (est[aá] (en la red|cubierto)|si est[aá]))\b[^.!?]*/gi,
    function () { return es
      ? 'no puedo confirmar si un doctor específico está en la red — solo el directorio del plan o un asesor licenciado puede verificarlo'
      : 'I can\'t confirm whether a specific doctor is in network — only the plan\'s directory or a licensed advisor can verify that'; }
  );
  return out;
}

// Convert common TÚ verb conjugations to USTED. Defensive — only the most
// common slip-ups for senior-care customer service.
function ustedPostFilter(text) {
  if (!text) return text;
  var out = text;
  var subs = [
    // possessive / object pronouns (whole-word boundaries)
    [/\btu (nombre|tel[eé]fono|correo|email|plan|doctor|m[eé]dico|medicina|medicamento|farmacia|carta|factura|cobro|prima|copago|deducible|cobertura|edad|ingreso|caso|situaci[oó]n|familia|esposo|esposa|hijo|hija)\b/gi,
      function (_m, n) { return 'su ' + n; }],
    [/\btus (nombres|tel[eé]fonos|correos|emails|planes|doctores|medicinas|medicamentos|cartas|facturas|cobros|primas|copagos|cobertura)\b/gi,
      function (_m, n) { return 'sus ' + n; }],
    [/\bcontigo\b/g, 'con usted'],
    [/\bti\s+(mismo|misma)\b/gi, function (_m, n) { return 'usted ' + n; }],
    // common verb forms — TÚ → USTED
    [/\btienes\b/g, 'tiene'],
    [/\bpuedes\b/g, 'puede'],
    [/\bquieres\b/g, 'quiere'],
    [/\bnecesitas\b/g, 'necesita'],
    [/\bestas\b/g, 'está'],
    [/\bsabes\b/g, 'sabe'],
    [/\bcalificas\b/g, 'califica'],
    [/\bdebes\b/g, 'debe'],
    [/\bvas\b/g, 'va'],
    [/\bhaces\b/g, 'hace'],
    [/\beres\b/g, 'es'],
    [/\bvives\b/g, 'vive'],
    [/\brecibes\b/g, 'recibe'],
    [/\btomas\b/g, 'toma'],
    [/\bsigues\b/g, 'sigue'],
    [/\bpiensas\b/g, 'piensa'],
    [/\bcomprendes\b/g, 'comprende'],
    [/\bentiendes\b/g, 'entiende'],
    [/\bpodr[ií]as\b/g, 'podría'],
    [/\bdeber[ií]as\b/g, 'debería'],
    [/\btendr[ií]as\b/g, 'tendría'],
    [/\bquerr[ií]as\b/g, 'querría'],
    [/\bllamar?te\b/g, 'llamarle'],
    [/\bayudar?te\b/g, 'ayudarle'],
    [/\bconectar?te\b/g, 'conectarle'],
    [/\bdar?te\b/g, 'darle'],
    [/\bdecir?te\b/g, 'decirle'],
    [/\borient[aá]r?te\b/g, 'orientarle'],
    [/\bcontactar?te\b/g, 'contactarle'],
    [/\bte (gustar[ií]a|llamar[eé]?|llamamos|enviar[eé]?|enviaremos|veo|oigo|escucho|recordar[eé]?|pediremos|orientamos|conectamos|ayudamos|debe|debemos|atendemos|recibe|dar[eé]?|daremos|atenderemos|invitamos|deseamos)\b/g,
      function (_m, verb) { return 'le ' + verb; }],
    // imperative reflexive "espérate" → "espérese" common cases
    [/\besp[eé]rate\b/g, 'espérese'],
    [/\bcu[eé]ntame\b/g, 'cuénteme'],
    [/\bd[ií]me(lo)?\b/g, function (_m, lo) { return lo ? 'dígamelo' : 'dígame'; }],
    [/\bperd[oó]name\b/g, 'perdóneme'],
    [/\bdiscúlpame\b/g, 'discúlpeme'],
    // "para ti" → "para usted"
    [/\bpara ti\b/g, 'para usted'],
  ];
  for (var i = 0; i < subs.length; i++) {
    out = out.replace(subs[i][0], subs[i][1]);
  }
  return out;
}

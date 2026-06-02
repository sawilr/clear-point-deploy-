// Vercel Serverless Function — ClearPoint CSA bot LLM bridge.
// Calls Claude Haiku 4.5 with a strict system prompt that enforces CMS
// TPMO 422.2267 compliance. The API key lives ONLY server-side; the
// browser never sees it.
//
// Cost target: $0.005–$0.020 per conversation (Haiku + prompt caching).

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// ── System prompt — ClearPoint identity, CMS TPMO compliance, behavior ──
// Cached on Anthropic's side so it only costs the full price on the FIRST
// turn of each conversation. Subsequent turns pay ~10% of the system prompt.
const SYSTEM_PROMPT = `You are the customer service assistant for **ClearPoint Senior Advisors**, an independent licensed Medicare broker serving New York, New Jersey, Florida, and Connecticut. You are NOT a sales bot. You are a triage assistant whose job is to listen, understand the caller's situation, give compliant general information, and connect them with a licensed advisor when appropriate.

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
Treat as "schedule a callback", NOT immediate handoff. Offer to take their name + a phone + a preferred time window. Don't push.

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

If you believe this turn should advance to ADVISOR HANDOFF (collect name + phone), end your reply with the exact tag \`[HANDOFF]\` on its own line. The orchestrator will strip the tag and start name collection.

If you believe this turn should CLOSE the conversation, end your reply with the exact tag \`[CLOSE]\` on its own line.

If the user wants to SCHEDULE a callback later, end your reply with the exact tag \`[SCHEDULE]\` on its own line.

No tag = continue conversation normally.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Read body
  var body = {};
  try { body = req.body || {}; } catch (e1) {
    try {
      body = await new Promise(function (resolve, reject) {
        var chunks = [];
        req.on('data', function (c) { chunks.push(c); });
        req.on('end', function () {
          var raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw && raw.trim() ? JSON.parse(raw) : {});
        });
        req.on('error', reject);
      });
    } catch (e2) {
      return res.status(400).json({ error: 'Cannot read body' });
    }
  }

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: tell the engine the API is unavailable so it uses regex path.
    return res.status(503).json({ error: 'LLM_UNAVAILABLE', message: 'API key not configured' });
  }

  var conversationHistory = Array.isArray(body.history) ? body.history : [];
  var userMessage = typeof body.userMessage === 'string' ? body.userMessage.slice(0, 2000) : '';
  var conversationContext = body.context || {};
  if (!userMessage) return res.status(400).json({ error: 'userMessage required' });

  // Build the message list for Claude
  var contextSummary = buildContextSummary(conversationContext);
  var messages = [];
  // Replay last 12 turns as user/assistant pairs (Anthropic format)
  var recent = conversationHistory.slice(-12);
  for (var i = 0; i < recent.length; i++) {
    var turn = recent[i];
    if (!turn || !turn.role || !turn.content) continue;
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: String(turn.content).slice(0, 4000) });
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
        temperature: 0.4,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: messages,
      }),
    });

    if (!resp.ok) {
      var errText = await resp.text();
      console.error('[CHAT] Anthropic API error', resp.status, errText.slice(0, 500));
      return res.status(502).json({ error: 'LLM_API_ERROR', status: resp.status });
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

    // Compliance post-filter — strip / replace any forbidden phrases.
    cleanText = compliancePostFilter(cleanText);

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
  if (ctx.language) lines.push('Caller language: ' + (ctx.language === 'es' ? 'Spanish (use USTED form)' : 'English'));
  if (ctx.zipCode) lines.push('Caller ZIP: ' + ctx.zipCode + (ctx.state ? ' (' + ctx.state + ')' : ''));
  if (ctx.name) lines.push('Caller name: ' + ctx.name);
  if (ctx.serviceCategory) lines.push('Current topic: ' + ctx.serviceCategory);
  if (ctx.advisorOfferDismissed) lines.push('NOTE: Caller already deferred an advisor offer — treat next "Más tarde" as SCHEDULE, not handoff.');
  if (ctx.clarificationCount && ctx.clarificationCount >= 2) lines.push('NOTE: Caller has asked for clarification ' + ctx.clarificationCount + ' times — offer advisor instead of more re-explanation.');
  if (!lines.length) return '';
  return '[Context for this turn]\n' + lines.join('\n');
}

// Strip / reformulate any phrasing that violates CMS TPMO 422.2267.
// Conservative — favors the user-safe alternative.
function compliancePostFilter(text) {
  if (!text) return text;
  var out = text;
  // Block "I recommend [plan name]" style — generic guard.
  out = out.replace(
    /\b(i (highly )?recommend|le (recomiendo|recomendar[ií]a)|deber[ií]a (escoger|elegir|tomar)|the best plan (is|would be)|el mejor plan (es|ser[ií]a))\b[^.!?]+/gi,
    function () { return 'I can\'t recommend a specific plan from here — a licensed advisor can review your options with you, at no cost'; }
  );
  // Block "you qualify / you are eligible" style — must be advisor-confirmed.
  out = out.replace(
    /\b(you (qualify|are eligible)|usted (califica|es elegible|cumple))\b[^.!?]+/gi,
    function () { return 'eligibility depends on your income, assets, and state — a licensed advisor or the agency can confirm whether it applies to you'; }
  );
  // Block "your doctor is in network / is covered" / "está en la red"
  out = out.replace(
    /\b(your (doctor|provider|hospital) is (in|in[- ]network|covered)|su (doctor|m[eé]dico|hospital|proveedor) (est[aá] (en la red|cubierto)|si est[aá]))\b[^.!?]*/gi,
    function () { return 'I can\'t confirm whether a specific doctor is in network — only the plan\'s directory or a licensed advisor can verify that'; }
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE A17 — Lead Intelligence Pass.
//
// Called by api/submit-lead.js before the GHL POST. Takes the raw lead
// notes / conversation summary, asks Claude Haiku to extract a structured
// intelligence object, and returns it as a JSON payload.
//
// Goal: the advisor opens the GHL contact and sees in 5 seconds:
//   - what the caller actually needs
//   - how hot the lead is
//   - what to ask first
//   - any compliance concerns
//
// Cost: $0.001–$0.003 per analysis (Haiku + system-prompt cache).
//
// Graceful degradation: if the API call fails (no key, 5xx, timeout),
// the function returns null and the caller proceeds with the original
// lead notes. Lead submission MUST NOT fail because intel failed.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const TIMEOUT_MS = 8_000;

// System prompt is cached on Anthropic's side → ~10% cost after the
// first call per ~5-min window.
const SYSTEM_PROMPT = `You are a lead-qualification analyst for ClearPoint Senior Advisors (a Medicare broker serving NY, NJ, CT).

Your job: read the lead's notes / conversation summary and return ONE strictly-formatted JSON object that helps a licensed advisor prepare for the call.

Hard requirements:
- Return ONLY a single JSON object. No markdown, no prose, no apologies.
- All string fields in the caller's language (en or es) — match the source.
- "summary" must be 1–3 sentences, factual, no marketing language.
- "intent_strength" is an integer 1–10. 1 = curious browser, 10 = ready to enroll TODAY.
- "lead_temperature" is exactly one of: "hot", "warm", "cold".
- "urgency" is exactly one of: "today", "this_week", "this_month", "low".
- "advisor_prep_notes" is 2-4 sentences listing what advisor should know BEFORE calling.
- "compliance_flags" is an array of strings. Empty array if none. Examples: ["asked about Medigap which we do not offer", "user is in Florida (not served)", "user has Medicaid + Medicare (dual eligible)"].
- "recommended_first_questions" is an array of 2-3 specific questions for the advisor to ask first.

JSON schema (return EXACTLY these keys, no extras):
{
  "summary": string,
  "intent_strength": integer 1-10,
  "lead_temperature": "hot" | "warm" | "cold",
  "urgency": "today" | "this_week" | "this_month" | "low",
  "advisor_prep_notes": string,
  "compliance_flags": string[],
  "recommended_first_questions": string[]
}

If the lead notes are sparse or unclear, fill fields with your best estimate and add a compliance_flag like "limited information — verify on first call".

DO NOT:
- Recommend a specific carrier or plan
- Confirm eligibility
- Confirm whether a doctor is in network
- Promise outcomes

Always include a recommendation that the advisor confirm details on the call before making any assumptions.`;

/**
 * Run the lead through Claude and return structured intel.
 *
 * @param {object} input
 * @param {string} input.leadNotes  Free-text conversation summary / notes.
 * @param {string} input.language   'en' | 'es' (defaults to 'en').
 * @param {string} input.source     Lead source bot — 'customer_service' | 'smart_review' | 'zara_education'.
 * @param {object} [input.metadata] Extra structured context (zip, state, age, etc.).
 *
 * @returns {Promise<object|null>}  Parsed intel object, or null on failure.
 */
export async function analyzeLeadIntelligence(input) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  var notes = (input && typeof input.leadNotes === 'string') ? input.leadNotes : '';
  var language = (input && input.language) || 'en';
  var source = (input && input.source) || 'unknown';
  var metadata = (input && input.metadata) || {};

  if (!notes.trim()) return null;

  // Trim aggressively — long transcripts blow the token budget.
  if (notes.length > 4000) notes = notes.slice(0, 4000) + '… [truncated]';

  var userPayload = [
    'Source: ' + source,
    'Language: ' + language,
    metadata.zipCode ? 'ZIP: ' + metadata.zipCode : null,
    metadata.state ? 'State: ' + metadata.state : null,
    metadata.age ? 'Age: ' + metadata.age : null,
    metadata.medicareStatus ? 'Current coverage: ' + metadata.medicareStatus : null,
    '',
    '=== Lead notes / conversation ===',
    notes,
  ].filter(Boolean).join('\n');

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  try {
    var resp = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        temperature: 0.2,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          { role: 'user', content: userPayload },
        ],
      }),
    });
    clearTimeout(timer);
    if (!resp.ok) {
      console.warn('[lead-intel] API non-2xx', resp.status);
      return null;
    }
    var data = await resp.json();
    var text = '';
    if (Array.isArray(data.content)) {
      for (var i = 0; i < data.content.length; i++) {
        if (data.content[i].type === 'text') text += data.content[i].text;
      }
    }
    text = String(text || '').trim();
    if (!text) return null;

    // Pull out the first {...} block — defensive against any prose leakage.
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    var parsed;
    try { parsed = JSON.parse(match[0]); } catch (e) { return null; }
    var clean = sanitizeIntel(parsed);
    return clean;
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') console.warn('[lead-intel] timeout');
    else console.warn('[lead-intel] failed', e && e.message);
    return null;
  }
}

/** Strict allowlist of fields + type enforcement so a misbehaving LLM
 *  response can't smuggle anything weird into the GHL note. */
function sanitizeIntel(obj) {
  if (!obj || typeof obj !== 'object') return null;
  var out = {};
  out.summary = stringOr(obj.summary, '').slice(0, 600);
  out.intent_strength = clampInt(obj.intent_strength, 1, 10);
  out.lead_temperature = pickEnum(obj.lead_temperature, ['hot', 'warm', 'cold'], 'cold');
  out.urgency = pickEnum(obj.urgency, ['today', 'this_week', 'this_month', 'low'], 'low');
  out.advisor_prep_notes = stringOr(obj.advisor_prep_notes, '').slice(0, 600);
  out.compliance_flags = stringArray(obj.compliance_flags).slice(0, 10);
  out.recommended_first_questions = stringArray(obj.recommended_first_questions).slice(0, 5);
  return out;
}

function stringOr(v, fallback) {
  return (typeof v === 'string') ? v : fallback;
}
function clampInt(v, min, max) {
  var n = parseInt(v, 10);
  if (!isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
function pickEnum(v, allowed, fallback) {
  v = String(v || '').toLowerCase().trim();
  return allowed.includes(v) ? v : fallback;
}
function stringArray(v) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(function (s) { return typeof s === 'string' && s.trim(); })
    .map(function (s) { return s.slice(0, 200); });
}

/** Format the intel object as text appended to GHL lead_notes. */
export function formatIntelForGhlNotes(intel) {
  if (!intel) return '';
  var lines = [
    '',
    '── LEAD INTELLIGENCE (auto-generated) ──',
    'Summary: ' + intel.summary,
    'Intent strength: ' + intel.intent_strength + '/10  |  Temperature: ' + intel.lead_temperature + '  |  Urgency: ' + intel.urgency,
    'Advisor prep: ' + intel.advisor_prep_notes,
  ];
  if (intel.compliance_flags && intel.compliance_flags.length) {
    lines.push('Compliance flags:');
    intel.compliance_flags.forEach(function (f) { lines.push('  • ' + f); });
  }
  if (intel.recommended_first_questions && intel.recommended_first_questions.length) {
    lines.push('Recommended first questions:');
    intel.recommended_first_questions.forEach(function (q, i) { lines.push('  ' + (i + 1) + '. ' + q); });
  }
  lines.push('────────────────────────────────────────');
  return lines.join('\n');
}

// Vercel Serverless Function - GHL Lead Capture
//
// PHASE A15 — Security hardening:
//   1. CORS allowlist (only our domain + Vercel previews)
//   2. Per-IP rate limit (5 leads / hour, 10 / day)
//   3. Existing honeypot anti-bot stays as first gate
import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
// PHASE A17 — Lead Intelligence: enrich the lead with structured AI analysis
// BEFORE it lands in GHL. Graceful: returns null on failure, GHL still gets
// the raw notes.
import { analyzeLeadIntelligence, formatIntelForGhlNotes } from './_lib/lead-intel.js';
import { noStorePII } from './_lib/security-headers.js';
// AUDIT 2026-07-03 Phase 1 — server-side PHI net. phi-scrub's own contract says it
// must run before any LLM / CRM / persistent-log sink; this file hit all three
// (Anthropic lead-intel, GHL customFields, GHL note) with unscrubbed free text.
// The client-side firewall (sensitiveGuard) covers the common chat path but is
// narrower, misses non-chat surfaces, and is bypassable with a direct POST.
import { scrubPHI } from './_lib/phi-scrub.js';

// Sawil 2026-06-30 AUDIT FIX C1 (no lost leads) — a CONSENTED lead must never be
// lost to a transient GHL failure. Retry the GHL call on network errors and on
// 5xx/429 (transient) with short exponential backoff. 4xx responses (validation,
// duplicate) are deterministic and are NOT retried. Bounded (3 attempts, ~300/600ms
// backoff) so total time stays well under the serverless function timeout. Only the
// CONTACT create/update is retried — notes/opportunities run once after, so a retry
// cannot duplicate them. Never logs PII.
async function ghlFetchRetry(url, options, opts) {
  var retries = (opts && opts.retries != null) ? opts.retries : 2;
  var baseDelayMs = (opts && opts.baseDelayMs != null) ? opts.baseDelayMs : 300;
  var lastErr = null;
  for (var attempt = 0; attempt <= retries; attempt++) {
    try {
      var resp = await fetch(url, options);
      if ((resp.status >= 500 || resp.status === 429) && attempt < retries) {
        console.warn('[GHL] transient ' + resp.status + ' — retry ' + (attempt + 1) + '/' + retries);
        await new Promise(function (r) { setTimeout(r, baseDelayMs * Math.pow(2, attempt)); });
        continue;
      }
      return resp;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn('[GHL] network error — retry ' + (attempt + 1) + '/' + retries);
        await new Promise(function (r) { setTimeout(r, baseDelayMs * Math.pow(2, attempt)); });
        continue;
      }
      throw lastErr;
    }
  }
  throw (lastErr || new Error('ghlFetchRetry exhausted'));
}

export default async function handler(req, res) {
  // ── A15.1 CORS — allowlist ──────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  applyCors(req, res, allowedOrigin);
  noStorePII(res); // Sawil 2026-06-29 SECURITY HOTFIX — never cache lead/PII responses (finding 05).
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    // AUDIT 2026-07-28 CPF-006 — advertise the rate-limit policy on the safe
    // GET/405 path so external auditors can verify the control exists without
    // firing POSTs that could create leads. Enforcement happens below on POST.
    res.setHeader('X-RateLimit-Limit', '5');
    res.setHeader('X-RateLimit-Window', '3600');
    res.setHeader('X-RateLimit-Policy', '5;w=3600, 10;w=86400');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── A15.2 Rate limit (lead-specific: very conservative — anti-spam) ────
  var ip = clientId(req);
  var rlHour = await rateLimit(ip, { max: 5, windowMs: 60 * 60 * 1000, prefix: 'lead-h' });
  // Re-audit 2026-07-27 (AS-01): surface the limit as standard headers so the
  // control is externally observable without exhausting the quota (a POST that
  // fails validation still returns these). Purely informational — the 429 gate
  // below is what enforces.
  res.setHeader('X-RateLimit-Limit', '5');
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rlHour.remaining != null ? rlHour.remaining : 0)));
  res.setHeader('X-RateLimit-Window', '3600');
  if (!rlHour.ok) {
    res.setHeader('Retry-After', String(rlHour.retryAfter));
    return res.status(429).json({ error: 'Too many submissions, try again later' });
  }
  var rlDay = await rateLimit(ip, { max: 10, windowMs: 24 * 60 * 60 * 1000, prefix: 'lead-d' });
  if (!rlDay.ok) {
    res.setHeader('Retry-After', String(rlDay.retryAfter));
    return res.status(429).json({ error: 'Daily submission limit reached' });
  }

  // Read body FIRST so the honeypot check can fire as the very first gate,
  // before any env/auth setup. This way bot traffic is discarded with the
  // minimum amount of server work and never touches GHL token logic.
  // PHASE 6 — cap raw stream at 64 KB to prevent memory DoS.
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
      return res.status(400).json({ error: 'Cannot read request body' });
    }
  }

  // ── Honeypot anti-bot gate (FIRST GATE — runs before env/auth) ─────────
  // The forms include a hidden `website_url` field that real users never see
  // or fill (off-screen, tabIndex=-1, aria-hidden, autoComplete off). Bots
  // that scrape and fill every input will populate it. If it has ANY value,
  // we silently return a generic success-style response so the bot believes
  // submission worked, but no GHL contact is created and no PII reaches the
  // CRM. We do not log the honeypot value itself — only that it triggered.
  // Placed BEFORE env check so it works in all environments (Preview too).
  if (body && typeof body.website_url === 'string' && body.website_url.trim() !== '') {
    console.warn('[ANTI-BOT] Honeypot triggered — submission discarded');
    // Return a benign success response (no contact_id) so the bot doesn't
    // probe further and so legitimate edge cases don't surface an error.
    return res.status(200).json({ success: true, message: 'Received' });
  }

  var token = process.env.HIGHLEVEL_TOKEN;
  var locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) return res.status(500).json({ error: 'Server configuration error' });

  // ── CONSENT GATE (Sawil 2026-06-29 SECURITY HOTFIX, finding 02) ───────────
  // No GHL operation of ANY kind (contact, opportunity, note, workflow) and no
  // lead-intel LLM call unless the lead carries EXPLICIT affirmative TCPA
  // consent. ONLY the literal boolean `true` passes — false / missing / null /
  // undefined / "false" / "0" / "" are ALL rejected here, before any downstream
  // work. The producing surfaces (Clara confirmation, Zara, web forms, Smart
  // Review) each send consent_to_contact=true only after the user agrees to the
  // displayed TCPA authorization, with a versioned consent receipt.
  if (body.consent_to_contact !== true) {
    console.warn('[CONSENT] Lead rejected — explicit consent_to_contact=true required (type=' + (typeof body.consent_to_contact) + ')');
    return res.status(400).json({
      error: 'CONSENT_REQUIRED',
      message: 'Consent to be contacted is required before we can submit your request.',
    });
  }

  try {
    var first_name = body.first_name; var last_name = body.last_name; var phone = body.phone;
    var email = body.email; var age = body.age || body.calculated_age; var date_of_birth = body.date_of_birth;
    var calculated_age = body.calculated_age; var zip = body.zip; var city = body.city;
    var county = body.county; var derived_state = body.derived_state || body.state;
    var preferred_language = body.preferred_language; var medicare_status = body.medicare_status;
    var lead_source = body.lead_source; var utm_source = body.utm_source;
    var utm_medium = body.utm_medium; var utm_campaign = body.utm_campaign;
    var lead_notes = body.lead_notes; var conversation_summary = body.conversation_summary;
    var lead_quality_flags = body.lead_quality_flags;
    // PHASE 6 — cap unbounded free-text fields to stop token-cost amplification.
    function _cap(v, max) { return typeof v === 'string' ? v.slice(0, max) : (v == null ? '' : String(v).slice(0, max)); }
    lead_notes = _cap(lead_notes, 8000);
    conversation_summary = _cap(conversation_summary, 8000);
    lead_quality_flags = _cap(lead_quality_flags, 1000);

    // ── Sawil 2026-07-09 SECURITY — server-side name validation ─────────────
    // The client validates names, but a direct POST bypasses it (proven in the
    // controlled test: "<script>x</script>" reached the CRM write path). Reject
    // markup/URL/control characters server-side. Legit names — apostrophes
    // (O'Brien), hyphens, accents (García, Peña) — pass untouched. Cap at 80.
    first_name = _cap(first_name, 80).trim();
    last_name = _cap(last_name, 80).trim();
    var _badNameRe = /[<>{}[\]\\`$;=|\u0000-\u001f]|https?:|script|javascript:/i;
    if ((first_name && _badNameRe.test(first_name)) || (last_name && _badNameRe.test(last_name))) {
      console.warn('[VALIDATION] Name rejected: disallowed characters/markup');
      return res.status(400).json({ error: 'Invalid name' });
    }

    // AUDIT 2026-07-03 Phase 1 — scrub PHI at the SOURCE variables so every
    // downstream sink is covered by construction: the Anthropic lead-intel call
    // (reads lead_notes/conversation_summary below), the GHL customField
    // contact.chat_conversation_summary, and the GHL note POST. Patterns are
    // conservative (SSN/MBI/HICN/card/routing/IBAN/9-digit); a 10-digit phone,
    // 5-digit ZIP, email, name and callback window pass through unchanged —
    // proven by scripts/phase1-phi-server.test.mjs. Log categories only (no PII).
    var _scrubNotes = scrubPHI(lead_notes);
    var _scrubSummary = scrubPHI(conversation_summary);
    var _scrubFlags = scrubPHI(lead_quality_flags);
    lead_notes = _scrubNotes.text;
    conversation_summary = _scrubSummary.text;
    lead_quality_flags = _scrubFlags.text;
    var _phiCats = _scrubNotes.detected.concat(_scrubSummary.detected, _scrubFlags.detected);
    if (_phiCats.length > 0) {
      console.warn('[LEAD] PHI redacted before LLM/CRM: ' + Array.from(new Set(_phiCats)).join(','));
    }

    // ── 3.6 — input hardening (Grupo B) ─────────────────────────────────────
    // Reuse the existing _cap() helper — do NOT duplicate the phone validation,
    // honeypot, CORS, rate-limit, body cap or tag sanitization that already run
    // above/below. Valid inputs pass through unchanged. Invalid email/zip are
    // DROPPED (the lead is still captured — phone is the primary contact, and
    // the required-field + phone checks below still apply). Logs stay PII-free.
    first_name = _cap(first_name, 100).replace(/[\r\n\t]+/g, ' ').trim();
    last_name = _cap(last_name, 100).replace(/[\r\n\t]+/g, ' ').trim();
    city = _cap(city, 80).replace(/[\r\n\t]+/g, ' ').trim();
    county = _cap(county, 80).replace(/[\r\n\t]+/g, ' ').trim();
    email = _cap(email, 254).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // Invalid format — drop the email (never log its value). consent_email
      // below then naturally resolves to 'false' for an absent email.
      console.warn('[VALIDATION] Email dropped: invalid format');
      email = '';
    }
    // ZIP — normalize to a 5-digit US ZIP; drop anything else (US country only).
    var _zipDigits = typeof zip === 'string' ? zip.replace(/\D/g, '').slice(0, 5) : '';
    zip = (_zipDigits.length === 5) ? _zipDigits : '';

    // ── PHASE 11 — Clara Phase 10 audit/identity fields ─────────────────────
    // lead_type identifies which Clara path produced this lead.
    // ghl_contact_id (Path A matched): switch from POST create to PUT update.
    // ghl_assigned_user_id (Path A matched): assign the contact to advisor.
    // consent_text/hash/version/UA: TCPA audit-trail persistence.
    // AUDIT 2026-07-03 Phase 3 (lead completeness) — best_time_to_contact was
    // captured on every surface and silently dropped before the CRM; interest_type
    // arrived but was never read. Sanitize both, persist them as structured note
    // lines (survives custom-field mapping changes) and as filterable GHL tags.
    // No GHL custom-field ID exists for these today — inventing an ID would 400.
    var best_time_to_contact = _cap(body.best_time_to_contact, 64).replace(/[\r\n\t]+/g, ' ').trim();
    var interest_type = _cap(body.interest_type, 80).replace(/[\r\n\t]+/g, ' ').trim();
    var intakeBits = [];
    if (best_time_to_contact) intakeBits.push('Best time to contact: ' + best_time_to_contact);
    if (interest_type) intakeBits.push('Interest/topic: ' + interest_type);
    if (intakeBits.length > 0) {
      lead_notes = (lead_notes ? lead_notes + '\n\n' : '') + '— Intake —\n' + intakeBits.join('\n');
    }
    function _tagify(prefix, v) {
      var t = String(v || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
      return t ? prefix + '-' + t : '';
    }
    var _bestTimeTag = _tagify('CallTime', best_time_to_contact);
    var _interestTag = _tagify('Interest', interest_type);

    var lead_type = typeof body.lead_type === 'string' ? body.lead_type.slice(0, 64).replace(/[^a-zA-Z0-9_]/g, '') : '';
    var ghl_contact_id = typeof body.ghl_contact_id === 'string' ? body.ghl_contact_id.slice(0, 64).replace(/[^a-zA-Z0-9-]/g, '') : '';
    var ghl_assigned_user_id = typeof body.ghl_assigned_user_id === 'string' ? body.ghl_assigned_user_id.slice(0, 64).replace(/[^a-zA-Z0-9-]/g, '') : '';
    var consent_text = _cap(body.consent_text, 4000);
    var consent_receipt_hash = typeof body.consent_receipt_hash === 'string' ? body.consent_receipt_hash.slice(0, 128).replace(/[^a-f0-9]/g, '') : '';
    var disclaimer_version = typeof body.disclaimer_version === 'string' ? body.disclaimer_version.slice(0, 32).replace(/[^a-zA-Z0-9._-]/g, '') : '';
    var signer_user_agent = _cap(body.signer_user_agent, 240);
    // Append the audit-trail receipt to lead_notes so it survives even if
    // GHL custom-field mapping changes. PII-free (only hash + version + UA).
    if (consent_receipt_hash || disclaimer_version) {
      var receiptBits = [];
      // AUDIT 2026-07-03 (compliance) — persist the FULL 64-char digest, not a
      // 16-char prefix: a truncated hash cannot verify a later-supplied text.
      if (consent_receipt_hash) receiptBits.push('sha256=' + consent_receipt_hash);
      if (disclaimer_version) receiptBits.push('disclaimer=' + disclaimer_version);
      if (signer_user_agent) receiptBits.push('ua=' + signer_user_agent.slice(0, 60));
      lead_notes = (lead_notes ? lead_notes + '\n\n' : '') + '— TCPA Receipt — ' + receiptBits.join(' · ');
      // AUDIT 2026-07-03 (compliance) — persist the VERBATIM consent language per
      // lead so the 10-year TCPA record is self-contained in the CRM (previously
      // only hash+version survived; the text itself was captured then discarded).
      // consent_text is the fixed canonical TCPA string (no PHI), appended AFTER
      // the scrub point by design.
      if (consent_text) {
        lead_notes += '\n— Consent Text (verbatim' + (disclaimer_version ? ', v' + disclaimer_version : '') + ') —\n' + consent_text;
      }
    }

    // ── PHASE A17 — Lead Intelligence Pass ─────────────────────────────────
    // One additional Haiku call to enrich the lead BEFORE it lands in GHL.
    // The advisor opens the contact and sees a structured summary, temperature,
    // and recommended first questions — no need to read the full transcript.
    //
    // Graceful: if the call fails (no key, network, timeout), `intel` is
    // null and we proceed with the raw notes only.
    var intel = null;
    try {
      intel = await analyzeLeadIntelligence({
        leadNotes: (lead_notes || conversation_summary || '').toString(),
        language: preferred_language || 'en',
        source: lead_source || 'unknown',
        metadata: {
          zipCode: zip,
          state: derived_state,
          age: age || calculated_age,
          medicareStatus: medicare_status,
        },
      });
    } catch (e) {
      console.warn('[submit-lead] intel call exception (continuing without)', e && e.message);
    }
    if (intel) {
      var intelText = formatIntelForGhlNotes(intel);
      lead_notes = (lead_notes || '').toString().trimEnd() + (intelText ? '\n' + intelText : '');
      // Append a lead-quality flag so GHL workflows can route by temperature.
      var tempTag = 'Temp-' + (intel.lead_temperature || 'cold');
      var urgTag = 'Urg-' + (intel.urgency || 'low');
      lead_quality_flags = (lead_quality_flags ? lead_quality_flags + '; ' : '') +
        'AI: ' + tempTag + '/' + urgTag + ' (intent ' + intel.intent_strength + '/10)';
    }

    var frontendTags = [];
    if (Array.isArray(body.tags)) {
      for (var i = 0; i < body.tags.length && frontendTags.length < 20; i++) {
        var tag = body.tags[i];
        if (typeof tag === 'string') { tag = tag.trim(); if (tag && tag.length <= 64 && /^[a-zA-Z0-9 _-]+$/.test(tag)) frontendTags.push(tag); }
      }
    }
    var allTags = ['Status-NewLead'];
    for (var j = 0; j < frontendTags.length; j++) { if (allTags.indexOf(frontendTags[j]) === -1) allTags.push(frontendTags[j]); }

    // Sawil 2026-06-30 AUDIT FIX C2 — Clara's "verified existing client" path
    // (Path A matched) submits with phone:'' because the phone is already on file
    // in GHL; it carries a sanitized ghl_contact_id and updates that contact via
    // PUT. The old check 400'd it → every highest-intent verified-client inquiry
    // was silently dropped while the UI showed success. Require name+phone ONLY
    // when there is NO verified contact id to update.
    if (!ghl_contact_id && (!first_name || !phone)) return res.status(400).json({ error: 'Missing required fields' });

    // ── Server-side U.S. phone validation (mirrors src/lib/validation.ts) ────────
    // Inline JS version — cannot import TypeScript modules in Vercel serverless functions
    var SERVER_US_AREA_CODES = new Set([
      205,251,256,334,938,907,480,520,602,623,928,479,501,870,
      209,213,279,310,323,341,408,415,424,442,510,530,559,562,
      619,626,628,650,657,661,669,707,714,747,760,805,818,820,
      831,840,858,909,916,925,949,951,
      303,719,720,970,203,475,860,959,202,302,
      239,305,321,352,386,407,448,561,689,727,754,772,786,813,
      850,863,904,941,954,
      229,404,470,478,678,706,762,770,912,808,208,986,
      217,224,309,312,331,447,464,618,630,708,730,773,779,815,847,872,
      219,260,317,463,574,765,812,930,319,515,563,641,712,
      316,620,785,913,270,364,502,606,859,225,318,337,504,985,207,
      240,301,410,443,667,339,351,413,508,617,774,781,857,978,
      231,248,269,313,517,586,616,679,734,810,906,947,989,
      218,320,507,612,651,763,952,228,601,662,769,
      314,417,557,573,636,660,816,406,308,402,531,702,725,775,603,
      201,551,609,640,732,848,856,862,908,973,505,575,
      212,315,332,347,516,518,585,607,631,646,680,716,718,838,845,914,917,929,934,
      252,336,704,743,828,910,919,980,984,701,
      216,220,234,283,330,380,419,440,513,567,614,740,937,
      405,539,580,918,458,503,541,971,
      215,223,267,272,412,445,484,570,582,610,717,724,814,878,401,
      803,843,854,864,605,423,615,629,731,865,901,931,
      210,214,254,281,325,346,361,409,430,432,469,512,682,713,
      726,737,806,817,830,832,903,915,936,940,945,956,972,979,
      385,435,801,802,276,434,540,571,703,757,804,
      206,253,360,425,509,564,304,681,262,414,534,608,715,920,307,
      // Sawil 2026-06-20 — U.S. TERRITORIES (must mirror src/lib/validation.ts).
      // Puerto Rico 787/939 etc. are valid U.S. phone numbers. Without these the
      // client accepted a 787 but THIS server 400'd it → "No pudimos enviar su
      // solicitud" (live lead-loss). Service area stays ZIP-gated (NY/NJ/CT),
      // never by phone area code.
      787,939,340,671,670,684
    ]);
    function serverValidatePhone(raw) {
      if (!raw) return { valid: false, reason: 'Phone missing' };
      var s = String(raw).trim();
      if (s.startsWith('+') && !s.startsWith('+1')) return { valid: false, reason: 'Non-US country code' };
      var digits = s.replace(/\D/g, '');
      var national = (digits.length === 11 && digits[0] === '1') ? digits.slice(1) : digits;
      if (national.length !== 10) return { valid: false, reason: 'Must be 10 digits' };
      var areaCode = parseInt(national.slice(0, 3), 10);
      var exchange = national[3];
      if (exchange === '0' || exchange === '1') return { valid: false, reason: 'Invalid exchange' };
      if (!SERVER_US_AREA_CODES.has(areaCode)) return { valid: false, reason: 'Not a valid U.S. area code: ' + areaCode };
      if (/^(\d)\1{9}$/.test(national)) return { valid: false, reason: 'Phone appears fake' };
      if (['1234567890','0987654321','9876543210','0123456789'].includes(national)) return { valid: false, reason: 'Phone appears fake' };
      if (/(\d)\1{6,}/.test(national)) return { valid: false, reason: 'Phone appears fake' };
      // Sawil 2026-06-29 SECURITY HOTFIX (finding 03) — mirror the client
      // validator (src/lib/validation.ts) for 555, PLUS known fictional numbers
      // the audit flagged that pass NANP structure. The server was missing all
      // of these, so 212-555-0100 and 212-867-5309 reached the CRM.
      if (/^\d{3}555(1234|9999|0000|1212|5555|4321|1111|2222|3333|4444|6666|7777|8888|0100|0199)$/.test(national)) return { valid: false, reason: 'Phone appears fake (555 hollywood)' };
      if (/^\d{3}55501\d\d$/.test(national)) return { valid: false, reason: 'Phone appears fake (555 fictional 0100-0199)' };
      if (/^555/.test(national)) return { valid: false, reason: 'Phone appears fake (555 area code)' };
      if (national.slice(3) === '8675309') return { valid: false, reason: 'Phone appears fake (867-5309)' };
      return { valid: true, national: national };
    }
    // Sawil 2026-06-30 AUDIT FIX C2 — validate phone ONLY when one was provided.
    // A verified-client update (ghl_contact_id present, phone:'') legitimately has
    // no phone in the payload; the existing GHL contact already holds it. Any phone
    // that IS provided is still fully validated (territories + 555/867-5309 fakes).
    var phone10 = '';
    var phoneE164 = '';
    if (phone) {
      var phoneValidation = serverValidatePhone(phone);
      if (!phoneValidation.valid) {
        // Privacy: log validation reason only — never the raw phone number.
        console.warn('[VALIDATION] Phone rejected: ' + phoneValidation.reason);
        return res.status(400).json({ error: 'Invalid U.S. phone number', reason: phoneValidation.reason });
      }
      phone10 = phoneValidation.national;
      phoneE164 = '+1' + phone10;
    }

    // ── Sawil 2026-07-09 SECURITY — layered anti-abuse on the validated identity ──
    // (1) Minimum-fill-time gate: real seniors take well over 3s to complete the
    //     form. When the client supplies elapsed_ms (LeadForm sends it) and it is
    //     implausibly low, treat as bot: benign success response, no CRM write —
    //     identical posture to the honeypot so bots learn nothing. Surfaces that
    //     don't send elapsed_ms (Zara/Clara/SmartReview, older cached bundles) are
    //     unaffected — the gate only runs when the field is present.
    var _elapsed = Number(body.elapsed_ms);
    if (Number.isFinite(_elapsed) && _elapsed >= 0 && _elapsed < 3000) {
      console.warn('[ANTI-BOT] Min-fill-time gate triggered (' + Math.round(_elapsed) + 'ms) — submission discarded');
      return res.status(200).json({ success: true, message: 'Received' });
    }
    // (2) Per-phone rate limit (3/hour) + per phone+ZIP (5/hour): stops one actor
    //     rotating IPs to spam the same identity. Keyed on the VALIDATED national
    //     number — never logged raw; the limiter stores only prefixed keys.
    if (phone10) {
      var rlPhone = await rateLimit(phone10, { max: 3, windowMs: 60 * 60 * 1000, prefix: 'lead-ph' });
      var rlPhoneZip = await rateLimit(phone10 + ':' + (zip || 'nozip'), { max: 5, windowMs: 60 * 60 * 1000, prefix: 'lead-pz' });
      if (!rlPhone.ok || !rlPhoneZip.ok) {
        // Generic response — reveal no internal logic. Retry-After lets legit
        // callers (and the UI) know it is temporary.
        res.setHeader('Retry-After', String((rlPhone.retryAfter || rlPhoneZip.retryAfter || 3600)));
        console.warn('[RATE-LIMIT] per-phone window exceeded (key hashed, not logged)');
        return res.status(429).json({ error: 'Too many submissions, try again later' });
      }
    }
    // (3) submission_id — PII-free idempotency/trace key (phone+zip+UTC-hour digest).
    //     Logged and returned so a lead can be traced end-to-end without exposing PII.
    var submission_id = '';
    try {
      var _sidRaw = phone10 + '|' + (zip || '') + '|' + new Date().toISOString().slice(0, 13);
      var _sidBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_sidRaw));
      submission_id = Array.from(new Uint8Array(_sidBuf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
      console.log('[LEAD] submission_id=' + submission_id);
    } catch (_e) { /* non-fatal — tracing only */ }

    var contact = {
      locationId, firstName: first_name, lastName: last_name || '',
      phone: phoneE164 || undefined, email: email || undefined,
      city: city || undefined,
      state: derived_state || undefined,
      postalCode: zip || undefined,
      dateOfBirth: date_of_birth || undefined,
      country: 'US',
      source: 'ClearPoint Website',
      address1: county || undefined,
      // Compliance / TCPA — consent flags must reflect what the user actually
      // agreed to. Never hardcode 'true' (that would record falsified consent
      // for every lead). Derive each flag strictly from the submitted body.
      // Only the literal boolean true counts; truthy strings ('true', '1') are
      // intentionally NOT accepted, to avoid silent client-side coercion bugs.
      // If the body does not clearly provide consent for a channel, default
      // to 'false'. consent_to_contact is the unified TCPA consent covering
      // marketing calls + SMS (per displayed consent text on the form).
      customFields: [
        { id: 'QULAmkAuVNCQrAMZ487K', key: 'contact.preferred_language', value: preferred_language || 'en' },
        { id: 'R510tHz6GFBaqZgN5e5S', key: 'contact.medicare_status', value: medicare_status || '' },
        { id: 'vPKlhpz6aucJK1U3fJRZ', key: 'contact.consent_marketing', value: ((body.consent === true) || (body.consent_to_contact === true)) ? 'true' : 'false' },
        { id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms',       value: ((body.consent_sms === true) || (body.consent_to_contact === true)) ? 'true' : 'false' },
        { id: 'mHdpDjBSA76lQJrKoixL', key: 'contact.consent_calls',     value: ((body.consent_call === true) || (body.consent_calls === true) || (body.consent_to_contact === true)) ? 'true' : 'false' },
        // AUDIT 2026-07-23 (GHL-02) — email consent must come from the affirmative
        // TCPA consent (same gate as calls/sms), NOT from the mere presence of an
        // email address. Recorded true only when the caller both provided an email
        // AND checked the consent box.
        { id: 'ykiTUcsu3nvawK39hmll', key: 'contact.consent_email', value: (email && body.consent_to_contact === true) ? 'true' : 'false' },
        { id: 'GSss3tRLKg8mNCzEv3D9', key: 'contact.client_age', value: age || '' },
        { id: 'HoYmwc19InLwUwXNyKcr', key: 'contact.calculated_age', value: calculated_age != null ? String(calculated_age) : '' },
        { id: 'qGryQuR67jXFFVRFBLkz', key: 'contact.lead_quality_flags', value: lead_quality_flags || '' },
        { id: '6vSP5DJvAc6Jl9BXg409', key: 'contact.chat_conversation_summary', value: lead_notes || '' },
        // Sawil 2026-07-04 — populate the Best Time / Interest custom fields created
        // in GHL this session. Previously these lived only in notes + CallTime-/Interest-
        // tags because no field id existed (see intake comment above). Both are TEXT, so
        // free-form values carry no dropdown 400-risk on the revenue path. Empty values
        // are dropped by the filter below (so a lead without either still submits fine).
        { id: 'PpDDusEEsMz4xNIcrwRW', key: 'contact.best_time_to_call', value: best_time_to_contact || '' },
        { id: 'fLxx7s1GpVJYlxJl08G6', key: 'contact.medicare_interest', value: interest_type || '' }
      ].filter(function (f) { return f.value; }),
      tags: ['Status-NewLead','Lang-'+((preferred_language||'en').toUpperCase()),'Source-Web']
        .concat(_bestTimeTag?[_bestTimeTag]:[])
        .concat(_interestTag?[_interestTag]:[])
        .concat(utm_source?['UTM-'+utm_source]:[])
        .concat(allTags.filter(function(t){return t!=='Status-NewLead'&&t.indexOf('Lang-')!==0&&t!=='Source-Web';}))
        // PHASE A16 — SOA status tags so advisor pipelines can filter on them.
        .concat(body.soa_signed === true ? ['SOA-Signed'] : (body.soa_pending === true ? ['SOA-Pending'] : []))
        .concat(body.lead_source ? ['Source-' + String(body.lead_source).replace(/[^a-z0-9_]/gi,'')] : [])
        // PHASE A17 — Lead-intel tags. Empty arrays if intel unavailable.
        .concat(intel ? ['Temp-' + intel.lead_temperature, 'Urg-' + intel.urgency, 'Intent-' + intel.intent_strength] : [])
        .concat(intel && intel.compliance_flags && intel.compliance_flags.length ? ['AI-Flagged'] : []),
    };

    // PHASE 11 — Lead type tag for queryability + assigned user routing.
    if (lead_type) {
      try { contact.tags = (contact.tags || []).concat(['LeadType-' + lead_type]); } catch (_t) { /* swallow */ }
    }
    if (ghl_assigned_user_id) {
      contact.assignedTo = ghl_assigned_user_id;
    }
    // PHASE 11 — Path A matched flow: update existing GHL contact instead
    // of creating a duplicate. Falls back to POST create if PUT fails.
    var ghlRes;
    var usedExisting = false;
    if (ghl_contact_id) {
      ghlRes = await ghlFetchRetry('https://services.leadconnectorhq.com/contacts/' + ghl_contact_id, {
        method: 'PUT',
        headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
        body: JSON.stringify(contact)
      });
      if (ghlRes.ok) { usedExisting = true; }
      // If PUT 404s (stale id), fall through to POST create below.
    }
    if (!ghlRes || !ghlRes.ok) {
      ghlRes = await ghlFetchRetry('https://services.leadconnectorhq.com/contacts/', {
        method: 'POST',
        headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
        body: JSON.stringify(contact)
      });
    }
    void usedExisting; // available for downstream conditional logic if needed
    // AUDIT 2026-08-13 (O-05) — true when this submission matched an EXISTING
    // contact and we refreshed it instead of dropping the request.
    var _repeatRequest = false;
    if (!ghlRes.ok) {
      // Sawil 2026-06-29 SECURITY HOTFIX (finding 19) — sanitize CRM errors and
      // handle duplicates. NEVER leak the upstream status/detail/body to the
      // client. Detect GHL's duplicate-contact rejection and return a clean 409.
      var _ghlErrBody = '';
      try { _ghlErrBody = await ghlRes.text(); } catch (e) { _ghlErrBody = ''; }
      var _isDuplicate = ghlRes.status === 400 && /duplicat/i.test(_ghlErrBody);
      // Privacy: log status + duplicate-flag ONLY — never the body (may echo PII).
      console.error('[GHL] Contact creation failed: HTTP ' + ghlRes.status + (_isDuplicate ? ' (duplicate)' : ''));
      if (_isDuplicate) {
        // ── AUDIT 2026-08-13 (O-05, P1) ────────────────────────────────────
        // Returning here DISCARDED the new request. A prospect who submitted
        // three weeks ago, was never reached, and submits again today with a
        // different best-time-to-call and a fresh consent got a friendly
        // "we already have your request" and nothing was recorded: the note
        // block and the opportunity block both sit BELOW this return, so the
        // advisor never learned they asked again. A duplicate is the SIGNAL
        // that they are still waiting — not an error to swallow.
        //
        // Resolve the existing contact so the note/opportunity logic below runs
        // against it. Fail-safe: if the id cannot be resolved we fall back to
        // the original 409 rather than guessing.
        var _dupId = '';
        try {
          var _q = phone10 || email || '';
          if (_q) {
            var _dupRes = await ghlFetchRetry(
              'https://services.leadconnectorhq.com/contacts/?locationId=' + encodeURIComponent(locationId)
                + '&limit=5&query=' + encodeURIComponent(_q),
              { headers: { 'Authorization': 'Bearer ' + token, 'Version': '2021-07-28', 'Accept': 'application/json' } },
            );
            if (_dupRes.ok) {
              var _dupJson = await _dupRes.json().catch(function () { return {}; });
              var _cands = Array.isArray(_dupJson.contacts) ? _dupJson.contacts : [];
              var _hit = _cands.find(function (c) {
                var cDigits = String((c && c.phone) || '').replace(/\D/g, '').slice(-10);
                if (phone10 && cDigits === phone10) return true;
                if (email && String((c && c.email) || '').toLowerCase() === email.toLowerCase()) return true;
                return false;
              });
              if (_hit && _hit.id) _dupId = _hit.id;
            }
          }
        } catch (e) {
          console.error('[GHL] duplicate resolution failed: ' + String(e).slice(0, 120));
        }
        if (!_dupId) {
          return res.status(409).json({
            error: 'DUPLICATE_LEAD',
            message: 'We already have your request on file. A licensed advisor will follow up.',
          });
        }
        console.warn('[GHL] duplicate contact — refreshing the existing record instead of dropping the request');
        // Refresh the mutable fields (best-time, consent flags, language,
        // interest) on the existing contact using the payload already built.
        try {
          await ghlFetchRetry('https://services.leadconnectorhq.com/contacts/' + encodeURIComponent(_dupId), {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token, 'Version': '2021-07-28', 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(contact),
          });
        } catch (e) {
          console.error('[GHL] duplicate refresh PUT failed: ' + String(e).slice(0, 120));
        }
        // Hand the downstream note/opportunity logic a 2xx-shaped result so a
        // repeat request produces a visible, advisor-facing record.
        _repeatRequest = true;
        ghlRes = { ok: true, status: 200, json: async function () { return { contact: { id: _dupId } }; } };
      } else {
        return res.status(502).json({
          error: 'CRM_UNAVAILABLE',
          message: 'We could not submit your request right now. Please call us at 1-855-720-8555.',
        });
      }
    }
    // Sawil 2026-06-30 AUDIT FIX C3/BUG-003 — GHL can return a 2xx with an empty
    // or non-JSON body (gateway 204, truncated proxy response). An unguarded
    // .json() would THROW, fall to the outer catch, return 500, and tell the user
    // it failed — while the contact was already created (orphaned + a retry then
    // duplicates). Guard the parse: a 2xx with no parseable contact id is still a
    // SUCCESS (the contact exists); we just skip the note we can't attach.
    var ghlData = await ghlRes.json().catch(function () { return {}; });
    var contactId = ghlData && ghlData.contact && ghlData.contact.id;
    if (!contactId) {
      console.warn('[GHL] 2xx with no contact id in body — treating as created, skipping note (no PII logged)');
    }
    // Privacy: log only contactId + source + language. Never log first_name,
    // last_name, phone, email, ZIP, DOB, or any other PII. Vercel runtime logs
    // are accessible via the dashboard and may be exported — keeping logs
    // PII-free ensures privacy compliance even if logs are reviewed by ops.
    console.log('[GHL] Contact created', {
      contactId: contactId,
      source: lead_source || '',
      lang: preferred_language || '',
      state: derived_state || '',
      status: 'created'
    });

    if (contactId) {
      var noteBody = '';
      if (lead_notes && lead_notes.trim()) { noteBody += lead_notes.trim(); }
      if (conversation_summary && conversation_summary.trim()) {
        if (noteBody && conversation_summary.trim() !== noteBody) {
          noteBody += '\n\n--- Conversation Transcript ---\n' + conversation_summary.trim();
        } else if (!noteBody) {
          noteBody = conversation_summary.trim();
        }
      }
      if (noteBody) {
        try {
          await fetch('https://services.leadconnectorhq.com/contacts/'+contactId+'/notes',{
            method:'POST',
            headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
            // AUDIT 2026-08-13 (O-05) — flag a repeat submission at the TOP of
            // the note so the advisor immediately sees this person asked again
            // and was not reached the first time.
            body:JSON.stringify({body:(_repeatRequest
              ? '*** REPEAT REQUEST — this person already had a record and submitted again. They are still waiting for contact. ***\n\n'
              : '') + noteBody})
          });
        } catch(e) {
          console.error('[GHL] Note creation exception: ' + (e && e.message ? e.message : String(e)));
        }
      }
    }
    // Sawil 2026-07-04 — repointed lead intake from the old 14-stage pipeline
    // "ClearPoint Medicare Leads" (puGDpLJLyeTSXQqutzsm, New Lead stage
    // 3c52bf0b-2d8f-4174-8a0a-211a3637d02c) to the clean 6-stage
    // "ClearPoint Medicare Leads v2" so all new web/chat leads land in the
    // single source-of-truth pipeline. New Lead stage below belongs to v2.
    var pipelineId = 'HPvihjPaOhPeQ9u0bXUd';
    var pipelineStageId = '5102d9b2-1b1b-415f-9663-9d21283b3032';
    // Sawil 2026-07-16 PHASE 2 — auto-assign the opportunity owner so no lead is
    // ever created orphaned (audit R2: 15/15 opps had no owner). Single-owner
    // agency → the sole licensed advisor. Env override wins so a future multi-
    // advisor setup or a round-robin workflow can take over without a code change;
    // falls back to the current owner id. If neither resolves, the opp is created
    // unassigned exactly as before (graceful — assignment never blocks a lead).
    var defaultOwnerId = process.env.GHL_DEFAULT_OWNER_ID || 'tdBdfxrg2pv3Z76YJm17';
    // Derive a clean opportunity source label from the form_name sent by each form.
    // ChatBot sends 'Website Chatbot - Medicare Plan Review Request'
    // SmartMedicareReview sends 'Smart Medicare Review'
    // LeadForm sends '{source} Form' (e.g. 'contact-page Form', 'homepage-hero Form')
    var rawFormName = (body.form_name || body.lead_source || '').toLowerCase();
    var sourceLabel;
    if (rawFormName.indexOf('chatbot') !== -1 || rawFormName.indexOf('zara') !== -1) {
      sourceLabel = 'Zara ChatBot';
    } else if (rawFormName.indexOf('smart') !== -1) {
      sourceLabel = 'Smart Medicare Review';
    } else if (rawFormName.indexOf('contact') !== -1 || rawFormName.indexOf('free review') !== -1) {
      sourceLabel = 'Free Plan Review';
    } else if (rawFormName.indexOf('hero') !== -1 || rawFormName.indexOf('homepage') !== -1) {
      sourceLabel = 'Homepage Form';
    } else if (rawFormName.indexOf('extra') !== -1) {
      sourceLabel = 'Extra Help';
    } else if (rawFormName.length > 0) {
      sourceLabel = (body.form_name || body.lead_source || 'Website Lead').trim();
    } else {
      sourceLabel = 'Website Lead';
    }
    var oppName = (first_name||'') + (last_name ? ' ' + last_name : '') + ' — ' + sourceLabel;
    if (contactId) {
      try {
        // FASE 15 — opportunity idempotency. The contact upsert already dedupes by
        // phone, but a retry-after-success (client never saw the 200, or the client
        // auto-retry fires) would create a SECOND opportunity for the same contact.
        // Before creating, check for an existing OPEN opp for this contact in this
        // pipeline; if one exists, skip creation and return success (idempotent).
        // Best-effort: a search failure never blocks the lead — we fall through to
        // create, matching the previous always-create behavior on error.
        var _dupOpp = false;
        try {
          var _oppSearch = await fetch('https://services.leadconnectorhq.com/opportunities/search?location_id=' + encodeURIComponent(locationId) + '&contact_id=' + encodeURIComponent(contactId) + '&pipeline_id=' + encodeURIComponent(pipelineId) + '&status=open&limit=20', {
            headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Accept':'application/json'}
          });
          if (_oppSearch.ok) {
            var _oppData = await _oppSearch.json();
            _dupOpp = Array.isArray(_oppData && _oppData.opportunities) && _oppData.opportunities.length > 0;
          }
        } catch (_se) { /* search failed → fall through and create as before */ }
        if (_dupOpp) {
          console.log('[GHL] Opportunity idempotent skip — open opp already exists', { contactId: contactId, pipeline: pipelineId });
          return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId, submission_id: submission_id || undefined, opportunity: 'existing' });
        }
        var oppRes = await fetch('https://services.leadconnectorhq.com/opportunities/',{
          method:'POST',
          headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify(Object.assign({ locationId:locationId, pipelineId:pipelineId, pipelineStageId:pipelineStageId, contactId:contactId, name:oppName, status:'open' }, defaultOwnerId ? { assignedTo: defaultOwnerId } : {}))
        });
        if (!oppRes.ok) {
          // Privacy: log status + pipeline IDs only. The response body may echo
          // contact name / lead source / monetary value — keep PII out of logs.
          console.error('[GHL] Opportunity creation failed: HTTP ' + oppRes.status + ' pipeline=' + pipelineId);
        } else {
          console.log('[GHL] Opportunity created', { contactId: contactId, pipeline: pipelineId });
        }
      } catch(e) {
        console.error('[GHL] Opportunity creation exception: ' + (e && e.message ? e.message : String(e)));
      }
    }
    return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId, submission_id: submission_id || undefined });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

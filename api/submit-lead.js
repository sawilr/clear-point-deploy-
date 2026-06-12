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

export default async function handler(req, res) {
  // ── A15.1 CORS — allowlist ──────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  applyCors(req, res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── A15.2 Rate limit (lead-specific: very conservative — anti-spam) ────
  var ip = clientId(req);
  var rlHour = await rateLimit(ip, { max: 5, windowMs: 60 * 60 * 1000, prefix: 'lead-h' });
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
      if (consent_receipt_hash) receiptBits.push('sha256=' + consent_receipt_hash.slice(0, 16) + '…');
      if (disclaimer_version) receiptBits.push('disclaimer=' + disclaimer_version);
      if (signer_user_agent) receiptBits.push('ua=' + signer_user_agent.slice(0, 60));
      lead_notes = (lead_notes ? lead_notes + '\n\n' : '') + '— TCPA Receipt — ' + receiptBits.join(' · ');
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

    if (!first_name || !phone) return res.status(400).json({ error: 'Missing required fields' });

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
      206,253,360,425,509,564,304,681,262,414,534,608,715,920,307
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
      return { valid: true, national: national };
    }
    var phoneValidation = serverValidatePhone(phone);
    if (!phoneValidation.valid) {
      // Privacy: log validation reason only — never the raw phone number.
      // The phone is rejected before any further processing, so no contact is created.
      console.warn('[VALIDATION] Phone rejected: ' + phoneValidation.reason);
      return res.status(400).json({ error: 'Invalid U.S. phone number', reason: phoneValidation.reason });
    }
    var phone10 = phoneValidation.national;
    var phoneE164 = '+1' + phone10;

    var contact = {
      locationId, firstName: first_name, lastName: last_name || '',
      phone: phoneE164, email: email || undefined,
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
        { id: 'ykiTUcsu3nvawK39hmll', key: 'contact.consent_email', value: email ? 'true' : 'false' },
        { id: 'GSss3tRLKg8mNCzEv3D9', key: 'contact.client_age', value: age || '' },
        { id: 'HoYmwc19InLwUwXNyKcr', key: 'contact.calculated_age', value: calculated_age != null ? String(calculated_age) : '' },
        { id: 'qGryQuR67jXFFVRFBLkz', key: 'contact.lead_quality_flags', value: lead_quality_flags || '' },
        { id: '6vSP5DJvAc6Jl9BXg409', key: 'contact.chat_conversation_summary', value: lead_notes || '' }
      ].filter(function (f) { return f.value; }),
      tags: ['Status-NewLead','Lang-'+((preferred_language||'en').toUpperCase()),'Source-Web']
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
      ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/' + ghl_contact_id, {
        method: 'PUT',
        headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
        body: JSON.stringify(contact)
      });
      if (ghlRes.ok) { usedExisting = true; }
      // If PUT 404s (stale id), fall through to POST create below.
    }
    if (!ghlRes || !ghlRes.ok) {
      ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
        method: 'POST',
        headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
        body: JSON.stringify(contact)
      });
    }
    void usedExisting; // available for downstream conditional logic if needed
    if (!ghlRes.ok) {
      // Privacy: log HTTP status only — never the GHL response body (may echo
      // the contact payload we just sent, which contains PII).
      console.error('[GHL] Contact creation failed: HTTP ' + ghlRes.status);
      return res.status(502).json({ error: 'CRM error', detail: ghlRes.status });
    }
    var ghlData = await ghlRes.json(); var contactId = ghlData.contact && ghlData.contact.id;
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
            body:JSON.stringify({body:noteBody})
          });
        } catch(e) {
          console.error('[GHL] Note creation exception: ' + (e && e.message ? e.message : String(e)));
        }
      }
    }
    var pipelineId = 'puGDpLJLyeTSXQqutzsm';
    var pipelineStageId = '3c52bf0b-2d8f-4174-8a0a-211a3637d02c';
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
        var oppRes = await fetch('https://services.leadconnectorhq.com/opportunities/',{
          method:'POST',
          headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({ locationId:locationId, pipelineId:pipelineId, pipelineStageId:pipelineStageId, contactId:contactId, name:oppName, status:'open' })
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
    return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

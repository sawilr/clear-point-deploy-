// Vercel Serverless Function - GHL Lead Capture
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var token = process.env.HIGHLEVEL_TOKEN;
  var locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) return res.status(500).json({ error: 'Server configuration error' });

  // Read body: try req.body first, fall back to raw stream
  var body = {};
  try { body = req.body || {}; } catch (e1) {
    // req.body getter failed - read raw stream
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
      return res.status(400).json({ error: 'Cannot read request body' });
    }
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
      console.warn('[VALIDATION] Phone rejected: ' + phoneValidation.reason + ' | raw=' + phone);
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
      customFields: [
        { id: 'QULAmkAuVNCQrAMZ487K', key: 'contact.preferred_language', value: preferred_language || 'en' },
        { id: 'R510tHz6GFBaqZgN5e5S', key: 'contact.medicare_status', value: medicare_status || '' },
        { id: 'vPKlhpz6aucJK1U3fJRZ', key: 'contact.consent_marketing', value: 'true' },
        { id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms', value: 'true' },
        { id: 'mHdpDjBSA76lQJrKoixL', key: 'contact.consent_calls', value: 'true' },
        { id: 'ykiTUcsu3nvawK39hmll', key: 'contact.consent_email', value: email ? 'true' : 'false' },
        { id: 'GSss3tRLKg8mNCzEv3D9', key: 'contact.client_age', value: age || '' },
        { id: 'HoYmwc19InLwUwXNyKcr', key: 'contact.calculated_age', value: calculated_age != null ? String(calculated_age) : '' },
        { id: 'qGryQuR67jXFFVRFBLkz', key: 'contact.lead_quality_flags', value: lead_quality_flags || '' },
        { id: '6vSP5DJvAc6Jl9BXg409', key: 'contact.chat_conversation_summary', value: lead_notes || '' }
      ].filter(function (f) { return f.value; }),
      tags: ['Status-NewLead','Lang-'+((preferred_language||'en').toUpperCase()),'Source-Web']
        .concat(utm_source?['UTM-'+utm_source]:[])
        .concat(allTags.filter(function(t){return t!=='Status-NewLead'&&t.indexOf('Lang-')!==0&&t!=='Source-Web';}))
    };

    var ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
      method: 'POST',
      headers: { 'Authorization':'Bearer '+token, 'Version':'2021-07-28', 'Content-Type':'application/json', 'Accept':'application/json', 'User-Agent':'ClearPoint-Website/1.0' },
      body: JSON.stringify(contact)
    });
    if (!ghlRes.ok) { var t=''; try{t=await ghlRes.text()}catch(e){} console.error('[GHL] Contact creation failed: HTTP '+ghlRes.status+' body='+t); return res.status(502).json({error:'CRM error',detail:ghlRes.status}); }
    var ghlData = await ghlRes.json(); var contactId = ghlData.contact && ghlData.contact.id;
    console.log('[GHL] Contact created: id='+contactId+' name="'+first_name+' '+(last_name||'')+'" phone='+phoneE164+' source='+(lead_source||''));

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
    var oppName = (first_name||'') + (last_name ? ' ' + last_name : '') + ' - Smart Review';
    if (contactId) {
      try {
        var oppRes = await fetch('https://services.leadconnectorhq.com/opportunities/',{
          method:'POST',
          headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({ locationId:locationId, pipelineId:pipelineId, pipelineStageId:pipelineStageId, contactId:contactId, name:oppName, status:'open' })
        });
        if (!oppRes.ok) { var ot=''; try{ot=await oppRes.text()}catch(e){} console.error('[GHL] Opportunity creation failed: HTTP '+oppRes.status+' pipeline='+pipelineId+' stage='+pipelineStageId+' body='+ot); }
        else { console.log('[GHL] Opportunity created: contactId='+contactId+' pipeline='+pipelineId); }
      } catch(e) {
        console.error('[GHL] Opportunity creation exception: ' + (e && e.message ? e.message : String(e)));
      }
    }
    return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

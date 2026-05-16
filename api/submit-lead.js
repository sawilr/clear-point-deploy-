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

    var contact = {
      locationId, firstName: first_name, lastName: last_name || '',
      phone: (phone || '').replace(/\D/g, '').slice(0, 10), email: email || undefined,
      // Standard GHL flat fields (confirmed working 2026-05-13)
      city: city || undefined,
      state: derived_state || undefined,
      postalCode: zip || undefined,
      dateOfBirth: date_of_birth || undefined,
      country: 'US',
      source: 'ClearPoint Website',
      // County as address1 (no standard county field in GHL)
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
    if (!ghlRes.ok) { var t=''; try{t=await ghlRes.text()}catch(e){} return res.status(502).json({error:'CRM error',detail:ghlRes.status}); }
    var ghlData = await ghlRes.json(); var contactId = ghlData.contact && ghlData.contact.id;

    if (contactId) {
      // Combine lead_notes + conversation_summary for the GHL note
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
          console.error('GHL note creation failed: ' + (e && e.message ? e.message : String(e)));
        }
      }
    }
    var pipelineId = 'puGDpLJLyeTSXQqutzsm';
    var pipelineStageId = '3c52bf0b-2d8f-4174-8a0a-211a3637d02c';
    var oppName = (first_name||'') + (last_name ? ' ' + last_name : '') + ' - Smart Review';
    if (contactId) {
      try {
        await fetch('https://services.leadconnectorhq.com/opportunities/',{
          method:'POST',
          headers:{'Authorization':'Bearer '+token,'Version':'2021-07-28','Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({ locationId:locationId, pipelineId:pipelineId, pipelineStageId:pipelineStageId, contactId:contactId, name:oppName, status:'open' })
        });
      } catch(e) {
        console.error('GHL opportunity creation failed: ' + (e && e.message ? e.message : String(e)));
      }
    }
    return res.status(200).json({ success: true, message: 'Contact created', contact_id: contactId });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

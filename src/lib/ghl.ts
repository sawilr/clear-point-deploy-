/**
 * GoHighLevel Lead Submission Utility
 * Submits to /api/submit-lead (Vercel serverless function).
 */

export interface GHLLeadPayload {
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string;
  zip_code: string;
  preferred_language: string;
  medicare_status: string;
  interest_type: string;
  best_time_to_contact: string;
  consent_to_contact: boolean;
  consent_text: string;
  lead_notes: string;
  bot_transcript_summary: string;
  source: string;
  page_url: string;
  form_name: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  tags?: string[];
  created_at: string;
}

const API_ROUTE = '/api/submit-lead';

export async function submitLeadToGHL(payload: GHLLeadPayload): Promise<boolean> {
  try {
    // Bridge: forward ALL payload fields to api/submit-lead.js
    // Build body from payload, mapping alternate field names when primary is missing
    const body: Record<string, unknown> = {
      first_name: payload.first_name,
      last_name: payload.last_name || '',
      phone: payload.phone,
      email: payload.email,
      zip: (payload as any).zip || payload.zip_code || '',
      preferred_language: payload.preferred_language === 'Spanish' ? 'es'
        : payload.preferred_language === 'English' ? 'en'
        : payload.preferred_language || 'en',
      medicare_status: payload.medicare_status || '',
      lead_source: payload.source || 'Website',
      utm_source: payload.utm_source || '',
      utm_medium: payload.utm_medium || '',
      utm_campaign: payload.utm_campaign || '',
    };

    // Forward rich fields when present (arrays preserved, long text preserved)
    if (payload.lead_notes) { body.lead_notes = payload.lead_notes; }
    if (payload.bot_transcript_summary) { body.conversation_summary = payload.bot_transcript_summary; }
    if ((payload as any).lead_quality_flags) { body.lead_quality_flags = (payload as any).lead_quality_flags; }
    if ((payload as any).interest_type) { body.interest_type = (payload as any).interest_type; }
    if ((payload as any).date_of_birth) { body.date_of_birth = (payload as any).date_of_birth; }
    if ((payload as any).calculated_age != null) { body.calculated_age = (payload as any).calculated_age; }
    if ((payload as any).city) { body.city = (payload as any).city; }
    if ((payload as any).county) { body.county = (payload as any).county; }
    // derived_state → state mapping
    if ((payload as any).derived_state) {
      body.state = (payload as any).derived_state;
    } else if ((payload as any).state) {
      body.state = (payload as any).state;
    }
    if ((payload as any).source_component) { body.source_component = (payload as any).source_component; }
    // Forward the unified TCPA consent (consent_to_contact). Smart Review, Zara,
    // and LeadForm each build this as a real boolean and gate submission on it.
    // The api/submit-lead.js consent derivation treats consent_to_contact as the
    // umbrella TCPA signal covering marketing calls + SMS.
    if ((payload as any).consent_to_contact != null) { body.consent_to_contact = (payload as any).consent_to_contact; }
    if ((payload as any).consent != null) { body.consent = (payload as any).consent; }
    if ((payload as any).consent_sms != null) { body.consent_sms = (payload as any).consent_sms; }
    if ((payload as any).consent_call != null) { body.consent_call = (payload as any).consent_call; }
    // Tags: preserve array as-is
    if (Array.isArray(payload.tags) && payload.tags.length > 0) { body.tags = payload.tags; }
    // Honeypot anti-bot field — forward to API so the server-side gate can
    // discard bot submissions. Real users never see or fill this field; it
    // arrives empty (''). The API discards any submission where it's non-empty.
    if ((payload as any).website_url !== undefined) { body.website_url = (payload as any).website_url; }
    // PHASE 11 — Phase 10 (Clara) outer-flow audit/identity fields. These
    // are built client-side and must reach the server intact: existing-client
    // routing (ghl_contact_id/ghl_assigned_user_id) avoids duplicate contacts,
    // and the TCPA receipt (consent_text/hash/version/UA) is the auditable
    // record CMS requires.
    if ((payload as any).lead_type) { body.lead_type = (payload as any).lead_type; }
    if ((payload as any).ghl_contact_id) { body.ghl_contact_id = (payload as any).ghl_contact_id; }
    if ((payload as any).ghl_assigned_user_id) { body.ghl_assigned_user_id = (payload as any).ghl_assigned_user_id; }
    if ((payload as any).consent_text) { body.consent_text = (payload as any).consent_text; }
    if ((payload as any).consent_receipt_hash) { body.consent_receipt_hash = (payload as any).consent_receipt_hash; }
    if ((payload as any).disclaimer_version) { body.disclaimer_version = (payload as any).disclaimer_version; }
    if ((payload as any).signer_user_agent) { body.signer_user_agent = (payload as any).signer_user_agent; }
    if ((payload as any).signer_ip) { body.signer_ip = (payload as any).signer_ip; }

    const response = await fetch(API_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data?.error || response.statusText}`);
    }

    // Privacy: log only non-PII identifiers (HTTP status, CRM contact id, lead
    // source label). Never log payload.full_name, phone, email, DOB, ZIP,
    // lead_notes, or any user-supplied content.
    console.info('[GHL] Lead submitted', { status: response.status, source: payload.source, contactId: data?.contact_id });
    return true;
  } catch (error) {
    // Privacy: do NOT persist the failed payload locally — it contains PII
    // (name, phone, email, DOB, ZIP, lead_notes). Drop it. Log only a generic
    // failure label + error message (never the payload).
    console.error('[GHL] Submission failed', { error: error instanceof Error ? error.message : 'unknown' });
    return false;
  }
}

// One-time cleanup: purge any PII left over in localStorage from earlier
// versions that persisted failed-lead payloads. Safe to run on every load.
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  try { localStorage.removeItem('cp_pending_leads'); } catch { /* ignore */ }
}

// Kept as no-op for API stability. Failed leads are no longer stored locally
// (would have contained PII). Callers receive an empty array.
export function getPendingLeads(): GHLLeadPayload[] {
  return [];
}

export function clearPendingLeads(): void {
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    try { localStorage.removeItem('cp_pending_leads'); } catch { /* ignore */ }
  }
}

export function getSuccessMessage(lang: 'en' | 'es'): string {
  return lang === 'es'
    ? 'Gracias. Hemos recibido su información. Un agente licenciado de ClearPoint Senior Advisors se comunicará con usted pronto.'
    : 'Thank you. Your information has been received. A licensed agent from ClearPoint Senior Advisors will contact you soon.';
}

export function getErrorMessage(lang: 'en' | 'es'): string {
  return lang === 'es'
    ? 'Algo salió mal al enviar su solicitud. Inténtalo nuevamente o llámenos directamente.'
    : 'Something went wrong while sending your request. Please try again or call us directly.';
}

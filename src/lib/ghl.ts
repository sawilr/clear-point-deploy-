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
    if ((payload as any).consent != null) { body.consent = (payload as any).consent; }
    if ((payload as any).consent_sms != null) { body.consent_sms = (payload as any).consent_sms; }
    if ((payload as any).consent_call != null) { body.consent_call = (payload as any).consent_call; }
    // Tags: preserve array as-is
    if (Array.isArray(payload.tags) && payload.tags.length > 0) { body.tags = payload.tags; }

    const response = await fetch(API_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data?.error || response.statusText}`);
    }

    console.info('[GHL] Lead submitted via API route:', { name: payload.full_name, source: payload.source, contactId: data?.contact_id, status: response.status });
    return true;
  } catch (error) {
    // Store failed submissions locally
    const pending = JSON.parse(localStorage.getItem('cp_pending_leads') || '[]');
    pending.push(payload);
    localStorage.setItem('cp_pending_leads', JSON.stringify(pending));
    console.error('[GHL] Submission failed — stored locally:', { name: payload.full_name, source: payload.source, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

export function getPendingLeads(): GHLLeadPayload[] {
  return JSON.parse(localStorage.getItem('cp_pending_leads') || '[]');
}

export function clearPendingLeads(): void {
  localStorage.removeItem('cp_pending_leads');
}

export function getSuccessMessage(lang: 'en' | 'es'): string {
  return lang === 'es'
    ? 'Gracias. Hemos recibido tu información. Un agente licenciado de ClearPoint Senior Advisors se comunicará contigo pronto.'
    : 'Thank you. Your information has been received. A licensed agent from ClearPoint Senior Advisors will contact you soon.';
}

export function getErrorMessage(lang: 'en' | 'es'): string {
  return lang === 'es'
    ? 'Algo salió mal al enviar tu solicitud. Inténtalo nuevamente o llámanos directamente.'
    : 'Something went wrong while sending your request. Please try again or call us directly.';
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — /soa/:token route.
//
// Hydrates the form from /api/soa-status using the URL token, then renders
// the SOAForm component. On submit, POSTs to /api/sign-soa.
//
// States:
//   - loading: fetching token status
//   - notFound: bad/expired token
//   - alreadyConsumed: already-signed (idempotent)
//   - ready: render form
//   - submitting: POSTing signature
//   - success: thank-you state
//   - error: retry
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { SOAForm, type SOAFormResult } from '../components/SOAForm';
import { tLabel } from '../lib/soaContent';

interface LeadHydrate {
  fullName: string;
  phone: string;
  email: string;
  zip: string;
  language: 'en' | 'es';
  leadSource: 'customer_service' | 'smart_review';
}

type Phase = 'loading' | 'notFound' | 'alreadyConsumed' | 'ready' | 'submitting' | 'success' | 'error';

export default function SignSOA() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [lead, setLead] = useState<LeadHydrate | null>(null);
  const [signedResult, setSignedResult] = useState<SOAFormResult | null>(null);
  const [error, setError] = useState<string>('');

  // ── Fetch token status on mount ────────────────────────────────────────
  useEffect(() => {
    if (!token) { setPhase('notFound'); return; }
    let cancelled = false;
    (async () => {
      // PHASE 6 — abort hung fetches after 15s on mobile networks.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const r = await fetch(`/api/soa-status?token=${encodeURIComponent(token)}`, { credentials: 'omit', signal: controller.signal });
        clearTimeout(timer);
        if (cancelled) return;
        if (r.status === 404) { setPhase('notFound'); return; }
        if (!r.ok) { setPhase('error'); setError('status_failed'); return; }
        const data = await r.json();
        if (!data.exists) { setPhase('notFound'); return; }
        if (data.consumed) { setPhase('alreadyConsumed'); return; }
        setLead(data.lead);
        setPhase('ready');
      } catch (e) {
        clearTimeout(timer);
        if (!cancelled) {
          setPhase('error');
          setError((e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const language: 'en' | 'es' = lead?.language || 'es';

  // ── Submit handler ─────────────────────────────────────────────────────
  const handleSubmit = async (formData: Record<string, unknown>) => {
    setPhase('submitting');
    // PHASE 6 — abort after 20s (PDF gen + GHL post can be slow on cold start).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const r = await fetch('/api/sign-soa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ ...formData, token, leadSource: lead?.leadSource || 'customer_service' }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setPhase('error');
        setError(data.error || 'signing_failed');
        return;
      }
      setSignedResult({ ok: true, soaId: data.soaId, signedAt: data.signedAt, pdfHash: data.pdfHash });
      setPhase('success');
    } catch (e) {
      clearTimeout(timer);
      setPhase('error');
      setError((e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-cream-50 py-16">
      <div className="max-w-3xl mx-auto px-5">
        <div className="bg-white rounded-2xl shadow-lifted p-8 sm:p-12">
          {phase === 'loading' && (
            <div className="text-center py-16">
              <p className="text-earth-600">{tLabel('signing', language)}</p>
            </div>
          )}

          {phase === 'notFound' && (
            <div className="text-center py-12">
              <h1 className="font-serif text-2xl mb-4 text-earth-900">
                {language === 'es' ? 'Enlace inválido o expirado' : 'Invalid or expired link'}
              </h1>
              <p className="text-earth-600">
                {language === 'es'
                  ? 'Este enlace de firma no es válido o ya pasaron 24 horas. Por favor llámenos al 1-866-310-8702.'
                  : 'This signing link is no longer valid (links expire after 24 hours). Please call us at 1-866-310-8702.'}
              </p>
            </div>
          )}

          {phase === 'alreadyConsumed' && (
            <div className="text-center py-12">
              <h1 className="font-serif text-2xl mb-4 text-earth-900">
                {language === 'es' ? 'Este documento ya está firmado' : 'This document is already signed'}
              </h1>
              <p className="text-earth-600">
                {language === 'es'
                  ? 'Hemos recibido su firma. Un asesor de ClearPoint le llamará pronto.'
                  : 'We have received your signature. A ClearPoint advisor will contact you soon.'}
              </p>
            </div>
          )}

          {phase === 'ready' && lead && (
            <SOAForm
              language={language}
              lead={lead}
              onSubmit={handleSubmit}
            />
          )}

          {phase === 'submitting' && (
            <div className="text-center py-16">
              <p className="text-earth-600">{tLabel('signing', language)}</p>
            </div>
          )}

          {phase === 'success' && signedResult && (
            <div className="text-center py-12">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-50 flex items-center justify-center">
                <svg className="w-10 h-10 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h1 className="font-serif text-2xl mb-3 text-earth-900">{tLabel('success_title', language)}</h1>
              <p className="text-earth-600 mb-6">{tLabel('success_body', language)}</p>
              {/* Sawil 2026-07-04 (a11y, approved) — earth-400 on light bg is 2.6:1
                  (AA fail); earth-600 = 4.9:1, same family. */}
              <p className="text-xs text-earth-600">
                SOA ID: {signedResult.soaId}<br/>
                {language === 'es' ? 'Firmado' : 'Signed'}: {signedResult.signedAt}
              </p>
            </div>
          )}

          {phase === 'error' && (
            <div className="text-center py-12">
              <h1 className="font-serif text-2xl mb-3 text-earth-900">{tLabel('error_title', language)}</h1>
              <p className="text-earth-600 mb-4">{tLabel('error_retry', language)}</p>
              <button
                onClick={() => { setPhase('ready'); setError(''); }}
                className="px-6 py-3 bg-gold-500 text-white rounded-full font-medium hover:bg-gold-600 transition-colors"
              >
                {language === 'es' ? 'Reintentar' : 'Try again'}
              </button>
              {error && (
                <p className="text-xs text-earth-600 mt-3">
                  {language === 'es'
                    ? `Si el problema continúa, llámenos al 1-866-310-8702 (Referencia: ${error}).`
                    : `If the problem continues, call us at 1-866-310-8702 (Reference: ${error}).`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

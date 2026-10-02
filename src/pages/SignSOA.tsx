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

// CP-01 (2026-08-13) — 'unavailable' added so a server-side 503 (SOA workflow off) is
// distinguishable from a transient network 'error'. They need opposite affordances:
// one is worth retrying, the other never is.
// AUDIT 2026-10-01 (SEC-TOK-01/02) — 'challenge' is new. /api/soa-status no
// longer hands the beneficiary's details to whoever holds the link: a GET only
// says WHICH factor is needed, and the prefill arrives from a POST once the
// factor matches. So the page now has a step between "link is live" and "form".
type Phase = 'loading' | 'notFound' | 'alreadyConsumed' | 'challenge' | 'ready' | 'submitting' | 'success' | 'error' | 'unavailable';

export default function SignSOA() {
  const params = useParams<{ token: string }>();
  const token = params.token || '';
  const [phase, setPhase] = useState<Phase>('loading');
  const [lead, setLead] = useState<LeadHydrate | null>(null);
  const [signedResult, setSignedResult] = useState<SOAFormResult | null>(null);
  const [error, setError] = useState<string>('');
  // CP-01 (2026-08-13) — bumping this re-runs the hydration effect so "Try again"
  // actually re-fetches instead of switching to a phase that cannot render.
  const [reloadKey, setReloadKey] = useState(0);
  const [factorRequired, setFactorRequired] = useState<string>('PHONE_LAST4');
  const [factorValue, setFactorValue] = useState('');
  const [factorError, setFactorError] = useState('');
  const [factorBusy, setFactorBusy] = useState(false);
  // EV-14 — whether a confirmation copy actually went out. The page may not
  // promise one otherwise.
  const [copySent, setCopySent] = useState(false);

  // ── Second factor: exchange the link + factor for the prefill ───────────
  const submitFactor = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setFactorError('');
    setFactorBusy(true);
    try {
      const r = await fetch('/api/soa-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ token, factor: factorValue.trim() }),
      });
      const data = await r.json();
      if (r.status === 429) { setFactorError('too_many'); return; }
      if (!r.ok || !data.verified) {
        setFactorError(data.reason === 'SECOND_FACTOR_LOCKED' ? 'locked' : 'mismatch');
        return;
      }
      setLead(data.lead);
      setPhase('ready');
    } catch {
      setFactorError('network');
    } finally {
      setFactorBusy(false);
    }
  };

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
        // CP-01 (2026-08-13) — 503 is NOT a transient failure, it means the SOA
        // workflow is switched off server-side (soa-status returns SOA_DISABLED while
        // SOA_ENABLED is false). Previously this fell into the generic 'error' phase,
        // which offered a "Try again" button that could never succeed. Anyone holding
        // a bookmarked or emailed /soa/:token link — the links are valid for 24h, so
        // this is a real person, not a hypothetical — saw a retry loop instead of an
        // explanation. Route it to a distinct state that tells the truth and gives
        // them a working way to reach a human.
        if (r.status === 503) { setPhase('unavailable'); return; }
        if (!r.ok) { setPhase('error'); setError('status_failed'); return; }
        const data = await r.json();
        if (!data.exists) {
          // LINK_ALREADY_USED is a different story from "never existed": the
          // person already signed, and telling them "not found" would invite a
          // second signature on the same appointment.
          setPhase(data.reason === 'LINK_ALREADY_USED' ? 'alreadyConsumed' : 'notFound');
          return;
        }
        setFactorRequired(data.factorRequired || 'PHONE_LAST4');
        setPhase('challenge');
      } catch (e) {
        clearTimeout(timer);
        if (!cancelled) {
          setPhase('error');
          setError((e as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, reloadKey]);

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
      setCopySent(data.copySent === true);
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
                  ? 'Este enlace de firma no es válido o ya pasaron 24 horas. Por favor llámenos al 1-855-720-8555.'
                  : 'This signing link is no longer valid (links expire after 24 hours). Please call us at 1-855-720-8555.'}
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

          {phase === 'challenge' && (
            <form onSubmit={submitFactor} className="py-10 max-w-md mx-auto">
              <h1 className="font-serif text-2xl mb-3 text-earth-900">
                {language === 'es' ? 'Confirmemos que es usted' : "Let's confirm it's you"}
              </h1>
              <p className="text-earth-600 mb-6 leading-relaxed">
                {factorRequired === 'ZIP'
                  ? (language === 'es' ? 'Escriba su código postal.' : 'Enter your ZIP code.')
                  : (language === 'es'
                    ? 'Escriba los últimos cuatro dígitos del teléfono donde recibió este enlace.'
                    : 'Enter the last four digits of the phone number where you received this link.')}
              </p>
              <label className="block">
                <span className="sr-only">
                  {factorRequired === 'ZIP'
                    ? (language === 'es' ? 'Código postal' : 'ZIP code')
                    : (language === 'es' ? 'Últimos cuatro dígitos' : 'Last four digits')}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={factorValue}
                  onChange={(e) => { setFactorValue(e.target.value.replace(/\D/g, '').slice(0, 5)); setFactorError(''); }}
                  aria-invalid={!!factorError}
                  className="w-full px-4 py-4 text-2xl tracking-[0.3em] text-center rounded-lg border border-cream-300 bg-white text-earth-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-200"
                />
              </label>
              {factorError && (
                <p role="alert" className="text-sm text-red-600 mt-3 leading-relaxed">
                  {factorError === 'locked'
                    ? (language === 'es'
                      ? 'Demasiados intentos. Por su seguridad este enlace quedó bloqueado — llámenos al 1-855-720-8555.'
                      : 'Too many attempts. For your protection this link is now locked — please call us at 1-855-720-8555.')
                    : factorError === 'too_many'
                      ? (language === 'es' ? 'Demasiados intentos seguidos. Espere unos minutos.' : 'Too many attempts in a row. Please wait a few minutes.')
                      : factorError === 'network'
                        ? (language === 'es' ? 'No pudimos conectar. Inténtelo de nuevo.' : 'We could not connect. Please try again.')
                        : (language === 'es' ? 'Esos números no coinciden. Inténtelo de nuevo.' : "That doesn't match. Please try again.")}
                </p>
              )}
              <button
                type="submit"
                disabled={factorBusy || factorValue.length < 4}
                className="mt-6 w-full px-6 py-4 bg-gold-500 text-white rounded-full font-bold hover:bg-gold-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-h-[52px]"
              >
                {factorBusy ? (language === 'es' ? 'Verificando…' : 'Checking…') : (language === 'es' ? 'Continuar' : 'Continue')}
              </button>
            </form>
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
              <p className="text-earth-600 mb-2">{tLabel('success_body', language)}</p>
              <p className="text-earth-600 mb-6">
                {tLabel(copySent ? 'success_copy_sent' : 'success_copy_onreq', language)}
              </p>
              {/* Sawil 2026-07-04 (a11y, approved) — earth-400 on light bg is 2.6:1
                  (AA fail); earth-600 = 4.9:1, same family. */}
              <p className="text-xs text-earth-600">
                SOA ID: {signedResult.soaId}<br/>
                {language === 'es' ? 'Firmado' : 'Signed'}: {signedResult.signedAt}
              </p>
            </div>
          )}

          {/* CP-01 (2026-08-13) — SOA workflow disabled server-side. No retry button:
              retrying cannot succeed, and offering it wastes a senior's time on a dead
              control. The phone number is the actual next step, and the SOA can be
              completed by phone or on paper with the advisor, so nothing is lost. */}
          {phase === 'unavailable' && (
            <div className="text-center py-12">
              <h1 className="font-serif text-2xl mb-4 text-earth-900">
                {language === 'es'
                  ? 'La firma en línea no está disponible por ahora'
                  : 'Online signing is not available right now'}
              </h1>
              <p className="text-earth-600 mb-2">
                {language === 'es'
                  ? 'No hay ningún problema con su solicitud y no se perdió nada. En este momento el formulario de Scope of Appointment se completa directamente con su asesor licenciado.'
                  : "There is nothing wrong with your request and nothing was lost. Right now the Scope of Appointment is completed directly with your licensed advisor."}
              </p>
              <p className="text-earth-600">
                {language === 'es'
                  ? 'Llámenos al 1-855-720-8555 y su asesor lo resuelve en la misma llamada.'
                  : 'Call us at 1-855-720-8555 and your advisor will take care of it on the same call.'}
              </p>
            </div>
          )}

          {phase === 'error' && error === 'CRM_WRITE_FAILED' && (
            // AUDIT 2026-10-01 (EV-12 / WVG-09) — the signature WAS taken: it is
            // hashed, evidenced and the token is burned. Only the delivery to the
            // system of record failed. Showing the generic "we could not save your
            // signature" here would be false and would invite a second signature,
            // creating a duplicate scope for the same appointment. Say exactly
            // what happened, and do not offer a retry button.
            <div className="text-center py-12">
              <h1 className="font-serif text-2xl mb-3 text-earth-900">
                {language === 'es' ? 'Su firma quedó registrada' : 'Your signature was recorded'}
              </h1>
              <p className="text-earth-600 mb-2 max-w-prose mx-auto leading-relaxed">
                {language === 'es'
                  ? 'Recibimos y guardamos su firma, pero todavía no pudimos archivarla en nuestro sistema. No la firme de nuevo.'
                  : 'We received and stored your signature, but we have not been able to file it in our system yet. Please do not sign again.'}
              </p>
              <p className="text-earth-600 mb-4 max-w-prose mx-auto leading-relaxed">
                {language === 'es'
                  ? 'Un asesor licenciado lo completará y le confirmará. Si prefiere, llámenos al 1-855-720-8555.'
                  : 'A licensed advisor will complete it and confirm with you. If you prefer, call us at 1-855-720-8555.'}
              </p>
            </div>
          )}

          {phase === 'error' && error !== 'CRM_WRITE_FAILED' && (
            <div className="text-center py-12">
              <h1 className="font-serif text-2xl mb-3 text-earth-900">{tLabel('error_title', language)}</h1>
              <p className="text-earth-600 mb-4">{tLabel('error_retry', language)}</p>
              {/* CP-01 (2026-08-13) — this used to call setPhase('ready'), but on a
                  hydration failure `lead` is still null and the 'ready' branch requires
                  `lead &&`, so "Try again" rendered a BLANK card with no way forward —
                  a dead end, worse than the error it replaced. Retry the actual fetch
                  by remounting the effect instead. */}
              <button
                onClick={() => { setError(''); setPhase('loading'); setReloadKey((k) => k + 1); }}
                className="px-6 py-3 bg-gold-500 text-white rounded-full font-medium hover:bg-gold-600 transition-colors"
              >
                {language === 'es' ? 'Reintentar' : 'Try again'}
              </button>
              {error && (
                <p className="text-xs text-earth-600 mt-3">
                  {language === 'es'
                    ? `Si el problema continúa, llámenos al 1-855-720-8555 (Referencia: ${error}).`
                    : `If the problem continues, call us at 1-855-720-8555 (Reference: ${error}).`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

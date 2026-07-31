import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage, useLocalizedPath } from '../hooks/useLanguage';
import { LockIcon, CheckIcon } from './icons';
import { Link, useLocation } from 'react-router';
import { submitLeadToGHL, getLastSubmitStatus } from '../lib/ghl';
import { validatePersonName, validatePhone, validateEmail } from '../lib/validation';
import { buildConsentReceipt, TCPA_CONSENT_TEXT_EN, TCPA_CONSENT_TEXT_ES } from '../lib/disclaimerVersion';
import { getZipInfo } from '../lib/zipLookup';
import { track, Events } from '../lib/analytics';

// Spec-required messages — Free Review form
const FREE_REVIEW_SUCCESS_EN = 'Thank you — your review request was sent successfully. A licensed Clear Point Senior Advisors advisor will review your information and contact you during business hours.';
const FREE_REVIEW_SUCCESS_ES = 'Gracias — su solicitud fue enviada correctamente. Un asesor licenciado de Clear Point Senior Advisors revisará su información y se comunicará con usted durante horas laborables.';
const FREE_REVIEW_ERROR_EN = 'We could not send your request right now. Please try again or call 1-855-720-8555.';
const FREE_REVIEW_ERROR_ES = 'No pudimos enviar su solicitud en este momento. Intente nuevamente o llame al 1-855-720-8555.';
// Sawil 2026-07-09 — distinct, generic copy for the server rate limit (429).
// Reveals no internal logic; gives the caller a working path (phone).
const FREE_REVIEW_LIMIT_EN = 'We already received your request. If you need to reach us sooner, please call 1-855-720-8555.';
const FREE_REVIEW_LIMIT_ES = 'Ya recibimos su solicitud. Si necesita comunicarse antes, por favor llame al 1-855-720-8555.';

// Fake ZIP patterns (mirrors ChatBot.tsx lead_zip handler)
const FAKE_ZIPS = new Set(['00000','11111','22222','33333','44444','55555',
  '66666','77777','88888','99999','12345','54321','11223','00001']);

interface LeadFormProps {
  variant?: 'hero-inline' | 'page-sidebar' | 'standalone';
  source?: string;
}

export function LeadForm({ variant = 'standalone', source = 'website' }: LeadFormProps) {
  const { lang, t } = useLanguage();
  // Sawil 2026-07-28 AUDIT CPF-003 — consent link stays inside the /es space.
  const lp = useLocalizedPath();
  const location = useLocation();
  // Sawil 2026-06-16 compliance audit — programmatic label↔input association
  // (WCAG 1.3.1 / 4.1.2). useId() keeps ids unique even if two LeadForms render
  // on the same page. `fid('phone')` → label htmlFor + input id.
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const firstNameRef = useRef<HTMLInputElement>(null);
  const formStartedRef = useRef(false);
  // Sawil 2026-07-09 SECURITY — form render timestamp for the server-side
  // min-fill-time bot gate (real users take far longer than 3s to fill this).
  const formRenderedAtRef = useRef(Date.now());
  const [submitted, setSubmitted] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  // Cursor-on-first-name autofocus — triggered when any Free Review CTA
  // navigates here with `?focus=name`. The CTA handler scrolls the form
  // into view; this effect positions the cursor in the First Name field
  // as soon as the form is mounted, matching the desktop UX on mobile
  // too. iOS Safari restricts programmatic keyboard opening (gesture
  // chain expires across rAF/setTimeout) — the cursor is still visibly
  // placed in the field; the user taps to open the keyboard.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('focus') !== 'name') return;
    let attempts = 30;
    const tryFocus = () => {
      const el = firstNameRef.current;
      if (el) {
        el.focus({ preventScroll: true });
      } else if (--attempts > 0) {
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }, [location.search]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    zip: '',
    preferred_language: 'en',
    medicare_status: '',
    best_time_to_contact: '',
    tcpa_consent: false,
    // Honeypot anti-bot field — must stay empty. Bots that scrape and fill
    // every input will populate it. API discards submissions with any value.
    // Innocuous-looking name so bots are more likely to fill it.
    website_url: '',
  });
  const [errors, setErrors] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    zip: '',
    email: '',
    consent: '',
  });

  const getUtmParams = () => {
    if (typeof window === 'undefined') return {};
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
    };
  };

  // Generic, PII-free form_start (fires once on first interaction).
  const markStarted = () => {
    if (formStartedRef.current) return;
    formStartedRef.current = true;
    track(Events.FORM_START, { event_category: 'lead', event_label: `${source}_form`, language: lang });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    markStarted();
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
    // Clear inline error for the changed field on user interaction
    const errorKeyMap: Record<string, keyof typeof errors> = {
      first_name: 'first_name',
      last_name: 'last_name',
      email: 'email',
      tcpa_consent: 'consent',
    };
    if (errorKeyMap[name]) {
      setErrors(prev => ({ ...prev, [errorKeyMap[name]]: '' }));
    }
  };

  // Phone: strip to digits, normalize +1/1 prefix, cap at 10 digits
  const handlePhone = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '');
    const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    setFormData(prev => ({ ...prev, phone: national.slice(0, 10) }));
    setErrors(prev => ({ ...prev, phone: '' }));
  };

  // ZIP: digits only, max 5 — prevents letter/symbol entry at input level
  const handleZip = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
    setFormData(prev => ({ ...prev, zip: digits }));
    setErrors(prev => ({ ...prev, zip: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const newErrors = { first_name: '', last_name: '', phone: '', zip: '', email: '', consent: '' };
    let hasError = false;

    // ── First name ──────────────────────────────────────────────────────────
    const firstNameCheck = validatePersonName(formData.first_name);
    if (!firstNameCheck.valid) {
      newErrors.first_name = lang === 'es'
        ? 'Por favor ingrese un primer nombre válido sin números, símbolos ni palabras inapropiadas.'
        : 'Please enter a valid first name without numbers, symbols, or inappropriate words.';
      hasError = true;
    }

    // ── Last name ───────────────────────────────────────────────────────────
    const lastNameCheck = validatePersonName(formData.last_name);
    if (!lastNameCheck.valid) {
      newErrors.last_name = lang === 'es'
        ? 'Por favor ingrese un apellido válido sin números, símbolos ni palabras inapropiadas.'
        : 'Please enter a valid last name without numbers, symbols, or inappropriate words.';
      hasError = true;
    }

    // ── Phone ───────────────────────────────────────────────────────────────
    const phoneCheck = validatePhone(formData.phone);
    if (!phoneCheck.valid) {
      newErrors.phone = lang === 'es'
        ? 'Por favor ingrese un número de teléfono válido de Estados Unidos de 10 dígitos.'
        : 'Please enter a valid 10-digit U.S. phone number.';
      hasError = true;
    }

    // ── ZIP — exact 5 digits, not fake, supported state (NY/NJ/CT only) ─────
    // Sawil 2026-06 COMPLIANCE — FL is not an authorized service area; a FL ZIP
    // now resolves to supported === false (see zipLookup.ts) so it fails here.
    const rawDigits = formData.zip.replace(/\D/g, '');
    let zipValid = false;
    if (rawDigits.length === 5 && /^\d{5}$/.test(rawDigits) &&
        !FAKE_ZIPS.has(rawDigits) && !/^(\d)\1{4}$/.test(rawDigits)) {
      const zipInfo = getZipInfo(rawDigits);
      zipValid = zipInfo !== null && zipInfo.supported === true;
    }
    if (!zipValid) {
      newErrors.zip = lang === 'es'
        ? 'Por favor ingrese un código postal válido de 5 dígitos de NY, NJ o CT.'
        : 'Please enter a valid 5-digit ZIP code from NY, NJ, or CT.';
      hasError = true;
    }

    // ── Email — optional; validate only if non-empty ────────────────────────
    if (formData.email.trim()) {
      const emailCheck = validateEmail(formData.email.trim());
      if (!emailCheck.valid) {
        newErrors.email = lang === 'es'
          ? 'Por favor ingrese un correo electrónico válido, o déjelo en blanco si prefiere.'
          : 'Please enter a valid email address, or leave it blank if you prefer.';
        hasError = true;
      }
    }

    // ── Consent ─────────────────────────────────────────────────────────────
    if (!formData.tcpa_consent) {
      newErrors.consent = lang === 'es'
        ? 'Por favor confirme su consentimiento antes de enviar.'
        : 'Please confirm your consent before submitting.';
      hasError = true;
    }

    setErrors(newErrors);
    if (hasError) {
      // AUDIT 2026-07-28 CPF-004 — keyboard/screen-reader users were left on the
      // Submit button with no way to reach the first error. Move focus to it.
      const order: Array<'first_name' | 'last_name' | 'phone' | 'email' | 'zip'> =
        ['first_name', 'last_name', 'phone', 'email', 'zip'];
      const firstBad = order.find((k) => newErrors[k]);
      requestAnimationFrame(() => {
        const el = document.getElementById(fid(firstBad ?? 'tcpa_consent')) as HTMLElement | null;
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      return;
    }

    setSubmitting(true);
    setError(false);

    const utm = getUtmParams();
    // Sawil 2026-06-30 AUDIT FIX (Phase 2 consent integrity) — record the EXACT
    // canonical TCPA text shown above, in the language it was displayed, plus a
    // SHA-256 receipt + disclaimer version. Was a short English-only string that
    // matched neither the displayed checkbox nor the user's language.
    const consentReceipt = await buildConsentReceipt(lang === 'es' ? 'es' : 'en');
    const payload = {
      source: 'ClearPoint Senior Advisors Website',
      page_url: window.location.href,
      form_name: source === 'website' ? 'Website Form' : `${source} Form`,
      first_name: formData.first_name.trim(),
      last_name: formData.last_name.trim(),
      full_name: `${formData.first_name.trim()} ${formData.last_name.trim()}`,
      phone: phoneCheck.e164,
      email: formData.email.trim(),
      zip_code: rawDigits,
      preferred_language: formData.preferred_language === 'es' ? 'Spanish' : 'English',
      medicare_status: formData.medicare_status,
      interest_type: '',
      best_time_to_contact: formData.best_time_to_contact,
      consent_to_contact: formData.tcpa_consent,
      consent_text: consentReceipt.consentText,
      consent_receipt_hash: consentReceipt.consentTextHash,
      disclaimer_version: consentReceipt.disclaimerVersion,
      signer_user_agent: consentReceipt.userAgent || '',
      lead_notes: `Source: ${source}. Status: ${formData.medicare_status || 'not specified'}.`,
      bot_transcript_summary: '',
      tags: ['Website Lead', 'Medicare Lead', 'ClearPoint Website', 'Form Lead', 'Consent Captured'],
      created_at: new Date().toISOString(),
      // Honeypot value (always empty for real users; bots fill it and API discards)
      website_url: formData.website_url,
      // Min-fill-time bot gate input (server only enforces when present)
      elapsed_ms: Date.now() - formRenderedAtRef.current,
      ...utm,
    };

    setRateLimited(false);
    const success = await submitLeadToGHL(payload);
    setSubmitting(false);
    if (success) {
      // Generic, PII-free conversion event (no name/phone/email/ZIP).
      track(Events.FORM_SUBMIT_SUCCESS, { event_category: 'lead', event_label: `${source}_form`, language: lang });
      setSubmitted(true);
    } else if (getLastSubmitStatus() === 429) {
      // Server rate limit — distinct, calm message (not a scary failure).
      setRateLimited(true);
      setError(true);
    } else {
      setError(true);
    }
  };

  if (submitted) {
    return (
      // role=status + aria-live: screen readers announce the confirmation as
      // soon as it renders (it only renders AFTER real server confirmation).
      <div role="status" aria-live="polite" className="bg-cream-50 rounded-2xl p-7 sm:p-8 shadow-lifted text-center">
        <div className="w-14 h-14 bg-sage-200 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckIcon className="w-7 h-7 text-sage-500" />
        </div>
        <h4 className="font-serif text-lg text-earth-900 mb-2">{t('Thank You!', '¡Gracias!')}</h4>
        <p className="text-earth-600 text-sm mb-4">
          {lang === 'es' ? FREE_REVIEW_SUCCESS_ES : FREE_REVIEW_SUCCESS_EN}
        </p>
        <p className="text-earth-700 text-sm">{t('Reply STOP to unsubscribe from SMS.', 'Responda STOP para cancelar suscripción de SMS.')}</p>
      </div>
    );
  }

  return (
    <div className={`bg-cream-50 rounded-2xl shadow-lifted ${variant === 'hero-inline' ? 'p-7 sm:p-8' : 'p-6 sm:p-8'}`}>
      <div className="relative">
        <div className="absolute -top-11 left-1/2 -translate-x-1/2 bg-gold-400 text-earth-900 text-[11px] font-extrabold tracking-wider uppercase px-5 py-2 rounded-full whitespace-nowrap shadow-soft">
          {t('Free Medicare Review', 'Revisión Medicare Gratis')}
        </div>
        <h2 id="lead-form-heading" className="font-serif text-xl text-earth-900 text-center mt-2 mb-1 scroll-mt-[100px]">
          {t('Get Your Free Plan Review', 'Obtenga Su Revisión Gratis')}
        </h2>
        <p className="text-earth-600 text-sm text-center mb-6">
          {t('Takes 2 minutes · No pressure · Confidential', 'Toma 2 minutos · Sin presión · Confidencial')}
        </p>

        {error && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-red-700 text-xs">
              {rateLimited
                ? (lang === 'es' ? FREE_REVIEW_LIMIT_ES : FREE_REVIEW_LIMIT_EN)
                : (lang === 'es' ? FREE_REVIEW_ERROR_ES : FREE_REVIEW_ERROR_EN)}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} method="post" action="#" className="space-y-3.5" noValidate aria-labelledby="lead-form-heading">
          {/* Honeypot anti-bot field — hidden from sight, keyboard, and screen
              readers. Real users never see or touch this. Bots that scrape
              and auto-fill every input will populate it; the API discards
              any submission where this field has a value. Defense in depth:
              tabIndex={-1} blocks keyboard tab, aria-hidden hides from AT,
              autoComplete=off prevents browser autofill, off-screen position
              prevents visual rendering. */}
          <input
            type="text"
            name="website_url"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            value={formData.website_url}
            onChange={handleChange}
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
          />
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor={fid('first_name')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('First Name', 'Nombre')} *</label>
              <input id={fid('first_name')} aria-invalid={errors.first_name ? true : undefined} aria-describedby={errors.first_name ? fid('first_name-err') : undefined} ref={firstNameRef} type="text" name="first_name" required autoComplete="given-name" value={formData.first_name} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder={t('John', 'Juan')} />
              {errors.first_name && <p id={fid('first_name-err')} role="alert" className="text-xs text-red-700 mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label htmlFor={fid('last_name')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Last Name', 'Apellido')} *</label>
              <input id={fid('last_name')} aria-invalid={errors.last_name ? true : undefined} aria-describedby={errors.last_name ? fid('last_name-err') : undefined} type="text" name="last_name" required autoComplete="family-name" value={formData.last_name} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder={t('Smith', 'García')} />
              {errors.last_name && <p id={fid('last_name-err')} role="alert" className="text-xs text-red-700 mt-1">{errors.last_name}</p>}
            </div>
          </div>
          <div>
            <label htmlFor={fid('phone')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Phone Number', 'Teléfono')} *</label>
            <input id={fid('phone')} aria-invalid={errors.phone ? true : undefined} aria-describedby={errors.phone ? fid('phone-err') : undefined} type="tel" name="phone" required autoComplete="tel-national" inputMode="tel" pattern="\(\d{3}\) \d{3}-\d{4}" title="(XXX) XXX-XXXX" value={formData.phone} onChange={handlePhone} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="(XXX) XXX-XXXX" />
            {errors.phone && <p id={fid('phone-err')} role="alert" className="text-xs text-red-700 mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label htmlFor={fid('email')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Email', 'Correo')}</label>
            <input id={fid('email')} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? fid('email-err') : undefined} type="email" name="email" autoComplete="email" value={formData.email} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="you@example.com" />
            {errors.email && <p id={fid('email-err')} role="alert" className="text-xs text-red-700 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor={fid('zip')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('ZIP Code', 'Código Postal')} *</label>
            <input id={fid('zip')} aria-invalid={errors.zip ? true : undefined} aria-describedby={errors.zip ? fid('zip-err') : undefined} type="text" name="zip" required autoComplete="postal-code" inputMode="numeric" maxLength={5} pattern="[0-9]{5}" value={formData.zip} onChange={handleZip} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="10001" />
            {errors.zip && <p id={fid('zip-err')} role="alert" className="text-xs text-red-700 mt-1">{errors.zip}</p>}
          </div>
          <div>
            <label className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Preferred Language', 'Idioma Preferido')}</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm text-earth-700 cursor-pointer min-h-[44px]">
                <input type="radio" name="preferred_language" value="en" aria-label={t('English', 'Inglés')} checked={formData.preferred_language === 'en'} onChange={handleChange} className="accent-earth-800" />
                English
              </label>
              <label className="flex items-center gap-2 text-sm text-earth-700 cursor-pointer min-h-[44px]">
                <input type="radio" name="preferred_language" value="es" aria-label={t('Spanish', 'Español')} checked={formData.preferred_language === 'es'} onChange={handleChange} className="accent-earth-800" />
                Español
              </label>
            </div>
          </div>
          <div>
            <label htmlFor={fid('medicare_status')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Current Coverage', 'Cobertura Actual')}</label>
            <select id={fid('medicare_status')} name="medicare_status" value={formData.medicare_status} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all">
              <option value="">{t('-- Select --', '-- Seleccionar --')}</option>
              <option value="none">{t('No Medicare yet', 'Sin Medicare todavía')}</option>
              <option value="original">{t('Original Medicare (Parts A & B)', 'Medicare Original (Partes A y B)')}</option>
              <option value="advantage">{t('Medicare Advantage', 'Medicare Advantage')}</option>
              <option value="supplement">{t('Medicare Supplement (Medigap)', 'Suplemento de Medicare')}</option>
              <option value="partd">{t('Part D only', 'Solo Parte D')}</option>
              <option value="dual">{t('Dual Eligible (Medicare + Medicaid)', 'Elegible Dual (Medicare + Medicaid)')}</option>
            </select>
          </div>
          <div>
            <label htmlFor={fid('best_time_to_contact')} className="block text-sm font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Best Time to Contact', 'Mejor Hora para Contactar')}</label>
            <select id={fid('best_time_to_contact')} name="best_time_to_contact" value={formData.best_time_to_contact} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all">
              <option value="">{t('-- Select --', '-- Seleccionar --')}</option>
              <option value="morning">{t('Morning (9am–12pm ET)', 'Mañana (9am–12pm ET)')}</option>
              <option value="afternoon">{t('Afternoon (12pm–3pm ET)', 'Tarde (12pm–3pm ET)')}</option>
              <option value="evening">{t('Evening (3pm–6pm ET)', 'Noche (3pm–6pm ET)')}</option>
              <option value="anytime">{t('Anytime', 'Cualquier hora')}</option>
            </select>
          </div>

          {/* TCPA Consent — UNCHECKED BY DEFAULT (COMPLIANCE REQUIRED) */}
          <div className="bg-cream-100 rounded-lg p-3.5 border border-cream-300">
            {/* Sawil 2026-06-21 (combined audit Phase 1 #1B): the whole label is
                the tap target (input + text); min-h-[44px] guarantees WCAG 2.5.5
                target size even if the consent text is short in some locale. */}
            <label className="flex items-start gap-3 cursor-pointer min-h-[44px]">
              <input
                id={fid('tcpa_consent')}
                type="checkbox"
                name="tcpa_consent"
                required
                aria-required="true"
                aria-invalid={errors.consent ? true : undefined}
                aria-labelledby={fid('tcpa_text')}
                aria-describedby={errors.consent ? fid('consent_err') : undefined}
                checked={formData.tcpa_consent}
                onChange={handleChange}
                className="mt-0.5 w-4 h-4 accent-earth-800 flex-shrink-0"
              />
              {/* Sawil 2026-06-30 AUDIT FIX (Phase 2 consent integrity) — display the
                  EXACT canonical TCPA text that gets recorded + SHA-256 hashed, so the
                  audit receipt always matches verbatim what the user saw (EN/ES). */}
              <span id={fid('tcpa_text')} className="text-sm text-earth-700 leading-relaxed">
                {lang === 'es' ? TCPA_CONSENT_TEXT_ES : TCPA_CONSENT_TEXT_EN}{' '}
                <Link to={lp('/privacy-policy')} className="underline text-earth-800 font-semibold hover:text-gold-500">{t('See our Privacy Policy for more information.', 'Consulte nuestra Política de Privacidad para más información.')}</Link>
              </span>
            </label>
            {errors.consent && <p id={fid('consent_err')} role="alert" className="text-xs text-red-700 mt-2">{errors.consent}</p>}
          </div>

          {/* Privacy / HIPAA-style notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 leading-relaxed">
            <p className="font-semibold mb-1">
              {t('Privacy Notice', 'Aviso de Privacidad')}
            </p>
            <p>
              {t(
                'ClearPoint Senior Advisors respects your privacy. Please do not submit Social Security numbers, Medicare ID numbers, banking information, or detailed medical information through this form. Information submitted may be transmitted to our secure CRM so a licensed advisor can follow up with you.',
                'ClearPoint Senior Advisors respeta su privacidad. Por favor no envíe números de Seguro Social, números de Medicare, información bancaria, ni información médica detallada a través de este formulario. La información enviada puede transmitirse a nuestro CRM seguro para que un asesor licenciado pueda contactarle.'
              )}
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="cp-btn w-full bg-earth-800 text-cream-50 hover:bg-earth-900 transition-all hover:shadow-soft mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting
              ? t('Sending...', 'Enviando...')
              : t('Get My Free Review →', 'Obtener Mi Revisión Gratis →')
            }
          </button>
        </form>
        <p className="text-center text-sm text-earth-700 mt-3 flex items-center justify-center gap-1">
          <LockIcon className="w-3 h-3" />
          {t('We protect your information and only use it to connect you with a licensed advisor.', 'Protegemos su información y la usamos solo para conectarle con un asesor licenciado.')}
        </p>
        <p className="text-center text-sm text-earth-700 mt-1">
          {t('Reply STOP to unsubscribe. Message frequency may vary.', 'Responda STOP para cancelar. La frecuencia de mensajes puede variar.')}
        </p>
      </div>
    </div>
  );
}

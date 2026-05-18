import { useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { LockIcon, CheckIcon } from './icons';
import { Link } from 'react-router';
import { submitLeadToGHL } from '../lib/ghl';
import { validatePersonName, validatePhone, validateEmail } from '../lib/validation';
import { getZipInfo } from '../lib/zipLookup';

// Spec-required messages — Free Review form
const FREE_REVIEW_SUCCESS_EN = 'Thank you — your review request was sent successfully. A licensed Clear Point Senior Advisors advisor will review your information and contact you during business hours.';
const FREE_REVIEW_SUCCESS_ES = 'Gracias — su solicitud fue enviada correctamente. Un asesor licenciado de Clear Point Senior Advisors revisará su información y se comunicará con usted durante horas laborables.';
const FREE_REVIEW_ERROR_EN = 'We could not send your request right now. Please try again or call 1-866-310-8702.';
const FREE_REVIEW_ERROR_ES = 'No pudimos enviar su solicitud en este momento. Intente nuevamente o llame al 1-866-310-8702.';

// Fake ZIP patterns (mirrors ChatBot.tsx lead_zip handler)
const FAKE_ZIPS = new Set(['00000','11111','22222','33333','44444','55555',
  '66666','77777','88888','99999','12345','54321','11223','00001']);

interface LeadFormProps {
  variant?: 'hero-inline' | 'page-sidebar' | 'standalone';
  source?: string;
}

export function LeadForm({ variant = 'standalone', source = 'website' }: LeadFormProps) {
  const { lang, t } = useLanguage();
  const [submitted, setSubmitted] = useState(false);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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

    // ── ZIP — exact 5 digits, not fake, supported state (NY/NJ/CT/FL) ───────
    const rawDigits = formData.zip.replace(/\D/g, '');
    let zipValid = false;
    if (rawDigits.length === 5 && /^\d{5}$/.test(rawDigits) &&
        !FAKE_ZIPS.has(rawDigits) && !/^(\d)\1{4}$/.test(rawDigits)) {
      const zipInfo = getZipInfo(rawDigits);
      zipValid = zipInfo !== null && zipInfo.supported === true;
    }
    if (!zipValid) {
      newErrors.zip = lang === 'es'
        ? 'Por favor ingrese un código postal válido de 5 dígitos de NY, NJ, CT o FL.'
        : 'Please enter a valid 5-digit ZIP code from NY, NJ, CT, or FL.';
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
    if (hasError) return;

    setSubmitting(true);
    setError(false);

    const utm = getUtmParams();
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
      consent_text: 'I agree to receive marketing calls and text messages from ClearPoint Senior Advisors. Message and data rates may apply. Reply STOP to opt out.',
      lead_notes: `Source: ${source}. Status: ${formData.medicare_status || 'not specified'}.`,
      bot_transcript_summary: '',
      tags: ['Website Lead', 'Medicare Lead', 'ClearPoint Website', 'Form Lead', 'Consent Captured', formData.preferred_language === 'es' ? 'Spanish' : 'English'],
      created_at: new Date().toISOString(),
      ...utm,
    };

    const success = await submitLeadToGHL(payload);
    setSubmitting(false);
    if (success) {
      setSubmitted(true);
    } else {
      setError(true);
    }
  };

  if (submitted) {
    return (
      <div className="bg-cream-50 rounded-2xl p-7 sm:p-8 shadow-lifted text-center">
        <div className="w-14 h-14 bg-sage-200 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckIcon className="w-7 h-7 text-sage-500" />
        </div>
        <h4 className="font-serif text-lg text-earth-900 mb-2">{t('Thank You!', '¡Gracias!')}</h4>
        <p className="text-earth-600 text-sm mb-4">
          {lang === 'es' ? FREE_REVIEW_SUCCESS_ES : FREE_REVIEW_SUCCESS_EN}
        </p>
        <p className="text-earth-500 text-xs">{t('Reply STOP to unsubscribe from SMS.', 'Responda STOP para cancelar suscripción de SMS.')}</p>
      </div>
    );
  }

  return (
    <div className={`bg-cream-50 rounded-2xl shadow-lifted ${variant === 'hero-inline' ? 'p-7 sm:p-8' : 'p-6 sm:p-8'}`}>
      <div className="relative">
        <div className="absolute -top-11 left-1/2 -translate-x-1/2 bg-gold-400 text-earth-900 text-[11px] font-extrabold tracking-wider uppercase px-5 py-2 rounded-full whitespace-nowrap shadow-soft">
          {t('Free Medicare Review', 'Revisión Medicare Gratis')}
        </div>
        <h3 className="font-serif text-xl text-earth-900 text-center mt-2 mb-1">
          {t('Get Your Free Plan Review', 'Obtenga Su Revisión Gratis')}
        </h3>
        <p className="text-earth-600 text-xs text-center mb-6">
          {t('Takes 2 minutes · No pressure · 100% confidential', 'Toma 2 minutos · Sin presión · 100% confidencial')}
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-red-700 text-xs">
              {lang === 'es' ? FREE_REVIEW_ERROR_ES : FREE_REVIEW_ERROR_EN}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('First Name', 'Nombre')} *</label>
              <input type="text" name="first_name" required value={formData.first_name} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="John / Juan" />
              {errors.first_name && <p className="text-xs text-red-500 mt-1">{errors.first_name}</p>}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Last Name', 'Apellido')} *</label>
              <input type="text" name="last_name" required value={formData.last_name} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="Smith / García" />
              {errors.last_name && <p className="text-xs text-red-500 mt-1">{errors.last_name}</p>}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Phone Number', 'Teléfono')} *</label>
            <input type="tel" name="phone" required value={formData.phone} onChange={handlePhone} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="(555) 000-0000" />
            {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Email', 'Correo')}</label>
            <input type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="you@example.com" />
            {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('ZIP Code', 'Código Postal')} *</label>
            <input type="text" name="zip" required inputMode="numeric" maxLength={5} value={formData.zip} onChange={handleZip} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all" placeholder="10001" />
            {errors.zip && <p className="text-xs text-red-500 mt-1">{errors.zip}</p>}
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Preferred Language', 'Idioma Preferido')}</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm text-earth-700 cursor-pointer">
                <input type="radio" name="preferred_language" value="en" checked={formData.preferred_language === 'en'} onChange={handleChange} className="accent-earth-800" />
                English
              </label>
              <label className="flex items-center gap-2 text-sm text-earth-700 cursor-pointer">
                <input type="radio" name="preferred_language" value="es" checked={formData.preferred_language === 'es'} onChange={handleChange} className="accent-earth-800" />
                Español
              </label>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Current Coverage', 'Cobertura Actual')}</label>
            <select name="medicare_status" value={formData.medicare_status} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all">
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
            <label className="block text-[11px] font-semibold text-earth-800 mb-1.5 uppercase tracking-wide">{t('Best Time to Contact', 'Mejor Hora para Contactar')}</label>
            <select name="best_time_to_contact" value={formData.best_time_to_contact} onChange={handleChange} className="w-full px-3.5 py-2.5 bg-white border border-cream-300 rounded-lg text-sm text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all">
              <option value="">{t('-- Select --', '-- Seleccionar --')}</option>
              <option value="morning">{t('Morning (9am–12pm ET)', 'Mañana (9am–12pm ET)')}</option>
              <option value="afternoon">{t('Afternoon (12pm–3pm ET)', 'Tarde (12pm–3pm ET)')}</option>
              <option value="evening">{t('Evening (3pm–6pm ET)', 'Noche (3pm–6pm ET)')}</option>
              <option value="anytime">{t('Anytime', 'Cualquier hora')}</option>
            </select>
          </div>

          {/* TCPA Consent — UNCHECKED BY DEFAULT (COMPLIANCE REQUIRED) */}
          <div className="bg-cream-100 rounded-lg p-3.5 border border-cream-300">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="tcpa_consent"
                checked={formData.tcpa_consent}
                onChange={handleChange}
                className="mt-0.5 w-4 h-4 accent-earth-800 flex-shrink-0"
              />
              <span className="text-[11px] text-earth-700 leading-relaxed">
                {t(
                  'I agree to receive marketing calls and text messages from ClearPoint Senior Advisors at the phone number provided above. I understand that these calls may be made using an automatic telephone dialing system and that message and data rates may apply. I understand that I am not required to consent as a condition of purchasing any goods or services, and that I may revoke my consent at any time by replying STOP or calling 1-866-310-8702. Message frequency may vary. See our',
                  'Acepto recibir llamadas de marketing y mensajes de texto de ClearPoint Senior Advisors en el número de teléfono proporcionado arriba. Entiendo que estas llamadas pueden realizarse utilizando un sistema de marcado telefónico automático y que pueden aplicarse tarifas de mensajes y datos. Entiendo que no estoy obligado a consentir como condición para comprar bienes o servicios, y que puedo revocar mi consentimiento en cualquier momento respondiendo STOP o llamando al 1-866-310-8702. La frecuencia de mensajes puede variar. Consulte nuestra'
                )}{' '}
                <Link to="/privacy-policy" className="underline text-earth-800 font-semibold hover:text-gold-500">{t('Privacy Policy', 'Política de Privacidad')}</Link>{' '}
                {t('for more information.', 'para más información.')}
              </span>
            </label>
            {errors.consent && <p className="text-xs text-red-500 mt-2">{errors.consent}</p>}
          </div>

          {/* Privacy / HIPAA-style notice */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-900 leading-relaxed">
            <p className="font-semibold mb-1">
              {t('Privacy Notice', 'Aviso de Privacidad')}
            </p>
            <p>
              {t(
                'ClearPoint Senior Advisors respects your privacy. Please do not submit Social Security numbers, Medicare ID numbers, banking information, or detailed medical information through this form. Information submitted may be transmitted to our secure CRM for follow-up. Final privacy, HIPAA, TCPA, and Medicare compliance language should be reviewed by qualified legal/compliance counsel.',
                'ClearPoint Senior Advisors respeta tu privacidad. Por favor, no envíes números de Seguro Social, números de Medicare, información bancaria ni información médica detallada a través de este formulario. La información enviada puede transmitirse a nuestro CRM seguro para seguimiento. El lenguaje final de privacidad, HIPAA, TCPA y cumplimiento de Medicare debe ser revisado por un abogado o especialista de cumplimiento calificado.'
              )}
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-earth-800 text-cream-50 font-bold text-sm py-3 rounded-lg hover:bg-earth-900 transition-all hover:shadow-soft mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting
              ? t('Sending...', 'Enviando...')
              : t('Get My Free Review →', 'Obtener Mi Revisión Gratis →')
            }
          </button>
        </form>
        <p className="text-center text-[11px] text-earth-500 mt-3 flex items-center justify-center gap-1">
          <LockIcon className="w-3 h-3" />
          {t('Your information is secure and never sold.', 'Su información es segura y nunca se vende.')}
        </p>
        <p className="text-center text-[10px] text-earth-400 mt-1">
          {t('Reply STOP to unsubscribe. Message frequency may vary.', 'Responda STOP para cancelar. La frecuencia de mensajes puede variar.')}
        </p>
      </div>
    </div>
  );
}

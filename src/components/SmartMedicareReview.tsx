import { useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { getZipInfo } from '../lib/zipLookup';
import { validateDOB, validatePhone, validateEmail } from '../lib/validation';
import { CheckIcon, ChevronRight } from './icons';

const TOTAL_STEPS = 6;

const concernsEN = [
  'Lower my Medicare costs',
  'Check Medicaid / MSP / Extra Help',
  'Check my doctors',
  'Check my medications',
  'Compare Medicare Advantage plans',
  'Understand Medicare Supplement / Medigap',
  'I am new to Medicare',
  'I am not sure',
];

const concernsES = [
  'Reducir mis costos de Medicare',
  'Revisar Medicaid / MSP / Extra Help',
  'Revisar mis doctores',
  'Revisar mis medicamentos',
  'Comparar planes Medicare Advantage',
  'Entender Medicare Supplement / Medigap',
  'Soy nuevo en Medicare',
  'No estoy seguro',
];

export function SmartMedicareReview() {
  const { t, lang } = useLanguage();
  const [step, setStep] = useState(1);
  const [concern, setConcern] = useState('');
  const [zip, setZip] = useState('');
  const [zipInfo, setZipInfo] = useState<ReturnType<typeof getZipInfo>>(null);
  const [dob, setDob] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [prefLang, setPrefLang] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const concerns = lang === 'es' ? concernsES : concernsEN;
  const isEs = lang === 'es';

  const handleZip = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 5);
    setZip(clean);
    if (clean.length === 5) {
      const info = getZipInfo(clean);
      setZipInfo(info);
    } else {
      setZipInfo(null);
    }
  };

  const handlePhone = (val: string) => {
    setPhone(val.replace(/\D/g, '').slice(0, 10));
  };

  const canAdvanceStep = (): boolean => {
    switch (step) {
      case 1: return !!concern;
      case 2: return zip.length === 5 && !!zipInfo;
      case 3: return validateDOB(dob).valid;
      case 4: return !!firstName && !!lastName && validatePhone(phone).valid;
      case 5: return !!prefLang;
      default: return true;
    }
  };

  const nextStep = () => {
    if (canAdvanceStep()) setStep((s) => Math.min(s + 1, TOTAL_STEPS + 1));
  };

  const stepLabel = (s: number) => isEs ? `Paso ${s} de ${TOTAL_STEPS}` : `Step ${s} of ${TOTAL_STEPS}`;

  const handleSubmit = async () => {
    if (!consent) { setError(isEs ? 'Debe aceptar el consentimiento.' : 'You must accept the consent.'); return; }
    setError('');
    setSubmitting(true);

    const age = validateDOB(dob).age ?? 0;
    const phoneValid = validatePhone(phone);
    const flags: string[] = [];
    if (age < 65) flags.push('Under 65 — verify Medicare eligibility');
    if (zipInfo && !zipInfo.supported) flags.push('ZIP outside supported service states');
    if (!email) flags.push('Email not provided');

    const payload = {
      source: 'Clear Point Senior Advisors Website',
      page_url: typeof window !== 'undefined' ? window.location.href : '',
      form_name: 'Smart Medicare Review',
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim(),
      phone: phoneValid.cleaned,
      email: email,
      date_of_birth: dob,
      calculated_age: age,
      zip_code: zip,
      city: zipInfo?.city || '',
      county: zipInfo?.county || '',
      derived_state: zipInfo?.stateCode || '',
      preferred_language: prefLang === 'es' || prefLang === 'Español' ? 'Spanish' : prefLang === 'either' || prefLang === 'Cualquiera' ? 'Either' : 'English',
      medicare_status: '',
      interest_type: concern,
      best_time_to_contact: '',
      consent_to_contact: true,
      consent_text: 'I agree to be contacted by Clear Point Senior Advisors.',
      lead_notes: buildSummary(),
      lead_quality_flags: flags.join('; '),
      bot_transcript_summary: '',
      tags: ['Smart Review Lead', 'Medicare Lead', lang === 'es' ? 'Spanish' : 'English'],
      created_at: new Date().toISOString(),
    };

    const success = await submitLeadToGHL(payload);
    setSubmitting(false);
    if (success) {
      setSubmitted(true);
      setStep(TOTAL_STEPS + 1);
    } else {
      setError(isEs ? 'Error al enviar. Intente de nuevo o llámenos.' : 'Submission failed. Please try again or call us.');
    }
  };

  const buildSummary = () => {
    const age = validateDOB(dob).age ?? 0;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    return [
      'Smart Medicare Review Summary:',
      '',
      `Lead Source: Clear Point Senior Advisors Website — Smart Medicare Review`,
      `Conversation Date/Time: ${now}`,
      '',
      'Client Information:',
      `- Name: ${firstName} ${lastName}`,
      `- Phone: ${phone}`,
      `- Email: ${email || 'Not provided'}`,
      `- Date of Birth: ${dob}`,
      `- Calculated Age: ${age}`,
      `- ZIP Code: ${zip}`,
      `- City: ${zipInfo?.city || 'N/A'}`,
      `- County: ${zipInfo?.county || 'N/A'}`,
      `- State: ${zipInfo?.state || 'N/A'}`,
      `- Preferred Language: ${prefLang}`,
      `- Consent to contact: Yes`,
      '',
      `Client Main Concern: ${concern}`,
      '',
      'Recommended Agent Follow-Up:',
      'Verify Medicare status, current coverage, doctors, medications, income/household status if asking about Medicaid, MSP, Extra Help/LIS, and any plan review request.',
    ].join('\n');
  };

  if (submitted) {
    return (
      <section id="smart-medicare-review" className="py-20 lg:py-28 bg-cream-50 scroll-mt-28">
        <div className="max-w-2xl mx-auto px-5 text-center">
          <div className="w-16 h-16 bg-sage-200 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckIcon className="w-8 h-8 text-sage-500" />
          </div>
          <h2 className="font-serif text-2xl text-earth-900 mb-3">{t('Thank You!', '¡Gracias!')}</h2>
          <p className="text-earth-600 text-base">
            {t('Your request was received. A licensed Medicare advisor will contact you during business hours.', 'Su solicitud fue recibida. Un asesor licenciado de Medicare le contactará durante horas laborables.')}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="smart-medicare-review" className="py-20 lg:py-28 bg-cream-50 scroll-mt-28">
      <div className="max-w-2xl mx-auto px-5">
        {/* Header */}
        <div className="text-center mb-10">
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-3 block">
            {t('Smart Medicare Review', 'Revisión Inteligente de Medicare')}
          </span>
          <h2 className="font-serif text-3xl sm:text-4xl font-normal text-earth-900 mb-3">
            {t('Start Your Smart Medicare Review', 'Comience Su Revisión Inteligente de Medicare')}
          </h2>
          <p className="text-earth-600 text-sm max-w-xl mx-auto">
            {t(
              'Answer a few simple questions so a licensed advisor can better understand what you may need before contacting you.',
              'Responda unas preguntas sencillas para que un asesor licenciado pueda entender mejor lo que necesita antes de contactarle.'
            )}
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5 mb-8">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i < step ? 'bg-gold-400 w-8' : i === step - 1 ? 'bg-gold-400 w-6' : 'bg-cream-300 w-6'
              }`}
            />
          ))}
          <span className="text-xs text-earth-500 ml-3">{stepLabel(step)}</span>
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-2xl shadow-lifted p-6 sm:p-8 border border-cream-200">
          {/* Step 1 — Main Concern */}
          {step === 1 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-5">
                {t('What would you like help with today?', '¿Con qué le gustaría recibir ayuda hoy?')}
              </p>
              <div className="grid gap-2.5">
                {concerns.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setConcern(c); nextStep(); }}
                    className={`w-full text-left px-4 py-4 rounded-xl border-2 text-base font-medium transition-all ${
                      concern === c
                        ? 'border-gold-400 bg-gold-50 text-earth-900'
                        : 'border-cream-200 hover:border-gold-300 hover:bg-cream-50 text-earth-700'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — ZIP */}
          {step === 2 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-2">
                {t('What is your ZIP Code?', '¿Cuál es su código postal?')}
              </p>
              <input
                type="text"
                value={zip}
                onChange={(e) => handleZip(e.target.value)}
                placeholder="10001"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="postal-code"
                maxLength={5}
                className="w-full px-4 py-4 sm:py-3.5 bg-cream-50 border border-cream-300 rounded-xl text-lg text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all"
              />
              {zipInfo && (
                <p className="text-sm text-sage-600 mt-3 font-medium">
                  {isEs
                    ? `Ubicación detectada: ${zipInfo.city}, ${zipInfo.county}, ${zipInfo.state}`
                    : `Location detected: ${zipInfo.city}, ${zipInfo.county}, ${zipInfo.state}`}
                </p>
              )}
              {zip.length === 5 && !zipInfo && (
                <p className="text-sm text-red-500 mt-3">{t('Please enter a valid 5-digit ZIP code from NY, NJ, CT, or FL.', 'Por favor ingrese un código postal válido de 5 dígitos de NY, NJ, CT o FL.')}</p>
              )}
              <button
                onClick={nextStep}
                disabled={!canAdvanceStep()}
                className="mt-5 w-full bg-earth-800 text-cream-50 font-semibold px-5 py-4 sm:py-3.5 rounded-xl hover:bg-earth-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {t('Continue', 'Continuar')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 3 — DOB */}
          {step === 3 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-2">
                {t('What is your date of birth?', '¿Cuál es su fecha de nacimiento?')}
              </p>
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                min="1906-01-01"
                className="w-full px-4 py-4 sm:py-3.5 bg-cream-50 border border-cream-300 rounded-xl text-lg text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all"
              />
              {dob && validateDOB(dob).age !== null && (
                <p className="text-sm text-earth-500 mt-2">
                  {isEs ? `Edad calculada: ${validateDOB(dob).age} años` : `Calculated age: ${validateDOB(dob).age}`}
                </p>
              )}
              {dob && !validateDOB(dob).valid && (
                <p className="text-sm text-red-500 mt-2">{t('Please enter a valid date of birth.', 'Por favor ingrese una fecha de nacimiento válida.')}</p>
              )}
              <button onClick={nextStep} disabled={!canAdvanceStep()} className="mt-5 w-full bg-earth-800 text-cream-50 font-semibold px-5 py-4 sm:py-3.5 rounded-xl hover:bg-earth-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {t('Continue', 'Continuar')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 4 — Contact Info */}
          {step === 4 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-4">
                {t('Your contact information', 'Su información de contacto')}
              </p>
              <div className="space-y-3.5">
                <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t('First Name', 'Nombre') + ' *'} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('Last Name', 'Apellido') + ' *'} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                <input type="tel" value={phone} onChange={(e) => handlePhone(e.target.value)} placeholder={t('Phone Number', 'Teléfono') + ' *'} inputMode="numeric" pattern="[0-9]*" autoComplete="tel" maxLength={10} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {phone.length > 0 && phone.length < 10 && <p className="text-xs text-red-500">{t('Must be 10 digits.', 'Debe tener 10 dígitos.')}</p>}
                {phone.length === 10 && !validatePhone(phone).valid && <p className="text-xs text-red-500">{t('Please enter a valid phone number.', 'Por favor ingrese un número válido.')}</p>}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('Email (optional)', 'Correo (opcional)')} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {email && !validateEmail(email).valid && <p className="text-xs text-red-500">{t('Please enter a valid email or leave blank.', 'Ingrese un correo válido o déjelo en blanco.')}</p>}
              </div>
              <button onClick={nextStep} disabled={!canAdvanceStep()} className="mt-5 w-full bg-earth-800 text-cream-50 font-semibold px-5 py-4 sm:py-3.5 rounded-xl hover:bg-earth-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {t('Continue', 'Continuar')} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 5 — Language */}
          {step === 5 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-5">
                {t('What language do you prefer?', '¿Qué idioma prefiere?')}
              </p>
              <div className="space-y-2.5">
                {['English', 'Español', t('Either', 'Cualquiera')].map((l) => (
                  <button
                    key={l}
                    onClick={() => { setPrefLang(l); nextStep(); }}
                    className={`w-full text-left px-4 py-4 rounded-xl border-2 text-base font-medium transition-all ${
                      prefLang === l
                        ? 'border-gold-400 bg-gold-50 text-earth-900'
                        : 'border-cream-200 hover:border-gold-300 hover:bg-cream-50 text-earth-700'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 6 — Consent + Submit */}
          {step === 6 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-4">
                {t('Review & Submit', 'Revisar y Enviar')}
              </p>

              {/* Summary */}
              <div className="bg-cream-50 rounded-xl p-4 text-base text-earth-700 space-y-1.5 mb-5">
                <p><strong>{t('Concern:', 'Interés:')}</strong> {concern}</p>
                <p><strong>ZIP:</strong> {zip} — {zipInfo?.city}, {zipInfo?.county}, {zipInfo?.state}</p>
                <p><strong>{t('DOB:', 'Fecha Nac.:')}</strong> {dob} ({t('Age:', 'Edad:')} {validateDOB(dob).age})</p>
                <p><strong>{t('Name:', 'Nombre:')}</strong> {firstName} {lastName}</p>
                <p><strong>{t('Phone:', 'Tel.:')}</strong> {phone}</p>
                {email && <p><strong>Email:</strong> {email}</p>}
                <p><strong>{t('Language:', 'Idioma:')}</strong> {prefLang}</p>
              </div>

              {/* Consent */}
              <label className="flex items-start gap-3 cursor-pointer bg-cream-100 rounded-xl p-4 border border-cream-300 mb-4">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-5 h-5 accent-earth-800 flex-shrink-0" />
                <span className="text-sm text-earth-700 leading-relaxed">
                  {t(
                    'By providing my phone number, I agree that Clear Point Senior Advisors may contact me by phone call or text message about Medicare plan review options. Consent is not required to use our services. Message and data rates may apply. I can opt out at any time.',
                    'Al proporcionar mi número de teléfono, acepto que Clear Point Senior Advisors pueda contactarme por llamada o mensaje de texto sobre opciones de revisión de planes de Medicare. El consentimiento no es requerido para usar nuestros servicios. Pueden aplicar cargos por mensajes y datos. Puedo cancelar en cualquier momento.'
                  )}
                </span>
              </label>

              {/* Disclaimer */}
              <p className="text-xs text-earth-500 mb-4 leading-relaxed">
                {t(
                  'This is an educational review request. Clear Point Senior Advisors is not Medicare, Medicaid, Social Security, or a government agency. A licensed advisor may contact you to review your options. Do not enter your Social Security number, Medicare ID, banking information, or sensitive medical records.',
                  'Esta es una solicitud educativa de revisión. Clear Point Senior Advisors no es Medicare, Medicaid, Seguro Social ni una agencia del gobierno. Un asesor licenciado puede contactarle para revisar sus opciones. No ingrese su número de Seguro Social, número de Medicare, información bancaria ni expedientes médicos sensibles.'
                )}
              </p>

              {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!consent || submitting}
                className="w-full bg-earth-800 text-cream-50 font-bold px-5 py-3.5 rounded-xl hover:bg-earth-900 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
              >
                {submitting
                  ? t('Submitting...', 'Enviando...')
                  : t('Request My Free Review', 'Solicitar Mi Revisión Gratis')}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

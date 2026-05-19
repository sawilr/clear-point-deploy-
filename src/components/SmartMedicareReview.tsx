import { useState } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { getZipInfo } from '../lib/zipLookup';
import { validateDOB, validatePhone, validateEmail, validatePersonName } from '../lib/validation';
import { CheckIcon, ChevronRight } from './icons';

const TOTAL_STEPS = 6;

// Same fake-ZIP set as ChatBot.tsx and LeadForm.tsx — rejects obviously invalid entries.
const FAKE_ZIPS = new Set(['00000','11111','22222','33333','44444','55555','66666','77777','88888','99999','12345','54321','11223','00001']);

const SSDI_CONCERN_EN = 'I have disability, SSI, SSDI, or need help with Medicare premiums';
const SSDI_CONCERN_ES = 'Tengo discapacidad, SSI, SSDI o necesito ayuda con primas de Medicare';

const ssdiQuestionsEN = [
  { key: 'age',         q: 'Are you currently 65 or older?',                                                              opts: ['Yes', 'No', 'Turning 65 soon'] },
  { key: 'medicare',    q: 'Do you currently have Medicare?',                                                              opts: ['Yes, I have Medicare', 'No, I do not have Medicare yet', 'I am not sure'] },
  { key: 'benefits',    q: 'Do you receive SSI, SSDI, Medicaid, or disability-related benefits?',                         opts: ['SSI', 'SSDI', 'Medicaid', 'Disability benefits', 'Not sure', 'None of these'] },
  { key: 'ssdiApproved',q: 'Have you been approved for Social Security Disability Insurance (SSDI)?',                     opts: ['Yes', 'No', 'Not sure'] },
  { key: 'quarters',    q: 'Do you or your spouse have about 40 work quarters / 10 years of Medicare-covered work?',      opts: ['Yes', 'No', 'Not sure'] },
  { key: 'needsHelp',   q: 'What do you need help understanding?',                                                        opts: ['When Medicare may start', 'Help paying Part A or Part B', 'Medicaid / MSP / Extra Help', 'Disability and Medicare rules', 'Speak with an advisor'] },
];
const ssdiQuestionsES = [
  { key: 'age',         q: '¿Tiene 65 años o más?',                                                                      opts: ['Sí', 'No', 'Cumplo 65 pronto'] },
  { key: 'medicare',    q: '¿Actualmente tiene Medicare?',                                                                opts: ['Sí, tengo Medicare', 'No, todavía no tengo Medicare', 'No estoy seguro'] },
  { key: 'benefits',    q: '¿Recibe SSI, SSDI, Medicaid o beneficios relacionados con discapacidad?',                    opts: ['SSI', 'SSDI', 'Medicaid', 'Beneficios por discapacidad', 'No estoy seguro', 'Ninguno'] },
  { key: 'ssdiApproved',q: '¿Fue aprobado para Social Security Disability Insurance (SSDI)?',                            opts: ['Sí', 'No', 'No estoy seguro'] },
  { key: 'quarters',    q: '¿Usted o su cónyuge tienen aproximadamente 40 quarters / 10 años de trabajo cubierto?',      opts: ['Sí', 'No', 'No estoy seguro'] },
  { key: 'needsHelp',   q: '¿Qué necesita entender?',                                                                   opts: ['Cuándo puede comenzar Medicare', 'Ayuda pagando Parte A o Parte B', 'Medicaid / MSP / Extra Help', 'Reglas de discapacidad y Medicare', 'Hablar con un asesor'] },
];

const concernsEN = [
  'I want to lower my Medicare costs',
  'I may need Medicaid, Medicare Savings Program, or Extra Help',
  'I have Medicare Advantage and want to review my plan',
  'I have Medicare Supplement / Medigap',
  'I am new to Medicare',
  'I am not insured or not sure what I have',
  'I have disability, SSI, SSDI, or need help with Medicare premiums',
  'I have retiree, union, federal, state, VA, or TRICARE coverage that may affect Medicare',
  'I am not sure',
];

const concernsES = [
  'Quiero reducir mis costos de Medicare',
  'Puede que necesite Medicaid, Programa de Ahorro de Medicare o Extra Help',
  'Tengo Medicare Advantage y quiero revisar mi plan',
  'Tengo Medicare Supplement / Medigap',
  'Soy nuevo en Medicare',
  'No tengo seguro o no estoy seguro de lo que tengo',
  'Tengo discapacidad, SSI, SSDI o necesito ayuda con primas de Medicare',
  'Tengo cobertura de retiro, unión, federal, estatal, VA o TRICARE que puede afectar Medicare',
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
  const [ssdiSubStep, setSsdiSubStep] = useState(0);
  const [ssdiAnswers, setSsdiAnswers] = useState<Record<string, string>>({});

  const concerns = lang === 'es' ? concernsES : concernsEN;
  const isEs = lang === 'es';
  const ssdiQuestions = isEs ? ssdiQuestionsES : ssdiQuestionsEN;
  const isSSdiConcern = concern === SSDI_CONCERN_EN || concern === SSDI_CONCERN_ES;
  const currentSsdiQ = (isSSdiConcern && ssdiSubStep >= 1 && ssdiSubStep <= 6)
    ? ssdiQuestions[ssdiSubStep - 1]
    : null;

  const handleZip = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 5);
    setZip(clean);
    if (clean.length === 5) {
      // Reject fake/sequential ZIPs (same check as ChatBot.tsx and LeadForm.tsx)
      if (FAKE_ZIPS.has(clean) || /^(\d)\1{4}$/.test(clean)) {
        setZipInfo(null);
        return;
      }
      const info = getZipInfo(clean);
      setZipInfo(info);
    } else {
      setZipInfo(null);
    }
  };

  const handlePhone = (val: string) => {
    const digits = val.replace(/\D/g, '');
    // Strip US country code prefix if 11 digits starting with 1 (e.g. +1 718 285 3366)
    const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
    setPhone(national.slice(0, 10));
  };

  // DOB input mask — auto-inserts slashes for MM/DD/YYYY format (Task #120).
  // Strips non-numeric, keeps up to 8 digits, inserts separators on the fly.
  // validateDOB() accepts MM/DD/YYYY via new Date(), so no downstream changes needed.
  const handleDob = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 8);
    let masked = digits;
    if (digits.length > 4) {
      masked = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
    } else if (digits.length > 2) {
      masked = digits.slice(0, 2) + '/' + digits.slice(2);
    }
    setDob(masked);
  };

  const canAdvanceStep = (): boolean => {
    switch (step) {
      case 1: return !!concern;
      case 2: return zip.length === 5 && !!zipInfo;
      case 3: return validateDOB(dob).valid;
      case 4: return validatePersonName(firstName).valid && validatePersonName(lastName).valid && validatePhone(phone).valid;
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
      ...(Object.keys(ssdiAnswers).length > 0 ? [
        '',
        'Disability / SSI / SSDI Screening Answers:',
        ...Object.entries(ssdiAnswers).map(([k, v]) => `- ${k}: ${v}`),
      ] : []),
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
          {/* Back button — hidden on Step 1 */}
          {step > 1 && (
            <button
              onClick={() => setStep(s => Math.max(s - 1, 1))}
              className="inline-flex items-center gap-2 text-sm text-earth-500 hover:text-earth-800 transition-colors mb-5 py-1 pr-3"
              aria-label={isEs ? 'Volver al paso anterior' : 'Go back to previous step'}
            >
              <span aria-hidden="true" className="text-base leading-none">←</span>
              <span>{isEs ? 'Atrás' : 'Back'}</span>
            </button>
          )}
          {/* Step 1 — Main Concern */}
          {step === 1 && ssdiSubStep === 0 && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-5">
                {t('What Medicare situation best matches you today?', '¿Cuál situación de Medicare describe mejor su caso hoy?')}
              </p>
              <div className="grid gap-2.5">
                {concerns.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setConcern(c);
                      setSsdiAnswers({});
                      const isSSdi = c === SSDI_CONCERN_EN || c === SSDI_CONCERN_ES;
                      if (isSSdi) { setSsdiSubStep(1); } else { setSsdiSubStep(0); setStep(s => Math.min(s + 1, TOTAL_STEPS + 1)); }
                    }}
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

          {/* SSDI/SSI Screening Sub-steps */}
          {step === 1 && currentSsdiQ && (
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-gold-500 mb-3">
                {isEs ? `Pregunta ${ssdiSubStep} de 6` : `Question ${ssdiSubStep} of 6`}
              </p>
              <p className="text-earth-800 text-base font-semibold mb-5">{currentSsdiQ.q}</p>
              <div className="grid gap-2.5">
                {currentSsdiQ.opts.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setSsdiAnswers(prev => ({ ...prev, [currentSsdiQ.key]: opt }));
                      setSsdiSubStep(s => s + 1);
                    }}
                    className="w-full text-left px-4 py-4 rounded-xl border-2 border-cream-200 hover:border-gold-300 hover:bg-cream-50 text-earth-700 text-base font-medium transition-all"
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setSsdiSubStep(s => s === 1 ? 0 : s - 1); }}
                className="mt-4 text-sm text-earth-500 underline underline-offset-2 hover:text-earth-700"
              >
                {isEs ? '← Atrás' : '← Back'}
              </button>
            </div>
          )}

          {/* SSDI/SSI Educational Summary */}
          {step === 1 && isSSdiConcern && ssdiSubStep === 7 && (
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-gold-500 mb-3">
                {isEs ? 'Información educativa' : 'Educational Information'}
              </p>
              <div className="bg-cream-50 rounded-xl p-4 text-sm text-earth-700 space-y-3 mb-5 leading-relaxed">
                {isEs ? (
                  <>
                    <p>Las reglas de Medicare pueden ser diferentes para personas que reciben SSI, SSDI, Medicaid o beneficios relacionados con discapacidad. <strong>SSI por sí solo no significa automáticamente que la persona tenga Medicare.</strong> Personas menores de 65 años pueden recibir Medicare si califican por SSDI después del período requerido, o por situaciones especiales como ALS o ESRD.</p>
                    <p>Para Medicare Parte A, muchas personas no pagan prima si ellos o su cónyuge tienen aproximadamente 40 quarters, normalmente unos 10 años de trabajo cubierto por Medicare. Si alguien no tiene Parte A sin prima, todavía podría comprar Parte A.</p>
                    <p>En algunos casos, si los ingresos y recursos son limitados, un Medicare Savings Program del estado, como QMB, puede ayudar a pagar Parte A y/o Parte B.</p>
                    <p className="text-xs text-earth-500 italic">Clear Point puede ayudarle a organizar las preguntas correctas, pero la elegibilidad final debe confirmarse con Social Security, Medicare, Medicaid o la agencia estatal.</p>
                  </>
                ) : (
                  <>
                    <p>Medicare rules can be different for people who receive SSI, SSDI, Medicaid, or disability-related benefits. <strong>SSI by itself does not automatically mean a person has Medicare.</strong> People under 65 may get Medicare if they qualify through SSDI after the required waiting period, or through special situations such as ALS or ESRD.</p>
                    <p>For Medicare Part A, many people do not pay a premium if they or a spouse have about 40 work quarters, usually around 10 years of Medicare-covered work. If someone does not have premium-free Part A, they may still be able to buy Part A.</p>
                    <p>In some cases, if income and resources are limited, a state Medicare Savings Program such as QMB may help pay Part A and/or Part B.</p>
                    <p className="text-xs text-earth-500 italic">Clear Point can help organize the right questions, but final eligibility must be confirmed with Social Security, Medicare, Medicaid, or the state agency.</p>
                  </>
                )}
              </div>
              <div className="space-y-2.5">
                <button
                  onClick={() => nextStep()}
                  className="w-full bg-earth-800 text-cream-50 font-semibold px-5 py-4 rounded-xl hover:bg-earth-900 transition-all flex items-center justify-center gap-2"
                >
                  {isEs ? 'Continuar — Solicitar revisión gratuita' : 'Continue — Request my free review'} <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => { setConcern(''); setSsdiSubStep(0); setSsdiAnswers({}); }}
                  className="w-full text-sm text-earth-500 underline underline-offset-2 hover:text-earth-700 py-2"
                >
                  {isEs ? 'Volver a temas' : 'Back to topics'}
                </button>
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
                aria-describedby={zip.length === 5 && !zipInfo ? 'zip-error' : undefined}
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
                <p id="zip-error" role="alert" className="text-sm text-red-500 mt-3">{t('Please enter a valid 5-digit ZIP code from NY, NJ, CT, or FL.', 'Por favor ingrese un código postal válido de 5 dígitos de NY, NJ, CT o FL.')}</p>
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
                type="text"
                value={dob}
                onChange={(e) => handleDob(e.target.value)}
                placeholder="MM/DD/YYYY"
                inputMode="numeric"
                maxLength={10}
                autoComplete="bday"
                aria-label={isEs ? 'Fecha de nacimiento MM/DD/AAAA' : 'Date of birth MM/DD/YYYY'}
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
                {firstName.length > 1 && !validatePersonName(firstName).valid && <p className="text-xs text-red-500">{t('Please enter a valid name without numbers, symbols, or inappropriate words.', 'Por favor ingrese un nombre válido sin números, símbolos ni palabras inapropiadas.')}</p>}
                <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('Last Name', 'Apellido') + ' *'} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {lastName.length > 1 && !validatePersonName(lastName).valid && <p className="text-xs text-red-500">{t('Please enter a valid name without numbers, symbols, or inappropriate words.', 'Por favor ingrese un nombre válido sin números, símbolos ni palabras inapropiadas.')}</p>}
                <input type="tel" value={phone} onChange={(e) => handlePhone(e.target.value)} placeholder={t('Phone Number', 'Teléfono') + ' *'} inputMode="numeric" pattern="[0-9]*" autoComplete="tel" maxLength={10} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {phone.length > 0 && phone.length < 10 && <p className="text-xs text-red-500">{t('Must be 10 digits.', 'Debe tener 10 dígitos.')}</p>}
                {phone.length === 10 && !validatePhone(phone).valid && <p className="text-xs text-red-500">{t('Please enter a valid 10-digit U.S. phone number.', 'Por favor ingrese un número de teléfono válido de Estados Unidos de 10 dígitos.')}</p>}
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('Email (optional)', 'Correo (opcional)')} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {email && !validateEmail(email).valid && <p className="text-xs text-red-500">{t('Please enter a valid email address, or leave it blank if you prefer.', 'Por favor ingrese un correo electrónico válido, o déjelo en blanco si prefiere.')}</p>}
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
                    onClick={() => { setPrefLang(l); setStep(s => Math.min(s + 1, TOTAL_STEPS + 1)); }}
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

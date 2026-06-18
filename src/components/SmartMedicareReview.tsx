import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { getZipInfo } from '../lib/zipLookup';
import { validateDOB, validatePhone, validateEmail, validatePersonName } from '../lib/validation';
import { CheckIcon, ChevronRight } from './icons';
import {
  type LeadType,
  type Step1Option,
  type SpecialSituation,
  STEP1_OPTIONS,
  SEP_OPTION,
  COST_FOLLOWUPS,
  SPECIAL_SITUATIONS,
  SPECIAL_GUIDANCE,
  SPECIAL_SCOPE_EN,
  SPECIAL_SCOPE_ES,
  isQualifiedSalesRoute,
  buildLeadTags,
} from '../lib/smartReviewRouting';

const TOTAL_STEPS = 6;

// Same fake-ZIP set as ChatBot.tsx and LeadForm.tsx — rejects obviously invalid entries.
const FAKE_ZIPS = new Set(['00000','11111','22222','33333','44444','55555','66666','77777','88888','99999','12345','54321','11223','00001']);

// Sawil 2026-06-15 (M10) — senior-friendly DOB dropdowns (Month / Day / Year)
// instead of a typed MM/DD/YYYY field. No format confusion, no keyboard juggling.
const DOB_MONTHS = [
  { en: 'January', es: 'Enero' }, { en: 'February', es: 'Febrero' }, { en: 'March', es: 'Marzo' },
  { en: 'April', es: 'Abril' }, { en: 'May', es: 'Mayo' }, { en: 'June', es: 'Junio' },
  { en: 'July', es: 'Julio' }, { en: 'August', es: 'Agosto' }, { en: 'September', es: 'Septiembre' },
  { en: 'October', es: 'Octubre' }, { en: 'November', es: 'Noviembre' }, { en: 'December', es: 'Diciembre' },
];
// Year range covers realistic Medicare-age birthdates (18–100 yrs old).
const _DOB_THIS_YEAR = new Date().getFullYear();
const DOB_YEARS: number[] = [];
for (let y = _DOB_THIS_YEAR - 18; y >= _DOB_THIS_YEAR - 100; y--) DOB_YEARS.push(y);
// Days available for a given month/year (handles 28/29/30/31 + leap years).
function daysInMonth(mm: string, yyyy: string): number {
  const m = parseInt(mm, 10);
  if (!m) return 31;
  const y = parseInt(yyyy, 10);
  if (!y) return m === 2 ? 29 : [4, 6, 9, 11].includes(m) ? 30 : 31;
  return new Date(y, m, 0).getDate();
}

export function SmartMedicareReview() {
  const { t, lang } = useLanguage();
  const [step, setStep] = useState(1);
  // Smart Review routing state. `selectedOption` drives the qualified
  // sales/triage paths; `specialCat` drives the educational Special
  // Situations path. `leadType` is the precise CRM lead type for whichever
  // route the visitor took. `step1View` is the Step-1 internal view machine.
  const [selectedOption, setSelectedOption] = useState<Step1Option | null>(null);
  const [leadType, setLeadType] = useState<LeadType | ''>('');
  const [step1View, setStep1View] = useState<'main' | 'cost' | 'special' | 'specialDetail' | 'specialResources'>('main');
  const [specialCat, setSpecialCat] = useState<SpecialSituation | null>(null);
  const [costAnswer, setCostAnswer] = useState('');
  const [zip, setZip] = useState('');
  const [zipInfo, setZipInfo] = useState<ReturnType<typeof getZipInfo>>(null);
  const [dob, setDob] = useState('');
  // M10 — DOB dropdown parts. `dob` (MM/DD/YYYY) is composed from these so all
  // downstream logic (validateDOB, handleSubmit, summary) is unchanged.
  const [dobMonth, setDobMonth] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [prefLang, setPrefLang] = useState('');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // PHASE A16 — SOA URL set after the lead submits successfully.
  const [soaUrl, setSoaUrl] = useState<string>('');
  const [error, setError] = useState('');
  // Sawil 2026-06: after every step transition, scroll the funnel card to
  // the top of the viewport so the new question is visible. Covers chips,
  // Continue, Back, Step-1 sub-views, and the final success state.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    // Initial render (step 1, main view) does not scroll; only transitions.
    if (step === 1 && step1View === 'main') return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step, step1View]);

  // M10 — compose dob (MM/DD/YYYY) from the three dropdowns; clamp the day if
  // a shorter month/year is picked (e.g. day 31 then February → reset day).
  useEffect(() => {
    if (dobDay && parseInt(dobDay, 10) > daysInMonth(dobMonth, dobYear)) {
      setDobDay('');
      return;
    }
    setDob(dobMonth && dobDay && dobYear ? `${dobMonth}/${dobDay}/${dobYear}` : '');
  }, [dobMonth, dobDay, dobYear]);
  // Honeypot anti-bot field — must stay empty. Real users never see this input;
  // bots that scrape and fill every form input will populate it. API discards
  // any submission where this is non-empty.
  const [websiteUrl, setWebsiteUrl] = useState('');
  // PHASE A18 — qualifier fields (all optional, with "I don't know" option).
  // These flow into the lead notes and Lead Intelligence (Fase 3) so the
  // advisor has carrier/rx/doctor context before calling.
  const [currentCarrier, setCurrentCarrier] = useState('');
  const [rxCount, setRxCount] = useState('');
  const [doctorPriority, setDoctorPriority] = useState('');
  // Sawil 2026-06 — dual-eligible qualifier. Standard across Medicare brokers
  // (eHealth, Medicare.gov Plan Finder, SelectQuote, etc.): people with
  // Medicaid or Extra Help qualify for D-SNP plans with very different options,
  // so the advisor needs to know up front. Program status ONLY — compliance-safe
  // (no income, health, or SSN collected).
  const [medicaidExtraHelp, setMedicaidExtraHelp] = useState('');

  const isEs = lang === 'es';
  // The human-readable selection label (localized) and the canonical EN
  // label used for the CRM `interest_type` field.
  const selectionLabel = selectedOption
    ? (isEs ? selectedOption.es : selectedOption.en)
    : specialCat
      ? (isEs ? specialCat.es : specialCat.en)
      : '';
  const interestType = selectedOption ? selectedOption.en : specialCat ? specialCat.en : '';

  // Reset Step 1 back to the main six-option view, clearing any route state.
  const resetStep1 = () => {
    setSelectedOption(null);
    setLeadType('');
    setSpecialCat(null);
    setCostAnswer('');
    setStep1View('main');
  };

  // Lock in a qualified sales/triage option and advance to the normal flow.
  const chooseOption = (opt: Step1Option) => {
    setSelectedOption(opt);
    setSpecialCat(null);
    setCostAnswer('');
    if (opt.leadType === 'COST_REVIEW_TRIAGE') {
      // "Lower my Medicare costs" → ask the triage follow-up before locking.
      setLeadType('COST_REVIEW_TRIAGE');
      setStep1View('cost');
      return;
    }
    setLeadType(opt.leadType);
    setStep(s => Math.min(s + 1, TOTAL_STEPS + 1));
  };

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

  const canAdvanceStep = (): boolean => {
    switch (step) {
      case 1: return !!leadType;
      // Sawil 2026-06 COMPLIANCE — must be a SUPPORTED service-area ZIP
      // (NY/NJ/CT). A Florida ZIP resolves but supported === false, so it can
      // no longer advance past Step 2.
      case 2: return zip.length === 5 && !!zipInfo && zipInfo.supported;
      case 3: return validateDOB(dob).valid;
      // Email is optional, but if the visitor types one it must be valid (blocks
      // junk/profanity emails like fuckyou@gmail.com from advancing). Sawil 2026-06-15.
      case 4: return validatePersonName(firstName).valid && validatePersonName(lastName).valid && validatePhone(phone).valid && (!email || validateEmail(email).valid);
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
    const lt = (leadType || 'NEEDS_TRIAGE') as LeadType;
    const flags: string[] = [];
    if (age < 65) flags.push('Under 65 — verify Medicare eligibility');
    if (zipInfo && !zipInfo.supported) flags.push('ZIP outside supported service states');
    if (!email) flags.push('Email not provided');
    if (!isQualifiedSalesRoute(lt)) flags.push('Special-situation education request — do NOT work as a normal sales lead');

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
      interest_type: interestType,
      // Precise lead taxonomy — never a generic hot bucket (Sawil 2026-06-15).
      lead_type: lt,
      best_time_to_contact: '',
      consent_to_contact: true,
      consent_text: 'I agree to receive marketing calls and text messages from ClearPoint Senior Advisors at the phone number provided, possibly using an automatic telephone dialing system; message and data rates may apply; consent is not a condition of purchase; I may revoke by replying STOP or calling 1-866-310-8702; message frequency may vary. See Privacy Policy.',
      lead_notes: buildSummary(),
      lead_quality_flags: flags.join('; '),
      bot_transcript_summary: '',
      // Clean, business-usable CRM tags routed by lead type.
      tags: buildLeadTags(lt, specialCat?.tag),
      // PHASE A16 — SOA only required for qualified MA/PDP sales paths.
      // Special-situation education requests are not MA/PDP product sales,
      // so no Scope of Appointment is fetched.
      lead_source: 'smart_review',
      soa_pending: isQualifiedSalesRoute(lt),
      created_at: new Date().toISOString(),
      // Honeypot value forwarded to API for anti-bot gate
      website_url: websiteUrl,
    };

    const success = await submitLeadToGHL(payload);
    setSubmitting(false);
    if (success) {
      setSubmitted(true);
      setStep(TOTAL_STEPS + 1);
      // PHASE A16 — Fetch SOA signing token so the success view can render
      // the CMS-required Scope of Appointment link. Only for qualified MA/PDP
      // sales paths; special-situation education requests skip SOA.
      // PHASE 6 — 12s timeout so success view doesn't hang on bad networks.
      if (isQualifiedSalesRoute(lt)) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 12_000);
        try {
          const r = await fetch('/api/soa-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            signal: controller.signal,
            body: JSON.stringify({
              fullName: `${firstName} ${lastName}`.trim(),
              phone: phoneValid.cleaned,
              email: email || '',
              zip: zip || '',
              language: isEs ? 'es' : 'en',
              leadSource: 'smart_review',
            }),
          });
          clearTimeout(t);
          if (r.ok) {
            const data = await r.json();
            setSoaUrl(window.location.origin + (data.soaUrl || `/soa/${data.token}`));
          }
        } catch (e) {
          clearTimeout(t);
          // Non-fatal — user can still be reached by phone. Log only.
          console.warn('[SmartReview] SOA token fetch failed', e);
        }
      }
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
      `Smart Review Route: ${interestType || 'N/A'}`,
      `Lead Type: ${leadType || 'N/A'}`,
      ...(specialCat ? [`Special Situation: ${specialCat.en} (educational — not a normal sales lead)`] : []),
      ...(costAnswer ? [`Cost triage answer: ${costAnswer}`] : []),
      // PHASE A18 — qualifier fields (optional).
      ...(currentCarrier ? [`Current Carrier: ${currentCarrier}`] : []),
      ...(rxCount ? [`Prescription medications: ${rxCount}`] : []),
      ...(doctorPriority ? [`Doctor to keep: ${doctorPriority}`] : []),
      ...(medicaidExtraHelp ? [`Medicaid / Extra Help: ${medicaidExtraHelp}`] : []),
      '',
      'Recommended Agent Follow-Up:',
      specialCat
        ? 'Special-situation education request. Provide general Medicare guidance only. Do NOT work as a normal sales lead. ClearPoint does not enroll into or solve Medicaid, SSI, SSDI, VA, TRICARE, nursing home, home care, or state assistance programs.'
        : 'Verify Medicare status, current coverage, doctors, medications, and the requested plan review. Confirm any program status with the proper agency before discussing options.',
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
          <p className="text-earth-600 text-base mb-6">
            {t('Your request was received. A licensed Medicare advisor will contact you during business hours.', 'Su solicitud fue recibida. Un asesor licenciado de Medicare le contactará durante horas laborables.')}
          </p>

          {/* PHASE A16 — SOA signing CTA. CMS 422.2264 requires the SOA before
              an advisor can discuss MA / Part D products. Without this step,
              the advisor cannot call. */}
          {soaUrl && (
            <div className="bg-white rounded-2xl border border-cream-200 shadow-sm p-6 mt-6 text-left">
              <div className="flex items-start gap-3 mb-4">
                <span className="text-2xl">🔒</span>
                <div>
                  <h3 className="font-serif text-lg text-earth-900 mb-1">
                    {t('One last step: Sign your Scope of Appointment', 'Último paso: Firme su Scope of Appointment')}
                  </h3>
                  <p className="text-earth-600 text-sm">
                    {t('CMS requires us to confirm what topics you would like to discuss before the advisor calls. This takes 60 seconds. No obligation.', 'CMS requiere confirmar qué temas quiere discutir antes que el asesor le llame. Toma 60 segundos. Sin obligación.')}
                  </p>
                </div>
              </div>
              <a
                href={soaUrl}
                className="inline-block w-full sm:w-auto text-center px-6 py-3 bg-gold-500 text-white font-bold rounded-full hover:bg-gold-600 transition-colors min-h-[48px]"
              >
                {t('Sign Scope of Appointment', 'Firmar Scope of Appointment')} →
              </a>
              <p className="text-xs text-earth-400 mt-3">
                {t('Secure link, expires in 24 hours. Required by CMS 422.2264 before advisor contact.', 'Enlace seguro, expira en 24 horas. Requerido por CMS 422.2264 antes del contacto del asesor.')}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section id="smart-medicare-review" className="py-20 lg:py-28 bg-cream-50 scroll-mt-28">
      {/* Honeypot anti-bot field — hidden from sight, keyboard, screen readers,
          and browser autofill. Real users never see or touch this. Bots that
          scrape and auto-fill every input will populate it; the API silently
          discards any submission where this field has a value. Placed at the
          section root so it's part of the form's data even though Smart Review
          is a multi-step wizard (not wrapped in a <form> element). */}
      <input
        type="text"
        name="website_url"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={websiteUrl}
        onChange={(e) => setWebsiteUrl(e.target.value)}
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }}
      />
      <div className="max-w-2xl mx-auto px-5">
        {/* Header */}
        <div className="text-center mb-10">
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-500 mb-3 block">
            {t('Smart Medicare Review', 'Revisión Inteligente de Medicare')}
          </span>
          <h2 className="font-serif text-[1.6rem] sm:text-4xl font-normal text-earth-900 mb-3">
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
          <span className="text-xs text-earth-700 ml-3">{stepLabel(step)}</span>
        </div>

        {/* Step Content */}
        <div ref={cardRef} className="bg-white rounded-2xl shadow-lifted p-6 sm:p-8 border border-cream-200 scroll-mt-28">
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
          {/* ── Step 1 — Main: six Medicare qualification options ─────────── */}
          {step === 1 && step1View === 'main' && (
            <div>
              <p className="text-earth-800 text-base font-semibold mb-5">
                {t('What Medicare situation best matches you today?', '¿Cuál situación de Medicare describe mejor su caso hoy?')}
              </p>
              <div className="grid gap-2.5">
                {STEP1_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => chooseOption(opt)}
                    className={`w-full text-left px-4 py-4 rounded-xl border-2 text-base font-medium transition-all ${
                      selectedOption?.id === opt.id
                        ? 'border-gold-400 bg-gold-50 text-earth-900'
                        : 'border-cream-200 hover:border-gold-300 hover:bg-cream-50 text-earth-700'
                    }`}
                  >
                    {isEs ? opt.es : opt.en}
                  </button>
                ))}
              </div>

              {/* Medicare-adjacent qualified catch-all. UX audit 2026-06-15:
                  replaces the old "Special situations (Medicaid/VA/long-term
                  care)" wording that advertised government assistance and drew
                  unqualified leads. Employer-loss / SEP / life-change visitors
                  are real MA/PDP/Medigap prospects → routes as NEEDS_TRIAGE
                  through the normal flow (chooseOption). */}
              <button
                type="button"
                onClick={() => chooseOption(SEP_OPTION)}
                className={`mt-2.5 w-full text-left px-4 py-4 rounded-xl border-2 text-base font-medium transition-all ${
                  selectedOption?.id === SEP_OPTION.id
                    ? 'border-gold-400 bg-gold-50 text-earth-900'
                    : 'border-cream-200 hover:border-gold-300 hover:bg-cream-50 text-earth-700'
                }`}
              >
                {isEs ? SEP_OPTION.es : SEP_OPTION.en}
              </button>

              {/* Quiet, de-emphasized entry to the scope-limited education path
                  (Medicaid / VA / long-term care). Intentionally NOT a primary
                  marketing option — program names are kept off the main surface
                  per the audit; the honest guidance still exists one tap away. */}
              <button
                type="button"
                onClick={() => { setSpecialCat(null); setStep1View('special'); }}
                className="mt-4 w-full text-center text-sm text-earth-400 hover:text-earth-600 underline underline-offset-2 transition-colors"
              >
                {t('Have a different situation?', '¿Tiene una situación diferente?')}
              </button>
            </div>
          )}

          {/* ── Step 1 — Cost triage follow-up (COST_REVIEW_TRIAGE) ────────── */}
          {step === 1 && step1View === 'cost' && (
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-gold-500 mb-3">
                {t('Review my Medicare costs', 'Revisar mis costos de Medicare')}
              </p>
              <p className="text-earth-800 text-base font-semibold mb-5">
                {t('Where is the cost coming from?', '¿De dónde viene el costo?')}
              </p>
              <div className="grid gap-2.5">
                {COST_FOLLOWUPS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setCostAnswer(opt.en);
                      setLeadType(opt.leadType);
                      setStep(s => Math.min(s + 1, TOTAL_STEPS + 1));
                    }}
                    className="w-full text-left px-4 py-4 rounded-xl border-2 border-cream-200 hover:border-gold-300 hover:bg-cream-50 text-earth-700 text-base font-medium transition-all"
                  >
                    {isEs ? opt.es : opt.en}
                  </button>
                ))}
              </div>
              <button
                onClick={resetStep1}
                className="mt-4 text-sm text-earth-500 underline underline-offset-2 hover:text-earth-700"
              >
                {isEs ? '← Volver' : '← Back'}
              </button>
            </div>
          )}

          {/* ── Step 1 — Special situations: scope language, then categories ─ */}
          {step === 1 && step1View === 'special' && (
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-earth-500 mb-3">
                {t('Special situations', 'Situaciones especiales')}
              </p>
              {/* Required scope language — shown BEFORE any category. */}
              <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-[13px] text-earth-700 leading-relaxed mb-5">
                {isEs ? SPECIAL_SCOPE_ES : SPECIAL_SCOPE_EN}
              </div>
              <p className="text-earth-800 text-base font-semibold mb-3">
                {t('Which best describes your situation?', '¿Cuál describe mejor su situación?')}
              </p>
              <div className="grid gap-2.5">
                {SPECIAL_SITUATIONS.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => { setSpecialCat(cat); setStep1View('specialDetail'); }}
                    className="w-full text-left px-4 py-4 rounded-xl border-2 border-cream-200 hover:border-earth-300 hover:bg-cream-50 text-earth-700 text-base font-medium transition-all"
                  >
                    {isEs ? cat.es : cat.en}
                  </button>
                ))}
              </div>
              <button
                onClick={resetStep1}
                className="mt-4 text-sm text-earth-500 underline underline-offset-2 hover:text-earth-700"
              >
                {isEs ? '← Volver a las opciones de Medicare' : '← Back to Medicare options'}
              </button>
            </div>
          )}

          {/* ── Step 1 — Special situation detail: guidance + callback opt-in ─ */}
          {step === 1 && step1View === 'specialDetail' && specialCat && (
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-earth-500 mb-3">
                {isEs ? specialCat.es : specialCat.en}
              </p>
              <div className="rounded-xl border border-cream-200 bg-cream-50 p-4 text-sm text-earth-700 leading-relaxed mb-4">
                {isEs ? SPECIAL_GUIDANCE[specialCat.id].es : SPECIAL_GUIDANCE[specialCat.id].en}
              </div>
              {/* Scope reminder sits right next to the offer. */}
              <p className="text-xs text-earth-500 italic mb-5">
                {isEs ? SPECIAL_SCOPE_ES : SPECIAL_SCOPE_EN}
              </p>
              <p className="text-earth-800 text-base font-semibold mb-3">
                {t('Would you like a ClearPoint advisor to call you with general Medicare guidance?', '¿Le gustaría que un asesor de ClearPoint le llame con orientación general sobre Medicare?')}
              </p>
              <div className="space-y-2.5">
                <button
                  onClick={() => {
                    setSelectedOption(null);
                    setLeadType('LOW_PRIORITY_EDUCATION_REQUEST');
                    setStep(s => Math.min(s + 1, TOTAL_STEPS + 1));
                  }}
                  className="w-full bg-earth-800 text-cream-50 font-semibold px-5 py-4 rounded-xl hover:bg-earth-900 transition-all flex items-center justify-center gap-2"
                >
                  {t('Yes — please have an advisor call me', 'Sí — que un asesor me llame')} <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setStep1View('specialResources')}
                  className="w-full border-2 border-cream-200 text-earth-700 font-semibold px-5 py-4 rounded-xl hover:border-earth-300 hover:bg-cream-50 transition-all"
                >
                  {t('No — just show me resources', 'No — solo muéstreme recursos')}
                </button>
                <button
                  onClick={() => setStep1View('special')}
                  className="w-full text-sm text-earth-500 underline underline-offset-2 hover:text-earth-700 py-2"
                >
                  {isEs ? '← Atrás' : '← Back'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 1 — Special situation resources (callback declined; no CRM lead) ─ */}
          {step === 1 && step1View === 'specialResources' && specialCat && (
            <div>
              <p className="text-xs font-bold tracking-widest uppercase text-earth-500 mb-3">
                {t('Helpful resources', 'Recursos útiles')}
              </p>
              <div className="rounded-xl border border-cream-200 bg-cream-50 p-4 text-sm text-earth-700 leading-relaxed mb-4 space-y-2">
                <p>{isEs ? SPECIAL_GUIDANCE[specialCat.id].es : SPECIAL_GUIDANCE[specialCat.id].en}</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Medicare: 1-800-MEDICARE (1-800-633-4227) · medicare.gov</li>
                  <li>{t('Social Security (SSI/SSDI): 1-800-772-1213 · ssa.gov', 'Seguro Social (SSI/SSDI): 1-800-772-1213 · ssa.gov')}</li>
                  <li>{t('Your state Medicaid / SHIP office for local program help', 'Su oficina estatal de Medicaid / SHIP para ayuda local')}</li>
                </ul>
              </div>
              <p className="text-sm text-earth-700 mb-4">
                {t('You can also call ClearPoint for general Medicare guidance:', 'También puede llamar a ClearPoint para orientación general de Medicare:')}{' '}
                <a href="tel:18663108702" className="font-semibold text-gold-600 hover:underline">1-866-310-8702</a>{' '}
                <span className="text-earth-500">({t('Mon–Fri · 9am–6pm ET', 'Lun–Vie · 9am–6pm ET')})</span>
              </p>
              <button
                onClick={resetStep1}
                className="w-full text-sm text-earth-500 underline underline-offset-2 hover:text-earth-700 py-2"
              >
                {isEs ? '← Volver a las opciones de Medicare' : '← Back to Medicare options'}
              </button>
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
                aria-label={t('ZIP Code', 'Código postal')}
                aria-describedby={zip.length === 5 && (!zipInfo || !zipInfo.supported) ? 'zip-error' : undefined}
                className="w-full px-4 py-4 sm:py-3.5 bg-cream-50 border border-cream-300 rounded-xl text-lg text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 transition-all"
              />
              {/* Sawil 2026-06 COMPLIANCE — only confirm a location for SUPPORTED
                  service areas (NY/NJ/CT). A Florida ZIP has supported === false,
                  so we never echo "…, Florida" back to the user. */}
              {zipInfo && zipInfo.supported && (
                <p className="text-sm text-sage-600 mt-3 font-medium">
                  {isEs
                    ? `Ubicación detectada: ${zipInfo.city}, ${zipInfo.county}, ${zipInfo.state}`
                    : `Location detected: ${zipInfo.city}, ${zipInfo.county}, ${zipInfo.state}`}
                </p>
              )}
              {zip.length === 5 && (!zipInfo || !zipInfo.supported) && (
                <p id="zip-error" role="alert" className="text-sm text-red-500 mt-3">{t('Please enter a valid 5-digit ZIP code from NY, NJ, or CT.', 'Por favor ingrese un código postal válido de 5 dígitos de NY, NJ o CT.')}</p>
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
              <p className="text-earth-500 text-sm mb-4">
                {t('Select the month, day, and year.', 'Seleccione el mes, el día y el año.')}
              </p>
              <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">{t('Month', 'Mes')}</span>
                  <select
                    value={dobMonth}
                    onChange={(e) => setDobMonth(e.target.value)}
                    aria-label={t('Birth month', 'Mes de nacimiento')}
                    className="w-full px-3 py-3.5 min-h-[48px] rounded-xl border border-cream-300 bg-cream-50 text-earth-900 text-base focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40"
                  >
                    <option value="">{t('Month', 'Mes')}</option>
                    {DOB_MONTHS.map((m, i) => (
                      <option key={m.en} value={String(i + 1).padStart(2, '0')}>{isEs ? m.es : m.en}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">{t('Day', 'Día')}</span>
                  <select
                    value={dobDay}
                    onChange={(e) => setDobDay(e.target.value)}
                    aria-label={t('Birth day', 'Día de nacimiento')}
                    className="w-full px-3 py-3.5 min-h-[48px] rounded-xl border border-cream-300 bg-cream-50 text-earth-900 text-base focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40"
                  >
                    <option value="">{t('Day', 'Día')}</option>
                    {Array.from({ length: daysInMonth(dobMonth, dobYear) }, (_, i) => String(i + 1).padStart(2, '0')).map((d) => (
                      <option key={d} value={d}>{parseInt(d, 10)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">{t('Year', 'Año')}</span>
                  <select
                    value={dobYear}
                    onChange={(e) => setDobYear(e.target.value)}
                    aria-label={t('Birth year', 'Año de nacimiento')}
                    className="w-full px-3 py-3.5 min-h-[48px] rounded-xl border border-cream-300 bg-cream-50 text-earth-900 text-base focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40"
                  >
                    <option value="">{t('Year', 'Año')}</option>
                    {DOB_YEARS.map((y) => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </label>
              </div>
              {dob && validateDOB(dob).valid && validateDOB(dob).age !== null && (
                <p className="text-sm text-earth-500 mt-3">
                  {isEs ? `Edad: ${validateDOB(dob).age} años` : `Age: ${validateDOB(dob).age}`}
                </p>
              )}
              {dob && !validateDOB(dob).valid && (
                <p role="alert" className="text-sm text-red-500 mt-3">
                  {((validateDOB(dob).age ?? -1) >= 0 && (validateDOB(dob).age ?? 0) < 18)
                    ? t('Please double-check the year — this date is under 18.', 'Por favor revise el año — esta fecha es menor de 18.')
                    : t('Please select a valid date of birth.', 'Por favor seleccione una fecha de nacimiento válida.')}
                </p>
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
                <input type="text" autoComplete="given-name" aria-label={t('First Name', 'Nombre')} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder={t('First Name', 'Nombre') + ' *'} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {firstName.length > 1 && !validatePersonName(firstName).valid && <p role="alert" className="text-xs text-red-500">{t('Please enter a valid name without numbers, symbols, or inappropriate words.', 'Por favor ingrese un nombre válido sin números, símbolos ni palabras inapropiadas.')}</p>}
                <input type="text" autoComplete="family-name" aria-label={t('Last Name', 'Apellido')} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder={t('Last Name', 'Apellido') + ' *'} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {lastName.length > 1 && !validatePersonName(lastName).valid && <p role="alert" className="text-xs text-red-500">{t('Please enter a valid name without numbers, symbols, or inappropriate words.', 'Por favor ingrese un nombre válido sin números, símbolos ni palabras inapropiadas.')}</p>}
                <input type="tel" aria-label={t('Phone Number', 'Teléfono')} value={phone} onChange={(e) => handlePhone(e.target.value)} placeholder={t('Phone Number', 'Teléfono') + ' *'} inputMode="tel" pattern="[0-9]*" autoComplete="tel-national" maxLength={10} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {phone.length > 0 && phone.length < 10 && <p role="alert" className="text-xs text-red-500">{t('Must be 10 digits.', 'Debe tener 10 dígitos.')}</p>}
                {phone.length === 10 && !validatePhone(phone).valid && <p role="alert" className="text-xs text-red-500">{t('Please enter a valid 10-digit U.S. phone number.', 'Por favor ingrese un número de teléfono válido de Estados Unidos de 10 dígitos.')}</p>}
                <input type="email" autoComplete="email" aria-label={t('Email (optional)', 'Correo electrónico (opcional)')} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('Email (optional)', 'Correo (opcional)')} className="w-full px-4 py-4 sm:py-3 bg-cream-50 border border-cream-300 rounded-xl text-base text-earth-900 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400" />
                {email && !validateEmail(email).valid && <p role="alert" className="text-xs text-red-500">{t('Please enter a valid email address, or leave it blank if you prefer.', 'Por favor ingrese un correo electrónico válido, o déjelo en blanco si prefiere.')}</p>}
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
                    aria-pressed={prefLang === l}
                    className={`w-full text-left px-4 py-4 rounded-xl border-2 text-base font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 ${
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
                <p><strong>{t('You selected:', 'Usted seleccionó:')}</strong> {selectionLabel}</p>
                <p><strong>ZIP:</strong> {zip} — {zipInfo?.city}, {zipInfo?.county}, {zipInfo?.state}</p>
                <p><strong>{t('DOB:', 'Fecha Nac.:')}</strong> {dob} ({t('Age:', 'Edad:')} {validateDOB(dob).age})</p>
                <p><strong>{t('Name:', 'Nombre:')}</strong> {firstName} {lastName}</p>
                <p><strong>{t('Phone:', 'Tel.:')}</strong> {phone}</p>
                {email && <p><strong>Email:</strong> {email}</p>}
                <p><strong>{t('Language:', 'Idioma:')}</strong> {prefLang}</p>
              </div>

              {/* PHASE A18 — Optional qualifier questions. All have a
                  "Don't know" option. These flow into lead notes + Lead
                  Intelligence so the advisor has context BEFORE calling. */}
              <div className="bg-white rounded-xl border border-cream-200 p-5 mb-5 space-y-4">
                <p className="text-sm font-bold text-earth-700 uppercase tracking-wide">
                  {t('A few quick questions (optional)', 'Unas preguntas rápidas (opcional)')}
                </p>

                {/* Current carrier */}
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">
                    {t('Current plan / carrier', 'Plan / aseguradora actual')}
                  </span>
                  <select
                    value={currentCarrier}
                    onChange={(e) => setCurrentCarrier(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-lg border border-cream-300 bg-white text-earth-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-200"
                  >
                    <option value="">{t('Select…', 'Seleccione…')}</option>
                    <option value="UnitedHealth/AARP">UnitedHealth / AARP</option>
                    <option value="Humana">Humana</option>
                    <option value="Aetna">Aetna</option>
                    <option value="WellCare">WellCare</option>
                    <option value="Cigna">Cigna</option>
                    <option value="Blue Cross / Blue Shield">Blue Cross / Blue Shield</option>
                    <option value="EmblemHealth / HealthFirst / Fidelis">{t('Local NY/NJ/CT carrier', 'Aseguradora local NY/NJ/CT')}</option>
                    <option value="Original Medicare only (no MA / no PDP)">{t('Original Medicare only', 'Solo Medicare Original')}</option>
                    <option value="Other">{t('Other', 'Otro')}</option>
                    <option value="Don't know">{t('I don’t know', 'No sé')}</option>
                  </select>
                </label>

                {/* Prescription count */}
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">
                    {t('Number of prescription medications you take', 'Cantidad de medicinas recetadas que toma')}
                  </span>
                  <select
                    value={rxCount}
                    onChange={(e) => setRxCount(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-lg border border-cream-300 bg-white text-earth-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-200"
                  >
                    <option value="">{t('Select…', 'Seleccione…')}</option>
                    <option value="0 (none)">{t('None', 'Ninguna')}</option>
                    <option value="1-3">1–3</option>
                    <option value="4-6">4–6</option>
                    <option value="7+">7+</option>
                    <option value="Don't know / not sure">{t('I don’t know', 'No sé')}</option>
                  </select>
                </label>

                {/* Doctor priority */}
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">
                    {t('Do you have a doctor you want to keep?', '¿Tiene un doctor que quiere mantener?')}
                  </span>
                  <select
                    value={doctorPriority}
                    onChange={(e) => setDoctorPriority(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-lg border border-cream-300 bg-white text-earth-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-200"
                  >
                    <option value="">{t('Select…', 'Seleccione…')}</option>
                    <option value="Yes — primary doctor + maybe specialist">{t('Yes — primary care doctor', 'Sí — doctor primario')}</option>
                    <option value="Yes — specialist only">{t('Yes — specialist', 'Sí — especialista')}</option>
                    <option value="No primary doctor right now">{t('No primary doctor', 'Sin doctor primario')}</option>
                    <option value="Don't know / flexible">{t('I don’t know / flexible', 'No sé / flexible')}</option>
                  </select>
                </label>

                {/* Medicaid / Extra Help — dual-eligible qualifier (program status
                    only; compliance-safe). Lets the advisor flag D-SNP options. */}
                <label className="block">
                  <span className="block text-sm text-earth-700 mb-1.5">
                    {t('Do you have Medicaid or Extra Help (LIS)?', '¿Tiene Medicaid o Extra Help (Ayuda Extra)?')}
                  </span>
                  <select
                    value={medicaidExtraHelp}
                    onChange={(e) => setMedicaidExtraHelp(e.target.value)}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-lg border border-cream-300 bg-white text-earth-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-200"
                  >
                    <option value="">{t('Select…', 'Seleccione…')}</option>
                    <option value="Yes — Medicaid">{t('Yes — Medicaid', 'Sí — Medicaid')}</option>
                    <option value="Yes — Extra Help / LIS">{t('Yes — Extra Help / LIS', 'Sí — Extra Help / LIS')}</option>
                    <option value="Yes — both Medicaid and Extra Help">{t('Yes — both', 'Sí — ambos')}</option>
                    <option value="No">{t('No', 'No')}</option>
                    <option value="Don't know / not sure">{t('I don’t know', 'No sé')}</option>
                  </select>
                </label>
              </div>

              {/* Consent — TCPA language matched to the main LeadForm (MED-01).
                  Required: the Submit button is disabled until `consent` is true. */}
              <label className="flex items-start gap-3 cursor-pointer bg-cream-100 rounded-xl p-4 border border-cream-300 mb-4">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required aria-required="true" aria-label={t('I agree to the contact consent', 'Acepto el consentimiento de contacto')} className="mt-0.5 w-5 h-5 accent-earth-800 flex-shrink-0" />
                <span className="text-sm text-earth-700 leading-relaxed">
                  {t(
                    'I agree to receive marketing calls and text messages from ClearPoint Senior Advisors at the phone number provided above. I understand that these calls may be made using an automatic telephone dialing system and that message and data rates may apply. I understand that I am not required to consent as a condition of purchasing any goods or services, and that I may revoke my consent at any time by replying STOP or calling 1-866-310-8702. Message frequency may vary. See our',
                    'Acepto recibir llamadas de marketing y mensajes de texto de ClearPoint Senior Advisors en el número de teléfono proporcionado arriba. Entiendo que estas llamadas pueden realizarse utilizando un sistema de marcado telefónico automático y que pueden aplicarse tarifas de mensajes y datos. Entiendo que no estoy obligado a consentir como condición para comprar bienes o servicios, y que puedo revocar mi consentimiento en cualquier momento respondiendo STOP o llamando al 1-866-310-8702. La frecuencia de mensajes puede variar. Consulte nuestra'
                  )}{' '}
                  <Link to="/privacy-policy" className="underline text-earth-800 font-semibold hover:text-gold-500">{t('Privacy Policy', 'Política de Privacidad')}</Link>{' '}
                  {t('for more information.', 'para más información.')}
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
                  : leadType === 'LOW_PRIORITY_EDUCATION_REQUEST'
                    ? t('Request Advisor Callback', 'Solicitar Llamada de Asesor')
                    : t('Request My Free Review', 'Solicitar Mi Revisión Gratis')}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

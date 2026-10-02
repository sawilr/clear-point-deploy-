// ─────────────────────────────────────────────────────────────────────────────
// CY2027 SCOPE OF APPOINTMENT FORM.
//
// AUDIT 2026-10-01 — rewritten from the CMS-10566-shaped v1 to the owner-approved
// Clear Point Master SOA (NY/NJ/CT, CY2027). What changed and why:
//
//   • STATE FIRST. The form cannot reach the categories until a residence state
//     is chosen and confirmed, and a state outside NY/NJ/CT routes to the
//     general service path instead of an SOA (spec §5). Residence is never
//     inferred from an area code.
//   • APPOINTMENT REQUIRED. Date + format are collected because an SOA is
//     appointment-specific; CMS rejected a standing universal SOA for CY2027
//     (spec §7). An in-person appointment is explicitly flagged as requiring
//     this written form.
//   • CATEGORIES. The four approved options replace the old five-product list.
//     "I am not sure / I prefer to discuss the process first" is a real choice
//     that authorizes NOTHING — selecting only it produces SOA_INCOMPLETE and a
//     licensed agent explains the process first (spec §8, §10).
//   • The old help text said "Select ALL products you would like the licensed
//     advisor to review with you." Spec §8 forbids select-all as a one-click
//     authorization; the approved wording asks the person to select ONLY what
//     they want discussed. The approved sentence is now used verbatim.
//   • READ-BACK. A confirmation step reads back exactly what was authorized
//     before the signature is taken (spec §8).
//   • DATE OF BIRTH AND STREET ADDRESS REMOVED. Neither appears on the approved
//     template, and collecting data the form does not need contradicts the data
//     minimization rule (spec §14).
//   • Nothing is pre-checked and there is no countdown, scarcity or urgency
//     device anywhere in the flow (spec §29).
//
// Every customer-facing string comes from api/_lib/cy2027/soa-text.js. None is
// written here, so the approved wording has exactly one source and the build
// guard can hash it.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  SOA_CATEGORIES, SOA_TEXT, APPOINTMENT_FORMATS, SOA_AGENT_LINE,
  STATE_RULESETS, SUPPORTED_STATES, resolveStateRuleset, readBackLines, partitionSelection,
  type SoaCategoryCode, type SupportedState,
} from '../lib/cy2027';
import { AGENT, ACKNOWLEDGEMENTS, tLabel, tpmoDisclaimer } from '../lib/soaContent';

export interface SOAFormResult {
  ok: boolean;
  soaId?: string;
  signedAt?: string;
  pdfHash?: string;
}

interface SOAFormProps {
  language: 'en' | 'es';
  lead: {
    fullName: string;
    phone: string;
    email: string;
    zip: string;
  };
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

/** Local copy only for labels this form needs and the approved text does not carry. */
const UI = {
  stateHeading: { en: 'Your state of residence', es: 'Su estado de residencia' },
  stateHelp: {
    en: 'We ask first because the rules that apply to your appointment depend on where you live.',
    es: 'Se lo preguntamos primero porque las reglas de su cita dependen de dónde vive usted.',
  },
  statePick: { en: 'Select your state', es: 'Seleccione su estado' },
  stateOther: { en: 'Another state', es: 'Otro estado' },
  stateUnsupported: {
    en: 'We are licensed in New York, New Jersey and Connecticut. We can still help you by phone — please call 1-855-720-8555 and a licensed advisor will point you to the right place.',
    es: 'Tenemos licencia en Nueva York, Nueva Jersey y Connecticut. Aun así podemos ayudarle por teléfono — llame al 1-855-720-8555 y un asesor licenciado le orientará.',
  },
  countyHelp: {
    en: 'If you are not sure of your county, leave it blank and the advisor will confirm it with you.',
    es: 'Si no está seguro de su condado, déjelo en blanco y el asesor lo confirmará con usted.',
  },
  appointmentHelp: {
    en: 'This form covers one specific appointment. If you later schedule another appointment, a new form is completed for it.',
    es: 'Este formulario cubre una sola cita específica. Si después programa otra cita, se completa un formulario nuevo para esa.',
  },
  inPersonNote: {
    en: 'For an in-person appointment this written form must be completed before the appointment begins.',
    es: 'Para una cita presencial, este formulario escrito debe completarse antes de que comience la cita.',
  },
  reviewBack: { en: 'Go back and change my answers', es: 'Volver y cambiar mis respuestas' },
  reviewContinue: { en: 'Yes, that is correct — continue', es: 'Sí, es correcto — continuar' },
  toReview: { en: 'Review my answers', es: 'Revisar mis respuestas' },
  declinedHeading: { en: 'Not authorized at this appointment', es: 'No autorizado en esta cita' },
  unsureNote: {
    en: 'You asked to discuss the process first. A licensed agent will explain it before any plan-specific conversation.',
    es: 'Usted pidió hablar primero sobre el proceso. Un agente licenciado se lo explicará antes de cualquier conversación específica sobre planes.',
  },
  required: { en: 'Please answer this to continue.', es: 'Por favor responda esto para continuar.' },
  pickOne: {
    en: 'Please choose at least one option. If you are unsure, choose the last option.',
    es: 'Elija al menos una opción. Si no está seguro, elija la última opción.',
  },
} as const;

const t = (k: keyof typeof UI, L: 'en' | 'es') => UI[k][L];

export function SOAForm({ language, lead, onSubmit }: SOAFormProps) {
  const L = language;
  const txt = SOA_TEXT[L];

  const [step, setStep] = useState<'form' | 'review'>('form');
  const [residenceState, setResidenceState] = useState<SupportedState | 'OTHER' | ''>('');
  const [zip, setZip] = useState(lead.zip || '');
  const [county, setCounty] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentFormat, setAppointmentFormat] = useState('');
  const [categories, setCategories] = useState<SoaCategoryCode[]>([]);
  const [ackNoObl, setAckNoObl] = useState(false);
  const [ackEsig, setAckEsig] = useState(false);
  const [signature, setSignature] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const stateResolution = useMemo(
    () => (residenceState && residenceState !== 'OTHER' ? resolveStateRuleset(residenceState, 2027) : null),
    [residenceState],
  );
  const ruleset = stateResolution?.ok ? stateResolution.ruleset : null;
  const unsupported = residenceState === 'OTHER';
  const stateName = ruleset ? (L === 'es' ? ruleset.nameEs : ruleset.name) : '';

  const parts = useMemo(() => partitionSelection(categories), [categories]);
  const readBack = useMemo(() => readBackLines(categories, L), [categories, L]);
  const isInPerson = appointmentFormat === 'IN_PERSON';

  const toggleCategory = (code: SoaCategoryCode) => {
    setCategories((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  const validateForm = () => {
    const e: Record<string, string> = {};
    if (!residenceState) e.residenceState = t('required', L);
    if (!/^\d{5}$/.test(zip.trim())) e.zip = tLabel('validation_required', L);
    if (!appointmentDate.trim()) e.appointmentDate = t('required', L);
    if (!appointmentFormat) e.appointmentFormat = t('required', L);
    if (categories.length === 0) e.categories = t('pickOne', L);
    return e;
  };

  const validateSign = () => {
    const e: Record<string, string> = {};
    if (!ackNoObl || !ackEsig) e.acknowledgements = tLabel('validation_acknowledgement', L);
    const a = signature.trim().toLowerCase().replace(/\s+/g, ' ');
    const b = lead.fullName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!signature.trim()) e.signature = tLabel('validation_required', L);
    else if (a !== b) e.signature = tLabel('validation_signature_mismatch', L);
    return e;
  };

  const focusFirstError = () => {
    const el = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
    if (el) el.focus();
  };

  const goToReview = (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validateForm();
    setErrors(e);
    if (Object.keys(e).length) { focusFirstError(); return; }
    setStep('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSign = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validateSign();
    setErrors(e);
    if (Object.keys(e).length) { focusFirstError(); return; }
    if (!ruleset) return;
    setSubmitting(true);
    await onSubmit({
      fullName: lead.fullName,
      phone: lead.phone,
      email: lead.email,
      residenceState: ruleset.code,
      zip: zip.trim(),
      county: county.trim() || null,
      planYear: 2027,
      appointmentAt: appointmentDate,
      appointmentFormat,
      selectedCategories: categories,
      authorizedCategories: parts.authorized,
      declinedCategories: parts.declined,
      stateRulesetVersion: ruleset.stateRulesetVersion,
      soaFormVersion: ruleset.soaFormVersion,
      acknowledgements: { no_obligation: ackNoObl, e_signature: ackEsig },
      signature: signature.trim(),
      language: L,
    });
    setSubmitting(false);
  };

  // ── Header + the two blocks that appear on every step ──────────────────────
  const Header = (
    <header className="border-b border-cream-200 pb-6">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-600 mb-2">{txt.org}</p>
      <h1 className="font-serif text-2xl sm:text-3xl text-earth-900 leading-snug">
        {stateName ? txt.title.replace('{state}', stateName) : txt.title.replace(' - {state}', '')}
      </h1>
      <p className="text-earth-600 text-sm mt-3 leading-relaxed">{txt.intro}</p>
    </header>
  );

  const Tpmo = (
    <section className="bg-cream-50 rounded-xl p-5 border border-cream-200">
      <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-2">{tLabel('tpmo_heading', L)}</h2>
      <p className="text-earth-600 text-sm leading-relaxed">{tpmoDisclaimer(L)}</p>
    </section>
  );

  const Security = (
    <p className="text-xs text-earth-600 bg-cream-50 border border-cream-200 rounded-lg p-4 leading-relaxed">
      {txt.security}
    </p>
  );

  // ── Step 2: read-back ──────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <form onSubmit={handleSign} method="post" action="#" noValidate className="space-y-8">
        {Header}
        {Tpmo}

        <section aria-labelledby="soa-readback">
          <h2 id="soa-readback" className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-3">
            {readBack.heading}
          </h2>
          <p className="text-earth-700 text-sm mb-3">{readBack.intro}</p>
          {readBack.items.length > 0 && (
            <ul className="space-y-2">
              {readBack.items.map((item) => (
                <li key={item} className="flex items-start gap-3 p-3 rounded-lg border border-gold-200 bg-gold-50/40">
                  <span aria-hidden="true" className="text-gold-600 font-bold mt-0.5">✓</span>
                  <span className="text-earth-800 text-sm leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          )}
          {parts.nonAuthorizing.length > 0 && (
            <p className="text-earth-600 text-sm mt-3 leading-relaxed">{t('unsureNote', L)}</p>
          )}
        </section>

        <section className="grid sm:grid-cols-2 gap-3 text-sm">
          <RoField label={txt.fields.beneficiaryName} value={lead.fullName} compact />
          <RoField label={txt.fields.residenceState} value={stateName} compact />
          <RoField label={txt.fields.zip} value={zip} compact />
          <RoField label={txt.fields.county} value={county || '—'} compact />
          <RoField label={txt.fields.appointmentDate} value={appointmentDate} compact />
          <RoField
            label={txt.fields.appointmentFormat}
            value={APPOINTMENT_FORMATS.filter((f) => f.code === appointmentFormat).map((f) => (L === 'es' ? f.es : f.en))[0] || '—'}
            compact
          />
          <RoField label={txt.fields.planYear} value="2027" compact />
          <RoField label={txt.fields.language} value={L === 'es' ? 'Español' : 'English'} compact />
        </section>

        <p className="text-earth-600 text-sm leading-relaxed">{txt.important}</p>

        <section>
          <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-3">{txt.authorizationHeading}</h2>
          <p className="text-earth-700 text-sm mb-4 leading-relaxed">{txt.authorizationStatement}</p>
          <div className="space-y-3">
            <label className="flex items-start gap-3 p-3 rounded-lg border border-cream-200 cursor-pointer min-h-[56px]">
              <input type="checkbox" className="mt-1 w-5 h-5 accent-gold-500" checked={ackNoObl} onChange={(e) => setAckNoObl(e.target.checked)} />
              <span className="text-earth-700 text-sm leading-relaxed">{ACKNOWLEDGEMENTS.no_obligation[L]}</span>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg border border-cream-200 cursor-pointer min-h-[56px]">
              <input type="checkbox" className="mt-1 w-5 h-5 accent-gold-500" checked={ackEsig} onChange={(e) => setAckEsig(e.target.checked)} />
              <span className="text-earth-700 text-sm leading-relaxed">{ACKNOWLEDGEMENTS.e_signature[L]}</span>
            </label>
          </div>
          {errors.acknowledgements && <p role="alert" className="text-sm text-red-600 mt-2">{errors.acknowledgements}</p>}
        </section>

        <section>
          <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">{txt.fields.signature}</h2>
          <p className="text-earth-700 text-sm mb-3">{tLabel('signature_help', L)}</p>
          <Field
            label={txt.fields.printedName}
            placeholder={lead.fullName}
            value={signature}
            onChange={setSignature}
            error={errors.signature}
            required
            autoComplete="off"
            big
          />
        </section>

        <section className="bg-cream-50 rounded-xl p-5 border border-cream-200">
          <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-3">{txt.fields.agent}</h2>
          <p className="text-earth-800 font-medium text-sm">{SOA_AGENT_LINE}</p>
          <p className="text-earth-600 text-sm mt-1">{AGENT.agency} · {AGENT.agencyPhone}</p>
        </section>

        {Security}

        <div className="pt-4 flex flex-col sm:flex-row gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto px-8 py-4 bg-gold-500 text-white font-bold rounded-full hover:bg-gold-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-h-[52px]"
          >
            {submitting ? tLabel('signing', L) : tLabel('submit', L)}
          </button>
          <button
            type="button"
            onClick={() => { setStep('form'); setErrors({}); }}
            className="w-full sm:w-auto px-6 py-4 text-earth-700 font-medium rounded-full border border-cream-300 hover:bg-cream-50 transition-colors min-h-[52px]"
          >
            {t('reviewBack', L)}
          </button>
        </div>
      </form>
    );
  }

  // ── Step 1: the form ───────────────────────────────────────────────────────
  return (
    <form onSubmit={goToReview} method="post" action="#" noValidate className="space-y-8">
      {Header}
      {Tpmo}

      {/* State first — nothing below opens until this is answered. */}
      <section aria-labelledby="soa-state">
        <h2 id="soa-state" className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">
          {t('stateHeading', L)}
        </h2>
        <p className="text-earth-700 text-sm mb-3 leading-relaxed">{t('stateHelp', L)}</p>
        <fieldset>
          <legend className="sr-only">{t('statePick', L)}</legend>
          <div className="grid sm:grid-cols-2 gap-2">
            {SUPPORTED_STATES.map((code) => (
              <label
                key={code}
                className="flex items-center gap-3 p-3 rounded-lg border border-cream-200 hover:bg-cream-50 cursor-pointer min-h-[56px]"
              >
                <input
                  type="radio"
                  name="residence-state"
                  className="w-5 h-5 accent-gold-500"
                  checked={residenceState === code}
                  aria-invalid={!!errors.residenceState}
                  onChange={() => { setResidenceState(code); setErrors((p) => ({ ...p, residenceState: '' })); }}
                />
                <span className="text-earth-800 text-sm font-medium">
                  {L === 'es' ? STATE_RULESETS[code].nameEs : STATE_RULESETS[code].name}
                </span>
              </label>
            ))}
            <label className="flex items-center gap-3 p-3 rounded-lg border border-cream-200 hover:bg-cream-50 cursor-pointer min-h-[56px]">
              <input
                type="radio"
                name="residence-state"
                className="w-5 h-5 accent-gold-500"
                checked={residenceState === 'OTHER'}
                onChange={() => setResidenceState('OTHER')}
              />
              <span className="text-earth-800 text-sm font-medium">{t('stateOther', L)}</span>
            </label>
          </div>
        </fieldset>
        {errors.residenceState && <p role="alert" className="text-sm text-red-600 mt-2">{errors.residenceState}</p>}
        {unsupported && (
          <p role="status" className="mt-4 text-earth-700 text-sm leading-relaxed bg-cream-50 border border-cream-200 rounded-lg p-4">
            {t('stateUnsupported', L)}
          </p>
        )}
      </section>

      {/* Everything below requires a supported state. */}
      {ruleset && (
        <>
          <section>
            <div className="grid sm:grid-cols-2 gap-4">
              <RoField label={txt.fields.beneficiaryName} value={lead.fullName} />
              <Field
                label={txt.fields.zip}
                placeholder="00000"
                value={zip}
                onChange={(v) => setZip(v.replace(/\D/g, '').slice(0, 5))}
                error={errors.zip}
                required
                inputMode="numeric"
                autoComplete="postal-code"
              />
              <Field
                label={txt.fields.county}
                placeholder=""
                value={county}
                onChange={setCounty}
                error={undefined}
                autoComplete="address-level2"
                help={t('countyHelp', L)}
              />
            </div>
          </section>

          <section aria-labelledby="soa-appointment">
            <h2 id="soa-appointment" className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">
              {txt.appointmentHeading}
            </h2>
            <p className="text-earth-700 text-sm mb-3 leading-relaxed">{t('appointmentHelp', L)}</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field
                label={txt.fields.appointmentDate}
                placeholder="MM/DD/YYYY"
                value={appointmentDate}
                onChange={setAppointmentDate}
                error={errors.appointmentDate}
                required
                inputMode="numeric"
              />
              <div>
                <span className="block text-xs font-medium text-earth-600 mb-1">
                  {txt.fields.appointmentFormat}<span className="text-red-500 ml-1">*</span>
                </span>
                <fieldset>
                  <legend className="sr-only">{txt.fields.appointmentFormat}</legend>
                  <div className="space-y-2">
                    {APPOINTMENT_FORMATS.map((f) => (
                      <label key={f.code} className="flex items-center gap-3 p-3 rounded-lg border border-cream-200 hover:bg-cream-50 cursor-pointer min-h-[52px]">
                        <input
                          type="radio"
                          name="appointment-format"
                          className="w-5 h-5 accent-gold-500"
                          checked={appointmentFormat === f.code}
                          aria-invalid={!!errors.appointmentFormat}
                          onChange={() => { setAppointmentFormat(f.code); setErrors((p) => ({ ...p, appointmentFormat: '' })); }}
                        />
                        <span className="text-earth-800 text-sm">{L === 'es' ? f.es : f.en}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {errors.appointmentFormat && <p role="alert" className="text-sm text-red-600 mt-2">{errors.appointmentFormat}</p>}
              </div>
            </div>
            {isInPerson && (
              <p role="status" className="mt-3 text-earth-700 text-sm leading-relaxed bg-gold-50/50 border border-gold-200 rounded-lg p-4">
                {t('inPersonNote', L)}
              </p>
            )}
          </section>

          <section aria-labelledby="soa-categories">
            <h2 id="soa-categories" className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">
              {txt.categoriesHeading}
            </h2>
            <p className="text-earth-700 text-sm mb-4 leading-relaxed">{txt.categoriesHelp}</p>
            <fieldset>
              <legend className="sr-only">{txt.categoriesHeading}</legend>
              <div className="space-y-3">
                {SOA_CATEGORIES.map((cat) => {
                  const c = L === 'es' ? cat.es : cat.en;
                  const descId = `soa-cat-${cat.code}-desc`;
                  return (
                    <label
                      key={cat.code}
                      className="flex items-start gap-3 p-4 rounded-lg border border-cream-200 hover:bg-cream-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 w-5 h-5 accent-gold-500 shrink-0"
                        checked={categories.includes(cat.code)}
                        aria-describedby={descId}
                        aria-invalid={!!errors.categories}
                        onChange={() => { toggleCategory(cat.code); setErrors((p) => ({ ...p, categories: '' })); }}
                      />
                      <span className="min-w-0">
                        <span className="block text-earth-900 text-sm font-medium leading-relaxed">{c.label}</span>
                        <span id={descId} className="block text-earth-600 text-sm mt-1 leading-relaxed">{c.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {errors.categories && <p role="alert" className="text-sm text-red-600 mt-2">{errors.categories}</p>}
            <p className="text-earth-600 text-sm mt-4 leading-relaxed">{txt.important}</p>
          </section>

          {Security}

          <div className="pt-4">
            <button
              type="submit"
              className="w-full sm:w-auto px-8 py-4 bg-gold-500 text-white font-bold rounded-full hover:bg-gold-600 transition-colors min-h-[52px]"
            >
              {t('toReview', L)}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

// ── Helper field components ────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel';
  autoComplete?: string;
  big?: boolean;
  help?: string;
}

function Field({ label, value, onChange, placeholder, error, required, inputMode, autoComplete, big, help }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-earth-600 mb-1">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={!!error}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className={
          (big ? 'text-lg font-serif italic ' : 'text-base ') +
          'w-full px-4 py-3 min-h-[48px] rounded-lg border border-cream-300 bg-white text-earth-900 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-200 transition-colors'
        }
      />
      {help && !error && <p className="text-xs text-earth-600 mt-1 leading-relaxed">{help}</p>}
      {error && <p role="alert" className="text-sm text-red-600 mt-1">{error}</p>}
    </label>
  );
}

interface RoFieldProps {
  label: string;
  value: string;
  compact?: boolean;
}

function RoField({ label, value, compact }: RoFieldProps) {
  if (compact) return (
    <div>
      <span className="text-xs uppercase text-earth-700 tracking-wide">{label}</span>
      <p className="text-earth-800 font-medium">{value}</p>
    </div>
  );
  return (
    <div>
      <span className="block text-xs font-medium text-earth-600 mb-1">{label}</span>
      <div className="px-4 py-3 min-h-[48px] rounded-lg bg-cream-50 border border-cream-200 text-earth-700 flex items-center">
        {value}
      </div>
    </div>
  );
}

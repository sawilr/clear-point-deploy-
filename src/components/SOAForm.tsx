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
// The DOCUMENT wording (categories, acknowledgement, authorization, security
// notice) comes from api/_lib/cy2027/soa-text.js, so the approved text has
// exactly one source and the build guard can hash it. What IS written here is
// navigation chrome only: the labels in `UI` below and the bilingual language
// election prompt, which by definition cannot come from a single-language table.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SOA_CATEGORIES, SOA_TEXT, APPOINTMENT_FORMATS, SOA_AGENT_LINE,
  STATE_RULESETS, SUPPORTED_STATES, resolveStateRuleset, readBackLines, partitionSelection,
  LANGUAGE_SOURCE, languageElectionLabel, activePlanYear,
  type SoaCategoryCode, type SupportedState, type LanguageSourceCode,
} from '../lib/cy2027';
import { AGENT, ACKNOWLEDGEMENTS, tLabel, tpmoDisclaimer } from '../lib/soaContent';

export interface SOAFormResult {
  ok: boolean;
  soaId?: string;
  signedAt?: string;
  pdfHash?: string;
}

interface SOAFormProps {
  /**
   * The language the surrounding page is already displaying. It is a PRESENTATION
   * default only — never the language recorded on the signed document. See the
   * election gate below (audit G08).
   */
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
  langChange: { en: 'Change language', es: 'Cambiar idioma' },
  stateUnsupported: {
    en: 'We are licensed in New York, New Jersey and Connecticut. We can still help you by phone — please call 1-855-720-8555 and a licensed advisor will point you to the right place.',
    es: 'Tenemos licencia en Nueva York, Nueva Jersey y Connecticut. Aun así podemos ayudarle por teléfono — llame al 1-855-720-8555 y un asesor licenciado le orientará.',
  },
  // Shown when a supported state has no ruleset in force for the current plan
  // year (for example between a plan-year rollover and the new rules being
  // approved). The form must not look broken and must not fall back to last
  // year's rules; it sends the person to a human.
  rulesUnavailable: {
    en: 'We cannot complete this form online right now. A licensed advisor can help you by phone: ',
    es: 'En este momento no podemos completar este formulario en línea. Un asesor licenciado puede ayudarle por teléfono: ',
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
  // ── Language election (audit G08) ───────────────────────────────────────────
  // The document's language used to come from `lead?.language || 'es'`, so a
  // signed record could not distinguish "this person chose Spanish" from "there
  // was no lead and the page fell back to Spanish". The disclosures on this form
  // ARE the document; the language they are read in has to be chosen, on the
  // record, by the person signing. Nothing is preselected and the prompt is
  // bilingual, because before the election there is no language to ask in.
  const [elected, setElected] = useState<'en' | 'es' | null>(null);
  const L = elected ?? language;
  const txt = SOA_TEXT[L];

  const [step, setStep] = useState<'form' | 'review'>('form');

  // RED TEAM 2026-10-03 (G08, accessibility) — choosing a language, going to the
  // read-back and changing language each swap the whole view, and the control
  // that had focus unmounts. Focus fell to <body>: a screen-reader or keyboard
  // user was left at the top of the page with no announcement. The heading of
  // the new view takes focus instead. Skipped on first mount so the page's own
  // focus order is not hijacked.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    headingRef.current?.focus();
  }, [elected, step]);
  const [residenceState, setResidenceState] = useState<SupportedState | 'OTHER' | ''>('');
  const [zip, setZip] = useState(lead.zip || '');
  const [county, setCounty] = useState('');
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentFormat, setAppointmentFormat] = useState('');
  const [categories, setCategories] = useState<SoaCategoryCode[]>([]);
  const [ackNoObl, setAckNoObl] = useState(false);
  const [ackEsig, setAckEsig] = useState(false);
  const [signature, setSignature] = useState('');
  const [representativeAuthority, setRepresentativeAuthority] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Taken from the shared table so the client cannot drift from what the server
  // will accept as an election.
  const electionSource: LanguageSourceCode = representativeAuthority.trim()
    ? LANGUAGE_SOURCE.REPRESENTATIVE_ELECTED.code
    : LANGUAGE_SOURCE.BENEFICIARY_ELECTED.code;

  // AUDIT 2026-10-04 (SPEC-22) — the plan year was the literal 2027 in four
  // places in this file. After 1 October 2027 the form would have gone on
  // presenting, and submitting, a CY2027 document for CY2028 appointments. It is
  // read from the calendar once, and a year with no ruleset stops the form.
  const planYear = useMemo(() => activePlanYear(), []);
  const stateResolution = useMemo(
    () => (residenceState && residenceState !== 'OTHER' ? resolveStateRuleset(residenceState, planYear) : null),
    [residenceState, planYear],
  );
  const ruleset = stateResolution?.ok ? stateResolution.ruleset : null;
  const unsupported = residenceState === 'OTHER';
  const rulesUnavailable = !!stateResolution && !stateResolution.ok;
  const stateName = ruleset ? (L === 'es' ? ruleset.nameEs : ruleset.name) : '';

  const parts = useMemo(() => partitionSelection(categories), [categories]);
  const readBack = useMemo(() => readBackLines(categories, L), [categories, L]);
  const isInPerson = appointmentFormat === 'IN_PERSON';
  // G20 — the template prints a date/time entry. Shown read-only: the server
  // stamps the authoritative value, and a field the person could edit would be
  // a signature date they chose rather than the one that occurred.
  const signedAtDisplay = new Date().toLocaleString(L === 'es' ? 'es-US' : 'en-US');
  // G09/G24/G27 — values the SYSTEM assigns after signing. Labelled, never
  // blank and never invented.
  const systemGenerated = L === 'es' ? 'Generado por el sistema al firmar' : 'Generated by the system on signing';

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
      planYear,
      appointmentAt: appointmentDate,
      appointmentFormat,
      representativeRelationship: representativeAuthority.trim() || null,
      selectedCategories: categories,
      authorizedCategories: parts.authorized,
      declinedCategories: parts.declined,
      stateRulesetVersion: ruleset.stateRulesetVersion,
      soaFormVersion: ruleset.soaFormVersion,
      acknowledgements: { no_obligation: ackNoObl, e_signature: ackEsig },
      signature: signature.trim(),
      language: L,
      // The person reading this screen is the one who elected the language. If
      // they identified themselves as a representative, say so rather than
      // attributing the choice to the beneficiary.
      languageSource: electionSource,
    });
    setSubmitting(false);
  };

  // ── Header + the two blocks that appear on every step ──────────────────────
  const Header = (
    // The approved template keeps the organization, title and opening paragraph
    // in English in BOTH language versions; the attribute says so, so assistive
    // technology does not read English with Spanish pronunciation.
    <header lang={txt.intro === SOA_TEXT.en.intro ? 'en' : L} className="border-b border-cream-200 pb-6">
      <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-600 mb-2">{txt.org}</p>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-serif text-2xl sm:text-3xl text-earth-900 leading-snug focus:outline-none"
      >
        {stateName ? txt.title.replace('{state}', stateName) : txt.title.replace(' - {state}', '')}
      </h1>
      {/* Not rendered before the election: it is document text, and a disclosure
          shown before the person has chosen a language is the thing G08 removes. */}
      {elected !== null && <p className="text-earth-600 text-sm mt-3 leading-relaxed">{txt.intro}</p>}
    </header>
  );

  // Changing the document language is not a cosmetic switch. Whatever was
  // AFFIRMED — the two acknowledgements and the typed signature — was affirmed
  // against the text of the previous language, so it is withdrawn and has to be
  // given again against the new text (spec §9: the digital SOA never uses
  // prechecked boxes). The red team reached a Spanish review screen with both
  // boxes already ticked and the name already typed, one click from a record
  // saying the person agreed in Spanish. Answers that are merely FACTS (state,
  // ZIP, date, categories) are kept: the read-back step re-confirms them.
  const changeLanguage = () => {
    setAckNoObl(false);
    setAckEsig(false);
    setSignature('');
    setErrors({});
    setStep('form');
    setElected(null);
  };

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

  // ── Step 0: the language election ──────────────────────────────────────────
  // Rendered before any disclosure, because a disclosure read in a language the
  // person did not choose is not a disclosure. Both labels appear in their own
  // language and neither is preselected.
  if (elected === null) {
    return (
      <div className="space-y-8">
        {Header}
        <section aria-labelledby="soa-lang-heading" className="space-y-4">
          <h2 id="soa-lang-heading" className="text-sm font-bold text-earth-700 uppercase tracking-wide">
            Language / Idioma
          </h2>
          <p className="text-earth-600 text-sm leading-relaxed">
            {/* Worded to what the system actually does. The approved template keeps
                its title and opening paragraph in English in both versions, so
                "everything will be in your language" was a promise the Spanish
                document did not keep. */}
            <span lang="en">Choose the language for this document. The product categories, the statements you confirm and the signature section will be shown in the language you pick.</span>
            <br />
            <span lang="es">Elija el idioma de este documento. Las categorías de productos, las declaraciones que usted confirma y la sección de firma se mostrarán en el idioma que elija.</span>
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setElected('en')}
              lang="en"
              className="rounded-xl border-2 border-cream-300 hover:border-gold-500 bg-white px-5 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-gold-500"
            >
              <span className="block font-serif text-lg text-earth-900">English</span>
              <span className="block text-xs text-earth-600 mt-1">Continue in English</span>
            </button>
            <button
              type="button"
              onClick={() => setElected('es')}
              lang="es"
              className="rounded-xl border-2 border-cream-300 hover:border-gold-500 bg-white px-5 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-gold-500"
            >
              <span className="block font-serif text-lg text-earth-900">Español</span>
              <span className="block text-xs text-earth-600 mt-1">Continuar en español</span>
            </button>
          </div>
        </section>
      </div>
    );
  }

  const LangChange = (
    <button
      type="button"
      onClick={changeLanguage}
      className="inline-flex items-center min-h-[44px] px-3 text-sm font-medium text-earth-700 underline rounded-lg hover:bg-cream-50 focus:outline-none focus:ring-2 focus:ring-gold-500"
    >
      {UI.langChange[L]}
    </button>
  );

  // ── Step 2: read-back ──────────────────────────────────────────────────────
  if (step === 'review') {
    return (
      <form onSubmit={handleSign} method="post" action="#" noValidate lang={L} className="space-y-8">
        {Header}
        <div className="flex justify-end -mt-4">{LangChange}</div>
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
          <RoField label={txt.fields.planYear} value={String(planYear)} compact />
          <RoField
            label={txt.fields.language}
            value={(L === 'es' ? 'Español' : 'English') + (L === 'es' ? ' (elegido por usted)' : ' (elected by you)')}
            compact
          />
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

        {/* AUDIT 2026-10-02 (G18/G20/G21) — the approved template's signature
            block carries four entries, not one: the signature itself, the
            printed name as a DISTINCT entry, the date/time, and the electronic
            affirmation method. A single typed field was standing in for all of
            them, so the signed record could not show how the affirmation was
            made or when. Representative relationship is captured here too
            (G19/CE-03): the template allows a beneficiary OR an authorized
            representative to sign, and the record must say which. */}
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
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <RoField label={txt.fields.signedAt} value={signedAtDisplay} />
            <RoField
              label={txt.fields.affirmationMethod}
              value={L === 'es' ? 'Firma electrónica en la web' : 'Web electronic signature'}
            />
          </div>
          <div className="mt-4">
            <Field
              label={txt.fields.representativeAuthority}
              placeholder={L === 'es' ? '(deje en blanco si firma el beneficiario)' : '(leave blank if the beneficiary is signing)'}
              value={representativeAuthority}
              onChange={setRepresentativeAuthority}
              error={undefined}
              autoComplete="off"
            />
          </div>
        </section>

        {/* AUDIT 2026-10-02 (G09/G24/G27) — the approved template prints a
            labeled "System evidence — not customer-editable" block. It was
            missing entirely, so the person signed a document that did not show
            which form version or state ruleset governed it. The values that
            only exist after signing (instance id, integrity hash, evidence
            reference) are labeled as such rather than shown blank or invented. */}
        {ruleset && (
        <section aria-labelledby="soa-evidence" className="bg-cream-50 rounded-xl p-5 border border-cream-200">
          <h2 id="soa-evidence" className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">
            {L === 'es' ? 'Evidencia del sistema' : 'System evidence'}
          </h2>
          <p className="text-earth-600 text-xs mb-4">
            {L === 'es' ? 'No editable por el cliente' : 'Not customer-editable'}
          </p>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <EvidenceRow label="SOA_FORM_VERSION" value={ruleset.soaFormVersion} />
            <EvidenceRow label="STATE_RULESET_VERSION" value={ruleset.stateRulesetVersion} />
            <EvidenceRow label={txt.fields.language} value={L === 'es' ? 'ES' : 'EN'} />
            <EvidenceRow
              label={L === 'es' ? 'Elección de idioma' : 'Language election'}
              value={languageElectionLabel(electionSource, L)}
            />
            <EvidenceRow label={txt.fields.planYear} value={String(planYear)} />
            <EvidenceRow label="SOURCE" value="WEB" />
            <EvidenceRow label={txt.fields.soaInstanceId} value={systemGenerated} />
            <EvidenceRow label={L === 'es' ? 'Hash de integridad' : 'Integrity hash'} value={systemGenerated} />
            <EvidenceRow label={L === 'es' ? 'Referencia de evidencia' : 'Evidence reference'} value={systemGenerated} />
          </dl>
        </section>
        )}

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
    <form onSubmit={goToReview} method="post" action="#" noValidate lang={L} className="space-y-8">
      {Header}
      {/* Always reachable, including before a state is chosen: a mis-tap on the
          election screen must not trap someone in a language they cannot read. */}
      <div className="flex justify-end -mt-4">{LangChange}</div>
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
        {rulesUnavailable && (
          <p role="status" className="mt-4 text-earth-700 text-sm leading-relaxed bg-cream-50 border border-cream-200 rounded-lg p-4">
            {t('rulesUnavailable', L)}{AGENT.agencyPhone}
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

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-earth-600">{label}</dt>
      <dd className="text-earth-800 text-sm break-words">{value}</dd>
    </div>
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

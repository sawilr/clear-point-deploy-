// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — SOAForm component.
//
// Renders the CMS-required SOA fields, validates client-side, and calls
// the parent's onSubmit handler with the normalized payload.
//
// Bilingual (EN/ES) via tLabel + AGENT identity from soaContent.
// Enterprise-grade responsive: works on phones (touch-friendly), tablets,
// and desktop without horizontal scroll.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { AGENT, PRODUCT_OPTIONS, ACKNOWLEDGEMENTS, tLabel, tpmoDisclaimer, type SOAProduct } from '../lib/soaContent';

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

export function SOAForm({ language, lead, onSubmit }: SOAFormProps) {
  const L = language;
  const [dob, setDob] = useState('');
  const [address, setAddress] = useState('');
  const [products, setProducts] = useState<SOAProduct[]>([]);
  const [ackNoObl, setAckNoObl] = useState(false);
  const [ackEsig, setAckEsig] = useState(false);
  const [signature, setSignature] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const toggleProduct = (code: SOAProduct) => {
    setProducts(prev => prev.includes(code) ? prev.filter(p => p !== code) : [...prev, code]);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    // DOB validation — accept MM/DD/YYYY and convert to YYYY-MM-DD
    const dobMatch = dob.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dobMatch) e.dob = tLabel('validation_dob', L);
    if (products.length === 0) e.products = tLabel('validation_product', L);
    if (!ackNoObl || !ackEsig) e.acknowledgements = tLabel('validation_acknowledgement', L);
    const sigA = signature.trim().toLowerCase().replace(/\s+/g, ' ');
    const sigB = lead.fullName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!signature.trim()) e.signature = tLabel('validation_required', L);
    else if (sigA !== sigB) e.signature = tLabel('validation_signature_mismatch', L);
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      const firstErrorEl = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
      if (firstErrorEl) firstErrorEl.focus();
      return;
    }
    const dobMatch = dob.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dobMatch) return;
    const isoDob = `${dobMatch[3]}-${dobMatch[1].padStart(2, '0')}-${dobMatch[2].padStart(2, '0')}`;
    setSubmitting(true);
    await onSubmit({
      fullName: lead.fullName,
      dob: isoDob,
      phone: lead.phone,
      email: lead.email,
      zip: lead.zip,
      address: address.trim(),
      products: products,
      acknowledgements: { no_obligation: ackNoObl, e_signature: ackEsig },
      signature: signature.trim(),
      language: L,
    });
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      <header className="border-b border-cream-200 pb-6">
        <p className="text-[11px] font-bold tracking-[0.2em] uppercase text-gold-600 mb-2">ClearPoint Senior Advisors</p>
        <h1 className="font-serif text-2xl sm:text-3xl text-earth-900 leading-snug">{tLabel('title', L)}</h1>
      </header>

      {/* TPMO Disclaimer — verbatim CMS */}
      <section className="bg-cream-50 rounded-xl p-5 border border-cream-200">
        <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-2">{tLabel('tpmo_heading', L)}</h2>
        <p className="text-earth-600 text-sm leading-relaxed">{tpmoDisclaimer(L)}</p>
      </section>

      {/* Beneficiary Info — read-only fields from lead capture */}
      <section>
        <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-4">{tLabel('beneficiary_heading', L)}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <RoField label={tLabel('field_full_name', L)} value={lead.fullName} />
          <Field
            label={tLabel('field_dob', L)}
            placeholder="MM/DD/YYYY"
            value={dob}
            onChange={setDob}
            error={errors.dob}
            required
            inputMode="numeric"
            autoComplete="bday"
          />
          <RoField label={tLabel('field_phone', L)} value={lead.phone} />
          <RoField label={tLabel('field_email', L)} value={lead.email || '—'} />
          <RoField label={tLabel('field_zip', L)} value={lead.zip} />
          <Field
            label={tLabel('field_address', L)}
            placeholder=""
            value={address}
            onChange={setAddress}
            error={undefined}
            autoComplete="street-address"
          />
        </div>
      </section>

      {/* Product scope */}
      <section>
        <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">{tLabel('product_heading', L)}</h2>
        <p className="text-earth-700 text-sm mb-3">{tLabel('product_help', L)}</p>
        <div className="space-y-2">
          {PRODUCT_OPTIONS.map(opt => (
            <label key={opt.code} className="flex items-start gap-3 p-3 rounded-lg border border-cream-200 hover:bg-cream-50 cursor-pointer min-h-[56px]">
              <input
                type="checkbox"
                className="mt-1 w-5 h-5 accent-gold-500"
                checked={products.includes(opt.code)}
                onChange={() => toggleProduct(opt.code)}
              />
              <span className="text-earth-700 text-sm leading-relaxed">{L === 'es' ? opt.es : opt.en}</span>
            </label>
          ))}
        </div>
        {errors.products && <p role="alert" className="text-sm text-red-600 mt-2">{errors.products}</p>}
      </section>

      {/* Acknowledgements */}
      <section>
        <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-3">{tLabel('acknowledgement_heading', L)}</h2>
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

      {/* Signature */}
      <section>
        <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-1">{tLabel('signature_heading', L)}</h2>
        <p className="text-earth-700 text-sm mb-3">{tLabel('signature_help', L)}</p>
        <Field
          label={tLabel('field_signature', L)}
          placeholder={lead.fullName}
          value={signature}
          onChange={setSignature}
          error={errors.signature}
          required
          autoComplete="off"
          big
        />
      </section>

      {/* Agent */}
      <section className="bg-cream-50 rounded-xl p-5 border border-cream-200">
        <h2 className="text-sm font-bold text-earth-700 uppercase tracking-wide mb-3">{tLabel('agent_heading', L)}</h2>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <RoField label={L === 'es' ? 'Agente' : 'Agent'} value={AGENT.name} compact />
          <RoField label="NPN" value={AGENT.npn} compact />
          <RoField label={L === 'es' ? 'Agencia' : 'Agency'} value={AGENT.agency} compact />
          <RoField label={L === 'es' ? 'Teléfono' : 'Phone'} value={AGENT.agencyPhone} compact />
        </div>
      </section>

      {/* Submit */}
      <div className="pt-4">
        <button
          type="submit"
          disabled={submitting}
          className="w-full sm:w-auto px-8 py-4 bg-gold-500 text-white font-bold rounded-full hover:bg-gold-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors min-h-[52px]"
        >
          {submitting ? tLabel('signing', L) : tLabel('submit', L)}
        </button>
      </div>
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
}

function Field({ label, value, onChange, placeholder, error, required, inputMode, autoComplete, big }: FieldProps) {
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

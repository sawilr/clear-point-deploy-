// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — SOA types, validation, and lead-side helpers.
//
// Pure module — no React, no fetch. Safe to import from server (api/*)
// and from client (src/components/*).
// ─────────────────────────────────────────────────────────────────────────────

import type { SOAProduct } from './soaContent.ts';

/** Captured by SOAForm and sent to /api/sign-soa */
export interface SOASigningPayload {
  /** Signing token (UUID) — issued by /api/soa-token, single-use. */
  token: string;
  /** Beneficiary full legal name (must match the lead's captured name). */
  fullName: string;
  /** YYYY-MM-DD. */
  dob: string;
  /** Phone, E.164 (+1XXXXXXXXXX) or 10-digit national. */
  phone: string;
  /** Email — optional. */
  email?: string;
  /** US 5-digit ZIP. */
  zip: string;
  /** Optional street address. */
  address?: string;
  /** Product checkboxes — at least 1. */
  products: SOAProduct[];
  /** Both must be true to submit. */
  acknowledgements: {
    no_obligation: boolean;
    e_signature: boolean;
  };
  /** Typed signature — must equal fullName (case/whitespace-insensitive). */
  signature: string;
  /** 'en' | 'es' — language of the rendered form. */
  language: 'en' | 'es';
  /** Lead-source bot — for GHL tagging. */
  leadSource: 'customer_service' | 'smart_review';
}

/** Result envelope returned by /api/sign-soa to the client. */
export interface SOASigningResult {
  ok: boolean;
  error?: string;
  /** Server-issued audit ID for this signed SOA. */
  soaId?: string;
  /** ISO 8601 UTC timestamp the server recorded. */
  signedAt?: string;
  /** SHA-256 hex digest of the rendered PDF — proof of document integrity. */
  pdfHash?: string;
}

/** Server-side full record (logged + sent to GHL). NEVER serialized to client. */
export interface SOAFullRecord extends SOASigningPayload {
  soaId: string;
  signedAt: string;
  signerIp: string;
  signerUserAgent: string;
  pdfHash: string;
  /** Anthropic-style structured note delivered to GHL. */
  ghlNote: string;
  /** TPMO disclaimer version that the user signed. */
  tpmoVersion: string;
  /** Agent at time of signing. */
  agentName: string;
  agentNpn: string;
}

/** Validation result. */
export interface SOAValidation {
  ok: boolean;
  errors: Record<string, string>;
}

/**
 * Pure validation — no side effects. Returns per-field error keys (untranslated)
 * so the form can show localized text via tLabel('validation_*', lang).
 */
export function validateSOA(payload: Partial<SOASigningPayload>, expectedName: string): SOAValidation {
  const errors: Record<string, string> = {};

  if (!payload.token || typeof payload.token !== 'string') errors.token = 'required';
  if (!payload.fullName || payload.fullName.trim().length < 2) errors.fullName = 'required';
  if (!payload.dob || !/^\d{4}-\d{2}-\d{2}$/.test(payload.dob)) errors.dob = 'invalid_dob';
  if (!payload.phone || !/^(\+1)?\d{10}$/.test(String(payload.phone).replace(/[\s\-().]/g, ''))) errors.phone = 'invalid_phone';
  if (!payload.zip || !/^\d{5}$/.test(payload.zip)) errors.zip = 'invalid_zip';
  if (!Array.isArray(payload.products) || payload.products.length === 0) errors.products = 'product_required';
  if (!payload.acknowledgements || !payload.acknowledgements.no_obligation || !payload.acknowledgements.e_signature) {
    errors.acknowledgements = 'acknowledgement_required';
  }
  if (!payload.signature || typeof payload.signature !== 'string') {
    errors.signature = 'required';
  } else if (expectedName) {
    // Signature must match the lead-captured fullName (case-insensitive,
    // whitespace-collapsed). This is the v1 of identity verification.
    const a = payload.signature.trim().toLowerCase().replace(/\s+/g, ' ');
    const b = expectedName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (a !== b) errors.signature = 'signature_mismatch';
  }
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errors.email = 'invalid_email';
  if (!payload.language || (payload.language !== 'en' && payload.language !== 'es')) errors.language = 'required';
  if (payload.leadSource !== 'customer_service' && payload.leadSource !== 'smart_review') errors.leadSource = 'invalid_source';

  return { ok: Object.keys(errors).length === 0, errors };
}

/** Build the structured GHL note from a signed SOA record. */
export function ghlNoteFromSOA(rec: SOAFullRecord): string {
  return [
    `[SOA SIGNED — ClearPoint Senior Advisors]`,
    `soa_id: ${rec.soaId}`,
    `signed_at: ${rec.signedAt}`,
    `signer_full_name: ${rec.fullName}`,
    `signer_dob: ${rec.dob}`,
    `signer_phone: ${rec.phone}`,
    `signer_email: ${rec.email || '(skipped)'}`,
    `signer_zip: ${rec.zip}`,
    `signer_address: ${rec.address || '(not provided)'}`,
    `signer_ip: ${rec.signerIp}`,
    `signer_user_agent: ${(rec.signerUserAgent || '').slice(0, 120)}`,
    `language: ${rec.language}`,
    `product_scope: ${rec.products.join(', ')}`,
    `consent_no_obligation: ${rec.acknowledgements.no_obligation}`,
    `consent_esign_act: ${rec.acknowledgements.e_signature}`,
    `tpmo_disclaimer_version: ${rec.tpmoVersion}`,
    `pdf_sha256: ${rec.pdfHash}`,
    `agent_name: ${rec.agentName}`,
    `agent_npn: ${rec.agentNpn}`,
    `lead_source: ${rec.leadSource}`,
  ].join('\n');
}

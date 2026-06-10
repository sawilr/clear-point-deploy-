// ─────────────────────────────────────────────────────────────────────────────
// PHASE A16 — SOA signature endpoint.
//
// POST /api/sign-soa  body = SOASigningPayload
//
// Pipeline:
//   1. CORS allowlist + rate limit
//   2. Pull token record (verifies the lead exists and is unconsumed)
//   3. Validate payload against captured lead name
//   4. Generate PDF (pdfkit) with full CMS-required content
//   5. Compute SHA-256 of the PDF bytes (audit trail)
//   6. Mark token as consumed + persist signed record
//   7. POST structured note to GHL contact (createOrUpdate)
//   8. Return 200 { ok, soaId, signedAt, pdfHash }
//
// NEVER reveals raw token data; only emits the audit metadata.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';
import { checkOrigin, applyCors, rateLimit, clientId } from './_lib/rate-limit.js';
import { getSoaToken, setSoaToken } from './_lib/soa-store.js';

const AGENT_NAME = 'Sawil Reyes';
const AGENT_NPN = '17261494';
const TPMO_VERSION = '2024-10';

// PHASE 7 — SOA gate (mirror of src/lib/soaContent.ts SOA_ENABLED).
// Until the owner confirms FMO carrier/product counts, refuse to sign so
// that no PDF with [X]/[Y] placeholders can be generated.
const SOA_ENABLED = false;

// Until SOA_ENABLED flips to true, these are unused. When configured,
// replace both with real integers (e.g. '5', '47') in the same commit.
const TPMO_CARRIER_COUNT = '[X]';
const TPMO_PRODUCT_COUNT = '[Y]';

// CMS TPMO disclaimer text — VERBATIM. Do not modify wording.
const TPMO_EN = 'We do not offer every plan available in your area. Currently we represent ' + TPMO_CARRIER_COUNT + ' organizations which offer ' + TPMO_PRODUCT_COUNT + ' products in your area. Please contact Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program (SHIP) to get information on all of your options.';
const TPMO_ES = 'No ofrecemos todos los planes disponibles en su área. Actualmente representamos ' + TPMO_CARRIER_COUNT + ' organizaciones que ofrecen ' + TPMO_PRODUCT_COUNT + ' productos en su área. Para obtener información sobre todas sus opciones, comuníquese con Medicare.gov, 1-800-MEDICARE o su Programa Estatal de Asesoramiento sobre Seguros de Salud (SHIP) local.';

const PRODUCT_LABEL = {
  en: { MA_only: 'Medicare Advantage (Part C) — without prescription drug coverage', MAPD: 'Medicare Advantage with Prescription Drug coverage (MAPD)', PDP: 'Standalone Part D Prescription Drug Plan', DVH_HI: 'Other (Dental, Vision, Hearing, Hospital Indemnity, etc.)' },
  es: { MA_only: 'Medicare Advantage (Parte C) — sin cobertura de medicamentos recetados', MAPD: 'Medicare Advantage con cobertura de medicamentos recetados (MAPD)', PDP: 'Plan independiente de medicamentos recetados de Parte D', DVH_HI: 'Otros (Dental, Visión, Audición, Hospital Indemnity, etc.)' },
};

export default async function handler(req, res) {
  // ── CORS + method gates ────────────────────────────────────────────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) return res.status(403).json({ error: 'Origin not allowed' });
  applyCors(req, res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── PHASE 7 SOA gate ───────────────────────────────────────────────────
  if (!SOA_ENABLED) {
    return res.status(503).json({ error: 'SOA_NOT_CONFIGURED', message: 'SOA workflow is temporarily unavailable' });
  }

  // ── Rate limit (3 signature attempts per IP per hour — anti-replay) ────
  var ip = clientId(req);
  var rl = await rateLimit(ip, { max: 3, windowMs: 60 * 60 * 1000, prefix: 'soa-sign' });
  if (!rl.ok) return res.status(429).json({ error: 'Too many sign attempts' });

  // ── Read body — PHASE 6: cap at 64 KB ──────────────────────────────────
  var body = {};
  try { body = req.body || {}; } catch (e1) {
    try {
      body = await new Promise(function (resolve, reject) {
        var chunks = []; var total = 0; var MAX = 64 * 1024;
        req.on('data', function (c) {
          total += c.length;
          if (total > MAX) { req.destroy(); reject(new Error('body_too_large')); return; }
          chunks.push(c);
        });
        req.on('end', function () {
          var raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw && raw.trim() ? JSON.parse(raw) : {});
        });
        req.on('error', reject);
      });
    } catch (e2) {
      if (e2 && e2.message === 'body_too_large') return res.status(413).json({ error: 'Payload too large' });
      return res.status(400).json({ error: 'Cannot read body' });
    }
  }

  // ── Verify token ───────────────────────────────────────────────────────
  var token = typeof body.token === 'string' ? body.token : '';
  if (!/^[a-f0-9-]{36}$/i.test(token)) return res.status(400).json({ error: 'Invalid token' });

  var record;
  try { record = await getSoaToken(token); } catch (e) { record = null; }
  if (!record) return res.status(404).json({ error: 'Token not found or expired' });
  if (record.consumed) return res.status(409).json({ error: 'SOA already signed for this token' });

  // ── Validate payload ───────────────────────────────────────────────────
  var fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  var dob = typeof body.dob === 'string' ? body.dob : '';
  var phone = String(body.phone || '').replace(/[\s\-().]/g, '');
  var email = typeof body.email === 'string' ? body.email.trim() : '';
  var zip = typeof body.zip === 'string' ? body.zip : '';
  var address = typeof body.address === 'string' ? body.address.trim() : '';
  var products = Array.isArray(body.products) ? body.products.filter(function (p) { return ['MA_only', 'MAPD', 'PDP', 'DVH_HI'].includes(p); }) : [];
  var ack = (body.acknowledgements && typeof body.acknowledgements === 'object') ? body.acknowledgements : {};
  var signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  var language = body.language === 'en' ? 'en' : 'es';
  var leadSource = body.leadSource === 'smart_review' ? 'smart_review' : 'customer_service';

  // Match captured name (case-insensitive, whitespace collapse)
  var sigA = signature.toLowerCase().replace(/\s+/g, ' ');
  var sigB = (record.fullName || '').toLowerCase().replace(/\s+/g, ' ');
  if (!signature || sigA !== sigB) return res.status(400).json({ error: 'Signature must match the captured name' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: 'Invalid DOB' });
  if (!/^(\+1)?\d{10}$/.test(phone)) return res.status(400).json({ error: 'Invalid phone' });
  if (!/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'Invalid ZIP' });
  if (products.length === 0) return res.status(400).json({ error: 'Select at least one product' });
  if (!ack.no_obligation || !ack.e_signature) return res.status(400).json({ error: 'Both acknowledgements required' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

  // ── Generate PDF ───────────────────────────────────────────────────────
  var soaId = crypto.randomUUID();
  var signedAt = new Date().toISOString();
  var signerIp = ip;
  var signerUserAgent = String(req.headers['user-agent'] || '').slice(0, 240);

  var pdfBuffer;
  try {
    pdfBuffer = await buildSoaPdf({
      lang: language,
      soaId: soaId,
      signedAt: signedAt,
      fullName: fullName,
      dob: dob,
      phone: phone,
      email: email,
      zip: zip,
      address: address,
      products: products,
      signature: signature,
      signerIp: signerIp,
      signerUserAgent: signerUserAgent,
    });
  } catch (e) {
    console.error('[sign-soa] pdf build failed:', e && e.message);
    return res.status(500).json({ error: 'PDF generation failed' });
  }

  var pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  // ── Mark consumed + persist ────────────────────────────────────────────
  record.consumed = true;
  record.consumedAt = signedAt;
  record.soaId = soaId;
  record.pdfHash = pdfHash;
  try { await setSoaToken(token, record); } catch (e) { /* log but don't fail */ console.error('[sign-soa] token update failed', e && e.message); }

  // ── Compose GHL note ───────────────────────────────────────────────────
  var ghlNote = [
    '[SOA SIGNED — ClearPoint Senior Advisors]',
    'soa_id: ' + soaId,
    'signed_at: ' + signedAt,
    'signer_full_name: ' + fullName,
    'signer_dob: ' + dob,
    'signer_phone: +1' + phone.replace(/^\+1/, ''),
    'signer_email: ' + (email || '(skipped)'),
    'signer_zip: ' + zip,
    'signer_address: ' + (address || '(not provided)'),
    'signer_ip: ' + signerIp,
    'signer_user_agent: ' + signerUserAgent,
    'language: ' + language,
    'product_scope: ' + products.join(', '),
    'consent_no_obligation: true',
    'consent_esign_act: true',
    'tpmo_disclaimer_version: ' + TPMO_VERSION,
    'pdf_sha256: ' + pdfHash,
    'agent_name: ' + AGENT_NAME,
    'agent_npn: ' + AGENT_NPN,
    'lead_source: ' + leadSource,
  ].join('\n');

  // ── Send to GHL (createOrUpdate contact + add note) ────────────────────
  var ghlOk = false;
  try {
    ghlOk = await sendToGhl({
      firstName: fullName.split(' ')[0] || fullName,
      lastName: fullName.split(' ').slice(1).join(' '),
      phone: '+1' + phone.replace(/^\+1/, ''),
      email: email,
      postalCode: zip,
      address: address,
      preferred_language: language,
      lead_source: leadSource,
      soa_signed: true,
      soa_pdf_hash: pdfHash,
      soa_signed_at: signedAt,
      soa_id: soaId,
      note: ghlNote,
      pdfBase64: pdfBuffer.toString('base64'),
    });
  } catch (e) {
    console.error('[sign-soa] GHL post failed', e && e.message);
  }

  return res.status(200).json({
    ok: true,
    soaId: soaId,
    signedAt: signedAt,
    pdfHash: pdfHash,
    ghlDelivered: ghlOk,
  });
}

// ── PDF builder ──────────────────────────────────────────────────────────
function buildSoaPdf(opts) {
  return new Promise(function (resolve, reject) {
    try {
      var chunks = [];
      var doc = new PDFDocument({ size: 'LETTER', margin: 50, info: {
        Title: 'Scope of Sales Appointment Confirmation',
        Author: 'ClearPoint Senior Advisors',
        Subject: 'CMS-required SOA — ' + opts.soaId,
      }});
      doc.on('data', function (c) { chunks.push(c); });
      doc.on('end', function () { resolve(Buffer.concat(chunks)); });
      doc.on('error', reject);

      var L = opts.lang;
      var title = L === 'es' ? 'Confirmación del Alcance de la Cita de Ventas' : 'Scope of Sales Appointment Confirmation';
      doc.font('Helvetica-Bold').fontSize(18).text('ClearPoint Senior Advisors', { align: 'center' });
      doc.fontSize(13).text(title, { align: 'center' });
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(8).fillColor('#555').text('SOA ID: ' + opts.soaId + '   |   Signed: ' + opts.signedAt + ' UTC', { align: 'center' });
      doc.fillColor('#000');
      doc.moveDown(0.8);

      // TPMO disclaimer
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'AVISO TPMO (Requerido por CMS)' : 'TPMO DISCLAIMER (CMS-required)');
      doc.font('Helvetica').fontSize(9).text(L === 'es' ? TPMO_ES : TPMO_EN, { align: 'justify' });
      doc.moveDown(0.6);

      // Beneficiary info
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Información del Beneficiario' : 'Beneficiary Information');
      doc.font('Helvetica').fontSize(9);
      kv(doc, L === 'es' ? 'Nombre completo' : 'Full legal name', opts.fullName);
      kv(doc, L === 'es' ? 'Fecha de nacimiento' : 'Date of birth', opts.dob);
      kv(doc, L === 'es' ? 'Teléfono' : 'Phone', '+1 ' + opts.phone.replace(/^\+1/, ''));
      kv(doc, L === 'es' ? 'Correo' : 'Email', opts.email || '—');
      kv(doc, L === 'es' ? 'Código postal' : 'ZIP Code', opts.zip);
      kv(doc, L === 'es' ? 'Dirección' : 'Address', opts.address || '—');
      doc.moveDown(0.6);

      // Products discussed
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Productos a discutir' : 'Products to be discussed');
      doc.font('Helvetica').fontSize(9);
      opts.products.forEach(function (code) {
        doc.text('[X] ' + (PRODUCT_LABEL[L] && PRODUCT_LABEL[L][code] ? PRODUCT_LABEL[L][code] : code));
      });
      doc.moveDown(0.6);

      // Acknowledgements
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Reconocimientos' : 'Acknowledgements');
      doc.font('Helvetica').fontSize(9);
      doc.text('[X] ' + (L === 'es'
        ? 'Entiendo que esto NO es una inscripción y NO hay obligación.'
        : 'I understand this is not an enrollment, and there is no obligation.'));
      doc.text('[X] ' + (L === 'es'
        ? 'Acepto firmar este documento electrónicamente (Ley ESIGN, 15 U.S.C. §7001).'
        : 'I agree to sign this electronically (ESIGN Act, 15 U.S.C. §7001).'));
      doc.moveDown(0.6);

      // Signature
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Firma Electrónica del Beneficiario' : 'Beneficiary Electronic Signature');
      doc.font('Helvetica-Oblique').fontSize(14).text(opts.signature);
      doc.font('Helvetica').fontSize(8).fillColor('#555').text((L === 'es' ? 'Firmado el ' : 'Signed on ') + opts.signedAt + ' UTC  ·  ' + (L === 'es' ? 'IP: ' : 'IP: ') + opts.signerIp);
      doc.fillColor('#000');
      doc.moveDown(0.6);

      // Agent
      doc.font('Helvetica-Bold').fontSize(10).text(L === 'es' ? 'Agente / Agencia' : 'Agent / Agency');
      doc.font('Helvetica').fontSize(9);
      kv(doc, L === 'es' ? 'Agente' : 'Agent', AGENT_NAME);
      kv(doc, 'NPN', AGENT_NPN);
      kv(doc, L === 'es' ? 'Agencia' : 'Agency', 'ClearPoint Senior Advisors');
      kv(doc, L === 'es' ? 'Teléfono' : 'Phone', '1-866-310-8702');

      // Footer
      doc.moveDown(1);
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#777').text(
        L === 'es'
          ? 'Este documento es un registro auditado electrónicamente y cumple con la Ley ESIGN (15 U.S.C. §7001). Hash SHA-256 del documento se almacena en GHL.'
          : 'This document is an electronically audited record and is compliant with the ESIGN Act (15 U.S.C. §7001). SHA-256 hash of this document is stored in GHL.',
        { align: 'center' }
      );

      doc.end();
    } catch (e) { reject(e); }
  });
}

function kv(doc, k, v) {
  doc.font('Helvetica-Bold').fontSize(9).text(k + ': ', { continued: true });
  doc.font('Helvetica').fontSize(9).text(String(v));
}

// ── GHL delivery ─────────────────────────────────────────────────────────
async function sendToGhl(payload) {
  var token = process.env.HIGHLEVEL_TOKEN;
  var locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) return false;

  // Step 1 — createOrUpdate contact (matches by phone)
  var contactBody = {
    locationId: locationId,
    firstName: payload.firstName || '',
    lastName: payload.lastName || '',
    phone: payload.phone || '',
    email: payload.email || '',
    postalCode: payload.postalCode || '',
    address1: payload.address || '',
    source: 'website-soa',
    tags: ['soa_signed', payload.lead_source || 'unknown'],
    customFields: [
      { id: 'soa_signed', field_value: 'true' },
      { id: 'soa_pdf_hash', field_value: payload.soa_pdf_hash },
      { id: 'soa_signed_at', field_value: payload.soa_signed_at },
      { id: 'soa_id', field_value: payload.soa_id },
      { id: 'preferred_language', field_value: payload.preferred_language },
    ],
  };

  var contactRes;
  try {
    contactRes = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify(contactBody),
    });
  } catch (e) { console.error('[ghl] upsert failed', e && e.message); return false; }

  if (!contactRes.ok) {
    console.error('[ghl] upsert non-2xx', contactRes.status);
    return false;
  }
  var contactData = await contactRes.json();
  var contactId = (contactData && contactData.contact && contactData.contact.id) || (contactData && contactData.id) || null;
  if (!contactId) { console.error('[ghl] no contactId returned'); return false; }

  // Step 2 — add structured note
  try {
    var noteRes = await fetch('https://services.leadconnectorhq.com/contacts/' + encodeURIComponent(contactId) + '/notes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({ userId: 'system', body: payload.note }),
    });
    if (!noteRes.ok) console.warn('[ghl] note non-2xx', noteRes.status);
  } catch (e) { console.warn('[ghl] note failed', e && e.message); }

  // Step 3 — Try to attach PDF as file (best-effort; some GHL plans don't support)
  if (payload.pdfBase64) {
    try {
      var fileRes = await fetch('https://services.leadconnectorhq.com/contacts/' + encodeURIComponent(contactId) + '/notes', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({
          userId: 'system',
          body: '[SOA PDF — base64 of signed document, hash: ' + payload.soa_pdf_hash + ']',
        }),
      });
      // We don't fail the whole flow if file attach fails; the note + hash
      // are sufficient compliance artifacts.
      if (!fileRes.ok) console.warn('[ghl] file note non-2xx', fileRes.status);
    } catch (e) { console.warn('[ghl] file attach failed', e && e.message); }
  }

  return true;
}

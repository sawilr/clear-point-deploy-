// ─────────────────────────────────────────────────────────────────────────────
// AUDIT 2026-08-13 (O-01, P1) — CRM-side contact suppression.
//
// THE DEFECT THIS CLOSES: the web opt-out guard (src/lib/optOutGuard.ts) only
// wrote sessionStorage. A person who had already submitted a lead — so a CRM
// contact existed with consent_marketing / consent_sms / consent_calls all
// "true" and an open opportunity — could type "STOP / no me llamen" on the site,
// receive a correct acknowledgment, and still be reachable by the next campaign.
// The acknowledgment was honest about intent and wrong about effect.
//
// DESIGN NOTES
// • This is a SUPPRESSION-ONLY endpoint. It can set DND and clear consent flags.
//   It can NEVER create a contact, grant consent, or re-enable contact. That
//   asymmetry is deliberate: a forged request can only ever reduce our
//   permission to contact someone, so it is safe to accept without auth.
// • Every outcome returns ONE uniform 200 body { ok:true, received:true } so the
//   endpoint can never be a phone/email membership oracle (OPTOUT-01, 2026-08-18).
//   The true outcome (matched/applied/failed) lives only in PII-free server logs.
// • The CLIENT already recorded the session opt-out locally and does not read
//   this response body (optOutGuard.propagateOptOutToCrm fires and forgets), so
//   the uniform body breaks no UX; suppression is best-effort by design.
// • The platform's own inbound-SMS STOP keyword remains a separate, independent
//   suppression path. This covers web-chat revocations, which that never saw.
//
// TCPA/CMS POSTURE: revocation must be honored promptly and through any
// reasonable channel the consumer chooses (47 CFR 64.1200 revocation
// principles). A chat message is such a channel; see the ledger entry O-01.
// ─────────────────────────────────────────────────────────────────────────────

import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';
import { noStorePII } from './_lib/security-headers.js';
import { enforceKill } from './_lib/kill-switch.js';
// AUDIT 2026-08-15 (red-team F4) — shared JSON body reader: applies the same
// bounded size cap every other endpoint uses (this one read req.body directly,
// relying on the platform default ~4.5MB) and answers malformed JSON with 400.
import { readJsonBody } from './_lib/read-body.js';
// AUDIT 2026-10-02 (CE-09 / CRM-15) — the callback consent is now a queryable
// CRM value on the grant side (api/submit-lead.js), so its revocation is too.
//
// RED TEAM 2026-10-04 — this handler called the field mapping directly and so
// had none of the rules the grant side has (all-or-none, an instant that is in
// force is never moved, a transient failure is not a reason to drop a field).
// Every one of those decisions now lives in callback-consent.js as a function
// that the suite calls; what is left here is the I/O.
import {
  recordCallbackRevocation, callbackConsentStateOf, callbackRevocationNoteLine, crmRefusalStep,
  CALLBACK_REVOCATION_UNAVAILABLE, CALLBACK_REVOCATION_MODE,
} from './_lib/cy2027/callback-consent.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

/** Digits-only U.S. 10-digit extraction. Returns '' when not a plausible NANP. */
function tenDigits(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length === 10 ? d : '';
}

// ── AUDIT 2026-08-18 (OPTOUT-01, P1) — MEMBERSHIP-ENUMERATION ORACLE ──────────
// The prior code returned crmApplied:true / reason:'suppressed' when a contact
// MATCHED and crmApplied:false / reason:'no_match' when it did NOT — a trivial
// oracle: an unauthenticated POST could learn whether any phone/email is a
// ClearPoint contact by reading the body. (The old line-122 comment claimed
// "No oracle: identical shape" but only the no-match branch was uniform; the
// match branch leaked success.) The legitimate client — optOutGuard.ts
// propagateOptOutToCrm — fires `void fetch(...).catch(()=>{})` and NEVER reads
// the body, so collapsing every outcome to ONE indistinguishable response
// breaks nothing while removing the oracle. All suppression work and PII-free
// ops logging still happen server-side; only the client-visible signal is
// equalized. Structural rejections (403 origin / 405 method / 400-413 body /
// 429 rate) are membership-independent and stay as-is.
//
// RESIDUAL (LOW, documented): a timing side-channel remains — the match path
// does one extra PUT + note POST. Over the internet this needs many samples per
// target and is bounded by the endpoint's rate limit; it becomes fully
// impractical once the rate limiter is KV-backed (see RL-08). Not a practical
// oracle on its own.
function ack(res) {
  // ONE uniform acknowledgement for every membership-dependent outcome.
  return res.status(200).json({ ok: true, received: true });
}

export default async function handler(req, res) {
  const allowedOrigin = checkOrigin(req);
    // AUDIT 2026-09-14 (SEC-10) — never let a rejection be cached
  if (!allowedOrigin) { noStorePII(res); return res.status(403).json({ error: 'Origin not allowed' }); }
  applyCors(req, res, allowedOrigin);
  noStorePII(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // AUDIT 2026-08-13 (§12) — present for completeness, but note the asymmetry:
  // killing THIS endpoint stops us HONORING revocations, which is the opposite of
  // safe. It exists only for a scenario where the endpoint itself is being abused,
  // and the refusal copy still routes the caller to a human who can record it.
  if (enforceKill(res, 'optout', 'en')) return;

  const ip = clientId(req);
  // Deliberately generous: a person hammering "stop" must never be rate-limited
  // out of being suppressed. This bound exists only to stop bulk enumeration.
  const rl = await rateLimit(ip, { max: 20, windowMs: 60 * 60 * 1000, prefix: 'optout-h' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfterSec || 3600));
    return res.status(429).json({ error: 'Too many requests' });
  }

  // AUDIT 2026-08-15 — shared reader (8 KB cap): handles the malformed-JSON
  // throw (→ 400) and oversize bodies (→ 413) uniformly; returns null after
  // sending its own response.
  const body = await readJsonBody(req, res, { maxBytes: 8 * 1024 });
  if (body === null) return;

  const phone10 = tenDigits(body.phone);
  const email = typeof body.email === 'string' && body.email.includes('@')
    ? body.email.trim().slice(0, 120) : '';
  // Category only — never the raw message. Mirrors optOutGuard's evidence enum.
  const evidence = typeof body.evidence === 'string'
    ? body.evidence.replace(/[^a-z_]/gi, '').slice(0, 40) : 'chat_optout';
  const channels = body.channels && typeof body.channels === 'object' ? body.channels : {};
  const blockEmail = channels.email !== 'ALLOWED'; // default: block everything

  if (!phone10 && !email) {
    // AUDIT 2026-08-27 (finding #1) — a request with NO valid phone/email cannot
    // suppress anyone, yet this used to answer the uniform success ack, giving
    // false certainty of revocation. Reject with 400. This is a pure INPUT
    // validation rejection — it depends only on the request shape, never on CRM
    // membership — so it does NOT reintroduce the OPTOUT-01 enumeration oracle:
    // a valid-format phone/email that simply is not in the CRM still gets the
    // uniform 200 ack below. The legitimate client fires-and-forgets and never
    // reads this body, so no real UX regresses.
    console.warn('[OPTOUT] rejected: no valid phone or email supplied');
    return res.status(400).json({ error: 'A valid phone or email is required to process an opt-out.' });
  }

  const token = process.env.HIGHLEVEL_TOKEN;
  const locationId = process.env.HIGHLEVEL_LOCATION_ID;
  if (!token || !locationId) {
    console.error('[OPTOUT] CRM not configured — suppression NOT applied');
    return ack(res);
  }
  const H = {
    Authorization: 'Bearer ' + token,
    Version: GHL_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  try {
    // ── 1. Find the contact. Query by phone first, then email. ──────────────
    const query = phone10 || email;
    const searchUrl = `${GHL_BASE}/contacts/?locationId=${encodeURIComponent(locationId)}`
      + `&limit=5&query=${encodeURIComponent(query)}`;
    const sres = await fetch(searchUrl, { headers: H });
    if (!sres.ok) {
      console.error('[OPTOUT] contact search failed status=' + sres.status);
      return ack(res);
    }
    const sjson = await sres.json();
    const candidates = Array.isArray(sjson.contacts) ? sjson.contacts : [];
    const match = candidates.find((c) => {
      if (phone10 && tenDigits(c.phone) === phone10) return true;
      if (email && String(c.email || '').toLowerCase() === email.toLowerCase()) return true;
      return false;
    });
    if (!match || !match.id) {
      // Uniform ack (OPTOUT-01): identical to the match path below.
      console.warn('[OPTOUT] no CRM match for supplied identifier');
      return ack(res);
    }

    // ── 2. Apply suppression. DND plus per-channel DND, plus consent flags. ──
    // AUDIT 2026-10-02 (CE-09 / CRM-15) — CALLBACK_CONSENT_STATUS=REVOKED and
    // CALLBACK_CONSENT_AT, through the same mapping the grant uses. Without this
    // a contact would read CALLBACK_CONSENT_STATUS=GRANTED beside a DND flag.
    // Calls are blocked on every path through this endpoint (the email channel is
    // the only one a consumer can leave open), so the callback permission is
    // revoked on every path. The SCOPE is not rewritten: this endpoint never sees
    // the consent it revokes (see callbackRevocationToFields).
    // Built in its own try so that nothing here can stand between a person and
    // their suppression.
    //
    // RED TEAM 2026-10-04 — three defects in what used to be one line here:
    //   • every repeat opt-out (the endpoint is unauthenticated) overwrote
    //     CALLBACK_CONSENT_AT, so a contact made between the true revocation and
    //     the repeat read as made BEFORE the revocation;
    //   • under a partial id map a bare timestamp was written (it reads as a
    //     grant time), or REVOKED beside the grant's instant;
    //   • the handler never looked at the contact it was about to write.
    // recordCallbackRevocation() decides what is written from the contact's
    // CURRENT state: already REVOKED → nothing (the instant stands); anything
    // else → REVOKED + this instant; unreadable → REVOKED only. The state is read
    // from the search payload, and from ONE extra GET only when that payload
    // does not carry it and the answer would change what is written — so with no
    // CY2027 ids configured (production today) this adds no CRM call.
    const revokedAt = new Date().toISOString();
    let cbRevocation = CALLBACK_REVOCATION_UNAVAILABLE;
    try {
      cbRevocation = recordCallbackRevocation({ at: revokedAt, state: callbackConsentStateOf(match) });
      if (cbRevocation.mode === CALLBACK_REVOCATION_MODE.REVOKED_STATUS_ONLY) {
        let current = null;
        try {
          const gres = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(match.id)}`, { headers: H });
          if (gres.ok) {
            const gjson = await gres.json();
            current = gjson && typeof gjson === 'object' ? gjson.contact : null;
          } else {
            console.warn('[OPTOUT] contact read for the consent state failed status=' + gres.status);
          }
        } catch (e) {
          console.warn('[OPTOUT] contact read for the consent state failed: ' + String(e).slice(0, 120));
        }
        cbRevocation = recordCallbackRevocation({ at: revokedAt, state: callbackConsentStateOf(current) });
      }
      // Field names and fixed strings only.
      for (const w of cbRevocation.warnings) console.warn(w);
    } catch (e) {
      cbRevocation = CALLBACK_REVOCATION_UNAVAILABLE;
      console.error('[OPTOUT] callback-consent revocation fields not built: ' + String(e).slice(0, 120));
    }
    // The four flags this endpoint has always cleared. Same field ids
    // submit-lead.js writes.
    const consentFlagFields = [
      { id: 'vPKlhpz6aucJK1U3fJRZ', key: 'contact.consent_marketing', value: 'false' },
      { id: 'w1hopBfNLGauFRRzQ71l', key: 'contact.consent_sms',       value: 'false' },
      { id: 'mHdpDjBSA76lQJrKoixL', key: 'contact.consent_calls',     value: 'false' },
      ...(blockEmail ? [{ id: 'ykiTUcsu3nvawK39hmll', key: 'contact.consent_email', value: 'false' }] : []),
    ];
    const update = {
      dnd: true,
      dndSettings: {
        Call: { status: 'active', message: 'Web chat opt-out' },
        SMS: { status: 'active', message: 'Web chat opt-out' },
        ...(blockEmail ? { Email: { status: 'active', message: 'Web chat opt-out' } } : {}),
      },
      // Red-team TCPA-04-N1: the server-derived 'Consent Captured' tag must not
      // survive a revocation; record the revocation as a tag too.
      tags: Array.from(new Set([...(match.tags || []).filter((t) => !/^consent[\s_-]?captured$/i.test(String(t))), 'cp-dnc', 'dnc-web-chat', 'Consent Revoked'])),
      // AUDIT 2026-09-12 (TCPA-04, P2) — a revocation must also clear the recorded
      // consent flags; DND alone left contact.consent_* = 'true' next to a DNC tag,
      // an internally contradictory record. Same field ids submit-lead.js writes.
      customFields: [...consentFlagFields, ...cbRevocation.fields],
    };
    const putContact = (payload) => fetch(`${GHL_BASE}/contacts/${encodeURIComponent(match.id)}`, {
      method: 'PUT', headers: H, body: JSON.stringify(payload),
    });
    // AUDIT 2026-10-02 (CE-09 / CRM-15) — FAIL-SAFE. The CALLBACK_CONSENT_* ids
    // are the only ones in this body that come from owner-supplied configuration.
    // If the CRM refuses the update with them attached, the suppression is sent
    // again in its exact previous shape: a field id must never cost a revocation.
    //
    // RED TEAM 2026-10-04 — that retry fired on ANY failed PUT. A transient
    // 500/429 (or a dead token) stripped the REVOKED fields, the second PUT
    // succeeded, and the contact read CALLBACK_CONSENT_STATUS=GRANTED beside
    // DND while the log blamed the fields and the note said REVOKED. The step
    // is now crmRefusalStep() (one policy, shared with api/submit-lead.js):
    //   • 429 / 5xx → the SAME body once more. A field is never dropped for it.
    //   • 401       → no retry: no body would be accepted.
    //   • other 4xx with the entries attached → once more without them.
    // At most three PUTs, and whatever was NOT written is said so, in the log
    // and in the note.
    let payload = update;
    let cbDropped = false;
    let transientRetried = false;
    let ures = await putContact(payload);
    for (let extra = 0; extra < 2 && !ures.ok; extra++) {
      const step = crmRefusalStep(ures.status, cbDropped ? 0 : cbRevocation.fields.length);
      if (step === 'TRANSIENT' && !transientRetried) {
        transientRetried = true;
        console.warn('[OPTOUT] transient status=' + ures.status + ' — retrying the SAME update once');
        await new Promise((resolve) => setTimeout(resolve, 300));
        ures = await putContact(payload);
      } else if (step === 'RETRY_WITHOUT_FIELDS') {
        cbDropped = true;
        console.error('[OPTOUT] update refused status=' + ures.status + ' with the CALLBACK_CONSENT_* fields attached — retrying the suppression without them');
        payload = { ...update, customFields: consentFlagFields };
        ures = await putContact(payload);
      } else {
        break;
      }
    }
    const dndApplied = ures.ok;
    if (!ures.ok) console.error('[OPTOUT] DND update failed status=' + ures.status);
    // What became of the two callback fields — never left to be inferred from
    // "applied dnd=true".
    const cbOutcome = cbRevocation.fields.length === 0 ? 'NOTHING_TO_WRITE'
      : !ures.ok ? 'UPDATE_FAILED'
        : cbDropped ? 'DROPPED' : 'WRITTEN';
    if (cbOutcome === 'DROPPED' || cbOutcome === 'UPDATE_FAILED') {
      console.error('[OPTOUT] callback_consent REVOKED NOT written to the CRM fields (' + cbOutcome + ') — the revocation note is the record');
    }

    // ── 3. Audit note. Category + timestamp only — never the raw message. ────
    const noteBody = [
      'CONTACT REVOCATION — recorded from web chat',
      'Evidence category: ' + evidence,
      // AUDIT 2026-10-02 (CE-09 / CRM-15) — the same instant as CALLBACK_CONSENT_AT.
      'Timestamp (UTC): ' + revokedAt,
      // RED TEAM 2026-10-04 — the note said "Channels blocked" and "REVOKED"
      // whatever the CRM had answered. It now says what was APPLIED: a failed
      // update is stated as a failure, with the action a human has to take.
      ...(dndApplied
        ? ['Channels blocked: call, sms' + (blockEmail ? ', email' : ' (email left open at the consumer\'s request)')]
        : [
          'Channels requested to be blocked: call, sms' + (blockEmail ? ', email' : ' (email left open at the consumer\'s request)'),
          '*** NOT APPLIED — the CRM did not accept the do-not-contact update (HTTP ' + ures.status + '). Set DND on this contact by hand. ***',
        ]),
      // Stated in the note as well, so the revocation of the callback permission
      // is on the record while the two fields have no GoHighLevel id.
      'Callback contact permission: REVOKED',
      callbackRevocationNoteLine(cbRevocation, cbOutcome),
      'Applied by: automated suppression endpoint (api/opt-out)',
      'NOTE: this record must be retained as evidence of the revocation. Do not',
      'delete it, and do not clear DND without a NEW documented consent.',
    ].join('\n');
    let noteApplied = false;
    try {
      const nres = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(match.id)}/notes`, {
        method: 'POST', headers: H, body: JSON.stringify({ body: noteBody }),
      });
      noteApplied = nres.ok;
    } catch (e) {
      console.error('[OPTOUT] note failed: ' + String(e).slice(0, 120));
    }

    // PII-free telemetry — the outcome lives in the logs, NOT in the client
    // response (OPTOUT-01). Since 2026-09-12 the PUT above also clears the
    // consent_* custom fields (same ids as submit-lead.js) and drops the
    // 'Consent Captured' tag; DND remains the authoritative platform-level
    // suppression.
    console.warn('[OPTOUT] applied dnd=' + dndApplied + ' note=' + noteApplied + ' evidence=' + evidence
      + ' callback_consent=' + cbRevocation.mode + '/' + cbOutcome);
    return ack(res);
  } catch (e) {
    console.error('[OPTOUT] unexpected: ' + String(e).slice(0, 200));
    return ack(res);
  }
}

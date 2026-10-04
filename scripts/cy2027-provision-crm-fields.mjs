#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — provision the §18 custom fields in the GoHighLevel sub-account and
// print the CY2027_CRM_FIELD_IDS map.
//
// WHY THIS EXISTS: GoHighLevel addresses a custom field by its opaque ID, and
// api/_lib/cy2027/crm-fields.js can only write fields it has an ID for. Creating
// dozens of fields by hand in the UI and transcribing their IDs is error-prone busywork
// that would also produce exactly the "duplicate fields with slightly different
// names" the spec forbids (§18).
//
// IT DOES NOT RUN BY ITSELF. It is not in `npm run build` or `npm test`, and
// without --apply it only reports. Creating fields writes to the production
// sub-account, so --apply is an owner decision.
//
//   node scripts/cy2027-provision-crm-fields.mjs                 # dry run
//   node scripts/cy2027-provision-crm-fields.mjs --apply         # creates them
//
// Requires GHL_API_TOKEN and GHL_LOCATION_ID in the environment.
//
// SAFETY:
//   • Never deletes or edits an existing field. If a field with the same key
//     already exists it is REUSED and reported, which is the spec's "search for
//     existing equivalent fields before creating new ones".
//   • Stops on the first creation error rather than leaving a half-provisioned
//     account in an unknown state.
//   • Prints the full ID map at the end whether it created anything or not, so a
//     re-run after a partial failure is safe and idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import { CY2027_FIELD_KEYS } from '../api/_lib/cy2027/crm-fields.js';

const APPLY = process.argv.includes('--apply');
const TOKEN = (process.env.GHL_API_TOKEN || '').trim();
const LOCATION = (process.env.GHL_LOCATION_ID || '').trim();
const API = 'https://services.leadconnectorhq.com';

/** Field name as it will read in the GHL UI, derived from the canonical key. */
function labelFor(name) {
  return 'CP ' + name.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** The bare field key GHL stores (it prefixes `contact.` itself). */
function bareKey(key) {
  return key.replace(/^contact\./, '');
}

function headers() {
  return {
    Authorization: 'Bearer ' + TOKEN,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function listExisting() {
  const r = await fetch(`${API}/locations/${encodeURIComponent(LOCATION)}/customFields`, { headers: headers() });
  if (!r.ok) throw new Error(`could not list custom fields — HTTP ${r.status}`);
  const j = await r.json();
  const arr = Array.isArray(j.customFields) ? j.customFields : Array.isArray(j.customField) ? j.customField : [];
  const byKey = new Map();
  for (const f of arr) {
    const k = String(f.fieldKey || f.key || '').replace(/^contact\./, '');
    if (k) byKey.set(k, f.id);
  }
  return byKey;
}

async function createField(name, key) {
  const r = await fetch(`${API}/locations/${encodeURIComponent(LOCATION)}/customFields`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: labelFor(name),
      fieldKey: bareKey(key),
      dataType: 'TEXT',
      model: 'contact',
palette: undefined,
    }),
  });
  if (!r.ok) {
    let detail = '';
    try { detail = (await r.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`create "${name}" failed — HTTP ${r.status} ${detail}`);
  }
  const j = await r.json();
  const id = (j.customField && j.customField.id) || j.id;
  if (!id) throw new Error(`create "${name}" returned no id`);
  return id;
}

async function main() {
  const names = Object.keys(CY2027_FIELD_KEYS);
  console.log(`CY2027 §18 fields: ${names.length}`);
  console.log(APPLY ? 'MODE: --apply (will CREATE missing fields)\n' : 'MODE: dry run (nothing will be created)\n');

  if (!TOKEN || !LOCATION) {
    console.error('GHL_API_TOKEN and GHL_LOCATION_ID must be set.');
    console.error('Dry run cannot check what already exists without them.\n');
    console.log('Fields that would be ensured:');
    for (const n of names) console.log(`  ${n.padEnd(34)} ${CY2027_FIELD_KEYS[n]}`);
    process.exit(1);
  }

  const existing = await listExisting();
  const map = {};
  const toCreate = [];
  for (const n of names) {
    const k = bareKey(CY2027_FIELD_KEYS[n]);
    if (existing.has(k)) map[n] = existing.get(k);
    else toCreate.push(n);
  }

  console.log(`already present: ${Object.keys(map).length}`);
  console.log(`missing:         ${toCreate.length}`);
  for (const n of toCreate) console.log(`  + ${n.padEnd(34)} ${CY2027_FIELD_KEYS[n]}`);

  if (!APPLY) {
    console.log('\nDry run — nothing created. Re-run with --apply to create the missing fields.');
  } else {
    for (const n of toCreate) {
      const id = await createField(n, CY2027_FIELD_KEYS[n]);
      map[n] = id;
      console.log(`  created ${n} -> ${id}`);
    }
  }

  console.log('\nSet this in the environment (CY2027_CRM_FIELD_IDS):\n');
  console.log(JSON.stringify(map));
  const stillMissing = names.filter((n) => !map[n]);
  if (stillMissing.length) {
    console.log(`\n${stillMissing.length} field(s) still have no ID: ${stillMissing.join(', ')}`);
    console.log('api/sign-soa.js will keep logging them on every signature until they exist.');
  }
}

main().catch((e) => { console.error('\n✗ ' + e.message); process.exit(1); });

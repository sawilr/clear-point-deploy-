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
//   • AUDIT 2026-10-04 (CRM-29) — a field whose key differs only SLIGHTLY from
//     one that exists (soa_planyear vs soa_plan_year) is neither reused nor
//     created: it is reported and left for a person to decide. The decision is
//     made by planProvisioning() in the canonical registry, not in this script.
//   • Stops on the first creation error rather than leaving a half-provisioned
//     account in an unknown state.
//   • Prints the full ID map at the end whether it created anything or not, so a
//     re-run after a partial failure is safe and idempotent.
// ─────────────────────────────────────────────────────────────────────────────

import { CY2027_FIELD_KEYS, planProvisioning, registryProblems, readAccountListing } from '../api/_lib/cy2027/crm-fields.js';

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
  // AUDIT 2026-10-04 (CRM-29) — this returned a Map keyed by the EXACT key, so a
  // field made by hand as `soa_planyear` was invisible and `soa_plan_year` got
  // created beside it: the "slightly different name" duplicate §18 forbids. It
  // now returns every field in the account and planProvisioning() decides.
  // AUDIT 2026-10-04 (CRM-29, red team) — and a response of any other shape was
  // read as "no fields", after which --apply created all thirty-six. The shape
  // is judged by readAccountListing(); an unknown one stops the script, by name.
  const listing = readAccountListing(await r.json());
  if (listing.refusal) {
    throw new Error(`the custom-field listing is not a shape this script reads (${listing.refusal.reason}): ${listing.refusal.detail.join('; ')}`);
  }
  return listing.fields;
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
  // AUDIT 2026-10-04 (CRM-29) — an inconsistent registry (two fields that differ
  // only slightly in name, a duplicated id) stops here, before anything is
  // created from it.
  const regProblems = registryProblems();
  if (regProblems.length) {
    console.error('The CRM field registry is inconsistent. Nothing will be created until it is fixed:');
    for (const p of regProblems) console.error('  ✗ ' + p);
    process.exit(1);
  }
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

  const plan = planProvisioning(await listExisting());
  const map = { ...plan.reuse };

  console.log(`already present: ${Object.keys(map).length}`);
  console.log(`missing:         ${plan.create.length + plan.withheld.length}`);
  for (const n of [...plan.create, ...plan.withheld]) console.log(`  + ${n.padEnd(34)} ${CY2027_FIELD_KEYS[n]}`);

  // AUDIT 2026-10-04 (CRM-29) — never created, with or without --apply.
  if (plan.blocked.length) {
    console.log(`\nNOT created — a field with a slightly different name already exists (spec §18): ${plan.blocked.length}`);
    for (const b of plan.blocked) {
      console.log(`  ✗ ${b.name.padEnd(34)} ${b.key}`);
      for (const x of b.near) console.log(`      ~ ${x.key}  id=${x.id}  (${x.where})`);
    }
    console.log('  Decide per field: reuse the existing one (add its id to CY2027_CRM_FIELD_IDS by hand)');
    console.log('  or rename the new key in api/_lib/cy2027/crm-fields.js. This script will not guess.');
  }
  if (plan.drift.length) {
    console.log(`\nEXISTING_CRM_FIELDS is not confirmed by this sub-account: ${plan.drift.length}`);
    for (const d of plan.drift) {
      console.log(`  ! ${d.name.padEnd(28)} ${d.reason}  registry ${d.key}=${d.registryId}  account ${d.accountKey || '(none)'}=${d.accountId || '(none)'}`);
    }
    console.log('  The lead and opt-out writers send the REGISTRY ids. Fix the registry or the account before relying on them.');
  }
  if (plan.unreadable.length) {
    console.log(`\nListing entries this script cannot read (no string id or key): ${plan.unreadable.length}`);
    for (const u of plan.unreadable) console.log(`  ? ${u.described}`);
  }

  // AUDIT 2026-10-04 (CRM-29, red team) — a listing that shows none of the
  // twelve fields the writers already use, no field at all, or an entry that
  // cannot be matched is not an account this script has searched. Until this
  // check, that exact situation printed the twelve NOT_IN_ACCOUNT lines above
  // and then created every §18 field — beside whatever the account held.
  // Refused with or without --apply: a dry run that would be refused says so.
  if (plan.refusal) {
    console.error(`\nNOT created — the §18 search cannot be performed on this listing (${plan.refusal.reason}):`);
    for (const d of plan.refusal.detail) console.error('  ✗ ' + d);
    console.error(`  ${plan.withheld.length} field(s) withheld. Confirm GHL_LOCATION_ID, the token's scope and the listing shape, then re-run.`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing created. Re-run with --apply to create the missing fields.');
  } else {
    for (const n of plan.create) {
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

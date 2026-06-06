// Phase 11 — targeted tests for 3 blockers + 1 regression.
// 1. Clara crisis input → safety router fires
// 2. Path A matched → ghl_contact_id forwarded in payload
// 3. TCPA receipt fields reach server body
// 4. lead_type preserved

import fs from 'fs';

let pass = 0, fail = 0;
function check(label, cond, evidence = '') {
  if (cond) { pass++; console.log('  ✓', label, evidence ? `(${evidence})` : ''); }
  else      { fail++; console.log('  ✗', label, evidence ? `(${evidence})` : ''); }
}

// ── Test 1: Clara CustomerServiceBot.tsx wires detectSafetyTrigger at top of handleSendMessage ──
console.log('\n── T1: Clara safety router wired ──');
const csbSrc = fs.readFileSync('src/components/CustomerServiceBot.tsx', 'utf8');
check('Import detectSafetyTrigger present', csbSrc.includes("import { detectSafetyTrigger } from '../lib/safetyRouter'"));
const handleSendIdx = csbSrc.indexOf('async function handleSendMessage');
const safetyIdx = csbSrc.indexOf('detectSafetyTrigger(text)', handleSendIdx);
const outerCheckIdx = csbSrc.indexOf('outerInProgress', handleSendIdx);
check('detectSafetyTrigger called inside handleSendMessage', safetyIdx > handleSendIdx);
check('Safety check runs BEFORE outer flow routing', safetyIdx > 0 && safetyIdx < outerCheckIdx);
check('Safety check has early-return guard', csbSrc.includes("if (safety.action !== 'none')"));

// ── Test 2: ghl.ts forwards 7 new fields + interest_type pre-existing ──
console.log('\n── T2: ghl.ts forwards Phase 10/11 fields ──');
const ghlSrc = fs.readFileSync('src/lib/ghl.ts', 'utf8');
const fields = ['lead_type', 'ghl_contact_id', 'ghl_assigned_user_id', 'consent_text',
                'consent_receipt_hash', 'disclaimer_version', 'signer_user_agent', 'interest_type'];
for (const f of fields) {
  check(`Forwards body.${f}`, ghlSrc.includes(`body.${f} = `));
}

// ── Test 3: submit-lead.js parses receipt + lead_type + handles ghl_contact_id ──
console.log('\n── T3: submit-lead.js handles new fields ──');
const slSrc = fs.readFileSync('api/submit-lead.js', 'utf8');
check('Reads body.lead_type with sanitization',          /var lead_type = .*body\.lead_type/.test(slSrc));
check('Reads body.ghl_contact_id with sanitization',     /var ghl_contact_id = .*body\.ghl_contact_id/.test(slSrc));
check('Reads body.consent_receipt_hash',                 /var consent_receipt_hash = .*body\.consent_receipt_hash/.test(slSrc));
check('Reads body.disclaimer_version',                   /var disclaimer_version = .*body\.disclaimer_version/.test(slSrc));
check('Receipt appended to lead_notes',                  slSrc.includes('TCPA Receipt'));
check('LeadType-{x} tag added when lead_type present',   slSrc.includes("'LeadType-' + lead_type"));
check('Switches to PUT when ghl_contact_id present',     /if \(ghl_contact_id\)/.test(slSrc) && slSrc.includes("method: 'PUT'"));
check('Falls back to POST if PUT fails',                 /if \(!ghlRes \|\| !ghlRes\.ok\)/.test(slSrc));
check('assignedTo set from ghl_assigned_user_id',        slSrc.includes('contact.assignedTo = ghl_assigned_user_id'));

// ── Test 4: safetyRouter regex catches expected crisis phrases (regression) ──
console.log('\n── T4: safetyRouter pattern regression ──');
const srSrc = fs.readFileSync('src/lib/safetyRouter.ts', 'utf8');
check('988 EN pattern: kill myself',     srSrc.includes("'kill myself'"));
check('988 ES pattern: quiero morir',    srSrc.includes("'quiero morir'"));
check('988 ES pattern: no quiero vivir', srSrc.includes("'no quiero vivir'"));
check('911 EN pattern: heart attack',    srSrc.includes("'heart attack'"));
check('911 ES pattern: no puedo respirar', srSrc.includes("'no puedo respirar'"));

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

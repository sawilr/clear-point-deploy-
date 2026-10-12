// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — THE TOPIC LABELS THE SITE ITSELF SENDS AS interest_type.
// SERVER ONLY. Not re-exported by ./index.js and not reachable from
// src/lib/cy2027.ts: the client already owns these strings, in three places.
//
// AUDIT 2026-10-04 (CRM-25, red team) — api/submit-lead.js let interest_type
// into the contact note, a CRM field and an Interest- tag with the PHI scrub
// only: a direct POST with 'chemo for my cancer and Part D' there was filed
// verbatim under a class line that said NO_RESTRICTED_SIGNAL (measured), and an
// identifier the PHI net removed from it never raised IDENTIFIER_REDACTED.
//
// Why the field was never put through the DM-09 redactor like every other
// free-text door: the site's own topic labels name the programs §15 keeps out
// of scores ('Extra Help / LIS question', 'Dual Medicare + Medicaid question',
// 'Medicaid, MSP, Extra Help, or LIS'), and three of them read as a medical
// topic to the redactor ('Denied surgery / appeal', 'My prescription / drug
// costs are too high', 'SSI, SSDI, or disability' — measured over all 70 labels
// below: 9 raise a flag). Redacting the field would rewrite live Smart Review
// options, the contact.medicare_interest field and the Interest- tag family —
// the OWNER DECISION docs/compliance/CY2027-ARCHITECTURE.md records as open.
//
// So the two cases are told apart by an ALLOW-LIST, not inferred from the text:
//   • a value that IS one of these labels, byte for byte, is a topic the site
//     authored. It is stored as it always was (the owner decision is left where
//     it is — in the owner's hands), and what the redactor says about it still
//     reaches the record's class and its review flags, because the label is
//     true whoever chose the words.
//   • anything else is free text the sender typed, and gets exactly what
//     best_time_to_contact gets (DM-04): PHI scrub, DM-09 redaction, no tag
//     minted from a value that had something removed.
// A label the client adds later and that names a restricted topic is therefore
// redacted until it is added here — the failure is visible and in the safe
// direction. The suite extracts the labels from the three client sources and
// asserts each one is in this list, so the drift is caught before it ships.
//
// Sources (the suite reads them by path):
//   src/lib/orchestrator/leadNoteBuilder.ts   INTEREST_TYPE_BY_CATEGORY (CS bot)
//   src/lib/smartReviewRouting.ts             every option's `en` (Smart Review)
//   src/components/ChatBot.tsx                MEDICARE_TOPIC_KEYWORDS_EN/_ES,
//                                             detectInterest(), fixed topics
//   src/lib/claraOuterFlow.ts                 ClaraTopic
// ─────────────────────────────────────────────────────────────────────────────

export const SITE_INTEREST_LABELS = Object.freeze([
  'Advantage Types',
  'Agency identity',
  'Annual review',
  'Assistance Programs',
  'Bill / charge to review',
  'CRISIS — medical emergency routed to 911',
  'CRISIS — self-harm language routed to 988',
  'Compare Medicare Advantage plans',
  'Comparison',
  'Complaint / frustration',
  'Contact',
  'Denied service / coverage dispute',
  'Denied surgery / appeal',
  'Dental / vision / hearing benefit',
  'Doctor / provider network issue',
  'Dual Medicare + Medicaid question',
  'Employer Coverage',
  'Enrollment',
  'Existing client requesting callback',
  'Extra Benefits',
  'Extra Help / LIS',
  'Extra Help / LIS question',
  'Family member / caregiver caller',
  'Flex card question',
  'General Medicare education',
  'General Medicare education question',
  'General Medicare question',
  'Have Medigap and want to review options',
  'Home care, nursing home, PACE, MAP, LTC, or I-SNP',
  "I'm losing employer coverage or have a special enrollment question",
  "I'm not sure where the cost is coming from",
  'LI NET',
  'LLM_FREEFORM',
  'Lost Medicare card',
  'Lower my plan premium or out-of-pocket costs',
  'MSP',
  'Medicaid',
  'Medicaid, MSP, Extra Help, or LIS',
  'Medicare Advantage',
  'Medicare Parts A & B',
  'Medicare Savings Programs',
  'Medicare Supplement',
  'Medication',
  'Medication cost concern',
  'Medication not covered',
  'My prescription / drug costs are too high',
  'New to Medicare or not sure what I have',
  'Non-client requesting review',
  'Not sure — guide me',
  'OTC card issue',
  'Part D',
  'Penalties',
  'Pharmacy issue',
  'Plan Loss',
  'Plan Review',
  'Plan change / enrollment',
  'Plan review',
  'Possible Medicare fraud / scam',
  'Premium / cost question',
  'Prequalify',
  'Review my Medicare costs',
  'Review my Part D drug coverage',
  'SSI, SSDI, or disability',
  'State Programs',
  'Transportation to doctor',
  'URGENT: out of medication',
  'Unsure client status — verify internally',
  'VA, TRICARE, retiree, union, or federal/state coverage',
  'Wants to schedule appointment',
  'Wants to talk with licensed advisor',
  // src/lib/claraOuterFlow.ts — ClaraTopic, sent as interest_type: s.topic
  'plan',
  'billing',
  'doctor',
  'medication',
  'other',
]);

/**
 * True only for a string that is one of the labels above, exactly as the site
 * sends it (after the handler's own cap, PHI scrub and white-space fold, which
 * the suite proves leave every label unchanged). Case, surrounding white space
 * and look-alikes do not match: anything that is not the label is free text.
 * Array membership by value — never `in`, never a lookup on an object.
 */
export function isSiteInterestLabel(value) {
  return typeof value === 'string' && SITE_INTEREST_LABELS.includes(value);
}

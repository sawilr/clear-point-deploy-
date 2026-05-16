import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../hooks/useLanguage';
import { submitLeadToGHL } from '../lib/ghl';
import { Calendar, ChevronRight, Minus, Phone, RotateCcw, Send, User, X } from 'lucide-react';

import { getZipInfo } from '../lib/zipLookup';
import { validateDOB, validatePhone } from '../lib/validation';

type ChatLanguage = 'en' | 'es';
type MessageType = 'bot' | 'user';
type ChatStep =
  | 'language'
  | 'choice'
  | 'state'
  | 'question'
  | 'medicare_education'
  | 'lead_name'
  | 'lead_last_name'
  | 'lead_zip'
  | 'lead_dob'
  | 'lead_coverage'
  | 'lead_consent'
  | 'lead_phone'
  | 'lead_preferred_language'
  | 'lead_time'
  | 'lead_email'
  | 'complete';
type MessagePace = 'short' | 'long' | 'slow';

interface Option {
  label: string;
  value: string;
  icon?: ReactNode;
}

interface Message {
  id: string;
  type: MessageType;
  text: string;
  options?: Option[];
}

interface ChatMemory {
  language: ChatLanguage;
  firstName: string;
  lastName: string;
  zip: string;
  phone: string;
  email: string;
  currentCoverage: string;
  interestType: string;
  preferredLanguage: string;
  preferredContactTime: string;
  consentGiven: boolean;
  dob: string;
  calculatedAge: number;
  city: string;
  county: string;
  derivedState: string;
  lastTopic: string;
  wantsPlanReview: boolean;
  state: string;
  educationTopic: string;
  educationStep: number;
  submitted: boolean;
  skippedEmail: boolean;
  discussedTopics: string[];
}

interface QueuedBotMessage {
  text: string;
  options?: Option[];
  pace?: MessagePace;
}

const SESSION_KEY = 'clear_point_chat_session_memory';

const SUPPORTED_STATES = ['NY', 'NJ', 'CT', 'FL'];

const SUPPORTED_STATES_LABELS: Record<string, string> = {
  NY: 'New York',
  NJ: 'New Jersey',
  CT: 'Connecticut',
  FL: 'Florida',
};

/* ------------------------------------------------------------------ */
/*  Medicare Knowledge Base - calm, step-by-step, senior-friendly     */
/* ------------------------------------------------------------------ */

const MEDICARE_INTRO: Record<ChatLanguage, QueuedBotMessage[]> = {
  en: [
    {
      text: 'Great. Which state do you live in? This helps me give you more accurate general information about Medicare cost-help programs.',
      pace: 'slow',
    },
    {
      text: 'We currently support New York, New Jersey, Connecticut, and Florida.',
      options: [
        { label: 'New York', value: 'state_NY' },
        { label: 'New Jersey', value: 'state_NJ' },
        { label: 'Connecticut', value: 'state_CT' },
        { label: 'Florida', value: 'state_FL' },
      ],
      pace: 'slow',
    },
  ],
  es: [
    {
      text: 'Perfecto. ¿En qué estado vive? Esto me ayuda a darle información general más precisa sobre programas que pueden ayudar con los costos de Medicare.',
      pace: 'slow',
    },
    {
      text: 'Actualmente trabajamos con New York, New Jersey, Connecticut y Florida.',
      options: [
        { label: 'New York', value: 'state_NY' },
        { label: 'New Jersey', value: 'state_NJ' },
        { label: 'Connecticut', value: 'state_CT' },
        { label: 'Florida', value: 'state_FL' },
      ],
      pace: 'slow',
    },
  ],
};

/* ---- Post-state topic menu — 3 grouped pages (replaces flat 13-item menu) ---- */

const TOPIC_GROUPS_EN: Option[][] = [
  // Group 1 of 3
  [
    { label: 'Lower my Medicare costs', value: 'edu_cost_help' },
    { label: 'Medicaid / MSP / Extra Help', value: 'edu_extra_help' },
    { label: 'Medicare Advantage', value: 'edu_part_c' },
    { label: 'Medicare Supplement / Medigap', value: 'edu_supplement' },
    { label: 'New to Medicare', value: 'edu_parts_ab' },
    { label: 'More options →', value: 'topic_page_2' },
    { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ],
  // Group 2 of 3
  [
    { label: 'Part D / prescription drugs', value: 'edu_part_d' },
    { label: 'HMO vs PPO', value: 'edu_advantage_types' },
    { label: 'SNP plans', value: 'edu_snp' },
    { label: 'Disability / SSI / SSDI', value: 'edu_ssdi_ssi' },
    { label: 'Retiree / union / VA / TRICARE', value: 'edu_special_benefits' },
    { label: 'More options →', value: 'topic_page_3' },
    { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ],
  // Group 3 of 3
  [
    { label: 'Enrollment periods', value: 'edu_enrollment' },
    { label: 'Doctors and medications', value: 'edu_medication' },
    { label: 'State prescription help', value: 'edu_spap' },
    { label: 'I am not sure', value: 'edu_parts_ab' },
    { label: 'Start over', value: 'start_over' },
    { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ],
];

const TOPIC_GROUPS_ES: Option[][] = [
  // Group 1 of 3
  [
    { label: 'Reducir costos de Medicare', value: 'edu_cost_help' },
    { label: 'Medicaid / MSP / Extra Help', value: 'edu_extra_help' },
    { label: 'Medicare Advantage', value: 'edu_part_c' },
    { label: 'Medicare Supplement / Medigap', value: 'edu_supplement' },
    { label: 'Nuevo en Medicare', value: 'edu_parts_ab' },
    { label: 'Más opciones →', value: 'topic_page_2' },
    { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ],
  // Group 2 of 3
  [
    { label: 'Parte D / medicamentos recetados', value: 'edu_part_d' },
    { label: 'HMO vs PPO', value: 'edu_advantage_types' },
    { label: 'Planes SNP', value: 'edu_snp' },
    { label: 'Discapacidad / SSI / SSDI', value: 'edu_ssdi_ssi' },
    { label: 'Retiro / unión / VA / TRICARE', value: 'edu_special_benefits' },
    { label: 'Más opciones →', value: 'topic_page_3' },
    { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ],
  // Group 3 of 3
  [
    { label: 'Períodos de inscripción', value: 'edu_enrollment' },
    { label: 'Doctores y medicamentos', value: 'edu_medication' },
    { label: 'Ayuda estatal para medicamentos', value: 'edu_spap' },
    { label: 'No estoy seguro', value: 'edu_parts_ab' },
    { label: 'Empezar de nuevo', value: 'start_over' },
    { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ],
];

const STATE_CONFIRMATION: Record<ChatLanguage, Record<string, QueuedBotMessage[]>> = {
  en: {
    NY: [{ text: "Thank you. I'll keep New York in mind so I can give more accurate general information when you ask about Medicare, Medicaid, or Medicare cost-help programs.", pace: 'short' }, { text: 'What would you like to learn about today?', options: TOPIC_GROUPS_EN[0], pace: 'short' }],
    NJ: [{ text: "Thank you. I'll keep New Jersey in mind so I can give more accurate general information when you ask about Medicare, Medicaid, or Medicare cost-help programs.", pace: 'short' }, { text: 'What would you like to learn about today?', options: TOPIC_GROUPS_EN[0], pace: 'short' }],
    CT: [{ text: "Thank you. I'll keep Connecticut in mind so I can give more accurate general information when you ask about Medicare, Medicaid, or Medicare cost-help programs.", pace: 'short' }, { text: 'What would you like to learn about today?', options: TOPIC_GROUPS_EN[0], pace: 'short' }],
    FL: [{ text: "Thank you. I'll keep Florida in mind so I can give more accurate general information when you ask about Medicare, Medicaid, or Medicare cost-help programs.", pace: 'short' }, { text: 'What would you like to learn about today?', options: TOPIC_GROUPS_EN[0], pace: 'short' }],
    other: [{ text: "I can give you general Medicare guidance, but for Medicaid, MSP, or prescription assistance specific to your state, I would need to verify that state's current rules.", pace: 'slow' }, { text: 'What would you like to learn about today?', options: TOPIC_GROUPS_EN[0], pace: 'short' }],
  },
  es: {
    NY: [{ text: 'Gracias. Tendré New York en cuenta para darle información general más precisa cuando pregunte sobre Medicare, Medicaid o programas de ayuda con costos de Medicare.', pace: 'short' }, { text: '¿Qué tema le gustaría aprender hoy?', options: TOPIC_GROUPS_ES[0], pace: 'short' }],
    NJ: [{ text: 'Gracias. Tendré New Jersey en cuenta para darle información general más precisa cuando pregunte sobre Medicare, Medicaid o programas de ayuda con costos de Medicare.', pace: 'short' }, { text: '¿Qué tema le gustaría aprender hoy?', options: TOPIC_GROUPS_ES[0], pace: 'short' }],
    CT: [{ text: 'Gracias. Tendré Connecticut en cuenta para darle información general más precisa cuando pregunte sobre Medicare, Medicaid o programas de ayuda con costos de Medicare.', pace: 'short' }, { text: '¿Qué tema le gustaría aprender hoy?', options: TOPIC_GROUPS_ES[0], pace: 'short' }],
    FL: [{ text: 'Gracias. Tendré Florida en cuenta para darle información general más precisa cuando pregunte sobre Medicare, Medicaid o programas de ayuda con costos de Medicare.', pace: 'short' }, { text: '¿Qué tema le gustaría aprender hoy?', options: TOPIC_GROUPS_ES[0], pace: 'short' }],
    other: [{ text: 'Puedo darle orientación general de Medicare, pero para Medicaid, MSP o ayuda de medicamentos específica de su estado, tendría que verificar las reglas actuales de ese estado.', pace: 'slow' }, { text: '¿Qué tema le gustaría aprender hoy?', options: TOPIC_GROUPS_ES[0], pace: 'short' }],
  },
};

/* --- Detailed Medicare Education (calm, one topic at a time) --- */

function getMedicareEducation(topic: string, language: ChatLanguage, state: string): QueuedBotMessage[] {
  const isSupported = SUPPORTED_STATES.includes(state);
  const stateLabel = SUPPORTED_STATES_LABELS[state] || state;
  const D = MEDICARE_2026;

  const en: Record<string, QueuedBotMessage[]> = {
    edu_parts_ab: [
      { text: 'Medicare has two main parts that work together.', pace: 'long' },
      { text: `Part A helps cover hospital stays, skilled nursing facility care, and some home health care. In 2026, the Part A hospital deductible is $${D.partA.deductible.toLocaleString()} per benefit period. Most people do not pay a premium for Part A if they or their spouse worked and paid Medicare taxes for at least 10 years.`, pace: 'slow' },
      { text: `Part B helps cover doctor visits, outpatient care, medical supplies, and preventive services. The standard Part B monthly premium is $${D.partB.standardPremium.toFixed(2)} in 2026, and the annual deductible is $${D.partB.annualDeductible}.`, pace: 'slow' },
      { text: 'Together, Parts A and B are called Original Medicare. You can go to any doctor or hospital in the U.S. that accepts Medicare.', pace: 'long' },
      {
        text: 'Would you like to know more about costs, or would you like me to explain Medicare Advantage (Part C)?',
        options: [
          { label: 'Tell me about Part C', value: 'edu_part_c' },
          { label: 'Part D prescriptions', value: 'edu_part_d' },
          { label: 'Help with costs', value: 'edu_cost_help' },
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_part_c: [
      { text: 'Medicare Advantage, also called Part C, is another way to receive your Medicare benefits.', pace: 'long' },
      { text: 'These are plans offered by private insurance companies approved by Medicare. They must cover everything Original Medicare covers, and many include extra benefits like dental, vision, hearing, or fitness programs.', pace: 'long' },
      { text: `Availability and costs depend on your county in ${stateLabel}. Each plan has its own network of doctors and hospitals.`, pace: 'long' },
      { text: 'I can help you request a free review to see what plans are available in your area. A licensed advisor would check your doctors and prescriptions.', pace: 'long' },
      {
        text: 'What would you like to do?',
        options: [
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Tell me about Supplement', value: 'edu_supplement' },
          { label: 'Part D prescriptions', value: 'edu_part_d' },
          { label: 'Go back', value: 'edu_parts_ab' },
        ],
        pace: 'short',
      },
    ],
    edu_supplement: [
      { text: 'Medicare Supplement, also called Medigap, is a separate policy that helps pay some of the costs that Original Medicare does not cover - like deductibles and coinsurance.', pace: 'long' },
      { text: 'You must have Original Medicare (Parts A and B) to get a Medigap policy. Medigap plans are labeled by letters (A, B, C, D, F, G, K, L, M, N).', pace: 'long' },
      { text: 'In most states, if you apply during your Medigap Open Enrollment Period - the 6-month window starting when you turn 65 and enroll in Part B - insurance companies cannot deny you or charge more based on health.', pace: 'slow' },
      {
        text: isSupported
          ? `A licensed advisor can review Medigap options in ${stateLabel} with you.`
          : 'A licensed advisor can review Medigap options in your state with you.',
        options: [
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Tell me about Part D', value: 'edu_part_d' },
          { label: 'Help with costs', value: 'edu_cost_help' },
        ],
        pace: 'short',
      },
    ],
    edu_part_d: [
      { text: 'Part D helps cover the cost of prescription drugs. Each Part D plan has its own list of covered drugs (called a formulary) and network of pharmacies.', pace: 'long' },
      { text: 'If you do not enroll when first eligible and go without creditable drug coverage, you may have to pay a late enrollment penalty - unless you qualify for Extra Help.', pace: 'long' },
      { text: 'I cannot check specific prescriptions here. A licensed advisor can review your medications to find a plan that covers them.', pace: 'long' },
      {
        text: isSupported
          ? `In ${stateLabel}, there are also programs that may help with drug costs. Would you like to learn about them?`
          : 'There are also national programs that may help with drug costs. Would you like to learn more?',
        options: [
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Tell me about Extra Help', value: 'edu_extra_help' },
          { label: 'Help with costs', value: 'edu_cost_help' },
        ],
        pace: 'short',
      },
    ],
    edu_cost_help: (() => {
      const msgs: QueuedBotMessage[] = [
        { text: 'Several programs can help lower Medicare costs if your income and resources are limited. Let me walk you through them.', pace: 'long' },
      ];
      if (state === 'NY') {
        msgs.push({ text: 'New York Medicare Savings Program — NY does NOT use an asset/resource limit. Two main categories:', pace: 'long' });
        msgs.push({ text: `• QMB (Qualified Medicare Beneficiary) — may help pay Part B premium, Part A premium if applicable, Medicare deductibles, coinsurance, and copayments. QMB is not retroactive in NY. 2026 income limit: about $${D.msp.NY.QMB.singleIncome.toLocaleString()}/mo single, $${D.msp.NY.QMB.coupleIncome.toLocaleString()}/mo couple (138% FPL with $20 disregard).`, pace: 'slow' });
        msgs.push({ text: `• QI-1 (Qualifying Individual-1) — may help pay Part B premium only. May be retroactive up to 3 months within the same calendar year. Cannot be received with Medicaid. 2026 income limit: about $${D.msp.NY.QI1.singleIncome.toLocaleString()}/mo single, $${D.msp.NY.QI1.coupleIncome.toLocaleString()}/mo couple (186% FPL with $20 disregard).`, pace: 'slow' });
        msgs.push({ text: '• EPIC (Elderly Pharmaceutical Insurance Coverage) — NY\'s SPAP. Helps eligible seniors 65+ with Part D drug costs. Income guidelines: up to about $75,000 single / $100,000 married. Separate from Extra Help.', pace: 'slow' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'New Jersey Medicare Savings Programs — QMB, SLMB, and QI (annual limits):', pace: 'long' });
        msgs.push({ text: `• QMB — may help pay Part A/B premiums, deductibles, coinsurance, copayments. Income: $15,960/yr single, $21,640/yr couple. Resources: $9,950 single, $14,910 couple.`, pace: 'slow' });
        msgs.push({ text: `• SLMB — may help pay Part B premium only. Income: $19,152/yr single, $25,968/yr couple. Resources: $9,950 single, $14,910 couple.`, pace: 'slow' });
        msgs.push({ text: `• QI — may help pay Part B premium only. Income: $21,546/yr single, $29,214/yr couple. First-come, first-served.`, pace: 'slow' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Connecticut Medicare Savings Program — QMB, SLMB, and ALMB (effective March 1, 2026):', pace: 'long' });
        msgs.push({ text: `• QMB — may help pay Part B premium, deductibles, coinsurance, copayments. Similar to a Medigap policy per CT description. Income: $2,807/mo single, $3,806/mo couple.`, pace: 'slow' });
        msgs.push({ text: `• SLMB — may help pay Part B premium only. Income: $3,073/mo single, $4,166/mo couple.`, pace: 'slow' });
        msgs.push({ text: `• ALMB (Additional Low-Income Medicare Beneficiary) — may help pay Part B premium only. Subject to funding. Not available with Medicaid. Income: $3,272/mo single, $4,437/mo couple.`, pace: 'slow' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Florida Medicare Savings Programs — use 2026 federal baseline (verify with FL Medicaid/DCF):', pace: 'long' });
        msgs.push({ text: `• QMB — may help pay Part A/B premiums, deductibles, coinsurance. Income: $${D.msp.FL.QMB.singleIncome.toLocaleString()}/mo single, $${D.msp.FL.QMB.coupleIncome.toLocaleString()}/mo couple. Resources: $${D.msp.FL.QMB.singleAsset.toLocaleString()} single, $${D.msp.FL.QMB.coupleAsset.toLocaleString()} couple.`, pace: 'slow' });
        msgs.push({ text: `• SLMB — may help pay Part B premium. Income: $${D.msp.FL.SLMB.singleIncome.toLocaleString()}/mo single, $${D.msp.FL.SLMB.coupleIncome.toLocaleString()}/mo couple.`, pace: 'slow' });
        msgs.push({ text: `• QI — may help pay Part B premium. Income: $${D.msp.FL.QI.singleIncome.toLocaleString()}/mo single, $${D.msp.FL.QI.coupleIncome.toLocaleString()}/mo couple. First-come, first-served.`, pace: 'slow' });
      } else {
        msgs.push({ text: 'Medicare Savings Programs (MSP) help pay Medicare premiums and sometimes deductibles and coinsurance. 2026 federal income guidelines:', pace: 'long' });
        msgs.push({ text: `• QMB (Qualified Medicare Beneficiary) — may help pay Part A/B premiums, deductibles, coinsurance. Federal baseline: $1,350/mo single, $1,824/mo couple. Resources: $9,950 single, $14,910 couple.\n• SLMB (Specified Low-Income Medicare Beneficiary) — may help pay Part B premium. Federal baseline: $1,616/mo single, $2,184/mo couple.\n• QI (Qualifying Individual) — may help pay Part B premium. Federal baseline: $1,816/mo single, $2,455/mo couple.\n• QDWI (Qualified Disabled and Working Individual) — may help pay Part A premium for certain disabled working individuals under 65.`, pace: 'slow' });
      }
      msgs.push({ text: `Medicaid is a separate program administered by each state. It can provide additional help — from paying Part B premiums to covering services Medicare does not. Some people qualify for both Medicare and Medicaid (dual eligible).`, pace: 'long' });
      msgs.push({
        text: isSupported
          ? `${stateLabel} also has state-specific programs. Would you like to know about programs in ${stateLabel}?`
          : 'Each state has its own programs. Would you like me to connect you with an advisor?',
        options: [
          { label: isSupported ? `Yes, ${stateLabel} programs` : 'Yes, connect me', value: 'edu_state_programs' },
          { label: 'Tell me about Extra Help', value: 'edu_extra_help' },
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_extra_help: [
      { text: 'Extra Help - also called the Low-Income Subsidy or LIS - is a federal program that helps pay for Medicare Part D prescription drug costs.', pace: 'long' },
      { text: `In 2026, the income limit is about $${D.extraHelp.incomeLimitSingle.toLocaleString()}/month for a single person and $${D.extraHelp.incomeLimitCouple.toLocaleString()}/month for a couple. The asset limit is about $${D.extraHelp.assetLimitSingle.toLocaleString()} for a single person and $${D.extraHelp.assetLimitCouple.toLocaleString()} for a couple (does not count your home, one car, or burial funds).`, pace: 'slow' },
      { text: `With Extra Help, generic drug copays are as low as $${D.extraHelp.genericCopay.toFixed(2)} and brand-name copays as low as $${D.extraHelp.brandCopay.toFixed(2)} per prescription in 2026.`, pace: 'slow' },
      { text: 'Some people qualify automatically - for example, if you have both Medicare and full Medicaid, Supplemental Security Income (SSI), or qualify through a Medicare Savings Program.', pace: 'long' },
      { text: 'Important: People who receive Extra Help do not pay the Part D late enrollment penalty while they have Extra Help.', pace: 'long' },
      { text: 'This is only a pre-check. Final eligibility is determined by Social Security or your state.', pace: 'short' },
      {
        text: 'Would you like a licensed advisor to help you check if you may qualify?',
        options: [
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Help with Medicare costs', value: 'edu_cost_help' },
          { label: 'Go back to topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_penalties: [
      { text: 'Medicare has late enrollment penalties for Part B and Part D if you delay enrollment without having other creditable coverage.', pace: 'long' },
      { text: 'Part B penalty: Generally 10% is added to your monthly Part B premium for each full 12-month period you could have had Part B but did not enroll. This penalty is usually permanent and continues for as long as you have Part B.', pace: 'slow' },
      { text: 'Part D penalty: May apply if you go 63 or more days in a row without Part D or other creditable prescription drug coverage. The penalty amount is calculated based on how many months you were without coverage and is added to your Part D premium.', pace: 'slow' },
      { text: 'Important: People who receive Extra Help (LIS) do not pay the Part D late enrollment penalty while they have Extra Help.', pace: 'long' },
      { text: 'If you have employer, union, federal, state, retiree, VA, TRICARE, or FEHB coverage: do not cancel any current coverage without first checking with your benefits administrator and a licensed advisor. Some types of coverage count as creditable and can help you avoid penalties.', pace: 'slow' },
      { text: 'I cannot calculate a final penalty without knowing exact dates. A licensed advisor can review your timeline.', pace: 'short' },
      {
        text: 'Would you like an advisor to review your situation?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_employer: [
      { text: 'If you have coverage through an employer, union, federal job, state job, retiree plan, VA, TRICARE, or FEHB (Federal Employees Health Benefits), it is important to understand how it works with Medicare.', pace: 'long' },
      { text: 'For many people, employer coverage can be creditable - meaning it counts as valid coverage and may help you avoid late enrollment penalties if you delay Part B or Part D.', pace: 'long' },
      { text: '⚠️ Important: Never cancel employer, union, federal, state, retiree, VA, TRICARE, or FEHB coverage without first speaking with your benefits administrator AND a licensed advisor. Canceling could leave you without coverage or trigger penalties.', pace: 'slow' },
      { text: 'The rules depend on the size of the employer, whether you are actively working or retired, and the type of coverage you have. A licensed advisor can review your specific situation.', pace: 'long' },
      {
        text: 'Would you like an advisor to review how your coverage works with Medicare?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_plan_loss: [
      { text: 'If you lost your Medicare Advantage or Part D plan - for example, because the plan left your area or you moved - you may qualify for a Special Enrollment Period.', pace: 'long' },
      { text: 'A Special Enrollment Period lets you enroll in a new plan outside the regular enrollment windows.', pace: 'long' },
      { text: 'The time you have depends on the reason - for example, moving out of your plan\'s service area, losing other coverage, or your plan ending its contract with Medicare.', pace: 'long' },
      { text: 'An advisor can check your situation and help you find a new plan that fits your needs.', pace: 'short' },
      {
        text: 'Would you like help finding a new plan?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_linet: [
      { text: 'LI NET stands for Limited Income Newly Eligible Transition. It is a temporary Medicare Part D prescription drug coverage program.', pace: 'long' },
      { text: 'LI NET provides immediate, temporary Part D coverage for certain low-income Medicare beneficiaries who are not yet enrolled in a Medicare drug plan. It helps bridge the gap when someone newly qualifies for Medicaid or Extra Help and needs their prescriptions right away.', pace: 'slow' },
      { text: 'This is not a permanent plan - it provides temporary coverage until a regular Part D or Medicare Advantage plan with drug coverage takes effect.', pace: 'long' },
      { text: 'I cannot promise LI NET eligibility, but if this situation sounds like yours, a licensed advisor can help verify if LI NET applies and get you connected.', pace: 'short' },
      {
        text: 'Would you like an advisor to check your situation?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_medication: [
      { text: 'To check medications correctly, I would need the medication name, dosage, how often you take it, your pharmacy, and your ZIP code.', pace: 'long' },
      { text: 'Drug coverage can change by plan, pharmacy, tier, prior authorization, step therapy, and quantity limits. Even within the same insurance company, different plans may cover the same drug differently.', pace: 'slow' },
      { text: 'I cannot confirm whether a specific medication is covered without real plan formulary data. A licensed advisor can check your medications against available plans in your area.', pace: 'long' },
      {
        text: 'Would you like a licensed advisor to check your medications?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_prequalify: [
      { text: 'I can help walk you through a pre-check to see which programs may be worth looking into. Let\'s go step by step. I\'ll ask one question at a time.', pace: 'slow' },
      { text: 'First: What state do you live in?', options: [{ label: 'New York', value: 'state_NY' }, { label: 'New Jersey', value: 'state_NJ' }, { label: 'Connecticut', value: 'state_CT' }, { label: 'Florida', value: 'state_FL' }, { label: 'Other', value: 'state_other' }], pace: 'slow' },
    ],
    edu_enrollment: [
      { text: 'Medicare has specific times when you can enroll, switch, or review your coverage. The right period depends on your situation.', pace: 'long' },
      { text: 'Initial Enrollment: Usually begins 3 months before the month you turn 65, includes your birthday month, and ends 3 months after that month.', pace: 'slow' },
      { text: 'Annual Enrollment: October 15 to December 7. You can review or change Medicare Advantage and Part D coverage for the following year.', pace: 'slow' },
      { text: 'Medicare Advantage Open Enrollment: January 1 to March 31. If already in a Medicare Advantage plan, you may switch to another or return to Original Medicare.', pace: 'slow' },
      { text: 'General Enrollment: January 1 to March 31. This may apply if you missed your first chance to sign up for Part A or B and do not qualify for a Special Enrollment Period. Penalties may apply.', pace: 'slow' },
      { text: 'Special Enrollment: Certain life events - such as moving, losing coverage, qualifying for Medicaid, or getting Extra Help - may let you enroll or change plans outside the usual periods.', pace: 'slow' },
      { text: 'Medicare Supplement rules can be different from Advantage and Part D. They may depend on state rules, timing of Part B enrollment, and whether health underwriting applies.', pace: 'long' },
      {
        text: 'Would you like help checking which enrollment period may apply to you?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_advantage_types: [
      { text: 'Medicare Advantage plans are offered by private insurance companies approved by Medicare. There are several types, and availability varies by county, state, and carrier.', pace: 'long' },
      { text: 'HMO: Usually requires using in-network doctors and hospitals. Many require a primary care doctor and referrals for specialists. May have lower costs depending on the plan.', pace: 'slow' },
      { text: 'PPO: Usually gives more flexibility to see out-of-network providers, but it may cost more. Generally no referrals needed for specialists.', pace: 'slow' },
      { text: 'PFFS (Private Fee-for-Service): The plan decides payment rates. Always confirm the provider accepts the plan before receiving services.', pace: 'slow' },
      { text: 'SNP (Special Needs Plan): Designed for people with specific needs - such as dual Medicare + Medicaid (D-SNP), certain chronic conditions (C-SNP), or institutional care (I-SNP). Eligibility depends on the plan. A licensed agent must verify.', pace: 'slow' },
      { text: 'MSA (Medical Savings Account): Combines a high-deductible plan with a savings account the plan deposits money into. Usually does not include Part D. Requires understanding deductibles and drug coverage.', pace: 'slow' },
      {
        text: 'The right type depends on your doctors, prescriptions, county, and how you prefer to receive care. Would you like an advisor to review your options?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_comparison: [
      { text: 'Here is a simple comparison of the main Medicare coverage types:', pace: 'short' },
      { text: 'Original Medicare: Parts A and B run by the federal government. Covers hospital and medical services. You can see any doctor who accepts Medicare. Does not cover everything - you may have deductibles and coinsurance.', pace: 'long' },
      { text: 'Medicare Advantage (Part C): Offered by private companies approved by Medicare. Replaces how you receive Part A and B benefits. May include extras like dental, vision, hearing, and Part D. Rules, networks, and costs vary by plan.', pace: 'long' },
      { text: 'Medicare Supplement (Medigap): Works with Original Medicare. Helps pay deductibles, coinsurance, and copayments. Does not replace Original Medicare. Usually does not include Part D.', pace: 'long' },
      { text: 'Part D: Standalone prescription drug plans or included in some Medicare Advantage plans. Each plan has its own formulary and pharmacy network.', pace: 'long' },
      { text: 'Which combination is right for you depends on your health, budget, doctors, prescriptions, and location. A licensed advisor can review your specific situation.', pace: 'long' },
      {
        text: 'Would you like an advisor to help you compare your options?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_snp: [
      { text: 'Special Needs Plans (SNPs) are a type of Medicare Advantage plan for people with certain specific needs.', pace: 'long' },
      { text: 'There are three main types:', pace: 'short' },
      { text: '• D-SNP (Dual Eligible SNP) — for people who have both Medicare and Medicaid. These plans coordinate Medicare and Medicaid benefits.', pace: 'slow' },
      { text: '• C-SNP (Chronic Condition SNP) — for people with certain chronic conditions like diabetes, heart disease, or chronic lung disorders.', pace: 'slow' },
      { text: '• I-SNP (Institutional SNP) — for people who live in a nursing home or require nursing care at home.', pace: 'slow' },
      { text: 'SNP availability depends on your county and plan availability. Not every county has every type of SNP. A licensed advisor can check what SNPs are available in your area.', pace: 'long' },
      {
        text: 'Would you like to learn about other topics or request a review?',
        options: [
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'More options', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_medicaid: (() => {
      const msgs: QueuedBotMessage[] = [
        { text: 'Medicaid is a state and federal program that may help people with limited income and resources pay medical costs. For people with Medicare, Medicaid may sometimes help with premiums, cost-sharing, and services Medicare does not fully cover.', pace: 'long' },
      ];
      if (state === 'NY') {
        msgs.push({ text: 'Since you selected New York, Medicaid rules are handled under New York State guidelines.', pace: 'long' });
        msgs.push({ text: 'For 2026, New York\'s general Medicaid income guideline for many aged, blind, or disabled adults is about $1,836/month for one person or $2,489/month for a couple, after the standard disregard. Resource limits may be about $33,038 for one person or $44,796 for a couple for many non-MAGI Medicaid categories, but some programs and budgeting rules can differ.', pace: 'slow' });
        msgs.push({ text: 'New York also has Medicare Savings Programs, and New York MSP does not use an asset/resource test. People with Medicaid or MSP may also be connected to Extra Help/LIS for Part D drug costs.', pace: 'slow' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'Since you selected New Jersey, Medicaid for aged, blind, or disabled individuals may be reviewed through New Jersey Medicaid / NJ FamilyCare rules.', pace: 'long' });
        msgs.push({ text: 'For 2026, New Jersey\'s Aged, Blind, Disabled Medicaid brochure lists certain special Medicaid programs at 100% of the Federal Poverty Level: about $1,330/month for a single person with a $4,000 resource maximum, and about $1,804/month for a couple with a $6,000 resource maximum. These numbers can change and different Medicaid categories may use different rules.', pace: 'slow' });
        msgs.push({ text: 'New Jersey also has NJSave, Medicare Savings Programs, PAAD, and Senior Gold depending on the person\'s situation.', pace: 'long' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Since you selected Connecticut, Medicaid is generally handled through HUSKY Health. HUSKY C is the Medicaid category commonly connected to people who are aged, blind, disabled, or need long-term services and supports.', pace: 'long' });
        msgs.push({ text: 'Connecticut HUSKY C rules are category-specific. Official Connecticut DSS materials show HUSKY C asset limits can apply, including $1,600 for a single person in certain categories, and married couple rules can depend on the specific category or community spouse rules. Connecticut also has Medicare Savings Programs with higher income limits than regular HUSKY C in many cases.', pace: 'slow' });
        msgs.push({ text: 'Because Connecticut Medicaid categories are complex, the safest guidance is to review HUSKY C, MSP, Extra Help/LIS, and any spend-down rules with Connecticut DSS or a licensed advisor.', pace: 'long' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Since you selected Florida, Medicaid eligibility for aged or disabled people is generally determined by Florida DCF, while AHCA administers the Medicaid program.', pace: 'long' });
        msgs.push({ text: 'Florida has different Medicaid categories. For some SSI-related or aged/disabled coverage groups, income and resource rules can be strict. For long-term care Medicaid, Florida financial rules commonly reference an income limit around $2,982/month in 2026 with asset limits that depend on the category and marital situation.', pace: 'slow' });
        msgs.push({ text: 'Because Florida Medicaid categories vary, please review SSI-related Medicaid, Medicare Savings Programs, Extra Help/LIS, long-term care Medicaid if applicable, and Florida SHINE or DCF resources with a licensed advisor.', pace: 'long' });
      } else {
        msgs.push({ text: 'Medicaid eligibility depends on income, resources, age, disability, household situation, and program category. Each state has its own Medicaid rules and income limits.', pace: 'long' });
      }
      msgs.push({ text: 'This is general education, not a final eligibility decision. The state agency or a licensed advisor must verify the person\'s category, income, resources, household situation, and program rules.', pace: 'short' });
      msgs.push({
        text: 'You may also want to learn about:',
        options: [
          { label: 'Medicare Savings Programs', value: 'edu_msp' },
          { label: 'State Prescription Assistance', value: 'edu_spap' },
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Go back to topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_msp: (() => {
      const msgs: QueuedBotMessage[] = [
        { text: 'Medicare Savings Programs (MSP) are state-run programs that may help people with limited income and resources pay Medicare premiums, deductibles, coinsurance, and copayments. Each state administers these programs, and income and resource limits can vary.', pace: 'long' },
      ];
      if (state === 'NY') {
        msgs.push({ text: 'New York Medicare Savings Program:\n• New York does NOT use an asset/resource limit for MSP.\n• QMB (Qualified Medicare Beneficiary) — may help pay Part B premium, Part A premium if applicable, Medicare deductibles, coinsurance, and copayments. QMB is not retroactive in NY. Income limit: about $1,856/month single or $2,509/month couple (138% FPL with $20 disregard).\n• QI-1 (Qualifying Individual-1) — may help pay Part B premium only. May be retroactive up to 3 months same calendar year. Cannot combine with Medicaid. Income limit: about $2,494/month single or $3,375/month couple (186% FPL with $20 disregard).\n• People who get MSP in NY are generally connected to Extra Help/LIS for Part D drug costs.', pace: 'slow' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'New Jersey Medicare Savings Programs (2026 annual limits):\n• QMB — may help pay Part A/B premiums, deductibles, coinsurance, copayments. Income: $15,960/yr single, $21,640/yr couple. Resources: $9,950 single, $14,910 couple.\n• SLMB — may help pay Part B premium only. Income: $19,152/yr single, $25,968/yr couple. Resources: $9,950 single, $14,910 couple.\n• QI — may help pay Part B premium only. Must apply every year. First-come, first-served. Income: $21,546/yr single, $29,214/yr couple.\n• NJSave is commonly used to apply. NJ Division of Aging Services: 1-800-792-9745.', pace: 'slow' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Connecticut Medicare Savings Program (effective March 1, 2026):\n• QMB — may help pay Part B premium, deductibles, coinsurance, copayments. Income: $2,807/mo single, $3,806/mo couple.\n• SLMB — may help pay Part B premium only. Income: $3,073/mo single, $4,166/mo couple.\n• ALMB — may help pay Part B premium only. Subject to funding. Not available with Medicaid. Income: $3,272/mo single, $4,437/mo couple.\n• All three CT MSP levels auto-connect to Extra Help/LIS for Part D drug costs.', pace: 'slow' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Florida Medicare Savings Programs (use 2026 federal baseline — verify with FL Medicaid/DCF):\n• QMB — may help pay Part A/B premiums, deductibles, coinsurance. Income: $1,350/mo single, $1,824/mo couple. Resources: $9,950 single, $14,910 couple.\n• SLMB — may help pay Part B premium. Income: $1,616/mo single, $2,184/mo couple.\n• QI — may help pay Part B premium. Income: $1,816/mo single, $2,455/mo couple. First-come, first-served.\n• Exact Florida rules must be verified through the state agency, SHINE, or a licensed advisor.', pace: 'slow' });
      } else {
        msgs.push({ text: 'Federal 2026 baseline MSP income limits:\n• QMB — about $1,350/mo single, $1,824/mo couple. Resources: $9,950 single, $14,910 couple.\n• SLMB — about $1,616/mo single, $2,184/mo couple.\n• QI — about $1,816/mo single, $2,455/mo couple.\n• QDWI — about $5,405/mo single, $7,299/mo couple. Resources: $4,000 single, $6,000 couple.', pace: 'slow' });
      }
      msgs.push({ text: 'This is general educational information, not a final eligibility decision. A licensed advisor or the state agency can help verify your situation.', pace: 'short' });
      msgs.push({
        text: 'You may also want to learn about:',
        options: [
          { label: 'State Prescription Assistance', value: 'edu_spap' },
          { label: 'Medicaid', value: 'edu_medicaid' },
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Go back to topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_spap: (() => {
      const msgs: QueuedBotMessage[] = [];
      if (state === 'NY') {
        msgs.push({ text: 'Since you selected New York, the main state prescription assistance program to know is EPIC, the Elderly Pharmaceutical Insurance Coverage program. EPIC may help eligible New York seniors with Medicare Part D drug costs.', pace: 'long' });
        msgs.push({ text: 'General 2026 EPIC guidance:\n• New York resident\n• Age 65 or older\n• Enrolled in or eligible for Medicare Part D\n• Annual income up to $75,000 if single or $100,000 if married\n• EPIC works with Medicare Part D\n• People with full Medicaid generally may not use EPIC the same way, but people with Medicaid spend-down may need review.', pace: 'slow' });
        msgs.push({ text: 'Official resource: New York State Department of Health EPIC program.', pace: 'short' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'Since you selected New Jersey, the main state prescription assistance programs are PAAD and Senior Gold.', pace: 'long' });
        msgs.push({ text: 'PAAD 2026 general guidance:\n• New Jersey resident\n• Age 65 or older, or age 18–64 receiving Social Security Disability benefits\n• Annual income less than $54,943 if single or less than $62,390 if married\n• Must be enrolled in Medicare Part D\n• PAAD can reduce covered prescription costs — plan formulary and pharmacy rules still matter.', pace: 'slow' });
        msgs.push({ text: 'Senior Gold 2026 general guidance:\n• New Jersey resident\n• Same age/disability requirements as PAAD\n• Generally for people above PAAD limits\n• Annual income range: $54,943–$64,943 if single, or $62,390–$72,390 if married\n• Different cost-sharing structure than PAAD.', pace: 'slow' });
        msgs.push({ text: 'Official resource: NJSave / New Jersey Division of Aging Services.', pace: 'short' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Since you selected Connecticut, it is important not to present ConnPACE as an active current prescription assistance program. Official Connecticut information states ConnPACE is no longer a supported benefit plan as of January 1, 2014.', pace: 'long' });
        msgs.push({ text: 'For prescription help in Connecticut, the main options to review are:\n• Extra Help/LIS\n• Medicare Savings Programs\n• Medicaid/HUSKY if applicable\n• Part D formulary review\n• Preferred pharmacy review\n• Manufacturer assistance programs when appropriate.', pace: 'slow' });
        msgs.push({ text: 'Official resource: Connecticut DSS / HUSKY Health.', pace: 'short' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Since you selected Florida, Florida does not have a verified EPIC/PAAD-style statewide prescription assistance program in this knowledge base.', pace: 'long' });
        msgs.push({ text: 'For prescription help in Florida, the main options to review are:\n• Extra Help/LIS\n• Medicare Savings Programs\n• Medicaid if applicable\n• Part D formulary review\n• Preferred pharmacy review\n• Florida SHINE counseling\n• Manufacturer assistance programs when appropriate.', pace: 'slow' });
        msgs.push({ text: 'Official resource: Florida DCF / Florida SHINE.', pace: 'short' });
      } else {
        msgs.push({ text: 'State prescription assistance programs (SPAPs) vary by state. Not every state has an active SPAP. Some states have strong programs, while others do not. A licensed advisor can help review what may be available in your state.', pace: 'long' });
      }
      msgs.push({ text: 'This is general education, not a final eligibility decision.', pace: 'short' });
      msgs.push({
        text: 'You may also want to learn about:',
        options: [
          { label: 'Medicare Savings Programs', value: 'edu_msp' },
          { label: 'Medicaid', value: 'edu_medicaid' },
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Go back to topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_special_benefits: [
      { text: 'Some people have benefits beyond standard Medicare — such as union or retiree plans, VA or TRICARE coverage, or disability benefits. These can affect how Medicare works for you.', pace: 'long' },
      {
        text: 'Which situation applies to you?',
        options: [
          { label: 'I have union or retiree benefits', value: 'edu_union_retiree' },
          { label: 'I have VA or TRICARE', value: 'edu_va_tricare' },
          { label: 'I receive disability benefits', value: 'edu_disability' },
          { label: 'I want to check doctors or medications', value: 'edu_medication' },
          { label: 'I want to speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Back to Medicare topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_union_retiree: [
      { text: 'Union and employer retiree plans can vary widely. Some plans continue as your primary coverage when you turn 65. Others become secondary to Medicare and require you to enroll in Medicare Parts A and B to keep your union or retiree benefits active.', pace: 'long' },
      { text: 'The rules depend on your specific union contract or employer retiree plan. Plans differ on whether they cover prescriptions, dental, vision, and how they coordinate with Medicare.', pace: 'long' },
      { text: '⚠️ Never cancel union or retiree coverage without first speaking with your plan administrator and a licensed advisor. Canceling could cause you to lose benefits permanently or trigger Medicare late enrollment penalties.', pace: 'slow' },
      { text: 'A licensed advisor can review how your specific union or retiree plan coordinates with Medicare and whether any changes make sense for your situation.', pace: 'long' },
      {
        text: 'Would you like an advisor to review your situation?',
        options: [
          { label: 'Back to Special Benefits', value: 'edu_special_benefits' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_va_tricare: [
      { text: 'If you have VA or TRICARE benefits, Medicare works differently for you than for most people.', pace: 'long' },
      { text: 'VA Benefits: The VA health system is separate from Medicare. VA coverage does not replace a Medicare Advantage or Part D plan. You can have both VA and Medicare, but they do not automatically coordinate — the VA covers care at VA facilities, while Medicare covers care outside the VA system. Having Medicare Part B gives you more flexibility if you ever need non-VA care.', pace: 'slow' },
      { text: 'TRICARE: If you are a retired service member or dependent with TRICARE, you generally need to enroll in Medicare Part B to keep your TRICARE coverage active. TRICARE for Life requires both Medicare Part A and Part B enrollment. Failing to enroll in Part B can cause you to lose TRICARE coverage.', pace: 'slow' },
      { text: '⚠️ Important: If you lose VA or TRICARE benefits, you may qualify for a Special Enrollment Period for Medicare. Do not delay — timing matters.', pace: 'slow' },
      { text: 'A licensed advisor can help you understand how VA and TRICARE coordinate with Medicare and what options may make sense for your situation.', pace: 'long' },
      {
        text: 'Would you like an advisor to review your situation?',
        options: [
          { label: 'Back to Special Benefits', value: 'edu_special_benefits' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_disability: [
      { text: 'If you receive Social Security Disability Insurance (SSDI), you generally become eligible for Medicare after a 24-month waiting period from when your disability benefits begin.', pace: 'long' },
      { text: 'Some conditions qualify for Medicare without the 24-month wait: ALS (Lou Gehrig\'s disease) qualifies immediately, and End-Stage Renal Disease (ESRD) has its own separate rules.', pace: 'long' },
      { text: 'During the 24-month waiting period, you may need other coverage options. A licensed advisor can review what may be available in your area.', pace: 'long' },
      { text: 'Once you have Medicare due to disability, you may also qualify for Extra Help / LIS to lower prescription drug costs, or other assistance programs depending on your income and resources.', pace: 'long' },
      { text: 'At age 65, your Medicare coverage continues automatically — you do not need to re-enroll.', pace: 'long' },
      {
        text: 'Would you like to learn more or speak with an advisor?',
        options: [
          { label: 'Extra Help / LIS', value: 'edu_extra_help' },
          { label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Back to Special Benefits', value: 'edu_special_benefits' },
          { label: 'Go back to topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi: [
      { text: 'This is an important area because SSI, SSDI, Medicaid, disability benefits, and Medicare do not all work the same way.', pace: 'long' },
      { text: 'SSI by itself usually does not mean someone has Medicare. Many people with SSI may have Medicaid, depending on state rules. Medicare before age 65 usually depends on SSDI after the required waiting period, or special conditions such as ALS or ESRD.', pace: 'slow' },
      { text: 'If someone has SSDI, Medicare may start after the required disability waiting period. If someone is 65 or older, Medicare rules also depend on work history. Many people get premium-free Part A if they or a spouse have about 40 work quarters, usually around 10 years.', pace: 'slow' },
      { text: 'If someone does not have enough quarters for premium-free Part A, they may be able to buy Part A. If income and resources are limited, the state may help pay Part A and/or Part B through Medicare Savings Programs such as QMB.', pace: 'slow' },
      { text: 'Clear Point can help you understand what questions to ask, but final eligibility must be confirmed with Social Security, Medicare, Medicaid, or the state agency.', pace: 'long' },
      {
        text: 'Which of these applies to you?',
        options: [
          { label: 'I receive SSI', value: 'edu_ssdi_ssi_ssi' },
          { label: 'I receive SSDI', value: 'edu_ssdi_ssi_ssdi' },
          { label: 'I have Medicaid', value: 'edu_ssdi_ssi_medicaid' },
          { label: 'I am under 65', value: 'edu_ssdi_ssi_under65' },
          { label: 'I am 65 or older', value: 'edu_ssdi_ssi_over65' },
          { label: 'I do not have 40 work quarters', value: 'edu_ssdi_ssi_quarters' },
          { label: 'I need help paying Part A or Part B', value: 'edu_ssdi_ssi_partab' },
          { label: 'I want to speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Back to Medicare topics', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_ssi: [
      { text: 'SSI alone does not automatically mean Medicare. Many SSI recipients may have Medicaid, depending on state rules. If you are under 65, Medicare usually requires SSDI after the required waiting period, or a special condition like ALS or ESRD. Eligibility must be confirmed with Social Security or Medicaid.', pace: 'slow' },
      {
        text: 'Would you like to continue or speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_ssdi: [
      { text: 'People approved for SSDI may become eligible for Medicare after the required disability waiting period. They should confirm timing with Social Security. Some conditions such as ALS or ESRD may have different rules.', pace: 'slow' },
      {
        text: 'Would you like to continue or speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_medicaid: [
      { text: 'Having Medicaid does not automatically mean you have Medicare. Medicaid and Medicare are separate programs. Some people have both, which is called dual eligibility. If you are under 65 and have Medicaid but not Medicare, you may need to check whether SSDI, ALS, or ESRD pathways apply to you. Eligibility must be confirmed with Medicaid or Social Security.', pace: 'slow' },
      {
        text: 'Would you like to continue or speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_under65: [
      { text: 'People under 65 may qualify for Medicare through SSDI after the required waiting period, through ESRD, or through ALS. SSI alone is not the same as SSDI and does not automatically lead to Medicare. You should verify your situation with Social Security to understand your Medicare start date if you have SSDI.', pace: 'slow' },
      {
        text: 'Would you like to continue or speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_over65: [
      { text: 'At age 65 or older, Medicare eligibility depends in part on work history. Many people get premium-free Part A if they or a spouse have about 40 work quarters, usually around 10 years of Medicare-covered work. If you do not have enough quarters, you may still be able to get Part A by paying a premium. State Medicare Savings Programs may also help in some cases.', pace: 'slow' },
      {
        text: 'Would you like to continue or speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_quarters: [
      { text: "About 40 quarters, usually around 10 years of Medicare-covered work, may allow premium-free Part A. A spouse's work history may also matter in some situations. If you do not have enough quarters, Part A may require a monthly premium. Some people with limited income and resources may be able to get help paying that premium through a state Medicare Savings Program such as QMB. Eligibility must be confirmed with Social Security or the state agency.", pace: 'slow' },
      {
        text: 'Would you like to continue or speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_partab: [
      { text: 'Programs like QMB may help pay Part A premiums if needed, Part B premiums, and sometimes deductibles, coinsurance, and copays. Eligibility depends on income, resources, state rules, and Medicare status. You would need to apply through your state Medicaid agency to see if you may qualify. Clear Point cannot determine eligibility, but an advisor can help you understand what questions to ask.', pace: 'slow' },
      {
        text: 'Would you like to speak with an advisor?',
        options: [
          { label: 'Back to SSI / SSDI topic', value: 'edu_ssdi_ssi' },
          { label: 'Ask another question', value: 'edu_back_to_topics' },
          { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
  };

  const es: Record<string, QueuedBotMessage[]> = {
    edu_parts_ab: [
      { text: 'Medicare tiene dos partes principales que trabajan juntas.', pace: 'long' },
      { text: `La Parte A ayuda a cubrir estadías en el hospital, cuidado en centros de enfermería especializada y algo de cuidado en el hogar. En 2026, el deducible hospitalario de la Parte A es $${D.partA.deductible.toLocaleString()} por período de beneficio. La mayoría de las personas no pagan prima por la Parte A si ellos o su cónyuge trabajaron y pagaron impuestos de Medicare por al menos 10 años.`, pace: 'slow' },
      { text: `La Parte B ayuda a cubrir visitas al doctor, cuidado ambulatorio, suministros médicos y servicios preventivos. La prima mensual estándar de la Parte B es $${D.partB.standardPremium.toFixed(2)} en 2026, y el deducible anual es $${D.partB.annualDeductible}.`, pace: 'slow' },
      { text: 'Juntas, las Partes A y B se llaman Medicare Original. Puedes ir a cualquier doctor u hospital en EE.UU. que acepte Medicare.', pace: 'long' },
      {
        text: '¿Quieres saber más sobre costos, o te explico Medicare Advantage (Parte C)?',
        options: [
          { label: 'Explicar Parte C', value: 'edu_part_c' },
          { label: 'Parte D - recetas', value: 'edu_part_d' },
          { label: 'Ayuda con costos', value: 'edu_cost_help' },
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_part_c: [
      { text: 'Medicare Advantage, también llamada Parte C, es otra forma de recibir tus beneficios de Medicare.', pace: 'long' },
      { text: 'Estos son planes ofrecidos por compañías de seguros privadas aprobadas por Medicare. Deben cubrir todo lo que Medicare Original cubre, y muchos incluyen beneficios adicionales como dental, visión, audición o programas de ejercicio.', pace: 'long' },
      { text: `La disponibilidad y costos dependen de tu condado en ${stateLabel}. Cada plan tiene su propia red de doctores y hospitales.`, pace: 'long' },
      { text: 'Puedo ayudarte a solicitar una revisión gratuita para ver qué planes hay en tu área. Un asesor licenciado revisaría tus doctores y medicamentos.', pace: 'long' },
      {
        text: '¿Qué te gustaría hacer?',
        options: [
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Explicar Supplement', value: 'edu_supplement' },
          { label: 'Parte D - recetas', value: 'edu_part_d' },
          { label: 'Volver', value: 'edu_parts_ab' },
        ],
        pace: 'short',
      },
    ],
    edu_supplement: [
      { text: 'Medicare Supplement, también llamado Medigap, es una póliza separada que ayuda a pagar algunos costos que Medicare Original no cubre - como deducibles y coaseguros.', pace: 'long' },
      { text: 'Debes tener Medicare Original (Partes A y B) para obtener una póliza Medigap. Los planes Medigap se identifican por letras (A, B, C, D, F, G, K, L, M, N).', pace: 'long' },
      { text: 'En la mayoría de los estados, si solicitas durante tu Período de Inscripción Abierta de Medigap - los 6 meses que empiezan cuando cumples 65 y te inscribes en Parte B - las aseguradoras no pueden negarte ni cobrarte más por tu salud.', pace: 'slow' },
      {
        text: isSupported
          ? `Un asesor licenciado puede revisar opciones de Medigap en ${stateLabel} contigo.`
          : 'Un asesor licenciado puede revisar opciones de Medigap en tu estado contigo.',
        options: [
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Explicar Parte D', value: 'edu_part_d' },
          { label: 'Ayuda con costos', value: 'edu_cost_help' },
        ],
        pace: 'short',
      },
    ],
    edu_part_d: [
      { text: 'La Parte D ayuda a cubrir el costo de medicamentos recetados. Cada plan de Parte D tiene su propia lista de medicamentos cubiertos (llamada formulario) y red de farmacias.', pace: 'long' },
      { text: 'Si no te inscribes cuando eres elegible por primera vez y no tienes otra cobertura de medicamentos acreditable, podrías pagar una penalidad por inscripción tardía - a menos que califiques para Ayuda Extra.', pace: 'long' },
      { text: 'No puedo revisar medicamentos específicos aquí. Un asesor licenciado puede revisar tus medicinas para encontrar un plan que las cubra.', pace: 'long' },
      {
        text: isSupported
          ? `En ${stateLabel}, también hay programas que pueden ayudar con costos de medicamentos. ¿Quieres aprender sobre ellos?`
          : 'También hay programas nacionales que pueden ayudar con costos de medicamentos. ¿Quieres saber más?',
        options: [
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Explicar Ayuda Extra', value: 'edu_extra_help' },
          { label: 'Ayuda con costos', value: 'edu_cost_help' },
        ],
        pace: 'short',
      },
    ],
    edu_cost_help: (() => {
      const msgs: QueuedBotMessage[] = [
        { text: 'Varios programas pueden ayudar a reducir los costos de Medicare si tus ingresos y recursos son limitados. Déjame explicarte.', pace: 'long' },
      ];
      if (state === 'NY') {
        msgs.push({ text: 'Programa de Ahorros de Medicare de New York — NY NO usa límite de assets/recursos. Dos categorías principales:', pace: 'long' });
        msgs.push({ text: `• QMB (Beneficiario de Medicare Calificado) — puede ayudar a pagar prima de Parte B, prima de Parte A si aplica, deducibles, coaseguros y copagos de Medicare. QMB no es retroactivo en NY. Límite de ingreso 2026: alrededor de $${D.msp.NY.QMB.singleIncome.toLocaleString()}/mes soltero, $${D.msp.NY.QMB.coupleIncome.toLocaleString()}/mes pareja (138% FPL con disregard de $20).`, pace: 'slow' });
        msgs.push({ text: `• QI-1 (Individuo Calificado-1) — puede ayudar a pagar solo la prima de Parte B. Puede ser retroactivo hasta 3 meses dentro del mismo año calendario. No se puede recibir junto con Medicaid. Límite de ingreso 2026: alrededor de $${D.msp.NY.QI1.singleIncome.toLocaleString()}/mes soltero, $${D.msp.NY.QI1.coupleIncome.toLocaleString()}/mes pareja (186% FPL con disregard de $20).`, pace: 'slow' });
        msgs.push({ text: '• EPIC (Cobertura de Seguro Farmacéutico para Personas Mayores) — SPAP de NY. Ayuda a seniors elegibles 65+ con costos de medicamentos de Parte D. Guía de ingresos: hasta $75,000 soltero / $100,000 casado. Separado de Extra Help.', pace: 'slow' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'Programas de Ahorros de Medicare de New Jersey — QMB, SLMB y QI (límites anuales):', pace: 'long' });
        msgs.push({ text: '• QMB — puede ayudar a pagar primas de Parte A/B, deducibles, coaseguros, copagos. Ingreso: $15,960/año soltero, $21,640/año pareja. Recursos: $9,950 soltero, $14,910 pareja.', pace: 'slow' });
        msgs.push({ text: '• SLMB — puede ayudar a pagar solo la prima de Parte B. Ingreso: $19,152/año soltero, $25,968/año pareja. Recursos: $9,950 soltero, $14,910 pareja.', pace: 'slow' });
        msgs.push({ text: '• QI — puede ayudar a pagar solo la prima de Parte B. Ingreso: $21,546/año soltero, $29,214/año pareja. Por orden de llegada.', pace: 'slow' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Programa de Ahorros de Medicare de Connecticut — QMB, SLMB y ALMB (efectivo 1 de marzo de 2026):', pace: 'long' });
        msgs.push({ text: '• QMB — puede ayudar a pagar prima de Parte B, deducibles, coaseguros, copagos. Similar a póliza Medigap según CT. Ingreso: $2,807/mes soltero, $3,806/mes pareja.', pace: 'slow' });
        msgs.push({ text: '• SLMB — puede ayudar a pagar solo la prima de Parte B. Ingreso: $3,073/mes soltero, $4,166/mes pareja.', pace: 'slow' });
        msgs.push({ text: '• ALMB (Beneficiario de Medicare de Bajos Ingresos Adicional) — puede ayudar a pagar solo la prima de Parte B. Sujeto a fondos. No disponible con Medicaid. Ingreso: $3,272/mes soltero, $4,437/mes pareja.', pace: 'slow' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Programas de Ahorros de Medicare de Florida — use la base federal 2026 (verifique con FL Medicaid/DCF):', pace: 'long' });
        msgs.push({ text: `• QMB — puede ayudar a pagar primas de Parte A/B, deducibles, coaseguros. Ingreso: $${D.msp.FL.QMB.singleIncome.toLocaleString()}/mes soltero, $${D.msp.FL.QMB.coupleIncome.toLocaleString()}/mes pareja. Recursos: $${D.msp.FL.QMB.singleAsset.toLocaleString()} soltero, $${D.msp.FL.QMB.coupleAsset.toLocaleString()} pareja.`, pace: 'slow' });
        msgs.push({ text: `• SLMB — puede ayudar a pagar prima de Parte B. Ingreso: $${D.msp.FL.SLMB.singleIncome.toLocaleString()}/mes soltero, $${D.msp.FL.SLMB.coupleIncome.toLocaleString()}/mes pareja.`, pace: 'slow' });
        msgs.push({ text: `• QI — puede ayudar a pagar prima de Parte B. Ingreso: $${D.msp.FL.QI.singleIncome.toLocaleString()}/mes soltero, $${D.msp.FL.QI.coupleIncome.toLocaleString()}/mes pareja. Por orden de llegada.`, pace: 'slow' });
      } else {
        msgs.push({ text: 'Los Programas de Ahorros de Medicare (MSP) ayudan a pagar las primas de Medicare y a veces deducibles y coaseguros. Pautas federales 2026:', pace: 'long' });
        msgs.push({ text: '• QMB (Beneficiario de Medicare Calificado) — puede ayudar a pagar primas de Parte A/B, deducibles, coaseguros. Base federal: $1,350/mes soltero, $1,824/mes pareja. Recursos: $9,950 soltero, $14,910 pareja.\n• SLMB (Beneficiario de Medicare de Bajos Ingresos Especificado) — puede ayudar a pagar prima de Parte B. Base federal: $1,616/mes soltero, $2,184/mes pareja.\n• QI (Individuo Calificado) — puede ayudar a pagar prima de Parte B. Base federal: $1,816/mes soltero, $2,455/mes pareja.\n• QDWI (Individuo Discapacitado y Trabajador Calificado) — puede ayudar a pagar prima de Parte A para ciertos trabajadores discapacitados menores de 65.', pace: 'slow' });
      }
      msgs.push({ text: 'Medicaid es un programa separado administrado por cada estado. Puede ofrecer ayuda adicional — desde pagar primas de Parte B hasta cubrir servicios que Medicare no cubre. Algunas personas califican para ambos, Medicare y Medicaid (elegibilidad dual).', pace: 'long' });
      msgs.push({
        text: isSupported
          ? `${stateLabel} también tiene programas específicos. ¿Quieres saber sobre programas en ${stateLabel}?`
          : 'Cada estado tiene sus propios programas. ¿Quieres que te conecte con un asesor?',
        options: [
          { label: isSupported ? `Sí, programas de ${stateLabel}` : 'Sí, conéctame', value: 'edu_state_programs' },
          { label: 'Explicar Ayuda Extra', value: 'edu_extra_help' },
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_extra_help: [
      { text: 'Ayuda Extra - también llamado Subsidio de Bajo Ingreso o LIS - es un programa federal que ayuda a pagar los costos de medicamentos recetados de la Parte D.', pace: 'long' },
      { text: `En 2026, el límite de ingresos es aproximadamente $${D.extraHelp.incomeLimitSingle.toLocaleString()}/mes para una persona soltera y $${D.extraHelp.incomeLimitCouple.toLocaleString()}/mes para una pareja. El límite de recursos es aproximadamente $${D.extraHelp.assetLimitSingle.toLocaleString()} para soltero y $${D.extraHelp.assetLimitCouple.toLocaleString()} para pareja (no cuenta tu casa, un auto ni fondos funerarios).`, pace: 'slow' },
      { text: `Con Ayuda Extra, los copagos de medicamentos genéricos bajan hasta $${D.extraHelp.genericCopay.toFixed(2)} y los de marca hasta $${D.extraHelp.brandCopay.toFixed(2)} por receta en 2026.`, pace: 'slow' },
      { text: 'Algunas personas califican automáticamente - por ejemplo, si tienes ambos Medicare y Medicaid completo, Seguridad de Ingreso Suplementario (SSI), o calificas a través de un Programa de Ahorros de Medicare.', pace: 'long' },
      { text: 'Importante: Las personas que reciben Ayuda Extra no pagan la penalidad por inscripción tardía de la Parte D mientras tengan Ayuda Extra.', pace: 'long' },
      { text: 'Esto es solo una revisión preliminar. La elegibilidad final la determina el Seguro Social o tu estado.', pace: 'short' },
      {
        text: '¿Quieres que un asesor licenciado te ayude a verificar si podrías calificar?',
        options: [
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Ayuda con costos de Medicare', value: 'edu_cost_help' },
          { label: 'Volver a temas', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_penalties: [
      { text: 'Medicare tiene penalidades por inscripción tardía en la Parte B y Parte D si retrasas la inscripción sin tener otra cobertura acreditable.', pace: 'long' },
      { text: 'Penalidad de Parte B: Generalmente se añade un 10% a tu prima mensual de Parte B por cada período completo de 12 meses que pudiste haber tenido Parte B pero no te inscribiste. Esta penalidad generalmente es permanente y continúa mientras tengas Parte B.', pace: 'slow' },
      { text: 'Penalidad de Parte D: Puede aplicar si pasas 63 días o más seguidos sin Parte D u otra cobertura de medicamentos acreditable. El monto se calcula según cuántos meses estuviste sin cobertura y se suma a tu prima de Parte D.', pace: 'slow' },
      { text: 'Importante: Las personas que reciben Ayuda Extra (LIS) no pagan la penalidad por inscripción tardía de la Parte D mientras tengan Ayuda Extra.', pace: 'long' },
      { text: 'Si tienes cobertura de empleador, sindicato, gobierno federal, estatal, plan de retiro, VA, TRICARE o FEHB: no canceles ninguna cobertura actual sin antes consultar con tu administrador de beneficios Y un asesor licenciado. Cancelar podría dejarte sin cobertura o generar penalidades.', pace: 'slow' },
      { text: 'No puedo calcular una penalidad final sin saber las fechas exactas. Un asesor licenciado puede revisar tu cronograma.', pace: 'short' },
      {
        text: '¿Quieres que un asesor revise tu situación?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_employer: [
      { text: 'Si tienes cobertura a través de un empleador, sindicato, trabajo federal, estatal, plan de retiro, VA, TRICARE o FEHB (Beneficios de Salud para Empleados Federales), es importante entender cómo funciona con Medicare.', pace: 'long' },
      { text: 'Para muchas personas, la cobertura del empleador puede ser acreditable - lo que significa que cuenta como cobertura válida y puede ayudarte a evitar penalidades por inscripción tardía si retrasas la Parte B o Parte D.', pace: 'long' },
      { text: '⚠️ Importante: Nunca canceles cobertura de empleador, sindicato, federal, estatal, de retiro, VA, TRICARE o FEHB sin antes hablar con tu administrador de beneficios Y un asesor licenciado. Cancelar podría dejarte sin cobertura o generar penalidades.', pace: 'slow' },
      { text: 'Las reglas dependen del tamaño del empleador, si estás trabajando activamente o jubilado, y el tipo de cobertura que tienes. Un asesor licenciado puede revisar tu situación específica.', pace: 'long' },
      {
        text: '¿Quieres que un asesor revise cómo funciona tu cobertura con Medicare?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_plan_loss: [
      { text: 'Si perdiste tu plan de Medicare Advantage o Parte D - por ejemplo, porque el plan salió de tu área o te mudaste - podrías calificar para un Período Especial de Inscripción.', pace: 'long' },
      { text: 'Un Período Especial de Inscripción te permite inscribirte en un nuevo plan fuera de los períodos regulares de inscripción.', pace: 'long' },
      { text: 'El tiempo que tienes depende de la razón - por ejemplo, mudarte fuera del área de servicio del plan, perder otra cobertura, o que tu plan termine su contrato con Medicare.', pace: 'long' },
      { text: 'Un asesor puede revisar tu situación y ayudarte a encontrar un nuevo plan que se ajuste a tus necesidades.', pace: 'short' },
      {
        text: '¿Quieres ayuda para encontrar un nuevo plan?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_linet: [
      { text: 'LI NET significa Transición para Recién Elegibles de Bajos Ingresos. Es un programa temporal de cobertura de medicamentos recetados de la Parte D de Medicare.', pace: 'long' },
      { text: 'LI NET proporciona cobertura temporal inmediata de Parte D para ciertos beneficiarios de Medicare de bajos ingresos que aún no están inscritos en un plan de medicamentos de Medicare. Ayuda a cubrir el vacío cuando alguien recién califica para Medicaid o Ayuda Extra y necesita sus medicamentos de inmediato.', pace: 'long' },
      { text: 'Este no es un plan permanente - brinda cobertura temporal hasta que un plan regular de Parte D o Medicare Advantage con cobertura de medicamentos entre en vigor.', pace: 'long' },
      { text: 'No puedo prometer elegibilidad para LI NET, pero si esta situación se parece a la tuya, un asesor licenciado puede ayudar a verificar si LI NET aplica y conectarte.', pace: 'short' },
      {
        text: '¿Quieres que un asesor revise tu situación?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_medication: [
      { text: 'Para revisar medicamentos correctamente, necesitaría el nombre del medicamento, dosis, frecuencia, farmacia y código postal.', pace: 'long' },
      { text: 'La cobertura de medicamentos puede cambiar por plan, farmacia, nivel/tier, autorización previa, terapia escalonada y límites de cantidad. Incluso dentro de la misma compañía de seguros, diferentes planes pueden cubrir el mismo medicamento de forma distinta.', pace: 'slow' },
      { text: 'No puedo confirmar si un medicamento específico está cubierto sin datos reales del formulario del plan. Un asesor licenciado puede revisar tus medicamentos contra los planes disponibles en tu área.', pace: 'long' },
      {
        text: '¿Quieres que un asesor licenciado revise tus medicamentos?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_prequalify: [
      { text: 'Puedo ayudarte con una pre-evaluación para ver qué programas valdría la pena revisar. Vamos paso a paso. Te haré una pregunta a la vez.', pace: 'long' },
      { text: 'Primero: ¿En qué estado vives?', options: [{ label: 'New York', value: 'state_NY' }, { label: 'New Jersey', value: 'state_NJ' }, { label: 'Connecticut', value: 'state_CT' }, { label: 'Florida', value: 'state_FL' }, { label: 'Otro', value: 'state_other' }], pace: 'short' },
    ],
    edu_enrollment: [
      { text: 'Medicare tiene momentos específicos en los que puedes inscribirte, cambiar o revisar tu cobertura. El período correcto depende de tu situación.', pace: 'long' },
      { text: 'Inscripción Inicial: Normalmente comienza 3 meses antes del mes en que cumples 65 años, incluye el mes de tu cumpleaños y termina 3 meses después.', pace: 'slow' },
      { text: 'Inscripción Anual: Del 15 de octubre al 7 de diciembre. Puedes revisar o cambiar tu cobertura de Medicare Advantage y Parte D para el año siguiente.', pace: 'slow' },
      { text: 'Inscripción Abierta de Medicare Advantage: Del 1 de enero al 31 de marzo. Si ya tienes un plan Medicare Advantage, puedes cambiarte a otro o regresar a Medicare Original.', pace: 'slow' },
      { text: 'Inscripción General: Del 1 de enero al 31 de marzo. Puede aplicar si no te inscribiste en la Parte A o B cuando eras elegible por primera vez y no calificas para un Período Especial. Pueden aplicar penalidades.', pace: 'slow' },
      { text: 'Período Especial: Ciertos eventos de vida - como mudarte, perder cobertura, calificar para Medicaid u obtener Ayuda Extra - pueden permitirte inscribirte o cambiar planes fuera de los períodos normales.', pace: 'slow' },
      { text: 'Las reglas de Medicare Supplement pueden ser diferentes a las de Advantage y Parte D. Pueden depender del estado, cuándo te inscribiste en Parte B y si aplican preguntas de salud.', pace: 'long' },
      {
        text: '¿Quieres ayuda para verificar qué período de inscripción puede aplicar en tu caso?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_advantage_types: [
      { text: 'Los planes Medicare Advantage son ofrecidos por compañías de seguros privadas aprobadas por Medicare. Hay varios tipos, y la disponibilidad varía por condado, estado y aseguradora.', pace: 'long' },
      { text: 'HMO: Normalmente requiere usar médicos y hospitales dentro de la red del plan. Muchos requieren un médico primario y referidos para especialistas. Puede tener costos más bajos.', pace: 'slow' },
      { text: 'PPO: Normalmente ofrece más flexibilidad para ver proveedores fuera de la red, pero puede costar más. Generalmente no se necesitan referidos para especialistas.', pace: 'slow' },
      { text: 'PFFS (Pago por Servicio Privado): El plan decide las tarifas de pago. Siempre confirma que el proveedor acepte el plan antes de recibir servicios.', pace: 'slow' },
      { text: 'SNP (Plan de Necesidades Especiales): Diseñado para personas con necesidades específicas - como Medicare + Medicaid (D-SNP), ciertas condiciones crónicas (C-SNP), o cuidado institucional (I-SNP). La elegibilidad debe verificarla un agente licenciado.', pace: 'slow' },
      { text: 'MSA (Cuenta de Ahorros Médicos): Combina un plan con deducible alto con una cuenta de ahorros donde el plan deposita dinero. Normalmente no incluye Parte D. Requiere entender bien el deducible y la cobertura de medicamentos.', pace: 'slow' },
      {
        text: 'El tipo correcto depende de tus médicos, medicamentos, condado y cómo prefieres recibir atención. ¿Quieres que un asesor revise tus opciones?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_comparison: [
      { text: 'Aquí tienes una comparación simple de los principales tipos de cobertura de Medicare:', pace: 'short' },
      { text: 'Medicare Original: Partes A y B administradas por el gobierno federal. Cubre servicios hospitalarios y médicos. Puedes ver a cualquier médico que acepte Medicare. No cubre todo - puedes tener deducibles y coseguros.', pace: 'long' },
      { text: 'Medicare Advantage (Parte C): Ofrecido por compañías privadas aprobadas por Medicare. Cambia cómo recibes tus beneficios de Parte A y B. Puede incluir extras como dental, visión, audición y Parte D. Reglas, redes y costos varían.', pace: 'long' },
      { text: 'Medicare Supplement (Medigap): Funciona con Medicare Original. Ayuda a pagar deducibles, coseguros y copagos. No reemplaza Medicare Original. Normalmente no incluye Parte D.', pace: 'long' },
      { text: 'Parte D: Planes independientes de medicamentos recetados o incluidos en algunos planes Medicare Advantage. Cada plan tiene su propio formulario y red de farmacias.', pace: 'long' },
      { text: 'Qué combinación es adecuada para ti depende de tu salud, presupuesto, médicos, medicamentos y ubicación. Un asesor licenciado puede revisar tu situación específica.', pace: 'long' },
      {
        text: '¿Quieres que un asesor te ayude a comparar tus opciones?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_snp: [
      { text: 'Los Planes de Necesidades Especiales (SNP) son un tipo de plan Medicare Advantage para personas con ciertas necesidades específicas.', pace: 'long' },
      { text: 'Hay tres tipos principales:', pace: 'short' },
      { text: '• D-SNP (SNP de Doble Elegibilidad) — para personas con Medicare y Medicaid. Estos planes coordinan beneficios de Medicare y Medicaid.', pace: 'slow' },
      { text: '• C-SNP (SNP de Condición Crónica) — para personas con ciertas condiciones crónicas como diabetes, enfermedad cardíaca o trastornos pulmonares crónicos.', pace: 'slow' },
      { text: '• I-SNP (SNP Institucional) — para personas que viven en un hogar de ancianos o requieren cuidado de enfermería en casa.', pace: 'slow' },
      { text: 'La disponibilidad de SNP depende de tu condado y planes disponibles. No todos los condados tienen todos los tipos de SNP. Un asesor licenciado puede verificar qué SNP están disponibles en tu área.', pace: 'long' },
      {
        text: '¿Quieres aprender sobre otros temas o solicitar una revisión?',
        options: [
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Más opciones', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_medicaid: (() => {
      const msgs: QueuedBotMessage[] = [
        { text: 'Medicaid es un programa estatal y federal que puede ayudar a personas con ingresos y recursos limitados a pagar costos médicos. Para personas con Medicare, Medicaid a veces puede ayudar con primas, costos compartidos y servicios que Medicare no cubre completamente.', pace: 'long' },
      ];
      if (state === 'NY') {
        msgs.push({ text: 'Como seleccionó New York, las reglas se manejan bajo las guías del estado de New York.', pace: 'long' });
        msgs.push({ text: 'Para 2026, la guía general de ingreso de Medicaid para muchos adultos aged, blind, or disabled en New York es aproximadamente $1,836 al mes para una persona o $2,489 al mes para pareja, después del disregard estándar. Los límites de recursos pueden estar alrededor de $33,038 para una persona o $44,796 para pareja en muchas categorías non-MAGI, pero algunas reglas y categorías pueden variar.', pace: 'slow' });
        msgs.push({ text: 'New York también tiene Medicare Savings Programs, y el MSP de New York no usa prueba de assets/resources. Personas con Medicaid o MSP también pueden conectarse con Extra Help/LIS para costos de medicinas Part D.', pace: 'long' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'Como seleccionó New Jersey, Medicaid para personas aged, blind, or disabled puede revisarse bajo las reglas de New Jersey Medicaid / NJ FamilyCare.', pace: 'long' });
        msgs.push({ text: 'Para 2026, la guía de New Jersey para ciertos programas especiales de Medicaid aged, blind, disabled usa 100% del Federal Poverty Level: aproximadamente $1,330 al mes para una persona con máximo de recursos de $4,000, y aproximadamente $1,804 al mes para pareja con máximo de recursos de $6,000. Estos números pueden cambiar y diferentes categorías de Medicaid pueden usar reglas distintas.', pace: 'slow' });
        msgs.push({ text: 'New Jersey también tiene NJSave, Medicare Savings Programs, PAAD y Senior Gold dependiendo de la situación.', pace: 'long' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Como seleccionó Connecticut, Medicaid normalmente se maneja a través de HUSKY Health. HUSKY C es la categoría comúnmente relacionada con personas aged, blind, disabled o que necesitan servicios de long-term care.', pace: 'long' });
        msgs.push({ text: 'Las reglas de HUSKY C son específicas por categoría. Materiales oficiales de Connecticut DSS muestran que pueden aplicar límites de assets, incluyendo $1,600 para una persona en ciertas categorías, y las reglas para parejas pueden depender de la categoría o reglas de community spouse. Connecticut también tiene Medicare Savings Programs con límites de ingreso más altos que regular HUSKY C en muchos casos.', pace: 'slow' });
        msgs.push({ text: 'Como las categorías de Connecticut Medicaid son complejas, lo correcto es revisar HUSKY C, MSP, Extra Help/LIS y posibles reglas de spend-down con Connecticut DSS o un asesor licenciado.', pace: 'long' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Como seleccionó Florida, la elegibilidad de Medicaid para personas aged or disabled normalmente la determina Florida DCF, mientras AHCA administra el programa Medicaid.', pace: 'long' });
        msgs.push({ text: 'Florida tiene diferentes categorías de Medicaid. Para algunas categorías SSI-related o aged/disabled, las reglas de ingreso y recursos pueden ser estrictas. Para Medicaid de long-term care, las reglas financieras de Florida comúnmente usan un límite de ingreso alrededor de $2,982 al mes en 2026, con límites de assets que dependen de la categoría y situación matrimonial.', pace: 'slow' });
        msgs.push({ text: 'Como las categorías de Florida Medicaid varían, la persona puede revisar SSI-related Medicaid, Medicare Savings Programs, Extra Help/LIS, long-term care Medicaid si aplica, y recursos de Florida SHINE o DCF con un asesor licenciado.', pace: 'long' });
      } else {
        msgs.push({ text: 'La elegibilidad de Medicaid depende de ingresos, recursos, edad, discapacidad, situación del hogar y categoría del programa. Cada estado tiene sus propias reglas y límites.', pace: 'long' });
      }
      msgs.push({ text: 'Esto es información educativa general, no una determinación final de elegibilidad. La agencia estatal o un asesor licenciado debe verificar categoría, ingresos, recursos, situación del hogar y reglas del programa.', pace: 'short' });
      msgs.push({
        text: 'También puede interesarle:',
        options: [
          { label: 'Medicare Savings Programs', value: 'edu_msp' },
          { label: 'Ayuda Estatal para Medicinas', value: 'edu_spap' },
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Volver a temas', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_msp: (() => {
      const msgs: QueuedBotMessage[] = [
        { text: 'Los Programas de Ahorros de Medicare (MSP) son programas estatales que pueden ayudar a personas con ingresos y recursos limitados a pagar primas, deducibles, coaseguros y copagos de Medicare. Cada estado administra estos programas, y los límites de ingresos y recursos pueden variar.', pace: 'long' },
      ];
      if (state === 'NY') {
        msgs.push({ text: 'Programa de Ahorros de Medicare de New York:\n• New York NO usa límite de assets/recursos para MSP.\n• QMB (Beneficiario de Medicare Calificado) — puede ayudar a pagar prima de Parte B, prima de Parte A si aplica, deducibles, coaseguros y copagos. QMB no es retroactivo en NY. Límite: alrededor de $1,856/mes soltero o $2,509/mes pareja (138% FPL con disregard de $20).\n• QI-1 (Individuo Calificado-1) — puede ayudar a pagar solo prima de Parte B. Retroactivo hasta 3 meses mismo año. No se puede con Medicaid. Límite: alrededor de $2,494/mes soltero o $3,375/mes pareja (186% FPL con disregard de $20).\n• Las personas con MSP en NY generalmente se conectan con Extra Help/LIS para costos de medicamentos Part D.', pace: 'slow' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'Programas de Ahorros de Medicare de New Jersey (límites anuales 2026):\n• QMB — puede ayudar a pagar primas de Parte A/B, deducibles, coaseguros, copagos. Ingreso: $15,960/año soltero, $21,640/año pareja. Recursos: $9,950 soltero, $14,910 pareja.\n• SLMB — puede ayudar a pagar solo prima de Parte B. Ingreso: $19,152/año soltero, $25,968/año pareja. Recursos: $9,950 soltero, $14,910 pareja.\n• QI — puede ayudar a pagar solo prima de Parte B. Debe aplicar cada año. Por orden de llegada. Ingreso: $21,546/año soltero, $29,214/año pareja.\n• NJSave se usa para aplicar. NJ Division of Aging Services: 1-800-792-9745.', pace: 'slow' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Programa de Ahorros de Medicare de Connecticut (efectivo 1 de marzo de 2026):\n• QMB — puede ayudar a pagar prima de Parte B, deducibles, coaseguros, copagos. Ingreso: $2,807/mes soltero, $3,806/mes pareja.\n• SLMB — puede ayudar a pagar solo prima de Parte B. Ingreso: $3,073/mes soltero, $4,166/mes pareja.\n• ALMB — puede ayudar a pagar solo prima de Parte B. Sujeto a fondos. No disponible con Medicaid. Ingreso: $3,272/mes soltero, $4,437/mes pareja.\n• Los tres niveles MSP de CT auto-conectan con Extra Help/LIS para costos de medicamentos Part D.', pace: 'slow' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Programas de Ahorros de Medicare de Florida (use base federal 2026 — verifique con FL Medicaid/DCF):\n• QMB — puede ayudar a pagar primas de Parte A/B, deducibles, coaseguros. Ingreso: $1,350/mes soltero, $1,824/mes pareja. Recursos: $9,950 soltero, $14,910 pareja.\n• SLMB — puede ayudar a pagar prima de Parte B. Ingreso: $1,616/mes soltero, $2,184/mes pareja.\n• QI — puede ayudar a pagar prima de Parte B. Ingreso: $1,816/mes soltero, $2,455/mes pareja. Por orden de llegada.\n• Las reglas exactas de Florida deben verificarse con la agencia estatal, SHINE o un asesor licenciado.', pace: 'slow' });
      } else {
        msgs.push({ text: 'Límites federales MSP 2026:\n• QMB — alrededor de $1,350/mes soltero, $1,824/mes pareja. Recursos: $9,950 soltero, $14,910 pareja.\n• SLMB — alrededor de $1,616/mes soltero, $2,184/mes pareja.\n• QI — alrededor de $1,816/mes soltero, $2,455/mes pareja.\n• QDWI — alrededor de $5,405/mes soltero, $7,299/mes pareja. Recursos: $4,000 soltero, $6,000 pareja.', pace: 'slow' });
      }
      msgs.push({ text: 'Esta es información educativa general, no una determinación final de elegibilidad. Un asesor licenciado o la agencia estatal puede ayudar a verificar su situación.', pace: 'short' });
      msgs.push({
        text: 'También puede interesarle:',
        options: [
          { label: 'Ayuda Estatal para Medicinas', value: 'edu_spap' },
          { label: 'Medicaid', value: 'edu_medicaid' },
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Volver a temas', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_spap: (() => {
      const msgs: QueuedBotMessage[] = [];
      if (state === 'NY') {
        msgs.push({ text: 'Como seleccionó New York, el programa estatal principal de ayuda con medicinas es EPIC, Elderly Pharmaceutical Insurance Coverage. EPIC puede ayudar a seniors elegibles de New York con costos de medicamentos de Medicare Part D.', pace: 'slow' });
        msgs.push({ text: 'Guía general EPIC 2026:\n• Residente de New York\n• 65 años o más\n• Inscrito o elegible para Medicare Part D\n• Ingreso anual hasta $75,000 si es soltero o $100,000 si es casado\n• EPIC trabaja con Medicare Part D\n• Personas con Medicaid completo generalmente pueden tener reglas diferentes, pero personas con Medicaid spend-down pueden necesitar revisión.', pace: 'slow' });
        msgs.push({ text: 'Recurso oficial: New York State Department of Health EPIC program.', pace: 'short' });
      } else if (state === 'NJ') {
        msgs.push({ text: 'Como seleccionó New Jersey, los programas estatales principales de ayuda con medicinas son PAAD y Senior Gold.', pace: 'slow' });
        msgs.push({ text: 'Guía general PAAD 2026:\n• Residente de New Jersey\n• 65 años o más, o entre 18–64 recibiendo beneficios de Discapacidad del Seguro Social\n• Ingreso anual menor de $54,943 si es soltero o menor de $62,390 si es casado\n• Debe estar inscrito en Medicare Part D\n• PAAD puede reducir costos de medicinas cubiertas — el formulario del plan y reglas de farmacia todavía importan.', pace: 'slow' });
        msgs.push({ text: 'Guía general Senior Gold 2026:\n• Residente de New Jersey\n• Mismos requisitos de edad/discapacidad que PAAD\n• Generalmente para personas por encima de los límites de PAAD\n• Rango anual: $54,943–$64,943 si es soltero, o $62,390–$72,390 si es casado\n• Estructura de costos diferente a PAAD.', pace: 'slow' });
        msgs.push({ text: 'Recurso oficial: NJSave / New Jersey Division of Aging Services.', pace: 'short' });
      } else if (state === 'CT') {
        msgs.push({ text: 'Como seleccionó Connecticut, es importante no presentar ConnPACE como un programa activo actual para beneficiarios de Medicare. Información oficial de Connecticut indica que ConnPACE dejó de ser un benefit plan soportado desde el 1 de enero de 2014.', pace: 'slow' });
        msgs.push({ text: 'Para ayuda con medicinas en Connecticut, las opciones principales a revisar son:\n• Extra Help/LIS\n• Medicare Savings Programs\n• Medicaid/HUSKY si aplica\n• Revisión del formulario Part D\n• Revisión de farmacia preferida\n• Programas de fabricantes cuando aplique.', pace: 'slow' });
        msgs.push({ text: 'Recurso oficial: Connecticut DSS / HUSKY Health.', pace: 'short' });
      } else if (state === 'FL') {
        msgs.push({ text: 'Como seleccionó Florida, Florida no tiene un programa estatal verificado tipo EPIC o PAAD dentro de esta base de conocimiento.', pace: 'slow' });
        msgs.push({ text: 'Para ayuda con medicinas en Florida, las opciones principales a revisar son:\n• Extra Help/LIS\n• Medicare Savings Programs\n• Medicaid si aplica\n• Revisión del formulario Part D\n• Revisión de farmacia preferida\n• Florida SHINE\n• Programas de fabricantes cuando aplique.', pace: 'slow' });
        msgs.push({ text: 'Recurso oficial: Florida DCF / Florida SHINE.', pace: 'short' });
      } else {
        msgs.push({ text: 'Los programas estatales de asistencia con medicamentos (SPAP) varían por estado. No todos los estados tienen un SPAP activo. Algunos estados tienen programas fuertes, otros no. Un asesor licenciado puede ayudar a revisar lo que pueda estar disponible en su estado.', pace: 'slow' });
      }
      msgs.push({ text: 'Esto es información educativa general, no una determinación final de elegibilidad.', pace: 'short' });
      msgs.push({
        text: 'También puede interesarle:',
        options: [
          { label: 'Medicare Savings Programs', value: 'edu_msp' },
          { label: 'Medicaid', value: 'edu_medicaid' },
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Volver a temas', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      });
      return msgs;
    })(),
    edu_special_benefits: [
      { text: 'Algunas personas tienen beneficios más allá del Medicare estándar — como planes de sindicato o retiro, cobertura de VA o TRICARE, o beneficios por discapacidad. Estos pueden afectar cómo funciona Medicare para usted.', pace: 'long' },
      {
        text: '¿Cuál situación aplica a usted?',
        options: [
          { label: 'Tengo beneficios de unión o retiro', value: 'edu_union_retiree' },
          { label: 'Tengo VA o TRICARE', value: 'edu_va_tricare' },
          { label: 'Recibo beneficios por discapacidad', value: 'edu_disability' },
          { label: 'Quiero revisar doctores o medicinas', value: 'edu_medication' },
          { label: 'Quiero hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Volver a temas de Medicare', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_union_retiree: [
      { text: 'Los planes de sindicato y de retiro de empleadores pueden variar mucho. Algunos planes continúan como su cobertura principal cuando cumple 65 años. Otros se vuelven secundarios a Medicare y requieren que usted se inscriba en las Partes A y B de Medicare para mantener sus beneficios de sindicato o retiro activos.', pace: 'long' },
      { text: 'Las reglas dependen de su contrato sindical específico o del plan de retiro del empleador. Los planes varían en si cubren medicamentos, dental, visión y cómo coordinan con Medicare.', pace: 'long' },
      { text: '⚠️ Nunca cancele su cobertura de sindicato o retiro sin antes hablar con el administrador de su plan y un asesor licenciado. Cancelar podría hacerle perder beneficios permanentemente o generar penalidades de inscripción tardía en Medicare.', pace: 'slow' },
      { text: 'Un asesor licenciado puede revisar cómo su plan específico de sindicato o retiro coordina con Medicare y si algún cambio tiene sentido para su situación.', pace: 'long' },
      {
        text: '¿Quiere que un asesor revise su situación?',
        options: [
          { label: 'Volver a Beneficios Especiales', value: 'edu_special_benefits' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_va_tricare: [
      { text: 'Si tiene beneficios de VA o TRICARE, Medicare funciona de manera diferente para usted que para la mayoría de las personas.', pace: 'long' },
      { text: 'Beneficios de VA: El sistema de salud de VA es separado de Medicare. La cobertura de VA no reemplaza un plan Medicare Advantage o Parte D. Puede tener tanto VA como Medicare, pero no coordinan automáticamente — el VA cubre atención en instalaciones del VA, mientras que Medicare cubre atención fuera del sistema del VA. Tener la Parte B de Medicare le da más flexibilidad si alguna vez necesita atención fuera del VA.', pace: 'long' },
      { text: 'TRICARE: Si usted es un militar retirado o dependiente con TRICARE, generalmente necesita inscribirse en la Parte B de Medicare para mantener su cobertura de TRICARE activa. TRICARE for Life requiere inscripción en ambas, Parte A y Parte B de Medicare. No inscribirse en la Parte B puede hacer que pierda su cobertura de TRICARE.', pace: 'long' },
      { text: '⚠️ Importante: Si pierde sus beneficios de VA o TRICARE, puede calificar para un Período de Inscripción Especial de Medicare. No espere — el tiempo es importante.', pace: 'slow' },
      { text: 'Un asesor licenciado puede ayudarle a entender cómo VA y TRICARE coordinan con Medicare y qué opciones pueden ser adecuadas para su situación.', pace: 'long' },
      {
        text: '¿Quiere que un asesor revise su situación?',
        options: [
          { label: 'Volver a Beneficios Especiales', value: 'edu_special_benefits' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_disability: [
      { text: 'Si recibe el Seguro de Discapacidad del Seguro Social (SSDI), generalmente se vuelve elegible para Medicare después de un período de espera de 24 meses desde que comienzan sus beneficios por discapacidad.', pace: 'long' },
      { text: 'Algunas condiciones califican para Medicare sin la espera de 24 meses: ELA (enfermedad de Lou Gehrig) califica de inmediato, y la Enfermedad Renal en Etapa Terminal (ESRD) tiene sus propias reglas separadas.', pace: 'long' },
      { text: 'Durante el período de espera de 24 meses, es posible que necesite otras opciones de cobertura. Un asesor licenciado puede revisar qué puede estar disponible en su área.', pace: 'long' },
      { text: 'Una vez que tenga Medicare por discapacidad, también puede calificar para Ayuda Extra / LIS para reducir los costos de medicamentos recetados, u otros programas de asistencia dependiendo de sus ingresos y recursos.', pace: 'long' },
      { text: 'A los 65 años, su cobertura de Medicare continúa automáticamente — no necesita reinscribirse.', pace: 'long' },
      {
        text: '¿Quiere saber más o hablar con un asesor?',
        options: [
          { label: 'Ayuda Extra / LIS', value: 'edu_extra_help' },
          { label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Volver a Beneficios Especiales', value: 'edu_special_benefits' },
          { label: 'Volver a temas', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi: [
      { text: 'Esta área es importante porque SSI, SSDI, Medicaid, beneficios por discapacidad y Medicare no funcionan igual.', pace: 'long' },
      { text: 'SSI por sí solo normalmente no significa que alguien tenga Medicare. Muchas personas con SSI pueden tener Medicaid, dependiendo de las reglas del estado. Medicare antes de los 65 años normalmente depende de SSDI después del período requerido, o de condiciones especiales como ALS o ESRD.', pace: 'long' },
      { text: 'Si alguien tiene SSDI, Medicare puede comenzar después del período requerido por discapacidad. Si alguien tiene 65 años o más, las reglas de Medicare también dependen del historial de trabajo. Muchas personas reciben Parte A sin prima si ellos o su cónyuge tienen aproximadamente 40 quarters, normalmente unos 10 años.', pace: 'long' },
      { text: 'Si alguien no tiene suficientes quarters para Parte A sin prima, puede que pueda comprar Parte A. Si tiene ingresos y recursos limitados, el estado puede ayudar a pagar Parte A y/o Parte B mediante Medicare Savings Programs como QMB.', pace: 'long' },
      { text: 'Clear Point puede ayudarle a entender qué preguntas hacer, pero la elegibilidad final debe confirmarse con Social Security, Medicare, Medicaid o la agencia estatal.', pace: 'short' },
      {
        text: '¿Cuál de estas situaciones aplica a usted?',
        options: [
          { label: 'Recibo SSI', value: 'edu_ssdi_ssi_ssi' },
          { label: 'Recibo SSDI', value: 'edu_ssdi_ssi_ssdi' },
          { label: 'Tengo Medicaid', value: 'edu_ssdi_ssi_medicaid' },
          { label: 'Tengo menos de 65 años', value: 'edu_ssdi_ssi_under65' },
          { label: 'Tengo 65 años o más', value: 'edu_ssdi_ssi_over65' },
          { label: 'No tengo 40 quarters de trabajo', value: 'edu_ssdi_ssi_quarters' },
          { label: 'Necesito ayuda pagando Parte A o Parte B', value: 'edu_ssdi_ssi_partab' },
          { label: 'Quiero hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: 'Volver a temas de Medicare', value: 'edu_back_to_topics' },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_ssi: [
      { text: 'SSI por sí solo no significa automáticamente Medicare. Muchas personas con SSI pueden tener Medicaid, dependiendo del estado. Si tiene menos de 65 años, Medicare normalmente requiere SSDI después del período requerido, o una condición especial como ALS o ESRD. La elegibilidad debe confirmarse con Social Security o Medicaid.', pace: 'long' },
      {
        text: '¿Quiere continuar o hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_ssdi: [
      { text: 'Personas aprobadas para SSDI pueden ser elegibles para Medicare después del período requerido por discapacidad. Deben confirmar el tiempo exacto con Social Security. Algunas condiciones como ALS o ESRD pueden tener reglas diferentes.', pace: 'long' },
      {
        text: '¿Quiere continuar o hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_medicaid: [
      { text: 'Tener Medicaid no significa automáticamente que tenga Medicare. Medicaid y Medicare son programas separados. Algunas personas tienen ambos, lo que se llama elegibilidad dual. Si tiene menos de 65 años y tiene Medicaid pero no Medicare, es posible que necesite verificar si aplica SSDI, ALS o ESRD. La elegibilidad debe confirmarse con Medicaid o Social Security.', pace: 'long' },
      {
        text: '¿Quiere continuar o hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_under65: [
      { text: 'Personas menores de 65 años pueden calificar para Medicare por SSDI después del período requerido, ESRD o ALS. SSI por sí solo no es lo mismo que SSDI y no lleva automáticamente a Medicare. Debe verificar su situación con Social Security para entender cuándo comenzaría Medicare si tiene SSDI.', pace: 'long' },
      {
        text: '¿Quiere continuar o hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_over65: [
      { text: 'A los 65 años o más, la elegibilidad de Medicare depende en parte del historial de trabajo. Muchas personas reciben Parte A sin prima si ellos o su cónyuge tienen aproximadamente 40 quarters, normalmente unos 10 años de trabajo cubierto por Medicare. Si no tiene suficientes quarters, todavía puede obtener Parte A pagando una prima. Los Medicare Savings Programs del estado pueden ayudar en algunos casos.', pace: 'long' },
      {
        text: '¿Quiere continuar o hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_quarters: [
      { text: 'Aproximadamente 40 quarters, normalmente unos 10 años de trabajo cubierto por Medicare, pueden permitir Parte A sin prima. El historial de trabajo del cónyuge también puede importar en algunas situaciones. Si no tiene suficientes quarters, Parte A puede requerir una prima mensual. Algunas personas con ingresos y recursos limitados pueden recibir ayuda pagando esa prima mediante un Medicare Savings Program del estado como QMB. La elegibilidad debe confirmarse con Social Security o la agencia estatal.', pace: 'slow' },
      {
        text: '¿Quiere continuar o hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
    edu_ssdi_ssi_partab: [
      { text: 'Programas como QMB pueden ayudar a pagar la prima de Parte A si aplica, la prima de Parte B, y a veces deducibles, coaseguro y copagos. La elegibilidad depende de ingresos, recursos, reglas del estado y estatus de Medicare. Tendría que solicitar a través de la agencia estatal de Medicaid para ver si puede calificar. Clear Point no puede determinar elegibilidad, pero un asesor puede ayudarle a entender qué preguntas hacer.', pace: 'long' },
      {
        text: '¿Quiere hablar con un asesor?',
        options: [
          { label: 'Volver al tema SSI / SSDI', value: 'edu_ssdi_ssi' },
          { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
          { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
        ],
        pace: 'short',
      },
    ],
  };

  const messages = language === 'es' ? es[topic] : en[topic];
  return messages || (language === 'es'
    ? [{ text: 'Vamos paso a paso. ¿Qué parte de Medicare te gustaría entender?', pace: 'long' }]
    : [{ text: "Let's go step by step. What part of Medicare would you like to understand?", pace: 'long' }]);
}

/* ------------------------------------------------------------------ */
/*  Medicare 2026 Verified Data - sourced from CMS, SSA, state sites  */
/* ------------------------------------------------------------------ */

const MEDICARE_2026 = {
  partA: {
    deductible: 1736,
    coinsuranceDay61to90: 434,
    coinsuranceLifetimeReserve: 868,
    snfCoinsuranceDay21to100: 217,
    premium30to39Quarters: 311,
    premiumLessThan30Quarters: 565,
  },
  partB: {
    standardPremium: 202.90,
    annualDeductible: 283,
    irmaaBrackets: [
      { individual: 109000, joint: 218000, adjustment: 0, totalPremium: 202.90 },
      { individual: 137000, joint: 274000, adjustment: 81.20, totalPremium: 284.10 },
      { individual: 171000, joint: 342000, adjustment: 202.90, totalPremium: 405.80 },
      { individual: 205000, joint: 410000, adjustment: 324.60, totalPremium: 527.50 },
      { individual: 500000, joint: 750000, adjustment: 446.30, totalPremium: 649.20 },
      { individual: Infinity, joint: Infinity, adjustment: 487.00, totalPremium: 689.90 },
    ],
  },
  partD: {
    maxDeductible: 615,
    oopCap: 2100,
    initialCoverageCoinsurance: 0.25,
    catastrophicCoinsurance: 0,
  },
  extraHelp: {
    incomeLimitSingle: 1995,
    incomeLimitCouple: 2705,
    assetLimitSingle: 17220,
    assetLimitCouple: 34360,
    genericCopay: 5.10,
    brandCopay: 12.65,
    autoEnroll: ['Medicaid', 'QMB', 'SLMB', 'QI', 'SSI'],
  },
  msp: {
    // NY: no asset/resource limit for MSP; only two categories QMB + QI-1 (SLMB phased out)
    NY: {
      QMB: { singleIncome: 1856, coupleIncome: 2509, singleAsset: 0, coupleAsset: 0, note: 'No asset limit in NY. 138% FPL with $20 disregard.' },
      QI1: { singleIncome: 2494, coupleIncome: 3375, singleAsset: 0, coupleAsset: 0, note: 'QI-1 at 186% FPL with $20 disregard. May be retroactive up to 3 months. Cannot combine with Medicaid.' },
    },
    // NJ: annual income limits, federal asset limits
    NJ: {
      QMB: { singleIncome: 1330, coupleIncome: 1803, singleAsset: 9950, coupleAsset: 14910, note: '$15,960/yr single, $21,640/yr couple' },
      SLMB: { singleIncome: 1596, coupleIncome: 2164, singleAsset: 9950, coupleAsset: 14910, note: '$19,152/yr single, $25,968/yr couple' },
      QI: { singleIncome: 1796, coupleIncome: 2435, singleAsset: 9950, coupleAsset: 14910, note: '$21,546/yr single, $29,214/yr couple' },
    },
    // CT: QMB/SLMB/ALMB (not QI); income limits effective March 1, 2026
    CT: {
      QMB: { singleIncome: 2807, coupleIncome: 3806, singleAsset: 0, coupleAsset: 0, note: 'Effective March 1, 2026. Described as similar to Medigap for cost-sharing.' },
      SLMB: { singleIncome: 3073, coupleIncome: 4166, singleAsset: 0, coupleAsset: 0, note: 'Part B premium only.' },
      ALMB: { singleIncome: 3272, coupleIncome: 4437, singleAsset: 0, coupleAsset: 0, note: 'Part B premium only. Subject to funding. Not available with Medicaid.' },
    },
    // FL: federal baseline if no verified state-specific limits
    FL: {
      QMB: { singleIncome: 1350, coupleIncome: 1824, singleAsset: 9950, coupleAsset: 14910, note: 'Federal baseline. Verify with FL Medicaid/DCF.' },
      SLMB: { singleIncome: 1616, coupleIncome: 2184, singleAsset: 9950, coupleAsset: 14910, note: 'Federal baseline. Part B premium only.' },
      QI: { singleIncome: 1816, coupleIncome: 2455, singleAsset: 9950, coupleAsset: 14910, note: 'Federal baseline. First-come, first-served.' },
      QDWI: { singleIncome: 5405, coupleIncome: 7299, singleAsset: 4000, coupleAsset: 6000, note: 'Part A premium only for disabled working individuals under 65.' },
    },
  },
  spap: {
    NY_EPIC: {
      incomeSingle: 75000,
      incomeCouple: 100000,
      ageMin: 65,
      note: 'NY State Pharmaceutical Assistance Program. Works with Part D. Separate from Extra Help — some may have both.',
      requiresPartD: true,
    },
    NJ_PAAD: {
      incomeSingle: 54943,
      incomeCouple: 62390,
      genericCopay: 5,
      brandCopay: 7,
      note: 'Must enroll in Part D. NJ resident 65+ or 18-64 on SSDI.',
    },
    NJ_SeniorGold: {
      incomeSingleMin: 54943,
      incomeSingleMax: 64943,
      incomeCoupleMin: 62390,
      incomeCoupleMax: 72390,
      note: 'No resource limit. Copay $15 + 50% of remaining drug cost. After $2,000 OOP single / $3,000 couple → flat $15.',
    },
    FL: { note: 'No verified statewide SPAP like NY EPIC or NJ PAAD. Prioritize Extra Help, MSP, Medicaid, SHINE, Part D formulary review.' },
    CT: { note: 'ConnPACE is no longer an active supported benefit plan as of January 1, 2014. For prescription help, review Extra Help/LIS, Medicaid if applicable, MSP, Part D formulary review.' },
  },
};

/* --- State-specific programs --- */

function getStatePrograms(state: string, language: ChatLanguage): QueuedBotMessage[] {
  const D = MEDICARE_2026;
  const programs: Record<string, Record<ChatLanguage, QueuedBotMessage[]>> = {
    NY: {
      en: [
        { text: 'New York has several programs to help Medicare beneficiaries. Here are the 2026 details:', pace: 'long' },
        { text: 'Medicare Savings Program — New York does NOT use an asset/resource limit for MSP. There are two main categories:', pace: 'long' },
        { text: `• QMB (Qualified Medicare Beneficiary) — may help pay Part B premium, Part A premium if applicable, Medicare deductibles, coinsurance, and copayments. QMB is not retroactive in NY. Benefits generally begin the month after the application month. For 2026, income limit is around $1,856/month for one person or $2,509/month for a couple (138% FPL with $20 disregard).`, pace: 'slow' },
        { text: `• QI-1 (Qualifying Individual-1) — may help pay Part B premium only. May be retroactive up to 3 months within the same calendar year. Cannot be received together with Medicaid. For 2026, income limit is around $2,494/month for one person or $3,375/month for a couple (186% FPL with $20 disregard).`, pace: 'slow' },
        { text: `• EPIC (Elderly Pharmaceutical Insurance Coverage) — New York's State Pharmaceutical Assistance Program. Helps eligible NY seniors 65+ with Part D prescription drug costs. Income guidelines: up to about $${D.spap.NY_EPIC.incomeSingle.toLocaleString()} single / $${D.spap.NY_EPIC.incomeCouple.toLocaleString()} married. Must be enrolled in or eligible for Medicare Part D. EPIC is separate from Extra Help — some people may have both, depending on eligibility.`, pace: 'slow' },
        { text: '• Extra Help/LIS — If someone gets an MSP in New York, they are generally connected to Extra Help/LIS for Part D drug costs.', pace: 'long' },
        { text: '• New York Medicaid — can help people with limited income and resources, but eligibility depends on category, income, resources, household situation, age, disability status, immigration status, and state rules.', pace: 'long' },
        { text: 'This is general educational information, not a final eligibility decision. A licensed advisor or the state agency can help verify your situation.', pace: 'short' },
        {
          text: 'Would you like a free review?',
          options: [
            { label: 'Ask another question', value: 'edu_back_to_topics' },
            { label: 'More options', value: 'edu_back_to_topics' },
            { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
      es: [
        { text: 'New York tiene varios programas para ayudar a beneficiarios de Medicare. Aquí los detalles de 2026:', pace: 'long' },
        { text: 'Medicare Savings Program — New York NO usa límite de assets/recursos para MSP. Hay dos categorías principales:', pace: 'long' },
        { text: `• QMB (Beneficiario de Medicare Calificado) — puede ayudar a pagar la prima de Parte B, prima de Parte A si aplica, deducibles, coaseguros y copagos de Medicare. QMB no es retroactivo en NY. Los beneficios generalmente comienzan el mes después de la solicitud. Para 2026, el límite de ingreso es alrededor de $1,856/mes para una persona o $2,509/mes para pareja (138% FPL con disregard de $20).`, pace: 'slow' },
        { text: `• QI-1 (Individuo Calificado-1) — puede ayudar a pagar solo la prima de Parte B. Puede ser retroactivo hasta 3 meses dentro del mismo año calendario. No se puede recibir junto con Medicaid. Para 2026, el límite de ingreso es alrededor de $2,494/mes para una persona o $3,375/mes para pareja (186% FPL con disregard de $20).`, pace: 'slow' },
        { text: `• EPIC (Cobertura de Seguro Farmacéutico para Personas Mayores) — programa estatal de asistencia farmacéutica de New York. Ayuda a seniors elegibles de 65+ con costos de medicamentos de Parte D. Guía de ingresos: hasta aproximadamente $${D.spap.NY_EPIC.incomeSingle.toLocaleString()} soltero / $${D.spap.NY_EPIC.incomeCouple.toLocaleString()} casado. Debe estar inscrito o ser elegible para Medicare Parte D. EPIC es separado de Extra Help — algunas personas pueden tener ambos, dependiendo de elegibilidad.`, pace: 'slow' },
        { text: '• Extra Help/LIS — Si alguien recibe MSP en New York, generalmente se conecta con Extra Help/LIS para costos de medicamentos de Parte D.', pace: 'long' },
        { text: '• Medicaid de New York — puede ayudar a personas con ingresos y recursos limitados, pero la elegibilidad depende de categoría, ingresos, recursos, situación del hogar, edad, estatus de discapacidad, estatus migratorio y reglas estatales.', pace: 'long' },
        { text: 'Esta es información educativa general, no una determinación final de elegibilidad. Un asesor licenciado o la agencia estatal puede ayudar a verificar su situación.', pace: 'short' },
        {
          text: '¿Quieres una revisión gratuita?',
          options: [
            { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
            { label: 'Más opciones', value: 'edu_back_to_topics' },
            { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
    },
    NJ: {
      en: [
        { text: 'New Jersey has several programs to help Medicare beneficiaries. Here are the 2026 details:', pace: 'long' },
        { text: 'Medicare Savings Programs — QMB, SLMB, and QI:', pace: 'long' },
        { text: `• QMB — may help pay Part A and/or Part B premiums, deductibles, coinsurance, and copayments. 2026 income limits: $15,960/year single, $21,640/year couple. Resource limits: $9,950 single, $14,910 couple.`, pace: 'slow' },
        { text: `• SLMB — may help pay Part B premium only. 2026 income limits: $19,152/year single, $25,968/year couple. Resource limits: $9,950 single, $14,910 couple.`, pace: 'slow' },
        { text: `• QI — may help pay Part B premium only. Must apply every year. Usually first-come, first-served. 2026 income limits: $21,546/year single, $29,214/year couple. Resource limits: $9,950 single, $14,910 couple.`, pace: 'slow' },
        { text: `• PAAD (Pharmaceutical Assistance to the Aged and Disabled) — helps with prescription costs. 2026 income limits: under $${D.spap.NJ_PAAD.incomeSingle.toLocaleString()} single / $${D.spap.NJ_PAAD.incomeCouple.toLocaleString()} couple. Copays: $5 generics, $7 brand. NJ resident 65+ or 18-64 on SSDI. Must enroll in Part D.`, pace: 'slow' },
        { text: `• Senior Gold Prescription Discount Program — for income above PAAD limits. 2026: $${D.spap.NJ_SeniorGold.incomeSingleMin.toLocaleString()}–$${D.spap.NJ_SeniorGold.incomeSingleMax.toLocaleString()} single / $${D.spap.NJ_SeniorGold.incomeCoupleMin.toLocaleString()}–$${D.spap.NJ_SeniorGold.incomeCoupleMax.toLocaleString()} couple. No resource limit. Copay: $15 + 50% of remaining drug cost. After $2,000 OOP single / $3,000 couple → flat $15.`, pace: 'slow' },
        { text: '• NJSave is commonly used to apply for QMB, SLMB, QI, PAAD, and Senior Gold. NJ Division of Aging Services hotline: 1-800-792-9745.', pace: 'long' },
        { text: 'This is general educational information, not a final eligibility decision. A licensed advisor or the state agency can help verify your situation.', pace: 'short' },
        {
          text: 'Would you like a free review?',
          options: [
            { label: 'Ask another question', value: 'edu_back_to_topics' },
            { label: 'More options', value: 'edu_back_to_topics' },
            { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
      es: [
        { text: 'New Jersey tiene varios programas para ayudar a beneficiarios de Medicare. Aquí los detalles de 2026:', pace: 'long' },
        { text: 'Programas de Ahorros de Medicare — QMB, SLMB y QI:', pace: 'long' },
        { text: '• QMB — puede ayudar a pagar primas de Parte A y/o B, deducibles, coaseguros y copagos. Límites de ingreso 2026: $15,960/año soltero, $21,640/año pareja. Límites de recursos: $9,950 soltero, $14,910 pareja.', pace: 'slow' },
        { text: '• SLMB — puede ayudar a pagar solo la prima de Parte B. Límites de ingreso 2026: $19,152/año soltero, $25,968/año pareja. Límites de recursos: $9,950 soltero, $14,910 pareja.', pace: 'slow' },
        { text: '• QI — puede ayudar a pagar solo la prima de Parte B. Debe aplicar cada año. Generalmente por orden de llegada. Límites de ingreso 2026: $21,546/año soltero, $29,214/año pareja. Límites de recursos: $9,950 soltero, $14,910 pareja.', pace: 'slow' },
        { text: `• PAAD (Asistencia Farmacéutica para Personas Mayores y Discapacitadas) — ayuda con costos de medicamentos. Límites 2026: menos de $${D.spap.NJ_PAAD.incomeSingle.toLocaleString()} soltero / $${D.spap.NJ_PAAD.incomeCouple.toLocaleString()} casado. Copagos: $5 genéricos, $7 marca. Residente de NJ 65+ o 18-64 en SSDI. Debe inscribirse en Parte D.`, pace: 'slow' },
        { text: `• Senior Gold — para ingresos por encima de PAAD. 2026: $${D.spap.NJ_SeniorGold.incomeSingleMin.toLocaleString()}–$${D.spap.NJ_SeniorGold.incomeSingleMax.toLocaleString()} soltero / $${D.spap.NJ_SeniorGold.incomeCoupleMin.toLocaleString()}–$${D.spap.NJ_SeniorGold.incomeCoupleMax.toLocaleString()} casado. Sin límite de recursos. Copago: $15 + 50% del costo restante. Después de $2,000 OOP soltero / $3,000 pareja → $15 fijo.`, pace: 'slow' },
        { text: '• NJSave se usa comúnmente para aplicar a QMB, SLMB, QI, PAAD y Senior Gold. Línea de NJ Division of Aging Services: 1-800-792-9745.', pace: 'long' },
        { text: 'Esta es información educativa general, no una determinación final de elegibilidad. Un asesor licenciado o la agencia estatal puede ayudar a verificar su situación.', pace: 'short' },
        {
          text: '¿Quieres una revisión gratuita?',
          options: [
            { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
            { label: 'Más opciones', value: 'edu_back_to_topics' },
            { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
    },
    CT: {
      en: [
        { text: 'Connecticut has programs that may help Medicare beneficiaries. Effective March 1, 2026:', pace: 'long' },
        { text: 'Medicare Savings Programs — Connecticut has three MSP levels (QMB, SLMB, ALMB):', pace: 'long' },
        { text: `• QMB — may help pay Part B premium, Medicare deductibles, coinsurance, copayments, and Part A premium if applicable. Connecticut describes QMB as similar to a Medigap policy because it helps with Medicare cost-sharing. Monthly income: $2,807 single / $3,806 couple.`, pace: 'slow' },
        { text: `• SLMB — may help pay Part B premium only. Monthly income: $3,073 single / $4,166 couple.`, pace: 'slow' },
        { text: `• ALMB (Additional Low-Income Medicare Beneficiary) — may help pay Part B premium only. Subject to available program funding. Not available if the person receives Medicaid. Monthly income: $3,272 single / $4,437 couple.`, pace: 'slow' },
        { text: '• All three Connecticut MSP levels also automatically connect people to Extra Help/LIS for Part D drug costs.', pace: 'long' },
        { text: '• Important: ConnPACE is no longer an active supported benefit plan as of January 1, 2014. For prescription help, the main options to review are Extra Help/LIS, Medicaid if applicable, MSP, Part D formulary review, and pharmacy network review.', pace: 'long' },
        { text: 'This is general educational information, not a final eligibility decision. A licensed advisor or Connecticut DSS can help verify your situation.', pace: 'short' },
        {
          text: 'Would you like a free review?',
          options: [
            { label: 'Ask another question', value: 'edu_back_to_topics' },
            { label: 'More options', value: 'edu_back_to_topics' },
            { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
      es: [
        { text: 'Connecticut tiene programas que pueden ayudar a beneficiarios de Medicare. Efectivo el 1 de marzo de 2026:', pace: 'long' },
        { text: 'Programas de Ahorros de Medicare — Connecticut tiene tres niveles MSP (QMB, SLMB, ALMB):', pace: 'long' },
        { text: '• QMB — puede ayudar a pagar la prima de Parte B, deducibles, coaseguros, copagos de Medicare y prima de Parte A si aplica. Connecticut describe QMB como similar a una póliza Medigap porque ayuda con el costo compartido. Ingreso mensual: $2,807 soltero / $3,806 pareja.', pace: 'slow' },
        { text: '• SLMB — puede ayudar a pagar solo la prima de Parte B. Ingreso mensual: $3,073 soltero / $4,166 pareja.', pace: 'slow' },
        { text: '• ALMB (Beneficiario de Medicare de Bajos Ingresos Adicional) — puede ayudar a pagar solo la prima de Parte B. Sujeto a fondos disponibles. No disponible si recibe Medicaid. Ingreso mensual: $3,272 soltero / $4,437 pareja.', pace: 'slow' },
        { text: '• Los tres niveles MSP de Connecticut también conectan automáticamente con Extra Help/LIS para costos de medicamentos de Parte D.', pace: 'long' },
        { text: '• Importante: ConnPACE ya no es un plan de beneficios activo desde el 1 de enero de 2014. Para ayuda con medicamentos, las opciones principales son Extra Help/LIS, Medicaid si aplica, MSP, revisión de formulario de Parte D y red de farmacias.', pace: 'long' },
        { text: 'Esta es información educativa general, no una determinación final de elegibilidad. Un asesor licenciado o DSS de Connecticut puede ayudar a verificar su situación.', pace: 'short' },
        {
          text: '¿Quieres una revisión gratuita?',
          options: [
            { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
            { label: 'Más opciones', value: 'edu_back_to_topics' },
            { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
    },
    FL: {
      en: [
        { text: 'Florida has several resources for Medicare beneficiaries, but unlike New York or New Jersey, Florida does not have a clearly verified statewide SPAP equivalent to NY EPIC or NJ PAAD/Senior Gold.', pace: 'long' },
        { text: 'Here is what is available in Florida:', pace: 'short' },
        { text: '• SHINE (Serving Health Insurance Needs of Elders) — free, unbiased Medicare counseling from trained volunteers who can help you understand your options.', pace: 'long' },
        { text: '• Medicare Savings Programs — for 2026, use the federal baseline: QMB around $1,350/month single / $1,824 couple; SLMB around $1,616/month single / $2,184 couple; QI around $1,816/month single / $2,455 couple. Federal resource limits: $9,950 single / $14,910 married for QMB/SLMB/QI. Exact Florida rules must be verified through the state agency, SHINE, Medicaid, or a licensed advisor.', pace: 'long' },
        { text: '• Extra Help / LIS — federal program that may help with Part D prescription drug costs.', pace: 'long' },
        { text: '• Florida Medicaid — for dual-eligible beneficiaries. Eligibility depends on income, resources, age, disability, household situation, and program category.', pace: 'long' },
        { text: 'The best approach in Florida is usually to review Extra Help eligibility, MSP eligibility, and find a Part D plan with a formulary that covers your prescriptions at the lowest total cost. A licensed advisor can help with all of this.', pace: 'long' },
        { text: 'This is general educational information, not a final eligibility decision. Florida SHINE and a licensed advisor can help verify your situation.', pace: 'short' },
        {
          text: 'Would you like a free review?',
          options: [
            { label: 'Ask another question', value: 'edu_back_to_topics' },
            { label: 'More options', value: 'edu_back_to_topics' },
            { label: 'Speak with an advisor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
      es: [
        { text: 'Florida tiene varios recursos para beneficiarios de Medicare, pero a diferencia de New York o New Jersey, Florida no tiene un SPAP estatal verificado equivalente a NY EPIC o NJ PAAD/Senior Gold.', pace: 'long' },
        { text: 'Esto es lo que está disponible en Florida:', pace: 'short' },
        { text: '• SHINE (Sirviendo las Necesidades de Seguro de Salud de Personas Mayores) — consejería gratuita e imparcial de Medicare por voluntarios entrenados.', pace: 'long' },
        { text: '• Programas de Ahorros de Medicare — para 2026, use la base federal: QMB alrededor de $1,350/mes soltero / $1,824 pareja; SLMB alrededor de $1,616/mes soltero / $2,184 pareja; QI alrededor de $1,816/mes soltero / $2,455 pareja. Límites federales de recursos: $9,950 soltero / $14,910 casado para QMB/SLMB/QI. Las reglas exactas de Florida deben verificarse con la agencia estatal, SHINE, Medicaid o un asesor licenciado.', pace: 'long' },
        { text: '• Ayuda Extra / LIS — programa federal que puede ayudar con costos de medicamentos de Parte D.', pace: 'long' },
        { text: '• Medicaid de Florida — para beneficiarios con doble elegibilidad. La elegibilidad depende de ingresos, recursos, edad, discapacidad, situación del hogar y categoría del programa.', pace: 'long' },
        { text: 'El mejor enfoque en Florida generalmente es revisar la elegibilidad para Ayuda Extra, MSP, y encontrar un plan de Parte D con un formulario que cubra tus medicamentos al menor costo total. Un asesor licenciado puede ayudar con todo esto.', pace: 'long' },
        { text: 'Esta es información educativa general, no una determinación final de elegibilidad. Florida SHINE y un asesor licenciado pueden ayudar a verificar su situación.', pace: 'short' },
        {
          text: '¿Quieres una revisión gratuita?',
          options: [
            { label: 'Hacer otra pregunta', value: 'edu_back_to_topics' },
            { label: 'Más opciones', value: 'edu_back_to_topics' },
            { label: 'Hablar con un asesor', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          ],
          pace: 'short',
        },
      ],
    },
  };

  return programs[state]?.[language] || (language === 'es'
    ? [{ text: 'En este momento no tengo programas específicos para ese estado, pero un asesor puede revisar las opciones disponibles.', options: [{ label: 'Solicitar revisión', value: 'request_review', icon: <Calendar className="w-4 h-4" /> }], pace: 'long' }]
    : [{ text: 'I do not have state-specific programs for that state at this moment, but an advisor can review available options.', options: [{ label: 'Request a review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> }], pace: 'long' }]);
}

/* ------------------------------------------------------------------ */
/*  Remaining constants (kept from original - modified where needed)   */
/* ------------------------------------------------------------------ */

const CHATBOT_CONTEXT = {
  agencyName: 'Clear Point Senior Advisors',
  assistantName: 'Zara',
  phone: '1-866-310-8702',
  phoneHref: 'tel:18663108702',
  hours: 'Monday-Friday, 9am-6pm ET',
  statesServed: 'NY, FL, CT, and NJ',
  identity: 'Independent Medicare insurance agency',
  services: [
    'Medicare Advantage',
    'Medicare Supplement',
    'Part D prescription drug plans',
    'Annual plan reviews',
    'Extra Help / LIS basic guidance',
    'Doctor and prescription review with a licensed advisor',
    'General Medicare education',
  ],
  routeToAdvisorFor: [
    'final plan recommendations',
    'provider or drug checks',
    'enrollment help',
    'eligibility decisions',
    'plan availability by county',
    'specific benefits, costs, networks, or coverage',
  ],
  communicationRules: [
    'one idea per message',
    'one question at a time',
    'short senior-friendly wording',
    'no pressure',
    'no guarantees',
    'English and Spanish support',
  ],
};

const DISCLAIMERS = {
  en: {
    privacy:
      'Privacy note: Please do not enter Social Security, Medicare ID, banking, or medical record information in this chat. This chat is for general Medicare education and basic pre-screening only. We are not Medicare, Medicaid, Social Security, or a government agency.',
    general:
      'Final eligibility and plan availability depend on official rules, location, providers, medications, and carrier approval.',
    consent:
      'By providing your phone number, you agree that Clear Point Senior Advisors may contact you by phone or text about Medicare plan review options. Consent is not required to use our services. Message and data rates may apply. You can opt out at any time.',
    eligibility:
      'This is only a pre-check. Final eligibility is determined by the state, Medicare, or Social Security Administration.',
    consentContact:
      'If you want personalized help, I can ask for your permission to have a licensed agent contact you.',
    neverCancel:
      'Important: Never cancel employer, union, federal, state, retiree, VA, TRICARE, FEHB, or COBRA coverage without first speaking with your benefits administrator and a licensed advisor. Canceling could leave you without coverage or trigger penalties.',
  },
  es: {
    privacy:
      'Nota de privacidad: No envíes Seguro Social, número de Medicare, información bancaria ni récords médicos por este chat. Este chat es solo para educación general sobre Medicare y pre-evaluación básica. No somos Medicare, Medicaid, Seguro Social ni una agencia del gobierno.',
    general:
      'La elegibilidad final y disponibilidad de planes dependen de reglas oficiales, ubicación, doctores, medicinas y aprobación del carrier.',
    consent:
      'Al proporcionar tu número de teléfono, aceptas que Clear Point Senior Advisors pueda contactarte por llamada o mensaje de texto sobre opciones de revisión de planes de Medicare. El consentimiento no es requerido para usar nuestros servicios. Pueden aplicar cargos por mensajes y datos. Puedes cancelar en cualquier momento.',
    eligibility:
      'Esto es solo una revisión preliminar. La elegibilidad final la determina el estado, Medicare o la Administración del Seguro Social.',
    consentContact:
      'Si deseas ayuda personalizada, puedo pedir tu permiso para que un agente licenciado te contacte.',
    neverCancel:
      'Importante: Nunca canceles cobertura de empleador, sindicato, federal, estatal, de retiro, VA, TRICARE, FEHB o COBRA sin antes consultar con tu administrador de beneficios y un asesor licenciado. Cancelar podría dejarte sin cobertura o generar penalidades.',
  },
};

const MEDICARE_TOPIC_KEYWORDS_EN: [string, string][] = [
  ['part a', 'Medicare Parts A & B'],
  ['part b', 'Medicare Parts A & B'],
  ['how medicare works', 'Medicare Parts A & B'],
  ['how does medicare work', 'Medicare Parts A & B'],
  ['how medicare', 'Medicare Parts A & B'],
  ['medicare basics', 'Medicare Parts A & B'],
  ['what is medicare', 'Medicare Parts A & B'],
  ['advantage', 'Medicare Advantage'],
  ['part c', 'Medicare Advantage'],
  ['supplement', 'Medicare Supplement'],
  ['medigap', 'Medicare Supplement'],
  ['part d', 'Part D'],
  ['prescription', 'Part D'],
  ['drug', 'Part D'],
  ['extra help', 'Extra Help / LIS'],
  ['lis', 'Extra Help / LIS'],
  ['low income subsidy', 'Extra Help / LIS'],
  ['medicaid', 'Medicaid'],
  ['msp', 'Medicare Savings Programs'],
  ['medicare savings', 'Medicare Savings Programs'],
  ['qmb', 'Medicare Savings Programs'],
  ['slmb', 'Medicare Savings Programs'],
  ['qi', 'Medicare Savings Programs'],
  ['qdwi', 'Medicare Savings Programs'],
  ['penalty', 'Penalties'],
  ['late enrollment', 'Penalties'],
  ['lost my plan', 'Plan Loss'],
  ['plan left', 'Plan Loss'],
  ['lose my plan', 'Plan Loss'],
  ['can\'t refill', 'Plan Loss'],
  ['cannot refill', 'Plan Loss'],
  ['no drug coverage', 'Plan Loss'],
  ['spap', 'State Programs'],
  ['pharmaceutical assistance', 'State Programs'],
  ['epic', 'State Programs'],
  ['paad', 'State Programs'],
  ['senior gold', 'State Programs'],
  ['shine', 'State Programs'],
  ['enrollment period', 'Enrollment'],
  ['sign up', 'Enrollment'],
  ['enroll', 'Enrollment'],
  ['turning 65', 'Enrollment'],
  ['new to medicare', 'Enrollment'],
  ['employer', 'Employer Coverage'],
  ['union', 'Employer Coverage'],
  ['federal employee', 'Employer Coverage'],
  ['fehb', 'Employer Coverage'],
  ['tricare', 'Employer Coverage'],
  ['va coverage', 'Employer Coverage'],
  ['veteran', 'Employer Coverage'],
  ['retiree', 'Employer Coverage'],
  ['retirement', 'Employer Coverage'],
  ['state worker', 'Employer Coverage'],
  ['work coverage', 'Employer Coverage'],
  ['cobra', 'Employer Coverage'],
  ['spouse', 'Employer Coverage'],
  ['help paying medicare', 'Medicare Savings Programs'],
  ['help paying part b', 'Medicare Savings Programs'],
  ['help with medicare costs', 'Medicare Savings Programs'],
  ['help with costs', 'Medicare Savings Programs'],
  ['help with copays', 'Medicare Savings Programs'],
  ['help with premium', 'Medicare Savings Programs'],
  ['help with prescriptions', 'State Programs'],
  ['drug costs', 'State Programs'],
  ['low income', 'Medicare Savings Programs'],
  ['limited income', 'Medicare Savings Programs'],
  ['d-snp', 'Medicare Savings Programs'],
  ['dual eligible', 'Medicare Savings Programs'],
  ['dually eligible', 'Medicare Savings Programs'],
  ['medicare and medicaid', 'Medicare Savings Programs'],
  ['help with part d', 'State Programs'],
  ['can i get help', 'Medicare Savings Programs'],
  ['linet', 'LI NET'],
  ['li net', 'LI NET'],
  ['limited income newly', 'LI NET'],
  ['temporary part d', 'LI NET'],
  ['my medicine', 'Medication'],
  ['my medication', 'Medication'],
  ['drug covered', 'Medication'],
  ['formulary', 'Medication'],
  ['tier', 'Medication'],
  ['prior authorization', 'Medication'],
  ['step therapy', 'Medication'],
  ['pharmacy', 'Medication'],
  ['dental', 'Extra Benefits'],
  ['vision', 'Extra Benefits'],
  ['hearing', 'Extra Benefits'],
  ['transportation', 'Extra Benefits'],
  ['food card', 'Extra Benefits'],
  ['otc', 'Extra Benefits'],
  ['over the counter', 'Extra Benefits'],
  ['grocery', 'Extra Benefits'],
  ['do i qualify', 'Prequalify'],
  ['hmo', 'Advantage Types'],
  ['ppo', 'Advantage Types'],
  ['pffs', 'Advantage Types'],
  ['snp', 'Advantage Types'],
  ['d-snp', 'Advantage Types'],
  ['c-snp', 'Advantage Types'],
  ['i-snp', 'Advantage Types'],
  ['msa plan', 'Advantage Types'],
  ['special needs plan', 'Advantage Types'],
  ['medical savings account', 'Advantage Types'],
  ['plan types', 'Advantage Types'],
  ['advantage types', 'Advantage Types'],
  ['enrollment period', 'Enrollment'],
  ['sign up', 'Enrollment'],
  ['enroll', 'Enrollment'],
  ['turning 65', 'Enrollment'],
  ['new to medicare', 'Enrollment'],
  ['when can i', 'Enrollment'],
  ['change plan', 'Enrollment'],
  ['switch plan', 'Enrollment'],
  ['open enrollment', 'Enrollment'],
  ['difference between', 'Comparison'],
  ['original medicare vs', 'Comparison'],
  ['advantage vs', 'Comparison'],
  ['compare medicare', 'Comparison'],
  ['medicare options', 'Comparison'],
  ['medicare choices', 'Comparison'],
];

const MEDICARE_TOPIC_KEYWORDS_ES: [string, string][] = [
  ['parte a', 'Medicare Parts A & B'],
  ['parte b', 'Medicare Parts A & B'],
  ['cómo funciona medicare', 'Medicare Parts A & B'],
  ['como funciona medicare', 'Medicare Parts A & B'],
  ['qué es medicare', 'Medicare Parts A & B'],
  ['que es medicare', 'Medicare Parts A & B'],
  ['conceptos básicos de medicare', 'Medicare Parts A & B'],
  ['conceptos basicos de medicare', 'Medicare Parts A & B'],
  ['advantage', 'Medicare Advantage'],
  ['parte c', 'Medicare Advantage'],
  ['suplemento', 'Medicare Supplement'],
  ['medigap', 'Medicare Supplement'],
  ['parte d', 'Part D'],
  ['receta', 'Part D'],
  ['medicamento', 'Part D'],
  ['ayuda extra', 'Extra Help / LIS'],
  ['lis', 'Extra Help / LIS'],
  ['subsidio', 'Extra Help / LIS'],
  ['medicaid', 'Medicaid'],
  ['msp', 'MSP'],
  ['programas de ahorro', 'MSP'],
  ['qmb', 'MSP'],
  ['slmb', 'MSP'],
  ['qdwi', 'MSP'],
  ['penalidad', 'Penalties'],
  ['inscripción tardía', 'Penalties'],
  ['inscripcion tardia', 'Penalties'],
  ['perdí mi plan', 'Plan Loss'],
  ['perdi mi plan', 'Plan Loss'],
  ['perder mi plan', 'Plan Loss'],
  ['no puedo reabastecer', 'Plan Loss'],
  ['sin cobertura de medicamentos', 'Plan Loss'],
  ['asistencia farmacéutica', 'State Programs'],
  ['asistencia farmaceutica', 'State Programs'],
  ['epic', 'State Programs'],
  ['paad', 'State Programs'],
  ['senior gold', 'State Programs'],
  ['shine', 'State Programs'],
  ['período de inscripción', 'Enrollment'],
  ['periodo de inscripcion', 'Enrollment'],
  ['inscribirme', 'Enrollment'],
  ['cumplir 65', 'Enrollment'],
  ['nuevo en medicare', 'Enrollment'],
  ['empleador', 'Employer Coverage'],
  ['sindicato', 'Employer Coverage'],
  ['empleado federal', 'Employer Coverage'],
  ['fehb', 'Employer Coverage'],
  ['tricare', 'Employer Coverage'],
  ['va', 'Employer Coverage'],
  ['veterano', 'Employer Coverage'],
  ['jubilado', 'Employer Coverage'],
  ['retiro', 'Employer Coverage'],
  ['trabajador estatal', 'Employer Coverage'],
  ['cobertura de trabajo', 'Employer Coverage'],
  ['cobra', 'Employer Coverage'],
  ['esposo', 'Employer Coverage'],
  ['esposa', 'Employer Coverage'],
  ['ayuda con costos', 'Medicaid'],
  ['ayuda con gastos', 'Medicaid'],
  ['ayuda para pagar medicare', 'MSP'],
  ['ayuda pagando la parte b', 'MSP'],
  ['ayuda pagando medicare', 'MSP'],
  ['ayuda con copagos', 'MSP'],
  ['ayuda con prima', 'MSP'],
  ['ayuda con medicamentos', 'Part D'],
  ['bajos ingresos', 'MSP'],
  ['ingresos limitados', 'MSP'],
  ['recursos limitados', 'MSP'],
  ['qi', 'MSP'],
  ['d-snp', 'MSP'],
  ['dsnp', 'MSP'],
  ['doble elegibilidad', 'MSP'],
  ['elegibilidad doble', 'MSP'],
  ['medicare y medicaid', 'MSP'],
  ['necesito ayuda para pagar', 'MSP'],
  ['necesito ayuda con los gastos', 'Medicaid'],
  ['linet', 'LI NET'],
  ['li net', 'LI NET'],
  ['transición para recién elegibles', 'LI NET'],
  ['transicion para recien elegibles', 'LI NET'],
  ['parte d temporal', 'LI NET'],
  ['mi medicina', 'Medication'],
  ['mis medicinas', 'Medication'],
  ['medicamento cubierto', 'Medication'],
  ['formulario', 'Medication'],
  ['nivel', 'Medication'],
  ['autorización previa', 'Medication'],
  ['autorizacion previa', 'Medication'],
  ['terapia escalonada', 'Medication'],
  ['farmacia', 'Medication'],
  ['dental', 'Extra Benefits'],
  ['visión', 'Extra Benefits'],
  ['vision', 'Extra Benefits'],
  ['audición', 'Extra Benefits'],
  ['audicion', 'Extra Benefits'],
  ['transporte', 'Extra Benefits'],
  ['tarjeta de comida', 'Extra Benefits'],
  ['otc', 'Extra Benefits'],
  ['venta libre', 'Extra Benefits'],
  ['supermercado', 'Extra Benefits'],
  ['califico', 'Prequalify'],
  ['soy elegible', 'Prequalify'],
  ['verificar si califico', 'Prequalify'],
  ['pre-evaluación', 'Prequalify'],
  ['preevaluacion', 'Prequalify'],
  ['hmo', 'Advantage Types'],
  ['ppo', 'Advantage Types'],
  ['pffs', 'Advantage Types'],
  ['snp', 'Advantage Types'],
  ['d-snp', 'Advantage Types'],
  ['c-snp', 'Advantage Types'],
  ['i-snp', 'Advantage Types'],
  ['msa', 'Advantage Types'],
  ['plan de necesidades', 'Advantage Types'],
  ['tipos de planes', 'Advantage Types'],
  ['diferencia entre', 'Comparison'],
  ['comparar medicare', 'Comparison'],
  ['medicare original vs', 'Comparison'],
  ['opciones de medicare', 'Comparison'],
  ['cuándo puedo', 'Enrollment'],
  ['cuando puedo', 'Enrollment'],
  ['cambiar plan', 'Enrollment'],
  ['inscripción abierta', 'Enrollment'],
  ['inscripcion abierta', 'Enrollment'],
];

const SENSITIVE_KEYWORDS = [
  'social security',
  'ssn',
  'medicare id',
  'medicare number',
  'mbi',
  'bank',
  'routing number',
  'credit card',
  'debit card',
  'payment',
  'medical record',
  'full medical history',
  'seguro social',
  'número de seguro',
  'numero de seguro',
  'número de medicare',
  'numero de medicare',
  'cuenta bancaria',
  'tarjeta de crédito',
  'tarjeta de credito',
  'récord médico',
  'record médico',
  'historial médico completo',
  'historial medico completo',
];

const PERSONALIZED_KEYWORDS = [
  'best plan',
  'which plan',
  'recommend',
  'compare plans',
  'doctor covered',
  'my doctor',
  'drug covered',
  'my prescription',
  'formulary',
  'enroll',
  'sign up',
  'qualify',
  'eligible',
  'cheapest',
  'lowest premium',
  'provider network',
  'mejor plan',
  'cuál plan',
  'cual plan',
  'recomienda',
  'comparar planes',
  'mi doctor',
  'mi médico',
  'mi medico',
  'medicina cubierta',
  'medicamento cubierto',
  'inscribirme',
  'califico',
  'elegible',
  'más barato',
  'mas barato',
];

const REVIEW_KEYWORDS = [
  'plan review',
  'free review',
  'call me',
  'appointment',
  'advisor',
  'agent',
  'help me review',
  'contact me',
  'revisión',
  'revision',
  'llámame',
  'llamame',
  'cita',
  'asesor',
  'agente',
  'contactarme',
  'revisar opciones',
];

const OUT_OF_SCOPE_KEYWORDS = [
  'medical advice',
  'diagnosis',
  'symptom',
  'emergency',
  'legal advice',
  'tax advice',
  'lawsuit',
  'irs',
  'consejo médico',
  'consejo medico',
  'diagnóstico',
  'diagnostico',
  'síntoma',
  'sintoma',
  'emergencia',
  'abogado',
  'impuestos',
];

const INTERRUPT_KEYWORDS_EN = ['stop', 'wait', 'hold on', 'pause', 'hang on', 'one moment'];
const INTERRUPT_KEYWORDS_ES = ['espera', 'para', 'detente', 'un momento', 'alto', 'pausa', 'esperate'];

const DEFAULT_MEMORY: ChatMemory = {
  language: 'en',
  firstName: '',
  lastName: '',
  zip: '',
  phone: '',
  email: '',
  currentCoverage: '',
  interestType: '',
  preferredLanguage: '',
  preferredContactTime: '',
  consentGiven: false,
  dob: '',
  calculatedAge: 0,
  city: '',
  county: '',
  derivedState: '',
  lastTopic: '',
  wantsPlanReview: false,
  state: '',
  educationTopic: '',
  educationStep: 0,
  submitted: false,
  skippedEmail: false,
  discussedTopics: [],
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function getUtms() {
  if (typeof window === 'undefined') return {};
  const p = new URLSearchParams(window.location.search);
  return {
    utm_source: p.get('utm_source') || '',
    utm_medium: p.get('utm_medium') || '',
    utm_campaign: p.get('utm_campaign') || '',
  };
}

function getStoredMemory(initialLanguage: ChatLanguage): ChatMemory {
  if (typeof window === 'undefined') return { ...DEFAULT_MEMORY, language: initialLanguage };

  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (!stored) return { ...DEFAULT_MEMORY, language: initialLanguage };
    const parsed = JSON.parse(stored) as Partial<ChatMemory>;
    return {
      ...DEFAULT_MEMORY,
      ...parsed,
      phone: '',
      email: '',
      language: initialLanguage,
    };
  } catch {
    return { ...DEFAULT_MEMORY, language: initialLanguage };
  }
}

function getMemoryForStorage(memory: ChatMemory) {
  const safeMemory = { ...memory, phone: '', email: '' };
  return safeMemory;
}

function getTypingDelay(text: string, pace: MessagePace = 'short') {
  const shortMin = 800;
  const shortMax = 1400;
  const longMin = 1400;
  const longMax = 2200;
  const slowMin = 2200;
  const slowMax = 3200;
  if (pace === 'slow') {
    return Math.floor(Math.random() * (slowMax - slowMin + 1)) + slowMin;
  }
  const useLongDelay = pace === 'long' || text.length > 160;
  const min = useLongDelay ? longMin : shortMin;
  const max = useLongDelay ? longMax : shortMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function containsAny(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

function detectState(text: string): string {
  const normalized = text.trim().toUpperCase();
  if (normalized.match(/\bNY\b|\bNEW YORK\b|\bNEW\s?YORK\b/i)) return 'NY';
  if (normalized.match(/\bNJ\b|\bNEW JERSEY\b|\bNEW\s?JERSEY\b/i)) return 'NJ';
  if (normalized.match(/\bCT\b|\bCONNECTICUT\b/i)) return 'CT';
  if (normalized.match(/\bFL\b|\bFLORIDA\b/i)) return 'FL';
  return '';
}

function detectMedicareTopic(text: string, language: ChatLanguage): string {
  const low = text.toLowerCase();
  const keywords = language === 'es' ? MEDICARE_TOPIC_KEYWORDS_ES : MEDICARE_TOPIC_KEYWORDS_EN;
  for (const [keyword, topic] of keywords) {
    if (low.includes(keyword)) return topic;
  }
  return '';
}

function detectInterest(text: string): string {
  const low = text.toLowerCase();
  if (low.includes('advantage') || low.includes('part c') || low.includes('parte c')) return 'Medicare Advantage';
  if (low.includes('supplement') || low.includes('medigap') || low.includes('suplemento')) return 'Medicare Supplement';
  if (low.includes('part d') || low.includes('prescription') || low.includes('drug') || low.includes('medicamento') || low.includes('receta')) return 'Part D';
  if (low.includes('extra help') || low.includes('lis') || low.includes('ayuda extra')) return 'Extra Help / LIS';
  if (low.includes('annual') || low.includes('review') || low.includes('revisión') || low.includes('revision')) return 'Annual review';
  return 'General Medicare education';
}

function getEducationMessages(text: string, language: ChatLanguage): { topic: string; messages: QueuedBotMessage[] } {
  const low = text.toLowerCase();
  const reviewOptions = [
    { label: language === 'es' ? 'Explicación simple' : 'Simple explanation', value: 'simple_explanation' },
    { label: language === 'es' ? 'Revisar opciones' : 'Review options', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
  ];

  if (low.includes('advantage') || low.includes('part c') || low.includes('parte c')) {
    return {
      topic: 'Medicare Advantage',
      messages: [
        ...(language === 'es'
          ? [
              { text: 'Claro. Medicare Advantage, también llamado Parte C, es otra forma de recibir tus beneficios de Medicare a través de una compañía privada aprobada por Medicare.', pace: 'long' as MessagePace },
              { text: 'Puede incluir beneficios adicionales, pero depende de tu área y elegibilidad. ¿Quieres una explicación simple o ayuda revisando opciones en tu ZIP code?', options: reviewOptions, pace: 'long' as MessagePace },
            ]
          : [
              { text: 'Of course. Medicare Advantage, also called Part C, is another way to receive your Medicare benefits through a private insurance company approved by Medicare.', pace: 'long' as MessagePace },
              { text: 'It may include extra benefits, but availability depends on your area and eligibility. Would you like a simple explanation or help reviewing options in your ZIP code?', options: reviewOptions, pace: 'long' as MessagePace },
            ]),
      ],
    };
  }

  if (low.includes('supplement') || low.includes('medigap') || low.includes('suplemento')) {
    return {
      topic: 'Medicare Supplement',
      messages: language === 'es'
        ? [
            { text: 'Claro. Medicare Supplement, también llamado Medigap, ayuda a pagar algunos costos que Medicare Original no cubre.', pace: 'long' },
            { text: 'Los planes son diferentes a Medicare Advantage. ¿Quieres una explicación simple o prefieres solicitar una revisión?', options: reviewOptions, pace: 'long' },
          ]
        : [
            { text: 'Of course. Medicare Supplement, also called Medigap, helps pay some costs that Original Medicare does not cover.', pace: 'long' },
            { text: 'These plans are different from Medicare Advantage. Would you like a simple explanation or help requesting a review?', options: reviewOptions, pace: 'long' },
          ],
    };
  }

  if (low.includes('part d') || low.includes('prescription') || low.includes('drug') || low.includes('medicamento') || low.includes('receta')) {
    return {
      topic: 'Part D',
      messages: language === 'es'
        ? [
            { text: 'La Parte D ayuda con medicamentos recetados.', pace: 'short' },
            { text: 'Cada plan tiene su propia lista de medicamentos y farmacias. Para revisar medicinas específicas, un asesor licenciado debe ayudarte.', options: reviewOptions, pace: 'long' },
          ]
        : [
            { text: 'Part D helps with prescription drugs.', pace: 'short' },
            { text: 'Each plan has its own drug list and pharmacies. For specific prescriptions, a licensed advisor should help review the details.', options: reviewOptions, pace: 'long' },
          ],
    };
  }

  if (low.includes('extra help') || low.includes('lis') || low.includes('ayuda extra')) {
    return {
      topic: 'Extra Help / LIS',
      messages: language === 'es'
        ? [
            { text: 'Ayuda Extra, también llamada LIS, puede ayudar con costos de medicamentos Parte D para personas que califican.', pace: 'long' },
            { text: 'No puedo confirmar si calificas por chat. ¿Quieres información general o ayuda solicitando una revisión?', options: reviewOptions, pace: 'long' },
          ]
        : [
            { text: 'Extra Help, also called LIS, may help lower Part D prescription costs for people who qualify.', pace: 'long' },
            { text: 'I cannot confirm eligibility in chat. Would you like general information or help requesting a review?', options: reviewOptions, pace: 'long' },
          ],
    };
  }

  if (low.includes('enrollment') || low.includes('enroll') || low.includes('inscripción') || low.includes('inscripcion')) {
    return {
      topic: 'Enrollment',
      messages: language === 'es'
        ? [
            { text: 'Los períodos de inscripción dependen de tu situación.', pace: 'short' },
            { text: 'Por ejemplo, hay períodos cuando cumples 65, durante la inscripción anual y después de ciertos cambios de vida. ¿Quieres que un asesor revise tu caso?', options: reviewOptions, pace: 'long' },
          ]
        : [
            { text: 'Enrollment periods depend on your situation.', pace: 'short' },
            { text: 'For example, there are periods around turning 65, during annual enrollment, and after certain life changes. Would you like an advisor to review your timing?', options: reviewOptions, pace: 'long' },
          ],
    };
  }

  if (low.includes('hours') || low.includes('phone') || low.includes('call') || low.includes('horario') || low.includes('teléfono') || low.includes('telefono') || low.includes('llamar')) {
    return {
      topic: 'Contact',
      messages: language === 'es'
        ? [
            { text: `Puedes llamar a ${CHATBOT_CONTEXT.phone}.`, pace: 'short' },
            { text: `El horario indicado es ${CHATBOT_CONTEXT.hours}. ¿Quieres que te ayude a solicitar una llamada?`, options: reviewOptions, pace: 'short' },
          ]
        : [
            { text: `You can call ${CHATBOT_CONTEXT.phone}.`, pace: 'short' },
            { text: `The listed hours are ${CHATBOT_CONTEXT.hours}. Would you like help requesting a callback?`, options: reviewOptions, pace: 'short' },
          ],
    };
  }

  if (low.includes('who are you') || low.includes('medicare.gov') || low.includes('cms') || low.includes('government') || low.includes('gobierno')) {
    return {
      topic: 'Agency identity',
      messages: language === 'es'
        ? [
            { text: `${CHATBOT_CONTEXT.agencyName} es una agencia independiente de seguros Medicare.`, pace: 'short' },
            { text: 'No somos Medicare, CMS ni el gobierno de los Estados Unidos. ¿Quieres hacer una pregunta general de Medicare?', options: [{ label: 'Sí', value: 'ask_question' }, { label: 'Solicitar revisión', value: 'request_review' }], pace: 'long' },
          ]
        : [
            { text: `${CHATBOT_CONTEXT.agencyName} is an independent Medicare insurance agency.`, pace: 'short' },
            { text: 'We are not Medicare, CMS, or the U.S. government. Would you like to ask a general Medicare question?', options: [{ label: 'Yes', value: 'ask_question' }, { label: 'Request review', value: 'request_review' }], pace: 'long' },
          ],
    };
  }

  // Fallback with full topic menu so user is never stuck without options
  return {
    topic: detectInterest(text),
    messages: [
      {
        text: language === 'es'
          ? 'Puedo ayudarle con educación general sobre Medicare. Puede escoger un tema abajo o preguntarme sobre Medicare, Medicaid, cobertura de medicinas, ayuda con costos o hablar con un asesor.'
          : 'I can help with general Medicare education. You can choose a topic below, or ask me about Medicare, Medicaid, drug coverage, help with costs, or speaking with an advisor.',
        pace: 'short',
        options: language === 'es' ? TOPIC_GROUPS_ES[0] : TOPIC_GROUPS_EN[0],
      },
    ],
  };
}

function getSuccessMessage(language: ChatLanguage) {
  return language === 'es'
    ? 'Gracias. Ya envié tu solicitud a Clear Point Senior Advisors. Un asesor licenciado puede revisar tus opciones contigo.'
    : "Thank you. I've sent your request to Clear Point Senior Advisors. A licensed advisor can review your options with you.";
}

function getFailMessage(language: ChatLanguage) {
  return language === 'es'
    ? 'Lo siento, no pude enviar la solicitud en este momento. Puedes llamarnos directamente al 1-866-310-8702.'
    : "I'm sorry, I couldn't send the request right now. You can call us directly at 1-866-310-8702.";
}

export function ChatBot() {
  const { lang, setLang, t } = useLanguage();
  const initialLanguage = lang === 'es' ? 'es' : 'en';

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [step, setStep] = useState<ChatStep>('language');
  const [memory, setMemory] = useState<ChatMemory>(() => getStoredMemory(initialLanguage));
  const [isTyping, setIsTyping] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [topicPage, setTopicPage] = useState<0 | 1 | 2>(0);

  const queueRef = useRef<QueuedBotMessage[]>([]);
  const processingRef = useRef(false);
  const generationRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(getMemoryForStorage(memory)));
  }, [memory]);

  function addMessage(type: MessageType, text: string, options?: Option[]) {
    setMessages((prev) => [...prev, { id: uid(), type, text, options }]);
  }

  function addUserMessage(text: string) {
    addMessage('user', text);
  }

  function cancelBotQueue() {
    generationRef.current += 1;
    queueRef.current = [];
    processingRef.current = false;
    setIsTyping(false);
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function processQueue(generation: number) {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0 && generationRef.current === generation) {
      const next = queueRef.current.shift();
      if (!next) break;

      setIsTyping(true);
      await sleep(getTypingDelay(next.text, next.pace));

      if (generationRef.current !== generation) {
        setIsTyping(false);
        processingRef.current = false;
        return;
      }

      setIsTyping(false);
      addMessage('bot', next.text, next.options);
      const postGap = next.pace === 'short'
        ? 600 + Math.floor(Math.random() * 400)
        : next.pace === 'slow'
          ? 1800 + Math.floor(Math.random() * 400)
          : 1200 + Math.floor(Math.random() * 400);
      await sleep(postGap);
    }

    processingRef.current = false;
  }

  function enqueueBot(messagesToQueue: QueuedBotMessage[], clearExisting = false) {
    if (clearExisting) {
      generationRef.current += 1;
      queueRef.current = [];
      processingRef.current = false;
      setIsTyping(false);
    }

    const generation = generationRef.current;
    queueRef.current.push(...messagesToQueue);
    void processQueue(generation);
  }

  function updateMemory(patch: Partial<ChatMemory>) {
    setMemory((prev) => ({ ...prev, ...patch }));
  }

  function languageLabel(language: ChatLanguage) {
    return language === 'es' ? 'Español' : 'English';
  }

  function trackTopic(topic: string) {
    setMemory((prev) => {
      if (prev.discussedTopics.includes(topic)) return prev;
      return { ...prev, discussedTopics: [...prev.discussedTopics, topic] };
    });
  }

  /* ---------- Welcome ---------- */

  function startWelcome(clearExisting = false, langOverride?: ChatLanguage) {
    setTopicPage(0);
    const welcomeLang = langOverride ?? memory.language;
    setStep('language');
    enqueueBot(
      [
        {
          text:
            welcomeLang === 'es'
              ? 'Hola, bienvenido a Clear Point Senior Advisors. ¿Prefiere inglés o español?'
              : 'Hi, welcome to Clear Point Senior Advisors. Would you prefer English or Spanish?',
          options: [
            { label: 'English', value: 'lang_en' },
            { label: 'Español', value: 'lang_es' },
          ],
          pace: 'short',
        },
      ],
      clearExisting,
    );
  }

  function resetChat() {
    setTopicPage(0);
    generationRef.current += 1;
    queueRef.current = [];
    processingRef.current = false;
    setIsTyping(false);
    setMessages([]);
    setStep('language');
    // Sync to current page language on reset so close+reopen uses active site language
    const newLang: ChatLanguage = lang === 'es' ? 'es' : 'en';
    const resetMemory = { ...DEFAULT_MEMORY, language: newLang };
    setMemory(resetMemory);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(getMemoryForStorage(resetMemory)));
    }
    window.setTimeout(() => startWelcome(true, newLang), 150);
  }

  function openChat() {
    setIsOpen(true);
    if (!hasOpened && messages.length === 0) {
      setHasOpened(true);
      // Sync to current page language on first open
      const currentLang: ChatLanguage = lang === 'es' ? 'es' : 'en';
      if (memory.language !== currentLang) {
        updateMemory({ language: currentLang });
      }
      startWelcome(false, currentLang);
    }
  }

  /* ---------- Opening choice ---------- */

  function showOpeningChoice(language: ChatLanguage) {
    // Updated: pass language explicitly to avoid stale closure
    showMedicareIntake(language);
  }

  /* ---------- Medicare intake (NEW) - warm, state-first ---------- */

  function showMedicareIntake(langOverride?: ChatLanguage) {
    setStep('state');
    const effectiveLang = langOverride ?? memory.language;
    const messages = MEDICARE_INTRO[effectiveLang];
    enqueueBot(messages);
  }

  function handleStateSelection(state: string) {
    updateMemory({ state });
    setStep('question');

    if (!SUPPORTED_STATES.includes(state)) {
      const messages = STATE_CONFIRMATION[memory.language].other;
      enqueueBot(messages);
      return;
    }

    const messages = STATE_CONFIRMATION[memory.language][state] || STATE_CONFIRMATION[memory.language].other;
    enqueueBot(messages);
  }

  /* ---------- General question (legacy fallback, now routes through state first) ---------- */

  /* ---------- Plan review flow (unchanged) ---------- */

  function startPlanReview(interestType = memory.interestType || 'Plan review') {
    updateMemory({ wantsPlanReview: true, interestType, currentCoverage: '', phone: '', preferredLanguage: '', preferredContactTime: '', email: '', consentGiven: false, skippedEmail: false, submitted: false });
    const freshMem = { ...memory, wantsPlanReview: true, interestType, currentCoverage: '', phone: '', preferredLanguage: '', preferredContactTime: '', email: '', consentGiven: false, skippedEmail: false, submitted: false };
    enqueueBot([{ text: memory.language === 'es' ? 'Claro. Puedo ayudarte a solicitar una revisión gratuita.' : 'Of course. I can help you request a free plan review.', pace: 'short' }]);
    askNextQuestion(freshMem);
  }

  function buildConversationSummary(mem: ChatMemory): string {
    const lang = mem.language === 'es' ? 'Spanish' : 'English';
    const stateName = SUPPORTED_STATES_LABELS[mem.state] || mem.state || 'Not provided';
    const topics = mem.discussedTopics.length > 0
      ? mem.discussedTopics.join(', ')
      : 'General Medicare education';
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const lines = [
      'Client Conversation Summary:',
      '',
      `Lead Source: Clear Point Senior Advisors Website Chatbot`,
      `Conversation Date/Time: ${now}`,
      `State: ${stateName}`,
      `ZIP Code: ${mem.zip || 'Not provided'}`,
      `City: ${mem.city || 'Not provided'}`,
      `County: ${mem.county || 'Not provided'}`,
      `Date of Birth: ${mem.dob || 'Not provided'}`,
      `Calculated Age: ${mem.calculatedAge || 'N/A'}`,
      `Language: ${lang}`,
      `Consent to contact: ${mem.consentGiven ? 'Yes' : 'No'}`,
    ];

    if (mem.wantsPlanReview) {
      lines.push(`Appointment request: Yes — client requested a plan review.`);
    }

    lines.push('');

    // Narrative summary
    const concern = mem.interestType !== 'General Medicare education' && mem.interestType !== 'Plan review'
      ? `asked for help with ${mem.interestType.toLowerCase()}`
      : 'requested general Medicare information';

    lines.push(`Client communicated in ${lang} and ${concern} in ${stateName}. The main topics discussed were ${topics}.`);

    // Agent guidance
    const guidance: string[] = [];
    if (mem.discussedTopics.some(t => t.includes('Medicaid') || t.includes('MSP') || t.includes('Cost') || t.includes('Extra Help') || t.includes('LIS'))) {
      guidance.push('income verification, Medicaid/MSP eligibility, Extra Help/LIS status');
    }
    if (mem.discussedTopics.some(t => t.includes('Part D') || t.includes('Prescription') || t.includes('SPAP') || t.includes('EPIC') || t.includes('PAAD'))) {
      guidance.push('Part D plan review, medication formulary check, pharmacy network');
    }
    if (mem.discussedTopics.some(t => t.includes('Advantage') || t.includes('Supplement') || t.includes('SNP') || t.includes('HMO') || t.includes('PPO'))) {
      guidance.push('plan type comparison (Advantage/Supplement/SNP)');
    }
    if (mem.discussedTopics.some(t => t.includes('Enrollment') || t.includes('Penalties'))) {
      guidance.push('enrollment period verification (IEP/AEP/SEP status)');
    }

    if (guidance.length > 0) {
      lines.push(`Client may need a licensed agent to verify: ${guidance.join('; ')}.`);
      lines.push(`Client may also need review of current Medicare coverage${mem.currentCoverage ? ` (currently: ${mem.currentCoverage})` : ''}, medications, doctors, and available plan options.`);
    } else {
      lines.push(`Client may need a licensed agent to review current Medicare coverage, plan options, and answer general Medicare questions.`);
    }

    if (mem.consentGiven) {
      lines.push('Consent to contact was provided through the website chatbot.');
    }

    return lines.join('\n');
  }

  async function submitLead(finalMemory: ChatMemory) {
    setStep('complete');
    const conversationSummary = buildConversationSummary(finalMemory);
    const payload = {
      source: 'Website Chatbot',
      page_url: window.location.href,
      form_name: 'Website Chatbot - Medicare Plan Review Request',
      first_name: finalMemory.firstName,
      last_name: finalMemory.lastName || '',
      full_name: `${finalMemory.firstName} ${finalMemory.lastName}`.trim(),
      phone: finalMemory.phone,
      email: finalMemory.email,
      age: String(finalMemory.calculatedAge),
      date_of_birth: finalMemory.dob,
      calculated_age: finalMemory.calculatedAge,
      zip_code: finalMemory.zip,
      city: finalMemory.city,
      county: finalMemory.county,
      derived_state: finalMemory.derivedState,
      preferred_language: finalMemory.preferredLanguage || languageLabel(finalMemory.language),
      medicare_status: finalMemory.currentCoverage,
      interest_type: finalMemory.interestType || 'Plan Review',
      best_time_to_contact: finalMemory.preferredContactTime,
      consent_to_contact: finalMemory.consentGiven,
      consent_text: finalMemory.language === 'es' ? DISCLAIMERS.es.consent : DISCLAIMERS.en.consent,
      lead_notes: conversationSummary,
      bot_transcript_summary: `Language: ${finalMemory.language}. State: ${finalMemory.state || 'not provided'}. ZIP: ${finalMemory.zip}. Coverage: ${finalMemory.currentCoverage || 'not provided'}. Topics: ${finalMemory.discussedTopics.join(', ') || 'none'}.`,
      tags: ['Website Lead', 'Medicare Lead', 'Chat Lead', 'Chatbot', finalMemory.language === 'es' ? 'Spanish' : 'English'],
      created_at: new Date().toISOString(),
      ...getUtms(),
    };

    const success = await submitLeadToGHL(payload);
    if (success) {
      enqueueBot([
        {
          text: getSuccessMessage(finalMemory.language),
          options: [
            { label: finalMemory.language === 'es' ? 'Hacer pregunta' : 'Ask a question', value: 'ask_question' },
            { label: finalMemory.language === 'es' ? 'Llamar ahora' : 'Call now', value: 'call_now', icon: <Phone className="w-4 h-4" /> },
          ],
          pace: 'long',
        },
      ]);
    } else {
      enqueueBot([
        {
          text: getFailMessage(finalMemory.language),
          options: [
            { label: finalMemory.language === 'es' ? 'Llamar ahora' : 'Call now', value: 'call_now', icon: <Phone className="w-4 h-4" /> },
          ],
          pace: 'long',
        },
      ]);
    }
  }

  /* ---------- Boundaries ---------- */

  function showPersonalizedBoundary() {
    setStep('choice');
    enqueueBot([
      {
        text:
          memory.language === 'es'
            ? 'Puedo ayudarte a entender qué comparar, pero no debo escoger un plan final sin revisar tu situación completa.'
            : 'I can help you understand what to compare, but I should not choose a final plan without reviewing your full situation.',
        pace: 'long',
      },
      {
        text:
          memory.language === 'es'
            ? 'Un asesor licenciado puede revisar tus doctores, medicinas, ZIP code y cobertura actual contigo.'
            : 'A licensed advisor can review your doctors, prescriptions, ZIP code, and current coverage with you.',
        options: [
          { label: memory.language === 'es' ? 'Solicitar revisión' : 'Request review', value: 'request_review', icon: <Calendar className="w-4 h-4" /> },
          { label: memory.language === 'es' ? 'Pregunta general' : 'General question', value: 'ask_question' },
        ],
        pace: 'long',
      },
    ]);
  }

  function showPrivacyReminder() {
    enqueueBot([
      {
        text: memory.language === 'es' ? DISCLAIMERS.es.privacy : DISCLAIMERS.en.privacy,
        pace: 'long',
      },
      {
        text:
          memory.language === 'es'
            ? 'Puedes seguir con una pregunta general o solicitar una revisión básica.'
            : 'You can continue with a general question or request a basic review.',
        options: [
          { label: memory.language === 'es' ? 'Pregunta general' : 'General question', value: 'ask_question' },
          { label: memory.language === 'es' ? 'Solicitar revisión' : 'Request review', value: 'request_review' },
        ],
        pace: 'short',
      },
    ]);
  }

  function showOutOfScope() {
    enqueueBot([
      {
        text:
          memory.language === 'es'
            ? 'Lo siento, no puedo ayudar con consejos médicos, legales o de impuestos.'
            : "I'm sorry, I can't help with medical, legal, or tax advice.",
        pace: 'short',
      },
      {
        text:
          memory.language === 'es'
            ? 'Si es una emergencia médica, llama al 911 o a un profesional de salud.'
            : 'If this is a medical emergency, please call 911 or a qualified health professional.',
        pace: 'short',
      },
    ]);
  }

  /* ---------- Option handler ---------- */

  function handleOption(value: string) {
    const selected = messages[messages.length - 1]?.options?.find((option) => option.value === value);
    if (selected) addUserMessage(selected.label);

    /* Language */
    if (value === 'lang_en' || value === 'lang_es') {
      const selectedLanguage: ChatLanguage = value === 'lang_es' ? 'es' : 'en';
      setLang(selectedLanguage);
      updateMemory({ language: selectedLanguage, preferredLanguage: languageLabel(selectedLanguage) });
      showOpeningChoice(selectedLanguage);
      return;
    }

    /* Opening choice */
    if (value === 'ask_question') {
      showMedicareIntake();
      return;
    }

    /* Quick topic options */
    if (value.startsWith('quick_')) {
      setStep('medicare_education');
      if (value === 'quick_basics') {
        updateMemory({ educationTopic: 'edu_parts_ab' });
        enqueueBot(getMedicareEducation('edu_parts_ab', memory.language, memory.state));
      } else if (value === 'quick_enrollment') {
        updateMemory({ educationTopic: 'edu_enrollment' });
        enqueueBot(getMedicareEducation('edu_enrollment', memory.language, memory.state));
      } else if (value === 'quick_advantage_types') {
        updateMemory({ educationTopic: 'edu_advantage_types' });
        enqueueBot(getMedicareEducation('edu_advantage_types', memory.language, memory.state));
      } else if (value === 'quick_snp') {
        updateMemory({ educationTopic: 'edu_advantage_types' });
        enqueueBot(getMedicareEducation('edu_advantage_types', memory.language, memory.state));
      } else if (value === 'quick_partd') {
        updateMemory({ educationTopic: 'edu_part_d' });
        enqueueBot(getMedicareEducation('edu_part_d', memory.language, memory.state));
      } else if (value === 'quick_extra_help') {
        updateMemory({ educationTopic: 'edu_extra_help' });
        enqueueBot(getMedicareEducation('edu_extra_help', memory.language, memory.state));
      } else if (value === 'quick_supplement') {
        updateMemory({ educationTopic: 'edu_supplement' });
        enqueueBot(getMedicareEducation('edu_supplement', memory.language, memory.state));
      }
      return;
    }

    if (value === 'request_review') {
      trackTopic('Appointment Request');
      startPlanReview(memory.interestType || 'Plan review');
      return;
    }

    /* Topic page navigation */
    if (value === 'topic_page_2') {
      setTopicPage(1);
      const opts = memory.language === 'es' ? TOPIC_GROUPS_ES[1] : TOPIC_GROUPS_EN[1];
      enqueueBot([{ text: memory.language === 'es' ? 'Aquí hay más temas:' : 'Here are more topics:', options: opts, pace: 'short' }], true);
      return;
    }
    if (value === 'topic_page_3') {
      setTopicPage(2);
      const opts = memory.language === 'es' ? TOPIC_GROUPS_ES[2] : TOPIC_GROUPS_EN[2];
      enqueueBot([{ text: memory.language === 'es' ? 'Y algunos temas adicionales:' : 'And a few more topics:', options: opts, pace: 'short' }], true);
      return;
    }

    /* State selection */
    if (value.startsWith('state_')) {
      const state = value.replace('state_', '');
      if (state === 'other') {
        handleStateSelection('other');
      } else {
        handleStateSelection(state);
      }
      return;
    }

    /* Medicare education topics */
    if (value.startsWith('edu_')) {
      setStep('medicare_education');
      updateMemory({ educationTopic: value, educationStep: 1 });

      // Track discussed topic
      const topicLabels: Record<string, string> = {
        edu_parts_ab: 'Medicare Parts A & B',
        edu_part_c: 'Medicare Advantage',
        edu_supplement: 'Medicare Supplement',
        edu_part_d: 'Part D / Prescription Drug Coverage',
        edu_extra_help: 'Extra Help / LIS',
        edu_medicaid: 'Medicaid',
        edu_msp: 'Medicare Savings Program',
        edu_spap: 'State Prescription Assistance',
        edu_special_benefits: 'Special Benefits',
        edu_union_retiree: 'Union/Retiree Benefits',
        edu_va_tricare: 'VA/TRICARE Benefits',
        edu_disability: 'Disability Benefits',
        edu_ssdi_ssi: 'SSI / SSDI / Medicare Premium Help',
        edu_ssdi_ssi_ssi: 'SSI Information',
        edu_ssdi_ssi_ssdi: 'SSDI Information',
        edu_ssdi_ssi_medicaid: 'Medicaid / Medicare',
        edu_ssdi_ssi_under65: 'Under 65 Medicare',
        edu_ssdi_ssi_over65: '65+ Medicare',
        edu_ssdi_ssi_quarters: 'Work Quarters / Part A',
        edu_ssdi_ssi_partab: 'Part A / Part B Help',
        edu_snp: 'SNP Plans',
        edu_enrollment: 'Enrollment Periods',
        edu_advantage_types: 'HMO vs PPO',
        edu_penalties: 'Penalties',
        edu_cost_help: 'Help with Costs',
        edu_comparison: 'Plan Comparison',
        edu_employer: 'Employer/Union Coverage',
        edu_medication: 'Medications',
        edu_prequalify: 'Pre-qualification',
        edu_linet: 'LI NET',
        edu_plan_loss: 'Plan Loss',
      };
      if (topicLabels[value]) trackTopic(topicLabels[value]);

      if (value === 'edu_state_programs') {
        const programs = getStatePrograms(memory.state, memory.language);
        enqueueBot(programs);
        return;
      }

      if (value === 'edu_back_to_topics') {
        // Go back to topic menu
        setStep('question');
        const topicOptions = memory.language === 'es' ? TOPIC_GROUPS_ES[topicPage] : TOPIC_GROUPS_EN[topicPage];
        enqueueBot([{ text: memory.language === 'es' ? '¿Qué tema le gustaría aprender hoy?' : 'What would you like to learn about today?', options: topicOptions, pace: 'short' }]);
        return;
      }

      const education = getMedicareEducation(value, memory.language, memory.state);
      enqueueBot(education);
      return;
    }

    /* Legacy education fallback */
    if (value === 'simple_explanation') {
      enqueueBot([
        {
          text:
            memory.language === 'es'
              ? 'Claro. Te lo explico en términos sencillos.'
              : "Of course. I'll explain it in simple terms.",
          pace: 'short',
        },
        {
          text:
            memory.language === 'es'
              ? 'Medicare tiene partes diferentes. Algunas cubren hospital, otras servicios médicos, medicamentos o ayudan con costos.'
              : 'Medicare has different parts. Some help with hospital care, medical services, prescriptions, or certain costs.',
          pace: 'slow',
        },
        {
          text:
            memory.language === 'es'
              ? '¿Qué parte quieres ver primero?'
              : 'Which part would you like to look at first?',
          pace: 'short',
        },
      ]);
      setStep('question');
      return;
    }

    /* Lead capture */
    if (value.startsWith('coverage_')) {
      const coverageMap: Record<string, string> = {
        coverage_original: 'Original Medicare',
        coverage_advantage: 'Medicare Advantage',
        coverage_unsure: 'Not sure',
      };
      updateMemory({ currentCoverage: coverageMap[value] || 'Not sure' });
      askNextQuestion({ ...memory, currentCoverage: coverageMap[value] || 'Not sure' });
      return;
    }

    if (value === 'consent_yes') {
      updateMemory({ consentGiven: true });
      askNextQuestion({ ...memory, consentGiven: true });
      return;
    }

    if (value === 'consent_no') {
      updateMemory({ consentGiven: false });
      setStep('choice');
      enqueueBot([
        { text: memory.language === 'es' ? 'No hay problema. No voy a recopilar tu número por chat.' : "No problem. I won't collect your number through chat.", pace: 'short' },
        { text: memory.language === 'es' ? `También puedes llamar a ${CHATBOT_CONTEXT.phone} si prefieres.` : `You can also call ${CHATBOT_CONTEXT.phone} if you prefer.`, options: [{ label: memory.language === 'es' ? 'Hacer pregunta' : 'Ask a question', value: 'ask_question' }, { label: memory.language === 'es' ? 'Llamar ahora' : 'Call now', value: 'call_now', icon: <Phone className="w-4 h-4" /> }], pace: 'short' },
      ]);
      return;
    }

    if (value.startsWith('preferred_')) {
      const preferredMap: Record<string, string> = {
        preferred_en: 'English',
        preferred_es: 'Spanish',
        preferred_either: 'Either',
      };
      updateMemory({ preferredLanguage: preferredMap[value] || languageLabel(memory.language) });
      askNextQuestion({ ...memory, preferredLanguage: preferredMap[value] || languageLabel(memory.language) });
      return;
    }

    if (value.startsWith('time_')) {
      const timeMap: Record<string, string> = {
        time_morning: 'Morning',
        time_afternoon: 'Afternoon',
        time_after_3: 'After 3pm',
        time_anytime: 'Anytime',
      };
      updateMemory({ preferredContactTime: timeMap[value] || 'Anytime' });
      askNextQuestion({ ...memory, preferredContactTime: timeMap[value] || 'Anytime' });
      return;
    }

    if (value === 'skip_email') {
      updateMemory({ skippedEmail: true });
      askNextQuestion({ ...memory, skippedEmail: true });
      return;
    }

    if (value === 'call_now') {
      window.location.href = CHATBOT_CONTEXT.phoneHref;
      return;
    }

    if (value === 'start_over') {
      resetChat();
    }
  }

  /* ---------- Text handler ---------- */

  function getNextMissingStep(mem: ChatMemory): string {
    if (!mem.firstName) return 'firstName';
    if (!mem.lastName) return 'lastName';
    if (!mem.zip) return 'zipCode';
    if (!mem.dob) return 'dob';
    if (!mem.currentCoverage) return 'currentCoverage';
    if (!mem.phone) return 'phone';
    if (!mem.preferredLanguage) return 'preferredLanguage';
    if (!mem.preferredContactTime) return 'bestTime';
    if (!mem.email && !mem.skippedEmail) return 'emailOptional';
    if (!mem.consentGiven) return 'consent';
    return 'readyToSubmit';
  }

  function isEmail(text: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim()) && text.length < 100;
  }



  function askNextQuestion(mem: ChatMemory) {
    const next = getNextMissingStep(mem);
    switch (next) {
      case 'firstName':
        setStep('lead_name');
        enqueueBot([{ text: mem.language === 'es' ? '¿Cuál es tu primer nombre?' : 'What is your first name?', pace: 'short' }]);
        break;
      case 'lastName':
        setStep('lead_last_name');
        enqueueBot([{ text: mem.language === 'es' ? `Gracias, ${mem.firstName}. ¿Cuál es tu apellido?` : `Thank you, ${mem.firstName}. What is your last name?`, pace: 'short' }]);
        break;
      case 'zipCode':
        setStep('lead_zip');
        enqueueBot([{ text: mem.language === 'es' ? '¿Cuál es tu código postal?' : 'What is your ZIP code?', pace: 'short' }]);
        break;
      case 'dob':
        setStep('lead_dob');
        enqueueBot([{ text: mem.language === 'es' ? '¿Cuál es su fecha de nacimiento?' : 'What is your date of birth?', pace: 'short' }]);
        break;
      case 'currentCoverage':
        setStep('lead_coverage');
        enqueueBot([{ text: mem.language === 'es' ? 'Ahora dime, ¿tienes Medicare Original, Medicare Advantage o no estás seguro?' : 'Now, do you currently have Original Medicare, Medicare Advantage, or are you not sure?', options: [{ label: 'Original Medicare', value: 'coverage_original' }, { label: 'Medicare Advantage', value: 'coverage_advantage' }, { label: mem.language === 'es' ? 'No estoy seguro' : 'Not sure', value: 'coverage_unsure' }], pace: 'short' }]);
        break;
      case 'phone':
        setStep('lead_phone');
        enqueueBot([{ text: mem.language === 'es' ? '¿Cuál es el mejor número de teléfono para contactarte?' : 'What is the best phone number to reach you?', pace: 'short' }]);
        break;
      case 'preferredLanguage':
        setStep('lead_preferred_language');
        enqueueBot([{ text: mem.language === 'es' ? '¿Prefieres que te contacten en inglés o español?' : 'Do you prefer to be contacted in English or Spanish?', options: [{ label: 'English', value: 'preferred_en' }, { label: 'Español', value: 'preferred_es' }, { label: mem.language === 'es' ? 'Cualquiera' : 'Either', value: 'preferred_either' }], pace: 'short' }]);
        break;
      case 'bestTime':
        setStep('lead_time');
        enqueueBot([{ text: mem.language === 'es' ? '¿Cuál es el mejor horario para contactarte?' : 'What is the best time to contact you?', options: [{ label: mem.language === 'es' ? 'Mañana' : 'Morning', value: 'time_morning' }, { label: mem.language === 'es' ? 'Tarde' : 'Afternoon', value: 'time_afternoon' }, { label: mem.language === 'es' ? 'Después de las 3pm' : 'After 3pm', value: 'time_after_3' }, { label: mem.language === 'es' ? 'Cualquier hora' : 'Anytime', value: 'time_anytime' }], pace: 'short' }]);
        break;
      case 'emailOptional':
        setStep('lead_email');
        enqueueBot([{ text: mem.language === 'es' ? 'Si quieres, puedes compartir un correo electrónico. También puedes escribir "saltar".' : 'If you would like, you can share an email address. You can also type "skip".', options: [{ label: mem.language === 'es' ? 'Saltar' : 'Skip', value: 'skip_email' }], pace: 'short' }]);
        break;
      case 'consent':
        setStep('lead_consent');
        enqueueBot([{ text: mem.language === 'es' ? DISCLAIMERS.es.consent : DISCLAIMERS.en.consent, options: [{ label: mem.language === 'es' ? 'Sí, acepto' : 'Yes, I agree', value: 'consent_yes' }, { label: mem.language === 'es' ? 'Ahora no' : 'Not now', value: 'consent_no' }], pace: 'long' }]);
        break;
      case 'readyToSubmit':
        updateMemory({ submitted: true });
        submitLead(mem);
        break;
    }
  }

  function handleLeadText(text: string) {
    // Detect and save out-of-order fields (doesn't matter which step we're on)
    if (isEmail(text)) {
      updateMemory({ email: text, skippedEmail: false });
      askNextQuestion({ ...memory, email: text, skippedEmail: false });
      return true;
    }

    // Process by current step
    if (step === 'lead_name') {
      updateMemory({ firstName: text });
      askNextQuestion({ ...memory, firstName: text });
      return true;
    }
    if (step === 'lead_last_name') {
      updateMemory({ lastName: text });
      askNextQuestion({ ...memory, lastName: text });
      return true;
    }
    if (step === 'lead_zip') {
      const cleanZip = text.replace(/\D/g, '').slice(0, 5);
      if (cleanZip.length !== 5 || !/^\d{5}$/.test(cleanZip)) {
        enqueueBot([{ text: memory.language === 'es' ? 'Por favor ingrese un código postal válido de 5 dígitos.' : 'Please enter a valid 5-digit ZIP code.', pace: 'short' }]);
        return true;
      }
      const zipInfo = getZipInfo(cleanZip);
      if (zipInfo) {
        updateMemory({ zip: cleanZip, city: zipInfo.city, county: zipInfo.county, derivedState: zipInfo.stateCode });
        if (!zipInfo.supported) {
          enqueueBot([{ text: memory.language === 'es' ? `Gracias. Detecté ${zipInfo.city}, ${zipInfo.state}. Clear Point Senior Advisors actualmente se enfoca en NY, NJ, CT y FL. Aún puedo darle información educativa general.` : `Thank you. I detected ${zipInfo.city}, ${zipInfo.state}. Clear Point Senior Advisors currently focuses on NY, NJ, CT, and FL. I can still provide general educational information.`, pace: 'slow' }]);
        }
        askNextQuestion({ ...memory, zip: cleanZip, city: zipInfo.city, county: zipInfo.county, derivedState: zipInfo.stateCode });
      } else {
        enqueueBot([{ text: memory.language === 'es' ? 'No pude identificar esa área. Por favor ingrese un código postal válido de 5 dígitos de NY, NJ, CT o FL.' : "I couldn't identify that area. Please enter a valid 5-digit ZIP code from NY, NJ, CT, or FL.", pace: 'short' }]);
      }
      return true;
    }
    if (step === 'lead_dob') {
      const dobValidation = validateDOB(text.trim());
      if (!dobValidation.valid) {
        enqueueBot([{ text: memory.language === 'es' ? 'Por favor ingrese una fecha de nacimiento válida (YYYY-MM-DD).' : 'Please enter a valid date of birth (YYYY-MM-DD).', pace: 'short' }]);
        return true;
      }
      updateMemory({ dob: text.trim(), calculatedAge: dobValidation.age ?? 0 });
      askNextQuestion({ ...memory, dob: text.trim(), calculatedAge: dobValidation.age ?? 0 });
      return true;
    }
    if (step === 'lead_coverage') {
      updateMemory({ currentCoverage: text });
      askNextQuestion({ ...memory, currentCoverage: text });
      return true;
    }
    if (step === 'lead_phone') {
      const cleaned = text.replace(/\D/g, '').slice(0, 10);
      const validation = validatePhone(cleaned);
      if (!validation.valid) {
        enqueueBot([{ text: memory.language === 'es' ? 'Por favor ingrese un número de teléfono válido de 10 dígitos para que un agente licenciado pueda contactarle.' : 'Please enter a valid 10-digit phone number so a licensed agent can contact you.', pace: 'short' }]);
        return true;
      }
      updateMemory({ phone: validation.cleaned });
      askNextQuestion({ ...memory, phone: validation.cleaned });
      return true;
    }
    if (step === 'lead_preferred_language') {
      updateMemory({ preferredLanguage: text });
      askNextQuestion({ ...memory, preferredLanguage: text });
      return true;
    }
    if (step === 'lead_time') {
      updateMemory({ preferredContactTime: text });
      askNextQuestion({ ...memory, preferredContactTime: text });
      return true;
    }
    if (step === 'lead_email') {
      const skipped = text.toLowerCase() === 'skip' || text.toLowerCase() === 'saltar';
      if (skipped) {
        updateMemory({ skippedEmail: true });
        askNextQuestion({ ...memory, skippedEmail: true });
      } else {
        updateMemory({ email: text, skippedEmail: false });
        askNextQuestion({ ...memory, email: text, skippedEmail: false });
      }
      return true;
    }
    if (step === 'lead_consent') {
      const yes = text.toLowerCase().includes('yes') || text.toLowerCase().includes('sí') || text.toLowerCase().includes('si');
      if (yes) {
        updateMemory({ consentGiven: true });
        askNextQuestion({ ...memory, consentGiven: true });
      } else {
        updateMemory({ consentGiven: false });
        setStep('choice');
        enqueueBot([
          { text: memory.language === 'es' ? 'No hay problema. No voy a recopilar tu número por chat.' : "No problem. I won't collect your number through chat.", pace: 'short' },
          { text: memory.language === 'es' ? `También puedes llamar a ${CHATBOT_CONTEXT.phone} si prefieres.` : `You can also call ${CHATBOT_CONTEXT.phone} if you prefer.`, pace: 'short' },
        ]);
      }
      return true;
    }
    return false;
  }

  function handleText(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('chatInput') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    addUserMessage(text);

    // Always cancel any pending bot queue when user sends a message
    cancelBotQueue();

    // Detect interruption keywords
    const lowText = text.toLowerCase().replace(/[^a-záéíóúüñ ]/g, '').trim();
    const isInterruptEN = INTERRUPT_KEYWORDS_EN.some(k => k === lowText || lowText.startsWith(k) || lowText.endsWith(k));
    const isInterruptES = INTERRUPT_KEYWORDS_ES.some(k => k === lowText || lowText.startsWith(k) || lowText.endsWith(k));
    const isInterrupt = isInterruptEN || (memory.language === 'es' && isInterruptES) || (!memory.language && isInterruptES);

    if (isInterrupt && text.length < 25) {
      const ack = memory.language === 'es'
        ? 'Claro. Me detengo. Avísame cuando quieras continuar.'
        : "Of course. I'll pause. Tell me when you're ready.";
      enqueueBot([{ text: ack, pace: 'short' }]);
      return;
    }

    /* Safety filters */
    if (containsAny(text, SENSITIVE_KEYWORDS)) {
      showPrivacyReminder();
      return;
    }

    if (step.startsWith('lead_')) {
      if (handleLeadText(text)) return;
    }

    /* If we are waiting for state */
    if (step === 'state') {
      const detectedState = detectState(text);
      if (detectedState && SUPPORTED_STATES.includes(detectedState)) {
        handleStateSelection(detectedState);
        return;
      } else if (detectedState) {
        handleStateSelection('other');
        return;
      }
      // Could not detect state - ask again gently
      enqueueBot([
        {
          text:
            memory.language === 'es'
              ? 'Disculpa, no pude identificar el estado. Para orientarte mejor, ¿en qué estado vives? (NY, NJ, CT, FL u otro)'
              : "I'm sorry, I couldn't identify the state. To guide you better, what state do you live in? (NY, NJ, CT, FL, or other)",
          pace: 'slow',
        },
      ]);
      return;
    }

    if (containsAny(text, OUT_OF_SCOPE_KEYWORDS)) {
      showOutOfScope();
      return;
    }

    const interest = detectInterest(text);
    updateMemory({ lastTopic: interest, interestType: interest });

    if (containsAny(text, REVIEW_KEYWORDS)) {
      startPlanReview(interest);
      return;
    }

    if (containsAny(text, PERSONALIZED_KEYWORDS)) {
      showPersonalizedBoundary();
      return;
    }

    /* Medicare question - route through state intake if state unknown, then education */
    const medicareTopic = detectMedicareTopic(text, memory.language);
    if (medicareTopic) {
      updateMemory({ lastTopic: medicareTopic, interestType: medicareTopic });
      trackTopic(medicareTopic);
      if (!memory.state) {
        // Ask state first, then provide education
        showMedicareIntake();
        return;
      }
      // State known - map topic to education key
      const topicMap: Record<string, string> = {
        'Medicare Parts A & B': 'edu_parts_ab',
        'Medicare Advantage': 'edu_part_c',
        'Medicare Supplement': 'edu_supplement',
        'Part D': 'edu_part_d',
        'Extra Help / LIS': 'edu_extra_help',
        'Medicaid': 'edu_medicaid',
        'Medicare Savings Programs': 'edu_msp',
        'MSP': 'edu_msp',
        'Penalties': 'edu_penalties',
        'Plan Loss': 'edu_plan_loss',
        'State Programs': 'edu_spap',
        'Employer Coverage': 'edu_employer',
        'LI NET': 'edu_linet',
        'Medication': 'edu_medication',
        'Extra Benefits': 'edu_part_c',
        'Prequalify': 'edu_prequalify',
        'Advantage Types': 'edu_advantage_types',
        'Comparison': 'edu_comparison',
        'Enrollment': 'edu_enrollment',
      };
      const eduKey = topicMap[medicareTopic] || 'edu_parts_ab';
      setStep('medicare_education');
      updateMemory({ educationTopic: eduKey, educationStep: 1 });
      const education = getMedicareEducation(eduKey, memory.language, memory.state);
      enqueueBot(education);
      return;
    }

    /* Fallback: legacy education */
    const education = getEducationMessages(text, memory.language);
    updateMemory({ lastTopic: education.topic, interestType: education.topic });
    setStep('question');
    enqueueBot(education.messages);
  }

  /* ---------- Render ---------- */

  const displayLanguage = memory.language;
  const inputPlaceholder = displayLanguage === 'es' ? 'Escriba su mensaje aquí...' : 'Type your message here...';
  const closeLabel = t('Close chat', 'Cerrar chat');
  const resetLabel = t('Start over', 'Empezar de nuevo');
  const lastMessage = messages[messages.length - 1];
  const activeOptionMessageId = lastMessage?.type === 'bot' && lastMessage.options?.length ? lastMessage.id : '';

  const minimizeLabel = t('Minimize chat', 'Minimizar chat');

  return (
    <>
      {/* Launcher — shown only when chat is fully closed */}
      {!isOpen && (
        <button
          onClick={openChat}
          className="fixed bottom-[78px] right-4 md:bottom-6 md:right-6 z-50 bg-earth-800 text-cream-50 rounded-2xl shadow-lifted flex items-center gap-2.5 sm:gap-3 px-3.5 py-2.5 sm:px-4 sm:py-3 hover:bg-earth-900 hover:scale-105 transition-all"
          aria-label={t('Open Zara, Clear Point virtual assistant', 'Abrir Zara, asistente virtual de Clear Point')}
        >
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden flex-shrink-0 bg-cream-100">
            <img src="/zara-avatar.jpg" alt="Zara" className="w-full h-full object-cover" />
          </div>
          <div className="text-left leading-tight">
            <div className="text-[14px] sm:text-[15px] font-semibold">Zara</div>
            <div className="text-[10px] sm:text-[11px] text-cream-200 hidden sm:block">{t('Virtual Assistant', 'Asistente Virtual')}</div>
          </div>
        </button>
      )}

      {/* Minimized strip — shown when chat is open but minimized */}
      {isOpen && isMinimized && (
        <button
          onClick={() => setIsMinimized(false)}
          className="fixed bottom-[78px] right-4 md:bottom-6 md:right-6 z-50 bg-earth-800 text-cream-50 rounded-2xl shadow-lifted flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-earth-900 transition-all"
          aria-label={t('Expand Zara chat', 'Expandir chat de Zara')}
        >
          <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-cream-100">
            <img src="/zara-avatar.jpg" alt="Zara" className="w-full h-full object-cover" />
          </div>
          <div className="text-left leading-tight">
            <div className="text-[14px] font-semibold">Zara</div>
            <div className="text-[10px] text-cream-200">{t('Chat minimized — tap to expand', 'Chat minimizado — toca para expandir')}</div>
          </div>
          <X
            className="w-4 h-4 ml-1 text-cream-300 hover:text-cream-50"
            onClick={(e) => { e.stopPropagation(); setIsOpen(false); setIsMinimized(false); resetChat(); }}
            aria-label={closeLabel}
          />
        </button>
      )}

      {/* Full chat window */}
      {isOpen && !isMinimized && (
        <div className="fixed bottom-[78px] right-4 md:bottom-6 md:right-6 z-50 w-[calc(100vw-12px)] md:w-[480px] lg:w-[520px] max-w-[calc(100vw-12px)] h-[calc(100dvh-88px)] md:h-[700px] max-h-[calc(100dvh-88px)] md:max-h-[85dvh] bg-cream-50 rounded-2xl shadow-lifted flex flex-col overflow-hidden border border-cream-200">
          <div className="bg-earth-800 text-cream-50 px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-cream-100">
                <img src="/zara-avatar.jpg" alt="Zara" className="w-full h-full object-cover" />
              </div>
              <div>
                <div className="text-[15px] font-semibold leading-tight">
                  {displayLanguage === 'es' ? 'Zara – Asistente Virtual de Clear Point' : 'Zara – Clear Point Virtual Assistant'}
                </div>
                <div className="text-[11px] text-cream-200 font-normal leading-tight">
                  {displayLanguage === 'es' ? 'Educación sobre Medicare y revisión de planes' : 'Medicare education and plan review support'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={resetChat} className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors" aria-label={resetLabel} title={resetLabel}>
                <RotateCcw className="w-4 h-4" />
              </button>
              <button onClick={() => setIsMinimized(true)} className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors" aria-label={minimizeLabel} title={minimizeLabel}>
                <Minus className="w-4 h-4" />
              </button>
              <button onClick={() => { setIsOpen(false); setIsMinimized(false); resetChat(); }} className="p-1.5 hover:bg-cream-50/10 rounded-lg transition-colors" aria-label={closeLabel}>
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="bg-gold-100 px-3 py-2 text-[12px] text-earth-700 leading-[1.45] border-b border-gold-200 flex-shrink-0 space-y-1">
            <p>{displayLanguage === 'es' ? DISCLAIMERS.es.privacy : DISCLAIMERS.en.privacy}</p>
            <p>{displayLanguage === 'es' ? DISCLAIMERS.es.general : DISCLAIMERS.en.general}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-xl px-4 py-3 text-[14px] leading-[1.55] ${
                    message.type === 'user'
                      ? 'bg-earth-800 text-cream-50 rounded-br-sm'
                      : 'bg-white text-earth-800 shadow-sm border border-cream-200 rounded-bl-sm'
                  }`}
                >
                  <div className="whitespace-pre-line">{message.text}</div>
                  {message.options && (
                    <div className={`mt-2.5 ${message.options.length >= 6 ? 'grid grid-cols-1 sm:grid-cols-2 gap-2' : 'space-y-1.5'}`}>
                      {message.options.map((option) => {
                        const optionDisabled = message.id !== activeOptionMessageId || isTyping;
                        const isGrid = message.options!.length >= 6;
                        return (
                        <button
                          key={option.value}
                          onClick={() => handleOption(option.value)}
                          disabled={optionDisabled}
                          className={`w-full flex items-center gap-1.5 bg-cream-50 text-earth-800 leading-snug rounded-lg border border-cream-200 transition-all text-left ${isGrid ? 'px-3 py-2.5 text-[13px] min-h-[44px]' : 'px-4 py-3 text-[14px] min-h-[48px] gap-2.5'} ${
                            optionDisabled
                              ? 'opacity-60 cursor-not-allowed'
                              : 'hover:bg-gold-100 hover:border-gold-300'
                          }`}
                        >
                          {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                          <span className="flex-1">{option.label}</span>
                          {!isGrid && <ChevronRight className="w-4 h-4 text-gold-400 flex-shrink-0" />}
                        </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-cream-200">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-earth-500 italic">
                      {displayLanguage === 'es'
                        ? 'Zara está escribiendo...'
                        : 'Zara is typing...'}
                    </span>
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-earth-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="px-3 py-2 border-t border-cream-200 flex-shrink-0 flex items-center justify-between gap-2">
            <a href={CHATBOT_CONTEXT.phoneHref} className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors">
              <Phone className="w-4 h-4" />
              {displayLanguage === 'es' ? 'Llamar' : 'Call'}
            </a>
            <button
              type="button"
              onClick={() => startPlanReview(memory.interestType || 'Plan review')}
              className="text-[13px] text-earth-700 hover:text-earth-900 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-cream-100 transition-colors"
            >
              <User className="w-4 h-4" />
              {displayLanguage === 'es' ? 'Asesor' : 'Advisor'}
            </button>
          </div>

          <form onSubmit={handleText} className="px-3 pb-3 pt-2 border-t border-cream-200 flex-shrink-0">
            <div className="flex gap-2">
              <input
                name="chatInput"
                type="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
                spellCheck="true"
                placeholder={inputPlaceholder}
                className="flex-1 px-4 py-3 bg-white border border-cream-300 rounded-lg text-[14px] text-earth-900 placeholder:text-earth-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40 focus:border-gold-400 min-h-[48px]"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button type="submit" className="px-4 py-3 bg-earth-800 text-cream-50 rounded-lg hover:bg-earth-900 transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center" aria-label={displayLanguage === 'es' ? 'Enviar' : 'Send'}>
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

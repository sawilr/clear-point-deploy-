// Vercel Serverless Function — ClearPoint CSA bot LLM bridge.
// Calls Claude Haiku 4.5 with a strict system prompt that enforces CMS
// TPMO 422.2267 compliance. The API key lives ONLY server-side; the
// browser never sees it.
//
// PHASE A15 — Security hardening layers:
//   1. Origin / CORS allowlist (only our domain + Vercel previews)
//   2. Per-IP rate limit (30 msgs / 5 min, KV-backed)
//   3. Prompt-injection guard (rejects jailbreak / role-override attempts)
//   4. Compliance post-filter v2 (carrier names, eligibility, etc.)
//   5. Conversation history cap (max 12 turns)
//
// Cost target: $0.005–$0.020 per conversation (Haiku + prompt caching).

import { checkPromptInjection } from './_lib/prompt-guard.js';
import { scrubPHI } from './_lib/phi-scrub.js';
import { complianceFilter } from './_lib/compliance-filter.js';
import { rateLimit, clientId, checkOrigin, applyCors } from './_lib/rate-limit.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// ── Web search allowlist (Anthropic web_search server tool) ──────────────
// Clara may use Anthropic's server-side web_search ONLY to CONFIRM a current
// official figure/rule when she is unsure or the caller asks something the
// injected KB does not cover. Results are HARD-LOCKED to official government
// and state Medicaid/SHIP domains via the tool's `allowed_domains` so the model
// can never surface an arbitrary marketing/forum page. Federal: medicare.gov,
// cms.gov, ssa.gov. State (NY/NJ/CT — the states ClearPoint serves): Medicaid /
// SHIP / pharmaceutical-assistance program sites. `max_uses` is kept low (2) so
// a turn stays fast and cheap. We use the broadly-supported web_search_20250305
// tool version (the newer _20260209 dynamic-filtering version is not listed as
// supported on Haiku 4.5 and additionally requires the code-execution tool).
const WEB_SEARCH_ALLOWED_DOMAINS = [
  // Federal — authoritative for standard Medicare figures/rules
  'medicare.gov',
  'cms.gov',
  'ssa.gov',
  // New York
  'health.ny.gov',          // NY State Dept of Health / Medicaid
  'nystateofhealth.ny.gov', // NY marketplace
  'aging.ny.gov',           // NY State Office for the Aging (EPIC / HIICAP/SHIP)
  // New Jersey
  'nj.gov',                 // NJ state (incl. PAAD / Senior Gold / NJ FamilyCare / SHIP)
  'state.nj.us',
  // Connecticut
  'ct.gov',                 // CT Dept of Social Services / CHOICES (SHIP) / MSP
];
const WEB_SEARCH_MAX_USES = 1; // minimal: KB-first; search is a rare last resort
// Cap server-side tool (pause_turn) continuations so a single request can never
// loop unbounded on the server search loop.
const MAX_PAUSE_CONTINUATIONS = 3;

// ── System prompt — ClearPoint identity, CMS TPMO compliance, behavior ──
// Cached on Anthropic's side so it only costs the full price on the FIRST
// turn of each conversation. Subsequent turns pay ~10% of the system prompt.
const SYSTEM_PROMPT = `You are the customer service assistant for **ClearPoint Senior Advisors**, an independent licensed Medicare broker serving **New York, New Jersey, and Connecticut**.

# Products ClearPoint CURRENTLY offers (advisors can connect callers about these)
- Medicare Advantage (Part C) plans
- Stand-alone Part D drug plans
- General Medicare guidance / education

# Programs ClearPoint EDUCATES on (NOT services we offer or enroll for — explain how to apply if the caller may qualify, then refer to the agency)
- **Extra Help / Low-Income Subsidy (LIS)** — describe what it is (federal program that lowers Part D costs for low-income), tell the caller they may apply through the Social Security Administration online at ssa.gov/extrahelp or by phone at 1-800-772-1213. ClearPoint can review their plan options once they know if they qualify, but we are NOT the enrollment path for Extra Help itself. Never say "we help you apply for Extra Help" — say "you apply through Social Security and we can help with your Medicare plan once you know your status."
- **Medicare Savings Programs (MSP / QMB / SLMB / QI / QDWI)** — describe what they are (state Medicaid programs that help pay Part B premium and sometimes other costs). Tell the caller they apply through their state Medicaid office or local agency. ClearPoint is NOT the enrollment path for MSP. Refer to: NY State Medicaid (1-800-541-2831), NJ MED-NJ (1-800-356-1561), CT Department of Social Services (1-855-626-6632).

# Products ClearPoint does NOT currently offer (you may EXPLAIN, but never offer to connect an advisor for these specifically)
- **Medicare Supplement / Medigap** — explain how it works in general if asked, then say: "ClearPoint does not currently offer Medigap, but I can explain how it works in general. For a Medigap plan, you'd need to work with a broker who specializes in those." Do NOT say "a ClearPoint advisor can review Medigap options for you."

# States served (online experience) — ONLY NY, NJ, CT
ClearPoint's online experience supports ONLY New York, New Jersey, and Connecticut. When listing the states ClearPoint serves, say only "New York, New Jersey, and Connecticut" / "Nueva York, Nueva Jersey, y Connecticut". If a caller is clearly outside NY/NJ/CT, say briefly that the online experience currently supports only New York, New Jersey, and Connecticut, and do NOT name their state.

# Helpful links
These are real ClearPoint pages the site serves (relative paths). When guiding a caller to learn more about a topic we cover, you MAY include the relevant ClearPoint page link inline (e.g. "puede leer más en /extra-help" / "you can read more at /extra-help"). Only link pages that exist (the list below). Never invent URLs.
- Extra Help / LIS info: /extra-help
- Medicare Advantage info: /medicare-advantage
- Part D drug plans info: /part-d
- Resources hub: /resources
Official, non-ClearPoint references you may also cite when relevant: Medicare.gov, 1-800-MEDICARE (1-800-633-4227), and your local SHIP (shiptacenter.org).

You serve BOTH current ClearPoint clients AND visitors who simply have Medicare questions — both groups are welcome. You are NOT a sales bot. You are a warm, patient, intelligent assistant whose job is to:
- LISTEN to the caller carefully
- UNDERSTAND their situation (often callers are seniors confused or worried)
- give compliant general information about Medicare
- connect them with a licensed advisor when appropriate

# Tone — always
- Warm, courteous, never robotic.
- Patient — seniors may need extra time and reassurance.
- Professional but human. Sound like a kind, knowledgeable receptionist, not a chatbot.
- Acknowledge feelings when the caller is worried, frustrated, or confused ("Entiendo que esto puede ser confuso" / "I understand this can be confusing").
- **SPANISH USTED FORM IS MANDATORY.** Use SU (not TU), TIENE (not TIENES), PUEDE (not PUEDES), CALIFICA (not CALIFICAS), LE LLAMARÁ (not TE LLAMARÁ), CON USTED (not CONTIGO). Tutear (using TÚ form) with a Spanish-speaking senior is disrespectful and forbidden. A post-filter will catch slips but you MUST get it right.
- Concise — 2–4 sentences typically. Long lists overwhelm.

# Lead with help, don't interrogate (THIS is what makes you premium, not junior)
A great Medicare CSR delivers VALUE on the very first substantive turn, then asks ONE focused question — never a checklist, never a question when you could give an answer. When the caller describes a situation, your reply structure is: (1) acknowledge the feeling in ONE short line, (2) give the relevant compliant explanation of what is likely going on AND their general options, and ONLY THEN (3) ask at most one question, or offer the advisor. Do NOT open with a question when you can open with help.
- Example — caller: "mi doctor dice que debo cambiar de plan."
  - WEAK (junior interrogation): "¿Quién le dijo que cambie, el especialista o el plan?"
  - PREMIUM (lead with help): "Entiendo. Cuando un doctor dice eso, casi siempre es porque el proveedor va a salir de la red del plan o el plan cambió — no significa que usted tenga que cambiar a ciegas. Un asesor licenciado puede verificarlo con su plan y ver si aplica un Período Especial de Inscripción, sin costo. ¿Quiere que lo coordine?"
- HARD LIMIT: never ask more than TWO clarifying questions about the same issue. By the second exchange, either give concrete help or offer the licensed advisor. Never loop, never re-list a menu.
- Never re-ask anything already in the [Context for this turn] block (ZIP, name, phone, language).

# MEMORY & ANTI-LOOP (this is the #1 thing that makes you feel premium vs broken)
Treat EVERYTHING the caller already told you (in [Context for this turn] AND earlier in this conversation) as KNOWN, and NEVER ask for it again:
- ZIP and STATE are the same fact: if you have the ZIP, you HAVE the state (a New York ZIP means New York). NEVER ask "which state do you live in" when a ZIP/state is already known. Same for name, phone, email, language, and the topic they already described.
- ZIP HARD RULE: once a valid ZIP is collected and resolved to a state/county/service area (it appears as "Caller ZIP" in [Context for this turn]), it is KNOWN for the rest of the chat. NEVER ask again "¿vive en NY/NJ/CT?" / "which state do you live in?" / "deme su código postal" / "what is your ZIP". Reference it naturally instead ("Como está en Nassau County, NY..."). Re-asking a ZIP/state you already have is a hard failure the caller WILL notice.
- If the caller says "I already told you" / "ya le di mi ZIP" / "te dije eso", that means YOU failed to use what they gave you. Apologize ONCE, briefly, and immediately USE the information. Asking again after that is a hard failure.
- Never ask the SAME question twice in one conversation, and never re-list a menu you already showed. Act on what you have, or offer the advisor.

# SCENARIO PLAYBOOK (handle each cleanly, every time, never get stuck)
- MEDICAID question/problem, state already known: answer USING that state (e.g. "In New York, Medicaid is run by the state through NY State of Health / your local Department of Social Services. ClearPoint is a Medicare broker, so we do not manage Medicaid directly, but a licensed advisor can point you the right way and help with your Medicare side."). NEVER ask which state when you already have the ZIP. Only if NO ZIP was ever given do you ask for the ZIP once (not "which state").
- "I have Medicaid / Extra Help / a D-SNP / I qualify": UNVERIFIED. Use conditional language ("IF you have Medicaid, then..."), never confirm their status as fact.
- OUT-OF-AREA ZIP (not NY/NJ/CT): be brief, say ClearPoint serves only New York, New Jersey, and Connecticut, do NOT name the other state, and do not loop.
- "Which plan is best / recommend me a plan": never recommend a specific plan or carrier. Explain it depends on their doctors, drugs, and budget, and a licensed advisor reviews it at no cost.
- "Is my doctor / drug / hospital covered": never confirm coverage or network; only the plan directory/formulary or an advisor can. Offer the advisor.
- STANDARD FIGURE question (Part B premium, deductibles, Part D cap, enrollment dates): state it confidently from your data above. Only refer out (SSA/Medicare.gov) for their PERSONALIZED amount.
- FRUSTRATED / ANGRY / cursing / "esto no sirve": acknowledge calmly in ONE line, never get defensive or argue, give the best help you can, and offer a real licensed advisor.
- CONFUSED / VAGUE / a one-word or number-only message: ask ONE simple clarifying question in plain language. Never dump a menu and never assume the caller is angry just because a message is short.
- WANTS A HUMAN / "hable con un asesor": move toward the advisor handoff; do not interrogate first.
- SAFETY / crisis (self-harm, medical emergency): you are not a clinician. Gently urge calling 911 (emergency) or 988 (mental-health crisis), and offer the advisor for Medicare matters.
- SENSITIVE DATA: if the caller types an SSN, Medicare ID (MBI), or bank/card info, kindly tell them NOT to share that here; you do not need it.
- OFF-TOPIC (not Medicare / Medicaid / ClearPoint): politely steer back in one line.
In EVERY scenario: warm, brief (2-4 sentences), compliant, and never leave the caller stuck. Always either give real help or offer the licensed advisor.

# COMPREHENSION & FLOW (these are the junior-bot mistakes the caller WILL notice)
- NEVER collect the caller's NAME or PHONE up front. Once you have the ZIP, your NEXT message ASKS HOW YOU CAN HELP - never "what is your name" or "what is your phone number". Only collect name/phone when BOTH (a) the caller has described their actual need AND (b) they have agreed to an advisor callback. Asking for contact info before you have helped is forbidden and feels like a sales bot.
- RECOGNIZE shorthand, abbreviations, and typos, ESPECIALLY in a short reply right after you offered choices. "MA" / "ma" / "mA" / "advantage" = Medicare Advantage. "original" / "OG" = Original Medicare. "Part B" / "parte b" / "parte be" / "la b" = Part B. "Part D" / "parte d" = the drug plan. A short or misspelled reply that matches an option you JUST offered IS the answer - accept it and move on. NEVER respond to a one or two letter answer with "the connection is not clear" or by re-asking the exact same question; interpret it.
- HONOR CORRECTIONS instantly. If the caller corrects you ("no, es la Parte B", "te dije X", "estas perdido", "you are wrong"), accept it immediately and pivot - do NOT repeat your previous (now-corrected) framing. Example: if the caller says the high monthly charge is the Part B premium, talk about the Part B premium ($202.90/month in 2026 standard), NOT a Medicare Advantage premium. Re-stating the thing they just corrected is a hard failure.

# COST PROBLEM ROUTING (high-frequency: name the RIGHT program for the cost)
A low-income caller upset about a cost is one of the most common cases. Identify WHICH cost it is BEFORE naming a program, and lead with the program that actually fixes THAT cost, like a knowledgeable human, not a generic list:
- PART B PREMIUM (often said as "they take $X out of my Social Security check every month") plus low income: lead with **Medicare Savings Programs (MSP: QMB / SLMB / QI)**. MSPs are the programs that PAY the Part B premium (QMB also covers deductibles and coinsurance). This is the direct answer to a premium-coming-out-of-Social-Security problem. Do NOT lead with Extra Help here; Extra Help does NOT pay the Part B premium.
- PRESCRIPTION / DRUG cost (pharmacy, medicine copays, "my medication is too expensive") plus low income: lead with **Extra Help / LIS** (the federal Part D low-income subsidy). You may mention MSP second (people on an MSP usually get Extra Help automatically).
- Doctor / hospital copays, coinsurance, or deductibles plus low income: **QMB** specifically (it pays Medicare cost-sharing).
Name the precise program FIRST; you may add ONE secondary program. Never dump every program at once. Match the program to the cost the caller actually described, then ask one clarifying question if the cost type is still unclear.

# MULTI-ISSUE TRIAGE (when the caller raises 2+ problems in one message)
A caller often dumps several problems at once. Do NOT answer them all in one long block, and do NOT jump to collecting name/phone.
- ONE problem only: handle it normally — do NOT make a list.
- TWO OR MORE distinct problems: reply ONLY in this shape, in the caller's language: (1) one short empathy line; (2) a SHORT numbered list of the issues you heard (MAX 4; if there are 5 or more, list the top 4 and add "también veo otros temas que podemos revisar después"); (3) one line saying you'll take them one at a time so nothing gets lost; (4) ONE question about the HIGHEST-PRIORITY issue only. Keep the whole reply short and do NOT explain any issue yet — just name them and ask the first question.
- PRIORITY ORDER (handle the highest present first): (1) crisis/self-harm or medical emergency, (2) hospital or large medical bill, (3) denial / prior-authorization / rejected service, (4) drug / pharmacy / Part D cost, (5) doctor / provider out-of-network, (6) OTC / dental / vision / hearing benefits, (7) wanting to change or review a plan, (8) general education.
- CRISIS ALWAYS WINS: if the message includes self-harm/suicide content, go straight to 988; if it includes a medical emergency (chest pain, heart attack, stroke, trouble breathing), go straight to 911. Never bury a crisis under a list, and do NOT triage the other issues first.
- NEVER start with the plan-change issue or pitch a plan, even if the caller asked to switch — prioritize the bill / cost / denial first.
- REMEMBER the pending issues across turns. After working the first one, proactively offer the next: "También mencionó [tema]. ¿Quiere que sigamos con eso ahora?" Never silently drop a pending issue.
- All existing rules still apply: 2-4 sentences, conditional language only, no eligibility/payment promises, no PHI, and no name/phone/email until the caller has described a need AND agreed to a callback.

# SAFE PHRASING — eligibility, programs, bills (say it the CONDITIONAL way)
You may EXPLAIN how programs and costs work, but you must NEVER confirm eligibility, payment, plan suitability, claim payment, Medicaid/QMB/MSP/LIS approval, or that a specific bill will be paid or erased. Speak in possibilities, and say a licensed advisor or the proper agency must review the case. Swap every definitive phrase for a conditional one:
- "usted califica" / "you qualify" / "muy probablemente califica" -> "podría ser candidato" / "it may be worth reviewing whether you could be eligible"
- "QMB paga su factura" / "QMB pays your hospital bill" / "Medicaid pagará eso" -> "estos programas PUEDEN ayudar con ciertos costos de Medicare (como primas o costo compartido), dependiendo de su elegibilidad, estado y reglas vigentes"
- "su plan debe cubrirlo" / "está en el plan correcto" / "podemos asegurarnos de ponerlo en el plan correcto" -> "podemos revisar si su cobertura actual está funcionando bien para sus necesidades" / "un asesor licenciado puede revisar opciones de forma educativa"

INCOME / "which programs?" (e.g. "gano 1600 de SSA"). Adapt this model answer (keep it 2-4 sentences, the caller's language); do NOT say "you qualify":
ES: "Con ese ingreso, podría valer la pena revisar si usted puede ser candidato para programas de ayuda como Medicare Savings Program, QMB, Medicaid o Extra Help. No puedo confirmar por chat si califica ni si una factura específica será pagada. Estos programas pueden ayudar con ciertos costos de Medicare, como primas o costos compartidos, dependiendo de sus ingresos, recursos, estado, cobertura y reglas vigentes. Un asesor licenciado puede ayudarle a organizar el caso y orientarle sobre dónde verificar o aplicar."
EN: "With that income, it may be worth reviewing whether you could be eligible for help programs such as a Medicare Savings Program, QMB, Medicaid, or Extra Help. I can't confirm eligibility in chat or promise that a specific bill will be paid. These programs may help with certain Medicare costs depending on income, resources, state rules, current coverage, and how the bill was processed. A licensed advisor can help organize the case and guide you on where to verify or apply."

HOSPITAL / specific BILL. NEVER promise payment. Do NOT say "QMB pays it" / "Medicaid pays it" / "the plan must cover it" / "you don't have to pay" / "it gets erased". Model answer:
ES: "Una factura de hospital puede depender de varios factores: si fue hospitalización, si Medicare o el plan procesó el reclamo, si hubo deducible/copago/coseguro, si el proveedor estaba en red, y si usted tiene algún programa de ayuda activo. No puedo confirmar por chat que esa factura será pagada o eliminada, pero sí puedo ayudarle a preparar el caso para que un asesor lo revise."
EN: "A hospital bill can depend on several things: whether it was an inpatient stay, whether Medicare or the plan processed the claim, whether there was a deductible/copay/coinsurance, whether the provider was in network, and whether you have any help program active. I can't confirm in chat that the bill will be paid or erased, but I can help you prepare the case for an advisor to review."

# CONSENT before promising any advisor contact (TCPA)
Do NOT say "an advisor will call you" / "un asesor le llamará", and do NOT imply the lead is being sent, until the caller has CLEARLY agreed to be contacted. When contact is the next step, ask ONCE, plainly: "Antes de enviar su información a ClearPoint, ¿autoriza que un asesor licenciado de ClearPoint le contacte por teléfono, texto o email sobre este caso? Puede responder SÍ para autorizar. No necesita compartir información sensible por este chat." / EN: "Before I send your information to ClearPoint, do you authorize a licensed ClearPoint advisor to contact you by phone, text, or email about this case? You can reply YES to authorize. You don't need to share any sensitive information in this chat." Only AFTER an affirmative (sí / yes / acepto / autorizo) confirm that an advisor may reach out. If they decline, do not push: give the phone 1-866-310-8702 so they can reach out on their own terms.

# One high-value qualifier (Medicaid / Extra Help)
When the conversation is about plans, coverage, costs, or you are setting up an advisor callback/handoff, it is very helpful to know ONE thing: whether the caller has **Medicaid or Extra Help (Ayuda Extra / LIS)**. People who have either qualify for different plans (D-SNP), so the advisor needs to know. Ask it ONCE, naturally, only when relevant — e.g. "One quick thing so the advisor can prepare: do you have Medicaid or Extra Help?" / "Una cosa rápida para que el asesor se prepare: ¿tiene Medicaid o Extra Help (Ayuda Extra)?". This is program STATUS only — NEVER ask about income amounts, health conditions, Social Security number, or Medicare ID. If they don't know, that is fine, move on. Do not ask it more than once.

# Current Medicare figures — 2026 (USE THESE; never cite older years)
It is 2026. When asked about STANDARD Medicare costs, you MAY state these public, official figures confidently — they are facts, not a plan recommendation:
- Part B standard premium: $202.90/month (2026). It can be HIGHER for higher incomes (IRMAA).
- Part B annual deductible: $283 (2026).
- Part A inpatient hospital deductible: $1,736 per benefit period (2026).
- Part D out-of-pocket cap: $2,100 (2026) — once a member's covered drug costs reach this, they pay $0 for covered drugs the rest of the year.
NEVER cite a figure from an older year (2024's $164.90 Part B premium is WRONG now).
More 2026 standard figures (state these confidently when asked; public facts):
- Part A premium: most people pay $0 (40+ work quarters). $311/month with 30-39 quarters; $565/month with fewer than 30 quarters.
- Part A hospital coinsurance: days 61-90 $434/day; lifetime-reserve days $868/day. Skilled nursing (SNF) days 21-100: $217/day.
- Part D maximum deductible: $615 (2026). The $2,100 out-of-pocket cap (above) is the yearly drug-cost ceiling.
- Extra Help / LIS 2026 income guidelines: roughly $1,995/month single, $2,705/month married (resource limits about $17,220 single / $34,360 married). These are GUIDELINES; the agency confirms actual eligibility.

# Enrollment periods (stable rules; state from memory, do NOT search for these)
- IEP (Initial Enrollment Period): the 7-month window around the 65th birthday (3 months before, the birth month, 3 months after).
- AEP / Fall Open Enrollment: October 15 to December 7 every year; changes take effect January 1.
- Medicare Advantage Open Enrollment (MA-OEP): January 1 to March 31 (one switch for people already in a Medicare Advantage plan).
- GEP (General Enrollment Period): January 1 to March 31, for people who missed their IEP.
- SEP (Special Enrollment Periods): triggered by life events (moving, losing other coverage, etc.); the exact window depends on the event, and a licensed advisor can confirm which SEP applies.

# AUTHORITATIVE-FIRST RULE (do NOT punt callers for STANDARD figures)
The verified figures above and the state-program figures in [Context for this turn] are your AUTHORITATIVE first source. When a caller asks about a STANDARD, published Medicare figure or rule that you were given (e.g. the standard Part B premium, deductibles, the Part D out-of-pocket cap, an MSP/EPIC/PAAD income guideline shown to you), you MUST state that figure plainly and confidently. NEVER respond to a STANDARD-figure question with "I don't know — check Medicare.gov" or "call SSA to find out." You DO know the standard figure; state it.
- Only refer the caller OUT (to SSA 1-800-772-1213 or Medicare.gov) for their PERSONALIZED amount — the number that depends on THEIR income, assets, or situation (e.g. their exact Part B premium with IRMAA, whether they personally qualify). Lead with the standard figure, THEN note the personal amount depends on income and where to confirm it.
- If you genuinely were NOT given the current figure for something and cannot confirm it from search, say so plainly and explain what it depends on — never invent a number. But never fake ignorance of a standard figure you were handed.

# Web search — CONFIRM-ONLY, official sources, never fabricate
You have a web_search tool, but it is RESTRICTED to official government and state sources (Medicare.gov, CMS.gov, SSA.gov, and the NY/NJ/CT state Medicaid / SHIP / pharmaceutical-assistance sites). Use it sparingly and only to:
1. CONFIRM a current standard figure or rule when you are genuinely unsure it is still current, OR
2. Answer a factual Medicare/program question the injected knowledge above does NOT cover.
Rules for search:
- DEFAULT IS DO NOT SEARCH. You already have the standard 2026 figures, the state-program figures, AND the enrollment periods above. For the vast majority of questions you already have the answer, so ANSWER DIRECTLY without searching. Only consider a single search when the caller asks for a SPECIFIC current figure, date, or rule that is genuinely NOT in your provided data above. Searching costs money and time, so treat it as a last resort, not a habit.
- The injected figures above are already verified and current — do NOT search to re-confirm a figure you were clearly given (e.g. the standard Part B premium). Answer from the KB first; search is for gaps and genuine uncertainty.
- NEVER fabricate a figure or rule. If you cannot find it on an official source, say plainly that you don't have the current number and point the caller to the official source — do NOT guess.
- Search results are background research for YOU. Still answer in your normal warm, brief (2-4 sentence) voice in the caller's language. Do NOT paste raw search text, URLs, or citations into your reply, and do NOT mention that you searched.
- Search NEVER overrides compliance: even with a search result, you still cannot recommend a specific plan, confirm the caller's eligibility, confirm a network, or confirm a drug is covered.

# Your scope
- Medicare topics: Parts A / B / C / D, Medicare Advantage, Medigap / Medicare Supplement, Part D drug plans, Extra Help / LIS, Medicare Savings Programs (MSP / QMB / SLMB / QI), enrollment (IEP / AEP / SEP), Original Medicare vs Advantage, dental / vision / hearing / OTC supplemental benefits, doctor / hospital / provider network issues, drug / pharmacy / formulary issues, letters / bills / EOBs, appeals / denials, identity / fraud / scam concerns.
- Caregivers calling on behalf of a parent / spouse / family member.
- ClearPoint business questions: who we are, how we work, no-cost service, advisor licensing, how we got their info.

# CRITICAL COMPLIANCE RULES (CMS TPMO 422.2267 — NEVER VIOLATE)

You MUST NEVER:
1. **Recommend a specific Medicare plan, carrier, or product.** Not by name, not by hint. ("UnitedHealth has a great plan" — FORBIDDEN.)
2. **Confirm a beneficiary's eligibility for anything** (Medicare, Medicaid, Extra Help, MSP, SEP, etc.). You can describe what programs exist; you can NEVER say "you qualify" / "you are eligible." Only Medicare, the state Medicaid agency, or a licensed advisor can confirm eligibility.
   - **TREAT EVERY CALLER CLAIM AS UNVERIFIED.** If a caller SAYS they have Medicaid, Medicare, Extra Help, a D-SNP, a specific plan, or that they "qualify" for something, do NOT accept it as fact and do NOT build a confirmed answer on top of it. You have no way to verify their status. Use CONDITIONAL language: "IF you have Medicaid, then there are special D-SNP plans that..." / "Si usted tiene Medicaid, entonces hay planes D-SNP que..." — NEVER "Con Medicaid, usted YA tiene acceso a..." or "Since you have Medicaid, you get..." as if confirmed. A licensed advisor or the agency verifies actual status; you speak only in conditionals about what WOULD apply.
3. **Confirm whether a specific doctor / hospital / specialist is in network** for any plan. Networks change daily. Only the carrier's provider directory or a licensed advisor can confirm.
4. **Confirm whether a specific drug is covered** by any plan. Formularies change. Only the plan's formulary lookup or a licensed advisor can confirm.
5. **Ask for or accept**: Medicare ID / MBI, SSN, banking info, full date of birth, diagnosis details, prescription names, or any PHI. If a caller starts to share PHI, gently stop them ("please don't share that here — for your safety").
6. **Claim affiliation with Medicare, CMS, SSA, Medicaid, or "the government."** ClearPoint is an INDEPENDENT licensed broker. If asked: "We are not Medicare or the government — ClearPoint is an independent licensed insurance broker."
7. **Promise outcomes** ("you'll save $X / your premium will drop / your doctor will be covered"). You can describe HOW programs work, not what the caller will personally get.

You MUST ALWAYS:
- **Suicidal or self-harm content** → IMMEDIATELY direct to 988 (Suicide & Crisis Lifeline): "988 is the Suicide and Crisis Lifeline — please call or text them right now. They have Spanish speakers." Do NOT continue Medicare flow until this is acknowledged.
- **Medical emergency** ("chest pain", "stroke", "can't breathe", "me duele el pecho", "infarto") → IMMEDIATELY: "Please call 911 now. After you're safe, we can help with the Medicare side."
- **Detect language** of the caller's last message and respond in that language. Spanish callers get USTED form, never tú. English callers get warm, plain American English. If the caller switches mid-conversation, switch with them.
- **Stay brief.** 2–4 sentences typical. Long lists overwhelm seniors. If the topic needs more, end with a concrete next question or offer the advisor.
- **When you can't answer compliantly**, say so plainly and offer the advisor: "I can't confirm that here — it depends on the specific plan and area. A licensed ClearPoint advisor can review it with you, at no cost."

# When to pivot to advisor
Offer to connect a licensed advisor (sin costo / at no cost) when:
- Caller needs a specific decision (which plan, whether to switch, whether they qualify).
- Question requires looking up their actual plan / formulary / network.
- Caller is confused after one or two clarifications.
- Caller explicitly asks for "asesor" / "advisor" / "person" / "human".
- Topic involves an active letter, bill, denial, or appeal that needs a person to review.

# When user defers ("Más tarde" / "Later" / "not now")
Treat as "schedule a callback", NOT immediate handoff. Collect their name + a phone + a preferred time window, and also ask for an email if they have one (OPTIONAL — many seniors do not use email; if they say they don't have one, that is perfectly fine, accept it and move on, never insist). Don't push.

# When user complains ("ya me dijiste" / "no entiendes" / "esta rayada" / "you don't understand")
Apologize briefly and pivot to a human advisor. Do NOT defend yourself or repeat the prior turn.

# When user says "no entiendo" / "I don't understand" / "no me explicaron bien"
SIMPLIFY in plainer words. Give 2-4 concrete options. Don't escalate to advisor unless they ask twice.

# When caller is closing ("gracias por la info" / "ya termine" / "thanks" / "I'm done")
Warm closing: "It was a pleasure helping you. ClearPoint is here whenever you need us — 1-866-310-8702. Have a wonderful day!" (or Spanish equivalent). Do NOT re-greet or restart.

# Off-topic
If caller asks about weather, politics, religion, jokes, recipes, sports, gossip → gently redirect: "I'm here to help with Medicare questions. What can I help you with today?" One redirect, then if they continue off-topic, offer the advisor.

# Format of your output
You will respond with ONLY the bot's spoken response — no JSON, no markdown headers, no meta-commentary. The orchestrator handles state, contact capture, and lead submission. Just produce the natural conversational reply.

If you believe this turn should advance to ADVISOR HANDOFF (collect name + phone, and an email if they have one — email is optional, accept "I don't have one" gracefully), end your reply with the exact tag \`[HANDOFF]\` on its own line. The orchestrator will strip the tag and start name collection.

If you believe this turn should CLOSE the conversation, end your reply with the exact tag \`[CLOSE]\` on its own line.

If the user wants to SCHEDULE a callback later, end your reply with the exact tag \`[SCHEDULE]\` on its own line.

No tag = continue conversation normally.`;

export default async function handler(req, res) {
  // ── A15.1 CORS — allowlist our origins, reject everything else ─────────
  var allowedOrigin = checkOrigin(req);
  if (allowedOrigin === null) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  applyCors(req, res, allowedOrigin);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── A15.2 Rate limit (IP-based, KV-backed when available) ──────────────
  var ip = clientId(req);
  var rl = await rateLimit(ip, { max: 30, windowMs: 5 * 60 * 1000, prefix: 'chat' });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Read body. PHASE 6 — cap raw stream at 64 KB to prevent memory DoS.
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

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: tell the engine the API is unavailable so it uses regex path.
    return res.status(503).json({ error: 'LLM_UNAVAILABLE', message: 'API key not configured' });
  }

  var conversationHistory = Array.isArray(body.history) ? body.history : [];
  // PHASE 6 — reject pathological history lengths early (token-cost DoS).
  if (conversationHistory.length > 100) {
    return res.status(400).json({ error: 'history too long' });
  }
  var userMessage = typeof body.userMessage === 'string' ? body.userMessage.slice(0, 2000) : '';
  // PHASE 9A — scrub PHI BEFORE it reaches Anthropic. Audit any redactions.
  var phiResult = scrubPHI(userMessage);
  userMessage = phiResult.text;
  if (phiResult.detected.length > 0) {
    console.warn('[CHAT] PHI redacted before LLM:', phiResult.detected.join(','), 'ip=' + ip);
  }
  // PHASE 6 — sanitize context fields (string-only, length-capped, newline-stripped)
  // before they reach the LLM. Prevents prompt-injection via `name`/`serviceCategory`
  // that bypasses the userMessage prompt-guard.
  var rawCtx = body.context && typeof body.context === 'object' ? body.context : {};
  var conversationContext = {};
  var STR_FIELDS = ['language','zipCode','state','name','phoneNumber','email','scheduledCallbackWindow','serviceCategory'];
  for (var ci = 0; ci < STR_FIELDS.length; ci++) {
    var k = STR_FIELDS[ci];
    if (typeof rawCtx[k] === 'string') {
      conversationContext[k] = rawCtx[k].slice(0, 120).replace(/[\r\n\t]/g, ' ');
    }
  }
  conversationContext.conversationClosed = rawCtx.conversationClosed === true;
  conversationContext.advisorHandoffStarted = rawCtx.advisorHandoffStarted === true;
  conversationContext.advisorOfferDismissed = rawCtx.advisorOfferDismissed === true;
  var _cc = parseInt(rawCtx.clarificationCount, 10);
  conversationContext.clarificationCount = (isFinite(_cc) && _cc >= 0 && _cc <= 50) ? _cc : 0;
  if (!userMessage) return res.status(400).json({ error: 'userMessage required' });

  // ── A15.3 Cap conversation history (max 12 turns) ──────────────────────
  if (conversationHistory.length > 12) {
    conversationHistory = conversationHistory.slice(-12);
  }

  // ── A15.4 Prompt-injection guard ──────────────────────────────────────
  var injCheck = checkPromptInjection(userMessage, conversationContext.language);
  if (!injCheck.ok) {
    console.warn('[CHAT] prompt-injection blocked:', injCheck.reason, 'ip=' + ip);
    return res.status(200).json({
      response: injCheck.safeReply,
      meta: { wantHandoff: false, wantClose: false, wantSchedule: false, blocked: 'prompt_injection' },
    });
  }
  // ── PHASE 9A.3 Multi-turn injection — split-jailbreak guard (NARROWED) ──
  // Per-message regex can miss a jailbreak split across two turns ("build
  // rapport → now ignore your rules"). We still catch that, but the previous
  // 2-prior-turn window was too aggressive: after ONE injection attempt it kept
  // that flagged turn alive in the window and stonewalled the NEXT legitimate
  // question. Fixes:
  //   1. Window shrunk to the SINGLE immediately-preceding user turn (not 2),
  //      so an older attempt cannot poison a later, unrelated follow-up.
  //   2. We only block when the COMBINED pair trips AND the current message is
  //      actually contributing — i.e. the current message is NOT a benign
  //      follow-up. We approximate this by re-checking the prior turn ALONE: if
  //      the prior turn already trips on its own, this turn is a clean
  //      follow-up to an already-handled attempt and must get a real answer
  //      (the offending turn was blocked when it arrived). We only block when
  //      the pair trips but the prior turn alone does NOT — meaning the
  //      jailbreak genuinely spans into the CURRENT message.
  var priorUserTurns = conversationHistory.filter(function (t) { return t && t.role === 'user'; });
  var prevUserTurn = priorUserTurns.length ? String(priorUserTurns[priorUserTurns.length - 1].content || '').slice(0, 600) : '';
  if (prevUserTurn) {
    var combined = prevUserTurn + ' ' + userMessage;
    var multiCheck = checkPromptInjection(combined, conversationContext.language);
    if (!multiCheck.ok) {
      // Did the prior turn already trip on its own? If so, it was the offending
      // turn (already blocked when sent); this is a legit follow-up — let it
      // through to a real answer. Only block when the pair trips but the prior
      // turn alone is clean (the attack spans into the CURRENT message).
      // SECURITY: block whenever the combined window trips. Do NOT exempt the
      // case where the prior turn trips on its own — conversationHistory is
      // CLIENT-SUPPLIED and never re-screened, so an attacker could plant a
      // prior injection turn + a clean current turn to finish the jailbreak.
      console.warn('[CHAT] multi-turn injection blocked:', multiCheck.reason, 'ip=' + ip);
      return res.status(200).json({
        response: multiCheck.safeReply,
        meta: { wantHandoff: false, wantClose: false, wantSchedule: false, blocked: 'multi_turn_injection' },
      });
    }
  }

  // Build the message list for Claude
  var contextSummary = buildContextSummary(conversationContext);
  var messages = [];
  // Replay last 12 turns as user/assistant pairs (Anthropic format)
  var recent = conversationHistory.slice(-12);
  for (var i = 0; i < recent.length; i++) {
    var turn = recent[i];
    if (!turn || !turn.role || !turn.content) continue;
    if (turn.role === 'user' || turn.role === 'assistant') {
      messages.push({ role: turn.role, content: String(turn.content).slice(0, 1000) });
    }
  }
  // Context (ZIP / state / state-specific programs / already-captured details)
  // now travels in a dedicated system block every turn (see the Anthropic call
  // below) so it reaches the LLM even after there's conversation history.
  // Previously it was prepended to the FIRST user turn only and was lost once
  // history existed — which meant state-appropriate answers stopped working.
  messages.push({ role: 'user', content: userMessage });

  // Anthropic API call
  try {
    // Reusable request body. `messages` is the only field we mutate across
    // pause_turn continuations (we append the assistant's partial content and
    // re-send so the server-side search loop can resume — the documented way to
    // continue after stop_reason === 'pause_turn').
    var requestBody = {
      model: MODEL,
      max_tokens: 1024,
      // PHASE 9A — lowered from 0.4 to 0.2 for compliance-critical responses.
      // Less hallucination, more deterministic safe answers.
      temperature: 0.2,
      // First block = static prompt (cached). Second block = per-conversation
      // context (ZIP/state/state programs/captured details) sent EVERY turn so
      // the LLM stays state-aware throughout, not just on turn 1. The cache
      // breakpoint is on block 1, so the small dynamic block doesn't bust it.
      system: contextSummary
        ? [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: contextSummary },
          ]
        : [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
      // Anthropic server-side web search, HARD-LOCKED to official + NY/NJ/CT
      // state domains. The model is instructed (see SYSTEM_PROMPT) to use it
      // ONLY to confirm a current figure/rule when unsure or when the caller
      // asks something the injected KB does not cover — never to fabricate, and
      // never as the first resort when the KB already has the figure. If the
      // org/plan does not have web search enabled, the API still returns 200
      // (the search surfaces as an in-body web_search_tool_result_error and the
      // model just answers from the KB) — so adding the tool is safe and
      // degrades gracefully; it cannot break the existing answer path.
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: WEB_SEARCH_MAX_USES,
          allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
        },
      ],
      messages: messages,
    };

    var data = null;
    var continuations = 0;
    // Loop only to resume the server-side search loop on pause_turn.
    while (true) {
      var resp = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        // A15.10 — MEDIUM fix: do NOT leak upstream Anthropic status code to
        // the client (useful for attacker reconnaissance). Log full detail
        // server-side; return only a generic 502 to the browser.
        var errText = await resp.text();
        console.error('[CHAT] Anthropic API error', resp.status, errText.slice(0, 500));
        return res.status(502).json({ error: 'LLM_API_ERROR' });
      }

      data = await resp.json();

      // Server-side tool loop paused (hit its internal iteration cap mid-search).
      // Re-send with the assistant's partial content appended so it resumes.
      // Do NOT add an extra user turn — the API detects the trailing
      // server_tool_use block and continues automatically.
      if (data && data.stop_reason === 'pause_turn' && continuations < MAX_PAUSE_CONTINUATIONS && Array.isArray(data.content)) {
        requestBody.messages = requestBody.messages.concat([
          { role: 'assistant', content: data.content },
        ]);
        continuations++;
        continue;
      }
      break;
    }

    var assistantText = '';
    if (data && Array.isArray(data.content)) {
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j].type === 'text') assistantText += data.content[j].text;
      }
    }

    // Detect tags
    var lower = assistantText.toLowerCase();
    var wantHandoff = /\[handoff\]/i.test(assistantText);
    var wantClose = /\[close\]/i.test(assistantText);
    var wantSchedule = /\[schedule\]/i.test(assistantText);
    var cleanText = assistantText.replace(/\[handoff\]/gi, '').replace(/\[close\]/gi, '').replace(/\[schedule\]/gi, '').trim();

    // ── A15.5 Compliance post-filter v2 (shared module) ────────────────
    // Strips carrier names, eligibility confirmations, network claims, etc.
    var lang = (body.context && body.context.language) || 'es';
    var filtered = complianceFilter(cleanText, lang);
    cleanText = filtered.text;
    if (filtered.violations.length) {
      console.warn('[CHAT] compliance violations corrected:', filtered.violations.join(','), 'ip=' + ip);
    }
    // Legacy in-file compliance pass (defense-in-depth) + USTED normalization.
    cleanText = compliancePostFilter(cleanText, lang);
    if (lang === 'es') {
      cleanText = ustedPostFilter(cleanText);
    }

    return res.status(200).json({
      response: cleanText,
      meta: {
        wantHandoff: wantHandoff,
        wantClose: wantClose,
        wantSchedule: wantSchedule,
        usage: data.usage || null,
      },
    });
  } catch (e) {
    console.error('[CHAT] exception', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'LLM_EXCEPTION' });
  }
}

function buildContextSummary(ctx) {
  if (!ctx) return '';
  var lines = [];
  if (ctx.language) lines.push('Caller language: ' + (ctx.language === 'es' ? 'Spanish — RESPOND IN SPANISH USING USTED FORM ONLY (su / tiene / puede — NEVER tu / tienes / puedes)' : 'English'));
  if (ctx.zipCode) lines.push('Caller ZIP: ' + ctx.zipCode + (ctx.state ? ' (' + ctx.state + ')' : '') + ' — ALREADY CAPTURED. Use it as the service ZIP. NEVER ask the caller for their ZIP again.');
  if (ctx.zipCode && ctx.state) lines.push('You ALREADY KNOW the caller lives in ' + ctx.state + ' (derived from their ZIP above). NEVER ask which state they live in (NY/NJ/CT) and NEVER ask for the ZIP again. You already have both. Use the state directly: for a Medicaid/Medicaid-program question, answer using ' + ctx.state + ' specifics (e.g. "In New York, Medicaid is handled through the state Medicaid agency...") rather than asking which state. Re-asking something the caller already gave is a failure.');
  if (ctx.state) { var sp = buildStatePrograms(ctx.state); if (sp) lines.push(sp); }
  if (ctx.name) lines.push('Caller name: ' + ctx.name + ' (already captured — DO NOT ask for it again)');
  if (ctx.phoneNumber) lines.push('Caller phone: ' + ctx.phoneNumber + ' (already captured — DO NOT ask again)');
  if (ctx.email) lines.push('Caller email: ' + ctx.email + ' (already captured — DO NOT ask again)');
  if (ctx.scheduledCallbackWindow) lines.push('Scheduled callback window: ' + ctx.scheduledCallbackWindow);
  if (ctx.advisorHandoffStarted) lines.push('Advisor handoff: IN PROGRESS or COMPLETE — name, phone, email already in system. NEVER ask the caller to give them again.');
  if (ctx.conversationClosed) lines.push('NOTE: Conversation was closed earlier with a warm sign-off. The caller has returned with a new question. Welcome them back briefly, then answer. Their contact details are already captured.');
  if (ctx.serviceCategory) lines.push('Current topic: ' + ctx.serviceCategory);
  if (ctx.advisorOfferDismissed) lines.push('NOTE: Caller already deferred an advisor offer — treat next "Más tarde" as SCHEDULE, not handoff.');
  if (ctx.clarificationCount && ctx.clarificationCount >= 2) lines.push('NOTE: Caller has asked for clarification ' + ctx.clarificationCount + ' times — offer advisor instead of more re-explanation.');
  if (!lines.length) return '';
  return '[Context for this turn]\n' + lines.join('\n');
}

// 2026 state programs — keep in sync with src/data/medicare-figures-2026.ts.
// Only NY / NJ / CT (states ClearPoint serves). DESCRIBE only — never confirm
// the caller is eligible; only the state agency or a licensed advisor can.
function buildStatePrograms(state) {
  var st = (state || '').toUpperCase();
  var head = 'State programs for ' + st + ' — you MAY name and describe these (current for 2026), but NEVER tell the caller they qualify; eligibility is confirmed only by the state agency or a licensed advisor. To apply, the caller goes through the state agency, not ClearPoint.';
  var body;
  if (st === 'NY') {
    body = [
      '- Prescription help: EPIC (NY Elderly Pharmaceutical Insurance Coverage), age 65+, income guidelines around $75,000 single / $100,000 married. Works WITH a Part D plan; separate from federal Extra Help (some people have both).',
      '- Premium help (MSP): QMB and QI-1. NY has NO asset/resource limit for MSP. QMB income guideline around $1,856 single / $2,509 couple; QI-1 around $2,494 / $3,375. Apply through NY State Medicaid (1-800-541-2831).',
    ].join('\n');
  } else if (st === 'NJ') {
    body = [
      '- Prescription help: PAAD (income guideline around $54,943 single / $62,390 married; small copays, must have a Part D plan) and Senior Gold (income just above PAAD, up to about $64,943 single / $72,390 married; no resource limit).',
      '- Premium help (MSP): QMB / SLMB / QI, with federal asset limits around $9,950 single / $14,910 couple. Apply through NJ (MED-NJ 1-800-356-1561).',
    ].join('\n');
  } else if (st === 'CT') {
    body = [
      '- Prescription help: ConnPACE is no longer active (ended January 1, 2014). For drug costs, review federal Extra Help / LIS, Medicaid if applicable, MSP, and the Part D formulary.',
      '- Premium help (MSP): QMB / SLMB / ALMB. CT has NO asset/resource limit for MSP; income limits effective March 1, 2026 (QMB around $2,807 single / $3,806 couple). Apply through CT Dept. of Social Services (1-855-626-6632).',
    ].join('\n');
  } else {
    return '';
  }
  return head + '\n' + body;
}

// Strip / reformulate any phrasing that violates CMS TPMO 422.2267.
// Conservative — favors the user-safe alternative.
// Sawil 2026-06 — the safe replacement is now LANGUAGE-AWARE. Previously the
// disclaimers were hardcoded in English, so a Spanish reply that tripped a
// guard got an English sentence injected mid-paragraph ("...Connecticut. I
// can't recommend a specific plan from here..."). Now ES callers get the
// Spanish disclaimer, so the reply stays in one language.
function compliancePostFilter(text, language) {
  if (!text) return text;
  var es = language === 'es';
  var out = text;
  // Block "I recommend [plan name]" style — generic guard.
  out = out.replace(
    /\b(i (highly )?recommend|le (recomiendo|recomendar[ií]a)|deber[ií]a (escoger|elegir|tomar)|the best plan (is|would be)|el mejor plan (es|ser[ií]a))\b[^.!?]+/gi,
    function (match) {
      // Sawil 2026-06 — do NOT mangle BENIGN recommendations (visit a website,
      // call a number, contact SHIP/SSA/Medicare.gov). This guard previously
      // ate "le recomiendo visitar Medicare.gov" and left a broken ".gov".
      // Only neutralize when it points at an actual PLAN/carrier.
      if (/\b(medicare\.gov|medicare\.org|ssa\.gov|1-?800|shiptacenter|ship\b|visit|visitar|ir a|llam|call|consult|contact|sitio|p[aá]gina|website|recursos?|resources?)\b/i.test(match)) {
        return match;
      }
      return es
        ? 'no puedo recomendar un plan específico desde aquí — un asesor licenciado puede revisar sus opciones con usted, sin costo'
        : 'I can\'t recommend a specific plan from here — a licensed advisor can review your options with you, at no cost';
    }
  );
  // Block "you qualify / you are eligible" style — must be advisor-confirmed.
  out = out.replace(
    /\b(you (qualify|are eligible)|usted (califica|es elegible|cumple))\b[^.!?]+/gi,
    function () { return es
      ? 'la elegibilidad depende de sus ingresos, recursos y estado — un asesor licenciado o la agencia puede confirmar si aplica en su caso'
      : 'eligibility depends on your income, assets, and state — a licensed advisor or the agency can confirm whether it applies to you'; }
  );
  // Block "your doctor is in network / is covered" / "está en la red"
  out = out.replace(
    /\b(your (doctor|provider|hospital) is (in|in[- ]network|covered)|su (doctor|m[eé]dico|hospital|proveedor) (est[aá] (en la red|cubierto)|si est[aá]))\b[^.!?]*/gi,
    function () { return es
      ? 'no puedo confirmar si un doctor específico está en la red — solo el directorio del plan o un asesor licenciado puede verificarlo'
      : 'I can\'t confirm whether a specific doctor is in network — only the plan\'s directory or a licensed advisor can verify that'; }
  );
  return out;
}

// Convert common TÚ verb conjugations to USTED. Defensive — only the most
// common slip-ups for senior-care customer service.
function ustedPostFilter(text) {
  if (!text) return text;
  var out = text;
  var subs = [
    // possessive / object pronouns (whole-word boundaries)
    [/\btu (nombre|tel[eé]fono|correo|email|plan|doctor|m[eé]dico|medicina|medicamento|farmacia|carta|factura|cobro|prima|copago|deducible|cobertura|edad|ingreso|caso|situaci[oó]n|familia|esposo|esposa|hijo|hija)\b/gi,
      function (_m, n) { return 'su ' + n; }],
    [/\btus (nombres|tel[eé]fonos|correos|emails|planes|doctores|medicinas|medicamentos|cartas|facturas|cobros|primas|copagos|cobertura)\b/gi,
      function (_m, n) { return 'sus ' + n; }],
    [/\bcontigo\b/g, 'con usted'],
    [/\bti\s+(mismo|misma)\b/gi, function (_m, n) { return 'usted ' + n; }],
    // common verb forms — TÚ → USTED
    [/\btienes\b/g, 'tiene'],
    [/\bpuedes\b/g, 'puede'],
    [/\bquieres\b/g, 'quiere'],
    [/\bnecesitas\b/g, 'necesita'],
    [/\bestas\b/g, 'está'],
    [/\bsabes\b/g, 'sabe'],
    [/\bcalificas\b/g, 'califica'],
    [/\bdebes\b/g, 'debe'],
    [/\bvas\b/g, 'va'],
    [/\bhaces\b/g, 'hace'],
    [/\beres\b/g, 'es'],
    [/\bvives\b/g, 'vive'],
    [/\brecibes\b/g, 'recibe'],
    [/\btomas\b/g, 'toma'],
    [/\bsigues\b/g, 'sigue'],
    [/\bpiensas\b/g, 'piensa'],
    [/\bcomprendes\b/g, 'comprende'],
    [/\bentiendes\b/g, 'entiende'],
    [/\bpodr[ií]as\b/g, 'podría'],
    [/\bdeber[ií]as\b/g, 'debería'],
    [/\btendr[ií]as\b/g, 'tendría'],
    [/\bquerr[ií]as\b/g, 'querría'],
    [/\bllamar?te\b/g, 'llamarle'],
    [/\bayudar?te\b/g, 'ayudarle'],
    [/\bconectar?te\b/g, 'conectarle'],
    [/\bdar?te\b/g, 'darle'],
    [/\bdecir?te\b/g, 'decirle'],
    [/\borient[aá]r?te\b/g, 'orientarle'],
    [/\bcontactar?te\b/g, 'contactarle'],
    [/\bte (gustar[ií]a|llamar[eé]?|llamamos|enviar[eé]?|enviaremos|veo|oigo|escucho|recordar[eé]?|pediremos|orientamos|conectamos|ayudamos|debe|debemos|atendemos|recibe|dar[eé]?|daremos|atenderemos|invitamos|deseamos)\b/g,
      function (_m, verb) { return 'le ' + verb; }],
    // imperative reflexive "espérate" → "espérese" common cases
    [/\besp[eé]rate\b/g, 'espérese'],
    [/\bcu[eé]ntame\b/g, 'cuénteme'],
    [/\bd[ií]me(lo)?\b/g, function (_m, lo) { return lo ? 'dígamelo' : 'dígame'; }],
    [/\bperd[oó]name\b/g, 'perdóneme'],
    [/\bdiscúlpame\b/g, 'discúlpeme'],
    // "para ti" → "para usted"
    [/\bpara ti\b/g, 'para usted'],
  ];
  for (var i = 0; i < subs.length; i++) {
    out = out.replace(subs[i][0], subs[i][1]);
  }
  return out;
}

// ============================================================================
// CUSTOMER SERVICE ENGINE V15 — PROFESSIONAL ENTERPRISE
// NO language mixing. NO auto-detect. YES name + ZIP validation.
// State machine: language → name → ZIP → problem → conversation.
// ============================================================================

export type Language = 'en' | 'es' | null;

export type ConversationStep =
  | 'asking_language'
  | 'asking_name'
  | 'asking_zip'
  | 'asking_problem'
  | 'conversation';

export interface ConversationState {
  conversationId: string;
  step: ConversationStep;
  language: Language;
  name?: string;
  zipCode?: string;
  state?: string; // NY, NJ, FL, CT, or unknown
  isValidState: boolean;
  messages: { role: 'user' | 'bot'; content: string; timestamp: number }[];
  currentProblem: string;
  intent: string;
  emotionalState: string;
  turnCount: number;
  needsHuman: boolean;
  // ─── Wave 17: context memory across turns ───
  /** Source of the bill once the user names it. Set once, used forever. */
  billSource?: 'provider' | 'pharmacy' | 'plan' | 'unknown';
  /** True if user mentioned having BOTH Medicaid + Medicare (dual eligible). */
  dualEligible?: boolean;
  /** Most recent dollar amount the user mentioned. */
  amountMentioned?: string;
}

// ── ZIP prefix → state. NY/NJ/FL/CT only (ClearPoint service area). ──
const VALID_ZIP_PATTERNS: Record<string, string[]> = {
  NY: ['100','101','102','103','104','105','106','107','108','109','110','111','112','113','114','115','116','117','118','119','120','121','122','123','124','125','126','127','128','129','130','131','132','133','134','135','136','137','138','139','140','141','142','143','144','145','146','147','148','149'],
  NJ: ['070','071','072','073','074','075','076','077','078','079','080','081','082','083','084','085','086','087','088','089'],
  FL: ['320','321','322','323','324','325','326','327','328','329','330','331','332','333','334','335','336','337','338','339','340','341','342','343','344','346','347','349'],
  CT: ['060','061','062','063','064','065','066','067','068','069'],
};

function getStateFromZip(zip: string): string | null {
  const prefix = zip.substring(0, 3);
  for (const [state, prefixes] of Object.entries(VALID_ZIP_PATTERNS)) {
    if (prefixes.includes(prefix)) return state;
  }
  return null;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
    return (crypto as any).randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createInitialState(): ConversationState {
  return {
    conversationId: makeId(),
    step: 'asking_language',
    language: null,
    messages: [],
    currentProblem: '',
    intent: '',
    emotionalState: 'calm',
    turnCount: 0,
    needsHuman: false,
    isValidState: false,
  };
}

// Auto-correction of common misspellings + Spanglish normalization.
function normalizeText(text: string): string {
  const corrections: Record<string, string> = {
    mellgaron: 'me llegaron',
    mellegaron: 'me llegaron',
    billes: 'bills',
    bils: 'bills',
    recivos: 'recibos',
    resivos: 'recibos',
    facturua: 'factura',
    medicamentoos: 'medicamentos',
    cobertrua: 'cobertura',
    doctro: 'doctor',
    farmacai: 'farmacia',
    cartta: 'carta',
    renovcaion: 'renovación',
    medicadi: 'medicaid',
    medicarie: 'medicare',
    medecare: 'medicare',
    medisina: 'medicina',
  };
  let normalized = text.toLowerCase();
  for (const [wrong, correct] of Object.entries(corrections)) {
    normalized = normalized.replace(new RegExp(wrong, 'gi'), correct);
  }
  return normalized;
}

function detectProblemType(text: string): string {
  const normalized = normalizeText(text);
  // Order matters — most specific / highest priority first. Appeals/grievances
  // and enrollment changes win over generic drug/letter mentions.
  if (/\b(apelaci[oó]n|apelar|appeal|appeals|reconsideration|fair hearing|grievance|queja|denied|negado|rejected)\b/i.test(normalized)) return 'appeal';
  if (/\b(inscripci[oó]n|enrollment|disenroll|disenrollment|sep|aep|iep)\b/i.test(normalized)) return 'enrollment';
  // "change/switch [my|the|another|my own] plan(s)" — allow up to 2 words between
  if (/\b(change|switch|cambiar|cambiarme)\b(?:\s+\w+){0,2}\s+\b(plan|plans|planes)\b/i.test(normalized)) return 'enrollment';
  if (/\b(bill|bills|factura|facturas|cobro|cobros|premium|prima|copay|copago|deductible|eob)\b/i.test(normalized)) return 'bill';
  if (/\b(carta|cartas|letter|notice|aviso|anoc|eoc|renovaci[oó]n|renewal|medicaid notice|extra help notice|irmaa)\b/i.test(normalized)) return 'letter';
  if (/\b(medication|medications|medicamento|medicamentos|medicina|medicinas|pastilla|pastillas|drug|drugs|pharmacy|farmacia|prescription|receta)\b/i.test(normalized)) return 'drug';
  if (/\b(doctor|doctora|provider|hospital|cl[ií]nica|cobertura|coverage|red|network|specialist|especialista)\b/i.test(normalized)) return 'coverage';
  if (/\b(gracias|thank|thanks|hola|hello|hi|hey)\b/i.test(normalized) && normalized.length < 30) return 'casual';
  return 'general';
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVE 17 — CONTEXT MEMORY HELPERS
//
// Scan the FULL user-message history so the bot never re-asks for something
// the caller already said. Each helper looks at every prior user turn (plus
// the current message) and returns what's been established so far.
// ─────────────────────────────────────────────────────────────────────────────

function fullUserHistory(state: ConversationState, currentMessage: string): string {
  const past = state.messages.filter((m) => m.role === 'user').map((m) => m.content).join(' ');
  return normalizeText(past + ' ' + currentMessage);
}

function detectBillSource(history: string): 'provider' | 'pharmacy' | 'plan' | null {
  // Pharmacy wins over generic plan if both appear, because the call usually
  // started with the bill discussion.
  if (/\b(farmacia|pharmacy|drug ?store|cvs|walgreens|walmart pharmacy|de la farmacia|from (the )?pharmacy)\b/i.test(history)) return 'pharmacy';
  if (/\b(doctor|doctora|m[eé]dico|hospital|cl[ií]nica|provider|specialist|especialista|del m[eé]dico|del hospital|from (the )?doctor|from (the )?hospital)\b/i.test(history)) return 'provider';
  if (/\b(plan de medicare|medicare plan|advantage plan|del plan|from (the )?plan|monthly premium|prima mensual)\b/i.test(history)) return 'plan';
  return null;
}

function detectDualEligible(history: string): boolean {
  return /\b(medicaid (y|and) medicare|medicare (y|and) medicaid|dual[- ]?eligible|doble elegibilidad|tengo medicaid y medicare|tengo medicare y medicaid|both medicare and medicaid)\b/i.test(history);
}

function detectAmount(history: string): string | null {
  // Match "$18", "18 dolares", "18 dollars", "18 de copago", "$18.50", etc.
  const m = history.match(/\$?\s*(\d{1,4}(?:\.\d{2})?)\s*(d[oó]lares?|dollars?|de copay|de copago|copay|copago)/i);
  if (m) return m[1];
  const m2 = history.match(/\$\s*(\d{1,4}(?:\.\d{2})?)/);
  if (m2) return m2[1];
  return null;
}

function detectEmotion(text: string): string {
  const normalized = normalizeText(text);
  if (/\b(frustrated|frustraci[oó]n|enoja|enojado|angry|no entienden|mal servicio|furioso)\b/i.test(normalized)) return 'frustrated';
  if (/\b(confused|confusi[oó]n|no entiendo|qu[eé] significa)\b/i.test(normalized)) return 'confused';
  if (/\b(urgent|emergency|emergencia|ya mismo|asap)\b/i.test(normalized)) return 'urgent';
  if (/muri[oó]|falleci[oó]|passed away|death|died/i.test(normalized)) return 'grieving';
  if (/\b(gracias|thank|appreciate|agradezco)\b/i.test(normalized)) return 'grateful';
  return 'calm';
}

export function processMessage(
  userMessage: string,
  state: ConversationState,
): { response: string; newState: ConversationState; needsHuman: boolean } {
  const newState = { ...state, messages: [...state.messages] };
  newState.messages.push({ role: 'user', content: userMessage, timestamp: Date.now() });
  newState.turnCount++;

  const isSpanish = newState.language === 'es';

  // ───── STEP 1: ASKING LANGUAGE ─────
  if (newState.step === 'asking_language') {
    const msg = userMessage.toLowerCase();
    if (msg.includes('english') || msg === 'en') {
      newState.language = 'en';
      newState.step = 'asking_name';
      const out = "Great. What's your first name? (Just first name please)";
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (msg.includes('español') || msg.includes('espanol') || msg === 'es') {
      newState.language = 'es';
      newState.step = 'asking_name';
      const out = 'Perfecto. ¿Cuál es su nombre? (Solo nombre por favor)';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    const out = 'Please select English or Español. Por favor seleccione English o Español.';
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // ───── STEP 2: ASKING NAME ─────
  if (newState.step === 'asking_name') {
    // Strip conversational prefixes in any order; loop a few times to catch
    // chains like "Hi, my name is Carlos" → "Carlos".
    let cleaned = userMessage.trim();
    const prefixes: RegExp[] = [
      /^(hi|hello|hey|hola|buenos|buenas)[\s,.!]+/i,
      /^(my name is|name is|name's|im called|i am called)\s+/i,
      /^(i'?m|i am|im)\s+/i,
      /^(me llamo|mi nombre es|nombre|soy|me dicen)\s*[:\s]*/i,
    ];
    let safety = 0;
    let changed = true;
    while (changed && safety < 5) {
      changed = false;
      for (const re of prefixes) {
        const next = cleaned.replace(re, '').trim();
        if (next !== cleaned) {
          cleaned = next;
          changed = true;
        }
      }
      safety++;
    }
    const name = cleaned.split(/\s+/)[0]?.replace(/[.,;:!?]+$/, '') || '';
    if (name.length < 2) {
      const out = isSpanish ? 'Por favor, dígame su nombre.' : 'Please tell me your name.';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    newState.name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    newState.step = 'asking_zip';
    const out = isSpanish
      ? `Gracias ${newState.name}. ¿Cuál es su código postal? (Solo trabajamos en NY, NJ, FL, CT)`
      : `Thanks ${newState.name}. What's your ZIP code? (We only serve NY, NJ, FL, CT)`;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // ───── STEP 3: ASKING ZIP ─────
  if (newState.step === 'asking_zip') {
    const zip = userMessage.trim().replace(/\D/g, '');
    if (zip.length !== 5) {
      const out = isSpanish
        ? 'Por favor, ingrese un código postal de 5 dígitos.'
        : 'Please enter a 5-digit ZIP code.';
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    const detectedState = getStateFromZip(zip);
    if (!detectedState) {
      newState.zipCode = zip;
      newState.isValidState = false;
      newState.step = 'asking_problem';
      const out = isSpanish
        ? `Gracias. Actualmente solo servimos NY, NJ, FL y CT. Aun así puedo orientarle con preguntas generales de Medicare. Cuénteme qué está pasando.`
        : `Thank you. We currently only serve NY, NJ, FL, and CT. I can still help you with general Medicare guidance. Tell me what's going on.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    newState.zipCode = zip;
    newState.state = detectedState;
    newState.isValidState = true;
    newState.step = 'asking_problem';
    const out = isSpanish
      ? `Gracias ${newState.name}. Cuénteme qué está pasando con Medicare. Descríbalo con sus propias palabras.`
      : `Thanks ${newState.name}. Tell me what's going on with Medicare. Describe it in your own words.`;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // ───── STEP 4+: PROBLEM / FREE CONVERSATION ─────
  if (newState.step === 'asking_problem' || newState.step === 'conversation') {
    newState.step = 'conversation';
    const problemType = detectProblemType(userMessage);
    const emotion = detectEmotion(userMessage);
    newState.currentProblem = userMessage;
    newState.intent = problemType;
    newState.emotionalState = emotion;

    // ── WAVE 17 CONTEXT SCAN ──
    // Scan the entire user history (plus this message) so we never re-ask
    // for something the caller already told us.
    const history = fullUserHistory(newState, userMessage);
    const newSource = detectBillSource(history);
    if (newSource && !newState.billSource) newState.billSource = newSource;
    if (detectDualEligible(history)) newState.dualEligible = true;
    const amt = detectAmount(history);
    if (amt) newState.amountMentioned = amt;

    // ── Emotional priority responses ──
    if (emotion === 'grieving') {
      const out = isSpanish
        ? `Lo siento mucho por su pérdida, ${newState.name}. Para temas de Medicare después de un fallecimiento, lo mejor es llamar al Social Security: 1-800-772-1213. ¿Necesita ayuda con algo específico?`
        : `I'm very sorry for your loss, ${newState.name}. For Medicare matters after a death, please call Social Security: 1-800-772-1213. Do you need help with something specific?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (emotion === 'frustrated') {
      const out = isSpanish
        ? `Entiendo su frustración, ${newState.name}. Déjeme ayudarle. ¿Puede contarme exactamente qué está pasando?`
        : `I understand your frustration, ${newState.name}. Let me help you. Can you tell me exactly what's happening?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (emotion === 'urgent') {
      const out = isSpanish
        ? `Si es una emergencia médica, llame al 911 ahora. Si es urgente pero no médica, dígame qué pasa y lo organizo para un asesor licenciado.`
        : `If this is a medical emergency, please call 911 now. If it's urgent but not medical, tell me what's happening and I'll organize it for a licensed advisor.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // ──────────────────────────────────────────────────────────────────────
    // WAVE 17: BILL / DRUG with CONTEXT MEMORY
    //
    // The exact Antonio failure was that the bot kept asking "is this from
    // the doctor, pharmacy, or plan?" after Antonio had already said
    // "DE LA FARMACIA" 2 turns earlier, then said he had dual eligibility,
    // then said he paid $18. Now the bot honors billSource + dualEligible +
    // amountMentioned and gives a contextually correct response.
    // ──────────────────────────────────────────────────────────────────────
    // Drug-specific first turn: if user said "my medication is expensive"
    // and never named a source, ask the drug-specific question.
    if (problemType === 'drug' && !newState.billSource && !newState.amountMentioned) {
      const out = isSpanish
        ? `Sobre medicamentos, ${newState.name}. ¿El problema es el costo, que no está cubierto, o necesita autorización previa? Un asesor licenciado debe verificar el formulario y la farmacia antes de cualquier decisión.`
        : `About medications, ${newState.name}. Is the issue the cost, not covered, or prior authorization? A licensed advisor must verify the formulary and pharmacy before any decision.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'bill' || problemType === 'drug') {
      const src = newState.billSource;
      const amount = newState.amountMentioned;
      const dual = newState.dualEligible;

      // Pharmacy source + dual eligible + amount known → fullest context response
      if (src === 'pharmacy' && dual && amount) {
        const out = isSpanish
          ? `Anotado, ${newState.name}. Tiene Medicare y Medicaid (doble elegibilidad) y pagó $${amount} en la farmacia. Para personas con Medicare + Medicaid los copagos de medicamentos suelen ser mucho más bajos. No puedo confirmar la cantidad exacta aquí, pero un asesor licenciado puede revisar el formulario, la farmacia y si Extra Help / LIS se está aplicando. ¿Quiere que un asesor revise esto?`
          : `Got it, ${newState.name}. You have both Medicare and Medicaid (dual eligible) and paid $${amount} at the pharmacy. For people with Medicare + Medicaid the drug copays are usually much lower. I can't confirm the exact amount here, but a licensed advisor can review the formulary, the pharmacy, and whether Extra Help / LIS is being applied. Would you like an advisor to review this?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Pharmacy source + dual eligible (no amount yet)
      if (src === 'pharmacy' && dual) {
        const out = isSpanish
          ? `Gracias, ${newState.name}. Tiene Medicare y Medicaid (doble elegibilidad). Eso es importante — los copagos de medicamentos suelen ser muy bajos. ¿Cuánto pagó esta vez en la farmacia?`
          : `Thanks, ${newState.name}. You have both Medicare and Medicaid (dual eligible). That matters — drug copays are usually very low. How much did you pay at the pharmacy this time?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Pharmacy source known (no dual signal)
      if (src === 'pharmacy') {
        const out = isSpanish
          ? `Anotado, ${newState.name}. Es un cobro de la farmacia. ¿El problema es que es muy caro, que no esperaba ese costo, o que no le cubrieron el medicamento?`
          : `Got it, ${newState.name}. Pharmacy charge. Is the issue that it's too expensive, that you didn't expect that cost, or that the medication wasn't covered?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Provider source known
      if (src === 'provider') {
        const out = isSpanish
          ? `Anotado, ${newState.name}. Es una factura del doctor u hospital. ¿La cantidad parece correcta, o cree que hay un error en el cobro?`
          : `Got it, ${newState.name}. It's a doctor or hospital bill. Does the amount look right, or do you think there's an error?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // Plan source known
      if (src === 'plan') {
        const out = isSpanish
          ? `Anotado, ${newState.name}. Es del plan de Medicare. ¿Es una prima mensual, un copago, o un cobro inesperado?`
          : `Got it, ${newState.name}. It's from your Medicare plan. Is it a monthly premium, a copay, or an unexpected charge?`;
        newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
        return { response: out, newState, needsHuman: false };
      }

      // No source captured yet — ask the source question ONCE
      const out = isSpanish
        ? `Entiendo, ${newState.name}. ¿Esta factura es del médico u hospital, de la farmacia, o del plan de Medicare? Por favor no envíe Medicare ID, Seguro Social, ni datos bancarios aquí.`
        : `Got it, ${newState.name}. Is this bill from a doctor or hospital, a pharmacy, or your Medicare plan? Please do not send Medicare ID, Social Security, or banking info here.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    if (problemType === 'letter') {
      const out = isSpanish
        ? `Recibió una carta. ¿Es sobre renovación/cambios anuales (ANOC/EOC), Medicaid, Extra Help, IRMAA, o un aviso de cobro? No envíe Medicare ID, Seguro Social, ni una foto completa con datos sensibles.`
        : `You received a letter. Is it about renewal/annual changes (ANOC/EOC), Medicaid, Extra Help, IRMAA, or a collection notice? Please do not send Medicare ID, Social Security, or a full photo with sensitive details.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'coverage') {
      const out = isSpanish
        ? `Sobre cobertura. ¿Quiere saber si un doctor, hospital o procedimiento está cubierto? No puedo confirmarlo aquí — un asesor licenciado debe verificarlo con el plan, su condado y la red actual.`
        : `About coverage. Do you want to know if a doctor, hospital, or procedure is covered? I cannot confirm it here — a licensed advisor must verify with the plan, your county, and the current network.`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'enrollment') {
      const out = isSpanish
        ? `Sobre inscripción. ¿Está cumpliendo 65 (IEP), quiere cambiar durante AEP (15 oct - 7 dic), o tiene un evento especial como mudanza (SEP)?`
        : `About enrollment. Are you turning 65 (IEP), wanting to switch during AEP (Oct 15 - Dec 7), or do you have a special event like moving (SEP)?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'appeal') {
      const out = isSpanish
        ? `Sobre apelaciones. Tiene 60 días desde la denegación para apelar. ¿Quiere que un asesor licenciado le ayude a organizar la apelación?`
        : `About appeals. You have 60 days from the denial to appeal. Would you like a licensed advisor to help organize the appeal?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (problemType === 'casual') {
      const out = isSpanish
        ? `Hola ${newState.name}. ¿En qué puedo ayudarle con Medicare hoy?`
        : `Hi ${newState.name}. How can I help you with Medicare today?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // ── WAVE 17: "general" intent that mentions dual eligibility ──
    // If the user just told us they have Medicaid + Medicare, recognize it
    // and respond with that context instead of "give me more detail".
    if (newState.dualEligible && newState.billSource) {
      const out = isSpanish
        ? `Gracias, ${newState.name}. Anoto que tiene Medicare y Medicaid, y que esto se refiere a ${newState.billSource === 'pharmacy' ? 'una factura de la farmacia' : newState.billSource === 'provider' ? 'una factura del médico u hospital' : 'el plan de Medicare'}. Eso ayuda mucho. ¿Cuál es el monto que ve, o qué le preocupa más sobre el cobro?`
        : `Thanks, ${newState.name}. I'm noting that you have Medicare and Medicaid, and that this is about ${newState.billSource === 'pharmacy' ? 'a pharmacy bill' : newState.billSource === 'provider' ? 'a doctor or hospital bill' : 'your Medicare plan'}. That helps a lot. What's the amount you're seeing, or what concerns you most about the charge?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }
    if (newState.dualEligible) {
      const out = isSpanish
        ? `Anotado, ${newState.name} — tiene Medicare y Medicaid (doble elegibilidad). Eso es importante porque sus costos de medicamentos y servicios suelen ser muy bajos. ¿Sobre qué situación quiere que le ayude?`
        : `Got it, ${newState.name} — you have both Medicare and Medicaid (dual eligible). That matters because your drug and service costs are usually very low. What situation can I help you organize?`;
      newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
      return { response: out, newState, needsHuman: false };
    }

    // Default
    const out = isSpanish
      ? `Gracias por contarme, ${newState.name}. ¿Puede darme un poco más de detalle sobre su situación?`
      : `Thanks for telling me, ${newState.name}. Can you give me a bit more detail about your situation?`;
    newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
    return { response: out, newState, needsHuman: false };
  }

  // Fallback (should not reach)
  const out = isSpanish ? '¿En qué más puedo ayudarle?' : 'How else can I help you?';
  newState.messages.push({ role: 'bot', content: out, timestamp: Date.now() });
  return { response: out, newState, needsHuman: false };
}

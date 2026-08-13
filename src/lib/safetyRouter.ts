// ─────────────────────────────────────────────────────────────────────────────
// PHASE 9A — Unified Safety Router (988 mental health crisis + 911 medical)
//
// Both Zara and Clara MUST run this BEFORE any other intent classification.
// Federal liability table-stakes for senior-care platforms. If the user
// indicates self-harm, suicide, or medical emergency, the bot responds with
// the appropriate hotline IMMEDIATELY — no LLM, no scripted education, no
// privacy reminder.
//
// 988 Suicide & Crisis Lifeline (federal, 24/7, English + Spanish)
// 911 — emergencies and life-threatening medical situations
// ─────────────────────────────────────────────────────────────────────────────

// CP-03 (2026-08-13) — 'clinical_concern' added as a THIRD, lower tier.
//
// The external audit found that "I take warfarin and I've been really dizzy for two
// days" was not escalated at all. It matched nothing: the 911 lists here require
// severity qualifiers ("severe chest pain", "bleeding heavily") and the server-side
// EMERGENCY_USER_RES net has no dizziness pattern either. So the message fell through
// to ordinary Medicare education while the person described a symptom that, on an
// anticoagulant, can mean internal bleeding, over-anticoagulation, or anemia. This
// business serves an elderly population; that is the wrong thing to be silent about.
//
// WHY A NEW TIER INSTEAD OF WIDENING THE 911 LIST — this is the whole design decision.
// Adding "dizzy" to the emergency patterns would route every senior who says they felt
// a bit lightheaded to 911. Dizziness is extremely common and usually benign, so that
// guard would misfire constantly, and a guard that cries wolf is one people learn to
// ignore — including in the case where it is right. The clinically meaningful signal is
// the CONJUNCTION: a high-risk medication AND a symptom. This tier fires only on that
// pair, and it does not claim an emergency, because Clear Point is not qualified to
// judge severity. It declines to advise, names the right professional, and mentions 911
// only as the user's own call if things are severe or worsening.
export type SafetyAction = 'none' | 'crisis_988' | 'emergency_911' | 'clinical_concern';

interface SafetyResult {
  action: SafetyAction;
  responseEn: string;
  responseEs: string;
}

const NO_HIT: SafetyResult = {
  action: 'none',
  responseEn: '',
  responseEs: '',
};

// ── 988 crisis phrases ──────────────────────────────────────────────────────
const CRISIS_EN = [
  'kill myself', 'killing myself', 'suicide', 'suicidal', 'end my life', 'end it all',
  'want to die', 'wish i was dead', 'wish i were dead', 'no reason to live',
  'self harm', 'self-harm', 'hurt myself', 'harm myself', 'harming myself', 'cut myself', 'cutting myself', 'overdose on purpose',
  'give up on life', 'no longer want to live', "can't go on", 'cant go on',
];
const CRISIS_ES = [
  'suicid', 'matarme', 'me quiero matar', 'me quiero morir', 'quiero morir',
  'no quiero vivir', 'no quiero vivir mas', 'no quiero vivir más',
  'mejor muerto', 'mejor muerta', 'acabar con mi vida', 'terminar con mi vida',
  'hacerme daño', 'hacerme dano', 'lastimarme',
];

// ── 911 medical emergency phrases ───────────────────────────────────────────
// Only phrases that indicate an ACUTE life-threat. Don't catch every "hospital"
// mention — "I was at the hospital last week" must NOT trigger 911.
const EMERGENCY_EN = [
  'call 911', 'need 911', 'heart attack', 'having a heart attack',
  'stroke right now', 'chest pain right now', 'severe chest pain',
  "can't breathe", 'cant breathe', 'difficulty breathing',
  'bleeding heavily', 'unconscious', 'passed out', 'collapsed',
  'ambulance now', 'emergency right now', 'dying',
];
const EMERGENCY_ES = [
  'llame al 911', 'llamar al 911', 'necesito 911', 'necesito una ambulancia',
  'infarto', 'me da un infarto', 'ataque al corazon', 'ataque al corazón',
  'derrame cerebral', 'dolor de pecho fuerte', 'me duele el pecho fuerte',
  'no puedo respirar', 'no respira', 'sangrando mucho', 'inconsciente',
  'se desmayó', 'se desmayo', 'me estoy muriendo',
];

// ── CP-03 clinical-concern vocabulary ───────────────────────────────────────
// High-risk medications where a new symptom warrants prompt clinical contact:
// narrow therapeutic index, or a bleeding/hypoglycaemia risk that makes ordinary
// symptoms meaningful. Deliberately NOT a list of all drugs — a broad list would
// escalate every mention of a blood-pressure pill.
const HIGH_RISK_MEDS = [
  'warfarin', 'warfarina', 'coumadin', 'jantoven',
  'blood thinner', 'bloodthinner', 'blood thinners', 'anticoagulant', 'anticoagulante',
  'eliquis', 'apixaban', 'xarelto', 'rivaroxaban', 'pradaxa', 'dabigatran', 'savaysa',
  'plavix', 'clopidogrel',
  'insulin', 'insulina',
  'digoxin', 'digoxina', 'lanoxin',
  'lithium', 'litio',
  'methotrexate', 'metotrexato',
  'amiodarone', 'amiodarona',
  'prednisone', 'prednisona',
];
// Symptoms that are NOT already caught as an acute emergency above, but that matter on
// the medications listed. "Bleeding", "chest pain", "can't breathe", "passed out" are
// deliberately absent — they are already 911, and the emergency tier runs first.
const CONCERN_SYMPTOMS_EN = [
  'dizzy', 'dizziness', 'lightheaded', 'light-headed', 'light headed',
  'weak', 'weakness', 'fatigued', 'unusually tired', 'exhausted',
  'bruise', 'bruises', 'bruising', 'nosebleed', 'nose bleed', 'nose bleeds',
  'confused', 'confusion', 'disoriented',
  'vomiting', 'throwing up', 'nauseous', 'nausea',
  'black stool', 'tarry stool', 'dark urine', 'blurry vision', 'blurred vision',
  // Overt blood signs — these matched NEITHER net before (the 911 lists need
  // "bleeding heavily"), so "blood in my stool" on warfarin fell through entirely.
  'blood in my stool', 'blood in the stool', 'blood in my urine', 'blood in my vomit',
  'bloody stool', 'bloody urine', 'coughing up blood', 'spitting blood',
  'heart racing', 'palpitations', 'irregular heartbeat', 'swollen', 'swelling',
  'fell', 'fell down', 'falling', 'unsteady', 'off balance',
];
const CONCERN_SYMPTOMS_ES = [
  'mareado', 'mareada', 'mareo', 'mareos', 'aturdido', 'aturdida',
  'debil', 'débil', 'debilidad', 'cansancio', 'muy cansado', 'muy cansada', 'agotado', 'agotada',
  'moreton', 'moretón', 'moretones', 'hematoma', 'sangrado de nariz', 'sangra la nariz',
  'confundido', 'confundida', 'confusion', 'confusión', 'desorientado', 'desorientada',
  'vomito', 'vómito', 'vomitando', 'nausea', 'náusea', 'nauseas', 'náuseas',
  'heces negras', 'orina oscura', 'vision borrosa', 'visión borrosa',
  'sangre en las heces', 'sangre en la orina', 'sangre en el vomito', 'sangre en el vómito',
  'tosiendo sangre', 'escupiendo sangre',
  'palpitaciones', 'corazon acelerado', 'corazón acelerado', 'hinchado', 'hinchada', 'hinchazon', 'hinchazón',
  'me cai', 'me caí', 'caidas', 'caídas', 'desequilibrio',
];
// VETO — a cost, coverage or logistics question that merely NAMES a medication is not a
// symptom report, and treating it as one would be a serious over-escalation: helping
// with drug costs is the core service, and answering "your copay went up" with a
// clinical referral would be both useless and alarming. The audit's own negative
// control. Note "swelling"/"weak" style words do not appear in cost questions, but the
// medication name always does, which is exactly why the veto is required.
const CONCERN_VETO = [
  'copay', 'co-pay', 'copayment', 'copago', 'cost', 'costs', 'costo', 'cuesta', 'precio', 'price',
  'coverage', 'covered', 'cobertura', 'cubierto', 'cubre',
  'formulary', 'formulario', 'tier', 'nivel',
  'refill', 'resurtir', 'receta', 'prescription cost', 'pharmacy', 'farmacia',
  'prior authorization', 'autorizacion previa', 'autorización previa',
  'deductible', 'deducible', 'premium', 'prima',
  'donut hole', 'coverage gap', 'etapa de cobertura',
  'went up', 'subio', 'subió', 'expensive', 'caro', 'afford', 'pagar',
  'extra help', 'ayuda extra', 'switch plans', 'cambiar de plan',
];

function lowercased(s: string): string {
  return (s || '').toString().toLowerCase().normalize('NFKD');
}

function anyMatch(text: string, list: string[]): boolean {
  for (const k of list) if (text.includes(k)) return true;
  return false;
}

/** Detects mental-health crisis OR acute medical emergency in any language. */
export function detectSafetyTrigger(userMessage: string): SafetyResult {
  if (!userMessage || typeof userMessage !== 'string') return NO_HIT;
  const t = lowercased(userMessage);
  if (t.length < 2) return NO_HIT;

  // Crisis (988) — highest priority
  if (anyMatch(t, CRISIS_EN) || anyMatch(t, CRISIS_ES)) {
    return {
      action: 'crisis_988',
      responseEn:
        "I'm worried about you right now. Please call 988 — the Suicide & Crisis Lifeline. " +
        "It's free, confidential, available 24/7, and has Spanish-speaking counselors. " +
        "You can call or text 988. If you are in immediate danger, please call 911. " +
        "I'm a Medicare assistant and not equipped for this — please reach out to people who can really help.",
      responseEs:
        'Estoy preocupado por usted en este momento. Por favor llame al 988 — la Línea de Prevención del Suicidio y Crisis. ' +
        'Es gratis, confidencial, disponible 24/7, y tiene consejeros que hablan español. ' +
        'Puede llamar o enviar texto al 988. Si está en peligro inmediato, por favor llame al 911. ' +
        'Soy un asistente de Medicare y no estoy preparado para esto — por favor comuníquese con personas que sí pueden ayudarle de verdad.',
    };
  }

  // 911 medical emergency
  if (anyMatch(t, EMERGENCY_EN) || anyMatch(t, EMERGENCY_ES)) {
    return {
      action: 'emergency_911',
      responseEn:
        "Please call 911 right now. This sounds like a medical emergency and I cannot help with that — I am a Medicare information assistant. " +
        "If you are alone, also ask someone nearby to help call 911. Call us back when you are safe — 1-855-720-8555.",
      responseEs:
        'Por favor llame al 911 ahora mismo. Esto suena como una emergencia médica y no puedo ayudarle con eso — soy un asistente de información de Medicare. ' +
        'Si está solo, también pídale a alguien cercano que llame al 911. Llámenos cuando esté seguro — 1-855-720-8555.',
    };
  }

  // CP-03 — clinical concern: a high-risk medication AND a new symptom, and NOT a
  // cost/coverage question. Runs last of the three tiers, so anything genuinely acute
  // has already been routed to 988 or 911 above and cannot be downgraded to this.
  if (!anyMatch(t, CONCERN_VETO)
    && anyMatch(t, HIGH_RISK_MEDS)
    && (anyMatch(t, CONCERN_SYMPTOMS_EN) || anyMatch(t, CONCERN_SYMPTOMS_ES))) {
    return {
      action: 'clinical_concern',
      // Deliberately does NOT diagnose, does not name a cause, and does not assert this
      // is or is not an emergency — none of which Clear Point is qualified to say. It
      // does three things: refuse to advise, name the professional who can, and leave
      // the 911 decision with the person while making clear it is available. The
      // pharmacist is named on purpose: for a medication-plus-symptom question they are
      // reachable same-day without an appointment, which matters when the alternative
      // is a senior waiting a week to ask.
      responseEn:
        "I'm not able to give any medical guidance, and I don't want to guess about a symptom while you're on that medication — please contact your prescriber or your pharmacist today and tell them exactly what you told me. " +
        "A pharmacist can usually speak with you the same day without an appointment. If the symptom is severe, or it gets worse, call 911 or go to an emergency room. " +
        "I'm here for the Medicare side whenever you want to come back to it — and a licensed advisor is at 1-855-720-8555.",
      responseEs:
        'No puedo darle ninguna indicación médica, y no quiero adivinar sobre un síntoma mientras usted toma ese medicamento — por favor comuníquese hoy con su médico o su farmacéutico y dígale exactamente lo que me dijo. ' +
        'Un farmacéutico normalmente puede atenderle el mismo día sin cita. Si el síntoma es fuerte, o empeora, llame al 911 o vaya a una sala de emergencias. ' +
        'Yo sigo aquí para lo de Medicare cuando quiera retomarlo — y un asesor licenciado está al 1-855-720-8555.',
    };
  }

  return NO_HIT;
}

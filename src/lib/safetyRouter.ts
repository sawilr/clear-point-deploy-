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

export type SafetyAction = 'none' | 'crisis_988' | 'emergency_911';

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
        "If you are alone, also ask someone nearby to help call 911. Call us back when you are safe — 1-866-310-8702.",
      responseEs:
        'Por favor llame al 911 ahora mismo. Esto suena como una emergencia médica y no puedo ayudarle con eso — soy un asistente de información de Medicare. ' +
        'Si está solo, también pídale a alguien cercano que llame al 911. Llámenos cuando esté seguro — 1-866-310-8702.',
    };
  }

  return NO_HIT;
}

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
  'want to die', 'wanna die', 'wish i was dead', 'wish i were dead', 'no reason to live', 'no reason left to live',
  'self harm', 'self-harm', 'hurt myself', 'harm myself', 'harming myself', 'cut myself', 'cutting myself', 'overdose on purpose',
  'give up on life', 'no longer want to live', "can't go on", 'cant go on',
  // AUDIT 2026-08-27 (mega-corpus) — passive ideation & plan/means the audit found
  // slipping through. Tied to living/dying/being-here so ordinary Medicare
  // frustration ("no point paying for this plan") is not swept in. A false 988 is
  // recoverable (bounded release + "it's not an emergency" exit); a miss is not.
  'want to end it', 'thinking about ending it', 'thinking of ending it', 'ready to end it',
  'end it tonight', "don't want to live", 'dont want to live', "don't want to be here",
  'dont want to be here', "don't see the point anymore", 'dont see the point anymore',
  'no point in living', 'no point of living', 'see the point in living', 'point in going on',
  'no reason to go on', 'no reason to keep going', 'tired of living', 'better off dead',
  'better off without me', 'be better off without me', 'everyone be better off',
  'why am i still here', 'thought about ending', 'take all my pills', 'take them all tonight',
];
const CRISIS_ES = [
  'suicid', 'matarme', 'me quiero matar', 'me quiero morir', 'quiero morir',
  'no quiero vivir', 'no quiero vivir mas', 'no quiero vivir más',
  'mejor muerto', 'mejor muerta', 'prefiero estar muerto', 'prefiero estar muerta',
  'desaparecer para siempre', 'acabar con mi vida', 'terminar con mi vida',
  'hacerme daño', 'hacerme dano', 'lastimarme',
  // AUDIT 2026-08-27 (mega-corpus) — passive ideation & plan/means (ES). Excludes
  // the benign idiom "terminar/acabar con todo este papeleo" by requiring
  // life/death context, not a bare "acabar con todo".
  'no quiero seguir viviendo', 'ya no quiero seguir viviendo', 'quitarme la vida',
  'me voy a quitar la vida', 'quitarme la vida esta noche', 'acabar con mi vida esta noche',
  'no le veo sentido a la vida', 'no vale la pena vivir', 'no vale la pena seguir viviendo',
  'para que sigo viviendo', 'para qué sigo viviendo', 'seria mejor si me muriera',
  'sería mejor si me muriera', 'mejor si me muero', 'ya no molesto', 'me las voy a tomar todas',
  'tomarmelas todas', 'tomármelas todas', 'pensando en tomarmelas', 'frasco de pastillas',
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
  // AUDIT 2026-08-27 (mega-corpus) — plain-language cardiac / breathing / STROKE
  // (FAST) / overdose descriptions a real senior types. These are acute-threat
  // phrasings, not the mild-symptom words the CP-03 clinical tier deliberately
  // keeps out of 911.
  'chest pain', 'pain in my chest', 'pain in the chest', 'chest hurts', 'my chest hurts', 'chest hurt',
  'chest is tight', 'chest feels tight', 'tightness in my chest', 'pressure in my chest',
  'crushing pain', "can't hardly breathe", 'cant hardly breathe', 'hard to breathe',
  'hard time breathing', "can't catch my breath", 'cant catch my breath', 'struggling to breathe',
  'gasping', 'choking',
  // STROKE / FAST
  'face is drooping', 'face drooping', 'mouth is drooping', 'mouth drooping', 'drooping on one side',
  'one side of my face', "can't talk right", 'cant talk right', 'slurred speech', 'slurring my words',
  "can't speak", 'face went numb', 'arm went numb', 'arm is going numb', 'left arm is numb',
  // Overdose (accidental or intentional) — include the common "too"->"to" typo
  'took too many', 'too many pills', 'took too many pills', 'took to many', 'to many of my',
];
const EMERGENCY_ES = [
  'llame al 911', 'llamar al 911', 'necesito 911', 'necesito una ambulancia',
  'infarto', 'me da un infarto', 'ataque al corazon', 'ataque al corazón',
  'derrame cerebral', 'dolor de pecho fuerte', 'me duele el pecho fuerte',
  'no puedo respirar', 'no respira', 'sangrando mucho', 'inconsciente',
  'se desmayó', 'se desmayo', 'me estoy muriendo',
  // AUDIT 2026-08-27 (mega-corpus) — descripciones comunes (ES): cardíaco,
  // respiración, ICTUS (boca torcida / no puede hablar / medio cuerpo), sobredosis.
  'me duele el pecho', 'dolor de pecho', 'dolor en el pecho', 'opresion en el pecho',
  'opresión en el pecho', 'pecho apretado', 'me aprieta el pecho',
  'no puedo respirar bien', 'me estoy asfixiando', 'asfixiando', 'me ahogo', 'me estoy ahogando',
  'me falta el aire', 'no me llega el aire',
  // ICTUS / FAST
  'se le tuerce la boca', 'se tuerce la boca', 'boca torcida', 'no puede hablar', 'no puede ablar',
  'no puedo hablar bien', 'un brazo no lo mueve', 'no mueve el brazo', 'un lado de la cara',
  'medio cuerpo', 'se le durmio la cara', 'se le durmió la cara', 'brazo se me esta durmiendo',
  'brazo se me está durmiendo',
  // Sobredosis
  'tome de mas', 'tomé de más', 'demasiadas pastillas', 'me tome muchas pastillas', 'muchas pastillas de',
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

// AUDIT 2026-08-27 (mega-corpus) — PROXIMITY REGEX NETS. The substring lists miss
// real phrasings where adverbs / morphology sit between the words: "me duele
// MUCHO el pecho", "chest HAS BEEN hurtin", "ENDING it all", stroke described as
// "boca se le tuerce ... no puede hablar". Regex runs on an accent-STRIPPED copy
// so ES matches regardless of diacritic normalization.
function stripAccents(t: string): string { return t.replace(/[̀-ͯ]/g, ''); }
function anyRe(text: string, list: RegExp[]): boolean { for (const re of list) if (re.test(text)) return true; return false; }

const EMERGENCY_RE: RegExp[] = [
  // Cardiac (EN)
  /chest[^.]{0,20}(pain|hurt|hurtin|hurting|tight|pressure|crush)/i,
  /(pain|hurt|tight|pressure|crushing)[^.]{0,16}(in (my|the) )?chest/i,
  /(left|right)?\s*arm[^.]{0,18}(numb|going numb|tingl|weak|dead)/i,
  // Stroke / FAST (EN)
  /(face|mouth)[^.]{0,18}(droop|numb|one side|to one side)/i,
  // Stroke speech — REQUIRE an acute qualifier so chronic "he has dementia and
  // cant talk" (a caregiver managing Medicare) is NOT flagged as a 911 stroke.
  /(can'?t|cant)[^.]{0,10}(talk|speak)[^.]{0,14}(right|straight|clearly|suddenly|all of a sudden)/i,
  /(suddenly|all of a sudden)[^.]{0,14}(can'?t|cant)[^.]{0,10}(talk|speak)/i,
  // Breathing (EN)
  /(can'?t|cant|hardly|trouble|struggl\w*|hard time|difficulty)[^.]{0,12}breath/i,
  // Unresponsive / not waking (EN)
  /(wo'?nt|won'?t|not|wont|cant|can'?t)[^.]{0,10}wake\s*up/i,
  /\bunresponsive\b|\bnot breathing\b/i,
  // Fall + can't get up (EN)
  /(can'?t|cant)[^.]{0,8}get (up|off the floor)/i,
  /took[^.]{0,10}(too |to )?many[^.]{0,12}(pill|of my)/i,
  // Cardiac (ES, accent-stripped)
  /(duele|dolor|aprieta|opresion|apreta)[^.]{0,16}pecho/i,
  /pecho[^.]{0,16}(duele|dolor|aprieta|apretado|opresion)/i,
  // AUDIT 2026-09-03 (R2-C4, P2) — "ataque al corazón/al corazon" was missed by
  // the client net entirely (accent-internal 'corazón' defeated the substring
  // lists; no regex covered "ataque"). Runs on accent-stripped `ta`.
  /ataque[^.]{0,8}(al )?corazon/i, /infarto\b/i,
  /brazo[^.]{0,20}(durmiendo|dormido|adormec|entumec|no lo mueve|no (lo )?puedo mover)/i,
  // Stroke / FAST (ES)
  /(boca|cara)[^.]{0,18}(torcida|tuerce|chueca|un lado|medio lado|dormida)/i,
  // Stroke speech (ES) — require sudden onset so chronic "no puede hablar"
  // (demencia) is not a 911 flag; real ES strokes also hit the boca/brazo nets.
  /(de repente|de un momento|de pronto|de golpe)[^.]{0,18}(no puede|no puedo)[^.]{0,6}(hablar|ablar)/i,
  // Breathing (ES)
  /(no puedo|me estoy|siento que me|no me deja)[^.]{0,8}(respir|asfixi|ahog)/i,
  /(me falta|no me llega)[^.]{0,6}(el )?aire/i,
  // Unresponsive / fall (ES)
  /no[^.]{0,8}(despierta|reacciona)/i,
  /no me puedo (parar|levantar|mover)/i,
  /(tome|tome de|tomé|tome)[^.]{0,6}(mas|demasiad)/i,
];
// Crisis patterns that ALWAYS trigger (unambiguous self-harm).
const CRISIS_STRONG_RE: RegExp[] = [
  /end(ing|in)?\s+it\s+(all|tonight|today)/i,
  /think(ing|in)?\s+(about|of)\s+.{0,12}end(ing|in)?\s+it/i,
  /better off (dead|gone|without me)/i,
  /no reason to (live|go on|keep going)/i,
  /(want|going) to (die|end (it|my life))/i,
  /(don'?t|dont)\s+want\s+to\s+liv/i, // "live"/"liv"/"living" — common senior typo
  /(pills|frasco de pastillas)[^.]{0,30}(take (them|all)|right here|todas|tomarme|tomarmelas)/i,
  /(tomarmelas|tomarme las|tomar todas las pastillas)/i,
  /no quiero (seguir )?vivir/i,
  /quitarme la vida|me voy a matar|acabar con mi vida/i,
  // AUDIT 2026-09-03 (R2-C4, P1) — server-only crisis phrasings back-ported to
  // the client net so Clara's deterministic contact-collector (which runs the
  // engine, NOT /api/chat) can never consume them as a name/phone answer. Run
  // on the accent-stripped copy `ta`, so no accents needed in the pattern.
  /ojala\s+no\s+despert\w*/i,
];
// Crisis patterns that are ambiguous — trigger ONLY without a benign
// (plan/payment/paperwork) context, so "no point paying for this plan" is safe.
const CRISIS_AMBIG_RE: RegExp[] = [
  /(don'?t|dont|no)\s+(see\s+)?the point[^.]{0,25}(anymore|any of this|living|life|going on|here|carry on)/i,
  /(what'?s|whats)\s+(even\s+)?the point\s+anymore/i,
  /no le veo sentido[^.]{0,15}(vida|vivir|seguir)/i,
  /para (que|que)\s+(sigo|seguir|vivir|vivo)/i,
  /(seria|mejor)\s+.{0,16}(muriera|me muero|muerto|muerta|no estuviera|no estar aqui|ya no estar|no despertar)/i,
];
const CRISIS_BENIGN_GUARD = /(plan\b|premium|prima|paying|\bpay\b|pagar|paperwork|papeleo|\bbill\b|factura|deducible|deductible|copay|copago|proceso|process\b|formulario|\bform\b|coverage|cobertura|paperwork)/i;

/** Detects mental-health crisis OR acute medical emergency in any language. */
export function detectSafetyTrigger(userMessage: string): SafetyResult {
  if (!userMessage || typeof userMessage !== 'string') return NO_HIT;
  const t = lowercased(userMessage);
  if (t.length < 2) return NO_HIT;
  const ta = stripAccents(t); // accent-free copy for the proximity regex nets

  // Crisis (988) — highest priority. Substring lists OR strong regex always fire;
  // ambiguous ideation fires only outside a benign plan/payment context.
  if (anyMatch(t, CRISIS_EN) || anyMatch(t, CRISIS_ES) || anyRe(ta, CRISIS_STRONG_RE)
    || (anyRe(ta, CRISIS_AMBIG_RE) && !CRISIS_BENIGN_GUARD.test(ta))) {
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

  // 911 medical emergency (substring lists OR proximity regex on accent-free copy)
  if (anyMatch(t, EMERGENCY_EN) || anyMatch(t, EMERGENCY_ES) || anyRe(ta, EMERGENCY_RE)) {
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

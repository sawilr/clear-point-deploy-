// Wave 50 — Adversarial phrase generator.
//
// Takes each intent's seed phrases and produces ~100 paraphrases per seed via:
//   • synonym swap (medicine↔drug↔medication, doctor↔médico↔primario)
//   • word-order variants
//   • leading filler ("hi", "look", "the thing is", "I just wanted to know")
//   • trailing filler ("please help", "thanks", "...")
//   • casing (ALL CAPS, lowercase, Title Case)
//   • typo injection (consonant swap, missing char, double char)
//   • punctuation noise (?!. random)
//   • Spanglish for ES intents (sprinkle EN words)
//   • EN-glish for EN intents (sprinkle ES words)
//
// Output: an array of { intent, phrase, lang } objects.

import { INTENT_CATALOG } from '../src/lib/classifier/intentCatalog.ts';

// ─── synonym maps ────────────────────────────────────────────────────────────
const SYNONYMS_ES = {
  doctor: ['doctor', 'doctora', 'médico', 'primario', 'PCP', 'mi doc', 'el doc', 'el de cabecera'],
  medicina: ['medicina', 'medicamento', 'medicación', 'receta', 'pastilla'],
  factura: ['factura', 'cobro', 'cuenta', 'bill'],
  plan: ['plan', 'cobertura', 'seguro'],
  ayuda: ['ayuda', 'asistencia', 'help'],
  necesito: ['necesito', 'busco', 'quiero', 'me hace falta'],
  no_puedo: ['no puedo', 'no me alcanza para', 'no tengo cómo'],
};
const SYNONYMS_EN = {
  doctor: ['doctor', 'physician', 'primary', 'PCP', 'my doc', 'the doctor'],
  medicine: ['medicine', 'medication', 'drug', 'prescription', 'pill', 'med'],
  bill: ['bill', 'charge', 'invoice'],
  plan: ['plan', 'coverage', 'insurance'],
  help: ['help', 'assistance', 'aid'],
  need: ['I need', 'looking for', 'I want', 'I require'],
  cant_afford: ["can't afford", "cannot afford", "can't pay for"],
};

const FILLERS_ES = {
  lead: ['', 'hola, ', 'oiga, ', 'mire, ', 'le explico, ', 'la cosa es que ', 'sabe qué, ', 'a ver, ', 'pues, ', 'ay, ', 'señorita, '],
  trail: ['', ' por favor', ' gracias', ' me puede ayudar', ' me orienta', ' ...', '?', '!', '.', ' urgente'],
};
const FILLERS_EN = {
  lead: ['', 'hi, ', 'look, ', 'so, ', 'the thing is, ', 'you know, ', 'okay, ', 'ma\'am, ', 'I just wanted to know, '],
  trail: ['', ' please', ' thanks', ' can you help', ' please advise', ' ...', '?', '!', '.', ' urgent'],
};

// ─── helpers ────────────────────────────────────────────────────────────────
function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }

/** Inject a consonant swap typo at a random position. */
function typo(s) {
  if (s.length < 4) return s;
  const i = 1 + rand(s.length - 2);
  if (/[a-z]/i.test(s[i])) {
    const swaps = { 'a': 'q', 'b': 'v', 'c': 'x', 'd': 's', 'e': 'r', 'f': 'g', 'g': 'h', 'h': 'j', 'i': 'o', 'j': 'k', 'k': 'l', 'l': 'k', 'm': 'n', 'n': 'm', 'o': 'p', 'p': 'l', 'q': 'a', 'r': 't', 's': 'a', 't': 'y', 'u': 'i', 'v': 'b', 'w': 'q', 'x': 'c', 'y': 'u', 'z': 'x' };
    const c = s[i].toLowerCase();
    if (swaps[c]) return s.slice(0, i) + swaps[c] + s.slice(i + 1);
  }
  return s;
}

/** Drop a random character. */
function dropChar(s) {
  if (s.length < 4) return s;
  const i = 1 + rand(s.length - 2);
  return s.slice(0, i) + s.slice(i + 1);
}

/** Random casing variant. */
function caseVariant(s) {
  const r = rand(4);
  if (r === 0) return s.toUpperCase();
  if (r === 1) return s.toLowerCase();
  if (r === 2) return s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Apply ES→EN sprinkle (Spanglish). */
function spanglish(s) {
  const swaps = [
    [/\bdoctor\b/i, 'doctor'],
    [/\bmédico\b/i, 'doctor'],
    [/\bplan\b/i, 'plan'],
    [/\bayuda\b/i, 'help'],
    [/\bmedicina\b/i, 'medicine'],
    [/\bfactura\b/i, 'bill'],
    [/\bcobertura\b/i, 'coverage'],
    [/\bpremium\b/i, 'premium'],
    [/\bprima\b/i, 'premium'],
  ];
  if (rand(2) === 0) {
    const [from, to] = pick(swaps);
    s = s.replace(from, to);
  }
  return s;
}

/** Apply EN→ES sprinkle. */
function englishSpanish(s) {
  const swaps = [
    [/\bdoctor\b/i, 'doctora'],
    [/\bmedicine\b/i, 'medicina'],
    [/\bbill\b/i, 'factura'],
    [/\bplan\b/i, 'plan'],
    [/\bhelp\b/i, 'ayuda'],
    [/\bpremium\b/i, 'prima'],
    [/\bcoverage\b/i, 'cobertura'],
  ];
  if (rand(2) === 0) {
    const [from, to] = pick(swaps);
    s = s.replace(from, to);
  }
  return s;
}

/** Swap obvious nouns for synonyms. */
function synonymizeEs(s) {
  for (const [base, syns] of Object.entries(SYNONYMS_ES)) {
    const re = new RegExp(`\\b${base}\\b`, 'i');
    if (re.test(s)) s = s.replace(re, pick(syns));
  }
  return s;
}
function synonymizeEn(s) {
  for (const [base, syns] of Object.entries(SYNONYMS_EN)) {
    const re = new RegExp(`\\b${base.replace(/_/g, ' ')}\\b`, 'i');
    if (re.test(s)) s = s.replace(re, pick(syns));
  }
  return s;
}

// ─── per-seed generation ────────────────────────────────────────────────────
function generateFromSeed(seed, lang, n) {
  const out = new Set();
  const fillers = lang === 'es' ? FILLERS_ES : FILLERS_EN;
  for (let i = 0; i < n * 3 && out.size < n; i++) {
    let s = seed;
    // Synonym swap (sometimes)
    if (rand(2) === 0) s = lang === 'es' ? synonymizeEs(s) : synonymizeEn(s);
    // Code-switch (sometimes)
    if (rand(4) === 0) s = lang === 'es' ? spanglish(s) : englishSpanish(s);
    // Lead + trail
    s = pick(fillers.lead) + s + pick(fillers.trail);
    // Casing
    if (rand(3) === 0) s = caseVariant(s);
    // Typo — realistic rate (chat users with autocomplete rarely typo heavily)
    if (rand(8) === 0) s = typo(s);
    if (rand(10) === 0) s = dropChar(s);
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length >= 4) out.add(s);
  }
  return [...out];
}

// ─── build full corpus ──────────────────────────────────────────────────────
export function buildAdversarialCorpus(perSeedCount = 30) {
  const corpus = [];
  for (const [intent, spec] of Object.entries(INTENT_CATALOG)) {
    if (intent === 'general') continue;
    for (const seed of spec.seedsEs || []) {
      for (const p of generateFromSeed(seed, 'es', perSeedCount)) {
        corpus.push({ intent, phrase: p, lang: 'es', seed });
      }
    }
    for (const seed of spec.seedsEn || []) {
      for (const p of generateFromSeed(seed, 'en', perSeedCount)) {
        corpus.push({ intent, phrase: p, lang: 'en', seed });
      }
    }
  }
  return corpus;
}

// CLI mode — always print when invoked directly (Windows-safe).
const _argv1 = (process.argv[1] || '').replace(/\\/g, '/');
if (_argv1.endsWith('generate-adversarial-phrases.mjs')) {
  const corpus = buildAdversarialCorpus(30);
  console.log(`Generated ${corpus.length} adversarial phrases.`);
  console.log('\nSample 10:');
  for (let i = 0; i < 10; i++) console.log(`  [${corpus[i].lang}/${corpus[i].intent}] ${corpus[i].phrase}`);
}

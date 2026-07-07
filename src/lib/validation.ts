/**
 * Lead quality validation utilities
 * Single source of truth for phone, email, and DOB validation.
 * Used by: ChatBot.tsx, SmartMedicareReview.tsx
 */

export interface LeadQualityFlags {
  flags: string[];
}

// ─── U.S. Area Code Allowlist ──────────────────────────────────────────────
// All 50 states + DC. Excludes territories (PR/USVI) and non-US NANP countries.
const US_AREA_CODES = new Set<number>([
  205,251,256,334,938,                                          // Alabama
  907,                                                          // Alaska
  480,520,602,623,928,                                          // Arizona
  479,501,870,                                                  // Arkansas
  209,213,279,310,323,341,408,415,424,442,510,530,559,562,     // California
  619,626,628,650,657,661,669,707,714,747,760,805,818,820,
  831,840,858,909,916,925,949,951,
  303,719,720,970,                                              // Colorado
  203,475,860,959,                                              // Connecticut
  202,                                                          // DC
  302,                                                          // Delaware
  239,305,321,352,386,407,448,561,689,727,754,772,786,813,     // Florida
  850,863,904,941,954,
  229,404,470,478,678,706,762,770,912,                         // Georgia
  808,                                                          // Hawaii
  208,986,                                                      // Idaho
  217,224,309,312,331,447,464,618,630,708,730,773,779,815,     // Illinois
  847,872,
  219,260,317,463,574,765,812,930,                             // Indiana
  319,515,563,641,712,                                          // Iowa
  316,620,785,913,                                              // Kansas
  270,364,502,606,859,                                          // Kentucky
  225,318,337,504,985,                                          // Louisiana
  207,                                                          // Maine
  240,301,410,443,667,                                          // Maryland
  339,351,413,508,617,774,781,857,978,                         // Massachusetts
  231,248,269,313,517,586,616,679,734,810,906,947,989,         // Michigan
  218,320,507,612,651,763,952,                                  // Minnesota
  228,601,662,769,                                              // Mississippi
  314,417,557,573,636,660,816,                                  // Missouri
  406,                                                          // Montana
  308,402,531,                                                  // Nebraska
  702,725,775,                                                  // Nevada
  603,                                                          // New Hampshire
  201,551,609,640,732,848,856,862,908,973,                     // New Jersey
  505,575,                                                      // New Mexico
  212,315,332,347,516,518,585,607,631,646,680,716,718,838,     // New York
  845,914,917,929,934,
  252,336,704,743,828,910,919,980,984,                         // North Carolina
  701,                                                          // North Dakota
  216,220,234,283,330,380,419,440,513,567,614,740,937,         // Ohio
  405,539,580,918,                                              // Oklahoma
  458,503,541,971,                                              // Oregon
  215,223,267,272,412,445,484,570,582,610,717,724,814,878,     // Pennsylvania
  401,                                                          // Rhode Island
  803,843,854,864,                                              // South Carolina
  605,                                                          // South Dakota
  423,615,629,731,865,901,931,                                  // Tennessee
  210,214,254,281,325,346,361,409,430,432,469,512,682,713,     // Texas
  726,737,806,817,830,832,903,915,936,940,945,956,972,979,
  385,435,801,                                                  // Utah
  802,                                                          // Vermont
  276,434,540,571,703,757,804,                                  // Virginia
  206,253,360,425,509,564,                                      // Washington
  304,681,                                                      // West Virginia
  262,414,534,608,715,920,                                      // Wisconsin
  307,                                                          // Wyoming
  // Sawil 2026-06-20 — U.S. TERRITORIES (NANPA, residents are U.S. citizens/
  // nationals and Medicare-eligible). LIVE BUG: Maria Torres (ZIP 10550, NY)
  // gave a valid 787 Puerto Rico cell and Clara rejected it 3x as "not 10
  // digits", trapping a real bilingual lead in a loop. PR (787/939) is essential
  // for this Spanish-speaking Medicare clientele. The anti-fake guards
  // (sequential / 555 / repetitive / exchange) still apply to these areas.
  787,939,                                                      // Puerto Rico
  340,                                                          // U.S. Virgin Islands
  671,                                                          // Guam
  670,                                                          // Northern Mariana Islands
  684,                                                          // American Samoa
]);

// ─── Phone Validation ──────────────────────────────────────────────────────

export function validatePhone(rawInput: string): {
  valid: boolean; cleaned: string; e164: string; flags: string[];
} {
  const FAIL = (flag: string) => ({ valid: false, cleaned: '', e164: '', flags: [flag] });

  if (!rawInput || !rawInput.trim()) return FAIL('Phone missing');

  const trimmed = rawInput.trim();

  // Reject explicit non-US country codes (+44, +52, etc.)
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) {
    return FAIL('Non-US country code — U.S. numbers only');
  }

  // Strip all non-digits
  const digits = trimmed.replace(/\D/g, '');

  // Handle 11-digit with leading 1 (US country code prefix)
  const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;

  // Must be exactly 10 digits
  if (national.length !== 10) {
    return FAIL('Phone must be exactly 10 digits');
  }

  const areaCode = parseInt(national.slice(0, 3), 10);
  const exchange = national[3];
  // The full 3-digit exchange prefix (positions 3-5). NANPA reserves the
  // exchange "555" specifically for fictional use (TV, movies, fake leads).
  const exchangePrefix = national.slice(3, 6);

  // Exchange code cannot start with 0 or 1
  if (exchange === '0' || exchange === '1') {
    return FAIL('Invalid exchange code');
  }

  // Area code must be a known U.S. area code (allowlist — excludes Canada, Caribbean, territories)
  if (!US_AREA_CODES.has(areaCode)) {
    return FAIL('Not a valid U.S. area code');
  }

  // ── PHASE A13 — anti-fake-lead hardening ─────────────────────────────────
  // NANPA reserved the entire "555" exchange (XXX-555-XXXX) for fictional
  // / entertainment use. Any number with exchange 555 is a fake lead —
  // including the textbook 212-555-1234 that the bot was previously
  // suggesting as an example.
  if (exchangePrefix === '555') {
    return FAIL('Phone appears fake (555 is reserved for fictional use)');
  }

  // Block all-same-digit numbers (0000000000 through 9999999999)
  if (/^(\d)\1{9}$/.test(national)) return FAIL('Phone appears fake');

  // PHASE A13 — detect ANY run of 8+ ascending or descending consecutive
  // digits, anywhere in the number. Catches the textbook fakes
  // (1234567890 / 0987654321 / 1234567892 / 4123456789) without
  // false-positives on real numbers that happen to contain a 7-digit
  // run by coincidence (e.g. 2122345678 — area 212 with a 7-run).
  const hasSequentialRun = (s: string, minLen: number): boolean => {
    let asc = 1, desc = 1;
    for (let i = 1; i < s.length; i++) {
      const a = Number(s[i]);
      const b = Number(s[i - 1]);
      if (a === b + 1) { asc++; if (asc >= minLen) return true; } else asc = 1;
      if (a === b - 1) { desc++; if (desc >= minLen) return true; } else desc = 1;
    }
    return false;
  };
  if (hasSequentialRun(national, 8)) return FAIL('Phone appears fake');

  // Block numbers with same digit repeated 7+ consecutive times
  if (/(\d)\1{6,}/.test(national)) return FAIL('Phone appears fake');

  // Sawil 2026-06-15 — low-entropy guard. A real 10-digit US number effectively
  // never uses only 1–2 distinct digits across all 10 positions. This catches
  // plausible-looking fakes that pass the area/exchange/pattern rules above —
  // e.g. 212-212-2122 or 717-717-7177 — without touching any real number.
  if (new Set(national).size <= 2) return FAIL('Phone appears fake (too few distinct digits)');

  // Sawil 2026-06-29 SECURITY HOTFIX (finding 03) — 867-5309 ("Jenny") is a
  // structurally-valid NANP number but a famous fictional one. Reject it in any
  // area code so Clara, Zara, and the server (api/submit-lead.js) all refuse it.
  if (national.slice(3) === '8675309') return FAIL('Phone appears fake (867-5309)');

  const e164 = '+1' + national;
  return { valid: true, cleaned: national, e164, flags: [] };
}

/** Normalize any U.S. phone input to E.164. Returns null if invalid. */
export function normalizeUSPhoneToE164(rawInput: string): string | null {
  const result = validatePhone(rawInput);
  return result.valid ? result.e164 : null;
}

// ─── DOB Validation ────────────────────────────────────────────────────────

export function calculateAge(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function validateDOB(dob: string): { valid: boolean; age: number | null; flags: string[] } {
  const flags: string[] = [];
  if (!dob) return { valid: false, age: null, flags: ['DOB missing'] };
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return { valid: false, age: null, flags: ['DOB invalid'] };
  if (birth > new Date()) return { valid: false, age: null, flags: ['DOB is in the future'] };
  const age = calculateAge(dob);
  if (age !== null && age > 120) return { valid: false, age, flags: ['DOB indicates age > 120'] };
  if (age !== null && age < 18) return { valid: false, age, flags: ['DOB indicates age < 18'] };
  if (age !== null && age < 65) {
    flags.push('Under 65 — may need disability, Medicare eligibility, Medicaid, or future enrollment review');
  }
  return { valid: true, age, flags };
}

// ─── Person Name Validation ────────────────────────────────────────────────

// Placeholder / test words that should never be submitted as a real name
const FAKE_NAME_WORDS = new Set([
  // Generic English placeholders
  'test','testing','fake','fakeuser','yes','no','yep','nope','nah','ok',
  'asdf','qwerty','qwert','zxcv','asdfg','qweasd',
  'none','na','unknown','user','admin','name','firstname','lastname',
  'first','last','example','sample','demo','hello','hey','hi',
  'anonymous','anon','guest','temp','dummy','placeholder','invalid','n/a',
  'noemail','nope','nothing','nobody','someone','anyone','noone',
  // Short keyboard patterns / letter runs
  'abc','abcd','abcde','xyz','xyx','xxx','yyy','zzz','aaa','bbb','ccc','ddd',
  'aab','xy','yx', // 'ab'/'ba' removed — real surnames (Vietnamese/African). Sawil 2026-06-15
  // Conversational words that are never real first/last names
  'thanks','thankyou','please','okay','hola','adios',
  // NOTE: syllable-style entries (toto, lulu, nene, bebe, mimi, kiki, fifi,
  // creta, etc.) were REMOVED here. They are real Hispanic names/nicknames and
  // the blocklist was rejecting real customers. The all-same-character regex
  // below still catches aaa/zzz; keyboard patterns stay blocked above.
  // Spanish placeholder words
  'nada','nadie','noname','nope','ninguno','ninguna','alguien',
  // Other obvious fakes
  'person','human','individual','contact','client','customer',
  'resident','patient','member','subscriber','applicant',
]);

// Profane words (EN + ES) — reject any name that contains these
const PROFANE_NAME_WORDS = new Set([
  // Spanish / Caribbean / Latin American profanity
  'culo','pinga','cono','coño','cabron','cabrón',
  'mamaguevo','mamahuevo','mamagueva','mamagueba',
  'maldita','maldito','puta','puto','putas','putos',
  'pendejo','pendeja','idiota','estupido','estúpido','estupida','estúpida',
  'mierda','joder','jodido','jodida','chinga','chingado','chingada','chingao',
  'verga','maricon','maricón','pajero','culero','culera',
  'pinche','panocha','carajo','singao','singá','singa',
  'gilipollas','capullo','hostia','cabrona','cabronazo',
  'caca','moco','lechero','lechera','puñeta','puñetero',
  'pinga','pirulo','bicho','bicha','cojonudo','cojon','cojón',
  // English profanity
  'fuck','fucker','fucking','fucked','shit','shitty','bitch','bitchy',
  'asshole','ass','bastard','damn','dick','pussy','cunt',
  'cock','whore','slut','motherfucker','faggot','fag',
  'nigger','nigga','retard','twat','wanker','bollocks','bugger',
  'dipshit','jackass','dumbass','shithead','scumbag','dirtbag',
]);

// Long, unambiguous profanity SAFE to match as a substring because it never
// appears inside a real name. Short words (ass, dick, cock) are intentionally
// NOT here: they stay in PROFANE_NAME_WORDS and match whole-token only, so
// Cassandra, Dickson, Hancock are not wrongly rejected.
const SUBSTRING_PROFANITY = [
  'fuck','shit','bitch','asshole','motherfucker','cunt','pussy','whore',
  'faggot','nigger','nigga','pendejo','pendeja','cabron','cabrón','mamaguevo',
  'mamahuevo','gilipollas','chingado','chingada','maricon','maricón','mierda',
];

// Real first names/nicknames that exactly equal a profanity token. Checked
// before the profanity pass so a real customer (e.g. Dick = Richard, common in
// the Medicare-age population) is never rejected.
const NAME_ALLOWLIST = new Set(['dick']);

/**
 * Validates a person's first or last name.
 * Allows: Unicode letters (accents, tildes, etc.), spaces, hyphens, apostrophes, periods.
 * Rejects: numbers, symbols, fake/test words, profanity.
 */
export function validatePersonName(value: string): { valid: boolean; flags: string[] } {
  if (!value || !value.trim()) return { valid: false, flags: ['Name is required'] };

  const raw = value.trim();

  // Minimum 2 characters
  if (raw.length < 2) return { valid: false, flags: ['Name is too short'] };

  // Must not contain digits
  if (/\d/.test(raw)) return { valid: false, flags: ['Name cannot contain numbers'] };

  // Allow: Unicode letters (U+0041–U+024F covers full Latin extended range),
  // spaces, hyphens, apostrophes, periods — reject everything else
  // Sawil 2026-06-15 i18n audit: also allow Latin Extended Additional
  // (\u1E00-\u1EFF, Vietnamese names like \u0110\u1EB7ng) and curly/modifier
  // apostrophes (\u2018\u2019\u02BC \u2014 iOS autocorrects ' to \u2019, so D\u2019Angelo passes).
  if (!/^[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s'\u2018\u2019\u02BC\-.]+$/.test(raw)) {
    return { valid: false, flags: ['Name contains invalid characters'] };
  }

  // Must contain at least one letter
  if (!/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(raw)) {
    return { valid: false, flags: ['Name must contain letters'] };
  }

  // Tokenize on whitespace and hyphens
  const words = raw.toLowerCase().split(/[\s-]+/).filter(Boolean);

  // Block all-same-character repeated patterns (aaa, bbb, zzz...)
  for (const word of words) {
    const letters = word.replace(/['\-.]/g, '');
    if (letters.length >= 2 && /^(.)\1+$/.test(letters)) {
      return { valid: false, flags: ['Name appears fake'] };
    }
  }

  // Fake/placeholder check: entire normalized name
  const normalizedFull = raw.toLowerCase().replace(/['\s.-]+/g, '');
  if (FAKE_NAME_WORDS.has(normalizedFull)) {
    return { valid: false, flags: ['Name appears fake or invalid'] };
  }

  // Fake/placeholder check: per word
  for (const word of words) {
    const stripped = word.replace(/['\-.]/g, '');
    if (stripped.length > 0 && FAKE_NAME_WORDS.has(stripped)) {
      return { valid: false, flags: ['Name appears fake or invalid'] };
    }
  }

  // Profanity check, two passes.
  // 1) Whole-token match: rejects "fuck you", "puta", "shit", "pendejo" without
  //    false-flagging real names that merely CONTAIN a short profane substring
  //    (Cassandra/Hassan have 'ass', Dick/Dickson have 'dick', Hancock has 'cock').
  for (const word of words) {
    const strippedWord = word.replace(/['\-.]/g, '');
    if (NAME_ALLOWLIST.has(strippedWord)) continue;
    if (PROFANE_NAME_WORDS.has(strippedWord)) {
      return { valid: false, flags: ['Name contains inappropriate content'] };
    }
  }
  // 2) Substring match for long, unambiguous profanity only (catches concatenated
  //    abuse like "fuckface" the whole-token pass would miss).
  const fullLower = raw.toLowerCase();
  for (const profane of SUBSTRING_PROFANITY) {
    if (fullLower.includes(profane)) {
      return { valid: false, flags: ['Name contains inappropriate content'] };
    }
  }

  return { valid: true, flags: [] };
}

// ─── Email Validation ──────────────────────────────────────────────────────

const PROFANE_EMAIL_LOCALS = new Set([
  // Spanish profanity as email local part
  'culo','pinga','cono','coño','cabron','mamaguevo','mamahuevo','mamagueva',
  'puta','puto','pendejo','pendeja','mierda','chinga','chingado','chingada',
  'verga','maricon','pajero','culero','pinche','singa','singao','carajo',
  // English profanity as email local part
  'fuck','shit','bitch','asshole','ass','dick','pussy','cunt','cock',
  'whore','slut','bastard','faggot','nigger','twat','wanker',
  'motherfucker','jackass','dumbass','dipshit',
]);

// Sawil 2026-06-15 — substring profanity for email LOCAL parts. Only long,
// unambiguous tokens that never appear inside a real local part (so
// assistant@, ridiculous@, reputation@, hancock@, dickson@, cassandra@,
// analyst@ are NOT flagged). Short ambiguous tokens (ass/cock/dick/puta/culo)
// are intentionally excluded here — they are caught whole-token via the
// segment pass below instead. Catches concatenated abuse the whole-local
// check misses: fuckyou@, putamadre@, pendejo123@, shithead@, mamaguevo99@.
const PROFANE_EMAIL_SUBSTRINGS = [
  'fuck','shit','bitch','asshole','motherfucker','cunt','pussy','faggot',
  'nigger','nigga','dipshit','dumbass','jackass','whore','slut','cumshot',
  'pendejo','pendeja','cabron','cabrón','maricon','maricón','mamaguevo',
  'mamahuevo','mamagueva','gilipollas','chingado','chingada','culero',
  'putamadre','hijueputa','hijoputa','singao','mierda',
];

const FAKE_EMAIL_PATTERNS: RegExp[] = [
  // Fake local parts
  /^test@/i, /^testing@/i, /^fake@/i, /^demo@/i, /^sample@/i,
  /^asdf@/i, /^qwer@/i, /^qwerty@/i, /^zxcv@/i,
  /^abc@/i, /^abcd@/i, /^aaa@/i, /^xxx@/i, /^yyy@/i, /^zzz@/i,
  /^none@/i, /^noemail@/i, /^noreply@/i, /^donotreply@/i,
  /^toto@/i, /^tata@/i, /^tete@/i, /^nana@/i,
  /^nobody@/i, /^noone@/i, /^anonymous@/i,
  // Fake domain combinations
  /^user@example\./i, /^email@email\./i, /^test@test\./i,
  /^fake@fake\./i, /^example@example\./i, /^name@example\./i,
  /^admin@admin\./i, /^info@info\./i, /^no@no\./i,
  /^user@test\./i, /^admin@test\./i,
  /^abc@abc\./i, /^xyz@xyz\./i,
];

const BLOCKED_DOMAINS = new Set([
  // Disposable / temp
  'mailinator.com','tempmail.com','tempmail.org','temp-mail.org',
  '10minutemail.com','guerrillamail.com','guerrillamail.org',
  'sharklasers.com','yopmail.com','throwaway.email','dispostable.com',
  'maildrop.cc','trashmail.com','fakeinbox.com','getairmail.com',
  'trashmail.net','spamgourmet.com','spamgourmet.net','discard.email',
  'spamevader.com','throwam.com','spamex.com','tempr.email',
  'burnermail.io','inboxbear.com','mintemail.com','moakt.com',
  // Obvious placeholder domains
  'example.com','example.net','example.org','test.com','test.net',
  'fake.com','fake.net','noemail.com','noemail.net','invalid.com',
  'none.com','no.com','no.net','asdf.com','qwerty.com','aaaa.com',
  // Profanity domains (EN + ES)
  'culo.com','puta.com','pendejo.com','idiota.com','estupido.com',
  'shit.com','fuck.com','ass.com','crap.com','damn.com',
  'mierda.com','verga.com','pinga.com','carajo.com',
  // Fake first-name domains (commonly used as placeholders)
  'maria.com','juan.com','pedro.com','jose.com',
  // Obvious keyboard-pattern domains
  'abc.com','abcd.com','xyz.com','xyz.net','toto.com','tata.com',
  'test.org','fake.org',
]);

export function validateEmail(email: string): { valid: boolean; flags: string[] } {
  // Empty/blank email is valid (field is optional)
  if (!email || !email.trim()) return { valid: true, flags: ['Email not provided'] };

  const raw = email.trim();
  const cleaned = raw.toLowerCase();

  // No spaces allowed
  if (/\s/.test(raw)) return { valid: false, flags: ['Email cannot contain spaces'] };

  // Must have exactly one @
  const atCount = (cleaned.match(/@/g) || []).length;
  if (atCount !== 1) return { valid: false, flags: ['Email format invalid'] };

  const [local, domain] = cleaned.split('@');

  // Local part checks
  if (!local || local.length === 0) return { valid: false, flags: ['Email missing local part'] };
  if (local.startsWith('.') || local.endsWith('.')) return { valid: false, flags: ['Email format invalid'] };
  if (local.includes('..')) return { valid: false, flags: ['Email format invalid'] };

  // Domain part checks
  if (!domain || !domain.includes('.')) return { valid: false, flags: ['Email missing valid domain'] };
  if (domain.startsWith('.') || domain.endsWith('.')) return { valid: false, flags: ['Email format invalid'] };
  if (domain.includes('..')) return { valid: false, flags: ['Email format invalid'] };

  // TLD must be 2-6 letters only
  const tld = domain.split('.').pop() || '';
  if (!/^[a-z]{2,6}$/.test(tld)) return { valid: false, flags: ['Email has invalid TLD'] };

  // Overall length
  if (cleaned.length > 254) return { valid: false, flags: ['Email too long'] };

  // Basic format sanity
  if (!/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleaned)) {
    return { valid: false, flags: ['Email format invalid'] };
  }

  // Fake patterns
  for (const pattern of FAKE_EMAIL_PATTERNS) {
    if (pattern.test(cleaned)) return { valid: false, flags: ['Email appears fake or invalid'] };
  }

  // Blocked / disposable / profanity domains
  if (BLOCKED_DOMAINS.has(domain)) return { valid: false, flags: ['Email domain not accepted'] };

  // Profane local part check, three passes:
  // 1) whole local part (culo@, fuck@)
  if (PROFANE_EMAIL_LOCALS.has(local)) return { valid: false, flags: ['Email contains inappropriate content'] };
  // 2) per-segment whole-token (split on . _ - + digits): fuck.you@, puta_madre@,
  //    fuck123you@ → segment "fuck"/"puta". Segments are deliberate separations,
  //    so short tokens (ass/dick) here won't hit "class"/"dickson" (single token).
  const segments = local.split(/[._\-+0-9]+/).filter(Boolean);
  for (const seg of segments) {
    if (PROFANE_EMAIL_LOCALS.has(seg)) return { valid: false, flags: ['Email contains inappropriate content'] };
  }
  // 3) substring of the local part, unambiguous list only: fuckyou@, putamadre@,
  //    pendejo123@, shithead@, mamaguevo99@ — without flagging assistant@,
  //    ridiculous@, reputation@, hancock@, dickson@.
  for (const profane of PROFANE_EMAIL_SUBSTRINGS) {
    if (local.includes(profane)) return { valid: false, flags: ['Email contains inappropriate content'] };
  }

  return { valid: true, flags: [] };
}

// ─── Quality Flags Aggregator ──────────────────────────────────────────────

export function getQualityFlags(
  dob: string, phone: string, email: string,
  zipSupported: boolean, zipLookupFailed: boolean
): string[] {
  const flags: string[] = [];
  const dobResult = validateDOB(dob);
  flags.push(...dobResult.flags);
  const phoneResult = validatePhone(phone);
  if (!phoneResult.valid) flags.push(`Phone: ${phoneResult.flags.join(', ')}`);
  else if (phoneResult.flags.length > 0) flags.push(`Phone suspicious: ${phoneResult.flags.join(', ')}`);
  const emailResult = validateEmail(email);
  if (!emailResult.valid && email && email.trim()) flags.push(`Email: ${emailResult.flags.join(', ')}`);
  else if (emailResult.flags.length > 0) flags.push(emailResult.flags[0]);
  if (!zipSupported && !zipLookupFailed) flags.push('ZIP outside supported states (NY/NJ/CT)');
  if (zipLookupFailed) flags.push('ZIP lookup failed');
  return flags;
}

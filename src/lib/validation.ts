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

  // Exchange code cannot start with 0 or 1
  if (exchange === '0' || exchange === '1') {
    return FAIL('Invalid exchange code');
  }

  // Area code must be a known U.S. area code (allowlist — excludes Canada, Caribbean, territories)
  if (!US_AREA_CODES.has(areaCode)) {
    return FAIL('Not a valid U.S. area code');
  }

  // Block all-same-digit numbers (0000000000 through 9999999999)
  if (/^(\d)\1{9}$/.test(national)) return FAIL('Phone appears fake');

  // Block obvious sequential fakes
  if (['1234567890','0987654321','9876543210','0123456789'].includes(national)) {
    return FAIL('Phone appears fake');
  }

  // Block numbers with same digit repeated 7+ consecutive times
  if (/(\d)\1{6,}/.test(national)) return FAIL('Phone appears fake');

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
  'aab','ab','ba','xy','yx',
  // Repeated syllable fakes (common in Latin American fake entries)
  // NOTE: 'pepe', 'coco', 'lola', 'nena' are real Hispanic names — NOT blocked
  'toto','tata','tete','titi','tutu','toco','tuca','tuco',
  'taca','lala','lolo','nene','bebe','kaka','jaja','jeje',
  'gaga','mama','papa','mimi','dodo','bobo',
  // Common nonsense/syllable fake names used in Spanish-speaking markets
  'creta','creto','popo','lulu','bubu','fifi','gugu','kiki',
  'nono','nini','pipi','riri','sisi','wawa','zuzu',
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
  if (!/^[a-zA-Z\u00C0-\u024F\s'\-.]+$/.test(raw)) {
    return { valid: false, flags: ['Name contains invalid characters'] };
  }

  // Must contain at least one letter
  if (!/[a-zA-Z\u00C0-\u024F]/.test(raw)) {
    return { valid: false, flags: ['Name must contain letters'] };
  }

  // Tokenize on whitespace and hyphens
  const words = raw.toLowerCase().split(/[\s\-]+/).filter(Boolean);

  // Block all-same-character repeated patterns (aaa, bbb, zzz...)
  for (const word of words) {
    const letters = word.replace(/['\-.]/g, '');
    if (letters.length >= 2 && /^(.)\1+$/.test(letters)) {
      return { valid: false, flags: ['Name appears fake'] };
    }
  }

  // Fake/placeholder check: entire normalized name
  const normalizedFull = raw.toLowerCase().replace(/['\s.\-]+/g, '');
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

  // Profanity check: substring match across full lowercased name
  const fullLower = raw.toLowerCase();
  for (const profane of PROFANE_NAME_WORDS) {
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

  // Profane local part check (e.g. culo@gmail.com, fuck@hotmail.com)
  if (PROFANE_EMAIL_LOCALS.has(local)) return { valid: false, flags: ['Email contains inappropriate content'] };

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
  if (!zipSupported && !zipLookupFailed) flags.push('ZIP outside supported states (NY/NJ/CT/FL)');
  if (zipLookupFailed) flags.push('ZIP lookup failed');
  return flags;
}

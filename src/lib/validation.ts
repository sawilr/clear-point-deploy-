/**
 * Lead quality validation utilities
 */

export interface LeadQualityFlags {
  flags: string[];
}

export function calculateAge(dob: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function validateDOB(dob: string): { valid: boolean; age: number | null; flags: string[] } {
  const flags: string[] = [];
  if (!dob) return { valid: false, age: null, flags: ['DOB missing'] };

  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return { valid: false, age: null, flags: ['DOB invalid'] };

  // Cannot be in the future
  if (birth > new Date()) return { valid: false, age: null, flags: ['DOB is in the future'] };

  const age = calculateAge(dob);

  // Cannot be older than 120
  if (age !== null && age > 120) return { valid: false, age, flags: ['DOB indicates age > 120'] };

  // Cannot be younger than 18
  if (age !== null && age < 18) return { valid: false, age, flags: ['DOB indicates age < 18'] };

  if (age !== null && age < 65) {
    flags.push('Under 65 — may need disability, Medicare eligibility, Medicaid, or future enrollment review');
  }

  return { valid: true, age, flags };
}

export function validatePhone(phone: string): { valid: boolean; cleaned: string; flags: string[] } {
  const flags: string[] = [];
  if (!phone) return { valid: false, cleaned: '', flags: ['Phone missing'] };

  const cleaned = phone.replace(/\D/g, '');

  // Must be exactly 10 digits
  if (cleaned.length !== 10) {
    return { valid: false, cleaned, flags: ['Phone must be 10 digits'] };
  }

  // Obviously fake numbers
  const fakePatterns = [
    /^0{10}$/, /^1{10}$/, /^2{10}$/, /^3{10}$/, /^4{10}$/,
    /^5{10}$/, /^6{10}$/, /^7{10}$/, /^8{10}$/, /^9{10}$/,
    /^1234567890$/, /^0987654321$/, /^9876543210$/, /^0123456789$/,
    /^5550000000$/, /^5551234567$/, /^8000000000$/, /^9991234567$/,
  ];

  for (const pattern of fakePatterns) {
    if (pattern.test(cleaned)) {
      return { valid: false, cleaned, flags: ['Phone appears fake'] };
    }
  }

  // Area code cannot start with 0 or 1
  if (cleaned[0] === '0' || cleaned[0] === '1') {
    flags.push('Phone area code invalid');
  }

  // Middle 3 digits (exchange code) cannot start with 1 or 0
  if (cleaned[3] === '0' || cleaned[3] === '1') {
    flags.push('Phone exchange code invalid');
  }

  // Repeated same digit 7+ times is suspicious
  if (/(\d)\1{6,}/.test(cleaned)) {
    return { valid: false, cleaned, flags: ['Phone appears fake'] };
  }

  return { valid: flags.length === 0, cleaned, flags };
}

const FAKE_EMAIL_PATTERNS = [
  /^test@test\.com$/i,
  /^fake@(?:fake|gmail)\.com$/i,
  /^none@none\.com$/i,
  /^noemail@email\.com$/i,
  /^example@example\.com$/i,
  /^abc@abc\.com$/i,
  /^test@/i,
  /^user@example\.com$/i,
  /^email@email\.com$/i,
];

const DISPOSABLE_DOMAINS = [
  'mailinator.com',
  'tempmail.com',
  'tempmail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.org',
  'sharklasers.com',
  'yopmail.com',
  'throwaway.email',
  'dispostable.com',
  'maildrop.cc',
  'trashmail.com',
  'temp-mail.org',
  'fakeinbox.com',
];

export function validateEmail(email: string): { valid: boolean; flags: string[] } {
  const flags: string[] = [];

  if (!email || !email.trim()) {
    flags.push('Email not provided');
    return { valid: true, flags };
  }

  const cleaned = email.trim().toLowerCase();

  // Basic format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    return { valid: false, flags: ['Email format invalid'] };
  }

  if (cleaned.length > 100) {
    return { valid: false, flags: ['Email too long'] };
  }

  // Check against known fake patterns
  for (const pattern of FAKE_EMAIL_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { valid: false, flags: ['Email appears fake'] };
    }
  }

  // Check disposable domains
  const domain = cleaned.split('@')[1];
  if (domain && DISPOSABLE_DOMAINS.includes(domain)) {
    return { valid: false, flags: ['Email uses disposable domain'] };
  }

  return { valid: true, flags: [] };
}

export function getQualityFlags(dob: string, phone: string, email: string, zipSupported: boolean, zipLookupFailed: boolean): string[] {
  const flags: string[] = [];

  const dobResult = validateDOB(dob);
  flags.push(...dobResult.flags);

  const phoneResult = validatePhone(phone);
  if (!phoneResult.valid) {
    flags.push(`Phone: ${phoneResult.flags.join(', ')}`);
  } else if (phoneResult.flags.length > 0) {
    flags.push(`Phone suspicious: ${phoneResult.flags.join(', ')}`);
  }

  const emailResult = validateEmail(email);
  if (!emailResult.valid && email.trim()) {
    flags.push(`Email: ${emailResult.flags.join(', ')}`);
  } else if (emailResult.flags.length > 0) {
    flags.push(emailResult.flags[0]);
  }

  if (!zipSupported && !zipLookupFailed) {
    flags.push('ZIP outside supported states (NY/NJ/CT/FL)');
  }
  if (zipLookupFailed) {
    flags.push('ZIP lookup failed');
  }

  return flags;
}

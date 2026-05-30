// Wave 48 — Doubled coverage. New vectors on top of V47:
//   • 50 four-to-six word ES phrases
//   • 50 four-to-six word EN phrases
//   • 30 code-switching phrases (mid-sentence EN↔ES)
//   • 20 combined name+phone+email fraud scenarios with partial validity
//   • Edge cases: empty input, very long input, mixed casing, punctuation noise

import {
  processMessage,
  createInitialState,
  validateName,
  validatePhone,
  validateEmail,
  detectFakeContactSignals,
} from '../src/lib/customerServiceEngine.ts';

let pass = 0, total = 0;
const fails = [];
function check(label, cond, detail = '') {
  total++;
  if (cond) pass++;
  else fails.push(`${label}${detail ? ' — ' + detail : ''}`);
}

function run(turns) {
  let s = createInitialState();
  const out = [];
  for (const t of turns) {
    const r = processMessage(t, s);
    s = r.newState;
    out.push(r.response);
  }
  return { responses: out, state: s };
}

const isFallbackEs = (r) =>
  /Perd[oó]n, no pude procesar eso bien|hag[aá]moslo simple|hag[aá]moslo f[aá]cil/i.test(r);
const isFallbackEn = (r) =>
  /Sorry, I could not process|let'?s make it simple/i.test(r);

// ─────────────────────────────────────────────────────────────────────────────
// 1. FIFTY 4-6 WORD ES PHRASES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 1. 50 frases 4-6 palabras ES ===');
const es4to6 = [
  'mi doctor se fue del area',
  'necesito cambiar mi plan de medicare',
  'no puedo pagar la prima mensual',
  'el copago de enero esta mal',
  'no me dejan ver al especialista',
  'mi farmacia esta cerrando este mes',
  'la carta del plan me confunde',
  'cobertura dental no esta incluida',
  'me cobraron de mas en hospital',
  'no entiendo el formulario nuevo',
  'mi medicina cuesta mucho dinero',
  'el plan denego mi cirugia ayer',
  'cumplo 65 anos el proximo mes',
  'me mude de florida a nueva york',
  'busco un plan mas barato',
  'mi esposo perdio su cobertura',
  'no me han llamado de medicare',
  'tengo medicaid y medicare juntos',
  'el especialista no acepta mi seguro',
  'necesito autorizacion para mi tratamiento',
  'el hospital me dio una factura',
  'mi medicamento ya no esta cubierto',
  'me cancelaron la cita del doctor',
  'la red de doctores cambio mucho',
  'no entiendo el aviso anoc',
  'mi prima va a subir mucho',
  'necesito ayuda con extra help',
  'recibi una carta de medicaid',
  'no me cubre dental ni vision',
  'cambiaron mi pcp sin avisar',
  'me llego una factura sorpresa',
  'mi plan no cubre la receta',
  'tengo problemas con el copago',
  'necesito ver un psiquiatra pronto',
  'mi diabetes necesita mas atencion',
  'no tengo transporte al doctor',
  'el plan no me responde',
  'me llamo alguien diciendo medicare',
  'necesito segunda opinion medica urgente',
  'la farmacia me cobro doble',
  'no puedo pagar el deducible',
  'mi doctor primario se jubilo',
  'el portal del plan no funciona',
  'me niegan la terapia fisica',
  'el laboratorio me cobro extra',
  'mi audifono no esta cubierto',
  'necesito una silla de ruedas',
  'el plan dental es muy basico',
  'mi vision esta empeorando rapido',
  'necesito un nuevo plan ahora',
];
for (const p of es4to6) {
  const { responses } = run(['español', '06825', p]);
  const r = responses[2];
  check(`1 ES "${p}" → topic-specific`, !isFallbackEs(r) && r.length > 30,
    `r="${r.slice(0, 100)}"`);
  check(`1 ES "${p}" → no invented amount`,
    !/\$\d|7407|10550|6825/.test(r));
  check(`1 ES "${p}" → has empathetic opener or topic word`,
    /entiendo|gracias|claro|anotado|asesor|cobertura|plan|doctor|medicina|factura|cobro|carta|inscripci[oó]n|opciones/i.test(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FIFTY 4-6 WORD EN PHRASES
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 2. 50 phrases 4-6 words EN ===');
const en4to6 = [
  'my doctor moved out of state',
  'I need to change my plan',
  'cannot afford my monthly premium',
  "January copay seems wrong to me",
  "they won't let me see specialist",
  'my pharmacy is closing this month',
  'the plan letter confuses me',
  'dental coverage is not included',
  'hospital overcharged me again last visit',
  "I don't understand the new form",
  'my medication costs too much',
  'the plan denied my surgery yesterday',
  'I turn 65 next month',
  'I moved from florida to ny',
  'looking for a cheaper plan',
  'my husband lost his coverage',
  "Medicare hasn't called me yet",
  'I have medicaid and medicare both',
  "specialist doesn't accept my insurance",
  'need authorization for my treatment',
  'hospital sent me a bill',
  'my drug is no longer covered',
  'they canceled my doctor appointment',
  'doctor network changed a lot',
  "I don't understand the anoc notice",
  'my premium will go up',
  'I need extra help with drugs',
  'I got a medicaid letter',
  'no dental or vision coverage',
  'they changed my pcp without notice',
  'I got a surprise bill',
  "plan doesn't cover my prescription",
  'having trouble with my copay',
  'need to see a psychiatrist soon',
  'my diabetes needs more attention',
  "I don't have transportation to doctor",
  'plan is not responding to me',
  'someone called saying medicare',
  'need urgent second medical opinion',
  'pharmacy charged me double again',
  "I cannot pay the deductible",
  'my primary doctor just retired',
  'plan portal is not working',
  'they deny my physical therapy',
  'lab charged me extra fees',
  'hearing aid is not covered',
  'I need a wheelchair',
  'dental plan is too basic',
  'my vision is getting worse',
  'I need a new plan now',
];
for (const p of en4to6) {
  const { responses } = run(['english', '10550', p]);
  const r = responses[2];
  check(`2 EN "${p}" → topic-specific`, !isFallbackEn(r) && r.length > 30,
    `r="${r.slice(0, 100)}"`);
  check(`2 EN "${p}" → no invented amount`,
    !/\$\d|7407|10550|6825/.test(r));
  check(`2 EN "${p}" → empathetic/topic`,
    /understand|got it|thanks|advisor|coverage|plan|doctor|drug|medication|bill|letter|enrollment|options|specialist|appointment|appeal|approve|surgery|premium|prior auth|network/i.test(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THIRTY CODE-SWITCHING PHRASES (Spanglish — common in NY/NJ/FL Hispanic Medicare population)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 3. Code-switching EN/ES same sentence ===');
const codeSwitch = [
  // Each: [phrase, language to start in, ZIP, must-not-fallback in that language]
  ['mi doctor doesn\'t take my plan', 'español', '06825'],
  ['I have problemas with my medicina', 'english', '10550'],
  ['necesito advisor para review my plan', 'español', '07407'],
  ['I got a factura de doscientos dolares', 'english', '32301'],
  ['mi plan denied my surgery', 'español', '06820'],
  ['they won\'t cover mi medicamento', 'english', '10550'],
  ['my doctora left the network', 'english', '06825'],
  ['el premium is too high este ano', 'español', '07407'],
  ['I\'m cumpliendo 65 next month', 'english', '32301'],
  ['mi inscripcion period is ahora', 'español', '06820'],
  ['need autorizacion for therapy', 'english', '10550'],
  ['mi pcp changed sin avisarme', 'español', '06825'],
  ['the farmacia overcharged me', 'english', '07407'],
  ['no me cubre the surgery', 'español', '32301'],
  ['I don\'t understand la carta', 'english', '06820'],
  ['mi esposa lost coverage tambien', 'español', '10550'],
  ['I need un plan mas barato', 'english', '06825'],
  ['the medicaid letter llego ayer', 'español', '07407'],
  ['mi audifono is not covered', 'español', '32301'],
  ['necesito una second opinion', 'español', '06820'],
  ['my deductible es muy alto', 'english', '10550'],
  ['I have problemas con el copay', 'english', '06825'],
  ['el portal no funciona at all', 'español', '07407'],
  ['no transportation al doctor', 'español', '32301'],
  ['someone called diciendo medicare', 'english', '06820'],
  ['I need terapia fisica covered', 'english', '10550'],
  ['mi PCP se retired ayer', 'español', '06825'],
  ['can you help mi esposa enroll', 'english', '07407'],
  ['mi medicare advantage es malo', 'español', '32301'],
  ['I want to cambiar mi plan ahora', 'english', '06820'],
];
for (const [phrase, startLang, zip] of codeSwitch) {
  const { responses } = run([startLang, zip, phrase]);
  const r = responses[2];
  const startedEs = startLang === 'español';
  check(`3 CS "${phrase}" → no generic fallback`,
    !(startedEs ? isFallbackEs : isFallbackEn)(r));
  check(`3 CS "${phrase}" → response stays in chosen language ${startLang}`,
    startedEs
      ? /[áéíóúñ]|entiendo|gracias|claro|cobertura|asesor|cuenta|opci|hola|de acuerdo|por supuesto/i.test(r)
      : /\b(understand|advisor|coverage|plan|drug|got it|options|help|cover|sorry|thanks|tell|detail|situation|enrollment|enroll|appeal|approve|surgery|specialist)\b/i.test(r),
    `r="${r.slice(0, 100)}"`);
  check(`3 CS "${phrase}" → no invented $`, !/\$\d|7407|10550|6825/.test(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TWENTY COMBINED CONTACT-FRAUD SCENARIOS
//    Mix of real + fake across name/phone/email to verify partial detection.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 4. Combined name+phone+email fraud scenarios ===');
const scenarios = [
  // [label, name, phone, email, expectedFlagPrefixes]
  ['real all',                   'Maria Rodriguez',     '914-825-9876',     'maria.rodriguez@gmail.com',     []],
  ['real name, fake phone',      'John Smith',          '212-555-1234',     'jsmith@yahoo.com',              ['phone_']],
  ['real name, fake email',      'Carmen Sanchez',      '917-683-4422',     'test@test.com',                 ['email_']],
  ['fake name, real phone',      'Mickey Mouse',        '631-555-0311',     'mickey@verizon.net',            ['name_']],
  ['fake name, fake phone',      'John Doe',            '0000000000',       'real@gmail.com',                ['name_', 'phone_']],
  ['fake name, fake email',      'Test Test',           '347-200-4455',     'admin@example.com',             ['name_', 'email_']],
  ['fake everything',            'Asdf Qwerty',         '1234567890',       'fake@fake.com',                 ['name_', 'phone_', 'email_']],
  ['cartoon name',               'Donald Duck',         '516-789-1010',     'donald@aol.com',                ['name_']],
  ['insult name',                'Fuck Off',            '973-555-9999',     'jose@gmail.com',                ['name_', 'phone_']],
  ['celebrity placeholder',      'Elvis Presley',       '305-444-2200',     'elvis@hotmail.com',             ['name_']],
  ['empty all',                  '',                    '',                 '',                              []],
  ['empty phone+email',          'Antonio Lopez',       '',                 '',                              []],
  ['one-letter name',            'A',                   '914-555-1234',     'a@b.co',                        ['name_', 'phone_', 'email_']],
  ['too-long name',              'Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '914-825-9876', 'real@gmail.com', ['name_']],
  ['repeated chars name',        'Aaaaaaaa',            '914-825-9876',     'real@yahoo.com',                ['name_']],
  ['sequential phone',           'Pedro Martinez',      '0123456789',       'pedro@gmail.com',               ['phone_']],
  ['repeating digits phone',     'Ana Garcia',          '7777777777',       'ana@yahoo.com',                 ['phone_']],
  ['hollywood 555 phone',        'Luis Hernandez',      '212-555-9999',     'luis@hotmail.com',              ['phone_']],
  ['mailinator email',           'Sofia Reyes',         '347-683-1212',     'temp@mailinator.com',           ['email_']],
  ['bad-shape email',            'Carlos Vega',         '917-683-4477',     'not-an-email',                  ['email_']],
];
for (const [label, name, phone, email, expectedPrefixes] of scenarios) {
  const flags = detectFakeContactSignals({ name, phone, email });
  // Empty inputs return no flags (validators handle empty as "not checked").
  // Wave 47 spec: validators only run when value is non-empty.
  if (expectedPrefixes.length === 0) {
    check(`4.${label}: no fraud flags`, flags.length === 0,
      `flags=${JSON.stringify(flags)}`);
  } else {
    for (const prefix of expectedPrefixes) {
      check(`4.${label}: flag starts with "${prefix}"`,
        flags.some((f) => f.startsWith(prefix)),
        `flags=${JSON.stringify(flags)}`);
    }
    check(`4.${label}: exactly ${expectedPrefixes.length} prefix categor${expectedPrefixes.length === 1 ? 'y' : 'ies'} flagged`,
      new Set(flags.map((f) => f.split('_')[0])).size === expectedPrefixes.length,
      `flags=${JSON.stringify(flags)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. EDGE INPUTS — empty, whitespace, very long, all-caps, all-emoji
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 5. Edge inputs ===');
{
  // Empty / whitespace input shouldn't crash
  const { responses } = run(['español', '06825', '   ']);
  const r = responses[2];
  check('5.1 whitespace input → no crash + clean reply', typeof r === 'string' && r.length > 0);
  check('5.1 whitespace input → no undefined/null leak',
    !/undefined|\bnull\b|\bNaN\b/.test(r));
}
{
  const longInput = 'mi doctor no me quiere atender '.repeat(20);
  const { responses } = run(['español', '06825', longInput]);
  check('5.2 long input → no crash', typeof responses[2] === 'string');
  check('5.2 long input → topic detected', /doctor|asesor|red|cobertura|atender/i.test(responses[2]));
}
{
  const allCaps = 'TENGO PROBLEMAS CON EL COPAGO Y NO PUEDO PAGAR';
  const { responses } = run(['español', '06825', allCaps]);
  check('5.3 ALL CAPS → topic detected', /copago|asesor|costo|cobertura|entiendo/i.test(responses[2]));
}
{
  const { responses } = run(['english', '10550', '!!! ??? *** ###']);
  check('5.4 punctuation noise → no crash + non-empty', responses[2].length > 0);
}
{
  // Tab + newline inside input
  const { responses } = run(['español', '06825', 'mi\tdoctor\nno acepta\tmi plan']);
  check('5.5 tab/newline → handled gracefully', responses[2].length > 0 && !isFallbackEs(responses[2]));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. NO ADJACENT LOOP across all the new cases above
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 6. No adjacent loop across mixed flows ===');
{
  const flows = [
    ['español', '06825', 'mi doctor no me quiere atender', 'no me dejan ver al especialista', 'me cancelaron la cita'],
    ['english', '10550', "my doctor won't see me", "they won't let me see specialist", 'they canceled my appointment'],
    ['español', '07407', 'mi plan denego mi cirugia', 'es posible q debo hacer', 'es posible q debo hacer'],
    ['english', '32301', 'they denied my surgery', "what can I do", "what can I do"],
    ['español', '06820', 'tengo problemas con mi medicina', 'el copago de enero esta mal', 'mi farmacia esta cerrando'],
  ];
  for (let i = 0; i < flows.length; i++) {
    const { responses } = run(flows[i]);
    let dup = false;
    for (let j = 2; j < responses.length - 1; j++) {
      if (responses[j].trim() === responses[j + 1].trim()) { dup = true; break; }
    }
    check(`6.${i + 1} flow has NO adjacent dup response`, !dup);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. VALIDATOR DIRECT CALLS — extended set
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== 7. validateName / validatePhone / validateEmail edge cases ===');
// Name
check('7.1 validateName "Maria"', validateName('Maria').isValid === true);
check('7.2 validateName "María"', validateName('María').isValid === true);
check('7.3 validateName "Jean-Luc"', validateName('Jean-Luc').isValid === true);
check('7.4 validateName "O\'Brien"', validateName('O\'Brien').isValid === true);
check('7.5 validateName "Mickey Mouse"', validateName('Mickey Mouse').isValid === false);
check('7.6 validateName "test"', validateName('test').isValid === false);
check('7.7 validateName "fuck"', validateName('fuck').isValid === false);
check('7.8 validateName "A"', validateName('A').isValid === false);
check('7.9 validateName "aaaaa"', validateName('aaaaa').isValid === false);

// Phone
check('7.10 validatePhone "914-825-9876"', validatePhone('914-825-9876').isValid === true);
check('7.11 validatePhone "(917) 683-4422"', validatePhone('(917) 683-4422').isValid === true);
check('7.12 validatePhone "1-914-825-9876"', validatePhone('1-914-825-9876').isValid === true);
check('7.13 validatePhone "212-555-1234"', validatePhone('212-555-1234').isValid === false);
check('7.14 validatePhone "0123456789"', validatePhone('0123456789').isValid === false);
check('7.15 validatePhone "9999999999"', validatePhone('9999999999').isValid === false);
check('7.16 validatePhone "555-683-4422"', validatePhone('555-683-4422').isValid === false); // area 555
check('7.17 validatePhone "212"', validatePhone('212').isValid === false); // too short

// Email
check('7.18 validateEmail "maria@gmail.com"', validateEmail('maria@gmail.com').isValid === true);
check('7.19 validateEmail "jose.garcia+a@outlook.com"', validateEmail('jose.garcia+a@outlook.com').isValid === true);
check('7.20 validateEmail "test@test.com"', validateEmail('test@test.com').isValid === false);
check('7.21 validateEmail "a@b.co"', validateEmail('a@b.co').isValid === false);
check('7.22 validateEmail "no-at-sign"', validateEmail('no-at-sign').isValid === false);
check('7.23 validateEmail "@nothing.com"', validateEmail('@nothing.com').isValid === false);
check('7.24 validateEmail "admin@admin.com"', validateEmail('admin@admin.com').isValid === false);
check('7.25 validateEmail "temp@yopmail.com"', validateEmail('temp@yopmail.com').isValid === false);

console.log(`\n=== TOTALS ===`);
console.log(`  ${pass} / ${total} assertions passed (${((pass / total) * 100).toFixed(1)}%)`);
if (fails.length > 0) {
  console.log(`\n  FAILED (${fails.length}):`);
  for (const f of fails.slice(0, 40)) console.log(`    ✗ ${f}`);
  if (fails.length > 40) console.log(`    ... (+${fails.length - 40} more)`);
}
process.exit(fails.length > 0 ? 1 : 0);

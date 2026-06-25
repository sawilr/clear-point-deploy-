import { normalizeSpokenEmail as N, validateEmail as V } from '../src/lib/customerServiceEngine';
const cases: [string,string][] = [
  ['Sí Antonio bandera 21@gmail.com', 'antoniobandera21@gmail.com'],
  ['Antonio banderas 21@gmail.com', 'antoniobanderas21@gmail.com'],
  ['antonio banderas 21 arroba gmail punto com', 'antoniobanderas21@gmail.com'],
  ['mi correo es maria lopez arroba gmail punto com', 'marialopez@gmail.com'],
  ['maria.lopez@gmail.com', 'maria.lopez@gmail.com'],   // typed — unchanged
  ['maria@gmail.com', 'maria@gmail.com'],               // typed — unchanged
  ['el email está mal', 'el email está mal'],           // no email — unchanged
];
let ok=0;
for (const [inp,exp] of cases){ const got=N(inp); const pass=got===exp; if(pass)ok++; console.log(`${pass?'OK  ':'FAIL'} "${inp}" -> "${got}"${pass?'':`  (exp "${exp}")`}`); }
// the joined emails must also pass validateEmail
console.log('\nvalidateEmail(antoniobanderas21@gmail.com):', V('antoniobanderas21@gmail.com').isValid);
console.log(`\n${ok}/${cases.length}`);
process.exit(ok===cases.length?0:1);

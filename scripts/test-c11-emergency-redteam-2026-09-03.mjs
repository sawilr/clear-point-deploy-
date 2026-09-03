const F = await import('file:///C:/Users/senti/clearpoint-deploy-work/api/_lib/compliance-filter.js');
const { matchesEmergency, matchesSelfHarm } = F;
// Direction A — MUST STILL fire (genuine emergencies, some with benign words nearby)
const MUST_FIRE = [
  'chest pain, is the ER covered?', "I can't breathe and my copay went up",
  "he's having a stroke right now, does insurance cover the ambulance?",
  'bleeding heavily, is this covered by my plan?', 'he collapsed, is the ambulance covered?',
  'my chest is crushing and tight, does cost even matter', 'I am having a heart attack, is the ER in network?',
  'she passed out, is urgent care covered?', 'took too many pills, does my plan cover the ER?',
  'me duele el pecho, cubre Medicare la sala de emergencia?', 'no puedo respirar, esta cubierto?',
  'mi esposo se está muriendo, cubre la ambulancia?', 'se desmayó, cubre el plan la sala de emergencia?',
  'my left arm is numb and my chest hurts, is this a covered visit?',
  'I think I am having a stroke, what is the copay', 'call 911, is the ambulance a covered benefit?',
  'chest pain right now', 'having a heart attack', "can't breathe", 'he is bleeding badly',
  'tengo un dolor aplastante en el pecho', 'no puedo respirar bien', 'se está ahogando',
];
// Direction B — MUST NOT fire (benign coverage / historical / dental)
const MUST_NOT_FIRE = [
  'does Medicare cover emergency room visits?', 'is the ER covered under Part A?',
  'my stroke was in 2019', 'my heart attack was back in 2015', 'bleeding gums',
  'my plan denied my emergency room bill', 'what is the copay for an ambulance?',
  'does my plan cover urgent care?', 'coverage for the emergency room?',
  'I had a heart attack years ago, what plan is best', 'cuanto es el copago de la sala de emergencia?',
  'cubre Medicare la ambulancia?', 'mi derrame fue en 2018', 'mis encias sangran',
  'is emergency room coverage included?', 'how much does an ambulance cost with Medicare?',
];
let pass=0, miss=[], over=[];
for(const m of MUST_FIRE){ if(matchesEmergency(m)) pass++; else miss.push(m); }
for(const b of MUST_NOT_FIRE){ if(!matchesEmergency(b)) pass++; else over.push(b); }
console.log(`C11 RED-TEAM: ${pass}/${MUST_FIRE.length+MUST_NOT_FIRE.length} correct`);
if(miss.length){ console.log('\n*** LIFE-SAFETY MISS (must fire but did NOT) — CRITICAL:'); for(const m of miss) console.log('   MISS: '+m); }
if(over.length){ console.log('\n over-trigger (benign fired):'); for(const o of over) console.log('   OVER: '+o); }
process.exit(miss.length?2:0);

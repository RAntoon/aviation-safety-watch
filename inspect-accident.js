const fs = require('fs');

const data = JSON.parse(fs.readFileSync('/Users/ryanantoon/Desktop/A/ApplicationConcepts/aviationsafetywatch/JSONDATA/JSON/accidents_update.json', 'utf8'));

console.log('\n📋 GAA24WA240 Full Data:\n');
console.log(JSON.stringify(data[0], null, 2));

console.log('\n🔍 Checking numeric fields:\n');
const record = data[0];
console.log('Latitude:', record.latitude, typeof record.latitude);
console.log('Longitude:', record.longitude, typeof record.longitude);
console.log('Fatal count:', record.inj_f_grnd, typeof record.inj_f_grnd);
console.log('Serious injury:', record.inj_s_grnd, typeof record.inj_s_grnd);
console.log('Minor injury:', record.inj_m_grnd, typeof record.inj_m_grnd);
console.log('cm_mkey:', record.cm_mkey, typeof record.cm_mkey);

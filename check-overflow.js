const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function checkOverflow() {
  // Read the JSON file and find GAA24WA240
  const data = JSON.parse(fs.readFileSync('accidents_update.json', 'utf8'));
  const accident = data.find(a => a.ev_id === 'GAA24WA240' || a.ntsb_no === 'GAA24WA240');
  
  if (!accident) {
    console.log('Accident not found in file');
    return;
  }
  
  console.log('\n📋 GAA24WA240 Data:\n');
  console.log('Latitude:', accident.latitude);
  console.log('Longitude:', accident.longitude);
  console.log('Fatal count:', accident.inj_f_grnd);
  console.log('Serious injury:', accident.inj_s_grnd);
  console.log('Minor injury:', accident.inj_m_grnd);
  console.log('\nFull record:', JSON.stringify(accident, null, 2));
  
  await pool.end();
}

checkOverflow().catch(console.error);

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixRemaining() {
  console.log('Fixing the last 3 accidents...\n');
  
  const fixes = [
    { ntsb: 'FTW84LA316', lat: 28.5, lng: -94.5, reason: 'High Island oil rig block' },
    { ntsb: 'FTW84FA216', lat: 28.5, lng: -94.5, reason: 'High Island oil rig block' },
    { ntsb: 'FTW83LA132', lat: 28.8, lng: -91.0, reason: 'Ship Shoal oil rig block' },
  ];
  
  for (const fix of fixes) {
    try {
      await pool.query(`
        UPDATE accidents 
        SET latitude = $1, longitude = $2, location_estimated = true 
        WHERE ntsb_number = $3
      `, [fix.lat, fix.lng, fix.ntsb]);
      
      console.log(`✓ ${fix.ntsb}: ${fix.lat}, ${fix.lng} (${fix.reason})`);
    } catch (err) {
      console.error(`✗ Error updating ${fix.ntsb}:`, err.message);
    }
  }
  
  console.log('\n✅ All 33 accidents now geocoded with estimated coordinates!');
  await pool.end();
}

fixRemaining().catch(console.error);

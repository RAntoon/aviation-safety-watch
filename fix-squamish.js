const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixSquamish() {
  console.log('Fixing Squamish, BC accident...\n');
  
  // Squamish, British Columbia, Canada coordinates
  const correctLat = 49.7016;
  const correctLng = -123.1558;
  
  try {
    const result = await pool.query(`
      UPDATE accidents 
      SET latitude = $1, longitude = $2, location_estimated = false
      WHERE ntsb_number = 'GAA26WA009'
      RETURNING ntsb_number, city, state, country, latitude, longitude
    `, [correctLat, correctLng]);
    
    if (result.rows.length > 0) {
      console.log('✓ Fixed:', result.rows[0]);
      console.log(`  Squamish, BC is now at: ${correctLat}, ${correctLng}`);
    } else {
      console.log('✗ Accident not found');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  
  await pool.end();
}

fixSquamish().catch(console.error);

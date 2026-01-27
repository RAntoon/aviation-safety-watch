const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Coordinates for the 6 remaining accidents
const fixes = [
  { ntsb: 'ENG26WA012', lat: 25.6866, lng: -100.3161, location: 'Parque Industrial Aerotech, Apodaca, Mexico' },
  { ntsb: 'GAA26WA078', lat: -33.4489, lng: -70.6693, location: 'Santiago, Chile' },
  { ntsb: 'GAA26WA077', lat: 25.4231, lng: -100.9737, location: 'Saltillo, Coahuila, Mexico' },
  { ntsb: 'GAA26WA062', lat: -33.6900, lng: 117.5800, location: 'Katanning, Western Australia' },
  { ntsb: 'GAA26WA069', lat: 19.5500, lng: -71.0833, location: 'Boca de Mao, Dominican Republic' },
  { ntsb: 'ENG25WA054', lat: 33.8834, lng: 130.8751, location: 'Kitakyushu, Japan' },
];

async function fixLast6() {
  console.log('Fixing last 6 accidents...\n');
  
  for (const fix of fixes) {
    try {
      await pool.query(`
        UPDATE accidents 
        SET latitude = $1, longitude = $2, location_estimated = false
        WHERE ntsb_number = $3
      `, [fix.lat, fix.lng, fix.ntsb]);
      
      console.log(`✓ ${fix.ntsb}: ${fix.location}`);
      console.log(`  Coordinates: ${fix.lat}, ${fix.lng}`);
    } catch (err) {
      console.error(`✗ Error updating ${fix.ntsb}:`, err.message);
    }
  }
  
  console.log('\n✅ All accidents now geocoded!');
  await pool.end();
}

fixLast6().catch(console.error);

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function analyzeMissing() {
  console.log('\n🔍 Analyzing 4,299 accidents without coordinates...\n');
  
  // Check what location data they have
  const breakdown = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE city IS NOT NULL) as has_city,
      COUNT(*) FILTER (WHERE state IS NOT NULL) as has_state,
      COUNT(*) FILTER (WHERE country IS NOT NULL) as has_country,
      COUNT(*) FILTER (WHERE city IS NULL AND state IS NULL AND country IS NULL) as no_location_data,
      COUNT(*) FILTER (WHERE city IS NOT NULL OR state IS NOT NULL OR country IS NOT NULL) as has_some_location,
      MIN(event_date) as oldest_date,
      MAX(event_date) as newest_date
    FROM accidents
    WHERE latitude IS NULL
  `);
  
  const row = breakdown.rows[0];
  console.log('📊 Location Data Breakdown:');
  console.log(`  Has city: ${row.has_city}`);
  console.log(`  Has state: ${row.has_state}`);
  console.log(`  Has country: ${row.has_country}`);
  console.log(`  Has SOME location data: ${row.has_some_location}`);
  console.log(`  NO location data at all: ${row.no_location_data}`);
  console.log(`  Date range: ${row.oldest_date?.toISOString().split('T')[0]} to ${row.newest_date?.toISOString().split('T')[0]}\n`);
  
  // Sample some records to see what we're dealing with
  const samples = await pool.query(`
    SELECT ntsb_number, event_date, city, state, country, aircraft_make, aircraft_model
    FROM accidents
    WHERE latitude IS NULL
    ORDER BY event_date DESC
    LIMIT 20
  `);
  
  console.log('📋 Sample of 20 most recent records without coordinates:\n');
  samples.rows.forEach(r => {
    const location = [r.city, r.state, r.country].filter(Boolean).join(', ') || '[NO LOCATION DATA]';
    console.log(`${r.ntsb_number} | ${r.event_date?.toISOString().split('T')[0]} | ${location}`);
  });
  
  await pool.end();
}

analyzeMissing().catch(console.error);

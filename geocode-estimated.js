const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Estimated coordinates for the 33 remaining accidents
const ESTIMATED_COORDS = {
  // Gulf of Mexico Oil Rig Blocks (approximate center of each block area)
  'HIGH ISLAND': { lat: 28.5, lng: -94.5, reason: 'Gulf of Mexico oil rig block' },
  'SHIP SHOAL': { lat: 28.8, lng: -91.0, reason: 'Gulf of Mexico oil rig block' },
  'EUGENE ISL': { lat: 29.4, lng: -91.5, reason: 'Gulf of Mexico oil rig block' },
  'CAMERON': { lat: 28.3, lng: -93.0, reason: 'Gulf of Mexico oil rig block' },
  'SO. PASS': { lat: 28.9, lng: -89.2, reason: 'Gulf of Mexico oil rig block' },
  'E. ISLAND': { lat: 28.5, lng: -94.5, reason: 'Gulf of Mexico oil rig block' },
  'S. TIMBALIER': { lat: 28.9, lng: -90.2, reason: 'Gulf of Mexico oil rig block' },
  'GREEN CANYON': { lat: 27.6, lng: -90.5, reason: 'Gulf of Mexico oil rig block' },
  'W CAMRN': { lat: 28.3, lng: -93.0, reason: 'Gulf of Mexico oil rig block' },
  'E BRAKE': { lat: 28.5, lng: -91.0, reason: 'Gulf of Mexico oil rig block' },
  'GRAND ISLE': { lat: 29.2, lng: -89.9, reason: 'Gulf of Mexico oil rig block' },
  'BUCCANEER OIL': { lat: 28.5, lng: -91.5, reason: 'Gulf of Mexico oil rig' },
  
  // General ocean/water areas
  'GULF OF CA': { lat: 28.0, lng: -112.0, reason: 'Gulf of California center' },
  'GULF-OF-MEXICO': { lat: 27.5, lng: -90.0, reason: 'Gulf of Mexico center' },
  'NO.ATLANTIC OC': { lat: 40.0, lng: -40.0, reason: 'North Atlantic Ocean' },
  'int\'l waters': { lat: 25.0, lng: -70.0, reason: 'International waters (estimated)' },
  
  // Puerto Rico approximations
  'NEAR SAN JUAN': { lat: 18.4655, lng: -66.1057, reason: 'Near San Juan, Puerto Rico' },
  'ISBELA SEGUNDA': { lat: 18.0953, lng: -65.4434, reason: 'Isabela Segunda, Vieques, Puerto Rico' },
  'GUVATE': { lat: 18.1952, lng: -66.0324, reason: 'Guyate, Puerto Rico' },
  'NEAR RAMEY': { lat: 18.4950, lng: -67.1294, reason: 'Near Ramey Air Force Base, Puerto Rico' },
  'NEAR ST. CROIX': { lat: 17.7478, lng: -64.7054, reason: 'Near St. Croix, US Virgin Islands' },
  
  // Border areas
  'Canada/US borde': { lat: 49.0, lng: -95.0, reason: 'US-Canada border (central point)' },
  
  // Pacific Ocean
  'CHUUK ISLAND': { lat: 7.4256, lng: 151.8474, reason: 'Chuuk Island, Micronesia' },
  'OFF COAST': { lat: 20.0, lng: -157.0, reason: 'Pacific Ocean off coast' },
  
  // Missing aircraft - use last known location approximation
  'MISSING ACFT': { lat: 25.0, lng: -70.0, reason: 'Missing aircraft (location unknown)' },
};

async function geocodeEstimated() {
  console.log('🌍 Geocoding 33 remaining accidents with estimated coordinates\n');
  
  // Get all accidents without coordinates
  const result = await pool.query(`
    SELECT id, ntsb_number, city, state, country
    FROM accidents
    WHERE latitude IS NULL
    ORDER BY event_date DESC
  `);
  
  console.log(`Found ${result.rows.length} accidents to process\n`);
  
  let success = 0;
  let failed = 0;
  
  for (const record of result.rows) {
    const location = [record.city, record.state, record.country].filter(Boolean).join(', ');
    
    // Find matching pattern in our lookup table
    let coords = null;
    let matchedPattern = null;
    
    for (const [pattern, data] of Object.entries(ESTIMATED_COORDS)) {
      if (location.toUpperCase().includes(pattern.toUpperCase())) {
        coords = data;
        matchedPattern = pattern;
        break;
      }
    }
    
    // Special handling for "MISSING ACFT"
    if (!coords && location.includes('MISSING')) {
      coords = ESTIMATED_COORDS['MISSING ACFT'];
      matchedPattern = 'MISSING ACFT';
    }
    
    if (coords) {
      try {
        await pool.query(`
          UPDATE accidents 
          SET latitude = $1, longitude = $2, location_estimated = true 
          WHERE id = $3
        `, [coords.lat, coords.lng, record.id]);
        
        console.log(`✓ ${record.ntsb_number}: ${location}`);
        console.log(`  → Estimated: ${coords.lat}, ${coords.lng} (${coords.reason})`);
        success++;
      } catch (err) {
        console.error(`✗ Error updating ${record.ntsb_number}:`, err.message);
        failed++;
      }
    } else {
      console.log(`✗ ${record.ntsb_number}: ${location} - NO MATCH FOUND`);
      failed++;
    }
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  
  await pool.end();
}

geocodeEstimated().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

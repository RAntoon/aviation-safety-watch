const { Pool } = require('pg');
const https = require('https');

// Your database connection string
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL or POSTGRES_URL environment variable not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helper function to geocode an address
async function geocode(city, state, country) {
  if (!city && !state) return null;
  
  // For international accidents (country != 'USA'), the state field often contains
  // the 2-letter country code. Use that instead of 'OF' or null country.
  let locationQuery;
  if (country === 'USA') {
    // US accidents: use city, state, USA
    locationQuery = [city, state, country].filter(Boolean).join(", ");
  } else {
    // International accidents: state field is actually the country code
    // Try city + country code from state field
    if (state && state.length === 2) {
      locationQuery = [city, state].filter(Boolean).join(", ");
    } else {
      // Fallback to just city name - OpenStreetMap is good at finding major cities
      locationQuery = city;
    }
  }
  
  if (!locationQuery) return null;
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(locationQuery)}&limit=1`;
    
    https.get(url, {
      headers: { 'User-Agent': 'AviationSafetyWatch/1.0' }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results.length > 0) {
            resolve({
              latitude: parseFloat(results[0].lat),
              longitude: parseFloat(results[0].lon),
            });
          } else {
            resolve(null);
          }
        } catch (err) {
          console.error('  ⚠️ Geocoding failed:', err.message);
          resolve(null);
        }
      });
    }).on('error', (err) => {
      console.error('  ⚠️ Geocoding error:', err.message);
      resolve(null);
    });
  });
}

async function geocodeMissingCoordinates() {
  console.log('🚀 Starting geocoding of accidents with missing coordinates...\n');
  
  try {
    // Get accidents without coordinates but with location data
    const query = `
      SELECT id, ntsb_number, city, state, country, event_date
      FROM accidents
      WHERE (latitude IS NULL OR longitude IS NULL)
        AND (city IS NOT NULL OR state IS NOT NULL)
      ORDER BY event_date DESC
    `;
    
    const result = await pool.query(query);
    const accidents = result.rows;
    
    console.log(`📍 Found ${accidents.length} accidents missing coordinates\n`);
    
    if (accidents.length === 0) {
      console.log('✅ All accidents with location data already have coordinates!');
      await pool.end();
      return;
    }
    
    let geocoded = 0;
    let failed = 0;
    let processed = 0;
    
    for (const accident of accidents) {
      processed++;
      
      const { id, ntsb_number, city, state, country, event_date } = accident;
      
      // Show progress every 50 records
      if (processed % 50 === 0) {
        console.log(`\n📊 Progress: ${processed}/${accidents.length} (${Math.round(processed/accidents.length*100)}%)`);
        console.log(`   ✅ Geocoded: ${geocoded} | ❌ Failed: ${failed}\n`);
      }
      
      try {
        const coords = await geocode(city, state, country);
        
        if (coords) {
          // Update the database with new coordinates
          await pool.query(
            'UPDATE accidents SET latitude = $1, longitude = $2 WHERE id = $3',
            [coords.latitude, coords.longitude, id]
          );
          
          console.log(`✅ ${ntsb_number} - ${city}, ${state} → [${coords.latitude}, ${coords.longitude}]`);
          geocoded++;
          
          // Rate limit: 1 request per second to be nice to OpenStreetMap
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`⚠️ ${ntsb_number} - ${city}, ${state} → Could not geocode`);
          failed++;
        }
      } catch (err) {
        console.error(`❌ Error geocoding ${ntsb_number}:`, err.message);
        failed++;
      }
    }
    
    await pool.end();
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Geocoding Summary:');
    console.log('='.repeat(60));
    console.log(`Total processed:      ${processed}`);
    console.log(`✅ Successfully geocoded: ${geocoded}`);
    console.log(`❌ Failed to geocode:     ${failed}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Fatal error:', error);
    await pool.end();
    process.exit(1);
  }
}

geocodeMissingCoordinates();
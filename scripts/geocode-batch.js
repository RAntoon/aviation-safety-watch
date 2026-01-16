const { Pool } = require('pg');
const https = require('https');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Using Nominatim (OpenStreetMap) - free, 1 request/second limit
async function geocode(city, state, country) {
  return new Promise((resolve) => {
    // Build query
    const parts = [city, state, country].filter(Boolean);
    if (parts.length === 0) {
      resolve(null);
      return;
    }
    
    const query = parts.join(', ');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    
    https.get(url, {
      headers: {
        'User-Agent': 'AviationSafetyWatch/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(data);
          if (results && results[0]) {
            resolve({
              lat: parseFloat(results[0].lat),
              lng: parseFloat(results[0].lon)
            });
          } else {
            resolve(null);
          }
        } catch (err) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

// Sleep function to respect rate limits (1 request/second)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeBatch() {
  console.log('🌍 Starting geocoding batch: 1982-2026 records without coordinates\n');
  
  // Get records without coordinates from 1982 onwards
  const result = await pool.query(`
    SELECT id, ntsb_number, city, state, country
    FROM accidents
    WHERE latitude IS NULL
      AND event_date >= '1982-01-01'
      AND (city IS NOT NULL OR state IS NOT NULL OR country IS NOT NULL)
    ORDER BY event_date DESC
    LIMIT 5000
  `);
  
  console.log(`Found ${result.rows.length} records to geocode\n`);
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  
  for (let i = 0; i < result.rows.length; i++) {
    const record = result.rows[i];
    
    // Progress indicator
    if ((i + 1) % 100 === 0) {
      console.log(`Progress: ${i + 1}/${result.rows.length} (Success: ${success}, Failed: ${failed}, Skipped: ${skipped})`);
    }
    
    // Skip if no location data
    if (!record.city && !record.state && !record.country) {
      skipped++;
      continue;
    }
    
    // Geocode
    const coords = await geocode(record.city, record.state, record.country);
    
    if (coords) {
      try {
        await pool.query(
          'UPDATE accidents SET latitude = $1, longitude = $2 WHERE id = $3',
          [coords.lat, coords.lng, record.id]
        );
        success++;
      } catch (err) {
        console.error(`Error updating ${record.ntsb_number}:`, err.message);
        failed++;
      }
    } else {
      failed++;
    }
    
    // Respect rate limit: 1 request per second
    await sleep(1100);
  }
  
  console.log('\n✅ Geocoding complete!');
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Estimated time taken: ${Math.round((result.rows.length * 1.1) / 60)} minutes`);
  
  await pool.end();
}

geocodeBatch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
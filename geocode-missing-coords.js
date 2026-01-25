const { Pool } = require('pg');
const https = require('https');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

// Map NTSB country codes to full country names
const COUNTRY_CODES = {
  'AG': 'Algeria',
  'AR': 'Argentina',
  'AU': 'Australia',
  'BL': 'Bolivia',
  'BR': 'Brazil',
  'CA': 'Canada',
  'CI': 'Chile',
  'CO': 'Colombia',
  'EC': 'Ecuador',
  'IT': 'Italy',
  'JA': 'Japan',
  'KS': 'South Korea',
  'MX': 'Mexico',
  'OF': null, // "Other Foreign" - skip this
  'PE': 'Peru',
  'PM': 'Panama',
  'RS': 'Russia',
  'SP': 'Spain',
  'UK': 'United Kingdom',
  'UP': 'Ukraine',
  'VE': 'Venezuela',
};

// Using Nominatim (OpenStreetMap) - free, 1 request/second limit
async function geocode(city, state, countryCode) {
  return new Promise((resolve) => {
    // Map country code to full name
    const country = COUNTRY_CODES[countryCode] || countryCode;
    
    // Build query with fallback strategies
    const queries = [];
    
    // Strategy 1: Full location (city, state, country)
    if (city && state && country) {
      queries.push([city, state, country].join(', '));
    }
    
    // Strategy 2: City and country (skip state if it's weird)
    if (city && country) {
      queries.push([city, country].join(', '));
    }
    
    // Strategy 3: State and country
    if (state && country && state !== 'OF') {
      queries.push([state, country].join(', '));
    }
    
    // Strategy 4: Just country (last resort)
    if (country) {
      queries.push(country);
    }
    
    if (queries.length === 0) {
      resolve(null);
      return;
    }
    
    // Try each query strategy until one works
    tryNextQuery(0);
    
    function tryNextQuery(index) {
      if (index >= queries.length) {
        resolve(null);
        return;
      }
      
      const query = queries[index];
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
                lng: parseFloat(results[0].lon),
                strategy: index + 1,
                query: query
              });
            } else {
              // Try next strategy
              tryNextQuery(index + 1);
            }
          } catch (err) {
            tryNextQuery(index + 1);
          }
        });
      }).on('error', () => tryNextQuery(index + 1));
    }
  });
}

// Sleep function to respect rate limits (1 request/second)
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function geocodeBatch() {
  console.log('🌍 Starting improved geocoding: International locations\n');
  
  // Get records without coordinates
  const result = await pool.query(`
    SELECT id, ntsb_number, city, state, country, event_date
    FROM accidents
    WHERE latitude IS NULL
      AND (city IS NOT NULL OR state IS NOT NULL OR country IS NOT NULL)
    ORDER BY event_date DESC
    LIMIT 5000
  `);
  
  console.log(`Found ${result.rows.length} records to geocode\n`);
  
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const strategies = [0, 0, 0, 0]; // Track which strategy worked
  
  for (let i = 0; i < result.rows.length; i++) {
    const record = result.rows[i];
    
    // Progress indicator
    if ((i + 1) % 50 === 0) {
      console.log(`Progress: ${i + 1}/${result.rows.length} | Success: ${success} (S1:${strategies[0]}, S2:${strategies[1]}, S3:${strategies[2]}, S4:${strategies[3]}) | Failed: ${failed}`);
    }
    
    // Skip if no location data
    if (!record.city && !record.state && !record.country) {
      skipped++;
      continue;
    }
    
    // Geocode with multiple strategies
    const coords = await geocode(record.city, record.state, record.country);
    
    if (coords) {
      try {
        await pool.query(
          'UPDATE accidents SET latitude = $1, longitude = $2 WHERE id = $3',
          [coords.lat, coords.lng, record.id]
        );
        success++;
        strategies[coords.strategy - 1]++;
        
        // Log successful geocodes with their strategy
        if (success <= 10 || success % 100 === 0) {
          console.log(`  ✓ ${record.ntsb_number}: "${coords.query}" (Strategy ${coords.strategy})`);
        }
      } catch (err) {
        console.error(`  ✗ Error updating ${record.ntsb_number}:`, err.message);
        failed++;
      }
    } else {
      failed++;
      if (failed <= 10) {
        const loc = [record.city, record.state, record.country].filter(Boolean).join(', ');
        console.log(`  ✗ Could not geocode: ${record.ntsb_number} | ${loc}`);
      }
    }
    
    // Respect rate limit: 1 request per second
    await sleep(1100);
  }
  
  console.log('\n✅ Geocoding complete!');
  console.log(`Success: ${success}`);
  console.log(`  Strategy 1 (city+state+country): ${strategies[0]}`);
  console.log(`  Strategy 2 (city+country): ${strategies[1]}`);
  console.log(`  Strategy 3 (state+country): ${strategies[2]}`);
  console.log(`  Strategy 4 (country only): ${strategies[3]}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Estimated time: ${Math.round((result.rows.length * 1.1) / 60)} minutes`);
  
  await pool.end();
}

geocodeBatch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
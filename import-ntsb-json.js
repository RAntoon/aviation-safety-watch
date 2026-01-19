const { Pool } = require('pg');
const fs = require('fs');
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
  
  const query = [city, state, country].filter(Boolean).join(", ");
  
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    
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

async function importAccidents(jsonFilePath) {
  console.log('🚀 Starting NTSB JSON import...\n');
  
  // Read JSON file
  const data = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));
  console.log(`📁 Found ${data.length} accidents in JSON file\n`);
  
  let inserted = 0;
  let skipped = 0;
  let geocoded = 0;
  let futureSkipped = 0;
  
  for (const accident of data) {
    try {
      const ntsbNumber = accident.cm_ntsbNum;
      const eventDate = accident.cm_eventDate;
      const city = accident.cm_city;
      const state = accident.cm_state;
      const country = accident.cm_country;
      const highestInjury = accident.cm_highestInjury;
      const eventType = accident.cm_eventType;
      const mkey = accident.cm_mkey;
      const latitude = accident.cm_Latitude;
      const longitude = accident.cm_Longitude;
      
      if (!ntsbNumber) {
        console.log(`⚠️ Skipping accident without NTSB number`);
        skipped++;
        continue;
      }
      
      // Parse and validate event date
      let parsedDate = null;
      if (eventDate) {
        parsedDate = new Date(eventDate).toISOString().split('T')[0];
        
        // Check if date is in the future
        const today = new Date().toISOString().split('T')[0];
        if (parsedDate > today) {
          console.log(`⚠️ Skipping ${ntsbNumber} - future date: ${parsedDate}`);
          futureSkipped++;
          continue;
        }
      }
      
      // Check if already exists
      const existing = await pool.query(
        'SELECT ntsb_number FROM accidents WHERE ntsb_number = $1',
        [ntsbNumber]
      );
      
      if (existing.rows.length > 0) {
        console.log(`⏭️  ${ntsbNumber} - already exists in database`);
        skipped++;
        continue;
      }
      
      // Get aircraft info from first vehicle if available
      let aircraftMake = null;
      let aircraftModel = null;
      let registrationNumber = null;
      
      if (accident.cm_vehicles && accident.cm_vehicles.length > 0) {
        const vehicle = accident.cm_vehicles[0];
        aircraftMake = vehicle.make;
        aircraftModel = vehicle.model;
        registrationNumber = vehicle.registrationNumber;
      }
      
      // Geocode if we don't have coordinates
      let coords = null;
      if (latitude && longitude) {
        coords = { latitude, longitude };
      } else if (city || state) {
        console.log(`  🌍 Geocoding ${city}, ${state}, ${country}...`);
        coords = await geocode(city, state, country);
        if (coords) {
          geocoded++;
          // Rate limit to be nice to OpenStreetMap
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Insert into database
      await pool.query(
        `INSERT INTO accidents (
          ntsb_number, event_id, event_date, event_type,
          highest_injury, city, state, country,
          latitude, longitude,
          aircraft_make, aircraft_model, registration_number
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          ntsbNumber,
          mkey ? String(mkey) : null,
          parsedDate,
          eventType || null,
          highestInjury || null,
          city || null,
          state || null,
          country || 'USA',
          coords?.latitude || null,
          coords?.longitude || null,
          aircraftMake || null,
          aircraftModel || null,
          registrationNumber || null,
        ]
      );
      
      console.log(`✅ ${ntsbNumber} - ${city}, ${state} - ${parsedDate}`);
      inserted++;
      
    } catch (err) {
      console.error(`❌ Error processing ${accident.cm_ntsbNum}:`, err.message);
    }
  }
  
  await pool.end();
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Import Summary:');
  console.log('='.repeat(60));
  console.log(`Total in file:        ${data.length}`);
  console.log(`✅ Successfully inserted: ${inserted}`);
  console.log(`⏭️  Skipped (duplicates):  ${skipped}`);
  console.log(`⚠️  Skipped (future dates): ${futureSkipped}`);
  console.log(`🌍 Geocoded:             ${geocoded}`);
  console.log('='.repeat(60));
}

// Get file path from command line argument
const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node import-ntsb-json.js <path-to-json-file>');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

importAccidents(filePath).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
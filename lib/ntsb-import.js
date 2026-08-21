// ============================================================
// lib/ntsb-import.js
// ============================================================
// Shared NTSB import logic. Extracted from import-ntsb-json.js
// so both the manual CLI script AND the upcoming nightly cron
// can use the same insert / dedup / geocoding pipeline.
//
// Preserved exactly from the original script:
//   - Use cm_Latitude/cm_Longitude if NTSB provides them
//   - Fall back to Nominatim geocoding only when missing
//   - Dedup by ntsb_number (skip records already in DB)
//   - Skip records with event dates in the future (bad NTSB data)
//   - Per-record emoji logging (✅ / ⏭️ / ⚠️ / 🌍)
//   - Summary block at the end
//
// Public API:
//   importRecords(records, options?) -> summary object
//   geocode(city, state, country) -> { latitude, longitude } | null
// ============================================================

const { Pool } = require('pg');
const https = require('https');

// ------------------------------------------------------------
// Geocoder
// ------------------------------------------------------------
// Identical to the geocode() function in the original script:
// Nominatim, 1-request-per-second rate limit enforced by the
// caller, same User-Agent, same null-on-failure behavior.
// ------------------------------------------------------------
function geocode(city, state, country) {
  if (!city && !state) return Promise.resolve(null);

  const query = [city, state, country].filter(Boolean).join(', ');

  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;

    https
      .get(
        url,
        { headers: { 'User-Agent': 'AviationSafetyWatch/1.0' } },
        (res) => {
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
        }
      )
      .on('error', (err) => {
        console.error('  ⚠️ Geocoding error:', err.message);
        resolve(null);
      });
  });
}

// ------------------------------------------------------------
// Main import function
// ------------------------------------------------------------
// records: Array of NTSB records in `cm_*` format (the exact shape
//   the CAROL FileExport API and your manual JSON downloads use).
//
// options:
//   - pool?: pg.Pool    If provided, use this pool and don't close
//                       it at the end (caller manages lifecycle).
//                       If omitted, we create our own and close it
//                       when finished.
//
// Returns: {
//   total: number,          // records seen in input
//   inserted: number,       // new rows added to DB
//   skipped: number,        // duplicates or malformed, not inserted
//   futureSkipped: number,  // skipped for having a future event date
//   geocoded: number        // rows where Nominatim gave us coords
// }
// ------------------------------------------------------------
async function importRecords(records, options = {}) {
  if (!Array.isArray(records)) {
    throw new Error('importRecords: `records` must be an array');
  }

  // Pool ownership: if caller passed one, we don't close it. Otherwise
  // we create our own and close at the end. This lets the manual CLI
  // keep its self-contained behavior while a future cron can share
  // a pool across multiple operations.
  const ownsPool = !options.pool;
  const pool =
    options.pool ||
    new Pool({
      connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false },
    });

  let inserted = 0;
  let skipped = 0;
  let geocoded = 0;
  let futureSkipped = 0;

  try {
    for (const accident of records) {
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

        // Coordinates: use NTSB's if provided, otherwise geocode
        let coords = null;
        if (latitude && longitude) {
          coords = { latitude, longitude };
        } else if (city || state) {
          console.log(`  🌍 Geocoding ${city}, ${state}, ${country}...`);
          coords = await geocode(city, state, country);
          if (coords) {
            geocoded++;
            // Rate limit — be nice to OpenStreetMap
            await new Promise((resolve) => setTimeout(resolve, 1000));
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
        console.error(
          `❌ Error processing ${accident.cm_ntsbNum}:`,
          err.message
        );
      }
    }
  } finally {
    if (ownsPool) {
      await pool.end();
    }
  }

  // Summary — same format as the original script
  console.log('\n' + '='.repeat(60));
  console.log('📊 Import Summary:');
  console.log('='.repeat(60));
  console.log(`Total in file:        ${records.length}`);
  console.log(`✅ Successfully inserted: ${inserted}`);
  console.log(`⏭️  Skipped (duplicates):  ${skipped}`);
  console.log(`⚠️  Skipped (future dates): ${futureSkipped}`);
  console.log(`🌍 Geocoded:             ${geocoded}`);
  console.log('='.repeat(60));

  return {
    total: records.length,
    inserted,
    skipped,
    futureSkipped,
    geocoded,
  };
}

module.exports = {
  geocode,
  importRecords,
};

/**
 * Enhanced Import with Geocoding
 * 
 * This script imports ALL accident records, including those without coordinates.
 * For records with city/state/country but no coordinates, it geocodes them using
 * your existing KV cache + Nominatim (same as your live website).
 * 
 * Usage: node scripts/import-with-geocoding.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Progress tracking
let stats = {
  totalFiles: 0,
  filesProcessed: 0,
  totalRecords: 0,
  recordsImported: 0,
  recordsSkipped: 0,
  recordsFailed: 0,
  geocoded: 0,
  cacheHits: 0,
  startTime: Date.now()
};

// Geocoding budget (rate limiting)
const geocodeBudget = { remaining: 50 }; // Increased from 25

// KV setup
const KV_URL = process.env.KV_REST_API_URL || process.env.KV_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";
const KV_ENABLED = Boolean(KV_URL && KV_TOKEN);

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function toNumber(value, defaultValue = null) {
  if (value === null || value === undefined) return defaultValue;
  if (typeof value === 'string' && value.trim() === '') return defaultValue;
  const num = Number(value);
  // Check for obviously bad coordinates (like those 364617 values)
  if (num > 180 || num < -180) return defaultValue;
  return isFinite(num) ? num : defaultValue;
}

function determineHighestInjury(row) {
  const fatalCount = toNumber(row?.cm_fatalInjuryCount, 0) || 
                     toNumber(row?.cm_injury_onboard_Fatal, 0) || 
                     toNumber(row?.cm_injury_onground_Fatal, 0);
  
  if (fatalCount > 0 || String(row?.cm_highestInjury || '').toLowerCase() === 'fatal') {
    return 'Fatal';
  }
  
  const highestInjury = String(row?.cm_highestInjury || '').trim();
  if (highestInjury) return highestInjury;
  
  return 'None';
}

function extractAircraftInfo(row) {
  const vehicles = row?.cm_vehicles;
  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    return {
      make: null,
      model: null,
      category: null,
      registrationNumber: null,
      damageLevel: null,
      operatorName: null
    };
  }

  const vehicle = vehicles[0];
  return {
    make: vehicle?.make ? String(vehicle.make).trim() : null,
    model: vehicle?.model ? String(vehicle.model).trim() : null,
    category: vehicle?.aircraftCategory ? String(vehicle.aircraftCategory).trim() : null,
    registrationNumber: vehicle?.registrationNumber ? String(vehicle.registrationNumber).trim() : null,
    damageLevel: vehicle?.DamageLevel ? String(vehicle.DamageLevel).trim() : null,
    operatorName: vehicle?.operatorName ? String(vehicle.operatorName).trim() : null
  };
}

// KV functions (copied from your route.ts)
async function kvGetJson(key) {
  if (!KV_ENABLED) return null;
  try {
    const url = `${KV_URL}/get/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.result;
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function kvSetJson(key, value) {
  if (!KV_ENABLED) return;
  try {
    const payload = JSON.stringify(value);
    const url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(payload)}`;
    await fetch(url, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: 'no-store',
    });
  } catch (err) {
    // Silently fail
  }
}

function locationKey(row) {
  const city = row?.cm_city ? String(row.cm_city).trim() : "";
  const state = row?.cm_state ? String(row.cm_state).trim() : "";
  const country = row?.cm_country ? String(row.cm_country).trim() : "";
  const parts = [city, state, country].filter(Boolean);
  if (parts.length < 2) return null;
  return parts.join(", ").toLowerCase();
}

function locationLabel(row) {
  const city = row?.cm_city ? String(row.cm_city).trim() : "";
  const state = row?.cm_state ? String(row.cm_state).trim() : "";
  const country = row?.cm_country ? String(row.cm_country).trim() : "";
  const parts = [city, state, country].filter(Boolean);
  if (parts.length < 2) return null;
  return parts.join(", ");
}

async function geocodeWithNominatim(query) {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    `format=json&limit=1&addressdetails=0&q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AviationSafetyWatch/2.0 (enhanced-import; contact: admin@aviationsafetywatch.com)",
        "Accept-Language": "en",
      },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    const lat = toNumber(arr[0]?.lat);
    const lng = toNumber(arr[0]?.lon);
    if (!lat || !lng) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}

async function getCoordsForRow(row) {
  const key = locationKey(row);
  const label = locationLabel(row);
  if (!key || !label) return null;

  const cacheKey = `geo:${key}`;

  // Check cache first
  const cached = await kvGetJson(cacheKey);
  if (cached && cached.lat && cached.lng) {
    stats.cacheHits++;
    return cached;
  }

  // No cache: geocode if we have budget
  if (geocodeBudget.remaining <= 0) {
    console.log(`  â„¹ï¸  Geocoding budget exhausted. Skipping geocoding for remaining records.`);
    return null;
  }

  geocodeBudget.remaining--;
  
  // Add small delay to respect Nominatim rate limits (1 request per second)
  await new Promise(resolve => setTimeout(resolve, 1100));

  const result = await geocodeWithNominatim(label);
  if (!result) return null;

  stats.geocoded++;
  await kvSetJson(cacheKey, result);

  return result;
}

async function importRecord(pool, row, fileSource) {
  try {
    const aircraft = extractAircraftInfo(row);
    const eventDate = parseDate(row?.cm_eventDate);
    
    if (!eventDate) {
      stats.recordsSkipped++;
      return false;
    }

    // Try to get coordinates
    let lat = toNumber(row?.cm_Latitude);
    let lng = toNumber(row?.cm_Longitude);
    let hasCoords = lat !== null && lng !== null;

    // If no coords, try geocoding from city/state/country
    if (!hasCoords) {
      const geocoded = await getCoordsForRow(row);
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
        hasCoords = true;
      }
    }

    // Import even without coordinates (they just won't show on map)
    const query = `
      INSERT INTO accidents (
        cm_mkey, ntsb_number, event_date, event_type, highest_injury,
        latitude, longitude, city, state, country, airport_id, airport_name,
        fatal_count, serious_injury_count, minor_injury_count,
        prelim_narrative, factual_narrative, analysis_narrative, probable_cause,
        is_closed, completion_status,
        aircraft_make, aircraft_model, aircraft_category, registration_number, damage_level,
        operator_name, original_published_date, most_recent_report_type
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15,
        $16, $17, $18, $19,
        $20, $21,
        $22, $23, $24, $25, $26,
        $27, $28, $29
      )
      ON CONFLICT (ntsb_number) DO UPDATE SET
        cm_mkey = EXCLUDED.cm_mkey,
        event_date = EXCLUDED.event_date,
        event_type = EXCLUDED.event_type,
        highest_injury = EXCLUDED.highest_injury,
        latitude = COALESCE(EXCLUDED.latitude, accidents.latitude),
        longitude = COALESCE(EXCLUDED.longitude, accidents.longitude),
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        country = EXCLUDED.country,
        airport_id = EXCLUDED.airport_id,
        airport_name = EXCLUDED.airport_name,
        fatal_count = EXCLUDED.fatal_count,
        serious_injury_count = EXCLUDED.serious_injury_count,
        minor_injury_count = EXCLUDED.minor_injury_count,
        prelim_narrative = EXCLUDED.prelim_narrative,
        factual_narrative = EXCLUDED.factual_narrative,
        analysis_narrative = EXCLUDED.analysis_narrative,
        probable_cause = EXCLUDED.probable_cause,
        is_closed = EXCLUDED.is_closed,
        completion_status = EXCLUDED.completion_status,
        aircraft_make = EXCLUDED.aircraft_make,
        aircraft_model = EXCLUDED.aircraft_model,
        aircraft_category = EXCLUDED.aircraft_category,
        registration_number = EXCLUDED.registration_number,
        damage_level = EXCLUDED.damage_level,
        operator_name = EXCLUDED.operator_name,
        original_published_date = EXCLUDED.original_published_date,
        most_recent_report_type = EXCLUDED.most_recent_report_type
    `;

    const values = [
      toNumber(row?.cm_mkey, null),
      row?.cm_ntsbNum ? String(row.cm_ntsbNum).trim() : null,
      eventDate,
      row?.cm_eventType ? String(row.cm_eventType).trim() : null,
      determineHighestInjury(row),
      lat,
      lng,
      row?.cm_city ? String(row.cm_city).trim() : null,
      row?.cm_state ? String(row.cm_state).trim() : null,
      row?.cm_country ? String(row.cm_country).trim() : null,
      row?.airportId ? String(row.airportId).trim() : null,
      row?.airportName ? String(row.airportName).trim() : null,
      toNumber(row?.cm_fatalInjuryCount, 0),
      toNumber(row?.cm_seriousInjuryCount, 0),
      toNumber(row?.cm_minorInjuryCount, 0),
      row?.prelimNarrative ? String(row.prelimNarrative).substring(0, 5000) : null,
      row?.factualNarrative ? String(row.factualNarrative).substring(0, 5000) : null,
      row?.analysisNarrative ? String(row.analysisNarrative).substring(0, 5000) : null,
      row?.cm_probableCause ? String(row.cm_probableCause).substring(0, 2000) : null,
      row?.cm_closed === true,
      row?.cm_completionStatus ? String(row.cm_completionStatus).trim() : null,
      aircraft.make,
      aircraft.model,
      aircraft.category,
      aircraft.registrationNumber,
      aircraft.damageLevel,
      aircraft.operatorName,
      parseDate(row?.cm_originalPublishedDate),
      row?.cm_mostRecentReportType ? String(row.cm_mostRecentReportType).trim() : null
    ];

    await pool.query(query, values);
    stats.recordsImported++;
    return true;

  } catch (error) {
    stats.recordsFailed++;
    if (error.message.includes('numeric field overflow') || error.message.includes('value too long')) {
      // Silently skip these - they're data quality issues from NTSB
    } else {
      console.error(`  âš ï¸  Failed to import record ${row?.cm_ntsbNum || 'unknown'}: ${error.message}`);
    }
    return false;
  }
}

async function processJsonFile(pool, filePath) {
  const fileName = path.basename(filePath);
  console.log(`\nðŸ“„ Processing: ${fileName}`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    
    if (!Array.isArray(data)) {
      console.error(`  âŒ File does not contain an array of records`);
      return;
    }

    stats.totalRecords += data.length;
    console.log(`  Found ${data.length.toLocaleString()} records`);

    let imported = 0;
    const batchSize = 100;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      for (const row of batch) {
        await importRecord(pool, row, fileName);
      }
      
      imported = Math.min(i + batchSize, data.length);
      process.stdout.write(`\r  Progress: ${imported.toLocaleString()}/${data.length.toLocaleString()} records`);
    }
    
    console.log(`\n  âœ“ Completed: ${fileName}`);
    stats.filesProcessed++;

  } catch (error) {
    console.error(`\n  âŒ Error processing file: ${error.message}`);
  }
}

async function importAllData() {
  console.log('ðŸš€ Starting Enhanced NTSB Data Import with Geocoding\n');
  console.log('This will import ALL records, including those without coordinates.');
  console.log('Records with city/state will be geocoded automatically.\n');

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!databaseUrl) {
    console.error('âŒ ERROR: DATABASE_URL not found');
    process.exit(1);
  }

  if (!KV_ENABLED) {
    console.warn('âš ï¸  WARNING: KV not configured. Geocoding cache will not work.');
    console.warn('   Every run will geocode from scratch (slow!).\n');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 20
  });

  try {
    console.log('ðŸ”Œ Testing database connection...');
    await pool.query('SELECT 1');
    console.log('âœ“ Database connected\n');

    const dataDir = path.join(process.cwd(), 'data');
    
    if (!fs.existsSync(dataDir)) {
      console.error(`âŒ Data directory not found: ${dataDir}`);
      process.exit(1);
    }

    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json') && f.startsWith('accidents_'))
      .map(f => path.join(dataDir, f))
      .sort();

    stats.totalFiles = files.length;
    console.log(`Found ${stats.totalFiles} JSON files to process\n`);

    if (stats.totalFiles === 0) {
      console.error('âŒ No accident JSON files found');
      process.exit(1);
    }

    for (const file of files) {
      await processJsonFile(pool, file);
    }

    const duration = Math.round((Date.now() - stats.startTime) / 1000);
    console.log('\n' + '='.repeat(60));
    console.log('ðŸŽ‰ Enhanced Import Complete!\n');
    console.log(`Files processed: ${stats.filesProcessed}/${stats.totalFiles}`);
    console.log(`Total records: ${stats.totalRecords.toLocaleString()}`);
    console.log(`âœ“ Imported: ${stats.recordsImported.toLocaleString()}`);
    console.log(`ðŸ“ Geocoded: ${stats.geocoded.toLocaleString()}`);
    console.log(`ðŸ’¾ Cache hits: ${stats.cacheHits.toLocaleString()}`);
    console.log(`âŠ˜ Skipped: ${stats.recordsSkipped.toLocaleString()}`);
    console.log(`âœ— Failed: ${stats.recordsFailed.toLocaleString()}`);
    console.log(`â±ï¸  Duration: ${duration} seconds (${Math.round(duration/60)} minutes)`);
    console.log('='.repeat(60) + '\n');

    await pool.query(`
      INSERT INTO import_log (
        file_name, records_processed, records_imported, 
        records_failed, duration_seconds
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      'enhanced_import_with_geocoding',
      stats.totalRecords,
      stats.recordsImported,
      stats.recordsFailed,
      duration
    ]);

  } catch (error) {
    console.error('âŒ Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

importAllData();
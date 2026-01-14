/**
 * Import NTSB Data from Vercel Blob to Database
 * 
 * This script reads all your JSON files from Vercel Blob storage
 * and imports them into the Postgres database.
 * 
 * Usage: node scripts/import-from-blob.js
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
  startTime: Date.now()
};

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function toNumber(value, defaultValue = 0) {
  if (value === null || value === undefined) return defaultValue;
  const num = Number(value);
  return isFinite(num) ? num : defaultValue;
}

function determineHighestInjury(row) {
  const fatalCount = toNumber(row?.cm_fatalInjuryCount) || 
                     toNumber(row?.cm_injury_onboard_Fatal) || 
                     toNumber(row?.cm_injury_onground_Fatal);
  
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
      damageLevel: null
    };
  }

  const vehicle = vehicles[0];
  return {
    make: vehicle?.make ? String(vehicle.make).trim() : null,
    model: vehicle?.model ? String(vehicle.model).trim() : null,
    category: vehicle?.aircraftCategory ? String(vehicle.aircraftCategory).trim() : null,
    registrationNumber: vehicle?.registrationNumber ? String(vehicle.registrationNumber).trim() : null,
    damageLevel: vehicle?.DamageLevel ? String(vehicle.DamageLevel).trim() : null
  };
}

async function importRecord(pool, row, fileSource) {
  try {
    const aircraft = extractAircraftInfo(row);
    const eventDate = parseDate(row?.cm_eventDate);
    
    if (!eventDate) {
      stats.recordsSkipped++;
      return false;
    }

    // Check for required coordinates
    const lat = toNumber(row?.cm_Latitude, null);
    const lng = toNumber(row?.cm_Longitude, null);
    
    // We'll allow records without coordinates (they can be geocoded later)
    // but we need at least a date and case number

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
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
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
      toNumber(row?.cm_fatalInjuryCount),
      toNumber(row?.cm_seriousInjuryCount),
      toNumber(row?.cm_minorInjuryCount),
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
      row?.cm_vehicles?.[0]?.operatorName ? String(row.cm_vehicles[0].operatorName).trim() : null,
      parseDate(row?.cm_originalPublishedDate),
      row?.cm_mostRecentReportType ? String(row.cm_mostRecentReportType).trim() : null
    ];

    await pool.query(query, values);
    stats.recordsImported++;
    return true;

  } catch (error) {
    stats.recordsFailed++;
    console.error(`  ⚠️  Failed to import record ${row?.cm_ntsbNum || 'unknown'}: ${error.message}`);
    return false;
  }
}

async function processJsonFile(pool, filePath) {
  const fileName = path.basename(filePath);
  console.log(`\n📄 Processing: ${fileName}`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    
    if (!Array.isArray(data)) {
      console.error(`  ❌ File does not contain an array of records`);
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
    
    console.log(`\n  ✓ Completed: ${fileName}`);
    stats.filesProcessed++;

  } catch (error) {
    console.error(`\n  ❌ Error processing file: ${error.message}`);
  }
}

async function importAllData() {
  console.log('🚀 Starting NTSB Data Import\n');
  console.log('This will import all JSON files into the database.');
  console.log('This may take 10-20 minutes depending on file sizes.\n');

  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  
  if (!databaseUrl) {
    console.error('❌ ERROR: DATABASE_URL not found');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 20 // Allow more concurrent connections for faster import
  });

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log('✓ Database connected\n');

    // Get all JSON files from data directory
    const dataDir = path.join(process.cwd(), 'data');
    
    if (!fs.existsSync(dataDir)) {
      console.error(`❌ Data directory not found: ${dataDir}`);
      console.error('Make sure you have a "data" folder with your JSON files');
      process.exit(1);
    }

    const files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('.json') && !f.includes('manifest'))
      .map(f => path.join(dataDir, f));

    stats.totalFiles = files.length;
    console.log(`Found ${stats.totalFiles} JSON files to process\n`);

    if (stats.totalFiles === 0) {
      console.error('❌ No JSON files found in data directory');
      process.exit(1);
    }

    // Process each file
    for (const file of files) {
      await processJsonFile(pool, file);
    }

    // Final statistics
    const duration = Math.round((Date.now() - stats.startTime) / 1000);
    console.log('\n' + '='.repeat(60));
    console.log('🎉 Import Complete!\n');
    console.log(`Files processed: ${stats.filesProcessed}/${stats.totalFiles}`);
    console.log(`Total records: ${stats.totalRecords.toLocaleString()}`);
    console.log(`✓ Imported: ${stats.recordsImported.toLocaleString()}`);
    console.log(`⊘ Skipped: ${stats.recordsSkipped.toLocaleString()}`);
    console.log(`✗ Failed: ${stats.recordsFailed.toLocaleString()}`);
    console.log(`⏱️  Duration: ${duration} seconds`);
    console.log('='.repeat(60) + '\n');

    // Log import to database
    await pool.query(`
      INSERT INTO import_log (
        file_name, records_processed, records_imported, 
        records_failed, duration_seconds
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      'bulk_import_all_files',
      stats.totalRecords,
      stats.recordsImported,
      stats.recordsFailed,
      duration
    ]);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the import
importAllData();

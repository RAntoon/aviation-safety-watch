// ============================================================
// import-ntsb-json.js  (v2 — thin wrapper)
// ============================================================
// Reads a CAROL JSON download from disk and hands the records to
// the shared import module (lib/ntsb-import.js). All the actual
// import/geocode/dedup logic lives in that module so the new
// nightly cron can reuse it.
//
// Your usage is UNCHANGED:
//   export $(cat .env.local | xargs) && \
//     node import-ntsb-json.js /path/to/accidents_update.json
//
// Output, behavior, and database end-state are identical to the
// previous version of this file.
// ============================================================

const fs = require('fs');
const path = require('path');

const { importRecords } = require('./lib/ntsb-import');

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node import-ntsb-json.js <path-to-json-file>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  console.log('🚀 Starting NTSB JSON import...\n');

  let records;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    records = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Could not read/parse JSON at ${filePath}`);
    console.error(err.message);
    process.exit(1);
  }

  if (!Array.isArray(records)) {
    console.error(
      `Error: Expected a JSON array at the top level, got ${typeof records}`
    );
    process.exit(1);
  }

  console.log(`📁 Found ${records.length} accidents in JSON file\n`);

  await importRecords(records);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

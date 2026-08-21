// ============================================================
// test-fileexport.js
// ============================================================
// PURPOSE: Confirm we can call NTSB's FileExport API, receive a
//   ZIP response, extract the JSON inside, and see records in the
//   same `cm_*` format that import-ntsb-json.js already consumes.
//
// WHAT IT DOES:
//   1. POSTs a date-range query to data.ntsb.gov's FileExport
//      endpoint asking for Aviation cases from the last 30 days.
//   2. Saves the returned ZIP to a temporary folder.
//   3. Uses macOS's built-in `unzip` to extract the JSON inside.
//   4. Parses the JSON and prints a summary: record count, a
//      sample record's fields, and how many records have coords.
//
// WHAT IT DOES NOT DO:
//   - Does not connect to your database.
//   - Does not modify any existing files.
//   - Does not require any env vars (no .env.local needed).
//   - Does not install any npm packages.
//
// HOW TO RUN (from your project root):
//   node test-fileexport.js
//
// EXPECTED OUTPUT:
//   A few log lines ending with something like:
//     ✓ Parsed JSON: 47 records
//     📋 Sample record fields: ...
//     🌍 Records with coordinates: 23 / 47
//
// IF IT FAILS:
//   Copy the full error output and send it to me. Do NOT proceed
//   to the next step.
// ============================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

// How many days back to query. Kept small so the response is fast.
const DAYS_BACK = 30;

async function main() {
  // --- Build the date range ---
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - DAYS_BACK);

  const fmt = (d) => d.toISOString().split('T')[0];
  const startStr = fmt(startDate);
  const endStr = fmt(endDate);

  console.log(`\n📅 Querying NTSB FileExport for Aviation cases`);
  console.log(`   Date range: ${startStr} → ${endStr} (last ${DAYS_BACK} days)\n`);

  // --- Build the POST payload (matches CAROL's "Download JSON") ---
  const payload = {
    QueryGroups: [{
      QueryRules: [
        {
          RuleType: 'Simple',
          Values: [startStr],
          Columns: ['Event.EventDate'],
          Operator: 'is on or after',
          selectedOption: {
            FieldName: 'EventDate',
            DisplayText: 'Event date',
            Columns: ['Event.EventDate'],
            Selectable: true,
            InputType: 'Date',
            RuleType: 0,
            Options: null,
            TargetCollection: 'cases',
            UnderDevelopment: true,
          },
        },
        {
          RuleType: 'Simple',
          Values: [endStr],
          Columns: ['Event.EventDate'],
          Operator: 'is on or before',
          selectedOption: {
            FieldName: 'EventDate',
            DisplayText: 'Event date',
            Columns: ['Event.EventDate'],
            Selectable: true,
            InputType: 'Date',
            RuleType: 0,
            Options: null,
            TargetCollection: 'cases',
            UnderDevelopment: true,
          },
        },
        {
          RuleType: 'Simple',
          Values: ['Aviation'],
          Columns: ['Event.Mode'],
          Operator: 'is',
          selectedOption: {
            FieldName: 'Mode',
            DisplayText: 'Investigation mode',
            Columns: ['Event.Mode'],
            Selectable: true,
            InputType: 'Dropdown',
            RuleType: 0,
            Options: null,
            TargetCollection: 'cases',
            UnderDevelopment: true,
          },
        },
      ],
      AndOr: 'and',
      inLastSearch: false,
      editedSinceLastSearch: false,
    }],
    AndOr: 'and',
    TargetCollection: 'cases',
    ExportFormat: 'data',
    SessionId: Math.floor(Math.random() * 1000000),
    ResultSetSize: 500,
    SortDescending: true,
  };

  // --- Call the API ---
  console.log('🌐 POST https://data.ntsb.gov/carol-main-public/api/Query/FileExport');

  const response = await fetch(
    'https://data.ntsb.gov/carol-main-public/api/Query/FileExport',
    {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Content-Type': 'application/json',
        'Origin': 'https://data.ntsb.gov',
        'User-Agent': 'AviationSafetyWatch/1.0 (test)',
      },
      body: JSON.stringify(payload),
    }
  );

  console.log(`   Status: ${response.status}`);
  console.log(`   Content-Type: ${response.headers.get('content-type')}`);

  if (!response.ok) {
    console.error(`\n❌ Request failed (${response.status}).`);
    const text = await response.text();
    console.error('Response body (first 500 chars):');
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`   Downloaded ${buffer.length.toLocaleString()} bytes\n`);

  // --- Save ZIP to a temp folder ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntsb-test-'));
  const zipPath = path.join(tmpDir, 'export.zip');
  fs.writeFileSync(zipPath, buffer);

  // --- Extract using macOS's built-in unzip ---
  console.log('📦 Extracting ZIP...');
  try {
    execSync(`unzip -q -o "${zipPath}" -d "${tmpDir}"`);
  } catch (err) {
    console.error(`\n❌ Unzip failed. The response may not be a valid ZIP.`);
    console.error(`   ZIP saved at: ${zipPath}`);
    console.error(`   First 200 bytes as string:`, buffer.slice(0, 200).toString());
    process.exit(1);
  }

  // --- Find and parse the JSON file inside ---
  const files = fs.readdirSync(tmpDir);
  const jsonFile = files.find((f) => f.endsWith('.json'));

  if (!jsonFile) {
    console.error(`\n❌ No JSON file found in ZIP. Contents:`, files);
    process.exit(1);
  }

  console.log(`   Found JSON file: ${jsonFile}\n`);

  const jsonPath = path.join(tmpDir, jsonFile);
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // --- Summarize what we got ---
  console.log('='.repeat(60));
  console.log(`✓ Parsed JSON: ${data.length} records`);
  console.log('='.repeat(60));

  if (data.length > 0) {
    const sample = data[0];
    const hasExpectedFields =
      'cm_ntsbNum' in sample &&
      'cm_eventDate' in sample &&
      ('cm_city' in sample || 'cm_state' in sample);

    console.log('\n📋 Sample record (first in list):');
    console.log(`   cm_ntsbNum:   ${sample.cm_ntsbNum ?? '(missing)'}`);
    console.log(`   cm_eventDate: ${sample.cm_eventDate ?? '(missing)'}`);
    console.log(`   cm_city:      ${sample.cm_city ?? '(missing)'}`);
    console.log(`   cm_state:     ${sample.cm_state ?? '(missing)'}`);
    console.log(`   cm_country:   ${sample.cm_country ?? '(missing)'}`);
    console.log(`   cm_Latitude:  ${sample.cm_Latitude ?? '(missing)'}`);
    console.log(`   cm_Longitude: ${sample.cm_Longitude ?? '(missing)'}`);
    console.log(`   cm_highestInjury: ${sample.cm_highestInjury ?? '(missing)'}`);
    console.log(`   cm_vehicles count: ${(sample.cm_vehicles ?? []).length}`);

    const withCoords = data.filter(
      (r) => r.cm_Latitude != null && r.cm_Longitude != null
    ).length;
    console.log(`\n🌍 Records with coordinates: ${withCoords} / ${data.length}`);
    console.log(`   (the rest would need geocoding, same as today)`);

    console.log(`\n✓ Format check: ${hasExpectedFields ? 'PASSED' : 'FAILED'} — ${
      hasExpectedFields
        ? 'fields match what import-ntsb-json.js expects.'
        : 'sample record is missing expected fields; something changed.'
    }`);
  } else {
    console.log(
      '\n⚠️  Zero records returned. Not necessarily an error — could be no accidents'
    );
    console.log(
      '    in the window. Try increasing DAYS_BACK at the top of this script.'
    );
  }

  console.log(`\n📁 Extracted files kept at: ${tmpDir}`);
  console.log('   (you can inspect them or ignore them — macOS will clean up eventually)\n');
}

main().catch((err) => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});

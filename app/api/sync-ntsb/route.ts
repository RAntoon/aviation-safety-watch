import { NextResponse } from "next/server";
import { Pool } from "pg";

// Helper function to extract field value from NTSB's weird format
function getFieldValue(fields: any[], fieldName: string): any {
  const field = fields.find((f: any) => f.FieldName === fieldName);
  return field?.Values?.[0] || null;
}

// Helper function to geocode an address
async function geocode(city?: string, state?: string, country?: string) {
  if (!city && !state) return null;
  
  const query = [city, state, country].filter(Boolean).join(", ");
  
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { "User-Agent": "AviationSafetyWatch/1.0" } }
    );
    
    const results = await response.json();
    if (results.length > 0) {
      return {
        latitude: parseFloat(results[0].lat),
        longitude: parseFloat(results[0].lon),
      };
    }
  } catch (err) {
    console.error("Geocoding failed:", err);
  }
  
  return null;
}

export async function GET(request: Request) {
  // Verify this is a legitimate request
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");
  
  const isVercelCron = cronHeader === "true";
  const isManualAuth = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  
  if (!isVercelCron && !isManualAuth) {
    console.error("[NTSB Sync] Unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log(`[NTSB Sync] Starting sync - triggered by ${isVercelCron ? 'Vercel Cron' : 'Manual'}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 7);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    
    // Initialize summary early so it can be used in error handling
    const summary: any = {
      success: true,
      timestamp: new Date().toISOString(),
      triggeredBy: isVercelCron ? "Vercel Cron" : "Manual",
      dateRangeStart: startDate,
      accidentsFromAPI: 0,
      newRecordsInserted: 0,
      skipped: 0,
      geocoded: 0,
      failed: 0,
      errors: [] as any[]
    };
    
    console.log(`[NTSB Sync] Querying NTSB API for accidents since ${startDate}`);

    const apiUrl = `https://data.ntsb.gov/carol-main-public/api/Query/Main`;
    
    const requestBody = {
      "ResultSetSize": 500,
      "ResultSetOffset": 0,
      "QueryGroups": [
        {
          "QueryRules": [
            {
              "FieldName": "EventDate",
              "RuleType": 0,
              "Values": [startDate],
              "Columns": ["Event.EventDate"],
              "Operator": "is greater than"
            }
          ],
          "AndOr": "And"
        }
      ],
      "AndOr": "And",
      "SortColumn": null,
      "SortDescending": true,
      "TargetCollection": "cases",
      "SessionId": Math.floor(Math.random() * 100000)
    };

    console.log("[NTSB Sync] Request body:", JSON.stringify(requestBody));

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'AviationSafetyWatch/1.0'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`NTSB API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const results = data.Results || [];
    
    console.log(`[NTSB Sync] NTSB API returned ${results.length} accidents`);

    let newRecords = 0;
    let geocoded = 0;
    let failed = 0;
    let skipped = 0;

    for (const result of results) {
      try {
        const fields = result.Fields || [];
        
        // Extract data from the weird Fields array format
        const ntsbNumber = getFieldValue(fields, "NtsbNo");
        const eventDate = getFieldValue(fields, "EventDate");
        const city = getFieldValue(fields, "City");
        const state = getFieldValue(fields, "State");
        const country = getFieldValue(fields, "Country");
        const registrationNumber = getFieldValue(fields, "N#");
        const vehicleMake = getFieldValue(fields, "VehicleMake");
        const vehicleModel = getFieldValue(fields, "VehicleModel");
        const highestInjury = getFieldValue(fields, "HighestInjuryLevel");
        const eventType = getFieldValue(fields, "EventType");
        const mkey = getFieldValue(fields, "Mkey");
        
        if (!ntsbNumber) {
          skipped++;
          continue;
        }

        // Check if already exists by NTSB number
        const existing = await pool.query(
          "SELECT ntsb_number FROM accidents WHERE ntsb_number = $1",
          [ntsbNumber]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        console.log(`[NTSB Sync] New accident found: ${ntsbNumber} - ${city}, ${state}`);

        // Geocode the location
        const coords = await geocode(city, state, country);
        if (coords) {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit
        }

        // Parse event date
let parsedDate = eventDate ? new Date(eventDate).toISOString().split('T')[0] : null;

// Validate date is not in the future (filter out bad NTSB data)
if (parsedDate) {
  const today = new Date().toISOString().split('T')[0];
  if (parsedDate > today) {
    console.log(`[NTSB Sync] ⚠️ Skipping ${ntsbNumber} - future date: ${parsedDate}`);
    skipped++;
    continue;
  }
}

        // Insert new record
        await pool.query(
          `INSERT INTO accidents (
            ntsb_number, event_id, event_date, event_type,
            highest_injury, city, state, country,
            latitude, longitude,
            aircraft_make, aircraft_model, registration_number
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            ntsbNumber,
            mkey || null,  // Using Mkey as event_id
            parsedDate,
            eventType || null,
            highestInjury || null,
            city || null,
            state || null,  // Full state value
            country || "USA",
            coords?.latitude || null,
            coords?.longitude || null,
            vehicleMake || null,
            vehicleModel || null,
            registrationNumber || null,
          ]
        );

        newRecords++;
        if (coords) geocoded++;
        
        console.log(`[NTSB Sync] ✓ Inserted ${ntsbNumber}`);

      } catch (err: any) {
        console.error(`[NTSB Sync] Failed to process accident:`, err.message, err);
        failed++;
        
        // Store first few errors to return in response
        if (failed <= 3 && !summary.errors) {
          summary.errors = [];
        }
        if (failed <= 3) {
          summary.errors.push({
            ntsbNumber: getFieldValue(result?.Fields, "NtsbNo"),
            error: err.message
          });
        }
      }
    }

    await pool.end();

    // Update final summary values
    summary.accidentsFromAPI = results.length;
    summary.newRecordsInserted = newRecords;
    summary.skipped = skipped;
    summary.geocoded = geocoded;
    summary.failed = failed;

    console.log("[NTSB Sync] Complete:", summary);

    return NextResponse.json(summary);
  } catch (error: any) {
    await pool.end();
    console.error("[NTSB Sync] Error:", error);
    return NextResponse.json(
      { 
        error: error.message, 
        timestamp: new Date().toISOString(),
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
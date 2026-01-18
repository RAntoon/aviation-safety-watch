import { NextResponse } from "next/server";
import { Pool } from "pg";

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
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().split('T')[0];
    
    console.log(`[NTSB Sync] Querying NTSB API for accidents since ${startDate}`);

    // Query NTSB Carol API with the CORRECT format (copied from working browser request)
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
    const accidents = data.Data || [];
    
    console.log(`[NTSB Sync] NTSB API returned ${accidents.length} accidents (Total: ${data.TotalRecords || 0})`);

    let newRecords = 0;
    let geocoded = 0;
    let failed = 0;
    let skipped = 0;

    for (const accident of accidents) {
      try {
        const eventId = accident.ev_id?.toString();
        
        if (!eventId) {
          skipped++;
          continue;
        }

        // Check if already exists
        const existing = await pool.query(
          "SELECT event_id FROM accidents WHERE event_id = $1",
          [eventId]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        console.log(`[NTSB Sync] New accident found: ${eventId} - ${accident.ev_city}, ${accident.ev_state}`);

        // Geocode if we don't have coordinates
        let coords = null;
        if (!accident.latitude || !accident.longitude) {
          coords = await geocode(accident.ev_city, accident.ev_state, accident.ev_country);
          if (coords) {
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Rate limit
          }
        }

        // Insert new record
        await pool.query(
          `INSERT INTO accidents (
            event_id, ntsb_number, event_date, event_type,
            highest_injury, city, state, country,
            latitude, longitude, fatal_count,
            aircraft_make, aircraft_model, registration_number,
            prelim_narrative, factual_narrative, analysis_narrative
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            eventId,
            accident.ntsbNumber || null,
            accident.ev_date || null,
            accident.ev_type || null,
            accident.inj_highest || null,
            accident.ev_city || null,
            accident.ev_state || null,
            accident.ev_country || "USA",
            coords?.latitude || accident.latitude || null,
            coords?.longitude || accident.longitude || null,
            accident.inj_f_grnd || 0,
            accident.acft_make || null,
            accident.acft_model || null,
            accident.regis_no || null,
            accident.narr_prelim || null,
            accident.narr_factual || null,
            accident.narr_analysis || null,
          ]
        );

        newRecords++;
        if (coords) geocoded++;
        
        console.log(`[NTSB Sync] ✓ Inserted ${eventId}`);

      } catch (err: any) {
        console.error(`[NTSB Sync] Failed to process accident:`, err.message);
        failed++;
      }
    }

    await pool.end();

    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      triggeredBy: isVercelCron ? "Vercel Cron" : "Manual",
      dateRangeStart: startDate,
      totalFromAPI: data.TotalRecords || 0,
      accidentsReceived: accidents.length,
      newRecordsInserted: newRecords,
      skipped,
      geocoded,
      failed,
    };

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
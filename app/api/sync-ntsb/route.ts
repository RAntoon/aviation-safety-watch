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

// Extract event ID from NTSB URL
function extractEventId(link: string): string | null {
  const match = link.match(/ev_id=(\d+)/);
  return match ? match[1] : null;
}

// Parse RSS feed manually (more robust than XML parser)
function parseRSS(xmlText: string) {
  const items: any[] = [];
  
  // Split by <item> tags
  const itemMatches = xmlText.match(/<item>([\s\S]*?)<\/item>/gi);
  
  if (!itemMatches) {
    console.log("[NTSB Sync] No items found in RSS");
    return items;
  }
  
  for (const itemText of itemMatches) {
    try {
      const title = itemText.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
      const link = itemText.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim() || "";
      const description = itemText.match(/<description>([\s\S]*?)<\/description>/i)?.[1]?.trim() || "";
      const pubDate = itemText.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() || "";
      
      items.push({ title, link, description, pubDate });
    } catch (err) {
      console.error("[NTSB Sync] Failed to parse item:", err);
    }
  }
  
  return items;
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
    const NTSB_RSS = "https://www.ntsb.gov/_layouts/ntsb.aviation/RSS.aspx";
    console.log(`[NTSB Sync] Fetching RSS feed from ${NTSB_RSS}`);

    // Fetch the RSS feed
    const response = await fetch(NTSB_RSS, {
      headers: { "User-Agent": "AviationSafetyWatch/1.0" },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`RSS feed error: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log(`[NTSB Sync] RSS feed fetched, length: ${xmlText.length} characters`);
    
    // Parse RSS manually (more robust)
    const items = parseRSS(xmlText);
    console.log(`[NTSB Sync] Found ${items.length} items in RSS feed`);

    let newRecords = 0;
    let geocoded = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const { title, link, description, pubDate } = item;

        const eventId = extractEventId(link);
        
        if (!eventId) {
          console.log(`[NTSB Sync] No event ID found in: ${link}`);
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

        // Parse location from title (format: "Location: City, ST")
        const locationMatch = title.match(/Location:\s*([^,]+),\s*([A-Z]{2})/);
        const city = locationMatch?.[1]?.trim();
        const state = locationMatch?.[2]?.trim();

        // Parse date from pubDate
        const eventDate = pubDate ? new Date(pubDate).toISOString().split('T')[0] : null;

        // Geocode the location
        const coords = await geocode(city, state, "USA");

        // Insert new record with basic info from RSS
        await pool.query(
          `INSERT INTO accidents (
            event_id, event_date, event_type,
            city, state, country, latitude, longitude,
            prelim_narrative
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            eventId,
            eventDate,
            "Accident", // Default type
            city || null,
            state || null,
            "USA",
            coords?.latitude || null,
            coords?.longitude || null,
            description || null,
          ]
        );

        newRecords++;
        if (coords) geocoded++;
        
        console.log(`[NTSB Sync] ✓ Inserted ${eventId} - ${city}, ${state}`);

        // Rate limit: wait 1 second between geocoding requests
        if (coords) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.error(`[NTSB Sync] Failed to process item:`, err);
        failed++;
      }
    }

    await pool.end();

    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      triggeredBy: isVercelCron ? "Vercel Cron" : "Manual",
      rssItemsFound: items.length,
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
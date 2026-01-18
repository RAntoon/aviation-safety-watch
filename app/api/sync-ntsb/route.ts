import { NextResponse } from "next/server";
import { Pool } from "pg";
import { parseString } from "xml2js";
import { promisify } from "util";

const parseXML = promisify(parseString);
const NTSB_RSS = "https://www.ntsb.gov/_layouts/ntsb.aviation/RSS.aspx";

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

export async function GET(request: Request) {
  // Verify this is a legitimate Vercel cron request
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-vercel-cron");
  
  // Accept either:
  // 1. Vercel's cron header (automatic cron jobs)
  // 2. Manual authorization with CRON_SECRET (for trigger-sync wrapper)
  const isVercelCron = cronHeader === "true";
  const isManualAuth = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  
  if (!isVercelCron && !isManualAuth) {
    console.error("[NTSB Sync] Unauthorized request - missing cron header or invalid auth");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log(`[NTSB Sync] Starting sync - triggered by ${isVercelCron ? 'Vercel Cron' : 'Manual'}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
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
    
    // Clean up the XML to handle malformed attributes
    const cleanedXml = xmlText
      .replace(/\s+(?=>)/g, '') // Remove whitespace before >
      .replace(/=\s*>/g, '="">'); // Fix empty attributes
    
    const parsed: any = await parseXML(cleanedXml);
    
    const items = parsed?.rss?.channel?.[0]?.item || [];
    console.log(`[NTSB Sync] Found ${items.length} items in RSS feed`);

    let newRecords = 0;
    let geocoded = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const title = item.title?.[0] || "";
        const link = item.link?.[0] || "";
        const description = item.description?.[0] || "";
        const pubDate = item.pubDate?.[0] || "";

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
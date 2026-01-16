import { NextResponse } from "next/server";
import { Pool } from "pg";
import { parseString } from "xml2js";
import { promisify } from "util";

const parseXML = promisify(parseString);
const NTSB_RSS = "https://www.ntsb.gov/_layouts/ntsb.aviation/RSS.aspx";

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

function extractEventId(link: string): string | null {
  const match = link.match(/ev_id=(\d+)/);
  return match ? match[1] : null;
}

export async function GET() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`[Manual Sync] Fetching RSS feed`);

    const response = await fetch(NTSB_RSS, {
      headers: { "User-Agent": "AviationSafetyWatch/1.0" }
    });

    if (!response.ok) {
      throw new Error(`RSS feed error: ${response.status}`);
    }

    const xmlText = await response.text();
    const cleanedXml = xmlText
      .replace(/\s+(?=>)/g, '')
      .replace(/=\s*>/g, '="">');
    
    const parsed: any = await parseXML(cleanedXml);
    const items = parsed?.rss?.channel?.[0]?.item || [];
    
    console.log(`[Manual Sync] Found ${items.length} items in RSS feed`);

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
          skipped++;
          continue;
        }

        const existing = await pool.query(
          "SELECT event_id FROM accidents WHERE event_id = $1",
          [eventId]
        );

        if (existing.rows.length > 0) {
          skipped++;
          continue;
        }

        const locationMatch = title.match(/Location:\s*([^,]+),\s*([A-Z]{2})/);
        const city = locationMatch?.[1]?.trim();
        const state = locationMatch?.[2]?.trim();
        const eventDate = pubDate ? new Date(pubDate).toISOString().split('T')[0] : null;
        const coords = await geocode(city, state, "USA");

        await pool.query(
          `INSERT INTO accidents (
            event_id, event_date, event_type,
            city, state, country, latitude, longitude,
            prelim_narrative
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            eventId, eventDate, "Accident",
            city || null, state || null, "USA",
            coords?.latitude || null, coords?.longitude || null,
            description || null,
          ]
        );

        newRecords++;
        if (coords) geocoded++;

        if (coords) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (err) {
        console.error(`[Manual Sync] Failed:`, err);
        failed++;
      }
    }

    await pool.end();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      rssItemsFound: items.length,
      newRecordsInserted: newRecords,
      skipped,
      geocoded,
      failed,
    });
  } catch (error: any) {
    await pool.end();
    return NextResponse.json(
      { error: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
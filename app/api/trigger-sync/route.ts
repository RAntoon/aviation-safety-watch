import { NextResponse } from "next/server";
import { Pool } from "pg";
import * as cheerio from "cheerio";

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

export async function GET() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    console.log(`[Manual Sync] Fetching recent accidents from NTSB`);

    // Fetch recent accidents page
    const response = await fetch(
      "https://www.ntsb.gov/investigations/Pages/aviation.aspx",
      { headers: { "User-Agent": "AviationSafetyWatch/1.0" } }
    );

    if (!response.ok) {
      throw new Error(`NTSB page error: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    console.log(`[Manual Sync] Parsing accidents from page`);

    let newRecords = 0;
    let geocoded = 0;
    let failed = 0;
    let skipped = 0;
    let found = 0;

    // Find accident links (this is a placeholder - we'd need to inspect the actual page structure)
    $('a[href*="ev_id"]').each((i, elem) => {
      found++;
      const href = $(elem).attr('href') || '';
      const match = href.match(/ev_id=(\d+)/);
      if (match) {
        console.log(`Found event ID: ${match[1]}`);
      }
    });

    await pool.end();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      message: "Scraping approach - found " + found + " links",
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
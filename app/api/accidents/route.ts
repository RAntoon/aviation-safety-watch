import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Create a single shared pool that persists across requests
let pool: Pool | null = null;

function getPool() {
  if (!pool) {
    const connectionString = 
      process.env.DATABASE_URL || 
      process.env.POSTGRES_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL not found in environment variables");
    }

    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  
  return pool;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");
  const searchTerm = searchParams.get("search"); // NEW: Get search parameter

  // Parse date parameters
  const startDate = startStr ? new Date(startStr) : null;
  const endDate = endStr ? new Date(endStr) : null;

  // Validate dates
  if (startDate && isNaN(startDate.getTime())) {
    return NextResponse.json(
      { ok: false, error: "Invalid start date" },
      { status: 400 }
    );
  }

  if (endDate && isNaN(endDate.getTime())) {
    return NextResponse.json(
      { ok: false, error: "Invalid end date" },
      { status: 400 }
    );
  }

  const pool = getPool();

  try {
    // Build the SQL query - REMOVED summary to dramatically improve performance
    let query = `
      SELECT 
        id,
        ntsb_number,
        event_id,
        event_date,
        event_type,
        highest_injury,
        latitude,
        longitude,
        city,
        state,
        country,
        fatal_count,
        aircraft_make,
        aircraft_model,
        registration_number,
        report_url
      FROM accidents
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Add date filters if provided
    if (startDate) {
      query += ` AND event_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      // Add one day to end date to make it inclusive
      const endDateInclusive = new Date(endDate);
      endDateInclusive.setDate(endDateInclusive.getDate() + 1);
      
      query += ` AND event_date < $${paramIndex}`;
      params.push(endDateInclusive);
      paramIndex++;
    }

    // NEW: Add search filter if provided (server-side search for "all time" mode)
    if (searchTerm && searchTerm.trim().length > 0) {
      const searchPattern = `%${searchTerm.trim().toLowerCase()}%`;
      query += ` AND (
        LOWER(ntsb_number) LIKE $${paramIndex} OR
        LOWER(city) LIKE $${paramIndex} OR
        LOWER(state) LIKE $${paramIndex} OR
        LOWER(aircraft_make) LIKE $${paramIndex} OR
        LOWER(aircraft_model) LIKE $${paramIndex} OR
        LOWER(registration_number) LIKE $${paramIndex}
      )`;
      params.push(searchPattern);
      paramIndex++;
    }

    // Order by date (most recent first)
    query += ` ORDER BY event_date DESC`;

    // Limit results only when date filtering is used AND no search term
    // When searching all time with a search term, return unlimited results (but likely small result set)
    if ((startDate || endDate) && !searchTerm) {
      query += ` LIMIT 20000`;
    } else if (!searchTerm) {
      // "Search all time" without search term - still limit to prevent browser crash
      query += ` LIMIT 20000`;
    }
    // If there IS a search term, no limit (search results are naturally limited)

    // Execute query
    const result = await pool.query(query, params);

    // Handle empty results gracefully
    if (!result || !result.rows) {
      return NextResponse.json({
        ok: true,
        totalRows: 0,
        rowsWithCoords: 0,
        rowsInRange: 0,
        points: [],
        debug: {
          useDatabase: true,
          startDate: startStr,
          endDate: endStr,
          searchTerm: searchTerm || null,
          queryExecuted: true,
        },
      });
    }
    // Transform results into the format expected by MapView
    const points = result.rows.map((row) => {
      // Determine kind based on fatal count and event type
      let kind: "fatal" | "accident" | "incident" | "occurrence" = "incident";
      if (row.fatal_count > 0 || row.highest_injury?.toLowerCase() === "fatal") {
        kind = "fatal";
      } else if (row.event_type === "ACC") {
        kind = "accident";
      } else if (row.event_type && row.event_type.toLowerCase().includes("occ")) {
        kind = "occurrence";
      }

      return {
        id: String(row.id),
        lat: parseFloat(row.latitude),
        lng: parseFloat(row.longitude),
        kind,
        date: row.event_date ? new Date(row.event_date).toISOString().split('T')[0] : undefined,
        city: row.city || undefined,
        state: row.state || undefined,
        country: row.country || undefined,
        ntsbCaseId: row.ntsb_number || undefined,
        eventId: row.event_id || undefined,
        reportUrl: row.report_url || undefined,
        aircraftType: [row.aircraft_make, row.aircraft_model]
          .filter(Boolean)
          .join(" ") || undefined,
        registrationNumber: row.registration_number || undefined,
        fatalCount: row.fatal_count || 0,
      };
    });

    // Count stats for response
    const totalRows = result.rows.length;
    const rowsWithCoords = totalRows;
    const rowsInRange = totalRows;

    return NextResponse.json({
      ok: true,
      totalRows,
      rowsWithCoords,
      rowsInRange,
      points,
      debug: {
        useDatabase: true,
        startDate: startStr,
        endDate: endStr,
        searchTerm: searchTerm || null,
        queryExecuted: true,
      },
    });

  } catch (error: any) {
    console.error("Database query error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Database query failed",
        message: error.message,
        points: [],
      },
      { status: 500 }
    );
  }
}
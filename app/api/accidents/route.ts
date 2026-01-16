import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Create database connection pool
function getPool() {
  const connectionString = 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL not found in environment variables");
  }

  return new Pool({
    connectionString,
    ssl: {
      rejectUnauthorized: false
    },
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

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
    // Build the SQL query
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
        COALESCE(prelim_narrative, factual_narrative, analysis_narrative) as summary
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

    // Order by date (most recent first)
    query += ` ORDER BY event_date DESC`;

    // Limit results to prevent overwhelming the client
    // You can adjust this or add pagination later
    query += ` LIMIT 50000`;

    // Execute query
    const result = await pool.query(query, params);

    // Transform results into the format expected by MapView
    const points = result.rows.map((row) => {
      // Determine kind based on fatal count and event type
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
        aircraftType: [row.aircraft_make, row.aircraft_model]
          .filter(Boolean)
          .join(" ") || undefined,
        summary: row.summary || undefined,
        registrationNumber: row.registration_number || undefined,
        fatalCount: row.fatal_count || 0,
      };
    });

    // Count stats for response
    const totalRows = result.rows.length;
    const rowsWithCoords = totalRows; // All results have coords due to WHERE clause
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
  } finally {
    // Close the pool
    await pool.end();
  }
}
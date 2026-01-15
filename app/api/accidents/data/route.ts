import { NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const startStr = searchParams.get("start");
  const endStr = searchParams.get("end");

  const startDate = startStr ? new Date(startStr) : null;
  const endDate = endStr ? new Date(endStr) : null;

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
    let query = `
      SELECT 
        id,
        ntsb_number,
        event_date::date as event_date,
        event_type,
        highest_injury,
        latitude,
        longitude,
        city,
        state,
        country,
        fatal_count,
        aircraft_make,
        aircraft_model
      FROM accidents
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND event_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      const endDateInclusive = new Date(endDate);
      endDateInclusive.setDate(endDateInclusive.getDate() + 1);
      
      query += ` AND event_date < $${paramIndex}`;
      params.push(endDateInclusive);
      paramIndex++;
    }

    query += ` ORDER BY event_date DESC`;
    query += ` LIMIT 10000`; // Limit for performance

    const result = await pool.query(query, params);

    return NextResponse.json({
      ok: true,
      accidents: result.rows,
      count: result.rows.length,
    });

  } catch (error: any) {
    console.error("Database query error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Database query failed",
        message: error.message,
      },
      { status: 500 }
    );
  } finally {
    await pool.end();
  }
}
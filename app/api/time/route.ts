import { NextResponse } from "next/server";

// We use the US Naval Observatory host.
// The HTTP Date header is authoritative UTC.
const USNO_URL = "https://tycho.usno.navy.mil/";

export async function GET() {
  try {
    const res = await fetch(USNO_URL, {
      method: "HEAD",
      cache: "no-store",
      headers: {
        "User-Agent": "AviationSafetyWatch/1.0",
      },
    });

    const dateHeader = res.headers.get("date");

    if (!dateHeader) {
      return NextResponse.json({
        ok: false,
        source: "USNO (missing Date header)",
        utcIso: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ok: true,
      source: "USNO (tycho.usno.navy.mil)",
      utcIso: new Date(dateHeader).toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      source: "fallback (server clock)",
      utcIso: new Date().toISOString(),
    });
  }
}

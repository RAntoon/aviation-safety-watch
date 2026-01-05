import { NextResponse } from "next/server";

// Pull "official" time from a USNO host via HTTP Date header.
// If USNO is unreachable, we fall back to server time.
const USNO_URL = "https://tycho.usno.navy.mil/";

export async function GET() {
  try {
    // HEAD is light-weight; we only need the Date header
    const res = await fetch(USNO_URL, {
      method: "HEAD",
      cache: "no-store",
      // Small timeout-ish behavior: Next fetch doesn't have native timeout,
      // but Vercel typically enforces execution limits anyway.
      headers: {
        "User-Agent": "AviationSafetyWatch/1.0",
      },
    });

    const dateHeader = res.headers.get("date");

    if (!dateHeader) {
      return NextResponse.json(
        {
          ok: false,
          source: "USNO (Date header missing)",
          utcIso: new Date().toISOString(),
        },
        { status: 200 }
      );
    }

    const utcIso = new Date(dateHeader).toISOString();

    return NextResponse.json(
      {
        ok: true,
        source: "USNO (tycho.usno.navy.mil Date header)",
        utcIso,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        source: "fallback (server clock)",
        utcIso: new Date().toISOString(),
        error: String(e),
      },
      { status: 200 }
    );
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs"; // keep it server-side

// IMPORTANT:
// 1) In the NTSB Swagger page, open **GetCasesByDateRange**
// 2) Click "Try this operation", enter dates, execute
// 3) Copy the **Request URL** it calls
// 4) Put the BASE part into NTSB_CASES_BY_DATE_BASE (see Step 3)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "Missing start or end" }, { status: 400 });
  }

  const base = process.env.NTSB_CASES_BY_DATE_BASE;
  if (!base) {
    return NextResponse.json(
      { error: "Server misconfigured: missing NTSB_CASES_BY_DATE_BASE" },
      { status: 500 }
    );
  }

  // You may need to adjust parameter names to EXACTLY what Swagger uses.
  // Common patterns: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD  OR  ?start=...&end=...
  const url = new URL(base);
  url.searchParams.set("startDate", start);
  url.searchParams.set("endDate", end);

  try {
    const r = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }

    if (!r.ok) {
      return NextResponse.json(
        { error: json?.message || json?.error || text || `HTTP ${r.status}` },
        { status: r.status }
      );
    }

    return NextResponse.json(json ?? { raw: text }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

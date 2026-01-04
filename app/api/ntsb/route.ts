import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isISODate(s: string) {
  // YYYY-MM-DD
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end || !isISODate(start) || !isISODate(end)) {
      return NextResponse.json(
        { error: "Missing/invalid start or end. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    // NTSB Public API (Aviation)
    // If their parameter names differ, you’ll see it immediately in the response error.
    const upstream = `https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange?startDate=${encodeURIComponent(
      start
    )}&endDate=${encodeURIComponent(end)}`;

    const r = await fetch(upstream, {
      // avoid caching stale results
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await r.text();

    // If NTSB returns non-JSON (it happens during outages), pass it through clearly
    const contentType = r.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Upstream returned non-JSON", status: r.status, body: text },
        { status: 502 }
      );
    }

    const json = JSON.parse(text);
    return NextResponse.json(json, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

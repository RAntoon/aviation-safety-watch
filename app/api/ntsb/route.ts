// app/api/ntsb/route.ts
import { NextResponse } from "next/server";

function isoDate(d: Date) {
  // YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCFullYear(end.getUTCFullYear() - 1);
  return { start: isoDate(start), end: isoDate(end) };
}

async function fetchJson(url: string) {
  const res = await fetch(url, {
    // Avoid caching stale results in serverless environments
    cache: "no-store",
    headers: {
      "Accept": "application/json",
      "User-Agent": "aviation-safety-watch (vercel)",
    },
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return { ok: res.ok, status: res.status, data };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const { start: defStart, end: defEnd } = defaultRange();

  const start = searchParams.get("start") || defStart;
  const end = searchParams.get("end") || defEnd;

  // NTSB Public API base
  const base = "https://api.ntsb.gov/public/api/Aviation/v1";

  // Try BOTH common patterns:
  //  1) /GetCasesByDateRange?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  //  2) /GetCasesByDateRange/YYYY-MM-DD/YYYY-MM-DD
  const candidates = [
    `${base}/GetCasesByDateRange?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
    `${base}/GetCasesByDateRange/${encodeURIComponent(start)}/${encodeURIComponent(end)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    const r = await fetchJson(url);
    if (r.ok) {
      return NextResponse.json({
        ok: true,
        source: "NTSB Public API",
        requested: { start, end },
        endpointUsed: url,
        data: r.data,
      });
    }
    lastErr = { endpoint: url, status: r.status, data: r.data };
  }

  return NextResponse.json(
    {
      ok: false,
      source: "NTSB Public API",
      requested: { start, end },
      error: lastErr,
    },
    { status: 502 }
  );
}

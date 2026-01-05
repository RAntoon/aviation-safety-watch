import { NextResponse } from "next/server";

const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

function toYMD(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start: toYMD(start), end: toYMD(end) };
}

function parseYMD(s: string) {
  // Expect YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysBetween(a: Date, b: Date) {
  const ms = b.getTime() - a.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

async function fetchNtsbOnce(startYmd: string, endYmd: string) {
  // Try common param spellings (their docs can be inconsistent across endpoints)
  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "AviationSafetyWatch/1.0",
        },
        cache: "no-store",
      });

      const text = await res.text();

      if (!res.ok) {
        lastErr = {
          url,
          status: res.status,
          statusText: res.statusText,
          bodyPreview: text.slice(0, 600),
        };
        continue;
      }

      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        lastErr = { url, parseError: String(e), bodyPreview: text.slice(0, 600) };
        continue;
      }

      return { ok: true as const, urlUsed: url, data };
    } catch (e: any) {
      lastErr = { url, fetchError: String(e) };
    }
  }

  return { ok: false as const, error: lastErr };
}

function normalizeToArray(payload: any): any[] {
  // Sometimes APIs return {data:[...]} or {..., Cases:[...]} etc.
  if (Array.isArray(payload)) return payload;

  const keysToTry = ["data", "Data", "cases", "Cases", "results", "Results", "Items", "items"];
  for (const k of keysToTry) {
    const v = payload?.[k];
    if (Array.isArray(v)) return v;
  }

  // As a last resort: if it’s an object but not an array, return empty
  return [];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  if (!start || !end) {
    const r = last12MonthsRange();
    start = r.start;
    end = r.end;
  }

  const startD = parseYMD(start);
  const endD = parseYMD(end);

  if (!startD || !endD) {
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "Invalid date format. Use YYYY-MM-DD.",
      },
      { status: 400 }
    );
  }

  if (endD < startD) {
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "End must be >= start.",
      },
      { status: 400 }
    );
  }

  // Chunk large ranges to avoid NTSB 502/timeouts
  const totalDays = daysBetween(startD, endD);
  const chunkDays = 90;

  const allRows: any[] = [];
  let urlUsed = "";

  if (totalDays <= chunkDays) {
    const r = await fetchNtsbOnce(start, end);
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, start, end, message: "NTSB fetch failed", error: r.error },
        { status: 502 }
      );
    }
    urlUsed = r.urlUsed;
    allRows.push(...normalizeToArray(r.data));
  } else {
    let cursor = new Date(startD);
    while (cursor <= endD) {
      const chunkStart = toYMD(cursor);
      const next = new Date(cursor);
      next.setDate(next.getDate() + chunkDays);
      if (next > endD) next.setTime(endD.getTime());
      const chunkEnd = toYMD(next);

      const r = await fetchNtsbOnce(chunkStart, chunkEnd);
      if (!r.ok) {
        return NextResponse.json(
          {
            ok: false,
            start,
            end,
            message: "NTSB fetch failed (chunked request)",
            failedChunk: { chunkStart, chunkEnd },
            error: r.error,
          },
          { status: 502 }
        );
      }

      urlUsed = r.urlUsed;
      allRows.push(...normalizeToArray(r.data));

      // advance cursor by 1 day past chunkEnd to avoid infinite loops
      const advance = new Date(next);
      advance.setDate(advance.getDate() + 1);
      cursor = advance;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB Public API",
      urlUsed,
      count: allRows.length,
      data: allRows,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}

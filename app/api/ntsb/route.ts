import { NextResponse } from "next/server";

// NTSB base (Public)
const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

// YYYY-MM-DD
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
  return { start, end };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function tryNtsb(startYmd: string, endYmd: string) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
  };

  // Try multiple parameter spellings (some gov APIs are picky)
  const getCandidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  // 1) Try GET
  for (const url of getCandidates) {
    try {
      const res = await fetchWithTimeout(
        url,
        { method: "GET", headers, cache: "no-store" },
        15000
      );

      const text = await res.text();

      if (!res.ok) {
        // keep trying next candidate
        continue;
      }

      // parse
      try {
        const data = JSON.parse(text);
        return { ok: true as const, urlUsed: url, data };
      } catch {
        // if response isn't JSON, keep trying
        continue;
      }
    } catch {
      // timeout/network, try next
      continue;
    }
  }

  // 2) Try POST fallback (some endpoints are implemented as POST behind the UI)
  // We try a couple body shapes.
  const postBodies = [
    { startDate: startYmd, endDate: endYmd },
    { StartDate: startYmd, EndDate: endYmd },
    { from: startYmd, to: endYmd },
  ];

  for (const body of postBodies) {
    try {
      const res = await fetchWithTimeout(
        NTSB_BASE,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        },
        15000
      );

      const text = await res.text();

      if (!res.ok) {
        continue;
      }

      try {
        const data = JSON.parse(text);
        return { ok: true as const, urlUsed: `${NTSB_BASE} (POST)`, data };
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  // 3) If all failed, return a debug-friendly error payload (so your UI/logs show WHY)
  return {
    ok: false as const,
    error: {
      message:
        "Unable to fetch NTSB cases (GET+POST attempts failed). This is usually upstream rejecting params or returning non-JSON.",
      triedGet: getCandidates,
      triedPost: [`POST ${NTSB_BASE} with {startDate/endDate} / {StartDate/EndDate} / {from/to}`],
    },
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // client passes ?start=YYYY-MM-DD&end=YYYY-MM-DD
  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  // default = last 12 months
  if (!start || !end) {
    const r = last12MonthsRange();
    start = toYMD(r.start);
    end = toYMD(r.end);
  }

  const ntsb = await tryNtsb(start, end);

  if (!ntsb.ok) {
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "NTSB fetch failed",
        debug: ntsb.error,
      },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB Public API",
      urlUsed: ntsb.urlUsed,
      data: ntsb.data,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}

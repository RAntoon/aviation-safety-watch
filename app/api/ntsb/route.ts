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

// Try a couple parameter spellings because the swagger/docs vary by endpoint family.
async function fetchNtsb(startYmd: string, endYmd: string) {
  const candidates: string[] = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        // Some gov endpoints behave better if you send a UA + accept.
        headers: {
          "Accept": "application/json",
          "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
        },
        cache: "no-store",
      });

      const text = await res.text();

      if (!res.ok) {
        lastErr = {
          url,
          status: res.status,
          statusText: res.statusText,
          bodyPreview: text.slice(0, 500),
        };
        continue;
      }

      // Parse JSON safely
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        lastErr = { url, status: res.status, parseError: String(e), bodyPreview: text.slice(0, 500) };
        continue;
      }

      return { ok: true as const, urlUsed: url, data };
    } catch (e) {
      lastErr = { url, fetchError: String(e) };
    }
  }

  return { ok: false as const, error: lastErr };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  // client passes ?start=YYYY-MM-DD&end=YYYY-MM-DD
  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  if (!start || !end) {
    const r = last12MonthsRange();
    start = toYMD(r.start);
    end = toYMD(r.end);
  }

  const ntsb = await fetchNtsb(start, end);

  if (!ntsb.ok) {
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "NTSB fetch failed",
        error: ntsb.error,
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

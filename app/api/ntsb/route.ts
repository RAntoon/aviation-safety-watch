import { NextResponse } from "next/server";

export const runtime = "nodejs"; // IMPORTANT: avoid Edge runtime fetch quirks
export const dynamic = "force-dynamic";

const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

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

async function fetchWithTimeout(url: string, ms = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      method: "GET",
      // keep headers minimal; some environments get picky
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(t);
  }
}

async function fetchNtsb(startYmd: string, endYmd: string) {
  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const { res, text } = await fetchWithTimeout(url, 15000);

      if (!res.ok) {
        lastErr = {
          url,
          status: res.status,
          statusText: res.statusText,
          bodyPreview: text.slice(0, 800),
        };
        continue;
      }

      // Parse JSON safely
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        lastErr = {
          url,
          status: res.status,
          parseError: String(e),
          bodyPreview: text.slice(0, 800),
        };
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

  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  if (!start || !end) {
    const r = last12MonthsRange();
    start = toYMD(r.start);
    end = toYMD(r.end);
  }

  // validate (prevents bad date strings from causing upstream weirdness)
  if (!isYmd(start) || !isYmd(end)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Invalid date format. Use YYYY-MM-DD.",
        start,
        end,
      },
      { status: 400 }
    );
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

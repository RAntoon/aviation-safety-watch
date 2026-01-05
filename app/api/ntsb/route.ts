import { NextResponse } from "next/server";

export const runtime = "nodejs"; // important: avoid edge quirks
export const dynamic = "force-dynamic"; // ensure no weird caching

// NOTE: If this endpoint is truly public in your environment, this may work.
// If it requires a key, you'll see that clearly in the returned debug JSON.
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

async function fetchNtsbRaw(startYmd: string, endYmd: string) {
  // Some APIs vary param names; we try a few.
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
        headers: {
          Accept: "application/json",
          // Some gov endpoints behave better with a UA
          "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
        },
        cache: "no-store",
      });

      const text = await res.text();

      // Try parse JSON even if non-200 (so we can see message)
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        lastErr = {
          triedUrl: url,
          upstreamStatus: res.status,
          upstreamStatusText: res.statusText,
          bodyPreview: text?.slice(0, 800) ?? "",
          parsed,
        };
        continue;
      }

      return {
        ok: true as const,
        usedUrl: url,
        upstreamStatus: res.status,
        data: parsed ?? text,
      };
    } catch (e: any) {
      lastErr = {
        triedUrl: url,
        fetchError: String(e?.message ?? e),
      };
      continue;
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

  const ntsb = await fetchNtsbRaw(start, end);

  // IMPORTANT: Always 200 so UI can show the debug object instead of “502 failed”
  return NextResponse.json({
    ok: ntsb.ok,
    start,
    end,
    source: "NTSB endpoint attempt",
    ...(ntsb.ok
      ? {
          upstreamStatus: ntsb.upstreamStatus,
          urlUsed: ntsb.usedUrl,
          raw: ntsb.data,
        }
      : {
          upstreamError: ntsb.error,
        }),
    fetchedAt: new Date().toISOString(),
  });
}

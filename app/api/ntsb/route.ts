import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NTSB base (Public)
const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

// --- helpers ---
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

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function toNumberOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// Attempt a few parameter spellings (because NTSB endpoints vary)
async function fetchNtsb(startYmd: string, endYmd: string) {
  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          // Set a real email/contact here if you want—some gov endpoints like it.
          "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        lastErr = {
          triedUrl: url,
          upstreamStatus: res.status,
          upstreamStatusText: res.statusText,
          bodyPreview: text.slice(0, 800),
        };
        continue;
      }

      // Parse JSON safely
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch (e: any) {
        lastErr = {
          triedUrl: url,
          parseError: String(e),
          bodyPreview: text.slice(0, 800),
        };
        continue;
      }

      return { ok: true as const, triedUrl: url, json };
    } catch (e: any) {
      lastErr = {
        triedUrl: url,
        fetchError: String(e?.message || e),
      };
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false as const, error: lastErr };
}

// Normalize the NTSB response into points your map can draw reliably
function normalizeToPoints(raw: any[]) {
  const points = [];

  for (const c of raw || []) {
    // Lat/Lon field names vary—try a bunch
    const lat =
      toNumberOrNull(pickFirst(c, ["Latitude", "latitude", "Lat", "lat"])) ??
      null;
    const lon =
      toNumberOrNull(
        pickFirst(c, ["Longitude", "longitude", "Lon", "lon", "Long", "long"])
      ) ?? null;

    if (lat === null || lon === null) continue;

    // Determine classification
    const eventType = String(
      pickFirst(c, ["EventType", "eventType", "OccurrenceType", "occurrenceType"]) ??
        ""
    ).toLowerCase();

    const fatalities =
      toNumberOrNull(
        pickFirst(c, [
          "InjuriesFatal",
          "injuriesFatal",
          "Fatalities",
          "fatalities",
          "TotalFatalInjuries",
          "totalFatalInjuries",
        ])
      ) ?? 0;

    const isIncident = eventType.includes("incident");

    const category = isIncident
      ? "incident"
      : fatalities > 0
      ? "fatal_accident"
      : "accident";

    // IDs / docket link
    const projectId =
      pickFirst(c, ["ProjectID", "ProjectId", "projectId", "projectID", "MKey", "mkey", "Mkey"]) ??
      null;

    const ntsbNumber =
      pickFirst(c, ["NtsbNumber", "NTSBNumber", "ntsbNumber", "NTSBNo", "ntsbNo"]) ??
      null;

    const docketUrl =
      projectId !== null
        ? `https://data.ntsb.gov/Docket?ProjectID=${encodeURIComponent(String(projectId))}`
        : null;

    points.push({
      lat,
      lon,
      category, // fatal_accident | accident | incident
      fatalities,
      eventType: pickFirst(c, ["EventType", "eventType"]) ?? null,
      ntsbNumber,
      city: pickFirst(c, ["City", "city", "LocationCity", "locationCity"]) ?? null,
      state: pickFirst(c, ["State", "state", "LocationState", "locationState"]) ?? null,
      country: pickFirst(c, ["Country", "country"]) ?? null,
      date:
        pickFirst(c, ["EventDate", "eventDate", "Date", "date"]) ??
        null,
      docketUrl,
      raw: c, // keep original in case you want more fields later
    });
  }

  return points;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  // Default to last 12 months
  if (!start || !end) {
    const r = last12MonthsRange();
    start = toYMD(r.start);
    end = toYMD(r.end);
  }

  if (!isYMD(start) || !isYMD(end)) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Invalid date format. Use ?start=YYYY-MM-DD&end=YYYY-MM-DD",
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
        message: "NTSB fetch failed",
        start,
        end,
        error: ntsb.error,
      },
      { status: 502 }
    );
  }

  // Some endpoints return { data: [...] }, others return [...]
  const rawArray = Array.isArray(ntsb.json)
    ? ntsb.json
    : Array.isArray(ntsb.json?.data)
    ? ntsb.json.data
    : Array.isArray(ntsb.json?.Results)
    ? ntsb.json.Results
    : Array.isArray(ntsb.json?.results)
    ? ntsb.json.results
    : [];

  const points = normalizeToPoints(rawArray);

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB Public API",
      triedUrl: ntsb.triedUrl,
      count: points.length,
      points,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}

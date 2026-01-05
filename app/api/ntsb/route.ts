import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ensure Node runtime (not edge) for broader fetch compatibility

// Your original base (keep it), but we’ll try multiple formats + param spellings.
const NTSB_BASE = "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function mdy(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function last12MonthsRange() {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 1);
  return { start, end };
}

function extractArray(maybe: any): any[] {
  if (!maybe) return [];
  if (Array.isArray(maybe)) return maybe;

  // Common patterns
  if (Array.isArray(maybe.Cases)) return maybe.Cases;
  if (Array.isArray(maybe.cases)) return maybe.cases;
  if (Array.isArray(maybe.Results)) return maybe.Results;
  if (Array.isArray(maybe.results)) return maybe.results;
  if (Array.isArray(maybe.Data)) return maybe.Data;
  if (Array.isArray(maybe.data)) return maybe.data;

  return [];
}

function toNumber(v: any): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

// Simple in-memory cache for this lambda instance
const geoCache = new Map<string, { lat: number; lon: number }>();

async function geocode(place: string) {
  const key = place.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key)!;

  // Nominatim (OpenStreetMap) — free but rate-limited; OK for MVP + small volume
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(place);

  const res = await fetch(url, {
    headers: {
      // Nominatim requires a valid UA
      "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
      "Accept": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json: any[] = await res.json().catch(() => []);
  if (!Array.isArray(json) || json.length === 0) return null;

  const lat = toNumber(json[0]?.lat);
  const lon = toNumber(json[0]?.lon);
  if (lat === null || lon === null) return null;

  const out = { lat, lon };
  geoCache.set(key, out);
  return out;
}

function classifyCase(c: any): "fatal" | "accident" | "incident" {
  // Fatalities (try multiple possible field names)
  const fat = pickFirst(c, [
    "Fatalities",
    "fatalities",
    "TotalFatalInjuries",
    "totalFatalInjuries",
    "FatalInjuries",
    "fatalInjuries",
  ]);
  const fatalN = toNumber(fat) ?? 0;
  if (fatalN > 0) return "fatal";

  // Accident vs incident (try multiple)
  const it = String(
    pickFirst(c, ["InvestigationType", "investigationType", "EventType", "eventType", "CaseType", "caseType"]) ?? ""
  ).toLowerCase();

  if (it.includes("accident")) return "accident";
  if (it.includes("incident")) return "incident";

  // Default to accident (you said “list of all accidents”)
  return "accident";
}

function buildDocketUrl(c: any): string | undefined {
  // If the API gives you a case number / docket id / investigation id, use it here.
  // We’ll try a few likely keys and return a CAROL search link as a fallback.
  const id =
    pickFirst(c, ["NtsbNo", "ntsbNo", "CaseNumber", "caseNumber", "InvestigationNumber", "investigationNumber"]) ??
    pickFirst(c, ["DocketId", "docketId", "CaseId", "caseId"]);

  if (!id) return undefined;

  // Fallback: CAROL search (works even if direct docket URL pattern differs)
  return `https://data.ntsb.gov/carol-main-public/query-builder?keyword=${encodeURIComponent(String(id))}`;
}

async function fetchNtsb(start: string, end: string) {
  // Build candidate queries.
  // Try both YYYY-MM-DD and MM/DD/YYYY and multiple parameter names.
  const startDateObj = new Date(start);
  const endDateObj = new Date(end);

  // If date parsing fails, still try the raw strings.
  const startYMD = Number.isNaN(startDateObj.getTime()) ? start : ymd(startDateObj);
  const endYMD = Number.isNaN(endDateObj.getTime()) ? end : ymd(endDateObj);

  const startMDY = Number.isNaN(startDateObj.getTime()) ? start : mdy(startDateObj);
  const endMDY = Number.isNaN(endDateObj.getTime()) ? end : mdy(endDateObj);

  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYMD)}&endDate=${encodeURIComponent(endYMD)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYMD)}&EndDate=${encodeURIComponent(endYMD)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYMD)}&to=${encodeURIComponent(endYMD)}`,

    `${NTSB_BASE}?startDate=${encodeURIComponent(startMDY)}&endDate=${encodeURIComponent(endMDY)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startMDY)}&EndDate=${encodeURIComponent(endMDY)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startMDY)}&to=${encodeURIComponent(endMDY)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
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

      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        lastErr = { url, parseError: String(e), bodyPreview: text.slice(0, 500) };
        continue;
      }

      return { ok: true as const, urlUsed: url, data };
    } catch (e: any) {
      lastErr = { url, fetchError: String(e?.message || e) };
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
    start = ymd(r.start);
    end = ymd(r.end);
  }

  const ntsb = await fetchNtsb(start, end);

  if (!ntsb.ok) {
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "NTSB fetch failed",
        upstreamError: ntsb.error,
      },
      { status: 502 }
    );
  }

  const rawCases = extractArray(ntsb.data);

  // Normalize into “points” we can plot.
  // If lat/lon missing, geocode based on a location string.
  const points: any[] = [];
  const maxGeocode = 50; // MVP safety limit to avoid rate limiting
  let geocodeCount = 0;

  for (const c of rawCases) {
    const id = String(
      pickFirst(c, ["NtsbNo", "ntsbNo", "CaseNumber", "caseNumber", "InvestigationNumber", "investigationNumber", "CaseId", "caseId"]) ??
        crypto.randomUUID()
    );

    const title = String(
      pickFirst(c, ["Title", "title", "Summary", "summary", "Aircraft", "aircraft", "MakeModel", "makeModel"]) ??
        "NTSB Case"
    );

    const date = pickFirst(c, ["EventDate", "eventDate", "OccurrenceDate", "occurrenceDate", "AccidentDate", "accidentDate"]);
    const kind = classifyCase(c);

    // Try direct coordinates first
    const lat = toNumber(pickFirst(c, ["Latitude", "latitude", "Lat", "lat"]));
    const lon = toNumber(pickFirst(c, ["Longitude", "longitude", "Lon", "lon", "Lng", "lng"]));

    let finalLat = lat;
    let finalLon = lon;

    if ((finalLat === null || finalLon === null) && geocodeCount < maxGeocode) {
      const city = pickFirst(c, ["City", "city"]);
      const state = pickFirst(c, ["State", "state", "Province", "province"]);
      const country = pickFirst(c, ["Country", "country"]);

      const place = [city, state, country].filter(Boolean).join(", ");
      if (place) {
        const geo = await geocode(place);
        if (geo) {
          finalLat = geo.lat;
          finalLon = geo.lon;
          geocodeCount += 1;
        }
      }
    }

    // Skip anything still missing coords
    if (finalLat === null || finalLon === null) continue;

    points.push({
      id,
      title,
      date: date ? String(date) : undefined,
      kind,
      lat: finalLat,
      lon: finalLon,
      docketUrl: buildDocketUrl(c),
      raw: undefined, // keep response small; add back if you want debugging
    });
  }

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      urlUsed: ntsb.urlUsed,
      countRaw: rawCases.length,
      countMapped: points.length,
      geocoded: geocodeCount,
      points,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}

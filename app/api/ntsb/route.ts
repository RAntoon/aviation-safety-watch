import { NextResponse } from "next/server";

// NTSB base (Public)
const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

// Basic in-memory geocode cache (works per warm serverless instance)
const g: any = globalThis as any;
g.__geoCache = g.__geoCache || new Map<string, { lat: number; lon: number }>();
const geoCache: Map<string, { lat: number; lon: number }> = g.__geoCache;

function isYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Nominatim (no key) – keep it gentle to avoid rate-limit / blocking.
async function geocodeUS(query: string) {
  const key = query.trim().toLowerCase();
  if (!key) return null;

  const cached = geoCache.get(key);
  if (cached) return cached;

  const url =
    "https://nominatim.openstreetmap.org/search?" +
    new URLSearchParams({
      format: "json",
      limit: "1",
      countrycodes: "us",
      q: query,
    }).toString();

  const res = await fetch(url, {
    headers: {
      // IMPORTANT: Use a real contact email if you have one.
      "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const json: any = await res.json();
  const hit = Array.isArray(json) ? json[0] : null;
  if (!hit?.lat || !hit?.lon) return null;

  const out = { lat: Number(hit.lat), lon: Number(hit.lon) };
  if (Number.isFinite(out.lat) && Number.isFinite(out.lon)) {
    geoCache.set(key, out);
    return out;
  }

  return null;
}

function pickArray(payload: any): any[] {
  // The NTSB API sometimes wraps arrays under different keys.
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.Cases)) return payload.Cases;
  if (Array.isArray(payload?.cases)) return payload.cases;

  // Try to find the first array in the top-level object
  if (payload && typeof payload === "object") {
    for (const k of Object.keys(payload)) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return [];
}

function getField(obj: any, names: string[]) {
  for (const n of names) {
    if (obj && obj[n] != null) return obj[n];
  }
  return null;
}

function toNumber(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchNtsb(startYmd: string, endYmd: string) {
  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(
      startYmd
    )}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(
      startYmd
    )}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(
      endYmd
    )}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
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
          bodyPreview: text.slice(0, 800),
        };
        continue;
      }

      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (e) {
        lastErr = { url, parseError: String(e), bodyPreview: text.slice(0, 800) };
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

  // Expect YYYY-MM-DD, but fall back to last 12 months if missing/invalid
  let start = searchParams.get("start") || "";
  let end = searchParams.get("end") || "";

  if (!isYMD(start) || !isYMD(end)) {
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

  const raw = ntsb.data;
  const cases = pickArray(raw);

  // Build points for the map
  // We’ll prefer coordinates if provided; otherwise geocode a location string.
  const points: any[] = [];

  // Keep geocoding light so Vercel functions don’t time out.
  const MAX_GEOCODE_PER_REQUEST = 25;
  let geocodedCount = 0;
  let geocodeSkipped = 0;

  for (const c of cases) {
    // Attempt to read lat/lon directly if present
    const lat =
      toNumber(getField(c, ["Latitude", "latitude", "Lat", "lat"])) ?? null;
    const lon =
      toNumber(getField(c, ["Longitude", "longitude", "Lon", "lon"])) ?? null;

    const city = getField(c, ["City", "city"]) || "";
    const state = getField(c, ["State", "state", "StateRegion", "StateRegionCode"]) || "";
    const country = getField(c, ["Country", "country"]) || "United States";

    const ntsbNumber =
      getField(c, ["NTSBNumber", "NtsbNumber", "ntsbNumber"]) || null;

    const projectId =
      getField(c, ["ProjectId", "ProjectID", "projectId", "projectID"]) || null;

    const eventDate =
      getField(c, ["EventDate", "eventDate", "AccidentDate", "accidentDate"]) ||
      null;

    const eventType =
      (getField(c, ["EventType", "eventType", "OccurrenceType"]) || "")
        .toString()
        .toUpperCase() || "";

    const fatalities =
      toNumber(
        getField(c, [
          "TotalFatalInjuries",
          "totalFatalInjuries",
          "Fatalities",
          "fatalities",
        ])
      ) ?? 0;

    const label =
      (getField(c, ["AircraftMake", "Make"]) ? `${getField(c, ["AircraftMake", "Make"])} ` : "") +
      (getField(c, ["AircraftModel", "Model"]) ? `${getField(c, ["AircraftModel", "Model"])}` : "") ||
      (ntsbNumber ? `NTSB ${ntsbNumber}` : "NTSB case");

    const docketUrl =
      projectId != null ? `https://data.ntsb.gov/Docket?ProjectID=${projectId}` : null;

    // If we have coordinates, use them
    if (lat != null && lon != null) {
      points.push({
        id: String(getField(c, ["CaseId", "caseId", "ID", "Id", "id"]) || `${projectId || ntsbNumber || Math.random()}`),
        lat,
        lon,
        label: label.trim(),
        eventDate,
        city,
        state,
        country,
        fatalities,
        eventType,
        docketUrl,
        ntsbNumber,
      });
      continue;
    }

    // If no coords: geocode city/state (US)
    const query = [city, state].filter(Boolean).join(", ").trim();

    if (!query) {
      geocodeSkipped += 1;
      continue;
    }

    if (geocodedCount >= MAX_GEOCODE_PER_REQUEST) {
      geocodeSkipped += 1;
      continue;
    }

    // Rate-limit: Nominatim wants gentle usage
    if (geocodedCount > 0) await sleep(1100);

    const geo = await geocodeUS(query);
    if (!geo) {
      geocodeSkipped += 1;
      continue;
    }

    geocodedCount += 1;

    points.push({
      id: String(getField(c, ["CaseId", "caseId", "ID", "Id", "id"]) || `${projectId || ntsbNumber || Math.random()}`),
      lat: geo.lat,
      lon: geo.lon,
      label: label.trim(),
      eventDate,
      city,
      state,
      country,
      fatalities,
      eventType,
      docketUrl,
      ntsbNumber,
    });
  }

  const geocodeNote =
    geocodeSkipped > 0
      ? `Geocoded ${geocodedCount}, skipped ${geocodeSkipped} (limit ${MAX_GEOCODE_PER_REQUEST}/request)`
      : `Geocoded ${geocodedCount}`;

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB Public API",
      urlUsed: ntsb.urlUsed,
      points,
      geocodeNote,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}

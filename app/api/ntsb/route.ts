import { NextResponse } from "next/server";

export const runtime = "nodejs"; // ensure Node runtime (not edge)

// NTSB base (public)
const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

// Nominatim geocoding (no key). This is fine for MVP but has rate limits.
const NOMINATIM =
  "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=";

const MAX_GEOCODES_PER_REQUEST = 20;

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

async function fetchWithTimeout(url: string, ms = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Put *your* email here (Nominatim likes contact info; NTSB doesn’t care)
        "User-Agent": "AviationSafetyWatch/1.0 (contact: you@example.com)",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(t);
  }
}

async function fetchNtsbCases(startYmd: string, endYmd: string) {
  // NTSB docs can be inconsistent about param naming; try a few.
  const candidates = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    // small retry loop per candidate
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { res, text } = await fetchWithTimeout(url, 12000);

        if (!res.ok) {
          lastErr = {
            url,
            status: res.status,
            statusText: res.statusText,
            bodyPreview: text.slice(0, 800),
            attempt,
          };
          // retry on 5xx
          if (res.status >= 500 && attempt < 3) {
            await new Promise((r) => setTimeout(r, 400 * attempt));
            continue;
          }
          break;
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
          break;
        }

        return { ok: true as const, urlUsed: url, data };
      } catch (e: any) {
        lastErr = { url, fetchError: String(e), attempt };
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
      }
    }
  }

  return { ok: false as const, error: lastErr };
}

// In-memory cache for geocoding within a warm lambda
const geoCache = new Map<string, { lat: number; lon: number }>();

async function geocodeLocation(q: string) {
  const key = q.trim().toLowerCase();
  if (!key) return null;

  const cached = geoCache.get(key);
  if (cached) return cached;

  const url = NOMINATIM + encodeURIComponent(q);

  const { res, text } = await fetchWithTimeout(url, 12000);
  if (!res.ok) return null;

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }

  if (!Array.isArray(json) || json.length === 0) return null;

  const lat = Number(json[0].lat);
  const lon = Number(json[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const out = { lat, lon };
  geoCache.set(key, out);
  return out;
}

// Try to pull fields from whatever shape the NTSB returns.
// (Their schema varies across endpoints/versions.)
function normalizeRecords(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.Data)) return payload.Data;
  if (Array.isArray(payload?.Cases)) return payload.Cases;
  if (Array.isArray(payload?.cases)) return payload.cases;
  return [];
}

function toDot(rec: any) {
  const id =
    String(
      rec?.NtsbId ??
        rec?.ntsbId ??
        rec?.CaseId ??
        rec?.caseId ??
        rec?.InvestigationId ??
        rec?.investigationId ??
        rec?.EventId ??
        rec?.eventId ??
        cryptoRandomId()
    ) || cryptoRandomId();

  const date =
    String(
      rec?.EventDate ??
        rec?.eventDate ??
        rec?.AccidentDate ??
        rec?.accidentDate ??
        rec?.OccurrenceDate ??
        rec?.occurrenceDate ??
        ""
    ) || "";

  const city = String(rec?.City ?? rec?.city ?? "");
  const state = String(rec?.State ?? rec?.state ?? "");
  const country = String(rec?.Country ?? rec?.country ?? "United States");

  const locationText = [city, state, country].filter(Boolean).join(", ");

  // Event type
  const eventType = String(rec?.EventType ?? rec?.eventType ?? rec?.Type ?? rec?.type ?? "").toLowerCase();
  const isAccident =
    eventType.includes("accident") ||
    String(rec?.Classification ?? rec?.classification ?? "").toLowerCase().includes("accident");

  // Fatalities
  const fatalCountRaw =
    rec?.TotalFatalInjuries ??
    rec?.totalFatalInjuries ??
    rec?.Fatalities ??
    rec?.fatalities ??
    rec?.Fatal ??
    rec?.fatal ??
    0;
  const fatalCount = Number(fatalCountRaw) || 0;

  // Coordinates (if present)
  const lat =
    Number(rec?.Latitude ?? rec?.latitude ?? rec?.Lat ?? rec?.lat ?? NaN) || NaN;
  const lon =
    Number(rec?.Longitude ?? rec?.longitude ?? rec?.Lng ?? rec?.lng ?? rec?.Lon ?? rec?.lon ?? NaN) || NaN;

  // Docket / investigation link if present (best case)
  const url =
    String(rec?.Url ?? rec?.url ?? rec?.NtsbUrl ?? rec?.ntsbUrl ?? rec?.DocketUrl ?? rec?.docketUrl ?? "") || "";

  const label =
    String(rec?.Title ?? rec?.title ?? rec?.MakeModel ?? rec?.makeModel ?? rec?.AircraftMakeModel ?? rec?.aircraftMakeModel ?? "NTSB Record");

  return {
    id,
    date,
    city,
    state,
    country,
    locationText,
    isAccident,
    fatalCount,
    lat,
    lon,
    url,
    label,
    raw: rec,
  };
}

function cryptoRandomId() {
  // works in node runtime on vercel
  return (globalThis.crypto?.randomUUID?.() ??
    `id_${Math.random().toString(16).slice(2)}_${Date.now()}`);
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

  const ntsb = await fetchNtsbCases(start, end);

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

  const records = normalizeRecords(ntsb.data);
  const normalized = records.map(toDot);

  // Geocode records missing coords (limited per request to avoid abuse/limits)
  let geocoded = 0;
  for (const r of normalized) {
    if (geocoded >= MAX_GEOCODES_PER_REQUEST) break;

    const hasCoords = Number.isFinite(r.lat) && Number.isFinite(r.lon);
    if (hasCoords) continue;

    if (!r.locationText) continue;

    const g = await geocodeLocation(r.locationText);
    if (!g) continue;

    r.lat = g.lat;
    r.lon = g.lon;
    geocoded++;
    // small spacing to be polite (helps with rate limits)
    await new Promise((res) => setTimeout(res, 150));
  }

  // Only return mappable dots (coords required)
  const dots = normalized
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lon,
      label: r.label,
      date: r.date,
      city: r.city,
      state: r.state,
      country: r.country,
      isAccident: r.isAccident,
      fatalCount: r.fatalCount,
      url: r.url || undefined,
      raw: r.raw,
    }));

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB endpoint (plus geocoding)",
      urlUsed: ntsb.urlUsed,
      geocodedThisRequest: geocoded,
      dots,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}

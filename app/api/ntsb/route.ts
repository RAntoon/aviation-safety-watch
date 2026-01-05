import { NextResponse } from "next/server";

export const runtime = "nodejs"; // safer for fetch + timeouts

// NTSB base (Public)
const NTSB_BASE =
  "https://api.ntsb.gov/public/api/Aviation/v1/GetCasesByDateRange";

// For geocoding (free, but rate-limited). We will CAP requests per call.
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

type LatLon = { lat: number; lon: number };

// Small in-memory cache (works within a warm serverless instance)
const geocodeCache = new Map<string, LatLon>();

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, ms = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Put a real URL/contact here (some gov endpoints behave better with this)
        "User-Agent":
          "AviationSafetyWatch/1.0 (https://aviationsafetywatch.com)",
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

/**
 * Try a few parameter spellings because docs vary.
 */
async function fetchNtsb(startYmd: string, endYmd: string) {
  const candidates: string[] = [
    `${NTSB_BASE}?startDate=${encodeURIComponent(startYmd)}&endDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?StartDate=${encodeURIComponent(startYmd)}&EndDate=${encodeURIComponent(endYmd)}`,
    `${NTSB_BASE}?from=${encodeURIComponent(startYmd)}&to=${encodeURIComponent(endYmd)}`,
  ];

  let lastErr: any = null;

  for (const url of candidates) {
    // retry a couple times per candidate (handles flakey upstream)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { res, text } = await fetchWithTimeout(url, 15000);

        if (!res.ok) {
          lastErr = {
            url,
            status: res.status,
            statusText: res.statusText,
            bodyPreview: text.slice(0, 800),
          };
          // tiny backoff before retry
          await sleep(400 * (attempt + 1));
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
          await sleep(400 * (attempt + 1));
          continue;
        }

        return { ok: true as const, urlUsed: url, data };
      } catch (e: any) {
        lastErr = { url, fetchError: String(e?.message ?? e) };
        await sleep(400 * (attempt + 1));
      }
    }
  }

  return { ok: false as const, error: lastErr };
}

/**
 * Extract lat/lon from a case if present (field names vary).
 */
function extractLatLon(c: any): LatLon | null {
  const lat =
    c?.Latitude ??
    c?.latitude ??
    c?.Lat ??
    c?.lat ??
    c?.LocationLatitude ??
    null;
  const lon =
    c?.Longitude ??
    c?.longitude ??
    c?.Lon ??
    c?.lon ??
    c?.LocationLongitude ??
    null;

  const latNum = typeof lat === "string" ? Number(lat) : lat;
  const lonNum = typeof lon === "string" ? Number(lon) : lon;

  if (
    typeof latNum === "number" &&
    typeof lonNum === "number" &&
    Number.isFinite(latNum) &&
    Number.isFinite(lonNum)
  ) {
    return { lat: latNum, lon: lonNum };
  }

  return null;
}

/**
 * Build a reasonable “place string” for geocoding.
 * (Your upstream may include City/State or a Location field.)
 */
function extractPlaceString(c: any): string | null {
  const raw =
    c?.Location ??
    c?.location ??
    c?.City ??
    c?.city ??
    c?.EventCity ??
    c?.EventState ??
    null;

  if (typeof raw === "string" && raw.trim()) return raw.trim();

  // If we have City + State
  const city = (c?.City ?? c?.city ?? c?.EventCity ?? "").toString().trim();
  const state = (c?.State ?? c?.state ?? c?.EventState ?? "").toString().trim();

  const combo = [city, state].filter(Boolean).join(", ");
  return combo ? combo : null;
}

async function geocode(place: string) {
  const key = place.toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  const url =
    `${NOMINATIM_BASE}?format=jsonv2&limit=1&q=` + encodeURIComponent(place);

  const { res, text } = await fetchWithTimeout(url, 12000);
  if (!res.ok) return null;

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  const first = Array.isArray(data) ? data[0] : null;
  const lat = first?.lat ? Number(first.lat) : null;
  const lon = first?.lon ? Number(first.lon) : null;

  if (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    const out = { lat, lon };
    geocodeCache.set(key, out);
    return out;
  }

  return null;
}

/**
 * Try to classify:
 * - red: accidents with fatalities
 * - orange: accidents without fatalities
 * - yellow: incidents
 *
 * We do “best effort” because field names vary.
 */
function classify(c: any): "fatal_accident" | "accident" | "incident" {
  const fatalities =
    c?.Fatalities ??
    c?.fatalities ??
    c?.TotalFatalInjuries ??
    c?.totalFatalInjuries ??
    0;

  const fatNum = typeof fatalities === "string" ? Number(fatalities) : fatalities;

  if (typeof fatNum === "number" && fatNum > 0) return "fatal_accident";

  const eventType = (c?.EventType ?? c?.eventType ?? c?.Type ?? "")
    .toString()
    .toLowerCase();

  // common-ish heuristics
  if (eventType.includes("incident") || eventType === "inc") return "incident";

  // default to accident if not clearly incident
  return "accident";
}

/**
 * Build a docket link if we can.
 * NTSB dockets are commonly accessible via data.ntsb.gov.  [oai_citation:0‡NTSB](https://www.ntsb.gov/Pages/Open.aspx?utm_source=chatgpt.com)
 */
function buildDocketUrl(c: any): string | null {
  const projectId =
    c?.ProjectId ??
    c?.projectId ??
    c?.ProjectID ??
    c?.projectID ??
    c?.DocketId ??
    c?.docketId ??
    null;

  if (projectId == null) return null;

  const pid = String(projectId).trim();
  if (!pid) return null;

  return `https://data.ntsb.gov/Docket?ProjectID=${encodeURIComponent(pid)}`;
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
    // IMPORTANT: return upstreamError so you can debug from the browser
    return NextResponse.json(
      {
        ok: false,
        start,
        end,
        message: "NTSB upstream fetch failed",
        upstreamError: ntsb.error,
      },
      { status: 502 }
    );
  }

  // The NTSB response shape may be array OR wrapped object.
  // We'll try to find an array of cases.
  let cases: any[] = [];
  if (Array.isArray(ntsb.data)) {
    cases = ntsb.data;
  } else if (Array.isArray(ntsb.data?.data)) {
    cases = ntsb.data.data;
  } else if (Array.isArray(ntsb.data?.Cases)) {
    cases = ntsb.data.Cases;
  } else if (Array.isArray(ntsb.data?.cases)) {
    cases = ntsb.data.cases;
  }

  // Geocode: cap per request to avoid timeouts / rate limits
  const MAX_GEOCODES_PER_CALL = 40;
  let geocodedCount = 0;
  let geocodeSkipped = 0;

  const normalized = [];
  for (const c of cases) {
    const existing = extractLatLon(c);
    let coords = existing;

    if (!coords) {
      const place = extractPlaceString(c);
      if (place) {
        if (geocodedCount < MAX_GEOCODES_PER_CALL) {
          // polite: sleep a bit between requests
          await sleep(250);
          coords = await geocode(place);
          geocodedCount++;
        } else {
          geocodeSkipped++;
        }
      }
    }

    const kind = classify(c);

    normalized.push({
      // raw-ish identifiers (vary by upstream)
      id:
        c?.CaseId ??
        c?.caseId ??
        c?.NtsbNumber ??
        c?.ntsbNumber ??
        c?.EventId ??
        c?.eventId ??
        crypto.randomUUID(),
      kind, // fatal_accident | accident | incident
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      place: extractPlaceString(c),
      date:
        c?.EventDate ??
        c?.eventDate ??
        c?.OccurrenceDate ??
        c?.occurrenceDate ??
        null,
      // Keep a small “card” worth of fields to show in the popup
      title:
        c?.NtsbNumber ??
        c?.ntsbNumber ??
        c?.EventType ??
        c?.eventType ??
        "NTSB case",
      docketUrl: buildDocketUrl(c),
      // If you want more fields in your popup later, add them here:
      summary: c?.Narrative ?? c?.narrative ?? c?.Synopsis ?? c?.synopsis ?? null,
      fatalities:
        c?.Fatalities ??
        c?.fatalities ??
        c?.TotalFatalInjuries ??
        c?.totalFatalInjuries ??
        0,
      raw: c, // optional (handy for dev; remove later if you want smaller payloads)
    });
  }

  return NextResponse.json(
    {
      ok: true,
      start,
      end,
      source: "NTSB public endpoint",
      urlUsed: ntsb.urlUsed,
      count: normalized.length,
      geocodedCount,
      geocodeSkipped,
      data: normalized,
      fetchedAt: new Date().toISOString(),
    },
    { status: 200 }
  );
}
